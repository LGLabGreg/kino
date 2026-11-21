'use client'

import {
  ctaColumnClassName,
  type CtaProps,
  ctaSectionClassName,
  CtaWords,
} from '@/registry/lib/cta-parts'
import { FeatureStage } from '@/registry/lib/feature-parts'
import { HeroShot } from '@/registry/lib/hero-parts'
import { type ReactNode, useId } from 'react'

import { cn } from '@/lib/utils'

/*
 * The close of a landing page, beside the product finishing the job the page
 * sold: the words and actions on the start side, and a picture of the
 * product at work on its stage, which plays once when it is seen and then
 * rests on the result. The words stand still, so what moves is the outcome.
 *
 *   <CtaSplit
 *     title='Ship the next cycle on time.'
 *     actions={<a href='/signup' className={buttonVariants({ size: 'lg' })}>Start for free</a>}
 *     picture={<ShippedPicture />}
 *   />
 */

interface CtaSplitProps extends CtaProps {
  /** The product finishing the job, made of live components that play once when seen (`useScene`). */
  picture: ReactNode
}

function CtaSplit({
  title,
  description,
  eyebrow,
  actions,
  note,
  proof,
  picture,
  heading = 'h2',
  className,
  ...props
}: CtaSplitProps) {
  const titleId = useId()
  return (
    <section
      data-slot='cta-split'
      aria-labelledby={titleId}
      className={cn(ctaSectionClassName, className)}
      {...props}
    >
      <div
        className={cn(
          ctaColumnClassName,
          'grid items-center gap-12 @3xl/cta:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] @3xl/cta:gap-16',
        )}
      >
        <CtaWords
          titleId={titleId}
          title={title}
          description={description}
          eyebrow={eyebrow}
          heading={heading}
          actions={actions}
          note={note}
          proof={proof}
          align='start'
        />
        <HeroShot decorative className='min-w-0'>
          <FeatureStage className='aspect-[4/3] @5xl/cta:*:data-[slot=feature-picture]:[zoom:1.1]'>
            {picture}
          </FeatureStage>
        </HeroShot>
      </div>
    </section>
  )
}

export { CtaSplit, type CtaSplitProps }
