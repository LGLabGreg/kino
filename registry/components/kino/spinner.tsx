'use client'

import { type ComponentProps, useEffect, useState } from 'react'

import { cn } from '@/lib/utils'

function Spinner({ className, ...props }: ComponentProps<'svg'>) {
  return (
    <svg
      data-slot='spinner'
      role='img'
      aria-label='Loading'
      viewBox='0 0 16 16'
      fill='none'
      // `h-4 w-4`, not `size-4`: a parent sizes its icons with
      // `[&_svg:not([class*='size-'])]`, which a `size-` class here would opt out of.
      className={cn('h-4 w-4 animate-spin motion-reduce:animate-pulse', className)}
      {...props}
    >
      <circle
        cx='8'
        cy='8'
        r='6'
        stroke='currentColor'
        strokeOpacity='0.25'
        strokeWidth='2'
      />
      <path
        d='M14 8a6 6 0 0 0-6-6'
        stroke='currentColor'
        strokeWidth='2'
        strokeLinecap='round'
      />
    </svg>
  )
}

const SPINNER_DELAY_MS = 200
const SPINNER_MIN_MS = 300

/** The spinner is hidden, or shown since a time from `performance.now()`. */
type SpinnerState = { phase: 'hidden' } | { phase: 'shown'; since: number }

/**
 * How long until the spinner should change to match `loading`, in ms, or null
 * when it already matches: it shows only once loading has lasted, and then
 * stays long enough to be read, so a fast request never flashes one.
 */
function spinnerWait(state: SpinnerState, loading: boolean, now: number): number | null {
  if (state.phase === 'hidden') return loading ? SPINNER_DELAY_MS : null
  return loading ? null : Math.max(0, SPINNER_MIN_MS - (now - state.since))
}

/**
 * Whether to show a spinner while `loading`: after 200ms, then for at least
 * 300ms. Loading from the first render shows it at once, since no action
 * waits on it and a late spinner would move the page after load.
 */
function useSpinner(loading: boolean): boolean {
  const [state, setState] = useState<SpinnerState>(() =>
    loading ? { phase: 'shown', since: performance.now() } : { phase: 'hidden' },
  )
  useEffect(() => {
    const wait = spinnerWait(state, loading, performance.now())
    if (wait === null) return
    const timeout = setTimeout(() => {
      setState(
        loading ? { phase: 'shown', since: performance.now() } : { phase: 'hidden' },
      )
    }, wait)
    return () => clearTimeout(timeout)
  }, [loading, state])
  return state.phase === 'shown'
}

export { Spinner, spinnerWait, useSpinner }
