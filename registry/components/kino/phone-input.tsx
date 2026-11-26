'use client'

import { inputControlClassName } from '@/registry/components/kino/input'
import { InputGroup, inputGroupBesideStart } from '@/registry/components/kino/input-group'
import { AddonPicker, type AddonPickerOption } from '@/registry/lib/addon-picker'
import { countryAliases, CountryFlag, countryName } from '@/registry/lib/countries'
import { useLocale } from '@/registry/lib/dates'
import { FieldCheck, keptOnReset, useFieldProps } from '@/registry/lib/field-control'
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
  ComponentProps<'input'>,
  'value' | 'defaultValue' | 'onChange' | 'type' | 'className' | 'children'
> {
  /** The number in E.164, such as `+442079460958`, or `''`. */
  value?: string
  defaultValue?: string
  onValueChange?: (value: string) => void
  /** An ISO 3166-1 code, such as `GB`. */
  country?: CountryCode
  defaultCountry?: CountryCode
  onCountryChange?: (country: CountryCode) => void
  /** The countries the list offers, when not every one. */
  countries?: readonly CountryCode[]
  /** The language of the countries' names; the browser's by default. */
  locale?: string
  /** What the button picks: it reads "Country: United Kingdom (+44)". */
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
  // The number's box is what its Field's label names, its description and check describe.
  const { field, invalid, props: inputProps } = useFieldProps({ ...props, id: idProp })
  const fieldRef = inputProps.ref
  const inputRef = useMemo(
    () => mergeRefs<HTMLInputElement>(input, markMounted, ref, fieldRef),
    [ref, fieldRef],
  )
  const disabled = disabledProp || field?.disabled === true

  function commit(next: PhoneReading, caretAfter: number) {
    caret.current = caretAfter
    // A render even when nothing changed, so the caret is placed after React puts the old text back.
    setReading(
      next.text === reading.text && next.country === reading.country
        ? { ...reading }
        : next,
    )
    if (next.value !== reading.value) onValueChange?.(next.value)
    if (next.country !== country) onCountryChange?.(next.country)
  }

  /** `text` as the person left it, with the caret at `caretIn`. */
  function take(text: string, caretIn: number, replaced: boolean) {
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
    commit(read.reading, after)
  }

  /** Back to the number it started with, as a form's reset does. */
  function reset() {
    if (keptOnReset(valueProp, defaultValue)) return
    const initial = readValue(defaultValue ?? '', countryProp ?? defaultCountry)
    setReading(initial)
    if (initial.value !== reading.value) onValueChange?.(initial.value)
    if (initial.country !== country) onCountryChange?.(initial.country)
  }

  function pick(next: string) {
    const picked = next as CountryCode
    const read = readForCountry(reading, picked)
    caret.current = read.text.length
    setReading(read)
    if (read.value !== reading.value) onValueChange?.(read.value)
    if (picked !== country) onCountryChange?.(picked)
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
      <input
        {...inputProps}
        ref={inputRef}
        data-slot='phone-input-control'
        type='tel'
        inputMode='tel'
        autoComplete={props.autoComplete ?? 'tel'}
        // A number reads left to right in every language.
        dir='ltr'
        aria-invalid={invalid || props['aria-invalid'] || undefined}
        aria-required={required || undefined}
        value={reading.text}
        placeholder={placeholder ?? examplePhone(country)}
        disabled={disabled}
        readOnly={readOnly}
        onChange={(event) => {
          const native = event.nativeEvent as InputEvent
          const replaced =
            native.inputType === undefined ||
            native.inputType === 'insertFromPaste' ||
            native.inputType === 'insertReplacementText' ||
            reading.text === ''
          take(
            event.target.value,
            event.target.selectionStart ?? event.target.value.length,
            replaced,
          )
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
          take(next.text, next.caret, false)
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
