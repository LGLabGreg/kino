'use client'

import { sectionColumnClassName } from '@/registry/lib/hero-parts'
import { reducesMotion } from '@/registry/lib/reduce-motion'
import { holdAtEdge, topEdge } from '@/registry/lib/scroll'
import type { SectionHeadingLevel } from '@/registry/lib/section-heading'
import {
  type ComponentProps,
  type ReactNode,
  type RefObject,
  useEffect,
  useRef,
} from 'react'

import { cn } from '@/lib/utils'

/*
 * What the FAQ blocks share: a question and its answer, the line that offers
 * a person for what the answers don't cover, the section they stand in, and
 * the link that opens one question from anywhere, `#refunds`.
 */

/** A question a visitor asks, and its answer. */
interface FaqQuestion {
  /** Tells the questions apart, and names this one in a link to it: `#cancel` opens it. */
  value: string
  question: string
  answer: ReactNode
}

/** What every FAQ block takes. */
interface FaqSectionProps extends Omit<
  ComponentProps<'section'>,
  'title' | 'children' | 'defaultValue' | 'onChange'
> {
  title: ReactNode
  description?: ReactNode
  /** A few words above the title that name the topic. */
  eyebrow?: ReactNode
  /** The title's level: `h2` under the page's `h1`. Each question is a level under it. */
  heading?: SectionHeadingLevel
  /** Who to ask about what the answers don't cover: a `FaqContact`. */
  contact?: ReactNode
}

/**
 * The section every arrangement stands in, laid out by its own width. While
 * a page loads on a link to a question, it lands open, with nothing moving.
 */
const faqSectionClassName =
  '@container/faq relative flex min-h-full w-full min-w-0 flex-col bg-background data-landing:**:transition-none! data-landing:[&_*::before]:transition-none! data-landing:[&_*::after]:transition-none!'

/** The content's column: the page's, with a section's room above and below. */
const faqColumnClassName = sectionColumnClassName

/** A question a link scrolls to stops short of the top, so the line above it shows too. */
const faqLinkTargetClassName = 'scroll-mt-8'

/** A question's words, at a size that reads as a page's, not a panel's. */
const faqQuestionClassName = 'text-base font-medium text-pretty'

/** An answer's words: muted beside the question, and no wider than reads well. */
const faqAnswerClassName =
  'text-muted-foreground max-w-prose text-base text-pretty [&_a]:text-foreground [&_a]:font-medium [&_a]:underline [&_a]:underline-offset-4 [&_p+p]:mt-3'

/**
 * Who to ask about what the answers don't cover: their faces, a line on how
 * soon they answer, and the way to reach them.
 */
function FaqContact({
  title,
  faces,
  action,
  className,
  children,
}: {
  /** Such as Still have a question? */
  title: ReactNode
  /** The people who answer, as an `AvatarStack`. */
  faces?: ReactNode
  /** The way to reach them: a `NudgeLink`. */
  action: ReactNode
  className?: string
  /** A line on who answers and how soon, such as Maya and Tomás answer within a few hours. */
  children?: ReactNode
}) {
  return (
    <div
      data-slot='faq-contact'
      className={cn('flex min-w-0 items-start gap-3 text-sm', className)}
    >
      {faces ? <div className='shrink-0'>{faces}</div> : null}
      <div className='flex min-w-0 flex-col items-start gap-1'>
        <p className='text-foreground font-medium text-pretty'>
          <bdi>{title}</bdi>
        </p>
        {children ? (
          <p className='text-muted-foreground text-pretty'>
            <bdi>{children}</bdi>
          </p>
        ) : null}
        <div className='mt-1'>{action}</div>
      </div>
    </div>
  )
}

/* A link to a question ----------------------------------------------------- */

/** The FAQs on the page and the questions each has, so a link opens the first that has its question. */
const faqsOnPage = new Map<HTMLElement, (value: string) => boolean>()

/** Frames a question has to appear in once it is revealed, such as a topic's panel mounting. */
const REVEAL_FRAMES = 10

/** Frames the page holds still after it loads on a link to a question. */
const LANDING_FRAMES = 4

/** The question a link names, or nothing: `#cancel` names `cancel`. */
function questionOfHash(hash: string): string | null {
  if (hash.length < 2) return null
  try {
    return decodeURIComponent(hash.slice(1))
  } catch {
    return null
  }
}

/** `Node.DOCUMENT_POSITION_PRECEDING`, which a server has no `Node` to read from. */
const PRECEDING = 2

/** Of the FAQs that have the question, the one first on the page. */
function firstWith<Root extends { compareDocumentPosition(other: Root): number }>(
  value: string,
  faqs: Map<Root, (value: string) => boolean>,
) {
  let first: Root | null = null
  for (const [root, has] of faqs) {
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
 * Opens the question a link names, `#cancel`, when the page loads with it,
 * when the link changes, and when a link to it is followed again, then
 * scrolls it to the top of the screen, past the scroller's
 * `scroll-padding-top` and its own `scroll-margin-top`, and holds it there
 * while answers above it close. Focus moves to it, so the keyboard goes on
 * from there and a screen reader says it. Each question carries its value
 * as `data-faq-question`. Of several FAQs with that question, the first on
 * the page opens it.
 */
function useQuestionLink(
  ref: RefObject<HTMLElement | null>,
  has: (value: string) => boolean,
  /** Shows the question: opens it, and its topic first. */
  reveal: (value: string) => void,
) {
  // The latest of each, so a render never opens the question again.
  const latest = useRef({ has, reveal })
  useEffect(() => {
    latest.current = { has, reveal }
  })

  useEffect(() => {
    const root = ref.current
    if (!root) return
    faqsOnPage.set(root, (value) => latest.current.has(value))
    let frame = 0
    /** `landing` when the page loads on the link: the question is there at once, with nothing moving. */
    const follow = (hash: string, landing = false) => {
      const value = questionOfHash(hash)
      if (value === null || firstWith(value, faqsOnPage) !== root) return
      if (landing) root.setAttribute('data-landing', '')
      latest.current.reveal(value)
      cancelAnimationFrame(frame)
      let left = REVEAL_FRAMES
      const show = () => {
        const question = root.querySelector<HTMLElement>(
          `[data-faq-question="${CSS.escape(value)}"]`,
        )
        // After the render that opens it, and its topic's.
        if (!question || question.closest('[hidden]')) {
          if (--left > 0) frame = requestAnimationFrame(show)
          else root.removeAttribute('data-landing')
          return
        }
        ;(
          question.querySelector<HTMLElement>('[data-slot=accordion-trigger]') ?? question
        ).focus({ preventScroll: true })
        question.scrollIntoView({
          block: 'start',
          behavior: landing || reducesMotion(root) ? 'instant' : 'smooth',
        })
        holdAtEdge(question, root, topEdge(question))
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
      faqsOnPage.delete(root)
      cancelAnimationFrame(frame)
      root.removeAttribute('data-landing')
      window.removeEventListener('hashchange', changed)
      document.removeEventListener('click', clicked)
    }
  }, [ref])
}

export {
  faqAnswerClassName,
  faqColumnClassName,
  FaqContact,
  faqLinkTargetClassName,
  type FaqSectionProps,
  type FaqQuestion,
  faqQuestionClassName,
  faqSectionClassName,
  firstWith,
  hashOnPage,
  questionOfHash,
  useQuestionLink,
}
