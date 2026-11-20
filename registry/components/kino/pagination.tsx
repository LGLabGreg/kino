'use client'

import {
  isStep,
  NumberField,
  NumberFieldGroup,
  NumberFieldInput,
} from '@/registry/components/kino/number-field'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/registry/components/kino/select'
import { IconPlaceholder } from '@/registry/icons/icon-placeholder'
import { useControllable } from '@/registry/lib/controllable'
import {
  followPick,
  followPointer,
  highlightClassName,
  itemMatching,
  pickClassName,
} from '@/registry/lib/highlight'
import { numberFormatter } from '@/registry/lib/number-format'
import { clampPage, pageCountOf, pageForSize, pageRange } from '@/registry/lib/pages'
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
  type HTMLAttributes,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
  type RefObject,
  use,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import { cn } from '@/lib/utils'

/*
 * A pager in a `nav`: the row of pages with Previous and Next, and beside it
 * what a table's footer needs, where the page sits in the whole ("21–40 of
 * 4,800"), how many rows a page holds, and a field to type a page in. The
 * row looks and moves like the Tabs: labels that darken on hover, a backdrop
 * that glides under the pointer, and a pill in the primary colour that
 * slides to the current page, with a copy of the row inside it so each
 * number changes colour exactly at its edge. The row keeps the same number
 * of places on every page, so nothing beside it moves: in the middle of a
 * long range the pill stays put and the numbers roll past it. A row too
 * wide for its room first drops the words beside Previous and Next, then
 * shows fewer pages.
 */

// The current page in the row, not its copy in the pill, which has no slots.
const CURRENT = '[data-slot=pagination-link][aria-current=page]'

const ITEM =
  '[data-slot=pagination-link], [data-slot=pagination-first], [data-slot=pagination-previous], [data-slot=pagination-next], [data-slot=pagination-last]'

const LAYERS = '[data-slot=pagination-backdrop], [data-slot=pagination-pill]'

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
// Until the row is measured, a narrow one leaves the words out already. Beside
// the page field they always go: "Previous Page 4" would read as one phrase.
const stepWord =
  '[[data-slot=pagination-content]:not([data-words])_&]:sr-only [[data-slot=pagination-content]:has([data-slot=pagination-page-field])_&]:sr-only @max-lg/pagination:[[data-slot=pagination]:not([data-mounted])_&]:sr-only'
// Before the row is measured (as the page loads, before its script runs), a
// narrow row shows only the current page, so nothing is cut at its edges.
const beforeFit =
  '@max-md/pagination:[[data-slot=pagination]:not([data-mounted])_&]:hidden'

// First and Last, when the row has no room for them.
const edgeHidden = '[[data-slot=pagination-content]:not([data-edges])_&]:hidden'
const previousWord = cn(stepWord, '-ms-1 pe-[calc((var(--control-height)-1rem)/2)]')
const nextWord = cn(stepWord, '-me-1 ps-[calc((var(--control-height)-1rem)/2)]')

/** One place in the row: a page, or an ellipsis for the pages it skips. */
type PageItem = number | 'start-ellipsis' | 'end-ellipsis'

type LinkRender = (props: ComponentProps<'a'>) => ReactElement

interface PaginationContextValue {
  page: number
  /** The pages there are, or while the count is unknown, the pages known so far. */
  pageCount: number
  /** Whether the count of pages is known. */
  known: boolean
  /** How many items there are, when that is known. */
  total: number | null
  pageSize: number
  /** `pressed` when a page itself was pressed, so focus follows it to its new place. */
  go: (page: number, pressed?: boolean) => void
  setPageSize: (pageSize: number) => void
  /** The page a pressed page went to, so the row moves focus to it once it has rolled. */
  refocusRef: RefObject<number | null>
  siblings: number
  boundaries: number
  href?: (page: number) => string
  renderLink?: LinkRender
  locale: Intl.LocalesArgument
}

const PaginationContext = createContext<PaginationContextValue | null>(null)

function usePagination() {
  const context = use(PaginationContext)
  if (!context) throw new Error('Pagination parts must be inside <Pagination>.')
  return context
}

/** True inside the pill's copy of the row, where a part is only its label. */
const PaginationCopyContext = createContext(false)

/** How many pages the row has room for, either side of the current one and at each end; `null` outside the row. */
const RowContext = createContext<{
  siblings: number
  boundaries: number
} | null>(null)

function Pagination({
  ref,
  className,
  page: pageProp,
  defaultPage = 1,
  onPageChange,
  pageCount,
  total,
  pageSize: pageSizeProp,
  defaultPageSize = 10,
  onPageSizeChange,
  hasNextPage = false,
  siblings = 1,
  boundaries = 1,
  href,
  renderLink,
  locale = 'en-US',
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
  /** How many pages there are. Below 1, it shows one page. Worked out from `total` when that is given. */
  pageCount?: number
  /** How many items there are across every page. With neither this nor `pageCount`, the count is unknown. */
  total?: number
  /** How many items a page holds, when you hold the state. */
  pageSize?: number
  /** How many items a page holds, when it holds its own state. */
  defaultPageSize?: number
  /** Called with the new size. The page moves, through `onPageChange`, to the one that keeps the first item it showed. */
  onPageSizeChange?: (pageSize: number) => void
  /** Whether there is a page after this one, while the count is unknown, as with a cursor. */
  hasNextPage?: boolean
  /** How many pages show on each side of the current one, at most. */
  siblings?: number
  /** How many pages show at each end, at most. With 0 there are no ellipses. */
  boundaries?: number
  /** Makes every page a link to this address. */
  href?: (page: number) => string
  /** Draws each link, such as a router's own: give it every prop. */
  renderLink?: LinkRender
  /** The locale numbers are written in. */
  locale?: Intl.LocalesArgument
}) {
  const [chosenSize, setPageSize] = useControllable(
    pageSizeProp,
    defaultPageSize,
    onPageSizeChange,
  )
  const pageSize = Math.max(1, Math.floor(chosenSize) || 1)
  const [chosen, setPage] = useControllable(pageProp, defaultPage, onPageChange)
  const known = countOf({ pageCount, total, pageSize })
  const page = clampPage(chosen, known ?? Number.POSITIVE_INFINITY)
  // While the count is unknown, the pages known so far: up to this one, and the next when there is one.
  const count = known ?? page + (hasNextPage ? 1 : 0)

  const refocusRef = useRef<number | null>(null)
  const navRef = useMemo(() => mergeRefs(markMounted, ref), [ref])

  const go = (next: number, pressed?: boolean) => {
    const to = clampPage(next, count)
    if (pressed) refocusRef.current = to
    setPage(to)
  }

  return (
    <PaginationContext
      value={{
        page,
        pageCount: count,
        known: known !== null,
        total: total === undefined ? null : Math.max(0, Math.floor(total)),
        pageSize,
        go,
        setPageSize: (size) => {
          const next = Math.max(1, Math.floor(size))
          if (next === pageSize) return
          setPageSize(next)
          setPage(pageForSize(page, pageSize, next))
        },
        refocusRef,
        siblings,
        boundaries,
        href,
        renderLink,
        locale,
      }}
    >
      <nav
        ref={navRef}
        data-slot='pagination'
        aria-label={ariaLabel}
        style={
          {
            '--pagination-digits': String(count).length,
            ...style,
          } as CSSProperties
        }
        className={cn(
          // Its parts in a row, and the pages on a row of their own when there's too little room.
          'flex w-full min-w-0 flex-wrap items-center justify-center gap-x-4 gap-y-2',
          className,
        )}
        {...props}
      />
    </PaginationContext>
  )
}

/**
 * The row of pages, Previous and Next. It looks and moves like the Tabs, and
 * fits the room it is given: first the words beside Previous and Next go,
 * then pages.
 */
function PaginationContent({
  className,
  children,
  ...props
}: Omit<ComponentProps<'div'>, 'className'> & { className?: string }) {
  const { page, pageCount, siblings, boundaries, refocusRef } = usePagination()
  // As many places as the room holds, measured where the row is laid out.
  const [fit, setFit] = useState({ words: true, siblings, boundaries, edges: true })
  const areaRef = useRef<HTMLDivElement>(null)
  const rowRef = useRef<HTMLUListElement>(null)
  const pillRef = useRef<HTMLLIElement>(null)
  const backdropRef = useRef<HTMLLIElement>(null)

  useLayoutEffect(() => {
    const area = areaRef.current
    const row = rowRef.current
    if (!area || !row) return
    const measure = () => {
      const next = fittingRange({
        ...placesIn(area, row),
        pageCount,
        siblings,
        boundaries,
      })
      setFit((was) =>
        was.words === next.words &&
        was.siblings === next.siblings &&
        was.boundaries === next.boundaries &&
        was.edges === next.edges
          ? was
          : next,
      )
    }
    measure()
    const resized = new ResizeObserver(measure)
    resized.observe(area)
    resized.observe(row)
    return () => resized.disconnect()
  }, [pageCount, siblings, boundaries])

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
  }, [page, refocusRef])

  return (
    <RowContext value={{ siblings: fit.siblings, boundaries: fit.boundaries }}>
      <div
        ref={areaRef}
        data-slot='pagination-content'
        data-words={fit.words ? '' : undefined}
        data-edges={fit.edges ? '' : undefined}
        className={cn(
          // Grows into the room its neighbours leave, and wraps below them when that is less than a short row.
          '@container/pagination flex min-w-0 flex-[1_1_10rem] justify-center',
          // Until the pages are measured to fit, a row too wide is cut at the edge rather than spilling over.
          '[[data-slot=pagination]:not([data-mounted])_&]:overflow-x-clip',
          // The numbers the first measure changes take their place at once: nothing rolls on load.
          '[[data-slot=pagination]:not([data-mounted])_&]:[&_[data-slot=roll]_*]:transition-none',
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
      </div>
    </RowContext>
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

type StepProps = Omit<ComponentProps<'a'>, 'href' | 'className'> & {
  className?: string
  /** The word beside the arrow, also its name when only the arrow shows. */
  children?: ReactNode
}

/**
 * A step to another page: an arrow in a page's square, with its word on
 * the side away from the pages when `word` is set and there is room. Without
 * it, the word is only the step's name.
 */
function PaginationStep({
  slot,
  to,
  icon,
  word,
  edge = false,
  className,
  children,
  ...props
}: StepProps & {
  slot: string
  to: number | null
  icon: ReactElement
  /** Where the word shows: before the arrow, after it, or never. */
  word?: 'before' | 'after'
  /** First or Last, which go when there's no room for them. */
  edge?: boolean
}) {
  const arrow = <span className={stepArrow}>{icon}</span>
  const label = (
    <span
      data-pagination-word={word ? '' : undefined}
      className={!word ? 'sr-only' : word === 'before' ? nextWord : previousWord}
    >
      {children}
    </span>
  )
  const parts =
    word === 'before' ? (
      <>
        {label}
        {arrow}
      </>
    ) : (
      <>
        {arrow}
        {label}
      </>
    )
  const hidden = edge && edgeHidden
  if (use(PaginationCopyContext)) {
    return <span className={cn(itemLayout, stepLayout, hidden, className)}>{parts}</span>
  }
  return (
    <li className={cn('flex', hidden)}>
      <PaginationControl
        slot={slot}
        to={to}
        className={cn(stepLayout, className)}
        {...props}
      >
        {parts}
      </PaginationControl>
    </li>
  )
}

/** Goes to the first page: an arrow only. */
function PaginationFirst({ children = 'First page', ...props }: StepProps) {
  const { page } = usePagination()
  return (
    <PaginationStep
      slot='pagination-first'
      edge
      to={page > 1 ? 1 : null}
      icon={
        <IconPlaceholder
          lucide='ChevronsLeftIcon'
          tabler='IconChevronsLeft'
          hugeicons='ArrowLeftDoubleIcon'
          phosphor='CaretDoubleLeftIcon'
          remixicon='RiArrowLeftDoubleLine'
          aria-hidden
          className='rtl:-scale-x-100'
        />
      }
      {...props}
    >
      {children}
    </PaginationStep>
  )
}

function PaginationPrevious({ children = 'Previous', ...props }: StepProps) {
  const { page } = usePagination()
  return (
    <PaginationStep
      slot='pagination-previous'
      to={page > 1 ? page - 1 : null}
      word='after'
      icon={
        <IconPlaceholder
          lucide='ChevronLeftIcon'
          tabler='IconChevronLeft'
          hugeicons='ArrowLeft01Icon'
          phosphor='CaretLeftIcon'
          remixicon='RiArrowLeftSLine'
          aria-hidden
          className='rtl:-scale-x-100'
        />
      }
      {...props}
    >
      {children}
    </PaginationStep>
  )
}

function PaginationNext({ children = 'Next', ...props }: StepProps) {
  const { page, pageCount } = usePagination()
  return (
    <PaginationStep
      slot='pagination-next'
      to={page < pageCount ? page + 1 : null}
      word='before'
      icon={
        <IconPlaceholder
          lucide='ChevronRightIcon'
          tabler='IconChevronRight'
          hugeicons='ArrowRight01Icon'
          phosphor='CaretRightIcon'
          remixicon='RiArrowRightSLine'
          aria-hidden
          className='rtl:-scale-x-100'
        />
      }
      {...props}
    >
      {children}
    </PaginationStep>
  )
}

/** Goes to the last page: an arrow only. While the count is unknown it has nowhere to go. */
function PaginationLast({ children = 'Last page', ...props }: StepProps) {
  const { page, pageCount, known } = usePagination()
  return (
    <PaginationStep
      slot='pagination-last'
      edge
      to={known && page < pageCount ? pageCount : null}
      icon={
        <IconPlaceholder
          lucide='ChevronsRightIcon'
          tabler='IconChevronsRight'
          hugeicons='ArrowRightDoubleIcon'
          phosphor='CaretDoubleRightIcon'
          remixicon='RiArrowRightDoubleLine'
          aria-hidden
          className='rtl:-scale-x-100'
        />
      }
      {...props}
    >
      {children}
    </PaginationStep>
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
  const { page, pageCount, known, siblings: asked, boundaries: ends } = usePagination()
  const { siblings, boundaries } = use(RowContext) ?? {
    siblings: asked,
    boundaries: ends,
  }
  const copy = use(PaginationCopyContext)
  const items = pageItems(page, pageCount, siblings, boundaries)
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
          <RollingNumber value={item} text={String(item)} />
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
            {pageLabel(item, item === page && known ? pageCount : undefined)}
          </span>
          <RollingNumber value={item} text={String(item)} />
        </PaginationControl>
      )
    }
    // A place that turns from a page into an ellipsis, or back, crossfades.
    return (
      <Place
        key={place}
        className={cn('flex', item !== page && beforeFit)}
        aria-hidden={copy || number ? undefined : true}
      >
        <Swap id={number ? 'page' : 'ellipsis'}>{content}</Swap>
      </Place>
    )
  })
}

// The page count after the page field: in a row narrower than a phone's, only the field's description.
const pageCountClassName =
  'text-muted-foreground tabular-nums @max-3xs/pagination:sr-only'

// The page field's box: as wide as the last page's number, at the input's own text size, so `1ch` is its digit.
const pageBox =
  'w-[calc(max(var(--pagination-digits,1),2)*1ch+2*var(--control-padding)+2px)] shrink-0 text-base md:text-sm'

/**
 * The current page as a field, "Page 3 of 12", in the row: type a page and
 * press Enter or leave the field to go there, or step with the arrow keys.
 * Between Previous and Next it is the whole row, for a small space; beside
 * the pages it jumps far in a long range.
 */
function PaginationPageField({
  className,
  label = 'Page',
  of = (pageCount) => `of ${pageCount}`,
  disabled,
  ...props
}: Omit<HTMLAttributes<HTMLElement>, 'className' | 'children'> & {
  className?: string
  /** The word before the field, also its name. */
  label?: string
  /** The words after it, given the page count written out. Left out while the count is unknown. */
  of?: (pageCount: string) => string
  disabled?: boolean
}) {
  const { page, pageCount, known, go, locale } = usePagination()
  const copy = use(PaginationCopyContext)
  // In the row it is one of its places; beside it, a part of its own.
  const Place = use(RowContext) ? 'li' : 'div'
  const labelId = useId()
  const ofId = useId()
  // What the field holds: the page, or what is being typed until it is sent.
  const [draft, setDraft] = useState<number | null>(page)
  const [seen, setSeen] = useState(page)
  if (seen !== page) {
    setSeen(page)
    setDraft(page)
  }
  const ofText = known ? of(numberFormatter(locale).format(pageCount)) : null
  // Goes to the page typed, the nearest there is; with nothing typed, the field shows the page again.
  const send = (value: number | null) => {
    // While the count is unknown, the pages known so far: as far as Next goes.
    const to = value === null ? page : clampPage(value, pageCount)
    setDraft(to)
    go(to)
  }
  const layout = cn(
    'flex shrink-0 items-center gap-2 text-sm whitespace-nowrap',
    className,
  )

  if (copy) {
    // The same width as the field, so every part after it sits on its twin.
    return (
      <span className={cn(layout, 'invisible')}>
        <span>{label}</span>
        <span className={cn(pageBox, 'h-(--control-height)')} />
        {ofText ? <span className={pageCountClassName}>{ofText}</span> : null}
      </span>
    )
  }
  return (
    <Place data-slot='pagination-page-field' className={layout} {...props}>
      <span id={labelId}>{label}</span>
      <NumberField
        value={draft}
        min={1}
        max={pageCount}
        step={1}
        disabled={disabled}
        locale={locale}
        format={{ maximumFractionDigits: 0, useGrouping: false }}
        onValueChange={(value, details) => {
          setDraft(value)
          // A step goes at once; what is typed or pasted goes when it is sent.
          if (value !== null && isStep(details.reason)) go(value)
        }}
        onValueCommitted={send}
      >
        <NumberFieldGroup className={pageBox}>
          <NumberFieldInput
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return
              // Base UI sends what was typed when the field is left, and only then writes the page
              // back: Enter leaves it and comes straight back, so focus stays.
              const input = event.currentTarget
              input.blur()
              input.focus()
            }}
            aria-labelledby={labelId}
            aria-describedby={ofText ? ofId : undefined}
          />
        </NumberFieldGroup>
      </NumberField>
      {ofText ? (
        <span id={ofId} className={pageCountClassName}>
          {ofText}
        </span>
      ) : null}
    </Place>
  )
}

/**
 * A number that rolls up when it grows and down when it shrinks, each on its
 * own: as the page size changes, the range's start can fall while its end rises.
 */
function RollingNumber({ value, text }: { value: number; text: string }) {
  const [seen, setSeen] = useState({ value, trend: 1 })
  if (seen.value !== value) setSeen({ value, trend: value < seen.value ? -1 : 1 })
  return <Roll value={text} trend={seen.trend} />
}

/** The numbers a range's words are written around, as text or as rolling numbers. */
interface PaginationRangeParts {
  /** The first item on the page, counted from 1, when the Pagination has `total`. */
  from: ReactNode | null
  /** The last item on the page, when the Pagination has `total`. */
  to: ReactNode | null
  /** How many items there are, when the Pagination has `total`. */
  total: ReactNode | null
  page: ReactNode
  /** How many pages there are, or `null` while that is unknown. */
  pageCount: ReactNode | null
}

function rangeWords(range: PaginationRangeParts) {
  if (range.total === null) {
    return range.pageCount === null ? (
      <>Page {range.page}</>
    ) : (
      <>
        Page {range.page} of {range.pageCount}
      </>
    )
  }
  return (
    <>
      {range.from}–{range.to} of {range.total}
    </>
  )
}

/**
 * Where the page sits in the whole: "21–40 of 4,800" when the Pagination has
 * `total`, "Page 3 of 12" when it has only `pageCount`, and "Page 3" while
 * the count is unknown. Its numbers roll as the page moves, and a screen
 * reader hears the new range.
 */
function PaginationRange({
  className,
  children = rangeWords,
  announce = true,
  shown,
  ...props
}: Omit<ComponentProps<'p'>, 'className' | 'children'> & {
  className?: string
  /** Whether a screen reader hears the new range: leave it off where something else says the page changed, as a Table's own announcements do. */
  announce?: boolean
  /** The page, and its size, whose items are on screen while they aren't yet the page asked for, as while a server sends the next. */
  shown?: { page: number; pageSize: number }
  /**
   * The words, such as in another language, given the numbers to write them
   * around. Called twice: once with text for screen readers and once with
   * rolling numbers for the eye.
   */
  children?: (range: PaginationRangeParts) => ReactNode
}) {
  const asked = usePagination()
  const { pageCount, known, total, locale } = asked
  const { page, pageSize } = shown ?? asked
  const format = numberFormatter(locale)
  const byItem = total !== null
  const items = pageRange(page, pageSize, total ?? 0)
  const values = {
    from: byItem ? items.from : null,
    to: byItem ? items.to : null,
    total,
    page,
    pageCount: known ? pageCount : null,
  }
  const text = (value: number | null) => (value === null ? null : format.format(value))
  const rolled = (value: number | null) =>
    value === null ? null : <RollingNumber value={value} text={format.format(value)} />
  const parts = (write: (value: number | null) => ReactNode) => ({
    from: write(values.from),
    to: write(values.to),
    total: write(values.total),
    page: write(values.page),
    pageCount: write(values.pageCount),
  })
  return (
    <p
      data-slot='pagination-range'
      className={cn('text-muted-foreground shrink-0 text-sm tabular-nums', className)}
      {...props}
    >
      {/* Read whole and announced as it changes; the rolling copy is for the eye. */}
      <span role={announce ? 'status' : undefined} className='sr-only'>
        {children(parts(text))}
      </span>
      {/* Each rolling number is a box of its own: the line takes its direction from its words, as plain text would. */}
      <span aria-hidden className='[unicode-bidi:plaintext]'>
        {children(parts(rolled))}
      </span>
    </p>
  )
}

/**
 * How many items a page holds, picked with Kino's Select. A new size keeps
 * the first item the page showed on screen.
 */
function PaginationPageSize({
  className,
  options = [10, 20, 50, 100],
  children = 'Rows per page',
  disabled,
  ...props
}: Omit<ComponentProps<'div'>, 'className' | 'children'> & {
  className?: string
  disabled?: boolean
  /** The sizes to pick from. */
  options?: readonly number[]
  /** The label beside the Select, also its name. */
  children?: ReactNode
}) {
  const { pageSize, setPageSize, locale } = usePagination()
  const labelId = useId()
  const format = numberFormatter(locale)
  // The size it has, even when it isn't one of the options.
  const sizes = options.includes(pageSize)
    ? options
    : [...options, pageSize].toSorted((a, b) => a - b)
  return (
    <div
      data-slot='pagination-page-size'
      className={cn('flex shrink-0 items-center gap-2 text-sm', className)}
      {...props}
    >
      <span id={labelId} className='text-muted-foreground'>
        {children}
      </span>
      <Select
        value={pageSize}
        disabled={disabled}
        onValueChange={(size) => {
          if (size !== null) setPageSize(size)
        }}
        items={sizes.map((size) => ({
          value: size,
          label: format.format(size),
        }))}
      >
        <SelectTrigger
          aria-labelledby={labelId}
          // As wide as the longest size, so picking another never moves what sits beside it.
          style={
            {
              '--pagination-size-digits': Math.max(
                ...sizes.map((size) => format.format(size).length),
              ),
            } as CSSProperties
          }
          className='min-w-[calc(var(--pagination-size-digits)*1ch+2*var(--control-padding)+1.5rem+2px)] tabular-nums'
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {sizes.map((size) => (
            <SelectItem key={size} value={size} className='tabular-nums'>
              {format.format(size)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

/** How many pages there are, from `total` items when given, else `pageCount`; `null` with neither. */
function countOf({
  pageCount,
  total,
  pageSize,
}: {
  pageCount?: number
  total?: number
  pageSize: number
}): number | null {
  if (total !== undefined) return pageCountOf(total, pageSize)
  if (pageCount !== undefined) return Math.max(1, Math.floor(pageCount))
  return null
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
  edges = 0,
  pageCount,
  siblings,
  boundaries,
}: {
  room: number
  /** 0 when the row has no pages, as between Previous, the page field and Next. */
  place: number
  gap: number
  words: number
  /** How much First and Last take with their gaps, 0 without them. */
  edges?: number
  pageCount: number
  siblings: number
  boundaries: number
}) {
  const wide = (sides: number, ends: number) => {
    if (place === 0) return 0
    const places = Math.min(Math.max(1, pageCount), placesFor(sides, ends))
    return places * place + (places - 1) * gap
  }
  // Half a pixel either way is rounding, not a lack of room.
  const fits = (width: number) => width + edges <= room + 0.5
  if (fits(wide(siblings, boundaries) + words)) {
    return { words: true, siblings, boundaries, edges: true }
  }
  for (let ends = boundaries; ends >= 0; ends--) {
    for (let sides = siblings; sides >= 0; sides--) {
      if (fits(wide(sides, ends)))
        return { words: false, siblings: sides, boundaries: ends, edges: true }
    }
  }
  // Last, First and Last go: Previous and Next still reach every page.
  return { words: false, siblings: 0, boundaries: 0, edges: edges === 0 }
}

/**
 * The room the pages and the words have in `nav`, how wide each page's place
 * is and how far apart, how much more the words beside Previous and Next
 * take, and how much First and Last take, as laid out. Previous and Next are
 * counted as squares, and their words from the text, whether they show or
 * not; First and Last as squares of the row's height, shown or not.
 */
function placesIn(nav: HTMLElement, row: HTMLElement) {
  const gap = Number.parseFloat(getComputedStyle(row).columnGap) || 0
  const quarter =
    Number.parseFloat(getComputedStyle(document.documentElement).fontSize) / 4
  let others = 0
  let place = 0
  let words = 0
  let edges = 0
  for (const child of row.children) {
    // The backdrop and the pill lie over the row and take no room in it.
    if (!(child instanceof HTMLElement) || child.matches(LAYERS)) continue
    const control = child.firstElementChild
    if (control?.matches('[data-slot=pagination-first], [data-slot=pagination-last]')) {
      edges += row.getBoundingClientRect().height + gap
      continue
    }
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
  return { room: nav.clientWidth - others, place, gap, words, edges }
}

export {
  Pagination,
  PaginationContent,
  PaginationFirst,
  PaginationLast,
  PaginationNext,
  PaginationPageField,
  PaginationPages,
  PaginationPageSize,
  PaginationPrevious,
  PaginationRange,
  countOf,
  fittingRange,
  pageItems,
}
export type { PageItem, PaginationRangeParts }
