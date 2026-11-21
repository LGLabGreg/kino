'use client'

import {
  type FooterBaseProps,
  type FooterHeading,
  footerColumnClassName,
  type FooterLink,
  FooterLinkItem,
  FooterLegal,
  FooterNewsletter,
  FooterSocial,
  FooterStatusLink,
} from '@/registry/lib/footer-parts'
import { type ReactNode, useId } from 'react'

import { cn } from '@/lib/utils'

/*
 * A footer that leads with the newsletter: what it is and how often it
 * comes, beside the form to sign up, then one row of the logo, the links
 * and the social links, and the legal line. For a site with a short list
 * of pages and a letter worth reading.
 *
 *   <FooterSignup
 *     logo={<a href='/' aria-label='Kino, home'><Logo /></a>}
 *     title='The changelog, once a month'
 *     onSubscribe={subscribe}
 *     links={[{ label: 'Pricing', href: '/pricing' }]}
 *     copyright='© 2026 Kino Labs, Inc.'
 *   />
 */

interface FooterSignupProps extends Omit<FooterBaseProps, 'title'> {
  /** What the letter is, as the footer's heading. */
  title: ReactNode
  /** What's in it and how often it comes. */
  description?: ReactNode
  /** Signs the address up. A throw or a rejected promise says it couldn't. */
  onSubscribe: (email: string) => unknown
  submitLabel?: string
  links: FooterLink[]
  /** The title's level: `h2` under the page's sections. */
  heading?: FooterHeading
}

function FooterSignup({
  logo,
  title,
  description,
  onSubscribe,
  submitLabel,
  links,
  label = 'Footer',
  copyright,
  legal,
  social,
  status,
  themeSwitcher = true,
  heading = 'h2',
  className,
  ...props
}: FooterSignupProps) {
  const titleId = useId()
  const Title = heading
  return (
    <footer
      data-slot='footer-signup'
      className={cn('@container/footer w-full min-w-0 border-t', className)}
      {...props}
    >
      <div
        className={cn(
          footerColumnClassName,
          'flex flex-col gap-12 pt-14 pb-8 @3xl/footer:pt-16',
        )}
      >
        <section
          aria-labelledby={titleId}
          className='grid min-w-0 gap-6 @3xl/footer:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] @3xl/footer:items-center @3xl/footer:gap-16'
        >
          <div className='flex min-w-0 flex-col gap-2'>
            <Title
              id={titleId}
              className='text-2xl leading-tight font-semibold tracking-tight text-balance'
            >
              <bdi>{title}</bdi>
            </Title>
            {description ? (
              <p className='text-muted-foreground max-w-md text-sm text-pretty'>
                <bdi>{description}</bdi>
              </p>
            ) : null}
          </div>
          <FooterNewsletter onSubscribe={onSubscribe} submitLabel={submitLabel} />
        </section>
        <div className='flex min-w-0 flex-col gap-6 border-t pt-8 @3xl/footer:flex-row @3xl/footer:items-center @3xl/footer:gap-10'>
          <div className='flex shrink-0 items-center'>{logo}</div>
          <nav aria-label={label} className='min-w-0 flex-1'>
            <ul className='flex flex-wrap gap-x-6 gap-y-2'>
              {links.map((link) => (
                <li key={link.href} className='flex'>
                  <FooterLinkItem link={link} />
                </li>
              ))}
            </ul>
          </nav>
          {social?.length ? <FooterSocial social={social} className='shrink-0' /> : null}
        </div>
        <FooterLegal
          copyright={copyright}
          legal={legal}
          themeSwitcher={themeSwitcher}
          start={status ? <FooterStatusLink status={status} /> : null}
        />
      </div>
    </footer>
  )
}

export { FooterSignup, type FooterSignupProps }
