import { useSyncExternalStore } from 'react'

/*
 * Every date calculation Kino makes, in one place: plain dates as
 * `yyyy-mm-dd` and months as `yyyy-mm`, with no time and no time zone, so a
 * date means the same day everywhere. The arithmetic runs in UTC, where no
 * day is ever 23 or 25 hours long; only `today` looks at a time zone. Names
 * and labels come from `Intl`, in any language, on the Gregorian calendar.
 * Pure, so every component that works with dates shares it and it is tested
 * without a DOM.
 */

/** A day of the week, as JavaScript counts it: 0 is Sunday, 6 is Saturday. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6

/** A date as its parts; a part not known yet is null, as while it is typed. */
export interface DateFields {
  year: number | null
  month: number | null
  day: number | null
}

export const EMPTY_DATE: DateFields = { year: null, month: null, day: null }

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/
const ISO_MONTH = /^(\d{4})-(\d{2})$/

const pad = (value: number, length: number) => String(value).padStart(length, '0')

/** How many days `month` (1 to 12) has, in a leap year when the year isn't known yet. */
export function daysInMonth(month: number, year: number | null): number {
  if (month === 2) {
    const leap =
      year === null || (year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0))
    return leap ? 29 : 28
  }
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31
}

/** The date as `yyyy-mm-dd`, or null until every part holds a day that exists, from year 1 to 9999. */
export function toISODate(fields: DateFields): string | null {
  const { year, month, day } = fields
  if (year === null || month === null || day === null) return null
  if (year < 1 || year > 9999 || month < 1 || month > 12 || day < 1) return null
  if (day > daysInMonth(month, year)) return null
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`
}

/** The parts of a `yyyy-mm-dd` date, or all empty when it isn't a day that exists. */
export function fromISODate(value: string | null | undefined): DateFields {
  const match = value ? ISO_DATE.exec(value) : null
  if (!match) return EMPTY_DATE
  const fields = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  }
  return toISODate(fields) === value ? fields : EMPTY_DATE
}

/** Whether `value` is a `yyyy-mm-dd` day that exists. */
export function isISODate(value: unknown): value is string {
  return typeof value === 'string' && fromISODate(value).year !== null
}

/** Whether `value` is a `yyyy-mm` month, from 0001-01 to 9999-12. */
export function isISOMonth(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const match = ISO_MONTH.exec(value)
  return (
    match !== null &&
    Number(match[1]) >= 1 &&
    Number(match[2]) >= 1 &&
    Number(match[2]) <= 12
  )
}

/*
 * Days are counted from 1 January of year 1, in whole days. `Date.UTC` reads
 * years 0 to 99 as 1900 to 1999, so the epoch is built with `setUTCFullYear`.
 */
const DAY_MS = 86_400_000
const EPOCH = (() => {
  const date = new Date(0)
  date.setUTCFullYear(1, 0, 1)
  date.setUTCHours(0, 0, 0, 0)
  return date.getTime()
})()

function dayCount(date: string): number {
  const { year, month, day } = fromISODate(date)
  if (year === null || month === null || day === null) {
    throw new RangeError(`Not a yyyy-mm-dd date: ${date}`)
  }
  const at = new Date(0)
  at.setUTCFullYear(year, month - 1, day)
  at.setUTCHours(0, 0, 0, 0)
  return Math.round((at.getTime() - EPOCH) / DAY_MS)
}

const FIRST_DAY = 0
const LAST_DAY = dayCount('9999-12-31')

function fromDayCount(count: number): string {
  const at = new Date(EPOCH + Math.min(Math.max(count, FIRST_DAY), LAST_DAY) * DAY_MS)
  return `${pad(at.getUTCFullYear(), 4)}-${pad(at.getUTCMonth() + 1, 2)}-${pad(at.getUTCDate(), 2)}`
}

/** The date `count` days after `date` (before, when negative), held between years 1 and 9999. */
export function addDays(date: string, count: number): string {
  return fromDayCount(dayCount(date) + count)
}

/** How many days from `from` to `to`: 1 for the next day, -1 for the day before. */
export function daysBetween(from: string, to: string): number {
  return dayCount(to) - dayCount(from)
}

/** Its day of the week. */
export function weekday(date: string): Weekday {
  // 1 January of year 1 was a Monday.
  return ((((dayCount(date) + 1) % 7) + 7) % 7) as Weekday
}

/** The month a date is in, as `yyyy-mm`. */
export function monthOf(date: string): string {
  return date.slice(0, 7)
}

/** A `yyyy-mm` month as its year and its number, 1 to 12. */
export function monthParts(month: string): { year: number; month: number } {
  if (!isISOMonth(month)) throw new RangeError(`Not a yyyy-mm month: ${String(month)}`)
  return { year: Number(month.slice(0, 4)), month: Number(month.slice(5, 7)) }
}

/** The month `count` months after `month` (before, when negative), held between 0001-01 and 9999-12. */
export function shiftMonth(month: string, count: number): string {
  const parts = monthParts(month)
  const index = Math.min(
    Math.max(parts.year * 12 + parts.month - 1 + count, 12),
    9999 * 12 + 11,
  )
  return `${pad(Math.floor(index / 12), 4)}-${pad((index % 12) + 1, 2)}`
}

/** How many months from `from` to `to`, both `yyyy-mm`: 1 for the next month. */
export function monthsBetween(from: string, to: string): number {
  const a = monthParts(from)
  const b = monthParts(to)
  return (b.year - a.year) * 12 + (b.month - a.month)
}

/** The same day `count` months on, or that month's last day when it is shorter: 31 January and a month is 28 or 29 February. */
export function addMonths(date: string, count: number): string {
  const { day } = fromISODate(date)
  if (day === null) throw new RangeError(`Not a yyyy-mm-dd date: ${date}`)
  const parts = monthParts(shiftMonth(monthOf(date), count))
  const last = daysInMonth(parts.month, parts.year)
  return `${pad(parts.year, 4)}-${pad(parts.month, 2)}-${pad(Math.min(day, last), 2)}`
}

/** The same day `count` years on; 29 February becomes 28 February outside a leap year. */
export function addYears(date: string, count: number): string {
  return addMonths(date, count * 12)
}

/** The first day of a `yyyy-mm` month. */
export function firstOfMonth(month: string): string {
  monthParts(month)
  return `${month}-01`
}

/** The last day of a `yyyy-mm` month: 28 February 2026, 29 February 2028. */
export function lastOfMonth(month: string): string {
  const { year, month: number } = monthParts(month)
  return `${month}-${pad(daysInMonth(number, year), 2)}`
}

/** The first day of the week `date` is in, for weeks that start on `first`. */
export function startOfWeek(date: string, first: Weekday): string {
  return addDays(date, -((weekday(date) - first + 7) % 7))
}

/** The last day of the week `date` is in, for weeks that start on `first`. */
export function endOfWeek(date: string, first: Weekday): string {
  return addDays(startOfWeek(date, first), 6)
}

/**
 * The number of the week `date` is in, for weeks that start on `first`. A
 * week starting on Monday is numbered as ISO 8601 does: week 1 holds the
 * year's first Thursday. Any other week is numbered as in the United States:
 * week 1 holds 1 January.
 */
export function weekOfYear(date: string, first: Weekday): number {
  // How many of a week's days must fall in a year for it to be that year's.
  const fewest = first === 1 ? 4 : 1
  const start = startOfWeek(date, first)
  const year = fromISODate(addDays(start, 7 - fewest)).year ?? 1
  const opening = startOfWeek(`${pad(year, 4)}-01-01`, first)
  const firstWeek =
    fromISODate(addDays(opening, 7 - fewest)).year === year
      ? opening
      : addDays(opening, 7)
  return daysBetween(firstWeek, start) / 7 + 1
}

/**
 * The weeks a month shows, each seven dates from `first`, with the days of
 * the months either side that share its first and last week. With
 * `fixedWeeks`, always six, so every month is as tall as the next.
 */
export function monthGrid(
  month: string,
  first: Weekday,
  { fixedWeeks = false }: { fixedWeeks?: boolean } = {},
): string[][] {
  const start = startOfWeek(`${month}-01`, first)
  const { year, month: number } = monthParts(month)
  const end = endOfWeek(`${month}-${pad(daysInMonth(number, year), 2)}`, first)
  const weeks = fixedWeeks ? 6 : (daysBetween(start, end) + 1) / 7
  return Array.from({ length: weeks }, (_, week) =>
    Array.from({ length: 7 }, (_, day) => addDays(start, week * 7 + day)),
  )
}

/** The date moved inside `min` and `max`, either of which may be missing. */
export function clampDate(
  date: string,
  min?: string | null,
  max?: string | null,
): string {
  if (min && date < min) return min
  if (max && date > max) return max
  return date
}

const zoneFormats = new Map<string, Intl.DateTimeFormat>()

/**
 * The formatter that reads an instant's date or time of day in `timeZone`,
 * made once per zone: a list of notifications reads hundreds of instants.
 */
function zoneFormatter(part: 'date' | 'time', timeZone: string | undefined) {
  const key = `${part}|${timeZone ?? ''}`
  let format = zoneFormats.get(key)
  if (!format) {
    format = new Intl.DateTimeFormat(
      'en-US',
      part === 'date'
        ? {
            timeZone,
            calendar: 'gregory',
            numberingSystem: 'latn',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
          }
        : {
            timeZone,
            numberingSystem: 'latn',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hourCycle: 'h23',
          },
    )
    zoneFormats.set(key, format)
  }
  return format
}

/**
 * Today's date in `timeZone` (the visitor's own by default) at the instant
 * `now`, in milliseconds. Near midnight, two zones disagree: it is already
 * tomorrow in Auckland while it is still today in Honolulu.
 */
export function today(timeZone?: string, now: number = Date.now()): string {
  const parts = zoneFormatter('date', timeZone).formatToParts(now)
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value)
  return `${pad(value('year'), 4)}-${pad(value('month'), 2)}-${pad(value('day'), 2)}`
}

/** The browser's own locale, which a field uses when it is given none. */
export function browserLocale(): string {
  return new Intl.DateTimeFormat().resolvedOptions().locale
}

/** The browser's locale never changes while the page is open. */
const noChange = () => () => {}

/**
 * The locale a field uses: the one given, else the browser's. The server
 * can't know the browser's, so it renders en-US and the field moves to the
 * visitor's right after hydration, keeping its value, rather than failing
 * to hydrate where their clock or date order differs.
 */
export function useLocale(locale: string | undefined): string {
  const browser = useSyncExternalStore(noChange, browserLocale, () => 'en-US')
  return locale ?? browser
}

// Regions whose week doesn't start on Monday (CLDR 48's weekData), for
// engines without `Intl.Locale`'s week info, such as Firefox. A test walks
// every region and compares this with the engine's own.
const SUNDAY_REGIONS = new Set(
  'AG AS BD BR BS BT BW BZ CA CO DM DO ET GT GU HK HN ID IL IN IS JM JP KE KH KR LA MH MM MO MT MX MZ NI NP PA PE PH PK PR PT PY SA SG SV TH TT TW UM US VE VI WS YE ZA ZW'.split(
    ' ',
  ),
)
const SATURDAY_REGIONS = new Set('AF BH DJ DZ EG IQ IR JO KW LY OM QA SD SY'.split(' '))
const FRIDAY_REGIONS = new Set(['MV'])

const FW_DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

/** Where an engine keeps a locale's week: a method in most, a property in older Chromium and Safari. */
type WeekInfoLocale = Intl.Locale & {
  getWeekInfo?: () => { firstDay?: number }
  weekInfo?: { firstDay?: number }
}

/**
 * The day `locale`'s week starts on, from the tables above, for engines
 * without `Intl.Locale`'s week info: a `-u-fw-` extension's day, else its
 * region's.
 */
export function tableWeekStart(locale: string): Weekday {
  const tag = new Intl.Locale(locale)
  const named = /-u(?:-[a-z0-9]{2,8})*?-fw-([a-z]{3})(?:-|$)/i.exec(tag.toString())?.[1]
  const day = FW_DAYS.indexOf(named?.toLowerCase() ?? '')
  if (day >= 0) return day as Weekday
  const region = tag.maximize().region ?? ''
  if (SUNDAY_REGIONS.has(region)) return 0
  if (SATURDAY_REGIONS.has(region)) return 6
  if (FRIDAY_REGIONS.has(region)) return 5
  return 1
}

/**
 * The day `locale`'s week starts on: Monday in en-GB, Sunday in en-US,
 * Saturday in ar-EG, or the day a `-u-fw-` extension names.
 */
export function weekStart(locale?: string): Weekday {
  let tag: WeekInfoLocale
  try {
    tag = new Intl.Locale(locale ?? browserLocale())
  } catch {
    return 1
  }
  // 1 is Monday and 7 is Sunday here.
  const first = (tag.getWeekInfo?.() ?? tag.weekInfo)?.firstDay
  if (first !== undefined && first >= 1 && first <= 7) return (first % 7) as Weekday
  return tableWeekStart(tag.toString())
}

const formats = new Map<string, Intl.DateTimeFormat>()

function formatter(locale: string | undefined, options: Intl.DateTimeFormatOptions) {
  const key = `${locale ?? ''}|${JSON.stringify(options)}`
  let format = formats.get(key)
  if (!format) {
    format = new Intl.DateTimeFormat(locale, {
      ...options,
      calendar: 'gregory',
      timeZone: 'UTC',
    })
    formats.set(key, format)
  }
  return format
}

/**
 * The instant that formats in UTC as a date (its midnight), or as a date and
 * time (`yyyy-mm-ddTHH:mm` or `yyyy-mm-ddTHH:mm:ss`).
 */
function instant(value: string): number {
  const { date, time } = splitDateTime(value)
  if (date === null) throw new RangeError(`Not a date: ${value}`)
  const parts = time === null ? null : timeParts(time)
  const seconds = parts ? parts.hours * 3600 + parts.minutes * 60 + parts.seconds : 0
  return EPOCH + dayCount(date) * DAY_MS + seconds * 1000
}

/**
 * A date as `locale` writes it with `options` (`dateStyle: 'full'`: Friday
 * 27 November 2026), always the same day. Given a date and time
 * (`yyyy-mm-ddTHH:mm`), `options` can write its time too.
 */
export function formatDate(
  date: string,
  locale: string | undefined,
  options: Omit<Intl.DateTimeFormatOptions, 'timeZone'>,
): string {
  return formatter(locale, options).format(instant(date))
}

/** Two dates as `locale` writes a span of days, sharing what they have in common: 2–8 Nov 2026, 28 Nov – 3 Dec 2026. */
export function formatDateRange(
  start: string,
  end: string,
  locale: string | undefined,
  options: Omit<Intl.DateTimeFormatOptions, 'timeZone'>,
): string {
  return formatter(locale, options).formatRange(instant(start), instant(end))
}

/** The parts of a formatted date, as `Intl.DateTimeFormat.formatToParts` gives them. */
export function formatDateToParts(
  date: string,
  locale: string | undefined,
  options: Omit<Intl.DateTimeFormatOptions, 'timeZone'>,
): Intl.DateTimeFormatPart[] {
  return formatter(locale, options).formatToParts(instant(date))
}

/**
 * The months' names in `locale`, January first: `short` (Nov) or `long`
 * (November), as they are written inside a whole date, so Japanese gives 11
 * beside its 月.
 */
export function monthNames(locale?: string, width: 'short' | 'long' = 'short'): string[] {
  return Array.from(
    { length: 12 },
    (_, index) =>
      formatDateToParts(`2000-${pad(index + 1, 2)}-01`, locale, {
        year: 'numeric',
        month: width,
        day: '2-digit',
        numberingSystem: 'latn',
      }).find((part) => part.type === 'month')?.value ?? String(index + 1),
  )
}

/** The week's days in the order the calendar shows them, from `first`. */
export function weekdayNames(
  locale: string | undefined,
  first: Weekday,
  width: 'narrow' | 'short' | 'long' = 'short',
): string[] {
  // 2023-01-01 was a Sunday.
  return Array.from({ length: 7 }, (_, index) =>
    formatDate(`2023-01-0${((first + index) % 7) + 1}`, locale, {
      weekday: width,
    }),
  )
}

/** A month as its heading reads: November 2026, or Nov 2026 with `short`. */
export function monthLabel(
  month: string,
  locale?: string,
  width: 'long' | 'short' | 'narrow' = 'long',
): string {
  return formatDate(`${month}-01`, locale, {
    month: width,
    year: 'numeric',
    numberingSystem: 'latn',
  })
}

/** A day's number as a calendar's grid shows it: 7, in the same Latin digits as the Date input. */
export function dayLabel(date: string, locale?: string): string {
  return formatDate(date, locale, { day: 'numeric', numberingSystem: 'latn' })
}

/** A year as `locale` writes it on its own, in Latin digits: 2026, or 2026年. */
export function yearLabel(year: number, locale?: string): string {
  return formatDate(`${yearMonth(year, 1)}-01`, locale, {
    year: 'numeric',
    numberingSystem: 'latn',
  })
}

/** A month's short or long name on its own, as a picker of months shows it: Nov, or November. */
export function monthName(
  month: string,
  locale?: string,
  width: 'short' | 'long' = 'short',
): string {
  return formatDate(`${month}-01`, locale, { month: width })
}

/** The `yyyy-mm` month of `year` numbered `month`, 1 to 12. */
export function yearMonth(year: number, month: number): string {
  const value = `${pad(year, 4)}-${pad(month, 2)}`
  if (!isISOMonth(value)) throw new RangeError(`Not a month: ${year}, ${month}`)
  return value
}

/** The first of the `size` years a page of years shows around `year`, pages starting at year 1: 2017 for 2026 in twelves. */
export function yearPage(year: number, size: number): number {
  return year - ((((year - 1) % size) + size) % size)
}

/**
 * Dates that can't be picked, as data or a function: a `yyyy-mm-dd` date,
 * `{ from, to }` for the days between two, both included, `{ weekday: [0, 6] }`
 * for weekends, `{ before }` and `{ after }` (the day itself not included), a
 * function, or a list of any of these.
 */
export type DateMatcher =
  | string
  | { from: string; to: string }
  | { weekday: readonly Weekday[] }
  | { before: string }
  | { after: string }
  | ((date: string) => boolean)

export type DateMatchers = DateMatcher | readonly DateMatcher[]

/** Whether `date` is one of the dates `matchers` name. */
export function matchesDate(
  date: string,
  matchers: DateMatchers | null | undefined,
): boolean {
  if (!matchers) return false
  const list: readonly DateMatcher[] = Array.isArray(matchers) ? matchers : [matchers]
  return list.some((matcher) => {
    if (typeof matcher === 'string') return date === matcher
    if (typeof matcher === 'function') return matcher(date)
    if ('from' in matcher) return date >= matcher.from && date <= matcher.to
    if ('weekday' in matcher) return matcher.weekday.includes(weekday(date))
    if ('before' in matcher) return date < matcher.before
    return date > matcher.after
  })
}

/** A range of days, start first, both included. */
export type DateRange = readonly [start: string, end: string]

/** What a range must keep to. Lengths count both ends: a day to itself is 1 day. */
export interface RangeRules {
  minDays?: number
  maxDays?: number
  /** Lets a range hold unavailable days, which still can't be its ends. */
  allowUnavailable?: boolean
  unavailable?: DateMatchers | null
}

/** The range from two days picked in either order. */
export function orderRange(a: string, b: string): DateRange {
  return a <= b ? [a, b] : [b, a]
}

/** How many days a range covers, both ends included. */
export function rangeLength([start, end]: DateRange): number {
  return daysBetween(start, end) + 1
}

/** Whether a range keeps to `rules`. */
export function isAllowedRange(range: DateRange, rules: RangeRules): boolean {
  const [start, end] = range
  if (start > end) return false
  const length = rangeLength(range)
  if (rules.minDays !== undefined && length < rules.minDays) return false
  if (rules.maxDays !== undefined && length > rules.maxDays) return false
  if (matchesDate(start, rules.unavailable) || matchesDate(end, rules.unavailable))
    return false
  if (!rules.allowUnavailable && rules.unavailable) {
    for (let day = addDays(start, 1); day < end; day = addDays(day, 1)) {
      if (matchesDate(day, rules.unavailable)) return false
    }
  }
  return true
}

/*
 * Years, months and days as one kind of value, and times beside them. A
 * value is as fine as its granularity: a year is `yyyy`, a month `yyyy-mm`,
 * a day `yyyy-mm-dd`, and anything finer is a date and a time,
 * `yyyy-mm-ddTHH:mm` or `yyyy-mm-ddTHH:mm:ss`, as a native
 * `datetime-local` input gives it. Times are wall-clock times with no time
 * zone, as dates are: 09:30 is 09:30 wherever it is read.
 */

/** The smallest unit a date holds: a year (`yyyy`), a month (`yyyy-mm`) or a day (`yyyy-mm-dd`). */
export type DateGranularity = 'year' | 'month' | 'day'

/** The smallest unit a time holds: `HH:00`, `HH:mm` or `HH:mm:ss`. */
export type TimeGranularity = 'hour' | 'minute' | 'second'

/** The smallest unit a value holds, from a year to a second. Finer than a day, it is a date and a time. */
export type Granularity = DateGranularity | TimeGranularity

const ISO_YEAR = /^\d{4}$/

/** Whether `value` is a `yyyy` year, from 0001 to 9999. */
export function isISOYear(value: unknown): value is string {
  return typeof value === 'string' && ISO_YEAR.test(value) && Number(value) >= 1
}

/** The date part of a granularity: a day for anything finer, whose time is held apart. */
export function dateGranularity(granularity: Granularity): DateGranularity {
  return granularity === 'year' || granularity === 'month' ? granularity : 'day'
}

/** The time part of a granularity, or null for a year, a month or a day, which hold no time. */
export function timeGranularity(granularity: Granularity): TimeGranularity | null {
  return granularity === 'hour' || granularity === 'minute' || granularity === 'second'
    ? granularity
    : null
}

/**
 * A date's parts as a value of `granularity`: 2026, 2026-11 or 2026-11-14.
 * Null until it holds the parts that granularity needs, and parts that
 * exist; the parts finer than it don't count.
 */
export function toDateValue(
  fields: DateFields,
  granularity: DateGranularity,
): string | null {
  if (granularity === 'day') return toISODate(fields)
  const { year, month } = fields
  if (year === null || year < 1 || year > 9999) return null
  if (granularity === 'year') return pad(year, 4)
  if (month === null || month < 1 || month > 12) return null
  return yearMonth(year, month)
}

/** The parts of a `yyyy`, `yyyy-mm` or `yyyy-mm-dd` value; the parts it doesn't hold, or all of them when it isn't one, are null. */
export function fromDateValue(value: string | null | undefined): DateFields {
  if (isISOYear(value)) return { year: Number(value), month: null, day: null }
  if (isISOMonth(value)) {
    const { year, month } = monthParts(value)
    return { year, month, day: null }
  }
  return fromISODate(value)
}

/** The granularity a date value is written in, or null when it isn't a year, a month or a day. */
export function granularityOf(value: unknown): DateGranularity | null {
  if (isISOYear(value)) return 'year'
  if (isISOMonth(value)) return 'month'
  return isISODate(value) ? 'day' : null
}

/**
 * The first and last days a year, a month or a day covers: 2028 runs from
 * 2028-01-01 to 2028-12-31, and 2028-02 from 2028-02-01 to 2028-02-29.
 * Null when `value` isn't one of the three.
 */
export function dateSpan(value: string): DateRange | null {
  if (isISOYear(value)) return [`${value}-01-01`, `${value}-12-31`]
  if (isISOMonth(value)) return [firstOfMonth(value), lastOfMonth(value)]
  return isISODate(value) ? [value, value] : null
}

const ISO_TIME = /^(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/

/** The hours, minutes and seconds of an `HH:mm` or `HH:mm:ss` time, or null when it isn't one. */
export function timeParts(
  value: string | null | undefined,
): { hours: number; minutes: number; seconds: number } | null {
  const match = value ? ISO_TIME.exec(value) : null
  if (!match) return null
  const [hours, minutes, seconds] = [match[1], match[2], match[3] ?? '0'].map(Number)
  if (hours > 23 || minutes > 59 || seconds > 59) return null
  return { hours, minutes, seconds }
}

/** Whether `value` is an `HH:mm` or `HH:mm:ss` time of day. */
export function isISOTime(value: unknown): value is string {
  return typeof value === 'string' && timeParts(value) !== null
}

/**
 * A time of day as a value of `granularity`: `HH:mm`, with `second`
 * `HH:mm:ss`, and with `hour` `HH:00`, its minutes left at the hour.
 */
export function timeValue(
  hours: number,
  minutes: number,
  seconds: number,
  granularity: TimeGranularity = 'minute',
): string | null {
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null
  if (seconds < 0 || seconds > 59) return null
  const time = `${pad(hours, 2)}:${pad(granularity === 'hour' ? 0 : minutes, 2)}`
  return granularity === 'second' ? `${time}:${pad(seconds, 2)}` : time
}

/** A time in seconds since midnight, or null when it isn't one. */
function secondsOf(value: string): number | null {
  const time = timeParts(value)
  return time ? time.hours * 3600 + time.minutes * 60 + time.seconds : null
}

/**
 * Whether a time falls outside `min` and `max`, each `HH:mm` or `HH:mm:ss`.
 * A `min` later than `max` runs over midnight, as a native time input's
 * does: 22:00 to 06:00 is the night.
 */
export function timeOutOfRange(
  value: string | null,
  min?: string,
  max?: string,
): boolean {
  const time = value === null ? null : secondsOf(value)
  if (time === null) return false
  const from = min === undefined ? null : secondsOf(min)
  const to = max === undefined ? null : secondsOf(max)
  if (from !== null && to !== null && from > to) return time < from && time > to
  return (from !== null && time < from) || (to !== null && time > to)
}

/** The time it is now in `timeZone` (the visitor's own by default) as `HH:mm:ss`, at `now` in milliseconds. */
export function currentTime(timeZone?: string, now: number = Date.now()): string {
  const parts = zoneFormatter('time', timeZone).formatToParts(now)
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value)
  return `${pad(value('hour'), 2)}:${pad(value('minute'), 2)}:${pad(value('second'), 2)}`
}

/** A clock of 12 hours with AM and PM, or of 24. */
export type HourCycle = 12 | 24

/** The clock `locale` tells the time by: 12 hours in en-US, 24 in de-DE. */
export function localeHourCycle(locale?: string): HourCycle {
  const cycle = new Intl.DateTimeFormat(locale, {
    hour: 'numeric',
  }).resolvedOptions().hourCycle
  return cycle === 'h11' || cycle === 'h12' ? 12 : 24
}

/** What `locale` calls the morning and the afternoon on a 12-hour clock: AM and PM, 午前 and 午後. */
export function dayPeriodNames(locale?: string): [string, string] {
  const name = (time: string, fallback: string) =>
    formatDateToParts(`2000-01-01T${time}`, locale, {
      hour: 'numeric',
      hourCycle: 'h12',
    }).find((part) => part.type === 'dayPeriod')?.value ?? fallback
  return [name('01:00', 'AM'), name('13:00', 'PM')]
}

/** How `locale` writes an `HH:mm` or `HH:mm:ss` time on `hourCycle`: 9:00 AM, 09:00. Its seconds show when it has any. */
export function formatTime(
  value: string,
  locale: string | undefined,
  hourCycle: HourCycle,
): string {
  const time = timeParts(value)
  if (!time) return value
  return formatDate(`2000-01-01T${value}`, locale, {
    hour: 'numeric',
    minute: '2-digit',
    ...(time.seconds ? { second: '2-digit' } : {}),
    hourCycle: hourCycle === 12 ? 'h12' : 'h23',
  })
}

/**
 * A date and time's two halves: `2026-11-14T09:30` is the day and the time.
 * Either half can be missing while it is entered (`2026-11-14T` has no time
 * yet, `T09:30` no day); a plain date has no time. A half that isn't a day
 * or a time is null.
 */
export function splitDateTime(value: string | null | undefined): {
  date: string | null
  time: string | null
} {
  if (!value) return { date: null, time: null }
  const at = value.indexOf('T')
  const date = at === -1 ? value : value.slice(0, at)
  const time = at === -1 ? '' : value.slice(at + 1)
  return {
    date: isISODate(date) ? date : null,
    time: isISOTime(time) ? time : null,
  }
}

/**
 * A day and a time as one value, `yyyy-mm-ddTHH:mm`. With one half missing,
 * the half that is in, marked as half (`2026-11-14T` or `T09:30`); null with
 * neither.
 */
export function joinDateTime(date: string | null, time: string | null): string | null {
  if (date === null && time === null) return null
  return `${date ?? ''}T${time ?? ''}`
}

/** Whether `value` holds both a day and a time, `yyyy-mm-ddTHH:mm` or `yyyy-mm-ddTHH:mm:ss`. */
export function isISODateTime(value: string | null | undefined): boolean {
  if (!value?.includes('T')) return false
  const { date, time } = splitDateTime(value)
  return date !== null && time !== null
}

/**
 * A value of any granularity as `locale` writes it: 2026, November 2026,
 * 14 Nov 2026, or 14 Nov 2026, 09:30 with its time, and its seconds when
 * it has any. Null when it isn't
 * one. `hourCycle` sets the clock; the locale's by default.
 */
export function formatValue(
  value: string,
  locale: string | undefined,
  hourCycle?: HourCycle,
): string | null {
  if (isISOYear(value)) return yearLabel(Number(value), locale)
  if (isISOMonth(value)) return monthLabel(value, locale)
  if (isISODate(value)) return formatDate(value, locale, { dateStyle: 'medium' })
  if (!isISODateTime(value)) return null
  const seconds = timeParts(splitDateTime(value).time)?.seconds
  return formatDate(value, locale, {
    dateStyle: 'medium',
    timeStyle: seconds ? 'medium' : 'short',
    ...(hourCycle ? { hourCycle: hourCycle === 12 ? 'h12' : 'h23' } : {}),
  })
}

/** A value's first and last moments, as text that sorts in time: a year's, month's or day's first and last seconds, or a date and time's own. */
function momentsOf(value: string): [string, string] | null {
  if (isISODateTime(value)) {
    const { date, time } = splitDateTime(value)
    const parts = timeParts(time)
    if (!parts || date === null) return null
    const at = `${date}T${timeValue(parts.hours, parts.minutes, parts.seconds, 'second')}`
    return [at, at]
  }
  const span = dateSpan(value)
  return span && [`${span[0]}T00:00:00`, `${span[1]}T23:59:59`]
}

/**
 * Whether a value falls wholly before `min` or after `max`. Each can be a
 * year, a month, a day or a date and time, and they needn't match: a month
 * is in range while any of its days is, and a date and time is in range on
 * the day `max` names. A value that isn't whole is never out of range.
 */
export function outsideBounds(
  value: string | null,
  min?: string | null,
  max?: string | null,
): boolean {
  const own = value === null ? null : momentsOf(value)
  if (!own) return false
  const low = min ? momentsOf(min) : null
  const high = max ? momentsOf(max) : null
  return (low !== null && own[1] < low[0]) || (high !== null && own[0] > high[1])
}

/**
 * The first (`start`) or last (`end`) day a bound of any granularity
 * allows: 2026 starts on 2026-01-01 and ends on 2026-12-31, and a date and
 * time allows its own day. Undefined when it isn't a year, a month, a day or
 * a date and time.
 */
export function boundDay(
  value: string | null | undefined,
  side: 'start' | 'end',
): string | undefined {
  if (!value) return undefined
  const day = splitDateTime(value).date
  const span = isISODateTime(value) && day ? dateSpan(day) : dateSpan(value)
  return span ? span[side === 'start' ? 0 : 1] : undefined
}

/*
 * Instants: a moment, such as when a notification was sent, written as an
 * ISO instant (`2026-11-17T09:42:00Z`) or as milliseconds. They are read
 * on the wall clock of a time zone, the visitor's own by default.
 */

/** An instant in milliseconds. */
function instantTime(instant: string | number): number {
  const time = typeof instant === 'number' ? instant : Date.parse(instant)
  if (Number.isNaN(time)) throw new RangeError(`Not an instant: ${instant}`)
  return time
}

/** A moment in milliseconds as an ISO instant: `2026-11-17T09:42:00.000Z`. */
export function isoInstant(time: number): string {
  return new Date(instantTime(time)).toISOString()
}

/** Which of two instants comes first, for sorting: negative when `a` does. */
export function compareInstants(a: string | number, b: string | number): number {
  return instantTime(a) - instantTime(b)
}

/** An instant as the wall clock in `timeZone` reads it: `2026-11-17T09:42:00`. */
export function wallClock(instant: string | number, timeZone?: string): string {
  const time = instantTime(instant)
  return `${today(timeZone, time)}T${currentTime(timeZone, time)}`
}

const relativeFormats = new Map<string, Intl.RelativeTimeFormat>()

/** Words for a time before or after now, as `locale` writes them, made once each. */
function relativeFormatter(locale: string | undefined, style: 'long' | 'narrow') {
  const key = `${locale ?? ''}|${style}`
  let format = relativeFormats.get(key)
  if (!format) {
    format = new Intl.RelativeTimeFormat(locale, { style, numeric: 'auto' })
    relativeFormats.set(key, format)
  }
  return format
}

/** The first letter as `locale` writes it at the start of a heading: yesterday becomes Yesterday. */
function capitalise(text: string, locale: string | undefined): string {
  return text.charAt(0).toLocaleUpperCase(locale) + text.slice(1)
}

/**
 * A day as a list of what happened heads it, seen from `now` (both
 * `yyyy-mm-dd`): Today, Yesterday, the weekday for the rest of the last
 * week, then the date, with its year once it isn't this year's. A day after
 * `now`, from a clock that runs ahead, is Today.
 */
export function dayHeading(date: string, now: string, locale?: string): string {
  const ago = daysBetween(date, now)
  if (ago <= 1) {
    const words = relativeFormatter(locale, 'long')
    return capitalise(words.format(-Math.max(0, ago), 'day'), locale)
  }
  if (ago < 7) return capitalise(formatDate(date, locale, { weekday: 'long' }), locale)
  return formatDate(date, locale, {
    day: 'numeric',
    month: 'short',
    ...(date.slice(0, 4) === now.slice(0, 4) ? {} : { year: 'numeric' }),
  })
}

/**
 * How long ago `instant` was at `now`, in a word or two: now, 5m ago, 2h ago,
 * as `locale` writes it narrow. Null once it was a day or more ago, when a
 * clock time reads better.
 */
export function timeAgo(
  instant: string | number,
  now: number,
  locale?: string,
): string | null {
  const seconds = Math.max(0, (now - instantTime(instant)) / 1000)
  const words = relativeFormatter(locale, 'narrow')
  if (seconds < 60) return words.format(0, 'second')
  if (seconds < 3600) return words.format(-Math.floor(seconds / 60), 'minute')
  if (seconds < 86_400) return words.format(-Math.floor(seconds / 3600), 'hour')
  return null
}

/** The time of day `instant` falls on in `timeZone`, as `locale` tells it: 2:05 PM, 14:05. */
export function clockTime(
  instant: string | number,
  locale?: string,
  timeZone?: string,
): string {
  const time = wallClock(instant, timeZone).slice(11, 16)
  return formatTime(time, locale, localeHourCycle(locale))
}

/** `instant` in full on `timeZone`'s wall clock: 17 Nov 2026, 09:42. */
export function instantLabel(
  instant: string | number,
  locale?: string,
  timeZone?: string,
): string {
  return formatDate(wallClock(instant, timeZone).slice(0, 16), locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}
