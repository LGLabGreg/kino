import {
  browserLocale,
  currentTime,
  type DateFields,
  type DateGranularity,
  dayPeriodNames,
  daysInMonth,
  EMPTY_DATE,
  formatDateToParts,
  formatTime,
  formatValue,
  fromDateValue,
  fromISODate,
  type HourCycle,
  isISODateTime,
  joinDateTime,
  localeHourCycle,
  monthNames,
  outsideBounds,
  splitDateTime,
  type TimeGranularity,
  timeOutOfRange,
  timeParts,
  timeValue,
  today,
  toDateValue,
} from '@/registry/lib/dates'

/*
 * The arithmetic of a field typed one segment at a time, such as a date's
 * day, month and year or a time's hour and minute: the locale's order, what
 * each digit does, stepping, and the value it adds up to. Pure, so the Date
 * input, the Time input and the Date picker's field share it and it is
 * tested without a DOM.
 */

export type DateSegmentType = 'day' | 'month' | 'year'
export type TimeSegmentType = 'hour' | 'minute' | 'second' | 'dayPeriod'
export type SegmentType = DateSegmentType | TimeSegmentType

/**
 * One piece of the field, in the order the locale reads it: a segment, or
 * the text between two. `lead` shows it before the rest of the row, where
 * the order on screen differs from the order it is read in.
 */
export type SegmentPart<Type extends SegmentType = SegmentType> =
  | { type: Type; lead?: boolean }
  | { type: 'literal'; text: string; lead?: boolean }

export type DatePart = SegmentPart<DateSegmentType>

/** What a field's segments hold, by segment; a segment not filled yet is null. */
export type Fields = Partial<Record<SegmentType, number | null>>

const FORMAT: Omit<Intl.DateTimeFormatOptions, 'timeZone'> = {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  numberingSystem: 'latn',
}

// Marks that set the direction of the text around them, which Arabic puts in its separators.
const BIDI_MARKS = /[‎‏؜]/g

/**
 * A separator as the field shows it: without direction marks, and with
 * plain spaces, as engines differ on the narrow space before AM, which
 * would make the server's text differ from the browser's.
 */
const separator = (text: string) => text.replace(BIDI_MARKS, '').replace(/\s/gu, ' ')

/**
 * The segments and separators in the order `locale` writes a date:
 * month/day/year in en-US, day.month.year in de. With the month's `short`
 * name, the order and spacing of a written date: Nov 14, 2026 in en-US.
 * To the month, month/year (11/2026); to the year, the year alone.
 */
export function dateLayout(
  locale?: string,
  month: 'numeric' | 'short' = 'numeric',
  granularity: DateGranularity = 'day',
): DatePart[] {
  const options: Omit<Intl.DateTimeFormatOptions, 'timeZone'> = {
    ...FORMAT,
    month: granularity === 'year' ? undefined : month === 'short' ? month : '2-digit',
    day: granularity === 'day' ? '2-digit' : undefined,
  }
  const parts = formatDateToParts('2000-01-01', locale, options)
  const layout: DatePart[] = []
  for (const part of parts) {
    if (part.type === 'day' || part.type === 'month' || part.type === 'year') {
      layout.push({ type: part.type })
    } else {
      const text = separator(part.value)
      if (text) layout.push({ type: 'literal', text })
    }
  }
  return layout
}

const LATIN_LETTER: Record<DateSegmentType, string> = {
  day: 'd',
  month: 'm',
  year: 'y',
}

const isDateSegment = (type: SegmentType): type is DateSegmentType =>
  type === 'day' || type === 'month' || type === 'year'

/**
 * What an empty segment shows. A date's segment shows the first letter of
 * its name in the locale, once for each digit (`tt` and `jjjj` in German);
 * a script without capitals, such as Japanese or Hebrew, takes the Latin
 * letters. A time's shows dashes, as the hour and the second share a first
 * letter in many languages (Stunde and Sekunde).
 */
export function segmentPlaceholder(type: SegmentType, locale?: string): string {
  if (!isDateSegment(type)) return '––'
  let letter = LATIN_LETTER[type]
  try {
    const name = new Intl.DisplayNames(locale, { type: 'dateTimeField' }).of(type)
    const code = name?.codePointAt(0)
    const first = code === undefined ? undefined : String.fromCodePoint(code)
    if (first && first.toLocaleUpperCase(locale) !== first.toLocaleLowerCase(locale)) {
      letter = first.toLocaleLowerCase(locale)
    }
  } catch {
    // An engine without dateTimeField names keeps the Latin letters.
  }
  return letter.repeat(type === 'year' ? 4 : 2)
}

/**
 * The smallest and largest value a segment takes, given what the others
 * hold. On a 12-hour clock the hour runs 1 to 12, and AM is 0 and PM 1.
 */
export function segmentRange(
  type: SegmentType,
  fields: Fields,
  hourCycle: HourCycle = 24,
): { min: number; max: number } {
  switch (type) {
    case 'year':
      return { min: 1, max: 9999 }
    case 'month':
      return { min: 1, max: 12 }
    case 'day':
      return {
        min: 1,
        max: fields.month ? daysInMonth(fields.month, fields.year ?? null) : 31,
      }
    case 'hour':
      return hourCycle === 12 ? { min: 1, max: 12 } : { min: 0, max: 23 }
    case 'minute':
    case 'second':
      return { min: 0, max: 59 }
    case 'dayPeriod':
      return { min: 0, max: 1 }
  }
}

/** How many digits each segment takes; AM and PM are typed as letters. */
export const DIGITS: Record<SegmentType, number> = {
  day: 2,
  month: 2,
  year: 4,
  hour: 2,
  minute: 2,
  second: 2,
  dayPeriod: 0,
}

/** What a segment holds while typed into: its digits so far, and the value they make. */
export interface Entry {
  /** The digits typed so far, as shown. */
  text: string
  value: number | null
}

/**
 * The segment after `digit` is typed into what it holds (`text`). A digit
 * that would go past the segment's largest value starts it again. It moves
 * on (`advance`) once no further digit could fit: month 4 at once, month 1
 * only after its second digit.
 */
export function typeDigit(
  type: SegmentType,
  text: string,
  digit: string,
  fields: Fields,
  hourCycle?: HourCycle,
): Entry & { advance: boolean } {
  const { min, max } = segmentRange(type, fields, hourCycle)
  let next = text.length >= DIGITS[type] ? digit : text + digit
  if (Number(next) > max) next = digit
  // A second 0 in front adds nothing where 0 isn't a value: 00 is no day or month, but 00 minutes is.
  if (type !== 'year' && min > 0 && Number(next) === 0 && next.length > 1) next = '0'
  const value = Number(next) >= min ? Number(next) : null
  const advance =
    next.length >= DIGITS[type] || (value !== null && Number(next + '0') > max)
  return { text: next, value, advance }
}

/**
 * Whether the digits typed into a segment could still take another: a 1
 * on its way to 10, a year of 20 on its way to 2026. Until they can't, or
 * the segment is left, they aren't a value yet, so the field neither
 * changes nor turns invalid for a number nobody meant (1:15 on the way to
 * 10:15).
 */
export function awaitsDigit(
  type: SegmentType,
  text: string,
  fields: Fields,
  hourCycle?: HourCycle,
): boolean {
  if (!/^\d+$/.test(text) || text.length >= DIGITS[type]) return false
  return Number(text + '0') <= segmentRange(type, fields, hourCycle).max
}

/**
 * The segment after Backspace: its last digit goes, and with the last one,
 * its value. What is left counts once it reaches the segment's smallest
 * value (`min`): a 0 left of 07 is no month, but it is 0 minutes.
 */
export function deleteDigit(text: string, min = 1): Entry {
  const next = text.slice(0, -1)
  return {
    text: next,
    value: next && Number(next) >= min ? Number(next) : null,
  }
}

/** How far each key moves a segment. */
export const STEPS: Record<'arrow' | 'page', Record<SegmentType, number>> = {
  arrow: {
    day: 1,
    month: 1,
    year: 1,
    hour: 1,
    minute: 1,
    second: 1,
    dayPeriod: 1,
  },
  page: {
    day: 7,
    month: 3,
    year: 5,
    hour: 2,
    minute: 15,
    second: 15,
    dayPeriod: 1,
  },
}

/**
 * The value after stepping by `delta` from `value`. Every segment but the
 * year wraps around (December to January, 59 minutes to 0, 12 to 1 within
 * AM or PM); a year stops at its ends. An empty segment starts from `from`,
 * the segment's value today or now.
 */
export function stepSegment(
  type: SegmentType,
  value: number | null,
  delta: number,
  fields: Fields,
  from: number,
  hourCycle?: HourCycle,
): number {
  const { min, max } = segmentRange(type, fields, hourCycle)
  const clamp = (n: number) => Math.min(Math.max(n, min), max)
  if (value === null) return clamp(from)
  if (type === 'year') return clamp(value + delta)
  // A day past its month's end (31 in February) steps from the month's last day.
  const start = clamp(value)
  const span = max - min + 1
  return ((((start - min + delta) % span) + span) % span) + min
}

/**
 * A year typed with one or two digits, read as the year that ends in them
 * nearest to `now`, from 80 years before it to 19 after: 85 is 1985 and 30
 * is 2030 in 2026. A year of three or four digits is the year it says.
 */
export function expandYear(text: string, now: number): number | null {
  if (!text || Number(text) === 0) return null
  if (text.length > 2) return Number(text)
  const ending = Number(text)
  const century = Math.floor(now / 100) * 100
  const candidates = [century - 100, century, century + 100].map((c) => c + ending)
  return (
    candidates.find((year) => year > now - 81 && year <= now + 19) ?? century + ending
  )
}

/** A day past the end of its month (31 February) moves to the month's last day. */
export function constrainDay(fields: DateFields): DateFields {
  if (fields.day === null || fields.month === null) return fields
  const last = daysInMonth(fields.month, fields.year)
  return fields.day > last ? { ...fields, day: last } : fields
}

const pad = (value: number, length: number) => String(value).padStart(length, '0')

/**
 * The date in pasted text: `yyyy-mm-dd`, or its numbers in the field's own
 * order (14/11/2026 where the day comes first). Given the months' `names`,
 * a written date too: 14 Nov 2026, or Sat 14 November 2026. Digits of any
 * script count. Null when it isn't a date.
 */
export function parseDate(
  text: string,
  layout: DatePart[],
  now: number,
  names?: readonly string[],
  granularity: DateGranularity = 'day',
): DateFields | null {
  const trimmed = latinDigits(text.trim())
  const iso = fromDateValue(trimmed)
  if (toDateValue(iso, granularity) !== null) return iso
  const numbers = trimmed.split(/[^\d]+/).filter(Boolean)
  let order = layout.flatMap((part) => (part.type === 'literal' ? [] : [part.type]))
  const fields: DateFields = { ...EMPTY_DATE }
  if (names) {
    // A word that a month's short name starts (No for Nov), or one that starts with it (November).
    const month = trimmed
      .split(/[^\p{L}]+/u)
      .filter(Boolean)
      .map((word) => {
        const typed = matchName(word, names)
        if (typed?.unique) return typed.index + 1
        const longer = names.flatMap((name, index) =>
          fold(word).startsWith(fold(name).replace(/\.$/, '')) ? [index + 1] : [],
        )
        return longer.length === 1 ? longer[0] : null
      })
      .find((match) => match !== null)
    if (month) {
      fields.month = month
      order = order.filter((type) => type !== 'month')
    }
  }
  if (numbers.length !== order.length) return null
  order.forEach((type, index) => {
    const number = numbers[index]
    fields[type] = type === 'year' ? expandYear(number, now) : Number(number)
  })
  return toDateValue(fields, granularity) ? fields : null
}

/**
 * The value of a decimal digit of any script (٤ and ४ are 4), or null for
 * anything else. Unicode keeps each script's digits in runs of ten from
 * zero, and a few blocks hold several runs side by side, so the value is how
 * far the digit sits into its block, counted in tens.
 */
export function digitValue(char: string): number | null {
  const code = char.codePointAt(0)
  if (code === undefined || !/^\p{Nd}$/u.test(char)) return null
  let back = 0
  while (/\p{Nd}/u.test(String.fromCodePoint(code - back - 1))) back++
  return back % 10
}

/** Text with every decimal digit written as 0 to 9. */
export function latinDigits(text: string): string {
  return text.replace(/\p{Nd}/gu, (char) => String(digitValue(char) ?? char))
}

/** The segment's name in `locale` (Tag, mois, Stunde), for screen readers; English where the engine has none. */
export function segmentName(type: SegmentType, locale?: string): string {
  try {
    return new Intl.DisplayNames(locale, { type: 'dateTimeField' }).of(type) ?? type
  } catch {
    return type
  }
}

/** What a month segment says: its number and its name (11 – November), or only the name where it already holds the number (11月). */
export function monthValueText(month: number, name: string): string {
  return name.startsWith(String(month)) ? name : `${month} – ${name}`
}

/** Which way a segment's number went: 1 when it grew or stayed, -1 when it shrank. An empty segment counts as 0. */
export function segmentTrend(from: number | null, to: number | null): 1 | -1 {
  return (to ?? 0) >= (from ?? 0) ? 1 : -1
}

/**
 * Each segment's trend after a move to new fields; a segment that didn't
 * change keeps its last trend. When the whole value moved one way (`whole`,
 * from comparing the values), every segment that changed rolls that way, as
 * an odometer's wheels do: 11:45 to 12:00 rolls the minutes up too.
 */
export function segmentTrends<Trends extends Partial<Record<SegmentType, 1 | -1>>>(
  from: Fields,
  to: Fields,
  last: Trends,
  whole?: 1 | -1,
): Trends {
  const trends: Partial<Record<SegmentType, 1 | -1>> = { ...last }
  for (const type of Object.keys(last) as SegmentType[]) {
    const was = from[type] ?? null
    const now = to[type] ?? null
    if (now !== was) trends[type] = whole ?? segmentTrend(was, now)
  }
  return trends as Trends
}

/**
 * Which way a whole value moved, when both ends are whole: later is 1. Both
 * `yyyy-mm-dd` and `HH:mm` sort as text in the order of time.
 */
export function valueTrend(from: string | null, to: string | null): 1 | -1 | undefined {
  if (from === null || to === null || from === to) return undefined
  return to > from ? 1 : -1
}

/** The segment's own text: its digits while typed, else its value with leading zeros, else empty. */
export function segmentText(type: SegmentType, entry: Entry): string {
  if (entry.text) return entry.text
  if (entry.value === null) return ''
  return pad(entry.value, DIGITS[type])
}

/** Text without accents or case, to compare a typed name with a month's. */
const fold = (text: string) =>
  text.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase()

/**
 * The first of `names` (a month's, AM and PM) that starts with `typed`,
 * ignoring case and accents, by its place in the list, and whether it is
 * the only one: `ju` could be June or July, so it waits.
 */
export function matchName(
  typed: string,
  names: readonly string[],
): { index: number; unique: boolean } | null {
  const start = fold(typed)
  if (!start) return null
  const matches = names.flatMap((name, index) =>
    fold(name).startsWith(start) ? [index] : [],
  )
  if (matches.length === 0) return null
  return { index: matches[0], unique: matches.length === 1 }
}

/** Which way `locale`'s text runs: `rtl` for Hebrew and Arabic. */
export function localeDirection(locale?: string): 'ltr' | 'rtl' {
  try {
    const tag = new Intl.Locale(locale ?? browserLocale())
    const info = tag as Intl.Locale & {
      getTextInfo?: () => { direction?: string }
      textInfo?: { direction?: string }
    }
    const direction = (info.getTextInfo?.() ?? info.textInfo)?.direction
    return direction === 'rtl' ? 'rtl' : 'ltr'
  } catch {
    return 'ltr'
  }
}

/** A time as its segments hold it: the hour on the field's own clock, and AM (0) or PM (1) on a 12-hour one. */
export interface TimeFields {
  hour: number | null
  minute: number | null
  second: number | null
  dayPeriod: number | null
}

export const EMPTY_TIME: TimeFields = {
  hour: null,
  minute: null,
  second: null,
  dayPeriod: null,
}

/**
 * The segments and separators in the order `locale` writes a time on the
 * given clock: hour:minute AM in en-US, AM before the hour in Korean. To
 * the hour, its words too: 13 Uhr in German.
 */
export function timeLayout(
  locale: string | undefined,
  hourCycle: HourCycle,
  granularity: TimeGranularity = 'minute',
): SegmentPart<TimeSegmentType>[] {
  const parts = formatDateToParts('2000-01-01T13:00', locale, {
    hour: '2-digit',
    ...(granularity === 'hour' ? {} : { minute: '2-digit' }),
    ...(granularity === 'second' ? { second: '2-digit' } : {}),
    hourCycle: hourCycle === 12 ? 'h12' : 'h23',
    numberingSystem: 'latn',
  })
  const layout: SegmentPart<TimeSegmentType>[] = []
  for (const part of parts) {
    if (
      part.type === 'hour' ||
      part.type === 'minute' ||
      part.type === 'second' ||
      part.type === 'dayPeriod'
    ) {
      layout.push({ type: part.type })
    } else {
      const text = separator(part.value)
      if (text) layout.push({ type: 'literal', text })
    }
  }
  // The row runs left to right, so the numbers read as they do in any
  // language. A right-to-left language writes AM or PM after them, which
  // shows on their left (م 02:30 in Arabic): it leads the row on screen,
  // and stays last for typing, Tab and screen readers.
  const last = layout.at(-1)
  if (last?.type === 'dayPeriod' && localeDirection(locale) === 'rtl') {
    const before = layout.at(-2)
    const gap = before?.type === 'literal' ? 1 : 0
    return layout.map((part, index) =>
      index >= layout.length - 1 - gap ? { ...part, lead: true } : part,
    )
  }
  return layout
}

/**
 * The day period that `typed` starts: one of the locale's `names`, or a
 * and p (am and pm) in any language, as a keyboard types them.
 */
export function matchDayPeriod(
  typed: string,
  names: readonly string[],
): { index: number; unique: boolean } | null {
  const named = matchName(typed, names)
  if (named) return named
  const latin = fold(typed).replace(/\./g, '')
  if (latin === 'a' || latin === 'am') return { index: 0, unique: true }
  if (latin === 'p' || latin === 'pm') return { index: 1, unique: true }
  return null
}

/** A time of day, 0 to 23 hours, as the segments of a field on `hourCycle`. */
export function timeFields(
  hours: number,
  minutes: number,
  seconds: number,
  hourCycle: HourCycle,
  granularity: TimeGranularity = 'minute',
): TimeFields {
  return {
    hour: hourCycle === 12 ? hours % 12 || 12 : hours,
    minute: granularity === 'hour' ? null : minutes,
    second: granularity === 'second' ? seconds : null,
    dayPeriod: hourCycle === 12 ? (hours >= 12 ? 1 : 0) : null,
  }
}

/**
 * The time as 24-hour `HH:mm`, or `HH:mm:ss` with seconds, as a native time
 * input gives it, and `HH:00` to the hour; null until every segment is
 * filled.
 */
export function toTimeValue(
  fields: TimeFields,
  hourCycle: HourCycle,
  granularity: TimeGranularity = 'minute',
): string | null {
  const { hour, dayPeriod } = fields
  const minute = granularity === 'hour' ? 0 : fields.minute
  const second = granularity === 'second' ? fields.second : 0
  if (hour === null || minute === null || second === null) return null
  if (hourCycle === 12 && dayPeriod === null) return null
  const { min, max } = segmentRange('hour', {}, hourCycle)
  if (hour < min || hour > max) return null
  const hours = hourCycle === 12 ? (hour % 12) + 12 * (dayPeriod ?? 0) : hour
  return timeValue(hours, minute, second, granularity)
}

/**
 * The segments of an `HH:mm` or `HH:mm:ss` time, or all empty when it isn't
 * one. Without a seconds segment, its seconds are left out; with one, a
 * time without them starts at 0.
 */
export function fromTimeValue(
  value: string | null | undefined,
  hourCycle: HourCycle,
  granularity: TimeGranularity = 'minute',
): TimeFields {
  const time = timeParts(value)
  if (!time) return EMPTY_TIME
  return timeFields(time.hours, time.minutes, time.seconds, hourCycle, granularity)
}

/**
 * The time in pasted text: 14:30, 2:30 PM, 2:30pm, 14.30.15, or 2 PM. Digits
 * of any script count. A time with AM or PM takes hours 1 to 12; one
 * without, 0 to 23. Null when it isn't a time.
 */
export function parseTime(
  text: string,
  hourCycle: HourCycle,
  granularity: TimeGranularity,
  names: readonly string[],
): TimeFields | null {
  const trimmed = latinDigits(text.trim())
  const numbers = trimmed
    .split(/[^\d]+/)
    .filter(Boolean)
    .map(Number)
  const period = trimmed
    .split(/[^\p{L}.]+/u)
    .filter(Boolean)
    .map((word) => matchDayPeriod(word, names))
    .find((match) => match?.unique)?.index
  const fewest = period === undefined && granularity !== 'hour' ? 2 : 1
  if (numbers.length < fewest || numbers.length > 3) return null
  const [hour, minutes = 0, seconds = 0] = numbers
  if (minutes > 59 || seconds > 59) return null
  if (period === undefined ? hour > 23 : hour < 1 || hour > 12) return null
  const hours = period === undefined ? hour : (hour % 12) + 12 * period
  return timeFields(hours, minutes, seconds, hourCycle, granularity)
}

/**
 * Everything a field of segments needs to know about what it holds (a date
 * or a time), so one field types, steps, pastes and validates both.
 */
export interface SegmentScheme {
  locale: string | undefined
  layout: SegmentPart[]
  /** The clock the hour segment counts on. */
  hourCycle?: HourCycle
  /** Segments written as words, from the segment's smallest value on: the months' short names, AM and PM. */
  names: Partial<Record<SegmentType, readonly string[]>>
  /** The value the segments add up to, or null until it is whole. */
  toValue: (fields: Fields) => string | null
  fromValue: (value: string | null | undefined) => Fields
  /** Where stepping an empty segment starts: today, or now. */
  now: () => Fields
  /** The word segment's value that letters typed into it start, and whether no other could follow. */
  match: (type: SegmentType, text: string) => { value: number; unique: boolean } | null
  /** The value a segment keeps when it is left, where that isn't its digits': a year of 85 is 1985. */
  leave: (type: SegmentType, text: string) => number | null | undefined
  /** The segments once the field is left: the 31st of February becomes the 28th. */
  constrain: (fields: Fields) => Fields
  parse: (text: string) => Fields | null
  outOfRange: (value: string | null) => boolean
  /** What the form says about a value it can't take. */
  rangeMessage: string
  /** What a screen reader says for a segment's value. */
  valueText: (type: SegmentType, value: number) => string
  /** What an empty segment shows. */
  placeholder: (type: SegmentType) => string
}

const dateOf = (fields: Fields): DateFields => ({
  year: fields.year ?? null,
  month: fields.month ?? null,
  day: fields.day ?? null,
})

const timeOf = (fields: Fields): TimeFields => ({
  hour: fields.hour ?? null,
  minute: fields.minute ?? null,
  second: fields.second ?? null,
  dayPeriod: fields.dayPeriod ?? null,
})

/**
 * A date's scheme: day, month and year in the locale's order, its value
 * `yyyy-mm-dd`; to the month, month and year (`yyyy-mm`); to the year, the
 * year alone (`yyyy`).
 */
export function dateScheme({
  locale,
  monthFormat = 'numeric',
  granularity = 'day',
  min,
  max,
}: {
  locale?: string
  monthFormat?: 'numeric' | 'short'
  granularity?: DateGranularity
  /** The earliest value allowed: a year, a month or a day. */
  min?: string
  /** The latest value allowed: a year, a month or a day. */
  max?: string
}): SegmentScheme {
  const layout = dateLayout(locale, monthFormat, granularity)
  const names = monthFormat === 'short' ? monthNames(locale) : undefined
  const longNames = monthNames(locale, 'long')
  const now = () => fromISODate(today())
  const thisYear = () => Number(today().slice(0, 4))
  const noun = granularity === 'day' ? 'date' : granularity
  return {
    locale,
    layout,
    names: names && granularity !== 'year' ? { month: names } : {},
    toValue: (fields) => toDateValue(dateOf(fields), granularity),
    fromValue: (value) => {
      const fields = fromDateValue(value)
      return toDateValue(fields, granularity) === null ? EMPTY_DATE : fields
    },
    now,
    match: (type, text) => {
      if (type !== 'month' || !names) return null
      const match = matchName(text, names)
      return match && { value: match.index + 1, unique: match.unique }
    },
    leave: (type, text) => (type === 'year' ? expandYear(text, thisYear()) : undefined),
    constrain: (fields) => {
      const date = dateOf(fields)
      const constrained = constrainDay(date)
      return constrained === date ? fields : { ...fields, ...constrained }
    },
    parse: (text) => parseDate(text, layout, thisYear(), names, granularity),
    outOfRange: (value) => outsideBounds(value, min, max),
    rangeMessage: rangeMessage(noun, 'on', min, max, (value) =>
      formatValue(value, locale),
    ),
    valueText: (type, value) =>
      type === 'month' ? monthValueText(value, longNames[value - 1]) : String(value),
    // A month's name takes three letters where its number takes two.
    placeholder: (type) =>
      type === 'month' && names
        ? segmentPlaceholder('month', locale).slice(0, 1).repeat(3)
        : segmentPlaceholder(type, locale),
  }
}

/**
 * What the form says about a value outside `min` and `max`: "Enter a date
 * from 1 Nov 2026 to 30 Nov 2026." `at` is the word before a single bound
 * (on or after a date, at or after a time).
 */
function rangeMessage(
  noun: string,
  at: 'on' | 'at',
  min: string | undefined,
  max: string | undefined,
  format: (value: string) => string | null,
): string {
  const write = (value: string) => format(value) ?? value
  if (min && max) return `Enter a ${noun} from ${write(min)} to ${write(max)}.`
  if (min) return `Enter a ${noun} ${at} or after ${write(min)}.`
  if (max) return `Enter a ${noun} ${at} or before ${write(max)}.`
  return noun === 'time' ? 'Enter a whole time.' : `Enter a ${noun} that exists.`
}

/**
 * A time's scheme: hour, minute, second and AM or PM in the locale's order,
 * its value `HH:mm`, `HH:mm:ss` with seconds, or `HH:00` to the hour.
 */
export function timeScheme({
  locale,
  hourCycle = localeHourCycle(locale),
  granularity = 'minute',
  min,
  max,
}: {
  locale?: string
  hourCycle?: HourCycle
  granularity?: TimeGranularity
  min?: string
  max?: string
}): SegmentScheme {
  const periods = dayPeriodNames(locale)
  return {
    locale,
    layout: timeLayout(locale, hourCycle, granularity),
    hourCycle,
    names: hourCycle === 12 ? { dayPeriod: periods } : {},
    toValue: (fields) => toTimeValue(timeOf(fields), hourCycle, granularity),
    fromValue: (value) => fromTimeValue(value, hourCycle, granularity),
    now: () => {
      const now = timeParts(currentTime())
      return now
        ? timeFields(now.hours, now.minutes, now.seconds, hourCycle, 'second')
        : EMPTY_TIME
    },
    match: (type, text) => {
      if (type !== 'dayPeriod') return null
      const match = matchDayPeriod(text, periods)
      return match && { value: match.index, unique: match.unique }
    },
    leave: () => undefined,
    constrain: (fields) => fields,
    parse: (text) => parseTime(text, hourCycle, granularity, periods),
    outOfRange: (value) => timeOutOfRange(value, min, max),
    rangeMessage: rangeMessage('time', 'at', min, max, (value) =>
      formatTime(value, locale, hourCycle),
    ),
    valueText: (type, value) => (type === 'dayPeriod' ? periods[value] : String(value)),
    placeholder: (type) => segmentPlaceholder(type, locale),
  }
}

const TIME_SEGMENTS = new Set<SegmentType>(['hour', 'minute', 'second', 'dayPeriod'])

/**
 * The text `locale` writes between a date and its time: the comma and
 * space of 11/14/2026, 1:00 PM in en-US, a space in German. A space where
 * it writes the time first.
 */
export function dateTimeJoiner(locale?: string): string {
  const parts = formatDateToParts('2000-01-01T13:00', locale, {
    ...FORMAT,
    hour: '2-digit',
    minute: '2-digit',
  })
  const lastDate = parts.findLastIndex(
    (part) => part.type === 'day' || part.type === 'month' || part.type === 'year',
  )
  const firstTime = parts.findIndex(
    (part) => part.type === 'hour' || part.type === 'minute' || part.type === 'dayPeriod',
  )
  if (firstTime < lastDate) return ' '
  const between = parts
    .slice(lastDate + 1, firstTime)
    .map((part) => part.value)
    .join('')
  return separator(between) || ' '
}

/**
 * A date and time's scheme: the date's segments, then the time's, in one
 * field. Its value is `yyyy-mm-ddTHH:mm` (`HH:mm:ss` with seconds), as a
 * native `datetime-local` input gives it. With `partial`, a field with only
 * its date or only its time whole has a value too (`2026-11-14T`,
 * `T09:30`), for a picker that fills the other half from elsewhere.
 */
export function dateTimeScheme({
  locale,
  monthFormat,
  hourCycle,
  granularity = 'minute',
  min,
  max,
  partial = false,
}: {
  locale?: string
  monthFormat?: 'numeric' | 'short'
  hourCycle?: HourCycle
  granularity?: TimeGranularity
  /** The earliest value allowed: a date and time, or a day, whose start it means. */
  min?: string
  /** The latest value allowed: a date and time, or a day, whose end it means. */
  max?: string
  partial?: boolean
}): SegmentScheme {
  const date = dateScheme({ locale, monthFormat })
  const time = timeScheme({ locale, hourCycle, granularity })
  const of = (type: SegmentType) => (TIME_SEGMENTS.has(type) ? time : date)
  const halves = (fields: Fields) => ({
    date: date.toValue(fields),
    time: time.toValue(fields),
  })
  const fromValue = (value: string | null | undefined): Fields => {
    const split = splitDateTime(value)
    return { ...date.fromValue(split.date), ...time.fromValue(split.time) }
  }
  const cycle = time.hourCycle
  // A date that ends on a separator (2026. 11. 14. in Korean) doesn't take it twice.
  const tail = date.layout.at(-1)
  const between = dateTimeJoiner(locale)
  const joiner =
    tail?.type === 'literal' && between.startsWith(tail.text)
      ? between.slice(tail.text.length) || ' '
      : between
  return {
    locale,
    // The time's AM or PM stays after its numbers, as the date comes first.
    layout: [
      ...date.layout,
      { type: 'literal', text: joiner },
      ...time.layout.map((part) => ({ ...part, lead: undefined })),
    ],
    hourCycle: cycle,
    names: { ...date.names, ...time.names },
    toValue: (fields) => {
      const { date: day, time: clock } = halves(fields)
      if (partial) return joinDateTime(day, clock)
      return day !== null && clock !== null ? `${day}T${clock}` : null
    },
    fromValue,
    now: () => ({ ...date.now(), ...time.now() }),
    match: (type, text) => of(type).match(type, text),
    leave: (type, text) => of(type).leave(type, text),
    constrain: (fields) => date.constrain(fields),
    parse: (text) => {
      const trimmed = text.trim()
      if (isISODateTime(trimmed)) return fromValue(trimmed)
      // Each place the text could split into a date and a time: 14/11/2026, 09:30.
      for (const gap of trimmed.matchAll(/[\s,]+|T(?=\d)/g)) {
        const day = date.parse(trimmed.slice(0, gap.index))
        const clock = time.parse(trimmed.slice(gap.index + gap[0].length))
        if (day && clock) return { ...day, ...clock }
      }
      return null
    },
    outOfRange: (value) => outsideBounds(value, min, max),
    rangeMessage: rangeMessage('date and time', 'at', min, max, (value) =>
      formatValue(value, locale, cycle),
    ),
    valueText: (type, value) => of(type).valueText(type, value),
    placeholder: (type) => of(type).placeholder(type),
  }
}
