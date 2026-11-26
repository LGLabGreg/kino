'use client'

import { buttonVariants } from '@/registry/components/kino/button'
import {
  fieldClearClassName,
  focusControl,
  InputInvalidIcon,
  inputBoxClassName,
} from '@/registry/components/kino/input'
import { labelClassName } from '@/registry/components/kino/label'
import { IconPlaceholder } from '@/registry/icons/icon-placeholder'
import {
  ChipRemoveIcon,
  chipClassName,
  chipLeavingClassName,
  chipRemoveClassName,
} from '@/registry/lib/chip'
import { CutTooltip } from '@/registry/lib/cut'
import { useFieldProps } from '@/registry/lib/field-control'
import {
  FilterListBody,
  FilterListChevron,
  FilterListClearIcon,
  FilterListInputGroup,
  FilterListRows,
  FilterListValue,
  filterListButtonClassName,
  filterListContentClassName,
  filterListGroupLabelClassName,
  filterListInputClassName,
  filterListItemClassName,
  filterListMatchClassName,
  filterListNoticeClassName,
  filterListScrollerClassName,
  filterListSeparatorClassName,
  filterListValueTriggerClassName,
} from '@/registry/lib/filter-list'
import { useFlow } from '@/registry/lib/flow'
import {
  listIndicatorClassName,
  menuIndicatorSlot,
  MenuTick,
} from '@/registry/lib/list-rows'
import { POPUP_COLLISION_PADDING, usePopupPresentation } from '@/registry/lib/popup'
import { markMounted, mergeRefs } from '@/registry/lib/refs'
import { useEdgeFades } from '@/registry/lib/scroll'
import {
  Combobox as ComboboxPrimitive,
  ComboboxChip as ComboboxChipPrimitive,
  ComboboxChipRemove as ComboboxChipRemovePrimitive,
  ComboboxChips as ComboboxChipsPrimitive,
  ComboboxClear as ComboboxClearPrimitive,
  ComboboxContent as ComboboxContentPrimitive,
  ComboboxCreate as ComboboxCreatePrimitive,
  ComboboxEmpty as ComboboxEmptyPrimitive,
  ComboboxGroup as ComboboxGroupPrimitive,
  ComboboxGroupLabel as ComboboxGroupLabelPrimitive,
  ComboboxInput as ComboboxInputPrimitive,
  ComboboxItem as ComboboxItemPrimitive,
  ComboboxItemIcon as ComboboxItemIconPrimitive,
  ComboboxItemIndicator as ComboboxItemIndicatorPrimitive,
  ComboboxItemText as ComboboxItemTextPrimitive,
  ComboboxLabel as ComboboxLabelPrimitive,
  ComboboxList as ComboboxListPrimitive,
  type ComboboxProps,
  ComboboxSeparator as ComboboxSeparatorPrimitive,
  ComboboxStatus as ComboboxStatusPrimitive,
  ComboboxTrigger as ComboboxTriggerPrimitive,
  ComboboxValue as ComboboxValuePrimitive,
  ComboboxValueIcon as ComboboxValueIconPrimitive,
} from '@ui-sdk/react/combobox'
import { Field as FieldPrimitive } from '@ui-sdk/react/field'
import {
  type ComponentProps,
  createContext,
  type ReactNode,
  use,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react'

import { cn } from '@/lib/utils'

/*
 * ui-sdk's Combobox, with the look the lists with an input share
 * (`registry/lib/filter-list`). The box grows out of the field, and as you
 * type it moves to the height of what still matches, on `layout`. The rows
 * swap in place, and one highlight glides to the row ui-sdk highlights.
 */

type ComboboxContextValue = {
  /** Where the motion preference is read, for `presentation='auto'`. */
  setControl: (element: HTMLElement | null) => void
  /** A trigger with the value inside, when the input sits in the popup. */
  button: HTMLElement | null
  setButton: (element: HTMLElement | null) => void
  /** The field's box, which the list opens under and is as wide as. */
  group: HTMLElement | null
  setGroup: (element: HTMLElement | null) => void
  /** Where focus goes back to as a list with its search inside closes: its trigger, or what it opens from. */
  setReturnTo: (element: HTMLElement | null) => void
  /** Whether the input sits in the popup, as the list's search. */
  setSearchInPopup: (inPopup: boolean) => void
}

const ComboboxContext = createContext<ComboboxContextValue | null>(null)

/** Whether a part sits in the popup, where an input is the list's search. */
const InPopupContext = createContext(false)

/**
 * The root. As you type, the first match is highlighted, so Enter picks it;
 * pass `autoHighlight={false}` to leave the highlight to the arrow keys.
 * With `presentation='auto'`, a small touch screen opens the list as a
 * sheet, unless motion is reduced (`popupPresentation`). With the value in
 * its trigger (`ComboboxTrigger` with children), the input sits at the top
 * of the list: it opens empty with focus in it, and focus goes back to the
 * trigger when the list has closed.
 */
function Combobox<Value = string, Multiple extends boolean | undefined = false>(
  props: ComboboxProps<Value, Multiple>,
) {
  const [shown, setControl] = usePopupPresentation(props.presentation ?? 'popover')
  const [button, setButton] = useState<HTMLElement | null>(null)
  const [group, setGroup] = useState<HTMLElement | null>(null)
  const [searchInPopup, setSearchInPopup] = useState(false)
  const returnTo = useRef<HTMLElement | null>(null)
  const [setReturnTo] = useState(() => (element: HTMLElement | null) => {
    returnTo.current = element
  })
  const [ownQuery, setOwnQuery] = useState(props.defaultQuery ?? '')
  const context = useMemo(
    () => ({
      setControl,
      button,
      setButton,
      group,
      setGroup,
      setReturnTo,
      setSearchInPopup,
    }),
    [setControl, button, group, setReturnTo],
  )
  return (
    <ComboboxContext value={context}>
      <ComboboxPrimitive<Value, Multiple>
        // With the value on a trigger, as a select, the picked row is highlighted as it opens.
        autoHighlight={button ? 'selected' : true}
        {...props}
        presentation={shown}
        // Held here, so a search in the popup starts from nothing each time it opens.
        query={props.query ?? ownQuery}
        defaultQuery={undefined}
        onQueryChange={(next, details) => {
          setOwnQuery(next)
          props.onQueryChange?.(next, details)
        }}
        onOpenChange={(open, details) => {
          props.onOpenChange?.(open, details)
          if (details.canceled) return
          if (open) {
            if (searchInPopup) setOwnQuery('')
            // ui-sdk hands focus back, as it closes, to what had it as it
            // opened: the button it opens from, even when a press opened it.
            button?.focus({ preventScroll: true })
            return
          }
          if (!searchInPopup) return
          // Back where it opened from as it closes, unless focus went on
          // somewhere else, such as where the callback sent it. Once the
          // pick has rendered, so the button reads the new value as focus lands.
          queueMicrotask(() => {
            const left = document.activeElement
            if (left === document.body || left?.closest('[data-filter-list-content]'))
              returnTo.current?.focus({ preventScroll: true })
          })
        }}
      />
    </ComboboxContext>
  )
}

function ComboboxLabel({
  className,
  ...props
}: Omit<ComponentProps<typeof ComboboxLabelPrimitive>, 'className'> & {
  className?: string
}) {
  return <ComboboxLabelPrimitive className={cn(labelClassName, className)} {...props} />
}

/**
 * The field: the input and the buttons beside it, in the box every text
 * control has. The list opens under it and is as wide as it.
 */
function ComboboxInputGroup({
  ref,
  ...props
}: ComponentProps<typeof FilterListInputGroup>) {
  const context = use(ComboboxContext)
  const refs = useMemo(() => mergeRefs(ref, context?.setGroup), [ref, context])
  return <FilterListInputGroup ref={refs} data-combobox-input-group='' {...props} />
}

/**
 * The text you type. In a field or among chips it fills the room left; in
 * the list's box, with the value in the trigger, it is the box's search line,
 * named by its `aria-label`, since the trigger is the Field's control then.
 */
function ComboboxInput({
  className,
  ref,
  ...props
}: Omit<ComponentProps<typeof ComboboxInputPrimitive>, 'className'> & {
  className?: string
}) {
  const context = use(ComboboxContext)
  const inPopup = use(InPopupContext)
  const refs = useMemo(() => mergeRefs(ref, context?.setControl), [ref, context])
  const setSearchInPopup = context?.setSearchInPopup
  useEffect(() => {
    if (inPopup) setSearchInPopup?.(true)
  }, [inPopup, setSearchInPopup])
  const input = (
    <ComboboxInputPrimitive
      ref={refs}
      className={cn(
        filterListInputClassName,
        // Among chips: a chip's height, beside the last chip, and never
        // narrower than a short word; a longer placeholder ends in an ellipsis.
        'in-data-[slot=combobox-chips]:h-(--control-height-xs) in-data-[slot=combobox-chips]:min-w-28 in-data-[slot=combobox-chips]:text-ellipsis in-data-[slot=combobox-chips]:px-1.5',
        // Among chips it glides on `layout` to where a chip that came or went
        // leaves it (`followFlow`), from where it was seen.
        'in-data-[slot=combobox-chips]:[transition:translate_var(--motion-layout-duration)_var(--motion-layout-easing)] data-[flow=start]:transition-none motion-reduce:transition-none',
        className,
      )}
      // In the popup, it takes focus as the popup opens, so what you type after a press lands in it.
      // oxlint-disable-next-line jsx-a11y/no-autofocus -- it mounts only as its popup opens, never with the page.
      autoFocus={inPopup || undefined}
      {...props}
    />
  )
  // In the popup it is the list's search, a field of its own: the Field
  // around the combobox names its trigger.
  if (context?.button)
    return <FieldPrimitive className='contents'>{input}</FieldPrimitive>
  return input
}

/** Empties the value; it shows only while there is one. */
function ComboboxClear({
  className,
  children,
  ...props
}: Omit<ComponentProps<typeof ComboboxClearPrimitive>, 'className'> & {
  className?: string
}) {
  return (
    <ComboboxClearPrimitive
      data-field-clear=''
      aria-label='Clear'
      className={cn(
        buttonVariants({ variant: 'ghost', size: 'icon-xs' }),
        filterListButtonClassName,
        fieldClearClassName,
        className,
      )}
      {...props}
    >
      {children ?? <FilterListClearIcon />}
    </ComboboxClearPrimitive>
  )
}

/**
 * Opens the list. In a field it is the chevron at its end. On its own, with
 * the value inside (`ComboboxValue`), the list's search sits at the list's
 * top: it looks like a select and is the Field's control, or, with
 * `render`, it is that element with its children, such as a button inside
 * another control's box.
 */
function ComboboxTrigger({
  className,
  children,
  ref,
  render,
  ...props
}: Omit<ComponentProps<typeof ComboboxTriggerPrimitive>, 'className' | 'children'> & {
  className?: string
  children?: ReactNode
}) {
  const context = use(ComboboxContext)
  const withValue = children !== undefined
  const refs = useMemo(
    () => mergeRefs(ref, context?.setControl, withValue ? context?.setButton : undefined),
    [ref, context, withValue],
  )
  if (!withValue) {
    return (
      <ComboboxTriggerPrimitive
        ref={refs}
        aria-label='Show options'
        className={cn(
          buttonVariants({ variant: 'ghost', size: 'icon-xs' }),
          filterListButtonClassName,
          className,
        )}
        render={render}
        {...props}
      >
        <FilterListChevron />
      </ComboboxTriggerPrimitive>
    )
  }
  if (render) {
    return (
      <ComboboxTriggerPrimitive
        ref={refs}
        className={className}
        render={render}
        {...props}
      >
        {children}
      </ComboboxTriggerPrimitive>
    )
  }
  return (
    <ComboboxValueTrigger ref={refs} className={className} {...props}>
      {children}
    </ComboboxValueTrigger>
  )
}

/** A trigger with the value in it, as a select's: the Field's control, so its label names it and a press on the label opens it. */
function ComboboxValueTrigger({
  className,
  children,
  ...props
}: Omit<ComponentProps<typeof ComboboxTriggerPrimitive>, 'className' | 'children'> & {
  className?: string
  children?: ReactNode
}) {
  const valueId = useId()
  const { props: own } = useFieldProps(props)
  const labelledBy = own['aria-labelledby']
  return (
    <CutTooltip
      render={
        <ComboboxTriggerPrimitive
          className={cn(filterListValueTriggerClassName, className)}
          {...own}
          // Named by its label and the value it shows, as a select is.
          aria-labelledby={labelledBy ? `${labelledBy} ${valueId}` : undefined}
        >
          <FilterListValue id={valueId}>{children}</FilterListValue>
        </ComboboxTriggerPrimitive>
      }
    />
  )
}

/**
 * The picked value, as a function of `{ value, label, labels }`, or the
 * labels joined. Inside a trigger, the placeholder shows while nothing is
 * picked: `{(state) => state.label || 'Pick a country'}`.
 */
const ComboboxValue = ComboboxValuePrimitive

/** The picked row's icon, beside the value in a trigger. */
function ComboboxValueIcon(props: ComponentProps<typeof ComboboxValueIconPrimitive>) {
  return <ComboboxValueIconPrimitive {...props} />
}

/** What moves among the chips: the chips and the input after them. */
const flowItems = '[data-slot=combobox-chip], [data-slot=combobox-input]'

/**
 * The picked values, as chips, with the input after the last one: the field
 * of a combobox that takes many. Render each value as a `ComboboxChip` in a
 * `ComboboxValue`. A chip that comes or goes moves the others to their new
 * places, across lines too, and the field grows or shrinks a line at a time,
 * on `layout`; a chip that goes fades where it was.
 */
function ComboboxChips({
  className,
  children,
  ref,
  ...props
}: Omit<ComponentProps<typeof ComboboxChipsPrimitive>, 'className' | 'children'> & {
  className?: string
  children?: ReactNode
}) {
  const refs = useMemo(() => mergeRefs(markMounted, ref), [ref])
  return (
    <ComboboxChipsPrimitive
      ref={refs}
      onPointerDown={focusControl}
      className={cn(
        inputBoxClassName,
        // It wraps, so its corner is capped.
        'group/chips min-h-(--control-height) cursor-text rounded-(--control-radius-capped)',
        className,
      )}
      {...props}
    >
      <ChipsFlow>{children}</ChipsFlow>
      <InputInvalidIcon className='pe-1' />
    </ComboboxChipsPrimitive>
  )
}

/*
 * The frame moves to the row's height as it wraps, and the row's chips flow.
 * A component of its own, so the effect has its elements on the first render.
 */
function ChipsFlow({ children }: { children: ReactNode }) {
  const { frame, row } = useFlow<HTMLDivElement, HTMLDivElement>(flowItems)
  return (
    <div
      ref={frame}
      className='min-w-0 flex-1 self-stretch overflow-clip transition-[height] duration-(--motion-layout-duration) ease-(--motion-layout-easing) motion-reduce:transition-none'
    >
      <div
        ref={row}
        data-combobox-chips-row=''
        // A chip sits the same distance from every edge of the box as from
        // the next chip, at every density.
        className='relative isolate flex min-h-[calc(var(--control-height)-2px)] flex-wrap items-center gap-1 p-[calc((var(--control-height)-var(--control-height-xs)-2px)/2)]'
      >
        {children}
      </div>
    </div>
  )
}

/**
 * A picked value, with its remove button, "Remove" and its label. Arrow keys
 * reach it from the input; Backspace or Delete removes it. It scales in when
 * picked. Without children, it shows the value's label.
 */
function ComboboxChip<Value = string>({
  className,
  children,
  ...props
}: Omit<ComponentProps<typeof ComboboxChipPrimitive<Value>>, 'className' | 'children'> & {
  className?: string
  children?: ReactNode
}) {
  return (
    <CutTooltip
      render={
        <ComboboxChipPrimitive<Value>
          className={cn(
            chipClassName,
            // Above the input, whose caret and placeholder glide behind the chips.
            'z-1 ps-2 data-disabled:pe-2 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-hidden forced-colors:focus-visible:outline-2 forced-colors:focus-visible:outline-solid',
            // It scales in on `enter` once the field has painted, glides to a new
            // place on `layout` (`followFlow`), and its copy fades and shrinks
            // where it was on `exit`. A chip pointed out (`data-flash`), such as
            // one typed again, inverts for a moment on `press`.
            '[transition:opacity_var(--motion-enter-duration)_var(--motion-enter-easing),scale_var(--motion-enter-duration)_var(--motion-enter-easing),translate_var(--motion-layout-duration)_var(--motion-layout-easing),color_var(--motion-press-duration)_var(--motion-press-fade-easing),background-color_var(--motion-press-duration)_var(--motion-press-fade-easing),box-shadow_var(--motion-press-duration)_var(--motion-press-fade-easing)] group-data-mounted/chips:starting:opacity-0 motion-safe:group-data-mounted/chips:starting:scale-75',
            'data-[flow=start]:[transition:opacity_var(--motion-enter-duration)_var(--motion-enter-easing),scale_var(--motion-enter-duration)_var(--motion-enter-easing),color_var(--motion-press-duration)_var(--motion-press-fade-easing),background-color_var(--motion-press-duration)_var(--motion-press-fade-easing),box-shadow_var(--motion-press-duration)_var(--motion-press-fade-easing)] motion-reduce:[transition:opacity_var(--motion-enter-duration)_var(--motion-enter-easing),color_var(--motion-press-duration)_var(--motion-press-fade-easing),background-color_var(--motion-press-duration)_var(--motion-press-fade-easing),box-shadow_var(--motion-press-duration)_var(--motion-press-fade-easing)]',
            chipLeavingClassName,
            'data-flash:bg-foreground data-flash:text-background forced-colors:data-flash:outline-2 forced-colors:data-flash:outline-offset-1',
            className,
          )}
          {...props}
        >
          {(state) => (
            <>
              <span data-cut className='min-w-0 truncate'>
                {children ?? state.label}
              </span>
              <ComboboxChipRemovePrimitive
                aria-label={`Remove ${state.label}`}
                className={cn(
                  chipRemoveClassName,
                  'in-data-flash:text-background data-disabled:hidden',
                )}
              >
                <ChipRemoveIcon />
              </ComboboxChipRemovePrimitive>
            </>
          )}
        </ComboboxChipPrimitive>
      }
    />
  )
}

/**
 * The rows, with the highlight that glides between them: rows and groups of
 * your own, or a function of `{ items }`, the items that still match, when
 * the combobox takes `items`. It scrolls once it is taller than the box allows.
 */
function ComboboxList({
  className,
  children,
  ref,
  ...props
}: Omit<ComponentProps<typeof ComboboxListPrimitive>, 'className'> & {
  className?: string
}) {
  const fades = useEdgeFades<HTMLDivElement>()
  const refs = useMemo(() => mergeRefs(ref, fades), [ref, fades])
  return (
    <ComboboxListPrimitive ref={refs} className={filterListScrollerClassName} {...props}>
      {(state) => (
        <FilterListRows className={className}>
          {typeof children === 'function' ? children(state) : children}
        </FilterListRows>
      )}
    </ComboboxListPrimitive>
  )
}

/**
 * A row: the menus' own, with the tick first, as on the Select. Its text is
 * what the input shows once picked, or `label` where it holds more than
 * text; put it in a `ComboboxItemText` to mark what matched.
 */
function ComboboxItem<Value = string>({
  className,
  children,
  indicator = true,
  ...props
}: Omit<ComponentProps<typeof ComboboxItemPrimitive<Value>>, 'className' | 'children'> & {
  className?: string
  children?: ReactNode
  /** Whether the row keeps room for the tick of a picked value. Off for a list that never shows one. */
  indicator?: boolean
}) {
  return (
    <ComboboxItemPrimitive<Value>
      data-menu-row=''
      className={cn(filterListItemClassName, className)}
      {...props}
    >
      {indicator ? (
        <span data-menu-indicator='' className={menuIndicatorSlot}>
          <ComboboxItemIndicatorPrimitive keepMounted className={listIndicatorClassName}>
            <MenuTick />
          </ComboboxItemIndicatorPrimitive>
        </span>
      ) : null}
      {children}
    </ComboboxItemPrimitive>
  )
}

/** A row's text, with the part that matched what was typed in bold. */
function ComboboxItemText({
  className,
  ...props
}: Omit<ComponentProps<typeof ComboboxItemTextPrimitive>, 'className'> & {
  className?: string
}) {
  return (
    <ComboboxItemTextPrimitive
      className={cn(filterListMatchClassName, className)}
      {...props}
    />
  )
}

/** A row's icon, before its text. */
function ComboboxItemIcon({
  className,
  ...props
}: Omit<ComponentProps<typeof ComboboxItemIconPrimitive>, 'className'> & {
  className?: string
}) {
  return (
    <ComboboxItemIconPrimitive
      className={cn(
        "flex shrink-0 items-center [&_svg:not([class*='text-'])]:text-muted-foreground",
        className,
      )}
      {...props}
    />
  )
}

/**
 * The row that adds what was typed, while no row's label matches it
 * exactly: "Create" and the text, or your own words. `onCreate` saves it;
 * picking it doesn't change the value by itself.
 */
function ComboboxCreate({
  className,
  children,
  ...props
}: Omit<ComponentProps<typeof ComboboxCreatePrimitive>, 'className' | 'children'> & {
  className?: string
  children?: ReactNode | ((state: { query: string; pending: boolean }) => ReactNode)
}) {
  return (
    <ComboboxCreatePrimitive
      data-menu-row=''
      className={cn(
        filterListItemClassName,
        'data-pending:text-muted-foreground',
        className,
      )}
      {...props}
    >
      {(state) => (
        <>
          <span data-menu-indicator='' className={menuIndicatorSlot}>
            <CreateRowIcon />
          </span>
          <span className='min-w-0'>
            {typeof children === 'function'
              ? children(state)
              : (children ?? `Create “${state.query}”`)}
          </span>
        </>
      )}
    </ComboboxCreatePrimitive>
  )
}

function CreateRowIcon() {
  return (
    <IconPlaceholder
      lucide='PlusIcon'
      tabler='IconPlus'
      hugeicons='PlusSignIcon'
      phosphor='PlusIcon'
      remixicon='RiAddLine'
      aria-hidden
    />
  )
}

function ComboboxGroup(props: ComponentProps<typeof ComboboxGroupPrimitive>) {
  return <ComboboxGroupPrimitive {...props} />
}

function ComboboxGroupLabel({
  className,
  ...props
}: Omit<ComponentProps<typeof ComboboxGroupLabelPrimitive>, 'className'> & {
  className?: string
}) {
  return (
    <ComboboxGroupLabelPrimitive
      className={cn(filterListGroupLabelClassName, className)}
      {...props}
    />
  )
}

function ComboboxSeparator({
  className,
  ...props
}: Omit<ComponentProps<typeof ComboboxSeparatorPrimitive>, 'className'> & {
  className?: string
}) {
  return (
    <ComboboxSeparatorPrimitive
      className={cn(filterListSeparatorClassName, className)}
      {...props}
    />
  )
}

/** What shows when nothing matches, announced as it appears: say what was looked for. */
function ComboboxEmpty({
  className,
  ...props
}: Omit<ComponentProps<typeof ComboboxEmptyPrimitive>, 'className'> & {
  className?: string
}) {
  return (
    <ComboboxEmptyPrimitive
      className={cn(filterListNoticeClassName, className)}
      {...props}
    />
  )
}

/** Announces a search that is running, or how many results it found. */
function ComboboxStatus({
  className,
  ...props
}: Omit<ComponentProps<typeof ComboboxStatusPrimitive>, 'className'> & {
  className?: string
}) {
  return (
    <ComboboxStatusPrimitive
      className={cn(filterListNoticeClassName, className)}
      {...props}
    />
  )
}

/**
 * The box, under the field, the chips or the trigger. `className` goes on
 * the box's content; every other prop goes to ui-sdk's content.
 */
function ComboboxContent({
  className,
  children,
  side = 'bottom',
  align = 'start',
  sideOffset = 6,
  anchor,
  ...props
}: Omit<ComponentProps<typeof ComboboxContentPrimitive>, 'className' | 'children'> & {
  className?: string
  children?: ReactNode
}) {
  const context = use(ComboboxContext)
  const opener = anchor ?? context?.group ?? context?.button ?? null
  useEffect(() => {
    context?.setReturnTo(
      context.button ?? (anchor instanceof HTMLElement ? anchor : null),
    )
  })
  return (
    <ComboboxContentPrimitive
      data-filter-list-content=''
      side={side}
      align={align}
      sideOffset={sideOffset}
      collisionPadding={POPUP_COLLISION_PADDING}
      arrowPadding={0}
      anchor={opener ?? undefined}
      className={filterListContentClassName}
      {...props}
    >
      {({ presentation }) => (
        <FilterListBody presentation={presentation} className={className}>
          <InPopupContext value>{children}</InPopupContext>
        </FilterListBody>
      )}
    </ComboboxContentPrimitive>
  )
}

export {
  Combobox,
  ComboboxChip,
  ComboboxChips,
  ComboboxClear,
  ComboboxContent,
  ComboboxCreate,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxGroupLabel,
  ComboboxInput,
  ComboboxInputGroup,
  ComboboxItem,
  ComboboxItemIcon,
  ComboboxItemText,
  ComboboxLabel,
  ComboboxList,
  ComboboxSeparator,
  ComboboxStatus,
  ComboboxTrigger,
  ComboboxValue,
  ComboboxValueIcon,
}
