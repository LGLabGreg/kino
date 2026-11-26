'use client'

import { followPointer, highlightClassName, itemMatching } from '@/registry/lib/highlight'
import { Menubar as MenubarPrimitive } from '@ui-sdk/react/menubar'
import { type ComponentProps, type ReactNode, useCallback } from 'react'

import { cn } from '@/lib/utils'

/*
 * A bar of menus, as an app's File, Edit and View: each one is a Menu, with
 * its MenuTrigger right inside the bar.
 */

/**
 * The bar. One highlight glides between its menus' triggers: it goes to the
 * trigger under the pointer or with visible focus, else to the one whose
 * menu is open.
 */
function Menubar({
  className,
  children,
  ...props
}: Omit<ComponentProps<typeof MenubarPrimitive>, 'className' | 'children'> & {
  className?: string
  children?: ReactNode
}) {
  const track = useCallback((layer: HTMLSpanElement | null) => {
    const bar = layer?.parentElement
    if (!layer || !bar) return
    return followPointer(bar, layer, {
      itemOf: itemMatching(bar, '[data-slot=menu-trigger]'),
      current: '[data-slot=menu-trigger][data-open]',
      focus: true,
    })
  }, [])
  return (
    <MenubarPrimitive
      className={cn(
        // The 2px inside the bar keeps the triggers' highlight off its border and
        // leaves them at least 24px tall at every density. The bar's highlight
        // shows a trigger's hover and its open menu.
        'bg-background relative isolate flex h-(--control-height) items-center gap-0.5 rounded-(--list-radius) border p-0.5 shadow-xs',
        '*:data-[slot=menu-trigger]:focus-visible:ring-ring/50 *:data-[slot=menu-trigger]:flex *:data-[slot=menu-trigger]:h-full *:data-[slot=menu-trigger]:items-center *:data-[slot=menu-trigger]:rounded-(--item-radius) *:data-[slot=menu-trigger]:px-(--control-padding) *:data-[slot=menu-trigger]:text-sm *:data-[slot=menu-trigger]:font-medium *:data-[slot=menu-trigger]:select-none *:data-[slot=menu-trigger]:focus-visible:ring-3 *:data-[slot=menu-trigger]:focus-visible:outline-hidden *:data-[slot=menu-trigger]:forced-colors:data-glided:text-[HighlightText] *:data-[slot=menu-trigger]:forced-colors:data-glided:forced-color-adjust-none',
        className,
      )}
      {...props}
    >
      <span
        ref={track}
        aria-hidden
        data-menubar-highlight=''
        className={cn(
          highlightClassName,
          'bg-muted -z-10 forced-colors:bg-[Highlight] forced-colors:forced-color-adjust-none',
        )}
      />
      {children}
    </MenubarPrimitive>
  )
}

export { Menubar }
