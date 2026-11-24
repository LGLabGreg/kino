'use client'

import { flowItemClassName, useFlow } from '@/registry/lib/flow'
import { markMounted, mergeRefs } from '@/registry/lib/refs'
import {
  type StepStatus,
  stepDotClassName,
  stepLineClassName,
  stepLineFillClassName,
  stepStatusText,
  stepTileClassName,
} from '@/registry/lib/step'
import { Swap } from '@/registry/lib/swap'
import { mergeProps } from '@base-ui/react/merge-props'
import { useRender } from '@base-ui/react/use-render'
import type { ComponentProps } from 'react'

import { cn } from '@/lib/utils'

/*
 * Events in order, each with a marker on a rail at the start edge and its
 * title, time and details beside it. A marker is a dot, or whatever it holds:
 * an icon in a circle, an avatar. A line joins each marker to the next,
 * leaving a little room around both.
 *
 * `status` reads a timeline as steps: a complete step's marker fills and the
 * line out of it fills along its length on `draw`; the current one is ringed
 * and lights once the line reaching it has filled; an upcoming one is hollow.
 * A step that failed takes the destructive colour, its dot a diamond, and one
 * skipped is hollow, its title struck through.
 *
 * When an event comes or goes, the others glide to their new places on
 * `layout` (`followFlow`) while the timeline follows its height: one that
 * arrives fades in on `enter` as its marker grows into place and its line
 * draws down to the next, and one that goes fades where it was on `exit`.
 * Nothing moves when the page loads.
 *
 * The `split` variant centres the rail, with what happened on one side and
 * an aside on the other (a date, a version, a quarter); in a box narrower
 * than 28rem it goes back to a rail at the start, the aside above the title.
 */

type TimelineStatus = StepStatus

/**
 * `className` is for the list itself, as `<ol>`'s; `containerClassName` for
 * the box around it, which follows the list's height as events come and go.
 * Name it with `aria-label` or `aria-labelledby`.
 */
function Timeline({
  className,
  containerClassName,
  variant = 'default',
  ref,
  ...props
}: ComponentProps<'ol'> & {
  containerClassName?: string
  /**
   * `split` puts each event's `TimelineAside` on the other side of a centred
   * rail. It fills its parent's width, so it doesn't sit in a box that sizes
   * to its content.
   */
  variant?: 'default' | 'split'
}) {
  const { frame, row } = useFlow<HTMLDivElement, HTMLOListElement>(
    '[data-slot=timeline-item]',
  )
  return (
    <div
      ref={frame}
      data-slot='timeline'
      className={cn(
        // A current marker's ring reaches past the list's edge.
        'bg-inherit [overflow-clip-margin:0.25rem] overflow-clip transition-[height] duration-(--motion-layout-duration) ease-(--motion-layout-easing) motion-reduce:transition-none',
        // Split reads its own width, so it fills its parent's: in a flex
        // box, a container sized by its content would have none.
        variant === 'split' && '@container/timeline w-full',
        containerClassName,
      )}
    >
      <ol
        ref={mergeRefs(row, markMounted, ref)}
        data-slot='timeline-list'
        data-variant={variant}
        className={cn(
          'group/timeline group/flow relative isolate flex flex-col gap-(--timeline-gap) bg-inherit [--timeline-gap:var(--surface-gap)] [--timeline-marker:var(--control-height-xs)]',
          className,
        )}
        {...props}
      />
    </div>
  )
}

/**
 * One event. `status` makes it a step: `complete`, `current`, `upcoming`,
 * `error` or `skipped`, which its marker shows and a screen reader reads before its title
 * (`aria-current='step'` for the current one). Left out, it is an event that
 * happened.
 */
function TimelineItem({
  className,
  status,
  render,
  children,
  ...props
}: useRender.ComponentProps<'li'> & { status?: TimelineStatus }) {
  return useRender({
    defaultTagName: 'li',
    props: mergeProps<'li'>(
      {
        'aria-current': status === 'current' ? 'step' : undefined,
        className: cn(
          'group/timeline-item group/step relative grid grid-cols-[var(--timeline-marker)_minmax(0,1fr)] content-start gap-x-(--control-padding) bg-inherit @md/timeline:group-data-[variant=split]/timeline:grid-cols-[minmax(0,1fr)_var(--timeline-marker)_minmax(0,1fr)]',
          // It glides to a new place on `layout` (`followFlow`), fades in on
          // `enter` once the timeline has painted, and its copy fades on
          // `exit` (`flowItemClassName`).
          flowItemClassName,
          // How far its marker, and the next one, sit inside the rail's
          // column: a dot is smaller than the column, an icon fills it.
          '[--timeline-inset:0px] [&:has(>[data-slot=timeline-marker][data-dot])]:[--timeline-inset:calc((var(--timeline-marker)-0.625rem)/2)]',
          '[&:has(+[data-slot=timeline-item]>[data-slot=timeline-marker][data-dot])]:[--timeline-next-inset:calc((var(--timeline-marker)-0.625rem)/2)] [&:has(+[data-slot=timeline-item]>[data-slot=timeline-marker]:not([data-dot]))]:[--timeline-next-inset:0px]',
          // The last event has no line out of it, not counting the copies of
          // events that leave.
          // A current step after another lights once the line reaching it looks
          // arrived, halfway through `draw` (the step lib's STEP_ARRIVAL).
          'motion-safe:[[data-slot=timeline-item]~&[data-status=current]]:[--step-wait:calc(var(--motion-draw-duration)*0.5)]',
          '[--timeline-line:1] [&:not(:has(~[data-slot=timeline-item]:not([data-leaving])))]:[--timeline-line:0]',
          className,
        ),
        children: (
          <>
            {status && stepStatusText[status] ? (
              <span className='sr-only'>{stepStatusText[status]}</span>
            ) : null}
            {children}
            <TimelineLine />
          </>
        ),
      },
      props,
    ),
    render,
    state: { slot: 'timeline-item', status },
  })
}

/**
 * The line from an event's marker to the next one's, 4px clear of each. It
 * draws down on `draw` as an event arrives or one is added after it, and
 * fills the same way once its event is complete.
 */
function TimelineLine() {
  return (
    <span
      aria-hidden
      data-slot='timeline-line'
      className={cn(
        stepLineClassName,
        'absolute start-[calc(var(--timeline-marker)/2-0.5px)] @md/timeline:group-data-[variant=split]/timeline:start-[calc(50%-0.5px)] top-[calc(var(--timeline-marker)-var(--timeline-inset)+0.25rem)] -bottom-[calc(var(--timeline-gap)+var(--timeline-next-inset,var(--timeline-inset))-0.25rem)] w-px origin-top scale-y-(--timeline-line) transition-[scale] duration-(--motion-draw-duration) ease-(--motion-draw-easing) motion-reduce:transition-none group-data-mounted/timeline:starting:scale-y-0',
      )}
    >
      <span
        className={cn(
          stepLineFillClassName,
          'origin-top scale-y-0 group-data-[status=complete]/timeline-item:scale-y-100',
        )}
      />
    </span>
  )
}

/**
 * The event's mark on the rail: a dot, or an icon or an avatar given as its
 * children, in a circle the rail's width. A new icon, such as a step's
 * spinner becoming a tick, crossfades in place (`Swap`). Decorative: the title says what
 * happened.
 */
function TimelineMarker({
  className,
  render,
  children,
  ...props
}: useRender.ComponentProps<'span'>) {
  const dot = children === undefined || children === null || children === false
  return useRender({
    defaultTagName: 'span',
    props: mergeProps<'span'>(
      {
        'aria-hidden': true,
        className: cn(
          'relative z-10 col-start-1 row-start-1 flex size-(--timeline-marker) items-center justify-center @md/timeline:group-data-[variant=split]/timeline:col-start-2',
          className,
        ),
        children: (
          <span
            className={cn(
              'flex items-center justify-center',
              dot ? stepDotClassName : stepTileClassName,
              'motion-safe:group-data-mounted/timeline:starting:scale-50',
            )}
          >
            {dot ? null : <Swap>{children}</Swap>}
          </span>
        ),
      },
      props,
    ),
    render,
    state: { slot: 'timeline-marker', dot },
  })
}

/** What happened: the header, then any details, a quote or a card. */
function TimelineContent({
  className,
  render,
  ...props
}: useRender.ComponentProps<'div'>) {
  return useRender({
    defaultTagName: 'div',
    props: mergeProps<'div'>(
      {
        className: cn(
          'col-start-2 flex min-w-0 flex-col gap-1 [[data-slot=timeline-item]:has(>[data-slot=timeline-aside])>&]:row-start-2 @md/timeline:group-data-[variant=split]/timeline:col-start-3 @md/timeline:group-data-[variant=split]/timeline:row-start-1!',
          className,
        ),
      },
      props,
    ),
    render,
    state: { slot: 'timeline-content' },
  })
}

/** The title and the time on one line, its first line level with the marker; the time wraps under a long title. */
function TimelineHeader({
  className,
  render,
  ...props
}: useRender.ComponentProps<'div'>) {
  return useRender({
    defaultTagName: 'div',
    props: mergeProps<'div'>(
      {
        className: cn(
          'flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 py-[calc((var(--timeline-marker)-1.25rem)/2)]',
          className,
        ),
      },
      props,
    ),
    render,
    state: { slot: 'timeline-header' },
  })
}

/** Muted while upcoming, destructive on an error, and struck through when skipped. A long unbroken word breaks rather than run out of the box. */
function TimelineTitle({ className, render, ...props }: useRender.ComponentProps<'div'>) {
  return useRender({
    defaultTagName: 'div',
    props: mergeProps<'div'>(
      {
        className: cn(
          'min-w-0 text-sm leading-5 font-medium wrap-anywhere group-data-[status=error]/timeline-item:text-destructive group-data-[status=skipped]/timeline-item:text-muted-foreground group-data-[status=skipped]/timeline-item:line-through group-data-[status=upcoming]/timeline-item:text-muted-foreground',
          className,
        ),
      },
      props,
    ),
    render,
    state: { slot: 'timeline-title' },
  })
}

/**
 * What sits on the rail's other side in the `split` variant, level with the
 * title and against the rail: a date, a version, a quarter. Elsewhere it
 * sits above the title, beside the marker.
 */
function TimelineAside({ className, render, ...props }: useRender.ComponentProps<'div'>) {
  return useRender({
    defaultTagName: 'div',
    props: mergeProps<'div'>(
      {
        className: cn(
          'text-muted-foreground col-start-2 row-start-1 flex min-w-0 flex-col *:max-w-full [&_[data-slot=timeline-time]]:whitespace-normal py-[calc((var(--timeline-marker)-1.25rem)/2)] text-sm leading-5 wrap-anywhere tabular-nums @md/timeline:group-data-[variant=split]/timeline:col-start-1 @md/timeline:group-data-[variant=split]/timeline:items-end @md/timeline:group-data-[variant=split]/timeline:text-end',
          className,
        ),
      },
      props,
    ),
    render,
    state: { slot: 'timeline-aside' },
  })
}

/** When it happened, as a `<time>`: give `dateTime` the machine-readable date. */
function TimelineTime({ className, render, ...props }: useRender.ComponentProps<'time'>) {
  return useRender({
    defaultTagName: 'time',
    props: mergeProps<'time'>(
      {
        className: cn(
          'text-muted-foreground shrink-0 text-xs leading-5 whitespace-nowrap tabular-nums',
          className,
        ),
      },
      props,
    ),
    render,
    state: { slot: 'timeline-time' },
  })
}

function TimelineDescription({
  className,
  render,
  ...props
}: useRender.ComponentProps<'p'>) {
  return useRender({
    defaultTagName: 'p',
    props: mergeProps<'p'>(
      {
        className: cn(
          'text-muted-foreground text-sm text-pretty wrap-anywhere *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground',
          className,
        ),
      },
      props,
    ),
    render,
    state: { slot: 'timeline-description' },
  })
}

export {
  Timeline,
  TimelineAside,
  TimelineContent,
  TimelineDescription,
  TimelineHeader,
  TimelineItem,
  TimelineMarker,
  TimelineTime,
  TimelineTitle,
}
export type { TimelineStatus }
