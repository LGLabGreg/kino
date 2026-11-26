'use client'

import { addDays, daysAgoInline, today } from '@/registry/lib/dates'
import { type ReactNode, useDeferredValue, useSyncExternalStore } from 'react'

/*
 * What a visitor agreed to, by category, such as analytics or marketing:
 * kept in the browser for a few months, asked again when it runs out or when
 * the categories change, and read with `useConsent` to hold scripts back
 * until their category is on. The Cookie consent block asks for it; a link
 * anywhere reopens it with `consent.open`. Saved in localStorage, which
 * Safari keeps while the site is visited, where a cookie a script writes
 * lasts seven days.
 */

/** A Google Consent Mode type, which Google's tags read before they set cookies. */
type GoogleConsentType =
  | 'ad_storage'
  | 'ad_user_data'
  | 'ad_personalization'
  | 'analytics_storage'
  | 'functionality_storage'
  | 'personalization_storage'
  | 'security_storage'

interface ConsentCategory<Id extends string = string> {
  id: Id
  label: string
  /** What it's for, in a sentence a visitor reads before turning it on. */
  description: string
  /** Always on, such as what keeps someone signed in: shown on and locked. */
  required?: boolean
  /** The tools it covers, named under it, such as `PostHog`. */
  services?: readonly string[]
  /** The Google Consent Mode types it grants. */
  google?: readonly GoogleConsentType[]
  /** Kept off while the browser sends Global Privacy Control, which asks sites not to sell or share data. */
  gpc?: boolean
}

interface ConsentChoice<Id extends string = string> {
  /** The categories turned on, other than the required ones, which always are. */
  granted: readonly Id[]
  /** The day it was given, as `yyyy-mm-dd`: it holds for `expiresAfterDays` from then. */
  date: string
  /** The `revision` it was given under: a newer one asks again. */
  revision: number
}

type ConsentState<Id extends string = string> =
  /** On the server and before hydration: nothing is granted and nothing shows. */
  | { status: 'unknown' }
  /**
   * The banner shows: nothing valid is saved, or `open` was called, which
   * asks for its settings. `choice` is what still applies meanwhile.
   */
  | { status: 'asking'; choice: ConsentChoice<Id> | null; opened: boolean }
  | { status: 'given'; choice: ConsentChoice<Id> }

interface ConsentOptions<Id extends string> {
  categories: readonly ConsentCategory<Id>[]
  /** Raise it when the categories or what they cover change, to ask everyone again. */
  revision?: number
  /** How long a choice is kept before the banner asks again. Six months, as France's CNIL advises. */
  expiresAfterDays?: number
  /** The localStorage key it's saved under; `null` keeps the choice for this visit only, as a preview does. */
  storageKey?: string | null
}

interface Consent<Id extends string = string> {
  readonly categories: readonly ConsentCategory<Id>[]
  /** What the script before the first paint reads. */
  readonly config: ConsentConfig
  get: () => ConsentState<Id>
  /** Whether the browser sends Global Privacy Control, which keeps the `gpc` categories off. */
  gpc: () => boolean
  /** Whether a category is on now: a required one always is, another once it is granted. */
  has: (id: Id) => boolean
  /** Saves which optional categories are on; the rest are off. */
  save: (granted: readonly Id[]) => void
  /** Shows the banner again on its settings, so a choice is changed as easily as it was given. */
  open: () => void
  subscribe: (onChange: () => void) => () => void
}

/** What the script before the first paint needs, as plain data. */
interface ConsentConfig {
  storageKey: string | null
  revision: number
  expiresAfterDays: number
  /** Each category's id, with what it grants Google and whether GPC keeps it off. */
  categories: {
    id: string
    required: boolean
    google: readonly string[]
    gpc: boolean
  }[]
}

/**
 * The saved choice, when it is still valid: well formed, under `revision`
 * and given after `since`, the day a choice kept `expiresAfterDays` would
 * have to be given after to hold today. `null` when there's none, storage
 * is blocked or it was kept by hand. Inlined in the script, so it
 * references nothing outside itself.
 */
function readChoice(storageKey: string | null, revision: number, since: string) {
  if (storageKey === null) return null
  let value: unknown
  try {
    value = JSON.parse(localStorage.getItem(storageKey) ?? 'null')
  } catch {
    return null
  }
  if (typeof value !== 'object' || value === null) return null
  const { granted, date } = value as Record<string, unknown>
  if (
    !Array.isArray(granted) ||
    !granted.every((id) => typeof id === 'string') ||
    typeof date !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    (value as { revision?: unknown }).revision !== revision ||
    date <= since
  )
    return null
  return { granted: granted as string[], date, revision }
}

/**
 * Every Google Consent Mode type the categories name, granted when a
 * category that is on names it and denied otherwise. Inlined in the script.
 */
function googleConsent(
  categories: ConsentConfig['categories'],
  isOn: (category: ConsentConfig['categories'][number]) => boolean,
): Record<string, 'granted' | 'denied'> {
  const types: Record<string, 'granted' | 'denied'> = {}
  for (const category of categories) {
    for (const type of category.google) {
      if (isOn(category)) types[type] = 'granted'
      else types[type] ??= 'denied'
    }
  }
  return types
}

/** Whether a category is on, for a choice and the browser's GPC. */
function isGranted(
  category: { id: string; required?: boolean; gpc?: boolean },
  choice: { granted: readonly string[] } | null,
  gpc: boolean,
): boolean {
  if (category.required) return true
  if (category.gpc && gpc) return false
  return choice?.granted.includes(category.id) ?? false
}

/**
 * Runs before the first paint, from `<head>`: Google's tags start with every
 * type denied, and a saved choice grants its own before they load.
 */
function applySavedConsent(
  config: ConsentConfig,
  read: typeof readChoice,
  google: typeof googleConsent,
  granted: typeof isGranted,
  daysAgo: typeof daysAgoInline,
) {
  const page = window as unknown as {
    dataLayer?: unknown[]
    gtag?: (...args: unknown[]) => void
  }
  const dataLayer = (page.dataLayer ??= [])
  // Google's own snippet: its tag reads each call's `arguments` object, not an
  // array. Nothing in this script is named, so it runs as written once inlined.
  page.gtag ??= function () {
    // eslint-disable-next-line prefer-rest-params -- Google's tag reads each call's arguments object
    dataLayer.push(arguments)
  }
  const gtag = page.gtag
  const denied = google(config.categories, () => false)
  gtag('consent', 'default', { ...denied, wait_for_update: 500 })
  const choice = read(
    config.storageKey,
    config.revision,
    daysAgo(config.expiresAfterDays),
  )
  const gpc =
    (navigator as { globalPrivacyControl?: boolean }).globalPrivacyControl === true
  if (choice)
    gtag(
      'consent',
      'update',
      google(config.categories, (category) => granted(category, choice, gpc)),
    )
}

function consentScript(config: ConsentConfig): string {
  return `(${applySavedConsent.toString()})(${JSON.stringify(config)},${readChoice.toString()},${googleConsent.toString()},${isGranted.toString()},${daysAgoInline.toString()})`
}

/** Tells Google's tags what is on now, when the page has them. */
function updateGoogle(config: ConsentConfig, choice: ConsentChoice | null, gpc: boolean) {
  const types = googleConsent(config.categories, (category) =>
    isGranted(category, choice, gpc),
  )
  if (Object.keys(types).length === 0) return
  const { gtag } = window as unknown as { gtag?: (...args: unknown[]) => void }
  gtag?.('consent', 'update', types)
}

/** The state for what is saved and whether the banner was opened. */
function stateOf<Id extends string>(
  choice: ConsentChoice<Id> | null,
  opened: boolean,
): ConsentState<Id> {
  return choice && !opened
    ? { status: 'given', choice }
    : { status: 'asking', choice, opened }
}

/** The choice to save: the optional categories it turns on that GPC leaves free, given `on` the day it is. */
function choiceFor<Id extends string>(
  categories: readonly ConsentCategory<Id>[],
  granted: readonly Id[],
  { on, revision, gpc }: { on: string; revision: number; gpc: boolean },
): ConsentChoice<Id> {
  return {
    granted: categories
      .filter(
        (category) =>
          !category.required && !(category.gpc && gpc) && granted.includes(category.id),
      )
      .map((category) => category.id),
    date: on,
    revision,
  }
}

function createConsent<const Id extends string>({
  categories,
  revision = 1,
  expiresAfterDays = 182,
  storageKey = 'consent',
}: ConsentOptions<Id>): Consent<Id> {
  const config: ConsentConfig = {
    storageKey,
    revision,
    expiresAfterDays,
    categories: categories.map((category) => ({
      id: category.id,
      required: category.required ?? false,
      google: category.google ?? [],
      gpc: category.gpc ?? false,
    })),
  }
  const ids = new Set<string>(categories.map((category) => category.id))
  const listeners = new Set<() => void>()
  let saved: ConsentChoice<Id> | null | undefined
  let opened = false
  let state: ConsentState<Id> | null = null
  let stopListening = () => {}

  const gpc = () =>
    typeof navigator !== 'undefined' &&
    (navigator as { globalPrivacyControl?: boolean }).globalPrivacyControl === true
  const read = (): ConsentChoice<Id> | null => {
    const choice = readChoice(storageKey, revision, addDays(today(), -expiresAfterDays))
    if (!choice) return null
    // A category since removed is dropped, so it can't come back granted.
    return {
      ...choice,
      granted: choice.granted.filter((id): id is Id => ids.has(id)),
    }
  }
  const choice = () => (saved === undefined ? (saved = read()) : saved)
  const get = () => (state ??= stateOf(choice(), opened))
  const changed = () => {
    state = null
    for (const listener of listeners) listener()
  }

  return {
    categories,
    config,
    get,
    gpc,
    has: (id) => {
      const category = categories.find((each) => each.id === id)
      return category ? isGranted(category, choice(), gpc()) : false
    },
    save: (granted) => {
      const next = choiceFor(categories, granted, {
        on: today(),
        revision,
        gpc: gpc(),
      })
      try {
        if (storageKey !== null) localStorage.setItem(storageKey, JSON.stringify(next))
      } catch {
        // Blocked or full storage: the choice still holds for this visit.
      }
      saved = next
      opened = false
      updateGoogle(config, next, gpc())
      changed()
    },
    open: () => {
      if (opened) return
      opened = true
      changed()
    },
    subscribe: (onChange) => {
      if (listeners.size === 0 && storageKey !== null) {
        // A choice made in another tab; a `null` key means its storage was cleared.
        const onStorage = (event: StorageEvent) => {
          if (event.key !== null && event.key !== storageKey) return
          saved = read()
          updateGoogle(config, saved, gpc())
          changed()
        }
        window.addEventListener('storage', onStorage)
        stopListening = () => window.removeEventListener('storage', onStorage)
      }
      listeners.add(onChange)
      return () => {
        listeners.delete(onChange)
        if (listeners.size === 0) stopListening()
      }
    },
  }
}

const UNKNOWN: ConsentState<never> = { status: 'unknown' }
const serverState = () => UNKNOWN

/** The consent's state, whether a category is on, and the functions that change it. */
function useConsent<Id extends string>(consent: Consent<Id>) {
  const state = useSyncExternalStore(consent.subscribe, consent.get, serverState)
  const has = (id: Id) => {
    if (state.status === 'unknown') return false
    const category = consent.categories.find((each) => each.id === id)
    return category ? isGranted(category, state.choice, consent.gpc()) : false
  }
  return { state, has, save: consent.save, open: consent.open }
}

/**
 * Renders `children`, such as an analytics script, only while `category` is
 * on. They mount once the press that granted it has painted, so the banner
 * answers first.
 */
function ConsentGate<Id extends string>({
  consent,
  category,
  children,
}: {
  consent: Consent<Id>
  category: Id
  children: ReactNode
}) {
  const on = useDeferredValue(useConsent(consent).has(category))
  return on ? children : null
}

/**
 * Starts Google's tags with every type denied, then grants what a saved
 * choice turned on, before they load. Put it in `<head>`, before Google's
 * own script.
 */
function ConsentScript({
  consent,
  nonce,
}: {
  consent: Consent
  /** Your Content Security Policy's nonce, for the inline script. */
  nonce?: string
}) {
  return (
    <script
      // It runs once, from the server's HTML, as the Preferences item's colour scheme script does.
      type={typeof window === 'undefined' ? undefined : 'text/plain'}
      nonce={nonce}
      suppressHydrationWarning
      // oxlint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: consentScript(consent.config) }}
    />
  )
}

export { ConsentGate, ConsentScript, createConsent, useConsent }

export { choiceFor, consentScript, googleConsent, isGranted, readChoice, stateOf }

export type { Consent, ConsentCategory, ConsentChoice, ConsentOptions, ConsentState }
