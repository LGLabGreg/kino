import { nice, ticks } from 'd3-array'
import type { ReactNode } from 'react'

/*
 * The arithmetic every chart with categories shares: which values a series
 * spans once it is stacked, the range the value axis shows and its ticks,
 * where each category sits along its axis, which key steps where, and which
 * category names fit. Everything here is a pure function of the data and the
 * chart's options, so the parts that draw only place what it returns. What
 * one kind of chart alone works out, such as a bar's clip, lives in its file.
 */

/** A fill drawn over a series' colour, so series differ by more than colour. */
export type ChartPattern = 'solid' | 'stripes' | 'dots' | 'grid' | 'diagonal'

/** How a series is named and drawn, keyed by its key in the data: shadcn's `ChartConfig`, and a little more. */
export interface ChartSeries {
  label?: ReactNode
  /** Any CSS colour, such as `var(--chart-1)`. */
  color?: string
  /** A colour for each theme, in place of `color`. */
  theme?: { light: string; dark: string }
  /** A pattern over the colour; the chart's `patterns` gives each series one by default. */
  pattern?: ChartPattern
  /** When the chart stacks, the series with the same `stack` stack together, beside the other stacks. */
  stack?: string
}

/** Every key is a series the chart draws, in the order written, which is also the order they stack in. */
export type ChartConfig = Record<string, ChartSeries>

/** One row of the data: a category and a value for each series. */
export type ChartDatum = Record<string, unknown>

export type ChartOrientation = 'vertical' | 'horizontal'

export type ReadingDirection = 'ltr' | 'rtl'

/**
 * How the series of one category combine: side by side, stacked on each
 * other, or stacked to fill the axis as shares of their total. As shares,
 * a row with negative values fills the axis from below zero to above it.
 */
export type ChartStack = 'none' | 'stacked' | 'expand'

/** A number that can be drawn, or null for a missing value. */
export function numberOf(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** Where a series' value starts and ends on the value axis, in data units. */
export type Span = readonly [from: number, to: number]

/** A value given as its two ends, `[from, to]`, such as a range or a step of a waterfall. */
export function rangeOf(value: unknown): Span | null {
  if (!Array.isArray(value) || value.length !== 2) return null
  const from = numberOf(value[0])
  const to = numberOf(value[1])
  return from === null || to === null ? null : [from, to]
}

/**
 * Each series' span in every row, null where its value is missing. Side by
 * side, a bar runs from zero to its value. Stacked, positive values stack up
 * from zero and negative ones down from it, in the order of `keys`, each
 * stack on its own (`stackOf`); as shares, each stack is divided by the
 * total of its values' sizes, so it fills the axis. A value given as
 * `[from, to]` spans exactly that and never stacks.
 */
export function seriesSpans(
  data: readonly ChartDatum[],
  keys: readonly string[],
  stack: ChartStack,
  stackOf: (key: string) => string = () => '',
): Record<string, (Span | null)[]> {
  const spans: Record<string, (Span | null)[]> = {}
  for (const key of keys) spans[key] = []
  for (const row of data) {
    const values = keys.map((key) => numberOf(row[key]))
    const totals = new Map<string, number>()
    if (stack === 'expand') {
      keys.forEach((key, index) => {
        const group = stackOf(key)
        totals.set(group, (totals.get(group) ?? 0) + Math.abs(values[index] ?? 0))
      })
    }
    const up = new Map<string, number>()
    const down = new Map<string, number>()
    keys.forEach((key, index) => {
      const range = rangeOf(row[key])
      if (range) {
        spans[key]!.push(range)
        return
      }
      const value = values[index]
      if (value === null || value === undefined) {
        spans[key]!.push(null)
        return
      }
      if (stack === 'none') {
        spans[key]!.push([0, value])
        return
      }
      const group = stackOf(key)
      const total = stack === 'expand' ? (totals.get(group) ?? 0) : 1
      const share = total === 0 ? 0 : value / total
      const ends = share >= 0 ? up : down
      const from = ends.get(group) ?? 0
      spans[key]!.push([from, from + share])
      ends.set(group, from + share)
    })
  }
  return spans
}

/**
 * The spans of each series in `series` that isn't `shown`: where it would
 * sit among the shown series, stacked in its place, were it shown with
 * nothing in it. A hidden bar or area collapses there, so it leaves from
 * and comes back to its own place in the stack.
 */
export function hiddenSpans(
  data: readonly ChartDatum[],
  series: readonly string[],
  shown: readonly string[],
  stack: ChartStack,
  stackOf: (key: string) => string = () => '',
): Record<string, (Span | null)[]> {
  return Object.fromEntries(
    series
      .filter((key) => !shown.includes(key))
      .map((key) => {
        const order = series.filter((k) => k === key || shown.includes(k))
        const zeroed = data.map((row) => ({ ...row, [key]: 0 }))
        return [key, seriesSpans(zeroed, order, stack, stackOf)[key] ?? []]
      }),
  )
}

/** The stacks of a stacked chart, in the order their first series is written: one for each `stack` in the config. */
export function stacksOf(keys: readonly string[], stackOf: (key: string) => string) {
  return [...new Set(keys.map(stackOf))]
}

/** The lowest and highest value any span reaches, always taking in zero, where bars start. */
export function spanExtent(spans: Record<string, readonly (Span | null)[]>): Span {
  let low = 0
  let high = 0
  for (const series of Object.values(spans)) {
    for (const span of series) {
      if (!span) continue
      low = Math.min(low, span[0], span[1])
      high = Math.max(high, span[0], span[1])
    }
  }
  return [low, high]
}

/** `extent` stretched to take in `values` too, such as a reference line's. */
export function extentWith(extent: Span, values: readonly number[]): Span {
  return [Math.min(extent[0], ...values), Math.max(extent[1], ...values)]
}

/**
 * `extent` stretched so `room` px are left past each end that has values on
 * it, along an axis `length` px long, for labels that sit beyond the bars.
 */
export function extentWithRoom(extent: Span, room: number, length: number): Span {
  const [low, high] = extent
  const ends = (high > 0 ? 1 : 0) + (low < 0 ? 1 : 0)
  if (room <= 0 || ends === 0 || length <= room * ends) return extent
  const grow = ((high - low) * room) / (length - room * ends)
  return [low < 0 ? low - grow : low, high > 0 ? high + grow : high]
}

/**
 * How far from zero the spans of `keys` in row `index` reach: the highest
 * value above zero, or with `below`, the lowest below it. Zero when none do.
 */
export function reachOf(
  spans: Record<string, readonly (Span | null)[]>,
  keys: readonly string[],
  index: number,
  below = false,
): number {
  let far = 0
  for (const key of keys) {
    const span = spans[key]?.[index]
    if (!span) continue
    far = below ? Math.min(far, span[0], span[1]) : Math.max(far, span[0], span[1])
  }
  return far
}

/** One end of the value axis: a value of its own, or `'auto'` to fit the data. */
export type DomainEnd = number | 'auto'

export interface ValueScale {
  /** The values at the axis's two ends. */
  domain: Span
  /** The values a tick and a grid line mark. */
  ticks: number[]
}

export interface ValueScaleOptions {
  domain?: readonly [DomainEnd, DomainEnd]
  /** About how many ticks to mark. */
  tickCount?: number
  /** Round the ends left to fit the data out to the next tick. */
  nice?: boolean
  /** Ticks between whole numbers, such as 0.5; off for counts. */
  allowDecimals?: boolean
  /** The ticks to mark, in place of round ones; the ends left to fit reach them. */
  tickValues?: readonly number[]
}

/**
 * The range the value axis shows and the values it marks. An end left to fit
 * the data is rounded out to the next tick, so the tallest bar never touches
 * the edge; an end given stays exactly as given. With no range to show (no
 * data, or every value zero), it shows 0 to 1. With `nice` off, the ends stay
 * where the data reaches, as shares stacked to fill the axis do.
 */
export function valueScale(
  extent: Span,
  {
    domain = ['auto', 'auto'],
    tickCount = 5,
    nice: rounded = true,
    allowDecimals = true,
    tickValues,
  }: ValueScaleOptions = {},
): ValueScale {
  const reach = tickValues?.length ? extentWith(extent, tickValues) : extent
  let low = domain[0] === 'auto' ? reach[0] : domain[0]
  let high = domain[1] === 'auto' ? reach[1] : domain[1]
  if (low === high) {
    if (domain[1] === 'auto') high = low + 1
    else low = high - 1
  }
  if (rounded && !tickValues?.length) {
    const [niceLow, niceHigh] = nice(low, high, tickCount)
    if (domain[0] === 'auto') low = niceLow
    if (domain[1] === 'auto') high = niceHigh
    if (!allowDecimals) {
      if (domain[0] === 'auto') low = Math.floor(low)
      if (domain[1] === 'auto') high = Math.ceil(high)
    }
  }
  if (tickValues?.length) {
    return {
      domain: [low, high],
      ticks: [...tickValues]
        .filter((tick) => tick >= low && tick <= high)
        .toSorted((a, b) => a - b),
    }
  }
  return { domain: [low, high], ticks: wholeTicks(low, high, tickCount, allowDecimals) }
}

/**
 * About how many ticks an axis `length` px long has room for, at most
 * `count`: each at least `spacing` px from the next, and never fewer than
 * two. Before the axis is measured, `count`.
 */
export function tickCountFor(count: number, length: number, spacing: number): number {
  if (length <= 0) return count
  return Math.max(2, Math.min(count, Math.floor(length / spacing)))
}

/** d3's round ticks, or with `allowDecimals` off, only the whole ones, at least a step of 1 apart. */
function wholeTicks(low: number, high: number, count: number, allowDecimals: boolean) {
  const round = ticks(low, high, count)
  if (allowDecimals) return round
  const whole = round.filter((tick) => Number.isInteger(tick))
  if (whole.length >= 2) return whole
  const out: number[] = []
  for (let tick = Math.ceil(low); tick <= Math.floor(high); tick += 1) out.push(tick)
  return out
}

/** Whether every value in `data` under `keys` is a whole number, so its ticks should be too. */
export function allWhole(data: readonly ChartDatum[], keys: readonly string[]): boolean {
  return data.every((row) =>
    keys.every((key) => {
      const range = rangeOf(row[key])
      if (range) return Number.isInteger(range[0]) && Number.isInteger(range[1])
      const value = numberOf(row[key])
      return value === null || Number.isInteger(value)
    }),
  )
}

/** Where `value` sits between the axis's ends, from 0 at its start to 1 at its end, held inside them. */
export function fractionOf(value: number, [low, high]: Span): number {
  if (high === low) return 0
  return Math.min(1, Math.max(0, (value - low) / (high - low)))
}

/** A stretch of an axis, as fractions of its length, measured from where reading starts. */
export interface Band {
  start: number
  size: number
}

/** How much room categories leave, each a share of one category's step, as in d3's band scale. */
export interface BandGaps {
  /** Between two categories. */
  gap?: number
  /** Before the first and after the last. */
  outer?: number
}

/** The band of the category at `index` among `count`, in reading order. */
export function categoryBand(
  index: number,
  count: number,
  { gap = 0.3, outer = 0.15 }: BandGaps = {},
): Band {
  const step = 1 / Math.max(1, count - gap + outer * 2)
  return { start: step * (outer + index), size: step * (1 - gap) }
}

/** The physical start of `band` from the left, or from the top for an axis that runs down. */
export function physicalStart(
  band: Band,
  axis: 'inline' | 'block',
  direction: ReadingDirection,
): number {
  return axis === 'inline' && direction === 'rtl'
    ? 1 - band.start - band.size
    : band.start
}

/**
 * The point on a category at `along` of the value axis, centred across its
 * `band`, as fractions of the plot from its physical left and top: where a
 * tooltip or a value label sits.
 */
export function plotPoint(
  band: Band,
  along: number,
  orientation: ChartOrientation,
  direction: ReadingDirection,
): { x: number; y: number } {
  const centre =
    physicalStart(band, orientation === 'vertical' ? 'inline' : 'block', direction) +
    band.size / 2
  if (orientation === 'vertical') return { x: centre, y: 1 - along }
  return { x: direction === 'rtl' ? 1 - along : along, y: centre }
}

/**
 * The step from `index` that a key asks for along the categories, or null
 * for a key that isn't one of the chart's. The keys follow the WAI-ARIA
 * slider, whose value is `sliderValue`: Up and the arrow pointing along
 * reading order raise it, Down and the other arrow lower it, Page Up and
 * Page Down move a tenth of the way, and Home and End go to its ends.
 */
export function stepIndex(
  key: string,
  index: number,
  count: number,
  orientation: ChartOrientation,
  direction: ReadingDirection,
): number | null {
  if (count === 0) return null
  const page = Math.max(1, Math.round(count / 10))
  const forward = direction === 'rtl' ? 'ArrowLeft' : 'ArrowRight'
  const back = direction === 'rtl' ? 'ArrowRight' : 'ArrowLeft'
  const value = sliderValue(index, count, orientation)
  const next =
    key === 'ArrowUp' || key === forward
      ? value + 1
      : key === 'ArrowDown' || key === back
        ? value - 1
        : key === 'PageUp'
          ? value + page
          : key === 'PageDown'
            ? value - page
            : key === 'Home'
              ? 1
              : key === 'End'
                ? count
                : null
  if (next === null) return null
  return indexOfValue(Math.min(count, Math.max(1, next)), count, orientation)
}

/**
 * The slider value of the category at `index`, from 1 to `count`: along
 * reading order for upright bars, and from the bottom for lying ones, which
 * run down the page, so Up raises it as the slider pattern asks.
 */
export function sliderValue(index: number, count: number, orientation: ChartOrientation) {
  return orientation === 'vertical' ? index + 1 : count - index
}

function indexOfValue(value: number, count: number, orientation: ChartOrientation) {
  return orientation === 'vertical' ? value - 1 : count - value
}

/**
 * Where a point is along the category axis of a plot whose box is `box`, as
 * a fraction from the reading start: across the page for upright bars, down
 * it for lying ones.
 */
export function alongCategories(
  point: { x: number; y: number },
  box: { left: number; top: number; width: number; height: number },
  orientation: ChartOrientation,
  direction: ReadingDirection,
): number {
  if (orientation === 'horizontal') {
    return box.height === 0 ? 0 : (point.y - box.top) / box.height
  }
  const fromLeft = box.width === 0 ? 0 : (point.x - box.left) / box.width
  return direction === 'rtl' ? 1 - fromLeft : fromLeft
}

/**
 * Which category is under the pointer: `at` is the pointer's place along the
 * category axis as a fraction from the reading start, and `centres` each
 * category's centre the same way, in order. The nearest category, the next
 * one from halfway between two; past the ends, the first or last.
 */
export function indexAt(at: number, centres: readonly number[]): number | null {
  if (centres.length === 0) return null
  let index = 0
  while (index < centres.length - 1 && at >= (centres[index]! + centres[index + 1]!) / 2)
    index += 1
  return index
}

/**
 * The column a category's trigger fills, so the columns meet: from halfway
 * to the category before to halfway to the next, and out to the ends for the
 * first and last, as fractions from the physical left, or the top.
 */
export function columnOf(
  index: number,
  centres: readonly number[],
  orientation: ChartOrientation,
  direction: ReadingDirection,
): Band {
  const centre = centres[index] ?? 0
  const before = centres[index - 1]
  const after = centres[index + 1]
  const start = before === undefined ? 0 : (before + centre) / 2
  const end = after === undefined ? 1 : (centre + after) / 2
  const size = end - start
  return orientation === 'vertical' && direction === 'rtl'
    ? { start: 1 - end, size }
    : { start, size }
}

/** The centre of `band`, as a fraction from the reading start. */
export function bandCentre(band: Band): number {
  return band.start + band.size / 2
}

/**
 * The change from `previous` to `value` as a share of `previous`'s size,
 * such as 0.25 for a quarter up, or null when there is nothing to compare
 * with: no previous value, or a previous value of zero.
 */
export function changeSince(value: unknown, previous: unknown): number | null {
  const now = numberOf(value)
  const before = numberOf(previous)
  if (now === null || before === null || before === 0) return null
  return (now - before) / Math.abs(before)
}

/** A value worked out from the data, for a reference line. */
export type ChartSummary = 'average' | 'median' | 'min' | 'max'

/** The `kind` of `values`, missing ones left out, or null with none to go on. */
export function summaryOf(values: readonly unknown[], kind: ChartSummary): number | null {
  const numbers = values.flatMap((value) => {
    const number = numberOf(value)
    return number === null ? [] : [number]
  })
  if (numbers.length === 0) return null
  if (kind === 'min') return Math.min(...numbers)
  if (kind === 'max') return Math.max(...numbers)
  if (kind === 'average') return numbers.reduce((all, n) => all + n, 0) / numbers.length
  const sorted = numbers.toSorted((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1
    ? sorted[middle]!
    : (sorted[middle - 1]! + sorted[middle]!) / 2
}

/**
 * How many categories one label stands for, so labels `minLength` px long
 * never crowd an axis `length` px long: 1 shows every label, 2 every other.
 */
export function labelStep(count: number, length: number, minLength: number): number {
  if (count === 0 || length <= 0) return 1
  return Math.max(1, Math.ceil((count * minLength) / length))
}

/**
 * About how long a category's label is, in px, at the axis's 12px text: each
 * character at about its width in a sans-serif such as Geist or Inter, and
 * room either side. Close enough to thin out a long run of labels without
 * measuring each one, and to lay an axis out as it will look before the font
 * is known.
 */
export function labelLength(text: string): number {
  let length = 12
  for (const character of text) length += characterWidth(character)
  return length
}

/** About how wide a character is at 12px, by its kind. */
function characterWidth(character: string): number {
  if (/\d/.test(character)) return 7.7
  if (character === ' ') return 3
  if (/[A-Z]/.test(character)) return 8.1
  if (/[a-z]/.test(character)) return 6.2
  // Han, kana and hangul, a full em each.
  if (/[\u2e80-\u9fff\uac00-\ud7af\uff00-\uffef]/.test(character)) return 12
  if (/\p{L}/u.test(character)) return 6.6
  return 4
}

/**
 * Where a name `width` px wide sits on an axis `length` px long, as its
 * start and end in px: centred on `centre` (a fraction of the axis), but
 * kept inside it, so a whole name at either end stays in view.
 */
export function labelBox(centre: number, width: number, length: number): Span {
  const start = Math.min(
    Math.max(0, centre * length - width / 2),
    Math.max(0, length - width),
  )
  return [start, start + width]
}

/** Whether two names' boxes come closer than `gap` px. */
export function labelsMeet(a: Span, b: Span, gap = 4): boolean {
  return a[0] < b[1] + gap && b[0] < a[1] + gap
}

/**
 * The names a category axis `length` px long shows, as `skipped` indexes, and
 * the room each has, in px: every few in a long run, each `minLength` px or
 * more apart, and none that would meet the lit name or the last one shown, as
 * a name kept inside the axis at either end can. Each name has its centre, a
 * share of the axis, and its width in px; the lit one shows whole.
 */
export function axisNames(
  names: readonly { centre: number; width: number }[],
  length: number,
  { minLength, gap, lit = null }: { minLength: number; gap: number; lit?: number | null },
): { every: number; room: number; skipped: Set<number> } {
  const every = labelStep(names.length, length, minLength)
  const room = names.length === 0 ? 0 : Math.max(0, (length / names.length) * every - gap)
  const skipped = new Set<number>()
  const litName = lit === null ? undefined : names[lit]
  const litBox = litName ? labelBox(litName.centre, litName.width, length) : null
  let last: Span | null = null
  names.forEach((name, index) => {
    if (index === lit) return
    const box = labelBox(name.centre, Math.min(name.width, room), length)
    if (
      index % every !== 0 ||
      (litBox !== null && labelsMeet(box, litBox)) ||
      (last !== null && labelsMeet(box, last))
    ) {
      skipped.add(index)
      return
    }
    last = box
  })
  return { every, room, skipped }
}

/**
 * The order a cascade reaches the bar at `index` among `count`, from 0 for
 * the first to 1 for the last: from the reading start, from the end, or out
 * from the centre. `rank` orders them by value instead, 0 for the largest.
 */
export function cascadeAt(
  index: number,
  count: number,
  from: 'start' | 'end' | 'centre' = 'start',
  rank?: number,
): number {
  if (count <= 1) return 0
  if (rank !== undefined) return rank / (count - 1)
  if (from === 'end') return (count - 1 - index) / (count - 1)
  if (from === 'centre') {
    const middle = (count - 1) / 2
    return middle === 0 ? 0 : Math.abs(index - middle) / middle
  }
  return index / (count - 1)
}
