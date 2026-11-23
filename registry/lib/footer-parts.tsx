'use client'

import { Badge } from '@/registry/components/kino/badge'
import { ThemeSegmentedControl } from '@/registry/components/kino/theme-switcher'
import { pageColumnClassName } from '@/registry/lib/hero-parts'
import { NoticeIcon } from '@/registry/lib/notice'
import type { ComponentProps, ReactNode } from 'react'

import { cn } from '@/lib/utils'

/*
 * What the Footer blocks share: the links they take, the groups of links
 * under their headings, the status of the service, the social links, the
 * legal line and the theme switch, so every footer reads and moves the same.
 */

/** A page the footer links to. */
interface FooterLink {
  label: string
  href: string
  /** A word beside the label, such as Hiring or New. */
  badge?: ReactNode
  /** Opens in a new tab, and says so to a screen reader. */
  external?: boolean
  /** The page the visitor is on: marked for them and for screen readers. */
  current?: boolean
}

/** A group of links under a heading, such as Product. */
interface FooterGroup {
  label: string
  links: FooterLink[]
}

/** A social profile: its icon, named for screen readers by `label`. */
interface FooterSocialLink {
  label: string
  href: string
  icon: ReactNode
}

/** How the service is doing, from the status page. */
type FooterStatusState = 'operational' | 'degraded' | 'outage'

interface FooterStatus {
  state: FooterStatusState
  /** The status page. */
  href: string
  /** What it says; each state has its own words by default. */
  label?: string
}

/** The levels a group's heading takes: `h2` under the page's sections, unless the footer sits lower. */
type FooterHeading = 'h2' | 'h3' | 'h4'

/** What every Footer block takes. */
interface FooterBaseProps extends Omit<ComponentProps<'footer'>, 'children'> {
  /** A link to the home page, around the logo. */
  logo: ReactNode
  /** The company's line, such as © 2026 Kino Labs, Inc. Given, not worked out, so a page built once never shows a stale year. */
  copyright: ReactNode
  /** Privacy, Terms and the like, on the legal line. */
  legal?: FooterLink[]
  social?: FooterSocialLink[]
  status?: FooterStatus
  /** Light, dark or the device's own, at the end of the legal line. */
  themeSwitcher?: boolean
  /** The links' name for screen readers. */
  label?: string
}

/** The footer's column: the Hero's and the Site header's, so their edges line up. */
const footerColumnClassName = pageColumnClassName

/** A link's look: quiet until it is hovered, with room enough to be pressed. */
const footerLinkClassName =
  'text-muted-foreground hover:text-foreground aria-[current=page]:text-foreground inline-flex min-h-6 max-w-full items-center gap-2 rounded-(--control-radius-xs) text-sm transition-[color,box-shadow] duration-(--motion-press-duration) ease-(--motion-press-fade-easing) focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-hidden aria-[current=page]:font-medium'

/** A link of the footer's, with its badge, and a word for screen readers when it opens a new tab. */
function FooterLinkItem({ link, className }: { link: FooterLink; className?: string }) {
  return (
    <a
      href={link.href}
      aria-current={link.current ? 'page' : undefined}
      {...(link.external ? { target: '_blank', rel: 'noreferrer' } : {})}
      className={cn(footerLinkClassName, className)}
    >
      <bdi className='min-w-0 wrap-break-word'>{link.label}</bdi>
      {/* In the text colour: a tint of the link's quieter one leaves its word under 4.5:1. */}
      {link.badge ? (
        <Badge variant='secondary' className='text-foreground'>
          {link.badge}
        </Badge>
      ) : null}
      {link.external ? <span className='sr-only'>(opens in a new tab)</span> : null}
    </a>
  )
}

/** Every group side by side once there is room, up to five. */
const COLUMNS = {
  2: '',
  3: '@md/groups:grid-cols-3',
  4: '@xl/groups:grid-cols-4',
  5: '@xl/groups:grid-cols-3 @3xl/groups:grid-cols-5',
} as const

/**
 * The groups of links, each a heading over its list, in one labelled
 * navigation. Two to a row in a phone's column, and up to five side by
 * side once there is room for them.
 */
function FooterGroups({
  groups,
  label = 'Footer',
  heading = 'h2',
  className,
}: {
  groups: FooterGroup[]
  /** The navigation's name for screen readers. */
  label?: string
  heading?: FooterHeading
  className?: string
}) {
  const Heading = heading
  return (
    <nav
      aria-label={label}
      data-slot='footer-groups'
      className={cn('@container/groups min-w-0', className)}
    >
      <div
        className={cn(
          'grid min-w-0 grid-cols-2 gap-x-6 gap-y-10',
          COLUMNS[Math.min(Math.max(groups.length, 2), 5) as keyof typeof COLUMNS],
        )}
      >
        {groups.map((group) => (
          <div key={group.label} className='flex min-w-0 flex-col gap-3'>
            <Heading className='text-sm font-medium'>
              <bdi>{group.label}</bdi>
            </Heading>
            <ul className='flex flex-col gap-1.5'>
              {group.links.map((link) => (
                <li key={link.href} className='flex min-w-0'>
                  <FooterLinkItem link={link} />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </nav>
  )
}

/** Each state's own words and the icon beside them, so it never relies on colour alone. */
const STATUS = {
  operational: { label: 'All systems normal', notice: 'success' },
  degraded: { label: 'Some systems degraded', notice: 'warning' },
  outage: { label: 'Major outage', notice: 'error' },
} as const satisfies Record<FooterStatusState, { label: string; notice: string }>

/** How the service is doing, as a link to the status page. */
function FooterStatusLink({ status }: { status: FooterStatus }) {
  const { label, notice } = STATUS[status.state]
  return (
    <a
      href={status.href}
      data-slot='footer-status'
      data-state={status.state}
      className={cn(footerLinkClassName, 'w-fit')}
    >
      <NoticeIcon type={notice} />
      <bdi className='min-w-0 wrap-break-word'>{status.label ?? label}</bdi>
    </a>
  )
}

/** The social profiles, as icon links named for screen readers. */
function FooterSocial({
  social,
  className,
}: {
  social: FooterSocialLink[]
  className?: string
}) {
  return (
    <ul
      data-slot='footer-social'
      className={cn('-mx-1.5 flex flex-wrap items-center', className)}
    >
      {social.map((link) => (
        <li key={link.href}>
          <a
            href={link.href}
            aria-label={link.label}
            target='_blank'
            rel='noreferrer'
            className="text-muted-foreground hover:text-foreground hover:bg-muted flex size-8 items-center justify-center rounded-(--control-radius-sm) transition-[color,background-color,box-shadow] duration-(--motion-press-duration) ease-(--motion-press-fade-easing) focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-hidden [&_svg:not([class*='size-'])]:size-4"
          >
            {link.icon}
            <span className='sr-only'>(opens in a new tab)</span>
          </a>
        </li>
      ))}
    </ul>
  )
}

/**
 * The line at the foot: the company, the legal links and, at its end, the
 * theme switch. It wraps onto a second line where there's no room.
 */
function FooterLegal({
  copyright,
  legal,
  themeSwitcher,
  start,
  className,
}: {
  copyright: ReactNode
  legal?: FooterLink[]
  themeSwitcher?: boolean
  /** Before the company's line, such as the social links. */
  start?: ReactNode
  className?: string
}) {
  return (
    <div
      data-slot='footer-legal'
      className={cn(
        'flex min-w-0 flex-col gap-4 @2xl/footer:flex-row @2xl/footer:items-center',
        className,
      )}
    >
      <div className='flex min-w-0 flex-1 flex-wrap items-center gap-x-6 gap-y-2'>
        {start}
        <p className='text-muted-foreground text-sm'>
          <bdi>{copyright}</bdi>
        </p>
        {legal?.length ? (
          <nav aria-label='Legal'>
            <ul className='flex flex-wrap gap-x-5 gap-y-1'>
              {legal.map((link) => (
                <li key={link.href} className='flex'>
                  <FooterLinkItem link={link} />
                </li>
              ))}
            </ul>
          </nav>
        ) : null}
      </div>
      {themeSwitcher ? (
        <ThemeSegmentedControl iconOnly className='w-fit shrink-0' />
      ) : null}
    </div>
  )
}

export {
  footerColumnClassName,
  FooterGroups,
  FooterLegal,
  footerLinkClassName,
  FooterLinkItem,
  FooterSocial,
  FooterStatusLink,
  STATUS as footerStatusLabels,
}
export type {
  FooterBaseProps,
  FooterGroup,
  FooterHeading,
  FooterLink,
  FooterSocialLink,
  FooterStatus,
  FooterStatusState,
}
