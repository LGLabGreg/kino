'use client'

import { PAGE_TIME } from '@/registry/lib/resize'
import type { ComponentProps } from 'react'

import { cn } from '@/lib/utils'

/*
 * What shows that something is live, and the time it keeps. The pulse is a
 * loop that runs while a value is live, timed by `layout` at an even pace
 * (motion rule 8). The clock is the page's own time as a Web Animation
 * plays it (`PAGE_TIME`), so a live chart's scroll and the rows stamped by it
 * keep step when the playground's Speed slows the page.
 */

/**
 * The clock's animation, made once for the page; the wall's time at its
 * start; and how far the wall's time was ahead of the page's own, which
 * only a device that slept, or a wall clock set, changes.
 */
let clock: { animation: Animation; epoch: number; wall: number } | null = null

/** How far the wall's time is ahead of the page's own, which animations run on. */
const wallAhead = () => Date.now() - performance.now()

function pageClock() {
  if (clock && clock.animation.playState !== 'idle') return clock
  const animation = document.documentElement.animate([], {
    duration: Number.MAX_SAFE_INTEGER,
    id: PAGE_TIME,
  })
  // Started on the page's time now, not on the next frame as a pending animation starts, which
  // can come long after on a busy page and leave the clock behind what was timed from it before.
  const started = Number(document.timeline.currentTime ?? performance.now())
  animation.startTime = started
  const wall = wallAhead()
  clock = { animation, epoch: wall + started, wall }
  return clock
}

/**
 * The time now, in ms since 1970, as the page's clock keeps it: the same
 * as `Date.now()`, but slowed where the page is slowed, such as in the
 * playground. Rows a live chart shows are stamped
 * with `Date.now()` or with this. On the server, `Date.now()`.
 */
function liveNow(): number {
  if (typeof document === 'undefined') return Date.now()
  const now = pageClock()
  // A device that slept skips the wall's time ahead of the page's: the clock skips with it.
  const wall = wallAhead()
  if (Math.abs(wall - now.wall) > 1000) {
    now.epoch += wall - now.wall
    now.wall = wall
  }
  // An animation's time moves only when a frame is drawn, and a hidden page draws none, so the
  // clock runs on from the last frame at its own rate.
  const sinceFrame =
    performance.now() - Number(document.timeline.currentTime ?? performance.now())
  return (
    now.epoch +
    Number(now.animation.currentTime ?? 0) +
    Math.max(0, sinceFrame) * now.animation.playbackRate
  )
}

/** How fast the page's clock runs: 1, or slower where the page is slowed. */
function liveRate(): number {
  if (typeof document === 'undefined') return 1
  return pageClock().animation.playbackRate
}

/**
 * Calls `then` once `ms` have passed on the page's clock, so a wait slows
 * with the page, even when it is slowed part-way through it. Gives a function that
 * cancels it.
 */
function afterPageTime(ms: number, then: () => void): () => void {
  const wait = document.documentElement.animate([], {
    duration: Math.max(0, ms),
    id: PAGE_TIME,
  })
  wait.playbackRate = liveRate()
  let cancelled = false
  wait.finished.then(
    () => {
      if (!cancelled) then()
    },
    // Cancelling it rejects `finished`.
    () => {},
  )
  return () => {
    cancelled = true
    wait.cancel()
  }
}

/**
 * The pulse beside something live: a dot whose ring breathes out while it
 * is live, and fades once it isn't. Sized and coloured by its parent
 * (`size-2`, `text-success`).
 */
function LivePulse({
  live = true,
  className,
  ...props
}: ComponentProps<'span'> & {
  /** Whether the ring breathes; it fades where it is once off. */
  live?: boolean
}) {
  return (
    <span
      aria-hidden
      data-slot='live-pulse'
      data-live={live ? '' : undefined}
      className={cn('relative flex', className)}
      {...props}
    >
      <span className='absolute inset-0 rounded-full bg-current opacity-0 transition-opacity duration-(--motion-exit-duration) ease-(--motion-exit-fade-easing) in-data-live:animate-[ping_calc(var(--motion-layout-duration)*6)_ease-in-out_infinite] in-data-live:opacity-60 motion-reduce:animate-none' />
      <span className='relative size-full rounded-full bg-current forced-colors:bg-[CanvasText]' />
    </span>
  )
}

export { afterPageTime, liveNow, LivePulse, liveRate }
