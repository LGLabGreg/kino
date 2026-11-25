'use client'

import { contentTop, followEdges } from '@/registry/lib/scroll'
import {
  type RefCallback,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { flushSync } from 'react-dom'

/*
 * A long list that draws only the rows near what is in view, so ten thousand
 * rows scroll like fifty. A row's height is a guess until it has been drawn
 * and measured, and is kept by the row's key, so new data keeps it. The view
 * holds still while rows above it change height, a list that follows stays
 * at its end while rows arrive, and the row that holds focus is always drawn.
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
  atEnd: boolean
}

/** How close to its end, in px, a list still counts as at it: a scroll position rests a fraction short under zoom. */
const END_SLACK_PX = 4

/** How long a glide may go without a scroll event before it has ended, in ms. */
const MOMENTUM_SETTLED_MS = 150

/** Keys that scroll with a glide, which a write during it would stop. */
const GLIDE_KEYS = new Set(['PageUp', 'PageDown', 'ArrowUp', 'ArrowDown', ' '])

/** Whether the keys typed into a target edit it, so the list leaves them alone. */
function editable(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || target.matches('input, textarea, select'))
  )
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

type Anchor = { key: string; index: number; start: number; top: number }

type Pending = { key: string; align: VirtualAlign; expected: number | null }

type Latest = {
  keys: readonly string[]
  offsets: readonly number[]
  overscan: number
  follow: boolean
  range: { start: number; end: number }
  measured: ReadonlyMap<string, number>
  hold: number
  atEnd: boolean
}

/** What the hook keeps between renders that no render reads. */
type Engine = {
  scroller: HTMLElement | null
  /** The box the rows sit in, and its top in the scroller's content. */
  box: HTMLElement | null
  inset: number
  /** The scroller's scroll position and height, as last read or written, so a commit reads no layout. */
  top: number
  height: number
  /** Whether a new box took the rows since `inset` was read, or it could not be read. */
  insetStale: boolean
  elements: Map<string, HTMLElement>
  keyOf: WeakMap<Element, string>
  refs: Map<string, RefCallback<HTMLElement>>
  observer: ResizeObserver | null
  width: number | null
  /** Whether the list is at its end, read from the person's own scrolling. `null` until it is first laid out. */
  stuck: boolean | null
  /** The last row's key when the view was last placed. */
  lastKey: string | null
  anchor: Anchor | null
  pending: Pending | null
  /** A scroll in flight that a write would stop: a touch's momentum, or the glide a key starts. */
  gliding: boolean
  /** Whether the commit coming was drawn for a scroll alone, which changes no row already drawn. */
  scrolled: boolean
  /** Heights the observer reported, waiting for the next frame. */
  frame: number
  /** `scrollTo`, for the keys that reach an end. */
  jump: ((index: number, align: VirtualAlign) => void) | null
  settle: ReturnType<typeof setTimeout> | undefined
  /** A hold let go: added to the scroll position in the commit that clears it. */
  release: number
  /** Where the focused row was, so the row that takes its place can take focus. */
  focusIndex: number
  focusOnRow: boolean
  refocus: boolean
  latest: Latest | null
}

/**
 * Where each row starts, from every row's height: one more entry than rows,
 * the last being the height of them all.
 */
export function offsetsOf(sizes: readonly number[]): number[] {
  const offsets = new Array<number>(sizes.length + 1)
  offsets[0] = 0
  for (let index = 0; index < sizes.length; index++) {
    offsets[index + 1] = offsets[index] + sizes[index]
  }
  return offsets
}

/** The row whose box holds `y`, from `offsetsOf`: the first or the last past either end. */
export function rowAt(offsets: readonly number[], y: number): number {
  const count = offsets.length - 1
  if (count <= 0) return -1
  let low = 0
  let high = count - 1
  while (low < high) {
    const middle = (low + high) >> 1
    if (offsets[middle + 1] > y) high = middle
    else low = middle + 1
  }
  return low
}

/**
 * The rows to draw, `start` to `end` (not included), for a view `height` tall
 * whose top is `top`, in px down the rows: every row any of it shows, and
 * `overscan` more past each edge. A view with no height yet draws its top row.
 */
export function rangeOf(
  offsets: readonly number[],
  top: number,
  height: number,
  overscan: number,
): { start: number; end: number } {
  const count = offsets.length - 1
  if (count <= 0) return { start: 0, end: 0 }
  const first = rowAt(offsets, top)
  let last = first
  while (last + 1 < count && offsets[last + 1] < top + height) last++
  return {
    start: Math.max(0, first - overscan),
    end: Math.min(count, last + 1 + overscan),
  }
}

/**
 * How far to scroll, in px, so the row at the view's top stays where it was:
 * where it starts now less where it started, found by its key, so rows
 * added, removed or measured above it move nothing that is seen. 0 when the
 * row is gone, so the view stays where it is.
 */
export function anchorShift(
  anchor: { key: string; index: number; start: number },
  keys: readonly string[],
  offsets: readonly number[],
): number {
  const index =
    keys[anchor.index] === anchor.key ? anchor.index : keys.indexOf(anchor.key)
  return index < 0 ? 0 : offsets[index] - anchor.start
}

/**
 * Where the view's top goes to show a row as `align` asks, in px down the
 * rows, clear of the scroller's scroll padding and within `0` to `max`.
 * `nearest` moves it only as far as it takes, a row taller than the view
 * shows its top, and `null` means it already shows.
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

/** Whether a scroller is at its end, within a few px. */
export function atEndOf(box: {
  scrollTop: number
  scrollHeight: number
  clientHeight: number
}) {
  return box.scrollHeight - box.clientHeight - box.scrollTop <= END_SLACK_PX
}

/**
 * Whether a list holds its end after a scroll from `from` to `to`, in px: at
 * the end it does, and only scrolling back lets go. A scroll that lands where
 * the list put it, short of an end that grew since, holds on.
 */
export function stuckAfter(
  stuck: boolean | null,
  scroll: { from: number; to: number; atEnd: boolean },
): boolean | null {
  if (scroll.atEnd) return true
  if (scroll.to < scroll.from - 0.5) return false
  return stuck
}

const sameRange = (
  a: { start: number; end: number },
  b: { start: number; end: number },
) => a.start === b.start && a.end === b.end

/** A row's role, its own or its element's. */
function roleOf(element: Element) {
  const role = element.getAttribute('role')
  if (role) return role
  if (element.tagName === 'TR') return 'row'
  if (element.tagName === 'LI') return 'listitem'
  return null
}

/** Reads where the rows' box sits in the scroller: layout read only when the box or the scroller changes. */
function readBox(state: Engine): boolean {
  const { scroller, box } = state
  if (!scroller || !box || !scroller.contains(box)) return false
  state.inset = contentTop(box, scroller)
  return true
}

/** How far a scroller can scroll, read from its layout. */
function maxOf(scroller: HTMLElement) {
  return Math.max(0, scroller.scrollHeight - scroller.clientHeight)
}

/** Writes an attribute only when it changes, so a commit that moves nothing restyles nothing. */
function setAria(element: Element, name: string, value: number) {
  const text = String(value)
  if (element.getAttribute(name) !== text) element.setAttribute(name, text)
}

const FOCUSABLE = 'a[href],button,input,select,textarea,summary,[tabindex]'

/** A list that draws only the rows near what is in view. Every option is required. */
export function useVirtual({
  count,
  getKey,
  estimate,
  overscan,
  follow,
}: VirtualOptions): Virtual {
  const [measured, setMeasured] = useState<ReadonlyMap<string, number>>(() => new Map())
  const [view, setView] = useState({ top: 0, height: 0 })
  const [hold, setHold] = useState(0)
  const [atEnd, setAtEnd] = useState(false)
  const [focused, setFocused] = useState<string | null>(null)
  const engine = useRef<Engine>({
    scroller: null,
    box: null,
    inset: 0,
    top: 0,
    height: 0,
    insetStale: true,
    elements: new Map(),
    keyOf: new WeakMap(),
    refs: new Map(),
    observer: null,
    width: null,
    stuck: null,
    lastKey: null,
    anchor: null,
    pending: null,
    gliding: false,
    scrolled: false,
    frame: 0,
    jump: null,
    settle: undefined,
    release: 0,
    focusIndex: -1,
    focusOnRow: false,
    refocus: false,
    latest: null,
  })

  // Every row's key and place, worked out again only when the data or a height changes.
  const { keys, offsets } = useMemo(() => {
    const keys: string[] = []
    const sizes: number[] = []
    for (let index = 0; index < count; index++) {
      const key = getKey(index)
      keys.push(key)
      sizes.push(measured.get(key) ?? estimate(index))
    }
    return { keys, offsets: offsetsOf(sizes) }
  }, [count, getKey, estimate, measured])
  const range = rangeOf(offsets, view.top, view.height, overscan)
  const rows: VirtualRow[] = []
  for (let index = range.start; index < range.end; index++) {
    rows.push({ index, key: keys[index], start: offsets[index] - hold })
  }
  // The focused row stays drawn wherever the view is, in its place in the
  // order, with a row each side, so Tab and Shift+Tab go on to its neighbours.
  const focusedIndex = focused === null ? -1 : keys.indexOf(focused)
  if (focusedIndex >= 0 && (focusedIndex < range.start || focusedIndex >= range.end)) {
    const around: VirtualRow[] = []
    for (
      let index = Math.max(0, focusedIndex - 1);
      index <= Math.min(count - 1, focusedIndex + 1);
      index++
    )
      if (index < range.start || index >= range.end)
        around.push({ index, key: keys[index], start: offsets[index] - hold })
    if (focusedIndex < range.start) rows.unshift(...around)
    else rows.push(...around)
  }

  // Each frame the scroll or a size changed in, before it paints.
  const sync = useCallback((flush: boolean) => {
    const state = engine.current
    const latest = state.latest
    const scroller = state.scroller
    if (!latest || !scroller) return
    const top = state.top - state.inset + latest.hold
    const height = state.height
    const next = rangeOf(latest.offsets, top, height, latest.overscan)
    // The scroll height is read only near the end, where it decides anything.
    const near = state.top + 2 * height >= state.inset + (latest.offsets.at(-1) ?? 0)
    const end =
      near &&
      atEndOf({
        scrollTop: state.top + latest.hold,
        scrollHeight: scroller.scrollHeight,
        clientHeight: height,
      })
    if (sameRange(next, latest.range) && end === latest.atEnd) return
    const update = () => {
      setView({ top, height })
      setAtEnd(end)
    }
    if (flush) {
      state.scrolled = true
      flushSync(update)
    } else update()
  }, [])

  /** Notes the row at the view's top, for `anchorShift` once sizes change. */
  const noteAnchor = useCallback(() => {
    const state = engine.current
    const latest = state.latest
    const scroller = state.scroller
    if (!latest || !scroller || latest.keys.length === 0) {
      state.anchor = null
      return
    }
    const top = state.top - state.inset + latest.hold
    const index = rowAt(latest.offsets, top)
    state.anchor = {
      key: latest.keys[index],
      index,
      start: latest.offsets[index],
      top,
    }
  }, [])

  /** Takes new heights in, by key; at a new width only the drawn rows' heights still hold. */
  const remeasure = useCallback((changes: Map<string, number>, rewrap: boolean) => {
    const state = engine.current
    setMeasured((previous) => {
      const next = new Map(rewrap ? [] : previous)
      if (rewrap)
        for (const key of state.elements.keys()) {
          const size = previous.get(key)
          if (size !== undefined) next.set(key, size)
        }
      for (const [key, size] of changes) next.set(key, size)
      // Heights of rows long gone are let go, by key.
      const live = state.latest?.keys
      if (live && next.size > live.length * 2 + 64) {
        const kept = new Set(live)
        for (const key of next.keys()) if (!kept.has(key)) next.delete(key)
      }
      return next
    })
  }, [])

  /*
   * Rows are measured when they are drawn, in the commit that draws them, so
   * none paints at its guess. The observer catches what changes size outside
   * a render (a new width, a font or an image that loads). Layout changed
   * inside its pass, under a box it has not reported yet, leaves its notes
   * undelivered and raises an error on the page, so a pass that only reports
   * rows takes effect on the next frame. One that reports the scroller,
   * which holds everything else it observes, takes effect at once.
   */
  const measure = useCallback(
    (entries: ResizeObserverEntry[]) => {
      const state = engine.current
      const latest = state.latest
      if (!latest) return
      const changes = new Map<string, number>()
      let width: number | null = null
      for (const entry of entries) {
        if (entry.target === state.scroller) {
          width = entry.contentRect.width
          state.height = state.scroller.clientHeight
          readBox(state)
          continue
        }
        const key = state.keyOf.get(entry.target)
        if (key === undefined) continue
        const height = entry.borderBoxSize[0]?.blockSize ?? entry.contentRect.height
        if (latest.measured.get(key) !== height) changes.set(key, height)
      }
      // At a new width, a row not drawn may wrap differently: its height is a guess again.
      const rewrap = width !== null && state.width !== null && width !== state.width
      if (width !== null) state.width = width
      if (width !== null) {
        if (changes.size === 0 && !rewrap) sync(true)
        else flushSync(() => remeasure(changes, rewrap))
      } else if (changes.size > 0) {
        cancelAnimationFrame(state.frame)
        state.frame = requestAnimationFrame(() => remeasure(changes, false))
      }
    },
    [remeasure, sync],
  )

  const observerOf = useCallback(() => {
    const state = engine.current
    state.observer ??= new ResizeObserver(measure)
    return state.observer
  }, [measure])

  const measureRef = (index: number) => {
    const key = getKey(index)
    const refs = engine.current.refs
    let ref = refs.get(key)
    if (!ref) {
      ref = (element: HTMLElement | null) => {
        if (!element) return
        const state = engine.current
        state.elements.set(key, element)
        state.keyOf.set(element, key)
        observerOf().observe(element)
        return () => {
          if (state.elements.get(key) === element) state.elements.delete(key)
          state.observer?.unobserve(element)
        }
      }
      refs.set(key, ref)
    }
    return ref
  }

  const letGo = useCallback(() => {
    const state = engine.current
    state.gliding = false
    const held = state.latest?.hold ?? 0
    if (held === 0) return
    state.release = held
    flushSync(() => setHold(0))
  }, [])

  const settleSoon = useCallback(() => {
    const state = engine.current
    clearTimeout(state.settle)
    state.settle = setTimeout(letGo, MOMENTUM_SETTLED_MS)
  }, [letGo])

  const scrollerRef = useCallback(
    (scroller: HTMLElement | null) => {
      if (!scroller) return
      const state = engine.current
      state.scroller = scroller
      // The browser's own anchoring would correct what the anchor already does.
      scroller.style.overflowAnchor = 'none'
      const onScroll = () => {
        const was = state.top
        state.top = scroller.scrollTop
        state.height = scroller.clientHeight
        const pending = state.pending
        if (pending && Math.abs(state.top - (pending.expected ?? -1)) > 1)
          state.pending = null
        if (state.gliding && state.settle !== undefined) settleSoon()
        state.stuck = stuckAfter(state.stuck, {
          from: was,
          to: state.top,
          atEnd: atEndOf({
            scrollTop: state.top + (state.latest?.hold ?? 0),
            scrollHeight: scroller.scrollHeight,
            clientHeight: state.height,
          }),
        })
        noteAnchor()
        sync(true)
      }
      const onTouchStart = () => {
        clearTimeout(state.settle)
        state.settle = undefined
        state.gliding = true
        state.pending = null
      }
      const onTouchEnd = () => settleSoon()
      // On the window, after the block's own handlers, so a widget in a row that takes a key keeps it.
      const onKeyDown = (event: KeyboardEvent) => {
        if (
          !(event.target instanceof Node) ||
          !scroller.contains(event.target) ||
          event.defaultPrevented ||
          event.altKey ||
          event.metaKey ||
          editable(event.target)
        )
          return
        const count = state.latest?.keys.length ?? 0
        if (
          (event.key === 'Home' || event.key === 'End') &&
          !event.shiftKey &&
          count > 0
        ) {
          // The browser glides to the end it knows, which moves as the rows it passes are measured.
          event.preventDefault()
          if (event.key === 'Home') state.jump?.(0, 'start')
          else state.jump?.(count - 1, 'end')
        } else if (GLIDE_KEYS.has(event.key) && !event.ctrlKey) {
          state.pending = null
          state.gliding = true
          settleSoon()
        }
      }
      const onWheel = () => {
        state.pending = null
      }
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
      scroller.addEventListener('scroll', onScroll, { passive: true })
      scroller.addEventListener('touchstart', onTouchStart, { passive: true })
      scroller.addEventListener('touchend', onTouchEnd, { passive: true })
      scroller.addEventListener('touchcancel', onTouchEnd, { passive: true })
      scroller.addEventListener('wheel', onWheel, { passive: true })
      const view = scroller.ownerDocument.defaultView
      view?.addEventListener('keydown', onKeyDown)
      scroller.addEventListener('focusin', onFocusIn)
      scroller.addEventListener('focusout', onFocusOut)
      observerOf().observe(scroller)
      state.top = scroller.scrollTop
      state.height = scroller.clientHeight
      setView({ top: state.top, height: state.height })
      return () => {
        scroller.removeEventListener('scroll', onScroll)
        scroller.removeEventListener('touchstart', onTouchStart)
        scroller.removeEventListener('touchend', onTouchEnd)
        scroller.removeEventListener('touchcancel', onTouchEnd)
        scroller.removeEventListener('wheel', onWheel)
        view?.removeEventListener('keydown', onKeyDown)
        scroller.removeEventListener('focusin', onFocusIn)
        scroller.removeEventListener('focusout', onFocusOut)
        state.observer?.unobserve(scroller)
        stopEdges()
        clearTimeout(state.settle)
        cancelAnimationFrame(state.frame)
        if (state.scroller === scroller) state.scroller = null
      }
    },
    [noteAnchor, observerOf, settleSoon, sync],
  )

  /**
   * Puts the view where it belongs after a change, before it paints, from
   * the scroll position last read. It reads layout only to reach an end or
   * a row asked for.
   */
  const place = useCallback(() => {
    const state = engine.current
    const latest = state.latest
    const scroller = state.scroller
    if (!latest || !scroller) return
    const write = (top: number) => {
      scroller.scrollTop = Math.max(0, top)
      state.top = scroller.scrollTop
    }
    const toEnd = () => {
      const max = maxOf(scroller)
      if (Math.abs(state.top - max) > 0.5) write(max)
    }
    if (state.stuck === null) {
      state.stuck =
        latest.follow ||
        atEndOf({
          scrollTop: state.top,
          scrollHeight: scroller.scrollHeight,
          clientHeight: state.height,
        })
    }
    // The last row as the view last saw it: a row added after it is new data, not a new height.
    const lastSeen = state.lastKey
    state.lastKey = latest.keys.at(-1) ?? null
    if (state.release !== 0) {
      write(state.top + state.release)
      state.release = 0
    } else if (state.stuck && (latest.follow || state.lastKey === lastSeen)) {
      // At the end it stays there: rows that arrive, when it follows, or rows measured above.
      toEnd()
    } else if (state.pending) {
      const pending = state.pending
      const index = latest.keys.indexOf(pending.key)
      const computed = getComputedStyle(scroller)
      const max = maxOf(scroller)
      const target =
        index < 0
          ? null
          : alignedTop(
              { start: latest.offsets[index], end: latest.offsets[index + 1] },
              {
                top: state.top - state.inset,
                height: state.height,
                max: max - state.inset,
              },
              {
                start: Number.parseFloat(computed.scrollPaddingTop) || 0,
                end: Number.parseFloat(computed.scrollPaddingBottom) || 0,
              },
              pending.align,
            )
      if (target === null || Math.abs(target + state.inset - state.top) <= 0.5) {
        state.pending = null
      } else {
        write(target + state.inset)
        pending.expected = state.top
        state.stuck = max - state.top <= END_SLACK_PX
      }
    } else if (state.anchor && state.top - state.inset > 0.5) {
      // Away from the top, what is seen stays still; at the top, the view stays there, so rows that arrive above show.
      const shift = anchorShift(state.anchor, latest.keys, latest.offsets)
      if (Math.abs(shift) > 0.5) {
        // A write during a glide stops it: hold the shift until it ends.
        if (state.gliding) setHold(latest.hold + shift)
        else write(state.top + shift)
      }
    }
    noteAnchor()
  }, [noteAnchor])

  // After every commit: a new size, new data or a new view each moves where the rows sit.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- it runs on every commit, and each state it sets settles once the view matches
  useLayoutEffect(() => {
    const state = engine.current
    // Whether anything that places the view changed: a commit that only drew the rows a scroll reached moves nothing.
    const moved =
      state.latest === null ||
      state.latest.offsets !== offsets ||
      state.latest.hold !== hold ||
      state.release !== 0 ||
      state.pending !== null ||
      state.stuck === null
    state.latest = {
      keys,
      offsets,
      overscan,
      follow,
      range,
      measured,
      hold,
      atEnd,
    }

    // Where the rows' box sits in the scroller, below anything drawn above it:
    // read again when the box or the scroller's size changes.
    const first = rows.length > 0 ? state.elements.get(rows[0].key) : undefined
    const box = first?.parentElement ?? null
    if (box !== state.box) {
      state.box = box
      state.insetStale = true
    }
    if (state.insetStale && readBox(state)) state.insetStale = false

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
    if (focused !== null) {
      const index = keys.indexOf(focused)
      if (index >= 0) state.focusIndex = index
      else {
        const active = document.activeElement
        state.refocus =
          count > 0 && state.focusOnRow && (active === null || active === document.body)
        // oxlint-disable-next-line react/set-state-in-effect -- focus goes with its row only once the commit has removed it, so the row that takes its place is drawn in the next
        setFocused(state.refocus ? keys[Math.min(state.focusIndex, count - 1)] : null)
      }
    }
    if (state.refocus && focused !== null && keys.includes(focused)) {
      const element = state.elements.get(focused)
      if (element) {
        state.refocus = false
        if (element.matches(FOCUSABLE)) element.focus()
      }
    }

    // The refs of rows long gone are let go by key; their heights go when rows are next measured.
    if (state.refs.size > count * 2 + 64) {
      const live = new Set(keys)
      for (const key of state.refs.keys()) if (!live.has(key)) state.refs.delete(key)
    }

    // Each row drawn for the first time, or every drawn row after a render
    // that may have changed what is in them, measured before it paints.
    const all = !state.scrolled
    state.scrolled = false
    const changes = new Map<string, number>()
    for (const row of rows) {
      if (!all && measured.has(row.key)) continue
      const element = state.elements.get(row.key)
      if (!element) continue
      const height = element.getBoundingClientRect().height
      if (measured.get(row.key) !== height) changes.set(row.key, height)
    }
    if (changes.size > 0) {
      cancelAnimationFrame(state.frame)
      remeasure(changes, false)
      // The view is placed in the commit those heights make.
      return
    }

    if (moved) {
      place()
      sync(false)
    }
  })

  const scrollTo = useCallback(
    (index: number, align: VirtualAlign) => {
      const state = engine.current
      const key = state.latest?.keys[index]
      if (key === undefined) return
      clearTimeout(state.settle)
      if (state.gliding) letGo()
      state.pending = { key, align, expected: null }
      state.stuck = false
      place()
      sync(false)
    },
    [letGo, place, sync],
  )

  useLayoutEffect(() => {
    engine.current.jump = scrollTo
  }, [scrollTo])

  return {
    scrollerRef,
    size: offsets[count],
    rows,
    measureRef,
    scrollTo,
    atEnd,
  }
}
