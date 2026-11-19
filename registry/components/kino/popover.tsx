'use client'

import {
  HOVER_DELAY,
  popupGrowClassName,
  popupGrowContentClassName,
  popupPositionerProps,
  popupSurfaceClassName,
  usePopupGrow,
} from '@/registry/lib/popup'
import { edgeFadeClassName, useEdgeFades } from '@/registry/lib/scroll'
import { Popover as PopoverPrimitive } from '@base-ui/react/popover'
import type { ComponentProps } from 'react'

import { cn } from '@/lib/utils'

function Popover<Payload>(props: PopoverPrimitive.Root.Props<Payload>) {
  return <PopoverPrimitive.Root data-slot='popover' {...props} />
}

/** With `openOnHover`, it waits 200ms before the popover opens. */
function PopoverTrigger<Payload>(props: PopoverPrimitive.Trigger.Props<Payload>) {
  return (
    <PopoverPrimitive.Trigger
      data-slot='popover-trigger'
      delay={HOVER_DELAY}
      {...props}
    />
  )
}

function PopoverClose(props: PopoverPrimitive.Close.Props) {
  return <PopoverPrimitive.Close data-slot='popover-close' {...props} />
}

/**
 * The box and what's in it. It grows out from under its trigger and folds
 * back into it. `className` goes to the content inside the box; every other
 * prop goes to Base UI's Popup. Content taller than the space left on screen
 * scrolls.
 */
function PopoverContent({
  className,
  children,
  style,
  side = 'bottom',
  align = 'center',
  sideOffset = 6,
  alignOffset = 0,
  anchor,
  ...props
}: Omit<
  PopoverPrimitive.Popup.Props &
    Pick<
      PopoverPrimitive.Positioner.Props,
      'side' | 'align' | 'sideOffset' | 'alignOffset' | 'anchor'
    >,
  'className'
> & { className?: string }) {
  const { dir, style: growStyle, anchor: arrow } = usePopupGrow()
  const fades = useEdgeFades<HTMLDivElement>()
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Positioner
        {...popupPositionerProps}
        side={side}
        align={align}
        sideOffset={sideOffset}
        alignOffset={alignOffset}
        anchor={anchor}
      >
        <PopoverPrimitive.Popup
          data-slot='popover-content'
          // Portalled out of the page's tree, so it takes the reading direction with it.
          dir={dir}
          style={(state) => ({
            ...growStyle(state),
            ...(typeof style === 'function' ? style(state) : style),
          })}
          className={cn(
            'group/popup relative flex max-h-(--available-height) max-w-(--available-width) flex-col rounded-(--surface-radius) text-sm',
            popupSurfaceClassName,
            popupGrowClassName,
          )}
          {...props}
        >
          {/* The content scrolls inside the surface, so its fading edges leave the surface's shadow, ring and outline whole. */}
          <div
            ref={fades}
            data-slot='popover-scroller'
            className={cn(
              'scrollbar-thin flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain rounded-[inherit]',
              edgeFadeClassName,
            )}
          >
            <div
              data-slot='popover-body'
              className={cn(
                'flex w-72 max-w-full flex-col gap-(--surface-gap) p-(--surface-padding)',
                popupGrowContentClassName,
                className,
              )}
            >
              {children}
            </div>
          </div>
          <PopoverPrimitive.Arrow {...arrow} />
        </PopoverPrimitive.Popup>
      </PopoverPrimitive.Positioner>
    </PopoverPrimitive.Portal>
  )
}

function PopoverHeader({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot='popover-header'
      className={cn('flex flex-col gap-1', className)}
      {...props}
    />
  )
}

function PopoverTitle({
  className,
  ...props
}: Omit<PopoverPrimitive.Title.Props, 'className'> & { className?: string }) {
  return (
    <PopoverPrimitive.Title
      data-slot='popover-title'
      className={cn('text-sm leading-snug font-medium', className)}
      {...props}
    />
  )
}

function PopoverDescription({
  className,
  ...props
}: Omit<PopoverPrimitive.Description.Props, 'className'> & { className?: string }) {
  return (
    <PopoverPrimitive.Description
      data-slot='popover-description'
      className={cn('text-muted-foreground text-sm text-pretty', className)}
      {...props}
    />
  )
}

export {
  Popover,
  PopoverClose,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
}
