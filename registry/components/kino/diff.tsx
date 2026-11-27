'use client'

import { Button } from '@/registry/components/kino/button'
import { IconPlaceholder } from '@/registry/icons/icon-placeholder'
import { announce } from '@/registry/lib/announce'
import {
  CodeLine,
  CodeScroller,
  CodeTitle,
  codeCardClassName,
  codeHeaderClassName,
  gutterWidth,
  useCodeTokens,
} from '@/registry/lib/code-lines'
import {
  type CodeDiff as CodeDiffResult,
  diffCode,
  diffText,
  type Resolution,
  type Resolved,
  wordsOf,
} from '@/registry/lib/diff-math'
import { type DiffReviewDetails, diffReview } from '@/registry/lib/diff-review'
import { flowItemClassName, useFlow } from '@/registry/lib/flow'
import { numberFormatter } from '@/registry/lib/number-format'
import { markMounted, mergeRefs } from '@/registry/lib/refs'
import { type CodeLanguage, languageName } from '@/registry/lib/syntax'
import { type PartProps, usePart, usePrimitive } from '@ui-sdk/react/primitive'
import {
  type CSSProperties,
  type ReactNode,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import { cn } from '@/lib/utils'

/*
 * A change shown as a diff, with each piece accepted or rejected where it
 * sits. Code diff shows lines in a gutter, removed above added, with the
 * words a line changed marked inside it; Text diff shows words in running
 * prose, struck out and underlined. A decided change takes its side: the
 * other one leaves and what follows closes the gap, on `layout`.
 */

type DiffProps = Omit<PartProps<'div'>, 'className' | 'children'> & {
  before: string
  after: string
  /** Whether after has all arrived. Until it has, before past what after has reached stays as it is. */
  complete?: boolean
  /** What was decided about each change, by id. */
  resolved?: Resolved
  defaultResolved?: Resolved
  /** Called when changes are accepted or rejected, with the ones decided in `details.ids`. Without it, the diff only shows the changes. */
  onResolvedChange?: (resolved: Resolved, details: DiffReviewDetails) => void
  className?: string
}

const integer = numberFormatter(undefined, { maximumFractionDigits: 0 })

function AcceptIcon() {
  return (
    <IconPlaceholder
      lucide='CheckIcon'
      tabler='IconCheck'
      hugeicons='Tick02Icon'
      phosphor='CheckIcon'
      remixicon='RiCheckLine'
      aria-hidden
    />
  )
}

function RejectIcon() {
  return (
    <IconPlaceholder
      lucide='XIcon'
      tabler='IconX'
      hugeicons='Cancel01Icon'
      phosphor='XIcon'
      remixicon='RiCloseLine'
      aria-hidden
    />
  )
}

// The group a review sits in takes focus once nothing is left to decide, with the controls' ring.
const reviewFocusClassName =
  'focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-ring/50 forced-colors:focus-visible:outline-2'

/**
 * The review both views share: the primitive, an announcement of each
 * decision, and focus that moves on to the same button of the next change
 * still open, or to the group once none follows.
 */
function useReview(
  props: Pick<
    DiffProps,
    'resolved' | 'defaultResolved' | 'onResolvedChange' | 'complete'
  >,
  ids: readonly string[],
  growing: readonly string[],
  /** What each change is called as the diff reads with `resolved`, such as "change at line 8". */
  namesOf: (resolved: Resolved) => ReadonlyMap<string, string>,
  /** The buyer's ref on the root, beside the review's own. */
  forwarded: PartProps<'div'>['ref'],
) {
  // The root as state, so the buyer's ref and the review's own merge without reading a ref in render.
  const [root, setRoot] = useState<HTMLDivElement | null>(null)
  const ownRef = useMemo(() => mergeRefs(forwarded, setRoot), [forwarded])
  const moveFocus = useRef<{ after: string; kind: Resolution } | null>(null)
  const review = usePrimitive(diffReview, {
    resolved: props.resolved,
    defaultResolved: props.defaultResolved,
    onResolvedChange: (resolved: Resolved, details: DiffReviewDetails) => {
      props.onResolvedChange?.(resolved, details)
      if (details.canceled) return
      const word = details.resolution === 'accepted' ? 'Accepted' : 'Rejected'
      announce(
        details.ids.length === 1
          ? `${word} ${namesOf(review.instance.get().resolved).get(details.ids[0]) ?? 'change'}`
          : `${word} ${integer.format(details.ids.length)} changes`,
      )
      const last = details.ids.at(-1)
      if (last !== undefined && root?.contains(document.activeElement)) {
        moveFocus.current = { after: last, kind: details.resolution }
      }
    },
    changes: ids,
    namesOf,
    growing,
    complete: props.complete ?? true,
    readOnly: !props.onResolvedChange,
  })

  // Once the decision has rendered, focus moves on, never back to a change already passed.
  useLayoutEffect(() => {
    const move = moveFocus.current
    if (move === null || !root) return
    moveFocus.current = null
    const from = ids.indexOf(move.after)
    const attribute = move.kind === 'accepted' ? 'data-diff-accept' : 'data-diff-reject'
    const target = review.api
      .open()
      .filter((id) => ids.indexOf(id) > from)
      .map((id) =>
        root.querySelector<HTMLButtonElement>(`[${attribute}="${CSS.escape(id)}"]`),
      )
      .find((button) => button && !button.disabled)
    ;(target ?? root).focus({ preventScroll: target === undefined })
  })

  return { review, rootRef: ownRef }
}

/** Accept and Reject for one change, named after where it is. */
function ChangeButtons({
  id,
  name,
  disabled,
  onDecide,
  compact = false,
}: {
  id: string
  /** Where the change is: "change at line 12". */
  name: string
  disabled: boolean
  onDecide: (resolution: Resolution, event: Event) => void
  /** Icons only, for a change inside prose. */
  compact?: boolean
}) {
  return (
    <>
      <Button
        variant='ghost'
        size={compact ? 'icon-xs' : 'xs'}
        aria-label={`Reject ${name}`}
        data-diff-reject={id}
        disabled={disabled}
        onClick={(event) => onDecide('rejected', event.nativeEvent)}
      >
        {compact ? <RejectIcon /> : 'Reject'}
      </Button>
      <Button
        variant={compact ? 'ghost' : 'secondary'}
        size={compact ? 'icon-xs' : 'xs'}
        aria-label={`Accept ${name}`}
        data-diff-accept={id}
        disabled={disabled}
        onClick={(event) => onDecide('accepted', event.nativeEvent)}
      >
        {compact ? <AcceptIcon /> : 'Accept'}
      </Button>
    </>
  )
}

/** Accept all and Reject all, with how many changes they decide; only while more than one is open. */
function AllButtons({
  open,
  disabled,
  onAll,
}: {
  open: number
  disabled: boolean
  onAll: (resolution: Resolution, event: Event) => void
}) {
  if (open < 2) return null
  const count = `${integer.format(open)} changes`
  return (
    <div className='flex shrink-0 gap-0.5 @max-sm/diff:basis-full @max-sm/diff:justify-end'>
      <Button
        variant='ghost'
        size='xs'
        aria-label={`Reject all ${count}`}
        disabled={disabled}
        onClick={(event) => onAll('rejected', event.nativeEvent)}
      >
        Reject all
      </Button>
      <Button
        variant='secondary'
        size='xs'
        aria-label={`Accept all ${count}`}
        disabled={disabled}
        onClick={(event) => onAll('accepted', event.nativeEvent)}
      >
        Accept all
      </Button>
    </div>
  )
}

/** Lines added and removed, as signs a person reads and words a screen reader hears. */
function Counts({ added, removed }: { added: number; removed: number }) {
  return (
    <span dir='ltr' className='flex shrink-0 gap-1.5 font-mono text-xs tabular-nums'>
      <span className='text-(--code-added)'>
        <span aria-hidden>+</span>
        {integer.format(added)}
        <span className='sr-only'> added,</span>
      </span>
      <span className='text-(--code-removed)'>
        <span aria-hidden>−</span>
        {integer.format(removed)}
        <span className='sr-only'> removed</span>
      </span>
    </span>
  )
}

/** A Code diff's header: the file, the lines it adds and removes, and what decides them all. */
function CodeDiffHeader({
  title,
  language,
  open,
  children,
}: {
  title?: string
  language: CodeLanguage
  /** The changes still open, whose lines it counts. */
  open: readonly CodeDiffResult['changes'][number][]
  children?: ReactNode
}) {
  const added = open.reduce((lines, change) => lines + change.added.length, 0)
  const removed = open.reduce((lines, change) => lines + change.removed.length, 0)
  return (
    // Below a phone's width the buttons take a row of their own, so the file keeps its name.
    <div
      data-slot='diff-header'
      className={cn(codeHeaderClassName, '@max-sm/diff:flex-wrap @max-sm/diff:py-1.5')}
    >
      <CodeTitle title={title} language={language} />
      {added + removed > 0 ? <Counts added={added} removed={removed} /> : null}
      {children}
    </div>
  )
}

/** How many of a Text diff's changes are still open: for its foot, in the words of the page around it. */
function ReviewStatus({
  open,
  total,
  complete,
}: {
  open: number
  total: number
  complete: boolean
}) {
  return (
    <span dir='auto' className='text-muted-foreground min-w-0 text-xs tabular-nums'>
      <bdi>
        {total === 0 && !complete
          ? 'Changes arriving'
          : open === 0
            ? 'All changes decided'
            : `${integer.format(open)} of ${integer.format(total)} ${total === 1 ? 'change' : 'changes'} to review`}
      </bdi>
    </span>
  )
}

/**
 * Each Code diff change's name, by the line it starts on in the gutter as
 * the code reads now: kept and pending lines count, and a change counts the
 * side it shows (its added lines while open). A change's name follows it,
 * so what a screen reader or an agent hears matches the number a person sees.
 */
function codeChangeNames(diff: CodeDiffResult, resolved: Resolved) {
  const names = new Map<string, string>()
  let line = 1
  for (const row of diff.rows) {
    if (row.kind !== 'change') {
      line++
      continue
    }
    names.set(row.change.id, `change at line ${integer.format(line)}`)
    line +=
      resolved[row.change.id] === 'rejected'
        ? row.change.removed.length
        : row.change.added.length
  }
  return names
}

/** Each Text diff change's name, by its place among them. */
function textChangeNames(ids: readonly string[]) {
  return new Map(
    ids.map((id, index) => [
      id,
      `change ${integer.format(index + 1)} of ${integer.format(ids.length)}`,
    ]),
  )
}

/** A frame whose height follows the changes as they come and go, and takes each chunk's at once while after arrives. */
const frameClassName =
  'overflow-clip transition-[height] duration-(--motion-layout-duration) ease-(--motion-layout-easing) motion-reduce:transition-none data-arriving:transition-none'

// A line's band and bar fade as its change is decided, held at their end once there.
const lineFadeClassName =
  'transition-[background-color] duration-(--motion-layout-duration) ease-(--motion-layout-fade-easing) before:transition-[background-color] before:duration-(--motion-layout-duration) before:ease-(--motion-layout-fade-easing)'

// Before that after hasn't reached: plain text in the muted colour, with no syntax colours, which would fall under contrast.
const pendingLineClassName = 'text-muted-foreground'

// A change in prose: what leaves is struck through, what arrives underlined, each on its own tint.
const removedWordClassName =
  'bg-[color-mix(in_oklab,var(--code-removed)_14%,transparent)] text-[color-mix(in_oklch,var(--code-removed),var(--foreground)_35%)] line-through decoration-[color-mix(in_oklab,var(--code-removed)_70%,transparent)] forced-colors:decoration-[CanvasText]'
const addedWordClassName =
  'bg-[color-mix(in_oklab,var(--code-added)_14%,transparent)] underline decoration-(--code-added) decoration-2 underline-offset-3 forced-colors:decoration-[CanvasText]'

// A word's tint and line fade as its change is decided; the item around it moves.
const wordFadeClassName =
  'transition-[background-color,text-decoration-color,color] duration-(--motion-layout-duration) ease-(--motion-layout-fade-easing)'

/**
 * A piece of prose before it is laid out as items: a stretch of words with
 * its look, or something set among them.
 */
type ProsePiece =
  | {
      kind: 'words'
      text: string
      /** Where the text starts in its side, for keys that hold as decisions change. */
      at: number
      side: 'b' | 'a'
      className?: string
      /** Spaces inside it are items, so a change's tint runs unbroken across them. */
      spaces?: boolean
      /** Shown to the eye only, when `said` reads it out whole. */
      hidden?: boolean
    }
  /**
   * Something set among the words: a change's buttons, text only a screen
   * reader hears, or the space between a change's sides, which a mark after
   * it doesn't reach past.
   */
  | { kind: 'beside' | 'said' | 'gap'; key: string; node: ReactNode }

// A word or a mark alone, which reads with the word before it.
const isMark = (token: string) => token.trim() !== '' && !/[\p{L}\p{N}]/u.test(token)

/**
 * Prose as items that flow, for `useFlow`'s `[data-diff-word]`: each word an
 * inline block, white space between kept words left as text. A mark that
 * follows a word sits in the word's item, past anything set among them, so a
 * line never starts with a full stop.
 */
function proseItems(
  pieces: readonly ProsePiece[],
  /** While after arrives: every item lands in place, since a glide every chunk would never settle. */
  held: boolean,
): ReactNode[] {
  type Token = { key: string; text: string; className?: string; hidden?: boolean }
  type Item =
    | { kind: 'word'; tokens: Token[]; beside?: { key: string; node: ReactNode } }
    | { kind: 'space'; text: string; key: string; className?: string; spaced: boolean }
    | { kind: 'node'; key: string; node: ReactNode; joins: boolean }
  const items: Item[] = []
  for (const piece of pieces) {
    // A change's buttons sit in its last word's item, past the spaces after it, so they never start a line alone.
    if (piece.kind === 'beside') {
      let back = items.length - 1
      while (
        back >= 0 &&
        (items[back].kind === 'space' ||
          (items[back].kind === 'node' && (items[back] as { joins: boolean }).joins))
      )
        back--
      const word = items[back]
      if (word?.kind === 'word' && word.beside === undefined) {
        word.beside = { key: piece.key, node: piece.node }
        continue
      }
      items.push({
        kind: 'node',
        key: piece.key,
        joins: true,
        node: (
          <span
            key={piece.key}
            data-diff-word=''
            data-diff-key={piece.key}
            data-flow-held={held ? '' : undefined}
            className={cn(flowItemClassName, besideClassName)}
          >
            {piece.node}
          </span>
        ),
      })
      continue
    }
    if (piece.kind !== 'words') {
      items.push({
        kind: 'node',
        key: piece.key,
        node: piece.node,
        joins: piece.kind !== 'gap',
      })
      continue
    }
    let at = piece.at
    const words = wordsOf(piece.text)
    for (const [index, text] of words.entries()) {
      const token = {
        key: `${piece.side}${at}`,
        text,
        className: piece.className,
        hidden: piece.hidden,
      }
      at += text.length
      if (text.trim() === '') {
        items.push({
          kind: 'space',
          text,
          key: token.key,
          // Only a space between two of its words takes a change's look: one at its edge would strike or tint past them.
          className:
            index === 0 || index === words.length - 1 ? undefined : piece.className,
          spaced: !!piece.spaces,
        })
        continue
      }
      // A mark joins the word before it, past anything set among the words after it.
      let back = items.length - 1
      while (
        back >= 0 &&
        items[back].kind === 'node' &&
        (items[back] as { joins: boolean }).joins
      )
        back--
      const before = items[back]
      if (isMark(text) && before?.kind === 'word') {
        before.tokens.push(token)
        continue
      }
      items.push({ kind: 'word', tokens: [token] })
    }
  }
  return items.map((item) => {
    if (item.kind === 'node') return item.node
    if (item.kind === 'space') {
      return item.spaced ? (
        <span
          key={item.key}
          aria-hidden
          data-diff-word=''
          data-diff-key={item.key}
          data-flow-held={held ? '' : undefined}
          className={cn('inline-block whitespace-pre', flowItemClassName)}
        >
          <span className={cn(wordFadeClassName, item.className)}>{item.text}</span>
        </span>
      ) : (
        item.text
      )
    }
    const [first] = item.tokens
    return (
      <span
        key={first.key}
        data-diff-word=''
        data-diff-key={first.key}
        data-flow-held={held ? '' : undefined}
        className={cn('inline-block whitespace-pre', flowItemClassName)}
      >
        {item.tokens.map((token) => (
          <span
            key={token.key}
            aria-hidden={token.hidden || undefined}
            className={cn(wordFadeClassName, token.className)}
          >
            {token.text}
          </span>
        ))}
        {item.beside ? (
          <span key={item.beside.key} className={besideClassName}>
            {item.beside.node}
          </span>
        ) : null}
      </span>
    )
  })
}

// A change's buttons after its words, on the text's line.
const besideClassName = 'ms-0.5 inline-flex translate-y-0.5 gap-px align-text-bottom'

/** An open change's sides as a screen reader hears them: one deletion and one insertion, not a word at a time. */
function SaidChange({ removed, added }: { removed: string; added: string }) {
  return (
    <span className='sr-only'>
      {removed ? <del>{removed}</del> : null}
      {removed && added ? ' ' : null}
      {added ? <ins>{added}</ins> : null}
    </span>
  )
}

function CodeDiff({
  before,
  after,
  complete = true,
  language,
  title,
  lineNumbers = true,
  resolved,
  defaultResolved,
  onResolvedChange,
  className,
  ref,
  ...props
}: DiffProps & {
  language: CodeLanguage
  /** A file name, such as `invoice.ts`. Without one, the header names the language. */
  title?: string
  lineNumbers?: boolean
}) {
  const diff = useMemo(
    () => diffCode(before, after, { complete }),
    [before, after, complete],
  )
  const ids = useMemo(() => diff.changes.map((change) => change.id), [diff])
  const namesOf = useCallback(
    (resolved: Resolved) => codeChangeNames(diff, resolved),
    [diff],
  )
  const { review, rootRef } = useReview(
    { resolved, defaultResolved, onResolvedChange, complete },
    ids,
    diff.growing,
    namesOf,
    ref,
  )
  const beforeTokens = useCodeTokens(before, language)
  const afterTokens = useCodeTokens(after, language)
  const { frame, row } = useFlow<HTMLDivElement, HTMLElement>(
    '[data-diff-row]',
    'data-diff-key',
  )
  const rowRef = useMemo(() => mergeRefs(row, markMounted), [row])
  const name = title ?? languageName(language)
  // The most lines the gutter can count: every kept line, and the longer side of each change.
  const mostLines = diff.rows.reduce(
    (lines, row) =>
      lines +
      (row.kind === 'change'
        ? Math.max(row.change.removed.length, row.change.added.length)
        : 1),
    0,
  )

  return usePart(
    review,
    'root',
    {},
    {
      ...props,
      ref: rootRef,
      tabIndex: -1,
      'aria-label': `Changes to ${name}`,
      className: cn(
        codeCardClassName,
        '@container/diff',
        reviewFocusClassName,
        className,
      ),
      children: ({ resolved, readOnly }: { resolved: Resolved; readOnly: boolean }) => {
        const names = namesOf(resolved)
        const open = ids.filter((id) => resolved[id] === undefined)
        let number = 0
        const lines: ReactNode[] = []
        const line = (
          key: string,
          text: string,
          tokens: Parameters<typeof CodeLine>[0]['tokens'] | undefined,
          options: {
            mark?: 'added' | 'removed'
            words?: Parameters<typeof CodeLine>[0]['words']
            counted: boolean
            pending?: boolean
          },
        ) => {
          if (options.counted) number++
          lines.push(
            <div
              key={key}
              data-diff-row=''
              data-diff-key={key}
              data-flow-held={complete ? undefined : ''}
              data-pending={options.pending ? '' : undefined}
              className={flowItemClassName}
            >
              <CodeLine
                number={options.counted ? number : undefined}
                mark={options.mark}
                tokens={
                  (options.pending ? undefined : tokens) ??
                  (text ? [{ content: text }] : [])
                }
                words={options.words}
                lineNumbers={lineNumbers}
                signs
                className={cn(lineFadeClassName, options.pending && pendingLineClassName)}
              />
            </div>,
          )
        }
        for (const row of diff.rows) {
          if (row.kind === 'same') {
            line(`b${row.before}`, row.text, afterTokens[row.after - 1], {
              counted: true,
            })
            continue
          }
          if (row.kind === 'pending') {
            line(`b${row.before}`, row.text, undefined, { counted: true, pending: true })
            continue
          }
          const { change } = row
          const decided = resolved[change.id]
          if (decided !== 'accepted') {
            for (const removed of change.removed) {
              line(`b${removed.number}`, removed.text, beforeTokens[removed.number - 1], {
                mark: decided === undefined ? 'removed' : undefined,
                words: removed.words,
                counted: decided === 'rejected',
              })
            }
          }
          if (decided !== 'rejected') {
            for (const added of change.added) {
              line(`a${added.number}`, added.text, afterTokens[added.number - 1], {
                mark: decided === undefined ? 'added' : undefined,
                words: added.words,
                counted: true,
              })
            }
          }
          if (decided === undefined && !readOnly) {
            // Under the change, in a row of its own, so the buttons never cover the code they decide.
            lines.push(
              <div
                key={`c${change.id}`}
                data-diff-row=''
                data-diff-key={`c${change.id}`}
                data-flow-held={complete ? undefined : ''}
                className={cn(flowItemClassName, 'flex justify-end')}
              >
                <div className='sticky end-0 flex gap-0.5 px-1.5 py-1 font-sans'>
                  <ChangeButtons
                    id={change.id}
                    name={names.get(change.id) ?? change.id}
                    disabled={diff.growing.includes(change.id)}
                    onDecide={(resolution, event) =>
                      resolution === 'accepted'
                        ? review.api.accept(change.id, event)
                        : review.api.reject(change.id, event)
                    }
                  />
                </div>
              </div>,
            )
          }
        }
        return (
          <>
            <CodeDiffHeader
              title={title}
              language={language}
              open={diff.changes.filter((change) => resolved[change.id] === undefined)}
            >
              {readOnly ? null : (
                <AllButtons
                  open={open.length}
                  disabled={!complete}
                  onAll={(resolution, event) =>
                    resolution === 'accepted'
                      ? review.api.acceptAll(event)
                      : review.api.rejectAll(event)
                  }
                />
              )}
            </CodeDiffHeader>
            {diff.changes.length === 0 && complete ? (
              <p className='text-muted-foreground p-(--surface-padding) text-sm'>
                No changes
              </p>
            ) : (
              <CodeScroller label={`${name} changes`} className='bg-muted/50'>
                <div
                  ref={frame}
                  data-arriving={complete ? undefined : ''}
                  className={cn(frameClassName, 'w-max min-w-full')}
                >
                  <code
                    ref={rowRef}
                    data-slot='code-lines'
                    className='group/flow relative isolate grid w-max min-w-full'
                    style={
                      {
                        '--code-gutter': gutterWidth(Math.max(mostLines, 1)),
                      } as CSSProperties
                    }
                  >
                    {lines}
                  </code>
                </div>
              </CodeScroller>
            )}
          </>
        )
      },
    },
  )
}

function TextDiff({
  before,
  after,
  complete = true,
  label = 'Suggested changes',
  resolved,
  defaultResolved,
  onResolvedChange,
  className,
  ref,
  ...props
}: DiffProps & {
  /** What a screen reader calls the changes. */
  label?: string
}) {
  const diff = useMemo(
    () => diffText(before, after, { complete }),
    [before, after, complete],
  )
  const ids = useMemo(() => diff.changes.map((change) => change.id), [diff])
  const namesOf = useCallback(() => textChangeNames(ids), [ids])
  const { review, rootRef } = useReview(
    { resolved, defaultResolved, onResolvedChange, complete },
    ids,
    diff.growing,
    namesOf,
    ref,
  )
  const { frame, row } = useFlow<HTMLDivElement, HTMLDivElement>(
    '[data-diff-word]',
    'data-diff-key',
  )
  const rowRef = useMemo(() => mergeRefs(row, markMounted), [row])

  return usePart(
    review,
    'root',
    {},
    {
      ...props,
      ref: rootRef,
      tabIndex: -1,
      'aria-label': label,
      className: cn(
        'flex min-w-0 flex-col gap-3 rounded-(--surface-radius)',
        reviewFocusClassName,
        className,
      ),
      children: ({ resolved, readOnly }: { resolved: Resolved; readOnly: boolean }) => {
        const names = namesOf()
        const open = ids.filter((id) => resolved[id] === undefined)
        const pieces: ProsePiece[] = []
        let atBefore = 0
        let atAfter = 0
        for (const part of diff.parts) {
          if (part.kind === 'same') {
            pieces.push({ kind: 'words', text: part.text, at: atBefore, side: 'b' })
            atBefore += part.text.length
            atAfter += part.text.length
            continue
          }
          if (part.kind === 'pending') {
            pieces.push({
              kind: 'words',
              text: part.text,
              at: atBefore,
              side: 'b',
              className: 'text-muted-foreground',
            })
            atBefore += part.text.length
            continue
          }
          const { change } = part
          const decided = resolved[change.id]
          const open = decided === undefined
          if (open) {
            pieces.push({
              kind: 'said',
              key: `s${change.id}`,
              node: (
                <SaidChange
                  key={`s${change.id}`}
                  removed={change.removed}
                  added={change.added}
                />
              ),
            })
          }
          if (decided !== 'accepted') {
            pieces.push({
              kind: 'words',
              text: change.removed,
              at: atBefore,
              side: 'b',
              className: open ? removedWordClassName : undefined,
              spaces: true,
              hidden: open,
            })
          }
          if (open && change.removed && change.added) {
            pieces.push({ kind: 'gap', key: `g${change.id}`, node: ' ' })
          }
          if (decided !== 'rejected') {
            pieces.push({
              kind: 'words',
              text: change.added,
              at: atAfter,
              side: 'a',
              className: open ? addedWordClassName : undefined,
              spaces: true,
              hidden: open,
            })
          }
          if (open && !readOnly) {
            pieces.push({
              kind: 'beside',
              key: `c${change.id}`,
              node: (
                <ChangeButtons
                  id={change.id}
                  name={names.get(change.id) ?? change.id}
                  compact
                  disabled={diff.growing.includes(change.id)}
                  onDecide={(resolution, event) =>
                    resolution === 'accepted'
                      ? review.api.accept(change.id, event)
                      : review.api.reject(change.id, event)
                  }
                />
              ),
            })
          }
          atBefore += change.removed.length
          atAfter += change.added.length
        }
        return (
          <>
            <div
              ref={frame}
              data-arriving={complete ? undefined : ''}
              className={frameClassName}
            >
              <div
                ref={rowRef}
                className='group/flow relative isolate text-sm leading-7 whitespace-pre-wrap'
              >
                {proseItems(pieces, !complete)}
              </div>
            </div>
            {/* Kept while after arrives, so the foot doesn't leave and come back as the first change forms. */}
            {!readOnly && (ids.length > 0 || !complete) ? (
              <div className='flex flex-wrap items-center justify-between gap-2 border-t pt-2'>
                <ReviewStatus open={open.length} total={ids.length} complete={complete} />
                <AllButtons
                  open={open.length}
                  disabled={!complete}
                  onAll={(resolution, event) =>
                    resolution === 'accepted'
                      ? review.api.acceptAll(event)
                      : review.api.rejectAll(event)
                  }
                />
              </div>
            ) : null}
          </>
        )
      },
    },
  )
}

export { CodeDiff, TextDiff }
export { codeChangeNames }
export type { DiffProps }
