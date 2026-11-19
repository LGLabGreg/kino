import {
  addDays,
  addMonths,
  addYears,
  clampDate,
  type DateMatchers,
  type DateRange,
  endOfWeek,
  isAllowedRange,
  isISODate,
  matchesDate,
  monthName,
  monthOf,
  monthParts,
  monthsBetween,
  shiftMonth,
  startOfWeek,
  type Weekday,
  yearLabel,
  yearMonth,
} from '@/registry/lib/dates'

/*
 * What a calendar decides, as pure functions of plain values, whatever it
 * looks like: what a press picks in each mode, where a key sends focus, and
 * how each day is marked. The dates themselves are worked out in
 * `registry/lib/dates.ts`.
 */

/** One day, any number of days, or a range from a start to an end. */
export type CalendarMode = 'single' | 'multiple' | 'range'

/** A calendar's value in each mode: a date, a sorted list of dates, or a range. Null when nothing is picked. */
export type CalendarValue<Mode extends CalendarMode = CalendarMode> =
  Mode extends 'multiple'
    ? string[]
    : Mode extends 'range'
      ? DateRange | null
      : string | null

/** The rules a calendar picks by. */
export interface CalendarRules {
  mode: CalendarMode
  /** The earliest day that can be picked or focused, as `yyyy-mm-dd`. */
  min?: string | null
  /** The latest day that can be picked or focused. */
  max?: string | null
  /** Days that can't be picked; they can still be focused. */
  unavailable?: DateMatchers | null
  /** Lets a range hold unavailable days, which still can't be its ends. */
  allowUnavailable?: boolean
  /** A range's fewest days, both ends counted; in multiple mode, the fewest days picked. */
  minDays?: number
  /** A range's most days, both ends counted; in multiple mode, the most days picked. */
  maxDays?: number
  /** A press on the picked day, in single mode, clears it. */
  deselectable?: boolean
}

/** What the calendar holds: the value, and in range mode the start picked before its end. */
export interface PickState<Mode extends CalendarMode = CalendarMode> {
  value: CalendarValue<Mode>
  /** The first day of a range still to finish, or null. */
  anchor: string | null
}

/** The value in the shape its mode needs, so a value of the wrong shape counts as nothing picked. */
export function normalizeValue(mode: CalendarMode, value: unknown): CalendarValue {
  const dates = (typeof value === 'string' ? [value] : Array.isArray(value) ? value : [])
    .filter(isISODate)
    .sort()
  if (mode === 'multiple') return [...new Set(dates)]
  if (mode === 'range') return dates.length === 2 ? [dates[0], dates[1]] : null
  return typeof value === 'string' ? (dates[0] ?? null) : null
}

/** Whether `date` sits outside `min` and `max`, where it can be neither picked nor focused. */
export function outOfBounds(
  date: string,
  rules: Pick<CalendarRules, 'min' | 'max'>,
): boolean {
  return (!!rules.min && date < rules.min) || (!!rules.max && date > rules.max)
}

/**
 * The days a range started on `anchor` can end on, up to `through`: from
 * `first` to `last`, less the unavailable days. Worked out once, so marking
 * each day is a comparison and never a walk from the start.
 */
export interface RangeEnds {
  first: string
  last: string
}

/**
 * Where a range from `anchor` can end, as far as `through`, the last day on
 * screen: at least `minDays` on, at most `maxDays` on and inside `max`, and,
 * unless the range may hold unavailable days, before the first one after
 * the start.
 */
export function rangeEnds(
  anchor: string,
  rules: CalendarRules,
  through: string,
): RangeEnds {
  const first = addDays(anchor, Math.max(rules.minDays ?? 1, 1) - 1)
  let last = through
  if (rules.maxDays !== undefined)
    last = minDate(last, addDays(anchor, rules.maxDays - 1))
  if (rules.max) last = minDate(last, rules.max)
  if (!rules.allowUnavailable && rules.unavailable) {
    for (let day = addDays(anchor, 1); day <= last; day = addDays(day, 1)) {
      if (matchesDate(day, rules.unavailable)) {
        last = addDays(day, -1)
        break
      }
    }
  }
  return { first, last }
}

function minDate(a: string, b: string) {
  return a < b ? a : b
}

/**
 * Whether a press on `date` can pick it: inside the bounds and available,
 * and, while a range waits for its end, either a day that ends a range the
 * rules allow or a day before the start, which starts the range again.
 * `ends` is `rangeEnds` for the anchor, when it is already known.
 */
export function isPickable(
  date: string,
  anchor: string | null,
  rules: CalendarRules,
  ends?: RangeEnds,
): boolean {
  if (outOfBounds(date, rules) || matchesDate(date, rules.unavailable)) return false
  if (rules.mode !== 'range' || anchor === null || date < anchor) return true
  if (!ends) return isAllowedRange([anchor, date], rules)
  return date >= ends.first && date <= ends.last
}

/**
 * Whether, in multiple mode, a press on `date` would pick more days than
 * `maxDays` or leave fewer than `minDays`.
 */
export function atCount(date: string, state: PickState, rules: CalendarRules): boolean {
  if (rules.mode !== 'multiple') return false
  const dates = (state.value as string[] | null) ?? []
  return dates.includes(date)
    ? rules.minDays !== undefined && dates.length <= rules.minDays
    : rules.maxDays !== undefined && dates.length >= rules.maxDays
}

/**
 * What a press on `date` leaves the calendar holding. Single mode picks the
 * day (and clears it with `deselectable`); multiple mode adds it or takes it
 * out; range mode starts a range on the first press and ends it on the
 * second, where a day before the start becomes the new start. A day that
 * can't be picked changes nothing.
 */
export function pick(state: PickState, date: string, rules: CalendarRules): PickState {
  if (!isPickable(date, state.anchor, rules) || atCount(date, state, rules)) return state
  switch (rules.mode) {
    case 'single':
      return {
        value: state.value === date && rules.deselectable ? null : date,
        anchor: null,
      }
    case 'multiple': {
      const dates = (state.value as string[] | null) ?? []
      return {
        value: dates.includes(date)
          ? dates.filter((picked) => picked !== date)
          : [...dates, date].sort(),
        anchor: null,
      }
    }
    case 'range':
      if (state.anchor === null || date < state.anchor)
        return { value: state.value, anchor: date }
      return { value: [state.anchor, date], anchor: null }
  }
}

/**
 * Where a key sends focus from `date`, by the WAI-ARIA date grid: the arrows
 * a day or a week (left and right swapped in right to left), Home and End
 * the week's ends, Page Up and Page Down a month, and with Shift a year,
 * held inside `min` and `max`. Null for a key the grid doesn't handle.
 */
export function keyTarget(
  date: string,
  key: string,
  options: { shift?: boolean; rtl?: boolean; first: Weekday } & Pick<
    CalendarRules,
    'min' | 'max'
  >,
): string | null {
  const { shift = false, rtl = false, first } = options
  const side = rtl ? -1 : 1
  let target: string
  switch (key) {
    case 'ArrowLeft':
      target = addDays(date, -side)
      break
    case 'ArrowRight':
      target = addDays(date, side)
      break
    case 'ArrowUp':
      target = addDays(date, -7)
      break
    case 'ArrowDown':
      target = addDays(date, 7)
      break
    case 'Home':
      target = startOfWeek(date, first)
      break
    case 'End':
      target = endOfWeek(date, first)
      break
    case 'PageUp':
      target = shift ? addYears(date, -1) : addMonths(date, -1)
      break
    case 'PageDown':
      target = shift ? addYears(date, 1) : addMonths(date, 1)
      break
    default:
      return null
  }
  return clampDate(target, options.min, options.max)
}

/**
 * The first month shown after the previous or next button moves `step`
 * months from `month`, with `count` months on screen: held so that no month
 * on screen lies wholly before `min` or after `max`. Null when it can't move
 * that way at all.
 */
export function pageTarget(
  month: string,
  step: number,
  count: number,
  rules: Pick<CalendarRules, 'min' | 'max'>,
): string | null {
  let target = shiftMonth(month, step)
  const lowest = rules.min ? monthOf(rules.min) : null
  const highest = rules.max ? shiftMonth(monthOf(rules.max), -(count - 1)) : null
  if (highest !== null && target > highest) target = highest
  if (lowest !== null && target < lowest) target = lowest
  if (step < 0 ? target >= month : target <= month) return null
  return target
}

/**
 * The first month on screen so that the month at `offset` (0 for the first
 * of `count`) is `target`, held as paging holds it: no month on screen lies
 * wholly before `min` or after `max`, so near an end `target` shows in
 * another place.
 */
export function firstShownFor(
  target: string,
  offset: number,
  count: number,
  rules: Pick<CalendarRules, 'min' | 'max'>,
): string {
  let first = shiftMonth(target, -offset)
  const lowest = rules.min ? monthOf(rules.min) : null
  const highest = rules.max ? shiftMonth(monthOf(rules.max), -(count - 1)) : null
  if (highest !== null && first > highest) first = highest
  if (lowest !== null && first < lowest) first = lowest
  return first
}

/** A month or year to choose from, as a picker of months or years lists it. */
export interface CalendarChoice {
  /** The month as `yyyy-mm`, or the year as its number. */
  value: string
  label: string
  /** Wholly before `min` or after `max`, or outside years 1 to 9999. */
  disabled: boolean
}

/** The twelve months of `year`, named in `locale`. */
export function monthChoices(
  year: number,
  rules: Pick<CalendarRules, 'min' | 'max'>,
  locale: string,
): CalendarChoice[] {
  // A year before 1 or after 9999 has no months to name or choose.
  if (year < 1 || year > 9999)
    return Array.from({ length: 12 }, (_, index) => ({
      value: `${year}:${index + 1}`,
      label: '',
      disabled: true,
    }))
  return Array.from({ length: 12 }, (_, index) => {
    const value = yearMonth(year, index + 1)
    return {
      value,
      label: monthName(value, locale, 'short'),
      disabled:
        (!!rules.min && value < monthOf(rules.min)) ||
        (!!rules.max && value > monthOf(rules.max)),
    }
  })
}

/** `count` years from `from`, written in `locale`; a year outside 1 to 9999 has no name and can't be chosen. */
export function yearChoices(
  from: number,
  count: number,
  rules: Pick<CalendarRules, 'min' | 'max'>,
  locale: string,
): CalendarChoice[] {
  const lowest = rules.min ? monthParts(monthOf(rules.min)).year : 1
  const highest = rules.max ? monthParts(monthOf(rules.max)).year : 9999
  return Array.from({ length: count }, (_, index) => {
    const year = from + index
    const real = year >= 1 && year <= 9999
    return {
      value: String(year),
      label: real ? yearLabel(year, locale) : '',
      disabled: !real || year < lowest || year > highest,
    }
  })
}

/** A picker of months shows a year's twelve; a picker of years, twelve years. */
export type ChoiceLevel = 'months' | 'years'

/** How many months or years a page of choices holds. */
export const CHOICES = 12

/** The first and last years that hold a day between `min` and `max`, within years 1 to 9999. */
function yearBounds(rules: Pick<CalendarRules, 'min' | 'max'>) {
  return {
    lowest: Math.max(1, rules.min ? monthParts(monthOf(rules.min)).year : 1),
    highest: Math.min(9999, rules.max ? monthParts(monthOf(rules.max)).year : 9999),
  }
}

/**
 * The page of choices `direction` from the one at `start` (a year, or the
 * first of twelve years), or null when it holds nothing that can be chosen,
 * so the arrows and keys never land on a page of faded choices.
 */
export function choicePageTurn(
  level: ChoiceLevel,
  start: number,
  direction: 1 | -1,
  rules: Pick<CalendarRules, 'min' | 'max'>,
): number | null {
  const next = start + direction * (level === 'months' ? 1 : CHOICES)
  const last = level === 'months' ? next : next + CHOICES - 1
  const { lowest, highest } = yearBounds(rules)
  return next <= highest && last >= lowest ? next : null
}

/** What a picker of months or years shows on the page at `start`, around the month `shown`, if any. */
export interface ChoicePage {
  choices: CalendarChoice[]
  /** The year, or the first and last of the twelve. */
  title: string
  /** The index of `shown`'s month or year, or -1. */
  current: number
  /** The index of today's month or year, or -1. */
  today: number
  /** The pages either side, or null where there is nothing to choose. */
  previous: number | null
  next: number | null
}

export function choicePage(
  level: ChoiceLevel,
  start: number,
  {
    shown,
    today,
    rules,
    locale,
  }: {
    shown: string | null
    today: string | null
    rules: Pick<CalendarRules, 'min' | 'max'>
    locale: string
  },
): ChoicePage {
  const name = (year: number) => (year < 1 || year > 9999 ? '' : yearLabel(year, locale))
  const at = shown ? monthParts(shown) : null
  const now = today ? monthParts(monthOf(today)) : null
  const index = (target: { year: number; month: number } | null) => {
    if (!target) return -1
    if (level === 'months') return target.year === start ? target.month - 1 : -1
    const offset = target.year - start
    return offset >= 0 && offset < CHOICES ? offset : -1
  }
  return {
    choices:
      level === 'months'
        ? monthChoices(start, rules, locale)
        : yearChoices(start, CHOICES, rules, locale),
    title:
      level === 'months'
        ? name(start)
        : [name(Math.max(start, 1)), name(Math.min(start + CHOICES - 1, 9999))]
            .filter(Boolean)
            .join(' – '),
    current: index(at),
    today: index(now),
    previous: choicePageTurn(level, start, -1, rules),
    next: choicePageTurn(level, start, 1, rules),
  }
}

/** How a day is marked. */
export interface DayMarks {
  selected: boolean
  rangeStart: boolean
  rangeMiddle: boolean
  rangeEnd: boolean
  /** In the range the pointer or focus previews, before its end is picked. */
  preview: boolean
  unavailable: boolean
  /** Can't be pressed: out of bounds, unavailable, or no end for the range being picked. */
  disabled: boolean
}

/**
 * How `date` is marked, given the value, the start of a range still to
 * finish, and `preview`, the day the pointer or focus is on: while the
 * range waits for its end, the days from the start to the preview show as
 * the range it would make.
 */
export function dayMarks(
  date: string,
  state: PickState,
  rules: CalendarRules,
  preview: string | null = null,
  ends?: RangeEnds,
): DayMarks {
  const unavailable = matchesDate(date, rules.unavailable)
  const disabled =
    !isPickable(date, state.anchor, rules, ends) || atCount(date, state, rules)
  const marks = {
    selected: false,
    rangeStart: false,
    rangeMiddle: false,
    rangeEnd: false,
    preview: false,
    unavailable,
    disabled,
  }
  if (rules.mode === 'single') return { ...marks, selected: state.value === date }
  if (rules.mode === 'multiple') {
    return {
      ...marks,
      selected: ((state.value as string[] | null) ?? []).includes(date),
    }
  }
  if (state.anchor !== null) {
    const end =
      preview !== null &&
      preview > state.anchor &&
      isPickable(preview, state.anchor, rules, ends)
        ? preview
        : state.anchor
    if (date < state.anchor || date > end) return marks
    return {
      ...marks,
      selected: date === state.anchor,
      rangeStart: date === state.anchor,
      rangeEnd: date === end,
      rangeMiddle: date > state.anchor && date < end,
      preview: date > state.anchor,
    }
  }
  const range = state.value as DateRange | null
  if (!range || date < range[0] || date > range[1]) return marks
  return {
    ...marks,
    selected: date === range[0] || date === range[1],
    rangeStart: date === range[0],
    rangeEnd: date === range[1],
    rangeMiddle: date > range[0] && date < range[1],
  }
}

/** The days a value picks, sorted: one, several, or a range's two ends. */
export function pickedDates(value: CalendarValue): string[] {
  if (value === null) return []
  return typeof value === 'string' ? [value] : [...value]
}

/**
 * The day that takes focus when Tab reaches the grid: the first picked day
 * on screen, else today if it shows, else the first day of the months shown
 * that isn't out of bounds.
 */
export function tabStop(
  shown: readonly string[],
  picked: readonly string[],
  today: string | null,
  rules: Pick<CalendarRules, 'min' | 'max'>,
): string {
  const onScreen = (date: string) =>
    shown.includes(monthOf(date)) && !outOfBounds(date, rules)
  const choice = [...picked, today].find(
    (date): date is string => date !== null && onScreen(date),
  )
  if (choice) return choice
  return clampDate(`${shown[0]}-01`, rules.min, rules.max)
}

/** The first month to show so `date` is on screen among `shown`, turning as few months as it takes; null when it already shows. */
export function revealing(date: string, shown: readonly string[]): string | null {
  if (!shown.length) return null
  const at = monthOf(date)
  if (at < shown[0]) return at
  if (at > shown[shown.length - 1]) return shiftMonth(at, -(shown.length - 1))
  return null
}

/** Whether `month`'s grid leaves `date`, a day of the month either side, empty: outside days are off, or that month shows beside it. */
export function hiddenOutside(
  date: string,
  month: string,
  shown: readonly string[],
  showOutsideDays: boolean,
): boolean {
  const own = monthOf(date)
  return own !== month && (!showOutsideDays || shown.includes(own))
}

/** Which way the months moved from `from` to `to`: 1 forward, -1 back, and `last` when there is nothing to compare. */
export function travelTrend(
  from: string | null,
  to: string | null,
  last: 1 | -1,
): 1 | -1 {
  if (!from || !to || from === to) return last
  return monthsBetween(from, to) < 0 ? -1 : 1
}
