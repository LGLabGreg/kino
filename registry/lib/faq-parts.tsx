'use client'

import { sectionColumnClassName } from '@/registry/lib/hero-parts'
import { linkLandingClassName } from '@/registry/lib/link-target'
import type { SectionHeadingLevel } from '@/registry/lib/section-heading'
import type { ComponentProps, ReactNode } from 'react'

import { cn } from '@/lib/utils'

/*
 * What the FAQ blocks share: a question and its answer, the line that offers
 * a person for what the answers don't cover, and the section they stand in.
 * A link to a question, `#refunds`, opens it from anywhere through
 * `registry/lib/link-target`.
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
const faqSectionClassName = cn(
  '@container/faq relative flex min-h-full w-full min-w-0 flex-col bg-background',
  linkLandingClassName,
)

/** The content's column: the page's, with a section's room above and below. */
const faqColumnClassName = sectionColumnClassName

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

export {
  faqAnswerClassName,
  faqColumnClassName,
  FaqContact,
  type FaqSectionProps,
  type FaqQuestion,
  faqQuestionClassName,
  faqSectionClassName,
}
