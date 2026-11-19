'use client'

import {
  Drawer,
  DrawerBody,
  DrawerClose,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from '@/registry/components/kino/drawer'
import {
  Popover,
  PopoverClose,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from '@/registry/components/kino/popover'
import { useControllable } from '@/registry/lib/controllable'
import { mergeRefs } from '@/registry/lib/refs'
import { useRoomy } from '@/registry/lib/roomy'
import {
  edgeFadeClassName,
  followEdges,
  scrollRegionRingClassName,
  useScrollRegion,
} from '@/registry/lib/scroll'
import type { Drawer as DrawerPrimitive } from '@base-ui/react/drawer'
import { createChangeEventDetails } from '@base-ui/react/internals/createBaseUIEventDetails'
import type { Popover as PopoverPrimitive } from '@base-ui/react/popover'
import {
  type ComponentProps,
  createContext,
  type ReactNode,
  use,
  useEffect,
  useMemo,
  useRef,
} from 'react'

import { cn } from '@/lib/utils'

/*
 * A popover that opens as a bottom sheet on a phone, for a panel of content
 * with a header, a body that scrolls and a footer, such as a notification
 * center. On a wider screen it is the Popover, growing from its trigger; below
 * 40rem (`roomy`) the same parts open in a Drawer, rows a finger can press.
 * Both are dialogs, named by their title. The menus' own version of this is
 * `menu-sheet`.
 */

const PopoverSheetContext = createContext({ sheet: false })

/** Why it opened or closed: the Popover's details, or on a phone the Drawer's. */
type PopoverSheetOpenChangeDetails =
  | PopoverPrimitive.Root.ChangeEventDetails
  | DrawerPrimitive.Root.ChangeEventDetails

/** The details of a close that a press on something in it asked for, such as a row it opens. */
function itemPressDetails(event: MouseEvent): PopoverSheetOpenChangeDetails {
  return createChangeEventDetails('item-press', event)
}

/** Whether it opens as a sheet: on a phone. */
function usePopoverSheet() {
  return use(PopoverSheetContext)
}

/**
 * The Popover, or on a phone the Drawer. `open`, `defaultOpen`,
 * `onOpenChange` and `modal` hold for both.
 */
function PopoverSheet({
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  modal,
  children,
}: {
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean, eventDetails: PopoverSheetOpenChangeDetails) => void
  /** The popover isn't modal unless asked; the sheet is unless `false`. */
  modal?: boolean
  children: ReactNode
}) {
  const sheet = !useRoomy()
  const [open, change] = useControllable<boolean, [PopoverSheetOpenChangeDetails]>(
    openProp,
    defaultOpen,
    onOpenChange,
  )
  const context = useMemo(() => ({ sheet }), [sheet])
  return (
    <PopoverSheetContext value={context}>
      {sheet ? (
        <Drawer
          open={open}
          onOpenChange={change}
          {...(modal === undefined ? {} : { modal })}
        >
          {children}
        </Drawer>
      ) : (
        <Popover open={open} onOpenChange={change} modal={modal ?? false}>
          {children}
        </Popover>
      )}
    </PopoverSheetContext>
  )
}

/** The button that opens it, such as an icon Button through `render`. */
function PopoverSheetTrigger(
  props: Omit<
    ComponentProps<typeof PopoverTrigger>,
    'openOnHover' | 'delay' | 'closeDelay'
  >,
) {
  const { sheet } = usePopoverSheet()
  if (sheet) {
    return (
      <DrawerTrigger
        data-slot='popover-sheet-trigger'
        {...(props as ComponentProps<typeof DrawerTrigger>)}
      />
    )
  }
  return <PopoverTrigger data-slot='popover-sheet-trigger' {...props} />
}

/**
 * The box: a header, a body that scrolls and a footer, in a column. In the
 * popover it is `--popover-sheet-width` wide (24rem) and no taller than
 * `--popover-sheet-height` (32rem) or the room left on screen; in the sheet,
 * the screen's width, as tall as what it holds. `className` goes to the
 * column. `--popover-sheet-edge` is how far its header and footer sit from
 * its sides, so what's in the body can line up with them.
 */
function PopoverSheetContent({
  className,
  fixedHeight = false,
  children,
  side = 'bottom',
  align = 'end',
  sideOffset,
  alignOffset,
  initialFocus,
  finalFocus,
}: {
  className?: string
  /**
   * The popover is always `--popover-sheet-height` tall, so what it shows,
   * such as another tab, never resizes it. The sheet follows what it holds.
   */
  fixedHeight?: boolean
  children: ReactNode
  side?: ComponentProps<typeof PopoverContent>['side']
  align?: ComponentProps<typeof PopoverContent>['align']
  sideOffset?: number
  alignOffset?: number
  /** What takes focus when it opens; its first control when left out. */
  initialFocus?: ComponentProps<typeof PopoverContent>['initialFocus']
  /** What takes focus when it closes; the trigger when left out. */
  finalFocus?: ComponentProps<typeof PopoverContent>['finalFocus']
}) {
  const { sheet } = usePopoverSheet()
  if (sheet) {
    return (
      <DrawerContent
        data-slot='popover-sheet-content'
        showCloseButton={false}
        initialFocus={initialFocus}
        finalFocus={finalFocus}
        className={cn('[--popover-sheet-edge:var(--surface-padding-lg)]', className)}
      >
        {children}
      </DrawerContent>
    )
  }
  return (
    <PopoverContent
      data-slot='popover-sheet-content'
      side={side}
      align={align}
      sideOffset={sideOffset}
      alignOffset={alignOffset}
      initialFocus={initialFocus}
      finalFocus={finalFocus}
      // The column scrolls its body, not itself.
      className={cn(
        'max-h-[calc(var(--available-height)-2px)] w-(--popover-sheet-width,24rem) gap-0 p-0 [--popover-sheet-edge:var(--surface-padding)]',
        fixedHeight
          ? 'h-(--popover-sheet-height,32rem)'
          : 'max-h-[min(var(--popover-sheet-height,32rem),calc(var(--available-height)-2px))]',
        className,
      )}
    >
      {children}
    </PopoverContent>
  )
}

/** Above the body: the title and what acts on the whole panel. */
function PopoverSheetHeader({ className, ...props }: ComponentProps<'div'>) {
  const { sheet } = usePopoverSheet()
  if (sheet) {
    return (
      <DrawerHeader
        data-slot='popover-sheet-header'
        className={cn('pb-2', className)}
        {...props}
      />
    )
  }
  return (
    <div
      data-slot='popover-sheet-header'
      className={cn(
        'flex shrink-0 flex-col gap-1.5 px-(--popover-sheet-edge) pt-(--popover-sheet-edge) pb-2',
        className,
      )}
      {...props}
    />
  )
}

/** Names the panel; a screen reader reads it as the dialog opens. */
function PopoverSheetTitle({ className, ...props }: ComponentProps<typeof PopoverTitle>) {
  const { sheet } = usePopoverSheet()
  if (sheet) {
    return (
      <DrawerTitle
        data-slot='popover-sheet-title'
        className={className}
        {...(props as ComponentProps<typeof DrawerTitle>)}
      />
    )
  }
  return (
    <PopoverTitle
      data-slot='popover-sheet-title'
      className={cn('text-base', className)}
      {...props}
    />
  )
}

const dialogTitleOf = (scroller: HTMLElement) =>
  scroller.closest('[role=dialog]')?.getAttribute('aria-labelledby')

/**
 * What scrolls between the header and the footer. `className` goes to its
 * content. While it scrolls it takes focus, so the keyboard can scroll it, as
 * a region named by the title.
 */
function PopoverSheetBody({
  className,
  children,
  ref,
}: {
  className?: string
  children: ReactNode
  ref?: ComponentProps<'div'>['ref']
}) {
  const { sheet } = usePopoverSheet()
  const scrollerRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const region = useScrollRegion(scrollerRef, {
    contentRef,
    labelledBy: dialogTitleOf,
    refocus: (scroller) => scroller.closest<HTMLElement>('[role=dialog]'),
  })
  const own = useMemo(() => mergeRefs(scrollerRef, ref), [ref])
  useEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller) return
    return followEdges(scroller, '--scroll-fade', contentRef.current)
  }, [sheet])
  if (sheet) {
    return (
      <DrawerBody data-slot='popover-sheet-body' className={className}>
        {children}
      </DrawerBody>
    )
  }
  return (
    <div className={cn('flex min-h-0 flex-1 flex-col', scrollRegionRingClassName)}>
      <div
        ref={own}
        data-slot='popover-sheet-body'
        {...region}
        className={cn(
          'scrollbar-thin min-h-0 flex-1 overflow-y-auto overscroll-contain focus-visible:outline-hidden',
          edgeFadeClassName,
        )}
      >
        <div ref={contentRef} className={cn('flex flex-col', className)}>
          {children}
        </div>
      </div>
    </div>
  )
}

/** Under the body, such as a link to the settings. */
function PopoverSheetFooter({ className, ...props }: ComponentProps<'div'>) {
  const { sheet } = usePopoverSheet()
  if (sheet) {
    return (
      <DrawerFooter data-slot='popover-sheet-footer' className={className} {...props} />
    )
  }
  return (
    <div
      data-slot='popover-sheet-footer'
      className={cn(
        'flex shrink-0 items-center gap-2 border-t px-(--popover-sheet-edge) py-2',
        className,
      )}
      {...props}
    />
  )
}

/** A button that closes it, through `render`. */
function PopoverSheetClose(props: ComponentProps<typeof PopoverClose>) {
  const { sheet } = usePopoverSheet()
  if (sheet) {
    return (
      <DrawerClose
        data-slot='popover-sheet-close'
        {...(props as ComponentProps<typeof DrawerClose>)}
      />
    )
  }
  return <PopoverClose data-slot='popover-sheet-close' {...props} />
}

export {
  PopoverSheet,
  PopoverSheetBody,
  PopoverSheetClose,
  PopoverSheetContent,
  PopoverSheetFooter,
  PopoverSheetHeader,
  PopoverSheetTitle,
  PopoverSheetTrigger,
  usePopoverSheet,
  itemPressDetails,
}
export type { PopoverSheetOpenChangeDetails }
