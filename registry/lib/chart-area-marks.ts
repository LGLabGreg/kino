import type { MarkKind } from '@/registry/lib/chart-frame'
import {
  type ChartStack,
  hiddenSpans,
  rangeOf,
  reachOf,
  seriesSpans,
  type SeriesValueOf,
  spanExtent,
} from '@/registry/lib/chart-math'

/*
 * Areas: each series fills from its baseline to its value, from zero side by
 * side, or stacked on the areas before it by `stack` group. A value given as
 * `[from, to]` fills exactly that. A hidden series folds into the one below
 * it, and the areas above settle onto what is left.
 */

const areaMarks: MarkKind = {
  mark: 'area',
  stacks: true,
  spans: ({ count, valueOf, series, shown, stack, stackOf }) => {
    const drawn = stackedValues(valueOf, stack)
    const spans = seriesSpans(count, drawn, shown, stack, stackOf)
    return {
      spans: {
        ...spans,
        ...hiddenSpans(count, drawn, series, shown, stack, stackOf),
      },
      extent: shown.length === 0 ? null : spanExtent(spans),
    }
  },
  // Over the highest of the row's areas.
  reach: (spans, shown, index, scale) => scale.place(reachOf(spans, shown, index)),
}

/**
 * The values as the areas draw them: stacked, a missing value counts as
 * nothing, so the areas above it stay whole; side by side it leaves a gap.
 */
function stackedValues(valueOf: SeriesValueOf, stack: ChartStack): SeriesValueOf {
  if (stack === 'none') return valueOf
  return (series, index) => {
    const value = valueOf(series, index)
    return typeof value === 'number' || rangeOf(value) ? value : 0
  }
}

export { areaMarks, stackedValues }
