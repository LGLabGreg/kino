'use client'

import { formatOptionsOf, numberFormatter } from '@/registry/lib/number-format'
import { followSize } from '@/registry/lib/resize'
import { Roll } from '@/registry/lib/roll'
import { registerProgress, runProgress, stopProgress } from '@/registry/lib/run-progress'
import { Swap } from '@/registry/lib/swap'
import { mergeProps, type PartProps, renderElement } from '@ui-sdk/react/primitive'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'

import { cn } from '@/lib/utils'

/*
 * A number that moves to its new value when it changes, written for its
 * locale. `roll` rolls each digit that differs to its new one, `spin` spins
 * each through the digits between, and `count` counts the whole number
 * through the values between. The number drawn is for the eye only; screen
 * readers get the value once, never the numbers in between.
 */

type NumberProps = Omit<PartProps<'span'>, 'className' | 'children'> & {
  className?: string
  value: number
  /** The locale the value is written in. Give one, so the page's server and browser agree. */
  locale?: Intl.LocalesArgument
  /** How the value is written: a currency, a percentage, a unit, how many decimals. */
  format?: Intl.NumberFormatOptions
}

const RTL_LANGUAGES = new Set([
  'ar',
  'ckb',
  'dv',
  'fa',
  'he',
  'ks',
  'ps',
  'sd',
  'ug',
  'ur',
  'yi',
])

/** Which way the value's locale writes, so a currency or sign sits on the side its readers expect. */
function localeDirection(formatter: Intl.NumberFormat): 'ltr' | 'rtl' {
  const { language } = new Intl.Locale(formatter.resolvedOptions().locale)
  return RTL_LANGUAGES.has(language) ? 'rtl' : 'ltr'
}

const SIGN_PARTS = new Set(['minusSign', 'plusSign', 'approximatelySign'])

const NUMBER_PARTS = new Set([
  'integer',
  'group',
  'decimal',
  'fraction',
  'nan',
  'infinity',
])

/**
 * The value as it shows, split where it moves: its sign when it leads, what
 * else comes before the number (a currency), the number, and what comes
 * after (a percent sign, a unit, K). `tail` is how many of the number's characters come after its
 * whole part, so its digits line up on the decimal point.
 */
function numberParts(formatter: Intl.NumberFormat, value: number) {
  const parts = formatter.formatToParts(value)
  const first = parts.findIndex((part) => NUMBER_PARTS.has(part.type))
  const last = parts.findLastIndex((part) => NUMBER_PARTS.has(part.type))
  const join = (from: number, to: number) =>
    parts
      .slice(from, to)
      .map((part) => part.value)
      .join('')
  const number = parts.slice(first, last + 1)
  const signed = parts.findIndex((part) => !SIGN_PARTS.has(part.type))
  const sign = Math.min(signed === -1 ? parts.length : signed, first)
  return {
    text: join(0, parts.length),
    sign: join(0, sign),
    prefix: join(sign, first),
    number: number.map((part) => part.value).join(''),
    suffix: join(last + 1, parts.length),
    tail: number
      .filter((part) => part.type === 'decimal' || part.type === 'fraction')
      .reduce((length, part) => length + part.value.length, 0),
  }
}

// Count is timed by CSS: a transition runs this from 0 to 1 in the feel's timing,
// and each frame writes the number at that point.
const PROGRESS = '--animated-number-progress'

const decimals = (formatter: Intl.NumberFormat, value: number) =>
  formatter
    .formatToParts(value)
    .filter((part) => part.type === 'fraction')
    .reduce((length, part) => length + part.value.length, 0)

/**
 * The options the numbers in between are written with: no more decimals
 * than the two ends show, so a count from 0 to 1,000 never shows 512.347.
 * A compact or significant-digit format already rounds for itself.
 */
function countFormat(
  formatter: Intl.NumberFormat,
  format: Intl.NumberFormatOptions | undefined,
  from: number,
  to: number,
): Intl.NumberFormatOptions | undefined {
  const options = formatter.resolvedOptions()
  if (options.notation === 'compact' || options.maximumSignificantDigits !== undefined) {
    return format
  }
  const most = Math.max(decimals(formatter, from), decimals(formatter, to))
  return {
    ...format,
    minimumFractionDigits: Math.min(options.minimumFractionDigits ?? 0, most),
    maximumFractionDigits: most,
  }
}

/** The number a count shows at `progress`, from 0 to 1. */
function countAt(from: number, to: number, progress: number) {
  return progress >= 1 ? to : from + (to - from) * progress
}

/**
 * The parts around the number with their spaces kept: a flex item drops a
 * space at its start or end, which would join a unit to the number (`7 GB`).
 */
function keepSpaces(text: string) {
  return text.replace(/^ | $/g, '\u00a0')
}

function RollingNumber({
  value,
  locale,
  format,
  spin,
  className,
  render,
  ...props
}: NumberProps & { spin: boolean }) {
  const [seen, setSeen] = useState({ value, trend: 1 })
  if (seen.value !== value) setSeen({ value, trend: value < seen.value ? -1 : 1 })
  const formatter = numberFormatter(locale, format)
  const { text, sign, prefix, number, suffix, tail } = numberParts(formatter, value)
  const direction = localeDirection(formatter)
  return renderElement(
    'span',
    mergeProps(
      {
        'data-slot': 'animated-number',
        className: cn('whitespace-nowrap tabular-nums', className),
        children: (
          <>
            {/* The digits read left to right in every language; the parts around them follow the locale. An agent reads the row's text, where every digit of each reel would show. */}
            <span aria-hidden data-agent-hidden dir={direction} className='select-none'>
              {/* Only the number rolls, so the words around it keep their letters joined. */}
              <Swap roll align='end'>
                {sign}
              </Swap>
              <Swap roll align='end'>
                {keepSpaces(prefix)}
              </Swap>
              <Roll value={number} tail={tail} trend={seen.trend} spin={spin} />
              <Swap roll align='start'>
                {keepSpaces(suffix)}
              </Swap>
            </span>
            <span className='sr-only'>{text}</span>
          </>
        ),
      },
      props,
    ),
    render,
  )
}

function CountingNumber({
  value,
  locale,
  format,
  className,
  render,
  ...props
}: NumberProps) {
  const formatter = numberFormatter(locale, format)
  const text = formatter.format(value)
  const [surface, setSurface] = useState<HTMLSpanElement | null>(null)
  const live = useRef<HTMLSpanElement>(null)
  const shown = useRef(value)
  const target = useRef(value)

  useEffect(() => registerProgress(PROGRESS), [])
  // The box glides to each width the count reaches, so what follows it never jumps.
  useEffect(() => {
    const box = surface
    if (!box || !live.current) return
    // It clips only while it catches up, so a box narrower than the number at rest still shows all of it.
    return followSize(box, live.current, 'width', {
      moving: () => {
        box.dataset.following = ''
        return undefined
      },
      settled: () => delete box.dataset.following,
    })
  }, [surface])

  // Before the first paint of the new value, so it never shows before the count.
  useLayoutEffect(() => {
    const element = live.current
    if (!element) return
    if (target.current === value) {
      // Only how it's written changed, such as its currency: a count still
      // running would end on the old text, so it stops at the new one.
      if (element.textContent !== text) {
        stopProgress(element)
        shown.current = value
        element.textContent = text
      }
      return
    }
    const from = shown.current
    // The decimals come from the value it was going to, never from one part
    // way there, so a count cut short still shows whole members.
    const between = numberFormatter(
      formatter.resolvedOptions().locale,
      countFormat(formatter, formatOptionsOf(formatter), target.current, value),
    )
    target.current = value
    runProgress(element, PROGRESS, (progress) => {
      shown.current = countAt(from, value, progress)
      element.textContent = progress >= 1 ? text : between.format(shown.current)
    })
    // The formatter, not `format`: an object passed anew on each render must not end a count.
  }, [value, text, formatter])

  return renderElement(
    'span',
    mergeProps(
      {
        'data-slot': 'animated-number',
        ref: setSurface,
        className: cn(
          // While the box catches up with a wider number, it clips it, so nothing after it is drawn over.
          'inline-flex whitespace-nowrap data-following:overflow-x-clip tabular-nums transition-[width] duration-(--motion-layout-duration) ease-(--motion-layout-easing) motion-reduce:transition-none',
          className,
        ),
        children: (
          <>
            <span
              ref={live}
              aria-hidden
              data-agent-hidden
              dir={localeDirection(formatter)}
              className='shrink-0 select-none transition-[--animated-number-progress] duration-(--motion-draw-duration) ease-(--motion-draw-easing) motion-reduce:transition-none'
            >
              {text}
            </span>
            <span className='sr-only'>{text}</span>
          </>
        ),
      },
      props,
    ),
    render,
  )
}

function AnimatedNumber({
  variant = 'roll',
  ...props
}: NumberProps & {
  /** How it moves to a new value: rolling the digits that changed, spinning them, or counting. */
  variant?: 'roll' | 'spin' | 'count'
}) {
  return variant === 'count' ? (
    <CountingNumber {...props} />
  ) : (
    <RollingNumber {...props} spin={variant === 'spin'} />
  )
}

export { AnimatedNumber, countAt, countFormat, keepSpaces, localeDirection, numberParts }
