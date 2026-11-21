'use client'

import { useFollowedValue } from '@/registry/lib/controllable'
import {
  followPick,
  followPointer,
  highlightClassName,
  itemMatching,
  pickClassName,
} from '@/registry/lib/highlight'
import {
  pillBackdropClassName,
  pillClassName,
  pillItemClassName,
  pillItemLayout,
  pillRowClassName,
  pillTrackClassName,
} from '@/registry/lib/pill'
import { markMounted, mergeRefs } from '@/registry/lib/refs'
import { revealInRow } from '@/registry/lib/scroll'
import { SwapIcon } from '@/registry/lib/swap'
import { Radio as RadioPrimitive } from '@base-ui/react/radio'
import { RadioGroup as RadioGroupPrimitive } from '@base-ui/react/radio-group'
import { createContext, type ReactNode, use, useEffect, useMemo, useRef } from 'react'

import { cn } from '@/lib/utils'

/*
 * One of a few options, picked from a row: a radio group a form submits,
 * drawn as the Tabs are, with the pill sliding to the pick. A row wider
 * than its column scrolls, as the Tabs' list does. `vertical` stacks the
 * options in a column, as the vertical Tabs do, labels read from the start.
 */

const SEGMENT = '[data-slot=segmented-control-item]'

// The row and the pill's copy of it share this, so every label sits exactly on its twin.
const segmentedControlRow = cn(
  // The control's own `data-orientation`, and the pill's copy inside it.
  'flex w-max min-w-full data-[orientation=vertical]:w-auto data-[orientation=vertical]:flex-col group-data-[orientation=vertical]/segmented-control:w-auto group-data-[orientation=vertical]/segmented-control:flex-col',
  pillRowClassName,
)

/** True inside the pill's copy of the row, where a segment is only its label. */
const SegmentedControlCopyContext = createContext(false)

/** No segment's value, so nothing reads as picked outside a `SegmentedControl`. */
const NO_SEGMENT = Symbol('no segment')

/**
 * The picked value, followed from Base UI's own, so the pill's copy of the
 * row knows it as the row does, in the same render.
 */
const SegmentedControlValueContext = createContext<unknown>(NO_SEGMENT)

/** Whether the segment around it is picked, for its icon. */
const SegmentedControlCheckedContext = createContext(false)

function SegmentedControl<Value>({
  ref,
  className,
  children,
  orientation = 'horizontal',
  value,
  defaultValue,
  onValueChange,
  ...props
}: Omit<RadioGroupPrimitive.Props<Value>, 'className'> & {
  className?: string
  /** A row, or a column read down its start edge. */
  orientation?: 'horizontal' | 'vertical'
}) {
  const scrollerRef = useRef<HTMLDivElement>(null)
  const groupRef = useRef<HTMLDivElement>(null)
  const groupRefs = useMemo(() => mergeRefs(groupRef, markMounted, ref), [ref])
  const pillRef = useRef<HTMLSpanElement>(null)
  const backdropRef = useRef<HTMLSpanElement>(null)
  const [picked, follow] = useFollowedValue(value, defaultValue, onValueChange)

  useEffect(() => {
    const scroller = scrollerRef.current
    const group = groupRef.current
    if (!scroller || !group || !pillRef.current || !backdropRef.current) return
    const stopPick = followPick(group, pillRef.current, {
      picked: () => group.querySelector<HTMLElement>(`:scope > ${SEGMENT}[data-checked]`),
      attributes: ['data-checked'],
    })
    // Behind the segment under the pointer, or the one with visible focus.
    const stopHover = followPointer(group, backdropRef.current, {
      itemOf: itemMatching(group, SEGMENT),
      focus: true,
    })
    const stopRow = revealInRow(scroller, {
      item: SEGMENT,
      picked: 'data-checked',
      fade: '--segmented-control-fade',
    })
    return () => {
      stopPick()
      stopHover()
      stopRow()
    }
  }, [])

  return (
    <SegmentedControlValueContext value={picked}>
      <div
        data-slot='segmented-control-track'
        className={cn(
          pillTrackClassName,
          'w-fit max-w-full has-data-invalid:ring-1 has-data-invalid:ring-destructive forced-colors:has-data-invalid:outline-2 forced-colors:has-data-invalid:outline-dashed',
          className,
        )}
      >
        <div
          ref={scrollerRef}
          data-slot='segmented-control-scroller'
          className={cn(
            'min-w-0',
            // A row wider than its column scrolls; a column grows down the page.
            orientation === 'horizontal' &&
              'scrollbar-none overflow-x-auto [mask-image:linear-gradient(to_right,transparent,black_var(--segmented-control-fade-left,0px),black_calc(100%-var(--segmented-control-fade-right,0px)),transparent)]',
          )}
        >
          <RadioGroupPrimitive
            ref={groupRefs}
            data-slot='segmented-control'
            data-orientation={orientation}
            className={cn(
              segmentedControlRow,
              'group/segmented-control relative isolate',
            )}
            value={value}
            defaultValue={defaultValue}
            onValueChange={follow}
            {...props}
          >
            {children}
            <span
              ref={backdropRef}
              aria-hidden
              data-slot='segmented-control-backdrop'
              className={cn(highlightClassName, pillBackdropClassName)}
            />
            <span
              ref={pillRef}
              aria-hidden
              // Whatever the row holds is copied here, so nothing in the copy may take focus.
              inert
              data-slot='segmented-control-pill'
              className={cn(
                pickClassName,
                pillClassName,
                'z-10 group-data-disabled/segmented-control:data-[highlight=shown]:opacity-50',
              )}
            >
              <span className={cn(segmentedControlRow, 'h-full')}>
                <SegmentedControlCopyContext value={true}>
                  {children}
                </SegmentedControlCopyContext>
              </span>
            </span>
          </RadioGroupPrimitive>
        </div>
      </div>
    </SegmentedControlValueContext>
  )
}

const segmentLayout = cn(
  pillItemLayout,
  'shrink-0',
  // A column reads down its start edge, and a label longer than it wraps.
  'group-data-[orientation=vertical]/segmented-control:h-auto group-data-[orientation=vertical]/segmented-control:min-h-[calc(var(--control-height)_-_6px)] group-data-[orientation=vertical]/segmented-control:justify-start group-data-[orientation=vertical]/segmented-control:py-1.5 group-data-[orientation=vertical]/segmented-control:text-start group-data-[orientation=vertical]/segmented-control:whitespace-normal',
)

function SegmentedControlItem<Value>({
  className,
  children,
  ...props
}: Omit<RadioPrimitive.Root.Props<Value>, 'className' | 'nativeButton' | 'render'> & {
  className?: string
}) {
  const checked = use(SegmentedControlValueContext) === props.value
  const content = (
    <SegmentedControlCheckedContext value={checked}>
      {children}
    </SegmentedControlCheckedContext>
  )
  if (use(SegmentedControlCopyContext)) {
    return <span className={cn(segmentLayout, className)}>{content}</span>
  }
  return (
    <RadioPrimitive.Root
      data-slot='segmented-control-item'
      nativeButton
      // The label is the segment's content, passed in with Base UI's props.
      render={(buttonProps) => <button type='button' {...buttonProps} />}
      className={cn(
        segmentLayout,
        pillItemClassName,
        // Until the page hydrates and the pill is placed, the pick draws itself.
        '[[data-slot=segmented-control]:not([data-mounted])>&]:data-checked:bg-primary [[data-slot=segmented-control]:not([data-mounted])>&]:data-checked:text-primary-foreground',
        className,
      )}
      {...props}
    >
      {content}
    </RadioPrimitive.Root>
  )
}

/**
 * A segment's icon: `children`, and `checkedIcon` while the segment is
 * picked. It rolls as a Tab's icon does, to the other icon or to itself.
 */
function SegmentedControlIcon({
  checkedIcon,
  children,
}: {
  checkedIcon?: ReactNode
  children: ReactNode
}) {
  return (
    <SwapIcon
      on={use(SegmentedControlCheckedContext)}
      onIcon={checkedIcon}
      slot='segmented-control-icon'
    >
      {children}
    </SwapIcon>
  )
}

export { SegmentedControl, SegmentedControlIcon, SegmentedControlItem }
