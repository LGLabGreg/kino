'use client'

import { ariaKeyshortcuts } from '@ui-sdk/core'
import { shortcuts } from '@ui-sdk/core/shortcuts'
import {
  Children,
  isValidElement,
  type ReactNode,
  type RefCallback,
  useCallback,
  useEffect,
  useRef,
  useSyncExternalStore,
} from 'react'

/*
 * What a key is called, how it is drawn and spoken, and which keys the person
 * is holding now. Shared by every Kbd: one listener on the window, however
 * many keys a page shows.
 */

/** A key as `KeyboardEvent.key` names it, with letters in lower case and `Mod` for ⌘ or Ctrl. */
export type KeyName = string

const ALIASES: Record<string, KeyName> = {
  '⌘': 'Meta',
  cmd: 'Meta',
  command: 'Meta',
  meta: 'Meta',
  '⌃': 'Control',
  ctrl: 'Control',
  control: 'Control',
  '⌥': 'Alt',
  alt: 'Alt',
  opt: 'Alt',
  option: 'Alt',
  '⇧': 'Shift',
  shift: 'Shift',
  mod: 'Mod',
  '↵': 'Enter',
  '⏎': 'Enter',
  enter: 'Enter',
  return: 'Enter',
  '⎋': 'Escape',
  esc: 'Escape',
  escape: 'Escape',
  '⌫': 'Backspace',
  backspace: 'Backspace',
  '⌦': 'Delete',
  del: 'Delete',
  delete: 'Delete',
  '⇥': 'Tab',
  tab: 'Tab',
  '↑': 'ArrowUp',
  up: 'ArrowUp',
  arrowup: 'ArrowUp',
  '↓': 'ArrowDown',
  down: 'ArrowDown',
  arrowdown: 'ArrowDown',
  '←': 'ArrowLeft',
  left: 'ArrowLeft',
  arrowleft: 'ArrowLeft',
  '→': 'ArrowRight',
  right: 'ArrowRight',
  arrowright: 'ArrowRight',
  '␣': ' ',
  space: ' ',
  pgup: 'PageUp',
  pageup: 'PageUp',
  'page up': 'PageUp',
  pgdn: 'PageDown',
  pagedown: 'PageDown',
  'page down': 'PageDown',
  home: 'Home',
  end: 'End',
}

/** The key a label names: `⌘` and `Cmd` are `Meta`, `K` is `k`, `Page Down` is `PageDown`. */
export function keyFromLabel(label: string): KeyName {
  const trimmed = label.trim()
  const alias = ALIASES[trimmed.toLowerCase()]
  if (alias) return alias
  if (/^f\d{1,2}$/i.test(trimmed)) return trimmed.toUpperCase()
  return trimmed.length === 1 ? trimmed.toLowerCase() : trimmed
}

/** `Mod` is Command on Apple's systems and Control everywhere else. */
export function resolveKey(key: KeyName, apple: boolean): KeyName {
  if (key === 'Mod') return apple ? 'Meta' : 'Control'
  return key
}

/** What a key shows, by each platform's own convention: ⌘ on a Mac, Ctrl elsewhere. */
export function keyLabel(key: KeyName, apple: boolean): string {
  const resolved = resolveKey(key, apple)
  const labels: Record<string, [mac: string, other: string]> = {
    Meta: ['⌘', 'Win'],
    Control: ['⌃', 'Ctrl'],
    Alt: ['⌥', 'Alt'],
    Shift: ['⇧', 'Shift'],
    Enter: ['↵', 'Enter'],
    Escape: ['Esc', 'Esc'],
    Backspace: ['⌫', 'Backspace'],
    Delete: ['⌦', 'Del'],
    Tab: ['⇥', 'Tab'],
    ArrowUp: ['↑', '↑'],
    ArrowDown: ['↓', '↓'],
    ArrowLeft: ['←', '←'],
    ArrowRight: ['→', '→'],
    ' ': ['Space', 'Space'],
    PageUp: ['Page Up', 'Page Up'],
    PageDown: ['Page Down', 'Page Down'],
  }
  const label = labels[resolved]
  if (label) return label[apple ? 0 : 1]
  return resolved.length === 1 ? resolved.toUpperCase() : resolved
}

/** A key in words, as a screen reader should say it: `Command`, `Up arrow`, `K`. */
export function keyWord(key: KeyName, apple: boolean): string {
  const resolved = resolveKey(key, apple)
  const words: Record<string, string> = {
    Meta: apple ? 'Command' : 'Windows',
    Control: 'Control',
    Alt: apple ? 'Option' : 'Alt',
    Shift: 'Shift',
    Enter: apple ? 'Return' : 'Enter',
    Escape: 'Escape',
    Backspace: apple ? 'Delete' : 'Backspace',
    Delete: 'Forward delete',
    Tab: 'Tab',
    ArrowUp: 'Up arrow',
    ArrowDown: 'Down arrow',
    ArrowLeft: 'Left arrow',
    ArrowRight: 'Right arrow',
    ' ': 'Space',
    PageUp: 'Page up',
    PageDown: 'Page down',
    '/': 'Slash',
    '\\': 'Backslash',
    '?': 'Question mark',
    ',': 'Comma',
    '.': 'Period',
    '+': 'Plus',
    '-': 'Minus',
    '[': 'Left bracket',
    ']': 'Right bracket',
  }
  return words[resolved] ?? (resolved.length === 1 ? resolved.toUpperCase() : resolved)
}

/**
 * The words to read in place of a label drawn as a symbol (⌘, ↵, /), or
 * undefined when it reads well as it is (`Ctrl`, `K`, `F2`). Screen readers
 * speak symbols unevenly and ignore a name on a `kbd`, so the symbol is
 * hidden and these words are read instead. The modifier symbols are Apple's,
 * so they are read as a Mac names them on any system.
 */
export function spokenLabel(label: string): string | undefined {
  if (/^[\p{L}\p{N} ]+$/u.test(label)) return undefined
  return keyWord(keyFromLabel(label), true)
}

const NAMED = new Set([
  'Meta',
  'Control',
  'Alt',
  'Shift',
  'Enter',
  'Escape',
  'Backspace',
  'Delete',
  'Tab',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'PageUp',
  'PageDown',
  'Home',
  'End',
  ' ',
])

/**
 * Every name a key press answers to. A letter answers by its position as
 * well as by what it typed, because ⌥ and ⇧ change what a key types (⌥K
 * types ˚) but not which key it is.
 */
export function eventKeys({ key, code }: Pick<KeyboardEvent, 'key' | 'code'>): KeyName[] {
  if (NAMED.has(key) || /^F\d{1,2}$/.test(key)) return [key]
  const names = new Set<KeyName>()
  if (key.length === 1) names.add(key.toLowerCase())
  const letter = /^Key([A-Z])$/.exec(code)
  if (letter) names.add(letter[1].toLowerCase())
  const digit = /^Digit(\d)$/.exec(code)
  if (digit) names.add(digit[1])
  return [...names]
}

const MODIFIERS = new Set(['Meta', 'Control', 'Alt', 'Shift'])

/**
 * Whether a press only types into a field, so no shortcut runs and no hint
 * should answer it: a key other than a modifier, in a text field, with no
 * modifier but Shift.
 */
export function onlyTypes(
  {
    key,
    ctrlKey,
    metaKey,
    altKey,
  }: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey'>,
  inField: boolean,
) {
  // ⌥ with a letter types a character on a Mac (⌥C is ç), and a dead key starts one.
  return (
    inField &&
    !MODIFIERS.has(key) &&
    !ctrlKey &&
    !metaKey &&
    (!altKey || key.length === 1 || key === 'Dead')
  )
}

/**
 * Runs `onPress` when the person presses `keys`, ui-sdk's shortcut string
 * (`'mod+k'`, `'/'`), through ui-sdk's one shortcut listener. A plain key
 * typed in a field stays text, and a modal over the page pauses it. `layer`
 * is ui-sdk's: an element on the page, or one inside a popup, so the
 * shortcut runs while that popup is open, such as ⌘K closing the dialog it
 * opened.
 */
export function useShortcut(
  keys: string | null | undefined,
  onPress: (event: KeyboardEvent) => void,
  layer?: Element | null,
) {
  const press = useRef(onPress)
  useEffect(() => {
    press.current = onPress
  })
  useEffect(() => {
    if (!keys) return undefined
    return shortcuts.register(keys, (event) => press.current(event), {
      layer: layer ?? undefined,
    })
  }, [keys, layer])
}

/**
 * A ref callback that sets `aria-keyshortcuts` from ui-sdk's shortcut string
 * once the element is in the page, where the platform is known, so the
 * server's and the client's first render agree.
 */
export function useAriaKeyshortcuts(
  keys: string | null | undefined,
): RefCallback<Element> {
  return useCallback(
    (element: Element | null) => {
      if (!element || !keys) return undefined
      element.setAttribute('aria-keyshortcuts', ariaKeyshortcuts(keys))
      return () => element.removeAttribute('aria-keyshortcuts')
    },
    [keys],
  )
}

/** The keys of ui-sdk's shortcut string, each as `Kbd` names it: `'mod+shift+k'` is Mod, Shift, k. */
export function shortcutKeys(keys: string): KeyName[] {
  return keys.split('+').map(keyFromLabel)
}

function inField(target: EventTarget | null) {
  return (
    target instanceof Element &&
    target.closest(
      'input, textarea, select, [contenteditable]:not([contenteditable="false"])',
    ) !== null
  )
}

/** Each held key, with the physical keys holding it: both Shift keys hold `Shift`. */
const held = new Map<KeyName, Set<string>>()
const listeners = new Set<() => void>()

function notify() {
  for (const listener of listeners) listener()
}

function release() {
  if (held.size === 0) return
  held.clear()
  notify()
}

function onKeyDown(event: KeyboardEvent) {
  if (event.repeat || onlyTypes(event, inField(event.target))) return
  for (const name of eventKeys(event)) {
    const codes = held.get(name) ?? new Set()
    codes.add(event.code)
    held.set(name, codes)
  }
  notify()
}

function onKeyUp(event: KeyboardEvent) {
  // While ⌘ is down a Mac sends no keyup for the other keys, so letting go of ⌘ lets go of all of them.
  if (event.key === 'Meta') return release()
  let changed = false
  for (const [name, codes] of held) {
    if (!codes.delete(event.code)) continue
    changed = true
    if (codes.size === 0) held.delete(name)
  }
  if (changed) notify()
}

function onVisibility() {
  if (document.hidden) release()
}

/** Listens while any key is shown, and lets every key go when the window loses focus. */
export function subscribeToHeldKeys(listener: () => void) {
  if (listeners.size === 0) {
    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('keyup', onKeyUp, true)
    window.addEventListener('blur', release)
    document.addEventListener('visibilitychange', onVisibility)
  }
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
    if (listeners.size > 0) return
    window.removeEventListener('keydown', onKeyDown, true)
    window.removeEventListener('keyup', onKeyUp, true)
    window.removeEventListener('blur', release)
    document.removeEventListener('visibilitychange', onVisibility)
    held.clear()
  }
}

export function isHeld(key: KeyName) {
  return held.has(key)
}

/** Apple's systems, where ⌘ takes Ctrl's place. */
export function isApplePlatform(platform: string) {
  return /mac|iphone|ipad|ipod/i.test(platform)
}

/** Apple writes modifiers ⌃⌥⇧⌘; Windows writes Win, Ctrl, Alt, Shift. */
const MODIFIER_ORDER = {
  apple: ['Control', 'Alt', 'Shift', 'Meta'],
  other: ['Meta', 'Control', 'Alt', 'Shift'],
} as const

/**
 * The keys of a shortcut in the order the platform writes them: modifiers
 * first, in its own order, then the rest as given. `Mod+Shift+Z` is ⇧⌘Z on a
 * Mac and Ctrl+Shift+Z elsewhere.
 */
export function orderKeys<T>(keys: { key: KeyName; item: T }[], apple: boolean): T[] {
  const order: readonly string[] = MODIFIER_ORDER[apple ? 'apple' : 'other']
  const rank = (key: KeyName) => {
    const index = order.indexOf(resolveKey(key, apple))
    return index === -1 ? order.length : index
  }
  return keys
    .map((entry, index) => ({ ...entry, index }))
    .sort((a, b) => rank(a.key) - rank(b.key) || a.index - b.index)
    .map(({ item }) => item)
}

function subscribeToNothing() {
  return () => {}
}

function readPlatform() {
  const agent = navigator as Navigator & {
    userAgentData?: { platform?: string }
  }
  return isApplePlatform(agent.userAgentData?.platform ?? navigator.platform)
}

/** Whether the page runs on Apple's systems; false while it renders on the server. */
export function useApplePlatform() {
  return useSyncExternalStore(subscribeToNothing, readPlatform, () => false)
}

export interface KbdKeyProps {
  /**
   * The key, as `KeyboardEvent.key` names it (`ArrowUp`, `Enter`), or `Mod`
   * for ⌘ on a Mac and Ctrl elsewhere. Read from the label when it is text;
   * needed when the label is an icon.
   */
  name?: KeyName
  children?: ReactNode
}

/**
 * Which key a Kbd shows, what it draws and says, and whether the person is
 * holding it now. Only a key whose held state changes renders again.
 */
export function useKbdKey({ name, children }: KbdKeyProps) {
  const apple = useApplePlatform()
  const text = typeof children === 'string' ? children : undefined
  const key = resolveKey(name ?? (text === undefined ? '' : keyFromLabel(text)), apple)
  const held = useSyncExternalStore(
    subscribeToHeldKeys,
    () => key !== '' && isHeld(key),
    () => false,
  )
  // A modifier, `Mod` or a key given only by name is drawn the platform's way: ⇧⌘ on a Mac, Ctrl+Shift elsewhere.
  const drawn =
    children === undefined || MODIFIERS.has(key) ? keyLabel(key, apple) : children
  const spoken =
    typeof drawn === 'string' ? spokenLabel(drawn) : key ? keyWord(key, apple) : undefined
  const label = spoken ? (
    <>
      <span aria-hidden className='inline-flex items-center'>
        {drawn}
      </span>
      <span className='sr-only'>{spoken}</span>
    </>
  ) : (
    drawn
  )
  return { key, held, apple, label }
}

/** A group's keys in the order the platform writes a shortcut (`orderKeys`). */
export function useOrderedKeys(children: ReactNode) {
  const apple = useApplePlatform()
  const keys = Children.toArray(children).map((item) => {
    if (!isValidElement<KbdKeyProps>(item)) return { key: '', item }
    const { name, children: label } = item.props
    return {
      key: name ?? (typeof label === 'string' ? keyFromLabel(label) : ''),
      item,
    }
  })
  return { apple, keys: orderKeys(keys, apple) }
}
