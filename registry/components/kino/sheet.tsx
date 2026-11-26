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
  panelCloseRoomClassName,
  panelHeaderClassName,
  panelOverlayClassName,
  panelStackDimClassName,
  panelTitleClassName,
  useFollowHeight,
  useScrollRegion,
} from '@/registry/lib/panel'
import { physicalSide, usePopupLayer } from '@/registry/lib/popup'
import { mergeRefs } from '@/registry/lib/refs'
import { transitionsSettled } from '@/registry/lib/resize'
import { useDirection } from '@base-ui/react/direction-provider'
import { Drawer as SheetPrimitive } from '@base-ui/react/drawer'
import {
  type ComponentProps,
  createContext,
  type ReactNode,
  type Ref,
  type RefObject,
  use,
  useLayoutEffect,
  useRef,
} from 'react'

import { cn } from '@/lib/utils'

type SheetSide = 'top' | 'bottom' | 'start' | 'end'
/**
 * `default` docks the panel to its edge while the page stays still. `recede`
 * also steps the page back behind it, inside `SheetIndent`, and pushes a
 * panel back when another opens on top of it.
 */
type SheetVariant = 'default' | 'recede'
type SwipeDirection = 'up' | 'down' | 'left' | 'right'

const SheetContext = createContext<{ edge: SwipeDirection; variant: SheetVariant }>({
  edge: 'right',
  variant: 'default',
})

/** The edge a panel on `side` docks to, as the way it is swiped to close. */
function toEdge(side: SheetSide, direction: 'ltr' | 'rtl'): SwipeDirection {
  const edge = physicalSide(
    side === 'start' ? 'inline-start' : side === 'end' ? 'inline-end' : side,
    direction,
  )
  return edge === 'top' ? 'up' : edge === 'bottom' ? 'down' : edge
}

/**
 * A panel that slides in from an edge of the screen and is swiped back to it
 * to close. `side` is logical: `start` and `end` follow the text direction.
 */
function Sheet<Payload>({
  side = 'end',
  variant = 'default',
  ...props
}: Omit<SheetPrimitive.Root.Props<Payload>, 'swipeDirection'> & {
  side?: SheetSide
  variant?: SheetVariant
}) {
  const edge = toEdge(side, useDirection())
  const root = <SheetPrimitive.Root data-slot='sheet' swipeDirection={edge} {...props} />
  return (
    <SheetContext value={{ edge, variant }}>
      {/* Its own provider, so a default panel never steps back a page wrapped in `SheetIndent`. */}
      {variant === 'recede' ? (
        root
      ) : (
        <SheetPrimitive.Provider>{root}</SheetPrimitive.Provider>
      )}
    </SheetContext>
  )
}

function SheetTrigger<Payload>(props: SheetPrimitive.Trigger.Props<Payload>) {
  return <SheetPrimitive.Trigger data-slot='sheet-trigger' {...props} />
}

function SheetPortal(props: SheetPrimitive.Portal.Props) {
  return <SheetPrimitive.Portal data-slot='sheet-portal' {...props} />
}

function SheetClose(props: SheetPrimitive.Close.Props) {
  return <SheetPrimitive.Close data-slot='sheet-close' {...props} />
}

/**
 * The part of the page the visitor sees, as insets from its top and bottom
 * edges in px: `top` and `height` are the page's box on screen, `viewport`
 * the window's height. A page scrolled 500px down is inset 500px from its top.
 */
function visibleBand(top: number, height: number, viewport: number) {
  return {
    top: Math.max(0, -top),
    bottom: Math.max(0, top + height - viewport),
  }
}

/*
 * A page taller than the window steps back as the part on screen: it shrinks
 * towards the window's top, not the page's, and its corners round there. The
 * band is measured when a panel opens (the page can't scroll while one is
 * open) and let go once the page is back in place. The corners round on
 * `data-receded`, set a style later than the band, so they animate from the
 * band's square edge rather than jumping.
 */
function trackRecede(indent: HTMLElement) {
  let settling = 0
  // The box before any transform: a page stepping back is no longer its size.
  const measure = () => {
    const parent = indent.offsetParent?.getBoundingClientRect().top ?? 0
    const band = visibleBand(
      parent + indent.offsetTop,
      indent.offsetHeight,
      window.innerHeight,
    )
    indent.style.setProperty('--sheet-band-top', `${band.top}px`)
    indent.style.setProperty('--sheet-band-bottom', `${band.bottom}px`)
  }
  // A panel that isn't modal lets the page scroll, and a window can resize
  // or turn while one is open: the band follows.
  const listen = (on: boolean) => {
    const method = on ? 'addEventListener' : 'removeEventListener'
    window[method]('scroll', measure, { passive: true, capture: true })
    window[method]('resize', measure, { passive: true })
  }
  const letGo = () => {
    listen(false)
    delete indent.dataset.band
    indent.style.removeProperty('--sheet-band-top')
    indent.style.removeProperty('--sheet-band-bottom')
  }
  const update = () => {
    const active = indent.hasAttribute('data-active')
    if (active === indent.hasAttribute('data-receded')) return
    if (!active) {
      delete indent.dataset.receded
      settling += 1
      const run = settling
      void transitionsSettled(indent).then(() => {
        if (run !== settling || indent.hasAttribute('data-active')) return
        letGo()
      })
      return
    }
    settling += 1
    if (!indent.hasAttribute('data-band')) {
      measure()
      listen(true)
      indent.dataset.band = ''
      // Style the band's square edge first, so the corners have a start to round from.
      void getComputedStyle(indent).clipPath
    }
    indent.dataset.receded = ''
  }
  const observer = new MutationObserver(update)
  observer.observe(indent, { attributes: true, attributeFilter: ['data-active'] })
  update()
  return () => {
    observer.disconnect()
    listen(false)
  }
}

/**
 * Wraps the page, so a `recede` panel steps it back: the part on screen
 * shrinks, rounds its corners and drops over black, and comes back with the
 * finger as the panel is swiped away. `--sheet-recede-scale` (0.94) and
 * `--sheet-recede-offset` (0.75rem) set how far. A part of the page that stays
 * in view, such as a header, is `sticky`, never `fixed`: while the page steps
 * back, its transform holds a fixed part to the page instead of the window.
 */
function SheetIndent({
  className,
  ref,
  ...props
}: Omit<SheetPrimitive.Indent.Props, 'className'> & {
  className?: string
  ref?: Ref<HTMLDivElement>
}) {
  return (
    <SheetPrimitive.Provider>
      {/* Black only while the page steps back: at rest it would show at the page's rounded edges. */}
      <SheetPrimitive.IndentBackground
        data-slot='sheet-indent-background'
        className='fixed inset-0 bg-transparent transition-colors duration-(--motion-exit-duration) ease-(--motion-exit-fade-easing) data-active:bg-black data-active:duration-(--motion-enter-duration) data-active:ease-(--motion-enter-fade-easing)'
      />
      <SheetPrimitive.Indent
        data-slot='sheet-indent'
        ref={mergeRefs(ref, trackRecede)}
        className={cn(
          // While a finger drags the panel, the duration is 0 and the page follows it.
          'bg-background relative origin-[50%_var(--sheet-band-top,0px)] [--sheet-progress:var(--drawer-swipe-progress,0)] transition-[transform,clip-path] duration-(--motion-exit-duration) ease-(--motion-exit-easing) data-active:[transform:translateY(calc(var(--sheet-recede-offset,0.75rem)*(1-var(--sheet-progress))))_scale(calc(var(--sheet-recede-scale,0.94)+(1-var(--sheet-recede-scale,0.94))*var(--sheet-progress)))] data-active:[transition-duration:calc(var(--motion-enter-duration)*(1-clamp(0,var(--sheet-progress)*100000,1)))] data-active:ease-(--motion-enter-easing) motion-reduce:transition-none motion-reduce:data-active:[transform:none]',
          'data-band:[clip-path:inset(var(--sheet-band-top)_0_var(--sheet-band-bottom)_0_round_0)] data-receded:[clip-path:inset(var(--sheet-band-top)_0_var(--sheet-band-bottom)_0_round_var(--surface-radius))]',
          // In dark mode a thin edge keeps the page apart from the black behind it.
          "data-band:after:pointer-events-none data-band:after:absolute data-band:after:inset-x-0 data-band:after:top-(--sheet-band-top) data-band:after:bottom-(--sheet-band-bottom) data-band:after:z-50 data-band:after:rounded-(--surface-radius) data-band:after:opacity-0 data-band:after:transition-opacity data-band:after:duration-(--motion-exit-duration) data-band:after:ease-(--motion-exit-easing) data-band:after:content-[''] data-receded:after:duration-(--motion-enter-duration) data-receded:after:ease-(--motion-enter-easing) dark:data-band:after:ring-1 dark:data-band:after:ring-white/15 dark:data-band:after:ring-inset data-receded:after:opacity-100",
          className,
        )}
        {...props}
      />
    </SheetPrimitive.Provider>
  )
}

function SheetOverlay({
  className,
  ...props
}: Omit<SheetPrimitive.Backdrop.Props, 'className'> & { className?: string }) {
  return (
    <SheetPrimitive.Backdrop
      data-slot='sheet-overlay'
      className={cn(
        panelOverlayClassName,
        // It fades as the panel is swiped away, with no delay while a finger drags; a swipe that closes it sets how fast it goes.
        'opacity-[calc(1-var(--drawer-swipe-progress,0))] data-ending-style:duration-[calc(var(--motion-exit-duration)*var(--drawer-swipe-strength,1))] in-[:has([role=dialog][data-swiping])]:duration-0',
        className,
      )}
      {...props}
    />
  )
}

/**
 * The panel's box. A panel on the top or bottom edge is as tall as its
 * content, and follows it when that changes height while it is open; one on a
 * side is as tall as the screen.
 */
function SheetSurface({
  edge,
  showCloseButton,
  children,
}: {
  edge: SwipeDirection
  showCloseButton: boolean
  children: ReactNode
}) {
  const surfaceRef = useRef<HTMLDivElement>(null)
  const innerRef = useRef<HTMLDivElement>(null)
  const followsHeight = edge === 'up' || edge === 'down'
  useFollowHeight(surfaceRef, innerRef, followsHeight)

  return (
    <div
      ref={surfaceRef}
      data-slot='sheet-surface'
      data-close-button={showCloseButton ? '' : undefined}
      className={cn(
        // Not a flex box: the inner box keeps its own height while this one animates to it.
        'group/panel-surface @container relative min-h-0 overflow-clip rounded-[inherit] transition-[height] duration-(--motion-layout-duration) ease-(--motion-layout-easing) motion-reduce:transition-none',
        panelCloseRoomClassName,
        followsHeight ? 'max-h-full' : 'h-full',
      )}
    >
      <div
        ref={innerRef}
        className={cn(
          'relative flex min-h-0 flex-col *:[form]:contents',
          followsHeight
            ? 'max-h-[calc(100cqh-(--spacing(12)))]'
            : 'h-full pb-[env(safe-area-inset-bottom)]',
          edge === 'down' && 'pb-[env(safe-area-inset-bottom)]',
        )}
      >
        {children}
        {showCloseButton ? (
          <SheetPrimitive.Close
            data-slot='sheet-close'
            render={
              <Button variant='ghost' size='icon-sm' className={panelCloseClassName} />
            }
            aria-label='Close'
          >
            <PanelCloseIcon />
          </SheetPrimitive.Close>
        ) : null}
      </div>
    </div>
  )
}

/**
 * The panel's element. Base UI sets how hard a swipe let it go on the panel
 * only, so it is copied to the overlay, which then leaves as fast.
 */
function SheetPopupElement({
  overlay,
  ...props
}: ComponentProps<'div'> & { overlay: RefObject<HTMLDivElement | null> }) {
  const strength = (props.style as Record<string, string | undefined> | undefined)?.[
    '--drawer-swipe-strength'
  ]
  useLayoutEffect(() => {
    if (strength === undefined)
      overlay.current?.style.removeProperty('--drawer-swipe-strength')
    else overlay.current?.style.setProperty('--drawer-swipe-strength', strength)
  }, [overlay, strength])
  return <div {...props} />
}

function SheetContent({
  className,
  children,
  showCloseButton = true,
  container,
  ...props
}: Omit<SheetPrimitive.Popup.Props, 'className'> & { className?: string } & {
  showCloseButton?: boolean
  /** Where the sheet is rendered; `<body>` when left out. */
  container?: SheetPrimitive.Portal.Props['container']
}) {
  const { edge, variant } = use(SheetContext)
  // Portalled out of the page's tree, so it takes the reading direction with it.
  const direction = useDirection()
  const overlay = useRef<HTMLDivElement>(null)
  const layer = usePopupLayer()
  return (
    <SheetPortal container={container ?? layer}>
      <SheetOverlay ref={overlay} />
      <SheetPrimitive.Viewport
        data-slot='sheet-viewport'
        data-swipe-direction={edge}
        dir={direction}
        className='@container-size fixed inset-0 z-50 flex data-[swipe-direction=down]:items-end data-[swipe-direction=down]:justify-center data-[swipe-direction=up]:items-start data-[swipe-direction=up]:justify-center'
      >
        <SheetPrimitive.Popup
          data-slot='sheet-content'
          data-variant={variant}
          render={<SheetPopupElement overlay={overlay} />}
          className={cn(
            /*
             * It moves on `transform`, which Base UI also writes while a finger
             * drags it: in from its edge on `enter`, back to it on `exit`,
             * faster the faster it was swiped. A strip past the edge, in the
             * colour the panel ends in, covers the gap when a spring overshoots.
             */
            'group/sheet w-[min(26rem,calc(100%-(--spacing(12))))] bg-background text-foreground relative flex flex-col text-sm shadow-xl [--sheet-from-x:0px] [--sheet-from-y:0px] [--sheet-stack-scale:1] [--sheet-stack-y:0px] [transform:translate3d(var(--drawer-swipe-movement-x,0px),calc(var(--drawer-snap-point-offset,0px)+var(--drawer-swipe-movement-y,0px)+var(--sheet-stack-y)),0)_scale(var(--sheet-stack-scale))] transition-[transform] duration-(--motion-enter-duration) ease-(--motion-enter-easing) focus-visible:outline-hidden after:absolute after:bg-inherit data-ending-style:[transform:translate3d(var(--sheet-from-x),var(--sheet-from-y),0)] data-ending-style:duration-[calc(var(--motion-exit-duration)*var(--drawer-swipe-strength,1))] data-ending-style:ease-(--motion-exit-easing) data-starting-style:[transform:translate3d(var(--sheet-from-x),var(--sheet-from-y),0)] data-swiping:duration-0 data-swiping:select-none forced-colors:outline motion-reduce:transition-opacity motion-reduce:data-ending-style:[transform:none] motion-reduce:data-ending-style:opacity-0 motion-reduce:data-starting-style:[transform:none] motion-reduce:data-starting-style:opacity-0',
            // A panel with another open on top of it dims.
            panelStackDimClassName,
            // `recede`: it steps back and up the way the page does, so its top shows above the one in front.
            'data-[variant=recede]:origin-top data-[variant=recede]:data-nested-drawer-open:[--sheet-stack-scale:calc(1-(1-var(--sheet-recede-scale,0.94))*var(--nested-drawers))] data-[variant=recede]:data-nested-drawer-open:[--sheet-stack-y:calc(min(0px,var(--drawer-height,0px)-var(--drawer-frontmost-height,0px))-var(--sheet-recede-offset,0.75rem)*var(--nested-drawers))] data-[variant=recede]:data-nested-drawer-open:before:bg-black/15 motion-reduce:[--sheet-stack-scale:1]! motion-reduce:[--sheet-stack-y:0px]!',
            'data-[swipe-direction=right]:ml-auto data-[swipe-direction=right]:h-full data-[swipe-direction=right]:border-l data-[swipe-direction=right]:[--sheet-from-x:calc(100%+(--spacing(4)))] data-[swipe-direction=right]:after:inset-y-0 data-[swipe-direction=right]:after:left-full data-[swipe-direction=right]:after:w-12',
            'data-[swipe-direction=left]:mr-auto data-[swipe-direction=left]:h-full data-[swipe-direction=left]:border-r data-[swipe-direction=left]:[--sheet-from-x:calc(-100%-(--spacing(4)))] data-[swipe-direction=left]:after:inset-y-0 data-[swipe-direction=left]:after:right-full data-[swipe-direction=left]:after:w-12',
            'data-[swipe-direction=down]:w-full data-[swipe-direction=down]:rounded-t-(--surface-radius-lg) data-[swipe-direction=down]:border-t data-[swipe-direction=down]:[--sheet-from-y:calc(100%+(--spacing(4)))] data-[swipe-direction=down]:after:inset-x-0 data-[swipe-direction=down]:after:top-full data-[swipe-direction=down]:after:h-12 data-[swipe-direction=down]:has-data-[panel=footer]:after:bg-(--panel-footer)',
            'data-[swipe-direction=up]:w-full data-[swipe-direction=up]:rounded-b-(--surface-radius-lg) data-[swipe-direction=up]:border-b data-[swipe-direction=up]:[--sheet-from-y:calc(-100%-(--spacing(4)))] data-[swipe-direction=up]:after:inset-x-0 data-[swipe-direction=up]:after:bottom-full data-[swipe-direction=up]:after:h-12',
            panelFooterTint,
            className,
          )}
          {...props}
        >
          <SheetSurface edge={edge} showCloseButton={showCloseButton}>
            {children}
          </SheetSurface>
        </SheetPrimitive.Popup>
      </SheetPrimitive.Viewport>
    </SheetPortal>
  )
}

function SheetHeader({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot='sheet-header'
      className={cn(panelHeaderClassName, className)}
      {...props}
    />
  )
}

function SheetTitle({
  className,
  ...props
}: Omit<SheetPrimitive.Title.Props, 'className'> & { className?: string }) {
  return (
    <SheetPrimitive.Title
      data-slot='sheet-title'
      className={cn(panelTitleClassName, className)}
      {...props}
    />
  )
}

function SheetDescription({
  className,
  ...props
}: Omit<SheetPrimitive.Description.Props, 'className'> & { className?: string }) {
  return (
    <SheetPrimitive.Description
      data-slot='sheet-description'
      className={cn(panelDescriptionClassName, className)}
      {...props}
    />
  )
}

/**
 * What scrolls between the header and the footer. `className` goes to its
 * content, every other prop to the element that scrolls. Its text can be
 * selected with a mouse without dragging the sheet. While it scrolls it takes
 * focus, so the keyboard can scroll it, as a region named by the title.
 */
function SheetBody({
  className,
  children,
  ref,
  ...props
}: Omit<SheetPrimitive.Content.Props, 'className'> & { className?: string }) {
  const scrollerRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const scrollRegion = useScrollRegion(scrollerRef, contentRef)

  return (
    <div data-panel='body' className={panelBodyFrameClassName}>
      <SheetPrimitive.Content
        ref={mergeRefs(scrollerRef, ref)}
        data-slot='sheet-body'
        {...scrollRegion}
        className={panelBodyClassName}
        {...props}
      >
        <div
          ref={contentRef}
          data-slot='sheet-body-content'
          className={cn(panelBodyContentClassName, className)}
        >
          {children}
        </div>
      </SheetPrimitive.Content>
    </div>
  )
}

function SheetFooter({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot='sheet-footer'
      data-panel='footer'
      className={cn(panelFooterClassName, 'mt-auto', className)}
      {...props}
    />
  )
}

export {
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
  type SheetSide,
  type SheetVariant,
  toEdge,
  visibleBand,
}
