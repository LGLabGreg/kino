import { useSyncExternalStore } from 'react'

/*
 * Whether the screen is wider than a phone: 40rem, Tailwind's `sm`. Below it
 * a Date picker shows one month and a User menu opens as a bottom sheet.
 * Rendered on the server as roomy, since most first loads are on a desk.
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
