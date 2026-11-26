import { numberFormatter } from '@/registry/lib/number-format'
import {
  announce,
  type ChangeDetails,
  createChange,
  createResize,
  definePrimitive,
  isRTL,
  live,
  type ResizeDraft,
} from '@ui-sdk/core'

/*
 * The edge of a table's column that resizes it, built on ui-sdk's
 * `createResize` with one box, the column, and its end edge as the handle:
 * a pointer drags it, the arrows move it a step (Shift for a large one),
 * Home and End take it to its bounds, and Enter or a double press puts the
 * width back. While a pointer drags, the column takes each width at once;
 * the table owns how a width that lands at once or eases looks. An agent
 * sets a width with `resizeTo`.
 */

/** Why a width changed: a drag, a key, a double press that put it back, or code and agents. */
type ColumnResizeReason = 'drag' | 'resize-key' | 'reset' | 'imperative'

interface ColumnResizeOptions {
  /** The column's width in px, once resized: null while it keeps the width it was laid out at. */
  width?: number | null
  /** A width was asked for, or null to put it back. */
  onWidthChange?: (
    width: number | null,
    details: ChangeDetails<ColumnResizeReason>,
  ) => void
  /** The column's name, as its announcements say it. */
  name?: string
  /** The narrowest it goes, in px. */
  min?: number
  /** The widest it goes, in px. */
  max?: number
  /** How far an arrow moves the edge, in px: 16 by default. */
  step?: number
  /** How far Shift with an arrow moves the edge, in px: 64 by default. */
  largeStep?: number
}

/** The one box this resizes. */
const COLUMN = 'column'

/** The column's head, which holds its width. */
const headOf = (el: HTMLElement | undefined) => el?.closest('th') ?? undefined

/** The width the head has now: the one it is going to, not one partway through an ease. */
function headWidth(head: HTMLElement) {
  const kept = Number.parseFloat(head.style.getPropertyValue('--column-width'))
  return Number.isNaN(kept) ? head.getBoundingClientRect().width : kept
}

/**
 * Lets the table's columns take a width at once, with no ease, while `run`
 * changes one and for the frame after, so the render that follows lands too.
 */
function atOnce(table: HTMLElement | null | undefined, run: () => void) {
  if (!table) return run()
  table.dataset.resizing = ''
  run()
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      if (!table.querySelector('[data-slot=column-resize][data-dragging]'))
        delete table.dataset.resizing
    }),
  )
}

/** What a screen reader hears once a column's width is put back. */
function columnResetMessage(name: string) {
  return `${name} is back to the width it was laid out at.`
}

/** What a screen reader hears once a column's width changes. */
function columnResizeMessage(name: string, width: number, locale?: string) {
  return `${name} is ${numberFormatter(locale).format(width)} px wide.`
}

const columnResize = definePrimitive({
  name: 'column-resize',
  options: {
    width: 'number',
    onWidthChange: 'callback',
    name: 'string',
    min: 'number',
    max: 'number',
    step: 'number',
    largeStep: 'number',
  },
  controlled: ['width'],
  state: (options: ColumnResizeOptions) => ({
    width: options.width ?? null,
    draft: null as ResizeDraft | null,
  }),
  sync: (options) => ({ width: options.width ?? null }),
  api: (context) => {
    const { options, store } = context
    const change = createChange(context)
    const handleEl = () => context.element('root')
    const bounds = () => {
      const { min = 64, max = 800 } = options()
      return { min, max: Math.max(min, max) }
    }
    const clamp = (width: number) =>
      Math.round(Math.min(Math.max(width, bounds().min), bounds().max))
    // The laid-out width a drag started from, while the drag writes the head's.
    let laidOut: number | null = null
    // The width it shows: its own once resized, else the one it was laid out at.
    const widthOf = (width: number | null) => {
      if (width !== null) return width
      if (laidOut !== null) return laidOut
      const head = headOf(handleEl())
      return head ? clamp(headWidth(head)) : bounds().min
    }
    // Whether the drag that just ended set a width.
    let dropped = false
    const commit = (
      width: number | null,
      details: { reason: ColumnResizeReason; event?: Event },
    ) => {
      const run = () => change('width', width, details)
      // Every resize lands at once, as the table's own width does.
      let done = false
      atOnce(headOf(handleEl())?.closest('table'), () => {
        done = run()
      })
      // A drop that went through keeps its width on the head until the render brings it.
      if (details.reason === 'drag') dropped = done
      return done
    }
    const resize = createResize(context, {
      boxes: (state) => ({
        [COLUMN]: { x: 0, y: 0, width: widthOf(state.width), height: 0 },
      }),
      draft: 'draft',
      set: (value, details) => commit(value[COLUMN].width, details),
      min: () => ({ width: bounds().min, height: 0 }),
      max: () => ({ width: bounds().max, height: 0 }),
      // A drop lands where it was let go; the arrows take their own steps below.
      label: () => options().name ?? 'Column',
      message: ({ box }) =>
        columnResizeMessage(
          options().name ?? 'Column',
          box.width,
          document.documentElement.lang || undefined,
        ),
    })
    // The end edge: on the right, or the left in right to left.
    const edge = (el: HTMLElement) => (isRTL(el) ? 'w' : 'e')
    /** Sets the column's width in px, within its bounds, or puts it back with null: an agent's resize. */
    const resizeTo = (width: number | null) => {
      if (width !== null && !Number.isFinite(width)) {
        throw new Error(
          `A width is a number of px, or null to put it back; got ${width}.`,
        )
      }
      const next = width === null ? null : clamp(width)
      if (next === store.get().width) return false
      return commit(next, { reason: 'imperative' })
    }
    /** Puts the width back to the one it was laid out at, and says so. */
    const reset = (event: Event) => {
      if (store.get().width === null) return
      if (commit(null, { reason: 'reset', event }))
        announce(columnResetMessage(options().name ?? 'Column'), {
          priority: 'assertive',
        })
    }
    return {
      resize,
      resizeTo,
      bounds,
      edge,
      keydown(event: KeyboardEvent, el: HTMLElement) {
        if (event.altKey || event.ctrlKey || event.metaKey) return
        // Enter puts it back, as a double press does; Home and End take it to its bounds.
        const to =
          event.key === 'Enter'
            ? { width: null, reason: 'reset' as const }
            : event.key === 'Home'
              ? { width: bounds().min, reason: 'resize-key' as const }
              : event.key === 'End'
                ? { width: bounds().max, reason: 'resize-key' as const }
                : undefined
        if (!to) {
          // The arrows move the end edge a step, Shift a large one, across the screen.
          const way = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
          if (way === 0) return
          event.preventDefault()
          const by = event.shiftKey ? (options().largeStep ?? 64) : (options().step ?? 16)
          resize.resizeBy(COLUMN, edge(el), way * by, 0, { reason: 'resize-key', event })
          return
        }
        event.preventDefault()
        if (to.width === null) {
          reset(event)
          return
        }
        // Through the resize, so it is said as an arrow's is.
        resize.resizeTo(
          COLUMN,
          { x: 0, y: 0, width: to.width, height: 0 },
          { reason: to.reason, event },
          edge(el),
        )
      },
      reset,
      /** Follows a drag on the head: each width the pointer gives, at once. */
      follow(el: HTMLElement) {
        const head = headOf(el)
        const table = head?.closest('table')
        if (!head) return
        let dragging = false
        return store.subscribe(() => {
          const draft = store.get().draft
          if (draft) {
            if (!dragging) {
              table?.setAttribute('data-resizing', '')
              laidOut = store.get().width === null ? widthOf(null) : null
            }
            dragging = true
            head.style.setProperty('--column-width', `${draft.box.width}px`)
            return
          }
          if (!dragging) return
          dragging = false
          // The drop's change runs right after the draft ends: unless it set a
          // width, as Escape or a refused change don't, the head goes back.
          queueMicrotask(() => {
            if (!dropped)
              head.style.setProperty('--column-width', `${widthOf(store.get().width)}px`)
            dropped = false
            laidOut = null
            atOnce(table, () => {})
          })
        })
      },
    }
  },
  slots: (slot) => ({
    // A focusable separator, as ui-sdk's Resizable draws its handles.
    root: slot({
      role: 'separator',
      focus: 'tab-stop',
      keys: [
        'ArrowLeft',
        'ArrowRight',
        'shift+ArrowLeft',
        'shift+ArrowRight',
        'Home',
        'End',
        'Enter',
      ],
      attrs: (state, { api }) => ({
        tabindex: '0',
        'aria-orientation': 'vertical',
        'aria-valuemin': String(api.bounds().min),
        'aria-valuemax': String(api.bounds().max),
        // While it keeps the width it was laid out at, the table reads that out.
        'aria-valuenow':
          state.width === null ? undefined : String(Math.round(state.width)),
      }),
      live: live((state) => ({ 'data-dragging': state.draft ? '' : undefined })),
      on: {
        pointerdown: (event, { api, el }) => {
          if (el) api.resize.pointerdown(event as PointerEvent, COLUMN, api.edge(el), el)
        },
        keydown: (event, { api, el }) => {
          if (el) api.keydown(event as KeyboardEvent, el)
        },
        dblclick: (event, { api }) => api.reset(event),
      },
      bind: (el, { api }) => api.follow(el),
    }),
  }),
  agent: { actions: ['resizeTo'] },
})

export { columnResetMessage, columnResize, columnResizeMessage }
export type { ColumnResizeOptions, ColumnResizeReason }
