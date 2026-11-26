import { prepareAnnouncements, announce as say } from '@ui-sdk/core'

/*
 * Tells a screen reader what changed, for parts whose changes it can't see
 * happen, such as a chip or a file joining a list. It speaks through ui-sdk's
 * live regions, one pair per page, which ui-sdk's own components share.
 */

// Some screen readers hear only a region that was in the page before its words.
if (typeof document !== 'undefined') prepareAnnouncements(document)

let waiting: string[] | null = null

/**
 * Says `text` politely. What is said in one go, such as several uploads
 * ending in one render, is read as one message, so a later one doesn't cut an
 * earlier one off, and the same words twice in it are read once.
 */
function announce(text: string) {
  if (!text) return
  if (waiting) {
    waiting.push(text)
    return
  }
  const said = (waiting = [text])
  queueMicrotask(() => {
    waiting = null
    say(joinSaid(said))
  })
}

/** Messages as one: each once, in order, a full stop between them unless one already ends a sentence. */
function joinSaid(said: readonly string[]) {
  return [...new Set(said)].reduce((message, next) =>
    /[.!?…]$/.test(message) ? `${message} ${next}` : `${message}. ${next}`,
  )
}

export { announce, joinSaid }
