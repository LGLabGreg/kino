'use client'

import { Avatar, AvatarFallback, AvatarImage } from '@/registry/components/kino/avatar'
import { Card, CardLink } from '@/registry/components/kino/card'
import { sectionColumnClassName } from '@/registry/lib/hero-parts'
import type { SectionHeadingLevel } from '@/registry/lib/section-heading'
import type { ComponentProps, ReactNode } from 'react'

import { cn } from '@/lib/utils'

/*
 * What the Testimonials blocks share: a customer's quote with who said it,
 * the card it sits on, and the section they stand in.
 */

/** A customer's words, and who said them. */
interface Testimonial {
  /** Tells the quotes apart. */
  value: string
  quote: ReactNode
  name: string
  /** Their job, such as Head of Product. */
  role?: string
  company?: string
  /** The person's photo. Their initials show without one. */
  photo?: string
  /** Where they said it, such as a post on X or a case study: the card leads there. */
  source?: TestimonialSource
}

/** Where a customer said it. */
interface TestimonialSource {
  /** Where, read after their name: Posted on X, Read the case study. */
  label: string
  href: string
  /** The place's mark, such as X's logo, in the text colour, or an icon for a page of your own. */
  icon: ReactNode
  /** Opens in a new tab, and says so to a screen reader: a post on another site. */
  external?: boolean
}

/** What every Testimonials block takes. */
interface TestimonialsSectionProps extends Omit<
  ComponentProps<'section'>,
  'title' | 'children'
> {
  title: ReactNode
  description?: ReactNode
  /** A few words above the title that name the topic. */
  eyebrow?: ReactNode
  /** The title's level: `h2` under the page's `h1`. */
  heading?: SectionHeadingLevel
  testimonials: Testimonial[]
}

/** The section every arrangement stands in, laid out by its own width. */
const testimonialsSectionClassName =
  '@container/testimonials relative isolate flex w-full min-w-0 flex-col overflow-x-clip bg-background'

const testimonialsColumnClassName = sectionColumnClassName

/** A name's initials: its first and last words' first letters, a hyphenated surname taking its first part's. */
function initials(name: string) {
  const words = name.split(/\s+/).filter(Boolean)
  return `${words[0]?.[0] ?? ''}${words.length > 1 ? (words.at(-1)?.[0] ?? '') : ''}`
}

/** Their job and company on one line: Head of Product, Tessel. */
function roleLine({ role, company }: Pick<Testimonial, 'role' | 'company'>) {
  return [role, company].filter(Boolean).join(', ')
}

/** Their photo, over their initials. Decorative: their name is always written beside it. */
function TestimonialAvatar({
  testimonial,
  size,
}: {
  testimonial: Testimonial
  size?: 'xs' | 'default'
}) {
  return (
    <Avatar size={size}>
      {testimonial.photo ? (
        <AvatarImage src={testimonial.photo} alt='' draggable={false} />
      ) : null}
      <AvatarFallback aria-hidden>{initials(testimonial.name)}</AvatarFallback>
    </Avatar>
  )
}

/** A source link's target, and the word that says a new tab opens. */
function sourceLinkProps(source: TestimonialSource) {
  return source.external ? { target: '_blank', rel: 'noreferrer' } : {}
}

/** Read after a source link's words when it opens a new tab. */
function NewTabNote({ source }: { source: TestimonialSource }) {
  return source.external ? <span className='sr-only'> (opens in a new tab)</span> : null
}

/** Who said it: their photo, their name, and their job and company under it. */
function TestimonialAuthor({ testimonial }: { testimonial: Testimonial }) {
  const line = roleLine(testimonial)
  return (
    <div
      data-slot='testimonial-author'
      className='flex min-w-0 items-center gap-3 text-start'
    >
      <TestimonialAvatar testimonial={testimonial} />
      <div className='flex min-w-0 flex-col'>
        <span className='text-sm font-medium text-pretty'>
          <bdi>{testimonial.name}</bdi>
        </span>
        {line ? (
          <span className='text-muted-foreground text-sm text-pretty'>
            <bdi>{line}</bdi>
          </span>
        ) : null}
      </div>
    </div>
  )
}

/**
 * A quote on a card, with who said it under it. With a `source`, the whole
 * card leads to where they said it, and the place's mark stands at the
 * quote's top end, as a post's does; its name, "Ben Hartley, posted on X",
 * tells one card's link from the next.
 */
function TestimonialCard({
  testimonial,
  className,
  ...props
}: { testimonial: Testimonial } & Omit<ComponentProps<'figure'>, 'children'>) {
  const { source } = testimonial
  return (
    <Card
      data-slot='testimonial-card'
      render={<figure {...props} />}
      className={cn('px-(--surface-padding)', className)}
    >
      {/* It takes the room a taller card beside it leaves, so the names in a row line up. */}
      <div className='flex min-w-0 flex-1 items-start gap-4'>
        <blockquote
          dir='auto'
          className='text-foreground min-w-0 flex-1 text-sm/6 text-pretty'
        >
          {testimonial.quote}
        </blockquote>
        {source ? (
          // Centred on the quote's first line. Hovering the card is hovering its link, so the mark brightens.
          <CardLink
            href={source.href}
            {...sourceLinkProps(source)}
            className="text-muted-foreground hover:text-foreground mt-1 shrink-0 transition-colors duration-(--motion-press-duration) ease-(--motion-press-fade-easing) [&_svg:not([class*='size-'])]:size-4"
          >
            {source.icon}
            <span className='sr-only'>
              <bdi>{testimonial.name}</bdi>, <bdi>{source.label}</bdi>
            </span>
            <NewTabNote source={source} />
          </CardLink>
        ) : null}
      </div>
      <figcaption className='min-w-0'>
        <TestimonialAuthor testimonial={testimonial} />
      </figcaption>
    </Card>
  )
}

export {
  initials,
  roleLine,
  NewTabNote,
  sourceLinkProps,
  type Testimonial,
  TestimonialAuthor,
  TestimonialAvatar,
  TestimonialCard,
  type TestimonialSource,
  testimonialsColumnClassName,
  type TestimonialsSectionProps,
  testimonialsSectionClassName,
}
