import {
  allWhole,
  type ChartConfig,
  type ChartDatum,
  type ChartMark,
  type ChartStack,
  numberOf,
  type Span,
  type XYValue,
} from '@/registry/lib/chart-math'
import {
  type Band,
  type BandGaps,
  bandScale,
  baselineOf,
  type ChartScale,
  type DomainEnd,
  extentWith,
  extentWithRoom,
  linearScale,
  type LinearScale,
  numberExtent,
  pointScale,
  timeScale,
  type TimeScaleOptions,
} from '@/registry/lib/chart-scale'
import { readTime, type Weekday } from '@/registry/lib/dates'

/*
 * The cartesian frame: an x axis, one or more value axes and the marks
 * between them. Each series says in the config what it is drawn as and
 * which value axis it is read against; each kind of mark works out its own
 * series' spans, stacked among themselves, and the frame fits every axis to
 * what its series and reference lines reach. One pure function of the props,
 * so the server draws the same range the browser does. The kinds of mark
 * are in files of their own, and a chart hands the frame only the kinds it
 * draws.
 */

/** Each series' span in every row, null for a missing value. */
type SeriesSpans = Readonly<Record<string, readonly (Span | null)[]>>

/** What a kind of mark works out from the values of its series on one value axis. */
interface MarkKind {
  mark: ChartMark
  /** Whether its series stack when the chart stacks, as bars and areas do; lines and points never do. */
  stacks: boolean
  /**
   * Each of `series`' span in every row of `rows`, in its axis's units: a
   * hidden one where it would sit, so it leaves from there and comes back to
   * it. `extent` is what the `shown` ones reach, null with nothing to show.
   * Series with the same `stackOf` stack together, when the chart stacks.
   */
  spans: (input: {
    rows: readonly ChartDatum[]
    series: readonly string[]
    shown: readonly string[]
    stack: ChartStack
    stackOf: (key: string) => string
  }) => { spans: SeriesSpans; extent: Span | null }
  /**
   * How far row `index`'s marks of the `shown` series reach on `scale`, as
   * a fraction of the axis: where the tooltip sits over them. Null where none
   * has a value.
   */
  reach: (
    spans: SeriesSpans,
    shown: readonly string[],
    index: number,
    scale: LinearScale,
  ) => number | null
}

/** How a value axis fits what it shows. */
interface ValueAxisOptions {
  /** The values at its ends; `'auto'` fits what its series reach. */
  domain?: readonly [DomainEnd, DomainEnd]
  /** About how many ticks it marks, and its ends round out to. */
  tickCount?: number
  /** The ticks it marks, in place of round ones. */
  tickValues?: readonly number[]
  /** Ticks between whole numbers; by default, only where a value isn't whole. */
  allowDecimals?: boolean
  /** Round the ends left to fit out to the next tick. */
  nice?: boolean
  /** Keep zero in the range, so marks read in proportion. */
  zero?: boolean
  /** The value marks grow from, held inside the range; zero by default. */
  base?: number
}

/** What runs along the x axis: the rows' categories in order, a number of each row's, or a time. */
type CartesianX =
  | { kind: 'category'; keys: readonly string[]; gaps?: BandGaps }
  | {
      kind: 'time'
      /** The key of each row's time. */
      key: string
      /** The clock instants are written on; calendar values are written on UTC's, which names no zone. */
      timeZone: string
      /** The day weeks start on. */
      firstDay?: Weekday
      gaps?: BandGaps
      /** The stretch of time the plot shows, when it shows less than its rows, as a live chart does: see `timeScale`. */
      window?: TimeScaleOptions['window']
    }
  | {
      kind: 'number'
      /** The key of each row's value along the x axis. */
      key: string
      domain?: readonly [DomainEnd, DomainEnd]
      tickCount?: number
      /** Ticks between whole numbers; by default, only where a value isn't whole. */
      allowDecimals?: boolean
    }

/** A value a reference line or area marks, which its axis reaches. */
interface ChartReference {
  /** `'x'`, or a value axis's id. */
  axis: string
  value: number
}

interface CartesianInput {
  /** The rows drawn, in order. */
  rows: readonly ChartDatum[]
  config: ChartConfig
  hidden: readonly string[]
  /** The kinds of mark the chart draws, its own first: a series that names no mark is drawn as that. */
  kinds: readonly [MarkKind, ...MarkKind[]]
  stack: ChartStack
  x: CartesianX
  /** The chart's own value axis, `'value'`; any other a series names fits what it reaches. */
  y: ValueAxisOptions
  references: readonly ChartReference[]
  /** The px kept past the ends of the chart's own value axis, `length` px long, for labels beyond the bars. */
  room: { px: number; length: number }
}

interface CartesianModel {
  x: ChartScale
  /** Each value axis's scale, by its id; the chart's own, `value`, always. */
  y: Readonly<Record<string, LinearScale>> & { value: LinearScale }
  /** Where marks grow from on each value axis, as a fraction of it. */
  baselines: Readonly<Record<string, number>> & { value: number }
  /** The band the row at `index` stands in along x: its category's, or centred on its time; none along numbers, where rows are points. */
  bandOf: (index: number) => Band
  /** The kind of mark of a series. */
  markOf: (key: string) => ChartMark
  /** The id of the value axis a series is read against. */
  axisOf: (key: string) => string
  /** The scale of the value axis a series is read against, and where its marks grow from on it, as a fraction of it. */
  valueAxisOf: (key: string) => { scale: LinearScale; baseline: number }
  /** The stack a series stacks in, which only its own kind of mark on its axis shares. */
  stackOf: (key: string) => string
  /** Each series' span in every row, a hidden one where it would sit. */
  spans: SeriesSpans
  /** How far row `index`'s shown marks reach, as a fraction of the value axis, or null with none. */
  reach: (index: number) => number | null
  /**
   * Row `index` as a point placed by both values, on a numeric x axis: its x
   * value and its highest shown value, and where they sit along x and up
   * their value axis, as fractions of each. Null along categories, or where
   * no shown series has a value.
   */
  point: (index: number) => { value: XYValue; place: XYValue } | null
}

/** The id of the chart's own value axis, which a series reads unless it names another. */
const VALUE_AXIS = 'value'

/**
 * The frame of a cartesian chart from its props: the x scale, a scale for
 * each value axis, each series' spans and where the tooltip sits. Throws
 * when a series names a mark the chart doesn't draw.
 */
function cartesianModel(input: CartesianInput): CartesianModel {
  const { config, hidden, kinds, stack, x, y } = input
  const series = Object.keys(config)
  const [own] = kinds
  const kindOf = new Map(kinds.map((kind) => [kind.mark, kind]))
  const markOf = (key: string): ChartMark => config[key]?.mark ?? own.mark
  for (const key of series) {
    if (!kindOf.has(markOf(key))) {
      throw new Error(
        `The series \`${key}\` is drawn as \`${markOf(key)}\` in the config, which this chart doesn't draw. Draw it in a chart that does, such as the Composed chart.`,
      )
    }
  }
  const axisOf = (key: string) => config[key]?.axis ?? VALUE_AXIS
  if (stack === 'expand') {
    // Shares of a whole and raw values can't share one axis.
    const stacked = new Set(
      series.filter((key) => kindOf.get(markOf(key))?.stacks).map(axisOf),
    )
    const raw = series.find(
      (key) => !kindOf.get(markOf(key))?.stacks && stacked.has(axisOf(key)),
    )
    if (raw !== undefined) {
      throw new Error(
        `The series \`${raw}\` is drawn as \`${markOf(raw)}\`, which doesn't stack, on the axis \`${axisOf(raw)}\` that the chart stacks as shares of 100%. Give it an \`axis\` of its own in the config.`,
      )
    }
  }
  const stackOf = (key: string) => `${axisOf(key)}\u0000${config[key]?.stack ?? ''}`
  const { rows } = input
  const shown = series.filter((key) => !hidden.includes(key))
  const axes = [...new Set([VALUE_AXIS, ...series.map(axisOf)])]

  const spans: Record<string, readonly (Span | null)[]> = {}
  const extents = new Map<string, Span[]>()
  const groups = axes.flatMap((axis) =>
    kinds.map((kind) => ({
      axis,
      kind,
      series: series.filter((key) => axisOf(key) === axis && markOf(key) === kind.mark),
    })),
  )
  for (const group of groups) {
    if (group.series.length === 0) continue
    const out = group.kind.spans({
      rows,
      series: group.series,
      shown: group.series.filter((key) => shown.includes(key)),
      stack,
      stackOf,
    })
    Object.assign(spans, out.spans)
    if (out.extent)
      extents.set(group.axis, [...(extents.get(group.axis) ?? []), out.extent])
  }

  const fit = (axis: string): LinearScale => {
    const options = axis === VALUE_AXIS ? y : {}
    const reached = extents.get(axis) ?? []
    let extent: Span = reached.length
      ? [Math.min(...reached.map((e) => e[0])), Math.max(...reached.map((e) => e[1]))]
      : [0, 0]
    if (options.zero ?? true) extent = extentWith(extent, [0])
    extent = extentWith(
      extent,
      input.references.filter((ref) => ref.axis === axis).map((ref) => ref.value),
    )
    if (axis === VALUE_AXIS)
      extent = extentWithRoom(extent, input.room.px, input.room.length)
    const onAxis = shown.filter((key) => axisOf(key) === axis)
    return linearScale(extent, {
      domain: options.domain,
      tickCount: options.tickCount,
      tickValues: options.tickValues,
      nice: options.nice ?? stack !== 'expand',
      allowDecimals:
        options.allowDecimals ?? (stack === 'expand' || !allWhole(rows, onAxis)),
    })
  }
  const value = fit(VALUE_AXIS)
  const scales: CartesianModel['y'] = {
    ...Object.fromEntries(
      axes.filter((axis) => axis !== VALUE_AXIS).map((axis) => [axis, fit(axis)]),
    ),
    value,
  }
  const baselines: CartesianModel['baselines'] = {
    ...Object.fromEntries(
      Object.entries(scales).map(([axis, scale]) => [
        axis,
        baselineOf(scale, axis === VALUE_AXIS ? y.base : undefined),
      ]),
    ),
    value: baselineOf(value, y.base),
  }

  const xValues = x.kind === 'number' ? input.rows.map((row) => numberOf(row[x.key])) : []
  const times = x.kind === 'time' ? rowTimes(rows, x.key) : null
  const hasBars = Object.keys(config).some((key) => markOf(key) === 'bar')
  const xScale =
    x.kind === 'time' && times
      ? timeScale(times.times, {
          timeZone: times.instants ? x.timeZone : 'UTC',
          firstDay: x.firstDay,
          bands: hasBars ? (x.gaps ?? {}) : null,
          window: x.window,
        })
      : xScaleOf(input, xValues, hasBars)

  return {
    x: xScale,
    bandOf: (index) => {
      if (xScale.kind === 'time') return xScale.bandOf(times?.times[index] ?? 0)
      return xScale.kind === 'linear' ? NO_BAND : xScale.bandAt(index)
    },
    y: scales,
    baselines,
    markOf,
    axisOf,
    valueAxisOf: (key) => {
      const axis = axisOf(key)
      const scale = scales[axis]
      const baseline = baselines[axis]
      // A key the config doesn't name is read against the chart's own axis.
      return scale !== undefined && baseline !== undefined
        ? { scale, baseline }
        : { scale: scales.value, baseline: baselines.value }
    },
    stackOf,
    spans,
    reach: (index) => {
      let far: number | null = null
      for (const group of groups) {
        const scale = scales[group.axis]
        const onIt = group.series.filter((key) => shown.includes(key))
        if (!scale || onIt.length === 0) continue
        const reach = group.kind.reach(spans, onIt, index, scale)
        if (reach !== null) far = far === null ? reach : Math.max(far, reach)
      }
      return far
    },
    point: (index) => {
      const x = xValues[index]
      if (xScale.kind !== 'linear' || x === undefined || x === null) return null
      let top: { value: number; place: number } | null = null
      for (const key of shown) {
        const span = spans[key]?.[index]
        const scale = scales[axisOf(key)]
        if (!span || !scale) continue
        const place = scale.place(span[1])
        if (!top || place > top.place) top = { value: span[1], place }
      }
      return (
        top && {
          value: { x, y: top.value },
          place: { x: xScale.place(x), y: top.place },
        }
      )
    },
  }
}

/**
 * The x scale: along categories, a band for each when any series is a bar,
 * declared rather than shown, so hiding the bars never moves the rest, or
 * else points from edge to edge; along numbers, a range fitted to them.
 */
function xScaleOf(
  input: CartesianInput,
  values: readonly (number | null)[],
  hasBars: boolean,
): ChartScale {
  const { x } = input
  if (x.kind === 'category')
    return hasBars ? bandScale(x.keys, x.gaps) : pointScale(x.keys)
  if (x.kind === 'time') throw new Error('An x of times has a scale of its own.')
  const numbers = values.filter((value) => value !== null)
  const tickCount = x.tickCount ?? 5
  return linearScale(
    extentWith(
      numberExtent(numbers),
      input.references.filter((ref) => ref.axis === 'x').map((ref) => ref.value),
    ),
    {
      domain: x.domain,
      tickCount,
      allowDecimals: x.allowDecimals ?? !numbers.every(Number.isInteger),
    },
  )
}

/** The band of a row on an x of numbers, which places it by its value instead. */
const NO_BAND: Band = { start: 0, size: 0 }

/**
 * The time of each of `rows` under `key`, read once, and whether they are
 * instants rather than calendar values. Throws, naming the row, on one with
 * no time, on calendar values and instants together, and on times out of
 * order or repeated, which a line couldn't run through in order.
 */
function rowTimes(
  rows: readonly ChartDatum[],
  key: string,
): { times: readonly number[]; instants: boolean } {
  const times: number[] = []
  let instants: boolean | null = null
  for (const [at, row] of rows.entries()) {
    const read = readTime(row[key])
    if (!read) {
      throw new Error(
        `Row ${at} has no time under \`${key}\`: give a \`yyyy-mm-dd\` date, a \`yyyy-mm\` month, a \`yyyy-mm-ddTHH:mm\` time, an ISO instant, a \`Date\` or milliseconds.`,
      )
    }
    if (instants !== null && instants !== read.instant) {
      throw new Error(
        `Row ${at}'s time under \`${key}\` is ${read.instant ? 'an instant' : 'a calendar value'}, and the rows before it are ${instants ? 'instants' : 'calendar values'}: give them all one way.`,
      )
    }
    instants = read.instant
    const before = times.at(-1)
    if (before !== undefined && read.time <= before) {
      throw new Error(
        `Row ${at}'s time under \`${key}\` ${read.time === before ? 'repeats the one before it' : 'comes before the one before it'}: give the rows in time order, each time once.`,
      )
    }
    times.push(read.time)
  }
  return { times, instants: instants ?? false }
}

export {
  type CartesianInput,
  type CartesianModel,
  cartesianModel,
  type CartesianX,
  type ChartReference,
  type MarkKind,
  type SeriesSpans,
  VALUE_AXIS,
  type ValueAxisOptions,
}
