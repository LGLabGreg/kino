'use client'

import {
  FilterListClear,
  FilterListContent,
  FilterListEmpty,
  FilterListGroupLabel,
  FilterListInput,
  FilterListInputGroup,
  FilterListItem,
  FilterListList,
  FilterListMatchedText,
  FilterListSeparator,
  FilterListStatus,
  FilterListTrigger,
  MatchLocaleContext,
} from '@/registry/lib/filter-list'
import { matchRange } from '@/registry/lib/match'
import { Autocomplete as AutocompletePrimitive } from '@base-ui/react/autocomplete'
import type { ComponentProps } from 'react'

import { cn } from '@/lib/utils'

/*
 * Base UI's Autocomplete is the Combobox's parts on a root whose value is the
 * text itself, so they come from the filter-list lib the Combobox uses. The box
 * grows out of the field, and as you type it moves to the height of what
 * still matches while one highlight glides between the rows.
 */

/** Base UI's Autocomplete. Its `locale` also decides which part of a suggestion `AutocompleteMatch` marks. */
const Autocomplete = ((props: AutocompletePrimitive.Root.Props<unknown>) => (
  <MatchLocaleContext value={props.locale}>
    <AutocompletePrimitive.Root {...props} />
  </MatchLocaleContext>
)) as typeof AutocompletePrimitive.Root

/**
 * The field: the input and the buttons beside it, in the box every text
 * control has. The suggestions open under it.
 */
function AutocompleteInputGroup(props: ComponentProps<typeof FilterListInputGroup>) {
  return <FilterListInputGroup data-slot='autocomplete-input-group' {...props} />
}

/** The text you type, which is the value. */
function AutocompleteInput(props: ComponentProps<typeof FilterListInput>) {
  return <FilterListInput data-slot='autocomplete-input' {...props} />
}

/** Empties the field; it shows only while there is text. */
function AutocompleteClear(props: ComponentProps<typeof FilterListClear>) {
  return <FilterListClear data-slot='autocomplete-clear' {...props} />
}

/** The chevron at the end of the field: opens the suggestions that match its text. */
function AutocompleteTrigger(
  props: Omit<ComponentProps<typeof FilterListTrigger>, 'children'>,
) {
  return <FilterListTrigger data-slot='autocomplete-trigger' {...props} />
}

/**
 * The box under the field. `className` goes on the box's content; every
 * other prop goes to Base UI's Popup.
 */
function AutocompleteContent(props: ComponentProps<typeof FilterListContent>) {
  return <FilterListContent data-slot='autocomplete-content' {...props} />
}

/**
 * The suggestions, with the highlight that glides between them. Give it a
 * function child, called for each one that matches what was typed, or rows
 * and groups of your own.
 */
function AutocompleteList(props: ComponentProps<typeof FilterListList>) {
  return <FilterListList data-slot='autocomplete-list' {...props} />
}

/** A suggestion: the menus' row. Picking it puts its text in the field. */
function AutocompleteItem(
  props: Omit<ComponentProps<typeof FilterListItem>, 'indicator'>,
) {
  return <FilterListItem data-slot='autocomplete-item' {...props} />
}

function AutocompleteGroup(props: AutocompletePrimitive.Group.Props) {
  return <AutocompletePrimitive.Group data-slot='autocomplete-group' {...props} />
}

function AutocompleteGroupLabel(props: ComponentProps<typeof FilterListGroupLabel>) {
  return <FilterListGroupLabel data-slot='autocomplete-group-label' {...props} />
}

function AutocompleteSeparator(props: ComponentProps<typeof FilterListSeparator>) {
  return <FilterListSeparator data-slot='autocomplete-separator' {...props} />
}

const AutocompleteCollection = AutocompletePrimitive.Collection

const AutocompleteValue = AutocompletePrimitive.Value

/** What shows when nothing matches: say what was looked for. */
function AutocompleteEmpty(props: ComponentProps<typeof FilterListEmpty>) {
  return <FilterListEmpty data-slot='autocomplete-empty' {...props} />
}

/** Announces a search that is running, or how many suggestions it found. */
function AutocompleteStatus(props: ComponentProps<typeof FilterListStatus>) {
  return <FilterListStatus data-slot='autocomplete-status' {...props} />
}

/**
 * A suggestion's text with the part that matches what was typed in bold, so
 * the eye finds why it matched. It reads the field itself.
 */
function AutocompleteMatch({
  className,
  children,
  ...props
}: Omit<ComponentProps<'span'>, 'children'> & { children: string }) {
  return (
    <span data-slot='autocomplete-match' className={cn('min-w-0', className)} {...props}>
      <AutocompletePrimitive.Value>
        {(query) => <FilterListMatchedText text={children} query={query} />}
      </AutocompletePrimitive.Value>
    </span>
  )
}

export {
  Autocomplete,
  AutocompleteClear,
  AutocompleteCollection,
  AutocompleteContent,
  AutocompleteEmpty,
  AutocompleteGroup,
  AutocompleteGroupLabel,
  AutocompleteInput,
  AutocompleteInputGroup,
  AutocompleteItem,
  AutocompleteList,
  AutocompleteMatch,
  AutocompleteSeparator,
  AutocompleteStatus,
  AutocompleteTrigger,
  AutocompleteValue,
  matchRange,
}
