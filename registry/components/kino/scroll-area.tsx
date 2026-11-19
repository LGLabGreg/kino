'use client'

import {
  edgeFadeClassName,
  followEdges,
  scrollRegionRingClassName,
} from '@/registry/lib/scroll'
import { ScrollArea as ScrollAreaPrimitive } from '@base-ui/react/scroll-area'
import { useEffect, useRef } from 'react'

import { cn } from '@/lib/utils'

/*
 * A box that scrolls with thin scrollbars of its own, drawn over its content's
 * edge: they fade in while the pointer is over the box or it scrolls, and out
 * once it rests. Each edge fades while there is more past it, as the Tabs'
 * list and a wide Table do.
 */

function ScrollArea({
  className,
  children,
  'aria-label': label,
  'aria-labelledby': labelledBy,
  ...props
}: Omit<ScrollAreaPrimitive.Root.Props, 'className'> & { className?: string }) {
  const viewportRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    return followEdges(viewport, '--scroll-fade')
  }, [])

  return (
    <ScrollAreaPrimitive.Root
      data-slot='scroll-area'
      className={cn('flex min-h-0 flex-col', scrollRegionRingClassName, className)}
      {...props}
    >
      <ScrollAreaPrimitive.Viewport
        ref={viewportRef}
        data-slot='scroll-area-viewport'
        // Base UI makes it focusable while it scrolls, so the keyboard can
        // scroll it: a region then, named by the label given. Content that
        // fits leaves it a plain box, which can't carry a name.
        render={(viewportProps, state) =>
          state.hasOverflowX || state.hasOverflowY ? (
            <div
              {...viewportProps}
              role='region'
              aria-label={label}
              aria-labelledby={labelledBy}
            />
          ) : (
            <div {...viewportProps} />
          )
        }
        className={cn(
          'scrollbar-none min-h-0 flex-auto rounded-[inherit] focus-visible:outline-hidden',
          edgeFadeClassName,
        )}
      >
        <ScrollAreaPrimitive.Content data-slot='scroll-area-content'>
          {children}
        </ScrollAreaPrimitive.Content>
      </ScrollAreaPrimitive.Viewport>
      <ScrollBar orientation='vertical' />
      <ScrollBar orientation='horizontal' />
      <ScrollAreaPrimitive.Corner data-slot='scroll-area-corner' />
    </ScrollAreaPrimitive.Root>
  )
}

/*
 * Base UI renders a bar only while its axis overflows. Hidden, it lets the
 * pointer through to the content under it; it shows on `enter` and leaves on
 * `exit`. The bar is 10px across, wider than its thumb, so it is easier to
 * catch.
 */
function ScrollBar({
  className,
  orientation = 'vertical',
  ...props
}: Omit<ScrollAreaPrimitive.Scrollbar.Props, 'className'> & {
  className?: string
}) {
  return (
    <ScrollAreaPrimitive.Scrollbar
      data-slot='scroll-area-scrollbar'
      orientation={orientation}
      className={cn(
        'pointer-events-none z-10 flex touch-none p-0.5 opacity-0 transition-opacity duration-(--motion-exit-duration) ease-(--motion-exit-easing) select-none data-hovering:pointer-events-auto data-hovering:opacity-100 data-hovering:duration-(--motion-enter-duration) data-hovering:ease-(--motion-enter-easing) data-scrolling:pointer-events-auto data-scrolling:opacity-100 data-scrolling:duration-(--motion-enter-duration) data-scrolling:ease-(--motion-enter-easing) data-[orientation=horizontal]:h-2.5 data-[orientation=horizontal]:flex-col data-[orientation=vertical]:w-2.5',
        className,
      )}
      {...props}
    >
      <ScrollAreaPrimitive.Thumb
        data-slot='scroll-area-thumb'
        className='bg-foreground/25 hover:bg-foreground/40 active:bg-foreground/50 flex-1 rounded-full transition-colors duration-(--motion-press-duration) ease-(--motion-press-fade-easing) forced-colors:bg-[CanvasText]'
      />
    </ScrollAreaPrimitive.Scrollbar>
  )
}

export { ScrollArea }
