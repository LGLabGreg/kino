'use client'

import { FieldValues, useLabelFocus } from '@/registry/lib/field-control'
import {
  followPointer,
  itemMatching,
  pickedRowClassName,
  rowHighlightClassName,
  tintedRowTextClassName,
} from '@/registry/lib/highlight'
import {
  menuIndicatorClassName,
  menuIndicatorSlot,
  menuLabelClassName,
  menuNoticeClassName,
  menuRowVariants,
  menuSeparatorClassName,
  MenuTick,
} from '@/registry/lib/menu'
import { pickAll, usePick, useTypeahead } from '@/registry/lib/pick'
import { mergeRefs } from '@/registry/lib/refs'
import { followHeight } from '@/registry/lib/resize'
import { edgeFadeClassName, useEdgeFades } from '@/registry/lib/scroll'
import { useFieldRootContext } from '@base-ui/react/internals/field-root-context'
import {
  useLabelableContext,
  useLabelableId,
} from '@base-ui/react/internals/labelable-provider'
import {
  type ComponentProps,
  createContext,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  use,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'

import { cn } from '@/lib/utils'

/*
 * A list of options that is always in view, by the WAI-ARIA listbox pattern.
 * Its rows and tick are the Select's; its keys, its gliding highlight and
 * its picked tint are the Tree's, which share the pick lib with it.
 */

interface ListboxContextValue {
  selected: readonly string[]
  /** Picks `value` on a press: alone, toggled in a list that picks many, or the range to it. */
  press: (value: string, event: MouseEvent) => void
  multiple: boolean
  disabled: boolean
  /** The option Tab lands on, or null for the list itself. */
  tabStop: string | null
  setTabStop: (value: string | null) => void
  /** Where `ListboxEmpty` shows: beside the list, which holds only options and groups. */
  emptySlot: HTMLElement | null
  /** Whether the list has no options. */
  empty: boolean
}

const ListboxContext = createContext<ListboxContextValue | null>(null)

function useListbox() {
  const context = use(ListboxContext)
  if (!context) throw new Error('A ListboxItem goes inside a Listbox.')
  return context
}

const optionSelector = '[role=option]'

const options = (list: HTMLElement) => [
  ...list.querySelectorAll<HTMLElement>(optionSelector),
]

const valueOf = (option: HTMLElement) => option.dataset.value ?? ''

const disabledOf = (option: HTMLElement) =>
  option.getAttribute('aria-disabled') === 'true'

const pickItemOf = (option: HTMLElement) => ({
  value: valueOf(option),
  disabled: disabledOf(option),
})

/** What typing a name matches: the option's `textValue`, else its text. */
const textOf = (option: HTMLElement) =>
  option.dataset.text ??
  option.querySelector('[data-slot=listbox-item-label]')?.textContent ??
  ''

function Listbox({
  className,
  value,
  defaultValue,
  onValueChange,
  multiple = false,
  disabled: disabledProp = false,
  name: nameProp,
  form,
  children,
  onKeyDown,
  onFocus,
  onBlur,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
  'aria-describedby': ariaDescribedBy,
  'aria-invalid': ariaInvalid,
  ref,
  ...props
}: Omit<ComponentProps<'div'>, 'defaultValue' | 'value'> & {
  /** The picked options, by `value`, when you hold the state. */
  value?: readonly string[]
  /** The options picked at first, when you leave the state to it. */
  defaultValue?: readonly string[]
  onValueChange?: (value: string[]) => void
  /** Whether more than one option can be picked. */
  multiple?: boolean
  /** Whether the whole list is unavailable: it takes no focus and its value isn't sent. */
  disabled?: boolean
  /** Sends each picked value with a form, under this name. */
  name?: string
  /** The form the values go with, when the list sits outside it. */
  form?: string
}) {
  // In a Field, the list takes its label, description, error, name and
  // disabled state from it. A label can't name a listbox for itself, so the
  // list is named by it with `aria-labelledby`.
  const field = useFieldRootContext()
  const { labelId, getDescriptionProps } = useLabelableContext()
  useLabelableId({ id: null })
  const disabled = disabledProp || field.disabled === true
  const name = field.name ?? nameProp
  const invalid = ariaInvalid ?? (field.state.valid === false || undefined)
  const { selected, setSelected, pick } = usePick({
    value,
    defaultValue,
    onValueChange,
    multiple,
  })
  const [tabStop, setTabStop] = useState<string | null>(selected[0] ?? null)
  const [emptySlot, setEmptySlot] = useState<HTMLDivElement | null>(null)
  const fades = useEdgeFades<HTMLDivElement>()
  const [empty, setEmpty] = useState(false)
  const emptyId = useId()
  const boxRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const areaRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const layerRef = useRef<HTMLSpanElement>(null)
  const typeahead = useTypeahead()

  // Whether it has no options, before it paints, so its notice never arrives late.
  useLayoutEffect(() => {
    const list = listRef.current
    if (!list) return
    const count = () => setEmpty(!list.querySelector(optionSelector))
    count()
    const rows = new MutationObserver(count)
    rows.observe(list, { subtree: true, childList: true })
    return () => rows.disconnect()
  }, [])

  // A press on its Field's label goes to the list, as it would to an input.
  const focusList = useCallback(() => {
    const list = listRef.current
    if (list && !list.contains(document.activeElement)) list.focus()
  }, [])
  useLabelFocus(labelId, disabled, focusList)

  useEffect(() => {
    const list = listRef.current
    const area = areaRef.current
    const layer = layerRef.current
    if (!list || !area || !layer) return
    // One highlight for every row, so it glides from row to row.
    // The options' clip follows their height, inside the box that scrolls:
    // options not yet shown, and the copies of ones still leaving, are
    // clipped as the height glides, never something to scroll to.
    const content = contentRef.current
    const stopHeight = content ? followHeight(area, content) : undefined
    const stopHighlight = followPointer(area, layer, {
      itemOf: itemMatching(area, optionSelector),
      focus: true,
    })
    // The option Tab lands on went: Tab lands on the list again.
    const check = () => {
      if (!list.querySelector(`${optionSelector}[tabindex="0"]`)) setTabStop(null)
    }
    check()
    const rows = new MutationObserver(check)
    rows.observe(list, { subtree: true, childList: true })
    return () => {
      stopHighlight()
      stopHeight?.()
      rows.disconnect()
    }
  }, [])

  const among = () => (listRef.current ? options(listRef.current) : [])

  const focusOption = (option: HTMLElement | undefined) => {
    if (!option) return
    setTabStop(valueOf(option))
    option.focus()
  }

  const press = (option: string, event: MouseEvent) => {
    const items = among().map(pickItemOf)
    if (event.shiftKey) pick(option, 'range', items)
    else pick(option, multiple ? 'toggle' : 'only', items)
  }

  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    onKeyDown?.(event)
    if (disabled) return
    const list = listRef.current
    const option = event.target instanceof HTMLElement ? event.target : null
    if (event.defaultPrevented || !list || !option?.matches(optionSelector)) return
    const all = options(list)
    const index = all.indexOf(option)
    if (index === -1) return
    const current = valueOf(option)
    const mod = event.metaKey || event.ctrlKey
    const items = all.map(pickItemOf)

    if (event.key === 'Enter' || (event.key === ' ' && !typeahead.typing(event))) {
      event.preventDefault()
      if (disabledOf(option)) return
      if (event.key === ' ' && event.shiftKey) pick(current, 'range', items)
      else pick(current, multiple ? 'toggle' : 'only', items)
      return
    }

    if (multiple && mod && event.key.toLowerCase() === 'a') {
      event.preventDefault()
      setSelected(pickAll(selected, items))
      return
    }

    const to = listboxMove(all.length, index, event.key)
    if (to !== -1) {
      event.preventDefault()
      const next = all[to]!
      focusOption(next)
      if (!multiple || !event.shiftKey) return
      const end = event.key === 'Home' || event.key === 'End'
      // Shift and an arrow carry the pick along; with Ctrl or ⌘ too, Home and
      // End pick everything from here to that end.
      if (!end && !disabledOf(next)) pick(valueOf(next), 'toggle', items)
      if (end && mod) pick(valueOf(next), 'range', items, current)
      return
    }

    // Typing a name goes to the next option that starts with it.
    const match = typeahead.find(event, all.map(textOf), index)
    if (match !== -1) {
      event.preventDefault()
      focusOption(all[match])
    }
  }

  return (
    <div
      ref={boxRef}
      data-slot='listbox'
      data-disabled={disabled ? '' : undefined}
      className={cn(
        // A box of rows, as a menu is, in the border every field has. Give it
        // a `max-h-` and it scrolls. It moves to the height of its options as
        // they come and go, as the Combobox's box does, and they swap in place.
        'relative flex min-w-0 flex-col overflow-hidden rounded-(--list-radius) border border-input bg-transparent text-sm shadow-xs transition-[border-color,box-shadow] duration-(--motion-press-duration) ease-(--motion-press-fade-easing) has-focus-visible:border-ring has-[[role=listbox]:focus-visible]:ring-3 has-[[role=listbox]:focus-visible]:ring-ring/50 forced-colors:has-[[role=listbox]:focus-visible]:outline-2 forced-colors:has-[[role=listbox]:focus-visible]:outline-[Highlight] has-aria-invalid:border-destructive dark:bg-input/30 dark:has-aria-invalid:border-destructive/70 forced-colors:has-aria-invalid:outline-2 forced-colors:has-aria-invalid:outline-offset-1 forced-colors:has-aria-invalid:outline-dashed data-disabled:opacity-50',
        className,
      )}
    >
      <ListboxContext
        value={{
          selected,
          press,
          multiple,
          disabled,
          tabStop,
          setTabStop,
          emptySlot,
          empty,
        }}
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
              <div
                ref={mergeRefs(listRef, ref)}
                role='listbox'
                aria-label={ariaLabel}
                aria-labelledby={ariaLabelledBy ?? (ariaLabel ? undefined : labelId)}
                aria-describedby={
                  [
                    ariaDescribedBy,
                    getDescriptionProps({})['aria-describedby'],
                    empty ? emptyId : undefined,
                  ]
                    .filter(Boolean)
                    .join(' ') || undefined
                }
                aria-invalid={invalid}
                aria-multiselectable={multiple || undefined}
                aria-disabled={disabled || undefined}
                // Tab lands on the list, which hands focus to the first picked
                // option, else the first: once focus leaves, the list is the stop again.
                tabIndex={disabled ? undefined : tabStop === null ? 0 : -1}
                onKeyDown={keyDown}
                onBlur={(event) => {
                  onBlur?.(event)
                  if (!event.currentTarget.contains(event.relatedTarget)) setTabStop(null)
                }}
                onFocus={(event) => {
                  onFocus?.(event)
                  const list = listRef.current
                  if (!list || event.target !== list) return
                  const all = options(list)
                  focusOption(
                    all.find((each) => each.getAttribute('aria-selected') === 'true') ??
                      all[0],
                  )
                }}
                // The 4px around the rows is the highlight's margin, as in a
                // menu, so it stays the same at every density.
                className='group/menu flex min-w-0 flex-col p-1 focus-visible:outline-hidden'
                {...props}
              >
                {children}
              </div>
              {/* Mounted from the start, so what it says when the list empties is heard. */}
              <div
                ref={setEmptySlot}
                id={emptyId}
                role='status'
                data-slot='listbox-notice'
                className={menuNoticeClassName}
              />
            </div>
            <span
              ref={layerRef}
              aria-hidden
              data-slot='listbox-highlight'
              className={rowHighlightClassName}
            />
          </div>
        </div>
      </ListboxContext>
      <FieldValues name={disabled ? undefined : name} form={form} values={selected} />
    </div>
  )
}

/**
 * An option: the Select's row, with its tick in the gutter before what it
 * shows. `textValue` is what typing its name matches, when its content
 * isn't plain text.
 */
function ListboxItem({
  value,
  disabled: disabledProp = false,
  textValue,
  className,
  children,
  onClick,
  onFocus,
  ref,
  ...props
}: Omit<ComponentProps<'div'>, 'children'> & {
  /** Names the option in the list's `value`; unique in the list. */
  value: string
  disabled?: boolean
  /** What typing the option's name matches, when its content isn't plain text. */
  textValue?: string
  children?: ReactNode
}) {
  const listbox = useListbox()
  const { setTabStop } = listbox
  const disabled = disabledProp || listbox.disabled
  const selected = listbox.selected.includes(value)

  return (
    // Keys are the list's: it moves focus between its options.
    // oxlint-disable-next-line jsx-a11y/click-events-have-key-events
    <div
      ref={ref}
      role='option'
      data-slot='listbox-item'
      data-value={value}
      data-text={textValue}
      aria-selected={selected}
      aria-disabled={disabled || undefined}
      // A list disabled as a whole takes no focus at all.
      tabIndex={listbox.disabled ? undefined : listbox.tabStop === value ? 0 : -1}
      data-selected={selected ? '' : undefined}
      // A list that is disabled as a whole fades once, on its box.
      data-disabled={disabledProp ? '' : undefined}
      onClick={(event) => {
        onClick?.(event)
        if (event.defaultPrevented || disabled) return
        listbox.press(value, event)
      }}
      onFocus={(event) => {
        onFocus?.(event)
        setTabStop(value)
      }}
      {...props}
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
    >
      {/* Picked shows by more than its tint: the Select's tick, in a slot kept
          for it. It stays mounted, and takes the Select's leaving look while
          unpicked. */}
      <span data-menu-indicator='' aria-hidden className={menuIndicatorSlot}>
        <span
          data-ending-style={selected ? undefined : ''}
          className={menuIndicatorClassName}
        >
          <MenuTick />
        </span>
      </span>
      <span
        data-slot='listbox-item-label'
        className='flex min-w-0 flex-1 items-center gap-2'
      >
        {children}
      </span>
    </div>
  )
}

const GroupContext = createContext<string | undefined>(undefined)

/** Options under one heading, named by its `ListboxGroupLabel`. */
function ListboxGroup({ className, children, ...props }: ComponentProps<'div'>) {
  const labelId = useId()
  return (
    <div
      role='group'
      aria-labelledby={labelId}
      data-slot='listbox-group'
      className={cn('flex flex-col', className)}
      {...props}
    >
      <GroupContext value={labelId}>{children}</GroupContext>
    </div>
  )
}

/** A group's heading, lined up with the rows' text. */
function ListboxGroupLabel({ className, ...props }: Omit<ComponentProps<'div'>, 'id'>) {
  const labelId = use(GroupContext)
  return (
    <div
      id={labelId}
      data-slot='listbox-group-label'
      className={cn(menuLabelClassName, className)}
      {...props}
    />
  )
}

/** A line between groups, across the list's 4px margin. Decorative: a listbox holds options and groups only. */
function ListboxSeparator({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      aria-hidden
      data-slot='listbox-separator'
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
  const { emptySlot, empty } = useListbox()
  // Before the list is on the page (rendered on the server), it sits in the
  // list and shows by CSS alone, so it is there when the page paints.
  if (!emptySlot) {
    return (
      <span
        role='none'
        data-slot='listbox-empty'
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
    <span data-slot='listbox-empty' className={className} {...props} />,
    emptySlot,
  )
}

/**
 * The index focus moves to for `key`, from `index` of `count` options, by the
 * WAI-ARIA listbox pattern: arrows stop at the ends. -1 for a key that
 * doesn't move it.
 */
function listboxMove(count: number, index: number, key: string) {
  switch (key) {
    case 'ArrowDown':
      return index < count - 1 ? index + 1 : -1
    case 'ArrowUp':
      return index > 0 ? index - 1 : -1
    case 'Home':
      return count > 0 ? 0 : -1
    case 'End':
      return count - 1
    default:
      return -1
  }
}

export {
  Listbox,
  ListboxEmpty,
  ListboxGroup,
  ListboxGroupLabel,
  ListboxItem,
  ListboxSeparator,
  listboxMove,
}
