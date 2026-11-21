'use client'

import {
  type FooterBaseProps,
  footerColumnClassName,
  type FooterGroup,
  FooterGroups,
  type FooterHeading,
  FooterLegal,
  FooterSocial,
  FooterStatusLink,
} from '@/registry/lib/footer-parts'
import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

/*
 * A marketing site's footer as a directory: the logo, a line about the
 * product, its status and its social links at the start, every group of links under its
 * heading beside them, and the legal line at the foot, with the theme
 * switch. In a phone's column the groups sit two to a
 * row under the logo.
 *
 *   <Footer
 *     logo={<a href='/' aria-label='Kino, home'><Logo /></a>}
 *     description='Plan the cycle. Ship it on time.'
 *     groups={[{ label: 'Product', links: [{ label: 'Cycles', href: '/cycles' }] }]}
 *     copyright='© 2026 Kino Labs, Inc.'
 *   />
 */

interface FooterProps extends FooterBaseProps {
  groups: FooterGroup[]
  /** A line or two about the product, under the logo. */
  description?: ReactNode
  /** The groups' headings' level: `h2` under the page's sections. */
  heading?: FooterHeading
}

function Footer({
  logo,
  description,
  groups,
  copyright,
  legal,
  social,
  status,
  themeSwitcher = true,
  heading,
  label,
  className,
  ...props
}: FooterProps) {
  return (
    <footer
      data-slot='footer'
      className={cn('@container/footer w-full min-w-0 border-t', className)}
      {...props}
    >
      <div
        className={cn(
          footerColumnClassName,
          'flex flex-col gap-12 pt-14 pb-8 @3xl/footer:pt-16',
        )}
      >
        <div className='grid min-w-0 gap-10 @3xl/footer:grid-cols-[minmax(0,15rem)_minmax(0,1fr)] @3xl/footer:gap-12 @5xl/footer:grid-cols-[minmax(0,18rem)_minmax(0,1fr)] @5xl/footer:gap-16'>
          <div className='flex min-w-0 flex-col items-start gap-4'>
            <div className='flex shrink-0 items-center'>{logo}</div>
            {description ? (
              <p className='text-muted-foreground max-w-xs text-sm text-pretty'>
                <bdi>{description}</bdi>
              </p>
            ) : null}
            {status ? <FooterStatusLink status={status} /> : null}
            {social?.length ? <FooterSocial social={social} className='mt-1' /> : null}
          </div>
          <FooterGroups groups={groups} heading={heading} label={label} />
        </div>
        <FooterLegal
          className='border-t pt-6'
          copyright={copyright}
          legal={legal}
          themeSwitcher={themeSwitcher}
        />
      </div>
    </footer>
  )
}

export { Footer, type FooterProps }
