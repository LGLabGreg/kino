'use client'

import { AnimatedNumber } from '@/registry/components/kino/animated-number'
import { Button, buttonVariants } from '@/registry/components/kino/button'
import { useSpinner } from '@/registry/components/kino/spinner'
import { useAnnouncer } from '@/registry/lib/announce'
import {
  allWhole,
  alongCategories,
  type Band,
  bandCentre,
  changeSince,
  type ChartConfig,
  type ChartDatum,
  type ChartOrientation,
  type ChartPattern,
  type ChartStack,
  columnOf,
  type DomainEnd,
  extentWith,
  extentWithRoom,
  fractionOf,
  type GridCell,
  indexAt,
  labelLength,
  nearestPoint,
  numberOf,
  keyAxis,
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
import { useControllable } from '@/registry/lib/controllable'
import { CutTooltip } from '@/registry/lib/cut'
import { numberFormatter } from '@/registry/lib/number-format'
import { markMounted, mergeRefs } from '@/registry/lib/refs'
import { runningTransitions, transitionsQuiet } from '@/registry/lib/resize'
import { revealBehavior, revealBy } from '@/registry/lib/scroll'
import { Swap } from '@/registry/lib/swap'
import { useDirection } from '@base-ui/react/direction-provider'
import { Toggle as TogglePrimitive } from '@base-ui/react/toggle'
import { Tooltip as TooltipPrimitive } from '@base-ui/react/tooltip'
import {
  type ComponentProps,
  createContext,
  type CSSProperties,
  memo,
  type ReactNode,
  type Ref,
  type RefObject,
  use,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { flushSync } from 'react-dom'

import { cn } from '@/lib/utils'

/*
 * What every chart with categories is built on: its root's state and
 * frame, the layer that takes the pointer and the keys, what a screen
 * reader reads, and the motion its axes share. A chart's root (`BarChart`)
 * works out its own shapes and the point its tooltip sits on; everything
 * else comes from here, so every chart looks, moves and reads the same way.
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

/** What the chart shows in place of its data. */
type ChartStatus = 'loading' | 'error' | 'empty' | 'hidden' | 'ready'

/** Every word the chart says or reads out, for a chart in another language. */
interface ChartMessages {
  /** The data table's name. */
  table: string
  /** The data table's first column. */
  category: string
  /** The name of the layer that steps through the categories by keyboard. */
  browse: string
  noValue: string
  /** A value's column of the data table, when the chart has no name for its values. */
  value: string
  total: string
  /** A value's share of the whole, as a column of the data table. */
  share: string
  /** The legend's name. */
  series: string
  selected: string
  /** Said of a value that is projected, not measured. */
  forecast: string
  /** A change since the category before, such as "up 22%". */
  change: (change: number, size: string) => string
  /** A value against the most it could be, such as "86 of 120". */
  outOf: (value: string, most: string) => string
  /** The column of the data table naming the group a value is in, such as a treemap tile's. */
  group: string
  /** The whole of a chart that zooms, such as a treemap's first crumb. */
  whole: string
  /** The data table's columns for where a flow starts and where it ends, such as a Sankey's. */
  from: string
  to: string
  /** A flow from one node to another, with their names. */
  flow: (from: string, to: string) => string
  /** The way back out of a chart that zooms, with the chart's `label`, so each chart's is its own. */
  zoomPath: (label: string) => string
  /** Said once a chart that zooms shows another part of it, with the part's name. */
  zoomedTo: (name: string) => string
  /** A funnel step's share of the first step, as a row of its tooltip and a column of the data table. */
  ofFirst: string
  /** A funnel step's share of the step before. */
  ofPrevious: string
  /** How many a funnel lost since the step before. */
  droppedOff: string
  loading: string
  /** Said when the data arrives, with the chart's `label`. */
  loaded: (label: string) => string
  empty: string
  allHidden: string
  showAll: (count: number) => string
  error: string
  retry: string
}

const defaultMessages: ChartMessages = {
  table: 'Chart data',
  category: 'Category',
  browse: 'Values',
  noValue: 'No value',
  value: 'Value',
  total: 'Total',
  share: 'Share',
  series: 'Series',
  selected: 'selected',
  forecast: 'forecast',
  change: (change, size) =>
    change > 0 ? `up ${size}` : change < 0 ? `down ${size}` : 'no change',
  outOf: (value, most) => `${value} of ${most}`,
  group: 'Group',
  whole: 'All',
  from: 'From',
  to: 'To',
  flow: (from, to) => `${from} to ${to}`,
  zoomPath: (label) => `Zoom path for ${label}`,
  zoomedTo: (name) => `Showing ${name}`,
  ofFirst: 'Of the first step',
  ofPrevious: 'Of the step before',
  droppedOff: 'Dropped off',
  loading: 'Loading chart',
  loaded: (label) => `${label} loaded`,
  empty: 'No data for this range',
  allHidden: 'Every series is hidden',
  showAll: (count) => `Show all ${count} series`,
  error: 'The chart couldn’t load',
  retry: 'Try again',
}

/** How values are written: Intl's number options, or a function of your own. */
type ChartFormat = Intl.NumberFormatOptions | ((value: number) => string)

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

interface ChartContextValue {
  id: string
  label: string
  config: ChartConfig
  /** Every series key, in the order written in the config. */
  series: readonly string[]
  hidden: readonly string[]
  setHidden: (keys: string[]) => void
  /** The series a legend entry under the pointer or the focus brings forward. */
  emphasis: string | null
  setEmphasis: (key: string | null) => void
  /** Every category to draw, the leaving ones too, in a fixed order that sorting the data doesn't change. */
  categories: readonly ChartCategory[]
  /** The categories still in the data, in order. */
  current: readonly ChartCategory[]
  orientation: ChartOrientation
  direction: ReadingDirection
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
  /** A value as the chart's `format` writes it. */
  valueText: (value: number) => string
  /** Anything under a series' key as the chart writes it: a number, a `[from, to]` range, or no value. */
  datumText: (value: unknown) => string
  /** How a series' value on a category is written in the tooltip, the data table and what is read out: `datumText` of it by default. */
  seriesText: (category: ChartCategory, key: string) => string
  categoryText: (value: unknown) => string
  /** The chart's own `format`, which the value axis follows. */
  format?: ChartFormat
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
  tooltip: TooltipPrimitive.Handle<number>
  /** The trigger id of the category at `index`. */
  columnId: (index: number) => string
  /** The plot's box: the layer that takes the pointer, as large as the plot. */
  plot: RefObject<HTMLElement | null>
  /** The plot's size in px, once measured. */
  plotSize: { width: number; height: number }
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
  table?: ChartTable
  /** What the tooltip shows for the category at `index`, in place of each series' value. */
  tooltipContent?: (index: number) => ReactNode
  /**
   * The shape a series' marks take, such as a scatter's points, as an SVG
   * path centred on 0 0 that fills a box 2 across, which its legend swatch
   * takes too; none for a plain swatch.
   */
  markerOf?: (key: string) => string | undefined
  locale: Intl.LocalesArgument
  /** The categories run in order, such as days, so a change since the one before means something. */
  ordered: boolean
  /** Takes a value into the value axis's range, such as a reference line's; returns how to let it go. */
  addReference: (value: number) => () => void
  /** Leaves `px` past the bars' ends for labels that sit there; returns how to let it go. */
  addRoom: (px: number) => () => void
  /** Marks a series' values from the category keyed `from` on as a forecast; returns how to let it go. */
  addForecast: (forecast: ChartForecast) => () => void
  forecasts: readonly ChartForecast[]
  /** How wide `text` is in px, in the chart's medium-weight text. */
  textWidth: (text: string) => number
  patternOf: (key: string) => ChartPattern
  messages: ChartMessages
  error: ReactNode
  onRetry?: () => void
}

/** Where a tooltip sits, as fractions of the plot, and the side it opens on. */
interface ChartPoint {
  x: number
  y: number
  side?: 'top' | 'bottom' | 'left' | 'right'
}

/** A data table of a chart's own: the columns after the category, and each category's cells. */
interface ChartTable {
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

/** The series' colour as a CSS value, set on the chart as `--color-<key>`. */
function seriesColor(key: string) {
  return `var(--color-${key})`
}

/**
 * Each series' colour as `--color-<key>`, from its `color`, its `theme`, or
 * else the next of `--chart-1` to `--chart-5`, as shadcn's chart does. While
 * the chart changes size, nothing in it eases, so the bars keep up with the
 * axes.
 */
function ChartStyle({
  id,
  config,
  series,
}: {
  id: string
  config: ChartConfig
  series: readonly string[]
}) {
  const rule = (theme: 'light' | 'dark') =>
    series
      .map((key, slot) => {
        const entry = config[key]
        const color =
          entry?.theme?.[theme] ?? entry?.color ?? `var(--chart-${(slot % 5) + 1})`
        return `--color-${key}: ${color};`
      })
      .join(' ')
  return (
    // oxlint-disable-next-line react/no-danger -- the colours are the chart's own config
    <style
      dangerouslySetInnerHTML={{
        __html: `[data-chart='${id}'] { ${rule('light')} } .dark [data-chart='${id}'] { ${rule('dark')} } [data-chart='${id}'][data-resizing] * { transition-property: none; }`,
      }}
    />
  )
}

/**
 * The colour forced colours draw a series in, by its place: system colours
 * stand in for the chart's, five apart so neighbours differ.
 */
const forcedSeriesColors = [
  'forced-colors:bg-[CanvasText]',
  'forced-colors:bg-[Highlight]',
  'forced-colors:bg-[LinkText]',
  'forced-colors:bg-[GrayText]',
  'forced-colors:bg-[VisitedText]',
] as const

function forcedSeriesColor(slot: number) {
  return forcedSeriesColors[slot % forcedSeriesColors.length]
}

/** The same colours for a mark drawn in its text colour, such as a line. */
const forcedSeriesTextColors = [
  'forced-colors:text-[CanvasText]',
  'forced-colors:text-[Highlight]',
  'forced-colors:text-[LinkText]',
  'forced-colors:text-[GrayText]',
  'forced-colors:text-[VisitedText]',
] as const

function forcedSeriesTextColor(slot: number) {
  return forcedSeriesTextColors[slot % forcedSeriesTextColors.length]
}

/**
 * The patterns the chart's `patterns` hands out, in series order, the first
 * left plain: fine lines and dots that tell series apart in grey and in
 * print without fighting their colours.
 */
const patternOrder: readonly ChartPattern[] = [
  'solid',
  'diagonal',
  'dots',
  'stripes',
  'grid',
]

/**
 * A pattern's ink: the page's background, a little see-through, so it reads
 * as a lighter tone of a series' colour in light mode and a darker one in
 * dark.
 */
const ink = 'color-mix(in oklab, var(--background) 42%, transparent)'

/** A pattern's tile, in px: its lines are a px wide, this far apart. */
const PATTERN_TILE = 6

/** A swatch's tile, in px: finer, so a swatch shows a few of its lines. */
const SWATCH_TILE = 3

/**
 * The pattern as a `background-image` over the series' colour, or none, its
 * lines `tile` px apart: a swatch takes a finer one, so a few show in it.
 */
function patternImage(pattern: ChartPattern, tile = PATTERN_TILE): string | undefined {
  switch (pattern) {
    case 'stripes':
      return `repeating-linear-gradient(90deg, ${ink} 0 1px, transparent 1px ${tile}px)`
    case 'diagonal':
      return `repeating-linear-gradient(45deg, ${ink} 0 1px, transparent 1px ${tile / Math.SQRT2}px)`
    case 'dots':
      // Two dots a tile, staggered, so they sit evenly rather than in rows.
      return `radial-gradient(${ink} 0.9px, transparent 1.2px) 0 0 / ${tile}px ${tile}px, radial-gradient(${ink} 0.9px, transparent 1.2px) ${tile / 2}px ${tile / 2}px / ${tile}px ${tile}px`
    case 'grid':
      return `linear-gradient(${ink} 1px, transparent 1px) 0 0 / ${tile}px ${tile}px, linear-gradient(90deg, ${ink} 1px, transparent 1px) 0 0 / ${tile}px ${tile}px`
    default:
      return undefined
  }
}

/**
 * The same pattern for an SVG mark, as a `<pattern>` with the id `id`, drawn
 * over `currentColor` in px. `turn` undoes a rotation of the mark that uses
 * it, in degrees, so its lines run the way the swatches' do.
 */
function ChartSvgPattern({
  id,
  pattern,
  turn = 0,
}: {
  id: string
  pattern: ChartPattern
  turn?: number
}) {
  // A CSS gradient at 45deg runs its stripes down to the right, so the SVG's turn the other way.
  const angle = turn + (pattern === 'diagonal' ? -45 : 0)
  // Diagonal lines a tile apart across, as the gradient's are.
  const tile = pattern === 'diagonal' ? PATTERN_TILE / Math.SQRT2 : PATTERN_TILE
  const half = tile / 2
  return (
    <pattern
      id={id}
      width={tile}
      height={tile}
      patternUnits='userSpaceOnUse'
      patternTransform={angle === 0 ? undefined : `rotate(${angle})`}
    >
      <rect width={tile} height={tile} fill='currentColor' />
      {(pattern === 'stripes' || pattern === 'diagonal') && (
        <rect width={1} height={tile} style={{ fill: ink }} />
      )}
      {pattern === 'dots' && (
        <>
          <circle cx={0} cy={0} r={0.9} style={{ fill: ink }} />
          <circle cx={tile} cy={0} r={0.9} style={{ fill: ink }} />
          <circle cx={0} cy={tile} r={0.9} style={{ fill: ink }} />
          <circle cx={tile} cy={tile} r={0.9} style={{ fill: ink }} />
          <circle cx={half} cy={half} r={0.9} style={{ fill: ink }} />
        </>
      )}
      {pattern === 'grid' && (
        <>
          <rect width={tile} height={1} style={{ fill: ink }} />
          <rect width={1} height={tile} style={{ fill: ink }} />
        </>
      )}
    </pattern>
  )
}

/** A swatch of a series: its colour and its pattern, as the legend and the tooltip draw it. */
function swatchStyle(key: string, pattern: ChartPattern): CSSProperties {
  const image = patternImage(pattern, SWATCH_TILE)
  return {
    '--swatch': seriesColor(key),
    background: image ? `${image}, var(--swatch)` : undefined,
  } as CSSProperties
}

/**
 * One of the legend's toggles, which shows and hides `series`: its colour
 * fills the swatch while it shows. Pointing at it, or focusing it, asks for
 * its series to be brought forward. Every chart's legend is drawn from
 * these, so each looks and answers the same.
 */
function ChartLegendToggle({
  series,
  slot,
  shown,
  pattern,
  marker,
  onShownChange,
  onEmphasisChange,
  children,
}: {
  series: string
  /** The series' place, for its colour in forced colours. */
  slot: number
  shown: boolean
  pattern: ChartPattern
  /** The shape its marks take, as `markerOf` gives it, which the swatch takes in place of a square. */
  marker?: string
  onShownChange: (shown: boolean) => void
  /** Whether the series is pointed at or focused, so it can come forward. */
  onEmphasisChange: (emphasised: boolean) => void
  children: ReactNode
}) {
  return (
    <CutTooltip
      render={
        <TogglePrimitive
          pressed={shown}
          onPressedChange={onShownChange}
          onPointerEnter={() => onEmphasisChange(true)}
          onPointerLeave={() => onEmphasisChange(false)}
          onFocus={(event) => {
            if (event.currentTarget.matches(':focus-visible')) onEmphasisChange(true)
          }}
          onBlur={() => onEmphasisChange(false)}
          className={cn(
            buttonVariants({ variant: 'ghost', size: 'xs' }),
            'group/legend text-muted-foreground data-pressed:text-foreground gap-1.5 font-medium',
          )}
        >
          {marker ? (
            <svg
              aria-hidden
              viewBox='-1.2 -1.2 2.4 2.4'
              className={cn(
                'size-3 shrink-0 overflow-visible fill-transparent stroke-(--swatch) [stroke-width:1.5] transition-[fill] duration-(--motion-press-duration) ease-(--motion-press-fade-easing) [vector-effect:non-scaling-stroke] group-data-pressed/legend:fill-(--swatch)',
                forcedMarkerColors[slot % forcedMarkerColors.length],
              )}
              style={{ '--swatch': seriesColor(series) } as CSSProperties}
            >
              <path d={marker} vectorEffect='non-scaling-stroke' />
            </svg>
          ) : (
            <span
              aria-hidden
              className={cn(
                'size-2.5 shrink-0 rounded-[calc(var(--control-radius-xs)/2.5)] border-2 border-(--swatch) bg-transparent transition-[background-color] duration-(--motion-press-duration) ease-(--motion-press-fade-easing) group-data-pressed/legend:bg-(--swatch)',
                forcedSwatchColors[slot % forcedSwatchColors.length],
              )}
              style={swatchStyle(series, shown ? pattern : 'solid')}
            />
          )}
          <span data-cut className='truncate'>
            {children}
          </span>
        </TogglePrimitive>
      }
    />
  )
}

/**
 * A toggle for each of `series`, as every chart's legend draws them: one
 * pressed off hides its series, and pointing at or focusing one that shows
 * brings it forward.
 */
function ChartLegendToggles({
  series,
  labelOf,
  patternOf,
  markerOf,
  hidden,
  onHiddenChange,
  onEmphasisChange,
}: {
  series: readonly string[]
  labelOf: (key: string) => ReactNode
  patternOf: (key: string) => ChartPattern
  markerOf?: (key: string) => string | undefined
  hidden: readonly string[]
  onHiddenChange: (hidden: string[]) => void
  /** The series brought forward, or null for none. */
  onEmphasisChange: (key: string | null) => void
}) {
  return series.map((key, slot) => {
    const shown = !hidden.includes(key)
    return (
      <ChartLegendToggle
        key={key}
        series={key}
        slot={slot}
        shown={shown}
        pattern={patternOf(key)}
        marker={markerOf?.(key)}
        onShownChange={(pressed) => {
          onHiddenChange(pressed ? hidden.filter((k) => k !== key) : [...hidden, key])
          onEmphasisChange(pressed ? key : null)
        }}
        onEmphasisChange={(emphasised) =>
          onEmphasisChange(emphasised && shown ? key : null)
        }
      >
        {labelOf(key)}
      </ChartLegendToggle>
    )
  })
}

/** The legend's swatch in forced colours: its outline always, its fill while the series shows. */
const forcedSwatchColors = [
  'forced-colors:border-[CanvasText] forced-colors:group-data-pressed/legend:bg-[CanvasText]',
  'forced-colors:border-[Highlight] forced-colors:group-data-pressed/legend:bg-[Highlight]',
  'forced-colors:border-[LinkText] forced-colors:group-data-pressed/legend:bg-[LinkText]',
  'forced-colors:border-[GrayText] forced-colors:group-data-pressed/legend:bg-[GrayText]',
  'forced-colors:border-[VisitedText] forced-colors:group-data-pressed/legend:bg-[VisitedText]',
] as const

/** The same for a swatch drawn as a marker's shape, which an SVG strokes and fills. */
const forcedMarkerColors = [
  'forced-colors:stroke-[CanvasText] forced-colors:group-data-pressed/legend:fill-[CanvasText]',
  'forced-colors:stroke-[Highlight] forced-colors:group-data-pressed/legend:fill-[Highlight]',
  'forced-colors:stroke-[LinkText] forced-colors:group-data-pressed/legend:fill-[LinkText]',
  'forced-colors:stroke-[GrayText] forced-colors:group-data-pressed/legend:fill-[GrayText]',
  'forced-colors:stroke-[VisitedText] forced-colors:group-data-pressed/legend:fill-[VisitedText]',
] as const

/**
 * The chart's frame: an optional legend above and below, an axis on each
 * side of the plot, and the plot. Every part takes its own area, and the
 * plot's layers share one.
 */
const chartFrameClassName =
  'group/chart @container/chart relative isolate grid h-72 min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] grid-rows-[auto_auto_minmax(0,1fr)_auto_auto] [grid-template-areas:"top_top_top"_"._top-axis_."_"start-axis_plot_end-axis"_"._bottom-axis_."_"bottom_bottom_bottom"] text-xs'

/** A layer of the plot: the size of the plot, and the box its insets are measured in. */
/** A tooltip row's quieter text, in full colour on the row of the series brought forward. */
const tooltipQuietClassName =
  'text-background/75 transition-colors duration-(--motion-layout-duration) ease-(--motion-layout-fade-easing) group-data-lit/row:text-background forced-colors:text-[CanvasText]'

/**
 * Text written on a mark, such as a slice's or a tile's label: near white or
 * near black, whichever reads on the mark's colour, `--label-on`; in forced
 * colours, the page's text on a box of its own.
 */
const labelOnClassName =
  'text-[oklch(from_var(--label-on)_clamp(0.15,(0.6-l)*1000,0.99)_0_0)] forced-colors:rounded-(--control-radius-xs) forced-colors:bg-[Canvas] forced-colors:px-1 forced-colors:text-[CanvasText]'

/** A series' colour beside its name in a tooltip, on its `--swatch` (`swatchStyle`). */
const swatchClassName =
  'size-2 shrink-0 rounded-[calc(var(--control-radius-xs)/4)] bg-(--swatch)'

/**
 * The size a chart draws at: its plot's, or before the plot is measured, as
 * on the page's first paint from the server, a stand-in that its SVGs fit to
 * the plot with `drawingFrame`, so the marks show from the first frame.
 */
function drawingSize(size: { width: number; height: number }) {
  return size.width > 0 && size.height > 0 ? size : UNMEASURED
}

/**
 * An SVG's frame for `drawingSize`: none once the plot is measured, else the
 * stand-in fitted to the plot, stretched (`none`) for marks whose shape follows
 * the plot's, such as lines, or kept square (`xMidYMid meet`), such as a ring.
 */
function drawingFrame(
  size: { width: number; height: number },
  fit: 'none' | 'xMidYMid meet',
) {
  return size.width > 0 && size.height > 0
    ? {}
    : {
        viewBox: `0 0 ${UNMEASURED.width} ${UNMEASURED.height}`,
        preserveAspectRatio: fit,
      }
}

/** About a plot's size, so what a chart draws in pixels, such as a ring's gaps, starts out near it. */
const UNMEASURED = { width: 240, height: 240 }

const plotLayerClassName =
  'pointer-events-none relative min-h-0 min-w-0 [grid-area:plot] [container-type:size]'

/**
 * Whether the chart has come into view, so its entrance plays then and not on
 * a page that loads with it out of sight. `skip` is there at once.
 */
function useEntered(ref: { current: Element | null }, skip: boolean) {
  const [entered, setEntered] = useState(skip)
  useEffect(() => {
    const element = ref.current
    if (entered || !element) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          // A frame after it is first painted, so the bars rise from the baseline.
          requestAnimationFrame(() => setEntered(true))
          observer.disconnect()
        }
      },
      { threshold: 0.3 },
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [entered, ref])
  return entered
}

/**
 * Marks `root` with `data-resizing` while it changes size after it is
 * first laid out, and for two frames after, which stops every transition in
 * it: a size change moves everything by the same amount at once, rather
 * than easing the bars behind the axes. Only the chart's own size counts: the
 * plot also changes size when new values widen the value axis, and that move
 * eases with the rest. A chart whose height comes from its data, such as a
 * grid of cells growing a row or its legend arriving, counts only a change
 * of width, so its data still arrives as it moves.
 */
function useResizing(root: RefObject<HTMLElement | null>, widthOnly: boolean) {
  useEffect(() => {
    const element = root.current
    if (!element) return
    let width: number | null = null
    let frame = 0
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return
      const was = width
      width = entry.contentRect.width
      if (was === null || (widthOnly && was === width)) return
      element.dataset.resizing = ''
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(() => {
          delete element.dataset.resizing
        })
      })
    })
    observer.observe(element)
    return () => {
      observer.disconnect()
      cancelAnimationFrame(frame)
    }
  }, [root, widthOnly])
}

/** An element's size in px, kept up to date. */
function useSize(ref: RefObject<HTMLElement | null>) {
  const [size, setSize] = useState({ width: 0, height: 0 })
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const { width, height } = element.getBoundingClientRect()
    setSize({ width, height })
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return
      const { width, height } = entry.contentRect
      setSize((was) =>
        was.width === width && was.height === height ? was : { width, height },
      )
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref])
  return size
}

/**
 * Runs `done` once `property` has stopped moving anywhere in `root`, and
 * again after each change that set it moving anew, while `waiting`. What
 * leaves is let go only once it has finished leaving, however often another
 * change turns it round on the way.
 */
function useWhenQuiet(
  root: RefObject<HTMLElement | null>,
  property: string | readonly string[],
  waiting: boolean,
  done: () => void,
  key: unknown,
) {
  const latest = useRef(done)
  useLayoutEffect(() => {
    latest.current = done
  })
  useEffect(() => {
    const element = root.current
    if (!waiting || !element) return
    let stale = false
    void transitionsQuiet(element, { subtree: true, property }).then(() => {
      if (!stale) latest.current()
    })
    return () => {
      stale = true
    }
  }, [root, property, waiting, key])
}

/**
 * The categories to draw: those in the data, in its order, and those just
 * taken out, kept where they were until `root` has finished moving
 * `leaveProperty`, which is how the chart's marks leave, and fading them out.
 */
function useCategories(
  data: readonly ChartDatum[],
  indexKey: string,
  bandOf: (index: number, count: number) => Band,
  root: RefObject<HTMLElement | null>,
  leaveProperty: string,
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
  const [leaving, setLeaving] = useState<ChartCategory[]>([])
  const [previous, setPrevious] = useState(current)
  const keys = current.map((category) => category.key).join('\u0000')
  const previousKeys = previous.map((category) => category.key).join('\u0000')
  if (keys !== previousKeys) {
    const now = new Set(current.map((category) => category.key))
    const gone = previous.filter((category) => !now.has(category.key))
    setLeaving((was) => [
      ...was.filter((category) => !now.has(category.key)),
      ...gone.map((category) => ({ ...category, leaving: true })),
    ])
    setPrevious(current)
  }
  // Its fade too, which is all that is left of leaving under reduced motion.
  const leaveOn = useMemo(() => [leaveProperty, 'opacity'], [leaveProperty])
  useWhenQuiet(root, leaveOn, leaving.length > 0, () => setLeaving([]), leaving)
  // Drawn in one fixed order, whatever the data's: an element moved in the page starts
  // again with no transition, so a sort would jump instead of sliding.
  const categories = [...current, ...leaving].toSorted((a, b) =>
    a.key < b.key ? -1 : a.key > b.key ? 1 : 0,
  )
  return { categories, current }
}

/**
 * Keeps `value` from the render before the last change to `key`, so what
 * arrives can start where the old value put it.
 */
function usePrevious<T>(value: T, key: string): T {
  const [state, setState] = useState({ key, value, previous: value })
  if (state.key !== key) setState({ key, value, previous: state.value })
  return state.key === key ? state.previous : state.value
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
 * The ticks to draw: the scale's own and, until `layer` stops moving, every
 * one drawn before that the scale no longer has, which fades as it slides
 * toward where the new scale puts it, so the change of range shows. A tick
 * still fading in when the range turns back fades out from where it is. In
 * value order, so no tick's element moves in the page, which would make it
 * jump. `property` is the one the ticks move on, which `layer` waits on.
 */
function useTicks(
  layer: RefObject<HTMLElement | null>,
  axis: ChartAxis = 'value',
  property = 'translate',
) {
  const { scale } = scalesOf(useChart(), axis)
  const key = scale.ticks.join()
  const [drawn, setDrawn] = useState({
    key,
    ticks: scale.ticks,
    leaving: [] as number[],
  })
  if (drawn.key !== key) {
    const before = [...drawn.ticks, ...drawn.leaving]
    setDrawn({
      key,
      ticks: scale.ticks,
      leaving: [...new Set(before.filter((tick) => !scale.ticks.includes(tick)))],
    })
  }
  useWhenQuiet(
    layer,
    property,
    drawn.leaving.length > 0,
    () => setDrawn((was) => (was.key === key ? { ...was, leaving: [] } : was)),
    drawn.key,
  )
  return [
    ...scale.ticks.map((value) => ({ value, leaving: false })),
    ...(drawn.key === key ? drawn.leaving : []).map((value) => ({
      value,
      leaving: true,
    })),
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
 * A value that rolls to each new one: digit by digit for Intl's options,
 * crossfading for a format of your own, such as a bar list's values or a
 * funnel's rates.
 */
function ChartNumber({
  value,
  format,
  locale,
}: {
  value: number
  format: ChartFormat | undefined
  locale: Intl.LocalesArgument
}) {
  if (typeof format === 'function') {
    return (
      <Swap align='end'>
        <span>{format(value)}</span>
      </Swap>
    )
  }
  return <AnimatedNumber value={value} locale={locale} format={format} />
}

/** The formatter of `format`: a function of yours, or Intl's options, once per locale. */
function formatterOf(
  locale: Intl.LocalesArgument,
  format: ChartFormat | undefined,
): (value: number) => string {
  if (typeof format === 'function') return format
  const formatter = numberFormatter(locale, format)
  return (value) => formatter.format(value)
}

/**
 * Charts in a group share the category under the pointer by its key, so
 * pointing at a day on one chart lights that day on the others, as the
 * dashboards of a product compare one day across several charts.
 */
const ChartGroupContext = createContext<{
  active: string | null
  setActive: (key: string | null) => void
} | null>(null)

function ChartGroup({ children }: { children: ReactNode }) {
  const [active, setActive] = useState<string | null>(null)
  const value = useMemo(() => ({ active, setActive }), [active])
  return <ChartGroupContext value={value}>{children}</ChartGroupContext>
}

/** What the category at `index` says to a screen reader: its name and each shown series' value. */
function columnLabel(chart: ChartContextValue, index: number) {
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

function percent(locale: Intl.LocalesArgument) {
  return numberFormatter(locale, {
    style: 'percent',
    maximumFractionDigits: 0,
  })
}

/** A change since the category before, as a share: `▲ 22%`, `▼ 4%`, or `0%` for none. */
function ChangeText({
  change,
  locale,
  format,
  className,
}: {
  change: number | null
  locale: Intl.LocalesArgument
  /** Writes the size of the change; a share by default, such as `12%`. */
  format?: (size: number) => string
  className?: string
}) {
  if (change === null) return null
  return (
    // Sign and number read left to right in either direction, as a number does.
    <span dir='ltr' className={cn('text-[0.625rem] tabular-nums', className)}>
      {change > 0 ? '▲ ' : change < 0 ? '▼ ' : ''}
      {format ? format(Math.abs(change)) : percent(locale).format(Math.abs(change))}
    </span>
  )
}

/**
 * The layer that takes the pointer and the keys. The pointer anywhere along
 * the category axis picks the nearest category, so a finger can drag along
 * the chart. By keyboard the plot is one stop, a slider over the categories
 * as the WAI-ARIA slider pattern has it: the arrows along the category axis
 * step, Home and End go to the ends, and a screen reader hears each
 * category's values as the slider's value. With categories to pick, a press,
 * Enter or Space picks the one reached. Over each category sits a column the
 * tooltip's trigger fills.
 */
/** Half the width the keys bring into view around a mark of a chart that scrolls, in px. */
const REVEAL_HALF = 8

/** The part of a chart that scrolls sideways that its marks show in: inside the axes that stay at its sides. */
function inView(frame: HTMLElement): { left: number; right: number } {
  const view = frame.getBoundingClientRect()
  let { left, right } = view
  const middle = (view.left + view.right) / 2
  for (const axis of frame.querySelectorAll(
    ':scope > [data-side=start], :scope > [data-side=end]',
  )) {
    const box = axis.getBoundingClientRect()
    if (box.right <= middle) left = Math.max(left, box.right)
    else right = Math.min(right, box.left)
  }
  return { left, right }
}

function ChartColumns() {
  const chart = useChart()
  const {
    current,
    orientation,
    direction,
    tooltip,
    columnId,
    status,
    messages,
    plot,
    selectable,
    toggleSelected,
    seriesAt,
    stepSeries,
    setEmphasis,
  } = chart
  const { active, setActive } = useChartActive()
  // Where the keys start from when focus comes back: the last category they reached.
  const [lastIndex, setLastIndex] = useState<number | null>(null)
  // Among points placed by two values, the axis the last arrow stepped along, which the
  // slider's value counts on, so Up raises it as much as Right does.
  const [along, setAlong] = useState<'x' | 'y'>('x')
  // Whether a press under the pointer opens something, such as a treemap's group.
  const [opens, setOpens] = useState(false)
  const ready = status === 'ready'
  const count = current.length
  // A chart that scrolls opens at its end, so the keys start there too.
  const resting = Math.min(
    lastIndex ??
      chart.selected ??
      chart.keys?.start ??
      (chart.leastPlotWidth === undefined ? 0 : count - 1),
    Math.max(0, count - 1),
  )
  const reached = active ?? resting
  const centres = current.map((category) => bandCentre(category.band))
  // In a chart that scrolls sideways, the keys bring the mark they reach into view, clear of
  // the axes that stay at its sides; the pointer only lights what is already in view.
  const pointOf = chart.pointOf
  const revealed = useRef<number | null>(null)
  useEffect(() => {
    if (active === revealed.current) return
    revealed.current = active
    const element = plot.current
    const frame = element?.parentElement
    if (active === null || !element || !frame || !element.matches(':focus-visible'))
      return
    if (frame.scrollWidth <= frame.clientWidth) return
    const point = pointOf(active)
    if (!point) return
    const box = element.getBoundingClientRect()
    const x = box.left + point.x * box.width
    frame.scrollTo({
      // From where it is now, so a glide still running for the last key is replaced.
      left:
        frame.scrollLeft +
        revealBy(inView(frame), {
          left: x - REVEAL_HALF,
          right: x + REVEAL_HALF,
        }),
      behavior: revealBehavior(frame),
    })
  }, [active, plot, pointOf])

  const pick = (event: {
    clientX: number
    clientY: number
    currentTarget: HTMLElement
  }) => {
    return pickIndex(
      chart,
      { x: event.clientX, y: event.clientY },
      event.currentTarget.getBoundingClientRect(),
      centres,
    )
  }

  const point = (event: {
    clientX: number
    clientY: number
    currentTarget: HTMLElement
  }) => {
    if (!ready) return
    const index = pick(event)
    setActive(index)
    if (index !== null) setLastIndex(index)
    if (chart.zoomAt) {
      setOpens(
        chart.zoomAt(
          { x: event.clientX, y: event.clientY },
          event.currentTarget.getBoundingClientRect(),
        ) !== null,
      )
    }
    if (seriesAt) {
      const box = event.currentTarget.getBoundingClientRect()
      setEmphasis(
        seriesAt({
          x: alongCategories(
            { x: event.clientX, y: event.clientY },
            box,
            'vertical',
            direction,
          ),
          y: box.height === 0 ? 0 : (event.clientY - box.top) / box.height,
        }),
      )
    }
  }

  const className = cn(
    'focus-visible:ring-ring/50 relative z-30 min-h-0 min-w-0 rounded-(--control-radius-capped) focus-visible:outline-hidden [grid-area:plot] focus-visible:ring-3 group-data-scrolls/chart:focus-visible:ring-inset',
    orientation === 'vertical' ? 'touch-pan-y' : 'touch-pan-x',
    ready && (selectable || opens) && 'cursor-pointer',
  )
  // The slider only while there is something to step through, so a screen reader doesn't
  // find a disabled one beside the note that says why.
  if (!ready) {
    return (
      <div
        ref={plot as Ref<HTMLDivElement>}
        tabIndex={-1}
        data-slot='chart-columns'
        data-chart-plot=''
        className={className}
      />
    )
  }

  return (
    <div
      ref={plot as Ref<HTMLDivElement>}
      role='slider'
      tabIndex={0}
      aria-label={messages.browse}
      aria-orientation={orientation === 'vertical' ? 'horizontal' : 'vertical'}
      aria-valuemin={1}
      aria-valuemax={Math.max(1, chart.keys?.stops ?? count)}
      aria-valuenow={
        chart.xy
          ? pointRank(chart.xy.points, reached, along)
          : chart.keys
            ? chart.keys.rank(reached)
            : chart.grid
              ? reached + 1
              : sliderValue(reached, Math.max(1, count), orientation)
      }
      aria-valuetext={columnLabel(chart, reached)}
      data-slot='chart-columns'
      data-chart-plot=''
      className={className}
      onPointerMove={point}
      onPointerDown={point}
      onPointerLeave={(event) => {
        if (event.pointerType !== 'mouse') return
        setActive(null)
        if (seriesAt) setEmphasis(null)
      }}
      onClick={(event) => {
        if (!ready) return
        const zoom = chart.zoomAt?.(
          { x: event.clientX, y: event.clientY },
          event.currentTarget.getBoundingClientRect(),
        )
        if (zoom) {
          zoom()
          return
        }
        if (!selectable) return
        const index = pick(event)
        if (index !== null) toggleSelected(index)
      }}
      onFocus={(event) => {
        if (ready && event.currentTarget.matches(':focus-visible')) setActive(resting)
      }}
      onBlur={() => {
        setActive(null)
        if (seriesAt) setEmphasis(null)
      }}
      onKeyDown={(event) => {
        if (!ready) return
        if (event.key === 'Escape' && active !== null) {
          // Only the tooltip closes, not a dialog or popover the chart sits in.
          event.preventDefault()
          event.stopPropagation()
          setActive(null)
          if (seriesAt) setEmphasis(null)
          return
        }
        if (event.key === 'Escape' && chart.zoomOut) {
          event.preventDefault()
          event.stopPropagation()
          chart.zoomOut()
          setLastIndex(0)
          return
        }
        if (event.key === 'Enter' || event.key === ' ') {
          const zoom = chart.zoomIn?.(reached)
          if (zoom) {
            event.preventDefault()
            zoom()
            // The keys start again from the first of the tiles now in view.
            setLastIndex(0)
            setActive(0)
            return
          }
        }
        if (chart.keys) {
          const next = chart.keys.step(reached, event.key)
          if (next === null) return
          event.preventDefault()
          setLastIndex(next)
          setActive(next)
          return
        }
        if (
          stepSeries &&
          !chart.xy &&
          (event.key === 'ArrowUp' || event.key === 'ArrowDown')
        ) {
          event.preventDefault()
          setEmphasis(
            stepSeries(reached, chart.emphasis, event.key === 'ArrowUp' ? -1 : 1),
          )
          setLastIndex(reached)
          setActive(reached)
          return
        }
        if (selectable && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault()
          toggleSelected(reached)
          setActive(reached)
          return
        }
        // Points placed by two values step by x along it, and by y up and down; cells step
        // by column along it, and by row up and down.
        const next = chart.xy
          ? stepPoint(chart.xy.points, reached, event.key, direction)
          : chart.grid
            ? stepCell(chart.grid.cells, reached, event.key, direction)
            : // Round the circle, Right steps clockwise, the way the marks run, as they
              // aren't mirrored in right to left.
              stepIndex(
                event.key,
                reached,
                count,
                orientation,
                chart.round ? 'ltr' : direction,
              )
        if (next === null) return
        event.preventDefault()
        if (chart.xy) setAlong(keyAxis(event.key))
        setLastIndex(next)
        setActive(next)
      }}
    >
      <ChartColumnTriggers
        current={current}
        orientation={orientation}
        direction={direction}
        tooltip={tooltip}
        columnId={columnId}
      />
    </div>
  )
}

/**
 * A column over each category that the tooltip's trigger fills. Apart from
 * the layer that takes the pointer, so a hover never renders them again.
 */
const ChartColumnTriggers = memo(function ChartColumnTriggers({
  current,
  orientation,
  direction,
  tooltip,
  columnId,
}: Pick<
  ChartContextValue,
  'current' | 'orientation' | 'direction' | 'tooltip' | 'columnId'
>) {
  const centres = current.map((category) => bandCentre(category.band))
  return current.map((category) => {
    const column = columnOf(category.index, centres, orientation, direction)
    return (
      <TooltipPrimitive.Trigger
        key={category.key}
        handle={tooltip}
        id={columnId(category.index)}
        payload={category.index}
        delay={0}
        closeDelay={0}
        render={
          <span
            aria-hidden
            className='pointer-events-none absolute rounded-(--control-radius-capped)'
            style={
              orientation === 'vertical'
                ? {
                    left: `${column.start * 100}%`,
                    width: `${column.size * 100}%`,
                    top: 0,
                    bottom: 0,
                  }
                : {
                    top: `${column.start * 100}%`,
                    height: `${column.size * 100}%`,
                    left: 0,
                    right: 0,
                  }
            }
          />
        }
      />
    )
  })
})

/**
 * The data as a table for screen readers, which the chart's picture doesn't
 * reach: a row for each category and a column for each shown series.
 */
function ChartDataTable() {
  const chart = useChart()
  const { current, series, hidden, config, seriesText, categoryText, status, messages } =
    chart
  if (status !== 'ready') return null
  const shown = series.filter((key) => !hidden.includes(key))
  const { table } = chart
  // The table sits in a hidden box: a table grows to fit its cells past `sr-only`'s 1px.
  if (table?.rows) {
    return (
      <div className='sr-only'>
        <table aria-label={messages.table}>
          <thead>
            <tr>
              <th scope='col'>{table.rows.header}</th>
              {table.columns.map((column) => (
                <th key={column} scope='col'>
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.cells.map((row) => (
              <tr key={row.key}>
                <th scope='row'>{row.name}</th>
                {row.cells.map((cell, at) => (
                  // oxlint-disable-next-line react/no-array-index-key -- the columns are fixed
                  <td key={at}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }
  if (table) {
    return (
      <div className='sr-only'>
        <table aria-label={messages.table}>
          <thead>
            <tr>
              <th scope='col'>{messages.category}</th>
              {table.columns.map((column) => (
                <th key={column} scope='col'>
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {current.map((category) => (
              <tr key={category.key}>
                <th scope='row'>{categoryText(category.value)}</th>
                {table.cells(category).map((cell, at) => (
                  // oxlint-disable-next-line react/no-array-index-key -- the columns are fixed
                  <td key={at}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
          {table.footer && (
            <tfoot>
              <tr>
                <th scope='row'>{messages.total}</th>
                {table.footer.map((cell, at) => (
                  // oxlint-disable-next-line react/no-array-index-key -- the columns are fixed
                  <td key={at}>{cell}</td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    )
  }
  return (
    <div className='sr-only'>
      <table aria-label={messages.table}>
        <thead>
          <tr>
            <th scope='col'>{messages.category}</th>
            {shown.map((key) => (
              <th key={key} scope='col'>
                {config[key]?.label ?? key}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {current.map((category) => (
            <tr key={category.key}>
              <th scope='row'>{categoryText(category.value)}</th>
              {shown.map((key) => (
                <td key={key}>
                  {seriesText(category, key)}
                  {isForecast(chart, key, category.index) && `, ${messages.forecast}`}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/**
 * What shows over the plot while there is nothing to draw, and what a
 * screen reader hears as that changes: a loading note (the chart draws its
 * own placeholder), the error and a way to try again, `empty` when there's
 * no data, or a way back when every series is hidden.
 */
function ChartStatusOverlay({ empty }: { empty?: ReactNode }) {
  const { status, series, setHidden, label, messages, error, onRetry } = useChart()
  const overlay = useRef<HTMLDivElement>(null)
  const { announce, region } = useAnnouncer()
  const was = useRef(status)
  useEffect(() => {
    if (was.current === status) return
    if (status === 'loading') announce(messages.loading)
    else if (status === 'error') announce(messages.error)
    else if (was.current === 'loading' || was.current === 'error')
      announce(status === 'empty' ? messages.empty : messages.loaded(label))
    was.current = status
  })
  const focusPlot = (run: () => void) => {
    // The button goes once the chart shows or loads again, so focus moves to the legend, or
    // to the plot (`data-chart-plot`), which keeps it while the chart loads.
    const figure = overlay.current?.closest('figure')
    flushSync(run)
    figure
      ?.querySelector<HTMLElement>('[data-slot=chart-legend] button, [data-chart-plot]')
      ?.focus()
  }
  return (
    <>
      {region}
      {(status === 'empty' || status === 'hidden' || status === 'error') && (
        <div
          ref={overlay}
          data-slot='chart-status'
          className='relative z-40 flex min-h-0 flex-col items-center justify-center gap-2 p-4 text-center [grid-area:plot]'
        >
          {status === 'empty' &&
            (empty ?? <p className='text-muted-foreground text-sm'>{messages.empty}</p>)}
          {status === 'error' && (
            <>
              {typeof error === 'string' || error === true ? (
                <p className='text-muted-foreground text-sm'>
                  {error === true ? messages.error : error}
                </p>
              ) : (
                error
              )}
              {onRetry && (
                <Button size='xs' variant='outline' onClick={() => focusPlot(onRetry)}>
                  {messages.retry}
                </Button>
              )}
            </>
          )}
          {status === 'hidden' && (
            <>
              <p className='text-muted-foreground text-sm'>{messages.allHidden}</p>
              <Button
                size='xs'
                variant='outline'
                onClick={() => focusPlot(() => setHidden([]))}
              >
                {messages.showAll(series.length)}
              </Button>
            </>
          )}
        </div>
      )}
    </>
  )
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
  /** The property the marks move on, which the chart waits on before letting a leaving category go. */
  moveProperty: string
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
 * its own marks: the shown and hidden series, the categories and the ones
 * leaving, the value scale, what is under the pointer and what is picked,
 * the loading placeholder and the entrance. A chart's root adds where its
 * tooltip sits and draws its marks inside `CategoryChartFrame`.
 */
function useCategoryChart<Shapes>(
  props: CategoryChartProps,
  options: CategoryChartOptions<Shapes>,
) {
  const {
    data,
    index,
    config,
    label,
    format,
    ordered = false,
    categoryFormat = String,
    locale,
    domain,
    tickCount = 5,
    tickValues,
    allowDecimals,
    patterns = false,
    hiddenSeries,
    defaultHiddenSeries = [],
    onHiddenSeriesChange,
    activeIndex,
    defaultActiveIndex = null,
    onActiveIndexChange,
    selected: selectedKey,
    defaultSelected = null,
    onSelectedChange,
    loading = false,
    error,
    onRetry,
    messages,
  } = props
  const id = useChartId()
  const direction = useDirection()
  const root = useRef<HTMLElement | null>(null)
  const plot = useRef<HTMLElement | null>(null)
  const plotSize = useSize(plot)
  const [tooltip] = useState(() => TooltipPrimitive.createHandle<number>())
  const series = Object.keys(config)
  const references = useRegistry<number>()
  const rooms = useRegistry<number>()
  const forecasts = useRegistry<ChartForecast>()
  const xReferences = useRegistry<number>()
  const [hidden, setHidden] = useControllable(
    hiddenSeries,
    defaultHiddenSeries,
    onHiddenSeriesChange,
  )
  const [emphasis, setEmphasis] = useState<string | null>(null)

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
    drawn,
    index,
    options.bandOf,
    root,
    options.moveProperty,
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
  const previousScale = usePrevious(scale, `${scale.domain.join()}|${scale.ticks.join()}`)
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
  const previousXScale = usePrevious(
    xScale,
    `${xScale.domain.join()}|${xScale.ticks.join()}`,
  )

  const status: ChartStatus =
    placeholder || (loading && rows.length === 0)
      ? 'loading'
      : failed
        ? 'error'
        : rows.length === 0
          ? 'empty'
          : shown.length === 0 || drawn.length === 0
            ? 'hidden'
            : 'ready'

  const selectable =
    selectedKey !== undefined ||
    props.defaultSelected !== undefined ||
    onSelectedChange !== undefined
  const [picked, setPicked] = useControllable(
    selectedKey,
    defaultSelected,
    onSelectedChange,
  )
  const selectedAt = picked === null ? -1 : current.findIndex((c) => c.key === picked)
  const selected = selectedAt === -1 ? null : selectedAt

  useResizing(root, options.heightFromData ?? false)
  const textWidth = useTextWidth(root)
  const seen = useEntered(root, !options.entrance)
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
  if (phase === 'waiting' && (seen || fromPlaceholder) && status !== 'loading') {
    setPhase(fromPlaceholder ? 'settled' : 'entering')
  }
  useWhenQuiet(
    root,
    options.moveProperty,
    phase === 'entering',
    () => setPhase('settled'),
    phase,
  )

  const written = { ...defaultMessages, ...messages }
  const valueText = formatterOf(locale, format)
  const datumText = (value: unknown) => {
    const range = rangeOf(value)
    if (range) return `${valueText(range[0])} – ${valueText(range[1])}`
    const number = numberOf(value)
    return number === null ? written.noValue : valueText(number)
  }
  const chart: Omit<ChartContextValue, 'pointOf'> = {
    id,
    label,
    config,
    series,
    hidden,
    setHidden,
    emphasis,
    setEmphasis,
    categories,
    current,
    orientation: options.orientation,
    direction,
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
    valueText,
    datumText,
    seriesText: (category, key) => datumText(category.datum[key]),
    categoryText: categoryFormat,
    format,
    activeProps: { activeIndex, defaultActiveIndex, onActiveIndexChange },
    selected,
    selectable,
    toggleSelected: (at) => {
      const key = current[at]?.key
      if (key !== undefined) setPicked(picked === key ? null : key)
    },
    entered: phase !== 'waiting',
    status,
    tooltip,
    columnId: (at) => `${id}-column-${at}`,
    plot,
    plotSize,
    locale,
    ordered,
    addReference: references.add,
    addRoom: rooms.add,
    addForecast: forecasts.add,
    forecasts: forecasts.values,
    textWidth,
    patternOf: (key) =>
      config[key]?.pattern ??
      (patterns
        ? (patternOrder[series.indexOf(key) % patternOrder.length] ?? 'solid')
        : 'solid'),
    messages: written,
    error,
    onRetry,
  }
  return {
    chart,
    shapes,
    rows,
    root,
    placeholder,
    fromPlaceholder,
    phase,
    room,
  }
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
  chart: Pick<
    ChartContextValue,
    'pickAt' | 'orientation' | 'direction' | 'xy' | 'scale' | 'inset'
  >,
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

/**
 * Whether the category lit now was lit from rest, for a frame: what marks
 * it then appears in place, since after a rest there is no move to explain,
 * and glides from there on. A rest begins once what marks the last lit
 * category, `element`, has finished leaving, so a pointer that
 * comes back while it still fades glides on from where it is.
 */
function useFromRest(spotlit: number | null, element: RefObject<Element | null>) {
  const [fromRest, setFromRest] = useState(false)
  const previous = useRef(spotlit)
  const rested = useRef(true)
  useLayoutEffect(() => {
    const before = previous.current
    previous.current = spotlit
    if (spotlit === null) {
      const node = element.current
      if (before === null || !node) return
      rested.current = false
      let frame = requestAnimationFrame(function check() {
        if (runningTransitions(node).length === 0) rested.current = true
        else frame = requestAnimationFrame(check)
      })
      return () => cancelAnimationFrame(frame)
    }
    setFromRest(before === null && rested.current)
    return undefined
  }, [spotlit, element])
  useEffect(() => {
    if (!fromRest) return
    const frame = requestAnimationFrame(() => setFromRest(false))
    return () => cancelAnimationFrame(frame)
  }, [fromRest])
  return fromRest
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
 * Measures text in the chart's own font, at medium weight, as its labels
 * are written; measured again once the page's fonts load. Before the chart
 * is drawn, it guesses from the number of characters.
 */
function useTextWidth(root: RefObject<HTMLElement | null>) {
  const [font, setFont] = useState<string | null>(null)
  useLayoutEffect(() => {
    const element = root.current
    if (!element) return
    let live = true
    const read = () => {
      if (!live) return
      const style = getComputedStyle(element)
      setFont(`500 ${style.fontSize} ${style.fontFamily}`)
    }
    read()
    void document.fonts?.ready.then(read)
    return () => {
      live = false
    }
  }, [root])
  return useMemo(() => textMeasure(font), [font])
}

/** Measures text in `font`, remembering each width; an estimate until the font is known. */
function textMeasure(font: string | null) {
  const context = font ? document.createElement('canvas').getContext('2d') : null
  if (context && font) context.font = font
  const widths = new Map<string, number>()
  return (text: string) => {
    if (!context) return labelLength(text) - 12
    let width = widths.get(text)
    if (width === undefined) {
      width = context.measureText(text).width
      widths.set(text, width)
    }
    return width
  }
}

function useChartId() {
  return useId().replaceAll(':', '')
}

/**
 * Keeps the category under the pointer: yours, or the group's by its key,
 * or its own.
 */
function ChartActive({ children }: { children: ReactNode }) {
  const { current, selected, activeProps } = useChart()
  const { activeIndex, defaultActiveIndex = null, onActiveIndexChange } = activeProps
  const group = use(ChartGroupContext)
  const [own, setOwn] = useControllable<number | null>(
    activeIndex,
    defaultActiveIndex,
    onActiveIndexChange,
  )
  const grouped = group && activeIndex === undefined
  const groupIndex = grouped ? current.findIndex((c) => c.key === group.active) : -1
  const now = grouped ? (groupIndex === -1 ? null : groupIndex) : own
  const active = now !== null && now < current.length ? now : null
  // The key of the category reached, so new data that moves it keeps it reached.
  const held = useRef<string | null>(null)
  const set = (next: number | null) => {
    held.current = next === null ? null : (current[next]?.key ?? null)
    if (grouped) group.setActive(held.current)
    if (!grouped || onActiveIndexChange) setOwn(next)
  }
  const activeKey = active === null ? null : (current[active]?.key ?? null)
  useLayoutEffect(() => {
    // Yours to keep, when you pass it; the group's is held by key already.
    if (activeIndex !== undefined || grouped) return
    if (held.current === null || held.current === activeKey) return
    const moved = current.findIndex((category) => category.key === held.current)
    held.current = moved === -1 ? null : held.current
    setOwn(moved === -1 ? null : moved)
  }, [activeIndex, grouped, activeKey, current, setOwn])
  // One function for the chart's life, so parts that take it, such as the
  // Bar list's rows, redraw only when what they show changes, without the
  // React Compiler.
  const latest = useRef(set)
  useLayoutEffect(() => {
    latest.current = set
  })
  const setActive = useCallback((next: number | null) => latest.current(next), [])
  const spotlit = active ?? selected
  const value = useMemo(
    () => ({ active, setActive, spotlit }),
    [active, setActive, spotlit],
  )
  return <ChartActiveContext value={value}>{children}</ChartActiveContext>
}

/**
 * The chart's `<figure>`, named by its `label`: the series' colours, the
 * parts written inside it, the chart's placeholder while it loads, then the
 * layer that takes the pointer and the keys, the status, and the data table.
 */
function CategoryChartFrame({
  chart,
  root,
  slot,
  description,
  placeholder,
  empty,
  browse = true,
  className,
  children,
  ref,
  ...props
}: Omit<ComponentProps<'figure'>, 'ref'> & {
  chart: ChartContextValue
  root: RefObject<HTMLElement | null>
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
  const figureRef = useMemo(() => mergeRefs(root, ref, markMounted), [root, ref])
  const descriptionId = `${chart.id}-description`
  // A chart of many columns scrolls sideways once its plot would be narrower than it allows,
  // only while it shows its marks, so a note in their place stays in view. It takes the
  // opposite direction to the page, so it opens at its end, the latest column, from the first
  // paint, and stays there as it narrows; its parts take the page's direction again.
  const scroller =
    chart.leastPlotWidth !== undefined &&
    (chart.status === 'ready' || chart.status === 'hidden')
  // Whether it overflows: until it is measured, it is taken to, so the axes that hold still
  // hide what passes under them from the first paint.
  const [fits, setFits] = useState(false)
  useLayoutEffect(() => {
    const frame = root.current
    if (!scroller || !frame) return
    const measure = () => setFits(frame.scrollWidth <= frame.clientWidth)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(frame)
    return () => observer.disconnect()
  }, [scroller, root, chart.leastPlotWidth])
  // A new range opens at its end again.
  const last = chart.current.at(-1)?.key
  useLayoutEffect(() => {
    const frame = root.current
    frame?.scrollTo({ left: 0, behavior: 'instant' })
  }, [last, root])
  const scrolls = scroller && !fits
  const style = {
    ...(chart.inset ? { '--chart-inset': `${chart.inset}px` } : {}),
    ...(scroller ? { '--plot-least': `${chart.leastPlotWidth}px` } : {}),
    ...props.style,
  } as CSSProperties
  return (
    <ChartContext value={chart}>
      <ChartActive>
        <figure
          ref={figureRef}
          data-slot={slot}
          data-chart={chart.id}
          data-orientation={chart.orientation}
          aria-label={chart.label}
          aria-describedby={description ? descriptionId : undefined}
          data-scroller={scroller ? '' : undefined}
          data-scrolls={scrolls ? '' : undefined}
          className={cn(
            chartFrameClassName,
            scroller &&
              'scrollbar-thin grid-cols-[auto_minmax(var(--plot-least),1fr)_auto] overflow-x-auto overflow-y-hidden [grid-template-areas:"top_top_top"_"._top-axis_."_"end-axis_plot_start-axis"_"._bottom-axis_."_"bottom_bottom_bottom"]',
            scroller &&
              (chart.direction === 'rtl'
                ? '[direction:ltr] *:[direction:rtl]'
                : '[direction:rtl] *:[direction:ltr]'),
            className,
          )}
          {...props}
          style={style}
        >
          <ChartStyle id={chart.id} config={chart.config} series={chart.series} />
          {description && (
            <p id={descriptionId} className='sr-only'>
              {description}
            </p>
          )}
          {children}
          {placeholder}
          {browse && <ChartColumns />}
          {scroller && <ScrollCorners direction={chart.direction} />}
          <ChartStatusOverlay empty={empty} />
          {browse && <ChartDataTable />}
        </figure>
      </ChartActive>
    </ChartContext>
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
  chart: Omit<ChartContextValue, 'pointOf'>
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
  shareColor,
  ShareTooltipContent,
  type ShareTooltipRow,
  shareValue,
  stickTo,
  axisSlide,
  CategoryChartFrame,
  type CategoryChartProps,
  type ChartCategory,
  type ChartActiveValue,
  type ChartContextValue,
  type ChartForecast,
  type ChartFormat,
  ChartGroup,
  ChartLegendToggles,
  type ChartMessages,
  type ChartPoint,
  type ChartStatus,
  ChartStyle,
  type ChartTable,
  ChartSvgPattern,
  columnLabel,
  pickIndex,
  rowsShown,
  type ChartAxis,
  type ChartXY,
  type ChartAxisName,
  type ChartCellGrid,
  type ChartGridAxis,
  scalesOf,
  xyPlace,
  type EntrancePhase,
  ChangeText,
  ChartNumber,
  chartFrameClassName,
  defaultMessages,
  figureProps,
  forcedSeriesColor,
  forcedSeriesColors,
  forcedSeriesTextColor,
  formatterOf,
  isForecast,
  labelOnClassName,
  patternImage,
  drawingFrame,
  drawingSize,
  plotLayerClassName,
  swatchClassName,
  tooltipQuietClassName,
  seriesColor,
  slideLine,
  slideTo,
  plotOffset,
  plotFraction,
  swatchStyle,
  tickMove,
  useCategoryChart,
  useChart,
  useRegistry,
  useChartActive,
  useEntered,
  useFromRest,
  useTicks,
  useWhenQuiet,
  valuePlace,
}
