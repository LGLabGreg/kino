'use client'

import { useHold } from '@/registry/lib/hold'
import {
  type CustomerLogo,
  logoCloudColumnClassName,
  LogoCloudLink,
  LogoCloudLogo,
  type LogoCloudProps,
  logoCloudSectionClassName,
  LogoCloudTitle,
} from '@/registry/lib/logo-cloud-parts'
import { FOLLOWS_TRANSITION, roleDuration } from '@/registry/lib/resize'
import { Swap } from '@/registry/lib/swap'
import { type RefObject, useEffect, useId, useRef, useState } from 'react'

import { cn } from '@/lib/utils'

/*
 * Eight logos in eight slots, and every few seconds one slot rolls to a
 * customer still waiting, never the slot beside the last one, so more
 * logos fit in little room. It holds while the pointer is over it, while a
 * logo has focus and while it is out of view; under reduced motion the logos
 * change with a fade and nothing travels. A logo with a story is a link.
 *
 *   <LogoCloudSwap
 *     title='Trusted by teams that plan their week in Kino'
 *     logos={[{ name: 'Tessel', src: '/logos/tessel.svg', width: 560, height: 159 }]}
 *   />
 */

function LogoCloudSwap({
  title,
  heading = 'h2',
  logos,
  className,
  ...props
}: LogoCloudProps) {
  const titleId = useId()
  const listRef = useRef<HTMLUListElement>(null)
  const hold = useHold()
  const [state, setState] = useState(() => swapStart(logos.length))
  // A new set of logos starts again from the first eight.
  const [lastCount, setLastCount] = useState(logos.length)
  if (lastCount !== logos.length) {
    setLastCount(logos.length)
    setState(swapStart(logos.length))
  }
  useSwapTimer(listRef, hold.running && state.waiting.length > 0, () =>
    setState(swapNext),
  )
  return (
    <section
      data-slot='logo-cloud-swap'
      aria-labelledby={titleId}
      className={cn(logoCloudSectionClassName, className)}
      {...props}
    >
      <div className={cn(logoCloudColumnClassName, 'flex flex-col gap-8')}>
        <LogoCloudTitle id={titleId} title={title} heading={heading} />
        {/* A short last row sits in the middle. */}
        <ul
          ref={listRef}
          aria-labelledby={titleId}
          className='flex flex-wrap justify-center'
          {...hold.handlers}
        >
          {state.shown.map((index, slot) => (
            // oxlint-disable-next-line react/no-array-index-key -- a slot stays where it is while its logo changes
            <Slot key={slot} logo={logos[index]} />
          ))}
        </ul>
      </div>
    </section>
  )
}

function Slot({ logo }: { logo: CustomerLogo | undefined }) {
  return (
    <li className='flex h-16 min-w-0 basis-1/2 items-center justify-center overflow-clip px-3 @3xl/logo-cloud:h-20 @3xl/logo-cloud:basis-1/4'>
      {logo ? (
        // A logo with a story is a link; the one leaving can't take focus.
        <Swap id={logo.name} roll className='max-w-full [--swap-default-roll:2rem]'>
          <SlotLogo logo={logo} />
        </Swap>
      ) : null}
    </li>
  )
}

function SlotLogo({ logo }: { logo: CustomerLogo }) {
  const { href } = logo
  return href ? (
    <LogoCloudLink
      logo={{ ...logo, href }}
      className='text-muted-foreground hover:text-foreground flex max-w-full items-center rounded-(--control-radius-xs) p-2 transition-colors duration-(--motion-press-duration) ease-(--motion-press-fade-easing)'
    >
      <LogoCloudLogo logo={logo} />
    </LogoCloudLink>
  ) : (
    <span className='text-muted-foreground flex max-w-full items-center p-2'>
      <LogoCloudLogo logo={logo} />
    </span>
  )
}

/** How many slots show at once: two rows of four, or four rows of two on a phone. */
const SLOTS = 8

/**
 * The order the slots change in: each one is never beside the last, across
 * or down, whether the slots stand in 2, 4 or 8 columns.
 */
const SLOT_ORDER = [0, 3, 6, 1, 4, 7, 2, 5]

/** Which logos the slots show, which wait their turn, oldest first, and how many changes have played. */
interface SwapState {
  shown: number[]
  waiting: number[]
  turn: number
}

/** The first logos in the slots, and the rest waiting in order. */
function swapStart(count: number): SwapState {
  const all = Array.from({ length: count }, (_, index) => index)
  return { shown: all.slice(0, SLOTS), waiting: all.slice(SLOTS), turn: 0 }
}

/** The next change: the slot whose turn it is takes the logo that has waited longest, and its own logo waits at the back. */
function swapNext(state: SwapState): SwapState {
  const [incoming, ...rest] = state.waiting
  if (incoming === undefined || state.shown.length < SLOTS) return state
  const slot = SLOT_ORDER[state.turn % SLOT_ORDER.length]
  const shown = state.shown.map((logo, index) => (index === slot ? incoming : logo))
  return { shown, waiting: [...rest, state.shown[slot]], turn: state.turn + 1 }
}

/** How many `layout` durations a logo shows before the next slot changes: about three seconds in the default feel. */
const SWAP_EVERY = 5

/**
 * Calls `change` every `SWAP_EVERY` `layout` durations while `running`, the
 * element is in view and the page is shown. Under reduced motion it still
 * calls, and the logos change with a fade, so every customer shows.
 */
function useSwapTimer(
  ref: RefObject<HTMLElement | null>,
  running: boolean,
  change: () => void,
) {
  const changeRef = useRef(change)
  useEffect(() => {
    changeRef.current = change
  })
  useEffect(() => {
    const element = ref.current
    if (!element || !running) return
    let seen = false
    // The wait is a Web Animation that follows the page's transitions, so a tool that slows them slows it too.
    let clock: Animation | undefined
    const schedule = () => {
      clock?.cancel()
      clock = undefined
      if (!seen || document.hidden) return
      const every = roleDuration(element, 'layout') * SWAP_EVERY
      if (!(every > 0)) return
      const wait = element.animate([], { duration: every, id: FOLLOWS_TRANSITION })
      clock = wait
      wait.finished.then(
        () => {
          if (clock !== wait) return
          changeRef.current()
          schedule()
        },
        // Cancelled: held, out of view or gone.
        () => {},
      )
    }
    const sight = new IntersectionObserver(([entry]) => {
      seen = entry.isIntersecting
      schedule()
    })
    sight.observe(element)
    document.addEventListener('visibilitychange', schedule)
    return () => {
      clock?.cancel()
      sight.disconnect()
      document.removeEventListener('visibilitychange', schedule)
    }
  }, [ref, running])
}

export { LogoCloudSwap, swapNext, swapStart }
