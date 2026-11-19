import type { Ref, RefCallback } from 'react'

/**
 * One ref callback that sets every ref given, so a part can measure its own
 * element and still pass it to a ref of the caller's. Each ref's cleanup, a
 * callback's own or the null an object ref is set back to, runs when the
 * element goes.
 */
export function mergeRefs<T>(...refs: (Ref<T> | undefined)[]): RefCallback<T> {
  return (node) => {
    const cleanups = refs.map((ref) => {
      if (typeof ref === 'function') {
        const cleanup = ref(node)
        return typeof cleanup === 'function' ? cleanup : () => ref(null)
      }
      if (ref) {
        ref.current = node
        return () => {
          ref.current = null
        }
      }
      return undefined
    })
    return () => {
      for (const cleanup of cleanups) cleanup?.()
    }
  }
}

/**
 * Marks an element as mounted a frame after it first paints, so `data-mounted:`
 * can hold back entrances that would otherwise play on page load.
 */
export function markMounted(node: HTMLElement | null) {
  if (!node) return undefined
  const frame = requestAnimationFrame(() => {
    node.dataset.mounted = ''
  })
  return () => cancelAnimationFrame(frame)
}
