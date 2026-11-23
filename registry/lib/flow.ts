/*
 * Items in a wrapping row, such as a field's chips, that glide to their new
 * places when the row changes, and leave as a copy that fades where they
 * were: Base UI unmounts a chip the moment it is removed, so the chip itself
 * can't stay to leave. JavaScript only says where each item starts from;
 * the item's own `translate` transition, on `layout`, does the moving, and
 * its leaving styles, on `exit`, the fading. Kept outside components: the
 * React Compiler drops a forced reflow written inside one.
 *
 * An item marked `data-flow=start` is being put where it was seen, so its
 * `translate` must not transition then; a leaving copy is marked
 * `data-leaving`, and its `translate` goes to none on `layout` there. The
 * copy goes back into the row where the item was, so it keeps its place in
 * the order things are painted (an avatar stack's faces overlap); a row that
 * styles its children leaves `[data-leaving]` out. An item marked
 * `data-flow-held` is placed by whoever holds it, such as a row dragged in a
 * sortable list: it is measured, so it glides once let go, but never glided
 * while held.
 */

import { translateOf } from '@/registry/lib/highlight'
import {
  columnWidths,
  followHeight,
  inertCopy,
  runningTransitions,
  spanWidths,
  startRun,
  transitionsSettled,
  withoutTransition,
} from '@/registry/lib/resize'
import { useEffect, useRef } from 'react'

/**
 * Where an item sits, in px from the start edge and top of the row's offset
 * parent, without any `translate`: a row that moves, such as an avatar
 * stack whose neighbours make room for a face that joins, carries its items
 * with it, and they glide from where they were seen.
 */
export interface Spot {
  x: number
  y: number
}

/** A spot, with what a copy of the item needs once it is gone: its size, and its place in the row and the row's in its parent. */
interface Placed extends Spot {
  left: number
  top: number
  width: number
  height: number
  rowLeft: number
  rowTop: number
}

/** An element, HTML or SVG, whose inline style can be set. */
type Styled = HTMLElement | SVGElement

/** A property put on an element's inline style, to take off once it may move again. */
export type Taken = readonly [Styled, string]

/**
 * A transition an item, or something inside it, was running, to pick up on
 * its copy from where it had got to.
 */
interface Running {
  /** Where it ran: the child indexes from the item down, empty for the item itself. */
  path: number[]
  transition: CSSTransition
  keyframes: Keyframe[]
  timing: EffectTiming
  /** Its time, in ms, when it was read. */
  at: number
  /** When it was read, on `performance.now()`. */
  read: number
}

/**
 * The `translate` that shows an item where it was seen a moment ago, now
 * that it sits at `now`: its old spot plus the `translate` it was moving
 * off, so a glide cut short goes on from where it is. Null when it hasn't
 * moved by half a pixel.
 */
export function flowStart(
  was: Spot,
  moving: readonly [number, number],
  now: Spot,
): readonly [number, number] | null {
  const x = was.x + moving[0] - now.x
  const y = was.y + moving[1] - now.y
  return Math.abs(x) < 0.5 && Math.abs(y) < 0.5 ? null : [x, y]
}

/**
 * Whether an item that was resized moves the others to new places they
 * glide to. Items that wrap move whenever one changes size, items stacked
 * one under another (a table's rows) only when one changes height. An item
 * that grows or shrinks on a height transition of its own (`sizing`), such
 * as an accordion's panel opening, carries what is below it as it goes, a
 * frame at a time: a glide would hold them back where they were.
 */
export function sizeMoves({
  stacked,
  heightChanged,
  sizing,
}: {
  stacked: boolean
  heightChanged: boolean
  sizing: boolean
}): boolean {
  return !sizing && (!stacked || heightChanged)
}

/**
 * Whether items that changed size glide to their new places, or are only
 * measured where they now are. They glide when they moved because of
 * something inside the row: an item that came, went or changed (`inside`).
 * When the row, or what holds it, changed width with nothing changed inside
 * (the window or a canvas resized), they wrap again where they are, with no
 * glide from where they were.
 */
export function resizeGlides({
  moved,
  narrowed,
  inside,
}: {
  /** An item changed size in a way that moves the others. */
  moved: boolean
  /** The row or what holds it changed width. */
  narrowed: boolean
  /** Something inside the row changed since the last look. */
  inside: boolean
}): boolean {
  return moved && (inside || !narrowed)
}

/**
 * Whether what holds the row takes its new height at once rather than
 * animating to it: the row changed width from outside (the window or a canvas
 * resized), so its items rewrap in place and there is no change to show.
 */
export function resizeJumps(change: Parameters<typeof resizeGlides>[0]): boolean {
  return change.narrowed && !resizeGlides(change)
}

/**
 * Its layout size with the border, before any transform: unrounded where the
 * styles give it, since a copy a fraction of a pixel narrower than its item
 * cuts its label short (`offsetWidth` rounds).
 */
function borderBoxOf(item: HTMLElement, style: CSSStyleDeclaration): [number, number] {
  const width = parseFloat(style.width)
  const height = parseFloat(style.height)
  return style.boxSizing === 'border-box' && width >= 0 && height >= 0
    ? [width, height]
    : [item.offsetWidth, item.offsetHeight]
}

/**
 * The item's spot, from its centre and its layout size, so a scale on its
 * way in or out doesn't move it. `x` runs from the start edge, so an item
 * whose end moves (an input that fills the rest of a line) keeps its place
 * in right to left as it does in left to right.
 */
function spotOf(item: HTMLElement, row: HTMLElement, box: DOMRect, rtl: boolean): Placed {
  const itemBox = item.getBoundingClientRect()
  const style = getComputedStyle(item)
  const [width, height] = borderBoxOf(item, style)
  const [x, y] = translateOf(style.translate)
  const left = (itemBox.left + itemBox.right) / 2 - x - box.left - width / 2
  const top = (itemBox.top + itemBox.bottom) / 2 - y - box.top - height / 2
  const parentWidth = row.offsetParent?.clientWidth ?? box.width
  const start = rtl ? parentWidth - row.offsetLeft - row.offsetWidth : row.offsetLeft
  return {
    x: start + (rtl ? row.offsetWidth - left - width : left),
    y: row.offsetTop + top,
    left,
    top,
    width,
    height,
    rowLeft: row.offsetLeft,
    rowTop: row.offsetTop,
  }
}

/** The child indexes from `root` down to `node`, which sits inside it. */
function pathTo(root: Element, node: Element): number[] {
  const path: number[] = []
  for (let at = node; at !== root && at.parentElement; at = at.parentElement)
    path.unshift([...at.parentElement.children].indexOf(at))
  return path
}

/** The element at `path` inside `root`, if it has one. */
function atPath(root: Element, path: readonly number[]): Element | undefined {
  let at: Element | undefined = root
  for (const index of path) at = at?.children[index]
  return at
}

/** The CSS transitions `item` and everything in it are running, as they stand now. */
function runningOn(item: HTMLElement): Running[] {
  const read = performance.now()
  return runningTransitions(item, { subtree: true }).flatMap((transition) => {
    const effect = transition.effect as KeyframeEffect | null
    // One on a pseudo-element can't be put on an inline style.
    if (!effect?.target || effect.pseudoElement) return []
    return [
      {
        path: pathTo(item, effect.target),
        transition,
        keyframes: effect.getKeyframes(),
        timing: effect.getTiming(),
        at: Number(transition.currentTime ?? 0),
        read,
      },
    ]
  })
}

/**
 * Puts on `ghost`, and on each part of it, the values the item's transitions
 * had reached: a chip removed while it glides or scales in leaves from where
 * it was seen, and a timeline's event removed while its line draws leaves
 * with the line as far as it got.
 */
function takeOver(ghost: HTMLElement, running: readonly Running[]): Taken[] {
  const now = performance.now()
  const values: [Styled, string, string][] = []
  for (const { path, transition, keyframes, timing, at, read } of running) {
    const target = atPath(ghost, path)
    if (!(target instanceof HTMLElement || target instanceof SVGElement)) continue
    const replay = target.animate(keyframes, { ...timing, fill: 'both' })
    replay.pause()
    // Its own time while it still has one; else worked out at its rate,
    // which the page may have slowed since it was read.
    replay.currentTime =
      transition.currentTime === null
        ? at + (now - read) * transition.playbackRate
        : Number(transition.currentTime)
    // The transition's own name for it: keyframes name it in camelCase,
    // which `getPropertyValue` doesn't read.
    const property = transition.transitionProperty
    values.push([target, property, getComputedStyle(target).getPropertyValue(property)])
    replay.cancel()
  }
  for (const [target, property, value] of values)
    target.style.setProperty(property, value)
  return values.map(([target, property]) => [target, property] as const)
}

/**
 * Reads where `item`'s transitions have got to, before it goes, and gives
 * the `from` for its `leaveAsCopy`: the copy leaves from there, not from
 * where `item` rests (a chip removed while it still scales in).
 */
export function fromWhereItIs(item: HTMLElement) {
  const running = runningOn(item)
  return (copy: HTMLElement) => takeOver(copy, running)
}

/**
 * Takes `item` back from the copy of it that is leaving, such as a chip
 * brought back by an undo while it still fades: the copy goes, and `item`
 * turns back to where it rests from where the copy had got to, with no jump.
 */
export function returnFromCopy(item: HTMLElement, copy: HTMLElement) {
  const running = runningOn(copy)
  copy.remove()
  let taken: readonly Taken[] = []
  withoutTransition(
    item,
    () => {
      taken = takeOver(item, running)
    },
    { subtree: true },
  )
  for (const [part, property] of taken) part.style.removeProperty(property)
}

/** One item to leave as a copy: see `leaveAsCopy`. */
interface Leaving {
  item: HTMLElement
  parent: HTMLElement
  next?: Node | null
  style: Partial<CSSStyleDeclaration>
  from: (copy: HTMLElement) => readonly Taken[]
}

/**
 * Leaves a copy of `item` in `parent`, before `next`: Base UI unmounts what
 * goes the moment it goes, so the copy plays its leaving styles in its
 * place. The copy can't be reached or read, and takes `style` (where it
 * was seen). `from` puts on the copy, once it is in, the values it and
 * its parts start from and returns what it set; the copy holds them for one
 * style with no transition, then is marked `data-leaving` and transitions
 * from there, and goes once those transitions have played.
 */
export function leaveAsCopy(item: HTMLElement, options: Omit<Leaving, 'item'>) {
  return leaveAsCopies([{ item, ...options }])[0]!
}

/**
 * Leaves a copy of each item at once, as `leaveAsCopy` does one: every copy
 * goes in and is styled in one pass, so many rows leaving together, such as
 * a long list cut back to a few, cost one style rather than one each.
 */
export function leaveAsCopies(leaving: readonly Leaving[]): HTMLElement[] {
  const copies = leaving.map(({ item, style }) => inertCopy(item, style))
  // An entrance's starting style, on the copy or on anything in it (a
  // timeline's marker scaling in, its line drawing), would play it again
  // first: nothing in the copy transitions until it has been styled once.
  const taken: Taken[] = []
  withoutTransition(
    copies,
    () => {
      leaving.forEach(({ parent, next = null }, at) =>
        parent.insertBefore(copies[at]!, next),
      )
      leaving.forEach(({ from }, at) => taken.push(...from(copies[at]!)))
    },
    { subtree: true },
  )
  for (const [part, property] of taken) part.style.removeProperty(property)
  for (const copy of copies) {
    // Marked only now, with its transition back, so its leaving styles
    // transition from where it was seen rather than apply at once.
    copy.dataset.leaving = ''
    void transitionsSettled(copy).then(() => copy.remove())
  }
  return copies
}

/**
 * What a copy of an item needs to fade where it was, back in `row` before
 * `next`, then go. Everything it reads from the row is read now, before any
 * copy goes in, so copies made together lay the row out once.
 */
function leaving(
  item: HTMLElement,
  spot: Placed,
  running: readonly Running[],
  row: HTMLElement,
  next: Node | null,
): Leaving {
  const table = row.closest('table')
  // A row taken out of the table's layout has no columns: its cells take
  // the widths the columns have now.
  const columns =
    table && item instanceof HTMLTableRowElement ? columnWidths(table) : null
  return {
    item,
    parent: row,
    next,
    style: {
      // Where it was seen, though the row may have moved since.
      left: `${spot.left + spot.rowLeft - row.offsetLeft}px`,
      top: `${spot.top + spot.rowTop - row.offsetTop}px`,
      // Measured while it was there: a removed node has no size.
      boxSizing: 'border-box',
      width: `${spot.width}px`,
      height: `${spot.height}px`,
    },
    from: (copy) => {
      if (columns && copy instanceof HTMLTableRowElement) {
        const cells = [...copy.cells]
        const widths = spanWidths(
          columns,
          cells.map((cell) => cell.colSpan),
        )
        // Laid out as a table of its own, so its cells keep their vertical
        // alignment; the spacing between the table's rows is not inside it.
        Object.assign(copy.style, {
          display: 'table',
          tableLayout: 'fixed',
          borderSpacing: '0',
        })
        cells.forEach((cell, index) => {
          Object.assign(cell.style, {
            boxSizing: 'border-box',
            width: `${widths[index]}px`,
          })
        })
      }
      return takeOver(copy, running)
    },
  }
}

/**
 * Follows `row`'s direct children that match `items`: each one that moves,
 * because another came or went or because it changed size, glides there
 * from where it was seen, and each one removed leaves as a copy where it
 * was. `row` must be positioned and isolated (`relative isolate`). An item is marked `data-flowing` while it glides. Returns a
 * function that stops following.
 */
export function followFlow(
  row: HTMLElement,
  items: string,
  {
    resized,
    holding,
    key,
  }: {
    /**
     * The attribute that says which thing an item is, such as
     * `data-notification-id`. An item put back while the copy of the same
     * thing still leaves (an undo right after an archive) turns back from
     * where the copy had got to, rather than playing its entrance over it.
     */
    key?: string
    /** Called after each change of size, with whether the row's new height should be taken at once (see `resizeJumps`). */
    resized?: (jumps: boolean) => void
    /**
     * Called before the items that moved are measured where they now are,
     * and may return what to run once they have been: a frame that follows
     * the row's height holds its old one meanwhile (`useFlow`), so a box
     * that centres it doesn't move the row while it is measured.
     */
    holding?: () => (() => void) | undefined
  } = {},
): () => void {
  const matching = () =>
    row.querySelectorAll<HTMLElement>(`:scope > :is(${items}):not([data-leaving])`)
  const rtl = () => getComputedStyle(row).direction === 'rtl'
  let seen = new Map<Element, { spot: Placed; running: Running[] }>()
  const measure = () => {
    const box = row.getBoundingClientRect()
    const right = rtl()
    seen = new Map()
    for (const item of matching()) {
      seen.set(item, {
        spot: spotOf(item, row, box, right),
        running: runningOn(item),
      })
    }
  }

  /** Every item that moved glides there from where it was seen. Reads first, then writes, so the row is laid out once. */
  const glide = () => {
    const held = holding?.()
    const box = row.getBoundingClientRect()
    const right = rtl()
    const starts: [HTMLElement, readonly [number, number]][] = []
    for (const item of matching()) {
      const was = seen.get(item)
      if (!was || item.hasAttribute('data-flow-held')) continue
      const [x, y] = translateOf(getComputedStyle(item).translate)
      const start = flowStart(
        was.spot,
        [right ? -x : x, y],
        spotOf(item, row, box, right),
      )
      if (start) starts.push([item, right ? [-start[0], start[1]] : start])
    }
    for (const [item, [x, y]] of starts) {
      item.dataset.flow = 'start'
      item.style.translate = `${x}px ${y}px`
    }
    if (starts.length > 0) void row.offsetHeight
    for (const [item] of starts) {
      delete item.dataset.flow
      item.style.translate = ''
      item.dataset.flowing = ''
      const latest = startRun(item)
      void transitionsSettled(item, { property: 'translate' }).then(() => {
        if (latest()) delete item.dataset.flowing
      })
    }
    measure()
    held?.()
  }

  // An item that changes size glides to where that puts it. The row, its
  // parent, what sits beside it and its offset parent can move the row when
  // they are resized (the window, a longer label beside it): that moves
  // things with no glide, and they are measured again where they now are.
  // Items stacked one under another (a table's rows) move only when one
  // changes height, so a change of width, such as columns that glide, needs
  // no glide.
  const around = new Set<Element>(
    [
      row,
      row.offsetParent,
      row.parentElement,
      ...(row.parentElement?.children ?? []),
    ].filter((element): element is Element => element !== null),
  )
  const stacked =
    row instanceof HTMLTableElement || row instanceof HTMLTableSectionElement
  const heights = new WeakMap<Element, number>()
  const widths = new WeakMap<Element, number>()
  const resizes = new ResizeObserver((entries) => {
    let moves = false
    let narrowed = false
    for (const entry of entries) {
      if (around.has(entry.target)) {
        const width = entry.borderBoxSize[0]?.inlineSize ?? 0
        const was = widths.get(entry.target)
        if (was !== undefined && Math.abs(was - width) >= 0.5) narrowed = true
        widths.set(entry.target, width)
        continue
      }
      const height = entry.borderBoxSize[0]?.blockSize ?? 0
      if (
        sizeMoves({
          stacked,
          heightChanged: heights.get(entry.target) !== height,
          sizing:
            runningTransitions(entry.target, { property: 'height', subtree: true })
              .length > 0,
        })
      )
        moves = true
      heights.set(entry.target, height)
    }
    const inside = changedInside
    changedInside = false
    const change = { moved: moves, narrowed, inside }
    if (resizeGlides(change)) glide()
    else measure()
    resized?.(resizeJumps(change))
  })

  // What changes inside the row since the last look, but not the styles and
  // marks this code puts on its items as they glide.
  let changedInside = false
  let changeCount = 0
  const own = new Set(['style', 'data-flow', 'data-flowing', 'data-leaving'])
  const changes = new MutationObserver((records) => {
    if (
      records.some(
        (record) => record.type !== 'attributes' || !own.has(record.attributeName ?? ''),
      )
    ) {
      // Only for the frame it lands in: a resize it causes reaches the
      // observer in that frame, and a later one comes from outside.
      changedInside = true
      const change = ++changeCount
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          if (change === changeCount) changedInside = false
        }),
      )
    }
  })

  const mutations = new MutationObserver((records) => {
    // Transitions that started this frame are read before an item leaves with them.
    if (readFrame) {
      cancelAnimationFrame(readFrame)
      readStarted()
    }
    const moved: Taken[] = []
    const gone: Leaving[] = []
    let box: DOMRect | undefined
    const inView = (spot: Placed) => {
      box ??= row.getBoundingClientRect()
      const top = box.top + spot.top + spot.rowTop - row.offsetTop
      const left = box.left + spot.left + spot.rowLeft - row.offsetLeft
      return (
        top < innerHeight &&
        top + spot.height > 0 &&
        left < innerWidth &&
        left + spot.width > 0
      )
    }
    for (const record of records) {
      for (const node of record.addedNodes) {
        const was = node instanceof HTMLElement ? seen.get(node) : undefined
        // One moved to another place (a list that reorders) is put back as it
        // was: put in again, it would play its entrance's starting style, and
        // taken out, it lost the glide it was on, so it takes up where that
        // had got to.
        // A held one keeps its other transitions, such as a lift, but its
        // `translate` is its holder's.
        if (node instanceof HTMLElement && was) {
          const running = node.hasAttribute('data-flow-held')
            ? was.running.filter(
                ({ transition }) => transition.transitionProperty !== 'translate',
              )
            : was.running
          // Its parts too: a part with an entrance of its own, such as a bar
          // that grows, would play its starting style again once the node
          // is back.
          withoutTransition(node, () => moved.push(...takeOver(node, running)), {
            subtree: true,
          })
        } else if (
          node instanceof HTMLElement &&
          key &&
          !node.hasAttribute('data-leaving')
        ) {
          // Not a copy this code just put in for one that left.
          const id = node.getAttribute(key)
          const copy =
            id === null
              ? null
              : row.querySelector<HTMLElement>(
                  `:scope > [data-leaving][${key}="${CSS.escape(id)}"]`,
                )
          if (copy) returnFromCopy(node, copy)
        }
      }
      for (const node of record.removedNodes) {
        const was = seen.get(node as Element)
        // One moved to another place in the row (a list that reorders) is still there.
        if (!(node instanceof HTMLElement) || !was || node.parentNode === row) continue
        resizes.unobserve(node)
        // A copy no one could see isn't made: many rows going at once, such
        // as a long list cut back to a few, would each be styled and laid
        // out for nothing.
        if (!inView(was.spot)) continue
        const next = record.nextSibling?.parentNode === row ? record.nextSibling : null
        gone.push(leaving(node, was.spot, was.running, row, next))
      }
    }
    if (gone.length > 0) leaveAsCopies(gone)
    glide()
    // Handed back to their transitions, from where they were.
    for (const [part, property] of moved) part.style.removeProperty(property)
    for (const item of matching()) resizes.observe(item)
  })

  // A transition that starts inside an item after it was measured (a
  // marker's colours when its status changes) is read as it starts, so a
  // copy of the item takes it up from where it got to. Each item is read
  // once in the frame its transitions start, however many start: a row of
  // cells that all change at once would read the row once for each.
  const startedIn = new Set<HTMLElement>()
  let readFrame = 0
  const readStarted = () => {
    readFrame = 0
    for (const item of startedIn) {
      const was = seen.get(item)
      if (was && item.parentElement === row) was.running = runningOn(item)
    }
    startedIn.clear()
  }
  const started = (event: Event) => {
    let item = event.target instanceof Element ? event.target : null
    while (item && item.parentElement !== row) item = item.parentElement
    if (!(item instanceof HTMLElement) || !seen.has(item)) return
    startedIn.add(item)
    // Animation frame callbacks run after the frame's transition events, in the same frame.
    readFrame ||= requestAnimationFrame(readStarted)
  }
  row.addEventListener('transitionrun', started)
  for (const element of around) resizes.observe(element)
  for (const item of matching()) resizes.observe(item)
  measure()
  mutations.observe(row, { childList: true })
  changes.observe(row, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
  })
  return () => {
    mutations.disconnect()
    changes.disconnect()
    row.removeEventListener('transitionrun', started)
    cancelAnimationFrame(readFrame)
    resizes.disconnect()
  }
}

/**
 * An item of a list that flows, such as a directory's card or a changelog's
 * release: it glides to its place when the list changes, fades in when it
 * arrives after the list's first paint, and its copy fades out where it was
 * when it leaves. The list is `group/flow`, marked `data-mounted`
 * (`markMounted`).
 */
export const flowItemClassName =
  '[transition:translate_var(--motion-layout-duration)_var(--motion-layout-easing),opacity_var(--motion-enter-duration)_var(--motion-enter-easing)] group-data-mounted/flow:starting:opacity-0 data-[flow=start]:[transition:opacity_var(--motion-enter-duration)_var(--motion-enter-easing)] motion-reduce:[transition:opacity_var(--motion-enter-duration)_var(--motion-enter-easing)] data-leaving:opacity-0 data-leaving:[transition:opacity_var(--motion-exit-duration)_var(--motion-exit-easing),translate_var(--motion-layout-duration)_var(--motion-layout-easing)] motion-reduce:data-leaving:[transition:opacity_var(--motion-exit-duration)_var(--motion-exit-easing)]'

/**
 * A row whose `items` flow, in a frame that moves to the row's height as it
 * wraps: give `frame` and `row` to the two elements, the row inside the
 * frame. The frame needs a height transition and `overflow: clip`.
 */
export function useFlow<Frame extends HTMLElement, Row extends HTMLElement>(
  items: string,
  /** The attribute that says which thing an item is: see `followFlow`. */
  key?: string,
) {
  const frame = useRef<Frame>(null)
  const row = useRef<Row>(null)
  useEffect(() => {
    if (!frame.current || !row.current) return
    // Items that rewrap where they are, the row narrowed from outside, take
    // the frame's new height at once too. The flow is followed first, so it
    // has looked at each change before the frame does.
    let jumps = false
    const frameNode = frame.current
    const rowNode = row.current
    // The frame's height and the row's, as last laid out with nothing held.
    let rest = { frame: frameNode.offsetHeight, row: rowNode.offsetHeight }
    const remember = () => {
      if (!frameNode.style.height)
        rest = { frame: frameNode.offsetHeight, row: rowNode.offsetHeight }
    }
    const sizes = new ResizeObserver(remember)
    sizes.observe(frameNode)
    const stopFlow = followFlow(rowNode, items, {
      key,
      resized: (next) => {
        jumps = next
      },
      // The frame keeps its old height while the items are measured, as it
      // will on the first frame of its move to the new one: in a box that
      // centres the frame, its new height would move the row, and every item
      // would start from a place that much off. A frame already moving
      // keeps its own height. Let go at once if the row's height didn't
      // change, since the frame then has no move to make.
      holding: () => {
        if (frameNode.style.height) return undefined
        const held = `${rest.frame}px`
        frameNode.style.height = held
        return () => {
          if (rowNode.offsetHeight === rest.row) {
            frameNode.style.height = ''
            return
          }
          // The frame's own move takes the height from here, once the
          // resize is seen, after this frame's callbacks. One that never
          // starts, the height being the same after all, leaves it held, so
          // it is let go the frame after.
          requestAnimationFrame(() =>
            requestAnimationFrame(() => {
              if (
                frameNode.style.height === held &&
                runningTransitions(frameNode, { property: 'height' }).length === 0
              ) {
                frameNode.style.height = ''
                remember()
              }
            }),
          )
        }
      },
    })
    const stopHeight = followHeight(frame.current, row.current, {
      instant: () => jumps,
      // Its new height, once layout has it back: a frame already that tall
      // doesn't change size then, so the observer wouldn't see it.
      settled: remember,
    })
    return () => {
      stopHeight()
      stopFlow()
      sizes.disconnect()
    }
  }, [items, key])
  return { frame, row }
}
