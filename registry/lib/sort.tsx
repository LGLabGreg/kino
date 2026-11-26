'use client'

import { announce } from '@/registry/lib/announce'
import { translateOf } from '@/registry/lib/highlight'
import { transitionsQuiet } from '@/registry/lib/resize'
import {
  bindHold,
  type ChangeDetails,
  createChange,
  createReorder,
  createTransfer,
  definePrimitive,
  elements,
  isRTL,
  type ReorderDraft,
  type ReorderMessage,
  type ReorderReason,
  type SlotFactory,
  type TransferDraft,
  type TransferLists,
  type TransferMessage,
  type TransferReason,
} from '@ui-sdk/core'
import { usePrimitive } from '@ui-sdk/react/primitive'
import {
  Children,
  Component,
  createContext,
  Fragment,
  isValidElement,
  type ReactElement,
  type ReactNode,
  type RefObject,
  use,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'

/*
 * Lists put in a new order, and groups of lists whose items move between
 * them, on ui-sdk's `createReorder` and `createTransfer`: they own the drag,
 * the keys, the draft order, the focus, edge scrolling and the steps a
 * screen reader hears. Kino adds the motion. A pointer drags a copy above the
 * page while the item shows where it would land as a dashed slot, its
 * neighbours glide aside on `layout` (the `flow` lib in each list, and a
 * glide of our own for an item that changes list), and let go, the item
 * glides from the copy into its slot. A finger holds an item still for a
 * moment to pick it up, so a card never blocks the page's scroll.
 */

/** Rows in a column, or items that wrap in rows (`grid`). */
export type SortLayout = 'list' | 'grid'

/** Where an item is: a list, and its index there, from 0. */
export interface SortPlace {
  list: string
  index: number
}

/** One item moved, named at both ends, for undo and logs. */
export interface SortMove {
  item: string
  from: SortPlace
  to: SortPlace
}

/** Whether the list `to` takes `item` from the list `from`. */
export type SortAccepts = (item: string, to: string, from: string) => boolean

/** What a lone list's `onValueChange` gets after the order: ui-sdk's change details. */
export type SortListDetails = ChangeDetails<ReorderReason>

/** What a group's `onValueChange` gets after the move: ui-sdk's change details. */
export type SortGroupDetails = ChangeDetails<TransferReason>

/** Whether two orders are the same. */
export function sameOrder(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index])
}

/**
 * The order of the items there are: those in `order` that are still there,
 * then any new ones in the order they're given.
 */
export function reconcileOrder(
  order: readonly string[],
  present: readonly string[],
): string[] {
  const there = new Set(present)
  const kept = order.filter((value) => there.has(value))
  const known = new Set(kept)
  return [...kept, ...present.filter((value) => !known.has(value))]
}

/**
 * A group's lists, with the items there are: each list keeps the items of
 * `lists` that some list renders, and takes at its end any it renders that
 * no list holds yet. `present` is what each list renders, by its id; a list
 * not in it yet, on the first render, keeps all of its items.
 */
export function reconcileLists(
  lists: Readonly<TransferLists>,
  present: Readonly<TransferLists>,
): TransferLists {
  const rendered = new Set(Object.values(present).flat())
  const next: TransferLists = {}
  for (const [list, keys] of Object.entries(lists))
    next[list] = keys.filter((key) => rendered.has(key) || !(list in present))
  const held = new Set(Object.values(next).flat())
  for (const [list, keys] of Object.entries(present)) {
    const added = keys.filter((key) => !held.has(key))
    next[list] = [...(next[list] ?? []), ...added]
    for (const key of added) held.add(key)
  }
  return next
}

/** The list that holds `item`, if one does. */
export function listOf(lists: Readonly<TransferLists>, item: string): string | undefined {
  return Object.keys(lists).find((list) => lists[list]?.includes(item))
}

/** The items that are in another list in `next` than in `previous`. */
export function changedLists(
  previous: Readonly<TransferLists>,
  next: Readonly<TransferLists>,
): string[] {
  return Object.entries(next).flatMap(([list, keys]) =>
    keys.filter((key) => {
      const was = listOf(previous, key)
      return was !== undefined && was !== list
    }),
  )
}

/** The move that takes `item` to `index` in the list `to`, from where it is in `lists`. */
export function moveOf(
  lists: Readonly<TransferLists>,
  item: string,
  to: string,
  index: number,
): SortMove {
  const from = listOf(lists, item) ?? to
  return {
    item,
    from: { list: from, index: lists[from]?.indexOf(item) ?? -1 },
    to: { list: to, index },
  }
}

/** What a screen reader hears as an item in a list is picked up, moved, dropped or put back. */
export function sortMessage({ type, label, position, total }: ReorderMessage): string {
  const at = `position ${position} of ${total}`
  if (type === 'grab') return `Picked up ${label}, at ${at}.`
  if (type === 'move') return `${label} moved to ${at}.`
  if (type === 'drop') return `${label} dropped at ${at}.`
  return `Move cancelled. ${label} is back at ${at}.`
}

/** The same in a group, naming the list each time: "Write the brief, moved to Doing, 2 of 4." */
export function groupMessage({
  type,
  label,
  list,
  position,
  total,
}: TransferMessage): string {
  const at = `${list}, ${position} of ${total}`
  if (type === 'grab') return `Picked up ${label}, in ${at}.`
  if (type === 'move') return `${label}, moved to ${at}.`
  if (type === 'drop') return `${label}, dropped in ${at}.`
  return `Move cancelled. ${label} is back in ${at}.`
}

/** What a list's handles say they do. */
export const sortInstructions =
  'Press Space to pick it up. Then use the arrow keys to move it, Space to drop it, or Escape to put it back.'

/** What a group's handles say they do. */
export const groupInstructions =
  'Press Space to pick it up. Then use Up and Down to move it, Left and Right to move it to another list, Space to drop it, or Escape to put it back.'

/**
 * What a press inside an item goes to, rather than starting a drag: a
 * control, named by its element, its role, or its slot where it draws none
 * (a Slider's control).
 */
const sortControls = [
  'a[href]',
  'button',
  'input',
  'select',
  'textarea',
  'label',
  'summary',
  '[contenteditable]',
  '[role=button]',
  '[role=link]',
  '[role=checkbox]',
  '[role=radio]',
  '[role=switch]',
  '[role=slider]',
  '[role=spinbutton]',
  '[role=textbox]',
  '[role=searchbox]',
  '[role=combobox]',
  '[role=option]',
  '[role=tab]',
  '[role=treeitem]',
  '[role=menuitem]',
  '[role=menuitemcheckbox]',
  '[role=menuitemradio]',
  '[data-slot=slider-control]',
] as const
const controls = sortControls.join(',')

/** How near an edge, in px, a drag scrolls what it is in, and how far it scrolls each frame at most. */
const EDGE_SCROLL = { edge: 40, speed: 14 }
/** How long, in ms, a finger holds an item before it is picked up, and how far, in px, it may move meanwhile. */
const HOLD_DELAY = 300
const HOLD_TOLERANCE = 8

/** The handle's mark: a press on it drags, whatever the pointer. */
const HANDLE = 'data-sortable-handle'

/** Whether a press on `target` in an item drags it: anywhere but a control, the handle aside. */
function dragsFrom(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return true
  const control = target.closest(controls)
  return !control || control.hasAttribute(HANDLE)
}

/** Whether a press on `target` is on the handle, which drags at once by touch too. */
function onHandle(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(`[${HANDLE}]`) !== null
}

/**
 * Starts `drag` from a press on an item: at once for a mouse or a pen, or a
 * finger on the handle. A finger elsewhere waits for `holdToDrag`, so it
 * scrolls the page if it moves first. A press inside an item of a list
 * nested in it, such as a card's checklist, is that item's.
 */
function pressItem(
  event: PointerEvent,
  item: Element | null | undefined,
  drag: (down: PointerEvent) => void,
) {
  if (!dragsFrom(event.target) || !ownPress(event, item)) return
  if (event.pointerType === 'touch' && !onHandle(event.target)) return
  drag(event)
}

/** The items of a lone list, of a group, and of either. */
const LIST_ITEM = '[data-slot=sortable-list-item]'
const GROUP_ITEM = '[data-slot=sortable-group-item]'
const ITEMS = `${LIST_ITEM},${GROUP_ITEM}`

/** Whether a press is on `item` itself, rather than on an item of a list inside it. */
function ownPress(event: Event, item: Element | null | undefined): boolean {
  const target = event.target
  return !(target instanceof Element) || target.closest(ITEMS) === item
}

/**
 * A finger held still on `el` for `HOLD_DELAY` starts `drag` with the press
 * it began with. While pressed, `el` has `data-holding`; once held, and
 * while the drag lasts, the page no longer scrolls under the finger, so the
 * drag follows it.
 */
function holdToDrag(
  el: HTMLElement,
  drag: (down: PointerEvent) => void,
  dragging: () => boolean,
): () => void {
  let held = false
  // On the element from the start, so the browser waits for it before it scrolls.
  const block = (event: TouchEvent) => {
    if (held || dragging()) event.preventDefault()
  }
  el.addEventListener('touchmove', block, { passive: false })
  const unbind = bindHold(el, {
    delay: HOLD_DELAY,
    tolerance: HOLD_TOLERANCE,
    keys: [],
    onPress: ({ event, input }) =>
      input === 'touch' &&
      dragsFrom(event.target) &&
      !onHandle(event.target) &&
      ownPress(event, el),
    onHold: ({ event }) => {
      held = true
      drag(event as PointerEvent)
    },
    onEnd: () => {
      held = false
    },
  })
  return () => {
    unbind()
    el.removeEventListener('touchmove', block)
  }
}

/** Says each step in our words, politely: ui-sdk's own announcements are urgent, so they get none. */
function said<Message extends { type: string }>(
  say: () => ((text: string) => void) | undefined,
  words: (message: Message) => string,
  pointer: () => boolean,
) {
  return (message: Message) => {
    // A pointer's steps show as it drags; only where it was picked up and let go is said.
    if (message.type !== 'move' || !pointer()) say()?.(words(message))
    return ''
  }
}

/**
 * Whether focus at `active` has left `key` while the keys move it: a press
 * elsewhere puts it back, as Tab does. Focus its own move takes away comes
 * back to it.
 */
export function leaves(
  moving: { key: string; pointer: boolean } | null,
  key: string,
  active: Element | null,
): boolean {
  if (!moving || moving.pointer || moving.key !== key) return false
  return active?.closest('[data-key]')?.getAttribute('data-key') !== key
}

/** Calls `check` with where focus went, once a move that took it away has given it back (`keepFocus`). */
function leaveLater(event: Event, check: (active: Element | null) => void) {
  const doc = (event.target as Node).ownerDocument
  setTimeout(() => check(doc?.activeElement ?? null))
}

/** A box in the viewport, as `placeAt` reads it. */
type Box = Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom'>

/**
 * Where an item dragged to `point` goes among the others, from the boxes
 * they and its slot are laid out in: `others` in order and `slot` at
 * `current` among them. It goes past every box the point is past: in a
 * list, past its middle; in a grid, below it, or level with it and past its
 * middle across. A grid's point past the last box of a row, where the slot
 * would wrap below it, takes that box's place, so the slot reaches the end
 * of the row and the box wraps instead.
 */
export function placeAt(
  others: readonly Box[],
  slot: Box,
  current: number,
  point: { x: number; y: number },
  layout: SortLayout,
  rtl: boolean,
): number {
  if (layout === 'list')
    return others.filter((box) => point.y > (box.top + box.bottom) / 2).length
  const middle = (box: Box) => (box.left + box.right) / 2
  const after = (box: Box, than: Box) =>
    rtl ? middle(box) < middle(than) : middle(box) > middle(than)
  const level = (box: Box) => point.y >= box.top && point.y <= box.bottom
  const across = (box: Box) => (rtl ? point.x < middle(box) : point.x > middle(box))
  const counted = others.filter(
    (box) => point.y > box.bottom || (point.y >= box.top && across(box)),
  ).length
  if (counted !== current) return counted
  const boxes = [...others, slot]
  const lastOfRow = (box: Box) =>
    !boxes.some(
      (other) =>
        other !== box &&
        other.top < box.bottom &&
        other.bottom > box.top &&
        after(other, box),
    )
  const end = others.findIndex(
    (box, index) => index < current && level(box) && across(box) && lastOfRow(box),
  )
  return end === -1 ? counted : end
}

/** What a list's and a group's state share: the item that moves, if one does. */
type SortState = { moving: { key: string; pointer: boolean } | null }

/** An item and its label, as an agent names it. */
interface Named {
  value: string
  label: string
  /** What the page shows of it, which an agent reads in `snapshot()`. */
  shown?: string
}

/**
 * The text an item shows, as ui-sdk's `snapshot()` reads it: its text, in
 * order, past anything hidden from a screen reader or an agent and past the
 * items of a list inside it, with its spaces run together.
 */
export function shownText(item: Element): string {
  let text = ''
  const walk = (node: Node) => {
    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) text += child.textContent
      else if (
        child instanceof Element &&
        !child.matches(ITEMS) &&
        !child.hasAttribute('data-agent-hidden') &&
        child.getAttribute('aria-hidden') !== 'true'
      )
        walk(child)
    }
  }
  walk(item)
  return text.replace(/\s+/g, ' ').trim()
}

/**
 * What the items and handles of a lone list and of a group call: the same
 * parts on either, each primitive answering with its own engine, `reorder`
 * or `transfer`.
 */
interface SortParts<State> {
  /** Whether the item can't move: it, or what it is in, is turned off. */
  locked: (state: State, key: string) => boolean
  /** Whether the keys move the item now. */
  moved: (state: State, key: string) => boolean
  /** Whether a pointer drags the item now. */
  dragged: (state: State, key: string) => boolean
  pointerdown: (event: PointerEvent, key: string) => void
  keydown: (event: KeyboardEvent, key: string) => void
  bindItem: (el: HTMLElement, part: { key: string; props: object }) => () => void
  /** Whether a pointer drags an item now. */
  dragging: () => boolean
  /** Picks the item up by keys, or drops it if it is picked up: a screen reader's activate. */
  toggle: (key: string) => void
  /** Puts the item back if focus at `active` has left it while the keys move it. */
  leave: (key: string, active: Element | null) => void
  /** Where the copy of `key` was let go, once: the item glides from there into its place. */
  settle: (key: string) => DOMRect | null
  /** Follows a pointer's drags from the root's element. */
  follow: (el: HTMLElement) => () => void
}

/** The item and handle slots, the same in a lone list and a group. */
function itemSlots<State extends object & SortState, Api extends SortParts<State>>(
  slot: SlotFactory<State, Api>,
) {
  return {
    item: slot<{ value: string; label: string; disabled?: boolean }>({
      props: { value: 'string', label: 'string', disabled: 'boolean' },
      role: 'listitem',
      attrs: (state, { api, key, props }) => ({
        'data-key': key,
        'data-moving': api.moved(state, key) ? '' : undefined,
        'data-dragging': api.dragged(state, key) ? '' : undefined,
        'data-disabled': props.disabled || api.locked(state, key) ? '' : undefined,
      }),
      on: {
        pointerdown: (event, { api, el, key }) =>
          pressItem(event as PointerEvent, el, (down) => api.pointerdown(down, key)),
      },
      bind: (el, { api, key, props }) => {
        const cleanups = [
          api.bindItem(el, { key, props }),
          holdToDrag(el, (down) => api.pointerdown(down, key), api.dragging),
        ]
        return () => cleanups.forEach((cleanup) => cleanup())
      },
    }),
    handle: slot<{ value: string; disabled?: boolean }>({
      props: { value: 'string', disabled: 'boolean' },
      role: 'button',
      focus: 'native',
      // A screen reader's activate sends a click with no press behind it; a pointer drags instead.
      press: ({ api, key }, event) => {
        if (event instanceof MouseEvent && event.detail === 0) api.toggle(key)
      },
      attrs: (state, { api, key, props }) => ({
        type: 'button',
        [HANDLE]: '',
        'aria-pressed': String(api.moved(state, key) || api.dragged(state, key)),
        disabled: props.disabled || api.locked(state, key) ? '' : undefined,
      }),
      on: {
        keydown: (event, { api, key }) => api.keydown(event as KeyboardEvent, key),
        focusout: (event, { api, key }) =>
          leaveLater(event, (active) => api.leave(key, active)),
      },
    }),
  }
}

/** Finds `name` among `all` by its value, or else by its label or what it shows, in any case. */
function named(all: readonly Named[], name: string): Named | undefined {
  const lower = name.replace(/\s+/g, ' ').trim().toLowerCase()
  return (
    all.find((one) => one.value === name) ??
    all.find(
      (one) => one.label.toLowerCase() === lower || one.shown?.toLowerCase() === lower,
    )
  )
}

/** Each item there is, by its value, its label and what it shows. */
function itemsIn(
  context: Parameters<typeof elements>[0],
  values: readonly string[],
  label: (value: string) => string | undefined,
): Named[] {
  const els = new Map(elements(context, 'item').map((part) => [part.key, part.el]))
  return values.map((value) => {
    const el = els.get(value)
    return { value, label: label(value) ?? value, shown: el && shownText(el) }
  })
}

/** How `all` reads in an error: each by its label. */
function namesOf(all: readonly Named[]): string {
  return all.map((one) => one.label).join(', ')
}

type SortListOptions = {
  /** The items' values, in order. */
  value?: string[]
  defaultValue?: string[]
  /** Called with the new order once an item is dropped in a new place. */
  onValueChange?: (value: string[], details: SortListDetails) => void
  /** The values of the items the list renders. */
  items?: string[]
  layout?: SortLayout
  disabled?: boolean
  /** Says a step to a screen reader. */
  announce?: (text: string) => void
}

/** A list put in a new order: the Sortable list's. */
const sortList = definePrimitive({
  name: 'sortable-list',
  options: {
    value: 'list',
    defaultValue: 'list',
    onValueChange: 'callback',
    items: 'list',
    layout: 'string',
    disabled: 'boolean',
    announce: 'value',
  },
  controlled: ['value'],
  state: (options: SortListOptions) => ({
    value: reconcileOrder(
      options.value ?? options.defaultValue ?? options.items ?? [],
      options.items ?? [],
    ),
    moving: null as ReorderDraft | null,
    layout: options.layout ?? 'list',
    disabled: !!options.disabled,
  }),
  sync: (options) => ({
    ...(options.value === undefined
      ? {}
      : { value: reconcileOrder(options.value, options.items ?? []) }),
    layout: options.layout ?? 'list',
    disabled: !!options.disabled,
  }),
  api: (context) => {
    const { store, options } = context
    const change = createChange(context)
    // An item that comes or goes joins or leaves the order the list keeps itself.
    let items = options().items ?? []
    context.onOptions((next) => {
      const now = next.items ?? []
      if (sameOrder(now, items)) return
      items = now
      if (next.value === undefined)
        store.set({ value: reconcileOrder(store.get().value, now) })
    })
    const itemProps = (key: string) =>
      context.props<{ label?: string; disabled?: boolean }>('item', key)
    const reorder = createReorder(context, {
      slot: 'item',
      key: 'value',
      draft: 'moving',
      set: (value, details) => change('value', value, details),
      orientation: () => (store.get().layout === 'grid' ? 'grid' : 'vertical'),
      preview: true,
      createAutoScroll: EDGE_SCROLL,
      disabled: ({ props }) =>
        !!(props as { disabled?: boolean }).disabled || store.get().disabled,
      label: (key) => itemProps(key)?.label,
      message: said(
        () => options().announce,
        sortMessage,
        () => store.get().moving?.pointer === true,
      ),
    })
    const held = createHeld()
    const all = () => itemsIn(context, store.get().value, (key) => itemProps(key)?.label)
    const parts: SortParts<ReturnType<typeof store.get>> = {
      locked: (state, key) => state.disabled || !!itemProps(key)?.disabled,
      moved: (state, key) => reorder.moving(state, key) && !state.moving?.pointer,
      dragged: (state, key) => reorder.dragging(state, key),
      pointerdown: (event, key) => reorder.pointerdown(event, key),
      keydown: (event, key) => {
        reorder.keydown(event, key)
      },
      bindItem: (el, part) => reorder.bind(el, part),
      dragging: () => store.get().moving?.pointer === true,
      toggle: (key) => {
        if (store.get().moving?.key === key) reorder.drop()
        else reorder.grab(key)
      },
      leave: (key, active) => {
        if (leaves(store.get().moving, key, active)) reorder.cancel()
      },
      settle: held.take,
      follow: (el) => {
        const unfollow = followDrag(el, store, held, LIST_ITEM)
        const unplace = placeLaidOut(
          el,
          store,
          reorder,
          () => new Map(elements(context, 'item').map((part) => [part.key, part.el])),
        )
        return () => {
          unplace()
          unfollow()
        }
      },
    }
    return {
      reorder,
      ...parts,
      /** Every item, by its value and its label. */
      items: all,
      /**
       * Moves `item`, by its value or its label, to `index`, from 0, as a
       * drop there would: an agent's move. Says which items there are, or how
       * far `index` goes, when it names neither.
       */
      moveItem: (item: string, index: number) => {
        const order = store.get().value
        const found = named(all(), item)
        if (!found) throw new Error(`No item "${item}". Its items: ${namesOf(all())}.`)
        if (!Number.isInteger(index) || index < 0 || index >= order.length)
          throw new Error(`No place ${index}. Places go from 0 to ${order.length - 1}.`)
        if (parts.locked(store.get(), found.value))
          throw new Error(`"${found.label}" can’t be moved.`)
        return reorder.move(found.value, index)
      },
    }
  },
  slots: (slot) => ({
    root: slot<object, { order: string[]; sorting: boolean }>({
      role: 'list',
      state: (state, { api }) => ({
        order: api.reorder.order(state),
        sorting: state.moving !== null,
      }),
      attrs: (state) => ({
        'data-layout': state.layout,
        'data-sorting': state.moving ? '' : undefined,
        'data-disabled': state.disabled ? '' : undefined,
      }),
      bind: (el, { api }) => api.follow(el),
    }),
    ...itemSlots(slot),
  }),
  agent: { actions: ['moveItem'], items: (api) => api.items() },
})

type SortGroupOptions = {
  /** Each list's items, in order, by the list's id. */
  value?: TransferLists
  defaultValue?: TransferLists
  onValueChange?: (value: TransferLists, details: SortGroupDetails) => void
  accepts?: SortAccepts
  /** What each list renders, by its id. */
  present?: TransferLists
  announce?: (text: string) => void
}

/** Lists whose items move between them: the Sortable group's. */
const sortGroup = definePrimitive({
  name: 'sortable-group',
  options: {
    value: 'value',
    defaultValue: 'value',
    onValueChange: 'callback',
    accepts: 'value',
    present: 'value',
    announce: 'value',
  },
  controlled: ['value'],
  state: (options: SortGroupOptions) => ({
    value: reconcileLists(
      options.value ?? options.defaultValue ?? {},
      options.present ?? {},
    ),
    moving: null as TransferDraft | null,
  }),
  sync: (options) =>
    options.value === undefined
      ? {}
      : { value: reconcileLists(options.value, options.present ?? {}) },
  api: (context) => {
    const { store, options } = context
    const change = createChange(context)
    let present = options().present ?? {}
    context.onOptions((next) => {
      if (next.present === present) return
      present = next.present ?? {}
      if (next.value === undefined)
        store.set({ value: reconcileLists(store.get().value, present) })
    })
    const listProps = (list: string | undefined) =>
      list === undefined
        ? undefined
        : context.props<{ label?: string; disabled?: boolean }>('list', list)
    const itemProps = (key: string) =>
      context.props<{ label?: string; disabled?: boolean }>('item', key)
    const locked = (key: string) =>
      !!itemProps(key)?.disabled || !!listProps(listOf(store.get().value, key))?.disabled
    const takes = (item: string, list: string) =>
      !listProps(list)?.disabled &&
      (options().accepts?.(item, list, listOf(store.get().value, item) ?? list) ?? true)
    // Left and Right go through the lists in the order they are in the page.
    const order = () => elements(context, 'list').map((list) => list.key)
    const transfer = createTransfer(context, {
      key: 'value',
      draft: 'moving',
      set: (value, { key, to, index, reason, event }) =>
        change('value', value, {
          reason,
          event,
          move: moveOf(store.get().value, key, to, index),
        }),
      order,
      accepts: takes,
      disabled: locked,
      label: (key) => itemProps(key)?.label,
      listLabel: (list) => listProps(list)?.label,
      message: said(
        () => options().announce,
        groupMessage,
        () => store.get().moving?.pointer === true,
      ),
      createAutoScroll: EDGE_SCROLL,
    })
    /** What a person sees as each list: the box a drop lands in. */
    const boxes = new Map<string, HTMLElement>()
    const held = createHeld()
    const itemsOf = () =>
      itemsIn(
        context,
        Object.values(store.get().value).flat(),
        (key) => itemProps(key)?.label,
      )
    const listsOf = (): Named[] =>
      Object.keys(store.get().value).map((value) => ({
        value,
        label: listProps(value)?.label ?? value,
      }))
    /** Says so when Left or Right is refused by the list beside, which the keys skip. */
    const refused = (event: KeyboardEvent, was: TransferDraft) => {
      const across = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0
      if (!across || store.get().moving !== was) return
      const lists = order()
      const from = listOf(was.lists, was.key) ?? was.from
      const rtl = event.target instanceof Element && isRTL(event.target)
      const beside = lists[lists.indexOf(from) + (rtl ? -across : across)]
      if (beside === undefined || takes(was.key, beside)) return
      options().announce?.(
        `${listProps(beside)?.label ?? beside} doesn’t take ${itemProps(was.key)?.label ?? was.key}.`,
      )
    }
    const parts: SortParts<ReturnType<typeof store.get>> = {
      locked: (_state, key) => locked(key),
      moved: (state, key) => transfer.moving(state, key) && !state.moving?.pointer,
      dragged: (state, key) => transfer.dragging(state, key),
      pointerdown: (event, key) => transfer.pointerdown(event, key),
      keydown: (event, key) => {
        const was = store.get().moving
        transfer.keydown(event, key)
        if (was && !was.pointer) refused(event, was)
      },
      bindItem: (el, { key }) => transfer.bindItem(el, key),
      dragging: () => store.get().moving?.pointer === true,
      toggle: (key) => {
        if (store.get().moving?.key === key) transfer.drop()
        else transfer.grab(key)
      },
      leave: (key, active) => {
        if (leaves(store.get().moving, key, active)) transfer.cancel()
      },
      settle: held.take,
      follow: (el) => {
        const stops = [
          followDrag(el, store, held, GROUP_ITEM),
          // Outside every box that takes it, a drop puts it back.
          followOutside(
            el,
            store,
            (x, y, key) =>
              ![...boxes].some(
                ([list, box]) =>
                  box.isConnected &&
                  inside(box, x, y) &&
                  (list === listOf(store.get().value, key) || takes(key, list)),
              ),
            () => transfer.cancel(),
          ),
        ]
        return () => stops.forEach((stop) => stop())
      },
    }
    return {
      transfer,
      ...parts,
      /** Whether a list takes the item now being moved: a drop on one that doesn't puts it back. */
      takes,
      /** Joins a list's box, so drags find it and a drop in it lands there. */
      bindList: (el: HTMLElement, list: string) => {
        const box = dropBoxOf(el)
        boxes.set(list, box)
        const unbind = transfer.bindList(box, list)
        // While an item moves that it won't take, the box is marked, so it steps back as one.
        const mark = () => {
          const moving = store.get().moving
          box.toggleAttribute(
            'data-refused',
            !!moving &&
              listOf(store.get().value, moving.key) !== list &&
              !takes(moving.key, list),
          )
        }
        mark()
        const stop = store.subscribe(mark)
        return () => {
          stop()
          unbind()
          box.removeAttribute('data-refused')
          if (boxes.get(list) === box) boxes.delete(list)
        }
      },
      /** Every item, by its value and its label. */
      items: itemsOf,
      /**
       * Moves `item` to `index`, from 0, in the list `list`, each by its
       * value or its label, as a drop there would: an agent's move. Says
       * which items or lists there are, or how far `index` goes, when it
       * names neither.
       */
      moveItem: (item: string, list: string, index: number) => {
        const lists = store.get().value
        const found = named(itemsOf(), item)
        if (!found)
          throw new Error(`No item "${item}". Its items: ${namesOf(itemsOf())}.`)
        const into = named(listsOf(), list)
        if (!into) throw new Error(`No list "${list}". Its lists: ${namesOf(listsOf())}.`)
        const places = (lists[into.value] ?? []).filter(
          (key) => key !== found.value,
        ).length
        if (!Number.isInteger(index) || index < 0 || index > places)
          throw new Error(
            `No place ${index} in "${into.label}". Places go from 0 to ${places}.`,
          )
        if (locked(found.value)) throw new Error(`"${found.label}" can’t be moved.`)
        if (listOf(lists, found.value) !== into.value && !takes(found.value, into.value))
          throw new Error(`"${into.label}" doesn’t take "${found.label}".`)
        return transfer.move(found.value, into.value, index)
      },
    }
  },
  slots: (slot) => ({
    root: slot<object, { lists: TransferLists; dragging: string | null }>({
      role: 'group',
      state: (state, { api }) => ({
        lists: api.transfer.lists(state),
        dragging: state.moving?.pointer ? state.moving.key : null,
      }),
      attrs: (state) => ({ 'data-sorting': state.moving ? '' : undefined }),
      bind: (el, { api }) => api.follow(el),
    }),
    list: slot<{ value: string; label: string; disabled?: boolean }, { order: string[] }>(
      {
        props: { value: 'string', label: 'string', disabled: 'boolean' },
        role: 'list',
        state: (state, { api, key }) => ({
          order: api.transfer.lists(state)[key] ?? NONE,
        }),
        attrs: (_state, { key, props }) => ({
          'data-key': key,
          'aria-label': props.label,
          'data-disabled': props.disabled ? '' : undefined,
        }),
        bind: (el, { api, key }) => api.bindList(el, key),
      },
    ),
    ...itemSlots(slot),
  }),
  agent: { actions: ['moveItem'], items: (api) => api.items() },
})

const NONE: string[] = []

/** Something with a `value`, as a sortable item has. */
type Valued = ReactElement<{ value: string }>

/**
 * A list's items: its children, and those inside fragments, each with a
 * `value` to put it in order by. A component of the buyer's own that renders
 * an item takes the item's `value` too.
 */
function valuedChildren(children: ReactNode): Valued[] {
  return Children.toArray(children).flatMap((child): Valued[] => {
    if (!isValidElement<{ value?: unknown; children?: ReactNode }>(child)) return []
    if (child.type === Fragment) return valuedChildren(child.props.children)
    if (typeof child.props.value === 'string') return [child as Valued]
    // Anything else, such as a heading between items, has no place in the order.
    return []
  })
}

/** The item's place in the viewport without any `translate`: where it is laid out. */
function laidOut(item: HTMLElement): DOMRect {
  const box = item.getBoundingClientRect()
  const [x, y] = translateOf(getComputedStyle(item).translate)
  return new DOMRect(box.left - x, box.top - y, box.width, box.height)
}

/**
 * Glides `item` from `was`, a box in the viewport it was seen at, to where
 * it is laid out now, on its `translate` transition (`layout`): marked
 * `data-flow=start`, as the `flow` lib marks what it glides, while it is put
 * where it was.
 */
function glideFrom(item: HTMLElement, was: DOMRect) {
  const now = laidOut(item)
  const x = was.left - now.left
  const y = was.top - now.top
  if (Math.abs(x) < 0.5 && Math.abs(y) < 0.5) return
  item.dataset.flow = 'start'
  item.style.translate = `${x}px ${y}px`
  void item.offsetHeight
  delete item.dataset.flow
  item.style.translate = ''
}

/** The attributes that set a look for what is inside them, read from the nearest element that has each. */
const scopes = [
  'data-density',
  'data-shape',
  'data-feel',
  'data-motion',
  'data-theme-preset',
  'data-primary',
  'dir',
] as const

/**
 * Gives the copy a pointer drags the look of the item it came from: ui-sdk
 * puts it in `<body>`, outside a preview's density, shape, feel, motion and
 * theme, and outside its container. It takes the attributes around
 * `from`, the custom properties set inline on the way up, the
 * nearest first, and, where `from` is in a size container, becomes one, so
 * its container queries still match: the copy is as wide as the item.
 */
function scopeCopy(copy: HTMLElement, from: HTMLElement) {
  for (const name of scopes) {
    const value = from.closest(`[${name}]`)?.getAttribute(name)
    if (value !== null && value !== undefined) copy.setAttribute(name, value)
  }
  let contained = false
  for (let at = from.parentElement; at; at = at.parentElement) {
    for (const name of Array.from(at.style)) {
      if (name.startsWith('--') && !copy.style.getPropertyValue(name))
        copy.style.setProperty(name, at.style.getPropertyValue(name))
    }
    contained ||= getComputedStyle(at).containerType !== 'normal'
  }
  if (contained) copy.style.containerType = 'inline-size'
}

/** The copy that follows the pointer, once ui-sdk has put it in the page. */
function copyOf(doc: Document): HTMLElement | null {
  return doc.body.querySelector<HTMLElement>(':scope > [data-drag-preview]')
}

/** Where the copy was let go, and of which item, until that item is back in place. */
interface LetGo {
  key: string
  box: DOMRect
}

/** Holds where the copy was let go until its item takes it, once. */
function createHeld() {
  const held = {
    letGo: null as LetGo | null,
    take: (key: string) => {
      const letGo = held.letGo
      if (letGo?.key !== key) return null
      held.letGo = null
      return letGo.box
    },
  }
  return held
}

/** An item of a list or a group, found by its slot, so a list's own `data-key` never answers. */
function itemIn(root: Element, selector: string, key: string): HTMLElement | null {
  return root.querySelector<HTMLElement>(
    `:is(${selector})[data-key="${CSS.escape(key)}"]`,
  )
}

/** The item a pointer drags now, if one does. */
function draggedIn(store: { get: () => SortState }): string | null {
  const moving = store.get().moving
  return moving?.pointer ? moving.key : null
}

/** What `followDrag` and `followOutside` read: a primitive's store. */
interface SortStore {
  get: () => SortState
  subscribe: (listener: () => void) => () => void
}

/**
 * Follows a pointer's drags from `root`, the list's or the group's element:
 * gives the copy its look, and as it is let go, holds where it was so the
 * item glides from there into its slot (`useSettle`).
 */
function followDrag(
  root: HTMLElement,
  store: SortStore,
  held: ReturnType<typeof createHeld>,
  items: string,
): () => void {
  const doc = root.ownerDocument
  let was: string | null = null
  const stop = store.subscribe(() => {
    const now = draggedIn(store)
    if (now === was) return
    const ended = was
    was = now
    if (now) {
      // ui-sdk puts the copy in the page once the item is picked up, in the same task.
      queueMicrotask(() => {
        const copy = copyOf(doc)
        const item = itemIn(root, items, now)
        if (copy && item) scopeCopy(copy, item)
      })
      return
    }
    // Its item takes where it was let go as it renders; if it never does, nothing stays held.
    requestAnimationFrame(() => {
      if (!ended || !held.take(ended)) return
      itemIn(root, items, ended)?.removeAttribute('data-flow-held')
    })
  })
  const end = (event: Event) => {
    if (event instanceof KeyboardEvent && event.key !== 'Escape') return
    const key = draggedIn(store)
    const copy = copyOf(doc)
    if (!key || !copy) return
    held.letGo = { key, box: copy.getBoundingClientRect() }
    // Held, the `flow` lib leaves it to us: it glides from the copy.
    itemIn(root, items, key)?.setAttribute('data-flow-held', '')
  }
  doc.addEventListener('pointerup', end, true)
  doc.addEventListener('pointercancel', end, true)
  doc.addEventListener('keydown', end, true)
  return () => {
    stop()
    doc.removeEventListener('pointerup', end, true)
    doc.removeEventListener('pointercancel', end, true)
    doc.removeEventListener('keydown', end, true)
  }
}

/**
 * Puts the item a pointer drags back where it came from when it is let go
 * at a point `outside`, such as outside every list of a group that takes
 * it, and marks `root` `data-outside` while the pointer is there. Bound
 * after `followDrag`, so where it was let go is held first.
 */
function followOutside(
  root: HTMLElement,
  store: SortStore,
  outside: (x: number, y: number, key: string) => boolean,
  cancel: () => void,
): () => void {
  const doc = root.ownerDocument
  const stop = store.subscribe(() => {
    if (!draggedIn(store)) root.removeAttribute('data-outside')
  })
  const end = (event: PointerEvent) => {
    const key = draggedIn(store)
    if (key && outside(event.clientX, event.clientY, key)) cancel()
  }
  const move = (event: PointerEvent) => {
    const key = draggedIn(store)
    if (key)
      root.toggleAttribute('data-outside', outside(event.clientX, event.clientY, key))
  }
  doc.addEventListener('pointerup', end, true)
  doc.addEventListener('pointermove', move, true)
  return () => {
    stop()
    doc.removeEventListener('pointerup', end, true)
    doc.removeEventListener('pointermove', move, true)
  }
}

/**
 * Moves the item a pointer drags in `root` to where the others are laid
 * out, not where they are drawn. ui-sdk 0.1.0-beta.17 finds the place from
 * each item's box as drawn, so a neighbour still gliding to its new place,
 * as one that wraps to the next row of a grid does, passes back under the
 * pointer and sends the item back, and the two swing to and fro; it takes
 * no boxes or place of ours. It still moves the item through
 * `reorder.moveTo`, which this takes over while a pointer drags, following
 * only the pointer that pressed, as ui-sdk does.
 */
function placeLaidOut(
  root: HTMLElement,
  store: { get: () => { moving: ReorderDraft | null; layout: SortLayout } },
  reorder: { moveTo: (index: number) => void },
  itemOf: () => Map<string, HTMLElement>,
): () => void {
  const doc = root.ownerDocument
  const moveTo = reorder.moveTo
  let pointer: number | null = null
  let point: { x: number; y: number } | null = null
  const press = (event: PointerEvent) => {
    pointer = event.pointerId
    point = { x: event.clientX, y: event.clientY }
  }
  const move = (event: PointerEvent) => {
    if (event.pointerId === pointer) point = { x: event.clientX, y: event.clientY }
  }
  reorder.moveTo = (index) => {
    const { moving, layout } = store.get()
    if (!moving?.pointer || !point) return moveTo(index)
    const items = itemOf()
    const slot = items.get(moving.key)
    const others = moving.order
      .filter((key) => !moving.keys.includes(key))
      .map((key) => items.get(key))
      .filter((item) => item !== undefined)
    if (!slot) return moveTo(index)
    const current = moving.order.indexOf(moving.keys[0]!)
    moveTo(
      placeAt(others.map(laidOut), laidOut(slot), current, point, layout, isRTL(slot)),
    )
  }
  root.addEventListener('pointerdown', press, true)
  doc.addEventListener('pointermove', move, true)
  return () => {
    reorder.moveTo = moveTo
    root.removeEventListener('pointerdown', press, true)
    doc.removeEventListener('pointermove', move, true)
  }
}

/**
 * The box a person sees as a list of a group, which takes a drop anywhere
 * in it: the list's element, or the one around it that holds it alone, such
 * as a column with a heading, up to the group.
 */
function dropBoxOf(list: HTMLElement): HTMLElement {
  let box = list
  for (
    let up = box.parentElement;
    up &&
    up.getAttribute('data-slot') !== 'sortable-group' &&
    up.querySelectorAll('[data-slot=sortable-group-list]').length <= 1;
    up = up.parentElement
  )
    box = up
  return box
}

/**
 * Glides `item` from `was` into its place, above its neighbours and past
 * its list's frame while it does (`data-settling`): from where its copy was
 * let go (`drop`), which keeps the copy's shadow on it until it lands and
 * hands it back to the `flow` lib the frame after, or from the list it left
 * (`across`).
 */
function settleFrom(item: HTMLElement, was: DOMRect, settling: 'drop' | 'across') {
  if (settling === 'drop') {
    item.setAttribute('data-flow-held', '')
    requestAnimationFrame(() => item.removeAttribute('data-flow-held'))
  }
  item.setAttribute('data-settling', settling)
  glideFrom(item, was)
  void transitionsQuiet(item).then(() => {
    if (item.getAttribute('data-settling') === settling)
      item.removeAttribute('data-settling')
  })
}

/**
 * Glides an item let go by the pointer from where its copy was into its
 * place, as the drag ends: the item renders again then, whatever else does.
 */
function useSettle(
  handle: {
    instance: {
      get: () => SortState
      subscribe: (listener: () => void) => () => void
    }
    api: Pick<SortParts<never>, 'settle'>
  },
  ref: RefObject<HTMLElement | null>,
  value: string,
) {
  const { instance, api } = handle
  const dragged = useSyncExternalStore(
    instance.subscribe,
    () => {
      const moving = instance.get().moving
      return moving?.pointer === true && moving.key === value
    },
    () => false,
  )
  useLayoutEffect(() => {
    const item = ref.current
    if (dragged || !item) return
    const box = api.settle(value)
    if (box) settleFrom(item, box, 'drop')
  }, [dragged, api, ref, value])
}

type SortListHandle = ReturnType<typeof usePrimitive<typeof sortList>>
type SortGroupHandle = ReturnType<typeof usePrimitive<typeof sortGroup>>

interface ListContextValue {
  kind: 'list'
  handle: SortListHandle
  instructionsId: string
}

interface GroupContextValue {
  kind: 'group'
  handle: SortGroupHandle
  instructionsId: string
  /** Each list's items as it last rendered them, so a list can show one that moved in. */
  elements: Map<string, Valued>
  /** Tells the group what a list renders. */
  render: (list: string, items: string[] | null) => void
}

const SortContext = createContext<ListContextValue | GroupContextValue | null>(null)
const SortItemContext = createContext<{
  value: string
  label: string
  disabled: boolean
} | null>(null)

/** The list or group around a part. */
function useSortContext() {
  const context = use(SortContext)
  if (!context) throw new Error('A sortable part must be inside a SortableList.')
  return context
}

export interface UseSortListOptions {
  value?: string[]
  defaultValue?: string[]
  onValueChange?: (value: string[], details: SortListDetails) => void
  layout: SortLayout
  disabled: boolean
}

/** A lone list: its primitive, its children in the order shown, and what its parts read. */
function useSortList(children: ReactNode, options: UseSortListOptions) {
  const items = valuedChildren(children)
  const present = items.map((item) => item.props.value)
  const handle = usePrimitive(sortList, {
    value: options.value,
    defaultValue: options.defaultValue,
    onValueChange: options.onValueChange,
    items: present,
    layout: options.layout,
    disabled: options.disabled,
    announce,
  })
  const instructionsId = useId()
  const byValue = new Map(items.map((item) => [item.props.value, item]))
  const ordered = (order: readonly string[]) =>
    reconcileOrder(order, present).flatMap((value) => byValue.get(value) ?? [])
  const context: ListContextValue = { kind: 'list', handle, instructionsId }
  const extras = (
    <>
      <p id={instructionsId} hidden>
        {sortInstructions}
      </p>
    </>
  )
  return { context, handle, ordered, extras }
}

export interface UseSortGroupOptions {
  value?: TransferLists
  defaultValue?: TransferLists
  onValueChange?: (
    value: TransferLists,
    move: SortMove,
    details: SortGroupDetails,
  ) => void
  accepts?: SortAccepts
}

/** Whether a point is inside `el`'s box. */
function inside(el: Element, x: number, y: number) {
  const box = el.getBoundingClientRect()
  return x >= box.left && x <= box.right && y >= box.top && y <= box.bottom
}

/**
 * A group of lists: its primitive and what its lists and parts read. Give
 * `root` to the group's element, which `ListsMove` glides across.
 */
function useSortGroup(options: UseSortGroupOptions) {
  const [present, setPresent] = useState<TransferLists>({})
  const [elements] = useState(() => new Map<string, Valued>())
  const { onValueChange } = options
  const handle = usePrimitive(sortGroup, {
    value: options.value,
    defaultValue: options.defaultValue,
    onValueChange:
      onValueChange &&
      ((value, details) =>
        onValueChange(
          value,
          (details as { move: SortMove } & SortGroupDetails).move,
          details,
        )),
    accepts: options.accepts,
    present,
    announce,
  })
  const root = useRef<HTMLElement>(null)
  const instructionsId = useId()
  const [render] = useState(
    () => (list: string, items: string[] | null) =>
      setPresent((was) => {
        if (items === null) {
          if (!(list in was)) return was
          const rest = { ...was }
          delete rest[list]
          return rest
        }
        return was[list] && sameOrder(was[list], items) ? was : { ...was, [list]: items }
      }),
  )
  const context: GroupContextValue = {
    kind: 'group',
    handle,
    instructionsId,
    elements,
    render,
  }
  const extras = (
    <>
      <p id={instructionsId} hidden>
        {groupInstructions}
      </p>
    </>
  )
  return { context, handle, root, extras }
}

/**
 * A list in a group: its items as the group orders them, the ones that moved
 * in from another list included, and the props its parts read.
 */
function useGroupList(id: string, children: ReactNode) {
  const context = useSortContext()
  if (context.kind !== 'group')
    throw new Error('A SortableList with an `id` must be inside a SortableGroup.')
  const items = valuedChildren(children)
  const present = items.map((item) => item.props.value)
  const key = present.join('\u0000')
  const { elements, render } = context
  useLayoutEffect(() => {
    for (const item of items) elements.set(item.props.value, item)
    render(id, key === '' ? [] : key.split('\u0000'))
  })
  useLayoutEffect(() => () => render(id, null), [id, render])
  const own = new Map(items.map((item) => [item.props.value, item]))
  const ordered = (order: readonly string[]) => {
    const shown = new Set(order)
    return [
      ...order.flatMap((value) => own.get(value) ?? elements.get(value) ?? []),
      // Rendered here but in no list of the group's yet: at the end, until it is.
      ...items.filter(
        (item) =>
          !shown.has(item.props.value) &&
          !listOf(context.handle.state.value, item.props.value),
      ),
    ]
  }
  return { handle: context.handle, ordered }
}

/**
 * Glides each item that moved to another list from where it was, before the
 * page changed, across the group: the `flow` lib in each list glides what
 * moved inside it, and is told to leave no copy of what moved out
 * (`data-flow-away`). The item a pointer drags is its slot, which appears in
 * place. Read just before React changes the page, which only a class can.
 */
class ListsMove extends Component<{
  lists: TransferLists
  dragging: string | null
  root: RefObject<HTMLElement | null>
  children: ReactNode
}> {
  getSnapshotBeforeUpdate(previous: Readonly<{ lists: TransferLists }>) {
    const root = this.props.root.current
    if (!root || previous.lists === this.props.lists) return null
    const seen = new Map<string, DOMRect>()
    for (const key of changedLists(previous.lists, this.props.lists)) {
      const item = itemIn(root, GROUP_ITEM, key)
      if (!item) continue
      item.setAttribute('data-flow-away', '')
      if (key !== this.props.dragging) seen.set(key, item.getBoundingClientRect())
    }
    return seen
  }

  componentDidUpdate(
    _previous: unknown,
    _state: unknown,
    seen: Map<string, DOMRect> | null,
  ) {
    const root = this.props.root.current
    if (!root || !seen) return
    for (const [key, box] of seen) {
      const item = itemIn(root, GROUP_ITEM, key)
      if (item) settleFrom(item, box, 'across')
    }
  }

  render() {
    return this.props.children
  }
}

export {
  ListsMove,
  SortContext,
  sortControls,
  sortGroup,
  SortItemContext,
  sortList,
  useGroupList,
  useSettle,
  useSortContext,
  useSortGroup,
  useSortList,
}
