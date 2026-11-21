'use client'

import { useSpinner } from '@/registry/components/kino/spinner'
import {
  allWhole,
  alongCategories,
  type Band,
  bandCentre,
  changeSince,
  type ChartConfig,
  type ChartDatum,
  type ChartOrientation,
  type ChartStack,
  type DomainEnd,
  extentWith,
  extentWithRoom,
  fractionOf,
  type GridCell,
  indexAt,
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
  tickCountFor,
  valueScale,
  type ValueScale,
  type XYValue,
} from '@/registry/lib/chart-math'
import {
  ChangeText,
  type ChartFocusProps,
  ChartFrame,
  type ChartFormat,
  type ChartMessages,
  type ChartMoves,
  type ChartPoint,
  type ChartReader,
  type ChartRootState,
  type ChartRootValue,
  forcedSeriesColor,
  percent,
  type PlotPoint,
  swatchClassName,
  swatchStyle,
  tooltipQuietClassName,
  useBefore,
  useChartFocus,
  useChartGroup,
  useChartMoves,
  useChartRoot,
  useLeaving,
} from '@/registry/lib/chart-root'
import {
  chartStatus,
  type ChartStatus,
  type ChartTable,
  type ChartTarget,
  indexOfKey,
  targetKey,
  targetSeries,
} from '@/registry/lib/chart-state'
import { useControllable } from '@/registry/lib/controllable'
import {
  type ComponentProps,
  createContext,
  type CSSProperties,
  type ReactNode,
  type Ref,
  type RefObject,
  use,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import { cn } from '@/lib/utils'

/*
 * The category family: charts whose marks are categories, the rows of their
 * data, such as bars, lines, slices and tiles. It sits on the chart root
 * (`chart-root`), which knows nothing about categories: this file keeps the
 * categories and the ones leaving, the value scale, and the motion the axes
 * share, and hands the root a reader that answers for the categories. A
 * chart's root (`BarChart`) works out its own shapes and where its tooltip
 * sits; everything else comes from here and the root, so every chart looks,
 * moves and reads the same way.
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

/**
 * The XY frame: what a chart whose x is a value too, such as a scatter, has
 * beside its value scale. Each category is a point placed by its two
 * values; the x axis, the grid and reference lines read this scale, and the
 * pointer and the keys find points in two dimensions.
 */
interface ChartXY {
  /** The scale along the x axis. */
  scale: ValueScale
  /** The x scale before the last change, so what arrives starts where it would have been. */
  previousScale: ValueScale
  /** How the x axis writes its values when it is given no `format`; the chart's `format` by default. */
  format?: ChartFormat
  /** Each point's two values, by its place among the categories. */
  points: readonly XYValue[]
  /** Takes a value into the x axis's range, such as a reference line's; returns how to let it go. */
  addReference: (value: number) => () => void
  /** What each axis measures, which titles the axes unless they are given a `label`. */
  labels?: { x: string; y: string }
}

/**
 * A name on a category axis: a category's, or on a grid of cells, a
 * column's or a row's, over the band of the axis it names, such as a month
 * over its weeks.
 */
interface ChartAxisName {
  key: string
  /** The name as the data has it, which the axis writes. */
  value: unknown
  /** Its place among the axis's names. */
  index: number
  band: Band
  leaving: boolean
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

/** The x scale of a chart with categories, which has none: never drawn. */
const NO_SCALE: ValueScale = { domain: [0, 1], ticks: [] }

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
  scale: ValueScale
  /** The scale before the last change, so what arrives starts where it would have been. */
  previousScale: ValueScale
  /** The x scale and its points, for a chart whose x is a value too; none for a chart with categories. */
  xy?: ChartXY
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
  /** Takes a value into the value axis's range, such as a reference line's; returns how to let it go. */
  addReference: (value: number) => () => void
  /** Leaves `px` past the bars' ends for labels that sit there; returns how to let it go. */
  addRoom: (px: number) => () => void
  /** Marks a series' values from the category keyed `from` on as a forecast; returns how to let it go. */
  addForecast: (forecast: ChartForecast) => () => void
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

/** A series whose values from the category keyed `from` on are projected. */
interface ChartForecast {
  series: string
  from: string
}

const ChartContext = createContext<ChartContextValue | null>(null)

/** Whether the value of `series` at `index` is a forecast. */
function isForecast(chart: ChartContextValue, series: string, index: number) {
  return chart.forecasts.some((forecast) => {
    if (forecast.series !== series) return false
    const from = chart.current.findIndex((category) => category.key === forecast.from)
    return from !== -1 && index >= from
  })
}

function useChart() {
  const chart = use(ChartContext)
  if (!chart) throw new Error('Chart parts go inside a chart, such as a `BarChart`.')
  return chart
}

/**
 * What is under the pointer, kept apart from the rest of the chart, so a
 * hover re-renders only the parts that show it, never the data table or
 * each category's column.
 */
interface ChartActiveValue {
  /** The category under the pointer or the focus, by its place in the data. */
  active: number | null
  setActive: (index: number | null) => void
  /** The category that stays bright: the one under the pointer, or else the one picked. */
  spotlit: number | null
}

const ChartActiveContext = createContext<ChartActiveValue | null>(null)

function useChartActive() {
  const value = use(ChartActiveContext)
  if (!value) throw new Error('Chart parts go inside a chart, such as a `BarChart`.')
  return value
}

/** A line along the plot's height, or across its width, that `axisSlide` moves. */
const slideLine = {
  x: 'absolute inset-y-0 left-0 w-0',
  y: 'absolute inset-x-0 top-0 h-0',
} as const

/** A layer over an axis's area that its sliding labels measure their slide in. */
const axisLayerClassName = 'pointer-events-none absolute inset-0 [container-type:size]'

/**
 * A tick, a grid line or a reference sliding along the value axis: in from
 * where the old range put it, and fading as it leaves. The resting place is
 * a variable too, so an inline style never overrules the starting one.
 */
const tickMove =
  '[translate:var(--tick-to)] transition-none group-data-mounted/chart:transition-[translate,opacity] duration-(--motion-layout-duration) ease-(--motion-layout-easing) group-data-mounted/chart:starting:[translate:var(--tick-from)] group-data-mounted/chart:starting:opacity-0 data-leaving:opacity-0 motion-reduce:group-data-mounted/chart:transition-opacity'

/**
 * A line of no thickness slid to `place` along one axis of the size
 * container it sits in, a fraction of the value axis from its start, from
 * where `from` put it. Across the page, values run from the reading start;
 * up the page, from the bottom. Being no thicker than a line, it never makes
 * the page scroll wherever it slides. What sits on it is placed from its
 * physical top left.
 */
function axisSlide(
  axis: 'x' | 'y',
  place: number,
  from: number,
  direction: ReadingDirection,
): CSSProperties {
  return {
    '--tick-to': slideTo(axis, place, direction),
    '--tick-from': slideTo(axis, from, direction),
  } as CSSProperties
}

/** The `translate` that puts a line at `place` along the value axis. */
function slideTo(axis: 'x' | 'y', place: number, direction: ReadingDirection) {
  return axis === 'x'
    ? `${plotOffset(direction === 'rtl' ? 1 - place : place, 'cqw')} 0`
    : `0 ${plotOffset(1 - place, 'cqh')}`
}

/**
 * Where `place`, a fraction of the plot from its physical left or top, sits
 * along it in CSS, with `unit` the plot's width (`cqw`) or height (`cqh`).
 * A chart with an `inset`, such as a scatter, keeps that many px clear
 * inside each edge, as `--chart-inset`, so a point at either end of an axis
 * is drawn whole; on any other chart it is the place itself.
 */
function plotOffset(place: number, unit: 'cqw' | 'cqh') {
  const share = Math.round(place * 1e6) / 1e6
  return `calc(var(--chart-inset, 0px) + ${share} * (100${unit} - 2 * var(--chart-inset, 0px)))`
}

/**
 * The same place as a fraction of the plot's whole `length` in px, for what
 * JavaScript places, such as a tooltip; and with `toPlace`, back from one.
 */
function plotFraction(place: number, length: number, inset: number) {
  if (length <= 0) return place
  return (inset + place * Math.max(0, length - inset * 2)) / length
}

function placeFromFraction(fraction: number, length: number, inset: number) {
  const inner = length - inset * 2
  if (inner <= 0) return 0.5
  return (fraction * length - inset) / inner
}

/** Where a value sits along the value axis, from the reading start, or from the bottom. */
function valuePlace(value: number, scale: ValueScale) {
  return fractionOf(value, scale.domain)
}

/**
 * The ticks to draw: the scale's own and, until the move their range
 * changed in has ended, every one drawn before that the scale no longer
 * has, which fades as it slides toward where the new scale puts it, so the
 * change of range shows. A tick still fading in when the range turns back
 * fades out from where it is. In value order, so no tick's element moves in
 * the page, which would make it jump.
 */
function useTicks(axis: ChartAxis = 'value') {
  const { scale } = scalesOf(useChart(), axis)
  const leaving = useLeaving(useChartMoves(), scale.ticks, String)
  return [
    ...scale.ticks.map((value) => ({ value, leaving: false })),
    ...leaving.map((value) => ({ value, leaving: true })),
  ].toSorted((a, b) => a.value - b.value)
}

/**
 * Which of a chart's scales a part reads: the value axis's, or an XY
 * frame's x axis's.
 */
type ChartAxis = 'value' | 'x'

/** The scale of `axis`, and the one before its last change; none on a chart without it. */
function scalesOf(
  chart: Pick<ChartContextValue, 'scale' | 'previousScale' | 'xy'>,
  axis: ChartAxis,
) {
  if (axis === 'value') return { scale: chart.scale, previousScale: chart.previousScale }
  return {
    scale: chart.xy?.scale ?? NO_SCALE,
    previousScale: chart.xy?.previousScale ?? NO_SCALE,
  }
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
  const { current, orientation, direction, xy, grid } = chart
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
  // A chart that scrolls opens at its end, so the keys start there too.
  const start =
    count === 0
      ? null
      : Math.min(
          chart.keys?.start ?? (chart.leastPlotWidth === undefined ? 0 : count - 1),
          count - 1,
        )
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
    targetAt: (point: PlotPoint) => {
      // The plot's own box, from its top left, which the chart's own picking reads as the page's.
      const box = new DOMRect(0, 0, point.width, point.height)
      const index = pickIndex(chart, point, box, centres)
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
      if (chart.stepSeries && !xy && (key === 'ArrowUp' || key === 'ArrowDown')) {
        return at(index, chart.stepSeries(index, series, key === 'ArrowUp' ? -1 : 1))
      }
      // Points placed by two values step by x along it, and by y up and down; cells step
      // by column along it, and by row up and down. Round the circle, Right steps
      // clockwise, the way the marks run, as they aren't mirrored in right to left.
      const next = xy
        ? stepPoint(xy.points, index, key, direction)
        : grid
          ? stepCell(grid.cells, index, key, direction)
          : stepIndex(key, index, count, orientation, chart.round ? 'ltr' : direction)
      if (next === null) return null
      if (xy) setAlong(keyAxis(key))
      return at(next, series)
    },
    rank: (target) => {
      const index = indexOf(target) ?? 0
      if (xy) return pointRank(xy.points, index, along)
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
    lights: (target) => (target.kind === 'node' ? target.id : targetSeries(target)),
    describe: (target) => {
      const index = indexOf(target)
      return index === null ? '' : columnLabel(chart, index)
    },
    tooltip: (target) => {
      const index = indexOf(target)
      if (index === null) return null
      return chart.tooltipContent ? (
        chart.tooltipContent(index)
      ) : (
        <ChartTooltipContent index={index} />
      )
    },
    table: categoryTable(chart),
    open: (target) => {
      const own = opens.get(target)
      if (own) return own
      const index = indexOf(target)
      return index === null ? null : (chart.zoomIn?.(index) ?? null)
    },
    back: chart.zoomOut ?? null,
  }
}

/**
 * The data as a table: a row for each category and a column for each shown
 * series, or the chart's own columns, or its own rows.
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
  const shown = chart.series.filter((key) => !chart.hidden.includes(key))
  return {
    header: messages.category,
    columns: shown.map((key) => chart.config[key]?.label ?? key),
    rows: current.map((category) => ({
      key: category.key,
      name: categoryText(category.value),
      cells: shown.map(
        (key) =>
          `${chart.seriesText(category, key)}${isForecast(chart, key, category.index) ? `, ${messages.forecast}` : ''}`,
      ),
    })),
    footer: [],
  }
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
  const leaving = useLeaving(moves, current, categoryKey)
  // Drawn in one fixed order, whatever the data's: an element moved in the page starts
  // again with no transition, so a sort would jump instead of sliding.
  const categories = [
    ...current,
    ...leaving.map((category) => ({ ...category, leaving: true })),
  ].toSorted((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
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
  const picked = chart.selected === index ? `, ${chart.messages.selected}` : ''
  const name = `${chart.categoryText(category.value)}${picked}`
  if (chart.describe) return `${name}: ${chart.describe(index)}`
  const before = chart.ordered ? chart.current[index - 1] : undefined
  const values = chart.series
    .filter((key) => !chart.hidden.includes(key))
    .map((key) => {
      const value = category.datum[key]
      const name = chart.config[key]?.label
      const change = before ? changeSince(value, before.datum[key]) : null
      const said =
        change === null
          ? ''
          : `, ${chart.messages.change(change, percent(chart.locale).format(Math.abs(change)))}`
      const projected = isForecast(chart, key, index)
        ? `, ${chart.messages.forecast}`
        : ''
      return `${typeof name === 'string' ? name : key} ${chart.seriesText(category, key)}${projected}${said}`
    })
  return `${name}: ${values.join(', ')}`
}

/** The least room between two value ticks, in px: up the axis, and along it. */
const TICK_SPACING = { upright: 32, across: 56 } as const

/** The props every chart with categories takes on its root. */
interface CategoryChartProps extends Omit<
  ComponentProps<'figure'>,
  'children' | 'onSelect'
> {
  /** One row per category: the category under `index`, and a value under each series' key. */
  data: readonly ChartDatum[]
  /** The key of each row's category. */
  index: string
  config: ChartConfig
  /** What the chart shows, for screen readers: a short title, such as "Visitors by month". */
  label: string
  /** A longer account for screen readers, such as the trend the chart shows. */
  description?: string
  /** How values are written in the tooltip, the labels and the table, and the value axis by default. */
  format?: ChartFormat
  /**
   * The categories run in order, such as days or months, so the tooltip and
   * the screen reader give each value's change since the category before.
   */
  ordered?: boolean
  /** How a category is written; `String` by default. */
  categoryFormat?: (value: unknown) => string
  /** The locale numbers are written in. Give one, so the server and the browser agree. */
  locale?: Intl.LocalesArgument
  /** The values at the ends of the value axis; `'auto'` fits the data. */
  domain?: readonly [DomainEnd, DomainEnd]
  /** About how many ticks the value axis marks. */
  tickCount?: number
  /** The ticks to mark, in place of round ones. */
  tickValues?: readonly number[]
  /** Ticks between whole numbers, such as 0.5; off by default when every value is whole. */
  allowDecimals?: boolean
  /** Gives each series after the first a pattern over its colour, so series differ by more than colour. */
  patterns?: boolean
  /** The series hidden, for a legend you control. */
  hiddenSeries?: string[]
  defaultHiddenSeries?: string[]
  onHiddenSeriesChange?: (hidden: string[]) => void
  /** The category under the pointer or the focus, by its place in `data`, for a chart you control. */
  activeIndex?: number | null
  defaultActiveIndex?: number | null
  onActiveIndexChange?: (index: number | null) => void
  /** The category picked, by its key; giving this, `defaultSelected` or `onSelectedChange` lets a press pick one. */
  selected?: string | null
  defaultSelected?: string | null
  onSelectedChange?: (key: string | null) => void
  /** Waiting for the data: a placeholder shows, and the marks grow out of it when the data arrives. */
  loading?: boolean
  /** The data couldn't load: `true` for the chart's own words, or what to say. */
  error?: ReactNode
  /** Shows a button that tries again, with `error`. */
  onRetry?: () => void
  /** What shows when `data` is empty. */
  empty?: ReactNode
  /** Every word the chart says or reads out, for a chart in another language. */
  messages?: Partial<ChartMessages>
  ref?: Ref<HTMLElement>
  children?: ReactNode
}

/** Where the entrance is: waiting to be seen, playing, or over. */
type EntrancePhase = 'waiting' | 'entering' | 'settled'

interface CategoryChartOptions<Shapes> {
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
  bandOf: (index: number, count: number) => Band
  /**
   * The chart's own shapes from the rows and the shown series, and the
   * values they reach; on an XY frame, each row's point too, in order, and
   * the x values they reach.
   */
  measure: (
    rows: readonly ChartDatum[],
    shown: readonly string[],
  ) => Shapes & {
    extent: Span
    xy?: { extent: Span; points: readonly XYValue[] }
  }
  /** Round the value axis's ends out to a tick; off for shares that fill the axis. */
  nice: boolean
  /** Drawn round a centre, clockwise in either reading direction, so the arrows step the way it runs. */
  round?: boolean
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
  /**
   * The px kept clear inside the plot's edges, on both axes, for marks drawn
   * around a point, such as a scatter's bubbles; none by default.
   */
  inset?: number
  /** The x axis of an XY frame, whose points `measure` gives: its range, ticks and how it writes values. */
  x?: {
    domain?: readonly [DomainEnd, DomainEnd]
    tickCount?: number
    allowDecimals: boolean
    format?: ChartFormat
    labels?: { x: string; y: string }
  }
}

/**
 * Everything a chart with categories keeps and works out before it draws
 * its own marks: the root's state, the categories and the ones leaving, the
 * value scale, what is picked, the loading placeholder and the entrance. A
 * chart's root adds where its tooltip sits and draws its marks inside
 * `CategoryChartFrame`.
 */
function useCategoryChart<Shapes>(
  props: CategoryChartProps,
  options: CategoryChartOptions<Shapes>,
) {
  const {
    data,
    index,
    format,
    ordered = false,
    categoryFormat = String,
    domain,
    tickCount = 5,
    tickValues,
    allowDecimals,
    activeIndex,
    defaultActiveIndex = null,
    onActiveIndexChange,
    selected: selectedKey,
    defaultSelected = null,
    onSelectedChange,
    loading = false,
    error,
  } = props
  const state = useChartRoot(props, {
    entrance: options.entrance,
    heightFromData: options.heightFromData ?? false,
  })
  const { moves, plotSize, hidden, series, messages, valueText } = state
  const references = useRegistry<number>()
  const rooms = useRegistry<number>()
  const forecasts = useRegistry<ChartForecast>()
  const xReferences = useRegistry<number>()

  // A chart that mounts loading shows its placeholder from the first paint. Later, the
  // placeholder shows once loading has lasted, then long enough to be seen; until then the
  // marks there are stay.
  const [firstLoad, setFirstLoad] = useState(loading)
  if (firstLoad && !loading) setFirstLoad(false)
  const placeholder = useSpinner(loading) || firstLoad
  const failed = Boolean(error) && !loading
  const rows = placeholder || failed ? [] : data
  const drawn = options.rowsShown
    ? options.rowsShown(rows, hidden)
    : options.seriesOfRow
      ? rowsShown(rows, options.seriesOfRow, hidden)
      : rows
  const { categories, current } = useCategories(
    moves,
    drawn,
    index,
    options.bandOf,
    options.keyOf,
  )
  const shown = series.filter((key) => !hidden.includes(key))
  const shapes = options.measure(drawn, shown)
  const valueLength =
    options.orientation === 'vertical' ? plotSize.height : plotSize.width
  const room = Math.max(0, ...rooms.values)
  const scale = valueScale(
    extentWithRoom(extentWith(shapes.extent, references.values), room, valueLength),
    {
      domain,
      // Lying bars' values run across, where a value takes more room than a line of text.
      tickCount: tickCountFor(
        tickCount,
        valueLength,
        options.orientation === 'vertical' ? TICK_SPACING.upright : TICK_SPACING.across,
      ),
      tickValues,
      nice: options.nice,
      allowDecimals:
        allowDecimals ?? (options.stack === 'expand' || !allWhole(rows, shown)),
    },
  )
  const previousScale = useBefore(scale, `${scale.domain.join()}|${scale.ticks.join()}`)
  const xy = options.x && shapes.xy
  const xScale = xy
    ? valueScale(extentWith(xy.extent, xReferences.values), {
        domain: options.x?.domain,
        // The ends round to the ticks asked for, whatever the plot's width, so the first paint,
        // before the plot is measured, shows the same range; a narrow plot marks fewer of them.
        domainTickCount: options.x?.tickCount ?? 5,
        tickCount: tickCountFor(
          options.x?.tickCount ?? 5,
          plotSize.width,
          TICK_SPACING.across,
        ),
        allowDecimals: options.x?.allowDecimals,
      })
    : NO_SCALE
  const previousXScale = useBefore(
    xScale,
    `${xScale.domain.join()}|${xScale.ticks.join()}`,
  )

  const status = chartStatus({
    placeholder,
    loading,
    failed,
    rows: rows.length,
    shown: shown.length,
    drawn: drawn.length,
  })

  const selectable =
    selectedKey !== undefined ||
    props.defaultSelected !== undefined ||
    onSelectedChange !== undefined
  const [picked, setPicked] = useControllable(
    selectedKey,
    defaultSelected,
    onSelectedChange,
  )
  const selected = indexOfKey(
    current.map((category) => category.key),
    picked,
  )

  // The data that arrived as the placeholder went: until it changes, its marks grow out of the
  // placeholder's.
  const [loaded, setLoaded] = useState({
    placeholder,
    data: null as typeof data | null,
  })
  if (loaded.placeholder !== placeholder) {
    setLoaded({ placeholder, data: placeholder ? null : data })
  }
  const fromPlaceholder = !placeholder && loaded.data === data
  const [phase, setPhase] = useState<EntrancePhase>(
    options.entrance ? 'waiting' : 'settled',
  )
  if (phase === 'waiting' && (state.seen || fromPlaceholder) && status !== 'loading') {
    setPhase(fromPlaceholder ? 'settled' : 'entering')
  }
  // The entrance is over once its move has run, its cascade too.
  const entering = phase === 'entering'
  const figure = state.root
  const cascade = options.cascade?.variable
  const cascadeFallback = options.cascade?.fallback ?? 0
  useLayoutEffect(() => {
    if (!entering) return
    let live = true
    const element = figure.current
    const span = cascade && element ? cascadeSpan(element, cascade, cascadeFallback) : 0
    void moves.request(span, true).then(() => {
      if (live) setPhase('settled')
    })
    return () => {
      live = false
    }
  }, [entering, moves, figure, cascade, cascadeFallback])

  const datumText = (value: unknown) => {
    const range = rangeOf(value)
    if (range) return `${valueText(range[0])} – ${valueText(range[1])}`
    const number = numberOf(value)
    return number === null ? messages.noValue : valueText(number)
  }
  const chart: ChartContextValue = {
    ...state,
    format,
    categories,
    current,
    orientation: options.orientation,
    round: options.round ?? false,
    stack: options.stack,
    scale,
    previousScale,
    inset: options.inset ?? 0,
    xy: xy
      ? {
          scale: xScale,
          previousScale: previousXScale,
          format: options.x?.format,
          points: xy.points,
          addReference: xReferences.add,
          labels: options.x?.labels,
        }
      : undefined,
    datumText,
    seriesText: (category, key) => datumText(category.datum[key]),
    categoryText: categoryFormat,
    activeProps: { activeIndex, defaultActiveIndex, onActiveIndexChange },
    selected,
    selectable,
    toggleSelected: (at) => {
      const key = current[at]?.key
      if (key !== undefined) setPicked(picked === key ? null : key)
    },
    entered: phase !== 'waiting',
    status,
    ordered,
    addReference: references.add,
    addRoom: rooms.add,
    addForecast: forecasts.add,
    forecasts: forecasts.values,
  }
  return {
    chart,
    shapes,
    rows,
    placeholder,
    fromPlaceholder,
    phase,
    room,
  }
}

/** The share of its role's duration a cascade's marks start over, from its variable on the chart. */
function cascadeSpan(element: Element, variable: string, fallback: number) {
  const value = Number.parseFloat(getComputedStyle(element).getPropertyValue(variable))
  return Number.isFinite(value) ? Math.max(0, value) : fallback
}

/** The rows whose series isn't hidden, for a chart whose rows each belong to one. */
function rowsShown(
  rows: readonly ChartDatum[],
  seriesOf: (row: ChartDatum) => string,
  hidden: readonly string[],
) {
  return rows.filter((row) => !hidden.includes(seriesOf(row)))
}

/**
 * The category under `at` in a plot whose box is `box`: by the chart's own
 * `pickAt` where it has one; on an XY frame, the point nearest it in both
 * directions; or else the nearest along the category axis.
 */
function pickIndex(
  chart: Pick<ChartContextValue, 'orientation' | 'direction' | 'xy' | 'scale' | 'inset'> &
    Pick<CategoryReaderParts, 'pickAt'>,
  at: { x: number; y: number },
  box: DOMRect,
  centres: readonly number[],
) {
  if (chart.pickAt) return chart.pickAt(at, box)
  if (chart.xy) {
    return nearestPoint(
      chart.xy.points.map((point) => xyPlace(chart, point)),
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
 * Where a point placed by two values sits on an XY frame's plot, as
 * fractions of it from its physical left and its top: x runs from the
 * reading start, and y up from the bottom.
 */
function xyPlace(
  chart: Pick<ChartContextValue, 'xy' | 'scale' | 'direction'>,
  point: XYValue,
): XYValue {
  const along = chart.xy ? fractionOf(point.x, chart.xy.scale.domain) : 0
  return {
    x: chart.direction === 'rtl' ? 1 - along : along,
    y: 1 - fractionOf(point.y, chart.scale.domain),
  }
}

/** Values that parts of the chart add while they show, such as the values reference lines need the axis to reach. */
function useRegistry<T>() {
  const [values, setValues] = useState<readonly T[]>([])
  const add = useCallback((value: T) => {
    setValues((all) => [...all, value])
    return () =>
      setValues((all) => {
        const at = all.indexOf(value)
        return at === -1 ? all : [...all.slice(0, at), ...all.slice(at + 1)]
      })
  }, [])
  return { values, add }
}

/**
 * The focus as the parts of a chart with categories read it: the category
 * it is on, by its place in the data. Told when new data moves the category
 * it is on, for a chart that keeps its own.
 */
function CategoryActive({
  toldRef,
  children,
}: {
  toldRef: RefObject<number | null>
  children: ReactNode
}) {
  const { current, activeProps } = useChart()
  const { focus, setFocus, spotlit } = useChartFocus()
  const grouped = useChartGroup() !== null
  const keys = current.map((category) => category.key)
  const active = focus === null ? null : indexOfKey(keys, targetKey(focus))
  const lit = spotlit === null ? null : indexOfKey(keys, targetKey(spotlit))
  const { activeIndex, onActiveIndexChange } = activeProps
  useLayoutEffect(() => {
    if (active === toldRef.current) return
    // Moves the focus made are told as they happen, so this is new data moving its key.
    toldRef.current = active
    if (activeIndex === undefined && !grouped && active !== null)
      onActiveIndexChange?.(active)
  })
  // One function for the chart's life, so parts that take it, such as the
  // Bar list's rows, redraw only when what they show changes, without the
  // React Compiler.
  const latest = useRef(keys)
  useLayoutEffect(() => {
    latest.current = keys
  })
  const setActive = useCallback(
    (index: number | null) => {
      const key = index === null ? undefined : latest.current[index]
      setFocus(key === undefined ? null : { kind: 'x', key })
    },
    [setFocus],
  )
  const value = useMemo(
    () => ({ active, setActive, spotlit: lit }),
    [active, setActive, lit],
  )
  return <ChartActiveContext value={value}>{children}</ChartActiveContext>
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
  const reader = categoryReader(chart, along, setAlong, opens)
  const { current, selected, toggleSelected, activeProps } = chart
  const keys = current.map((category) => category.key)
  const targetOf = (index: number | null | undefined): ChartTarget | null => {
    const key = index === null || index === undefined ? undefined : keys[index]
    return key === undefined ? null : { kind: 'x', key }
  }
  const root: ChartRootValue = {
    ...chart,
    reader,
    markerOf: (key) => chart.markerOf?.(key) ?? null,
    picked: targetOf(selected),
    togglePicked: (target) => {
      const index = target.kind === 'node' ? null : indexOfKey(keys, target.key)
      if (index !== null) toggleSelected(index)
    },
  }
  // The index last told to `onActiveIndexChange`, or seen, so each change is told once.
  const toldRef = useRef<number | null>(null)
  const focus: ChartFocusProps = {
    focus:
      activeProps.activeIndex === undefined
        ? undefined
        : targetOf(activeProps.activeIndex),
    defaultFocus: targetOf(activeProps.defaultActiveIndex),
    onFocusChange: (target) => {
      const index = target === null ? null : indexOfKey(keys, targetKey(target))
      if (index === toldRef.current) return
      toldRef.current = index
      activeProps.onActiveIndexChange?.(index)
    },
  }
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
    <ChartFrame
      root={root}
      focus={focus}
      slot={slot}
      description={description}
      empty={empty}
      browse={browse}
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
        {
          ...(chart.inset ? { '--chart-inset': `${chart.inset}px` } : {}),
          ...(scroller ? { '--plot-least': `${least}px` } : {}),
          ...style,
        } as CSSProperties
      }
      {...props}
    >
      <ChartContext value={chart}>
        <CategoryActive toldRef={toldRef}>
          {children}
          {placeholder}
        </CategoryActive>
      </ChartContext>
      {scroller && <ScrollCorners direction={chart.direction} />}
    </ChartFrame>
  )
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

/** The physical side a part of a chart that scrolls sideways holds still on: the frame takes the opposite direction to the page, so a logical inset would land on the wrong side. */
function stickTo(side: 'start' | 'end', direction: ReadingDirection) {
  return (side === 'start') === (direction === 'ltr')
    ? 'group-data-scrolls/chart:left-0'
    : 'group-data-scrolls/chart:right-0'
}

/** Whether a category's tooltip adds the total of its shown values: the tooltip's `total`. */
const ChartTooltipTotal = createContext(false)

/**
 * The values of the category at `index`: its name, then a row for each
 * shown series, with its change since the category before when the
 * categories run in order, and their total with `total`, which follows the
 * tooltip's own by default.
 */
function ChartTooltipContent({
  index,
  total: own,
  hideLabel = false,
  className,
  children,
  ...props
}: ComponentProps<'div'> & {
  index: number
  total?: boolean
  hideLabel?: boolean
}) {
  const chart = useChart()
  const total = own ?? use(ChartTooltipTotal)
  const {
    id,
    current,
    series,
    hidden,
    config,
    valueText,
    seriesText,
    categoryText,
    ordered,
    locale,
    patternOf,
    messages,
    emphasis,
  } = chart
  const category = current[index]
  if (!category) return null
  const before = ordered ? current[index - 1] : undefined
  const shown = series.filter((key) => !hidden.includes(key))
  const sum = shown.reduce((all, key) => all + (numberOf(category.datum[key]) ?? 0), 0)
  return (
    // The tooltip sits outside the chart, so it carries the chart's id for its colours.
    <div data-chart={id} className={cn('grid min-w-36 gap-1', className)} {...props}>
      {!hideLabel && <div className='font-medium'>{categoryText(category.value)}</div>}
      {shown.map((key) => {
        const value = category.datum[key]
        return (
          // The series brought forward reads in full colour; the rest stay as they are, legible.
          <div
            key={key}
            data-lit={emphasis === key ? '' : undefined}
            className='group/row flex items-center gap-2'
          >
            <span
              aria-hidden
              className={cn(swatchClassName, forcedSeriesColor(series.indexOf(key)))}
              style={swatchStyle(key, patternOf(key))}
            />
            <span className={cn(tooltipQuietClassName, 'min-w-0 flex-1 truncate')}>
              {config[key]?.label ?? key}
              {isForecast(chart, key, index) && ` · ${messages.forecast}`}
            </span>
            {before && (
              <ChangeText
                change={changeSince(value, before.datum[key])}
                locale={locale}
                className={tooltipQuietClassName}
              />
            )}
            {/* A value with a unit reads in its own order whatever the page's direction. */}
            <span dir='auto' className='font-medium tabular-nums'>
              {seriesText(category, key)}
            </span>
          </div>
        )
      })}
      {total && shown.length > 1 && (
        <div className='border-background/20 mt-0.5 flex items-center gap-2 border-t pt-1 forced-colors:border-[CanvasText]'>
          <span className='text-background/75 flex-1 forced-colors:text-[CanvasText]'>
            {messages.total}
          </span>
          <span className='font-medium tabular-nums'>{valueText(sum)}</span>
        </div>
      )}
      {children}
    </div>
  )
}

/** The props a chart's root takes that `useCategoryChart` reads, so the root passes the rest to its frame. */
const categoryChartKeys = [
  'data',
  'index',
  'config',
  'label',
  'description',
  'format',
  'ordered',
  'categoryFormat',
  'locale',
  'domain',
  'tickCount',
  'tickValues',
  'allowDecimals',
  'patterns',
  'hiddenSeries',
  'defaultHiddenSeries',
  'onHiddenSeriesChange',
  'activeIndex',
  'defaultActiveIndex',
  'onActiveIndexChange',
  'selected',
  'defaultSelected',
  'onSelectedChange',
  'loading',
  'error',
  'onRetry',
  'empty',
  'messages',
  'ref',
  'children',
  'className',
] as const satisfies readonly (keyof CategoryChartProps)[]

/** The props a root passes on to its `<figure>`: those that aren't the chart's own. */
function figureProps<P extends CategoryChartProps>(
  props: P,
  own: readonly string[] = [],
): ComponentProps<'figure'> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(props)) {
    if (!(categoryChartKeys as readonly string[]).includes(key) && !own.includes(key))
      out[key] = value
  }
  return out as ComponentProps<'figure'>
}

/*
 * What the charts of shares of a whole, such as the Donut and the Waffle,
 * share: a share's value and colour, and its tooltip.
 */

/** A share's value: a number above zero, or zero for one that is missing or below it. */
function shareValue(datum: ChartDatum, dataKey: string) {
  return Math.max(0, numberOf(datum[dataKey]) ?? 0)
}

/** A share's colour: its own, or the next of the chart's colours for one the config leaves out. */
function shareColor(chart: Pick<ChartContextValue, 'series'>, category: ChartCategory) {
  const slot = chart.series.indexOf(category.key)
  return `var(--color-${category.key}, var(--chart-${((slot === -1 ? category.index : slot) % 5) + 1}))`
}

/** A row of a share's tooltip: one of its values, and its share. */
interface ShareTooltipRow {
  /** The value's name, when there are several, such as a ring's. */
  label: string | null
  value: string
  share: string
}

/**
 * The tooltip for a share: its swatch and its name, its share and its
 * value, or under its name, each of its values'. `swatch` stands in for the
 * share's own, for a share drawn otherwise, such as a waffle's remaining
 * cells.
 */
function ShareTooltipContent({
  chart,
  category,
  name,
  rows,
  swatch: own,
}: {
  chart: ChartContextValue
  category: ChartCategory
  name: string
  rows: readonly ShareTooltipRow[]
  swatch?: ReactNode
}) {
  const slot = chart.series.indexOf(category.key)
  const swatch = own ?? (
    <span
      aria-hidden
      className={cn(
        swatchClassName,
        forcedSeriesColor(slot === -1 ? category.index : slot),
      )}
      style={swatchStyle(
        category.key,
        slot === -1 ? 'solid' : chart.patternOf(category.key),
      )}
    />
  )
  const figures = (row: ShareTooltipRow) => (
    <>
      {/* A value with a unit reads in its own order whatever the page's direction. */}
      <span
        dir='auto'
        className='text-background/75 tabular-nums forced-colors:text-[CanvasText]'
      >
        {row.share}
      </span>
      <span dir='auto' className='font-medium tabular-nums'>
        {row.value}
      </span>
    </>
  )
  const single = rows.length === 1 ? rows[0] : undefined
  return (
    // The tooltip sits outside the chart, so it carries the chart's id for its colours.
    <div data-chart={chart.id} className='flex min-w-36 flex-col gap-1'>
      <div className='flex items-center gap-2'>
        {swatch}
        <span
          className={cn(
            'min-w-0 flex-1 break-words',
            single ? 'text-background/75 forced-colors:text-[CanvasText]' : 'font-medium',
          )}
        >
          {name}
        </span>
        {single && figures(single)}
      </div>
      {!single &&
        rows.map((row) => (
          <div key={row.label} className='flex items-center gap-2 ps-4'>
            <span className='text-background/75 min-w-0 flex-1 break-words forced-colors:text-[CanvasText]'>
              {row.label}
            </span>
            {figures(row)}
          </div>
        ))}
    </div>
  )
}

export {
  axisLayerClassName,
  axisSlide,
  categoryReader,
  CategoryChartFrame,
  type CategoryChartInput,
  type CategoryChartProps,
  type CategoryReaderParts,
  type CategoryTable,
  categoryTable,
  type ChartActiveValue,
  type ChartAxis,
  type ChartAxisName,
  type ChartCategory,
  type ChartCellGrid,
  type ChartContextValue,
  type ChartForecast,
  type ChartGridAxis,
  ChartTooltipContent,
  ChartTooltipTotal,
  type ChartXY,
  columnLabel,
  type EntrancePhase,
  figureProps,
  isForecast,
  pickIndex,
  plotFraction,
  plotOffset,
  rowsShown,
  scalesOf,
  shareColor,
  ShareTooltipContent,
  type ShareTooltipRow,
  shareValue,
  slideLine,
  slideTo,
  tickMove,
  useCategoryChart,
  stickTo,
  useChart,
  useChartActive,
  useRegistry,
  useTicks,
  valuePlace,
  xyPlace,
}
