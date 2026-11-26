'use client'

import { Input } from '@/registry/components/kino/input'
import { Textarea } from '@/registry/components/kino/textarea'
import { useAnnouncer } from '@/registry/lib/announce'
import {
  FilterListFrame,
  FilterListMatchedText,
  FilterListRows,
  filterListScrollerClassName,
} from '@/registry/lib/filter-list'
import { isComposing } from '@/registry/lib/keys'
import { matchRange } from '@/registry/lib/match'
import {
  menuLabelClassName,
  menuNoticeClassName,
  menuRowVariants,
  menuSeparatorClassName,
} from '@/registry/lib/menu'
import {
  popupGrowClassName,
  popupPositionerProps,
  popupSurfaceClassName,
  usePopupGrow,
} from '@/registry/lib/popup'
import { mergeRefs } from '@/registry/lib/refs'
import { followEdges } from '@/registry/lib/scroll'
import {
  type TriggerEditor,
  TriggerEditorContext,
  type TriggerTokenContent,
  textFieldEditor,
} from '@/registry/lib/trigger-editor'
import { Popover as PopoverPrimitive } from '@base-ui/react/popover'
import {
  type ComponentProps,
  createContext,
  type ReactNode,
  type RefCallback,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import { cn } from '@/lib/utils'

/*
 * Suggestions that open at a character typed in a field: @ for people, / for
 * commands, # for tags. The box grows out from under the character, narrows
 * to what matches as the person types, and puts the pick in place of what
 * they typed. It is the Autocomplete's box, rows and gliding highlight; the
 * field keeps focus throughout, and the arrows, Enter, Tab and Escape steer
 * the list from it.
 */

/** A character that opens the suggestions. */
interface TriggerMenuTrigger {
  /** The character, such as `@`. */
  char: string
  /**
   * Where it opens: `word` at the start of a word, so an email address
   * doesn't; `line` only as a line's first character, as commands do.
   */
  start?: 'word' | 'line'
  /** What the list is called for a screen reader, such as `People`. */
  label?: string
  /** The kind of token a pick becomes in an editor that holds tokens; the character by default. */
  type?: string
}

/** The trigger typed, and the query after it up to the caret. */
interface TriggerMatch {
  trigger: TriggerMenuTrigger
  /** Where the trigger character is. */
  start: number
  /** The end of the word the caret is in: a pick replaces `[start, end)`. */
  end: number
  /** What was typed between the trigger and the caret. */
  query: string
}

interface TriggerMenuContextValue {
  listId: string
  open: boolean
  /** The match the list shows: the last one while it closes, so it folds back as it was. */
  match: TriggerMatch | null
  anchor: {
    getBoundingClientRect: () => DOMRect
    contextElement: Element
  } | null
  active: string | null
  setActive: (value: string | null) => void
  pick: (item: PickedItem) => void
  listRef: RefCallback<HTMLDivElement>
  syncRows: () => void
}

const TriggerMenuContext = createContext<TriggerMenuContextValue | null>(null)

/*
 * The field's own way in, apart from the menu's state, so typing doesn't
 * render the field again before React has read its new value.
 */
const TriggerMenuFieldContext = createContext<
  ((field: HTMLTextAreaElement | HTMLInputElement | null) => void) | null
>(null)

function useAttachField() {
  const attachField = useContext(TriggerMenuFieldContext)
  if (!attachField) throw new Error('Trigger menu parts go inside <TriggerMenu>.')
  return attachField
}

function useTriggerMenu() {
  const context = useContext(TriggerMenuContext)
  if (!context) throw new Error('Trigger menu parts go inside <TriggerMenu>.')
  return context
}

interface PickedItem {
  value: string
  label: string
  insert?: string | TriggerTokenContent
  onSelect?: () => void
}

/** The rows a key can reach, in order. */
function enabledOptions(list: HTMLElement | null) {
  return list
    ? [
        ...list.querySelectorAll<HTMLElement>(
          '[role="option"]:not([aria-disabled="true"])',
        ),
      ]
    : []
}

function TriggerMenu({
  triggers,
  editor: editorProp,
  onMatchChange,
  resultsLabel = defaultResultsLabel,
  children,
}: {
  /** The characters that open it, as characters or with their options. */
  triggers: readonly (string | TriggerMenuTrigger)[]
  /** An editor of your own; a Token input around the menu provides its own. */
  editor?: TriggerEditor
  /** Called when the trigger or the query changes, and with null when there's none: load suggestions from here. */
  onMatchChange?: (match: TriggerMatch | null) => void
  /** What a screen reader hears when the suggestions change. */
  resultsLabel?: (count: number) => string
  children?: ReactNode
}) {
  const listId = useId()
  const contextEditor = useContext(TriggerEditorContext)
  const [ownEditor, setOwnEditor] = useState<TriggerEditor | null>(null)
  const editor = editorProp ?? ownEditor ?? contextEditor
  const ownsField = editor !== null && editor === ownEditor

  const attachField = useCallback(
    (field: HTMLTextAreaElement | HTMLInputElement | null) => {
      setOwnEditor(field ? textFieldEditor(field) : null)
    },
    [],
  )

  const [seen, setView] = useState(emptyView)
  // With no editor, nothing is typed.
  const view = editor ? seen : emptyView
  useEffect(() => {
    if (!editor) return
    const { element } = editor
    const read = (focused = element.contains(document.activeElement)) =>
      setView((last) => {
        const next = {
          text: editor.getText(),
          selection: editor.getSelection(),
          focused,
        }
        return sameView(last, next) ? last : next
      })
    read()
    const unsubscribe = editor.subscribe(() => read())
    const onFocusOut = (event: FocusEvent) =>
      read(element.contains(event.relatedTarget as Node | null))
    const onFocusIn = () => read(true)
    element.addEventListener('focusin', onFocusIn)
    element.addEventListener('focusout', onFocusOut)
    return () => {
      unsubscribe()
      element.removeEventListener('focusin', onFocusIn)
      element.removeEventListener('focusout', onFocusOut)
    }
  }, [editor])

  const definitions = useMemo(
    () =>
      triggers.map((trigger) =>
        typeof trigger === 'string' ? { char: trigger } : trigger,
      ),
    [triggers],
  )
  const live =
    view.focused && view.selection && view.selection.start === view.selection.end
      ? findTriggerMatch(view.text, view.selection.end, definitions)
      : null
  const liveKey = live ? matchKey(live) : null

  // The list opens as a trigger is typed, or with Ctrl+Space. The caret only
  // passing through a mention already written leaves it shut, so Enter there
  // is still a new line. Escape shuts it for this match: typing on doesn't
  // reopen it, and a new trigger does.
  const [armed, setArmed] = useState<string | null>(null)
  const [dismissed, setDismissed] = useState<string | null>(null)
  const [seenText, setSeenText] = useState(view.text)
  if (view.text !== seenText) {
    setSeenText(view.text)
    setArmed(liveKey)
  }
  if (dismissed !== null && dismissed !== liveKey) setDismissed(null)
  const matched = live !== null && liveKey === armed && liveKey !== dismissed

  // What the box shows: the match it opened for, kept while it folds away.
  // A match at another trigger waits for the last box to fold, then grows
  // from its own character, rather than the box jumping across to it.
  const [shown, setShown] = useState<TriggerMatch | null>(null)
  const sameTrigger =
    shown !== null &&
    live !== null &&
    shown.trigger === live.trigger &&
    shown.start === live.start
  const open = matched && (shown === null || sameTrigger)
  if (open && !sameMatch(live, shown)) setShown(live)

  const [active, setActive] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)
  const attachList = useCallback<RefCallback<HTMLDivElement>>((list) => {
    listRef.current = list
    return () => {
      listRef.current = null
    }
  }, [])

  const anchorStart = shown?.start ?? 0
  const anchor = useMemo(() => {
    if (!editor) return null
    return {
      getBoundingClientRect: () =>
        editor.getCaretRect(anchorStart) ?? editor.element.getBoundingClientRect(),
      contextElement: editor.element,
    }
    // A new object on every keystroke, so Base UI places the box again when
    // the word being typed wraps onto the next line.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, anchorStart, view.text])

  const pick = useCallback(
    (item: PickedItem) => {
      if (!editor || !live) return
      const { trigger } = live
      const text = editor.getText()
      // A pick gets the space after it that keeps the next word apart, in
      // every editor and whoever wrote the insert.
      const space = trailingSpace(text, live.end)
      const token = {
        type: trigger.type ?? trigger.char,
        value: item.value,
        label: item.label,
        text: `${trigger.char}${item.label}`,
      }
      const insert = item.insert ?? (ownsField ? `${trigger.char}${item.label}` : token)
      const content =
        insert === ''
          ? ''
          : typeof insert === 'string'
            ? `${insert}${space}`
            : space
              ? [insert, space]
              : insert
      editor.replace(live.start, live.end, content)
      item.onSelect?.()
    },
    [editor, live, ownsField],
  )

  // The first suggestion is highlighted on open and after every keystroke, so
  // Enter takes the best match; one that goes away hands the highlight on.
  const query = open ? live?.query : undefined
  useLayoutEffect(() => {
    if (query === undefined) return
    setActive(enabledOptions(listRef.current)[0]?.dataset.value ?? null)
  }, [liveKey, query])
  // Rows that come or go (a load that answers, a row disabled) keep a
  // highlight on one that is there, and the count a screen reader hears.
  const [count, setCount] = useState(0)
  const syncRows = useCallback(() => {
    const values = enabledOptions(listRef.current).map((option) => option.dataset.value)
    setActive((current) =>
      current !== null && values.includes(current) ? current : (values[0] ?? null),
    )
    setCount(values.length)
  }, [])

  const keys = useRef({ open, active, liveKey, definitions })
  useLayoutEffect(() => {
    keys.current = { open, active, liveKey, definitions }
  })
  useEffect(() => {
    if (!editor) return
    const { element } = editor
    const onKeyDown = (event: KeyboardEvent) => {
      if (isComposing(event)) return
      const state = keys.current
      if (!state.open) {
        // Ctrl+Space opens it at the trigger the caret is in, read afresh,
        // since the caret may have moved since the last render.
        if (event.ctrlKey && event.code === 'Space') {
          const selection = editor.getSelection()
          const match =
            selection && selection.start === selection.end
              ? findTriggerMatch(editor.getText(), selection.end, state.definitions)
              : null
          if (!match) return
          event.preventDefault()
          setDismissed(null)
          setArmed(matchKey(match))
        }
        return
      }
      const plain = !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey
      if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && plain) {
        const options = enabledOptions(listRef.current)
        // With no rows, the arrows move the caret between lines as usual.
        if (options.length === 0) return
        event.preventDefault()
        const next = steppedIndex(
          options.findIndex((option) => option.dataset.value === state.active),
          event.key === 'ArrowDown' ? 1 : -1,
          options.length,
        )
        if (next !== null) setActive(options[next].dataset.value ?? null)
        return
      }
      if ((event.key === 'Enter' || event.key === 'Tab') && plain) {
        const row = enabledOptions(listRef.current).find(
          (option) => option.dataset.value === state.active,
        )
        if (!row) return
        event.preventDefault()
        row.click()
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        // Not a dialog around the field: only the list closes.
        event.stopPropagation()
        setDismissed(state.liveKey)
      }
    }
    element.addEventListener('keydown', onKeyDown, true)
    return () => element.removeEventListener('keydown', onKeyDown, true)
  }, [editor])

  // The field stays a text box; it points at the list and its highlighted
  // row, which a screen reader reads as the highlight moves. A one-line input
  // is a combobox.
  useLayoutEffect(() => {
    if (!editor) return
    const { element } = editor
    const combobox = element instanceof HTMLInputElement
    const activeId = open
      ? listRef.current?.querySelector<HTMLElement>('[role="option"][data-highlighted]')
          ?.id
      : undefined
    const attributes: Record<string, string | undefined> = {
      'aria-autocomplete': 'list',
      'aria-controls': open ? listId : undefined,
      'aria-activedescendant': activeId,
      ...(combobox && {
        role: 'combobox',
        'aria-haspopup': 'listbox',
        'aria-expanded': String(open),
      }),
    }
    for (const [name, value] of Object.entries(attributes)) {
      if (value === undefined) element.removeAttribute(name)
      else element.setAttribute(name, value)
    }
  })
  useEffect(() => {
    if (!editor) return
    const { element } = editor
    return () => {
      for (const name of [
        'aria-autocomplete',
        'aria-controls',
        'aria-activedescendant',
        'role',
        'aria-haspopup',
        'aria-expanded',
      ]) {
        element.removeAttribute(name)
      }
    }
  }, [editor])

  // How many suggestions there are, said once typing pauses.
  const { announce, region } = useAnnouncer()
  const said = useRef<string | null>(null)
  useEffect(() => {
    if (!open) {
      said.current = null
      return
    }
    const timer = setTimeout(() => {
      const empty = document
        .getElementById(listId)
        ?.closest('[data-trigger-menu-content]')
        ?.querySelector('[data-slot="trigger-menu-empty"]')
        ?.textContent?.trim()
      const text = count === 0 && empty ? empty : resultsLabel(count)
      if (text === said.current) return
      said.current = text
      announce(text)
    }, 500)
    return () => clearTimeout(timer)
    // Once typing pauses on a new count; the words are read when it's said.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, count, query])

  useEffect(() => {
    onMatchChange?.(live)
    // Only when what was typed changes, not each time the parent renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveKey, live?.query])

  const context: TriggerMenuContextValue = {
    listId,
    open,
    match: shown,
    anchor,
    active,
    setActive,
    pick,
    listRef: attachList,
    syncRows,
  }

  return (
    <TriggerMenuFieldContext.Provider value={attachField}>
      <TriggerMenuContext.Provider value={context}>
        <PopoverPrimitive.Root
          open={open}
          onOpenChangeComplete={(next) => {
            if (!next) setShown(null)
          }}
          onOpenChange={(next, details) => {
            if (next) return
            const target = details.event?.target
            // A press in the field moves the caret, which decides by itself.
            if (target instanceof Node && editor?.element.contains(target)) return
            setDismissed(liveKey)
          }}
        >
          {children}
        </PopoverPrimitive.Root>
        {region}
      </TriggerMenuContext.Provider>
    </TriggerMenuFieldContext.Provider>
  )
}

/** A field and its caret as the menu last saw them. */
interface FieldView {
  text: string
  selection: { start: number; end: number } | null
  focused: boolean
}

const emptyView: FieldView = { text: '', selection: null, focused: false }

function sameView(a: FieldView, b: FieldView) {
  return (
    a.text === b.text &&
    a.focused === b.focused &&
    a.selection?.start === b.selection?.start &&
    a.selection?.end === b.selection?.end
  )
}

/** Which trigger a match is at: its character and where it is. */
function matchKey(match: TriggerMatch) {
  return `${match.trigger.char}:${match.start}`
}

function sameMatch(a: TriggerMatch | null, b: TriggerMatch | null) {
  return (
    a === b ||
    (a !== null &&
      b !== null &&
      a.trigger === b.trigger &&
      a.start === b.start &&
      a.end === b.end &&
      a.query === b.query)
  )
}

function defaultResultsLabel(count: number) {
  if (count === 0) return 'No suggestions'
  return count === 1 ? '1 suggestion' : `${count} suggestions`
}

/** The textarea to type in: Kino's own, with the menu wired to it. */
function TriggerMenuTextarea({ ref, ...props }: ComponentProps<typeof Textarea>) {
  const attachField = useAttachField()
  // One callback for the field's life, so React doesn't hand it the element again each render.
  const fieldRef = useMemo(() => mergeRefs(ref, attachField), [ref, attachField])
  return <Textarea data-trigger-menu-textarea='' ref={fieldRef} {...props} />
}

/** A one-line field to type in, such as a search or a subject line. */
function TriggerMenuInput({ ref, ...props }: ComponentProps<typeof Input>) {
  const attachField = useAttachField()
  // One callback for the field's life, so React doesn't hand it the element again each render.
  const fieldRef = useMemo(() => mergeRefs(ref, attachField), [ref, attachField])
  return <Input data-trigger-menu-input='' ref={fieldRef} {...props} />
}

/**
 * The box: it grows out from under the trigger character and folds back
 * into it. `className` goes on the box's content; every other prop goes to
 * Base UI's Popup.
 */
function TriggerMenuContent({
  className,
  children,
  style,
  side = 'bottom',
  align = 'start',
  sideOffset = 6,
  alignOffset = 0,
  ...props
}: Omit<PopoverPrimitive.Popup.Props, 'className' | 'children'> & {
  className?: string
  children?: ReactNode
} & Pick<
    PopoverPrimitive.Positioner.Props,
    'side' | 'align' | 'sideOffset' | 'alignOffset'
  >) {
  const { anchor } = useTriggerMenu()
  const { dir, style: growStyle, anchor: anchorProps } = usePopupGrow()
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Positioner
        {...popupPositionerProps}
        side={side}
        align={align}
        sideOffset={sideOffset}
        alignOffset={alignOffset}
        anchor={anchor}
      >
        <PopoverPrimitive.Popup
          data-slot='trigger-menu-content'
          data-trigger-menu-content=''
          data-filter-list-content=''
          // The field keeps focus: the list is steered from it.
          initialFocus={false}
          finalFocus={false}
          // As Base UI's own list under a field: the list inside is what a screen reader meets.
          role='presentation'
          // Portalled out of the page's tree, so it takes the reading direction with it.
          dir={dir}
          // A press on a row leaves focus, and the caret, in the field.
          onPointerDown={(event) => event.preventDefault()}
          style={(state) => ({
            ...growStyle(state),
            ...(typeof style === 'function' ? style(state) : style),
          })}
          className={cn(
            // One width while it is open, so a row that leaves never jolts it
            // narrower or sideways; a long row wraps.
            'group/popup relative w-[min(18rem,var(--available-width))] rounded-(--list-radius) text-sm',
            popupSurfaceClassName,
            popupGrowClassName,
          )}
          {...props}
        >
          <FilterListFrame className={className}>{children}</FilterListFrame>
          <PopoverPrimitive.Arrow {...anchorProps} />
        </PopoverPrimitive.Popup>
      </PopoverPrimitive.Positioner>
    </PopoverPrimitive.Portal>
  )
}

/**
 * The suggestions, with the highlight that glides between them. Its child is
 * a function of the match, so each trigger lists its own: rows that don't
 * match the query leave by themselves.
 */
function TriggerMenuList({
  className,
  children,
  'aria-label': ariaLabel,
  ...props
}: Omit<ComponentProps<'div'>, 'children' | 'className'> & {
  className?: string
  children: (match: TriggerMatch) => ReactNode
}) {
  const { listId, match, active, listRef, syncRows } = useTriggerMenu()
  const scrollerRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller) return
    syncRows()
    const observer = new MutationObserver(syncRows)
    observer.observe(scroller, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['aria-disabled'],
    })
    const stopEdges = followEdges(scroller, '--scroll-fade')
    return () => {
      observer.disconnect()
      stopEdges()
    }
  }, [syncRows])
  // The highlighted row stays in view as the arrows move it.
  useLayoutEffect(() => {
    scrollerRef.current
      ?.querySelector<HTMLElement>('[role="option"][data-highlighted]')
      ?.scrollIntoView({ block: 'nearest' })
  }, [active])
  return (
    <div
      ref={mergeRefs(scrollerRef, listRef)}
      id={listId}
      role='listbox'
      aria-label={ariaLabel ?? match?.trigger.label ?? 'Suggestions'}
      data-slot='trigger-menu-list'
      data-filtering={match?.query ? '' : undefined}
      className={cn(filterListScrollerClassName, 'not-has-[[role=option]]:hidden')}
      {...props}
    >
      <FilterListRows className={className}>
        {match ? children(match) : null}
      </FilterListRows>
    </div>
  )
}

/**
 * A suggestion: the menus' row. It shows only while it matches the query,
 * by `label` (its text by default) or one of its `keywords`. Picking it puts
 * the trigger and its label in place of what was typed, or `insert`.
 */
function TriggerMenuItem({
  value,
  label,
  keywords,
  disabled = false,
  insert,
  onSelect,
  className,
  children,
  ...props
}: Omit<ComponentProps<'div'>, 'className' | 'onSelect'> & {
  className?: string
  /** Unique among the rows. */
  value: string
  /** The text it is matched by and inserted as; its text, or `value`, by default. */
  label?: string
  /** More words it matches, such as a handle or an email. */
  keywords?: readonly string[]
  disabled?: boolean
  /** What replaces the trigger and the query: an empty string removes them, as a command does. */
  insert?: string | TriggerTokenContent
  /** Called once it is picked and inserted. */
  onSelect?: () => void
}) {
  const { match, active, setActive, pick } = useTriggerMenu()
  const id = useId()
  const text = label ?? (typeof children === 'string' ? children : value)
  if (!match || !itemMatches(text, keywords, match.query)) return null
  const highlighted = active === value
  return (
    // oxlint-disable-next-line jsx-a11y/click-events-have-key-events -- keys reach it through the field, which points at it with aria-activedescendant.
    <div
      id={id}
      role='option'
      tabIndex={-1}
      aria-selected={highlighted}
      aria-disabled={disabled || undefined}
      data-disabled={disabled ? '' : undefined}
      data-highlighted={highlighted ? '' : undefined}
      data-menu-row=''
      data-value={value}
      data-slot='trigger-menu-item'
      onPointerMove={() => {
        if (!disabled && !highlighted) setActive(value)
      }}
      onClick={() => {
        if (!disabled) pick({ value, label: text, insert, onSelect })
      }}
      className={cn(menuRowVariants(), 'group/menu-row', className)}
      {...props}
    >
      {children}
    </div>
  )
}

/**
 * A suggestion's text with the part that matches the query in bold, so the
 * eye finds why it matched.
 */
function TriggerMenuMatch({
  className,
  children,
  ...props
}: Omit<ComponentProps<'span'>, 'children'> & { children: string }) {
  const { match } = useTriggerMenu()
  return (
    <span data-slot='trigger-menu-match' className={cn('min-w-0', className)} {...props}>
      <FilterListMatchedText text={children} query={match?.query ?? ''} />
    </span>
  )
}

/** Rows under a heading; it hides once none of them matches. */
function TriggerMenuGroup({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      role='group'
      data-slot='trigger-menu-group'
      className={cn('flex flex-col not-has-[[role=option]]:hidden', className)}
      {...props}
    />
  )
}

/** A group's heading: give its `id` to the group's `aria-labelledby`. */
function TriggerMenuGroupLabel({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot='trigger-menu-group-label'
      className={cn(menuLabelClassName, className)}
      {...props}
    />
  )
}

/** A line between groups; it hides while a query narrows the rows. */
function TriggerMenuSeparator({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      // A listbox holds only rows and groups, so the line is drawn, not announced.
      aria-hidden
      data-slot='trigger-menu-separator'
      className={cn(menuSeparatorClassName, 'in-data-filtering:hidden', className)}
      {...props}
    />
  )
}

/** What shows when nothing matches: say what was looked for. Also said to a screen reader. */
function TriggerMenuEmpty({
  className,
  children,
  ...props
}: Omit<ComponentProps<'div'>, 'children'> & {
  children?: ReactNode | ((match: TriggerMatch) => ReactNode)
}) {
  const { match } = useTriggerMenu()
  return (
    <div
      data-slot='trigger-menu-empty'
      className={cn(
        menuNoticeClassName,
        'group-has-[[role=option]]/popup:hidden',
        className,
      )}
      {...props}
    >
      {typeof children === 'function' ? (match ? children(match) : null) : children}
    </div>
  )
}

/** The longest query that still counts as one, in characters. */
const MAX_QUERY = 64

const WORD_BEFORE = /[\s([{"'“‘\u{FFFC}]/u

/**
 * The trigger the caret is in, if any: a trigger character at the start of
 * a word (or of a line, for `start: 'line'`), and no space or token between
 * it and the caret.
 */
function findTriggerMatch(
  text: string,
  caret: number,
  triggers: readonly TriggerMenuTrigger[],
): TriggerMatch | null {
  for (let at = caret - 1; at >= 0 && caret - at <= MAX_QUERY + 1; at -= 1) {
    const character = text[at]
    if (/\s/u.test(character) || character === '\u{FFFC}') return null
    const trigger = triggers.find((candidate) => candidate.char === character)
    if (!trigger) continue
    const before = at === 0 ? '' : text[at - 1]
    const opens =
      trigger.start === 'line'
        ? before === '' || before === '\n'
        : before === '' || WORD_BEFORE.test(before)
    if (!opens) return null
    let end = caret
    while (end < text.length && !/\s/u.test(text[end]) && text[end] !== '\u{FFFC}')
      end += 1
    return { trigger, start: at, end, query: text.slice(at + 1, caret) }
  }
  return null
}

/**
 * The space after an inserted pick, so the next word doesn't run into it:
 * none when a space or closing punctuation follows already.
 */
function trailingSpace(text: string, end: number) {
  return /^[\s)\]}.,;:!?'"”’]/u.test(text.slice(end)) ? '' : ' '
}

/** Whether a row matches the query by its label or a keyword; with nothing typed, every row does. */
function itemMatches(
  label: string,
  keywords: readonly string[] | undefined,
  query: string,
) {
  if (!query) return true
  return [label, ...(keywords ?? [])].some((text) => matchRange(text, query) !== null)
}

/** The row the arrows move to from `index` (-1 for none), wrapping round; null with no rows. */
function steppedIndex(index: number, step: 1 | -1, count: number): number | null {
  if (count === 0) return null
  if (index < 0) return step === 1 ? 0 : count - 1
  return (index + step + count) % count
}

export {
  TriggerMenu,
  TriggerMenuContent,
  TriggerMenuEmpty,
  TriggerMenuGroup,
  TriggerMenuGroupLabel,
  TriggerMenuInput,
  TriggerMenuItem,
  TriggerMenuList,
  TriggerMenuMatch,
  TriggerMenuSeparator,
  TriggerMenuTextarea,
  findTriggerMatch,
  itemMatches,
  steppedIndex,
  trailingSpace,
}
export type { TriggerMatch, TriggerMenuTrigger }
