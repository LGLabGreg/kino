import { type ChartWords, plotPlace } from '@/registry/lib/chart-base'
import type { ChartLive } from '@/registry/lib/chart-live-clock'
import {
  alongCategories,
  type ChartDatum,
  type ChartOrientation,
  keyAxis,
  nearestPoint,
  pointRank,
  type ReadingDirection,
  sliderValue,
  stepIndex,
  stepPoint,
  type XYValue,
} from '@/registry/lib/chart-math'
import type { ChartPoint, ChartReader, PlotPoint } from '@/registry/lib/chart-root'
import { type Band, bandCentre, indexAt } from '@/registry/lib/chart-scale'
import { type ChartTarget, indexOfKey, targetSeries } from '@/registry/lib/chart-state'

/*
 * The reader of the cartesian charts: how the pointer and the keys move
 * among the stops along x, where the tooltip sits and what is read out,
 * for the root (`chart-root`), which knows nothing about an x axis. Each
 * stop is a category, a time, or a scatter's point, held by its key. A
 * chart browses them in one of three ways: every series at a stop, one
 * series at a stop, or points placed by both values.
 */

/** A place along x the keys, the tooltip and the table stop at: a category, a time, or a scatter's point. */
interface CartesianStop {
  key: string
  /** As the data has it, under the chart's `index`. */
  value: unknown
  /** Its place among the stops still in the data; a leaving one keeps its last. */
  index: number
  band: Band
  leaving: boolean
  /** The chart's own row here, or null where only a series' own rows have one (LGL-627). */
  datum: ChartDatum | null
}

/** A stop placed by both values: by value, and by place as fractions along x from the reading start and up the value axis. */
interface CartesianPoint {
  value: XYValue
  place: XYValue
}

/** How the pointer and the keys move among the stops. */
type CartesianBrowse =
  /** Bar, Line, Area, Composed, Funnel: every series at a stop. */
  | { kind: 'x' }
  /**
   * Bump: one series at a stop, picked by the pointer, and stepped with Up
   * and Down. `seriesAt`'s point is in fractions of the plot from its
   * reading start and its top; `step` is the series a step up (-1) or down
   * (1) from `from` at the stop at `stop`, or null.
   */
  | {
      kind: 'x-series'
      seriesAt: (point: XYValue) => string | null
      step: (stop: number, from: string | null, step: -1 | 1) => string | null
    }
  /**
   * Scatter: each stop is a point. Keys step by its values, the pointer
   * finds it by its place with the `inset` in px kept clear inside the
   * plot's edges, and the slider ranks along the axis the last key moved
   * (`along`), which `onAlong` is told of.
   */
  | {
      kind: 'points'
      point: (stop: CartesianStop) => CartesianPoint | null
      inset: number
      along: 'x' | 'y'
      onAlong: (axis: 'x' | 'y') => void
    }

interface CartesianReaderInput {
  current: readonly CartesianStop[]
  browse: CartesianBrowse
  orientation: ChartOrientation
  direction: ReadingDirection
  /** Where the tooltip of a stop sits, and its side; `series` for a target on one series. */
  anchor: (stop: CartesianStop, series: string | null) => ChartPoint | null
  /** What is said of each stop: a `CartesianStop` is a `ChartItem`. */
  words: ChartWords
  /** Where the keys start: the first stop, or the last on a chart that opens at its end (a window, still or live). */
  start: 'first' | 'last'
  series: readonly string[]
  hidden: readonly string[]
}

/** Where a stop with no shown value sits among points, so the keys still reach it. */
const NO_POINT: XYValue = { x: 0, y: 0 }

/**
 * The reader of a cartesian chart: each stop held by its key, found by the
 * pointer along x, or among points by both values, and stepped by the keys
 * as the slider pattern asks; on a chart whose series are pointed at one by
 * one, the target holds its series too, which it brings forward.
 */
function cartesianReader(input: CartesianReaderInput): ChartReader {
  const { current, browse, orientation, direction, words } = input
  const keys = current.map((stop) => stop.key)
  const count = keys.length
  const centres = current.map((stop) => bandCentre(stop.band))
  // Points placed by both values step by value, and the pointer finds the nearest by place.
  const placed =
    browse.kind === 'points'
      ? current.map((stop) => browse.point(stop) ?? { value: NO_POINT, place: NO_POINT })
      : null
  const values = placed && placed.map((point) => point.value)
  const indexOf = (target: ChartTarget) =>
    target.kind === 'node' ? null : indexOfKey(keys, target.key)
  const stopOf = (target: ChartTarget) => {
    const index = indexOf(target)
    return index === null ? undefined : current[index]
  }
  const at = (index: number | null, series: string | null): ChartTarget | null => {
    const key = index === null ? undefined : keys[index]
    if (key === undefined) return null
    return series === null ? { kind: 'x', key } : { kind: 'datum', series, key }
  }
  const start = count === 0 ? null : input.start === 'last' ? count - 1 : 0
  return {
    holds: (target) => {
      if (indexOf(target) === null) return false
      return (
        target.kind === 'x' ||
        (target.kind === 'datum' &&
          input.series.includes(target.series) &&
          !input.hidden.includes(target.series))
      )
    },
    lights: targetSeries,
    item: (target) => {
      const stop = stopOf(target)
      if (!stop) return null
      const { key, value, datum, index } = stop
      return { key, value, datum, index }
    },
    items: keys.map((key) => ({ kind: 'x', key })),
    browse: {
      targetAt: (point: PlotPoint) => {
        // The plot's own box, from its top left.
        const box = { left: 0, top: 0, width: point.width, height: point.height }
        if (placed) {
          const inset = browse.kind === 'points' ? browse.inset : 0
          return at(nearestPlace(placed, point, inset, direction), null)
        }
        const index = indexAt(
          alongCategories(point, box, orientation, direction),
          centres,
        )
        const series =
          browse.kind === 'x-series'
            ? browse.seriesAt({
                x: alongCategories(point, box, 'vertical', direction),
                y: point.height === 0 ? 0 : point.y / point.height,
              })
            : null
        return at(index, series)
      },
      start: at(start, null),
      step: (from, key) => {
        const index = indexOf(from)
        if (index === null) return null
        const series = targetSeries(from)
        if (browse.kind === 'x-series' && (key === 'ArrowUp' || key === 'ArrowDown')) {
          return at(index, browse.step(index, series, key === 'ArrowUp' ? -1 : 1))
        }
        if (browse.kind === 'points' && values) {
          // Points step by x along it, and by y up and down.
          const next = stepPoint(values, index, key, direction)
          if (next === null) return null
          browse.onAlong(keyAxis(key))
          return at(next, series)
        }
        return at(stepIndex(key, index, count, orientation, direction), series)
      },
      rank: (target) => {
        const index = indexOf(target) ?? 0
        if (browse.kind === 'points' && values)
          return pointRank(values, index, browse.along)
        return sliderValue(index, Math.max(1, count), orientation)
      },
      stops: count,
      orientation: orientation === 'vertical' ? 'horizontal' : 'vertical',
      anchor: (target) => {
        const stop = stopOf(target)
        return stop ? input.anchor(stop, targetSeries(target)) : null
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

/**
 * The stop whose point sits nearest `at` on a plot `at.width` by
 * `at.height` px, measured in px, inside `inset` px kept clear at each
 * edge; null with none.
 */
function nearestPlace(
  points: readonly CartesianPoint[],
  at: PlotPoint,
  inset: number,
  direction: ReadingDirection,
) {
  return nearestPoint(
    points.map((point) => plotPlace(point.place, direction)),
    {
      x: placeFromFraction(at.width === 0 ? 0 : at.x / at.width, at.width, inset),
      y: placeFromFraction(at.height === 0 ? 0 : at.y / at.height, at.height, inset),
    },
    {
      width: Math.max(0, at.width - inset * 2),
      height: Math.max(0, at.height - inset * 2),
    },
  )
}

/** A fraction of a plot's whole length as a fraction of its inner length, inside `inset` px at each end. */
function placeFromFraction(fraction: number, length: number, inset: number) {
  const inner = length - inset * 2
  if (inner <= 0) return 0.5
  return (fraction * length - inset) / inner
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

export {
  type CartesianBrowse,
  type CartesianPoint,
  cartesianReader,
  type CartesianReaderInput,
  type CartesianStop,
  liveReader,
}
