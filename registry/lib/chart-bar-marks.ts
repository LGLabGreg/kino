import type { MarkKind, SeriesSpans } from '@/registry/lib/chart-frame'
import {
  type ChartStack,
  hiddenSpans,
  numberOf,
  rangeOf,
  reachOf,
  seriesSpans,
  type Span,
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

/** What a bar's label reads: a value or a range, `signed` for a change written with its sign; null for none. */
type BarReading = { value: number | Span; signed: boolean } | null

/** Bars, which also say what each bar's label reads. */
interface BarMarkKind extends MarkKind {
  /** What each of a series' bars reads, from its values in the data's order. */
  reads: (values: readonly unknown[]) => readonly BarReading[]
}

/** The chart's kind of bar: the one that says what its bars read. */
function barKind(kinds: readonly MarkKind[]): BarMarkKind {
  const kind = kinds.find((kind): kind is BarMarkKind => 'reads' in kind)
  if (!kind) throw new Error('A `Bar` sits in a chart that draws bars.')
  return kind
}

const barMarks: BarMarkKind = {
  mark: 'bar',
  stacks: true,
  // Each bar reads its own value, or its range.
  reads: (values) =>
    values.map((raw) => {
      const range = rangeOf(raw)
      if (range) return { value: range, signed: false }
      const value = numberOf(raw)
      return value === null ? null : { value, signed: false }
    }),
  spans: ({ count, valueOf, series, shown, stack, stackOf }) => {
    const spans = seriesSpans(count, valueOf, shown, stack, stackOf)
    return {
      spans: {
        ...spans,
        ...hiddenSpans(count, valueOf, series, shown, stack, stackOf),
      },
      extent: shown.length === 0 ? null : spanExtent(spans),
    }
  },
  // The far end of the row's bars: the tallest, or the stack's top.
  reach: (spans, shown, index, scale) => scale.place(farEnd(spans, shown, index)),
}

/**
 * A bridge's bars: each change runs from the running total before it to the
 * total after, and each row `isTotal` marks stands on the axis
 * (`bridgeSpans`). Bridges never stack. A hidden series sinks into where
 * each of its bars starts, so it leaves from there and comes back to it.
 */
function bridgeMarks(isTotal: readonly boolean[]): BarMarkKind {
  return {
    mark: 'bar',
    stacks: false,
    // A change reads with its sign, and a total reads the running total, given or worked out.
    reads: (values) => {
      const changes = values.map(numberOf)
      const runs = runningTotals(bridgeSpans(changes, isTotal))
      return changes.map((value, at) => {
        if (isTotal[at]) return { value: runs[at] ?? 0, signed: false }
        return value === null ? null : { value, signed: true }
      })
    },
    spans: ({ count, valueOf, series, shown }) => {
      const spans: Record<string, (Span | null)[]> = {}
      for (const key of series) {
        const own = bridgeSpans(
          Array.from({ length: count }, (_, at) => numberOf(valueOf(key, at))),
          isTotal,
        )
        spans[key] = shown.includes(key)
          ? own
          : own.map((span) => span && [span[0], span[0]])
      }
      const reached = Object.fromEntries(shown.map((key) => [key, spans[key] ?? []]))
      return { spans, extent: shown.length === 0 ? null : spanExtent(reached) }
    },
    // The far end of the row's bar: its top, or below zero, its foot.
    reach: (spans, shown, index, scale) => scale.place(farEnd(spans, shown, index)),
  }
}

/**
 * The `[from, to]` of each bar of a bridge, in the data's order: a change
 * runs from the running total before it to the total after it, and a row
 * `isTotal` marks stands on zero, at its own value when it has one, which
 * the run carries on from, or else at the running total. A missing change
 * has no bar, and the run carries on past it.
 */
function bridgeSpans(
  values: readonly (number | null)[],
  isTotal: readonly boolean[],
): (Span | null)[] {
  let run = 0
  return values.map((value, at) => {
    if (isTotal[at]) {
      run = value ?? run
      return [0, run]
    }
    if (value === null) return null
    const span: Span = [run, run + value]
    run += value
    return span
  })
}

/** The running total after each bar of a bridge's `spans`: where its bar ends, or, for a missing change, where the one before ended. */
function runningTotals(spans: readonly (Span | null)[]): number[] {
  let run = 0
  return spans.map((span) => {
    if (span) run = span[1]
    return run
  })
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
 * slot, so the rest close up when one hides. Every slot is as wide at every
 * stop, and at a stop where only some of them have a row (`here`), such as
 * a series' own dated rows beside the chart's, those sit together in the
 * band's middle.
 */
function barBand(
  band: Band,
  key: string,
  bars: readonly string[],
  hidden: readonly string[],
  stack: ChartStack,
  stackOf: (key: string) => string,
  gap: number,
  here: (key: string) => boolean,
): Band {
  const order = bars.filter((k) => k === key || !hidden.includes(k))
  const slotOf = stack === 'none' ? (k: string) => k : stackOf
  const slots = stacksOf(order, slotOf)
  const filled = slots.filter(
    (slot) => slot === slotOf(key) || order.some((k) => slotOf(k) === slot && here(k)),
  )
  return slotBand(band, filled.indexOf(slotOf(key)), filled.length, gap, slots.length)
}

/**
 * The part of `band` the series in `slot` takes when `slots` series sit
 * side by side, `gap` apart as a share of one slot, each as wide as one of
 * `room` slots: with fewer than `room`, the `slots` sit in the band's middle.
 */
function slotBand(
  band: Band,
  slot: number,
  slots: number,
  gap = 0.12,
  room = slots,
): Band {
  if (room <= 1 || slot < 0) return band
  const inner = bandAt(slot, room, { gap, outer: 0 })
  const last = bandAt(slots - 1, room, { gap, outer: 0 })
  const shift = (1 - (last.start + last.size)) / 2
  return {
    start: band.start + (inner.start + shift) * band.size,
    size: inner.size * band.size,
  }
}

export type { BarMarkKind, BarReading }
export {
  barBand,
  barKind,
  barMarks,
  bridgeMarks,
  bridgeSpans,
  farEnd,
  runningTotals,
  slotBand,
}
