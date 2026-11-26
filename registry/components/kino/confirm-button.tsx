'use client'

import { Button } from '@/registry/components/kino/button'
import { IconPlaceholder } from '@/registry/icons/icon-placeholder'
import { announce } from '@/registry/lib/announce'
import { CutTooltip } from '@/registry/lib/cut'
import { noticeIcon } from '@/registry/lib/notice'
import { settle } from '@/registry/lib/settle'
import { Swap, useSwapFocus } from '@/registry/lib/swap'
import {
  type ComponentProps,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react'

import { cn } from '@/lib/utils'

type ButtonProps = ComponentProps<typeof Button>
type ConfirmSize = NonNullable<ButtonProps['size']>

/** Where the button is: at rest, asking, running the action, or showing how it went. */
type ConfirmStatus = 'rest' | 'asking' | 'working' | 'done' | 'failed'

type ConfirmEvent = 'press' | 'cancel' | 'confirm' | 'succeed' | 'fail' | 'end'

/** The size of the text buttons beside an icon-only one. */
const textSize = {
  default: 'default',
  xs: 'xs',
  sm: 'sm',
  lg: 'lg',
  icon: 'default',
  'icon-xs': 'xs',
  'icon-sm': 'sm',
  'icon-lg': 'lg',
} as const satisfies Record<ConfirmSize, ConfirmSize>

/** The result's height and text, the same as a button of its size, so nothing moves when it arrives. */
const resultSize = {
  default: 'h-(--control-height) text-sm',
  xs: 'h-(--control-height-xs) text-xs',
  sm: 'h-(--control-height-sm) text-sm',
  lg: 'h-(--control-height-lg) text-sm',
}

/*
 * A button for an action that is hard to take back, confirmed in place. It
 * grows into a question with Cancel beside the action, shows the Button's
 * spinner while the action runs, then says how it went, with Undo. Escape, a
 * press elsewhere and Tab away cancel the question; the result is announced
 * and goes back to rest after `timeout`, which waits while it is hovered or
 * focused.
 */
function ConfirmButton({
  onConfirm,
  onUndo,
  question = 'Delete?',
  confirmSentence,
  confirmLabel = 'Delete',
  cancelLabel = 'Cancel',
  doneLabel = 'Deleted',
  failedLabel = 'Couldn’t delete',
  undoLabel = 'Undo',
  undoneLabel = 'Restored',
  undoFailedLabel = 'Couldn’t undo',
  retryLabel = 'Try again',
  timeout = 5000,
  variant = 'outline',
  size = 'default',
  className,
  children,
  ...props
}: Omit<ButtonProps, 'onClick' | 'loading' | 'render'> & {
  /** Runs the action. A promise keeps the spinner until it settles; a rejection shows `failedLabel`. */
  onConfirm: () => unknown
  /** Shows Undo in the result. A promise keeps Undo's spinner until it settles. */
  onUndo?: () => unknown
  /** What the question asks, beside Cancel and the action. */
  question?: string
  /** What a person is asked when an agent presses the confirm, as a whole sentence that names the thing. Without it, the `question`. */
  confirmSentence?: string
  /** The action's label in the question. Name what it does, never "OK". */
  confirmLabel?: string
  cancelLabel?: string
  doneLabel?: string
  failedLabel?: string
  undoLabel?: string
  /** What a screen reader hears once Undo has worked. */
  undoneLabel?: string
  undoFailedLabel?: string
  retryLabel?: string
  /** How long the result shows before the button goes back to rest, in ms. `Infinity` keeps it. */
  timeout?: number
}) {
  const [status, setStatus] = useState<ConfirmStatus>('rest')
  const [undoing, setUndoing] = useState(false)
  const [undoFailed, setUndoFailed] = useState(false)
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const questionId = useId()
  const rootRef = useRef<HTMLSpanElement>(null)
  // Focus follows the change when it was inside, so it never falls to the page.
  const followFocus = useSwapFocus(rootRef, status)
  const run = useRef(0)

  const go = useCallback(
    (event: ConfirmEvent, follow?: boolean) => {
      followFocus(follow)
      setStatus((current) => confirmStatus(current, event))
    },
    [followFocus],
  )

  // A press anywhere else cancels the question.
  useEffect(() => {
    if (status !== 'asking') return
    const press = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) go('cancel', false)
    }
    document.addEventListener('pointerdown', press, true)
    return () => document.removeEventListener('pointerdown', press, true)
  }, [status, go])

  // The result goes back to rest after `timeout`, but never while someone is reading it.
  const resting = status === 'done' || status === 'failed'
  const paused = hovered || focused || undoing
  useEffect(() => {
    if (!resting || paused || !Number.isFinite(timeout)) return
    const timer = setTimeout(() => go('end'), timeout)
    return () => clearTimeout(timer)
  }, [resting, paused, timeout, go])

  // A run that ends after the component has gone, or after another began, changes nothing.
  useEffect(() => () => void (run.current += 1), [])

  const confirm = (event: MouseEvent) => {
    // The second press of a double click lands on whatever arrived under the pointer.
    if (event.detail > 1) return
    const id = ++run.current
    go('confirm', true)
    const finish = (ok: boolean) => {
      if (run.current !== id) return
      setUndoFailed(false)
      go(ok ? 'succeed' : 'fail')
      announce(ok ? doneLabel : failedLabel)
    }
    settle(onConfirm, finish)
  }

  const undo = () => {
    setUndoing(true)
    settle(onUndo, (ok) => {
      setUndoing(false)
      setUndoFailed(!ok)
      announce(ok ? undoneLabel : undoFailedLabel)
      if (ok) go('end')
    })
  }

  const keyDown = (event: KeyboardEvent) => {
    // A held key repeats its press, which would answer the question it just opened.
    if (event.repeat && (event.key === 'Enter' || event.key === ' '))
      event.preventDefault()
    if (event.key === 'Escape' && status === 'asking') {
      event.preventDefault()
      event.stopPropagation()
      go('cancel', true)
    }
  }

  const blur = (event: FocusEvent) => {
    const to = event.relatedTarget as Node | null
    if (rootRef.current?.contains(to)) return
    setFocused(false)
    // Tab away cancels; focus lost to a part on its way out doesn't.
    if (to && status === 'asking') go('cancel', false)
  }

  const shownSize = textSize[size ?? 'default']

  let view: ReactNode
  if (status === 'rest') {
    view = (
      <Button
        data-focus-target=''
        variant={variant}
        size={size}
        onClick={() => go('press', true)}
        // Focus that returns here after the result keeps its place, even once the action is unavailable.
        focusableWhenDisabled
        {...props}
      >
        {children}
      </Button>
    )
  } else if (status === 'asking' || status === 'working') {
    view = (
      <span
        role='group'
        aria-labelledby={questionId}
        // A question too long for one line takes its own, and the buttons go below it.
        className='inline-flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-2'
      >
        <span
          id={questionId}
          className={cn(
            // It wraps, never truncates: what it asks is the point of the step.
            'min-w-0 flex-[1_1_auto] pe-0.5 font-medium break-words text-pretty',
            shownSize === 'xs' ? 'text-xs' : 'text-sm',
          )}
        >
          {question}
        </span>
        <span className='flex shrink-0 items-center gap-1.5'>
          <Button
            data-focus-target={status === 'asking' ? '' : undefined}
            variant='ghost'
            size={shownSize}
            disabled={status === 'working'}
            onClick={(event) => {
              // The second press of a double click on the button can land here.
              if (event.detail <= 1) go('cancel', true)
            }}
          >
            {cancelLabel}
          </Button>
          <Button
            data-focus-target={status === 'working' ? '' : undefined}
            variant='destructive'
            size={shownSize}
            loading={status === 'working'}
            data-agent-confirm={confirmSentence ?? question}
            onClick={confirm}
          >
            {confirmLabel}
          </Button>
        </span>
      </span>
    )
  } else {
    const done = status === 'done'
    view = (
      <span className='inline-flex min-w-0 items-center gap-1.5'>
        <CutTooltip
          render={
            <span
              data-focus-target={done && !onUndo ? '' : undefined}
              tabIndex={-1}
              className={cn(
                'inline-flex min-w-0 items-center gap-1.5 rounded-(--control-radius) px-(--control-padding) font-medium focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-hidden [&_svg]:size-4 [&_svg]:shrink-0',
                resultSize[shownSize],
              )}
            >
              {done && !undoFailed ? (
                <IconPlaceholder
                  lucide='CheckIcon'
                  tabler='IconCheck'
                  hugeicons='Tick02Icon'
                  phosphor='CheckIcon'
                  remixicon='RiCheckLine'
                  aria-hidden
                />
              ) : (
                noticeIcon('error', undefined)
              )}
              <span data-cut className='min-w-0 truncate'>
                {done ? (undoFailed ? undoFailedLabel : doneLabel) : failedLabel}
              </span>
            </span>
          }
        />
        {done && onUndo ? (
          <Button
            data-focus-target=''
            variant='ghost'
            size={shownSize}
            loading={undoing}
            onClick={undo}
          >
            {undoLabel}
          </Button>
        ) : null}
        {done ? null : (
          <Button
            data-focus-target=''
            variant='ghost'
            size={shownSize}
            // It runs the action again, which a person agreed to once.
            data-agent-confirm={confirmSentence ?? question}
            onClick={confirm}
          >
            {retryLabel}
          </Button>
        )}
      </span>
    )
  }

  return (
    // oxlint-disable-next-line jsx-a11y/no-static-element-interactions -- it hears what bubbles from its parts: Escape, a held key's repeats, a press beside its buttons, focus and hover
    <span
      ref={rootRef}
      data-slot='confirm-button'
      data-status={status}
      className={cn('inline-flex max-w-full min-w-0', className)}
      onKeyDown={keyDown}
      // A press on the question or a gap, such as a double click's second,
      // keeps focus on Cancel, where Escape still cancels.
      onMouseDown={(event) => {
        if (status === 'asking' && !(event.target as Element).closest('button')) {
          event.preventDefault()
        }
      }}
      // Only focus a person can see holds the result: focus moved after a pointer press doesn't.
      onFocus={(event) => setFocused(event.target.matches(':focus-visible'))}
      onBlur={blur}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
    >
      {/* A block, so a question that wraps onto a second line grows the height on `layout` too. */}
      <Swap align='start' block id={viewOf(status)} className='max-w-full'>
        {view}
      </Swap>
    </span>
  )
}

/** The status after `event`; an event that doesn't apply where the button is changes nothing. */
function confirmStatus(status: ConfirmStatus, event: ConfirmEvent): ConfirmStatus {
  switch (event) {
    case 'press':
      return status === 'rest' ? 'asking' : status
    case 'cancel':
      return status === 'asking' ? 'rest' : status
    case 'confirm':
      return status === 'asking' || status === 'failed' ? 'working' : status
    case 'succeed':
      return status === 'working' ? 'done' : status
    case 'fail':
      return status === 'working' ? 'failed' : status
    case 'end':
      return status === 'done' || status === 'failed' ? 'rest' : status
  }
}

/** Which view shows: the question stays while its action runs, so only the button inside changes. */
function viewOf(status: ConfirmStatus) {
  return status === 'working' ? 'asking' : status
}

export { ConfirmButton, confirmStatus, viewOf }
export type { ConfirmEvent, ConfirmStatus }
