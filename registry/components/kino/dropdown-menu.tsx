'use client'

import {
  MenuCheckboxItem,
  MenuContent,
  MenuEmpty,
  MenuItem,
  MenuLabel,
  MenuLinkItem,
  MenuRadioItem,
  MenuSearch,
  MenuSeparator,
  MenuShortcut,
  MenuSubContent,
  MenuSubTrigger,
} from '@/registry/lib/menu'
import { Menu as MenuPrimitive } from '@base-ui/react/menu'
import type { ComponentProps } from 'react'

function DropdownMenu<Payload>(props: MenuPrimitive.Root.Props<Payload>) {
  return <MenuPrimitive.Root data-slot='dropdown-menu' {...props} />
}

function DropdownMenuTrigger<Payload>(props: MenuPrimitive.Trigger.Props<Payload>) {
  return <MenuPrimitive.Trigger data-slot='dropdown-menu-trigger' {...props} />
}

/**
 * The menu: it grows out from under its trigger and folds back into it, and
 * one highlight glides between its items. `className` goes to the list of
 * items; every other prop goes to Base UI's Popup.
 */
function DropdownMenuContent(props: ComponentProps<typeof MenuContent>) {
  return <MenuContent data-slot='dropdown-menu-content' {...props} />
}

/**
 * Makes the menu or submenu it wraps searchable: put a `DropdownMenuSearch`
 * and a `DropdownMenuEmpty` in its content's `search`. Renders no element.
 */
function DropdownMenuFilterProvider(props: MenuPrimitive.FilterProvider.Props) {
  return <MenuPrimitive.FilterProvider {...props} />
}

function DropdownMenuSearch(props: ComponentProps<typeof MenuSearch>) {
  return <MenuSearch data-slot='dropdown-menu-search' {...props} />
}

function DropdownMenuEmpty(props: ComponentProps<typeof MenuEmpty>) {
  return <MenuEmpty data-slot='dropdown-menu-empty' {...props} />
}

function DropdownMenuGroup(props: MenuPrimitive.Group.Props) {
  return <MenuPrimitive.Group data-slot='dropdown-menu-group' {...props} />
}

function DropdownMenuLabel(props: ComponentProps<typeof MenuLabel>) {
  return <MenuLabel data-slot='dropdown-menu-label' {...props} />
}

function DropdownMenuItem(props: ComponentProps<typeof MenuItem>) {
  return <MenuItem data-slot='dropdown-menu-item' {...props} />
}

function DropdownMenuLinkItem(props: ComponentProps<typeof MenuLinkItem>) {
  return <MenuLinkItem data-slot='dropdown-menu-link-item' {...props} />
}

function DropdownMenuCheckboxItem(props: ComponentProps<typeof MenuCheckboxItem>) {
  return <MenuCheckboxItem data-slot='dropdown-menu-checkbox-item' {...props} />
}

function DropdownMenuRadioGroup(props: MenuPrimitive.RadioGroup.Props) {
  return <MenuPrimitive.RadioGroup data-slot='dropdown-menu-radio-group' {...props} />
}

function DropdownMenuRadioItem(props: ComponentProps<typeof MenuRadioItem>) {
  return <MenuRadioItem data-slot='dropdown-menu-radio-item' {...props} />
}

function DropdownMenuSeparator(props: ComponentProps<typeof MenuSeparator>) {
  return <MenuSeparator data-slot='dropdown-menu-separator' {...props} />
}

function DropdownMenuShortcut(props: ComponentProps<typeof MenuShortcut>) {
  return <MenuShortcut data-slot='dropdown-menu-shortcut' {...props} />
}

function DropdownMenuSub(props: MenuPrimitive.SubmenuRoot.Props) {
  return <MenuPrimitive.SubmenuRoot data-slot='dropdown-menu-sub' {...props} />
}

function DropdownMenuSubTrigger(props: ComponentProps<typeof MenuSubTrigger>) {
  return <MenuSubTrigger data-slot='dropdown-menu-sub-trigger' {...props} />
}

function DropdownMenuSubContent(props: ComponentProps<typeof MenuSubContent>) {
  return <MenuSubContent data-slot='dropdown-menu-sub-content' {...props} />
}

export {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuEmpty,
  DropdownMenuFilterProvider,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuLinkItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSearch,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
}
