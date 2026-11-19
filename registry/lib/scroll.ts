'use client'

import { reducesMotion } from '@/registry/lib/reduce-motion'
import {
  type RefCallback,
  type RefObject,
  useCallback,
  useLayoutEffect,
  useState,
} from 'react'

/*
 * What a box that scrolls shows about it: its edges fade while content is
 * hidden past them, as the Tabs' list, a wide Table and a Scroll area do, and
 * it takes focus while its content is larger than it, so the keyboard can
 * scroll it, as a panel's body and a Table do.
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
 * it), or when the morph role takes no time.
 */
export function revealBehavior(scroller: HTMLElement): ScrollBehavior {
  const duration = getComputedStyle(scroller).getPropertyValue('--motion-morph-duration')
  const reduced = reducesMotion(scroller) || Number.parseFloat(duration) === 0
  return reduced ? 'auto' : 'smooth'
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
