'use client'

import { animateSize, sizeNow, withoutTransition } from '@/registry/lib/resize'
import {
  type ComponentProps,
  type CSSProperties,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'

import { cn } from '@/lib/utils'

/*
 * Text that rolls when it changes, like an odometer: each character that
 * differs leaves one way and its replacement arrives from the other, up when
 * the value grew, at full strength so it reads while it moves. Under reduced
 * motion the old character goes at once and the new one fades in, so two
 * never show over each other. It is drawn for the eye only: give screen
 * readers the value beside it.
 */

const SLOTS = 3

/**
 * One character's place. Its three slots take turns: one character arriving
 * and up to two leaving. A character still arriving when the value changes
 * again leaves from where it got to, because it stays the same element.
 */
export interface RollColumn {
  id: number
  chars: string[]
  keys: number[]
  /** Which way each slot leaves, fixed when it starts to: 1 up, -1 down. */
  exits: (1 | -1)[]
  arriving: number
}

function emptyColumn(key: number): { column: RollColumn; nextKey: number } {
  return {
    column: {
      id: key,
      chars: ['', '', ''],
      keys: [key + 1, key + 2, key + 3],
      exits: [1, 1, 1],
      arriving: 0,
    },
    nextKey: key + 4,
  }
}

/** Columns at rest, for a value that hasn't changed yet. Columns run from the value's end. */
export function restingColumns(value: string): {
  columns: RollColumn[]
  nextKey: number
} {
  let nextKey = 0
  const columns = value
    .split('')
    .reverse()
    .map((char) => {
      const made = emptyColumn(nextKey)
      nextKey = made.nextKey
      return { ...made.column, chars: [char, '', ''] }
    })
  return { columns, nextKey }
}

export interface RollOptions {
  /** Above 0 when the value grew, below 0 when it shrank. */
  trend?: number
  /**
   * The value is typed: when it carries the last one on (a digit typed or
   * deleted at the end), it lines up from the start, so only that digit moves.
   */
  typed?: boolean
  /** How many characters come after the place the value lines up on, such as a number's decimals. */
  tail?: number
  /** The same for the value before. */
  wasTail?: number
  /** A digit that becomes another stays in its slot and spins to it. */
  spin?: boolean
}

/**
 * The columns once the value has changed: each column whose character differs
 * turns to its next slot. Places line up from the end, or `tail` characters
 * before it, so units stay over units and the decimal point stays where it
 * is. A typed value that carries the last one on lines up from the start.
 */
export function rollColumns(
  columns: RollColumn[],
  value: string,
  key: number,
  { trend = 1, typed = false, tail = 0, wasTail = 0, spin = false }: RollOptions = {},
): { columns: RollColumn[]; nextKey: number } {
  let nextKey = key
  const fresh = () => {
    const made = emptyColumn(nextKey)
    nextKey = made.nextKey
    return made.column
  }
  const chars = value.split('').reverse()
  const shown = columns.flatMap((column, index) =>
    column.chars[column.arriving] ? [index] : [],
  )
  const was = shown
    .map((index) => columns[index].chars[columns[index].arriving])
    .reverse()
    .join('')
  let placed = [...columns]
  const carriesOn =
    typed &&
    was !== '' &&
    value !== '' &&
    (value.startsWith(was) || was.startsWith(value))
  // The column the old value lined up on, past its last one if it was shorter.
  const last = shown.length > 0 ? shown[shown.length - 1] : -1
  const anchor = shown[wasTail] ?? last + 1 + (wasTail - shown.length)
  // Where the value's last character goes; columns before it empty out.
  let end = carriesOn ? last - (chars.length - 1) : anchor - tail
  if (end < 0) {
    placed = [...Array.from({ length: -end }, fresh), ...placed]
    end = 0
  }
  const width = Math.max(placed.length, end + chars.length)
  const next = Array.from({ length: width }, (_, index) => {
    const char = index < end ? '' : (chars[index - end] ?? '')
    const column = placed[index] ?? fresh()
    const current = column.chars[column.arriving]
    if (current === char) return column
    if (spin && digitOf(current) && digitOf(char)) {
      return {
        ...column,
        chars: column.chars.map((old, slot) => (slot === column.arriving ? char : old)),
      }
    }
    const arriving = (column.arriving + 1) % SLOTS
    return {
      ...column,
      chars: column.chars.map((old, slot) => (slot === arriving ? char : old)),
      keys: column.keys.map((old, slot) => (slot === arriving ? nextKey++ : old)),
      exits: column.exits.map((old, slot) =>
        slot === column.arriving ? (trend >= 0 ? 1 : -1) : old,
      ),
      arriving,
    }
  })
  return { columns: next, nextKey }
}

const DIGIT = /^\p{Nd}$/u

/**
 * A digit's value and the code of its numbering system's zero, such as 7 and
 * the code of `0`, or of `٠` in Arabic-Indic. Null for anything else.
 */
export function digitOf(char: string): { value: number; zero: number } | null {
  if (!DIGIT.test(char)) return null
  const code = char.codePointAt(0) ?? 0
  let zero = code
  // A numbering system's digits are ten code points in a row, from its zero.
  while (code - zero < 9 && DIGIT.test(String.fromCodePoint(zero - 1))) zero -= 1
  return { value: code - zero, zero }
}

/** How many copies of the ten digits a spinning strip holds, so a spin either way stays on it. */
const SPIN_COPIES = 3

const wrap = (digits: number) => ((digits % 10) + 10) % 10

/**
 * Where a spinning strip goes, in digits from its top, to show `digit` from
 * `from`: forward through the digits after it when the value grew, back
 * through those before it when it shrank, round past 9 or 0 as a counter does.
 */
export function spinTarget(from: number, digit: number, trend: number): number {
  const at = wrap(from)
  const steps = trend >= 0 ? wrap(digit - at) : -wrap(at - digit)
  return Math.abs(steps) < 1e-6 ? from : from + steps
}

/** Where a strip is now, in digits from its top, part way through a spin or at rest. */
function spinNow(strip: HTMLElement): number {
  const step = (strip.firstElementChild as HTMLElement | null)?.offsetHeight ?? 0
  const y = Number.parseFloat(getComputedStyle(strip).translate.split(' ')[1] ?? '0')
  return step > 0 && Number.isFinite(y) ? -y / step : 10
}

/**
 * Spins a strip to `digit`. It first moves, with no transition, to the same
 * place in its middle copy, which looks the same, so a spin cut short goes
 * on from where it is and never runs off the strip. Kept outside the
 * component: the React Compiler drops a forced reflow written inside one.
 */
function spinTo(strip: HTMLElement, digit: number, trend: number) {
  const now = spinNow(strip)
  const from = 10 + wrap(now)
  if (Math.abs(from - now) > 1e-3) {
    withoutTransition(strip, () => strip.style.setProperty('--roll-spin', String(from)))
  }
  strip.style.setProperty('--roll-spin', String(spinTarget(from, digit, trend)))
}

const columnWidths = new WeakMap<Element, number>()

/**
 * Glides each column whose character became one of another width, such as K
 * to M or one currency sign to another, from its old width to its new one,
 * so what follows slides over rather than jumps. A column that fills or
 * empties glides on its own grid track instead. Kept outside the component:
 * the React Compiler drops a forced reflow written inside one.
 */
function glideColumns(root: HTMLElement) {
  for (const column of root.querySelectorAll<HTMLElement>(':scope > [data-change]')) {
    const sizer = column.querySelector<HTMLElement>('[data-roll-sizer]')
    if (!sizer) continue
    const to = sizer.offsetWidth
    const last = columnWidths.get(column)
    columnWidths.set(column, to)
    if (
      column.dataset.change !== 'none' ||
      last === undefined ||
      Math.abs(to - last) < 0.5
    ) {
      continue
    }
    void animateSize(column, 'width', sizeNow(column, 'width', last), to).then(
      (latest) => {
        if (latest) column.style.width = ''
      },
    )
  }
}

/** A digit drawn as a strip of its numbering system's digits, which spins to the next one. */
function RollDigit({ char, trend }: { char: string; trend: number }) {
  const { value, zero } = digitOf(char) ?? { value: 0, zero: 48 }
  const ref = useRef<HTMLSpanElement>(null)
  const [start] = useState(() => 10 + value)
  const shown = useRef(value)
  useLayoutEffect(() => {
    if (!ref.current || shown.current === value) return
    shown.current = value
    spinTo(ref.current, value, trend)
  }, [value, trend])
  return (
    // Clipped to its own line, so a digit arriving or leaving shows none of its neighbours.
    <span className='relative inline-block [clip-path:inset(0_-1em)]'>
      <span className='invisible'>{char}</span>
      <span
        ref={ref}
        style={{ '--roll-spin': start } as CSSProperties}
        className='absolute inset-x-0 top-0 flex translate-y-[calc(var(--roll-spin)*-1lh)] flex-col transition-[translate] duration-(--motion-layout-duration) ease-(--motion-layout-easing) motion-reduce:transition-none'
      >
        {Array.from({ length: 10 * SPIN_COPIES }, (_, index) => (
          // oxlint-disable-next-line react/no-array-index-key -- the strip's digits never move
          <span key={index}>{String.fromCodePoint(zero + (index % 10))}</span>
        ))}
      </span>
    </span>
  )
}

/**
 * How a column's width moves as a character arrives: it grows from nothing
 * when the column was empty, shrinks to nothing when the column empties, and
 * otherwise stays as wide as what arrives.
 */
export function columnWidthChange(
  left: string,
  arriving: string,
): 'grow' | 'shrink' | 'none' {
  if (left === '' && arriving !== '') return 'grow'
  if (left !== '' && arriving === '') return 'shrink'
  return 'none'
}

function Roll({
  value,
  trend = 1,
  typed = false,
  tail = 0,
  spin = false,
  className,
  style,
  ...props
}: Omit<ComponentProps<'span'>, 'children'> &
  Omit<RollOptions, 'wasTail'> & {
    value: string
  }) {
  const [state, setState] = useState(() => ({
    value,
    tail,
    rolled: false,
    ...restingColumns(value),
  }))
  if (state.value !== value || state.tail !== tail) {
    setState({
      value,
      tail,
      rolled: true,
      ...rollColumns(state.columns, value, state.nextKey, {
        trend,
        typed,
        tail,
        wasTail: state.tail,
        spin,
      }),
    })
  }
  const draw = (char: string) =>
    spin && digitOf(char) ? <RollDigit char={char} trend={trend} /> : char
  const root = useRef<HTMLSpanElement>(null)
  useLayoutEffect(() => {
    if (root.current) glideColumns(root.current)
  }, [state])

  return (
    // Digits read left to right in every language, so the row doesn't flip in RTL.
    <span
      ref={root}
      data-slot='roll'
      aria-hidden
      dir='ltr'
      style={
        {
          '--roll-from': trend >= 0 ? '1lh' : '-1lh',
          ...style,
        } as CSSProperties
      }
      className={cn(
        // The clip keeps a character on its way in out of the line's measured height.
        'inline-flex overflow-y-clip whitespace-pre select-none [clip-path:inset(0_-1em)]',
        className,
      )}
      {...props}
    >
      {state.columns
        .map((column) => {
          const shown = column.chars[column.arriving]
          // What holds the column open: its character, or the one leaving while it closes.
          const sizer = shown || column.chars[(column.arriving + SLOTS - 1) % SLOTS]
          const change = state.rolled
            ? columnWidthChange(
                column.chars[(column.arriving + SLOTS - 1) % SLOTS],
                shown,
              )
            : 'none'
          return (
            <span
              key={column.id}
              data-change={change}
              className={cn(
                // A column that fills or empties glides open or shut, so the rest slide over rather than jump.
                // It clips at its sides, so a character in one still opening never shows over its neighbour.
                // Its character fades as well, the way the room for it opens or closes.
                'group/roll-column inline-grid [clip-path:inset(0_-0.04em)] transition-[grid-template-columns,width] duration-(--motion-layout-duration) ease-(--motion-layout-easing) motion-reduce:transition-none',
                shown ? 'grid-cols-[1fr]' : 'grid-cols-[0fr]',
                change === 'grow' && 'starting:grid-cols-[0fr]',
              )}
            >
              <span className='relative min-w-0'>
                <span data-roll-sizer className='invisible'>
                  {sizer}
                </span>
                {column.chars.map((char, slot) =>
                  slot !== column.arriving ? (
                    <span
                      key={column.keys[slot]}
                      style={
                        {
                          '--roll-to': column.exits[slot] > 0 ? '-1lh' : '1lh',
                        } as CSSProperties
                      }
                      className='absolute inset-y-0 start-0 transition-[translate,opacity] duration-(--motion-exit-duration) ease-(--motion-exit-easing) motion-safe:translate-y-(--roll-to) group-data-[change=shrink]/roll-column:opacity-0 motion-reduce:opacity-0 motion-reduce:transition-none'
                    >
                      {draw(char)}
                    </span>
                  ) : state.rolled ? (
                    <span
                      key={column.keys[slot]}
                      className='absolute inset-y-0 start-0 transition-[translate,opacity] duration-(--motion-enter-duration) ease-(--motion-enter-easing) motion-safe:starting:translate-y-(--roll-from) group-data-[change=grow]/roll-column:starting:opacity-0 motion-reduce:starting:opacity-0'
                    >
                      {draw(char)}
                    </span>
                  ) : (
                    // At rest on first paint: nothing moves until the value changes.
                    <span key={column.keys[slot]} className='absolute inset-y-0 start-0'>
                      {draw(char)}
                    </span>
                  ),
                )}
              </span>
            </span>
          )
        })
        .reverse()}
    </span>
  )
}

export { Roll }
