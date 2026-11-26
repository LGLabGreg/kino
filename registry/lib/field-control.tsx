'use client'

import { mergeRefs } from '@/registry/lib/refs'
import { useFieldControl } from '@ui-sdk/react/field'
import {
  createContext,
  type ReactNode,
  type Ref,
  type RefCallback,
  type RefObject,
  use,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
} from 'react'

/*
 * What a control that isn't one of ui-sdk's needs to sit in its Field like
 * one: a Base UI part, such as the Select's trigger, or a control of our own,
 * such as the Listbox. `useFieldProps` puts the Field's id, label,
 * description and check on the element its label names; `FieldCheck` gives
 * the Field a native input to check when the control keeps no value of its
 * own in one; `FieldValues` sends its values with the form; `useLabelFocus`
 * hands a press on the label to the part that takes focus.
 */

/** Whether the parts inside sit outside the Field around them. */
const OutsideContext = createContext(false)

/**
 * Parts inside a control that aren't its Field's control, such as a phone
 * number's country picker: outside this, they would take the Field's label,
 * description and name as the control does.
 */
function OutsideField({ children }: { children: ReactNode }) {
  return <OutsideContext value>{children}</OutsideContext>
}

/**
 * The Field around a control, from ui-sdk's `useFieldControl`: its name,
 * whether it is off, and `props` for its control. Null outside a Field, and
 * inside an `OutsideField`.
 */
function useField(own?: { id?: string }) {
  const outside = use(OutsideContext)
  const field = useFieldControl(own)
  return outside ? null : field
}

/** What a Field puts on the element its label names. */
interface FieldAttributes {
  id?: string
  'aria-labelledby'?: string
  'aria-describedby'?: string
  /** Set while the Field shows its check failing. */
  'aria-invalid'?: 'true'
}

/**
 * The Field around a control, and `props` with the Field's merged in for the
 * element its label names: the id, `aria-labelledby`, `aria-describedby` and
 * `aria-invalid` while its check fails, and its ref. `field` is null outside
 * a Field, with `props` as given; `invalid` says whether the Field shows its
 * control as invalid. A control whose component makes the id it renders
 * passes that id as `own`.
 */
function useFieldProps<P extends object>(props: P, own?: { id?: string }) {
  const field = useField(own)
  const { ref, ...rest } = props as P & { ref?: Ref<Element> }
  const merged = (field ? field.props(rest) : rest) as FieldAttributes & {
    ref?: Ref<Element>
    'data-slot'?: string
  }
  // ui-sdk hands back the slot it was given, undefined too, which would wipe a slot set before the spread.
  if (merged['data-slot'] === undefined) delete merged['data-slot']
  const fieldRef = merged.ref
  const refs = useMemo(() => mergeRefs(ref, fieldRef), [ref, fieldRef])
  return {
    field,
    invalid: merged['aria-invalid'] === 'true',
    props: { ...merged, ref: refs } as Omit<P, 'ref'> &
      FieldAttributes & { ref: RefCallback<RefTarget<P>> },
  }
}

/** The element a control's `ref` takes. */
type RefTarget<P> = P extends { ref?: Ref<infer E> } ? E : Element

/**
 * Whether a form's reset leaves a control as it is: a controlled one with no
 * default value, so its owner's state stays the only source of its value, as
 * ui-sdk's controls do. Any other goes back to its default value.
 */
function keptOnReset(value: unknown, defaultValue: unknown) {
  return value !== undefined && defaultValue === undefined
}

/**
 * Each of `values` as a hidden input under `name`, sent with the form, or with
 * the form `form` names.
 */
function FieldValues({
  name,
  form,
  values,
  many = false,
}: {
  name: string | undefined
  form?: string
  values: readonly string[]
  /** Whether the control takes several values, so a Form's values hold a list under `name` even with one. */
  many?: boolean
}) {
  if (!name) return null
  // By place: two values can be the same.
  return values.map((value, index) => (
    <input
      // oxlint-disable-next-line react/no-array-index-key -- the inputs hold no state, and two values may match
      key={index}
      type='hidden'
      name={name}
      form={form}
      value={value}
      data-many={many ? '' : undefined}
    />
  ))
}

/** The style ui-sdk gives the native input behind a checkbox: in the page, unseen and out of the way. */
const checkStyle = {
  position: 'absolute',
  width: 1,
  height: 1,
  margin: -1,
  padding: 0,
  border: 0,
  overflow: 'hidden',
  clipPath: 'inset(50%)',
  whiteSpace: 'nowrap',
  opacity: 0,
  pointerEvents: 'none',
} as const

/**
 * A native input, unseen, that holds a control's check for its Field and the
 * form: empty while the control is, so `required` turns an empty one down,
 * and failing with `message` while there is one. It sends nothing unless it
 * has a `name`. The form's own check focuses it when it fails, and it hands
 * focus to `onFocus`, the control's own part. Each change to `value` or
 * `message` tells the Field, as typing in an input does, so it checks again
 * and a server's error for it goes. A Field's `validate` checks it, and
 * `onReset` puts the control back when the form is reset.
 */
function FieldCheck({
  value,
  name,
  required,
  readOnly,
  message = '',
  disabled,
  form,
  onFocus,
  onReset,
  control,
}: {
  /** What the control holds, as text: empty while it holds nothing. */
  value: string
  name?: string
  required?: boolean
  readOnly?: boolean
  /** Why it fails, beyond `required`; empty while it passes. */
  message?: string
  disabled?: boolean
  form?: string
  onFocus: () => void
  /** Puts the control back to its default when its form is reset, as a native control goes back. */
  onReset?: (event: Event) => void
  /** The Field's props from `useFieldProps`, when this input is the element its label names. */
  control?: FieldAttributes & { ref?: Ref<HTMLInputElement> }
}) {
  const input = useRef<HTMLInputElement>(null)
  const controlRef = control?.ref
  const refs = useMemo(() => mergeRefs(input, controlRef), [controlRef])
  useFormReset(input, (event) => onReset?.(event), form)
  useLayoutEffect(() => {
    input.current?.setCustomValidity(disabled ? '' : message)
  }, [message, disabled])
  const told = useRef({ value, message })
  useEffect(() => {
    const last = told.current
    told.current = { value, message }
    if (last.value === value && last.message === message) return
    input.current?.dispatchEvent(new Event('input', { bubbles: true }))
  }, [value, message])
  return (
    <input
      {...control}
      ref={refs}
      // Its own message, which a Field's `validate` keeps ahead of its own.
      data-field-check={disabled ? '' : message}
      aria-hidden
      tabIndex={-1}
      name={name}
      form={form}
      value={value}
      required={required}
      readOnly={readOnly}
      disabled={disabled}
      // Its value comes from the control; nothing types into it.
      onChange={() => {}}
      onFocus={onFocus}
      style={checkStyle}
    />
  )
}

/**
 * Focuses the control with `focus` when its Field's label, by `labelId`, is
 * pressed, as a label does for an input, for a control whose focus goes to a
 * part inside it, such as a Calendar's day.
 */
function useLabelFocus(
  labelId: string | undefined,
  disabled: boolean,
  focus: () => void,
) {
  useEffect(() => {
    const label = labelId ? document.getElementById(labelId) : null
    if (!label || disabled) return
    label.addEventListener('click', focus)
    return () => label.removeEventListener('click', focus)
  }, [labelId, disabled, focus])
}

/**
 * Calls `reset` when the form around `element`, or the one `form` names, is
 * reset, so a control that keeps its value in its own state goes back to its
 * default as a native one does.
 */
function useFormReset(
  element: RefObject<Element | null>,
  reset: (event: Event) => void,
  form?: string,
) {
  const onReset = useEffectEvent(reset)
  useEffect(() => {
    const own = element.current
    const owner = form
      ? own?.ownerDocument.getElementById(form)
      : (own?.closest('form') ?? null)
    if (!owner) return
    const listener = (event: Event) => onReset(event)
    owner.addEventListener('reset', listener)
    return () => owner.removeEventListener('reset', listener)
  }, [element, form])
}

/** Focuses a radio group's picked radio, or its first one that can be picked, as a press on its label does. */
function focusPicked(group: HTMLElement | null) {
  const radio =
    group?.querySelector<HTMLElement>('[role=radio][aria-checked=true]') ??
    group?.querySelector<HTMLElement>('[role=radio]:not([data-disabled])')
  radio?.focus()
}

export {
  FieldCheck,
  FieldValues,
  focusPicked,
  keptOnReset,
  OutsideField,
  useField,
  useFieldProps,
  useFormReset,
  useLabelFocus,
}
