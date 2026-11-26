'use client'

import { InputInvalidIcon, inputBoxClassName } from '@/registry/components/kino/input'
import { dayPeriodNames } from '@/registry/lib/dates'
import { followFocus, highlightClassName } from '@/registry/lib/highlight'
import { Roll } from '@/registry/lib/roll'
import { revealInRow } from '@/registry/lib/scroll'
import type { DateInputSegment, DateInputSegmentData } from '@ui-sdk/react/date-input'
import { type ComponentProps, type ReactNode, useEffect, useRef, useState } from 'react'

import { cn } from '@/lib/utils'

/*
 * How the Date input and the Time input draw ui-sdk's segments: one
 * highlight marks the segment you are in and glides to the next, and each
 * number rolls up or down to its new value, however it changed. ui-sdk
 * holds the segments, the keys and the value; this is only their look.
 */

/** ui-sdk's segment part: the Date input's or the Time input's. */
type SegmentPart = (props: ComponentProps<typeof DateInputSegment>) => ReactNode

const segmentClassName =
  'relative inline-grid h-(--control-height-xs) min-w-6 place-items-center px-(--segment-padding,0.375rem) tabular-nums'

/** What a segment can show at its widest, so typing never moves what follows. */
function segmentSizes(segment: DateInputSegmentData, locale: string): string[] {
  if (segment.type === 'dayPeriod') return dayPeriodNames(locale)
  return ['0'.repeat(String(segment.max).length)]
}

type Trend = 1 | -1

/**
 * Which way each segment's number rolls after a change; a segment that
 * didn't change keeps its last way. Several that change together roll the
 * way the whole value went (`whole`), as an odometer's wheels do: 11:45 to
 * 12:00 rolls the minutes up too. One stepped by a key rolls the key's way
 * (`step`), past its end too: 23 up to 00 rolls up. Otherwise a number rolls
 * up as it rises and down as it falls, with an empty segment counted as 0.
 */
function segmentTrends(
  from: Record<string, number | null>,
  to: Record<string, number | null>,
  last: Record<string, Trend>,
  { whole, step }: { whole: Trend | null; step: Trend | null },
): Record<string, Trend> {
  const changed = Object.keys(to).filter((key) => (from[key] ?? null) !== to[key])
  const trends = { ...last }
  for (const key of changed) {
    const own: Trend = (to[key] ?? 0) >= (from[key] ?? 0) ? 1 : -1
    trends[key] =
      changed.length > 1 ? (whole ?? own) : changed.length === 1 ? (step ?? own) : own
  }
  return trends
}

/** Which way a whole value went: later is 1. ISO dates and times sort as text in the order of time. */
function valueTrend(from: string | null, to: string | null): Trend | null {
  if (from === null || to === null || from === to) return null
  return to > from ? 1 : -1
}

const LATIN_LETTER: Record<string, string> = { day: 'd', month: 'm', year: 'y' }

/**
 * What an empty segment shows: a date's segment repeats the first letter of
 * its name in the locale, lower case (tt.mm.jjjj in German), or the Latin
 * letter in a script without capitals; a time's segment shows dashes.
 */
function segmentPlaceholder(type: string, locale: string): string {
  const latin = LATIN_LETTER[type]
  if (!latin) return '––'
  let letter = latin
  try {
    const name = new Intl.DisplayNames(locale, { type: 'dateTimeField' }).of(type)
    const code = name?.codePointAt(0)
    const first = code === undefined ? undefined : String.fromCodePoint(code)
    if (first && first.toLocaleUpperCase(locale) !== first.toLocaleLowerCase(locale)) {
      letter = first.toLocaleLowerCase(locale)
    }
  } catch {
    // An engine without dateTimeField names keeps the Latin letters.
  }
  return letter.repeat(type === 'year' ? 4 : 2)
}

/** A segment's face: its placeholder until it holds a number, which rolls in. */
function SegmentFace({
  segment,
  locale,
  trend,
  placeholderClassName,
}: {
  segment: DateInputSegmentData
  locale: string
  trend: Trend
  placeholderClassName: string
}) {
  const placeholder = segmentPlaceholder(segment.type, locale)
  return (
    <>
      {/* Its characters stand apart, split as the roll splits them into columns, so a name's width matches theirs without kerning. */}
      {[...segmentSizes(segment, locale), placeholder].map((size) => (
        <span key={size} aria-hidden className='invisible col-start-1 row-start-1 flex'>
          {size.split('').map((char, index) => (
            // oxlint-disable-next-line react/no-array-index-key -- a name's characters keep their places.
            <span key={index}>{char}</span>
          ))}
        </span>
      ))}
      <span
        aria-hidden
        className={cn(
          'absolute inset-0 flex items-center justify-center whitespace-nowrap',
          placeholderClassName,
          // Gone before the first digit has rolled in; back once the number has mostly rolled away.
          segment.text
            ? 'opacity-0 transition-opacity duration-[calc(var(--motion-exit-duration)*0.4)] ease-(--motion-exit-easing)'
            : 'transition-opacity delay-[calc(var(--motion-exit-duration)*0.8)] duration-(--motion-enter-duration) ease-(--motion-enter-easing)',
        )}
      >
        {placeholder}
      </span>
      <Roll
        value={segment.text}
        trend={trend}
        typed
        className='col-start-1 row-start-1'
      />
    </>
  )
}

/** Which way `locale`'s text runs: `rtl` for Hebrew and Arabic. */
function localeDirection(locale: string): 'ltr' | 'rtl' {
  try {
    const info = new Intl.Locale(locale) as Intl.Locale & {
      getTextInfo?: () => { direction?: string }
      textInfo?: { direction?: string }
    }
    return (info.getTextInfo?.() ?? info.textInfo)?.direction === 'rtl' ? 'rtl' : 'ltr'
  } catch {
    return 'ltr'
  }
}

/**
 * The segments in the order the row shows them, left to right. A
 * right-to-left language writes AM or PM after the time, which shows on its
 * left (م ٢:٣٠ in Arabic), so it and the space before it come first: the
 * arrow keys and Tab then move the way the row reads on screen.
 */
function segmentsOnScreen<Segment extends { type: string }>(
  segments: readonly Segment[],
  rtl: boolean,
): Segment[] {
  const last = segments.at(-1)
  if (!rtl || last?.type !== 'dayPeriod') return [...segments]
  const gap = segments.at(-2)?.type === 'literal' ? 1 : 0
  const time = segments.slice(0, segments.length - 1 - gap)
  return [last, ...segments.slice(time.length, segments.length - 1), ...time]
}

const STEP_KEYS: Record<string, Trend> = {
  ArrowUp: 1,
  PageUp: 1,
  ArrowDown: -1,
  PageDown: -1,
}

/**
 * A field's segments in a row with one highlight, which glides from segment
 * to segment. `compact` segments are tighter, and a row too long for its box
 * scrolls, with its edges fading, and focus brings each segment into view,
 * as text does in a text field.
 */
function SegmentRow({
  segments,
  Segment,
  value,
  locale,
  compact,
}: {
  segments: DateInputSegmentData[]
  Segment: SegmentPart
  /** The whole value, as ui-sdk's state holds it. */
  value: string | null
  locale: string
  compact?: boolean
}) {
  const numbers = Object.fromEntries(
    segments.map((segment) => [segment.key, segment.value]),
  )
  // The last step key pressed, which a change in the same press reads; any other key clears it.
  const [step, setStep] = useState<Trend | null>(null)
  const [seen, setSeen] = useState({
    numbers,
    value,
    trends: {} as Record<string, Trend>,
  })
  let trends = seen.trends
  if (segments.some((segment) => seen.numbers[segment.key] !== segment.value)) {
    trends = segmentTrends(seen.numbers, numbers, seen.trends, {
      whole: valueTrend(seen.value, value),
      step,
    })
    setSeen({ numbers, value, trends })
    if (step !== null) setStep(null)
  } else if (seen.value !== value) setSeen({ ...seen, value })
  const trendOf = (segment: DateInputSegmentData) => trends[segment.key] ?? 1
  const shown = segmentsOnScreen(segments, localeDirection(locale) === 'rtl')
  const onKeyDownCapture = (event: { key: string }) =>
    setStep(STEP_KEYS[event.key] ?? null)

  const scrollerRef = useRef<HTMLDivElement>(null)
  const rowRef = useRef<HTMLDivElement>(null)
  const layerRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller || !compact) return
    return revealInRow(scroller, { item: '[data-segment]', fade: '--segment-row-fade' })
  }, [compact])

  useEffect(() => {
    const row = rowRef.current
    if (!row || !layerRef.current) return
    return followFocus(row, layerRef.current, (node) => {
      const segment =
        node instanceof Element ? node.closest<HTMLElement>('[data-segment]') : null
      return segment && row.contains(segment) ? segment : null
    })
  }, [])

  const content = (
    <>
      {shown.map((segment) =>
        segment.editable ? (
          <span
            key={segment.key}
            data-segment={segment.type}
            className={cn(
              segmentClassName,
              'rounded-(--control-radius-xs) has-[input:read-only]:text-muted-foreground',
            )}
          >
            <SegmentFace
              segment={segment}
              locale={locale}
              trend={trendOf(segment)}
              placeholderClassName='text-muted-foreground'
            />
            <Segment
              segment={segment}
              className='absolute inset-0 size-full cursor-text rounded-[inherit] bg-transparent text-center text-transparent forced-color-adjust-none caret-transparent selection:bg-transparent placeholder:text-transparent focus-visible:outline-hidden'
            />
          </span>
        ) : (
          // Pre, so a separator's space (the one after the comma in 27/11/2026, 14:30) keeps its width.
          <Segment
            key={segment.key}
            segment={segment}
            className='whitespace-pre text-muted-foreground'
          />
        ),
      )}
      {/* The highlight carries a copy of the row in its own colours, so what it covers reads at full contrast as it glides. */}
      <span
        ref={layerRef}
        aria-hidden
        data-segment-highlight=''
        className={cn(
          highlightClassName,
          'flex items-center bg-primary text-primary-foreground forced-color-adjust-none forced-colors:bg-[Highlight] forced-colors:text-[HighlightText]',
        )}
      >
        {shown.map((segment) =>
          segment.editable ? (
            <span key={segment.key} className={segmentClassName}>
              <SegmentFace
                segment={segment}
                locale={locale}
                trend={trendOf(segment)}
                placeholderClassName='text-primary-foreground forced-colors:text-[HighlightText]'
              />
            </span>
          ) : (
            <span
              key={segment.key}
              className={cn(
                'whitespace-pre text-primary-foreground forced-colors:text-[HighlightText]',
              )}
            >
              {segment.text}
            </span>
          ),
        )}
      </span>
    </>
  )

  // Digits and their separators read left to right in every language.
  return compact ? (
    // The row inside the scroller is as wide as its segments, so the highlight's copy spans all of them, not just what shows.
    <div
      ref={scrollerRef}
      dir='ltr'
      className='scrollbar-none flex min-w-0 overflow-x-auto [--segment-padding:0.25rem] [mask-image:linear-gradient(to_right,transparent,black_var(--segment-row-fade-left,0px),black_calc(100%-var(--segment-row-fade-right,0px)),transparent)]'
    >
      <div
        ref={rowRef}
        onKeyDownCapture={onKeyDownCapture}
        className='relative flex w-max shrink-0 items-center'
      >
        {content}
      </div>
    </div>
  ) : (
    <div
      ref={rowRef}
      dir='ltr'
      onKeyDownCapture={onKeyDownCapture}
      className='relative flex min-w-0 items-center'
    >
      {content}
    </div>
  )
}

/** The segments' own padding makes up the rest of the control's, so their digits line up with other fields' text. */
const segmentRowPadding = 'ps-[calc(var(--control-padding)-0.375rem)]'

/**
 * The box ui-sdk's segmented root is drawn as: what its `className` takes,
 * with its row inside and the invalid mark at its end. ui-sdk puts focus in
 * the nearest segment on a press outside them.
 */
const segmentedBoxClassName = cn(
  inputBoxClassName,
  'h-(--control-height) cursor-text text-base md:text-sm',
  // The box is the control a Field marks invalid, so it reads its own state as well as its segments'.
  'aria-invalid:border-destructive aria-invalid:has-focus-visible:border-destructive aria-invalid:has-focus-visible:ring-destructive/20 forced-colors:aria-invalid:outline-2 forced-colors:aria-invalid:outline-offset-1 forced-colors:aria-invalid:outline-dashed dark:aria-invalid:border-destructive/70 dark:aria-invalid:has-focus-visible:ring-destructive/40',
  segmentRowPadding,
)

/** What goes inside the root: the row, then the invalid mark. */
function SegmentedBody(props: ComponentProps<typeof SegmentRow>) {
  return (
    <>
      <SegmentRow {...props} />
      <InputInvalidIcon className='ms-auto' />
    </>
  )
}

export {
  segmentedBoxClassName,
  SegmentedBody,
  segmentsOnScreen,
  segmentPlaceholder,
  segmentTrends,
  valueTrend,
}
