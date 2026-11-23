'use client'

import {
  faqAnswerClassName,
  faqColumnClassName,
  type FaqSectionProps,
  type FaqQuestion,
  faqQuestionClassName,
  faqSectionClassName,
} from '@/registry/lib/faq-parts'
import { linkTargetClassName, useLinkTarget } from '@/registry/lib/link-target'
import { HEADING_BELOW, SectionHeading } from '@/registry/lib/section-heading'
import { useCallback, useId, useRef } from 'react'

import { cn } from '@/lib/utils'

/*
 * A landing page's questions with every answer in view: the heading and who
 * to ask across the top, and the questions in two columns under it. Nothing
 * opens, so a visitor reads as they scroll and the browser's find, a reader
 * mode and a search engine see it all as it is. Nothing moves either: the
 * answers are the point.
 *
 *   <FaqOpen
 *     title='Questions, answered.'
 *     questions={[{ value: 'cancel', question: 'Can we cancel at any time?', answer: '…' }]}
 *   />
 */

interface FaqOpenProps extends FaqSectionProps {
  questions: FaqQuestion[]
}

/** Nothing to open: the question is on the page already. */
function reveal() {}

function FaqOpen({
  title,
  description,
  eyebrow,
  heading = 'h2',
  contact,
  questions,
  className,
  ...props
}: FaqOpenProps) {
  const titleId = useId()
  const ref = useRef<HTMLElement>(null)
  useLinkTarget(
    ref,
    useCallback(
      (value: string) => questions.some((question) => question.value === value),
      [questions],
    ),
    reveal,
  )
  const Question = HEADING_BELOW[heading]
  return (
    <section
      ref={ref}
      data-slot='faq-open'
      aria-labelledby={titleId}
      className={cn(faqSectionClassName, className)}
      {...props}
    >
      <div className={cn(faqColumnClassName, 'flex flex-col gap-12')}>
        <div className='flex min-w-0 flex-col gap-8 @3xl/faq:flex-row @3xl/faq:items-end @3xl/faq:justify-between @3xl/faq:gap-16'>
          <SectionHeading
            id={titleId}
            eyebrow={eyebrow}
            title={title}
            description={description}
            heading={heading}
            align='start'
          />
          {contact ? <div className='min-w-0 @3xl/faq:max-w-xs'>{contact}</div> : null}
        </div>
        <div className='grid min-w-0 gap-x-16 gap-y-10 @3xl/faq:grid-cols-2'>
          {questions.map((question) => (
            <div
              key={question.value}
              data-link-target={question.value}
              // A link to it moves focus here, so the keyboard goes on from it.
              tabIndex={-1}
              className={cn(
                linkTargetClassName,
                'focus-visible:ring-ring/50 flex min-w-0 flex-col gap-2 border-t pt-6 focus-visible:rounded-(--surface-radius) focus-visible:ring-3 focus-visible:outline-hidden',
              )}
            >
              <Question className={faqQuestionClassName}>
                <bdi>{question.question}</bdi>
              </Question>
              <div className={faqAnswerClassName}>{question.answer}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

export { FaqOpen, type FaqOpenProps }
