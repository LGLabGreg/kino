'use client'

import { Button } from '@/registry/components/kino/button'
import { IconPlaceholder } from '@/registry/icons/icon-placeholder'
import type {
  CalendarCell,
  CalendarDay,
  useCalendarState,
} from '@/registry/lib/calendar-state'
import { dayLabel, weekOfYear } from '@/registry/lib/dates'
import {
  followPick,
  followPointer,
  highlightClassName,
  itemMatching,
  pickClassName,
} from '@/registry/lib/highlight'
import { pillBackdropClassName, pillClassName } from '@/registry/lib/pill'
import { markMounted, mergeRefs } from '@/registry/lib/refs'
import {
  type ComponentProps,
  type CSSProperties,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
} from 'react'

import { cn } from '@/lib/utils'

/*
 * What every direction draws the same way: a month's grid of days, the row
 * of weekday names above it and the buttons that turn the months. The look
 * is the Tabs' and the Date input's: a backdrop glides under the pointer, a
 * pill in the primary colour slides to the picked day, and a range is a band
 * from its start to its end that grows and shrinks along each week.
 */

type CalendarState = ReturnType<typeof useCalendarState>

const DAY = '[data-slot=calendar-day]'

/**
 * Seven columns, each as wide as a control is tall, so a day is square and,
 * in the Round shape, a circle. In a narrower column they shrink together.
 */
const weekLayout =
  'grid w-full grid-cols-[repeat(7,minmax(0,var(--control-height)))] group-data-week-numbers/calendar:grid-cols-[var(--calendar-week-width)_repeat(7,minmax(0,var(--control-height)))]'

/** A week's number, in the column before its days. */
const weekNumberClassName =
  'flex items-center justify-center text-xs text-muted-foreground tabular-nums'

/** A day's box, shared by its button and the pill's copy of it, so each label sits on its twin. */
const dayLayout =
  'relative flex aspect-square w-full items-center justify-center rounded-(--control-radius) text-sm tabular-nums select-none data-today:font-semibold'

/**
 * A day's colours. Days of the months either side are quieter, an
 * unavailable day is struck through, and one that can't be picked fades. A
 * range's ends and the days of a multiple pick fill with the primary colour;
 * in single mode the pill does that, and draws the pick itself until the
 * page hydrates.
 */
const dayClassName = cn(
  dayLayout,
  'text-foreground transition-[color,background-color,box-shadow] duration-(--motion-press-duration) ease-(--motion-press-fade-easing) focus-visible:z-10 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-hidden',
  'data-outside:text-muted-foreground data-unavailable:text-muted-foreground data-unavailable:line-through [&[data-disabled]]:text-foreground/30 data-outside:[&[data-disabled]]:text-foreground/30',
  // Over the backdrop or inside a range, a quiet day darkens so it still reads at 4.5:1.
  'data-outside:not-data-disabled:data-glided:text-foreground/70 data-outside:not-data-disabled:data-range-middle:text-foreground/70',
  'group-data-[mode=multiple]/calendar:data-selected:bg-primary group-data-[mode=multiple]/calendar:data-selected:text-primary-foreground',
  'data-range-start:bg-primary data-range-start:text-primary-foreground data-range-end:bg-primary data-range-end:text-primary-foreground',
  // A pick that can't be taken again (a range's start, when no stay that short is allowed) keeps its pick's colours.
  'data-range-start:[&[data-disabled]]:text-primary-foreground data-range-end:[&[data-disabled]]:text-primary-foreground group-data-[mode=multiple]/calendar:data-selected:[&[data-disabled]]:text-primary-foreground forced-colors:data-range-start:[&[data-disabled]]:text-[HighlightText] forced-colors:data-range-end:[&[data-disabled]]:text-[HighlightText] forced-colors:group-data-[mode=multiple]/calendar:data-selected:[&[data-disabled]]:text-[HighlightText]',
  '[[data-slot=calendar-month]:not([data-mounted])_&]:data-selected:not-data-outside:bg-primary [[data-slot=calendar-month]:not([data-mounted])_&]:data-selected:not-data-outside:text-primary-foreground',
  'forced-colors:data-range-start:forced-color-adjust-none forced-colors:data-range-end:forced-color-adjust-none forced-colors:group-data-[mode=multiple]/calendar:data-selected:forced-color-adjust-none forced-colors:data-range-start:bg-[Highlight] forced-colors:data-range-start:text-[HighlightText] forced-colors:data-range-end:bg-[Highlight] forced-colors:data-range-end:text-[HighlightText] forced-colors:group-data-[mode=multiple]/calendar:data-selected:bg-[Highlight] forced-colors:group-data-[mode=multiple]/calendar:data-selected:text-[HighlightText] forced-colors:data-range-middle:outline-1 forced-colors:data-range-middle:-outline-offset-4 forced-colors:data-range-middle:outline-dashed',
  // Those picks keep their own colours, so their focus outline needs a system colour; a range's middle trades its dashes for the outline.
  'forced-colors:data-range-start:focus-visible:outline-[CanvasText] forced-colors:data-range-end:focus-visible:outline-[CanvasText] forced-colors:group-data-[mode=multiple]/calendar:data-selected:focus-visible:outline-[CanvasText] forced-colors:data-range-middle:focus-visible:outline-2 forced-colors:data-range-middle:focus-visible:outline-offset-0 forced-colors:data-range-middle:focus-visible:outline-solid',
)

/**
 * The band behind a week's days in a range, from the first column the range
 * covers in that week to the last. It is as large as the week and clipped to
 * those columns, so it grows and shrinks on `layout` as the end moves; a
 * week the range leaves closes towards the side the range comes from.
 */
const bandClassName =
  'pointer-events-none absolute inset-y-0 start-0 end-0 -z-10 group-data-week-numbers/calendar:start-(--calendar-week-width) rounded-(--control-radius) bg-primary/12 [clip-path:inset(1px_calc((7-var(--band-to))/7*100%+1px)_1px_calc(var(--band-from)/7*100%+1px)_round_var(--control-radius-capped))] rtl:[clip-path:inset(1px_calc(var(--band-from)/7*100%+1px)_1px_calc((7-var(--band-to))/7*100%+1px)_round_var(--control-radius-capped))] transition-[opacity,clip-path] duration-(--motion-layout-duration) ease-(--motion-layout-easing) data-empty:opacity-0 data-empty:duration-(--motion-exit-duration) data-preview:bg-primary/8 motion-reduce:transition-[opacity]'

/** The columns a week's band covers, from and to (exclusive); an empty band sits at zero width where the range enters. */
function bandColumns(week: readonly CalendarCell[]): {
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

function CalendarWeekdays({
  state,
  className,
}: {
  state: CalendarState
  className?: string
}) {
  return (
    // The days' own names say their weekday, so the row is only seen.
    <div
      aria-hidden
      data-slot='calendar-weekdays'
      className={cn(weekLayout, 'text-xs text-muted-foreground', className)}
    >
      {state.showWeekNumbers && <span />}
      {state.weekdays.short.map((name, index) => (
        <span
          key={state.weekdays.long[index]}
          className='flex h-[calc(var(--control-height)*0.75)] items-center justify-center'
        >
          {name}
        </span>
      ))}
    </div>
  )
}

/** What a day shows: its number, or the buyer's own content for it. */
type DayContent = (date: string, day: CalendarDay) => ReactNode

function DayLabel({
  cell,
  locale,
  content,
}: {
  cell: CalendarCell
  locale: string
  content?: DayContent
}) {
  return <>{content ? content(cell.date, cell) : dayLabel(cell.date, locale)}</>
}

/** A week's number, which heads its row. */
function WeekNumber({ state, date }: { state: CalendarState; date: string }) {
  const week = weekOfYear(date, state.first)
  return (
    <span
      role='rowheader'
      aria-label={state.labels.week(week)}
      className={weekNumberClassName}
    >
      {week}
    </span>
  )
}

/** One month's days, as the WAI-ARIA date grid: one tab stop, and the arrow keys move between days. */
function CalendarMonth({
  state,
  month,
  labelId,
  dayContent,
  className,
}: {
  state: CalendarState
  month: string
  /** The id of the month's visible name. */
  labelId: string
  dayContent?: DayContent
  className?: string
}) {
  const areaRef = useRef<HTMLDivElement>(null)
  const areaRefs = useMemo(() => mergeRefs(areaRef, markMounted), [])
  const pillRef = useRef<HTMLSpanElement>(null)
  const weeks = state.grid(month)
  const single = state.mode === 'single'

  useEffect(() => {
    const area = areaRef.current
    const pill = pillRef.current
    if (!area || !pill) return
    return followPick(area, pill, {
      picked: () =>
        area.querySelector<HTMLElement>(`${DAY}[data-selected]:not([data-outside])`),
      attributes: ['data-selected'],
    })
  }, [single])

  return (
    <div
      ref={areaRefs}
      data-slot='calendar-month'
      data-month={month}
      aria-labelledby={labelId}
      {...state.gridProps}
      className={cn('relative isolate flex w-full flex-col', className)}
    >
      {weeks.map((week) => {
        const band = bandColumns(week)
        return (
          <div key={week[0].date} role='row' className={cn(weekLayout, 'relative')}>
            {state.showWeekNumbers && <WeekNumber state={state} date={week[0].date} />}
            {state.mode === 'range' && (
              <span
                aria-hidden
                data-slot='calendar-band'
                data-empty={band.empty ? '' : undefined}
                data-preview={band.preview ? '' : undefined}
                style={
                  {
                    '--band-from': band.from,
                    '--band-to': band.empty ? band.from : band.to,
                  } as CSSProperties
                }
                className={bandClassName}
              />
            )}
            {week.map((cell) => (
              <span
                key={cell.date}
                role='gridcell'
                // A range still being picked isn't selected until its end is.
                aria-selected={
                  cell.hidden
                    ? undefined
                    : cell.selected || (cell.rangeMiddle && !cell.preview)
                }
                // Each day sits 1px in from its cell, so days stand 2px apart across and down alike.
                className='flex min-w-0 p-px'
              >
                {cell.hidden ? (
                  // Holds the day's square, so a week of hidden days keeps its height.
                  <span className='aspect-square w-full' />
                ) : (
                  <button
                    data-slot='calendar-day'
                    {...state.dayButtonProps(cell)}
                    // With content of the buyer's, the name is the full date and then what they show.
                    aria-label={dayContent ? undefined : state.dayName(cell.date)}
                    className={dayClassName}
                  >
                    {dayContent && (
                      <span className='sr-only'>{state.dayName(cell.date)}</span>
                    )}
                    <DayLabel cell={cell} locale={state.locale} content={dayContent} />
                  </button>
                )}
              </span>
            ))}
          </div>
        )
      })}
      {single && (
        <span
          ref={pillRef}
          aria-hidden
          inert
          data-slot='calendar-pill'
          className={cn(
            pickClassName,
            pillClassName,
            'z-10 group-data-disabled/calendar:data-[highlight=shown]:opacity-50',
          )}
        >
          <span className='flex flex-col'>
            {weeks.map((week) => (
              <span key={week[0].date} className={weekLayout}>
                {state.showWeekNumbers && <span />}
                {week.map((cell) => (
                  <span key={cell.date} className='flex min-w-0 p-px'>
                    <span data-today={cell.today ? '' : undefined} className={dayLayout}>
                      {cell.hidden ? null : (
                        <DayLabel
                          cell={cell}
                          locale={state.locale}
                          content={dayContent}
                        />
                      )}
                    </span>
                  </span>
                ))}
              </span>
            ))}
          </span>
        </span>
      )}
    </div>
  )
}

/**
 * The months on screen in a row that wraps into a column when there isn't
 * room, each under its own heading, which a direction draws: a name, a
 * button that steps out to the months, or selects.
 */
function CalendarColumns({
  state,
  heading,
  labelId,
  dayContent,
}: {
  state: CalendarState
  heading: (month: string, offset: number) => ReactNode
  /** The id of a month's visible name, which names its grid. */
  labelId: (month: string) => string
  dayContent?: DayContent
}) {
  // One backdrop under every month on screen, so it glides from one to the next.
  const areaRef = useRef<HTMLSpanElement>(null)
  const backdropRef = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    const area = areaRef.current
    const backdrop = backdropRef.current
    if (!area || !backdrop) return
    return followPointer(area, backdrop, { itemOf: itemMatching(area, DAY), focus: true })
  }, [])
  return (
    <span
      ref={areaRef}
      className='relative isolate flex w-full flex-wrap gap-x-(--surface-padding-lg) gap-y-(--surface-gap)'
    >
      <span
        ref={backdropRef}
        aria-hidden
        data-slot='calendar-backdrop'
        className={cn(highlightClassName, pillBackdropClassName)}
      />
      {state.shown.map((month, offset) => (
        <span
          key={month}
          data-slot='calendar-column'
          className={cn(columnLayout, 'gap-1')}
        >
          <span className={calendarHeadingClassName}>{heading(month, offset)}</span>
          <CalendarWeekdays state={state} />
          <CalendarMonth
            state={state}
            month={month}
            labelId={labelId(month)}
            dayContent={dayContent}
          />
        </span>
      ))}
    </span>
  )
}

/** A month's column: as wide as seven days, shrinking together where there isn't room. */
const columnLayout =
  'flex max-w-[calc(var(--control-height)*7)] min-w-0 flex-[1_1_calc(var(--control-height)*7)] flex-col group-data-week-numbers/calendar:max-w-[calc(var(--control-height)*7+var(--calendar-week-width))] group-data-week-numbers/calendar:flex-[1_1_calc(var(--control-height)*7+var(--calendar-week-width))]'

/** A month's heading row, with room at either end for the arrows that turn the months. */
const calendarHeadingClassName =
  'flex h-(--control-height-sm) min-w-0 items-center justify-center gap-1 px-[calc(var(--control-height-sm)+0.25rem)] text-sm font-medium'

type Edges = Pick<DOMRect, 'top' | 'left' | 'right'>

/** Where the arrows sit, in px from the calendar's edges: Previous on the first month's heading, Next on the last's. */
function turnInsets(root: Edges, first: Edges, last: Edges, rtl: boolean) {
  return {
    previousStart: rtl ? root.right - first.right : first.left - root.left,
    nextEnd: rtl ? last.left - root.left : root.right - last.right,
    nextTop: last.top - root.top,
  }
}

/**
 * Where `element` sits inside `root`'s padding box, as laid out: unlike its
 * bounding box, this ignores the transforms of months sliding or zooming in,
 * so the arrows go straight to where the months come to rest.
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
function useTurnPlaces(root: HTMLElement | null, rtl: boolean) {
  useEffect(() => {
    if (!root) return
    const place = () => {
      const columns = [
        ...root.querySelectorAll<HTMLElement>('[data-slot=calendar-column]'),
      ].filter((column) => !column.closest('[inert]'))
      const first = columns[0]
      const last = columns.at(-1)
      if (!first || !last) return
      const insets = turnInsets(
        { left: 0, top: 0, right: root.clientWidth },
        layoutEdges(first, root),
        layoutEdges(last, root),
        rtl,
      )
      root.style.setProperty('--calendar-previous-start', `${insets.previousStart}px`)
      root.style.setProperty('--calendar-next-end', `${insets.nextEnd}px`)
      root.style.setProperty('--calendar-next-top', `${insets.nextTop}px`)
    }
    place()
    const sized = new ResizeObserver(place)
    sized.observe(root)
    const changed = new MutationObserver(place)
    changed.observe(root, { childList: true, subtree: true })
    return () => {
      sized.disconnect()
      changed.disconnect()
    }
  }, [root, rtl])
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
      data-slot='calendar-pending'
      className='aspect-[7/6] w-[calc(var(--control-height)*7)] max-w-full'
    />
  )
}

/** The buttons that turn the months, with their names from the state. */
function CalendarTurn({
  direction,
  className,
  ...props
}: Omit<ComponentProps<typeof Button>, 'children' | 'variant' | 'size'> & {
  direction: 'previous' | 'next'
}) {
  return (
    <Button
      variant='ghost'
      size='icon-sm'
      data-slot={`calendar-${direction}`}
      className={className}
      {...props}
    >
      {direction === 'previous' ? (
        <IconPlaceholder
          lucide='ChevronLeftIcon'
          tabler='IconChevronLeft'
          hugeicons='ArrowLeft01Icon'
          phosphor='CaretLeftIcon'
          remixicon='RiArrowLeftSLine'
          className='rtl:-scale-x-100'
          aria-hidden
        />
      ) : (
        <IconPlaceholder
          lucide='ChevronRightIcon'
          tabler='IconChevronRight'
          hugeicons='ArrowRight01Icon'
          phosphor='CaretRightIcon'
          remixicon='RiArrowRightSLine'
          className='rtl:-scale-x-100'
          aria-hidden
        />
      )}
    </Button>
  )
}

/** The calendar's root classes, sized by its days. Disabled, its days fade and its names stay readable. */
const calendarClassName =
  'group/calendar flex w-full max-w-fit min-w-0 flex-col gap-(--surface-gap) [--calendar-week-width:calc(var(--control-height)*0.75)]'

export {
  bandColumns,
  CalendarColumns,
  calendarNextPlace,
  calendarPreviousPlace,
  CalendarPending,
  CalendarTurn,
  calendarClassName,
  turnInsets,
  useTurnPlaces,
}
