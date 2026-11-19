'use client'

import { createContext } from 'react'

/*
 * What the Trigger menu needs from the field it suggests into: its text and
 * caret, where a character sits on screen, and a way to swap a run of text
 * for what was picked. A textarea or an input gets it from `textFieldEditor`;
 * an editor of its own, such as the Token input, implements it and provides
 * it through `TriggerEditorContext`.
 */

/** A token to insert, in an editor that holds tokens. */
interface TriggerTokenContent {
  /** The token's kind, such as `mention` or `tag`. */
  type: string
  value: string
  label: string
  /** The text it turns back into when it is reverted, such as `@Ada Lovelace`. */
  text?: string
}

/** Text, or a token, to put in the field. */
type TriggerContent = string | TriggerTokenContent

interface TriggerEditor {
  /** The element that has focus while someone types: it takes the keys and the ARIA. */
  element: HTMLElement
  /** The plain text, where each token is one U+FFFC, so a query never crosses one. */
  getText(): string
  /** The selection as offsets into `getText()`, or null when there is none. */
  getSelection(): { start: number; end: number } | null
  /** The box of the character at `offset`, in viewport px, or null when it can't be measured. */
  getCaretRect(offset: number): DOMRect | null
  /**
   * Swaps `[start, end)` for `content`, exactly as given and in order, as one
   * undo step, and puts the caret after it. The menu adds the space after a
   * pick itself.
   */
  replace(
    start: number,
    end: number,
    content: TriggerContent | readonly TriggerContent[],
  ): void
  /** Calls `listener` whenever the text or the selection changes; returns the unsubscribe. */
  subscribe(listener: () => void): () => void
}

/** The editor around a Trigger menu that has no field of its own, such as a Token input. */
const TriggerEditorContext = createContext<TriggerEditor | null>(null)

/** The styles that decide where text wraps, copied onto the mirror. */
const MIRRORED = [
  'boxSizing',
  'width',
  'height',
  'borderTopWidth',
  'borderRightWidth',
  'borderBottomWidth',
  'borderLeftWidth',
  'borderStyle',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'fontFamily',
  'fontSize',
  'fontStyle',
  'fontVariant',
  'fontWeight',
  'fontStretch',
  'fontFeatureSettings',
  'fontKerning',
  'lineHeight',
  'letterSpacing',
  'wordSpacing',
  'textIndent',
  'textTransform',
  'tabSize',
  'direction',
  'scrollbarWidth',
] as const

/*
 * A field can't say where a character is, so a hidden copy of it, laid over
 * it with the same box and font, holds its text with the character in a
 * span of its own, and the span is measured.
 */
function measureCharacter(
  field: HTMLTextAreaElement | HTMLInputElement,
  offset: number,
): DOMRect {
  const style = getComputedStyle(field)
  const box = field.getBoundingClientRect()
  const mirror = document.createElement('div')
  for (const property of MIRRORED) mirror.style[property] = style[property]
  const multiline = field instanceof HTMLTextAreaElement
  Object.assign(mirror.style, {
    position: 'fixed',
    left: `${box.left}px`,
    top: `${box.top}px`,
    visibility: 'hidden',
    overflowX: 'hidden',
    // A field that scrolls has a scrollbar, which takes from the width its text wraps in.
    overflowY: field.scrollHeight > field.clientHeight ? 'scroll' : 'hidden',
    pointerEvents: 'none',
    whiteSpace: multiline ? 'pre-wrap' : 'pre',
    overflowWrap: multiline ? 'break-word' : 'normal',
  })
  const text = field.value
  mirror.textContent = text.slice(0, offset)
  const character = document.createElement('span')
  // An empty span has no box: past the end, measure a stand-in.
  const next = text.slice(offset, offset + 1)
  const stand = next === '\n' || next === ''
  character.textContent = stand ? '\u200b' : next
  // The rest of the text too: a word that wraps takes its first character with it.
  mirror.append(character, text.slice(stand ? offset : offset + 1))
  document.body.append(mirror)
  mirror.scrollTop = field.scrollTop
  mirror.scrollLeft = field.scrollLeft
  const rect = character.getBoundingClientRect()
  mirror.remove()
  return rect
}

/**
 * A textarea or an input as a `TriggerEditor`. An insert goes through the
 * browser's own editing, so ⌘Z takes it back in one step; where that isn't
 * there, the text is set directly.
 */
function textFieldEditor(field: HTMLTextAreaElement | HTMLInputElement): TriggerEditor {
  // A popup asks on every frame it resizes: the copy is laid out again only
  // when the text, the offset, the field's size or its scroll has changed,
  // and a field that only moved moves the rect with it.
  let last: { key: string; left: number; top: number; rect: DOMRect } | null = null
  const caretRect = (offset: number) => {
    const box = field.getBoundingClientRect()
    const key = [
      offset,
      field.value,
      box.width,
      box.height,
      field.scrollTop,
      field.scrollLeft,
    ].join('|')
    if (last?.key !== key) {
      last = { key, left: box.left, top: box.top, rect: measureCharacter(field, offset) }
    }
    const { rect } = last
    return new DOMRect(
      rect.x + box.left - last.left,
      rect.y + box.top - last.top,
      rect.width,
      rect.height,
    )
  }
  return {
    element: field,
    getText: () => field.value,
    getSelection: () =>
      field.selectionStart === null || field.selectionEnd === null
        ? null
        : { start: field.selectionStart, end: field.selectionEnd },
    getCaretRect: caretRect,
    replace(start, end, content) {
      const text = (Array.isArray(content) ? content : [content])
        .map((piece: TriggerContent) =>
          typeof piece === 'string' ? piece : (piece.text ?? piece.label),
        )
        .join('')
      if (document.activeElement !== field) field.focus()
      field.setSelectionRange(start, end)
      // Deprecated, but the only way into the field's own undo history.
      const inserted = document.execCommand('insertText', false, text)
      if (inserted) return
      field.setRangeText(text, start, end, 'end')
      field.dispatchEvent(
        new InputEvent('input', { bubbles: true, inputType: 'insertText' }),
      )
    },
    subscribe(listener) {
      const onSelection = () => {
        if (document.activeElement === field) listener()
      }
      const events = ['input', 'select', 'focus', 'keyup', 'pointerup'] as const
      for (const event of events) field.addEventListener(event, listener)
      document.addEventListener('selectionchange', onSelection)
      return () => {
        for (const event of events) field.removeEventListener(event, listener)
        document.removeEventListener('selectionchange', onSelection)
      }
    },
  }
}

export { TriggerEditorContext, textFieldEditor }
export type { TriggerContent, TriggerEditor, TriggerTokenContent }
