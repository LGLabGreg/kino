'use client'

import { InputInvalidIcon, inputBoxClassName } from '@/registry/components/kino/input'
import { Spinner, useSpinner } from '@/registry/components/kino/spinner'
import {
  textareaRadiusClassName,
  textareaSizeClassName,
} from '@/registry/components/kino/textarea'
import {
  ChipRemoveIcon,
  chipClassName,
  chipLeavingClassName,
  chipRemoveClassName,
} from '@/registry/lib/chip'
import { CutTooltip } from '@/registry/lib/cut'
import { fromWhereItIs, leaveAsCopy, returnFromCopy } from '@/registry/lib/flow'
import { markMounted, mergeRefs } from '@/registry/lib/refs'
import { Swap, swapIconClassName } from '@/registry/lib/swap'
import {
  createTokenInputController,
  defaultCodec,
  fromText,
  type Token,
  type TokenCodec,
  TokenInput as TokenInputPrimitive,
  type TokenInputController,
  TokenInputEditor as TokenInputEditorPrimitive,
  type TokenInputProps,
  TokenInputToken as TokenInputTokenPrimitive,
  TokenInputTokenRemove as TokenInputTokenRemovePrimitive,
  type TokenInputTokenState,
  type TokenInputValue,
  toLabel,
  toText,
} from '@ui-sdk/react/token-input'
import {
  type ComponentProps,
  createContext,
  type PointerEvent,
  type ReactNode,
  use,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import { cn } from '@/lib/utils'

/*
 * ui-sdk's Token input: text and tokens in one field, as in a message that
 * mentions people or attaches files. ui-sdk edits, deletes, undoes, copies
 * and writes the value as text for a form; this is the field's box, and the
 * chip each token is drawn as, which scales in, leaves from where it was,
 * and shows a spinner while it loads.
 */

/** Where a chip that leaves was seen, to leave a copy of it there. */
interface Seen {
  style: Partial<CSSStyleDeclaration>
  from: ReturnType<typeof fromWhereItIs>
}

/*
 * What the chips learn of each change as ui-sdk asks for it, while every
 * chip it removes is still on screen: ui-sdk takes a removed token's host
 * out before React runs its chip's cleanup, and draws the hosts after a
 * change afresh, so a chip that mounts may be one that stays.
 */
interface TokenFlow {
  box: HTMLElement | null
  /** Notes the box the chips sit in, as it mounts. */
  setBox: (box: HTMLElement | null) => void
  /** The tokens the latest change brings in, which scale in. */
  entering: ReadonlySet<string>
  /** Where each chip the latest change removes was seen, by its token's id. */
  leaving: Map<string, Seen>
}

const TokenFlowContext = createContext<TokenFlow | null>(null)

/** The root. Each token is drawn as Kino's chip unless `renderToken` draws it. */
function TokenInput({
  renderToken = defaultToken,
  onValueChange,
  ...props
}: TokenInputProps) {
  const [flow] = useState(() => {
    const made: TokenFlow = {
      box: null,
      setBox: (box) => {
        made.box = box
      },
      entering: new Set(),
      leaving: new Map(),
    }
    return made
  })
  return (
    <TokenFlowContext value={flow}>
      <TokenInputPrimitive
        renderToken={renderToken}
        onValueChange={(value, details) => {
          onValueChange?.(value, details)
          if (!details.canceled) seeChange(flow, value, details.removed)
        }}
        {...props}
      />
    </TokenFlowContext>
  )
}

/** Notes which tokens a change brings in, and where each chip it removes is now. */
function seeChange(flow: TokenFlow, value: TokenInputValue, removed: readonly Token[]) {
  const box = flow.box
  const editor = box?.querySelector<HTMLElement>('[data-slot=token-input-editor]')
  if (!box || !editor) return
  const hosts = new Map(
    [...editor.querySelectorAll<HTMLElement>('[data-token-id]')].map((host) => [
      host.dataset.tokenId,
      host,
    ]),
  )
  flow.entering = new Set(
    value.flatMap((part) =>
      typeof part !== 'string' && part.id && !hosts.has(part.id) ? [part.id] : [],
    ),
  )
  flow.leaving = new Map()
  for (const token of removed) {
    const chip = token.id
      ? hosts.get(token.id)?.querySelector<HTMLElement>('[data-slot=token-input-token]')
      : null
    const seen = chip ? seeChip(chip, box, editor) : null
    if (token.id && seen) flow.leaving.set(token.id, seen)
  }
}

function defaultToken() {
  return <TokenInputToken />
}

/** A press on the box, outside the text, puts the caret in the text. */
function focusEditor(event: PointerEvent<HTMLElement>) {
  if (event.target !== event.currentTarget) return
  const editor = event.currentTarget.querySelector<HTMLElement>(
    '[data-slot=token-input-editor]',
  )
  if (!editor) return
  event.preventDefault()
  editor.focus()
}

/**
 * The field: the text and its tokens, in the box every text control has. It
 * grows with its text, then scrolls. `className` goes on the box; every
 * other prop goes to ui-sdk's editor.
 */
function TokenInputEditor({
  className,
  ...props
}: Omit<ComponentProps<typeof TokenInputEditorPrimitive>, 'className'> & {
  className?: string
}) {
  const flow = use(TokenFlowContext)
  const boxRef = useMemo(
    () =>
      mergeRefs<HTMLDivElement>(markMounted, (box) => {
        flow?.setBox(box)
      }),
    [flow],
  )
  return (
    <div
      ref={boxRef}
      data-token-input-box=''
      onPointerDown={focusEditor}
      className={cn(
        inputBoxClassName,
        textareaRadiusClassName,
        'cursor-text items-stretch has-data-disabled:pointer-events-none has-data-disabled:opacity-50',
        className,
      )}
    >
      <TokenInputEditorPrimitive
        className={cn(
          // A line fits a token with room around it, at every density.
          textareaSizeClassName,
          'scrollbar-thin relative min-w-0 overflow-y-auto py-1.5 leading-[calc(var(--control-height-xs)+0.25rem)] wrap-break-word whitespace-pre-wrap',
          'data-readonly:text-muted-foreground',
          // A token sits in the line as a word does. `align-middle` sits it a
          // little low beside the text; a tenth of the font size centres it
          // on the line, at every text size.
          '[&_[data-slot=token-input-host]]:mx-px [&_[data-slot=token-input-host]]:inline-block [&_[data-slot=token-input-host]]:max-w-full [&_[data-slot=token-input-host]]:-translate-y-[0.1em] [&_[data-slot=token-input-host]]:align-middle',
          // The placeholder, which ui-sdk gives as `aria-placeholder`.
          'data-empty:before:text-muted-foreground data-empty:before:pointer-events-none data-empty:before:absolute data-empty:before:inset-x-(--control-padding) data-empty:before:truncate data-empty:before:content-[attr(aria-placeholder)]',
        )}
        {...props}
      />
      <InputInvalidIcon className='absolute end-0 top-2.5' />
    </div>
  )
}

const tokenSpinnerSwap = cn(
  swapIconClassName,
  '-me-1 [--button-height:var(--control-height-xs)]',
)

/**
 * A token's chip, the Tag input's own: what it holds as children, or a
 * function of `{ token }` (its label by default). It shows a spinner while
 * it loads, a dashed edge when it is unresolved, and the focus ring while it
 * is selected.
 */
function TokenInputToken({
  className,
  children,
  ref,
  ...props
}: Omit<ComponentProps<typeof TokenInputTokenPrimitive>, 'className' | 'children'> & {
  className?: string
  children?: ReactNode | ((state: TokenInputTokenState) => ReactNode)
}) {
  const chip = useRef<HTMLSpanElement>(null)
  const chipRef = useMemo(() => mergeRefs(chip, ref), [ref])
  const flow = use(TokenFlowContext)
  useTokenFlow(chip, flow)
  return (
    <TokenInputTokenPrimitive
      ref={chipRef}
      className={(state) =>
        cn(
          chipClassName,
          chipLeavingClassName,
          'px-2 whitespace-nowrap has-data-[slot=token-input-token-remove]:pe-0',
          '[transition:opacity_var(--motion-enter-duration)_var(--motion-enter-easing),scale_var(--motion-enter-duration)_var(--motion-enter-easing),color_var(--motion-press-duration)_var(--motion-press-fade-easing),box-shadow_var(--motion-press-duration)_var(--motion-press-fade-easing)] motion-reduce:[transition:opacity_var(--motion-enter-duration)_var(--motion-enter-easing)]',
          // A token the change brings in scales in on `enter` once the field
          // has painted, as a tag does; one whose chip is drawn afresh stays.
          state.token.id &&
            flow?.entering.has(state.token.id) &&
            'in-data-mounted:starting:opacity-0 motion-safe:in-data-mounted:starting:scale-75',
          'data-[selected]:ring-3 data-[selected]:ring-ring/50 forced-colors:data-[selected]:outline-2 forced-colors:data-[selected]:outline-[Highlight]',
          // Selected wins over the dashed edge, where forced colours drop the ring.
          'forced-colors:[&[data-selected][data-unresolved]]:outline-2 forced-colors:[&[data-selected][data-unresolved]]:outline-solid forced-colors:[&[data-selected][data-unresolved]]:outline-[Highlight]',
          'data-unresolved:outline-muted-foreground data-unresolved:bg-transparent data-unresolved:outline-1 data-unresolved:-outline-offset-1 data-unresolved:outline-dashed',
          className,
        )
      }
      {...props}
    >
      {(state) => (
        <TokenChip state={state}>
          {typeof children === 'function' ? children(state) : children}
        </TokenChip>
      )}
    </TokenInputTokenPrimitive>
  )
}

/** What a chip holds: the spinner while it loads, then its label, whole on hover while it is cut. */
function TokenChip({
  state,
  children,
}: {
  state: TokenInputTokenState
  children: ReactNode
}) {
  const spinning = useSpinner(state.pending)
  return (
    <>
      {/* The spinner rolls in and widens the chip, as on a Button; its box's
          margin takes back the chip's gap while it is empty. */}
      <Swap align='start' roll className={tokenSpinnerSwap}>
        {spinning ? (
          <span className='flex pe-1'>
            <Spinner aria-hidden className='size-3' />
          </span>
        ) : null}
      </Swap>
      <CutTooltip
        // Its label, or the spans that hold it, such as beside a picture.
        labels='[data-token-label], [data-token-label] > span'
        text={state.token.label}
        render={
          <span
            data-token-label=''
            className='flex min-w-0 items-center gap-1 [&>span]:min-w-0 [&>span]:truncate [&>span]:[unicode-bidi:plaintext]'
          >
            {children ?? state.token.label}
          </span>
        }
      />
    </>
  )
}

/**
 * A chip that goes leaves as a copy from where it was, in the field's box,
 * on Backspace, undo, a cut or a failed upload; one an undo brings back
 * while its copy still leaves turns back from where the copy had got to.
 */
function useTokenFlow(chip: { current: HTMLSpanElement | null }, flow: TokenFlow | null) {
  useLayoutEffect(() => {
    const element = chip.current
    const box = element?.closest<HTMLElement>('[data-token-input-box]')
    if (!element || !box) return
    const id = tokenIdOf(element)
    const copy = id
      ? box.querySelector<HTMLElement>(
          `:scope > [data-leaving-token="${CSS.escape(id)}"]`,
        )
      : null
    if (copy) returnFromCopy(element, copy)
    return () => leaveChip(element, box, id, flow)
  }, [chip, flow])
}

/** The id of the token a chip is drawn for, from the element ui-sdk holds it in. */
function tokenIdOf(chip: HTMLElement) {
  return chip.closest<HTMLElement>('[data-token-id]')?.dataset.tokenId ?? null
}

/** Where a chip is now, in its field's box, or null when the field shows none of it. */
function seeChip(chip: HTMLElement, box: HTMLElement, editor: HTMLElement): Seen | null {
  const seen = chip.getBoundingClientRect()
  const frame = box.getBoundingClientRect()
  // Only what showed of it leaves: the field clips a chip scrolled partly out.
  const clip = clipInside(seen, editor.getBoundingClientRect())
  if (clip === null) return null
  return {
    style: {
      left: `${seen.left - frame.left - box.clientLeft}px`,
      top: `${seen.top - frame.top - box.clientTop}px`,
      width: `${seen.width}px`,
      height: `${seen.height}px`,
      clipPath: clip,
    },
    from: fromWhereItIs(chip),
  }
}

/**
 * Leaves a copy of a chip whose token the latest change removed, from where
 * it was seen, once React has taken it out: an effect's cleanup also runs
 * for a chip that stays (Strict Mode), and for one drawn afresh.
 */
function leaveChip(
  chip: HTMLElement,
  box: HTMLElement,
  id: string | null,
  flow: TokenFlow | null,
) {
  queueMicrotask(() => {
    const seen = id ? flow?.leaving.get(id) : undefined
    if (!id || !seen || chip.isConnected || !box.isConnected) return
    flow?.leaving.delete(id)
    const copy = leaveAsCopy(chip, { parent: box, ...seen })
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

/**
 * Removes its token. ui-sdk keeps it from screen readers and the tab order,
 * since Backspace removes a token from the keyboard, and it hides while the
 * field is disabled or read-only.
 */
function TokenInputTokenRemove({
  className,
  children,
  ...props
}: Omit<ComponentProps<typeof TokenInputTokenRemovePrimitive>, 'className'> & {
  className?: string
}) {
  return (
    <TokenInputTokenRemovePrimitive
      className={cn(
        chipRemoveClassName,
        'data-disabled:hidden data-readonly:hidden',
        className,
      )}
      {...props}
    >
      {children ?? <ChipRemoveIcon />}
    </TokenInputTokenRemovePrimitive>
  )
}

export {
  TokenInput,
  TokenInputEditor,
  TokenInputToken,
  TokenInputTokenRemove,
  clipInside,
  createTokenInputController,
  defaultCodec,
  fromText,
  toLabel,
  toText,
}
export type { Token, TokenCodec, TokenInputController, TokenInputProps, TokenInputValue }
