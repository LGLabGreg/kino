'use client'

import { afterPageTime, liveNow } from '@/registry/lib/live'
import { reducesMotion } from '@/registry/lib/reduce-motion'
import { FOLLOWS_TRANSITION, roleDuration } from '@/registry/lib/resize'
import {
  type Dispatch,
  type RefObject,
  type SetStateAction,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'

/*
 * A scene: a small picture of a product at work that plays once, a step at a
 * time, when it is seen, such as a feature's picture on a landing page.
 * Under reduced motion it lands on its last step instead of playing.
 *
 * A script plays when it is asked to instead, such as a preview's reply when
 * the visitor sends a message: timed events folded into a state by a
 * reducer, on the page's clock, that can stop part-way and wait at a step for
 * the visitor's decision.
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
        // Read again now: reduced motion may have been asked for since it mounted.
        setSeen(reducesMotion(element) ? 'reduced' : 'seen')
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

/** Whether any of `element` is on screen: one that is as the page shows stays as it was painted (motion rule 6). */
function onScreen(element: Element) {
  const box = element.getBoundingClientRect()
  return (
    box.bottom > 0 &&
    box.top < window.innerHeight &&
    box.right > 0 &&
    box.left < window.innerWidth
  )
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

/* Scripts */

/**
 * One step of a script: an event that lands `at` ms after the play started,
 * or after the last wait, on the page's clock; or a wait for the visitor's
 * decision, which is reached as soon as the step before it lands.
 */
type ScriptStep<Event> = { at: number; event: Event } | { wait: 'decision' }

/** Where a play is: not playing, playing `steps` from `next`, or held at the wait at `next`. */
type ScriptPlay<Event> =
  | { status: 'idle' }
  | {
      status: 'playing'
      steps: readonly ScriptStep<Event>[]
      next: number
      /** When the play started, or the last wait was passed, on the page's clock. */
      since: number
    }
  | { status: 'waiting'; steps: readonly ScriptStep<Event>[]; next: number }

/** A script's state and where its play is. */
interface Script<State, Event> {
  state: State
  play: ScriptPlay<Event>
}

const NOT_PLAYING = Object.freeze({ status: 'idle' }) satisfies ScriptPlay<never>

/** A script at `initial`, not playing: where it starts, and where a reset goes back to. */
function scriptOf<State, Event>(initial: State): Script<State, Event> {
  return { state: initial, play: NOT_PLAYING }
}

/** The script playing `steps` from the first, from its state as it is, at `now`. The same script while it plays. */
function scriptPlay<State, Event>(
  script: Script<State, Event>,
  steps: readonly ScriptStep<Event>[],
  now: number,
): Script<State, Event> {
  if (script.play.status !== 'idle') return script
  return { ...script, play: { status: 'playing', steps, next: 0, since: now } }
}

/** The script held where it is, not playing. */
function scriptStop<State, Event>(script: Script<State, Event>): Script<State, Event> {
  return script.play.status === 'idle' ? script : { ...script, play: NOT_PLAYING }
}

/**
 * The script after the visitor's decision: `decision` changes the state, and
 * a play held at a wait plays on past it, its next steps timed from `now`.
 */
function scriptDecide<State, Event>(
  script: Script<State, Event>,
  decision: (state: State) => State,
  now: number,
): Script<State, Event> {
  const { play } = script
  return {
    state: decision(script.state),
    play:
      play.status === 'waiting'
        ? { status: 'playing', steps: play.steps, next: play.next + 1, since: now }
        : play,
  }
}

/**
 * The script with every step due at `now` landed, in order, through
 * `reducer`: up to a step whose time hasn't come, or a wait, which holds it.
 * With `land`, as under reduced motion, every step up to the next wait lands
 * at once. Past the last step it stops playing. `due` is how long, on the
 * page's clock, until the next step lands, while it plays; the same script
 * when nothing landed.
 */
function scriptLand<State, Event>(
  script: Script<State, Event>,
  reducer: (state: State, event: Event) => State,
  now: number,
  land: boolean,
): { script: Script<State, Event>; due: number | null } {
  const { play } = script
  if (play.status !== 'playing') return { script, due: null }
  let { state } = script
  let next = play.next
  for (; next < play.steps.length; next++) {
    const step = play.steps[next]
    if ('wait' in step) {
      return {
        script: { state, play: { status: 'waiting', steps: play.steps, next } },
        due: null,
      }
    }
    if (!land && step.at > now - play.since) {
      if (next === play.next) return { script, due: step.at - (now - play.since) }
      return { script: { state, play: { ...play, next } }, due: null }
    }
    state = reducer(state, step.event)
  }
  return { script: { state, play: NOT_PLAYING }, due: null }
}

/**
 * Lands a script's steps on the page's clock while it plays, so the
 * playground's Speed slows it, even when changed part-way: a render when a
 * step lands, never one per frame. Under reduced motion each stretch up to a
 * wait lands at once. Unmounting cancels.
 */
function useScriptClock<State, Event>(
  script: Script<State, Event>,
  setScript: Dispatch<SetStateAction<Script<State, Event>>>,
  reducer: (state: State, event: Event) => State,
) {
  useLayoutEffect(() => {
    if (script.play.status !== 'playing') return undefined
    let cancel = () => {}
    const tick = () => {
      const landed = scriptLand(script, reducer, liveNow(), reducesMotion())
      // Only onto the script it was worked out from, so an effect run twice lands once.
      if (landed.script !== script)
        setScript((current) => (current === script ? landed.script : current))
      else if (landed.due !== null) cancel = afterPageTime(landed.due, tick)
    }
    tick()
    return () => cancel()
  }, [script, setScript, reducer])
}

/**
 * Plays steps through `reducer` from `initial` when asked, on the page's
 * clock. Nothing plays until `play(steps)`, which plays them from the state
 * as it is and does nothing while a play goes on. `stop()` holds where it
 * is and `reset()` goes back to `initial`. `decide(decision)` changes the
 * state with the visitor's decision and plays on past a wait; `change`
 * changes it and leaves the play as it is. Under reduced motion a play lands
 * on its end, or on its next wait, in the commit that starts it.
 */
function useScript<State, Event>(
  reducer: (state: State, event: Event) => State,
  initial: State,
): {
  state: State
  /** From `play()` until its last step lands or it stops, waits included. */
  playing: boolean
  play: (steps: readonly ScriptStep<Event>[]) => void
  stop: () => void
  reset: () => void
  decide: (decision: (state: State) => State) => void
  change: (update: (state: State) => State) => void
} {
  const [script, setScript] = useState(() => scriptOf<State, Event>(initial))
  useScriptClock(script, setScript, reducer)

  const act = (
    action: (script: Script<State, Event>, now: number) => Script<State, Event>,
  ) => {
    const now = liveNow()
    const land = reducesMotion()
    setScript((current) => scriptLand(action(current, now), reducer, now, land).script)
  }

  return {
    state: script.state,
    playing: script.play.status !== 'idle',
    play: (steps) => act((current, now) => scriptPlay(current, steps, now)),
    stop: () => setScript(scriptStop),
    reset: () => setScript(scriptOf(initial)),
    decide: (decision) => act((current, now) => scriptDecide(current, decision, now)),
    change: (update) =>
      setScript((current) => {
        const state = update(current.state)
        return state === current.state ? current : { ...current, state }
      }),
  }
}

export {
  type SceneSeen,
  type Script,
  type ScriptPlay,
  type ScriptStep,
  CRISP_ENTER_MS,
  feelStretch,
  fullView,
  onScreen,
  scriptDecide,
  sceneStep,
  scriptLand,
  scriptOf,
  scriptPlay,
  scriptStop,
  useScene,
  useScript,
  useSeen,
}
