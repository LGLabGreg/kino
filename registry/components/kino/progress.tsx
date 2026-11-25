'use client'

import { Spinner } from '@/registry/components/kino/spinner'
import { IconPlaceholder } from '@/registry/icons/icon-placeholder'
import {
  slidingFillClassName,
  slidingFillStyle,
  trackClassName,
  trackFillClassName,
  trackHeaderClassName,
  trackLabelClassName,
  trackRootClassName,
  valuePercent,
} from '@/registry/lib/track'
import { Progress as ProgressPrimitive } from '@base-ui/react/progress'
import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

type ProgressProps = Omit<ProgressPrimitive.Root.Props, 'className'> & {
  className?: string
  /** `destructive` for a task that failed: the fill turns red and stops looking live. */
  variant?: 'default' | 'destructive'
  /** Names a progress that has no `ProgressLabel`. */
  'aria-label'?: string
  /** The label and value, in a row above the track. */
  children?: ReactNode
}

function Progress({
  className,
  children,
  value,
  min = 0,
  max = 100,
  variant = 'default',
  ...props
}: ProgressProps) {
  const percent = valuePercent(value, min, max)
  // Live once it has started, until it ends or fails.
  const running = percent > 0 && percent < 100 && variant === 'default'
  return (
    <ProgressPrimitive.Root
      data-slot='progress'
      data-variant={variant}
      data-live={running || undefined}
      value={value}
      min={min}
      max={max}
      className={cn(trackRootClassName, 'group/progress', className)}
      {...props}
    >
      {children ? (
        <div data-slot='progress-header' className={trackHeaderClassName}>
          {children}
        </div>
      ) : null}
      <ProgressPrimitive.Track
        data-slot='progress-track'
        className={cn(trackClassName, 'overflow-hidden')}
      >
        <ProgressPrimitive.Indicator
          data-slot='progress-indicator'
          style={slidingFillStyle(percent)}
          className={cn(
            slidingFillClassName,
            'data-[variant=destructive]:bg-destructive',
          )}
          data-variant={variant}
        >
          {/* Live while it runs: a sheen sweeps the fill. It pauses where it is and fades once the task ends. */}
          <span
            aria-hidden
            className='via-primary-foreground/35 pointer-events-none absolute inset-y-0 start-0 w-[30%] animate-[kino-progress-sheen_calc(var(--motion-layout-duration)*5)_linear_infinite] bg-linear-to-r from-transparent to-transparent opacity-0 transition-opacity duration-(--motion-exit-duration) ease-(--motion-exit-easing) [animation-play-state:paused] group-data-live/progress:opacity-100 group-data-live/progress:[animation-play-state:running] motion-reduce:hidden forced-colors:hidden rtl:bg-linear-to-l'
          />
        </ProgressPrimitive.Indicator>
        {/* Unknown length: a piece of the fill slides across. It pauses where it is and fades as the real fill draws in. */}
        <span
          aria-hidden
          data-slot='progress-indeterminate'
          className={cn(
            trackFillClassName,
            'start-0 w-2/5 animate-[kino-progress-slide_calc(var(--motion-layout-duration)*4)_ease-in-out_infinite] rounded-full opacity-0 transition-opacity duration-(--motion-exit-duration) ease-(--motion-exit-easing) [animation-play-state:paused] group-data-indeterminate/progress:opacity-100 group-data-indeterminate/progress:duration-(--motion-enter-duration) group-data-indeterminate/progress:[animation-play-state:running] motion-reduce:w-full motion-reduce:animate-none motion-reduce:group-data-indeterminate/progress:animate-pulse',
          )}
        />
      </ProgressPrimitive.Track>
    </ProgressPrimitive.Root>
  )
}

function ProgressLabel({
  className,
  ...props
}: Omit<ProgressPrimitive.Label.Props, 'className'> & { className?: string }) {
  return (
    <ProgressPrimitive.Label
      data-slot='progress-label'
      className={cn(trackLabelClassName, className)}
      {...props}
    />
  )
}

type ProgressValueProps = Omit<
  ProgressPrimitive.Value.Props,
  'children' | 'className'
> & {
  className?: string
  /** Writes the value yourself, such as `512 of 1,284`. Not called while the value is unknown. */
  children?: (formattedValue: string, value: number) => ReactNode
  /** What it says beside a tick once the task is complete. */
  completeLabel?: ReactNode
}

/**
 * The value, at the end of the row. Once the task completes, it leaves and a
 * tick with `completeLabel` takes its place. Both sit in one grid cell, so
 * the change moves nothing beside it.
 */
function ProgressValue({
  className,
  children,
  completeLabel = 'Done',
  ...props
}: ProgressValueProps) {
  return (
    <ProgressPrimitive.Value
      data-slot='progress-value'
      className={cn(
        'text-muted-foreground ms-auto grid shrink-0 justify-items-end',
        className,
      )}
      {...props}
    >
      {(formatted, value) => {
        // Base UI writes "indeterminate" while the value is unknown; the row shows nothing then.
        const text =
          value === null ? null : children ? children(formatted ?? '', value) : formatted
        return (
          <>
            <span className='col-start-1 row-start-1 tabular-nums transition-[opacity,translate] duration-(--motion-exit-duration) ease-(--motion-exit-easing) group-data-complete/progress:-translate-y-(--progress-value-roll,0.375rem) group-data-complete/progress:opacity-0 group-data-[variant=destructive]/progress:translate-y-0 group-data-[variant=destructive]/progress:opacity-100 motion-reduce:translate-y-0'>
              {text || ' '}
            </span>
            <span className="text-foreground col-start-1 row-start-1 inline-flex translate-y-(--progress-value-roll,0.375rem) items-center gap-1 font-medium opacity-0 transition-[opacity,translate] duration-(--motion-exit-duration) ease-(--motion-exit-easing) group-data-complete/progress:translate-y-0 group-data-complete/progress:opacity-100 group-data-complete/progress:delay-[calc(var(--motion-draw-duration)*0.7)] group-data-complete/progress:duration-(--motion-enter-duration) group-data-complete/progress:ease-(--motion-enter-easing) group-data-[variant=destructive]/progress:hidden motion-reduce:translate-y-0 [&_svg:not([class*='size-'])]:size-4">
              <IconPlaceholder
                lucide='CheckIcon'
                tabler='IconCheck'
                hugeicons='Tick02Icon'
                phosphor='CheckIcon'
                remixicon='RiCheckLine'
                aria-hidden
              />
              {completeLabel}
            </span>
          </>
        )
      }}
    </ProgressPrimitive.Value>
  )
}

/**
 * The progress as a ring, for a line too short for a track, such as an
 * island's pill: it fills clockwise from the top on `draw`. While the value
 * is unknown, the Spinner's arc turns in its place, and it fades to the ring
 * once a value comes. It is 16px, as an icon beside text.
 */
function ProgressRing({
  className,
  value,
  min = 0,
  max = 100,
  ...props
}: Omit<ProgressPrimitive.Root.Props, 'className' | 'children'> & {
  className?: string
  /** Names a ring that has no label beside it. */
  'aria-label'?: string
}) {
  const percent = valuePercent(value, min, max)
  return (
    <ProgressPrimitive.Root
      data-slot='progress-ring'
      value={value}
      min={min}
      max={max}
      className={cn(
        'group/progress-ring text-primary relative inline-grid size-4 shrink-0 forced-colors:text-[Highlight] *:col-start-1 *:row-start-1 *:size-full',
        className,
      )}
      {...props}
    >
      <svg
        aria-hidden
        viewBox='0 0 16 16'
        fill='none'
        className='opacity-100 transition-opacity duration-(--motion-enter-duration) ease-(--motion-enter-easing) group-data-indeterminate/progress-ring:opacity-0'
      >
        <circle
          cx='8'
          cy='8'
          r='6'
          stroke='currentColor'
          strokeOpacity='0.25'
          strokeWidth='2'
        />
        <circle
          cx='8'
          cy='8'
          r='6'
          pathLength={100}
          strokeDasharray='100'
          strokeDashoffset={100 - percent}
          strokeWidth='2'
          strokeLinecap='round'
          transform='rotate(-90 8 8)'
          className='stroke-current transition-[stroke-dashoffset] duration-(--motion-draw-duration) ease-(--motion-draw-easing) motion-reduce:transition-none'
        />
      </svg>
      <Spinner
        aria-hidden
        className='size-full opacity-0 transition-opacity duration-(--motion-exit-duration) ease-(--motion-exit-easing) [animation-play-state:paused] group-data-indeterminate/progress-ring:opacity-100 group-data-indeterminate/progress-ring:[animation-play-state:running]'
      />
    </ProgressPrimitive.Root>
  )
}

export { Progress, ProgressLabel, ProgressRing, ProgressValue }
