'use client'

import { Button } from '@/registry/components/kino/button'
import { Calendar, type CalendarDayProps } from '@/registry/components/kino/calendar'
import {
  focusControl,
  InputInvalidIcon,
  inputBoxClassName,
} from '@/registry/components/kino/input'
import {
  InputGroupButton,
  inputGroupPresence,
} from '@/registry/components/kino/input-group'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/registry/components/kino/popover'
import {
  SegmentedControl,
  SegmentedControlItem,
} from '@/registry/components/kino/segmented-control'
import { TimeInput } from '@/registry/components/kino/time-input'
import { IconPlaceholder } from '@/registry/icons/icon-placeholder'
import {
  dateGranularity,
  type DateMatchers,
  type DateRange,
  dateSpan,
  formatDate,
  formatDateRange,
  formatValue,
  type Granularity,
  type HourCycle,
  isISODate,
  isISODateTime,
  joinDateTime,
  rangeLength,
  matchesDate,
  monthOf,
  splitDateTime,
  timeGranularity,
  useLocale,
} from '@/registry/lib/dates'
import { OutsideField } from '@/registry/lib/field-control'
import { mergeRefs } from '@/registry/lib/refs'
import { useRoomy } from '@/registry/lib/roomy'
import { splitSegmentProps, useSegments } from '@/registry/lib/segment-field'
import { SegmentRow, segmentRowPadding } from '@/registry/lib/segmented-input'
import { dateScheme, dateTimeScheme } from '@/registry/lib/segments'
import { useFieldRootContext } from '@base-ui/react/internals/field-root-context'
import { useLabelableContext } from '@base-ui/react/internals/labelable-provider'
import {
  type ComponentProps,
  createContext,
  type ReactNode,
  type Ref,
  useContext,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react'

import { cn } from '@/lib/utils'

/*
 * A date typed into the Date input's segments, or picked from the Calendar
 * in a Popover that opens from the field's calendar button. One day, or a
 * range typed as two dates in one box and picked as a range on the
 * calendar. The popover closes on the pick, and a range's once both ends are
 * in. To the month or the year, the Calendar picks one from twelve; with a
 * time, the Time input sits under the calendar, and the popover closes once
 * both are in. Every date comes from `dates`.
 */

/** The names the picker's own buttons and fields take, in place of the English ones. */
interface DatePickerLabels {
  /** The calendar button. */
  open: string
  clear: string
  /** A range's first date. */
  start: string
  /** A range's last date. */
  end: string
  /** A range with one date in, which fails the form's check. */
  incomplete: string
  /** A date without its time, or a time without its date, which fails the form's check. */
  incompleteDateTime: string
  /** The Time input under the calendar. */
  time: string
  /** A range whose end comes before its start. */
  backwards: string
  /** A typed day that can't be picked. */
  unavailable: string
  /** A range shorter than `minDays`. */
  tooShort: string
  /** A range longer than `maxDays`. */
  tooLong: string
}

const ENGLISH: DatePickerLabels = {
  open: 'Choose from a calendar',
  clear: 'Clear',
  start: 'Start date',
  end: 'End date',
  incomplete: 'Enter both dates.',
  incompleteDateTime: 'Enter a date and a time.',
  time: 'Time',
  backwards: 'The end date comes before the start date.',
  unavailable: 'That day can’t be picked.',
  tooShort: 'That range is too short.',
  tooLong: 'That range is too long.',
}

interface DatePickerOptions {
  /** The earliest value that can be typed or picked, in the value's form, or a day. */
  min?: string
  /** The latest value that can be typed or picked, in the value's form, or a day, which allows all of it. */
  max?: string
  /** Days the calendar won't let you pick, as the Calendar's `unavailable` takes them. */
  unavailable?: DateMatchers
  /** A range's fewest days, both ends counted. */
  minDays?: number
  /** A range's most days, both ends counted. */
  maxDays?: number
  /** Sets the segments' order and the calendar's names and first weekday. The browser's language by default. */
  locale?: string
  /** With a time, a 12-hour clock with AM and PM, or a 24-hour one. The locale's by default. */
  hourCycle?: HourCycle
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  /** Closes the calendar once a day is picked, or a range is. */
  closeOnSelect?: boolean
  disabled?: boolean
  /** The date shows and can't be changed. */
  readOnly?: boolean
  /** A form can't be sent until a date is in, or both of a range's are. */
  required?: boolean
  /** The form the dates go with, when the picker sits outside it. */
  form?: string
  labels?: Partial<DatePickerLabels>
  children?: ReactNode
}

interface DatePickerSingle {
  mode?: 'single'
  /**
   * The smallest unit picked, which sets the value's form: `year` (`yyyy`),
   * `month` (`yyyy-mm`), `day` (`yyyy-mm-dd`, the default), or a date and
   * time to the `hour`, `minute` or `second` (`yyyy-mm-ddTHH:mm`, with
   * `:ss` to the second).
   */
  granularity?: Granularity
  /** The value, in the form `granularity` sets. */
  value?: string | null
  defaultValue?: string | null
  /** Called with the new value once one is whole, or with null once the field is empty. */
  onValueChange?: (value: string | null) => void
  /** Sends the date with a form under this name. In a Field, the Field's name. */
  name?: string
}

interface DatePickerRange {
  mode: 'range'
  /** A range is picked to the day. */
  granularity?: 'day'
  /** The range, start first; null until both ends are in. */
  value?: DateRange | null
  defaultValue?: DateRange | null
  onValueChange?: (value: DateRange | null) => void
  /** Sends the start with a form under this name. In a Field, the Field's name. */
  startName?: string
  /** Sends the end with a form under this name. */
  endName?: string
}

type DatePickerProps = DatePickerOptions & (DatePickerSingle | DatePickerRange)

type DatePickerValue = string | DateRange | null

/**
 * What the two fields hold: a value, or a range's start and end as typed,
 * either of which can be missing. With a time, the value can be half in
 * (`2026-11-14T`, `T09:30`), as the field, the calendar and the time each
 * fill their part.
 */
type Drafts = readonly [string | null, string | null]

interface DatePickerContextValue {
  mode: 'single' | 'range'
  granularity: Granularity
  hourCycle?: HourCycle
  drafts: Drafts
  value: DatePickerValue
  /** Sets one field's date, as typed. */
  type: (index: 0 | 1, date: string | null) => void
  /** Sets the whole value, from the calendar or a preset, and closes once it is whole. */
  pick: (value: DatePickerValue) => void
  open: boolean
  setOpen: (open: boolean) => void
  min?: string
  max?: string
  unavailable?: DateMatchers
  minDays?: number
  maxDays?: number
  locale: string
  disabled?: boolean
  readOnly?: boolean
  required?: boolean
  form?: string
  names: readonly [string | undefined, string | undefined]
  labels: DatePickerLabels
  /** The field's box, where the calendar hangs from. */
  anchor: HTMLElement | null
  setAnchor: (node: HTMLElement | null) => void
}

const DatePickerContext = createContext<DatePickerContextValue | null>(null)

function useDatePicker(part: string) {
  const context = useContext(DatePickerContext)
  if (!context) throw new Error(`${part} must be inside a DatePicker.`)
  return context
}

function DatePicker(props: DatePickerProps) {
  const {
    min,
    max,
    unavailable,
    minDays,
    maxDays,
    locale: localeProp,
    hourCycle,
    open: openProp,
    defaultOpen = false,
    onOpenChange,
    closeOnSelect = true,
    readOnly,
    required,
    form,
    labels,
    children,
  } = props
  // A disabled Field disables the picker's buttons and calendar, not just its segments.
  const fieldDisabled = useFieldRootContext().disabled
  const disabled = Boolean(props.disabled) || fieldDisabled
  const mode = props.mode ?? 'single'
  const granularity = props.granularity ?? 'day'
  const locale = useLocale(localeProp)
  const controlled = props.value !== undefined
  const given = (controlled ? props.value : props.defaultValue) ?? null

  const [held, setHeld] = useState(() => ({
    drafts: draftsOf(given),
    source: valueKey(given),
  }))
  // A value from outside that isn't the one the fields add up to moves them to it.
  if (controlled && valueKey(given) !== held.source) {
    setHeld({ drafts: draftsOf(given), source: valueKey(given) })
  }
  const value = useMemo(
    () => pickerValue(mode, held.drafts, granularity),
    [mode, held.drafts, granularity],
  )

  const [openState, setOpenState] = useState(defaultOpen)
  const open = openProp ?? openState
  const setOpen = (next: boolean) => {
    if (next && (disabled || readOnly)) return
    setOpenState(next)
    onOpenChange?.(next)
  }

  const write = (drafts: Drafts) => {
    const next = pickerValue(mode, drafts, granularity)
    const key = valueKey(next)
    setHeld({ drafts, source: key })
    if (key !== valueKey(value)) emit(props, next)
  }

  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const context: DatePickerContextValue = {
    mode,
    granularity,
    hourCycle,
    drafts: held.drafts,
    value,
    type: (index, date) =>
      write(index === 0 ? [date, held.drafts[1]] : [held.drafts[0], date]),
    pick: (next) => {
      write(draftsOf(next))
      // With a time, a date picked alone waits for its time.
      const whole = pickerValue(mode, draftsOf(next), granularity) !== null
      if (closeOnSelect && whole) setOpen(false)
    },
    open,
    setOpen,
    min,
    max,
    unavailable,
    minDays,
    maxDays,
    locale,
    disabled,
    readOnly,
    required,
    form,
    names:
      props.mode === 'range' ? [props.startName, props.endName] : [props.name, undefined],
    labels: { ...ENGLISH, ...labels },
    anchor,
    setAnchor,
  }

  return (
    <DatePickerContext value={context}>
      <Popover open={open} onOpenChange={setOpen}>
        {children}
      </Popover>
    </DatePickerContext>
  )
}

function emit(props: DatePickerProps, value: DatePickerValue) {
  if (props.mode === 'range') props.onValueChange?.(isRange(value) ? value : null)
  else props.onValueChange?.(typeof value === 'string' ? value : null)
}

/** The calendar button: in the field's box, it opens the calendar. */
function DatePickerTrigger({
  className,
  ...props
}: Omit<ComponentProps<typeof PopoverTrigger>, 'className'> & {
  className?: string
}) {
  const picker = useDatePicker('DatePickerTrigger')
  return (
    <PopoverTrigger
      data-slot='date-picker-trigger'
      disabled={picker.disabled || picker.readOnly}
      render={
        <InputGroupButton
          size='icon-xs'
          aria-label={picker.labels.open}
          className={cn('text-muted-foreground', className)}
        />
      }
      {...props}
    >
      <PickerIcon />
    </PopoverTrigger>
  )
}

/**
 * The field: the date typed a segment at a time, or a range's two dates in
 * one box, with the calendar button at its end. Children (a `DatePickerClear`)
 * sit before the button.
 */
function DatePickerInput({
  className,
  children,
  monthFormat,
  ref,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
  'aria-describedby': ariaDescribedBy,
  id,
  ...props
}: Omit<ComponentProps<'div'>, 'className'> & {
  className?: string
  /** Shows the month as a short name (Nov) in place of its number. */
  monthFormat?: 'numeric' | 'short'
}) {
  const picker = useDatePicker('DatePickerInput')
  const { setAnchor } = picker
  const boxRef = useMemo(() => mergeRefs(ref, setAnchor), [ref, setAnchor])
  const ownId = useId()
  const fieldLabel = useLabelableContext().labelId
  const range = picker.mode === 'range'
  const startScheme = useMemo(() => {
    const time = timeGranularity(picker.granularity)
    // Half a date and time counts here, so the calendar and the time can fill the other half.
    return time
      ? dateTimeScheme({
          locale: picker.locale,
          monthFormat,
          hourCycle: picker.hourCycle,
          granularity: time,
          min: picker.min,
          max: picker.max,
          partial: true,
        })
      : dateScheme({
          locale: picker.locale,
          monthFormat,
          granularity: dateGranularity(picker.granularity),
          min: picker.min,
          max: picker.max,
        })
  }, [
    picker.locale,
    monthFormat,
    picker.hourCycle,
    picker.granularity,
    picker.min,
    picker.max,
  ])
  // A range's end can't come before its start.
  const endMin = range ? latest(picker.min, picker.drafts[0]) : picker.min
  const endScheme = useMemo(
    () =>
      dateScheme({
        locale: picker.locale,
        monthFormat,
        min: endMin,
        max: picker.max,
      }),
    [picker.locale, monthFormat, endMin, picker.max],
  )
  const field = useFieldRootContext()
  const fieldInvalid = field.invalid === true || field.state.valid === false
  const [startUnavailable, endUnavailable] = picker.drafts.map((draft) => {
    const day = splitDateTime(draft).date
    return day !== null && matchesDate(day, picker.unavailable)
  })
  const halfIn = !range && picker.drafts[0] !== null && picker.value === null
  const problem = range
    ? rangeProblem(picker.drafts, picker)
    : startUnavailable
      ? 'unavailable'
      : halfIn
        ? 'incompleteDateTime'
        : null
  const wrongLength = problem === 'tooShort' || problem === 'tooLong'
  const shared = {
    disabled: picker.disabled,
    readOnly: picker.readOnly,
    required: picker.required,
    form: picker.form,
  }
  // A range names each date after the field: "Trip, Start date".
  const startNameId = `${ownId}-start`
  const endNameId = `${ownId}-end`
  const labelledBy = ariaLabelledBy ?? fieldLabel
  const naming = (nameId: string) =>
    ariaLabel
      ? {
          'aria-label': `${ariaLabel}, ${picker.labels[nameId === startNameId ? 'start' : 'end']}`,
        }
      : { 'aria-labelledby': [labelledBy, nameId].filter(Boolean).join(' ') }

  const start = useSegments(startScheme, {
    ...shared,
    value: picker.drafts[0],
    onValueChange: (date) => picker.type(0, date),
    name: picker.names[0],
    id,
    invalid: startUnavailable || wrongLength,
    // The start is the Field's control, so it holds the whole range and fails the form's check for anything wrong with it.
    customError: problem ? picker.labels[problem] : '',
    // The Field holds the whole value: a range, or a date and its time once both are in.
    ...(range || timeGranularity(picker.granularity)
      ? { fieldValue: picker.value }
      : undefined),
    'aria-describedby': ariaDescribedBy,
    ...(range
      ? naming(startNameId)
      : { 'aria-label': ariaLabel, 'aria-labelledby': ariaLabelledBy }),
  })

  return (
    <div
      ref={boxRef}
      data-slot='date-picker-input'
      data-range={range ? '' : undefined}
      {...props}
      {...(range
        ? {
            role: 'group',
            'aria-label': ariaLabel,
            'aria-labelledby': labelledBy,
          }
        : start.groupProps)}
      onPointerDown={(event) => {
        props.onPointerDown?.(event)
        if (!event.defaultPrevented) focusControl(event)
      }}
      className={cn(
        inputBoxClassName,
        'h-(--control-height) cursor-text text-base md:text-sm',
        segmentRowPadding,
        className,
      )}
    >
      {range ? (
        <>
          <span id={startNameId} hidden>
            {picker.labels.start}
          </span>
          <span id={endNameId} hidden>
            {picker.labels.end}
          </span>
          {/* The end isn't the Field's control: the start is, so the label focuses it. */}
          <OutsideField>
            <RangeRow
              start={start}
              scheme={endScheme}
              shared={shared}
              naming={naming(endNameId)}
              describedBy={ariaDescribedBy}
              invalid={fieldInvalid || endUnavailable || wrongLength}
            />
          </OutsideField>
        </>
      ) : (
        <SegmentRow
          slot='date-picker'
          compact={timeGranularity(picker.granularity) !== null}
          fields={[{ key: 'value', parts: start.parts, hidden: start.hidden }]}
        />
      )}
      <span
        data-slot='date-picker-end'
        className='ms-auto flex shrink-0 items-center gap-0.5 ps-1 pe-1.5'
      >
        <InputInvalidIcon className='pe-1' />
        {children}
        <DatePickerTrigger />
      </span>
    </div>
  )
}

/** A range's two dates in one row, with one highlight across both. */
function RangeRow({
  start,
  scheme,
  shared,
  naming,
  describedBy,
  invalid,
}: {
  start: ReturnType<typeof useSegments>
  scheme: ReturnType<typeof dateScheme>
  shared: object
  naming: object
  describedBy: string | undefined
  invalid: boolean
}) {
  const picker = useDatePicker('DatePickerInput')
  const [segmentProps] = splitSegmentProps({
    ...shared,
    value: picker.drafts[1],
    onValueChange: (date: string | null) => picker.type(1, date),
    name: picker.names[1],
    'aria-describedby': describedBy,
    invalid,
    ...naming,
  })
  const end = useSegments(scheme, segmentProps)
  return (
    <SegmentRow
      slot='date-picker'
      between='–'
      compact
      fields={[
        {
          key: 'start',
          parts: start.parts,
          groupProps: start.groupProps,
          hidden: start.hidden,
        },
        {
          key: 'end',
          parts: end.parts,
          groupProps: end.groupProps,
          hidden: end.hidden,
        },
      ]}
    />
  )
}

/**
 * A button that shows the date in words and opens the calendar, for a date
 * picked rather than typed. Children show when no date is picked.
 */
function DatePickerButton({
  className,
  children,
  format,
  ...props
}: Omit<ComponentProps<typeof PopoverTrigger>, 'className' | 'children'> & {
  className?: string
  /** Shown while no date is picked, such as "Pick a date". */
  children?: ReactNode
  /** How the value is written, as `Intl.DateTimeFormat` takes it. As the locale writes it by default: 14 Nov 2026, November 2026. */
  format?: Omit<Intl.DateTimeFormatOptions, 'timeZone'>
}) {
  const picker = useDatePicker('DatePickerButton')
  const { setAnchor } = picker
  const written = writtenValue(picker.value, picker.locale, format, picker.hourCycle)
  return (
    <PopoverTrigger
      data-slot='date-picker-button'
      data-placeholder={written ? undefined : ''}
      ref={setAnchor}
      disabled={picker.disabled || picker.readOnly}
      render={
        <Button
          variant='outline'
          className={cn(
            'justify-start font-normal tabular-nums data-placeholder:text-muted-foreground',
            className,
          )}
        />
      }
      {...props}
    >
      {/* The icon stays put in the button's start slot; only the date changes, crossfading in place. */}
      <span data-icon='inline-start' className='flex'>
        <PickerIcon />
      </span>
      {written ?? children}
    </PopoverTrigger>
  )
}

/** Clears the date, or both of a range's; shown once there is something to clear. */
function DatePickerClear({
  className,
  onClick,
  ...props
}: Omit<ComponentProps<typeof InputGroupButton>, 'children'>) {
  const picker = useDatePicker('DatePickerClear')
  const filled = picker.drafts.some((date) => date !== null)
  const shown = filled && !picker.disabled && !picker.readOnly
  return (
    <span data-shown={shown ? '' : undefined} className={cn(inputGroupPresence, 'flex')}>
      <InputGroupButton
        data-slot='date-picker-clear'
        size='icon-xs'
        aria-label={picker.labels.clear}
        className={cn('text-muted-foreground', className)}
        onClick={(event, details) => {
          onClick?.(event, details)
          if (event.defaultPrevented) return
          picker.pick(null)
          // The button leaves with the date: focus goes back to the field's first segment.
          event.currentTarget
            .closest('[data-slot=date-picker-input]')
            ?.querySelector<HTMLElement>('[role=spinbutton]')
            ?.focus()
        }}
        {...props}
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
    </span>
  )
}

/**
 * The popover the calendar opens in, from the field's start. Focus goes to
 * the picked day, or today, ready for the arrow keys, and back to the button
 * once it closes. Its children sit side by side: presets, then the calendar.
 */
function DatePickerContent({
  className,
  children,
  ref,
  ...props
}: Omit<ComponentProps<typeof PopoverContent>, 'anchor'> & {
  ref?: Ref<HTMLDivElement>
}) {
  const picker = useDatePicker('DatePickerContent')
  const popup = useRef<HTMLDivElement>(null)
  const popupRef = useMemo(() => mergeRefs(ref, popup), [ref])
  return (
    <PopoverContent
      ref={popupRef}
      anchor={picker.anchor}
      align='start'
      aria-label={props['aria-label'] ?? picker.labels.open}
      initialFocus={() =>
        popup.current?.querySelector<HTMLElement>(
          '[data-slot=calendar-day][tabindex="0"], [data-slot=calendar-choice][tabindex="0"]',
        ) ?? true
      }
      className={cn(
        'w-auto flex-row flex-wrap items-start max-sm:justify-center',
        className,
      )}
      {...props}
    >
      {/* The field's Field holds the value; what picks it in here isn't its control. */}
      <OutsideField>{children}</OutsideField>
    </PopoverContent>
  )
}

/**
 * The Calendar, holding the picker's date: it shows its month, its `min`,
 * `max`, `unavailable` and language, and a pick sets the field. Other props
 * go to the Calendar, such as `months={2}` for a range. To the month or the
 * year, it picks one of twelve; with a time, the Time input sits under it.
 */
function DatePickerCalendar(
  props: Omit<
    CalendarDayProps,
    | 'mode'
    | 'value'
    | 'defaultValue'
    | 'onValueChange'
    | 'name'
    | 'form'
    | 'required'
    | 'granularity'
  >,
) {
  const picker = useDatePicker('DatePickerCalendar')
  // Two months side by side don't fit a phone's width: it shows one.
  const roomy = useRoomy()
  const date = dateGranularity(picker.granularity)
  const timeUnit = timeGranularity(picker.granularity)
  const shown = splitDateTime(picker.drafts[0] ?? picker.drafts[1]).date
  const common = {
    min: picker.min,
    max: picker.max,
    locale: picker.locale,
    disabled: picker.disabled,
    readOnly: picker.readOnly,
  }
  if (date !== 'day') {
    return (
      <Calendar
        {...common}
        className={props.className}
        labels={props.labels}
        today={props.today}
        timeZone={props.timeZone}
        granularity={date}
        value={typeof picker.value === 'string' ? picker.value : null}
        onValueChange={(value) => picker.pick(value)}
      />
    )
  }
  const day = {
    ...common,
    unavailable: picker.unavailable,
    defaultMonth: shown ? monthOf(shown) : undefined,
    ...props,
    months: roomy ? props.months : 1,
  }
  if (picker.mode === 'range') {
    return (
      <Calendar
        minDays={picker.minDays}
        maxDays={picker.maxDays}
        {...day}
        mode='range'
        value={isRange(picker.value) ? picker.value : null}
        onValueChange={(value) => picker.pick(value)}
      />
    )
  }
  if (!timeUnit) {
    return (
      <Calendar
        {...day}
        value={typeof picker.value === 'string' ? picker.value : null}
        onValueChange={(value) => picker.pick(value)}
      />
    )
  }
  return <DateTimeCalendar day={day} granularity={timeUnit} />
}

/** The calendar and, under it, the time: each fills its half of the value, and a day picked without a time moves on to the time. */
function DateTimeCalendar({
  day,
  granularity,
}: {
  day: Omit<CalendarDayProps, 'mode' | 'value' | 'defaultValue' | 'onValueChange'>
  granularity: 'hour' | 'minute' | 'second'
}) {
  const picker = useDatePicker('DatePickerCalendar')
  const { date, time } = splitDateTime(picker.drafts[0])
  const labelId = useId()
  const timeRef = useRef<HTMLDivElement>(null)
  const calendarRef = useRef<HTMLDivElement>(null)
  return (
    <div data-slot='date-picker-date-time' className='flex flex-col gap-(--surface-gap)'>
      <Calendar
        {...day}
        ref={calendarRef}
        value={date}
        onValueChange={(next) => {
          // Clearing the day keeps the time; the field clears both.
          if (next === null) return picker.type(0, joinDateTime(null, time))
          picker.pick(joinDateTime(next, time))
          if (time === null)
            timeRef.current?.querySelector<HTMLElement>('[role=spinbutton]')?.focus()
        }}
      />
      <div
        data-slot='date-picker-time'
        className='flex items-center gap-2 border-t pt-(--surface-gap)'
      >
        <span id={labelId} className='text-sm text-muted-foreground'>
          {picker.labels.time}
        </span>
        <TimeInput
          ref={timeRef}
          aria-labelledby={labelId}
          locale={picker.locale}
          hourCycle={picker.hourCycle}
          granularity={granularity}
          disabled={picker.disabled}
          readOnly={picker.readOnly}
          value={time}
          // Enter takes the time as a day's Enter takes the day: it closes once both are
          // in, and goes up to the calendar while the day is missing.
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || time === null) return
            event.preventDefault()
            if (picker.value !== null) picker.setOpen(false)
            else
              calendarRef.current
                ?.querySelector<HTMLElement>('[data-slot=calendar-day][tabindex="0"]')
                ?.focus()
          }}
          onValueChange={(next) => {
            const joined = joinDateTime(date, next)
            // The time that makes the value whole closes the calendar, as a day picked
            // after its time does; one stepped once it is whole leaves it open.
            if (picker.value === null) picker.pick(joined)
            else picker.type(0, joined)
          }}
          className='flex-1'
        />
      </div>
    </div>
  )
}

/** A column of presets beside the calendar, such as Today or Last 7 days, marking the one the date matches. */
function DatePickerPresets({
  className,
  'aria-label': ariaLabel = 'Presets',
  ...props
}: Omit<
  ComponentProps<typeof SegmentedControl<string>>,
  'value' | 'defaultValue' | 'onValueChange' | 'orientation'
>) {
  const picker = useDatePicker('DatePickerPresets')
  return (
    <SegmentedControl<string>
      data-date-picker-presets=''
      aria-label={ariaLabel}
      orientation='vertical'
      disabled={picker.disabled || picker.readOnly}
      value={valueKey(picker.value) || null}
      onValueChange={(key) => picker.pick(key ? fromKey(key) : null)}
      // On a phone, where they don't fit beside the calendar, they sit above it as wide as it.
      className={cn('max-sm:w-full', className)}
      {...props}
    />
  )
}

/** One preset: a day, or a range as `[start, end]`. */
function DatePickerPreset({
  value,
  onClick,
  ...props
}: Omit<ComponentProps<typeof SegmentedControlItem>, 'value'> & {
  value: string | DateRange
}) {
  const picker = useDatePicker('DatePickerPreset')
  const key = valueKey(value)
  return (
    <SegmentedControlItem
      data-date-picker-preset=''
      value={key}
      // Pressed again, it still sets the date and closes the calendar.
      onClick={(event) => {
        onClick?.(event)
        if (!event.defaultPrevented && key === valueKey(picker.value)) picker.pick(value)
      }}
      {...props}
    />
  )
}

function PickerIcon() {
  return (
    <IconPlaceholder
      lucide='CalendarIcon'
      tabler='IconCalendar'
      hugeicons='Calendar01Icon'
      phosphor='CalendarIcon'
      remixicon='RiCalendarLine'
      aria-hidden
    />
  )
}

function isRange(value: DatePickerValue): value is DateRange {
  return typeof value === 'object' && value !== null
}

/** The fields' dates for a value: a day in the first, a range's ends in both. */
function draftsOf(value: DatePickerValue): Drafts {
  if (value === null) return [null, null]
  if (typeof value === 'string') return [value, null]
  return [value[0], value[1]]
}

/** What the fields add up to: the value, a date and time once both halves are in, or the range once both ends are in, in order. */
function pickerValue(
  mode: 'single' | 'range',
  [start, end]: Drafts,
  granularity: Granularity = 'day',
): DatePickerValue {
  if (mode === 'single') {
    if (timeGranularity(granularity)) return isISODateTime(start) ? start : null
    return start
  }
  return start !== null && end !== null && start <= end ? [start, end] : null
}

/** A value as one string, to compare and to key a preset: `2026-11-27`, or `2026-11-02/2026-11-08` for a range. */
function valueKey(value: DatePickerValue): string {
  if (value === null) return ''
  return typeof value === 'string' ? value : `${value[0]}/${value[1]}`
}

function fromKey(key: string): DatePickerValue {
  if (!key) return null
  const [start, end] = key.split('/')
  return end ? [start, end] : start
}

type RangeProblem = 'incomplete' | 'backwards' | 'unavailable' | 'tooShort' | 'tooLong'

/** What is wrong with a range as typed, if anything: an end missing, the ends the wrong way round, an end that can't be picked, or too few or too many days. */
function rangeProblem(
  [start, end]: Drafts,
  rules: { unavailable?: DateMatchers; minDays?: number; maxDays?: number },
): RangeProblem | null {
  if (start === null && end === null) return null
  if (start === null || end === null) return 'incomplete'
  if (start > end) return 'backwards'
  if (matchesDate(start, rules.unavailable) || matchesDate(end, rules.unavailable))
    return 'unavailable'
  const days = rangeLength([start, end])
  if (rules.minDays !== undefined && days < rules.minDays) return 'tooShort'
  if (rules.maxDays !== undefined && days > rules.maxDays) return 'tooLong'
  return null
}

/** The later of two dates, either of which can be missing. */
function latest(a: string | null | undefined, b: string | null | undefined) {
  if (!a) return b ?? undefined
  if (!b) return a
  return a > b ? a : b
}

/**
 * The value in words: 27 Nov 2026, November 2026, 27 Nov 2026, 09:30, or
 * 2–8 Nov 2026 for a range. With `format`, written that way: a month or a
 * year as its first day.
 */
function writtenValue(
  value: DatePickerValue,
  locale: string,
  format?: Omit<Intl.DateTimeFormatOptions, 'timeZone'>,
  hourCycle?: HourCycle,
): string | null {
  if (value === null) return null
  if (typeof value !== 'string')
    return formatDateRange(value[0], value[1], locale, format ?? { dateStyle: 'medium' })
  if (!format) return formatValue(value, locale, hourCycle)
  const at = isISODate(value) || isISODateTime(value) ? value : dateSpan(value)?.[0]
  return at ? formatDate(at, locale, format) : null
}

export {
  DatePicker,
  DatePickerButton,
  DatePickerCalendar,
  DatePickerClear,
  DatePickerContent,
  DatePickerInput,
  DatePickerPreset,
  DatePickerPresets,
  DatePickerTrigger,
  draftsOf,
  fromKey,
  latest,
  pickerValue,
  rangeProblem,
  valueKey,
  writtenValue,
}
export type { DatePickerLabels, DatePickerProps }
