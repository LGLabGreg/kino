import { cn } from '@/lib/utils'

/*
 * What a step's marker looks like by its status, shared by the Timeline and
 * the Stepper so a step reads the same in both: complete fills, current is
 * ringed, upcoming is hollow, and an error takes the destructive colour.
 * Each reads `data-status` on the step that carries `group/step`, and waits
 * `--step-wait` before its colours move, so a marker can light once the line
 * reaching it has filled.
 */

type StepStatus = 'complete' | 'current' | 'upcoming' | 'error'

/** What a step's status reads as, before its title; the current one is `aria-current='step'` instead. */
const stepStatusText: Partial<Record<StepStatus, string>> = {
  complete: 'Completed',
  upcoming: 'Upcoming',
  error: 'Error',
}

/** Its colours move on `morph` after `--step-wait`; one that arrives grows into place on `enter` (`starting:` in the component). */
const stepMarkerTransition =
  '[transition:background-color_var(--motion-morph-duration)_var(--motion-morph-fade-easing)_var(--step-wait,0s),border-color_var(--motion-morph-duration)_var(--motion-morph-fade-easing)_var(--step-wait,0s),box-shadow_var(--motion-morph-duration)_var(--motion-morph-fade-easing)_var(--step-wait,0s),color_var(--motion-morph-duration)_var(--motion-morph-fade-easing)_var(--step-wait,0s),scale_var(--motion-enter-duration)_var(--motion-enter-easing)] motion-reduce:[transition-property:background-color,border-color,box-shadow,color]'

const currentRing =
  'group-data-[status=current]/step:ring-primary/20 group-data-[status=current]/step:ring-3 forced-colors:group-data-[status=current]/step:outline-2 forced-colors:group-data-[status=current]/step:outline-offset-1 forced-colors:group-data-[status=current]/step:outline-[Highlight]'

/** A dot by status: filled when complete, ringed when current, hollow when upcoming. */
const stepDotClassName = cn(
  'bg-muted-foreground/60 size-2.5 rounded-full border-2 border-transparent forced-colors:bg-[CanvasText]',
  'group-data-[status=complete]/step:bg-primary forced-colors:group-data-[status=complete]/step:bg-[Highlight]',
  'group-data-[status=current]/step:bg-background group-data-[status=current]/step:border-primary forced-colors:group-data-[status=current]/step:border-[Highlight] forced-colors:group-data-[status=current]/step:bg-[Canvas]',
  currentRing,
  'group-data-[status=upcoming]/step:bg-background group-data-[status=upcoming]/step:border-muted-foreground/50 forced-colors:group-data-[status=upcoming]/step:border-[CanvasText] forced-colors:group-data-[status=upcoming]/step:bg-[Canvas]',
  'group-data-[status=error]/step:bg-destructive forced-colors:group-data-[status=error]/step:bg-[CanvasText]',
  stepMarkerTransition,
)

/** A circle that holds an icon, a number or an avatar, by status as a dot is: filled, ringed, hollow and dashed, or destructive. */
const stepTileClassName = cn(
  "bg-muted text-muted-foreground size-full overflow-hidden rounded-full border border-transparent [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5 forced-colors:border-[CanvasText]",
  'group-data-[status=complete]/step:bg-primary group-data-[status=complete]/step:text-primary-foreground',
  'group-data-[status=current]/step:bg-background group-data-[status=current]/step:text-foreground group-data-[status=current]/step:border-primary forced-colors:group-data-[status=current]/step:border-[Highlight]',
  currentRing,
  'group-data-[status=upcoming]/step:bg-background group-data-[status=upcoming]/step:border-border group-data-[status=upcoming]/step:border-dashed',
  'group-data-[status=error]/step:bg-background group-data-[status=error]/step:text-destructive group-data-[status=error]/step:border-destructive forced-colors:group-data-[status=error]/step:border-dashed',
  stepMarkerTransition,
)

/** The hairline between two steps, and the fill that draws along it once the first is done. */
const stepLineClassName = 'bg-border pointer-events-none forced-colors:bg-[CanvasText]'
const stepLineFillClassName =
  'bg-primary absolute inset-0 transition-[scale] duration-(--motion-draw-duration) ease-(--motion-draw-easing) motion-reduce:transition-none forced-colors:bg-[Highlight]'

/**
 * A line on `draw` looks arrived about halfway through the role's duration,
 * which runs on to when its spring is at rest, so what follows it starts then.
 */
const STEP_ARRIVAL = 0.5

/**
 * How a step joins a move from step `from` to step `to`, in fractions of the
 * `draw` role's duration, so a move of any length takes as long as one step:
 * each line between the two fills (or, going back, empties from the far end)
 * in its share of the time, starting as the one before it arrives, and each
 * marker on the way changes once the line reaching it has arrived (or, going
 * back, the line out of it has gone). A step outside the move, and every
 * step when nothing moved, waits for nothing.
 */
function stepTiming(
  step: number,
  from: number,
  to: number,
): { lineDelay: number; lineSpan: number; markerWait: number } {
  const count = Math.abs(to - from)
  if (count === 0) return { lineDelay: 0, lineSpan: 1, markerWait: 0 }
  const lineSpan = 1 / count
  const turn = STEP_ARRIVAL / count
  const low = Math.min(from, to)
  const high = Math.max(from, to)
  const lineMoves = step >= low && step < high
  if (to > from) {
    return {
      lineDelay: lineMoves ? (step - from) * turn : 0,
      lineSpan: lineMoves ? lineSpan : 1,
      markerWait: step > from && step <= to ? (step - from) * turn : 0,
    }
  }
  return {
    lineDelay: lineMoves ? (from - 1 - step) * turn : 0,
    lineSpan: lineMoves ? lineSpan : 1,
    markerWait: step >= to && step < from ? (from - step) * turn : 0,
  }
}

export {
  stepDotClassName,
  stepLineClassName,
  stepLineFillClassName,
  stepMarkerTransition,
  stepStatusText,
  stepTileClassName,
  stepTiming,
}
export type { StepStatus }
