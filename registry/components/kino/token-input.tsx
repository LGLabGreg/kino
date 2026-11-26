'use client'

import { InputInvalidIcon, inputBoxClassName } from '@/registry/components/kino/input'
import { Spinner, useSpinner } from '@/registry/components/kino/spinner'
import {
  textareaRadiusClassName,
  textareaSizeClassName,
} from '@/registry/components/kino/textarea'
import { useAnnouncer } from '@/registry/lib/announce'
import {
  ChipRemoveIcon,
  chipClassName,
  chipLeavingClassName,
  chipRemoveClassName,
} from '@/registry/lib/chip'
import { CutTooltip } from '@/registry/lib/cut'
import { useField, useFieldProps } from '@/registry/lib/field-control'
import { fromWhereItIs, leaveAsCopy, returnFromCopy } from '@/registry/lib/flow'
import { isComposing } from '@/registry/lib/keys'
import { markMounted, mergeRefs } from '@/registry/lib/refs'
import { Swap, swapIconClassName } from '@/registry/lib/swap'
import {
  type TriggerEditor,
  TriggerEditorContext,
  type TriggerContent,
} from '@/registry/lib/trigger-editor'
import {
  type ClipboardEvent,
  type ComponentProps,
  createContext,
  type DragEvent,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  use,
  useEffect,
  useEffectEvent,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { createPortal } from 'react-dom'

import { cn } from '@/lib/utils'

/*
 * Text and tokens in one field, as in a message that mentions people or
 * attaches files. The browser edits the text, so spelling, input methods
 * and autocorrect work as in any field; a token is one piece that the caret
 * steps over, Backspace removes, and copy and paste carry whole. What changes
 * a token, undo and the clipboard are ours, on the value, and the field is
 * drawn again from it.
 */

/** Something that stands in the text as one piece: a person, a file, a tag. */
interface Token {
  /** Its kind, such as `mention` or `file`. */
  type: string
  /** What your app knows it by. */
  value: string
  /** What the field shows. */
  label: string
  /** Kept the same while it is edited; one is made when it's missing. */
  id?: string
  /** `pending` while it loads; `unresolved` when someone has to say which one it is. */
  status?: 'pending' | 'unresolved'
  /** What it turns back into when Backspace reverts it, such as `@Ada Okafor`. Its label by default. */
  text?: string
  /** Anything else its drawing needs. Never written into the text. */
  data?: unknown
}

/** The field's content: text and tokens, in order. */
type TokenInputValue = (string | Token)[]

/**
 * How a value is written as plain text, in a form, on the clipboard or in
 * your store, and read back. The default keeps each token's type, value and
 * label, for a type of letters, digits, `_` and `-`.
 */
interface TokenCodec {
  stringify: (value: TokenInputValue) => string
  parse: (text: string) => TokenInputValue
}

type TokenInputChangeReason =
  | 'input'
  | 'delete'
  | 'paste'
  | 'drop'
  | 'cut'
  | 'undo'
  | 'redo'
  | 'insert'
  | 'remove-press'
  | 'remove'
  | 'update'
  | 'clear'
  | 'reset'

interface TokenInputChangeDetails {
  reason: TokenInputChangeReason
  added: Token[]
  removed: Token[]
}

interface TokenInputActions {
  /**
   * Puts text, a token or a value at the caret (or at the end, when the field
   * isn't focused), as one undo step. A token given `resolve` shows as
   * pending until it settles: it takes what the promise gives, and goes if
   * it fails, leaving no undo step behind. A token keeps the id it is given,
   * unless the field already holds one with it. Returns the inserted token's id.
   */
  insert: (
    content: string | Token | TokenInputValue,
    options?: { resolve?: Promise<Partial<Omit<Token, 'id'>> | void> },
  ) => string | undefined
  /** Puts content in place of everything the field holds, as one undo step, with the caret at its end. */
  replace: (content: string | Token | TokenInputValue) => void
  /** Changes a token in place, such as its status, without an undo step. */
  updateToken: (id: string, patch: Partial<Omit<Token, 'id'>>) => void
  removeToken: (id: string) => void
  undo: () => void
  redo: () => void
  clear: () => void
  focus: () => void
}

/** The selection as offsets into the plain text, where a token is one character. */
interface Selection {
  anchor: number
  focus: number
}

/** A token in the plain text. */
const TOKEN_CHAR = '\uFFFC'
/** Holds the caret beside a token where no text would: removed when the field is read. */
const FILLER = '\u200B'

const TokenInputContext = createContext<{
  editor: HTMLElement | null
  setEditor: (editor: HTMLElement | null) => void
  value: TokenInputValue
  disabled: boolean
  readOnly: boolean
  required: boolean
  handlers: EditorHandlers
  /** The value as the form sends it, in the codec's text. */
  text: string
  name: string | undefined
  form: string | undefined
  hidden: RefObject<HTMLTextAreaElement | null>
  /** The Field's, told of each change the person makes, in the codec's text. */
  editsRef: RefObject<((text: string) => void) | null>
} | null>(null)

function useTokenInput() {
  const context = use(TokenInputContext)
  if (!context) throw new Error('Token input parts go inside a TokenInput.')
  return context
}

const TokenContext = createContext<{
  token: Token & { id: string }
  selected: boolean
  description: string
  remove: () => void
} | null>(null)

/** The token a part is drawn for, inside `renderToken`. */
function useToken() {
  const context = use(TokenContext)
  if (!context) throw new Error('Token parts go inside a TokenInput’s renderToken.')
  return context
}

interface EditorHandlers {
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void
  onCopy: (event: ClipboardEvent<HTMLDivElement>) => void
  onCut: (event: ClipboardEvent<HTMLDivElement>) => void
  onPaste: (event: ClipboardEvent<HTMLDivElement>) => void
  onDragStart: (event: DragEvent<HTMLDivElement>) => void
  onDrop: (event: DragEvent<HTMLDivElement>) => void
}

type TokenInputProps = {
  value?: TokenInputValue
  defaultValue?: TokenInputValue
  onValueChange?: (value: TokenInputValue, details: TokenInputChangeDetails) => void
  /** Called on the submit key. Without it, the key submits the form around the field, if there is one. */
  onSubmit?: (value: TokenInputValue) => void
  /** Which key sends: Enter (Shift+Enter starts a line), or ⌘/Ctrl+Enter (Enter starts a line). */
  submitShortcut?: 'enter' | 'mod+enter'
  /** What Backspace or Delete does to the token beside the caret: removes it, selects it first, or turns it back into text. */
  tokenDeletion?: 'whole' | 'select' | 'revert'
  /** What a copy puts in plain text, for other apps: tokens in the codec's form, or their labels. A paste back here restores them either way. */
  copy?: 'codec' | 'label'
  codec?: TokenCodec
  /** Draws a token: `TokenInputToken` with what it holds, such as an avatar. */
  renderToken?: (token: Token & { id: string }) => ReactNode
  /** What a screen reader says for a token. `“Ada Okafor, mention”` by default. */
  getTokenDescription?: (token: Token) => string
  actionsRef?: RefObject<TokenInputActions | null>
  disabled?: boolean
  readOnly?: boolean
  required?: boolean
  /** The form field the value is sent as, in the codec's text. */
  name?: string
  form?: string
  children?: ReactNode
}

/**
 * The root: holds the value, its undo history and the tokens, and gives a
 * Trigger menu inside it the field to suggest into.
 */
function TokenInput({
  value: valueProp,
  defaultValue = [],
  onValueChange,
  onSubmit,
  submitShortcut = 'enter',
  tokenDeletion = 'whole',
  copy = 'codec',
  codec = tokenCodec,
  renderToken = () => <TokenInputToken />,
  getTokenDescription = describeToken,
  actionsRef,
  disabled: disabledProp = false,
  readOnly = false,
  required = false,
  name,
  form,
  children,
}: TokenInputProps) {
  const field = useField()
  const disabled = disabledProp || field?.disabled === true
  const [ids] = useState(() => new WeakMap<Token, string>())
  const [own, setOwn] = useState(() => withIds(defaultValue, ids))
  const value = useMemo(
    () => (valueProp === undefined ? own : withIds(valueProp, ids)),
    [valueProp, own, ids],
  )
  const [editor, setEditor] = useState<HTMLElement | null>(null)
  const [hosts] = useState(() => new Map<string, HTMLElement>())
  const [selectedIds, setSelectedIds] = useState<readonly string[]>([])
  // Bumped by every change, so the field is drawn again even when a
  // controlled value is held back and stays the same.
  const [revision, setRevision] = useState(0)
  const { announce, region } = useAnnouncer()
  const hidden = useRef<HTMLTextAreaElement>(null)
  const editsRef = useRef<((text: string) => void) | null>(null)

  /** The value as last changed, ahead of the render that shows it. */
  const latest = useRef(value)
  const history = useRef<History>({ entries: [], index: -1 })
  /** Where the caret goes once the next change is drawn. */
  const pendingSelection = useRef<Selection | null>(null)
  const composing = useRef(false)
  /** The selection being dragged, so a move takes it out of its old place. */
  const dragged = useRef<{ start: number; end: number } | null>(null)
  /** What the last `beforeinput` was, so typing groups into one undo step. */
  const lastInput = useRef('')
  const listeners = useRef(new Set<() => void>())
  /** The selection before the browser typed, where an undo puts the caret back. */
  const selectionBeforeInput = useRef<Selection | null>(null)

  const tokens = value.filter(isHeld)
  const notify = () => {
    for (const listener of listeners.current) listener()
  }

  const commit = (
    next: TokenInputValue,
    selection: Selection | null,
    reason: TokenInputChangeReason,
    {
      group = false,
      before: selectionBefore = editor ? readSelection(editor) : null,
    }: { group?: boolean; before?: Selection | null } = {},
  ) => {
    const before = latest.current
    pendingSelection.current = selection
    if (sameValue(before, next)) {
      setRevision((last) => last + 1)
      return
    }
    latest.current = next
    if (reason !== 'undo' && reason !== 'redo') {
      history.current = record(history.current, {
        value: next,
        selection,
        before: selectionBefore,
        group: group ? 'type' : undefined,
        at: performance.now(),
      })
    }
    const { added, removed } = tokenChanges(before, next)
    if (valueProp === undefined) setOwn(next)
    setRevision((last) => last + 1)
    onValueChange?.(next, { reason, added, removed })
    editsRef.current?.(toText(next, codec))
    const said = [
      ...added.map((token) => `Added ${getTokenDescription(token)}`),
      ...removed.map((token) => `Removed ${getTokenDescription(token)}`),
    ]
    if (said.length > 0) announce(said.join('. '))
  }

  /** Where the caret is, or was when the field last had focus: a toolbar button inserts there. */
  const lastSelection = useRef<Selection | null>(null)
  const selection = () =>
    editor && editor.contains(document.activeElement)
      ? readSelection(editor)
      : lastSelection.current

  /** Swaps `[start, end)` for `content`, with the caret after it. */
  const replaceRange = (
    start: number,
    end: number,
    content: TokenInputValue,
    reason: TokenInputChangeReason,
  ) => {
    const fresh = withIds(freshIds(content, latest.current), ids)
    const next = splice(latest.current, start, end, fresh)
    const caret = start + valueLength(fresh)
    commit(next, { anchor: caret, focus: caret }, reason)
    return fresh
  }

  const removeToken = (id: string, reason: TokenInputChangeReason) => {
    const at = tokenIndex(latest.current, id)
    if (at === -1) return
    commit(splice(latest.current, at, at + 1, []), { anchor: at, focus: at }, reason)
  }

  /** Changes the value everywhere, undo history included, without a step of its own. */
  const rewrite = (
    change: (list: TokenInputValue) => TokenInputValue,
    reason: TokenInputChangeReason,
  ) => {
    history.current = rewriteHistory(history.current, change)
    const before = latest.current
    const next = change(before)
    if (sameValue(next, before)) return
    latest.current = next
    if (valueProp === undefined) setOwn(next)
    setRevision((last) => last + 1)
    const { added, removed } = tokenChanges(before, next)
    onValueChange?.(next, { reason, added, removed })
    editsRef.current?.(toText(next, codec))
  }

  const step = (direction: 'undo' | 'redo') => {
    const moved = direction === 'undo' ? undo(history.current) : redo(history.current)
    if (!moved) return
    history.current = moved.history
    commit(moved.value, moved.selection, direction)
  }

  const updateToken = (id: string, patch: Partial<Omit<Token, 'id'>>) =>
    rewrite(
      (list) =>
        list.map((piece) =>
          isToken(piece) && piece.id === id ? { ...piece, ...patch } : piece,
        ),
      'update',
    )

  const insert: TokenInputActions['insert'] = (content, options) => {
    const pieces = Array.isArray(content) ? content : [content]
    const at = selection()
    const length = valueLength(latest.current)
    const start = at ? Math.min(at.anchor, at.focus) : length
    const end = at ? Math.max(at.anchor, at.focus) : length
    const pending = options?.resolve
      ? pieces.map((piece) =>
          isToken(piece) ? { ...piece, status: 'pending' as const } : piece,
        )
      : pieces
    const inserted = replaceRange(start, end, pending, 'insert')
    // The caret goes after what was inserted, as from a toolbar button beside the field.
    editor?.focus({ preventScroll: true })
    const token = inserted.find(isHeld)
    if (token && options?.resolve) {
      options.resolve.then(
        (patch) => {
          updateToken(token.id, { ...patch, status: patch?.status })
          const settled = latest.current.find(
            (piece): piece is Token => isToken(piece) && piece.id === token.id,
          )
          if (settled) announce(`${getTokenDescription(settled)}, ready`)
        },
        // A failed upload goes as if it had never come, undo history included.
        () => {
          rewrite(
            (list) => list.filter((piece) => !(isToken(piece) && piece.id === token.id)),
            'update',
          )
          announce(`Couldn’t add ${token.label}`)
        },
      )
    }
    return token?.id
  }

  useImperativeHandle(actionsRef, () => ({
    insert,
    replace: (content) => {
      const pieces = Array.isArray(content) ? content : [content]
      replaceRange(0, valueLength(latest.current), pieces, 'insert')
      editor?.focus({ preventScroll: true })
    },
    updateToken,
    removeToken: (id) => removeToken(id, 'remove'),
    undo: () => step('undo'),
    redo: () => step('redo'),
    clear: () => commit([], { anchor: 0, focus: 0 }, 'clear'),
    focus: () => editor?.focus(),
  }))

  const trigger = useMemo<TriggerEditor | null>(() => {
    if (!editor) return null
    return {
      element: editor,
      getText: () => plainText(latest.current),
      getSelection: () => {
        const at = readSelection(editor)
        return at
          ? { start: Math.min(at.anchor, at.focus), end: Math.max(at.anchor, at.focus) }
          : null
      },
      getCaretRect: (offset) => caretRect(editor, offset, valueLength(latest.current)),
      replace: (start, end, content) => latestReplace.current(start, end, content),
      subscribe: (listener) => {
        listeners.current.add(listener)
        return () => listeners.current.delete(listener)
      },
    }
  }, [editor])

  // What a Trigger menu picked, exactly as given, as one undo step.
  const replaceTrigger = (
    start: number,
    end: number,
    content: TriggerContent | readonly TriggerContent[],
  ) => {
    const pieces: TokenInputValue = (Array.isArray(content) ? content : [content]).map(
      (piece: TriggerContent) => (typeof piece === 'string' ? piece : { ...piece }),
    )
    replaceRange(start, end, pieces, 'insert')
  }
  const latestReplace = useRef(replaceTrigger)
  useLayoutEffect(() => {
    latestReplace.current = replaceTrigger
  })

  // The field is drawn from the value: only what differs is touched, so the
  // caret stays where typing left it, and a token that stays is never
  // moved (which would play its entrance again).
  useLayoutEffect(() => {
    latest.current = value
    if (!editor || composing.current) return
    const focused = editor.contains(document.activeElement)
    const kept = focused ? readSelection(editor) : null
    const changed = drawValue(editor, value, (id) => hostOf(hosts, id))
    // A token back while its copy still leaves (an undo right after a
    // Backspace) turns back from where the copy had got to.
    for (const copy of editor.parentElement?.querySelectorAll<HTMLElement>(
      ':scope > [data-leaving-token]',
    ) ?? []) {
      const chip = hosts.get(copy.dataset.leavingToken ?? '')?.firstElementChild
      if (chip instanceof HTMLElement && chip.isConnected) returnFromCopy(chip, copy)
    }
    const target = pendingSelection.current ?? (changed ? kept : null)
    pendingSelection.current = null
    if (target) {
      const clamped = clampSelection(target, valueLength(value))
      // Without focus, it waits for the field's next focus.
      if (focused) writeSelection(editor, clamped)
      lastSelection.current = clamped
    }
    notify()
    // `revision`: a change held back by a controlled value draws the value again.
  }, [editor, value, revision, hosts])

  // History starts from the first value.
  useEffect(() => {
    if (history.current.index === -1) {
      history.current = {
        entries: [{ value, selection: null, before: null, at: 0 }],
        index: 0,
      }
    }
  }, [value])

  const onSelectionChange = useEffectEvent(() => {
    if (!editor) return
    const at = readSelection(editor)
    if (at && editor.contains(document.activeElement)) lastSelection.current = at
    const start = at ? Math.min(at.anchor, at.focus) : 0
    const end = at ? Math.max(at.anchor, at.focus) : 0
    const next = at
      ? latest.current.flatMap((piece, index, list) => {
          if (!isToken(piece)) return []
          const offset = offsetOf(list, index)
          return offset >= start && offset < end ? [piece.id ?? ''] : []
        })
      : []
    setSelectedIds((last) =>
      last.length === next.length && last.every((id, i) => id === next[i]) ? last : next,
    )
    // A caret that lands inside a token, as an arrow up or down can put it, moves after it.
    const selection = window.getSelection()
    const inside = selection?.focusNode ? closestToken(selection.focusNode, editor) : null
    if (inside && at && at.anchor === at.focus) {
      const index = tokenIndex(latest.current, inside.dataset.tokenId ?? '')
      if (index !== -1) writeSelection(editor, { anchor: index + 1, focus: index + 1 })
    }
    notify()
  })

  const onBeforeInput = useEffectEvent((event: InputEvent) => {
    if (!editor || disabled || readOnly) {
      event.preventDefault()
      return
    }
    lastInput.current = event.inputType
    const at = readSelection(editor)
    selectionBeforeInput.current = at
    if (!at) return
    const start = Math.min(at.anchor, at.focus)
    const end = Math.max(at.anchor, at.focus)
    const type = event.inputType
    const current = latest.current

    if (type === 'historyUndo' || type === 'historyRedo') {
      event.preventDefault()
      step(type === 'historyUndo' ? 'undo' : 'redo')
      return
    }
    if (type.startsWith('format') || BLOCKED_INPUTS.has(type)) {
      event.preventDefault()
      return
    }
    if (type === 'insertParagraph' || type === 'insertLineBreak') {
      event.preventDefault()
      replaceRange(start, end, ['\n'], 'input')
      return
    }
    if (
      type === 'insertFromPaste' ||
      type === 'insertFromDrop' ||
      type === 'deleteByCut'
    ) {
      // Done in the paste, drop and cut handlers.
      event.preventDefault()
      return
    }
    if (type === 'deleteByDrag') {
      event.preventDefault()
      const from = dragged.current
      dragged.current = null
      if (from) commit(splice(current, from.start, from.end, []), null, 'drop')
      return
    }
    if (type === 'insertText' || type === 'insertReplacementText') {
      // The browser types into text; a selection that holds a token is replaced here.
      if (start === end || !hasToken(current, start, end)) return
      event.preventDefault()
      const text = event.data ?? event.dataTransfer?.getData('text/plain') ?? ''
      replaceRange(start, end, text ? [text] : [], 'input')
      return
    }
    if (!type.startsWith('delete') || event.isComposing || composing.current) return

    event.preventDefault()
    if (start !== end) {
      commit(splice(current, start, end, []), { anchor: start, focus: start }, 'delete')
      return
    }
    const backward = type.endsWith('Backward')
    const beside = backward ? tokenAt(current, start - 1) : tokenAt(current, start)
    if (beside && (type === 'deleteContentBackward' || type === 'deleteContentForward')) {
      const index = backward ? start - 1 : start
      if (tokenDeletion === 'select') {
        writeSelection(editor, { anchor: index, focus: index + 1 })
        return
      }
      if (tokenDeletion === 'revert') {
        const text = beside.text ?? beside.label
        commit(
          splice(current, index, index + 1, [text]),
          {
            anchor: index + text.length,
            focus: index + text.length,
          },
          'delete',
        )
        return
      }
      commit(
        splice(current, index, index + 1, []),
        { anchor: index, focus: index },
        'delete',
      )
      return
    }
    const range = event.getTargetRanges()[0]
    const target = range
      ? {
          start: offsetAt(editor, range.startContainer, range.startOffset),
          end: offsetAt(editor, range.endContainer, range.endOffset),
        }
      : null
    const [from, to] = deletionRange(current, start, backward, target)
    if (from === to) return
    commit(splice(current, from, to, []), { anchor: from, focus: from }, 'delete')
  })

  const onInput = useEffectEvent(() => {
    if (!editor || composing.current) return
    // Text an IME wrote into a read-only field, which can't be cancelled, is drawn away.
    if (readOnly || disabled) {
      setRevision((last) => last + 1)
      return
    }
    const typed = lastInput.current === 'insertText'
    commit(readValue(editor, latest.current), readSelection(editor), 'input', {
      group: typed,
      before: selectionBeforeInput.current,
    })
  })

  // A press on a token selects all of it. Tokens draw through portals, so
  // their presses reach the field's own listener, not React's.
  const pressing = useRef(false)
  const onPointerDown = useEffectEvent((event: PointerEvent) => {
    pressing.current = true
    window.addEventListener('pointerup', () => (pressing.current = false), { once: true })
    if (!editor || event.button !== 0) return
    const target = event.target instanceof Element ? event.target : null
    const host = target ? closestToken(target, editor) : null
    if (!host || target?.closest('button')) return
    event.preventDefault()
    editor.focus({ preventScroll: true })
    const index = tokenIndex(latest.current, host.dataset.tokenId ?? '')
    if (index !== -1) writeSelection(editor, { anchor: index, focus: index + 1 })
  })

  // Focus given back from elsewhere, such as a menu that inserted a token,
  // returns the caret to where it was, not to the start.
  const onFocus = useEffectEvent(() => {
    // A press places the caret itself.
    if (!editor || !lastSelection.current || pressing.current) return
    writeSelection(
      editor,
      clampSelection(lastSelection.current, valueLength(latest.current)),
    )
  })

  const onCompositionStart = useEffectEvent(() => {
    composing.current = true
  })
  const onCompositionEnd = useEffectEvent(() => {
    composing.current = false
    onInput()
  })

  const onReset = useEffectEvent(() => {
    const initial = withIds(defaultValue, ids)
    commit(initial, null, 'reset')
  })

  // `beforeinput` is the browser's own: React's `onBeforeInput` is a different event.
  useEffect(() => {
    if (!editor) return
    const before = (event: InputEvent) => onBeforeInput(event)
    const input = () => onInput()
    const start = () => onCompositionStart()
    const end = () => onCompositionEnd()
    const selection = () => onSelectionChange()
    const press = (event: PointerEvent) => onPointerDown(event)
    editor.addEventListener('pointerdown', press)
    const focus = () => onFocus()
    editor.addEventListener('focus', focus)
    editor.addEventListener('beforeinput', before)
    editor.addEventListener('input', input)
    editor.addEventListener('compositionstart', start)
    editor.addEventListener('compositionend', end)
    document.addEventListener('selectionchange', selection)
    const owner = hidden.current?.form
    const reset = () => onReset()
    owner?.addEventListener('reset', reset)
    return () => {
      editor.removeEventListener('beforeinput', before)
      editor.removeEventListener('pointerdown', press)
      editor.removeEventListener('focus', focus)
      editor.removeEventListener('input', input)
      editor.removeEventListener('compositionstart', start)
      editor.removeEventListener('compositionend', end)
      document.removeEventListener('selectionchange', selection)
      owner?.removeEventListener('reset', reset)
    }
  }, [editor])

  const writeClipboard = (
    event: ClipboardEvent<HTMLDivElement> | DragEvent<HTMLDivElement>,
  ) => {
    if (!editor) return null
    const at = readSelection(editor)
    if (!at || at.anchor === at.focus) return null
    const start = Math.min(at.anchor, at.focus)
    const end = Math.max(at.anchor, at.focus)
    const piece = slice(latest.current, start, end)
    const data = 'clipboardData' in event ? event.clipboardData : event.dataTransfer
    data.setData('text/plain', copy === 'label' ? toLabel(piece) : codec.stringify(piece))
    data.setData('text/html', toHtml(piece))
    return { start, end }
  }

  const readClipboard = (data: DataTransfer): TokenInputValue => {
    const html = data.getData('text/html')
    if (html.includes('data-token')) {
      const parsed = fromHtml(html)
      if (parsed) return parsed
    }
    const text = data.getData('text/plain').replace(/\r\n?/g, '\n')
    // Text from elsewhere goes in as it is: only text that holds a token is read
    // as the codec's, whose escapes would change a path's backslashes.
    const parsed = codec.parse(text)
    return parsed.some(isToken) ? parsed : [text]
  }

  const handlers: EditorHandlers = {
    onKeyDown: (event) => {
      if (event.defaultPrevented || isComposing(event.nativeEvent) || !editor) return
      const mod = event.metaKey || event.ctrlKey
      const key = event.key.toLowerCase()
      if (readOnly && mod && !event.altKey && key === 'a') {
        event.preventDefault()
        getSelection()?.selectAllChildren(editor)
        return
      }
      if (mod && !event.altKey && (key === 'z' || key === 'y')) {
        event.preventDefault()
        if (disabled || readOnly) return
        step(key === 'y' || event.shiftKey ? 'redo' : 'undo')
        return
      }
      if (event.key === 'Enter' && !event.shiftKey) {
        const owner = hidden.current?.form
        if (submits(event.nativeEvent, submitShortcut) && (onSubmit || owner)) {
          event.preventDefault()
          if (onSubmit) onSubmit(latest.current)
          else owner?.requestSubmit()
        }
        return
      }
      if (
        (event.key === 'ArrowLeft' || event.key === 'ArrowRight') &&
        !mod &&
        !event.altKey
      ) {
        const at = readSelection(editor)
        if (!at) return
        const rtl = getComputedStyle(editor).direction === 'rtl'
        const forward = (event.key === 'ArrowRight') !== rtl
        const next = stepCaret(
          latest.current,
          at,
          forward,
          event.shiftKey,
          fillerBeside(forward),
        )
        if (next) {
          event.preventDefault()
          writeSelection(editor, next)
        }
      }
    },
    onCopy: (event) => {
      if (writeClipboard(event)) event.preventDefault()
    },
    onCut: (event) => {
      const range = writeClipboard(event)
      if (!range) return
      event.preventDefault()
      if (disabled || readOnly) return
      commit(
        splice(latest.current, range.start, range.end, []),
        {
          anchor: range.start,
          focus: range.start,
        },
        'cut',
      )
    },
    onPaste: (event) => {
      if (!editor || disabled || readOnly) return
      const pasted = readClipboard(event.clipboardData)
      if (pasted.length === 0) return
      event.preventDefault()
      const at = readSelection(editor) ?? { anchor: 0, focus: 0 }
      replaceRange(
        Math.min(at.anchor, at.focus),
        Math.max(at.anchor, at.focus),
        pasted,
        'paste',
      )
    },
    onDragStart: (event) => {
      dragged.current = writeClipboard(event)
    },
    onDrop: (event) => {
      if (!editor || disabled || readOnly) return
      const dropped = readClipboard(event.dataTransfer)
      if (dropped.length === 0) return
      event.preventDefault()
      const point = pointAt(event.clientX, event.clientY)
      let at = point
        ? offsetAt(editor, point.node, point.offset)
        : valueLength(latest.current)
      let base = latest.current
      const from = dragged.current
      dragged.current = null
      const moving = from && !(event.altKey || event.ctrlKey)
      if (moving) {
        if (at > from.start && at < from.end) return
        base = splice(base, from.start, from.end, [])
        if (at >= from.end) at -= from.end - from.start
      }
      const fresh = withIds(freshIds(dropped, base), ids)
      editor.focus({ preventScroll: true })
      commit(
        splice(base, at, at, fresh),
        {
          anchor: at,
          focus: at + valueLength(fresh),
        },
        'drop',
      )
    },
  }

  /** Whether the character the caret would cross is a filler, which the browser would stop on. */
  function fillerBeside(forward: boolean) {
    const selection = window.getSelection()
    const node = selection?.focusNode
    if (!node || node.nodeType !== Node.TEXT_NODE) return false
    const text = (node as Text).data
    const at = selection.focusOffset
    return forward ? text.charAt(at) === FILLER : text.charAt(at - 1) === FILLER
  }

  // Tokens draw into the field's own elements, which exist only in the browser.
  const mounted = useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  )

  return (
    <TokenInputContext
      value={{
        editor,
        setEditor,
        value,
        disabled,
        readOnly,
        required,
        handlers,
        text: toText(value, codec),
        name: name ?? field?.name,
        form,
        hidden,
        editsRef,
      }}
    >
      <TriggerEditorContext value={trigger}>{children}</TriggerEditorContext>
      {mounted &&
        tokens.map((token) =>
          createPortal(
            <TokenContext
              value={{
                token,
                selected: selectedIds.includes(token.id),
                description: getTokenDescription(token),
                remove: () => removeToken(token.id, 'remove-press'),
              }}
            >
              {renderToken(token)}
            </TokenContext>,
            hostOf(hosts, token.id),
            token.id,
          ),
        )}
      {/* Mounted from the start, so a screen reader hears what changes in it. */}
      {region}
    </TokenInputContext>
  )
}

/** Whether a key press is the submit shortcut: never while an input method composes, so the Enter that picks a word stays in the text. */
function submits(
  event: Pick<
    globalThis.KeyboardEvent,
    'key' | 'shiftKey' | 'metaKey' | 'ctrlKey' | 'isComposing' | 'keyCode'
  >,
  shortcut: 'enter' | 'mod+enter',
) {
  if (event.key !== 'Enter' || event.shiftKey || isComposing(event)) return false
  const mod = event.metaKey || event.ctrlKey
  return shortcut === 'enter' ? !mod : mod
}

function subscribeNever() {
  return () => {}
}

/** Inputs a token field has no use for: lists, rules and links. */
const BLOCKED_INPUTS = new Set([
  'insertOrderedList',
  'insertUnorderedList',
  'insertHorizontalRule',
  'insertLink',
])

/**
 * The field: the text and its tokens, in the box every text control has. It
 * grows with its text, then scrolls. `className` goes on the box; every other
 * prop goes to the editable element.
 */
function TokenInputEditor({
  className,
  placeholder,
  ref,
  id: idProp,
  ...props
}: Omit<ComponentProps<'div'>, 'className' | 'children' | 'contentEditable'> & {
  className?: string
  placeholder?: string
}) {
  const {
    editor,
    setEditor,
    value,
    disabled,
    readOnly,
    required,
    handlers,
    text,
    name,
    form,
    hidden,
    editsRef,
  } = useTokenInput()
  // The editable text is what its Field's label names and focuses, and what its description and check describe.
  const { invalid, props: editorProps } = useFieldProps({ ...props, id: idProp })
  const fieldRef = editorProps.ref
  const editorRef = useMemo(
    () => mergeRefs(setEditor, markMounted, ref, fieldRef),
    [setEditor, ref, fieldRef],
  )
  // A read-only field isn't editable, so a screen reader hears it as read
  // only; its text is still selected with the pointer, or all of it with Mod+A.
  const editable = !disabled && !readOnly
  const empty = value.length === 0
  // The root marks each change the person makes; once it has rendered into
  // the textarea, the Field hears it as an edit, so it checks again and a
  // server's error for it goes.
  const edited = useRef(false)
  useLayoutEffect(() => {
    editsRef.current = () => {
      edited.current = true
    }
  })
  useEffect(() => {
    if (!edited.current) return
    edited.current = false
    hidden.current?.dispatchEvent(new Event('input', { bubbles: true }))
  })

  return (
    <div
      data-slot='token-input'
      onPointerDown={(event) => {
        // A press on the box, outside the text, puts the caret at the end.
        if (event.target !== event.currentTarget || !editor) return
        event.preventDefault()
        editor.focus()
        writeSelection(editor, {
          anchor: valueLength(value),
          focus: valueLength(value),
        })
      }}
      className={cn(
        inputBoxClassName,
        textareaRadiusClassName,
        'cursor-text items-stretch',
        disabled && 'pointer-events-none opacity-50',
        className,
      )}
    >
      <div
        {...editorProps}
        ref={editorRef}
        role='textbox'
        aria-multiline
        // A message takes the direction of what is written in it; an empty
        // one, the page's, which `auto` would turn left to right.
        dir={props.dir ?? (empty ? undefined : 'auto')}
        aria-placeholder={placeholder}
        aria-invalid={invalid || props['aria-invalid'] || undefined}
        aria-required={required || undefined}
        aria-readonly={readOnly || undefined}
        aria-disabled={disabled || undefined}
        tabIndex={disabled ? undefined : 0}
        contentEditable={editable}
        suppressContentEditableWarning
        spellCheck
        data-slot='token-input-control'
        data-empty={empty ? '' : undefined}
        onKeyDown={(event) => {
          props.onKeyDown?.(event)
          handlers.onKeyDown(event)
        }}
        onCopy={(event) => {
          props.onCopy?.(event)
          if (!event.defaultPrevented) handlers.onCopy(event)
        }}
        onCut={(event) => {
          props.onCut?.(event)
          if (!event.defaultPrevented) handlers.onCut(event)
        }}
        onPaste={(event) => {
          props.onPaste?.(event)
          if (!event.defaultPrevented) handlers.onPaste(event)
        }}
        onDragStart={(event) => {
          props.onDragStart?.(event)
          handlers.onDragStart(event)
        }}
        onDrop={(event) => {
          props.onDrop?.(event)
          if (!event.defaultPrevented) handlers.onDrop(event)
        }}
        className={cn(
          // A line fits a token with room around it, at every density.
          textareaSizeClassName,
          'relative min-w-0 overflow-y-auto py-1.5 scrollbar-thin leading-[calc(var(--control-height-xs)+0.25rem)] break-words whitespace-pre-wrap',
          'aria-readonly:text-muted-foreground',
        )}
      />
      {/* Beside the text, not in it, where a screen reader would read it as
          the value; `aria-placeholder` says it. */}
      {empty && placeholder ? (
        <span
          aria-hidden
          data-slot='token-input-placeholder'
          className='text-muted-foreground pointer-events-none absolute inset-x-0 top-0 truncate px-(--control-padding) py-1.5 text-base leading-[calc(var(--control-height-xs)+0.25rem)] group-has-aria-invalid/input:pe-9 md:text-sm'
        >
          {placeholder}
        </span>
      ) : null}
      <InputInvalidIcon className='absolute end-0 top-2.5' />
      {/* For a form: the value in the codec's text, and the browser's own check
          of `required`. A textarea, since an input drops line breaks. */}
      <textarea
        ref={hidden}
        data-field-check=''
        aria-hidden
        tabIndex={-1}
        // The form's own check focuses it when the field fails; the text takes it.
        onFocus={() => editor?.focus()}
        className='sr-only'
        name={name}
        form={form}
        required={required}
        disabled={disabled}
        readOnly={readOnly}
        value={text}
        onChange={() => {}}
      />
    </div>
  )
}

const tokenSpinnerSwap = cn(
  swapIconClassName,
  '-me-1 [--button-height:var(--control-height-xs)]',
)

/**
 * A token's chip, the Tag input's own: what it holds as children (its label
 * by default). It shows a spinner while it loads, a dashed edge when it is
 * unresolved, and the focus ring while it is selected.
 */
function TokenInputToken({
  className,
  children,
  ref,
  ...props
}: Omit<ComponentProps<'span'>, 'className'> & { className?: string }) {
  const { token, selected, description } = useToken()
  const { id } = token
  const said = description.startsWith(token.label)
    ? description.slice(token.label.length)
    : null
  const chip = useRef<HTMLSpanElement>(null)
  const chipRef = useMemo(() => mergeRefs(chip, ref), [ref])
  // Its cleanup runs while the chip is still on screen, before React takes
  // it out, so a copy can leave from where it was.
  useLayoutEffect(() => {
    const element = chip.current
    return () => {
      if (element) leaveChip(element, id)
    }
  }, [id])
  const pending = token.status === 'pending'
  const spinning = useSpinner(pending)
  return (
    <CutTooltip
      // Its label, or the spans that hold it, such as beside a picture.
      labels='[data-slot=token-input-token-label], [data-slot=token-input-token-label] > span'
      text={token.label}
      render={
        <span
          data-slot='token-input-token'
          data-token-type={token.type}
          // Tailwind's `data-selected:` (from shadcn's CSS) matches "true" only.
          data-selected={selected || undefined}
          data-pending={pending ? '' : undefined}
          data-unresolved={token.status === 'unresolved' ? '' : undefined}
          ref={chipRef}
          className={cn(
            chipClassName,
            chipLeavingClassName,
            'px-2 whitespace-nowrap has-[[data-slot=token-input-token-remove]]:pe-0',
            // It scales in on `enter` once the field has painted, as a tag does.
            '[transition:opacity_var(--motion-enter-duration)_var(--motion-enter-easing),scale_var(--motion-enter-duration)_var(--motion-enter-easing),color_var(--motion-press-duration)_var(--motion-press-fade-easing),box-shadow_var(--motion-press-duration)_var(--motion-press-fade-easing)] in-data-mounted:starting:opacity-0 motion-safe:in-data-mounted:starting:scale-75 motion-reduce:[transition:opacity_var(--motion-enter-duration)_var(--motion-enter-easing)]',
            'data-selected:ring-3 data-selected:ring-ring/50 forced-colors:data-selected:outline-2 forced-colors:data-selected:outline-[Highlight]',
            // Selected wins over the dashed edge, where forced colours drop the ring.
            'forced-colors:[&[data-selected][data-unresolved]]:outline-2 forced-colors:[&[data-selected][data-unresolved]]:outline-solid forced-colors:[&[data-selected][data-unresolved]]:outline-[Highlight]',
            'data-unresolved:outline-muted-foreground data-unresolved:bg-transparent data-unresolved:outline-1 data-unresolved:-outline-offset-1 data-unresolved:outline-dashed',
            className,
          )}
          {...props}
        >
          {/* The spinner rolls in and widens the chip, as on a Button; its box's
              margin takes back the chip's gap while it is empty. */}
          <Swap align='start' roll className={tokenSpinnerSwap}>
            {spinning ? (
              <span className='flex pe-1'>
                <Spinner aria-hidden className='size-3' />
              </span>
            ) : null}
          </Swap>
          {/* The field's value, which a screen reader reads from its text, holds
              the label once: what the description adds to it ("Maya Chen,
              mentioned") is in hidden text beside it. A description that doesn't
              start with the label takes the label's place. */}
          <span
            aria-hidden={said === null || undefined}
            data-slot='token-input-token-label'
            className='flex min-w-0 items-center gap-1 [&>span]:min-w-0 [&>span]:truncate [&>span]:[unicode-bidi:plaintext]'
          >
            {children ?? token.label}
          </span>
          <span className='sr-only'>{said ?? description}</span>
        </span>
      }
    />
  )
}

/**
 * Removes its token. Hidden from screen readers and out of the tab order:
 * Backspace removes a token from the keyboard.
 */
function TokenInputTokenRemove({
  className,
  onClick,
  ...props
}: Omit<ComponentProps<'button'>, 'className'> & { className?: string }) {
  const { remove } = useToken()
  const { disabled, readOnly } = useTokenInput()
  if (disabled || readOnly) return null
  return (
    <button
      type='button'
      data-slot='token-input-token-remove'
      aria-hidden
      tabIndex={-1}
      onPointerDown={(event) => event.preventDefault()}
      onClick={(event) => {
        onClick?.(event)
        if (!event.defaultPrevented) remove()
      }}
      className={cn(chipRemoveClassName, className)}
      {...props}
    >
      <ChipRemoveIcon />
    </button>
  )
}

/* ------------------------------------------------------------------------ */
/* The value                                                                 */
/* ------------------------------------------------------------------------ */

function isToken(piece: string | Token): piece is Token {
  return typeof piece !== 'string'
}

/** A token the field holds: every one has an id once it is in. */
function isHeld(piece: string | Token): piece is Token & { id: string } {
  return typeof piece !== 'string' && typeof piece.id === 'string'
}

/** A screen reader's words for a token: its label and kind. */
function describeToken(token: Token) {
  return token.status === 'pending'
    ? `${token.label}, ${token.type}, loading`
    : token.status === 'unresolved'
      ? `${token.label}, ${token.type}, choose which one`
      : `${token.label}, ${token.type}`
}

let nextId = 0

/** The value with every token given an id, the same one each time for the same token. */
function withIds(value: TokenInputValue, ids: WeakMap<Token, string>): TokenInputValue {
  return normalize(
    value.map((piece) => {
      if (!isToken(piece) || piece.id) return piece
      let id = ids.get(piece)
      if (!id) {
        nextId += 1
        id = `token-${nextId}`
        ids.set(piece, id)
      }
      return { ...piece, id }
    }),
  )
}

/** Content to add beside `held`, without the ids `held` (or the content itself) already uses. */
function freshIds(content: TokenInputValue, held: TokenInputValue): TokenInputValue {
  const taken = new Set(held.filter(isHeld).map((token) => token.id))
  return content.map((piece) => {
    if (!isToken(piece) || !piece.id) return piece
    if (taken.has(piece.id)) return { ...piece, id: undefined }
    taken.add(piece.id)
    return piece
  })
}

/** Joins text that sits together and drops empty text. */
function normalize(value: TokenInputValue): TokenInputValue {
  const out: TokenInputValue = []
  for (const piece of value) {
    if (piece === '') continue
    const last = out.at(-1)
    if (typeof piece === 'string' && typeof last === 'string')
      out[out.length - 1] = last + piece
    else out.push(piece)
  }
  return out
}

/** The text, with each token as one U+FFFC. */
function plainText(value: TokenInputValue) {
  return value.map((piece) => (isToken(piece) ? TOKEN_CHAR : piece)).join('')
}

function valueLength(value: TokenInputValue) {
  return value.reduce((sum, piece) => sum + (isToken(piece) ? 1 : piece.length), 0)
}

/** Where the piece at `index` starts. */
function offsetOf(value: TokenInputValue, index: number) {
  return valueLength(value.slice(0, index))
}

/** The token at `offset`, if one is there. */
function tokenAt(value: TokenInputValue, offset: number): Token | undefined {
  let at = 0
  for (const piece of value) {
    const length = isToken(piece) ? 1 : piece.length
    if (offset < at + length) return isToken(piece) && offset === at ? piece : undefined
    at += length
  }
  return undefined
}

/** Where the token with `id` is, or -1. */
function tokenIndex(value: TokenInputValue, id: string) {
  let at = 0
  for (const piece of value) {
    if (isToken(piece) && piece.id === id) return at
    at += isToken(piece) ? 1 : piece.length
  }
  return -1
}

function hasToken(value: TokenInputValue, start: number, end: number) {
  return slice(value, start, end).some(isToken)
}

/** The pieces in `[start, end)`. */
function slice(value: TokenInputValue, start: number, end: number): TokenInputValue {
  const out: TokenInputValue = []
  let at = 0
  for (const piece of value) {
    const length = isToken(piece) ? 1 : piece.length
    const from = Math.max(start, at)
    const to = Math.min(end, at + length)
    if (from < to) out.push(isToken(piece) ? piece : piece.slice(from - at, to - at))
    at += length
  }
  return normalize(out)
}

/** `[start, end)` swapped for `content`. */
function splice(
  value: TokenInputValue,
  start: number,
  end: number,
  content: TokenInputValue,
): TokenInputValue {
  const length = valueLength(value)
  return normalize([...slice(value, 0, start), ...content, ...slice(value, end, length)])
}

function sameToken(a: Token, b: Token) {
  return (
    a.id === b.id &&
    a.type === b.type &&
    a.value === b.value &&
    a.label === b.label &&
    a.status === b.status &&
    a.text === b.text &&
    a.data === b.data
  )
}

function sameValue(a: TokenInputValue, b: TokenInputValue) {
  if (a.length !== b.length) return false
  return a.every((piece, index) => {
    const other = b[index]
    if (typeof piece === 'string' || typeof other === 'string') return piece === other
    return sameToken(piece, other)
  })
}

/** The tokens a change added and removed, by id. */
function tokenChanges(before: TokenInputValue, after: TokenInputValue) {
  const was = before.filter(isToken)
  const now = after.filter(isToken)
  return {
    added: now.filter((token) => !was.some((old) => old.id === token.id)),
    removed: was.filter((token) => !now.some((next) => next.id === token.id)),
  }
}

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

/** Where one character before or after `offset` is: a token, or a whole grapheme. */
function stepOffset(value: TokenInputValue, offset: number, forward: boolean) {
  const length = valueLength(value)
  if (forward ? offset >= length : offset <= 0) return offset
  if (tokenAt(value, forward ? offset : offset - 1)) return offset + (forward ? 1 : -1)
  const text = plainText(value)
  if (forward) {
    const segments = graphemes.segment(text.slice(offset, offset + 16))
    const segment = segments[Symbol.iterator]().next()
    return offset + (segment.done ? 1 : segment.value.segment.length)
  }
  const from = Math.max(0, offset - 16)
  let last = offset - 1
  for (const { index } of graphemes.segment(text.slice(from, offset))) last = from + index
  return last
}

/**
 * Where an arrow key takes the selection when it crosses a token, or the
 * filler beside one, which the browser would stop on; null to leave it to
 * the browser. A collapsed caret moves one piece; Shift moves its focus.
 */
function stepCaret(
  value: TokenInputValue,
  at: Selection,
  forward: boolean,
  extend: boolean,
  besideFiller: boolean,
): Selection | null {
  const collapsed = at.anchor === at.focus
  if (!extend && !collapsed) return null
  const crossing = forward ? tokenAt(value, at.focus) : tokenAt(value, at.focus - 1)
  if (!crossing && !besideFiller) return null
  const focus = stepOffset(value, at.focus, forward)
  if (focus === at.focus) return null
  return extend ? { anchor: at.anchor, focus } : { anchor: focus, focus }
}

/**
 * What a delete with a collapsed caret removes: the browser's range when it
 * gave one, otherwise one character. A word or line deletion stops at a
 * token, and takes the token alone when the caret is right beside it.
 */
function deletionRange(
  value: TokenInputValue,
  caret: number,
  backward: boolean,
  target: { start: number; end: number } | null,
): [number, number] {
  let from =
    target && target.start !== target.end ? Math.min(target.start, target.end) : -1
  let to = target && target.start !== target.end ? Math.max(target.start, target.end) : -1
  if (from === -1) {
    const other = stepOffset(value, caret, !backward)
    from = Math.min(caret, other)
    to = Math.max(caret, other)
  }
  if (backward) {
    for (let at = to - 1; at >= from; at -= 1) {
      if (!tokenAt(value, at)) continue
      return at === to - 1 ? [at, to] : [at + 1, to]
    }
  } else {
    for (let at = from; at < to; at += 1) {
      if (!tokenAt(value, at)) continue
      return at === from ? [from, at + 1] : [from, at]
    }
  }
  return [from, to]
}

function clampSelection(at: Selection, length: number): Selection {
  return {
    anchor: Math.min(Math.max(0, at.anchor), length),
    focus: Math.min(Math.max(0, at.focus), length),
  }
}

/* ------------------------------------------------------------------------ */
/* Undo                                                                      */
/* ------------------------------------------------------------------------ */

interface HistoryEntry {
  value: TokenInputValue
  /** The selection after the change. */
  selection: Selection | null
  /** The selection before it, where an undo puts the caret back. */
  before: Selection | null
  /** Typing joins the step before it while it goes on. */
  group?: 'type'
  /** When it happened, from `performance.now()`. */
  at: number
}

interface History {
  entries: HistoryEntry[]
  index: number
}

const HISTORY_LIMIT = 100
/** How long a pause in typing has to be to start a new undo step, in ms. */
const HISTORY_GROUP_MS = 1000

/** The history with `entry` after the current step: typing that goes on joins it. */
function record(history: History, entry: HistoryEntry): History {
  const kept = history.entries.slice(0, history.index + 1)
  const last = kept.at(-1)
  if (
    last &&
    history.index > 0 &&
    entry.group === 'type' &&
    last.group === 'type' &&
    entry.at - last.at < HISTORY_GROUP_MS
  ) {
    kept[kept.length - 1] = { ...entry, before: last.before }
    return { entries: kept, index: kept.length - 1 }
  }
  const entries = [...kept, entry].slice(-HISTORY_LIMIT)
  return { entries, index: entries.length - 1 }
}

function undo(history: History) {
  if (history.index <= 0) return null
  const undone = history.entries[history.index]
  const index = history.index - 1
  return {
    history: { ...history, index },
    value: history.entries[index].value,
    selection: undone.before,
  }
}

/**
 * `change` made to every entry: a step it leaves the same as the one before
 * (a token that never came) goes, so undo never does nothing.
 */
function rewriteHistory(
  history: History,
  change: (value: TokenInputValue) => TokenInputValue,
): History {
  const entries: History['entries'] = []
  let index = history.index
  history.entries.forEach((entry, at) => {
    const value = change(entry.value)
    const last = entries.at(-1)
    if (last && sameValue(last.value, value)) {
      if (at <= history.index) index -= 1
      return
    }
    entries.push({ ...entry, value })
  })
  return { entries, index: Math.max(index, entries.length > 0 ? 0 : -1) }
}

function redo(history: History) {
  if (history.index >= history.entries.length - 1) return null
  const index = history.index + 1
  const entry = history.entries[index]
  return {
    history: { ...history, index },
    value: entry.value,
    selection: entry.selection,
  }
}

/* ------------------------------------------------------------------------ */
/* Text                                                                      */
/* ------------------------------------------------------------------------ */

/**
 * `[@Ada Okafor](mention:ada)`, with `]`, `)` and `\` escaped in a token, and
 * text that would read as one escaped: `\[@` for `[@`, and `\\` for a
 * backslash before `[`, before another or at the end.
 */
const tokenCodec: TokenCodec = {
  stringify: (value) =>
    value
      .map((piece) =>
        isToken(piece)
          ? `[@${piece.label.replace(/[\\\]]/g, '\\$&')}](${piece.type}:${piece.value.replace(/[\\)]/g, '\\$&')})`
          : piece.replace(/\\(?=[\\[]|$)|\[@/g, '\\$&'),
      )
      .join(''),
  parse: (text) => {
    const out: TokenInputValue = []
    const pattern = /\\([\\[])|\[@((?:\\.|[^\]\\])*)\]\(([\w-]+):((?:\\.|[^)\\])*)\)/g
    let last = 0
    for (const match of text.matchAll(pattern)) {
      out.push(text.slice(last, match.index))
      out.push(
        match[1] ??
          ({
            type: match[3],
            label: match[2].replace(/\\(.)/g, '$1'),
            value: match[4].replace(/\\(.)/g, '$1'),
          } satisfies Token),
      )
      last = match.index + match[0].length
    }
    out.push(text.slice(last))
    return normalize(out)
  },
}

function toText(value: TokenInputValue, codec: TokenCodec = tokenCodec) {
  return codec.stringify(value)
}

function fromText(text: string, codec: TokenCodec = tokenCodec) {
  return codec.parse(text)
}

/** The text as people read it: each token as its label. */
function toLabel(value: TokenInputValue) {
  return value.map((piece) => (isToken(piece) ? piece.label : piece)).join('')
}

function escapeHtml(text: string) {
  return text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`)
}

/** HTML for the clipboard: each token a span that carries it whole, for a paste back. */
function toHtml(value: TokenInputValue) {
  const body = value
    .map((piece) => {
      if (!isToken(piece)) return escapeHtml(piece).replace(/\n/g, '<br>')
      // A pending token waits on the field it was inserted in, so its copy is settled.
      const kept = {
        type: piece.type,
        value: piece.value,
        label: piece.label,
        ...(piece.text === undefined ? {} : { text: piece.text }),
        ...(piece.status === 'unresolved' ? { status: piece.status } : {}),
      }
      return `<span data-token="${escapeHtml(JSON.stringify(kept))}">${escapeHtml(piece.label)}</span>`
    })
    .join('')
  return `<span data-token-input style="white-space:pre-wrap">${body}</span>`
}

/** Text and tokens from HTML a token field copied, or null when it isn't a token field's. */
function fromHtml(html: string): TokenInputValue | null {
  const document = new DOMParser().parseFromString(html, 'text/html')
  const out: TokenInputValue = []
  // The field's own copy holds its text exactly, with tokens or without.
  let found = document.querySelector('[data-token-input]') !== null
  const walk = (node: Node) => {
    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        out.push((child as Text).data)
      } else if (child instanceof Element) {
        const data = child.getAttribute('data-token')
        if (data) {
          const token = parseToken(data)
          if (token) {
            found = true
            out.push(token)
            continue
          }
        }
        if (child.tagName === 'BR') out.push('\n')
        else walk(child)
      }
    }
  }
  walk(document.body)
  return found ? normalize(out) : null
}

function parseToken(json: string): Token | null {
  try {
    const parsed: unknown = JSON.parse(json)
    if (typeof parsed !== 'object' || parsed === null) return null
    const { type, value, label, status, text } = parsed as Record<string, unknown>
    if (
      typeof type !== 'string' ||
      typeof value !== 'string' ||
      typeof label !== 'string'
    )
      return null
    return {
      type,
      value,
      label,
      ...(status === 'unresolved' ? { status } : {}),
      ...(typeof text === 'string' ? { text } : {}),
    }
  } catch {
    return null
  }
}

/* ------------------------------------------------------------------------ */
/* The field's DOM                                                           */
/* ------------------------------------------------------------------------ */

type Drawn = { kind: 'text'; text: string } | { kind: 'token'; id: string }

/**
 * What the field holds for a value: its text, and each token with text on
 * both sides, a filler where there would be none, so the caret can always
 * sit beside it.
 */
function layout(value: TokenInputValue): Drawn[] {
  const out: Drawn[] = []
  value.forEach((piece, index) => {
    const before = value[index - 1]
    const after = value[index + 1]
    if (isToken(piece)) {
      if (index === 0) out.push({ kind: 'text', text: FILLER })
      out.push({ kind: 'token', id: piece.id ?? '' })
      if (after === undefined || isToken(after)) out.push({ kind: 'text', text: FILLER })
      return
    }
    const lead = before && isToken(before) && piece.startsWith('\n') ? FILLER : ''
    const trail = after && isToken(after) && piece.endsWith('\n') ? FILLER : ''
    out.push({ kind: 'text', text: lead + piece + trail })
  })
  return out
}

/** `text` without its fillers. */
function visible(text: string) {
  return text.replaceAll(FILLER, '')
}

/**
 * A copy of a chip that goes leaves where it was, in the field's box, once
 * the field has painted: on undo, a cut or a failed upload as on Backspace.
 */
function leaveChip(chip: HTMLElement, id: string) {
  const editor = chip.closest('[data-slot=token-input-token-host]')?.parentElement
  const box = editor?.parentElement
  if (!editor?.hasAttribute('data-mounted') || !box) return
  const seen = chip.getBoundingClientRect()
  const frame = box.getBoundingClientRect()
  // Only what showed of it leaves: the field clips a chip scrolled partly out.
  const clip = clipInside(seen, editor.getBoundingClientRect())
  if (clip === null) return
  const from = fromWhereItIs(chip)
  // Seen now, while it is laid out; left only once React has taken it out,
  // since an effect's cleanup also runs for a chip that stays (Strict Mode).
  queueMicrotask(() => {
    if (chip.isConnected || !box.isConnected) return
    const copy = leaveAsCopy(chip, {
      parent: box,
      style: {
        left: `${seen.left - frame.left - box.clientLeft}px`,
        top: `${seen.top - frame.top - box.clientTop}px`,
        width: `${seen.width}px`,
        height: `${seen.height}px`,
        clipPath: clip,
      },
      from,
    })
    copy.dataset.leavingToken = id
  })
}

/**
 * The `clip-path` that shows only the part of `seen` inside `view`, or
 * null when none of it is: `inset()` in CSS pixels from each edge.
 */
function clipInside(
  seen: Pick<DOMRect, 'top' | 'right' | 'bottom' | 'left'>,
  view: Pick<DOMRect, 'top' | 'right' | 'bottom' | 'left'>,
) {
  const top = Math.max(0, view.top - seen.top)
  const right = Math.max(0, seen.right - view.right)
  const bottom = Math.max(0, seen.bottom - view.bottom)
  const left = Math.max(0, view.left - seen.left)
  const height = seen.bottom - seen.top
  const width = seen.right - seen.left
  if (top + bottom >= height || left + right >= width) return null
  return top + right + bottom + left === 0
    ? ''
    : `inset(${top}px ${right}px ${bottom}px ${left}px)`
}

/** A token's element, made once and kept, so its chip stays mounted while the field changes. */
function hostOf(hosts: Map<string, HTMLElement>, id: string) {
  let host = hosts.get(id)
  if (!host) {
    host = document.createElement('span')
    host.contentEditable = 'false'
    host.dataset.tokenId = id
    host.dataset.slot = 'token-input-token-host'
    // `align-middle` sits a chip a little low beside the text; a tenth of the
    // font size centres it on the line, at every text size.
    host.className = 'mx-px inline-block max-w-full -translate-y-[0.1em] align-middle'
    hosts.set(id, host)
  }
  return host
}

/**
 * Makes the field hold `value`, touching only what differs. Text the browser
 * typed is left as it is when it reads the same. Returns whether anything
 * changed.
 */
function drawValue(
  editor: HTMLElement,
  value: TokenInputValue,
  host: (id: string) => HTMLElement,
) {
  const drawn = layout(value)
  const wanted = new Set(
    drawn.flatMap((piece) => (piece.kind === 'token' ? [piece.id] : [])),
  )
  let changed = false
  // What isn't ours, and tokens that went, go first, so the tokens that stay are never moved.
  for (const child of [...editor.childNodes]) {
    const token = child instanceof HTMLElement ? child.dataset.tokenId : undefined
    const ours =
      child.nodeType === Node.TEXT_NODE ||
      (token !== undefined && wanted.has(token)) ||
      (child instanceof HTMLBRElement && child.dataset.end !== undefined)
    if (!ours) {
      child.remove()
      changed = true
    }
  }
  let cursor = editor.firstChild
  for (const piece of drawn) {
    if (piece.kind === 'token') {
      const element = host(piece.id)
      if (cursor === element) {
        cursor = cursor.nextSibling
        continue
      }
      // Text left over from before (such as text that joined when a token
      // between went) goes, rather than the token moving, which would play
      // its entrance again.
      if (element.parentNode === editor) {
        const stale: ChildNode[] = []
        let node = cursor
        while (node && node !== element && node.nodeType === Node.TEXT_NODE) {
          stale.push(node)
          node = node.nextSibling
        }
        if (node === element) {
          for (const text of stale) text.remove()
          changed = true
          cursor = element.nextSibling
          continue
        }
      }
      editor.insertBefore(element, cursor)
      changed = true
      continue
    }
    if (cursor?.nodeType === Node.TEXT_NODE) {
      const text = cursor as Text
      const same =
        visible(text.data) === visible(piece.text) &&
        (!piece.text.includes(FILLER) || text.data.includes(FILLER))
      if (!same) {
        text.data = piece.text
        changed = true
      }
      cursor = cursor.nextSibling
      continue
    }
    editor.insertBefore(document.createTextNode(piece.text), cursor)
    changed = true
  }
  // Text left after the last piece goes; the closing line break stays last.
  while (cursor) {
    const next = cursor.nextSibling
    if (!(cursor instanceof HTMLBRElement && cursor.dataset.end !== undefined)) {
      cursor.remove()
      changed = true
    }
    cursor = next
  }
  const last = editor.lastChild
  if (!(last instanceof HTMLBRElement && last.dataset.end !== undefined)) {
    const end = document.createElement('br')
    end.dataset.end = ''
    editor.append(end)
    changed = true
  }
  return changed
}

type Piece =
  | { kind: 'text'; node: Text }
  | { kind: 'token'; node: HTMLElement; id: string }
  | { kind: 'break'; node: Element }

/** The field's pieces in order: text, tokens and line breaks the browser added. */
function pieces(root: Node): Piece[] {
  const out: Piece[] = []
  for (const child of root.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) out.push({ kind: 'text', node: child as Text })
    else if (child instanceof HTMLElement && child.dataset.tokenId !== undefined)
      out.push({ kind: 'token', node: child, id: child.dataset.tokenId })
    else if (child instanceof HTMLBRElement) {
      if (child.dataset.end === undefined) out.push({ kind: 'break', node: child })
    } else if (child instanceof Element) {
      if (/^(DIV|P)$/.test(child.tagName) && out.length > 0)
        out.push({ kind: 'break', node: child })
      out.push(...pieces(child))
    }
  }
  return out
}

function pieceLength(piece: Piece) {
  return piece.kind === 'text' ? visible(piece.node.data).length : 1
}

/** The value the field shows now, after the browser typed into it. */
function readValue(editor: HTMLElement, known: TokenInputValue): TokenInputValue {
  const byId = new Map(known.filter(isToken).map((token) => [token.id, token]))
  const out: TokenInputValue = []
  for (const piece of pieces(editor)) {
    if (piece.kind === 'text') out.push(visible(piece.node.data))
    else if (piece.kind === 'break') out.push('\n')
    else {
      const token = byId.get(piece.id)
      if (token) out.push(token)
    }
  }
  return normalize(out)
}

/** The offset of a DOM position in the plain text. */
function offsetAt(editor: HTMLElement, node: Node, offset: number) {
  if (!editor.contains(node)) return 0
  const point = document.createRange()
  point.setStart(node, offset)
  let count = 0
  for (const piece of pieces(editor)) {
    if (piece.kind === 'text' && piece.node === node)
      return count + visible(piece.node.data.slice(0, offset)).length
    if (piece.kind === 'token' && piece.node.contains(node) && piece.node !== node)
      return count
    if (point.comparePoint(piece.node, 0) > 0) return count
    count += pieceLength(piece)
  }
  return count
}

/** The DOM position for an offset in the plain text: in text, after any filler. */
function pointFor(editor: HTMLElement, offset: number): { node: Node; offset: number } {
  let count = 0
  for (const piece of pieces(editor)) {
    const length = pieceLength(piece)
    if (piece.kind === 'text' && offset <= count + length) {
      const data = piece.node.data
      let left = offset - count
      let index = 0
      while (index < data.length && (left > 0 || data[index] === FILLER)) {
        if (data[index] !== FILLER) left -= 1
        index += 1
      }
      return { node: piece.node, offset: index }
    }
    if (piece.kind !== 'text' && offset === count) {
      const parent = piece.node.parentNode ?? editor
      return {
        node: parent,
        offset: [...parent.childNodes].indexOf(piece.node as ChildNode),
      }
    }
    count += length
  }
  const end = [...editor.childNodes].findIndex(
    (child) => child instanceof HTMLBRElement && child.dataset.end !== undefined,
  )
  return { node: editor, offset: end === -1 ? editor.childNodes.length : end }
}

function readSelection(editor: HTMLElement): Selection | null {
  const selection = window.getSelection()
  if (!selection?.anchorNode || !selection.focusNode) return null
  if (!editor.contains(selection.anchorNode) || !editor.contains(selection.focusNode))
    return null
  return {
    anchor: offsetAt(editor, selection.anchorNode, selection.anchorOffset),
    focus: offsetAt(editor, selection.focusNode, selection.focusOffset),
  }
}

function writeSelection(editor: HTMLElement, at: Selection) {
  const selection = window.getSelection()
  if (!selection) return
  const anchor = pointFor(editor, at.anchor)
  const focus = pointFor(editor, at.focus)
  selection.setBaseAndExtent(anchor.node, anchor.offset, focus.node, focus.offset)
}

/** The token element `node` is in, if any. */
function closestToken(node: Node, editor: HTMLElement) {
  const element = node instanceof Element ? node : node.parentElement
  const host = element?.closest<HTMLElement>('[data-token-id]')
  return host && editor.contains(host) ? host : null
}

/** The box of the character at `offset`, for a menu to open beside. */
function caretRect(editor: HTMLElement, offset: number, length: number): DOMRect | null {
  const start = pointFor(editor, offset)
  const range = document.createRange()
  range.setStart(start.node, start.offset)
  if (offset < length) {
    const end = pointFor(editor, offset + 1)
    range.setEnd(end.node, end.offset)
  }
  const rects = range.getClientRects()
  if (rects.length > 0) return rects[0]
  const rect = range.getBoundingClientRect()
  return rect.height > 0 ? rect : null
}

/** The DOM position under a point, for a drop. */
function pointAt(x: number, y: number): { node: Node; offset: number } | null {
  if ('caretPositionFromPoint' in document) {
    const position = document.caretPositionFromPoint(x, y)
    return position ? { node: position.offsetNode, offset: position.offset } : null
  }
  const range = (document as Document).caretRangeFromPoint?.(x, y)
  return range ? { node: range.startContainer, offset: range.startOffset } : null
}

export { TokenInput, TokenInputEditor, TokenInputToken, TokenInputTokenRemove, useToken }
export {
  clipInside,
  deletionRange,
  freshIds,
  fromText,
  layout,
  normalize,
  plainText,
  record,
  redo,
  rewriteHistory,
  slice,
  splice,
  stepCaret,
  stepOffset,
  submits,
  tokenCodec,
  toLabel,
  toText,
  undo,
}
export type {
  Token,
  TokenCodec,
  TokenInputActions,
  TokenInputChangeDetails,
  TokenInputChangeReason,
  TokenInputProps,
  TokenInputValue,
}
