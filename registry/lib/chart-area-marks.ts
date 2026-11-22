import type { MarkKind } from '@/registry/lib/chart-frame'
import {
  type ChartDatum,
  type ChartStack,
  hiddenSpans,
  rangeOf,
  reachOf,
  seriesSpans,
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
  spans: ({ rows, series, shown, stack, stackOf }) => {
    const drawn = stackedRows(rows, series, stack)
    const spans = seriesSpans(drawn, shown, stack, stackOf)
    return {
      spans: { ...spans, ...hiddenSpans(drawn, series, shown, stack, stackOf) },
      extent: shown.length === 0 ? null : spanExtent(spans),
    }
  },
  // Over the highest of the row's areas.
  reach: (spans, shown, index, scale) => scale.place(reachOf(spans, shown, index)),
}

/**
 * The rows as the areas draw them: stacked, a missing value counts as
 * nothing, so the areas above it stay whole; side by side it leaves a gap.
 */
function stackedRows(
  rows: readonly ChartDatum[],
  series: readonly string[],
  stack: ChartStack,
): readonly ChartDatum[] {
  if (stack === 'none') return rows
  return rows.map((row) => {
    const out = { ...row }
    for (const key of series) {
      if (typeof out[key] !== 'number' && !rangeOf(out[key])) out[key] = 0
    }
    return out
  })
}

export { areaMarks, stackedRows }
