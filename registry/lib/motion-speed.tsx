'use client'

import { createContext, type ReactNode, use } from 'react'

const SpeedContext = createContext(1)

/**
 * Plays the springs the motion foundation times in JavaScript at this rate,
 * such as 0.25 for a slow-motion demo: `useMotionTransition`'s, and a
 * drawer's. CSS transitions keep their timing.
 */
function MotionSpeed({ speed, children }: { speed: number; children: ReactNode }) {
  return <SpeedContext value={speed}>{children}</SpeedContext>
}

/** The rate `MotionSpeed` above sets, 1 without one. */
function useMotionSpeed() {
  return use(SpeedContext)
}

export { MotionSpeed, useMotionSpeed }
