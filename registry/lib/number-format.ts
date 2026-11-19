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
