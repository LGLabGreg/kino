import { animateSize, startRun } from '@/registry/lib/resize'
import { revealBehavior } from '@/registry/lib/scroll'
import { type RefObject, useLayoutEffect, useRef } from 'react'

/*
 * A box that folds to a set height, with more past its foot, and unfolds to
 * its whole height: the Code block's lines and the Testimonials wall. It
 * moves on `layout` from the height it is at, so a change cut short turns
 * back where it is.
 */

/**
 * Moves the box to its new height when it folds or unfolds. While it moves
 * it is `data-moving`, so a cap on its folded height (styled on
 * `not-data-moving`, or on `data-folded`, which goes on only once a fold has
 * finished) never cuts the move short.
 */
function useFoldMove(ref: RefObject<HTMLElement | null>, folded: boolean) {
  const first = useRef(true)

  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    if (first.current) {
      first.current = false
      if (folded) element.dataset.folded = ''
      return
    }
    const from = element.getBoundingClientRect().height
    element.style.height = ''
    // The height it comes to rest at, measured with the cap on.
    if (folded) element.dataset.folded = ''
    else delete element.dataset.folded
    const to = element.offsetHeight
    delete element.dataset.folded
    if (Math.abs(to - from) < 0.5) {
      startRun(element)
      delete element.dataset.moving
      if (folded) element.dataset.folded = ''
      return
    }
    element.dataset.moving = ''
    void animateSize(element, 'height', from, to).then((latest) => {
      if (!latest) return
      element.style.height = ''
      delete element.dataset.moving
      if (folded) element.dataset.folded = ''
    })
  }, [ref, folded])
}

/**
 * Before a box folds: if its top has scrolled away, or sits under a sticky
 * header its scroll margin clears, brings it back, so whoever folded it
 * isn't left below what they were reading.
 */
function bringTopBack(root: HTMLElement) {
  if (
    root.getBoundingClientRect().top < parseFloat(getComputedStyle(root).scrollMarginTop)
  ) {
    root.scrollIntoView({ block: 'start', behavior: revealBehavior(root) })
  }
}

export { bringTopBack, useFoldMove }
