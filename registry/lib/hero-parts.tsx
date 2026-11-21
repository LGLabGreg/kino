'use client'

import { IconPlaceholder } from '@/registry/icons/icon-placeholder'
import { CutTooltip } from '@/registry/lib/cut'
import type { ComponentProps, ReactNode } from 'react'

import { cn } from '@/lib/utils'

/*
 * What the Hero blocks share: the announcement above the title, the title,
 * description and actions, the frame the product shot sits in, the backdrop,
 * and the entrance they play once, in sequence.
 *
 * The entrance is CSS alone, on `starting:` styles, so it plays as the page
 * is first painted, before any script has loaded, and the hero is never
 * hidden waiting for one. The title never starts invisible, so the browser
 * counts its first paint as the page's largest one.
 */

/** The heading levels a hero's title can take: the page's `h1`, unless it sits lower in a page. */
type HeroHeading = 'h1' | 'h2'

/** What every Hero block takes. */
interface HeroProps extends Omit<ComponentProps<'section'>, 'title' | 'children'> {
  title: ReactNode
  description?: ReactNode
  /** A link to what's new, above the title: a `HeroAnnouncement`. */
  announcement?: ReactNode
  /** Links in a Button's look: the main one first. */
  actions?: ReactNode
  /** The product, in a `HeroShot`. */
  shot?: ReactNode
  /** The title's level: the page's `h1`, unless the hero sits lower in a page. */
  heading?: HeroHeading
}

/**
 * Each part's place in the entrance, as the share of the `enter` role's
 * duration it waits, so they arrive one after another.
 */
const ENTER_ORDER = {
  announcement: '[--hero-wait:0]',
  title: '[--hero-wait:0.1]',
  description: '[--hero-wait:0.2]',
  actions: '[--hero-wait:0.3]',
  shot: '[--hero-wait:0.45]',
} as const

type HeroPart = keyof typeof ENTER_ORDER

/** A part rises into place as the page is first painted, after the parts before it. */
const riseClassName =
  'transition-[opacity,translate] duration-(--motion-enter-duration) ease-[var(--motion-enter-fade-easing),var(--motion-enter-easing)] delay-[calc(var(--motion-enter-duration)*var(--hero-wait))] starting:opacity-0 motion-safe:starting:translate-y-(--hero-rise,0.75rem) motion-reduce:transition-[opacity]'

/** The title rises like the other words, but from a faint first frame rather than nothing, so the page's largest text is painted at once. */
const titleRiseClassName =
  'transition-[opacity,translate] duration-(--motion-enter-duration) ease-[var(--motion-enter-fade-easing),var(--motion-enter-easing)] delay-[calc(var(--motion-enter-duration)*var(--hero-wait))] starting:opacity-40 motion-safe:starting:translate-y-(--hero-rise,0.75rem) motion-reduce:transition-[opacity]'

/** The shot rises further than the words, as the largest thing arriving. */
const shotRiseClassName =
  'transition-[opacity,translate] duration-(--motion-enter-duration) ease-[var(--motion-enter-fade-easing),var(--motion-enter-easing)] delay-[calc(var(--motion-enter-duration)*var(--hero-wait))] starting:opacity-0 motion-safe:starting:translate-y-(--hero-shot-rise,2rem) motion-reduce:transition-[opacity]'

/** The classes that play a part's entrance in its place in the sequence. */
function heroEnter(part: HeroPart) {
  return cn(
    ENTER_ORDER[part],
    part === 'title'
      ? titleRiseClassName
      : part === 'shot'
        ? shotRiseClassName
        : riseClassName,
  )
}

/**
 * An arrow that points on along the line, and nudges that way while the link
 * around it, marked `group/nudge`, is hovered: the Hero's announcement and a
 * feature's link. It sits beside text, so it is 16px, as every icon there is.
 */
function NudgeArrow({ className }: { className?: string }) {
  return (
    <IconPlaceholder
      lucide='ArrowRightIcon'
      tabler='IconArrowRight'
      hugeicons='ArrowRight01Icon'
      phosphor='ArrowRightIcon'
      remixicon='RiArrowRightLine'
      aria-hidden
      className={cn(
        'size-4 shrink-0 transition-transform duration-(--motion-press-duration) ease-(--motion-press-easing) group-hover/nudge:translate-x-0.5 motion-reduce:transition-none rtl:-scale-x-100 rtl:group-hover/nudge:-translate-x-0.5',
        className,
      )}
    />
  )
}

/**
 * A quiet link: its words, then an arrow that nudges along the line on
 * hover. A feature's link to more, and the Call to action's second way in
 * beside its main button.
 */
function NudgeLink({ className, children, ...props }: ComponentProps<'a'>) {
  return (
    <a
      data-slot='nudge-link'
      className={cn(
        'group/nudge text-foreground inline-flex min-h-6 items-center gap-1 font-medium underline-offset-4 hover:underline focus-visible:rounded-(--control-radius-xs) focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-hidden',
        className,
      )}
      {...props}
    >
      {children}
      <NudgeArrow />
    </a>
  )
}

/** A link to what's new, above the title: a badge, a line and an arrow that nudges on hover. */
function HeroAnnouncement({
  badge,
  className,
  children,
  ...props
}: ComponentProps<'a'> & {
  /** A word before the line, such as New. */
  badge?: ReactNode
}) {
  return (
    <CutTooltip
      render={
        <a
          data-slot='hero-announcement'
          className={cn(
            'group/nudge bg-background text-foreground hover:bg-muted inline-flex max-w-full min-w-0 items-center gap-2 rounded-(--control-radius) border py-1 ps-1 pe-3 text-sm shadow-xs transition-[background-color,box-shadow] duration-(--motion-press-duration) ease-(--motion-press-fade-easing) focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-hidden',
            // Without a badge the line needs its own room at the start.
            !badge && 'ps-3',
            className,
          )}
          {...props}
        >
          {badge ? (
            <span className='bg-primary text-primary-foreground inline-flex h-5 shrink-0 items-center rounded-(--control-radius-xs) px-1.5 text-xs font-medium'>
              {badge}
            </span>
          ) : null}
          <bdi data-cut className='min-w-0 truncate'>
            {children}
          </bdi>
          <NudgeArrow className='text-muted-foreground' />
        </a>
      }
    />
  )
}

/**
 * A landing page's display type, at any size: tight and balanced across its
 * lines. Display type closes up: a body's tracking leaves gaps between
 * letters this large. The Hero's title and the Call to action's.
 */
const displayTitleClassName =
  'leading-[1.05] font-semibold tracking-[-0.035em] text-balance'

/** The title's look: display type, larger as the hero widens. */
const heroTitleClassName = cn(
  displayTitleClassName,
  'text-4xl @2xl/hero:text-5xl @5xl/hero:text-6xl',
)

/**
 * What the hero stands on: a fine grid that fades out from the top centre,
 * and in the dark a light from above in the primary colour, so the page has
 * depth without a picture. Gradients, not blurs, so they cost nothing to
 * draw while the page scrolls. The section it sits in is `relative isolate`.
 */
function HeroBackdrop({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      aria-hidden
      data-slot='hero-backdrop'
      className={cn(
        'pointer-events-none absolute inset-0 -z-10 overflow-hidden forced-colors:hidden',
        className,
      )}
      {...props}
    >
      {/* Lines a column's width apart, centred, so the grid sits square with the content. */}
      <div className='absolute inset-0 bg-[linear-gradient(to_right,--alpha(var(--color-border)/70%)_1px,transparent_1px),linear-gradient(to_bottom,--alpha(var(--color-border)/70%)_1px,transparent_1px)] bg-size-[4rem_4rem] bg-position-[50%_0] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,#000_10%,transparent_90%)]' />
      <div className='absolute inset-x-0 top-0 hidden h-[36rem] bg-[radial-gradient(ellipse_50%_70%_at_50%_0%,--alpha(var(--color-primary)/14%),transparent)] dark:block' />
    </div>
  )
}

/** The section's look: what every arrangement stands in. */
const heroSectionClassName =
  '@container/hero relative isolate flex min-h-full w-full min-w-0 flex-col overflow-x-clip'

/**
 * A landing page's column: as wide as a page's, with a gutter that grows with
 * the room of the container around it. The Hero's content and the Site
 * header's bar both sit in it, so their edges line up.
 */
const pageColumnClassName =
  'mx-auto w-full max-w-7xl min-w-0 px-(--surface-padding) @3xl:px-10'

/**
 * The words of a hero that reads top to bottom: the announcement, then the
 * title with its description close under it, then the actions, each group
 * further apart than the lines within it.
 */
function HeroWords({
  titleId,
  title,
  description,
  announcement,
  actions,
  heading = 'h1',
  align = 'center',
  titleClassName,
}: Pick<HeroProps, 'title' | 'description' | 'announcement' | 'actions' | 'heading'> & {
  titleId: string
  align?: 'center' | 'start'
  /** Sizes of the title's own, where the arrangement gives it less room. */
  titleClassName?: string
}) {
  const Title = heading
  return (
    <header
      className={cn(
        // As wide as its column, so a long announcement shortens rather than widening it.
        'flex w-full min-w-0 flex-col gap-8',
        align === 'center' ? 'items-center text-center' : 'items-start',
      )}
    >
      {announcement ? (
        <div className={cn('max-w-full', heroEnter('announcement'))}>{announcement}</div>
      ) : null}
      <div
        className={cn(
          'flex min-w-0 flex-col gap-4',
          align === 'center' ? 'max-w-3xl items-center' : 'items-start',
        )}
      >
        <Title
          id={titleId}
          className={cn(heroTitleClassName, titleClassName, heroEnter('title'))}
        >
          {/* Its own direction, so its words read the same way round right to left. */}
          <bdi>{title}</bdi>
        </Title>
        {description ? (
          <p
            className={cn(
              align === 'center' ? 'max-w-2xl' : 'max-w-xl',
              heroEnter('description'),
            )}
          >
            <bdi>{description}</bdi>
          </p>
        ) : null}
      </div>
      {actions ? (
        <div
          className={cn(
            'flex flex-wrap items-center gap-3',
            align === 'center' && 'justify-center',
            heroEnter('actions'),
          )}
        >
          {actions}
        </div>
      ) : null}
    </header>
  )
}

/** The description's look: the title's quieter second voice. */
const heroDescriptionClassName =
  'text-muted-foreground text-base text-pretty @2xl/hero:text-lg'

/**
 * The frame the product shot sits in: a window on a soft bezel. The shot is
 * a picture of the product, so it is one image to a screen reader, named by
 * `label`, and nothing in it takes focus or a click. A `decorative` one,
 * whose words beside it say what it shows, is hidden from screen readers.
 */
function HeroShot({
  label,
  decorative,
  className,
  children,
  ...props
}: Omit<ComponentProps<'div'>, 'role' | 'aria-label'> &
  (
    | {
        /** What the shot shows, as the image's alternative text. */
        label: string
        decorative?: never
      }
    | {
        /** The words beside it say what it shows: it is hidden from screen readers. */
        decorative: true
        label?: never
      }
  )) {
  return (
    <div
      data-slot='hero-shot'
      role={decorative ? undefined : 'img'}
      aria-label={label}
      aria-hidden={decorative}
      className={cn(
        // A bezel as wide as its padding, so the window's corner nests inside its own.
        'bg-foreground/[0.03] ring-foreground/8 relative rounded-[calc(var(--surface-radius)+--spacing(1.5))] p-1.5 ring-1 dark:bg-white/[0.04]',
        // A line of light along the bezel's top edge, as if lit from above.
        'before:pointer-events-none before:absolute before:inset-x-[12%] before:top-0 before:h-px before:bg-linear-to-r before:from-transparent before:via-foreground/25 before:to-transparent dark:before:via-white/50',
        className,
      )}
      {...props}
    >
      <div
        inert
        // In the dark the window is the card's step above the page, so it stands off it.
        className='bg-background dark:bg-card overflow-hidden rounded-(--surface-radius) border shadow-[0_24px_64px_-24px_--alpha(var(--color-black)/25%)] dark:shadow-[0_24px_64px_-16px_--alpha(var(--color-black)/70%)]'
      >
        {children}
      </div>
    </div>
  )
}

export {
  displayTitleClassName,
  HeroAnnouncement,
  HeroBackdrop,
  heroDescriptionClassName,
  heroEnter,
  type HeroProps,
  heroSectionClassName,
  HeroShot,
  HeroWords,
  NudgeArrow,
  NudgeLink,
  pageColumnClassName,
}
