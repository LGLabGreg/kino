import { displayTitleClassName, pageColumnClassName } from '@/registry/lib/hero-parts'
import { SectionHeading, type SectionHeadingLevel } from '@/registry/lib/section-heading'
import type { ComponentProps, ReactNode } from 'react'

import { cn } from '@/lib/utils'

/*
 * What the Call to action blocks share: the words that close a landing page
 * and ask for one thing, the main action with a quieter one beside it, the
 * line under them that makes saying yes easy, and who has said yes already.
 */

/** What every Call to action block takes. */
interface CtaProps extends Omit<ComponentProps<'section'>, 'title' | 'children'> {
  title: ReactNode
  description?: ReactNode
  /** A few words above the title that name the topic. */
  eyebrow?: ReactNode
  /** What makes saying yes easy, under the action, such as Free for teams up to 10. */
  note?: ReactNode
  /** Who has said yes already, under it all: a `CtaProof`. */
  proof?: ReactNode
  /** The title's level: `h2` under the page's `h1`. */
  heading?: SectionHeadingLevel
  /** The main action first, a link in a Button's look, then a quieter one, a `NudgeLink`. */
  actions?: ReactNode
}

/** The section every arrangement stands in, laid out by its own width, in the page's column. */
const ctaSectionClassName =
  '@container/cta relative isolate flex min-h-full w-full min-w-0 flex-col overflow-x-clip bg-background'

/** The title closes the page, so it speaks louder than a section's: the Hero's display type, with room under it. */
const ctaTitleClassName = cn(displayTitleClassName, 'mb-2 text-4xl @3xl:text-5xl')

const ctaColumnClassName = cn(pageColumnClassName, 'py-16 @3xl/cta:py-24')

/** The line under the action: quiet, and short enough to read at a glance. */
function CtaNote({ children }: { children: ReactNode }) {
  return (
    <p className='text-muted-foreground text-sm text-pretty'>
      <bdi>{children}</bdi>
    </p>
  )
}

/** Who has said yes already: faces, or a rating, beside a line that counts them. */
function CtaProof({
  className,
  children,
  label,
}: {
  className?: string
  /** The faces or marks before the line. */
  children?: ReactNode
  /** The line, such as Joined by 4,200 teams this year. */
  label: ReactNode
}) {
  return (
    <div
      data-slot='cta-proof'
      className={cn('flex min-w-0 items-center gap-3', className)}
    >
      {children}
      <p className='text-muted-foreground min-w-0 text-sm text-pretty tabular-nums'>
        <bdi>{label}</bdi>
      </p>
    </div>
  )
}

/**
 * The words of a call to action: the title and its line, then the actions,
 * the note under them and the proof, each group further apart than the
 * lines within it.
 */
function CtaWords({
  titleId,
  title,
  description,
  eyebrow,
  heading = 'h2',
  align = 'center',
  actions,
  note,
  proof,
}: Pick<
  CtaProps,
  'title' | 'description' | 'eyebrow' | 'heading' | 'actions' | 'note' | 'proof'
> & {
  titleId: string
  align?: 'center' | 'start'
}) {
  const center = align === 'center'
  return (
    <SectionHeading
      id={titleId}
      eyebrow={eyebrow}
      title={title}
      description={description}
      heading={heading}
      align={align}
      className='gap-8'
      titleClassName={ctaTitleClassName}
    >
      {actions || note ? (
        <div
          className={cn(
            'flex min-w-0 flex-col gap-3',
            center ? 'items-center' : 'items-start',
          )}
        >
          {actions ? (
            <div
              className={cn(
                'flex flex-wrap items-center gap-x-6 gap-y-3',
                center && 'justify-center',
              )}
            >
              {actions}
            </div>
          ) : null}
          {note ? <CtaNote>{note}</CtaNote> : null}
        </div>
      ) : null}
      {proof}
    </SectionHeading>
  )
}

export { ctaColumnClassName, CtaProof, type CtaProps, ctaSectionClassName, CtaWords }
