'use client'

import { reducesMotion } from '@/registry/lib/reduce-motion'
import {
  FOLLOWS_TRANSITION,
  roleDuration,
  withoutTransition,
} from '@/registry/lib/resize'
import {
  scrollRegionRingClassName,
  useEdgeFades,
  useScrollRegion,
} from '@/registry/lib/scroll'
import {
  Children,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react'

import { cn } from '@/lib/utils'

/*
 * Rows that drift sideways forever, at an even pace the feel sets: the
 * Testimonials marquee's quotes and the Logo cloud's logos. A row is its
 * items, then copies of them, as many as fill it, so the drift never runs
 * out, and one copy before them, so the first item can come clear of the
 * faded start; the copies are hidden from screen readers and can't take focus.
 *
 * A row holds still while it is out of view, and while its caller's `hold`
 * says so (the `hold` lib: the pointer is over the rows, a finger presses
 * them or an item has focus),
 * and an item that takes focus comes clear of the faded ends. Under reduced
 * motion a row stands still and scrolls sideways instead, so every item is
 * still in reach.
 *
 *   const hold = useHold()
 *   <div {...hold.handlers}>
 *     <MarqueeRow label='Customers' running={hold.running} driftVariable='--logo-cloud-drift'>
 *       {logos}
 *     </MarqueeRow>
 *   </div>
 */

/**
 * One row: its items, drifting the way the page reads, or back with
 * `reverse`. `driftVariable` names the CSS variable a buyer sets the pace
 * with, in rem per `layout` duration, such as `--testimonials-drift`.
 */
function MarqueeRow({
  label,
  reverse = false,
  running,
  driftVariable,
  trackClassName,
  children,
}: {
  /** Names the row for a screen reader when it stands still and scrolls. */
  label: string
  reverse?: boolean
  running: boolean
  driftVariable: `--${string}`
  /** The gap between the items and the room at the row's ends. */
  trackClassName?: string
  children: ReactNode
}) {
  const labelId = useId()
  const viewportRef = useRef<HTMLDivElement>(null)
  const shiftRef = useRef<HTMLDivElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const copyRef = useRef<HTMLDivElement>(null)
  const leadRef = useRef<HTMLDivElement>(null)
  const fades = useEdgeFades<HTMLDivElement>()
  const [copies, setCopies] = useState(1)
  const { control, still } = useDrift(
    { viewportRef, shiftRef, trackRef, copyRef, leadRef },
    { reverse, running, driftVariable, setCopies },
  )
  // Standing still, it scrolls, so it takes focus as a region a keyboard can scroll.
  const region = useScrollRegion(viewportRef, {
    axis: 'x',
    labelledBy: useCallback(() => labelId, [labelId]),
  })

  useEffect(() => {
    control.current?.(running)
  }, [control, running])

  return (
    <div className={cn('min-w-0', scrollRegionRingClassName)}>
      <span id={labelId} hidden>
        {label}
      </span>
      <div
        ref={(node) => {
          viewportRef.current = node
          return fades(node)
        }}
        data-slot='marquee-row'
        {...(still ? region : undefined)}
        onFocus={(event) => {
          // Held at once, before React renders, so the item stays where it is brought.
          control.current?.(false)
          // Standing still, the row scrolls the item into view itself.
          if (!still && event.target.matches(':focus-visible')) bringClear(event.target)
        }}
        className={cn(
          // While it drifts it is clipped and fades at both ends. Standing still it
          // scrolls instead, and an end fades only while there is more past it.
          'scrollbar-thin overflow-x-clip [--marquee-fade:min(6rem,12%)] [mask-image:linear-gradient(to_right,transparent,black_var(--marquee-fade),black_calc(100%-var(--marquee-fade)),transparent)] focus-visible:outline-hidden motion-reduce:overflow-x-auto motion-reduce:[mask-image:linear-gradient(to_right,transparent,black_var(--scroll-fade-left,0px),black_calc(100%-var(--scroll-fade-right,0px)),transparent)]',
        )}
      >
        {/* Moves an item that takes focus clear of the faded ends, on `layout`. */}
        <div
          ref={shiftRef}
          data-slot='marquee-shift'
          className='w-max transition-[translate] duration-(--motion-layout-duration) ease-(--motion-layout-easing) motion-reduce:transition-none'
        >
          <div
            ref={trackRef}
            role='list'
            className={cn('relative flex w-max', trackClassName)}
          >
            <Items>{children}</Items>
            <div
              ref={copyRef}
              data-slot='marquee-copy'
              aria-hidden
              inert
              // The track's gap between its copies too, so every item stands the same distance apart.
              className='flex gap-[inherit] motion-reduce:hidden'
            >
              {Array.from({ length: copies }, (_, copy) => (
                <Items key={copy}>{children}</Items>
              ))}
            </div>
            {/* A set's length before the items, where the drift places it. */}
            <div
              ref={leadRef}
              data-slot='marquee-copy'
              aria-hidden
              inert
              className='absolute inset-y-0 flex items-[inherit] gap-[inherit] py-[inherit] motion-reduce:hidden'
            >
              <Items>{children}</Items>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/** Each item as an item of the row's list, standing its own size. */
function Items({ children }: { children: ReactNode }) {
  return Children.map(children, (child) => (
    <div role='listitem' className='flex shrink-0'>
      {child}
    </div>
  ))
}

/** Items dealt into `rows` rows in turn, as cards are dealt: the first to the first row, the second to the second. */
function dealRows<Item>(items: readonly Item[], rows: number): Item[][] {
  const count = Math.min(rows, items.length)
  return Array.from({ length: count }, (_, row) =>
    items.filter((_, index) => index % count === row),
  )
}

/** How many copies of a row's items fill it, so the drift never shows an empty end: at least one. */
function copiesToFill(rowWidth: number, setWidth: number) {
  if (!(setWidth > 0)) return 1
  return Math.max(1, Math.ceil(rowWidth / setWidth))
}

/** How far a row drifts in one `layout` duration, in rem: about 30px a second in the default feel. */
const DRIFT_REM = 1.25

/**
 * A row's drift: a Web Animation that moves the track by one set of its
 * items, linearly and forever, so the copy behind lands where the items
 * began. One set takes as many `layout` durations as it holds drifts, so the
 * feel sets its pace, and it is rebuilt from where it was when the feel, the
 * reduced motion or the row's width changes. It plays while `running`, and
 * holds while the row is out of view; under reduced motion it stands still.
 * It plays in step with the page's transitions (`FOLLOWS_TRANSITION`), so a
 * tool that slows them slows it too.
 */
function useDrift(
  {
    viewportRef,
    shiftRef,
    trackRef,
    copyRef,
    leadRef,
  }: Record<
    'viewportRef' | 'shiftRef' | 'trackRef' | 'copyRef' | 'leadRef',
    RefObject<HTMLDivElement | null>
  >,
  {
    reverse,
    running,
    driftVariable,
    setCopies,
  }: {
    reverse: boolean
    running: boolean
    driftVariable: string
    setCopies: (copies: number) => void
  },
) {
  const control = useRef<((play: boolean) => void) | null>(null)
  const runningRef = useRef(running)
  useEffect(() => {
    runningRef.current = running
  })
  const [still, setStill] = useState(false)
  useEffect(() => {
    const viewport = viewportRef.current
    const shift = shiftRef.current
    const track = trackRef.current
    const copy = copyRef.current
    const lead = leadRef.current
    if (!viewport || !shift || !track || !copy || !lead) return
    let animation: Animation | null = null
    // The way the row lays out, read where it stands, so it follows `dir` however it is set.
    let rtl = false
    let wanted = runningRef.current
    let seen = false
    const apply = () => {
      if (!animation) return
      if (wanted && seen) {
        settleShift(animation, shift, track, rtl)
        animation.play()
      } else animation.pause()
    }
    const build = () => {
      const progress = animation ? progressOf(animation) : 0
      animation?.cancel()
      animation = null
      rtl = isRtl(viewport)
      const reduced = reducesMotion(viewport)
      setStill(reduced)
      if (reduced) return
      const length = setWidth(track, copy, rtl)
      setCopies(copiesToFill(viewport.clientWidth, length))
      lead.style.insetInlineStart = `${firstOffset(track, rtl) - length}px`
      const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize)
      const drift =
        (Number.parseFloat(getComputedStyle(viewport).getPropertyValue(driftVariable)) ||
          DRIFT_REM) * rem
      const duration = roleDuration(viewport, 'layout') * (length / drift)
      // No role's timing where it stands, such as outside a Kino theme: it stands still.
      if (!(duration > 0)) return
      animation = track.animate(
        [{ translate: '0 0' }, { translate: `${rtl ? length : -length}px 0` }],
        {
          id: FOLLOWS_TRANSITION,
          duration,
          iterations: Infinity,
          easing: 'linear',
          direction: reverse ? 'reverse' : 'normal',
        },
      )
      animation.currentTime = progress * duration
      apply()
    }
    build()
    const resize = new ResizeObserver(build)
    resize.observe(track)
    resize.observe(viewport)
    const sight = new IntersectionObserver(([entry]) => {
      seen = entry.isIntersecting
      apply()
    })
    sight.observe(viewport)
    // A feel, a motion preference or a direction set anywhere on the page rebuilds it, as it restyles CSS.
    const preferences = new MutationObserver(build)
    preferences.observe(document.documentElement, {
      subtree: true,
      attributeFilter: ['data-feel', 'data-motion', 'dir'],
    })
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    media.addEventListener('change', build)
    control.current = (play) => {
      wanted = play
      apply()
    }
    return () => {
      control.current = null
      resize.disconnect()
      sight.disconnect()
      preferences.disconnect()
      media.removeEventListener('change', build)
      animation?.cancel()
    }
  }, [
    viewportRef,
    shiftRef,
    trackRef,
    copyRef,
    leadRef,
    reverse,
    driftVariable,
    setCopies,
  ])
  return { control, still }
}

/** One set of the items' length along the row: from the first item's start to the copies' start, gap included. */
function setWidth(track: HTMLElement, copy: HTMLElement, rtl: boolean) {
  const first = track.firstElementChild?.getBoundingClientRect()
  const copies = copy.getBoundingClientRect()
  if (!first) return 0
  return rtl ? first.right - copies.right : copies.left - first.left
}

/** How far the first item stands from the track's start, in px. */
function firstOffset(track: HTMLElement, rtl: boolean) {
  const first = track.firstElementChild?.getBoundingClientRect()
  const box = track.getBoundingClientRect()
  if (!first) return 0
  return rtl ? box.right - first.right : first.left - box.left
}

/** How far through its loop an animation is, from 0 to 1. */
function progressOf(animation: Animation) {
  const duration = Number(animation.effect?.getTiming().duration) || 0
  const time = Number(animation.currentTime) || 0
  if (!(duration > 0)) return 0
  return (time % duration) / duration
}

/** Whether a row lays out right to left. */
function isRtl(element: Element) {
  return getComputedStyle(element).direction === 'rtl'
}

/** An element's `translate` along the row, in px. */
function translateX(element: Element) {
  return Number.parseFloat(getComputedStyle(element).translate) || 0
}

/** A box along the row, in px. */
interface Box {
  start: number
  end: number
}

/**
 * How far to move a row so an item in it stands clear of the faded ends,
 * its start first when it can't clear both, and never so far that the track
 * leaves the row's end empty. Boxes are along the row, in px.
 */
function clearShift({
  row,
  track,
  item,
  fade,
  rtl,
}: {
  row: Box
  track: Box
  item: Box
  fade: number
  rtl: boolean
}) {
  const room = { start: row.start + fade, end: row.end - fade }
  let shift = 0
  // Start and end as the page reads: in right to left the start is on the right.
  const before = rtl ? item.end - room.end : room.start - item.start
  const after = rtl ? room.start - item.start : item.end - room.end
  if (before > 0) shift = rtl ? -before : before
  else if (after > 0) shift = rtl ? Math.min(after, -before) : -Math.min(after, -before)
  // The track must still cover the row from end to end.
  return Math.min(Math.max(shift, row.end - track.end), row.start - track.start)
}

/**
 * Brings an item that took focus clear of the row's faded ends: the row
 * holds while an item has focus, and the wrapper around its track glides by
 * the difference on `layout`. The item is the track's child that holds the
 * focus.
 */
function bringClear(target: Element) {
  const row = target.closest<HTMLElement>('[data-slot=marquee-row]')
  const shift = row?.querySelector<HTMLElement>('[data-slot=marquee-shift]')
  const track = shift?.firstElementChild
  const item = track ? [...track.children].find((child) => child.contains(target)) : null
  const lead = track?.lastElementChild
  if (!row || !shift || !track || !item || !lead) return
  const along = (box: DOMRect) => ({ start: box.left, end: box.right })
  const span = (a: Box, b: Box) => ({
    start: Math.min(a.start, b.start),
    end: Math.max(a.end, b.end),
  })
  const rowBox = along(row.getBoundingClientRect())
  // As `--marquee-fade` works it out: 6rem, or 12% of a narrow row.
  const fade = Math.min(
    Number.parseFloat(getComputedStyle(document.documentElement).fontSize) * 6,
    (rowBox.end - rowBox.start) * 0.12,
  )
  const by = clearShift({
    row: rowBox,
    // With the copy before the items, which covers the row's start as the drift would.
    track: span(
      along(track.getBoundingClientRect()),
      along(lead.getBoundingClientRect()),
    ),
    item: along(item.getBoundingClientRect()),
    fade,
    rtl: isRtl(row),
  })
  if (Math.abs(by) < 0.5) return
  shift.style.translate = `${translateX(shift) + by}px 0`
}

/**
 * As the drift plays again, takes the wrapper's shift into the drift's
 * clock, in one frame, so the row goes on from where it stands with no
 * offset left that could leave an end empty.
 */
function settleShift(
  animation: Animation,
  shift: HTMLElement,
  track: HTMLElement,
  rtl: boolean,
) {
  const by = translateX(shift)
  if (Math.abs(by) < 0.5) return
  const timing = animation.effect?.getTiming()
  const duration = Number(timing?.duration) || 0
  const length = Math.abs(
    Number.parseFloat(
      String((animation.effect as KeyframeEffect).getKeyframes().at(-1)?.translate),
    ),
  )
  if (!(duration > 0) || !(length > 0)) return
  // Where the track will stand, as a share of a set's length: 0 at the keyframes' start, 1 a set along.
  const value = translateX(track) + by
  const along = rtl ? value : -value
  const share = (((along % length) + length) % length) / length
  const progress = timing?.direction === 'reverse' ? 1 - share : share
  withoutTransition(shift, () => {
    shift.style.translate = ''
  })
  animation.currentTime = progress * duration
}

export { clearShift, copiesToFill, dealRows, MarqueeRow }
