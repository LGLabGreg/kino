import type { ChartDatum, GridCell, Span } from '@/registry/lib/chart-math'
import {
  addDays,
  daysBetween,
  isISODate,
  monthOf,
  startOfWeek,
  type Weekday,
  weekday,
} from '@/registry/lib/dates'

/*
 * How a chart drawn as a grid of cells, such as a heatmap, lays its rows of
 * data out, in columns and rows named by two of each row's values, or as
 * the weeks of a calendar, and the steps of the colour its cells take. Pure,
 * so it is tested on its own; the chart core steps and points through the
 * cells it gives, and `chart-cells` draws them.
 */

/** A cell of the grid: where it sits, and the row of data it shows, or none. */
interface LaidCell<T> extends GridCell {
  /** What the cell is: a column and row's values, or a date. */
  at: T
  datum: ChartDatum | null
}

/** A grid of `columns` by `rows`, with its cells in reading order, a row at a time. */
interface KeyedGrid {
  /** Each column's value, in order. */
  columns: readonly unknown[]
  /** Each row's value, in order. */
  rows: readonly unknown[]
  cells: readonly LaidCell<{ x: unknown; y: unknown }>[]
}

/** The values each column and row takes, in order, where the data alone can't say. */
interface GridOrder {
  /** Every column's value, in order: each is a column, with rows or none. */
  columns?: readonly unknown[]
  /** Every row's value, in order: each is a row, with rows of data or none. */
  rows?: readonly unknown[]
}

/**
 * The grid named by each row's `x` and `y`: a column for each `x` and a row
 * for each `y`, and a cell for every pair, so a pair the data leaves out is
 * a cell with no value. Where two rows name the same pair, the first is the
 * cell's. The columns and rows are `order`'s, when it gives them; otherwise
 * numbers run from the lowest, and other values come in the order the data
 * gives them.
 */
function keyedGrid(
  data: readonly ChartDatum[],
  x: string,
  y: string,
  order: GridOrder = {},
): KeyedGrid {
  const columns = order.columns ?? dataOrder(data, x, y)
  const rows = order.rows ?? dataOrder(data, y, x)
  const byPair = new Map<string, ChartDatum>()
  for (const row of data) {
    const pair = pairKey(row[x], row[y])
    if (!byPair.has(pair)) byPair.set(pair, row)
  }
  const cells = rows.flatMap((yValue, row) =>
    columns.map((xValue, column) => ({
      column,
      row,
      at: { x: xValue, y: yValue },
      datum: byPair.get(pairKey(xValue, yValue)) ?? null,
    })),
  )
  return { columns, rows, cells }
}

/**
 * Each value under `key` once, by its text: numbers from the lowest, and
 * other values in the order the data gives them within each `group`, so a
 * value one group leaves out, such as a day the first week has no rows
 * for, takes its place from the next group that has it: before the value
 * that follows it there, or last when none does.
 */
function dataOrder(data: readonly ChartDatum[], key: string, group: string): unknown[] {
  // Values go by their text; each text keeps the first value that gave it.
  const valueOf = new Map<string, unknown>()
  const groups = new Map<string, string[]>()
  for (const row of data) {
    const text = String(row[key])
    if (!valueOf.has(text)) valueOf.set(text, row[key])
    const name = String(row[group])
    const texts = groups.get(name) ?? []
    texts.push(text)
    groups.set(name, texts)
  }
  const order: string[] = []
  for (const texts of groups.values()) {
    texts.forEach((text, at) => {
      if (order.includes(text)) return
      const after = texts.slice(at + 1).find((other) => order.includes(other))
      const index = after === undefined ? order.length : order.indexOf(after)
      order.splice(index, 0, text)
    })
  }
  const values = order.map((text) => valueOf.get(text))
  if (values.every((value) => typeof value === 'number' && Number.isFinite(value))) {
    return (values as number[]).toSorted((a, b) => a - b)
  }
  return values
}

function pairKey(x: unknown, y: unknown) {
  return `${String(x)}\u0000${String(y)}`
}

/** The days from the first date to the last, as weeks of a calendar. */
interface CalendarGrid {
  /** How many weeks: a column each. */
  columns: number
  /** Each month the days reach, with the first and last column it takes. */
  months: readonly { month: string; from: number; to: number }[]
  /** A cell for each day, in order. */
  cells: readonly LaidCell<string>[]
}

/**
 * Every day from the first date in `data`'s `date` to the last, as a
 * calendar: a column for each week, starting on `first`, and a row for each
 * day of the week. A day the data leaves out is a cell with no value, and a
 * row whose date isn't a `yyyy-mm-dd` date is left out. Where two rows give
 * the same day, the first is its cell's.
 */
function calendarGrid(
  data: readonly ChartDatum[],
  date: string,
  first: Weekday,
): CalendarGrid {
  const byDay = new Map<string, ChartDatum>()
  for (const row of data) {
    const day = row[date]
    if (isISODate(day) && !byDay.has(day)) byDay.set(day, row)
  }
  const days = [...byDay.keys()].toSorted()
  const from = days[0]
  const to = days.at(-1)
  if (from === undefined || to === undefined) return { columns: 0, months: [], cells: [] }
  const start = startOfWeek(from, first)
  const cells = Array.from({ length: daysBetween(from, to) + 1 }, (_, at) => {
    const day = addDays(from, at)
    return {
      column: Math.floor(daysBetween(start, day) / 7),
      row: (weekday(day) - first + 7) % 7,
      at: day,
      datum: byDay.get(day) ?? null,
    }
  })
  const months: { month: string; from: number; to: number }[] = []
  for (const cell of cells) {
    const month = monthOf(cell.at)
    const last = months.at(-1)
    if (last?.month === month) last.to = cell.column
    else months.push({ month, from: cell.column, to: cell.column })
  }
  return { columns: (cells.at(-1)?.column ?? 0) + 1, months, cells }
}

/**
 * The edges of the colour's steps over `domain`: its round numbers, `ticks`,
 * with its ends, so a value always lands in a step. Two edges make one step.
 */
function stepEdges(domain: Span, ticks: readonly number[]): number[] {
  const inside = ticks.filter((tick) => tick > domain[0] && tick < domain[1])
  return [domain[0], ...inside, domain[1]]
}

/**
 * The step `value` falls in among the steps between `edges`: from 0 for the
 * lowest. A value on an edge takes the step above it, and one past either
 * end the step at that end. Null for no value.
 */
function stepOf(value: number | null, edges: readonly number[]): number | null {
  if (value === null) return null
  const last = Math.max(0, edges.length - 2)
  for (let step = 0; step < last; step += 1) {
    if (value < edges[step + 1]!) return step
  }
  return last
}

/**
 * How strong the colour of the step at `step` among `steps` is, from a
 * faint tint for the lowest to the whole colour for the highest, evenly
 * between, so each step reads apart from the next.
 */
function stepStrength(step: number, steps: number): number {
  if (steps <= 1) return 1
  return 0.22 + (0.78 * step) / (steps - 1)
}

/**
 * What the colour reaches: from zero, or the lowest value when it is below
 * zero, to the highest, so the lightest step means little and the darkest
 * the most. 0 to 1 with no values.
 */
function stepExtent(values: readonly (number | null)[]): Span {
  const numbers = values.filter((value): value is number => value !== null)
  if (numbers.length === 0) return [0, 1]
  return [Math.min(0, ...numbers), Math.max(0, ...numbers)]
}

export {
  calendarGrid,
  type CalendarGrid,
  type GridOrder,
  keyedGrid,
  type KeyedGrid,
  type LaidCell,
  stepEdges,
  stepExtent,
  stepOf,
  stepStrength,
}
