'use client'

import { reducesMotion } from '@/registry/lib/reduce-motion'
import { FOLLOWS_TRANSITION, roleDuration } from '@/registry/lib/resize'
import { type RefObject, useEffect, useRef, useState } from 'react'

/*
 * A scene: a small picture of a product at work that plays once, a step at a
 * time, when it is seen, such as a feature's picture on a landing page.
 * Under reduced motion it lands on its last step instead of playing.
 */

/** Where a scene is: not seen yet, seen and playing, or landed on its end under reduced motion. */
type SceneSeen = 'waiting' | 'seen' | 'reduced'

/** The share of an element that has to be on screen for all of it to be seen, short of a scene taller than the screen. */
function fullView(height: number, viewport: number): number {
  return Math.min(0.9, (0.9 * viewport) / height)
}

/**
 * Whether a scene has been seen: `seen` once it is in full view (or fills most
 * of the screen), or once `share` of it is; `reduced` at once under reduced
 * motion, where it lands on its end instead of playing. `landing` holds for
 * the two frames that jump to the end, so nothing fades or slides into it on
 * load (motion rule 6): the scene's frame takes it as `data-landing`.
 */
function useSeen<Element extends HTMLElement>(
  /** The share of it on screen that starts it; all of it by default. */
  share?: number,
): {
  ref: RefObject<Element | null>
  seen: SceneSeen
  landing: boolean
} {
  const ref = useRef<Element>(null)
  const [seen, setSeen] = useState<SceneSeen>('waiting')
  const [landed, setLanded] = useState(false)

  useEffect(() => {
    const element = ref.current
    if (!element) return
    if (reducesMotion(element)) {
      setSeen('reduced')
      return
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return
        observer.disconnect()
        setSeen('seen')
      },
      { threshold: share ?? fullView(element.offsetHeight, window.innerHeight) },
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [share])

  useEffect(() => {
    if (seen !== 'reduced') return
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => setLanded(true))
    })
    return () => cancelAnimationFrame(frame)
  }, [seen])

  return { ref, seen, landing: seen === 'reduced' && !landed }
}

/** The `enter` role's duration in the default feel, Crisp, in ms: what a scene's steps are written against. */
const CRISP_ENTER_MS = 500

/** How much longer than in Crisp the `enter` role runs where `element` is, so a scene keeps pace with the feel. */
function feelStretch(element: Element): number {
  const ms = roleDuration(element, 'enter')
  return ms > 0 ? ms / CRISP_ENTER_MS : 1
}

/**
 * The step a scene is on, `elapsed` ms after it started: how many of `steps`
 * have landed.
 */
function sceneStep(steps: readonly number[], elapsed: number): number {
  return steps.filter((at) => at <= elapsed).length
}

/**
 * Plays a scripted scene once it is seen (`useSeen`): each entry of `steps`
 * is how many ms after the start that step lands in the default feel, Crisp.
 * A slower feel stretches them with its `enter` role, and its clock is a Web
 * Animation that follows the transitions, so a tool that slows CSS slows the
 * scene with it. Under reduced motion it is on its last step. `replay`
 * starts it over.
 */
function useScene<Element extends HTMLElement>(
  steps: readonly number[],
  /** The share of it on screen that starts it; all of it by default. */
  share?: number,
): {
  ref: RefObject<Element | null>
  step: number
  done: boolean
  landing: boolean
  /** Counts the plays, to start what the scene holds over on a replay. */
  run: number
  replay: () => void
} {
  const { ref, seen, landing } = useSeen<Element>(share)
  const [played, setPlayed] = useState(0)
  const [run, setRun] = useState(0)

  useEffect(() => {
    const element = ref.current
    if (seen !== 'seen' || !element || steps.length === 0) return
    const stretch = feelStretch(element)
    const clock = element.animate([], {
      duration: Math.max(...steps) * stretch,
      id: FOLLOWS_TRANSITION,
    })
    let frame = requestAnimationFrame(function tick() {
      const elapsed = Number(clock.currentTime ?? 0) / stretch
      const step =
        clock.playState === 'finished' ? steps.length : sceneStep(steps, elapsed)
      setPlayed(step)
      if (step < steps.length) frame = requestAnimationFrame(tick)
    })
    return () => {
      cancelAnimationFrame(frame)
      clock.cancel()
    }
  }, [steps, seen, run, ref])

  const step = seen === 'reduced' ? steps.length : played
  return {
    ref,
    step,
    done: step === steps.length,
    landing,
    run,
    replay: () => {
      setPlayed(0)
      setRun((last) => last + 1)
    },
  }
}

export { CRISP_ENTER_MS, fullView, sceneStep, useScene }
