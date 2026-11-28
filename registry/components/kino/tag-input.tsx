'use client'

import {
  Combobox,
  ComboboxChip,
  ComboboxChips,
  ComboboxContent,
  ComboboxCreate,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxValue,
} from '@/registry/components/kino/combobox'
import { announce } from '@/registry/lib/announce'
import { isComposing } from '@ui-sdk/core'
import { createComboboxController } from '@ui-sdk/react/combobox'
import {
  type ComponentProps,
  createContext,
  type ReactNode,
  use,
  useRef,
  useState,
} from 'react'

/*
 * Several values held as chips in one field: typed, pasted or picked from
 * suggestions. It is the Combobox with many values, as strings, so its chips
 * glide and leave the same way: a tag that comes or goes moves the others to
 * their new places, and the field grows a line at a time. Whatever adds a
 * tag (a pick, Enter, a comma, a paste, leaving the field) goes through the
 * Combobox's value, so `onValueChange` hears every one.
 */

/** Whether `query` adds a new tag: typed text that names a tag or a suggestion adds that one instead. */
function addsNew(query: string, tags: readonly string[], suggestions: readonly string[]) {
  const typed = query.trim()
  return typed !== '' && !findTag(tags, typed) && !findTag(suggestions, typed)
}

/** Whether two tags are the same, ignoring case and the spaces around them. */
function sameTag(a: string, b: string) {
  return a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase()
}

/** The tag in `tags` that `text` names, if there is one. */
function findTag(tags: readonly string[], text: string) {
  return tags.find((tag) => sameTag(tag, text))
}

/** Whether two lists hold the same tags in the same order. */
function sameTags(a: readonly string[], b: readonly string[]) {
  return a.length === b.length && a.every((tag, index) => tag === b[index])
}

/** What a paste holds: one tag per line or per `delimiters` character, a comma by default. */
function splitTags(text: string, delimiters: readonly string[] = [',']) {
  return text
    .split(delimiterPattern(delimiters))
    .map((part) => part.trim())
    .filter(Boolean)
}

/** Matches a line break or any one of `delimiters`. */
function delimiterPattern(delimiters: readonly string[]) {
  const escaped = delimiters.map((delimiter) =>
    delimiter.replace(/[\\^$.*+?()[\]{}|-]/g, '\\$&'),
  )
  return new RegExp(`[\\r\\n${escaped.join('')}]`)
}

interface Added {
  /** The tags after the change. */
  value: string[]
  added: string[]
  /** Tags typed again, as they were already written. */
  repeated: string[]
}

/**
 * Adds `texts` to `value` as tags: each trimmed, in a suggestion's spelling
 * when it names one, and never twice.
 */
function addTags(
  value: readonly string[],
  texts: readonly string[],
  suggestions: readonly string[] = [],
): Added {
  const next = [...value]
  const added: string[] = []
  const repeated: string[] = []
  for (const text of texts.map((part) => part.trim()).filter(Boolean)) {
    const existing = findTag(next, text)
    if (existing) {
      if (!added.includes(existing)) repeated.push(existing)
      continue
    }
    const tag = findTag(suggestions, text) ?? text
    next.push(tag)
    added.push(tag)
  }
  return { value: next, added, repeated }
}

/** What a screen reader hears after a change. */
function announcement(
  added: readonly string[],
  removed: readonly string[],
  repeated: readonly string[],
) {
  if (added.length > 1) return `${added.length} tags added`
  if (added.length === 1) return `${added[0]} added`
  if (removed.length > 1) return `${removed.length} tags removed`
  if (removed.length === 1) return `${removed[0]} removed`
  if (repeated.length > 0) return `${repeated[0]} is already added`
  return ''
}

const TagInputContext = createContext<{
  add: (texts: readonly string[]) => void
  tags: readonly string[]
  suggestions: readonly string[]
  query: string
  flash: { tag: string; key: number } | undefined
  button: boolean
  delimiters: readonly string[]
  split: (text: string) => string[]
} | null>(null)

function useTagInput() {
  const context = use(TagInputContext)
  if (!context) throw new Error('Tag input parts go inside a TagInput.')
  return context
}

type TagInputProps = Omit<
  ComponentProps<typeof Combobox<string, true>>,
  'multiple' | 'items' | 'allowCustomValue'
> & {
  /** Tags to offer as you type. Without them, the field takes whatever is typed and opens no list. */
  suggestions?: readonly string[]
  /**
   * Opened from a `ComboboxTrigger` that shows the tags, with the
   * `TagInputInput` in the popup, rather than typed into in place: the list
   * opens with no suggestions too, to add one, and lists the tags added,
   * ticked, so one can be taken off there. Text left typed when it closes
   * is dropped, not added.
   */
  button?: boolean
  /**
   * The characters that end a tag as they are typed, and split a paste into
   * tags beside its lines: a comma by default. Emails take `[',', ' ', ';']`.
   */
  delimiters?: readonly string[]
  /**
   * The tags a paste with delimiters or lines holds: split on them by
   * default. Emails copied from a mail app (`Ana Lima <ana@kino.app>`) take
   * a split that keeps only the addresses.
   */
  split?: (text: string) => string[]
}

/**
 * The root. Enter, a comma or leaving the field adds what was typed as a
 * tag, a paste adds one per comma or line, and a tag typed again is pointed
 * out instead of added twice. Every change is announced.
 */
function TagInput({
  value: valueProp,
  defaultValue = [],
  onValueChange,
  suggestions = [],
  controller: controllerProp,
  query: queryProp,
  defaultQuery = '',
  onQueryChange,
  button = false,
  delimiters = defaultDelimiters,
  split = (text) => splitTags(text, delimiters),
  children,
  ...props
}: TagInputProps) {
  const [ownController] = useState(() => createComboboxController<string, true>())
  const controller = controllerProp ?? ownController
  // The tags as the Combobox last gave them, to list the suggestions not
  // added yet and to tell what a change added or removed.
  const [ownTags, setOwnTags] = useState<readonly string[]>(defaultValue)
  const tags = valueProp ?? ownTags
  const [ownQuery, setOwnQuery] = useState(defaultQuery)
  const query = queryProp ?? ownQuery
  const [flash, setFlash] = useState<{ tag: string; key: number }>()
  const repeatedRef = useRef<readonly string[]>([])

  const point = (repeated: readonly string[]) => {
    if (!repeated[0]) return
    setFlash((last) => ({ tag: repeated[0], key: (last?.key ?? 0) + 1 }))
  }

  const add = (texts: readonly string[]) => {
    const result = addTags(controller.getValue(), texts, suggestions)
    if (result.added.length === 0) {
      announce(announcement([], [], result.repeated))
      point(result.repeated)
    } else {
      repeatedRef.current = result.repeated
      controller.setValue(result.value)
    }
    controller.setQuery('')
  }

  // Without suggestions there is no list in the field: Enter adds what was typed.
  const listed = button || suggestions.length > 0

  return (
    <TagInputContext
      value={{ add, tags, suggestions, query, flash, button, delimiters, split }}
    >
      <Combobox<string, true>
        multiple
        // Enter with nothing highlighted, or no list, adds what was typed.
        allowCustomValue
        controller={controller}
        {...(listed ? {} : { open: false })}
        value={valueProp}
        defaultValue={defaultValue}
        onValueChange={(next, details) => {
          // A suggestion picked or text kept is added as a tag is: in a
          // suggestion's spelling, and never twice.
          const kept = tags.filter((tag) => next.includes(tag))
          const result = addTags(
            kept,
            next.filter((tag) => !tags.includes(tag)),
            suggestions,
          )
          if (!sameTags(result.value, next)) {
            details.cancel()
            if (sameTags(result.value, tags)) {
              // The value stays, so no change follows to say so.
              announce(announcement([], [], result.repeated))
              point(result.repeated)
              return
            }
            repeatedRef.current = result.repeated
            controller.setValue(result.value)
            return
          }
          const repeated = repeatedRef.current
          repeatedRef.current = []
          announce(
            announcement(
              next.filter((tag) => !tags.includes(tag)),
              tags.filter((tag) => !next.includes(tag)),
              repeated,
            ),
          )
          point(repeated)
          setOwnTags(next)
          onValueChange?.(next, details)
        }}
        query={query}
        onQueryChange={(next, details) => {
          setOwnQuery(next)
          onQueryChange?.(next, details)
        }}
        {...props}
      >
        {children}
      </Combobox>
    </TagInputContext>
  )
}

const defaultDelimiters: readonly string[] = [',']

/** Where the tags show: the field, with the input after the last chip. */
const TagInputChips = ComboboxChips

/**
 * The tags, as chips. Give it a function child to draw a tag's content,
 * such as an icon beside its name.
 */
function TagInputValue({
  children,
  invalid,
}: {
  children?: (tag: string) => ReactNode
  /** Whether a tag can't be taken as it is, such as an email with no domain: its chip shows the invalid look. Say why beside the field. */
  invalid?: (tag: string) => boolean
}) {
  return (
    <ComboboxValue>
      {(state) =>
        (state.value as string[]).map((tag) => (
          <TagInputChip
            key={tag}
            value={tag}
            data-invalid={invalid?.(tag) ? '' : undefined}
          >
            {children ? children(tag) : tag}
          </TagInputChip>
        ))
      }
    </ComboboxValue>
  )
}

/** A tag. It is pointed out for a moment when the same tag is typed again. */
function TagInputChip({
  value,
  onTransitionEnd,
  ...props
}: ComponentProps<typeof ComboboxChip<string>> & { value: string }) {
  const { flash } = useTagInput()
  const key = flash?.tag === value ? flash.key : undefined
  // A chip that arrives after a flash, such as a tag removed and added
  // again, takes that flash as already shown.
  const [shown, setShown] = useState(key)
  const flashing = key !== undefined && key !== shown
  return (
    <ComboboxChip<string>
      value={value}
      data-tag={value}
      data-flash={flashing ? '' : undefined}
      onTransitionEnd={(event) => {
        onTransitionEnd?.(event)
        // Back once it has turned, so it shows for a whole `press`.
        if (flashing && event.target === event.currentTarget) setShown(key)
      }}
      {...props}
    />
  )
}

/**
 * The text you type. Enter, or a delimiter such as a comma, adds it as a
 * tag; a paste with delimiters or lines adds one tag for each, and what is
 * left typed when focus goes is kept as a tag.
 */
function TagInputInput({
  onKeyDown,
  onPaste,
  onBlur,
  ...props
}: ComponentProps<typeof ComboboxInput>) {
  const { add, tags, button, delimiters, split } = useTagInput()
  return (
    <ComboboxInput
      enterKeyHint='enter'
      onKeyDown={(event) => {
        onKeyDown?.(event)
        if (event.defaultPrevented || isComposing(event.nativeEvent)) return
        const typed = event.currentTarget.value
        // Enter on a tag already added, with no suggestion highlighted, is
        // no change to the Combobox: it is pointed out and said here.
        const repeated =
          event.key === 'Enter' &&
          !event.currentTarget.hasAttribute('aria-activedescendant') &&
          findTag(tags, typed) !== undefined
        if (!delimiters.includes(event.key) && !repeated) return
        event.preventDefault()
        add([typed])
      }}
      onPaste={(event) => {
        onPaste?.(event)
        if (event.defaultPrevented) return
        const pasted = event.clipboardData.getData('text')
        if (!delimiterPattern(delimiters).test(pasted)) return
        event.preventDefault()
        const input = event.currentTarget
        const text =
          input.value.slice(0, input.selectionStart ?? input.value.length) +
          pasted +
          input.value.slice(input.selectionEnd ?? input.value.length)
        add(split(text))
      }}
      onBlur={(event) => {
        onBlur?.(event)
        // From a button, leaving the search closes the list: Escape or a press outside cancels.
        if (!button && event.currentTarget.value.trim() !== '')
          add([event.currentTarget.value])
      }}
      {...props}
    />
  )
}

/** The suggestions' box, under the field. */
const TagInputContent = ComboboxContent

/**
 * What shows when no suggestion matches and nothing new can be added. When
 * the typed text names a tag already added, it says so instead.
 */
function TagInputEmpty({ children, ...props }: ComponentProps<typeof ComboboxEmpty>) {
  const { tags, suggestions, query } = useTagInput()
  const taken = query.trim() ? findTag(tags, query) : undefined
  // While the list's last row adds what was typed, nothing is empty to say.
  if (addsNew(query, tags, suggestions)) return null
  return (
    <ComboboxEmpty {...props}>
      {taken ? `${taken} is already added` : children}
    </ComboboxEmpty>
  )
}

/**
 * The suggestions not added yet that match what was typed, and a last row
 * that adds it as a new tag; from a button, the tags added too, ticked. Give
 * it a function child to draw a row of your own.
 */
function TagInputList({
  children,
  ...props
}: Omit<ComponentProps<typeof ComboboxList>, 'children'> & {
  children?: (tag: string) => ReactNode
}) {
  const { add, tags, suggestions, query, button } = useTagInput()
  // From a button the list is where a tag comes off, so the added ones stay in it.
  const rows = button
    ? [...suggestions, ...tags.filter((tag) => !findTag(suggestions, tag))]
    : suggestions.filter((suggestion) => !findTag(tags, suggestion))
  const creates = addsNew(query, tags, suggestions)
  return (
    <ComboboxList {...props}>
      {rows.map((tag) =>
        children ? children(tag) : <TagInputItem key={tag} value={tag} />,
      )}
      {creates ? (
        <ComboboxCreate onCreate={(text) => add([text])}>
          {(state) => (
            <>
              {/* Isolated, so the quotes stay around a tag in the other direction. */}
              Add <bdi className='font-medium'>“{state.query.trim()}”</bdi>
            </>
          )}
        </ComboboxCreate>
      ) : null}
    </ComboboxList>
  )
}

/** A suggestion. Children replace its content, such as an icon beside its name. */
function TagInputItem({
  value,
  children,
  ...props
}: Omit<ComponentProps<typeof ComboboxItem>, 'value' | 'indicator'> & {
  value: string
}) {
  // In the field its chip shows it is added; from a button, its tick does.
  const { button } = useTagInput()
  return (
    <ComboboxItem value={value} label={value} indicator={button} {...props}>
      {children ?? value}
    </ComboboxItem>
  )
}

export {
  TagInput,
  TagInputChip,
  TagInputChips,
  TagInputContent,
  TagInputEmpty,
  TagInputInput,
  TagInputItem,
  TagInputList,
  TagInputValue,
}
export { addsNew, addTags, announcement, findTag, sameTag, splitTags }
export type { TagInputProps }
