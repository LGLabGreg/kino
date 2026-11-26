'use client'

import { useLocale } from '@/registry/lib/dates'
import { SegmentedBody, segmentedBoxClassName } from '@/registry/lib/segmented-input'
import {
  DateInput as DateInputPrimitive,
  DateInputSegment,
} from '@ui-sdk/react/date-input'
import type { ComponentProps } from 'react'

import { cn } from '@/lib/utils'

/*
 * ui-sdk's Date input: a date typed a segment at a time, in the order the
 * locale writes it. One highlight marks the segment you are in and glides
 * to the next, and each number rolls up or down to its new value, however
 * it changed. Finer than a day, the time's segments follow the date's in
 * the same field.
 */
function DateInput({
  locale,
  className,
  ...props
}: Omit<ComponentProps<typeof DateInputPrimitive>, 'className' | 'children'> & {
  className?: string
}) {
  const resolved = useLocale(locale)
  const time = props.granularity !== undefined && props.granularity !== 'day'
  return (
    <DateInputPrimitive
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
          Segment={DateInputSegment}
          locale={resolved}
          compact={time}
        />
      )}
    </DateInputPrimitive>
  )
}

export { DateInput }
