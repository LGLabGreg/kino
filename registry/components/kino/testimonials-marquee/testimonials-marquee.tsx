'use client'

import { useHold } from '@/registry/lib/hold'
import { dealRows, MarqueeRow } from '@/registry/lib/marquee'
import { SectionHeading } from '@/registry/lib/section-heading'
import {
  TestimonialCard,
  testimonialsColumnClassName,
  type TestimonialsSectionProps,
  testimonialsSectionClassName,
} from '@/registry/lib/testimonial-parts'
import { useId } from 'react'

import { cn } from '@/lib/utils'

/*
 * The quotes drift past in rows, each row the other way from the one above,
 * so a page full of praise reads at a glance. It holds still while the
 * pointer is over it, while a card has focus and while it is out of view,
 * and a card that takes focus comes clear of the faded ends. Under reduced
 * motion the rows stand still and scroll sideways instead, so every quote
 * is still in reach.
 *
 * The drift is the `marquee` lib's, which the Logo cloud's marquee shares.
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
  const hold = useHold()
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
      <div className='flex min-w-0 flex-col gap-4 pb-16 @3xl:pb-24' {...hold.handlers}>
        {dealt.map((row, index) => (
          <MarqueeRow
            key={row.map((testimonial) => testimonial.value).join()}
            label={`Quotes, row ${index + 1} of ${dealt.length}`}
            reverse={index % 2 === 1}
            running={hold.running}
            driftVariable='--testimonials-drift'
            trackClassName='gap-4 px-(--surface-padding) py-1 @3xl/testimonials:px-10'
          >
            {row.map((testimonial) => (
              <TestimonialCard
                key={testimonial.value}
                testimonial={testimonial}
                // Never wider than the room between the row's faded ends (each 12% of it), so a card with focus fits clear of them.
                className='w-[min(18rem,76cqw)] shrink-0 @md/testimonials:w-80'
              />
            ))}
          </MarqueeRow>
        ))}
      </div>
    </section>
  )
}

export { TestimonialsMarquee, type TestimonialsMarqueeProps }
