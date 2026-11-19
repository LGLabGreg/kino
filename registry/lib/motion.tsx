'use client'

import {
  DEFAULT_FEEL,
  FEEL_NAMES,
  type FeelName,
  feels,
  type MotionRole,
} from '@/registry/lib/motion-tokens'
import { type Transition, useReducedMotion, useReducedMotionConfig } from 'motion/react'
import { createContext, type ReactNode, use, useMemo, useSyncExternalStore } from 'react'

/*
 * Components move with CSS on the roles' variables, which the feel in
 * `data-feel` sets (the `motion` item's CSS). This file is for `motion`
 * elements, which need the same springs as numbers.
 */

const SpeedContext = createContext(1)

/**
 * Plays the springs `useMotionTransition` returns at this rate, such as 0.25
 * for a slow-motion demo. CSS transitions keep their timing.
 */
function MotionSpeed({ speed, children }: { speed: number; children: ReactNode }) {
  return <SpeedContext value={speed}>{children}</SpeedContext>
}

function subscribeToPage(onChange: () => void) {
  const observer = new MutationObserver(onChange)
  observer.observe(document.documentElement, {
    attributeFilter: ['data-feel', 'data-motion'],
  })
  return () => observer.disconnect()
}

function pageFeel(): FeelName {
  const feel = document.documentElement.dataset.feel
  return FEEL_NAMES.find((name) => name === feel) ?? DEFAULT_FEEL
}

/**
 * The transition for a `motion` element in this role, in the page's feel
 * (`data-feel` on <html>) as the springs in motion-tokens.ts time it. With
 * reduced motion, from the device or `data-motion='reduce'` on <html>,
 * movement and size changes are instant and only opacity still fades.
 */
function useMotionTransition(role: MotionRole): Transition {
  const feel = useSyncExternalStore(subscribeToPage, pageFeel, () => DEFAULT_FEEL)
  // The motion preference, as the `motion-reduce:` variant answers it in CSS.
  const reducedByPage = useSyncExternalStore(
    subscribeToPage,
    () => document.documentElement.dataset.motion === 'reduce',
    () => false,
  )
  const speed = use(SpeedContext)
  // With no MotionConfig above, motion's config says "never", whatever the system says.
  const system = useReducedMotion() === true
  const reduced = useReducedMotionConfig() === true || system || reducedByPage
  const { visualDuration, bounce } = feels[feel][role]
  return useMemo(() => {
    const scaled = visualDuration / speed
    if (reduced) {
      return {
        duration: 0,
        opacity: { type: 'spring', visualDuration: scaled, bounce: 0 },
      }
    }
    return { type: 'spring', visualDuration: scaled, bounce }
  }, [visualDuration, bounce, speed, reduced])
}

export { MotionSpeed, useMotionTransition }
