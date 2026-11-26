'use client'

import { Tabs, TabsPanel, TabsList, TabsTab } from '@/registry/components/kino/tabs'
import { useControllable } from '@/registry/lib/controllable'
import { followHeight } from '@/registry/lib/resize'
import { SectionHeading } from '@/registry/lib/section-heading'
import {
  NewTabNote,
  roleLine,
  sourceLinkProps,
  type Testimonial,
  TestimonialAvatar,
  testimonialsColumnClassName,
  type TestimonialsSectionProps,
  testimonialsSectionClassName,
} from '@/registry/lib/testimonial-parts'
import { useEffect, useId, useRef } from 'react'

import { cn } from '@/lib/utils'

/*
 * One customer at a time, in their own words, large, with the others as a
 * row of faces under them. Picking a face slides the pill to it and brings
 * their quote in where the last one stood; the room the quote takes follows
 * on `layout`, so the faces glide to their new place rather than jump.
 * Nothing changes until a visitor picks: there is no timer to race.
 *
 *   <TestimonialsSpotlight
 *     title='Teams plan their week in Kino'
 *     testimonials={[{ value: 'mei', quote: '…', name: 'Mei Lin', role: 'Head of Product', company: 'Tessel' }]}
 *   />
 */

interface TestimonialsSpotlightProps extends TestimonialsSectionProps {
  /** The quote in the spotlight, by its `value`. */
  value?: string
  /** The quote in the spotlight at first: the first, unless you give another. */
  defaultValue?: string
  onValueChange?: (value: string) => void
}

function TestimonialsSpotlight({
  title,
  description,
  eyebrow,
  heading = 'h2',
  testimonials,
  value: valueProp,
  defaultValue,
  onValueChange,
  className,
  ...props
}: TestimonialsSpotlightProps) {
  const titleId = useId()
  const [picked, setPicked] = useControllable(
    valueProp,
    defaultValue ?? testimonials[0]?.value ?? '',
    onValueChange,
  )
  const frameRef = useRef<HTMLDivElement>(null)
  const innerRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const frame = frameRef.current
    const inner = innerRef.current
    if (!frame || !inner) return
    return followHeight(frame, inner)
  }, [])

  return (
    <section
      data-slot='testimonials-spotlight'
      aria-labelledby={titleId}
      className={cn(testimonialsSectionClassName, className)}
      {...props}
    >
      <div
        className={cn(testimonialsColumnClassName, 'flex flex-col items-center gap-12')}
      >
        <SectionHeading
          id={titleId}
          eyebrow={eyebrow}
          title={title}
          description={description}
          heading={heading}
        />
        {testimonials.length > 1 ? (
          <Tabs
            value={picked}
            onValueChange={(next) => setPicked(String(next))}
            className='flex w-full max-w-4xl min-w-0 flex-col items-center gap-10'
          >
            {/* The faces first, so Tab goes on from the one picked to its quote. */}
            <TabsList aria-label='Customers' className='self-center'>
              {testimonials.map((testimonial) => (
                <TabsTab key={testimonial.value} value={testimonial.value}>
                  <TestimonialAvatar testimonial={testimonial} size='xs' />
                  <bdi>{firstName(testimonial.name)}</bdi>
                  <span className='sr-only'>{restOfName(testimonial.name)}</span>
                </TabsTab>
              ))}
            </TabsList>
            {/* Clipped down the page only, with room above and below for a panel's focus ring. */}
            <div
              ref={frameRef}
              className='-my-1 w-full min-w-0 overflow-y-clip py-1 transition-[height] duration-(--motion-layout-duration) ease-(--motion-layout-easing) motion-reduce:transition-none'
            >
              <div ref={innerRef} className='flex min-w-0 flex-col'>
                {testimonials.map((testimonial) => (
                  <TabsPanel
                    key={testimonial.value}
                    value={testimonial.value}
                    className='focus-visible:ring-inset'
                  >
                    <SpotlightQuote testimonial={testimonial} />
                  </TabsPanel>
                ))}
              </div>
            </div>
          </Tabs>
        ) : testimonials[0] ? (
          <div className='w-full max-w-4xl min-w-0'>
            <SpotlightQuote testimonial={testimonials[0]} />
          </div>
        ) : null}
      </div>
    </section>
  )
}

/** A quote, large, with who said it, their job and where they said it under it. */
function SpotlightQuote({ testimonial }: { testimonial: Testimonial }) {
  const { source } = testimonial
  const line = roleLine(testimonial)
  return (
    <figure className='flex min-w-0 flex-col items-center gap-6 p-2 text-center'>
      <blockquote
        dir='auto'
        className='text-foreground text-2xl/snug font-medium tracking-tight text-balance @3xl/testimonials:text-3xl/snug'
      >
        <span aria-hidden>“</span>
        {testimonial.quote}
        <span aria-hidden>”</span>
      </blockquote>
      <figcaption className='flex flex-col items-center gap-1 text-sm text-pretty'>
        <span>
          <bdi className='font-medium'>{testimonial.name}</bdi>
          {line ? (
            <>
              <span aria-hidden className='text-muted-foreground'>
                {' · '}
              </span>
              <span className='sr-only'>, </span>
              <bdi className='text-muted-foreground'>{line}</bdi>
            </>
          ) : null}
        </span>
        {source ? (
          <a
            href={source.href}
            {...sourceLinkProps(source)}
            className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 mt-2 -mx-1.5 inline-flex min-h-6 items-center gap-2 rounded-(--control-radius-xs) px-1.5 transition-[color,box-shadow] duration-(--motion-press-duration) ease-(--motion-press-fade-easing) focus-visible:ring-3 focus-visible:outline-hidden [&_svg:not([class*='size-'])]:size-4"
          >
            {source.icon}
            <span className='sr-only'>
              <bdi>{testimonial.name}</bdi>,{' '}
            </span>
            <bdi>{source.label}</bdi>
            <NewTabNote source={source} />
          </a>
        ) : null}
      </figcaption>
    </figure>
  )
}

/** The first word of a name, for its face's tab: Mei. */
function firstName(name: string) {
  return name.split(' ')[0] ?? name
}

/** The rest of the name, read after the first by a screen reader, so the tab's name is whole. */
function restOfName(name: string) {
  const rest = name.split(' ').slice(1).join(' ')
  return rest ? ` ${rest}` : ''
}

export { TestimonialsSpotlight, type TestimonialsSpotlightProps }
