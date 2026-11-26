'use client'

import {
  CollapsibleIndicator,
  collapsibleNestedClassName,
  collapsibleRowClassName,
} from '@/registry/components/kino/collapsible'
import {
  followPointer,
  type HighlightTarget,
  itemMatching,
  pickedRowClassName,
  rowHighlightClassName,
  tintedRowTextClassName,
} from '@/registry/lib/highlight'
import { menuIndicatorClassName, menuIndicatorSlot, MenuTick } from '@/registry/lib/menu'
import { mergeRefs } from '@/registry/lib/refs'
import { collapseClassName, followPanelContent } from '@/registry/lib/resize'
import {
  TreeGroup as TreeGroupPrimitive,
  TreeItemIndicator as TreeItemIndicatorPrimitive,
  TreeItemLabel as TreeItemLabelPrimitive,
  TreeItem as TreeItemPrimitive,
  type TreeMode,
  Tree as TreePrimitive,
  type TreeProps,
} from '@ui-sdk/react/tree'
import {
  Children,
  type ComponentProps,
  createContext,
  isValidElement,
  type ReactNode,
  use,
  useEffect,
  useMemo,
  useRef,
} from 'react'

import { cn } from '@/lib/utils'

/*
 * A hierarchy, such as files or pages: ui-sdk's Tree, which owns its keys,
 * focus, selection and type-ahead. Its rows are the Collapsible's: a branch's
 * chevron turns down and its items open on the Collapsible's height, under a
 * rail from the chevron. One highlight glides from row to row under the
 * pointer and with focus, as the Table's does, and picked rows take the
 * Table's tint.
 */

const rowSelector = '[data-slot=tree-label]'

/**
 * The row the highlight goes to for what the pointer or the focus is on:
 * focus sits on the item, whose row is its own label; a nested item's gap
 * between rows is a gap.
 */
function rowOf(area: HTMLElement) {
  const row = itemMatching(area, rowSelector)
  return (node: EventTarget | null): HighlightTarget => {
    const element = node instanceof Element ? node : null
    const label = element?.matches('[role=treeitem]')
      ? element.querySelector(`:scope > ${rowSelector}`)
      : element
    return row(label ?? null)
  }
}

/** Whether a press on a branch's row opens it, so its chevron needs no press of its own. */
const RowOpensContext = createContext(true)

function Tree<Mode extends TreeMode = 'single'>({
  className,
  children,
  expandOnPress = true,
  ref,
  ...props
}: Omit<TreeProps<Mode>, 'className' | 'children'> & {
  className?: string
  children?: ReactNode
}) {
  const treeRef = useRef<HTMLDivElement>(null)
  const layerRef = useRef<HTMLSpanElement>(null)
  const rootRef = useMemo(() => mergeRefs(treeRef, ref), [ref])

  useEffect(() => {
    const tree = treeRef.current
    const layer = layerRef.current
    if (!tree || !layer) return
    // One highlight for every row, so it glides from row to row.
    return followPointer(tree, layer, { itemOf: rowOf(tree), focus: true })
  }, [])

  return (
    <TreePrimitive<Mode>
      ref={rootRef}
      className={cn(
        '@container/tree relative isolate flex min-w-0 flex-col gap-px',
        className,
      )}
      expandOnPress={expandOnPress}
      {...props}
    >
      <RowOpensContext value={expandOnPress}>{children}</RowOpensContext>
      <span
        ref={layerRef}
        aria-hidden
        data-tree-highlight=''
        className={rowHighlightClassName}
      />
    </TreePrimitive>
  )
}

/**
 * One item. With a `TreeGroup` inside, even an empty one, it is a branch that
 * opens to show the items in it; without, a leaf. Its row is its
 * `TreeItemLabel`, which names it.
 */
function TreeItem({
  className,
  children,
  branch,
  ...props
}: Omit<ComponentProps<typeof TreeItemPrimitive>, 'className' | 'children'> & {
  className?: string
  children?: ReactNode
}) {
  return (
    <TreeItemPrimitive
      // ui-sdk finds a branch by its own group among the children, so it is told of ours.
      branch={branch ?? (holdsGroup(children) || undefined)}
      // Focus sits on the item, and its own row draws the ring: each item sets
      // the ring's width afresh, so a focused branch rings only its own row.
      className={cn(
        'min-w-0 [--tree-item-outline:0px] [--tree-item-ring:0px] focus-visible:outline-0 focus-visible:[--tree-item-outline:2px] focus-visible:[--tree-item-ring:3px]',
        className,
      )}
      {...props}
    >
      {children}
    </TreeItemPrimitive>
  )
}

/** Whether a `TreeGroup` is among `children`, at any depth, as ui-sdk looks for its own. */
function holdsGroup(children: ReactNode): boolean {
  return Children.toArray(children).some(
    (child) =>
      isValidElement<{ children?: ReactNode }>(child) &&
      (child.type === TreeGroup || holdsGroup(child.props.children)),
  )
}

/**
 * The item's row: the chevron of a branch, or its room in a leaf, so labels
 * at one level line up, then what you give it (an icon, the label, anything
 * at its end, as the Waterfall's bar), then the tick of a picked row.
 */
function TreeItemLabel({
  className,
  children,
  ...props
}: Omit<ComponentProps<typeof TreeItemLabelPrimitive>, 'className' | 'children'> & {
  className?: string
  children?: ReactNode
}) {
  const rowOpens = use(RowOpensContext)
  return (
    <TreeItemLabelPrimitive
      className={cn(
        collapsibleRowClassName,
        'group/collapsible-trigger text-foreground cursor-default select-none',
        'transition-[color,background-color,box-shadow] duration-(--motion-press-duration) ease-(--motion-press-fade-easing)',
        'data-disabled:text-foreground/40 [&>svg]:text-muted-foreground',
        // The ring of the item around it. Inset, since an open branch clips what pokes past its first and last rows.
        'ring-ring/50 ring-(length:--tree-item-ring,0px) ring-inset',
        // Forced colours drop the ring: the row takes the system's outline instead.
        'forced-colors:outline-(length:--tree-item-outline,0px) forced-colors:-outline-offset-2 forced-colors:outline-[CanvasText] forced-colors:outline-solid',
        // A picked row takes the Table's tint, and the system's own colours under forced colours.
        pickedRowClassName,
        // Muted text in a tinted row is darker, so it keeps 4.5:1 on the tint.
        tintedRowTextClassName,
        className,
      )}
      {...props}
    >
      {(state) => (
        <>
          {state.branch && rowOpens ? (
            <CollapsibleIndicator open={state.expanded} />
          ) : state.branch ? (
            // A press on the row only picks it, so the chevron opens and closes the
            // branch: ui-sdk's indicator, its target grown to 24px.
            <TreeItemIndicatorPrimitive className='relative flex shrink-0 py-0.5 before:absolute before:-inset-x-1 before:-inset-y-0.5'>
              <CollapsibleIndicator open={state.expanded} />
            </TreeItemIndicatorPrimitive>
          ) : (
            <span aria-hidden className='size-4 shrink-0' />
          )}
          {children}
          {/* Picked shows by more than its tint: the Select's tick, in a slot kept
              for it, so the label never narrows. It stays mounted, and takes the
              Select's leaving look while unpicked. */}
          <span aria-hidden className={cn(menuIndicatorSlot, 'ms-auto')}>
            <span
              data-ending-style={state.selected ? undefined : ''}
              className={menuIndicatorClassName}
            >
              <MenuTick />
            </span>
          </span>
        </>
      )}
    </TreeItemLabelPrimitive>
  )
}

/**
 * The items in a branch, which open and close on the Collapsible's height,
 * under a rail from the branch's chevron. Their labels line up with the
 * branch's.
 */
function TreeGroup({
  className,
  children,
  ...props
}: Omit<ComponentProps<typeof TreeGroupPrimitive>, 'className' | 'children'> & {
  className?: string
  children?: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)

  // Items that come or go while it is open move it on the same transition.
  useEffect(() => {
    const content = ref.current
    const group = content?.parentElement
    if (!content || !group) return
    return followPanelContent(group, content, '--tree-group-height')
  }, [])

  return (
    <TreeGroupPrimitive
      // Clipped down the page only, so a focus ring inside keeps its sides.
      className={cn(
        collapseClassName,
        'overflow-y-clip [--collapse-height:var(--tree-group-height)]',
      )}
      {...props}
    >
      <div
        ref={ref}
        role='none'
        className={cn(
          collapsibleNestedClassName,
          '@max-xs/tree:ps-4 before:start-[calc(var(--control-padding)+--spacing(2))]',
          className,
        )}
      >
        {children}
      </div>
    </TreeGroupPrimitive>
  )
}

export { Tree, TreeGroup, TreeItem, TreeItemLabel }
