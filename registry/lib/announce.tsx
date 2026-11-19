'use client'

import { useState } from 'react'

/*
 * A polite status region that says what changed, for parts whose changes a
 * screen reader can't see happen, such as a chip or a file joining a list.
 */

let task = 0
let taskEnding = false

/** A number that stays the same until the code running now, and its microtasks, have finished. */
function currentTask() {
  if (!taskEnding) {
    taskEnding = true
    queueMicrotask(() => {
      taskEnding = false
      task += 1
    })
  }
  return task
}

/**
 * `announce(text)` says `text` in `region`, which goes in the page from the
 * start. The same words said again are heard again, and what is said in one
 * go, such as several uploads ending in one render, is read as one message,
 * so a later one doesn't cut an earlier one off.
 */
function useAnnouncer() {
  const [said, setSaid] = useState({ text: '', key: 0, task: -1 })
  const announce = (text: string) => {
    if (!text) return
    const now = currentTask()
    setSaid((last) =>
      last.task === now
        ? { ...last, text: `${last.text}. ${text}` }
        : { text, key: last.key + 1, task: now },
    )
  }
  const region = (
    <div role='status' className='sr-only'>
      <span key={said.key}>{said.text}</span>
    </div>
  )
  return { announce, region }
}

export { currentTask, useAnnouncer }
