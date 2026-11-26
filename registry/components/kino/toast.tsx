'use client'

import { Button } from '@/registry/components/kino/button'
import { IconPlaceholder } from '@/registry/icons/icon-placeholder'
import {
  NoticeIcon,
  noticeActionsClassName,
  noticeDescriptionClassName,
  noticeTextClassName,
  noticeTitleClassName,
} from '@/registry/lib/notice'
import { usePersistentLayer } from '@/registry/lib/popup'
import { mergeRefs } from '@/registry/lib/refs'
import { useDirection } from '@base-ui/react/direction-provider'
import { Toast as ToastPrimitive } from '@base-ui/react/toast'
import { cva } from 'class-variance-authority'
import { type ComponentProps, createContext, use, useMemo, useState } from 'react'

import { cn } from '@/lib/utils'

type ToastVariant = 'list' | 'deck'

/** Each toast reads how its viewport stacks them here. */
const ToastVariantContext = createContext<ToastVariant>('list')

const useToast = ToastPrimitive.useToastManager
const createToastManager = ToastPrimitive.createToastManager

function ToastProvider(props: ToastPrimitive.Provider.Props) {
  return <ToastPrimitive.Provider {...props} />
}

function ToastViewport({
  variant = 'list',
  container,
  className,
  ref,
  ...props
}: Omit<ToastPrimitive.Viewport.Props, 'className'> & { className?: string } & {
  /** `list` keeps every toast open in a column; `deck` stacks them until hover or focus spreads them. */
  variant?: ToastVariant
  /** Where the toasts are rendered; `<body>` when left out. */
  container?: ToastPrimitive.Portal.Props['container']
}) {
  // The viewport is portalled out of the page, so it takes the reading direction with it.
  const direction = useDirection()
  const [layer, setLayer] = useState<HTMLElement | null>(null)
  // In `<body>`, it sits above ui-sdk's popups, which open in the top layer;
  // in a `container`, it stays in that box.
  const persistent = container === undefined
  usePersistentLayer(persistent ? layer : null)
  const own = useMemo(() => mergeRefs(ref, setLayer), [ref])
  return (
    <ToastPrimitive.Portal container={container}>
      <ToastVariantContext value={variant}>
        <ToastPrimitive.Viewport
          ref={own}
          popover={persistent ? 'manual' : undefined}
          data-slot='toast-viewport'
          data-variant={variant}
          dir={direction}
          className={cn(
            // As wide as a phone's screen allows, with the same margin on each side as below.
            'group/toast-viewport fixed inset-auto end-4 bottom-4 z-50 m-0 w-88 overflow-visible border-0 bg-transparent p-0 text-inherit max-w-[calc(100vw-(--spacing(8)))] focus-visible:outline-hidden',
            className,
          )}
          {...props}
        />
      </ToastVariantContext>
    </ToastPrimitive.Portal>
  )
}

/*
 * Each toast sits at the bottom of the viewport and is moved up by Base UI's
 * `--toast-offset-y` (the toasts in front of it) and a gap per toast. Its
 * visible size is `--toast-surface-height`: the surface behind the content
 * transitions to it, and the content's clip follows, because the Root's own
 * height is measured by Base UI and can't transition. Base UI drops the
 * height while a toast leaves, and the surface keeps the Root's.
 */
const toastVariants = cva(
  [
    'group/toast pointer-events-none absolute inset-x-0 bottom-0 z-[calc(100-var(--toast-index))] text-popover-foreground select-none [--toast-scale:1] [--toast-surface-height:var(--toast-height,100%)] [--toast-content-clip:inset(0_0_calc(100%-var(--toast-surface-height))_0)] [--toast-content-shift:calc(100%-var(--toast-surface-height))]',
    'translate-y-[calc(-1*(var(--toast-offset-y)+var(--toast-index)*var(--toast-gap,0.625rem)))] scale-(--toast-scale) [transform:translateX(var(--toast-swipe-movement-x,0px))_translateY(var(--toast-swipe-movement-y,0px))]',
    // A bridge over the gap below, so the pointer crossing it stays on the stack. The front one, the first toast in the DOM, has no gap below it (Base UI puts focus guards, spans, before it).
    'after:pointer-events-auto after:absolute after:inset-x-0 after:top-full after:h-[calc(var(--toast-gap,0.625rem)+1px)] first-of-type:after:hidden',
    // F6 focuses the viewport, which has no box of its own: the front toast shows the ring.
    'rounded-(--surface-radius) focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-hidden group-focus-visible/toast-viewport:first-of-type:ring-3 group-focus-visible/toast-viewport:first-of-type:ring-ring/50 group-focus-visible/toast-viewport:first-of-type:outline-hidden',
    /*
     * Arrives from below the screen edge while the others make room. Closed,
     * it fades and shrinks a little where it is; pushed out past the limit, it
     * goes in half the time. Swiped, it carries on the way it was thrown.
     */
    '[transition:translate_var(--motion-layout-duration)_var(--motion-layout-easing),scale_var(--motion-layout-duration)_var(--motion-layout-easing),transform_var(--motion-enter-duration)_var(--motion-enter-easing),opacity_var(--motion-enter-duration)_var(--motion-enter-easing)] data-starting-style:opacity-0 data-starting-style:[transform:translateY(calc(100%+(--spacing(6))))] data-ending-style:scale-[calc(var(--toast-scale)*0.96)] data-ending-style:opacity-0 data-ending-style:[transition:translate_var(--motion-layout-duration)_var(--motion-layout-easing),scale_var(--motion-exit-duration)_var(--motion-exit-easing),transform_var(--motion-exit-duration)_var(--motion-exit-easing),opacity_var(--motion-exit-duration)_var(--motion-exit-easing)] data-limited:scale-[calc(var(--toast-scale)*0.96)] data-limited:opacity-0 data-limited:[transition:translate_var(--motion-layout-duration)_var(--motion-layout-easing),scale_calc(var(--motion-exit-duration)*0.5)_var(--motion-exit-easing),transform_calc(var(--motion-exit-duration)*0.5)_var(--motion-exit-easing),opacity_calc(var(--motion-exit-duration)*0.5)_var(--motion-exit-easing)] data-ending-style:data-swipe-direction:scale-(--toast-scale) data-ending-style:data-[swipe-direction=down]:[transform:translateX(var(--toast-swipe-movement-x,0px))_translateY(calc(var(--toast-swipe-movement-y,0px)+110%))] data-ending-style:data-[swipe-direction=left]:[transform:translateX(calc(var(--toast-swipe-movement-x,0px)-110%))_translateY(var(--toast-swipe-movement-y,0px))] data-ending-style:data-[swipe-direction=right]:[transform:translateX(calc(var(--toast-swipe-movement-x,0px)+110%))_translateY(var(--toast-swipe-movement-y,0px))] motion-reduce:[transition-property:opacity] motion-reduce:data-ending-style:[transition-property:opacity] motion-reduce:data-limited:[transition-property:opacity] motion-reduce:data-starting-style:[transform:none] motion-reduce:data-ending-style:scale-(--toast-scale)! motion-reduce:data-ending-style:[transform:translateX(var(--toast-swipe-movement-x,0px))_translateY(var(--toast-swipe-movement-y,0px))]! motion-reduce:data-limited:scale-(--toast-scale)!',
  ],
  {
    variants: {
      variant: {
        list: '',
        // Collapsed, the ones behind take the front one's height, shrink and peek out above it.
        deck: 'not-data-expanded:origin-bottom not-data-expanded:translate-y-[calc(-1*var(--toast-index)*var(--toast-peek,0.625rem)-(1-var(--toast-scale))*var(--toast-frontmost-height,var(--toast-height)))] not-data-expanded:[--toast-scale:max(0,1-var(--toast-index)*0.05)] not-data-expanded:[--toast-surface-height:var(--toast-frontmost-height,var(--toast-height,100%))]',
      },
    },
    defaultVariants: { variant: 'list' },
  },
)

function Toast({
  className,
  children,
  swipeDirection,
  ...props
}: Omit<ToastPrimitive.Root.Props, 'className'> & { className?: string }) {
  const variant = use(ToastVariantContext)
  const direction = useDirection()
  return (
    <ToastPrimitive.Root
      data-slot='toast'
      // Down, or toward the nearest screen edge.
      swipeDirection={swipeDirection ?? ['down', direction === 'rtl' ? 'left' : 'right']}
      className={cn(toastVariants({ variant }), className)}
      {...props}
    >
      <span
        aria-hidden
        data-slot='toast-surface'
        className='bg-popover ring-foreground/10 pointer-events-none absolute inset-x-0 bottom-0 h-(--toast-surface-height) rounded-(--surface-radius) shadow-lg ring-1 transition-[height] duration-(--motion-layout-duration) ease-(--motion-layout-easing) motion-reduce:transition-none forced-colors:outline'
      />
      {children}
    </ToastPrimitive.Root>
  )
}

const toastContentVariants = cva(
  // Pinned to the surface's top and cut at its end while the surface catches up, so a toast that grows shows its title first.
  // The close button sits 8px nearer the end than the content does, at every density.
  'pointer-events-auto relative flex items-start gap-3 p-(--surface-padding) pe-[calc(var(--surface-padding)-(--spacing(2)))] translate-y-[var(--toast-content-shift,0px)] [clip-path:var(--toast-content-clip,none)] [transition:clip-path_var(--motion-layout-duration)_var(--motion-layout-easing),translate_var(--motion-layout-duration)_var(--motion-layout-easing),opacity_var(--motion-enter-duration)_var(--motion-enter-easing)] motion-reduce:[transition-property:opacity]',
  {
    variants: {
      variant: {
        list: '',
        // The text behind the front toast goes quickly, so it never shows through.
        deck: 'data-behind:not-data-expanded:opacity-0 data-behind:not-data-expanded:[transition:clip-path_var(--motion-layout-duration)_var(--motion-layout-easing),translate_var(--motion-layout-duration)_var(--motion-layout-easing),opacity_calc(var(--motion-exit-duration)*0.5)_var(--motion-exit-easing)] motion-reduce:data-behind:not-data-expanded:[transition-property:opacity]',
      },
    },
    defaultVariants: { variant: 'list' },
  },
)

function ToastContent({
  className,
  ...props
}: Omit<ToastPrimitive.Content.Props, 'className'> & { className?: string }) {
  const variant = use(ToastVariantContext)
  return (
    <ToastPrimitive.Content
      data-slot='toast-content'
      className={cn(toastContentVariants({ variant }), className)}
      {...props}
    />
  )
}

function ToastTitle({
  className,
  ...props
}: Omit<ToastPrimitive.Title.Props, 'className'> & { className?: string }) {
  return (
    <ToastPrimitive.Title
      data-slot='toast-title'
      className={cn(noticeTitleClassName, className)}
      {...props}
    />
  )
}

function ToastDescription({
  className,
  ...props
}: Omit<ToastPrimitive.Description.Props, 'className'> & { className?: string }) {
  return (
    <ToastPrimitive.Description
      data-slot='toast-description'
      className={cn(noticeDescriptionClassName, className)}
      {...props}
    />
  )
}

function ToastAction(props: ToastPrimitive.Action.Props) {
  return (
    <ToastPrimitive.Action
      data-slot='toast-action'
      render={<Button size='sm' variant='outline' />}
      {...props}
    />
  )
}

function ToastClose({
  className,
  children,
  ...props
}: Omit<ToastPrimitive.Close.Props, 'className'> & { className?: string }) {
  return (
    <ToastPrimitive.Close
      data-slot='toast-close'
      aria-label='Close'
      render={
        <Button
          variant='ghost'
          size='icon-xs'
          className={cn('text-muted-foreground -mt-0.5', className)}
        />
      }
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
    </ToastPrimitive.Close>
  )
}

/** The icon for a toast's `type`. The loading spinner rolls into the result. */
function ToastIcon(props: ComponentProps<typeof NoticeIcon>) {
  return <NoticeIcon data-slot='toast-icon' {...props} />
}

/**
 * Every toast the manager holds, in the default layout: the icon for its
 * type, its title, description and action, and a close button. Every prop
 * goes to the viewport.
 */
function Toaster(props: ComponentProps<typeof ToastViewport>) {
  const { toasts } = useToast()
  return (
    <ToastViewport {...props}>
      {toasts.map((toast) => {
        // A string passed to `promise()` arrives as the description: it names the toast.
        const title = toast.title || toast.description
        const description = toast.title ? toast.description : undefined
        return (
          <Toast key={toast.id} toast={toast}>
            <ToastContent>
              <ToastIcon type={toast.type} />
              <div className={noticeTextClassName}>
                {title ? <ToastTitle>{title}</ToastTitle> : null}
                {description ? <ToastDescription>{description}</ToastDescription> : null}
                {toast.actionProps ? (
                  <div className={noticeActionsClassName}>
                    <ToastAction />
                  </div>
                ) : null}
              </div>
              <ToastClose />
            </ToastContent>
          </Toast>
        )
      })}
    </ToastViewport>
  )
}

export {
  createToastManager,
  Toast,
  ToastAction,
  ToastClose,
  ToastContent,
  ToastDescription,
  Toaster,
  ToastIcon,
  ToastProvider,
  ToastTitle,
  ToastViewport,
  useToast,
}
