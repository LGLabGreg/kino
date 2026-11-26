'use client'

import {
  type FormStatus,
  formValues,
  useFormSubmission,
} from '@/registry/components/kino/field'
import { announce } from '@/registry/lib/announce'
import { isComposing, matchesShortcut, useApplePlatform } from '@/registry/lib/keys'
import { refuse } from '@/registry/lib/refuse'
import { transitionsQuiet } from '@/registry/lib/resize'
import { revealBehavior } from '@/registry/lib/scroll'
import {
  type FocusEvent as ReactFocusEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'

/*
 * What a form has changed since it was last saved, read from what it sends:
 * its FormData, with every named control it holds, so a box that is off
 * still counts. The values the form starts with, and those of each save
 * that works, are the baseline; a control that appears later joins it as it
 * is. The Save bar's.
 */

type Values = Map<string, unknown>

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    Object.getPrototypeOf(value) === Object.prototype
  )
}

function isBlank(value: unknown) {
  return (
    value === undefined ||
    value === null ||
    value === '' ||
    // What an empty file input sends: a new one each time it is read.
    (typeof File !== 'undefined' && value instanceof File && !value.name && !value.size)
  )
}

/**
 * What a form sends, by name, in the order it holds its controls: a named
 * control that sends nothing, such as a box that is off, is blank.
 */
export function formState(form: HTMLFormElement): Values {
  const values: Values = new Map()
  for (const control of form.elements) {
    const name = control.getAttribute('name')
    if (name && !values.has(name)) values.set(name, '')
  }
  for (const [name, value] of Object.entries(formValues(form))) {
    values.set(name, value)
  }
  return values
}

/** Where a hook outside a Kino Form reads its form from: nowhere. */
const noForm: RefObject<HTMLFormElement | null> = { current: null }

/** Whether two field values are the same: equal, both blank, or arrays and plain objects whose items are. */
export function sameValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b) || (isBlank(a) && isBlank(b))) return true
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, index) => sameValue(item, b[index]))
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const keys = Object.keys(a)
    return (
      keys.length === Object.keys(b).length &&
      keys.every((key) => Object.hasOwn(b, key) && sameValue(a[key], b[key]))
    )
  }
  return false
}

/**
 * The names whose value differs from the baseline's, in the order the form
 * holds them. A name the baseline doesn't have yet is added to it as it is,
 * so a field that appears later starts unchanged.
 */
export function changedNames(baseline: Values, values: Values): string[] {
  const changed: string[] = []
  for (const [name, value] of values) {
    if (!baseline.has(name)) baseline.set(name, value)
    else if (!sameValue(baseline.get(name), value)) changed.push(name)
  }
  return changed
}

function sameNames(a: readonly string[], b: readonly string[]) {
  return a.length === b.length && a.every((name, index) => name === b[index])
}

/**
 * Whether a click on `link` leaves the page in this tab: a plain press on a
 * link to another page, not a new tab, a download or a jump within the page.
 */
export function leavesPage(
  click: Pick<
    MouseEvent,
    'button' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'defaultPrevented'
  >,
  link: { href: string; target: string; hasDownload: boolean },
  here: string,
): boolean {
  if (click.defaultPrevented || click.button !== 0) return false
  if (click.metaKey || click.ctrlKey || click.shiftKey || click.altKey) return false
  if (link.hasDownload || (link.target !== '' && link.target !== '_self')) return false
  const to = new URL(link.href, here)
  const from = new URL(here)
  if (!/^https?:$/.test(to.protocol)) return false
  // Only the hash differs: it scrolls this page.
  return !(
    to.origin === from.origin &&
    to.pathname === from.pathname &&
    to.search === from.search &&
    to.hash !== ''
  )
}

/**
 * The names of the fields whose value differs from the last save, or from
 * where the form started, and whether they have been read since the last save
 * that worked: until then, they are the old ones. Inside a Kino Form, which
 * moves the baseline on each save that works, and reads again after a reset.
 */
export function useFormChanges() {
  const submission = useFormSubmission()
  const elementRef = submission?.formRef ?? noForm
  const baseline = useRef<Values>(new Map())
  const [changed, setChanged] = useState<string[]>([])
  const read = useRef(() => {})
  // How many saves the baseline holds, and how many the last read had.
  const savesTaken = useRef(0)
  const [savesRead, setSavesRead] = useState(0)

  useEffect(() => {
    const form = elementRef.current
    if (!form) return undefined
    let frame = 0
    const readNow = () => {
      frame = 0
      const next = changedNames(baseline.current, formState(form))
      setChanged((last) => (sameNames(last, next) ? last : next))
      setSavesRead(savesTaken.current)
    }
    // A frame later, so a change that renders has rendered, and many changes are read once.
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(readNow)
    }
    read.current = schedule
    readNow()
    // Typing changes no markup; every other control's value shows in its attributes or text.
    form.addEventListener('input', schedule, true)
    form.addEventListener('change', schedule, true)
    const observer = new MutationObserver(schedule)
    observer.observe(form, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    })
    return () => {
      cancelAnimationFrame(frame)
      form.removeEventListener('input', schedule, true)
      form.removeEventListener('change', schedule, true)
      observer.disconnect()
    }
  }, [elementRef])

  // What a save sent is the new baseline, even if the person typed on meanwhile.
  const saved = submission?.saved
  useEffect(() => {
    if (!saved) return
    // A name the save didn't send, such as a box that is off, was sent blank.
    for (const name of baseline.current.keys()) {
      baseline.current.set(name, saved.values[name] ?? '')
    }
    for (const [name, value] of Object.entries(saved.values)) {
      baseline.current.set(name, value)
    }
    savesTaken.current = saved.count
    read.current()
  }, [saved])

  return { changed, current: savesRead === (saved?.count ?? 0) }
}

/** Presses on a link a guard has stopped, which the other guards answer too. */
const answered = new WeakSet<Event>()

/**
 * While `active`, a try to leave the page calls `onBlocked` instead: a link
 * pressed, or Back and Forward where the browser lets a page stop them.
 * Closing or reloading the tab asks the browser's own question.
 */
export function useLeaveGuard(active: boolean, onBlocked: () => void) {
  const blocked = useRef(onBlocked)
  useEffect(() => {
    blocked.current = onBlocked
  })
  useEffect(() => {
    if (!active) return undefined
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      // Older browsers ask only when it's set; they show their own words.
      event.returnValue = ''
    }
    // Before the router's own handler, which listens on the root it renders into.
    const onClick = (event: MouseEvent) => {
      const link = (event.target as Element | null)?.closest?.('a[href]')
      if (!(link instanceof HTMLAnchorElement)) return
      // Another form's guard may have stopped it first: each one with changes says no.
      const stopped = answered.has(event)
      const leaves = leavesPage(
        {
          button: event.button,
          metaKey: event.metaKey,
          ctrlKey: event.ctrlKey,
          shiftKey: event.shiftKey,
          altKey: event.altKey,
          defaultPrevented: event.defaultPrevented && !stopped,
        },
        {
          href: link.href,
          target: link.target,
          hasDownload: link.hasAttribute('download'),
        },
        window.location.href,
      )
      if (!leaves) return
      answered.add(event)
      event.preventDefault()
      event.stopPropagation()
      blocked.current()
    }
    const navigation = (window as { navigation?: EventTarget }).navigation
    const onNavigate = (event: Event) => {
      const navigate = event as Event & {
        navigationType?: string
        hashChange?: boolean
      }
      if (navigate.navigationType !== 'traverse' || navigate.hashChange) return
      if (!navigate.cancelable) return
      event.preventDefault()
      blocked.current()
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    document.addEventListener('click', onClick, true)
    navigation?.addEventListener('navigate', onNavigate)
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload)
      document.removeEventListener('click', onClick, true)
      navigation?.removeEventListener('navigate', onNavigate)
    }
  }, [active])
}

/** Where a save bar is: what it says, and whether it shows. */
type SaveBarView = 'changed' | 'saving' | 'saved' | 'failed' | 'blocked'

/**
 * Whether ⌘S pressed at a place is this form's to save: pressed in the form
 * or in its own bar, which sits outside it, or anywhere outside every form
 * and bar, unless something there took the press first.
 */
export function ownsSaveShortcut(press: {
  inForm: boolean
  inBar: boolean
  inOtherForm: boolean
  inOtherBar: boolean
  taken: boolean
}) {
  if (press.inForm || press.inBar) return true
  return !(press.taken || press.inOtherForm || press.inOtherBar)
}

/** What a save bar says in each view, for the screen reader and on the bar. */
const SAVE_BAR_TEXT: Record<SaveBarView, string> = {
  changed: 'Unsaved changes',
  saving: 'Saving changes',
  saved: 'Changes saved',
  failed: "Couldn't save",
  blocked: 'Save or discard first',
}

/** The controls in `form` that can take focus, outside its save bar. */
function formControls(form: HTMLElement | null, bar: HTMLElement | null) {
  return [...(form?.querySelectorAll<HTMLElement>(CONTROLS) ?? [])].filter(
    (control) => !bar?.contains(control),
  )
}

/** The bars open now, in the order they opened. */
const stacked: { box: HTMLElement; element: HTMLElement }[] = []

/** The space between two stacked bars, in px. */
const STACK_GAP = 8

/** Lifts each open bar above the ones that opened before it; a bar placed in the page rather than on the screen takes no part. */
function restack() {
  let lift = 0
  for (const { box, element } of stacked) {
    if (getComputedStyle(box).position !== 'fixed') continue
    box.style.setProperty('--save-bar-stack', `${lift}px`)
    lift += element.offsetHeight + STACK_GAP
  }
}

/** What can take focus, for handing focus back by its place, and on around a bar that renders away from its form. */
const CONTROLS =
  'a[href], input:not([type=hidden]):not([disabled]), textarea:not([disabled]), select:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * The element Tab reaches before or after `from` in the page's order,
 * outside every element in `skip`: shown, not inert, and not taken out of
 * the Tab order, as a list's unpicked tabs are.
 */
function tabNeighbour(from: Element, after: boolean, skip: (Element | null)[]) {
  const all = [...from.ownerDocument.querySelectorAll<HTMLElement>(CONTROLS)].filter(
    (element) =>
      element !== from &&
      element.tabIndex >= 0 &&
      !skip.some((part) => part?.contains(element)) &&
      element.getClientRects().length > 0 &&
      !element.closest('[inert]'),
  )
  const following = (element: Element) =>
    Boolean(from.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING)
  return after ? all.find(following) : all.findLast((element) => !following(element))
}

interface Box {
  top: number
  bottom: number
  left: number
  right: number
}

/**
 * How far a control must keep from the screen's edge to clear a fixed bar on
 * that edge, with a little room: the bar's edge and the scroll margin for it,
 * or `null` when the bar doesn't cover the control.
 */
export function clearance(
  control: Box,
  bar: Box,
  screenHeight: number,
  room = 8,
): { side: 'top' | 'bottom'; size: number } | null {
  const across = control.left < bar.right && control.right > bar.left
  const down = control.top < bar.bottom && control.bottom > bar.top
  if (!across || !down) return null
  const onBottom = bar.top + bar.bottom > screenHeight
  return onBottom
    ? { side: 'bottom', size: screenHeight - bar.top + room }
    : { side: 'top', size: bar.bottom + room }
}

/**
 * Everything a save bar does besides how it looks, for the Save bar inside a
 * Kino Form: whether it shows, what it says, Discard and Save, ⌘S, the leave
 * guard with its swell, the announcements, and where focus goes when it
 * leaves with focus inside.
 */
export function useSaveBar({
  frame,
  onDiscard,
  container,
}: {
  /** The fixed box the bar sits in: it takes the form's `--save-bar-left` and `--save-bar-width`, so the bar lines up with the form. */
  frame: RefObject<HTMLElement | null>
  onDiscard?: () => void
  /** Where the bar renders, in place of the end of the page. */
  container?: HTMLElement | null
}) {
  const submission = useFormSubmission()
  const elementRef = submission?.formRef ?? noForm
  // The bar's element, which says no, and which focus leaves as it goes. As
  // state too: it mounts after its form, outside it, once the page has loaded.
  const bar = useRef<HTMLElement | null>(null)
  const [barElement, setBarElement] = useState<HTMLElement | null>(null)
  const barRef = useCallback((node: HTMLElement | null) => {
    bar.current = node
    setBarElement(node)
  }, [])
  const status: FormStatus = submission?.status ?? 'idle'
  const { changed: changes, current } = useFormChanges()
  const changed = changes.length > 0
  // A save that worked is still saving until the changes are read against it.
  const saving = status === 'saving' || (status === 'saved' && !current)
  // Once a save has worked, the bar stays to say so until its words have
  // changed, then leaves: never with the old words still on it.
  const savedCount = submission?.saved?.count ?? 0
  const [released, setReleased] = useState(0)
  const holding = status === 'saved' && current && !changed && released !== savedCount
  const open = changed || saving || holding

  // The warning holds until a new change, a save or a discard answers it.
  const moment = [
    status,
    submission?.revision ?? 0,
    submission?.saved?.count ?? 0,
    ...changes,
  ].join('\u0000')
  const [blockedAt, setBlockedAt] = useState<string | null>(null)
  const blocked = blockedAt === moment

  const view: SaveBarView = saving
    ? 'saving'
    : blocked
      ? 'blocked'
      : status === 'failed'
        ? 'failed'
        : status === 'saved' && !changed
          ? 'saved'
          : 'changed'

  useEffect(() => {
    const element = bar.current
    if (!holding || !element) return undefined
    let cancelled = false
    void transitionsQuiet(element, { subtree: true }).then(() => {
      if (!cancelled) setReleased(savedCount)
    })
    return () => {
      cancelled = true
    }
  }, [holding, savedCount])

  // Said once each time it changes: the bar showing, a save starting, a
  // failure, and the save done.
  const said = useRef<{ open: boolean; status: FormStatus; view: SaveBarView }>({
    open: false,
    status,
    view,
  })
  useEffect(() => {
    const last = said.current
    said.current = { open, status, view }
    if (status !== last.status && status === 'saving') announce(SAVE_BAR_TEXT.saving)
    else if (status !== last.status && status === 'failed') announce(SAVE_BAR_TEXT.failed)
    else if (view === 'saved' && last.view !== 'saved' && open)
      announce(SAVE_BAR_TEXT.saved)
    else if (open && !last.open) announce(SAVE_BAR_TEXT.changed)
  }, [open, status, view])

  // The control the person last used in the form, to hand focus back to, and
  // its place among the form's controls, which a discard's remount keeps.
  const lastControl = useRef<{ element: HTMLElement; index: number } | null>(null)

  // A control the fixed bar covers is scrolled clear of it, as the Tabs reveal
  // a tab, so focus is never hidden under the bar.
  const clear = (control: Element) => {
    const box = frame.current?.getBoundingClientRect()
    if (!box || !(control instanceof HTMLElement)) return
    const margin = clearance(control.getBoundingClientRect(), box, window.innerHeight)
    if (!margin) return
    const property =
      margin.side === 'bottom' ? 'scroll-margin-bottom' : 'scroll-margin-top'
    const before = control.style.getPropertyValue(property)
    control.style.setProperty(property, `${margin.size}px`)
    control.scrollIntoView({
      block: 'nearest',
      behavior: revealBehavior(control),
    })
    control.style.setProperty(property, before)
  }
  const clearRef = useRef(clear)
  useEffect(() => {
    clearRef.current = clear
  })

  useEffect(() => {
    const form = elementRef.current
    if (!form) return undefined
    const onFocusIn = (event: FocusEvent) => {
      const target = event.target
      if (!(target instanceof HTMLElement) || bar.current?.contains(target)) return
      lastControl.current = {
        element: target,
        index: formControls(form, bar.current).indexOf(target),
      }
      if (bar.current?.hasAttribute('data-open')) clearRef.current(target)
    }
    form.addEventListener('focusin', onFocusIn)
    return () => form.removeEventListener('focusin', onFocusIn)
  }, [elementRef])

  // Arriving under the control in use, as it can on the first change, it moves that control clear.
  useEffect(() => {
    const active = document.activeElement
    if (open && active && elementRef.current?.contains(active)) clearRef.current(active)
  }, [open, elementRef])

  // Leaving with focus inside, it hands focus back to that control, or to its
  // remounted self after a discard, so focus never falls to the page.
  useLayoutEffect(() => {
    if (open) return
    const element = bar.current
    if (!element?.contains(document.activeElement)) return
    const last = lastControl.current
    const all = formControls(elementRef.current, element)
    const back =
      (last?.element.isConnected ? last.element : null) ??
      (last && last.index >= 0 ? all[last.index] : undefined) ??
      all[0]
    back?.focus({ preventScroll: true })
  }, [open, elementRef])

  // Fixed to the screen, it lines up with the form across.
  useLayoutEffect(() => {
    const box = frame.current
    const form = elementRef.current
    if (!form || !box || !barElement) return undefined
    const place = () => {
      const { left, width } = form.getBoundingClientRect()
      box.style.setProperty('--save-bar-left', `${left}px`)
      box.style.setProperty('--save-bar-width', `${width}px`)
    }
    place()
    const observer = new ResizeObserver(place)
    observer.observe(form)
    window.addEventListener('resize', place)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', place)
    }
    // Again as it opens, in case the form moved across without changing size.
  }, [frame, open, elementRef, barElement])

  const block = () => {
    setBlockedAt(moment)
    announce(SAVE_BAR_TEXT.blocked)
    if (!bar.current) return
    // The swell the Alert dialog answers a press outside with.
    refuse(bar.current)
  }
  useLeaveGuard(changed, block)

  // ⌘S or Ctrl+S saves this form when pressed in it, or outside every form;
  // pressed in another form, it is that form's. Behind a dialog, it is the dialog's.
  const apple = useApplePlatform()
  useEffect(() => {
    if (!changed || saving) return undefined
    const onKeyDown = (event: KeyboardEvent) => {
      const form = elementRef.current
      if (!form || isComposing(event) || !matchesShortcut(event, ['Mod', 'S'], apple))
        return
      const target = event.target instanceof Element ? event.target : null
      const owns = ownsSaveShortcut({
        inForm: target !== null && form.contains(target),
        inBar: target !== null && !!bar.current?.contains(target),
        inOtherForm: !!target?.closest('form'),
        inOtherBar: !!target?.closest('[data-slot=save-bar]'),
        taken: event.defaultPrevented,
      })
      if (!owns) return
      if (form.closest('[inert], [aria-hidden="true"]')) return
      event.preventDefault()
      form.requestSubmit()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [changed, saving, apple, elementRef])

  // Named after its form, so two bars on a page tell themselves apart.
  useLayoutEffect(() => {
    const element = barElement
    const form = elementRef.current
    if (!form || !element) return
    const name =
      form.getAttribute('aria-label') ??
      document.getElementById(form.getAttribute('aria-labelledby') ?? '')?.textContent ??
      null
    element.setAttribute(
      'aria-label',
      name ? `${name}: ${SAVE_BAR_TEXT.changed.toLowerCase()}` : SAVE_BAR_TEXT.changed,
    )
  }, [barElement, elementRef])

  // Two bars open at once stack, the first on the bottom.
  useLayoutEffect(() => {
    const box = frame.current
    const element = bar.current
    if (!open || !box || !element) return undefined
    const entry = { box, element }
    stacked.push(entry)
    restack()
    return () => {
      stacked.splice(stacked.indexOf(entry), 1)
      restack()
    }
  }, [open, frame, barElement])

  // Where it renders, known once the page has loaded (it starts hidden, so
  // nothing shows late): in place inside a popup, such as a Dialog, which
  // ui-sdk opens in the top layer and which keeps focus in; otherwise away from
  // the form, at the end of the page or in `container`.
  const anchor = useRef<HTMLSpanElement | null>(null)
  const guard = useRef<HTMLSpanElement | null>(null)
  const [target, setTarget] = useState<HTMLElement | 'here' | null>(null)
  useLayoutEffect(() => {
    const here = anchor.current
    if (!here) return
    setTarget(here.closest('[popover]') ? 'here' : (container ?? here.ownerDocument.body))
  }, [container])
  const into = target !== null && target !== 'here' ? target : null
  const away = into !== null

  // Away from its form, the guard in the form's place sends focus into it:
  // to Discard from the form or before it, to Save with Shift+Tab from after.
  const onGuardFocus = (event: ReactFocusEvent<HTMLSpanElement>) => {
    const buttons = frame.current?.querySelectorAll<HTMLElement>('button')
    if (!buttons?.length) return
    const related = event.relatedTarget instanceof Node ? event.relatedTarget : null
    const fromBefore = Boolean(
      related &&
      (elementRef.current?.contains(related) ||
        event.currentTarget.compareDocumentPosition(related) &
          Node.DOCUMENT_POSITION_PRECEDING),
    )
    ;(fromBefore ? buttons[0] : buttons[buttons.length - 1]).focus()
  }
  // Its buttons are then out of the page's own Tab order, which would reach
  // them again at the end of the page: it moves focus itself, from Discard
  // to Save, and from either end back to the form's side.
  const onButtonKeyDown =
    (edge: 'first' | 'last') => (event: ReactKeyboardEvent<HTMLButtonElement>) => {
      if (event.key !== 'Tab' || !away) return
      const buttons = frame.current?.querySelectorAll<HTMLElement>('button')
      const from = anchor.current
      if (!buttons?.length || !from || !frame.current) return
      const inward = event.shiftKey ? edge === 'last' : edge === 'first'
      // Past the bar's own guard, which would send focus straight back in.
      const next = inward
        ? buttons[edge === 'first' ? 1 : 0]
        : tabNeighbour(from, !event.shiftKey, [frame.current, guard.current])
      if (!next) return
      event.preventDefault()
      next.focus()
    }

  const discard = () => {
    submission?.reset()
    onDiscard?.()
    announce('Changes discarded')
  }

  return {
    /** For the bar's element. */
    barRef,
    open,
    view,
    text: SAVE_BAR_TEXT[view],
    /** Every text it can say, so the bar can keep room for the longest and never change width. */
    texts: SAVE_BAR_TEXT,
    saving,
    /** Whether Discard and Save are off: while it saves, and as it leaves once saved. */
    locked: saving || view === 'saved',
    discard,
    /** Where the bar renders, and how focus goes round it when that is away from its form. */
    placement: {
      /** Whether it renders in place, inside a top-layer popup; `false` until the page has loaded. */
      here: target === 'here',
      /** The element it renders into away from its form, or `null` in place or until the page has loaded. */
      into,
      away,
      /** For a hidden element in the form's place. */
      anchorRef: anchor,
      /** For the focus guard in the form's place, while the bar shows away from it. */
      guardRef: guard,
      onGuardFocus,
      onButtonKeyDown,
      /** The form's id, for Save's `form`. */
      formId: submission?.formId,
    },
  }
}

export type { SaveBarView }
