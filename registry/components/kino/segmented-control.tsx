'use client'

import { followPointer, highlightClassName, itemMatching } from '@/registry/lib/highlight'
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
import {
  SegmentedControlIndicator,
  SegmentedControlItem as SegmentedControlItemPrimitive,
  SegmentedControl as SegmentedControlPrimitive,
} from '@ui-sdk/react/segmented-control'
import {
  type ComponentProps,
  createContext,
  type ReactNode,
  use,
  useEffect,
  useMemo,
  useRef,
} from 'react'

import { cn } from '@/lib/utils'

/*
 * One of a few options, picked from a row: ui-sdk's Segmented control, which
 * a form submits, drawn as the Tabs are, with the pill sliding to the pick.
 * A row wider than its column scrolls, as the Tabs' list does. `vertical`
 * stacks the options in a column, as the vertical Tabs do, labels read from
 * the start.
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

/** The checked value, from ui-sdk's state, so the pill's copy of the row knows it. */
const SegmentedControlValueContext = createContext<string | null>(null)

/** Whether the segment around it is picked, for its icon. */
const SegmentedControlCheckedContext = createContext(false)

function SegmentedControl<Value extends string>({
  ref,
  className,
  children,
  orientation = 'horizontal',
  ...props
}: Omit<
  ComponentProps<typeof SegmentedControlPrimitive<Value>>,
  'className' | 'children' | 'orientation'
> & {
  className?: string
  children?: ReactNode
  /** A row, or a column read down its start edge. */
  orientation?: 'horizontal' | 'vertical'
}) {
  const scrollerRef = useRef<HTMLDivElement>(null)
  const groupRefs = useMemo(() => mergeRefs(markMounted, ref), [ref])
  const backdropRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    const scroller = scrollerRef.current
    const group = backdropRef.current?.parentElement
    if (!scroller || !group || !backdropRef.current) return
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
      stopHover()
      stopRow()
    }
  }, [])

  return (
    <div
      data-slot='segmented-control-track'
      className={cn(
        pillTrackClassName,
        // An invalid Field around it rings it, and adds a dashed outline in forced colours.
        'w-fit max-w-full group-data-invalid/field:ring-1 group-data-invalid/field:ring-destructive forced-colors:group-data-invalid/field:outline-2 forced-colors:group-data-invalid/field:outline-dashed',
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
        <SegmentedControlPrimitive<Value>
          ref={groupRefs}
          orientation={orientation}
          className={cn(segmentedControlRow, 'group/segmented-control relative isolate')}
          {...props}
        >
          {(state) => (
            <SegmentedControlValueContext value={state.value}>
              {children}
              <span
                ref={backdropRef}
                aria-hidden
                data-slot='segmented-control-backdrop'
                className={cn(highlightClassName, pillBackdropClassName)}
              />
              {/*
               * The pill: as large as the row, and only its window moves, on `morph`. ui-sdk
               * measures the checked segment once the page runs: until then the window is
               * empty and the checked segment draws itself, and the first placement doesn't move.
               * Its end and bottom come from the segment's own size, as the Tabs' pill's do.
               */}
              <SegmentedControlIndicator
                // Whatever the row holds is copied here, so nothing in the copy may take focus.
                inert
                className={cn(
                  pillClassName,
                  'pointer-events-none absolute inset-0 z-10 [clip-path:inset(var(--segmented-control-indicator-top,0px)_calc(100%_-_var(--segmented-control-indicator-left,0px)_-_var(--segmented-control-indicator-width,0px))_calc(100%_-_var(--segmented-control-indicator-top,0px)_-_var(--segmented-control-indicator-height,100%))_var(--segmented-control-indicator-left,0px)_round_max(0px,calc(var(--list-radius)-2px)))] transition-[clip-path] duration-(--motion-morph-duration) ease-(--motion-morph-easing) data-[activation-direction=none]:transition-none motion-reduce:transition-none group-data-disabled/segmented-control:opacity-50',
                )}
              >
                <span className={cn(segmentedControlRow, 'h-full')}>
                  <SegmentedControlCopyContext value={true}>
                    {children}
                  </SegmentedControlCopyContext>
                </span>
              </SegmentedControlIndicator>
            </SegmentedControlValueContext>
          )}
        </SegmentedControlPrimitive>
      </div>
    </div>
  )
}

const segmentLayout = cn(
  pillItemLayout,
  'shrink-0',
  // A column reads down its start edge, and a label longer than it wraps.
  'group-data-[orientation=vertical]/segmented-control:h-auto group-data-[orientation=vertical]/segmented-control:min-h-[calc(var(--control-height)_-_6px)] group-data-[orientation=vertical]/segmented-control:justify-start group-data-[orientation=vertical]/segmented-control:py-1.5 group-data-[orientation=vertical]/segmented-control:text-start group-data-[orientation=vertical]/segmented-control:whitespace-normal',
)

function SegmentedControlItem({
  className,
  children,
  ...props
}: Omit<
  ComponentProps<typeof SegmentedControlItemPrimitive>,
  'className' | 'children' | 'render'
> & {
  className?: string
  children?: ReactNode
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
    <SegmentedControlItemPrimitive
      className={cn(
        segmentLayout,
        pillItemClassName,
        // Until the page runs and the pill is placed, the pick draws itself.
        '[[data-slot=segmented-control]:not([data-mounted])>&]:data-checked:bg-primary [[data-slot=segmented-control]:not([data-mounted])>&]:data-checked:text-primary-foreground',
        className,
      )}
      {...props}
    >
      {content}
    </SegmentedControlItemPrimitive>
  )
}

/**
 * A segment's icon: `children`, and `checkedIcon` while the segment is
 * picked. It rolls to the other icon as a Tab's icon does. A segment whose
 * icon stays the same takes it as a plain child: rolling to itself shows
 * nothing change.
 */
function SegmentedControlIcon({
  checkedIcon,
  children,
}: {
  checkedIcon: ReactNode
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
