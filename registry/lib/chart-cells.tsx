'use client'

import {
  type ActiveIndexProps,
  type AxisNames,
  type CategoryChartProps,
  ChartAxesContext,
  type ChartAxesValue,
  type ChartAxisName,
  IndexActive,
  stickTo,
  useChartActive,
  useChartLife,
  useChartLoad,
  useChartPick,
  useIndexFocus,
  useLeavingItems,
  writeDatum,
} from '@/registry/lib/chart-base'
import {
  type CellBox,
  cellBox,
  type CellShape,
  cellUnder,
  gridAspect,
  hexStepKey,
  type LaidCell,
  labelRoom,
  SPOTLIGHT_RINGS,
  spotlightRing,
  stepOf,
  stepStrength,
} from '@/registry/lib/chart-grid'
import type { GridStop } from '@/registry/lib/chart-grid-reader'
import {
  type ChartDatum,
  type GridCell,
  numberOf,
  type ReadingDirection,
} from '@/registry/lib/chart-math'
import {
  ChartFrame,
  type ChartPoint,
  type ChartReader,
  type ChartRootState,
  type ChartRootValue,
  labelOnClassName,
  type PlotPoint,
  plotLayerClassName,
  seriesColor,
  stepBackLayerClassName,
  useChartRoot,
  useChartRootValue,
} from '@/registry/lib/chart-root'
import {
  type ChartStatus,
  type ChartTarget,
  indexOfKey,
  targetKey,
} from '@/registry/lib/chart-state'
import {
  placeholderBreatheClassName,
  placeholderFillClassName,
} from '@/registry/lib/placeholder'
import {
  type ComponentProps,
  createContext,
  type CSSProperties,
  memo,
  type ReactNode,
  type Ref,
  use,
  useLayoutEffect,
  useMemo,
  useState,
} from 'react'

import { cn } from '@/lib/utils'

/*
 * The cells: what a chart drawn as a grid of cells, such as a heatmap,
 * shares on the chart root. Each cell is a stop of the grid reader
 * (`chart-grid-reader`), held by its key, so the tooltip, the table, the
 * announcements and `selected` work as in any chart; this part keeps the
 * cells, places them, picks the one under the pointer, gives the axes their
 * names and draws the cells, their legend and their placeholder. The cell
 * under the pointer stays bright while the rest step back, and a new range
 * fills the cells in a wave along the columns. The cells are squares or
 * hexagons (`CellShape`); hexagons make a surface, so the cells around the
 * lit one step back by how far they are. The Waffle draws its squares with
 * the same cells.
 */

/** The tallest the plot grows with square cells before its cells widen instead, in px. */
const MOST_HEIGHT = 320

/** The tallest a cell grows, so a grid of a row or two stays a strip, in px. */
const MOST_CELL = 40

/** The shortest a row gets, so a cell can still be pointed at, in px. */
const LEAST_CELL = 11
/** The narrowest a column gets in a chart that scrolls sideways, a cell with its gap, in px: a year of weeks fits a desktop card whole. */
const LEAST_COLUMN = 10

/** The least room between two values under the legend, in px. */
const LEGEND_GAP = 8

/** The height a value written in a cell needs, in px: a line of the chart's 12px text. */
const LABEL_HEIGHT = 14

/** The room either side of a value written in a cell, in px. */
const LABEL_PAD = 3

/** Where a cell sits, and the name it takes on each axis, by its place in the axis's names. */
interface CellAt extends GridCell {
  x: number | null
  y: number | null
}

/** A cell as its layout lays it out: where it sits and under which names, its key and name, and the caller's row, or null for a cell the data leaves out. */
interface LaidOutCell extends CellAt {
  key: string
  value: string
  datum: ChartDatum | null
}

/** One axis of a grid of cells: its names, and how it writes them. */
interface CellAxis {
  names: readonly ChartAxisName[]
  format: (value: unknown) => string
}

/** The grid's cells, in reading order, with the axes' names. */
interface CellGridLayout {
  cells: readonly LaidOutCell[]
  columns: number
  rowCount: number
  x: CellAxis
  y: CellAxis
}

/** The laid-out cells for `cells`, each with its name, its key and where it sits. */
function laidOutCells<T>(
  cells: readonly LaidCell<T>[],
  name: (cell: LaidCell<T>) => string,
  key: (cell: LaidCell<T>) => string,
  at: (cell: LaidCell<T>) => CellAt,
): LaidOutCell[] {
  return cells.map((cell) => ({
    ...at(cell),
    key: key(cell),
    value: name(cell),
    datum: cell.datum,
  }))
}

/** Names that each take one line of the grid, a column or a row, over the band `bandOf` gives each. */
function lineNames(
  values: readonly unknown[],
  bandOf: (index: number) => { start: number; size: number },
): ChartAxisName[] {
  return values.map((value, index) => ({
    key: String(value),
    value,
    index,
    band: bandOf(index),
    leaving: false,
  }))
}

/** A cell still in the data, with the names it sits under. */
type CellStop = GridStop & Pick<CellAt, 'x' | 'y'>

/** What a chart of cells keeps before it draws its cells. */
interface CellsChart {
  state: ChartRootState
  /** The cells still in the data, in reading order; none while it loads or failed. */
  cells: readonly CellStop[]
  /** Every cell to draw, the leaving ones too, in a fixed order by key. */
  drawn: readonly (CellStop & { leaving: boolean })[]
  status: ChartStatus
  /** The placeholder shows while the data loads. */
  placeholder: boolean
  /** The key of the cell picked, or null. */
  picked: string | null
  selectable: boolean
  /** Picks the cell keyed `key`, or lets it go if it was picked. */
  togglePicked: (key: string) => void
  activeProps: ActiveIndexProps
  /** Anything under a series' key as the chart writes it: a number, a `[from, to]` range, or no value. */
  datumText: (value: unknown) => string
}

/** The cells of a chart that loads or failed: one array, so what compares them sees no change. */
const NO_CELLS: readonly LaidOutCell[] = []

/**
 * A chart of cells' root state, its cells, what it shows and what is
 * picked. The plot holds square cells, so its height comes from its data.
 */
function useCellsChart(
  props: Omit<CategoryChartProps, 'index'>,
  layout: CellGridLayout,
): CellsChart {
  const state = useChartRoot(props, { entrance: false, heightFromData: true })
  const load = useChartLoad(props)
  const laid = load.placeholder || load.failed ? NO_CELLS : layout.cells
  const cells = laid.map((cell, index) => ({ ...cell, index }))
  const drawn = useLeavingItems(state.moves, cells, cellKey)
  const shown = state.series.filter((key) => !state.hidden.includes(key))
  const { status } = useChartLife(
    props,
    state,
    load,
    { rows: cells.length, shown: shown.length, drawn: cells.length },
    { entrance: false, cascade: null },
  )
  const keys = cells.map(cellKey)
  const pick = useChartPick(props, keys)
  return {
    state,
    cells,
    drawn,
    status,
    placeholder: load.placeholder,
    picked: pick.picked,
    selectable: pick.selectable,
    togglePicked: (key) => {
      if (indexOfKey(keys, key) !== null) pick.toggle(key)
    },
    activeProps: {
      activeIndex: props.activeIndex,
      defaultActiveIndex: props.defaultActiveIndex ?? null,
      onActiveIndexChange: props.onActiveIndexChange,
    },
    datumText: (value) => writeDatum(value, state.valueText, state.messages.noValue),
  }
}

function cellKey(cell: { key: string }) {
  return cell.key
}

/** The cell under `point` of a grid `columns` by `rows` that fills the plot, by its place among `cells`, or null. */
function cellAt(
  point: PlotPoint,
  cells: readonly GridCell[],
  shape: CellShape,
  columns: number,
  rows: number,
  direction: ReadingDirection,
): number | null {
  if (point.width === 0 || point.height === 0) return null
  const { column, row } = cellUnder(
    shape,
    { x: point.x / point.width, y: point.y / point.height },
    columns,
    rows,
    direction,
  )
  const index = cells.findIndex((cell) => cell.column === column && cell.row === row)
  return index === -1 ? null : index
}

/** Where a cell's tooltip sits: over the middle of its top edge, or a hexagon's top point, opening above it. */
function cellAnchor(
  cell: GridCell,
  shape: CellShape,
  columns: number,
  rows: number,
  direction: ReadingDirection,
): ChartPoint {
  const box = cellBox(shape, cell, columns, rows)
  const along = box.x + box.width / 2
  return {
    x: direction === 'rtl' ? 1 - along : along,
    y: box.y,
    side: 'top',
  }
}

/** What the cells' parts read, provided by `CellsChartFrame`. */
interface CellsContextValue {
  /** Each part's `data-slot` prefix and `cellLayerVariables`' name: `heatmap-chart`. */
  slot: string
  /** The cells still in the data. */
  cells: readonly GridStop[]
  /** The cells drawn, the leaving ones too. */
  drawn: readonly (GridStop & { leaving: boolean })[]
  shape: CellShape
  columns: number
  rows: number
  /** The key of the value that colours the cells. */
  value: string
  /** The values at the legend steps' edges, lowest first. */
  edges: readonly number[]
  /** The legend step brought forward, whose cells come forward, or null. */
  emphasis: number | null
  /** A cell's fill, or null for a cell with no value. */
  fillOf: (stop: GridStop) => CellFill | null
  /** A cell's name, such as its day. */
  nameText: (stop: GridStop) => string
  datumText: (value: unknown) => string
}

const CellsContext = createContext<CellsContextValue | null>(null)

function useCells() {
  const cells = use(CellsContext)
  if (!cells)
    throw new Error(
      'A chart’s cells go inside a chart of cells, such as a `HeatmapChart`.',
    )
  return cells
}

/** The value of a cell, or null for none. */
function useCellValue() {
  const { value } = useCells()
  return (stop: GridStop) => numberOf(stop.datum?.[value])
}

/** What the legend of a colour's steps reads, from the chart it sits in. */
interface StepLegendContextValue {
  /** Its `data-slot` prefix: `heatmap-chart`. */
  slot: string
  label: ReactNode
  /** The values at the steps' edges, lowest first: one more than the steps. */
  edges: readonly number[]
  fillOf: (step: number) => CellFill | null
  valueText: (value: number) => string
  textWidth: (text: string) => number
  /** The step brought forward, or null. */
  emphasis: number | null
  setEmphasis: (step: number | null) => void
}

const StepLegendContext = createContext<StepLegendContextValue | null>(null)

function useStepLegend() {
  const legend = use(StepLegendContext)
  if (!legend)
    throw new Error(
      'A legend of steps goes inside a chart whose colour steps, such as a `HeatmapChart`.',
    )
  return legend
}

/**
 * The `<figure>` of a chart of cells, on the root's frame: its reader, the
 * focus by the cells' places for `activeIndex`, the axes' names, the cells'
 * context and its placeholder. With `scrolls`, it scrolls sideways once a
 * column would be narrower than a cell can be pointed at, as a year of weeks
 * does, rather than squeeze them.
 */
function CellsChartFrame({
  chart,
  reader,
  cells,
  axes,
  scrolls,
  description,
  empty,
  placeholder,
  className,
  style,
  children,
  ...props
}: Omit<ComponentProps<'figure'>, 'ref'> & {
  chart: CellsChart
  reader: ChartReader
  cells: CellsContextValue
  /** The names along the top or bottom, and down the sides. */
  axes: { x: CellAxis; y: CellAxis }
  scrolls: boolean
  description?: string
  empty?: ReactNode
  placeholder: ReactNode
  ref?: Ref<HTMLElement>
}) {
  const { state, status } = chart
  const root: ChartRootValue = {
    ...state,
    status,
    reader,
    markerOf: () => null,
    selectable: chart.selectable,
    picked: chart.picked === null ? null : { kind: 'x', key: chart.picked },
    togglePicked: (target) => {
      if (target.kind !== 'node') chart.togglePicked(target.key)
    },
  }
  const { focusProps, toldRef } = useIndexFocus(reader.items, chart.activeProps)
  // It scrolls only while it shows its cells, so a note in their place stays in view. It takes
  // the opposite direction to the page, so it opens at its end, the latest column, from the
  // first paint, and stays there as it narrows; its parts take the page's direction again.
  const least = gridAcross(cells.shape, cells.columns, cells.rows) * LEAST_COLUMN
  const most = mostWidth(cells.shape, cells.columns, cells.rows)
  const scroller = scrolls && (status === 'ready' || status === 'hidden')
  // Whether it overflows: until it is measured, it is taken to, so the axes that hold still
  // hide what passes under them from the first paint.
  const [fits, setFits] = useState(false)
  const figure = state.root
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
  const last = chart.cells.at(-1)?.key
  useLayoutEffect(() => {
    if (scroller) figure.current?.scrollTo({ left: 0, behavior: 'instant' })
  }, [scroller, last, figure])
  const overflows = scroller && !fits
  return (
    <ChartFrame
      root={root}
      focus={focusProps}
      slot={cells.slot}
      description={description}
      empty={empty}
      measuring={false}
      inset={0}
      data-scroller={scroller ? '' : undefined}
      data-scrolls={overflows ? '' : undefined}
      className={cn(
        scroller &&
          'scrollbar-thin grid-cols-[auto_minmax(var(--plot-least),1fr)_auto] overflow-x-auto overflow-y-hidden [grid-template-areas:"top_top_top"_"._top-axis_."_"end-axis_plot_start-axis"_"._bottom-axis_."_"bottom_bottom_bottom"]',
        scroller &&
          (state.direction === 'rtl'
            ? '[direction:ltr] *:[direction:rtl]'
            : '[direction:rtl] *:[direction:ltr]'),
        // Cells that keep their shape stop widening at their widest, and room either side centres
        // the chart. That room is flexible, so the names and the legend never take it.
        most !== null &&
          (scroller
            ? 'grid-cols-[minmax(0,1fr)_auto_minmax(var(--plot-least),var(--plot-most))_auto_minmax(0,1fr)] [grid-template-areas:"top_top_top_top_top"_"._._top-axis_._."_"._end-axis_plot_start-axis_."_"._._bottom-axis_._."_"bottom_bottom_bottom_bottom_bottom"]'
            : 'grid-cols-[minmax(0,1fr)_auto_minmax(0,var(--plot-most))_auto_minmax(0,1fr)] [grid-template-areas:"top_top_top_top_top"_"._._top-axis_._."_"._start-axis_plot_end-axis_."_"._._bottom-axis_._."_"bottom_bottom_bottom_bottom_bottom"]'),
        className,
      )}
      style={
        {
          '--plot-least': scroller ? `${least}px` : undefined,
          '--plot-most': most === null ? undefined : `${most}px`,
          ...style,
        } as CSSProperties
      }
      {...props}
    >
      <ChartAxesContext value={cellAxes(chart, axes)}>
        <CellsContext value={cells}>
          <IndexActive items={reader.items} active={chart.activeProps} toldRef={toldRef}>
            {children}
            {placeholder}
          </IndexActive>
        </CellsContext>
      </ChartAxesContext>
      {scroller && <ScrollCorners direction={state.direction} />}
    </ChartFrame>
  )
}

/**
 * What the shared axes read of a chart of cells: no frame, since no axis of
 * the grid reads a scale, and each axis's names, which wait for the cells as
 * the cells wait for the data.
 */
function cellAxes(chart: CellsChart, axes: { x: CellAxis; y: CellAxis }): ChartAxesValue {
  const laidOut = chart.status === 'ready' || chart.status === 'hidden'
  const keys = chart.cells.map(cellKey)
  const names = (axis: 'x' | 'y', keepInside: boolean): AxisNames => {
    const own = axes[axis]
    const shown = laidOut ? own.names : []
    return {
      all: shown,
      current: shown,
      nameOf: (target: ChartTarget) => {
        const index = indexOfKey(keys, targetKey(target))
        return index === null ? null : (chart.cells[index]?.[axis] ?? null)
      },
      format: own.format,
      keepInside,
    }
  }
  return {
    frame: null,
    orientation: 'vertical',
    inset: 0,
    // The rows are each a name's height or more, so they centre freely.
    names: { x: names('x', true), y: names('y', false) },
    summaryValues: () => [],
    percent: false,
  }
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

/** How many cells wide a grid is: its columns, and half a cell more for hexagons' odd rows. */
function gridAcross(shape: CellShape, columns: number, rows: number) {
  return 1 / cellBox(shape, { column: 0, row: 0 }, columns, rows).width
}

/** The tallest a grid's plot grows, in px: a cell's most for each row, up to the plot's most. */
function mostHeight(rows: number) {
  return Math.min(MOST_HEIGHT, rows * MOST_CELL)
}

/**
 * The widest the plot of cells that keep their shape grows, in px: as wide
 * as its tallest. Null for square cells, which widen instead.
 */
function mostWidth(shape: CellShape, columns: number, rows: number): number | null {
  if (shape === 'square') return null
  return mostHeight(rows) * gridAspect(shape, columns, rows)
}

/**
 * Holds the plot to its cells' shape from the first paint. Square cells
 * stay square up to a height, or a cell's, then widen, and are no shorter
 * than a row a pointer can find; hexagons keep theirs at any width, and the
 * frame stops them widening (`mostWidth`).
 */
function CellGridSizer({
  shape,
  columns,
  rows,
}: {
  shape: CellShape
  columns: number
  rows: number
}) {
  return (
    <div
      aria-hidden
      className='pointer-events-none w-full min-w-0 [grid-area:plot]'
      style={
        shape === 'square'
          ? {
              aspectRatio: `${columns} / ${rows}`,
              maxHeight: mostHeight(rows),
              minHeight: rows * LEAST_CELL,
            }
          : { aspectRatio: gridAspect(shape, columns, rows) }
      }
    />
  )
}

/**
 * The room between cells: the chart's `--<slot>-gap`, 2px by default, or
 * less where the cells are small, so a cell never shrinks to its gap.
 */
function cellGap(box: CellBox) {
  return `min(var(--cells-gap, 2px), ${box.width * 100}cqw * 0.15, ${box.height * 100}cqh * 0.15)`
}

/**
 * Where a cell is drawn in its layer, as CSS lengths, inside its box by the
 * room between cells: half of it each side. A hexagon gives up as much
 * room across its slanted edges as across its upright ones, so it keeps
 * its shape: `2/√3` of it down.
 */
function cellPlace(shape: CellShape, box: CellBox) {
  const down = shape === 'hex' ? 2 / Math.sqrt(3) : 1
  return {
    gap: cellGap(box),
    start: `calc(${box.x * 100}cqw + var(--cell-gap) / 2)`,
    top: `calc(${box.y * 100}cqh + var(--cell-gap) * ${down / 2})`,
    width: `calc(${box.width * 100}cqw - var(--cell-gap))`,
    height: `calc(${box.height * 100}cqh - var(--cell-gap) * ${down})`,
  }
}

/*
 * A hexagon's outline, pointy-top, in its box. Its corners round as square
 * cells' do, by the shape tokens: a corner of radius ρ starts ρ/√3 along
 * each edge, at most half way, so the round shape turns them almost into
 * circles, as it turns square cells into circles. A browser without CSS
 * `shape()` draws them sharp.
 */
const HEX_SHARP = 'polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)'
// ρ is a third of --control-radius-xs, as square cells' corners are: these are ρ/√3 along an edge, across and down.
const HEX_X = 'min(calc(var(--control-radius-xs) / 6), 25%)'
const HEX_SLANT = 'min(calc(var(--control-radius-xs) / 10.3923), 12.5%)'
const HEX_UPRIGHT = 'min(calc(var(--control-radius-xs) / 5.1962), 25%)'
const HEX_ROUND = `shape(from calc(50% + ${HEX_X}) ${HEX_SLANT}, line to calc(100% - ${HEX_X}) calc(25% - ${HEX_SLANT}), curve to 100% calc(25% + ${HEX_UPRIGHT}) with 100% 25%, line to 100% calc(75% - ${HEX_UPRIGHT}), curve to calc(100% - ${HEX_X}) calc(75% + ${HEX_SLANT}) with 100% 75%, line to calc(50% + ${HEX_X}) calc(100% - ${HEX_SLANT}), curve to calc(50% - ${HEX_X}) calc(100% - ${HEX_SLANT}) with 50% 100%, line to ${HEX_X} calc(75% + ${HEX_SLANT}), curve to 0% calc(75% - ${HEX_UPRIGHT}) with 0% 75%, line to 0% calc(25% + ${HEX_UPRIGHT}), curve to ${HEX_X} calc(25% - ${HEX_SLANT}) with 0% 25%, line to calc(50% - ${HEX_X}) ${HEX_SLANT}, curve to calc(50% + ${HEX_X}) ${HEX_SLANT} with 50% 0%, close)`

/** Clips an element to a hexagon: rounded where the browser can, from `cellLayerVariables`. */
const hexClipClassName =
  '[clip-path:var(--hex-sharp)] supports-[clip-path:shape(from_0_0,line_to_1px_1px)]:[clip-path:var(--hex-round)]'

/** A cell's colour, and how strong it is, which forced colours keep as its opacity. */
interface CellFill {
  color: string
  strength: number
}

/** The colour of a step `strength` strong, in the colour of `key`, over the page's muted fill. */
function stepColor(key: string, strength: number): string {
  return `color-mix(in oklab, ${seriesColor(key)} ${Math.round(strength * 100)}%, var(--muted))`
}

/** The fill of a step among `steps`, in the colour of `key`; none for no step. */
function stepFill(key: string, step: number | null, steps: number): CellFill | null {
  if (step === null) return null
  const strength = stepStrength(step, steps)
  return { color: stepColor(key, strength), strength }
}

/**
 * What the cells write on themselves: each cell's value by its key, and the
 * least room a cell is drawn at that the widest fits, so the values show on
 * every cell or on none, never on some cells of a size.
 */
interface CellLabels {
  textOf: ReadonlyMap<string, string>
  /** The least width and height, in px. */
  room: { width: number; height: number }
}

/** No values written on the cells: one object, so what compares it sees no change. */
const NO_LABELS: CellLabels = {
  textOf: new Map(),
  room: { width: 0, height: 0 },
}

/** The values the cells write on themselves, while `on`, worked out once for the grid. */
function useCellLabels(on: boolean): CellLabels {
  const { textWidth, locale, format, valueText } = useChartRootValue()
  const { cells, shape, value } = useCells()
  return useMemo(
    () => {
      if (!on) return NO_LABELS
      const textOf = new Map<string, string>()
      for (const stop of cells) {
        const number = numberOf(stop.datum?.[value])
        if (number !== null) textOf.set(stop.key, valueText(number))
      }
      const widest = Math.max(0, ...[...new Set(textOf.values())].map(textWidth))
      return {
        textOf,
        room: labelRoom(shape, widest + 2 * LABEL_PAD, LABEL_HEIGHT),
      }
    },
    // `valueText` is made from `locale` and `format` on every render of the root.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
    [on, cells, shape, value, textWidth, locale, format],
  )
}

/** The least room a layer's cells write their values in, which `CellText` reads. */
function labelRoomVariables({ room }: CellLabels) {
  return {
    '--cells-label-width': `${room.width}px`,
    '--cells-label-height': `${room.height}px`,
  } as CSSProperties
}

/**
 * The cells: one layer of the plot, a cell for each column and row, in its
 * colour, and a dashed outline where there is no value, or a hollow
 * hexagon. While a cell is lit, the layer steps back as one, a single
 * filter whatever the number of cells, and the lit cell is drawn again over
 * it, bright and outlined; hexagons around it are drawn again too, in
 * rings that step back less the nearer they are, a filter each. Pointing
 * at a step of the legend brings its cells forward the same way. When the
 * pointer leaves, the copies fade as the layer comes back, so nothing
 * blinks. With `label`, each cell writes its value where it fits.
 */
function CellGridCells({
  label = false,
  className,
  style,
  ...props
}: Omit<ComponentProps<'div'>, 'children'> & {
  label?: boolean
}) {
  const { status, direction } = useChartRootValue()
  const grid = useCells()
  const valueOf = useCellValue()
  const labels = useCellLabels(label)
  const { spotlit } = useChartActive()
  const lit = spotlit === null ? undefined : grid.cells[spotlit]
  // The last cell lit and the last step brought forward, kept while their copies fade.
  const [held, setHeld] = useState<{ lit: string | null; step: number | null }>({
    lit: null,
    step: null,
  })
  if (lit && lit.key !== held.lit) setHeld({ ...held, lit: lit.key })
  if (grid.emphasis !== null && grid.emphasis !== held.step) {
    setHeld({ ...held, step: grid.emphasis })
  }
  if (status === 'empty') return null
  const brought =
    held.step === null
      ? []
      : grid.cells.filter((stop) => stepOf(valueOf(stop), grid.edges) === held.step)
  const dim = lit !== undefined || grid.emphasis !== null
  const shown = grid.cells.find((stop) => stop.key === held.lit)
  // The rings between the lit cell and the rest, nearest first; square cells have none.
  const rings = Array.from({ length: SPOTLIGHT_RINGS - 1 }, (_, at) =>
    shown
      ? grid.cells.filter((stop) => spotlightRing(grid.shape, shown, stop) === at + 1)
      : [],
  )
  return (
    <>
      <CellLayer
        dim={dim}
        labels={labels}
        className={className}
        style={style}
        {...props}
      />
      {rings.map(
        (ring, at) =>
          ring.length > 0 && (
            <div
              // oxlint-disable-next-line react/no-array-index-key -- a ring is its distance
              key={at}
              data-slot={`${grid.slot}-ring`}
              data-off={lit === undefined ? '' : undefined}
              data-dim=''
              aria-hidden
              className={cn(
                plotLayerClassName,
                stepBackLayerClassName,
                'z-11 transition-opacity duration-(--motion-layout-duration) ease-(--motion-layout-fade-easing) starting:opacity-0 data-off:opacity-0',
              )}
              style={
                {
                  ...cellLayerVariables(grid.slot),
                  ...labelRoomVariables(labels),
                  // Each ring keeps more of its colour the nearer it is, between the lit cell's and the rest's.
                  '--mark-step': (at + 1) / SPOTLIGHT_RINGS,
                } as CSSProperties
              }
            >
              {ring.map((stop) => (
                <CellGridCell
                  // By its step from the lit cell, so moving the light moves each copy rather than making new ones.
                  key={shown ? hexStepKey(shown, stop) : stop.key}
                  {...cellProps(grid, stop, labels)}
                  leaving={false}
                  still
                />
              ))}
            </div>
          ),
      )}
      <div
        data-slot={`${grid.slot}-lit`}
        data-off={grid.emphasis === null ? '' : undefined}
        aria-hidden
        className={cn(
          plotLayerClassName,
          'z-11 transition-opacity duration-(--motion-layout-duration) ease-(--motion-layout-fade-easing) data-off:opacity-0',
        )}
        style={{
          ...cellLayerVariables(grid.slot),
          ...labelRoomVariables(labels),
        }}
      >
        {brought.map((stop) => (
          <CellGridCell
            key={stop.key}
            {...cellProps(grid, stop, labels)}
            leaving={false}
            still
          />
        ))}
      </div>
      {shown && (
        <LitCell
          {...cellProps(grid, shown, labels)}
          labels={labels}
          on={lit !== undefined}
          direction={direction}
        />
      )}
    </>
  )
}

/** A cell's props, as plain values, so a cell whose colour is the same redraws nothing. */
function cellProps(grid: CellsContextValue, stop: GridStop, labels: CellLabels) {
  const fill = grid.fillOf(stop)
  return {
    slot: grid.slot,
    shape: grid.shape,
    column: stop.column,
    row: stop.row,
    columns: grid.columns,
    rows: grid.rows,
    color: fill?.color ?? null,
    strength: fill?.strength ?? 0,
    label: labels.textOf.get(stop.key),
  }
}

/**
 * How much of the `draw` role the wave waits and the room between cells:
 * the chart's own variables, such as `--heatmap-chart-wave` and
 * `--heatmap-chart-gap`, set on its layer of cells for the cells inside,
 * with a hexagon's outline.
 */
function cellLayerVariables(slot: string) {
  return {
    '--cells-wave': `var(--${slot}-wave, 0.6)`,
    '--cells-gap': `var(--${slot}-gap, 2px)`,
    '--hex-sharp': HEX_SHARP,
    '--hex-round': HEX_ROUND,
  } as CSSProperties
}

/**
 * The layer of every cell, which steps back as one while `dim`. Memoised,
 * so moving from cell to cell redraws none of it.
 */
const CellLayer = memo(function CellLayer({
  dim,
  labels,
  className,
  style,
  ...props
}: Omit<ComponentProps<'div'>, 'children'> & {
  dim: boolean
  labels: CellLabels
}) {
  const grid = useCells()
  return (
    <div
      data-slot={`${grid.slot}-cells`}
      data-dim={dim ? '' : undefined}
      aria-hidden
      className={cn(plotLayerClassName, 'z-10', stepBackLayerClassName, className)}
      style={
        {
          ...cellLayerVariables(grid.slot),
          ...labelRoomVariables(labels),
          ...style,
        } as CSSProperties
      }
      {...props}
    >
      {grid.drawn.map((stop) => (
        <CellGridCell
          key={stop.key}
          {...cellProps(grid, stop, labels)}
          leaving={stop.leaving}
        />
      ))}
    </div>
  )
})

/**
 * The lit cell, drawn over the rest, bright and outlined: one element that
 * moves to each cell lit with a transform, so lighting a cell lays nothing
 * out, and fades on the `layout` role as the cells come back. A hexagon's
 * outline is a hexagon of its own behind it, as square cells' outline is
 * clear of them by a pixel.
 */
function LitCell({
  slot,
  shape,
  column,
  row,
  columns,
  rows,
  color,
  label,
  labels,
  on,
  direction,
}: {
  slot: string
  shape: CellShape
  column: number
  row: number
  columns: number
  rows: number
  color: string | null
  strength: number
  label?: string
  labels: CellLabels
  on: boolean
  direction: 'ltr' | 'rtl'
}) {
  const place = cellPlace(shape, cellBox(shape, { column, row }, columns, rows))
  const sign = direction === 'rtl' ? -1 : 1
  const hex = shape === 'hex'
  // A hexagon's outline: 2px wide, clear of the cell by 1px, as square cells' is.
  const out = hex ? 3 : 0
  return (
    <div
      aria-hidden
      className={cn(plotLayerClassName, 'z-11')}
      style={{ ...cellLayerVariables(slot), ...labelRoomVariables(labels) }}
    >
      <span
        data-slot={`${slot}-lit-cell`}
        data-off={on ? undefined : ''}
        data-empty={color === null ? '' : undefined}
        className={cn(
          'absolute start-0 top-0 transition-opacity duration-(--motion-layout-duration) ease-(--motion-layout-fade-easing) data-off:opacity-0',
          hex
            ? cn('bg-foreground forced-colors:bg-[Highlight]', hexClipClassName)
            : 'outline-foreground rounded-[min(calc(var(--control-radius-xs)/3),50%)] bg-(--cell-fill) outline-2 outline-offset-1 data-empty:bg-transparent forced-colors:bg-[CanvasText] forced-colors:outline-[Highlight] forced-colors:data-empty:bg-transparent',
        )}
        style={
          {
            '--cell-fill': color ?? undefined,
            '--cell-gap': place.gap,
            '--label-on': color ?? undefined,
            width: `calc(${place.width} + ${2 * out}px)`,
            height: `calc(${place.height} + ${(4 * out) / Math.sqrt(3)}px)`,
            transform: `translate(calc(${sign} * (${place.start} - ${out}px)), calc(${place.top} - ${(2 * out) / Math.sqrt(3)}px))`,
          } as CSSProperties
        }
      >
        {hex ? (
          // The 1px clear of the cell, then the cell: hexagons 2px and 3px inside the outline.
          <span
            className={cn(
              'absolute inset-x-0.5 inset-y-[calc(4px/sqrt(3))] bg-(--chart-surface,var(--card)) forced-colors:bg-[Canvas]',
              hexClipClassName,
            )}
          >
            <span
              className={cn(
                'absolute inset-x-px inset-y-[calc(2px/sqrt(3))] bg-(--cell-fill) in-data-empty:bg-transparent forced-colors:bg-[CanvasText] forced-colors:in-data-empty:bg-transparent',
                hexClipClassName,
              )}
            >
              <CellText text={label} still />
            </span>
          </span>
        ) : (
          <CellText text={label} still />
        )}
      </span>
    </div>
  )
}

/**
 * A cell's value, written on it while the cell is drawn at least its
 * layer's `--cells-label-width` by `--cells-label-height`: a box that is the cell's size while it has the room and
 * none without, so the browser decides as the plot resizes, and the first
 * paint is right. It reads on the cell's colour, `--label-on`, and fades in
 * on the cell's wave when the value changes.
 */
function CellText({
  text,
  still = false,
}: {
  text: string | undefined
  still?: boolean
}) {
  if (text === undefined) return null
  return (
    <span
      className='absolute start-0 top-0 h-full overflow-hidden'
      style={{
        width: 'clamp(0px, (100% - var(--cells-label-width)) * 1000, 100%)',
      }}
    >
      <span
        className='absolute inset-x-0 top-0 flex items-center justify-center overflow-hidden'
        style={{
          height: 'clamp(0px, (100% - var(--cells-label-height)) * 1000, 100%)',
        }}
      >
        <span
          key={text}
          className={cn(
            'leading-none font-medium whitespace-nowrap tabular-nums',
            labelOnClassName,
            !still &&
              'transition-none group-data-mounted/chart:[transition:opacity_var(--cell-span)_var(--motion-draw-fade-easing)_var(--cell-delay)] group-data-mounted/chart:starting:opacity-0 motion-reduce:group-data-mounted/chart:[transition:opacity_var(--motion-draw-duration)_var(--motion-draw-fade-easing)]',
          )}
        >
          {text}
        </span>
      </span>
    </span>
  )
}

/**
 * One cell, at `column` and `row` of a grid `columns` by `rows`, in its
 * `fill`, or with none, a dashed outline, or a hollow hexagon. Its colour
 * fades on the `draw` role, later and quicker the further `along` it is,
 * its column by default, so a new range sweeps across and every cell lands
 * within one `draw`. One that arrives fades in the same way, over one that
 * leaves from its place, which waits below until the new one has landed. A
 * `still` one, a copy over the rest, is simply there. Memoised, so lighting
 * a cell redraws none of them.
 */
const CellGridCell = memo(function CellGridCell({
  slot,
  shape,
  column,
  row,
  columns,
  rows,
  color,
  strength,
  leaving,
  still = false,
  along: given,
  image,
  forced,
  label,
}: {
  slot: string
  shape: CellShape
  column: number
  row: number
  columns: number
  rows: number
  /** The cell's colour, or none for a cell with no value. */
  color: string | null
  strength: number
  leaving: boolean
  still?: boolean
  /** How far along the wave the cell is, from 0 to 1; its column's place by default. */
  along?: number
  /** A pattern drawn over the colour, from `patternImage`. */
  image?: string
  /** The cell's colour under forced colours, a class; the text colour, as strong as its fill, by default. */
  forced?: string
  /** The value it writes on itself where its layer's room fits it (`useCellLabels`), if any. */
  label?: string
}) {
  const along = given ?? (columns <= 1 ? 0 : column / (columns - 1))
  // The pattern shown before this one, kept while it fades out as the new one fades in.
  const [patterns, setPatterns] = useState<{ now?: string; was?: string }>({
    now: image,
  })
  if (patterns.now !== image) setPatterns({ now: image, was: patterns.now })
  const shown =
    color === null ? [] : [patterns.was, image].filter((one) => one !== undefined)
  const hex = shape === 'hex'
  const place = cellPlace(shape, cellBox(shape, { column, row }, columns, rows))
  return (
    <span
      data-slot={`${slot}-cell`}
      data-leaving={leaving ? '' : undefined}
      data-still={still ? '' : undefined}
      data-empty={color === null ? '' : undefined}
      className={cn(
        'absolute z-1 bg-(--cell-fill) transition-none group-data-mounted/chart:[transition:background-color_var(--cell-span)_var(--motion-draw-fade-easing)_var(--cell-delay),opacity_var(--cell-span)_var(--motion-draw-fade-easing)_var(--cell-delay)] motion-reduce:group-data-mounted/chart:[transition:background-color_var(--motion-draw-duration)_var(--motion-draw-fade-easing),opacity_var(--motion-draw-duration)_var(--motion-draw-fade-easing)] group-data-mounted/chart:starting:opacity-0 data-still:transition-none!',
        // A cell that leaves waits under the one arriving in its place, then goes.
        'data-leaving:z-0 data-leaving:opacity-0 group-data-mounted/chart:data-leaving:[transition:opacity_var(--motion-exit-duration)_var(--motion-exit-fade-easing)_var(--motion-draw-duration)]',
        // Forced colours take the fills away, so each cell is the text colour, as strong as its fill:
        // the page over it where it is weaker, so a value written on it keeps its contrast.
        "forced-colors:bg-[CanvasText] forced-colors:before:absolute forced-colors:before:inset-0 forced-colors:before:rounded-[inherit] forced-colors:before:bg-[Canvas] forced-colors:before:opacity-[calc(1-var(--cell-strength))] forced-colors:before:content-[''] forced-colors:data-empty:before:hidden",
        hex
          ? cn(
              // A hexagon with no value is hollow: its outline is the cell, and a hexagon inside it the page.
              'data-empty:bg-border forced-colors:data-empty:bg-[GrayText]',
              hexClipClassName,
            )
          : 'rounded-[min(calc(var(--control-radius-xs)/3),50%)] data-empty:bg-transparent data-empty:outline-1 data-empty:-outline-offset-1 data-empty:outline-border data-empty:outline-dashed forced-colors:data-empty:bg-transparent forced-colors:data-empty:outline-[GrayText]',
        forced,
      )}
      style={
        {
          '--cell-fill': color ?? undefined,
          '--cell-strength': strength,
          '--label-on': color ?? undefined,
          // The wave: a cell further along waits longer and fades quicker, so all land within one `draw`.
          '--cell-delay': `calc(var(--motion-draw-duration) * var(--cells-wave) * ${along})`,
          '--cell-span': `calc(var(--motion-draw-duration) * (1 - var(--cells-wave) * ${along}))`,
          '--cell-gap': place.gap,
          insetInlineStart: place.start,
          top: place.top,
          width: place.width,
          height: place.height,
        } as CSSProperties
      }
    >
      {hex && color === null && (
        // 1px in across its upright edges, and as far across its slanted ones.
        <span
          className={cn(
            'absolute inset-x-px inset-y-[calc(2px/sqrt(3))] bg-(--chart-surface,var(--card)) forced-colors:bg-[Canvas]',
            hexClipClassName,
          )}
        />
      )}
      {/* A pattern can't fade into another, so each is a layer of its own that fades in or out on the cell's wave. */}
      {shown.map((pattern) => (
        <span
          key={pattern}
          data-off={pattern === image ? undefined : ''}
          className='absolute inset-0 rounded-[inherit] transition-none group-data-mounted/chart:[transition:opacity_var(--cell-span)_var(--motion-draw-fade-easing)_var(--cell-delay)] motion-reduce:group-data-mounted/chart:[transition:opacity_var(--motion-draw-duration)_var(--motion-draw-fade-easing)] group-data-mounted/chart:starting:opacity-0 data-off:opacity-0 in-data-still:transition-none!'
          style={{ background: pattern }}
        />
      ))}
      <CellText text={label} still={still} />
    </span>
  )
})

/**
 * A cell's tooltip: its name, such as its day, and its value beside a
 * swatch of its colour.
 */
function CellGridTooltipContent({ stop, name }: { stop: GridStop; name: ReactNode }) {
  const { id } = useChartRootValue()
  const grid = useCells()
  const fill = grid.fillOf(stop)
  return (
    // The tooltip sits outside the chart, so it carries the chart's id for its colours.
    <div data-chart={id} className='grid min-w-36 gap-1'>
      <div className='font-medium'>{grid.nameText(stop)}</div>
      <div className='flex items-center gap-2'>
        <span
          aria-hidden
          className={cn(
            'size-2 shrink-0 rounded-[calc(var(--control-radius-xs)/4)]',
            fill === null
              ? 'border-background/50 border border-dashed forced-colors:border-[CanvasText]'
              : 'bg-(--cell-fill) forced-colors:bg-[CanvasText]',
          )}
          style={
            fill === null ? undefined : ({ '--cell-fill': fill.color } as CSSProperties)
          }
        />
        <span className='text-background/75 min-w-0 flex-1 truncate forced-colors:text-[CanvasText]'>
          {name}
        </span>
        {/* A value with a unit reads in its own order whatever the page's direction. */}
        <span dir='auto' className='font-medium tabular-nums'>
          {grid.datumText(stop.datum?.[grid.value])}
        </span>
      </div>
    </div>
  )
}

/**
 * The colour's steps, from the lowest to the highest, with the value at
 * each edge, under or over the plot. Pointing at a step brings its cells
 * forward. A screen reader reads each step's range.
 */
function CellStepLegend({
  position = 'bottom',
  className,
  ...props
}: Omit<ComponentProps<'div'>, 'children'> & { position?: 'top' | 'bottom' }) {
  const { status } = useChartRootValue()
  const legend = useStepLegend()
  const { edges, label } = legend
  const steps = edges.length - 1
  if (status !== 'ready' || steps < 1) return null
  return (
    <div
      data-slot={`${legend.slot}-legend`}
      className={cn(
        'flex flex-wrap items-center justify-end gap-x-3 gap-y-1',
        // While the chart scrolls sideways, it stays in view at the width the chart shows.
        'group-data-scrolls/chart:sticky group-data-scrolls/chart:inset-x-0 group-data-scrolls/chart:w-[100cqw]',
        position === 'top' ? 'pb-3 [grid-area:top]' : 'pt-3 [grid-area:bottom]',
        className,
      )}
      {...props}
    >
      <span className='text-muted-foreground font-medium'>{label}</span>
      <ul
        aria-label={typeof label === 'string' ? label : undefined}
        className='flex max-w-full min-w-0 items-start'
        onPointerLeave={() => legend.setEmphasis(null)}
      >
        {Array.from({ length: steps }, (_, step) => {
          const from = legend.valueText(edges[step]!)
          const to = legend.valueText(edges[step + 1]!)
          // Wide enough that the values at its two edges never meet.
          const width = Math.max(
            32,
            legend.textWidth(from) / (step === 0 ? 1 : 2) +
              legend.textWidth(to) / (step === steps - 1 ? 1 : 2) +
              LEGEND_GAP,
          )
          const fill = legend.fillOf(step)
          return (
            <li
              // oxlint-disable-next-line react/no-array-index-key -- a step is its place
              key={step}
              className='group/step relative flex flex-col items-stretch gap-1 px-px pb-4'
              // Narrower when the chart is, down to a swatch that still reads.
              style={{ width, flex: '0 1 auto', minWidth: 12 }}
              onPointerEnter={() => legend.setEmphasis(step)}
            >
              <span
                aria-hidden
                className='h-2.5 rounded-[min(calc(var(--control-radius-xs)/3),50%)] bg-(--cell-fill) transition-[background-color] duration-(--motion-draw-duration) ease-(--motion-draw-fade-easing) forced-colors:bg-[CanvasText] forced-colors:opacity-(--cell-strength)'
                style={
                  {
                    '--cell-fill': fill?.color,
                    '--cell-strength': fill?.strength,
                  } as CSSProperties
                }
              />
              <span className='sr-only'>
                {from} – {to}
              </span>
              {/* The value at the step's start, and at the last step's end too. */}
              {/* A signed value reads in its own order whatever the page's direction. */}
              <span
                aria-hidden
                dir='auto'
                // The first sits from the legend's start, so it stays inside it; the rest centre on their edge.
                className={cn(
                  'text-muted-foreground absolute start-0 bottom-0 whitespace-nowrap tabular-nums',
                  // In a narrow chart, only the two ends are written; a screen reader still reads every step.
                  step > 0 && '-translate-x-1/2 rtl:translate-x-1/2 @max-md/chart:hidden',
                )}
              >
                {from}
              </span>
              {step === steps - 1 && (
                <span
                  aria-hidden
                  dir='auto'
                  className='text-muted-foreground absolute end-0 bottom-0 whitespace-nowrap tabular-nums'
                >
                  {to}
                </span>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/**
 * The placeholder while the data loads: the grid's cells, breathing slowly,
 * where the cells will land, in the box the cells take, the whole plot by
 * default.
 */
function CellGridPlaceholder({
  slot,
  shape,
  columns,
  rows,
  className,
  style,
}: {
  slot: string
  shape: CellShape
  columns: number
  rows: number
  className?: string
  style?: CSSProperties
}) {
  return (
    <div
      data-slot={`${slot}-placeholder`}
      aria-hidden
      style={cellLayerVariables(slot)}
      className={cn(
        plotLayerClassName,
        'z-10 transition-opacity duration-(--motion-enter-duration) ease-(--motion-enter-easing) group-data-mounted/chart:starting:opacity-0',
      )}
    >
      <div
        className={cn('absolute inset-0', placeholderBreatheClassName, className)}
        style={style}
      >
        {Array.from({ length: columns * rows }, (_, at) => {
          const place = cellPlace(
            shape,
            cellBox(
              shape,
              { column: at % columns, row: Math.floor(at / columns) },
              columns,
              rows,
            ),
          )
          return (
            <span
              // oxlint-disable-next-line react/no-array-index-key -- a cell is its place
              key={at}
              className={cn(
                'absolute',
                shape === 'hex'
                  ? hexClipClassName
                  : 'rounded-[min(calc(var(--control-radius-xs)/3),50%)]',
                placeholderFillClassName,
              )}
              style={
                {
                  '--cell-gap': place.gap,
                  insetInlineStart: place.start,
                  top: place.top,
                  width: place.width,
                  height: place.height,
                } as CSSProperties
              }
            />
          )
        })}
      </div>
    </div>
  )
}

export {
  type CellAt,
  type CellAxis,
  cellAnchor,
  cellAt,
  type CellFill,
  CellGridCell,
  CellGridCells,
  type CellGridLayout,
  CellGridPlaceholder,
  CellGridSizer,
  CellGridTooltipContent,
  cellLayerVariables,
  type CellsChart,
  CellsChartFrame,
  type CellsContextValue,
  CellStepLegend,
  laidOutCells,
  lineNames,
  StepLegendContext,
  type StepLegendContextValue,
  stepFill,
  useCellsChart,
  useCellValue,
}
