'use client'

import { reducesMotion } from '@/registry/lib/reduce-motion'
import { holdAtEdge, topEdge } from '@/registry/lib/scroll'
import { type RefObject, useEffect, useRef } from 'react'

/*
 * A link to one item of a block, `#cancel`, that may be out of sight: an
 * answer that is closed, a question on another topic, a release a filter
 * hides. The block shows it first (opens it, picks its topic, clears the
 * filter), then the item scrolls to the top of the screen and takes the
 * focus, so the keyboard goes on from there and a screen reader says it.
 * The FAQ blocks and the Changelog blocks share it.
 */

/**
 * A target a link scrolls to stops short of the top, so the line above it
 * shows too: `--link-target-top` below it, which a page with a sticky header
 * sets to the header's height and some room.
 */
const linkTargetClassName = 'scroll-mt-(--link-target-top,--spacing(8))'

/** On the block's root: while the page loads on a link, the item lands shown, with nothing moving. */
const linkLandingClassName =
  'data-landing:**:transition-none! data-landing:[&_*::before]:transition-none! data-landing:[&_*::after]:transition-none!'

/** The blocks on the page and the items each has, so a link reaches the first that has its item. */
const rootsOnPage = new Map<HTMLElement, (value: string) => boolean>()

/** Frames an item has to appear in once it is revealed, such as a topic's panel mounting. */
const REVEAL_FRAMES = 10

/** Frames the page holds still after it loads on a link to an item. */
const LANDING_FRAMES = 4

/** The item a link names, or nothing: `#cancel` names `cancel`. */
function targetOfHash(hash: string): string | null {
  if (hash.length < 2) return null
  try {
    return decodeURIComponent(hash.slice(1))
  } catch {
    return null
  }
}

/** `Node.DOCUMENT_POSITION_PRECEDING`, which a server has no `Node` to read from. */
const PRECEDING = 2

/** Of the blocks that have the item, the one first on the page. */
function firstWith<Root extends { compareDocumentPosition(other: Root): number }>(
  value: string,
  roots: Map<Root, (value: string) => boolean>,
) {
  let first: Root | null = null
  for (const [root, has] of roots) {
    if (!has(value)) continue
    if (!first || first.compareDocumentPosition(root) & PRECEDING) {
      first = root
    }
  }
  return first
}

/** The hash of a link that stays on the page it is on, `#cancel`, or nothing for one that leaves it. */
function hashOnPage(href: string, page: string): string | null {
  const url = new URL(href, page)
  const here = new URL(page)
  return url.origin === here.origin &&
    url.pathname === here.pathname &&
    url.search === here.search
    ? url.hash
    : null
}

/** Whether a click on a link stays on this page, where only the hash may change. */
function linkOnPage(event: MouseEvent): string | null {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  ) {
    return null
  }
  const link = event.target instanceof Element ? event.target.closest('a[href]') : null
  if (!(link instanceof HTMLAnchorElement) || (link.target && link.target !== '_self'))
    return null
  return hashOnPage(link.href, window.location.href)
}

/**
 * Shows the item a link names, `#cancel`, when the page loads with it, when
 * the link changes, and when a link to it is followed again, then scrolls it
 * to the top of the screen, past the scroller's `scroll-padding-top` and its
 * own `scroll-margin-top` (`linkTargetClassName`), and holds it there while
 * what is above it closes. Each item carries its value as
 * `data-link-target`; focus moves to the element in it marked
 * `data-link-focus`, such as an answer's trigger, or to the item itself,
 * which then needs `tabIndex={-1}`. Of several blocks with that item, the
 * first on the page shows it. While the page loads on the link, the root
 * carries `data-landing`, so the block lands with nothing moving
 * (`linkLandingClassName`).
 */
function useLinkTarget(
  ref: RefObject<HTMLElement | null>,
  has: (value: string) => boolean,
  /** Shows the item: opens it, picks its topic, clears a filter that hides it. */
  reveal: (value: string) => void,
) {
  // The latest of each, so a render never shows the item again.
  const latest = useRef({ has, reveal })
  useEffect(() => {
    latest.current = { has, reveal }
  })

  useEffect(() => {
    const root = ref.current
    if (!root) return
    rootsOnPage.set(root, (value) => latest.current.has(value))
    let frame = 0
    /** `landing` when the page loads on the link: the item is there at once, with nothing moving. */
    const follow = (hash: string, landing = false) => {
      const value = targetOfHash(hash)
      if (value === null || firstWith(value, rootsOnPage) !== root) return
      if (landing) root.setAttribute('data-landing', '')
      latest.current.reveal(value)
      cancelAnimationFrame(frame)
      let left = REVEAL_FRAMES
      const show = () => {
        const item = root.querySelector<HTMLElement>(
          `[data-link-target="${CSS.escape(value)}"]:not([data-leaving])`,
        )
        // After the render that shows it, and its topic's.
        if (!item || item.closest('[hidden]')) {
          if (--left > 0) frame = requestAnimationFrame(show)
          else root.removeAttribute('data-landing')
          return
        }
        ;(item.querySelector<HTMLElement>('[data-link-focus]') ?? item).focus({
          preventScroll: true,
        })
        item.scrollIntoView({
          block: 'start',
          behavior: landing || reducesMotion(root) ? 'instant' : 'smooth',
        })
        holdAtEdge(item, root, topEdge(item))
        // Base UI starts an opening, and places a tab's highlight, a few frames after it renders: those land too.
        if (landing) {
          let wait = LANDING_FRAMES
          const land = () => {
            if (--wait > 0) frame = requestAnimationFrame(land)
            else root.removeAttribute('data-landing')
          }
          frame = requestAnimationFrame(land)
        }
      }
      frame = requestAnimationFrame(show)
    }
    const changed = () => follow(window.location.hash)
    // A link followed again changes no hash, and a router's link changes it with no event.
    const clicked = (event: MouseEvent) => {
      const hash = linkOnPage(event)
      if (hash) follow(hash)
    }
    follow(window.location.hash, true)
    window.addEventListener('hashchange', changed)
    document.addEventListener('click', clicked)
    return () => {
      rootsOnPage.delete(root)
      cancelAnimationFrame(frame)
      root.removeAttribute('data-landing')
      window.removeEventListener('hashchange', changed)
      document.removeEventListener('click', clicked)
    }
  }, [ref])
}

export {
  firstWith,
  hashOnPage,
  linkLandingClassName,
  linkTargetClassName,
  targetOfHash,
  useLinkTarget,
}
