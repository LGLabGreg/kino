import { runningTransitions, startRun, withoutTransition } from '@/registry/lib/resize'
import { type RefObject, useLayoutEffect, useRef } from 'react'

const registered = new Set<string>()

/**
 * Registers custom properties, so a transition can run them or so they
 * don't inherit. Once per page for each name.
 */
export function registerProperties(properties: readonly PropertyDefinition[]) {
  if (typeof CSS === 'undefined' || !('registerProperty' in CSS)) return
  for (const property of properties) {
    if (registered.has(property.name)) continue
    registered.add(property.name)
    try {
      CSS.registerProperty(property)
    } catch (error) {
      // A second copy of this file on the page has registered it already.
      if (!(error instanceof DOMException && error.name === 'InvalidModificationError')) {
        throw error
      }
    }
  }
}

/** Registers `name` as a number from 0 to 1 that a transition can run, resting at 1. */
export function registerProgress(name: string) {
  registerProperties([{ name, syntax: '<number>', inherits: false, initialValue: '1' }])
}

/** How far `element`'s progress `name` is, read from its transition; 1 once nothing runs it. */
export function progressOf(element: Element, name: string): number {
  const value = Number.parseFloat(getComputedStyle(element).getPropertyValue(name))
  return Number.isFinite(value) ? value : 1
}

/**
 * Runs `element`'s progress `name` from 0 to 1 on its own transition, and
 * calls `frame` with it every frame, then with 1 and `done`. A run started
 * later on the same element ends this one. With no transition, as under
 * reduced motion, it calls `frame` with 1 at once. Kept outside components:
 * the React Compiler drops a forced style read written inside one.
 */
export function runProgress(
  element: HTMLElement | SVGElement,
  name: string,
  frame: (progress: number, done: boolean) => void,
) {
  const latest = startRun(element)
  withoutTransition(element, () => element.style.setProperty(name, '0'))
  element.style.setProperty(name, '1')
  const step = () => {
    if (!latest()) return
    if (runningTransitions(element, { property: name }).length === 0) {
      frame(1, true)
      return
    }
    frame(progressOf(element, name), false)
    requestAnimationFrame(step)
  }
  step()
}

/** Ends the run on `element`, if any, where it is. */
export function stopProgress(element: Element) {
  startRun(element)
}

/** How a set of points moves on a progress: what pairs them up, and where they are part way. */
export interface PointsMove<Point, Moves> {
  /** Matches the points drawn now, `from`, with those they move to. */
  align: (from: readonly Point[], to: readonly Point[]) => Moves
  /** Where the points are `progress` of the way through `moves`. */
  at: (moves: Moves, progress: number) => readonly Point[]
  /** Draws the points; `moving` while a move is under way. */
  draw: (points: readonly Point[], moving: boolean) => void
}

/**
 * Moves a set of points, such as a line's or a shape's, to `to` whenever
 * they change, `signature` telling one set from the next: from wherever
 * they are drawn, even halfway through a move, on the frames of the
 * progress `name` on `element`. The first set, and any before the chart
 * has painted, are drawn where they are; with none drawn yet, a move starts
 * from `start`. A new `redraw` alone, such as a new size, draws again at
 * once, mid-move too.
 */
export function usePointsMove<Point, Moves>(
  element: RefObject<HTMLElement | SVGElement | null>,
  name: string,
  to: readonly Point[],
  signature: string,
  start: readonly Point[],
  redraw: string,
  move: PointsMove<Point, Moves>,
) {
  // The move under way, or the last: its points matched up, and where it goes.
  const state = useRef<{ moves: Moves; to: readonly Point[] } | null>(null)
  const mounting = useRef(true)
  const latest = useRef(move)
  useLayoutEffect(() => {
    latest.current = move
  })
  const moving = (node: Element) =>
    runningTransitions(node, { property: name }).length > 0
  useLayoutEffect(() => {
    const atMount = mounting.current
    mounting.current = false
    const node = element.current
    const was = state.current
    // Points not drawn, while the chart loads or is empty, start again from `start`.
    if (!node || to.length === 0) {
      if (node) stopProgress(node)
      state.current = null
      return
    }
    // From where they are drawn mid-move; at rest from where they went, so the points that came
    // in only to grow or fold a part don't stay and pile up from move to move.
    const shown = !was
      ? []
      : moving(node)
        ? latest.current.at(was.moves, progressOf(node, name))
        : was.to
    const moves = latest.current.align(shown.length > 0 ? shown : start, to)
    state.current = { moves, to }
    // A chart that loads with its data shows its points where they are, with no move, until it
    // has painted: the value axis may still settle on its ticks as the page hydrates.
    if (atMount || !node.closest('[data-mounted]')) {
      stopProgress(node)
      latest.current.draw(to, false)
      return
    }
    runProgress(node, name, (progress, done) =>
      done
        ? latest.current.draw(to, false)
        : latest.current.draw(latest.current.at(moves, progress), true),
    )
    return () => stopProgress(node)
    // The points are compared by their signature, so a new array of the same points moves nothing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature])
  // A new `redraw` with no new points draws where they are: on their way, mid-move.
  useLayoutEffect(() => {
    const node = element.current
    const under = node && moving(node) ? state.current : null
    if (node && under)
      latest.current.draw(latest.current.at(under.moves, progressOf(node, name)), true)
    else latest.current.draw(to, false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [redraw])
}
