'use client'

import { type ChartAxisName, useChartActive } from '@/registry/lib/chart-base'
import {
  type ChartCategory,
  type CategoryReaderParts,
  type ChartContextValue,
  type ChartGridAxis,
  useChart,
} from '@/registry/lib/chart-core'
import { type LaidCell, stepOf, stepStrength } from '@/registry/lib/chart-grid'
import {
  type ChartDatum,
  type GridCell,
  gridCellAt,
  numberOf,
} from '@/registry/lib/chart-math'
import { plotLayerClassName, seriesColor } from '@/registry/lib/chart-root'
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
  use,
  useState,
} from 'react'

import { cn } from '@/lib/utils'

/*
 * The cell grid: what a chart drawn as a grid of cells, such as a heatmap,
 * shares on the chart core. Each cell is one of the core's categories, so
 * the tooltip, the table, the announcements and `selected` work as in any
 * chart; this part places the cells, picks the one under the pointer, gives
 * the axes their names and draws the cells, their legend and their
 * placeholder. The cell under the pointer stays bright while the rest step
 * back, and a new range fills the cells in a wave along the columns.
 */

/** Where each cell's own fields sit in the rows the chart core is given. */
const CELL_NAME = '\u0000name'
const CELL_KEY = '\u0000key'
const CELL_AT = '\u0000at'

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

/** Where a cell sits, and the name it takes on each axis, by its place in the axis's names. */
interface CellAt extends GridCell {
  x: number | null
  y: number | null
}

/** The grid's cells as the chart core's rows, with the axes' names. */
interface CellGridLayout {
  rows: readonly ChartDatum[]
  columns: number
  rowCount: number
  x: Omit<ChartGridAxis, 'nameOf'>
  y: Omit<ChartGridAxis, 'nameOf'>
}

/** The options of `useCategoryChart` for a chart of cells: every cell is a category. */
const cellGridOptions = {
  orientation: 'vertical',
  stack: 'none',
  entrance: false,
  // The plot holds square cells, so the chart is as tall as its rows and its legend make it.
  heightFromData: true,
  // No cell sits in a band: the grid places them.
  bandOf: () => ({ start: 0, size: 0 }),
  keyOf: (row: ChartDatum) => String(row[CELL_KEY]),
} as const

/** The core's rows for `cells`, each with its name, its key and where it sits. */
function cellGridRows<T>(
  cells: readonly LaidCell<T>[],
  name: (cell: LaidCell<T>) => string,
  key: (cell: LaidCell<T>) => string,
  at: (cell: LaidCell<T>) => CellAt,
): ChartDatum[] {
  return cells.map((cell) => ({
    ...cell.datum,
    [CELL_NAME]: name(cell),
    [CELL_KEY]: key(cell),
    [CELL_AT]: at(cell),
  }))
}

/** Names that each take one line of the grid: a column or a row each. */
function lineNames(values: readonly unknown[]): ChartAxisName[] {
  return values.map((value, index) => ({
    key: String(value),
    value,
    index,
    band: { start: index / values.length, size: 1 / values.length },
    leaving: false,
  }))
}

/** Where a category's cell sits. */
function cellOf(category: ChartCategory): CellAt {
  return category.datum[CELL_AT] as CellAt
}

/**
 * The chart core's context for a grid `columns` by `rows`: its cells and
 * axes, the tooltip over a cell's top edge, and the cell under the pointer.
 */
function cellGridChart(
  chart: ChartContextValue,
  layout: CellGridLayout,
  columns: number,
  rows: number,
  /** Whether it scrolls sideways once a column would be narrower than a cell can be pointed at, as a year of weeks does, rather than squeeze them. */
  scrolls = false,
): ChartContextValue & Pick<CategoryReaderParts, 'pointOf' | 'pickAt'> {
  const cells = chart.current.map(cellOf)
  const axis = (own: CellGridLayout['x'], name: 'x' | 'y'): ChartGridAxis => ({
    ...own,
    nameOf: (index) => cells[index]?.[name] ?? null,
  })
  return {
    ...chart,
    grid: { cells, x: axis(layout.x, 'x'), y: axis(layout.y, 'y') },
    leastPlotWidth: scrolls ? columns * LEAST_COLUMN : undefined,
    pointOf: (index) => {
      const cell = cells[index]
      if (!cell) return null
      const along = (cell.column + 0.5) / columns
      return {
        x: chart.direction === 'rtl' ? 1 - along : along,
        y: cell.row / rows,
        side: 'top',
      }
    },
    pickAt: (at, box) => {
      if (box.width === 0 || box.height === 0) return null
      const { column, row } = gridCellAt(
        { x: (at.x - box.left) / box.width, y: (at.y - box.top) / box.height },
        columns,
        rows,
        chart.direction,
      )
      const index = cells.findIndex((cell) => cell.column === column && cell.row === row)
      return index === -1 ? null : index
    },
  }
}

/**
 * The room between cells: the chart's `--<slot>-gap`, 2px by default, or
 * less where the cells are small, so a cell never shrinks to its gap.
 */
function cellGap(columns: number, rows: number) {
  return `min(var(--cells-gap, 2px), ${100 / columns}cqw * 0.15, ${100 / rows}cqh * 0.15)`
}

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

interface CellGridValue {
  /** The chart's slot, which names each part's: `heatmap-chart-cell`. */
  slot: string
  columns: number
  rows: number
  /** The config key of each cell's value. */
  value: string
  /** The edges of the colour's steps, lowest first. */
  edges: readonly number[]
  /** A cell's colour, or none for a cell with no value. */
  fillOf: (category: ChartCategory) => CellFill | null
  /** The legend's step under the pointer, whose cells come forward, or none. */
  emphasis: number | null
  setEmphasis: (step: number | null) => void
}

const CellGridContext = createContext<CellGridValue | null>(null)

function useCellGrid() {
  const grid = use(CellGridContext)
  if (!grid)
    throw new Error(
      'A chart’s cells go inside a chart of cells, such as a `HeatmapChart`.',
    )
  return grid
}

/** The value of a category's cell, or null for none. */
function useCellValue() {
  const { value } = useCellGrid()
  return (category: ChartCategory) => numberOf(category.datum[value])
}

/**
 * Holds the plot to square cells from the first paint: up to a height, or
 * a cell's, and no shorter than a row a pointer can find.
 */
function CellGridSizer({ columns, rows }: { columns: number; rows: number }) {
  return (
    <div
      aria-hidden
      className='pointer-events-none w-full min-w-0 [grid-area:plot]'
      style={{
        aspectRatio: `${columns} / ${rows}`,
        maxHeight: Math.min(MOST_HEIGHT, rows * MOST_CELL),
        minHeight: rows * LEAST_CELL,
      }}
    />
  )
}

/**
 * The cells: one layer of the plot, a cell for each column and row, in its
 * colour, and a dashed outline where there is no value. While a cell is lit,
 * the layer steps back as one, a single filter whatever the number of cells,
 * and the lit cell is drawn again over it, bright and outlined; pointing at
 * a step of the legend brings its cells forward the same way. When the
 * pointer leaves, the copies fade as the layer comes back, so nothing blinks.
 */
function CellGridCells({
  className,
  style,
  ...props
}: Omit<ComponentProps<'div'>, 'children'>) {
  const chart = useChart()
  const grid = useCellGrid()
  const valueOf = useCellValue()
  const { spotlit } = useChartActive()
  const litNow = spotlit === null ? undefined : chart.current[spotlit]
  const lit = litNow?.leaving ? undefined : litNow
  // The last cell lit and the last step brought forward, kept while their copies fade.
  const [held, setHeld] = useState<{ lit: string | null; step: number | null }>({
    lit: null,
    step: null,
  })
  if (lit && lit.key !== held.lit) setHeld({ ...held, lit: lit.key })
  if (grid.emphasis !== null && grid.emphasis !== held.step) {
    setHeld({ ...held, step: grid.emphasis })
  }
  if (chart.status === 'empty') return null
  const brought =
    held.step === null
      ? []
      : chart.current.filter(
          (category) => stepOf(valueOf(category), grid.edges) === held.step,
        )
  const dim = lit !== undefined || grid.emphasis !== null
  const shown = chart.current.find(
    (category) => category.key === held.lit && !category.leaving,
  )
  return (
    <>
      <CellLayer dim={dim} className={className} style={style} {...props} />
      <div
        data-slot={`${grid.slot}-lit`}
        data-off={grid.emphasis === null ? '' : undefined}
        aria-hidden
        className={cn(
          plotLayerClassName,
          'z-11 transition-opacity duration-(--motion-layout-duration) ease-(--motion-layout-fade-easing) data-off:opacity-0',
        )}
        style={cellLayerVariables(grid.slot)}
      >
        {brought.map((category) => (
          <CellGridCell
            key={category.key}
            {...cellProps(grid, category)}
            leaving={false}
            still
          />
        ))}
      </div>
      {shown && (
        <LitCell
          {...cellProps(grid, shown)}
          on={lit !== undefined}
          direction={chart.direction}
        />
      )}
    </>
  )
}

/** A cell's props, as plain values, so a cell whose colour is the same redraws nothing. */
function cellProps(grid: CellGridValue, category: ChartCategory) {
  const { column, row } = cellOf(category)
  const fill = grid.fillOf(category)
  return {
    slot: grid.slot,
    column,
    row,
    columns: grid.columns,
    rows: grid.rows,
    color: fill?.color ?? null,
    strength: fill?.strength ?? 0,
  }
}

/**
 * How far the rest steps back, how much of the `draw` role the wave waits
 * and the room between cells: the chart's own variables, such as
 * `--heatmap-chart-dim`, `--heatmap-chart-wave` and `--heatmap-chart-gap`,
 * set on its layer of cells for the cells inside.
 */
function cellLayerVariables(slot: string) {
  return {
    '--cells-dim': `var(--${slot}-dim, 0.3)`,
    '--cells-wave': `var(--${slot}-wave, 0.6)`,
    '--cells-gap': `var(--${slot}-gap, 2px)`,
  } as CSSProperties
}

/**
 * The layer of every cell, which steps back as one while `dim`. Memoised,
 * so moving from cell to cell redraws none of it.
 */
const CellLayer = memo(function CellLayer({
  dim,
  className,
  style,
  ...props
}: Omit<ComponentProps<'div'>, 'children'> & { dim: boolean }) {
  const chart = useChart()
  const grid = useCellGrid()
  return (
    <div
      data-slot={`${grid.slot}-cells`}
      data-dim={dim ? '' : undefined}
      aria-hidden
      className={cn(
        plotLayerClassName,
        'z-10 transition-[filter] duration-(--motion-layout-duration) ease-(--motion-layout-fade-easing) not-forced-colors:data-dim:[filter:saturate(var(--cells-dim))]',
        className,
      )}
      style={
        {
          ...cellLayerVariables(grid.slot),
          ...style,
        } as CSSProperties
      }
      {...props}
    >
      {chart.categories.map((category) => (
        <CellGridCell
          key={category.key}
          {...cellProps(grid, category)}
          leaving={category.leaving}
        />
      ))}
    </div>
  )
})

/**
 * The lit cell, drawn over the rest, bright and outlined: one element that
 * moves to each cell lit with a transform, so lighting a cell lays nothing
 * out, and fades on the `layout` role as the cells come back.
 */
function LitCell({
  slot,
  column,
  row,
  columns,
  rows,
  color,
  on,
  direction,
}: {
  slot: string
  column: number
  row: number
  columns: number
  rows: number
  color: string | null
  strength: number
  on: boolean
  direction: 'ltr' | 'rtl'
}) {
  return (
    <div
      aria-hidden
      className={cn(plotLayerClassName, 'z-11')}
      style={cellLayerVariables(slot)}
    >
      <span
        data-slot={`${slot}-lit-cell`}
        data-off={on ? undefined : ''}
        data-empty={color === null ? '' : undefined}
        className={cn(
          'absolute start-0 top-0 rounded-[min(calc(var(--control-radius-xs)/3),50%)] bg-(--cell-fill) transition-opacity duration-(--motion-layout-duration) ease-(--motion-layout-fade-easing) data-off:opacity-0',
          'outline-foreground outline-2 outline-offset-1 forced-colors:outline-[Highlight]',
          'data-empty:bg-transparent',
          'forced-colors:bg-[CanvasText] forced-colors:data-empty:bg-transparent',
        )}
        style={
          {
            '--cell-fill': color ?? undefined,
            '--cell-gap': cellGap(columns, rows),
            width: `calc(${100 / columns}cqw - var(--cell-gap))`,
            height: `calc(${100 / rows}cqh - var(--cell-gap))`,
            transform: `translate(calc(${direction === 'rtl' ? -1 : 1} * (${(column / columns) * 100}cqw + var(--cell-gap) / 2)), calc(${(row / rows) * 100}cqh + var(--cell-gap) / 2))`,
          } as CSSProperties
        }
      />
    </div>
  )
}

/**
 * One cell, at `column` and `row` of a grid `columns` by `rows`, in its
 * `fill`, or with none, a dashed outline. Its colour fades on the `draw`
 * role, later and quicker the further `along` it is, its column by default,
 * so a new range sweeps across and every cell lands within one `draw`. One that arrives
 * fades in the same way, over one that leaves from its place, which waits
 * below until the new one has landed. A `still` one, a copy over the rest,
 * is simply there. Memoised, so lighting a cell redraws none of them.
 */
const CellGridCell = memo(function CellGridCell({
  slot,
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
}: {
  slot: string
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
}) {
  const along = given ?? (columns <= 1 ? 0 : column / (columns - 1))
  // The pattern shown before this one, kept while it fades out as the new one fades in.
  const [patterns, setPatterns] = useState<{ now?: string; was?: string }>({ now: image })
  if (patterns.now !== image) setPatterns({ now: image, was: patterns.now })
  const shown =
    color === null ? [] : [patterns.was, image].filter((one) => one !== undefined)
  return (
    <span
      data-slot={`${slot}-cell`}
      data-leaving={leaving ? '' : undefined}
      data-still={still ? '' : undefined}
      data-empty={color === null ? '' : undefined}
      className={cn(
        'absolute z-1 rounded-[min(calc(var(--control-radius-xs)/3),50%)] bg-(--cell-fill) transition-none group-data-mounted/chart:[transition:background-color_var(--cell-span)_var(--motion-draw-fade-easing)_var(--cell-delay),opacity_var(--cell-span)_var(--motion-draw-fade-easing)_var(--cell-delay)] motion-reduce:group-data-mounted/chart:[transition:background-color_var(--motion-draw-duration)_var(--motion-draw-fade-easing),opacity_var(--motion-draw-duration)_var(--motion-draw-fade-easing)] group-data-mounted/chart:starting:opacity-0 data-still:transition-none!',
        // A cell that leaves waits under the one arriving in its place, then goes.
        'data-leaving:z-0 data-leaving:opacity-0 group-data-mounted/chart:data-leaving:[transition:opacity_var(--motion-exit-duration)_var(--motion-exit-fade-easing)_var(--motion-draw-duration)]',
        'data-empty:outline-border data-empty:bg-transparent data-empty:outline-1 data-empty:-outline-offset-1 data-empty:outline-dashed',
        // Forced colours take the fills away, so each cell is the text colour, as strong as its fill.
        'forced-colors:bg-[CanvasText] forced-colors:opacity-(--cell-strength) forced-colors:data-empty:bg-transparent forced-colors:data-empty:opacity-100 forced-colors:data-empty:outline-[GrayText]',
        forced,
      )}
      style={
        {
          '--cell-fill': color ?? undefined,
          '--cell-strength': strength,
          // The wave: a cell further along waits longer and fades quicker, so all land within one `draw`.
          '--cell-delay': `calc(var(--motion-draw-duration) * var(--cells-wave) * ${along})`,
          '--cell-span': `calc(var(--motion-draw-duration) * (1 - var(--cells-wave) * ${along}))`,
          '--cell-gap': cellGap(columns, rows),
          insetInlineStart: `calc(${(column / columns) * 100}cqw + var(--cell-gap) / 2)`,
          top: `calc(${(row / rows) * 100}cqh + var(--cell-gap) / 2)`,
          width: `calc(${100 / columns}cqw - var(--cell-gap))`,
          height: `calc(${100 / rows}cqh - var(--cell-gap))`,
        } as CSSProperties
      }
    >
      {/* A pattern can't fade into another, so each is a layer of its own that fades in or out on the cell's wave. */}
      {shown.map((pattern) => (
        <span
          key={pattern}
          data-off={pattern === image ? undefined : ''}
          className='absolute inset-0 rounded-[inherit] transition-none group-data-mounted/chart:[transition:opacity_var(--cell-span)_var(--motion-draw-fade-easing)_var(--cell-delay)] motion-reduce:group-data-mounted/chart:[transition:opacity_var(--motion-draw-duration)_var(--motion-draw-fade-easing)] group-data-mounted/chart:starting:opacity-0 data-off:opacity-0 in-data-still:transition-none!'
          style={{ background: pattern }}
        />
      ))}
    </span>
  )
})

/**
 * A cell's tooltip: its name, such as its day, and its value beside a
 * swatch of its colour.
 */
function CellGridTooltipContent({ index, name }: { index: number; name: ReactNode }) {
  const chart = useChart()
  const grid = useCellGrid()
  const category = chart.current[index]
  if (!category) return null
  const fill = grid.fillOf(category)
  return (
    // The tooltip sits outside the chart, so it carries the chart's id for its colours.
    <div data-chart={chart.id} className='grid min-w-36 gap-1'>
      <div className='font-medium'>{chart.categoryText(category.value)}</div>
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
          {chart.datumText(category.datum[grid.value])}
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
  const chart = useChart()
  const grid = useCellGrid()
  const { edges } = grid
  const steps = edges.length - 1
  if (chart.status !== 'ready' || steps < 1) return null
  const label = chart.config[grid.value]?.label ?? grid.value
  return (
    <div
      data-slot={`${grid.slot}-legend`}
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
        onPointerLeave={() => grid.setEmphasis(null)}
      >
        {Array.from({ length: steps }, (_, step) => {
          const from = chart.valueText(edges[step]!)
          const to = chart.valueText(edges[step + 1]!)
          // Wide enough that the values at its two edges never meet.
          const width = Math.max(
            32,
            chart.textWidth(from) / (step === 0 ? 1 : 2) +
              chart.textWidth(to) / (step === steps - 1 ? 1 : 2) +
              LEGEND_GAP,
          )
          const fill = stepFill(grid.value, step, steps)
          return (
            <li
              // oxlint-disable-next-line react/no-array-index-key -- a step is its place
              key={step}
              className='group/step relative flex flex-col items-stretch gap-1 px-px pb-4'
              // Narrower when the chart is, down to a swatch that still reads.
              style={{ width, flex: '0 1 auto', minWidth: 12 }}
              onPointerEnter={() => grid.setEmphasis(step)}
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
              <span
                aria-hidden
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
 * in the box the cells take, the whole plot by default.
 */
function CellGridPlaceholder({
  slot,
  columns,
  rows,
  className,
  style,
}: {
  slot: string
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
        className={cn(
          'absolute inset-0 grid gap-(--cell-gap)',
          placeholderBreatheClassName,
          className,
        )}
        style={
          {
            ...style,
            // The cells' own room between them, so the cells land where the placeholder's were.
            '--cell-gap': cellGap(columns, rows),
            gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
            gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
          } as CSSProperties
        }
      >
        {Array.from({ length: columns * rows }, (_, at) => (
          <span
            // oxlint-disable-next-line react/no-array-index-key -- a cell is its place
            key={at}
            className={cn(
              'rounded-[min(calc(var(--control-radius-xs)/3),50%)]',
              placeholderFillClassName,
            )}
          />
        ))}
      </div>
    </div>
  )
}

export {
  CELL_NAME,
  type CellAt,
  type CellFill,
  CellGridCell,
  CellGridCells,
  cellLayerVariables,
  cellGridChart,
  CellGridContext,
  type CellGridLayout,
  cellGridOptions,
  CellGridPlaceholder,
  cellGridRows,
  CellGridSizer,
  CellGridTooltipContent,
  type CellGridValue,
  CellStepLegend,
  lineNames,
  stepFill,
  useCellValue,
}
