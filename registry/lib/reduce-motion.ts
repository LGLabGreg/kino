/**
 * Whether motion should be reduced where `element` is: the device asks for
 * it, or the motion preference does (`data-motion='reduce'` on the element
 * or above it, as the `motion-reduce:` variant reads it). Without an
 * element, for the whole page.
 */
export function reducesMotion(element?: Element | null) {
  return (
    window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
    (element ?? document.documentElement).closest("[data-motion='reduce']") != null
  )
}

/**
 * Calls `onChange` when motion may have stopped or started being reduced:
 * the device's setting changed, or `data-motion` changed anywhere on the
 * page, or another of `attributes`, such as `data-feel`. For
 * `useSyncExternalStore` with `reducesMotion`. Returns what stops it.
 */
export function watchReducedMotion(onChange: () => void, attributes: string[] = []) {
  const device = window.matchMedia('(prefers-reduced-motion: reduce)')
  device.addEventListener('change', onChange)
  const page = new MutationObserver(onChange)
  page.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-motion', ...attributes],
    subtree: true,
  })
  return () => {
    device.removeEventListener('change', onChange)
    page.disconnect()
  }
}
