'use client'

import {
  type CategoryChartProps,
  figureProps,
  localeTag,
  pickedName,
} from '@/registry/lib/chart-base'
import {
  type CellAt,
  cellAnchor,
  cellAt,
  CellGridCells,
  type CellGridLayout,
  CellGridPlaceholder,
  CellGridSizer,
  CellGridTooltipContent,
  CellsChartFrame,
  type CellsContextValue,
  CellStepLegend,
  laidOutCells,
  lineNames,
  StepLegendContext,
  stepFill,
  useCellsChart,
} from '@/registry/lib/chart-cells'
import {
  calendarGrid,
  keyedGrid,
  stepEdges,
  stepExtent,
  stepOf,
} from '@/registry/lib/chart-grid'
import { gridReader, squareLayout } from '@/registry/lib/chart-grid-reader'
import { allWhole, numberOf } from '@/registry/lib/chart-math'
import type { ChartDatum } from '@/registry/lib/chart-math'
import { linearScale } from '@/registry/lib/chart-scale'
import {
  formatDate,
  monthName,
  monthOf,
  useLocale,
  type Weekday,
  weekdayNames,
  weekStart,
} from '@/registry/lib/dates'
import { type ComponentProps, useMemo, useState } from 'react'

import { cn } from '@/lib/utils'

/*
 * The Heatmap chart: values as coloured cells, in a grid named by two of
 * each row's values, such as days by hours, or as a calendar of days, as a
 * year of activity is. Each value takes one of a few steps of its colour,
 * at the value axis's round numbers, and the legend names them. It is drawn
 * on the cells (`chart-cells`) with the grid reader: the cell under the pointer stays bright
 * while the rest step back, the axes mark its column and its row, and the
 * arrows step through the cells by column and by row. A new range fills the
 * cells in a wave along the columns.
 */

interface HeatmapChartBaseProps extends Omit<
  CategoryChartProps,
  'index' | 'ordered' | 'patterns' | 'categoryFormat' | 'tickValues'
> {
  /** The key of each row's value, a key of the config, which colours its cell. */
  value: string
}

/** A grid named by two of each row's values, such as days by hours. */
interface HeatmapGridProps {
  layout?: 'grid'
  /** The key of each row's column: a column for each value, numbers from the lowest, others in the order the data gives them. */
  x: string
  /** The key of each row's row: a row for each value, numbers from the lowest, others in the order the data gives them. */
  y: string
  /** How a column's value is written, on the x axis and in a cell's name; `String` by default. */
  xFormat?: (value: unknown) => string
  /** How a row's value is written, on the y axis and in a cell's name; `String` by default. */
  yFormat?: (value: unknown) => string
  /** Every column's value, in order, when the data can't say: a column for each, with rows or none. */
  xValues?: readonly unknown[]
  /** Every row's value, in order, when the data can't say: a row for each, with rows or none. */
  yValues?: readonly unknown[]
  date?: never
  weekStartsOn?: never
}

/** A calendar of days, a column for each week. */
interface HeatmapCalendarProps {
  layout: 'calendar'
  /** The key of each row's day, a `yyyy-mm-dd` date: every day from the first to the last is a cell. */
  date: string
  /** The day each week starts on, from 0 for Sunday; the locale's by default. */
  weekStartsOn?: Weekday
  x?: never
  y?: never
  xFormat?: never
  yFormat?: never
  xValues?: never
  yValues?: never
}

type HeatmapChartProps = HeatmapChartBaseProps & (HeatmapGridProps | HeatmapCalendarProps)

const heatmapChartKeys = [
  'value',
  'layout',
  'x',
  'y',
  'xFormat',
  'yFormat',
  'xValues',
  'yValues',
  'date',
  'weekStartsOn',
]

function gridLayout(
  data: readonly ChartDatum[],
  x: string,
  y: string,
  xFormat: (value: unknown) => string,
  yFormat: (value: unknown) => string,
  xValues: readonly unknown[] | undefined,
  yValues: readonly unknown[] | undefined,
): CellGridLayout {
  const grid = keyedGrid(data, x, y, { columns: xValues, rows: yValues })
  return {
    cells: laidOutCells(
      grid.cells,
      (cell) => `${yFormat(cell.at.y)}, ${xFormat(cell.at.x)}`,
      (cell) => cellKey(cell.at.x, cell.at.y),
      ({ column, row }) => ({ column, row, x: column, y: row }),
    ),
    columns: grid.columns.length,
    rowCount: grid.rows.length,
    x: { names: lineNames(grid.columns), format: xFormat },
    y: { names: lineNames(grid.rows), format: yFormat },
  }
}

/**
 * A grid cell's key, for `selected`: its column's value and its row's, as
 * `x|y`, so values that hold a `|` themselves can name two cells alike.
 */
function cellKey(x: unknown, y: unknown) {
  return `${String(x)}|${String(y)}`
}

function calendarLayout(
  data: readonly ChartDatum[],
  date: string,
  first: Weekday,
  locale: string,
): CellGridLayout {
  const grid = calendarGrid(data, date, first)
  const days = weekdayNames(locale, first, 'short')
  const columns = Math.max(1, grid.columns)
  const monthAt = new Map(grid.months.map((month, index) => [month.month, index]))
  return {
    cells: laidOutCells(
      grid.cells,
      (cell) =>
        formatDate(cell.at, locale, {
          weekday: 'short',
          day: 'numeric',
          month: 'short',
          year: 'numeric',
        }),
      (cell) => cell.at,
      (cell): CellAt => ({
        column: cell.column,
        row: cell.row,
        x: monthAt.get(monthOf(cell.at)) ?? null,
        y: cell.row,
      }),
    ),
    columns: grid.columns,
    rowCount: 7,
    x: {
      // Each month over the weeks it reaches.
      names: grid.months.map(({ month, from, to }, index) => ({
        key: month,
        value: month,
        index,
        band: { start: from / columns, size: (to - from + 1) / columns },
        leaving: false,
      })),
      format: (value) => monthName(String(value), locale),
    },
    y: {
      names: lineNames(days.map((_, row) => row)),
      format: (value) => days[Number(value)] ?? String(value),
    },
  }
}

/**
 * The chart's root: it lays the rows out as cells, works out the colour's
 * steps, and sizes the plot so its cells are square, up to a height.
 */
function HeatmapChart(props: HeatmapChartProps) {
  const {
    data,
    value,
    config,
    domain,
    tickCount = 5,
    allowDecimals,
    locale,
    description,
    empty,
    className,
    children,
    ref,
  } = props
  const dateLocale = useLocale(localeTag(locale))
  const calendar = props.layout === 'calendar'
  const dateKey = calendar ? props.date : undefined
  const first: Weekday = calendar ? (props.weekStartsOn ?? weekStart(dateLocale)) : 1
  const xKey = calendar ? undefined : props.x
  const yKey = calendar ? undefined : props.y
  const xFormat = (calendar ? undefined : props.xFormat) ?? String
  const yFormat = (calendar ? undefined : props.yFormat) ?? String
  const xValues = calendar ? undefined : props.xValues
  const yValues = calendar ? undefined : props.yValues
  const layout = useMemo(
    () =>
      dateKey !== undefined
        ? calendarLayout(data, dateKey, first, dateLocale)
        : gridLayout(data, xKey ?? '', yKey ?? '', xFormat, yFormat, xValues, yValues),
    [data, dateKey, first, dateLocale, xKey, yKey, xFormat, yFormat, xValues, yValues],
  )
  const values = layout.cells.map((cell) => numberOf(cell.datum?.[value]))
  const scale = linearScale(stepExtent(values), {
    domain,
    tickCount,
    nice: true,
    allowDecimals:
      allowDecimals ??
      !allWhole(
        layout.cells.flatMap((cell) => (cell.datum ? [cell.datum] : [])),
        [value],
      ),
  })
  const edges = stepEdges(scale.domain, scale.ticks)
  const steps = edges.length - 1
  const [emphasis, setEmphasis] = useState<number | null>(null)
  const chart = useCellsChart(props, layout)
  const { state } = chart
  const valueLabel = config[value]?.label
  const valueName = typeof valueLabel === 'string' ? valueLabel : value
  const columns = Math.max(1, layout.columns || (calendar ? 53 : 24))
  const rows = Math.max(1, layout.rowCount || 7)
  const cells: CellsContextValue = {
    slot: 'heatmap-chart',
    cells: chart.cells,
    drawn: chart.drawn,
    columns,
    rows,
    value,
    edges,
    emphasis,
    fillOf: (stop) =>
      stepFill(value, stepOf(numberOf(stop.datum?.[value]), edges), steps),
    nameText: (stop) => stop.value,
    datumText: chart.datumText,
  }
  const valueText = (stop: { datum: ChartDatum | null }) =>
    chart.datumText(stop.datum?.[value])
  const reader = gridReader({
    current: chart.cells,
    layout: squareLayout,
    direction: state.direction,
    hit: (point) => cellAt(point, chart.cells, columns, rows, state.direction),
    anchor: (stop) => cellAnchor(stop, columns, rows, state.direction),
    words: {
      describe: (stop) =>
        `${pickedName(stop.value, chart.picked === stop.key, state.messages)}: ${valueName} ${valueText(stop)}`,
      tooltip: (stop) => <CellGridTooltipContent stop={stop} name={valueName} />,
      table: {
        header: state.messages.category,
        columns: [valueName],
        rows: chart.cells.map((stop) => ({
          key: stop.key,
          name: stop.value,
          cells: [valueText(stop)],
        })),
        footer: [],
      },
    },
    // A calendar scrolls and opens at its end, the latest week, so the keys start there too.
    start: calendar ? 'last' : 'first',
  })
  return (
    <StepLegendContext
      value={{
        slot: 'heatmap-chart',
        label: valueLabel ?? value,
        edges,
        fillOf: (step) => stepFill(value, step, steps),
        valueText: state.valueText,
        textWidth: state.textWidth,
        emphasis,
        setEmphasis,
      }}
    >
      <CellsChartFrame
        chart={chart}
        reader={reader}
        cells={cells}
        axes={layout}
        scrolls={calendar}
        ref={ref}
        description={description}
        empty={empty}
        className={cn('h-auto', className)}
        placeholder={
          chart.placeholder && (
            <CellGridPlaceholder slot='heatmap-chart' columns={columns} rows={rows} />
          )
        }
        {...figureProps(props, heatmapChartKeys)}
      >
        <CellGridSizer columns={columns} rows={rows} />
        {children}
      </CellsChartFrame>
    </StepLegendContext>
  )
}

/**
 * The cells: a cell for each column and row, in its step of the value's
 * colour, and a dashed outline where there is no value. While a cell is
 * lit, the rest step back and it is outlined; new values fill the cells in
 * a wave along the columns.
 */
function Heatmap(props: Omit<ComponentProps<'div'>, 'children'>) {
  return <CellGridCells {...props} />
}

/**
 * The colour's steps, from the lowest to the highest, with the value at
 * each edge, under or over the plot. Pointing at a step brings its cells
 * forward. A screen reader reads each step's range.
 */
function HeatmapLegend(
  props: Omit<ComponentProps<'div'>, 'children'> & { position?: 'top' | 'bottom' },
) {
  return <CellStepLegend {...props} />
}

export { Heatmap, HeatmapChart, type HeatmapChartProps, HeatmapLegend }
