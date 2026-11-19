import * as flags from 'country-flag-icons/string/3x2'
import type { ComponentProps } from 'react'

import { cn } from '@/lib/utils'

/*
 * Countries as people see them and look for them: a flag drawn as an SVG,
 * since Windows has no flag emoji and shows two letters in their place, a
 * name in the reader's language from the browser's own `Intl.DisplayNames`,
 * and the short names people search by.
 */

const flagSvgs = flags as unknown as Record<string, string | undefined>
const flagUrls = new Map<string, string>()

/** `country`'s flag as an image URL: one element per flag, never an SVG tree of hundreds, so a list of every country opens at once. */
function flagUrl(country: string): string | undefined {
  const code = country.toUpperCase().replace('-', '_')
  let url = flagUrls.get(code)
  if (url === undefined) {
    const svg = flagSvgs[code]
    if (!svg) return undefined
    url = `url("data:image/svg+xml,${encodeURIComponent(svg)}")`
    flagUrls.set(code, url)
  }
  return url
}

/**
 * `country`'s flag, as an ISO 3166-1 code such as `GB`, at 3:2 in a hairline
 * frame, so a white flag still has an edge on a white page. It is decorative:
 * name the country beside it. A code with no flag keeps its room, empty.
 */
function CountryFlag({
  country,
  className,
  style,
  ...props
}: Omit<ComponentProps<'span'>, 'children'> & { country: string }) {
  return (
    <span
      data-slot='country-flag'
      aria-hidden
      className={cn(
        // 1.125rem by 0.75rem: a row's icon width at 3:2. Its own corner, a
        // flag's, not a control's: it stays square in the Round shape.
        'bg-muted relative inline-flex h-3 w-4.5 shrink-0 overflow-hidden rounded-[2px] bg-cover bg-center after:absolute after:inset-0 after:rounded-[inherit] after:shadow-[inset_0_0_0_1px] after:shadow-foreground/15 forced-colors:after:shadow-none',
        className,
      )}
      style={{ backgroundImage: flagUrl(country), ...style }}
      {...props}
    />
  )
}

const namesByLocale = new Map<string, Intl.DisplayNames>()

/** `country`'s name in `locale`, such as "United Kingdom" for `GB` in English, or the code when the browser has no name for it. */
function countryName(country: string, locale: string): string {
  let names = namesByLocale.get(locale)
  if (!names) {
    names = new Intl.DisplayNames([locale], { type: 'region', fallback: 'code' })
    namesByLocale.set(locale, names)
  }
  return names.of(country) ?? country
}

/** Short names people search by that aren't in the country's own name. */
const ALIASES: Partial<Record<string, readonly string[]>> = {
  AE: ['UAE'],
  CD: ['DRC'],
  GB: ['UK', 'Great Britain', 'England', 'Scotland', 'Wales'],
  KR: ['South Korea'],
  KP: ['North Korea'],
  NL: ['Holland'],
  US: ['USA', 'America'],
}

/** Other names `country` is searched by, such as UK for `GB`, in English. */
function countryAliases(country: string): readonly string[] {
  return ALIASES[country.toUpperCase()] ?? []
}

export { CountryFlag, countryAliases, countryName }
