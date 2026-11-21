'use client'

import { useState } from 'react'

/**
 * Whether `details` is a change its handler called off: Base UI's event
 * details, after `eventDetails.cancel()`.
 */
export function isCanceled(details: unknown): boolean {
  return (
    typeof details === 'object' &&
    details !== null &&
    'isCanceled' in details &&
    details.isCanceled === true
  )
}

/**
 * A value a user may control: theirs when they pass one, kept here when they
 * don't. Setting it tells `onChange` with whatever follows the value, such as
 * Base UI's event details, and keeps it here only when it isn't theirs and
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

/**
 * A value a Base UI part keeps itself, followed so the parts beside it can
 * read it: theirs when they pass one, else what the part last told
 * `onChange`, unless that was cancelled. Give the part `value`, `defaultValue`
 * and the returned handler unchanged, so it still owns the value and its
 * automatic changes, such as picking the first tab, which it reports too.
 * `automatic` names the reasons of changes the part makes whether or not
 * the handler cancels them, so those are followed either way.
 */
export function useFollowedValue<T, Rest extends unknown[] = []>(
  value: T | undefined,
  initial: T | undefined,
  onChange: ((value: T, ...rest: Rest) => void) | undefined,
  { automatic = [] }: { automatic?: readonly string[] } = {},
) {
  const [own, setOwn] = useState(initial)
  return [
    value !== undefined ? value : own,
    (next: T, ...rest: Rest) => {
      onChange?.(next, ...rest)
      if (followsChange(rest[0], automatic)) setOwn(next)
    },
  ] as const
}

/**
 * Whether a followed value takes a change with these event details: when its
 * handler didn't cancel it, or when it is one of the `automatic` reasons the
 * part keeps either way.
 */
export function followsChange(details: unknown, automatic: readonly string[] = []) {
  if (!isCanceled(details)) return true
  return (
    typeof details === 'object' &&
    details !== null &&
    'reason' in details &&
    typeof details.reason === 'string' &&
    automatic.includes(details.reason)
  )
}
