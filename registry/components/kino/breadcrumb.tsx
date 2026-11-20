'use client'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLinkItem,
  DropdownMenuTrigger,
} from '@/registry/components/kino/dropdown-menu'
import { IconPlaceholder } from '@/registry/icons/icon-placeholder'
import { CutTooltip } from '@/registry/lib/cut'
import { followPointer, highlightClassName, itemMatching } from '@/registry/lib/highlight'
import { flattenChildren } from '@/registry/lib/swap'
import { mergeProps } from '@base-ui/react/merge-props'
import { useRender } from '@base-ui/react/use-render'
import {
  cloneElement,
  type ComponentProps,
  isValidElement,
  type MouseEvent,
  type ReactElement,
  useCallback,
  useRef,
  useState,
} from 'react'

import { cn } from '@/lib/utils'

/*
 * The trail of pages that leads to this one. The crumbs are the Navigation
 * menu's links, smaller: one highlight glides between them. When the trail
 * runs out of room, the crumbs after the first fold into a menu behind "…",
 * the earliest first, so the first page and the pages nearest this one stay.
 */

/**
 * The trail's landmark. It is as wide as the trail would be whole, and no
 * wider than its container, so the trail has room to unfold as it grows.
 */
function Breadcrumb({
  className,
  'aria-label': label = 'Breadcrumb',
  ...props
}: ComponentProps<'nav'>) {
  return (
    <nav
      data-slot='breadcrumb'
      aria-label={label}
      className={cn('w-(--breadcrumb-width) max-w-full min-w-0', className)}
      {...props}
    />
  )
}

/**
 * The crumbs and their separators, in order. It puts "…" after the first
 * crumb and folds the ones that don't fit into its menu. Crumbs are its own
 * children, or in fragments or arrays, so it can find them. `overflowLabel`
 * names "…" for a screen reader.
 */
function BreadcrumbList({
  className,
  children,
  overflowLabel = 'Show hidden pages',
  ...props
}: ComponentProps<'ol'> & { overflowLabel?: string }) {
  const track = useCallback((list: HTMLOListElement | null) => {
    if (!list) return
    return fitTrail(list)
  }, [])
  const highlight = useCallback((layer: HTMLLIElement | null) => {
    const list = layer?.parentElement
    if (!layer || !list) return
    return followPointer(list, layer, {
      itemOf: itemMatching(list, CRUMB_TARGETS),
      current: '[data-slot=breadcrumb-ellipsis][data-popup-open]',
      focus: true,
    })
  }, [])
  return (
    <ol
      ref={track}
      data-slot='breadcrumb-list'
      className={cn(
        'group/breadcrumb text-muted-foreground relative isolate flex min-w-0 list-none flex-nowrap items-center gap-0.5 text-sm font-medium',
        className,
      )}
      {...props}
    >
      <li
        ref={highlight}
        aria-hidden
        data-slot='breadcrumb-highlight'
        className={cn(
          highlightClassName,
          'bg-muted -z-10 forced-colors:bg-[Highlight] forced-colors:forced-color-adjust-none',
        )}
      />
      {withOverflow(children, overflowLabel)}
    </ol>
  )
}

function BreadcrumbItem({ className, ...props }: ComponentProps<'li'>) {
  return (
    <li
      data-slot='breadcrumb-item'
      // The page you're on gives way first; the crumbs before it keep their names.
      // Before the trail is first measured, as the page loads, every crumb gives
      // way, so a long trail never spills out of its container.
      className={cn(
        'inline-flex shrink-0 items-center group-not-data-fitted/breadcrumb:min-w-0 group-not-data-fitted/breadcrumb:shrink group-not-data-fitted/breadcrumb:overflow-hidden data-collapsed:hidden [&:has(>[aria-current=page])]:min-w-0 [&:has(>[aria-current=page])]:shrink',
        className,
      )}
      {...props}
    />
  )
}

/*
 * A crumb's box: the xs control's height and sides, as an xs Button's, so the
 * highlight under it is the shape of a small control at every density.
 */
const crumbClassName =
  "inline-flex h-(--control-height-xs) max-w-full min-w-0 items-center gap-1 rounded-(--control-radius-xs) px-[calc(var(--control-padding)*0.8)] whitespace-nowrap [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5"

const crumbLinkClassName =
  'transition-colors duration-(--motion-press-duration) ease-(--motion-press-fade-easing) select-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-hidden data-glided:text-foreground forced-colors:data-glided:text-[HighlightText] forced-colors:data-glided:forced-color-adjust-none forced-colors:data-glided:**:text-[HighlightText]'

/** A page on the way here. It renders an `<a>`; `render` swaps it for a router's link. */
function BreadcrumbLink({
  className,
  render,
  ...props
}: Omit<useRender.ComponentProps<'a'>, 'className'> & { className?: string }) {
  return useRender({
    defaultTagName: 'a',
    render,
    props: mergeProps<'a'>(
      {
        'data-slot': 'breadcrumb-link',
        className: cn(crumbClassName, crumbLinkClassName, className),
      } as ComponentProps<'a'>,
      props,
    ),
  })
}

/**
 * The page you're on: not a link, and `aria-current='page'`. A long name
 * truncates, and shows whole in a tooltip under the pointer.
 */
function BreadcrumbPage({ className, children, ...props }: ComponentProps<'span'>) {
  return (
    <CutTooltip
      render={
        <span
          data-slot='breadcrumb-page'
          aria-current='page'
          className={cn(crumbClassName, 'text-foreground', className)}
          {...props}
        >
          <span data-cut className='truncate'>
            {children}
          </span>
        </span>
      }
    />
  )
}

/** The mark between two crumbs: a chevron that points along the trail, or your own children. */
function BreadcrumbSeparator({ className, children, ...props }: ComponentProps<'li'>) {
  return (
    <li
      data-slot='breadcrumb-separator'
      role='presentation'
      aria-hidden
      className={cn(
        "text-muted-foreground/70 inline-flex shrink-0 items-center data-collapsed:hidden [&_svg:not([class*='size-'])]:size-3.5 rtl:[&>svg]:rotate-180",
        className,
      )}
      {...props}
    >
      {children ?? (
        <IconPlaceholder
          lucide='ChevronRightIcon'
          tabler='IconChevronRight'
          hugeicons='ArrowRight01Icon'
          phosphor='CaretRightIcon'
          remixicon='RiArrowRightSLine'
          aria-hidden
        />
      )}
    </li>
  )
}

/** What the highlight glides between: the links and "…". */
const CRUMB_TARGETS = '[data-slot=breadcrumb-link],[data-slot=breadcrumb-ellipsis]'

/** A folded crumb, as its row in the menu: its name, and the link or button it stands for. */
interface FoldedCrumb {
  readonly label: string
  readonly href: string | null
  readonly link: HTMLElement | null
}

/** Whether a click opens a link somewhere else: a new tab or window, or a download. */
function opensElsewhere(event: MouseEvent) {
  return (
    event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey
  )
}

/*
 * "…" and the separator after it. Its menu lists the folded crumbs, read when
 * it opens. A row is a link to the same page; a plain click goes through the
 * crumb's own link, so a router's link still handles it.
 */
function BreadcrumbOverflow({
  label,
  separator,
}: {
  label: string
  separator: ReactElement<ComponentProps<'li'>>
}) {
  const [folded, setFolded] = useState<readonly FoldedCrumb[]>([])
  const item = useRef<HTMLLIElement>(null)
  return (
    <>
      {/* Folded until the trail needs it, so it never shows before the trail is measured. */}
      <li
        ref={item}
        data-slot='breadcrumb-overflow'
        data-collapsed=''
        className='inline-flex shrink-0 items-center data-collapsed:hidden'
      >
        <DropdownMenu
          onOpenChange={(open) => {
            const list = item.current?.parentElement
            if (!open || !list) return
            item.current?.setAttribute('data-menu', '')
            setFolded(foldedCrumbs(list))
          }}
          onOpenChangeComplete={(open) => {
            // Base UI hands focus back to "…" once the menu has gone: refit after that.
            if (!open)
              requestAnimationFrame(() => item.current?.removeAttribute('data-menu'))
          }}
        >
          <DropdownMenuTrigger
            data-slot='breadcrumb-ellipsis'
            aria-label={label}
            className={cn(
              crumbClassName,
              crumbLinkClassName,
              'data-popup-open:text-foreground',
            )}
          >
            <IconPlaceholder
              lucide='EllipsisIcon'
              tabler='IconDots'
              hugeicons='MoreHorizontalIcon'
              phosphor='DotsThreeIcon'
              remixicon='RiMoreLine'
              aria-hidden
            />
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            {folded.map((crumb, index) =>
              crumb.href === null ? (
                // A crumb that is a button, such as a chart's way back out, is a row that presses it.
                <DropdownMenuItem
                  // oxlint-disable-next-line react/no-array-index-key -- the folded crumbs keep their order
                  key={index}
                  disabled={!crumb.link}
                  onClick={() => crumb.link?.click()}
                >
                  {crumb.label}
                </DropdownMenuItem>
              ) : (
                <DropdownMenuLinkItem
                  // oxlint-disable-next-line react/no-array-index-key -- the folded crumbs keep their order
                  key={index}
                  href={crumb.href}
                  onClick={(event) => {
                    if (!crumb.link || opensElsewhere(event)) return
                    event.preventDefault()
                    crumb.link.click()
                  }}
                >
                  {crumb.label}
                </DropdownMenuLinkItem>
              ),
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </li>
      {cloneElement(separator, {
        'data-collapsed': '',
      } as ComponentProps<'li'>)}
    </>
  )
}

/**
 * The children with "…" and a copy of the first separator after the first
 * crumb's separator; unchanged when there is no first separator.
 */
function withOverflow(children: ComponentProps<'ol'>['children'], label: string) {
  const parts = flattenChildren(children)
  const first = parts.findIndex(
    (part) => isValidElement(part) && part.type === BreadcrumbItem,
  )
  const separator = parts[first + 1]
  if (
    first === -1 ||
    !isValidElement<ComponentProps<'li'>>(separator) ||
    separator.type !== BreadcrumbSeparator
  ) {
    return parts
  }
  return [
    ...parts.slice(0, first + 2),
    <BreadcrumbOverflow key='breadcrumb-overflow' label={label} separator={separator} />,
    ...parts.slice(first + 2),
  ]
}

/** The crumbs folded now, in order, read from the list. */
function foldedCrumbs(list: Element): FoldedCrumb[] {
  return Array.from(
    list.querySelectorAll<HTMLElement>(
      ':scope > [data-slot=breadcrumb-item][data-collapsed]',
    ),
    (crumb) => {
      const link = crumb.querySelector<HTMLElement>('[data-slot=breadcrumb-link]')
      return {
        label: (link?.getAttribute('aria-label') ?? crumb.textContent ?? '').trim(),
        href: link?.getAttribute('href') ?? null,
        link,
      }
    },
  )
}

/*
 * Folds the crumbs that don't fit and unfolds them as room comes back, and
 * gives the trail the width it would take whole, as `--breadcrumb-width`, so
 * a row that sizes to its content still offers it the room to unfold. It
 * folds in the frame the room changes, before it paints. Kept outside any
 * component: it writes attributes React doesn't own.
 */
function fitTrail(list: HTMLOListElement) {
  const nav = list.parentElement
  let frame = 0
  const fit = () => {
    cancelAnimationFrame(frame)
    const overflow = list.querySelector<HTMLElement>(
      ':scope > [data-slot=breadcrumb-overflow]',
    )
    const trigger = overflow?.querySelector<HTMLElement>(
      '[data-slot=breadcrumb-ellipsis]',
    )
    // While "…" has its menu open or closing, what it lists stays folded, so
    // focus has "…" to come back to; the menu settling refits.
    if (overflow?.hasAttribute('data-menu')) return
    // Everything shows while it is measured, in one task, so nothing paints
    // in between and every width is current.
    for (const part of list.querySelectorAll(':scope > [data-collapsed]')) {
      part.removeAttribute('data-collapsed')
    }
    list.dataset.fitted = ''
    const crumbs = Array.from(
      list.querySelectorAll<HTMLElement>(':scope > [data-slot=breadcrumb-item]'),
    )
    // Each crumb is measured at its whole width, the page's name untruncated,
    // with nothing allowed to shrink for the moment.
    for (const crumb of crumbs) crumb.style.flexShrink = '0'
    const widths = crumbs.map((crumb) => crumb.getBoundingClientRect().width)
    for (const crumb of crumbs) crumb.style.removeProperty('flex-shrink')
    const separator = list.querySelector<HTMLElement>(
      ':scope > [data-slot=breadcrumb-separator]',
    )
    const trail = {
      crumbs: widths,
      separator: separator ? separator.getBoundingClientRect().width : 0,
      overflow: overflow ? overflow.getBoundingClientRect().width : 0,
      gap: Number.parseFloat(getComputedStyle(list).columnGap) || 0,
    }
    nav?.style.setProperty('--breadcrumb-width', `${Math.ceil(trailWidth(trail, 0))}px`)
    const folded = overflow ? foldedCount({ ...trail, room: list.clientWidth }) : 0
    const focused = document.activeElement
    let lostFocus = false
    crumbs.forEach((crumb, index) => {
      if (index < 1 || index > folded) return
      crumb.setAttribute('data-collapsed', '')
      const after = crumb.nextElementSibling
      if (after?.matches('[data-slot=breadcrumb-separator]')) {
        after.setAttribute('data-collapsed', '')
      }
      if (focused && crumb.contains(focused)) lostFocus = true
    })
    if (overflow && folded === 0) {
      overflow.setAttribute('data-collapsed', '')
      overflow.nextElementSibling?.setAttribute('data-collapsed', '')
    }
    // A crumb that folds with focus in it hands focus to "…", where it went;
    // "…" folding away with focus hands it to the first crumb it gave back.
    if (lostFocus) trigger?.focus({ preventScroll: true })
    else if (folded === 0 && focused && overflow?.contains(focused)) {
      crumbs[1]
        ?.querySelector<HTMLElement>('a, button, [tabindex]')
        ?.focus({ preventScroll: true })
    }
  }
  // The room changing refits at once, before the frame paints. A crumb that
  // changes size refits a frame later: its fit may resize the trail, which
  // the observer can't report back within the same frame.
  const room = new ResizeObserver(fit)
  const sizes = new ResizeObserver(() => {
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(fit)
  })
  const watch = () => {
    sizes.disconnect()
    for (const child of list.children) sizes.observe(child)
  }
  const changes = new MutationObserver(() => {
    watch()
    fit()
  })
  changes.observe(list, {
    childList: true,
    subtree: true,
    characterData: true,
    attributeFilter: ['data-menu'],
  })
  if (nav) room.observe(nav)
  watch()
  fit()
  return () => {
    cancelAnimationFrame(frame)
    room.disconnect()
    sizes.disconnect()
    changes.disconnect()
  }
}

/** The crumbs' widths, a separator's, "…"'s and the gap between any two, in px. */
interface Trail {
  readonly crumbs: readonly number[]
  readonly separator: number
  readonly overflow: number
  readonly gap: number
}

/**
 * How wide the trail is with `folded` crumbs after the first folded into
 * "…": the crumbs left, a separator after each but the last, "…" and its own
 * separator when anything is folded, and a gap between every two of those.
 */
export function trailWidth({ crumbs, separator, overflow, gap }: Trail, folded: number) {
  const shown = crumbs.filter((_, index) => index < 1 || index > folded)
  const marks = shown.length - 1 + (folded > 0 ? 1 : 0)
  const parts = shown.length + marks + (folded > 0 ? 1 : 0)
  const widths = shown.reduce((sum, width) => sum + width, 0)
  return (
    widths +
    marks * separator +
    (folded > 0 ? overflow : 0) +
    Math.max(0, parts - 1) * gap
  )
}

/**
 * How many crumbs after the first fold into "…" for the trail to fit in
 * `room`: none when it fits whole, and never the first or the last. With too
 * little room even then, the fold that leaves the trail narrowest, and the
 * last crumb truncates; a fold that would only widen it, as a crumb no wider
 * than "…" would, never happens. Half a pixel of slack absorbs rounding.
 */
export function foldedCount(trail: Trail & { readonly room: number }) {
  const most = Math.max(0, trail.crumbs.length - 2)
  let narrowest = 0
  for (let folded = 0; folded <= most; folded++) {
    const width = trailWidth(trail, folded)
    if (width <= trail.room + 0.5) return folded
    if (width < trailWidth(trail, narrowest)) narrowest = folded
  }
  return narrowest
}

export {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
}
