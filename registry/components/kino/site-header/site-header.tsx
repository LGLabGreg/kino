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
 * A marketing site's header: the logo, the menus and the actions in one bar
 * across the top. Over the top of the page it stands on the page itself;
 * once the page scrolls, or a menu opens, a surface and a line under it fade
 * in, so it reads over whatever passes beneath. On a phone the menus open
 * in a sheet from the side.
 *
 *   <SiteHeader
 *     logo={<a href='/' aria-label='Kino, home'><Logo /></a>}
 *     items={[{ label: 'Product', links: [...] }, { label: 'Pricing', href: '/pricing' }]}
 *     actions={<a href='/signup' className={buttonVariants()}>Get started</a>}
 *   />
 */
function SiteHeader({
  logo,
  items,
  actions,
  label = 'Main',
  className,
  ...props
}: SiteHeaderProps) {
  const header = useRef<HTMLElement>(null)
  useHeaderScroll(header)
  useHeaderFit(header)
  return (
    <header
      ref={header}
      data-slot='site-header'
      className={cn(
        '@container/site-header group/header sticky top-0 z-40 isolate w-full min-w-0',
        className,
      )}
      {...props}
    >
      {/* The surface, behind the bar: the page shows through it, softened. */}
      <div
        aria-hidden
        className='bg-background/80 pointer-events-none absolute inset-0 -z-10 border-b opacity-0 backdrop-blur-lg transition-opacity duration-(--motion-layout-duration) ease-(--motion-layout-fade-easing) group-data-scrolled/header:opacity-100 group-has-[[aria-haspopup][aria-expanded=true]]/header:opacity-100 forced-colors:bg-[Canvas] forced-colors:opacity-100'
      />
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

export { SiteHeader }
