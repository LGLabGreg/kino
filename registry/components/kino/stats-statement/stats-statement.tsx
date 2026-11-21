'use client'

import { displayTitleClassName } from '@/registry/lib/hero-parts'
import { SectionHeading } from '@/registry/lib/section-heading'
import {
  type StatSource,
  StatsArrival,
  statsColumnClassName,
  statsSectionClassName,
  StatsSource,
  type StatsWordsProps,
} from '@/registry/lib/stats-parts'
import { type ComponentProps, type ReactNode, useId } from 'react'

import { cn } from '@/lib/utils'

/*
 * The numbers told as one sentence, set large: the words in a quieter
 * colour and the numbers in full, so the eye lands on them in reading
 * order. The first time it is seen, the numbers roll into place in that
 * order. Where each comes from is a footnote under it.
 *
 *   <StatsStatement eyebrow='Kino in numbers' sources={[{ label: 'Status page', href: '/status' }]}>
 *     Kino plans the week for <StatsNumber value={12400} /> teams in{' '}
 *     <StatsNumber value={84} /> countries.
 *   </StatsStatement>
 */

interface StatsStatementProps
  extends StatsWordsProps, Omit<ComponentProps<'section'>, 'title'> {
  /** The sentence, with each figure in a `StatsNumber`. */
  children: ReactNode
  /** Where the numbers come from, in a line under the sentence. */
  sources?: StatSource[]
  /** What the line of sources is called for a screen reader. */
  sourcesLabel?: string
  /** A link to more under it, such as the customer stories: a `NudgeLink`. */
  action?: ReactNode
}

function StatsStatement({
  eyebrow,
  heading = 'h2',
  locale,
  sources,
  sourcesLabel = 'Sources',
  action,
  className,
  children,
  ...props
}: StatsStatementProps) {
  const titleId = useId()
  return (
    <section
      data-slot='stats-statement'
      aria-labelledby={titleId}
      className={cn(statsSectionClassName, className)}
      {...props}
    >
      <StatsArrival locale={locale}>
        <div className={cn(statsColumnClassName, 'flex flex-col items-start gap-8')}>
          <SectionHeading
            id={titleId}
            eyebrow={eyebrow}
            title={children}
            heading={heading}
            align='start'
            titleClassName={cn(
              displayTitleClassName,
              'text-muted-foreground max-w-5xl text-3xl @2xl/stats:text-4xl @5xl/stats:text-5xl @5xl/stats:leading-[1.1] [&_[data-slot=stats-number]]:text-foreground',
            )}
          />
          {sources?.length || action ? (
            <div className='flex w-full flex-col gap-6 border-t pt-6 @2xl/stats:flex-row @2xl/stats:items-center @2xl/stats:justify-between'>
              {sources?.length ? (
                <ul
                  aria-label={sourcesLabel}
                  className='flex flex-wrap items-center gap-x-6 gap-y-1'
                >
                  {sources.map((source, index) => (
                    <li key={index}>
                      <StatsSource source={source} />
                    </li>
                  ))}
                </ul>
              ) : null}
              {action}
            </div>
          ) : null}
        </div>
      </StatsArrival>
    </section>
  )
}

export { StatsStatement, type StatsStatementProps }
