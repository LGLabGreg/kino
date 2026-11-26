'use client'

import { SwapText, flattenChildren } from '@/registry/lib/swap'
import { mergeProps, type PartProps, renderElement } from '@ui-sdk/react/primitive'
import { cva, type VariantProps } from 'class-variance-authority'
import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

/*
 * A status, a count or a tag. It has the type and corner of the Tag input's
 * chips, a little shorter since nothing in it is pressed. A label that changes
 * crossfades as the Button's does, and a count that changes rolls to its new
 * value when it is an AnimatedNumber.
 */

const badgeVariants = cva(
  // As tall as a line of small body text at every density, so a row with a badge is as tall
  // as one without; only its sides follow the density. A change of variant, such as a status
  // that moves on, crossfades on `press`, as the chips do.
  "inline-flex h-5 max-w-full min-w-5 shrink-0 items-center justify-center gap-1 overflow-hidden rounded-(--control-radius-xs) border px-[calc(var(--control-padding)*0.6)] text-xs leading-none font-medium whitespace-nowrap tabular-nums transition-[color,background-color,border-color,box-shadow] duration-(--motion-press-duration) ease-(--motion-press-fade-easing) focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-hidden [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3",
  {
    variants: {
      // Each variant names its own border colour, as the Button's do, so the
      // classes also work on a link. A link darkens on hover as a Button does.
      variant: {
        default:
          'border-transparent bg-primary text-primary-foreground [a]:hover:bg-primary/80',
        // These two take a tint of the text they sit in, as the Kbd does, so a count reads the
        // same on a page, in a muted tab list and in a picked tab's primary pill.
        secondary: 'border-transparent bg-current/8 [a]:hover:bg-current/14',
        outline: 'border-current/20 [a]:hover:bg-current/8',
        // The Button's destructive tint, with a fifth of the foreground in the text for 4.5:1.
        destructive:
          'border-transparent bg-destructive/10 text-[color-mix(in_oklch,var(--destructive),var(--foreground)_20%)] focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:focus-visible:ring-destructive/40 [a]:hover:bg-destructive/20 dark:[a]:hover:bg-destructive/30',
        // The same tint in green and amber, with their foreground colour for 4.5:1.
        success:
          'border-transparent bg-success/10 text-success-foreground focus-visible:ring-success/20 dark:bg-success/20 dark:focus-visible:ring-success/40 [a]:hover:bg-success/20 dark:[a]:hover:bg-success/30',
        warning:
          'border-transparent bg-warning/10 text-warning-foreground focus-visible:ring-warning/20 dark:bg-warning/20 dark:focus-visible:ring-warning/40 [a]:hover:bg-warning/20 dark:[a]:hover:bg-warning/30',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
)

function Badge({
  className,
  variant,
  render,
  children,
  ...props
}: Omit<PartProps<'span'>, 'className' | 'children'> & {
  className?: string
  children?: ReactNode
} & VariantProps<typeof badgeVariants>) {
  return renderElement(
    'span',
    mergeProps(
      {
        'data-slot': 'badge',
        'data-variant': variant ?? 'default',
        className: cn(badgeVariants({ variant }), className),
        children: <Label>{children}</Label>,
      },
      props,
    ),
    render,
  )
}

/** A label of words or a number crossfades to the next one, and the badge glides to its width. */
function Label({ children }: { children: ReactNode }) {
  const parts = flattenChildren(children)
  if (
    parts.length > 0 &&
    parts.every((part) => typeof part === 'string' || typeof part === 'number')
  )
    return <SwapText text={parts.join('')} />
  return children
}

export { Badge, badgeVariants }
