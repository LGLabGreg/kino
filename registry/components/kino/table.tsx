'use client'

import { Button } from '@/registry/components/kino/button'
import { CollapsibleIndicator } from '@/registry/components/kino/collapsible'
import { Progress } from '@/registry/components/kino/progress'
import { SkeletonText } from '@/registry/components/kino/skeleton'
import { useSpinner } from '@/registry/components/kino/spinner'
import { IconPlaceholder } from '@/registry/icons/icon-placeholder'
import { CutTooltip } from '@/registry/lib/cut'
import { flowItemClassName, followFlow } from '@/registry/lib/flow'
import {
  followPointer,
  type HighlightTarget,
  rowHighlightClassName,
  tintedRowTextClassName,
} from '@/registry/lib/highlight'
import { markMounted, mergeRefs } from '@/registry/lib/refs'
import { followColumns, followHeight } from '@/registry/lib/resize'
import {
  followEdges,
  revealBehavior,
  scrollRegionRingClassName,
  useScrollRegion,
} from '@/registry/lib/scroll'
import { cva, type VariantProps } from 'class-variance-authority'
import {
  type ComponentProps,
  createContext,
  type ReactNode,
  use,
  useEffect,
  useId,
  type CSSProperties,
  useRef,
  useState,
} from 'react'

import { cn } from '@/lib/utils'

/*
 * A table whose rows answer as one group: one highlight glides from row to
 * row under the pointer, and picked rows tint and join into one block (the
 * `lined` variant draws hairlines between rows instead). When rows come, go or reorder,
 * each one glides to its new place on `layout` and one that leaves fades
 * where it was on `exit`, while the box follows the table's height, so an
 * empty state that takes the rows' place never makes the page jump. A wide
 * table scrolls sideways, its edges fading while columns are hidden past
 * them; a tall one scrolls under a sticky header.
 */

/**
 * The body row the pointer or focus is in; between rows, where rows glide
 * and the copy of one that leaves still fades, a gap; in the header, footer
 * or caption, none.
 */
function rowOf(node: EventTarget | null): HighlightTarget {
  if (!(node instanceof Element)) return 'none'
  const row = node.closest<HTMLElement>('[data-slot=table-body] > [data-slot=table-row]')
  if (row) return row
  return node.matches('[data-slot=table]') || node.closest('[data-slot=table-body]')
    ? 'gap'
    : 'none'
}

/** The id of what names the table, for its scroll region to take the same name. */
const tableIdOf = (scroller: HTMLElement) => {
  const table = scroller.querySelector('table')
  if (!table) return undefined
  const caption = table.querySelector(':scope > caption')
  if (caption) return caption.id
  // A name is followed only one step: point at what names the table, not at the table.
  return (
    table.getAttribute('aria-labelledby') ??
    (table.hasAttribute('aria-label') ? table.id : undefined)
  )
}

/** Where focus goes when the box stops scrolling while focused: the table's first control, else the table. */
const tableFocusOf = (scroller: HTMLElement) => {
  const table = scroller.querySelector('table')
  const control = table?.querySelector<HTMLElement>(
    'a[href], button:not(:disabled), input:not(:disabled), select, textarea, [tabindex]:not([tabindex="-1"])',
  )
  if (control || !table) return control
  table.tabIndex = -1
  return table
}

/**
 * Scrolls what takes focus out from under a sticky column, which would cover
 * it and its ring: the browser counts it as in view. Returns a function that
 * stops.
 */
/**
 * How far, in px along the x axis, to scroll so `box` sits clear of a
 * column pinned at `pinned`, with 8px for its focus ring; 0 when it already
 * is. A column left of `middle` is pinned to the left edge, so `box`
 * belongs to its right, and one right of it the reverse.
 */
function clearOfPinned(
  box: { left: number; right: number },
  pinned: { left: number; right: number; width: number },
  middle: number,
): number {
  if (pinned.left + pinned.width / 2 < middle) {
    return box.left < pinned.right + 8 ? box.left - pinned.right - 8 : 0
  }
  return box.right > pinned.left - 8 ? box.right - pinned.left + 8 : 0
}

function keepFocusInView(scroller: HTMLElement): () => void {
  const clear = (event: FocusEvent) => {
    const target = event.target
    if (!(target instanceof HTMLElement) || target.closest('[data-sticky]')) return
    const box = target.getBoundingClientRect()
    const row = target.closest('tr')
    if (!row) return
    const middle = scroller.getBoundingClientRect().left + scroller.clientWidth / 2
    let delta = 0
    for (const cell of row.querySelectorAll<HTMLElement>(':scope > [data-sticky]')) {
      delta = clearOfPinned(box, cell.getBoundingClientRect(), middle) || delta
    }
    if (delta !== 0)
      scroller.scrollBy({ left: delta, behavior: revealBehavior(scroller) })
  }
  scroller.addEventListener('focusin', clear)
  return () => scroller.removeEventListener('focusin', clear)
}

/**
 * A table with a resizable column lays out by its columns' widths: each head
 * without one of its own keeps the width it was laid out at, and the table
 * is as wide as its columns together. Returns a function that stops.
 */
function followResizable(table: HTMLTableElement): () => void {
  const heads = () => [
    ...table.querySelectorAll<HTMLTableCellElement>(
      ':scope > thead > tr:first-child > th',
    ),
  ]
  // The heads whose width this code gave them, as laid out, rather than a resize.
  const ours = new WeakSet<Element>()
  const set = (element: HTMLElement, name: string, value: string) => {
    if (element.style.getPropertyValue(name) !== value)
      element.style.setProperty(name, value)
  }
  const widthOf = (head: HTMLElement) =>
    Number.parseFloat(head.style.getPropertyValue('--column-width'))
  const update = () => {
    const all = heads()
    if (!all.some((head) => head.hasAttribute('data-resizable'))) {
      delete table.dataset.resizable
      table.style.removeProperty('--table-width')
      return
    }
    // A table with no layout (mounted hidden) has no widths to keep yet.
    if (table.getBoundingClientRect().width === 0) return
    const unsized = all.filter((head) => !head.style.getPropertyValue('--column-width'))
    if (unsized.length > 0) {
      // Measured as the table lays them out on its own, then kept.
      delete table.dataset.resizable
      // Within the bounds of a column that resizes, so its handle never reads out of them.
      const widths = unsized.map((head) => {
        const width = head.getBoundingClientRect().width
        const handle = head.querySelector(':scope > [data-slot=table-resize]')
        if (!handle) return width
        const min = Number(handle.getAttribute('aria-valuemin') ?? 0)
        const max = Number(handle.getAttribute('aria-valuemax') ?? Infinity)
        return Math.min(Math.max(width, min), max)
      })
      unsized.forEach((head, index) => {
        ours.add(head)
        set(head, '--column-width', `${widths[index]}px`)
      })
    }
    // A handle whose column hasn't been resized reads out the width it was laid out at.
    for (const head of all) {
      const handle = head.querySelector<HTMLElement>(':scope > [data-slot=table-resize]')
      const width = String(Math.round(widthOf(head)))
      if (handle && handle.getAttribute('aria-valuenow') !== width) {
        handle.setAttribute('aria-valuenow', width)
      }
    }
    set(table, '--table-width', `${all.reduce((sum, head) => sum + widthOf(head), 0)}px`)
    if (!table.hasAttribute('data-resizable')) table.dataset.resizable = ''
  }
  /** Lays out again the widths this code kept, once fonts have loaded or a hidden table shows. */
  const remeasure = () => {
    for (const head of heads()) {
      if (ours.has(head)) head.style.removeProperty('--column-width')
    }
    update()
  }
  update()
  // Only the header holds the widths: the body's rows write styles on every glide.
  const changes = new MutationObserver(update)
  const watchHead = () => {
    if (!table.tHead) return
    changes.observe(table.tHead, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['style', 'data-resizable', 'aria-valuenow'],
    })
  }
  watchHead()
  const sections = new MutationObserver(() => {
    changes.disconnect()
    watchHead()
    update()
  })
  sections.observe(table, { childList: true })
  let shown = table.getBoundingClientRect().width > 0
  const sizes = new ResizeObserver(() => {
    const now = table.getBoundingClientRect().width > 0
    if (now && !shown) remeasure()
    shown = now
  })
  sizes.observe(table)
  let live = true
  void document.fonts?.ready.then(() => {
    if (live) remeasure()
  })
  return () => {
    live = false
    changes.disconnect()
    sections.disconnect()
    sizes.disconnect()
  }
}

const tableVariants = cva(
  // Resizable, it lays out by its columns' widths and is as wide as they are.
  'group/table relative w-full caption-bottom border-separate border-spacing-0 bg-inherit text-sm data-resizable:table-fixed data-resizable:w-(--table-width)',
  {
    variants: {
      variant: {
        default: '',
        lined: '',
      },
    },
    defaultVariants: { variant: 'default' },
  },
)

function Table({
  className,
  containerClassName,
  variant = 'default',
  loading = false,
  scroll = true,
  ref,
  id,
  ...props
}: ComponentProps<'table'> &
  VariantProps<typeof tableVariants> & {
    /** Sizes the box the table scrolls in: a `max-h-` makes the header stick. */
    containerClassName?: string
    /**
     * New rows are on their way: the rows there are stay, readable, and a
     * line slides along the header's edge once it lasts 200ms, for at least
     * 300ms. Before the first rows arrive, show a `TableSkeleton` in the body.
     */
    loading?: boolean
    /**
     * `false` for a table that never outgrows its width: it doesn't scroll in
     * a box of its own, so its header sticks to the page as the page scrolls.
     */
    scroll?: boolean
  }) {
  const busy = useSpinner(loading)
  // The line mounts the first time the table loads, and stays to fade out.
  const [hasLoaded, setHasLoaded] = useState(loading)
  if (loading && !hasLoaded) setHasLoaded(true)
  const frameRef = useRef<HTMLDivElement>(null)
  const scrollerRef = useRef<HTMLDivElement>(null)
  const tableRef = useRef<HTMLTableElement>(null)
  const areaRef = useRef<HTMLDivElement>(null)
  const layerRef = useRef<HTMLSpanElement>(null)
  const ownId = useId()
  const region = useScrollRegion(scrollerRef, {
    contentRef: tableRef,
    axis: 'both',
    labelledBy: tableIdOf,
    refocus: tableFocusOf,
  })

  useEffect(() => {
    const frame = frameRef.current
    const scroller = scrollerRef.current
    const table = tableRef.current
    const area = areaRef.current
    const layer = layerRef.current
    if (!frame || !scroller || !table || !area || !layer) return
    const stops = [
      // One highlight for every row, so it glides from row to row.
      followPointer(area, layer, { itemOf: rowOf, focus: true }),
      markMounted(table),
      followEdges(scroller, '--table-fade', table),
      // The rows' clip follows the table's height, inside the box that scrolls:
      // rows not yet shown, and the copies of rows still leaving, are clipped
      // as the height glides, never something to scroll to.
      followHeight(area, table),
      // The footer and caption glide with the bottom edge of the rows above them.
      followFlow(table, 'tbody, tfoot, caption'),
      followResizable(table),
      keepFocusInView(scroller),
    ]
    return () => {
      for (const stop of stops) stop?.()
    }
  }, [])

  return (
    <div
      ref={frameRef}
      data-slot='table-container'
      className={cn(
        scrollRegionRingClassName,
        'relative flex w-full min-w-0 flex-col overflow-clip bg-inherit',
        containerClassName,
      )}
    >
      <div
        ref={scrollerRef}
        data-slot='table-scroller'
        {...region}
        // Its padding keeps what Tab scrolls to clear of the sticky header. Its mask fades
        // each side with content past it: sideways past the pinned columns, and down
        // from under the sticky header, which it never fades.
        className={cn(
          'group/table-scroller min-h-0 flex-auto bg-inherit scroll-pt-[calc(var(--control-height)+5px)] [mask-image:linear-gradient(to_right,transparent,black_calc(var(--table-fade-start,0px)*var(--table-fade-start-on,1)),black_calc(100%-var(--table-fade-end,0px)*var(--table-fade-end-on,1)),transparent),linear-gradient(to_bottom,black_calc(var(--control-height)+5px),transparent_calc(var(--control-height)+5px),black_calc(var(--control-height)+5px+var(--table-fade-top,0px)),black_calc(100%-var(--table-fade-bottom,0px)),transparent)] rtl:[mask-image:linear-gradient(to_left,transparent,black_calc(var(--table-fade-start,0px)*var(--table-fade-start-on,1)),black_calc(100%-var(--table-fade-end,0px)*var(--table-fade-end-on,1)),transparent),linear-gradient(to_bottom,black_calc(var(--control-height)+5px),transparent_calc(var(--control-height)+5px),black_calc(var(--control-height)+5px+var(--table-fade-top,0px)),black_calc(100%-var(--table-fade-bottom,0px)),transparent)] [mask-composite:intersect] has-[[data-sticky=start]]:[--table-fade-start-on:0] has-[[data-sticky=end]]:[--table-fade-end-on:0] focus-visible:outline-hidden',
          // Clipped, not scrolled, so the page is what the header sticks to.
          scroll
            ? 'scrollbar-thin overflow-auto overscroll-x-contain'
            : 'overflow-x-clip',
        )}
      >
        {/* As wide as the table, so the highlight scrolls with its rows; its
            rows sit 4px inside the box, so their corners show. It clips
            without scrolling, so the header still sticks to the box. */}
        <div
          ref={areaRef}
          className='relative isolate w-fit min-w-full overflow-clip bg-inherit p-1 transition-[height] duration-(--motion-layout-duration) ease-(--motion-layout-easing) motion-reduce:transition-none'
        >
          <table
            ref={mergeRefs(tableRef, ref)}
            id={id ?? ownId}
            data-slot='table'
            data-variant={variant}
            data-loading={busy ? '' : undefined}
            aria-busy={loading || undefined}
            className={cn(tableVariants({ variant }), className)}
            {...props}
          />
          <span
            ref={layerRef}
            aria-hidden
            data-slot='table-highlight'
            className={rowHighlightClassName}
          />
        </div>
      </div>
      {/* While new rows load, a line slides along the header's bottom edge;
          the table says it is busy, so the line itself isn't read. */}
      {hasLoaded ? (
        <div
          aria-hidden
          data-slot='table-loading'
          className='pointer-events-none absolute inset-x-0 top-[calc(var(--control-height)+3px)] z-40 px-1'
        >
          <Progress
            value={busy ? null : 0}
            className='[&_[data-slot=progress-track]]:h-0.5 [&_[data-slot=progress-track]]:bg-transparent'
          />
        </div>
      ) : null}
    </div>
  )
}

/**
 * How a row moves: it glides to a new place on `layout` (`followFlow`),
 * fades in on `enter` once its body has painted, and its copy fades where it
 * was on `exit`, finishing a glide it was on.
 */

/**
 * A column that stays in view at the table's start or end edge as the rest
 * scrolls under it, with a line along its inner edge once something is
 * hidden past it.
 */
const stickyClassName = {
  start:
    'sticky start-0 z-10 bg-inherit after:pointer-events-none after:absolute after:inset-y-0 after:end-0 after:w-px after:bg-border after:opacity-0 after:transition-opacity after:duration-(--motion-enter-duration) after:ease-(--motion-enter-easing) forced-colors:after:bg-[CanvasText] group-data-edge-start/table-scroller:after:opacity-100',
  end: 'sticky end-0 z-10 bg-inherit after:pointer-events-none after:absolute after:inset-y-0 after:start-0 after:w-px after:bg-border after:opacity-0 after:transition-opacity after:duration-(--motion-enter-duration) after:ease-(--motion-enter-easing) forced-colors:after:bg-[CanvasText] group-data-edge-end/table-scroller:after:opacity-100',
} as const

/** In the body, where a `TableHead` is a row's header. */
const InBodyContext = createContext(false)

// The first and last columns take the box's 4px inset off their padding, so
// they line up with what is above the table.
const headClassName =
  'group/head relative group-has-[th[data-resizable]]/table:px-[calc(var(--control-padding)*0.8+12px)] group-has-[th[data-resizable]]/table:first:ps-[calc(var(--surface-padding)-4px)] group-data-resizable/table:w-(--column-width) group-data-resizing/table:[transition:none] in-data-columns-moving:overflow-clip text-muted-foreground h-(--control-height) border-b border-transparent px-(--control-padding) text-start align-middle text-xs font-medium whitespace-nowrap [transition:width_var(--motion-layout-duration)_var(--motion-layout-easing),border-color_var(--motion-enter-duration)_var(--motion-enter-fade-easing),background-color_var(--motion-press-duration)_var(--motion-press-fade-easing)] group-data-scrolled/table-scroller:border-border group-data-[variant=lined]/table:border-border motion-reduce:[transition:border-color_var(--motion-enter-duration)_var(--motion-enter-fade-easing),background-color_var(--motion-press-duration)_var(--motion-press-fade-easing)] first:ps-[calc(var(--surface-padding)-4px)] last:pe-[calc(var(--surface-padding)-4px)]'

const cellClassName =
  'group-has-[th[data-resizable]]/table:px-[calc(var(--control-padding)*0.8+12px)] group-has-[th[data-resizable]]/table:first:ps-[calc(var(--surface-padding)-4px)] group-data-resizable/table:overflow-hidden group-data-resizable/table:text-ellipsis in-data-columns-moving:overflow-clip h-(--control-height-lg) px-(--control-padding) align-middle whitespace-nowrap [transition:background-color_var(--motion-press-duration)_var(--motion-press-fade-easing),border-radius_var(--motion-morph-duration)_var(--motion-morph-easing)] motion-reduce:[transition:background-color_var(--motion-press-duration)_var(--motion-press-fade-easing)] first:ps-[calc(var(--surface-padding)-4px)] last:pe-[calc(var(--surface-padding)-4px)] group-data-[variant=default]/table:in-data-[slot=table-body]:first:rounded-s-(--item-radius) group-data-[variant=default]/table:in-data-[slot=table-body]:last:rounded-e-(--item-radius)'

/** Sticks to the top of a table that scrolls, over what passes under it. */
function TableHeader({ className, ...props }: ComponentProps<'thead'>) {
  return (
    <thead
      data-slot='table-header'
      className={cn('sticky top-0 z-30 bg-inherit', className)}
      {...props}
    />
  )
}

function TableBody({ className, ref, children, ...props }: ComponentProps<'tbody'>) {
  const bodyRef = useRef<HTMLTableSectionElement>(null)
  useEffect(() => {
    const body = bodyRef.current
    const table = body?.closest('table')
    if (!body || !table) return
    // Columns first, so a row that leaves takes the widths they had.
    const stopColumns = followColumns(table)
    // A row put back while its copy still leaves (re-expanded mid-close) turns back from where it got to.
    const stopFlow = followFlow(body, 'tr', { key: 'data-row-id' })
    // Rows fade in once the body has painted: a body put in fresh, as rows
    // swap on a page turn, shows its rows at once.
    const stopMounted = markMounted(body)
    return () => {
      stopColumns()
      stopFlow()
      stopMounted?.()
    }
  }, [])
  return (
    <tbody
      ref={mergeRefs(bodyRef, ref)}
      data-slot='table-body'
      className={cn('group/flow relative isolate bg-inherit', className)}
      {...props}
    >
      <InBodyContext value>{children}</InBodyContext>
    </tbody>
  )
}

function TableFooter({ className, ...props }: ComponentProps<'tfoot'>) {
  return (
    <tfoot
      data-slot='table-footer'
      className={cn(
        'bg-inherit font-medium transition-[translate] duration-(--motion-layout-duration) ease-(--motion-layout-easing) motion-reduce:transition-none data-[flow=start]:transition-none [&>tr>*]:border-t',
        className,
      )}
      {...props}
    />
  )
}

/** `selected` tints the row, for one picked by its checkbox; picked rows side by side join. */
function TableRow({
  className,
  selected = false,
  ...props
}: ComponentProps<'tr'> & { selected?: boolean }) {
  return (
    <tr
      data-slot='table-row'
      data-selected={selected ? '' : undefined}
      className={cn(
        flowItemClassName,
        // Opaque, so rows that cross as they reorder, and the copies of rows that leave, don't show through.
        'bg-inherit',
        // Its corners, for the highlight to take; the cells draw them.
        'group-data-[variant=default]/table:rounded-(--item-radius) forced-colors:[&[data-selected]]:text-[HighlightText]',
        // Picked rows tint, and picked rows next to each other join into one block.
        '[&[data-selected]>*]:bg-muted forced-colors:[&[data-selected]>*]:bg-[Highlight] forced-colors:[&[data-selected]>*]:forced-color-adjust-none forced-colors:[&[data-selected]>*]:text-[HighlightText] forced-colors:[&[data-selected]_*]:text-[HighlightText] [&[data-selected]:has(+[data-selected])>*]:rounded-b-none [[data-selected]+&[data-selected]>*]:rounded-t-none',
        // Lined: a hairline above every row that follows another, not counting
        // the copies of rows that leave, which fade where they were.
        'in-data-[slot=table-body]:group-data-[variant=lined]/table:[[data-slot=table-row]:not([data-leaving])~&>*]:border-t',
        tintedRowTextClassName,
        className,
      )}
      {...props}
    />
  )
}

/**
 * `numeric` lines the column up at its end edge in figures of one width.
 * With `onSort`, its label is a button that sorts the column.
 */
function TableHead({
  className,
  numeric = false,
  sort,
  sortIndex,
  onSort,
  sticky,
  width,
  minWidth = 64,
  maxWidth = 800,
  onWidthChange,
  resizeLabel,
  style,
  children,
  ...props
}: ComponentProps<'th'> & {
  numeric?: boolean
  /** How the column is sorted now: give it with `onSort`. */
  sort?: 'ascending' | 'descending' | 'none'
  /** Its place in a sort by several columns, from 1: shown beside the arrow. */
  sortIndex?: number
  /** Called when its label is pressed; Shift may add the column to the sort. */
  onSort?: (event: { shiftKey: boolean }) => void
  /** Keeps the column in view at the table's start or end edge as the rest scrolls; give its cells the same. */
  sticky?: 'start' | 'end'
  /** The column's width in px, once resized: its laid-out width until then. */
  width?: number
  /** The narrowest a resize takes it, in px. */
  minWidth?: number
  /** The widest a resize takes it, in px. */
  maxWidth?: number
  /** With it, the column's end edge drags, and its handle takes the arrow keys, to resize it; undefined puts it back. */
  onWidthChange?: (width: number | undefined) => void
  /** The handle's name: “Resize” and the label by default. */
  resizeLabel?: string
}) {
  // In the body, a row's header reads as a cell of its row.
  const inBody = use(InBodyContext)
  const sorted = sort === 'ascending' || sort === 'descending'
  const resizable = onWidthChange !== undefined && !inBody
  return (
    <th
      data-slot='table-head'
      data-sticky={sticky}
      data-resizable={resizable ? '' : undefined}
      // Only the column that sorts first is named as sorted.
      aria-sort={sorted && (sortIndex ?? 1) === 1 ? sort : undefined}
      style={
        width === undefined
          ? style
          : ({ ...style, '--column-width': `${width}px` } as CSSProperties)
      }
      className={cn(
        inBody ? cn(cellClassName, 'text-start font-medium') : headClassName,
        numeric && 'text-end tabular-nums',
        sticky && stickyClassName[sticky],
        // The header row's sticky cell sits over the body's.
        sticky && !inBody && 'z-20',
        className,
      )}
      {...props}
    >
      {onSort ? (
        <TableSortButton
          sort={sort ?? 'none'}
          sortIndex={sortIndex}
          numeric={numeric}
          onSort={onSort}
        >
          {children}
        </TableSortButton>
      ) : (
        // In a column narrowed below it, the label truncates, and shows whole under the pointer.
        <CutTooltip
          render={
            <span
              data-cut
              className='group-data-resizable/table:block group-data-resizable/table:truncate'
            >
              {children}
            </span>
          }
        />
      )}
      {resizable ? (
        <TableResizeHandle
          label={
            resizeLabel ??
            (typeof children === 'string' ? `Resize ${children}` : 'Resize column')
          }
          width={width}
          minWidth={minWidth}
          maxWidth={maxWidth}
          onWidthChange={onWidthChange}
        />
      ) : null}
    </th>
  )
}

/** How far one press of an arrow key resizes a column, in px; with Shift, four times as far. */
const RESIZE_STEP = 16

/**
 * A column's width once it is dragged or keyed `delta` px towards its end
 * edge from `start`, held between `min` and `max`, in whole px.
 */
function resizedWidth(start: number, delta: number, min: number, max: number) {
  return Math.round(Math.min(Math.max(start + delta, min), max))
}

/**
 * Makes a resize by key or double-click land at once, as a drag does: the
 * table, whose width follows its columns at once, and the columns move together.
 */
function resizeAtOnce(handle: HTMLElement, change: () => void) {
  const table = handle.closest('table')
  if (!table) return change()
  table.dataset.resizing = ''
  change()
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      delete table.dataset.resizing
    }),
  )
}

/**
 * Follows a drag of a column's edge from `event`: the column takes each new
 * width at once, and `done` hears the last one when the pointer lets go.
 * The table is marked `data-resizing` meanwhile, so its columns don't ease.
 */
function dragColumnEdge(
  handle: HTMLElement,
  event: PointerEvent,
  { min, max, done }: { min: number; max: number; done: (width: number) => void },
) {
  const head = handle.closest('th')
  const table = handle.closest('table')
  if (!head || !table) return
  // From the width it is going to, not one partway through an ease.
  const start =
    Number.parseFloat(head.style.getPropertyValue('--column-width')) ||
    head.getBoundingClientRect().width
  const from = event.clientX
  const rtl = getComputedStyle(table).direction === 'rtl'
  let width = start
  handle.setPointerCapture(event.pointerId)
  table.dataset.resizing = ''
  handle.dataset.dragging = ''
  const move = (next: PointerEvent) => {
    width = resizedWidth(start, (next.clientX - from) * (rtl ? -1 : 1), min, max)
    head.style.setProperty('--column-width', `${width}px`)
  }
  const end = () => {
    handle.removeEventListener('pointermove', move)
    handle.removeEventListener('pointerup', end)
    handle.removeEventListener('pointercancel', end)
    delete table.dataset.resizing
    delete handle.dataset.dragging
    // A press that never moved, such as a double-click's first, changes nothing.
    if (width !== start) done(width)
  }
  handle.addEventListener('pointermove', move)
  handle.addEventListener('pointerup', end)
  handle.addEventListener('pointercancel', end)
}

/**
 * The edge of a column that resizes it: a separator a pointer drags, the
 * arrow keys move (Shift for farther), Home and End take to its bounds, and a
 * double press puts back.
 */
function TableResizeHandle({
  label,
  width,
  minWidth,
  maxWidth,
  onWidthChange,
}: {
  label: string
  width: number | undefined
  minWidth: number
  maxWidth: number
  onWidthChange: (width: number | undefined) => void
}) {
  // The width it is going to, not one partway through an ease.
  const now = (handle: HTMLElement) => {
    const head = handle.closest('th')
    const kept = head
      ? Number.parseFloat(head.style.getPropertyValue('--column-width'))
      : NaN
    if (!Number.isNaN(kept)) return kept
    return width ?? head?.getBoundingClientRect().width ?? minWidth
  }
  return (
    <span
      role='separator'
      aria-orientation='vertical'
      aria-label={label}
      aria-valuemin={minWidth}
      aria-valuemax={maxWidth}
      aria-valuenow={width === undefined ? undefined : Math.round(width)}
      tabIndex={0}
      data-slot='table-resize'
      onPointerDown={(event) => {
        if (event.button !== 0) return
        event.preventDefault()
        dragColumnEdge(event.currentTarget, event.nativeEvent, {
          min: minWidth,
          max: maxWidth,
          done: onWidthChange,
        })
      }}
      onDoubleClick={(event) =>
        resizeAtOnce(event.currentTarget, () => onWidthChange(undefined))
      }
      onKeyDown={(event) => {
        const handle = event.currentTarget
        const rtl = getComputedStyle(handle).direction === 'rtl'
        const step = RESIZE_STEP * (event.shiftKey ? 4 : 1)
        const by: Partial<Record<string, number>> = {
          ArrowRight: rtl ? -step : step,
          ArrowLeft: rtl ? step : -step,
        }
        const to =
          event.key === 'Enter'
            ? null
            : event.key === 'Home'
              ? minWidth
              : event.key === 'End'
                ? maxWidth
                : by[event.key] === undefined
                  ? undefined
                  : resizedWidth(now(handle), by[event.key] ?? 0, minWidth, maxWidth)
        if (to === undefined) return
        event.preventDefault()
        // Enter puts it back, as a double-click does.
        resizeAtOnce(handle, () => onWidthChange(to === null ? undefined : to))
      }}
      // 24px across the column's edge: a resizable table gives every column 12px of room beside it.
      className='absolute inset-y-0 -end-3 z-10 w-6 cursor-col-resize touch-none rounded-(--control-radius-xs) after:absolute after:inset-y-2 after:start-1/2 after:w-px after:-translate-x-1/2 after:bg-border after:opacity-0 after:transition-[opacity,background-color] after:duration-(--motion-press-duration) after:ease-(--motion-press-fade-easing) group-hover/head:after:opacity-100 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-hidden focus-visible:after:opacity-100 data-dragging:after:bg-primary data-dragging:after:opacity-100 forced-colors:after:bg-[CanvasText] rtl:after:translate-x-1/2'
    />
  )
}

/** A head's label as a button, with the arrow that says which way the column is sorted. */
function TableSortButton({
  sort,
  sortIndex,
  numeric,
  onSort,
  children,
}: {
  sort: 'ascending' | 'descending' | 'none'
  sortIndex?: number
  numeric: boolean
  onSort: (event: { shiftKey: boolean }) => void
  children: ReactNode
}) {
  const sorted = sort !== 'none'
  // Always there, so the label never moves when the arrow appears; it turns to
  // say which way, and shows faintly on hover before a sort. It sits in the
  // Button's own icon slot: before the label in a column of numbers, so the
  // label lines up with the figures at the column's end, and after it otherwise.
  const arrow = (
    <span
      aria-hidden
      data-icon={numeric ? 'inline-start' : 'inline-end'}
      className='flex items-center gap-0.5 opacity-0 transition-opacity duration-(--motion-press-duration) ease-(--motion-press-easing) group-hover/sort:opacity-50 group-focus-visible/sort:opacity-50 group-data-sorted/sort:opacity-100'
    >
      <span
        data-slot='table-sort-arrow'
        className={cn(
          'flex transition-[rotate] duration-(--motion-morph-duration) ease-(--motion-morph-easing) motion-reduce:transition-none',
          sort === 'ascending' && 'rotate-180',
        )}
      >
        <IconPlaceholder
          lucide='ArrowDownIcon'
          tabler='IconArrowDown'
          hugeicons='ArrowDown02Icon'
          phosphor='ArrowDownIcon'
          remixicon='RiArrowDownLine'
          aria-hidden
        />
      </span>
      {sortIndex !== undefined ? (
        <span className='text-[0.625rem] leading-none tabular-nums'>{sortIndex}</span>
      ) : null}
    </span>
  )
  return (
    // In a column narrowed below it, the label truncates, and shows whole in a tooltip.
    <CutTooltip
      render={
        <Button
          variant='ghost'
          size='xs'
          data-table-sort=''
          data-sorted={sorted ? '' : undefined}
          // Its sides' padding sits outside the column, so the label lines up with the cells.
          className={cn(
            'group/sort text-muted-foreground -mx-[calc(var(--control-padding)*0.8)] max-w-none data-sorted:text-foreground',
            // In a column narrowed below its label, the label truncates.
            'group-data-resizable/table:max-w-[calc(100%+var(--control-padding)*1.6)]',
          )}
          onClick={(event) => onSort({ shiftKey: event.shiftKey })}
        >
          {numeric ? arrow : null}
          {children}
          {/* `aria-sort` names only the column sorted first; a later one says its place itself. */}
          {sortIndex !== undefined && sortIndex > 1 && sorted ? (
            <span className='sr-only'>
              , sorted {sort}, {sortIndex} in the order
            </span>
          ) : null}
          {numeric ? null : arrow}
        </Button>
      }
    />
  )
}

/** `numeric` lines the column up at its end edge in figures of one width. */
function TableCell({
  className,
  numeric = false,
  sticky,
  ...props
}: ComponentProps<'td'> & {
  numeric?: boolean
  /** Keeps the cell in view at the table's start or end edge as the rest scrolls, with its head. */
  sticky?: 'start' | 'end'
}) {
  return (
    <td
      data-slot='table-cell'
      data-sticky={sticky}
      className={cn(
        cellClassName,
        numeric && 'text-end tabular-nums',
        sticky && stickyClassName[sticky],
        className,
      )}
      {...props}
    />
  )
}

function TableCaption({ className, children, ...props }: ComponentProps<'caption'>) {
  const id = useId()
  return (
    <caption
      id={id}
      data-slot='table-caption'
      className={cn(
        'bg-inherit transition-[translate] duration-(--motion-layout-duration) ease-(--motion-layout-easing) motion-reduce:transition-none data-[flow=start]:transition-none text-muted-foreground pt-(--surface-gap) text-start text-sm',
        className,
      )}
      {...props}
    >
      {/* Held to the box's visible width, so it wraps in view in a table that scrolls sideways. */}
      <div className='sticky start-0 max-w-[calc(var(--scroller-width,100%)-8px)] px-[calc(var(--surface-padding)-4px)]'>
        {children}
      </div>
    </caption>
  )
}

/**
 * A row across every column for what shows when the table has no rows,
 * such as an `Empty` with `show`: while that shows nothing, the row takes
 * no room and isn't read.
 */
function TableEmpty({
  className,
  colSpan,
  show,
  children,
  ...props
}: Omit<ComponentProps<'tr'>, 'children'> & {
  /** How many columns the table has. */
  colSpan: number
  /** Whether it shows: give its `Empty` the same. Hidden, the row isn't read as one. */
  show: boolean
  children: ComponentProps<'td'>['children']
}) {
  return (
    <tr
      data-slot='table-empty'
      aria-hidden={show ? undefined : true}
      className={className}
      {...props}
    >
      {/* What it holds waits for the rows it replaces to leave. */}
      <td colSpan={colSpan} className='p-0 [--empty-wait:1]'>
        {/* Held to the box's visible width, so it shows in the middle of what is in view. */}
        <div className='sticky start-0 flex w-[calc(var(--scroller-width,100%)-8px)] max-w-full'>
          {children}
        </div>
      </td>
    </tr>
  )
}

/**
 * The button that expands a row, to show its sub-rows or a `TableDetail`
 * under it: its chevron turns to point down while it is open. `depth`
 * indents it, for a sub-row; one that can't expand keeps its room, so the
 * text beside it lines up.
 */
function TableExpand({
  expanded,
  onExpandedChange,
  expandable = true,
  depth = 0,
  className,
  ...props
}: Omit<ComponentProps<'button'>, 'className' | 'onClick'> & {
  className?: string
  expanded: boolean
  onExpandedChange: (expanded: boolean) => void
  /** Whether the row has anything to show: one without keeps an empty space. */
  expandable?: boolean
  /** How deep the row is, from 0: each step indents it by `--table-indent`. */
  depth?: number
  /** Names the row it opens, such as “Show the items of KN-1090”. */
  'aria-label': string
}) {
  const indent = {
    marginInlineStart: `calc(var(--table-indent, 1.25rem) * ${depth})`,
  }
  if (!expandable) {
    return (
      <span
        aria-hidden
        data-table-expand=''
        style={indent}
        className={cn('inline-block size-(--control-height-xs) align-middle', className)}
      />
    )
  }
  return (
    <Button
      variant='ghost'
      size='icon-xs'
      data-table-expand=''
      aria-expanded={expanded}
      style={indent}
      className={cn('align-middle', className)}
      onClick={() => onExpandedChange(!expanded)}
      {...props}
    >
      <CollapsibleIndicator open={expanded} />
    </Button>
  )
}

/**
 * A row across every column under the row it belongs to, for what that row
 * opens: its items, a note, a form. It comes and goes as a row does, and the
 * rows below glide to make room.
 */
function TableDetail({
  className,
  colSpan,
  children,
  ...props
}: Omit<ComponentProps<'tr'>, 'children'> & {
  /** How many columns the table has. */
  colSpan: number
  children: ReactNode
}) {
  return (
    <tr
      data-slot='table-detail'
      className={cn(flowItemClassName, 'bg-inherit', className)}
      {...props}
    >
      <td colSpan={colSpan} className='p-0'>
        {/* Held to the box's visible width, so it stays in view in a table that scrolls sideways. */}
        <div className='sticky start-0 w-[calc(var(--scroller-width,100%)-8px)] max-w-full px-[calc(var(--surface-padding)-4px)] pb-(--surface-gap)'>
          {children}
        </div>
      </td>
    </tr>
  )
}

/** How wide each column's placeholder is, in turn, so the rows look like text of different lengths. */
const SKELETON_WIDTHS = ['w-24', 'w-32', 'w-16', 'w-20', 'w-28']

/**
 * Rows that stand in for the first rows while they load, in the body: when
 * the rows arrive they take the placeholders' place. Hidden from screen
 * readers, which hear that the table is busy.
 */
function TableSkeleton({
  columns,
  rows = 5,
  className,
}: {
  /**
   * How many columns the table has, or each column's cell class, for columns
   * that show only at some widths, so a placeholder hides with its column.
   */
  columns: number | readonly string[]
  /** How many rows stand in. */
  rows?: number
  className?: string
}) {
  const cells = typeof columns === 'number' ? Array<string>(columns).fill('') : columns
  return Array.from({ length: rows }, (_, row) => (
    <tr
      key={row}
      aria-hidden
      data-slot='table-skeleton'
      // When the rows arrive, the copies of these fade where they were, as a row that leaves does.
      className={cn(
        'data-leaving:opacity-0 data-leaving:[transition:opacity_var(--motion-exit-duration)_var(--motion-exit-easing)]',
        className,
      )}
    >
      {cells.map((cell, column) => (
        <td key={column} className={cn(cellClassName, cell)}>
          <SkeletonText
            className={SKELETON_WIDTHS[(row + column * 2) % SKELETON_WIDTHS.length]}
          />
        </td>
      ))}
    </tr>
  ))
}

export {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableDetail,
  TableEmpty,
  TableExpand,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
  TableSkeleton,
  clearOfPinned,
  resizedWidth,
}
