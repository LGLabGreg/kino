'use client'

import { Button } from '@/registry/components/kino/button'
import {
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/registry/components/kino/dialog'
import { mergeRefs } from '@/registry/lib/refs'
import { refuse } from '@/registry/lib/refuse'
import { AlertDialog as AlertDialogPrimitive } from '@base-ui/react/alert-dialog'
import { cva, type VariantProps } from 'class-variance-authority'
import { type ComponentProps, createContext, use, useRef, useState } from 'react'

import { cn } from '@/lib/utils'

interface AlertDialogContextValue {
  /** An action's promise hasn't settled yet. */
  pending: boolean
  /** Closes the dialog after an action, or holds it open until its promise settles. */
  settle: (result: unknown) => void
}

const AlertDialogContext = createContext<AlertDialogContextValue | null>(null)

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as PromiseLike<unknown>).then === 'function'
  )
}

/**
 * Whether the dialog closes after an action returned `result`: at once for a
 * plain value, and for a promise once it resolves, but not if it rejects.
 */
function closesAfter(result: unknown): true | Promise<boolean> {
  if (!isPromiseLike(result)) return true
  return Promise.resolve(result).then(
    () => true,
    () => false,
  )
}

/**
 * A press outside never closes it. While an action's promise runs, Escape and
 * Cancel don't either.
 */
function AlertDialog<Payload>({
  onOpenChange,
  onOpenChangeComplete,
  actionsRef,
  ...props
}: AlertDialogPrimitive.Root.Props<Payload>) {
  const ownActions = useRef<AlertDialogPrimitive.Root.Actions>(null)
  const actions = actionsRef ?? ownActions
  const [pending, setPending] = useState(false)
  const running = useRef(false)

  const settle = (result: unknown) => {
    if (running.current) return
    const closes = closesAfter(result)
    if (closes === true) {
      actions.current?.close()
      return
    }
    running.current = true
    setPending(true)
    void closes.then((closes) => {
      running.current = false
      // Once it worked, the footer stays as it is while the dialog leaves.
      if (closes) actions.current?.close()
      else setPending(false)
    })
  }

  return (
    <AlertDialogContext value={{ pending, settle }}>
      <AlertDialogPrimitive.Root
        data-slot='alert-dialog'
        actionsRef={actions}
        onOpenChangeComplete={(open) => {
          if (!open) setPending(false)
          onOpenChangeComplete?.(open)
        }}
        onOpenChange={(open, details) => {
          if (!open && running.current) {
            details.cancel()
            return
          }
          onOpenChange?.(open, details)
        }}
        {...props}
      />
    </AlertDialogContext>
  )
}

function AlertDialogTrigger<Payload>(props: AlertDialogPrimitive.Trigger.Props<Payload>) {
  return <AlertDialogPrimitive.Trigger data-slot='alert-dialog-trigger' {...props} />
}

/** Answers a press outside, which doesn't close it, with the swell that says no. */
function answerPressOutside(popup: HTMLElement) {
  const viewport = popup.parentElement
  if (!viewport) return () => {}
  let settle: (() => void) | undefined
  const onPointerDown = (event: PointerEvent) => {
    if (event.target === viewport) settle = refuse(popup)
  }
  // The viewport can't take focus: without this, a press there leaves focus on <body>.
  const onMouseDown = (event: MouseEvent) => {
    if (event.target === viewport) event.preventDefault()
  }
  viewport.addEventListener('pointerdown', onPointerDown)
  viewport.addEventListener('mousedown', onMouseDown)
  return () => {
    settle?.()
    viewport.removeEventListener('pointerdown', onPointerDown)
    viewport.removeEventListener('mousedown', onMouseDown)
  }
}

/**
 * The Dialog's box and motion, without a close button. A press outside makes
 * it swell for a moment. Focus starts on Cancel. `variant='badge'` centres the
 * header and stacks the actions.
 */
function AlertDialogContent({
  className,
  variant = 'default',
  initialFocus,
  ref,
  ...props
}: Omit<ComponentProps<typeof DialogContent>, 'showCloseButton'> & {
  variant?: 'default' | 'badge'
}) {
  const popupRef = useRef<HTMLElement | null>(null)
  return (
    <DialogContent
      data-slot='alert-dialog-content'
      ref={mergeRefs(popupRef, ref, (popup: HTMLDivElement | null) =>
        popup ? answerPressOutside(popup) : undefined,
      )}
      showCloseButton={false}
      initialFocus={
        initialFocus ??
        (() =>
          popupRef.current?.querySelector<HTMLElement>(
            '[data-slot=alert-dialog-cancel]',
          ) ?? true)
      }
      data-variant={variant}
      className={cn(
        // It swells to 60% of a press's depth, as fast as a press goes down, and springs back as it entered. Leaving, it leaves as the Dialog does.
        'group/alert-dialog not-data-ending-style:data-refused:scale-[calc(1+(1-var(--motion-press-scale))*0.6)] not-data-ending-style:data-refused:duration-[calc(var(--motion-press-duration)*0.4)] not-data-ending-style:data-refused:ease-(--motion-press-easing) data-[variant=badge]:max-w-xs data-[variant=badge]:[--panel-footer:var(--background)] motion-reduce:not-data-ending-style:data-refused:scale-100 max-sm:data-[variant=badge]:max-w-none',
        className,
      )}
      {...props}
    />
  )
}

function AlertDialogHeader({
  className,
  ...props
}: Omit<ComponentProps<typeof DialogHeader>, 'className'> & {
  className?: string
}) {
  return (
    <DialogHeader
      data-slot='alert-dialog-header'
      className={cn(
        'group-data-[variant=badge]/alert-dialog:items-center group-data-[variant=badge]/alert-dialog:pb-(--surface-gap) group-data-[variant=badge]/alert-dialog:text-center',
        className,
      )}
      {...props}
    />
  )
}

const alertDialogMediaVariants = cva(
  "mb-1.5 flex size-11 shrink-0 items-center justify-center rounded-full [&_svg:not([class*='size-'])]:size-5",
  {
    variants: {
      variant: {
        default: 'bg-muted text-foreground',
        destructive: 'bg-destructive/10 text-destructive dark:bg-destructive/20',
      },
    },
    defaultVariants: { variant: 'default' },
  },
)

/** A tinted circle for an icon, above the title. It is hidden from assistive technology: the title says what it means. */
function AlertDialogMedia({
  className,
  variant,
  ...props
}: Omit<
  ComponentProps<'span'> & VariantProps<typeof alertDialogMediaVariants>,
  'className'
> & { className?: string }) {
  return (
    <span
      data-slot='alert-dialog-media'
      aria-hidden
      className={cn(alertDialogMediaVariants({ variant }), className)}
      {...props}
    />
  )
}

function AlertDialogTitle({
  className,
  ...props
}: Omit<ComponentProps<typeof DialogTitle>, 'className'> & {
  className?: string
}) {
  return <DialogTitle data-slot='alert-dialog-title' className={className} {...props} />
}

function AlertDialogDescription(props: ComponentProps<typeof DialogDescription>) {
  return <DialogDescription data-slot='alert-dialog-description' {...props} />
}

/** What scrolls when the dialog is taller than the screen, such as a field to type a name into. */
function AlertDialogBody({
  className,
  ...props
}: Omit<ComponentProps<typeof DialogBody>, 'className'> & {
  className?: string
}) {
  return (
    <DialogBody
      data-slot='alert-dialog-body'
      className={cn(
        'group-data-[variant=badge]/alert-dialog:pb-(--surface-gap)',
        className,
      )}
      {...props}
    />
  )
}

/**
 * Why the action failed. It is a status region that is there, empty, before
 * its text arrives, so the text is announced.
 */
function AlertDialogError({ className, ...props }: ComponentProps<'p'>) {
  return (
    <p
      data-slot='alert-dialog-error'
      role='status'
      className={cn('text-destructive text-sm text-pretty empty:sr-only', className)}
      {...props}
    />
  )
}

function AlertDialogFooter({
  className,
  ...props
}: Omit<ComponentProps<typeof DialogFooter>, 'className'> & {
  className?: string
}) {
  return (
    <DialogFooter
      data-slot='alert-dialog-footer'
      className={cn(
        'group-data-[variant=badge]/alert-dialog:border-t-0 group-data-[variant=badge]/alert-dialog:pt-0 group-data-[variant=badge]/alert-dialog:pb-(--surface-padding-lg) group-data-[variant=badge]/alert-dialog:*:w-full group-data-[variant=badge]/alert-dialog:@xs:flex-col-reverse group-data-[variant=badge]/alert-dialog:@xs:flex-nowrap group-data-[variant=badge]/alert-dialog:@xs:justify-start',
        className,
      )}
      {...props}
    />
  )
}

/**
 * Closes the dialog without doing anything: an outline Button unless
 * `render` says otherwise. It can't be pressed while an action runs, and under
 * reduced motion it lights up at a press outside.
 */
function AlertDialogCancel({
  className,
  disabled,
  render = <Button variant='outline' />,
  ...props
}: Omit<AlertDialogPrimitive.Close.Props, 'className'> & {
  className?: string
}) {
  const pending = use(AlertDialogContext)?.pending ?? false
  return (
    <AlertDialogPrimitive.Close
      data-slot='alert-dialog-cancel'
      disabled={disabled || pending}
      render={render}
      className={cn(
        'motion-reduce:in-data-refused:border-ring motion-reduce:in-data-refused:ring-3 motion-reduce:in-data-refused:ring-ring/50',
        className,
      )}
      {...props}
    />
  )
}

type ButtonClick = NonNullable<ComponentProps<typeof Button>['onClick']>

/**
 * The action, as a Button. When `onClick` returns, the dialog closes. When it
 * returns a promise, the dialog stays open and the button shows a spinner
 * until it settles: it closes once the promise resolves, and stays open when
 * it rejects. The dialog doesn't log a rejection: catch it to show why in
 * `AlertDialogError`.
 */
function AlertDialogAction({
  onClick,
  loading,
  ...props
}: Omit<ComponentProps<typeof Button>, 'onClick'> & {
  /** Return a promise to keep the dialog open until it settles. */
  onClick?: (event: Parameters<ButtonClick>[0]) => unknown
}) {
  const context = use(AlertDialogContext)
  return (
    <Button
      data-slot='alert-dialog-action'
      loading={loading || context?.pending}
      onClick={(event) => {
        context?.settle(onClick?.(event))
      }}
      {...props}
    />
  )
}

export {
  AlertDialog,
  AlertDialogAction,
  AlertDialogBody,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogError,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
  AlertDialogTrigger,
  closesAfter,
}
