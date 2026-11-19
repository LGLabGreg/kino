'use client'

import { useAnnouncer } from '@/registry/lib/announce'
import { useControllable } from '@/registry/lib/controllable'
import { useFlow } from '@/registry/lib/flow'
import { translateOf } from '@/registry/lib/highlight'
import { mergeRefs } from '@/registry/lib/refs'
import { startRun, transitionsSettled } from '@/registry/lib/resize'
import { revealBehavior, scrollerOf } from '@/registry/lib/scroll'
import {
  Children,
  createContext,
  Fragment,
  isValidElement,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
  type ReactNode,
  type RefCallback,
  use,
  useId,
  useLayoutEffect,
  useMemo,
  useState,
} from 'react'

/*
 * A list whose items are put in a new order by dragging, by touch and by
 * keyboard: the Sortable list's. The order changes in the page as an item
 * passes its neighbours, so the browser lays out every place, rows or a
 * wrapping grid alike, and `followFlow` glides each neighbour to its new place
 * on `layout`. An item that follows the pointer is marked `data-flow-held`:
 * it is placed here, every frame, and glides into its place on `layout` once
 * let go. Nothing re-renders while it follows: React hears only when the
 * order changes. The DOM work is kept outside components, as the flow lib's
 * is.
 */

/** Rows in a column, or items that wrap in rows (`grid`). */
export type SortLayout = 'list' | 'grid'

/** A box in the viewport's px. */
export interface SortBox {
  left: number
  top: number
  width: number
  height: number
}

interface Point {
  x: number
  y: number
}

/** `order` with the item at `from` taken out and put back at `to`. */
export function moveTo<T>(order: readonly T[], from: number, to: number): T[] {
  const next = [...order]
  const [item] = next.splice(from, 1)
  if (item !== undefined) next.splice(to, 0, item)
  return next
}

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
 * Where the item at `from` goes, with `point` (the centre of where the
 * pointer would put the item) over the others' `boxes`, in
 * the order they are now. Over another item, it goes before it in that
 * item's first half and after it in its second, along the column, or along
 * the line in a grid: the place it takes puts the same half under it, so it
 * never swaps back and forth between items of different sizes. Past the
 * first or the last item it goes first or last; in a gap it stays.
 */
export function sortTarget(
  boxes: readonly SortBox[],
  from: number,
  point: Point,
  { layout, rtl = false }: { layout: SortLayout; rtl?: boolean },
): number {
  const others = boxes.flatMap((box, index) => (index === from ? [] : [box]))
  if (others.length === 0) return from
  for (const [index, box] of others.entries()) {
    const inColumn = point.y >= box.top && point.y < box.top + box.height
    const inLine = point.x >= box.left && point.x < box.left + box.width
    if (!inColumn || (layout === 'grid' && !inLine)) continue
    const before =
      layout === 'list'
        ? point.y < box.top + box.height / 2
        : rtl
          ? point.x > box.left + box.width / 2
          : point.x < box.left + box.width / 2
    return before ? index : index + 1
  }
  const first = others[0]
  const last = others.at(-1)
  if (!first || !last) return from
  if (point.y < first.top) return 0
  // On the first line of a grid, before its first item.
  if (
    layout === 'grid' &&
    point.y < first.top + first.height &&
    (rtl ? point.x >= first.left + first.width : point.x < first.left)
  )
    return 0
  if (point.y >= last.top + last.height) return others.length
  // On the last line of a grid, past its last item.
  if (
    layout === 'grid' &&
    point.y >= last.top &&
    (rtl ? point.x < last.left : point.x >= last.left + last.width)
  )
    return others.length
  return from
}

/** A move a key asks for. */
export type SortStep = 'previous' | 'next' | 'up' | 'down' | 'first' | 'last'

/**
 * The move a key asks for: Up and Down step through a column, Left and Right
 * through a grid's line (turned around in right to left) and Up and Down
 * between its lines, Home and End to the ends. Null for any other key.
 */
export function sortStepOf(
  key: string,
  layout: SortLayout,
  rtl = false,
): SortStep | null {
  switch (key) {
    case 'ArrowUp':
      return layout === 'list' ? 'previous' : 'up'
    case 'ArrowDown':
      return layout === 'list' ? 'next' : 'down'
    case 'ArrowLeft':
      return layout === 'list' ? null : rtl ? 'next' : 'previous'
    case 'ArrowRight':
      return layout === 'list' ? null : rtl ? 'previous' : 'next'
    case 'Home':
      return 'first'
    case 'End':
      return 'last'
    default:
      return null
  }
}

/**
 * Where a step takes the item at `from`. Up and Down in a grid go to the
 * item nearest across in the line above or below.
 */
export function stepTarget(
  boxes: readonly SortBox[],
  from: number,
  step: SortStep,
): number {
  const last = boxes.length - 1
  if (step === 'previous') return Math.max(0, from - 1)
  if (step === 'next') return Math.min(last, from + 1)
  if (step === 'first') return 0
  if (step === 'last') return last
  const box = boxes[from]
  if (!box) return from
  const middle = (b: SortBox) => ({ x: b.left + b.width / 2, y: b.top + b.height / 2 })
  const here = middle(box)
  const lines = boxes
    .map((other, index) => ({ index, at: middle(other) }))
    .filter(
      ({ index, at }) =>
        index !== from && (step === 'up' ? at.y < box.top : at.y > box.top + box.height),
    )
  if (lines.length === 0) return from
  const nearestLine = (step === 'up' ? Math.max : Math.min)(
    ...lines.map(({ at }) => at.y),
  )
  const line = lines.filter(({ at }) => Math.abs(at.y - nearestLine) < box.height / 2)
  line.sort((a, b) => Math.abs(a.at.x - here.x) - Math.abs(b.at.x - here.x))
  return line[0]?.index ?? from
}

/**
 * How far to scroll each frame, in px, with the pointer at `at` between a
 * scroller's `start` and `end`: faster the deeper into the edge's `zone` it
 * is, up to `most`.
 */
export function edgeSpeed(
  at: number,
  start: number,
  end: number,
  zone = 40,
  most = 14,
): number {
  const into = (depth: number) => Math.min(1, Math.max(0, depth / zone)) * most
  if (at < start + zone) return -into(start + zone - at)
  if (at > end - zone) return into(at - (end - zone))
  return 0
}

/** `value`, kept between `min` and `max`; `min` when they cross. */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max))
}

/** What a screen reader hears as an item is picked up, moved, dropped or put back. */
export function sortMessage(
  event: 'lift' | 'move' | 'drop' | 'cancel',
  label: string,
  position: number,
  total: number,
): string {
  const at = `position ${position} of ${total}`
  if (event === 'lift') return `Picked up ${label}, at ${at}.`
  if (event === 'move') return `${label} moved to ${at}.`
  if (event === 'drop') return `${label} dropped at ${at}.`
  return `Move cancelled. ${label} is back at ${at}.`
}

/** What the handles' instructions say. */
export const sortInstructions =
  'Press Space to pick it up. Then use the arrow keys to move it, Space to drop it, or Escape to put it back.'

/**
 * What a press inside an item goes to, rather than starting a drag: a
 * control. Base UI draws some without a native element or the role on the
 * part pressed (a Radio is a `span`, a Slider's thumb takes its role from a
 * hidden input), so they are named by role and by their slot too.
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

/** How far, in px, a pointer moves before a press becomes a drag, and a long press stays still. */
const DRAG_DISTANCE = 4
const HOLD_TOLERANCE = 8
/** How long, in ms, a finger holds a row before it lifts. */
const HOLD_DELAY = 300

type Via = 'pointer' | 'keyboard'

interface Lifted {
  value: string
  via: Via
}

interface Drag {
  value: string
  pointerId: number
  start: Point
  at: Point
  /** Where the pointer holds the item, from its top-left corner as it was seen. */
  grip: Point | null
  /**
   * The centre of where the pointer would put the item, past the list's
   * edges too: the item stays inside the list, and this is where it goes.
   */
  aim: Point | null
  started: boolean
  hold: ReturnType<typeof setTimeout> | null
  frame: number
}

/** Everything the list keeps outside React: the elements, and the drag in progress. */
interface Sorter {
  list: HTMLElement | null
  items: Map<string, HTMLElement>
  handles: Map<string, HTMLElement>
  itemRefs: Map<string, RefCallback<HTMLElement>>
  handleRefs: Map<string, RefCallback<HTMLElement>>
  order: string[]
  original: string[]
  lifted: Lifted | null
  drag: Drag | null
  /**
   * The item whose handle gets focus back once the page has its new order:
   * moved in the page, a handle loses focus, and that blur is ours.
   */
  refocus: string | null
  stop: (() => void) | null
  // The latest of what the component gives, set as it renders.
  layout: SortLayout
  setPreview: (order: string[] | null) => void
  setLifted: (lifted: Lifted | null) => void
  commit: (order: string[]) => void
  announce: (text: string) => void
}

/** The item's place in the viewport without any `translate`: where it is laid out. */
function laidOut(item: HTMLElement): SortBox {
  const box = item.getBoundingClientRect()
  const [x, y] = translateOf(getComputedStyle(item).translate)
  return { left: box.left - x, top: box.top - y, width: box.width, height: box.height }
}

function labelOf(item: HTMLElement | undefined): string {
  return item?.dataset.label ?? item?.textContent?.trim() ?? ''
}

function isRtl(element: HTMLElement | null) {
  return element ? getComputedStyle(element).direction === 'rtl' : false
}

/** The box that scrolls `element`, or the page's own scrolling element. */
function scrollingBox(element: HTMLElement): HTMLElement {
  return (
    scrollerOf(element) ??
    (document.scrollingElement as HTMLElement | null) ??
    document.documentElement
  )
}

/** Puts the item that follows the pointer under it, inside the list. */
function place(sorter: Sorter) {
  const { drag, list } = sorter
  if (!drag?.started || !drag.grip || !list) return
  const item = sorter.items.get(drag.value)
  if (!item) return
  const box = laidOut(item)
  const bounds = list.getBoundingClientRect()
  const want = { x: drag.at.x - drag.grip.x, y: drag.at.y - drag.grip.y }
  drag.aim = { x: want.x + box.width / 2, y: want.y + box.height / 2 }
  const x =
    sorter.layout === 'list'
      ? box.left
      : clamp(want.x, bounds.left, bounds.right - box.width)
  const y = clamp(want.y, bounds.top, bounds.bottom - box.height)
  item.style.translate = `${x - box.left}px ${y - box.top}px`
}

/** Moves the picked-up item to `to` in the order shown, and says so if `say`. */
function moveLifted(sorter: Sorter, to: number, say: boolean) {
  const lifted = sorter.lifted
  if (!lifted) return
  const from = sorter.order.indexOf(lifted.value)
  if (from === -1 || to === from) return
  sorter.order = moveTo(sorter.order, from, to)
  if (lifted.via === 'keyboard') sorter.refocus = lifted.value
  sorter.setPreview(sorter.order)
  if (say)
    sorter.announce(
      sortMessage(
        'move',
        labelOf(sorter.items.get(lifted.value)),
        to + 1,
        sorter.order.length,
      ),
    )
}

/** Where each item is laid out, in the order shown. */
function boxesOf(sorter: Sorter): SortBox[] {
  return sorter.order.map((value) => {
    const element = sorter.items.get(value)
    return element ? laidOut(element) : { left: 0, top: 0, width: 0, height: 0 }
  })
}

/** Moves the item that follows the pointer to the place under it. */
function retarget(sorter: Sorter) {
  const { drag, lifted } = sorter
  if (!drag?.started || !lifted) return
  const from = sorter.order.indexOf(lifted.value)
  const boxes = boxesOf(sorter)
  const point = drag.aim ?? drag.at
  const to = sortTarget(boxes, from, point, {
    layout: sorter.layout,
    rtl: isRtl(sorter.list),
  })
  moveLifted(sorter, to, false)
}

/** Lifts the item a pointer pressed, once it has moved far enough or held long enough. */
function begin(sorter: Sorter) {
  const drag = sorter.drag
  if (!drag || drag.started) return
  const item = sorter.items.get(drag.value)
  if (!item) return
  drag.started = true
  item.removeAttribute('data-pressing')
  item.removeAttribute('data-settling')
  startRun(settleKey(item))
  const seen = item.getBoundingClientRect()
  drag.grip = { x: drag.start.x - seen.left, y: drag.start.y - seen.top }
  sorter.original = sorter.order
  sorter.lifted = { value: drag.value, via: 'pointer' }
  item.setAttribute('data-flow-held', '')
  sorter.setLifted(sorter.lifted)
  sorter.announce(
    sortMessage(
      'lift',
      labelOf(item),
      sorter.order.indexOf(drag.value) + 1,
      sorter.order.length,
    ),
  )
  place(sorter)
  // The page scrolls while the pointer sits near its edge.
  const scroller = scrollingBox(item)
  const tick = () => {
    if (sorter.drag !== drag) return
    const page = scroller === document.scrollingElement
    const box = page
      ? { top: 0, bottom: window.innerHeight }
      : scroller.getBoundingClientRect()
    const speed = edgeSpeed(drag.at.y, box.top, box.bottom)
    if (speed !== 0) {
      scroller.scrollBy(0, speed)
      place(sorter)
      retarget(sorter)
    }
    drag.frame = requestAnimationFrame(tick)
  }
  drag.frame = requestAnimationFrame(tick)
}

const settleKeys = new WeakMap<HTMLElement, object>()

/** The key an item's settling runs on: its own, apart from the flow lib's glides. */
function settleKey(item: HTMLElement): object {
  let key = settleKeys.get(item)
  if (!key) {
    key = {}
    settleKeys.set(item, key)
  }
  return key
}

/** Ends a pick-up: drops the item where it is, or puts the order back. */
function finish(sorter: Sorter, how: 'drop' | 'cancel') {
  const lifted = sorter.lifted
  const drag = sorter.drag
  sorter.stop?.()
  sorter.stop = null
  sorter.drag = null
  if (drag) {
    if (drag.hold) clearTimeout(drag.hold)
    cancelAnimationFrame(drag.frame)
    sorter.items.get(drag.value)?.removeAttribute('data-pressing')
  }
  if (!lifted) return
  sorter.lifted = null
  const item = sorter.items.get(lifted.value)
  const order = how === 'cancel' ? sorter.original : sorter.order
  const changes = !sameOrder(order, sorter.order)
  if (item) {
    // Let go, it glides into its place on `layout`: the flow lib takes it
    // from where it is when the order changes back, and its own transition
    // when it doesn't.
    item.removeAttribute('data-flow-held')
    if (!changes) item.style.translate = ''
    // It stays above its neighbours, marked `data-settling`, until it is in place.
    item.setAttribute('data-settling', '')
    const latest = startRun(settleKey(item))
    void transitionsSettled(item, { property: 'translate' }).then(() => {
      if (latest()) item.removeAttribute('data-settling')
    })
  }
  if (changes && lifted.via === 'keyboard') sorter.refocus = lifted.value
  sorter.order = order
  sorter.setLifted(null)
  sorter.setPreview(null)
  if (how === 'drop') sorter.commit(order)
  sorter.announce(
    sortMessage(how, labelOf(item), order.indexOf(lifted.value) + 1, order.length),
  )
}

/**
 * Swallows the click that follows a drag, if one comes before the next
 * press: a browser may send none, and the next real click must go through.
 */
function swallowClick() {
  const swallow = (click: MouseEvent) => {
    click.preventDefault()
    click.stopPropagation()
    stop()
  }
  const stop = () => {
    window.removeEventListener('click', swallow, { capture: true })
    window.removeEventListener('pointerdown', stop, { capture: true })
  }
  window.addEventListener('click', swallow, { capture: true })
  window.addEventListener('pointerdown', stop, { capture: true })
}

/** Follows a pointer pressed on a handle, or on a row that drags from anywhere. */
function press(sorter: Sorter, value: string, event: ReactPointerEvent, hold: boolean) {
  if (sorter.lifted || sorter.drag) return
  if (event.pointerType === 'mouse' && event.button !== 0) return
  const drag: Drag = {
    value,
    pointerId: event.pointerId,
    start: { x: event.clientX, y: event.clientY },
    at: { x: event.clientX, y: event.clientY },
    grip: null,
    aim: null,
    started: false,
    hold: null,
    frame: 0,
  }
  sorter.drag = drag
  if (hold) {
    // A finger held on a row is answered at once, marked `data-pressing`
    // until the row lifts or the hold is let go.
    sorter.items.get(value)?.setAttribute('data-pressing', '')
    drag.hold = setTimeout(() => begin(sorter), HOLD_DELAY)
  }

  const move = (moved: PointerEvent) => {
    if (moved.pointerId !== drag.pointerId) return
    drag.at = { x: moved.clientX, y: moved.clientY }
    const distance = Math.hypot(drag.at.x - drag.start.x, drag.at.y - drag.start.y)
    if (!drag.started) {
      if (hold) {
        // A finger that moves before the hold is up scrolls instead.
        if (distance > HOLD_TOLERANCE) finish(sorter, 'cancel')
        return
      }
      if (distance < DRAG_DISTANCE) return
      begin(sorter)
    }
    place(sorter)
    retarget(sorter)
  }
  const up = (ended: PointerEvent) => {
    if (ended.pointerId !== drag.pointerId) return
    const started = drag.started
    finish(sorter, 'drop')
    // The click that ends a mouse's drag isn't a press on what's under it.
    // A finger's drag ends with no click, so nothing waits for one.
    if (started && ended.pointerType !== 'touch') swallowClick()
  }
  const cancel = (ended: PointerEvent) => {
    if (ended.pointerId === drag.pointerId) finish(sorter, 'cancel')
  }
  const key = (pressed: KeyboardEvent) => {
    if (pressed.key !== 'Escape' || !drag.started) return
    pressed.preventDefault()
    pressed.stopPropagation()
    finish(sorter, 'cancel')
  }
  const scrolled = () => {
    place(sorter)
    retarget(sorter)
  }
  const blocked = (blockable: Event) => {
    if (drag.started || blockable.type === 'contextmenu') blockable.preventDefault()
  }
  const left = () => finish(sorter, 'cancel')
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
  window.addEventListener('pointercancel', cancel)
  window.addEventListener('keydown', key, { capture: true })
  window.addEventListener('scroll', scrolled, { capture: true, passive: true })
  window.addEventListener('blur', left)
  // While it drags, a finger doesn't scroll the page and nothing is selected.
  window.addEventListener('touchmove', blocked, { passive: false })
  window.addEventListener('selectstart', blocked)
  if (hold) window.addEventListener('contextmenu', blocked)
  sorter.stop = () => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    window.removeEventListener('pointercancel', cancel)
    window.removeEventListener('keydown', key, { capture: true })
    window.removeEventListener('scroll', scrolled, { capture: true })
    window.removeEventListener('blur', left)
    window.removeEventListener('touchmove', blocked)
    window.removeEventListener('selectstart', blocked)
    window.removeEventListener('contextmenu', blocked)
  }
}

/** Picks the item up by keyboard, or drops it if it is picked up. */
function toggle(sorter: Sorter, value: string) {
  const lifted = sorter.lifted
  if (sorter.drag) return
  if (lifted?.value === value) {
    finish(sorter, 'drop')
    return
  }
  if (lifted) return
  sorter.original = sorter.order
  sorter.lifted = { value, via: 'keyboard' }
  sorter.setLifted(sorter.lifted)
  sorter.announce(
    sortMessage(
      'lift',
      labelOf(sorter.items.get(value)),
      sorter.order.indexOf(value) + 1,
      sorter.order.length,
    ),
  )
}

/** A key on a handle: Space or Enter picks up and drops, the arrows move, Escape puts back. */
function key(sorter: Sorter, value: string, event: ReactKeyboardEvent) {
  const lifted = sorter.lifted
  if (sorter.drag) return
  if (event.key === ' ' || event.key === 'Enter') {
    event.preventDefault()
    toggle(sorter, value)
    return
  }
  if (lifted?.value !== value) return
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    finish(sorter, 'cancel')
    return
  }
  if (event.key === 'Tab') {
    finish(sorter, 'drop')
    return
  }
  const step = sortStepOf(event.key, sorter.layout, isRtl(sorter.list))
  if (!step) return
  event.preventDefault()
  const boxes = boxesOf(sorter)
  moveLifted(sorter, stepTarget(boxes, sorter.order.indexOf(value), step), true)
}

/** After a move: the item that follows the pointer is placed again, and a moved handle keeps focus. */
function settle(sorter: Sorter) {
  place(sorter)
  const value = sorter.refocus
  sorter.refocus = null
  if (value === null) return
  const handle = sorter.handles.get(value)
  if (handle && document.activeElement !== handle) handle.focus({ preventScroll: true })
  const item = sorter.items.get(value)
  item?.scrollIntoView({
    block: 'nearest',
    inline: 'nearest',
    behavior: revealBehavior(scrollingBox(item)),
  })
}

interface SortContextValue {
  sorter: Sorter
  lifted: Lifted | null
  layout: SortLayout
  disabled: boolean
  instructionsId: string
}

const SortContext = createContext<SortContextValue | null>(null)
const SortItemContext = createContext<{
  value: string
  label: string
  disabled: boolean
} | null>(null)

function useSortContext() {
  const context = use(SortContext)
  if (!context) throw new Error('A sortable part must be inside a SortableList.')
  return context
}

export interface SortListOptions {
  /** The items' values, in order. */
  value?: string[]
  defaultValue?: string[]
  /** Called with the new order when an item is dropped in a new place. */
  onValueChange?: (value: string[]) => void
  layout: SortLayout
  disabled: boolean
}

/**
 * Gives the sorter the latest of what the component has. Written outside the
 * hook: React's lint holds a value from `useState` as one never changed, and
 * the sorter is the one thing here that changes outside React. The order is
 * taken only while nothing is picked up, which keeps its own as it moves.
 */
function update(
  sorter: Sorter,
  latest: Partial<Pick<Sorter, 'layout' | 'announce' | 'commit' | 'order' | 'list'>>,
) {
  const { order, ...rest } = latest
  Object.assign(sorter, rest)
  if (order && !sorter.lifted) sorter.order = order
}

/** Something with a `value`, as a sortable item has. */
type Valued = ReactElement<{ value: string }>

/**
 * The list's items: its children, and those inside fragments, each with a
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

/**
 * A sortable list's state, its children in the order shown, and the flow
 * that glides them: give `frame` to an element that clips, and `list` to the
 * positioned list inside it.
 */
export function useSortList(children: ReactNode, options: SortListOptions) {
  const items = valuedChildren(children)
  const present = items.map((item) => item.props.value)
  const [committed, setCommitted] = useControllable(
    options.value,
    options.defaultValue ?? present,
    options.onValueChange,
  )
  const [preview, setPreview] = useState<string[] | null>(null)
  const [lifted, setLifted] = useState<Lifted | null>(null)
  const { announce, region } = useAnnouncer()
  const order = reconcileOrder(preview ?? committed, present)
  const byValue = new Map(items.map((item) => [item.props.value, item]))

  // Made once, and kept: it holds what changes outside React.
  const [sorter] = useState<Sorter>(() => ({
    list: null,
    items: new Map(),
    handles: new Map(),
    itemRefs: new Map(),
    handleRefs: new Map(),
    order,
    original: order,
    lifted: null,
    drag: null,
    refocus: null,
    stop: null,
    layout: options.layout,
    setPreview,
    setLifted,
    commit: () => {},
    announce,
  }))
  useLayoutEffect(() => {
    update(sorter, {
      layout: options.layout,
      announce,
      commit: (next) => {
        if (!sameOrder(next, committed)) setCommitted(next)
      },
      order,
    })
  })
  // Each time the order changes, the item that follows the pointer is put
  // back under it, and a handle moved with its item gets focus back.
  const key = order.join('\u0000')
  useLayoutEffect(() => {
    settle(sorter)
  }, [key, sorter])
  // A pick-up the list unmounts during ends with it.
  useLayoutEffect(() => () => sorter.stop?.(), [sorter])

  const { frame, row } = useFlow<HTMLDivElement, HTMLElement>('[data-slot=sortable-item]')
  const listRef = useMemo(
    () => mergeRefs<HTMLElement>(row, (node) => update(sorter, { list: node })),
    [row, sorter],
  )
  const instructionsId = useId()
  const context: SortContextValue = {
    sorter,
    lifted,
    layout: options.layout,
    disabled: options.disabled,
    instructionsId,
  }
  const ordered = order.flatMap((value) => byValue.get(value) ?? [])
  const extras = (
    <>
      <p id={instructionsId} hidden>
        {sortInstructions}
      </p>
      {region}
    </>
  )
  return { context, frame, listRef, ordered, extras, sorting: lifted !== null }
}

/** One ref callback per value, made once, so React doesn't detach and attach it on every render. */
function refFor(
  refs: Map<string, RefCallback<HTMLElement>>,
  elements: Map<string, HTMLElement>,
  value: string,
) {
  let ref = refs.get(value)
  if (!ref) {
    ref = (node) => {
      if (node) elements.set(value, node)
      else if (elements.get(value)) elements.delete(value)
    }
    refs.set(value, ref)
  }
  return ref
}

/**
 * The props of an item's element, and what its handle reads: its place in
 * the list, and a press anywhere on it but a control.
 */
export function useSortItem(value: string, label: string, disabled: boolean) {
  const { sorter, lifted, disabled: allDisabled } = useSortContext()
  const off = disabled || allDisabled
  return {
    props: {
      ref: refFor(sorter.itemRefs, sorter.items, value),
      'data-lifted': lifted?.value === value ? lifted.via : undefined,
      'data-disabled': off ? '' : undefined,
      'data-label': label,
      onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
        if (off) return
        // A control inside it, the handle included, answers its own press.
        if (event.target instanceof Element && event.target.closest(controls)) return
        press(sorter, value, event, event.pointerType === 'touch')
      },
    },
    item: { value, label, disabled: off },
  }
}

/** The props of an item's handle: a button that picks the item up. */
export function useSortHandle() {
  const { sorter, lifted, instructionsId } = useSortContext()
  const item = use(SortItemContext)
  if (!item) throw new Error('A SortableHandle must be inside a SortableItem.')
  const { value, label, disabled } = item
  return {
    ref: refFor(sorter.handleRefs, sorter.handles, value),
    type: 'button' as const,
    disabled,
    'aria-label': `Move ${label}`,
    'aria-describedby': instructionsId,
    'aria-pressed': lifted?.value === value,
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
      if (!disabled) press(sorter, value, event, false)
    },
    onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => {
      if (!disabled) key(sorter, value, event)
    },
    // A screen reader's activate command sends a click with no press behind
    // it (detail 0), not a key: it picks up and drops as Space does. A
    // pointer's click does nothing, since a drag is how a pointer moves it.
    onClick: (event: ReactMouseEvent<HTMLElement>) => {
      if (disabled || event.detail !== 0) return
      toggle(sorter, value)
    },
    onBlur: () => {
      // Focus left behind drops the item where it is; a blur from its own move doesn't.
      if (
        sorter.refocus === value ||
        sorter.lifted?.value !== value ||
        sorter.lifted.via !== 'keyboard'
      )
        return
      queueMicrotask(() => {
        if (
          sorter.lifted?.value === value &&
          document.activeElement !== sorter.handles.get(value)
        )
          finish(sorter, 'drop')
      })
    },
  }
}

export { SortContext, sortControls, SortItemContext }
