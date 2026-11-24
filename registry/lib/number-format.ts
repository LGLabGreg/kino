/*
 * One `Intl.NumberFormat` for each locale and set of options, however often
 * they are passed anew, so every part that writes numbers (a rolling number,
 * a chart's axis and tooltip) writes them the same way without making a
 * formatter each render.
 */

const formatters = new Map<string, Intl.NumberFormat>()
const optionsOf = new WeakMap<Intl.NumberFormat, Intl.NumberFormatOptions | undefined>()

/** The formatter for `locale` and `format`, made once. */
export function numberFormatter(
  locale: Intl.LocalesArgument,
  format?: Intl.NumberFormatOptions,
): Intl.NumberFormat {
  const key = `${String(locale)}|${JSON.stringify(format ?? {})}`
  let formatter = formatters.get(key)
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, format)
    formatters.set(key, formatter)
    optionsOf.set(formatter, format)
  }
  return formatter
}

/** The options a formatter from `numberFormatter` was made with, as given. */
export function formatOptionsOf(
  formatter: Intl.NumberFormat,
): Intl.NumberFormatOptions | undefined {
  return optionsOf.get(formatter)
}

const UNITS = ['kilobyte', 'megabyte', 'gigabyte', 'terabyte'] as const

/** A file's size the way a file manager writes it, in steps of 1,000: `820 B`, `2.4 MB`. */
export function formatFileSize(bytes: number, locale?: string) {
  if (bytes < 1000) {
    return numberFormatter(locale, {
      style: 'unit',
      unit: 'byte',
      unitDisplay: 'narrow',
    })
      .format(bytes)
      .replace(/(\d)B$/, '$1 B')
  }
  let size = bytes / 1000
  let unit = 0
  // Up a unit once the rounded number would read 1,000.
  const digits = (value: number) => (value < 9.95 ? 1 : 0)
  const rounded = (value: number) => Number(value.toFixed(digits(value)))
  while (rounded(size) >= 1000 && unit < UNITS.length - 1) {
    size /= 1000
    unit += 1
  }
  return numberFormatter(locale, {
    style: 'unit',
    unit: UNITS[unit],
    unitDisplay: 'short',
    maximumFractionDigits: digits(size),
  }).format(size)
}
