'use client'

import { buttonVariants } from '@/registry/components/kino/button'
import { fieldClearClassName } from '@/registry/components/kino/input'
import { labelClassName } from '@/registry/components/kino/label'
import {
  FilterListBody,
  FilterListChevron,
  FilterListClearIcon,
  FilterListInputGroup,
  FilterListRows,
  filterListButtonClassName,
  filterListContentClassName,
  filterListGroupLabelClassName,
  filterListInputClassName,
  filterListItemClassName,
  filterListMatchClassName,
  filterListNoticeClassName,
  filterListScrollerClassName,
  filterListSeparatorClassName,
} from '@/registry/lib/filter-list'
import { POPUP_COLLISION_PADDING, usePopupPresentation } from '@/registry/lib/popup'
import { mergeRefs } from '@/registry/lib/refs'
import { useEdgeFades } from '@/registry/lib/scroll'
import {
  Autocomplete as AutocompletePrimitive,
  AutocompleteClear as AutocompleteClearPrimitive,
  AutocompleteContent as AutocompleteContentPrimitive,
  AutocompleteEmpty as AutocompleteEmptyPrimitive,
  AutocompleteGroup as AutocompleteGroupPrimitive,
  AutocompleteGroupLabel as AutocompleteGroupLabelPrimitive,
  AutocompleteInput as AutocompleteInputPrimitive,
  AutocompleteItem as AutocompleteItemPrimitive,
  AutocompleteItemIcon as AutocompleteItemIconPrimitive,
  AutocompleteItemText as AutocompleteItemTextPrimitive,
  AutocompleteLabel as AutocompleteLabelPrimitive,
  AutocompleteList as AutocompleteListPrimitive,
  type AutocompleteProps,
  AutocompleteSeparator as AutocompleteSeparatorPrimitive,
  AutocompleteStatus as AutocompleteStatusPrimitive,
  AutocompleteTrigger as AutocompleteTriggerPrimitive,
} from '@ui-sdk/react/autocomplete'
import {
  type ComponentProps,
  createContext,
  type ReactNode,
  use,
  useMemo,
  useState,
} from 'react'

import { cn } from '@/lib/utils'

/*
 * ui-sdk's Autocomplete, whose value is the text itself, with the look the
 * lists with an input share (`registry/lib/filter-list`), as the Combobox
 * has it. The box grows out of the field, and as you type it moves to the
 * height of what still matches while one highlight glides between the rows.
 */

type AutocompleteContextValue = {
  /** Where the motion preference is read, for `presentation='auto'`. */
  setControl: (element: HTMLElement | null) => void
  /** The field's box, which the suggestions open under and are as wide as. */
  group: HTMLElement | null
  setGroup: (element: HTMLElement | null) => void
}

const AutocompleteContext = createContext<AutocompleteContextValue | null>(null)

/**
 * The root. With `presentation='auto'`, a small touch screen opens the
 * suggestions as a sheet, unless motion is reduced (`popupPresentation`).
 */
function Autocomplete(props: AutocompleteProps) {
  const [shown, setControl] = usePopupPresentation(props.presentation ?? 'popover')
  const [group, setGroup] = useState<HTMLElement | null>(null)
  const context = useMemo(() => ({ setControl, group, setGroup }), [setControl, group])
  return (
    <AutocompleteContext value={context}>
      <AutocompletePrimitive {...props} presentation={shown} />
    </AutocompleteContext>
  )
}

function AutocompleteLabel({
  className,
  ...props
}: Omit<ComponentProps<typeof AutocompleteLabelPrimitive>, 'className'> & {
  className?: string
}) {
  return (
    <AutocompleteLabelPrimitive className={cn(labelClassName, className)} {...props} />
  )
}

/**
 * The field: the input and the buttons beside it, in the box every text
 * control has. The suggestions open under it.
 */
function AutocompleteInputGroup({
  ref,
  ...props
}: ComponentProps<typeof FilterListInputGroup>) {
  const context = use(AutocompleteContext)
  const refs = useMemo(() => mergeRefs(ref, context?.setGroup), [ref, context])
  return <FilterListInputGroup ref={refs} data-autocomplete-input-group='' {...props} />
}

/** The text you type, which is the value. */
function AutocompleteInput({
  className,
  ref,
  ...props
}: Omit<ComponentProps<typeof AutocompleteInputPrimitive>, 'className'> & {
  className?: string
}) {
  const setControl = use(AutocompleteContext)?.setControl
  const refs = useMemo(() => mergeRefs(ref, setControl), [ref, setControl])
  return (
    <AutocompleteInputPrimitive
      ref={refs}
      className={cn(filterListInputClassName, className)}
      {...props}
    />
  )
}

/** Empties the field; it shows only while there is text. */
function AutocompleteClear({
  className,
  children,
  ...props
}: Omit<ComponentProps<typeof AutocompleteClearPrimitive>, 'className'> & {
  className?: string
}) {
  return (
    <AutocompleteClearPrimitive
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
    </AutocompleteClearPrimitive>
  )
}

/** The chevron at the end of the field: opens the suggestions that match its text. */
function AutocompleteTrigger({
  className,
  ...props
}: Omit<ComponentProps<typeof AutocompleteTriggerPrimitive>, 'className' | 'children'> & {
  className?: string
}) {
  return (
    <AutocompleteTriggerPrimitive
      aria-label='Show suggestions'
      className={cn(
        buttonVariants({ variant: 'ghost', size: 'icon-xs' }),
        filterListButtonClassName,
        className,
      )}
      {...props}
    >
      <FilterListChevron />
    </AutocompleteTriggerPrimitive>
  )
}

/**
 * The box under the field. `className` goes on the box's content; every
 * other prop goes to ui-sdk's content.
 */
function AutocompleteContent({
  className,
  children,
  side = 'bottom',
  align = 'start',
  sideOffset = 6,
  anchor,
  ...props
}: Omit<ComponentProps<typeof AutocompleteContentPrimitive>, 'className' | 'children'> & {
  className?: string
  children?: ReactNode
}) {
  const group = use(AutocompleteContext)?.group
  return (
    <AutocompleteContentPrimitive
      data-filter-list-content=''
      side={side}
      align={align}
      sideOffset={sideOffset}
      collisionPadding={POPUP_COLLISION_PADDING}
      arrowPadding={0}
      anchor={anchor ?? group ?? undefined}
      className={filterListContentClassName}
      {...props}
    >
      {({ presentation }) => (
        <FilterListBody presentation={presentation} className={className}>
          {children}
        </FilterListBody>
      )}
    </AutocompleteContentPrimitive>
  )
}

/**
 * The suggestions, with the highlight that glides between them: rows and
 * groups of your own, or a function of `{ items }`, the ones that still
 * match, when the autocomplete takes `items`.
 */
function AutocompleteList({
  className,
  children,
  ref,
  ...props
}: Omit<ComponentProps<typeof AutocompleteListPrimitive>, 'className'> & {
  className?: string
}) {
  const fades = useEdgeFades<HTMLDivElement>()
  const refs = useMemo(() => mergeRefs(ref, fades), [ref, fades])
  return (
    <AutocompleteListPrimitive
      ref={refs}
      className={filterListScrollerClassName}
      {...props}
    >
      {(state) => (
        <FilterListRows className={className}>
          {typeof children === 'function' ? children(state) : children}
        </FilterListRows>
      )}
    </AutocompleteListPrimitive>
  )
}

/**
 * A suggestion: the menus' row. Picking it puts its text in the field, or
 * its `label` where it holds more than text.
 */
function AutocompleteItem({
  className,
  ...props
}: Omit<ComponentProps<typeof AutocompleteItemPrimitive>, 'className'> & {
  className?: string
}) {
  return (
    <AutocompleteItemPrimitive
      data-menu-row=''
      className={cn(filterListItemClassName, className)}
      {...props}
    />
  )
}

/**
 * A suggestion's text with the part that matches what was typed in bold, so
 * the eye finds why it matched. Without children, its `label` or value.
 */
function AutocompleteItemText({
  className,
  ...props
}: Omit<ComponentProps<typeof AutocompleteItemTextPrimitive>, 'className'> & {
  className?: string
}) {
  return (
    <AutocompleteItemTextPrimitive
      className={cn(filterListMatchClassName, className)}
      {...props}
    />
  )
}

/** A suggestion's icon, before its text. */
function AutocompleteItemIcon({
  className,
  ...props
}: Omit<ComponentProps<typeof AutocompleteItemIconPrimitive>, 'className'> & {
  className?: string
}) {
  return (
    <AutocompleteItemIconPrimitive
      className={cn(
        "flex shrink-0 items-center [&_svg:not([class*='text-'])]:text-muted-foreground",
        className,
      )}
      {...props}
    />
  )
}

function AutocompleteGroup(props: ComponentProps<typeof AutocompleteGroupPrimitive>) {
  return <AutocompleteGroupPrimitive {...props} />
}

function AutocompleteGroupLabel({
  className,
  ...props
}: Omit<ComponentProps<typeof AutocompleteGroupLabelPrimitive>, 'className'> & {
  className?: string
}) {
  return (
    <AutocompleteGroupLabelPrimitive
      className={cn(filterListGroupLabelClassName, className)}
      {...props}
    />
  )
}

function AutocompleteSeparator({
  className,
  ...props
}: Omit<ComponentProps<typeof AutocompleteSeparatorPrimitive>, 'className'> & {
  className?: string
}) {
  return (
    <AutocompleteSeparatorPrimitive
      className={cn(filterListSeparatorClassName, className)}
      {...props}
    />
  )
}

/** What shows when nothing matches, announced as it appears: say what was looked for. */
function AutocompleteEmpty({
  className,
  ...props
}: Omit<ComponentProps<typeof AutocompleteEmptyPrimitive>, 'className'> & {
  className?: string
}) {
  return (
    <AutocompleteEmptyPrimitive
      className={cn(filterListNoticeClassName, className)}
      {...props}
    />
  )
}

/** Announces a search that is running, or how many suggestions it found. */
function AutocompleteStatus({
  className,
  ...props
}: Omit<ComponentProps<typeof AutocompleteStatusPrimitive>, 'className'> & {
  className?: string
}) {
  return (
    <AutocompleteStatusPrimitive
      className={cn(filterListNoticeClassName, className)}
      {...props}
    />
  )
}

export {
  Autocomplete,
  AutocompleteClear,
  AutocompleteContent,
  AutocompleteEmpty,
  AutocompleteGroup,
  AutocompleteGroupLabel,
  AutocompleteInput,
  AutocompleteInputGroup,
  AutocompleteItem,
  AutocompleteItemIcon,
  AutocompleteItemText,
  AutocompleteLabel,
  AutocompleteList,
  AutocompleteSeparator,
  AutocompleteStatus,
  AutocompleteTrigger,
}
