'use client'

import {
  type Feature,
  FeatureIcon,
  featuresColumnClassName,
  featuresSectionClassName,
  FeatureStage,
  FeatureWords,
} from '@/registry/lib/feature-parts'
import { HeroShot } from '@/registry/lib/hero-parts'
import {
  HEADING_BELOW,
  SectionHeading,
  type SectionHeadingLevel,
} from '@/registry/lib/section-heading'
import { type ComponentProps, type ReactNode, useId } from 'react'

import { cn } from '@/lib/utils'

/*
 * A landing page's features led by one: the first, the one the product is
 * bought for, in depth beside a large picture of it at work, and the rest in
 * brief under it, an icon, a title and a line each, three to a row. It
 * holds a long list as well as a short one.
 *
 *   <FeaturesLead
 *     title='Plan less. Ship more.'
 *     features={[{ value: 'cycles', title: 'Cycles that size themselves', description: '…', picture: <CyclePicture /> }]}
 *   />
 */

interface FeaturesLeadProps extends Omit<
  ComponentProps<'section'>,
  'title' | 'children'
> {
  /** The one that leads first, with its `picture`; the rest are told in words, so theirs is left out. */
  features: Feature[]
  title: ReactNode
  eyebrow?: ReactNode
  description?: ReactNode
  actions?: ReactNode
  heading?: SectionHeadingLevel
}

function FeaturesLead({
  features,
  title,
  eyebrow,
  description,
  actions,
  heading = 'h2',
  className,
  ...props
}: FeaturesLeadProps) {
  const titleId = useId()
  const Heading = HEADING_BELOW[heading]
  const [lead, ...rest] = features
  return (
    <section
      data-slot='features-lead'
      aria-labelledby={titleId}
      className={cn(featuresSectionClassName, className)}
      {...props}
    >
      <div className={featuresColumnClassName}>
        <SectionHeading
          id={titleId}
          eyebrow={eyebrow}
          title={title}
          description={description}
          heading={heading}
          align='start'
        >
          {actions ? (
            <div className='mt-3 flex flex-wrap items-center gap-3'>{actions}</div>
          ) : null}
        </SectionHeading>
        {lead ? (
          <div
            data-slot='features-lead-feature'
            className={cn(
              'grid min-w-0 items-start gap-8',
              lead.picture &&
                '@3xl/features:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] @3xl/features:gap-12',
            )}
          >
            <div className='flex min-w-0 flex-col gap-4'>
              {lead.icon ? <FeatureIcon>{lead.icon}</FeatureIcon> : null}
              <FeatureWords feature={lead} heading={Heading} size='lead' />
            </div>
            {lead.picture ? (
              <HeroShot decorative className='min-w-0'>
                <FeatureStage className='aspect-[4/3] @3xl/features:*:data-[slot=feature-picture]:[zoom:1.1]'>
                  {lead.picture}
                </FeatureStage>
              </HeroShot>
            ) : null}
          </div>
        ) : null}
        {rest.length > 0 ? (
          <ul
            data-slot='features-lead-rest'
            className={cn(
              'grid min-w-0 gap-x-8 gap-y-8 border-t pt-10 @xl/features:grid-cols-2',
              COLUMN_CLASSES[briefColumns(rest.length)],
            )}
          >
            {rest.map((feature) => (
              <li key={feature.value} className='flex min-w-0 flex-col gap-4'>
                {feature.icon ? <FeatureIcon>{feature.icon}</FeatureIcon> : null}
                <FeatureWords feature={feature} heading={Heading} />
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </section>
  )
}

/**
 * How many of the brief features sit in a row on a wide screen: all of them
 * up to four, then four or three, whichever leaves the last row fuller.
 */
function briefColumns(count: number): number {
  if (count <= 4) return count
  const empty = (columns: number) => (columns - (count % columns)) % columns
  return empty(3) < empty(4) ? 3 : 4
}

/** The columns at full width, written out so the classes are in the stylesheet. */
const COLUMN_CLASSES: Record<number, string> = {
  1: '@xl/features:grid-cols-1',
  2: '@4xl/features:grid-cols-2',
  3: '@4xl/features:grid-cols-3',
  4: '@4xl/features:grid-cols-4',
}

export { briefColumns, FeaturesLead, type FeaturesLeadProps }
