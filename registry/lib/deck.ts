import { withoutTransition } from '@/registry/lib/resize'
import {
  bindDrag,
  type ChangeDetails,
  createChange,
  createRovingFocus,
  definePrimitive,
  elements,
  isRTL,
} from '@ui-sdk/core'
import type { CarouselPageChangeReason } from '@ui-sdk/core/carousel'
import { createVelocityTracker } from '@ui-sdk/core/gesture'

/*
 * A stack of cards that shows one at a time, the Carousel's deck: the top
 * card follows a drag and tilts with it, and let go far or fast enough it is
 * thrown off and goes under the stack while the rest step up. Previous
 * brings the last card back from the side it left. It always loops. Its
 * page, from 1, is the top card, with the Carousel's names and reasons, so a
 * Carousel passes the same props to its track or its deck, and an agent
 * pages either the same way.
 */

/** Why the top card changed: the Carousel's reasons that a deck has. */
type DeckPageChangeReason = Extract<
  CarouselPageChangeReason,
  | 'previous-press'
  | 'next-press'
  | 'item-press'
  | 'list-navigation'
  | 'swipe'
  | 'content-resize'
  | 'imperative'
>

type DeckPageOptions = { reason?: DeckPageChangeReason; event?: Event }

type DeckOptions = {
  /** The card on top, from 1. Pass it to control the deck. */
  page?: number
  defaultPage?: number
  onPageChange?: (page: number, details: ChangeDetails<DeckPageChangeReason>) => void
}

/** How far a card is dragged, as a share of its width, before letting go throws it. */
const THROW_SHARE = 0.35

/** How far a thrown card goes on from where it was let go, as a share of its width: `--carousel-slide`'s default. */
const SLIDE_SHARE = 0.6

/** How far a press moves before it is a drag, in pixels, so a page still scrolls under a finger that moves up or down. */
const DRAG_SLOP = 6

/** A flick at least this fast, in px/ms, the way it was dragged, throws the card however far it went. */
const FLICK_VELOCITY = 0.5

/** How long a thrown card takes to go, in milliseconds, at its fastest and slowest, and the shortest share of its role that leaves. */
const MIN_THROW_MS = 80
const MAX_THROW_MS = 360
const MIN_STRENGTH = 0.1

/** Arrow keys belong to these, inside a card: a field's caret, a list's own keys. */
const KEEPS_ARROWS =
  'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="slider"], [role="spinbutton"], [role="listbox"], [role="grid"], [role="tablist"], [role="menu"], [role="menubar"], [role="radiogroup"], [role="tree"], [role="toolbar"]'

const FOCUSABLE =
  'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])'

/** How far a card is under the top one: 0 on top, wrapping round. `index` counts from 0, `page` from 1. */
function deckDepth(index: number, page: number, count: number) {
  return count > 0 ? (((index - (page - 1)) % count) + count) % count : index
}

/** The page `page` asks for, round the deck's `count` cards. */
function wrapPage(page: number, count: number) {
  const n = Math.max(1, count)
  return ((((page - 1) % n) + n) % n) + 1
}

/** Whether a card let go `dx` pixels along, at `velocity` px/ms, is thrown off: dragged far enough, or flicked the way it went. */
function throws(dx: number, velocity: number, width: number) {
  const flicked =
    Math.abs(velocity) >= FLICK_VELOCITY && Math.sign(velocity) === Math.sign(dx)
  return flicked || Math.abs(dx) >= width * THROW_SHARE
}

/**
 * How much of its role's duration a throw takes, from 0.1 to 1, as
 * `--carousel-swipe-strength`: `remaining` pixels to go at `velocity` px/ms.
 * A slow release takes the whole role, so a press and a drag let go feel
 * the same, and only a flick is quicker.
 */
function throwStrength(remaining: number, velocity: number) {
  const speed = Math.abs(velocity)
  if (speed <= 0.2 || remaining <= 0) return 1
  const ms = Math.max(
    MIN_THROW_MS,
    Math.min(MAX_THROW_MS, remaining / Math.min(speed, 4)),
  )
  return (
    MIN_STRENGTH +
    ((ms - MIN_THROW_MS) / (MAX_THROW_MS - MIN_THROW_MS)) * (1 - MIN_STRENGTH)
  )
}

/** Which page an arrow, Home or End takes the deck to from `page`, or null for a key it doesn't take. Left and right swap in right to left. */
function keyPage(key: string, page: number, count: number, rtl: boolean) {
  const forward = rtl ? 'ArrowLeft' : 'ArrowRight'
  const back = rtl ? 'ArrowRight' : 'ArrowLeft'
  if (key === forward) return wrapPage(page + 1, count)
  if (key === back) return wrapPage(page - 1, count)
  if (key === 'Home') return 1
  if (key === 'End') return count
  return null
}

function cardsIn(stack: HTMLElement | null) {
  return [...(stack?.children ?? [])].filter(
    (child): child is HTMLElement => child instanceof HTMLElement,
  )
}

function release(card: HTMLElement, root: HTMLElement | null) {
  card.style.removeProperty('--carousel-drag-x')
  card.style.removeProperty('--carousel-drag-share')
  root?.style.removeProperty('--carousel-swipe-progress')
}

/**
 * The top card went from `from` to `to`: the one that was on top is thrown
 * off `way` (1 towards the end, -1 towards the start) and lands under the
 * stack, or, one back, the card brought back comes in from the side it left
 * by. Kept outside the primitive: the React Compiler drops the forced style
 * read a component would make, and then the change animates.
 */
function shuffle(
  stack: HTMLElement,
  root: HTMLElement,
  from: number,
  to: number,
  way: number | null,
  carry: boolean,
) {
  const all = cardsIn(stack)
  const count = all.length
  const towardsStart = isRTL(stack) ? 1 : -1
  const fromCard = all[from - 1]
  const toCard = all[to - 1]
  // A card still on its way off that comes straight back on top, as in a
  // deck of two, turns back from where it is.
  const turnedBack = Boolean(toCard?.hasAttribute('data-thrown'))
  if (turnedBack && toCard) {
    toCard.removeAttribute('data-thrown')
    release(toCard, null)
  }
  // Focus in the card leaving the top would be lost as it goes inert: it
  // moves into the new top card, or to the viewport, which then takes the
  // arrow keys, or to Next.
  // The new top card is let out of `inert` now, ahead of its attributes.
  if (carry) {
    if (toCard) toCard.inert = false
    const next =
      toCard?.querySelector<HTMLElement>(FOCUSABLE) ??
      stack.closest<HTMLElement>('[tabindex="0"]') ??
      root.querySelector<HTMLElement>('[data-carousel-next]')
    next?.focus({ preventScroll: true })
  }
  if (to === wrapPage(from - 1, count) && count > 2) {
    // One still on its way off is already turning back from where it is.
    if (!toCard || turnedBack) return
    withoutTransition(toCard, () => {
      toCard.style.setProperty('--carousel-throw', `${towardsStart}`)
      toCard.setAttribute('data-thrown', '')
    })
    toCard.removeAttribute('data-thrown')
    return
  }
  if (!fromCard) return
  // A press throws it in the role's own time; only a flick shortens it.
  if (way === null) root.style.setProperty('--carousel-swipe-strength', '1')
  fromCard.style.setProperty('--carousel-throw', `${way ?? towardsStart}`)
  // It leaves from where the drag let it go.
  fromCard.setAttribute('data-thrown', '')
  const land = (event?: TransitionEvent) => {
    if (event && (event.target !== fromCard || event.propertyName !== 'opacity')) return
    fromCard.removeEventListener('transitionend', land)
    clearTimeout(timer)
    // Brought back on top before it landed: it is already on its way back.
    if (!fromCard.hasAttribute('data-thrown')) return
    // It goes under the deck where it can't be seen, then fades in there.
    withoutTransition(fromCard, () => {
      fromCard.removeAttribute('data-thrown')
      release(fromCard, null)
      fromCard.style.opacity = '0'
    })
    fromCard.style.opacity = ''
  }
  fromCard.addEventListener('transitionend', land)
  // In case it can't transition, such as while the tab is hidden.
  const timer = setTimeout(land, 4000)
}

const deck = definePrimitive({
  name: 'carousel',
  options: { page: 'number', defaultPage: 'number', onPageChange: 'callback' },
  controlled: ['page'],
  state: (options: DeckOptions) => ({
    page: Math.max(1, Math.floor(options.page ?? options.defaultPage ?? 1)),
    /** How many cards there are, or null before they are counted, as on the server. */
    pageCount: null as number | null,
    /** The indicator with the tab stop. */
    stop: null as string | null,
    dragging: false,
  }),
  sync: (options) => (options.page === undefined ? {} : { page: options.page }),
  api: (context) => {
    const { store } = context
    const change = createChange(context)
    const count = () => elements(context, 'item').length
    // Which way the next throw goes: the way the card was dragged, or towards the start.
    let way: number | null = null
    let stop: (() => void) | undefined
    let fitting = false
    // Whether focus was in the top card as the page was asked to change.
    let carry = false
    const cardsAt = () => elements(context, 'item').map((item) => item.el)
    context.onDestroy(() => stop?.())

    const setPage = (page: number, options: DeckPageOptions = {}) => {
      const n = count()
      if (n === 0) return false
      const to = Math.max(1, Math.min(n, Math.round(page)))
      if (to === store.get().page) return false
      // Read before the card goes inert, which drops the focus in it.
      carry = Boolean(cardsAt()[store.get().page - 1]?.contains(document.activeElement))
      const changed = change('page', to, {
        reason: options.reason ?? 'imperative',
        event: options.event,
      })
      if (!changed) carry = false
      return changed
    }
    const step = (by: number, options: DeckPageOptions) => {
      const n = count()
      if (n < 2) return false
      return setPage(wrapPage(store.get().page + by, n), options)
    }
    const indicatorPage = (key: string) =>
      context.props<{ page?: number }>('indicator', key)?.page ?? 0

    const roving = createRovingFocus(context, {
      slot: 'indicator',
      key: 'stop',
      remember: false,
      orientation: () => 'horizontal',
      loop: () => true,
      preferred: (item) => indicatorPage(item.key) === store.get().page,
      claims: (state, item) => (item.props as { page?: number }).page === state.page,
    })

    return {
      roving,
      /** Shows the card at `page`, from 1, held between the first and the last. */
      setPage,
      /** Throws the top card off, and the next comes up; after the last, the first. */
      next: (options: DeckPageOptions = {}) =>
        step(1, { reason: 'imperative', ...options }),
      /** Brings the last card thrown back on top; before the first, the last. */
      previous: (options: DeckPageOptions = {}) =>
        step(-1, { reason: 'imperative', ...options }),
      internal: {
        count,
        indicatorPage,
        /** Counts the cards, and moves a page past the last card onto it, as the track does. */
        fit() {
          store.set({ pageCount: count() })
          // Once every card that binds with this one has: the first alone counts one.
          if (fitting) return
          fitting = true
          queueMicrotask(() => {
            fitting = false
            const n = count()
            store.set({ pageCount: n })
            if (n > 0 && store.get().page > n)
              change('page', n, { reason: 'content-resize' })
          })
        },
        /** Whether the top card holds nothing to focus, so the viewport takes the arrow keys itself. */
        bare: (page: number) => {
          const card = elements(context, 'item')[page - 1]?.el
          return Boolean(card && !card.querySelector(FOCUSABLE))
        },
        /** The id of the card at `page`, which its indicator controls. */
        cardId: (page: number) => elements(context, 'item')[page - 1]?.el.id || undefined,
        /** Arrow keys inside the top card page the deck, unless what has focus keeps them. */
        keydown(event: KeyboardEvent, el: HTMLElement) {
          if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey)
            return
          if (event.shiftKey) return
          if ((event.target as Element | null)?.closest(KEEPS_ARROWS)) return
          const n = count()
          const to = keyPage(event.key, store.get().page, n, isRTL(el))
          if (to === null || n < 2) return
          event.preventDefault()
          setPage(to, { reason: 'list-navigation', event })
        },
        indicatorKeydown(event: KeyboardEvent) {
          const moved = roving.keydown(event, event.target as HTMLElement)
          if (!moved || moved.key === moved.from) return
          setPage(indicatorPage(moved.key), { reason: 'list-navigation', event })
        },
        /** A press on the top card may become a drag that throws it. */
        press(event: PointerEvent, stack: HTMLElement) {
          if (event.button !== 0 || !(event.target instanceof Element)) return
          if (event.target.closest('input, textarea, select, [contenteditable]')) return
          const card = cardsIn(stack)[store.get().page - 1]
          if (!card?.contains(event.target) || count() < 2) return
          const root = context.element('root') ?? null
          const tracker = createVelocityTracker()
          const startX = event.clientX
          const startY = event.clientY
          let dx = 0
          stop?.()
          stop = bindDrag(stack, event, {
            threshold: DRAG_SLOP,
            cancelOnEscape: true,
            // A press that goes up or down more than sideways is the page's scroll.
            onStart: (move) => {
              if (Math.abs(move.clientY - startY) >= Math.abs(move.clientX - startX))
                return false
              window.getSelection()?.removeAllRanges()
              tracker.add(event.timeStamp, startX)
              store.set({ dragging: true })
            },
            onMove: ({ x, event: move }) => {
              dx = x - startX
              tracker.add(move.timeStamp, x)
              const width = card.offsetWidth || 1
              card.style.setProperty('--carousel-drag-x', `${dx}px`)
              card.style.setProperty('--carousel-drag-share', `${dx / width}`)
              root?.style.setProperty(
                '--carousel-swipe-progress',
                `${Math.min(1, Math.abs(dx) / (width * THROW_SHARE))}`,
              )
            },
            onEnd: (end, canceled) => {
              store.set({ dragging: false })
              const width = card.offsetWidth || 1
              const velocity = canceled ? 0 : tracker.velocity(end.timeStamp)
              if (canceled || !throws(dx, velocity, width)) {
                root?.style.setProperty('--carousel-swipe-strength', '1')
                release(card, root)
                return
              }
              root?.style.setProperty(
                '--carousel-swipe-strength',
                `${throwStrength(width * SLIDE_SHARE, velocity)}`,
              )
              root?.style.removeProperty('--carousel-swipe-progress')
              way = Math.sign(dx) || (isRTL(stack) ? 1 : -1)
              const from = store.get().page
              step(1, { reason: 'swipe', event: end })
              // An owner that holds the page back keeps the card: it returns.
              requestAnimationFrame(() => {
                if (store.get().page !== from) return
                way = null
                root?.style.setProperty('--carousel-swipe-strength', '1')
                release(card, root)
              })
            },
          })
        },
        /** Moves the cards each time the top one changes, however it changed. */
        follow(stack: HTMLElement) {
          let shown = store.get().page
          return store.subscribe(() => {
            const page = store.get().page
            if (page === shown) return
            const from = shown
            shown = page
            const root = context.element('root')
            if (root) shuffle(stack, root, from, page, way, carry)
            carry = false
            way = null
          })
        },
      },
    }
  },
  slots: (slot) => ({
    root: slot({
      role: 'region',
      state: (state) => ({ page: state.page, pageCount: state.pageCount }),
      attrs: () => ({ 'aria-roledescription': 'carousel' }),
    }),
    viewport: slot({
      attrs: (state, { api }) => ({
        'data-dragging': state.dragging ? '' : undefined,
        tabindex:
          state.pageCount !== null && api.internal.bare(state.page) ? '0' : undefined,
      }),
      on: {
        keydown: (event, { api, el }) => {
          if (el) api.internal.keydown(event as KeyboardEvent, el)
        },
      },
    }),
    content: slot({
      on: {
        pointerdown: (event, { api, el }) => {
          if (el) api.internal.press(event as PointerEvent, el)
        },
      },
      bind: (el, { api }) => api.internal.follow(el),
    }),
    item: slot<{ index: number; count: number; id?: string }>({
      role: 'group',
      props: { index: 'number', count: 'number', id: 'id' },
      attrs: (state, { props }) => {
        const depth = deckDepth(props.index, state.page, props.count)
        return {
          id: props.id,
          'aria-roledescription': 'slide',
          'aria-label': `${props.index + 1} of ${props.count}`,
          'data-top': depth === 0 ? '' : undefined,
          // Only the top card can be read and used; the ones under it are a picture of the deck.
          inert: depth === 0 ? undefined : '',
          'aria-hidden': depth === 0 ? undefined : 'true',
          style: `--carousel-depth:${Math.min(depth, 3)};--carousel-z:${props.count - depth}`,
        }
      },
      bind: (_el, { api }) => {
        api.internal.fit()
        return () => api.internal.fit()
      },
    }),
    previous: slot({
      attrs: (state) => {
        const off = state.pageCount !== null && state.pageCount < 2
        return {
          type: 'button',
          'aria-disabled': off ? 'true' : undefined,
          'data-disabled': off ? '' : undefined,
        }
      },
      press: ({ api }, event) => {
        api.previous({ reason: 'previous-press', event })
      },
    }),
    next: slot({
      attrs: (state) => {
        const off = state.pageCount !== null && state.pageCount < 2
        return {
          type: 'button',
          'aria-disabled': off ? 'true' : undefined,
          'data-disabled': off ? '' : undefined,
        }
      },
      press: ({ api }, event) => {
        api.next({ reason: 'next-press', event })
      },
    }),
    'indicator-group': slot({
      role: 'tablist',
      keys: ['ArrowLeft', 'ArrowRight', 'Home', 'End'],
      on: {
        keydown: (event, { api }) =>
          api.internal.indicatorKeydown(event as KeyboardEvent),
      },
    }),
    indicator: slot<{ page: number; id?: string }>({
      role: 'tab',
      focus: 'roving',
      props: { page: 'number', id: 'id' },
      state: (state, { props }) => ({
        page: props.page,
        selected: props.page === state.page,
      }),
      attrs: (state, part) => ({
        type: 'button',
        tabindex: part.api.roving.tabIndex(state, part),
        'aria-selected': String(part.props.page === state.page),
        'aria-controls': part.api.internal.cardId(part.props.page),
        'data-selected': part.props.page === state.page ? '' : undefined,
      }),
      press: ({ api, el, props }, event) => {
        if (el && document.activeElement !== el) el.focus({ preventScroll: true })
        api.setPage(props.page, { reason: 'item-press', event })
      },
      bind: (el, part) => part.api.roving.bind(el, part),
    }),
  }),
  agent: { actions: ['setPage', 'next', 'previous'] },
})

export { deck, deckDepth, keyPage, throwStrength, throws, wrapPage }
export type { DeckOptions, DeckPageChangeReason, DeckPageOptions }
