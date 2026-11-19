import {
  AsYouType,
  Metadata,
  type CountryCode,
  getCountryCallingCode,
  getExampleNumber,
  isValidPhoneNumber,
  parsePhoneNumberFromString,
  validatePhoneNumberLength,
} from 'libphonenumber-js/min'
import metadata from 'libphonenumber-js/min/metadata'
import examples from 'libphonenumber-js/mobile/examples'

/*
 * A phone number as a field reads and writes it, on libphonenumber-js: the
 * country's code in a button (`+44`) and the rest of the number in the field
 * (`20 7946 0958`), grouped the way the country writes it, the country a
 * number with its code belongs to, and the number in E.164 (`+442079460958`),
 * for a form and for your server.
 */

interface PhoneReading {
  /** What the field shows. */
  text: string
  country: CountryCode
  /** The number so far in E.164, or `''` when there is none. */
  value: string
}

/** The digits in `text`, after a `+` when one comes before them. */
function phoneChars(text: string): string {
  const digits = text.replace(/\D/g, '')
  return /^\D*\+/.test(text) ? `+${digits}` : digits
}

/** Where the caret goes in `text` to stand after its first `count` digits (a leading `+` counts as one). */
function caretAt(text: string, count: number): number {
  if (count <= 0) return 0
  for (let index = 1; index <= text.length; index += 1) {
    if (phoneChars(text.slice(0, index)).length >= count) return index
  }
  return text.length
}

function callingCode(country: CountryCode): string {
  return getCountryCallingCode(country)
}

/** The country a calling code mostly means: `GB` for 44, `US` for 1. */
function mainCountry(code: string): CountryCode | undefined {
  return metadata.country_calling_codes[code]?.[0] as CountryCode | undefined
}

/** The digits `country` dials out with, such as 00 in the UK and 011 in the US, when it has one fixed code. */
function exitCode(country: CountryCode): string {
  const plan = new Metadata()
  plan.selectNumberingPlan(country)
  const prefix = plan.numberingPlan?.IDDPrefix() ?? ''
  return /^\d+$/.test(prefix) ? prefix : ''
}

/**
 * The country a number typed with its code belongs to. Codes that several
 * countries share (+1, +7, +44) name one only once the area code is in, so
 * until then the person's pick stays while it shares the code.
 */
function countryOf(typed: AsYouType, current: CountryCode): CountryCode {
  const found = typed.getCountry()
  if (found) return found
  const code = typed.getCallingCode()
  if (!code || code === callingCode(current)) return current
  return mainCountry(code) ?? current
}

/** The number after `country`'s code, without the trunk prefix people type at home (the 0 of `020`). */
function nationalDigits(digits: string, country: CountryCode): string {
  const typed = new AsYouType(country)
  typed.input(digits)
  return typed.getNumber()?.nationalNumber ?? ''
}

/** `digits` after `code`, grouped as the whole number would be, without the code. */
function afterDialCode(code: string, digits: string): string {
  if (!digits) return ''
  const whole = new AsYouType().input(`+${code}${digits}`)
  return whole.slice(whole.indexOf(code) + code.length).trimStart()
}

function isTooLong(value: string): boolean {
  return value !== '' && validatePhoneNumberLength(value) === 'TOO_LONG'
}

interface PhoneRead {
  reading: PhoneReading
  /**
   * How many digits the field gained (or lost, below 0) in front of the
   * ones that were typed, to keep the caret after the same digit; `null`
   * when the number was rewritten, and the caret goes to its end.
   */
  shift: number | null
}

/**
 * Reads what is in the field, `chars` (from `phoneChars`), into what it
 * should show for `country`. Null when the number would be too long for its
 * country: the field keeps what it had.
 */
function readPhone(
  chars: string,
  country: CountryCode,
  /** Keeps a number too long for the country, as when the person picks another or deletes from one. */
  long = false,
): PhoneRead | null {
  const tooLong = (value: string) => !long && isTooLong(value)
  if (!chars) return { reading: { text: '', country, value: '' }, shift: 0 }
  if (chars.startsWith('+')) {
    const typed = new AsYouType()
    const text = typed.input(chars)
    const code = typed.getCallingCode()
    // Until a calling code is in, the field shows what was typed.
    if (!code) return { reading: { text, country, value: '' }, shift: 0 }
    const next = countryOf(typed, country)
    const rest = chars.slice(1 + code.length)
    const digits = nationalDigits(rest, next)
    const value = digits ? `+${code}${digits}` : ''
    if (tooLong(value)) return null
    return {
      reading: { text: afterDialCode(code, digits), country: next, value },
      shift: -(1 + code.length + rest.length - digits.length),
    }
  }

  // The start of the country's exit code (0 of 00, 01 of 011) waits for the rest.
  const exit = exitCode(country)
  if (exit.startsWith(chars) && chars !== exit) {
    return { reading: { text: chars, country, value: '' }, shift: 0 }
  }
  const typed = new AsYouType(country)
  typed.input(chars)
  // Dialled out with the country's own exit code, such as 00 44 or 011 44.
  if (typed.isInternational()) {
    const whole = typed.getNumberValue()
    // Until the exit code is followed by a calling code, it stays as typed.
    if (!whole || !typed.getCallingCode()) {
      return { reading: { text: chars, country, value: '' }, shift: 0 }
    }
    const read = readPhone(whole, country, long)
    return read && { reading: read.reading, shift: null }
  }
  const code = callingCode(country)
  const digits = nationalDigits(chars, country)
  // A trunk prefix alone, such as the 0 of 020, stays as typed.
  if (!digits) return { reading: { text: chars, country, value: '' }, shift: 0 }
  const value = `+${code}${digits}`
  if (tooLong(value)) return null
  // A code several countries share names one once the number does, as when typed with its code.
  const whole = new AsYouType()
  whole.input(value)
  return {
    reading: {
      text: afterDialCode(code, digits),
      country: countryOf(whole, country),
      value,
    },
    shift: -(chars.length - digits.length),
  }
}

/**
 * The number in a whole `text` that arrived at once, pasted or autofilled:
 * `+44 (0)20 7946 0958`, `tel:+44…`, or `0044…` under a country that dials
 * out with another code. As typed when it isn't a number on its own.
 */
function wholeNumber(text: string, country: CountryCode): string {
  const chars = phoneChars(text)
  for (const candidate of [text, chars.startsWith('00') ? `+${chars.slice(2)}` : null]) {
    if (candidate === null) continue
    const number = parsePhoneNumberFromString(candidate, country)
    if (number?.isValid()) return number.number
  }
  return chars
}

/** What the field shows for a value set from outside, such as a saved number. */
function readValue(value: string, country: CountryCode): PhoneReading {
  if (!value) return { text: '', country, value: '' }
  return (
    readPhone(phoneChars(value), country, true)?.reading ?? {
      text: value,
      country,
      value,
    }
  )
}

/** The same number for another country, when the person picks one: the digits they typed stay, the code changes. */
function readForCountry(reading: PhoneReading, country: CountryCode): PhoneReading {
  const digits = reading.value.slice(1 + callingCode(reading.country).length)
  return readPhone(digits, country, true)?.reading ?? { text: '', country, value: '' }
}

/**
 * What Backspace (`back`) or Delete does next to a space or bracket: it
 * takes the digit beyond it, since the field would only put the space back.
 * Null when a digit is next to the caret, for the browser to delete.
 */
function deleteAcross(
  text: string,
  caret: number,
  back: boolean,
): { text: string; caret: number } | null {
  const isChar = (char: string | undefined) => char !== undefined && /[\d+]/.test(char)
  if (back ? isChar(text[caret - 1]) : isChar(text[caret])) return null
  let at = back ? caret - 1 : caret
  while (at >= 0 && at < text.length && !isChar(text[at])) at += back ? -1 : 1
  if (at < 0 || at >= text.length) return null
  return { text: text.slice(0, at) + text.slice(at + 1), caret: back ? at : caret }
}

/**
 * Why `value` isn't a number to send, or `''` when it is (or is empty). A
 * number that more digits could still make whole asks for them, so the
 * message doesn't change while the person is typing.
 */
function phoneProblem(value: string): string {
  if (!value || isValidPhoneNumber(value)) return ''
  return validatePhoneNumberLength(`${value}0`) === 'TOO_LONG'
    ? 'Enter a phone number that exists.'
    : 'Enter the whole phone number.'
}

/** An example number for `country` as the field shows it, after the code, for its placeholder. */
function examplePhone(country: CountryCode): string {
  const example = getExampleNumber(country, examples)
  return example ? afterDialCode(callingCode(country), example.nationalNumber) : ''
}

export {
  callingCode,
  caretAt,
  deleteAcross,
  examplePhone,
  phoneChars,
  phoneProblem,
  readForCountry,
  readPhone,
  readValue,
  wholeNumber,
}
export type { PhoneReading }
