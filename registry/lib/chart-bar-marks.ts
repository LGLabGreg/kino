import type { MarkKind, SeriesSpans } from '@/registry/lib/chart-frame'
import {
  type ChartStack,
  hiddenSpans,
  reachOf,
  seriesSpans,
  spanExtent,
  stacksOf,
} from '@/registry/lib/chart-math'
import { type Band, bandAt } from '@/registry/lib/chart-scale'

/*
 * Bars: each series' bar runs from zero to its value, side by side or
 * stacked by `stack` group, and a value given as `[from, to]` spans exactly
 * that. A hidden series collapses where it would stack, so it leaves from
 * its own place and comes back to it.
 */

const barMarks: MarkKind = {
  mark: 'bar',
  stacks: true,
  spans: ({ rows, series, shown, stack, stackOf }) => {
    const spans = seriesSpans(rows, shown, stack, stackOf)
    return {
      spans: { ...spans, ...hiddenSpans(rows, series, shown, stack, stackOf) },
      extent: shown.length === 0 ? null : spanExtent(spans),
    }
  },
  // The far end of the row's bars: the tallest, or the stack's top.
  reach: (spans, shown, index, scale) => scale.place(farEnd(spans, shown, index)),
}

/** How far the bars of row `index` reach from zero: the highest above it, or, with none above, the lowest below. */
function farEnd(spans: SeriesSpans, keys: readonly string[], index: number) {
  const up = reachOf(spans, keys, index)
  return up > 0 ? up : reachOf(spans, keys, index, true)
}

/**
 * The part of a category's `band` the bar of `key` stands in: its slot
 * among the bars side by side, or its stack's among the stacks. `bars` are
 * the chart's bar series in order, and only the shown ones and `key` take a
 * slot, so the rest close up when one hides.
 */
function barBand(
  band: Band,
  key: string,
  bars: readonly string[],
  hidden: readonly string[],
  stack: ChartStack,
  stackOf: (key: string) => string,
  gap: number,
): Band {
  const order = bars.filter((k) => k === key || !hidden.includes(k))
  if (stack === 'none') return slotBand(band, order.indexOf(key), order.length, gap)
  const stacks = stacksOf(order, stackOf)
  return slotBand(band, stacks.indexOf(stackOf(key)), stacks.length, gap)
}

/** The part of `band` the series in `slot` takes when `slots` series sit side by side, `gap` apart as a share of one slot. */
function slotBand(band: Band, slot: number, slots: number, gap = 0.12): Band {
  if (slots <= 1 || slot < 0) return band
  const inner = bandAt(slot, slots, { gap, outer: 0 })
  return {
    start: band.start + inner.start * band.size,
    size: inner.size * band.size,
  }
}

export { barBand, barMarks, farEnd, slotBand }
