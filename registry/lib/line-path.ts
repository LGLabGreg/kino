import {
  curveBumpX,
  curveLinear,
  curveMonotoneX,
  curveStep,
  line as linePath,
} from 'd3-shape'

/*
 * The geometry of a line through a series' points: the path d3-shape draws,
 * any point along it, and how one line moves into another. Points that stay
 * glide to their new place, points that arrive grow out of the old line and
 * points that leave fold into the new one, so a new range reads as the same
 * line stretching rather than a new one. A point may carry a baseline too,
 * which moves with it, for a fill under the line. Every function here is
 * pure: the Line chart, the Area chart, the Bump chart and the Sparkline
 * only draw what it returns.
 */

/** How a line runs between its points: a smooth curve that never overshoots them, straight, or in steps. */
type LineCurve = 'monotone' | 'linear' | 'step'

/**
 * Every way a line can run between its points: a line's own `LineCurve`, or
 * `bump`, an S that leaves each point level and meets the next level, as a
 * bump chart draws a rank changing from one period to the next.
 */
type PathCurve = LineCurve | 'bump'

/** A point of a line: where it sits, as fractions of the plot from its reading start and its top. */
interface LinePoint {
  /** The category's key, or null for a point that only pads a line while it changes. */
  key: string | null
  x: number
  y: number
  /** Where a fill under the point ends, as a fraction of the plot from its top; none for a bare line. */
  base?: number
  /** Whether the line passes through it; a missing value leaves a gap. */
  defined: boolean
}

/** A point in step between two others, `progress` of the way, which may pass 1 when the feel overshoots. */
interface AlignedPoint {
  key: string | null
  from: LinePoint
  to: LinePoint
}

/** Where to look up a point between two of a line's: its place in the line's order, fractional between points. */
type LineSampler = (place: number) => LinePoint

/**
 * The slope d3's monotone curve gives each point, so the line never
 * overshoots a value: the Fritsch-Carlson slopes inside each run of points
 * with values, and each run's ends sloped toward their neighbour. `of`
 * reads the height to slope, the point's `y` unless told otherwise.
 */
function monotoneSlopes(
  points: readonly LinePoint[],
  of: (point: LinePoint) => number = (point) => point.y,
): number[] {
  const slopes = points.map(() => 0)
  const sign = (value: number) => (value < 0 ? -1 : 1)
  let start = 0
  while (start < points.length) {
    while (start < points.length && !points[start]!.defined) start += 1
    let end = start
    while (end + 1 < points.length && points[end + 1]!.defined) end += 1
    const run = points.slice(start, end + 1)
    if (run.length >= 3) {
      for (let at = 1; at < run.length - 1; at += 1) {
        const [p0, p1, p2] = [run[at - 1]!, run[at]!, run[at + 1]!]
        const h0 = p1.x - p0.x
        const h1 = p2.x - p1.x
        const s0 = h0 === 0 ? 0 : (of(p1) - of(p0)) / h0
        const s1 = h1 === 0 ? 0 : (of(p2) - of(p1)) / h1
        const mean = h0 + h1 === 0 ? 0 : (s0 * h1 + s1 * h0) / (h0 + h1)
        slopes[start + at] =
          (sign(s0) + sign(s1)) *
            Math.min(Math.abs(s0), Math.abs(s1), 0.5 * Math.abs(mean)) || 0
      }
      const end2 = (from: LinePoint, to: LinePoint, inner: number) => {
        const h = to.x - from.x
        return h === 0 ? inner : ((3 * (of(to) - of(from))) / h - inner) / 2
      }
      slopes[start] = end2(run[0]!, run[1]!, slopes[start + 1]!)
      slopes[end] = end2(run.at(-2)!, run.at(-1)!, slopes[end - 1]!)
    } else if (run.length === 2) {
      const h = run[1]!.x - run[0]!.x
      const slope = h === 0 ? 0 : (of(run[1]!) - of(run[0]!)) / h
      slopes[start] = slope
      slopes[end] = slope
    }
    start = end + 1
  }
  return slopes
}

/**
 * The height `share` of the way from `low` to `high` as `curve` draws it:
 * a straight line, a step halfway, or the cubic d3's monotone curve draws,
 * whose x runs evenly, with each end's slope.
 */
function heightBetween(
  low: number,
  high: number,
  slopes: readonly [number, number],
  width: number,
  share: number,
  curve: PathCurve,
) {
  if (curve === 'step') return share < 0.5 ? low : high
  if (curve === 'linear') return low + (high - low) * share
  if (curve === 'bump') return bumpHeight(low, high, share)
  const third = width / 3
  const b = low + third * slopes[0]
  const c = high - third * slopes[1]
  const u = 1 - share
  return (
    u * u * u * low +
    3 * u * u * share * b +
    3 * u * share * share * c +
    share ** 3 * high
  )
}

/**
 * The height `share` of the way across from `low` to `high` on the S d3's
 * bump curve draws: a cubic whose two middle points sit halfway across, at
 * the heights of its ends. Its x doesn't run evenly, so the cubic's own
 * place for `share` is found first, by Newton's method: x grows at a rate
 * of at least 0.75 everywhere, so a few steps land on it.
 */
function bumpHeight(low: number, high: number, share: number) {
  // Across the cubic, x is 1.5t - 1.5t² + t³ for its place t.
  let t = Math.min(1, Math.max(0, share))
  for (let step = 0; step < 6; step += 1) {
    const x = 1.5 * t - 1.5 * t * t + t * t * t
    t -= (x - share) / (1.5 - 3 * t + 3 * t * t)
    t = Math.min(1, Math.max(0, t))
  }
  const u = 1 - t
  return low * u * u * (1 + 2 * t) + high * t * t * (3 - 2 * t)
}

/**
 * Looks up any point along `points` as `curve` draws them, by its place in
 * their order: 2.5 is halfway along the curve between the third and the
 * fourth point. A point sampled on the curve stays on it, so a line drawn
 * through samples looks like the line through `points`. Its baseline, if
 * the points have one, is sampled on its own curve the same way.
 */
function sampleLine(points: readonly LinePoint[], curve: PathCurve): LineSampler {
  const slopes = curve === 'monotone' ? monotoneSlopes(points) : []
  const based = points.some((point) => point.base !== undefined)
  const baseOf = (point: LinePoint) => point.base ?? 1
  const baseSlopes = based && curve === 'monotone' ? monotoneSlopes(points, baseOf) : []
  return (place) => {
    const last = points.length - 1
    if (last <= 0) return { ...(points[0] ?? { x: 0, y: 0, defined: false }), key: null }
    const at = Math.min(last, Math.max(0, place))
    const below = Math.min(last - 1, Math.floor(at))
    const low = points[below]!
    const high = points[below + 1]!
    const share = at - below
    const x = low.x + (high.x - low.x) * share
    const defined = share < 0.5 ? low.defined : high.defined
    const joined = low.defined && high.defined
    const along = (from: number, to: number, own: readonly number[]) =>
      joined
        ? heightBetween(
            from,
            to,
            [own[below] ?? 0, own[below + 1] ?? 0],
            high.x - low.x,
            share,
            curve,
          )
        : from + (to - from) * share
    const point: LinePoint = {
      key: null,
      x,
      y: along(low.y, high.y, slopes),
      defined,
    }
    if (based) point.base = along(baseOf(low), baseOf(high), baseSlopes)
    return point
  }
}

/**
 * Pairs a stretch of the old line, from place `from[0]` to `from[1]` in its
 * order, with a stretch of the new one: every point of either gets a
 * partner at the same share of the way along the other, on its curve, so
 * arriving points grow out of the old line and leaving ones fold into the
 * new one. A stretch of one point stays on it, which sits at its `single`
 * end: 1 before the first point the lines share, 0 after the last.
 */
function pairStretch(
  from: readonly [number, number],
  to: readonly [number, number],
  sampleFrom: LineSampler,
  sampleTo: LineSampler,
  toPoints: readonly LinePoint[],
  single: 0 | 1 = 0,
): AlignedPoint[] {
  const shares = ([start, end]: readonly [number, number]) =>
    Array.from({ length: end - start + 1 }, (_, at) =>
      end === start ? single : at / (end - start),
    )
  const toShares = shares(to)
  const all = [...new Set([...toShares, ...shares(from)])].toSorted((a, b) => a - b)
  return all.map((share) => {
    const own = toShares.findIndex((s) => Math.abs(s - share) < 1e-9)
    const target =
      own === -1 ? sampleTo(to[0] + share * (to[1] - to[0])) : toPoints[to[0] + own]!
    return {
      key: own === -1 ? null : target.key,
      from: sampleFrom(from[0] + share * (from[1] - from[0])),
      to: target,
    }
  })
}

/**
 * The points a line moves through from `from` to `to`, both drawn with
 * `curve`. Points in both, matched by key, glide straight to their new
 * place; between two of them, and before the first and after the last, what
 * arrives grows out of the old line and what leaves folds into the new one.
 * With nothing in common, or the order changed, the whole line pairs by
 * order.
 */
function alignLines(
  from: readonly LinePoint[],
  to: readonly LinePoint[],
  curve: PathCurve,
): AlignedPoint[] {
  if (to.length === 0) return []
  if (from.length === 0)
    return to.map((point) => ({ key: point.key, from: point, to: point }))
  const sampleFrom = sampleLine(from, curve)
  const sampleTo = sampleLine(to, curve)
  const pair = (
    fromSpan: readonly [number, number],
    toSpan: readonly [number, number],
    single: 0 | 1 = 0,
  ) => pairStretch(fromSpan, toSpan, sampleFrom, sampleTo, to, single)
  const fromAt = new Map<string, number>()
  from.forEach((point, at) => {
    if (point.key !== null) fromAt.set(point.key, at)
  })
  const anchors: [number, number][] = []
  to.forEach((point, at) => {
    const was = point.key === null ? undefined : fromAt.get(point.key)
    if (was !== undefined) anchors.push([was, at])
  })
  const ordered = anchors.every((pair, at) => at === 0 || pair[0] > anchors[at - 1]![0])
  if (anchors.length === 0 || !ordered)
    return pair([0, from.length - 1], [0, to.length - 1])
  const [firstFrom, firstTo] = anchors[0]!
  const out = pair([0, firstFrom], [0, firstTo], 1)
  for (let at = 1; at < anchors.length; at += 1) {
    const [fromStart, toStart] = anchors[at - 1]!
    const [fromEnd, toEnd] = anchors[at]!
    // Each stretch starts on the anchor the last one ended on, which is there already.
    out.push(...pair([fromStart, fromEnd], [toStart, toEnd]).slice(1))
  }
  const [lastFrom, lastTo] = anchors.at(-1)!
  out.push(...pair([lastFrom, from.length - 1], [lastTo, to.length - 1]).slice(1))
  return out
}

/**
 * A live line's move, its new points rising out of the hold: a point that
 * arrives past the newest one `from` drew starts at its own place along,
 * at that point's value, where the hold carried it, so the line's end
 * only moves up or down as each row lands.
 */
function holdArrivals(
  aligned: readonly AlignedPoint[],
  from: readonly LinePoint[],
): AlignedPoint[] {
  const held = from.findLast((point) => point.defined)
  if (!held) return [...aligned]
  const drawn = new Set(from.map((point) => point.key))
  return aligned.map((point) => {
    if (point.to.x <= held.x || (point.key !== null && drawn.has(point.key))) return point
    const start: LinePoint = { ...point.to, y: held.y }
    if (point.to.base !== undefined) start.base = held.base ?? point.to.base
    return { ...point, from: start }
  })
}

/** The line `progress` of the way through `aligned`, its baselines with it. */
function pointsAt(aligned: readonly AlignedPoint[], progress: number): LinePoint[] {
  return aligned.map(({ key, from, to }) => {
    const point: LinePoint = {
      key,
      x: from.x + (to.x - from.x) * progress,
      y: from.y + (to.y - from.y) * progress,
      defined: progress < 0.5 ? from.defined : to.defined,
    }
    if (from.base !== undefined || to.base !== undefined) {
      const was = from.base ?? 1
      point.base = was + ((to.base ?? 1) - was) * progress
    }
    return point
  })
}

const curves = {
  monotone: curveMonotoneX,
  linear: curveLinear,
  step: curveStep,
  bump: curveBumpX,
} as const

/** A line through `points` in px for a plot `width` by `height`, with a gap at each missing value. */
function pathThrough(
  points: readonly LinePoint[],
  curve: PathCurve,
  width: number,
  height: number,
): string {
  return (
    linePath<LinePoint>()
      .defined((point) => point.defined)
      .x((point) => point.x * width)
      .y((point) => point.y * height)
      .curve(curves[curve])(points) ?? ''
  )
}

/** Straight lines across each gap a missing value leaves, from the point before it to the point after. */
function bridgesThrough(points: readonly LinePoint[], width: number, height: number) {
  const out: string[] = []
  let before: LinePoint | null = null
  let gap = false
  for (const point of points) {
    if (!point.defined) {
      gap = before !== null
      continue
    }
    if (gap && before) {
      out.push(
        `M${before.x * width},${before.y * height}L${point.x * width},${point.y * height}`,
      )
    }
    before = point
    gap = false
  }
  return out.join('')
}

/**
 * A dot for each point with no neighbour to join, such as a value between
 * two missing ones, which a line alone would leave unseen: a zero-length
 * stroke whose round caps make the dot.
 */
function lonePointsThrough(points: readonly LinePoint[], width: number, height: number) {
  return points
    .filter(
      (point, at) =>
        point.defined && !points[at - 1]?.defined && !points[at + 1]?.defined,
    )
    .map((point) => `M${point.x * width},${point.y * height}h0`)
    .join('')
}

/**
 * How high the line through `points` is where it crosses `x`, both as
 * fractions of the plot, as `curve` draws it; null where it isn't drawn.
 * Across a gap, the point on the nearer side counts, if it has a value, so
 * a line's last point can be found past it as its dot can.
 */
function heightAt(
  points: readonly LinePoint[],
  curve: PathCurve,
  x: number,
): number | null {
  const after = points.findIndex((point) => point.x >= x)
  if (after === -1 || after === 0) {
    const end = after === 0 ? points[0] : points.at(-1)
    return end?.defined ? end.y : null
  }
  const low = points[after - 1]!
  const high = points[after]!
  const share = high.x === low.x ? 1 : (x - low.x) / (high.x - low.x)
  if (low.defined && high.defined) return sampleLine(points, curve)(after - 1 + share).y
  const nearer = share < 0.5 ? low : high
  return nearer.defined ? nearer.y : null
}

/** The stretch the lit category keeps bright, from its neighbour before to its neighbour after, as fractions from the reading start; null for none. */
function litSpan(
  centres: readonly number[],
  at: number,
): readonly [number, number] | null {
  const centre = centres[at]
  if (centre === undefined) return null
  return [centres[at - 1] ?? centre, centres[at + 1] ?? centre]
}

/** The points the lit category keeps bright, by place: it and its neighbours; null when nothing steps back. */
function brightSpan(at: number | null, count: number): readonly [number, number] | null {
  if (at === null) return null
  return [Math.max(0, at - 1), Math.min(count - 1, at + 1)]
}

export {
  type AlignedPoint,
  alignLines,
  brightSpan,
  bridgesThrough,
  curves,
  heightAt,
  holdArrivals,
  type LineCurve,
  type LinePoint,
  type LineSampler,
  litSpan,
  lonePointsThrough,
  monotoneSlopes,
  pathThrough,
  type PathCurve,
  pointsAt,
  sampleLine,
}
