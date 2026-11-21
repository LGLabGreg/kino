'use client'

import {
  AnimatedNumber,
  localeDirection,
} from '@/registry/components/kino/animated-number'
import { IconPlaceholder } from '@/registry/icons/icon-placeholder'
import { sectionColumnClassName } from '@/registry/lib/hero-parts'
import { numberFormatter } from '@/registry/lib/number-format'
import { reducesMotion } from '@/registry/lib/reduce-motion'
import { FOLLOWS_TRANSITION } from '@/registry/lib/resize'
import { feelStretch, useSeen } from '@/registry/lib/scene'
import type { SectionHeadingLevel } from '@/registry/lib/section-heading'
import {
  type ComponentProps,
  createContext,
  type ReactNode,
  use,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import { cn } from '@/lib/utils'

/*
 * What the Stats blocks share: a stat and where it comes from, the number
 * that moves into place once the section is seen, and the section it stands
 * in.
 *
 * The page's HTML always holds the real numbers, so a search engine and a
 * page read before its script loads never see a zero. A section already on
 * screen when the page loads stays as it was painted (motion rule 6); one
 * further down drops to zero before it is painted and moves into place, a
 * number at a time, the first time it is seen. Under reduced motion every
 * number is in place from the start. Screen readers hear each value once,
 * never the numbers in between.
 */

/**
 * A stat's figure: a number, which moves into place and is written for the
 * locale, or words that stand still, such as 24/7.
 */
type StatFigure =
  | {
      value: number
      /** How the number is written: compact (2.1M), a percentage, a currency, how many decimals. */
      format?: Intl.NumberFormatOptions
      /** Written after the number and never moving, such as the + of 135+. */
      suffix?: string
    }
  | { text: string }

/** A figure worth a headline, and what it counts. */
type Stat = StatFigure & {
  /** What it counts, such as teams plan their week in Kino. */
  label: ReactNode
  /** A line on why it matters. */
  description?: ReactNode
  /** Where the number comes from, so a reader can check it: a status page, a survey. */
  source?: StatSource
}

interface StatSource {
  label: ReactNode
  href: string
}

/** What every Stats block takes, whatever its words. */
interface StatsWordsProps {
  /** A few words above the title that name the topic, such as Kino in numbers. */
  eyebrow?: ReactNode
  /** The title's level: `h2` under the page's `h1`. */
  heading?: SectionHeadingLevel
  /** The locale the numbers are written in. Give one, so the page's server and browser agree. */
  locale?: Intl.LocalesArgument
}

/** The section every arrangement stands in, laid out by its own width. */
const statsSectionClassName =
  '@container/stats relative isolate flex w-full min-w-0 flex-col overflow-x-clip bg-background'

/** The column it sits in, with a section's room above and below, as every landing page section has. */
const statsColumnClassName = sectionColumnClassName

/** How long after the one before it each number seen at the same time starts to move, in ms in the default feel. */
const STAT_STAGGER_MS = 120

interface StatsArrivalState {
  locale: Intl.LocalesArgument
  /**
   * How long a number seen now waits before it moves, in ms in the default
   * feel: none for the first seen in a frame, a stagger more for each after
   * it, so a row seen at once moves one number after another, in the page's order.
   */
  wait: () => number
}

const StatsArrivalContext = createContext<StatsArrivalState | null>(null)

/** Whether any of `element` is on screen. */
function onScreen(element: Element) {
  const box = element.getBoundingClientRect()
  return (
    box.bottom > 0 &&
    box.top < window.innerHeight &&
    box.right > 0 &&
    box.left < window.innerWidth
  )
}

/** Where a batch of numbers seen together is: how many have asked to wait, and whether its frame is still open. */
interface ArrivalBatch {
  asked: number
  open: boolean
}

/** The wait of the next number in a batch, in ms in the default feel, and the batch after it asks. */
function nextWait(batch: ArrivalBatch): { wait: number; batch: ArrivalBatch } {
  const asked = batch.open ? batch.asked : 0
  return { wait: asked * STAT_STAGGER_MS, batch: { asked: asked + 1, open: true } }
}

/** The locale its numbers are written in, and the stagger between numbers seen at the same time. */
function StatsArrival({
  locale = 'en-US',
  children,
}: {
  /** The locale the numbers are written in. Give one, so the page's server and browser agree. */
  locale?: Intl.LocalesArgument
  children: ReactNode
}) {
  const batch = useRef<ArrivalBatch>({ asked: 0, open: false })
  const value = useMemo(
    () => ({
      locale,
      wait: () => {
        const next = nextWait(batch.current)
        if (!batch.current.open) {
          // The numbers seen in one frame are one batch.
          requestAnimationFrame(() => {
            batch.current = { ...batch.current, open: false }
          })
        }
        batch.current = next.batch
        return next.wait
      },
    }),
    [locale],
  )
  return <StatsArrivalContext value={value}>{children}</StatsArrivalContext>
}

/** A stat's figure alone, for its `StatsNumber`. */
function figureOf(stat: StatFigure): StatFigure {
  return 'text' in stat
    ? { text: stat.text }
    : { value: stat.value, format: stat.format, suffix: stat.suffix }
}

/**
 * Where a number is: standing at its value with nothing moving (`still`: it
 * was painted so, or motion is reduced), at zero waiting to be seen,
 * `moving` into place, or `settled` there once it has.
 */
type StatsNumberPhase = 'still' | 'waiting' | 'moving' | 'settled'

/**
 * A stat's figure: its number moves into place the first time it is seen,
 * `roll`ing each digit up from zero, `spin`ning each through the digits
 * between, or `count`ing through the values between. It holds the room of
 * its final value from the start, and grows into it from its last digit, as
 * an odometer does, so nothing around it moves. At rest it is plain text,
 * so it reads, copies and is found on the page as the words around it are.
 */
function StatsNumber({
  variant = 'roll',
  className,
  ...figure
}: StatFigure & {
  /** How it moves into place: rolling each digit up from zero, or counting through the values between. */
  variant?: 'roll' | 'count'
  className?: string
}) {
  const arrival = use(StatsArrivalContext)
  const { ref, seen } = useSeen<HTMLSpanElement>()
  const layer = useRef<HTMLSpanElement>(null)
  // At its value until it is known to be off screen, so the page's HTML holds the real numbers.
  const [phase, setPhase] = useState<StatsNumberPhase>('still')
  const waited = useRef<number | null>(null)

  // Before the first paint: on screen as the page shows it, it stays as it is (motion rule 6);
  // further down, it drops to zero, which nobody sees, and moves in once it is seen.
  useLayoutEffect(() => {
    const element = ref.current
    if (element && !reducesMotion(element) && !onScreen(element)) setPhase('waiting')
  }, [ref])

  useEffect(() => {
    const element = ref.current
    if (seen !== 'seen' || phase !== 'waiting' || !element) return
    waited.current ??= arrival?.wait() ?? 0
    // A clock that follows the transitions, so a slower feel or a tool that slows CSS stretches the wait too.
    const clock = element.animate([], {
      duration: waited.current * feelStretch(element),
      id: FOLLOWS_TRANSITION,
    })
    clock.finished.then(
      () => setPhase('moving'),
      () => {},
    )
    return () => clock.cancel()
  }, [seen, phase, ref, arrival])

  // Once every move inside it has ended, the moving copy gives way to the plain text under it.
  useEffect(() => {
    const moving = layer.current
    if (phase !== 'moving' || !moving) return
    let ended = false
    let frame = 0
    const settle = () => {
      const running = moving
        .getAnimations({ subtree: true })
        .filter((animation) => animation.playState === 'running')
      if (running.length === 0) {
        setPhase('settled')
        return
      }
      void Promise.allSettled(running.map((animation) => animation.finished)).then(() => {
        if (!ended) frame = requestAnimationFrame(settle)
      })
    }
    // A frame on, so the moves the new value starts are running.
    frame = requestAnimationFrame(settle)
    return () => {
      ended = true
      cancelAnimationFrame(frame)
    }
  }, [phase])

  if ('text' in figure) {
    return (
      <span className={cn('tabular-nums', className)}>
        <bdi>{figure.text}</bdi>
      </span>
    )
  }
  const { value, format, suffix } = figure

  const locale = arrival?.locale ?? 'en-US'
  const formatter = numberFormatter(locale, format)
  const text = formatter.format(value) + (suffix ?? '')
  const drawn = (phase === 'waiting' || phase === 'moving') && seen !== 'reduced'
  return (
    <span
      ref={ref}
      data-slot='stats-number'
      // The number's own direction, so its room fills from its last digit on the side that digit sits.
      dir={localeDirection(formatter)}
      // Only as wide as its value, so the moving copy lines up with it wherever it stands.
      className={cn(
        'relative inline-block w-fit whitespace-nowrap tabular-nums',
        className,
      )}
    >
      {/*
       * The final value as text: it holds the room while the copy over it moves
       * into it, and it is what screen readers read, search engines find and a
       * copy takes. Forced colours paint it, so the moving copy goes there.
       */}
      <span className={cn(drawn && 'text-transparent')}>{text}</span>
      {drawn ? (
        <span
          ref={layer}
          aria-hidden
          className='absolute end-0 top-0 select-none forced-colors:hidden [&_.sr-only]:hidden'
        >
          <AnimatedNumber
            value={phase === 'moving' ? value : 0}
            locale={locale}
            format={format}
            variant={variant}
          />
          {suffix}
        </span>
      ) : null}
    </span>
  )
}

/**
 * A link to where a number comes from, quiet under it, with an arrow that
 * nudges out on hover. It runs as text, so a long one wraps with the arrow
 * after its last word.
 */
function StatsSource({
  source,
  className,
  ...props
}: Omit<ComponentProps<'a'>, 'href' | 'children'> & { source: StatSource }) {
  return (
    <a
      data-slot='stats-source'
      href={source.href}
      className={cn(
        'group/source text-muted-foreground hover:text-foreground inline-block py-0.5 text-sm text-pretty underline-offset-4 transition-[color] duration-(--motion-press-duration) ease-(--motion-press-fade-easing) hover:underline focus-visible:rounded-(--control-radius-xs) focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-hidden',
        className,
      )}
      {...props}
    >
      <bdi>{source.label}</bdi>
      <IconPlaceholder
        lucide='ArrowUpRightIcon'
        tabler='IconArrowUpRight'
        hugeicons='ArrowUpRight01Icon'
        phosphor='ArrowUpRightIcon'
        remixicon='RiArrowRightUpLine'
        aria-hidden
        className='ms-1 inline-block size-4 align-[-0.1875rem] transition-transform duration-(--motion-press-duration) ease-(--motion-press-easing) group-hover/source:translate-x-0.5 group-hover/source:-translate-y-0.5 motion-reduce:transition-none rtl:-scale-x-100 rtl:group-hover/source:-translate-x-0.5'
      />
    </a>
  )
}

export {
  type ArrivalBatch,
  figureOf,
  nextWait,
  STAT_STAGGER_MS,
  type Stat,
  type StatFigure,
  type StatSource,
  StatsArrival,
  statsColumnClassName,
  StatsNumber,
  statsSectionClassName,
  StatsSource,
  type StatsWordsProps,
}
