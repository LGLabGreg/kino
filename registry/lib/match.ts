/*
 * How Kino's searches match what a person types: as Base UI's own filter
 * does, a run of the text as long as the query that compares equal ignoring
 * case, accents and punctuation, in the list's `locale`, so what is marked
 * is what made the row match.
 */
const collators = new Map<string, Intl.Collator>()

function matchCollator(locale: Intl.LocalesArgument) {
  const key = String(locale ?? '')
  let collator = collators.get(key)
  if (!collator) {
    collator = new Intl.Collator(locale, {
      usage: 'search',
      sensitivity: 'base',
      ignorePunctuation: true,
    })
    collators.set(key, collator)
  }
  return collator
}

/**
 * Where `query` first matches in `text`, as `[start, end)`, the way Base UI's
 * filter matches it in `locale` (the runtime's by default, as Base UI's), or
 * null when it doesn't or there is nothing typed.
 */
function matchRange(
  text: string,
  query: string,
  locale?: Intl.LocalesArgument,
): readonly [number, number] | null {
  if (!query) return null
  const collator = matchCollator(locale)
  for (let start = 0; start + query.length <= text.length; start += 1) {
    if (collator.compare(text.slice(start, start + query.length), query) === 0) {
      return [start, start + query.length]
    }
  }
  return null
}

export { matchRange }
