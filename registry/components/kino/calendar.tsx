'use client'

import { Button } from '@/registry/components/kino/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/registry/components/kino/popover'
import { IconPlaceholder } from '@/registry/icons/icon-placeholder'
import { CalendarChoices } from '@/registry/lib/calendar-choices'
import {
  CalendarColumns,
  calendarClassName,
  calendarNextPlace,
  CalendarPending,
  calendarPreviousPlace,
  CalendarTurn,
  useTurnPlaces,
} from '@/registry/lib/calendar-grid'
import {
  type ChoiceLevel,
  CHOICES,
  choicePage,
  choicePageTurn,
} from '@/registry/lib/calendar-model'
import {
  type CalendarChangeDetails,
  type CalendarLabels,
  type DayProps,
  detailsOf,
  splitCalendarProps,
  useCalendarBasics,
  useCalendarState,
} from '@/registry/lib/calendar-state'
import { useControllable } from '@/registry/lib/controllable'
import { CutTooltip } from '@/registry/lib/cut'
import {
  isISOMonth,
  isISOYear,
  monthOf,
  monthParts,
  yearMonth,
  yearPage,
} from '@/registry/lib/dates'
import { FieldValues, useLabelFocus } from '@/registry/lib/field-control'
import { mergeRefs } from '@/registry/lib/refs'
import { Swap } from '@/registry/lib/swap'
import { useRegisterFieldControl } from '@base-ui/react/internals/field-register-control'
import { useFieldRootContext } from '@base-ui/react/internals/field-root-context'
import { useFormContext } from '@base-ui/react/internals/form-context'
import {
  useLabelableContext,
  useLabelableId,
} from '@base-ui/react/internals/labelable-provider'
import {
  type ComponentProps,
  type CSSProperties,
  type MouseEvent,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import { cn } from '@/lib/utils'

/*
 * A month of days to pick one day, several or a range from, by pointer or by
 * the keys of the WAI-ARIA date grid. A backdrop glides under the pointer and
 * a pill slides to the pick, as on the Tabs; a range is a band that grows
 * along each week. The arrows turn the months, which slide a short way in
 * the direction of travel, and each month's name opens a popover of the
 * year's twelve months, whose year's name steps out to twelve years. Every
 * date comes from `dates`, and every decision is a pure, tested function in
 * `calendar-model`.
 */

type CalendarState = ReturnType<typeof useCalendarState>

/** How far the months and choices slide and zoom; a buyer's `--calendar-slide` and `--calendar-zoom` win. */
const motion =
  '[--swap-slide:var(--calendar-slide,1.5rem)] [--swap-zoom:var(--calendar-zoom,0.92)]'

/** The calendar's motion variables as set where `element` sits, for a popover that renders away from it. */
function motionVariables(element: HTMLElement | null): CSSProperties {
  if (!element) return {}
  const style = getComputedStyle(element)
  const variables: Record<string, string> = {}
  for (const name of ['--calendar-slide', '--calendar-zoom']) {
    const value = style.getPropertyValue(name).trim()
    if (value) variables[name] = value
  }
  return variables
}

/** How a picker of months or years moved to its page: a turn slides, a change of level zooms. */
type ChoiceMove = { slide?: 1 | -1; zoom?: 'in' | 'out' }

/**
 * A year's months, or twelve years, to pick from: arrows either side turn
 * the page, and a year's name steps out to its twelve years, whose pick
 * steps back in to that year's months. The Calendar's heading opens one in
 * a popover; to the month or the year, the Calendar is one.
 */
function ChoicePicker({
  labels,
  locale,
  rtl,
  rules,
  today,
  picked,
  opensOn,
  final,
  disabled,
  readOnly,
  focusOn: firstFocus = null,
  onLevelChange,
  onPick,
}: {
  labels: CalendarLabels
  locale: string
  rtl: boolean
  /** The first and last days that can be chosen from, as `yyyy-mm-dd`. */
  rules: { min?: string; max?: string }
  today: string | null
  /** The month marked as picked, as `yyyy-mm` (a year's first month for a year), or null. */
  picked: string | null
  /** The level and year it opens on. */
  opensOn: { level: ChoiceLevel; year: number }
  /** The level whose pick is the value: a year picked among years steps in to its months until `months` is reached. */
  final: ChoiceLevel
  disabled?: boolean
  readOnly?: boolean
  /** The choice to focus once it first draws, or `stop` for its tab stop. */
  focusOn?: number | 'stop' | null
  /** The level it shows now, once it steps out or in. */
  onLevelChange?: (level: ChoiceLevel) => void
  onPick: (value: string, event: MouseEvent<HTMLButtonElement>) => void
}) {
  // What it shows: a year's months, or a page of years from `year`.
  const [view, setView] = useState(opensOn)
  const [moved, setMoved] = useState<ChoiceMove>({})
  const [focusOn, setFocusOn] = useState<number | 'stop' | null>(firstFocus)
  const { level, year } = view

  const show = (
    next: ChoiceLevel,
    at: number,
    how: ChoiceMove,
    focus: number | 'stop' | null,
  ) => {
    setView({ level: next, year: at })
    setMoved(how)
    setFocusOn(focus)
    if (next !== level) onLevelChange?.(next)
  }

  const page = choicePage(level, year, { shown: picked, today, rules, locale })
  const { title } = page
  /** Turns to the page `direction`, if it has anything to choose. A button that then has nowhere to go hands focus to the grid. */
  const turn = (direction: 1 | -1, focus: number | null = null) => {
    const target = direction === 1 ? page.next : page.previous
    if (target === null) return
    const last =
      focus === null && choicePageTurn(level, target, direction, rules) === null
    show(level, target, { slide: direction }, last ? 'stop' : focus)
  }
  const choices = disabled
    ? page.choices.map((choice) => ({ ...choice, disabled: true }))
    : page.choices

  return (
    <>
      <span aria-live='polite' className='sr-only'>
        {title}
      </span>
      <div className='flex items-center justify-between gap-1'>
        <CalendarTurn
          direction='previous'
          aria-label={level === 'months' ? labels.previousYear : labels.previousYears}
          disabled={disabled || page.previous === null}
          onClick={() => turn(-1)}
        />
        {/* The title moves with the choices below it, button and all. */}
        <Swap
          slide={moved.slide}
          zoom={moved.zoom}
          id={`${level}:${year}`}
          className='flex min-w-0 flex-1 justify-center'
        >
          {level === 'months' ? (
            <Button
              variant='ghost'
              size='sm'
              data-slot='calendar-heading'
              aria-label={labels.chooseYear(title)}
              disabled={disabled}
              onClick={() => {
                const first = yearPage(year, CHOICES)
                show('years', first, { zoom: 'out' }, year - first)
              }}
              className='min-w-0 tabular-nums'
            >
              {title}
            </Button>
          ) : (
            <span className='flex h-(--control-height-sm) items-center text-sm font-medium tabular-nums'>
              {title}
            </span>
          )}
        </Swap>
        <CalendarTurn
          direction='next'
          aria-label={level === 'months' ? labels.nextYear : labels.nextYears}
          disabled={disabled || page.next === null}
          onClick={() => turn(1)}
        />
      </div>
      <Swap
        slide={moved.slide}
        zoom={moved.zoom}
        id={`${level}:${year}`}
        className='w-full'
      >
        <CalendarChoices
          choices={choices}
          current={page.current}
          today={page.today}
          label={title}
          rtl={rtl}
          focusOn={focusOn}
          readOnly={readOnly}
          onPage={(direction, index) => turn(direction, index)}
          onPick={(index, event) => {
            if (level === 'years' && final === 'months') {
              const at = picked ? monthParts(picked).month - 1 : 0
              show('months', year + index, { zoom: 'in' }, at)
              return
            }
            onPick(
              level === 'years'
                ? String(year + index).padStart(4, '0')
                : yearMonth(year, index + 1),
              event,
            )
          }}
        />
      </Swap>
    </>
  )
}

/** A month's name, which opens a popover of its year's months. */
function MonthPopover({
  state,
  month,
  offset,
  labelId,
}: {
  state: CalendarState
  month: string
  /** Its place among the months on screen. */
  offset: number
  /** The id its visible name takes, which names the month's grid. */
  labelId: string
}) {
  const [open, setOpen] = useState(false)
  // Each opening starts afresh on the shown month's year, even while the last one still fades out.
  const [opened, setOpened] = useState(0)
  const [level, setLevel] = useState<ChoiceLevel>('months')
  // The month just picked, which keeps the pill while the popover closes.
  const [picked, setPicked] = useState<string | null>(null)
  // The popover sits in the page's body, away from the calendar: it takes the
  // calendar's motion variables as they are where its heading sits.
  const [distances, setDistances] = useState<CSSProperties>({})
  const [body, setBody] = useState<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  // Where the popover hangs from: its heading, until a pick turns the months
  // and the heading slides away with them; from then it stays where it was,
  // so the popover folds back into the place it came from.
  const [trigger, setTrigger] = useState<HTMLButtonElement | null>(null)
  const triggerRefs = useMemo(() => mergeRefs(triggerRef, setTrigger), [])
  const left = useRef<DOMRect | null>(null)
  const anchor = useMemo(
    () =>
      trigger && {
        getBoundingClientRect: () => left.current ?? trigger.getBoundingClientRect(),
        contextElement: trigger,
      },
    [trigger],
  )
  const shown = monthParts(month)

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) return
        left.current = null
        setPicked(null)
        setLevel('months')
        setOpened((count) => count + 1)
        setDistances(motionVariables(triggerRef.current))
      }}
    >
      <CutTooltip
        render={
          <PopoverTrigger
            disabled={state.disabled}
            ref={triggerRefs}
            render={
              <Button
                variant='ghost'
                size='sm'
                data-slot='calendar-heading'
                aria-label={state.labels.chooseMonth(state.label(month))}
                className='min-w-0'
              />
            }
          >
            <span id={labelId} data-cut className='truncate'>
              {state.label(month)}
            </span>
            <IconPlaceholder
              lucide='ChevronDownIcon'
              tabler='IconChevronDown'
              hugeicons='ArrowDown01Icon'
              phosphor='CaretDownIcon'
              remixicon='RiArrowDownSLine'
              aria-hidden
              className='text-muted-foreground'
            />
          </PopoverTrigger>
        }
      />
      <PopoverContent
        aria-label={level === 'months' ? state.labels.months : state.labels.years}
        anchor={anchor}
        style={distances}
        className={`w-[calc(var(--control-height)*7)] gap-1 ${motion}`}
        initialFocus={() =>
          body?.querySelector<HTMLElement>('[data-slot=calendar-choice][tabindex="0"]') ??
          true
        }
      >
        <div ref={setBody} className='contents'>
          <ChoicePicker
            key={opened}
            labels={state.labels}
            locale={state.locale}
            rtl={state.rtl}
            rules={{ min: state.min, max: state.max }}
            today={state.today}
            picked={picked ?? month}
            opensOn={{ level: 'months', year: shown.year }}
            final='months'
            onLevelChange={setLevel}
            onPick={(value, event) => {
              left.current = triggerRef.current?.getBoundingClientRect() ?? null
              const shownFirst = state.goTo(
                value,
                offset,
                event.nativeEvent,
                event.currentTarget,
              )
              if (shownFirst === null) return
              // This heading leaves with the months it named, and the popover
              // with it: focus goes to the heading that takes its place.
              setPicked(value)
              setOpen(false)
              focusHeadingAfter(triggerRef.current, offset)
            }}
          />
        </div>
      </PopoverContent>
    </Popover>
  )
}

/** A calendar's props: its days', or with `granularity`, its months' or years'. */
type CalendarProps = CalendarDayProps | CalendarChoiceProps

/** The Calendar to the day: one day, several or a range, picked from its months. */
type CalendarDayProps = DayProps & {
  /** The smallest unit picked: a day (`yyyy-mm-dd`), a month (`yyyy-mm`) or a year (`yyyy`). */
  granularity?: 'day'
}

interface CalendarChoiceOptions {
  /** The smallest unit picked: a month (`yyyy-mm`) from a year's twelve, or a year (`yyyy`) from twelve years. */
  granularity: 'month' | 'year'
  /** One month or year is picked at a time. */
  mode?: 'single'
  /** The picked month as `yyyy-mm`, or year as `yyyy`. */
  value?: string | null
  defaultValue?: string | null
  onValueChange?: (value: string | null, details: CalendarChangeDetails) => void
  /** The earliest month or year that can be picked: a year, a month or a day, in any of whose months or years it falls. */
  min?: string
  /** The latest month or year that can be picked: a year, a month or a day. */
  max?: string
  /** A press on the picked month or year clears it. */
  deselectable?: boolean
  disabled?: boolean
  /** The pages still turn; the value doesn't change. */
  readOnly?: boolean
  /** Sets the names of the months. The browser's language by default. */
  locale?: string
  /** The day whose month or year is marked as now, as `yyyy-mm-dd`; by default the visitor's, in `timeZone`. */
  today?: string
  /** The time zone that decides which day is today. The visitor's own by default. */
  timeZone?: string
  /** Focuses the grid's tab stop once the calendar shows, as in a date picker that just opened. */
  autoFocus?: boolean
  /** Sends the picked month or year with a form, under this name. */
  name?: string
  /** The form the value goes with, when the calendar sits outside it. */
  form?: string
  /** A form can't be sent until a month or year is picked. */
  required?: boolean
  /** Marks the calendar as holding a value that isn't allowed; in a Field, its validity decides. */
  invalid?: boolean
  labels?: Partial<CalendarLabels>
}

/** The Calendar to the month or the year: one picked from a page of twelve. */
type CalendarChoiceProps = Omit<
  ComponentProps<'div'>,
  keyof CalendarChoiceOptions | 'children'
> &
  CalendarChoiceOptions

function Calendar(props: CalendarProps) {
  return picksChoices(props) ? <ChoiceCalendar {...props} /> : <DayCalendar {...props} />
}

function picksChoices(props: CalendarProps): props is CalendarChoiceProps {
  return props.granularity === 'month' || props.granularity === 'year'
}

/**
 * The naming a calendar takes in a Field: its label names it and focuses
 * its tab stop, and its description and error describe it.
 */
function useCalendarNaming(
  {
    'aria-label': ariaLabel,
    'aria-labelledby': ariaLabelledBy,
    'aria-describedby': ariaDescribedBy,
  }: Pick<ComponentProps<'div'>, 'aria-label' | 'aria-labelledby' | 'aria-describedby'>,
  disabled: boolean,
  focus: () => void,
) {
  const { labelId: fieldLabel, getDescriptionProps } = useLabelableContext()
  useLabelableId({ id: null })
  useLabelFocus(fieldLabel, disabled, focus)
  return {
    'aria-label': ariaLabel,
    'aria-labelledby': ariaLabelledBy ?? (ariaLabel ? undefined : fieldLabel),
    'aria-describedby':
      [ariaDescribedBy, getDescriptionProps({})['aria-describedby']]
        .filter(Boolean)
        .join(' ') || undefined,
  }
}

function DayCalendar({
  className,
  dayContent,
  ref,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
  'aria-describedby': ariaDescribedBy,
  ...props
}: CalendarDayProps) {
  const [stateProps, rest] = splitCalendarProps(props)
  const state = useCalendarState(stateProps)
  const naming = useCalendarNaming(
    {
      'aria-label': ariaLabel,
      'aria-labelledby': ariaLabelledBy,
      'aria-describedby': ariaDescribedBy,
    },
    state.disabled,
    state.focusGrid,
  )
  const id = useId()
  const labelId = (month: string) => `${id}-${month}`
  const [root, setRoot] = useState<HTMLDivElement | null>(null)
  useTurnPlaces(root, state.rtl)
  const attachRoot = state.rootRef
  const rootRef = useMemo(() => mergeRefs(ref, setRoot, attachRoot), [ref, attachRoot])

  return (
    <div
      data-slot='calendar'
      {...state.rootProps(rest)}
      ref={rootRef}
      {...naming}
      className={cn(
        calendarClassName,
        'relative gap-1',
        invalidClassName,
        motion,
        className,
      )}
    >
      <CalendarForm
        {...state.formValue}
        disabled={state.disabled}
        focus={state.focusGrid}
        root={root}
      />
      <CalendarTurn
        direction='previous'
        {...state.previousProps}
        className={calendarPreviousPlace}
      />
      <CalendarTurn direction='next' {...state.nextProps} className={calendarNextPlace} />
      <span aria-live='polite' className='sr-only'>
        {state.shown.map((month) => state.label(month)).join(', ')}
      </span>
      {state.shown.length === 0 ? (
        <CalendarPending />
      ) : (
        <Swap slide={state.trend} id={state.shown[0]} block className='w-full'>
          <CalendarColumns
            state={state}
            labelId={labelId}
            dayContent={dayContent}
            heading={(month, offset) => (
              <MonthPopover
                state={state}
                month={month}
                offset={offset}
                labelId={labelId(month)}
              />
            )}
          />
        </Swap>
      )}
    </div>
  )
}

/**
 * The Calendar to the month or the year: a year's twelve months, or twelve
 * years, drawn as the day calendar's heading draws them in its popover. To
 * the month, the year's name steps out to twelve years, and a year picked
 * there steps back in to its months.
 */
function ChoiceCalendar({
  granularity,
  value: valueProp,
  defaultValue = null,
  onValueChange,
  min: minProp,
  max: maxProp,
  deselectable,
  disabled: disabledProp,
  readOnly = false,
  locale: localeProp,
  today: todayProp,
  timeZone,
  autoFocus,
  name: nameProp,
  form,
  required = false,
  invalid: invalidProp,
  labels: labelsProp,
  className,
  ref,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
  'aria-describedby': ariaDescribedBy,
  mode,
  ...rest
}: CalendarChoiceProps) {
  // Only ever single here, and not an attribute of the root.
  void mode
  const { min, max, disabled, invalid, name, locale, rtl, labels, today } =
    useCalendarBasics({
      min: minProp,
      max: maxProp,
      disabled: disabledProp,
      invalid: invalidProp,
      name: nameProp,
      locale: localeProp,
      labels: labelsProp,
      today: todayProp,
      timeZone,
    })
  const rules = { min, max }
  const final: ChoiceLevel = granularity === 'month' ? 'months' : 'years'
  const fits = granularity === 'month' ? isISOMonth : isISOYear

  const [given, pick] = useControllable<string | null, [CalendarChangeDetails]>(
    valueProp,
    defaultValue,
    onValueChange,
  )
  const value = fits(given) ? given : null

  // The picked month, as the picker marks it: a year's first month for a year.
  const picked = value === null ? null : granularity === 'month' ? value : `${value}-01`
  const around = monthParts(picked ?? (today ? monthOf(today) : '2000-01')).year
  const opensOn =
    final === 'months'
      ? { level: final, year: around }
      : { level: final, year: yearPage(around, CHOICES) }

  const [root, setRoot] = useState<HTMLDivElement | null>(null)
  const rootRef = useMemo(() => mergeRefs(ref, setRoot), [ref])
  const focus = useCallback(() => {
    root
      ?.querySelector<HTMLElement>('[data-slot=calendar-choice][tabindex="0"]')
      ?.focus({ preventScroll: true })
  }, [root])
  const naming = useCalendarNaming(
    {
      'aria-label': ariaLabel,
      'aria-labelledby': ariaLabelledBy,
      'aria-describedby': ariaDescribedBy,
    },
    disabled,
    focus,
  )

  return (
    <div
      role='group'
      data-slot='calendar'
      data-granularity={granularity}
      data-disabled={disabled ? '' : undefined}
      data-readonly={readOnly ? '' : undefined}
      data-invalid={invalid ? '' : undefined}
      {...rest}
      ref={rootRef}
      {...naming}
      className={cn(calendarClassName, 'gap-1', invalidClassName, motion, className)}
    >
      <CalendarForm
        name={disabled ? undefined : name}
        form={form}
        required={required}
        dates={value === null ? [] : [value]}
        value={value}
        disabled={disabled}
        focus={focus}
        root={root}
      />
      {today === null && todayProp === undefined ? (
        // The server can't know the visitor's today, which the page opens around.
        <CalendarPending />
      ) : (
        <ChoicePicker
          labels={labels}
          locale={locale}
          rtl={rtl}
          rules={rules}
          today={today}
          picked={picked}
          opensOn={opensOn}
          final={final}
          disabled={disabled}
          readOnly={readOnly}
          focusOn={autoFocus ? 'stop' : null}
          onPick={(next, event) => {
            if (readOnly) return
            const details = detailsOf('item-press', event)
            if (next === value) {
              if (deselectable) pick(null, details)
              return
            }
            pick(next, details)
          }}
        />
      )}
    </div>
  )
}

/** Invalid, the calendar takes a destructive outline, dashed in forced colours. */
const invalidClassName =
  'rounded-(--surface-radius) outline-offset-4 data-invalid:outline-1 data-invalid:outline-destructive forced-colors:data-invalid:outline-2 forced-colors:data-invalid:outline-dashed'

/**
 * What the calendar sends with a form: each picked day under its name. In a
 * Field, it joins the form's validation through a hidden input, which hands
 * focus to the grid when the form reports it.
 */
function CalendarForm({
  name,
  form,
  required,
  dates,
  value,
  disabled,
  focus,
  root,
}: {
  name: string | undefined
  form: string | undefined
  required: boolean
  /** What the form sends, each under `name`. */
  dates: readonly string[]
  /** The value as the Field validates it: null until one is picked. */
  value: unknown
  disabled: boolean
  /** Focuses the calendar's tab stop, when the form reports it. */
  focus: () => void
  root: HTMLElement | null
}) {
  const field = useFieldRootContext()
  const { clearErrors } = useFormContext()
  const controlId = useId()
  // The field checks and focuses the hidden input, which hands focus to the grid.
  const control = useRef<HTMLInputElement | null>(null)
  useRegisterFieldControl(control, controlId, value, undefined, !disabled, name)

  // A new pick clears the form's error for it and validates it again.
  const key = dates.join(' ')
  const seen = useRef(key)
  const { validation, setDirty, validityData } = field
  useLayoutEffect(() => {
    if (seen.current === key) return
    seen.current = key
    clearErrors(name)
    setDirty(value !== validityData.initialValue)
    validation.change(value)
  }, [key, value, name, clearErrors, setDirty, validation, validityData])

  const validationRef = useMemo(
    () => mergeRefs(validation.inputRef, control),
    [validation],
  )

  // Leaving the calendar touches the field, and validates it in `onBlur` mode.
  const { setTouched, setFocused, validationMode } = field
  useEffect(() => {
    if (!root) return
    const enter = () => setFocused(true)
    const leave = (event: FocusEvent) => {
      if (event.relatedTarget instanceof Node && root.contains(event.relatedTarget))
        return
      setTouched(true)
      setFocused(false)
      if (validationMode === 'onBlur') void validation.commit(value)
    }
    root.addEventListener('focusin', enter)
    root.addEventListener('focusout', leave)
    return () => {
      root.removeEventListener('focusin', enter)
      root.removeEventListener('focusout', leave)
    }
  }, [root, setTouched, setFocused, validationMode, validation, value])

  return (
    <>
      <FieldValues name={name} form={form} values={dates} />
      <input
        {...validation.getValidationProps(disabled, { onFocus: focus })}
        ref={validationRef}
        form={form}
        value={key}
        onChange={noChange}
        required={required}
        disabled={disabled}
        aria-hidden
        tabIndex={-1}
        className='sr-only'
      />
    </>
  )
}

function noChange() {}

/**
 * Once the months that `from` sat in have turned, focuses the heading at
 * `offset` among the new ones, since the one that had focus left with its
 * months.
 */
function focusHeadingAfter(from: HTMLElement | null, offset: number) {
  const calendar = from?.closest<HTMLElement>('[data-slot=calendar]')
  requestAnimationFrame(() => {
    const columns = [
      ...(calendar?.querySelectorAll<HTMLElement>('[data-slot=calendar-column]') ?? []),
    ].filter((column) => !column.closest('[inert]'))
    columns[offset]?.querySelector<HTMLElement>('[data-slot=calendar-heading]')?.focus()
  })
}

export { Calendar }
export type { CalendarChoiceProps, CalendarDayProps, CalendarProps }
