'use client'

import { labelClassName } from '@/registry/components/kino/label'
import { markMounted, mergeRefs } from '@/registry/lib/refs'
import { withoutTransition } from '@/registry/lib/resize'
import { settle } from '@/registry/lib/settle'
import {
  Field as FieldPrimitive,
  FieldDescription as FieldDescriptionPrimitive,
  FieldError as FieldErrorPrimitive,
  FieldGroup as FieldGroupPrimitive,
  FieldLabel as FieldLabelPrimitive,
  FieldLegend as FieldLegendPrimitive,
  FieldSet as FieldSetPrimitive,
} from '@ui-sdk/react/field'
import {
  type ComponentProps,
  createContext,
  type SubmitEvent,
  type RefObject,
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

/** What a form sends, by name: one entry's value, or every value when a name has several. */
type FormValues = Record<string, FormDataEntryValue | FormDataEntryValue[]>

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
  /** The form element, for a part that reads what it holds, such as the Save bar. */
  formRef: RefObject<HTMLFormElement | null>
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

/** The errors a Field shows from its Form, and how a Field takes its own back once it is edited. */
const FormErrorsContext = createContext<{
  errors: FormErrors | undefined
  clear: (name: string) => void
} | null>(null)

/**
 * Whether `name` takes a list in `form`, whatever it holds now: several
 * controls send under it (radios aside, which send one), or one that sends
 * several, such as a multiple select or a control's list of values.
 */
function takesMany(form: HTMLFormElement, name: string) {
  const controls = [...form.elements].filter(
    (control) => control.getAttribute('name') === name,
  )
  if (
    controls.some((control) =>
      control.matches('select[multiple], input[multiple], [data-many]'),
    )
  )
    return true
  return controls.filter((control) => !control.matches('input[type=radio]')).length > 1
}

/**
 * What `form` sends, by name: a name that takes a list gives every value it
 * sends, even one, and any other its value.
 */
function formValues(form: HTMLFormElement, data = new FormData(form)): FormValues {
  const values: FormValues = {}
  for (const name of new Set(data.keys())) {
    const all = data.getAll(name)
    values[name] = all.length === 1 && !takesMany(form, name) ? all[0] : all
  }
  return values
}

/*
 * A native form, as ui-sdk's forms are: the browser checks each control
 * before a submit, and its Fields show why one fails. `onFormSubmit` takes
 * what the form sends and may return a promise: the form is saving until it
 * settles, and a second submit meanwhile is ignored. What it gives back may
 * be errors by field, which those fields show, and the first takes focus, as
 * a server turns down a value.
 */
function Form({
  onFormSubmit,
  onSubmit,
  errors,
  id: idProp,
  ref,
  children,
  ...props
}: ComponentProps<'form'> & {
  /** Runs with the form's values once every field is valid. A promise keeps the form saving until it settles; a rejection or a throw means it failed. Errors by field, such as `{ email: '…' }`, turn the submit down and show on those fields. */
  onFormSubmit?: (values: FormValues, event: SubmitEvent<HTMLFormElement>) => unknown
  /** Errors by field, such as a server's, shown on those fields until each is edited. */
  errors?: FormErrors
}) {
  const [refused, setRefused] = useState<FormErrors | null>(null)
  const [cleared, setCleared] = useState<ReadonlySet<string>>(() => new Set())
  const [status, setStatus] = useState<FormStatus>('idle')
  const [saved, setSaved] = useState<FormSubmission['saved']>(null)
  const [revision, setRevision] = useState(0)
  const saving = useRef(false)
  const formRef = useRef<HTMLFormElement>(null)
  const ownId = useId()
  const formId = idProp ?? ownId
  const submission = useMemo<FormSubmission>(
    () => ({
      status,
      saved,
      revision,
      formId,
      formRef,
      reset: () => {
        setRefused(null)
        setRevision((last) => last + 1)
        setStatus('idle')
      },
    }),
    [status, saved, revision, formId],
  )

  // Errors given from outside show until a field is edited, and again when new ones come.
  const [given, setGiven] = useState(errors)
  if (errors !== given) {
    setGiven(errors)
    setCleared(new Set())
  }
  const shown = refused ?? errors
  const fieldErrors = useMemo(
    () => ({
      errors: shown
        ? Object.fromEntries(Object.entries(shown).filter(([name]) => !cleared.has(name)))
        : undefined,
      clear: (name: string) =>
        setCleared((last) => (last.has(name) ? last : new Set(last).add(name))),
    }),
    [shown, cleared],
  )

  // The first field a submit turned down takes focus, as one the browser turns down does.
  useEffect(() => {
    if (!refused) return
    formRef.current?.querySelector<HTMLElement>('[aria-invalid=true]')?.focus()
  }, [refused])

  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    onSubmit?.(event)
    if (!onFormSubmit || event.defaultPrevented) return
    event.preventDefault()
    if (saving.current) return
    const values = formValues(event.currentTarget)
    saving.current = true
    setRefused(null)
    setCleared(new Set())
    setStatus('saving')
    settle(
      () => onFormSubmit(values, event),
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
  const refs = useMemo(() => mergeRefs(formRef, ref), [ref])

  return (
    <form data-slot='form' id={formId} ref={refs} onSubmit={submit} {...props}>
      <FormSubmissionContext value={submission}>
        <FormErrorsContext value={fieldErrors}>{children}</FormErrorsContext>
      </FormSubmissionContext>
    </form>
  )
}

/** The message a Field's Form gives it, from errors by field, for its FieldError to show. */
const RefusedContext = createContext<string | null>(null)

/**
 * The control a Field checks, outside any Field inside it: the input that
 * holds a control's check (`FieldCheck`), or else its first native control.
 */
function checkedControl(field: HTMLElement) {
  const own = (control: Element) => control.closest('[data-slot=field]') === field
  return (
    [
      ...field.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
        '[data-field-check]',
      ),
    ].find(own) ??
    [
      ...field.querySelectorAll<
        HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
      >('input:not([type=hidden]), select, textarea'),
    ].find(own)
  )
}

/**
 * What a Field's controls send, outside any Field inside it: the value of the
 * input that holds a control's check, or else every native control's, with
 * a checkbox or radio only while it is on.
 */
function sentValues(field: HTMLElement) {
  const own = (control: Element) => control.closest('[data-slot=field]') === field
  const check = [...field.querySelectorAll<HTMLInputElement>('[data-field-check]')].find(
    own,
  )
  if (check) return check.value === '' ? [] : [check.value]
  return [
    ...field.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
      'input:not([type=hidden]), select, textarea',
    ),
  ]
    .filter(own)
    .filter(
      (control) =>
        !(control instanceof HTMLInputElement) ||
        (control.type !== 'checkbox' && control.type !== 'radio') ||
        control.checked,
    )
    .map((control) => control.value)
}

/**
 * Sets the control's check: a control's own message, as a Phone input's for
 * a number it can't read, first, then what `validate` says of its values.
 */
function runCheck(
  field: HTMLElement,
  validate: (value: string, values: string[]) => string | null | undefined,
) {
  const control = checkedControl(field)
  if (!control) return
  const values = sentValues(field)
  control.setCustomValidity(
    control.dataset.fieldCheck || (validate(values[0] ?? '', values) ?? ''),
  )
  // Chrome reads a failing check as invalid; until the Field shows it, the control says it isn't.
  if (control.getAttribute('aria-invalid') !== 'true')
    control.setAttribute('aria-invalid', 'false')
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
  name,
  invalid,
  validate,
  ref,
  ...props
}: Omit<ComponentProps<typeof FieldPrimitive>, 'className'> & {
  className?: string
  /**
   * Checks the control's value, as the browser checks `required`: a message
   * turns it down, and `null` passes. It shows once a submit has tried, and
   * follows the value from then on. `value` is what the control sends, empty
   * while it sends nothing; `values` is every value it sends, such as each
   * box ticked in a Checkbox group.
   */
  validate?: (value: string, values: string[]) => string | null | undefined
}) {
  const revision = useContext(FormSubmissionContext)?.revision ?? 0
  const formErrors = useContext(FormErrorsContext)
  const given = name ? formErrors?.errors?.[name] : undefined
  const refused = Array.isArray(given) ? given.join(' ') : (given ?? null)

  // The check runs before the browser reads the control's validity: on each
  // edit, ahead of the Field's own listener, and after each render, so a
  // check that reads other state is up to date when the form submits.
  const root = useRef<HTMLDivElement>(null)
  const check = useRef(validate)
  const clear = useRef(() => {})
  useLayoutEffect(() => {
    check.current = validate
    clear.current = () => {
      if (name && refused) formErrors?.clear(name)
    }
    if (root.current && validate) runCheck(root.current, validate)
  })
  // On the element a Form's reset remounts too, by `revision`.
  useEffect(() => {
    const field = root.current
    if (!field) return undefined
    const onEdit = () => {
      clear.current()
      if (check.current) runCheck(field, check.current)
    }
    field.addEventListener('input', onEdit, true)
    field.addEventListener('change', onEdit, true)
    return () => {
      field.removeEventListener('input', onEdit, true)
      field.removeEventListener('change', onEdit, true)
    }
  }, [revision])
  const refs = useMemo(() => mergeRefs(root, ref), [ref])

  return (
    <RefusedContext value={refused}>
      <FieldPrimitive
        // A Form's reset remounts it, so its control takes its default value again.
        key={revision}
        ref={refs}
        name={name}
        invalid={refused ? true : invalid}
        className={cn(
          "group/field grid min-w-0 grid-cols-1 content-start [grid-template-areas:'label'_'control'_'detail'_'message']",
          className,
        )}
        {...props}
      />
    </RefusedContext>
  )
}

function FieldLabel({
  className,
  ...props
}: Omit<ComponentProps<typeof FieldLabelPrimitive>, 'className'> & {
  className?: string
}) {
  return (
    <FieldLabelPrimitive
      className={cn(labelClassName, 'w-fit pb-2 [grid-area:label]', className)}
      {...props}
    />
  )
}

function FieldDescription({
  className,
  ...props
}: Omit<ComponentProps<typeof FieldDescriptionPrimitive>, 'className'> & {
  className?: string
}) {
  return (
    <FieldDescriptionPrimitive
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

/** The error's look, and how it rolls out: the copy that plays its exit has only this. */
const fieldErrorExitClassName =
  'text-destructive pt-1.5 transition-[opacity,translate] duration-(--motion-layout-duration) ease-(--motion-layout-easing) not-data-ending-style:delay-[calc(var(--motion-exit-duration)*0.35)] data-ending-style:opacity-0 data-ending-style:duration-[calc(var(--motion-exit-duration)*0.5)] motion-safe:data-ending-style:translate-y-(--field-message-roll,0.5rem)'

/** The error's look, and how it rolls in and out; one already there when the page loads is simply there. */
const fieldErrorClassName = cn(
  fieldErrorExitClassName,
  'group-data-mounted/field-message:starting:opacity-0 motion-safe:group-data-mounted/field-message:starting:translate-y-(--field-message-roll,0.5rem)',
)

/**
 * Plays a leaving error's exit on its copy: the copy arrives where the error
 * was, even halfway in, and then takes its ending style, so the move turns
 * back from there.
 * Calls `done` at once when there is nothing to play: no exit runs, or the
 * same error is still shown, as when React's StrictMode remounts it.
 */
function playExit(copy: HTMLElement, done: () => void) {
  const shown = [
    ...(copy.parentElement?.querySelectorAll('[data-slot=field-error]') ?? []),
  ].some(
    (error) =>
      error !== copy &&
      !error.hasAttribute('data-ending-style') &&
      error.textContent === copy.textContent,
  )
  if (shown) return done()
  // Reading its style commits the look it arrives with, for the exit to start from.
  void getComputedStyle(copy).opacity
  copy.style.removeProperty('opacity')
  copy.style.removeProperty('translate')
  copy.setAttribute('data-ending-style', '')
  if (copy.getAnimations().length === 0) done()
}

/** Where a leaving error was, for its copy to start from. */
type ErrorLook = { text: string; opacity: string; translate: string }

/** The error while ui-sdk shows it: as it goes, it hands its words and its look to the copy that plays its exit. */
function ShownError({
  ref,
  onLeave,
  ...props
}: ComponentProps<'div'> & { onLeave: (look: ErrorLook) => void }) {
  const own = useRef<HTMLDivElement>(null)
  const leave = useRef(onLeave)
  useLayoutEffect(() => {
    leave.current = onLeave
  })
  useLayoutEffect(() => {
    const element = own.current
    return () => {
      // Still in the page here, so its style is where its move had got to.
      const style = element?.isConnected ? getComputedStyle(element) : null
      leave.current({
        text: element?.textContent ?? '',
        opacity: style?.opacity ?? '1',
        translate: style?.translate ?? 'none',
      })
    }
  }, [])
  const refs = useMemo(() => mergeRefs(own, ref), [ref])
  return <div ref={refs} {...props} />
}

function FieldError({
  className,
  children,
  match,
  ...props
}: Omit<ComponentProps<typeof FieldErrorPrimitive>, 'className'> & {
  /** Goes to the message line the error sits in. */
  className?: string
}) {
  const refused = useContext(RefusedContext)
  const text = refused ?? children
  // An error given as children shows while it is given.
  const given = text != null && text !== false && text !== ''

  // ui-sdk takes an error out of the page as it goes; a copy of its words,
  // hidden from screen readers, plays its way out in its place.
  const [leaving, setLeaving] = useState<(ErrorLook & { key: number }) | null>(null)
  const leaves = useRef(0)

  const messageRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(
    () => (messageRef.current ? trackMessageHeight(messageRef.current) : undefined),
    [],
  )
  const lineRef = useMemo(() => mergeRefs(messageRef, markMounted), [])
  const leaveRef = useCallback((copy: HTMLDivElement | null) => {
    if (copy) playExit(copy, () => setLeaving(null))
  }, [])

  return (
    <div
      ref={lineRef}
      data-slot='field-message'
      // There before an error arrives, so a screen reader reads it out as it does.
      aria-live='polite'
      className={cn(
        'group/field-message grid items-start overflow-hidden text-xs leading-5 transition-[height] duration-(--motion-layout-duration) ease-(--motion-layout-easing) [grid-area:message] *:[grid-area:1/1] motion-reduce:transition-none',
        className,
      )}
    >
      {leaving ? (
        <div
          key={leaving.key}
          ref={leaveRef}
          aria-hidden
          data-slot='field-error'
          className={cn(fieldErrorExitClassName, 'pointer-events-none')}
          style={{ opacity: leaving.opacity, translate: leaving.translate }}
          onTransitionEnd={(event) => {
            if (event.target === event.currentTarget) setLeaving(null)
          }}
        >
          {leaving.text}
        </div>
      ) : null}
      <FieldErrorPrimitive
        match={match ?? (given ? true : undefined)}
        className={fieldErrorClassName}
        render={(errorProps) => (
          <ShownError
            {...errorProps}
            onLeave={(look) => {
              // One that never showed, still waiting to come in, just goes.
              if (!look.text || Number(look.opacity) < 0.05) return
              if (!messageRef.current?.isConnected) return
              leaves.current += 1
              setLeaving({ ...look, key: leaves.current })
            }}
          />
        )}
        {...props}
        // Without children, ui-sdk shows the browser's own message.
        {...(given ? { children: text } : {})}
      />
    </div>
  )
}

function FieldSet({
  className,
  ...props
}: Omit<ComponentProps<typeof FieldSetPrimitive>, 'className'> & {
  className?: string
}) {
  return (
    <FieldSetPrimitive
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
}: Omit<ComponentProps<typeof FieldLegendPrimitive>, 'className'> & {
  className?: string
}) {
  return (
    <FieldLegendPrimitive
      className={cn(
        'mb-1 text-base leading-6 font-medium data-disabled:opacity-50',
        className,
      )}
      {...props}
    />
  )
}

/** Stacks the fields of a set at the surface's gap; the set is what names and disables them. */
function FieldGroup({
  className,
  ...props
}: Omit<ComponentProps<typeof FieldGroupPrimitive>, 'className'> & {
  className?: string
}) {
  return (
    <FieldGroupPrimitive
      className={cn('flex min-w-0 flex-col gap-(--surface-gap)', className)}
      {...props}
    />
  )
}

export {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
  Form,
  useFormSubmission,
}
export { formValues, isFormErrors }
export type { FormErrors, FormStatus, FormSubmission, FormValues }
