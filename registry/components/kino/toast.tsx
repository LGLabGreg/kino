'use client'

import { Button, buttonVariants } from '@/registry/components/kino/button'
import { IconPlaceholder } from '@/registry/icons/icon-placeholder'
import {
  NoticeIcon,
  noticeActionsClassName,
  noticeDescriptionClassName,
  noticeTextClassName,
  noticeTitleClassName,
} from '@/registry/lib/notice'
import {
  createToaster,
  toast,
  ToastAction as ToastActionPrimitive,
  ToastClose as ToastClosePrimitive,
  ToastDescription as ToastDescriptionPrimitive,
  Toast as ToastPrimitive,
  ToastRegion,
  type ToastData,
  ToastTitle as ToastTitlePrimitive,
} from '@ui-sdk/react/toast'
import { cva } from 'class-variance-authority'
import { type ComponentProps, createContext, type ReactNode, use, useState } from 'react'

import { cn } from '@/lib/utils'

type ToastVariant = 'list' | 'deck'

/** Each toast reads how its region stacks them here. */
const ToastVariantContext = createContext<ToastVariant>('list')

/** Whether the toast was sent back to wait past `maxVisible`, and now shows again behind the others. */
const ToastReturningContext = createContext(false)

/*
 * Each toast sits at the bottom of the region and is moved up by ui-sdk's
 * `--toast-offset` (the toasts in front of it) and a gap per toast. Its
 * visible size is `--toast-surface-height`: the surface behind the content
 * transitions to it, and the content's clip follows, because the toast's own
 * height is measured by ui-sdk and can't transition.
 */
const toastVariants = cva(
  [
    'group/toast pointer-events-none absolute inset-x-0 bottom-0 z-[calc(100-var(--toast-index))] text-popover-foreground select-none [--toast-scale:1] [--toast-surface-height:var(--toast-height,100%)] [--toast-content-clip:inset(0_0_calc(100%-var(--toast-surface-height))_0)] [--toast-content-shift:calc(100%-var(--toast-surface-height))]',
    'translate-y-[calc(-1*(var(--toast-offset)+var(--toast-index)*var(--toast-gap,0.625rem)))] scale-(--toast-scale) [transform:translateX(var(--toast-swipe-x,0px))_translateY(var(--toast-swipe-y,0px))]',
    // A bridge over the gap below, so the pointer crossing it stays on the stack. The front one has no gap below it.
    'after:pointer-events-auto after:absolute after:inset-x-0 after:top-full after:h-[calc(var(--toast-gap,0.625rem)+1px)] data-front:after:hidden',
    // F6 focuses the front toast.
    'rounded-(--surface-radius) focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-hidden',
    /*
     * Arrives from below the screen edge while the others make room; one that
     * comes back from waiting past `maxVisible` fades in behind them, where it is. Closed, or
     * sent back to wait, it fades and shrinks a little where it is. Swiped, it
     * carries on the way it was thrown. While a finger drags it, it follows
     * with no transition.
     */
    '[transition:translate_var(--motion-layout-duration)_var(--motion-layout-easing),scale_var(--motion-layout-duration)_var(--motion-layout-easing),transform_var(--motion-enter-duration)_var(--motion-enter-easing),opacity_var(--motion-enter-duration)_var(--motion-enter-easing)] data-starting-style:opacity-0 data-starting-style:[transform:translateY(calc(100%+(--spacing(6))))] data-returning:data-starting-style:[transform:translateX(var(--toast-swipe-x,0px))_translateY(var(--toast-swipe-y,0px))] data-returning:data-starting-style:[transition-property:opacity] data-ending-style:scale-[calc(var(--toast-scale)*0.96)] data-ending-style:opacity-0 data-ending-style:[transition:translate_var(--motion-layout-duration)_var(--motion-layout-easing),scale_var(--motion-exit-duration)_var(--motion-exit-easing),transform_var(--motion-exit-duration)_var(--motion-exit-easing),opacity_var(--motion-exit-duration)_var(--motion-exit-easing)] data-swiping:[transition-property:translate,scale,opacity] data-ending-style:data-swipe-direction:scale-(--toast-scale) data-ending-style:data-[swipe-direction=down]:[transform:translateX(var(--toast-swipe-x,0px))_translateY(calc(var(--toast-swipe-y,0px)+110%))] data-ending-style:data-[swipe-direction=left]:[transform:translateX(calc(var(--toast-swipe-x,0px)-110%))_translateY(var(--toast-swipe-y,0px))] data-ending-style:data-[swipe-direction=right]:[transform:translateX(calc(var(--toast-swipe-x,0px)+110%))_translateY(var(--toast-swipe-y,0px))] motion-reduce:[transition-property:opacity] motion-reduce:data-ending-style:[transition-property:opacity] motion-reduce:data-starting-style:[transform:none] motion-reduce:data-ending-style:scale-(--toast-scale)! motion-reduce:data-ending-style:[transform:translateX(var(--toast-swipe-x,0px))_translateY(var(--toast-swipe-y,0px))]!',
  ],
  {
    variants: {
      variant: {
        list: '',
        // Collapsed, the ones behind take the front one's height, shrink and peek out above it.
        deck: 'not-data-expanded:origin-bottom not-data-expanded:translate-y-[calc(-1*var(--toast-index)*var(--toast-peek,0.625rem)-(1-var(--toast-scale))*var(--toast-front-height,var(--toast-height)))] not-data-expanded:[--toast-scale:max(0,1-var(--toast-index)*0.05)] not-data-expanded:[--toast-surface-height:var(--toast-front-height,var(--toast-height,100%))]',
      },
    },
    defaultVariants: { variant: 'list' },
  },
)

function Toast({
  className,
  children,
  ...props
}: Omit<ComponentProps<typeof ToastPrimitive>, 'className' | 'children'> & {
  className?: string
  children?: ReactNode
}) {
  const variant = use(ToastVariantContext)
  const returning = use(ToastReturningContext)
  return (
    <ToastPrimitive
      data-returning={returning ? '' : undefined}
      className={cn(toastVariants({ variant }), className)}
      {...props}
    >
      <span
        aria-hidden
        data-toast-surface=''
        className='bg-popover ring-foreground/10 pointer-events-none absolute inset-x-0 bottom-0 h-(--toast-surface-height) rounded-(--surface-radius) shadow-lg ring-1 transition-[height] duration-(--motion-layout-duration) ease-(--motion-layout-easing) motion-reduce:transition-none forced-colors:outline'
      />
      {children}
    </ToastPrimitive>
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
        deck: 'group-not-data-front/toast:group-not-data-expanded/toast:opacity-0 group-not-data-front/toast:group-not-data-expanded/toast:[transition:clip-path_var(--motion-layout-duration)_var(--motion-layout-easing),translate_var(--motion-layout-duration)_var(--motion-layout-easing),opacity_calc(var(--motion-exit-duration)*0.5)_var(--motion-exit-easing)] motion-reduce:group-not-data-front/toast:group-not-data-expanded/toast:[transition-property:opacity]',
      },
    },
    defaultVariants: { variant: 'list' },
  },
)

/** What a toast shows, laid out in a row. */
function ToastContent({
  className,
  ...props
}: Omit<ComponentProps<'div'>, 'className'> & { className?: string }) {
  const variant = use(ToastVariantContext)
  return (
    <div
      data-slot='toast-content'
      className={cn(toastContentVariants({ variant }), className)}
      {...props}
    />
  )
}

function ToastTitle({
  className,
  ...props
}: Omit<ComponentProps<typeof ToastTitlePrimitive>, 'className'> & {
  className?: string
}) {
  return (
    <ToastTitlePrimitive className={cn(noticeTitleClassName, className)} {...props} />
  )
}

function ToastDescription({
  className,
  ...props
}: Omit<ComponentProps<typeof ToastDescriptionPrimitive>, 'className'> & {
  className?: string
}) {
  return (
    <ToastDescriptionPrimitive
      className={cn(noticeDescriptionClassName, className)}
      {...props}
    />
  )
}

/*
 * The Button's look on ui-sdk's own element, which is a link when the action
 * has an `href`.
 */
function ToastAction({
  className,
  ...props
}: Omit<ComponentProps<typeof ToastActionPrimitive>, 'className'> & {
  className?: string
}) {
  return (
    <ToastActionPrimitive
      className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), className)}
      {...props}
    />
  )
}

function ToastClose({
  className,
  children,
  ...props
}: Omit<ComponentProps<typeof ToastClosePrimitive>, 'className' | 'children'> & {
  className?: string
  children?: ReactNode
}) {
  return (
    <ToastClosePrimitive
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
    </ToastClosePrimitive>
  )
}

/** The icon for a toast's `type`. The loading spinner rolls into the result. */
function ToastIcon(props: ComponentProps<typeof NoticeIcon>) {
  return <NoticeIcon data-toast-icon='' {...props} />
}

type ToastRegionProps = ComponentProps<typeof ToastRegion>

/**
 * The corner the toasts sit in, holding ui-sdk's region. Each toast shows in
 * the default layout (the icon for its type, its title, description and
 * action, and a close button), or as `children` renders it.
 */
function Toaster({
  variant = 'list',
  className,
  children,
  ...props
}: Omit<ToastRegionProps, 'className' | 'side' | 'align'> & {
  className?: string
  /** `list` keeps every toast open in a column; `deck` stacks them until hover or focus spreads them. */
  variant?: ToastVariant
}) {
  const [waited] = useState(() => new Set<string>())
  const render = children ?? defaultToast
  return (
    <ToastVariantContext value={variant}>
      <ToastRegion
        data-variant={variant}
        className={cn(
          // As wide as a phone's screen allows, with the same margin on each side as below; fixed
          // from the server's page on, so the region never takes room beside what it sits in.
          'group/toast-region fixed end-4 bottom-4 w-88 max-w-[calc(100vw-(--spacing(8)))]',
          className,
        )}
        {...props}
      >
        {(data, item) => {
          // ui-sdk marks a toast leaving when it closes and when it goes back to wait; only one that waited shows again.
          if (item.leaving) waited.add(data.id)
          return (
            <ToastReturningContext value={item.index > 0 && waited.has(data.id)}>
              {render(data, item)}
            </ToastReturningContext>
          )
        }}
      </ToastRegion>
    </ToastVariantContext>
  )
}

function defaultToast(data: ToastData<ReactNode>) {
  return (
    <Toast>
      <ToastContent>
        <ToastIcon type={data.type} />
        <div className={noticeTextClassName}>
          <ToastTitle />
          <ToastDescription />
          {data.action ? (
            <div className={noticeActionsClassName}>
              <ToastAction />
            </div>
          ) : null}
        </div>
        <ToastClose />
      </ToastContent>
    </Toast>
  )
}

export {
  createToaster,
  toast,
  Toast,
  ToastAction,
  ToastClose,
  ToastContent,
  ToastDescription,
  Toaster,
  ToastIcon,
  ToastTitle,
}
