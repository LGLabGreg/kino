'use client'

import {
  type CustomerLogo,
  logoCloudColumnClassName,
  LogoCloudLink,
  LogoCloudLogo,
  LogoCloudStoryArrow,
  type LogoCloudProps,
  logoCloudSectionClassName,
  LogoCloudTitle,
} from '@/registry/lib/logo-cloud-parts'
import { useId } from 'react'

import { cn } from '@/lib/utils'

/*
 * Every logo at once, each in a cell of a hairline grid, and nothing moves.
 * A logo with a story is a link: the whole cell leads there, an arrow in its
 * corner says so, and on hover the cell tints and the logo darkens.
 *
 *   <LogoCloud
 *     title='Trusted by teams that plan their week in Kino'
 *     logos={[{ name: 'Tessel', src: '/logos/tessel.svg', width: 560, height: 159, href: '/customers/tessel' }]}
 *   />
 */

function LogoCloud({
  title,
  heading = 'h2',
  logos,
  className,
  ...props
}: LogoCloudProps) {
  const titleId = useId()
  return (
    <section
      data-slot='logo-cloud'
      aria-labelledby={titleId}
      className={cn(logoCloudSectionClassName, className)}
      {...props}
    >
      <div className={cn(logoCloudColumnClassName, 'flex flex-col gap-8')}>
        <LogoCloudTitle id={titleId} title={title} heading={heading} />
        {/* Each cell draws its lines at its end and bottom, so a short last row still closes the cells above it; the frame clips those on its own edges. */}
        <div className='overflow-clip rounded-(--surface-radius) border'>
          <ul className='-me-px -mb-px grid grid-cols-2 @lg/logo-cloud:grid-cols-3 @3xl/logo-cloud:grid-cols-4'>
            {logos.map((logo) => (
              <li key={logo.name} className='flex border-e border-b'>
                <Cell logo={logo} />
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  )
}

const cellClassName =
  'text-muted-foreground flex h-20 min-w-0 flex-1 items-center justify-center px-4 @lg/logo-cloud:h-24 @lg/logo-cloud:px-6 @3xl/logo-cloud:h-28'

function Cell({ logo }: { logo: CustomerLogo }) {
  const { href } = logo
  if (!href) {
    return (
      <div className={cellClassName}>
        <LogoCloudLogo logo={logo} />
      </div>
    )
  }
  return (
    <LogoCloudLink
      logo={{ ...logo, href }}
      className={cn(
        cellClassName,
        'hover:bg-muted/60 hover:text-foreground focus-visible:ring-inset transition-[color,background-color] duration-(--motion-press-duration) ease-(--motion-press-fade-easing) forced-colors:hover:outline-2 forced-colors:hover:-outline-offset-2',
      )}
    >
      <LogoCloudLogo logo={logo} />
      <LogoCloudStoryArrow />
    </LogoCloudLink>
  )
}

export { LogoCloud }
