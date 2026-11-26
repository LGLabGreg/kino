'use client'

import { Badge } from '@/registry/components/kino/badge'
import { Button } from '@/registry/components/kino/button'
import {
  CollapsibleIndicator,
  collapsibleNestedClassName,
  collapsibleRowClassName,
} from '@/registry/components/kino/collapsible'
import { Kbd, KbdGroup } from '@/registry/components/kino/kbd'
import { ScrollArea } from '@/registry/components/kino/scroll-area'
import { Sheet, SheetContent, SheetTitle } from '@/registry/components/kino/sheet'
import {
  Tooltip,
  TooltipContent,
  TooltipGroup,
  TooltipShortcut,
  TooltipTrigger,
} from '@/registry/components/kino/tooltip'
import { IconPlaceholder } from '@/registry/icons/icon-placeholder'
import { useControllable } from '@/registry/lib/controllable'
import { CutLines, CutTooltip, undescribed, useCut } from '@/registry/lib/cut'
import { GLIDE_GROUP_CLOSE_DELAY } from '@/registry/lib/glide'
import {
  followPick,
  followPointer,
  itemMatching,
  pickClassName,
  rowHighlightClassName,
  rowTintClassName,
} from '@/registry/lib/highlight'
import { ariaShortcut, useApplePlatform, useShortcut } from '@/registry/lib/keys'
import { HOVER_DELAY } from '@/registry/lib/popup'
import { markMounted, mergeRefs } from '@/registry/lib/refs'
import { collapseClassName, transitionsSettled } from '@/registry/lib/resize'
import { narrowerThan, useNarrowerThan } from '@/registry/lib/roomy'
import { SwapTextTitleContext } from '@/registry/lib/swap'
import { Collapsible as CollapsiblePrimitive } from '@base-ui/react/collapsible'
import { mergeProps } from '@base-ui/react/merge-props'
import { useRender } from '@base-ui/react/use-render'
import { cva, type VariantProps } from 'class-variance-authority'
import {
  type ComponentProps,
  createContext,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
  type ReactNode,
  type RefObject,
  use,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import { cn } from '@/lib/utils'

/*
 * A sidebar beside the page. Its rows are the Tree's, under one highlight
 * that glides with the pointer and focus, and the current page is a tint
 * that glides to the next page as you go there. Each row keeps the
 * sidebar's whole width inside it, so a sidebar that narrows covers its
 * labels in place and nothing in a row moves. On a phone, it is a Sheet.
 */

type SidebarSide = 'start' | 'end'

/** Toggles the sidebar from anywhere on the page. */
const SIDEBAR_SHORTCUT = ['Mod', 'B'] as const

/** Under this width, in rem, the provider is a phone's screen: the sidebar is a Sheet. */
const SHEET_BELOW_REM = 48

interface SidebarContextValue {
  /** Whether the sidebar is docked open beside the page, on a wide screen. */
  open: boolean
  setOpen: (open: boolean) => void
  /** Whether the provider is as narrow as a phone, so the sidebar is a Sheet. */
  sheet: boolean
  sheetOpen: boolean
  setSheetOpen: (open: boolean) => void
  /** Opens or closes whichever the screen shows: the docked sidebar or the Sheet. */
  toggle: () => void
  /** The sidebar's id, for its triggers' `aria-controls`. */
  id: string
  shortcut: readonly string[] | null
}

const SidebarContext = createContext<SidebarContextValue | null>(null)

function useSidebar() {
  const context = use(SidebarContext)
  if (!context) throw new Error('useSidebar goes inside a SidebarProvider.')
  return context
}

/**
 * How the panel that holds the parts shows them: `collapsed` as an icon
 * rail, and `rail` once its edge has reached the rail's width.
 */
const SurfaceContext = createContext({ collapsed: false, rail: false })

/** Whether a provider `width` px wide, with `rem` px to a rem, is a phone's screen. */
function showsSheet(width: number, rem: number) {
  return narrowerThan(width, SHEET_BELOW_REM, rem)
}

/**
 * Holds whether the sidebar is open, and lays it out beside the page:
 * `SidebarInset` holds the page and scrolls. It is as tall as the screen
 * unless `className` says otherwise. Under 48rem wide, the sidebar is a Sheet.
 */
function SidebarProvider({
  open: openProp,
  defaultOpen = true,
  onOpenChange,
  shortcut = SIDEBAR_SHORTCUT,
  className,
  children,
  ref,
  ...props
}: ComponentProps<'div'> & {
  /** Whether the sidebar is docked open, when you hold the state. */
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  /** The keys that toggle it from anywhere on the page, or null for none. */
  shortcut?: readonly string[] | null
}) {
  const [open, setOpen] = useControllable(openProp, defaultOpen, onOpenChange)
  const [box, setBox] = useState<HTMLDivElement | null>(null)
  // Before the first paint: the container query has already hidden the
  // docked sidebar on a phone, and this only decides what its triggers open.
  const sheet = useNarrowerThan(box, SHEET_BELOW_REM)
  const [sheetOpen, setSheetOpen] = useState(false)
  if (!sheet && sheetOpen) setSheetOpen(false)
  const id = useId()

  const toggle = () => {
    if (sheet) setSheetOpen(!sheetOpen)
    else setOpen(!open)
  }

  useShortcut(shortcut ?? undefined, toggle, box)
  const boxRef = useMemo(() => mergeRefs(setBox, ref), [ref])

  return (
    <SidebarContext
      value={{
        open,
        setOpen,
        sheet,
        sheetOpen,
        setSheetOpen,
        toggle,
        id,
        shortcut,
      }}
    >
      <div
        ref={boxRef}
        data-slot='sidebar-provider'
        data-state={open ? 'expanded' : 'collapsed'}
        className={cn(
          '@container/sidebar-provider relative isolate flex h-dvh w-full min-w-0 overflow-hidden',
          className,
        )}
        {...props}
      >
        {children}
      </div>
    </SidebarContext>
  )
}

/**
 * The page beside the sidebar, the page's `main` landmark unless `render`
 * gives another element. It scrolls on its own, so the sidebar stays put.
 */
function SidebarInset({
  className,
  render,
  ...props
}: Omit<useRender.ComponentProps<'main'>, 'className'> & {
  className?: string
}) {
  return useRender({
    defaultTagName: 'main',
    render,
    props: mergeProps<'main'>(
      {
        className: cn(
          'bg-background scrollbar-thin relative flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto',
          className,
        ),
      },
      { 'data-slot': 'sidebar-inset' } as ComponentProps<'main'>,
      props,
    ),
  })
}

/** A row's inline padding, which centres a 1rem icon in a square as tall as the row. */
const rowPadding = 'px-[calc((var(--control-height)-1rem)/2)]'

/**
 * The sidebar's rows, header and footer leave this much room at its edges;
 * an icon rail is a row's height and this either side.
 */
const sidebarGutter = 'px-(--control-padding)'

/**
 * The panel that holds the parts: the sidebar's landmark, named by its
 * `aria-label`. `collapsed` shows it as an icon rail, its rows named by
 * their tooltips.
 */
function SidebarSurface({
  collapsed,
  rail = false,
  className,
  children,
  ref,
  ...props
}: ComponentProps<'nav'> & { collapsed: boolean; rail?: boolean }) {
  const navRef = useRef<HTMLElement>(null)
  const surfaceRef = useMemo(() => mergeRefs(navRef, ref), [ref])

  // What hides in the rail can't keep focus: it goes to the row it belongs to.
  useEffect(() => {
    const nav = navRef.current
    const active = document.activeElement
    if (!collapsed || !nav || !(active instanceof HTMLElement) || !nav.contains(active))
      return
    const row = railHome(active)
    if (row && row !== active) row.focus({ preventScroll: true })
  }, [collapsed])

  return (
    <SurfaceContext value={{ collapsed, rail }}>
      <nav
        ref={surfaceRef}
        data-slot='sidebar-surface'
        data-state={collapsed ? 'collapsed' : 'expanded'}
        className={cn(
          'group/sidebar text-sidebar-foreground flex h-full min-h-0 w-full min-w-0 flex-col',
          className,
        )}
        {...props}
      >
        {/* The rail's tooltips are one, which slides from row to row. */}
        <TooltipGroup>{children}</TooltipGroup>
      </nav>
    </SurfaceContext>
  )
}

/** Where focus on `element` goes once the sidebar is a rail: the row that stays, or itself. */
function railHome(element: HTMLElement): HTMLElement | null {
  const sub = element.closest('[data-slot=sidebar-menu-sub]')
  if (sub) {
    return (
      sub.parentElement?.querySelector<HTMLElement>(
        ':scope > [data-slot=sidebar-menu-section-trigger]',
      ) ?? null
    )
  }
  if (element.matches('[data-sidebar-menu-action]')) {
    return (
      element.parentElement?.querySelector<HTMLElement>(
        ':scope > [data-slot=sidebar-menu-button]',
      ) ?? null
    )
  }
  if (element.matches('[data-sidebar-group-action]')) {
    return (
      element
        .closest('[data-slot=sidebar-group]')
        ?.querySelector<HTMLElement>('[data-slot=sidebar-menu-button]') ?? null
    )
  }
  return element
}

/**
 * The sidebar on a phone: the same parts, whole, in a Sheet from its side.
 * A link pressed inside closes it.
 */
function SidebarSheet({
  side,
  label,
  children,
}: {
  side: SidebarSide
  label: string
  children: ReactNode
}) {
  const { sheet, sheetOpen, setSheetOpen, id } = useSidebar()
  if (!sheet) return null
  return (
    <Sheet side={side} open={sheetOpen} onOpenChange={setSheetOpen}>
      <SheetContent
        id={id}
        className='bg-sidebar w-(--sidebar-width-mobile,18rem) [--sidebar-width:var(--sidebar-width-mobile,18rem)]'
      >
        <SheetTitle className='sr-only'>{label}</SheetTitle>
        <SidebarSurface
          collapsed={false}
          aria-label={label}
          // Without a header to end short of it, the rows start below the close button, less the content's own gutter.
          className='group-data-close-button/panel-surface:[&:not(:has(>[data-slot=sidebar-header]:first-child))]:pt-[calc(var(--surface-padding-lg)-6px+var(--control-height-sm)-var(--control-padding))]'
        >
          {children}
        </SidebarSurface>
      </SheetContent>
    </Sheet>
  )
}

const rowSelector =
  '[data-slot=sidebar-menu-button], [data-slot=sidebar-menu-section-trigger]'

/**
 * The row that shows the current page: its own, or, while a section hides
 * it (closed, or folded into the rail), the section's.
 */
function currentRow(area: HTMLElement): HTMLElement | null {
  // Never a copy of a row that is leaving (the `flow` lib's), which keeps its marks while it fades.
  const current = area.querySelector<HTMLElement>(
    '[data-slot=sidebar-menu-button][aria-current=page]:not([data-leaving] *)',
  )
  if (!current) return null
  const sub = current.closest('[data-slot=sidebar-menu-sub]')
  const trigger = sub?.parentElement?.querySelector<HTMLElement>(
    ':scope > [data-slot=sidebar-menu-section-trigger]',
  )
  if (
    trigger &&
    (!trigger.hasAttribute('data-panel-open') || area.dataset.state === 'collapsed')
  ) {
    return trigger
  }
  return current
}

/**
 * The current page's tint, under the rows, as strong as the highlight's, since
 * the sidebar's own colour washes out the muted one: it moves on `morph`, as
 * the Tabs' pill does, so it travels to the page you go to. Forced colours
 * mark the row itself instead.
 */
const currentClassName = `${pickClassName} ${rowTintClassName} forced-colors:hidden`

/**
 * Rows that share one highlight, which glides between them under the
 * pointer and with focus; with `current`, the current page's tint too.
 */
function RowArea({
  current = false,
  className,
  children,
}: {
  current?: boolean
  className?: string
  children: ReactNode
}) {
  const { collapsed } = use(SurfaceContext)
  const areaRef = useRef<HTMLDivElement>(null)
  const highlightRef = useRef<HTMLSpanElement>(null)
  const currentRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    const area = areaRef.current
    const highlight = highlightRef.current
    if (!area || !highlight) return
    const stops = [
      followPointer(area, highlight, {
        // A heading that opens and closes its group is a control of its own: over it, the highlight goes.
        itemOf: itemMatching(area, rowSelector, {
          rows: '[data-slot=sidebar-group-toggle]',
        }),
        focus: true,
      }),
    ]
    const tint = currentRef.current
    if (tint) {
      stops.push(
        followPick(area, tint, {
          picked: () => currentRow(area),
          attributes: ['aria-current', 'data-panel-open', 'data-state'],
        }),
      )
    }
    return () => {
      for (const stop of stops) stop()
    }
  }, [])

  return (
    <div
      ref={areaRef}
      data-state={collapsed ? 'collapsed' : 'expanded'}
      className={cn(
        'relative isolate min-w-0 overflow-x-clip contain-inline-size',
        className,
      )}
    >
      {current ? (
        <span
          ref={currentRef}
          aria-hidden
          data-slot='sidebar-current'
          className={currentClassName}
        />
      ) : null}
      {children}
      <span
        ref={highlightRef}
        aria-hidden
        data-slot='sidebar-highlight'
        className={rowHighlightClassName}
      />
    </div>
  )
}

/** What sits above the rows, such as the workspace you are in. */
function SidebarHeader({ className, children, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot='sidebar-header'
      className={cn(
        // In a Sheet, it ends short of the close button, as a panel's header does.
        'flex shrink-0 flex-col py-(--control-padding) group-data-close-button/panel-surface:pe-[calc(var(--surface-padding-lg)+var(--control-height-sm)-4px)]',
        sidebarGutter,
        className,
      )}
      {...props}
    >
      <RowArea className='flex flex-col gap-px'>{children}</RowArea>
    </div>
  )
}

/** What sits below the rows, such as the person signed in. */
function SidebarFooter({ className, children, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot='sidebar-footer'
      className={cn(
        'flex shrink-0 flex-col py-(--control-padding)',
        sidebarGutter,
        className,
      )}
      {...props}
    >
      <RowArea className='flex flex-col gap-px'>{children}</RowArea>
    </div>
  )
}

/**
 * The groups of rows, between the header and the footer. It scrolls when
 * they don't fit, with thin scrollbars and fading edges. With no header or
 * footer, its rows keep the gutter from the sidebar's top or bottom.
 */
function SidebarContent({
  className,
  children,
  'aria-label': label = 'Pages',
  ...props
}: Omit<ComponentProps<typeof ScrollArea>, 'className'> & {
  className?: string
}) {
  return (
    <ScrollArea
      data-slot='sidebar-content'
      aria-label={label}
      className='group/sidebar-content min-h-0 flex-1'
      {...props}
    >
      <RowArea
        current
        className={cn(
          'flex flex-col gap-(--surface-gap) py-1 group-first/sidebar-content:pt-(--control-padding) group-last/sidebar-content:pb-(--control-padding)',
          sidebarGutter,
          className,
        )}
      >
        {children}
      </RowArea>
    </ScrollArea>
  )
}

const GroupContext = createContext<{
  id: string
  labelled: (has: boolean) => void
} | null>(null)

/** A group of rows, named by its heading, `SidebarGroupLabel`, when it has one. */
function SidebarGroup({ className, children, ...props }: ComponentProps<'div'>) {
  const id = useId()
  const [labelled, setLabelled] = useState(false)
  return (
    <GroupContext value={{ id, labelled: setLabelled }}>
      <div
        role='group'
        aria-labelledby={labelled ? id : undefined}
        data-slot='sidebar-group'
        className={cn('relative flex min-w-0 flex-col', className)}
        {...props}
      >
        {children}
      </div>
    </GroupContext>
  )
}

/**
 * The width a row's content keeps in a docked sidebar whatever the sidebar's
 * own width, so nothing is laid out again as it folds to its rail: the
 * sidebar's, inside its gutters and the row's padding. Anywhere else (its
 * Sheet, or a list drawn with its rows in a popover or a window) nothing
 * folds, so the content fits its row.
 */
const contentWidth =
  'w-full in-data-[slot=sidebar]:w-[calc(var(--sidebar-width,16rem)-1px-2*var(--control-padding)-(var(--control-height)-1rem))]'

/**
 * A group's heading. In the rail its words fade and a short line takes its
 * place, so the rows below stay where they are. Given `open`, it is a
 * disclosure button that shows and hides the group's rows, its chevron
 * turning down while they show.
 */
function SidebarGroupLabel({
  className,
  children,
  open,
  onOpenChange,
  ...props
}: ComponentProps<'div'> & {
  /** Whether the group's rows show; the heading only says so, and the rows are yours to hide. */
  open?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const group = use(GroupContext)
  const { rail } = use(SurfaceContext)
  useLayoutEffect(() => {
    if (!group) return
    group.labelled(true)
    return () => group.labelled(false)
  }, [group])
  const toggles = open !== undefined
  // In the rail its words fade, and its chevron with them.
  const fadesInRail =
    'transition-opacity duration-(--motion-enter-duration) ease-(--motion-enter-easing) group-data-[state=collapsed]/sidebar:opacity-0 group-data-[state=collapsed]/sidebar:duration-(--motion-exit-duration) group-data-[state=collapsed]/sidebar:ease-(--motion-exit-easing)'
  const words = (
    <span
      data-cut
      className={cn(
        'truncate',
        toggles ? 'min-w-0' : cn('shrink-0', fadesInRail, contentWidth),
      )}
    >
      {children}
    </span>
  )
  return (
    <div
      id={group?.id}
      data-slot='sidebar-group-label'
      className={cn(
        'text-muted-foreground relative flex h-(--control-height-sm) shrink-0 items-center overflow-hidden text-xs font-medium',
        !toggles && rowPadding,
        // The line drawn in the rail, as wide as an icon, under where the words were.
        'after:bg-border after:pointer-events-none after:absolute after:start-[calc((var(--control-height)-1rem)/2)] after:w-4 after:top-1/2 after:h-px after:opacity-0 after:transition-opacity after:duration-(--motion-exit-duration) after:ease-(--motion-exit-easing) forced-colors:after:bg-[CanvasText] group-data-[state=collapsed]/sidebar:after:opacity-100 group-data-[state=collapsed]/sidebar:after:duration-(--motion-enter-duration) group-data-[state=collapsed]/sidebar:after:ease-(--motion-enter-easing)',
        className,
      )}
      {...props}
    >
      {/* A long heading truncates, and shows whole under the pointer; in the rail it is hidden. */}
      {toggles ? (
        <CutTooltip
          disabled={rail}
          render={
            <button
              type='button'
              aria-expanded={open}
              // In the rail its words are gone, so it leaves the tab order.
              tabIndex={rail ? -1 : undefined}
              onClick={() => onOpenChange?.(!open)}
              data-slot='sidebar-group-toggle'
              className={cn(
                'group/collapsible-trigger hover:text-sidebar-foreground flex h-full shrink-0 items-center gap-1 rounded-(--control-radius-capped) text-start',
                rowPadding,
                // As wide as a row whatever the sidebar's own width, so its words don't reflow as the rail closes.
                'w-[calc(var(--sidebar-width,16rem)-1px-2*var(--control-padding))]',
                'transition-[color,box-shadow] duration-(--motion-press-duration) ease-(--motion-press-fade-easing)',
                // Inset, since the list scrolls and would clip a ring past its edge.
                'focus-visible:ring-ring/50 focus-visible:ring-3 focus-visible:ring-inset focus-visible:outline-hidden',
                // Forced colours' outline, inside, since the heading clips what passes its edge.
                'focus-visible:-outline-offset-2',
              )}
            >
              <span className={cn('flex min-w-0 items-center gap-1', fadesInRail)}>
                {words}
                <CollapsibleIndicator open={open} className='size-3' />
              </span>
            </button>
          }
        />
      ) : (
        <CutTooltip
          // In the rail the heading is hidden.
          disabled={rail}
          render={words}
        />
      )}
    </div>
  )
}

/**
 * What hides in the rail, such as a row's menu: it fades, then leaves the
 * tab order, and comes back the other way.
 */
const hiddenInRail =
  'transition-[opacity,visibility] duration-(--motion-enter-duration) ease-(--motion-enter-easing) group-data-[state=collapsed]/sidebar:invisible group-data-[state=collapsed]/sidebar:opacity-0 group-data-[state=collapsed]/sidebar:duration-(--motion-exit-duration) group-data-[state=collapsed]/sidebar:ease-(--motion-exit-easing)'

/**
 * A small button at the end of a group's heading, such as one that adds a
 * project. Give it an `aria-label`. It stays put as the sidebar narrows.
 */
function SidebarGroupAction({ className, ...props }: ComponentProps<typeof Button>) {
  return (
    <Button
      variant='ghost'
      size='icon-xs'
      className={cn(
        'text-muted-foreground absolute top-[calc((var(--control-height-sm)-var(--control-height-xs))/2)] start-[calc(var(--sidebar-width,16rem)-1px-2*var(--control-padding)-var(--control-height-xs)-(var(--control-height-sm)-var(--control-height-xs))/2)]',
        hiddenInRail,
        className,
      )}
      {...props}
      data-sidebar-group-action=''
    />
  )
}

function SidebarMenu({ className, ...props }: ComponentProps<'ul'>) {
  return (
    <ul
      data-slot='sidebar-menu'
      className={cn('flex min-w-0 flex-col gap-px', className)}
      {...props}
    />
  )
}

function SidebarMenuItem({ className, ...props }: ComponentProps<'li'>) {
  return (
    <li
      data-slot='sidebar-menu-item'
      className={cn('group/sidebar-item relative min-w-0', className)}
      {...props}
    />
  )
}

/*
 * A row is the Collapsible's and the Tree's, as tall as a control. Its content
 * keeps the sidebar's whole width and the row clips it, so the rail covers it
 * in place; a label too long is cut short, and its tooltip shows it whole.
 */
const sidebarRowVariants = cva(
  [
    collapsibleRowClassName,
    'group/sidebar-row relative shrink-0 overflow-clip text-sidebar-foreground select-none',
    rowPadding,
    // In the rail it is its icon's square from the start, so the highlight and the current page's tint take the rail's shape as the edge moves; the edge covers the rest.
    'group-data-[state=collapsed]/sidebar:w-(--control-height) group-data-[state=collapsed]/sidebar:overflow-visible',
    'transition-[color,background-color,box-shadow] duration-(--motion-press-duration) ease-(--motion-press-fade-easing)',
    // Inset, since the list scrolls and would clip a ring past its edge.
    'focus-visible:ring-ring/50 focus-visible:ring-3 focus-visible:ring-inset focus-visible:outline-hidden',
    'disabled:text-sidebar-foreground/40 disabled:pointer-events-none data-disabled:text-sidebar-foreground/40 data-disabled:pointer-events-none aria-disabled:text-sidebar-foreground/40 aria-disabled:pointer-events-none',
    // Under forced colours, the current page is the system's own highlight.
    'forced-colors:aria-[current=page]:bg-[Highlight] forced-colors:aria-[current=page]:text-[HighlightText] forced-colors:aria-[current=page]:forced-color-adjust-none forced-colors:aria-[current=page]:*:text-[HighlightText]',
  ],
  {
    variants: {
      size: {
        default: 'py-[calc((var(--control-height)-1lh)/2)]',
        // Room for a picture as tall as a small control, such as a person's or a workspace's, the same all round.
        lg: 'p-[calc((var(--control-height-lg)-var(--control-height-sm))/2)]',
      },
    },
    defaultVariants: { size: 'default' },
  },
)

/** The row's content, which keeps a docked sidebar's whole width (`contentWidth`). Its icons sit muted, and full strength on the current page. */
const rowContentClassName = cn(
  'flex shrink-0 items-start gap-2 [&>svg]:mt-0.5 [&>svg]:text-muted-foreground group-aria-[current=page]/sidebar-row:[&>svg]:text-sidebar-foreground',
  // A label too long for the row is cut short; its tooltip shows it whole.
  // A span leading another, such as a workspace's logo before its name, is a picture: it keeps its size.
  '[&>span:not([data-slot]):not(:first-child:has(+span:not([data-slot])))]:min-w-0 [&>span:not([data-slot]):not(:first-child:has(+span:not([data-slot])))]:flex-1 [&>span:not([data-slot]):not(:first-child:has(+span:not([data-slot])))]:truncate',
  // In the rail, all but the icon fade as the edge covers them, so no letter shows beside it.
  '[&>*:not(:first-child)]:transition-opacity [&>*:not(:first-child)]:duration-(--motion-enter-duration) [&>*:not(:first-child)]:ease-(--motion-enter-easing) group-data-[state=collapsed]/sidebar:[&>*:not(:first-child)]:opacity-0 group-data-[state=collapsed]/sidebar:[&>*:not(:first-child)]:duration-(--motion-exit-duration) group-data-[state=collapsed]/sidebar:[&>*:not(:first-child)]:ease-(--motion-exit-easing)',
  // Room for the row's menu, when it has one.
  'group-has-data-sidebar-menu-action/sidebar-item:pe-[calc(var(--control-height-xs)+--spacing(1))]',
)

/**
 * Closes the Sheet the sidebar shows in a narrow container, when it is one.
 * Outside a SidebarProvider there is no Sheet, so it does nothing: a list
 * drawn with the sidebar's rows works in a popover or a panel too.
 */
function useCloseSheet() {
  const context = use(SidebarContext)
  return () => {
    if (context?.sheet) context.setSheetOpen(false)
  }
}

/** Closes the Sheet when a link inside it is pressed, since the page it opens is under it. */
function useCloseOnNavigate() {
  const closeSheet = useCloseSheet()
  return (event: MouseEvent<HTMLElement>) => {
    if (event.currentTarget.closest('a[href]')) closeSheet()
  }
}

/**
 * The row's tooltip names it where its label doesn't show whole: in the
 * icon rail, where the label is covered, with `tooltip`, and while a long
 * label is cut short, with the cut text, such as a name over an email.
 * Elsewhere it doesn't open.
 */
function RowTooltip({ tooltip, row }: { tooltip?: ReactNode; row: ReactElement }) {
  // From where the rail's edge stops, so it opens beside the icon.
  const { rail } = use(SurfaceContext)
  const [element, setElement] = useState<HTMLElement | null>(null)
  const cut = useCut(element, rowLabels)
  const shown = rail ? Boolean(tooltip) : cut.length > 0
  return (
    <SwapTextTitleContext value={false}>
      <Tooltip disabled={!shown}>
        {/* Its name holds the whole label already, covered or cut. */}
        <TooltipTrigger ref={setElement} render={undescribed(row)} />
        <TooltipContent side='end'>
          {rail ? tooltip : <CutLines lines={cut} />}
        </TooltipContent>
      </Tooltip>
    </SwapTextTitleContext>
  )
}

/** A row's label, or the lines stacked inside it, such as a name over an email. */
const rowLabels =
  ':scope > span > span:not([data-slot]):not(:has(> span)), :scope > span > span:not([data-slot]) > span:not(.sr-only), [data-cut]'

/**
 * A row: a link to a page (`render={<a href='…' />}`) or a button. `isActive`
 * marks the current page, read out as such. `tooltip` names it in the rail.
 */
function SidebarMenuButton({
  isActive = false,
  tooltip,
  size,
  className,
  children,
  render,
  onClick,
  ...props
}: Omit<useRender.ComponentProps<'button'>, 'className'> & {
  className?: string
  /** Whether this row is the page you are on. */
  isActive?: boolean
  /** Its name in the rail, usually its label. */
  tooltip?: ReactNode
} & VariantProps<typeof sidebarRowVariants>) {
  const closeOnNavigate = useCloseOnNavigate()
  const row = useRender({
    defaultTagName: 'button',
    render,
    props: mergeProps<'button'>(
      {
        type: render ? undefined : 'button',
        className: cn(sidebarRowVariants({ size }), className),
        onClick: (event) => {
          // A disabled row still takes focus, so it can be read, but Enter does nothing.
          if (event.currentTarget.getAttribute('aria-disabled') === 'true') {
            event.preventDefault()
            return
          }
          onClick?.(event)
          closeOnNavigate(event)
        },
        children: (
          <span
            className={cn(
              rowContentClassName,
              contentWidth,
              size === 'lg' && [
                'in-data-[slot=sidebar]:w-[calc(var(--sidebar-width,16rem)-1px-2*var(--control-padding)-(var(--control-height-lg)-var(--control-height-sm)))] items-center',
                // In the rail the row is as wide as an icon's: the picture glides back to its middle, where the icons above sit.
                '[&>:first-child]:transition-transform [&>:first-child]:duration-(--motion-layout-duration) [&>:first-child]:ease-(--motion-layout-easing) motion-reduce:[&>:first-child]:transition-none',
                'group-data-[state=collapsed]/sidebar:[&>:first-child]:-translate-x-[calc((var(--control-height-lg)-var(--control-height))/2)] rtl:group-data-[state=collapsed]/sidebar:[&>:first-child]:translate-x-[calc((var(--control-height-lg)-var(--control-height))/2)]',
              ],
            )}
          >
            {children}
          </span>
        ),
      },
      props,
      // After the given props, so a menu trigger rendering the row can't take its slot.
      {
        'data-slot': 'sidebar-menu-button',
        'data-size': size ?? 'default',
        'aria-current': isActive ? 'page' : undefined,
      } as ComponentProps<'button'>,
    ),
  })
  return <RowTooltip tooltip={tooltip} row={row} />
}

/** A count after a row's label, such as unread items: a Badge, covered in the rail. */
function SidebarMenuBadge({
  className,
  variant = 'secondary',
  ...props
}: ComponentProps<typeof Badge>) {
  return <Badge variant={variant} className={cn('ms-auto', className)} {...props} />
}

/**
 * A small button at a row's end, such as one that opens its menu. Give it an
 * `aria-label`. It shows while the pointer is over the row, focus is on it or
 * its menu is open, and always on a touch screen.
 */
function SidebarMenuAction({ className, ...props }: ComponentProps<typeof Button>) {
  return (
    <Button
      variant='ghost'
      size='icon-xs'
      className={cn(
        'text-muted-foreground absolute top-[calc((var(--control-height)-var(--control-height-xs))/2)] z-30 start-[calc(var(--sidebar-width,16rem)-1px-2*var(--control-padding)-var(--control-height-xs)-(var(--control-height)-var(--control-height-xs))/2)]',
        'opacity-0 group-hover/sidebar-item:opacity-100 group-focus-within/sidebar-item:opacity-100 data-popup-open:opacity-100 pointer-coarse:opacity-100',
        hiddenInRail,
        className,
      )}
      {...props}
      data-sidebar-menu-action=''
    />
  )
}

const SectionContext = createContext<{ setOpen: (open: boolean) => void }>({
  setOpen: () => {},
})

/**
 * A row that opens to show more rows, by the disclosure pattern: its
 * chevron turns down as they open on the Collapsible's height. In the rail
 * its rows fold away, and pressing it opens the sidebar and the section.
 */
function SidebarMenuSection({
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  className,
  ...props
}: Omit<
  CollapsiblePrimitive.Root.Props,
  'className' | 'render' | 'open' | 'defaultOpen' | 'onOpenChange'
> & {
  className?: string
  /** Whether its rows show, when you hold the state. */
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const [open, setOpen] = useControllable(openProp, defaultOpen, onOpenChange)
  return (
    <SectionContext value={{ setOpen }}>
      <CollapsiblePrimitive.Root
        open={open}
        onOpenChange={setOpen}
        render={<SidebarMenuItem className={className} />}
        {...props}
      />
    </SectionContext>
  )
}

function SidebarMenuSectionTrigger({
  tooltip,
  className,
  children,
  onClick,
  ...props
}: Omit<CollapsiblePrimitive.Trigger.Props, 'className'> & {
  className?: string
  /** Its name in the rail, usually its label. */
  tooltip?: ReactNode
}) {
  const { collapsed } = use(SurfaceContext)
  const { setOpen } = useSidebar()
  const section = use(SectionContext)
  const row = (
    <CollapsiblePrimitive.Trigger
      data-slot='sidebar-menu-section-trigger'
      className={cn(
        sidebarRowVariants(),
        'group/collapsible-trigger',
        // Under forced colours, it takes the current page's highlight while it hides that page: closed, or in the rail.
        'forced-colors:not-data-panel-open:group-has-[[aria-current=page]]/sidebar-item:bg-[Highlight] forced-colors:not-data-panel-open:group-has-[[aria-current=page]]/sidebar-item:text-[HighlightText] forced-colors:not-data-panel-open:group-has-[[aria-current=page]]/sidebar-item:forced-color-adjust-none forced-colors:not-data-panel-open:group-has-[[aria-current=page]]/sidebar-item:*:text-[HighlightText]',
        'forced-colors:group-data-[state=collapsed]/sidebar:group-has-[[aria-current=page]]/sidebar-item:bg-[Highlight] forced-colors:group-data-[state=collapsed]/sidebar:group-has-[[aria-current=page]]/sidebar-item:text-[HighlightText] forced-colors:group-data-[state=collapsed]/sidebar:group-has-[[aria-current=page]]/sidebar-item:forced-color-adjust-none forced-colors:group-data-[state=collapsed]/sidebar:group-has-[[aria-current=page]]/sidebar-item:*:text-[HighlightText]',
        className,
      )}
      // In the rail its rows are folded away whatever the section's state.
      {...(collapsed ? { 'aria-expanded': false } : {})}
      onClick={(event) => {
        onClick?.(event)
        if (event.defaultPrevented || !collapsed) return
        // In the rail, it shows what's inside: the sidebar opens, and the section with it.
        event.preventBaseUIHandler()
        setOpen(true)
        section.setOpen(true)
      }}
      {...props}
    >
      <span className={cn(rowContentClassName, contentWidth)}>
        {children}
        <CollapsibleIndicator className='ms-auto' />
      </span>
    </CollapsiblePrimitive.Trigger>
  )
  return <RowTooltip tooltip={tooltip} row={row} />
}

/**
 * A section's rows, under a line from its icon, their labels level with
 * its label. They fold away in the rail.
 */
function SidebarMenuSub({ className, children, ...props }: ComponentProps<'ul'>) {
  const ref = useRef<HTMLUListElement>(null)

  // Its height in px, which the rail can fold from: Base UI leaves an open
  // panel at `auto`, which CSS can't move. Rows that come and go move it too.
  useEffect(() => {
    const list = ref.current
    const panel = list?.parentElement
    if (!list || !panel) return
    let last = -1
    const observer = new ResizeObserver(([entry]) => {
      const height = entry.borderBoxSize[0].blockSize
      if (Math.abs(height - last) < 0.5) return
      last = height
      panel.style.setProperty('--sidebar-menu-sub-height', `${height}px`)
    })
    observer.observe(list)
    return () => observer.disconnect()
  }, [])

  return (
    <CollapsiblePrimitive.Panel
      // Kept while closed, so its section knows when it holds the current page.
      keepMounted
      data-slot='sidebar-menu-sub'
      // Clipped down the page only, so a focus ring inside keeps its sides.
      className={cn(
        collapseClassName,
        'overflow-y-clip [--collapse-height:var(--sidebar-menu-sub-height,var(--collapsible-panel-height))]',
        'group-data-[state=collapsed]/sidebar:invisible group-data-[state=collapsed]/sidebar:h-0 group-data-[state=collapsed]/sidebar:transition-[height,visibility] group-data-[state=collapsed]/sidebar:duration-(--motion-layout-duration) group-data-[state=collapsed]/sidebar:ease-(--motion-layout-easing) group-data-[state=collapsed]/sidebar:*:opacity-0 group-data-[state=collapsed]/sidebar:*:duration-(--motion-exit-duration) group-data-[state=collapsed]/sidebar:*:ease-(--motion-exit-easing) motion-reduce:group-data-[state=collapsed]/sidebar:transition-none',
      )}
    >
      <ul
        ref={ref}
        className={cn(
          collapsibleNestedClassName,
          'before:start-[calc((var(--control-height)-1rem)/2+--spacing(2))]',
          className,
        )}
        {...props}
      >
        {children}
      </ul>
    </CollapsiblePrimitive.Panel>
  )
}

function SidebarMenuSubItem({ className, ...props }: ComponentProps<'li'>) {
  return (
    <li
      data-slot='sidebar-menu-sub-item'
      className={cn('relative min-w-0', className)}
      {...props}
    />
  )
}

/** A section's row: a link to a page, usually, with `isActive` on the current one. */
function SidebarMenuSubButton({
  isActive = false,
  tooltip,
  className,
  children,
  render,
  onClick,
  ...props
}: Omit<useRender.ComponentProps<'a'>, 'className'> & {
  className?: string
  isActive?: boolean
  /** Its name, shown while a long label is cut short. */
  tooltip?: ReactNode
}) {
  const closeOnNavigate = useCloseOnNavigate()
  const row = useRender({
    defaultTagName: 'a',
    render,
    props: mergeProps<'a'>(
      {
        className: cn(sidebarRowVariants(), className),
        onClick: (event) => {
          // A disabled row still takes focus, so it can be read, but Enter does nothing.
          if (event.currentTarget.getAttribute('aria-disabled') === 'true') {
            event.preventDefault()
            return
          }
          onClick?.(event)
          closeOnNavigate(event)
        },
        children: (
          <span
            className={cn(
              rowContentClassName,
              // A sub-row's content: the row's width, less its indent.
              'w-full in-data-[slot=sidebar]:w-[calc(var(--sidebar-width,16rem)-1px-2*var(--control-padding)-(var(--control-height)-1rem)-1.5rem)]',
            )}
          >
            {children}
          </span>
        ),
      },
      props,
      {
        // Read with the sidebar's other rows, by the highlight and the current page's tint.
        'data-slot': 'sidebar-menu-button',
        'data-sub': '',
        'aria-current': isActive ? 'page' : undefined,
      } as ComponentProps<'a'>,
    ),
  })
  return <RowTooltip tooltip={tooltip} row={row} />
}

/** The icon rail's width: a row's height, a gutter either side and the sidebar's border. */
const railVariable =
  '[--sidebar-rail:var(--sidebar-width-icon,calc(var(--control-height)+2*var(--control-padding)+1px))]'

type SidebarCollapsible = 'icon' | 'offcanvas'

/**
 * `sidebar` draws its edge; `inset` leaves it out, for a page that sits
 * beside it as a card, and keeps a gutter for the card when it's out of sight.
 */
type SidebarVariant = 'sidebar' | 'inset'

type Peek = 'off' | 'open' | 'closing'

/**
 * The sidebar beside the page, which docks to `side`. Collapsed, `icon`
 * narrows it to its icons, its rows named by tooltips; `offcanvas` slides it
 * away, and resting the pointer on the screen's edge brings it back over the
 * page for a moment. Either way the page beside it moves on `layout`. On a
 * phone it is a Sheet from the same side.
 */
function Sidebar({
  side = 'start',
  collapsible = 'icon',
  variant = 'sidebar',
  'aria-label': label = 'Main',
  className,
  children,
  ...props
}: ComponentProps<'nav'> & {
  /** The edge it docks to: `start` and `end` follow the text direction. */
  side?: SidebarSide
  /** How it collapses: to its icons, or out of sight. */
  collapsible?: SidebarCollapsible
  /** Whether it draws its edge, or leaves it out for a page set beside it as a card. */
  variant?: SidebarVariant
}) {
  const { open, id, sheet } = useSidebar()
  const icon = collapsible === 'icon'
  const gapRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  // An icon rail takes its own width only once the edge has reached it, and
  // the sidebar's whole width as soon as it opens, so nothing inside is laid
  // out again while the edge moves: the panel is clipped to the edge instead.
  const [rail, setRail] = useState(!open)
  const [wasOpen, setWasOpen] = useState(open)
  // Offcanvas, collapsed: whether it peeks over the page.
  const [peek, setPeek] = useState<Peek>('off')
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setRail(false)
      setPeek('off')
    }
  }
  // Never a rail while open, whatever an earlier collapse left behind.
  const railed = icon && !open && rail

  useEffect(() => {
    const gap = gapRef.current
    if (open || !icon || !gap || rail) return
    let current = true
    void transitionsSettled(gap, { property: 'width' }).then(() => {
      if (current) setRail(true)
    })
    return () => {
      current = false
    }
  }, [open, icon, rail])

  const peeking = usePeek({
    enabled: !icon && !open,
    peek,
    setPeek,
    panelRef,
    id,
  })
  // Slid away, or sliding: it still catches the pointer, which turns it back.
  const away = !icon && !open && peek !== 'open'
  const hidden = !icon && !open && peek === 'off'

  return (
    <>
      {/* The page's room for it, which moves on `layout` as it collapses. */}
      <div
        ref={gapRef}
        aria-hidden
        data-slot='sidebar-gap'
        data-state={open ? 'expanded' : 'collapsed'}
        data-side={side}
        data-collapsible={collapsible}
        data-variant={variant}
        className={cn(
          'hidden w-(--sidebar-width,16rem) shrink-0 transition-[width] duration-(--motion-layout-duration) ease-(--motion-layout-easing) data-[side=end]:order-last motion-reduce:transition-none @3xl/sidebar-provider:block',
          'data-[collapsible=icon]:data-[state=collapsed]:w-(--sidebar-rail) data-[collapsible=offcanvas]:data-[state=collapsed]:w-0',
          // Inset, out of sight: the page, a card, keeps the sidebar's gutter from the edge.
          'data-[variant=inset]:data-[collapsible=offcanvas]:data-[state=collapsed]:w-(--control-padding)',
          // An icon rail's edge is the gap's; an offcanvas panel draws its own.
          'data-[collapsible=icon]:bg-sidebar data-[variant=sidebar]:data-[collapsible=icon]:data-[side=end]:border-s data-[variant=sidebar]:data-[collapsible=icon]:data-[side=start]:border-e forced-colors:border-[CanvasText]',
          railVariable,
        )}
      />
      {!icon && !open ? (
        <div
          aria-hidden
          data-slot='sidebar-edge'
          data-side={side}
          className='absolute inset-y-0 z-20 hidden w-2 data-[side=end]:end-(--sidebar-edge-inset,0px) data-[side=start]:start-0 @3xl/sidebar-provider:block'
          style={{
            ['--sidebar-edge-inset' as string]: `${peeking.scrollbar}px`,
          }}
          {...peeking.edge}
        />
      ) : null}
      <div
        ref={panelRef}
        data-slot='sidebar'
        data-state={open ? 'expanded' : 'collapsed'}
        data-side={side}
        data-collapsible={collapsible}
        data-variant={variant}
        data-rail={railed ? '' : undefined}
        data-peek={peek === 'off' ? undefined : peek}
        data-hidden={away ? '' : undefined}
        inert={hidden}
        className={cn(
          'bg-sidebar absolute inset-y-0 z-30 hidden w-(--sidebar-width,16rem) @3xl/sidebar-provider:flex data-[side=end]:end-0 data-[side=start]:start-0',
          railVariable,
          // Icon: as wide as its gap, inside the gap's border, clipped to the moving edge.
          'data-[collapsible=icon]:w-[calc(var(--sidebar-width,16rem)-1px)] data-[collapsible=icon]:data-rail:w-[calc(var(--sidebar-rail)-1px)]',
          'data-[collapsible=icon]:[clip-path:inset(0)] data-[collapsible=icon]:transition-[clip-path] data-[collapsible=icon]:duration-(--motion-layout-duration) data-[collapsible=icon]:ease-(--motion-layout-easing) data-[collapsible=icon]:data-rail:transition-none motion-reduce:data-[collapsible=icon]:transition-none',
          'data-[collapsible=icon]:data-[state=collapsed]:data-[side=start]:[clip-path:inset(0_calc(100%-var(--sidebar-rail)+1px)_0_0)] data-[collapsible=icon]:data-[state=collapsed]:data-[side=end]:[clip-path:inset(0_0_0_calc(100%-var(--sidebar-rail)+1px))]',
          'rtl:data-[collapsible=icon]:data-[state=collapsed]:data-[side=start]:[clip-path:inset(0_0_0_calc(100%-var(--sidebar-rail)+1px))] rtl:data-[collapsible=icon]:data-[state=collapsed]:data-[side=end]:[clip-path:inset(0_calc(100%-var(--sidebar-rail)+1px)_0_0)]',
          // Offcanvas: it draws its own edge, and moves with the page on `layout`; it peeks in on `enter` and away on `exit`. Inset, it draws one only while it peeks over the page.
          'data-[variant=sidebar]:data-[collapsible=offcanvas]:data-[side=end]:border-s data-[variant=sidebar]:data-[collapsible=offcanvas]:data-[side=start]:border-e data-peek:data-[side=end]:border-s data-peek:data-[side=start]:border-e',
          'data-[collapsible=offcanvas]:transition-[box-shadow,translate] data-[collapsible=offcanvas]:duration-(--motion-layout-duration) data-[collapsible=offcanvas]:ease-[var(--motion-layout-fade-easing),var(--motion-layout-easing)] data-[peek=closing]:duration-(--motion-exit-duration) data-[peek=closing]:ease-[var(--motion-exit-fade-easing),var(--motion-exit-easing)] data-[peek=open]:duration-(--motion-enter-duration) data-[peek=open]:ease-[var(--motion-enter-fade-easing),var(--motion-enter-easing)] data-peek:shadow-xl motion-reduce:data-[collapsible=offcanvas]:transition-[box-shadow]',
          'data-hidden:data-[side=end]:translate-x-full data-hidden:data-[side=start]:-translate-x-full rtl:data-hidden:data-[side=end]:-translate-x-full rtl:data-hidden:data-[side=start]:translate-x-full',
          className,
        )}
        {...peeking.panel}
      >
        <SidebarSurface
          id={sheet ? undefined : id}
          collapsed={icon && !open}
          rail={railed}
          aria-label={label}
          {...props}
        >
          {children}
        </SidebarSurface>
      </div>
      <SidebarSheet side={side} label={label}>
        {children}
      </SidebarSheet>
    </>
  )
}

/**
 * An offcanvas sidebar's peek: resting the pointer on the screen's edge for
 * 200ms brings it over the page, and it slides away once the pointer leaves
 * it, unless a menu inside is open or the keyboard is working in it. A pointer
 * back before it has gone turns it round at once. Escape sends it away.
 */
function usePeek({
  enabled,
  peek,
  setPeek,
  panelRef,
  id,
}: {
  enabled: boolean
  peek: Peek
  setPeek: (update: Peek | ((now: Peek) => Peek)) => void
  panelRef: RefObject<HTMLDivElement | null>
  id: string
}) {
  const openTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const closeTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  // The pointer is over the panel: it stays.
  const inside = useRef(false)
  const [scrollbar, setScrollbar] = useState(0)

  const clearTimers = () => {
    clearTimeout(openTimer.current)
    clearTimeout(closeTimer.current)
  }
  const trigger = () =>
    document.querySelector<HTMLElement>(`[aria-controls="${CSS.escape(id)}"]`)

  const close = () => {
    clearTimers()
    const panel = panelRef.current
    if (!panel) return
    if (panel.querySelector('[data-popup-open]') || panel.querySelector(':focus-visible'))
      return
    // A row pressed inside it holds focus, which would fall to the page once it hides.
    if (panel.contains(document.activeElement)) trigger()?.focus({ preventScroll: true })
    setPeek((now) => (now === 'open' ? 'closing' : now))
  }
  const scheduleClose = () => {
    clearTimeout(closeTimer.current)
    closeTimer.current = setTimeout(close, GLIDE_GROUP_CLOSE_DELAY)
  }

  // Once it has slid away, it is gone.
  useEffect(() => {
    const panel = panelRef.current
    if (peek !== 'closing' || !panel) return
    let current = true
    void transitionsSettled(panel, { property: 'translate' }).then(() => {
      if (current) setPeek((now) => (now === 'closing' ? 'off' : now))
    })
    return () => {
      current = false
    }
  }, [peek, panelRef, setPeek])

  // While it peeks: Escape sends it away, and a menu inside that closes with the pointer elsewhere lets it go.
  useEffect(() => {
    const panel = panelRef.current
    if (peek !== 'open' || !panel) return
    const keyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      const focused = panel.contains(document.activeElement)
      setPeek('closing')
      if (focused) trigger()?.focus()
    }
    const menus = new MutationObserver(() => {
      if (!inside.current && !panel.querySelector('[data-popup-open]')) scheduleClose()
    })
    menus.observe(panel, {
      subtree: true,
      attributes: true,
      attributeFilter: ['data-popup-open'],
    })
    document.addEventListener('keydown', keyDown)
    return () => {
      document.removeEventListener('keydown', keyDown)
      menus.disconnect()
    }
  })

  useEffect(() => clearTimers, [])

  // On the end edge, the strip sits inside the page's scrollbar, which stays in reach.
  useLayoutEffect(() => {
    const inset = panelRef.current?.parentElement?.querySelector<HTMLElement>(
      ':scope > [data-slot=sidebar-inset]',
    )
    if (!enabled || !inset) return
    const measure = () => setScrollbar(inset.offsetWidth - inset.clientWidth)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(inset)
    return () => observer.disconnect()
  }, [enabled, panelRef])

  return {
    scrollbar,
    edge: {
      onPointerEnter: (event: ReactPointerEvent<HTMLElement>) => {
        if (!enabled || event.pointerType === 'touch') return
        clearTimeout(closeTimer.current)
        if (peek === 'open') return
        clearTimeout(openTimer.current)
        if (peek === 'closing') setPeek('open')
        else openTimer.current = setTimeout(() => setPeek('open'), HOVER_DELAY)
      },
      onPointerLeave: () => {
        clearTimeout(openTimer.current)
        if (peek === 'open' && !inside.current) scheduleClose()
      },
    },
    panel: {
      onPointerEnter: (event: ReactPointerEvent<HTMLElement>) => {
        if (!enabled || event.pointerType === 'touch') return
        inside.current = true
        clearTimeout(closeTimer.current)
        if (peek === 'closing') setPeek('open')
      },
      onPointerLeave: (event: ReactPointerEvent<HTMLElement>) => {
        if (event.pointerType === 'touch') return
        inside.current = false
        if (enabled && peek === 'open') scheduleClose()
      },
    },
  }
}

/**
 * Opens and closes the sidebar, or the Sheet on a phone. Its tooltip names
 * the shortcut.
 */
function SidebarTrigger({
  className,
  onClick,
  ref,
  ...props
}: ComponentProps<typeof Button>) {
  const { open, sheet, sheetOpen, toggle, id, shortcut } = useSidebar()
  const triggerRef = useMemo(() => mergeRefs(markMounted, ref), [ref])
  const apple = useApplePlatform()
  const expanded = sheet ? sheetOpen : open
  const label = sheet ? 'Open sidebar' : open ? 'Collapse sidebar' : 'Expand sidebar'
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            data-sidebar-trigger=''
            variant='ghost'
            size='icon-sm'
            aria-label={label}
            aria-expanded={expanded}
            aria-controls={id}
            aria-keyshortcuts={shortcut ? ariaShortcut(shortcut, apple) : undefined}
            ref={triggerRef}
            className={cn(
              // The page may load as wide as a phone's, which the provider learns only once it is measured: its expanded look lands at once, never fading on load.
              'text-muted-foreground not-data-mounted:transition-none',
              className,
            )}
            onClick={(event, details) => {
              onClick?.(event, details)
              if (!event.defaultPrevented) toggle()
            }}
            {...props}
          />
        }
      >
        <IconPlaceholder
          lucide='PanelLeftIcon'
          tabler='IconLayoutSidebar'
          hugeicons='SidebarLeftIcon'
          phosphor='SidebarIcon'
          remixicon='RiSideBarLine'
          aria-hidden
          className='rtl:-scale-x-100'
        />
      </TooltipTrigger>
      <TooltipContent>
        {label}
        {shortcut ? (
          <TooltipShortcut>
            <KbdGroup>
              {shortcut.map((key) => (
                <Kbd key={key}>{key}</Kbd>
              ))}
            </KbdGroup>
          </TooltipShortcut>
        ) : null}
      </TooltipContent>
    </Tooltip>
  )
}

export {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSection,
  SidebarMenuSectionTrigger,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
  SidebarTrigger,
  useCloseSheet,
  useSidebar,
  showsSheet,
  type SidebarCollapsible,
  type SidebarSide,
  type SidebarVariant,
}
