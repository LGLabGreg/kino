'use client'

import { buttonVariants } from '@/registry/components/kino/button'
import { IconPlaceholder } from '@/registry/icons/icon-placeholder'
import { useFlow } from '@/registry/lib/flow'
import { mergeRefs } from '@/registry/lib/refs'
import {
  ListsMove,
  type SortAccepts,
  SortContext,
  SortItemContext,
  type SortLayout,
  type SortListDetails,
  type SortGroupDetails,
  type SortMove,
  useGroupList,
  useSettle,
  useSortContext,
  useSortGroup,
  useSortList,
} from '@/registry/lib/sort'
import { type PartProps, usePart } from '@ui-sdk/react/primitive'
import { type ReactNode, use, useMemo, useRef } from 'react'

import { cn } from '@/lib/utils'

/*
 * A list put in a new order by dragging an item from anywhere on it (a long
 * press, by touch), or by keyboard from its handle, a grip at its start
 * that darkens under the pointer. A copy of the item follows the pointer, a
 * little raised, while the item shows where it would land as a dashed slot,
 * the others glide aside on `layout`, and let go, it glides from the copy
 * into its slot. In a `SortableGroup`, items move between its lists too.
 */

/**
 * What every list shares: a frame that follows the list's height as items
 * come, go and wrap, and clips nothing a raised item's shadow needs. While
 * an item glides in from past it, from where its copy was let go or from
 * another list, it clips nothing and sits above the lists beside it.
 */
const frameClassName =
  'relative [overflow-clip-margin:1rem] overflow-clip transition-[height] duration-(--motion-layout-duration) ease-(--motion-layout-easing) has-[[data-settling]]:z-10 has-[[data-settling]]:overflow-visible motion-reduce:transition-none'

const listClassName = 'relative isolate flex gap-2 data-sorting:select-none'

/**
 * A list of `SortableItem`s, shown in the order of `value`. A column, or
 * items that wrap in rows with `layout='grid'`, laid out by `className`.
 * Inside a `SortableGroup`, it is one of the group's lists: `id` names it in
 * the group's value and `label` to a screen reader, and the group holds its
 * order.
 */
function SortableList(props: SortableListProps) {
  return props.id === undefined ? <LoneList {...props} /> : <GroupList {...props} />
}

type LoneListProps = Omit<
  PartProps<'div'>,
  'id' | 'defaultValue' | 'className' | 'children'
> & {
  className?: string
  children?: ReactNode
  /** Only a list in a `SortableGroup` has one: without it, a list is a list of its own, even inside a group's item. */
  id?: never
  /** The items' values, in order. */
  value?: string[]
  defaultValue?: string[]
  /** Called with the new order once an item is dropped in a new place, and ui-sdk's change details. */
  onValueChange?: (value: string[], details: SortListDetails) => void
  layout?: SortLayout
  disabled?: boolean
}

type GroupListProps = Omit<PartProps<'div'>, 'id' | 'className' | 'children'> & {
  className?: string
  children?: ReactNode
  /** Its key in the group's value. */
  id: string
  /** What a screen reader calls it as an item moves in or out. */
  label: string
  /** Neither gives nor takes an item. */
  disabled?: boolean
}

type SortableListProps = LoneListProps | GroupListProps

function LoneList({
  className,
  value,
  defaultValue,
  onValueChange,
  layout = 'list',
  disabled = false,
  children,
  ref,
  ...props
}: LoneListProps) {
  const { context, handle, ordered, extras } = useSortList(children, {
    value,
    defaultValue,
    onValueChange,
    layout,
    disabled,
  })
  const { frame, row } = useFlow<HTMLDivElement, HTMLDivElement>(
    '[data-slot=sortable-list-item]',
  )
  const refs = useMemo(() => mergeRefs(row, ref), [row, ref])
  return (
    <SortContext value={context}>
      <div ref={frame} className={frameClassName}>
        <ListRoot
          handle={handle}
          ref={refs}
          className={cn(
            listClassName,
            layout === 'list' ? 'flex-col' : 'flex-wrap',
            className,
          )}
          {...props}
        >
          {({ order }) => ordered(order)}
        </ListRoot>
      </div>
      {extras}
    </SortContext>
  )
}

function GroupList({
  className,
  id,
  label,
  disabled = false,
  children,
  ref,
  ...props
}: GroupListProps) {
  const { handle, ordered } = useGroupList(id, children)
  const { frame, row } = useFlow<HTMLDivElement, HTMLDivElement>(
    '[data-slot=sortable-group-item]',
  )
  const refs = useMemo(() => mergeRefs(row, ref), [row, ref])
  return (
    <div ref={frame} className={cn(frameClassName, 'min-w-0')}>
      <GroupListPart
        handle={handle}
        value={id}
        label={label}
        disabled={disabled}
        ref={refs}
        className={cn(
          listClassName,
          // An empty list still has room to drop on.
          'min-h-(--control-height) flex-col',
          // A list that won't take the item being moved steps back, where it is its own box.
          'transition-opacity duration-(--motion-exit-duration) ease-(--motion-exit-easing) data-refused:opacity-50 data-refused:duration-(--motion-enter-duration) data-refused:ease-(--motion-enter-easing)',
          className,
        )}
        {...props}
      >
        {({ order }) => ordered(order)}
      </GroupListPart>
    </div>
  )
}

/**
 * Lists whose items move between them, by pointer or with Left and Right
 * while the keys move one. `value` holds each list's items by its `id`;
 * `onValueChange` gets the new lists, the move named at both ends, and
 * ui-sdk's change details. `accepts` says whether a list takes an item from
 * another: one that doesn't opens no gap, and an item dropped there goes
 * back. Its lists are laid out by `className`, such as columns side by side.
 */
function SortableGroup({
  className,
  value,
  defaultValue,
  onValueChange,
  accepts,
  children,
  ref,
  ...props
}: Omit<PartProps<'div'>, 'defaultValue' | 'className' | 'children'> & {
  className?: string
  children?: ReactNode
  /** Each list's items, in order, by the list's `id`. */
  value?: Record<string, string[]>
  defaultValue?: Record<string, string[]>
  onValueChange?: (
    value: Record<string, string[]>,
    move: SortMove,
    details: SortGroupDetails,
  ) => void
  accepts?: SortAccepts
}) {
  const { context, handle, root, extras } = useSortGroup({
    value,
    defaultValue,
    onValueChange,
    accepts,
  })
  const refs = useMemo(() => mergeRefs(root, ref), [root, ref])
  return (
    <SortContext value={context}>
      <GroupRoot
        handle={handle}
        ref={refs}
        // Outside every list that takes it, a drop puts it back.
        className={cn(
          'flex gap-4 data-outside:cursor-not-allowed data-outside:**:cursor-not-allowed data-sorting:select-none',
          className,
        )}
        {...props}
      >
        {({ lists, dragging }) => (
          <ListsMove lists={lists} dragging={dragging} root={root}>
            {children}
          </ListsMove>
        )}
      </GroupRoot>
      {extras}
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
  children,
  ref,
  ...props
}: Omit<PartProps<'div'>, 'className' | 'children'> & {
  className?: string
  children?: ReactNode
  value: string
  label: string
  disabled?: boolean
}) {
  const context = useSortContext()
  const own = useRef<HTMLDivElement>(null)
  useSettle(context.handle, own, value)
  const refs = useMemo(() => mergeRefs(own, ref), [ref])
  const item = useMemo(() => ({ value, label, disabled }), [value, label, disabled])
  const part = {
    value,
    label,
    disabled,
    className: cn(
      'group/sortable-item bg-card text-card-foreground relative z-0 flex min-w-0 cursor-grab items-center gap-(--control-padding) rounded-(--list-radius) border p-(--control-padding) text-sm select-none [-webkit-touch-callout:none] data-disabled:cursor-default',
      // A control inside it answers its own press, so it keeps its own cursor:
      // the same kinds as the sort lib's sortControls, but the handle.
      '[&_:is(a[href],button,input,select,textarea,label,summary,[contenteditable],[role=button],[role=link],[role=checkbox],[role=radio],[role=switch],[role=slider],[role=spinbutton],[role=textbox],[role=searchbox],[role=combobox],[role=option],[role=tab],[role=treeitem],[role=menuitem],[role=menuitemcheckbox],[role=menuitemradio],[data-slot=slider-control]):not([data-sortable-handle])]:cursor-auto',
      // Where a pointer would drop it: a dashed slot, its content hidden, tinted to read on a muted column too.
      'data-dragging:bg-foreground/5 data-dragging:border-foreground/20 data-dragging:border-dashed data-dragging:*:invisible',
      // It glides to a new place on `layout` (`followFlow`), and stays above
      // its neighbours while it settles there from where it was let go or
      // from another list, its z-index held for the glide.
      '[transition:translate_var(--motion-layout-duration)_var(--motion-layout-easing),z-index_0s_var(--motion-layout-duration)] data-[flow=start]:[transition:z-index_0s_var(--motion-layout-duration)] data-moving:z-10 data-moving:[transition:translate_var(--motion-layout-duration)_var(--motion-layout-easing)] data-settling:z-10 data-settling:[transition:translate_var(--motion-layout-duration)_var(--motion-layout-easing)] data-settling:data-[flow=start]:transition-none motion-reduce:transition-none!',
      // The copy a pointer drags is a clone of the item: it follows the pointer with no transition.
      'data-drag-preview:transition-none',
      // Forced colours drop the shadow: the raised item is outlined instead.
      'forced-colors:data-moving:outline-2 forced-colors:data-moving:outline-[Highlight] forced-colors:data-drag-preview:outline-2 forced-colors:data-drag-preview:outline-[Highlight]',
      className,
    ),
    ...props,
    children: (
      <>
        {children}
        {/*
         * Its shadow fades in as it rises, on a layer of its own, so only
         * opacity moves. The copy a pointer drags is raised from the start,
         * and the item keeps its shadow as it glides from the copy into its
         * place, then lets it fade.
         */}
        <span
          aria-hidden
          className='pointer-events-none absolute -inset-px rounded-[inherit] opacity-0 shadow-md [transition:opacity_var(--motion-exit-duration)_var(--motion-exit-easing)] group-data-moving/sortable-item:opacity-100 group-data-moving/sortable-item:[transition:opacity_var(--motion-enter-duration)_var(--motion-enter-easing)] group-data-[settling=drop]/sortable-item:opacity-100 group-data-[settling=drop]/sortable-item:transition-none dark:shadow-black/60 [[data-drag-preview]>&]:opacity-100 [[data-drag-preview]>&]:[transition:opacity_var(--motion-enter-duration)_var(--motion-enter-easing)] [[data-drag-preview]>&]:starting:opacity-0 [[data-holding]>&]:opacity-50 [[data-holding]>&]:[transition:opacity_var(--motion-press-duration)_var(--motion-press-easing)]'
        />
      </>
    ),
  }
  return (
    <SortItemContext value={item}>
      {context.kind === 'list' ? (
        <ListItemPart handle={context.handle} ref={refs} {...part} />
      ) : (
        <GroupItemPart handle={context.handle} ref={refs} {...part} />
      )}
    </SortItemContext>
  )
}

type ListHandle = Extract<ReturnType<typeof useSortContext>, { kind: 'list' }>['handle']
type GroupHandle = Extract<ReturnType<typeof useSortContext>, { kind: 'group' }>['handle']

/*
 * The parts, each rendered by ui-sdk's primitive: a ref reaches it as a prop,
 * as a part's element takes it.
 */
function ListRoot({
  handle,
  ...props
}: PartProps<'div', { order: string[]; sorting: boolean }> & { handle: ListHandle }) {
  return usePart(handle, 'root', {}, props, 'div')
}

function GroupRoot({
  handle,
  ...props
}: PartProps<'div', { lists: Record<string, string[]>; dragging: string | null }> & {
  handle: GroupHandle
}) {
  return usePart(handle, 'root', {}, props, 'div')
}

function GroupListPart({
  handle,
  value,
  label,
  disabled,
  ...props
}: PartProps<'div', { order: string[] }> & {
  handle: GroupHandle
  value: string
  label: string
  disabled: boolean
}) {
  return usePart(handle, 'list', { value, label, disabled }, props, 'div')
}

type ItemPartProps = PartProps<'div'> & {
  value: string
  label: string
  disabled: boolean
}

function ListItemPart({
  handle,
  value,
  label,
  disabled,
  ...props
}: ItemPartProps & { handle: ListHandle }) {
  return usePart(handle, 'item', { value, label, disabled }, props, 'div')
}

function GroupItemPart({
  handle,
  value,
  label,
  disabled,
  ...props
}: ItemPartProps & { handle: GroupHandle }) {
  return usePart(handle, 'item', { value, label, disabled }, props, 'div')
}

type HandlePartProps = PartProps<'button'> & { value: string; disabled: boolean }

function ListHandlePart({
  handle,
  value,
  disabled,
  ...props
}: HandlePartProps & { handle: ListHandle }) {
  return usePart(handle, 'handle', { value, disabled }, props, 'button')
}

function GroupHandlePart({
  handle,
  value,
  disabled,
  ...props
}: HandlePartProps & { handle: GroupHandle }) {
  return usePart(handle, 'handle', { value, disabled }, props, 'button')
}

/** The button that picks its item up: drag it, or press Space and use the arrow keys. */
function SortableHandle({
  className,
  children,
  ...props
}: Omit<PartProps<'button'>, 'className' | 'children'> & {
  className?: string
  children?: ReactNode
}) {
  const context = useSortContext()
  const item = use(SortItemContext)
  if (!item) throw new Error('A SortableHandle must be inside a SortableItem.')
  const part = {
    'aria-label': `Move ${item.label}`,
    'aria-describedby': context.instructionsId,
    className: cn(
      // Kino's ghost icon button, which picks up as it is dragged.
      buttonVariants({ variant: 'ghost', size: 'icon-xs' }),
      "text-muted-foreground cursor-grab touch-none [&_svg:not([class*='size-'])]:size-4",
      // Muted at rest, it darkens while the pointer is on its item, which drags
      // too, but not on the items a copy passes over; the copy's own is dark.
      'group-hover/sortable-item:text-foreground in-data-sorting:group-hover/sortable-item:text-muted-foreground [[data-drag-preview]_&]:text-foreground',
      'aria-pressed:text-foreground aria-pressed:cursor-grabbing forced-colors:aria-pressed:text-[Highlight]',
      // One item that can't move dims its grip; a list that's turned off has none,
      // and its handles take no room at all.
      'disabled:pointer-events-none disabled:opacity-50 [[data-slot=sortable-list][data-disabled]_&]:hidden [[data-slot=sortable-group-list][data-disabled]_&]:hidden',
      className,
    ),
    ...props,
    children: children ?? (
      <IconPlaceholder
        lucide='GripVerticalIcon'
        tabler='IconGripVertical'
        hugeicons='DragDropVerticalIcon'
        phosphor='DotsSixVerticalIcon'
        remixicon='RiDraggable'
        aria-hidden
      />
    ),
    value: item.value,
    disabled: item.disabled,
  }
  return context.kind === 'list' ? (
    <ListHandlePart handle={context.handle} {...part} />
  ) : (
    <GroupHandlePart handle={context.handle} {...part} />
  )
}

export { SortableGroup, SortableHandle, SortableItem, SortableList }
export type { SortAccepts, SortGroupDetails, SortLayout, SortListDetails, SortMove }
