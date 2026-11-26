/*
 * One highlight that glides between the items of a group: a menu's rows, the
 * tabs, a button group's segments, a navigation menu's links. Its layer is as
 * large as the group and clipped to the item, whose box and corners it writes
 * as CSS variables, so nothing is laid out again; a CSS transition on
 * `layout` does the moving.
 *
 * It appears in place, slides from item to item, and fades out where it last
 * was. Brought back while it fades, it slides on from there; once it has
 * faded, it appears in place again (Greg, 2026-11-13).
 */

import {
  FOLLOWS_TRANSITION,
  runningTransitions,
  withoutTransition,
} from '@/registry/lib/resize'
import { registerProperties } from '@/registry/lib/run-progress'

/** Where the highlight is in its life. The layer carries it as `data-highlight`. */
export type HighlightState = 'hidden' | 'shown' | 'fading'

/** What happened: it was sent to an item, sent to none, or finished fading. */
export type HighlightEvent = 'item' | 'none' | 'faded'

/**
 * What the layer does: appear in place, slide to the item, start to fade,
 * finish hiding, or nothing.
 */
export type HighlightStep = 'appear' | 'slide' | 'fade' | 'hide' | 'stay'

const STEPS: Record<
  HighlightState,
  Record<HighlightEvent, readonly [HighlightState, HighlightStep]>
> = {
  hidden: {
    item: ['shown', 'appear'],
    none: ['hidden', 'stay'],
    faded: ['hidden', 'stay'],
  },
  shown: {
    item: ['shown', 'slide'],
    none: ['fading', 'fade'],
    faded: ['shown', 'stay'],
  },
  fading: {
    item: ['shown', 'slide'],
    none: ['fading', 'stay'],
    faded: ['hidden', 'hide'],
  },
}

/** The state after `event`, and what the layer does to get there. */
export function highlightStep(
  state: HighlightState,
  event: HighlightEvent,
): readonly [HighlightState, HighlightStep] {
  return STEPS[state][event]
}

type Box = Pick<DOMRect, 'top' | 'right' | 'bottom' | 'left' | 'width' | 'height'>

/**
 * Where the highlight goes, in px from each edge of its layer, and the item's
 * four corners (top left, top right, bottom right, bottom left), so it takes
 * the item's exact shape. A pill's 9999px is capped at half the item's
 * shorter side, so a corner never animates from it. `scale` is how much the
 * group is drawn larger or smaller than it is laid out, as in a dialog that
 * scales in: the boxes are measured as drawn, and the highlight is placed in
 * the group's own px.
 */
export function highlightBox(
  layer: Box,
  item: Box,
  corners: readonly string[],
  scale = 1,
) {
  const cap = Math.min(item.width, item.height) / scale / 2
  const [tl, tr, br, bl] = corners.map((corner) =>
    Math.min(Number.parseFloat(corner) || 0, cap),
  )
  return {
    top: (item.top - layer.top) / scale,
    right: (layer.right - item.right) / scale,
    bottom: (layer.bottom - item.bottom) / scale,
    left: (item.left - layer.left) / scale,
    tl,
    tr,
    br,
    bl,
  }
}

/** A computed `translate` (`Xpx Ypx`, `Xpx`, or `none`) as x and y in px. */
export function translateOf(translate: string): readonly [number, number] {
  const [x = 0, y = 0] = translate
    .split(' ')
    .map((value) => Number.parseFloat(value) || 0)
  return [x, y]
}

/**
 * A computed `clip-path: inset(…)` as its top, right, bottom and left in px,
 * however many of the four it writes out; null when it isn't an inset.
 */
export function insetsOf(
  clipPath: string,
): readonly [number, number, number, number] | null {
  const match = /^inset\(([^)]*?)(?:\s+round\s[^)]*)?\)$/.exec(clipPath.trim())
  if (!match) return null
  const values = match[1]!
    .trim()
    .split(/\s+/)
    .map((value) => Number.parseFloat(value))
  if (values.length === 0 || values.length > 4 || values.some(Number.isNaN)) return null
  const [top, right = top, bottom = top, left = right] = values as [number, ...number[]]
  return [top, right, bottom, left]
}

/**
 * Whether two placements put the highlight in the same place and shape, to
 * half a pixel: a row whose corners change as picked rows join is a new shape.
 */
export function sameBox(
  a: ReturnType<typeof highlightBox>,
  b: ReturnType<typeof highlightBox>,
) {
  return (['left', 'top', 'bottom', 'right', 'tl', 'tr', 'br', 'bl'] as const).every(
    (edge) => Math.abs(a[edge] - b[edge]) < 0.5,
  )
}

/**
 * Every box whose size can move `item` inside `group` without changing the
 * size of the item or the group: its ancestors' siblings, up to the group.
 * One section closing as another opens moves the rows of both and leaves the
 * list as tall as it was (2026-11-19: the docs sidebar's current page tint
 * stayed where the Blocks section's first row had been).
 */
export function boxesAround(item: Element, group: Element) {
  const boxes: Element[] = []
  for (let node = item; node !== group;) {
    const parent = node.parentElement
    if (!parent) break
    for (const sibling of parent.children) if (sibling !== node) boxes.push(sibling)
    node = parent
  }
  return boxes
}

/** Whether `item` is sliding into a new place on a translate transition. */
/**
 * The `translate` transitions sliding `item` into a new place: its own, and
 * those of the boxes around it inside `within`, such as a list's row that
 * glides when the list changes (the `flow` lib) with the item inside it.
 * Boxes from `within` up move the highlight's layer too, so they don't count.
 */
function slidesOf(item: HTMLElement, within?: Element | null): CSSTransition[] {
  const slides: CSSTransition[] = []
  for (
    let at: HTMLElement | null = item;
    at && at !== within && (within ? within.contains(at) : at === item);
    at = at.parentElement
  )
    slides.push(...runningTransitions(at, { property: 'translate' }))
  return slides
}

function sliding(item: HTMLElement, within?: Element | null) {
  return slidesOf(item, within).length > 0
}

/**
 * Where `item` is, or where it is going while it slides there on a
 * `translate` transition: its box with those transitions seeked to their
 * end and straight back, in one task, so nothing is drawn in between. That
 * reads the end whatever the translate is written in, such as a `calc()`
 * with percentages, which can't be added up from outside.
 */
function boxOf(item: HTMLElement, within?: Element | null): Box {
  const moving = slidesOf(item, within)
  if (moving.length === 0) return item.getBoundingClientRect()
  const times = moving.map((transition) => transition.currentTime)
  for (const transition of moving) {
    const end = Number(transition.effect?.getComputedTiming().endTime ?? 0)
    transition.currentTime = Math.max(0, end - 0.01)
  }
  const box = item.getBoundingClientRect()
  moving.forEach((transition, at) => {
    transition.currentTime = times[at] ?? null
  })
  return box
}

// Written out whole, once per role, so Tailwind finds every class.
const highlightClasses = {
  layout:
    'pointer-events-none absolute inset-0 opacity-0 [clip-path:inset(var(--highlight-top)_var(--highlight-right)_var(--highlight-bottom)_var(--highlight-left)_round_var(--highlight-tl)_var(--highlight-tr)_var(--highlight-br)_var(--highlight-bl))] [transition:opacity_var(--motion-exit-duration)_var(--motion-exit-easing)] data-[highlight=shown]:opacity-100 motion-safe:data-[highlight=shown]:[transition:opacity_var(--motion-enter-duration)_var(--motion-enter-easing),clip-path_var(--motion-layout-duration)_var(--motion-layout-easing),background-color_var(--motion-press-duration)_var(--motion-press-fade-easing)] motion-reduce:data-[highlight=shown]:[transition:opacity_var(--motion-enter-duration)_var(--motion-enter-easing),background-color_var(--motion-press-duration)_var(--motion-press-fade-easing)] motion-safe:data-[highlight=fading]:[transition:opacity_var(--motion-exit-duration)_var(--motion-exit-easing),clip-path_var(--motion-layout-duration)_var(--motion-layout-easing),background-color_var(--motion-press-duration)_var(--motion-press-fade-easing)]',
  morph:
    'pointer-events-none absolute inset-0 opacity-0 [clip-path:inset(var(--highlight-top)_var(--highlight-right)_var(--highlight-bottom)_var(--highlight-left)_round_var(--highlight-tl)_var(--highlight-tr)_var(--highlight-br)_var(--highlight-bl))] [transition:opacity_var(--motion-exit-duration)_var(--motion-exit-easing)] data-[highlight=shown]:opacity-100 motion-safe:data-[highlight=shown]:[transition:opacity_var(--motion-enter-duration)_var(--motion-enter-easing),clip-path_var(--motion-morph-duration)_var(--motion-morph-easing),background-color_var(--motion-press-duration)_var(--motion-press-fade-easing)] motion-reduce:data-[highlight=shown]:[transition:opacity_var(--motion-enter-duration)_var(--motion-enter-easing),background-color_var(--motion-press-duration)_var(--motion-press-fade-easing)] motion-safe:data-[highlight=fading]:[transition:opacity_var(--motion-exit-duration)_var(--motion-exit-easing),clip-path_var(--motion-morph-duration)_var(--motion-morph-easing),background-color_var(--motion-press-duration)_var(--motion-press-fade-easing)]',
}

/**
 * The layer's classes: it fades in on `enter` and out on `exit`, slides on
 * `layout`, and changes colour (a press, a destructive row) on `press`. Under
 * reduced motion it only fades. Give it a colour, and a `z-` that puts it
 * behind or over the items.
 */
export const highlightClassName = highlightClasses.layout

/**
 * `highlightClassName` for a highlight that marks the pick, as a segmented
 * control's thumb: it moves on `morph`, as the Tabs' pill does, where one
 * that follows the pointer moves on `layout`.
 */
export const pickClassName = highlightClasses.morph

/** The tint of a row under the highlight, which a row that marks where you are shares. */
export const rowTintClassName = 'bg-foreground/5 dark:bg-foreground/7'

/**
 * The layer over a group of rows, as the Table's and the Tree's: a faint
 * tint over the rows, under nothing else.
 */
export const rowHighlightClassName = `${highlightClassName} z-20 ${rowTintClassName}`

/**
 * `tintedRowTextClassName` for a link or a button that takes a tint of its
 * own under the pointer, as an Item outside a group does.
 */
export const hoveredRowTextClassName =
  '[&:is(a[href],button)]:hover:[--muted-foreground:color-mix(in_oklab,var(--foreground)_70%,var(--background))]'

/**
 * A picked row's tint, as the Tree's and the Listbox's: the muted colour, and
 * the system's own colours under forced colours. On the row, which carries
 * `data-selected` when picked.
 */
export const pickedRowClassName =
  '[&[data-selected]]:bg-muted forced-colors:[&[data-selected]]:bg-[Highlight] forced-colors:[&[data-selected]]:text-[HighlightText] forced-colors:[&[data-selected]]:forced-color-adjust-none forced-colors:[&[data-selected]]:**:text-[HighlightText]'

/**
 * Muted text in a tinted row (picked, or under the highlight) is darker, so
 * it keeps 4.5:1 on the tint. On the row, picked when its list says so:
 * `data-selected`, `aria-selected`, a radio row's `aria-checked` or
 * `aria-current`.
 */
export const tintedRowTextClassName =
  '[&:is([data-selected],[aria-selected=true],[aria-checked=true],[aria-current=true])]:[--muted-foreground:color-mix(in_oklab,var(--foreground)_70%,var(--background))] [&[data-glided]]:[--muted-foreground:color-mix(in_oklab,var(--foreground)_70%,var(--background))]'

export interface Highlight {
  /** Where it is in its life. */
  readonly state: () => HighlightState
  /**
   * Sends it to `item`, or with null fades it out where it is. `from` is the
   * box it first appears on before sliding to `item`, used only when it
   * appears.
   */
  move: (item: HTMLElement | null, from?: Box) => void
  /**
   * Hides it for a popup that opens: at once (`instant`) when the popup had
   * gone, or from where it is when the popup opens again while it closes.
   */
  reset: (instant: boolean) => void
  /**
   * The group changed under it, as a list does when it filters: it goes with
   * its item to the item's new place, sliding when the item slides there and
   * at once when the item was simply laid out there. It fades once its item
   * has gone.
   */
  refit: () => void
  /**
   * Puts it on `item` at once, shown, with nothing moving or fading: where a
   * pick already is when the page paints.
   */
  jump: (item: HTMLElement) => void
  /** The item it is on, or null. */
  item: () => HTMLElement | null
  stop: () => void
}

/**
 * The window's variables, as lengths that don't inherit. Inherited, every
 * element inside the layer, such as a chart axis's copy of each name, has
 * its style worked out again on each step of the highlight.
 */
function registerHighlightProperties() {
  registerProperties(
    ['left', 'top', 'bottom', 'right', 'tl', 'tr', 'br', 'bl'].map((key) => ({
      name: `--highlight-${key}`,
      syntax: '<length>',
      inherits: false,
      initialValue: '0px',
    })),
  )
}

/**
 * Drives `layer` through its states. The item under it gets `data-glided`,
 * so what's inside can follow, and its `data-variant` is copied to the layer
 * (a destructive menu row tints it). It follows its item when the item or
 * the group changes size, and fades when the item goes. Kept outside any
 * component: the React Compiler can drop the forced style read it makes.
 */
export function createHighlight(layer: HTMLElement): Highlight {
  registerHighlightProperties()
  let state: HighlightState = 'hidden'
  let item: HTMLElement | null = null
  // Where it was last sent, from each edge of the layer.
  let placed: ReturnType<typeof highlightBox> | null = null
  // The item it fades out over, followed until it has faded, so it fades
  // where that item is even as the group changes size under it.
  let fadingOver: HTMLElement | null = null

  const measure = (box: Box, of: HTMLElement) => {
    const style = getComputedStyle(of)
    const area = layer.getBoundingClientRect()
    // Its laid-out width, unrounded and untouched by a transform: `offsetWidth`
    // rounds to whole px, which would read a group at rest as scaled.
    const laid = Number.parseFloat(getComputedStyle(layer).width)
    return highlightBox(
      area,
      box,
      [
        style.borderTopLeftRadius,
        style.borderTopRightRadius,
        style.borderBottomRightRadius,
        style.borderBottomLeftRadius,
      ],
      laid > 0 ? area.width / laid : 1,
    )
  }

  const write = (values: ReturnType<typeof highlightBox>) => {
    placed = values
    for (const [key, value] of Object.entries(values)) {
      layer.style.setProperty(`--highlight-${key}`, `${value}px`)
    }
  }

  const place = (box: Box, of: HTMLElement) => {
    // A glide that was following its moving item hands over from where it is
    // drawn: the transition to the new place starts there, not at the end of
    // the pursuit, which the variables already hold.
    if (pursuit) {
      const drawn = insetsOf(getComputedStyle(layer).clipPath)
      stopPursuit()
      if (drawn && placed) {
        const [top, right, bottom, left] = drawn
        const from = { ...placed, top, right, bottom, left }
        jump(() => write(from))
      }
    }
    write(measure(box, of))
    layer.dataset.variant = of.dataset.variant ?? 'default'
  }

  // A glide that goes on while the group changes size under it (a branch
  // above opening): the same move, for the time it had left, toward where its
  // item is now, retargeted each frame without starting again.
  let pursuit: { animation: Animation; from: number[] } | null = null
  const stopPursuit = () => {
    const running = pursuit
    pursuit = null
    running?.animation.cancel()
  }
  const clipOf = (insets: readonly number[], to: ReturnType<typeof highlightBox>) =>
    `inset(${insets.map((value) => `${value}px`).join(' ')} round ${to.tl}px ${to.tr}px ${to.br}px ${to.bl}px)`
  const insetsOfBox = (box: ReturnType<typeof highlightBox>) => [
    box.top,
    box.right,
    box.bottom,
    box.left,
  ]
  const pursue = (on: HTMLElement, wider: number, taller: number) => {
    const target = measure(boxOf(on, layer.parentElement), on)
    if (pursuit) {
      // The layer's own end and bottom edges moved: where it started stays put.
      const [top = 0, right = 0, bottom = 0, left = 0] = pursuit.from
      pursuit.from = [top, right + wider, bottom + taller, left]
      ;(pursuit.animation.effect as KeyframeEffect).setKeyframes([
        { clipPath: clipOf(pursuit.from, target) },
        { clipPath: clipOf(insetsOfBox(target), target) },
      ])
      jump(() => write(target))
      return true
    }
    const [transition] = runningTransitions(layer, { property: 'clip-path' })
    const timing = transition?.effect?.getComputedTiming()
    const drawn = insetsOf(getComputedStyle(layer).clipPath)
    if (!transition || !timing || !drawn) return false
    const left = Number(timing.endTime) - Number(timing.localTime ?? 0)
    if (!(left > 0)) return false
    const from = [drawn[0], drawn[1] + wider, drawn[2] + taller, drawn[3]]
    const easing = transition.effect?.getTiming().easing ?? 'linear'
    const rate = transition.playbackRate
    jump(() => write(target))
    const animation = layer.animate(
      [
        { clipPath: clipOf(from, target) },
        { clipPath: clipOf(insetsOfBox(target), target) },
      ],
      { duration: left, easing },
    )
    animation.playbackRate = rate
    // Chromium holds a clip-path animation at its start while its keyframes
    // change every frame, unless its start time is set.
    animation.startTime = document.timeline.currentTime
    const mine = { animation, from }
    pursuit = mine
    animation.finished.then(
      () => {
        if (pursuit === mine) pursuit = null
      },
      () => {},
    )
    return true
  }

  /**
   * Moves with `on` as `slide` carries it: from where the slide started it,
   * offset by the slide's first `translate`, to where it ends, at the
   * slide's own time, easing and rate. The insets move in px as the
   * translate does, so the highlight stays on the item every frame. False
   * when the slide can't be read, and the highlight moves its own way.
   */
  const ride = (on: HTMLElement, slide: CSSTransition) => {
    const effect = slide.effect
    if (!(effect instanceof KeyframeEffect)) return false
    const [first, last] = [effect.getKeyframes()[0], effect.getKeyframes().at(-1)]
    const timing = effect.getComputedTiming()
    if (!first || !last || slide.currentTime === null) return false
    const [fromX, fromY] = translateOf(String(first.translate ?? '0px'))
    const [toX, toY] = translateOf(String(last.translate ?? '0px'))
    const target = measure(boxOf(on, layer.parentElement), on)
    const [dx, dy] = [fromX - toX, fromY - toY]
    const from = [
      target.top + dy,
      target.right - dx,
      target.bottom - dy,
      target.left + dx,
    ]
    stopPursuit()
    jump(() => {
      write(target)
      layer.dataset.variant = on.dataset.variant ?? 'default'
    })
    const animation = layer.animate(
      [
        { clipPath: clipOf(from, target) },
        { clipPath: clipOf(insetsOfBox(target), target) },
      ],
      {
        duration: Number(timing.duration) || 0,
        delay: Number(effect.getTiming().delay) || 0,
        easing: effect.getTiming().easing ?? 'linear',
        id: FOLLOWS_TRANSITION,
      },
    )
    animation.playbackRate = slide.playbackRate
    animation.currentTime = slide.currentTime
    const mine = { animation, from }
    pursuit = mine
    animation.finished.then(
      () => {
        if (pursuit === mine) pursuit = null
      },
      () => {},
    )
    return true
  }

  const enter = (next: HighlightState) => {
    state = next
    layer.dataset.highlight = next
  }

  // The boxes around the item it is on, watched for a size change that moves it.
  let around: Element[] = []
  // A box stops being watched only once nothing it is watched for still needs it.
  const release = (boxes: Iterable<Element | null>) => {
    for (const box of boxes) {
      if (!box || box === layer || box === item || box === fadingOver) continue
      if (!around.includes(box)) sizes.unobserve(box)
    }
  }
  const watchAround = () => {
    const before = around
    const group = layer.parentElement
    around = item && group?.contains(item) ? boxesAround(item, group) : []
    for (const box of around) sizes.observe(box)
    release(before)
  }
  const follow = (next: HTMLElement | null) => {
    if (next === item) return
    const last = item
    last?.removeAttribute('data-glided')
    item = next
    if (next) {
      next.setAttribute('data-glided', '')
      sizes.observe(next)
    }
    watchAround()
    release([last])
  }

  const send = (event: HighlightEvent, next: HTMLElement | null, from?: Box) => {
    const [to, step] = highlightStep(state, event)
    if (step === 'stay') return
    if (step === 'appear' && next) {
      // Where the item is drawn now, which is not yet where it is going
      // when it slides into a new place.
      place(from ?? next.getBoundingClientRect(), next)
      // Painted where it appears before it may slide.
      void getComputedStyle(layer).clipPath
    }
    enter(to)
    if (next) place(boxOf(next, layer.parentElement), next)
    const last = item
    follow(next)
    const faded = fadingOver
    fadingOver = step === 'fade' ? last : null
    if (fadingOver) sizes.observe(fadingOver)
    release([faded])
    // With no fade to wait for (a feel or a test that takes no time), it has faded now.
    if (step === 'fade' && !fadingOut()) send('faded', null)
  }

  const fadingOut = () => runningTransitions(layer, { property: 'opacity' }).length > 0
  const gliding = () =>
    pursuit !== null || runningTransitions(layer, { property: 'clip-path' }).length > 0

  const faded = (event: TransitionEvent) => {
    if (event.target === layer && event.propertyName === 'opacity') send('faded', null)
  }

  let layerSize = [layer.offsetWidth, layer.offsetHeight]
  // A layer that changes size mid-glide (rows that leave shorten their table
  // at once) would move the edges its insets are measured from: the glide
  // goes on from where it is drawn, kept there against the new size.
  const resized = () => {
    const [width, height] = [layer.offsetWidth, layer.offsetHeight]
    const [wider, taller] = [width - layerSize[0]!, height - layerSize[1]!]
    layerSize = [width, height]
    return [wider, taller] as const
  }
  const rebase = (wider: number, taller: number) => {
    if ((wider === 0 && taller === 0) || !gliding()) return
    const drawn = insetsOf(getComputedStyle(layer).clipPath)
    if (!drawn) return
    // A pursuit drawn over the variables would hide what this writes.
    stopPursuit()
    jump(() => {
      layer.style.setProperty('--highlight-top', `${drawn[0]}px`)
      layer.style.setProperty('--highlight-right', `${drawn[1] + wider}px`)
      layer.style.setProperty('--highlight-bottom', `${drawn[2] + taller}px`)
      layer.style.setProperty('--highlight-left', `${drawn[3]}px`)
    })
  }

  // Moves it at once, while a fade it is in keeps running.
  const jump = (write: () => void) =>
    withoutTransition(layer, write, { properties: ['clip-path', 'background-color'] })

  // Its item moved or changed size under it, not to a new item: on its way
  // there (a glide not yet done, or the item sliding to a new place), it turns
  // toward where the item is now, from where it is; at rest, it goes with the
  // item at once, since a transition restarted every frame (a branch above
  // closing) would hold it where it was until the move ends.
  const refit = (moving = false) => {
    const on = item ?? (state === 'fading' ? fadingOver : null)
    if (!on || state === 'hidden') return
    if (!on.isConnected) {
      if (item) send('none', null)
      return
    }
    // Fading over an item that moves, it goes on toward it if it was on its
    // way there, else with it at once: a transition started every frame
    // would hold it where it was.
    if (on !== item && !sliding(on, layer.parentElement)) {
      const next = measure(boxOf(on, layer.parentElement), on)
      if (placed && sameBox(placed, next)) return
      if (!(gliding() && pursue(on, 0, 0)))
        jump(() => place(boxOf(on, layer.parentElement), on))
      return
    }
    // Its item slides to a new place (a pinned row gliding up its list): it
    // goes with it, on the slide's own timing, so the two never part.
    const [slide] = slidesOf(on, layer.parentElement)
    if (on === item && slide && ride(on, slide)) return
    if (moving || sliding(on, layer.parentElement) || gliding()) {
      // A glide already following its moving item goes on following it.
      if (pursuit && on === item && !sliding(on, layer.parentElement)) pursue(on, 0, 0)
      else place(boxOf(on, layer.parentElement), on)
      return
    }
    const next = measure(boxOf(on, layer.parentElement), on)
    if (placed && sameBox(placed, next)) return
    jump(() => place(boxOf(on, layer.parentElement), on))
  }

  const sizes = new ResizeObserver(() => {
    const on = item ?? (state === 'fading' ? fadingOver : null)
    const [wider, taller] = resized()
    // Its item moved with the group while it glides there: the glide goes on.
    // Only when something moved: an item just observed reports its size at
    // once, and a pursuit started then would stand in for the glide.
    if (
      on?.isConnected &&
      state !== 'hidden' &&
      gliding() &&
      !sliding(on, layer.parentElement) &&
      (wider !== 0 ||
        taller !== 0 ||
        !placed ||
        !sameBox(placed, measure(boxOf(on, layer.parentElement), on))) &&
      pursue(on, wider, taller)
    ) {
      return
    }
    const moving = gliding() || (on !== null && sliding(on, layer.parentElement))
    rebase(wider, taller)
    refit(moving)
  })
  sizes.observe(layer)
  // The shape can change the item's corners without changing its size: the
  // highlight takes the new corners at once.
  const reshape = () => {
    if (!item || state === 'hidden' || !item.isConnected) return
    // A glide on its way keeps going; it takes the new corners where it lands.
    if (sliding(item, layer.parentElement) || gliding()) return
    const shown = item
    withoutTransition(layer, () => place(boxOf(shown, layer.parentElement), shown))
  }
  const shaped = new MutationObserver(reshape)
  shaped.observe(document.documentElement, {
    subtree: true,
    attributes: true,
    attributeFilter: ['data-shape'],
  })
  // The radius is a variable on the root's own style; watching style below
  // it would see the highlight's own writes.
  const rounded = new MutationObserver(reshape)
  rounded.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['style'],
  })
  layer.addEventListener('transitionend', faded)

  return {
    state: () => state,
    item: () => item,
    move: (next, from) => send(next ? 'item' : 'none', next, from),
    jump: (next) =>
      withoutTransition(layer, () => {
        if (state !== 'shown') enter('hidden')
        send('item', next)
      }),
    // Asked from outside when the items around may have changed, so it rewatches them.
    refit: () => {
      watchAround()
      refit()
    },
    reset: (instant) => {
      stopPursuit()
      follow(null)
      const faded = fadingOver
      fadingOver = null
      release([faded])
      // Still on screen, it turns back from where it is. Out of sight, it hides
      // at once, so the next item it is sent to appears the way it did the
      // first time, in place of turning a fade round at full.
      if (!instant) {
        enter('hidden')
        return
      }
      withoutTransition(layer, () => enter('hidden'))
    },
    stop: () => {
      stopPursuit()
      follow(null)
      sizes.disconnect()
      shaped.disconnect()
      rounded.disconnect()
      layer.removeEventListener('transitionend', faded)
    },
  }
}

/**
 * Follows the row marked `data-highlighted` in a menu (by Base UI) or a list
 * (by ui-sdk), or the row whose submenu is open. While the pointer is over `bounds` (the
 * popup, by default) the highlight stays where it is when no row is
 * highlighted, as when it crosses a separator or a label, or in the moment
 * between one submenu closing and the next opening, so it always slides on.
 * It fades once the pointer has left. A submenu's first highlight starts on
 * the row of the item that opened it. Over a popup kept mounted while
 * closed, it starts afresh on every open.
 */
/**
 * A popup's life as its rows' highlight sees it: `closing` once `data-open`
 * goes, `ending` while its exit runs, `closed` once that has ended.
 */
export type PopupPhase = 'closed' | 'open' | 'closing' | 'ending'

/**
 * The popup's next phase from its attributes now, and how its highlight
 * starts when it opens: `appear` after the popup had gone, `turn` (from where
 * it is) when it opens again before its close has ended. `endingChanged`: the
 * exit attribute came or went since the last look, which tells an exit
 * that ran between two looks (one with no transition) from one not yet begun.
 */
export function popupNext(
  phase: PopupPhase,
  {
    open,
    ending,
    endingChanged,
  }: { open: boolean; ending: boolean; endingChanged: boolean },
): readonly [PopupPhase, 'appear' | 'turn' | null] {
  if (open) {
    if (phase === 'open') return ['open', null]
    return ['open', phase === 'closed' ? 'appear' : 'turn']
  }
  if (phase === 'closed') return ['closed', null]
  if (ending) return ['ending', null]
  if (phase === 'ending' || endingChanged) return ['closed', null]
  return ['closing', null]
}

/** Whether a mutation added or removed an element, not just text. */
function elementsCameOrWent(record: MutationRecord) {
  return [...record.addedNodes, ...record.removedNodes].some(
    (node) => node instanceof Element,
  )
}

/** Whether a mutation added or removed rows, not just something inside one (a tick that mounts). */
function rowsCameOrWent(record: MutationRecord) {
  return [...record.addedNodes, ...record.removedNodes].some(
    (node) =>
      node instanceof Element &&
      (node.matches('[data-menu-row]') || node.querySelector('[data-menu-row]') !== null),
  )
}

export function followRows(
  list: HTMLElement,
  layer: HTMLElement,
  { popup, bounds = popup }: { popup: HTMLElement; bounds?: HTMLElement },
) {
  const highlight = createHighlight(layer)
  const opener = popup.hasAttribute('data-nested')
    ? document.getElementById(popup.getAttribute('aria-labelledby') ?? '')
    : null
  let phase: PopupPhase = 'closed'
  let first = true
  let waiting = false
  let inside = false
  let frame = 0

  const target = () =>
    list.querySelector<HTMLElement>(':scope [data-menu-row][data-highlighted]') ??
    list.querySelector<HTMLElement>(':scope [data-menu-row][data-popup-open]')

  const fromOpener = (opener: HTMLElement) => {
    waiting = false
    const row = target()
    if (phase !== 'open' || !row) {
      sync()
      return
    }
    const from = opener.getBoundingClientRect()
    const box = row.getBoundingClientRect()
    highlight.move(row, {
      top: from.top,
      bottom: from.bottom,
      height: from.height,
      left: box.left,
      right: box.right,
      width: box.width,
    })
  }

  const sync = () => {
    if (phase !== 'open' || waiting) return
    const row = target()
    if (!row) {
      // Across a gap, a separator or a label the highlight holds; another
      // item in the list that took the highlight, such as a theme switcher's
      // icon, has a look of its own, so this one fades.
      if (!inside || list.querySelector(':scope [data-highlighted]')) highlight.move(null)
      return
    }
    if (first && opener) {
      // Base UI places a submenu a frame or two after it mounts; measured
      // before that, the item that opened it is in the wrong place.
      first = false
      waiting = true
      frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(() => fromOpener(opener))
      })
      return
    }
    first = false
    highlight.move(row)
  }

  const opened = (records: MutationRecord[] = []) => {
    const [next, start] = popupNext(phase, {
      open: popup.hasAttribute('data-open'),
      ending: popup.hasAttribute('data-ending-style'),
      endingChanged: records.some(
        (record) => record.attributeName === 'data-ending-style',
      ),
    })
    phase = next
    if (start) {
      highlight.reset(start === 'appear')
      first = true
    }
    sync()
  }

  // Base UI stops pointer events on the menu while a submenu opens, which
  // fires `pointerleave` with the pointer still over it; the document still
  // sees every move. The box is the popup's, since a list that scrolls is
  // taller than what shows of it.
  const moved = (event: PointerEvent) => {
    const box = bounds.getBoundingClientRect()
    inside =
      event.clientX >= box.left &&
      event.clientX <= box.right &&
      event.clientY >= box.top &&
      event.clientY <= box.bottom
    if (!inside && phase === 'open' && !target()) highlight.move(null)
  }

  // Rows came or went, as in a list that filters: the highlight goes with its
  // row, or fades when no row is highlighted any more, wherever the pointer
  // is. Rows are looked at once every other observer has run, so a row that
  // is set sliding to its new place already is.
  const changed = () =>
    queueMicrotask(() => {
      if (phase !== 'open' || waiting) return
      const row = target()
      if (!row) highlight.move(null)
      else if (row === highlight.item()) highlight.refit()
      else highlight.move(row)
    })

  opened()
  document.addEventListener('pointermove', moved)
  const rows = new MutationObserver((records) => {
    if (records.some(rowsCameOrWent)) changed()
    else queueMicrotask(sync)
  })
  rows.observe(list, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['data-highlighted', 'data-popup-open'],
  })
  const state = new MutationObserver(opened)
  state.observe(popup, {
    attributes: true,
    attributeFilter: ['data-open', 'data-ending-style'],
  })
  return () => {
    rows.disconnect()
    state.disconnect()
    cancelAnimationFrame(frame)
    document.removeEventListener('pointermove', moved)
    highlight.stop()
  }
}

/**
 * What the pointer or focus is on, for `followPointer`: an item the
 * highlight lands on, something it doesn't (`none`: it leaves, as over a
 * disabled tab), or the space between items (`gap`: it stays where it is).
 */
export type HighlightTarget = HTMLElement | 'none' | 'gap'

/**
 * The item matching `selector` that `node` is in, inside `area`; a disabled
 * one is `none`. With `rows`, a row of the group that isn't an item, such as
 * an Item that doesn't act, is `none` too, and so is a disabled item that
 * lets the pointer through to its row.
 */
export function itemMatching(
  area: HTMLElement,
  selector: string,
  { rows }: { rows?: string } = {},
) {
  return (node: EventTarget | null): HighlightTarget => {
    const element = node instanceof Element ? node : null
    const item = element?.closest<HTMLElement>(selector)
    if (!item || !area.contains(item)) {
      const row = rows ? element?.closest(rows) : null
      return row && area.contains(row) ? 'none' : 'gap'
    }
    return item.matches(
      '[data-disabled], [data-readonly], :disabled, [aria-disabled="true"]',
    )
      ? 'none'
      : item
  }
}

/**
 * Follows the pointer over the items of `area`, and with `focus`, the item
 * with visible focus; whichever moved last wins. Off them, it goes to the
 * `current` item (an open trigger), or fades. It stays where it is across a
 * gap. Touch moves nothing: there is no hover to show.
 */
export function followPointer(
  area: HTMLElement,
  layer: HTMLElement,
  {
    itemOf,
    current,
    focus = false,
  }: {
    itemOf: (node: EventTarget | null) => HighlightTarget
    current?: string
    focus?: boolean
  },
) {
  const highlight = createHighlight(layer)
  let hovered: HTMLElement | null = null
  let focused: HTMLElement | null = null
  let last: 'pointer' | 'focus' = 'pointer'
  let frame = 0
  let shown: HTMLElement | null = null
  // The item whose popup just closed with focus still inside it: Base UI hands
  // focus back once the popup has gone, so the highlight waits on the item
  // instead of fading and coming back.
  let held: HTMLElement | null = null

  const target = () =>
    (last === 'focus' ? (focused ?? hovered) : (hovered ?? focused)) ??
    (current ? area.querySelector<HTMLElement>(current) : null) ??
    held

  const move = (item: HTMLElement | null) => {
    shown = item
    highlight.move(item)
  }

  const sync = () => {
    cancelAnimationFrame(frame)
    const item = target()
    if (item || !current) {
      move(item)
      return
    }
    // Base UI clears one trigger before it opens the next: wait a frame.
    frame = requestAnimationFrame(() => {
      // Only while focus is in the popup that is still closing.
      if (!target() && shown && document.activeElement?.closest('[data-ending-style]')) {
        held = shown
      }
      move(target())
    })
  }

  // Focus has gone somewhere, back to an item or not, or the pointer went down:
  // the item no longer waits.
  const release = () => {
    if (!held) return
    held = null
    // After the area's own focus handler, which may take the item.
    queueMicrotask(sync)
  }

  const over = (event: PointerEvent) => {
    if (event.pointerType === 'touch') return
    const under = itemOf(event.target)
    if (under === 'gap') return
    const next = under === 'none' ? null : under
    if (next === hovered && last === 'pointer') return
    hovered = next
    last = 'pointer'
    sync()
  }
  const leave = () => {
    hovered = null
    sync()
  }
  const focusIn = (event: FocusEvent) => {
    const under = itemOf(event.target)
    // What took focus may sit inside the item, as a row's checkbox does.
    if (
      under instanceof HTMLElement &&
      event.target instanceof Element &&
      event.target.matches(':focus-visible')
    ) {
      focused = under
      last = 'focus'
      sync()
    }
  }
  const focusOut = (event: FocusEvent) => {
    if (!focused || itemOf(event.target) !== focused) return
    focused = null
    // Focus moving to another item settles there on its own `focusin`.
    if (!(itemOf(event.relatedTarget) instanceof HTMLElement)) sync()
  }

  sync()
  document.addEventListener('focusin', release, true)
  document.addEventListener('pointerdown', release, true)
  area.addEventListener('pointerover', over)
  area.addEventListener('pointerleave', leave)
  if (focus) {
    area.addEventListener('focusin', focusIn)
    area.addEventListener('focusout', focusOut)
  }
  // Items came or went, as rows do in a table that sorts or grows: the
  // highlight goes with its item to the item's new place, once every other
  // observer has run, so an item set sliding there already is.
  const items = new MutationObserver((records) => {
    if (!records.some(elementsCameOrWent)) return
    queueMicrotask(() => {
      if (hovered && !hovered.isConnected) hovered = null
      if (focused && !focused.isConnected) focused = null
      if (shown && shown.isConnected && shown === target()) highlight.refit()
      else sync()
    })
  })
  items.observe(area, { subtree: true, childList: true })
  // A pick changes a row's corners, as picked rows next to each other join
  // into one block: the highlight takes the shape its row has now.
  const picked = new MutationObserver(() => queueMicrotask(() => highlight.refit()))
  picked.observe(area, {
    attributes: true,
    subtree: true,
    attributeFilter: ['data-selected'],
  })
  const opened = new MutationObserver(sync)
  if (current) {
    opened.observe(area, {
      attributes: true,
      subtree: true,
      attributeFilter: ['data-popup-open'],
    })
  }
  return () => {
    cancelAnimationFrame(frame)
    items.disconnect()
    picked.disconnect()
    opened.disconnect()
    document.removeEventListener('focusin', release, true)
    document.removeEventListener('pointerdown', release, true)
    area.removeEventListener('pointerover', over)
    area.removeEventListener('pointerleave', leave)
    area.removeEventListener('focusin', focusIn)
    area.removeEventListener('focusout', focusOut)
    highlight.stop()
  }
}

/**
 * Keeps the highlight on the item that holds focus, as a date input's
 * segments do, whether focus came from a key or a press. It glides as focus
 * moves from item to item and fades once focus leaves them.
 */
export function followFocus(
  area: HTMLElement,
  layer: HTMLElement,
  itemOf: (node: EventTarget | null) => HTMLElement | null,
) {
  const highlight = createHighlight(layer)
  const focusIn = (event: FocusEvent) => {
    const item = itemOf(event.target)
    if (item) highlight.move(item)
  }
  const focusOut = (event: FocusEvent) => {
    // Focus moving to another item settles there on its own `focusin`.
    if (!itemOf(event.relatedTarget)) highlight.move(null)
  }
  const item = itemOf(document.activeElement)
  if (item) highlight.move(item)
  area.addEventListener('focusin', focusIn)
  area.addEventListener('focusout', focusOut)
  return () => {
    area.removeEventListener('focusin', focusIn)
    area.removeEventListener('focusout', focusOut)
    highlight.stop()
  }
}

/**
 * Keeps the highlight on the picked item of a group that holds one choice,
 * as a segmented control's thumb: there when the page paints, sliding as
 * the pick changes and following its item at once when sizes change. It fades when
 * nothing is picked. `attributes` are the ones that change when the pick does, such as Base UI's `data-checked`.
 */
export function followPick(
  area: HTMLElement,
  layer: HTMLElement,
  { picked, attributes }: { picked: () => HTMLElement | null; attributes: string[] },
) {
  const highlight = createHighlight(layer)
  // A pick made before the first frame, such as a saved value restored as the
  // page hydrates, is where the item starts: nothing moves on first paint.
  let settled = false
  const frame = requestAnimationFrame(() => {
    settled = true
  })

  const sync = () => {
    const item = picked()
    if (item === highlight.item()) return
    if (settled || !item) highlight.move(item)
    else highlight.jump(item)
  }

  const first = picked()
  if (first) highlight.jump(first)
  // Items that come or go change the boxes around the picked one.
  // Once every observer of the same change has run: a list that glides its
  // rows (the `flow` lib) has started their slides by then, and the
  // highlight goes with the picked one.
  let stopped = false
  const changed = new MutationObserver(() =>
    queueMicrotask(() => {
      if (stopped) return
      highlight.refit()
      sync()
    }),
  )
  // An item can also arrive already picked, as options that load late do.
  changed.observe(area, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: attributes,
  })
  return () => {
    stopped = true
    cancelAnimationFrame(frame)
    changed.disconnect()
    highlight.stop()
  }
}
