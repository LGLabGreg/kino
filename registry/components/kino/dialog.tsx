'use client'

import { Button } from '@/registry/components/kino/button'
import {
  PanelCloseIcon,
  PanelSurface,
  panelBodyClassName,
  panelBodyContentClassName,
  panelBodyFrameClassName,
  panelCloseClassName,
  panelDescriptionClassName,
  panelDialogClassName,
  panelFooterClassName,
  panelFooterTint,
  panelHeaderClassName,
  panelOverlayClassName,
  panelTitleClassName,
  useScrollRegion,
} from '@/registry/lib/panel'
import { mergeRefs } from '@/registry/lib/refs'
import type { DialogContentState } from '@ui-sdk/react/dialog'
import {
  Dialog as DialogPrimitive,
  DialogBackdrop as DialogBackdropPrimitive,
  DialogClose as DialogClosePrimitive,
  DialogContent as DialogContentPrimitive,
  DialogDescription as DialogDescriptionPrimitive,
  DialogTitle as DialogTitlePrimitive,
  DialogTrigger as DialogTriggerPrimitive,
} from '@ui-sdk/react/dialog'
import { type PartProps, renderElement } from '@ui-sdk/react/primitive'
import { type ComponentProps, type ReactNode, useMemo, useRef } from 'react'

import { cn } from '@/lib/utils'

function Dialog(props: ComponentProps<typeof DialogPrimitive>) {
  return <DialogPrimitive {...props} />
}

function DialogTrigger(props: ComponentProps<typeof DialogTriggerPrimitive>) {
  return <DialogTriggerPrimitive {...props} />
}

function DialogClose(props: ComponentProps<typeof DialogClosePrimitive>) {
  return <DialogClosePrimitive {...props} />
}

/**
 * The dim behind the dialog. A dialog opened from another one leaves its
 * dim out: the one below already dims the page, and steps back itself.
 */
function DialogBackdrop({
  className,
  ...props
}: Omit<ComponentProps<typeof DialogBackdropPrimitive>, 'className'> & {
  className?: string
}) {
  return (
    <DialogBackdropPrimitive
      className={cn(panelOverlayClassName, 'data-nested:invisible', className)}
      {...props}
    />
  )
}

/**
 * The centred dialog with its dim. When its content changes height while it
 * is open, the box resizes and the footer stays on its bottom edge.
 * `className` goes to the box; `children` are its parts, or a function of
 * its state that returns them, such as to read the `payload` a trigger
 * passed. With `bare`, it is the box alone, laid out by its own classes, for
 * a dialog that isn't centred over the page, such as a chat window in a
 * corner.
 */
function DialogContent<Payload = unknown>({
  className,
  children,
  showCloseButton = true,
  bare = false,
  inline,
  ref,
  ...props
}: Omit<
  ComponentProps<typeof DialogContentPrimitive<Payload>>,
  'className' | 'children'
> & {
  className?: string
  children?: ReactNode | ((state: DialogContentState<Payload>) => ReactNode)
  showCloseButton?: boolean
  bare?: boolean
}) {
  const parts = (state: DialogContentState<Payload>) =>
    typeof children === 'function' ? children(state) : children
  if (bare) {
    return (
      <DialogContentPrimitive<Payload>
        ref={ref}
        inline={inline}
        className={cn('focus-visible:outline-hidden', className)}
        {...props}
      >
        {parts}
      </DialogContentPrimitive>
    )
  }
  return (
    <>
      <DialogBackdrop />
      <DialogContentPrimitive<Payload>
        ref={ref}
        inline={inline}
        className={cn(panelDialogClassName, panelFooterTint, className)}
        {...props}
      >
        {(state) => (
          <PanelSurface
            closeButton={
              showCloseButton ? (
                <DialogClosePrimitive
                  render={
                    <Button
                      variant='ghost'
                      size='icon-sm'
                      className={panelCloseClassName}
                    />
                  }
                  aria-label='Close'
                >
                  <PanelCloseIcon />
                </DialogClosePrimitive>
              ) : null
            }
          >
            {parts(state)}
          </PanelSurface>
        )}
      </DialogContentPrimitive>
    </>
  )
}

function DialogHeader({
  className,
  render,
  ...props
}: Omit<PartProps<'div'>, 'className'> & { className?: string }) {
  return renderElement(
    'div',
    {
      'data-slot': 'dialog-header',
      className: cn(panelHeaderClassName, className),
      ...props,
    },
    render,
  )
}

function DialogTitle({
  className,
  ...props
}: Omit<ComponentProps<typeof DialogTitlePrimitive>, 'className'> & {
  className?: string
}) {
  return (
    <DialogTitlePrimitive className={cn(panelTitleClassName, className)} {...props} />
  )
}

function DialogDescription({
  className,
  ...props
}: Omit<ComponentProps<typeof DialogDescriptionPrimitive>, 'className'> & {
  className?: string
}) {
  return (
    <DialogDescriptionPrimitive
      className={cn(panelDescriptionClassName, className)}
      {...props}
    />
  )
}

/**
 * What scrolls when the dialog is taller than the screen, between the header
 * and the footer. `className` goes to its content, every other prop to the
 * element that scrolls. While it scrolls it takes focus, so the keyboard can
 * scroll it, as a region named by the dialog's title.
 */
function DialogBody({ className, children, ref, ...props }: ComponentProps<'div'>) {
  const scrollerRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const scrollRegion = useScrollRegion(scrollerRef, contentRef)
  const own = useMemo(() => mergeRefs(scrollerRef, ref), [ref])

  return (
    <div
      data-panel='body'
      className={cn(
        panelBodyFrameClassName,
        '[@container_(height<28rem)]:flex-none [@media(height<28rem)]:flex-none',
      )}
    >
      <div
        ref={own}
        data-slot='dialog-body'
        {...scrollRegion}
        className={cn(
          panelBodyClassName,
          '[@container_(height<28rem)]:flex-none [@container_(height<28rem)]:overflow-visible [@media(height<28rem)]:flex-none [@media(height<28rem)]:overflow-visible',
        )}
        {...props}
      >
        <div
          ref={contentRef}
          data-slot='dialog-body-content'
          className={cn(panelBodyContentClassName, className)}
        >
          {children}
        </div>
      </div>
    </div>
  )
}

function DialogFooter({
  className,
  render,
  ...props
}: Omit<PartProps<'div'>, 'className'> & { className?: string }) {
  return renderElement(
    'div',
    {
      'data-slot': 'dialog-footer',
      'data-panel': 'footer',
      className: cn(panelFooterClassName, className),
      ...props,
    },
    render,
  )
}

export {
  Dialog,
  DialogBackdrop,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
}
