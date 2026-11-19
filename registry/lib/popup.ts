'use client'

import { useDirection } from '@base-ui/react/direction-provider'
import type { CSSProperties } from 'react'

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

export type PhysicalSide = 'top' | 'bottom' | 'left' | 'right'
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

// Where the trigger's centre is along the popup's edge, from the popup's left
// or top, in px: written by `trackAnchor` once Base UI has placed the popup.
const ANCHOR_X = 'var(--popup-anchor-x, 50%)'
const ANCHOR_Y = 'var(--popup-anchor-y, 50%)'

/** The strip as the `inset()` a popup starts from. */
export function popupGrowInset(side: PopupSide, direction: ReadingDirection): string {
  const physical = physicalSide(side, direction)
  if (physical === 'top' || physical === 'bottom') {
    const left = `max(0px, calc(${ANCHOR_X} - var(--anchor-width) / 2))`
    const right = `max(0px, calc(100% - ${ANCHOR_X} - var(--anchor-width) / 2))`
    return physical === 'bottom'
      ? `0px ${right} 100% ${left}`
      : `100% ${right} 0px ${left}`
  }
  const top = `max(0px, calc(${ANCHOR_Y} - var(--anchor-height) / 2))`
  const bottom = `max(0px, calc(100% - ${ANCHOR_Y} - var(--anchor-height) / 2))`
  return physical === 'right' ? `${top} 100% ${bottom} 0px` : `${top} 0px ${bottom} 100%`
}

/*
 * Base UI centres an arrow on the trigger, past any shift. A marker the size
 * of nothing in the arrow's place tells the popup where that is. Kept outside
 * the hook: the React Compiler can drop side effects written inside one.
 */
function trackAnchor(marker: HTMLElement) {
  const write = () => {
    const popup = marker.parentElement
    if (!popup) return
    if (marker.style.left) popup.style.setProperty('--popup-anchor-x', marker.style.left)
    if (marker.style.top) popup.style.setProperty('--popup-anchor-y', marker.style.top)
  }
  write()
  const observer = new MutationObserver(write)
  observer.observe(marker, { attributes: true, attributeFilter: ['style'] })
  return () => observer.disconnect()
}

/** The trigger's centre along the popup's edge, in px from its left or top, as Base UI placed it. */
export function anchorOffset(popup: HTMLElement, across: boolean): number {
  const marker = popup.querySelector<HTMLElement>(':scope > [data-popup-anchor]')
  return Number.parseFloat(
    across ? (marker?.style.left ?? '') : (marker?.style.top ?? ''),
  )
}

/**
 * What a popup needs to grow from its trigger: its `dir`, a function for its
 * `style` prop that sets `--popup-grow-from`, the shape it grows from, and
 * `anchor`, the props for an empty arrow part inside the popup, on a
 * positioner given `popupPositionerProps`.
 */
export function usePopupGrow() {
  const direction = useDirection()
  return {
    dir: direction,
    style: ({ side }: { side: PopupSide }) =>
      ({
        '--popup-grow-from': `inset(${popupGrowInset(side, direction)} round var(--control-radius-capped))`,
      }) as CSSProperties,
    anchor: {
      ref: (marker: HTMLElement | null) => (marker ? trackAnchor(marker) : undefined),
      'data-popup-anchor': '',
      className: 'pointer-events-none absolute size-0',
    },
  }
}

/**
 * What every anchored popup's positioner takes: 8px from the screen's edge,
 * an arrow free to sit right under the trigger, and its own layer above the
 * page.
 */
export const popupPositionerProps = {
  collisionPadding: 8,
  arrowPadding: 0,
  className: 'isolate z-50 outline-hidden',
} as const

/** The look of every popup's box. Give it a corner: `--list-radius` for a list, `--surface-radius` for a surface. */
export const popupSurfaceClassName =
  'bg-popover text-popover-foreground shadow-lg ring-1 ring-foreground/10 outline-hidden forced-colors:outline'

/**
 * The popup's box: it grows on `morph` and folds back on `exit`, both turning
 * back from where they are. Open, its clip reaches past the box, so the ring
 * and the shadow show. Under reduced motion it only fades.
 */
export const popupGrowClassName =
  '[--popup-grow-to:inset(-2rem_round_calc(var(--surface-radius)+2rem))] [clip-path:var(--popup-grow-to)] transition-[clip-path,opacity] duration-(--motion-morph-duration) ease-(--motion-morph-easing) data-starting-style:[clip-path:var(--popup-grow-from)] data-ending-style:[clip-path:var(--popup-grow-from)] data-ending-style:duration-(--motion-exit-duration) data-ending-style:ease-(--motion-exit-easing) motion-reduce:transition-opacity motion-reduce:data-starting-style:opacity-0 motion-reduce:data-starting-style:[clip-path:var(--popup-grow-to)] motion-reduce:data-ending-style:opacity-0 motion-reduce:data-ending-style:[clip-path:var(--popup-grow-to)]'

/**
 * What sits inside the box: it fades in once the box has started to grow,
 * and out quickly when it folds back. Needs `group/popup` on the box.
 */
export const popupGrowContentClassName =
  'transition-opacity duration-(--motion-enter-duration) ease-(--motion-enter-easing) group-data-open/popup:delay-[calc(var(--motion-morph-duration)*0.15)] group-data-starting-style/popup:opacity-0 group-data-ending-style/popup:opacity-0 group-data-ending-style/popup:duration-[calc(var(--motion-exit-duration)*0.4)]'
