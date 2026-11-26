'use client'

import { withoutTransition } from '@/registry/lib/resize'
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
import { type RefObject, useEffect, useRef } from 'react'

import { cn } from '@/lib/utils'

/*
 * A marketing site's header that floats. Over the top of the page its logo,
 * menus and actions sit on the page's own edges, the menus centred; once the
 * page scrolls they draw in together and a floating bar forms around them, held off
 * the top, so the page reads past it on both sides. On a phone the menus
 * open in a sheet from the side.
 *
 *   <SiteHeaderIsland
 *     logo={<a href='/' aria-label='Kino, home'><Logo /></a>}
 *     items={[{ label: 'Product', links: [...] }, { label: 'Pricing', href: '/pricing' }]}
 *     actions={<a href='/signup' className={buttonVariants()}>Get started</a>}
 *   />
 */
function SiteHeaderIsland({
  logo,
  items,
  actions,
  label = 'Main',
  className,
  ...props
}: SiteHeaderProps) {
  const header = useRef<HTMLElement>(null)
  const row = useRef<HTMLDivElement>(null)
  useHeaderScroll(header, { draws: true })
  useHeaderFit(header)
  useIslandLayout(row)
  // Each part draws in, towards the middle whichever way the text reads.
  const drawIn =
    'transition-[translate] duration-(--motion-layout-duration) ease-(--motion-layout-easing) motion-reduce:transition-none'
  return (
    <header
      ref={header}
      data-slot='site-header'
      className={cn(
        // Only its parts take the pointer, so the page beside the drawn-in bar can be used.
        '@container/site-header group/header pointer-events-none sticky top-0 z-40 w-full min-w-0 pt-2',
        className,
      )}
      {...props}
    >
      <div className={siteHeaderColumnClassName}>
        <div
          ref={row}
          className='relative isolate grid h-14 grid-cols-[1fr_auto_1fr] items-center gap-6 [--site-header-inset:0px] [--site-header-nav-shift:0px]'
        >
          {/*
           * The bar, as wide as the row and a margin past it: clipped in to
           * the drawn-in parts while the page is scrolled, so it forms around
           * them on the compositor, with nothing laid out again.
           */}
          <div
            aria-hidden
            className='bg-background/80 ring-foreground/12 pointer-events-none absolute -inset-x-3 inset-y-0 -z-10 rounded-[calc(var(--control-radius)+--spacing(3))] opacity-0 shadow-lg shadow-black/8 ring-1 backdrop-blur-lg transition-[opacity,clip-path] duration-(--motion-layout-duration) ease-[var(--motion-layout-fade-easing),var(--motion-layout-easing)] [clip-path:inset(0_0_round_calc(var(--control-radius)+--spacing(3)))] group-data-scrolled/header:opacity-100 group-data-drawn/header:[clip-path:inset(0_var(--site-header-inset)_round_calc(var(--control-radius)+--spacing(3)))] group-has-[[aria-haspopup][aria-expanded=true]]/header:opacity-100 motion-reduce:transition-[opacity] dark:shadow-black/40 forced-colors:bg-[Canvas]'
          />
          <div
            data-site-header-part='start'
            className={cn(
              'pointer-events-auto flex min-w-0 items-center justify-self-start',
              drawIn,
              'group-data-drawn/header:translate-x-(--site-header-inset) rtl:group-data-drawn/header:-translate-x-(--site-header-inset)',
            )}
          >
            {logo}
          </div>
          <div
            data-site-header-part='nav'
            className={cn(
              'pointer-events-auto min-w-0',
              drawIn,
              'group-data-drawn/header:translate-x-(--site-header-nav-shift) rtl:group-data-drawn/header:-translate-x-(--site-header-nav-shift)',
            )}
          >
            <SiteHeaderNav
              items={items}
              label={label}
              className={siteHeaderNavClassName}
            />
          </div>
          <div
            data-site-header-part='end'
            className={cn(
              'pointer-events-auto flex items-center gap-2 justify-self-end',
              drawIn,
              'group-data-drawn/header:-translate-x-(--site-header-inset) rtl:group-data-drawn/header:translate-x-(--site-header-inset)',
            )}
          >
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
      </div>
    </header>
  )
}

/**
 * Measures where each part of the row draws in to, as the variables
 * `--site-header-inset` (each end, and the bar's clip) and
 * `--site-header-nav-shift`, again whenever any part changes size.
 */
function useIslandLayout(ref: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const row = ref.current
    if (!row) return
    const part = (name: string) =>
      row.querySelector<HTMLElement>(`:scope > [data-site-header-part=${name}]`)
    const start = part('start')
    const nav = part('nav')
    const end = part('end')
    if (!start || !nav || !end) return
    const measure = () => {
      // Where the menus start at rest, from the row's start edge whichever way the text reads.
      const rtl = getComputedStyle(row).direction === 'rtl'
      const navAt = rtl
        ? row.clientWidth - nav.offsetLeft - nav.offsetWidth
        : nav.offsetLeft
      const layout = islandLayout({
        row: row.clientWidth,
        start: start.offsetWidth,
        nav: nav.offsetWidth,
        navAt,
        end: end.offsetWidth,
        gap: Number.parseFloat(getComputedStyle(row).columnGap) || 0,
      })
      row.style.setProperty('--site-header-inset', `${layout.inset}px`)
      row.style.setProperty('--site-header-nav-shift', `${layout.navShift}px`)
    }
    // The first places them where the page already is, with nothing moving.
    withoutTransition(row, measure, { subtree: true })
    const observer = new ResizeObserver(measure)
    for (const each of [row, start, nav, end]) observer.observe(each)
    return () => observer.disconnect()
  }, [ref])
}

/**
 * Where a row's parts sit once drawn in: side by side, a `gap` apart, as one
 * group centred in the row. `inset` is how far each end moves in from its
 * edge, and `navShift` how far the menus move from where they rest, `navAt`
 * from the row's start, towards the end, so they sit beside the start. Never drawn out past the edges,
 * where the row has no room to spare, and not at all without the menus,
 * on a phone. Widths in pixels, towards the end
 * whichever way the text reads.
 */
function islandLayout({
  row,
  start,
  nav,
  navAt,
  end,
  gap,
}: {
  row: number
  start: number
  nav: number
  navAt: number
  end: number
  gap: number
}): { inset: number; navShift: number } {
  // On a phone the menus are in the menu: the ends stay put and the bar spans the row.
  if (nav === 0) return { inset: 0, navShift: 0 }
  // A part with nothing in it, such as no actions, takes no gap.
  const parts = [start, nav, end].filter((width) => width > 0)
  const group = start + nav + end + gap * (parts.length - 1)
  const inset = Math.max(0, Math.floor((row - group) / 2))
  // The menus' start once drawn in, less where they rest.
  const navShift = inset + start + gap - navAt
  return { inset, navShift: inset === 0 ? 0 : Math.round(navShift) }
}

export { islandLayout, SiteHeaderIsland }
