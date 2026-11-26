/**
 * Moving an element from one size to another on its own CSS transition, then
 * handing the size back to layout: the Accordion's panel, the Dialog's and
 * Sheet's box, and the Swap's width. Kept outside components: the React
 * Compiler drops a forced reflow written inside one, and then the size jumps.
 */

const runs = new WeakMap<object, number>()

/**
 * Starts a new run on `key`, and returns whether it is still the latest: a
 * change that comes mid-way starts another, and the older one must then leave
 * the size alone.
 */
export function startRun(key: object): () => boolean {
  const run = (runs.get(key) ?? 0) + 1
  runs.set(key, run)
  return () => runs.get(key) === run
}

const sizeRuns = new WeakMap<object, Partial<Record<Size, object>>>()

/**
 * Starts a new run of `element`'s `size`, and returns whether it is still the
 * latest. A newer run of the same size ends it, and so does `startRun(element)`,
 * which ends every size's run at once; a run of the other size doesn't, so a
 * box's width and height move together, as in a Swap that holds a block.
 */
export function startSizeRun(element: object, size: Size): () => boolean {
  const keys = sizeRuns.get(element) ?? {}
  sizeRuns.set(element, keys)
  keys[size] ??= {}
  const ownLatest = startRun(keys[size])
  const elementRun = runs.get(element) ?? 0
  return () => ownLatest() && (runs.get(element) ?? 0) === elementRun
}

/**
 * The id of a Web Animation a component plays in step with one of its CSS
 * transitions, so a tool that retimes CSS, such as the playground's Speed,
 * retimes it too.
 */
export const FOLLOWS_TRANSITION = 'follows-transition'

/** A CSS time, such as a `--motion-press-duration` of `0.3s` or `300ms`, in ms; `fallback` when it is empty or not a time. */
export function cssTime(value: string, fallback: number) {
  const number = Number.parseFloat(value)
  if (!Number.isFinite(number)) return fallback
  return value.trim().endsWith('ms') ? number : number * 1000
}

/** A motion role's duration where `element` is, in ms, as the feel sets it; `fallback` outside a Kino theme. */
export function roleDuration(
  element: Element,
  role: 'press' | 'enter' | 'exit' | 'layout' | 'morph' | 'draw',
  fallback = 0,
) {
  return cssTime(
    getComputedStyle(element).getPropertyValue(`--motion-${role}-duration`),
    fallback,
  )
}

/** A computed CSS list split at its top-level commas: `linear(0, 1), ease` is two items. */
function cssList(value: string): string[] {
  const items: string[] = []
  let depth = 0
  let start = 0
  for (let index = 0; index < value.length; index++) {
    const character = value[index]
    if (character === '(') depth++
    else if (character === ')') depth--
    else if (character === ',' && depth === 0) {
      items.push(value.slice(start, index).trim())
      start = index + 1
    }
  }
  items.push(value.slice(start).trim())
  return items
}

/**
 * How `property` moves in an element's computed transition: its duration in
 * ms and its easing, or null when it doesn't move, because it isn't listed or
 * has no duration (reduced motion, an instant open). A Web Animation played
 * on it with this timing follows the feel, as the transition would.
 */
export function transitionTiming(
  style: Pick<
    CSSStyleDeclaration,
    'transitionProperty' | 'transitionDuration' | 'transitionTimingFunction'
  >,
  property: string,
): { duration: number; easing: string } | null {
  const index = cssList(style.transitionProperty).findLastIndex(
    (name) => name === property || name === 'all',
  )
  if (index < 0) return null
  const at = (list: string[]) => list[index % list.length] ?? ''
  const duration = cssTime(at(cssList(style.transitionDuration)), 0)
  if (!(duration > 0)) return null
  return { duration, easing: at(cssList(style.transitionTimingFunction)) }
}

/** The CSS transitions running on `element`, or inside it too with `subtree`, of one property, of several, or of any. */
export function runningTransitions(
  element: Element,
  {
    property,
    subtree = false,
  }: { property?: string | readonly string[]; subtree?: boolean } = {},
): CSSTransition[] {
  const properties = typeof property === 'string' ? [property] : property
  return element
    .getAnimations({ subtree })
    .filter(
      (animation): animation is CSSTransition =>
        animation instanceof CSSTransition &&
        (properties === undefined || properties.includes(animation.transitionProperty)),
    )
}

/**
 * Resolves once the transitions running a frame from now (so the ones just
 * started exist) have ended or been turned round. Animations that aren't
 * transitions, such as a spinner's turn, don't count.
 */
export function transitionsSettled(
  element: Element,
  options?: { property?: string | readonly string[]; subtree?: boolean },
): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      void Promise.allSettled(
        runningTransitions(element, options).map((animation) => animation.finished),
      ).then(() => resolve())
    })
  })
}

/**
 * Resolves once no transition is left running, where `transitionsSettled`
 * resolves when the ones running now end or are turned round. A change that
 * comes mid-way turns them round into new ones, and this waits for those
 * too, so what leaves is let go only once it has finished leaving.
 */
export async function transitionsQuiet(
  element: Element,
  options?: { property?: string | readonly string[]; subtree?: boolean },
): Promise<void> {
  await transitionsSettled(element, options)
  while (runningTransitions(element, options).length > 0) {
    // oxlint-disable-next-line no-await-in-loop -- each wait is for the transitions that replaced the last
    await transitionsSettled(element, options)
  }
}

type Size = 'height' | 'width'

/** The size `element` is at now if it is moving, or `rest` if it isn't: a change mid-way goes on from where it is. */
export function sizeNow(element: HTMLElement, size: Size, rest: number): number {
  return runningTransitions(element, { property: size }).length > 0
    ? Number.parseFloat(getComputedStyle(element)[size])
    : rest
}

/**
 * Moves `element`'s height or width from `from` to `to` pixels on its own
 * transition. `write` sets the size (its style property unless given), and
 * `alongside` moves something with it: it is called with `true` while the
 * start is set with no transition, then `false` once things may move. It
 * resolves when the move has settled, with whether this run is still the
 * latest, so the caller can hand the size back to layout.
 */
export function animateSize(
  element: HTMLElement,
  size: Size,
  from: number,
  to: number,
  {
    write = (value) => {
      element.style[size] = value
    },
    alongside,
  }: {
    write?: (value: string) => void
    alongside?: (start: boolean) => void
  } = {},
): Promise<boolean> {
  const latest = startSizeRun(element, size)
  withoutTransition(
    element,
    () => {
      write(`${from}px`)
      alongside?.(true)
    },
    { properties: [size] },
  )
  write(`${to}px`)
  alongside?.(false)
  return transitionsSettled(element, { property: size }).then(latest)
}

/**
 * Makes `change` land at once: `element`'s transitions (or each one's, for
 * several) are off while it
 * runs, its style is read so the change is styled with none, and then its
 * inline `transition-property` is put back; its durations, delays and easings
 * are never touched. With `properties`, only those stop and the rest keep
 * running, such as a fade the change happens during, unless it transitions
 * `all`, which can't be split and stops whole. With
 * `subtree`, every element inside it stops too. Kept outside components: the
 * React Compiler drops the forced read written inside one, and then the
 * change animates.
 */
export function withoutTransition(
  element: HTMLElement | SVGElement | readonly (HTMLElement | SVGElement)[],
  change: () => void,
  {
    properties,
    subtree = false,
  }: { properties?: readonly string[]; subtree?: boolean } = {},
) {
  const elements = isList(element) ? element : [element]
  const parts = elements.flatMap((one) =>
    subtree ? [one, ...one.querySelectorAll<HTMLElement | SVGElement>('*')] : [one],
  )
  const held = parts.map((part) => {
    const before = part.style.transitionProperty
    if (!properties) {
      part.style.transitionProperty = 'none'
    } else {
      const list = getComputedStyle(part)
        .transitionProperty.split(',')
        .map((name) => name.trim())
      part.style.transitionProperty = list.includes('all')
        ? 'none'
        : transitionsWithout(list, properties).join(', ')
    }
    return () => {
      part.style.transitionProperty = before
    }
  })
  change()
  // Reading one style styles the whole document, so every part, inside
  // too, takes the change, and drops a starting style, with none.
  for (const one of elements) void getComputedStyle(one).transitionProperty
  for (const release of held) release()
}

function isList<T>(value: T | readonly T[]): value is readonly T[] {
  return Array.isArray(value)
}

/**
 * A transition list with each of `properties` replaced by a name nothing
 * animates. Each one keeps its place, so every other property keeps its own
 * duration.
 */
export function transitionsWithout(
  list: readonly string[],
  properties: readonly string[],
): string[] {
  return list.map((name) => (properties.includes(name) ? '--held' : name))
}

/**
 * Moves `surface` to `inner`'s height, or width, whenever that changes, on
 * the surface's own transition, then hands the size back to layout: a dialog
 * whose content grows, a list that filters, a number that gains a digit. A
 * change mid-way goes on from where it is. `moving` is called as each move
 * starts, with the sizes it moves between, and may return an `alongside` for
 * it (see `animateSize`); `settled` runs once a move has ended and no newer
 * one has started. Returns a function that stops following.
 */
export function followSize(
  surface: HTMLElement,
  inner: HTMLElement,
  size: Size,
  {
    moving,
    settled,
    instant,
  }: {
    moving?: (from: number, to: number) => ((start: boolean) => void) | undefined
    settled?: () => void
    /** Whether this change takes the new size at once, with no move. */
    instant?: () => boolean
  } = {},
): () => void {
  // A width to the fraction of a pixel, as text has, so nothing jumps when layout takes it back.
  const measure = () =>
    size === 'height' ? inner.offsetHeight : inner.getBoundingClientRect().width
  const sides =
    size === 'height'
      ? (['borderTopWidth', 'borderBottomWidth', 'paddingTop', 'paddingBottom'] as const)
      : (['borderLeftWidth', 'borderRightWidth', 'paddingLeft', 'paddingRight'] as const)
  // The surface's size for an inner one: with its own border and padding,
  // and no larger than its maximum, past which it doesn't move.
  const outer = (inside: number) => {
    const style = getComputedStyle(surface)
    const chrome =
      style.boxSizing === 'border-box'
        ? sides
            .map((side) => Number.parseFloat(style[side]) || 0)
            .reduce((sum, value) => sum + value, 0)
        : 0
    const limit = size === 'height' ? style.maxHeight : style.maxWidth
    const max = limit.endsWith('px') ? Number.parseFloat(limit) : Infinity
    return Math.min(inside + chrome, max)
  }
  let last = measure()
  const observer = new ResizeObserver(() => {
    const inside = measure()
    if (inside === last) return
    if (instant?.()) {
      last = inside
      // A move under way is dropped, and layout has the size.
      startRun(surface)
      surface.style[size] = ''
      settled?.()
      return
    }
    const running = runningTransitions(surface, { property: size }).length > 0
    const from = sizeNow(surface, size, outer(last))
    const to = outer(inside)
    last = inside
    if (!running && Math.abs(to - from) < 0.5) return
    void animateSize(surface, size, from, to, {
      alongside: moving?.(from, to),
    }).then((latest) => {
      if (!latest) return
      surface.style[size] = ''
      settled?.()
    })
  })
  observer.observe(inner)
  return () => observer.disconnect()
}

/** `followSize` on the height. */
export function followHeight(
  surface: HTMLElement,
  inner: HTMLElement,
  options?: Parameters<typeof followSize>[3],
): () => void {
  return followSize(surface, inner, 'height', options)
}

/**
 * A copy of `element` no one can reach or read: no ids, hidden from screen
 * readers, inert, out of the flow and taking no pointer, with `style` on
 * top. For a copy that leaves in an item's place (`leaveAsCopies` in the
 * flow lib), or one that shows where a layout will land before it does.
 */
export function inertCopy(
  element: HTMLElement,
  style?: Partial<CSSStyleDeclaration>,
): HTMLElement {
  const copy = element.cloneNode(true) as HTMLElement
  for (const node of [copy, ...copy.querySelectorAll('[id]')]) node.removeAttribute('id')
  copy.setAttribute('aria-hidden', 'true')
  copy.inert = true
  Object.assign(
    copy.style,
    { position: 'absolute', margin: '0', pointerEvents: 'none' },
    style,
  )
  return copy
}

/**
 * A ref that marks `element` `data-resizing` for two frames each time it changes
 * size, so what it places in `cqw` or `cqh`, which turn into pixels, moves at
 * once instead of gliding to the new size: a Slider's thumbs, a colour area's.
 */
export function markResizing(element: HTMLElement | null) {
  if (!element) return
  let frame = 0
  const observer = new ResizeObserver(() => {
    element.dataset.resizing = ''
    cancelAnimationFrame(frame)
    // Two frames: what places from a size measured by its own observer (ui-sdk's tab indicator) catches up a frame late.
    frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => delete element.dataset.resizing)
    })
  })
  observer.observe(element)
  return () => {
    observer.disconnect()
    cancelAnimationFrame(frame)
  }
}

/**
 * A panel that opens and closes on its height, on `layout`, its content
 * fading out on `exit` and in as it opens: the Accordion's and a
 * collapsible's. Set `--collapse-height` to the height Base UI gives it
 * (`--accordion-panel-height`, `--collapsible-panel-height`), and clip it.
 */
export const collapseClassName =
  'h-(--collapse-height) transition-[height] duration-(--motion-layout-duration) ease-(--motion-layout-easing) *:transition-opacity *:duration-(--motion-enter-duration) *:ease-(--motion-enter-easing) data-ending-style:h-0 data-ending-style:*:opacity-0 data-ending-style:*:duration-(--motion-exit-duration) data-ending-style:*:ease-(--motion-exit-easing) data-starting-style:h-0 data-starting-style:*:opacity-0 motion-reduce:transition-none'

/** Whether two lists of widths differ anywhere by half a pixel or more, or in length. */
export function widthsChanged(from: readonly number[], to: readonly number[]): boolean {
  return (
    from.length !== to.length ||
    from.some((width, index) => Math.abs(width - to[index]) >= 0.5)
  )
}

/** A table's columns, as the cells of its first row, in the header if it has one. */
export function columnCells(table: HTMLTableElement) {
  return [...((table.tHead?.rows[0] ?? table.rows[0])?.cells ?? [])]
}

/** The width of each of a table's columns now, in px. */
export function columnWidths(table: HTMLTableElement) {
  return columnCells(table).map((cell) => cell.getBoundingClientRect().width)
}

/**
 * The width of each cell in a row whose cells span `spans` columns, from
 * the columns' `widths`: each cell is as wide as the columns it spans.
 */
export function spanWidths(widths: readonly number[], spans: readonly number[]) {
  let column = 0
  return spans.map((span) => {
    const width = widths.slice(column, column + span).reduce((sum, next) => sum + next, 0)
    column += span
    return width
  })
}

/**
 * Moves a table's columns to their new widths on the header cells' own width
 * transition whenever rows come or go, then hands the widths back to layout:
 * the column whose widest value just left narrows, and the ones beside it
 * widen, in place of jumping. While they move the table is laid out fixed,
 * so a column can be narrower than what just came into it, and marked
 * `data-columns-moving`, for its cells to clip what they hold until it fits. The
 * columns are its first row's cells, in the header if it has one. Returns a
 * function that stops following.
 */
export function followColumns(table: HTMLTableElement): () => void {
  const widths = (row: HTMLTableCellElement[]) =>
    row.map((cell) => cell.getBoundingClientRect().width)
  const sum = (list: number[]) => list.reduce((total, next) => total + next, 0)
  const hold = (width: number | null) => {
    table.style.tableLayout = width === null ? '' : 'fixed'
    table.style.width = width === null ? '' : `${width}px`
    table.toggleAttribute('data-columns-moving', width !== null)
  }
  // The widths last laid out: once rows have changed, layout already has the new ones.
  let last = widths(columnCells(table))
  const sizes = new ResizeObserver(() => {
    if (!table.hasAttribute('data-columns-moving')) last = widths(columnCells(table))
  })
  const watch = () => {
    sizes.disconnect()
    for (const cell of columnCells(table)) sizes.observe(cell)
  }
  const changes = new MutationObserver((records) => {
    // Rows in the table's own sections, not copies of them in a layer.
    const rows = records.some(
      (record) =>
        record.target === table || record.target instanceof HTMLTableSectionElement,
    )
    if (!rows) return
    const row = columnCells(table)
    if (row.length !== last.length) {
      last = widths(row)
      watch()
      return
    }
    const from = row.map((cell, index) => sizeNow(cell, 'width', last[index]))
    hold(null)
    for (const cell of row) cell.style.width = ''
    const to = widths(row)
    last = to
    if (!widthsChanged(from, to)) return
    const latest = startRun(table)
    // Its narrower width: a table wider than its box grows to its columns.
    hold(Math.min(sum(from), sum(to)))
    const moves = row.map((cell, index) =>
      animateSize(cell, 'width', from[index], to[index]),
    )
    void Promise.all(moves).then(() => {
      if (!latest()) return
      for (const cell of row) cell.style.width = ''
      hold(null)
    })
  })
  watch()
  changes.observe(table, { childList: true, subtree: true })
  return () => {
    changes.disconnect()
    sizes.disconnect()
  }
}

/**
 * Keeps an open collapsing panel on its content's height. Base UI sizes the
 * panel while it opens and closes, then leaves it at `auto`, so content that
 * grows or shrinks after that would jump: this moves the panel to the new
 * height on its own transition, then hands it back to `auto`. Content that is
 * itself moving, such as a nested panel opening, is followed frame by frame
 * instead. `variable` is the height Base UI writes
 * (`--accordion-panel-height`). A column that changes width re-flows the
 * text, and the panel follows that at once. Returns a function that stops
 * following.
 */
export function followPanelContent(
  panel: HTMLElement,
  content: HTMLElement,
  variable: string,
): () => void {
  const write = (value: string) => panel.style.setProperty(variable, value)
  // The size the panel last followed, so steps too small to act on add up.
  let last: { width: number; height: number } | null = null
  const observer = new ResizeObserver(([entry]) => {
    const [{ inlineSize: width, blockSize: height }] = entry.borderBoxSize
    const previous = last
    if (!previous || Math.abs(previous.width - width) >= 0.5) {
      last = { width, height }
      return
    }
    if (Math.abs(previous.height - height) < 0.5) return
    last = { width, height }
    const open =
      panel.hasAttribute('data-open') && !panel.hasAttribute('data-starting-style')
    if (!open) return
    if (runningTransitions(content, { property: 'height', subtree: true }).length > 0) {
      // A move of the panel's own that is still running stops where it is.
      startRun(panel)
      write('auto')
      return
    }
    // The panel's own padding (the Accordion's room for a focus ring) sits around the content.
    const style = getComputedStyle(panel)
    const padding = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom)
    const target = height + padding
    void animateSize(
      panel,
      'height',
      sizeNow(panel, 'height', previous.height + padding),
      target,
      {
        write,
      },
    ).then((latest) => {
      // Closed meanwhile: the height is Base UI's again.
      if (!latest || !panel.hasAttribute('data-open')) return
      if (panel.style.getPropertyValue(variable) === `${target}px`) write('auto')
    })
  })
  observer.observe(content)
  return () => observer.disconnect()
}
