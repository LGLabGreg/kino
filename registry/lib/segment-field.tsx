'use client'

import { useFieldControl } from '@/registry/lib/field-control'
import { mergeRefs } from '@/registry/lib/refs'
import {
  awaitsDigit,
  deleteDigit,
  digitValue,
  DIGITS,
  type Entry,
  type Fields,
  type SegmentScheme,
  type SegmentType,
  segmentName,
  segmentRange,
  segmentText,
  segmentTrend,
  segmentTrends,
  STEPS,
  stepSegment,
  typeDigit,
  valueTrend,
} from '@/registry/lib/segments'
import { useFieldRootContext } from '@base-ui/react/internals/field-root-context'
import {
  useAriaLabelledBy,
  useLabelableContext,
  useLabelableId,
} from '@base-ui/react/internals/labelable-provider'
import {
  type ClipboardEvent,
  type ComponentProps,
  type CSSProperties,
  type FocusEvent,
  type KeyboardEvent,
  type Ref,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

/*
 * A value typed one segment at a time (a date, a time), wired into Base
 * UI's Field as its own segmented field, the code field, is: the label
 * names it and focuses its first segment, the field shows it invalid,
 * filled and focused, and a hidden input posts the value and takes part in
 * the form's validation. Each segment is an `<input>` with the spinbutton
 * role, so a phone shows its number pad. What the value is comes from its
 * scheme (`dateScheme`, `timeScheme`); what it looks like is the
 * component's: this gives it the segments' props and which way each last
 * changed.
 */

export interface Segment {
  type: SegmentType
  /** Shown before the rest of the row, though it comes after it for typing and reading. */
  lead?: boolean
  /** What the segment shows: its digits, its name (Nov, PM), or nothing when empty. */
  text: string
  placeholder: string
  /**
   * What the segment shows at its widest, to stack invisibly under it, so
   * typing never moves what follows: its digits, or every name. The
   * placeholder isn't one: it sits over that width, in the segment's padding
   * where it is wider.
   */
  sizes: string[]
  /** Which way its value last moved: 1 up, -1 down; a step goes the way it was asked, so December stepped up to January is 1. */
  trend: 1 | -1
  /** Spread on the segment's `<input>`. */
  inputProps: SegmentInputProps
}

export type SegmentFieldPart = Segment | { type: 'literal'; text: string; lead?: boolean }

export interface SegmentInputProps {
  id: string
  value: string
  ref: (node: HTMLInputElement | null) => void
  role: 'spinbutton'
  inputMode: 'numeric' | 'text'
  autoComplete: 'off'
  autoCorrect: 'off'
  spellCheck: false
  disabled: boolean | undefined
  readOnly: boolean | undefined
  'aria-labelledby': string
  'aria-valuenow': number | undefined
  'aria-valuetext': string
  'aria-valuemin': number
  'aria-valuemax': number
  'aria-invalid': true | undefined
  'aria-describedby': string | undefined
  'aria-readonly': true | undefined
  'aria-required': true | undefined
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void
  onChange: () => void
  onPaste: (event: ClipboardEvent<HTMLInputElement>) => void
  onFocus: (event: FocusEvent<HTMLInputElement>) => void
  onBlur: (event: FocusEvent<HTMLInputElement>) => void
}

export interface UseSegmentsProps {
  /** The value in the scheme's form (`yyyy-mm-dd`, `HH:mm`), or null when it is empty. */
  value?: string | null
  defaultValue?: string | null
  /**
   * Called with the value once every segment holds one that exists, and
   * with null once every segment is empty. A value half typed calls
   * nothing, so the one it had stays until the new one is whole.
   */
  onValueChange?: (value: string | null) => void
  name?: string
  form?: string
  required?: boolean
  disabled?: boolean
  readOnly?: boolean
  id?: string
  'aria-label'?: string
  'aria-labelledby'?: string
  'aria-describedby'?: string
  /** Shows the field invalid for a reason of the caller's, such as a day that can't be picked. */
  invalid?: boolean
  /** Why the value fails the form's check, beside min and max, which the field reports itself; empty when it passes. */
  customError?: string
  /**
   * What the Field holds and the form's submit handler gets, in place of the
   * field's own value: a range's start field holds the whole range.
   */
  fieldValue?: unknown
}

const SEGMENT_PROP_NAMES = [
  'value',
  'defaultValue',
  'onValueChange',
  'name',
  'form',
  'required',
  'disabled',
  'readOnly',
  'id',
  'aria-label',
  'aria-labelledby',
  'aria-describedby',
  'invalid',
  'customError',
  'fieldValue',
] as const satisfies readonly (keyof UseSegmentsProps)[]

/**
 * Splits a component's props into the field's and the rest, which go on the
 * element around the segments: a ref, a style, a handler, a data attribute.
 */
export function splitSegmentProps<Props extends UseSegmentsProps>(
  props: Props,
): [UseSegmentsProps, Omit<Props, keyof UseSegmentsProps>] {
  const own: Record<string, unknown> = {}
  const rest = { ...props } as Record<string, unknown>
  for (const key of SEGMENT_PROP_NAMES) {
    if (key in rest) {
      own[key] = rest[key]
      delete rest[key]
    }
  }
  return [own as UseSegmentsProps, rest as Omit<Props, keyof UseSegmentsProps>]
}

/**
 * The props of a component drawn on the segments: the field's, its own
 * (`Own`: a date's locale and min, a time's clock), and the element's
 * around them.
 */
export type SegmentsComponentProps<Own = object> = UseSegmentsProps &
  Own &
  Omit<ComponentProps<'div'>, keyof UseSegmentsProps | keyof Own | 'children'> & {
    ref?: Ref<HTMLDivElement>
  }

const SEPARATORS = new Set(['/', '.', '-', ',', ' ', ':'])

const visuallyHidden: CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  margin: -1,
  padding: 0,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
  border: 0,
}

interface SegmentsState {
  fields: Fields
  /** What each segment holds while typed into; cleared when the segment is left. */
  texts: Partial<Record<SegmentType, string>>
  trends: Partial<Record<SegmentType, 1 | -1>>
  /** The value given last, or emitted last, so a new one from outside resets the segments. */
  source: string | null
  /** The scheme the fields were read on, so a new clock or locale reads them again. */
  scheme: SegmentScheme
}

/**
 * The value the segments add up to. One still being typed (a year of 20 on
 * the way to 2026, an hour of 1 on the way to 10) isn't one yet, so it
 * neither counts as a value nor sets off min and max.
 */
function settled(scheme: SegmentScheme, state: SegmentsState): string | null {
  const typing = Object.entries(state.texts).some(
    ([type, text]) =>
      text && awaitsDigit(type as SegmentType, text, state.fields, scheme.hourCycle),
  )
  return typing ? null : scheme.toValue(state.fields)
}

/** The field's props and behaviour for `scheme`, which must stay the same object between renders (`useMemo`) until what it describes changes. */
export function useSegments(scheme: SegmentScheme, props: UseSegmentsProps) {
  const {
    value: valueProp,
    defaultValue = null,
    onValueChange,
    name: nameProp,
    form,
    required,
    disabled: disabledProp,
    readOnly,
    id: idProp,
    invalid: invalidProp,
    customError = '',
  } = props
  const field = useFieldRootContext()
  const { labelId, getDescriptionProps } = useLabelableContext()
  const disabled = field.disabled || disabledProp
  const name = field.name ?? nameProp

  const { layout, locale, hourCycle } = scheme
  const order = useMemo(
    () => layout.flatMap((part) => (part.type === 'literal' ? [] : [part.type])),
    [layout],
  )
  // Left to right as the row shows them: a leading AM or PM first.
  const onScreen = useMemo(
    () => [
      ...order.filter((type) => layout.some((part) => part.type === type && part.lead)),
      ...order.filter((type) => layout.some((part) => part.type === type && !part.lead)),
    ],
    [order, layout],
  )
  const segmentNames = useMemo(
    () => new Map(order.map((type) => [type, segmentName(type, locale)])),
    [order, locale],
  )

  const controlled = valueProp !== undefined
  const given = controlled ? valueProp : defaultValue
  const [state, setState] = useState<SegmentsState>(() => ({
    fields: scheme.fromValue(given),
    texts: {},
    trends: Object.fromEntries(order.map((type) => [type, 1])),
    source: given,
    scheme,
  }))
  // A new scheme (another clock, locale or granularity) shows the same value on its own segments.
  if (scheme !== state.scheme) {
    const held = controlled ? valueProp : (settled(state.scheme, state) ?? state.source)
    setState({
      fields: scheme.fromValue(held),
      texts: {},
      trends: Object.fromEntries(order.map((type) => [type, 1])),
      source: controlled ? valueProp : held,
      scheme,
    })
  }
  // A value from outside that isn't the one shown moves every segment to it.
  else if (controlled && valueProp !== state.source) {
    const fields = scheme.fromValue(valueProp)
    setState({
      fields,
      texts: {},
      trends: segmentTrends(
        state.fields,
        fields,
        state.trends,
        valueTrend(scheme.toValue(state.fields), scheme.toValue(fields)),
      ),
      source: valueProp,
      scheme,
    })
  }
  // The segment typing moved on to by itself: a separator typed next (the colon
  // after 9 in 9:45) only confirms that move, and doesn't move again.
  const arrived = useRef<SegmentType | null>(null)
  // The handlers read the segments as they are now, even between a write and the render it starts.
  const latest = useRef(state)
  useLayoutEffect(() => {
    latest.current = state
  })

  const [focused, setFocused] = useState<SegmentType | null>(null)
  const inputs = useRef(new Map<SegmentType, HTMLInputElement>())
  const firstInput = useMemo(
    () => ({
      get current() {
        return inputs.current.get(order[0]) ?? null
      },
    }),
    [order],
  )

  const id = useLabelableId({ id: idProp })
  const ownId = useId()
  const baseId = id ?? ownId
  const groupLabelledBy = useAriaLabelledBy(
    props['aria-labelledby'],
    labelId,
    firstInput,
    true,
    id,
    props['aria-label'],
  )
  const describedBy =
    [props['aria-describedby'], getDescriptionProps({})['aria-describedby']]
      .filter(Boolean)
      .join(' ') || undefined

  const value = settled(scheme, state)
  const filled = Object.values(state.fields).some((part) => part != null)
  const complete = order.every((type) => state.fields[type] != null)
  const impossible = complete && scheme.toValue(state.fields) === null
  // A day that doesn't exist (31 February) shows once the field is left, by when it has moved to the month's last.
  // A value that doesn't exist or falls outside min and max fails the form's
  // validation, as a native date or time input's would.
  const rangeError =
    scheme.outOfRange(value) || impossible ? scheme.rangeMessage : customError
  const hiddenRef = useRef<HTMLInputElement>(null)
  useLayoutEffect(() => {
    hiddenRef.current?.setCustomValidity(rangeError)
  }, [rangeError])
  const fieldValue = 'fieldValue' in props ? props.fieldValue : value
  // After the custom validity above, so the field validates once the hidden input holds the new date and its validity.
  const control = useFieldControl({
    control: firstInput,
    id,
    value: fieldValue,
    filled,
    disabled: Boolean(disabled),
    name: nameProp,
  })
  // A range's other end, typed in its own field, changes what this one holds and whether it passes.
  const checked = useRef<{ error: string; value: unknown } | null>(null)
  useLayoutEffect(() => {
    const before = checked.current
    checked.current = { error: rangeError, value: fieldValue }
    if (before && (before.error !== rangeError || before.value !== fieldValue))
      control.recheck()
  })
  const invalid =
    control.invalid ||
    Boolean(invalidProp) ||
    scheme.outOfRange(value) ||
    (impossible && focused === null)

  /**
   * Writes new segments and tells the field when the value changed, and the
   * caller once it is whole again or wholly empty.
   */
  const commit = (next: SegmentsState) => {
    const before = settled(scheme, latest.current)
    const after = settled(scheme, next)
    const empty = Object.values(next.fields).every((part) => part == null)
    const tells = after !== before && (after !== null || empty) && after !== next.source
    const written = tells ? { ...next, source: after } : next
    latest.current = written
    setState(written)
    if (after !== before) control.edited(after)
    if (tells) onValueChange?.(after)
  }

  const setSegment = (type: SegmentType, entry: Entry, trend?: 1 | -1) => {
    if (arrived.current === type) arrived.current = null
    const current = latest.current
    if (
      (current.fields[type] ?? null) === entry.value &&
      (current.texts[type] ?? '') === entry.text
    )
      return
    commit({
      ...current,
      fields: { ...current.fields, [type]: entry.value },
      texts: { ...current.texts, [type]: entry.text },
      trends: {
        ...current.trends,
        [type]: trend ?? segmentTrend(current.fields[type] ?? null, entry.value),
      },
    })
  }

  /** Focuses the segment `by` places on, in the order typing goes, or on screen (`seen`) for the arrow keys. */
  const move = (type: SegmentType, by: number, seen = false) => {
    const along = seen ? onScreen : order
    const next = along[along.indexOf(type) + by]
    const input = next ? inputs.current.get(next) : undefined
    input?.focus()
    return input !== undefined
  }

  /** A segment that is left keeps its value, with leading zeros: a short year becomes the year it means. */
  const leave = (type: SegmentType) => {
    const current = latest.current
    const text = current.texts[type]
    if (!text) return
    const kept = scheme.leave(type, text)
    if (kept !== undefined) {
      setSegment(type, { text: '', value: kept })
      return
    }
    commit({ ...current, texts: { ...current.texts, [type]: '' } })
  }

  const fill = (fields: Fields) => {
    const current = latest.current
    commit({
      ...current,
      fields,
      texts: {},
      trends: segmentTrends(
        current.fields,
        fields,
        current.trends,
        valueTrend(scheme.toValue(current.fields), scheme.toValue(fields)),
      ),
    })
  }

  const step = (type: SegmentType, delta: number) => {
    const fields = latest.current.fields
    const from = scheme.now()[type] ?? segmentRange(type, fields, hourCycle).min
    const value = stepSegment(type, fields[type] ?? null, delta, fields, from, hourCycle)
    setSegment(type, { text: '', value }, delta > 0 ? 1 : -1)
  }

  /** Backspace takes the segment's last digit, and on an empty one goes back a segment. A name goes at once. */
  const backspace = (type: SegmentType) => {
    const current = latest.current
    const held = current.fields[type] ?? null
    const text = current.texts[type] || (held === null ? '' : String(held))
    if (!text) move(type, -1)
    else if (scheme.names[type]) clear(type)
    else
      setSegment(
        type,
        deleteDigit(text, segmentRange(type, current.fields, hourCycle).min),
      )
  }

  const clear = (type: SegmentType) => setSegment(type, { text: '', value: null })

  /** A separator moves on from a segment that holds something; returns whether it did. */
  const separate = (type: SegmentType) => {
    if (arrived.current === type) {
      arrived.current = null
      return false
    }
    const current = latest.current
    if (!current.texts[type] && current.fields[type] == null) return false
    leave(type)
    return move(type, 1)
  }

  const onKeyDown = (type: SegmentType) => (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return
    const editable = !readOnly && !disabled
    const range = segmentRange(type, latest.current.fields, hourCycle)
    const key = event.key
    const handled = () => event.preventDefault()
    if (key === 'ArrowLeft' || key === 'ArrowRight') {
      // The arrows follow the screen: in a row that reads right to left, left is the next segment.
      const rtl = getComputedStyle(event.currentTarget).direction === 'rtl'
      move(type, (key === 'ArrowRight') === rtl ? -1 : 1, true)
      handled()
    } else if (!editable) {
      return
    } else if (key === 'ArrowUp' || key === 'ArrowDown') {
      step(type, (key === 'ArrowUp' ? 1 : -1) * STEPS.arrow[type])
      handled()
    } else if (key === 'PageUp' || key === 'PageDown') {
      step(type, (key === 'PageUp' ? 1 : -1) * STEPS.page[type])
      handled()
    } else if (key === 'Home' || key === 'End') {
      setSegment(type, { text: '', value: key === 'Home' ? range.min : range.max })
      handled()
    } else if (key === 'Backspace') {
      backspace(type)
      handled()
    } else if (key === 'Delete') {
      clear(type)
      handled()
    } else if (SEPARATORS.has(key)) {
      separate(type)
      handled()
    }
  }

  // Every edit arrives here, from a keyboard or a phone's, before the input
  // changes: typed characters and deletions, which a phone's keyboard sends
  // without a Backspace key. Several characters can come at once (a
  // suggestion, dictation), and they run on into the next segments as typing
  // would.
  const beforeInput = (type: SegmentType, event: InputEvent) => {
    event.preventDefault()
    if (readOnly || disabled) return
    if (event.inputType.startsWith('delete')) {
      if (event.inputType.endsWith('Forward')) clear(type)
      else backspace(type)
      return
    }
    const data = event.data ?? ''
    let target: SegmentType | undefined = type
    const next = () => {
      const at: SegmentType = target ?? type
      leave(at)
      move(at, 1)
      target = order[order.indexOf(at) + 1]
      arrived.current = target ?? null
    }
    for (const char of data) {
      if (!target) break
      const current = latest.current
      const digit = digitValue(char)
      if (digit !== null && DIGITS[target] > 0) {
        // Letters typed toward a name give way to digits.
        const held = current.texts[target] ?? ''
        const text = /^\d*$/.test(held) ? held : ''
        const typed = typeDigit(target, text, String(digit), current.fields, hourCycle)
        setSegment(target, typed)
        if (typed.advance) next()
      } else if (scheme.names[target] && /\p{L}/u.test(char)) {
        const text = (current.texts[target] ?? '').replace(/\d/g, '') + char
        const match = scheme.match(target, text) ?? scheme.match(target, char)
        if (match) {
          setSegment(target, { text: match.unique ? '' : text, value: match.value })
          if (match.unique) next()
        }
      } else if (SEPARATORS.has(char)) {
        if (separate(target)) target = order[order.indexOf(target) + 1]
      }
    }
  }
  const editing = useRef(beforeInput)
  useLayoutEffect(() => {
    editing.current = beforeInput
  })

  const onPaste = (event: ClipboardEvent<HTMLInputElement>) => {
    event.preventDefault()
    if (readOnly || disabled) return
    const fields = scheme.parse(event.clipboardData.getData('text'))
    if (fields) fill(fields)
  }

  const blurred = (type: SegmentType) => (event: FocusEvent<HTMLInputElement>) => {
    if (arrived.current === type) arrived.current = null
    leave(type)
    const inside = [...inputs.current.values()].includes(
      event.relatedTarget as HTMLInputElement,
    )
    if (inside) return
    setFocused(null)
    // Leaving the field, a day past its month's end moves to the last day.
    const current = latest.current
    const constrained = scheme.constrain(current.fields)
    if (constrained !== current.fields) fill(constrained)
    control.left()
  }

  const segmentLabelId = (type: SegmentType) => `${baseId}-${type}-name`
  const groupId = `${baseId}-group`

  const parts: SegmentFieldPart[] = layout.map((part) => {
    if (part.type === 'literal') return part
    const type = part.type
    const entry = { text: state.texts[type] ?? '', value: state.fields[type] ?? null }
    const range = segmentRange(type, state.fields, hourCycle)
    const names = scheme.names[type]
    const word = entry.value !== null ? names?.[entry.value - range.min] : undefined
    const text = word && !entry.text ? word : segmentText(type, entry)
    const first = type === order[0]
    const valueText =
      entry.value === null ? entry.text || 'Empty' : scheme.valueText(type, entry.value)
    return {
      type,
      lead: part.lead,
      text,
      placeholder: scheme.placeholder(type),
      sizes: names ? [...names] : ['0'.repeat(DIGITS[type])],
      trend: state.trends[type] ?? 1,
      inputProps: {
        id: first ? baseId : `${baseId}-${type}`,
        // What a screen reader says for it: Chrome reads a spinbutton input's value, not its
        // aria-valuetext. The eye reads the segment's own text, drawn over it.
        value: valueText,
        ref: (node: HTMLInputElement | null) => {
          if (!node) return
          inputs.current.set(type, node)
          // The native event, which also carries deletions; React's onBeforeInput only has text.
          const listener = (event: InputEvent) => editing.current(type, event)
          node.addEventListener('beforeinput', listener)
          return () => {
            node.removeEventListener('beforeinput', listener)
            inputs.current.delete(type)
          }
        },
        role: 'spinbutton',
        inputMode: names ? 'text' : 'numeric',
        autoComplete: 'off',
        autoCorrect: 'off',
        spellCheck: false,
        disabled,
        readOnly,
        // Its own name, then the field's: "day, Starts".
        'aria-labelledby': `${segmentLabelId(type)} ${groupLabelledBy ?? groupId}`,
        'aria-valuenow': entry.value ?? undefined,
        'aria-valuetext': valueText,
        'aria-valuemin': range.min,
        'aria-valuemax': range.max,
        'aria-invalid': invalid || undefined,
        'aria-describedby': first || invalid ? describedBy : undefined,
        'aria-readonly': readOnly || undefined,
        // Only the hidden input takes part in the form's validation.
        'aria-required': required || undefined,
        onKeyDown: onKeyDown(type),
        // Every edit goes through beforeinput; the input only holds what is spoken.
        onChange: () => {},
        onPaste,
        onFocus: (event: FocusEvent<HTMLInputElement>) => {
          setFocused(type)
          control.focused()
          event.currentTarget.select()
        },
        onBlur: blurred(type),
      },
    }
  })

  /** Each segment's name for screen readers, which its input reads with the field's label. */
  const segmentLabels = order.map((type) => (
    <span key={type} id={segmentLabelId(type)} hidden>
      {segmentNames.get(type)}
    </span>
  ))

  const hidden = control.hiddenProps(() => firstInput.current?.focus())
  const hiddenInputRef = useMemo(() => mergeRefs(hiddenRef, hidden.ref), [hidden.ref])
  const hiddenInput = (
    <input
      {...hidden}
      ref={hiddenInputRef}
      type='text'
      name={name}
      form={form}
      value={value ?? ''}
      onChange={() => {}}
      required={required}
      disabled={disabled}
      readOnly={readOnly}
      aria-hidden
      tabIndex={-1}
      style={visuallyHidden}
    />
  )

  return {
    parts,
    /** The props of the element around the segments. */
    groupProps: {
      id: groupId,
      role: 'group' as const,
      'aria-labelledby': groupLabelledBy,
      'aria-label': props['aria-label'],
      'aria-describedby': describedBy,
      'aria-invalid': invalid || undefined,
      'data-invalid': invalid ? '' : undefined,
      'data-filled': filled ? '' : undefined,
      'data-focused': focused ? '' : undefined,
      'data-disabled': disabled ? '' : undefined,
      'data-readonly': readOnly ? '' : undefined,
    },
    /** Rendered once inside the group: the segments' names and the input the form reads. */
    hidden: (
      <>
        {segmentLabels}
        {hiddenInput}
      </>
    ),
    value,
    invalid,
  }
}
