'use client'

import { IconPlaceholder } from '@/registry/icons/icon-placeholder'
import { followHeight } from '@/registry/lib/resize'
import {
  edgeFadeClassName,
  followEdges,
  scrollRegionRingClassName,
  useScrollRegion as useSharedScrollRegion,
} from '@/registry/lib/scroll'
import { type RefObject, useEffect } from 'react'

import { cn } from '@/lib/utils'

/*
 * What Dialog, Alert dialog, Sheet and Drawer share: the overlay, a box that
 * follows its content's height, the close button, and the header, title,
 * description, body and footer. Each component names its own parts with
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
export const panelOverlayClassName =
  'fixed inset-0 isolate z-50 bg-black/15 transition-opacity duration-(--motion-enter-duration) ease-(--motion-enter-easing) data-ending-style:opacity-0 data-ending-style:duration-(--motion-exit-duration) data-ending-style:ease-(--motion-exit-easing) data-starting-style:opacity-0 supports-backdrop-filter:backdrop-blur-xs supports-[-webkit-touch-callout:none]:absolute supports-[-webkit-touch-callout:none]:min-h-dvh dark:bg-black/45'

/**
 * The dim over a panel while another opens on top of it: a dialog under
 * another dialog (its viewport is `group/dialog-viewport`), or a sheet or
 * drawer under another one.
 */
export const panelStackDimClassName =
  'before:pointer-events-none before:absolute before:inset-0 before:z-20 before:rounded-[inherit] before:bg-black/0 before:transition-colors before:duration-(--motion-enter-duration) before:ease-(--motion-enter-fade-easing) group-data-nested-dialog-open/dialog-viewport:before:bg-black/10 data-nested-drawer-open:before:bg-black/10 dark:group-data-nested-dialog-open/dialog-viewport:before:bg-black/40 dark:data-nested-drawer-open:before:bg-black/40'

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
 * The header ends 6px short of the close button, and sits closer under a
 * drawer's handle. Above a body it gives back the ring's room the body keeps.
 */
export const panelHeaderClassName =
  'flex shrink-0 flex-col gap-1.5 p-(--surface-padding-lg) group-data-close-button/panel-surface:pe-[calc(var(--surface-padding-lg)_+_var(--control-height-sm)_-_4px)] [[data-panel=handle]+&]:pt-2 [&:has(+[data-panel=body])]:pb-[calc(var(--surface-padding-lg)_-_--spacing(0.75))]'

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
