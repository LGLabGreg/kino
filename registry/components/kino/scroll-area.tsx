'use client'

import {
  edgeFadeClassName,
  followEdges,
  scrollRegionRingClassName,
} from '@/registry/lib/scroll'
import {
  ScrollAreaContent as ScrollAreaContentPrimitive,
  ScrollAreaCorner as ScrollAreaCornerPrimitive,
  ScrollArea as ScrollAreaPrimitive,
  ScrollAreaScrollbar as ScrollAreaScrollbarPrimitive,
  ScrollAreaThumb as ScrollAreaThumbPrimitive,
  ScrollAreaViewport as ScrollAreaViewportPrimitive,
} from '@ui-sdk/react/scroll-area'
import { type ComponentProps, type ReactNode, useEffect, useRef } from 'react'

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
}: Omit<ComponentProps<typeof ScrollAreaPrimitive>, 'className' | 'children'> & {
  className?: string
  children?: ReactNode
}) {
  const viewportRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    return followEdges(viewport, '--scroll-fade')
  }, [])

  return (
    <ScrollAreaPrimitive
      className={cn('flex min-h-0 flex-col', scrollRegionRingClassName, className)}
      {...props}
    >
      <ScrollAreaViewportPrimitive
        ref={viewportRef}
        // While it scrolls it is a region, named by the label given, which the
        // keyboard can reach. Content that fits leaves it a plain box, which
        // can't carry a name.
        render={(viewportProps, state) =>
          state.overflowX || state.overflowY ? (
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
        <ScrollAreaContentPrimitive>{children}</ScrollAreaContentPrimitive>
      </ScrollAreaViewportPrimitive>
      <ScrollBar orientation='vertical' />
      <ScrollBar orientation='horizontal' />
      <ScrollAreaCornerPrimitive />
    </ScrollAreaPrimitive>
  )
}

/*
 * ui-sdk shows a bar only while its axis overflows. Hidden, it lets the
 * pointer through to the content under it; it shows on `enter` while the
 * pointer is over the box or it scrolls, and leaves on `exit`. The bar is 10px across, wider than its thumb, so it is easier to
 * catch.
 */
function ScrollBar({
  className,
  orientation = 'vertical',
  ...props
}: Omit<ComponentProps<typeof ScrollAreaScrollbarPrimitive>, 'className'> & {
  className?: string
}) {
  return (
    <ScrollAreaScrollbarPrimitive
      orientation={orientation}
      className={cn(
        'pointer-events-none z-10 flex touch-none p-0.5 opacity-0 transition-opacity duration-(--motion-exit-duration) ease-(--motion-exit-easing) select-none data-hovering:pointer-events-auto data-hovering:opacity-100 data-hovering:duration-(--motion-enter-duration) data-hovering:ease-(--motion-enter-easing) data-scrolling:pointer-events-auto data-scrolling:opacity-100 data-scrolling:duration-(--motion-enter-duration) data-scrolling:ease-(--motion-enter-easing) data-[orientation=horizontal]:h-2.5 data-[orientation=horizontal]:flex-col data-[orientation=vertical]:w-2.5',
        className,
      )}
      {...props}
    >
      <ScrollAreaThumbPrimitive className='bg-foreground/25 hover:bg-foreground/40 active:bg-foreground/50 flex-1 rounded-full transition-colors duration-(--motion-press-duration) ease-(--motion-press-fade-easing) forced-colors:bg-[CanvasText]' />
    </ScrollAreaScrollbarPrimitive>
  )
}

export { ScrollArea }
