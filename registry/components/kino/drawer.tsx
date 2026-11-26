'use client'

import { Button } from '@/registry/components/kino/button'
import { useControllable } from '@/registry/lib/controllable'
import { gripClassName } from '@/registry/lib/grip'
import {
  PanelCloseIcon,
  PanelHandle,
  panelBodyClassName,
  panelBodyContentClassName,
  panelBodyFrameClassName,
  panelCloseClassName,
  panelCloseRoomClassName,
  panelDescriptionClassName,
  panelDimClassName,
  panelFooterClassName,
  panelFooterTint,
  panelHeaderClassName,
  panelTitleClassName,
  useFollowHeight,
  useScrollRegion,
} from '@/registry/lib/panel'
import { mergeRefs } from '@/registry/lib/refs'
import { useSheetPhysics } from '@/registry/lib/sheet-physics'
import {
  Drawer as DrawerPrimitive,
  DrawerBackdrop as DrawerBackdropPrimitive,
  DrawerClose as DrawerClosePrimitive,
  DrawerContent as DrawerContentPrimitive,
  type DrawerContentState,
  DrawerDescription as DrawerDescriptionPrimitive,
  DrawerHandle as DrawerHandlePrimitive,
  type DrawerKeyframes,
  DrawerOutlet as DrawerOutletPrimitive,
  DrawerTitle as DrawerTitlePrimitive,
  DrawerTrigger as DrawerTriggerPrimitive,
} from '@ui-sdk/react/drawer'
import { type PartProps, renderElement } from '@ui-sdk/react/primitive'
import {
  type ComponentProps,
  createContext,
  type ReactNode,
  type RefObject,
  use,
  useCallback,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { flushSync } from 'react-dom'

import { cn } from '@/lib/utils'

/**
 * `default` docks the panel to its edge while the page stays still. `recede`
 * also steps it back and up while another drawer is open on top of it.
 */
type DrawerVariant = 'default' | 'recede'

const DrawerContext = createContext<{
  snaps: boolean
  trigger?: RefObject<HTMLElement | null>
  content?: RefObject<HTMLElement | null>
  onDrag?: (dragging: boolean) => void
}>({ snaps: false })

/** The panel of the drawer this one was opened from, which reads its height to step back. */
const PanelBelowContext = createContext<RefObject<HTMLElement | null> | null>(null)

/** Whether the drawer around rests at its largest snap point, which names its handle. */
const ExpandedContext = createContext(false)

/**
 * A panel that slides in from an edge of the screen, `bottom` unless `side`
 * says another, and is dragged back to it to close. `start` and `end`
 * follow the text direction. With `snapPoints` it rests at the first and is
 * dragged, or its handle pressed, to the next. ui-sdk moves it on a spring
 * of its own, timed by the feel's `enter` spring while it opens and rests
 * and its `exit` spring while it closes or is let go, where it is: a
 * `data-feel` or `data-motion='reduce'` around it re-times or stops it.
 */
function Drawer({
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  ...props
}: Omit<ComponentProps<typeof DrawerPrimitive>, 'physics'>) {
  // Held here, so the spring can change to `exit` in the render that closes it.
  const [open, setOpen] = useControllable(openProp, defaultOpen, onOpenChange)
  const trigger = useRef<HTMLElement | null>(null)
  const content = useRef<HTMLElement | null>(null)
  const [dragging, setDragging] = useState(false)
  const at = useCallback(() => content.current ?? trigger.current, [])
  // ui-sdk works out a release's spring as the finger lifts, before the render that closes it.
  const physics = useSheetPhysics(open && !dragging ? 'enter' : 'exit', at)
  const snaps = (props.snapPoints?.length ?? 0) > 1
  return (
    <DrawerContext value={{ snaps, trigger, content, onDrag: setDragging }}>
      <DrawerPrimitive
        open={open}
        onOpenChange={setOpen}
        physics={physics}
        // At its first snap point, a peek, the page stays undimmed and usable.
        modalAbove={snaps ? props.snapPoints?.[0] : undefined}
        {...props}
      />
    </DrawerContext>
  )
}

function DrawerTrigger({ ref, ...props }: ComponentProps<typeof DrawerTriggerPrimitive>) {
  const { trigger } = use(DrawerContext)
  const own = useMemo(() => mergeRefs(ref, trigger), [ref, trigger])
  return <DrawerTriggerPrimitive ref={own} {...props} />
}

function DrawerClose(props: ComponentProps<typeof DrawerClosePrimitive>) {
  return <DrawerClosePrimitive {...props} />
}

/**
 * The dim behind the drawer, which follows it as it is dragged. A drawer
 * opened from another one leaves its dim out: the one below already dims the
 * page, and dims itself.
 */
function DrawerBackdrop({
  className,
  ...props
}: Omit<ComponentProps<typeof DrawerBackdropPrimitive>, 'className'> & {
  className?: string
}) {
  return (
    <DrawerBackdropPrimitive
      className={cn(panelDimClassName, 'data-nested:invisible', className)}
      {...props}
    />
  )
}

/**
 * The bar on a bottom drawer's top edge that shows it can be dragged. With
 * snap points it is a button: pressing it moves the drawer to the next, so
 * it can be resized without dragging, and the arrow keys, Home and End step.
 */
function DrawerHandle({
  className,
  ...props
}: Omit<ComponentProps<typeof DrawerHandlePrimitive>, 'className'> & {
  className?: string
}) {
  const { snaps } = use(DrawerContext)
  const expanded = use(ExpandedContext)
  if (!snaps) return <PanelHandle className={className} />
  return (
    // A press walks on to the next snap point, back to the first after the last.
    <DrawerHandlePrimitive
      data-panel='handle'
      aria-label={expanded ? 'Collapse' : 'Expand'}
      className={cn(
        'group/grip focus-visible:ring-ring/50 mx-auto flex h-6 w-16 shrink-0 items-end justify-center rounded-full focus-visible:ring-3 focus-visible:outline-hidden',
        className,
      )}
      {...props}
    >
      <span className={cn(gripClassName, 'h-1 w-10')} />
    </DrawerHandlePrimitive>
  )
}

/**
 * The panel's box. A panel on the top or bottom edge is as tall as its
 * content, and follows it when that changes height while it is open; one on
 * a side is as tall as the screen.
 */
function DrawerSurface({
  vertical,
  closeButton,
  children,
}: {
  vertical: boolean
  closeButton: ReactNode
  children: ReactNode
}) {
  const surfaceRef = useRef<HTMLDivElement>(null)
  const innerRef = useRef<HTMLDivElement>(null)
  useFollowHeight(surfaceRef, innerRef, vertical)

  return (
    <div
      ref={surfaceRef}
      data-close-button={closeButton ? '' : undefined}
      className={cn(
        // Not a flex box: the inner box keeps its own height while this one animates to it.
        'group/panel-surface @container relative min-h-0 overflow-clip rounded-[inherit] transition-[height] duration-(--motion-layout-duration) ease-(--motion-layout-easing) motion-reduce:transition-none',
        panelCloseRoomClassName,
        vertical ? 'max-h-full' : 'h-full',
      )}
    >
      <div
        ref={innerRef}
        className={cn(
          'relative flex min-h-0 flex-col pb-[env(safe-area-inset-bottom)] *:[form]:contents',
          vertical ? 'max-h-[calc(100cqh-(--spacing(12)))]' : 'h-full',
        )}
      >
        {children}
        {closeButton}
      </div>
    </div>
  )
}

/**
 * The panel, with its dim, and the handle on a bottom drawer. ui-sdk moves
 * it on `translate` and sets the dim's opacity, so neither is styled here.
 * `children` are its parts, or a function of its state that returns them,
 * such as to read the `payload` a trigger passed.
 */
function DrawerContent<Payload = unknown>({
  className,
  children,
  showCloseButton = true,
  variant = 'default',
  initialFocus = 'content',
  ref,
  ...props
}: Omit<
  ComponentProps<typeof DrawerContentPrimitive<Payload>>,
  'className' | 'children' | 'container'
> & {
  className?: string
  children?: ReactNode | ((state: DrawerContentState<Payload>) => ReactNode)
  showCloseButton?: boolean
  variant?: DrawerVariant
}) {
  const { content, onDrag } = use(DrawerContext)
  const below = use(PanelBelowContext)
  const own = useMemo(
    () =>
      mergeRefs(ref, content, holdFocusedStill, stackHeights(below), followDrag(onDrag)),
    [ref, content, below, onDrag],
  )
  return (
    <>
      <DrawerBackdrop />
      <DrawerContentPrimitive<Payload>
        ref={own}
        initialFocus={initialFocus}
        data-variant={variant}
        className={cn(
          /*
           * A strip past the edge, in the colour the panel ends in, covers
           * the gap when a spring overshoots or the panel is pulled past its
           * size. While a drawer is open on top, this one dims, on that
           * drawer's `enter` and `exit` roles.
           */
          'group/drawer bg-background text-foreground relative flex flex-col text-sm shadow-xl focus-visible:outline-hidden after:absolute after:bg-inherit forced-colors:outline',
          'before:pointer-events-none before:absolute before:inset-0 before:z-20 before:rounded-[inherit] before:bg-black/10 before:opacity-0 before:transition-opacity before:duration-(--motion-exit-duration) before:ease-(--motion-exit-fade-easing) data-nested-open:before:opacity-100 data-nested-open:before:duration-(--motion-enter-duration) data-nested-open:before:ease-(--motion-enter-fade-easing) data-[variant=recede]:before:bg-black/15 dark:before:bg-black/40',
          /*
           * `recede`: it steps back and up the way a page does, lifted to the
           * top of a taller drawer in front and past it by
           * `--drawer-recede-offset`, so its top shows above that one.
           */
          'data-[variant=recede]:origin-top data-[variant=recede]:transition-transform data-[variant=recede]:duration-(--motion-exit-duration) data-[variant=recede]:ease-(--motion-exit-easing) data-[variant=recede]:data-nested-open:duration-(--motion-enter-duration) data-[variant=recede]:data-nested-open:ease-(--motion-enter-easing) data-[variant=recede]:data-nested-open:[transform:translateY(calc(min(0px,var(--drawer-height,0px)-var(--drawer-front-height,0px))-var(--drawer-recede-offset,0.75rem)))_scale(var(--drawer-recede,0.94))] motion-reduce:data-[variant=recede]:transition-none motion-reduce:data-[variant=recede]:data-nested-open:[transform:none]',
          // A panel on a side is 26rem wide, never closer than 3rem to the far edge, one on the bottom edge no wider than 40rem, and one on the top edge as wide as the screen, unless `className` sets another width.
          'w-[min(26rem,calc(100%-(--spacing(12))))] max-w-160',
          'data-[side=left]:h-full data-[side=left]:border-e data-[side=left]:after:inset-y-0 data-[side=left]:after:right-full data-[side=left]:after:w-12',
          'data-[side=right]:h-full data-[side=right]:border-s data-[side=right]:after:inset-y-0 data-[side=right]:after:left-full data-[side=right]:after:w-12',
          'data-[side=bottom]:mx-auto data-[side=bottom]:w-full data-[side=bottom]:rounded-t-(--surface-radius-lg) data-[side=bottom]:border-t data-[side=bottom]:after:inset-x-0 data-[side=bottom]:after:top-full data-[side=bottom]:after:h-12 data-[side=bottom]:has-data-[panel=footer]:after:bg-(--panel-footer)',
          'data-[side=top]:w-full data-[side=top]:max-w-none data-[side=top]:rounded-b-(--surface-radius-lg) data-[side=top]:border-b data-[side=top]:after:inset-x-0 data-[side=top]:after:bottom-full data-[side=top]:after:h-12',
          panelFooterTint,
          className,
        )}
        {...props}
      >
        {(state) => (
          <PanelBelowContext value={content ?? null}>
            <ExpandedContext value={state.expanded}>
              <DrawerSurface
                vertical={state.side === 'top' || state.side === 'bottom'}
                closeButton={
                  showCloseButton ? (
                    <DrawerClosePrimitive
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
                    </DrawerClosePrimitive>
                  ) : null
                }
              >
                {state.side === 'bottom' ? <DrawerHandle /> : null}
                {typeof children === 'function' ? children(state) : children}
              </DrawerSurface>
            </ExpandedContext>
          </PanelBelowContext>
        )}
      </DrawerContentPrimitive>
    </>
  )
}

function DrawerHeader({
  className,
  render,
  ...props
}: Omit<PartProps<'div'>, 'className'> & { className?: string }) {
  return renderElement(
    'div',
    {
      'data-slot': 'drawer-header',
      className: cn(panelHeaderClassName, className),
      ...props,
    },
    render,
  )
}

function DrawerTitle({
  className,
  ...props
}: Omit<ComponentProps<typeof DrawerTitlePrimitive>, 'className'> & {
  className?: string
}) {
  return (
    <DrawerTitlePrimitive className={cn(panelTitleClassName, className)} {...props} />
  )
}

function DrawerDescription({
  className,
  ...props
}: Omit<ComponentProps<typeof DrawerDescriptionPrimitive>, 'className'> & {
  className?: string
}) {
  return (
    <DrawerDescriptionPrimitive
      className={cn(panelDescriptionClassName, className)}
      {...props}
    />
  )
}

/**
 * What scrolls between the header and the footer. `className` goes to its
 * content, every other prop to the element that scrolls. Dragging it down
 * once it is scrolled to the top moves the drawer. While it scrolls it takes
 * focus, so the keyboard can scroll it, as a region named by the title.
 */
/**
 * What scrolls between the header and the footer. A finger drags the drawer
 * from it; a mouse selects its text, and drags from the header or the handle.
 */
function DrawerBody({ className, children, ref, ...props }: ComponentProps<'div'>) {
  const scrollerRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const scrollRegion = useScrollRegion(scrollerRef, contentRef)
  const own = useMemo(() => mergeRefs(scrollerRef, ref), [ref])
  const mouse = useSyncExternalStore(watchMouse, pointsWithMouse, () => false)

  return (
    <div data-panel='body' className={panelBodyFrameClassName}>
      <div
        ref={own}
        data-slot='drawer-body'
        data-drawer-no-drag={mouse ? '' : undefined}
        {...scrollRegion}
        className={panelBodyClassName}
        {...props}
      >
        <div
          ref={contentRef}
          data-slot='drawer-body-content'
          className={cn(panelBodyContentClassName, className)}
        >
          {children}
        </div>
      </div>
    </div>
  )
}

/**
 * ui-sdk 0.1.0-beta.17's drawer scrolls a field that takes focus into view
 * in the area that scrolls around it, and takes a scroller that has focus
 * itself, such as the body or a Scroll area, for both, so every click or Tab
 * into one scrolled it 16px. While an element in the drawer has focus, a
 * script's scroll by on that element leaves it where it is; the keys and the
 * wheel still scroll it.
 */
function holdFocusedStill(content: HTMLElement | null) {
  if (!content) return
  const held = new WeakSet<Element>()
  const hold = (event: FocusEvent) => {
    const target = event.target
    // jsdom has no scrollBy.
    if (!(target instanceof HTMLElement) || held.has(target) || !target.scrollBy) return
    held.add(target)
    const scrollBy = target.scrollBy.bind(target)
    target.scrollBy = ((...args: Parameters<typeof scrollBy>) => {
      if (target.ownerDocument.activeElement !== target) scrollBy(...args)
    }) as HTMLElement['scrollBy']
  }
  // Before ui-sdk's own listener on the drawer.
  content.addEventListener('focusin', hold, true)
  return () => content.removeEventListener('focusin', hold, true)
}

/**
 * Writes the panel's height as `--drawer-height`, and on the panel below it
 * as `--drawer-front-height`, so a `recede` panel below lifts to its top.
 */
const MOUSE = '(hover: hover) and (pointer: fine)'

/** Whether the device's main pointer is a mouse or a trackpad. */
function pointsWithMouse() {
  return window.matchMedia(MOUSE).matches
}

function watchMouse(onChange: () => void) {
  const query = window.matchMedia(MOUSE)
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}

/** Tells the drawer while a finger, mouse or pen drags it, in time for the release. */
function followDrag(onDrag?: (dragging: boolean) => void) {
  return (panel: HTMLElement | null) => {
    if (!panel || !onDrag) return
    const observer = new MutationObserver(() => {
      const dragging = panel.hasAttribute('data-dragging')
      flushSync(() => onDrag(dragging))
    })
    observer.observe(panel, { attributes: true, attributeFilter: ['data-dragging'] })
    return () => observer.disconnect()
  }
}

function stackHeights(below: RefObject<HTMLElement | null> | null) {
  return (panel: HTMLElement | null) => {
    if (!panel || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => {
      const height = `${panel.offsetHeight}px`
      panel.style.setProperty('--drawer-height', height)
      below?.current?.style.setProperty('--drawer-front-height', height)
    })
    observer.observe(panel)
    return () => {
      observer.disconnect()
      below?.current?.style.removeProperty('--drawer-front-height')
    }
  }
}

function DrawerFooter({
  className,
  render,
  ...props
}: Omit<PartProps<'div'>, 'className'> & { className?: string }) {
  return renderElement(
    'div',
    {
      'data-slot': 'drawer-footer',
      'data-panel': 'footer',
      className: cn(panelFooterClassName, 'mt-auto', className),
      ...props,
    },
    render,
  )
}

/**
 * The page steps back while the drawer opens: it shrinks by
 * `--drawer-recede` (0.94), drops `--drawer-recede-offset` (0.75rem) and
 * rounds its corners over black, and comes back with the finger as the
 * drawer is dragged away. ui-sdk plays it on the compositor. Inside
 * `Drawer`, or outside it with the drawer's `controller`.
 */
function DrawerOutlet({
  className,
  keyframes = RECEDE,
  ...props
}: Omit<ComponentProps<typeof DrawerOutletPrimitive>, 'className'> & {
  className?: string
}) {
  return (
    <DrawerOutletPrimitive
      keyframes={keyframes}
      className={cn(
        // Under reduced motion the page stays where it is, and only the dim shows the drawer.
        'bg-background origin-top [--drawer-outlet-edge:transparent] dark:[--drawer-outlet-edge:--alpha(var(--color-white)/15%)] motion-reduce:scale-100! motion-reduce:translate-none! motion-reduce:rounded-none! motion-reduce:shadow-none!',
        className,
      )}
      {...props}
    />
  )
}

/* A spread shadow paints the black around the page as it shrinks; in dark mode a thin edge keeps the two apart. */
const RECEDE: DrawerKeyframes = {
  scale: ['1', 'var(--drawer-recede, 0.94)'],
  translate: ['0 0', '0 var(--drawer-recede-offset, 0.75rem)'],
  borderRadius: ['0px', 'var(--surface-radius)'],
  boxShadow: [
    '0 0 0 1px transparent, 0 0 0 100vmax transparent',
    '0 0 0 1px var(--drawer-outlet-edge), 0 0 0 100vmax black',
  ],
}

export {
  Drawer,
  DrawerBackdrop,
  DrawerBody,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHandle,
  DrawerHeader,
  DrawerOutlet,
  DrawerTitle,
  DrawerTrigger,
  type DrawerVariant,
}
