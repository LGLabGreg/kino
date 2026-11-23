'use client'

import { reducesMotion } from '@/registry/lib/reduce-motion'
import { roleDuration, runningTransitions } from '@/registry/lib/resize'
import {
  type RefCallback,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useState,
} from 'react'

/*
 * What a box that scrolls shows about it: its edges fade while content is
 * hidden past them, as the Tabs' list, a wide Table and a Scroll area do, and
 * it takes focus while its content is larger than it, so the keyboard can
 * scroll it, as a panel's body and a Table do. And what moves as the page
 * scrolls past it, as the Hero's product shot does.
 */

const EDGE_FADE_PX = 24

/**
 * The nearest box that scrolls `element` up and down, or `null` when it's
 * the page: one whose overflow scrolls and whose content is taller than it.
 */
export function scrollerOf(element: Element): HTMLElement | null {
  for (let node = element.parentElement; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node)
    if (/(auto|scroll)/.test(overflowY) && node.scrollHeight > node.clientHeight)
      return node
  }
  return null
}

/** How much of the next item shows past one that scrolled into view, in pixels. */
const REVEAL_PEEK_PX = 32

/**
 * How wide each edge's fade is, in pixels, for a box scrolled `scrollLeft`
 * of `max`: only as wide as what is hidden past it, up to 24px. In right to
 * left the browser counts `scrollLeft` from 0 down to `-max`.
 */
export function edgeFades(scrollLeft: number, max: number, rtl: boolean) {
  const left = rtl ? max + scrollLeft : scrollLeft
  // A scroll position can rest a fraction of a pixel short of its end.
  const fade = (hidden: number) => (hidden <= 1 ? 0 : Math.min(hidden, EDGE_FADE_PX))
  return { left: fade(left), right: fade(max - left) }
}

/**
 * Each of a box's four edges' fade, in pixels, from its scroll position and
 * how far it can scroll each way. Right to left mirrors the sides only: a box
 * scrolls down from its top in either direction.
 */
export function boxEdgeFades(
  box: { scrollLeft: number; scrollTop: number; maxX: number; maxY: number },
  rtl: boolean,
) {
  const { left, right } = edgeFades(box.scrollLeft, box.maxX, rtl)
  const { left: top, right: bottom } = edgeFades(box.scrollTop, box.maxY, false)
  return { left, right, top, bottom }
}

/**
 * Writes each edge's fade on `scroller` as `<name>-left`, `<name>-right`,
 * `<name>-top` and `<name>-bottom` (`--tabs-fade-left`), for a mask to read,
 * its visible width as
 * `--scroller-width`, for what must stay in view as it scrolls sideways (a
 * caption), and marks it `data-scrolled`
 * while it is scrolled down from its top, for a sticky header to show it,
 * and `data-edge-start` and `data-edge-end` while content is hidden past
 * that side, with `<name>-start` and `<name>-end` as its fades, for a sticky
 * column to draw its edge and a mask to leave that side alone.
 * It follows the scroll and any change of size of the box or of `content`.
 * Returns a function that stops following.
 */
export function followEdges(
  scroller: HTMLElement,
  name: `--${string}`,
  content: Element | null = scroller.firstElementChild,
): () => void {
  const update = () => {
    const { left, right, top, bottom } = boxEdgeFades(
      {
        scrollLeft: scroller.scrollLeft,
        scrollTop: scroller.scrollTop,
        maxX: scroller.scrollWidth - scroller.clientWidth,
        maxY: scroller.scrollHeight - scroller.clientHeight,
      },
      getComputedStyle(scroller).direction === 'rtl',
    )
    scroller.style.setProperty(`${name}-left`, `${left}px`)
    scroller.style.setProperty(`${name}-right`, `${right}px`)
    scroller.style.setProperty(`${name}-top`, `${top}px`)
    scroller.style.setProperty(`${name}-bottom`, `${bottom}px`)
    scroller.style.setProperty('--scroller-width', `${scroller.clientWidth}px`)
    scroller.toggleAttribute('data-scrolled', scroller.scrollTop > 0)
    // Which sides hide content past them, for what is pinned to that side to draw an edge.
    const rtl = getComputedStyle(scroller).direction === 'rtl'
    scroller.toggleAttribute('data-edge-start', (rtl ? right : left) > 0)
    scroller.toggleAttribute('data-edge-end', (rtl ? left : right) > 0)
    scroller.style.setProperty(`${name}-start`, `${rtl ? right : left}px`)
    scroller.style.setProperty(`${name}-end`, `${rtl ? left : right}px`)
  }
  update()
  scroller.addEventListener('scroll', update, { passive: true })
  const resized = new ResizeObserver(update)
  resized.observe(scroller)
  if (content) resized.observe(content)
  return () => {
    scroller.removeEventListener('scroll', update)
    resized.disconnect()
  }
}

/**
 * The mask that fades a scroller's edges while content is hidden past them,
 * on the variables `useEdgeFades` writes. Its scroll padding is the fade's
 * width, so a row the keyboard brings into view stops clear of the fade.
 * It masks the whole box, so it goes on an inner scroller, never on a
 * surface with a shadow, a ring or an outline, and a scroller that takes
 * focus draws its ring on the box around it (`scrollRegionRingClassName`).
 */
export const edgeFadeClassName =
  'scroll-py-6 [mask-image:linear-gradient(to_right,transparent,black_var(--scroll-fade-left,0px),black_calc(100%-var(--scroll-fade-right,0px)),transparent),linear-gradient(to_bottom,transparent,black_var(--scroll-fade-top,0px),black_calc(100%-var(--scroll-fade-bottom,0px)),transparent)] [mask-composite:intersect]'

/** A ref for a scroller with `edgeFadeClassName`: its edges fade while there is more past them. */
export function useEdgeFades<Scroller extends HTMLElement>(): RefCallback<Scroller> {
  return useCallback(
    (scroller: Scroller | null) =>
      scroller ? followEdges(scroller, '--scroll-fade') : undefined,
    [],
  )
}

/**
 * The focus ring of a scroll region, for the box around it: drawn over the
 * region's content, which would cover a ring of its own, and inside the box,
 * which may clip what is outside. Forced colours draw it as an outline.
 */
export const scrollRegionRingClassName =
  'relative after:pointer-events-none after:absolute after:inset-0 after:z-40 after:rounded-[inherit] has-[>[role=region]:focus-visible]:after:ring-3 has-[>[role=region]:focus-visible]:after:ring-ring/50 has-[>[role=region]:focus-visible]:after:ring-inset forced-colors:has-[>[role=region]:focus-visible]:after:outline-2 forced-colors:has-[>[role=region]:focus-visible]:after:-outline-offset-2'

/** Whether a box's content is larger than the box, by more than a rounding error, either way. */
export function overflows(box: {
  scrollWidth: number
  clientWidth: number
  scrollHeight: number
  clientHeight: number
}) {
  return box.scrollWidth - box.clientWidth > 1 || box.scrollHeight - box.clientHeight > 1
}

/**
 * The props of a box while its content is larger than it: it takes focus,
 * or the keyboard couldn't scroll it, as a region named by the element whose
 * id `labelledBy` finds. `axis` is the way it scrolls. When it stops
 * scrolling while focused, focus moves to what `refocus` finds, so it isn't
 * lost.
 */
export function useScrollRegion(
  scrollerRef: RefObject<HTMLElement | null>,
  {
    contentRef,
    axis = 'y',
    labelledBy,
    refocus,
  }: {
    contentRef?: RefObject<HTMLElement | null>
    axis?: 'x' | 'y' | 'both'
    labelledBy: (scroller: HTMLElement) => string | null | undefined
    refocus?: (scroller: HTMLElement) => HTMLElement | null | undefined
  },
) {
  const [scrolls, setScrolls] = useState(false)
  const [labelId, setLabelId] = useState<string>()

  // Before the first paint, so it is there when a dialog picks what to focus.
  useLayoutEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller) return
    const measure = () => {
      const scrolls = overflows({
        scrollWidth: axis === 'y' ? scroller.clientWidth : scroller.scrollWidth,
        clientWidth: scroller.clientWidth,
        scrollHeight: axis === 'x' ? scroller.clientHeight : scroller.scrollHeight,
        clientHeight: scroller.clientHeight,
      })
      // It is about to lose its place in the tab order: focus stays nearby.
      if (!scrolls && document.activeElement === scroller) {
        refocus?.(scroller)?.focus({ preventScroll: true })
      }
      setScrolls(scrolls)
      setLabelId(labelledBy(scroller) ?? undefined)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(scroller)
    const content = contentRef?.current ?? scroller.firstElementChild
    if (content) observer.observe(content)
    return () => observer.disconnect()
  }, [scrollerRef, contentRef, axis, labelledBy, refocus])

  return scrolls
    ? ({ role: 'region', 'aria-labelledby': labelId, tabIndex: 0 } as const)
    : undefined
}

/** Frames with nothing moving before an element held at the top is let go. */
const SETTLE_FRAMES = 4

/**
 * The line an element held at the top of its scroller stops at, in the
 * viewport: the scroller's top, lowered by its `scroll-padding-top` (a sticky
 * header) and the element's `scroll-margin-top`, and `gap` more.
 */
export function topEdge(element: Element, gap = 0): number {
  const scroller = scrollerOf(element)
  return (
    (scroller ? scroller.getBoundingClientRect().top : 0) +
    topInset(element, scroller) +
    gap
  )
}

/**
 * How far below its scroller's top (the page's, without one) an element
 * scrolled to the top stops: the scroller's `scroll-padding-top`, for a
 * sticky header, and the element's `scroll-margin-top`, in pixels.
 */
export function topInset(element: Element, scroller: Element | null): number {
  return (
    (Number.parseFloat(
      getComputedStyle(scroller ?? document.documentElement).scrollPaddingTop,
    ) || 0) + (Number.parseFloat(getComputedStyle(element).scrollMarginTop) || 0)
  )
}

/**
 * Keeps `element` from rising past `line` while heights inside `watch` move,
 * as answers above it close: it rides up to the line and waits there while
 * its scroller scrolls under it. A scroll on its way to it goes on until the
 * element reaches the line. It lets go once nothing has moved for a few
 * frames. Kept outside components: the React Compiler drops the forced reads
 * written inside one.
 */
export function holdAtEdge(element: Element, watch: Element, line: number) {
  const scroller = scrollerOf(element)
  whileHeightsMove(watch, scroller, () => {
    if (!element.isConnected) return false
    const over = element.getBoundingClientRect().top - line
    if (over < -0.5) (scroller ?? window).scrollBy({ top: over, behavior: 'instant' })
    return true
  })
}

/** Whether a height transition runs on `watch` or inside it. */
export function heightsMoving(watch: Element) {
  return runningTransitions(watch, { property: 'height', subtree: true }).length > 0
}

/**
 * Calls `step` once a frame, from the next, while heights inside `watch`
 * move or `scroller` (the page, when null) scrolls, and stops once nothing
 * has moved for a few frames, or when `step` returns false. A step sees each
 * frame of a height transition, so what it keeps in place never lags one.
 * Returns a function that stops it sooner, and when it has stopped.
 */
export function whileHeightsMove(
  watch: Element,
  scroller: Element | null,
  step: () => boolean,
): { stop: () => void; stopped: Promise<void> } {
  const position = () => (scroller ? scroller.scrollTop : window.scrollY)
  let last = position()
  let quiet = 0
  let frame = 0
  let end = () => {}
  const stopped = new Promise<void>((resolve) => {
    end = resolve
  })
  const tick = () => {
    if (!step()) return end()
    const now = position()
    const moving = now !== last || heightsMoving(watch)
    last = now
    quiet = moving ? 0 : quiet + 1
    if (quiet < SETTLE_FRAMES) frame = requestAnimationFrame(tick)
    else end()
  }
  frame = requestAnimationFrame(tick)
  return {
    stop: () => {
      cancelAnimationFrame(frame)
      end()
    },
    stopped,
  }
}

/**
 * How far to scroll a row so an item shows with 32px of its neighbour, in
 * pixels (negative scrolls left); 0 when it already does. An item wider
 * than the row keeps its own start in view.
 */
export function revealBy(
  row: { left: number; right: number },
  item: { left: number; right: number },
) {
  const before = item.left - row.left - REVEAL_PEEK_PX
  const after = item.right - row.right + REVEAL_PEEK_PX
  const by = before < 0 ? before : after > 0 ? Math.min(after, before) : 0
  return Math.abs(by) < 1 ? 0 : by
}

/**
 * How far to scroll a list down (negative scrolls up) to bring an item in
 * sight: as `revealBy` does when some of it shows, so an item in view stays
 * put and one an edge or its fade cuts moves just clear of it, and to the
 * list's middle when none of it shows.
 */
export function bringIntoSightBy(
  list: { top: number; bottom: number },
  item: { top: number; bottom: number },
) {
  if (item.bottom <= list.top || item.top >= list.bottom)
    return (item.top + item.bottom) / 2 - (list.top + list.bottom) / 2
  return revealBy(
    { left: list.top, right: list.bottom },
    { left: item.top, right: item.bottom },
  )
}

/**
 * The scroll jumps when motion is reduced, by the device or by the motion
 * preference (`data-motion='reduce'`, as the `motion-reduce:` variant reads
 * it), or when the morph role takes no time: `instant`, never `auto`, which
 * would take a `scroll-behavior: smooth` set on the scroller.
 */
export function revealBehavior(scroller: HTMLElement): ScrollBehavior {
  const reduced =
    reducesMotion(scroller) || roleDuration(scroller, 'morph', Number.NaN) === 0
  return reduced ? 'instant' : 'smooth'
}

function reveal(scroller: HTMLElement, item: Element | null, behavior: ScrollBehavior) {
  if (!item || scroller.scrollWidth <= scroller.clientWidth) return
  const left = revealBy(scroller.getBoundingClientRect(), item.getBoundingClientRect())
  if (left !== 0) scroller.scrollBy({ left, behavior })
}

/**
 * For a row of items that outgrows its column, as the Tabs' list and a
 * range's two dates: fades the edges as `followEdges` does, and scrolls the
 * picked item (the one that gains `picked`, such as `data-active`) or the
 * focused one into view with a little of its neighbour, so the next can be
 * seen. Returns a function that stops following.
 */
export function revealInRow(
  scroller: HTMLElement,
  { item, picked, fade }: { item: string; picked?: string; fade: `--${string}` },
): () => void {
  const pickedNow = new MutationObserver((records) => {
    for (const { target } of records) {
      if (
        target instanceof Element &&
        picked &&
        target.matches(item) &&
        target.hasAttribute(picked)
      ) {
        reveal(scroller, target, revealBehavior(scroller))
      }
    }
  })
  if (picked)
    pickedNow.observe(scroller, {
      attributes: true,
      attributeFilter: [picked],
      subtree: true,
    })
  const focused = (event: FocusEvent) => {
    if (event.target instanceof Element) {
      reveal(scroller, event.target.closest(item), revealBehavior(scroller))
    }
  }
  scroller.addEventListener('focusin', focused)
  const stopEdges = followEdges(scroller, fade)
  if (picked) reveal(scroller, scroller.querySelector(`${item}[${picked}]`), 'instant')
  return () => {
    pickedNow.disconnect()
    stopEdges()
    scroller.removeEventListener('focusin', focused)
  }
}

/**
 * Where a scroll-linked move starts and ends, in px of scrolling: it starts
 * when the element's top is `from` of the way down the scroller's view (1 is
 * its bottom edge) and ends at `to`. A move that would start before the top
 * of the page starts there, so an element at the top of a page begins it from
 * its first state. Nothing, when the page can't scroll far enough for the
 * move to read as one.
 */
export function scrollLinkedRange({
  top,
  view,
  max,
  from,
  to,
}: {
  /** The element's top, in px from the start of the scroller's content. */
  top: number
  /** The scroller's visible height, in px. */
  view: number
  /** How far the scroller scrolls, in px. */
  max: number
  from: number
  to: number
}): { start: number; end: number } | null {
  if (max <= 0 || view <= 0) return null
  const start = Math.round(Math.min(max, Math.max(0, top - from * view)))
  const end = Math.round(Math.min(max, Math.max(0, top - to * view)))
  // Less than a tenth of a screen of scrolling would make it a jump.
  if (end - start < view * 0.1) return null
  return { start, end }
}

/**
 * A move that only slides, from `from` to `to` (each a translation in CSS
 * px), set on whole device pixels: both ends rounded to one at `ratio` device
 * pixels per CSS pixel, and how many steps of one device pixel the move takes
 * along its longer axis. A layer the compositor moves by a fraction of a
 * pixel is resampled and its text goes soft, so a slow drift steps from pixel
 * to pixel instead. Nothing when it doesn't move a whole pixel.
 */
export function pixelSteps(
  from: { x: number; y: number },
  to: { x: number; y: number },
  ratio: number,
): {
  from: { x: number; y: number }
  to: { x: number; y: number }
  steps: number
} | null {
  const snap = (value: number) => Math.round(value * ratio) / ratio
  const start = { x: snap(from.x), y: snap(from.y) }
  const end = { x: snap(to.x), y: snap(to.y) }
  const steps = Math.round(
    Math.max(Math.abs(end.x - start.x), Math.abs(end.y - start.y)) * ratio,
  )
  return steps > 0 ? { from: start, to: end, steps } : null
}

/** Where `frame` would put `element`, when all it does is slide it; otherwise `null`. */
function translationOf(element: HTMLElement, frame: Keyframe) {
  const probe = element.animate([frame], { fill: 'forwards' })
  const transform = getComputedStyle(element).transform
  probe.cancel()
  const matrix = new DOMMatrixReadOnly(transform === 'none' ? undefined : transform)
  const slides =
    matrix.is2D && matrix.a === 1 && matrix.b === 0 && matrix.c === 0 && matrix.d === 1
  return slides ? { x: matrix.e, y: matrix.f } : null
}

/** A move's keyframes, on whole device pixels when it only slides at the scroll's own rate. */
function keyframesOf(
  element: HTMLElement,
  start: Keyframe,
  end: Keyframe,
  easing: string,
  ratio: number,
): Keyframe[] {
  const from = easing === 'linear' ? translationOf(element, start) : null
  const to = from ? translationOf(element, end) : null
  const stepped = from && to ? pixelSteps(from, to, ratio) : null
  if (!stepped) return [{ ...start, easing }, { ...end }]
  const at = ({ x, y }: { x: number; y: number }) => `translate(${x}px, ${y}px)`
  return [
    {
      ...start,
      transform: at(stepped.from),
      // A level at each pixel from one end to the other, both ends included.
      easing: `steps(${stepped.steps + 1}, jump-none)`,
    },
    { ...end, transform: at(stepped.to) },
  ]
}

/** An element's top in the page, from layout alone, so a transform on it or above it doesn't move it. */
function pageTop(element: HTMLElement) {
  let top = 0
  for (
    let at: HTMLElement | null = element;
    at;
    at = at.offsetParent as HTMLElement | null
  ) {
    top += at.offsetTop
  }
  return top
}

/**
 * An element's top in its scroller's content, in pixels from the content's
 * start, from layout alone: the scroll position and any transform, such as
 * an entrance's rise, leave it where it is.
 */
export function contentTop(element: HTMLElement, scroller: HTMLElement) {
  return pageTop(element) - pageTop(scroller) - scroller.clientTop
}

/**
 * Moves `ref`'s element from `from` to `to` as the page scrolls it into
 * view, on the scroll itself, off the main thread: a scroll timeline on the
 * element that actually scrolls it, never the nearest box that clips, which
 * would hold a `view()` timeline still. The move is placed again only when
 * where it starts or ends changes, and follows a feel or a reduced-motion
 * preference set after load. Where the page can't scroll far enough for the
 * move, the element rests at `to`. Where motion is reduced, or the browser has
 * no scroll timelines, nothing moves it: it rests where its own CSS puts it, so
 * a starting pose set in CSS for the first paint sits under
 * `motion-safe:supports-[animation-timeline:scroll()]:`. A move that only
 * slides, at the scroll's own rate, steps from one device pixel to the next,
 * so the text in it stays sharp wherever the scroll stops.
 */
export function useScrollLinked(
  ref: RefObject<HTMLElement | null>,
  {
    from,
    to,
    range,
    pace = 'settle',
  }: {
    from: Keyframe
    to: Keyframe
    /** Where the element's top sits in the view, as a share down it, when the move starts and ends. */
    range: readonly [number, number]
    /**
     * How the move follows the scroll: `settle` on the `layout` role's curve
     * without its overshoot, quick at first and easing into place, or `even`,
     * at the scroll's own rate, for layers that drift at a depth.
     */
    pace?: 'settle' | 'even'
  },
) {
  const [rangeFrom, rangeTo] = range
  const fromKey = JSON.stringify(from)
  const toKey = JSON.stringify(to)
  useEffect(() => {
    const element = ref.current
    if (!element || typeof ScrollTimeline === 'undefined') return
    const start = JSON.parse(fromKey) as Keyframe
    const end = JSON.parse(toKey) as Keyframe
    let animation: Animation | undefined
    let placed = ''
    let frame = 0
    let watched = 0
    let resolution: MediaQueryList | undefined

    const place = () => {
      // A box that scrolls it, or else the page.
      const own = scrollerOf(element)
      const scroller = own ?? document.scrollingElement ?? document.documentElement
      const reduced = reducesMotion(element)
      const offsets = reduced
        ? null
        : scrollLinkedRange({
            top: own ? contentTop(element, own) : pageTop(element),
            view: scroller.clientHeight,
            max: scroller.scrollHeight - scroller.clientHeight,
            from: rangeFrom,
            to: rangeTo,
          })
      const easing =
        pace === 'even'
          ? 'linear'
          : getComputedStyle(element)
              .getPropertyValue('--motion-layout-fade-easing')
              .trim()
      // A screen of another density, or a zoom, moves the device pixels the move steps on.
      const ratio = window.devicePixelRatio || 1
      if (ratio !== watched) {
        watched = ratio
        resolution?.removeEventListener('change', schedule)
        resolution = window.matchMedia(`(resolution: ${ratio}dppx)`)
        resolution.addEventListener('change', schedule)
      }
      // Read again each time, so a distance set in a variable above it follows a change.
      const keyframes = reduced
        ? []
        : keyframesOf(element, start, end, easing || 'linear', ratio)
      const key = reduced
        ? 'reduced'
        : `${offsets && easing ? `${offsets.start} ${offsets.end}` : 'rest'} ${JSON.stringify(keyframes)}`
      const timeline = timelines.get(scroller)
      if (key === placed && (!offsets || animation?.timeline === timeline)) return
      placed = key
      animation?.cancel()
      animation = undefined
      if (reduced) return
      if (!offsets || !easing) {
        // Too little scroll for the move: it rests where it would end.
        animation = element.animate([keyframes.at(-1) ?? end], {
          fill: 'forwards',
        })
        return
      }
      // In scroll px, so content that grows below the element moves nothing.
      const rangeStart = `${offsets.start}px`
      const rangeEnd = `${offsets.end}px`
      animation = element.animate(keyframes, {
        timeline: timelineOf(scroller),
        rangeStart,
        rangeEnd,
        fill: 'both',
      })
    }
    // At most once a frame, however many changes arrive in it.
    const schedule = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(place)
    }

    place()
    // Where the move starts and ends shifts when anything changes size: the
    // window, the page or the element.
    const resizes = new ResizeObserver(schedule)
    resizes.observe(element)
    resizes.observe(document.body)
    // The view's own height changes without the page's size: a phone's
    // address bar, or a window made shorter.
    window.addEventListener('resize', schedule)
    // A feel or a reduced-motion preference can be set on any element above it.
    const preferences = new MutationObserver(schedule)
    preferences.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-feel', 'data-motion'],
      subtree: true,
    })
    // So can a variable the move reads, such as how far it goes. An observer of
    // its own: observing <html> again would replace the watch above.
    const variables = new MutationObserver(schedule)
    for (let above = element.parentElement; above; above = above.parentElement) {
      variables.observe(above, {
        attributes: true,
        attributeFilter: ['style', 'class'],
      })
    }
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
    motion.addEventListener('change', schedule)
    return () => {
      resizes.disconnect()
      window.removeEventListener('resize', schedule)
      preferences.disconnect()
      variables.disconnect()
      motion.removeEventListener('change', schedule)
      resolution?.removeEventListener('change', schedule)
      cancelAnimationFrame(frame)
      animation?.cancel()
    }
  }, [ref, fromKey, toKey, rangeFrom, rangeTo, pace])
}

/** One scroll timeline per scroller, shared by every move it drives. */
const timelines = new WeakMap<Element, ScrollTimeline>()

function timelineOf(scroller: Element) {
  let timeline = timelines.get(scroller)
  if (!timeline) {
    timeline = new ScrollTimeline({ source: scroller, axis: 'block' })
    timelines.set(scroller, timeline)
  }
  return timeline
}
