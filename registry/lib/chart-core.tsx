'use client'

import {
  type AxisNames,
  type CategoryChartProps,
  ChartAxesContext,
  type ChartAxesValue,
  type ChartAxisName,
  type ChartForecast,
  type ChartFrame,
  type ChartParts,
  ChartPartsContext,
  chartParts,
  checkSeries,
  IndexActive,
  isForecast,
  localeTag,
  pickedName,
  plotPlace,
  SeriesWordsContext,
  type SeriesWordsInput,
  seriesWords,
  stickTo,
  timeKey,
  useChartActive,
  useChartLife,
  useChartLoad,
  useChartPick,
  useIndexFocus,
  useLeavingItems,
  usePreviousScales,
  useRegistry,
} from '@/registry/lib/chart-base'
import {
  type CartesianX,
  cartesianModel,
  type ChartReference,
  type MarkKind,
  VALUE_AXIS,
  type ValueAxisOptions,
} from '@/registry/lib/chart-frame'
import { type ChartLive, useLiveClock } from '@/registry/lib/chart-live-clock'
import {
  allWhole,
  alongCategories,
  changeSince,
  type ChartDatum,
  type ChartMark,
  type ChartOrientation,
  type ChartStack,
  type GridCell,
  keyAxis,
  nearestPoint,
  numberOf,
  pointRank,
  rangeOf,
  type ReadingDirection,
  sliderValue,
  type Span,
  stepCell,
  stepIndex,
  stepPoint,
  type XYValue,
} from '@/registry/lib/chart-math'
import {
  ChartFrame as RootFrame,
  type ChartFormat,
  type ChartMoves,
  type ChartPoint,
  type ChartReader,
  type ChartRootState,
  type ChartRootValue,
  formatterOf,
  type PlotPoint,
  useChartRoot,
} from '@/registry/lib/chart-root'
import {
  type Band,
  type BandGaps,
  bandCentre,
  bandScale,
  baselineOf,
  extentWith,
  extentWithRoom,
  indexAt,
  linearScale,
} from '@/registry/lib/chart-scale'
import {
  type ChartStatus,
  type ChartTable,
  type ChartTarget,
  indexOfKey,
  targetKey,
  targetSeries,
} from '@/registry/lib/chart-state'
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
  type CSSProperties,
  type ReactNode,
  type Ref,
  use,
  useLayoutEffect,
  useState,
} from 'react'

import { cn } from '@/lib/utils'

/*
 * The category family: charts whose marks are categories, the rows of their
 * data, such as bars, lines, slices and tiles. It sits on the chart root
 * (`chart-root`), which knows nothing about categories: this file keeps the
 * categories and the ones leaving, the frame's scales, and the motion the
 * axes share, and hands the root a reader that answers for the categories.
 * A cartesian chart (`BarChart`) gets its frame from the cartesian model
 * (`chart-frame`) and its marks' maths from their kinds; a chart of another
 * shape, until it has a family of its own, gets a band of categories and one
 * value axis from here. Everything else comes from here and the root, so
 * every chart looks, moves and reads the same way.
 */

/** A category on the chart: still in the data, or leaving it. */
interface ChartCategory {
  key: string
  /** The category as the data has it, under the chart's `index`. */
  value: unknown
  datum: ChartDatum
  /** Its place in the data; a leaving one keeps its last. */
  index: number
  band: Band
  leaving: boolean
}

/** A row placed by both values, by value and by place. */
interface ChartXYPoint {
  value: XYValue
  place: XYValue
}

/** One axis of a grid of cells: its names, and which one each cell is under. */
interface ChartGridAxis {
  names: readonly ChartAxisName[]
  /** The name over the cell at `index`, by its place among the categories, or none. */
  nameOf: (index: number) => number | null
  /** How the axis writes its names, unless it is given a `categoryFormat`. */
  format: (value: unknown) => string
}

/**
 * The cell grid: what a chart drawn as a grid of cells, such as a heatmap,
 * has in place of a category axis. Each category is a cell; the keys step
 * through them by column and by row, and each axis names its columns or its
 * rows.
 */
interface ChartCellGrid {
  /** Each cell's column and row, by its place among the categories. */
  cells: readonly GridCell[]
  x: ChartGridAxis
  y: ChartGridAxis
}

/** What a chart with categories keeps, beside what every chart keeps. */
interface ChartContextValue extends ChartRootState {
  /** Every category to draw, the leaving ones too, in a fixed order that sorting the data doesn't change. */
  categories: readonly ChartCategory[]
  /** The categories still in the data, in order. */
  current: readonly ChartCategory[]
  orientation: ChartOrientation
  /** Drawn round a centre, clockwise from the top in either reading direction. */
  round: boolean
  stack: ChartStack
  frame: ChartFrame
  /**
   * The row at `index` as a point placed by both values, for a chart whose x
   * is a number: its x value and its highest shown value, and where they sit
   * along x from the reading start and up their value axis, as fractions of
   * each. Null on a chart with categories.
   */
  xyOf: (index: number) => ChartXYPoint | null
  /** The cells and the names of their columns and rows, for a chart drawn as a grid of cells. */
  grid?: ChartCellGrid
  /**
   * The narrowest the plot gets, in px, for a chart of many columns, such as
   * a year of weeks: past it the chart scrolls sideways, opening at its
   * end, while its axes down the sides stay in view.
   */
  leastPlotWidth?: number
  /** The px kept clear inside each edge of the plot, as `--chart-inset`, for marks drawn round a point. */
  inset: number
  /** Anything under a series' key as the chart writes it: a number, a `[from, to]` range, or no value. */
  datumText: (value: unknown) => string
  /** How a series' value on a category is written in the tooltip, the data table and what is read out: `datumText` of it by default. */
  seriesText: (category: ChartCategory, key: string) => string
  /**
   * How much a series' value changed since `before`, as a share of it, which
   * the tooltip and what is read out give; none for a series written as a
   * percent, whose change as a share of a share would read as points.
   */
  seriesChange: (
    category: ChartCategory,
    before: ChartCategory,
    key: string,
  ) => number | null
  categoryText: (value: unknown) => string
  /** The category under the pointer or the focus, for a chart you control: the root's own props. */
  activeProps: Pick<
    CategoryChartProps,
    'activeIndex' | 'defaultActiveIndex' | 'onActiveIndexChange'
  >
  /** The category picked, by its place in the data, when categories can be picked. */
  selected: number | null
  /** Picks the category at `index`, or lets it go if it was picked. */
  toggleSelected: (index: number) => void
  selectable: boolean
  /** The entrance has played, or wasn't asked for. */
  entered: boolean
  status: ChartStatus
  /** The categories run in order, such as days, so a change since the one before means something. */
  ordered: boolean
  /** What the parts written inside the chart say about themselves, read as it renders. */
  parts: CartesianParts
  /** The series whose values from a category on are projected. */
  forecasts: readonly ChartForecast[]
}

/**
 * What a chart with categories tells its reader about its own marks: where
 * each category's tooltip sits, and, where the marks call for it, its own
 * way of picking, stepping, reading out and opening them. What a chart
 * leaves out works the way most charts do: along the category axis.
 */
interface CategoryReaderParts {
  /**
   * Where the tooltip of the category at `index` sits, as fractions of the
   * plot from its top left, and the side it opens on when the chart's marks
   * call for one.
   */
  pointOf: (index: number) => ChartPoint | null
  /**
   * The category under a point of the plot whose box is `box`, for a chart
   * whose categories don't run along an axis, such as a donut's slices.
   */
  pickAt?: (point: { x: number; y: number }, box: DOMRect) => number | null
  /**
   * The series under a point of the plot, as fractions of it from its
   * reading start and its top, for a chart whose series are pointed at one
   * by one, such as a bump chart's lines. The pointer brings it forward.
   */
  seriesAt?: (point: { x: number; y: number }) => string | null
  /**
   * The series the Up or Down arrow brings forward from `from` on the
   * category at `index`: `step` -1 for the one above, 1 for the one below.
   * With this, those arrows move between series and only the arrows along
   * the categories step through them.
   */
  stepSeries?: (index: number, from: string | null, step: -1 | 1) => string | null
  /**
   * What the category at `index` holds, for a screen reader, in place of
   * each series' value: the words after its name and whether it is picked.
   */
  describe?: (index: number) => string
  /**
   * The keys' own way between the categories, for marks that aren't a row or
   * a grid, such as a Sankey's nodes: the category a key goes to from
   * `index`, or null for a key the chart doesn't take. The keys reach only
   * the first `stops` categories, which the slider counts, each at its
   * `rank` among them from 1, in the order they are drawn.
   */
  keys?: {
    stops: number
    /** Where the keys start, the first stop, when nothing is reached or picked yet. */
    start: number
    step: (index: number, key: string) => number | null
    rank: (index: number) => number
  }
  /**
   * What a press at `point` on the plot opens, such as a treemap zooming
   * into the group there, or none; a press that opens something doesn't
   * pick.
   */
  zoomAt?: (point: { x: number; y: number }, box: DOMRect) => (() => void) | null
  /** What Enter or Space on the category at `index` opens, as `zoomAt` does, or none. */
  zoomIn?: (index: number) => (() => void) | null
  /** What Escape goes back to once nothing is lit, such as a treemap zooming back out, or none. */
  zoomOut?: (() => void) | null
  /** The data table's columns after the category, and each category's cells, in place of one per series. */
  table?: CategoryTable
  /** What the tooltip shows for the category at `index`, in place of each series' value. */
  tooltipContent?: (index: number) => ReactNode
  /**
   * The shape a series' marks take, such as a scatter's points, as an SVG
   * path centred on 0 0 that fills a box 2 across, which its legend swatch
   * takes too; none for a plain swatch.
   */
  markerOf?: (key: string) => string | undefined
}

/** What a chart's root hands its frame: what it keeps, and what its reader is told. */
type CategoryChartInput = ChartContextValue & CategoryReaderParts

/** A data table of a chart's own: the columns after the category, and each category's cells. */
interface CategoryTable {
  columns: readonly string[]
  cells: (category: ChartCategory) => readonly string[]
  /** A last row under `messages.total`, such as the whole the shares are of. */
  footer?: readonly string[]
  /**
   * The table's own rows, in place of one for each category, for a chart
   * whose data isn't its categories, such as a Sankey's flows: each row's
   * name and its cells, under `header`, the first column's title.
   */
  rows?: {
    header: string
    cells: readonly { key: string; name: string; cells: readonly string[] }[]
  }
}

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
  ChartContextValue,
  | 'series'
  | 'config'
  | 'hidden'
  | 'stack'
  | 'orientation'
  | 'locale'
  | 'format'
  | 'textWidth'
> & { rows: readonly ChartDatum[] }

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

/** What the parts of a chart with categories declared, read by what each says. */
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

const ChartContext = createContext<ChartContextValue | null>(null)

function useChart() {
  const chart = use(ChartContext)
  if (!chart) throw new Error('Chart parts go inside a chart, such as a `BarChart`.')
  return chart
}

/**
 * The reader of a chart with categories: each category is a stop, held by
 * its key, and the pointer and the keys find them along the category axis,
 * on an XY frame by both values, on a grid by column and row, or the
 * chart's own way. On a chart whose series are pointed at one by one, the
 * stop holds its series too, which it brings forward. `along` is the axis
 * the last arrow stepped along among points placed by two values, which the
 * slider's value counts on; `opens` keeps what a press under the pointer
 * opens, by the target it found.
 */
function categoryReader(
  chart: CategoryChartInput,
  along: 'x' | 'y',
  setAlong: (axis: 'x' | 'y') => void,
  opens: WeakMap<ChartTarget, () => void>,
): ChartReader {
  const { current, orientation, direction, grid } = chart
  // On a chart whose x is a number, each row is a point placed by both values.
  const xy =
    chart.frame.x.scale.kind === 'linear'
      ? current.map(
          (category) =>
            chart.xyOf(category.index) ?? { value: NO_POINT, place: NO_POINT },
        )
      : null
  // The arrows step by value, and the pointer finds the nearest by place.
  const points = xy && xy.map((point) => point.value)
  const places = xy && xy.map((point) => point.place)
  const keys = current.map((category) => category.key)
  const count = keys.length
  const centres = current.map((category) => bandCentre(category.band))
  const indexOf = (target: ChartTarget) =>
    target.kind === 'node' ? null : indexOfKey(keys, target.key)
  const at = (index: number | null, series: string | null): ChartTarget | null => {
    const key = index === null ? undefined : keys[index]
    if (key === undefined) return null
    return series === null ? { kind: 'x', key } : { kind: 'datum', series, key }
  }
  // A chart that scrolls, sideways or live, opens at its end, so the keys start there too.
  const start =
    count === 0
      ? null
      : Math.min(
          chart.keys?.start ??
            (chart.leastPlotWidth === undefined && chart.frame.live === null
              ? 0
              : count - 1),
          count - 1,
        )
  const words = seriesWords(chart, categoryWords(chart))
  return {
    holds: (target) => {
      if (indexOf(target) === null) return false
      return (
        target.kind === 'x' ||
        (target.kind === 'datum' &&
          chart.series.includes(target.series) &&
          !chart.hidden.includes(target.series))
      )
    },
    lights: (target) => (target.kind === 'node' ? target.id : targetSeries(target)),
    item: (target) => {
      const index = indexOf(target)
      const category = index === null ? undefined : current[index]
      if (!category) return null
      const { key, value, datum } = category
      return { key, value, datum, index: category.index }
    },
    items: keys.map((key) => ({ kind: 'x', key })),
    browse: {
      targetAt: (point: PlotPoint) => {
        // The plot's own box, from its top left, which the chart's own picking reads as the page's.
        const box = new DOMRect(0, 0, point.width, point.height)
        const index = pickIndex(chart, point, box, centres, places)
        const series =
          chart.seriesAt?.({
            x: alongCategories(point, box, 'vertical', direction),
            y: point.height === 0 ? 0 : point.y / point.height,
          }) ?? null
        // Off every category, what lights a series is the series' own place, such as a
        // treemap's group header.
        const target: ChartTarget | null =
          index === null
            ? series === null
              ? null
              : { kind: 'node', id: series }
            : at(index, series)
        const open = target && chart.zoomAt?.(point, box)
        if (target && open) opens.set(target, open)
        return target
      },
      start: start === null ? null : at(start, null),
      step: (from, key) => {
        const index = indexOf(from)
        if (index === null) return null
        const series = targetSeries(from)
        if (chart.keys) return at(chart.keys.step(index, key), null)
        if (chart.stepSeries && !points && (key === 'ArrowUp' || key === 'ArrowDown')) {
          return at(index, chart.stepSeries(index, series, key === 'ArrowUp' ? -1 : 1))
        }
        // Points placed by two values step by x along it, and by y up and down; cells step
        // by column along it, and by row up and down. Round the circle, Right steps
        // clockwise, the way the marks run, as they aren't mirrored in right to left.
        const next = points
          ? stepPoint(points, index, key, direction)
          : grid
            ? stepCell(grid.cells, index, key, direction)
            : stepIndex(key, index, count, orientation, chart.round ? 'ltr' : direction)
        if (next === null) return null
        if (points) setAlong(keyAxis(key))
        return at(next, series)
      },
      rank: (target) => {
        const index = indexOf(target) ?? 0
        if (points) return pointRank(points, index, along)
        if (chart.keys) return chart.keys.rank(index)
        if (grid) return index + 1
        return sliderValue(index, Math.max(1, count), orientation)
      },
      stops: chart.keys?.stops ?? count,
      orientation: orientation === 'vertical' ? 'horizontal' : 'vertical',
      anchor: (target) => {
        const index = indexOf(target)
        return index === null ? null : chart.pointOf(index)
      },
      describe: (target) => {
        const index = indexOf(target)
        return index === null ? '' : columnLabel(chart, index)
      },
      tooltip: (target) => {
        const index = indexOf(target)
        const category = index === null ? undefined : current[index]
        if (index === null || !category) return null
        return chart.tooltipContent
          ? chart.tooltipContent(index)
          : words.tooltip(category)
      },
      table: categoryTable(chart),
      open: (target) => {
        const own = opens.get(target)
        if (own) return own
        const index = indexOf(target)
        return index === null ? null : (chart.zoomIn?.(index) ?? null)
      },
      back: chart.zoomOut ?? null,
    },
  }
}

/**
 * The words of a chart with categories as `seriesWords` reads them: its
 * categories as the stops, each series' value as the chart writes it, and
 * the total of what stacks.
 */
function categoryWords(chart: ChartContextValue): SeriesWordsInput {
  const byKey = new Map(chart.current.map((category) => [category.key, category]))
  const shown = chart.series.filter((key) => !chart.hidden.includes(key))
  // Only what stacks adds up, never a line or a point beside it or a series on another axis.
  const summed = shown.filter((key) => chart.frame.totals(key))
  return {
    stops: chart.current,
    seriesText: (item, key) => {
      const category = byKey.get(item.key)
      return category ? chart.seriesText(category, key) : chart.messages.noValue
    },
    seriesChange: (item, before, key) => {
      const category = byKey.get(item.key)
      const was = byKey.get(before.key)
      return category && was ? chart.seriesChange(category, was, key) : null
    },
    stopText: (item) => chart.categoryText(item.value),
    ordered: chart.ordered,
    totals: (item) =>
      summed.length > 1
        ? summed.reduce((all, key) => all + (numberOf(item.datum?.[key]) ?? 0), 0)
        : null,
    totalByDefault: chart.stack !== 'none',
    forecast: (series, item) => isForecast(chart, series, item.index),
    picked: chart.selected === null ? null : (chart.current[chart.selected]?.key ?? null),
    alone: null,
    own: null,
  }
}

/**
 * The data as a table: the chart's own columns, or its own rows, or else a
 * row for each category and a column for each shown series.
 */
function categoryTable(chart: CategoryChartInput): ChartTable {
  const { table, current, categoryText, messages } = chart
  if (table?.rows) {
    return {
      header: table.rows.header,
      columns: table.columns,
      rows: table.rows.cells,
      footer: [],
    }
  }
  if (table) {
    return {
      header: messages.category,
      columns: table.columns,
      rows: current.map((category) => ({
        key: category.key,
        name: categoryText(category.value),
        cells: table.cells(category),
      })),
      footer: table.footer ?? [],
    }
  }
  return seriesWords(chart, categoryWords(chart)).table
}

/**
 * The categories to draw: those in the data, in its order, and those just
 * taken out, kept where they were until the move they left in has ended,
 * fading out.
 */
function useCategories(
  moves: ChartMoves,
  data: readonly ChartDatum[],
  indexKey: string,
  bandOf: (index: number, count: number) => Band,
  keyOf: (row: ChartDatum) => string = (row) => String(row[indexKey]),
) {
  const current: ChartCategory[] = data.map((datum, index) => ({
    key: keyOf(datum),
    value: datum[indexKey],
    datum,
    index,
    band: bandOf(index, data.length),
    leaving: false,
  }))
  const categories = useLeavingItems(moves, current, categoryKey)
  return { categories, current }
}

function categoryKey(category: ChartCategory) {
  return category.key
}

/** What the category at `index` says to a screen reader: its name and each shown series' value, or the chart's own words. */
function columnLabel(
  chart: ChartContextValue & Pick<CategoryReaderParts, 'describe'>,
  index: number,
) {
  const category = chart.current[index]
  if (!category) return ''
  if (!chart.describe) return seriesWords(chart, categoryWords(chart)).describe(category)
  const name = pickedName(
    chart.categoryText(category.value),
    chart.selected === index,
    chart.messages,
  )
  return `${name}: ${chart.describe(index)}`
}

/** What every chart with categories says about how it keeps its rows and plays its entrance. */
interface CategoryRowOptions {
  /** Whether the chart's marks play an entrance the first time it comes into view. */
  entrance: boolean
  /**
   * How the marks start one after another in the entrance, such as bars in
   * a cascade: the CSS variable on the chart that holds the share of their
   * role's duration they start over, and its default. None when they start
   * together.
   */
  cascade?: { variable: string; fallback: number }
  /** Whether the chart's height comes from its data, so only a change of width is a resize. */
  heightFromData?: boolean
  /**
   * The series each row is of, for a chart whose rows each belong to one,
   * such as a donut's slices, keyed by their category, or a scatter's
   * points: hiding a series takes its rows out, so they leave as a removed
   * category does.
   */
  seriesOfRow?: (row: ChartDatum) => string
  /**
   * The rows still drawn with `hidden` hidden, for a chart whose rows hide
   * in a way of their own, such as a sankey's flows, which go with either
   * end. When hiding leaves none, the chart says every series is hidden.
   */
  rowsShown?: (
    rows: readonly ChartDatum[],
    hidden: readonly string[],
  ) => readonly ChartDatum[]
  /**
   * What tells each row's category apart from the rest, its `index` value by
   * default: a scatter's rows in series of their own may share a name, as
   * the same month for each team does.
   */
  keyOf?: (row: ChartDatum) => string
}

/** How a chart with categories is laid out, beside its rows. */
interface CategoryLayout {
  orientation: ChartOrientation
  stack: ChartStack
  /** Drawn round a centre, clockwise in either reading direction, so the arrows step the way it runs. */
  round?: boolean
  /**
   * The px kept clear inside the plot's edges, on both axes, for marks drawn
   * around a point, such as a scatter's bubbles; none by default.
   */
  inset?: number
}

interface CategoryChartOptions<Shapes> extends CategoryRowOptions, CategoryLayout {
  bandOf: (index: number, count: number) => Band
  /** The chart's own shapes from the rows and the shown series, and the values they reach. */
  measure: (
    rows: readonly ChartDatum[],
    shown: readonly string[],
  ) => Shapes & { extent: Span }
  /** Round the value axis's ends out to a tick; off for shares that fill the axis. */
  nice: boolean
}

/** The rows of a chart that loads or failed: one array, so what compares rows sees no change. */
const NO_ROWS: readonly ChartDatum[] = []

/**
 * What every chart with categories keeps before its scales: the root's
 * state, whether it loads, the rows it draws, and what its parts declare.
 */
function useCategoryRows(props: CategoryChartProps, options: CategoryRowOptions) {
  const { data } = props
  const state = useChartRoot(props, {
    entrance: options.entrance,
    heightFromData: options.heightFromData ?? false,
  })
  const { hidden, series } = state
  const load = useChartLoad(props)
  const rows = load.placeholder || load.failed ? NO_ROWS : data
  const drawn = options.rowsShown
    ? options.rowsShown(rows, hidden)
    : options.seriesOfRow
      ? rowsShown(rows, options.seriesOfRow, hidden)
      : rows
  const shown = series.filter((key) => !hidden.includes(key))
  const declared = chartParts(props.children, cartesianSignature)
  const parts = { ...declared, ...cartesianParts(declared.declarations) }
  const keyOf = options.keyOf ?? ((row: ChartDatum) => String(row[props.index]))
  return {
    state,
    load,
    placeholder: load.placeholder,
    failed: load.failed,
    rows,
    drawn,
    shown,
    parts,
    keyOf,
  }
}

type CategoryRows = ReturnType<typeof useCategoryRows>

/** Each value a part declares for the value axis of a chart with one: on it, or on an x of categories, which marks it too. */
function valueReferences(references: readonly ChartReference[]) {
  return references
    .filter((ref) => ref.axis === VALUE_AXIS || ref.axis === 'x')
    .map((ref) => ref.value)
}

/**
 * Everything a chart with categories keeps and works out before it draws
 * its own marks, from its rows, its categories and its frame: what is
 * picked, the entrance, and how values are written.
 */
function useCategoryValue(
  props: CategoryChartProps,
  options: CategoryRowOptions & CategoryLayout,
  { state, load, rows, drawn, shown, parts }: CategoryRows,
  { categories, current }: { categories: ChartCategory[]; current: ChartCategory[] },
  frame: ChartFrame,
  xyOf: (index: number) => ChartXYPoint | null,
) {
  const {
    format,
    ordered = false,
    categoryFormat = String,
    activeIndex,
    defaultActiveIndex = null,
    onActiveIndexChange,
  } = props
  const { messages, valueText } = state
  const { status, fromPlaceholder, phase, entered } = useChartLife(
    props,
    state,
    load,
    { rows: rows.length, shown: shown.length, drawn: drawn.length },
    { entrance: options.entrance, cascade: options.cascade ?? null },
  )
  const keys = current.map((category) => category.key)
  const pick = useChartPick(props, keys)

  const textOf = (value: unknown, write: (value: number) => string) => {
    const range = rangeOf(value)
    if (range) return `${write(range[0])} – ${write(range[1])}`
    const number = numberOf(value)
    return number === null ? messages.noValue : write(number)
  }
  const datumText = (value: unknown) => textOf(value, valueText)
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
  const chart: ChartContextValue = {
    ...state,
    format,
    categories,
    current,
    orientation: options.orientation,
    round: options.round ?? false,
    stack: options.stack,
    frame,
    xyOf,
    inset: options.inset ?? 0,
    datumText,
    seriesText: (category, key) => textOf(category.datum[key], writerOf(key)),
    seriesChange: (category, before, key) => {
      const own = frame.y[frame.axisOf(key)]?.format ?? format
      return typeof own === 'object' && own.style === 'percent'
        ? null
        : changeSince(category.datum[key], before.datum[key])
    },
    categoryText: categoryFormat,
    activeProps: { activeIndex, defaultActiveIndex, onActiveIndexChange },
    selected: indexOfKey(keys, pick.picked),
    selectable: pick.selectable,
    toggleSelected: (at) => {
      const key = keys[at]
      if (key !== undefined) pick.toggle(key)
    },
    entered,
    status,
    ordered,
    parts,
    forecasts: parts.forecasts,
  }
  return { chart, rows, placeholder: load.placeholder, fromPlaceholder, phase }
}

/**
 * A chart with categories whose shape is its own, such as a donut or a
 * funnel, until it moves to a family of its own: its categories in bands
 * and one value axis fitted to what `measure` says its shapes reach. A
 * chart's root adds where its tooltip sits and draws its marks inside
 * `CategoryChartFrame`. Parts that draw past the value axis's end say how
 * far with the `addRoom` it returns.
 */
function useCategoryChart<Shapes>(
  props: CategoryChartProps,
  options: CategoryChartOptions<Shapes>,
) {
  const { index, domain, tickCount = 5, tickValues, allowDecimals } = props
  const base = useCategoryRows(props, options)
  const { state, rows, drawn, shown, parts, keyOf } = base
  const { moves, plotSize } = state
  const rooms = useRegistry<number>()
  const shapes = options.measure(drawn, shown)
  const valueLength =
    options.orientation === 'vertical' ? plotSize.height : plotSize.width
  const room = Math.max(0, ...rooms.values)
  const scale = linearScale(
    extentWithRoom(
      extentWith(shapes.extent, valueReferences(parts.references)),
      room,
      valueLength,
    ),
    {
      domain,
      tickCount,
      tickValues,
      nice: options.nice,
      allowDecimals:
        allowDecimals ?? (options.stack === 'expand' || !allWhole(rows, shown)),
    },
  )
  const { categories, current } = useCategories(
    moves,
    drawn,
    index,
    options.bandOf,
    keyOf,
  )
  const x = bandScale(current.map((category) => category.key))
  const previousY = usePreviousScales({ [VALUE_AXIS]: scale })
  const previousX = usePreviousScales({ x }).x ?? x
  const frame: ChartFrame = {
    x: { scale: x, previous: previousX },
    y: { [VALUE_AXIS]: { scale, previous: previousY[VALUE_AXIS] ?? scale } },
    baselines: { [VALUE_AXIS]: baselineOf(scale) },
    axisOf: () => VALUE_AXIS,
    totals: () => true,
    // A part's room is registered once it has mounted, by which time the plot is measured.
    measuring: false,
    live: null,
  }
  const value = useCategoryValue(
    props,
    options,
    base,
    { categories, current },
    frame,
    noPlace,
  )
  return { ...value, shapes, room, addRoom: rooms.add }
}

function noPlace() {
  return null
}

/** The props a chart on the cartesian frame takes, such as a line chart, beside those every chart with categories takes. */
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

interface CartesianChartOptions extends CategoryRowOptions, CategoryLayout {
  /** The kinds of mark the chart draws, its own first: a series that names no mark is drawn as that. */
  kinds: readonly [MarkKind, ...MarkKind[]]
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

/**
 * A cartesian chart: its rows, the frame the cartesian model fits to them,
 * its parts and their declarations, its categories, and what is picked. A
 * chart's root adds where its tooltip sits and draws its marks inside
 * `CategoryChartFrame`.
 */
function useCartesianChart(
  props: CartesianChartProps & LiveChartProps,
  options: CartesianChartOptions,
) {
  const { index, config, domain, tickCount, tickValues, allowDecimals } = props
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
  const base = useCategoryRows(
    props,
    times ? { ...options, keyOf: (row) => timeKey(row[index]) } : options,
  )
  const { state, parts, keyOf } = base
  const { moves, plotSize, hidden } = state
  // A window keeps the rows the app lets go while they still show, so the line runs on to the
  // plot's start; nothing while it loads or failed.
  const clock = useLiveClock({
    window: props.window ?? null,
    live: props.live ?? false,
    paused: props.paused ?? false,
    rows: base.drawn,
    timeOf: (row) => readTime(row[index])?.time ?? Number.NaN,
    root: state.root,
    plot: state.plot,
    direction: state.direction,
  })
  const drawn = base.placeholder || base.failed ? base.drawn : clock.rows
  const rows = drawn === base.drawn ? base : { ...base, rows: drawn, drawn }
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
    format: props.format,
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
    y: {
      domain,
      tickCount,
      tickValues,
      allowDecimals,
      ...options.y,
    },
    axes: options.axes,
    references,
    room: { px: room, length: valueLength },
  })
  const x = model.x
  const { categories, current } = useCategories(moves, drawn, index, model.bandOf, keyOf)
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
      current.flatMap((category) => readTime(category.value)?.time ?? []),
      x.timeZone,
    )
  const timeText =
    x.kind === 'time'
      ? (value: unknown) => {
          const read = readTime(value)
          return read
            ? timeLabel(read.time, x.unit, props.locale, x.timeZone, oneDay)
            : String(value)
        }
      : undefined
  const value = useCategoryValue(
    timeText && props.categoryFormat === undefined
      ? { ...props, categoryFormat: timeText }
      : props,
    options,
    rows,
    { categories, current },
    frame,
    model.point,
  )
  return { ...value, model }
}

/** Where a row with no shown value sits among points, so the keys still reach it. */
const NO_POINT: XYValue = { x: 0, y: 0 }

/** The rows whose series isn't hidden, for a chart whose rows each belong to one. */
function rowsShown(
  rows: readonly ChartDatum[],
  seriesOf: (row: ChartDatum) => string,
  hidden: readonly string[],
) {
  return rows.filter((row) => !hidden.includes(seriesOf(row)))
}

/** A fraction of a plot's whole length as a fraction of its inner length, inside `inset` px at each end. */
function placeFromFraction(fraction: number, length: number, inset: number) {
  const inner = length - inset * 2
  if (inner <= 0) return 0.5
  return (fraction * length - inset) / inner
}

/**
 * The category under `at` in a plot whose box is `box`: by the chart's own
 * `pickAt` where it has one; among `points`, placed by both values, the one
 * nearest it in both directions; or else the nearest along the category
 * axis.
 */
function pickIndex(
  chart: Pick<ChartContextValue, 'orientation' | 'direction' | 'inset'> &
    Pick<CategoryReaderParts, 'pickAt'>,
  at: { x: number; y: number },
  box: DOMRect,
  centres: readonly number[],
  points: readonly XYValue[] | null,
) {
  if (chart.pickAt) return chart.pickAt(at, box)
  if (points) {
    return nearestPoint(
      points.map((point) => plotPlace(point, chart.direction)),
      {
        x: placeFromFraction(
          box.width === 0 ? 0 : (at.x - box.left) / box.width,
          box.width,
          chart.inset,
        ),
        y: placeFromFraction(
          box.height === 0 ? 0 : (at.y - box.top) / box.height,
          box.height,
          chart.inset,
        ),
      },
      {
        width: Math.max(0, box.width - chart.inset * 2),
        height: Math.max(0, box.height - chart.inset * 2),
      },
    )
  }
  return indexAt(alongCategories(at, box, chart.orientation, chart.direction), centres)
}

/**
 * The `<figure>` of a chart with categories, on the root's frame: the
 * chart's reader and focus from its categories, the parts written inside
 * it, and the chart's placeholder while it loads.
 */
function CategoryChartFrame({
  chart,
  slot,
  description,
  placeholder,
  empty,
  browse = true,
  className,
  style,
  children,
  ...props
}: Omit<ComponentProps<'figure'>, 'ref'> & {
  chart: CategoryChartInput
  slot: string
  description?: string
  placeholder: ReactNode
  empty?: ReactNode
  /**
   * Whether the plot is one stop that the pointer and the keys step through,
   * read as a data table, as on most charts. Off for a chart whose marks are
   * read and reached as they are, such as a bar list's rows, each a link or
   * a button of its own: the chart then gives `plot` to the element that
   * holds them.
   */
  browse?: boolean
  ref?: Ref<HTMLElement>
}) {
  const [along, setAlong] = useState<'x' | 'y'>('x')
  const [opens] = useState(() => new WeakMap<ChartTarget, () => void>())
  const own = categoryReader(chart, along, setAlong, opens)
  const live = chart.frame.live
  const read = live ? liveReader(own, live, chart.direction) : own
  const reader = browse ? read : { ...read, browse: null }
  const { current, selected, toggleSelected } = chart
  const keys = current.map((category) => category.key)
  const pickedKey = selected === null ? undefined : keys[selected]
  const root: ChartRootValue = {
    ...chart,
    reader,
    markerOf: (key) => chart.markerOf?.(key) ?? null,
    picked: pickedKey === undefined ? null : { kind: 'x', key: pickedKey },
    togglePicked: (target) => {
      const index = target.kind === 'node' ? null : indexOfKey(keys, target.key)
      if (index !== null) toggleSelected(index)
    },
  }
  const { focusProps, toldRef } = useIndexFocus(reader.items, chart.activeProps)
  // A chart of many columns scrolls sideways once its plot would be narrower than it allows,
  // only while it shows its marks, so a note in their place stays in view. It takes the
  // opposite direction to the page, so it opens at its end, the latest column, from the first
  // paint, and stays there as it narrows; its parts take the page's direction again.
  const least = chart.leastPlotWidth
  const scroller =
    least !== undefined && (chart.status === 'ready' || chart.status === 'hidden')
  // Whether it overflows: until it is measured, it is taken to, so the axes that hold still
  // hide what passes under them from the first paint.
  const [fits, setFits] = useState(false)
  const figure = chart.root
  useLayoutEffect(() => {
    const frame = figure.current
    if (!scroller || !frame) return
    const measure = () => setFits(frame.scrollWidth <= frame.clientWidth)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(frame)
    return () => observer.disconnect()
  }, [scroller, figure, least])
  // A new range opens at its end again.
  const last = keys.at(-1)
  useLayoutEffect(() => {
    if (scroller) figure.current?.scrollTo({ left: 0, behavior: 'instant' })
  }, [scroller, last, figure])
  const scrolls = scroller && !fits
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
      data-scroller={scroller ? '' : undefined}
      data-scrolls={scrolls ? '' : undefined}
      className={cn(
        scroller &&
          'scrollbar-thin grid-cols-[auto_minmax(var(--plot-least),1fr)_auto] overflow-x-auto overflow-y-hidden [grid-template-areas:"top_top_top"_"._top-axis_."_"end-axis_plot_start-axis"_"._bottom-axis_."_"bottom_bottom_bottom"]',
        scroller &&
          (chart.direction === 'rtl'
            ? '[direction:ltr] *:[direction:rtl]'
            : '[direction:rtl] *:[direction:ltr]'),
        className,
      )}
      style={
        scroller ? ({ '--plot-least': `${least}px`, ...style } as CSSProperties) : style
      }
      {...props}
    >
      <ChartContext value={chart}>
        <ChartPartsContext value={chart.parts}>
          <ChartAxesContext value={axesOf(chart)}>
            <SeriesWordsContext value={categoryWords(chart)}>
              <IndexActive
                items={reader.items}
                active={chart.activeProps}
                toldRef={toldRef}
              >
                {live && <LiveHold hold={live.hold} />}
                {children}
                {placeholder}
              </IndexActive>
            </SeriesWordsContext>
          </ChartAxesContext>
        </ChartPartsContext>
      </ChartContext>
      {scroller && <ScrollCorners direction={chart.direction} />}
    </RootFrame>
  )
}

/**
 * What the shared axes, grid and reference parts read of a chart with
 * categories: its frame, but none on a grid of cells, whose axes only name
 * its columns and rows; the names along each axis, categories along the
 * category axis; and every value a reference at a summary reads.
 */
function axesOf(chart: ChartContextValue): ChartAxesValue {
  const { grid, frame, orientation, current, categories, series, hidden, stack } = chart
  const keys = current.map((category) => category.key)
  const indexOf = (target: ChartTarget) => indexOfKey(keys, targetKey(target))
  const percent = stack === 'expand'
  if (grid) {
    // A grid's names come from its layout, so they wait for the cells as a category's do.
    const laidOut = chart.status === 'ready' || chart.status === 'hidden'
    const gridNames = (axis: 'x' | 'y'): AxisNames => {
      const own = grid[axis]
      const names = laidOut ? own.names : []
      return {
        all: names,
        current: names,
        nameOf: (target) => {
          const index = indexOf(target)
          return index === null ? null : own.nameOf(index)
        },
        format: own.format,
        keepInside: false,
      }
    }
    return {
      frame: null,
      orientation,
      inset: chart.inset,
      names: { x: gridNames('x'), y: gridNames('y') },
      summaryValues: () => [],
      percent,
    }
  }
  const named: AxisNames = {
    all: categories,
    current,
    nameOf: indexOf,
    format: chart.categoryText,
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
        return current.map((category) => {
          const point = chart.xyOf(category.index)?.value
          return point ? (axis === 'x' ? point.x : point.y) : null
        })
      }
      // Only the series read against the axis.
      const shown = series.filter(
        (key) => !hidden.includes(key) && frame.axisOf(key) === axis,
      )
      return stack === 'none'
        ? current.flatMap((category) => shown.map((key) => category.datum[key]))
        : current.map((category) =>
            shown.reduce((sum, key) => sum + (numberOf(category.datum[key]) ?? 0), 0),
          )
    },
    percent,
  }
}

/**
 * The reader of a chart whose plot shows a window of time: its marks sit in
 * a layer the clock moves, so what is under the pointer is read where the
 * layer is now, and a tooltip sits where its mark is on the plot.
 */
function liveReader(
  reader: ChartReader,
  live: ChartLive,
  direction: ReadingDirection,
): ChartReader {
  const { browse } = reader
  if (!browse) return reader
  // The layer moves toward the reading start: left, or right in right to left.
  const sign = direction === 'rtl' ? -1 : 1
  const anchor = (target: ChartTarget) => {
    const at = browse.anchor(target)
    return at && { ...at, x: at.x - sign * live.offset() }
  }
  // The keys reach only what the plot shows: rows kept past its start, or arrived past its end
  // while it is held, are out of view.
  const shown = (target: ChartTarget | null) => {
    const at = target && anchor(target)
    return at !== null && at.x >= -1e-6 && at.x <= 1 + 1e-6
  }
  const back = direction === 'rtl' ? 'ArrowRight' : 'ArrowLeft'
  const on = direction === 'rtl' ? 'ArrowLeft' : 'ArrowRight'
  /** From `target`, stepping `key` while it is out of view, the first in view, or null. */
  const toView = (target: ChartTarget | null, key: string) => {
    let at = target
    for (let steps = 0; at && !shown(at) && steps < browse.stops; steps += 1) {
      const next = browse.step(at, key)
      if (!next || next === at) return null
      at = next
    }
    return at && shown(at) ? at : null
  }
  return {
    ...reader,
    browse: {
      ...browse,
      targetAt: (point) =>
        browse.targetAt({ ...point, x: point.x + sign * live.offset() * point.width }),
      anchor,
      start: toView(browse.start, back),
      step: (from, key) => {
        const next = browse.step(from, key)
        if (!next) return null
        if (key === 'Home') return toView(next, on) ?? from
        if (key === 'End') return toView(next, back) ?? from
        return shown(next) ? next : from
      },
    },
  }
}

/** Holds a live plot still while anything on it is lit, by the pointer or the keys, so it can be read. */
function LiveHold({ hold }: { hold: (held: boolean) => void }) {
  const lit = useChartActive().spotlit !== null
  useLayoutEffect(() => {
    hold(lit)
  }, [hold, lit])
  return null
}

/** The corners beside the axes along the top and bottom of a chart that scrolls sideways, which hold still with the axes down its sides, so the names passing under them hide there too. */
function ScrollCorners({ direction }: { direction: ReadingDirection }) {
  return (['top', 'bottom'] as const).flatMap((row) =>
    (['start', 'end'] as const).map((side) => (
      <span
        key={`${row}-${side}`}
        aria-hidden
        className={cn(
          'pointer-events-none group-data-scrolls/chart:sticky group-data-scrolls/chart:z-40 group-data-scrolls/chart:bg-(--chart-surface,var(--card))',
          row === 'top' ? '[grid-row:top-axis]' : '[grid-row:bottom-axis]',
          side === 'start' ? '[grid-column:start-axis]' : '[grid-column:end-axis]',
          stickTo(side, direction),
        )}
      />
    )),
  )
}

export {
  type CartesianChartProps,
  cartesianChartKeys,
  type CartesianParts,
  cartesianSignature,
  CategoryChartFrame,
  type CategoryChartInput,
  type CategoryReaderParts,
  type CategoryTable,
  categoryReader,
  categoryTable,
  type ChartCategory,
  type ChartCellGrid,
  type ChartContextValue,
  type ChartGridAxis,
  type ChartPartDeclaration,
  type ChartRoomState,
  type ChartXYPoint,
  columnLabel,
  type LiveChartProps,
  type NamedValueAxis,
  pickIndex,
  rowsShown,
  useCartesianChart,
  useCategoryChart,
  useChart,
}
