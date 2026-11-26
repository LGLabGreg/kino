'use client'

import {
  focusControl,
  InputInvalidIcon,
  inputBoxClassName,
} from '@/registry/components/kino/input'
import {
  NumberField,
  RollingInput,
  useNumberFieldInputId,
} from '@/registry/components/kino/number-field'
import { AddonPicker, type AddonPickerOption } from '@/registry/lib/addon-picker'
import { CountryFlag } from '@/registry/lib/countries'
import { FieldValues, useFieldProps } from '@/registry/lib/field-control'
import { numberFormatter } from '@/registry/lib/number-format'
import { createChangeEventDetails } from '@base-ui/react/internals/createBaseUIEventDetails'
import { REASONS } from '@base-ui/react/internals/reasons'
import { NumberField as NumberFieldPrimitive } from '@base-ui/react/number-field'
import {
  createContext,
  type RefObject,
  use,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react'

import { cn } from '@/lib/utils'

/*
 * An amount of money: the currency's symbol where the locale writes it,
 * digits grouped as they're typed, the currency's own number of decimals,
 * and the value in minor units (cents), so no amount is ever a float.
 */

/** How a locale writes an amount in a currency. */
interface MoneyFormat {
  locale: Intl.LocalesArgument
  currency: string
  /** Decimals in the currency's minor unit: 2 for USD, 0 for JPY, 3 for KWD. */
  digits: number
  symbol: string
  /** The symbol's side, in reading order. */
  side: 'start' | 'end'
  /** Whether a space parts the symbol from the digits. */
  spaced: boolean
  /** The currency's name, such as "US Dollar". */
  name: string
  decimal: string
  group: string
  /** The locale's digits, 0 to 9. */
  numerals: string[]
  /** The locale's own direction, which the amount and its symbol keep on any page. */
  direction: 'ltr' | 'rtl'
}

// Scripts written right to left, from Unicode's list of those in use today.
const RTL_SCRIPTS = new Set([
  'Arab',
  'Hebr',
  'Thaa',
  'Syrc',
  'Nkoo',
  'Adlm',
  'Rohg',
  'Mand',
])

/** Which way a locale writes, from its script. */
function localeDirection(locale: string): 'ltr' | 'rtl' {
  const script = new Intl.Locale(locale).maximize().script
  return script && RTL_SCRIPTS.has(script) ? 'rtl' : 'ltr'
}

// Bidi marks, which right-to-left locales put around the symbol and the sign.
const FORMAT_CONTROLS = /\p{Cf}/gu
const SPACE = /\p{Zs}/u

function moneyFormat(locale: Intl.LocalesArgument, currency: string): MoneyFormat {
  const money = numberFormatter(locale, { style: 'currency', currency })
  const parts = money.formatToParts(1)
  const symbolAt = parts.findIndex((part) => part.type === 'currency')
  const numberAt = parts.findIndex((part) => part.type === 'integer')
  const between = parts.slice(
    Math.min(symbolAt, numberAt) + 1,
    Math.max(symbolAt, numberAt),
  )
  const plain = numberFormatter(locale, { useGrouping: true })
  const separators = plain.formatToParts(11111.1)
  return {
    locale,
    currency,
    digits: money.resolvedOptions().maximumFractionDigits ?? 2,
    symbol: (parts[symbolAt]?.value ?? currency).replace(FORMAT_CONTROLS, ''),
    side: symbolAt < numberAt ? 'start' : 'end',
    spaced: between.some((part) => SPACE.test(part.value)),
    name: new Intl.DisplayNames(locale, { type: 'currency' }).of(currency) ?? currency,
    decimal: separators.find((part) => part.type === 'decimal')?.value ?? '.',
    group: separators.find((part) => part.type === 'group')?.value ?? ',',
    numerals: Array.from({ length: 10 }, (_, digit) =>
      numberFormatter(locale, { useGrouping: false }).format(digit),
    ),
    direction: localeDirection(money.resolvedOptions().locale),
  }
}

// Digits in the numeral systems people type: ASCII, Arabic-Indic, Persian and fullwidth.
const DIGIT = /[0-9٠-٩۰-۹０-９]/
const MINUS = /[-−－‒–—﹣]/
const POINTS = ['.', ',', '٫', '．', '，']

/** A typed or pasted digit as ASCII, or null when the character isn't one. */
function asciiDigit(char: string): string | null {
  if (!DIGIT.test(char)) return null
  // Each block starts at a multiple of 16, so the code point says the digit.
  return char <= '9' ? char : String((char.codePointAt(0) ?? 0) % 16)
}

/** The most digits before the point, so the amount in minor units stays a safe integer. */
function maxIntegerDigits(digits: number) {
  return 15 - digits
}

/** An amount's sign and digits, as typed: no grouping, ASCII digits, `.` as the point. */
interface Amount {
  negative: boolean
  integer: string
  /** The point and what follows it, or null without one. */
  fraction: string | null
}

/** Writes an amount in the locale's digits and separators, grouped. */
function writeAmount({ negative, integer, fraction }: Amount, format: MoneyFormat) {
  const numerals = (ascii: string) =>
    Array.from(ascii, (char) => format.numerals[Number(char)]).join('')
  const grouped =
    integer === ''
      ? ''
      : numberFormatter(format.locale, { useGrouping: true }).format(BigInt(integer))
  return `${negative ? '-' : ''}${grouped}${fraction === null ? '' : format.decimal + numerals(fraction)}`
}

/**
 * The text a person typed, grouped again, and where the caret goes: after as
 * many digits, signs and points as it had before it. Group separators typed
 * by hand are dropped, since grouping is the field's job; `.` or `,` is the
 * point unless the locale groups with it. Digits past the currency's decimals
 * are left out.
 */
function regroup(
  text: string,
  caret: number,
  format: MoneyFormat,
  allowNegative: boolean,
): { text: string; caret: number } {
  let negative = false
  let integer = ''
  let fraction: string | null = null
  // How many of the digits and points kept came before the caret; the sign is counted apart.
  let beforeCaret = 0
  let index = 0
  for (const char of text.replace(FORMAT_CONTROLS, '')) {
    const digit = asciiDigit(char)
    let keep = false
    if (digit !== null) {
      if (fraction !== null) keep = fraction.length < format.digits
      else keep = integer.length < maxIntegerDigits(format.digits)
      if (keep && fraction !== null) fraction += digit
      else if (keep) integer += digit
    } else if (MINUS.test(char)) {
      // A minus anywhere keeps the amount negative; it is written in front.
      negative ||= allowNegative
    } else if (
      char === format.decimal ||
      (POINTS.includes(char) && char !== format.group)
    ) {
      keep = fraction === null && format.digits > 0
      if (keep) fraction = ''
    }
    if (keep && index < caret) beforeCaret += 1
    index += char.length
  }
  // Leading zeros go, but for one before the point; the caret loses those it passed.
  const zeros =
    integer === '' ? 0 : integer.length - (integer.replace(/^0+/, '') || '0').length
  beforeCaret -= Math.min(zeros, beforeCaret)
  const written = writeAmount(
    { negative, integer: integer.slice(zeros), fraction },
    format,
  )
  // The caret goes after the sign and as many digits and points.
  let count = 0
  let position = negative ? 1 : 0
  for (const char of written.slice(position)) {
    if (count === beforeCaret) break
    position += char.length
    if (asciiDigit(char) !== null || char === format.decimal) count += 1
  }
  return { text: written, caret: position }
}

/**
 * The amount in pasted text, in minor units, or null when it holds no digits.
 * It reads any symbol, code, sign or grouping: "$1,234.56", "1.234,56 €",
 * "USD 1,234", "(1,234)" or "1 234,56". The last `.` or `,` is the point
 * when both are used; one used several times groups; one used once is the
 * point when the decimals it leaves fit the currency or nothing but zeros
 * comes before it, and groups when three digits follow it that don't.
 */
function parseMoney(text: string, digits: number): number | null {
  const clean = text.replace(FORMAT_CONTROLS, '').trim()
  const negative = MINUS.test(clean) || /^\(.*\)$/.test(clean)
  const body = Array.from(clean)
    .map((char) => asciiDigit(char) ?? (POINTS.includes(char) ? char : ''))
    .join('')
    .replace(/[٫．]/g, '.')
    .replace(/，/g, ',')
  if (!/\d/.test(body)) return null
  const lastDot = body.lastIndexOf('.')
  const lastComma = body.lastIndexOf(',')
  let point = -1
  if (lastDot !== -1 && lastComma !== -1) point = Math.max(lastDot, lastComma)
  else {
    const at = Math.max(lastDot, lastComma)
    const mark = body[at]
    const once = at !== -1 && body.indexOf(mark) === at
    const after = body.length - at - 1
    const lead = body.slice(0, at).replace(/\D/g, '')
    if (once && (after <= digits || after !== 3 || /^0*$/.test(lead))) point = at
  }
  const integer = (point === -1 ? body : body.slice(0, point)).replace(/\D/g, '')
  const fraction = point === -1 ? '' : body.slice(point + 1).replace(/\D/g, '')
  // Decimals past the currency's round half up.
  const kept = fraction.slice(0, digits).padEnd(digits, '0')
  const roundUp = Number(fraction[digits] ?? '0') >= 5
  const minor = BigInt(`${integer || '0'}${kept}`) + (roundUp ? 1n : 0n)
  if (minor > BigInt(Number.MAX_SAFE_INTEGER)) return null
  return Number(minor) * (negative && minor !== 0n ? -1 : 1)
}

/** Minor units to the decimal the field holds. */
function toMajor(minor: number, digits: number) {
  return minor / 10 ** digits
}

/** The field's decimal back to minor units. */
function toMinor(major: number, digits: number) {
  return Math.round(major * 10 ** digits)
}

type InputHandlerEvent<Handler extends 'onChange' | 'onKeyDown' | 'onPaste'> = Parameters<
  NonNullable<NumberFieldPrimitive.Input.Props[Handler]>
>[0]

const MoneyContext = createContext<{
  format: MoneyFormat
  allowNegative: boolean
  changeCurrency: (currency: string) => void
  inputRef: RefObject<HTMLInputElement | null>
  disabled: boolean
  readOnly: boolean
} | null>(null)

function useMoney() {
  const context = use(MoneyContext)
  if (!context) throw new Error('Money input parts go inside <MoneyInput>.')
  return context
}

type MinorUnits = 'value' | 'defaultValue' | 'min' | 'max' | 'step' | 'largeStep'

type MoneyInputProps = Omit<
  NumberFieldPrimitive.Root.Props,
  'className' | 'format' | 'onValueChange' | 'onValueCommitted' | MinorUnits
> & {
  className?: string
  /** The currency, as an ISO 4217 code such as `USD`, when you hold the state. */
  currency?: string
  /** The currency at first, when you leave the state to the field. */
  defaultCurrency?: string
  /**
   * Called when a person picks another currency, with the amount moved to it:
   * the same number, rounded to the new currency’s decimals. A parent that
   * holds both sets them together, or neither to turn the change down.
   */
  onCurrencyChange?: (currency: string, details: { value: number | null }) => void
  /** The amount in minor units, such as cents. */
  value?: number | null
  /** The amount at first, in minor units, when you leave the state to the field. */
  defaultValue?: number | null
  /** Called with the amount in minor units. */
  onValueChange?: (
    value: number | null,
    details: NumberFieldPrimitive.Root.ChangeEventDetails,
  ) => void
  /** Called with the amount in minor units when a change is done: on blur or a step. */
  onValueCommitted?: (
    value: number | null,
    details: NumberFieldPrimitive.Root.CommitEventDetails,
  ) => void
  /** The lowest amount, in minor units. */
  min?: number
  /** The highest amount, in minor units. */
  max?: number
  /** How far an arrow key steps, in minor units. One unit of the currency by default. */
  step?: number
  /** How far Shift with an arrow steps, in minor units. Ten units by default. */
  largeStep?: number
  /** Sends the currency with a form, under this name. The amount goes under the field’s `name`, as a decimal. */
  currencyName?: string
}

/** An amount in minor units moved to a currency with other decimals, keeping its number. */
function rescale(minor: number, fromDigits: number, toDigits: number) {
  return toMinor(toMajor(minor, fromDigits), toDigits)
}

function MoneyInput({
  className,
  currency: currencyProp,
  defaultCurrency = 'USD',
  onCurrencyChange,
  locale,
  value: valueProp,
  defaultValue = null,
  onValueChange,
  onValueCommitted,
  min,
  max,
  step,
  largeStep,
  currencyName,
  form,
  ...props
}: MoneyInputProps) {
  const [ownCurrency, setOwnCurrency] = useState(defaultCurrency)
  const [ownValue, setOwnValue] = useState<number | null>(defaultValue)
  const currency = currencyProp ?? ownCurrency
  const value = valueProp === undefined ? ownValue : valueProp
  const localeKey = Array.isArray(locale) ? locale.join() : String(locale ?? '')
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the key stands for the locale
  const format = useMemo(() => moneyFormat(locale, currency), [localeKey, currency])
  const { digits } = format
  const inputRef = useRef<HTMLInputElement>(null)
  const major = (minor: number | undefined) =>
    minor === undefined ? undefined : toMajor(minor, digits)
  const unit = 10 ** digits

  const changeValue = (
    next: number | null,
    details: NumberFieldPrimitive.Root.ChangeEventDetails,
  ) => {
    onValueChange?.(next, details)
    if (!details.isCanceled) setOwnValue(next)
  }

  // The currency the field's own amount is in: when the currency changes, by
  // a pick or from its parent, that amount moves to it.
  const [ownValueCurrency, setOwnValueCurrency] = useState(currency)
  if (ownValueCurrency !== currency) {
    setOwnValueCurrency(currency)
    if (ownValue !== null) {
      setOwnValue(rescale(ownValue, moneyFormat(locale, ownValueCurrency).digits, digits))
    }
  }

  const changeCurrency = (next: string) => {
    if (next === currency) return
    const moved =
      value === null ? null : rescale(value, digits, moneyFormat(locale, next).digits)
    onCurrencyChange?.(next, { value: moved })
    if (currencyProp !== undefined) return
    setOwnCurrency(next)
    if (valueProp !== undefined && moved !== value) {
      onValueChange?.(moved, createChangeEventDetails(REASONS.none))
    }
  }

  return (
    <MoneyContext
      value={{
        format,
        allowNegative: min !== undefined && min < 0,
        changeCurrency,
        inputRef,
        disabled: props.disabled ?? false,
        readOnly: props.readOnly ?? false,
      }}
    >
      <NumberField
        data-slot='money-input'
        className={className}
        locale={locale}
        format={{ minimumFractionDigits: digits, maximumFractionDigits: digits }}
        value={value === null ? null : toMajor(value, digits)}
        min={major(min)}
        max={major(max)}
        step={(step ?? unit) / unit}
        largeStep={(largeStep ?? unit * 10) / unit}
        onValueChange={(next, details) =>
          changeValue(next === null ? null : toMinor(next, digits), details)
        }
        onValueCommitted={(next, details) =>
          onValueCommitted?.(next === null ? null : toMinor(next, digits), details)
        }
        form={form}
        {...props}
      />
      <FieldValues name={currencyName} form={form} values={[currency]} />
    </MoneyContext>
  )
}

function MoneyInputGroup({
  className,
  ...props
}: Omit<NumberFieldPrimitive.Group.Props, 'className'> & { className?: string }) {
  return (
    <NumberFieldPrimitive.Group
      data-slot='money-input-group'
      onPointerDown={focusControl}
      className={cn(inputBoxClassName, 'w-full', className)}
      {...props}
    />
  )
}

/**
 * Replaces a text control's value as an edit, so undo can take it back and
 * React and Base UI hear it. Where the browser has no `insertText`, the value
 * is set and the input event sent by hand.
 */
function writeText(input: HTMLInputElement, text: string) {
  // Only the part that differs is replaced, so undo brings back a small change.
  const old = input.value
  let start = 0
  while (start < old.length && start < text.length && old[start] === text[start])
    start += 1
  let end = 0
  while (
    end < old.length - start &&
    end < text.length - start &&
    old[old.length - 1 - end] === text[text.length - 1 - end]
  ) {
    end += 1
  }
  input.setSelectionRange(start, old.length - end)
  const inserted = text.slice(start, text.length - end)
  if (document.execCommand('insertText', false, inserted) && input.value === text) return
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(
    input,
    text,
  )
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

function MoneyInputInput({
  className,
  onChange,
  onKeyDown,
  onPaste,
  ...props
}: Omit<NumberFieldPrimitive.Input.Props, 'className'> & { className?: string }) {
  const { format, allowNegative, inputRef } = useMoney()
  const nameId = useId()
  const field = useFieldProps(
    {
      ...props,
      ref: inputRef,
      'aria-describedby': [nameId, props['aria-describedby']].filter(Boolean).join(' '),
    },
    { id: useNumberFieldInputId() },
  )

  // Groups the digits as they're typed, keeping the caret beside the same digit.
  const regroupTyping = (event: InputHandlerEvent<'onChange'>) => {
    const input = event.currentTarget
    const composing =
      'isComposing' in event.nativeEvent && event.nativeEvent.isComposing === true
    // An undo or a redo brings back a text as it was; regrouping it would be a new edit, and undo would never get past it.
    const history =
      'inputType' in event.nativeEvent &&
      typeof event.nativeEvent.inputType === 'string' &&
      event.nativeEvent.inputType.startsWith('history')
    // An undo leaves what it brought back selected; the caret goes after it, so the next key doesn't replace it.
    if (history) input.setSelectionRange(input.selectionEnd, input.selectionEnd)
    if (!composing && !history) {
      const next = regroup(
        input.value,
        input.selectionStart ?? input.value.length,
        format,
        allowNegative,
      )
      if (next.text !== input.value) {
        writeText(input, next.text)
        input.setSelectionRange(next.caret, next.caret)
      }
    }
    onChange?.(event)
  }

  // Backspace or Delete beside a group separator removes the digit past it.
  const skipSeparator = (event: InputHandlerEvent<'onKeyDown'>) => {
    onKeyDown?.(event)
    const input = event.currentTarget
    const { selectionStart: start, selectionEnd: end, value } = input
    // A currency without decimals takes no point.
    if (format.digits === 0 && POINTS.includes(event.key)) event.preventDefault()
    // Home and End move the caret, as in any text: Base UI would set the amount to its min or max.
    if (event.key === 'Home' || event.key === 'End') event.preventBaseUIHandler()
    if (start === null || start !== end) return
    const isGroup = (char: string | undefined) =>
      char !== undefined &&
      (char === format.group || (SPACE.test(char) && SPACE.test(format.group)))
    if (event.key === 'Backspace' && isGroup(value[start - 1])) {
      input.setSelectionRange(start - 1, start - 1)
    } else if (event.key === 'Delete' && isGroup(value[start])) {
      input.setSelectionRange(start + 1, start + 1)
    }
  }

  // A pasted amount is read in any format and written in the locale's.
  const pasteAmount = (event: InputHandlerEvent<'onPaste'>) => {
    onPaste?.(event)
    if (event.defaultPrevented) return
    const input = event.currentTarget
    const pasted = parseMoney(event.clipboardData.getData('text/plain'), format.digits)
    event.preventDefault()
    if (pasted === null || (pasted < 0 && !allowNegative)) return
    const minor = Math.abs(pasted)
      .toString()
      .padStart(format.digits + 1, '0')
    const amount: Amount = {
      negative: pasted < 0,
      integer: minor.slice(0, minor.length - format.digits),
      fraction: format.digits > 0 ? minor.slice(-format.digits) : null,
    }
    const start = input.selectionStart ?? 0
    const end = input.selectionEnd ?? input.value.length
    // A whole amount replaces what's selected. Into the middle of one go its
    // digits, and its decimals only when it has some, so "5" stays a 5.
    const whole = start === 0 && end === input.value.length
    const fraction = amount.fraction?.replace(/0+$/, '')
    const inserted = whole
      ? writeAmount(amount, format)
      : `${amount.integer}${fraction ? format.decimal + fraction : ''}`
    const next = regroup(
      input.value.slice(0, start) + inserted + input.value.slice(end),
      start + inserted.length,
      format,
      allowNegative,
    )
    writeText(input, next.text)
    input.setSelectionRange(next.caret, next.caret)
  }

  const symbol = (
    <span
      data-slot='money-input-symbol'
      aria-hidden
      suppressHydrationWarning
      className={cn(
        'text-muted-foreground shrink-0 text-base whitespace-nowrap select-none md:text-sm',
        format.side === 'start' ? 'order-first ps-(--control-padding)' : 'order-last',
        format.side === 'end' && 'pe-(--control-padding)',
      )}
    >
      {format.symbol}
    </span>
  )

  return (
    <NumberFieldPrimitive.Input
      data-slot='money-input-input'
      inputMode={format.digits > 0 ? 'decimal' : 'numeric'}
      // Zero in the currency's decimals, so an empty field shows what it takes.
      placeholder={writeAmount(
        {
          negative: false,
          integer: '0',
          fraction: format.digits > 0 ? '0'.repeat(format.digits) : null,
        },
        format,
      )}
      onChange={regroupTyping}
      onKeyDown={skipSeparator}
      onPaste={pasteAmount}
      render={(inputProps, state) => (
        <span className={cn('flex min-w-0 flex-1 items-center', className)}>
          {/* The amount reads the locale's way on any page: dollars in a right-to-left app are still $1,280.50. */}
          <span dir={format.direction} className='flex min-w-0 flex-1 items-center'>
            {symbol}
            <RollingInput
              inputProps={inputProps}
              inputValue={state.inputValue}
              decimal={format.decimal}
              className={cn(
                // The digits sit against the symbol.
                format.side === 'start' ? 'text-start' : 'text-end',
                format.side === 'start' && (format.spaced ? 'ps-1' : 'ps-0'),
                format.side === 'end' && (format.spaced ? 'pe-1' : 'pe-0'),
              )}
            />
          </span>
          <span id={nameId} className='sr-only' suppressHydrationWarning>
            {format.name}
          </span>
          <InputInvalidIcon />
        </span>
      )}
      {...field.props}
    />
  )
}

/**
 * A currency's flag: the country its code starts with, as ISO 4217 codes do
 * (`GB` for GBP), and the EU's for the euro. Codes for no one country, such
 * as XAF, keep the flag's room, empty.
 */
function CurrencyFlag({ currency }: { currency: string }) {
  // X codes belong to no country, though the flags use XA, XO and XC for places.
  return <CountryFlag country={currency.startsWith('X') ? '' : currency.slice(0, 2)} />
}

/**
 * A button in the box that picks the currency from `currencies`, at the
 * box's end. Its list searches names, codes and symbols.
 */
function MoneyInputCurrency({
  currencies,
  label = 'Currency',
  searchPlaceholder = 'Search currencies',
  className,
}: {
  /** ISO 4217 codes, in the order the list shows them. */
  currencies: readonly string[]
  /** What is picked: the button reads "Currency: US Dollar (USD)". */
  label?: string
  searchPlaceholder?: string
  className?: string
}) {
  const { format, changeCurrency, inputRef, disabled, readOnly } = useMoney()
  const options = useMemo(
    () =>
      currencies.map((code): AddonPickerOption => {
        const { name, symbol } = moneyFormat(format.locale, code)
        return {
          value: code,
          label: name,
          detail: code,
          visual: <CurrencyFlag currency={code} />,
          keywords: [symbol],
        }
      }),
    [currencies, format.locale],
  )
  return (
    <AddonPicker
      options={options}
      value={format.currency}
      onValueChange={changeCurrency}
      label={label}
      searchPlaceholder={searchPlaceholder}
      noMatch={(query) => `No currency matches “${query}”.`}
      align='inline-end'
      disabled={disabled}
      readOnly={readOnly}
      returnFocus={inputRef}
      className={className}
    >
      <CurrencyFlag currency={format.currency} />
      <span className='tabular-nums'>{format.currency}</span>
    </AddonPicker>
  )
}

export { MoneyInput, MoneyInputCurrency, MoneyInputGroup, MoneyInputInput }
export { moneyFormat, parseMoney, regroup, rescale, toMajor, toMinor }
export type { MoneyFormat, MoneyInputProps }
