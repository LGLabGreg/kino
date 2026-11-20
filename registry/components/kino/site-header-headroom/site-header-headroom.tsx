'use client'

import {
  SiteHeaderNav,
  siteHeaderActionsClassName,
  siteHeaderColumnClassName,
  siteHeaderMenuClassName,
  siteHeaderNavClassName,
  SiteHeaderPhoneMenu,
  type SiteHeaderProps,
  useHeaderFit,
  useHeaderScroll,
} from '@/registry/lib/site-header-parts'
import { useRef } from 'react'

import { cn } from '@/lib/utils'

/*
 * A marketing site's header that steps aside while the visitor reads: it
 * slides up out of the way as the page scrolls down, and back the moment
 * they scroll up, or when focus comes into it. On a phone the menus open
 * in a sheet from the side.
 *
 *   <SiteHeaderHeadroom
 *     logo={<a href='/' aria-label='Kino, home'><Logo /></a>}
 *     items={[{ label: 'Product', links: [...] }, { label: 'Pricing', href: '/pricing' }]}
 *     actions={<a href='/signup' className={buttonVariants()}>Get started</a>}
 *   />
 */
function SiteHeaderHeadroom({
  logo,
  items,
  actions,
  label = 'Main',
  className,
  ...props
}: SiteHeaderProps) {
  const header = useRef<HTMLElement>(null)
  useHeaderScroll(header, { hides: true })
  useHeaderFit(header)
  return (
    <header
      ref={header}
      data-slot='site-header'
      className={cn(
        '@container/site-header group/header bg-background/90 sticky top-0 z-40 w-full min-w-0 border-b backdrop-blur-lg',
        // It slides up by its own height, its line included, and back down.
        'transition-[translate] duration-(--motion-layout-duration) ease-(--motion-layout-easing) data-hidden:-translate-y-full data-hidden:duration-(--motion-exit-duration) data-hidden:ease-(--motion-exit-easing) motion-reduce:transition-none',
        className,
      )}
      {...props}
    >
      <div className={cn(siteHeaderColumnClassName, 'flex h-16 items-center gap-6')}>
        <div data-site-header-part='start' className='flex shrink-0 items-center'>
          {logo}
        </div>
        <SiteHeaderNav items={items} label={label} className={siteHeaderNavClassName} />
        <div className='ms-auto flex items-center gap-2'>
          {actions ? (
            <div data-site-header-part='actions' className={siteHeaderActionsClassName}>
              {actions}
            </div>
          ) : null}
          <div className={siteHeaderMenuClassName}>
            <SiteHeaderPhoneMenu
              logo={logo}
              items={items}
              actions={actions}
              label={label}
            />
          </div>
        </div>
      </div>
    </header>
  )
}

export { SiteHeaderHeadroom }
