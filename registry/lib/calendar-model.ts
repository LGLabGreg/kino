import {
  monthName,
  monthOf,
  monthParts,
  monthsBetween,
  shiftMonth,
  yearLabel,
  yearMonth,
} from '@/registry/lib/dates'

/*
 * What the Calendar decides around ui-sdk's, as pure functions of plain
 * values: the pages of months and years its heading opens, where a month
 * picked there puts the months on screen, which way they travel, and which
 * days several picks have no room left for. The dates themselves are worked
 * out in `registry/lib/dates.ts`.
 */

/** The first and last days that can be picked, as `yyyy-mm-dd`. */
export interface CalendarBounds {
  min?: string
  max?: string
}

/**
 * The days a multiple pick has no room left for once `maxDays` are picked:
 * every day not picked, so a picked one can still be taken out. Null while
 * there is room, or with no limit.
 */
export function fullDays(
  picked: readonly string[],
  maxDays: number | undefined,
): ((date: string) => boolean) | null {
  if (maxDays === undefined || picked.length < maxDays) return null
  return (date) => !picked.includes(date)
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
  rules: CalendarBounds,
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
  rules: CalendarBounds,
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
  rules: CalendarBounds,
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
function yearBounds(rules: CalendarBounds) {
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
  rules: CalendarBounds,
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
    rules: CalendarBounds
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

/** Which way the months moved from `from` to `to`: 1 forward, -1 back, and `last` when there is nothing to compare. */
export function travelTrend(
  from: string | null,
  to: string | null,
  last: 1 | -1,
): 1 | -1 {
  if (!from || !to || from === to) return last
  return monthsBetween(from, to) < 0 ? -1 : 1
}
