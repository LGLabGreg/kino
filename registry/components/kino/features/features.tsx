'use client'

import { Card, CardContent, CardSection } from '@/registry/components/kino/card'
import {
  type Feature,
  type FeatureHeading,
  FeatureIcon,
  featuresColumnClassName,
  featuresSectionClassName,
  FeatureStage,
  FeatureWords,
} from '@/registry/lib/feature-parts'
import {
  HEADING_BELOW,
  SectionHeading,
  type SectionHeadingLevel,
} from '@/registry/lib/section-heading'
import { type ComponentProps, type ReactNode, useId } from 'react'

import { cn } from '@/lib/utils'

/*
 * A landing page's features as a grid of tiles, each with the product doing
 * it above its words. The tiles take turns at a wide slot, so the grid
 * reads as a whole rather than a list, and every row is full whatever the
 * count. In a phone's column the tiles stack, in the order given.
 *
 *   <Features
 *     title='Plan less. Ship more.'
 *     features={[{ value: 'cycles', title: 'Cycles that size themselves', description: '…', picture: <CyclePicture /> }]}
 *   />
 */

interface FeaturesProps extends Omit<ComponentProps<'section'>, 'title' | 'children'> {
  /** Most important first: the first takes the first wide slot. */
  features: Feature[]
  title: ReactNode
  /** A few words above the title that name the topic. */
  eyebrow?: ReactNode
  description?: ReactNode
  /** Under the heading: a link to more, for the whole section. */
  actions?: ReactNode
  /** The title's level: `h2` under the page's `h1`. */
  heading?: SectionHeadingLevel
}

function Features({
  features,
  title,
  eyebrow,
  description,
  actions,
  heading = 'h2',
  className,
  ...props
}: FeaturesProps) {
  const titleId = useId()
  const spans = bentoSpans(features.length)
  return (
    <section
      data-slot='features'
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
        >
          {actions ? (
            <div className='mt-3 flex flex-wrap items-center justify-center gap-3'>
              {actions}
            </div>
          ) : null}
        </SectionHeading>
        <ul
          data-slot='features-grid'
          className='grid min-w-0 grid-cols-1 gap-4 @2xl/features:grid-cols-2 @4xl/features:grid-cols-6'
        >
          {features.map((feature, index) => (
            <FeatureTile
              key={feature.value}
              feature={feature}
              heading={HEADING_BELOW[heading]}
              className={cn(
                SPAN_CLASSES[spans[index] ?? 2],
                // Two to a row before there is room for the grid: an odd last one takes the row.
                features.length % 2 === 1 &&
                  index === features.length - 1 &&
                  '@2xl/features:col-span-2',
              )}
            />
          ))}
        </ul>
      </div>
    </section>
  )
}

/** A tile: the picture to the edges, the words under it. */
function FeatureTile({
  feature,
  heading,
  className,
}: {
  feature: Feature
  heading: FeatureHeading
  className?: string
}) {
  return (
    <Card
      render={<li />}
      data-slot='features-tile'
      className={cn('@container/tile min-w-0 overflow-hidden', className)}
    >
      {feature.picture ? (
        <CardSection className='border-b'>
          <FeatureStage className='h-64'>{feature.picture}</FeatureStage>
        </CardSection>
      ) : null}
      <CardContent className='flex flex-col gap-4'>
        {feature.picture || !feature.icon ? null : (
          <FeatureIcon>{feature.icon}</FeatureIcon>
        )}
        <FeatureWords feature={feature} heading={heading} />
      </CardContent>
    </Card>
  )
}

/**
 * Each tile's share of a six-column row, in order, so every row is full: a
 * wide tile and a narrow one, turn about, and three alike where the count
 * is odd, second, so the first tile always leads wide.
 */
function bentoSpans(count: number): number[] {
  if (count <= 0) return []
  if (count === 1) return [6]
  if (count === 3) return [2, 2, 2]
  const pairs = Math.floor(count / 2) - (count % 2 === 1 ? 1 : 0)
  const rows: number[][] = []
  for (let pair = 0; pair < pairs; pair += 1) {
    rows.push(pair % 2 === 0 ? [4, 2] : [2, 4])
    // An odd count takes its row of three after the first pair.
    if (pair === 0 && count % 2 === 1) rows.push([2, 2, 2])
  }
  return rows.flat()
}

/** A tile's span in the six columns, written out so the classes are in the stylesheet. */
const SPAN_CLASSES: Record<number, string> = {
  2: '@4xl/features:col-span-2',
  4: '@4xl/features:col-span-4',
  6: '@4xl/features:col-span-6',
}

export { bentoSpans, Features, type FeaturesProps }
