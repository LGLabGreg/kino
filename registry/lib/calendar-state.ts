'use client'

import {
  type CalendarMode,
  type CalendarRules,
  type CalendarValue,
  type DayMarks,
  dayMarks,
  firstShownFor,
  hiddenOutside,
  keyTarget,
  normalizeValue,
  outOfBounds,
  pageTarget,
  pick,
  pickedDates,
  rangeEnds,
  revealing as revealingIn,
  tabStop,
  travelTrend,
} from '@/registry/lib/calendar-model'
import {
  boundDay,
  type DateMatchers,
  type DateRange,
  formatDate,
  isISODate,
  isISOMonth,
  monthGrid,
  monthLabel,
  monthOf,
  shiftMonth,
  today as todayIn,
  type Weekday,
  weekdayNames,
  weekStart,
  useLocale,
} from '@/registry/lib/dates'
import { keptOnReset, useFieldProps } from '@/registry/lib/field-control'
import { useDirection } from '@base-ui/react/direction-provider'
import { createChangeEventDetails } from '@base-ui/react/internals/createBaseUIEventDetails'
import { mergeProps } from '@base-ui/react/merge-props'
import type { BaseUIChangeEventDetails } from '@base-ui/react/types'
import {
  type ComponentProps,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  type SyntheticEvent,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'

/*
 * A calendar's state and its wiring, whatever it looks like: the value,
 * picked one day, several or a range at a time, the months on screen and
 * which way they last moved, the day that holds focus, and the keys of the
 * WAI-ARIA date grid. Every decision is a pure function in
 * `calendar-model.ts`, and every date comes from `dates.ts`.
 */

/**
 * Why a calendar's value, month, range start or focus is changing: a day or a
 * month pressed (`item-press`), the previous or next button
 * (`trigger-press`), a key (`keyboard`), Escape (`escape-key`) or its form's
 * reset (`reset`). Calling `cancel()` keeps things as they are.
 */
export type CalendarChangeDetails = BaseUIChangeEventDetails<
  'item-press' | 'trigger-press' | 'keyboard' | 'escape-key' | 'reset'
>

interface CalendarOptions {
  /** The first month shown, as `yyyy-mm`. */
  month?: string
  /** The first month shown at first: the picked day's month, else today's. */
  defaultMonth?: string
  onMonthChange?: (month: string, details: CalendarChangeDetails) => void
  /** The earliest day that can be picked or focused, as `yyyy-mm-dd`. */
  min?: string
  /** The latest day that can be picked or focused, as `yyyy-mm-dd`. */
  max?: string
  /** Days that can't be picked, as dates, `{ from, to }`, `{ weekday: [0, 6] }`, `{ before }`, `{ after }` or a function. They show struck through and can still be focused. */
  unavailable?: DateMatchers
  /** Lets a range hold unavailable days, which still can't be its ends. */
  allowUnavailable?: boolean
  /** A range's fewest days, both ends counted; in multiple mode, the fewest days picked. */
  minDays?: number
  /** A range's most days, both ends counted; in multiple mode, the most days picked, after which the rest can't be pressed. */
  maxDays?: number
  /** A press on the picked day clears it, in single mode. */
  deselectable?: boolean
  disabled?: boolean
  /** Focus and the months still move; the value doesn't change. */
  readOnly?: boolean
  /** How many months show side by side. */
  months?: number
  /** Whether the previous and next buttons move a month, or every month on screen. */
  pageBy?: 'month' | 'page'
  /** Sets the names of the months and days, and the day the week starts on. The browser's language by default. */
  locale?: string
  /** The day weeks start on, 0 for Sunday; the locale's own by default. */
  weekStartsOn?: Weekday
  weekdayFormat?: 'narrow' | 'short' | 'long'
  monthFormat?: 'narrow' | 'short' | 'long'
  /** Shows six weeks in every month, so the calendar's height never changes. */
  fixedWeeks?: boolean
  /** Shows the days of the months either side in the first and last week. */
  showOutsideDays?: boolean
  /** The day marked as today, as `yyyy-mm-dd`; by default the visitor's, in `timeZone`. */
  today?: string
  /** The time zone that decides which day is today. The visitor's own by default. */
  timeZone?: string
  /** The start of a range as it is picked, and null once it ends or is dropped. */
  onRangeStartChange?: (date: string | null, details: CalendarChangeDetails) => void
  /** The day that holds the grid's focus, as `yyyy-mm-dd`, when you hold it: setting it moves the tab stop there and turns the months to show it. */
  focusedValue?: string | null
  /** The day that holds the grid's focus at first. */
  defaultFocusedValue?: string | null
  /** The day taking focus. From the arrow keys it is asked first, and `details.cancel()` keeps focus where it is; by a press or Tab, focus has already moved. */
  onFocusedChange?: (date: string, details: CalendarChangeDetails) => void
  /** Focuses the grid's tab stop once the calendar shows, as in a date picker that just opened. */
  autoFocus?: boolean
  /** Shows each week's number before it: ISO 8601 when weeks start on Monday, else as in the United States. */
  showWeekNumbers?: boolean
  /** Sends each picked day with a form, under this name: one for a day, one each for several, the start and then the end for a range. */
  name?: string
  /** The form the days go with, when the calendar sits outside it. */
  form?: string
  /** A form can't be sent until a day is picked, or a range is. */
  required?: boolean
  /** Marks the calendar as holding a value that isn't allowed; in a Field, its validity decides. */
  invalid?: boolean
  /** The names the calendar's own buttons and parts take, in place of the English ones. */
  labels?: Partial<CalendarLabels>
}

/** The names of the calendar's own buttons and parts. */
export interface CalendarLabels {
  previousMonth: string
  nextMonth: string
  /** A month's heading, from the month's name: `November 2026, choose a month`. */
  chooseMonth: (month: string) => string
  /** The year's heading among its months, from the year: `2026, choose a year`. */
  chooseYear: (year: string) => string
  /** The popover while it lists months. */
  months: string
  /** The popover while it lists years. */
  years: string
  previousYear: string
  nextYear: string
  previousYears: string
  nextYears: string
  /** A week's number, before its days: `Week 47`. */
  week: (week: number) => string
}

/** The calendar's own names in English, which `labels` replaces one by one. */
export const CALENDAR_LABELS: CalendarLabels = {
  previousMonth: 'Previous month',
  nextMonth: 'Next month',
  chooseMonth: (month) => `${month}, choose a month`,
  chooseYear: (year) => `${year}, choose a year`,
  months: 'Choose a month',
  years: 'Choose a year',
  previousYear: 'Previous year',
  nextYear: 'Next year',
  previousYears: 'Previous years',
  nextYears: 'Next years',
  week: (week) => `Week ${week}`,
}

interface CalendarSingle {
  mode?: 'single'
  /** The picked day, as `yyyy-mm-dd`. */
  value?: string | null
  defaultValue?: string | null
  onValueChange?: (value: string | null, details: CalendarChangeDetails) => void
}

interface CalendarMultiple {
  mode: 'multiple'
  /** The picked days, sorted. */
  value?: string[]
  defaultValue?: string[]
  onValueChange?: (value: string[], details: CalendarChangeDetails) => void
}

interface CalendarRange {
  mode: 'range'
  /** The picked range, start first; null until both ends are picked. */
  value?: DateRange | null
  defaultValue?: DateRange | null
  onValueChange?: (value: DateRange | null, details: CalendarChangeDetails) => void
}

export type CalendarStateProps = CalendarOptions &
  (CalendarSingle | CalendarMultiple | CalendarRange)

/** A calendar's props: its state's, and the rest for its root. */
export type DayProps = Omit<
  ComponentProps<'div'>,
  keyof CalendarStateProps | 'children'
> &
  CalendarStateProps & {
    /** What a day shows in place of its number, such as its number and a price under it, from the date and how it is marked. */
    dayContent?: (date: string, day: CalendarDay) => ReactNode
  }

const STATE_PROPS = new Set<string>([
  // The Calendar's choice between its days and its months or years.
  'granularity',
  'mode',
  'value',
  'defaultValue',
  'onValueChange',
  'month',
  'defaultMonth',
  'onMonthChange',
  'min',
  'max',
  'unavailable',
  'allowUnavailable',
  'minDays',
  'maxDays',
  'deselectable',
  'disabled',
  'readOnly',
  'months',
  'pageBy',
  'locale',
  'weekStartsOn',
  'weekdayFormat',
  'monthFormat',
  'fixedWeeks',
  'showOutsideDays',
  'today',
  'timeZone',
  'onRangeStartChange',
  'focusedValue',
  'defaultFocusedValue',
  'onFocusedChange',
  'autoFocus',
  'showWeekNumbers',
  'name',
  'form',
  'required',
  'invalid',
  'labels',
])

/** The state's props and the rest, which go to the calendar's root. */
export function splitCalendarProps<Props extends CalendarStateProps>(
  props: Props,
): [
  CalendarStateProps,
  Omit<
    Props,
    keyof CalendarOptions | 'mode' | 'value' | 'defaultValue' | 'onValueChange'
  >,
] {
  const state: Record<string, unknown> = {}
  const rest: Record<string, unknown> = {}
  for (const [name, value] of Object.entries(props)) {
    if (STATE_PROPS.has(name)) state[name] = value
    else rest[name] = value
  }
  return [
    state as CalendarStateProps,
    rest as Omit<
      Props,
      keyof CalendarOptions | 'mode' | 'value' | 'defaultValue' | 'onValueChange'
    >,
  ]
}

/** How a day is marked, as `dayContent` is told. */
export interface CalendarDay extends DayMarks {
  /** In the month before or after the one it is drawn in. */
  outside: boolean
  today: boolean
  /** Outside `min` and `max`, or the calendar is disabled: it can't take focus. */
  blocked: boolean
}

/** A day as a month's grid draws it. */
export interface CalendarCell extends CalendarDay {
  date: string
  /** An outside day left empty: outside days are off, or the day shows in its own month beside. */
  hidden: boolean
  /** The grid's one tab stop. */
  tabStop: boolean
}

type Reason = CalendarChangeDetails['reason']

function createDetails(reason: Reason, event: Event, trigger?: Element) {
  return createChangeEventDetails(
    reason,
    event as never,
    trigger,
  ) as CalendarChangeDetails
}

/** The details of a change that came from a React event on `currentTarget`. */
export function detailsOf(reason: Reason, event: SyntheticEvent<Element>) {
  return createDetails(reason, event.nativeEvent, event.currentTarget)
}

/** The details of a change that a form's reset makes. */
export function resetDetails(event: Event) {
  return createDetails('reset', event)
}

function noChange() {
  return () => {}
}

/** Today in `timeZone`; null while the server renders, which can't know the visitor's day. */
export function useToday(timeZone?: string): string | null {
  return useSyncExternalStore(
    noChange,
    () => todayIn(timeZone),
    () => null,
  )
}

/** What a calendar's options have in common, to the day, the month or the year. */
interface CalendarBasics {
  min?: string
  max?: string
  disabled?: boolean
  name?: string
  invalid?: boolean
  labels?: Partial<CalendarLabels>
  locale?: string
  today?: string
  timeZone?: string
}

/**
 * The setup every calendar shares, whatever it picks: in a Field, its name,
 * disabled state and validity come from the Field; its labels, language,
 * direction and today; and `min` and `max` of any granularity (a year, a
 * month, a day, a date and time) as the first and last days they allow.
 */
export function useCalendarBasics(props: CalendarBasics) {
  const { field, invalid } = useFieldProps({})
  const clock = useToday(props.timeZone)
  return {
    min: boundDay(props.min, 'start'),
    max: boundDay(props.max, 'end'),
    disabled: props.disabled === true || field?.disabled === true,
    name: props.name ?? field?.name,
    invalid: props.invalid ?? invalid,
    labels: { ...CALENDAR_LABELS, ...props.labels },
    locale: useLocale(props.locale),
    rtl: useDirection() === 'rtl',
    today: isISODate(props.today) ? props.today : clock,
  }
}

export function useCalendarState(props: CalendarStateProps) {
  const mode: CalendarMode = props.mode ?? 'single'
  const { min, max, disabled, name, invalid, labels, locale, rtl, today } =
    useCalendarBasics(props)
  const {
    readOnly = false,
    months: count = 1,
    pageBy = 'month',
    weekdayFormat = 'short',
    monthFormat = 'long',
    fixedWeeks = true,
    showOutsideDays = true,
  } = props
  const first = useMemo(
    () => props.weekStartsOn ?? weekStart(locale),
    [props.weekStartsOn, locale],
  )
  const rules: CalendarRules = {
    mode,
    min,
    max,
    unavailable: props.unavailable,
    allowUnavailable: props.allowUnavailable,
    minDays: props.minDays,
    maxDays: props.maxDays,
    deselectable: props.deselectable,
  }

  const controlled = props.value !== undefined
  const [ownValue, setOwnValue] = useState(() => normalizeValue(mode, props.defaultValue))
  const value = controlled ? normalizeValue(mode, props.value) : ownValue
  const [anchor, setAnchor] = useState<string | null>(null)
  const picked = pickedDates(value)

  const focusControlled = props.focusedValue !== undefined
  const [ownFocused, setOwnFocused] = useState<string | null>(() =>
    isISODate(props.defaultFocusedValue) ? props.defaultFocusedValue : null,
  )
  const focused = focusControlled
    ? isISODate(props.focusedValue)
      ? props.focusedValue
      : null
    : ownFocused
  const setFocused = (date: string) => {
    if (!focusControlled) setOwnFocused(date)
  }

  const monthControlled = props.month !== undefined
  // With nothing picked and no month given, the first month is today's,
  // which the server can't know: it shows no month until the visitor's
  // clock is read, so the server and the page agree.
  const [ownMonth, setOwnMonth] = useState<string | null>(() =>
    isISOMonth(props.defaultMonth)
      ? props.defaultMonth
      : focused
        ? monthOf(focused)
        : picked[0]
          ? monthOf(picked[0])
          : null,
  )
  const month: string | null = monthControlled
    ? isISOMonth(props.month)
      ? props.month
      : null
    : (ownMonth ?? (today ? monthOf(today) : null))
  const shown = month ? shownFrom(month, count) : []

  // Which way the months last moved, so what arrives comes from that side.
  const [travel, setTravel] = useState<{ month: string | null; trend: 1 | -1 }>({
    month,
    trend: 1,
  })
  let { trend } = travel
  if (travel.month !== month) {
    trend = travelTrend(travel.month, month, trend)
    setTravel({ month, trend })
  }

  const [preview, setPreview] = useState<string | null>(null)
  // Focus follows once the months have rendered: to the focused day after a
  // key, or to the tab stop after an arrow that can go no further.
  const pendingFocus = useRef<'focused' | 'stop' | null>(null)
  // The focused day you hold changed: the months turn to show it.
  const [heldFocus, setHeldFocus] = useState(focused)
  if (focusControlled && heldFocus !== focused) {
    setHeldFocus(focused)
    const turn = focused && month ? revealingIn(focused, shownFrom(month, count)) : null
    if (turn && !monthControlled) setOwnMonth(turn)
  }
  // A pointer is down on a day, so the focus that follows came from a press.
  const pressing = useRef(false)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const attachRoot = useCallback((node: HTMLDivElement | null) => {
    rootRef.current = node
  }, [])
  const focusGrid = useCallback(() => {
    const stops = rootRef.current?.querySelectorAll<HTMLElement>(
      '[data-slot=calendar-day][tabindex="0"]',
    )
    // The months leaving are still on screen, inert, beside the ones arriving.
    ;[...(stops ?? [])]
      .find((stop) => !stop.closest('[inert]'))
      ?.focus({ preventScroll: true })
  }, [])

  /*
   * Each change asks its callback first, which can cancel it, and is only
   * then made. A move that changes two things asks both before making either.
   */
  const askMonth = (next: string, details: CalendarChangeDetails) => {
    if (next !== month) props.onMonthChange?.(next, details)
    return !details.isCanceled
  }
  const setMonth = (next: string) => {
    if (!monthControlled) setOwnMonth(next)
  }
  const changeMonth = (next: string, details: CalendarChangeDetails) => {
    if (!askMonth(next, details)) return false
    setMonth(next)
    return true
  }
  const askAnchor = (next: string | null, details: CalendarChangeDetails) => {
    if (next !== anchor) props.onRangeStartChange?.(next, details)
    return !details.isCanceled
  }
  const askValue = (next: CalendarValue, details: CalendarChangeDetails) => {
    ;(
      props.onValueChange as
        | ((value: CalendarValue, details: CalendarChangeDetails) => void)
        | undefined
    )?.(next, details)
    return !details.isCanceled
  }
  const askFocus = (next: string, details: CalendarChangeDetails) => {
    if (next !== focused) props.onFocusedChange?.(next, details)
    return !details.isCanceled
  }

  const step = pageBy === 'page' ? count : 1
  const previousMonth = month && !disabled ? pageTarget(month, -step, count, rules) : null
  /** An arrow that can go no further disables itself, so its focus goes to the grid. */
  const handOffAtEdge = (to: string, by: number) => {
    if (pageTarget(to, by, count, rules) === null) pendingFocus.current = 'stop'
  }
  const nextMonth = month && !disabled ? pageTarget(month, step, count, rules) : null

  const revealing = (date: string) => revealingIn(date, shown)

  /**
   * A press on a day: `onValueChange` is asked, then `onRangeStartChange`,
   * and a cancel in either keeps both as they were.
   */
  const press = (date: string, event: SyntheticEvent<HTMLElement>) => {
    if (readOnly || disabled) return
    const next = pick({ value, anchor }, date, rules)
    const details = () => detailsOf('item-press', event)
    if (next.value !== value && !askValue(next.value, details())) return
    if (next.anchor !== anchor && !askAnchor(next.anchor, details())) return
    if (next.value !== value && !controlled) setOwnValue(next.value)
    setAnchor(next.anchor)
    setPreview(null)
  }

  /** Back to the value it started with, as a form's reset does. */
  const reset = (event: Event) => {
    if (keptOnReset(props.value, props.defaultValue)) return
    const initial = normalizeValue(mode, props.defaultValue)
    if (pickedDates(initial).join() !== picked.join()) {
      if (!askValue(initial, resetDetails(event))) return
      if (!controlled) setOwnValue(initial)
    }
    setAnchor(null)
  }

  // Focus moves to its day once the month it is in has rendered, before the
  // month it left goes inert.
  // The focused day you hold moving takes focus with it, if it is in the grid.
  const lastFocused = useRef(focused)
  useLayoutEffect(() => {
    const root = rootRef.current
    const held = lastFocused.current !== focused
    lastFocused.current = focused
    const moved = pendingFocus.current
    pendingFocus.current = null
    if (!root) return
    if (moved === 'stop') return focusGrid()
    if (!focused) return
    if (!moved && !(held && focusControlled && inGrid(root))) return
    dayButton(root, focused)?.focus({ preventScroll: true })
  })

  // With `autoFocus`, the tab stop takes focus once the months first show.
  const autoFocused = useRef(false)
  const hasMonths = shown.length > 0
  useLayoutEffect(() => {
    const root = rootRef.current
    if (!props.autoFocus || autoFocused.current || !hasMonths || !root) return
    autoFocused.current = true
    focusGrid()
  }, [props.autoFocus, hasMonths, focusGrid])

  const stop = shown.length
    ? tabStop(shown, focused ? [focused, ...picked] : picked, today, rules)
    : null
  // Where a range waiting for its end can end, worked out once for every day on screen.
  const lastOnScreen = shown.length
    ? monthGrid(shown[count - 1], first, { fixedWeeks })
        .at(-1)
        ?.at(-1)
    : undefined
  const ends =
    mode === 'range' && anchor && lastOnScreen && lastOnScreen >= anchor
      ? rangeEnds(anchor, rules, lastOnScreen)
      : undefined

  const grid = (shownMonth: string): CalendarCell[][] =>
    monthGrid(shownMonth, first, { fixedWeeks }).map((week) =>
      week.map((date) => {
        const outside = monthOf(date) !== shownMonth
        return {
          ...dayMarks(date, { value, anchor }, rules, anchor ? preview : null, ends),
          date,
          outside,
          hidden: hiddenOutside(date, shownMonth, shown, showOutsideDays),
          today: date === today,
          tabStop: !outside && date === stop,
          blocked: disabled || outOfBounds(date, rules),
        }
      }),
    )

  const dayButtonProps = (cell: CalendarCell) => ({
    type: 'button' as const,
    'data-date': cell.date,
    'data-outside': cell.outside ? '' : undefined,
    'data-today': cell.today ? '' : undefined,
    'data-selected': cell.selected ? ('true' as const) : undefined,
    'data-range-start': cell.rangeStart ? '' : undefined,
    'data-range-middle': cell.rangeMiddle ? '' : undefined,
    'data-range-end': cell.rangeEnd ? '' : undefined,
    'data-preview': cell.preview ? '' : undefined,
    'data-unavailable': cell.unavailable ? '' : undefined,
    'data-disabled': cell.disabled || cell.blocked ? '' : undefined,
    disabled: cell.blocked,
    tabIndex: cell.tabStop ? 0 : -1,
    'aria-current': cell.today ? ('date' as const) : undefined,
    'aria-disabled': cell.disabled ? true : undefined,
    onClick: (event: MouseEvent<HTMLElement>) => {
      press(cell.date, event)
      // A day of the month beside turns to that month.
      const turn = cell.outside ? revealing(cell.date) : null
      // Its button leaves with the month it sat in, so focus goes to the day in its own month.
      if (turn && changeMonth(turn, detailsOf('item-press', event))) {
        setFocused(cell.date)
        pendingFocus.current = 'focused'
      }
    },
    onPointerDown: () => {
      pressing.current = true
    },
    onFocus: (event: FocusEvent<HTMLButtonElement>) => {
      const reason = pressing.current ? 'item-press' : 'keyboard'
      pressing.current = false
      if (cell.outside || cell.date === focused) return
      // Focus has already moved, by a press or Tab: it is told, not asked.
      props.onFocusedChange?.(cell.date, detailsOf(reason, event))
      setFocused(cell.date)
      if (anchor) setPreview(cell.date)
    },
    onPointerEnter: (event: PointerEvent<HTMLButtonElement>) => {
      if (event.pointerType !== 'touch' && anchor) setPreview(cell.date)
    },
    onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => {
      if (event.altKey || event.ctrlKey || event.metaKey) return
      const target = keyTarget(cell.date, event.key, {
        shift: event.shiftKey,
        rtl,
        first,
        min: rules.min,
        max: rules.max,
      })
      if (target === null) return
      event.preventDefault()
      // The months the move turns to, then the day: a cancel in either keeps both.
      const turn = revealing(target)
      if (turn && !askMonth(turn, detailsOf('keyboard', event))) return
      if (!askFocus(target, detailsOf('keyboard', event))) return
      if (turn) setMonth(turn)
      setFocused(target)
      if (anchor) setPreview(target)
      pendingFocus.current = 'focused'
    },
  })

  const rootHandlers = {
    role: 'group' as const,
    'data-mode': mode,
    'data-disabled': disabled ? '' : undefined,
    'data-readonly': readOnly ? '' : undefined,
    'data-invalid': invalid ? '' : undefined,
    'data-week-numbers': props.showWeekNumbers ? '' : undefined,
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
      // Escape drops a range's start before it closes anything around the
      // calendar, unless a handler of the buyer's already took the key.
      if (event.key !== 'Escape' || anchor === null || event.defaultPrevented) return
      // A key from a popup of the calendar's own, such as a heading's list of months, isn't the calendar's.
      if (!(event.target instanceof Node) || !event.currentTarget.contains(event.target))
        return
      if (!askAnchor(null, detailsOf('escape-key', event))) return
      event.preventDefault()
      event.stopPropagation()
      setAnchor(null)
      setPreview(null)
    },
  }

  return {
    locale,
    mode,
    rtl,
    first,
    /** Every month on screen, the first one first. */
    shown,
    trend,
    /** The start of a range still to finish. */
    anchor,
    weekdays: useMemo(
      () => ({
        short: weekdayNames(locale, first, weekdayFormat),
        long: weekdayNames(locale, first, 'long'),
      }),
      [locale, first, weekdayFormat],
    ),
    label: (shownMonth: string) => monthLabel(shownMonth, locale, monthFormat),
    /** A day's full name, which names its button: Thursday 19 November 2026. */
    dayName: (date: string) => formatDate(date, locale, { dateStyle: 'full' }),
    grid,
    dayButtonProps,
    previousProps: {
      type: 'button' as const,
      disabled: previousMonth === null,
      'aria-label': labels.previousMonth,
      onClick: (event: MouseEvent<HTMLElement>) => {
        if (
          previousMonth &&
          changeMonth(previousMonth, detailsOf('trigger-press', event))
        )
          handOffAtEdge(previousMonth, -step)
      },
    },
    nextProps: {
      type: 'button' as const,
      disabled: nextMonth === null,
      'aria-label': labels.nextMonth,
      onClick: (event: MouseEvent<HTMLElement>) => {
        if (nextMonth && changeMonth(nextMonth, detailsOf('trigger-press', event)))
          handOffAtEdge(nextMonth, step)
      },
    },
    /** Shows `target` at `offset` among the months on screen (0, the first), as a picker of months or years chose it. Returns the first month now on screen, or null when the buyer cancelled. */
    goTo: (target: string, offset: number, event: Event, trigger?: Element) => {
      const next = firstShownFor(target, offset, count, rules)
      return changeMonth(next, createDetails('item-press', event, trigger)) ? next : null
    },
    /** What the calendar's root takes, with the buyer's own props merged in: both handlers run, the buyer's first, and theirs can stop the calendar's with `preventDefault`. Its ref is `rootRef`, merged once by the caller. */
    rootProps: (own: Omit<ComponentProps<'div'>, 'className' | 'ref'> = {}) =>
      mergeProps<'div'>(rootHandlers, own),
    /** The root's own ref: it finds the grid's cells and keeps focus on the right day. */
    rootRef: attachRoot,
    disabled,
    readOnly,
    invalid,
    labels,
    showWeekNumbers: props.showWeekNumbers ?? false,
    /** What a form gets: each picked day under `name`, and whether one must be picked. */
    formValue: {
      name: disabled ? undefined : name,
      form: props.form,
      required: props.required ?? false,
      dates: picked,
      many: mode !== 'single',
      reset,
    },
    /** Focuses the grid's tab stop, as a press on the calendar's label does. */
    focusGrid,
    /** The checked `min`, `max` and today: a date that isn't `yyyy-mm-dd` counts as not given. */
    min,
    max,
    today,
    gridProps: {
      role: 'grid' as const,
      'aria-multiselectable': mode === 'single' ? undefined : true,
      'aria-disabled': disabled ? true : undefined,
      'aria-readonly': readOnly ? true : undefined,
      'aria-invalid': invalid ? true : undefined,
      onPointerLeave: () => {
        if (anchor) setPreview(null)
      },
    },
  }
}

/** `count` months from `month`, the first one first. */
function shownFrom(month: string, count: number): string[] {
  return Array.from({ length: count }, (_, index) => shiftMonth(month, index))
}

/** The button of `date` in its own month, among the months on screen. */
function dayButton(root: HTMLElement, date: string): HTMLElement | undefined {
  return [
    ...root.querySelectorAll<HTMLElement>(`[data-date="${date}"]:not([data-outside])`),
  ].find((element) => !element.closest('[inert]'))
}

/** Whether a day of `root`'s grids has focus. */
function inGrid(root: HTMLElement): boolean {
  const active = document.activeElement
  return !!active && root.contains(active) && !!active.closest('[role=grid]')
}
