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
import { markMounted, mergeRefs } from '@/registry/lib/refs'
import {
  type KeyboardEvent,
  type MouseEvent,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import { cn } from '@/lib/utils'

/*
 * Twelve months or twelve years to pick from, drawn as the Calendar draws
 * its days: a backdrop under the pointer, a pill on the current one, and the
 * arrow keys of a grid. Three to a row in a month's width, four in a wider
 * calendar. In a taller box its rows spread out to fill it.
 */

const CELL = '[data-slot=calendar-choice]'

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

/** A choice's box, shared by its button and the pill's copy of it. */
const choiceLayout =
  'relative flex h-(--control-height) items-center justify-center rounded-(--control-radius) text-sm tabular-nums select-none data-today:font-semibold'

const choiceClassName = cn(
  choiceLayout,
  'w-full text-foreground transition-[color,box-shadow] duration-(--motion-press-duration) ease-(--motion-press-fade-easing) focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-hidden data-disabled:text-foreground/30',
  // Until the pill's script runs, the current one draws its own pill.
  '[[data-slot=calendar-choices]:not([data-mounted])_&]:data-current:bg-primary [[data-slot=calendar-choices]:not([data-mounted])_&]:data-current:text-primary-foreground',
  'forced-colors:data-current:forced-color-adjust-none forced-colors:data-current:bg-[Highlight] forced-colors:data-current:text-[HighlightText] forced-colors:data-current:focus-visible:outline-[CanvasText]',
)

/** Three choices to a row, in a month's width. */
const COLUMNS = 3

/** Twelve months or years as a grid, with the Calendar's backdrop and pill. */
function CalendarChoices({
  choices,
  current,
  today,
  label,
  rtl,
  focusOn,
  readOnly,
  onPick,
  onPage,
}: {
  choices: CalendarChoice[]
  /** The index of the one on screen now, or -1. */
  current: number
  /** The index of today's month or year, or -1. */
  today: number
  label: string
  rtl: boolean
  /** The index to focus once drawn, `stop` for the grid's tab stop, or null to leave focus where it is. */
  focusOn: number | 'stop' | null
  /** The choices can be looked through but not picked. */
  readOnly?: boolean
  onPick: (index: number, event: MouseEvent<HTMLButtonElement>) => void
  /** Turns the page when a key moves past the grid's edge, landing on choice `index` of the new page. */
  onPage: (step: 1 | -1, index: number) => void
}) {
  const areaRef = useRef<HTMLDivElement>(null)
  const areaRefs = useMemo(() => mergeRefs(areaRef, markMounted), [])
  const pillRef = useRef<HTMLSpanElement>(null)
  const backdropRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    const area = areaRef.current
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

  const count = choices.length
  // The grid's one tab stop: the choice last focused, else the current one, else the first that can be chosen.
  const [focused, setFocused] = useState<number | null>(null)
  const open = (index: number | null) =>
    index !== null && !!choices[index] && !choices[index].disabled
  const stop = open(focused)
    ? (focused as number)
    : open(current)
      ? current
      : choices.findIndex((choice) => !choice.disabled)

  // Once a new page or view is drawn. A choice that can't be taken hands
  // focus to the tab stop instead.
  useLayoutEffect(() => {
    const area = areaRef.current
    if (focusOn === null || !area) return
    const asked =
      focusOn === 'stop'
        ? null
        : area.querySelector<HTMLButtonElement>(
            `${CELL}[data-index="${focusOn}"]:not(:disabled)`,
          )
    ;(asked ?? area.querySelector<HTMLElement>(`${CELL}[tabindex="0"]`))?.focus({
      preventScroll: true,
    })
  }, [focusOn])

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const target = cellTarget(index, event.key, { columns: COLUMNS, rtl })
    if (target === null) return
    event.preventDefault()
    if (target < 0) onPage(-1, target + count)
    else if (target >= count) onPage(1, target - count)
    else
      areaRef.current
        ?.querySelector<HTMLElement>(`${CELL}[data-index="${target}"]`)
        ?.focus()
  }

  const rows = Array.from({ length: Math.ceil(count / COLUMNS) }, (_, row) =>
    choices.slice(row * COLUMNS, row * COLUMNS + COLUMNS),
  )
  // Rows share whatever height the box has, each choice in the middle of its
  // row, up to twice a choice's height a row; in a taller box they sit in the middle.
  const layout = 'grid h-full grid-cols-3 grid-rows-4 items-center gap-y-0.5'
  const tallest = 'max-h-[calc(var(--control-height)*8)]'

  return (
    <div className='flex w-[calc(var(--control-height)*7)] max-w-full flex-col'>
      <div className='flex flex-1 flex-col justify-center'>
        <div
          ref={areaRefs}
          role='grid'
          aria-label={label}
          aria-readonly={readOnly || undefined}
          data-slot='calendar-choices'
          className={cn(layout, tallest, 'relative isolate w-full flex-1')}
        >
          {rows.map((row, rowIndex) => (
            <div key={row[0].value} role='row' className='contents'>
              {row.map((choice, column) => {
                const index = rowIndex * COLUMNS + column
                return (
                  <span
                    key={choice.value}
                    role='gridcell'
                    aria-selected={index === current}
                    className='flex min-w-0'
                  >
                    <button
                      type='button'
                      data-slot='calendar-choice'
                      data-index={index}
                      data-current={index === current ? '' : undefined}
                      data-today={index === today ? '' : undefined}
                      data-disabled={choice.disabled ? '' : undefined}
                      disabled={choice.disabled}
                      aria-current={index === today ? 'date' : undefined}
                      tabIndex={index === stop ? 0 : -1}
                      onClick={(event) => onPick(index, event)}
                      onKeyDown={(event) => onKeyDown(event, index)}
                      onFocus={() => setFocused(index)}
                      className={choiceClassName}
                    >
                      {choice.label}
                    </button>
                  </span>
                )
              })}
            </div>
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
              {choices.map((choice, index) => (
                <span
                  key={choice.value}
                  data-today={index === today ? '' : undefined}
                  className={choiceLayout}
                >
                  {choice.label}
                </span>
              ))}
            </span>
          </span>
        </div>
      </div>
    </div>
  )
}

export { CalendarChoices, cellTarget }
