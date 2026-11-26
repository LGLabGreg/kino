'use client'

import { useMotionSpeed } from '@/registry/lib/motion-speed'
import {
  atSpeed,
  DEFAULT_FEEL,
  FEEL_NAMES,
  type FeelName,
  feels,
  type MotionRole,
  type MotionSpring,
} from '@/registry/lib/motion-tokens'
import { reducesMotion, watchReducedMotion } from '@/registry/lib/reduce-motion'
import type { SheetPhysics } from '@ui-sdk/react/drawer'
import { useMemo, useSyncExternalStore } from 'react'

/*
 * ui-sdk moves a drawer itself, on a spring of its own (`physics`), so the
 * feel's CSS variables can't time it. This turns the feel's spring for a
 * role into that spring, read where the drawer is: a nested `data-feel`
 * re-times it and a nested `data-motion='reduce'` stops it, as they do CSS.
 */

/**
 * ui-sdk's spring for one of the feel's: the same spring `motion` plays for a
 * `visualDuration` and `bounce`, whose period is 1.2 times the visual
 * duration and whose damping ratio is `1 - bounce`, so a drawer settles in
 * step with CSS on the same role. `speed` plays it slower or faster, as the
 * playground's Speed does. With `reduced`, it lands at once.
 */
function sheetPhysicsOf(
  { visualDuration, bounce }: MotionSpring,
  speed = 1,
  reduced = false,
): Pick<SheetPhysics, 'response' | 'dampingRatio' | 'momentumDampingRatio'> {
  const dampingRatio = Math.min(1, Math.max(0.05, 1 - bounce))
  return {
    // ui-sdk settles a spring within a millisecond at this period.
    response: reduced ? 0.0001 : atSpeed(visualDuration * 1.2, speed),
    dampingRatio,
    // A flick keeps ui-sdk's small overshoot only where the feel bounces.
    momentumDampingRatio: dampingRatio,
  }
}

/** The feel set on `element` or above it, or on the page. */
function feelAt(element: Element | null): FeelName {
  const feel = (element ?? document.documentElement)
    .closest('[data-feel]')
    ?.getAttribute('data-feel')
  return FEEL_NAMES.find((name) => name === feel) ?? DEFAULT_FEEL
}

let settingsChanged = 0

function watchMotionSettings(onChange: () => void) {
  return watchReducedMotion(() => {
    settingsChanged++
    onChange()
  }, ['data-feel'])
}

/**
 * The `physics` for a drawer in this role, at the playground's Speed, in the
 * feel and the motion preference where `at()` is (its content once it shows,
 * else its trigger). ui-sdk reads it as the drawer opens, once its content
 * is in the page, so a drawer opened with no trigger reads where it is too.
 */
function useSheetPhysics(role: MotionRole, at: () => Element | null) {
  const changed = useSyncExternalStore(
    watchMotionSettings,
    () => settingsChanged,
    () => 0,
  )
  const speed = useMotionSpeed()
  return useMemo(() => {
    const spring = () => {
      const element = at()
      return sheetPhysicsOf(feels[feelAt(element)][role], speed, reducesMotion(element))
    }
    return {
      get response() {
        return spring().response
      },
      get dampingRatio() {
        return spring().dampingRatio
      },
      get momentumDampingRatio() {
        return spring().momentumDampingRatio
      },
      // A new spring when a setting changes, which ui-sdk reads again.
      changed,
    }
  }, [role, speed, at, changed])
}

export { sheetPhysicsOf, useSheetPhysics }
