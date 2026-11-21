'use client'

import { Button } from '@/registry/components/kino/button'
import { useControllable } from '@/registry/lib/controllable'
import { bringTopBack, useFoldMove } from '@/registry/lib/fold'
import { SectionHeading } from '@/registry/lib/section-heading'
import {
  TestimonialCard,
  testimonialsColumnClassName,
  type TestimonialsSectionProps,
  testimonialsSectionClassName,
} from '@/registry/lib/testimonial-parts'
import { type FocusEvent, useId, useLayoutEffect, useRef, useState } from 'react'

import { cn } from '@/lib/utils'

/*
 * Every quote in view at once, on cards in columns that read down, so long
 * and short quotes pack together. A wall much taller than its set height
 * folds to it, with its foot fading out, and Show all unfolds it on
 * `layout`, as the Code block's lines do. Nothing else moves.
 *
 *   <Testimonials
 *     title='Teams plan their week in Kino'
 *     testimonials={[{ value: 'mei', quote: '…', name: 'Mei Lin', role: 'Head of Product', company: 'Tessel' }]}
 *   />
 */

interface TestimonialsProps extends TestimonialsSectionProps {
  /** Whether a wall taller than its set height shows every quote. */
  expanded?: boolean
  defaultExpanded?: boolean
  onExpandedChange?: (expanded: boolean) => void
}

function Testimonials({
  title,
  description,
  eyebrow,
  heading = 'h2',
  testimonials,
  expanded: expandedProp,
  defaultExpanded = false,
  onExpandedChange,
  className,
  ...props
}: TestimonialsProps) {
  const titleId = useId()
  const wallId = useId()
  const rootRef = useRef<HTMLElement>(null)
  const frameRef = useRef<HTMLDivElement>(null)
  const fadeRef = useRef<HTMLDivElement>(null)
  const [expanded, setExpanded] = useControllable(
    expandedProp,
    defaultExpanded,
    onExpandedChange,
  )
  // Until it is measured, a wall is taken to be worth folding, as most are.
  const [foldable, setFoldable] = useState(true)
  const folded = foldable && !expanded
  useFoldMove(frameRef, folded)

  // A wall that runs past its set height by less than its fade isn't worth folding: showing it costs less than a click.
  useLayoutEffect(() => {
    const frame = frameRef.current
    const fade = fadeRef.current
    const inner = frame?.firstElementChild
    if (!frame || !fade || !(inner instanceof HTMLElement)) return
    // The cap is read while it holds; the wall keeps the last one it read.
    let cap = 0
    const measure = () => {
      const max = getComputedStyle(frame).maxHeight
      if (max.endsWith('px')) cap = Number.parseFloat(max)
      if (cap > 0) setFoldable(inner.offsetHeight > cap + fade.offsetHeight)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(inner)
    return () => observer.disconnect()
  }, [])

  const toggle = (next: boolean) => {
    const root = rootRef.current
    if (!next && root) bringTopBack(root)
    setExpanded(next)
  }

  // A card that takes focus behind the fade unfolds the wall, so it is never hidden.
  const onFocus = (event: FocusEvent<HTMLDivElement>) => {
    const fade = fadeRef.current
    if (!folded || !fade) return
    // The card's box, which its ring is drawn around, not the link inside it.
    const card = event.target.closest('[data-slot=testimonial-card]') ?? event.target
    if (card.getBoundingClientRect().bottom > fade.getBoundingClientRect().top) {
      toggle(true)
    }
  }

  return (
    <section
      ref={rootRef}
      data-slot='testimonials'
      aria-labelledby={titleId}
      className={cn(testimonialsSectionClassName, className)}
      {...props}
    >
      <div className={cn(testimonialsColumnClassName, 'flex flex-col gap-12')}>
        <SectionHeading
          id={titleId}
          eyebrow={eyebrow}
          title={title}
          description={description}
          heading={heading}
        />
        <div className='flex min-w-0 flex-col items-center gap-6'>
          {/* Capped while folded and not moving. Clipped down the page only, with room above for a card's focus ring. */}
          <div
            ref={frameRef}
            id={wallId}
            data-fold={folded ? '' : undefined}
            onFocus={onFocus}
            className='relative -mt-1 w-full min-w-0 overflow-y-clip pt-1 transition-[height] duration-(--motion-layout-duration) ease-(--motion-layout-easing) data-fold:not-data-moving:max-h-(--testimonials-height,40rem) motion-reduce:transition-none'
          >
            <div className='columns-1 gap-4 @2xl/testimonials:columns-2 @5xl/testimonials:columns-3 [&>*]:mb-4 [&>*]:break-inside-avoid'>
              {testimonials.map((testimonial) => (
                <TestimonialCard key={testimonial.value} testimonial={testimonial} />
              ))}
            </div>
            {/* The foot of a folded wall fades into the page. */}
            <div
              ref={fadeRef}
              aria-hidden
              className={cn(
                'from-background pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-linear-to-t to-transparent transition-opacity duration-(--motion-exit-duration) ease-(--motion-exit-fade-easing)',
                !folded && 'opacity-0',
              )}
            />
          </div>
          {foldable ? (
            <Button
              variant='outline'
              aria-expanded={expanded}
              aria-controls={wallId}
              onClick={() => toggle(!expanded)}
            >
              {expanded ? 'Show fewer' : `Show all ${testimonials.length}`}
            </Button>
          ) : null}
        </div>
      </div>
    </section>
  )
}

export { Testimonials, type TestimonialsProps }
