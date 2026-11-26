'use client'

import { buttonVariants } from '@/registry/components/kino/button'
import {
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from '@/registry/components/kino/drawer'
import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  NavigationMenuTrigger,
} from '@/registry/components/kino/navigation-menu'
import { IconPlaceholder } from '@/registry/icons/icon-placeholder'
import { pageColumnClassName } from '@/registry/lib/hero-parts'
import { withoutTransition } from '@/registry/lib/resize'
import { scrollerOf } from '@/registry/lib/scroll'
import {
  type ComponentProps,
  type ReactNode,
  type RefObject,
  useEffect,
  useRef,
  useState,
} from 'react'

import { cn } from '@/lib/utils'

/*
 * What the Site header blocks share: the links they take, the row of menus a
 * wide screen shows, the sheet a phone opens instead, the button that opens it
 * and the way a header follows the page's scroll.
 */

/** A page the header links to. */
interface SiteHeaderLink {
  label: string
  href: string
  /** A line under the label, in a section's panel. */
  description?: string
  /** An icon beside the label, in a section's panel and the phone's menu. */
  icon?: ReactNode
  /** The page the visitor is on: marked for them and for screen readers. */
  current?: boolean
}

/** A group of links that opens as a panel, such as Product. */
interface SiteHeaderSection {
  label: string
  links: SiteHeaderLink[]
  /** A card beside the links in the panel, such as what's new: a `NavigationMenuLink`. */
  feature?: ReactNode
}

type SiteHeaderItem = SiteHeaderLink | SiteHeaderSection

/** What every Site header block takes. */
interface SiteHeaderProps extends Omit<ComponentProps<'header'>, 'children'> {
  /** A link to the home page, around the logo. */
  logo: ReactNode
  items: SiteHeaderItem[]
  /** Links in a Button's look, such as Sign in and Get started: the main one last. */
  actions?: ReactNode
  /** The navigation's name for screen readers. */
  label?: string
}

function isSection(item: SiteHeaderItem): item is SiteHeaderSection {
  return 'links' in item
}

/** The header's column: the Hero's, so their edges line up. */
const siteHeaderColumnClassName = pageColumnClassName

/*
 * Each part's room: the actions show from 36rem, where they fit beside the
 * logo and the menu's button, and the menus from 48rem, where four short
 * ones fit, unless `useHeaderFit` finds they don't: then they step out of
 * the row, kept measurable but unseen, and the phone's menu holds them.
 */
const siteHeaderNavClassName =
  'hidden @3xl/site-header:flex group-data-crowded/header:invisible group-data-crowded/header:absolute'
const siteHeaderActionsClassName =
  'hidden items-center gap-2 @xl/site-header:flex [&>*]:shrink-0'
const siteHeaderMenuClassName = '@3xl/site-header:group-not-data-crowded/header:hidden'

/** What a section's link shows, in its panel and on a phone: its icon in a tile, its label and the line under it. */
function SiteHeaderLinkBody({ link }: { link: SiteHeaderLink }) {
  return (
    <>
      {link.icon ? (
        <span className="bg-background text-muted-foreground flex size-9 shrink-0 items-center justify-center rounded-(--control-radius) border [&_svg:not([class*='size-'])]:size-4">
          {link.icon}
        </span>
      ) : null}
      <span className='flex min-w-0 flex-col gap-0.5'>
        <span className='leading-snug font-medium'>{link.label}</span>
        {link.description ? (
          <span className='text-muted-foreground text-[0.8125rem] leading-snug text-pretty'>
            {link.description}
          </span>
        ) : null}
      </span>
    </>
  )
}

/** A link in a section's panel. */
function PanelLink({ link }: { link: SiteHeaderLink }) {
  return (
    <NavigationMenuLink
      href={link.href}
      active={link.current}
      className='flex-row items-start gap-3'
    >
      <SiteHeaderLinkBody link={link} />
    </NavigationMenuLink>
  )
}

/**
 * A section's panel: its links in one column, or two once there are four,
 * and its feature beside them.
 */
function SectionPanel({ section }: { section: SiteHeaderSection }) {
  const twoColumns = section.links.length >= 4
  return (
    <NavigationMenuContent
      // Its links are in the page from the start, hidden, so search engines find them.
      keepMounted
      className={cn(
        '@container',
        twoColumns ? 'w-[36rem]' : 'w-80',
        section.feature && (twoColumns ? 'w-[48rem]' : 'w-[34rem]'),
      )}
    >
      <div className={cn('grid gap-2', section.feature && '@lg:grid-cols-[1fr_13rem]')}>
        <div
          className={cn('grid content-start gap-0.5', twoColumns && '@md:grid-cols-2')}
        >
          {section.links.map((link) => (
            <PanelLink key={link.href} link={link} />
          ))}
        </div>
        {section.feature}
      </div>
    </NavigationMenuContent>
  )
}

/** The row of menus a wide screen shows: a section opens its panel, a link goes straight to its page. */
function SiteHeaderNav({
  items,
  label,
  className,
}: {
  items: SiteHeaderItem[]
  label: string
  className?: string
}) {
  return (
    <NavigationMenu aria-label={label} className={className}>
      <NavigationMenuList>
        {items.map((item) =>
          isSection(item) ? (
            <NavigationMenuItem key={item.label}>
              <NavigationMenuTrigger>{item.label}</NavigationMenuTrigger>
              <SectionPanel section={item} />
            </NavigationMenuItem>
          ) : (
            <NavigationMenuItem key={item.href}>
              <NavigationMenuLink href={item.href} active={item.current}>
                {item.label}
              </NavigationMenuLink>
            </NavigationMenuItem>
          ),
        )}
      </NavigationMenuList>
    </NavigationMenu>
  )
}

/**
 * Three lines that fold into a cross while the menu its button opens is
 * open: the outer two close onto the middle as it fades, then turn into a
 * cross, and turn back before they part again.
 */
function MenuToggleIcon({ className }: { className?: string }) {
  // The lines meet in the first part of the morph and turn in the rest.
  const slide =
    'transition-[transform] duration-[calc(var(--motion-morph-duration)*0.5)] ease-(--motion-morph-fade-easing) group-not-aria-expanded/menu:delay-[calc(var(--motion-morph-duration)*0.4)] motion-reduce:transition-none'
  const turn =
    '[transform-box:fill-box] origin-center transition-[transform] duration-(--motion-morph-duration) ease-(--motion-morph-easing) group-aria-expanded/menu:delay-[calc(var(--motion-morph-duration)*0.4)] motion-reduce:transition-none'
  return (
    <svg
      aria-hidden
      viewBox='0 0 16 16'
      fill='none'
      stroke='currentColor'
      strokeWidth='1.5'
      strokeLinecap='round'
      data-slot='site-header-menu-icon'
      className={cn('size-4', className)}
    >
      <g className={cn(slide, 'group-aria-expanded/menu:[transform:translateY(4px)]')}>
        <path
          d='M2.5 4h11'
          className={cn(turn, 'group-aria-expanded/menu:[transform:rotate(45deg)]')}
        />
      </g>
      <path
        d='M2.5 8h11'
        className='transition-opacity duration-[calc(var(--motion-morph-duration)*0.5)] ease-(--motion-morph-fade-easing) group-aria-expanded/menu:opacity-0'
      />
      <g className={cn(slide, 'group-aria-expanded/menu:[transform:translateY(-4px)]')}>
        <path
          d='M2.5 12h11'
          className={cn(turn, 'group-aria-expanded/menu:[transform:rotate(-45deg)]')}
        />
      </g>
    </svg>
  )
}

/** The look of the button that opens the phone's menu. */
const menuButtonClassName = cn(
  buttonVariants({ variant: 'ghost', size: 'icon' }),
  'group/menu',
)

/** A row of the phone's menu: a link, or a section's trigger, as tall as a thumb needs. */
const phoneRowClassName =
  'focus-visible:ring-ring/50 hover:bg-muted/60 aria-[current=page]:bg-muted flex min-h-11 w-full items-center gap-3 rounded-(--control-radius-capped) px-(--control-padding) text-base font-medium transition-colors duration-(--motion-press-duration) ease-(--motion-press-fade-easing) focus-visible:ring-3 focus-visible:outline-hidden forced-colors:aria-[current=page]:underline'

/** The actions at the foot of the phone's menu, each its width, the main one first. */
const phoneActionsClassName = 'flex flex-col-reverse gap-2 [&>*]:w-full'

/** One screen of the phone's menu: the list, or a section's links. It slides aside while the other shows. */
const screenClassName =
  'col-start-1 row-start-1 flex min-w-0 flex-col transition-[opacity,translate] duration-(--motion-layout-duration) ease-[var(--motion-layout-fade-easing),var(--motion-layout-easing)] motion-reduce:transition-opacity'

function ChevronIcon({ back = false }: { back?: boolean }) {
  return back ? (
    <IconPlaceholder
      lucide='ChevronLeftIcon'
      tabler='IconChevronLeft'
      hugeicons='ArrowLeft01Icon'
      phosphor='CaretLeftIcon'
      remixicon='RiArrowLeftSLine'
      aria-hidden
      className='size-4 shrink-0 rtl:-scale-x-100'
    />
  ) : (
    <IconPlaceholder
      lucide='ChevronRightIcon'
      tabler='IconChevronRight'
      hugeicons='ArrowRight01Icon'
      phosphor='CaretRightIcon'
      remixicon='RiArrowRightSLine'
      aria-hidden
      className='text-muted-foreground ms-auto size-4 shrink-0 rtl:-scale-x-100'
    />
  )
}

/**
 * The phone's menu, opened by a button in the header: a sheet from the side
 * holding the list of links and sections, with the logo at its top and the
 * actions at its foot, each the sheet's width, the main one first. A section slides in as a screen of its own, over the list as it
 * steps back, and Back slides it away again. Focus goes to Back as a section
 * opens and to its row as it closes. Following a link closes the sheet.
 */
function SiteHeaderPhoneMenu({
  logo,
  items,
  actions,
  label,
}: {
  logo: ReactNode
  items: SiteHeaderItem[]
  actions?: ReactNode
  label: string
}) {
  const [open, setOpen] = useState(false)
  // The section on screen, and the last one shown, which stays drawn as it slides away.
  const [section, setSection] = useState<string | null>(null)
  const [drawn, setDrawn] = useState<string | null>(null)
  const back = useRef<HTMLButtonElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const moved = useRef(false)

  useEffect(() => {
    if (!moved.current) return
    moved.current = false
    if (section) back.current?.focus()
    else
      list.current
        ?.querySelector<HTMLElement>(`[data-section="${CSS.escape(drawn ?? '')}"]`)
        ?.focus()
  }, [section, drawn])

  const go = (to: string | null) => {
    moved.current = true
    if (to) setDrawn(to)
    setSection(to)
  }
  const close = () => setOpen(false)
  const shown = items.find((item) => isSection(item) && item.label === drawn)

  return (
    <Drawer
      side='end'
      open={open}
      onOpenChange={(next) => {
        // Opened again, it starts from the list.
        if (next) setSection(null)
        setOpen(next)
      }}
    >
      <DrawerTrigger aria-label='Menu' className={menuButtonClassName}>
        <MenuToggleIcon />
      </DrawerTrigger>
      <DrawerContent
        className='w-[min(24rem,calc(100%-(--spacing(12))))]'
        // Any link in it closes it, the logo and the actions too, so it never stays over the page it opened.
        onClick={(event) => {
          if (event.target instanceof Element && event.target.closest('a[href]')) close()
        }}
      >
        <DrawerHeader className='border-b'>
          {/* The logo where the header showed it; the title names the sheet for screen readers. */}
          <DrawerTitle className='sr-only'>Menu</DrawerTitle>
          {logo}
        </DrawerHeader>
        <DrawerBody className='p-0'>
          <nav aria-label={label} className='grid overflow-x-clip p-(--surface-padding)'>
            <div
              ref={list}
              inert={section !== null}
              className={cn(
                screenClassName,
                section !== null &&
                  '-translate-x-(--site-header-recede,25%) opacity-0 rtl:translate-x-(--site-header-recede,25%)',
              )}
            >
              <ul className='flex flex-col'>
                {items.map((item) => (
                  <li key={item.label} className='border-b last:border-b-0'>
                    {isSection(item) ? (
                      <button
                        type='button'
                        data-section={item.label}
                        onClick={() => go(item.label)}
                        className={phoneRowClassName}
                      >
                        {item.label}
                        <ChevronIcon />
                      </button>
                    ) : (
                      <a
                        href={item.href}
                        aria-current={item.current ? 'page' : undefined}
                        className={phoneRowClassName}
                      >
                        {item.label}
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </div>
            <div
              inert={section === null}
              className={cn(
                screenClassName,
                'gap-2',
                section === null && 'translate-x-full opacity-0 rtl:-translate-x-full',
              )}
            >
              <button
                ref={back}
                type='button'
                onClick={() => go(null)}
                className={cn(
                  phoneRowClassName,
                  'text-muted-foreground hover:text-foreground w-fit gap-1.5 text-sm transition-colors duration-(--motion-press-duration) ease-(--motion-press-fade-easing)',
                )}
              >
                <ChevronIcon back />
                Back
              </button>
              {shown && isSection(shown) ? (
                <>
                  <h3 className='px-(--control-padding) text-lg font-semibold'>
                    {shown.label}
                  </h3>
                  <ul className='flex flex-col gap-1'>
                    {shown.links.map((link) => (
                      <li key={link.href}>
                        <a
                          href={link.href}
                          aria-current={link.current ? 'page' : undefined}
                          className='focus-visible:ring-ring/50 hover:bg-muted aria-[current=page]:bg-muted flex items-start gap-3 rounded-(--control-radius-capped) p-(--control-padding) transition-colors duration-(--motion-press-duration) ease-(--motion-press-fade-easing) focus-visible:ring-3 focus-visible:outline-hidden'
                        >
                          <SiteHeaderLinkBody link={link} />
                        </a>
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
            </div>
          </nav>
        </DrawerBody>
        {actions ? (
          <DrawerFooter className={phoneActionsClassName}>{actions}</DrawerFooter>
        ) : null}
      </DrawerContent>
    </Drawer>
  )
}

/**
 * Whether a header's parts fit side by side in its row: the logo, the menus
 * and the actions, `gap` apart, in `row` pixels. A part with nothing in it,
 * such as actions hidden on a narrow screen, takes no gap.
 */
function headerFits({
  row,
  start,
  nav,
  actions,
  gap,
}: {
  row: number
  start: number
  nav: number
  actions: number
  gap: number
}) {
  const parts = [start, nav, actions].filter((width) => width > 0)
  return parts.reduce((sum, width) => sum + width, 0) + gap * (parts.length - 1) <= row
}

/**
 * Marks the header `data-crowded` while its menus don't fit beside the logo
 * and the actions, such as long labels in a narrow window, so the phone's
 * menu holds them instead. The menus stay measurable while they are out of
 * the row, so it knows when they fit again. The row is the logo's parent,
 * the part marked `data-site-header-part='start'`.
 */
function useHeaderFit(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const header = ref.current
    const start = header?.querySelector<HTMLElement>('[data-site-header-part=start]')
    const nav = header?.querySelector<HTMLElement>('[data-slot=navigation-menu]')
    const actions = header?.querySelector<HTMLElement>('[data-site-header-part=actions]')
    const row = start?.parentElement
    if (!header || !start || !nav || !row) return
    const measure = () => {
      const style = getComputedStyle(row)
      const fits =
        nav.offsetWidth === 0 ||
        headerFits({
          row:
            row.clientWidth -
            (Number.parseFloat(style.paddingInlineStart) || 0) -
            (Number.parseFloat(style.paddingInlineEnd) || 0),
          start: start.offsetWidth,
          nav: nav.offsetWidth,
          actions: actions?.offsetWidth ?? 0,
          gap: Number.parseFloat(style.columnGap) || 0,
        })
      header.toggleAttribute('data-crowded', !fits)
    }
    measure()
    const observer = new ResizeObserver(measure)
    for (const each of [row, start, nav, actions]) if (each) observer.observe(each)
    return () => observer.disconnect()
  }, [ref])
}

/** Where the page has scrolled to, as the header shows it. */
interface HeaderScroll {
  /** Past the top: the header shows its surface. */
  scrolled: boolean
  /** Moved out of the way, while the visitor reads on down. */
  hidden: boolean
}

/** How far the page moves one way before a hiding header follows it, in pixels. */
const HIDE_AFTER_PX = 8

/**
 * Where a header stands after the page scrolls from `from` to `to`. It shows
 * its surface once the page is past the top. With `hides`, it moves out of
 * the way once the page has scrolled past its height and on down by
 * `HIDE_AFTER_PX`, and comes back as soon as the page moves up by as much,
 * or reaches the top. `anchor` is where the page last turned.
 */
function headerScroll({
  previous,
  anchor,
  to,
  height,
  hides,
}: {
  previous: HeaderScroll
  anchor: number
  to: number
  height: number
  hides: boolean
}): { state: HeaderScroll; anchor: number } {
  const scrolled = to > 0
  if (!hides || to <= height) return { state: { scrolled, hidden: false }, anchor: to }
  const moved = to - anchor
  if (previous.hidden ? moved < -HIDE_AFTER_PX : moved > HIDE_AFTER_PX) {
    return { state: { scrolled, hidden: !previous.hidden }, anchor: to }
  }
  // Still going the same way: the turn point follows, so a turn counts from where it happens.
  const sameWay = previous.hidden ? moved > 0 : moved < 0
  return {
    state: { scrolled, hidden: previous.hidden },
    anchor: sameWay ? to : anchor,
  }
}

/**
 * Follows the scroll of the box the header sits in, or the page, and marks
 * the header `data-scrolled` past the top and, with `hides`, `data-hidden`
 * while it is out of the way. It writes the attributes itself, so nothing
 * renders as the page scrolls, and writes the first of them with no
 * transition, so a page loaded part way down shows its header settled.
 * A header that holds keyboard focus or an open menu never hides.
 *
 * With `draws`, it also marks `data-drawn` as it marks `data-scrolled`, but
 * holds it while the header is in use, under the pointer or with a menu
 * open, so what moves on it never slides out from under the pointer.
 */
function useHeaderScroll(
  ref: RefObject<HTMLElement | null>,
  { hides = false, draws = false }: { hides?: boolean; draws?: boolean } = {},
) {
  useEffect(() => {
    const header = ref.current
    if (!header) return
    // The box that scrolls the header, or the page. One whose content arrives
    // later only scrolls later, so the first scroll from any box around the
    // header makes it the one followed.
    let box = scrollerOf(header)
    const position = () => (box ? box.scrollTop : window.scrollY)
    let state: HeaderScroll = { scrolled: false, hidden: false }
    let drawn = false
    let pointed = false
    let anchor = position()
    const open = () => header.querySelector('[data-popup-open]') !== null
    const write = () => {
      header.toggleAttribute('data-scrolled', state.scrolled)
      header.toggleAttribute('data-hidden', state.hidden)
      if (!draws) return
      if (!pointed && !open()) drawn = state.scrolled
      header.toggleAttribute('data-drawn', drawn)
    }
    const update = () => {
      const next = headerScroll({
        previous: state,
        anchor,
        to: Math.max(0, position()),
        height: header.offsetHeight,
        hides,
      })
      anchor = next.anchor
      // Focus from the keyboard only: a link clicked with a mouse keeps focus too.
      const busy = header.matches(':has(:focus-visible)') || open()
      state = busy ? { ...next.state, hidden: false } : next.state
      write()
    }
    // Focus coming in by keyboard brings a hidden header back.
    const reveal = (event: FocusEvent) => {
      if (!state.hidden || !(event.target instanceof Element)) return
      if (!event.target.matches(':focus-visible')) return
      state = { ...state, hidden: false }
      write()
    }
    const enter = () => (pointed = true)
    const leave = () => {
      pointed = false
      write()
    }
    // A menu that closes lets what it held catch up.
    const menus = new MutationObserver(write)
    const scroll = (event: Event) => {
      const from = event.target
      if (from instanceof HTMLElement) {
        if (from === header || !from.contains(header)) return
        box = from
      } else if (box) return
      update()
    }
    withoutTransition(header, update, { subtree: true })
    // Scroll events don't bubble, so they are caught on their way down.
    document.addEventListener('scroll', scroll, { capture: true, passive: true })
    header.addEventListener('focusin', reveal)
    if (draws) {
      header.addEventListener('pointerenter', enter)
      header.addEventListener('pointerleave', leave)
      menus.observe(header, { subtree: true, attributeFilter: ['data-popup-open'] })
    }
    return () => {
      document.removeEventListener('scroll', scroll, { capture: true })
      header.removeEventListener('focusin', reveal)
      header.removeEventListener('pointerenter', enter)
      header.removeEventListener('pointerleave', leave)
      menus.disconnect()
    }
  }, [ref, hides, draws])
}

export {
  headerFits,
  headerScroll,
  type HeaderScroll,
  siteHeaderActionsClassName,
  siteHeaderColumnClassName,
  siteHeaderMenuClassName,
  siteHeaderNavClassName,
  type SiteHeaderItem,
  type SiteHeaderLink,
  SiteHeaderNav,
  SiteHeaderPhoneMenu,
  type SiteHeaderProps,
  type SiteHeaderSection,
  useHeaderFit,
  useHeaderScroll,
}
