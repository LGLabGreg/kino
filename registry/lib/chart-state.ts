/*
 * The chart root's logic, as pure functions: what it shows, what it points
 * at, what is leaving, what its data table holds and how long a move runs.
 * It knows nothing about categories, bands or axes: each family of charts
 * turns its own shapes into these.
 */

/**
 * What the pointer, the focus or the keys are on, held by key so new data
 * keeps it: every series at one x, one series' point, or one node, such as
 * a tile, an arc, a flow or a cell.
 */
export type ChartTarget =
  | { kind: 'x'; key: string }
  | { kind: 'datum'; series: string; key: string }
  | { kind: 'node'; id: string }

/** The key a target is held by among its family's items. */
export function targetKey(target: ChartTarget): string {
  return target.kind === 'node' ? target.id : target.key
}

/** Whether two targets are on the same thing. */
export function sameTarget(a: ChartTarget | null, b: ChartTarget | null): boolean {
  if (a === null || b === null) return a === b
  if (a.kind !== b.kind || targetKey(a) !== targetKey(b)) return false
  return a.kind !== 'datum' || (b.kind === 'datum' && a.series === b.series)
}

/** The series a target brings forward: a point's own; none for the rest. */
export function targetSeries(target: ChartTarget | null): string | null {
  return target?.kind === 'datum' ? target.series : null
}

/** What the chart shows in place of its data. */
export type ChartStatus = 'loading' | 'error' | 'empty' | 'hidden' | 'ready'

/**
 * What the chart shows: its placeholder while it loads, the error, a note
 * that there is no data, a way back when every series is hidden, or its
 * marks. `rows` counts the data, `shown` the series not hidden and `drawn`
 * the rows still drawn with them hidden.
 */
export function chartStatus({
  placeholder,
  loading,
  failed,
  rows,
  shown,
  drawn,
}: {
  placeholder: boolean
  loading: boolean
  failed: boolean
  rows: number
  shown: number
  drawn: number
}): ChartStatus {
  if (placeholder || (loading && rows === 0)) return 'loading'
  if (failed) return 'error'
  if (rows === 0) return 'empty'
  if (shown === 0 || drawn === 0) return 'hidden'
  return 'ready'
}

/**
 * What is leaving once `current` replaces `previous`: what was leaving and
 * hasn't come back, and what `previous` had that `current` doesn't, each
 * once, by its key. What comes back stops leaving.
 */
export function leavingAfter<T>(
  previous: readonly T[],
  current: readonly T[],
  leaving: readonly T[],
  keyOf: (item: T) => string,
): T[] {
  const now = new Set(current.map(keyOf))
  const seen = new Set<string>()
  const out: T[] = []
  for (const item of [...leaving, ...previous]) {
    const key = keyOf(item)
    if (now.has(key) || seen.has(key)) continue
    seen.add(key)
    out.push(item)
  }
  return out
}

/** Where `key` is among `keys`, or null when it is gone or there is none. */
export function indexOfKey(keys: readonly string[], key: string | null): number | null {
  if (key === null) return null
  const at = keys.indexOf(key)
  return at === -1 ? null : at
}

/** One row of a chart's data table: what names it, and its cells. */
export interface ChartTableRow {
  key: string
  name: string
  cells: readonly string[]
}

/**
 * A chart's data, for screen readers: the first column's title, the
 * columns after it, a row for each item, and a last row of totals, which is
 * empty for a chart without one.
 */
export interface ChartTable {
  header: string
  columns: readonly string[]
  rows: readonly ChartTableRow[]
  footer: readonly string[]
}

/** How a move runs: its role's duration, then its cascade's, in ms, on the role's easing. */
export interface MoveTiming {
  duration: number
  endDelay: number
  easing: string
}

/**
 * The timing of a move on a role that runs `role` (its duration in ms and
 * easing, or null when it doesn't run, as when a feel gives it none), whose
 * marks start one after another over `span` of that duration. Null when
 * nothing moves, so the move ends at once.
 */
export function moveTiming(
  role: { duration: number; easing: string } | null,
  span: number,
): MoveTiming | null {
  if (!role || !(role.duration > 0)) return null
  return {
    duration: role.duration,
    endDelay: role.duration * Math.max(0, span),
    easing: role.easing,
  }
}

/**
 * How far along its way a mark that redraws is, `progress` through the
 * move: all the way at once where motion is reduced, since travel goes and
 * only fades stay.
 */
export function travelOf(progress: number | null, reduced: boolean): number {
  if (reduced || progress === null) return 1
  return progress
}

/** A CSS time, such as `0.45s` or `450ms`, in ms; null for one that isn't. */
export function durationOf(time: string): number | null {
  const value = Number.parseFloat(time)
  if (!Number.isFinite(value)) return null
  const trimmed = time.trim()
  if (trimmed.endsWith('ms')) return value
  if (trimmed.endsWith('s')) return value * 1000
  return null
}

/**
 * The focus a chart shows: yours when you pass one, keeping the series the
 * chart's own focus had on the same key; else, in a group, its own focus on
 * a node, such as a tile, which no other chart holds, or the group's key,
 * the same way; else its own.
 */
export function resolveFocus(
  own: ChartTarget | null,
  yours: ChartTarget | null | undefined,
  group: string | null | undefined,
): ChartTarget | null {
  const keep = (key: string) =>
    own !== null && own.kind !== 'node' && own.key === key ? own : null
  if (yours !== undefined) {
    if (yours === null) return null
    return yours.kind === 'node' ? yours : (keep(yours.key) ?? yours)
  }
  if (group !== undefined) {
    if (own?.kind === 'node') return own
    return group === null ? null : (keep(group) ?? { kind: 'x', key: group })
  }
  return own
}
