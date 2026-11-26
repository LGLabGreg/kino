'use client'

import {
  followPointer,
  itemMatching,
  pickedRowClassName,
  rowHighlightClassName,
  tintedRowTextClassName,
} from '@/registry/lib/highlight'
import {
  listIndicatorClassName,
  menuIndicatorSlot,
  menuGutterClassName,
  menuLabelClassName,
  menuNoticeClassName,
  menuRowVariants,
  menuSeparatorClassName,
  MenuTick,
} from '@/registry/lib/list-rows'
import { followHeight } from '@/registry/lib/resize'
import { edgeFadeClassName, useEdgeFades } from '@/registry/lib/scroll'
import {
  Listbox as ListboxPrimitive,
  ListboxGroup as ListboxGroupPrimitive,
  ListboxGroupLabel as ListboxGroupLabelPrimitive,
  ListboxItem as ListboxItemPrimitive,
  ListboxItemIcon as ListboxItemIconPrimitive,
  ListboxItemIndicator as ListboxItemIndicatorPrimitive,
  type ListboxProps,
  ListboxSeparator as ListboxSeparatorPrimitive,
} from '@ui-sdk/react/listbox'
import {
  type ComponentProps,
  createContext,
  type ReactNode,
  use,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'

import { cn } from '@/lib/utils'

/*
 * A list of options that is always in view: ui-sdk's Listbox, with the
 * Select's rows and tick, and the Tree's gliding highlight and picked tint.
 */

/** Where `ListboxEmpty` shows, beside the list, which holds only options and groups, and whether the list has none. */
const EmptyContext = createContext<{
  slot: HTMLElement | null
  empty: boolean
}>({
  slot: null,
  empty: false,
})

const optionSelector = '[role=option]'

/**
 * In a Field, the list takes its label, description, error, name and
 * state, as ui-sdk's controls do. Arrows move focus, and Space, Enter or a
 * press picks (`activation='manual'`); with `activation='automatic'` the
 * pick follows focus. `className` goes to the box around the list; give it
 * a `max-h-` and it scrolls.
 */
function Listbox<Value = string, Multiple extends boolean | undefined = false>({
  className,
  children,
  activation = 'manual',
  ...props
}: ListboxProps<Value, Multiple> & {
  className?: string
  children?: ReactNode
}) {
  const [slot, setSlot] = useState<HTMLDivElement | null>(null)
  const [empty, setEmpty] = useState(false)
  const emptyId = useId()
  const fades = useEdgeFades<HTMLDivElement>()
  const areaRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const layerRef = useRef<HTMLSpanElement>(null)

  // Whether it has no options, before it paints, so its notice never arrives late.
  useLayoutEffect(() => {
    const list = contentRef.current?.querySelector('[role=listbox]')
    if (!list) return
    const count = () => setEmpty(!list.querySelector(optionSelector))
    count()
    const rows = new MutationObserver(count)
    rows.observe(list, { subtree: true, childList: true })
    return () => rows.disconnect()
  }, [])

  useEffect(() => {
    const area = areaRef.current
    const content = contentRef.current
    const layer = layerRef.current
    if (!area || !content || !layer) return
    // One highlight for every row, so it glides from row to row. The
    // options' clip follows their height, inside the box that scrolls:
    // options not yet shown, and the copies of ones still leaving, are
    // clipped as the height glides, never something to scroll to.
    const stopHeight = followHeight(area, content)
    const stopHighlight = followPointer(area, layer, {
      itemOf: itemMatching(area, optionSelector),
      focus: true,
    })
    return () => {
      stopHighlight()
      stopHeight()
    }
  }, [])

  return (
    <div
      data-listbox-box=''
      className={cn(
        // A box of rows, as a menu is, in the border every field has. It
        // moves to the height of its options as they come and go, as the
        // Combobox's box does, and they swap in place.
        'relative flex min-w-0 flex-col overflow-hidden rounded-(--list-radius) border border-input bg-transparent text-sm shadow-xs transition-[border-color,box-shadow] duration-(--motion-press-duration) ease-(--motion-press-fade-easing) has-focus-visible:border-ring has-aria-invalid:border-destructive has-[[role=listbox][data-disabled]]:opacity-50 dark:bg-input/30 dark:has-aria-invalid:border-destructive/70 forced-colors:has-aria-invalid:outline-2 forced-colors:has-aria-invalid:outline-offset-1 forced-colors:has-aria-invalid:outline-dashed',
        className,
      )}
    >
      <div
        ref={fades}
        className={cn(
          'scrollbar-thin min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain',
          edgeFadeClassName,
        )}
      >
        <div
          ref={areaRef}
          className='group/listbox relative isolate overflow-clip transition-[height] duration-(--motion-layout-duration) ease-(--motion-layout-easing) motion-reduce:transition-none'
        >
          <div ref={contentRef}>
            <ListboxPrimitive<Value, Multiple>
              activation={activation}
              aria-describedby={empty ? emptyId : undefined}
              // The 4px around the rows is the highlight's margin, as in a
              // menu, so it stays the same at every density.
              className={cn(
                'group/menu flex min-w-0 flex-col p-1 focus-visible:outline-hidden',
                menuGutterClassName,
              )}
              {...(props as ListboxProps<Value, Multiple>)}
            >
              <EmptyContext value={{ slot, empty }}>{children}</EmptyContext>
            </ListboxPrimitive>
            {/* Mounted from the start, so what it says when the list empties is heard. */}
            <div
              ref={setSlot}
              id={emptyId}
              role='status'
              data-listbox-notice=''
              className={menuNoticeClassName}
            />
          </div>
          <span
            ref={layerRef}
            aria-hidden
            data-listbox-highlight=''
            className={rowHighlightClassName}
          />
        </div>
      </div>
    </div>
  )
}

/**
 * An option: the Select's row, with its tick in the gutter before what it
 * shows. `label` is what typing its name matches, when its content isn't
 * plain text.
 */
function ListboxItem<Value = string>({
  className,
  children,
  ...props
}: Omit<ComponentProps<typeof ListboxItemPrimitive<Value>>, 'className' | 'children'> & {
  className?: string
  children?: ReactNode
}) {
  return (
    <ListboxItemPrimitive<Value>
      data-menu-row=''
      className={cn(
        menuRowVariants(),
        'group/menu-row transition-[color,background-color,box-shadow] duration-(--motion-press-duration) ease-(--motion-press-fade-easing)',
        // The ring is inset, so the list's edge never clips it.
        'focus-visible:ring-ring/50 focus-visible:ring-3 focus-visible:ring-inset focus-visible:outline-hidden forced-colors:[&[data-selected]]:focus-visible:outline-[CanvasText]',
        // A picked row takes the Tree's tint, and picked rows next to each
        // other join into one block.
        pickedRowClassName,
        '[&[data-selected]:has(+[data-selected])]:rounded-b-none [[data-selected]+&[data-selected]]:rounded-t-none',
        // Muted text in a tinted row is darker, so it keeps 4.5:1 on the tint.
        tintedRowTextClassName,
        className,
      )}
      {...props}
    >
      {/* Picked shows by more than its tint: the Select's tick, in a slot kept for it. */}
      <span data-menu-indicator='' className={menuIndicatorSlot}>
        <ListboxItemIndicatorPrimitive keepMounted className={listIndicatorClassName}>
          <MenuTick />
        </ListboxItemIndicatorPrimitive>
      </span>
      {children}
    </ListboxItemPrimitive>
  )
}

/** An option's icon, before its text. */
function ListboxItemIcon({
  className,
  ...props
}: Omit<ComponentProps<typeof ListboxItemIconPrimitive>, 'className'> & {
  className?: string
}) {
  return (
    <ListboxItemIconPrimitive
      className={cn(
        "flex shrink-0 items-center [&_svg:not([class*='text-'])]:text-muted-foreground",
        className,
      )}
      {...props}
    />
  )
}

/** Options under one heading, named by its `ListboxGroupLabel`. */
function ListboxGroup({
  className,
  ...props
}: Omit<ComponentProps<typeof ListboxGroupPrimitive>, 'className'> & {
  className?: string
}) {
  return <ListboxGroupPrimitive className={cn('flex flex-col', className)} {...props} />
}

/** A group's heading, lined up with the rows' text. */
function ListboxGroupLabel({
  className,
  ...props
}: Omit<ComponentProps<typeof ListboxGroupLabelPrimitive>, 'className'> & {
  className?: string
}) {
  return (
    <ListboxGroupLabelPrimitive
      className={cn(menuLabelClassName, className)}
      {...props}
    />
  )
}

/** A line between groups, across the list's 4px margin. */
function ListboxSeparator({
  className,
  ...props
}: Omit<ComponentProps<typeof ListboxSeparatorPrimitive>, 'className'> & {
  className?: string
}) {
  return (
    <ListboxSeparatorPrimitive
      className={cn(menuSeparatorClassName, className)}
      {...props}
    />
  )
}

/**
 * What the list says when it has no options, as when a search beside it
 * finds none: say what was looked for. It shows only while there are none,
 * beside the list, which may hold only options and groups.
 */
function ListboxEmpty({ className, ...props }: ComponentProps<'span'>) {
  const { slot, empty } = use(EmptyContext)
  // Before the list is on the page (rendered on the server), it sits in the
  // list and shows by CSS alone, so it is there when the page paints.
  if (!slot) {
    return (
      <span
        role='none'
        data-listbox-empty=''
        className={cn(
          menuNoticeClassName,
          'hidden group-[:not(:has([role=option]))]/menu:flex',
          className,
        )}
        {...props}
      />
    )
  }
  if (!empty) return null
  return createPortal(
    <span data-listbox-empty='' className={className} {...props} />,
    slot,
  )
}

export {
  Listbox,
  ListboxEmpty,
  ListboxGroup,
  ListboxGroupLabel,
  ListboxItem,
  ListboxItemIcon,
  ListboxSeparator,
}
