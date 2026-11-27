'use client'

import { commitStyles } from '@/registry/lib/refs'
import {
  type ColorSchemeState,
  createColorScheme,
  createLocalStorage,
  createPreference,
  type PreferenceLike,
} from '@ui-sdk/core'
import { Preferences as PreferencesPrimitive } from '@ui-sdk/react/preferences'
import { type ComponentProps, useLayoutEffect } from 'react'

/*
 * Kino's settings as ui-sdk preferences, saved in the browser and written as
 * the data attributes Kino's tokens answer (`data-density`, `data-feel`,
 * `data-shape`, `data-motion`), before the first paint. A preference of your
 * own is ui-sdk's `createPreference`, read with its `usePreference`.
 */

/**
 * Light, dark or the device's own, saved under `theme` with next-themes'
 * values, so a project moving from it keeps every visitor's choice.
 */
const colorSchemePreference = createColorScheme({
  global: true,
  storage: createLocalStorage('theme'),
})

/** How much room controls, rows and surfaces take (the `theme` item's density tokens). */
const densityPreference = createPreference({
  values: ['snug', 'balanced', 'airy'],
  defaultValue: 'balanced',
  attribute: 'data-density',
  global: true,
  storage: createLocalStorage('density'),
})

/** The timing everything moves with (the `theme` item's feels). */
const feelPreference = createPreference({
  values: ['calm', 'crisp', 'lively'],
  defaultValue: 'crisp',
  attribute: 'data-feel',
  global: true,
  storage: createLocalStorage('feel'),
})

/** How round corners are (the `theme` item's shape tokens). */
const shapePreference = createPreference({
  values: ['standard', 'round'],
  defaultValue: 'standard',
  attribute: 'data-shape',
  global: true,
  storage: createLocalStorage('shape'),
})

/**
 * Whether to reduce motion as the device asks, or always. The item's CSS
 * makes Tailwind's `motion-reduce:` and `motion-safe:` answer
 * `data-motion='reduce'` too, on the page or on any part of it.
 * `useMotionTransition` reads it from <html> only, as it does the feel.
 */
const motionPreference = createPreference({
  values: ['system', 'reduce'],
  defaultValue: 'system',
  attribute: 'data-motion',
  global: true,
  storage: createLocalStorage('motion'),
})

const KINO_PREFERENCES = [
  colorSchemePreference,
  densityPreference,
  feelPreference,
  shapePreference,
  motionPreference,
]

/**
 * Puts the colour scheme where shadcn's theme reads it: the `dark` or `light`
 * class, and `color-scheme` for the browser's own scrollbars and fields.
 * ui-sdk writes only `data-color-scheme`, the choice, so a `system` choice
 * asks the device. Inlined in the script, so it references nothing outside
 * itself.
 */
function writeScheme(html: HTMLElement, choice: string | null) {
  const scheme =
    choice === 'dark' ||
    (choice !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches)
      ? 'dark'
      : 'light'
  if (html.classList.contains(scheme)) return
  html.classList.remove('light', 'dark')
  html.classList.add(scheme)
  html.style.colorScheme = scheme
}

// After ui-sdk's script, which has put the saved choice on <html>.
const SCHEME_SCRIPT = `(${writeScheme.toString()})(document.documentElement,document.documentElement.getAttribute(${JSON.stringify(colorSchemePreference.attribute)}))`

/** A change of choice, or of the device's scheme while the choice is `system`. */
function showScheme({ value, resolved }: ColorSchemeState) {
  const html = document.documentElement
  if (html.classList.contains(resolved === 'dark' ? 'dark' : 'light')) return
  // Every colour would fade at its own pace: switch them all at once.
  // Only colours: a press or a highlight moving now keeps moving.
  const pause = document.createElement('style')
  pause.textContent =
    '*,*::before,*::after{transition-property:transform,translate,scale,rotate,clip-path,opacity!important}'
  document.head.append(pause)
  writeScheme(html, value)
  commitStyles(html)
  requestAnimationFrame(() => pause.remove())
}

/** The class and `color-scheme` from the first paint on: the script, then each change. */
function SchemeClass({ nonce }: { nonce?: string }) {
  useLayoutEffect(() => {
    writeScheme(document.documentElement, colorSchemePreference.get().value)
    return colorSchemePreference.subscribe(showScheme)
  }, [])
  return (
    <script
      // It runs once, from the server's HTML, after ui-sdk's.
      type={typeof window === 'undefined' ? undefined : 'text/plain'}
      nonce={nonce}
      suppressHydrationWarning
      // oxlint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: SCHEME_SCRIPT }}
    />
  )
}

/**
 * Applies preferences and keeps them applied, Kino's five by default:
 * page-wide ones on <html>, the others on a `display: contents` wrapper
 * around `children`. Put it at the top of <body>, before what it styles, so
 * its script runs before the first paint.
 */
function Preferences({
  preferences = KINO_PREFERENCES,
  nonce,
  children,
  ...props
}: Omit<ComponentProps<typeof PreferencesPrimitive>, 'preferences'> & {
  /** The preferences to apply, from Kino or ui-sdk's `createPreference`. */
  preferences?: readonly PreferenceLike[]
}) {
  return (
    <PreferencesPrimitive preferences={preferences} nonce={nonce} {...props}>
      {preferences.includes(colorSchemePreference) ? <SchemeClass nonce={nonce} /> : null}
      {children}
    </PreferencesPrimitive>
  )
}

export {
  colorSchemePreference,
  densityPreference,
  feelPreference,
  motionPreference,
  Preferences,
  shapePreference,
}

export { SCHEME_SCRIPT as schemeScript }
