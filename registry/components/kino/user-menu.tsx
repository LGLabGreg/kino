'use client'

import {
  type ThemeCrossover,
  ThemeMenuRadioGroup,
  ThemeSegmentedControl,
} from '@/registry/components/kino/theme-switcher'
import { menuLabelInset } from '@/registry/lib/menu'
import {
  MenuSheet,
  MenuSheetContent,
  MenuSheetGroup,
  MenuSheetItem,
  MenuSheetLabel,
  MenuSheetLinkItem,
  MenuSheetRadioGroup,
  MenuSheetRadioItem,
  MenuSheetSeparator,
  MenuSheetShortcut,
  MenuSheetSub,
  MenuSheetSubContent,
  MenuSheetSubTrigger,
  MenuSheetTrigger,
  useMenuSheet,
} from '@/registry/lib/menu-sheet'
import type { ComponentProps, ReactNode } from 'react'

import { cn } from '@/lib/utils'

/*
 * The signed-in person's menu, behind their avatar: who they are, their
 * account, the workspace they're in, the theme and signing out. Built on the
 * Dropdown menu, so it grows from its trigger and one highlight glides
 * between its rows; on a phone it opens as a bottom sheet (`menu-sheet`).
 *
 * Every choice sits at the top level, one press away: the workspaces as
 * rows with their logos, and the theme as three icons in one row. Submenus,
 * labels and radio groups build any other layout, such as the workspaces
 * and the theme each in a submenu; in the sheet a submenu's rows sit in
 * place under its name.
 */

/** Pass `open` and `onOpenChange` to control it. */
function UserMenu(props: ComponentProps<typeof MenuSheet>) {
  return <MenuSheet {...props} />
}

/** What opens it, such as an avatar in a ghost Button or a Sidebar's row, through `render`. */
function UserMenuTrigger(props: ComponentProps<typeof MenuSheetTrigger>) {
  return <MenuSheetTrigger data-slot='user-menu-trigger' {...props} />
}

/** It opens under the trigger's end edge; `title` names the sheet on a phone. */
function UserMenuContent({
  title = 'Account',
  align = 'end',
  className,
  style,
  ...props
}: Omit<ComponentProps<typeof MenuSheetContent>, 'title'> & {
  title?: string
}) {
  return (
    <MenuSheetContent
      data-slot='user-menu-content'
      title={title}
      align={align}
      // Who they are, their workspaces and the theme hold more than a menu's 24rem.
      style={(state) => ({
        '--menu-max-height': '36rem',
        ...(typeof style === 'function' ? style(state) : style),
      })}
      className={cn('min-w-60', className)}
      {...props}
    />
  )
}

/** Who is signed in: their avatar, their name, which names the group, and their email. */
function UserMenuHeader({
  name,
  email,
  avatar,
  className,
}: {
  name: ReactNode
  email?: ReactNode
  /** Their Avatar, at `sm`. */
  avatar?: ReactNode
  className?: string
}) {
  return (
    <MenuSheetGroup
      data-slot='user-menu-header'
      className={cn(
        'flex flex-row items-center gap-2.5 px-(--control-padding) py-2',
        className,
      )}
    >
      {avatar}
      <span className='flex min-w-0 flex-1 flex-col'>
        {/* A long name or email wraps, so the whole of it shows. */}
        <MenuSheetLabel className='text-foreground p-0 text-sm font-medium wrap-break-word group-has-[[data-menu-indicator]]/menu:ps-0'>
          {name}
        </MenuSheetLabel>
        {email ? (
          <span className='text-muted-foreground text-xs wrap-anywhere'>{email}</span>
        ) : null}
      </span>
    </MenuSheetGroup>
  )
}

/**
 * The workspaces under a heading, the one they're in marked. Switching
 * workspace changes the page, so a pick closes the menu. `label={null}`
 * leaves the heading out, as in a submenu, with an `aria-label` in its place.
 */
function UserMenuWorkspaces<Value extends string>({
  label = 'Workspaces',
  children,
  ...props
}: Omit<ComponentProps<typeof MenuSheetRadioGroup<Value>>, 'children'> & {
  label?: ReactNode
  children: ReactNode
}) {
  return (
    <MenuSheetRadioGroup<Value> data-slot='user-menu-workspaces' closeOnClick {...props}>
      {label === null ? null : (
        // At the start, over the logos, as the theme's heading is: not past a tick's gutter, since its rows have none.
        <MenuSheetLabel className='group-has-[[data-menu-indicator]]/menu:ps-(--control-padding)'>
          {label}
        </MenuSheetLabel>
      )}
      {children}
    </MenuSheetRadioGroup>
  )
}

/** One workspace: its logo, its name, and a line such as its plan. */
function UserMenuWorkspace({
  logo,
  description,
  children,
  ...props
}: Omit<ComponentProps<typeof MenuSheetRadioItem>, 'children'> & {
  /** Its logo, sized to the row's icons. */
  logo?: ReactNode
  /** Read after the name, such as "Team plan". */
  description?: ReactNode
  children: ReactNode
}) {
  return (
    <MenuSheetRadioItem data-slot='user-menu-workspace' {...props}>
      {logo}
      {/* Whole, never cut short: the menu is where a long name is read in full. */}
      <span className='min-w-0 flex-1 break-words'>{children}</span>
      {description ? (
        <span className='text-muted-foreground in-data-highlighted:text-accent-foreground/80 shrink-0 text-xs'>
          {description}
        </span>
      ) : null}
    </MenuSheetRadioItem>
  )
}

/**
 * System, light and dark. In the menu: one row, the three as icons beside
 * `label`, or with `inline={false}` three rows, for a submenu. In the sheet:
 * a Segmented control.
 */
function UserMenuTheme({
  label = 'Theme',
  inline = true,
  crossover = 'fade',
}: {
  /** Names the choice: beside the icons, or for a screen reader. */
  label?: string
  /** One row of icons; `false` for three rows with their names. */
  inline?: boolean
  /** How the page crosses over to the new theme. */
  crossover?: ThemeCrossover
}) {
  const { sheet } = useMenuSheet()
  if (sheet) {
    const control = (
      <ThemeSegmentedControl iconOnly aria-label={label} crossover={crossover} />
    )
    if (!inline) {
      // Under a submenu's heading, lined up with its text past any tick's gutter.
      return <div className={cn(menuLabelInset, 'py-1.5')}>{control}</div>
    }
    return (
      <div className='flex items-center gap-3 py-1.5 ps-(--control-padding)'>
        <span className='min-w-0 flex-1 text-sm'>{label}</span>
        {control}
      </div>
    )
  }
  if (!inline) {
    return <ThemeMenuRadioGroup label={null} aria-label={label} crossover={crossover} />
  }
  return <ThemeMenuRadioGroup inline label={label} crossover={crossover} />
}

function UserMenuGroup(props: ComponentProps<typeof MenuSheetGroup>) {
  return <MenuSheetGroup data-slot='user-menu-group' {...props} />
}

function UserMenuItem(props: ComponentProps<typeof MenuSheetItem>) {
  return <MenuSheetItem data-slot='user-menu-item' {...props} />
}

function UserMenuLinkItem(props: ComponentProps<typeof MenuSheetLinkItem>) {
  return <MenuSheetLinkItem data-slot='user-menu-link-item' {...props} />
}

/** A group's heading, which names it. */
function UserMenuLabel(props: ComponentProps<typeof MenuSheetLabel>) {
  return <MenuSheetLabel data-slot='user-menu-label' {...props} />
}

/** One choice of several of your own, such as a status, under a `UserMenuLabel`. */
function UserMenuRadioGroup<Value>(
  props: ComponentProps<typeof MenuSheetRadioGroup<Value>>,
) {
  return <MenuSheetRadioGroup<Value> data-slot='user-menu-radio-group' {...props} />
}

function UserMenuRadioItem(props: ComponentProps<typeof MenuSheetRadioItem>) {
  return <MenuSheetRadioItem data-slot='user-menu-radio-item' {...props} />
}

/** A row that opens more rows beside it; in the sheet they sit in place under its name. */
function UserMenuSub(props: ComponentProps<typeof MenuSheetSub>) {
  return <MenuSheetSub {...props} />
}

/**
 * The row that opens a submenu, such as one that names the workspace
 * they're in. In the sheet it is the heading of the rows under it,
 * reading `sheetLabel`.
 */
function UserMenuSubTrigger(props: ComponentProps<typeof MenuSheetSubTrigger>) {
  return <MenuSheetSubTrigger data-slot='user-menu-sub-trigger' {...props} />
}

function UserMenuSubContent(props: ComponentProps<typeof MenuSheetSubContent>) {
  return <MenuSheetSubContent data-slot='user-menu-sub-content' {...props} />
}

function UserMenuSeparator(props: ComponentProps<typeof MenuSheetSeparator>) {
  return <MenuSheetSeparator data-slot='user-menu-separator' {...props} />
}

function UserMenuShortcut(props: ComponentProps<typeof MenuSheetShortcut>) {
  return <MenuSheetShortcut data-slot='user-menu-shortcut' {...props} />
}

export {
  UserMenu,
  UserMenuContent,
  UserMenuGroup,
  UserMenuHeader,
  UserMenuItem,
  UserMenuLabel,
  UserMenuLinkItem,
  UserMenuRadioGroup,
  UserMenuRadioItem,
  UserMenuSeparator,
  UserMenuShortcut,
  UserMenuSub,
  UserMenuSubContent,
  UserMenuSubTrigger,
  UserMenuTheme,
  UserMenuTrigger,
  UserMenuWorkspace,
  UserMenuWorkspaces,
}
