'use client'

import { Button } from '@/registry/components/kino/button'
import { DialogBody, DialogFooter, DialogHeader } from '@/registry/components/kino/dialog'
import {
  PanelSurface,
  panelDescriptionClassName,
  panelDialogClassName,
  panelFooterTint,
  panelOverlayClassName,
  panelTitleClassName,
} from '@/registry/lib/panel'
import { PopupLayerContext, useOwnPopupLayer } from '@/registry/lib/popup'
import { mergeRefs } from '@/registry/lib/refs'
import { refuse } from '@/registry/lib/refuse'
import {
  AlertDialog as AlertDialogPrimitive,
  AlertDialogBackdrop as AlertDialogBackdropPrimitive,
  AlertDialogClose as AlertDialogClosePrimitive,
  AlertDialogContent as AlertDialogContentPrimitive,
  AlertDialogDescription as AlertDialogDescriptionPrimitive,
  AlertDialogTitle as AlertDialogTitlePrimitive,
  AlertDialogTrigger as AlertDialogTriggerPrimitive,
} from '@ui-sdk/react/alert-dialog'
import type { DialogContentState } from '@ui-sdk/react/dialog'
import { mergeProps, type PartProps, renderElement } from '@ui-sdk/react/primitive'
import { cva, type VariantProps } from 'class-variance-authority'
import {
  type ComponentProps,
  createContext,
  type ReactNode,
  type RefObject,
  use,
  useMemo,
  useRef,
} from 'react'

import { cn } from '@/lib/utils'

/**
 * The Dialog's box, which swells to 60% of a press's depth when a press
 * outside is refused, as fast as a press goes down, and springs back as it
 * entered. Leaving, it leaves as the Dialog does.
 */
const alertDialogBoxClassName = cn(
  panelDialogClassName,
  panelFooterTint,
  'group/alert-dialog not-data-ending-style:data-refused:scale-[calc(1+(1-var(--motion-press-scale))*0.6)] not-data-ending-style:data-refused:duration-[calc(var(--motion-press-duration)*0.4)] not-data-ending-style:data-refused:ease-(--motion-press-easing) data-[variant=badge]:max-w-xs data-[variant=badge]:[--panel-footer:var(--background)] motion-reduce:not-data-ending-style:data-refused:scale-100 max-sm:data-[variant=badge]:max-w-none',
)

/** Under reduced motion, Cancel lights up at a press outside in place of the swell. */
const alertDialogCancelClassName =
  'motion-reduce:in-data-refused:border-ring motion-reduce:in-data-refused:ring-3 motion-reduce:in-data-refused:ring-ring/50'

/* The alert dialog's box, which swells when a press outside is refused. */
const AlertDialogBoxContext = createContext<RefObject<HTMLElement | null> | null>(null)

/**
 * Only its buttons close it: a press outside makes it swell for a moment
 * instead. While an action's promise runs, nothing but the promise closes it.
 */
function AlertDialog({
  onDismissAttempt,
  ...props
}: ComponentProps<typeof AlertDialogPrimitive>) {
  const box = useRef<HTMLElement | null>(null)
  return (
    <AlertDialogBoxContext value={box}>
      <AlertDialogPrimitive
        onDismissAttempt={(details) => {
          if (details.reason === 'outside-press' && box.current) refuse(box.current)
          onDismissAttempt?.(details)
        }}
        {...props}
      />
    </AlertDialogBoxContext>
  )
}

function AlertDialogTrigger(props: ComponentProps<typeof AlertDialogTriggerPrimitive>) {
  return <AlertDialogTriggerPrimitive {...props} />
}

/**
 * The Dialog's box and motion, without a close button. A press outside makes
 * it swell for a moment. Focus starts on its first button, Cancel.
 * `variant='badge'` centres the header and stacks the actions. `children`
 * may be a function of its state, such as to read a trigger's `payload`.
 */
function AlertDialogContent<Payload = unknown>({
  className,
  children,
  variant = 'default',
  inline,
  ref,
  ...props
}: Omit<
  ComponentProps<typeof AlertDialogContentPrimitive<Payload>>,
  'className' | 'children'
> & {
  className?: string
  children?: ReactNode | ((state: DialogContentState<Payload>) => ReactNode)
  variant?: 'default' | 'badge'
}) {
  const box = use(AlertDialogBoxContext)
  const [layer, setLayer] = useOwnPopupLayer(!inline)
  const own = useMemo(() => mergeRefs(ref, box, setLayer), [ref, box, setLayer])
  return (
    <>
      <AlertDialogBackdrop />
      <AlertDialogContentPrimitive<Payload>
        ref={own}
        inline={inline}
        data-variant={variant}
        className={cn(alertDialogBoxClassName, className)}
        {...props}
      >
        {(state) => (
          <PopupLayerContext value={layer}>
            <PanelSurface>
              {typeof children === 'function' ? children(state) : children}
            </PanelSurface>
          </PopupLayerContext>
        )}
      </AlertDialogContentPrimitive>
    </>
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
      data-alert-dialog-header=''
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
  render,
  ...props
}: Omit<PartProps<'span'>, 'className'> & {
  className?: string
} & VariantProps<typeof alertDialogMediaVariants>) {
  return renderElement(
    'span',
    {
      'data-slot': 'alert-dialog-media',
      'aria-hidden': true,
      className: cn(alertDialogMediaVariants({ variant }), className),
      ...props,
    },
    render,
  )
}

function AlertDialogTitle({
  className,
  ...props
}: Omit<ComponentProps<typeof AlertDialogTitlePrimitive>, 'className'> & {
  className?: string
}) {
  return (
    <AlertDialogTitlePrimitive
      className={cn(panelTitleClassName, className)}
      {...props}
    />
  )
}

function AlertDialogDescription({
  className,
  ...props
}: Omit<ComponentProps<typeof AlertDialogDescriptionPrimitive>, 'className'> & {
  className?: string
}) {
  return (
    <AlertDialogDescriptionPrimitive
      className={cn(panelDescriptionClassName, className)}
      {...props}
    />
  )
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
      data-alert-dialog-body=''
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
function AlertDialogError({
  className,
  render,
  ...props
}: Omit<PartProps<'p'>, 'className'> & { className?: string }) {
  return renderElement(
    'p',
    {
      'data-slot': 'alert-dialog-error',
      role: 'status',
      className: cn('text-destructive text-sm text-pretty empty:sr-only', className),
      ...props,
    },
    render,
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
      data-alert-dialog-footer=''
      className={cn(
        'group-data-[variant=badge]/alert-dialog:border-t-0 group-data-[variant=badge]/alert-dialog:pt-0 group-data-[variant=badge]/alert-dialog:pb-(--surface-padding-lg) group-data-[variant=badge]/alert-dialog:*:w-full group-data-[variant=badge]/alert-dialog:@xs:flex-col-reverse group-data-[variant=badge]/alert-dialog:@xs:flex-nowrap group-data-[variant=badge]/alert-dialog:@xs:justify-start',
        className,
      )}
      {...props}
    />
  )
}

function AlertDialogClose(props: ComponentProps<typeof AlertDialogClosePrimitive>) {
  return <AlertDialogClosePrimitive {...props} />
}

/**
 * Closes the dialog without doing anything: an outline Button unless
 * `render` says otherwise. It can't be pressed while an action runs, and under
 * reduced motion it lights up at a press outside.
 */
/**
 * The dim behind the dialog. Opened from another dialog, it doesn't dim the
 * page again: the dialog below already does, and steps back itself.
 */
function AlertDialogBackdrop({
  className,
  ...props
}: Omit<ComponentProps<typeof AlertDialogBackdropPrimitive>, 'className'> & {
  className?: string
}) {
  return (
    <AlertDialogBackdropPrimitive
      className={cn(panelOverlayClassName, 'data-nested:invisible', className)}
      {...props}
    />
  )
}

function AlertDialogCancel({
  className,
  render = <Button variant='outline' />,
  ...props
}: Omit<ComponentProps<typeof AlertDialogClosePrimitive>, 'className'> & {
  className?: string
}) {
  return (
    <AlertDialogClosePrimitive
      data-alert-dialog-cancel=''
      render={render}
      className={cn(alertDialogCancelClassName, className)}
      {...props}
    />
  )
}

/**
 * The action, as a Button. Once `action` has run, the dialog closes. When it
 * returns a promise, the dialog stays open and the button shows a spinner
 * until it settles: it closes once the promise resolves, and stays open when
 * it rejects, so you can say why in `AlertDialogError`.
 */
function AlertDialogAction({
  action,
  value,
  variant,
  size,
  loading = false,
  className,
  children,
  ...props
}: Omit<ComponentProps<typeof Button>, 'render' | 'className'> & {
  className?: string
} & Pick<ComponentProps<typeof AlertDialogClosePrimitive>, 'action' | 'value'>) {
  return (
    <AlertDialogClosePrimitive
      action={action}
      value={value}
      render={(own, { pending }) => (
        <Button
          data-alert-dialog-action=''
          {...mergeProps(own, props)}
          variant={variant}
          size={size}
          loading={loading || pending}
          className={className}
        >
          {children}
        </Button>
      )}
    />
  )
}

export {
  AlertDialog,
  AlertDialogAction,
  AlertDialogBackdrop,
  AlertDialogBody,
  AlertDialogCancel,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogError,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
  AlertDialogTrigger,
  alertDialogBoxClassName,
  alertDialogCancelClassName,
}
