'use client'

import { displayTitleClassName } from '@/registry/lib/hero-parts'
import { SectionHeading } from '@/registry/lib/section-heading'
import {
  figureOf,
  type Stat,
  type StatFigure,
  StatsArrival,
  statsColumnClassName,
  StatsNumber,
  statsSectionClassName,
  StatsSource,
  type StatsWordsProps,
} from '@/registry/lib/stats-parts'
import { type ComponentProps, type CSSProperties, type ReactNode, useId } from 'react'

import { cn } from '@/lib/utils'

/*
 * One number leads, beside the section's words: it is the largest thing on
 * the page and counts up to its value the first time it is seen, with what
 * it counts and why it matters under it. The numbers that back it up sit in
 * a row below, over a hairline, and roll into place after it.
 *
 *   <StatsLead
 *     title='Teams ship more when the week plans itself'
 *     lead={{ value: 38, format: { style: 'percent' }, label: 'fewer missed deadlines' }}
 *     stats={[{ value: 12400, label: 'teams' }]}
 *   />
 */

interface StatsLeadProps
  extends StatsWordsProps, Omit<ComponentProps<'section'>, 'title' | 'children'> {
  title: ReactNode
  description?: ReactNode
  /** The number the section is about. */
  lead: Stat
  /** Two or three that back it up, each with what it counts and where it comes from. */
  stats: (StatFigure & Pick<Stat, 'label' | 'source'>)[]
  /** A link to more under the words, such as the customer stories: a `NudgeLink`. */
  action?: ReactNode
}

function StatsLead({
  eyebrow,
  title,
  description,
  heading = 'h2',
  locale,
  lead,
  stats,
  action,
  className,
  ...props
}: StatsLeadProps) {
  const titleId = useId()
  return (
    <section
      data-slot='stats-lead'
      aria-labelledby={titleId}
      className={cn(statsSectionClassName, className)}
      {...props}
    >
      <StatsArrival locale={locale}>
        <div
          className={cn(
            statsColumnClassName,
            'grid gap-12 @4xl/stats:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] @4xl/stats:gap-16',
          )}
        >
          <SectionHeading
            id={titleId}
            eyebrow={eyebrow}
            title={title}
            description={description}
            heading={heading}
            align='start'
            className='gap-6'
          >
            {action}
          </SectionHeading>
          <div className='flex min-w-0 flex-col gap-10'>
            <figure className='flex min-w-0 flex-col gap-3'>
              <StatsNumber
                {...figureOf(lead)}
                variant='count'
                className={cn(
                  displayTitleClassName,
                  'text-6xl leading-none @lg/stats:text-7xl @6xl/stats:text-8xl',
                )}
              />
              <figcaption className='flex max-w-md min-w-0 flex-col gap-1'>
                <span className='text-lg font-medium text-pretty'>
                  <bdi>{lead.label}</bdi>
                </span>
                {lead.description ? (
                  <span className='text-muted-foreground text-pretty'>
                    <bdi>{lead.description}</bdi>
                  </span>
                ) : null}
              </figcaption>
              {lead.source ? (
                <StatsSource source={lead.source} className='self-start' />
              ) : null}
            </figure>
            <ul
              style={{ '--stats-columns': stats.length } as CSSProperties}
              className='grid gap-x-8 gap-y-6 border-t pt-6 @xs/stats:grid-cols-2 @lg/stats:grid-cols-[repeat(var(--stats-columns),minmax(0,1fr))]'
            >
              {stats.map((stat, index) => (
                <li key={index} className='flex min-w-0 flex-col gap-1'>
                  <StatsNumber
                    {...figureOf(stat)}
                    className={cn(displayTitleClassName, 'text-3xl')}
                  />
                  <p className='text-muted-foreground text-sm text-pretty'>
                    <bdi>{stat.label}</bdi>
                  </p>
                  {stat.source ? (
                    <StatsSource source={stat.source} className='self-start' />
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </StatsArrival>
    </section>
  )
}

export { StatsLead, type StatsLeadProps }
