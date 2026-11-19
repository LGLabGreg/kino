'use client'

import { buttonVariants } from '@/registry/components/kino/button'
import { IconPlaceholder } from '@/registry/icons/icon-placeholder'
import { mergeRefs } from '@/registry/lib/refs'
import {
  type SortLayout,
  SortContext,
  SortItemContext,
  useSortHandle,
  useSortItem,
  useSortList,
} from '@/registry/lib/sort'
import { mergeProps } from '@base-ui/react/merge-props'
import { useRender } from '@base-ui/react/use-render'
import { type ComponentProps, useMemo } from 'react'

import { cn } from '@/lib/utils'

/*
 * A list put in a new order by dragging an item from anywhere on it (a long
 * press, by touch), or by keyboard from its handle, a grip at its start
 * that darkens under the pointer. The item follows the
 * pointer flat, a little raised, the others glide aside on `layout`, and let
 * go it settles into its gap.
 */

/**
 * A list of `SortableItem`s, shown in the order of `value`. A column, or
 * items that wrap in rows with `layout='grid'`, laid out by `className`.
 */
function SortableList({
  className,
  value,
  defaultValue,
  onValueChange,
  layout = 'list',
  disabled = false,
  children,
  ref,
  ...props
}: Omit<ComponentProps<'div'>, 'defaultValue' | 'className'> & {
  className?: string
  /** The items' values, in order. */
  value?: string[]
  defaultValue?: string[]
  /** Called with the new order when an item is dropped in a new place. */
  onValueChange?: (value: string[]) => void
  layout?: SortLayout
  disabled?: boolean
}) {
  const { context, frame, listRef, ordered, extras, sorting } = useSortList(children, {
    value,
    defaultValue,
    onValueChange,
    layout,
    disabled,
  })
  const refs = useMemo(() => mergeRefs(listRef, ref), [listRef, ref])
  return (
    <SortContext value={context}>
      {/* Follows the list's height as items wrap, and clips nothing a lifted item's shadow needs. */}
      <div
        ref={frame}
        data-slot='sortable-list'
        className='[overflow-clip-margin:1rem] overflow-clip transition-[height] duration-(--motion-layout-duration) ease-(--motion-layout-easing) motion-reduce:transition-none'
      >
        <div
          ref={refs}
          role='list'
          data-slot='sortable-list-items'
          data-layout={layout}
          data-sorting={sorting ? '' : undefined}
          data-disabled={disabled ? '' : undefined}
          className={cn(
            'relative isolate flex gap-2 data-sorting:select-none',
            layout === 'list' ? 'flex-col' : 'flex-wrap',
            className,
          )}
          {...props}
        >
          {ordered}
        </div>
        {extras}
      </div>
    </SortContext>
  )
}

/**
 * One item: a row, or a card in a grid. `label` names it to a screen reader
 * as it moves, and names its handle.
 */
function SortableItem({
  className,
  value,
  label,
  disabled = false,
  render,
  children,
  ...props
}: Omit<useRender.ComponentProps<'div'>, 'className'> & {
  className?: string
  value: string
  label: string
  disabled?: boolean
}) {
  const item = useSortItem(value, label, disabled)
  const { ref: sortRef, ...own } = item.props
  const element = useRender({
    defaultTagName: 'div',
    render,
    ref: sortRef,
    props: mergeProps<'div'>(
      {
        role: 'listitem',
        className: cn(
          'group/sortable-item bg-card text-card-foreground relative flex min-w-0 cursor-grab items-center gap-(--control-padding) rounded-(--list-radius) border p-(--control-padding) text-sm select-none [-webkit-touch-callout:none] data-disabled:cursor-default data-lifted:cursor-grabbing',
          // A control inside it answers its own press, so it keeps its own cursor:
          // the same kinds as the sort lib's sortControls, but the handle.
          '[&_:is(a[href],button,input,select,textarea,label,summary,[contenteditable],[role=button],[role=link],[role=checkbox],[role=radio],[role=switch],[role=slider],[role=spinbutton],[role=textbox],[role=searchbox],[role=combobox],[role=option],[role=tab],[role=treeitem],[role=menuitem],[role=menuitemcheckbox],[role=menuitemradio],[data-slot=slider-control]):not([data-slot=sortable-handle])]:cursor-auto',
          // It glides to a new place on `layout` (`followFlow`), never while
          // the pointer holds it, and rises and settles on `enter` and `exit`.
          '[transition:translate_var(--motion-layout-duration)_var(--motion-layout-easing),scale_var(--motion-exit-duration)_var(--motion-exit-easing)] data-lifted:z-10 data-settling:z-10 data-lifted:[transition:translate_var(--motion-layout-duration)_var(--motion-layout-easing),scale_var(--motion-enter-duration)_var(--motion-enter-easing)] data-[flow=start]:[transition:scale_var(--motion-exit-duration)_var(--motion-exit-easing)] data-lifted:data-[flow=start]:[transition:scale_var(--motion-enter-duration)_var(--motion-enter-easing)] data-lifted:data-flow-held:[transition:scale_var(--motion-enter-duration)_var(--motion-enter-easing)] motion-reduce:transition-none!',
          // Forced colours drop the shadow: the lifted item is outlined instead.
          'forced-colors:data-lifted:outline-2 forced-colors:data-lifted:outline-[Highlight]',
          className,
        ),
        children: (
          <>
            {children}
            {/* Its shadow fades in as it rises, on a layer of its own, so only opacity moves; one in the page, so a move hands its fade on. */}
            <span
              aria-hidden
              data-slot='sortable-item-shadow'
              className='pointer-events-none absolute -inset-px rounded-[inherit] opacity-0 shadow-md [transition:opacity_var(--motion-exit-duration)_var(--motion-exit-easing)] group-data-lifted/sortable-item:opacity-100 group-data-lifted/sortable-item:[transition:opacity_var(--motion-enter-duration)_var(--motion-enter-easing)] dark:shadow-black/60 [[data-pressing]>&]:opacity-50 [[data-pressing]>&]:[transition:opacity_var(--motion-press-duration)_var(--motion-press-easing)]'
            />
          </>
        ),
      },
      own,
      props,
    ),
    state: { slot: 'sortable-item' },
  })
  return <SortItemContext value={item.item}>{element}</SortItemContext>
}

/** The button that picks its item up: drag it, or press Space and use the arrow keys. */
function SortableHandle({
  className,
  children,
  ref,
  ...props
}: Omit<ComponentProps<'button'>, 'className'> & { className?: string }) {
  const { ref: sortRef, ...handle } = useSortHandle()
  const refs = useMemo(() => mergeRefs(sortRef, ref), [sortRef, ref])
  return (
    <button
      ref={refs}
      data-slot='sortable-handle'
      className={cn(
        // Kino's ghost icon button, which picks up as it is dragged.
        buttonVariants({ variant: 'ghost', size: 'icon-xs' }),
        "text-muted-foreground cursor-grab touch-none [&_svg:not([class*='size-'])]:size-4",
        // Muted at rest, it darkens while the pointer is on its item, which drags too.
        'group-hover/sortable-item:text-foreground',
        'aria-pressed:text-foreground aria-pressed:cursor-grabbing forced-colors:aria-pressed:text-[Highlight]',
        // One item that can't move dims its grip; a list that's turned off has none.
        // In a list that's turned off, the handles take no room at all.
        'disabled:pointer-events-none disabled:opacity-50 [[data-slot=sortable-list-items][data-disabled]_&]:hidden',
        className,
      )}
      {...mergeProps<'button'>(handle, props)}
    >
      {children ?? (
        <IconPlaceholder
          lucide='GripVerticalIcon'
          tabler='IconGripVertical'
          hugeicons='DragDropVerticalIcon'
          phosphor='DotsSixVerticalIcon'
          remixicon='RiDraggable'
          aria-hidden
        />
      )}
    </button>
  )
}

export { SortableHandle, SortableItem, SortableList }
