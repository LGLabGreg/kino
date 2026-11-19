'use client'

import {
  Combobox,
  ComboboxChip,
  ComboboxChips,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from '@/registry/components/kino/combobox'
import { IconPlaceholder } from '@/registry/icons/icon-placeholder'
import { useAnnouncer } from '@/registry/lib/announce'
import { useControllable } from '@/registry/lib/controllable'
import { Combobox as ComboboxPrimitive } from '@base-ui/react/combobox'
import {
  type ComponentProps,
  createContext,
  type ReactNode,
  type RefObject,
  use,
  useRef,
  useState,
} from 'react'

/*
 * Several values held as chips in one field: typed, pasted or picked from
 * suggestions. It is the Combobox with many values, as strings, so its chips
 * glide and leave the same way: a tag that comes or goes moves the others to
 * their new places, and the field grows a line at a time.
 */

/** Whether two tags are the same, ignoring case and the spaces around them. */
function sameTag(a: string, b: string) {
  return a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase()
}

/** The tag in `tags` that `text` names, if there is one. */
function findTag(tags: readonly string[], text: string) {
  return tags.find((tag) => sameTag(tag, text))
}

/** What a paste or a typed comma holds: one tag per comma or line. */
function splitTags(text: string) {
  return text
    .split(/[,\n]/)
    .map((part) => part.trim())
    .filter(Boolean)
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

/**
 * The suggestions to list: those not picked yet, then what was typed, when
 * no tag or suggestion has its name, as a row that adds it.
 */
function suggestionsFor(
  suggestions: readonly string[],
  value: readonly string[],
  typed: string,
) {
  const open = suggestions.filter((suggestion) => !findTag(value, suggestion))
  const text = typed.trim()
  if (!text || findTag(suggestions, text) || findTag(value, text)) return open
  return [...open, text]
}

const TagInputContext = createContext<{
  add: (texts: readonly string[]) => void
  clear: () => void
  /** What a row that adds a new tag would add: the text typed, when it names no suggestion. */
  creating: string | undefined
  flash: { tag: string; key: number } | undefined
  /** The tag the typed text names, when it is already added. */
  taken: string | undefined
  /** The suggestion the arrow keys or the pointer are on. */
  highlighted: RefObject<string | undefined>
  /** Whether the suggestions are open. */
  open: RefObject<boolean>
} | null>(null)

function useTagInput() {
  const context = use(TagInputContext)
  if (!context) throw new Error('Tag input parts go inside a TagInput.')
  return context
}

type TagInputProps = Omit<
  ComboboxPrimitive.Root.Props<string, true>,
  | 'multiple'
  | 'items'
  | 'value'
  | 'defaultValue'
  | 'onValueChange'
  | 'inputValue'
  | 'defaultInputValue'
  | 'onInputValueChange'
> & {
  value?: string[]
  defaultValue?: string[]
  /**
   * `details` comes from Base UI when it made the change (a row picked, a
   * chip removed), and is undefined for a tag added with a comma, a paste or
   * by leaving the field.
   */
  onValueChange?: (
    value: string[],
    details?: ComboboxPrimitive.Root.ChangeEventDetails,
  ) => void
  inputValue?: string
  defaultInputValue?: string
  /** `details` as for `onValueChange`: undefined when a tag added from the text empties it. */
  onInputValueChange?: (
    value: string,
    details?: ComboboxPrimitive.Root.ChangeEventDetails,
  ) => void
  /** Tags to offer as you type. Without them, the field takes whatever is typed and opens no list. */
  suggestions?: readonly string[]
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
  inputValue,
  defaultInputValue = '',
  onInputValueChange,
  onItemHighlighted,
  onOpenChange,
  onOpenChangeComplete,
  children,
  ...props
}: TagInputProps) {
  const [value, setValue] = useControllable<
    string[],
    [ComboboxPrimitive.Root.ChangeEventDetails | undefined]
  >(valueProp, defaultValue, onValueChange)
  const [query, changeQuery] = useControllable<
    string,
    [ComboboxPrimitive.Root.ChangeEventDetails | undefined]
  >(inputValue, defaultInputValue, onInputValueChange)
  const setQuery = (next: string, details?: ComboboxPrimitive.Root.ChangeEventDetails) =>
    changeQuery(next, details)
  const { announce, region } = useAnnouncer()
  const [flash, setFlash] = useState<{ tag: string; key: number }>()
  const highlighted = useRef<string | undefined>(undefined)
  const open = useRef(false)

  const commit = (
    next: string[],
    repeated: readonly string[] = [],
    details?: ComboboxPrimitive.Root.ChangeEventDetails,
  ) => {
    const added = next.filter((tag) => !value.includes(tag))
    const removed = value.filter((tag) => !next.includes(tag))
    const text = announcement(added, removed, repeated)
    announce(text)
    if (repeated[0]) setFlash((last) => ({ tag: repeated[0], key: (last?.key ?? 0) + 1 }))
    if (added.length === 0 && removed.length === 0) return
    setValue(next, details)
  }

  const add = (texts: readonly string[]) => {
    const result = addTags(value, texts, suggestions)
    commit(result.value, result.repeated)
    setQuery('')
  }

  // Without suggestions there is no list: Enter adds what was typed, and
  // the input never claims a list is open.
  const listed = suggestions.length > 0
  const items = listed ? suggestionsFor(suggestions, value, query) : []
  const typed = query.trim()
  const live = {
    items,
    creating:
      typed && items.at(-1) === typed && !findTag(suggestions, typed) ? typed : undefined,
    taken: typed ? findTag(value, typed) : undefined,
  }
  // A list that closes keeps the rows it had while it fades: the pick, or
  // the text added, would otherwise empty it into "nothing matches".
  const [closing, setClosing] = useState<typeof live>()
  const { creating, taken } = closing ?? live

  return (
    <TagInputContext
      value={{
        add,
        clear: () => setQuery(''),
        creating,
        flash,
        taken,
        highlighted,
        open,
      }}
    >
      <Combobox<string, true>
        multiple
        items={(closing ?? live).items}
        {...(listed ? {} : { open: false })}
        value={value}
        onValueChange={(next, details) => {
          // A suggestion picked, or a chip removed: the picked one is added as a tag would be.
          const kept = value.filter((tag) => next.includes(tag))
          const picked = next.filter((tag) => !value.includes(tag))
          const result = addTags(kept, picked, suggestions)
          commit(result.value, result.repeated, details)
        }}
        inputValue={query}
        onInputValueChange={(next, details) => {
          // Base UI empties the field as its list closes. What was typed and
          // left behind (a click elsewhere, Tab) is kept, as a tag; Escape
          // lets it go.
          const escaped =
            details.event instanceof KeyboardEvent && details.event.key === 'Escape'
          if (
            next === '' &&
            details.reason === 'input-clear' &&
            !details.isItemPress &&
            !escaped
          ) {
            add([query])
            return
          }
          setQuery(next, details)
        }}
        onItemHighlighted={(item, details) => {
          highlighted.current = item
          onItemHighlighted?.(item, details)
        }}
        onOpenChange={(next, details) => {
          // Base UI says a list opened even when there is none to show.
          open.current = listed && next
          setClosing(next ? undefined : live)
          onOpenChange?.(next, details)
        }}
        onOpenChangeComplete={(next) => {
          if (!next) setClosing(undefined)
          onOpenChangeComplete?.(next)
        }}
        {...props}
      >
        {children}
      </Combobox>
      {/* Mounted from the start, so a screen reader hears what changes in it. */}
      {region}
    </TagInputContext>
  )
}

/** Where the tags show: the field, with the input after the last chip. */
const TagInputChips = ComboboxChips

/**
 * The tags, as chips. Give it a function child to draw a tag's content,
 * such as an icon beside its name.
 */
function TagInputValue({ children }: { children?: (tag: string) => ReactNode }) {
  return (
    <ComboboxPrimitive.Value>
      {(tags: string[]) =>
        tags.map((tag) => (
          <TagInputChip key={tag} tag={tag}>
            {children ? children(tag) : tag}
          </TagInputChip>
        ))
      }
    </ComboboxPrimitive.Value>
  )
}

/** A tag. It is pointed out for a moment when the same tag is typed again. */
function TagInputChip({
  tag,
  onTransitionEnd,
  ...props
}: ComponentProps<typeof ComboboxChip> & { tag: string }) {
  const { flash } = useTagInput()
  const key = flash?.tag === tag ? flash.key : undefined
  // A chip that arrives after a flash, such as a tag removed and added
  // again, takes that flash as already shown.
  const [shown, setShown] = useState(key)
  const flashing = key !== undefined && key !== shown
  return (
    <ComboboxChip
      data-tag={tag}
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
 * The text you type. Enter, or a comma, adds it as a tag; a paste with
 * commas or lines adds one tag for each. Escape lets go of what is typed,
 * never of the tags.
 */
function TagInputInput({
  onKeyDown,
  onPaste,
  onBlur,
  ...props
}: ComponentProps<typeof ComboboxInput>) {
  const { add, clear, highlighted, open } = useTagInput()
  return (
    <ComboboxInput
      enterKeyHint='enter'
      onKeyDown={(event) => {
        onKeyDown?.(event)
        if (event.baseUIHandlerPrevented || event.nativeEvent.isComposing) return
        const text = event.currentTarget.value
        // Enter on a suggestion picks it; Enter on what was typed adds it.
        const adds =
          event.key === ',' ||
          (event.key === 'Enter' && !highlighted.current && text.trim() !== '')
        if (adds) {
          event.preventDefault()
          event.preventBaseUIHandler()
          add([text])
        } else if (event.key === 'Escape' && !open.current) {
          // Base UI would empty the field of its tags too.
          event.preventBaseUIHandler()
          clear()
        }
      }}
      onPaste={(event) => {
        onPaste?.(event)
        if (event.baseUIHandlerPrevented) return
        const pasted = event.clipboardData.getData('text')
        if (!/[,\n]/.test(pasted)) return
        event.preventDefault()
        const input = event.currentTarget
        const text =
          input.value.slice(0, input.selectionStart ?? input.value.length) +
          pasted +
          input.value.slice(input.selectionEnd ?? input.value.length)
        add(splitTags(text))
      }}
      onBlur={(event) => {
        onBlur?.(event)
        // What was typed and left is kept, as a tag.
        if (event.currentTarget.value.trim() !== '') add([event.currentTarget.value])
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
  const { taken } = useTagInput()
  return (
    <ComboboxEmpty {...props}>
      {taken ? `${taken} is already added` : children}
    </ComboboxEmpty>
  )
}

/**
 * The suggestions that match what was typed, and a last row that adds it as
 * a new tag. Give it a function child to draw a row of your own.
 */
function TagInputList({
  children,
  ...props
}: Omit<ComponentProps<typeof ComboboxList>, 'children'> & {
  children?: (tag: string) => ReactNode
}) {
  return (
    <ComboboxList {...props}>
      {(tag: string) =>
        children ? children(tag) : <TagInputItem key={tag} value={tag} />
      }
    </ComboboxList>
  )
}

/**
 * A suggestion, or the row that adds what was typed: "Add “roadmap”".
 * Children replace either row's content, such as the words of another
 * language.
 */
function TagInputItem({
  value,
  children,
  ...props
}: Omit<ComponentProps<typeof ComboboxItem>, 'value' | 'indicator'> & { value: string }) {
  const { creating } = useTagInput()
  if (value !== creating) {
    return (
      <ComboboxItem value={value} indicator={false} {...props}>
        {children ?? value}
      </ComboboxItem>
    )
  }
  return (
    <ComboboxItem value={value} indicator={false} {...props}>
      {children ?? (
        <>
          <IconPlaceholder
            lucide='PlusIcon'
            tabler='IconPlus'
            hugeicons='PlusSignIcon'
            phosphor='PlusIcon'
            remixicon='RiAddLine'
            aria-hidden
          />
          {/* A long tag wraps, at any character, as the menus' rows do. */}
          <span className='min-w-0 wrap-anywhere'>
            {/* Isolated, so the quotes stay around a tag in the other direction. */}
            Add <bdi className='font-medium'>“{value}”</bdi>
          </span>
        </>
      )}
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
export { addTags, announcement, findTag, sameTag, splitTags, suggestionsFor }
export type { TagInputProps }
