'use client'

import {
  ReleaseChanges,
  ReleaseDate,
  ReleaseFilter,
  type ReleaseFilterOptions,
  ReleaseLinkButton,
  ReleasePicture,
  ReleaseTags,
  useReleaseFilter,
} from '@/registry/components/kino/changelog/changelog-parts'
import { flowItemClassName, useFlow } from '@/registry/lib/flow'
import { sectionColumnClassName } from '@/registry/lib/hero-parts'
import {
  linkLandingClassName,
  linkTargetClassName,
  useLinkTarget,
} from '@/registry/lib/link-target'
import { markMounted, mergeRefs } from '@/registry/lib/refs'
import {
  HEADING_BELOW,
  SectionHeading,
  type SectionHeadingLevel,
} from '@/registry/lib/section-heading'
import { type ComponentProps, type ReactNode, useId, useMemo, useRef } from 'react'

import { cn } from '@/lib/utils'

/*
 * A product's releases told at length, one after another under a centred
 * heading and the way to hear of the next one. Each release's day, version
 * and tags stay in view on the start side while its story scrolls past:
 * the title, a picture of the product doing it, a sentence on what it does
 * for the person, and the notes. Picking a tag narrows the list: the
 * releases that stay glide up to close the gaps and the ones that go fade
 * where they were.
 *
 *   <Changelog
 *     title='What’s new in Kino'
 *     tags={[{ value: 'cycles', label: 'Cycles' }]}
 *     releases={[{ value: '2-6', date: '2026-11-18', version: '2.6', title: 'Plan a cycle in one pass', tags: ['cycles'], picture: <CyclePicture /> }]}
 *     subscribe={<ChangelogSubscribe onSubscribe={subscribe} feedHref='/changelog/rss.xml' />}
 *   />
 */

interface ChangelogProps
  extends
    Omit<ComponentProps<'section'>, 'title' | 'children' | 'defaultValue' | 'onChange'>,
    ReleaseFilterOptions {
  title: ReactNode
  description?: ReactNode
  /** A few words above the title that name the topic. */
  eyebrow?: ReactNode
  /** The title's level: `h2` under the page's `h1`. Each release is a level under it. */
  heading?: SectionHeadingLevel
  /** How a visitor hears of the next release: a `ChangelogSubscribe`. */
  subscribe?: ReactNode
  /** After the last release: a link to the older ones, such as a `NudgeLink`. */
  older?: ReactNode
  /** The language the dates are written in: `en-US` writes Nov 12, 2026. */
  locale?: string
}

/**
 * A release a link lands on: it stops short of the top, and takes the
 * focus with a ring around it, clear of what it holds.
 */
const releaseTargetClassName =
  'rounded-(--surface-radius) focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-offset-4 focus-visible:ring-offset-background focus-visible:outline-hidden'

function Changelog({
  title,
  description,
  eyebrow,
  heading = 'h2',
  releases,
  tags,
  tag,
  defaultTag,
  onTagChange,
  subscribe,
  older,
  locale,
  className,
  ...props
}: ChangelogProps) {
  const titleId = useId()
  const listId = useId()
  const ref = useRef<HTMLElement>(null)
  const filter = useReleaseFilter({
    releases,
    tags,
    tag,
    defaultTag,
    onTagChange,
  })
  useLinkTarget(ref, filter.has, filter.show)
  const { frame, row } = useFlow<HTMLDivElement, HTMLOListElement>(
    '[data-slot=changelog-release]',
    'data-link-target',
  )
  const rowRef = useMemo(() => mergeRefs(row, markMounted), [row])
  const Release = HEADING_BELOW[heading]
  const picked = filter.tags.find((each) => each.value === filter.tag)
  return (
    <section
      ref={ref}
      data-slot='changelog'
      aria-labelledby={titleId}
      className={cn(
        '@container/changelog relative flex min-h-full w-full min-w-0 flex-col bg-background',
        linkLandingClassName,
        className,
      )}
      {...props}
    >
      <div className={cn(sectionColumnClassName, 'flex flex-col gap-12')}>
        <div className='flex min-w-0 flex-col items-center gap-8'>
          <SectionHeading
            id={titleId}
            eyebrow={eyebrow}
            title={title}
            description={description}
            heading={heading}
          />
          {subscribe ? (
            <div className='flex w-full max-w-md min-w-0 justify-center'>{subscribe}</div>
          ) : null}
          <ReleaseFilter
            tags={filter.tags}
            tag={filter.tag}
            onPick={filter.pick}
            controls={listId}
          />
        </div>
        <div className='mx-auto flex w-full max-w-5xl min-w-0 flex-col gap-10'>
          <div
            ref={frame}
            className='overflow-clip transition-[height] duration-(--motion-layout-duration) ease-(--motion-layout-easing) [overflow-clip-margin:0.5rem] motion-reduce:transition-none'
          >
            <ol
              ref={rowRef}
              id={listId}
              aria-label={picked ? `${picked.label} releases` : 'Releases'}
              className='group/flow relative isolate flex min-w-0 flex-col bg-background'
            >
              {filter.shown.map((release) => {
                const releaseTitleId = `${listId}-${release.value}`
                return (
                  <li
                    key={release.value}
                    data-slot='changelog-release'
                    data-link-target={release.value}
                    // A link to it moves focus here, so the keyboard goes on from it.
                    tabIndex={-1}
                    className={cn(
                      flowItemClassName,
                      linkTargetClassName,
                      releaseTargetClassName,
                      'bg-background flex min-w-0',
                    )}
                  >
                    <article
                      aria-labelledby={releaseTitleId}
                      // Every release opens on its own rule, the first too, so none takes a style from where it sits while others come and go.
                      className='grid min-w-0 flex-1 gap-x-12 gap-y-5 border-t py-12 @3xl/changelog:grid-cols-[11rem_minmax(0,1fr)] @3xl/changelog:py-16'
                    >
                      {/* Beside its story, it stays in view while the story scrolls past. */}
                      <div className='flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 text-sm @3xl/changelog:sticky @3xl/changelog:top-(--changelog-sticky-top,--spacing(8)) @3xl/changelog:flex-col @3xl/changelog:items-start @3xl/changelog:self-start'>
                        <ReleaseDate
                          date={release.date}
                          locale={locale}
                          className='text-foreground font-medium'
                        />
                        {release.version ? (
                          <span className='text-muted-foreground min-w-0 wrap-anywhere tabular-nums'>
                            Version <bdi>{release.version}</bdi>
                          </span>
                        ) : null}
                        <ReleaseTags
                          release={release}
                          tags={filter.tags}
                          className='@3xl/changelog:mt-1'
                        />
                      </div>
                      <div className='flex min-w-0 flex-col gap-6'>
                        <div className='flex min-w-0 items-start justify-between gap-3'>
                          <Release
                            id={releaseTitleId}
                            className='min-w-0 text-2xl leading-tight font-semibold tracking-tight text-balance wrap-anywhere'
                          >
                            <bdi>{release.title}</bdi>
                          </Release>
                          <ReleaseLinkButton
                            release={release}
                            className='-me-1.5 shrink-0'
                          />
                        </div>
                        {release.picture ? (
                          <ReleasePicture className='min-h-72 @3xl/changelog:min-h-80'>
                            {release.picture}
                          </ReleasePicture>
                        ) : null}
                        {release.summary ? (
                          <p className='max-w-prose text-base text-pretty'>
                            {release.summary}
                          </p>
                        ) : null}
                        {release.changes ? (
                          <ReleaseChanges
                            changes={release.changes}
                            className='max-w-prose'
                          />
                        ) : null}
                      </div>
                    </article>
                  </li>
                )
              })}
            </ol>
          </div>
          {older ? (
            <div className='flex min-w-0 border-t pt-8 @3xl/changelog:ps-[calc(11rem+--spacing(12))]'>
              {older}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  )
}

export { Changelog, type ChangelogProps }
