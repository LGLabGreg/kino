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
import { SectionHeading } from '@/registry/lib/section-heading'
import {
  type Testimonial,
  TestimonialCard,
  testimonialsColumnClassName,
  type TestimonialsSectionProps,
  testimonialsSectionClassName,
} from '@/registry/lib/testimonial-parts'
import { type RefObject, useCallback, useEffect, useId, useRef, useState } from 'react'

import { cn } from '@/lib/utils'

/*
 * The quotes drift past in rows, each row the other way from the one above,
 * so a page full of praise reads at a glance. It holds still while the
 * pointer is over it, while a card has focus and while it is out of view,
 * and a card that takes focus comes clear of the faded ends. Under reduced
 * motion the rows stand still and scroll sideways instead, so every quote
 * is still in reach.
 *
 * Each row is its quotes, then copies of them, as many as fill the row, so
 * the drift never runs out; the copies are hidden from screen readers and
 * can't take focus.
 *
 *   <TestimonialsMarquee
 *     title='Teams plan their week in Kino'
 *     testimonials={[{ value: 'mei', quote: '…', name: 'Mei Lin', role: 'Head of Product', company: 'Tessel' }]}
 *   />
 */

interface TestimonialsMarqueeProps extends TestimonialsSectionProps {
  /** How many rows the quotes are dealt into. */
  rows?: 1 | 2 | 3
}

function TestimonialsMarquee({
  title,
  description,
  eyebrow,
  heading = 'h2',
  testimonials,
  rows = 2,
  className,
  ...props
}: TestimonialsMarqueeProps) {
  const titleId = useId()
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const dealt = dealRows(testimonials, rows)
  return (
    <section
      data-slot='testimonials-marquee'
      aria-labelledby={titleId}
      className={cn(testimonialsSectionClassName, className)}
      {...props}
    >
      <div className={cn(testimonialsColumnClassName, 'flex flex-col pb-10 @3xl:pb-14')}>
        <SectionHeading
          id={titleId}
          eyebrow={eyebrow}
          title={title}
          description={description}
          heading={heading}
        />
      </div>
      {/* The rows run the page's whole width, past the column, and fade at its edges. */}
      <div
        className='flex min-w-0 flex-col gap-4 pb-16 @3xl:pb-24'
        // A mouse holds it while over it; a finger or a pen while pressed on it, as there is no hover.
        onPointerEnter={(event) => event.pointerType === 'mouse' && setHovered(true)}
        onPointerDown={() => setHovered(true)}
        onPointerUp={(event) => event.pointerType !== 'mouse' && setHovered(false)}
        onPointerCancel={() => setHovered(false)}
        onPointerLeave={() => setHovered(false)}
        // Every row holds while a card has focus, so nothing moves while someone reads by keyboard.
        onFocus={() => setFocused(true)}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false)
        }}
      >
        {dealt.map((row, index) => (
          <MarqueeRow
            key={row.map((testimonial) => testimonial.value).join()}
            label={`Quotes, row ${index + 1} of ${dealt.length}`}
            testimonials={row}
            reverse={index % 2 === 1}
            running={!hovered && !focused}
          />
        ))}
      </div>
    </section>
  )
}

function MarqueeRow({
  label,
  testimonials,
  reverse,
  running,
}: {
  label: string
  testimonials: Testimonial[]
  reverse: boolean
  running: boolean
}) {
  const labelId = useId()
  const viewportRef = useRef<HTMLDivElement>(null)
  const shiftRef = useRef<HTMLDivElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const copyRef = useRef<HTMLDivElement>(null)
  const fades = useEdgeFades<HTMLDivElement>()
  const [copies, setCopies] = useState(1)
  const { control, still } = useDrift(
    { viewportRef, shiftRef, trackRef, copyRef },
    { reverse, running, setCopies },
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
        data-slot='testimonials-row'
        {...(still ? region : undefined)}
        onFocus={(event) => {
          // Held at once, before React renders, so the card stays where it is brought.
          control.current?.(false)
          if (event.target.matches(':focus-visible')) bringClear(event.target)
        }}
        className={cn(
          // While it drifts it is clipped and fades at both ends. Standing still it
          // scrolls instead, and an end fades only while there is more past it.
          'scrollbar-thin overflow-x-clip [--testimonials-fade:min(6rem,12%)] [mask-image:linear-gradient(to_right,transparent,black_var(--testimonials-fade),black_calc(100%-var(--testimonials-fade)),transparent)] focus-visible:outline-hidden motion-reduce:overflow-x-auto motion-reduce:[mask-image:linear-gradient(to_right,transparent,black_var(--scroll-fade-left,0px),black_calc(100%-var(--scroll-fade-right,0px)),transparent)]',
        )}
      >
        {/* Moves a card that takes focus clear of the faded ends, on `layout`. */}
        <div
          ref={shiftRef}
          data-slot='testimonials-shift'
          className='w-max transition-[translate] duration-(--motion-layout-duration) ease-(--motion-layout-easing) motion-reduce:transition-none'
        >
          <div
            ref={trackRef}
            className='flex w-max gap-4 px-(--surface-padding) py-1 @3xl/testimonials:px-10'
          >
            <Cards testimonials={testimonials} />
            <div
              ref={copyRef}
              data-slot='testimonials-copy'
              aria-hidden
              inert
              className='flex gap-4 motion-reduce:hidden'
            >
              {Array.from({ length: copies }, (_, copy) => (
                <Cards key={copy} testimonials={testimonials} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function Cards({ testimonials }: { testimonials: Testimonial[] }) {
  return testimonials.map((testimonial) => (
    <TestimonialCard
      key={testimonial.value}
      testimonial={testimonial}
      // Never wider than the room between the row's faded ends (each 12% of it), so a card with focus fits clear of them.
      className='w-[min(18rem,76cqw)] shrink-0 @md/testimonials:w-80'
    />
  ))
}

/** The quotes dealt into `rows` rows in turn, as cards are dealt: the first to the first row, the second to the second. */
function dealRows<Item>(items: readonly Item[], rows: number): Item[][] {
  const count = Math.min(rows, items.length)
  return Array.from({ length: count }, (_, row) =>
    items.filter((_, index) => index % count === row),
  )
}

/** How many copies of a row's quotes fill it, so the drift never shows an empty end: at least one. */
function copiesToFill(rowWidth: number, setWidth: number) {
  if (!(setWidth > 0)) return 1
  return Math.max(1, Math.ceil(rowWidth / setWidth))
}

/** How far a row drifts in one `layout` duration, in rem: about 30px a second in the default feel. */
const DRIFT_REM = 1.25

/**
 * A row's drift: a Web Animation that moves the track by one set of its
 * quotes, linearly and forever, so the copy behind lands where the quotes
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
  }: Record<
    'viewportRef' | 'shiftRef' | 'trackRef' | 'copyRef',
    RefObject<HTMLDivElement | null>
  >,
  {
    reverse,
    running,
    setCopies,
  }: {
    reverse: boolean
    running: boolean
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
    if (!viewport || !shift || !track || !copy) return
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
      const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize)
      const drift =
        (Number.parseFloat(
          getComputedStyle(viewport).getPropertyValue('--testimonials-drift'),
        ) || DRIFT_REM) * rem
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
  }, [viewportRef, shiftRef, trackRef, copyRef, reverse, setCopies])
  return { control, still }
}

/** One set of the quotes' length along the row: from the first card's start to the copies' start, gap included. */
function setWidth(track: HTMLElement, copy: HTMLElement, rtl: boolean) {
  const first = track.firstElementChild?.getBoundingClientRect()
  const copies = copy.getBoundingClientRect()
  if (!first) return 0
  return rtl ? first.right - copies.right : copies.left - first.left
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

/**
 * How far to move a row so a card in it stands clear of the faded ends,
 * its start first when it can't clear both, and never so far that the track
 * leaves the row's end empty. Boxes are along the row, in px.
 */
function clearShift({
  row,
  track,
  card,
  fade,
  rtl,
}: {
  row: { start: number; end: number }
  track: { start: number; end: number }
  card: { start: number; end: number }
  fade: number
  rtl: boolean
}) {
  const room = { start: row.start + fade, end: row.end - fade }
  let shift = 0
  // Start and end as the page reads: in right to left the start is on the right.
  const before = rtl ? card.end - room.end : room.start - card.start
  const after = rtl ? room.start - card.start : card.end - room.end
  if (before > 0) shift = rtl ? -before : before
  else if (after > 0) shift = rtl ? Math.min(after, -before) : -Math.min(after, -before)
  // The track must still cover the row from end to end.
  return Math.min(Math.max(shift, row.end - track.end), row.start - track.start)
}

/**
 * Brings a card that took focus clear of the row's faded ends: the row
 * holds while a card has focus, and the wrapper around its track glides by
 * the difference on `layout`.
 */
function bringClear(target: Element) {
  const card = target.closest('[data-slot=testimonial-card]')
  const row = target.closest<HTMLElement>('[data-slot=testimonials-row]')
  const shift = row?.querySelector<HTMLElement>('[data-slot=testimonials-shift]')
  const track = shift?.firstElementChild
  if (!card || !row || !shift || !track) return
  const along = (box: DOMRect) => ({ start: box.left, end: box.right })
  const rowBox = along(row.getBoundingClientRect())
  const fade = Math.min(
    Number.parseFloat(getComputedStyle(document.documentElement).fontSize) * 6,
    (rowBox.end - rowBox.start) * 0.12,
  )
  const by = clearShift({
    row: rowBox,
    track: along(track.getBoundingClientRect()),
    card: along(card.getBoundingClientRect()),
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

export {
  clearShift,
  copiesToFill,
  dealRows,
  TestimonialsMarquee,
  type TestimonialsMarqueeProps,
}
