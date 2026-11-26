'use client'

import { markMounted, mergeRefs } from '@/registry/lib/refs'
import { animateSize, transitionsSettled, withoutTransition } from '@/registry/lib/resize'
import {
  Children,
  cloneElement,
  createContext,
  Fragment,
  isValidElement,
  type ReactNode,
  type RefObject,
  use,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import { cn } from '@/lib/utils'

/*
 * Content that changes in place. The old content stays mounted until its exit
 * has played, the new content enters beside it, and the box follows the new
 * width. It moves on the `enter`, `exit` and `layout` roles.
 */

const componentIds = new WeakMap<object, number>()
let componentCount = 0

const LAZY = Symbol.for('react.lazy')

function typeName(type: unknown): string {
  if (typeof type === 'string') return type
  if (typeof type !== 'function' && (typeof type !== 'object' || type === null)) return ''
  // A Server Component hands a client component over in a new lazy wrapper on
  // every payload, so a wrapper's identity says nothing about what it holds.
  if ((type as { $$typeof?: symbol }).$$typeof === LAZY) return ''
  // By identity, because a production build renames components.
  let id = componentIds.get(type)
  if (id === undefined) {
    id = componentCount
    componentCount += 1
    componentIds.set(type, id)
  }
  return `#${id}`
}

const KEY_DEPTH = 8

/**
 * A string that changes when the content does: its text, which components its
 * elements are, their `key` and their plain props. Class names, styles and
 * handlers are left out, so rendering the same content again is no change.
 */
function contentKey(value: unknown, depth = 0): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  if (value === true) return 'true'
  if (typeof value !== 'object' || value === null || depth > KEY_DEPTH) return ''
  if (Array.isArray(value)) {
    return value.map((item) => contentKey(item, depth + 1)).join('')
  }
  if (isValidElement(value)) {
    const props = contentKey(value.props, depth + 1)
    return `<${typeName(value.type)} ${value.key ?? ''} ${props}>`
  }
  if (Object.getPrototypeOf(value) !== Object.prototype) return ''
  return Object.entries(value)
    .filter(([name]) => name !== 'className' && name !== 'style')
    .map(([name, item]) => `${name}=${contentKey(item, depth + 1)}`)
    .join(' ')
}

/**
 * Children as a flat list, with fragments opened. An element from inside a
 * fragment takes the fragment's key before its own, so the children of two
 * fragments in a mapped list never share a key.
 */
function flattenChildren(children: ReactNode, prefix = ''): ReactNode[] {
  return Children.toArray(children).flatMap((child) => {
    if (!isValidElement(child)) return [child]
    const key = `${prefix}${child.key ?? ''}`
    if (child.type === Fragment) {
      return flattenChildren((child.props as { children?: ReactNode }).children, key)
    }
    return prefix ? [cloneElement(child, { key })] : [child]
  })
}

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

/** The text as the characters a reader sees, so an emoji or an accent is never cut in two. */
function graphemes(text: string): string[] {
  return Array.from(segmenter.segment(text), (part) => part.segment)
}

/** What two texts share at each end, and what differs between. */
function seam(from: string, to: string) {
  const a = graphemes(from)
  const b = graphemes(to)
  const shortest = Math.min(a.length, b.length)
  let start = 0
  while (start < shortest && a[start] === b[start]) start += 1
  let end = 0
  while (end < shortest - start && a[a.length - 1 - end] === b[b.length - 1 - end]) {
    end += 1
  }
  return {
    prefix: b.slice(0, start).join(''),
    suffix: b.slice(b.length - end).join(''),
    was: a.slice(start, a.length - end).join(''),
    now: b.slice(start, b.length - end).join(''),
  }
}

/**
 * A width rounded up to the 1/64px layout works in. A computed width is
 * rounded to three decimals, which can be a hair under the real one, and
 * content held at that width wraps a line that fits (234.859px for 234.859375px).
 */
function fullPixels(width: number): number {
  return Math.ceil(width * 64 - 1e-6) / 64
}

/** The element's width as layout has it, which a scale on it or above it doesn't change. */
function layoutWidth(element: HTMLElement): number {
  return Number.parseFloat(getComputedStyle(element).width) || 0
}

function releaseWidth(element: HTMLElement) {
  element.style.width = ''
  element.style.removeProperty('--swap-width')
  element.style.removeProperty('--swap-shrink')
  delete element.dataset.resizing
}

/**
 * Moves `element` from one width to another, then hands the width back to
 * layout. While it moves, `--swap-width` holds the content at its final
 * width, so nothing truncates or reflows on the way.
 */
function animateWidth(element: HTMLElement, from: number, to: number) {
  void animateSize(element, 'width', from, to, {
    alongside: (start) => {
      if (!start) return
      element.style.setProperty('--swap-width', `${fullPixels(to)}px`)
      element.style.setProperty('--swap-shrink', '0')
      element.dataset.resizing = ''
    },
  }).then((latest) => {
    if (latest) releaseWidth(element)
  })
}

/** The width the element had in the last frame, mid-transition or not. */
function useLastWidth(ref: RefObject<HTMLElement | null>) {
  const last = useRef<number | null>(null)
  useEffect(() => {
    const element = ref.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => {
      last.current = entry.borderBoxSize[0].inlineSize
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref])
  return last
}

/** With `enabled`, the height the element had in the last frame, mid-transition or not. */
function useLastHeight(ref: RefObject<HTMLElement | null>, enabled: boolean) {
  const last = useRef<number | null>(null)
  useEffect(() => {
    const element = ref.current
    if (!element || !enabled) return
    const observer = new ResizeObserver(([entry]) => {
      last.current = entry.borderBoxSize[0].blockSize
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref, enabled])
  return last
}

/** Calls `done` once every transition on `ref` and inside it has ended or been turned round. */
function useSettled(
  ref: RefObject<HTMLElement | null>,
  /** Waits again whenever this changes; nothing waits while it is empty. */
  pending: string,
  done: () => void,
) {
  const doneRef = useRef(done)
  useEffect(() => {
    doneRef.current = done
  })
  useEffect(() => {
    const element = ref.current
    if (!pending || !element) return
    let cancelled = false
    // Transitions only: a spinner inside turns for as long as it shows.
    void transitionsSettled(element, { subtree: true }).then(() => {
      if (!cancelled) doneRef.current()
    })
    return () => {
      cancelled = true
    }
  }, [ref, pending])
}

// A buyer's `--swap-scale`, `--swap-blur` and `--swap-roll`, on the box or
// anything above it, win over the defaults each kind of box keeps in
// `--swap-default-*`. With reduced motion nothing travels, so what leaves goes
// at once: two contents never fade over each other in one place.
const swapItemMotion =
  'transition-[opacity,scale,filter,translate] duration-(--motion-enter-duration) ease-(--motion-enter-easing) data-[phase=out]:scale-(--swap-scale,var(--swap-default-scale)) data-[phase=out]:opacity-0 data-[phase=out]:blur-(--swap-blur,2px) data-[phase=out]:duration-(--motion-exit-duration) data-[phase=out]:ease-(--motion-exit-easing) data-fresh:starting:scale-(--swap-scale,var(--swap-default-scale)) data-fresh:starting:opacity-0 data-fresh:starting:blur-(--swap-blur,2px) motion-reduce:[--swap-blur:0px] motion-reduce:[--swap-scale:1] motion-reduce:data-[phase=out]:transition-none'

// What arrives waits for a fifth of the exit, so two labels never read at once.
// Under reduced motion what leaves goes at once, so there is nothing to wait for.
const swapWait =
  'motion-safe:data-[phase=in]:not-data-returned:delay-[calc(var(--motion-exit-duration)*0.2)]'

// What arrives waits until what leaves has mostly gone: content too large to
// read over itself, such as a form's steps, never shows two at once.
const swapWaitLonger =
  'motion-safe:data-[phase=in]:not-data-returned:delay-[calc(var(--motion-exit-duration)*0.6)]'

// Stepping out to a wider view, what leaves falls away and what arrives
// comes from nearer; stepping in, the reverse. `--swap-zoom` is the scale of
// the far end, and the near end is its inverse.
const swapZoom =
  'data-[depth=far]:data-[phase=out]:scale-(--swap-zoom,0.92) data-[depth=near]:data-[phase=out]:scale-[calc(1/var(--swap-zoom,0.92))] data-fresh:data-[depth=far]:starting:scale-(--swap-zoom,0.92) data-fresh:data-[depth=near]:starting:scale-[calc(1/var(--swap-zoom,0.92))] motion-reduce:[--swap-zoom:1]'

// What leaves goes up and what arrives comes from below; a change turned round
// goes back the way it came. Both move at once, like a counter.
const swapRoll =
  'data-[phase=out]:translate-y-[calc(var(--swap-roll,var(--swap-default-roll))*-1)] data-back:data-[phase=out]:translate-y-(--swap-roll,var(--swap-default-roll)) data-fresh:starting:translate-y-(--swap-roll,var(--swap-default-roll)) motion-reduce:[--swap-roll:0px]'

// Forward, what leaves goes towards the reading start and what arrives comes
// from the end, as the pages of a book; a change back goes the other way.
const swapSlide =
  '[--swap-dir:1] rtl:[--swap-dir:-1] data-[side=start]:[--swap-side:-1] data-[side=end]:[--swap-side:1] data-[phase=out]:translate-x-[calc(var(--swap-slide,var(--swap-default-slide))*var(--swap-side)*var(--swap-dir))] data-fresh:starting:translate-x-[calc(var(--swap-slide,var(--swap-default-slide))*var(--swap-side)*var(--swap-dir))] motion-reduce:[--swap-slide:0px]'

const swapAlignment = {
  center: 'justify-center',
  start: 'justify-start',
  end: 'justify-end',
}

interface SwapItem {
  key: string
  node: ReactNode
  phase: 'in' | 'out'
  /** Arrived after the first paint, so it may animate in. */
  fresh: boolean
  /** Leaves the way it came, because the change was turned round. */
  back?: boolean
  /**
   * With `slide`, which way it is offset at its far end: 1 towards the
   * reading end, -1 towards the start. What arrives starts there; what leaves
   * goes there.
   */
  side?: 1 | -1
  /**
   * With `zoom`, which way it is scaled at its far end: `near` larger, as if
   * closer, or `far` smaller.
   */
  depth?: 'near' | 'far'
  /** Came back while it was leaving, so it turns round at once with no wait. */
  returned?: boolean
}

/**
 * The items after the content changes to `key`. Content that comes back while
 * it leaves turns round, and what leaves then goes back the way it came.
 */
function swapTo(
  items: readonly SwapItem[],
  key: string,
  node: ReactNode,
  /** With `slide`, the way the change travels: 1 forward, -1 back. */
  trend?: 1 | -1,
  /** With `zoom`, whether the change steps `out` to a wider view or `in` to a closer one. */
  zoom?: 'in' | 'out',
): SwapItem[] {
  const returning = items.find((item) => item.key === key)
  const back = returning ? !returning.back : false
  const next = items.map((item): SwapItem => {
    if (item.key === key) return { ...item, phase: 'in', returned: true }
    const leaving = item.phase === 'in'
    const out: SwapItem = {
      ...item,
      phase: 'out',
      back: leaving ? back : item.back,
    }
    // What was showing leaves the way the change goes; what was already leaving keeps going.
    // A change with no slide never slides what leaves, however it once arrived.
    if (leaving && trend) out.side = trend === 1 ? -1 : 1
    else if (leaving) delete out.side
    // Stepping out, what leaves falls away and what arrives comes from nearer; stepping in, the reverse.
    // A change with no zoom never scales what leaves, however it once arrived.
    if (leaving && zoom) out.depth = zoom === 'out' ? 'far' : 'near'
    else if (leaving) delete out.depth
    return out
  })
  if (!returning) {
    const fresh: SwapItem = { key, node, phase: 'in', fresh: true }
    if (trend) fresh.side = trend
    if (zoom) fresh.depth = zoom === 'out' ? 'near' : 'far'
    next.push(fresh)
  }
  return next
}

/** The items once those in `left` have finished leaving; one that came back stays. */
function dropLeft(items: readonly SwapItem[], left: readonly string[]): SwapItem[] {
  return items.filter((item) => item.phase === 'in' || !left.includes(item.key))
}

/** False inside content that is leaving. */
const SwapShowingContext = createContext(true)

/**
 * Whether the content around it is leaving, so a part that registers itself
 * somewhere, such as one of ui-sdk's, can draw a still copy instead and leave
 * its place to the content that replaced it.
 */
function useSwapLeaving() {
  return !use(SwapShowingContext)
}

/**
 * Content as it last showed: what leaves keeps what it said at the end, as
 * content under one `id` (a line with a bar that grows) changes while it shows.
 * Text truncates on its line, or in a block, whose height follows its
 * content, wraps onto as many as it needs.
 */
function SwapHeld({
  showing,
  wrap,
  children,
}: {
  showing: boolean
  wrap: boolean
  children: ReactNode
}) {
  const [held, setHeld] = useState(children)
  if (showing && held !== children) setHeld(children)
  return (
    <SwapShowingContext value={showing}>
      {heldParts(showing ? children : held, wrap)}
    </SwapShowingContext>
  )
}

function heldParts(children: ReactNode, wrap: boolean) {
  return flattenChildren(children).map((child, index) =>
    typeof child === 'string' || typeof child === 'number' ? (
      wrap ? (
        // oxlint-disable-next-line react/no-array-index-key -- the parts of one piece of content keep their order
        <span key={index} className='min-w-0'>
          {child}
        </span>
      ) : (
        // oxlint-disable-next-line react/no-array-index-key -- the parts of one piece of content keep their order
        // A label a `CutTooltip` around it can measure.
        <span key={index} data-cut className='min-w-0 truncate'>
          {child}
        </span>
      )
    ) : (
      child
    ),
  )
}

// An icon that changes rolls: the old one leaves upwards and the new one rises
// from below, fading as it goes. The travel is a share of the button's own
// height, the share Greg picked in the playground (about 20px for a default
// button at Balanced), so a small button's icon never leaves it empty. Outside
// a button it is a share of the control height.
const swapIconClassName =
  'shrink-0 overflow-x-clip [--swap-default-roll:calc(var(--button-height,var(--control-height))*0.55)] [--swap-default-scale:0.8]'

/**
 * A box whose content changes. When the children change (see `contentKey`),
 * the old ones fade out, the new ones fade in, and the box's width follows.
 * Content that comes back while it leaves turns round from where it is.
 * `--swap-scale` and `--swap-blur` set how far what changes shrinks and blurs,
 * `--swap-roll` how far it rolls with `roll` and `--swap-slide` how far it
 * slides with `slide` and `--swap-zoom` how far it scales with `zoom`, on the box or anything above it; `--swap-gap` is the space between its parts.
 */
function Swap({
  children,
  align = 'center',
  bleed = false,
  roll = false,
  slide,
  zoom,
  id: idProp,
  className,
  fill = false,
  block = false,
  wait = false,
}: {
  children?: ReactNode
  /** Where content that is leaving sits in the box while the width changes. */
  align?: keyof typeof swapAlignment
  /**
   * Lets the box reach into its parent's padding, where content wider than
   * the box fades out while the width catches up, in place of a hard cut.
   */
  bleed?: boolean
  /** Rolls the content vertically, `--swap-roll` far, in place of fading it where it is. */
  roll?: boolean
  /**
   * Slides the content sideways, `--swap-slide` far, the way the change
   * travels: 1 forward, as to a next month, -1 back. Set it with each change.
   */
  slide?: 1 | -1
  /**
   * Scales the content the way the change goes, `--swap-zoom` far: `out` to
   * a wider view, as from days to months, or `in` to a closer one. Set it
   * with each change.
   */
  zoom?: 'in' | 'out'
  /**
   * What the content is, when it says so better than the content itself: a
   * line holding a progress bar is the same line while its value climbs, and
   * a month whose picked day moves is still that month. Content under one
   * `id` updates in place; a new `id` swaps it.
   */
  id?: string
  className?: string
  /** Takes its parent's width and stretches its content across it, such as a line with a bar that grows. */
  fill?: boolean
  /**
   * Holds a block of content, such as a month's grid: what leaves stays
   * where it was, from the top, and the box's height moves to the new
   * content's on `layout`, so what sits below follows instead of jumping.
   */
  block?: boolean
  /**
   * Holds what arrives until what leaves has mostly gone, sliding or not,
   * for content too large to read over itself, such as a form's steps.
   */
  wait?: boolean
}) {
  const ref = useRef<HTMLSpanElement>(null)
  const refs = useMemo(() => mergeRefs(ref, markMounted), [])
  const id = idProp ?? contentKey(children)
  const [stored, setStored] = useState<{ id: string; items: SwapItem[] }>(() => ({
    id,
    items: [{ key: id, node: children, phase: 'in', fresh: false }],
  }))
  let { items } = stored
  if (stored.id !== id) {
    items = swapTo(items, id, children, slide, zoom)
    setStored({ id, items })
  }

  const leaving = items.filter((item) => item.phase === 'out').map((item) => item.key)
  useSettled(ref, leaving.length > 0 ? JSON.stringify(leaving) : '', () => {
    setStored((latest) => ({
      ...latest,
      items: dropLeft(latest.items, leaving),
    }))
  })

  const lastWidth = useLastWidth(ref)
  useLayoutEffect(() => {
    const element = ref.current
    const from = lastWidth.current
    if (!element || from === null || fill) return
    const padding = Number.parseFloat(getComputedStyle(element).paddingInlineStart) * 2
    for (const content of element.querySelectorAll<HTMLElement>(
      ':scope > [data-phase] > [data-slot=swap-content]',
    )) {
      const current = content.parentElement?.dataset.phase === 'in'
      // Content that leaves keeps the width it had, so text stays truncated
      // where it was and a row that wraps keeps its lines: the box's last
      // width at rest, or mid-move the width it was held at. Rounded up to
      // the whole pixel, since the box's width can fall a hair short of its
      // content's, and a row that wraps would break a line.
      if (current) content.style.maxWidth = ''
      else if (!content.style.maxWidth) {
        const held = Number.parseFloat(element.style.getPropertyValue('--swap-width'))
        const width = element.style.width && Number.isFinite(held) ? held : from
        content.style.maxWidth = `${Math.ceil(width - padding)}px`
      }
    }
    let to = 0
    withoutTransition(element, () => {
      releaseWidth(element)
      to = layoutWidth(element)
    })
    if (Math.abs(to - from) >= 0.5) animateWidth(element, from, to)
  }, [id, lastWidth, fill])

  // After the width, whose measuring would otherwise cut the height's move short.
  const lastHeight = useLastHeight(ref, block)
  useLayoutEffect(() => {
    const element = ref.current
    const from = lastHeight.current
    if (!element || from === null || !block) return
    let to = 0
    // Only the height stops to be measured: the width's move, just started, runs on.
    withoutTransition(
      element,
      () => {
        element.style.height = ''
        to = element.offsetHeight
      },
      { properties: ['height'] },
    )
    if (Math.abs(to - from) < 0.5) return
    // Clipped only while the height moves, so what leaves never shows past
    // the box as it shrinks, and a focus ring at its edge stays whole at rest.
    element.dataset.resizingHeight = ''
    void animateSize(element, 'height', from, to).then((latest) => {
      if (!latest) return
      element.style.height = ''
      delete element.dataset.resizingHeight
    })
  }, [id, lastHeight, block])

  return (
    <span
      ref={refs}
      data-slot='swap'
      className={cn(
        // Content that changes before the first paint has settled, such as an
        // icon that follows a saved theme once the page hydrates, takes its
        // place at once: nothing moves on load.
        'not-data-mounted:*:transition-none',
        // A box's width while it moves is its own: one inside another (a
        // button's icon in a moving label) never takes its parent's.
        '[--swap-shrink:initial] [--swap-width:initial]',
        fill ? 'flex w-full' : 'inline-flex',
        block
          ? 'transition-[width,height] duration-(--motion-layout-duration) ease-(--motion-layout-easing) data-resizing-height:overflow-y-clip motion-reduce:transition-none'
          : 'transition-[width] duration-(--motion-layout-duration) ease-(--motion-layout-easing) motion-reduce:transition-none',
        // A block sits at the top, as what leaves it does, while the height moves.
        block ? 'items-start' : 'items-center',
        'relative min-w-0 [--swap-default-roll:0.75em] [--swap-default-scale:0.97] [--swap-default-slide:1rem]',
        bleed
          ? '-mx-(--swap-bleed) px-(--swap-bleed) [--swap-bleed:--spacing(2)] data-resizing:[mask-image:linear-gradient(to_right,transparent,black_var(--swap-bleed),black_calc(100%-var(--swap-bleed)),transparent)] data-resizing:[mask-repeat:repeat-y] data-resizing:[mask-clip:no-clip]'
          : '[--swap-bleed:0px]',
        swapAlignment[align],
        className,
      )}
    >
      {items.map((item) => {
        const current = item.key === id
        return (
          <span
            key={item.key}
            data-phase={item.phase}
            data-fresh={item.fresh ? '' : undefined}
            data-back={item.phase === 'out' && item.back ? '' : undefined}
            data-side={item.side ? (item.side === 1 ? 'end' : 'start') : undefined}
            data-depth={item.depth}
            data-returned={item.returned ? '' : undefined}
            aria-hidden={current ? undefined : true}
            // A control on its way out, such as a button, can't take focus.
            inert={!current}
            className={cn(
              current
                ? fill
                  ? 'flex w-full min-w-0'
                  : 'inline-flex w-[calc(var(--swap-width)-var(--swap-bleed)*2)] min-w-0 shrink-[var(--swap-shrink,1)]'
                : block
                  ? 'pointer-events-none absolute inset-x-0 top-0 flex items-start px-(--swap-bleed)'
                  : 'pointer-events-none absolute inset-0 flex items-center px-(--swap-bleed)',
              !current && swapAlignment[align],
              swapItemMotion,
              // An item keeps its slide when a change with none comes mid-way, so it turns from where it is.
              roll ? swapRoll : item.side ? swapSlide : swapWait,
              wait && swapWaitLonger,
              swapZoom,
            )}
          >
            <span
              data-slot='swap-content'
              className={cn(
                'inline-flex items-center gap-(--swap-gap)',
                fill ? 'w-full min-w-0' : current ? 'min-w-0' : 'w-max shrink-0',
              )}
            >
              <SwapHeld showing={current} wrap={block}>
                {current ? children : item.node}
              </SwapHeld>
            </span>
          </span>
        )
      })}
    </span>
  )
}

interface SwapTextPart {
  key: number
  text: string
  phase: 'in' | 'out'
  /** Arrived with a change, so it fades in. */
  fresh: boolean
  /** Put in already leaving, so it starts fully shown and fades out. */
  seeded: boolean
}

interface SwapTextView {
  text: string
  prefix: string
  suffix: string
  parts: SwapTextPart[]
  next: number
}

function nextView(view: SwapTextView, text: string): SwapTextView {
  const { prefix, suffix, was, now } = seam(view.text, text)
  // Back across the same seam: the letters still leaving turn round.
  if (prefix === view.prefix && suffix === view.suffix && view.parts.length > 0) {
    const parts = view.parts.map((part): SwapTextPart => ({
      ...part,
      phase: part.text === now ? 'in' : 'out',
    }))
    if (parts.some((part) => part.phase === 'in')) return { ...view, text, parts }
    parts.push({
      key: view.next,
      text: now,
      phase: 'in',
      fresh: true,
      seeded: false,
    })
    return { ...view, text, parts, next: view.next + 1 }
  }
  return {
    text,
    prefix,
    suffix,
    parts: [
      { key: view.next, text: was, phase: 'out', fresh: false, seeded: true },
      {
        key: view.next + 1,
        text: now,
        phase: 'in',
        fresh: true,
        seeded: false,
      },
    ],
    next: view.next + 2,
  }
}

/** Whether a `SwapText` cut short gives its whole text as a `title`: not inside a `CutTooltip`, which shows it. */
const SwapTextTitleContext = createContext(true)

type SwapTextMove = { text: string; from: number; to: number }

/** Who measures in a stack, and its last move. */
function swapTextStack() {
  let lead: string | null = null
  let last: SwapTextMove | null = null
  return {
    /** Leads the stack if no one does yet. */
    join: (id: string) => {
      lead ??= id
    },
    leave: (id: string) => {
      if (lead === id) lead = null
    },
    /** The lead's own move, or for the others, the lead's move to the same text. */
    move: (id: string, own: SwapTextMove): SwapTextMove => {
      if (lead === id) last = own
      return last?.text === own.text ? last : own
    },
  }
}

const SwapTextStackContext = createContext<ReturnType<typeof swapTextStack> | null>(null)

/** Copies of one text laid over each other: the first `SwapText` inside measures each change and the rest move with it. */
function SwapTextStack({ children }: { children: ReactNode }) {
  const [stack] = useState(swapTextStack)
  return <SwapTextStackContext value={stack}>{children}</SwapTextStackContext>
}

function currentPart(middle: Element | null): Element | null {
  return middle?.querySelector(':scope > [data-phase=in]') ?? null
}

function isTruncated(...elements: (Element | null | undefined)[]): boolean {
  return elements.some((element) => element && element.scrollWidth > element.clientWidth)
}

/**
 * Text that keeps what two values share. From "Save changes" to "Saved",
 * "Save" stays put, " changes" fades out and "d" fades in, and the width
 * between them follows. Text too long for its box truncates, with the whole
 * text as its `title`, or inside a `CutTooltip` in its tooltip: it says
 * whether it is cut with `data-cut`.
 */
function SwapText({ text, className }: { text: string; className?: string }) {
  const rootRef = useRef<HTMLSpanElement>(null)
  const prefixRef = useRef<HTMLSpanElement>(null)
  const middleRef = useRef<HTMLSpanElement>(null)
  const suffixRef = useRef<HTMLSpanElement>(null)
  const [stored, setStored] = useState<SwapTextView>(() => ({
    text,
    prefix: text,
    suffix: '',
    parts: [],
    next: 0,
  }))
  let view = stored
  if (stored.text !== text) {
    view = nextView(stored, text)
    setStored(view)
  }
  const split = view.parts.length > 0

  // Text that fits stays split once it has changed: joining it would re-kern
  // the seam and nudge the letters a fraction of a pixel.
  useSettled(middleRef, split ? text : '', () => {
    const truncated = isTruncated(prefixRef.current, currentPart(middleRef.current))
    setStored((latest) => {
      if (latest.text !== text) return latest
      return truncated
        ? { ...latest, prefix: text, suffix: '', parts: [] }
        : {
            ...latest,
            parts: latest.parts.filter((part) => part.phase === 'in'),
          }
    })
  })

  const [truncated, setTruncated] = useState(false)
  const titled = use(SwapTextTitleContext)
  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const observer = new ResizeObserver(() => {
      setTruncated(isTruncated(prefixRef.current, currentPart(middleRef.current)))
    })
    observer.observe(root)
    return () => observer.disconnect()
  }, [view])

  // The first in a stack to mount leads it; layout effects run in tree order.
  const self = useId()
  const stack = use(SwapTextStackContext)
  useLayoutEffect(() => {
    if (!stack) return
    stack.join(self)
    return () => stack.leave(self)
  }, [stack, self])

  const lastWidth = useLastWidth(rootRef)
  useLayoutEffect(() => {
    const middle = middleRef.current
    const total = lastWidth.current
    if (!middle || !prefixRef.current || !suffixRef.current || total === null) return
    const [prefix, suffix] = [prefixRef.current, suffixRef.current]
    let to = 0
    let from = 0
    withoutTransition(middle, () => {
      releaseWidth(middle)
      to = layoutWidth(middle)
      from = Math.max(0, total - layoutWidth(prefix) - layoutWidth(suffix))
    })
    if (stack) ({ from, to } = stack.move(self, { text, from, to }))
    if (Math.abs(to - from) >= 0.5) animateWidth(middle, from, to)
  }, [text, lastWidth, stack, self])

  return (
    <span
      ref={rootRef}
      // Its own direction, so a label keeps its letter order in a page that reads the other way.
      dir='auto'
      data-slot='swap-text'
      title={truncated && titled ? text : undefined}
      data-cut={truncated ? 'cut' : 'whole'}
      className={cn('inline-flex min-w-0 items-center whitespace-pre', className)}
    >
      {/* Read as one piece of text: the pieces below would be read with a space at each seam. */}
      {split ? <span className='sr-only'>{text}</span> : null}
      <span
        ref={prefixRef}
        aria-hidden={split || undefined}
        className={cn('overflow-hidden text-ellipsis', split ? 'shrink-0' : 'min-w-0')}
      >
        {view.prefix}
      </span>
      <span
        ref={middleRef}
        aria-hidden={split || undefined}
        className='relative inline-flex min-w-0 self-stretch overflow-x-clip transition-[width] duration-(--motion-layout-duration) ease-(--motion-layout-easing) [--swap-default-scale:1] motion-reduce:transition-none'
      >
        {view.parts.map((part) => (
          <span
            key={part.key}
            data-phase={part.phase}
            data-fresh={part.fresh ? '' : undefined}
            data-seeded={part.seeded ? '' : undefined}
            className={cn(
              part.phase === 'in'
                ? 'w-[var(--swap-width,auto)] min-w-0 shrink-[var(--swap-shrink,1)] overflow-hidden text-ellipsis'
                : 'pointer-events-none absolute inset-y-0 start-0 flex items-center',
              swapItemMotion,
              swapWait,
              'data-seeded:starting:opacity-100 data-seeded:starting:blur-none',
            )}
          >
            {part.text}
          </span>
        ))}
      </span>
      <span ref={suffixRef} aria-hidden={split || undefined} className='shrink-0'>
        {view.suffix}
      </span>
    </span>
  )
}

/**
 * An icon that rolls to `onIcon` when something turns on, such as a pressed
 * toggle or a picked tab, and back when it turns off.
 */
function SwapIcon({
  on,
  onIcon,
  slot,
  clip = false,
  children,
}: {
  on: boolean
  onIcon: ReactNode
  /**
   * The `data-slot` of the icon's box, such as `segmented-control-icon`, when
   * no part around it, such as ui-sdk's `ToggleIcon`, carries one.
   */
  slot?: string
  /**
   * Clips the roll at the icon's own box, for an icon with more beside it
   * than a control's edge, such as a line of text below in a taller row.
   */
  clip?: boolean
  children: ReactNode
}) {
  return (
    <Swap roll className={cn(swapIconClassName, clip && 'overflow-y-clip')}>
      <span key={on ? 'on' : 'off'} data-slot={slot} className='flex'>
        {on ? onIcon : children}
      </span>
    </Swap>
  )
}

/**
 * Focus that follows what a Swap brings in. Call the function it gives
 * before a change, then, once the change has rendered with a new `key`, the
 * first `[data-focus-target]` in `root` outside what is leaving (which is
 * inert) takes focus. With no argument it follows only when focus was inside
 * `root`, so it never pulls focus in from elsewhere. A change nobody called
 * it for, such as new data from the page, follows too when focus was on what
 * leaves, which would otherwise drop it to the page; `false` keeps it where
 * it is.
 */
function useSwapFocus(root: RefObject<HTMLElement | null>, key: unknown) {
  // Whether the next change follows, when it was asked; null to follow focus that is leaving.
  const moving = useRef<boolean | null>(null)
  useLayoutEffect(() => {
    const asked = moving.current
    moving.current = null
    const active = document.activeElement
    const leaving =
      active !== null &&
      (root.current?.contains(active) ?? false) &&
      active.closest('[inert]') !== null
    if (!(asked ?? leaving)) return
    const targets = root.current?.querySelectorAll<HTMLElement>('[data-focus-target]')
    Array.from(targets ?? [])
      .find((target) => !target.closest('[inert]'))
      ?.focus()
  }, [key, root])
  return useCallback(
    (follow?: boolean) => {
      moving.current = follow ?? root.current?.contains(document.activeElement) ?? false
    },
    [root],
  )
}

export {
  SwapTextStack,
  swapTextStack,
  SwapTextTitleContext,
  contentKey,
  fullPixels,
  dropLeft,
  flattenChildren,
  graphemes,
  nextView,
  seam,
  Swap,
  SwapIcon,
  swapIconClassName,
  swapTo,
  SwapText,
  useSwapFocus,
  useSwapLeaving,
}
export type { SwapItem, SwapTextView }
