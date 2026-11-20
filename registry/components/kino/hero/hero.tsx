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
 * The top of a landing page, centred: an announcement, the title, a line
 * that says what the product does and the actions, with the product shot
 * below, fading into the page. The shot arrives leaning back a little and
 * settles flat as the page scrolls it into view.
 *
 *   <Hero
 *     title='Plan the cycle. Ship it on time.'
 *     description='Kino turns your issues into a plan you can trust.'
 *     actions={<a href='/signup' className={buttonVariants({ size: 'lg' })}>Start free</a>}
 *     shot={<HeroShot label='The cycle view'>…</HeroShot>}
 *   />
 */

function Hero({
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
  const tilt = useRef<HTMLDivElement>(null)
  useScrollLinked(tilt, {
    from: {
      transform:
        'perspective(var(--hero-perspective,1200px)) rotateX(var(--hero-tilt,8deg)) scale(var(--hero-tilt-scale,0.97))',
    },
    to: {
      transform: 'perspective(var(--hero-perspective,1200px)) rotateX(0deg) scale(1)',
    },
    // From the shot's top at the bottom of the view to a third of the way down it.
    range: [1, 0.35],
  })

  return (
    <section
      data-slot='hero'
      aria-labelledby={titleId}
      className={cn(heroSectionClassName, className)}
      {...props}
    >
      <HeroBackdrop />
      <div
        className={cn(
          pageColumnClassName,
          'flex flex-1 flex-col items-center gap-12 pt-16 @3xl/hero:gap-16 @3xl/hero:pt-24',
          !shot && 'pb-16 @3xl/hero:pb-24',
        )}
      >
        <HeroWords
          titleId={titleId}
          title={title}
          description={description}
          announcement={announcement}
          actions={actions}
          heading={heading}
        />
        {shot ? (
          <div
            className={cn(
              'w-full max-w-6xl min-w-0',
              // The shot's last fifth fades into the page below.
              'mask-b-from-80% mask-b-to-100%',
              heroEnter('shot'),
            )}
          >
            <div
              ref={tilt}
              className={cn(
                'origin-[50%_0%] will-change-transform',
                // The lean the scroll starts from, there from the first paint,
                // before the script that moves it has loaded.
                'motion-safe:supports-[animation-timeline:scroll()]:[transform:perspective(var(--hero-perspective,1200px))_rotateX(var(--hero-tilt,8deg))_scale(var(--hero-tilt-scale,0.97))]',
              )}
            >
              {shot}
            </div>
          </div>
        ) : null}
      </div>
    </section>
  )
}

export { Hero }
