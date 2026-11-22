'use client'

import {
  type ActiveIndexProps,
  type CategoryChartProps,
  ChartAxesContext,
  type ChartAxesValue,
  type ChartForecast,
  type ChartFrame,
  type ChartParts,
  ChartPartsContext,
  chartParts,
  type ChartWords,
  checkSeries,
  type EntrancePhase,
  IndexActive,
  isForecast,
  localeTag,
  rowsShown,
  SeriesWordsContext,
  type SeriesWordsInput,
  timeKey,
  useChartActive,
  useChartLife,
  useChartLoad,
  useChartPick,
  useIndexFocus,
  useLeavingItems,
  usePreviousScales,
  writeDatum,
} from '@/registry/lib/chart-base'
import {
  type CartesianBrowse,
  type CartesianPoint,
  cartesianReader,
  type CartesianStop,
  liveReader,
} from '@/registry/lib/chart-cartesian-reader'
import {
  type CartesianModel,
  type CartesianX,
  cartesianModel,
  type ChartReference,
  type MarkKind,
  VALUE_AXIS,
  type ValueAxisOptions,
} from '@/registry/lib/chart-frame'
import { useLiveClock } from '@/registry/lib/chart-live-clock'
import {
  changeSince,
  type ChartDatum,
  type ChartMark,
  type ChartOrientation,
  type ChartStack,
  numberOf,
} from '@/registry/lib/chart-math'
import {
  ChartFrame as RootFrame,
  type ChartFormat,
  type ChartItem,
  type ChartPoint,
  type ChartRootState,
  type ChartRootValue,
  formatterOf,
  useChartRoot,
} from '@/registry/lib/chart-root'
import type { BandGaps } from '@/registry/lib/chart-scale'
import type { ChartStatus, ChartTable } from '@/registry/lib/chart-state'
import {
  onOneDay,
  readTime,
  timeLabel,
  useLocale,
  useTimeZone,
  weekStart,
} from '@/registry/lib/dates'
import {
  type ComponentProps,
  createContext,
  type ReactNode,
  use,
  useLayoutEffect,
  useState,
} from 'react'

/*
 * The cartesian family: the charts whose marks stand between an x axis and
 * one or more value axes, such as bars, lines, areas and points. It keeps
 * the stops along x and the ones leaving, the frame the cartesian model
 * fits to the rows (`chart-frame`), what the parts inside a chart declare,
 * and how values are written, and hands the root the cartesian reader
 * (`chart-cartesian-reader`). Its parts read it with `useCartesian()`.
 */

/* What the parts written inside a chart declare. */

/**
 * What a part written inside a chart tells it before anything draws, so the
 * chart fits its range, reads its forecasts and keeps its room as it renders,
 * on the server as in the browser: the series it draws and as what, the
 * values its axis must reach, and the px it draws past the far end of the
 * value axis. A part says it with a static `declare` of its props.
 */
interface ChartPartDeclaration {
  series?: { key: string; mark: ChartMark }
  forecast?: ChartForecast
  /** Values the axes must reach: `'x'`, or a value axis's id. */
  references?: readonly ChartReference[]
  /** The px it draws past the far end of the value axis, worked out from what the chart shows. */
  room?: (chart: ChartRoomState) => number
}

/** What a part's room is worked out from: the chart before its scales are made, and the rows it draws. */
type ChartRoomState = Pick<
  ChartRootState,
  'series' | 'config' | 'hidden' | 'locale' | 'format' | 'textWidth'
> & {
  stack: ChartStack
  orientation: ChartOrientation
  rows: readonly ChartDatum[]
}

/** What tells a declaration apart, but for its room, which is a function; empty for one that says nothing. */
function cartesianSignature(declaration: ChartPartDeclaration) {
  const { series, forecast, references, room } = declaration
  if (!series && !forecast && !references?.length && !room) return ''
  return JSON.stringify([
    series ?? null,
    forecast ?? null,
    references ?? null,
    room ? 'room' : null,
  ])
}

/** What the parts of a chart declared, read by what each says. */
interface CartesianParts extends ChartParts<ChartPartDeclaration> {
  /** The series the parts draw, and as what. */
  marks: ReadonlyMap<string, ChartMark>
  forecasts: readonly ChartForecast[]
  references: readonly ChartReference[]
  rooms: readonly ((chart: ChartRoomState) => number)[]
}

/** What `declarations` say, gathered by kind. */
function cartesianParts(
  declarations: readonly ChartPartDeclaration[],
): Omit<CartesianParts, keyof ChartParts<ChartPartDeclaration>> {
  const marks = new Map<string, ChartMark>()
  for (const { series } of declarations) if (series) marks.set(series.key, series.mark)
  return {
    marks,
    forecasts: declarations.flatMap((part) => (part.forecast ? [part.forecast] : [])),
    references: declarations.flatMap((part) => part.references ?? []),
    rooms: declarations.flatMap((part) => (part.room ? [part.room] : [])),
  }
}

/** What `children` declare, read as the chart renders. */
function useCartesianParts(children: ReactNode): CartesianParts {
  const declared = chartParts(children, cartesianSignature)
  return { ...declared, ...cartesianParts(declared.declarations) }
}

/* The props. */

/** The props a chart on the cartesian frame takes, such as a line chart, beside those every chart takes. */
interface CartesianChartProps extends CategoryChartProps {
  /**
   * What `index` holds: categories, laid out evenly in the data's order, or
   * times, each where it falls, so a missing date stays a gap. A time is a
   * `yyyy-mm-dd` date, a `yyyy-mm` month or a `yyyy-mm-ddTHH:mm[:ss]` date
   * and time, each the same everywhere, or an instant: an ISO string with
   * `Z` or an offset, a `Date`, or milliseconds. Rows come in time order.
   */
  indexType?: 'category' | 'time'
  /**
   * The IANA time zone instants are written in, such as `Europe/London`;
   * the visitor's own by default, after the page loads, and UTC on the
   * server. Give one, so the server and the browser agree. Dates and times
   * with no zone are written as they are.
   */
  timeZone?: string
}

/** The props of a chart on the cartesian frame whose x of times can show a window of them, still or live. */
interface LiveChartProps {
  /**
   * How much time the plot shows, in ms, of an x of times: the latest, from
   * the newest row back, or with `live`, from now back. It sets how fast a
   * live chart scrolls.
   */
  window?: number
  /** The plot's end is now, and it scrolls with the clock: a stream, such as requests per second. Needs a `window`. */
  live?: boolean
  /** Holds a live chart still, as hovering or focusing its plot does; rows keep arriving past its end. */
  paused?: boolean
}

/** The props of a chart on the cartesian frame that aren't its `<figure>`'s. */
const cartesianChartKeys = [
  'indexType',
  'timeZone',
  'window',
  'live',
  'paused',
] as const satisfies readonly (keyof (CartesianChartProps & LiveChartProps))[]

/** A value axis other than the chart's own: how it fits what its series reach, and how it writes and titles its values. */
interface NamedValueAxis extends Pick<
  ValueAxisOptions,
  'domain' | 'tickCount' | 'zero' | 'align' | 'allowDecimals'
> {
  /** How its values are written, on the axis, in the tooltip, the table and what is read out; the chart's `format` by default. */
  format?: ChartFormat
  /** What it measures, which titles it unless its `ChartYAxis` is given a `label`. */
  label?: string
}

interface CartesianChartOptions {
  /** The kinds of mark the chart draws, its own first: a series that names no mark is drawn as that. */
  kinds: readonly [MarkKind, ...MarkKind[]]
  orientation: ChartOrientation
  stack: ChartStack
  /** Whether the chart's marks play an entrance the first time it comes into view. */
  entrance: boolean
  /**
   * How the marks start one after another in the entrance, such as bars in
   * a cascade: the CSS variable on the chart that holds the share of their
   * role's duration they start over, and its default. None when they start
   * together.
   */
  cascade?: { variable: string; fallback: number }
  /**
   * The series each row is of, for a chart whose rows each belong to one,
   * such as a scatter's points: hiding a series takes its rows out, so they
   * leave as a removed stop does.
   */
  seriesOfRow?: (row: ChartDatum) => string
  /**
   * What tells each row's stop apart from the rest, its `index` value by
   * default: a scatter's rows in series of their own may share a name, as
   * the same month for each team does.
   */
  keyOf?: (row: ChartDatum) => string
  /** The px kept clear inside the plot's edges, on both axes, for marks drawn around a point, such as a scatter's bubbles; none by default. */
  inset?: number
  /** Along numbers, the x axis, in place of the categories. */
  x?: Omit<Extract<CartesianX, { kind: 'number' }>, 'kind'> & {
    format?: ChartFormat
    label?: string
  }
  /** The chart's own value axis, beside the root's `domain`, `tickCount`, `tickValues` and `allowDecimals`. */
  y?: Pick<ValueAxisOptions, 'nice' | 'zero' | 'base'> & { label?: string }
  /** Every other value axis a series names, by its id: how it fits, writes and titles its values. */
  axes?: Readonly<Record<string, NamedValueAxis>>
  /** Gaps between the bands of categories, when its bars stand in them. */
  gaps?: BandGaps
}

/* What the cartesian parts read. */

/** What `useCartesian()` gives the cartesian parts. */
interface CartesianValue {
  /** Every stop to draw, the leaving ones too, in a fixed order that sorting the data doesn't change. */
  stops: readonly CartesianStop[]
  /** The stops still in the data, in order. */
  current: readonly CartesianStop[]
  orientation: ChartOrientation
  stack: ChartStack
  frame: ChartFrame
  /** The px kept clear inside each edge of the plot, as `--chart-inset`, for marks drawn round a point. */
  inset: number
  /** A series' value at a stop: a number, a `[from, to]` range, or no value. */
  valueOf: (series: string, stop: ChartItem) => unknown
  /** How a series' value at a stop is written in the tooltip, the data table and what is read out. */
  seriesText: (stop: ChartItem, series: string) => string
  /**
   * How much a series' value changed since `before`, as a share of it, which
   * the tooltip and what is read out give; none for a series written as a
   * percent, whose change as a share of a share would read as points.
   */
  seriesChange: (stop: ChartItem, before: ChartItem, series: string) => number | null
  /** How a stop is named. */
  stopText: (stop: ChartItem) => string
  /** The picked stop's key. */
  selected: string | null
  /** The entrance has played, or wasn't asked for. */
  entered: boolean
  status: ChartStatus
  /** The stops run in order, such as days, so a change since the one before means something. */
  ordered: boolean
  /** What the parts written inside the chart say about themselves, read as it renders. */
  parts: CartesianParts
  /** The series whose values from a stop on are projected. */
  forecasts: readonly ChartForecast[]
}

/** What the cartesian parts read: the family's value and the root's state. */
type CartesianChartValue = CartesianValue & ChartRootState

const CartesianContext = createContext<CartesianChartValue | null>(null)

function useCartesian() {
  const chart = use(CartesianContext)
  if (!chart) throw new Error('Chart parts go inside a chart, such as a `BarChart`.')
  return chart
}

/** What `useCartesianChart` returns, which a chart hands its frame. */
interface CartesianChart {
  chart: CartesianChartValue
  placeholder: boolean
  /** The data arrived as the placeholder went, so the marks grow out of the placeholder's. */
  fromPlaceholder: boolean
  phase: EntrancePhase
  model: CartesianModel
  /** What the axes, the grid and reference parts read. */
  axes: ChartAxesValue
  /** Whether a press picks a stop, and the toggle, by key. */
  pick: { selectable: boolean; toggle: (key: string) => void }
  /** The stop under the pointer or the focus, for a chart you control. */
  active: ActiveIndexProps
}

/** The rows of a chart that loads or failed: one array, so what compares rows sees no change. */
const NO_ROWS: readonly ChartDatum[] = []

/**
 * A cartesian chart: its rows, the frame the cartesian model fits to them,
 * its parts and their declarations, its stops, what is picked and how its
 * values are written. A chart's root adds where its tooltip sits, how it is
 * browsed and what it says, and draws its marks inside
 * `CartesianChartFrame`.
 */
function useCartesianChart(
  props: CartesianChartProps & LiveChartProps,
  options: CartesianChartOptions,
): CartesianChart {
  const {
    data,
    index,
    config,
    domain,
    tickCount,
    tickValues,
    allowDecimals,
    format,
    ordered = false,
    activeIndex,
    defaultActiveIndex = null,
    onActiveIndexChange,
  } = props
  const times = props.indexType === 'time'
  if (props.window !== undefined && !times) {
    throw new Error('A `window` is a stretch of time: give `indexType="time"` too.')
  }
  if (props.live && props.window === undefined) {
    throw new Error(
      'A live chart scrolls through a `window` of time: give one, in ms, such as `window={60_000}`.',
    )
  }
  if (times && options.x) {
    throw new Error('A chart whose x is a number of its own takes no `indexType`.')
  }
  if (times && options.orientation === 'horizontal') {
    throw new Error(
      'Lying bars take categories down the side, not times: give `indexType="time"` to upright bars.',
    )
  }
  const timeZone = useTimeZone(props.timeZone)
  // The week starts on the same day on the server and on the first paint in the browser.
  const firstDay = weekStart(useLocale(localeTag(props.locale)))
  const state = useChartRoot(props, { entrance: options.entrance, heightFromData: false })
  const { moves, plotSize, hidden, series } = state
  const load = useChartLoad(props)
  const loaded = load.placeholder || load.failed ? NO_ROWS : data
  const shownRows = options.seriesOfRow
    ? rowsShown(loaded, options.seriesOfRow, hidden)
    : loaded
  const shown = series.filter((key) => !hidden.includes(key))
  const parts = useCartesianParts(props.children)
  const keyOf = times
    ? (row: ChartDatum) => timeKey(row[index])
    : (options.keyOf ?? ((row: ChartDatum) => String(row[index])))
  // A window keeps the rows the app lets go while they still show, so the line runs on to the
  // plot's start; nothing while it loads or failed.
  const clock = useLiveClock({
    window: props.window ?? null,
    live: props.live ?? false,
    paused: props.paused ?? false,
    rows: shownRows,
    timeOf: (row) => readTime(row[index])?.time ?? Number.NaN,
    root: state.root,
    plot: state.plot,
    direction: state.direction,
  })
  const drawn = load.placeholder || load.failed ? shownRows : clock.rows
  checkSeries(config, parts.marks, options.kinds[0].mark)
  const numbersAlong = options.x !== undefined
  // A value given for an x of categories or times marks the value axis.
  const references = parts.references.map((ref) =>
    ref.axis === 'x' && !numbersAlong ? { ...ref, axis: VALUE_AXIS } : ref,
  )
  const roomState: ChartRoomState = {
    ...state,
    rows: drawn,
    stack: options.stack,
    orientation: options.orientation,
  }
  const room = Math.max(0, ...parts.rooms.map((room) => room(roomState)))
  const valueLength =
    options.orientation === 'vertical' ? plotSize.height : plotSize.width
  const model = cartesianModel({
    rows: drawn,
    config,
    hidden,
    kinds: options.kinds,
    stack: options.stack,
    x: options.x
      ? { kind: 'number', ...options.x }
      : times
        ? {
            kind: 'time',
            key: index,
            timeZone,
            firstDay,
            gaps: options.gaps,
            window: clock.scaleWindow,
          }
        : { kind: 'category', keys: drawn.map(keyOf), gaps: options.gaps },
    y: { domain, tickCount, tickValues, allowDecimals, ...options.y },
    axes: options.axes,
    references,
    room: { px: room, length: valueLength },
  })
  const x = model.x
  const current: CartesianStop[] = drawn.map((datum, at) => ({
    key: keyOf(datum),
    value: datum[index],
    datum,
    index: at,
    band: model.bandOf(at),
    leaving: false,
  }))
  const stops = useLeavingItems(moves, current, stopKey)
  const previousY = usePreviousScales(model.y)
  const previousX = usePreviousScales({ x }).x ?? x
  const frame: ChartFrame = {
    x: {
      scale: x,
      previous: previousX,
      format: options.x?.format,
      label: options.x?.label,
    },
    y: {
      ...Object.fromEntries(
        Object.entries(model.y).map(([axis, scale]) => [
          axis,
          {
            scale,
            previous: previousY[axis] ?? scale,
            format: options.axes?.[axis]?.format,
            label: options.axes?.[axis]?.label,
          },
        ]),
      ),
      value: {
        scale: model.y.value,
        previous: previousY.value ?? model.y.value,
        label: options.y?.label,
      },
    },
    baselines: model.baselines,
    axisOf: model.axisOf,
    totals: model.totals,
    measuring: room > 0 && valueLength <= 0 && drawn.length > 0,
    live: clock.live,
  }
  // A row's time is written as fine as the chart's times are, and on one day, as its time of day alone.
  const oneDay =
    x.kind === 'time' &&
    onOneDay(
      current.flatMap((stop) => readTime(stop.value)?.time ?? []),
      x.timeZone,
    )
  const nameText =
    props.categoryFormat ??
    (x.kind === 'time'
      ? (value: unknown) => {
          const read = readTime(value)
          return read
            ? timeLabel(read.time, x.unit, props.locale, x.timeZone, oneDay)
            : String(value)
        }
      : String)
  const { status, fromPlaceholder, phase, entered } = useChartLife(
    props,
    state,
    load,
    // The rows a window keeps count as the data's.
    {
      rows: drawn === shownRows ? loaded.length : drawn.length,
      shown: shown.length,
      drawn: drawn.length,
    },
    { entrance: options.entrance, cascade: options.cascade ?? null },
  )
  const pick = useChartPick(
    props,
    current.map((stop) => stop.key),
  )
  const { messages, valueText } = state
  // A series reads in its value axis's own format, where it has one.
  const writers = new Map<string, (value: number) => string>()
  const writerOf = (key: string) => {
    const axis = frame.axisOf(key)
    const own = frame.y[axis]?.format
    if (own === undefined) return valueText
    const made = writers.get(axis) ?? formatterOf(state.locale, own)
    writers.set(axis, made)
    return made
  }
  // Until a series has rows of its own (LGL-627), its values are the chart's rows'.
  const valueOf = (key: string, stop: ChartItem) => stop.datum?.[key]
  const chart: CartesianChartValue = {
    ...state,
    stops,
    current,
    orientation: options.orientation,
    stack: options.stack,
    frame,
    inset: options.inset ?? 0,
    valueOf,
    seriesText: (stop, key) =>
      writeDatum(valueOf(key, stop), writerOf(key), messages.noValue),
    seriesChange: (stop, before, key) => {
      const own = frame.y[frame.axisOf(key)]?.format ?? format
      return typeof own === 'object' && own.style === 'percent'
        ? null
        : changeSince(valueOf(key, stop), valueOf(key, before))
    },
    stopText: (stop) => nameText(stop.value),
    selected: pick.picked,
    entered,
    status,
    ordered,
    parts,
    forecasts: parts.forecasts,
  }
  return {
    chart,
    placeholder: load.placeholder,
    fromPlaceholder,
    phase,
    model,
    axes: cartesianAxes(chart, model, nameText),
    pick: { selectable: pick.selectable, toggle: pick.toggle },
    active: { activeIndex, defaultActiveIndex, onActiveIndexChange },
  }
}

function stopKey(stop: CartesianStop) {
  return stop.key
}

/**
 * What the shared axes, grid and reference parts read of a cartesian chart:
 * its frame; the stops along x when it names them, upright bars or lines
 * over categories or times, or down the side for lying bars; and every value
 * a reference at a summary reads.
 */
function cartesianAxes(
  chart: CartesianChartValue,
  model: CartesianModel,
  nameText: (value: unknown) => string,
): ChartAxesValue {
  const { frame, orientation, current, stops, series, hidden, stack } = chart
  const keys = current.map((stop) => stop.key)
  const named = {
    all: stops,
    current,
    nameOf: (target: { kind: string; key?: string }) => {
      const at = target.key === undefined ? -1 : keys.indexOf(target.key)
      return at === -1 ? null : at
    },
    format: nameText,
    keepInside: true,
  }
  const numbersAlong = frame.x.scale.kind === 'linear'
  return {
    frame,
    orientation,
    inset: chart.inset,
    names: {
      x: !numbersAlong && orientation === 'vertical' ? named : null,
      y: !numbersAlong && orientation === 'horizontal' ? named : null,
    },
    summaryValues: (axis) => {
      // Points placed by both values each have a value on either axis.
      if (numbersAlong) {
        return current.map((stop) => {
          const point = model.point(stop.index)?.value
          return point ? (axis === 'x' ? point.x : point.y) : null
        })
      }
      // Only the series read against the axis.
      const onAxis = series.filter(
        (key) => !hidden.includes(key) && frame.axisOf(key) === axis,
      )
      return stack === 'none'
        ? current.flatMap((stop) => onAxis.map((key) => chart.valueOf(key, stop)))
        : current.map((stop) =>
            onAxis.reduce(
              (sum, key) => sum + (numberOf(chart.valueOf(key, stop)) ?? 0),
              0,
            ),
          )
    },
    percent: stack === 'expand',
  }
}

/* What a cartesian chart says. */

/**
 * The words of a cartesian chart as `seriesWords` reads them: its stops,
 * each series' value as the chart writes it, the total of what stacks on
 * the chart's own value axis, and the chart's `own` words, or null.
 */
function cartesianWords(
  chart: CartesianChartValue,
  own: SeriesWordsInput['own'],
): SeriesWordsInput {
  const shown = chart.series.filter((key) => !chart.hidden.includes(key))
  // Only what stacks adds up, never a line or a point beside it or a series on another axis.
  const summed = shown.filter((key) => chart.frame.totals(key))
  return {
    stops: chart.current,
    seriesText: chart.seriesText,
    seriesChange: chart.seriesChange,
    stopText: chart.stopText,
    ordered: chart.ordered,
    totals: (stop) =>
      summed.length > 1
        ? summed.reduce((all, key) => all + (numberOf(chart.valueOf(key, stop)) ?? 0), 0)
        : null,
    totalByDefault: chart.stack !== 'none',
    forecast: (series, stop) => isForecast(chart, series, stop.index),
    picked: chart.selected,
    alone: null,
    own,
  }
}

/** The data table of a chart that writes its own: a row for each stop, under `columns`, with `cells` of each. */
function cartesianTable(
  chart: CartesianChartValue,
  columns: readonly string[],
  cells: (stop: CartesianStop) => readonly string[],
): ChartTable {
  return {
    header: chart.messages.category,
    columns,
    rows: chart.current.map((stop) => ({
      key: stop.key,
      name: chart.stopText(stop),
      cells: cells(stop),
    })),
    footer: [],
  }
}

/* The frame. */

interface CartesianChartFrameProps extends Omit<ComponentProps<'figure'>, 'children'> {
  chart: CartesianChart
  slot: string
  description?: string
  /** What shows while the data loads; nothing once it has. */
  placeholder: ReactNode
  empty?: ReactNode
  /** A series' marker shape for its legend swatch (the Scatter's, the Composed chart's), or null. */
  markerOf: (series: string) => string | null
  /** Where the tooltip of a stop sits, and its side; `series` for a target on one series. */
  anchor: (stop: CartesianStop, series: string | null) => ChartPoint | null
  words: ChartWords
  /** How the pointer and the keys move among the stops; the frame keeps the axis a scatter's keys last moved along. */
  browse:
    | Extract<CartesianBrowse, { kind: 'x' | 'x-series' }>
    | {
        kind: 'points'
        point: (stop: CartesianStop) => CartesianPoint | null
        inset: number
      }
  children: ReactNode
}

/**
 * The `<figure>` of a cartesian chart, on the root's frame: the chart's
 * reader and focus from its stops, a live chart's clock, the parts written
 * inside it, and the chart's placeholder while it loads.
 */
function CartesianChartFrame({
  chart: cartesian,
  slot,
  description,
  placeholder,
  empty,
  markerOf,
  anchor,
  words,
  browse,
  children,
  ...props
}: CartesianChartFrameProps) {
  const { chart, axes, pick, active } = cartesian
  // The axis the last arrow stepped along among points, which the slider's value counts on.
  const [along, setAlong] = useState<'x' | 'y'>('x')
  const live = chart.frame.live
  const own = cartesianReader({
    current: chart.current,
    browse: browse.kind === 'points' ? { ...browse, along, onAlong: setAlong } : browse,
    orientation: chart.orientation,
    direction: chart.direction,
    anchor,
    words,
    // A window opens at its end, so the keys start there too.
    start: live ? 'last' : 'first',
    series: chart.series,
    hidden: chart.hidden,
  })
  const reader = live ? liveReader(own, live, chart.direction) : own
  const keys = chart.current.map((stop) => stop.key)
  const root: ChartRootValue = {
    ...chart,
    reader,
    markerOf,
    selectable: pick.selectable,
    picked: chart.selected === null ? null : { kind: 'x', key: chart.selected },
    togglePicked: (target) => {
      if (target.kind !== 'node' && keys.includes(target.key)) pick.toggle(target.key)
    },
  }
  const { focusProps, toldRef } = useIndexFocus(reader.items, active)
  return (
    <RootFrame
      root={root}
      focus={focusProps}
      slot={slot}
      description={description}
      empty={empty}
      measuring={chart.frame.measuring}
      inset={chart.inset}
      data-orientation={chart.orientation}
      {...props}
    >
      <CartesianContext value={chart}>
        <ChartPartsContext value={chart.parts}>
          <ChartAxesContext value={axes}>
            <SeriesWordsContext value={cartesianWords(chart, null)}>
              <IndexActive items={reader.items} active={active} toldRef={toldRef}>
                {live && <LiveHold hold={live.hold} />}
                {children}
                {placeholder}
              </IndexActive>
            </SeriesWordsContext>
          </ChartAxesContext>
        </ChartPartsContext>
      </CartesianContext>
    </RootFrame>
  )
}

/** Holds a live plot still while anything on it is lit, by the pointer or the keys, so it can be read. */
function LiveHold({ hold }: { hold: (held: boolean) => void }) {
  const lit = useChartActive().spotlit !== null
  useLayoutEffect(() => {
    hold(lit)
  }, [hold, lit])
  return null
}

export {
  type CartesianChart,
  CartesianChartFrame,
  type CartesianChartFrameProps,
  type CartesianChartOptions,
  type CartesianChartProps,
  type CartesianChartValue,
  cartesianChartKeys,
  type CartesianParts,
  cartesianParts,
  type CartesianPoint,
  cartesianSignature,
  type CartesianStop,
  cartesianTable,
  type CartesianValue,
  cartesianWords,
  type ChartPartDeclaration,
  type ChartRoomState,
  type LiveChartProps,
  type NamedValueAxis,
  useCartesian,
  useCartesianChart,
  useCartesianParts,
}
