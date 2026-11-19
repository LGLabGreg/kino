'use client'

import { type HourCycle, type TimeGranularity, useLocale } from '@/registry/lib/dates'
import type { SegmentsComponentProps } from '@/registry/lib/segment-field'
import { SegmentedInput } from '@/registry/lib/segmented-input'
import { timeScheme } from '@/registry/lib/segments'
import { useMemo } from 'react'

/*
 * A time typed a segment at a time, on the locale's clock. It looks and
 * moves as the Date input does: one highlight marks the segment you are in
 * and glides to the next, and each number rolls up or down to its new value.
 */

interface TimeInputOwnProps {
  /** Sets the clock, the segments' order and the names of AM and PM. The browser's language by default. */
  locale?: string
  /** A 12-hour clock with AM and PM, or a 24-hour one. The locale's by default. */
  hourCycle?: HourCycle
  /** The smallest unit shown: `hour` leaves out the minutes (its value is `HH:00`), and `second` adds a seconds segment. */
  granularity?: TimeGranularity
  /** The earliest time allowed, as `HH:mm`. A `min` later than `max` runs over midnight. */
  min?: string
  /** The latest time allowed, as `HH:mm`. */
  max?: string
}

function TimeInput({
  locale,
  hourCycle,
  granularity,
  min,
  max,
  ...props
}: SegmentsComponentProps<TimeInputOwnProps>) {
  const resolved = useLocale(locale)
  const scheme = useMemo(
    () => timeScheme({ locale: resolved, hourCycle, granularity, min, max }),
    [resolved, hourCycle, granularity, min, max],
  )
  return <SegmentedInput slot='time-input' scheme={scheme} {...props} />
}

export { TimeInput }
