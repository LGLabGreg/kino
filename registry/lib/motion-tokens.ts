/*
 * Every value the library moves with. Components ask for a role, never for a
 * duration or a spring, so editing a feel here re-times every component.
 */

export const MOTION_ROLES = ['press', 'enter', 'exit', 'layout', 'morph', 'draw'] as const

/**
 * What a movement is for; each has one spring in every feel.
 * - `press`: a control answering a press (buttons, toggles, thumbs).
 * - `enter`: something arriving (a menu, a popover, a toast, a new row).
 * - `exit`: something leaving. Faster than its entrance, and never bounces.
 * - `layout`: a size or position change (a panel opening, a list reordering).
 * - `morph`: one shape becoming another (a highlight moving to the picked tab).
 * - `draw`: a mark appearing along its length (a tick, a bar filling). Never
 *   bounces: an overshoot would cut the start of the mark.
 *
 * Every role also has a fade easing, the same curve held at its end, for
 * colours: an overshoot would carry a colour past its end, to another colour.
 */
export type MotionRole = (typeof MOTION_ROLES)[number]

export interface MotionSpring {
  /** Seconds until it looks settled; any bounce happens after. */
  visualDuration: number
  /** 0 settles without overshoot; 0.25 overshoots a little. */
  bounce: number
}

export type Feel = Record<MotionRole, MotionSpring>

/** A time played at `speed`, such as 0.25 for slow motion, in the same unit: the same curve over it, longer. */
export function atSpeed(time: number, speed: number): number {
  return time / speed
}

export const feels = {
  /** Slower and soft, for calm products and long reads. */
  calm: {
    press: { visualDuration: 0.24, bounce: 0 },
    enter: { visualDuration: 0.36, bounce: 0 },
    exit: { visualDuration: 0.24, bounce: 0 },
    layout: { visualDuration: 0.45, bounce: 0 },
    morph: { visualDuration: 0.48, bounce: 0 },
    draw: { visualDuration: 0.4, bounce: 0 },
  },
  /** Quick with no overshoot. The default. */
  crisp: {
    press: { visualDuration: 0.18, bounce: 0 },
    enter: { visualDuration: 0.26, bounce: 0 },
    exit: { visualDuration: 0.18, bounce: 0 },
    layout: { visualDuration: 0.34, bounce: 0 },
    morph: { visualDuration: 0.38, bounce: 0 },
    draw: { visualDuration: 0.3, bounce: 0 },
  },
  /** Quicker than Crisp, with an overshoot you can see on everything that arrives or changes shape. */
  lively: {
    press: { visualDuration: 0.16, bounce: 0.4 },
    enter: { visualDuration: 0.24, bounce: 0.3 },
    exit: { visualDuration: 0.2, bounce: 0 },
    layout: { visualDuration: 0.3, bounce: 0.25 },
    morph: { visualDuration: 0.34, bounce: 0.35 },
    draw: { visualDuration: 0.26, bounce: 0 },
  },
} as const satisfies Record<string, Feel>

export type FeelName = keyof typeof feels

/**
 * How far a pressed control shrinks, as a scale: 0.97 is 3% smaller. A small
 * target such as an icon button presses deeper, or the press can't be seen.
 */
export const pressScales = {
  calm: 0.98,
  crisp: 0.97,
  lively: 0.96,
} as const satisfies Record<FeelName, number>

export const FEEL_NAMES = Object.keys(feels) as FeelName[]

export const DEFAULT_FEEL: FeelName = 'crisp'
