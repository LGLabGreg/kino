'use client'

import {
  Menu,
  MenuContent,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuItemIcon,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuSub,
  MenuSubContent,
  MenuSubTrigger,
  MenuTrigger,
} from '@/registry/components/kino/menu'
import {
  type ThemeCrossover,
  ThemeMenuRadioGroup,
} from '@/registry/components/kino/theme-switcher'
import type { ComponentProps, CSSProperties, ReactNode } from 'react'

import { cn } from '@/lib/utils'

/*
 * The signed-in person's menu, behind their avatar: who they are, their
 * account, the workspace they're in, the theme and signing out. Built on the
 * Menu, so it grows from its trigger and one highlight glides between its
 * rows; on a phone it opens as a bottom sheet (`presentation='auto'`), where
 * a submenu opens in the menu's place.
 *
 * Every choice sits at the top level, one press away: the workspaces as
 * rows with their logos, and the theme as three icons in one row. Submenus,
 * labels and radio groups build any other layout, such as the workspaces
 * and the theme each in a submenu.
 */

/** Pass `open` and `onOpenChange` to control it; `presentation='popover'` keeps it a popover on a phone too. */
function UserMenu({ presentation = 'auto', ...props }: ComponentProps<typeof Menu>) {
  return <Menu presentation={presentation} {...props} />
}

/** What opens it, such as an avatar in a ghost Button or a Sidebar's row, through `render`. */
function UserMenuTrigger(props: ComponentProps<typeof MenuTrigger>) {
  return <MenuTrigger {...props} />
}

/** It opens under the trigger's end edge. */
function UserMenuContent({
  align = 'end',
  className,
  style,
  ...props
}: ComponentProps<typeof MenuContent>) {
  return (
    <MenuContent
      data-user-menu-content=''
      align={align}
      // Who they are, their workspaces and the theme hold more than a menu's 24rem.
      style={(state) => ({
        '--menu-max-height': '36rem',
        ...((typeof style === 'function' ? style(state) : style) as CSSProperties),
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
    <MenuGroup
      data-user-menu-header=''
      className={cn(
        'flex flex-row items-center gap-2.5 px-(--control-padding) py-2',
        className,
      )}
    >
      {avatar}
      <span className='flex min-w-0 flex-1 flex-col'>
        {/* A long name or email wraps, so the whole of it shows. */}
        <MenuGroupLabel className='text-foreground p-0 text-sm font-medium wrap-break-word'>
          {name}
        </MenuGroupLabel>
        {email ? (
          <span className='text-muted-foreground text-xs wrap-anywhere'>{email}</span>
        ) : null}
      </span>
    </MenuGroup>
  )
}

/**
 * The workspaces under a heading, the one they're in marked. Switching
 * workspace changes the page, so a pick closes the menu. `label={null}`
 * leaves the heading out, as in a submenu, with an `aria-label` in its place.
 */
function UserMenuWorkspaces<Value extends string = string>({
  label = 'Workspaces',
  children,
  ...props
}: Omit<ComponentProps<typeof MenuRadioGroup<Value>>, 'children'> & {
  label?: ReactNode
  children: ReactNode
}) {
  return (
    <MenuRadioGroup<Value> data-user-menu-workspaces='' {...props}>
      {label === null ? null : (
        // At the start, over the logos, as the theme's heading is: not past a tick's gutter, since its rows have none.
        <MenuGroupLabel className='ps-(--control-padding)'>{label}</MenuGroupLabel>
      )}
      {children}
    </MenuRadioGroup>
  )
}

/** One workspace: its logo, its name, and a line such as its plan. Picking one closes the menu. */
function UserMenuWorkspace({
  logo,
  description,
  children,
  label = typeof children === 'string' ? children : undefined,
  closeOnSelect = true,
  ...props
}: Omit<ComponentProps<typeof MenuRadioItem>, 'children'> & {
  /** Its logo, sized to the row's icons. */
  logo?: ReactNode
  /** Read after the name, such as "Team plan". */
  description?: ReactNode
  children: ReactNode
}) {
  return (
    <MenuRadioItem
      data-user-menu-workspace=''
      label={label}
      closeOnSelect={closeOnSelect}
      {...props}
    >
      {logo}
      {/* Whole, never cut short: the menu is where a long name is read in full. */}
      <span className='min-w-0 flex-1 break-words'>{children}</span>
      {/* A screen reader hears the plan as a word of its own. */}
      {description ? ' ' : null}
      {description ? (
        <span className='text-muted-foreground in-data-highlighted:text-accent-foreground/80 shrink-0 text-xs'>
          {description}
        </span>
      ) : null}
    </MenuRadioItem>
  )
}

/**
 * System, light and dark: one row, the three as icons beside `label`, or
 * with `inline={false}` three rows, for a submenu.
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
  if (!inline) {
    return <ThemeMenuRadioGroup label={null} aria-label={label} crossover={crossover} />
  }
  return <ThemeMenuRadioGroup inline label={label} crossover={crossover} />
}

function UserMenuGroup(props: ComponentProps<typeof MenuGroup>) {
  return <MenuGroup {...props} />
}

function UserMenuItem(props: ComponentProps<typeof MenuItem>) {
  return <MenuItem {...props} />
}

function UserMenuItemIcon(props: ComponentProps<typeof MenuItemIcon>) {
  return <MenuItemIcon {...props} />
}

/** A group's heading, which names it. */
function UserMenuLabel(props: ComponentProps<typeof MenuGroupLabel>) {
  return <MenuGroupLabel {...props} />
}

/** One choice of several of your own, such as a status, under a `UserMenuLabel`. */
function UserMenuRadioGroup<Value extends string = string>(
  props: ComponentProps<typeof MenuRadioGroup<Value>>,
) {
  return <MenuRadioGroup<Value> {...props} />
}

function UserMenuRadioItem(props: ComponentProps<typeof MenuRadioItem>) {
  return <MenuRadioItem {...props} />
}

/** A row that opens more rows beside it; in the sheet they open in the menu's place. */
function UserMenuSub(props: ComponentProps<typeof MenuSub>) {
  return <MenuSub {...props} />
}

/** The row that opens a submenu, such as one that names the workspace they're in. */
function UserMenuSubTrigger(props: ComponentProps<typeof MenuSubTrigger>) {
  return <MenuSubTrigger {...props} />
}

function UserMenuSubContent(props: ComponentProps<typeof MenuSubContent>) {
  return <MenuSubContent {...props} />
}

function UserMenuSeparator(props: ComponentProps<typeof MenuSeparator>) {
  return <MenuSeparator {...props} />
}

export {
  UserMenu,
  UserMenuContent,
  UserMenuGroup,
  UserMenuHeader,
  UserMenuItem,
  UserMenuItemIcon,
  UserMenuLabel,
  UserMenuRadioGroup,
  UserMenuRadioItem,
  UserMenuSeparator,
  UserMenuSub,
  UserMenuSubContent,
  UserMenuSubTrigger,
  UserMenuTheme,
  UserMenuTrigger,
  UserMenuWorkspace,
  UserMenuWorkspaces,
}
