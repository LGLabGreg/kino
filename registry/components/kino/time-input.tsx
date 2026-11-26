'use client'

import { useLocale } from '@/registry/lib/dates'
import { SegmentedBody, segmentedBoxClassName } from '@/registry/lib/segmented-input'
import {
  TimeInput as TimeInputPrimitive,
  TimeInputSegment,
} from '@ui-sdk/react/time-input'
import type { ComponentProps } from 'react'

import { cn } from '@/lib/utils'

/*
 * ui-sdk's Time input: a time typed a segment at a time, on the locale's
 * clock. It looks and moves as the Date input does: one highlight marks the
 * segment you are in and glides to the next, and each number rolls up or
 * down to its new value.
 */
function TimeInput({
  locale,
  className,
  ...props
}: Omit<ComponentProps<typeof TimeInputPrimitive>, 'className' | 'children'> & {
  className?: string
}) {
  const resolved = useLocale(locale)
  return (
    <TimeInputPrimitive
      locale={resolved}
      className={cn(segmentedBoxClassName, className)}
      // A group's disabled state, which ui-sdk shows only on its segments, so its label reads as inactive too.
      render={(own: ComponentProps<'div'>, state: { disabled: boolean }) => (
        <div {...own} aria-disabled={state.disabled || undefined} />
      )}
      {...props}
    >
      {(state) => (
        <SegmentedBody
          segments={state.segments}
          value={state.value}
          Segment={TimeInputSegment}
          locale={resolved}
        />
      )}
    </TimeInputPrimitive>
  )
}

export { TimeInput }
