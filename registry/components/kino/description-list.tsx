import { cva, type VariantProps } from 'class-variance-authority'
import type { ComponentProps } from 'react'

import { cn } from '@/lib/utils'

/*
 * Pairs of a label and its value. As a table lines its columns up, text
 * starts and amounts end: `align='start'` sets the labels in one column and
 * starts every value on one line after it, and `align='end'` puts the values
 * on the end edge, as a receipt lines its amounts up over a total. In a
 * narrow column, under 18rem, each value goes under its label. Each row is as
 * tall as a small control, so an action beside a value never makes its row
 * taller than the rest.
 */

/** Above and below a row's text, so one line makes a row as tall as a small control. */
const rowPadding = 'py-[calc((var(--control-height-sm)-1lh)/2)]'

const descriptionListVariants = cva(
  [
    'group/description-list @container/description-list grid w-full min-w-0 gap-x-4 text-sm',
    // The first and last rows' padding sits outside, so the text lines up with what's around it.
    '-my-[calc((var(--control-height-sm)-1lh)/2)]',
  ],
  {
    variants: {
      /** Where the values sit: on one line after the labels, or on the end edge. */
      align: {
        // The labels' column is as wide as the widest label, up to half the list.
        start: 'grid-cols-[fit-content(50%)_minmax(0,1fr)]',
        end: 'grid-cols-1',
      },
    },
    defaultVariants: { align: 'start' },
  },
)

function DescriptionList({
  className,
  align,
  ...props
}: ComponentProps<'dl'> & VariantProps<typeof descriptionListVariants>) {
  return (
    <dl
      data-slot='description-list'
      data-align={align ?? 'start'}
      className={cn(descriptionListVariants({ align }), className)}
      {...props}
    />
  )
}

const descriptionListItemVariants = cva(
  [
    'group/description-list-item col-span-full grid min-w-0 grid-cols-1 gap-x-4 gap-y-0.5',
    rowPadding,
    // At the start, every row shares the list's columns, so the values line up.
    '@2xs/description-list:group-data-[align=start]/description-list:grid-cols-subgrid',
    // At the end, the label keeps a share of the row, and the value takes what it needs of the rest.
    '@2xs/description-list:group-data-[align=end]/description-list:grid-cols-[minmax(min(6rem,33%),1fr)_minmax(0,auto)]',
  ],
  {
    variants: {
      variant: {
        default: '',
        /** The sum of the rows above it, under a line. */
        total: [
          'mt-[calc((var(--control-height-sm)-1lh)/2)] border-t font-medium',
          'forced-colors:border-[CanvasText]',
        ],
      },
    },
    defaultVariants: { variant: 'default' },
  },
)

/** A label and its value. */
function DescriptionListItem({
  className,
  variant,
  ...props
}: ComponentProps<'div'> & VariantProps<typeof descriptionListItemVariants>) {
  return (
    <div
      data-slot='description-list-item'
      data-variant={variant ?? 'default'}
      className={cn(descriptionListItemVariants({ variant }), className)}
      {...props}
    />
  )
}

/** The label: muted, except a total's. A long one wraps. */
function DescriptionListTerm({ className, ...props }: ComponentProps<'dt'>) {
  return (
    <dt
      data-slot='description-list-term'
      className={cn(
        'text-muted-foreground min-w-0 text-pretty wrap-anywhere group-data-[variant=total]/description-list-item:text-foreground',
        className,
      )}
      {...props}
    />
  )
}

/**
 * The value, and its actions after it. A long unbroken word, such as an ID or
 * a URL, breaks rather than run out of the row.
 */
function DescriptionListDetails({ className, ...props }: ComponentProps<'dd'>) {
  return (
    <dd
      data-slot='description-list-details'
      className={cn(
        // A block, so its text flows, wraps and truncates as text; with an action, a row.
        'text-foreground min-w-0 tabular-nums wrap-anywhere',
        // Elements in the text, such as a badge, sit on the line's top, so they never make it taller.
        '*:align-top',
        'has-data-[slot=description-list-action]:flex has-data-[slot=description-list-action]:items-start has-data-[slot=description-list-action]:gap-2',
        '@2xs/description-list:group-data-[align=end]/description-list:justify-end @2xs/description-list:group-data-[align=end]/description-list:text-end',
        className,
      )}
      {...props}
    />
  )
}

/**
 * Buttons beside a value, such as Copy or Edit: an `xs` button takes no more
 * than a line's height, so its row stays as tall as the others.
 */
function DescriptionListAction({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot='description-list-action'
      className={cn(
        // At the row's end, so a value that changes width never moves it; on the end edge, right after the value.
        'ms-auto flex shrink-0 items-center gap-1 -my-[calc((var(--control-height-xs)-1lh)/2)] @2xs/description-list:group-data-[align=end]/description-list:ms-0',
        className,
      )}
      {...props}
    />
  )
}

/**
 * The value beside an action. An action makes the details a row, so a value
 * made of text and elements goes in here to flow as one, and to truncate.
 */
function DescriptionListValue({ className, ...props }: ComponentProps<'span'>) {
  return (
    <span
      data-slot='description-list-value'
      className={cn('min-w-0 wrap-anywhere', className)}
      {...props}
    />
  )
}

export {
  DescriptionList,
  DescriptionListAction,
  DescriptionListDetails,
  DescriptionListItem,
  DescriptionListTerm,
  DescriptionListValue,
  descriptionListItemVariants,
  descriptionListVariants,
}
