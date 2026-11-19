'use client'

import {
  Sheet,
  SheetBody,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetIndent,
  SheetOverlay,
  SheetPortal,
  SheetTitle,
  SheetTrigger,
} from '@/registry/components/kino/sheet'
import { useControllable } from '@/registry/lib/controllable'
import { gripClassName } from '@/registry/lib/grip'
import type { Drawer as DrawerPrimitive } from '@base-ui/react/drawer'
import { createChangeEventDetails } from '@base-ui/react/internals/createBaseUIEventDetails'
import { type ComponentProps, createContext, use } from 'react'

import { cn } from '@/lib/utils'

type SnapPoint = DrawerPrimitive.Root.SnapPoint

const SnapContext = createContext<{
  points: SnapPoint[]
  point: SnapPoint | null
  setPoint: (point: SnapPoint, event: MouseEvent, trigger: Element) => void
} | null>(null)

/**
 * A sheet on the bottom edge with a handle, swiped down to close. With
 * `snapPoints` it rests at the first and is dragged, or its handle pressed, to
 * the next.
 */
function Drawer<Payload>({
  snapPoints,
  snapPoint,
  defaultSnapPoint,
  onSnapPointChange,
  ...props
}: Omit<ComponentProps<typeof Sheet<Payload>>, 'side'>) {
  const [point, change] = useControllable<
    SnapPoint | null,
    [DrawerPrimitive.Root.SnapPointChangeEventDetails]
  >(snapPoint, defaultSnapPoint ?? snapPoints?.[0] ?? null, onSnapPointChange)
  const sheet = (
    <Sheet
      data-slot='drawer'
      side='bottom'
      {...(snapPoints
        ? { snapPoints, snapPoint: point, defaultSnapPoint, onSnapPointChange: change }
        : {})}
      {...props}
    />
  )
  if (!snapPoints) return sheet
  return (
    <SnapContext
      value={{
        points: snapPoints,
        point,
        setPoint: (next, event, trigger) => {
          change(next, createChangeEventDetails('trigger-press', event, trigger))
        },
      }}
    >
      {sheet}
    </SnapContext>
  )
}

/** The snap point after `point`, back to the first after the last, so pressing the handle walks through them. */
function nextSnapPoint(points: readonly SnapPoint[], point: SnapPoint | null): SnapPoint {
  const index = point === null ? 0 : points.indexOf(point)
  return points[(index + 1) % points.length]
}

/**
 * The bar on top that shows the drawer can be dragged. With snap points it is
 * a button: pressing it moves the drawer to the next, so it can be resized
 * without dragging.
 */
function DrawerHandle({ className, ...props }: ComponentProps<'button'>) {
  const snap = use(SnapContext)
  const bar = <span className={cn(gripClassName, 'h-1 w-10')} />
  if (!snap) {
    return (
      <div
        data-slot='drawer-handle'
        data-panel='handle'
        aria-hidden
        className={cn('flex h-5 shrink-0 items-end justify-center', className)}
      >
        {bar}
      </div>
    )
  }
  const index = snap.point === null ? 0 : snap.points.indexOf(snap.point)
  const expanded = index === snap.points.length - 1
  return (
    <button
      type='button'
      data-slot='drawer-handle'
      data-panel='handle'
      aria-label={expanded ? 'Collapse' : 'Expand'}
      onClick={(event) =>
        snap.setPoint(
          nextSnapPoint(snap.points, snap.point),
          event.nativeEvent,
          event.currentTarget,
        )
      }
      className={cn(
        'group/grip focus-visible:ring-ring/50 mx-auto flex h-6 w-16 shrink-0 items-end justify-center rounded-full focus-visible:ring-3 focus-visible:outline-hidden',
        className,
      )}
      {...props}
    >
      {bar}
    </button>
  )
}

/** On a wide screen it is no wider than 40rem, centred. */
function DrawerContent({
  className,
  children,
  ...props
}: Omit<ComponentProps<typeof SheetContent>, 'className'> & { className?: string }) {
  return (
    <SheetContent
      data-slot='drawer-content'
      className={cn('max-w-160', className)}
      {...props}
    >
      <DrawerHandle />
      {children}
    </SheetContent>
  )
}

/* The sheet's parts, under the drawer's names and slots. */
function DrawerBody(props: ComponentProps<typeof SheetBody>) {
  return <SheetBody data-slot='drawer-body' {...props} />
}

function DrawerClose(props: ComponentProps<typeof SheetClose>) {
  return <SheetClose data-slot='drawer-close' {...props} />
}

function DrawerDescription(props: ComponentProps<typeof SheetDescription>) {
  return <SheetDescription data-slot='drawer-description' {...props} />
}

function DrawerFooter(props: ComponentProps<typeof SheetFooter>) {
  return <SheetFooter data-slot='drawer-footer' {...props} />
}

function DrawerHeader(props: ComponentProps<typeof SheetHeader>) {
  return <SheetHeader data-slot='drawer-header' {...props} />
}

function DrawerIndent(props: ComponentProps<typeof SheetIndent>) {
  return <SheetIndent data-slot='drawer-indent' {...props} />
}

function DrawerOverlay(props: ComponentProps<typeof SheetOverlay>) {
  return <SheetOverlay data-slot='drawer-overlay' {...props} />
}

function DrawerPortal(props: ComponentProps<typeof SheetPortal>) {
  return <SheetPortal data-slot='drawer-portal' {...props} />
}

function DrawerTitle(props: ComponentProps<typeof SheetTitle>) {
  return <SheetTitle data-slot='drawer-title' {...props} />
}

function DrawerTrigger<Payload>(props: ComponentProps<typeof SheetTrigger<Payload>>) {
  return <SheetTrigger data-slot='drawer-trigger' {...props} />
}

export {
  Drawer,
  DrawerBody,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHandle,
  DrawerHeader,
  DrawerIndent,
  DrawerOverlay,
  DrawerPortal,
  DrawerTitle,
  DrawerTrigger,
  nextSnapPoint,
}
