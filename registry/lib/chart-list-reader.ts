import {
  type ChartOrientation,
  type ReadingDirection,
  sliderValue,
  stepIndex,
} from '@/registry/lib/chart-math'
import type {
  ChartItem,
  ChartPoint,
  ChartReader,
  PlotPoint,
} from '@/registry/lib/chart-root'
import {
  type ChartTable,
  type ChartTarget,
  indexOfKey,
  targetSeries,
} from '@/registry/lib/chart-state'
import type { ReactNode } from 'react'

/*
 * The reader of a chart whose stops are a list in order: a donut's slices, a
 * radial chart's rings, a radar's spokes, a waffle's categories. The keys
 * walk the list round or straight, and on a chart whose stops hold several
 * series, Up and Down step between them. Pure, so it is tested on its own.
 */

/** One thing the keys stop at: a slice, a ring, a spoke, a waffle's category. Its `index` is its place among the stops still in the data. */
type ListStop = ChartItem

/** How the arrows walk the list. */
type ListWalk =
  /** Donut, Radar: Right and Up go on (clockwise), Left and Down back, in either reading direction, as the marks aren't mirrored. */
  | { kind: 'round' }
  /** Radial, Waffle: along the orientation, mirrored in right to left. */
  | { kind: 'straight'; orientation: ChartOrientation }

/** Whether Up and Down move between series on a stop. */
type ListSeries =
  | { kind: 'none' }
  /**
   * Radar: the series Up (`step` -1) or Down (1) brings forward from `from`
   * on the stop at `stop`, or null for none. The pointer's series is always
   * null, so pointing at a stop never lights a series.
   */
  | {
      kind: 'step'
      step: (stop: number, from: string | null, step: -1 | 1) => string | null
      /** The series not hidden, which a stop's series target may bring forward. */
      shown: readonly string[]
    }

/** What a list chart says of its stops: to a screen reader, in the tooltip, and as the data table. */
interface ListWords {
  describe: (stop: ListStop) => string
  tooltip: (stop: ListStop) => ReactNode
  table: ChartTable
}

interface ListReaderInput {
  /** The stops still in the data, in order. */
  current: readonly ListStop[]
  walk: ListWalk
  series: ListSeries
  direction: ReadingDirection
  /** The stop under the pointer, by its place in `current`, or null. */
  hit: (point: PlotPoint) => number | null
  /** Where the stop's tooltip sits, or null before the plot is measured. */
  anchor: (stop: ListStop) => ChartPoint | null
  words: ListWords
}

/** The reader of a chart whose stops are a list: each stop is held by its key, as an `x` target, or with a series as a `datum` one. */
function listReader(input: ListReaderInput): ChartReader {
  const { current, walk, series, direction, words } = input
  const keys = current.map((stop) => stop.key)
  const count = keys.length
  // Round the circle, Right steps clockwise, the way the marks run, as they aren't mirrored in
  // right to left; the round marks run like upright bars.
  const orientation: ChartOrientation =
    walk.kind === 'round' ? 'vertical' : walk.orientation
  const reading: ReadingDirection = walk.kind === 'round' ? 'ltr' : direction
  const indexOf = (target: ChartTarget) =>
    target.kind === 'node' ? null : indexOfKey(keys, target.key)
  const stopOf = (target: ChartTarget) => {
    const index = indexOf(target)
    return index === null ? null : (current[index] ?? null)
  }
  const at = (index: number | null, lit: string | null): ChartTarget | null => {
    const key = index === null ? undefined : keys[index]
    if (key === undefined) return null
    return lit === null ? { kind: 'x', key } : { kind: 'datum', series: lit, key }
  }
  return {
    holds: (target) => {
      if (indexOf(target) === null) return false
      if (target.kind === 'x') return true
      return (
        target.kind === 'datum' &&
        series.kind === 'step' &&
        series.shown.includes(target.series)
      )
    },
    lights: targetSeries,
    item: stopOf,
    items: keys.map((key) => ({ kind: 'x', key })),
    browse: {
      targetAt: (point) => at(input.hit(point), null),
      start: at(0, null),
      step: (from, key) => {
        const index = indexOf(from)
        if (index === null) return null
        const lit = targetSeries(from)
        if (series.kind === 'step' && (key === 'ArrowUp' || key === 'ArrowDown')) {
          return at(index, series.step(index, lit, key === 'ArrowUp' ? -1 : 1))
        }
        return at(stepIndex(key, index, count, orientation, reading), lit)
      },
      rank: (target) =>
        sliderValue(indexOf(target) ?? 0, Math.max(1, count), orientation),
      stops: count,
      // The slider runs across the stops: across the page for those that run like upright bars.
      orientation: orientation === 'vertical' ? 'horizontal' : 'vertical',
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
  type ListReaderInput,
  type ListSeries,
  type ListStop,
  type ListWalk,
  type ListWords,
  listReader,
}
