'use client'

import { useHold } from '@/registry/lib/hold'
import {
  type CustomerLogo,
  logoCloudColumnClassName,
  LogoCloudLink,
  LogoCloudLogo,
  type LogoCloudProps,
  logoCloudSectionClassName,
  LogoCloudTitle,
} from '@/registry/lib/logo-cloud-parts'
import { MarqueeRow } from '@/registry/lib/marquee'
import { useId } from 'react'

import { cn } from '@/lib/utils'

/*
 * The logos drift past in one row across the page's width, fading at its
 * edges, at the Testimonials marquee's pace and with its manners: it holds
 * while the pointer is over it, while a logo has focus and while it is out of
 * view, and under reduced motion it stands still and scrolls sideways. A logo
 * with a story is a link, and brightens on hover.
 *
 *   <LogoCloudMarquee
 *     title='Trusted by teams that plan their week in Kino'
 *     logos={[{ name: 'Tessel', src: '/logos/tessel.svg', width: 560, height: 159 }]}
 *   />
 */

function LogoCloudMarquee({
  title,
  heading = 'h2',
  logos,
  className,
  ...props
}: LogoCloudProps) {
  const titleId = useId()
  const hold = useHold()
  return (
    <section
      data-slot='logo-cloud-marquee'
      aria-labelledby={titleId}
      className={cn(logoCloudSectionClassName, className)}
      {...props}
    >
      <div className={cn(logoCloudColumnClassName, 'flex flex-col gap-8 @3xl:gap-10')}>
        <LogoCloudTitle id={titleId} title={title} heading={heading} />
        {/* The row runs the column's width and fades at its edges. */}
        <div className='min-w-0' {...hold.handlers}>
          <MarqueeRow
            label='Customers'
            running={hold.running}
            driftVariable='--logo-cloud-drift'
            trackClassName='items-center gap-12 py-2 @3xl/logo-cloud:gap-16'
          >
            {logos.map((logo) => (
              <MarqueeLogo key={logo.name} logo={logo} />
            ))}
          </MarqueeRow>
        </div>
      </div>
    </section>
  )
}

function MarqueeLogo({ logo }: { logo: CustomerLogo }) {
  const { href } = logo
  return href ? (
    <LogoCloudLink
      logo={{ ...logo, href }}
      className='text-muted-foreground hover:text-foreground flex items-center rounded-(--control-radius-xs) p-2 transition-colors duration-(--motion-press-duration) ease-(--motion-press-fade-easing)'
    >
      <LogoCloudLogo logo={logo} />
    </LogoCloudLink>
  ) : (
    <div className='text-muted-foreground flex items-center p-2'>
      <LogoCloudLogo logo={logo} />
    </div>
  )
}

export { LogoCloudMarquee }
