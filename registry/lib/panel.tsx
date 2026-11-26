'use client'

import { IconPlaceholder } from '@/registry/icons/icon-placeholder'
import { gripClassName } from '@/registry/lib/grip'
import { followHeight } from '@/registry/lib/resize'
import {
  edgeFadeClassName,
  followEdges,
  scrollRegionRingClassName,
  useScrollRegion as useSharedScrollRegion,
} from '@/registry/lib/scroll'
import { type ReactNode, type RefObject, useEffect, useRef } from 'react'

import { cn } from '@/lib/utils'

/*
 * What Dialog, Alert dialog, Drawer and a Popover shown as a sheet
 * share: the dim, a box that follows its content's height, the close
 * button, the handle, and the header, title, description, body and footer. Each component names its own parts with
 * `data-slot`; the parts the panel itself looks for carry `data-panel`
 * (`body`, `footer`, `handle`), so the same selectors work in all four. A
 * component that brings its own footer into a panel, as a command menu in a
 * dialog does, marks the element around it `data-panel=parts`.
 */

/**
 * The dim behind a panel. It blurs what is behind it where the browser can.
 * iOS: an absolute backdrop as tall as the screen covers the whole visible
 * viewport, a fixed one doesn't.
 */
export const panelDimClassName =
  'fixed inset-0 isolate z-50 bg-black/15 supports-backdrop-filter:backdrop-blur-xs supports-[-webkit-touch-callout:none]:absolute supports-[-webkit-touch-callout:none]:min-h-dvh dark:bg-black/45'

/** The dim behind a dialog, which fades in and out with it. A drawer's follows the drawer instead. */
export const panelOverlayClassName = cn(
  panelDimClassName,
  'transition-opacity duration-(--motion-enter-duration) ease-(--motion-enter-easing) data-ending-style:opacity-0 data-ending-style:duration-(--motion-exit-duration) data-ending-style:ease-(--motion-exit-easing) data-starting-style:opacity-0',
)

/**
 * The same dim and blur behind a popup ui-sdk shows as a sheet, such as a
 * Popover on a phone: ui-sdk paints the `::backdrop` of the sheet's host, its
 * parent, with `--sheet-backdrop`, and fades it in and out.
 */
export const panelSheetBackdropClassName =
  '[--sheet-backdrop:--alpha(var(--color-black)/15%)] dark:[--sheet-backdrop:--alpha(var(--color-black)/45%)] supports-backdrop-filter:[*:has(>&[data-presentation=sheet])::backdrop]:backdrop-blur-xs'

/**
 * The dim over a dialog's surface while another dialog opens on top of it
 * (ui-sdk marks the content around the surface `data-nested-open`). Only the
 * content's own surface dims: the dialog on top sits inside it. A drawer's
 * dim follows the drawer on top instead (`drawer.tsx`).
 */
export const panelStackDimClassName =
  'before:pointer-events-none before:absolute before:inset-0 before:z-20 before:rounded-[inherit] before:bg-black/0 before:transition-colors before:duration-(--motion-enter-duration) before:ease-(--motion-enter-fade-easing) [[data-nested-open]>&]:before:bg-black/10 dark:[[data-nested-open]>&]:before:bg-black/40'

/**
 * A dialog's box on the screen's top layer: it rises `--dialog-rise` into
 * the centre, and steps back while another dialog is open on top of it. On a
 * screen under `sm` it is a sheet that slides up from the bottom edge. A
 * strip under it, in the colour the sheet ends in, covers the gap, the ring
 * and the shadow when a spring overshoots. Laid out `inline`, it sits above
 * its own dim, which ui-sdk then renders after it: one step over the dim's
 * `z-50`. Holds a `PanelSurface`.
 */
export const panelDialogClassName =
  'group/panel fixed inset-0 z-51 m-auto flex h-fit w-[calc(100%-(--spacing(8)))] max-w-md min-w-0 flex-col transition-[translate,scale,opacity] duration-(--motion-enter-duration) ease-(--motion-enter-easing) focus-visible:outline-hidden data-ending-style:translate-y-[calc(var(--dialog-rise,1rem)/2)] data-ending-style:scale-98 data-ending-style:opacity-0 data-ending-style:duration-(--motion-exit-duration) data-ending-style:ease-(--motion-exit-easing) data-nested-open:scale-(--dialog-recede-scale,0.95) data-starting-style:translate-y-[var(--dialog-rise,1rem)] data-starting-style:scale-97 data-starting-style:opacity-0 motion-reduce:transition-[opacity] motion-reduce:data-ending-style:translate-y-0! motion-reduce:data-ending-style:scale-100! motion-reduce:data-ending-style:opacity-0! motion-reduce:data-starting-style:translate-y-0! motion-reduce:data-starting-style:scale-100! motion-reduce:data-starting-style:opacity-0! max-sm:mb-0 max-sm:w-full max-sm:max-w-none max-sm:origin-bottom max-sm:after:absolute max-sm:after:inset-x-0 max-sm:after:top-full max-sm:after:h-24 max-sm:after:bg-background max-sm:has-data-[panel=footer]:after:bg-(--panel-footer) max-sm:data-ending-style:translate-y-full max-sm:data-ending-style:scale-100 max-sm:data-ending-style:opacity-100 max-sm:data-starting-style:translate-y-full max-sm:data-starting-style:scale-100 max-sm:data-starting-style:opacity-100'

/**
 * A panel's box on the bottom edge, as wide as the screen up to 40rem, its
 * top corners rounded. A strip under it, in its colour, covers the gap when
 * a spring overshoots. Starts with a `PanelHandle`.
 */
export const panelSheetClassName =
  'bg-background text-foreground relative flex w-full flex-col rounded-t-(--surface-radius-lg) border-t text-sm shadow-xl after:absolute after:inset-x-0 after:top-full after:h-12 after:bg-inherit forced-colors:outline'

/**
 * A popup of ui-sdk's shown as a sheet, such as a Popover's or a Select's on
 * a phone: on its content, as wide as the screen up to 40rem and clear of the
 * screen's top. Beside `panelSheetBackdropClassName`.
 */
export const popupSheetClassName =
  'data-[presentation=sheet]:max-h-[calc(100dvh-(--spacing(12)))] data-[presentation=sheet]:w-full data-[presentation=sheet]:max-w-160 data-[presentation=sheet]:self-center'

/** The panel of such a sheet, clear of the safe area at its foot. Starts with a `PanelHandle`. */
export const popupSheetPanelClassName = cn(
  panelSheetClassName,
  'pb-[env(safe-area-inset-bottom)]',
)

/** The bar at the top of a sheet that says it can be dragged. */
export function PanelHandle({ className }: { className?: string }) {
  return (
    <div
      data-panel='handle'
      aria-hidden
      className={cn('flex h-5 shrink-0 items-end justify-center', className)}
    >
      <span className={cn(gripClassName, 'h-1 w-10')} />
    </div>
  )
}

/** The close button's place: 10px nearer the corner than the content, lower under a drawer's handle. */
export const panelCloseClassName =
  'text-muted-foreground absolute end-[calc(var(--surface-padding-lg)_-_10px)] top-[calc(var(--surface-padding-lg)_-_10px)] group-has-data-[panel=handle]/panel-surface:top-[calc(var(--surface-padding-lg)_-_10px_+_--spacing(3))]'

export function PanelCloseIcon() {
  return (
    <IconPlaceholder
      lucide='XIcon'
      tabler='IconX'
      hugeicons='Cancel01Icon'
      phosphor='XIcon'
      remixicon='RiCloseLine'
      aria-hidden
    />
  )
}

/**
 * A dialog's surface. When its content changes height while it is open, the
 * box resizes and the footer stays on its bottom edge. `closeButton` goes
 * inside what scrolls, so it leaves with the header when the whole dialog
 * scrolls.
 */
export function PanelSurface({
  closeButton,
  children,
}: {
  closeButton?: ReactNode
  children: ReactNode
}) {
  const surfaceRef = useRef<HTMLDivElement>(null)
  const innerRef = useRef<HTMLDivElement>(null)
  const scrollRegion = useScrollRegion(innerRef)
  useFollowHeight(surfaceRef, innerRef)

  return (
    <div
      ref={surfaceRef}
      data-slot='panel-surface'
      data-close-button={closeButton ? '' : undefined}
      className={cn(
        'group/panel-surface bg-background text-foreground ring-foreground/10 @container relative overflow-clip rounded-(--surface-radius) text-sm shadow-xl ring-1 transition-[height] duration-(--motion-layout-duration) ease-(--motion-layout-easing) motion-reduce:transition-none forced-colors:outline max-sm:rounded-b-none',
        panelStackDimClassName,
        panelCloseRoomClassName,
      )}
    >
      {/*
       * As tall as the screen less a margin: past that, the body scrolls
       * between the header and the footer. On a screen under 28rem tall that
       * would leave the body a slit, so the whole dialog scrolls instead, as
       * it does when there is no body. The screen is the window, or for a
       * dialog laid out `inline`, the size container it sits in, such as a
       * preview's frame. A form around the parts takes no box, so they still
       * lay out here.
       */}
      <div
        ref={innerRef}
        {...scrollRegion}
        className='focus-visible:ring-ring/50 relative flex max-h-[calc(100cqh-(--spacing(8)))] scrollbar-thin flex-col overscroll-contain rounded-[inherit] focus-visible:ring-3 focus-visible:outline-hidden focus-visible:-outline-offset-2 focus-visible:ring-inset max-sm:max-h-[calc(100cqh-(--spacing(12)))] max-sm:pb-[env(safe-area-inset-bottom)] not-has-data-[panel=body]:overflow-y-auto *:[form]:contents [@media(height<28rem)]:overflow-y-auto [@container_(height<28rem)]:overflow-y-auto'
      >
        {children}
        {closeButton}
      </div>
    </div>
  )
}

/**
 * The header ends 6px short of the close button, by the room its surface
 * keeps for one (`panelCloseRoomClassName`), and sits closer under a
 * drawer's handle. Above a body it gives back the ring's room the body keeps.
 */
/**
 * The room a surface's header leaves for its close button. Every surface sets
 * it, so a dialog opened inside another takes its own, never its parent's.
 */
export const panelCloseRoomClassName =
  '[--panel-close-room:0px] data-close-button:[--panel-close-room:calc(var(--control-height-sm)-4px)]'

export const panelHeaderClassName =
  'flex shrink-0 flex-col gap-1.5 p-(--surface-padding-lg) pe-[calc(var(--surface-padding-lg)+var(--panel-close-room,0px))] [[data-panel=handle]+&]:pt-2 [&:has(+[data-panel=body])]:pb-[calc(var(--surface-padding-lg)_-_--spacing(0.75))]'

/** A long unbroken word breaks rather than run out of the panel. */
export const panelTitleClassName =
  'text-base leading-snug font-medium text-balance wrap-anywhere'

export const panelDescriptionClassName =
  'text-muted-foreground *:[a]:hover:text-foreground text-sm text-pretty *:[a]:underline *:[a]:underline-offset-3'

/**
 * The box around what scrolls between the header and the footer. It draws
 * the scroller's ring, inside, while the scroller takes focus, because the
 * scroller's fading edges would fade a ring of its own.
 */
export const panelBodyFrameClassName = cn(
  'flex min-h-0 flex-1 flex-col',
  scrollRegionRingClassName,
)

/**
 * What scrolls between the header and the footer, its edges fading while
 * there is more past them (`useScrollRegion`).
 * A scroller clips what pokes past its edge, so it keeps a ring's width (3px)
 * above its content, and the header above it gives that much back: a focused
 * control on the first row keeps its whole ring, and nothing moves.
 */
export const panelBodyClassName = cn(
  'scrollbar-thin pt-0.75 min-h-0 flex-1 overflow-y-auto overscroll-contain focus-visible:outline-hidden',
  edgeFadeClassName,
)

export const panelBodyContentClassName =
  'flex flex-col gap-(--surface-gap) px-(--surface-padding-lg) pb-(--surface-padding-lg)'

/**
 * A solid tint, `--panel-footer`: while the box resizes, the footer passes
 * over the content. On the bottom edge it runs on under the home indicator.
 */
export const panelFooterClassName =
  'relative flex shrink-0 flex-col-reverse gap-2 border-t bg-(--panel-footer) px-(--surface-padding-lg) py-(--surface-padding) transition-[translate] duration-(--motion-layout-duration) ease-(--motion-layout-easing) after:absolute after:inset-x-0 after:top-full after:h-[env(safe-area-inset-bottom)] after:bg-inherit motion-reduce:transition-none @xs:flex-row @xs:flex-wrap-reverse @xs:justify-end'

/** The footer's tint, set on the panel. */
export const panelFooterTint =
  '[--panel-footer:color-mix(in_oklab,var(--muted)_50%,var(--background))]'

const panelOf = (scroller: HTMLElement) =>
  scroller.closest<HTMLElement>('[role=dialog], [role=alertdialog]')

const panelTitleOf = (scroller: HTMLElement) =>
  panelOf(scroller)?.getAttribute('aria-labelledby')

/**
 * The props of a panel's body while its content is taller than it: it takes
 * focus as a region named by the panel's title, and hands focus to the panel
 * when it stops scrolling. Its edges fade while there is more past them.
 */
export function useScrollRegion(
  scrollerRef: RefObject<HTMLElement | null>,
  contentRef?: RefObject<HTMLElement | null>,
) {
  useEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller) return
    return followEdges(scroller, '--scroll-fade', contentRef?.current ?? undefined)
  }, [scrollerRef, contentRef])
  return useSharedScrollRegion(scrollerRef, {
    contentRef,
    labelledBy: panelTitleOf,
    refocus: panelOf,
  })
}

/** While `follows`, the surface moves to the inner box's height whenever that changes. */
export function useFollowHeight(
  surfaceRef: RefObject<HTMLElement | null>,
  innerRef: RefObject<HTMLElement | null>,
  follows = true,
) {
  useEffect(() => {
    const surface = surfaceRef.current
    const inner = innerRef.current
    if (!follows || !surface || !inner) return
    // The footer is already laid out at the new bottom edge, so it starts at
    // the old one and moves with the edge; where the whole panel scrolls, the
    // footer is inside what scrolls and stays.
    return followHeight(surface, inner, {
      moving: (from, to) => {
        inner.style.overflow = ''
        const footer =
          inner.scrollHeight > inner.clientHeight
            ? null
            : inner.querySelector<HTMLElement>(
                ':scope > [data-panel=footer], :scope > :is(form, [data-panel=parts]) > [data-panel=footer]',
              )
        if (!footer) return undefined
        return (start) => {
          // The old bottom edge can be outside what scrolls on a short screen.
          if (start) inner.style.overflow = 'visible'
          footer.style.transition = start ? 'none' : ''
          footer.style.translate = start ? `0 ${from - to}px` : ''
        }
      },
      settled: () => {
        inner.style.overflow = ''
      },
    })
  }, [surfaceRef, innerRef, follows])
}
