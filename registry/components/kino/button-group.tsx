'use client'

import {
  followPointer,
  type HighlightTarget,
  highlightClassName,
} from '@/registry/lib/highlight'
import { mergeProps, type PartProps, renderElement } from '@ui-sdk/react/primitive'
import { cva, type VariantProps } from 'class-variance-authority'
import { type ReactNode, useEffect, useRef, useState } from 'react'

import { cn } from '@/lib/utils'

const buttonGroupVariants = cva(
  [
    'group/button-group relative isolate flex w-fit items-stretch has-[>[role=group]]:gap-2 [&>*]:focus-visible:z-10',
    // A segment takes the group's corner at every size, whatever the group renders as.
    '[--control-radius-sm:var(--control-radius)] [--control-radius-xs:var(--control-radius)]',
    // A segment never shrinks on a press: the row's edges stay put.
    '[&>*]:active:scale-100!',
    // A filled segment paints under its clear border, so its border can be the divider.
    '[&>.bg-primary]:bg-clip-border [&>.bg-secondary]:bg-clip-border [&>[data-variant=destructive]]:bg-clip-border',
    // Each segment's own hover would snap from one to the next; the highlight shows it instead.
    // Under forced colours a segment keeps its own system colours.
    'not-forced-colors:[&>.border-border]:hover:bg-background! not-forced-colors:dark:[&>.border-border]:hover:bg-input/30! not-forced-colors:[&>.bg-primary]:hover:bg-primary! not-forced-colors:[&>.bg-secondary]:hover:bg-secondary! not-forced-colors:[&>[data-variant=destructive]]:hover:bg-destructive/10! not-forced-colors:dark:[&>[data-variant=destructive]]:hover:bg-destructive/20!',
  ],
  {
    variants: {
      // Base UI puts hidden focus guards beside an open menu's trigger, a
      // Tooltip puts a hidden copy of its label beside its trigger, a Copy
      // button puts its status region beside itself, and the
      // highlight is the group's last child, so the first and last segment are
      // counted without them (2026-11-15: a toolbar's grouped buttons with
      // tooltips lost their end corners). Every segment but the
      // first keeps its start border as the divider, and every one but the last
      // drops its end border, so a segment is the same size in any variant: a
      // toggle that fills when pressed doesn't move its neighbours.
      orientation: {
        horizontal: [
          'flex-row [&>*:not(:nth-child(1_of_:not([data-base-ui-focus-guard],[aria-owns],[hidden],[role=status],[data-slot=button-group-highlight])))]:rounded-s-none [&>*:not(:nth-last-child(1_of_:not([data-base-ui-focus-guard],[aria-owns],[hidden],[role=status],[data-slot=button-group-highlight])))]:rounded-e-none [&>*:not(:nth-last-child(1_of_:not([data-base-ui-focus-guard],[aria-owns],[hidden],[role=status],[data-slot=button-group-highlight])))]:border-e-0',
          '[&>.bg-primary:not(:nth-child(1_of_:not([data-base-ui-focus-guard],[aria-owns],[hidden],[role=status],[data-slot=button-group-highlight])))]:border-s [&>.bg-primary:not(:nth-child(1_of_:not([data-base-ui-focus-guard],[aria-owns],[hidden],[role=status],[data-slot=button-group-highlight])))]:border-s-[color-mix(in_oklch,var(--primary),var(--primary-foreground)_30%)] [&>.bg-secondary:not(:nth-child(1_of_:not([data-base-ui-focus-guard],[aria-owns],[hidden],[role=status],[data-slot=button-group-highlight])))]:border-s [&>.bg-secondary:not(:nth-child(1_of_:not([data-base-ui-focus-guard],[aria-owns],[hidden],[role=status],[data-slot=button-group-highlight])))]:border-s-[color-mix(in_oklch,var(--secondary),var(--foreground)_12%)] [&>[data-variant=destructive]:not(:nth-child(1_of_:not([data-base-ui-focus-guard],[aria-owns],[hidden],[role=status],[data-slot=button-group-highlight])))]:border-s-destructive/30 dark:[&>[data-variant=destructive]:not(:nth-child(1_of_:not([data-base-ui-focus-guard],[aria-owns],[hidden],[role=status],[data-slot=button-group-highlight])))]:border-s-destructive/40',
        ],
        // A column grows past one line, so its corners are a box's, never a
        // pill's: a pill's corner would curve across a segment's whole width.
        vertical: [
          'flex-col [--control-radius:var(--control-radius-capped)] [&>*:not(:nth-child(1_of_:not([data-base-ui-focus-guard],[aria-owns],[hidden],[role=status],[data-slot=button-group-highlight])))]:rounded-t-none [&>*:not(:nth-last-child(1_of_:not([data-base-ui-focus-guard],[aria-owns],[hidden],[role=status],[data-slot=button-group-highlight])))]:rounded-b-none [&>*:not(:nth-last-child(1_of_:not([data-base-ui-focus-guard],[aria-owns],[hidden],[role=status],[data-slot=button-group-highlight])))]:border-b-0',
          '[&>.bg-primary:not(:nth-child(1_of_:not([data-base-ui-focus-guard],[aria-owns],[hidden],[role=status],[data-slot=button-group-highlight])))]:border-t [&>.bg-primary:not(:nth-child(1_of_:not([data-base-ui-focus-guard],[aria-owns],[hidden],[role=status],[data-slot=button-group-highlight])))]:border-t-[color-mix(in_oklch,var(--primary),var(--primary-foreground)_30%)] [&>.bg-secondary:not(:nth-child(1_of_:not([data-base-ui-focus-guard],[aria-owns],[hidden],[role=status],[data-slot=button-group-highlight])))]:border-t [&>.bg-secondary:not(:nth-child(1_of_:not([data-base-ui-focus-guard],[aria-owns],[hidden],[role=status],[data-slot=button-group-highlight])))]:border-t-[color-mix(in_oklch,var(--secondary),var(--foreground)_12%)] [&>[data-variant=destructive]:not(:nth-child(1_of_:not([data-base-ui-focus-guard],[aria-owns],[hidden],[role=status],[data-slot=button-group-highlight])))]:border-t-destructive/30 dark:[&>[data-variant=destructive]:not(:nth-child(1_of_:not([data-base-ui-focus-guard],[aria-owns],[hidden],[role=status],[data-slot=button-group-highlight])))]:border-t-destructive/40',
        ],
      },
    },
    defaultVariants: {
      orientation: 'horizontal',
    },
  },
)

/** The segment `node` is in: a button or a link the highlight lands on, or something it doesn't. */
function segmentOf(group: HTMLElement, node: EventTarget | null): HighlightTarget {
  let segment = node instanceof Element ? node : null
  while (segment && segment.parentElement !== group) segment = segment.parentElement
  if (!(segment instanceof HTMLElement)) return 'gap'
  return segment.matches('button, a') &&
    !segment.matches('[data-disabled], :disabled, [aria-disabled="true"]')
    ? segment
    : 'none'
}

function ButtonGroup({
  className,
  orientation,
  children,
  render,
  ...props
}: Omit<PartProps<'div'>, 'className' | 'children'> &
  VariantProps<typeof buttonGroupVariants> & {
    className?: string
    children?: ReactNode
  }) {
  const [group, setGroup] = useState<HTMLDivElement | null>(null)
  const layerRef = useRef<HTMLSpanElement>(null)

  // One highlight for the whole row, so it glides from segment to segment.
  useEffect(() => {
    if (!group || !layerRef.current) return
    return followPointer(group, layerRef.current, {
      itemOf: (node) => segmentOf(group, node),
    })
  }, [group])

  // What the caller passes wins, so a ui-sdk group rendered as this one keeps
  // its own slot; its ref joins ours, the same function each render.
  return renderElement(
    'div',
    mergeProps(
      {
        ref: setGroup,
        role: 'group',
        'data-slot': 'button-group',
        'data-orientation': orientation ?? 'horizontal',
        className: cn(buttonGroupVariants({ orientation }), className),
        children: (
          <>
            {children}
            <span
              ref={layerRef}
              aria-hidden
              data-slot='button-group-highlight'
              className={cn(
                highlightClassName,
                'bg-foreground/7 z-20 group-has-[>:active]/button-group:bg-foreground/12 group-has-[>.bg-primary:hover]/button-group:bg-primary-foreground/15 group-has-[>.bg-primary:active]/button-group:bg-primary-foreground/22 group-has-[>[data-variant=destructive]:hover]/button-group:bg-destructive/10',
              )}
            />
          </>
        ),
      },
      props,
    ),
    render,
  )
}

function ButtonGroupText({
  className,
  render,
  ...props
}: Omit<PartProps<'div'>, 'className'> & { className?: string }) {
  return renderElement(
    'div',
    mergeProps(
      {
        'data-slot': 'button-group-text',
        className: cn(
          "flex items-center gap-1.5 rounded-(--control-radius) border bg-muted/60 px-(--control-padding) text-sm whitespace-nowrap text-muted-foreground tabular-nums [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4",
          className,
        ),
      },
      props,
    ),
    render,
  )
}

export { ButtonGroup, ButtonGroupText, buttonGroupVariants }
