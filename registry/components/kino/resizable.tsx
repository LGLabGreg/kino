'use client'

/*
 * Panels a person resizes by dragging the handle between them, or by keyboard
 * on it: ui-sdk's Resizable holds the layout, the pointer and the keys
 * (arrows, Shift for a large step, Home and End, Enter and a double click to
 * collapse and restore, Escape to put a drag back). Kino draws them: a grip
 * on the hairline between them shows where to grab, as the Drawer's handle
 * does, darkening under the pointer and stretching along the line while it's
 * dragged. The `gutter` variant makes each panel a surface of its own on a
 * muted ground, with the gap between them as the handle and the grip showing
 * in it under the pointer.
 */

import { gripClassName } from '@/registry/lib/grip'
import { markMounted, mergeRefs } from '@/registry/lib/refs'
import { markResizing, transitionsSettled } from '@/registry/lib/resize'
import {
  edgeFadeClassName,
  followEdges,
  scrollRegionRingClassName,
  useScrollRegion,
} from '@/registry/lib/scroll'
import {
  Resizable as ResizablePrimitive,
  ResizableHandle as ResizableHandlePrimitive,
  ResizablePanel as ResizablePanelPrimitive,
} from '@ui-sdk/react/resizable'
import { cva, type VariantProps } from 'class-variance-authority'
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
 * A change that isn't the pointer's own movement (Enter, Home or End, a
 * double click, a step by arrow, `collapse()` from a controller, a panel
 * folding away as a drag passes half its smallest size) moves the panels on
 * the layout role, on the flex basis ui-sdk writes from
 * `--resizable-panel-size`. While a handle is dragged (`data-dragging`), and
 * while the group itself changes size (`data-resizing`), they follow with no
 * transition, unless a drag has just folded one (`data-folding`). Nothing
 * moves before `data-mounted`, so the first layout doesn't play on load.
 */
const panelMotionClassName =
  'motion-safe:data-mounted:*:data-[slot=resizable-panel]:transition-[flex-basis] motion-safe:data-mounted:*:data-[slot=resizable-panel]:duration-(--motion-layout-duration) motion-safe:data-mounted:*:data-[slot=resizable-panel]:ease-(--motion-layout-easing) motion-safe:data-mounted:not-data-folding:data-dragging:*:data-[slot=resizable-panel]:transition-none motion-safe:data-mounted:data-resizing:*:data-[slot=resizable-panel]:transition-none'

// It fills the box it is in, as its panels' percentages are of its own size.
const resizableVariants = cva(
  cn('size-full min-h-0 min-w-0 overflow-hidden', panelMotionClassName),
  {
    variants: {
      variant: {
        default: '',
        // Half the surface gap around the panels, as between them; beside an end
        // panel folded away, the gutter is the edge. A group in a panel sits on its panel's ground.
        gutter:
          'bg-muted/50 p-[calc(var(--surface-gap)/2)] in-data-[slot=resizable-panel]:bg-transparent in-data-[slot=resizable-panel]:p-0 data-[orientation=horizontal]:has-[>[data-slot=resizable-panel][inert]:first-child]:ps-0 data-[orientation=horizontal]:has-[>[data-slot=resizable-panel][inert]:not(:has(~[data-slot=resizable-panel]))]:pe-0 data-[orientation=vertical]:has-[>[data-slot=resizable-panel][inert]:first-child]:pt-0 data-[orientation=vertical]:has-[>[data-slot=resizable-panel][inert]:not(:has(~[data-slot=resizable-panel]))]:pb-0',
      },
    },
    defaultVariants: { variant: 'default' },
  },
)

type ResizableVariant = NonNullable<VariantProps<typeof resizableVariants>['variant']>

/** The variant of the group a panel or handle is in; a group inside a panel takes its panel's. */
const VariantContext = createContext<ResizableVariant>('default')

function Resizable({
  className,
  variant: ownVariant,
  ref,
  onLayoutChange,
  ...props
}: Omit<ComponentProps<typeof ResizablePrimitive>, 'className'> &
  VariantProps<typeof resizableVariants> & { className?: string }) {
  const variant = ownVariant ?? use(VariantContext)
  const groupRef = useRef<HTMLDivElement>(null)
  const refs = useMemo(
    () => mergeRefs<HTMLDivElement>(ref, groupRef, markMounted, markResizing),
    [ref],
  )
  return (
    <VariantContext value={variant}>
      <ResizablePrimitive
        ref={refs}
        data-variant={variant}
        onLayoutChange={(layout, details) => {
          onLayoutChange?.(layout, details)
          const group = groupRef.current
          if (!group || details.reason !== 'drag' || group.hasAttribute('data-folding'))
            return
          // A drag that passes half a panel's smallest size folds it or brings it back, and
          // the fold glides. ui-sdk writes the sizes and which panel is collapsed together
          // once this returns, so the glide is turned on first, and off again before the
          // frame draws unless a panel's collapsed state changed.
          const before = collapsedOf(group)
          group.dataset.folding = ''
          queueMicrotask(() => {
            if (collapsedOf(group) === before) {
              delete group.dataset.folding
              return
            }
            void transitionsSettled(group, {
              property: 'flex-basis',
              subtree: true,
            }).then(() => delete group.dataset.folding)
          })
        }}
        className={cn(resizableVariants({ variant }), className)}
        {...props}
      />
    </VariantContext>
  )
}

/** Which of a group's own panels are collapsed, as a key that changes when one folds. */
function collapsedOf(group: HTMLElement) {
  return [...group.children]
    .map((child) =>
      child.matches('[data-slot=resizable-panel][data-collapsed]') ? 1 : 0,
    )
    .join('')
}

/** The id of the first heading inside a panel that has one, to name it while it scrolls. */
function headingIdOf(scroller: HTMLElement) {
  return scroller.querySelector('h1[id], h2[id], h3[id], h4[id], h5[id], h6[id]')?.id
}

/** The handle beside a panel, for focus to go to when the panel stops scrolling. */
function handleBeside(scroller: HTMLElement) {
  const panel = scroller.closest('[data-slot=resizable-panel]')
  for (const beside of [panel?.nextElementSibling, panel?.previousElementSibling]) {
    if (beside instanceof HTMLElement && beside.role === 'separator') return beside
  }
  return null
}

const resizablePanelVariants = cva(cn(scrollRegionRingClassName, 'flex'), {
  variants: {
    variant: {
      default: '',
      // A panel that holds a group lends its surface to that group's panels; folded away to nothing, it draws nothing.
      gutter:
        'bg-card text-card-foreground rounded-(--surface-radius) border inert:border-0 has-[>*>[data-slot=resizable]]:rounded-none has-[>*>[data-slot=resizable]]:border-0 has-[>*>[data-slot=resizable]]:bg-transparent',
    },
  },
  defaultVariants: { variant: 'default' },
})

type ResizablePanelProps = Omit<
  ComponentProps<typeof ResizablePanelPrimitive>,
  'className' | 'children'
> & {
  children?: ReactNode
  /** For the content's layout: padding, gaps. */
  className?: string
  /** Names the panel while its content scrolls, when no heading with an id inside does. */
  'aria-label'?: string
}

/**
 * A panel whose content scrolls in a box of its own, which takes focus as a
 * region while there is more than fits, so the keyboard can scroll it. While
 * it is folded away to nothing ui-sdk makes it `inert`, so Tab skips what
 * can't be seen.
 */
function ResizablePanel({
  className,
  children,
  'aria-label': label,
  ...props
}: ResizablePanelProps) {
  const variant = use(VariantContext)
  const scrollerRef = useRef<HTMLDivElement>(null)
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
    <ResizablePanelPrimitive className={resizablePanelVariants({ variant })} {...props}>
      <div
        ref={scrollerRef}
        data-resizable-panel-content=''
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
    </ResizablePanelPrimitive>
  )
}

/*
 * ui-sdk grabs a handle within its own box, or 10px (24px by touch) around
 * a thinner one, so the handle is the quality bar's 24px target by mouse
 * and 40px by touch, drawn over the panels beside it with margins that give
 * that room back, and the line or gutter it shows is a layer in its middle.
 */
const resizableHandleVariants = cva(
  'group/handle group/grip relative z-10 flex items-center justify-center focus-visible:outline-hidden before:pointer-events-none before:absolute focus-visible:before:ring-3 focus-visible:before:ring-ring/50 aria-[orientation=horizontal]:h-6 aria-[orientation=horizontal]:-my-[calc((1.5rem-var(--resizable-line))/2)] aria-[orientation=horizontal]:before:inset-x-0 aria-[orientation=horizontal]:before:inset-y-[calc((1.5rem-var(--resizable-line))/2)] aria-[orientation=vertical]:w-6 aria-[orientation=vertical]:-mx-[calc((1.5rem-var(--resizable-line))/2)] aria-[orientation=vertical]:before:inset-y-0 aria-[orientation=vertical]:before:inset-x-[calc((1.5rem-var(--resizable-line))/2)] pointer-coarse:aria-[orientation=horizontal]:h-10 pointer-coarse:aria-[orientation=horizontal]:-my-[calc((2.5rem-var(--resizable-line))/2)] pointer-coarse:aria-[orientation=horizontal]:before:inset-y-[calc((2.5rem-var(--resizable-line))/2)] pointer-coarse:aria-[orientation=vertical]:w-10 pointer-coarse:aria-[orientation=vertical]:-mx-[calc((2.5rem-var(--resizable-line))/2)] pointer-coarse:aria-[orientation=vertical]:before:inset-x-[calc((2.5rem-var(--resizable-line))/2)]',
  {
    variants: {
      variant: {
        default:
          '[--resizable-line:1px] before:bg-border data-dragging:before:bg-muted-foreground/40 before:transition-colors before:duration-(--motion-press-duration) before:ease-(--motion-press-fade-easing) forced-colors:before:bg-[CanvasText]!',
        // The gutter is the surface gap halved, as the group's edge is.
        gutter: '[--resizable-line:calc(var(--surface-gap)/2)] before:rounded-full',
      },
    },
    defaultVariants: { variant: 'default' },
  },
)

const resizableGripVariants = cva(
  cn(
    gripClassName,
    'group-data-dragging/handle:bg-muted-foreground/70 group-data-hovering/handle:bg-muted-foreground/50 pointer-events-none group-aria-[orientation=horizontal]/handle:w-10 group-aria-[orientation=vertical]/handle:h-10 motion-safe:group-aria-[orientation=horizontal]/handle:group-data-dragging/handle:scale-x-125 motion-safe:group-aria-[orientation=vertical]/handle:group-data-dragging/handle:scale-y-125',
  ),
  {
    variants: {
      variant: {
        default:
          'group-data-disabled/handle:opacity-50 group-aria-[orientation=horizontal]/handle:h-1.25 group-aria-[orientation=vertical]/handle:w-1.25',
        // Shown only under the pointer or focus, so a disabled gutter shows none.
        gutter:
          'opacity-0 transition-[opacity,background-color,scale] duration-(--motion-press-duration) ease-[var(--motion-press-fade-easing),var(--motion-press-fade-easing),var(--motion-press-easing)] group-focus-visible/handle:opacity-100 group-data-dragging/handle:opacity-100 group-data-hovering/handle:opacity-100 group-aria-[orientation=horizontal]/handle:h-1 group-aria-[orientation=vertical]/handle:w-1 group-data-disabled/handle:opacity-0 motion-reduce:transition-[opacity,background-color] motion-reduce:ease-(--motion-press-fade-easing) forced-colors:opacity-100',
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
}: Omit<ComponentProps<typeof ResizableHandlePrimitive>, 'className' | 'children'> & {
  className?: string
}) {
  const variant = use(VariantContext)
  return (
    <ResizableHandlePrimitive
      data-variant={variant}
      className={cn(resizableHandleVariants({ variant }), className)}
      {...props}
    >
      <span aria-hidden className={resizableGripVariants({ variant })} />
    </ResizableHandlePrimitive>
  )
}

export {
  Resizable,
  ResizableHandle,
  ResizablePanel,
  resizableGripVariants,
  resizableHandleVariants,
  resizablePanelVariants,
  resizableVariants,
}
