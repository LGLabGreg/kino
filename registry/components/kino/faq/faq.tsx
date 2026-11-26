'use client'

import {
  Accordion,
  AccordionPanel,
  AccordionItem,
  AccordionTrigger,
} from '@/registry/components/kino/accordion'
import { useControllable } from '@/registry/lib/controllable'
import {
  faqAnswerClassName,
  faqColumnClassName,
  type FaqSectionProps,
  type FaqQuestion,
  faqQuestionClassName,
  faqSectionClassName,
} from '@/registry/lib/faq-parts'
import { linkTargetClassName, useLinkTarget } from '@/registry/lib/link-target'
import { numberFormatter } from '@/registry/lib/number-format'
import { HEADING_BELOW, SectionHeading } from '@/registry/lib/section-heading'
import { useCallback, useId, useRef } from 'react'

import { cn } from '@/lib/utils'

/*
 * A landing page's questions beside their heading: the title, its line and
 * who to ask on the start side, where they stay while the list scrolls past,
 * and the questions, numbered, on the end side. Any number of answers stay
 * open at once, so a visitor can compare two. Closed answers stay in the
 * page, so the browser's find opens the one it finds.
 *
 *   <Faq
 *     title='Questions, answered.'
 *     questions={[{ value: 'cancel', question: 'Can we cancel at any time?', answer: '…' }]}
 *     contact={<FaqContact title='Still have a question?' action={<NudgeLink href='mailto:help@kino.app'>Write to us</NudgeLink>} />}
 *   />
 */

interface FaqProps extends FaqSectionProps {
  questions: FaqQuestion[]
  /** The open questions, by their `value`. */
  value?: string[]
  /** The questions open at first: none, unless you give some. */
  defaultValue?: string[]
  onValueChange?: (value: string[]) => void
}

/** Two digits, so the questions' numbers line up: 01 to 99. */
const twoDigits = numberFormatter('en-US', { minimumIntegerDigits: 2 })

function Faq({
  title,
  description,
  eyebrow,
  heading = 'h2',
  contact,
  questions,
  value: valueProp,
  defaultValue,
  onValueChange,
  className,
  ...props
}: FaqProps) {
  const titleId = useId()
  const ref = useRef<HTMLElement>(null)
  const [open, setOpen] = useControllable(valueProp, defaultValue ?? [], onValueChange)
  useLinkTarget(
    ref,
    useCallback(
      (value: string) => questions.some((question) => question.value === value),
      [questions],
    ),
    useCallback(
      (value: string) => {
        if (!open.includes(value)) setOpen([...open, value])
      },
      [open, setOpen],
    ),
  )
  return (
    <section
      ref={ref}
      data-slot='faq'
      aria-labelledby={titleId}
      className={cn(faqSectionClassName, className)}
      {...props}
    >
      <div
        className={cn(
          faqColumnClassName,
          'grid gap-10 @3xl/faq:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] @3xl/faq:gap-16',
        )}
      >
        {/* Beside a long list, it stays in view while the list scrolls past. */}
        <div className='flex min-w-0 flex-col gap-8 @3xl/faq:sticky @3xl/faq:top-(--faq-sticky-top,--spacing(8)) @3xl/faq:self-start'>
          <SectionHeading
            id={titleId}
            eyebrow={eyebrow}
            title={title}
            description={description}
            heading={heading}
            align='start'
          />
          {contact}
        </div>
        <Accordion
          multiple
          hiddenUntilFound
          heading={HEADING_BELOW[heading]}
          value={open}
          onValueChange={(next) => setOpen(next.map(String))}
          className='min-w-0 border-y'
        >
          {questions.map((question, index) => (
            <AccordionItem
              key={question.value}
              value={question.value}
              data-link-target={question.value}
              className={linkTargetClassName}
            >
              <AccordionTrigger data-link-focus='' className='gap-4 py-5 [&>svg]:mt-1'>
                <span
                  aria-hidden
                  className='text-muted-foreground w-6 shrink-0 text-sm leading-6 tabular-nums'
                >
                  {twoDigits.format(index + 1)}
                </span>
                <span className={cn(faqQuestionClassName, 'min-w-0 flex-1')}>
                  <bdi>{question.question}</bdi>
                </span>
              </AccordionTrigger>
              <AccordionPanel className={cn(faqAnswerClassName, 'ps-10 pe-8 pb-6')}>
                {question.answer}
              </AccordionPanel>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </section>
  )
}

export { Faq, type FaqProps }
