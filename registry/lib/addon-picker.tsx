'use client'

import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from '@/registry/components/kino/combobox'
import { InputGroupAddon, InputGroupButton } from '@/registry/components/kino/input-group'
import { OutsideField } from '@/registry/lib/field-control'
import {
  FilterListChevron,
  FilterListMatchedText,
  matchRange,
} from '@/registry/lib/filter-list'
import { MenuShortcut } from '@/registry/lib/menu'
import { Combobox as ComboboxPrimitive } from '@base-ui/react/combobox'
import { useFieldRootContext } from '@base-ui/react/internals/field-root-context'
import { type ReactNode, type RefObject, useMemo, useRef, useState } from 'react'

import { cn } from '@/lib/utils'

/*
 * A picker that sits in a text control's box, at its start or end: a country
 * for a phone number, a currency for an amount. Its button shows the pick;
 * its list is the Combobox's, as wide as the box, with a search at the top.
 * The box is an Input group, or any built on `inputBoxClassName`.
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

/**
 * Whether `option` matches what was typed: a run of its name or a keyword,
 * or the start of its detail, so "44" finds +44 and not +244.
 */
function matchesOption(option: AddonPickerOption, query: string): boolean {
  const words = query.trim()
  if (!words) return true
  if (
    [option.label, ...(option.keywords ?? [])].some((text) => matchRange(text, words))
  ) {
    return true
  }
  // The detail from its start, past a sign such as + or $.
  const typed = words.replace(/^\W+/, '')
  const detail = (option.detail ?? '').replace(/^\W+/, '')
  // A sign alone, such as +, is the start of every detail.
  return typed === '' || matchRange(detail.slice(0, typed.length), typed) !== null
}

/** `options` with those whose name or a keyword starts with `query` first, so Enter after "ger" picks Germany, not Algeria. */
function rankOptions<Option extends AddonPickerOption>(
  options: readonly Option[],
  query: string,
): readonly Option[] {
  const words = query.trim()
  if (!words) return options
  const starts = (option: Option) =>
    [option.label, ...(option.keywords ?? [])].some(
      (text) => matchRange(text, words)?.[0] === 0,
    )
  return [...options.filter(starts), ...options.filter((option) => !starts(option))]
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
  disabled: disabledProp,
  readOnly,
  returnFocus,
  className,
  children,
}: {
  options: readonly AddonPickerOption[]
  value: string
  onValueChange: (value: string) => void
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
  // Read here, since OutsideField hides the Field from the Combobox: a disabled Field disables the pick too.
  const field = useFieldRootContext()
  const disabled = disabledProp || field.disabled === true
  const trigger = useRef<HTMLButtonElement>(null)
  const picked = useRef(false)
  const selected = options.find((option) => option.value === value) ?? null
  const ranked = useMemo(() => rankOptions(options, query), [options, query])
  return (
    <InputGroupAddon
      align={align}
      className={cn(align === 'inline-start' ? 'ps-1' : 'pe-1', className)}
    >
      <OutsideField>
        <Combobox
          items={ranked}
          value={selected}
          onValueChange={(option) => {
            if (!option) return
            picked.current = true
            onValueChange(option.value)
            // Straight away, not once the list has closed, so the next keys reach the field.
            returnFocus?.current?.focus({ preventScroll: true })
          }}
          onInputValueChange={setQuery}
          itemToStringLabel={(option) => option.label}
          isItemEqualToValue={(option, other) => option.value === other.value}
          filter={(option, typed) => matchesOption(option, typed)}
          onOpenChange={(open) => {
            if (open) picked.current = false
          }}
          disabled={disabled}
          readOnly={readOnly}
          // A read-only pick has no list to offer.
          open={readOnly ? false : undefined}
        >
          <ComboboxPrimitive.Trigger
            ref={trigger}
            data-slot='addon-picker-trigger'
            // The detail is in the name too, since the button may show it: speech users say what they see.
            aria-label={
              selected
                ? `${label}: ${selected.label}${selected.detail ? ` (${selected.detail})` : ''}`
                : label
            }
            render={<InputGroupButton className='text-foreground ps-1.5 pe-1' />}
          >
            {children}
            {/* In the button's end slot, which stays still while the pick changes. */}
            <span
              data-slot='addon-picker-chevron'
              data-icon='inline-end'
              className='text-muted-foreground flex'
            >
              <FilterListChevron />
            </span>
          </ComboboxPrimitive.Trigger>
          <ComboboxContent
            aria-label={label}
            anchor={() => fieldOf(trigger.current)}
            finalFocus={() => (picked.current && returnFocus?.current) || true}
          >
            <ComboboxInput
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder}
            />
            <ComboboxEmpty>{noMatch(query)}</ComboboxEmpty>
            <ComboboxList aria-label={label}>
              {(option: AddonPickerOption) => (
                <ComboboxItem key={option.value} value={option}>
                  {option.visual}
                  <span className='min-w-0 flex-1 wrap-break-word'>
                    <FilterListMatchedText text={option.label} query={query.trim()} />
                  </span>
                  {option.detail ? <MenuShortcut>{option.detail}</MenuShortcut> : null}
                </ComboboxItem>
              )}
            </ComboboxList>
          </ComboboxContent>
        </Combobox>
      </OutsideField>
    </InputGroupAddon>
  )
}

export { AddonPicker, matchesOption, rankOptions }
export type { AddonPickerOption }
