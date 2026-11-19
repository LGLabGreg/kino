'use client'

import { labelClassName } from '@/registry/components/kino/label'
import { withoutTransition } from '@/registry/lib/resize'
import { settle } from '@/registry/lib/settle'
import { Field as FieldPrimitive } from '@base-ui/react/field'
import { Fieldset as FieldsetPrimitive } from '@base-ui/react/fieldset'
import { Form as FormPrimitive } from '@base-ui/react/form'
import {
  createContext,
  type ReactNode,
  useContext,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import { cn } from '@/lib/utils'

type FormValues = Record<string, unknown>

/** Where the form's last submit is: sent and waiting, done, or turned down. */
type FormStatus = 'idle' | 'saving' | 'saved' | 'failed'

interface FormSubmission {
  status: FormStatus
  /** The values the last successful submit sent, and how many have succeeded. */
  saved: { values: FormValues; count: number } | null
  /** Rises with each `reset`, and every Field remounts on it. */
  revision: number
  /** The form element's `id`, for a part outside it that submits it, such as the Save bar's Save. */
  formId: string
  /**
   * Puts every Field back to its default value. Keep each control's
   * `defaultValue` on what was last saved, so this discards only what changed
   * since.
   */
  reset: () => void
}

const FormSubmissionContext = createContext<FormSubmission | null>(null)

/** The Form's submit and reset, for a part that saves it, such as the Save bar; `null` outside a Form. */
function useFormSubmission() {
  return useContext(FormSubmissionContext)
}

/** What a server turned down, by field name: each field shows its message. */
type FormErrors = Record<string, string | string[]>

/** Whether what a submit gave back is errors by field, and holds at least one. */
function isFormErrors(value: unknown): value is FormErrors {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length > 0 &&
    Object.values(value).every(
      (message) =>
        typeof message === 'string' ||
        (Array.isArray(message) && message.every((line) => typeof line === 'string')),
    )
  )
}

/*
 * Base UI's Form, whose `onFormSubmit` may return a promise: the form is
 * saving until it settles, and a second submit meanwhile is ignored. What it
 * gives back may be errors by field, which the fields show as Base UI's
 * `errors` and the first takes focus, as a server turns down a value.
 */
function Form({
  onFormSubmit,
  errors,
  id: idProp,
  children,
  ...props
}: Omit<FormPrimitive.Props, 'onFormSubmit'> & {
  /** Runs with the form's values once every field is valid. A promise keeps the form saving until it settles; a rejection or a throw means it failed. Errors by field, such as `{ email: '…' }`, turn the submit down and show on those fields. */
  onFormSubmit?: (
    values: FormValues,
    details: FormPrimitive.SubmitEventDetails,
  ) => unknown
}) {
  const [refused, setRefused] = useState<FormErrors | null>(null)
  const [status, setStatus] = useState<FormStatus>('idle')
  const [saved, setSaved] = useState<FormSubmission['saved']>(null)
  const [revision, setRevision] = useState(0)
  const saving = useRef(false)
  const ownId = useId()
  const formId = idProp ?? ownId
  const submission = useMemo<FormSubmission>(
    () => ({
      status,
      saved,
      revision,
      formId,
      reset: () => {
        setRefused(null)
        setRevision((last) => last + 1)
        setStatus('idle')
      },
    }),
    [status, saved, revision, formId],
  )
  const submit = onFormSubmit
    ? (values: FormValues, details: FormPrimitive.SubmitEventDetails) => {
        if (saving.current) return
        saving.current = true
        setRefused(null)
        setStatus('saving')
        settle(
          () => onFormSubmit(values, details),
          (ok, _waited, reason, result) => {
            saving.current = false
            if (ok && isFormErrors(result)) {
              // Turned down: nothing was saved, and each field says why.
              setRefused({ ...result })
              setStatus('idle')
              return
            }
            setStatus(ok ? 'saved' : 'failed')
            if (ok) setSaved((last) => ({ values, count: (last?.count ?? 0) + 1 }))
            // The form shows that it failed; the reason still reaches the console and error tracking.
            else reportError(reason)
          },
        )
      }
    : undefined
  return (
    <FormPrimitive
      data-slot='form'
      id={formId}
      onFormSubmit={submit}
      errors={refused ?? errors}
      {...props}
    >
      <FormSubmissionContext value={submission}>{children}</FormSubmissionContext>
    </FormPrimitive>
  )
}

const InField = createContext(false)

/** Whether the part sits in a Field, where Base UI's Field parts may go. */
function useInField() {
  return useContext(InField)
}

/*
 * A field is a grid of rows: the label, the control, a detail row that is
 * empty unless a part such as a Password strength sits there, and a message
 * line under it, where the description and the error take turns. The error
 * rolls in as the description rolls out. A field with no description keeps
 * no line for an error: the line opens on `layout` as one arrives and closes
 * as it goes, so fields sit as close as their gap (Greg, 2026-11-17).
 */
function Field({
  className,
  ...props
}: Omit<FieldPrimitive.Root.Props, 'className'> & {
  className?: string
}) {
  const revision = useContext(FormSubmissionContext)?.revision ?? 0
  return (
    <InField value>
      <FieldPrimitive.Root
        // A Form's reset remounts it, so its control takes its default value again and Base UI its state.
        key={revision}
        data-slot='field'
        className={cn(
          "group/field grid min-w-0 grid-cols-1 content-start [grid-template-areas:'label'_'control'_'detail'_'message']",
          className,
        )}
        {...props}
      />
    </InField>
  )
}

function FieldLabel({
  className,
  ...props
}: Omit<FieldPrimitive.Label.Props, 'className'> & {
  className?: string
}) {
  return (
    <FieldPrimitive.Label
      data-slot='field-label'
      className={cn(labelClassName, 'w-fit pb-2 [grid-area:label]', className)}
      {...props}
    />
  )
}

function FieldDescription({
  className,
  ...props
}: Omit<FieldPrimitive.Description.Props, 'className'> & {
  className?: string
}) {
  return (
    <FieldPrimitive.Description
      data-slot='field-description'
      className={cn(
        // Once the message line measures itself, it sizes the row, and the
        // description only draws into it. It comes back after the error has
        // mostly gone, and leaves quickly when an error comes.
        'text-muted-foreground self-start pt-1.5 text-xs leading-5 transition-[opacity,translate] duration-(--motion-layout-duration) ease-(--motion-layout-easing) [grid-area:message] group-[:not(:has([data-slot=field-error]:not([data-ending-style])))]/field:delay-[calc(var(--motion-exit-duration)*0.35)] group-has-[[data-slot=field-error]:not([data-ending-style])]/field:pointer-events-none group-has-[[data-slot=field-error]:not([data-ending-style])]/field:opacity-0 group-has-[[data-slot=field-error]:not([data-ending-style])]/field:duration-[calc(var(--motion-exit-duration)*0.5)] group-has-[[data-slot=field-message][data-measured]]/field:h-0 motion-safe:group-has-[[data-slot=field-error]:not([data-ending-style])]/field:-translate-y-(--field-message-roll,0.5rem)',
        className,
      )}
      {...props}
    />
  )
}

/*
 * The message line is as tall as what it shows: the error while there is
 * one, otherwise the description, or nothing. It moves to a new height on
 * the `layout` role, so an error makes room smoothly. Kept
 * outside the component: the React Compiler can drop side effects written
 * inside one.
 */
function trackMessageHeight(message: HTMLElement) {
  const field = message.parentElement
  if (!field) return undefined
  const measure = () => {
    const shown =
      message.querySelector<HTMLElement>(
        '[data-slot=field-error]:not([data-ending-style])',
      ) ?? field.querySelector<HTMLElement>(':scope > [data-slot=field-description]')
    message.style.height = `${shown?.scrollHeight ?? 0}px`
  }

  // The first height is set at once, so nothing moves on first paint.
  withoutTransition(message, () => {
    measure()
    message.dataset.measured = ''
  })

  // Only what the line shows is watched: the error and the description, and
  // the field's own children coming and going. A control that changes as it
  // works, such as a list of uploads, never makes it measure.
  const texts = {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['data-ending-style'],
  }
  const watch = () => {
    mutations.disconnect()
    mutations.observe(field, { childList: true })
    mutations.observe(message, texts)
    const description = field.querySelector(':scope > [data-slot=field-description]')
    if (description) mutations.observe(description, texts)
  }
  const mutations = new MutationObserver(() => {
    watch()
    measure()
  })
  watch()
  let width = field.offsetWidth
  const sizes = new ResizeObserver(() => {
    if (field.offsetWidth === width) return
    width = field.offsetWidth
    measure()
  })
  sizes.observe(field)
  return () => {
    mutations.disconnect()
    sizes.disconnect()
    delete message.dataset.measured
  }
}

function FieldError({
  className,
  children,
  match,
  onTransitionEnd,
  ...props
}: Omit<FieldPrimitive.Error.Props, 'className'> & {
  /** Goes to the message line the error sits in. */
  className?: string
}) {
  // Base UI shows its own last message while an error leaves, so an error
  // given as children keeps its text until its exit has played.
  const given = children != null && children !== false && children !== ''
  const [last, setLast] = useState<ReactNode>(given ? children : null)
  if (given && children !== last) setLast(children)
  const text = given ? children : last

  const messageRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(
    () => (messageRef.current ? trackMessageHeight(messageRef.current) : undefined),
    [],
  )

  return (
    // Base UI doesn't announce errors: this region is there before the error
    // arrives, so a screen reader reads it out as it appears.
    <div
      ref={messageRef}
      data-slot='field-message'
      aria-live='polite'
      className={cn(
        'overflow-hidden text-xs leading-5 transition-[height] duration-(--motion-layout-duration) ease-(--motion-layout-easing) [grid-area:message] motion-reduce:transition-none',
        className,
      )}
    >
      <FieldPrimitive.Error
        data-slot='field-error'
        className='text-destructive pt-1.5 transition-[opacity,translate] duration-(--motion-layout-duration) ease-(--motion-layout-easing) not-data-ending-style:delay-[calc(var(--motion-exit-duration)*0.35)] data-ending-style:opacity-0 data-ending-style:duration-[calc(var(--motion-exit-duration)*0.5)] data-starting-style:opacity-0 motion-safe:data-ending-style:translate-y-(--field-message-roll,0.5rem) motion-safe:data-starting-style:translate-y-(--field-message-roll,0.5rem)'
        // An error given as children shows while it is given.
        match={match ?? (given ? true : undefined)}
        onTransitionEnd={(event) => {
          if (!given) setLast(null)
          onTransitionEnd?.(event)
        }}
        {...props}
        // Passing `children={undefined}` would hide Base UI's own message.
        {...(text != null ? { children: text } : {})}
      />
    </div>
  )
}

function FieldSet({
  className,
  ...props
}: Omit<FieldsetPrimitive.Root.Props, 'className'> & {
  className?: string
}) {
  return (
    <FieldsetPrimitive.Root
      data-slot='field-set'
      className={cn(
        'm-0 flex min-w-0 flex-col gap-(--surface-gap) border-0 p-0',
        className,
      )}
      {...props}
    />
  )
}

function FieldLegend({
  className,
  ...props
}: Omit<FieldsetPrimitive.Legend.Props, 'className'> & {
  className?: string
}) {
  return (
    <FieldsetPrimitive.Legend
      data-slot='field-legend'
      className={cn(
        'mb-1 text-base leading-6 font-medium data-disabled:opacity-50',
        className,
      )}
      {...props}
    />
  )
}

export {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  FieldLegend,
  FieldSet,
  Form,
  useFormSubmission,
  useInField,
}
export { isFormErrors }
export type { FormErrors, FormStatus, FormSubmission, FormValues }
