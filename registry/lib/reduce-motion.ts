/**
 * Whether motion should be reduced where `element` is: the device asks for
 * it, or the motion preference does (`data-motion='reduce'` on the element
 * or above it, as the `motion-reduce:` variant reads it). Without an
 * element, for the whole page.
 */
export function reducesMotion(element: Element | null = document.documentElement) {
  return (
    window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
    element?.closest("[data-motion='reduce']") != null
  )
}
