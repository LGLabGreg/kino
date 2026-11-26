'use client'

import { Badge } from '@/registry/components/kino/badge'
import { buttonVariants } from '@/registry/components/kino/button'
import { CopyButton } from '@/registry/components/kino/copy-button'
import {
  SegmentedControl,
  SegmentedControlItem,
} from '@/registry/components/kino/segmented-control'
import { IconPlaceholder } from '@/registry/icons/icon-placeholder'
import { announce } from '@/registry/lib/announce'
import { useControllable } from '@/registry/lib/controllable'
import { formatDate } from '@/registry/lib/dates'
import { FeatureStage } from '@/registry/lib/feature-parts'
import { NewsletterForm } from '@/registry/lib/newsletter'
import { numberFormatter } from '@/registry/lib/number-format'
import { type ReactNode, useCallback, useId } from 'react'

import { cn } from '@/lib/utils'

/*
 * The Changelog's parts: a release and what it changed, the tags a visitor
 * narrows the releases by, and the form that sends each release by email
 * with the feed beside it.
 */

/** What a change is, which its icon and its word say. */
type ChangeKind = 'breaking' | 'new' | 'improved' | 'fixed'

/** One line of a release's notes. */
interface ReleaseChange {
  kind: ChangeKind
  text: ReactNode
}

/** One release: when it shipped, what it is called, and what it changed. */
interface ChangelogRelease {
  /** Tells the releases apart, and names this one in a link to it: `#2-6` shows it. */
  value: string
  /** The day it shipped, as `yyyy-mm-dd`. */
  date: string
  /** Such as 2.6. */
  version?: string
  title: string
  /** What it does for the person, in a sentence or two. */
  summary?: ReactNode
  /** The `value`s of the tags it is filed under, such as `cycles`. */
  tags?: string[]
  /** The product doing it, made of live components that play once when seen (`useScene`). */
  picture?: ReactNode
  /** Its notes, in any order: each kind is listed together, breaking changes first. */
  changes?: ReleaseChange[]
}

/** A part of the product a release can be filed under, such as Cycles. */
interface ChangelogTag {
  value: string
  label: string
}

/** The filter that shows every release. */
const ALL = 'all'

/** The releases and the tag that narrows them, as the Changelog takes them. */
interface ReleaseFilterOptions {
  /** Newest first. */
  releases: ChangelogRelease[]
  /** In the order they read. Those that file a release become the filter, after All. */
  tags?: ChangelogTag[]
  /** The tag shown, by its `value`, or `all`. */
  tag?: string
  /** The tag shown at first: All, unless you give another. */
  defaultTag?: string
  onTagChange?: (tag: string) => void
}

/* The filter ---------------------------------------------------------------- */

/** The tags that file at least one release, in the order given. */
function tagsInUse(
  tags: readonly ChangelogTag[],
  releases: readonly ChangelogRelease[],
): ChangelogTag[] {
  return tags.filter((tag) =>
    releases.some((release) => release.tags?.includes(tag.value)),
  )
}

/** The releases filed under `tag`, or every one for `all`, in the order given. */
function releasesIn(
  releases: readonly ChangelogRelease[],
  tag: string,
): ChangelogRelease[] {
  return tag === ALL
    ? [...releases]
    : releases.filter((release) => release.tags?.includes(tag))
}

const count = numberFormatter('en-US')

/** How many releases there are, in words: “1 release”, “12 releases”. */
function releaseCount(total: number): string {
  return `${count.format(total)} ${total === 1 ? 'release' : 'releases'}`
}

/**
 * The tag a Changelog shows and the releases under it. Picking a tag says
 * how many releases it holds.
 * `show` brings a release back into view for a link to it, picking All
 * when the tag shown hides it.
 */
function useReleaseFilter({
  releases,
  tags = [],
  tag: tagProp,
  defaultTag = ALL,
  onTagChange,
}: ReleaseFilterOptions) {
  const [tag, setTag] = useControllable(tagProp, defaultTag, onTagChange)
  const inUse = tagsInUse(tags, releases)
  // A tag that files nothing, or none given, shows every release.
  const shownTag = inUse.some((each) => each.value === tag) ? tag : ALL
  const pick = (next: string) => {
    setTag(next)
    announce(releaseCount(releasesIn(releases, next).length))
  }
  const has = useCallback(
    (value: string) => releases.some((release) => release.value === value),
    [releases],
  )
  const show = useCallback(
    (value: string) => {
      const release = releases.find((each) => each.value === value)
      if (release && shownTag !== ALL && !release.tags?.includes(shownTag)) setTag(ALL)
    },
    [releases, shownTag, setTag],
  )
  return {
    tag: shownTag,
    tags: inUse,
    shown: releasesIn(releases, shownTag),
    pick,
    has,
    show,
  }
}

/**
 * The tags to narrow the releases by, after All, as a Segmented control
 * whose pill slides to the pick. Nothing, with fewer than two tags in use.
 */
function ReleaseFilter({
  tags,
  tag,
  onPick,
  controls,
  className,
}: {
  /** The tags in use, as `useReleaseFilter` gives them. */
  tags: readonly ChangelogTag[]
  tag: string
  onPick: (tag: string) => void
  /** The id of the list the filter narrows. */
  controls?: string
  className?: string
}) {
  if (tags.length < 2) return null
  return (
    <SegmentedControl
      aria-label='Show releases for'
      aria-controls={controls}
      value={tag}
      onValueChange={(next) => onPick(String(next))}
      className={className}
    >
      <SegmentedControlItem value={ALL}>All</SegmentedControlItem>
      {tags.map((each) => (
        <SegmentedControlItem key={each.value} value={each.value}>
          {each.label}
        </SegmentedControlItem>
      ))}
    </SegmentedControl>
  )
}

/* A release ----------------------------------------------------------------- */

/** The day it shipped, as the locale writes it: Nov 12, 2026. */
function ReleaseDate({
  date,
  locale = 'en-US',
  className,
}: {
  date: string
  locale?: string
  className?: string
}) {
  return (
    <time dateTime={date} className={cn('tabular-nums', className)}>
      {formatDate(date, locale, { year: 'numeric', month: 'short', day: 'numeric' })}
    </time>
  )
}

/** The tags it is filed under, as quiet badges, by their labels. */
function ReleaseTags({
  release,
  tags = [],
  className,
}: {
  release: ChangelogRelease
  tags?: readonly ChangelogTag[]
  className?: string
}) {
  const filed = tags.filter((tag) => release.tags?.includes(tag.value))
  if (filed.length === 0) return null
  return (
    <ul
      aria-label='Tags'
      className={cn('flex min-w-0 flex-wrap items-center gap-1.5', className)}
    >
      {filed.map((tag) => (
        <li key={tag.value} className='flex min-w-0'>
          <Badge variant='secondary'>
            <bdi>{tag.label}</bdi>
          </Badge>
        </li>
      ))}
    </ul>
  )
}

/** A link to the release, copied: its icon rolls to a tick, and a screen reader hears so. */
function ReleaseLinkButton({
  release,
  className,
}: {
  release: ChangelogRelease
  className?: string
}) {
  return (
    <CopyButton
      size='icon-sm'
      aria-label={`Copy link to ${release.title}`}
      value={() => {
        const url = new URL(window.location.href)
        url.hash = release.value
        return url.href
      }}
      icon={
        <IconPlaceholder
          lucide='LinkIcon'
          tabler='IconLink'
          hugeicons='Link01Icon'
          phosphor='LinkIcon'
          remixicon='RiLinkM'
          aria-hidden
        />
      }
      copiedLabel='Link copied'
      className={cn('text-muted-foreground hover:text-foreground', className)}
    />
  )
}

/** The order each kind is listed in, and its word. */
const KINDS: readonly { kind: ChangeKind; label: string }[] = [
  { kind: 'breaking', label: 'Breaking' },
  { kind: 'new', label: 'New' },
  { kind: 'improved', label: 'Improved' },
  { kind: 'fixed', label: 'Fixed' },
]

/** Each kind's icon beside its word, so a kind never relies on colour alone. */
function KindIcon({ kind }: { kind: ChangeKind }) {
  switch (kind) {
    case 'breaking':
      return (
        <IconPlaceholder
          lucide='TriangleAlertIcon'
          tabler='IconAlertTriangle'
          hugeicons='Alert02Icon'
          phosphor='WarningIcon'
          remixicon='RiAlertLine'
          aria-hidden
          className='text-warning'
        />
      )
    case 'new':
      return (
        <IconPlaceholder
          lucide='SparklesIcon'
          tabler='IconSparkles'
          hugeicons='SparklesIcon'
          phosphor='SparkleIcon'
          remixicon='RiSparklingLine'
          aria-hidden
        />
      )
    case 'improved':
      return (
        <IconPlaceholder
          lucide='CircleArrowUpIcon'
          tabler='IconCircleArrowUp'
          hugeicons='CircleArrowUp01Icon'
          phosphor='ArrowCircleUpIcon'
          remixicon='RiArrowUpCircleLine'
          aria-hidden
        />
      )
    case 'fixed':
      return (
        <IconPlaceholder
          lucide='WrenchIcon'
          tabler='IconTool'
          hugeicons='Wrench01Icon'
          phosphor='WrenchIcon'
          remixicon='RiToolsLine'
          aria-hidden
        />
      )
  }
}

/** The changes of each kind, in the order they are listed: breaking first. */
function changesByKind(changes: readonly ReleaseChange[]) {
  return KINDS.map(({ kind, label }) => ({
    kind,
    label,
    lines: changes.filter((change) => change.kind === kind),
  })).filter((group) => group.lines.length > 0)
}

/**
 * A release's notes, each kind under its icon and word: Breaking, New,
 * Improved, Fixed. A breaking change sits in a tint of its own, so nobody
 * upgrading reads past it.
 */
function ReleaseChanges({
  changes,
  className,
}: {
  changes: readonly ReleaseChange[]
  className?: string
}) {
  const id = useId()
  const groups = changesByKind(changes)
  if (groups.length === 0) return null
  return (
    <div
      data-slot='release-changes'
      className={cn('flex min-w-0 flex-col gap-5 text-sm', className)}
    >
      {groups.map((group) => (
        <div
          key={group.kind}
          data-kind={group.kind}
          className='flex min-w-0 flex-col gap-2 data-[kind=breaking]:rounded-(--surface-radius) data-[kind=breaking]:bg-warning/8 data-[kind=breaking]:p-(--surface-padding) data-[kind=breaking]:[&_ul]:text-foreground dark:data-[kind=breaking]:bg-warning/12 forced-colors:data-[kind=breaking]:border'
        >
          <p
            id={`${id}-${group.kind}`}
            className='text-foreground flex items-center gap-2 font-medium [&_svg]:size-4'
          >
            <KindIcon kind={group.kind} />
            {group.label}
          </p>
          <ul
            aria-labelledby={`${id}-${group.kind}`}
            className='text-muted-foreground marker:text-muted-foreground/60 flex min-w-0 list-disc flex-col gap-1.5 ps-6 text-pretty wrap-break-word [&_a]:text-foreground [&_a]:font-medium [&_a]:underline [&_a]:underline-offset-4 [&_code]:text-foreground [&_code]:font-mono [&_code]:text-[0.8125rem]'
          >
            {group.lines.map((line, index) => (
              <li key={index} className='ps-0.5'>
                {line.text}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}

/** The stage a release's picture stands on, as a feature's does. */
function ReleasePicture({
  className,
  children,
}: {
  className?: string
  children: ReactNode
}) {
  return (
    <FeatureStage className={cn('min-h-72 rounded-(--surface-radius) border', className)}>
      {children}
    </FeatureStage>
  )
}

/* Subscribing --------------------------------------------------------------- */

/**
 * How a visitor hears of the next release: the form that sends each one
 * by email, and the feed beside it for a reader.
 */
function ChangelogSubscribe({
  onSubscribe,
  feedHref,
  submitLabel,
  className,
}: {
  /** Signs the address up. A throw or a rejected promise says it couldn't. Left out, there is no form. */
  onSubscribe?: (email: string) => unknown
  /** The changelog's RSS or Atom feed. */
  feedHref?: string
  submitLabel?: string
  className?: string
}) {
  return (
    <div
      data-slot='changelog-subscribe'
      className={cn(
        'flex min-w-0 flex-col items-start gap-2',
        onSubscribe && 'w-full',
        className,
      )}
    >
      {onSubscribe ? (
        <NewsletterForm
          onSubscribe={onSubscribe}
          submitLabel={submitLabel}
          className='w-full'
        />
      ) : null}
      {feedHref ? (
        <a
          href={feedHref}
          className={cn(
            buttonVariants({ variant: 'link', size: 'sm' }),
            'text-muted-foreground hover:text-foreground h-auto min-h-6 gap-1.5 px-0 font-normal',
          )}
        >
          <IconPlaceholder
            lucide='RssIcon'
            tabler='IconRss'
            hugeicons='RssIcon'
            phosphor='RssIcon'
            remixicon='RiRssLine'
            aria-hidden
          />
          {onSubscribe ? 'Or follow the RSS feed' : 'Follow the RSS feed'}
        </a>
      ) : null}
    </div>
  )
}

export {
  ALL,
  type ChangeKind,
  type ChangelogRelease,
  ChangelogSubscribe,
  type ChangelogTag,
  changesByKind,
  ReleaseChanges,
  type ReleaseChange,
  releaseCount,
  ReleaseDate,
  ReleaseFilter,
  ReleaseLinkButton,
  ReleasePicture,
  ReleaseTags,
  releasesIn,
  type ReleaseFilterOptions,
  tagsInUse,
  useReleaseFilter,
}
