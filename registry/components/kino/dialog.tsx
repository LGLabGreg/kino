'use client'

import { Button } from '@/registry/components/kino/button'
import {
  PanelCloseIcon,
  panelBodyClassName,
  panelBodyContentClassName,
  panelBodyFrameClassName,
  panelCloseClassName,
  panelDescriptionClassName,
  panelFooterClassName,
  panelFooterTint,
  panelHeaderClassName,
  panelOverlayClassName,
  panelStackDimClassName,
  panelTitleClassName,
  useFollowHeight,
  useScrollRegion,
} from '@/registry/lib/panel'
import { mergeRefs } from '@/registry/lib/refs'
import { Dialog as DialogPrimitive } from '@base-ui/react/dialog'
import { type ComponentProps, type ReactNode, useRef } from 'react'

import { cn } from '@/lib/utils'

function Dialog<Payload>(props: DialogPrimitive.Root.Props<Payload>) {
  return <DialogPrimitive.Root data-slot='dialog' {...props} />
}

function DialogTrigger<Payload>(props: DialogPrimitive.Trigger.Props<Payload>) {
  return <DialogPrimitive.Trigger data-slot='dialog-trigger' {...props} />
}

function DialogPortal(props: DialogPrimitive.Portal.Props) {
  return <DialogPrimitive.Portal data-slot='dialog-portal' {...props} />
}

function DialogClose(props: DialogPrimitive.Close.Props) {
  return <DialogPrimitive.Close data-slot='dialog-close' {...props} />
}

function DialogOverlay({
  className,
  ...props
}: Omit<DialogPrimitive.Backdrop.Props, 'className'> & { className?: string }) {
  return (
    <DialogPrimitive.Backdrop
      data-slot='dialog-overlay'
      className={cn(panelOverlayClassName, className)}
      {...props}
    />
  )
}

/**
 * The dialog's box. When its content changes height while it is open, the box
 * resizes and the footer stays on its bottom edge.
 */
function DialogSurface({
  showCloseButton,
  children,
}: {
  showCloseButton: boolean
  children: ReactNode
}) {
  const surfaceRef = useRef<HTMLDivElement>(null)
  const innerRef = useRef<HTMLDivElement>(null)
  const scrollRegion = useScrollRegion(innerRef)
  useFollowHeight(surfaceRef, innerRef)

  return (
    <div
      ref={surfaceRef}
      data-slot='dialog-surface'
      data-close-button={showCloseButton ? '' : undefined}
      className={cn(
        'group/panel-surface bg-background text-foreground ring-foreground/10 @container relative overflow-clip rounded-(--surface-radius) text-sm shadow-xl ring-1 transition-[height] duration-(--motion-layout-duration) ease-(--motion-layout-easing) motion-reduce:transition-none forced-colors:outline max-sm:rounded-b-none',
        panelStackDimClassName,
      )}
    >
      {/*
       * As tall as the screen less a margin: past that, the body scrolls
       * between the header and the footer. On a screen under 28rem tall that
       * would leave the body a slit, so the whole dialog scrolls instead, as
       * it does when there is no body. A form around the parts takes no box,
       * so they still lay out here.
       */}
      <div
        ref={innerRef}
        {...scrollRegion}
        className='focus-visible:ring-ring/50 relative flex max-h-[calc(100cqh-(--spacing(8)))] scrollbar-thin flex-col overscroll-contain rounded-[inherit] focus-visible:ring-3 focus-visible:outline-hidden focus-visible:-outline-offset-2 focus-visible:ring-inset max-sm:max-h-[calc(100cqh-(--spacing(12)))] max-sm:pb-[env(safe-area-inset-bottom)] not-has-data-[panel=body]:overflow-y-auto *:[form]:contents [@container_(height<28rem)]:overflow-y-auto'
      >
        {children}
        {/* Inside what scrolls, so it leaves with the header when the whole dialog scrolls. */}
        {showCloseButton ? (
          <DialogPrimitive.Close
            data-slot='dialog-close'
            render={
              <Button variant='ghost' size='icon-sm' className={panelCloseClassName} />
            }
            aria-label='Close'
          >
            <PanelCloseIcon />
          </DialogPrimitive.Close>
        ) : null}
      </div>
    </div>
  )
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  container,
  ...props
}: Omit<DialogPrimitive.Popup.Props, 'className'> & { className?: string } & {
  showCloseButton?: boolean
  /** Where the dialog is rendered; `<body>` when left out. */
  container?: DialogPrimitive.Portal.Props['container']
}) {
  return (
    <DialogPortal container={container}>
      <DialogOverlay />
      <DialogPrimitive.Viewport
        data-slot='dialog-viewport'
        className='group/dialog-viewport @container-size fixed inset-0 z-50 flex justify-center'
      >
        <DialogPrimitive.Popup
          data-slot='dialog-content'
          className={cn(
            /*
             * It rises `--dialog-rise` into the centre: set it on the dialog or
             * anything above it. On a screen under `sm` it is a sheet that
             * slides up from the bottom edge. A strip under it, in the colour
             * the sheet ends in, covers the gap, the ring and the shadow when
             * a spring overshoots.
             */
            'relative mx-4 my-auto max-w-md min-w-0 flex-1 transition-[translate,scale,opacity] duration-(--motion-enter-duration) ease-(--motion-enter-easing) focus-visible:outline-hidden data-ending-style:translate-y-[calc(var(--dialog-rise,1rem)/2)] data-ending-style:scale-98 data-ending-style:opacity-0 data-ending-style:duration-(--motion-exit-duration) data-ending-style:ease-(--motion-exit-easing) data-nested-dialog-open:scale-(--dialog-recede-scale,0.95) data-starting-style:translate-y-[var(--dialog-rise,1rem)] data-starting-style:scale-97 data-starting-style:opacity-0 motion-reduce:transition-[opacity] motion-reduce:data-ending-style:translate-y-0! motion-reduce:data-ending-style:scale-100! motion-reduce:data-ending-style:opacity-0! motion-reduce:data-starting-style:translate-y-0! motion-reduce:data-starting-style:scale-100! motion-reduce:data-starting-style:opacity-0! max-sm:mx-0 max-sm:mb-0 max-sm:max-w-none max-sm:origin-bottom max-sm:after:absolute max-sm:after:inset-x-0 max-sm:after:top-full max-sm:after:h-24 max-sm:after:bg-background max-sm:has-data-[panel=footer]:after:bg-(--panel-footer) max-sm:data-ending-style:translate-y-full max-sm:data-ending-style:scale-100 max-sm:data-ending-style:opacity-100 max-sm:data-starting-style:translate-y-full max-sm:data-starting-style:scale-100 max-sm:data-starting-style:opacity-100',
            panelFooterTint,
            className,
          )}
          {...props}
        >
          <DialogSurface showCloseButton={showCloseButton}>{children}</DialogSurface>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Viewport>
    </DialogPortal>
  )
}

/**
 * The bare box, laid out by its own classes, for a dialog that isn't centred
 * over the page, such as a chat window in a corner. It goes in a
 * `DialogPortal`; `DialogContent` is the centred dialog with its overlay.
 */
function DialogPopup({
  className,
  ...props
}: Omit<DialogPrimitive.Popup.Props, 'className'> & { className?: string }) {
  return (
    <DialogPrimitive.Popup
      data-slot='dialog-popup'
      className={cn('focus-visible:outline-hidden', className)}
      {...props}
    />
  )
}

function DialogHeader({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot='dialog-header'
      className={cn(panelHeaderClassName, className)}
      {...props}
    />
  )
}

function DialogTitle({
  className,
  ...props
}: Omit<DialogPrimitive.Title.Props, 'className'> & { className?: string }) {
  return (
    <DialogPrimitive.Title
      data-slot='dialog-title'
      className={cn(panelTitleClassName, className)}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: Omit<DialogPrimitive.Description.Props, 'className'> & { className?: string }) {
  return (
    <DialogPrimitive.Description
      data-slot='dialog-description'
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

  return (
    <div
      data-panel='body'
      className={cn(panelBodyFrameClassName, '[@container_(height<28rem)]:flex-none')}
    >
      <div
        ref={mergeRefs(scrollerRef, ref)}
        data-slot='dialog-body'
        {...scrollRegion}
        className={cn(
          panelBodyClassName,
          '[@container_(height<28rem)]:flex-none [@container_(height<28rem)]:overflow-visible',
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

function DialogFooter({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot='dialog-footer'
      data-panel='footer'
      className={cn(panelFooterClassName, className)}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPopup,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
