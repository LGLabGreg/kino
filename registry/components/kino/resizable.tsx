'use client'

/*
 * Panels a person resizes by dragging the handle between them, or by keyboard
 * on it: arrows step it, Home and End take it to its ends, and Enter
 * collapses or restores a collapsible panel. A grip on the hairline between
 * them shows where to grab, as the Drawer's handle does: it darkens under the
 * pointer and stretches along the line while it's dragged. The `gutter`
 * variant makes each panel a surface of its own on a muted ground, with the
 * gap between them as the handle and the grip showing in it under the pointer.
 */

import { gripClassName } from '@/registry/lib/grip'
import { markMounted, mergeRefs } from '@/registry/lib/refs'
import { runningTransitions, transitionsSettled } from '@/registry/lib/resize'
import {
  edgeFadeClassName,
  followEdges,
  scrollRegionRingClassName,
  useScrollRegion,
} from '@/registry/lib/scroll'
import { cva, type VariantProps } from 'class-variance-authority'
import { createContext, use, useEffect, useRef, useState } from 'react'
import * as ResizablePrimitive from 'react-resizable-panels'

import { cn } from '@/lib/utils'

/**
 * How far around a handle the pointer can grab it, in px: 24 by mouse, the
 * quality bar's smallest target, and 40 by touch.
 */
const HIT_TARGET = { fine: 24, coarse: 40 }

/*
 * A change that isn't the pointer's own movement (Enter, Home or End, a
 * double click back to the default, a step by arrow, `collapse()` from a
 * button, a panel folding away as a drag passes its smallest size) moves the
 * panels on the layout role. While a handle is dragged, and while the group
 * itself changes size, they follow with no transition (`data-following`),
 * unless a drag has just folded one (`data-folding`). Nothing moves before
 * `data-mounted`, so the first layout doesn't play on load.
 */
const panelMotionClassName =
  'motion-safe:data-mounted:*:data-panel:transition-[flex-grow] motion-safe:data-mounted:*:data-panel:duration-(--motion-layout-duration) motion-safe:data-mounted:*:data-panel:ease-(--motion-layout-easing) motion-safe:data-mounted:not-data-folding:data-following:*:data-panel:duration-0'

/** A group's panels by id, as percentages of their sizes on screen, which sum to 100. */
function layoutOf(sizes: { id: string; size: number }[]): Record<string, number> {
  const total = sizes.reduce((sum, { size }) => sum + size, 0)
  if (total <= 0) return {}
  return Object.fromEntries(sizes.map(({ id, size }) => [id, (size / total) * 100]))
}

/**
 * Whether a layout jumped from `previous` to `next` further than a pointer
 * moves between two events, in percent: a panel folding away or back as a
 * drag passes its smallest size.
 */
function folds(
  previous: Record<string, number>,
  next: Record<string, number>,
  threshold = 5,
) {
  return Object.keys(next).some(
    (id) => id in previous && Math.abs(next[id] - previous[id]) > threshold,
  )
}

/** Whether two layouts put every panel within half a percent of the same size. */
function sameLayout(a: Record<string, number>, b: Record<string, number>) {
  const ids = Object.keys(b)
  return (
    Object.keys(a).length === ids.length &&
    ids.every((id) => id in a && Math.abs(a[id] - b[id]) <= 0.5)
  )
}

/** The group's own panels and their sizes on screen along its axis. */
function panelSizes(group: HTMLElement, vertical: boolean) {
  return [...group.children]
    .filter(
      (child): child is HTMLElement =>
        child instanceof HTMLElement && child.hasAttribute('data-panel'),
    )
    .map((panel) => {
      const box = panel.getBoundingClientRect()
      return { id: panel.id, size: vertical ? box.height : box.width }
    })
}

/**
 * Keeps the group's motion honest. A press that starts a drag while the
 * panels still move takes them where they are on screen first, so the handle
 * stays under the pointer: the library starts a drag from where they're
 * going. And it marks the group `data-following` while a handle is dragged
 * or the group changes size, so the panels keep to it rather than catch up
 * on the layout role.
 */
function followGroup(
  group: HTMLElement,
  handle: ResizablePrimitive.GroupImperativeHandle,
) {
  // On the window, so it runs before the library's own listener on the document.
  const press = (event: PointerEvent) => {
    if (!(event.target instanceof Node) || !group.contains(event.target)) return
    const moving = runningTransitions(group, {
      property: 'flex-grow',
      subtree: true,
    }).some(
      (transition) =>
        transition.effect instanceof KeyframeEffect &&
        transition.effect.target?.parentElement === group,
    )
    if (!moving) return
    const here = layoutOf(panelSizes(group, group.style.flexDirection === 'column'))
    handle.setLayout(here)
    // Where they are is between a folded panel and its smallest size, which no
    // layout can hold: the press waits for them to arrive rather than start a
    // drag with the handle away from the pointer.
    if (!sameLayout(handle.getLayout(), here)) {
      event.preventDefault()
      event.stopPropagation()
    }
  }
  window.addEventListener('pointerdown', press, true)

  let dragging = false
  let resizing = false
  const follow = () => {
    if (dragging || resizing) group.dataset.following = ''
    else delete group.dataset.following
  }
  const drags = new MutationObserver(() => {
    dragging = group.querySelector(':scope > [data-separator=active]') !== null
    follow()
  })
  drags.observe(group, { subtree: true, attributeFilter: ['data-separator'] })

  let frame = 0
  let first = true
  const sizes = new ResizeObserver(() => {
    if (first) {
      first = false
      return
    }
    resizing = true
    follow()
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        resizing = false
        follow()
      })
    })
  })
  sizes.observe(group)
  return () => {
    window.removeEventListener('pointerdown', press, true)
    drags.disconnect()
    sizes.disconnect()
    cancelAnimationFrame(frame)
  }
}

const lastLayouts = new WeakMap<HTMLElement, Record<string, number>>()

/** Notes a layout, and lets a fold that a drag sets off move on the layout role, until it settles. */
function noteLayout(group: HTMLElement, layout: Record<string, number>) {
  const previous = lastLayouts.get(group)
  lastLayouts.set(group, layout)
  if (!previous || !group.querySelector(':scope > [data-separator=active]')) return
  if (!folds(previous, layout)) return
  group.dataset.folding = ''
  void transitionsSettled(group, { property: 'flex-grow', subtree: true }).then(() => {
    delete group.dataset.folding
  })
}

const resizablePanelGroupVariants = cva(panelMotionClassName, {
  variants: {
    variant: {
      default: '',
      // Half the surface gap around the panels, as between them; beside an end
      // panel folded away, the gutter is the edge. A group in a panel sits on its panel's ground.
      gutter:
        'bg-muted/50 p-[calc(var(--surface-gap)/2)] in-data-[slot=resizable-panel]:bg-transparent in-data-[slot=resizable-panel]:p-0 data-[orientation=horizontal]:has-[>[data-panel][data-collapsed]:first-child]:ps-0 data-[orientation=horizontal]:has-[>[data-panel][data-collapsed]:not(:has(~[data-panel]))]:pe-0 data-[orientation=vertical]:has-[>[data-panel][data-collapsed]:first-child]:pt-0 data-[orientation=vertical]:has-[>[data-panel][data-collapsed]:not(:has(~[data-panel]))]:pb-0',
    },
  },
  defaultVariants: { variant: 'default' },
})

type ResizableVariant = NonNullable<
  VariantProps<typeof resizablePanelGroupVariants>['variant']
>

/** The variant of the group a panel or handle is in; a group inside a panel takes its panel's. */
const VariantContext = createContext<ResizableVariant>('default')

function ResizablePanelGroup({
  className,
  variant: ownVariant,
  elementRef,
  groupRef,
  onLayoutChange,
  resizeTargetMinimumSize = HIT_TARGET,
  ...props
}: Omit<ResizablePrimitive.GroupProps, 'className'> &
  VariantProps<typeof resizablePanelGroupVariants> & { className?: string }) {
  const variant = ownVariant ?? use(VariantContext)
  const [group, setGroup] = useState<HTMLDivElement | null>(null)
  const [handle, setHandle] = useState<ResizablePrimitive.GroupImperativeHandle | null>(
    null,
  )
  useEffect(() => {
    if (!group || !handle) return
    return followGroup(group, handle)
  }, [group, handle])
  return (
    <VariantContext value={variant}>
      <ResizablePrimitive.Group
        data-slot='resizable-panel-group'
        data-variant={variant}
        data-orientation={props.orientation ?? 'horizontal'}
        elementRef={mergeRefs<HTMLDivElement>(elementRef, setGroup, markMounted)}
        groupRef={mergeRefs<ResizablePrimitive.GroupImperativeHandle>(
          groupRef,
          setHandle,
        )}
        resizeTargetMinimumSize={resizeTargetMinimumSize}
        onLayoutChange={(layout) => {
          if (group) noteLayout(group, layout)
          onLayoutChange?.(layout)
        }}
        className={cn(resizablePanelGroupVariants({ variant }), className)}
        {...props}
      />
    </VariantContext>
  )
}

/** The id of the first heading inside a panel that has one, to name it while it scrolls. */
function headingIdOf(scroller: HTMLElement) {
  return scroller.querySelector('h1[id], h2[id], h3[id], h4[id], h5[id], h6[id]')?.id
}

/** The handle beside a panel, for focus to go to when the panel stops scrolling. */
function handleBeside(scroller: HTMLElement) {
  const panel = scroller.closest('[data-panel]')
  for (const beside of [panel?.nextElementSibling, panel?.previousElementSibling]) {
    if (beside instanceof HTMLElement && beside.role === 'separator') return beside
  }
  return null
}

type ResizablePanelProps = Omit<ResizablePrimitive.PanelProps, 'className'> & {
  /** For the content's layout: padding, gaps. */
  className?: string
  /** Names the panel while its content scrolls, when no heading with an id inside does. */
  'aria-label'?: string
}

/**
 * A panel whose content scrolls in a box of its own, which takes focus as a
 * region while there is more than fits, so the keyboard can scroll it. While
 * it is folded away to nothing it is `inert`, so Tab skips what can't be seen.
 */
function ResizablePanel({
  className,
  children,
  onResize,
  'aria-label': label,
  ...props
}: ResizablePanelProps) {
  const variant = use(VariantContext)
  const scrollerRef = useRef<HTMLDivElement>(null)
  const [hidden, setHidden] = useState(false)
  const region = useScrollRegion(scrollerRef, {
    axis: 'both',
    labelledBy: headingIdOf,
    refocus: handleBeside,
  })
  useEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller) return
    return followEdges(scroller, '--scroll-fade')
  }, [])
  return (
    <ResizablePrimitive.Panel
      data-slot='resizable-panel'
      data-collapsed={hidden || undefined}
      inert={hidden}
      onResize={(size, id, previous) => {
        setHidden(size.inPixels < 1)
        onResize?.(size, id, previous)
      }}
      className={resizablePanelVariants({ variant })}
      {...props}
    >
      <div
        ref={scrollerRef}
        data-slot='resizable-panel-content'
        {...region}
        aria-label={region ? label : undefined}
        className={cn(
          'scrollbar-thin min-h-0 min-w-0 flex-1 overflow-auto focus-visible:outline-hidden',
          edgeFadeClassName,
          className,
        )}
      >
        {children}
      </div>
    </ResizablePrimitive.Panel>
  )
}

const resizablePanelVariants = cva(cn(scrollRegionRingClassName, 'flex'), {
  variants: {
    variant: {
      default: '',
      // A panel that holds a group lends its surface to that group's panels; folded away, it draws nothing.
      gutter:
        'bg-card text-card-foreground rounded-(--surface-radius) border in-data-collapsed:border-0 has-[>*>[data-group]]:rounded-none has-[>*>[data-group]]:border-0 has-[>*>[data-group]]:bg-transparent',
    },
  },
  defaultVariants: { variant: 'default' },
})

const resizableHandleVariants = cva(
  'group/handle group/grip focus-visible:ring-ring/50 relative flex shrink-0 items-center justify-center focus-visible:ring-3 focus-visible:outline-hidden',
  {
    variants: {
      variant: {
        default:
          'bg-border data-[separator=active]:bg-muted-foreground/40 transition-colors duration-(--motion-press-duration) ease-(--motion-press-fade-easing) aria-[orientation=horizontal]:h-px aria-[orientation=vertical]:w-px forced-colors:bg-[CanvasText]!',
        // The gutter is the surface gap halved, as the group's edge is.
        gutter:
          'rounded-full aria-[orientation=horizontal]:h-[calc(var(--surface-gap)/2)] aria-[orientation=vertical]:w-[calc(var(--surface-gap)/2)]',
      },
    },
    defaultVariants: { variant: 'default' },
  },
)

const resizableGripVariants = cva(
  cn(
    gripClassName,
    'group-data-[separator=active]/handle:bg-muted-foreground/70 group-data-[separator=hover]/handle:bg-muted-foreground/50 pointer-events-none group-aria-[orientation=horizontal]/handle:w-10 group-aria-[orientation=vertical]/handle:h-10 motion-safe:group-aria-[orientation=horizontal]/handle:group-data-[separator=active]/handle:scale-x-125 motion-safe:group-aria-[orientation=vertical]/handle:group-data-[separator=active]/handle:scale-y-125',
  ),
  {
    variants: {
      variant: {
        default:
          'group-data-[separator=disabled]/handle:opacity-50 group-aria-[orientation=horizontal]/handle:h-1.25 group-aria-[orientation=vertical]/handle:w-1.25',
        // Shown only under the pointer or focus, so a disabled gutter shows none.
        gutter:
          'opacity-0 transition-[opacity,background-color,scale] duration-(--motion-press-duration) ease-[var(--motion-press-fade-easing),var(--motion-press-fade-easing),var(--motion-press-easing)] group-focus-visible/handle:opacity-100 group-hover/handle:opacity-100 group-aria-[orientation=horizontal]/handle:h-1 group-aria-[orientation=vertical]/handle:w-1 group-data-[separator=active]/handle:opacity-100 group-data-[separator=hover]/handle:opacity-100 group-data-[separator=disabled]/handle:opacity-0 motion-reduce:transition-[opacity,background-color] motion-reduce:ease-(--motion-press-fade-easing) forced-colors:opacity-100',
      },
    },
    defaultVariants: { variant: 'default' },
  },
)

/*
 * The grip is 5px across a 1px line, so it centres on whole pixels; in a
 * gutter, whose width is even, it is 4px.
 */
function ResizableHandle({
  className,
  ...props
}: Omit<ResizablePrimitive.SeparatorProps, 'className'> & { className?: string }) {
  const variant = use(VariantContext)
  return (
    <ResizablePrimitive.Separator
      data-slot='resizable-handle'
      data-variant={variant}
      className={cn(resizableHandleVariants({ variant }), className)}
      {...props}
    >
      <span aria-hidden className={resizableGripVariants({ variant })} />
    </ResizablePrimitive.Separator>
  )
}

export {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  folds,
  layoutOf,
  resizableGripVariants,
  resizableHandleVariants,
  resizablePanelGroupVariants,
  resizablePanelVariants,
  sameLayout,
}
