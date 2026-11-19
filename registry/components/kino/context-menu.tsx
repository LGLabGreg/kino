'use client'

import {
  MenuCheckboxItem,
  MenuItem,
  MenuLabel,
  MenuLinkItem,
  MenuPopup,
  MenuRadioItem,
  MenuSeparator,
  MenuShortcut,
  MenuSubContent,
  MenuSubTrigger,
} from '@/registry/lib/menu'
import { popupPositionerProps } from '@/registry/lib/popup'
import { ContextMenu as ContextMenuPrimitive } from '@base-ui/react/context-menu'
import { Menu as MenuPrimitive } from '@base-ui/react/menu'
import type { ComponentProps } from 'react'

import { cn } from '@/lib/utils'

function ContextMenu(props: ContextMenuPrimitive.Root.Props) {
  return <ContextMenuPrimitive.Root data-slot='context-menu' {...props} />
}

/** The area that opens the menu on a right click, or a long press on a touch screen. */
function ContextMenuTrigger({
  className,
  ...props
}: Omit<ContextMenuPrimitive.Trigger.Props, 'className'> & { className?: string }) {
  return (
    <ContextMenuPrimitive.Trigger
      data-slot='context-menu-trigger'
      className={cn('select-none', className)}
      {...props}
    />
  )
}

/**
 * The menu: it grows out from the pointer and folds back into it, and one
 * highlight glides between its items. `className` goes to the list of items;
 * every other prop goes to Base UI's Popup.
 */
function ContextMenuContent({
  sideOffset,
  alignOffset,
  ...props
}: ComponentProps<typeof MenuPopup> &
  Pick<ContextMenuPrimitive.Positioner.Props, 'sideOffset' | 'alignOffset'>) {
  return (
    <ContextMenuPrimitive.Portal>
      <ContextMenuPrimitive.Positioner
        {...popupPositionerProps}
        sideOffset={sideOffset}
        alignOffset={alignOffset}
      >
        <MenuPopup data-slot='context-menu-content' {...props} />
      </ContextMenuPrimitive.Positioner>
    </ContextMenuPrimitive.Portal>
  )
}

function ContextMenuGroup(props: MenuPrimitive.Group.Props) {
  return <MenuPrimitive.Group data-slot='context-menu-group' {...props} />
}

function ContextMenuLabel(props: ComponentProps<typeof MenuLabel>) {
  return <MenuLabel data-slot='context-menu-label' {...props} />
}

function ContextMenuItem(props: ComponentProps<typeof MenuItem>) {
  return <MenuItem data-slot='context-menu-item' {...props} />
}

function ContextMenuLinkItem(props: ComponentProps<typeof MenuLinkItem>) {
  return <MenuLinkItem data-slot='context-menu-link-item' {...props} />
}

function ContextMenuCheckboxItem(props: ComponentProps<typeof MenuCheckboxItem>) {
  return <MenuCheckboxItem data-slot='context-menu-checkbox-item' {...props} />
}

function ContextMenuRadioGroup(props: MenuPrimitive.RadioGroup.Props) {
  return <MenuPrimitive.RadioGroup data-slot='context-menu-radio-group' {...props} />
}

function ContextMenuRadioItem(props: ComponentProps<typeof MenuRadioItem>) {
  return <MenuRadioItem data-slot='context-menu-radio-item' {...props} />
}

function ContextMenuSeparator(props: ComponentProps<typeof MenuSeparator>) {
  return <MenuSeparator data-slot='context-menu-separator' {...props} />
}

function ContextMenuShortcut(props: ComponentProps<typeof MenuShortcut>) {
  return <MenuShortcut data-slot='context-menu-shortcut' {...props} />
}

function ContextMenuSub(props: MenuPrimitive.SubmenuRoot.Props) {
  return <MenuPrimitive.SubmenuRoot data-slot='context-menu-sub' {...props} />
}

function ContextMenuSubTrigger(props: ComponentProps<typeof MenuSubTrigger>) {
  return <MenuSubTrigger data-slot='context-menu-sub-trigger' {...props} />
}

function ContextMenuSubContent(props: ComponentProps<typeof MenuSubContent>) {
  return <MenuSubContent data-slot='context-menu-sub-content' {...props} />
}

export {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuLinkItem,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
}
