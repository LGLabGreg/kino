'use client'

import { contentTop, followEdges } from '@/registry/lib/scroll'
import {
  createStickToBottom,
  createVirtualizer,
  type StickToBottomState,
} from '@ui-sdk/core'
import {
  type RefCallback,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'

/*
 * A long list that draws only the rows near what is in view, so ten thousand
 * rows scroll like fifty, on ui-sdk's `createVirtualizer`: it reads the
 * scroll, works out which rows to draw and where, measures each row by its
 * key, and keeps what is seen still while a row above it is measured to a new
 * height. A list that follows its end does so on `createStickToBottom`. Kino
 * adds what they don't: the view holds still while rows arrive or leave above
 * it, the row that holds focus is drawn wherever the view is and hands focus
 * on when it leaves, each row says its place for assistive tech, a scroll to
 * a row lands on it, clear of the edge fades, once the rows it passes are
 * measured, a list scrolled back from its end by any means lets go of it,
 * and the edges fade. What sits in the scroller above the rows' box is
 * measured once the box is drawn.
 *
 * The block lays it out: a scroller that takes `scrollerRef`, one box inside
 * it, `relative` and `size` tall, and each of `rows` placed absolutely in that
 * box at its `start` (`translate-y`), with `measureRef(index)`. Nothing here
 * moves anything: a row that arrives or leaves is the block's move. The box
 * takes no live role (`log`, `status`): scrolling draws old rows into it, and
 * rows that arrive out of view are never drawn, so a block announces what
 * arrives in a live region of its own.
 */

export type VirtualOptions = {
  count: number
  getKey: (index: number) => string
  /** A row's height in px before it is measured. */
  estimate: (index: number) => number
  /** Rows drawn past each edge. */
  overscan: number
  /** Stay at the end while rows arrive, as a log does. */
  follow: boolean
}

export type VirtualAlign = 'start' | 'center' | 'end' | 'nearest'

export type VirtualRow = {
  index: number
  key: string
  /** Its top in the rows' box, in px. */
  start: number
}

export type Virtual = {
  scrollerRef: RefCallback<HTMLElement>
  /** The height of every row together. */
  size: number
  rows: readonly VirtualRow[]
  measureRef: (index: number) => RefCallback<HTMLElement>
  scrollTo: (index: number, align: VirtualAlign) => void
  /** Whether a list that follows is at its end, for its "Jump to latest". A list that doesn't follow has no end to hold: `true`. */
  atEnd: boolean
}

/** Roles whose items say their place with `aria-posinset` and `aria-setsize`. */
const SET_ROLES = new Set([
  'article',
  'listitem',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'option',
  'radio',
  'tab',
  'treeitem',
])

/** How close to its end, in px, a list still counts as at it: ui-sdk's stick's own default. */
const END_SLACK_PX = 24

const FOCUSABLE = 'a[href],button,input,select,textarea,summary,[tabindex]'

/** What the hook keeps between renders that no render reads. */
type Engine = {
  scroller: HTMLElement | null
  /** The box the rows sit in, and its top in the scroller's content: the virtualizer's `scrollMargin`. */
  box: HTMLElement | null
  inset: number
  /** The options as last rendered, which the virtualizer reads whenever it works the rows out. */
  keys: readonly string[]
  estimate: (index: number) => number
  /** The rows always drawn: the focused one and one each side. */
  kept: readonly number[]
  elements: Map<string, HTMLElement>
  keyOf: WeakMap<Element, string>
  refs: Map<string, { index: number; ref: RefCallback<HTMLElement> }>
  /** A row asked for, placed again in each commit until the rows it passes are measured and the view stops moving. */
  pending: { key: string; align: VirtualAlign } | null
  /** Where the focused row was, so the row that takes its place can take focus. */
  focusIndex: number
  focusOnRow: boolean
  refocus: boolean
}

/** The rows drawn around the focused one, so Tab and Shift+Tab go on to its neighbours. */
export function keptAround(focused: number, count: number): number[] {
  if (focused < 0 || focused >= count) return []
  const kept: number[] = []
  for (
    let index = Math.max(0, focused - 1);
    index <= Math.min(count - 1, focused + 1);
    index++
  )
    kept.push(index)
  return kept
}

/**
 * The row at the view's top, `top` px down the rows, from the rows drawn, and
 * how far into it the view starts: what the view holds still by when rows
 * arrive or leave above it. `null` with no row there.
 */
export function anchorOf(
  rows: readonly { key: string; start: number; size: number }[],
  top: number,
): { key: string; into: number } | null {
  for (const row of rows)
    if (row.start + row.size > top) return { key: row.key, into: top - row.start }
  return null
}

/**
 * Where the view's top goes to show a row as `align` asks, in px down the
 * rows, clear of the scroller's scroll padding and within `0` to `max`.
 * `nearest` moves it only as far as it takes, a row taller than the view
 * shows its top, and `null` means it already shows. ui-sdk's `scrollToIndex`
 * brings the row in, and this places it clear of the edge fades.
 */
export function alignedTop(
  row: { start: number; end: number },
  view: { top: number; height: number; max: number },
  padding: { start: number; end: number },
  align: VirtualAlign,
): number | null {
  const room = view.height - padding.start - padding.end
  const toStart = row.start - padding.start
  const toEnd = row.end - view.height + padding.end
  let top: number
  if (align === 'start') top = toStart
  else if (align === 'end') top = toEnd
  else if (align === 'center') top = (row.start + row.end) / 2 - view.height / 2
  else if (row.start < view.top + padding.start || row.end - row.start > room)
    top = toStart
  else if (row.end > view.top + view.height - padding.end) top = toEnd
  else return null
  return Math.min(view.max, Math.max(0, top))
}

/** Whether two lists hold the same values in the same order. */
export function sameList<Value>(a: readonly Value[], b: readonly Value[]) {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let index = 0; index < a.length; index++) if (a[index] !== b[index]) return false
  return true
}

/** ui-sdk's word for each of ours: `nearest` is its `auto`. */
const ALIGN = {
  start: 'start',
  center: 'center',
  end: 'end',
  nearest: 'auto',
} as const

/** A row's role, its own or its element's. */
function roleOf(element: Element) {
  const role = element.getAttribute('role')
  if (role) return role
  if (element.tagName === 'TR') return 'row'
  if (element.tagName === 'LI') return 'listitem'
  return null
}

/** Writes an attribute only when it changes, so a commit that moves nothing restyles nothing. */
function setAria(element: Element, name: string, value: number) {
  const text = String(value)
  if (element.getAttribute(name) !== text) element.setAttribute(name, text)
}

const FOLLOWING: StickToBottomState = {
  following: true,
  atBottom: true,
  unseen: false,
}

/**
 * Places the row asked for, from where the virtualizer last drew it: ui-sdk
 * brings it in when it isn't drawn, and `alignedTop` places it. Returns
 * whether the view moved, so a commit that moves nothing ends the request.
 */
function placeRow(
  state: Engine,
  virtual: ReturnType<typeof createVirtualizer>,
  pending: { key: string; align: VirtualAlign },
): boolean {
  const scroller = state.scroller
  const index = state.keys.indexOf(pending.key)
  if (!scroller || index < 0) return false
  const was = scroller.scrollTop
  let item = virtual.items().find((row) => row.key === pending.key)
  if (!item) {
    virtual.scrollToIndex(index, { align: ALIGN[pending.align], behavior: 'instant' })
    item = virtual.items().find((row) => row.key === pending.key)
  }
  if (item) {
    const computed = getComputedStyle(scroller)
    const target = alignedTop(
      { start: item.start, end: item.start + item.size },
      {
        top: scroller.scrollTop - state.inset,
        height: scroller.clientHeight,
        max: scroller.scrollHeight - scroller.clientHeight - state.inset,
      },
      {
        start: Number.parseFloat(computed.scrollPaddingTop) || 0,
        end: Number.parseFloat(computed.scrollPaddingBottom) || 0,
      },
      pending.align,
    )
    if (target !== null && Math.abs(target + state.inset - scroller.scrollTop) > 0.5) {
      scroller.scrollTop = target + state.inset
      virtual.refresh()
    }
  }
  return Math.abs(scroller.scrollTop - was) > 0.5
}

/** The virtualizer and the stick, over the state they read, made once per list. */
function createList(
  keys: readonly string[],
  estimate: (index: number) => number,
  overscan: number,
) {
  const state: Engine = {
    scroller: null,
    box: null,
    inset: 0,
    keys,
    estimate,
    kept: [],
    elements: new Map(),
    keyOf: new WeakMap(),
    refs: new Map(),
    pending: null,
    focusIndex: -1,
    focusOnRow: false,
    refocus: false,
  }
  const virtual = createVirtualizer({
    count: () => state.keys.length,
    key: (index) => state.keys[index],
    estimate: (index) => state.estimate(index),
    overscan,
    keep: () => state.kept,
    // Read on every use, so the box's place, measured in a commit, reaches it.
    get scrollMargin() {
      return state.inset
    },
  })
  const stick = createStickToBottom()
  return {
    state,
    virtual,
    stick,
    readRows: () => virtual.items(),
    watchRows: (listener: () => void) => virtual.subscribe(listener),
    readEnd: () => stick.get(),
    watchEnd: (listener: () => void) => stick.subscribe(listener),
  }
}

/** A list that draws only the rows near what is in view. Every option is required. */
export function useVirtual({
  count,
  getKey,
  estimate,
  overscan,
  follow,
}: VirtualOptions): Virtual {
  const keys = useMemo(
    () => Array.from({ length: count }, (_, index) => getKey(index)),
    [count, getKey],
  )
  const [focused, setFocused] = useState<string | null>(null)
  const [{ state, virtual, stick, readRows, watchRows, readEnd, watchEnd }] = useState(
    () => createList(keys, estimate, overscan),
  )
  const engine = useRef(state)

  const items = useSyncExternalStore(watchRows, readRows, readRows)
  const stuck = useSyncExternalStore(watchEnd, readEnd, () => FOLLOWING)
  // A render with new data draws the rows the virtualizer last worked out
  // under their new keys, and drops those past the end; the layout effect
  // works them out again before anything paints.
  const rows = useMemo(() => {
    const drawn: VirtualRow[] = []
    for (const item of items)
      if (item.index < count)
        drawn.push({
          index: item.index,
          key: keys[item.index],
          start: item.start,
        })
    return drawn
  }, [items, keys, count])

  const measureRef = (index: number) => {
    const key = keys[index]
    const refs = engine.current.refs
    const known = refs.get(key)
    if (known?.index === index) return known.ref
    // The virtualizer measures a row by its index: a row that moves takes a new ref.
    const ref: RefCallback<HTMLElement> = (element) => {
      if (!element) return
      const state = engine.current
      state.elements.set(key, element)
      state.keyOf.set(element, key)
      const stop = virtual.measure(index, element)
      return () => {
        stop()
        if (state.elements.get(key) === element) state.elements.delete(key)
      }
    }
    refs.set(key, { index, ref })
    return ref
  }

  const scrollerRef = useCallback(
    (scroller: HTMLElement | null) => {
      if (!scroller) return
      const state = engine.current
      state.scroller = scroller
      // The browser's own anchoring would correct what the virtualizer and the anchor already do.
      scroller.style.overflowAnchor = 'none'
      const onFocusIn = (event: FocusEvent) => {
        for (
          let node = event.target instanceof Element ? event.target : null;
          node && node !== scroller;
          node = node.parentElement
        ) {
          const key = state.keyOf.get(node)
          if (key === undefined) continue
          state.focusOnRow = node === event.target
          setFocused(key)
          return
        }
      }
      const onFocusOut = (event: FocusEvent) => {
        const next = event.relatedTarget
        if (next instanceof Node && scroller.contains(next)) return
        // Focus lost to a row that left: the layout effect hands it on.
        if (next === null && state.refocus) return
        setFocused(null)
      }
      // First, so the fades read the scroll before the rows it reaches are drawn.
      const stopEdges = followEdges(scroller, '--scroll-fade')
      const disconnect = virtual.connect(scroller)
      const unstick = follow ? stick.connect(scroller) : undefined
      // Scrolled back from the end any way, a scrollbar's thumb included, the
      // list lets go here, as the virtualizer hears the scroll: the stick
      // hears the rows it redraws first, and would take the view back.
      let last = scroller.scrollTop
      const unwatch = follow
        ? virtual.subscribe(() => {
            const top = scroller.scrollTop
            const past = scroller.scrollHeight - scroller.clientHeight - top
            if (top < last - 1 && past > END_SLACK_PX && stick.get().following)
              stick.release()
            last = top
          })
        : undefined
      scroller.addEventListener('focusin', onFocusIn)
      scroller.addEventListener('focusout', onFocusOut)
      return () => {
        scroller.removeEventListener('focusin', onFocusIn)
        scroller.removeEventListener('focusout', onFocusOut)
        unwatch?.()
        unstick?.()
        disconnect()
        stopEdges()
        if (state.scroller === scroller) state.scroller = null
      }
    },
    [follow, stick, virtual],
  )

  // After every commit, before it paints: new data, focus and a row asked for each place the view.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- it runs on every commit, and each state it sets settles once the view matches
  useLayoutEffect(() => {
    const state = engine.current
    const scroller = state.scroller

    // Where the rows' box sits in the scroller, below anything drawn above it: read again when the box changes.
    const first = rows.length > 0 ? state.elements.get(rows[0].key) : undefined
    const box = first?.parentElement ?? null
    if (scroller && box && box !== state.box && scroller.contains(box)) {
      state.box = box
      const inset = contentTop(box, scroller)
      if (inset !== state.inset) {
        state.inset = inset
        virtual.refresh()
      }
    }

    // Focus moves with its row's key: the rows around it stay drawn.
    const focusedIndex = focused === null ? -1 : keys.indexOf(focused)
    if (focusedIndex >= 0) state.focusIndex = focusedIndex
    const kept = keptAround(focusedIndex, count)
    const keptChanged = !sameList(kept, state.kept)
    const dataChanged = !sameList(keys, state.keys)
    // A guess is read only for a row not yet measured, so a new one waits for the next change.
    state.estimate = estimate
    if (dataChanged || keptChanged) {
      // Away from its top, the row at the view's top stays where it is when rows arrive or leave above it; at the top, they show.
      const top = scroller ? scroller.scrollTop - state.inset : 0
      const anchor =
        dataChanged && scroller && top > 0.5 && !(follow && stick.get().following)
          ? anchorOf(items, top)
          : null
      state.keys = keys
      state.kept = kept
      virtual.refresh()
      const index = anchor ? keys.indexOf(anchor.key) : -1
      if (scroller && anchor && index >= 0) {
        // ui-sdk brings the row in wherever it went, and its start places the view.
        let row = virtual.items().find((item) => item.key === anchor.key)
        if (!row) {
          virtual.scrollToIndex(index, { align: 'start', behavior: 'instant' })
          row = virtual.items().find((item) => item.key === anchor.key)
        }
        if (row) {
          scroller.scrollTop = row.start + anchor.into + state.inset
          virtual.refresh()
        }
      }
    }

    if (state.pending && !placeRow(state, virtual, state.pending)) state.pending = null

    // Each row's place in the whole list, for assistive tech, by its role.
    let headerRows: number | null = null
    let table: Element | null = null
    for (const row of rows) {
      const element = state.elements.get(row.key)
      if (!element) continue
      const role = roleOf(element)
      if (role === 'row') {
        if (headerRows === null) {
          table = element.closest('[role=grid],[role=table],[role=treegrid],table')
          headerRows = 0
          const box = element.parentElement
          if (table && box)
            for (const other of table.querySelectorAll('[role=row],tr'))
              if (
                !state.keyOf.has(other) &&
                other.compareDocumentPosition(box) & Node.DOCUMENT_POSITION_FOLLOWING
              )
                headerRows++
        }
        setAria(element, 'aria-rowindex', row.index + 1 + headerRows)
      } else if (role && SET_ROLES.has(role)) {
        setAria(element, 'aria-setsize', count)
        setAria(element, 'aria-posinset', row.index + 1)
      }
    }
    if (table) setAria(table, 'aria-rowcount', count + (headerRows ?? 0))

    // The focused row left the data: the row that takes its place takes focus,
    // when focus was on the row itself and went with it.
    if (focused !== null && focusedIndex < 0) {
      const active = document.activeElement
      state.refocus =
        count > 0 && state.focusOnRow && (active === null || active === document.body)
      // oxlint-disable-next-line react/set-state-in-effect -- focus goes with its row only once the commit has removed it, so the row that takes its place is drawn in the next
      setFocused(state.refocus ? keys[Math.min(state.focusIndex, count - 1)] : null)
    }
    if (state.refocus && focusedIndex >= 0) {
      const element = state.elements.get(focused ?? '')
      if (element) {
        state.refocus = false
        if (element.matches(FOCUSABLE)) element.focus()
      }
    }

    // The refs of rows long gone are let go by key.
    if (state.refs.size > count * 2 + 64) {
      const live = new Set(keys)
      for (const key of state.refs.keys()) if (!live.has(key)) state.refs.delete(key)
    }
  })

  const scrollTo = useCallback(
    (index: number, align: VirtualAlign) => {
      const state = engine.current
      const key = state.keys[index]
      if (key === undefined) return
      // A row already in place moves nothing, and draws nothing that would place it again.
      const pending = { key, align }
      state.pending = placeRow(state, virtual, pending) ? pending : null
    },
    [virtual],
  )

  return {
    scrollerRef,
    size: virtual.size(),
    rows,
    measureRef,
    scrollTo,
    atEnd: follow ? stuck.atBottom : true,
  }
}
