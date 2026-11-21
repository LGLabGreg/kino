'use client'

import {
  ctaColumnClassName,
  type CtaProps,
  ctaSectionClassName,
  CtaWords,
} from '@/registry/lib/cta-parts'
import { HeroBackdrop } from '@/registry/lib/hero-parts'
import { useId } from 'react'

import { cn } from '@/lib/utils'

/*
 * The close of a landing page, centred: the title, a line on what happens
 * when you start, the main action with a quieter one beside it, a note that
 * makes saying yes easy and who has said yes already, on the Hero's grid,
 * so the page ends where it began. Nothing moves until it is pointed at:
 * the ask stands still.
 *
 *   <Cta
 *     title='Your next cycle can plan itself.'
 *     actions={<a href='/signup' className={buttonVariants({ size: 'lg' })}>Start for free</a>}
 *     note='Free for teams up to 10. No card needed.'
 *   />
 */

function Cta({
  title,
  description,
  eyebrow,
  actions,
  note,
  proof,
  heading = 'h2',
  className,
  ...props
}: CtaProps) {
  const titleId = useId()
  return (
    <section
      data-slot='cta'
      aria-labelledby={titleId}
      className={cn(ctaSectionClassName, className)}
      {...props}
    >
      <HeroBackdrop />
      <div
        className={cn(ctaColumnClassName, 'flex flex-col items-center @3xl/cta:py-32')}
      >
        <div className='flex w-full max-w-2xl min-w-0 flex-col items-center'>
          <CtaWords
            titleId={titleId}
            title={title}
            description={description}
            eyebrow={eyebrow}
            heading={heading}
            actions={actions}
            note={note}
            proof={proof}
          />
        </div>
      </div>
    </section>
  )
}

export { Cta }
