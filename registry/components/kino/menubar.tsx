'use client'

import { followPointer, highlightClassName, itemMatching } from '@/registry/lib/highlight'
import {
  MenuCheckboxItem,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuLinkItem,
  MenuRadioItem,
  MenuSeparator,
  MenuShortcut,
  MenuSubContent,
  MenuSubTrigger,
} from '@/registry/lib/menu'
import { Menu as MenuPrimitive } from '@base-ui/react/menu'
import { Menubar as MenubarPrimitive } from '@base-ui/react/menubar'
import { type ComponentProps, useCallback } from 'react'

import { cn } from '@/lib/utils'

/**
 * The bar. One highlight glides between its triggers: it goes to the trigger
 * under the pointer or with visible focus, else to the one whose menu is open.
 */
function Menubar({
  className,
  children,
  ...props
}: Omit<MenubarPrimitive.Props, 'className'> & { className?: string }) {
  const track = useCallback((layer: HTMLSpanElement | null) => {
    const bar = layer?.parentElement
    if (!layer || !bar) return
    return followPointer(bar, layer, {
      itemOf: itemMatching(bar, '[data-slot=menubar-trigger]'),
      current: '[data-slot=menubar-trigger][data-popup-open]',
      focus: true,
    })
  }, [])
  return (
    <MenubarPrimitive
      data-slot='menubar'
      className={cn(
        // The 2px inside the bar keeps the triggers' highlight off its border and
        // leaves them at least 24px tall at every density.
        'bg-background relative isolate flex h-(--control-height) items-center gap-0.5 rounded-(--list-radius) border p-0.5 shadow-xs',
        className,
      )}
      {...props}
    >
      <span
        ref={track}
        aria-hidden
        data-slot='menubar-highlight'
        className={cn(
          highlightClassName,
          'bg-muted -z-10 forced-colors:bg-[Highlight] forced-colors:forced-color-adjust-none',
        )}
      />
      {children}
    </MenubarPrimitive>
  )
}

function MenubarMenu<Payload>(props: MenuPrimitive.Root.Props<Payload>) {
  return <MenuPrimitive.Root data-slot='menubar-menu' {...props} />
}

function MenubarTrigger<Payload>({
  className,
  ...props
}: Omit<MenuPrimitive.Trigger.Props<Payload>, 'className'> & { className?: string }) {
  return (
    <MenuPrimitive.Trigger
      data-slot='menubar-trigger'
      className={cn(
        // The bar's highlight shows hover and the open menu.
        'focus-visible:ring-ring/50 flex h-full items-center rounded-(--item-radius) px-(--control-padding) text-sm font-medium select-none focus-visible:ring-3 focus-visible:outline-hidden forced-colors:data-glided:text-[HighlightText] forced-colors:data-glided:forced-color-adjust-none',
        className,
      )}
      {...props}
    />
  )
}

/**
 * A menu of the bar: it grows out from under its trigger and folds back into
 * it, and one highlight glides between its items. `className` goes to the
 * list of items; every other prop goes to Base UI's Popup.
 */
function MenubarContent(props: ComponentProps<typeof MenuContent>) {
  return <MenuContent data-slot='menubar-content' {...props} />
}

function MenubarGroup(props: MenuPrimitive.Group.Props) {
  return <MenuPrimitive.Group data-slot='menubar-group' {...props} />
}

function MenubarLabel(props: ComponentProps<typeof MenuLabel>) {
  return <MenuLabel data-slot='menubar-label' {...props} />
}

function MenubarItem(props: ComponentProps<typeof MenuItem>) {
  return <MenuItem data-slot='menubar-item' {...props} />
}

function MenubarLinkItem(props: ComponentProps<typeof MenuLinkItem>) {
  return <MenuLinkItem data-slot='menubar-link-item' {...props} />
}

function MenubarCheckboxItem(props: ComponentProps<typeof MenuCheckboxItem>) {
  return <MenuCheckboxItem data-slot='menubar-checkbox-item' {...props} />
}

function MenubarRadioGroup(props: MenuPrimitive.RadioGroup.Props) {
  return <MenuPrimitive.RadioGroup data-slot='menubar-radio-group' {...props} />
}

function MenubarRadioItem(props: ComponentProps<typeof MenuRadioItem>) {
  return <MenuRadioItem data-slot='menubar-radio-item' {...props} />
}

function MenubarSeparator(props: ComponentProps<typeof MenuSeparator>) {
  return <MenuSeparator data-slot='menubar-separator' {...props} />
}

function MenubarShortcut(props: ComponentProps<typeof MenuShortcut>) {
  return <MenuShortcut data-slot='menubar-shortcut' {...props} />
}

function MenubarSub(props: MenuPrimitive.SubmenuRoot.Props) {
  return <MenuPrimitive.SubmenuRoot data-slot='menubar-sub' {...props} />
}

function MenubarSubTrigger(props: ComponentProps<typeof MenuSubTrigger>) {
  return <MenuSubTrigger data-slot='menubar-sub-trigger' {...props} />
}

function MenubarSubContent(props: ComponentProps<typeof MenuSubContent>) {
  return <MenuSubContent data-slot='menubar-sub-content' {...props} />
}

export {
  Menubar,
  MenubarCheckboxItem,
  MenubarContent,
  MenubarGroup,
  MenubarItem,
  MenubarLabel,
  MenubarLinkItem,
  MenubarMenu,
  MenubarRadioGroup,
  MenubarRadioItem,
  MenubarSeparator,
  MenubarShortcut,
  MenubarSub,
  MenubarSubContent,
  MenubarSubTrigger,
  MenubarTrigger,
}
