'use client'

import { separatorVariants } from '@/registry/components/kino/separator'
import { IconPlaceholder } from '@/registry/icons/icon-placeholder'
import {
  followRows,
  highlightClassName,
  tintedRowTextClassName,
} from '@/registry/lib/highlight'
import {
  popupGrowClassName,
  popupGrowContentClassName,
  popupPositionerProps,
  popupSurfaceClassName,
  usePopupGrow,
} from '@/registry/lib/popup'
import { edgeFadeClassName, useEdgeFades } from '@/registry/lib/scroll'
import { Menu as MenuPrimitive } from '@base-ui/react/menu'
import { cva, type VariantProps } from 'class-variance-authority'
import { type ComponentProps, useEffect, useRef } from 'react'

import { cn } from '@/lib/utils'

/*
 * The parts Dropdown menu, Context menu, Menubar and Select share: the box,
 * which grows out of what opened it, its rows, and the one highlight that
 * glides between them.
 */

/**
 * The highlight behind the rows: the accent, a tint behind a destructive
 * row, and the system's own colour under forced colours. Its parent is the
 * list of rows; track it with `followRows`.
 */
function MenuHighlight({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      aria-hidden
      data-slot='menu-highlight'
      className={cn(
        highlightClassName,
        'bg-accent data-[variant=destructive]:bg-destructive/10 dark:data-[variant=destructive]:bg-destructive/20 forced-colors:bg-[Highlight]! forced-colors:forced-color-adjust-none',
        className,
      )}
      {...props}
    />
  )
}

/**
 * The box: it grows out of what opened it and folds back into it, and holds
 * the highlight. Every prop goes to Base UI's Popup but `className`, which
 * goes to the list inside. A list taller than the screen, or than
 * `--menu-max-height` (24rem unless a menu that holds more sets it),
 * scrolls.
 */
function MenuPopup({
  className,
  children,
  style,
  ...props
}: Omit<MenuPrimitive.Popup.Props, 'className'> & { className?: string }) {
  const { dir, style: growStyle, anchor } = usePopupGrow()
  const listRef = useRef<HTMLDivElement>(null)
  const layerRef = useRef<HTMLDivElement>(null)
  const fades = useEdgeFades<HTMLDivElement>()
  useEffect(() => {
    const list = listRef.current
    const popup = list?.parentElement?.parentElement
    if (!list || !popup || !layerRef.current) return
    return followRows(list, layerRef.current, { popup })
  }, [])
  return (
    <MenuPrimitive.Popup
      // Portalled out of the page's tree, so it takes the reading direction with it.
      dir={dir}
      style={(state) => ({
        ...growStyle(state),
        ...(typeof style === 'function' ? style(state) : style),
      })}
      className={cn(
        // A long menu stops at 24rem, so it never fills a tall screen.
        'group/popup relative flex max-h-[min(var(--available-height),var(--menu-max-height,24rem))] flex-col rounded-(--list-radius) text-sm',
        popupSurfaceClassName,
        popupGrowClassName,
      )}
      {...props}
    >
      {/* The rows scroll inside the surface, so their fading edges leave its shadow, ring and outline whole. */}
      <div
        ref={fades}
        data-slot='menu-scroller'
        className={cn(
          'scrollbar-thin min-h-0 flex-1 overflow-y-auto overscroll-contain rounded-[inherit]',
          edgeFadeClassName,
        )}
      >
        <div
          ref={listRef}
          data-slot='menu-list'
          className={cn(
            // The 4px around the rows is the highlight's margin, not a surface's
            // padding, so it stays the same at every density. The width follows
            // the longest row, between 12rem and 20rem.
            'group/menu relative flex max-w-[min(20rem,var(--available-width))] min-w-48 flex-col p-1',
            popupGrowContentClassName,
            className,
          )}
        >
          <MenuHighlight ref={layerRef} />
          {children}
        </div>
      </div>
      <MenuPrimitive.Arrow {...anchor} />
    </MenuPrimitive.Popup>
  )
}

/** Portal, positioner and box, for a menu opened by a trigger. */
function MenuContent({
  side = 'bottom',
  align = 'start',
  sideOffset = 6,
  alignOffset = 0,
  ...props
}: ComponentProps<typeof MenuPopup> &
  Pick<MenuPrimitive.Positioner.Props, 'side' | 'align' | 'sideOffset' | 'alignOffset'>) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Positioner
        {...popupPositionerProps}
        side={side}
        align={align}
        sideOffset={sideOffset}
        alignOffset={alignOffset}
      >
        <MenuPopup {...props} />
      </MenuPrimitive.Positioner>
    </MenuPrimitive.Portal>
  )
}

/*
 * A row with no icon of its own lines up with the others' text when the menu
 * has a tick: the gutter is the icon's width and the gap.
 */
const menuInset =
  'group-has-[[data-menu-indicator]]/menu:not-has-[>svg:not([data-menu-chevron])]:ps-[calc(var(--control-padding)+1.5rem)]'

const menuRowVariants = cva(
  // overflow-wrap: anywhere lets a URL or an ID break, so a long label wraps
  // to the next line and is read in full.
  "relative flex min-h-(--control-height-sm) cursor-default items-center gap-2 rounded-(--item-radius) px-(--control-padding) py-1 text-start text-sm [overflow-wrap:anywhere] select-none focus:outline-hidden data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 forced-colors:data-highlighted:text-[HighlightText] forced-colors:data-highlighted:forced-color-adjust-none forced-colors:data-highlighted:**:text-[HighlightText]",
  {
    variants: {
      variant: {
        default: '[&>svg]:text-muted-foreground data-highlighted:text-accent-foreground',
        // A fifth of the foreground takes the text past 4.5:1 on its tint, as on the Button.
        destructive:
          'text-[color-mix(in_oklch,var(--destructive),var(--foreground)_20%)] [&>svg]:text-current [&_[data-menu-shortcut]]:text-current',
      },
    },
    defaultVariants: { variant: 'default' },
  },
)

function MenuItem({
  className,
  variant = 'default',
  ...props
}: Omit<MenuPrimitive.Item.Props & VariantProps<typeof menuRowVariants>, 'className'> & {
  className?: string
}) {
  return (
    <MenuPrimitive.Item
      data-menu-row=''
      data-variant={variant}
      className={cn(menuRowVariants({ variant }), menuInset, className)}
      {...props}
    />
  )
}

/** A row that navigates: an `<a>` with every row's look and keys. */
function MenuLinkItem({
  className,
  variant = 'default',
  // Base UI keeps the menu open after a link; every other item that acts closes it.
  closeOnClick = true,
  ...props
}: Omit<
  MenuPrimitive.LinkItem.Props & VariantProps<typeof menuRowVariants>,
  'className'
> & { className?: string }) {
  return (
    <MenuPrimitive.LinkItem
      closeOnClick={closeOnClick}
      data-menu-row=''
      data-variant={variant}
      className={cn(menuRowVariants({ variant }), menuInset, className)}
      {...props}
    />
  )
}

/** The tick: it scales in when picked and out when cleared. */
const menuIndicatorClassName =
  'grid place-items-center transition-[opacity,scale] duration-(--motion-enter-duration) ease-(--motion-enter-easing) data-starting-style:scale-50 data-starting-style:opacity-0 data-ending-style:scale-50 data-ending-style:opacity-0 data-ending-style:duration-(--motion-exit-duration) data-ending-style:ease-(--motion-exit-easing) motion-reduce:scale-100 motion-reduce:data-starting-style:scale-100 motion-reduce:data-ending-style:scale-100'

/*
 * Where the tick sits: in the gutter, or at the end of the row when
 * the row has an icon of its own, which takes the gutter as on any other row.
 * One line tall, so it sits on the label's first line in a row that holds its
 * items to the top (the Tree's).
 */
const menuIndicatorSlot =
  'grid h-lh w-4 shrink-0 place-items-center group-has-[>svg]/menu-row:order-last group-has-[>svg]/menu-row:ms-auto'

/** The tick of a picked row. */
function MenuTick() {
  return (
    <IconPlaceholder
      lucide='CheckIcon'
      tabler='IconCheck'
      hugeicons='Tick02Icon'
      phosphor='CheckIcon'
      remixicon='RiCheckLine'
      aria-hidden
      className='text-foreground forced-colors:text-current'
    />
  )
}

function MenuCheckboxItem({
  className,
  children,
  ...props
}: Omit<MenuPrimitive.CheckboxItem.Props, 'className'> & {
  className?: string
}) {
  return (
    <MenuPrimitive.CheckboxItem
      data-menu-row=''
      className={cn(menuRowVariants(), 'group/menu-row', className)}
      {...props}
    >
      <span data-menu-indicator='' className={menuIndicatorSlot}>
        <MenuPrimitive.CheckboxItemIndicator className={menuIndicatorClassName}>
          <MenuTick />
        </MenuPrimitive.CheckboxItemIndicator>
      </span>
      {children}
    </MenuPrimitive.CheckboxItem>
  )
}

/**
 * The picked row of a radio group: a tint a step deeper than the highlight's,
 * so the two never read as one, and a medium label, so it shows by more than
 * colour (its muted asides, such as a shortcut, stay regular). No mark beside it keeps a gap on every other row. Under forced
 * colours, where the highlight takes the system's colour, it is outlined.
 */
const menuPickedRowClassName = cn(
  tintedRowTextClassName,
  'aria-checked:bg-foreground/7 aria-[current=true]:bg-foreground/7 dark:aria-checked:bg-foreground/10 dark:aria-[current=true]:bg-foreground/10',
  'aria-checked:font-medium aria-[current=true]:font-medium aria-checked:[&_.text-muted-foreground]:font-normal aria-[current=true]:[&_.text-muted-foreground]:font-normal',
  'forced-colors:aria-checked:outline-1 forced-colors:aria-checked:-outline-offset-1 forced-colors:aria-checked:outline-[CanvasText] forced-colors:aria-[current=true]:outline-1 forced-colors:aria-[current=true]:-outline-offset-1 forced-colors:aria-[current=true]:outline-[CanvasText]',
  'transition-[background-color] duration-(--motion-press-duration) ease-(--motion-press-fade-easing)',
)

function MenuRadioItem({
  className,
  ...props
}: Omit<MenuPrimitive.RadioItem.Props, 'className'> & { className?: string }) {
  return (
    <MenuPrimitive.RadioItem
      data-menu-row=''
      className={cn(
        menuRowVariants(),
        'group/menu-row',
        menuInset,
        menuPickedRowClassName,
        className,
      )}
      {...props}
    />
  )
}

/** Where a group's heading starts: the rows' text, past any tick's gutter. */
const menuLabelInset =
  'px-(--control-padding) group-has-[[data-menu-indicator]]/menu:ps-[calc(var(--control-padding)+1.5rem)]'

/** A group's heading, lined up with the rows' text past any tick's gutter. */
const menuLabelClassName = cn(
  'text-muted-foreground pt-2 pb-1 text-xs font-medium',
  menuLabelInset,
)

function MenuLabel({
  className,
  ...props
}: Omit<MenuPrimitive.GroupLabel.Props, 'className'> & { className?: string }) {
  return (
    <MenuPrimitive.GroupLabel className={cn(menuLabelClassName, className)} {...props} />
  )
}

/*
 * A line in the box where the rows would be, for a list with nothing to
 * show. Kept mounted, so what it announces is heard, and filled only when it
 * has something to say: until then it takes no room.
 */
const menuNoticeClassName =
  'text-muted-foreground flex items-center justify-center gap-2 px-(--control-padding) text-center text-sm [overflow-wrap:anywhere] not-empty:min-h-20 not-empty:flex-1 not-empty:py-4'

/** The Separator's line between groups of rows, across the list's 4px margin. */
const menuSeparatorClassName = cn(separatorVariants(), '-mx-1 my-1 w-auto')

function MenuSeparator({
  className,
  ...props
}: Omit<MenuPrimitive.Separator.Props, 'className'> & {
  className?: string
}) {
  return (
    <MenuPrimitive.Separator
      className={cn(menuSeparatorClassName, className)}
      {...props}
    />
  )
}

function MenuShortcut({ className, children, ...props }: ComponentProps<'span'>) {
  return (
    <span
      data-menu-shortcut=''
      className={cn(
        // Muted text on the highlight falls under 4.5:1, so it takes the row's colour there.
        'text-muted-foreground in-data-highlighted:text-accent-foreground/80 ms-auto shrink-0 ps-4 text-xs whitespace-nowrap tabular-nums forced-colors:in-data-highlighted:text-[HighlightText]',
        className,
      )}
      {...props}
    >
      {/* Keys read left to right in a right-to-left menu too. */}
      <span dir='ltr'>{children}</span>
    </span>
  )
}

function MenuSubTrigger({
  className,
  children,
  ...props
}: Omit<MenuPrimitive.SubmenuTrigger.Props, 'className'> & {
  className?: string
}) {
  return (
    <MenuPrimitive.SubmenuTrigger
      data-menu-row=''
      data-variant='default'
      className={cn(menuRowVariants(), menuInset, className)}
      {...props}
    >
      {children}
      <IconPlaceholder
        lucide='ChevronRightIcon'
        tabler='IconChevronRight'
        hugeicons='ArrowRight01Icon'
        phosphor='CaretRightIcon'
        remixicon='RiArrowRightSLine'
        data-menu-chevron=''
        aria-hidden
        className='text-muted-foreground ms-auto rtl:-scale-x-100'
      />
    </MenuPrimitive.SubmenuTrigger>
  )
}

/** A submenu's box: beside its item, with its first row level with it. */
function MenuSubContent({
  sideOffset = 2,
  // The list's 4px and the ring's 1px, so the first row sits level with the item.
  alignOffset = -5,
  ...props
}: ComponentProps<typeof MenuPopup> &
  Pick<MenuPrimitive.Positioner.Props, 'sideOffset' | 'alignOffset'>) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Positioner
        {...popupPositionerProps}
        side='inline-end'
        align='start'
        sideOffset={sideOffset}
        alignOffset={alignOffset}
      >
        <MenuPopup {...props} />
      </MenuPrimitive.Positioner>
    </MenuPrimitive.Portal>
  )
}

export {
  MenuCheckboxItem,
  MenuContent,
  MenuHighlight,
  MenuItem,
  MenuLabel,
  MenuLinkItem,
  MenuPopup,
  MenuRadioItem,
  MenuSeparator,
  MenuShortcut,
  MenuSubContent,
  MenuSubTrigger,
  MenuTick,
  menuIndicatorClassName,
  menuIndicatorSlot,
  menuInset,
  menuLabelClassName,
  menuLabelInset,
  menuNoticeClassName,
  menuPickedRowClassName,
  menuRowVariants,
  menuSeparatorClassName,
}
