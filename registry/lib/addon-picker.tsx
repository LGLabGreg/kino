'use client'

import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxItemText,
  ComboboxLabel,
  ComboboxList,
  ComboboxTrigger,
} from '@/registry/components/kino/combobox'
import { InputGroupAddon, InputGroupButton } from '@/registry/components/kino/input-group'
import { FilterListChevron } from '@/registry/lib/filter-list'
import { MenuShortcut } from '@/registry/lib/menu'
import { matchRanges } from '@ui-sdk/core/text-match'
import { Field as FieldPrimitive, useFieldControl } from '@ui-sdk/react/field'
import { type ReactNode, type RefObject, useId, useMemo, useRef, useState } from 'react'

import { cn } from '@/lib/utils'

/*
 * A picker that sits in a text control's box, at its start or end: a country
 * for a phone number, a currency for an amount. Its button shows the pick;
 * its list is the Combobox's, as wide as the box, with its search at the
 * top. The box is an Input group, or any built on `inputBoxClassName`.
 */

interface AddonPickerOption {
  value: string
  /** The name the list shows and the search matches, such as "United Kingdom". */
  label: string
  /** What the row shows after the name, such as a dial code; the search matches it too. */
  detail?: string
  /** What the row shows before the name, such as a flag. */
  visual?: ReactNode
  /** Other words the search matches, such as a country's code. */
  keywords?: readonly string[]
}

/** Where `query` first matches in `text`, ignoring case and accents, as ui-sdk's lists match. */
function matchStart(text: string, query: string) {
  return matchRanges(text, query, 'contains')[0]?.start ?? -1
}

/**
 * How well `option` matches what was typed, which ranks the list: 2 when
 * its name or a keyword starts with it, so Enter after "ger" picks Germany,
 * not Algeria; 1 when one holds it, or its detail starts with it, so "44"
 * finds +44 and not +244; 0 when nothing does.
 */
function optionScore(option: AddonPickerOption, query: string): number {
  const words = query.trim()
  if (!words) return 1
  const starts = [option.label, ...(option.keywords ?? [])].map((text) =>
    matchStart(text, words),
  )
  if (starts.includes(0)) return 2
  if (starts.some((start) => start > 0)) return 1
  // The detail from its start, past a sign such as + or $.
  const typed = words.replace(/^\W+/, '')
  const detail = (option.detail ?? '').replace(/^\W+/, '')
  // A sign alone, such as +, is the start of every detail.
  return typed === '' || matchStart(detail.slice(0, typed.length), typed) === 0 ? 1 : 0
}

/** The box the picker sits in (any built on the box every text control has), which its list opens under. */
function fieldOf(trigger: HTMLElement | null) {
  return trigger?.closest<HTMLElement>('.group\\/input') ?? trigger
}

function AddonPicker({
  options,
  value,
  onValueChange,
  label,
  searchPlaceholder,
  noMatch,
  align = 'inline-start',
  disabled,
  readOnly,
  returnFocus,
  className,
  children,
}: {
  options: readonly AddonPickerOption[]
  value: string
  /** Called with the pick and the event behind it. */
  onValueChange: (value: string, event: Event | undefined) => void
  /** What is picked, such as "Country": the button reads "Country: United Kingdom", and the list takes it as its name. */
  label: string
  searchPlaceholder: string
  /** What the list says when nothing matches `query`. */
  noMatch: (query: string) => ReactNode
  align?: 'inline-start' | 'inline-end'
  disabled?: boolean
  readOnly?: boolean
  /** Where focus goes once a pick closes the list, such as the field's input; Escape returns it to the button. */
  returnFocus?: RefObject<HTMLElement | null>
  className?: string
  /** What the button shows: the pick, such as its flag. */
  children: ReactNode
}) {
  const [query, setQuery] = useState('')
  const picked = useRef(false)
  const searchId = useId()
  const [box, setBox] = useState<HTMLElement | null>(null)
  // Read here, since the picker is a Field of its own inside the control's: a
  // disabled Field disables the pick too.
  const outer = useFieldControl()
  const byValue = useMemo(
    () => new Map(options.map((option) => [option.value, option])),
    [options],
  )
  const items = useMemo(
    () =>
      options.map((option) => ({
        value: option.value,
        label: option.label,
        keywords: [...(option.keywords ?? [])],
      })),
    [options],
  )
  const selected = byValue.get(value)
  return (
    <InputGroupAddon
      align={align}
      className={cn(align === 'inline-start' ? 'ps-1' : 'pe-1', className)}
    >
      {/* The control's Field names its input; the picker sits outside it. */}
      <FieldPrimitive className='contents'>
        <Combobox
          items={items}
          value={selected ? value : null}
          onValueChange={(next, details) => {
            if (next === null) return
            picked.current = true
            onValueChange(next, details.event)
          }}
          onOpenChange={(open) => {
            // As the pick closes it, not once it has closed, so the next keys
            // reach the field: while it is open, focus stays in its search.
            if (open || !picked.current) return
            picked.current = false
            returnFocus?.current?.focus({ preventScroll: true })
          }}
          onQueryChange={setQuery}
          filter={(item, typed) => {
            const option = byValue.get(item.value)
            return option ? optionScore(option, typed) : 0
          }}
          disabled={disabled || outer?.disabled === true}
          readOnly={readOnly}
          // A read-only pick has no list to offer.
          open={readOnly ? false : undefined}
        >
          <ComboboxLabel className='sr-only'>{label}</ComboboxLabel>
          <ComboboxTrigger
            ref={(trigger: HTMLButtonElement | null) => setBox(fieldOf(trigger))}
            data-addon-picker-trigger=''
            // The detail is in the name too, since the button may show it: speech users say what they see.
            aria-label={
              selected
                ? `${label}: ${selected.label}${selected.detail ? `, ${selected.detail}` : ''}`
                : label
            }
            render={<InputGroupButton className='text-foreground ps-1.5 pe-1' />}
          >
            {children}
            {/* In the button's end slot, which stays still while the pick changes. */}
            <span
              data-addon-picker-chevron=''
              data-icon='inline-end'
              className='text-muted-foreground flex'
            >
              <FilterListChevron />
            </span>
          </ComboboxTrigger>
          <ComboboxContent aria-label={label} anchor={box}>
            {/* Named by what it shows, not by the picker's label. */}
            <ComboboxInput
              id={searchId}
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder}
              aria-labelledby={searchId}
            />
            <ComboboxEmpty>{noMatch(query)}</ComboboxEmpty>
            <ComboboxList aria-label={label}>
              {(state) =>
                state.items.map((item) => {
                  const option =
                    typeof item === 'object' && 'value' in item
                      ? byValue.get(String(item.value))
                      : undefined
                  if (!option) return null
                  return (
                    <ComboboxItem
                      key={option.value}
                      value={option.value}
                      label={option.label}
                    >
                      {option.visual}
                      <ComboboxItemText className='flex-1 whitespace-normal wrap-break-word'>
                        {option.label}
                      </ComboboxItemText>
                      {option.detail ? (
                        <MenuShortcut>{option.detail}</MenuShortcut>
                      ) : null}
                    </ComboboxItem>
                  )
                })
              }
            </ComboboxList>
          </ComboboxContent>
        </Combobox>
      </FieldPrimitive>
    </InputGroupAddon>
  )
}

export { AddonPicker, optionScore }
export type { AddonPickerOption }
