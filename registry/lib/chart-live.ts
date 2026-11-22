import type { ReadingDirection } from '@/registry/lib/chart-math'

/*
 * The clock of a live chart, as pure maths. The plot shows `window` ms of
 * time and its end runs with the clock, so it scrolls at one speed, a
 * window a window. Where the end is at each moment of the clock is a
 * trajectory: stretches joined with no change of speed, each a cubic over
 * its stretch of the clock, so it plays as one Web Animation whose
 * keyframes ease on the same curves, and the time under the pointer is read
 * from the same function the animation plays. Rows are drawn at their own
 * times against an anchor, so a row that arrives moves nothing else; only
 * the layer that holds them moves.
 */

/**
 * One stretch of the plot end's journey: from the time `from` to `to`
 * (instants, in ms) over `duration` ms of the clock, leaving at
 * `startSpeed` and arriving at `endSpeed`, in ms shown per ms of the clock:
 * 1 runs with real time, 0 is at rest.
 */
interface LiveStretch {
  duration: number
  from: number
  to: number
  startSpeed: number
  endSpeed: number
}

/**
 * Where the plot's end goes from the clock's 0: at `start` there, then
 * along each stretch in turn, and at rest where the last one ends.
 */
interface LiveTrajectory {
  start: number
  stretches: readonly LiveStretch[]
}

/** How far ahead a trajectory that runs with real time reaches, in windows: one is rebuilt long before it runs out. */
const LIVE_HORIZON = 4096

/** At rest at `edge`. */
function heldAt(edge: number): LiveTrajectory {
  return { start: edge, stretches: [] }
}

/** Running with real time from `edge`, for `horizon` ms of the clock. */
function running(edge: number, horizon: number): LiveTrajectory {
  return {
    start: edge,
    stretches: [
      { duration: horizon, from: edge, to: edge + horizon, startSpeed: 1, endSpeed: 1 },
    ],
  }
}

/**
 * From `edge`, going at `speed`, gliding over `duration` ms of the clock to
 * where real time has got to by then, `now` plus `duration`, and arriving
 * at its speed, then running with it for `horizon`: a start from rest, or a
 * resume that catches up the time spent paused. With no `duration`, as
 * where motion is reduced, it is at `now` at once.
 */
function glideTo(
  edge: number,
  speed: number,
  now: number,
  duration: number,
  horizon: number,
): LiveTrajectory {
  if (duration <= 0) return running(now, horizon)
  const arrival = now + duration
  return {
    start: edge,
    stretches: [
      { duration, from: edge, to: arrival, startSpeed: speed, endSpeed: 1 },
      {
        duration: horizon,
        from: arrival,
        to: arrival + horizon,
        startSpeed: 1,
        endSpeed: 1,
      },
    ],
  }
}

/**
 * From `edge`, going at `speed`, slowing evenly to rest over `duration` ms
 * of the clock, which goes half as far as running on would: where a stream
 * that stops comes to rest.
 */
function settle(edge: number, speed: number, duration: number): LiveTrajectory {
  if (duration <= 0 || speed === 0) return heldAt(edge)
  return {
    start: edge,
    stretches: [
      {
        duration,
        from: edge,
        to: edge + (speed * duration) / 2,
        startSpeed: speed,
        endSpeed: 0,
      },
    ],
  }
}

/** How long a trajectory's stretches last on the clock, in ms. */
function trajectoryLength(trajectory: LiveTrajectory) {
  return trajectory.stretches.reduce((total, stretch) => total + stretch.duration, 0)
}

/**
 * Where a stretch is at `share` of its way, 0 to 1: the cubic with its two
 * ends and the speeds at them, the same curve its keyframe's easing draws.
 */
function stretchAt(stretch: LiveStretch, share: number) {
  const s = Math.min(1, Math.max(0, share))
  const { from, to, duration } = stretch
  const m0 = stretch.startSpeed * duration
  const m1 = stretch.endSpeed * duration
  const s2 = s * s
  const s3 = s2 * s
  return (
    (2 * s3 - 3 * s2 + 1) * from +
    (s3 - 2 * s2 + s) * m0 +
    (-2 * s3 + 3 * s2) * to +
    (s3 - s2) * m1
  )
}

/** The stretch the clock is on at `clock` ms, and how far through it, or null past the last. */
function stretchOf(trajectory: LiveTrajectory, clock: number) {
  let begins = 0
  for (const stretch of trajectory.stretches) {
    if (clock < begins + stretch.duration) {
      return {
        stretch,
        share: stretch.duration === 0 ? 1 : (clock - begins) / stretch.duration,
      }
    }
    begins += stretch.duration
  }
  return null
}

/** Where the plot's end is at `clock` ms of the trajectory: held at its start before 0, and at its last stretch's end after. */
function edgeAt(trajectory: LiveTrajectory, clock: number): number {
  if (clock <= 0) return trajectory.start
  const on = stretchOf(trajectory, clock)
  if (on) return stretchAt(on.stretch, on.share)
  return trajectory.stretches.at(-1)?.to ?? trajectory.start
}

/** How fast the plot's end goes at `clock` ms, in ms shown per ms: 0 at rest. */
function speedAt(trajectory: LiveTrajectory, clock: number): number {
  if (clock < 0) return 0
  const on = stretchOf(trajectory, clock)
  if (!on) return 0
  const { stretch, share: s } = on
  if (stretch.duration === 0) return 0
  const m0 = stretch.startSpeed * stretch.duration
  const m1 = stretch.endSpeed * stretch.duration
  // The cubic's slope along its share, over the stretch's length on the clock.
  const slope =
    (6 * s * s - 6 * s) * stretch.from +
    (3 * s * s - 4 * s + 1) * m0 +
    (-6 * s * s + 6 * s) * stretch.to +
    (3 * s * s - 2 * s) * m1
  return slope / stretch.duration
}

/**
 * Where real time has got to at `clock` ms, as a trajectory that runs with
 * it keeps it: its last stretch's time, run on or back at real time; null
 * for one that comes to rest. A plot end that has fallen behind it, as a
 * device that slept leaves it, is far from the page's time.
 */
function paceAt(trajectory: LiveTrajectory, clock: number): number | null {
  const last = trajectory.stretches.at(-1)
  if (!last || last.endSpeed !== 1 || last.to - last.from !== last.duration) return null
  const begins = trajectoryLength(trajectory) - last.duration
  return last.from + (clock - begins)
}

/**
 * The rest of a trajectory from `clock` ms on, as a trajectory of its own
 * from 0: the same journey, since a stretch cut short is the cubic with the
 * place and speed it has there, which is the same curve.
 */
function restOf(trajectory: LiveTrajectory, clock: number): LiveTrajectory {
  if (clock <= 0) return trajectory
  let begins = 0
  for (const [at, stretch] of trajectory.stretches.entries()) {
    if (clock < begins + stretch.duration) {
      const cut: LiveStretch = {
        duration: begins + stretch.duration - clock,
        from: edgeAt(trajectory, clock),
        to: stretch.to,
        startSpeed: speedAt(trajectory, clock),
        endSpeed: stretch.endSpeed,
      }
      return { start: cut.from, stretches: [cut, ...trajectory.stretches.slice(at + 1)] }
    }
    begins += stretch.duration
  }
  return heldAt(edgeAt(trajectory, clock))
}

/**
 * The easing that plays a stretch's cubic between its keyframes: a Bézier
 * whose x runs evenly, so its y is the cubic itself. Even, for a stretch
 * that runs with real time or goes nowhere.
 */
function stretchEasing(stretch: LiveStretch): string {
  const distance = stretch.to - stretch.from
  if (distance === 0) return 'linear'
  const y1 = (stretch.startSpeed * stretch.duration) / (3 * distance)
  const y2 = 1 - (stretch.endSpeed * stretch.duration) / (3 * distance)
  if (Math.abs(y1 - 1 / 3) < 1e-9 && Math.abs(y2 - 2 / 3) < 1e-9) return 'linear'
  return `cubic-bezier(${round(1 / 3)}, ${round(y1)}, ${round(2 / 3)}, ${round(y2)})`
}

function round(value: number) {
  return Math.round(value * 1e6) / 1e6
}

/**
 * How far the layer of a plot whose end is at `edge` has moved toward the
 * reading start, in plot widths, for rows drawn against `anchor`, the time
 * at the layer's start: 0 while the plot shows `window` from the anchor.
 */
function layerOffset(edge: number, anchor: number, window: number): number {
  return window <= 0 ? 0 : (edge - window - anchor) / window
}

/** The translation of a layer `offset` plot widths along, toward the reading start. */
function layerTransform(offset: number, direction: ReadingDirection): string {
  const percent = round(offset * 100)
  return `translateX(${direction === 'rtl' ? percent : -percent}%)`
}

/**
 * The keyframes a layer plays for `trajectory`, rows drawn against
 * `anchor`, and how long they run in ms: one at each join, eased along the
 * stretch it starts. At rest, held there for good.
 */
function liveKeyframes(
  trajectory: LiveTrajectory,
  anchor: number,
  window: number,
  direction: ReadingDirection,
): { keyframes: Keyframe[]; duration: number } {
  const duration = trajectoryLength(trajectory)
  const at = (edge: number) =>
    layerTransform(layerOffset(edge, anchor, window), direction)
  if (duration <= 0) {
    const still = at(trajectory.start)
    return {
      keyframes: [{ transform: still }, { transform: still }],
      duration: Number.POSITIVE_INFINITY,
    }
  }
  const keyframes: Keyframe[] = []
  let begins = 0
  for (const stretch of trajectory.stretches) {
    if (stretch.duration <= 0) continue
    keyframes.push({
      offset: begins / duration,
      transform: at(stretch.from),
      easing: stretchEasing(stretch),
    })
    begins += stretch.duration
  }
  keyframes.push({
    offset: 1,
    transform: at(trajectory.stretches.at(-1)?.to ?? trajectory.start),
  })
  return { keyframes, duration }
}

/**
 * `edge` moved on to the next time at which a layer `width` px wide, at
 * `ratio` device pixels to a px, rests on whole device pixels, so a still
 * plot's text and lines are drawn sharp. Moved on, never back, so the plot
 * doesn't step back as it comes to rest.
 */
function restingEdge(
  edge: number,
  anchor: number,
  window: number,
  width: number,
  ratio: number,
): number {
  const perDevicePixel = window / (width * ratio)
  if (!(perDevicePixel > 0) || !Number.isFinite(perDevicePixel)) return edge
  const along = edge - window - anchor
  // A float a hair past a whole pixel rounds onto it rather than past the next.
  const pixels = Math.ceil(along / perDevicePixel - 1e-6)
  return anchor + window + pixels * perDevicePixel
}

/**
 * The anchor a live chart draws its rows against from now on: the current
 * one while the layer has moved less than a window, so a row that arrives
 * moves nothing, or one a whole number of windows on, so the layer never
 * draws more than a couple of plots' widths and its numbers stay small.
 * Moving it moves every row and the layer by the same whole windows, which
 * shows nothing.
 */
function nextAnchor(anchor: number, edge: number, window: number): number {
  const along = layerOffset(edge, anchor, window)
  if (along >= 0 && along < 1) return anchor
  return anchor + Math.floor(along) * window
}

/**
 * The rows a live chart draws: `data`, and before them the rows it drew
 * that the app has since let go, kept while any of them can still show,
 * so the line runs on to the plot's start. A row is let go once the next
 * row's time is at or before `from`, the time at the plot's start, which
 * only grows while the chart runs.
 */
function liveRows<Row>(
  drawn: readonly Row[],
  data: readonly Row[],
  timeOf: (row: Row) => number,
  from: number,
): Row[] {
  const first = data[0] === undefined ? Number.POSITIVE_INFINITY : timeOf(data[0])
  const kept = drawn.filter((row) => timeOf(row) < first)
  const rows = [...kept, ...data]
  let gone = 0
  while (gone < kept.length) {
    const next = rows[gone + 1]
    if (next === undefined || timeOf(next) > from) break
    gone += 1
  }
  return gone === 0 ? rows : rows.slice(gone)
}

/**
 * The usual gap between rows at `times`, in ms: the median of the last few,
 * so one late or doubled row doesn't move it. Null with fewer than two.
 */
function usualGap(times: readonly number[]): number | null {
  const recent = times.slice(-9)
  const gaps = recent.slice(1).map((time, at) => time - recent[at]!)
  if (gaps.length === 0) return null
  const sorted = gaps.toSorted((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1
    ? sorted[middle]!
    : (sorted[middle - 1]! + sorted[middle]!) / 2
}

export {
  edgeAt,
  glideTo,
  heldAt,
  layerOffset,
  layerTransform,
  LIVE_HORIZON,
  liveKeyframes,
  liveRows,
  type LiveStretch,
  type LiveTrajectory,
  nextAnchor,
  paceAt,
  restingEdge,
  restOf,
  running,
  settle,
  speedAt,
  stretchEasing,
  trajectoryLength,
  usualGap,
}
