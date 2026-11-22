import { type ReadingDirection, stepCell } from '@/registry/lib/chart-math'
import type {
  ChartItem,
  ChartPoint,
  ChartReader,
  PlotPoint,
} from '@/registry/lib/chart-root'
import { type ChartTable, type ChartTarget, indexOfKey } from '@/registry/lib/chart-state'
import type { ReactNode } from 'react'

/*
 * The reader of a chart drawn as a grid of cells, such as a heatmap: each
 * cell is a stop, held by its key, and the keys step through them as the
 * WAI-ARIA grid's do. Where each key goes comes from the grid's layout, so
 * cells of another shape add a layout and nothing else. Pure, so it is
 * tested on its own.
 */

/** A cell the keys stop at. */
interface GridStop extends ChartItem {
  column: number
  row: number
  /** The cell's name, such as a calendar cell's date, written out. */
  value: string
}

/** How a grid's cells sit, which says where each arrow goes. */
interface GridLayout {
  /**
   * The cell `key` goes to from the cell at `index`, or null for a key the
   * grid doesn't take. The WAI-ARIA grid's keys: the arrows one cell (where
   * no cell is there, the cell reached stays), Home and End to the first and
   * last cell of its row, Page Up and Page Down to the top and bottom of its
   * column.
   */
  step: (
    cells: readonly GridStop[],
    index: number,
    key: string,
    direction: ReadingDirection,
  ) => number | null
}

/** Square cells, in columns and rows. */
const squareLayout: GridLayout = {
  step: (cells, index, key, direction) => stepCell(cells, index, key, direction),
}

/** What a grid chart says of its cells: to a screen reader, in the tooltip, and as the data table. */
interface GridWords {
  describe: (stop: GridStop) => string
  tooltip: (stop: GridStop) => ReactNode
  table: ChartTable
}

interface GridReaderInput {
  /** The cells still in the data, in order. */
  current: readonly GridStop[]
  layout: GridLayout
  direction: ReadingDirection
  /** The cell under the pointer, by its place in `current`, or null. */
  hit: (point: PlotPoint) => number | null
  /** Where the cell's tooltip sits, or null before the plot is measured. */
  anchor: (stop: GridStop) => ChartPoint | null
  words: GridWords
  /** The last cell on a grid that scrolls and opens at its end, such as a year of weeks; else the first. */
  start: 'first' | 'last'
}

/** The reader of a grid of cells: each cell is held by its key, as an `x` target. */
function gridReader(input: GridReaderInput): ChartReader {
  const { current, layout, direction, words } = input
  const keys = current.map((stop) => stop.key)
  const count = keys.length
  const indexOf = (target: ChartTarget) =>
    target.kind === 'x' ? indexOfKey(keys, target.key) : null
  const stopOf = (target: ChartTarget) => {
    const index = indexOf(target)
    return index === null ? null : (current[index] ?? null)
  }
  const at = (index: number | null): ChartTarget | null => {
    const key = index === null ? undefined : keys[index]
    return key === undefined ? null : { kind: 'x', key }
  }
  return {
    holds: (target) => indexOf(target) !== null,
    lights: () => null,
    item: stopOf,
    items: keys.map((key) => ({ kind: 'x', key })),
    browse: {
      targetAt: (point) => at(input.hit(point)),
      start: at(count === 0 ? null : input.start === 'last' ? count - 1 : 0),
      step: (from, key) => {
        const index = indexOf(from)
        return index === null ? null : at(layout.step(current, index, key, direction))
      },
      rank: (target) => (indexOf(target) ?? 0) + 1,
      stops: count,
      // The slider runs along the cells, across the page.
      orientation: 'horizontal',
      anchor: (target) => {
        const stop = stopOf(target)
        return stop ? input.anchor(stop) : null
      },
      describe: (target) => {
        const stop = stopOf(target)
        return stop ? words.describe(stop) : ''
      },
      tooltip: (target) => {
        const stop = stopOf(target)
        return stop ? words.tooltip(stop) : null
      },
      table: words.table,
      open: () => null,
      back: null,
    },
  }
}

export {
  type GridLayout,
  type GridReaderInput,
  gridReader,
  type GridStop,
  type GridWords,
  squareLayout,
}
