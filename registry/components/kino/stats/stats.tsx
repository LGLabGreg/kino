'use client'

import { displayTitleClassName } from '@/registry/lib/hero-parts'
import { SectionHeading } from '@/registry/lib/section-heading'
import {
  figureOf,
  type Stat,
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
 * A row of headline numbers under the section's title, each over a hairline,
 * with what it counts and where it comes from. The first time the row is
 * seen, each number's digits roll up into place, one number after another.
 *
 *   <Stats
 *     title='The planning tool teams stay with'
 *     stats={[{ value: 12400, label: 'teams plan their week in Kino' }]}
 *   />
 */

interface StatsProps
  extends StatsWordsProps, Omit<ComponentProps<'section'>, 'title' | 'children'> {
  title: ReactNode
  description?: ReactNode
  /** Two to four reads best: a row of them on a page, two to a row on a phone. */
  stats: Stat[]
}

function Stats({
  eyebrow,
  title,
  description,
  heading = 'h2',
  locale,
  stats,
  className,
  style,
  ...props
}: StatsProps) {
  const titleId = useId()
  return (
    <section
      data-slot='stats'
      aria-labelledby={titleId}
      className={cn(statsSectionClassName, className)}
      style={{ '--stats-columns': stats.length, ...style } as CSSProperties}
      {...props}
    >
      <StatsArrival locale={locale}>
        <div
          className={cn(statsColumnClassName, 'flex flex-col gap-12 @3xl/stats:gap-16')}
        >
          <SectionHeading
            id={titleId}
            eyebrow={eyebrow}
            title={title}
            description={description}
            heading={heading}
          />
          <ul className='grid gap-x-8 gap-y-10 @sm/stats:grid-cols-2 @3xl/stats:grid-cols-[repeat(var(--stats-columns),minmax(0,1fr))]'>
            {stats.map((stat, index) => (
              <li key={index} className='flex min-w-0 flex-col gap-2 border-t pt-6'>
                <StatsNumber
                  {...figureOf(stat)}
                  className={cn(
                    displayTitleClassName,
                    'text-4xl @3xl/stats:text-5xl @6xl/stats:text-6xl',
                  )}
                />
                <p className='text-foreground font-medium text-pretty'>
                  <bdi>{stat.label}</bdi>
                </p>
                {stat.description ? (
                  <p className='text-muted-foreground text-sm text-pretty'>
                    <bdi>{stat.description}</bdi>
                  </p>
                ) : null}
                {stat.source ? (
                  <StatsSource source={stat.source} className='mt-1 self-start' />
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      </StatsArrival>
    </section>
  )
}

export { Stats, type StatsProps }
