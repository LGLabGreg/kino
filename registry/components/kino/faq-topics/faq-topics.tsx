'use client'

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/registry/components/kino/accordion'
import { Tabs, TabsPanel, TabsList, TabsTab } from '@/registry/components/kino/tabs'
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
import { followHeight, runningTransitions } from '@/registry/lib/resize'
import { HEADING_BELOW, SectionHeading } from '@/registry/lib/section-heading'
import { type ReactNode, useCallback, useEffect, useId, useRef } from 'react'

import { cn } from '@/lib/utils'

/*
 * A landing page's questions sorted into topics: the heading, the topics as
 * tabs under it, and the picked topic's questions as cards, one open at a
 * time. The list moves to the height of the topic picked, so what sits under
 * it glides rather than jumps. A link to a question opens its topic first.
 *
 *   <FaqTopics
 *     title='Questions, answered.'
 *     topics={[{ value: 'billing', label: 'Billing', questions: [{ value: 'cancel', question: 'Can we cancel at any time?', answer: '…' }] }]}
 *   />
 */

/** A group of questions under a name, such as Billing. */
interface FaqTopic {
  /** Tells the topics apart, and names a picked one. */
  value: string
  label: string
  /** Before the label. */
  icon?: ReactNode
  questions: FaqQuestion[]
}

interface FaqTopicsProps extends FaqSectionProps {
  topics: FaqTopic[]
  /** The topic shown, by its `value`. */
  topic?: string
  /** The topic shown at first: the first, unless you give another. */
  defaultTopic?: string
  onTopicChange?: (topic: string) => void
  /** The open question, by its `value`: one at most. */
  value?: string[]
  /** The question open at first: none, unless you give one. */
  defaultValue?: string[]
  onValueChange?: (value: string[]) => void
}

function FaqTopics({
  title,
  description,
  eyebrow,
  heading = 'h2',
  contact,
  topics,
  topic: topicProp,
  defaultTopic,
  onTopicChange,
  value: valueProp,
  defaultValue,
  onValueChange,
  className,
  ...props
}: FaqTopicsProps) {
  const titleId = useId()
  const ref = useRef<HTMLElement>(null)
  const [topic, setTopic] = useControllable(
    topicProp,
    defaultTopic ?? topics[0]?.value ?? '',
    onTopicChange,
  )
  const [open, setOpen] = useControllable(valueProp, defaultValue ?? [], onValueChange)
  const topicOf = useCallback(
    (value: string) =>
      topics.find((each) => each.questions.some((question) => question.value === value)),
    [topics],
  )
  useLinkTarget(
    ref,
    useCallback((value: string) => topicOf(value) !== undefined, [topicOf]),
    useCallback(
      (value: string) => {
        const linked = topicOf(value)
        if (linked) setTopic(linked.value)
        setOpen([value])
      },
      [topicOf, setTopic, setOpen],
    ),
  )

  // The list moves to the height of the topic picked. While an answer opens
  // or closes, the Accordion moves it already, so the list takes its height
  // as it goes.
  const frameRef = useRef<HTMLDivElement>(null)
  const innerRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const frame = frameRef.current
    const inner = innerRef.current
    if (!frame || !inner) return
    return followHeight(frame, inner, {
      // A glide under way goes on from where it is, to the new height.
      instant: () =>
        runningTransitions(frame, { property: 'height' }).length === 0 &&
        runningTransitions(inner, { property: 'height', subtree: true }).length > 0,
    })
  }, [])

  return (
    <section
      ref={ref}
      data-slot='faq-topics'
      aria-labelledby={titleId}
      className={cn(faqSectionClassName, className)}
      {...props}
    >
      <div className={cn(faqColumnClassName, 'flex flex-col items-center gap-10')}>
        <SectionHeading
          id={titleId}
          eyebrow={eyebrow}
          title={title}
          description={description}
          heading={heading}
        />
        <Tabs
          value={topic}
          onValueChange={(next) => setTopic(String(next))}
          // Every topic's questions stay in the page, for the browser's find.
          hiddenUntilFound
          className='flex w-full max-w-3xl min-w-0 flex-col items-center gap-6'
        >
          {/* One topic needs no tabs. */}
          {topics.length > 1 ? (
            <TabsList aria-labelledby={titleId} className='self-center'>
              {topics.map((each) => (
                <TabsTab key={each.value} value={each.value}>
                  {each.icon}
                  <bdi>{each.label}</bdi>
                </TabsTab>
              ))}
            </TabsList>
          ) : null}
          {/* Clipped down the page only, so the cards' shadows keep their sides, with a ring's room above. */}
          <div
            ref={frameRef}
            className='-mt-0.75 -mb-4 w-full min-w-0 overflow-y-clip pt-0.75 pb-4 transition-[height] duration-(--motion-layout-duration) ease-(--motion-layout-easing) motion-reduce:transition-none'
          >
            <div ref={innerRef} className='flex min-w-0 flex-col'>
              {topics.map((each) => (
                <TabsPanel
                  key={each.value}
                  value={each.value}
                  // Its ring inside, where the list's clip can't cut it.
                  className='focus-visible:ring-inset'
                >
                  <Accordion
                    variant='card'
                    hiddenUntilFound
                    heading={HEADING_BELOW[heading]}
                    value={open}
                    onValueChange={(next) => setOpen(next.map(String))}
                  >
                    {each.questions.map((question) => (
                      <AccordionItem
                        key={question.value}
                        value={question.value}
                        data-link-target={question.value}
                        className={linkTargetClassName}
                      >
                        <AccordionTrigger
                          data-link-focus=''
                          className='py-4 [&>svg]:mt-1'
                        >
                          <span className={cn(faqQuestionClassName, 'min-w-0 flex-1')}>
                            <bdi>{question.question}</bdi>
                          </span>
                        </AccordionTrigger>
                        <AccordionContent className={cn(faqAnswerClassName, 'pe-10')}>
                          {question.answer}
                        </AccordionContent>
                      </AccordionItem>
                    ))}
                  </Accordion>
                </TabsPanel>
              ))}
            </div>
          </div>
        </Tabs>
        {contact ? (
          <div className='flex w-full max-w-3xl min-w-0 justify-center'>{contact}</div>
        ) : null}
      </div>
    </section>
  )
}

export { type FaqTopic, FaqTopics, type FaqTopicsProps }
