import {
  type ChartDatum,
  type ReadingDirection,
  stepIndex,
} from '@/registry/lib/chart-math'
import type {
  ChartItem,
  ChartPoint,
  ChartReader,
  PlotPoint,
} from '@/registry/lib/chart-root'
import type { ChartTable, ChartTarget } from '@/registry/lib/chart-state'
import type { ReactNode } from 'react'

/*
 * The tree family's reader: charts whose marks are the nodes of a tree, such
 * as a treemap's tiles. Each node in view is a stop the keys step through in
 * the order the chart gives, depth first, and a group's own place, such as a
 * treemap's header, brings its group forward without being a stop.
 */

/** A node the keys and the tooltip stop at: a tile, an arc, a circle. */
interface TreeStop {
  /** Its key path, joined as `chart-tiles` joins it: unique in the tree. */
  id: string
  /** How it is named, in the tooltip and to a screen reader. */
  name: string
  value: number
  datum: ChartDatum
  /** Its place among the stops, in the order the keys walk. */
  index: number
}

/** What is under the pointer: a stop, a group's own place (a treemap's group header), or nothing. */
type TreeHit = { kind: 'stop'; index: number } | { kind: 'group'; key: string } | null

interface TreeReaderInput {
  /** The nodes in view in the order the keys walk: depth first, a parent before its children. */
  stops: readonly TreeStop[]
  direction: ReadingDirection
  hit: (point: PlotPoint) => TreeHit
  /** What a press at the point zooms to, or null. */
  openAt: (point: PlotPoint) => (() => void) | null
  /** What Enter or Space on the stop zooms to, or null. */
  open: (stop: TreeStop) => (() => void) | null
  /** Escape once nothing is lit: zoom out one level, or null at the whole. */
  back: (() => void) | null
  anchor: (stop: TreeStop) => ChartPoint | null
  words: {
    describe: (stop: TreeStop) => string
    tooltip: (stop: TreeStop) => ReactNode
    table: ChartTable
  }
}

/** What starts a group's own target id: a character no key path holds, so it never meets a stop's. */
const GROUP = '\u0000group:'

/** The target id of the group keyed `key`'s own place, such as a treemap's header. */
function groupTarget(key: string): string {
  return `${GROUP}${key}`
}

/** The key of the group whose own place `target` is, or null for any other target. */
function groupOf(target: ChartTarget): string | null {
  return target.kind === 'node' && target.id.startsWith(GROUP)
    ? target.id.slice(GROUP.length)
    : null
}

/** What the chart's parts read of a stop, such as its tooltip's heading. */
function treeItem(stop: TreeStop): ChartItem {
  return { key: stop.id, value: stop.name, datum: stop.datum, index: stop.index }
}

function stopTarget(stop: TreeStop): ChartTarget {
  return { kind: 'node', id: stop.id }
}

/**
 * The reader of a chart of a tree: each stop is a node target held by its
 * id. The arrows step through the stops in order, as a slider's do, Home
 * and End go to the first and last, Enter and Space open, Escape goes back.
 * A group's own place lights its group and is never a stop.
 */
function treeReader(input: TreeReaderInput): ChartReader {
  const { stops, direction, words } = input
  const byId = new Map(stops.map((stop) => [stop.id, stop]))
  const stopOf = (target: ChartTarget) =>
    target.kind === 'node' ? (byId.get(target.id) ?? null) : null
  // What a press under the pointer opens, by the target it found, so the press opens it.
  const opens = new WeakMap<ChartTarget, () => void>()
  const first = stops[0]
  return {
    holds: (target) => stopOf(target) !== null,
    lights: groupOf,
    item: (target) => {
      const stop = stopOf(target)
      return stop ? treeItem(stop) : null
    },
    items: stops.map(stopTarget),
    browse: {
      targetAt: (point) => {
        const hit = input.hit(point)
        const stop = hit?.kind === 'stop' ? stops[hit.index] : undefined
        const target: ChartTarget | null =
          hit === null
            ? null
            : hit.kind === 'group'
              ? { kind: 'node', id: groupTarget(hit.key) }
              : stop
                ? stopTarget(stop)
                : null
        const open = target && input.openAt(point)
        if (target && open) opens.set(target, open)
        return target
      },
      start: first ? stopTarget(first) : null,
      step: (from, key) => {
        const stop = stopOf(from)
        if (!stop) return null
        const next = stepIndex(key, stop.index, stops.length, 'vertical', direction)
        const to = next === null ? undefined : stops[next]
        return to ? stopTarget(to) : null
      },
      rank: (target) => (stopOf(target)?.index ?? 0) + 1,
      stops: stops.length,
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
      open: (target) => {
        const own = opens.get(target)
        if (own) return own
        const stop = stopOf(target)
        return stop ? input.open(stop) : null
      },
      back: input.back,
    },
  }
}

export {
  groupTarget,
  type TreeHit,
  treeItem,
  type TreeReaderInput,
  treeReader,
  type TreeStop,
}
