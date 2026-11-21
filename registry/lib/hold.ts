import { type FocusEvent, type PointerEvent, useState } from 'react'

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

export { useHold }
