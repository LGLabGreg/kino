'use client'

import { Field, FieldError } from '@/registry/components/kino/field'
import {
  focusControl,
  InputInvalidIcon,
  inputBoxClassName,
} from '@/registry/components/kino/input'
import {
  InputGroupAddon,
  InputGroupButton,
  inputGroupPresence,
} from '@/registry/components/kino/input-group'
import { useSpinner } from '@/registry/components/kino/spinner'
import { IconPlaceholder } from '@/registry/icons/icon-placeholder'
import { useAnnouncer } from '@/registry/lib/announce'
import { useControllable } from '@/registry/lib/controllable'
import { useFieldProps } from '@/registry/lib/field-control'
import { isComposing } from '@/registry/lib/keys'
import { noticeIcon } from '@/registry/lib/notice'
import { mergeRefs } from '@/registry/lib/refs'
import { settle } from '@/registry/lib/settle'
import { Swap, SwapText } from '@/registry/lib/swap'
import { Input as InputPrimitive } from '@base-ui/react/input'
import { cva } from 'class-variance-authority'
import {
  type FocusEvent,
  type KeyboardEvent,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import { cn } from '@/lib/utils'

/**
 * How the edit reads and saves. `quiet`: plain text at rest, and a save that
 * shows at once, with a mark after the text. `actions`: a pencil at rest,
 * Save and Cancel in the field, which stays open until the save is done.
 */
type InlineEditVariant = 'quiet' | 'actions'

/**
 * Where a save is: none running, running, just saved (Quiet's tick), failed
 * (Quiet's old text back), or done and waiting for Save's spinner to have
 * shown long enough (Actions).
 */
type InlineEditStatus = 'idle' | 'saving' | 'saved' | 'failed' | 'closing'

/** What a commit does with the text in the field. */
type InlineEditOutcome =
  | { kind: 'unchanged' }
  | { kind: 'invalid'; message: string }
  | { kind: 'save'; value: string }

/*
 * One box that holds the text at rest and the field while editing, so the
 * text never moves: only the Input's border, ring and surface fade in around
 * it. At rest the box is quiet, with a tint under the pointer and with focus.
 */
const inlineEditBoxVariants = cva(
  [
    inputBoxClassName,
    '[grid-area:control] not-data-editing:border-transparent not-data-editing:bg-transparent not-data-editing:shadow-none forced-colors:not-data-editing:border-[Canvas] dark:not-data-editing:bg-transparent',
    'not-data-editing:not-data-disabled:hover:bg-muted dark:not-data-editing:not-data-disabled:hover:bg-muted/50',
    'not-data-editing:has-focus-visible:border-ring not-data-editing:has-focus-visible:bg-muted dark:not-data-editing:has-focus-visible:bg-muted/50 data-disabled:opacity-50',
  ],
  {
    variants: {
      variant: {
        quiet: '',
        // While editing, the field ends where Save and Cancel begin: two small buttons, their gap and the space after them.
        actions: 'data-editing:pe-[calc(var(--control-height-xs)*2+--spacing(2))]',
      },
    },
    defaultVariants: { variant: 'quiet' },
  },
)

/*
 * The text at rest and in the field share these, so they sit at the same
 * place to the pixel. Below the `md` breakpoint the text is at least 16px,
 * as in the Input, or iOS zooms the page when the field takes focus; above
 * it, the text is the size of what surrounds it, such as a heading.
 */
const textClassName =
  'min-h-(--control-height) w-full min-w-0 px-(--control-padding) max-md:text-[max(1rem,1em)]'

/*
 * Actions' pencil sits at the box's end, where Save and Cancel arrive. It
 * leaves as they arrive, and comes back as they finish going, so the two never
 * show in one place. At rest it shows under the pointer and with focus, and
 * always on a touch screen, which has no pointer to rest.
 */
const pencilPresenceClassName =
  'pointer-events-none absolute inset-y-0 end-0 flex items-center pe-(--control-padding) transition-[opacity,scale] duration-(--motion-exit-duration) ease-(--motion-exit-easing) not-data-shown:opacity-0 data-shown:delay-[calc(var(--motion-exit-duration)*0.9)] data-shown:duration-(--motion-enter-duration) data-shown:ease-(--motion-enter-easing) motion-safe:not-data-shown:scale-75'
const pencilClassName =
  'text-muted-foreground flex opacity-0 transition-opacity duration-(--motion-press-duration) ease-(--motion-press-easing) group-hover/input:opacity-100 group-has-focus-visible/input:opacity-100 pointer-coarse:opacity-100 [&_svg]:size-4'

/*
 * Quiet's mark sits right after the text, where the text ends, and rolls out
 * while the field is open; the text is only as wide as it needs, and a press
 * on the rest of the box edits it too.
 */
const markClassName =
  'flex shrink-0 items-center ps-1.5 pe-(--control-padding) group-data-editing/input:px-0 [&_svg]:size-4'

/*
 * Save and Cancel arrive with the field and leave with it, scaling where
 * they are and turning back from where they are, as the Input group's parts
 * show and hide. They sit over the box's end, where the pencil is at rest.
 */
const actionsClassName = cn(
  inputGroupPresence,
  // They wait a fifth of the pencil's exit, as Swap's content does, so the two never read at once.
  'pointer-events-none absolute inset-y-0 end-0 gap-0.5 data-shown:pointer-events-auto data-shown:delay-[calc(var(--motion-exit-duration)*0.2)]',
)

/*
 * Text that becomes a field in place to rename something. A press, Enter or
 * F2 edits it with the whole text picked; Enter or a press elsewhere saves,
 * and Escape puts it back. Quiet saves at once: a spinner follows the text
 * while the save runs and a tick once it has saved, and a save that fails
 * puts the old text back with the error under it, and editing again offers
 * the text that failed. Actions keeps the field open with Save's spinner
 * until the save is done, and a save that fails keeps it open with the error.
 */
function InlineEdit({
  variant = 'quiet',
  value: valueProp,
  defaultValue = '',
  onValueChange,
  validate,
  editing: editingProp,
  defaultEditing = false,
  onEditingChange,
  label,
  placeholder,
  editLabel = `Edit ${label}`,
  disabled = false,
  saveLabel = 'Save',
  cancelLabel = 'Cancel',
  savedLabel = 'Saved',
  failedLabel = variant === 'quiet'
    ? 'Couldn’t save. Edit it to try again.'
    : 'Couldn’t save. Try again.',
  className,
  onKeyDown,
  readOnly = false,
  ref,
  ...props
}: Omit<
  InputPrimitive.Props,
  | 'value'
  | 'defaultValue'
  | 'onValueChange'
  | 'className'
  | 'placeholder'
  | 'disabled'
  | 'aria-label'
> & {
  variant?: InlineEditVariant
  value?: string
  defaultValue?: string
  /**
   * Saves a new value, trimmed. A promise shows the save running until it
   * settles; a rejection or a throw shows `failedLabel` and keeps the old value.
   */
  onValueChange?: (value: string) => unknown
  /** The message to show for a value that can't be saved, or nothing for one that can. */
  validate?: (value: string) => string | null | undefined
  /** Whether the field shows, for a Rename item elsewhere that opens it. */
  editing?: boolean
  defaultEditing?: boolean
  onEditingChange?: (editing: boolean) => void
  /** What the value is, such as "Project name": the field's name, and part of the text's description. */
  label: string
  /** Shown, muted, in place of an empty value. */
  placeholder?: string
  /** What pressing the text does, read after the text itself. `Edit {label}` by default. */
  editLabel?: string
  disabled?: boolean
  /** Actions' Save button. */
  saveLabel?: string
  /** Actions' Cancel button. */
  cancelLabel?: string
  /** What a screen reader hears once a save that took a moment has worked. */
  savedLabel?: string
  failedLabel?: string
  /** For layout: the field and its box take their parent's width. */
  className?: string
}) {
  const quiet = variant === 'quiet'
  const [own, setOwn] = useState(defaultValue)
  const value = valueProp ?? own
  const [editing, setEditing] = useControllable(
    editingProp,
    defaultEditing,
    onEditingChange,
  )
  const [draft, setDraft] = useState(value)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<InlineEditStatus>('idle')
  // Quiet: the value being saved, shown in place of the old one until the save ends.
  const [pending, setPending] = useState<string | null>(null)
  // Quiet: the value whose save failed, which the field offers again.
  const [failed, setFailed] = useState<string | null>(null)
  const spinning = useSpinner(status === 'saving')
  // The text on show: Quiet's value being saved, or the value. A commit is compared with it, so
  // a field opened again during a save neither saves the same text twice nor drops the old one put back.
  const shown = pending ?? value
  const { announce, region } = useAnnouncer()
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  // The buyer's ref gets the field too, memoised so it isn't set again on every render.
  const buttonRef = useRef<HTMLButtonElement>(null)
  const hintId = useId()
  // Focus goes back to the text after Enter or Escape; after a press elsewhere it stays there.
  const returnFocus = useRef(false)
  const run = useRef(0)

  // The field opens with the text it should hold, however it was opened.
  const [opened, setOpened] = useState(editing)
  if (editing !== opened) {
    setOpened(editing)
    if (editing) setDraft(quiet ? openingText(failed, pending, value) : value)
  }

  const wasEditing = useRef(editing)
  useLayoutEffect(() => {
    if (editing === wasEditing.current) return
    wasEditing.current = editing
    if (editing) {
      const input = inputRef.current
      if (input) {
        input.focus()
        // Picked from the end back, with the start in view, so a long text stays where it was.
        input.setSelectionRange(0, input.value.length, 'backward')
        input.scrollLeft = 0
      }
    } else if (returnFocus.current) {
      buttonRef.current?.focus()
    }
    returnFocus.current = false
  }, [editing])

  // Quiet's tick shows for a moment, then the text stands alone again.
  useEffect(() => {
    if (status !== 'saved') return
    const timer = setTimeout(() => setStatus('idle'), 2000)
    return () => clearTimeout(timer)
  }, [status])

  // Actions: a save that worked closes the field once the spinner has shown long enough to read.
  useEffect(() => {
    if (status !== 'closing' || spinning) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the spinner's hold ends on a timer, and the field closes after it
    setStatus('idle')
    // Focus follows the field closing only when it is still inside: a
    // person who moved on while the save ran keeps their place.
    returnFocus.current = rootRef.current?.contains(document.activeElement) ?? false
    setEditing(false)
  }, [status, spinning, setEditing])

  // A save that ends after the component has gone changes nothing.
  useEffect(() => () => void (run.current += 1), [])

  // Actions' field waits for its save; Quiet's can be edited again while one runs.
  const waiting = !quiet && status !== 'idle'

  const save = (next: string) => {
    const id = ++run.current
    const own = valueProp === undefined
    setStatus('saving')
    if (quiet) setPending(next)
    settle(
      () => onValueChange?.(next),
      (ok, waited) => {
        if (run.current !== id) return
        setPending(null)
        setStatus(settledStatus(variant, ok, waited))
        if (ok) {
          if (own) setOwn(next)
          if (waited) announce(savedLabel)
        } else {
          // The error line reads out a new message only; the same failure
          // again, from a second try, is said here.
          if (error === failedLabel) announce(failedLabel)
          setError(failedLabel)
          if (quiet) setFailed(next)
        }
      },
    )
  }

  const close = (follow: boolean) => {
    setFailed(null)
    if (status === 'failed') setStatus('idle')
    returnFocus.current = follow
    setEditing(false)
  }

  const commit = (follow: boolean) => {
    if (waiting) return
    const outcome = inlineEditOutcome(draft, shown, validate)
    if (outcome.kind === 'invalid') {
      setError(outcome.message)
      return
    }
    setError(null)
    if (outcome.kind === 'unchanged') {
      close(follow)
      return
    }
    // Quiet closes at once and shows the save beside the text; Actions keeps the field open until it's done.
    if (quiet) close(follow)
    save(outcome.value)
  }

  const cancel = (follow = true) => {
    if (waiting) return
    setError(null)
    close(follow)
  }

  const open = () => {
    if (disabled) return
    setEditing(true)
  }

  const fieldKeyDown: InputPrimitive.Props['onKeyDown'] = (event) => {
    onKeyDown?.(event)
    // Enter that picks a word in an input method editor isn't a save.
    if (isComposing(event.nativeEvent) || event.key !== 'Enter') return
    event.preventDefault()
    // A held Enter repeats, and would open the field it just closed.
    if (!event.repeat) commit(true)
  }

  // Escape puts the text back from anywhere in the field, its buttons included.
  const boxKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!editing || event.key !== 'Escape' || isComposing(event.nativeEvent)) return
    // Only the field closes, not a dialog it sits in.
    event.preventDefault()
    event.stopPropagation()
    cancel()
  }

  const boxBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (!editing) return
    // Focus that leaves the field, its buttons included, saves; another
    // window or tab taking focus isn't a press elsewhere.
    if (!document.hasFocus()) return
    if (rootRef.current?.contains(event.relatedTarget as Node | null)) return
    // A value that can't be saved is put back: a field left open without
    // focus could no longer be closed with Escape.
    if (inlineEditOutcome(draft, shown, validate).kind === 'invalid') cancel(false)
    else commit(false)
  }

  const mark = inlineEditMark(status, spinning)
  // The Field's control, once it opens.
  const field = useFieldProps(props)
  const fieldRef = field.props.ref
  const inputRefs = useMemo(() => mergeRefs(inputRef, ref, fieldRef), [ref, fieldRef])

  // Save keeps its spinner or its tick while it leaves with the field, so
  // nothing in it changes on the way out.
  const saveLoading = status === 'saving' || spinning
  const [heldLoading, setHeldLoading] = useState(saveLoading)
  if (editing && heldLoading !== saveLoading) setHeldLoading(saveLoading)

  return (
    <Field
      ref={rootRef}
      data-inline-edit=''
      data-variant={variant}
      invalid={error !== null}
      className={cn('min-w-0', className)}
    >
      {/* oxlint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events -- it hears what bubbles from the field and its buttons: Escape and focus leaving, and a press beside the text, which the text's own button covers for the keyboard */}
      <div
        data-slot='inline-edit-box'
        onBlur={boxBlur}
        onKeyDown={boxKeyDown}
        // A press on the box beside the text, such as on the invalid mark, keeps the caret in the field.
        onPointerDown={editing ? focusControl : undefined}
        // At rest, a press on the box beside the text edits it, as a press on the text does.
        onClick={(event) => {
          if (!editing && !buttonRef.current?.contains(event.target as Node)) open()
        }}
        data-editing={editing ? '' : undefined}
        data-disabled={disabled ? '' : undefined}
        className={inlineEditBoxVariants({ variant })}
      >
        {editing ? (
          <>
            <InputPrimitive
              {...field.props}
              ref={inputRefs}
              data-slot='inline-edit-field'
              aria-label={label}
              value={draft}
              placeholder={placeholder}
              readOnly={readOnly || waiting}
              onValueChange={(next) => {
                setDraft(next)
                setError(null)
              }}
              onKeyDown={fieldKeyDown}
              className={cn(
                textClassName,
                'bg-transparent placeholder:text-muted-foreground focus-visible:outline-hidden',
              )}
            />
            <InputInvalidIcon />
          </>
        ) : (
          <button
            ref={buttonRef}
            type='button'
            data-slot='inline-edit-text'
            aria-describedby={hintId}
            aria-busy={status === 'saving' || undefined}
            disabled={disabled}
            onClick={open}
            onKeyDown={(event) => {
              // A held key repeats its press, which would save the field it just opened.
              if (event.repeat && (event.key === 'Enter' || event.key === ' ')) {
                event.preventDefault()
              } else if (event.key === 'F2') {
                event.preventDefault()
                open()
              }
            }}
            className={cn(
              textClassName,
              'flex cursor-text items-center text-start focus-visible:outline-hidden disabled:cursor-default',
              // Quiet's text is as wide as it needs, with its mark after it;
              // Actions' leaves room at its end for the pencil.
              quiet
                ? 'w-auto flex-initial pe-0'
                : 'pe-[calc(var(--control-padding)*2+--spacing(4))]',
            )}
          >
            <SwapText
              text={shown || placeholder || ''}
              className={cn(!shown && 'text-muted-foreground')}
            />
          </button>
        )}
        {quiet ? (
          // Said by the status region and the description, not as part of the text's name.
          <span aria-hidden className={markClassName}>
            <Swap roll>{mark && !editing ? noticeIcon(mark, undefined) : null}</Swap>
          </span>
        ) : (
          <span
            aria-hidden
            data-shown={editing ? undefined : ''}
            className={pencilPresenceClassName}
          >
            <span className={pencilClassName}>
              <IconPlaceholder
                lucide='PencilIcon'
                tabler='IconPencil'
                hugeicons='PencilEdit01Icon'
                phosphor='PencilSimpleIcon'
                remixicon='RiPencilLine'
                aria-hidden
              />
            </span>
          </span>
        )}
        {quiet ? null : (
          <InputGroupAddon
            align='inline-end'
            data-shown={editing ? '' : undefined}
            // At rest they are gone from the tab order and from screen readers, and fade out where they are.
            inert={!editing}
            className={actionsClassName}
            // The field keeps focus through a press on Save or Cancel, so
            // the press is never a press elsewhere, which saves.
            onMouseDown={(event) => event.preventDefault()}
          >
            <InputGroupButton
              size='icon-xs'
              aria-label={cancelLabel}
              disabled={waiting}
              onClick={() => cancel()}
            >
              <IconPlaceholder
                lucide='XIcon'
                tabler='IconX'
                hugeicons='Cancel01Icon'
                phosphor='XIcon'
                remixicon='RiCloseLine'
                aria-hidden
              />
            </InputGroupButton>
            <InputGroupButton
              size='icon-xs'
              aria-label={saveLabel}
              loading={editing ? saveLoading : heldLoading}
              onClick={() => commit(true)}
            >
              <IconPlaceholder
                lucide='CheckIcon'
                tabler='IconCheck'
                hugeicons='Tick02Icon'
                phosphor='CheckIcon'
                remixicon='RiCheckLine'
                aria-hidden
              />
            </InputGroupButton>
          </InputGroupAddon>
        )}
      </div>
      <FieldError>{error}</FieldError>
      <span id={hintId} hidden>
        {status === 'failed' ? `${editLabel}. ${failedLabel}` : editLabel}
      </span>
      {region}
    </Field>
  )
}

/** What a commit of `draft` over `value` does: nothing, an error to show, or a save of the trimmed text. */
function inlineEditOutcome(
  draft: string,
  value: string,
  validate?: (value: string) => string | null | undefined,
): InlineEditOutcome {
  const next = draft.trim()
  if (next === value) return { kind: 'unchanged' }
  const message = validate?.(next)
  if (message) return { kind: 'invalid', message }
  return { kind: 'save', value: next }
}

/** The status once a save has ended, by whether it worked and whether it had to wait. */
function settledStatus(
  variant: InlineEditVariant,
  ok: boolean,
  waited: boolean,
): InlineEditStatus {
  if (variant === 'actions') return ok ? 'closing' : 'idle'
  if (!ok) return 'failed'
  return waited ? 'saved' : 'idle'
}

/** What Quiet's field opens with: the text that failed, then the text being saved, then the value. */
function openingText(failed: string | null, pending: string | null, value: string) {
  return failed ?? pending ?? value
}

/**
 * Quiet's mark after the text: the spinner while it shows (it holds a moment
 * after a save ends), then the tick or the error.
 */
function inlineEditMark(
  status: InlineEditStatus,
  spinning: boolean,
): 'loading' | 'success' | 'error' | null {
  if (spinning) return 'loading'
  if (status === 'saved') return 'success'
  if (status === 'failed') return 'error'
  return null
}

export {
  InlineEdit,
  inlineEditBoxVariants,
  inlineEditMark,
  inlineEditOutcome,
  openingText,
  settledStatus,
}
export type { InlineEditOutcome, InlineEditStatus, InlineEditVariant }
