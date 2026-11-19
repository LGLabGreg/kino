/*
 * The look of content that is still loading: a faint tint of the text colour
 * that breathes slowly while it waits. The Skeleton draws it, and so do the
 * charts' placeholders, so everything that waits on data looks the same.
 *
 * The breath is a loop on opacity alone, timed by the `layout` role at an even
 * pace (motion rule 8), so it runs off the main thread. It keeps breathing
 * under reduced motion, since nothing travels.
 */

/** The fill: a tint of the text colour, and GrayText in forced colours. */
export const placeholderFillClassName =
  'bg-foreground/8 dark:bg-foreground/12 forced-colors:bg-[GrayText]!'

/** The slow breath. */
export const placeholderBreatheClassName =
  'animate-[pulse_calc(var(--motion-layout-duration)*6)_ease-in-out_infinite]'
