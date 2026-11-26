'use client'

import { IconPlaceholder } from '@/registry/icons/icon-placeholder'
import { travelTrend } from '@/registry/lib/calendar-model'
import type { Weekday } from '@/registry/lib/dates'
import { Swap } from '@/registry/lib/swap'
import { isRTL } from '@ui-sdk/core'
import { Component, createContext, type ReactNode, use, useEffect, useState } from 'react'

import { cn } from '@/lib/utils'

/*
 * How the Calendar looks around ui-sdk's parts, wherever they sit: in the
 * Calendar or in the Date picker's popup. The look is the Tabs' and the Date
 * input's: a backdrop glides under the pointer, a pill in the primary colour
 * slides to the picked day, and a range is a band from its start to its end
 * that grows and shrinks along each week. The arrows turn the months, which
 * slide a short way the way they travel.
 */

/** What the Calendar's own words say, in English unless a buyer passes their own. */
interface CalendarLabels {
  previousMonth: string
  nextMonth: string
  /** The button on a month's name, which opens its months: "November 2026, choose a month". */
  chooseMonth: (month: string) => string
  /** The button on a year's name, which opens its years: "2026, choose a year". */
  chooseYear: (year: string) => string
  months: string
  years: string
  /** The column of week numbers. */
  weekNumbers: string
  previousYear: string
  nextYear: string
  previousYears: string
  nextYears: string
  /** A week's number, as a screen reader hears it: "Week 46". */
  week: (week: number) => string
}

const CALENDAR_LABELS: CalendarLabels = {
  previousMonth: 'Previous month',
  nextMonth: 'Next month',
  chooseMonth: (month) => `${month}, choose a month`,
  chooseYear: (year) => `${year}, choose a year`,
  months: 'Choose a month',
  years: 'Choose a year',
  weekNumbers: 'Week',
  previousYear: 'Previous year',
  nextYear: 'Next year',
  previousYears: 'Previous years',
  nextYears: 'Next years',
  week: (week) => `Week ${week}`,
}

/** What a day shows under its full date, which a screen reader hears first: its number, or the buyer's own content for it. */
type DayContent = (date: string) => ReactNode

/** What the parts around ui-sdk's need to know, from the Calendar or the Date picker. */
interface CalendarLook {
  mode: 'single' | 'multiple' | 'range'
  disabled: boolean
  locale: string
  labels: CalendarLabels
  weekStartsOn: Weekday
  months: number
  showWeekNumbers: boolean
  dayContent?: DayContent
  /** How a month's name is written in its heading. */
  monthFormat: 'long' | 'short' | 'narrow'
  /** Days several picks have no room left for, which fade rather than strike through. */
  full: ((date: string) => boolean) | null
  /** The first and last days that can be picked, as `yyyy-mm-dd`. */
  bounds: { min?: string; max?: string }
  /** Today, as `yyyy-mm-dd`; null while the server renders. */
  today: string | null
  /** Shows `month` (`yyyy-mm`) first, as a pick in a heading's popover does. */
  showMonth: (month: string) => void
}

const CalendarLookContext = createContext<CalendarLook | null>(null)

function useCalendarLook(): CalendarLook {
  const look = use(CalendarLookContext)
  if (!look)
    throw new Error('Calendar parts must be used inside <Calendar> or <DatePicker>.')
  return look
}

const DAY = '[data-slot=calendar-day]'

/**
 * Seven columns, each as wide as a control is tall, so a day is square and,
 * in the Round shape, a circle. In a narrower column they shrink together.
 */
const weekLayout =
  'relative grid w-full grid-cols-[repeat(7,minmax(0,var(--control-height)))] group-data-week-numbers/calendar:grid-cols-[var(--calendar-week-width)_repeat(7,minmax(0,var(--control-height)))]'

/** A week's number, in the column before its days. */
const weekNumberClassName =
  'flex items-center justify-center text-xs text-muted-foreground tabular-nums'

/** A day's box, shared by the day and the pill's copy of it, so each label sits on its twin. Each sits 1px in from its column, so days stand 2px apart across and down alike. */
const dayLayout =
  'relative m-px flex aspect-square min-w-0 items-center justify-center rounded-(--control-radius) text-sm tabular-nums select-none data-today:font-semibold'

/**
 * A day's colours. Days of the months either side are quieter, an
 * unavailable day is struck through, one several picks have no room for and
 * one that can't be picked fade. A range's ends and the days of a multiple
 * pick fill with the primary colour; in single mode the pill does that, and
 * draws the pick itself until the page hydrates.
 */
const dayClassName = cn(
  dayLayout,
  'text-foreground transition-[color,background-color,box-shadow] duration-(--motion-press-duration) ease-(--motion-press-fade-easing) focus-visible:z-10 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-hidden',
  'data-outside:text-muted-foreground data-unavailable:text-muted-foreground data-unavailable:line-through data-full:no-underline data-full:text-foreground/30 [&[data-disabled]]:text-foreground/30 data-outside:[&[data-disabled]]:text-foreground/30',
  // Over the backdrop or inside a range, a quiet day darkens so it still reads at 4.5:1.
  'data-outside:not-data-disabled:data-glided:text-foreground/70 data-outside:not-data-disabled:data-range-middle:text-foreground/70',
  'group-data-[mode=multiple]/calendar:data-[selected]:bg-primary group-data-[mode=multiple]/calendar:data-[selected]:text-primary-foreground',
  'data-range-start:bg-primary data-range-start:text-primary-foreground data-range-end:bg-primary data-range-end:text-primary-foreground',
  // A pick that can't be taken again (a range's start, when no stay that short is allowed) keeps its pick's colours.
  'data-range-start:[&[data-disabled]]:text-primary-foreground data-range-end:[&[data-disabled]]:text-primary-foreground group-data-[mode=multiple]/calendar:data-[selected]:[&[data-disabled]]:text-primary-foreground forced-colors:data-range-start:[&[data-disabled]]:text-[HighlightText] forced-colors:data-range-end:[&[data-disabled]]:text-[HighlightText] forced-colors:group-data-[mode=multiple]/calendar:data-[selected]:[&[data-disabled]]:text-[HighlightText]',
  '[[data-calendar-month]:not([data-mounted])_&]:data-[selected]:not-data-outside:bg-primary [[data-calendar-month]:not([data-mounted])_&]:data-[selected]:not-data-outside:text-primary-foreground',
  'forced-colors:data-range-start:forced-color-adjust-none forced-colors:data-range-end:forced-color-adjust-none forced-colors:group-data-[mode=multiple]/calendar:data-[selected]:forced-color-adjust-none forced-colors:data-range-start:bg-[Highlight] forced-colors:data-range-start:text-[HighlightText] forced-colors:data-range-end:bg-[Highlight] forced-colors:data-range-end:text-[HighlightText] forced-colors:group-data-[mode=multiple]/calendar:data-[selected]:bg-[Highlight] forced-colors:group-data-[mode=multiple]/calendar:data-[selected]:text-[HighlightText] forced-colors:data-range-middle:outline-1 forced-colors:data-range-middle:-outline-offset-4 forced-colors:data-range-middle:outline-dashed',
  // Those picks keep their own colours, so their focus outline needs a system colour; a range's middle trades its dashes for the outline.
  'forced-colors:data-range-start:focus-visible:outline-[CanvasText] forced-colors:data-range-end:focus-visible:outline-[CanvasText] forced-colors:group-data-[mode=multiple]/calendar:data-[selected]:focus-visible:outline-[CanvasText] forced-colors:data-range-middle:focus-visible:outline-2 forced-colors:data-range-middle:focus-visible:outline-offset-0 forced-colors:data-range-middle:focus-visible:outline-solid',
)

/**
 * The band behind a week's days in a range, from the first column the range
 * covers in that week to the last. It is as large as the week and clipped to
 * those columns, so it grows and shrinks on `layout` as the end moves; a
 * week the range leaves closes towards the side the range comes from. A
 * month that has just come in draws its bands in place, with no move.
 */
const bandClassName =
  'pointer-events-none absolute inset-y-0 start-0 end-0 -z-10 group-data-week-numbers/calendar:start-(--calendar-week-width) rounded-(--control-radius) bg-primary/12 transition-none [--band-from:0] [--band-to:0] [clip-path:inset(1px_calc((7-var(--band-to))/7*100%+1px)_1px_calc(var(--band-from)/7*100%+1px)_round_var(--control-radius-capped))] rtl:[clip-path:inset(1px_calc(var(--band-from)/7*100%+1px)_1px_calc((7-var(--band-to))/7*100%+1px)_round_var(--control-radius-capped))] duration-(--motion-layout-duration) ease-(--motion-layout-easing) data-empty:opacity-0 data-empty:duration-(--motion-exit-duration) data-preview:bg-primary/8 [[data-calendar-month][data-mounted]_&]:transition-[opacity,clip-path] motion-reduce:[[data-calendar-month][data-mounted]_&]:transition-[opacity]'

/** A day as its week's band reads it. */
interface BandCell {
  /** An empty cell: an outside day that's hidden, or one another month beside shows. */
  hidden: boolean
  rangeStart: boolean
  rangeMiddle: boolean
  rangeEnd: boolean
  /** Part of a range still being picked. */
  preview: boolean
}

/** The columns a week's band covers, from and to (exclusive); an empty band sits at zero width where the range enters. */
function bandColumns(week: readonly BandCell[]): {
  from: number
  to: number
  empty: boolean
  preview: boolean
} {
  const covered = week.flatMap((cell, column) =>
    !cell.hidden && (cell.rangeStart || cell.rangeMiddle || cell.rangeEnd)
      ? [column]
      : [],
  )
  if (covered.length === 0) return { from: 0, to: 0, empty: true, preview: false }
  return {
    from: covered[0],
    to: covered[covered.length - 1] + 1,
    // One day alone is the start's own pill: no band shows around it.
    empty: covered.length === 1 && !week[covered[0]].rangeMiddle,
    preview: week.some((cell) => cell.preview),
  }
}

/** A week's cells as the band reads them from the page: ui-sdk marks each day, and an empty cell is ours. */
function bandCellsOf(row: Element): BandCell[] {
  return [...row.querySelectorAll<HTMLElement>(`${DAY}, [data-calendar-empty]`)].map(
    (cell) => ({
      hidden: cell.hasAttribute('data-calendar-empty'),
      rangeStart: cell.hasAttribute('data-range-start'),
      rangeMiddle: cell.hasAttribute('data-range-middle'),
      rangeEnd: cell.hasAttribute('data-range-end'),
      preview: cell.hasAttribute('data-preview'),
    }),
  )
}

/** Keeps each week's band on the days ui-sdk marks as the range, as they change. */
function followBands(area: HTMLElement): () => void {
  const draw = () => {
    for (const row of area.querySelectorAll<HTMLElement>('[data-calendar-week]')) {
      const band = row.querySelector<HTMLElement>('[data-calendar-band]')
      if (!band) continue
      const { from, to, empty, preview } = bandColumns(bandCellsOf(row))
      band.style.setProperty('--band-from', String(from))
      band.style.setProperty('--band-to', String(empty ? from : to))
      band.toggleAttribute('data-empty', empty)
      band.toggleAttribute('data-preview', preview)
    }
  }
  draw()
  const observer = new MutationObserver(draw)
  observer.observe(area, {
    subtree: true,
    childList: true,
    attributeFilter: [
      'data-range-start',
      'data-range-middle',
      'data-range-end',
      'data-preview',
    ],
  })
  return () => observer.disconnect()
}

type GridWeeks = readonly (readonly { date: string; hidden: boolean }[])[]

/** The month a grid shows now, which tells a month leaving from the one in place. */
const ShownMonthContext = createContext<string | null>(null)

/**
 * A month's grid that slides away as a still picture of itself: ui-sdk's
 * days follow their grid's month, so a copy left to render would show the
 * new month twice. The picture is the page as it last showed, without its
 * ids or tab stops.
 */
class Still extends Component<{ live: boolean; children: ReactNode }> {
  private box: HTMLDivElement | null = null
  private picture: Node | null = null

  getSnapshotBeforeUpdate(previous: { live: boolean }) {
    // Back in place, the picture makes way for the month itself.
    if (!previous.live && this.props.live) this.box?.replaceChildren()
    if (previous.live && !this.props.live && this.box) {
      const copy = this.box.cloneNode(true) as HTMLElement
      for (const element of copy.querySelectorAll('[id], [tabindex]')) {
        element.removeAttribute('id')
        element.removeAttribute('tabindex')
      }
      this.picture = copy
    }
    return null
  }

  componentDidUpdate() {
    if (!this.props.live && this.box && this.picture) {
      this.box.replaceChildren(...this.picture.childNodes)
      this.picture = null
    }
  }

  render() {
    return (
      <div
        ref={(element) => {
          this.box = element
        }}
        className='contents'
      >
        {this.props.live ? this.props.children : null}
      </div>
    )
  }
}

/** What leaves a Swap as a still picture once its month is no longer the grid's. */
function MonthStill({ month, children }: { month: string; children: ReactNode }) {
  const shown = use(ShownMonthContext)
  return <Still live={shown === month}>{children}</Still>
}

/** The way the months travel, from the last month to this one: 1 forward, -1 back. */
function useTrend(month: string): 1 | -1 {
  const [seen, setSeen] = useState({ month, trend: 1 as 1 | -1 })
  if (seen.month !== month) {
    const trend = travelTrend(seen.month, month, seen.trend)
    setSeen({ month, trend })
    return trend
  }
  return seen.trend
}

/** A month's column: as wide as seven days, shrinking together where there isn't room. */
const columnLayout =
  'flex max-w-[calc(var(--control-height)*7)] min-w-0 flex-[1_1_calc(var(--control-height)*7)] flex-col group-data-week-numbers/calendar:max-w-[calc(var(--control-height)*7+var(--calendar-week-width))] group-data-week-numbers/calendar:flex-[1_1_calc(var(--control-height)*7+var(--calendar-week-width))]'

/** A month's heading row, with room at either end for the arrows that turn the months. */
const calendarHeadingClassName =
  'flex h-(--control-height-sm) min-w-0 items-center justify-center gap-1 px-[calc(var(--control-height-sm)+0.25rem)] text-sm font-medium'

type Edges = Pick<DOMRect, 'top' | 'left' | 'right'>

/** Where the arrows sit, in px from the months' edges: Previous on the first month's heading, Next on the last's. */
function turnInsets(root: Edges, first: Edges, last: Edges, rtl: boolean) {
  return {
    previousStart: rtl ? root.right - first.right : first.left - root.left,
    nextEnd: rtl ? last.left - root.left : root.right - last.right,
    nextTop: last.top - root.top,
  }
}

/**
 * Where `element` sits inside `root`'s padding box, as laid out: unlike its
 * bounding box, this ignores the transforms of months sliding in, so the
 * arrows go straight to where the months come to rest.
 */
function layoutEdges(element: HTMLElement, root: HTMLElement): Edges {
  let left = 0
  let top = 0
  let node: HTMLElement | null = element
  while (node && node !== root) {
    left += node.offsetLeft
    top += node.offsetTop
    const parent = node.offsetParent as HTMLElement | null
    if (parent && parent !== root) {
      left += parent.clientLeft
      top += parent.clientTop
    }
    node = parent
  }
  return { left, top, right: left + element.offsetWidth }
}

/**
 * Keeps the arrows on the first and last month's headings, wherever the
 * months wrap to, by writing their places as CSS variables on `root`. They
 * sit outside the months, so they never leave with a month that turns.
 */
function useTurnPlaces(root: HTMLElement | null) {
  useEffect(() => {
    if (!root) return
    const place = () => {
      const columns = [...root.querySelectorAll<HTMLElement>('[data-calendar-column]')]
      const first = columns[0]
      const last = columns.at(-1)
      if (!first || !last) return
      const insets = turnInsets(
        { left: 0, top: 0, right: root.clientWidth },
        layoutEdges(first, root),
        layoutEdges(last, root),
        isRTL(root),
      )
      root.style.setProperty('--calendar-previous-start', `${insets.previousStart}px`)
      root.style.setProperty('--calendar-next-end', `${insets.nextEnd}px`)
      root.style.setProperty('--calendar-next-top', `${insets.nextTop}px`)
    }
    place()
    const sized = new ResizeObserver(place)
    sized.observe(root)
    return () => sized.disconnect()
  }, [root])
}

/** The arrows' places, as `useTurnPlaces` writes them. */
const calendarPreviousPlace = 'absolute start-(--calendar-previous-start,0px) top-0 z-10'
const calendarNextPlace =
  'absolute end-(--calendar-next-end,0px) top-(--calendar-next-top,0px) z-10'

/** Where the months go while the server renders: it can't know the visitor's today, so it draws none. */
function CalendarPending() {
  return (
    <div
      aria-hidden
      data-calendar-pending=''
      className='aspect-[7/6] w-[calc(var(--control-height)*7)] max-w-full'
    />
  )
}

const chevrons = {
  previous: (
    <IconPlaceholder
      lucide='ChevronLeftIcon'
      tabler='IconChevronLeft'
      hugeicons='ArrowLeft01Icon'
      phosphor='CaretLeftIcon'
      remixicon='RiArrowLeftSLine'
      className='rtl:-scale-x-100'
      aria-hidden
    />
  ),
  next: (
    <IconPlaceholder
      lucide='ChevronRightIcon'
      tabler='IconChevronRight'
      hugeicons='ArrowRight01Icon'
      phosphor='CaretRightIcon'
      remixicon='RiArrowRightSLine'
      className='rtl:-scale-x-100'
      aria-hidden
    />
  ),
}

/** The calendar's root classes, sized by its days. Disabled, its days fade and its names stay readable. */
const calendarClassName =
  'group/calendar flex w-full max-w-fit min-w-0 flex-col gap-(--surface-gap) [--calendar-week-width:calc(var(--control-height)*0.75)]'

/**
 * Content of one month that slides away, the way the months travel, when
 * its grid moves to another month: the old month leaves as a still picture
 * and the new one comes in from the other side.
 */
function MonthSlide({
  month,
  block = false,
  still = true,
  className,
  children,
}: {
  month: string
  /** Holds a block, such as the weeks, whose height follows on `layout`. */
  block?: boolean
  /**
   * Leaves as a still picture, for content whose ui-sdk parts follow the
   * grid's month. Off, the old content stays itself as it leaves, so a
   * popover in it closes in its own time.
   */
  still?: boolean
  className?: string
  children: ReactNode
}) {
  const trend = useTrend(month)
  return (
    <ShownMonthContext value={month}>
      <Swap slide={trend} id={month} block={block} className={className}>
        {still ? <MonthStill month={month}>{children}</MonthStill> : children}
      </Swap>
    </ShownMonthContext>
  )
}

export {
  bandClassName,
  bandColumns,
  CALENDAR_LABELS,
  calendarClassName,
  calendarHeadingClassName,
  CalendarLookContext,
  calendarNextPlace,
  CalendarPending,
  calendarPreviousPlace,
  chevrons,
  columnLayout,
  DAY,
  dayClassName,
  dayLayout,
  followBands,
  MonthSlide,
  turnInsets,
  useCalendarLook,
  useTurnPlaces,
  weekLayout,
  weekNumberClassName,
}
export type { BandCell, CalendarLabels, CalendarLook, DayContent, GridWeeks }
