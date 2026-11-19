'use client'

import { IconPlaceholder } from '@/registry/icons/icon-placeholder'
import { useControllable } from '@/registry/lib/controllable'
import {
  followPick,
  followPointer,
  highlightClassName,
  itemMatching,
  pickClassName,
} from '@/registry/lib/highlight'
import {
  pillBackdropClassName,
  pillClassName,
  pillItemClassName,
} from '@/registry/lib/pill'
import { markMounted, mergeRefs } from '@/registry/lib/refs'
import { Roll } from '@/registry/lib/roll'
import { Swap } from '@/registry/lib/swap'
import {
  type ComponentProps,
  type CSSProperties,
  createContext,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
  use,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import { cn } from '@/lib/utils'

/*
 * Previous, Next and the pages between them, in a `nav`. It looks and moves
 * like the Tabs: labels that darken on hover, a backdrop that glides under
 * the pointer, and a pill in the primary colour that slides to the current
 * page, with a copy of the row inside it so each number changes colour
 * exactly at its edge. The row keeps the same number of places on every
 * page, so nothing beside it moves: in the middle of a long range the pill
 * stays put and the numbers roll past it. A row too wide for its room first
 * drops the words beside Previous and Next, then shows fewer pages.
 */

// The current page in the row, not its copy in the pill, which has no slots.
const CURRENT = '[data-slot=pagination-link][aria-current=page]'

const ITEM =
  '[data-slot=pagination-link], [data-slot=pagination-previous], [data-slot=pagination-next]'

// The row and the pill's copy of it share this, so every number sits exactly on its twin.
const paginationRow = 'flex items-center gap-1'

// A page is a square of the control's height, wider only when the last page's
// number needs it, so every place is as wide as the widest and the row keeps
// its width as the numbers change. `1ch` is a digit's width in tabular figures.
const itemLayout =
  "inline-flex h-(--control-height) min-w-[max(var(--control-height),calc(var(--pagination-digits,1)*1ch+0.75rem))] shrink-0 items-center justify-center gap-1.5 rounded-(--control-radius) px-1.5 text-sm font-medium whitespace-nowrap tabular-nums select-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"

// Previous and Next are a page's square around their arrow, and their word
// beside it when there is room. The word's outer side matches the room the
// square leaves beside the arrow, and it sits a quarter rem into the square,
// so the gap to the arrow follows the density.
const stepLayout = 'min-w-(--control-height) px-0'
const stepArrow = 'flex size-(--control-height) shrink-0 items-center justify-center'
// Until the row is measured, a narrow one leaves the words out already.
const stepWord =
  '[[data-slot=pagination]:not([data-words])_&]:sr-only @max-lg/pagination:[[data-slot=pagination]:not([data-mounted])_&]:sr-only'
const previousWord = cn(stepWord, '-ms-1 pe-[calc((var(--control-height)-1rem)/2)]')
const nextWord = cn(stepWord, '-me-1 ps-[calc((var(--control-height)-1rem)/2)]')

/** One place in the row: a page, or an ellipsis for the pages it skips. */
type PageItem = number | 'start-ellipsis' | 'end-ellipsis'

type LinkRender = (props: ComponentProps<'a'>) => ReactElement

interface PaginationContextValue {
  page: number
  pageCount: number
  items: PageItem[]
  /** Above 0 when the page went up, below 0 when it went down. */
  trend: number
  /** `pressed` when a page itself was pressed, so focus follows it to its new place. */
  go: (page: number, pressed?: boolean) => void
  href?: (page: number) => string
  renderLink?: LinkRender
}

const PaginationContext = createContext<PaginationContextValue | null>(null)

function usePagination() {
  const context = use(PaginationContext)
  if (!context) throw new Error('Pagination parts must be inside <Pagination>.')
  return context
}

/** True inside the pill's copy of the row, where a part is only its label. */
const PaginationCopyContext = createContext(false)

function Pagination({
  ref,
  className,
  page: pageProp,
  defaultPage = 1,
  onPageChange,
  pageCount,
  siblings = 1,
  boundaries = 1,
  href,
  renderLink,
  children,
  style,
  'aria-label': ariaLabel = 'Pagination',
  ...props
}: Omit<ComponentProps<'nav'>, 'className' | 'onChange'> & {
  className?: string
  /** The current page, counted from 1, when you hold the state. */
  page?: number
  /** The page it opens on, when it holds its own state. */
  defaultPage?: number
  onPageChange?: (page: number) => void
  /** How many pages there are. Below 1, it shows one page. */
  pageCount: number
  /** How many pages show on each side of the current one, at most. */
  siblings?: number
  /** How many pages show at each end, at most. With 0 there are no ellipses. */
  boundaries?: number
  /** Makes every page a link to this address. */
  href?: (page: number) => string
  /** Draws each link, such as a router's own: give it every prop. */
  renderLink?: LinkRender
}) {
  const count = Math.max(1, Math.floor(pageCount))
  const [chosen, setPage] = useControllable(pageProp, defaultPage, onPageChange)
  const page = clampPage(chosen, count)

  // The pages roll the way the current one went.
  const [seen, setSeen] = useState({ page, trend: 1 })
  if (seen.page !== page) setSeen({ page, trend: page > seen.page ? 1 : -1 })

  // As many places as the room holds, measured where the row is laid out.
  const [fit, setFit] = useState({ words: true, siblings, boundaries })
  const navRef = useRef<HTMLElement>(null)
  const navRefs = useMemo(() => mergeRefs(navRef, markMounted, ref), [ref])
  const rowRef = useRef<HTMLUListElement>(null)
  const pillRef = useRef<HTMLLIElement>(null)
  const backdropRef = useRef<HTMLLIElement>(null)
  const refocusRef = useRef<number | null>(null)

  useLayoutEffect(() => {
    const nav = navRef.current
    const row = rowRef.current
    if (!nav || !row) return
    const measure = () => {
      const next = fittingRange({
        ...placesIn(nav, row),
        pageCount: count,
        siblings,
        boundaries,
      })
      setFit((was) =>
        was.words === next.words &&
        was.siblings === next.siblings &&
        was.boundaries === next.boundaries
          ? was
          : next,
      )
    }
    measure()
    const resized = new ResizeObserver(measure)
    resized.observe(nav)
    resized.observe(row)
    return () => resized.disconnect()
  }, [count, siblings, boundaries])

  useEffect(() => {
    const row = rowRef.current
    if (!row || !pillRef.current || !backdropRef.current) return
    const stopPick = followPick(row, pillRef.current, {
      picked: () => row.querySelector<HTMLElement>(CURRENT),
      attributes: ['aria-current'],
    })
    // Behind the part under the pointer, or the one with visible focus.
    const stopHover = followPointer(row, backdropRef.current, {
      itemOf: itemMatching(row, ITEM),
      focus: true,
    })
    return () => {
      stopPick()
      stopHover()
    }
  }, [])

  // A pressed page can roll to another place: focus goes with it.
  useLayoutEffect(() => {
    const pressed = refocusRef.current
    refocusRef.current = null
    if (pressed !== page) return
    const row = rowRef.current
    if (!row?.contains(document.activeElement)) return
    row.querySelector<HTMLElement>(CURRENT)?.focus()
  }, [page])

  const items = pageItems(page, count, fit.siblings, fit.boundaries)

  return (
    <PaginationContext
      value={{
        page,
        pageCount: count,
        items,
        trend: seen.trend,
        go: (next, pressed) => {
          if (pressed) refocusRef.current = clampPage(next, count)
          setPage(clampPage(next, count))
        },
        href,
        renderLink,
      }}
    >
      <nav
        ref={navRefs}
        data-slot='pagination'
        data-words={fit.words ? '' : undefined}
        aria-label={ariaLabel}
        style={{ '--pagination-digits': String(count).length, ...style } as CSSProperties}
        className={cn(
          // Until the pages are measured to fit, a row too wide is cut at the edge rather than spilling over.
          '@container/pagination flex w-full min-w-0 justify-center not-data-mounted:overflow-x-clip',
          // The numbers the first measure changes take their place at once: nothing rolls on load.
          'not-data-mounted:[&_[data-slot=roll]_*]:transition-none',
          className,
        )}
        {...props}
      >
        <ul ref={rowRef} className={cn(paginationRow, 'relative isolate')}>
          {children}
          <li
            ref={backdropRef}
            aria-hidden
            data-slot='pagination-backdrop'
            className={cn(highlightClassName, pillBackdropClassName)}
          />
          <li
            ref={pillRef}
            aria-hidden
            // Whatever the row holds is copied here, so nothing in the copy may take focus.
            inert
            data-slot='pagination-pill'
            className={cn(pickClassName, pillClassName, 'z-10')}
          >
            <span className={cn(paginationRow, 'h-full')}>
              <PaginationCopyContext value={true}>{children}</PaginationCopyContext>
            </span>
          </li>
        </ul>
      </nav>
    </PaginationContext>
  )
}

/** A click that opens the link elsewhere (a new tab, a download) leaves this page as it is. */
function opensElsewhere(event: MouseEvent) {
  return (
    event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey
  )
}

/**
 * A page, Previous or Next: a link when the Pagination has `href`, a button
 * otherwise. One that can't go anywhere stays focusable, so focus isn't lost
 * when Next reaches the last page.
 */
function PaginationControl({
  to,
  slot,
  current = false,
  className,
  children,
  onClick: ownClick,
  ...props
}: Omit<ComponentProps<'a'>, 'href' | 'className'> & {
  to: number | null
  slot: string
  current?: boolean
  className?: string
}) {
  const { go, href, renderLink } = usePagination()
  const shared = {
    'data-slot': slot,
    'aria-current': current ? ('page' as const) : undefined,
    'aria-disabled': to === null ? true : undefined,
    'data-disabled': to === null ? '' : undefined,
    className: cn(
      itemLayout,
      pillItemClassName,
      // Until the page hydrates and the pill is placed, the current page draws itself.
      '[[data-slot=pagination]:not([data-mounted])_&]:aria-[current=page]:bg-primary [[data-slot=pagination]:not([data-mounted])_&]:aria-[current=page]:text-primary-foreground',
      className,
    ),
  }
  const onClick = (event: MouseEvent<HTMLAnchorElement & HTMLButtonElement>) => {
    ownClick?.(event)
    if (to === null) {
      event.preventDefault()
      return
    }
    if (event.defaultPrevented || (href && opensElsewhere(event))) return
    go(to, slot === 'pagination-link')
  }

  if (!href) {
    return (
      <button
        type='button'
        {...(props as ComponentProps<'button'>)}
        {...shared}
        onClick={onClick}
      >
        {children}
      </button>
    )
  }
  const link = {
    ...props,
    ...shared,
    href: to === null ? undefined : href(to),
    // A link with nowhere to go has no `href`, so it is named a link and kept in the tab order.
    role: to === null ? 'link' : undefined,
    tabIndex: to === null ? 0 : props.tabIndex,
    onClick,
    children,
  }
  return renderLink ? (
    renderLink(link)
  ) : (
    <a {...link} href={link.href}>
      {children}
    </a>
  )
}

function PaginationPrevious({
  className,
  children = 'Previous',
  ...props
}: Omit<ComponentProps<'a'>, 'href' | 'className'> & {
  className?: string
  /** The word beside the arrow, also its name when only the arrow shows. */
  children?: ReactNode
}) {
  const { page } = usePagination()
  const icon = (
    <IconPlaceholder
      lucide='ChevronLeftIcon'
      tabler='IconChevronLeft'
      hugeicons='ArrowLeft01Icon'
      phosphor='CaretLeftIcon'
      remixicon='RiArrowLeftSLine'
      aria-hidden
      className='rtl:-scale-x-100'
    />
  )
  if (use(PaginationCopyContext)) {
    return (
      <span className={cn(itemLayout, stepLayout, className)}>
        <span className={stepArrow}>{icon}</span>
        <span className={previousWord}>{children}</span>
      </span>
    )
  }
  return (
    <li className='flex'>
      <PaginationControl
        slot='pagination-previous'
        to={page > 1 ? page - 1 : null}
        className={cn(stepLayout, className)}
        {...props}
      >
        <span className={stepArrow}>{icon}</span>
        <span data-pagination-word='' className={previousWord}>
          {children}
        </span>
      </PaginationControl>
    </li>
  )
}

function PaginationNext({
  className,
  children = 'Next',
  ...props
}: Omit<ComponentProps<'a'>, 'href' | 'className'> & {
  className?: string
  /** The word beside the arrow, also its name when only the arrow shows. */
  children?: ReactNode
}) {
  const { page, pageCount } = usePagination()
  const icon = (
    <IconPlaceholder
      lucide='ChevronRightIcon'
      tabler='IconChevronRight'
      hugeicons='ArrowRight01Icon'
      phosphor='CaretRightIcon'
      remixicon='RiArrowRightSLine'
      aria-hidden
      className='rtl:-scale-x-100'
    />
  )
  if (use(PaginationCopyContext)) {
    return (
      <span className={cn(itemLayout, stepLayout, className)}>
        <span className={nextWord}>{children}</span>
        <span className={stepArrow}>{icon}</span>
      </span>
    )
  }
  return (
    <li className='flex'>
      <PaginationControl
        slot='pagination-next'
        to={page < pageCount ? page + 1 : null}
        className={cn(stepLayout, className)}
        {...props}
      >
        <span data-pagination-word='' className={nextWord}>
          {children}
        </span>
        <span className={stepArrow}>{icon}</span>
      </PaginationControl>
    </li>
  )
}

function PaginationEllipsis({ className }: { className?: string }) {
  return (
    <IconPlaceholder
      lucide='EllipsisIcon'
      tabler='IconDots'
      hugeicons='MoreHorizontalIcon'
      phosphor='DotsThreeIcon'
      remixicon='RiMoreLine'
      aria-hidden
      className={className}
    />
  )
}

/**
 * The numbered pages, with an ellipsis for each run it skips. Each place
 * stays the same element as the pages change, so its number rolls.
 */
function PaginationPages({
  className,
  pageLabel = (page, of) => (of ? `Page ${page} of ${of}` : `Page ${page}`),
}: {
  className?: string
  /**
   * Each page's accessible name. `of` is the page count, given for the
   * current page only, so its name says how many there are even when the
   * last page doesn't show.
   */
  pageLabel?: (page: number, of?: number) => string
}) {
  const { page, pageCount, items, trend } = usePagination()
  const copy = use(PaginationCopyContext)
  const Place = copy ? 'span' : 'li'
  return items.map((item, place) => {
    const number = typeof item === 'number'
    let content: ReactNode
    if (!number) {
      content = (
        <span
          data-slot={copy ? undefined : 'pagination-ellipsis'}
          className={cn(itemLayout, 'text-foreground/60', className)}
        >
          <PaginationEllipsis />
        </span>
      )
    } else if (copy) {
      content = (
        <span className={cn(itemLayout, className)}>
          <Roll value={String(item)} trend={trend} />
        </span>
      )
    } else {
      content = (
        <PaginationControl
          slot='pagination-link'
          to={item}
          current={item === page}
          className={className}
        >
          {/* The number rolls for the eye; its name is read whole. */}
          <span className='sr-only'>
            {pageLabel(item, item === page ? pageCount : undefined)}
          </span>
          <Roll value={String(item)} trend={trend} />
        </PaginationControl>
      )
    }
    // A place that turns from a page into an ellipsis, or back, crossfades.
    return (
      <Place key={place} className='flex' aria-hidden={copy || number ? undefined : true}>
        <Swap id={number ? 'page' : 'ellipsis'}>{content}</Swap>
      </Place>
    )
  })
}

/** `page` as a whole page from 1 to `pageCount`. */
function clampPage(page: number, pageCount: number) {
  if (!Number.isFinite(page)) return 1
  return Math.min(Math.max(1, Math.round(page)), Math.max(1, pageCount))
}

function range(from: number, to: number) {
  return Array.from({ length: Math.max(0, to - from + 1) }, (_, at) => from + at)
}

/** How many places a row takes with these counts, once it has more pages than it shows. */
function placesFor(siblings: number, boundaries: number) {
  return boundaries > 0 ? 2 * boundaries + 2 * siblings + 3 : 2 * siblings + 1
}

/**
 * The row's places for `page` of `pageCount`: the first and last
 * `boundaries` pages, `siblings` pages either side of the current one, and
 * an ellipsis for each run between them. The count of places stays the same
 * on every page, so the row never changes width: near an end, the pages
 * there fill the places an ellipsis would take. An ellipsis always stands
 * for two pages or more. With no boundaries, it is a window of pages.
 */
function pageItems(
  page: number,
  pageCount: number,
  siblings = 1,
  boundaries = 1,
): PageItem[] {
  const count = Math.max(1, Math.floor(pageCount))
  const current = clampPage(page, count)
  const sides = Math.max(0, Math.floor(siblings))
  const ends = Math.max(0, Math.floor(boundaries))
  const places = placesFor(sides, ends)
  if (count <= places) return range(1, count)
  if (ends === 0) {
    const start = Math.min(Math.max(1, current - sides), count - places + 1)
    return range(start, start + places - 1)
  }
  // Pages up to the ellipsis, when the current one is close to an end.
  const run = places - ends - 1
  if (current <= ends + sides + 2) {
    return [...range(1, run), 'end-ellipsis', ...range(count - ends + 1, count)]
  }
  if (current >= count - ends - sides - 1) {
    return [...range(1, ends), 'start-ellipsis', ...range(count - run + 1, count)]
  }
  return [
    ...range(1, ends),
    'start-ellipsis',
    ...range(current - sides, current + sides),
    'end-ellipsis',
    ...range(count - ends + 1, count),
  ]
}

/**
 * What fits in `room` px, each place `place` px wide and `gap` px apart:
 * the words beside Previous and Next, which take `words` px more, while
 * every page asked for fits with them; then the most `siblings`, then
 * `boundaries`, up to those asked for. At the least it is the current page
 * alone. `room` is what the pages and the words share.
 */
function fittingRange({
  room,
  place,
  gap,
  words,
  pageCount,
  siblings,
  boundaries,
}: {
  room: number
  place: number
  gap: number
  words: number
  pageCount: number
  siblings: number
  boundaries: number
}) {
  const wide = (sides: number, ends: number) => {
    const places = Math.min(Math.max(1, pageCount), placesFor(sides, ends))
    return places * place + (places - 1) * gap
  }
  // Half a pixel either way is rounding, not a lack of room.
  const fits = (width: number) => width <= room + 0.5
  if (fits(wide(siblings, boundaries) + words)) {
    return { words: true, siblings, boundaries }
  }
  for (let ends = boundaries; ends >= 0; ends--) {
    for (let sides = siblings; sides >= 0; sides--) {
      if (fits(wide(sides, ends)))
        return { words: false, siblings: sides, boundaries: ends }
    }
  }
  return { words: false, siblings: 0, boundaries: 0 }
}

/**
 * The room the pages and the words have in `nav`, how wide each page's place
 * is and how far apart, and how much more the words beside Previous and
 * Next take, as laid out. Previous and Next are counted as squares, and
 * their words from the text, whether they show or not.
 */
function placesIn(nav: HTMLElement, row: HTMLElement) {
  const gap = Number.parseFloat(getComputedStyle(row).columnGap) || 0
  const quarter =
    Number.parseFloat(getComputedStyle(document.documentElement).fontSize) / 4
  let others = 0
  let place = 0
  let words = 0
  for (const child of row.children) {
    if (!(child instanceof HTMLElement) || child.hasAttribute('data-slot')) continue
    const control = child.firstElementChild
    if (
      child.querySelector('[data-slot=pagination-link], [data-slot=pagination-ellipsis]')
    ) {
      place = Math.max(place, child.getBoundingClientRect().width)
      continue
    }
    const word = control?.querySelector('[data-pagination-word]')
    const arrow = control?.querySelector('svg')
    if (control instanceof HTMLElement && word && arrow) {
      // A square, and the word with its padding beside it.
      const square = control.getBoundingClientRect().height
      const range = document.createRange()
      range.selectNodeContents(word)
      words +=
        range.getBoundingClientRect().width +
        (square - arrow.getBoundingClientRect().width) / 2 -
        quarter
      others += square + gap
    } else {
      others += child.getBoundingClientRect().width + gap
    }
  }
  return { room: nav.clientWidth - others, place, gap, words }
}

export {
  Pagination,
  PaginationNext,
  PaginationPages,
  PaginationPrevious,
  clampPage,
  fittingRange,
  pageItems,
}
export type { PageItem }
