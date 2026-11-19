'use client'

import { type ReactNode, useLayoutEffect, useSyncExternalStore } from 'react'

/*
 * A person's preferences, such as a dark theme or a snug density, saved in
 * the browser and written as data attributes that CSS answers, as Kino's
 * tokens do (`data-density`, `data-feel`, `data-shape`). <Preferences> writes
 * them before the first paint, so a saved choice never flashes the default.
 */

/** What a preference is, as plain data the script before the first paint can read. */
interface PreferenceConfig {
  attribute: `data-${string}`
  values: readonly string[]
  defaultValue: string
  storageKey: string | null
  global: boolean
  system: { query: string; matches: string; otherwise: string } | null
  colorScheme: boolean
}

interface PreferenceState<Value extends string, Resolved extends string> {
  /** What the person chose, such as `system`. */
  value: Value
  /** What applies now: `system` turned into what the device asks for. */
  resolved: Resolved
}

interface Preference<Value extends string, Resolved extends string = Value> {
  readonly config: PreferenceConfig
  readonly values: readonly Value[]
  readonly defaultValue: Value
  get: () => PreferenceState<Value, Resolved>
  /** What applies for a value now: `system` turned into what the device asks for. */
  resolve(this: void, value: Value): Resolved
  // A method, so a preference of any values fits where any preference is taken.
  set(this: void, value: Value): void
  subscribe: (onChange: () => void) => () => void
}

interface PreferenceOptions<Value extends string, Resolved extends string> {
  /** The attribute CSS reads, such as `data-view`. */
  attribute: `data-${string}`
  values: readonly Value[]
  defaultValue: NoInfer<Value>
  /** The localStorage key it's saved under, or `null` to keep it for this visit. Defaults to the attribute without `data-`. */
  storageKey?: string | null
  /** On <html>, for the whole page and the popups portalled to it, rather than on what <Preferences> wraps. */
  global?: boolean
  /** What a `system` value follows: the media query, and the value written when it matches and when it doesn't. */
  system?: { query: string; matches: Resolved; otherwise: Resolved }
}

/** The saved value, or `null` when there's none, it isn't allowed, or storage is blocked. Inlined in the script, so it references nothing outside itself. */
function readPreference(config: PreferenceConfig): string | null {
  if (config.storageKey === null) return null
  try {
    const value = localStorage.getItem(config.storageKey)
    return value !== null && config.values.includes(value) ? value : null
  } catch {
    return null
  }
}

/** What applies for a value: `system` asks the media query. Inlined in the script. */
function resolvePreference(config: PreferenceConfig, value: string): string {
  if (value !== 'system' || !config.system) return value
  return window.matchMedia(config.system.query).matches
    ? config.system.matches
    : config.system.otherwise
}

/**
 * Writes a resolved value on an element. A colour scheme also sets the
 * `dark` or `light` class shadcn's theme reads, and `color-scheme` for the
 * browser's own scrollbars and fields. Inlined in the script.
 */
function writePreference(
  element: HTMLElement,
  config: PreferenceConfig,
  resolved: string,
) {
  element.setAttribute(config.attribute, resolved)
  if (!config.colorScheme) return
  element.classList.remove('light', 'dark')
  element.classList.add(resolved)
  element.style.colorScheme = resolved
}

/** Runs before the first paint, from inside what <Preferences> renders. */
function applySaved(
  configs: PreferenceConfig[],
  read: typeof readPreference,
  resolve: typeof resolvePreference,
  write: typeof writePreference,
) {
  const scope = document.currentScript?.parentElement
  for (const config of configs) {
    const element = config.global ? document.documentElement : scope
    if (element)
      write(element, config, resolve(config, read(config) ?? config.defaultValue))
  }
}

function preferencesScript(configs: PreferenceConfig[]): string {
  return `(${applySaved.toString()})(${JSON.stringify(configs)},${readPreference.toString()},${resolvePreference.toString()},${writePreference.toString()})`
}

function makePreference<Value extends string, Resolved extends string>(
  config: PreferenceConfig,
): Preference<Value, Resolved> {
  const listeners = new Set<() => void>()
  let state: PreferenceState<Value, Resolved> | null = null
  let stopListening = () => {}

  const stateOf = (value: string) =>
    ({
      value,
      resolved: resolvePreference(config, value),
    }) as PreferenceState<Value, Resolved>
  const get = () => (state ??= stateOf(readPreference(config) ?? config.defaultValue))
  const update = (value: string) => {
    const next = stateOf(value)
    if (state && next.value === state.value && next.resolved === state.resolved) return
    state = next
    for (const listener of listeners) listener()
  }

  const listen = () => {
    const onStorage = (event: StorageEvent) => {
      // A change in another tab; `null` key means its storage was cleared.
      if (event.key !== null && event.key !== config.storageKey) return
      update(readPreference(config) ?? config.defaultValue)
    }
    window.addEventListener('storage', onStorage)
    const media = config.system ? window.matchMedia(config.system.query) : null
    const onMedia = () => update(get().value)
    media?.addEventListener('change', onMedia)
    return () => {
      window.removeEventListener('storage', onStorage)
      media?.removeEventListener('change', onMedia)
    }
  }

  return {
    config,
    values: config.values as readonly Value[],
    defaultValue: config.defaultValue as Value,
    get,
    resolve: (value) => resolvePreference(config, value) as Resolved,
    set: (value) => {
      if (!config.values.includes(value)) return
      if (config.storageKey !== null) {
        try {
          localStorage.setItem(config.storageKey, value)
        } catch {
          // Blocked or full storage: it still applies for this visit.
        }
      }
      update(value)
    },
    subscribe: (onChange) => {
      if (listeners.size === 0) stopListening = listen()
      listeners.add(onChange)
      return () => {
        listeners.delete(onChange)
        if (listeners.size === 0) stopListening()
      }
    },
  }
}

/** A preference of your own, such as a list or grid view. */
function createPreference<const Value extends string, Resolved extends string = never>({
  attribute,
  values,
  defaultValue,
  storageKey = attribute.slice('data-'.length),
  global = false,
  system,
}: PreferenceOptions<Value, Resolved>): Preference<
  Value,
  Exclude<Value, 'system'> | Resolved
> {
  return makePreference({
    attribute,
    values,
    defaultValue,
    storageKey,
    global,
    system: system ?? null,
    colorScheme: false,
  })
}

/**
 * Light, dark or the device's own, saved under `theme` with next-themes'
 * values, so a project moving from it keeps every visitor's choice.
 */
const colorSchemePreference = makePreference<
  'system' | 'light' | 'dark',
  'light' | 'dark'
>({
  attribute: 'data-color-scheme',
  values: ['system', 'light', 'dark'],
  defaultValue: 'system',
  storageKey: 'theme',
  global: true,
  system: {
    query: '(prefers-color-scheme: dark)',
    matches: 'dark',
    otherwise: 'light',
  },
  colorScheme: true,
})

/** How much room controls, rows and surfaces take (the `theme` item's density tokens). */
const densityPreference = createPreference({
  attribute: 'data-density',
  values: ['snug', 'balanced', 'airy'],
  defaultValue: 'balanced',
  global: true,
})

/** The timing everything moves with (the `theme` item's feels). */
const feelPreference = createPreference({
  attribute: 'data-feel',
  values: ['calm', 'crisp', 'lively'],
  defaultValue: 'crisp',
  global: true,
})

/** How round corners are (the `theme` item's shape tokens). */
const shapePreference = createPreference({
  attribute: 'data-shape',
  values: ['standard', 'round'],
  defaultValue: 'standard',
  global: true,
})

/**
 * Whether to reduce motion as the device asks, or always. The item's CSS
 * makes Tailwind's `motion-reduce:` and `motion-safe:` answer
 * `data-motion='reduce'` too, on the page or on any part of it.
 * `useMotionTransition` reads it from <html> only, as it does the feel.
 */
const motionPreference = createPreference({
  attribute: 'data-motion',
  values: ['system', 'reduce'],
  defaultValue: 'system',
  storageKey: 'motion',
  global: true,
  system: {
    query: '(prefers-reduced-motion: reduce)',
    matches: 'reduce',
    otherwise: 'full',
  },
})

/** Any preference, for the props that take a list of them. */
type AnyPreference = Preference<string, string>

function serverState(config: PreferenceConfig) {
  return {
    value: config.defaultValue,
    // The server can't ask the device: a `system` value takes its `otherwise` until hydration.
    resolved:
      config.defaultValue === 'system' && config.system
        ? config.system.otherwise
        : config.defaultValue,
  }
}

const serverStates = new WeakMap<PreferenceConfig, ReturnType<typeof serverState>>()

function serverSnapshot(config: PreferenceConfig) {
  let state = serverStates.get(config)
  if (!state) serverStates.set(config, (state = serverState(config)))
  return state
}

/** A preference's value and what applies now, and the function that changes it. */
function usePreference<Value extends string, Resolved extends string>(
  preference: Preference<Value, Resolved>,
) {
  const { value, resolved } = useSyncExternalStore(
    preference.subscribe,
    preference.get,
    () => serverSnapshot(preference.config) as PreferenceState<Value, Resolved>,
  )
  return { value, resolved, setValue: preference.set }
}

/** Keeps a page-wide preference on <html> from hydration on, as it changes. */
function useGlobalPreference(preference: AnyPreference) {
  useLayoutEffect(() => {
    const html = document.documentElement
    const { config } = preference
    let applied = preference.get().resolved
    writePreference(html, config, applied)
    return preference.subscribe(() => {
      const { resolved } = preference.get()
      if (resolved === applied) return
      applied = resolved
      if (!config.colorScheme) {
        writePreference(html, config, resolved)
        return
      }
      // Every colour would fade at its own pace: switch them all at once.
      // Only colours: a press or a highlight moving now keeps moving.
      const pause = document.createElement('style')
      pause.textContent =
        '*,*::before,*::after{transition-property:transform,translate,scale,rotate,clip-path,opacity!important}'
      document.head.append(pause)
      writePreference(html, config, resolved)
      void getComputedStyle(html).colorScheme
      requestAnimationFrame(() => pause.remove())
    })
  }, [preference])
}

function GlobalPreference({ preference }: { preference: AnyPreference }) {
  useGlobalPreference(preference)
  return null
}

/** Between the values of the scoped preferences' snapshot. */
const SEPARATOR = '|'

function ScopedPreferences({
  preferences,
  children,
  script,
}: {
  preferences: AnyPreference[]
  children: ReactNode
  script: ReactNode
}) {
  // One snapshot of every scoped preference, so the wrapper subscribes once.
  const snapshot = useSyncExternalStore(
    (onChange) => {
      const stops = preferences.map((preference) => preference.subscribe(onChange))
      return () => stops.forEach((stop) => stop())
    },
    () => preferences.map((preference) => preference.get().resolved).join(SEPARATOR),
    () =>
      preferences
        .map((preference) => serverSnapshot(preference.config).resolved)
        .join(SEPARATOR),
  )
  const values = snapshot.split(SEPARATOR)
  const attributes = Object.fromEntries(
    preferences.map((preference, index) => [preference.config.attribute, values[index]]),
  )
  return (
    // The script corrects these before the first paint, so the server's defaults differ from the page.
    <div
      data-slot='preferences'
      className='contents'
      suppressHydrationWarning
      {...attributes}
    >
      {script}
      {children}
    </div>
  )
}

/**
 * Applies preferences and keeps them applied: page-wide ones on <html>,
 * the others on a `display: contents` wrapper around `children`. Put it
 * high in the page, before what it styles, so its script runs before the
 * first paint.
 */
function Preferences({
  preferences,
  nonce,
  children,
}: {
  preferences: readonly AnyPreference[]
  /** Your Content Security Policy's nonce, for the inline script. */
  nonce?: string
  children?: ReactNode
}) {
  const scoped = preferences.filter((preference) => !preference.config.global)
  const script = (
    <script
      // It runs once, from the server's HTML. React warns on a script it creates on the client, which wouldn't run anyway, and skips the check for a type that isn't JavaScript (Next's guide to preventing flash before hydration).
      type={typeof window === 'undefined' ? undefined : 'text/plain'}
      nonce={nonce}
      suppressHydrationWarning
      // oxlint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{
        __html: preferencesScript(preferences.map((preference) => preference.config)),
      }}
    />
  )
  return (
    <>
      {preferences
        .filter((preference) => preference.config.global)
        .map((preference) => (
          <GlobalPreference key={preference.config.attribute} preference={preference} />
        ))}
      {scoped.length > 0 || children ? (
        <ScopedPreferences preferences={scoped} script={script}>
          {children}
        </ScopedPreferences>
      ) : (
        script
      )}
    </>
  )
}

export {
  colorSchemePreference,
  createPreference,
  densityPreference,
  feelPreference,
  motionPreference,
  Preferences,
  shapePreference,
  usePreference,
}

export { preferencesScript }

export type { Preference, PreferenceOptions, PreferenceState }
