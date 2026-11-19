'use client'

import {
  dateGranularity,
  type Granularity,
  type HourCycle,
  timeGranularity,
  useLocale,
} from '@/registry/lib/dates'
import type { SegmentsComponentProps } from '@/registry/lib/segment-field'
import { SegmentedInput } from '@/registry/lib/segmented-input'
import { dateScheme, dateTimeScheme } from '@/registry/lib/segments'
import { useMemo } from 'react'

/*
 * A date typed a segment at a time, in the order the locale writes it. One
 * highlight marks the segment you are in and glides to the next, and each
 * number rolls up or down to its new value, however it changed. To the
 * month it drops the day, to the year it is the year alone, and finer than
 * a day the Time input's segments follow the date's in the same field.
 */

interface DateInputOwnProps {
  /** Sets the segments' order, separators and placeholders. The browser's language by default. */
  locale?: string
  /** The earliest value allowed, in the value's form, or a day. An earlier one shows as invalid. */
  min?: string
  /** The latest value allowed, in the value's form, or a day, which allows all of it. */
  max?: string
  /** Shows the month as a short name (Nov) in place of its number. */
  monthFormat?: 'numeric' | 'short'
  /**
   * The smallest unit typed, which sets the value's form: `year` (`yyyy`),
   * `month` (`yyyy-mm`), `day` (`yyyy-mm-dd`, the default), or a date and
   * time to the `hour`, `minute` or `second` (`yyyy-mm-ddTHH:mm`, with
   * `:ss` to the second).
   */
  granularity?: Granularity
  /** With a time, a 12-hour clock with AM and PM, or a 24-hour one. The locale's by default. */
  hourCycle?: HourCycle
}

function DateInput({
  locale,
  min,
  max,
  monthFormat,
  granularity = 'day',
  hourCycle,
  ...props
}: SegmentsComponentProps<DateInputOwnProps>) {
  const resolved = useLocale(locale)
  const scheme = useMemo(() => {
    const time = timeGranularity(granularity)
    return time
      ? dateTimeScheme({
          locale: resolved,
          monthFormat,
          hourCycle,
          granularity: time,
          min,
          max,
        })
      : dateScheme({
          locale: resolved,
          monthFormat,
          granularity: dateGranularity(granularity),
          min,
          max,
        })
  }, [resolved, monthFormat, hourCycle, granularity, min, max])
  return (
    <SegmentedInput
      slot='date-input'
      scheme={scheme}
      compact={timeGranularity(granularity) !== null}
      {...props}
    />
  )
}

export { DateInput }
