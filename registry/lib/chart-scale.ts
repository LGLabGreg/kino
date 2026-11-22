import { labelBox, labelsMeet, type Span } from '@/registry/lib/chart-math'
import {
  timeIntervals,
  timeTicks,
  type TimeUnit,
  timeUnitOf,
  unitLength,
  type Weekday,
} from '@/registry/lib/dates'
import { nice, ticks } from 'd3-array'

/*
 * A chart's scales: where a value sits along an axis, as a fraction of its
 * length, and back. One union, so every part that places something reads
 * any axis the same way: a band of categories, which bars stand in; points
 * of categories, edge to edge, which lines run through; numbers; and
 * times, as instants. A log scale is one more member. Every function
 * here is pure: the frame makes the scales from the data and the props
 * while the chart renders, so the server draws the range the browser does.
 */

/** One end of a value axis: a value of its own, or `'auto'` to fit the data. */
type DomainEnd = number | 'auto'

/** A stretch of an axis, as fractions of its length, measured from where reading starts. */
interface Band {
  start: number
  size: number
}

/** How much room categories leave, each a share of one category's step, as in d3's band scale. */
interface BandGaps {
  /** Between two categories. */
  gap?: number
  /** Before the first and after the last. */
  outer?: number
}

/** Numbers along an axis, from the value at its start to the value at its end. */
interface LinearScale {
  kind: 'linear'
  /** The values at the axis's two ends. */
  domain: Span
  /** The values a tick and a grid line mark, lowest first. */
  ticks: readonly number[]
  /**
   * The round ticks it marks where its axis has room for only about `count`,
   * lowest first: the coarser steps a short axis shows. `ticks` at the count
   * it was made with, or more.
   */
  ticksFor: (count: number) => readonly number[]
  /** Where `value` sits, from 0 at the axis's start to 1 at its end, held inside them. */
  place: (value: number) => number
  /** The value at `fraction` of the axis, past its ends too. */
  valueAt: (fraction: number) => number
}

/**
 * Categories along an axis, in the data's order, from the reading start: as
 * bands, which bars stand in, or as points edge to edge, the first at the
 * start and the last at the end, which a line runs through.
 */
interface CategoryScale {
  kind: 'band' | 'point'
  /** Each category's key, in order. */
  keys: readonly string[]
  /** The band of the category at `index`; a point's has no size. */
  bandAt: (index: number) => Band
  /** Where the category keyed `key` sits: its band's centre, or null for one not on the axis. */
  place: (key: string) => number | null
  /** The category nearest `fraction` of the axis: the next one from halfway between two, the first or last past the ends. */
  valueAt: (fraction: number) => string | null
}

/**
 * Times along an axis, as instants in ms, each where it falls, so a missing
 * date stays a gap. Its ticks fall on the calendar of `timeZone`'s clock.
 */
interface TimeScale {
  kind: 'time'
  /** The instants at the axis's two ends. */
  domain: Span
  /** The clock its ticks and times are written on: UTC for calendar values, which name no zone. */
  timeZone: string
  /** The finest unit its times hold, which a time is written as fine as. */
  unit: Exclude<TimeUnit, 'week'>
  /** The instants of every tick it may mark, earliest first. */
  ticks: readonly number[]
  /**
   * The ticks of each calendar step that fits its span, coarsest first, such
   * as quarters, months and weeks: an axis shows the finest its length has
   * room for (`timeLadder`).
   */
  tickSets: readonly (readonly number[])[]
  /** Where `time` sits, from 0 at the axis's start to 1 at its end, held inside them. */
  place: (time: number) => number
  /** The instant at `fraction` of the axis, past its ends too. */
  valueAt: (fraction: number) => number
  /** The band a mark at `time` stands in, centred on it: as wide as bars on the closest two times allow, or none for points. */
  bandOf: (time: number) => Band
}

type ChartScale = LinearScale | CategoryScale | TimeScale

interface LinearScaleOptions {
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
 * The scale of a value axis that shows `extent`. Given its ends the other
 * way round, it runs from the higher value, as ranks do, 1 at the top. An end left to fit the data
 * is rounded out to the next tick, so the tallest bar never touches the
 * edge; an end given stays exactly as given. With no range to show (no data,
 * or every value zero), it shows 0 to 1. With `nice` off, the ends stay where
 * the data reaches, as shares stacked to fill the axis do.
 */
function linearScale(
  extent: Span,
  {
    domain = ['auto', 'auto'],
    tickCount = 5,
    nice: rounded = true,
    allowDecimals = true,
    tickValues,
  }: LinearScaleOptions = {},
): LinearScale {
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
    return linearOver(
      [low, high],
      [...tickValues]
        .filter((tick) => tick >= Math.min(low, high) && tick <= Math.max(low, high))
        .toSorted((a, b) => a - b),
    )
  }
  const marked = wholeTicks(low, high, tickCount, allowDecimals)
  return linearOver([low, high], marked, (count) =>
    count >= tickCount ? marked : wholeTicks(low, high, count, allowDecimals),
  )
}

/**
 * The scale of numbers from `domain[0]` to `domain[1]`, marking `marked`, and
 * `ticksFor` where its axis is short: the same ticks by default.
 */
function linearOver(
  domain: Span,
  marked: readonly number[],
  ticksFor: (count: number) => readonly number[] = () => marked,
): LinearScale {
  const [low, high] = domain
  return {
    kind: 'linear',
    domain,
    ticks: marked,
    ticksFor,
    place: (value) =>
      high === low ? 0 : Math.min(1, Math.max(0, (value - low) / (high - low))),
    valueAt: (fraction) => low + fraction * (high - low),
  }
}

/** `extent` stretched to take in `values` too, such as a reference line's. */
function extentWith(extent: Span, values: readonly number[]): Span {
  return [Math.min(extent[0], ...values), Math.max(extent[1], ...values)]
}

/**
 * `extent` stretched so `room` px are left past each end that has values on
 * it, along an axis `length` px long, for labels that sit beyond the bars.
 */
function extentWithRoom(extent: Span, room: number, length: number): Span {
  const [low, high] = extent
  const ends = (high > 0 ? 1 : 0) + (low < 0 ? 1 : 0)
  if (room <= 0 || ends === 0 || length <= room * ends) return extent
  const grow = ((high - low) * room) / (length - room * ends)
  return [low < 0 ? low - grow : low, high > 0 ? high + grow : high]
}

/**
 * The lowest and highest of `values`, numbers placed along an axis of their
 * own such as a scatter's, or 0 to 1 with none. Values that are all the same
 * get a range around them, a tenth of their size each way, so a single point
 * sits in the middle of the plot rather than in its corner.
 */
function numberExtent(values: readonly number[]): Span {
  if (values.length === 0) return [0, 1]
  const low = Math.min(...values)
  const high = Math.max(...values)
  if (low !== high) return [low, high]
  const room = Math.abs(low) / 10 || 1
  return [low - room, high + room]
}

/**
 * Where marks grow from on `scale`, as a fraction of the axis: `base`, zero
 * by default, held inside the axis's ends, so bars stand on the lower end of
 * a range above zero.
 */
function baselineOf(scale: LinearScale, base = 0): number {
  const [low, high] = scale.domain
  return scale.place(Math.min(Math.max(low, high), Math.max(Math.min(low, high), base)))
}

/**
 * About how many ticks an axis `length` px long has room for, at most
 * `count`: each at least `spacing` px from the next, and never fewer than
 * two. Before the axis is measured, `count`.
 */
function tickCountFor(count: number, length: number, spacing: number): number {
  if (length <= 0) return count
  return Math.max(2, Math.min(count, Math.floor(length / spacing)))
}

/** Which of an axis's ticks show while its length is at least `from` px and below `to`. */
interface TickStep {
  from: number
  /** Null past the longest step. */
  to: number | null
  shown: readonly number[]
}

/**
 * The ticks an axis draws, and which show at each of its lengths: `scale`'s
 * `ticksFor` the count of `spacing` px the axis holds, never fewer than two,
 * which d3 rounds to its nearest round step. A short axis shows coarser
 * round steps, such as 0, 5 and 10 in place of every 2, with the same range.
 * Container queries read the steps, so they are right from the first paint,
 * before the axis is measured. One step alone when the length changes none.
 */
function tickLadder(
  scale: LinearScale,
  spacing: number,
): { ticks: readonly number[]; steps: readonly TickStep[] } {
  const steps: TickStep[] = []
  for (let count = 2; ; count += 1) {
    const shown = scale.ticksFor(count)
    const last = steps.at(-1)
    const from = count === 2 ? 0 : count * spacing
    if (!last || !sameTicks(last.shown, shown)) {
      if (last) last.to = from
      steps.push({ from, to: null, shown })
    }
    if (shown === scale.ticks || sameTicks(shown, scale.ticks)) break
  }
  const ticks = [...new Set(steps.flatMap((step) => step.shown))].toSorted(
    (a, b) => a - b,
  )
  return { ticks, steps }
}

function sameTicks(a: readonly number[], b: readonly number[]) {
  return a.length === b.length && a.every((tick, at) => tick === b[at])
}

/** d3's round ticks, or with `allowDecimals` off, only the whole ones, at least a step of 1 apart. */
function wholeTicks(low: number, high: number, count: number, allowDecimals: boolean) {
  const round = ticks(low, high, count)
  if (allowDecimals) return round
  const whole = round.filter((tick) => Number.isInteger(tick))
  // Round ticks over a wide range are whole already, however few; only a step under 1 counts up by ones.
  if (whole.length >= 2 || whole.length === round.length) return whole
  const out: number[] = []
  for (let tick = Math.ceil(low); tick <= Math.floor(high); tick += 1) out.push(tick)
  return out
}

/**
 * How values placed by where they fall, sorted and each once, spread along
 * an axis: its ends, and the share of it a band takes. As points, the
 * first value is at the start and the last at the end; as bands with
 * `gaps`, each band is the closest two values' gap less the gap between
 * categories, with half a band and the outer gap of room at each end, so
 * values an even step apart lay out exactly as bands of categories do. One
 * value alone has `alone` on each side, as if its neighbours were that far.
 */
function spreadAlong(
  values: readonly number[],
  gaps: BandGaps | null,
  alone: number,
): { domain: Span; size: number } {
  const first = values[0]
  const last = values.at(-1)
  if (first === undefined || last === undefined) return { domain: [0, 1], size: 0 }
  let least = Number.POSITIVE_INFINITY
  for (let at = 1; at < values.length; at += 1)
    least = Math.min(least, values[at]! - values[at - 1]!)
  const step = values.length > 1 ? least : alone
  if (gaps === null) {
    return {
      domain: values.length > 1 ? [first, last] : [first - alone, first + alone],
      size: 0,
    }
  }
  const { gap = 0.3, outer = 0.15 } = gaps
  const room = step * (outer + (1 - gap) / 2)
  const domain: Span = [first - room, last + room]
  return { domain, size: (step * (1 - gap)) / (domain[1] - domain[0]) }
}

interface TimeScaleOptions {
  /** The clock ticks fall on: UTC for calendar values. */
  timeZone: string
  /** The day weeks start on, which a tick a week marks. */
  firstDay?: Weekday
  /** Bars stand on the times, these gaps apart; points, edge to edge, when null. */
  bands: BandGaps | null
}

/**
 * The scale of `times`, instants in ms in order, each once: from the first
 * to the last, or with room for bars at each end, with ticks on
 * `timeZone`'s calendar. With no times, the axis shows the first second of
 * 1970 and marks none.
 */
function timeScale(
  times: readonly number[],
  { timeZone, firstDay = 1, bands }: TimeScaleOptions,
): TimeScale {
  const unit = timeUnitOf(times, timeZone)
  const { domain, size } = spreadAlong(times, bands, unitLength(unit))
  const [low, high] = domain
  const span = high - low
  const tickSets =
    times.length === 0
      ? []
      : timeIntervals(span)
          // No tick finer than the times themselves: days get no 12:00.
          .filter(
            (interval) => unitLength(interval.unit) * interval.step >= unitLength(unit),
          )
          .map((interval) => timeTicks(domain, interval, timeZone, firstDay))
          .filter((set) => set.length > 0)
  const place = (time: number) =>
    span === 0 ? 0.5 : Math.min(1, Math.max(0, (time - low) / span))
  return {
    kind: 'time',
    domain,
    timeZone,
    unit,
    ticks: [...new Set(tickSets.flat())].toSorted((a, b) => a - b),
    tickSets,
    place,
    valueAt: (fraction) => low + fraction * span,
    bandOf: (time) => ({ start: place(time) - size / 2, size }),
  }
}

/**
 * The least length, in px, an axis needs for labels `widths` px wide at
 * `places`, fractions of it in order, to stand `gap` px apart or more, each
 * kept inside the axis as a name at either end is. Infinity when no length
 * up to 20,000 px does.
 */
function labelsLength(
  places: readonly number[],
  widths: readonly number[],
  gap: number,
): number {
  const fits = (length: number) =>
    places.every((place, at) => {
      const width = widths[at] ?? 0
      if (width > length) return false
      if (at === 0) return true
      const before = labelBox(places[at - 1]!, widths[at - 1] ?? 0, length)
      return !labelsMeet(before, labelBox(place, width, length), gap)
    })
  let high = 20_000
  if (!fits(high)) return Number.POSITIVE_INFINITY
  let low = 0
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2)
    if (fits(middle)) high = middle
    else low = middle
  }
  return high
}

/**
 * Every `k`th of `ticks` from the first, for each `k` from all of them down
 * to every other, coarsest first: what an axis too short for even its
 * coarsest calendar step shows, so its labels never overlap.
 */
function thinned(ticks: readonly number[]): (readonly number[])[] {
  const sets: (readonly number[])[] = []
  for (let k = ticks.length; k >= 2; k--) {
    const set = ticks.filter((_, at) => at % k === 0)
    if (set.length !== sets.at(-1)?.length) sets.push(set)
  }
  return sets
}

/**
 * The ticks an axis of times draws, and which show at each of its lengths:
 * of `scale`'s calendar steps, the finest whose labels, `width(tick)` px
 * wide, stand `gap` px apart at that length, without its ticks at the axis's
 * ends while only the ticks between fit. Below the coarsest step's own
 * length, every other of its ticks, or fewer, down to the first alone. Read
 * by container queries, as `tickLadder`'s are.
 */
function timeLadder(
  scale: TimeScale,
  width: (tick: number) => number,
  gap: number,
): { ticks: readonly number[]; steps: readonly TickStep[] } {
  const steps: TickStep[] = []
  let least = 0
  // A tick at either end of the axis is kept inside it, so it needs a step's room more than
  // the ticks between; each step is tried without those first, then whole.
  const inner = (set: readonly number[]) =>
    set.filter((tick) => scale.place(tick) > 0 && scale.place(tick) < 1)
  const candidates = [
    ...thinned(scale.tickSets[0] ?? []),
    ...scale.tickSets.flatMap((set) =>
      set.length > 2 && inner(set).length < set.length ? [inner(set), set] : [set],
    ),
  ]
  for (const set of candidates) {
    const need = labelsLength(set.map(scale.place), set.map(width), gap)
    const last = steps.at(-1)
    if (!last) {
      steps.push({ from: 0, to: null, shown: set })
      least = need
      continue
    }
    if (need === Number.POSITIVE_INFINITY) continue
    // A finer step that needs no more room than the one before takes its place.
    if (need <= least) {
      last.shown = set
      continue
    }
    // One that needs more room but shows no more ticks only moves them.
    if (set.length <= last.shown.length) continue
    last.to = need
    steps.push({ from: need, to: null, shown: set })
    least = need
  }
  const ticks = [...new Set(steps.flatMap((step) => step.shown))].toSorted(
    (a, b) => a - b,
  )
  return { ticks, steps }
}

/** The band of the category at `index` among `count`, in reading order, as d3's band scale lays it out. */
function bandAt(
  index: number,
  count: number,
  { gap = 0.3, outer = 0.15 }: BandGaps = {},
): Band {
  const step = 1 / Math.max(1, count - gap + outer * 2)
  return { start: step * (outer + index), size: step * (1 - gap) }
}

/** Where the category at `index` among `count` sits as a point: edge to edge, or the middle for one alone. */
function pointAt(index: number, count: number): Band {
  return { start: count <= 1 ? 0.5 : index / (count - 1), size: 0 }
}

/** The categories keyed `keys` as bands, `gaps` apart. */
function bandScale(keys: readonly string[], gaps: BandGaps = {}): CategoryScale {
  return categoryScale('band', keys, (index) => bandAt(index, keys.length, gaps))
}

/** The categories keyed `keys` as points, edge to edge. */
function pointScale(keys: readonly string[]): CategoryScale {
  return categoryScale('point', keys, (index) => pointAt(index, keys.length))
}

function categoryScale(
  kind: CategoryScale['kind'],
  keys: readonly string[],
  of: (index: number) => Band,
): CategoryScale {
  const centres = keys.map((_, index) => bandCentre(of(index)))
  const places = new Map(keys.map((key, index) => [key, centres[index]!]))
  return {
    kind,
    keys,
    bandAt: of,
    place: (key) => places.get(key) ?? null,
    valueAt: (fraction) => {
      const index = indexAt(fraction, centres)
      return index === null ? null : (keys[index] ?? null)
    },
  }
}

/** The centre of `band`, as a fraction from the reading start. */
function bandCentre(band: Band): number {
  return band.start + band.size / 2
}

/**
 * Which of `centres`, fractions of an axis from its reading start in
 * order, `at` is nearest: the next one from halfway between two; past the
 * ends, the first or last.
 */
function indexAt(at: number, centres: readonly number[]): number | null {
  if (centres.length === 0) return null
  // A binary search: the last centre whose halfway point from the one before is at or before `at`.
  let low = 0
  let high = centres.length - 1
  while (low < high) {
    const middle = (low + high + 1) >> 1
    if (at >= (centres[middle - 1]! + centres[middle]!) / 2) low = middle
    else high = middle - 1
  }
  return low
}

/** What tells two scales apart, so what follows a scale moves only when it changes. */
function scaleSignature(scale: ChartScale): string {
  if (scale.kind === 'linear')
    return `linear|${scale.domain.join()}|${scale.ticks.join()}`
  if (scale.kind === 'time')
    return `time|${scale.timeZone}|${scale.domain.join()}|${scale.ticks.join()}`
  return `${scale.kind}|${scale.keys.join('\u0000')}`
}

export {
  type Band,
  type BandGaps,
  bandAt,
  bandCentre,
  bandScale,
  baselineOf,
  type CategoryScale,
  type ChartScale,
  type DomainEnd,
  extentWith,
  extentWithRoom,
  indexAt,
  linearOver,
  linearScale,
  type LinearScale,
  type LinearScaleOptions,
  numberExtent,
  pointAt,
  pointScale,
  scaleSignature,
  labelsLength,
  spreadAlong,
  tickCountFor,
  tickLadder,
  type TickStep,
  timeLadder,
  timeScale,
  type TimeScale,
  type TimeScaleOptions,
}
