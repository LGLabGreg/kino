import type { ChartDatum } from '@/registry/lib/chart-math'
import type {
  ChartItem,
  ChartPoint,
  ChartReader,
  PlotPoint,
} from '@/registry/lib/chart-root'
import type { ChartTable, ChartTarget } from '@/registry/lib/chart-state'
import type { ReactNode } from 'react'

/*
 * The flow family's reader: charts of nodes and the flows between them, such
 * as a Sankey. Every node and flow is a target the pointer finds and the
 * tooltip shows; the keys walk the nodes only, the chart's own way, and from
 * a flow the pointer lit they start at its source.
 */

/** A node or a flow, as the chart's API counts it. */
type FlowStop =
  | { kind: 'node'; key: string; name: string; value: number; index: number }
  | {
      kind: 'link'
      key: string
      source: string
      target: string
      value: number
      datum: ChartDatum
      index: number
    }

interface FlowReaderInput {
  /** Every node, then every link, in the data's order: what `activeIndex` counts. */
  items: readonly FlowStop[]
  /** The nodes in the order they are drawn: what the keys reach and the slider counts. */
  drawnOrder: readonly string[]
  /** The node a key goes to from the node keyed `from`, or null for a key the chart doesn't take. */
  step: (from: string, key: string) => string | null
  hit: (point: PlotPoint) => FlowStop | null
  anchor: (stop: FlowStop) => ChartPoint | null
  words: {
    describe: (stop: FlowStop) => string
    tooltip: (stop: FlowStop) => ReactNode
    table: ChartTable
  }
}

/** What the chart's parts read of a stop, such as its tooltip's heading: a link's row, and no row for a node. */
function flowItem(stop: FlowStop): ChartItem {
  return {
    key: stop.key,
    value: stop.key,
    datum: stop.kind === 'link' ? stop.datum : null,
    index: stop.index,
  }
}

function flowTarget(key: string): ChartTarget {
  return { kind: 'node', id: key }
}

/** The node the keys go on from: the node itself, or a flow's source. */
function nodeFrom(stop: FlowStop) {
  return stop.kind === 'node' ? stop.key : stop.source
}

/**
 * The reader of a chart of flows: each node and flow is a node target held
 * by its key, lighting no series. The keys reach the nodes in `drawnOrder`,
 * which the slider counts.
 */
function flowReader(input: FlowReaderInput): ChartReader {
  const { items, drawnOrder, words } = input
  const byKey = new Map(items.map((stop) => [stop.key, stop]))
  const stopOf = (target: ChartTarget) =>
    target.kind === 'node' ? (byKey.get(target.id) ?? null) : null
  const first = drawnOrder.find((key) => byKey.get(key)?.kind === 'node')
  return {
    holds: (target) => stopOf(target) !== null,
    lights: () => null,
    item: (target) => {
      const stop = stopOf(target)
      return stop ? flowItem(stop) : null
    },
    items: items.map((stop) => flowTarget(stop.key)),
    browse: {
      targetAt: (point) => {
        const stop = input.hit(point)
        return stop ? flowTarget(stop.key) : null
      },
      start: first === undefined ? null : flowTarget(first),
      step: (from, key) => {
        const stop = stopOf(from)
        if (!stop) return null
        const next = input.step(nodeFrom(stop), key)
        return next !== null && byKey.has(next) ? flowTarget(next) : null
      },
      rank: (target) => {
        const stop = stopOf(target)
        return stop ? Math.max(1, drawnOrder.indexOf(nodeFrom(stop)) + 1) : 1
      },
      stops: drawnOrder.length,
      // The stops run in one line, so the slider runs across, as on a row of categories.
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

export { flowItem, type FlowReaderInput, flowReader, type FlowStop }
