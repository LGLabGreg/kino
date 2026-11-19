'use client'

import {
  CollapsibleIndicator,
  collapsibleNestedClassName,
  collapsibleRowClassName,
} from '@/registry/components/kino/collapsible'
import { useControllable } from '@/registry/lib/controllable'
import {
  followPointer,
  itemMatching,
  pickedRowClassName,
  rowHighlightClassName,
  tintedRowTextClassName,
} from '@/registry/lib/highlight'
import { menuIndicatorClassName, menuIndicatorSlot, MenuTick } from '@/registry/lib/menu'
import { type PickHow, pickAll, usePick, useTypeahead } from '@/registry/lib/pick'
import { mergeRefs } from '@/registry/lib/refs'
import { collapseClassName, followPanelContent } from '@/registry/lib/resize'
import { Collapsible as CollapsiblePrimitive } from '@base-ui/react/collapsible'
import {
  type ComponentProps,
  createContext,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  use,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react'

import { cn } from '@/lib/utils'

/*
 * A hierarchy, such as files or pages, by the WAI-ARIA tree pattern. Its rows
 * are the Collapsible's: a branch's chevron turns down and its items open on
 * the Collapsible's height, under a rail from the chevron. One highlight
 * glides from row to row under the pointer and with focus, as the Table's
 * does, and picked rows take the Table's tint.
 */

interface TreeContextValue {
  expanded: readonly string[]
  setOpen: (value: string, open: boolean) => void
  selected: readonly string[]
  /** Picks `value`, toggles it in a tree that picks many, or picks the items from the anchor to it. */
  pick: (value: string, how: PickHow) => void
  multiple: boolean
  /** The item Tab lands on, or null for the first one shown. */
  tabStop: string | null
  setTabStop: (value: string | null) => void
}

const TreeContext = createContext<TreeContextValue | null>(null)

function useTree() {
  const context = use(TreeContext)
  if (!context) throw new Error('A TreeItem goes inside a Tree.')
  return context
}

/** How deep an item is: 1 at the top. */
const LevelContext = createContext(1)

const itemSelector = '[role=treeitem]'

/** The items a person can see now: none inside a branch that is closed or closing. */
function shownItems(tree: HTMLElement) {
  return [...tree.querySelectorAll<HTMLElement>(itemSelector)].filter(
    (item) =>
      !item.parentElement?.closest(
        '[data-slot=tree-group]:is([data-closed],[data-ending-style])',
      ),
  )
}

const nodeOf = (item: HTMLElement): TreeNode => {
  const expanded = item.getAttribute('aria-expanded')
  return {
    level: Number(item.getAttribute('aria-level')) || 1,
    expanded: expanded === null ? null : expanded === 'true',
    disabled: item.getAttribute('aria-disabled') === 'true',
  }
}

const valueOf = (item: HTMLElement) => item.dataset.value ?? ''

const pickItemOf = (item: HTMLElement) => ({
  value: valueOf(item),
  disabled: nodeOf(item).disabled,
})

const textOf = (item: HTMLElement) =>
  item.querySelector('[data-slot=tree-item-label]')?.textContent ?? ''

function Tree({
  className,
  expanded: expandedProp,
  defaultExpanded = [],
  onExpandedChange,
  value: valueProp,
  defaultValue = [],
  onValueChange,
  multiple = false,
  children,
  onKeyDown,
  onFocus,
  onBlur,
  ref,
  ...props
}: Omit<ComponentProps<'ul'>, 'defaultValue' | 'value'> & {
  /** The branches that are open, by `value`, when you hold the state. */
  expanded?: readonly string[]
  /** The branches open at first, when you leave the state to it. */
  defaultExpanded?: readonly string[]
  onExpandedChange?: (expanded: string[]) => void
  /** The picked items, by `value`, when you hold the state. */
  value?: readonly string[]
  /** The items picked at first, when you leave the state to it. */
  defaultValue?: readonly string[]
  onValueChange?: (value: string[]) => void
  /** Whether more than one item can be picked. */
  multiple?: boolean
}) {
  const [expanded, setExpanded] = useControllable<readonly string[]>(
    expandedProp,
    defaultExpanded,
    onExpandedChange && ((next) => onExpandedChange([...next])),
  )
  const {
    selected,
    setSelected,
    pick: pickAmong,
  } = usePick({ value: valueProp, defaultValue, onValueChange, multiple })
  const [tabStop, setTabStop] = useState<string | null>(selected[0] ?? null)
  const treeRef = useRef<HTMLUListElement>(null)
  const areaRef = useRef<HTMLDivElement>(null)
  const layerRef = useRef<HTMLSpanElement>(null)
  const typeahead = useTypeahead()

  const setOpen = (value: string, open: boolean) => {
    if (expanded.includes(value) === open) return
    setExpanded(open ? [...expanded, value] : expanded.filter((each) => each !== value))
  }

  const pick = (value: string, how: PickHow, from?: string) => {
    const tree = treeRef.current
    if (!tree) return
    pickAmong(value, how, shownItems(tree).map(pickItemOf), from)
  }

  useEffect(() => {
    const tree = treeRef.current
    const area = areaRef.current
    const layer = layerRef.current
    if (!tree || !area || !layer) return
    // One highlight for every row, so it glides from row to row.
    const stopHighlight = followPointer(area, layer, {
      itemOf: itemMatching(area, itemSelector),
      focus: true,
    })
    // The item Tab lands on went (its branch closed, or it was removed): Tab
    // lands on the first item shown again.
    const check = () => {
      if (!tree.querySelector(`${itemSelector}[tabindex="0"]`)) setTabStop(null)
    }
    check()
    const items = new MutationObserver(check)
    items.observe(tree, { subtree: true, childList: true })
    return () => {
      stopHighlight()
      items.disconnect()
    }
  }, [])

  const focusItem = (item: HTMLElement | undefined) => {
    if (!item) return
    setTabStop(valueOf(item))
    item.focus()
  }

  const keyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    onKeyDown?.(event)
    const tree = treeRef.current
    const item = event.target instanceof HTMLElement ? event.target : null
    if (event.defaultPrevented || !tree || !item?.matches(itemSelector)) return
    if (item.closest('[role=tree]') !== tree) return
    const items = shownItems(tree)
    const index = items.indexOf(item)
    if (index === -1) return
    const node = nodeOf(item)
    const value = valueOf(item)
    const mod = event.metaKey || event.ctrlKey
    // A space is part of a name while one is being typed.
    const typing = typeahead.typing(event)

    if (event.key === 'Enter' || (event.key === ' ' && !typing)) {
      event.preventDefault()
      if (node.disabled) return
      const branch = node.expanded !== null
      // Enter opens or closes a branch; picking many, it leaves the pick to Space.
      if (event.key === 'Enter' && branch) setOpen(value, !node.expanded)
      if (event.key === 'Enter' && multiple && branch) return
      if (event.key === ' ' && event.shiftKey) pick(value, 'range')
      else pick(value, multiple ? 'toggle' : 'only')
      return
    }

    if (multiple && mod && event.key.toLowerCase() === 'a') {
      event.preventDefault()
      setSelected(pickAll(selected, items.map(pickItemOf)))
      return
    }

    const rtl = getComputedStyle(tree).direction === 'rtl'
    const action = treeKeyAction(items.map(nodeOf), index, event.key, rtl)
    if (action) {
      event.preventDefault()
      if (action.type === 'focus') {
        const next = items[action.index]
        focusItem(next)
        // Shift and an arrow carry the pick along, in a tree that picks many;
        // with Ctrl or ⌘ too, Home and End pick everything from here to that end.
        if (next && multiple && event.shiftKey) {
          const end = event.key === 'Home' || event.key === 'End'
          const arrow = event.key === 'ArrowUp' || event.key === 'ArrowDown'
          if (arrow && !nodeOf(next).disabled) pick(valueOf(next), 'toggle')
          if (end && mod) pick(valueOf(next), 'range', value)
        }
      } else if (action.type === 'close') {
        setOpen(valueOf(items[action.index]!), false)
      } else {
        const values = action.indices.map((each) => valueOf(items[each]!))
        setExpanded([...new Set([...expanded, ...values])])
      }
      return
    }

    // Typing a name goes to the next item shown that starts with it.
    const match = typeahead.find(event, items.map(textOf), index)
    if (match !== -1) {
      event.preventDefault()
      focusItem(items[match])
    }
  }

  return (
    <div
      ref={areaRef}
      data-slot='tree'
      className={cn('@container/tree relative isolate min-w-0', className)}
    >
      <TreeContext
        value={{
          expanded,
          setOpen,
          selected,
          pick,
          multiple,
          tabStop,
          setTabStop,
        }}
      >
        <ul
          ref={mergeRefs(treeRef, ref)}
          role='tree'
          aria-multiselectable={multiple || undefined}
          // Tab lands on the tree, which hands focus to the first picked item,
          // else the first: once focus leaves, the tree is the stop again.
          tabIndex={tabStop === null ? 0 : -1}
          onKeyDown={keyDown}
          onBlur={(event) => {
            onBlur?.(event)
            if (!event.currentTarget.contains(event.relatedTarget)) setTabStop(null)
          }}
          onFocus={(event) => {
            onFocus?.(event)
            const tree = treeRef.current
            if (!tree || event.target !== tree) return
            const items = shownItems(tree)
            focusItem(
              items.find((item) => item.getAttribute('aria-selected') === 'true') ??
                items[0],
            )
          }}
          className='flex min-w-0 flex-col gap-px focus-visible:outline-hidden'
          {...props}
        >
          <LevelContext value={1}>{children}</LevelContext>
        </ul>
      </TreeContext>
      <span
        ref={layerRef}
        aria-hidden
        data-slot='tree-highlight'
        className={rowHighlightClassName}
      />
    </div>
  )
}

/** The branch's items, which open and close on the Collapsible's height. */
function TreeGroup({ id, children }: { id: string; children: ReactNode }) {
  const ref = useRef<HTMLUListElement>(null)

  useEffect(() => {
    const group = ref.current
    const panel = group?.parentElement
    if (!group || !panel) return
    return followPanelContent(panel, group, '--collapsible-panel-height')
  }, [])

  return (
    <CollapsiblePrimitive.Panel
      data-slot='tree-group'
      // Clipped down the page only, so a focus ring inside keeps its sides.
      className={cn(
        collapseClassName,
        'overflow-y-clip [--collapse-height:var(--collapsible-panel-height)]',
      )}
    >
      {/* The rail runs down from the branch's chevron; its items' labels line up with the branch's. */}
      <ul
        ref={ref}
        id={id}
        role='group'
        className={cn(
          collapsibleNestedClassName,
          '@max-xs/tree:ps-4 before:start-[calc(var(--control-padding)+--spacing(2))]',
        )}
      >
        {children}
      </ul>
    </CollapsiblePrimitive.Panel>
  )
}

/**
 * One item. With `children`, even none, it is a branch that opens to show
 * them, each a `TreeItem`; without, a leaf. The row is the `treeitem`, and
 * it owns its branch's group, so its name is its own label alone.
 */
function TreeItem({
  value,
  label,
  icon,
  aside,
  disabled = false,
  className,
  children,
  onClick,
  onFocus,
  ref,
  ...props
}: Omit<ComponentProps<'div'>, 'value' | 'children'> & {
  /** The branch's items, each a `TreeItem`; even none makes it a branch. */
  children?: ReactNode
  /** Names the item in `expanded` and `value`; unique in the tree. */
  value: string
  /** What the row shows. Its text is what typing an item's name finds. */
  label: ReactNode
  /** Shown before the label, sized by the row. */
  icon?: ReactNode
  /** Shown after the label, at the row's end, such as a Waterfall's bar. It is part of the row's name. */
  aside?: ReactNode
  disabled?: boolean
}) {
  const tree = useTree()
  const { setTabStop } = tree
  const level = use(LevelContext)
  const groupId = useId()
  const rowRef = useRef<HTMLDivElement>(null)
  const branch = children !== undefined && children !== null && children !== false
  const open = branch && tree.expanded.includes(value)
  const selected = tree.selected.includes(value)

  // A branch that closes with focus inside it, from elsewhere, takes the focus.
  useEffect(() => {
    const row = rowRef.current
    const item = row?.parentElement
    if (open || !row || !item) return
    const active = document.activeElement
    if (active !== row && active instanceof HTMLElement && item.contains(active)) {
      setTabStop(value)
      row.focus()
    }
  }, [open, setTabStop, value])

  const click = (event: MouseEvent<HTMLDivElement>) => {
    onClick?.(event)
    if (event.defaultPrevented || disabled) return
    if (!tree.multiple) {
      tree.pick(value, 'only')
      if (branch) tree.setOpen(value, !open)
      return
    }
    // Picking many, a press on a branch opens or closes it, so looking inside
    // never changes the pick; Shift, or Ctrl or ⌘, picks it.
    if (event.shiftKey) tree.pick(value, 'range')
    else if (!branch || event.metaKey || event.ctrlKey) tree.pick(value, 'toggle')
    else tree.setOpen(value, !open)
  }

  const row = (
    // Keys are the tree's: it moves focus between its rows.
    // oxlint-disable-next-line jsx-a11y/click-events-have-key-events
    <div
      ref={mergeRefs(rowRef, ref)}
      role='treeitem'
      data-slot='tree-item-row'
      data-value={value}
      aria-level={level}
      aria-selected={selected}
      aria-expanded={branch ? open : undefined}
      aria-owns={open ? groupId : undefined}
      aria-disabled={disabled || undefined}
      tabIndex={tree.tabStop === value ? 0 : -1}
      data-selected={selected ? '' : undefined}
      data-disabled={disabled ? '' : undefined}
      data-panel-open={open ? '' : undefined}
      onClick={click}
      onFocus={(event) => {
        onFocus?.(event)
        setTabStop(value)
      }}
      {...props}
      className={cn(
        collapsibleRowClassName,
        'group/collapsible-trigger text-foreground cursor-default select-none',
        'transition-[color,background-color,box-shadow] duration-(--motion-press-duration) ease-(--motion-press-fade-easing)',
        'data-disabled:text-foreground/40 [&>svg:not([data-slot=collapsible-indicator])]:text-muted-foreground',
        // Inset, since an open branch clips what pokes past its first and last rows.
        'focus-visible:ring-ring/50 focus-visible:ring-3 focus-visible:ring-inset focus-visible:outline-hidden forced-colors:[&[data-selected]]:focus-visible:outline-[CanvasText]',
        // A picked row takes the Table's tint, and the system's own colours under forced colours.
        pickedRowClassName,
        // Muted text in a tinted row is darker, so it keeps 4.5:1 on the tint.
        tintedRowTextClassName,
        className,
      )}
    >
      {/* A leaf keeps the chevron's room, so labels at one level line up. */}
      {branch ? (
        <CollapsibleIndicator />
      ) : (
        <span aria-hidden className='size-4 shrink-0' />
      )}
      {icon}
      <span data-slot='tree-item-label' className='min-w-0 flex-1 wrap-break-word'>
        {label}
      </span>
      {aside}
      {/* Picked shows by more than its tint: the Select's tick, in a slot kept
          for it, so the label never narrows. It stays mounted, and takes the
          Select's leaving look while unpicked. */}
      <span aria-hidden className={menuIndicatorSlot}>
        <span
          data-ending-style={selected ? undefined : ''}
          className={menuIndicatorClassName}
        >
          <MenuTick />
        </span>
      </span>
    </div>
  )

  const item = { role: 'none', 'data-slot': 'tree-item', className: 'min-w-0' } as const

  if (!branch) {
    return <li {...item}>{row}</li>
  }

  return (
    <CollapsiblePrimitive.Root
      open={open}
      onOpenChange={(next) => tree.setOpen(value, next)}
      disabled={disabled}
      render={<li {...item} />}
    >
      {row}
      <LevelContext value={level + 1}>
        <TreeGroup id={groupId}>{children}</TreeGroup>
      </LevelContext>
    </CollapsiblePrimitive.Root>
  )
}

/** An item shown, as the keys see it: how deep, open or closed (null for a leaf), and disabled. */
interface TreeNode {
  level: number
  expanded: boolean | null
  disabled: boolean
}

/** What a key does: move focus, open branches, or close one. */
type TreeKeyAction =
  | { type: 'focus'; index: number }
  | { type: 'open'; indices: number[] }
  | { type: 'close'; index: number }
  | null

/**
 * What `key` does on the item at `index` of the items shown, by the WAI-ARIA
 * tree pattern. Right to left swaps the left and right arrows.
 */
function treeKeyAction(
  nodes: readonly TreeNode[],
  index: number,
  key: string,
  rtl = false,
): TreeKeyAction {
  const node = nodes[index]
  if (!node) return null
  const inward = rtl ? 'ArrowLeft' : 'ArrowRight'
  const outward = rtl ? 'ArrowRight' : 'ArrowLeft'
  const parentOf = (at: number) => {
    for (let each = at - 1; each >= 0; each--) {
      if (nodes[each]!.level < nodes[at]!.level) return each
    }
    return -1
  }
  switch (key) {
    case 'ArrowDown':
      return index < nodes.length - 1 ? { type: 'focus', index: index + 1 } : null
    case 'ArrowUp':
      return index > 0 ? { type: 'focus', index: index - 1 } : null
    case 'Home':
      return { type: 'focus', index: 0 }
    case 'End':
      return { type: 'focus', index: nodes.length - 1 }
    case inward:
      if (node.expanded === false)
        return node.disabled ? null : { type: 'open', indices: [index] }
      if (node.expanded && nodes[index + 1]?.level === node.level + 1) {
        return { type: 'focus', index: index + 1 }
      }
      return null
    case outward: {
      if (node.expanded && !node.disabled) return { type: 'close', index }
      const parent = parentOf(index)
      return parent === -1 ? null : { type: 'focus', index: parent }
    }
    case '*': {
      const parent = parentOf(index)
      const indices: number[] = []
      for (let each = parent + 1; each < nodes.length; each++) {
        const sibling = nodes[each]!
        if (sibling.level < node.level) break
        if (
          sibling.level === node.level &&
          sibling.expanded === false &&
          !sibling.disabled
        ) {
          indices.push(each)
        }
      }
      return { type: 'open', indices }
    }
    default:
      return null
  }
}

export { Tree, TreeItem, treeKeyAction }
export type { TreeKeyAction, TreeNode }
