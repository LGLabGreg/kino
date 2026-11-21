import { runningTransitions, startRun, withoutTransition } from '@/registry/lib/resize'

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
