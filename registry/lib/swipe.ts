/*
 * A sideways drag that carries its speed, as a carousel's slides follow one:
 * the element follows the pointer at once, and on release the flick's speed
 * says how far it goes and how quickly it settles. The numbers match Base
 * UI's Drawer, so a swipe feels the same in every Kino component.
 */

/** How far, in pixels, a press moves sideways before it becomes a drag, as Base UI's Drawer waits. */
const SWIPE_SLOP_PX = 6

/** Only the last tenth of a second of a drag says how fast it was let go. */
const VELOCITY_WINDOW_MS = 100

/** Speeds, in pixels per millisecond, from Base UI's Drawer. */
const FLICK_VELOCITY = 0.5
const MAX_VELOCITY = 4
const MIN_RELEASE_VELOCITY = 0.2

/** How far a flick throws past where it was let go, in pixels for each pixel per millisecond. */
const FLICK_PROJECTION_MS = 300

/** How long what is let go takes to travel the rest of the way, in milliseconds, at its fastest and slowest. */
const MIN_RELEASE_MS = 80
const MAX_RELEASE_MS = 360
const MIN_STRENGTH = 0.1

export interface SwipeSample {
  /** The pointer's position along the axis, in pixels. */
  x: number
  /** When it was there, in milliseconds. */
  time: number
}

/**
 * How fast a drag was moving when it was let go at `now`, in pixels per
 * millisecond, over its last 100ms. A drag held still before release has
 * none.
 */
export function releaseVelocity(samples: readonly SwipeSample[], now: number) {
  const recent = samples.filter((sample) => now - sample.time <= VELOCITY_WINDOW_MS)
  if (recent.length < 2) return 0
  const first = recent[0]
  const last = recent[recent.length - 1]
  const duration = Math.max(last.time - first.time, 4)
  return (last.x - first.x) / duration
}

/**
 * Where a drag let go at `offset` would come to rest, in pixels: a flick
 * faster than 0.5px/ms throws it on by up to 1200px, as a Drawer's snap
 * points do.
 */
export function projectedOffset(offset: number, velocity: number) {
  if (Math.abs(velocity) < FLICK_VELOCITY) return offset
  const capped = Math.max(-MAX_VELOCITY, Math.min(MAX_VELOCITY, velocity))
  return offset + capped * FLICK_PROJECTION_MS
}

/**
 * How much of its role's duration the rest of a swipe takes, from 0.1 to 1,
 * as Base UI's `--drawer-swipe-strength`: `remaining` pixels to go at
 * `velocity` pixels per millisecond. A slow release takes the whole role.
 */
export function swipeStrength(remaining: number, velocity: number) {
  const speed = Math.abs(velocity)
  if (speed <= MIN_RELEASE_VELOCITY || remaining <= 0) return 1
  const capped = Math.min(speed, MAX_VELOCITY)
  const ms = Math.max(MIN_RELEASE_MS, Math.min(MAX_RELEASE_MS, remaining / capped))
  return (
    MIN_STRENGTH +
    ((ms - MIN_RELEASE_MS) / (MAX_RELEASE_MS - MIN_RELEASE_MS)) * (1 - MIN_STRENGTH)
  )
}

/**
 * How far something dragged `past` pixels beyond its end moves, in pixels:
 * less and less the further it goes, never more than `size`, so the end
 * gives a little and pulls back.
 */
export function rubberBand(past: number, size: number) {
  if (size <= 0 || past === 0) return 0
  const pulled = (1 - 1 / ((Math.abs(past) * 0.55) / size + 1)) * size
  return Math.sign(past) * pulled
}

/** Whether a press that has moved `dx` and `dy` pixels is a sideways drag, an up or down one, or not yet either. */
export function swipeAxis(dx: number, dy: number): 'x' | 'y' | null {
  if (Math.abs(dx) < SWIPE_SLOP_PX && Math.abs(dy) < SWIPE_SLOP_PX) return null
  return Math.abs(dx) > Math.abs(dy) ? 'x' : 'y'
}

export interface SwipeHandlers {
  /** Whether a press on this element may start a drag. */
  canStart?: (target: Element) => boolean
  onStart: () => void
  /** `dx` is how far the pointer has moved sideways since the press, in pixels. */
  onMove: (dx: number) => void
  /** `velocity` is in pixels per millisecond; 0 when the drag was cut short. */
  onEnd: (dx: number, velocity: number) => void
}

/**
 * Follows sideways drags on `element`. A press becomes a drag once it moves
 * 6px more sideways than up or down, so a page still scrolls under a finger
 * (give the element `touch-action: pan-y`), and the click that ends a drag
 * never reaches a link or button under it. Returns a function that stops
 * following.
 */
export function followSwipe(element: HTMLElement, handlers: SwipeHandlers): () => void {
  let press: { id: number; x: number; y: number } | null = null
  let dragging = false
  let samples: SwipeSample[] = []

  const swallowClick = (event: MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
  }

  const finish = (event: PointerEvent, cancelled: boolean) => {
    if (!press || event.pointerId !== press.id) return
    const dx = event.clientX - press.x
    const wasDragging = dragging
    press = null
    dragging = false
    if (!wasDragging) return
    if (element.hasPointerCapture(event.pointerId)) {
      element.releasePointerCapture(event.pointerId)
    }
    handlers.onEnd(dx, cancelled ? 0 : releaseVelocity(samples, event.timeStamp))
    // The click this release makes comes next, if any: catch only that one.
    window.addEventListener('click', swallowClick, { capture: true, once: true })
    setTimeout(() => window.removeEventListener('click', swallowClick, { capture: true }))
  }

  const down = (event: PointerEvent) => {
    if (press || event.button !== 0) return
    if (!(event.target instanceof Element)) return
    if (event.target.closest('input, textarea, select, [contenteditable]')) return
    if (handlers.canStart && !handlers.canStart(event.target)) return
    press = { id: event.pointerId, x: event.clientX, y: event.clientY }
    samples = [{ x: event.clientX, time: event.timeStamp }]
  }

  const move = (event: PointerEvent) => {
    if (!press || event.pointerId !== press.id) return
    const dx = event.clientX - press.x
    if (!dragging) {
      const axis = swipeAxis(dx, event.clientY - press.y)
      if (axis === null) return
      if (axis === 'y') {
        press = null
        return
      }
      dragging = true
      element.setPointerCapture(event.pointerId)
      window.getSelection()?.removeAllRanges()
      handlers.onStart()
    }
    samples.push({ x: event.clientX, time: event.timeStamp })
    if (samples.length > 32) samples.shift()
    handlers.onMove(dx)
  }

  const up = (event: PointerEvent) => finish(event, false)
  const cancel = (event: PointerEvent) => finish(event, true)
  // A link or an image would start the browser's own drag and end ours.
  const nativeDrag = (event: DragEvent) => event.preventDefault()

  element.addEventListener('pointerdown', down)
  element.addEventListener('pointermove', move)
  element.addEventListener('pointerup', up)
  element.addEventListener('pointercancel', cancel)
  element.addEventListener('lostpointercapture', cancel)
  element.addEventListener('dragstart', nativeDrag)
  return () => {
    element.removeEventListener('pointerdown', down)
    element.removeEventListener('pointermove', move)
    element.removeEventListener('pointerup', up)
    element.removeEventListener('pointercancel', cancel)
    element.removeEventListener('lostpointercapture', cancel)
    element.removeEventListener('dragstart', nativeDrag)
    window.removeEventListener('click', swallowClick, { capture: true })
  }
}
