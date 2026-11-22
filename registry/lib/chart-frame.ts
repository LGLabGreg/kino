import {
  allWhole,
  type ChartConfig,
  type ChartDatum,
  type ChartMark,
  type ChartStack,
  numberOf,
  type SeriesValueOf,
  type Span,
  type XYValue,
} from '@/registry/lib/chart-math'
import {
  alignScales,
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
import { isoInstant, readTime, type Weekday } from '@/registry/lib/dates'

/*
 * The cartesian frame: an x axis, one or more value axes and the marks
 * between them. Each series says in the config what it is drawn as and
 * which value axis it is read against; each kind of mark works out its own
 * series' spans, stacked among themselves, and the frame fits every axis to
 * what its series and reference lines reach. One pure function of the props,
 * so the server draws the same range the browser does. The kinds of mark
 * are in files of their own, and a chart hands the frame only the kinds it
 * draws. On an x of times, a series may bring rows of its own, such as a
 * trend or a second stream: the stops are every dataset's times joined
 * (`joinStops`), and each series is read from its own rows.
 */

/** Each series' span in every row, null for a missing value. */
type SeriesSpans = Readonly<Record<string, readonly (Span | null)[]>>

/** What a kind of mark works out from the values of its series on one value axis. */
interface MarkKind {
  mark: ChartMark
  /** Whether its series stack when the chart stacks, as bars and areas do; lines and points never do. */
  stacks: boolean
  /**
   * Each of `series`' span at each of `count` stops, from its value there
   * (`valueOf`), in its axis's units: a hidden one where it would sit, so it
   * leaves from there and comes back to it. `extent` is what the `shown`
   * ones reach, null with nothing to show. Series with the same `stackOf`
   * stack together, when the chart stacks.
   */
  spans: (input: {
    count: number
    valueOf: SeriesValueOf
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
  /**
   * On an axis other than the chart's own, its ticks on the own axis's
   * gridlines, with the zeros lined up (`alignScales`); on by default. Off
   * fits it to its series alone.
   */
  align?: boolean
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
  /** The rows of each series that brings its own, by its key, on an x of times: drawn from them in place of `rows`. */
  own: Readonly<Record<string, readonly ChartDatum[]>>
  config: ChartConfig
  hidden: readonly string[]
  /** The kinds of mark the chart draws, its own first: a series that names no mark is drawn as that. */
  kinds: readonly [MarkKind, ...MarkKind[]]
  stack: ChartStack
  x: CartesianX
  /** The chart's own value axis, `'value'`. */
  y: ValueAxisOptions
  /** Every other value axis a series names, by its id; one not here fits what it reaches. */
  axes?: Readonly<Record<string, ValueAxisOptions>>
  references: readonly ChartReference[]
  /** The px kept past the ends of the chart's own value axis, `length` px long, for labels beyond the bars. */
  room: { px: number; length: number }
}

interface CartesianModel {
  x: ChartScale
  /** How many stops there are along x: the rows, or on an x of times, every dataset's times joined. */
  count: number
  /** On an x of times, each stop: its time, and the rows there; null on other axes, whose stops are the rows. */
  timeStops: readonly JoinedStop[] | null
  /** On an x of times, a dataset's times (`JoinedStops.timesOf`); null on other axes. */
  timesOf: JoinedStops['timesOf'] | null
  /** The row `key` is drawn from at stop `index`: its own, or the chart's for a series with none; null where it has none. */
  rowOf: (key: string, index: number) => ChartDatum | null
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
  /** Whether a series adds to its category's total: a mark that stacks, read against the chart's own value axis, with no rows of its own. */
  totals: (key: string) => boolean
  /** The scale of the value axis a series is read against, and where its marks grow from on it, as a fraction of it. */
  valueAxisOf: (key: string) => { scale: LinearScale; baseline: number }
  /** The stack a series stacks in, which only its own kind of mark on its axis shares; one with rows of its own stacks alone. */
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

/**
 * Where each kind of mark's layers stack on the plot, whatever order their
 * parts are written in: areas at the back, then bars, lines and points, so
 * a fill never covers a bar and a line or a point is never hidden by one.
 * Reference areas sit behind them all, and reference lines and labels
 * above.
 */
const markLayer = {
  area: 'z-6',
  bar: 'z-8',
  line: 'z-10',
  point: 'z-12',
} as const satisfies Record<ChartMark, string>

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
  const { rows } = input
  // A series with rows of its own has values at its own times only, so it stacks with nothing.
  const hasOwn = (key: string) => Object.hasOwn(input.own, key)
  const stacks = (key: string) =>
    (kindOf.get(markOf(key))?.stacks ?? false) && !hasOwn(key)
  if (stack === 'expand') {
    // Shares of a whole and raw values can't share one axis.
    const stacked = new Set(series.filter(stacks).map(axisOf))
    const raw = series.find((key) => !stacks(key) && stacked.has(axisOf(key)))
    if (raw !== undefined) {
      throw new Error(
        hasOwn(raw)
          ? `The series \`${raw}\` brings rows of its own, which stack with nothing, on the axis \`${axisOf(raw)}\` that the chart stacks as shares of 100%. Give it an \`axis\` of its own in the config.`
          : `The series \`${raw}\` is drawn as \`${markOf(raw)}\`, which doesn't stack, on the axis \`${axisOf(raw)}\` that the chart stacks as shares of 100%. Give it an \`axis\` of its own in the config.`,
      )
    }
  }
  const stackOf = (key: string) =>
    hasOwn(key)
      ? `${axisOf(key)}\u0000\u0001${key}`
      : `${axisOf(key)}\u0000${config[key]?.stack ?? ''}`
  if (Object.keys(input.own).length > 0 && x.kind !== 'time') {
    throw new Error(
      "A series' own rows need an x of times: give the chart `indexType='time'`.",
    )
  }
  const joined = x.kind === 'time' ? joinStops(rows, input.own, x.key) : null
  const count = joined ? joined.stops.length : rows.length
  const rowOf = joined
    ? joined.rowOf
    : (_key: string, index: number) => rows[index] ?? null
  const valueOf: SeriesValueOf = (key, index) => rowOf(key, index)?.[key]
  const shown = series.filter((key) => !hidden.includes(key))
  const axes = [...new Set([VALUE_AXIS, ...series.map(axisOf)])]

  const spans: Record<string, readonly (Span | null)[]> = {}
  const extents = new Map<string, Span[]>()
  // Each kind of mark on each axis, and apart from them, its series with rows of their own,
  // which stack with nothing.
  const groups = axes.flatMap((axis) =>
    kinds.flatMap((kind) =>
      [false, true].map((alone) => ({
        axis,
        kind,
        stack: alone ? ('none' as const) : stack,
        series: series.filter(
          (key) =>
            axisOf(key) === axis && markOf(key) === kind.mark && hasOwn(key) === alone,
        ),
      })),
    ),
  )
  for (const group of groups) {
    if (group.series.length === 0) continue
    const out = group.kind.spans({
      count,
      valueOf,
      series: group.series,
      shown: group.series.filter((key) => shown.includes(key)),
      stack: group.stack,
      stackOf,
    })
    Object.assign(spans, out.spans)
    if (out.extent)
      extents.set(group.axis, [...(extents.get(group.axis) ?? []), out.extent])
  }

  const optionsOf = (axis: string): ValueAxisOptions =>
    axis === VALUE_AXIS ? y : (input.axes?.[axis] ?? {})
  const fit = (axis: string): { scale: LinearScale; extent: Span } => {
    const options = optionsOf(axis)
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
    const scale = linearScale(extent, {
      domain: options.domain,
      tickCount: options.tickCount,
      tickValues: options.tickValues,
      nice: options.nice ?? stack !== 'expand',
      allowDecimals: allowDecimalsOn(axis),
    })
    return { scale, extent }
  }
  const allowDecimalsOn = (axis: string) =>
    optionsOf(axis).allowDecimals ??
    (stack === 'expand' ||
      !shown
        .filter((key) => axisOf(key) === axis)
        .every((key) => allWhole(input.own[key] ?? rows, [key])))
  const ownAxis = fit(VALUE_AXIS)
  const others = axes.filter((axis) => axis !== VALUE_AXIS)
  const fitted = new Map(others.map((axis) => [axis, fit(axis)]))
  const scales: Record<string, LinearScale> & { value: LinearScale } = {
    ...Object.fromEntries(others.map((axis) => [axis, fitted.get(axis)!.scale])),
    value: ownAxis.scale,
  }
  // Each other axis's ticks fall on the own axis's gridlines; once one has widened the own axis,
  // every axis lines up again with it held, so they all share its gridlines.
  // An axis lines up only with what shows: one whose series are all hidden, or any while the own
  // axis shows nothing, keeps its own fit.
  const showing = (axis: string) => shown.some((key) => axisOf(key) === axis)
  const aligned = showing(VALUE_AXIS)
    ? others.filter((axis) => (optionsOf(axis).align ?? true) && showing(axis))
    : []
  for (const hold of [false, true]) {
    for (const axis of aligned) {
      const second = fitted.get(axis)!
      const out = alignScales(
        {
          scale: scales.value,
          extent: ownAxis.extent,
          // Shares of a whole always run to the whole, so the own axis never widens past it.
          domain:
            hold || stack === 'expand'
              ? [scales.value.domain[0], scales.value.domain[1]]
              : y.domain,
        },
        {
          extent: second.extent,
          domain: optionsOf(axis).domain,
          allowDecimals: allowDecimalsOn(axis),
        },
      )
      if (!out) continue
      scales.value = out.primary
      scales[axis] = out.second
    }
  }
  const value = scales.value
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
  const bars = series.filter((key) => markOf(key) === 'bar')
  const times = joined?.stops.map((stop) => stop.time) ?? []
  const xScale =
    x.kind === 'time' && joined
      ? timeScale(times, {
          timeZone: joined.instants ? x.timeZone : 'UTC',
          firstDay: x.firstDay,
          // The bars stand on the times their series have rows at, so a line's own rows
          // between them never make them thinner.
          bands:
            bars.length > 0
              ? {
                  gaps: x.gaps ?? {},
                  times: times.filter((_, at) =>
                    bars.some((key) => joined.rowOf(key, at) !== null),
                  ),
                }
              : null,
          window: x.window,
        })
      : xScaleOf(input, xValues, bars.length > 0)

  return {
    x: xScale,
    count,
    timeStops: joined?.stops ?? null,
    timesOf: joined?.timesOf ?? null,
    rowOf,
    bandOf: (index) => {
      if (xScale.kind === 'time') return xScale.bandOf(times[index] ?? 0)
      return xScale.kind === 'linear' ? NO_BAND : xScale.bandAt(index)
    },
    y: scales,
    baselines,
    markOf,
    axisOf,
    totals: (key) => axisOf(key) === VALUE_AXIS && stacks(key),
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
 * A row's key along an x of times: a calendar value's own text, so a day
 * keeps the key it has along categories, as charts synced with one share
 * it, and an instant's ISO form, whatever form it is given in.
 */
function timeKey(value: unknown) {
  const read = readTime(value)
  return read?.instant ? isoInstant(read.time) : String(value)
}

/** A place along an x of times where one dataset or more has a row. */
interface JoinedStop {
  /** The time's key (`timeKey`), as the first dataset with a row there writes it, the chart's own first. */
  key: string
  /** That dataset's value under the chart's `index`. */
  value: unknown
  /** In ms. */
  time: number
  /** The chart's own row here, or null. */
  datum: ChartDatum | null
  /** The row here of each series with rows of its own that has one. */
  own: Readonly<Record<string, ChartDatum>>
}

interface JoinedStops {
  /** In time order, each time once. */
  stops: readonly JoinedStop[]
  /** The row `series` is drawn from at stop `index`: its own, or the chart's for a series with none; null where it has none. */
  rowOf: (series: string, index: number) => ChartDatum | null
  /** Whether the times are instants rather than calendar values. */
  instants: boolean
  /** A dataset's times in ms, in its rows' order: the chart's own rows for null, else a series' own. */
  timesOf: (series: string | null) => readonly number[]
}

/**
 * Every dataset's times joined into the stops, in time order: the chart's
 * own `rows`, then each series' `own`, joined by their time in ms, so
 * `2026-01` and `2026-01-01` are one stop. Throws, naming the row, on one
 * with no time under `index`, or out of order, or repeated, and on calendar
 * values and instants together, which are read on two clocks.
 */
function joinStops(
  rows: readonly ChartDatum[],
  own: Readonly<Record<string, readonly ChartDatum[]>>,
  index: string,
): JoinedStops {
  const datasets = [
    { series: null, rows },
    ...Object.entries(own).map(([series, rows]) => ({ series, rows })),
  ]
  const byTime = new Map<
    number,
    Omit<JoinedStop, 'datum' | 'own'> & {
      datum: ChartDatum | null
      own: Record<string, ChartDatum>
    }
  >()
  let instants: { instant: boolean; series: string | null } | null = null
  const timesBy = new Map<string | null, readonly number[]>()
  for (const { series, rows } of datasets) {
    const read = datasetTimes(rows, index, series)
    timesBy.set(series, read.times)
    if (read.instants !== null) {
      if (instants && instants.instant !== read.instants) {
        const way = (instant: boolean) => (instant ? 'instants' : 'calendar values')
        throw new Error(
          `${datasetName(instants.series)} holds ${way(instants.instant)} under \`${index}\`, and ${datasetName(series)} holds ${way(read.instants)}: give them all one way.`,
        )
      }
      instants ??= { instant: read.instants, series }
    }
    for (const [at, time] of read.times.entries()) {
      const row = rows[at]!
      let stop = byTime.get(time)
      if (!stop) {
        stop = { key: timeKey(row[index]), value: row[index], time, datum: null, own: {} }
        byTime.set(time, stop)
      }
      if (series === null) stop.datum = row
      else stop.own[series] = row
    }
  }
  const stops: readonly JoinedStop[] = [...byTime.values()].toSorted(
    (a, b) => a.time - b.time,
  )
  return {
    stops,
    rowOf: (series, at) => {
      const stop = stops[at]
      if (!stop) return null
      return Object.hasOwn(own, series) ? (stop.own[series] ?? null) : stop.datum
    },
    instants: instants?.instant ?? false,
    timesOf: (series) => timesBy.get(series) ?? [],
  }
}

/**
 * The row of a series' that the tooltip and what is read out give at a
 * stop at `time`, as its place among `times`, the series' rows' times in
 * order: the one exactly there, or else its nearest within half the smaller
 * of `gaps`, its own rows' usual gap and the chart's rows' (`usualGap`), so
 * two streams stamped apart read as one moment while a trend of two points
 * over a hundred days shows at its two points alone. A gap that isn't known
 * (null) isn't used; with neither, only a row exactly there. The earlier
 * row on a tie; null past that.
 */
function nearestRow(
  times: readonly number[],
  time: number,
  gaps: { own: number | null; chart: number | null },
): number | null {
  // The first row at `time` or after it.
  let low = 0
  let high = times.length
  while (low < high) {
    const middle = (low + high) >> 1
    if (times[middle]! < time) low = middle + 1
    else high = middle
  }
  if (times[low] === time) return low
  const known = [gaps.own, gaps.chart].filter((gap) => gap !== null)
  if (known.length === 0) return null
  const reach = Math.min(...known) / 2
  const before = low - 1
  const near = [before, low].filter(
    (at) => at >= 0 && at < times.length && Math.abs(times[at]! - time) <= reach,
  )
  if (near.length === 0) return null
  // The earlier on a tie, as `before` comes first.
  return near.reduce((best, at) =>
    Math.abs(times[at]! - time) < Math.abs(times[best]! - time) ? at : best,
  )
}

/** How an error names a dataset: the chart's own rows, or a series' own. */
function datasetName(series: string | null) {
  return series === null ? "The chart's `data`" : `The series \`${series}\`'s \`data\``
}

/**
 * The time of each of `rows` under `key`, read once, and whether they are
 * instants rather than calendar values, or null with no rows. Throws,
 * naming the row of `series`' data or the chart's, on one with no time, on
 * calendar values and instants together, and on times out of order or
 * repeated, which a line couldn't run through in order.
 */
function datasetTimes(
  rows: readonly ChartDatum[],
  key: string,
  series: string | null,
): { times: readonly number[]; instants: boolean | null } {
  const times: number[] = []
  let instants: boolean | null = null
  const name = (at: number) =>
    series === null ? `Row ${at}` : `Row ${at} of the series \`${series}\`'s \`data\``
  for (const [at, row] of rows.entries()) {
    const read = readTime(row[key])
    if (!read) {
      throw new Error(
        `${name(at)} has no time under \`${key}\`: give a \`yyyy-mm-dd\` date, a \`yyyy-mm\` month, a \`yyyy-mm-ddTHH:mm\` time, an ISO instant, a \`Date\` or milliseconds.`,
      )
    }
    if (instants !== null && instants !== read.instant) {
      throw new Error(
        `${name(at)}'s time under \`${key}\` is ${read.instant ? 'an instant' : 'a calendar value'}, and the rows before it are ${instants ? 'instants' : 'calendar values'}: give them all one way.`,
      )
    }
    instants = read.instant
    const before = times.at(-1)
    if (before !== undefined && read.time <= before) {
      throw new Error(
        `${name(at)}'s time under \`${key}\` ${read.time === before ? 'repeats the one before it' : 'comes before the one before it'}: give the rows in time order, each time once.`,
      )
    }
    times.push(read.time)
  }
  return { times, instants }
}

export {
  type CartesianInput,
  type CartesianModel,
  cartesianModel,
  type CartesianX,
  type ChartReference,
  type JoinedStop,
  type JoinedStops,
  joinStops,
  markLayer,
  type MarkKind,
  nearestRow,
  type SeriesSpans,
  timeKey,
  VALUE_AXIS,
  type ValueAxisOptions,
}
