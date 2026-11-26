import { useLayoutEffect, useState, useSyncExternalStore } from 'react'

/*
 * Whether there is room. The screen: wider than a phone, 40rem, Tailwind's
 * `sm`; below it a Date picker shows one month and a User menu opens as a
 * bottom sheet. Rendered on the server as roomy, since most first loads are
 * on a desk. A container: narrower than a width in rem, for a part whose
 * container query lays it out and whose behaviour has to follow, such as
 * the Sidebar's Drawer and the AI chat popup's window that fills its
 * container.
 */

const ROOMY = '(min-width: 40rem)'

function watchRoom(change: () => void) {
  const query = window.matchMedia(ROOMY)
  query.addEventListener('change', change)
  return () => query.removeEventListener('change', change)
}

function isRoomy() {
  return window.matchMedia(ROOMY).matches
}

/** True on a screen wider than a phone, and on the server. */
export function useRoomy(): boolean {
  return useSyncExternalStore(watchRoom, isRoomy, () => true)
}

/** Whether a box `width` px wide is narrower than `rem` rem, at a root font size of `rootFontSize` px, as a container query in rem reads it. */
export function narrowerThan(width: number, rem: number, rootFontSize: number): boolean {
  return width < rem * rootFontSize
}

/**
 * Whether `element` is narrower than `rem` rem, followed as it resizes and
 * read before the first paint. False until there is an element.
 */
export function useNarrowerThan(element: HTMLElement | null, rem: number): boolean {
  const [narrow, setNarrow] = useState(false)
  useLayoutEffect(() => {
    if (!element) return
    const measure = () => {
      const rootFontSize = Number.parseFloat(
        getComputedStyle(document.documentElement).fontSize,
      )
      setNarrow(narrowerThan(element.getBoundingClientRect().width, rem, rootFontSize))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [element, rem])
  return narrow
}
