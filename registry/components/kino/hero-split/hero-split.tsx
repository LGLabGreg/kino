'use client'

import {
  HeroBackdrop,
  heroEnter,
  type HeroProps,
  heroSectionClassName,
  HeroWords,
  pageColumnClassName,
} from '@/registry/lib/hero-parts'
import { useScrollLinked } from '@/registry/lib/scroll'
import { useId, useRef } from 'react'

import { cn } from '@/lib/utils'

/*
 * The top of a landing page, split: the words on the start side and the
 * product on the other, wider than its column and running off the hero's
 * edge. The shot arrives after the words, then drifts up a little slower
 * than the page as it scrolls past, so it reads as further away.
 *
 *   <HeroSplit
 *     title='Plan the cycle. Ship it on time.'
 *     description='Kino turns your issues into a plan you can trust.'
 *     actions={<a href='/signup' className={buttonVariants({ size: 'lg' })}>Start free</a>}
 *     shot={<HeroShot label='The cycle view'>…</HeroShot>}
 *   />
 */

function HeroSplit({
  title,
  description,
  announcement,
  actions,
  shot,
  heading = 'h1',
  className,
  ...props
}: HeroProps) {
  const titleId = useId()
  const drift = useRef<HTMLDivElement>(null)
  useScrollLinked(drift, {
    from: { transform: 'translateY(0px)' },
    to: { transform: 'translateY(calc(var(--hero-drift,1.5rem) * -1))' },
    // From where it sits at first to well past the top of the view.
    range: [1, -0.5],
    pace: 'even',
  })

  return (
    <section
      data-slot='hero-split'
      aria-labelledby={titleId}
      className={cn(heroSectionClassName, className)}
      {...props}
    >
      <HeroBackdrop />
      <div
        className={cn(
          pageColumnClassName,
          'grid flex-1 items-center gap-12 pt-16 pb-16 @3xl/hero:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] @3xl/hero:pt-24 @3xl/hero:pb-24',
        )}
      >
        <HeroWords
          titleId={titleId}
          title={title}
          description={description}
          announcement={announcement}
          actions={actions}
          heading={heading}
          align='start'
          // Half the hero's width: a size smaller than a centred title.
          titleClassName='@3xl/hero:text-4xl @5xl/hero:text-5xl @7xl/hero:text-6xl'
        />
        {shot ? (
          <div className='min-w-0'>
            {/* On a wide hero the shot is wider than its column, and never narrower than a laptop's window, so it runs off the edge. */}
            <div className={cn('@3xl/hero:w-[max(140%,58rem)]', heroEnter('shot'))}>
              <div ref={drift} className='will-change-transform'>
                {shot}
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  )
}

export { HeroSplit }
