import {
  type ChartDatum,
  type GridCell,
  gridCellAt,
  type ReadingDirection,
  type Span,
} from '@/registry/lib/chart-math'
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

/*
 * The cells' shape. Squares sit in columns and rows. Hexagons are
 * pointy-top, and each odd row sits half a cell toward the inline end, so
 * the rows still read across and a column's cells zigzag down it. A grid
 * keeps its shape's own proportions only for hexagons: a plot of square
 * cells widens them past its tallest, while hexagons never stretch.
 */

/** The shape of a grid's cells. */
type CellShape = 'square' | 'hex'

/** A cell's box, as fractions of the plot: across from its reading start, and down from its top. */
interface CellBox {
  x: number
  y: number
  width: number
  height: number
}

/** The odd rows' offset of a hexagon grid, in cells: none with one row. */
function hexOffset(rows: number) {
  return rows > 1 ? 0.5 : 0
}

/** How many radii tall a hexagon grid of `rows` is: a row every one and a half, and the last one's lower half. */
function hexDown(rows: number) {
  return 1.5 * rows + 0.5
}

/**
 * The plot's width over its height, at which the cells keep their shape:
 * square cells for squares, and regular hexagons, `√3` radii wide each.
 */
function gridAspect(shape: CellShape, columns: number, rows: number): number {
  if (shape === 'square') return columns / rows
  return ((columns + hexOffset(rows)) * Math.sqrt(3)) / hexDown(rows)
}

/** The box of the cell at `cell` in a grid `columns` by `rows`, before the room between cells. */
function cellBox(
  shape: CellShape,
  cell: GridCell,
  columns: number,
  rows: number,
): CellBox {
  if (shape === 'square') {
    return {
      x: cell.column / columns,
      y: cell.row / rows,
      width: 1 / columns,
      height: 1 / rows,
    }
  }
  const across = columns + hexOffset(rows)
  const down = hexDown(rows)
  const shift = cell.row % 2 === 1 ? hexOffset(rows) : 0
  return {
    x: (cell.column + shift) / across,
    y: (1.5 * cell.row) / down,
    width: 1 / across,
    height: 2 / down,
  }
}

/**
 * The cell under `at`, a point as fractions of the plot from its physical
 * left and its top: columns run from the reading start. A point past an
 * edge takes the cell at that edge. A hexagon is found by rounding the
 * point's cube coordinates, so a point in the room between two hexagons
 * takes the nearer one.
 */
function cellUnder(
  shape: CellShape,
  at: { x: number; y: number },
  columns: number,
  rows: number,
  direction: ReadingDirection,
): GridCell {
  if (shape === 'square') return gridCellAt(at, columns, rows, direction)
  const along = direction === 'rtl' ? 1 - at.x : at.x
  // In radii, from the centre of the first cell of the first row.
  const x = along * (columns + hexOffset(rows)) * Math.sqrt(3) - Math.sqrt(3) / 2
  // Held between the first row's centre and the last's, so a point in a notch along the top or
  // bottom takes the nearer hexagon of the row it is beside.
  const y = Math.min(1.5 * (rows - 1), Math.max(0, at.y * hexDown(rows) - 1))
  const q = (Math.sqrt(3) / 3) * x - y / 3
  const r = (2 / 3) * y
  const rs = Math.round(-q - r)
  let rq = Math.round(q)
  let rr = Math.round(r)
  const [dq, dr, ds] = [Math.abs(rq - q), Math.abs(rr - r), Math.abs(rs + q + r)]
  if (dq > dr && dq > ds) rq = -rr - rs
  else if (dr > ds) rr = -rq - rs
  const clamp = (value: number, count: number) => Math.min(count - 1, Math.max(0, value))
  const row = clamp(rr, rows)
  return { column: clamp(rq + (rr - (rr & 1)) / 2, columns), row }
}

/**
 * How many steps apart two hexagons are, through neighbours: 1 for the six
 * around a cell. Their places are columns and rows with the odd rows
 * shifted, so they are made axial first.
 */
function hexDistance(a: GridCell, b: GridCell): number {
  const { q, r } = hexStep(b, a)
  return (Math.abs(q) + Math.abs(q + r) + Math.abs(r)) / 2
}

/** The step from hexagon `from` to `to` in axial coordinates: the same for every pair of cells the same way apart. */
function hexStep(from: GridCell, to: GridCell): { q: number; r: number } {
  const q = (cell: GridCell) => cell.column - (cell.row - (cell.row & 1)) / 2
  return { q: q(to) - q(from), r: to.row - from.row }
}

/** A key for the step from hexagon `from` to `to`, which stays the same as both move together. */
function hexStepKey(from: GridCell, to: GridCell): string {
  const { q, r } = hexStep(from, to)
  return `${q},${r}`
}

/** The rings the spotlight steps back in: the lit cell is 0, and the last takes the rest. */
const SPOTLIGHT_RINGS = 3

/**
 * The ring of the spotlight around `lit` that `cell` sits in: 0 for the
 * lit cell, then by how far it is, up to `SPOTLIGHT_RINGS` for the rest.
 * Hexagons make a surface, so their neighbours step back by distance;
 * square cells are a table's, so the rest step back together.
 */
function spotlightRing(shape: CellShape, lit: GridCell, cell: GridCell): number {
  if (lit.column === cell.column && lit.row === cell.row) return 0
  if (shape === 'square') return SPOTLIGHT_RINGS
  return Math.min(SPOTLIGHT_RINGS, hexDistance(lit, cell))
}

/** Where along the grid a column's name sits, over its columns `from` to `to`: on a hexagon grid, over its even rows. */
function columnBand(
  shape: CellShape,
  from: number,
  to: number,
  columns: number,
  rows: number,
): { start: number; size: number } {
  const across = shape === 'square' ? columns : columns + hexOffset(rows)
  return { start: from / across, size: (to - from + 1) / across }
}

/** Where down the grid a row's name sits: over its row, centred on its cells. */
function rowBand(
  shape: CellShape,
  row: number,
  rows: number,
): { start: number; size: number } {
  if (shape === 'square') return { start: row / rows, size: 1 / rows }
  // A row is 1.5 radii from the next, centred a radius below its top.
  const down = hexDown(rows)
  return { start: (1.5 * row + 0.25) / down, size: 1.5 / down }
}

/**
 * The least width and height a cell is drawn at, in px, that a label
 * `width` by `height` fits inside. A hexagon is its full width only across
 * its middle half, so a label taller than that needs it wider.
 */
function labelRoom(
  shape: CellShape,
  width: number,
  height: number,
): { width: number; height: number } {
  if (shape === 'square') return { width, height }
  // A hexagon `w` wide is that wide for √3/6 × w either side of its middle, and narrows to its points beyond.
  const half = height / 2
  const flat = 2 * Math.sqrt(3) * half
  return { width: width >= flat ? width : (width + flat) / 2, height: 0 }
}

export {
  calendarGrid,
  type CalendarGrid,
  type CellBox,
  cellBox,
  type CellShape,
  cellUnder,
  columnBand,
  gridAspect,
  type GridOrder,
  hexDistance,
  hexStepKey,
  labelRoom,
  rowBand,
  SPOTLIGHT_RINGS,
  spotlightRing,
  keyedGrid,
  type KeyedGrid,
  type LaidCell,
  stepEdges,
  stepExtent,
  stepOf,
  stepStrength,
}
