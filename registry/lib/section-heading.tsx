import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

/*
 * The heading over a section of a landing page, as the Pricing and the
 * Features blocks share it: a small line that names the topic, the title,
 * one sentence under it, and whatever the section puts below, such as a
 * switch or a link.
 */

/** The levels a section's title takes: `h2` under the page's `h1`, unless the section is the page. */
type SectionHeadingLevel = 'h1' | 'h2' | 'h3'

/** The level of the headings inside a section, one under its title. */
const HEADING_BELOW = { h1: 'h2', h2: 'h3', h3: 'h4' } as const

function SectionHeading({
  id,
  eyebrow,
  title,
  description,
  heading = 'h2',
  align = 'center',
  className,
  children,
}: {
  /** The title's id, for the section's `aria-labelledby`. */
  id: string
  /** A few words above the title that name the topic, such as Planning. */
  eyebrow?: ReactNode
  title: ReactNode
  description?: ReactNode
  heading?: SectionHeadingLevel
  align?: 'center' | 'start'
  className?: string
  /** Below the words: a switch, or a link to more. */
  children?: ReactNode
}) {
  const Title = heading
  return (
    <header
      data-slot='section-heading'
      className={cn(
        'flex min-w-0 flex-col gap-3',
        align === 'center' ? 'items-center text-center' : 'items-start',
        className,
      )}
    >
      <div
        className={cn(
          'flex min-w-0 flex-col gap-2',
          align === 'center' ? 'items-center' : 'items-start',
        )}
      >
        {eyebrow ? (
          <p className='text-muted-foreground text-xs font-medium tracking-wider uppercase'>
            <bdi>{eyebrow}</bdi>
          </p>
        ) : null}
        <Title
          id={id}
          className='text-3xl font-semibold tracking-tight text-balance @3xl:text-4xl'
        >
          {/* Its own direction, so its words read the same way round right to left. */}
          <bdi>{title}</bdi>
        </Title>
        {description ? (
          <p className='text-muted-foreground max-w-prose text-pretty'>
            <bdi>{description}</bdi>
          </p>
        ) : null}
      </div>
      {children}
    </header>
  )
}

export { HEADING_BELOW, SectionHeading, type SectionHeadingLevel }
