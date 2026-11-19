'use client'

import { mergeRefs } from '@/registry/lib/refs'
import {
  DEFAULT_FIELD_ROOT_STATE,
  DEFAULT_VALIDITY_STATE,
} from '@base-ui/react/internals/field-constants'
import { useRegisterFieldControl } from '@base-ui/react/internals/field-register-control'
import {
  FieldRootContext,
  type FieldRootContextType,
  useFieldRootContext,
} from '@base-ui/react/internals/field-root-context'
import { useFormContext } from '@base-ui/react/internals/form-context'
import {
  LabelableProvider,
  useLabelableContext,
  useLabelableId,
} from '@base-ui/react/internals/labelable-provider'
import {
  type ReactNode,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

/*
 * What a control that isn't an input needs to sit in a Field like one: a
 * press on the Field's label focuses it, and its values go with a form as
 * hidden inputs. The Listbox's and the Calendar's. A control that keeps its
 * value in one hidden input or textarea, as the Segment field and the Token
 * input do, takes `useFieldControl` for all of that and the Field's state.
 * One whose own input holds something else, as the File input's does,
 * takes `FieldWiring`.
 * `OutsideField` keeps a Base UI part inside a control from being taken as
 * the Field's control.
 */

/** Focuses the control with `focus` when its Field's label, by `labelId`, is pressed, as a label does for an input. */
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

/** Each of `values` as a hidden input under `name`, sent with the form, or with the form `form` names. */
function FieldValues({
  name,
  form,
  values,
}: {
  name: string | undefined
  form?: string
  values: readonly string[]
}) {
  if (!name) return null
  // By place: two values can be the same.
  return values.map((value, index) => (
    // oxlint-disable-next-line react/no-array-index-key -- the inputs hold no state, and two values may match
    <input key={index} type='hidden' name={name} form={form} value={value} />
  ))
}

/**
 * Wires a control Base UI's Field doesn't know into the Field around it, as
 * Field.Control does for an input: a field of segments, an editable text.
 * The control keeps its value in a hidden input or textarea, which takes
 * `hiddenProps` and is what the form and the browser's checks read; the
 * Field's label points at it by `id`, and it hands focus on.
 *
 * Call `edited` with the new value when the person changes it (never for a
 * value set from outside), `focused` and `left` when focus comes and goes.
 * The field validates after the render that puts the new value in the hidden
 * control, so a layout effect that sets its custom validity goes before this
 * hook.
 */
function useFieldControl<Value>({
  control,
  id,
  value,
  filled,
  disabled,
  name,
}: {
  /** The element the form focuses when the field fails its check. */
  control: RefObject<HTMLElement | null>
  /** The Field's labelable id, from `useLabelableId`. */
  id: string | undefined
  value: Value
  /** Whether the field holds anything: the Field's `data-filled`. */
  filled: boolean
  disabled: boolean
  /** The control's own `name` prop; the Field's name wins over it. */
  name: string | undefined
}) {
  const field = useFieldRootContext()
  const { clearErrors } = useFormContext()
  useRegisterFieldControl(control, id, value, undefined, !disabled, name)
  const { setFilled } = field
  useLayoutEffect(() => {
    setFilled(filled)
  }, [filled, setFilled])
  const validate = useRef<'change' | 'commit' | null>(null)
  useLayoutEffect(() => {
    const when = validate.current
    if (!when) return
    validate.current = null
    if (when === 'change') field.validation.change(value)
    else void field.validation.commit(value)
  })

  return {
    /** Whether the Field is invalid, or failed its last check (such as a required value left empty at submit). */
    invalid: field.invalid === true || field.state.valid === false,
    edited: (after: Value) => {
      clearErrors(field.name ?? name)
      field.setDirty(after !== field.validityData.initialValue)
      validate.current = 'change'
    },
    /** Checks the field again, after something outside its own edits changed what it holds or why it fails. */
    recheck: () => field.validation.change(value),
    focused: () => field.setFocused(true),
    left: () => {
      field.setTouched(true)
      field.setFocused(false)
      if (field.validationMode === 'onBlur') validate.current = 'commit'
    },
    /** Props for the hidden input or textarea; focus that reaches it goes to `onFocus`. */
    hiddenProps: (onFocus: () => void) => ({
      ...field.validation.getValidationProps(disabled, { onFocus }),
      ref: field.validation.inputRef,
    }),
  }
}

const noop = () => {}

/** What Base UI's parts read when they sit in no Field. */
const noField: FieldRootContextType = {
  invalid: undefined,
  name: undefined,
  validityData: {
    state: DEFAULT_VALIDITY_STATE,
    errors: [],
    error: '',
    value: '',
    initialValue: null,
  },
  setValidityData: noop,
  disabled: undefined,
  setTouched: noop,
  setDirty: noop,
  setFilled: noop,
  setFocused: noop,
  focusOwnerRef: { current: undefined },
  validationMode: 'onSubmit',
  shouldValidateOnChange: () => false,
  state: DEFAULT_FIELD_ROOT_STATE,
  registerFieldControl: noop,
  validation: {
    getValidationProps: (_disabled, props = {}) => props,
    inputRef: { current: null },
    registeredInputs: new Map(),
    registerInput: noop,
    getInputControl: () => null,
    commit: async () => {},
    change: noop,
  },
}

/**
 * Base UI parts inside a control that aren't its field's control, such as a
 * phone number's country picker: outside this, the Field would take them as
 * its control, point its label at them and send their value with its name.
 */
function OutsideField({ children }: { children: ReactNode }) {
  return (
    <FieldRootContext value={noField}>
      <LabelableProvider>{children}</LabelableProvider>
    </FieldRootContext>
  )
}

interface FieldWiringProps {
  /** Props for the input the Field's label and checks point at. */
  control: {
    id: string | undefined
    'aria-labelledby': string | undefined
    'aria-describedby': string | undefined
    /** Set while the field fails its check. */
    'aria-invalid': true | undefined
    ref: (node: HTMLInputElement | null) => void
  }
  /** Call with the new value when the person changes it. */
  edited: (value: unknown) => void
}

/**
 * Puts a value in the Field around it, as Field.Control does for an input,
 * for a control whose own input holds something else: what the form sends,
 * the label, the description and the checks all point at the input given
 * `control`. The File input's: its native input sits in an `OutsideField`,
 * and the field takes its files, or the ids their uploads gave back.
 */
function FieldWiring({
  value,
  filled,
  disabled,
  name,
  invalidMessage = '',
  children,
}: {
  /** What the form's values give the field. Each new value counts as the person's edit. */
  value: unknown
  filled: boolean
  disabled: boolean
  name: string | undefined
  /** Why the field fails its check, beyond what the input's own validity says; empty when it doesn't. */
  invalidMessage?: string
  children: (wiring: FieldWiringProps) => ReactNode
}) {
  const { labelId, getDescriptionProps } = useLabelableContext()
  const id = useLabelableId({ id: undefined })
  const [input, setInput] = useState<HTMLInputElement | null>(null)
  const control = useMemo(() => ({ current: input }), [input])
  // Before the field's own hook, so its checks read the message.
  useLayoutEffect(() => {
    input?.setCustomValidity(disabled ? '' : invalidMessage)
  }, [input, invalidMessage, disabled])
  const field = useFieldControl({ control, id, value, filled, disabled, name })
  const { edited, recheck } = field
  // A new value is the person's edit; a new reason to fail is checked again.
  const shown = useRef({ value, invalidMessage })
  useLayoutEffect(() => {
    const last = shown.current
    shown.current = { value, invalidMessage }
    if (disabled) return
    if (last.value !== value) edited(value)
    else if (last.invalidMessage !== invalidMessage) recheck()
  })
  const hidden = field.hiddenProps(() => {})
  const validityRef = hidden.ref as RefObject<HTMLInputElement | null>
  const ref = useMemo(() => mergeRefs(setInput, validityRef), [validityRef])
  return children({
    control: {
      id,
      'aria-labelledby': labelId,
      'aria-describedby': getDescriptionProps({})['aria-describedby'] as
        | string
        | undefined,
      'aria-invalid': field.invalid || undefined,
      ref,
    },
    edited,
  })
}

export { FieldValues, FieldWiring, OutsideField, useFieldControl, useLabelFocus }

export type { FieldWiringProps }
