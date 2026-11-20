import { NudgeArrow } from '@/registry/lib/hero-parts'
import type { HEADING_BELOW, SectionHeadingLevel } from '@/registry/lib/section-heading'
import { Studio } from '@/registry/lib/studio'
import type { ComponentProps, ReactNode } from 'react'

import { cn } from '@/lib/utils'

/*
 * What the Features blocks share: a feature's words, the stage its picture
 * stands on, and the section around them.
 *
 * A picture is the product at work, made of live components, that plays
 * once when it is seen (`useScene` in `registry/lib/scene`). It is a picture
 * to everyone but the eye: the feature's words say what it shows, so it is
 * hidden from screen readers and nothing in it takes focus or a click.
 */

/** One feature: what it is called, what it does for the person, and the product doing it. */
interface Feature {
  /** Tells the features apart, and names a picked one. */
  value: string
  title: string
  description: ReactNode
  /** Beside the title where there is no picture, or in a list of features. */
  icon?: ReactNode
  /** The product doing it, made of live components that play once when seen (`useScene`). */
  picture?: ReactNode
  /** A link to more about it, after its description. */
  action?: ReactNode
}

/** A feature's heading: a level under the section's title. */
type FeatureHeading = (typeof HEADING_BELOW)[SectionHeadingLevel]

/** The section every arrangement stands in, laid out by its own width. */
const featuresSectionClassName =
  '@container/features relative flex min-h-full w-full min-w-0 flex-col bg-background px-(--surface-padding) py-12 @3xl/features:px-10 @3xl/features:py-16'

/** The content's column, as wide as a page's. */
const featuresColumnClassName = 'mx-auto flex w-full max-w-6xl min-w-0 flex-col gap-10'

/** A feature's icon, in a small tile of its own, so a column of them lines up. */
function FeatureIcon({ className, ...props }: ComponentProps<'span'>) {
  return (
    <span
      aria-hidden
      data-slot='feature-icon'
      className={cn(
        'bg-muted text-foreground flex size-8 shrink-0 items-center justify-center rounded-(--control-radius-capped) [&_svg]:size-4',
        className,
      )}
      {...props}
    />
  )
}

/** The words of a feature: its title, what it does, and a link to more. */
function FeatureWords({
  feature,
  heading: Heading,
  className,
  size = 'default',
}: {
  feature: Feature
  heading: FeatureHeading
  className?: string
  /** `lead` for the one feature told in depth: its words read larger. */
  size?: 'default' | 'lead'
}) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      <Heading
        className={cn(
          'font-semibold tracking-tight text-balance',
          size === 'lead' ? 'text-xl @3xl/features:text-2xl' : 'text-base',
        )}
      >
        {/* Its own direction, so its words read the same way round right to left. */}
        <bdi>{feature.title}</bdi>
      </Heading>
      <p
        className={cn(
          'text-muted-foreground text-pretty',
          size === 'lead' ? 'text-base' : 'text-sm',
        )}
      >
        <bdi>{feature.description}</bdi>
      </p>
      {feature.action ? (
        <div
          className={cn(
            'flex flex-wrap items-center gap-3 text-sm',
            size === 'lead' ? 'mt-4' : 'mt-1.5',
          )}
        >
          {feature.action}
        </div>
      ) : null}
    </div>
  )
}

/**
 * A link to more about a feature, for its `action`: its words, then an arrow
 * that nudges along the line on hover, as the Hero's announcement's does. Name what it's about for a screen
 * reader, since every feature's link may read Learn more.
 */
function FeatureLink({ className, children, ...props }: ComponentProps<'a'>) {
  return (
    <a
      data-slot='feature-link'
      className={cn(
        'group/nudge text-foreground inline-flex min-h-6 items-center gap-1 font-medium underline-offset-4 hover:underline focus-visible:rounded-(--control-radius-xs) focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-hidden',
        className,
      )}
      {...props}
    >
      {children}
      <NudgeArrow className='size-4' />
    </a>
  )
}

/** Where a picture sits on a stage: centred, with room around it. */
const featurePictureClassName =
  'flex w-full min-w-0 items-center justify-center p-3 @md/features:p-6'

/**
 * The stage a picture stands on: a grey studio, lit softly behind it. Hidden
 * from screen readers, with nothing in it to focus or press.
 */
function FeatureStage({ className, children, ...props }: ComponentProps<'div'>) {
  return (
    <div
      inert
      aria-hidden
      data-slot='feature-stage'
      // Its width set, so on a narrow column its min height lowers an aspect ratio rather than widening it.
      className={cn(
        'relative isolate flex min-h-64 w-full min-w-0 overflow-hidden',
        className,
      )}
      {...props}
    >
      <Studio />
      {children ? (
        <div data-slot='feature-picture' className={featurePictureClassName}>
          {children}
        </div>
      ) : null}
    </div>
  )
}

export {
  type Feature,
  type FeatureHeading,
  featuresColumnClassName,
  featuresSectionClassName,
  FeatureIcon,
  FeatureLink,
  featurePictureClassName,
  FeatureStage,
  FeatureWords,
}
