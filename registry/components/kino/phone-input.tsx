'use client'

import { inputControlClassName } from '@/registry/components/kino/input'
import { InputGroup, inputGroupBesideStart } from '@/registry/components/kino/input-group'
import { AddonPicker, type AddonPickerOption } from '@/registry/lib/addon-picker'
import { countryAliases, CountryFlag, countryName } from '@/registry/lib/countries'
import { useLocale } from '@/registry/lib/dates'
import {
  changeDetails,
  FieldCheck,
  keptOnReset,
  useField,
} from '@/registry/lib/field-control'
import {
  callingCode,
  caretAt,
  deleteAcross,
  examplePhone,
  phoneChars,
  phoneProblem,
  type PhoneReading,
  readForCountry,
  readPhone,
  readValue,
  wholeNumber,
} from '@/registry/lib/phone-number'
import { markMounted, mergeRefs } from '@/registry/lib/refs'
import type { ChangeDetails } from '@ui-sdk/core'
import { Input as InputPrimitive } from '@ui-sdk/react/input'
import { type CountryCode, getCountries } from 'libphonenumber-js/min'
import {
  type ComponentProps,
  type KeyboardEvent,
  type Ref,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import { cn } from '@/lib/utils'

/*
 * A phone number with its country. The button holds the country's flag and
 * code, `+44`, and the field the rest of the number, `20 7946 0958`,
 * formatted as it is typed; the 0 people type at home falls away. A number
 * typed or pasted with `+` and its code moves the country to it, and the
 * value is the number in E.164 (`+442079460958`), for a form and your server.
 */

interface PhoneInputProps extends Omit<
  ComponentProps<typeof InputPrimitive>,
  | 'value'
  | 'defaultValue'
  | 'onValueChange'
  | 'controller'
  | 'type'
  | 'className'
  | 'children'
> {
  /** The number in E.164, such as `+442079460958`, or `''`. */
  value?: string
  defaultValue?: string
  /** Called with the number in E.164 and who changed it in `details.source`; `details.cancel()` keeps the last number. */
  onValueChange?: (value: string, details: ChangeDetails) => void
  /** An ISO 3166-1 code, such as `GB`. */
  country?: CountryCode
  defaultCountry?: CountryCode
  /** Called with the country, from a pick or a number typed with another's code; `details.cancel()` keeps the last one. */
  onCountryChange?: (country: CountryCode, details: ChangeDetails) => void
  /** The countries the list offers, when not every one. */
  countries?: readonly CountryCode[]
  /** The language of the countries' names; the browser's by default. */
  locale?: string
  /** What the button picks: it reads "Country: United Kingdom, +44". */
  label?: string
  searchPlaceholder?: string
  className?: string
  ref?: Ref<HTMLInputElement>
}

function PhoneInput({
  value: valueProp,
  defaultValue,
  onValueChange,
  country: countryProp,
  defaultCountry = 'US',
  onCountryChange,
  countries,
  locale: localeProp,
  label = 'Country',
  searchPlaceholder = 'Search countries',
  name,
  form,
  required,
  disabled: disabledProp = false,
  readOnly = false,
  placeholder,
  className,
  ref,
  id: idProp,
  onKeyDown,
  onFocus,
  onBlur,
  ...props
}: PhoneInputProps) {
  const locale = useLocale(localeProp)
  const [reading, setReading] = useState(() =>
    readValue(valueProp ?? defaultValue ?? '', countryProp ?? defaultCountry),
  )
  // A value set from outside is shown the field's way, once per change.
  const [synced, setSynced] = useState(valueProp)
  if (valueProp !== synced) {
    setSynced(valueProp)
    if (valueProp !== undefined && valueProp !== reading.value) {
      setReading(readValue(valueProp, countryProp ?? reading.country))
    }
  }
  // The value wins: a number with another country's code shows that country, never a number the form won't get.
  const owned = countryProp ?? reading.country
  const country =
    reading.value && !reading.value.startsWith(`+${callingCode(owned)}`)
      ? reading.country
      : owned
  const input = useRef<HTMLInputElement>(null)
  const caret = useRef<number | null>(null)
  useLayoutEffect(() => {
    if (caret.current === null || !input.current) return
    if (document.activeElement === input.current) {
      input.current.setSelectionRange(caret.current, caret.current)
    }
    caret.current = null
  })

  const problem = phoneProblem(reading.value)
  const field = useField()
  const inputRef = useMemo(
    () => mergeRefs<HTMLInputElement>(input, markMounted, ref),
    [ref],
  )
  const disabled = disabledProp || field?.disabled === true

  /** Tells the owner what `next` changes, and whether to keep it: no unless both take it. */
  function told(next: PhoneReading, details: ChangeDetails) {
    if (next.value !== reading.value) onValueChange?.(next.value, details)
    if (next.country !== country && !details.canceled)
      onCountryChange?.(next.country, details)
    return !details.canceled
  }

  function commit(next: PhoneReading, caretAfter: number, details: ChangeDetails) {
    caret.current = caretAfter
    // A render even when nothing changed, so the caret is placed after React puts the old text back.
    const changed = next.text !== reading.text || next.country !== reading.country
    setReading(changed && told(next, details) ? next : { ...reading })
  }

  /** `text` as the person left it, with the caret at `caretIn`. */
  function take(
    text: string,
    caretIn: number,
    replaced: boolean,
    details: ChangeDetails,
  ) {
    const chars = replaced ? wholeNumber(text, country) : phoneChars(text)
    // Only an edit that adds digits can make the number too long: one too long already (picked for another country) can still be shortened.
    const shorter = !replaced && chars.length <= phoneChars(reading.text).length
    const read = readPhone(chars, country, shorter)
    if (!read) {
      // Too long: the number stays, with the caret after the digit it was after.
      caret.current = caretAt(
        reading.text,
        phoneChars(text.slice(0, caretIn)).length -
          (chars.length - phoneChars(reading.text).length),
      )
      // A render of its own, so the caret is placed after React puts the old text back.
      setReading({ ...reading })
      return
    }
    const before = phoneChars(text.slice(0, caretIn)).length
    // A number that arrived whole leaves the caret at its end.
    const after =
      read.shift === null || replaced
        ? read.reading.text.length
        : caretAt(read.reading.text, before + read.shift)
    commit(read.reading, after, details)
  }

  /** Back to the number it started with, as a form's reset does. */
  function reset(event: Event) {
    if (keptOnReset(valueProp, defaultValue)) return
    const initial = readValue(defaultValue ?? '', countryProp ?? defaultCountry)
    told(initial, changeDetails('reset', event))
    // A reset can't be turned down: the form has already put its fields back.
    setReading(initial)
  }

  function pick(next: string, event: Event | undefined) {
    const read = readForCountry(reading, next as CountryCode)
    caret.current = read.text.length
    if (told(read, changeDetails('item-press', event))) setReading(read)
  }

  const options = useMemo(() => {
    const collator = new Intl.Collator(locale)
    return (countries ?? getCountries())
      .map((code): AddonPickerOption => ({
        value: code,
        label: countryName(code, locale),
        detail: `+${callingCode(code)}`,
        visual: <CountryFlag country={code} />,
        keywords: [code, ...countryAliases(code)],
      }))
      .sort((a, b) => collator.compare(a.label, b.label))
  }, [countries, locale])

  return (
    <InputGroup data-phone-input='' className={className}>
      <AddonPicker
        options={options}
        value={country}
        onValueChange={pick}
        label={label}
        searchPlaceholder={searchPlaceholder}
        noMatch={(query) => `No country matches “${query.trim()}”.`}
        disabled={disabled}
        readOnly={readOnly}
        returnFocus={input}
      >
        <span className='flex items-center gap-1.5'>
          <CountryFlag country={country} />
          <span dir='ltr' className='tabular-nums'>
            +{callingCode(country)}
          </span>
        </span>
      </AddonPicker>
      {/* The number's box is what its Field's label names, its description and check describe; the check below sends the number. */}
      <InputPrimitive
        {...props}
        id={idProp}
        ref={inputRef}
        // The Field's name goes on the check, which sends the number in E.164, not the text shown.
        name={undefined}
        data-phone-input-control=''
        type='tel'
        inputMode='tel'
        autoComplete={props.autoComplete ?? 'tel'}
        // A number reads left to right in every language.
        dir='ltr'
        aria-required={required || undefined}
        value={reading.text}
        placeholder={placeholder ?? examplePhone(country)}
        disabled={disabled}
        readOnly={readOnly}
        onValueChange={(text, details) => {
          // A form's reset is the check's to make.
          if (details.reason === 'reset') return
          // An agent's or a controller's change has no event: a whole number arrived.
          const inputType = (details.event as InputEvent | undefined)?.inputType
          const replaced =
            inputType === undefined ||
            inputType === 'insertFromPaste' ||
            inputType === 'insertReplacementText' ||
            reading.text === ''
          take(text, input.current?.selectionStart ?? text.length, replaced, details)
        }}
        onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
          onKeyDown?.(event)
          if (event.defaultPrevented) return
          if (event.key !== 'Backspace' && event.key !== 'Delete') return
          const target = event.currentTarget
          if (target.readOnly) return
          const start = target.selectionStart ?? 0
          if (
            start !== target.selectionEnd ||
            event.altKey ||
            event.metaKey ||
            event.ctrlKey
          ) {
            return
          }
          const next = deleteAcross(target.value, start, event.key === 'Backspace')
          if (!next) return
          event.preventDefault()
          take(
            next.text,
            next.caret,
            false,
            changeDetails('input-change', event.nativeEvent),
          )
        }}
        onFocus={onFocus}
        onBlur={onBlur}
        className={cn(
          inputControlClassName,
          inputGroupBesideStart,
          'tabular-nums rtl:text-right rtl:placeholder:text-right',
        )}
      />
      <FieldCheck
        value={reading.value}
        name={name ?? field?.name}
        form={form}
        required={required}
        readOnly={readOnly}
        disabled={disabled}
        message={problem}
        onFocus={() => input.current?.focus()}
        onReset={reset}
      />
    </InputGroup>
  )
}

export { PhoneInput }
export type { PhoneInputProps }
