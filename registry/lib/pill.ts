/*
 * The look a row of choices shares, so the Tabs and the Segmented control
 * read as one family: a muted track, labels that darken on hover, a backdrop
 * that glides under the pointer, and a pill in the primary colour that
 * slides to the pick.
 */

/**
 * The track. Its 3px inset is shadcn's own: the pill covers it, so a spring
 * that overshoots at the first or last item still has room. Give it a
 * layout, with `pillRowClassName` inside.
 */
export const pillTrackClassName = 'bg-muted overflow-hidden rounded-(--list-radius)'

/** The row of items, and the pill's copy of it, so every label sits exactly on its twin. */
export const pillRowClassName = 'gap-0.5 p-[3px]'

/**
 * An item: the control height less the track's inset on both sides, so the
 * track is as tall as a button. Its corner is the pill's, inside the
 * track's by about the inset, so its focus ring, the backdrop (which takes
 * the item's corners) and the pill share one shape.
 */
export const pillItemLayout =
  "inline-flex h-[calc(var(--control-height)_-_6px)] items-center justify-center gap-1.5 rounded-[max(0px,calc(var(--list-radius)-2px))] px-[calc(var(--control-padding)_+_2px)] text-sm font-medium whitespace-nowrap select-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"

/**
 * An item's label colours and focus ring. A disabled item fades its label,
 * not itself, so its focus ring keeps its strength. Read-only items don't
 * answer hover. Forced colours drop the fade, so a disabled item there takes
 * the system's GrayText.
 */
export const pillItemClassName =
  'text-foreground/60 focus-visible:ring-ring/50 transition-[color,box-shadow] duration-(--motion-press-duration) ease-(--motion-press-fade-easing) not-data-disabled:not-data-readonly:hover:text-foreground focus-visible:ring-3 focus-visible:outline-hidden not-data-disabled:focus-visible:text-foreground data-disabled:text-foreground/30 forced-colors:data-disabled:text-[GrayText]'

/** The backdrop under the pointer: give it `highlightClassName`. */
export const pillBackdropClassName = 'bg-foreground/8 -z-10'

/**
 * The pill and the labels it holds. Its colour reaches past its box, so a
 * spring that overshoots the first or last item keeps its round corners up
 * to the track's edge. Forced colours drop backgrounds and shadows, so there
 * it takes the system's highlight.
 */
export const pillClassName =
  'bg-primary text-primary-foreground shadow-[0_0_0_0.5rem_var(--primary)] forced-colors:bg-[Highlight] forced-colors:text-[HighlightText] forced-colors:forced-color-adjust-none'
