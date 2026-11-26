'use client'

import {
  isStep,
  NumberInput,
  NumberInputGroup,
  NumberInputControl,
} from '@/registry/components/kino/number-input'
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
import { Swap, useSwapLeaving } from '@/registry/lib/swap'
import {
  createPaginationController,
  Pagination as PaginationPrimitive,
  PaginationEllipsis as PaginationEllipsisPrimitive,
  PaginationFirst as PaginationFirstPrimitive,
  PaginationItem as PaginationItemPrimitive,
  PaginationLast as PaginationLastPrimitive,
  PaginationLink as PaginationLinkPrimitive,
  PaginationList as PaginationListPrimitive,
  PaginationNext as PaginationNextPrimitive,
  PaginationPrevious as PaginationPreviousPrimitive,
  paginationRange,
} from '@ui-sdk/react/pagination'
import type { RenderProp } from '@ui-sdk/react/primitive'
import {
  cloneElement,
  type ComponentProps,
  type CSSProperties,
  createContext,
  type HTMLAttributes,
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
import { flushSync } from 'react-dom'

import { cn } from '@/lib/utils'

/*
 * A pager on ui-sdk's Pagination: the row of pages with Previous and Next,
 * and beside it what a table's footer needs, where the page sits in the
 * whole ("21–40 of 4,800"), how many rows a page holds, and a field to type
 * a page in. The row looks and moves like the Tabs: labels that darken on
 * hover, a backdrop that glides under the pointer, and a pill in the primary
 * colour that slides to the current page, with a copy of the row inside it
 * so each number changes colour exactly at its edge. The row keeps the same
 * number of places on every page, so nothing beside it moves: in the middle
 * of a long range the pill stays put and the numbers roll past it. A row too
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
  '[[data-slot=pagination-list]:not([data-words])_&]:sr-only [[data-slot=pagination-list]:has([data-slot=pagination-page-field])_&]:sr-only @max-lg/pagination:[[data-slot=pagination]:not([data-mounted])_&]:sr-only'
// Before the row is measured (as the page loads, before its script runs), a
// narrow row shows only the current page, so nothing is cut at its edges.
const beforeFit =
  '@max-md/pagination:[[data-slot=pagination]:not([data-mounted])_&]:hidden'

// First and Last, when the row has no room for them.
const edgeHidden = '[[data-slot=pagination-list]:not([data-edges])_&]:hidden'
const previousWord = cn(stepWord, '-ms-1 pe-[calc((var(--control-height)-1rem)/2)]')
const nextWord = cn(stepWord, '-me-1 ps-[calc((var(--control-height)-1rem)/2)]')

type PaginationController = ReturnType<typeof createPaginationController>

/** How many pages the row has room for, and whether its words and First and Last fit. */
interface Fit {
  words: boolean
  siblings: number
  boundaries: number
  edges: boolean
}

interface PaginationContextValue {
  page: number
  /** The pages there are, or while the count is unknown, the pages known so far. */
  pageCount: number
  /** Whether the count of pages is known. */
  known: boolean
  /** How many items there are, when that is known. */
  total: number | null
  pageSize: number
  controller: PaginationController
  setPageSize: (pageSize: number) => void
  /** The page a pressed page went to, so the row moves focus to it once it has rolled. */
  refocusRef: RefObject<number | null>
  /** The siblings and boundaries asked for. */
  siblings: number
  boundaries: number
  fit: Fit
  setFit: (fit: Fit) => void
  linked: boolean
  renderLink?: RenderProp
  disabled: boolean
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

/** True inside the row, where a part is one of its places. */
const RowContext = createContext(false)

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
  getHref,
  renderLink,
  controller: controllerProp,
  disabled = false,
  locale = 'en-US',
  style,
  'aria-label': ariaLabel = 'Pagination',
  ...props
}: Omit<
  ComponentProps<typeof PaginationPrimitive>,
  'className' | 'style' | 'children' | 'controller'
> & {
  className?: string
  style?: CSSProperties
  children?: ReactNode
  /** How many items a page holds, when it holds its own state. */
  defaultPageSize?: number
  /** Called with the new size. The page moves, through `onPageChange`, to the one that keeps the first item it showed. */
  onPageSizeChange?: (pageSize: number) => void
  /** Whether there is a page after this one, while the count is unknown, as with a cursor. */
  hasNextPage?: boolean
  /** Renders every page and step, such as your router's `<Link />`, with `getHref`. */
  renderLink?: RenderProp
  /** Pages it from anywhere. Create one with `createPaginationController()`. */
  controller?: PaginationController
  /** The locale numbers are written in. */
  locale?: Intl.LocalesArgument
}) {
  const [chosenSize, setPageSize] = useControllable(
    pageSizeProp,
    defaultPageSize,
    onPageSizeChange,
  )
  const pageSize = Math.max(1, Math.floor(chosenSize) || 1)
  const [own, setOwn] = useState(defaultPage)
  const known = countOf({ pageCount, total, pageSize })
  const page = clampPage(pageProp ?? own, known ?? Number.POSITIVE_INFINITY)
  // While the count is unknown, the pages known so far: up to this one, and the next when there is one.
  const count = known ?? page + (hasNextPage ? 1 : 0)
  const [fit, setFit] = useState<Fit>({ words: true, siblings, boundaries, edges: true })
  const [ownController] = useState(createPaginationController)
  const controller = controllerProp ?? ownController

  const refocusRef = useRef<number | null>(null)
  const navRef = useMemo(() => mergeRefs(markMounted, ref), [ref])

  return (
    <PaginationContext
      value={{
        page,
        pageCount: count,
        known: known !== null,
        total: total === undefined ? null : Math.max(0, Math.floor(total)),
        pageSize,
        controller,
        setPageSize: (size) => {
          const next = Math.max(1, Math.floor(size))
          if (next === pageSize) return
          // The new size first, so the page it moves to is counted in it.
          flushSync(() => setPageSize(next))
          controller.setPage(pageForSize(page, pageSize, next))
        },
        refocusRef,
        siblings,
        boundaries,
        fit,
        setFit,
        linked: getHref !== undefined,
        renderLink,
        disabled,
        locale,
      }}
    >
      <PaginationPrimitive
        ref={navRef}
        aria-label={ariaLabel}
        page={page}
        pageCount={count}
        siblings={fit.siblings}
        boundaries={fit.boundaries}
        getHref={getHref}
        controller={controller}
        disabled={disabled}
        onPageChange={(next, details) => {
          // While the count is unknown, Last has nowhere to go.
          if (details.reason === 'last-press' && known === null) {
            details.cancel()
            return
          }
          onPageChange?.(next, details)
          if (details.canceled) return
          if (details.reason === 'item-press') refocusRef.current = next
          setOwn(next)
        }}
        style={{ '--pagination-digits': String(count).length, ...style } as CSSProperties}
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
 * The row of pages, Previous and Next, in ui-sdk's list. It looks and moves
 * like the Tabs, and fits the room it is given: first the words beside
 * Previous and Next go, then pages.
 */
function PaginationList({
  className,
  children,
  ...props
}: Omit<ComponentProps<typeof PaginationListPrimitive>, 'className' | 'children'> & {
  children?: ReactNode
  /** For where the list sits among its neighbours: the box it measures its room in. */
  className?: string
}) {
  const { page, pageCount, siblings, boundaries, fit, setFit, refocusRef } =
    usePagination()
  const areaRef = useRef<HTMLDivElement>(null)
  const rowRef = useRef<HTMLUListElement>(null)
  const pillRef = useRef<HTMLLIElement>(null)
  const backdropRef = useRef<HTMLLIElement>(null)
  const fitRef = useRef(fit)
  useLayoutEffect(() => {
    fitRef.current = fit
  })

  // As many places as the room holds, measured where the row is laid out.
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
      const was = fitRef.current
      if (
        was.words !== next.words ||
        was.siblings !== next.siblings ||
        was.boundaries !== next.boundaries ||
        was.edges !== next.edges
      ) {
        setFit(next)
      }
    }
    measure()
    const resized = new ResizeObserver(measure)
    resized.observe(area)
    resized.observe(row)
    return () => resized.disconnect()
  }, [pageCount, siblings, boundaries, setFit])

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

  // Each place keeps its element as the pages change, so its number rolls: a
  // pressed page can roll to another place, and focus goes with it.
  useLayoutEffect(() => {
    const pressed = refocusRef.current
    refocusRef.current = null
    if (pressed !== page) return
    const row = rowRef.current
    if (!row?.contains(document.activeElement)) return
    row.querySelector<HTMLElement>(CURRENT)?.focus()
  }, [page, refocusRef])

  return (
    <RowContext value={true}>
      <div
        ref={areaRef}
        className={cn(
          // Grows into the room its neighbours leave, and wraps below them when that is less than a short row.
          '@container/pagination flex min-w-0 flex-[1_1_10rem] justify-center',
          // Until the pages are measured to fit, a row too wide is cut at the edge rather than spilling over.
          '[[data-slot=pagination]:not([data-mounted])_&]:overflow-x-clip',
          // The numbers the first measure changes take their place at once: nothing rolls on load.
          '[[data-slot=pagination]:not([data-mounted])_&]:[&_[data-slot=roll]_*]:transition-none',
          className,
        )}
      >
        <PaginationListPrimitive
          {...props}
          ref={rowRef}
          data-words={fit.words ? '' : undefined}
          data-edges={fit.edges ? '' : undefined}
          className={cn(paginationRow, 'relative isolate')}
        >
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
        </PaginationListPrimitive>
      </div>
    </RowContext>
  )
}

const controlClassName = cn(
  itemLayout,
  pillItemClassName,
  // Until the page hydrates and the pill is placed, the current page draws itself.
  '[[data-slot=pagination]:not([data-mounted])_&]:aria-[current=page]:bg-primary [[data-slot=pagination]:not([data-mounted])_&]:aria-[current=page]:text-primary-foreground',
)

type StepPart = typeof PaginationPreviousPrimitive

type StepProps = Omit<ComponentProps<StepPart>, 'className' | 'children'> & {
  className?: string
  /** The word beside the arrow, also its name when only the arrow shows. */
  children?: ReactNode
}

/**
 * A step to another page: an arrow in a page's square, with its word on
 * the side away from the pages when `word` is set and there is room. Without
 * it, the word is only the step's name. At its end it stays focusable as a
 * button, so focus isn't lost when Next reaches the last page.
 */
function PaginationStep({
  Part,
  icon,
  word,
  edge = false,
  className,
  children,
  ...props
}: StepProps & {
  Part: StepPart
  icon: ReactElement
  /** Where the word shows: before the arrow, after it, or never. */
  word?: 'before' | 'after'
  /** First or Last, which go when there's no room for them. */
  edge?: boolean
}) {
  const { renderLink, linked } = usePagination()
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
    <PaginationItemPrimitive className={cn('flex', hidden)}>
      <Part
        render={linked ? renderLink : undefined}
        className={cn(controlClassName, stepLayout, className)}
        {...props}
      >
        {parts}
      </Part>
    </PaginationItemPrimitive>
  )
}

/** Goes to the first page: an arrow only. */
function PaginationFirst({ children = 'First page', ...props }: StepProps) {
  return (
    <PaginationStep
      Part={PaginationFirstPrimitive}
      edge
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
  return (
    <PaginationStep
      Part={PaginationPreviousPrimitive}
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
  return (
    <PaginationStep
      Part={PaginationNextPrimitive}
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

/** A link at its end, as ui-sdk renders one: no address, out of the tab order. */
function atEnd(renderLink: RenderProp | undefined): RenderProp {
  return (props, state) => {
    const { children, ...rest } = props
    const ended = { ...rest, href: undefined, tabIndex: -1, role: 'link' }
    if (typeof renderLink === 'function') return renderLink({ ...ended, children }, state)
    if (renderLink) return cloneElement(renderLink, ended, children)
    return <a {...ended}>{children}</a>
  }
}

/** Goes to the last page: an arrow only. While the count is unknown it has nowhere to go. */
function PaginationLast({ children = 'Last page', ...props }: StepProps) {
  const { known, linked, renderLink } = usePagination()
  return (
    <PaginationStep
      Part={PaginationLastPrimitive}
      edge
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
      // ui-sdk counts the pages known so far as all there are: while the count
      // is unknown, this marks it at its end as ui-sdk marks a step there, and
      // the Pagination keeps the page when it is pressed.
      {...(known ? {} : { 'aria-disabled': true, 'data-disabled': '' })}
      {...(!known && linked && { render: atEnd(renderLink) })}
      {...props}
    >
      {children}
    </PaginationStep>
  )
}

/**
 * A page in the row. One leaving as its place turns into an ellipsis is a
 * still copy, so ui-sdk counts only the pages that show.
 */
function PaginationPage({
  page,
  label,
  className,
}: {
  page: number
  label: string
  className?: string
}) {
  const { linked, renderLink } = usePagination()
  const number = <RollingNumber value={page} text={String(page)} />
  if (useSwapLeaving()) {
    return <span className={cn(controlClassName, className)}>{number}</span>
  }
  return (
    <PaginationLinkPrimitive
      page={page}
      render={linked ? renderLink : undefined}
      className={cn(controlClassName, className)}
    >
      {/* The number rolls for the eye; its name is read whole. */}
      <span className='sr-only'>{label}</span>
      {number}
    </PaginationLinkPrimitive>
  )
}

/**
 * The numbered pages from ui-sdk's range, with an ellipsis for each run it
 * skips. Each place stays the same element as the pages change, so its
 * number rolls.
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
  const { page, pageCount, known, fit } = usePagination()
  const copy = use(PaginationCopyContext)
  const items = pagesOf({
    page,
    pageCount,
    siblings: fit.siblings,
    boundaries: fit.boundaries,
  })
  return items.map((item, place) => {
    const number = typeof item === 'number'
    let content: ReactNode
    if (!number) {
      const ellipsis = cn(itemLayout, 'text-foreground/60', className)
      const icon = (
        <IconPlaceholder
          lucide='EllipsisIcon'
          tabler='IconDots'
          hugeicons='MoreHorizontalIcon'
          phosphor='DotsThreeIcon'
          remixicon='RiMoreLine'
          aria-hidden
        />
      )
      content = copy ? (
        <span className={ellipsis}>{icon}</span>
      ) : (
        <PaginationEllipsisPrimitive className={ellipsis}>
          {icon}
        </PaginationEllipsisPrimitive>
      )
    } else if (copy) {
      content = (
        <span className={cn(itemLayout, className)}>
          <RollingNumber value={item} text={String(item)} />
        </span>
      )
    } else {
      content = (
        <PaginationPage
          page={item}
          label={pageLabel(item, item === page && known ? pageCount : undefined)}
          className={className}
        />
      )
    }
    // Keyed by place, not by page, so a place's number rolls as the range
    // moves, and one that turns from a page into an ellipsis, or back, crossfades.
    const swap = <Swap id={number ? 'page' : 'ellipsis'}>{content}</Swap>
    const placeClassName = cn('flex', item !== page && beforeFit)
    return copy ? (
      <span key={place} className={placeClassName}>
        {swap}
      </span>
    ) : (
      <PaginationItemPrimitive
        key={place}
        className={placeClassName}
        aria-hidden={number ? undefined : true}
      >
        {swap}
      </PaginationItemPrimitive>
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
  const {
    page,
    pageCount,
    known,
    controller,
    disabled: allDisabled,
    locale,
  } = usePagination()
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
    controller.setPage(to)
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
      <NumberInput
        value={draft}
        min={1}
        max={pageCount}
        step={1}
        disabled={disabled ?? allDisabled}
        locale={numberFormatter(locale).resolvedOptions().locale}
        format={{ maximumFractionDigits: 0, useGrouping: false }}
        onValueChange={(value, details) => {
          setDraft(value)
          // A step goes at once; what is typed or pasted goes when it is sent.
          if (value !== null && isStep(details.reason)) controller.setPage(value)
        }}
        onValueCommit={send}
      >
        <NumberInputGroup className={pageBox}>
          <NumberInputControl
            aria-labelledby={labelId}
            aria-describedby={ofText ? ofId : undefined}
          />
        </NumberInputGroup>
      </NumberInput>
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
  const { pageSize, setPageSize, disabled: allDisabled, locale } = usePagination()
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
        disabled={disabled ?? allDisabled}
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

/**
 * How many places the row keeps once there are more pages: ui-sdk's range
 * with the ends and their ellipses, or a window of pages with none.
 */
function placesFor(siblings: number, boundaries: number) {
  return boundaries > 0 ? 2 * boundaries + 2 * siblings + 3 : 2 * siblings + 1
}

/**
 * The row's places: ui-sdk's range while it keeps ends, and with none, a
 * window of `siblings` pages either side of the current one, held inside the
 * range, since an ellipsis with no end beyond it stands for nothing a person
 * can reach.
 */
function pagesOf({
  page,
  pageCount,
  siblings,
  boundaries,
}: {
  page: number
  pageCount: number
  siblings: number
  boundaries: number
}): ReturnType<typeof paginationRange> {
  if (boundaries > 0) return paginationRange({ page, pageCount, siblings, boundaries })
  const count = Math.max(1, pageCount)
  const places = Math.min(count, placesFor(siblings, 0))
  const start = Math.min(Math.max(1, page - siblings), count - places + 1)
  return Array.from({ length: places }, (_, at) => start + at)
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
  PaginationFirst,
  PaginationLast,
  PaginationList,
  PaginationNext,
  PaginationPageField,
  PaginationPages,
  PaginationPageSize,
  PaginationPrevious,
  PaginationRange,
  countOf,
  fittingRange,
  pagesOf,
}
export type { PaginationRangeParts }
