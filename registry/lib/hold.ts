import { FOLLOWS_TRANSITION, roleDuration } from '@/registry/lib/resize'
import {
  type FocusEvent,
  type PointerEvent,
  type RefObject,
  useEffect,
  useRef,
  useState,
} from 'react'

/*
 * Whether something that changes on its own, such as a marquee's drift or a
 * logo that swaps, may change now: it holds while a mouse is over it, while
 * a finger or a pen presses it (there is no hover), and while anything
 * inside has focus, so nothing moves while someone reads by keyboard.
 *
 *   const hold = useHold()
 *   <div {...hold.handlers}>…</div>
 *   useEffect(() => { if (hold.running) … }, [hold.running])
 */
function useHold() {
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const handlers = {
    onPointerEnter: (event: PointerEvent) =>
      event.pointerType === 'mouse' && setHovered(true),
    onPointerDown: () => setHovered(true),
    onPointerUp: (event: PointerEvent) =>
      event.pointerType !== 'mouse' && setHovered(false),
    onPointerCancel: () => setHovered(false),
    onPointerLeave: () => setHovered(false),
    onFocus: () => setFocused(true),
    onBlur: (event: FocusEvent) => {
      if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false)
    },
  }
  return { running: !hovered && !focused, handlers }
}

/**
 * Calls `turn` every `every` `layout` durations while `running`, the element
 * is in view and the page is shown, such as a logo that swaps or a pulse
 * that runs: the next turn of something that changes on its own.
 */
function useTurns(
  ref: RefObject<HTMLElement | null>,
  running: boolean,
  every: number,
  turn: () => void,
) {
  const turnRef = useRef(turn)
  useEffect(() => {
    turnRef.current = turn
  })
  useEffect(() => {
    const element = ref.current
    if (!element || !running) return
    let seen = false
    // The wait is a Web Animation that follows the page's transitions, so a tool that slows them slows it too.
    let clock: Animation | undefined
    const schedule = () => {
      clock?.cancel()
      clock = undefined
      if (!seen || document.hidden) return
      const wait = roleDuration(element, 'layout') * every
      if (!(wait > 0)) return
      const next = element.animate([], { duration: wait, id: FOLLOWS_TRANSITION })
      clock = next
      next.finished.then(
        () => {
          if (clock !== next) return
          turnRef.current()
          schedule()
        },
        // Cancelled: held, out of view or gone.
        () => {},
      )
    }
    const sight = new IntersectionObserver(([entry]) => {
      seen = entry?.isIntersecting ?? false
      schedule()
    })
    sight.observe(element)
    document.addEventListener('visibilitychange', schedule)
    return () => {
      clock?.cancel()
      sight.disconnect()
      document.removeEventListener('visibilitychange', schedule)
    }
  }, [ref, running, every])
}

export { useHold, useTurns }
