import type { MarkKind, SeriesSpans } from '@/registry/lib/chart-frame'
import { highestPlace } from '@/registry/lib/chart-line-marks'
import {
  type ChartStack,
  numberOf,
  hiddenSpans,
  rangeOf,
  reachOf,
  seriesSpans,
  type SeriesValueOf,
  spanExtent,
  type Span,
} from '@/registry/lib/chart-math'
import {
  type Series,
  stack as d3Stack,
  stackOffsetNone,
  stackOffsetSilhouette,
  stackOffsetWiggle,
  stackOrderInsideOut,
  stackOrderNone,
} from 'd3-shape'

/*
 * Areas: each series fills from its baseline to its value, from zero side by
 * side, or stacked on the areas before it by `stack` group. A value given as
 * `[from, to]` fills exactly that. A hidden series folds into the one below
 * it, and the areas above settle onto what is left.
 *
 * Streams: every series stacked in one order, the whole stream around a
 * centre line (wiggle or silhouette) or up from zero, each layer from where
 * the one under it ends.
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

/**
 * Where a stream's layers sit: centred so its edges change as little as
 * they can (`wiggle`), centred on zero (`silhouette`), or stacked up from
 * zero (`zero`).
 */
type StreamOffset = 'wiggle' | 'silhouette' | 'zero'

const OFFSETS = {
  wiggle: stackOffsetWiggle,
  silhouette: stackOffsetSilhouette,
  zero: stackOffsetNone,
} as const

/**
 * A stream's layers: every series stacked in `order`, bottom first, one
 * stream whatever `stack` the config gives, around a centre line or up from
 * zero as `offset` says. A missing value counts as nothing; a hidden series
 * thins to nothing where it sits, so the layers around it close over it.
 */
function streamMarks(offset: StreamOffset, order: readonly string[]): MarkKind {
  return {
    mark: 'area',
    stacks: true,
    spans: ({ count, valueOf, series, shown }) => {
      const spans = streamSpans(count, valueOf, inOrder(order, series), shown, offset)
      return {
        spans,
        extent: shown.length === 0 || count === 0 ? null : streamExtent(spans),
      }
    },
    // Over the top of the stream.
    reach: highestPlace,
  }
}

/** `series` in `order`, any `order` doesn't name after it in their own order. */
function inOrder(order: readonly string[], series: readonly string[]): string[] {
  return [
    ...order.filter((key) => series.includes(key)),
    ...series.filter((key) => !order.includes(key)),
  ]
}

/**
 * Each layer's span at each of `count` stops, stacked in `order`, bottom
 * first, by `offset`: a hidden one, not in `shown`, with nothing in it.
 * Throws, naming the row, on a value below zero or a range, which a stream
 * can't stack.
 */
function streamSpans(
  count: number,
  valueOf: SeriesValueOf,
  order: readonly string[],
  shown: readonly string[],
  offset: StreamOffset,
): SeriesSpans {
  const values = Array.from({ length: count }, (_, at) =>
    Object.fromEntries(
      order.map((key) => {
        const value = streamValue(valueOf(key, at), key, at)
        return [key, shown.includes(key) ? value : 0]
      }),
    ),
  )
  const stacked = stackIn(order, values, stackOrderNone, offset)
  return Object.fromEntries(
    stacked.map((layer) => [layer.key, layer.map((point): Span => [point[0], point[1]])]),
  )
}

/** A layer's value at a stop as a stream stacks it: missing counts as nothing; below zero and ranges throw. */
function streamValue(value: unknown, key: string, at: number): number {
  if (rangeOf(value)) {
    throw new Error(
      `Row ${at} gives \`${key}\` a range: a stream stacks single values, each from where the layer under it ends.`,
    )
  }
  const number = numberOf(value)
  if (number !== null && number < 0) {
    throw new Error(
      `Row ${at} gives \`${key}\` ${number}: a stream stacks its layers up from nothing, so it can't place a value below zero.`,
    )
  }
  return number ?? 0
}

/** The stack d3 makes of `values`, one row per stop, its series `keys` in `order`, by `offset`. */
function stackIn(
  keys: readonly string[],
  values: readonly Record<string, number>[],
  order: typeof stackOrderNone,
  offset: StreamOffset,
): Series<Record<string, number>, string>[] {
  return d3Stack<Record<string, number>, string>()
    .keys(keys)
    .value((row, key) => row[key] ?? 0)
    .order(order)
    .offset(OFFSETS[offset])([...values])
}

/** The lowest and highest any layer reaches, all of them stacked into one stream. */
function streamExtent(spans: SeriesSpans): Span {
  let low = Infinity
  let high = -Infinity
  for (const layer of Object.values(spans)) {
    for (const span of layer) {
      if (!span) continue
      low = Math.min(low, span[0])
      high = Math.max(high, span[1])
    }
  }
  return Number.isFinite(low) ? [low, high] : [0, 0]
}

/**
 * The order a stream stacks `keys` in, bottom first, from their values at
 * `count` stops: d3's inside-out, the layers that swell first nearest the
 * middle and the later ones toward the edges, balanced by their totals, so
 * the stream's edges change least.
 */
function streamOrder(
  count: number,
  valueOf: SeriesValueOf,
  keys: readonly string[],
): string[] {
  const values = Array.from({ length: count }, (_, at) =>
    Object.fromEntries(keys.map((key) => [key, streamValue(valueOf(key, at), key, at)])),
  )
  const stacked = stackIn(keys, values, stackOrderInsideOut, 'zero')
  const order: string[] = []
  for (const layer of stacked) order[layer.index] = layer.key
  return order
}

export {
  areaMarks,
  stackedValues,
  type StreamOffset,
  streamExtent,
  streamMarks,
  streamOrder,
  streamSpans,
}
