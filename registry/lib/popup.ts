'use client'

import { bindPersistentLayer } from '@ui-sdk/core'
import { type CSSProperties, createContext, use, useEffect, useState } from 'react'

/*
 * How every popup anchored to a trigger opens and closes: it grows out from
 * under the trigger, as wide as the trigger at first, and folds back into it.
 * Popover, Menus, Select and Combobox share it, and the glide lib builds on
 * its strip, its sides and its anchor.
 */

/**
 * How long the pointer rests on a trigger before a popup that opens on hover
 * opens, in ms: long enough to skip triggers the pointer only passes over,
 * short enough not to keep anyone waiting. Tooltips, hover cards and
 * popovers opened on hover all wait this long (Greg, 2026-11-14).
 */
export const HOVER_DELAY = 200

/** How far from the screen's edge a popup stays, in px. */
export const POPUP_COLLISION_PADDING = 8

export type PhysicalSide = 'top' | 'bottom' | 'left' | 'right'
/** A side as Base UI names it: the inline sides follow the reading direction. */
export type PopupSide = PhysicalSide | 'inline-start' | 'inline-end'
export type ReadingDirection = 'ltr' | 'rtl'

/** The screen edge a side is on: the inline sides follow the reading direction. */
export function physicalSide(
  side: PopupSide | undefined,
  direction: ReadingDirection,
): PhysicalSide {
  if (side === 'inline-end') return direction === 'rtl' ? 'left' : 'right'
  if (side === 'inline-start') return direction === 'rtl' ? 'right' : 'left'
  return side ?? 'top'
}

/** A box in screen pixels. */
export interface ScreenBox {
  left: number
  top: number
  width: number
  height: number
}

/*
 * The strip a popup opens from and closes into: the edge of its box that
 * faces the trigger, with no depth, as long as the trigger and centred on it,
 * even where the popup was shifted in from the edge of the screen. Written
 * twice over, for the two engines that draw it: in pixels for the glide lib,
 * which slides between boxes it measures, and as an `inset()` for CSS, which
 * reads the anchor from variables.
 */

/**
 * The strip in pixels, where `anchor` is the trigger's centre along the edge,
 * from the box's left or top.
 */
export function anchorStrip(
  side: PhysicalSide,
  box: ScreenBox,
  anchor: number,
  anchorLength: number,
): ScreenBox {
  if (side === 'top' || side === 'bottom') {
    const left = Math.max(box.left, box.left + anchor - anchorLength / 2)
    const right = Math.min(box.left + box.width, box.left + anchor + anchorLength / 2)
    const top = side === 'bottom' ? box.top : box.top + box.height
    return { left, top, width: Math.max(0, right - left), height: 0 }
  }
  const top = Math.max(box.top, box.top + anchor - anchorLength / 2)
  const bottom = Math.min(box.top + box.height, box.top + anchor + anchorLength / 2)
  const left = side === 'right' ? box.left : box.left + box.width
  return { left, top, width: 0, height: Math.max(0, bottom - top) }
}

/*
 * Where the trigger's centre is along the popup's edge, from its left or top:
 * ui-sdk writes `--arrow-offset` on the popup it places, with no arrow part.
 */
const ANCHOR = 'var(--arrow-offset, 50%)'

/** The strip as the `inset()` a popup starts from. */
export function popupGrowInset(side: PhysicalSide): string {
  if (side === 'top' || side === 'bottom') {
    const left = `max(0px, calc(${ANCHOR} - var(--anchor-width) / 2))`
    const right = `max(0px, calc(100% - ${ANCHOR} - var(--anchor-width) / 2))`
    return side === 'bottom' ? `0px ${right} 100% ${left}` : `100% ${right} 0px ${left}`
  }
  const top = `max(0px, calc(${ANCHOR} - var(--anchor-height) / 2))`
  const bottom = `max(0px, calc(100% - ${ANCHOR} - var(--anchor-height) / 2))`
  return side === 'right' ? `${top} 100% ${bottom} 0px` : `${top} 0px ${bottom} 100%`
}

/** The shape a popup grows from on `side`, with the corner its strip rounds to. */
export function popupGrowFrom(side: PhysicalSide): string {
  return `inset(${popupGrowInset(side)} round var(--control-radius-capped))`
}

/** The look of every popup's box. Give it a corner: `--list-radius` for a list, `--surface-radius` for a surface. */
export const popupSurfaceClassName =
  'bg-popover text-popover-foreground shadow-lg ring-1 ring-foreground/10 outline-hidden forced-colors:outline forced-colors:outline-solid'

/**
 * A popup ui-sdk places: the box it grows from, on the side it landed on
 * (`popupGrowFrom`, written out for Tailwind), and `group/popup`, which the
 * box inside it (`popupGrowBoxClassName`) and its content read. It paints
 * nothing itself, so a popup of the old library opened inside it shows whole.
 * ui-sdk keeps the room left on screen to the popup itself, so it hands it
 * on as `--popup-available-height`.
 */
export const popupPlacedClassName =
  'group/popup isolate outline-hidden [--popup-available-height:var(--available-height)] data-[side=bottom]:[--popup-grow-from:inset(0px_max(0px,calc(100%_-_var(--arrow-offset,50%)_-_var(--anchor-width)_/_2))_100%_max(0px,calc(var(--arrow-offset,50%)_-_var(--anchor-width)_/_2))_round_var(--control-radius-capped))] data-[side=top]:[--popup-grow-from:inset(100%_max(0px,calc(100%_-_var(--arrow-offset,50%)_-_var(--anchor-width)_/_2))_0px_max(0px,calc(var(--arrow-offset,50%)_-_var(--anchor-width)_/_2))_round_var(--control-radius-capped))] data-[side=right]:[--popup-grow-from:inset(max(0px,calc(var(--arrow-offset,50%)_-_var(--anchor-height)_/_2))_100%_max(0px,calc(100%_-_var(--arrow-offset,50%)_-_var(--anchor-height)_/_2))_0px_round_var(--control-radius-capped))] data-[side=left]:[--popup-grow-from:inset(max(0px,calc(var(--arrow-offset,50%)_-_var(--anchor-height)_/_2))_0px_max(0px,calc(100%_-_var(--arrow-offset,50%)_-_var(--anchor-height)_/_2))_100%_round_var(--control-radius-capped))]'

/**
 * The box inside a placed popup: it grows on `morph` and folds back on
 * `exit`, both turning back from where they are. Open, its clip reaches past
 * the box, so the ring and the shadow show. Under reduced motion it only
 * fades.
 */
export const popupGrowBoxClassName =
  '[--popup-grow-to:inset(-2rem_round_calc(var(--surface-radius)+2rem))] [clip-path:var(--popup-grow-to)] transition-[clip-path,opacity] duration-(--motion-morph-duration) ease-(--motion-morph-easing) group-data-starting-style/popup:[clip-path:var(--popup-grow-from)] group-data-ending-style/popup:[clip-path:var(--popup-grow-from)] group-data-ending-style/popup:duration-(--motion-exit-duration) group-data-ending-style/popup:ease-(--motion-exit-easing) motion-reduce:transition-opacity motion-reduce:group-data-starting-style/popup:opacity-0 motion-reduce:group-data-starting-style/popup:[clip-path:var(--popup-grow-to)] motion-reduce:group-data-ending-style/popup:opacity-0 motion-reduce:group-data-ending-style/popup:[clip-path:var(--popup-grow-to)]'

/**
 * The same box for a popup that carries its open state on itself
 * (`data-starting-style`), such as the AI chat popup's window or a popup of
 * the old library, with its `--popup-grow-from` set by its own code or by
 * `basePopupGrow`.
 */
export const popupGrowClassName =
  '[--popup-grow-to:inset(-2rem_round_calc(var(--surface-radius)+2rem))] [clip-path:var(--popup-grow-to)] transition-[clip-path,opacity] duration-(--motion-morph-duration) ease-(--motion-morph-easing) data-starting-style:[clip-path:var(--popup-grow-from)] data-ending-style:[clip-path:var(--popup-grow-from)] data-ending-style:duration-(--motion-exit-duration) data-ending-style:ease-(--motion-exit-easing) motion-reduce:transition-opacity motion-reduce:data-starting-style:opacity-0 motion-reduce:data-starting-style:[clip-path:var(--popup-grow-to)] motion-reduce:data-ending-style:opacity-0 motion-reduce:data-ending-style:[clip-path:var(--popup-grow-to)]'

/**
 * What sits inside the box: it fades in once the box has started to grow,
 * and out quickly when it folds back. Needs `group/popup` on the popup.
 */
export const popupGrowContentClassName =
  'transition-opacity duration-(--motion-enter-duration) ease-(--motion-enter-easing) group-data-open/popup:delay-[calc(var(--motion-morph-duration)*0.15)] group-data-starting-style/popup:opacity-0 group-data-ending-style/popup:opacity-0 group-data-ending-style/popup:duration-[calc(var(--motion-exit-duration)*0.4)]'

/*
 * Two libraries on one page, until the last popup of the old one moves
 * (`scripts/lib/library-rules.test.ts` keeps this to files still on it):
 * ui-sdk opens its popups in the browser's top layer, above everything in
 * `<body>`, so a popup of the old library, which portals to `<body>`, would
 * open behind a ui-sdk dialog or popover and take no presses. A ui-sdk
 * Dialog, Alert dialog or Popover is the layer for what opens inside it, and
 * the toasts, which live in `<body>` for the whole app, are a layer of their
 * own that ui-sdk keeps above its popups and usable under a modal dialog.
 */

/** The ui-sdk popup a popup of the old library opens inside, if any. */
export const PopupLayerContext = createContext<HTMLElement | null>(null)

/**
 * For the content of a ui-sdk Dialog, Alert dialog or Popover: the layer to
 * hand to `PopupLayerContext` around what is inside it, and the ref for its
 * element. Only content in the top layer is one: content shown `inline` is
 * in the page, as the old library's popups are.
 */
export function useOwnPopupLayer(inTopLayer: boolean) {
  const around = use(PopupLayerContext)
  const [element, setElement] = useState<HTMLElement | null>(null)
  return [(inTopLayer ? element : null) ?? around, setElement] as const
}

/** Where a popup of the old library portals: inside the ui-sdk popup around it, or `<body>`. */
export function usePopupLayer(): HTMLElement | undefined {
  return use(PopupLayerContext) ?? undefined
}

/**
 * For the old library's toast viewport, which needs `popover='manual'`: it
 * shows in the top layer, ui-sdk raises it above each popup that opens after
 * it and leaves it usable while a modal dialog makes the page inert, and a
 * press on a toast closes no popup.
 */
export function usePersistentLayer(element: HTMLElement | null) {
  useEffect(() => {
    if (!element) return
    element.showPopover()
    const release = bindPersistentLayer(element)
    return () => {
      release()
      if (element.matches(':popover-open')) element.hidePopover()
    }
  }, [element])
}

/**
 * What a popup of the old library needs to grow from its trigger, given the
 * reading direction its Base UI provider says: its `dir`, a function for its
 * `style` prop that sets `--popup-grow-from`, and `anchor`, the props for an
 * empty arrow part inside it that writes `--arrow-offset` on the popup.
 */
export function basePopupGrow(direction: ReadingDirection) {
  return {
    dir: direction,
    style: ({ side }: { side: PopupSide }) =>
      ({
        '--popup-grow-from': popupGrowFrom(physicalSide(side, direction)),
      }) as CSSProperties,
    anchor: {
      ref: (marker: HTMLElement | null) => (marker ? trackAnchor(marker) : undefined),
      'data-popup-anchor': '',
      className: 'pointer-events-none absolute size-0',
    },
  }
}

/*
 * Base UI centres an arrow on the trigger, past any shift. A marker the size
 * of nothing in the arrow's place tells the popup where that is, as ui-sdk's
 * `--arrow-offset` does. Kept outside any hook: the React Compiler can drop
 * side effects written inside one.
 */
function trackAnchor(marker: HTMLElement) {
  const write = () => {
    const popup = marker.parentElement
    const offset = marker.style.left || marker.style.top
    if (popup && offset) popup.style.setProperty('--arrow-offset', offset)
  }
  write()
  const observer = new MutationObserver(write)
  observer.observe(marker, { attributes: true, attributeFilter: ['style'] })
  return () => observer.disconnect()
}

/**
 * What every anchored popup of the old library's positioner takes: 8px from
 * the screen's edge, an arrow free to sit right under the trigger, and its
 * own layer above the page.
 */
export const basePositionerProps = {
  collisionPadding: POPUP_COLLISION_PADDING,
  arrowPadding: 0,
  className: 'isolate z-50 outline-hidden',
} as const
