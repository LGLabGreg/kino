'use client'

import { useState } from 'react'

/**
 * Whether `details` is a change its handler called off, after `cancel()`:
 * ui-sdk's change details, whose `canceled` turns true, or Base UI's, whose
 * `isCanceled` does.
 */
export function isCanceled(details: unknown): boolean {
  return (
    typeof details === 'object' &&
    details !== null &&
    (('canceled' in details && details.canceled === true) ||
      ('isCanceled' in details && details.isCanceled === true))
  )
}

/**
 * A value a user may control: theirs when they pass one, kept here when they
 * don't. Setting it tells `onChange` with whatever follows the value, such as
 * ui-sdk's change details, and keeps it here only when it isn't theirs and
 * `onChange` didn't cancel it. Setting the value it already has does nothing.
 */
export function useControllable<T, Rest extends unknown[] = []>(
  value: T | undefined,
  initial: T,
  onChange: ((value: T, ...rest: Rest) => void) | undefined,
) {
  const [own, setOwn] = useState(initial)
  const controlled = value !== undefined
  const current = controlled ? value : own
  return [
    current,
    (next: T, ...rest: Rest) => {
      if (Object.is(next, current)) return
      onChange?.(next, ...rest)
      if (!controlled && !isCanceled(rest[0])) setOwn(next)
    },
  ] as const
}
