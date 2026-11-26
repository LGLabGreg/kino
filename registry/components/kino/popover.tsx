'use client'

import {
  PanelHandle,
  panelBodyFrameClassName,
  panelFooterTint,
  panelSheetBackdropClassName,
  panelSheetClassName,
  useScrollRegion,
} from '@/registry/lib/panel'
import {
  HOVER_DELAY,
  POPUP_COLLISION_PADDING,
  PopupLayerContext,
  popupGrowBoxClassName,
  popupGrowContentClassName,
  popupPlacedClassName,
  popupSurfaceClassName,
  useOwnPopupLayer,
} from '@/registry/lib/popup'
import { reducesMotion, watchReducedMotion } from '@/registry/lib/reduce-motion'
import { mergeRefs } from '@/registry/lib/refs'
import { edgeFadeClassName } from '@/registry/lib/scroll'
import {
  Popover as PopoverPrimitive,
  PopoverClose as PopoverClosePrimitive,
  PopoverContent as PopoverContentPrimitive,
  PopoverDescription as PopoverDescriptionPrimitive,
  PopoverTitle as PopoverTitlePrimitive,
  PopoverTrigger as PopoverTriggerPrimitive,
} from '@ui-sdk/react/popover'
import { type PartProps, renderElement } from '@ui-sdk/react/primitive'
import {
  type ComponentProps,
  createContext,
  type ReactNode,
  use,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'

import { cn } from '@/lib/utils'

/** Why the popover opened or closed, as `onOpenChange` hears it. */
type PopoverOpenChangeDetails = Parameters<
  NonNullable<ComponentProps<typeof PopoverPrimitive>['onOpenChange']>
>[1]

/* Tells the popover where its trigger is, to read the motion preference there. */
const TriggerContext = createContext<((element: HTMLElement | null) => void) | null>(null)

/**
 * With `openOnHover`, it waits 200ms before it opens. With
 * `presentation='auto'`, a small touch screen opens it as a sheet from the
 * bottom edge, unless motion is reduced around its trigger: ui-sdk slides the
 * sheet in on a spring of its own, which reduced motion can't stop, so it
 * opens as a popover then. That spring doesn't follow the feel either, so it
 * is a popover unless you ask.
 */
function Popover({
  delay = HOVER_DELAY,
  presentation = 'popover',
  ...props
}: ComponentProps<typeof PopoverPrimitive>) {
  const [trigger, setTrigger] = useState<HTMLElement | null>(null)
  const reduced = useSyncExternalStore(
    watchReducedMotion,
    () => reducesMotion(trigger),
    () => false,
  )
  return (
    <TriggerContext value={setTrigger}>
      <PopoverPrimitive
        delay={delay}
        presentation={popoverPresentation(presentation, reduced)}
        {...props}
      />
    </TriggerContext>
  )
}

function PopoverTrigger({
  ref,
  ...props
}: ComponentProps<typeof PopoverTriggerPrimitive>) {
  const setTrigger = use(TriggerContext)
  const own = useMemo(() => mergeRefs(ref, setTrigger), [ref, setTrigger])
  return <PopoverTriggerPrimitive ref={own} {...props} />
}

function PopoverClose(props: ComponentProps<typeof PopoverClosePrimitive>) {
  return <PopoverClosePrimitive {...props} />
}

/* A footer's tint and padding, set on each popup so one opened inside a sheet keeps its own. */
const popoverFooterClassName = cn(
  panelFooterTint,
  '[--popover-footer-safe:0px] [--popover-footer-y:--spacing(2)] [--popover-footer:transparent] data-[presentation=sheet]:[--popover-footer-safe:env(safe-area-inset-bottom)] data-[presentation=sheet]:[--popover-footer-y:var(--surface-padding)] data-[presentation=sheet]:[--popover-footer:var(--panel-footer)]',
)

/**
 * The box and what's in it. It grows out from under its trigger and folds
 * back into it; as a sheet, it is as wide as the screen up to 40rem.
 * `className` goes to the content inside the box, which is
 * `--popover-width` wide (18rem); every other prop goes to ui-sdk's
 * content. Content taller than the space left on screen scrolls.
 */
function PopoverContent({
  className,
  children,
  side = 'bottom',
  align = 'center',
  sideOffset = 6,
  inline,
  ref,
  ...props
}: Omit<ComponentProps<typeof PopoverContentPrimitive>, 'className' | 'children'> & {
  className?: string
  children?: ReactNode
}) {
  const [layer, setLayer] = useOwnPopupLayer(!inline)
  const own = useMemo(() => mergeRefs(ref, setLayer), [ref, setLayer])
  return (
    <PopoverContentPrimitive
      ref={own}
      side={side}
      align={align}
      sideOffset={sideOffset}
      collisionPadding={POPUP_COLLISION_PADDING}
      arrowPadding={0}
      inline={inline}
      className={cn(
        popupPlacedClassName,
        panelSheetBackdropClassName,
        'flex max-h-(--available-height) max-w-(--available-width) flex-col text-sm data-[presentation=sheet]:max-h-[calc(100dvh-(--spacing(12)))] data-[presentation=sheet]:w-full data-[presentation=sheet]:max-w-160 data-[presentation=sheet]:self-center',
        popoverFooterClassName,
      )}
      {...props}
    >
      {({ presentation }) => (
        <div
          className={cn(
            'flex min-h-0 flex-1 flex-col',
            presentation === 'sheet'
              ? cn(panelSheetClassName, 'pb-[env(safe-area-inset-bottom)]')
              : cn(
                  'relative rounded-(--surface-radius)',
                  popupSurfaceClassName,
                  popupGrowBoxClassName,
                ),
          )}
        >
          {presentation === 'sheet' ? <PanelHandle /> : null}
          <PopoverScroller sheet={presentation === 'sheet'} className={className}>
            <PopupLayerContext value={layer}>{children}</PopupLayerContext>
          </PopoverScroller>
        </div>
      )}
    </PopoverContentPrimitive>
  )
}

/**
 * What scrolls inside the box, so its fading edges leave the box's shadow,
 * ring and outline whole. While it scrolls it takes focus, so the keyboard
 * can scroll it, as a region named by the title. It mounts with the open
 * popup, so it measures what it holds then.
 */
function PopoverScroller({
  sheet,
  className,
  children,
}: {
  sheet: boolean
  className?: string
  children: ReactNode
}) {
  const scrollerRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const region = useScrollRegion(scrollerRef, contentRef)
  return (
    <div className={cn(panelBodyFrameClassName, 'rounded-[inherit]')}>
      <div
        ref={scrollerRef}
        {...region}
        className={cn(
          'scrollbar-thin flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain rounded-[inherit] focus-visible:outline-hidden',
          edgeFadeClassName,
        )}
      >
        <div
          ref={contentRef}
          className={cn(
            'flex max-w-full flex-col gap-(--surface-gap) p-(--popover-edge)',
            sheet
              ? 'w-full [--popover-edge:var(--surface-padding-lg)]'
              : cn(
                  'w-(--popover-width,--spacing(72)) [--popover-edge:var(--surface-padding)]',
                  popupGrowContentClassName,
                ),
            className,
          )}
        >
          {children}
        </div>
      </div>
    </div>
  )
}

function PopoverHeader({
  className,
  render,
  ...props
}: Omit<PartProps<'div'>, 'className'> & { className?: string }) {
  return renderElement(
    'div',
    {
      'data-slot': 'popover-header',
      className: cn('flex flex-col gap-1', className),
      ...props,
    },
    render,
  )
}

function PopoverTitle({
  className,
  ...props
}: Omit<ComponentProps<typeof PopoverTitlePrimitive>, 'className'> & {
  className?: string
}) {
  return (
    <PopoverTitlePrimitive
      className={cn('text-sm leading-snug font-medium', className)}
      {...props}
    />
  )
}

function PopoverDescription({
  className,
  ...props
}: Omit<ComponentProps<typeof PopoverDescriptionPrimitive>, 'className'> & {
  className?: string
}) {
  return (
    <PopoverDescriptionPrimitive
      className={cn('text-muted-foreground text-sm text-pretty', className)}
      {...props}
    />
  )
}

/**
 * What scrolls between a header and a footer, for a popover laid out as a
 * panel: give `PopoverContent` `min-h-0 gap-0 p-0`, and a height if it
 * should keep one. `className` goes to its content. While it scrolls it
 * takes focus, so the keyboard can scroll it, as a region named by the
 * title.
 */
function PopoverBody({ className, children, ref, ...props }: ComponentProps<'div'>) {
  const scrollerRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const region = useScrollRegion(scrollerRef, contentRef)
  const own = useMemo(() => mergeRefs(scrollerRef, ref), [ref])
  return (
    <div className={panelBodyFrameClassName}>
      <div
        ref={own}
        data-slot='popover-body'
        {...region}
        className={cn(
          'scrollbar-thin min-h-0 flex-1 overflow-y-auto overscroll-contain focus-visible:outline-hidden',
          edgeFadeClassName,
        )}
        {...props}
      >
        <div ref={contentRef} className={cn('flex flex-col', className)}>
          {children}
        </div>
      </div>
    </div>
  )
}

/**
 * Under a panel's body, such as a link to the settings. As a sheet, it takes
 * a panel footer's tint and padding, down past the screen's rounded corners.
 */
function PopoverFooter({
  className,
  render,
  ...props
}: Omit<PartProps<'div'>, 'className'> & { className?: string }) {
  return renderElement(
    'div',
    {
      'data-slot': 'popover-footer',
      className: cn(
        'relative flex shrink-0 items-center gap-2 border-t bg-(--popover-footer) px-(--popover-edge) py-(--popover-footer-y) after:absolute after:inset-x-0 after:top-full after:h-(--popover-footer-safe) after:bg-inherit',
        className,
      ),
      ...props,
    },
    render,
  )
}

type PopoverPresentation = NonNullable<
  ComponentProps<typeof PopoverPrimitive>['presentation']
>

/** How it opens: `auto` stays a popover while motion is reduced, since the sheet would slide in. */
function popoverPresentation(
  presentation: PopoverPresentation,
  reduced: boolean,
): PopoverPresentation {
  return presentation === 'auto' && reduced ? 'popover' : presentation
}

export {
  Popover,
  PopoverBody,
  PopoverClose,
  PopoverContent,
  PopoverDescription,
  PopoverFooter,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
  popoverPresentation,
}
export type { PopoverOpenChangeDetails }
