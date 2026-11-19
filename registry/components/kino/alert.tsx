'use client'

import { Button } from '@/registry/components/kino/button'
import { IconPlaceholder } from '@/registry/icons/icon-placeholder'
import { useControllable } from '@/registry/lib/controllable'
import {
  NoticeIcon,
  noticeActionsClassName,
  noticeDescriptionClassName,
  noticeTextClassName,
  noticeTitleClassName,
  type NoticeType,
} from '@/registry/lib/notice'
import { collapseClassName, followPanelContent } from '@/registry/lib/resize'
import { Collapsible as CollapsiblePrimitive } from '@base-ui/react/collapsible'
import { cva } from 'class-variance-authority'
import { type ComponentProps, type ReactNode, useEffect, useRef, useState } from 'react'

import { cn } from '@/lib/utils'

/*
 * A message that sits in the page: the Toast's icon, title and description in
 * a box of their own. One that opens or closes after the page has loaded
 * grows or shrinks on its height, as an Accordion's panel does, so what is
 * below it moves; while it closes it keeps what it last said. A change of
 * type rolls its icon to the next and crossfades its colours, and the box
 * glides to its new height when the text changes.
 */

const alertVariants = cva(
  'flex items-start gap-3 rounded-(--surface-radius) p-(--surface-padding) text-sm ring-1 ring-inset transition-[color,background-color,box-shadow] duration-(--motion-press-duration) ease-(--motion-press-fade-easing) has-data-[slot=alert-close]:pe-[calc(var(--surface-padding)-(--spacing(2)))] forced-colors:outline forced-colors:-outline-offset-1',
  {
    variants: {
      type: {
        info: 'bg-card text-card-foreground ring-foreground/10',
        loading: 'bg-card text-card-foreground ring-foreground/10',
        // The Badge's tints. A success's and a warning's title is their foreground colour, for 4.5:1.
        success:
          'bg-success/6 text-success-foreground ring-success/25 dark:bg-success/12 dark:ring-success/35',
        warning:
          'bg-warning/6 text-warning-foreground ring-warning/25 dark:bg-warning/12 dark:ring-warning/35',
        // An error's title takes a fifth of the foreground, as the Badge's text does, for 4.5:1.
        error:
          'bg-destructive/6 text-[color-mix(in_oklch,var(--destructive),var(--foreground)_20%)] ring-destructive/25 dark:bg-destructive/12 dark:ring-destructive/35',
      },
    },
    defaultVariants: { type: 'info' },
  },
)

interface Shown {
  type: NoticeType
  icon: ReactNode
  children: ReactNode
}

/**
 * What the alert shows: what it was given while it is open, and what it last
 * showed while it closes, so its message never empties as it shrinks away.
 */
function shownAfter(previous: Shown, next: Shown, open: boolean): Shown {
  if (!open) return previous
  if (
    previous.type === next.type &&
    previous.icon === next.icon &&
    previous.children === next.children
  )
    return previous
  return next
}

function useShown(next: Shown, open: boolean) {
  const [shown, setShown] = useState(next)
  const after = shownAfter(shown, next, open)
  if (after !== shown) setShown(after)
  return after
}

/**
 * The alert's own box, which mounts with the panel. Text that grows or
 * shrinks moves the panel with it. The panel fades its child in and out, so
 * the box sits one level in, where its colours keep their own transition.
 */
function AlertSurface({ className, ...props }: ComponentProps<'div'>) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const surface = ref.current
    const panel = surface?.parentElement
    if (!surface || !panel) return
    return followPanelContent(panel, surface, '--collapsible-panel-height')
  }, [])

  return (
    <div ref={ref}>
      <div className={className} {...props} />
    </div>
  )
}

/**
 * A message in the page. It is a live region from the start: what it says
 * when it opens, or when its text changes, is read out, at once for an
 * `error` and when the screen reader is free for any other type. What it says
 * as the page loads is read in its place. Given `open`, it stays in the tree
 * while closed, and opening or closing it moves what is below it.
 */
function Alert({
  type = 'info',
  icon,
  showCloseButton = false,
  open: openProp,
  defaultOpen = true,
  onOpenChange,
  className,
  children,
  ...props
}: Omit<
  CollapsiblePrimitive.Root.Props,
  'className' | 'render' | 'disabled' | 'open' | 'defaultOpen' | 'onOpenChange'
> & {
  className?: string
  /** Its kind, which picks its icon and colour. */
  type?: NoticeType
  /** An icon in place of the type's own, or `null` for none. */
  icon?: ReactNode
  /** A button at its end that closes it. */
  showCloseButton?: boolean
  open?: boolean
  defaultOpen?: boolean
  /** Called when its close button is pressed, with `false`. */
  onOpenChange?: (open: boolean) => void
}) {
  const [open, setOpen] = useControllable(openProp, defaultOpen, onOpenChange)
  const shown = useShown({ type, icon, children }, open)

  return (
    <CollapsiblePrimitive.Root
      data-slot='alert'
      data-type={shown.type}
      role={shown.type === 'error' ? 'alert' : 'status'}
      open={open}
      // Closed, it stays in the page as an empty live region, so what it says when it opens is read out.
      className={cn('group/alert min-w-0', className)}
      {...props}
    >
      <CollapsiblePrimitive.Panel
        data-slot='alert-panel'
        // Clipped down the page only, so the close button's focus ring keeps its sides.
        className={cn(
          collapseClassName,
          'overflow-y-clip [--collapse-height:var(--collapsible-panel-height)]',
        )}
      >
        <AlertSurface
          data-slot='alert-surface'
          className={alertVariants({ type: shown.type })}
        >
          <NoticeIcon data-slot='alert-icon' type={shown.type} icon={shown.icon} />
          <div data-slot='alert-content' className={noticeTextClassName}>
            {shown.children}
          </div>
          {showCloseButton ? <AlertClose onClick={() => setOpen(false)} /> : null}
        </AlertSurface>
      </CollapsiblePrimitive.Panel>
    </CollapsiblePrimitive.Root>
  )
}

function AlertTitle({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot='alert-title'
      className={cn(noticeTitleClassName, className)}
      {...props}
    />
  )
}

function AlertDescription({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot='alert-description'
      className={cn(
        noticeDescriptionClassName,
        // A tinted alert's takes more of the foreground than its title, for 4.5:1 on the tint.
        'group-data-[type=error]/alert:text-[color-mix(in_oklch,var(--destructive),var(--foreground)_40%)] group-data-[type=success]/alert:text-[color-mix(in_oklch,var(--success-foreground),var(--foreground)_30%)] group-data-[type=warning]/alert:text-[color-mix(in_oklch,var(--warning-foreground),var(--foreground)_30%)] *:[a]:hover:text-foreground *:[a]:underline *:[a]:underline-offset-3',
        className,
      )}
      {...props}
    />
  )
}

/** A row of buttons or links under the description. */
function AlertActions({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot='alert-actions'
      className={cn(noticeActionsClassName, className)}
      {...props}
    />
  )
}

function AlertClose({ className, children, ...props }: ComponentProps<typeof Button>) {
  return (
    <Button
      data-slot='alert-close'
      variant='ghost'
      size='icon-xs'
      aria-label='Close'
      className={cn('-mt-0.5 text-current/70 hover:text-current', className)}
      {...props}
    >
      {children ?? (
        <IconPlaceholder
          lucide='XIcon'
          tabler='IconX'
          hugeicons='Cancel01Icon'
          phosphor='XIcon'
          remixicon='RiCloseLine'
          aria-hidden
        />
      )}
    </Button>
  )
}

export { Alert, AlertActions, AlertDescription, AlertTitle, alertVariants, shownAfter }
