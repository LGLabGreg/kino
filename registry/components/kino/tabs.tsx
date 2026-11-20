'use client'

import {
  followPointer,
  highlightClassName,
  itemMatching,
  rowTintClassName,
} from '@/registry/lib/highlight'
import {
  pillBackdropClassName,
  pillClassName,
  pillItemClassName,
  pillItemLayout,
  pillRowClassName,
  pillTrackClassName,
} from '@/registry/lib/pill'
import { inertCopy, markResizing, transitionsQuiet } from '@/registry/lib/resize'
import { revealInRow } from '@/registry/lib/scroll'
import { Tabs as TabsPrimitive } from '@base-ui/react/tabs'
import { cva, type VariantProps } from 'class-variance-authority'
import { type ComponentProps, createContext, use, useEffect, useRef } from 'react'

import { cn } from '@/lib/utils'

function Tabs({
  className,
  ...props
}: Omit<TabsPrimitive.Root.Props, 'className'> & { className?: string }) {
  return (
    <TabsPrimitive.Root
      data-slot='tabs'
      className={cn(
        'group/tabs flex min-w-0 gap-3 data-[orientation=horizontal]:flex-col',
        className,
      )}
      {...props}
    />
  )
}

const tabsListVariants = cva('group/tabs-track max-w-full min-w-0 shrink-0', {
  variants: {
    variant: {
      default: cn(pillTrackClassName, 'self-start'),
      line: 'self-stretch',
      rows: '',
    },
  },
  defaultVariants: {
    variant: 'default',
  },
})

/** Scrolls a horizontal list that outgrows its column, and keeps the picked or focused tab in view. */
function TabsScroller({ className, ...props }: ComponentProps<'div'>) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const scroller = ref.current
    if (!scroller) return

    return revealInRow(scroller, {
      item: '[role="tab"]',
      picked: 'data-active',
      fade: '--tabs-fade',
    })
  }, [])

  return (
    <div
      ref={ref}
      data-slot='tabs-scroller'
      className={cn(
        'min-w-0 scrollbar-none group-data-[orientation=horizontal]/tabs:overflow-x-auto group-data-[orientation=horizontal]/tabs:[mask-image:linear-gradient(to_right,transparent,black_var(--tabs-fade-left,0px),black_calc(100%-var(--tabs-fade-right,0px)),transparent)]',
        className,
      )}
      {...props}
    />
  )
}

// The list and the pill's copy of it share this, so every label sits exactly on its twin.
const tabsListLayout = cn(
  'flex w-max min-w-full',
  pillRowClassName,
  'group-data-[variant=line]/tabs-track:p-0 group-data-[orientation=vertical]/tabs:w-full group-data-[orientation=vertical]/tabs:flex-col group-data-[variant=line]/tabs-track:gap-1 group-data-[variant=line]/tabs-track:pb-1.5 group-data-[orientation=vertical]/tabs:group-data-[variant=line]/tabs-track:pe-1.5 group-data-[orientation=vertical]/tabs:group-data-[variant=line]/tabs-track:pb-0',
)

// The highlight is as large as the list and only its window moves, so nothing changes size.
// Forced colours drop backgrounds, so there the highlight takes the system's own.
const tabsIndicatorBase =
  'pointer-events-none absolute z-10 transition-[clip-path] duration-(--motion-morph-duration) ease-(--motion-morph-easing) group-data-resizing/tabs-list:transition-none motion-reduce:transition-none forced-colors:bg-[Highlight] forced-colors:forced-color-adjust-none'

/** True inside the pill's copy of the list, where a trigger is only its label. */
const TabsCopyContext = createContext(false)

/** True inside a list of rows, where each trigger draws its own content. */
const TabsRowsContext = createContext(false)

function TabsList({
  className,
  variant = 'default',
  children,
  ...props
}: Omit<TabsPrimitive.List.Props & VariantProps<typeof tabsListVariants>, 'className'> & {
  className?: string
}) {
  const backdropRef = useRef<HTMLSpanElement>(null)

  // Behind the tab under the pointer, or the one with visible focus.
  useEffect(() => {
    const backdrop = backdropRef.current
    const list = backdrop?.parentElement
    if (!backdrop || !list) return
    const stopFollowing = followPointer(list, backdrop, {
      itemOf: itemMatching(list, '[role="tab"]'),
      focus: true,
    })
    // A list that stretches moves its tabs when it resizes: the indicator goes with them at once.
    // Rows grow as they're picked, so their list aims its tint itself.
    const stopMarking = variant === 'rows' ? aimAtPickedRow(list) : markResizing(list)
    return () => {
      stopFollowing()
      stopMarking?.()
    }
  }, [variant])

  if (variant === 'rows') {
    return (
      <TabsRowsContext value={true}>
        <TabsPrimitive.List
          data-slot='tabs-list'
          data-variant={variant}
          className={cn(
            'group/tabs-list relative isolate flex flex-col gap-1',
            className,
          )}
          {...props}
        >
          {children}
          <span
            ref={backdropRef}
            data-slot='tabs-backdrop'
            aria-hidden
            className={cn(highlightClassName, rowTintClassName, '-z-20')}
          />
          {/*
           * The picked row's tint: as large as the list, and only its window moves. It aims
           * at where the picked row ends up and moves on `layout`, as the rows grow, so the
           * two land together. A row's height can't overshoot, so nor does the tint: it eases
           * on the role's fade curve. Base UI places it until the list has aimed it.
           */}
          <TabsPrimitive.Indicator
            data-slot='tabs-indicator'
            renderBeforeHydration
            className='bg-muted dark:bg-muted/60 pointer-events-none absolute inset-0 -z-10 transition-[clip-path] duration-(--motion-layout-duration) ease-(--motion-layout-fade-easing) [clip-path:inset(var(--tabs-row-top,var(--active-tab-top))_0_var(--tabs-row-bottom,var(--active-tab-bottom))_0_round_var(--surface-radius))] group-data-resizing/tabs-list:transition-none motion-reduce:transition-none forced-colors:hidden'
          />
        </TabsPrimitive.List>
      </TabsRowsContext>
    )
  }

  return (
    <div
      data-slot='tabs-track'
      data-variant={variant}
      className={cn(tabsListVariants({ variant }), className)}
    >
      {/* Room for the underline variant's focus ring, which the scroller would cut off. */}
      <TabsScroller className='group-data-[variant=line]/tabs-track:-m-1 group-data-[variant=line]/tabs-track:p-1'>
        <TabsPrimitive.List
          data-slot='tabs-list'
          className={cn(
            'group/tabs-list relative isolate',
            tabsListLayout,
            variant === 'line' &&
              'after:bg-border forced-colors:after:bg-[CanvasText] after:absolute after:inset-x-0 after:bottom-0 after:h-px data-[orientation=vertical]:after:inset-x-auto data-[orientation=vertical]:after:inset-y-0 data-[orientation=vertical]:after:end-0 data-[orientation=vertical]:after:h-auto data-[orientation=vertical]:after:w-px',
          )}
          {...props}
        >
          {children}
          <span
            ref={backdropRef}
            data-slot='tabs-backdrop'
            aria-hidden
            className={cn(highlightClassName, pillBackdropClassName)}
          />
          {variant === 'line' ? (
            <TabsPrimitive.Indicator
              data-slot='tabs-indicator'
              renderBeforeHydration
              className={cn(
                tabsIndicatorBase,
                'bg-foreground inset-x-0 bottom-0 h-0.5 [clip-path:inset(0_var(--active-tab-right)_0_var(--active-tab-left))] data-[orientation=vertical]:inset-x-auto data-[orientation=vertical]:inset-y-0 data-[orientation=vertical]:end-0 data-[orientation=vertical]:h-auto data-[orientation=vertical]:w-0.5 data-[orientation=vertical]:[clip-path:inset(var(--active-tab-top)_0_var(--active-tab-bottom)_0)]',
              )}
            />
          ) : (
            <TabsPrimitive.Indicator
              data-slot='tabs-indicator'
              renderBeforeHydration
              aria-hidden
              // Whatever the list holds is copied here, so nothing in the copy may take focus.
              inert
              className={cn(
                tabsIndicatorBase,
                pillClassName,
                'inset-0 [clip-path:inset(var(--active-tab-top)_var(--active-tab-right)_var(--active-tab-bottom)_var(--active-tab-left)_round_max(0px,calc(var(--list-radius)-2px)))]',
              )}
            >
              <span className={cn(tabsListLayout, 'h-full')}>
                <TabsCopyContext value={true}>{children}</TabsCopyContext>
              </span>
            </TabsPrimitive.Indicator>
          )}
        </TabsPrimitive.List>
      </TabsScroller>
    </div>
  )
}

const tabsTriggerLayout = cn(
  pillItemLayout,
  'shrink-0 group-data-[orientation=vertical]/tabs:justify-start',
)

function TabsTrigger({
  className,
  style,
  children,
  ...props
}: Omit<TabsPrimitive.Tab.Props, 'className'> & { className?: string }) {
  const copy = use(TabsCopyContext)
  const rows = use(TabsRowsContext)
  if (rows) {
    return (
      <TabsPrimitive.Tab
        data-slot='tabs-trigger'
        className={className}
        style={style}
        {...props}
      >
        {children}
      </TabsPrimitive.Tab>
    )
  }
  if (copy) {
    return (
      <span
        className={cn(tabsTriggerLayout, className)}
        style={typeof style === 'function' ? undefined : style}
      >
        {children}
      </span>
    )
  }
  return (
    <TabsPrimitive.Tab
      data-slot='tabs-trigger'
      // A disabled tab fades its label, not itself, so its focus ring keeps its strength.
      className={cn(
        tabsTriggerLayout,
        pillItemClassName,
        'group-data-[variant=line]/tabs-track:data-active:text-foreground',
        className,
      )}
      style={style}
      {...props}
    >
      {children}
    </TabsPrimitive.Tab>
  )
}

function TabsContent({
  className,
  ...props
}: Omit<TabsPrimitive.Panel.Props, 'className'> & { className?: string }) {
  return (
    <TabsPrimitive.Panel
      data-slot='tabs-content'
      // Base UI keeps the old panel mounted while the new one enters; hiding it at once stops the two overlapping.
      className={cn(
        'focus-visible:ring-ring/50 min-w-0 rounded-(--control-radius-capped) text-sm focus-visible:ring-3 focus-visible:outline-hidden transition-[opacity,translate] duration-(--motion-enter-duration) ease-(--motion-enter-easing) group-data-[orientation=vertical]/tabs:flex-1 data-ending-style:hidden data-starting-style:opacity-0 motion-safe:data-starting-style:translate-y-(--tabs-content-rise,6px)',
        className,
      )}
      {...props}
    />
  )
}

/**
 * Aims a list of rows' tint at where the picked row ends up, as `--tabs-row-top`
 * and `--tabs-row-bottom`. Rows grow and shrink as they're picked, so where
 * the picked one is now isn't where it lands: a copy of the list, styled at
 * once with nothing moving, shows where. A change of size while nothing moves
 * places it at once, as `markResizing` does for the other lists. Kept outside
 * the component: the React Compiler drops the forced reads written inside one.
 */
function aimAtPickedRow(list: HTMLElement) {
  let width = list.getBoundingClientRect().width
  let frame = 0
  let picking = 0

  const aim = (at: 'glide' | 'once') => {
    const insets = picking ? landingInsets(list) : pickedInsets(list)
    if (!insets) return
    const top = `${insets.top}px`
    const bottom = `${insets.bottom}px`
    if (
      list.style.getPropertyValue('--tabs-row-top') === top &&
      list.style.getPropertyValue('--tabs-row-bottom') === bottom
    )
      return
    if (at === 'once') {
      list.dataset.resizing = ''
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(() => delete list.dataset.resizing)
      })
    }
    list.style.setProperty('--tabs-row-top', top)
    list.style.setProperty('--tabs-row-bottom', bottom)
  }

  // A pick, or rows that come and go or change places.
  const picks = new MutationObserver(() => {
    const run = ++picking
    aim('glide')
    // While the rows grow, the list's height changes every frame: nothing to aim again until they settle.
    void transitionsQuiet(list, { subtree: true }).then(() => {
      if (run !== picking) return
      picking = 0
      // Something else may have changed size meanwhile, such as a font arriving.
      aim('once')
    })
  })
  picks.observe(list, {
    childList: true,
    subtree: true,
    attributeFilter: ['data-active'],
  })

  const sizes = new ResizeObserver(() => {
    const next = list.getBoundingClientRect().width
    const widthChanged = Math.abs(next - width) >= 0.5
    width = next
    if (widthChanged || picking === 0) aim('once')
  })
  sizes.observe(list)

  return () => {
    picks.disconnect()
    sizes.disconnect()
    cancelAnimationFrame(frame)
  }
}

/** The picked row's place now, while nothing moves. */
function pickedInsets(list: HTMLElement) {
  const row = list.querySelector('[role="tab"][data-active]')
  return row ? rowInsets(list.getBoundingClientRect(), row.getBoundingClientRect()) : null
}

/** The picked row's place once the rows have settled, measured on a copy of the list styled with nothing moving. */
function landingInsets(list: HTMLElement) {
  const copy = inertCopy(list, {
    insetBlockStart: '0',
    insetInlineStart: '0',
    width: `${list.getBoundingClientRect().width}px`,
    visibility: 'hidden',
  })
  list.after(copy)
  const insets = pickedInsets(copy)
  copy.remove()
  return insets
}

/** How far a row sits from its list's top and bottom edges, in px. */
function rowInsets(
  list: { top: number; bottom: number },
  row: { top: number; bottom: number },
) {
  return { top: row.top - list.top, bottom: list.bottom - row.bottom }
}

export { Tabs, TabsContent, TabsList, TabsTrigger, rowInsets }
