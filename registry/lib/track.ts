import type { CSSProperties } from 'react'

/**
 * The thin track that Slider, Progress and Meter share, and the parts around
 * it, so a value reads the same way in all three: the column, the row of
 * label and value above the track, the track and its fill. Each adds how its
 * fill moves: the Slider clips it between its thumbs, Progress and Meter
 * slide it in from the start.
 */

/** Where `value` sits between `min` and `max`, from 0 to 100; 0 when it is unknown. */
export function valuePercent(value: number | null, min: number, max: number) {
  if (value === null || !Number.isFinite(value) || max <= min) return 0
  return Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100))
}

/** `--track-dir`: 1, or -1 right to left, for what moves along a track or across an area. */
export const trackDirClassName = '[--track-dir:1] rtl:[--track-dir:-1]'

/** The column the header and track sit in, with `--track-dir` for what moves along it. */
export const trackRootClassName = `flex w-full min-w-0 flex-col gap-2 ${trackDirClassName}`

/** The row above the track: the label, then the value at its end. */
export const trackHeaderClassName = 'flex min-w-0 items-baseline gap-3 text-sm'

/** The label: a long one wraps, so the whole of it shows. */
export const trackLabelClassName = 'min-w-0 flex-1 font-medium wrap-break-word'

/**
 * In forced colours the muted background goes, so an outline keeps the
 * track's length visible. An outline takes no room, so the fill keeps its place.
 */
export const trackClassName =
  'bg-muted relative h-1.5 w-full rounded-full forced-colors:outline'

/**
 * A thumb's dot, inside a 24px thumb marked `group/thumb`: the Slider's, and
 * a colour area's. Held or dragged (`data-dragging`), it shrinks by three
 * times the feel's press scale, as a Checkbox does; hovered or focused, it
 * takes a ring. Its look comes from a variant: the Slider's own, or a colour
 * channel's.
 */
export const thumbDotClassName =
  'block rounded-full border-2 transition-[box-shadow,scale] duration-(--motion-press-duration) ease-[var(--motion-press-fade-easing),var(--motion-press-easing)] group-active/thumb:duration-[calc(var(--motion-press-duration)*0.4)] motion-safe:group-active/thumb:scale-[calc(1_-_(1_-_var(--motion-press-scale))_*_3)] motion-safe:group-data-dragging/thumb:scale-[calc(1_-_(1_-_var(--motion-press-scale))_*_3)] group-hover/thumb:ring-ring/30 group-hover/thumb:ring-4 group-has-focus-visible/thumb:ring-ring/50 group-has-focus-visible/thumb:ring-4 forced-colors:group-has-focus-visible/thumb:outline-2 forced-colors:group-has-focus-visible/thumb:outline-[Highlight]'

/**
 * A colour channel's dot: filled with `--slider-thumb`, the colour under it,
 * ringed in white and a hairline shadow so it stands out on any colour, in
 * either theme, and kept in forced colours.
 */
export const channelThumbClassName =
  'size-5 border-white bg-(--slider-thumb) shadow-[0_0_0_1px_rgb(0_0_0/0.2),0_1px_3px_rgb(0_0_0/0.25)] forced-color-adjust-none'

/** In forced colours the fill takes the system highlight whatever colour a state gives it, since backgrounds go. */
export const trackFillClassName =
  'bg-primary absolute inset-y-0 rounded-full forced-colors:bg-[Highlight]!'

/**
 * A fill as wide as the track that slides in from the start, so it draws on
 * the compositor and its end stays round. Its track clips it.
 */
export const slidingFillClassName =
  'bg-primary absolute inset-y-0 rounded-full transition-[background-color,translate] duration-(--motion-draw-duration) ease-[var(--motion-draw-fade-easing),var(--motion-draw-easing)] motion-reduce:transition-[background-color] motion-reduce:ease-(--motion-draw-fade-easing) forced-colors:bg-[Highlight]!'

/**
 * Places a sliding fill at `percent`. Base UI sizes a fill with `width`, which
 * motion.md won't let us animate; this style wins over Base UI's.
 */
export function slidingFillStyle(percent: number): CSSProperties {
  return {
    insetInlineStart: 0,
    width: '100%',
    translate: `calc(var(--track-dir) * ${percent - 100}%) 0`,
  }
}
