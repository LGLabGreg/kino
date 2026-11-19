'use client'

import {
  focusControl,
  InputInvalidIcon,
  inputBoxClassName,
} from '@/registry/components/kino/input'
import { followFocus, highlightClassName } from '@/registry/lib/highlight'
import { Roll } from '@/registry/lib/roll'
import { revealInRow } from '@/registry/lib/scroll'
import {
  type Segment,
  type SegmentFieldPart,
  type SegmentsComponentProps,
  splitSegmentProps,
  useSegments,
} from '@/registry/lib/segment-field'
import type { SegmentScheme } from '@/registry/lib/segments'
import { type CSSProperties, Fragment, type ReactNode, useEffect, useRef } from 'react'

import { cn } from '@/lib/utils'

/*
 * The box a value typed a segment at a time is drawn in, for the Date input
 * and the Time input alike: one highlight marks the segment you are in and
 * glides to the next, and each number rolls up or down to its new value,
 * however it changed. What the segments hold comes from the scheme.
 */

const segmentClassName =
  'relative inline-grid h-(--control-height-xs) min-w-6 place-items-center px-(--segment-padding,0.375rem) tabular-nums'

function SegmentFace({
  segment,
  placeholderClassName,
}: {
  segment: Segment
  placeholderClassName: string
}) {
  const { text, placeholder, sizes, trend } = segment
  return (
    <>
      {/* As wide as the widest it can show, so typing never moves what follows. Its characters stand apart, split as the roll splits them into columns, so a name's width matches theirs without kerning. */}
      {sizes.map((size) => (
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
          text
            ? 'opacity-0 transition-opacity duration-[calc(var(--motion-exit-duration)*0.4)] ease-(--motion-exit-easing)'
            : 'transition-opacity delay-[calc(var(--motion-exit-duration)*0.8)] duration-(--motion-enter-duration) ease-(--motion-enter-easing)',
        )}
      >
        {placeholder}
      </span>
      <Roll value={text} trend={trend} typed className='col-start-1 row-start-1' />
    </>
  )
}

function SegmentBox({
  segment,
  slot,
  style,
}: {
  segment: Segment
  slot: string
  style: CSSProperties | undefined
}) {
  return (
    <span
      data-slot={`${slot}-segment`}
      data-type={segment.type}
      style={style}
      className={cn(
        segmentClassName,
        'rounded-(--control-radius-xs) has-[input:read-only]:text-muted-foreground',
      )}
    >
      <SegmentFace segment={segment} placeholderClassName='text-muted-foreground' />
      <input
        {...segment.inputProps}
        className='absolute inset-0 size-full cursor-text rounded-[inherit] bg-transparent text-center text-transparent forced-color-adjust-none caret-transparent selection:bg-transparent focus-visible:outline-hidden'
      />
    </span>
  )
}

/** One field's segments in a row: its parts, the props of the group around them, and what it renders once (its names, its form input). */
interface SegmentRowField {
  key: string
  parts: SegmentFieldPart[]
  /** On the group that holds this field's segments, when the row holds several fields; with one field, the box takes them. */
  groupProps?: object
  hidden: ReactNode
}

/**
 * The segments of one field or several, such as a range's start and end,
 * in one row with one highlight: it glides from segment to segment, and from
 * one field's last segment on to the next field's first.
 */
function SegmentRow({
  slot,
  fields,
  between,
  compact,
}: {
  /** The component's `data-slot`, which its segments and highlight take as a prefix. */
  slot: string
  fields: SegmentRowField[]
  /** Shown between two fields, such as an en dash between a range's ends. */
  between?: ReactNode
  /**
   * Tighter segments, for two fields that share a box. A row too long for
   * its box scrolls, with its edges fading, and focus brings each segment
   * into view, as text does in a text field.
   */
  compact?: boolean
}) {
  const scrollerRef = useRef<HTMLDivElement>(null)
  const rowRef = useRef<HTMLDivElement>(null)
  const layerRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller || !compact) return
    return revealInRow(scroller, { item: '[data-type]', fade: '--segment-row-fade' })
  }, [compact])

  useEffect(() => {
    const row = rowRef.current
    if (!row || !layerRef.current) return
    return followFocus(row, layerRef.current, (node) => {
      const segment =
        node instanceof Element ? node.closest<HTMLElement>('[data-type]') : null
      return segment && row.contains(segment) ? segment : null
    })
  }, [])

  // The real row and the highlight's copy of it are laid out alike, so the copy lines up under the window the highlight cuts.
  const row = (copy: boolean) =>
    fields.map((field, index) => {
      const places = screenPlaces(field.parts)
      const parts = field.parts.map((part, at) =>
        part.type === 'literal' ? (
          // oxlint-disable-next-line react/no-array-index-key -- separators keep their place in the locale's order.
          <span
            key={at}
            aria-hidden={copy ? undefined : true}
            style={places[at]}
            // Pre, so a separator's space (the one after the comma in 27/11/2026, 14:30) keeps its width.
            className={
              copy
                ? 'whitespace-pre text-primary-foreground forced-colors:text-[HighlightText]'
                : 'whitespace-pre text-muted-foreground'
            }
          >
            {part.text}
          </span>
        ) : copy ? (
          <span key={part.type} style={places[at]} className={segmentClassName}>
            <SegmentFace
              segment={part}
              placeholderClassName='text-primary-foreground forced-colors:text-[HighlightText]'
            />
          </span>
        ) : (
          <SegmentBox key={part.type} segment={part} slot={slot} style={places[at]} />
        ),
      )
      return (
        <Fragment key={field.key}>
          {index > 0 ? (
            <span
              aria-hidden={copy ? undefined : true}
              className={cn(
                'flex shrink-0 items-center px-0.5',
                copy
                  ? 'text-primary-foreground forced-colors:text-[HighlightText]'
                  : 'text-muted-foreground',
              )}
            >
              {between}
            </span>
          ) : null}
          {field.groupProps || fields.length > 1 ? (
            <span
              {...(copy ? undefined : field.groupProps)}
              className='relative flex shrink-0 items-center'
            >
              {parts}
              {copy ? null : field.hidden}
            </span>
          ) : (
            <>
              {parts}
              {copy ? null : field.hidden}
            </>
          )}
        </Fragment>
      )
    })

  const content = (
    <>
      {row(false)}
      {/* The highlight carries a copy of the row in its own colours, so what it covers reads at full contrast as it glides. */}
      <span
        ref={layerRef}
        aria-hidden
        data-slot={`${slot}-highlight`}
        className={cn(
          highlightClassName,
          'flex items-center bg-primary text-primary-foreground forced-color-adjust-none forced-colors:bg-[Highlight] forced-colors:text-[HighlightText]',
        )}
      >
        {row(true)}
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
      <div ref={rowRef} className='relative flex w-max shrink-0 items-center'>
        {content}
      </div>
    </div>
  ) : (
    <div ref={rowRef} dir='ltr' className='relative flex min-w-0 items-center'>
      {content}
    </div>
  )
}

/** The segments' own padding makes up the rest of the control's, so their digits line up with other fields' text. */
const segmentRowPadding = 'ps-[calc(var(--control-padding)-0.375rem)]'

function SegmentedInput({
  scheme,
  slot,
  compact,
  className,
  ref,
  onPointerDown,
  ...props
}: SegmentsComponentProps & {
  scheme: SegmentScheme
  /** The component's `data-slot`, which its segments and highlight take as a prefix. */
  slot: string
  /** Tighter segments that scroll in a box too narrow for them, for a long value such as a date and its time. */
  compact?: boolean
}) {
  const [segmentProps, rest] = splitSegmentProps(props)
  const { parts, groupProps, hidden } = useSegments(scheme, segmentProps)

  return (
    <div
      ref={ref}
      data-slot={slot}
      {...rest}
      {...groupProps}
      onPointerDown={(event) => {
        onPointerDown?.(event)
        if (!event.defaultPrevented) focusControl(event)
      }}
      className={cn(
        inputBoxClassName,
        'h-(--control-height) cursor-text text-base md:text-sm',
        segmentRowPadding,
        className,
      )}
    >
      <SegmentRow
        slot={slot}
        compact={compact}
        fields={[{ key: 'value', parts, hidden }]}
      />
      <InputInvalidIcon className='ms-auto' />
    </div>
  )
}

/**
 * Where each piece shows in the row: the pieces that lead (a right-to-left
 * language's AM or PM and the space before it) come first, the last of them
 * leftmost, while the DOM keeps the order typing, Tab and screen readers go.
 */
function screenPlaces(parts: SegmentFieldPart[]): (CSSProperties | undefined)[] {
  let leading = 0
  return parts.map((part) => (part.lead ? { order: -++leading } : undefined))
}

export { SegmentedInput, SegmentRow, segmentRowPadding }
export type { SegmentRowField }
