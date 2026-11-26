'use client'

import {
  gaugeText,
  slidingFillClassName,
  slidingFillStyle,
  trackClassName,
  trackHeaderClassName,
  trackLabelClassName,
  trackRootClassName,
  valuePercent,
} from '@/registry/lib/track'
import {
  MeterIndicator as MeterIndicatorPrimitive,
  MeterLabel as MeterLabelPrimitive,
  Meter as MeterPrimitive,
  MeterTrack as MeterTrackPrimitive,
  MeterValue as MeterValuePrimitive,
} from '@ui-sdk/react/meter'
import type { ComponentProps, ReactNode } from 'react'

import { cn } from '@/lib/utils'

type MeterProps = Omit<
  ComponentProps<typeof MeterPrimitive>,
  'className' | 'format' | 'locale' | 'children'
> & {
  className?: string
  /** How `MeterValue` and the value read out are written: a percentage by default. */
  format?: Intl.NumberFormatOptions
  locale?: Intl.LocalesArgument
  /** Past this value the meter warns: the fill and the value turn red. A notch on the track marks it. */
  high?: number
  /** Below this value the meter warns, as past `high`: for a measure that should be high, such as a password's strength. */
  low?: number
  /** Names a meter that has no `MeterLabel`. */
  'aria-label'?: string
  /** The label and value, in a row above the track. */
  children?: ReactNode
}

function Meter({
  className,
  children,
  value,
  min = 0,
  max = 100,
  high,
  low,
  format,
  locale,
  ...props
}: MeterProps) {
  return (
    <MeterPrimitive
      data-high={(high !== undefined && value > high) || undefined}
      data-low={(low !== undefined && value < low) || undefined}
      value={value}
      min={min}
      max={max}
      format={(reading: number) => gaugeText(reading, { min, max, locale, format })}
      className={cn(trackRootClassName, 'group/meter', className)}
      {...props}
    >
      {children ? (
        <div data-slot='meter-header' className={trackHeaderClassName}>
          {children}
        </div>
      ) : null}
      <MeterTrackPrimitive className={cn(trackClassName, 'overflow-hidden')}>
        <MeterIndicatorPrimitive
          style={slidingFillStyle(valuePercent(value, min, max))}
          className={cn(
            slidingFillClassName,
            'group-data-high/meter:bg-destructive group-data-low/meter:bg-destructive',
          )}
        />
        {[low, high].map((mark) =>
          mark === undefined ? null : (
            // Where it starts to warn: a notch cut through the track and the fill.
            <span
              key={mark === low ? 'low' : 'high'}
              aria-hidden
              data-slot='meter-mark'
              style={{ insetInlineStart: `${valuePercent(mark, min, max)}%` }}
              className='bg-background absolute inset-y-0 w-0.5 -translate-x-1/2 rtl:translate-x-1/2'
            />
          ),
        )}
      </MeterTrackPrimitive>
    </MeterPrimitive>
  )
}

function MeterLabel({
  className,
  ...props
}: Omit<ComponentProps<typeof MeterLabelPrimitive>, 'className'> & {
  className?: string
}) {
  return <MeterLabelPrimitive className={cn(trackLabelClassName, className)} {...props} />
}

function MeterValue({
  className,
  ...props
}: Omit<ComponentProps<typeof MeterValuePrimitive>, 'className'> & {
  className?: string
}) {
  return (
    <MeterValuePrimitive
      className={cn(
        'text-muted-foreground group-data-high/meter:text-destructive group-data-low/meter:text-destructive ms-auto shrink-0 tabular-nums transition-colors duration-(--motion-draw-duration) ease-(--motion-draw-fade-easing)',
        className,
      )}
      {...props}
    />
  )
}

export { Meter, MeterLabel, MeterValue }
