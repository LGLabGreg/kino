import { withoutTransition } from '@/registry/lib/resize'
import type { FocusEvent, KeyboardEvent, PointerEvent } from 'react'
import { createContext } from 'react'

/**
 * What Checkbox, Radio and Switch share, so a choice answers the same way
 * whichever control makes it: the hit area, focus, invalid, disabled and a
 * held press, and the wipe that draws a box's mark.
 */

/**
 * Every choice control: a hit area 4px past its edge, the focus ring, the
 * invalid ring with a dashed outline where forced colours drop it, and the
 * disabled fade.
 */
export const choiceClassName =
  'relative inline-flex shrink-0 items-center outline-offset-2 after:absolute after:-inset-1 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-hidden aria-invalid:ring-3 aria-invalid:ring-destructive/20 forced-colors:aria-invalid:outline-2 forced-colors:aria-invalid:outline-dashed dark:aria-invalid:ring-destructive/40 data-disabled:pointer-events-none data-disabled:opacity-50'

/** How a 16px box looks at rest: its border, surface and shadow, in either theme. */
const choiceBoxLookClassName =
  'size-4 justify-center border border-muted-foreground/80 bg-background shadow-xs dark:bg-input/30'

/**
 * The 16px box a Checkbox or Radio is drawn in. While held (by the pointer,
 * by Space, or by its label or its card) it shrinks by three times the feel's
 * press scale, since a press the size of a button's would be lost on a box
 * this small; it eases down quickly and back on the press role. A card's box
 * also takes the card's hover. An invalid box keeps its colour under hover. Read-only and disabled boxes take no hover or
 * press.
 */
export const choiceBoxClassName = `${choiceBoxLookClassName} transition-[background-color,border-color,box-shadow,scale] duration-(--motion-press-duration) ease-[var(--motion-press-fade-easing),var(--motion-press-fade-easing),var(--motion-press-fade-easing),var(--motion-press-easing)] not-data-checked:not-data-indeterminate:not-data-disabled:not-data-readonly:not-aria-invalid:hover:border-muted-foreground not-data-checked:not-data-indeterminate:not-data-disabled:not-data-readonly:[[data-choice-card]:hover:not([aria-invalid=true])_&]:border-muted-foreground focus-visible:border-ring aria-invalid:border-destructive [[data-choice-card][aria-invalid=true]_&]:border-destructive active:duration-[calc(var(--motion-press-duration)*0.4)] data-pressing:duration-[calc(var(--motion-press-duration)*0.4)] [label:active_&]:duration-[calc(var(--motion-press-duration)*0.4)] [[data-choice-card]:active_&]:duration-[calc(var(--motion-press-duration)*0.4)] [[data-choice-card][data-pressing]_&]:duration-[calc(var(--motion-press-duration)*0.4)] [[data-slot=field]:has(>[data-slot=field-label]:active)_&]:duration-[calc(var(--motion-press-duration)*0.4)] motion-safe:not-data-readonly:active:scale-[calc(1_-_(1_-_var(--motion-press-scale))_*_3)] motion-safe:not-data-readonly:data-pressing:scale-[calc(1_-_(1_-_var(--motion-press-scale))_*_3)] motion-safe:[label:active:not(:has([data-disabled],[data-readonly]))_&]:scale-[calc(1_-_(1_-_var(--motion-press-scale))_*_3)] motion-safe:not-data-disabled:not-data-readonly:[[data-choice-card]:active_&]:scale-[calc(1_-_(1_-_var(--motion-press-scale))_*_3)] motion-safe:not-data-disabled:not-data-readonly:[[data-choice-card][data-pressing]_&]:scale-[calc(1_-_(1_-_var(--motion-press-scale))_*_3)] motion-safe:[[data-slot=field]:has(>[data-slot=field-label]:active):not(:has([data-disabled],[data-readonly]))_&]:scale-[calc(1_-_(1_-_var(--motion-press-scale))_*_3)]`

/** The primary fill of a box that is ticked or mixed, kept in forced colours. */
const choiceFilledClassName =
  'data-checked:border-primary data-checked:bg-primary data-indeterminate:border-primary data-indeterminate:bg-primary dark:data-checked:bg-primary dark:data-indeterminate:bg-primary forced-colors:data-checked:bg-[Highlight]! forced-colors:data-indeterminate:bg-[Highlight]!'

/** A Checkbox's box: a small corner, filled with the primary colour while ticked or mixed. */
export const choiceCheckboxClassName = `rounded-[min(calc(var(--control-radius-xs)/2),6px)] ${choiceFilledClassName}`

/**
 * A mark that shows a state but takes no press, such as a rule a password has
 * met: a Checkbox's box at rest and its fill, round so it never reads as a box
 * to tick. Mark it `group/checkbox` and `data-checked` for a `CheckboxMark`
 * inside.
 */
export const choiceMarkBoxClassName = `inline-flex shrink-0 items-center rounded-full ${choiceBoxLookClassName} ${choiceFilledClassName} transition-[background-color,border-color] duration-(--motion-press-duration) ease-(--motion-press-fade-easing)`

type PressHandlers<K, F> = {
  onKeyDown?: (event: K) => void
  onKeyUp?: (event: K) => void
  onBlur?: (event: F) => void
}

/**
 * Marks a choice `data-pressing` while Space is held on it, which CSS can't
 * see, so a key press shows the same way a pointer's does. Each handler also
 * calls the one passed in.
 */
export function choicePressHandlers<
  K extends KeyboardEvent<Element>,
  F extends FocusEvent<Element>,
>({ onKeyDown, onKeyUp, onBlur }: PressHandlers<K, F>): Required<PressHandlers<K, F>> {
  return {
    onKeyDown: (event) => {
      if (event.key === ' ') event.currentTarget.setAttribute('data-pressing', '')
      onKeyDown?.(event)
    },
    onKeyUp: (event) => {
      event.currentTarget.removeAttribute('data-pressing')
      onKeyUp?.(event)
    },
    onBlur: (event) => {
      event.currentTarget.removeAttribute('data-pressing')
      onBlur?.(event)
    },
  }
}

/** A mark that wipes in along the reading direction on the draw role, and is simply there under reduced motion. */
export const choiceWipeClassName =
  'transition-[clip-path] duration-(--motion-draw-duration) ease-(--motion-draw-easing) [clip-path:inset(0_100%_0_0)] motion-reduce:transition-none rtl:[clip-path:inset(0_0_0_100%)]'

/**
 * A part marked `data-pressing` while held, such as a Rating's star, which
 * holds no box of its own: it shrinks as a held box does, by three times the
 * feel's press scale, quickly on the way down and back on the press role.
 */
export const choicePressingClassName =
  'transition-[scale] duration-(--motion-press-duration) ease-(--motion-press-easing) data-pressing:duration-[calc(var(--motion-press-duration)*0.4)] motion-safe:data-pressing:scale-[calc(1_-_(1_-_var(--motion-press-scale))_*_3)]'

/**
 * A card that is the choice itself, as in Radio cards and Checkbox cards: the
 * whole card takes the press, the focus ring and the invalid ring, and its
 * border turns primary while it is picked. Its surface is drawn behind it
 * (`before:`), so its tint (`choiceCardFloodClassName`) shows on it. Muted text darkens on a
 * picked card, which is tinted, to keep 4.5:1. Disabled, its content fades
 * and it takes no press.
 */
export const choiceCardClassName =
  'relative flex min-w-0 cursor-pointer flex-col gap-1 rounded-(--surface-radius) border p-(--surface-padding) text-start text-sm shadow-xs outline-offset-2 transition-[border-color,box-shadow] duration-(--motion-press-duration) ease-(--motion-press-fade-easing) select-none before:absolute before:inset-0 before:-z-1 before:rounded-[inherit] before:bg-card before:transition-[background-color] before:duration-(--motion-press-duration) before:ease-(--motion-press-fade-easing) not-data-checked:not-data-disabled:not-data-readonly:not-aria-invalid:hover:border-muted-foreground/50 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-hidden data-checked:border-primary data-checked:[--muted-foreground:color-mix(in_oklab,var(--foreground)_70%,var(--background))] forced-colors:data-checked:border-[Highlight] aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 forced-colors:aria-invalid:outline-2 forced-colors:aria-invalid:outline-dashed dark:aria-invalid:ring-destructive/40 data-disabled:cursor-not-allowed data-disabled:shadow-none data-disabled:*:opacity-50 data-readonly:cursor-default'

/**
 * A card's tint, as the card's first child, over its surface and under its
 * border and content. Picked, it spreads from the card's flood point (see
 * `choiceCardFloodHandlers`) until it fills the card; cleared, it drains back
 * there. Under reduced motion it fades in place.
 */
export const choiceCardFloodClassName =
  // 150% of the circle's reference reaches every corner from anywhere inside the card.
  'pointer-events-none absolute inset-0 -z-1 rounded-[inherit] bg-primary/5 dark:bg-primary/10 [clip-path:circle(0_at_var(--flood-x,50%)_var(--flood-y,50%))] [[data-checked]>&]:[clip-path:circle(150%_at_var(--flood-x,50%)_var(--flood-y,50%))] transition-[clip-path] duration-(--motion-exit-duration) ease-(--motion-exit-easing) [[data-checked]>&]:duration-(--motion-enter-duration) [[data-checked]>&]:ease-(--motion-enter-easing) motion-reduce:opacity-0 motion-reduce:transition-[opacity] motion-reduce:[clip-path:none] motion-reduce:[[data-checked]>&]:opacity-100'

type FloodHandlers<P, F, K> = {
  onPointerDown?: (event: P) => void
  onFocus?: (event: F) => void
  onKeyDown?: (event: K) => void
}

/**
 * Sets where a card's tint spreads from, or drains to: where the pointer
 * presses it, or its indicator when Space picks it or the keyboard moves
 * focus onto it, as arrow keys do in a radio group. Each handler also calls
 * the one passed in.
 */
export function choiceCardFloodHandlers<
  P extends PointerEvent<HTMLElement>,
  F extends FocusEvent<HTMLElement>,
  K extends KeyboardEvent<HTMLElement>,
>({
  onPointerDown,
  onFocus,
  onKeyDown,
}: FloodHandlers<P, F, K>): Required<FloodHandlers<P, F, K>> {
  return {
    onPointerDown: (event) => {
      floodFrom(event.currentTarget, event)
      onPointerDown?.(event)
    },
    onFocus: (event) => {
      if (event.currentTarget.matches(':focus-visible')) {
        floodFrom(event.currentTarget, indicatorCentre(event.currentTarget))
      }
      onFocus?.(event)
    },
    onKeyDown: (event) => {
      if (event.key === ' ') {
        floodFrom(event.currentTarget, indicatorCentre(event.currentTarget))
      }
      onKeyDown?.(event)
    },
  }
}

/**
 * Puts a card's flood point at a point in its box, in px. It lands at once, so
 * the tint grows from it rather than gliding to it; while the tint still
 * moves, it keeps its point, so a press that turns it back turns it back
 * where it is.
 */
function floodFrom(card: HTMLElement, point: { clientX: number; clientY: number }) {
  const flood = card.querySelector<HTMLElement>(':scope > [data-slot$=-card-flood]')
  if (!flood || flood.getAnimations().length > 0) return
  const box = card.getBoundingClientRect()
  withoutTransition(flood, () => {
    card.style.setProperty('--flood-x', `${point.clientX - box.left}px`)
    card.style.setProperty('--flood-y', `${point.clientY - box.top}px`)
  })
}

/** The middle of the card's indicator, or of the card when it has none. */
function indicatorCentre(card: HTMLElement) {
  const box = (
    card.querySelector('[data-slot$=-card-indicator]') ?? card
  ).getBoundingClientRect()
  return { clientX: box.left + box.width / 2, clientY: box.top + box.height / 2 }
}

/** A card's title: the choice's name. */
export const choiceCardTitleClassName = 'font-medium text-pretty'

/** A card's description, under its title. */
export const choiceCardDescriptionClassName = 'text-muted-foreground text-pretty'

/** The ids a card names and describes itself by, from its title and description. */
export const ChoiceCardContext = createContext<{
  title: string
  description: string
}>({
  title: '',
  description: '',
})
