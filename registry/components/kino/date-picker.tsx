'use client'

import { Button } from '@/registry/components/kino/button'
import { CalendarMonths } from '@/registry/components/kino/calendar'
import {
  focusControl,
  InputInvalidIcon,
  inputBoxClassName,
  inputControlClassName,
} from '@/registry/components/kino/input'
import {
  InputGroupButton,
  inputGroupPresence,
} from '@/registry/components/kino/input-group'
import { PopoverBox, usePopoverContent } from '@/registry/components/kino/popover'
import { IconPlaceholder } from '@/registry/icons/icon-placeholder'
import {
  CALENDAR_LABELS,
  type CalendarLabels,
  type CalendarLook,
  CalendarLookContext,
  type DayContent,
} from '@/registry/lib/calendar-grid'
import {
  boundDay,
  type DateRange,
  datePlaceholder,
  formatDate,
  formatDateRange,
  useLocale,
  useToday,
  type Weekday,
  weekStart,
} from '@/registry/lib/dates'
import { useField } from '@/registry/lib/field-control'
import {
  followPick,
  followPointer,
  highlightClassName,
  itemMatching,
  pickClassName,
} from '@/registry/lib/highlight'
import {
  pillBackdropClassName,
  pillClassName,
  pillItemClassName,
  pillItemLayout,
  pillRowClassName,
  pillTrackClassName,
} from '@/registry/lib/pill'
import { usePopupPresentationAt } from '@/registry/lib/popup'
import { markMounted, mergeRefs } from '@/registry/lib/refs'
import { useRoomy } from '@/registry/lib/roomy'
import {
  DatePicker as DatePickerPrimitive,
  DatePickerClear as DatePickerClearPrimitive,
  DatePickerContent as DatePickerContentPrimitive,
  DatePickerInput as DatePickerInputPrimitive,
  DatePickerPreset as DatePickerPresetPrimitive,
  type DatePickerState,
  DatePickerTrigger as DatePickerTriggerPrimitive,
  type DatePickerValue,
  createDatePickerController,
} from '@ui-sdk/react/date-picker'
import {
  type ComponentProps,
  createContext,
  type ReactNode,
  use,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react'

import { cn } from '@/lib/utils'

/*
 * ui-sdk's Date picker in Kino's look: a date typed in the page's language
 * into a field, or picked from the Calendar in a popover that opens from the
 * field's calendar button. One day, or a range typed as two dates in one box
 * and picked as a range on the calendar. ui-sdk reads what is typed, holds
 * the value, sends it with a form and checks it; Kino draws the box, the
 * popover and the Calendar's months in it.
 */

/** The names the picker's own parts take, in place of the English ones. */
interface DatePickerLabels {
  /** The calendar button, before the date it holds; ui-sdk's "Choose date" when not given. */
  open?: string
  /** The clear button. */
  clear: string
  /** A range's last date, after the field's name. */
  end: string
}

const ENGLISH: DatePickerLabels = { clear: 'Clear', end: 'End date' }

interface DatePickerContextValue {
  state: DatePickerState
  locale: string
  labels: DatePickerLabels
  /** What the Calendar inside draws by, but for the parts the content sets. */
  look: Omit<CalendarLook, 'showWeekNumbers' | 'dayContent' | 'labels'>
  /** The field's box, where the popover hangs from. */
  box: HTMLElement | null
  setBox: (element: HTMLElement | null) => void
}

const DatePickerContext = createContext<DatePickerContextValue | null>(null)

function useDatePicker(part: string) {
  const context = use(DatePickerContext)
  if (!context) throw new Error(`${part} must be inside a DatePicker.`)
  return context
}

type DatePickerPrimitiveProps = ComponentProps<typeof DatePickerPrimitive>

/** Why the value changed, as `onValueChange` hears it. */
type DatePickerChangeDetails = Parameters<
  NonNullable<DatePickerPrimitiveProps['onValueChange']>
>[1]

interface DatePickerSingle {
  mode?: 'single'
  /** The date, as `yyyy-mm-dd`. */
  value?: string | null
  defaultValue?: string | null
  onValueChange?: (value: string | null, details: DatePickerChangeDetails) => void
}

interface DatePickerRange {
  mode: 'range'
  /** The range, start first; null until both ends are in. */
  value?: DateRange | null
  defaultValue?: DateRange | null
  onValueChange?: (value: DateRange | null, details: DatePickerChangeDetails) => void
}

type DatePickerProps = Omit<
  DatePickerPrimitiveProps,
  | 'children'
  | 'weekStartsOn'
  | 'className'
  | 'mode'
  | 'value'
  | 'defaultValue'
  | 'onValueChange'
> & {
  /** The first day of the week, 0 for Sunday. The locale's by default. */
  weekStartsOn?: Weekday
  labels?: Partial<DatePickerLabels>
  className?: string
  children?: ReactNode
} & (DatePickerSingle | DatePickerRange)

/**
 * Holds the date, whether the calendar is open and what a form sends.
 * Several months show side by side on a screen wider than a phone and one on
 * a phone. `presentation` is a popover by default; `auto` opens a sheet from
 * the bottom edge on a small touch screen, as the Popover does.
 */
function DatePicker({
  locale: localeProp,
  weekStartsOn,
  months = 1,
  fixedWeeks = true,
  monthFormat = 'long',
  min,
  max,
  today: todayProp,
  timeZone,
  presentation = 'popover',
  controller: controllerProp,
  labels,
  className,
  children,
  value,
  defaultValue,
  onValueChange,
  ...props
}: DatePickerProps) {
  const [own] = useState(createDatePickerController)
  const controller = controllerProp ?? own
  const locale = useLocale(localeProp)
  const first = weekStartsOn ?? weekStart(locale)
  const clock = useToday(timeZone)
  const today = todayProp ?? clock
  const bounds = useMemo(
    () => ({ min: boundDay(min, 'start'), max: boundDay(max, 'end') }),
    [min, max],
  )
  // Two months side by side don't fit a phone's width: it shows one.
  const roomy = useRoomy()
  const shown = roomy ? months : 1
  const [box, setBox] = useState<HTMLElement | null>(null)
  const words = useMemo(() => ({ ...ENGLISH, ...labels }), [labels])

  return (
    <DatePickerPrimitive
      {...props}
      value={value as DatePickerValue | undefined}
      defaultValue={defaultValue as DatePickerValue | undefined}
      onValueChange={onValueChange as DatePickerPrimitiveProps['onValueChange']}
      controller={controller}
      locale={locale}
      weekStartsOn={first}
      months={shown}
      fixedWeeks={fixedWeeks}
      monthFormat={monthFormat}
      min={bounds.min}
      max={bounds.max}
      today={today ?? undefined}
      timeZone={timeZone}
      presentation={usePopupPresentationAt(presentation, box)}
      className={className}
    >
      {(state) => (
        <DatePickerContext
          value={{
            state,
            locale,
            labels: words,
            look: {
              mode: state.mode,
              disabled: state.disabled,
              locale,
              weekStartsOn: first,
              months: shown,
              monthFormat,
              full: null,
              bounds,
              today,
              showMonth: (month) => controller.setMonth(month),
            },
            box,
            setBox,
          }}
        >
          {children}
        </DatePickerContext>
      )}
    </DatePickerPrimitive>
  )
}

/** The calendar button at the end of the field's box, named in `labels.open` with the date it holds when given. */
function BoxTrigger() {
  const { state, locale, labels } = useDatePicker('DatePickerInput')
  const { value } = state
  const written =
    value === null
      ? null
      : typeof value === 'string'
        ? formatDate(value, locale, { dateStyle: 'full' })
        : formatDateRange(value[0], value[1], locale, { dateStyle: 'full' })
  const named = labels.open && (written ? `${labels.open}, ${written}` : labels.open)
  return (
    <DatePickerTriggerPrimitive
      data-date-picker-box-trigger=''
      render={(own: ComponentProps<typeof InputGroupButton>) => (
        <InputGroupButton
          {...own}
          aria-label={named || own['aria-label']}
          size='icon-xs'
          className='text-muted-foreground'
        />
      )}
    >
      <PickerIcon />
    </DatePickerTriggerPrimitive>
  )
}

/**
 * A range's two dates, each as wide as what it shows, so they read as one
 * pair from the box's start, and shrink together where there isn't room.
 * Where a field can't size to its text, they share the box and meet at the
 * dash. Their placeholders take the small text even on a phone, so both fit.
 */
const rangeDateClassName =
  'w-0 supports-[field-sizing:content]:w-auto supports-[field-sizing:content]:flex-[0_1_auto] supports-[field-sizing:content]:[field-sizing:content]'

/**
 * The field: ui-sdk's input in the box, reading the date typed in the
 * locale's order on Enter or blur, or a range's two inputs, with the
 * calendar button at its end. Children (a `DatePickerClear`) sit before the
 * button. `className` goes to the box, every other prop to the input, or a
 * range's first.
 */
function DatePickerInput({
  className,
  children,
  placeholder,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
  ...props
}: Omit<ComponentProps<typeof DatePickerInputPrimitive>, 'className' | 'end'> & {
  className?: string
  children?: ReactNode
}) {
  const { state, locale, labels, setBox } = useDatePicker('DatePickerInput')
  const range = state.mode === 'range'
  const hint = placeholder ?? datePlaceholder(locale)
  const endNameId = useId()
  // The end isn't the Field's control, so it takes the Field's naming itself:
  // its name, then "End date", its description and error, and its invalid state.
  const field = useField()
  const fieldProps = (field?.props({}) ?? {}) as {
    'aria-labelledby'?: string
    'aria-describedby'?: string
    'aria-invalid'?: 'true'
  }
  const endNaming = {
    ...(ariaLabel
      ? { 'aria-label': `${ariaLabel}, ${labels.end}` }
      : {
          'aria-labelledby':
            [ariaLabelledBy ?? fieldProps['aria-labelledby'], endNameId]
              .filter(Boolean)
              .join(' ') || undefined,
        }),
    'aria-describedby': props['aria-describedby'] ?? fieldProps['aria-describedby'],
    'aria-invalid': state.invalid ? ('true' as const) : fieldProps['aria-invalid'],
  }

  return (
    <div
      ref={setBox}
      data-date-picker-box=''
      data-range={range ? '' : undefined}
      onPointerDown={focusControl}
      className={cn(inputBoxClassName, 'cursor-text', className)}
    >
      <DatePickerInputPrimitive
        placeholder={hint}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        className={cn(
          inputControlClassName,
          'tabular-nums',
          range && [rangeDateClassName, 'pe-0 text-end placeholder:text-sm'],
        )}
        {...props}
      />
      {range && (
        <>
          <span aria-hidden className='shrink-0 px-1 text-muted-foreground'>
            –
          </span>
          <span id={endNameId} hidden>
            {labels.end}
          </span>
          <DatePickerInputPrimitive
            end
            placeholder={hint}
            {...endNaming}
            className={cn(
              inputControlClassName,
              rangeDateClassName,
              'px-0 text-start tabular-nums placeholder:text-sm supports-[field-sizing:content]:grow',
            )}
          />
        </>
      )}
      <span
        data-date-picker-end=''
        className='ms-auto flex shrink-0 items-center gap-0.5 pe-1.5'
      >
        <InputInvalidIcon className='pe-1' />
        {children}
        <BoxTrigger />
      </span>
    </div>
  )
}

/**
 * A button that writes the date in words and opens the calendar, for a
 * date picked rather than typed. Children show while no date is picked.
 */
function DatePickerTrigger({
  className,
  children,
  format,
  size = 'default',
  'aria-label': ariaLabel,
  ref,
  ...props
}: Omit<ComponentProps<typeof DatePickerTriggerPrimitive>, 'className' | 'children'> & {
  className?: string
  /** The button's size: `sm` sits in a row of small controls, such as a toolbar's. */
  size?: 'default' | 'sm'
  /** Shown while no date is picked, such as "Pick a date". */
  children?: ReactNode
  /** How the value is written, as `Intl.DateTimeFormat` takes it: 14 Nov 2026 by default, and 2–8 Nov 2026 for a range. */
  format?: Omit<Intl.DateTimeFormatOptions, 'timeZone'>
}) {
  const picker = useDatePicker('DatePickerTrigger')
  // Without a box, the button is where the popup hangs from and whose motion setting it follows.
  const own = useMemo(() => mergeRefs(ref, picker.setBox), [ref, picker.setBox])
  const { value } = picker.state
  const style = format ?? { dateStyle: 'medium' }
  const written =
    value === null
      ? null
      : typeof value === 'string'
        ? formatDate(value, picker.locale, style)
        : formatDateRange(value[0], value[1], picker.locale, style)
  return (
    <DatePickerTriggerPrimitive
      ref={own}
      data-date-picker-trigger=''
      data-placeholder={written ? undefined : ''}
      // Named by what it shows, the date or its children, as a button's text names it:
      // the label given here, even none, replaces ui-sdk's "Choose date".
      render={(own: ComponentProps<typeof Button>) => (
        <Button
          {...own}
          aria-label={ariaLabel}
          variant='outline'
          size={size}
          className={cn(
            'justify-start font-normal tabular-nums data-placeholder:text-muted-foreground',
            className,
          )}
        />
      )}
      {...props}
    >
      <span data-icon='inline-start' className='flex'>
        <PickerIcon />
      </span>
      {written ?? children}
    </DatePickerTriggerPrimitive>
  )
}

/** Clears the date, or a range's; shown once there is something to clear. Focus goes back to the field. */
function DatePickerClear({
  className,
  ...props
}: Omit<ComponentProps<typeof DatePickerClearPrimitive>, 'className' | 'children'> & {
  className?: string
}) {
  const picker = useDatePicker('DatePickerClear')
  return (
    <DatePickerClearPrimitive
      data-date-picker-clear=''
      aria-label={picker.labels.clear}
      render={(clearProps, state) => (
        <span
          data-shown={state.empty || state.disabled ? undefined : ''}
          className={cn(inputGroupPresence, 'flex')}
        >
          <InputGroupButton
            {...(clearProps as ComponentProps<typeof InputGroupButton>)}
            size='icon-xs'
            className={cn('text-muted-foreground', className)}
          />
        </span>
      )}
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
    </DatePickerClearPrimitive>
  )
}

/**
 * The popover the calendar opens in, from the field's start, on the
 * Popover's look. Focus goes to the picked day, or today, ready for the
 * arrow keys, and back to the field once it closes. Without children it
 * holds the Calendar's months; children sit side by side, such as presets
 * and then the Calendar's `CalendarMonths`.
 */
function DatePickerContent({
  className,
  children,
  showWeekNumbers = false,
  dayContent,
  labels,
  ref,
  ...props
}: Omit<ComponentProps<typeof DatePickerContentPrimitive>, 'className' | 'children'> & {
  className?: string
  children?: ReactNode
  /** Shows each week's number before its days. */
  showWeekNumbers?: boolean
  /** What each day shows, under its full date, which a screen reader hears first. */
  dayContent?: DayContent
  /** The Calendar's own words, as the Calendar's `labels` takes them. */
  labels?: Partial<CalendarLabels>
}) {
  const picker = useDatePicker('DatePickerContent')
  const content = usePopoverContent(ref)
  const look: CalendarLook = {
    ...picker.look,
    labels: { ...CALENDAR_LABELS, ...labels },
    showWeekNumbers,
    dayContent,
  }
  return (
    <DatePickerContentPrimitive
      {...content.props}
      side='bottom'
      align='start'
      anchor={picker.box ?? undefined}
      {...props}
    >
      {({ presentation }) => (
        <PopoverBox
          presentation={presentation}
          className={cn(
            'w-auto flex-row flex-wrap items-start gap-(--surface-gap) max-sm:justify-center',
            className,
          )}
        >
          <CalendarLookContext value={look}>
            {children ?? <CalendarMonths className='w-auto' />}
          </CalendarLookContext>
        </PopoverBox>
      )}
    </DatePickerContentPrimitive>
  )
}

/** The pill's copy of the presets: inside it, a preset is only its label. */
const PresetCopyContext = createContext(false)

const PRESET = '[data-date-picker-preset]'

const presetLayout = cn(
  pillItemLayout,
  'h-auto min-h-[calc(var(--control-height)_-_6px)] justify-start py-1.5 text-start whitespace-normal',
)

/**
 * A column of presets beside the calendar, such as Today or Last 7 days,
 * drawn as a vertical Segmented control: the pill slides to the one the
 * value matches. On a phone, where they don't fit beside the calendar, they
 * sit above it as wide as it.
 */
function DatePickerPresets({
  className,
  children,
  'aria-label': ariaLabel = 'Presets',
  ...props
}: ComponentProps<'div'>) {
  const areaRef = useRef<HTMLDivElement>(null)
  const areaRefs = useMemo(() => mergeRefs(areaRef, markMounted), [])
  const pillRef = useRef<HTMLSpanElement>(null)
  const backdropRef = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    const area = areaRef.current
    if (!area || !pillRef.current || !backdropRef.current) return
    const stopPick = followPick(area, pillRef.current, {
      picked: () => area.querySelector<HTMLElement>(`${PRESET}[data-selected]`),
      attributes: ['data-selected'],
    })
    const stopHover = followPointer(area, backdropRef.current, {
      itemOf: itemMatching(area, PRESET),
      focus: true,
    })
    return () => {
      stopPick()
      stopHover()
    }
  }, [])
  return (
    <div
      role='group'
      aria-label={ariaLabel}
      data-date-picker-presets=''
      className={cn(pillTrackClassName, 'w-fit max-w-full max-sm:w-full', className)}
      {...props}
    >
      <div
        ref={areaRefs}
        className={cn('relative isolate flex flex-col', pillRowClassName)}
      >
        {children}
        <span
          ref={backdropRef}
          aria-hidden
          className={cn(highlightClassName, pillBackdropClassName)}
        />
        <span
          ref={pillRef}
          aria-hidden
          inert
          className={cn(pickClassName, pillClassName, 'z-10')}
        >
          <span className={cn('flex flex-col', pillRowClassName)}>
            <PresetCopyContext value>{children}</PresetCopyContext>
          </span>
        </span>
      </div>
    </div>
  )
}

/** One preset, ui-sdk's: a press sets its day, or its range as `[start, end]`, and closes the calendar. */
function DatePickerPreset({
  className,
  children,
  ...props
}: Omit<ComponentProps<typeof DatePickerPresetPrimitive>, 'className' | 'children'> & {
  className?: string
  children?: ReactNode
}) {
  if (use(PresetCopyContext)) {
    return <span className={cn(presetLayout, className)}>{children}</span>
  }
  return (
    <DatePickerPresetPrimitive
      data-date-picker-preset=''
      className={cn(
        presetLayout,
        pillItemClassName,
        // Until the page runs and the pill is placed, the pick draws itself.
        '[[data-date-picker-presets]_div:not([data-mounted])>&]:data-[selected]:bg-primary [[data-date-picker-presets]_div:not([data-mounted])>&]:data-[selected]:text-primary-foreground',
        className,
      )}
      {...props}
    >
      {children}
    </DatePickerPresetPrimitive>
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

export {
  DatePicker,
  DatePickerClear,
  DatePickerContent,
  DatePickerInput,
  DatePickerPreset,
  DatePickerPresets,
  DatePickerTrigger,
}
export type { DatePickerChangeDetails, DatePickerLabels, DatePickerProps }
