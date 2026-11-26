'use client'

import { separatorVariants } from '@/registry/components/kino/separator'
import { IconPlaceholder } from '@/registry/icons/icon-placeholder'
import { highlightClassName, tintedRowTextClassName } from '@/registry/lib/highlight'
import { cva } from 'class-variance-authority'
import type { ComponentProps } from 'react'

import { cn } from '@/lib/utils'

/*
 * What the lists of rows share, the Menu's and every list you pick from
 * (Select, Listbox, Combobox, Command, Tree): the rows, their ticks and
 * headings, and the one highlight that glides between them.
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

/*
 * The gutter a list's rows keep for a tick: the icon's width and the gap, when
 * one of its own rows has a tick with no icon after it (a tick in a row with
 * its own icon, an svg or a `MenuItemIcon`, sits at the row's end). It goes on the element around the
 * rows. CSS takes no `:has()` inside `:has()`, so each case is its own
 * selector. Only rows a few levels down count, so a submenu, which renders inside
 * the list that opened it, keeps a gutter of its own.
 */
const menuGutterClassName =
  '[--menu-gutter:0px] has-[>[data-menu-row]>[data-menu-indicator]:last-child,>[data-menu-row]>[data-menu-indicator]+:not(svg,[data-menu-icon]),>*>[data-menu-row]>[data-menu-indicator]:last-child,>*>[data-menu-row]>[data-menu-indicator]+:not(svg,[data-menu-icon]),>*>*>[data-menu-row]>[data-menu-indicator]:last-child,>*>*>[data-menu-row]>[data-menu-indicator]+:not(svg,[data-menu-icon])]:[--menu-gutter:1.5rem]'

/** A row with no icon of its own lines up with the others' text, past the list's tick gutter. */
const menuInset =
  'not-has-[>:is(svg,[data-menu-icon]):not([data-menu-chevron])]:ps-[calc(var(--control-padding)+var(--menu-gutter,0px))]'

const menuRowVariants = cva(
  // overflow-wrap: anywhere lets a URL or an ID break, so a long label wraps
  // to the next line and is read in full.
  "relative flex min-h-(--control-height-sm) cursor-default items-center gap-2 rounded-(--item-radius) px-(--control-padding) py-1 text-start text-sm [overflow-wrap:anywhere] select-none focus:outline-hidden data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 forced-colors:data-highlighted:text-[HighlightText] forced-colors:data-highlighted:forced-color-adjust-none forced-colors:data-highlighted:**:text-[HighlightText]",
  {
    variants: {
      variant: {
        default:
          '[&>:is(svg,[data-menu-icon])]:text-muted-foreground data-highlighted:text-accent-foreground',
        // A fifth of the foreground takes the text past 4.5:1 on its tint, as on the Button.
        destructive:
          'text-[color-mix(in_oklch,var(--destructive),var(--foreground)_20%)] [&>:is(svg,[data-menu-icon])]:text-current [&_[data-menu-shortcut]]:text-current',
      },
    },
    defaultVariants: { variant: 'default' },
  },
)

/** The tick: it scales in when picked and out when cleared. */
const menuIndicatorClassName =
  'grid place-items-center transition-[opacity,scale] duration-(--motion-enter-duration) ease-(--motion-enter-easing) data-starting-style:scale-50 data-starting-style:opacity-0 data-ending-style:scale-50 data-ending-style:opacity-0 data-ending-style:duration-(--motion-exit-duration) data-ending-style:ease-(--motion-exit-easing) motion-reduce:scale-100 motion-reduce:data-starting-style:scale-100 motion-reduce:data-ending-style:scale-100'

/**
 * The tick of a ui-sdk list's item, kept mounted (`keepMounted`): it scales
 * in when its item is picked (`data-selected`) and out when cleared, turning
 * back from where it is.
 */
const listIndicatorClassName =
  'grid place-items-center opacity-0 transition-[opacity,scale] duration-(--motion-exit-duration) ease-(--motion-exit-easing) motion-safe:scale-50 [&:is([data-selected],[data-checked])]:opacity-100 [&:is([data-selected],[data-checked])]:duration-(--motion-enter-duration) [&:is([data-selected],[data-checked])]:ease-(--motion-enter-easing) motion-safe:[&:is([data-selected],[data-checked])]:scale-100'

/*
 * Where the tick sits: in the gutter, or at the end of the row when
 * the row has an icon of its own, which takes the gutter as on any other row.
 * One line tall, so it sits on the label's first line in a row that holds its
 * items to the top (the Tree's).
 */
const menuIndicatorSlot =
  'grid h-lh w-4 shrink-0 place-items-center group-has-[>:is(svg,[data-menu-icon])]/menu-row:order-last group-has-[>:is(svg,[data-menu-icon])]/menu-row:ms-auto'

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

/** Where a group's heading starts: the rows' text, past any tick's gutter. */
const menuLabelInset =
  'px-(--control-padding) ps-[calc(var(--control-padding)+var(--menu-gutter,0px))]'

/** A group's heading, lined up with the rows' text past any tick's gutter. */
const menuLabelClassName = cn(
  'text-muted-foreground pt-2 pb-1 text-xs font-medium',
  menuLabelInset,
)

/*
 * A line in the box where the rows would be, for a list with nothing to
 * show. Kept mounted, so what it announces is heard, and filled only when it
 * has something to say: until then it takes no room.
 */
const menuNoticeClassName =
  'text-muted-foreground flex items-center justify-center gap-2 px-(--control-padding) text-center text-sm [overflow-wrap:anywhere] not-empty:min-h-20 not-empty:flex-1 not-empty:py-4'

/** The Separator's line between groups of rows, across the list's 4px margin. */
const menuSeparatorClassName = cn(separatorVariants(), '-mx-1 my-1 w-auto')

/** A shortcut at a row's end, such as `Kbd` keys or an aside. */
const menuShortcutClassName =
  // Muted text on the highlight falls under 4.5:1, so it takes the row's colour there.
  'text-muted-foreground in-data-highlighted:text-accent-foreground/80 ms-auto shrink-0 ps-4 text-xs whitespace-nowrap tabular-nums forced-colors:in-data-highlighted:text-[HighlightText]'

/** A shortcut or an aside at the end of a list's row that isn't a menu's, such as a Command's. */
function RowShortcut({ className, children, ...props }: ComponentProps<'span'>) {
  return (
    <span
      data-menu-shortcut=''
      className={cn(menuShortcutClassName, className)}
      {...props}
    >
      {/* Keys read left to right in a right-to-left list too. */}
      <span dir='ltr'>{children}</span>
    </span>
  )
}

export {
  MenuHighlight,
  MenuTick,
  RowShortcut,
  listIndicatorClassName,
  menuIndicatorClassName,
  menuIndicatorSlot,
  menuInset,
  menuGutterClassName,
  menuLabelClassName,
  menuNoticeClassName,
  menuPickedRowClassName,
  menuRowVariants,
  menuSeparatorClassName,
  menuShortcutClassName,
}
