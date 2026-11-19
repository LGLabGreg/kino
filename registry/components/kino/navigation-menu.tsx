'use client'

import { IconPlaceholder } from '@/registry/icons/icon-placeholder'
import {
  GLIDE_GROUP_CLOSE_DELAY,
  GlideContent,
  GlideGroupMemory,
  type GlideInstant,
  glidePopupClassName,
  GlideSurface,
} from '@/registry/lib/glide'
import {
  followPick,
  followPointer,
  highlightClassName,
  itemMatching,
  pickClassName,
  rowTintClassName,
} from '@/registry/lib/highlight'
import { popupPositionerProps, usePopupGrow } from '@/registry/lib/popup'
import { mergeRefs } from '@/registry/lib/refs'
import { edgeFadeClassName, useEdgeFades } from '@/registry/lib/scroll'
import { NavigationMenu as NavigationMenuPrimitive } from '@base-ui/react/navigation-menu'
import {
  createContext,
  type RefObject,
  use,
  useCallback,
  useMemo,
  useRef,
  useState,
} from 'react'

import { cn } from '@/lib/utils'

/*
 * A site header's menu: its triggers share one panel, which grows out of the
 * trigger, travels to the next one and resizes as the pointer moves along, and
 * folds back in on close. New content slides in from the side the pointer
 * moved towards. A highlight glides between the triggers, and another between
 * the links inside the panel. The link to the page you are on keeps a tint,
 * which travels to the next one you go to.
 */

/** Base UI's own wait: a click this soon after a hover opened the panel keeps it open. */
const PATIENT_CLICK_MS = 500

/** When a hover last moved the panel to a trigger, from `performance.now()`. */
const HoveredAtContext = createContext<RefObject<number> | null>(null)

/*
 * The highlight's layer, in the list or a panel: `as` is `li` inside the
 * list, so the list holds only list items. It goes to the item under the
 * pointer or with visible focus, else to the `current` one.
 */
function Highlight({
  items,
  current,
  as: Element = 'span',
}: {
  items: string
  current?: string
  as?: 'span' | 'li'
}) {
  const track = useCallback(
    (layer: HTMLElement | null) => {
      const area = layer?.parentElement
      if (!layer || !area) return
      return followPointer(area, layer, {
        itemOf: itemMatching(area, items),
        current,
        focus: true,
      })
    },
    [items, current],
  )
  return (
    <Element
      ref={track}
      aria-hidden
      data-slot='navigation-menu-highlight'
      className={cn(
        highlightClassName,
        'bg-muted -z-10 list-none forced-colors:bg-[Highlight] forced-colors:forced-color-adjust-none',
      )}
    />
  )
}

/*
 * The tint under the link to the page you are on, as the Sidebar marks its
 * current page: over the highlight, so the two add up when the pointer is on
 * it, and it moves on `morph`, as the Tabs' pill does. Forced colours
 * underline the link instead, since the highlight takes the system's colour.
 */
function Current({ items }: { items: string }) {
  const track = useCallback(
    (layer: HTMLLIElement | null) => {
      const area = layer?.parentElement
      if (!layer || !area) return
      return followPick(area, layer, {
        picked: () => area.querySelector<HTMLElement>(items),
        attributes: ['data-active'],
      })
    },
    [items],
  )
  return (
    <li
      ref={track}
      aria-hidden
      data-slot='navigation-menu-current'
      className={cn(
        pickClassName,
        rowTintClassName,
        '-z-10 list-none forced-colors:hidden',
      )}
    />
  )
}

/**
 * The menu and its one panel. Every prop goes to Base UI's Root. New content
 * slides in from the side the pointer moved towards, by
 * `--navigation-menu-slide` (28px by default).
 */
function NavigationMenu({
  className,
  children,
  closeDelay = GLIDE_GROUP_CLOSE_DELAY,
  onValueChange,
  ...props
}: Omit<NavigationMenuPrimitive.Root.Props, 'className'> & { className?: string }) {
  // Base UI marks every new positioner `data-instant` for a frame, but only
  // a panel open on first paint should skip the grow.
  const [instant] = useState<GlideInstant>(() => {
    let openOnMount = (props.value ?? props.defaultValue ?? null) !== null
    const instant: GlideInstant = ({ positioner, first }) => {
      const now = positioner.hasAttribute('data-instant')
      if (!first) return now
      const skip = now && openOnMount
      openOnMount = false
      return skip
    }
    return instant
  })
  const hoveredAt = useRef(0)
  const { dir, anchor } = usePopupGrow()
  return (
    <HoveredAtContext value={hoveredAt}>
      <GlideGroupMemory>
        <NavigationMenuPrimitive.Root
          data-slot='navigation-menu'
          closeDelay={closeDelay}
          onValueChange={(value, details) => {
            if (value != null && details.reason === 'trigger-hover') {
              hoveredAt.current = performance.now()
            }
            onValueChange?.(value, details)
          }}
          className={cn('relative flex max-w-max items-center', className)}
          {...props}
        >
          {children}
          <NavigationMenuPrimitive.Portal>
            <NavigationMenuPrimitive.Positioner
              {...popupPositionerProps}
              side='bottom'
              align='center'
              sideOffset={8}
              // A tall panel stays below the header and scrolls, rather than
              // flipping over the page above it.
              collisionAvoidance={{ side: 'none' }}
              positionMethod='fixed'
            >
              <NavigationMenuPrimitive.Popup
                data-slot='navigation-menu-popup'
                // Portalled out of the page's tree, so it takes the reading direction with it.
                dir={dir}
                className={cn(
                  glidePopupClassName,
                  'text-popover-foreground max-w-(--available-width) text-sm outline-hidden [--glide-radius:var(--surface-radius)] data-ending-style:delay-[calc(var(--motion-exit-duration)*0.35)]',
                )}
              >
                <GlideSurface
                  fill='bg-popover forced-colors:bg-[Canvas]'
                  ring='bg-foreground/10 forced-colors:bg-[CanvasText]'
                  shadow
                />
                {/* Opened again soon after it folded, it grows from where it went. */}
                <GlideContent reopen='grow' instant={instant}>
                  <NavigationMenuPrimitive.Viewport className='relative' />
                </GlideContent>
                <NavigationMenuPrimitive.Arrow {...anchor} />
              </NavigationMenuPrimitive.Popup>
            </NavigationMenuPrimitive.Positioner>
          </NavigationMenuPrimitive.Portal>
        </NavigationMenuPrimitive.Root>
      </GlideGroupMemory>
    </HoveredAtContext>
  )
}

/**
 * The row of triggers and links, with one highlight that glides along it, and
 * a tint under the link marked `active`.
 */
function NavigationMenuList({
  className,
  children,
  ...props
}: Omit<NavigationMenuPrimitive.List.Props, 'className'> & { className?: string }) {
  return (
    <NavigationMenuPrimitive.List
      data-slot='navigation-menu-list'
      className={cn('relative isolate flex list-none items-center gap-0.5', className)}
      {...props}
    >
      <Highlight
        as='li'
        items='[data-slot=navigation-menu-trigger],[data-slot=navigation-menu-link]'
        current='[data-slot=navigation-menu-trigger][data-popup-open]'
      />
      <Current items='[data-slot=navigation-menu-link][data-active]' />
      {children}
    </NavigationMenuPrimitive.List>
  )
}

function NavigationMenuItem({
  className,
  ...props
}: Omit<NavigationMenuPrimitive.Item.Props, 'className'> & { className?: string }) {
  return (
    <NavigationMenuPrimitive.Item
      data-slot='navigation-menu-item'
      className={cn('relative', className)}
      {...props}
    />
  )
}

const listItemClassName =
  'focus-visible:ring-ring/50 relative flex h-(--control-height) items-center gap-1 rounded-(--control-radius) px-(--control-padding) text-sm font-medium whitespace-nowrap select-none focus-visible:ring-3 focus-visible:outline-hidden data-disabled:pointer-events-none data-disabled:opacity-50 forced-colors:data-active:underline forced-colors:data-active:underline-offset-4 forced-colors:data-glided:text-[HighlightText] forced-colors:data-glided:forced-color-adjust-none forced-colors:data-glided:**:text-[HighlightText]'

function NavigationMenuTrigger({
  className,
  children,
  onClick,
  ...props
}: Omit<NavigationMenuPrimitive.Trigger.Props, 'className'> & { className?: string }) {
  const hoveredAt = use(HoveredAtContext)
  return (
    <NavigationMenuPrimitive.Trigger
      data-slot='navigation-menu-trigger'
      className={cn(listItemClassName, className)}
      onClick={(event) => {
        // Base UI keeps a panel open on a click just after a hover opened it,
        // but not after a hover moved it here from another trigger.
        const moved = hoveredAt ? performance.now() - hoveredAt.current : Infinity
        if (
          event.currentTarget.getAttribute('aria-expanded') === 'true' &&
          moved < PATIENT_CLICK_MS
        ) {
          event.preventBaseUIHandler()
        }
        onClick?.(event)
      }}
      {...props}
    >
      {children}
      <NavigationMenuPrimitive.Icon className="text-muted-foreground transition-transform duration-(--motion-layout-duration) ease-(--motion-layout-easing) data-popup-open:rotate-180 motion-reduce:transition-none [&_svg:not([class*='size-'])]:size-3.5">
        <IconPlaceholder
          lucide='ChevronDownIcon'
          tabler='IconChevronDown'
          hugeicons='ArrowDown01Icon'
          phosphor='CaretDownIcon'
          remixicon='RiArrowDownSLine'
          aria-hidden
        />
      </NavigationMenuPrimitive.Icon>
    </NavigationMenuPrimitive.Trigger>
  )
}

const InPanelContext = createContext(false)

/**
 * A trigger's panel. New content slides in from the side the pointer moved
 * towards while the old leaves the other way, faster; on the first open and
 * on close it only fades. A panel taller than the space below scrolls.
 * `className` goes to the panel's layout inside; every other prop goes to
 * Base UI's Content.
 */
function NavigationMenuContent({
  className,
  children,
  ref,
  ...props
}: Omit<NavigationMenuPrimitive.Content.Props, 'className'> & { className?: string }) {
  const fades = useEdgeFades<HTMLDivElement>()
  const refs = useMemo(() => mergeRefs(fades, ref), [fades, ref])
  return (
    <NavigationMenuPrimitive.Content
      ref={refs}
      data-slot='navigation-menu-content'
      className={cn(
        'scrollbar-thin max-h-(--available-height) overflow-y-auto overscroll-contain',
        edgeFadeClassName,
        'transition-[opacity,translate] duration-(--motion-layout-duration) ease-(--motion-layout-easing) group-data-[glide=open]/popup:data-open:delay-[calc(var(--motion-morph-duration)*0.15)] motion-reduce:transition-opacity',
        'data-starting-style:opacity-0 data-ending-style:opacity-0 data-ending-style:duration-[calc(var(--motion-exit-duration)*0.5)] data-ending-style:ease-(--motion-exit-easing)',
        'data-[activation-direction=right]:data-starting-style:translate-x-(--navigation-menu-slide,28px) data-[activation-direction=left]:data-starting-style:-translate-x-(--navigation-menu-slide,28px)',
        'data-[activation-direction=right]:data-ending-style:-translate-x-(--navigation-menu-slide,28px) data-[activation-direction=left]:data-ending-style:translate-x-(--navigation-menu-slide,28px)',
        // Base UI pins the leaving content to the left; in RTL it belongs on the right.
        'rtl:data-ending-style:right-0! rtl:data-ending-style:left-auto!',
      )}
      {...props}
    >
      <InPanelContext value>
        {/* The 8px around the links is the highlight's margin, so it stays the same at every density. */}
        <div
          data-slot='navigation-menu-panel'
          className={cn('relative isolate w-72 max-w-full p-2', className)}
        >
          <Highlight items='[data-slot=navigation-menu-link]' />
          {children}
        </div>
      </InPanelContext>
    </NavigationMenuPrimitive.Content>
  )
}

/**
 * A link: in the list, styled as a trigger; in a panel, a block the highlight
 * glides to, whose icons brighten as it arrives. Inside a panel it closes the
 * menu when followed.
 */
function NavigationMenuLink({
  className,
  closeOnClick,
  ...props
}: Omit<NavigationMenuPrimitive.Link.Props, 'className'> & { className?: string }) {
  const inPanel = use(InPanelContext)
  return (
    <NavigationMenuPrimitive.Link
      data-slot='navigation-menu-link'
      closeOnClick={closeOnClick ?? inPanel}
      className={cn(
        inPanel
          ? "focus-visible:ring-ring/50 flex min-w-0 flex-col gap-1 rounded-(--list-radius) p-(--control-padding) focus-visible:ring-3 focus-visible:outline-hidden forced-colors:data-glided:text-[HighlightText] forced-colors:data-glided:forced-color-adjust-none forced-colors:data-glided:**:text-[HighlightText] [&_svg]:transition-colors [&_svg]:duration-(--motion-layout-duration) [&_svg]:ease-(--motion-layout-fade-easing) [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-muted-foreground data-glided:[&_svg:not([class*='text-'])]:text-foreground [&_.text-muted-foreground]:transition-colors [&_.text-muted-foreground]:duration-(--motion-layout-duration) [&_.text-muted-foreground]:ease-(--motion-layout-fade-easing) data-glided:[&_.text-muted-foreground]:text-foreground/80 forced-colors:data-glided:[&_.text-muted-foreground]:text-[HighlightText]"
          : listItemClassName,
        className,
      )}
      {...props}
    />
  )
}

export {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  NavigationMenuTrigger,
}
