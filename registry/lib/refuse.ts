import { runningTransitions } from '@/registry/lib/resize'

/*
 * How a part says no to what the person tried: it swells for a moment and
 * settles back, on the `press` role. The Alert dialog's answer to a press
 * outside, and the Save bar's to leaving with changes unsaved. The part
 * scales on `data-refused`, and holds a still cue (a ring, a colour) on it
 * under reduced motion, where nothing scales.
 */

/** A CSS time, such as a `--motion-press-duration` of `0.3s` or `300ms`, in ms; `fallback` when it is empty or not a time. */
export function cssTime(value: string, fallback: number) {
  const number = Number.parseFloat(value)
  if (!Number.isFinite(number)) return fallback
  return value.trim().endsWith('ms') ? number : number * 1000
}

const refusing = new WeakMap<HTMLElement, () => void>()

/**
 * Marks `element` `data-refused` until its swell has peaked, then lets it
 * settle back. A second no while it swells is the same one. Returns a
 * function that ends it at once.
 */
export function refuse(element: HTMLElement): () => void {
  const running = refusing.get(element)
  if (running) return running
  let timer: ReturnType<typeof setTimeout> | undefined
  const settle = () => {
    if (refusing.get(element) !== settle) return
    refusing.delete(element)
    clearTimeout(timer)
    cancelAnimationFrame(frame)
    element.removeEventListener('transitionend', onTransitionEnd)
    element.removeAttribute('data-refused')
  }
  const onTransitionEnd = (event: TransitionEvent) => {
    if (event.target === element && event.propertyName === 'scale') settle()
  }
  refusing.set(element, settle)
  element.setAttribute('data-refused', '')
  element.addEventListener('transitionend', onTransitionEnd)
  // Under reduced motion nothing scales, so nothing ends: the still cue stays for two presses.
  const frame = requestAnimationFrame(() => {
    if (runningTransitions(element, { property: 'scale' }).length === 0) {
      timer = setTimeout(
        settle,
        cssTime(
          getComputedStyle(element).getPropertyValue('--motion-press-duration'),
          300,
        ) * 2,
      )
    }
  })
  return settle
}
