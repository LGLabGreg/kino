'use client'

import {
  anchorOffset,
  anchorStrip,
  physicalSide,
  type PopupSide,
  type ReadingDirection,
  type ScreenBox,
} from '@/registry/lib/popup'
import {
  FOLLOWS_TRANSITION,
  transitionTiming,
  withoutTransition,
} from '@/registry/lib/resize'
import {
  createContext,
  type CSSProperties,
  type ReactNode,
  use,
  useCallback,
  useLayoutEffect,
  useState,
} from 'react'

import { cn } from '@/lib/utils'

/*
 * How a popup that a group of triggers shares opens, slides and closes: one
 * box that grows out of a strip on the edge facing its trigger, slides to
 * the next trigger of its group, and folds back into the strip. Tooltip,
 * Hover card and Navigation menu share it.
 *
 * The popup paints nothing itself. Its surface reaches far past it, and the
 * surface and the content are clipped to one box, written as CSS variables
 * relative to the popup: the box when open, the strip while opening and
 * closing, and the last box's size while it slides to a new one. One clip, so
 * an open, a slide and a close each turn back from wherever the last one left
 * it. When Base UI places the popup somewhere else, the whole popup shifts
 * back to where it showed and glides to its new place on a `translate` of
 * its own, so the clip keeps its own clock on the way: a tooltip that follows
 * the pointer finishes opening while it moves.
 */

/**
 * How long a trigger in a group waits before its popup closes, in ms: long
 * enough to cross the gap to the next trigger, so the popup slides there
 * instead of closing and opening again.
 */
export const GLIDE_GROUP_CLOSE_DELAY = 150

/**
 * How long a group remembers where its popup was after it closed, in ms, so
 * one that opens again soon carries on from there. Base UI's tooltip warm
 * window.
 */
export const GLIDE_MEMORY_MS = 400

/**
 * Where the clip is in its life, as the popup's `data-glide`: not yet placed
 * (`waiting`, hidden), still (`rest`), growing out of its strip (`open`),
 * moving to a new box (`slide`) or folding back (`close`).
 */
export type GlidePhase = 'waiting' | 'rest' | 'open' | 'slide' | 'close'

/** What the tracker saw. */
export type GlideCue =
  | {
      kind: 'measured'
      /** Base UI asks for no animation. */
      instant: boolean
      /** The popup moved only because the page scrolled, so the clip already follows. */
      scrolled: boolean
      /** The popup's box changed size, not only its place. */
      resized: boolean
      /** How a popup that opens soon after its group's last one closed starts, if one did. */
      remembered: 'slide' | 'grow' | null
    }
  | { kind: 'ending' }
  | { kind: 'settled' }

/**
 * What the clip does: snap to the box, grow from the strip, grow from the
 * strip the last popup folded into, slide from where it shows now, slide
 * from where the last popup was, fold, or come to rest. On a `move`, the
 * popup glides to its new place and the clip carries on as it was.
 */
export type GlideStep =
  | 'snap'
  | 'grow'
  | 'grow-again'
  | 'slide'
  | 'slide-again'
  | 'move'
  | 'fold'
  | 'rest'
  | 'stay'

/** The next phase, and the step that gets there. */
export function glideNext(
  phase: GlidePhase,
  cue: GlideCue,
): readonly [GlidePhase, GlideStep] {
  // A fold already running carries on from where it has got to.
  if (cue.kind === 'ending')
    return phase === 'close' ? ['close', 'stay'] : ['close', 'fold']
  if (cue.kind === 'settled') {
    return phase === 'open' || phase === 'slide' ? ['rest', 'rest'] : [phase, 'stay']
  }
  if (phase === 'waiting') {
    // Carrying on from the group's last popup wins over Base UI's instant
    // open, which is how its warm window opens the next one.
    if (cue.remembered === 'slide') return ['slide', 'slide-again']
    if (cue.remembered === 'grow') return ['open', 'grow-again']
    return cue.instant ? ['rest', 'snap'] : ['open', 'grow']
  }
  if (cue.instant) return ['rest', 'snap']
  // Opened again before it had gone, it slides on from where the fold got to.
  if (cue.scrolled && phase !== 'close') return [phase, 'stay']
  // The same box somewhere else: an open keeps growing on its own clock as it
  // goes, rather than starting over from wherever the pointer left it.
  if (!cue.resized && phase !== 'close') return [phase, 'move']
  return ['slide', 'slide']
}

/**
 * The box an `inset()` clip shows, in screen pixels, on an element whose box
 * is `frame`; null for any other clip. Reads a computed value, which gives
 * one to four lengths in pixels.
 */
export function insetBox(clip: string, frame: ScreenBox): ScreenBox | null {
  if (!clip.startsWith('inset(')) return null
  const end = clip.includes(' round') ? clip.indexOf(' round') : clip.lastIndexOf(')')
  const values = clip
    .slice('inset('.length, end)
    .trim()
    .split(/\s+/)
    .map((value) => Number.parseFloat(value))
  if (values.length === 0 || values.length > 4 || values.some(Number.isNaN)) return null
  const [top, right = top, bottom = top, left = right] = values
  return {
    left: frame.left + left,
    top: frame.top + top,
    width: frame.width - left - right,
    height: frame.height - top - bottom,
  }
}

/**
 * The shift that keeps a popup where it is on screen once Base UI has placed
 * it from `from` to `to`: `current` plus the move of its inline-start corner,
 * which its content is laid out from.
 */
export function rideOffset(
  current: readonly [number, number],
  from: ScreenBox,
  to: ScreenBox,
  direction: ReadingDirection,
): [number, number] {
  const dx =
    direction === 'rtl'
      ? from.left + from.width - (to.left + to.width)
      : from.left - to.left
  return [current[0] + dx, current[1] + from.top - to.top]
}

/* Where a group's popup last was, the strip it folded into, and when it went. */
interface GlideMemory {
  box: ScreenBox | null
  strip: ScreenBox | null
  /** From `performance.now()`; infinite while it is still folding. */
  closedAt: number
}

const GlideMemoryContext = createContext<GlideMemory | null>(null)

/** Lets the popups of one group carry on from where the last one was. */
export function GlideGroupMemory({ children }: { children: ReactNode }) {
  const [memory] = useState<GlideMemory>(() => ({ box: null, strip: null, closedAt: 0 }))
  return <GlideMemoryContext value={memory}>{children}</GlideMemoryContext>
}

/** The handle a group's triggers share, and how each item hands its content to the one popup. */
export interface GlideGroup<Handle, Content> {
  handle: Handle
  setContent: (id: string, content: Content | null) => void
}

/**
 * One popup for a group of triggers, such as a toolbar's tooltips: a Base UI
 * handle the triggers share, and the content of each item, by the id its
 * trigger sends as the payload.
 */
export function useGlideGroup<Handle, Content>(createHandle: () => Handle) {
  const [contents, setContents] = useState<Record<string, Content>>({})
  const [group] = useState<GlideGroup<Handle, Content>>(() => ({
    handle: createHandle(),
    setContent: (id, content) =>
      setContents((previous) => {
        if (content) return { ...previous, [id]: content }
        const rest = { ...previous }
        delete rest[id]
        return rest
      }),
  }))
  return { group, contentOf: (payload: unknown) => contents[String(payload)] }
}

/** Hands an item's content to its group's popup while it is mounted. */
export function useGlideGroupItem<Handle, Content>(
  group: GlideGroup<Handle, Content> | null,
  id: string | null,
  content: Content,
) {
  useLayoutEffect(() => {
    if (group && id) group.setContent(id, content)
  })
  useLayoutEffect(() => {
    if (group && id) return () => group.setContent(id, null)
  }, [group, id])
}

/**
 * What a trigger in a group passes to Base UI: the shared handle, its item's
 * id as the payload, and the short close delay that lets the popup slide on.
 */
export function glideTriggerProps<Handle, Content>(
  group: GlideGroup<Handle, Content> | null,
  id: string | null,
) {
  return group && id
    ? { handle: group.handle, payload: id, closeDelay: GLIDE_GROUP_CLOSE_DELAY }
    : {}
}

function cssPixels(element: HTMLElement, name: string) {
  return Number.parseFloat(element.style.getPropertyValue(name))
}

/** Writes `box` as `--<name>-t/r/b/l` insets against `popupBox`. */
function writeBox(
  popup: HTMLElement,
  name: 'glide' | 'strip',
  popupBox: ScreenBox,
  box: ScreenBox,
) {
  popup.style.setProperty(`--${name}-t`, `${box.top - popupBox.top}px`)
  popup.style.setProperty(`--${name}-l`, `${box.left - popupBox.left}px`)
  popup.style.setProperty(
    `--${name}-r`,
    `${popupBox.left + popupBox.width - (box.left + box.width)}px`,
  )
  popup.style.setProperty(
    `--${name}-b`,
    `${popupBox.top + popupBox.height - (box.top + box.height)}px`,
  )
}

/** The box written as `--<name>-*` against `popupBox`, back on screen. */
function readBox(
  popup: HTMLElement,
  name: 'glide' | 'strip',
  popupBox: ScreenBox,
): ScreenBox {
  const t = cssPixels(popup, `--${name}-t`) || 0
  const r = cssPixels(popup, `--${name}-r`) || 0
  const b = cssPixels(popup, `--${name}-b`) || 0
  const l = cssPixels(popup, `--${name}-l`) || 0
  return {
    left: popupBox.left + l,
    top: popupBox.top + t,
    width: popupBox.width - l - r,
    height: popupBox.height - t - b,
  }
}

/**
 * Notes when anything on the page scrolls. A popup that moved just after a
 * scroll, at the same size, moved with its anchor: its clip is written
 * against the popup, so it already follows, and sliding it would leave the
 * box behind.
 */
function watchScroll() {
  let at = Number.NEGATIVE_INFINITY
  const note = () => {
    at = performance.now()
  }
  window.addEventListener('scroll', note, { capture: true, passive: true })
  return {
    followed: (from: ScreenBox | null, to: ScreenBox) =>
      from !== null &&
      from.width === to.width &&
      from.height === to.height &&
      performance.now() - at < 100,
    stop: () => window.removeEventListener('scroll', note, { capture: true }),
  }
}

const boxOf = (element: Element): ScreenBox => {
  const rect = element.getBoundingClientRect()
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
}

/** How far the popup shows from its place, in pixels across and down. */
type Shift = readonly [number, number]

/** The popup's shift now, mid-glide or not. */
const shiftOf = (popup: HTMLElement): Shift => {
  const now = getComputedStyle(popup).translate
  if (now === 'none') return [0, 0]
  const [x = '0', y = '0'] = now.split(' ')
  return [Number.parseFloat(x), Number.parseFloat(y)]
}

/** `box` moved by `shift`, or back by it with a `sign` of -1. */
const moved = (box: ScreenBox, [x, y]: Shift, sign: 1 | -1 = 1): ScreenBox => ({
  ...box,
  left: box.left + x * sign,
  top: box.top + y * sign,
})

/** Where Base UI placed the popup, without the shift it shows at. */
const placeOf = (popup: HTMLElement, shift: Shift) => moved(boxOf(popup), shift, -1)

/** Whether Base UI asks for no animation; `first` is the popup's first placing. */
export type GlideInstant = (parts: {
  popup: HTMLElement
  positioner: HTMLElement
  first: boolean
}) => boolean

interface GlideOptions {
  /**
   * How a popup that opens soon after its group's last one closed starts:
   * sliding from the box the last one had (a tooltip, which looks as if it
   * never closed), or growing from the strip it folded into (a panel).
   */
  reopen: 'slide' | 'grow'
  instant: GlideInstant
}

const popupInstant: GlideInstant = ({ popup, first }) =>
  first && popup.hasAttribute('data-instant')

/*
 * Follows the popup's place and size and writes the clip, through the phases
 * `glideNext` sets out. Kept outside any component: the React Compiler can
 * drop a forced style read written inside one, and the transitions need it.
 */
function trackGlide(
  content: HTMLElement,
  memory: GlideMemory | null,
  { reopen, instant }: GlideOptions,
) {
  const popup = content.parentElement
  const positioner = popup?.parentElement
  if (!popup || !positioner) return
  let phase: GlidePhase = 'waiting'
  let last = ''
  let popupBox: ScreenBox | null = null
  const scroll = watchScroll()
  const direction = () => getComputedStyle(popup).direction as ReadingDirection

  const enter = (next: GlidePhase) => {
    phase = next
    popup.dataset.glide = next
  }

  // The shift the popup keeps while it folds, set at once.
  const setHeld = ([x, y]: Shift) =>
    withoutTransition(
      popup,
      () => {
        popup.style.translate = x === 0 && y === 0 ? '' : `${x}px ${y}px`
      },
      { properties: ['translate'] },
    )
  const heldOf = (): Shift => {
    const [x = '0', y = '0'] = popup.style.translate.split(' ')
    return [Number.parseFloat(x) || 0, Number.parseFloat(y) || 0]
  }

  // Each move glides home on an animation of its own, added to the ones still
  // running: a move that comes mid-way keeps the earlier ones' speed, where
  // a transition turned round would start again from rest.
  const glideHome = ([x, y]: Shift) => {
    const [heldX, heldY] = heldOf()
    if (heldX !== 0 || heldY !== 0) setHeld([0, 0])
    const from = [x + heldX, y + heldY]
    if (from[0] === 0 && from[1] === 0) return
    const timing = transitionTiming(getComputedStyle(popup), 'translate')
    if (!timing) return
    const glide = popup.animate(
      [{ translate: `${from[0]}px ${from[1]}px` }, { translate: '0px 0px' }],
      {
        ...timing,
        composite: 'add',
        id: FOLLOWS_TRANSITION,
      },
    )
    // Started on this frame's clock: a new animation waits a frame for its start, and
    // without one it would show the popup at its new place for that frame.
    glide.startTime = document.timeline.currentTime
  }

  // A popup placed afresh shows at its place.
  const settle = () => {
    for (const animation of popup.getAnimations()) {
      if (animation.id === FOLLOWS_TRANSITION) animation.cancel()
    }
    setHeld([0, 0])
  }

  // The strip under the trigger, read from the anchor Base UI placed.
  const stripOf = (box: ScreenBox) => {
    const side = physicalSide(popup.dataset.side as PopupSide | undefined, direction())
    const across = side === 'top' || side === 'bottom'
    const anchor = anchorOffset(popup, across)
    const anchorLength = cssPixels(
      positioner,
      across ? '--anchor-width' : '--anchor-height',
    )
    const length = across ? box.width : box.height
    return anchorStrip(
      side,
      box,
      Number.isNaN(anchor) ? length / 2 : anchor,
      Number.isNaN(anchorLength) ? length : anchorLength,
    )
  }

  // Moves the clip from `from` to the box, both against the popup's place.
  const play = (next: 'open' | 'slide', from: ScreenBox | null, box: ScreenBox) => {
    enter('rest')
    if (from) writeBox(popup, 'glide', box, from)
    void getComputedStyle(content).clipPath
    enter(next)
    writeBox(popup, 'glide', box, box)
  }

  // Base UI can move a closing popup before it has gone, such as to its next
  // trigger a frame before it opens it again: the shift keeps the fold where
  // it is on screen.
  const hold = () => {
    if (!popupBox) return
    const shift = shiftOf(popup)
    const box = placeOf(popup, shift)
    if (box.width === 0 || (box.left === popupBox.left && box.top === popupBox.top)) {
      return
    }
    const [x, y] = rideOffset(heldOf(), popupBox, box, direction())
    setHeld([x, y])
    popupBox = box
  }

  const fold = () => {
    const [next, step] = glideNext(phase, { kind: 'ending' })
    if (popupBox) {
      // Base UI can take the closing content out of flow: the box keeps its size.
      popup.style.width = `${popupBox.width}px`
      popup.style.height = `${popupBox.height}px`
      // The fold starts: aim it at the trigger open now.
      if (step === 'fold') writeBox(popup, 'strip', popupBox, stripOf(popupBox))
    }
    hold()
    enter(next)
    if (memory && popupBox) {
      memory.strip = readBox(popup, 'strip', popupBox)
      memory.closedAt = Number.POSITIVE_INFINITY
    }
    last = ''
  }

  const remembered = (): 'slide' | 'grow' | null => {
    if (!memory || performance.now() - memory.closedAt >= GLIDE_MEMORY_MS) return null
    return (reopen === 'slide' ? memory.box : memory.strip) ? reopen : null
  }

  const write = () => {
    // Base UI keeps the positioner see-through until it has placed it.
    if (positioner.style.opacity === '0') return
    if (popup.hasAttribute('data-ending-style')) {
      // The fold is driven by our attribute, not Base UI's: should the popup
      // open again before it has gone, the clip stays where the fold has got
      // to until the next write slides on from there.
      fold()
      return
    }
    popup.style.width = ''
    popup.style.height = ''
    const shift = shiftOf(popup)
    const box = placeOf(popup, shift)
    if (box.width === 0) return
    const key = `${box.left},${box.top},${box.width},${box.height}`
    if (key === last) return
    last = key
    const strip = stripOf(box)
    writeBox(popup, 'strip', box, strip)
    const [next, step] = glideNext(phase, {
      kind: 'measured',
      instant: instant({ popup, positioner, first: phase === 'waiting' }),
      scrolled: scroll.followed(popupBox, box),
      // Under a pixel, the clip's edges simply follow the popup's.
      resized:
        popupBox !== null &&
        (Math.abs(popupBox.width - box.width) >= 1 ||
          Math.abs(popupBox.height - box.height) >= 1),
      remembered: phase === 'waiting' ? remembered() : null,
    })
    if (step === 'snap') {
      enter(next)
      writeBox(popup, 'glide', box, box)
      settle()
    } else if (step === 'grow') {
      settle()
      play('open', strip, box)
    } else if (step === 'grow-again' && memory?.strip) {
      settle()
      play('open', memory.strip, box)
    } else if (step === 'slide-again' && memory?.box) {
      const from = rideOffset([0, 0], memory.box, box, direction())
      play('slide', moved(memory.box, from, -1), box)
      glideHome(from)
    } else if (step === 'slide' || step === 'move') {
      const move = popupBox ? rideOffset([0, 0], popupBox, box, direction()) : null
      if (step === 'slide') {
        // Where the box shows now, mid-move or not, read against where the
        // popup shows, then written against its new place, from which the
        // shift and the move start out.
        const shown = popupBox
          ? insetBox(getComputedStyle(content).clipPath, moved(popupBox, shift))
          : null
        const start: Shift = move ? [shift[0] + move[0], shift[1] + move[1]] : shift
        play('slide', shown && moved(shown, start, -1), box)
      }
      if (move) glideHome(move)
    }
    popupBox = box
    if (memory) memory.box = box
  }

  const settled = (event: TransitionEvent) => {
    if (event.propertyName !== 'clip-path' || event.target !== content) return
    const [next] = glideNext(phase, { kind: 'settled' })
    enter(next)
  }

  write()
  const resize = new ResizeObserver(write)
  resize.observe(popup)
  const change = new MutationObserver(write)
  change.observe(positioner, { attributes: true, attributeFilter: ['style'] })
  change.observe(popup, { attributes: true, attributeFilter: ['data-ending-style'] })
  content.addEventListener('transitionend', settled)
  return () => {
    resize.disconnect()
    change.disconnect()
    content.removeEventListener('transitionend', settled)
    scroll.stop()
    if (memory && popupBox) memory.closedAt = performance.now()
  }
}

/*
 * The clip's timing: none at rest, so a scroll just follows; `morph` to open,
 * `layout` to slide, `exit` to close. Hidden until it is placed. Under reduced
 * motion the box is always the box, and the popup only fades.
 */
const glideTiming =
  'transition-none group-data-[glide=open]/popup:transition-[clip-path] group-data-[glide=open]/popup:duration-(--motion-morph-duration) group-data-[glide=open]/popup:ease-(--motion-morph-easing) group-data-[glide=slide]/popup:transition-[clip-path] group-data-[glide=slide]/popup:duration-(--motion-layout-duration) group-data-[glide=slide]/popup:ease-(--motion-layout-easing) group-data-[glide=close]/popup:transition-[clip-path] group-data-[glide=close]/popup:duration-(--motion-exit-duration) group-data-[glide=close]/popup:ease-(--motion-exit-easing) motion-reduce:transition-none! not-group-data-glide/popup:invisible'

const glideClipClassName =
  '[clip-path:var(--clip-box)] group-data-[glide=close]/popup:[clip-path:var(--clip-strip)] motion-reduce:group-data-[glide=close]/popup:[clip-path:var(--clip-box)]'

function glideInset(name: 'glide' | 'strip', offset: string, shrink: string) {
  const edge = (key: string) => `calc(var(--${name}-${key}) + ${offset} + ${shrink})`
  return `inset(${edge('t')} ${edge('r')} ${edge('b')} ${edge('l')} round max(0px, calc(var(--glide-radius) - ${shrink})))`
}

/** The clips of an element whose box reaches `offset` past the popup's, drawn `shrink` inside it. */
function glideClip(offset: string, shrink = '0px') {
  return {
    '--clip-box': glideInset('glide', offset, shrink),
    '--clip-strip': glideInset('strip', offset, shrink),
  } as CSSProperties
}

/**
 * The popup's own classes. It fades as it folds, so the strip never lingers
 * as a line, and Base UI, which waits only for the popup's own transitions,
 * keeps it mounted until then. It glides to a new place on `layout`, also on
 * Base UI's instant open, which only skips the fade, and not under reduced
 * motion. Set `--glide-radius` beside them.
 */
export const glidePopupClassName =
  'group/popup relative isolate [transition:opacity_calc(var(--motion-exit-duration)*0.6)_var(--motion-exit-easing),translate_var(--motion-layout-duration)_var(--motion-layout-easing)] motion-reduce:[transition-property:opacity,--held] data-ending-style:opacity-0 motion-reduce:data-starting-style:opacity-0 data-instant:[transition-property:--held,translate] motion-reduce:data-instant:transition-none'

/**
 * What the popup's box is painted with, behind its content: `fill`, and with
 * `ring`, a hairline around it, and with `shadow`, a drop shadow. Goes first
 * inside the popup.
 */
export function GlideSurface({
  fill,
  ring,
  shadow = false,
}: {
  fill: string
  ring?: string
  shadow?: boolean
}) {
  const layer = cn('absolute inset-0', glideClipClassName, glideTiming)
  return (
    <span
      aria-hidden
      className={cn(
        // Far past the popup on every side, so the box can be drawn wherever
        // it slides from; the positioner is fixed, so this never scrolls the page.
        'pointer-events-none absolute -inset-[100vmax] -z-10',
        // Chromium runs the clip's transition on the compositor. A shadow
        // painted on the main thread stays where the box started until it
        // ends, so the last box's shadow trails a slide: the compositor
        // applies the shadow too.
        shadow && 'drop-shadow-lg will-change-[filter]',
      )}
    >
      {ring ? (
        <>
          <span className={cn(layer, ring)} style={glideClip('100vmax')} />
          <span className={cn(layer, fill)} style={glideClip('100vmax', '1px')} />
        </>
      ) : (
        <span className={cn(layer, fill)} style={glideClip('100vmax')} />
      )}
    </span>
  )
}

/**
 * The popup's content, clipped to the same box as its surface. Goes after
 * `GlideSurface`, and before an anchor from `usePopupGrow`. `reopen` and
 * `instant` say how it starts (see `GlideOptions`); by default, a popup that
 * opens soon after its group's last one slides from it, and Base UI's
 * `data-instant` on the popup skips the grow.
 */
export function GlideContent({
  children,
  reopen = 'slide',
  instant = popupInstant,
}: { children: ReactNode } & Partial<GlideOptions>) {
  const memory = use(GlideMemoryContext)
  // Stable, so a render doesn't start the tracking over.
  const track = useCallback(
    (element: HTMLDivElement | null) =>
      element ? trackGlide(element, memory, { reopen, instant }) : undefined,
    [memory, reopen, instant],
  )
  return (
    <div
      ref={track}
      className={cn(glideClipClassName, glideTiming)}
      style={glideClip('0px')}
    >
      {children}
    </div>
  )
}
