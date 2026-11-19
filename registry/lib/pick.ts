'use client'

import { useRef, useState } from 'react'

/*
 * Picking from a list of items, as the Tree and the Listbox do: one item or
 * many, a range from the last item picked on its own, everything at once,
 * and typing a name to go to it.
 */

/** Picks only this item, toggles it in a list that picks many, or picks the items from the anchor to it. */
type PickHow = 'only' | 'toggle' | 'range'

/** An item a person can see now, in the order shown. */
interface PickItem {
  value: string
  disabled: boolean
}

/** Typed letters within this long of each other make one search. */
const TYPEAHEAD_MS = 750

/**
 * The picked values and the anchor once `value` is picked `how`. A range
 * runs from `from`, or else the anchor, adds to what is picked and leaves the
 * anchor where it was; the disabled items inside it stay as they were.
 * Picking only one keeps the same list when it is already the pick, so
 * nothing re-renders.
 */
function nextPick(
  selected: readonly string[],
  value: string,
  how: PickHow,
  {
    items,
    anchor,
    multiple,
    from = anchor,
  }: {
    items: readonly PickItem[]
    anchor: string | null
    multiple: boolean
    /** Where a range starts, when not at the anchor: the item focus was on, for Ctrl+Shift+Home. */
    from?: string | null
  },
): { selected: readonly string[]; anchor: string | null } {
  if (how === 'range' && multiple && from !== null) {
    const values = items.map((item) => item.value)
    const range = pickRange(values, from, value).filter(
      (each) => !items[values.indexOf(each)]!.disabled,
    )
    return { selected: [...new Set([...selected, ...range])], anchor }
  }
  if (multiple && how !== 'only') {
    return {
      selected: selected.includes(value)
        ? selected.filter((each) => each !== value)
        : [...selected, value],
      anchor: value,
    }
  }
  return {
    selected: selected.length === 1 && selected[0] === value ? selected : [value],
    anchor: value,
  }
}

/**
 * What Ctrl or ⌘ with A does: picks every item that isn't disabled, or
 * clears them when they all are already. A disabled item keeps its state
 * either way, and with none to pick, nothing changes.
 */
function pickAll(selected: readonly string[], items: readonly PickItem[]) {
  const enabled = items.filter((item) => !item.disabled).map((item) => item.value)
  if (enabled.length === 0) return selected
  const kept = selected.filter((each) => !enabled.includes(each))
  return enabled.every((each) => selected.includes(each)) ? kept : [...kept, ...enabled]
}

/** The values from `anchor` to `to`, in the order shown, both included; just `to` when the anchor isn't shown. */
function pickRange(values: readonly string[], anchor: string, to: string) {
  const from = values.indexOf(anchor)
  const end = values.indexOf(to)
  if (end === -1) return []
  if (from === -1) return [to]
  return values.slice(Math.min(from, end), Math.max(from, end) + 1)
}

/**
 * The item a person typing `typed` goes to, from `texts` with focus on
 * `from`: the next one that starts with it, wrapping round. A longer search
 * may stay on the item it already matches; one letter typed again cycles
 * through the items that start with it. -1 when none does.
 */
function typeaheadMatch(texts: readonly string[], from: number, typed: string) {
  if (!typed) return -1
  const lower = typed.toLocaleLowerCase()
  // `bbb` cycles through what starts with `b`.
  const search = /^(.)\1*$/su.test(lower) ? lower[0]! : lower
  const start = search.length > 1 ? from : from + 1
  for (let step = 0; step < texts.length; step++) {
    const at = (start + step) % texts.length
    if (texts[at]!.trim().toLocaleLowerCase().startsWith(search)) return at
  }
  return -1
}

/**
 * The picked values, held here or by the caller (`value`), and the anchor a
 * range is picked from: the last item picked on its own.
 */
function usePick({
  value,
  defaultValue = [],
  onValueChange,
  multiple,
}: {
  value: readonly string[] | undefined
  defaultValue?: readonly string[]
  onValueChange: ((value: string[]) => void) | undefined
  multiple: boolean
}) {
  const [own, setOwn] = useState(defaultValue)
  const selected = value ?? own
  const anchorRef = useRef<string | null>(selected[0] ?? null)

  const setSelected = (next: readonly string[]) => {
    if (next === selected) return
    if (value === undefined) setOwn(next)
    onValueChange?.([...next])
  }

  /** Picks `item` among `items`, the ones shown, in order; a range from `from`, else the anchor. */
  const pick = (
    item: string,
    how: PickHow,
    items: readonly PickItem[],
    from?: string,
  ) => {
    const next = nextPick(selected, item, how, {
      items,
      anchor: anchorRef.current,
      multiple,
      from: from ?? anchorRef.current,
    })
    anchorRef.current = next.anchor
    setSelected(next.selected)
  }

  return { selected, setSelected, pick }
}

/**
 * Typing a name: `find` takes a key and returns the index of the item it
 * goes to, or -1. While a name is being typed, `typing` is true, and a space
 * is part of the name rather than a pick.
 */
function useTypeahead() {
  const typedRef = useRef({ text: '', at: 0 })

  const typing = (event: { timeStamp: number }) =>
    event.timeStamp - typedRef.current.at < TYPEAHEAD_MS && typedRef.current.text !== ''

  const find = (
    event: {
      key: string
      timeStamp: number
      metaKey: boolean
      ctrlKey: boolean
      altKey: boolean
    },
    texts: readonly string[],
    from: number,
  ) => {
    if (event.key.length !== 1 || event.metaKey || event.ctrlKey || event.altKey)
      return -1
    const typed = typedRef.current
    typed.text = typing(event) ? typed.text + event.key : event.key
    typed.at = event.timeStamp
    return typeaheadMatch(texts, from, typed.text)
  }

  return { typing, find }
}

export { nextPick, pickAll, pickRange, typeaheadMatch, usePick, useTypeahead }
export type { PickHow, PickItem }
