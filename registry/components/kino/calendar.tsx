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
  bandClassName,
  CALENDAR_LABELS,
  calendarClassName,
  calendarHeadingClassName,
  type CalendarLabels,
  type CalendarLook,
  CalendarLookContext,
  calendarNextPlace,
  CalendarPending,
  calendarPreviousPlace,
  chevrons,
  columnLayout,
  DAY,
  dayClassName,
  type DayContent,
  dayLayout,
  followBands,
  type GridWeeks,
  MonthSlide,
  useCalendarLook,
  useTurnPlaces,
  weekdaysClassName,
  weekLayout,
  weekNumberClassName,
} from '@/registry/lib/calendar-grid'
import {
  CHOICES,
  type ChoiceLevel,
  choicePage,
  choicePageTurn,
  firstShownFor,
  fullDays,
} from '@/registry/lib/calendar-model'
import { useControllable } from '@/registry/lib/controllable'
import { CutTooltip } from '@/registry/lib/cut'
import {
  boundDay,
  type DateMatchers,
  type DateRange,
  dayLabel,
  isISODate,
  isISOMonth,
  isISOYear,
  monthLabel,
  monthOf,
  monthParts,
  useLocale,
  useToday,
  type Weekday,
  weekOfYear,
  weekStart,
  yearMonth,
  yearPage,
} from '@/registry/lib/dates'
import {
  FieldCheck,
  FieldValues,
  keptOnReset,
  useFieldProps,
  useLabelFocus,
} from '@/registry/lib/field-control'
import {
  followPick,
  followPointer,
  highlightClassName,
  itemMatching,
  pickClassName,
} from '@/registry/lib/highlight'
import { pillBackdropClassName, pillClassName } from '@/registry/lib/pill'
import { markMounted, mergeRefs } from '@/registry/lib/refs'
import { Swap } from '@/registry/lib/swap'
import type { ChangeDetails } from '@ui-sdk/core'
import {
  type CalendarDayState,
  type CalendarValueChangeReason,
  Calendar as CalendarPrimitive,
  CalendarDay as CalendarDayPrimitive,
  CalendarGrid as CalendarGridPrimitive,
  CalendarHeading as CalendarHeadingPrimitive,
  CalendarNext as CalendarNextPrimitive,
  CalendarPrevious as CalendarPreviousPrimitive,
  CalendarWeekday,
  createCalendarController,
} from '@ui-sdk/react/calendar'
import {
  type ComponentProps,
  createContext,
  type ReactNode,
  use,
  useCallback,
  useEffect,
  useMemo,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'

import { cn } from '@/lib/utils'

/*
 * ui-sdk's Calendar in Kino's look: ui-sdk holds which month shows, what is
 * picked, a range in progress and the keys of the WAI-ARIA date grid; Kino
 * draws it. A backdrop glides under the pointer and a pill slides to the
 * pick, as on the Tabs; a range is a band that grows along each week. The
 * arrows turn the months, which slide a short way in the direction of
 * travel, and each month's name opens a popover of the year's twelve months,
 * whose year's name steps out to twelve years. The ready-made `Calendar`
 * renders every part; its parts compose a calendar of the buyer's own.
 */

/** How far the months and choices slide and zoom; a buyer's `--calendar-slide` and `--calendar-zoom` win. */
const motion =
  '[--swap-slide:var(--calendar-slide,1.5rem)] [--swap-zoom:var(--calendar-zoom,0.92)]'

/** Why the value changed, as `onValueChange` hears it. */
type CalendarChangeDetails = ChangeDetails<CalendarValueChangeReason>

/* --------------------------------------------------------------------------
 * The parts
 * ------------------------------------------------------------------------ */

/** One backdrop under every month on screen, so it glides from one to the next; a grid on its own draws its own. */
const SharedBackdropContext = createContext(false)

/** ui-sdk's Previous or Next, on a ghost Button, named in the Calendar's words. */
function CalendarTurn({
  direction,
  className,
  ...props
}: Omit<ComponentProps<typeof CalendarPreviousPrimitive>, 'className'> & {
  direction: 'previous' | 'next'
  className?: string
}) {
  const { labels } = useCalendarLook()
  const Part =
    direction === 'previous' ? CalendarPreviousPrimitive : CalendarNextPrimitive
  return (
    <Part
      aria-label={direction === 'previous' ? labels.previousMonth : labels.nextMonth}
      render={
        <Button
          variant='ghost'
          size='icon-sm'
          {...{ [`data-calendar-${direction}`]: '' }}
          className={className}
        />
      }
      {...props}
    >
      {chevrons[direction]}
    </Part>
  )
}

function CalendarPrevious(props: Omit<ComponentProps<typeof CalendarTurn>, 'direction'>) {
  return <CalendarTurn direction='previous' {...props} />
}

function CalendarNext(props: Omit<ComponentProps<typeof CalendarTurn>, 'direction'>) {
  return <CalendarTurn direction='next' {...props} />
}

/** The months on screen, named; the ready-made Calendar keeps it for screen readers, which hear each turn. */
function CalendarHeading({
  className,
  ...props
}: Omit<ComponentProps<typeof CalendarHeadingPrimitive>, 'className'> & {
  className?: string
}) {
  return (
    <CalendarHeadingPrimitive
      className={cn('text-center text-sm font-medium', className)}
      {...props}
    />
  )
}

/** A day's own content: its number in Latin digits, as the Date input writes it, or the buyer's. */
function dayText(look: CalendarLook, date: string) {
  return look.dayContent ? look.dayContent(date) : dayLabel(date, look.locale)
}

/**
 * One of ui-sdk's days, in the Calendar's look. With content of the buyer's,
 * its name is the full date and then what they show.
 */
function CalendarDay({
  className,
  ...props
}: Omit<
  ComponentProps<typeof CalendarDayPrimitive>,
  'className' | 'render' | 'children'
> & {
  className?: string
}) {
  const look = useCalendarLook()
  return (
    <CalendarDayPrimitive
      {...props}
      render={(own: Record<string, unknown>, state: CalendarDayState) => {
        const full = look.full?.(state.date) === true
        return (
          <span
            {...own}
            aria-label={look.dayContent ? undefined : (own['aria-label'] as string)}
            aria-disabled={full ? 'true' : (own['aria-disabled'] as 'true' | undefined)}
            data-full={full ? '' : undefined}
          >
            {look.dayContent && (
              <span className='sr-only'>{own['aria-label'] as string}</span>
            )}
            {own.children as ReactNode}
          </span>
        )
      }}
      className={cn(dayClassName, className)}
    >
      {dayText(look, props.value)}
    </CalendarDayPrimitive>
  )
}

/** A week's number, which heads its row. */
function WeekNumber({ date }: { date: string }) {
  const look = useCalendarLook()
  const week = weekOfYear(date, look.weekStartsOn)
  return (
    <span
      role='rowheader'
      aria-label={look.labels.week(week)}
      className={weekNumberClassName}
    >
      {week}
    </span>
  )
}

/** A month's weeks: the weekday row, then a row a week, each with its band, its number and its days. */
function MonthWeeks({ month, weeks }: { month: string; weeks: GridWeeks }) {
  const look = useCalendarLook()
  const shared = use(SharedBackdropContext)
  const areaRef = useRef<HTMLDivElement>(null)
  const areaRefs = useMemo(() => mergeRefs(areaRef, markMounted), [])
  const pillRef = useRef<HTMLSpanElement>(null)
  const backdropRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    const area = areaRef.current
    const pill = pillRef.current
    if (!area || !pill) return
    const stopPick = followPick(area, pill, {
      picked: () =>
        area.querySelector<HTMLElement>(`${DAY}[data-selected]:not([data-outside])`),
      attributes: ['data-selected'],
    })
    const backdrop = backdropRef.current
    const stopHover = backdrop
      ? followPointer(area, backdrop, { itemOf: itemMatching(area, DAY), focus: true })
      : () => {}
    return () => {
      stopPick()
      stopHover()
    }
  }, [])

  // Before the first paint, so a month's bands show in place as it arrives.
  useLayoutEffect(() => {
    const area = areaRef.current
    return area ? followBands(area) : undefined
  }, [])

  return (
    <div
      ref={areaRefs}
      data-calendar-month={month}
      className='relative isolate flex w-full flex-col'
    >
      {shared ? null : (
        <span
          ref={backdropRef}
          aria-hidden
          className={cn(highlightClassName, pillBackdropClassName)}
        />
      )}
      <div
        role='row'
        className={cn(weekLayout, weekdaysClassName, 'text-xs text-muted-foreground')}
      >
        {look.showWeekNumbers && (
          <span role='columnheader'>
            <span className='sr-only'>{look.labels.weekNumbers}</span>
          </span>
        )}
        {Array.from({ length: 7 }, (_, index) => (
          <CalendarWeekday
            // oxlint-disable-next-line react/no-array-index-key -- a week's columns keep their order
            key={index}
            index={index}
            render={<span />}
            className='flex items-center justify-center font-normal'
          />
        ))}
      </div>
      {weeks.map((week) => (
        <div key={week[0].date} role='row' data-calendar-week='' className={weekLayout}>
          <span
            aria-hidden
            data-calendar-band=''
            data-empty=''
            className={bandClassName}
          />
          {look.showWeekNumbers && <WeekNumber date={week[0].date} />}
          {week.map((cell) =>
            cell.hidden ? (
              // Holds the day's square, so a week of hidden days keeps its height.
              // oxlint-disable-next-line jsx-a11y/control-has-associated-label -- an empty cell, as ui-sdk's own grid draws a hidden day's <td>
              <span
                key={cell.date}
                role='gridcell'
                data-calendar-empty=''
                className='m-px aspect-square'
              />
            ) : (
              <CalendarDay key={cell.date} value={cell.date} />
            ),
          )}
        </div>
      ))}
      <span
        ref={pillRef}
        aria-hidden
        inert
        className={cn(
          pickClassName,
          pillClassName,
          'z-10 hidden group-data-[mode=single]/calendar:block group-data-disabled/calendar:data-[highlight=shown]:opacity-50',
        )}
      >
        <span className='flex flex-col'>
          <span className={weekdaysClassName} />
          {weeks.map((week) => (
            <span key={week[0].date} className={weekLayout}>
              {look.showWeekNumbers && <span />}
              {week.map((cell) => (
                <span
                  key={cell.date}
                  data-today={look.today === cell.date ? '' : undefined}
                  className={dayLayout}
                >
                  {cell.hidden ? null : dayText(look, cell.date)}
                </span>
              ))}
            </span>
          ))}
        </span>
      </span>
    </div>
  )
}

/**
 * ui-sdk's grid of one month's days, `offset` months after the first on
 * screen, as a column whose weeks slide the way the months travel. Without
 * children it draws the weekday row and the weeks; a function of the grid's
 * state draws what it returns. `heading` draws above the grid, outside it,
 * for the month it shows, since a grid holds only its rows.
 */
function CalendarGrid({
  offset = 0,
  heading,
  className,
  children,
  ...props
}: Omit<ComponentProps<typeof CalendarGridPrimitive>, 'className' | 'children'> & {
  heading?: (month: string) => ReactNode
  className?: string
  children?: ComponentProps<typeof CalendarGridPrimitive>['children']
}) {
  const column = cn(columnLayout, 'gap-1', className)
  return (
    <CalendarGridPrimitive
      offset={offset}
      render={(own: ComponentProps<'span'>, grid: { month: string }) =>
        heading ? (
          <span data-calendar-column='' className={column}>
            {heading(grid.month)}
            <span {...own} className='w-full' />
          </span>
        ) : (
          <span {...own} data-calendar-column='' className={column} />
        )
      }
      {...props}
    >
      {children ??
        ((grid) => (
          <MonthSlide month={grid.month} block className='w-full'>
            <MonthWeeks month={grid.month} weeks={grid.weeks} />
          </MonthSlide>
        ))}
    </CalendarGridPrimitive>
  )
}

/* --------------------------------------------------------------------------
 * Choices of months and years
 * ------------------------------------------------------------------------ */

/** How a picker of months or years moved to its page: a turn slides, a change of level zooms. */
type ChoiceMove = { slide?: 1 | -1; zoom?: 'in' | 'out' }

/** The buttons that turn a page of choices, on a ghost Button. */
function ChoiceTurn({
  direction,
  ...props
}: Omit<ComponentProps<typeof Button>, 'children' | 'variant' | 'size'> & {
  direction: 'previous' | 'next'
}) {
  return (
    <Button
      variant='ghost'
      size='icon-sm'
      {...{ [`data-calendar-${direction}`]: '' }}
      {...props}
    >
      {chevrons[direction]}
    </Button>
  )
}

/**
 * A year's months, or twelve years, to pick from: arrows either side turn
 * the page, and a year's name steps out to its twelve years, whose pick
 * steps back in to that year's months. A month's heading opens one in a
 * popover; to the month or the year, the Calendar is one.
 */
function ChoicePicker({
  labels,
  locale,
  bounds,
  today,
  picked,
  opensOn,
  final,
  disabled,
  readOnly,
  focusOn: firstFocus = null,
  name = {},
  onLevelChange,
  onPick,
}: {
  labels: CalendarLabels
  locale: string
  /** The first and last days that can be chosen from, as `yyyy-mm-dd`. */
  bounds: { min?: string; max?: string }
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
  focusOn?: string | null
  /** The calendar's name, which names its grid before the page's title. */
  name?: { 'aria-label'?: string; 'aria-labelledby'?: string }
  /** The level it shows now, once it steps out or in. */
  onLevelChange?: (level: ChoiceLevel) => void
  onPick: (value: string, event: Event | undefined) => void
}) {
  const titleId = useId()
  // What it shows: a year's months, or a page of years from `year`.
  const [view, setView] = useState(opensOn)
  const [moved, setMoved] = useState<ChoiceMove>({})
  const [focusOn, setFocusOn] = useState<string | null>(firstFocus)
  const { level, year } = view
  const pageAt = (at: ChoiceLevel, start: number) =>
    choicePage(at, start, { shown: picked, today, rules: bounds, locale })

  const show = (next: ChoiceLevel, at: number, how: ChoiceMove, focus: string | null) => {
    setView({ level: next, year: at })
    setMoved(how)
    setFocusOn(focus)
    if (next !== level) onLevelChange?.(next)
  }

  const page = pageAt(level, year)
  const { title } = page
  /**
   * Turns to the page `direction`, if it has anything to choose. A key past
   * the grid's edge lands on the choice at `landing` once the page is drawn;
   * a button that then has nowhere to go hands focus to the grid.
   */
  const turn = (direction: 1 | -1, landing: number | null = null) => {
    const target = direction === 1 ? page.next : page.previous
    if (target === null) return
    const lands =
      landing === null ? undefined : pageAt(level, target).choices[landing]?.value
    const last =
      landing === null && choicePageTurn(level, target, direction, bounds) === null
    show(level, target, { slide: direction }, lands ?? (last ? 'stop' : null))
  }
  const choices = disabled
    ? page.choices.map((choice) => ({ ...choice, disabled: true }))
    : page.choices
  const valueAt = (index: number) => (index >= 0 ? page.choices[index].value : null)

  return (
    <>
      <span id={titleId} aria-live='polite' className='sr-only'>
        {title}
      </span>
      <div className='flex items-center justify-between gap-1'>
        <ChoiceTurn
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
              data-calendar-heading=''
              aria-label={labels.chooseYear(title)}
              disabled={disabled}
              onClick={() => {
                const first = yearPage(year, CHOICES)
                show('years', first, { zoom: 'out' }, String(year))
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
        <ChoiceTurn
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
          current={valueAt(page.current)}
          today={valueAt(page.today)}
          label={name['aria-label'] ? `${name['aria-label']}, ${title}` : title}
          labelledBy={
            name['aria-labelledby'] ? `${name['aria-labelledby']} ${titleId}` : undefined
          }
          focusOn={focusOn}
          readOnly={readOnly}
          disabled={disabled}
          onPage={(direction, index) => turn(direction, index)}
          onPick={(value, event) => {
            if (level === 'years' && final === 'months') {
              const at = Number(value)
              const month = picked ? monthParts(picked).month : 1
              show('months', at, { zoom: 'in' }, yearMonth(at, month))
              return
            }
            onPick(level === 'years' ? value.padStart(4, '0') : value, event)
          }}
        />
      </Swap>
    </>
  )
}

/** A month's name, which opens a popover of its year's months. */
function MonthPopover({ month, offset }: { month: string; offset: number }) {
  const look = useCalendarLook()
  const [open, setOpen] = useState(false)
  // Each opening starts afresh on the shown month's year, even while the last one still fades out.
  const [opened, setOpened] = useState(0)
  const [level, setLevel] = useState<ChoiceLevel>('months')
  // The month just picked, which keeps the pill while the popover closes.
  const [picked, setPicked] = useState<string | null>(null)
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
  const name = monthLabel(month, look.locale, look.monthFormat)

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
      }}
    >
      <CutTooltip
        render={
          <PopoverTrigger
            disabled={look.disabled}
            ref={triggerRefs}
            render={
              <Button
                variant='ghost'
                size='sm'
                data-calendar-heading=''
                aria-label={look.labels.chooseMonth(name)}
                className='min-w-0'
              />
            }
          >
            <span data-cut className='truncate'>
              {name}
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
        aria-label={level === 'months' ? look.labels.months : look.labels.years}
        anchor={anchor}
        className={`w-[calc(var(--control-height)*7)] gap-1 ${motion}`}
        initialFocus='[data-slot=calendar-choices-choice][tabindex="0"]'
      >
        <ChoicePicker
          key={opened}
          labels={look.labels}
          locale={look.locale}
          bounds={look.bounds}
          today={look.today}
          picked={picked ?? month}
          opensOn={{ level: 'months', year: monthParts(month).year }}
          final='months'
          onLevelChange={setLevel}
          onPick={(value) => {
            left.current = triggerRef.current?.getBoundingClientRect() ?? null
            const first = firstShownFor(value, offset, look.months, look.bounds)
            look.showMonth(first)
            // This heading leaves with the months it named, and the popover
            // with it: focus goes to the heading that takes its place.
            setPicked(value)
            setOpen(false)
            focusHeadingAfter(triggerRef.current, offset)
          }}
        />
      </PopoverContent>
    </Popover>
  )
}

/**
 * Once the months that `from` sat in have turned, focuses the heading at
 * `offset` among the new ones, since the one that had focus left with its
 * months.
 */
function focusHeadingAfter(from: HTMLElement | null, offset: number) {
  const calendar = from?.closest<HTMLElement>('[data-calendar-months]')
  requestAnimationFrame(() => {
    const columns = [
      ...(calendar?.querySelectorAll<HTMLElement>('[data-calendar-column]') ?? []),
    ]
    const headings = [
      ...(columns[offset]?.querySelectorAll<HTMLElement>('[data-calendar-heading]') ??
        []),
    ].filter((heading) => !heading.closest('[inert]'))
    headings[0]?.focus()
  })
}

/**
 * The months on screen in a row that wraps into a column when there isn't
 * room, each under a heading that opens its months, with the arrows on the
 * first and last month's heading and one backdrop under every month. What
 * the ready-made Calendar and the Date picker's popup draw.
 */
function CalendarMonths({ className }: { className?: string }) {
  const look = useCalendarLook()
  const [root, setRoot] = useState<HTMLDivElement | null>(null)
  useTurnPlaces(root)
  const areaRef = useRef<HTMLSpanElement>(null)
  const backdropRef = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    const area = areaRef.current
    const backdrop = backdropRef.current
    if (!area || !backdrop) return
    return followPointer(area, backdrop, { itemOf: itemMatching(area, DAY), focus: true })
  }, [])

  return (
    <div
      ref={setRoot}
      data-calendar-months=''
      data-mode={look.mode}
      data-disabled={look.disabled ? '' : undefined}
      data-week-numbers={look.showWeekNumbers ? '' : undefined}
      className={cn('group/calendar relative w-full', motion, className)}
    >
      <CalendarHeading className='sr-only' />
      <CalendarPrevious className={calendarPreviousPlace} />
      <CalendarNext className={calendarNextPlace} />
      <span
        ref={areaRef}
        className='relative isolate flex w-full flex-wrap gap-x-(--surface-padding-lg) gap-y-(--surface-gap)'
      >
        <span
          ref={backdropRef}
          aria-hidden
          className={cn(highlightClassName, pillBackdropClassName)}
        />
        <SharedBackdropContext value>
          {Array.from({ length: look.months }, (_, offset) => (
            <CalendarGrid
              // oxlint-disable-next-line react/no-array-index-key -- a grid is its place among the months
              key={offset}
              offset={offset}
              heading={(month) => (
                <span className={calendarHeadingClassName}>
                  <MonthSlide
                    month={month}
                    still={false}
                    className='flex min-w-0 justify-center'
                  >
                    <MonthPopover month={month} offset={offset} />
                  </MonthSlide>
                </span>
              )}
            />
          ))}
        </SharedBackdropContext>
      </span>
    </div>
  )
}

/* --------------------------------------------------------------------------
 * The Calendar
 * ------------------------------------------------------------------------ */

/**
 * The naming a calendar takes in a Field: its label names it and focuses
 * its tab stop, and its description and error describe it. `props` go on the
 * calendar's root, with `ref`. ui-sdk's Calendar doesn't join a Field, so the
 * Field control lib joins it.
 */
function useCalendarNaming(
  {
    id: ownId,
    'aria-label': ariaLabel,
    'aria-labelledby': ariaLabelledBy,
    'aria-describedby': ariaDescribedBy,
  }: Pick<
    ComponentProps<'div'>,
    'id' | 'aria-label' | 'aria-labelledby' | 'aria-describedby'
  >,
  disabled: boolean,
  focus: () => void,
) {
  const { field, invalid, props } = useFieldProps(
    {
      id: ownId,
      'aria-labelledby': ariaLabelledBy,
      'aria-describedby': ariaDescribedBy,
    },
    { id: ownId },
  )
  const {
    ref,
    id,
    'aria-labelledby': labelledBy,
    'aria-describedby': describedBy,
  } = props
  useLabelFocus(ariaLabelledBy ? undefined : labelledBy?.split(' ')[0], disabled, focus)
  return {
    field,
    invalid,
    ref,
    props: {
      id,
      'aria-label': ariaLabel,
      'aria-labelledby': ariaLabelledBy ?? (ariaLabel ? undefined : labelledBy),
      'aria-describedby': describedBy,
    },
  }
}

/** Invalid, the calendar takes a destructive outline, dashed in forced colours. */
const invalidClassName =
  'rounded-(--surface-radius) outline-offset-4 data-invalid:outline-1 data-invalid:outline-destructive forced-colors:data-invalid:outline-2 forced-colors:data-invalid:outline-dashed'

/** What a calendar sends with a form, each date under `name`, and its check: `required` turns it down while nothing is picked. */
function CalendarForm({
  name,
  form,
  required,
  dates,
  many = false,
  disabled,
  focus,
  reset,
}: {
  name: string | undefined
  form: string | undefined
  required: boolean
  /** What the form sends, each under `name`. */
  dates: readonly string[]
  /** Whether it picks several dates, so a Form's values hold a list under `name`. */
  many?: boolean
  disabled: boolean
  /** Focuses the calendar's tab stop, when the form reports it. */
  focus: () => void
  /** Puts the calendar back to its default when the form is reset. */
  reset: (event: Event) => void
}) {
  return (
    <>
      <FieldValues
        name={disabled ? undefined : name}
        form={form}
        values={dates}
        many={many}
      />
      <FieldCheck
        value={dates.join(' ')}
        form={form}
        required={required}
        disabled={disabled}
        onFocus={focus}
        onReset={reset}
      />
    </>
  )
}

/** The dates a value holds, in order. */
function datesOf(value: unknown): string[] {
  if (typeof value === 'string') return isISODate(value) ? [value] : []
  if (Array.isArray(value)) return value.filter((date): date is string => isISODate(date))
  return []
}

interface CalendarSingle {
  mode?: 'single'
  /** The picked day, as `yyyy-mm-dd`. */
  value?: string | null
  defaultValue?: string | null
  onValueChange?: (value: string | null, details: CalendarChangeDetails) => void
}

interface CalendarMultiple {
  mode: 'multiple'
  /** The picked days, sorted. */
  value?: string[]
  defaultValue?: string[]
  onValueChange?: (value: string[], details: CalendarChangeDetails) => void
  /** The most days that can be picked. */
  maxDays?: number
}

interface CalendarRange {
  mode: 'range'
  /** The picked range, start first; null until both ends are picked. */
  value?: DateRange | null
  defaultValue?: DateRange | null
  onValueChange?: (value: DateRange | null, details: CalendarChangeDetails) => void
  /** The fewest days a range can span, counting both ends. */
  minDays?: number
  /** The most days a range can span, counting both ends. */
  maxDays?: number
}

type CalendarPrimitiveProps = ComponentProps<typeof CalendarPrimitive>

/** What the Calendar to the day takes besides its value. */
type CalendarDayOptions = Omit<
  CalendarPrimitiveProps,
  | 'mode'
  | 'value'
  | 'defaultValue'
  | 'onValueChange'
  | 'minDays'
  | 'maxDays'
  | 'unavailable'
  | 'weekStartsOn'
  | 'className'
  | 'children'
> & {
  /** Picks days (`yyyy-mm-dd`); `month` and `year` are the choice calendar's. */
  granularity?: 'day'
  /** Days that can't be picked: a date, `{ from, to }`, `{ weekday: [0, 6] }`, `{ before }`, `{ after }`, a function, or a list of these. */
  unavailable?: DateMatchers
  /** The first day of the week, 0 for Sunday. The locale's by default. */
  weekStartsOn?: Weekday
  /** Shows each week's number before its days. */
  showWeekNumbers?: boolean
  /** What each day shows, under its full date, which a screen reader hears first. */
  dayContent?: DayContent
  /** Sends the picked dates with a form, each under this name. */
  name?: string
  /** The form the value goes with, when the calendar sits outside it. */
  form?: string
  /** A form can't be sent until a date is picked. */
  required?: boolean
  /** Marks the calendar as holding a value that isn't allowed; in a Field, its validity decides. */
  invalid?: boolean
  labels?: Partial<CalendarLabels>
  className?: string
  /** Its parts, for a calendar of your own; the months with their headings and arrows by default. */
  children?: ReactNode
}

/** The Calendar to the day: one day, several or a range, picked from its months. */
type CalendarDayProps = CalendarDayOptions &
  (CalendarSingle | CalendarMultiple | CalendarRange)

interface CalendarChoiceOptions {
  /** The smallest unit picked: a month (`yyyy-mm`) from a year's twelve, or a year (`yyyy`) from twelve years. */
  granularity: 'month' | 'year'
  /** One month or year is picked at a time. */
  mode?: 'single'
  /** The picked month as `yyyy-mm`, or year as `yyyy`. */
  value?: string | null
  defaultValue?: string | null
  onValueChange?: (
    value: string | null,
    details: { reason: 'item-press' | 'reset'; event?: Event },
  ) => void
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

/** A calendar's props: its days', or with `granularity`, its months' or years'. */
type CalendarProps = CalendarDayProps | CalendarChoiceProps

function picksChoices(props: CalendarProps): props is CalendarChoiceProps {
  return props.granularity === 'month' || props.granularity === 'year'
}

/**
 * A calendar, ready-made: its months with their headings and arrows, or with
 * `granularity`, a year's months or twelve years. Its parts compose a
 * calendar of your own inside it.
 */
function Calendar(props: CalendarProps) {
  return picksChoices(props) ? <ChoiceCalendar {...props} /> : <DayCalendar {...props} />
}

function DayCalendar(allProps: CalendarDayProps) {
  const {
    className,
    children,
    dayContent,
    showWeekNumbers = false,
    labels: labelsProp,
    name: nameProp,
    form,
    required = false,
    invalid: invalidProp,
    granularity,
    mode = 'single',
    value,
    defaultValue,
    onValueChange,
    min: minProp,
    max: maxProp,
    unavailable,
    disabled: disabledProp,
    readOnly = false,
    locale: localeProp,
    weekStartsOn,
    months = 1,
    fixedWeeks = true,
    monthFormat = 'long',
    today: todayProp,
    timeZone,
    month,
    defaultMonth,
    controller: controllerProp,
    minDays,
    maxDays,
    ref,
    'aria-label': ariaLabel,
    'aria-labelledby': ariaLabelledBy,
    'aria-describedby': ariaDescribedBy,
    ...rest
  } = allProps as CalendarDayOptions & {
    mode?: 'single' | 'multiple' | 'range'
    value?: unknown
    defaultValue?: unknown
    onValueChange?: unknown
    minDays?: number
    maxDays?: number
  }
  // Only ever to the day here, and not an attribute of the root.
  // oxlint-disable-next-line typescript/no-meaningless-void-operator -- marks a prop kept out of the rest
  void granularity

  const [own] = useState(createCalendarController)
  const controller = controllerProp ?? own
  const locale = useLocale(localeProp)
  const clock = useToday(timeZone)
  const today = isISODate(todayProp) ? todayProp : clock
  const first = weekStartsOn ?? weekStart(locale)
  const labels = useMemo(() => ({ ...CALENDAR_LABELS, ...labelsProp }), [labelsProp])
  const bounds = useMemo(
    () => ({ min: boundDay(minProp, 'start'), max: boundDay(maxProp, 'end') }),
    [minProp, maxProp],
  )

  const focus = useCallback(() => controller.focus(), [controller])
  const naming = useCalendarNaming(
    {
      id: rest.id,
      'aria-label': ariaLabel,
      'aria-labelledby': ariaLabelledBy,
      'aria-describedby': ariaDescribedBy,
    },
    disabledProp === true,
    focus,
  )
  const disabled = disabledProp === true || naming.field?.disabled === true
  const name = nameProp ?? naming.field?.name
  const invalid = invalidProp ?? naming.invalid
  const rootRef = useMemo(() => mergeRefs(ref, naming.ref), [ref, naming.ref])

  // Several picks stop at `maxDays`: every other day fades until one is taken
  // out, and a change to more days than that is turned down, so a reset or
  // an agent can still replace the whole set.
  const full = useMemo(
    () =>
      mode === 'multiple' && maxDays !== undefined
        ? (date: string) =>
            fullDays(datesOf(controller.getValue()), maxDays)?.(date) ?? false
        : null,
    [mode, maxDays, controller],
  )
  const onPick = useMemo(() => {
    const own = onValueChange as
      | ((next: unknown, details: ChangeDetails) => void)
      | undefined
    if (mode !== 'multiple' || maxDays === undefined) return own
    return (next: unknown, details: ChangeDetails) => {
      if (datesOf(next).length > maxDays) return details.cancel()
      own?.(next, details)
    }
  }, [mode, maxDays, onValueChange])

  const look: CalendarLook = {
    mode,
    disabled,
    locale,
    labels,
    weekStartsOn: first,
    months,
    monthFormat,
    showWeekNumbers,
    dayContent,
    full,
    bounds,
    today,
    showMonth: (shown: string) => controller.setMonth(shown),
  }

  // With nothing picked and no month given, the first month is today's,
  // which the server can't know: it shows no month until the visitor's
  // clock is read, so the server and the page agree.
  const waits =
    today === null &&
    month === undefined &&
    defaultMonth === undefined &&
    datesOf(value ?? defaultValue).length === 0

  return (
    <CalendarLookContext value={look}>
      <CalendarPrimitive
        {...rest}
        {...naming.props}
        // Every calendar's root is found by this, to the day or to the month or year alike.
        data-calendar=''
        // A group, so its name, description and error reach a screen reader with the day in focus.
        role='group'
        ref={rootRef}
        controller={controller}
        mode={mode}
        value={value as CalendarPrimitiveProps['value']}
        defaultValue={defaultValue as CalendarPrimitiveProps['defaultValue']}
        onValueChange={onPick as CalendarPrimitiveProps['onValueChange']}
        min={bounds.min}
        max={bounds.max}
        unavailable={unavailable}
        minDays={mode === 'range' ? minDays : undefined}
        maxDays={mode === 'range' ? maxDays : undefined}
        disabled={disabled}
        readOnly={readOnly}
        locale={locale}
        weekStartsOn={first}
        months={months}
        fixedWeeks={fixedWeeks}
        monthFormat={monthFormat}
        today={today ?? undefined}
        timeZone={timeZone}
        month={month}
        defaultMonth={defaultMonth}
        data-invalid={invalid ? '' : undefined}
        className={cn(
          calendarClassName,
          'relative gap-1',
          invalidClassName,
          motion,
          className,
        )}
      >
        {(state) => (
          <>
            <CalendarForm
              name={name}
              form={form}
              required={required}
              dates={datesOf(state.value)}
              many={mode === 'multiple'}
              disabled={disabled}
              focus={focus}
              reset={() => {
                if (keptOnReset(value, defaultValue)) return
                const initial = defaultValue ?? (mode === 'multiple' ? [] : null)
                controller.setValue(initial as never)
              }}
            />
            {waits ? <CalendarPending /> : (children ?? <CalendarMonths />)}
          </>
        )}
      </CalendarPrimitive>
    </CalendarLookContext>
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
  defaultValue,
  onValueChange,
  min: minProp,
  max: maxProp,
  deselectable,
  disabled: disabledProp,
  readOnly = false,
  locale: localeProp,
  today: todayProp,
  timeZone,
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
  // oxlint-disable-next-line typescript/no-meaningless-void-operator -- marks a prop kept out of the rest
  void mode
  const locale = useLocale(localeProp)
  const clock = useToday(timeZone)
  const today = isISODate(todayProp) ? todayProp : clock
  const labels = { ...CALENDAR_LABELS, ...labelsProp }
  const bounds = { min: boundDay(minProp, 'start'), max: boundDay(maxProp, 'end') }
  const final: ChoiceLevel = granularity === 'month' ? 'months' : 'years'
  const fits = granularity === 'month' ? isISOMonth : isISOYear

  const [given, pick] = useControllable<
    string | null,
    [{ reason: 'item-press' | 'reset'; event?: Event }]
  >(valueProp, defaultValue ?? null, onValueChange)
  const value = fits(given) ? given : null

  // The picked month, as the picker marks it: a year's first month for a year.
  const picked = value === null ? null : granularity === 'month' ? value : `${value}-01`
  const around = monthParts(picked ?? (today ? monthOf(today) : '2000-01')).year
  const opensOn =
    final === 'months'
      ? { level: final, year: around }
      : { level: final, year: yearPage(around, CHOICES) }

  const [root, setRoot] = useState<HTMLDivElement | null>(null)
  const focus = useCallback(() => {
    root
      ?.querySelector<HTMLElement>('[data-slot=calendar-choices-choice][tabindex="0"]')
      ?.focus({ preventScroll: true })
  }, [root])
  const naming = useCalendarNaming(
    {
      id: rest.id,
      'aria-label': ariaLabel,
      'aria-labelledby': ariaLabelledBy,
      'aria-describedby': ariaDescribedBy,
    },
    disabledProp === true,
    focus,
  )
  const disabled = disabledProp === true || naming.field?.disabled === true
  const name = nameProp ?? naming.field?.name
  const invalid = invalidProp ?? naming.invalid
  const rootRef = useMemo(
    () => mergeRefs<HTMLDivElement>(ref, setRoot, naming.ref),
    [ref, naming.ref],
  )

  return (
    <div
      role='group'
      data-calendar=''
      data-calendar-granularity={granularity}
      data-disabled={disabled ? '' : undefined}
      data-readonly={readOnly ? '' : undefined}
      data-invalid={invalid ? '' : undefined}
      {...rest}
      {...naming.props}
      ref={rootRef}
      className={cn(calendarClassName, 'gap-1', invalidClassName, motion, className)}
    >
      <CalendarForm
        name={name}
        form={form}
        required={required}
        dates={value === null ? [] : [value]}
        disabled={disabled}
        focus={focus}
        reset={(event) => {
          if (keptOnReset(valueProp, defaultValue)) return
          const initial = fits(defaultValue) ? defaultValue : null
          if (initial !== value) pick(initial, { reason: 'reset', event })
        }}
      />
      {today === null && todayProp === undefined ? (
        // The server can't know the visitor's today, which the page opens around.
        <CalendarPending />
      ) : (
        <ChoicePicker
          labels={labels}
          locale={locale}
          bounds={bounds}
          today={today}
          picked={picked}
          opensOn={opensOn}
          final={final}
          disabled={disabled}
          readOnly={readOnly}
          name={naming.props}
          onPick={(next, event) => {
            if (readOnly) return
            const details = { reason: 'item-press' as const, event }
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

export {
  Calendar,
  CalendarDay,
  CalendarGrid,
  CalendarHeading,
  CalendarMonths,
  CalendarNext,
  CalendarPrevious,
}
export type {
  CalendarChangeDetails,
  CalendarChoiceProps,
  CalendarDayProps,
  CalendarProps,
}
