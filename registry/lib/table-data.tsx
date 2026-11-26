'use client'

import { announce } from '@/registry/lib/announce'
import { useControllable } from '@/registry/lib/controllable'
import { daysBetween, isISODate, useLocale } from '@/registry/lib/dates'
import { clampPage, pageCountOf, pageForSize, pageRange } from '@/registry/lib/pages'
import {
  columnFacetingFeature,
  columnFilteringFeature,
  columnSizingFeature,
  columnVisibilityFeature,
  createExpandedRowModel,
  createFacetedRowModel,
  createFacetedUniqueValues,
  constructFilterFn,
  createFilteredRowModel,
  createSortedRowModel,
  filterFn_includesString,
  globalFilteringFeature,
  rowExpandingFeature,
  rowSelectionFeature,
  rowSortingFeature,
  tableFeatures,
  type ExpandedState,
  type RowData,
  type RowSelectionState,
  type Updater,
  useTable,
} from '@tanstack/react-table'
import {
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

/*
 * The data behind a Table: what it sorts, searches, filters, pages, picks
 * and hides, in the browser or on a server. TanStack Table works it out, as
 * a function of state kept here, and the hook hands back plain values for
 * Kino's parts: nothing reads state through TanStack's own objects, which
 * stay the same while the state changes (the React Compiler would keep a
 * part that reads them as it was).
 */

/** What a column sorts, filters and searches by: text, a number, a `yyyy-mm-dd` date or a yes or no. */
export type TableValue = string | number | boolean | null | undefined

export type TableSortDirection = 'ascending' | 'descending'

export interface TableSortBy {
  column: string
  direction: TableSortDirection
}

/** Values from `from` to `to`, both included; numbers, or `yyyy-mm-dd` dates. Either end may be left open. */
export interface TableRange {
  from?: number | string
  to?: number | string
}

/** The values picked in an `options` filter, or the range of a `range` filter. */
export type TableFilter = readonly string[] | TableRange

/** Everything that decides which rows show and how: one object, for the URL, a saved view or a server. */
export interface TableView {
  sort: TableSortBy[]
  search: string
  /** By column id; columns all have to match, a column's picked values any one. */
  filters: Record<string, TableFilter>
  /** Counted from 1. */
  page: number
  /** Rows on a page; none for one page of every row. */
  pageSize?: number
  hiddenColumns: string[]
  /** Widths in px of the columns a person has resized, by column id. */
  columnWidths: Record<string, number>
}

export interface TableOption {
  value: string
  label: string
  /** How many rows have it, with the other filters and the search applied. */
  count?: number
}

export interface TableColumn<Row> {
  id: string
  /** Its header, and its name in a columns menu, a filter and what is read out. */
  label: string
  /** What it sorts, filters and searches by. */
  value?: (row: Row) => TableValue
  /** What its cells show: `value` by default. */
  cell?: (row: Row) => ReactNode
  sortable?: boolean
  /** Whether the search reads it: by default, when its values are text. */
  searchable?: boolean
  /** `options` picks among its values; `range` keeps the values between two. */
  filter?: 'options' | 'range'
  /** The values an `options` filter offers: the distinct values in the rows by default, or the server's, with its counts. */
  options?: readonly TableOption[]
  /** Lines it up at its end edge in figures of one width. */
  numeric?: boolean
  /** Its width and how its text wraps, given to its head and cells. */
  className?: string
  /** Whether a columns menu may hide it; true by default. */
  hideable?: boolean
  /** Whether a person may drag its edge to resize it. */
  resizable?: boolean
  /** Its width in px until it is resized; its laid-out width by default. */
  width?: number
  /** The narrowest a resize takes it, in px: 64 by default. */
  minWidth?: number
  /** The widest a resize takes it, in px: 800 by default. */
  maxWidth?: number
  /** What it writes in a CSV export: `value` by default. */
  csv?: (row: Row) => string | number | boolean | null | undefined
}

/** Every word the hook reads out, for a table in another language. */
export interface TableMessages {
  /** One column of a sort: “Amount, highest first”. */
  sortedBy: (label: string, direction: TableSortDirection, kind: TableValueKind) => string
  /** After a sort, its columns in order: “Sorted by Customer, A to Z, then Amount, highest first”. */
  sorted: (columns: string[]) => string
  /** After a page turn: “Page 2 of 5”. */
  page: (page: number, pageCount: number) => string
  /** After a filter changes or clears, how many rows match: “6 rows”. */
  matched: (count: number) => string
}

/** What kind of values a column holds, which decides the way it sorts first and the words for its order. */
export type TableValueKind = 'text' | 'number' | 'date' | 'boolean'

const ORDER_WORDS: Record<TableValueKind, Record<TableSortDirection, string>> = {
  text: { ascending: 'A to Z', descending: 'Z to A' },
  number: { ascending: 'lowest first', descending: 'highest first' },
  date: { ascending: 'oldest first', descending: 'newest first' },
  boolean: { ascending: 'no first', descending: 'yes first' },
}

const defaultMessages: TableMessages = {
  sortedBy: (label, direction, kind) => `${label}, ${ORDER_WORDS[kind][direction]}`,
  sorted: (columns) => `Sorted by ${columns.join(', then ')}`,
  page: (page, pageCount) => `Page ${page} of ${pageCount}`,
  matched: (count) => `${count} ${count === 1 ? 'row' : 'rows'}`,
}

/** How a `TableHead` sorts its column. */
export interface TableSortProps {
  sort: TableSortDirection | 'none'
  /** Its place in a sort by several columns, from 1; none when it sorts alone or not at all. */
  sortIndex?: number
  /** Shift adds the column to the sort. */
  onSort: (event: { shiftKey: boolean }) => void
}

/** How a `TableExpand` shows its row. */
export interface TableExpandProps {
  depth: number
  expandable: boolean
  expanded: boolean
  onExpandedChange: (expanded: boolean) => void
}

/** A resizable `TableHead`'s width, in px, and its change: undefined puts it back. */
export interface TableWidthProps {
  width: number | undefined
  minWidth: number
  maxWidth: number
  onWidthChange: (width: number | undefined) => void
}

/** The props of the `CheckboxGroup` around the table: this page's rows, merged into everything picked. */
export interface TableSelectionProps {
  value: string[]
  allValues: string[]
  onValueChange: (value: string[], details: { event?: Event }) => void
}

export interface UseTableDataOptions<Row> {
  rows: readonly Row[]
  /** The language its text sorts in. The visitor's own by default. */
  locale?: string
  /** Keep it the same between renders: a constant, or memoised. */
  columns: readonly TableColumn<Row>[]
  /** What tells one row from another, kept across pages, sorts and filters. */
  rowId: (row: Row) => string
  /** `rows` are already sorted, searched, filtered and paged, by a server. */
  manual?: boolean
  /** With `manual`: how many rows match on the server. */
  rowCount?: number

  view?: Partial<TableView>
  defaultView?: Partial<TableView>
  onViewChange?: (view: TableView) => void
  sort?: TableSortBy[]
  defaultSort?: TableSortBy[]
  onSortChange?: (sort: TableSortBy[]) => void
  search?: string
  defaultSearch?: string
  onSearchChange?: (search: string) => void
  filters?: Record<string, TableFilter>
  defaultFilters?: Record<string, TableFilter>
  onFiltersChange?: (filters: Record<string, TableFilter>) => void
  page?: number
  defaultPage?: number
  onPageChange?: (page: number) => void
  pageSize?: number
  defaultPageSize?: number
  onPageSizeChange?: (pageSize: number) => void
  hiddenColumns?: string[]
  defaultHiddenColumns?: string[]
  onHiddenColumnsChange?: (hidden: string[]) => void
  columnWidths?: Record<string, number>
  defaultColumnWidths?: Record<string, number>
  onColumnWidthsChange?: (widths: Record<string, number>) => void

  /** The ids of the rows picked. */
  selected?: string[]
  defaultSelected?: string[]
  onSelectedChange?: (selected: string[]) => void
  /** With `manual`: every row that matches is picked, beyond the ones loaded. It clears when the view changes. */
  allMatching?: boolean
  defaultAllMatching?: boolean
  onAllMatchingChange?: (allMatching: boolean) => void

  /** A row's own rows, shown under it, indented, once it is expanded. */
  subRows?: (row: Row) => readonly Row[] | undefined
  /** Without `subRows`: which rows open a detail row of their own; every row with `true`. */
  expandable?: boolean | ((row: Row) => boolean)
  /** The ids of the rows expanded. */
  expanded?: string[]
  defaultExpanded?: string[]
  onExpandedChange?: (expanded: string[]) => void

  /** How long the search waits after the last keystroke, in ms: 0 by default, 300 with `manual`. */
  searchWait?: number
  messages?: Partial<TableMessages>
}

const EMPTY: never[] = []
const EMPTY_FILTERS: Record<string, TableFilter> = {}
const EMPTY_WIDTHS: Record<string, number> = {}
const MIN_WIDTH = 64
const MAX_WIDTH = 800

const collators = new Map<string, Intl.Collator>()

/** How `locale` orders text as people read it (“Item 2” before “Item 10”), made once. */
function collatorFor(locale: string): Intl.Collator {
  let collator = collators.get(locale)
  if (!collator) {
    collator = new Intl.Collator(locale, { numeric: true, sensitivity: 'base' })
    collators.set(locale, collator)
  }
  return collator
}

/** A row as a sort reads it: its value in a column. */
interface SortedRow {
  getValue: (columnId: string) => unknown
}

/** The table's sort for `locale`: its rows by their values in a column, empty ones placed by `sortUndefined`. */
function sortFnFor(locale: string) {
  return (a: SortedRow, b: SortedRow, columnId: string) =>
    compareValues(
      a.getValue(columnId) as TableValue,
      b.getValue(columnId) as TableValue,
      locale,
    )
}

const features = tableFeatures({
  rowSortingFeature,
  globalFilteringFeature,
  columnFilteringFeature,
  columnFacetingFeature,
  rowSelectionFeature,
  columnVisibilityFeature,
  columnSizingFeature,
  rowExpandingFeature,
  sortedRowModel: createSortedRowModel(),
  expandedRowModel: createExpandedRowModel(),
  filteredRowModel: createFilteredRowModel(),
  facetedRowModel: createFacetedRowModel(),
  facetedUniqueValues: createFacetedUniqueValues(),
  filterFns: {
    includesString: filterFn_includesString,
    options: constructFilterFn({
      filter: (value: unknown, picked: unknown) =>
        Array.isArray(picked) && matchesOptions(value as TableValue, picked as string[]),
    }),
    range: constructFilterFn({
      filter: (value: unknown, range: unknown) =>
        inRange(value as TableValue, range as TableRange),
    }),
  },
})

/** An empty value, which sorts last either way and matches no filter. */
function isEmpty(value: TableValue): value is null | undefined | '' {
  return value === null || value === undefined || value === ''
}

/** What kind of values these are, from the first one that isn't empty. */
function kindOf(values: Iterable<TableValue>): TableValueKind {
  for (const value of values) {
    if (isEmpty(value)) continue
    if (typeof value === 'number') return 'number'
    if (typeof value === 'boolean') return 'boolean'
    return isISODate(value) ? 'date' : 'text'
  }
  return 'text'
}

/** Two values in order: numbers by size, dates by day, text as people read it in `locale` (“Item 2” before “Item 10”), no before yes. */
function compareValues(a: TableValue, b: TableValue, locale = 'en-US'): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b
  if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b)
  if (isISODate(a) && isISODate(b)) return -daysBetween(a, b)
  return collatorFor(locale).compare(String(a ?? ''), String(b ?? ''))
}

/**
 * Rows as CSV: a header line of `labels`, then a line per row, each field
 * quoted where it holds a comma, a quote or a line break. A text field that
 * starts with `=`, `+`, `-`, `@` or a tab is kept as text with a leading `'`,
 * so a spreadsheet never runs it as a formula.
 */
function csvOf(
  labels: readonly string[],
  rows: readonly (readonly (string | number | boolean | null | undefined)[])[],
): string {
  const field = (value: string | number | boolean | null | undefined) => {
    if (value === null || value === undefined) return ''
    let text = String(value)
    if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`
    return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
  }
  return [labels, ...rows].map((line) => line.map(field).join(',')).join('\r\n')
}

/** Whether a value is one of the picked ones; none picked matches every row. */
function matchesOptions(value: TableValue, picked: readonly string[]): boolean {
  if (picked.length === 0) return true
  return !isEmpty(value) && picked.includes(String(value))
}

/** Whether a value lies in a range, both ends included; an open end lets everything past it in. */
function inRange(value: TableValue, { from, to }: TableRange): boolean {
  const open = (end: unknown) => end === undefined || end === null || end === ''
  if (open(from) && open(to)) return true
  if (isEmpty(value) || typeof value === 'boolean') return false
  if (!open(from) && compareValues(value, from as TableValue) < 0) return false
  return open(to) || compareValues(value, to as TableValue) <= 0
}

/** Whether a filter lets every row through, so it can be left out. */
function isOpenFilter(filter: TableFilter | undefined): boolean {
  if (filter === undefined) return true
  if (isPicked(filter)) return filter.length === 0
  const open = (end: unknown) => end === undefined || end === null || end === ''
  return open(filter.from) && open(filter.to)
}

function isPicked(filter: TableFilter): filter is readonly string[] {
  return Array.isArray(filter)
}

/** The filters with the open ones left out, so an empty filter never counts as one. */
function activeFilters(
  filters: Record<string, TableFilter>,
): Record<string, TableFilter> {
  const active: Record<string, TableFilter> = {}
  for (const [column, filter] of Object.entries(filters)) {
    if (!isOpenFilter(filter)) active[column] = filter
  }
  return active
}

/** The items on `page`, counted from 1; all of them when nothing pages them. */
function pageSlice<T>(
  items: readonly T[],
  page: number,
  pageSize: number | undefined,
): T[] {
  if (!pageSize || pageSize <= 0) return [...items]
  return items.slice((page - 1) * pageSize, page * pageSize)
}

/** Everything picked once this page's boxes say `pageValue`: the page's own picks replaced, the rest kept in order. */
function mergePageSelection(
  selected: readonly string[],
  pageIds: readonly string[],
  pageValue: readonly string[],
): string[] {
  const onPage = new Set(pageIds)
  const kept = selected.filter((id) => !onPage.has(id))
  const picked = new Set(pageValue)
  return [...kept, ...pageIds.filter((id) => picked.has(id))]
}

/** A sort with each column once and a known column, so a stale view never breaks the table. */
function cleanSort(
  sort: readonly TableSortBy[],
  known: ReadonlySet<string>,
): TableSortBy[] {
  const seen = new Set<string>()
  return sort.filter(({ column }) => {
    if (!known.has(column) || seen.has(column)) return false
    seen.add(column)
    return true
  })
}

/** Hidden columns that leave at least one shown. */
function cleanHidden(hidden: readonly string[], columns: readonly string[]): string[] {
  const kept = hidden.filter((id) => columns.includes(id))
  return kept.length >= columns.length ? kept.slice(0, columns.length - 1) : kept
}

/** The view's slices that change which rows show, in a form that only changes when they do. */
function viewKey(view: TableView): string {
  return JSON.stringify([view.sort, view.search, view.filters, view.pageSize])
}

function useTableData<Row extends object>(options: UseTableDataOptions<Row>) {
  const {
    rows: data,
    columns,
    rowId,
    manual = false,
    rowCount: serverCount,
    searchWait = manual ? 300 : 0,
    subRows,
    expandable = false,
  } = options
  const locale = useLocale(options.locale)
  const messages = { ...defaultMessages, ...options.messages }
  const columnIds = useMemo(() => columns.map((column) => column.id), [columns])
  const known = useMemo(() => new Set(columnIds), [columnIds])

  // The view: the whole of it the caller's, each slice the caller's, or kept here.
  const initialView = (): TableView => {
    const from = options.defaultView ?? {}
    return {
      sort: options.defaultSort ?? from.sort ?? EMPTY,
      search: options.defaultSearch ?? from.search ?? '',
      filters: options.defaultFilters ?? from.filters ?? EMPTY_FILTERS,
      page: options.defaultPage ?? from.page ?? 1,
      pageSize: options.defaultPageSize ?? from.pageSize,
      hiddenColumns: options.defaultHiddenColumns ?? from.hiddenColumns ?? EMPTY,
      columnWidths: options.defaultColumnWidths ?? from.columnWidths ?? EMPTY_WIDTHS,
    }
  }
  const [ownView, setOwnView] = useState(initialView)
  const given = options.view
  const view: TableView = {
    sort: cleanSort(options.sort ?? given?.sort ?? ownView.sort, known),
    search: options.search ?? given?.search ?? ownView.search,
    filters: options.filters ?? given?.filters ?? ownView.filters,
    page: options.page ?? given?.page ?? ownView.page,
    pageSize:
      options.pageSize ??
      (given && 'pageSize' in given ? given.pageSize : ownView.pageSize),
    hiddenColumns: cleanHidden(
      options.hiddenColumns ?? given?.hiddenColumns ?? ownView.hiddenColumns,
      columnIds,
    ),
    columnWidths: options.columnWidths ?? given?.columnWidths ?? ownView.columnWidths,
  }

  const [expanded, setExpanded] = useControllable(
    options.expanded,
    options.defaultExpanded ?? EMPTY,
    options.onExpandedChange,
  )
  const [selected, setSelected] = useControllable(
    options.selected,
    options.defaultSelected ?? EMPTY,
    options.onSelectedChange,
  )
  const [allMatchingGiven, setAllMatchingFlag] = useControllable(
    options.allMatching,
    options.defaultAllMatching ?? false,
    options.onAllMatchingChange,
  )
  // Every row that matched is no longer every row that matches once the view
  // changes, from here or from the app: the flag holds for the view it was set in.
  const [allMatchingFor, setAllMatchingFor] = useState<string | null>(null)
  const allMatchingFlag =
    allMatchingGiven && (allMatchingFor === null || allMatchingFor === viewKey(view))
  useEffect(() => {
    if (allMatchingGiven && !allMatchingFlag) setAllMatchingFlag(false)
  })

  // A change made since the last render, so a second one in the same event, such as a pager's
  // new page after its new page size, builds on it rather than on the view this render saw.
  const changedRef = useRef<TableView | null>(null)
  useLayoutEffect(() => {
    changedRef.current = null
  })

  /** One change to the view, told once to each listener, so a server fetches once. */
  const changeView = (patch: Partial<TableView>) => {
    const was = changedRef.current ?? view
    const next: TableView = { ...was, ...patch }
    changedRef.current = next
    // The caller's slices win where given; the rest are kept here.
    setOwnView(next)
    const told: [keyof TableView, ((value: never) => void) | undefined][] = [
      ['sort', options.onSortChange],
      ['search', options.onSearchChange],
      ['filters', options.onFiltersChange],
      ['page', options.onPageChange],
      ['pageSize', options.onPageSizeChange],
      ['hiddenColumns', options.onHiddenColumnsChange],
      ['columnWidths', options.onColumnWidthsChange],
    ]
    for (const [key, onChange] of told) {
      if (key in patch && !Object.is(patch[key], was[key])) onChange?.(next[key] as never)
    }
    options.onViewChange?.(next)
    // Every row that matched is no longer every row that matches.
    if (allMatchingFlag && viewKey(next) !== viewKey(was)) setAllMatchingFlag(false)
  }

  // The search the field shows, ahead of the one the rows follow while it waits.
  const [draft, setDraft] = useState({ text: view.search, from: view.search })
  if (draft.from !== view.search) setDraft({ text: view.search, from: view.search })
  const pendingSearch = useRef<ReturnType<typeof setTimeout>>(undefined)
  const changeViewRef = useRef(changeView)
  useEffect(() => {
    changeViewRef.current = changeView
  })
  useEffect(() => () => clearTimeout(pendingSearch.current), [])

  const filters = activeFilters(view.filters)

  // What kind of values each column holds, from the first rows: one string,
  // so the columns are rebuilt only when a kind changes, not with every row.
  const kindList = columns
    .map((column) => {
      const value = column.value
      return value ? kindOf(data.slice(0, 20).map((row) => value(row))) : 'text'
    })
    .join(' ')
  const columnDefs = useMemo(() => {
    const listed = kindList.split(' ') as TableValueKind[]
    const kinds = new Map(
      columns.map((column, index) => [column.id, listed[index] ?? 'text']),
    )
    return {
      kinds,
      defs: columns.map((column) => {
        const kind = kinds.get(column.id) ?? 'text'
        const value = column.value
        return {
          id: column.id,
          header: column.label,
          // Empty values are undefined to the table, so they sort last either way.
          accessorFn: value
            ? (row: Row) => {
                const got = value(row)
                return isEmpty(got) ? undefined : got
              }
            : () => undefined,
          enableSorting: Boolean(column.sortable && value),
          sortFn: sortFnFor(locale),
          sortUndefined: 'last' as const,
          // Numbers, dates and yes or no start from the top; text starts at A.
          sortDescFirst: kind !== 'text',
          enableGlobalFilter: column.searchable ?? kind === 'text',
          enableColumnFilter: Boolean(column.filter),
          filterFn: column.filter === 'range' ? ('range' as const) : ('options' as const),
          enableHiding: column.hideable ?? true,
          size: column.width,
          minSize: column.minWidth ?? MIN_WIDTH,
          maxSize: column.maxWidth ?? MAX_WIDTH,
        }
      }),
    }
  }, [columns, kindList, locale])

  const pageSize = view.pageSize && view.pageSize > 0 ? view.pageSize : undefined
  const table = useTable({
    features,
    data: data as unknown as RowData[],
    columns: columnDefs.defs,
    getRowId: (row: RowData) => rowId(row as Row),
    manualSorting: manual,
    manualFiltering: manual,
    // Rows that change never close the ones open; ids whose rows are gone simply match none.
    autoResetExpanded: false,
    getSubRows: subRows
      ? (row: RowData) => subRows(row as Row) as RowData[] | undefined
      : undefined,
    getRowCanExpand: subRows
      ? undefined
      : (row: { original: RowData }) =>
          typeof expandable === 'function'
            ? expandable(row.original as Row)
            : Boolean(expandable),
    // A page counts the rows it shows, sub-rows too, and a sub-row that
    // matches keeps its parent.
    filterFromLeafRows: Boolean(subRows),
    enableSortingRemoval: false,
    enableMultiRemove: false,
    isMultiSortEvent: (event: unknown) =>
      Boolean((event as { shiftKey?: boolean })?.shiftKey),
    isRowRangeSelectionEvent: (event: unknown) =>
      Boolean((event as { shiftKey?: boolean })?.shiftKey),
    getColumnCanGlobalFilter: () => true,
    globalFilterFn: 'includesString',
    state: {
      sorting: view.sort.map(({ column, direction }) => ({
        id: column,
        desc: direction === 'descending',
      })),
      globalFilter: view.search,
      columnFilters: Object.entries(filters).map(([id, value]) => ({ id, value })),
      rowSelection: Object.fromEntries(selected.map((id) => [id, true as const])),
      columnVisibility: Object.fromEntries(view.hiddenColumns.map((id) => [id, false])),
      expanded: Object.fromEntries(expanded.map((id) => [id, true])) as ExpandedState,
      columnSizing: view.columnWidths,
    },
    onSortingChange: (updater: Updater<{ id: string; desc: boolean }[]>) => {
      const sorting = resolve(
        updater,
        view.sort.map(({ column, direction }) => ({
          id: column,
          desc: direction === 'descending',
        })),
      )
      setSort(
        sorting.map(({ id, desc }) => ({
          column: id,
          direction: desc ? 'descending' : 'ascending',
        })),
      )
    },
    onExpandedChange: (updater: Updater<ExpandedState>) => {
      const now = Object.fromEntries(expanded.map((id) => [id, true]))
      const next = resolve<ExpandedState>(updater, now)
      // `true` is TanStack's word for every row: the ids of every row that can expand.
      setExpanded(
        next === true
          ? table
              .getCoreRowModel()
              .flatRows.filter((row) => row.getCanExpand())
              .map((row) => row.id)
          : Object.keys(next).filter((id) => next[id]),
      )
    },
    onRowSelectionChange: (updater: Updater<RowSelectionState>) => {
      const next = resolve<RowSelectionState>(
        updater,
        Object.fromEntries(selected.map((id) => [id, true as const])),
      )
      setSelected(Object.keys(next).filter((id) => next[id]))
    },
  })

  // What shows: in the browser, worked out here; from a server, as given.
  // Sorted, searched and filtered by TanStack; a page is a slice of what matches.
  // A page holds whole rows: each one's sub-rows, once it is expanded, follow it there.
  const topRows = table.getPreExpandedRowModel().rows
  const matchingRows = table.getPreExpandedRowModel().flatRows
  const rowCount = manual ? (serverCount ?? data.length) : topRows.length
  const pageCount = pageCountOf(rowCount, pageSize)
  const page = clampPage(view.page, pageCount)
  // While the search or a filter narrows the rows, a row whose sub-rows match opens to show them.
  const narrowed = view.search !== '' || Object.keys(filters).length > 0
  // Rows a person closed while this search held them open stay closed until the search changes.
  const narrowKey = narrowed ? JSON.stringify([view.search, filters]) : ''
  const [closed, setClosed] = useState<{ key: string; ids: readonly string[] }>({
    key: '',
    ids: EMPTY,
  })
  const closedIds = closed.key === narrowKey ? closed.ids : EMPTY
  const opened = (row: {
    id: string
    getIsExpanded: () => boolean
    subRows: readonly unknown[]
  }) =>
    row.getIsExpanded() ||
    (narrowed &&
      Boolean(subRows) &&
      row.subRows.length > 0 &&
      !closedIds.includes(row.id))
  const pageRows = withExpanded(
    manual ? topRows : pageSlice(topRows, page, pageSize),
    opened,
  )
  const rows = pageRows.map((row) => row.original as Row)
  const rowIds = pageRows.map((row) => row.id)
  const allIds = manual ? rowIds : table.getCoreRowModel().flatRows.map((row) => row.id)
  // Every row that matches, counted as `rowCount` counts them: top-level rows.
  const matchingIds = manual ? rowIds : topRows.map((row) => row.id)

  // In the browser, a pick whose row has gone isn't one.
  const knownIds = new Set(allIds)
  const picked = manual ? selected : selected.filter((id) => knownIds.has(id))
  const pickedSet = new Set(picked)
  const matchingSet = new Set(matchingRows.map((row) => row.id))
  const allMatching = manual
    ? allMatchingFlag
    : matchingIds.length > 0 && matchingIds.every((id) => pickedSet.has(id))
  const isSelected = (id: string) => (manual && allMatchingFlag) || pickedSet.has(id)
  const pageSelected = rowIds.length > 0 && rowIds.every(isSelected)

  const rowsById = new Map(pageRows.map((row) => [row.id, row]))
  const shownColumns = columns.filter((column) => !view.hiddenColumns.includes(column.id))
  const sortIndex = new Map(view.sort.map(({ column }, index) => [column, index]))

  const setSort = (sort: TableSortBy[]) => {
    const next = cleanSort(sort, known)
    changeView({ sort: next })
    const said = next.flatMap(({ column: id, direction }) => {
      const column = columns.find((each) => each.id === id)
      return column
        ? [messages.sortedBy(column.label, direction, columnDefs.kinds.get(id) ?? 'text')]
        : []
    })
    if (said.length > 0) announce(messages.sorted(said))
  }

  // After a filter changes or clears, how many rows match is read out once
  // they are shown: at once in the browser, once the next rows arrive from a
  // server. The Search field reads out its own count while it holds text.
  const [counting, setCounting] = useState<{ from: readonly Row[] } | null>(null)
  if (counting !== null && (!manual || counting.from !== data)) {
    setCounting(null)
    announce(messages.matched(rowCount))
  }

  const sortProps = (id: string): TableSortProps => {
    const at = sortIndex.get(id)
    const by = at === undefined ? undefined : view.sort[at]
    return {
      sort: by?.direction ?? 'none',
      sortIndex: at !== undefined && view.sort.length > 1 ? at + 1 : undefined,
      // TanStack's own toggle: the first press per kind of value, then a flip; Shift adds the column.
      onSort: (event) => table.getColumn(id)?.getToggleSortingHandler()?.(event),
    }
  }

  const setSearch = (search: string) => {
    setDraft({ text: search, from: view.search })
    clearTimeout(pendingSearch.current)
    if (searchWait <= 0) {
      changeView({ search, page: 1 })
      return
    }
    pendingSearch.current = setTimeout(
      () => changeViewRef.current({ search, page: 1 }),
      searchWait,
    )
  }

  const setFilter = (column: string, filter: TableFilter | undefined) => {
    const next = { ...view.filters }
    if (filter === undefined || isOpenFilter(filter)) delete next[column]
    else next[column] = filter
    changeView({ filters: next, page: 1 })
    setCounting({ from: data })
  }

  const setPage = (next: number) => {
    // Against the pages there are at the size this event already set, if it set one.
    const sized = changedRef.current?.pageSize
    const count = sized ? pageCountOf(rowCount, sized) : pageCount
    const to = clampPage(next, count)
    // Already there, also when a change earlier in the same event moved it, as a new page size does.
    if (to === (changedRef.current?.page ?? page)) return
    changeView({ page: to })
    announce(messages.page(to, count))
  }

  const facets = (id: string): TableOption[] => {
    const column = columns.find((each) => each.id === id)
    if (!column) return []
    if (manual) return [...(column.options ?? [])]
    const counts =
      table.getColumn(id)?.getFacetedUniqueValues() ?? new Map<unknown, number>()
    const byValue = new Map<string, number>()
    for (const [value, count] of counts) {
      if (isEmpty(value as TableValue)) continue
      const key = String(value)
      byValue.set(key, (byValue.get(key) ?? 0) + count)
    }
    if (column.options) {
      return column.options.map((option) => ({
        ...option,
        count: byValue.get(option.value) ?? 0,
      }))
    }
    return [...byValue.keys()]
      .sort((a, b) => collatorFor(locale).compare(a, b))
      .map((value) => ({ value, label: value, count: byValue.get(value) ?? 0 }))
  }

  const selection: TableSelectionProps = {
    value: rowIds.filter(isSelected),
    allValues: rowIds,
    onValueChange: (value, details) => {
      const now = rowIds.filter(isSelected)
      const added = value.filter((id) => !now.includes(id))
      const removed = now.filter((id) => !value.includes(id))
      const changed = [...added, ...removed]
      // Every row was picked through the flag: picking from here starts from the loaded rows.
      const base = manual && allMatchingFlag ? rowIds : picked
      if (manual && allMatchingFlag) setAllMatchingFlag(false)
      const shift = Boolean((details.event as MouseEvent | undefined)?.shiftKey)
      const only = changed.length === 1 ? changed[0] : undefined
      const row = only === undefined ? undefined : table.getRow(only, true)
      if (row && !(manual && allMatchingFlag)) {
        // One box: TanStack's own toggle, which picks a range from the last one on Shift.
        row.getToggleSelectedHandler()({
          target: { checked: added.length === 1 },
          shiftKey: shift,
        })
        return
      }
      setSelected(mergePageSelection(base, rowIds, value))
    },
  }

  const setHiddenColumns = (hidden: string[]) =>
    changeView({ hiddenColumns: cleanHidden(hidden, columnIds) })

  return {
    /** This page's rows, in order. */
    rows,
    rowIds,
    rowId,
    /** How many rows match the search and filters. */
    rowCount,
    /** The columns shown, in order. */
    columns: shownColumns,
    allColumns: columns,
    hiddenColumns: view.hiddenColumns,
    setHiddenColumns,
    /** Whether a columns menu may hide this column: never the last one shown. */
    canHide: (id: string) =>
      (columns.find((column) => column.id === id)?.hideable ?? true) &&
      (view.hiddenColumns.includes(id) || shownColumns.length > 1),
    cell: (row: Row, column: TableColumn<Row>): ReactNode =>
      column.cell ? column.cell(row) : String(column.value?.(row) ?? ''),

    sort: view.sort,
    setSort,
    sortProps,

    /** What the search field shows, which runs ahead of the rows while the search waits. */
    search: draft.text,
    setSearch,
    filters,
    setFilter,
    facets,
    /** Whether the search or a filter leaves rows out. */
    filtered: view.search !== '' || Object.keys(filters).length > 0,
    /** Clears the search and every filter. */
    reset: () => {
      clearTimeout(pendingSearch.current)
      setDraft({ text: '', from: view.search })
      changeView({ search: '', filters: {}, page: 1 })
      setCounting({ from: data })
    },

    page,
    pageCount,
    setPage,
    pageSize,
    /** A new size keeps the first row the page showed. */
    setPageSize: (size: number) =>
      changeView({
        pageSize: size,
        page: pageForSize(page, pageSize ?? rowCount, size),
      }),
    /** “11–20 of 42”. */
    range: pageRange(page, pageSize, rowCount),
    /**
     * Give it to `TableBody` as its `key`: when most rows shown change at
     * once, as a page turns, they swap in place; when most stay, they glide.
     */
    bodyKey: useBodyKey(rowIds),

    selected: manual && allMatchingFlag ? rowIds : picked,
    /** How many rows are picked, counting every match when they all are. */
    selectedCount: manual && allMatchingFlag ? rowCount : picked.length,
    /**
     * How many picked rows the search and filters leave out, in the
     * browser; on a server, which can't tell, undefined.
     */
    selectedHidden: manual
      ? undefined
      : picked.filter((id) => !matchingSet.has(id)).length,
    setSelected: (ids: string[]) => {
      if (manual && allMatchingFlag) setAllMatchingFlag(false)
      setSelected(ids)
    },
    isSelected,
    selection,
    /** Whether every row on this page is picked. */
    pageSelected,
    /** Whether every row that matches is picked, beyond this page. */
    allMatching,
    /** Picks every row that matches: their ids in the browser, the `allMatching` flag on a server. */
    selectAllMatching: () => {
      if (manual) {
        setAllMatchingFor(viewKey(view))
        setAllMatchingFlag(true)
      } else setSelected([...new Set([...picked, ...matchingIds])])
    },
    clearSelection: () => {
      if (allMatchingFlag) setAllMatchingFlag(false)
      setSelected([])
    },

    /** How a row's expand button shows it: its depth, whether it can expand, and whether it is. */
    expandProps: (id: string): TableExpandProps => {
      const row = rowsById.get(id)
      return {
        depth: row?.depth ?? 0,
        expandable: row?.getCanExpand() ?? false,
        expanded: row !== undefined && opened(row),
        onExpandedChange: (open: boolean) => {
          setExpanded(
            open
              ? [...expanded.filter((each) => each !== id), id]
              : expanded.filter((each) => each !== id),
          )
          // Closing one a search opened keeps it closed for this search; opening it again undoes that.
          if (narrowed) {
            setClosed({
              key: narrowKey,
              ids: open ? closedIds.filter((each) => each !== id) : [...closedIds, id],
            })
          }
        },
      }
    },
    isExpanded: (id: string) => {
      const row = rowsById.get(id)
      return row !== undefined && opened(row)
    },
    /** The row a sub-row sits under, for a screen reader to hear what it belongs to. */
    parentOf: (id: string): Row | undefined =>
      rowsById.get(id)?.getParentRow()?.original as Row | undefined,
    expanded,
    setExpanded,

    /** A resizable column's width and its change, for its `TableHead`; nothing for one that isn't. */
    widthProps: (id: string): TableWidthProps | Record<string, never> => {
      const column = columns.find((each) => each.id === id)
      if (!column?.resizable) return {}
      const sized =
        id in view.columnWidths ? table.getColumn(id)?.getSize() : column.width
      return {
        width: sized,
        minWidth: column.minWidth ?? MIN_WIDTH,
        maxWidth: column.maxWidth ?? MAX_WIDTH,
        onWidthChange: (width: number | undefined) => {
          const next = { ...view.columnWidths }
          // The head has held it between its bounds already.
          if (width === undefined) delete next[id]
          else next[id] = width
          changeView({ columnWidths: next })
        },
      }
    },
    columnWidths: view.columnWidths,

    /**
     * The rows as CSV, in their order, with the shown columns: every row that
     * matches (on a server, the rows loaded), the picked ones, or this page's.
     */
    toCsv: ({
      rows: which = 'matching',
    }: { rows?: 'matching' | 'selected' | 'page' } = {}) => {
      const source =
        which === 'page'
          ? pageRows
          : which === 'selected'
            ? // In the table's order, then the picked rows the search and filters leave out.
              [
                ...matchingRows.filter((row) => isSelected(row.id)),
                ...table
                  .getCoreRowModel()
                  .flatRows.filter(
                    (row) => isSelected(row.id) && !matchingSet.has(row.id),
                  ),
              ]
            : matchingRows
      return csvOf(
        shownColumns.map((column) => column.label),
        source.map((row) =>
          shownColumns.map((column) => {
            const original = row.original as Row
            return column.csv ? column.csv(original) : column.value?.(original)
          }),
        ),
      )
    },

    view: { ...view, page },
  }
}

/**
 * Whether going from the rows shown to the next ones swaps them rather than
 * moving them: when fewer than half stay, as on a page turn or a sort across
 * pages, the rows that leave and the rows that come would fade over each
 * other in the same places.
 */
function swapsRows(from: readonly string[], to: readonly string[]): boolean {
  if (from.length === 0 || to.length === 0) return false
  const kept = new Set(from)
  const shared = to.filter((id) => kept.has(id)).length
  // Against the shorter list, so opening a row's many sub-rows, which keeps every row there was, moves.
  return shared * 2 < Math.min(from.length, to.length)
}

/** A key that changes each time the rows shown swap rather than move. */
function useBodyKey(rowIds: readonly string[]): number {
  const [seen, setSeen] = useState({ ids: rowIds, key: 0 })
  if (seen.ids.join('\u0000') === rowIds.join('\u0000')) return seen.key
  const key = swapsRows(seen.ids, rowIds) ? seen.key + 1 : seen.key
  setSeen({ ids: rowIds, key })
  return key
}

/** Rows with the sub-rows of each expanded one after it, at every depth. */
function withExpanded<T extends { subRows: readonly T[] }>(
  rows: readonly T[],
  open: (row: T) => boolean,
): T[] {
  return rows.flatMap((row) =>
    open(row) && row.subRows.length > 0
      ? [row, ...withExpanded(row.subRows, open)]
      : [row],
  )
}

function resolve<T>(updater: Updater<T>, current: T): T {
  return typeof updater === 'function' ? (updater as (old: T) => T)(current) : updater
}

export type TableData<Row extends object> = ReturnType<typeof useTableData<Row>>

export {
  cleanHidden,
  cleanSort,
  compareValues,
  inRange,
  kindOf,
  matchesOptions,
  mergePageSelection,
  csvOf,
  pageSlice,
  swapsRows,
  useTableData,
}
