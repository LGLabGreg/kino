'use client'

import type { CalendarChoice } from '@/registry/lib/calendar-model'
import {
  followPick,
  followPointer,
  highlightClassName,
  itemMatching,
  pickClassName,
} from '@/registry/lib/highlight'
import { pillBackdropClassName, pillClassName } from '@/registry/lib/pill'
import { markMounted } from '@/registry/lib/refs'
import {
  type ChangeDetails,
  createChange,
  createRovingFocus,
  definePrimitive,
} from '@ui-sdk/core'
import { type PrimitiveHandle, usePart, usePrimitive } from '@ui-sdk/react/primitive'
import { useEffect, useRef } from 'react'

import { cn } from '@/lib/utils'

/*
 * Twelve months or twelve years to pick from, drawn as the Calendar draws
 * its days: a backdrop under the pointer, a pill on the current one, and the
 * arrow keys of a grid. A key that moves past an edge turns the page. Three
 * to a row in a month's width; in a taller box its rows spread out to fill it.
 */

/** Three choices to a row, in a month's width. */
const COLUMNS = 3

/**
 * Where a key sends focus in a grid of `count` cells, `columns` wide: the
 * arrows a cell or a row (left and right swapped in right to left), Home and
 * End the row's ends. Null for a key the grid doesn't handle; a number below
 * 0 or from `count` up is a move past its edge, which turns the page.
 */
function cellTarget(
  index: number,
  key: string,
  { columns, rtl = false }: { columns: number; rtl?: boolean },
): number | null {
  const side = rtl ? -1 : 1
  const row = index - (index % columns)
  const moves: Record<string, number> = {
    ArrowLeft: index - side,
    ArrowRight: index + side,
    ArrowUp: index - columns,
    ArrowDown: index + columns,
    Home: row,
    End: row + columns - 1,
  }
  return key in moves ? moves[key] : null
}

/** A choice as the grid holds it: `value` is its key. */
type Choice = Pick<CalendarChoice, 'label' | 'disabled'> & { value: string }

interface CalendarChoicesOptions {
  /** The choices on this page, in order. */
  choices?: readonly Choice[]
  /** The value of the one on screen now, or null. */
  value?: string | null
  /** A choice was picked. */
  onValueChange?: (value: string, details: ChangeDetails<'item-press'>) => void
  /**
   * Turns the page when a key moves past the grid's edge, to land on choice
   * `index` of the new page, which takes focus once it is drawn. Focus stays
   * where it is when there is no page that way.
   */
  onPage?: (step: 1 | -1, index: number) => void
  /** The choices can be looked through but not picked. */
  readOnly?: boolean
  disabled?: boolean
}

const calendarChoices = definePrimitive({
  name: 'calendar-choices',
  options: {
    choices: 'list',
    value: 'string',
    onValueChange: 'callback',
    onPage: 'callback',
    readOnly: 'boolean',
    disabled: 'boolean',
  },
  controlled: ['value'],
  state: (options: CalendarChoicesOptions) => ({
    value: options.value ?? null,
    focused: null as string | null,
  }),
  sync: (options) => ({ value: options.value ?? null }),
  api: (context) => {
    const change = createChange(context)
    const choiceOf = (value: string) =>
      (context.options().choices ?? []).find((choice) => choice.value === value)
    const firstOpen = () =>
      (context.options().choices ?? []).find((choice) => !choice.disabled)?.value
    const roving = createRovingFocus(context, {
      slot: 'choice',
      key: 'focused',
      disabled: (item: { props: { disabled?: boolean } }) => !!item.props.disabled,
      preferred: (item) => item.key === context.store.get().value,
      claims: (state, item) =>
        state.value !== null && choiceOf(state.value) && !choiceOf(state.value)?.disabled
          ? item.key === state.value
          : item.key === firstOpen(),
      move: (event, { from, items, rtl }) => {
        if (event.altKey || event.ctrlKey || event.metaKey) return
        const choices = context.options().choices ?? []
        const index = choices.findIndex((choice) => choice.value === from.key)
        const target = cellTarget(index, event.key, { columns: COLUMNS, rtl })
        if (target === null) return
        // Past an edge the page turns, and the new page focuses where the key lands.
        if (target < 0) {
          context.options().onPage?.(-1, target + choices.length)
          return from.key
        }
        if (target >= choices.length) {
          context.options().onPage?.(1, target - choices.length)
          return from.key
        }
        return items.find((item) => item.key === choices[target].value)?.key ?? from.key
      },
    })
    /** Picks a choice, as a press on it does. */
    const setValue = (value: string, event?: Event) => {
      const { readOnly, disabled } = context.options()
      const choice = choiceOf(value)
      if (!choice) {
        throw new Error(
          `No choice "${value}". Choices: ${(context.options().choices ?? []).map((item) => item.value).join(', ')}.`,
        )
      }
      if (readOnly || disabled || choice.disabled) return false
      return change('value', value, { reason: 'item-press', event })
    }
    return {
      roving,
      setValue,
      /** The choices on the page, for an agent. */
      choices: () =>
        (context.options().choices ?? []).map(({ value, label, disabled }) => ({
          value,
          label,
          disabled,
        })),
      keydown(event: KeyboardEvent, el: HTMLElement, value: string) {
        if (event.defaultPrevented) return
        if ((event.key === 'Enter' || event.key === ' ') && !event.repeat) {
          event.preventDefault()
          setValue(value, event)
          return
        }
        roving.keydown(event, el)
      },
    }
  },
  slots: (slot) => ({
    root: slot({
      role: 'grid',
      keys: { none: 'Focus stays on a choice, whose keydown handles them.' },
    }),
    row: slot({ role: 'row' }),
    choice: slot<
      { value: string; today?: boolean; disabled?: boolean },
      { current: boolean }
    >({
      role: 'gridcell',
      focus: 'roving',
      props: { value: 'string', today: 'boolean', disabled: 'boolean' },
      state: (state, { props }) => ({ current: state.value === props.value }),
      attrs: (state, part) => ({
        tabindex: part.api.roving.tabIndex(state, part),
        'aria-selected': String(state.value === part.props.value),
        'aria-disabled': part.props.disabled ? 'true' : undefined,
        'aria-current': part.props.today ? 'date' : undefined,
        'data-current': state.value === part.props.value ? '' : undefined,
        'data-today': part.props.today ? '' : undefined,
      }),
      press: ({ api, props }, event) => {
        api.setValue(props.value, event)
      },
      on: {
        keydown: (event, { api, el, props }) => {
          if (el) api.keydown(event as KeyboardEvent, el, props.value)
        },
      },
      bind: (el, part) => part.api.roving.bind(el, part),
    }),
  }),
  agent: { actions: ['setValue'], closed: true, items: (api) => api.choices() },
})

/** A choice's box, shared by its cell and the pill's copy of it. */
const choiceLayout =
  'relative flex h-(--control-height) items-center justify-center rounded-(--control-radius) text-sm tabular-nums select-none data-today:font-semibold'

const choiceClassName = cn(
  choiceLayout,
  'w-full text-foreground transition-[color,box-shadow] duration-(--motion-press-duration) ease-(--motion-press-fade-easing) focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-hidden aria-disabled:text-foreground/30',
  // Until the pill's script runs, the current one draws its own pill.
  '[[data-slot=calendar-choices]:not([data-mounted])_&]:data-current:bg-primary [[data-slot=calendar-choices]:not([data-mounted])_&]:data-current:text-primary-foreground',
  'forced-colors:data-current:forced-color-adjust-none forced-colors:data-current:bg-[Highlight] forced-colors:data-current:text-[HighlightText] forced-colors:data-current:focus-visible:outline-[CanvasText]',
)

const CELL = '[data-slot=calendar-choices-choice]'

/** Twelve months or years as a grid, with the Calendar's backdrop and pill. */
function CalendarChoices({
  choices,
  current,
  today,
  label,
  labelledBy,
  focusOn,
  readOnly,
  disabled,
  onPick,
  onPage,
}: {
  choices: readonly Choice[]
  /** The value of the one on screen now, or null. */
  current: string | null
  /** The value of today's month or year, or null. */
  today: string | null
  label: string
  /** Ids that name the grid in place of `label`, such as a Field's label and the page's title. */
  labelledBy?: string
  /** The value to focus once drawn, `stop` for the grid's tab stop, or null to leave focus where it is. */
  focusOn: string | null
  readOnly?: boolean
  disabled?: boolean
  onPick: (value: string, event: Event | undefined) => void
  onPage: (step: 1 | -1, index: number) => void
}) {
  const grid = usePrimitive(calendarChoices, {
    choices,
    value: current,
    onValueChange: (value, details) => onPick(value, details.event),
    onPage,
    readOnly,
    disabled,
  })
  const pillRef = useRef<HTMLSpanElement>(null)
  const backdropRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    // The pill and its backdrop sit straight inside the grid.
    const area = pillRef.current?.parentElement
    if (!area || !pillRef.current || !backdropRef.current) return
    const stopPick = followPick(area, pillRef.current, {
      picked: () => area.querySelector<HTMLElement>(`${CELL}[data-current]`),
      attributes: ['data-current'],
    })
    const stopHover = followPointer(area, backdropRef.current, {
      itemOf: itemMatching(area, CELL),
      focus: true,
    })
    return () => {
      stopPick()
      stopHover()
    }
  }, [])

  // Once a new page or view is drawn.
  useEffect(() => {
    if (focusOn === null) return
    grid.api.roving.focus(focusOn === 'stop' ? undefined : focusOn)
  }, [focusOn, grid])

  const rows = Array.from({ length: Math.ceil(choices.length / COLUMNS) }, (_, row) =>
    choices.slice(row * COLUMNS, row * COLUMNS + COLUMNS),
  )
  // Rows share whatever height the box has, each choice in the middle of its
  // row, up to twice a choice's height a row; in a taller box they sit in the middle.
  const layout = 'grid h-full grid-cols-3 grid-rows-4 items-center gap-y-0.5'

  const root = usePart(
    grid,
    'root',
    {},
    {
      ref: markMounted,
      'aria-label': labelledBy ? undefined : label,
      'aria-labelledby': labelledBy,
      'aria-readonly': readOnly ? 'true' : undefined,
      'aria-disabled': disabled ? 'true' : undefined,
      className: cn(
        layout,
        'relative isolate max-h-[calc(var(--control-height)*8)] w-full flex-1',
      ),
      children: (
        <>
          {rows.map((row) => (
            <ChoiceRow key={row[0].value} grid={grid} row={row} today={today} />
          ))}
          <span
            ref={backdropRef}
            aria-hidden
            className={cn(highlightClassName, pillBackdropClassName)}
          />
          <span
            ref={pillRef}
            aria-hidden
            inert
            className={cn(
              pickClassName,
              pillClassName,
              'z-10 group-data-disabled/calendar:data-[highlight=shown]:opacity-50',
            )}
          >
            <span className={layout}>
              {choices.map((choice) => (
                <span
                  key={choice.value}
                  data-today={choice.value === today ? '' : undefined}
                  className={choiceLayout}
                >
                  {choice.label}
                </span>
              ))}
            </span>
          </span>
        </>
      ),
    },
  )

  return (
    <div className='flex w-[calc(var(--control-height)*7)] max-w-full flex-col'>
      <div className='flex flex-1 flex-col justify-center'>{root}</div>
    </div>
  )
}

function ChoiceRow({
  grid,
  row,
  today,
}: {
  grid: PrimitiveHandle<typeof calendarChoices>
  row: readonly Choice[]
  today: string | null
}) {
  return usePart(
    grid,
    'row',
    {},
    {
      className: 'contents',
      children: row.map((choice) => (
        <ChoiceCell key={choice.value} grid={grid} choice={choice} today={today} />
      )),
    },
  )
}

function ChoiceCell({
  grid,
  choice,
  today,
}: {
  grid: PrimitiveHandle<typeof calendarChoices>
  choice: Choice
  today: string | null
}) {
  return usePart(
    grid,
    'choice',
    { value: choice.value, today: choice.value === today, disabled: !!choice.disabled },
    {
      className: choiceClassName,
      children: choice.label,
    },
    'span',
  )
}

export { CalendarChoices, calendarChoices, cellTarget }
export type { Choice }
