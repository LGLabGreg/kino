'use client'

import {
  edgeAt,
  glideTo,
  heldAt,
  layerOffset,
  LIVE_HORIZON,
  liveKeyframes,
  liveRows,
  type LiveTrajectory,
  nextAnchor,
  paceAt,
  quietDelay,
  restingEdge,
  restOf,
  running,
  settle,
  speedAt,
} from '@/registry/lib/chart-live'
import type { ChartDatum, ReadingDirection } from '@/registry/lib/chart-math'
import { liveNow, liveRate } from '@/registry/lib/live'
import { reducesMotion } from '@/registry/lib/reduce-motion'
import { PAGE_TIME, roleDuration } from '@/registry/lib/resize'
import {
  type ReactNode,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'

import { cn } from '@/lib/utils'

/*
 * A chart whose x is a window of time: still, ending at its newest row, or
 * live, ending at now and scrolling with the clock. Rows are drawn at their
 * own times against an anchor; every layer placed by x, such as a series,
 * the lit marks and the x axis's ticks, sits in a `ChartLiveLayer`, which
 * plays the clock's trajectory as a Web Animation with the same keyframes
 * and the same current time as every other, so they move as one on the
 * compositor and a row that arrives moves nothing.
 */

/** What the parts of a chart with a window of time read. */
interface ChartLive {
  /** How much time the plot shows, in ms. */
  window: number
  /** The time at the start of the layer the rows are drawn in. */
  anchor: number
  /** Whether the plot's end runs with the clock now: live, and not paused. */
  running: boolean
  /**
   * Whether the rows a series is drawn from are still arriving: false once
   * none has for a couple of that dataset's usual gaps.
   */
  fresh: (series: string) => boolean
  /** Gives a layer placed by x the clock's moves; a ref. */
  layer: (element: HTMLElement | null) => (() => void) | undefined
  /** How far the layer has moved toward the reading start right now, in plot widths, read from the clock. */
  offset: () => number
  /** Holds the plot still while something on it is lit, and lets it go. */
  hold: (held: boolean) => void
}

interface LiveClockInput {
  /** Whether the x is a window of time at all. */
  window: number | null
  live: boolean
  paused: boolean
  /**
   * Each dataset's rows, by its key: the chart's own, then each series'
   * that brings its own, keyed by the series. Every row has its time under
   * the chart's `index`.
   */
  datasets: readonly { key: string; rows: readonly ChartDatum[] }[]
  /** A row's time, in ms. */
  timeOf: (row: ChartDatum) => number
  root: RefObject<HTMLElement | null>
  plot: RefObject<HTMLElement | null>
  direction: ReadingDirection
}

interface Rows {
  data: readonly ChartDatum[]
  /** The rows drawn: the data, and those it let go that can still show. */
  drawn: readonly ChartDatum[]
}

/** Each dataset's rows, by its key. */
type KeptRows = ReadonlyMap<string, Rows>

/** Where the clock is, as the chart draws it. */
interface ClockSnapshot {
  /** The time at the start of the layer the rows are drawn in. */
  anchor: number
  /** Where the plot's end rests while it holds still, or null while it runs with the clock. */
  still: number | null
  /** Whether something on the plot is lit, which holds it still. */
  held: boolean
}

/** The layers' moves: the trajectory they play, rows drawn against which anchor, and the clock they keep. */
interface Motion {
  trajectory: LiveTrajectory
  anchor: number
  /** The window and direction its keyframes were made for. */
  window: number
  direction: ReadingDirection
  keyframes: Keyframe[]
  duration: number
  /** A clock that keeps the trajectory's time on the page's clock, slowed where the page is slowed. */
  master: Animation | null
}

/**
 * The clock of one chart, outside React: the Web Animations its layers play
 * and where it is, which the chart reads as an external store, so a move
 * the clock makes is told to React the way any outside change is.
 */
function createClock(start: ClockSnapshot) {
  let snapshot = start
  const listeners = new Set<() => void>()
  const layers = new Map<HTMLElement, Animation | null>()
  let motion: Motion = {
    trajectory: heldAt(start.still ?? 0),
    anchor: start.anchor,
    window: 0,
    direction: 'ltr',
    keyframes: [],
    duration: Number.POSITIVE_INFINITY,
    master: null,
  }
  // The trajectory to play once the anchor it was worked out for has drawn.
  let pending: { trajectory: LiveTrajectory; anchor: number } | null = null

  const play = (element: HTMLElement) => {
    const animation = element.animate(motion.keyframes, {
      duration: motion.duration,
      fill: 'both',
      id: PAGE_TIME,
    })
    if (motion.master) {
      animation.playbackRate = motion.master.playbackRate
      animation.startTime = motion.master.startTime
    }
    return animation
  }
  const clockTime = () => Number(motion.master?.currentTime ?? 0)
  const commit = (next: Partial<ClockSnapshot>) => {
    snapshot = { ...snapshot, ...next }
    for (const listener of listeners) listener()
  }

  return {
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    get: () => snapshot,
    commit,
    motion: () => motion,
    clockTime,
    /** Where the plot's end is now, read from the clock. */
    edge: () => edgeAt(motion.trajectory, clockTime()),
    /** Plays `trajectory` on every layer, from now on its clock, for rows drawn against `anchor`. */
    apply: (
      figure: HTMLElement,
      trajectory: LiveTrajectory,
      anchor: number,
      window: number,
      direction: ReadingDirection,
    ) => {
      const { keyframes, duration } = liveKeyframes(trajectory, anchor, window, direction)
      motion.master?.cancel()
      const master = figure.animate([], {
        duration,
        fill: 'both',
        id: PAGE_TIME,
      })
      master.playbackRate = liveRate()
      // Every layer starts on the same frame as the clock, so they move as one.
      master.startTime = document.timeline.currentTime
      motion = { trajectory, anchor, window, direction, keyframes, duration, master }
      for (const [element, animation] of layers) {
        animation?.cancel()
        layers.set(element, play(element))
      }
    },
    /** Plays `trajectory` once rows are drawn against `anchor`, moving the anchor there. */
    defer: (
      trajectory: LiveTrajectory,
      anchor: number,
      next: Partial<ClockSnapshot> = {},
    ) => {
      pending = { trajectory, anchor }
      commit({ ...next, anchor })
    },
    /** The trajectory waiting on `anchor`, taken, or null; true while one waits on another. */
    take: (anchor: number) => {
      if (!pending) return null
      if (pending.anchor !== anchor) return true
      const waiting = pending
      pending = null
      return waiting.trajectory
    },
    /** Gives a layer placed by x the clock's moves; a ref. */
    layer: (element: HTMLElement | null) => {
      if (!element) return undefined
      layers.set(element, motion.master ? play(element) : null)
      return () => {
        layers.get(element)?.cancel()
        layers.delete(element)
      }
    },
    hold: (held: boolean) => {
      if (snapshot.held !== held) commit({ held })
    },
    cancel: () => {
      motion.master?.cancel()
      for (const animation of layers.values()) animation?.cancel()
    },
  }
}

type Timer = ReturnType<typeof setTimeout>

/** Whether two lists hold the same rows, as a chart that makes its rows again each render gives. */
function sameRows(a: readonly ChartDatum[], b: readonly ChartDatum[]) {
  return a.length === b.length && a.every((row, at) => row === b[at])
}

/**
 * The rows each dataset draws, kept as the window asks: the data, and the
 * rows each let go that still show past `from`, the plot's start. The same
 * map while no dataset changed.
 */
function keptRows(
  kept: KeptRows,
  datasets: LiveClockInput['datasets'],
  timeOf: (row: ChartDatum) => number,
  from: number | null,
): KeptRows {
  const changed = datasets.some(({ key, rows }) => {
    const was = kept.get(key)
    return !was || (was.data !== rows && !sameRows(was.data, rows))
  })
  if (!changed && kept.size === datasets.length) return kept
  return new Map(
    datasets.map(({ key, rows }) => {
      const was = kept.get(key)
      if (was && (was.data === rows || sameRows(was.data, rows))) return [key, was]
      return [
        key,
        {
          data: rows,
          drawn: from === null || !was ? rows : liveRows(was.drawn, rows, timeOf, from),
        },
      ]
    }),
  )
}

/** The newest time among `datasets`' rows, or null with none. */
function newestOf(
  datasets: LiveClockInput['datasets'],
  timeOf: (row: ChartDatum) => number,
): number | null {
  let newest: number | null = null
  for (const { rows } of datasets) {
    const last = rows.at(-1)
    if (last !== undefined) newest = Math.max(newest ?? -Infinity, timeOf(last))
  }
  return newest
}

/**
 * The window of a chart whose x is times: the rows each dataset draws, the
 * window its x scale shows, and, with a `window`, what its layers read. The
 * plot's newest edge is the newest time of any dataset. Null with no
 * window.
 */
function useLiveClock({
  window,
  live,
  paused,
  datasets,
  timeOf,
  root,
  plot,
  direction,
}: LiveClockInput): {
  datasets: ReadonlyMap<string, readonly ChartDatum[]>
  scaleWindow: { from: number; length: number; through: number } | null
  live: ChartLive | null
} {
  const length = window ?? 0
  const newest = newestOf(datasets, timeOf)
  const [clock] = useState(() =>
    createClock({ anchor: (newest ?? 0) - length, still: newest ?? 0, held: false }),
  )
  const { anchor, still, held } = useSyncExternalStore(
    clock.subscribe,
    clock.get,
    clock.get,
  )
  const [kept, setKept] = useState<KeptRows>(() =>
    keptRows(new Map(), datasets, timeOf, null),
  )
  // Where the plot starts now, or later: while it runs, never before its newest row's window.
  const next =
    window === null
      ? kept
      : keptRows(kept, datasets, timeOf, (still ?? newest ?? 0) - length)
  if (next !== kept) setKept(next)
  // How far the ticks reach past the newest row, so the plot never scrolls past them.
  const [ahead, setAhead] = useState(0)
  const through = Math.max(ahead, (newest ?? 0) + length)
  // Each dataset's data no row has followed for a while, which makes its stream quiet until a
  // row comes.
  const [quietAfter, setQuietAfter] = useState<
    ReadonlyMap<string, readonly ChartDatum[]>
  >(() => new Map())

  const runs = live && !paused && !held
  const isRunning = still === null

  // Starts, pauses, resumes and stops the clock, steps a still window on to newer rows, and plays
  // a trajectory waiting on its anchor.
  useLayoutEffect(() => {
    if (window === null) return
    const figure = root.current
    if (!figure) return
    const waiting = clock.take(anchor)
    if (waiting === true) return
    if (waiting) {
      clock.apply(figure, waiting, anchor, length, direction)
      return
    }
    const reduced = reducesMotion(figure)
    // A role's time, on the page's clock: slowed once, by the clock, when the page is slowed.
    const glide = reduced ? 0 : roleDuration(figure, 'layout', 0) * liveRate()
    if (runs && !isRunning) {
      const now = liveNow()
      const from = still ?? now
      // Rows far from now, or none yet, start the window at now rather than glide across.
      const far = Math.abs(now - from) > length
      const trajectory = reduced
        ? heldAt(now)
        : glideTo(far ? now : from, 0, now, glide, length * LIVE_HORIZON)
      clock.defer(trajectory, far ? now - length : anchor, { still: null })
      return
    }
    if (!runs && isRunning) {
      const edge = clock.edge()
      const width = plot.current?.clientWidth ?? 0
      const trajectory =
        live || reduced
          ? heldAt(
              restingEdge(edge, anchor, length, width, globalThis.devicePixelRatio || 1),
            )
          : settle(edge, speedAt(clock.motion().trajectory, clock.clockTime()), glide)
      clock.apply(figure, trajectory, anchor, length, direction)
      clock.commit({ still: edgeAt(trajectory, Number.POSITIVE_INFINITY) })
      return
    }
    if (!isRunning && !live && newest !== null && newest > still) {
      // A still window steps on to newer rows, never back.
      clock.defer(heldAt(newest), newest - length, { still: newest })
      return
    }
    if (!isRunning && clock.motion().master === null) {
      // The first paint's still window, as the server drew it.
      clock.apply(figure, heldAt(still), anchor, length, direction)
    }
  }, [
    clock,
    window,
    runs,
    isRunning,
    anchor,
    still,
    newest,
    live,
    length,
    direction,
    root,
    plot,
  ])

  // A new window, or direction, remakes the layers' moves from where they are: the plot keeps
  // its end and changes how much it shows, or turns round.
  useLayoutEffect(() => {
    const figure = root.current
    const motion = clock.motion()
    if (!figure || !motion.master) return
    if (motion.window === length && motion.direction === direction) return
    clock.apply(
      figure,
      restOf(motion.trajectory, clock.clockTime()),
      motion.anchor,
      length,
      direction,
    )
  }, [clock, direction, length, root])

  // While it runs: steps to now on each row where motion is reduced, moves the anchor on each
  // window, checked at each row and each time the ticks reach on, and catches up a clock that has fallen behind the page's, as after a sleep.
  useLayoutEffect(() => {
    if (window === null || !isRunning) return
    const figure = root.current
    if (!figure || clock.take(anchor) === true) return
    const now = liveNow()
    if (reducesMotion(figure)) {
      clock.apply(figure, heldAt(now), anchor, length, direction)
      return
    }
    const edge = clock.edge()
    const pace = paceAt(clock.motion().trajectory, clock.clockTime())
    if (pace !== null && Math.abs(now - pace) > length / 4) {
      clock.defer(running(now, length * LIVE_HORIZON), now - length)
      return
    }
    const next = nextAnchor(anchor, edge, length)
    if (next !== anchor) clock.defer(running(edge, length * LIVE_HORIZON), next)
  }, [clock, window, isRunning, kept, through, anchor, length, direction, root])

  // A stream that goes quiet for a couple of its own usual gaps is no longer fresh: each
  // dataset's timer runs from its own last row, whatever the others do.
  const timers = useRef(new Map<string, { data: readonly ChartDatum[]; timer: Timer }>())
  useEffect(() => {
    const running = timers.current
    for (const [key, { timer }] of running) {
      if (window === null || !live || kept.get(key)?.data !== running.get(key)?.data) {
        clearTimeout(timer)
        running.delete(key)
      }
    }
    if (window === null || !live) return
    for (const [key, { data }] of kept) {
      if (running.has(key)) continue
      const timer = setTimeout(
        () => setQuietAfter((was) => new Map(was).set(key, data)),
        quietDelay(data.map(timeOf), length) / liveRate(),
      )
      running.set(key, { data, timer })
    }
    // `timeOf` reads the row's time key, which a new function for the same key leaves alone.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [window, live, kept, length])
  useEffect(() => {
    const running = timers.current
    return () => {
      for (const { timer } of running.values()) clearTimeout(timer)
      running.clear()
    }
  }, [])

  // While it runs with no rows coming, its ticks reach on ahead of the plot's end.
  useEffect(() => {
    if (window === null || !isRunning) return
    const timer = setInterval(
      () => setAhead((was) => Math.max(was, liveNow() + 2 * length)),
      Math.max(250, length / 2),
    )
    return () => clearInterval(timer)
  }, [window, isRunning, length])

  useEffect(() => () => clock.cancel(), [clock])

  const drawn = new Map(
    datasets.map(({ key, rows }) => [
      key,
      window === null ? rows : (next.get(key)?.drawn ?? rows),
    ]),
  )
  if (window === null) return { datasets: drawn, scaleWindow: null, live: null }
  // A series with no rows of its own is drawn from the chart's, the first dataset.
  const datasetOf = (series: string) =>
    next.has(series) ? series : (datasets[0]?.key ?? series)
  return {
    datasets: drawn,
    scaleWindow: { from: anchor, length, through },
    live: {
      window: length,
      anchor,
      running: isRunning,
      fresh: (series) => {
        const key = datasetOf(series)
        const data = next.get(key)?.data
        return data !== undefined && quietAfter.get(key) !== data
      },
      layer: clock.layer,
      offset: () => layerOffset(clock.edge(), clock.motion().anchor, length),
      hold: clock.hold,
    },
  }
}

/**
 * How many plots wide a live layer's own boxes are, such as a series' masked
 * parts or its bars' clips: a mask or a clip hides what is past its own box,
 * and the layer they move in draws rows up to two plots past its start
 * before the anchor moves on.
 */
const LIVE_SPAN = 3

/** How far a layer reaches past the plot, on each side, and its moving box's insets within it. */
const reaches = {
  // Past its top, bottom and end by the room the frame keeps for a dot there.
  room: { outer: '-inset-y-2 start-0 -end-2', inner: 'inset-y-2 start-0 end-2' },
  // To the plot's end, as what runs on to it does.
  plot: { outer: '-inset-y-2 start-0 end-0', inner: 'inset-y-2 start-0 end-0' },
  // Above the plot too, by a label's room, as a reference line's label sits there.
  label: {
    outer: '-top-8 -bottom-2 start-0 -end-2',
    inner: 'top-8 bottom-2 start-0 end-2',
  },
}

/** Where a layer fades over `--chart-live-fade`: at its reading start, where what leaves goes, or at both ends, as labels that arrive at the plot's end, wider than the room past it, do. */
const fades = {
  start: {
    ltr: '[mask-image:linear-gradient(to_right,transparent,black_var(--chart-live-fade,2rem))]',
    rtl: '[mask-image:linear-gradient(to_left,transparent,black_var(--chart-live-fade,2rem))]',
  },
  // The same both ways round.
  ends: {
    ltr: '[mask-image:linear-gradient(to_right,transparent,black_var(--chart-live-fade,2rem),black_calc(100%-var(--chart-live-fade,2rem)),transparent)]',
    rtl: '[mask-image:linear-gradient(to_right,transparent,black_var(--chart-live-fade,2rem),black_calc(100%-var(--chart-live-fade,2rem)),transparent)]',
  },
}

/**
 * A layer placed by x, on a chart with a window of time: clipped to the
 * plot and as far past it as `reach` says, fading as `fade` says, and moved
 * with the clock. Its children as they are on any other chart.
 */
function ChartLiveLayer({
  live,
  direction,
  reach = 'room',
  fade = 'start',
  className,
  children,
}: {
  live: ChartLive | null
  direction: ReadingDirection
  reach?: keyof typeof reaches
  fade?: keyof typeof fades
  className?: string
  children: ReactNode
}) {
  if (!live) return children
  const { layer } = live
  // The mask shows only what is inside its box.
  return (
    <div
      data-slot='chart-live-layer'
      className={cn('absolute', reaches[reach].outer, fades[fade][direction], className)}
    >
      <div ref={layer} className={cn('absolute', reaches[reach].inner)}>
        {children}
      </div>
    </div>
  )
}

export { type ChartLive, ChartLiveLayer, keptRows, LIVE_SPAN, useLiveClock }
