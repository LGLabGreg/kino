'use client'

import { Badge } from '@/registry/components/kino/badge'
import { Button, buttonVariants } from '@/registry/components/kino/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardLink,
  CardTitle,
} from '@/registry/components/kino/card'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/registry/components/kino/empty'
import { resultsLabel, SearchField } from '@/registry/components/kino/search-field'
import {
  SegmentedControl,
  SegmentedControlItem,
} from '@/registry/components/kino/segmented-control'
import { IconPlaceholder } from '@/registry/icons/icon-placeholder'
import { announce } from '@/registry/lib/announce'
import { useControllable } from '@/registry/lib/controllable'
import { flowItemClassName, useFlow } from '@/registry/lib/flow'
import { pageColumnClassName } from '@/registry/lib/hero-parts'
import {
  type Integration,
  integrationsSectionClassName,
  type IntegrationsSectionProps,
  IntegrationTile,
} from '@/registry/lib/integrations-parts'
import { matchRange } from '@/registry/lib/match'
import { markMounted, mergeRefs } from '@/registry/lib/refs'
import { HEADING_BELOW, SectionHeading } from '@/registry/lib/section-heading'
import { type ComponentProps, type ReactNode, useId, useMemo, useRef } from 'react'

import { cn } from '@/lib/utils'

/*
 * Every tool your product works with, as a grid of cards a visitor narrows
 * by category and by name. The cards that stay glide to their new places,
 * the ones that go fade where they were, and the grid moves to its new
 * height, so a filter shows what it took away rather than swapping the page.
 * When nothing matches, it says so, offers the same search in every
 * category, and asks what to connect next.
 *
 *   <IntegrationsDirectory
 *     title='Kino works with the tools you have'
 *     categories={[{ value: 'engineering', label: 'Engineering' }]}
 *     integrations={[{ value: 'github', name: 'GitHub', description: 'Link pull requests to issues.', category: 'engineering', logo: { src: '/logos/tools/github.svg', width: 24, height: 24 }, href: '/integrations/github' }]}
 *     requestHref='/integrations/request'
 *   />
 */

/** A tool in the directory: filed under a category, with a word beside its name if it has one. */
interface DirectoryIntegration extends Integration {
  /** The `value` of the category it is filed under. */
  category: string
  /** A word beside its name, such as New or Beta. */
  badge?: ReactNode
}

/** A group of tools under a name, such as Engineering. */
interface IntegrationCategory {
  value: string
  label: string
}

/** The category that holds every tool. */
const ALL = 'all'

interface IntegrationsDirectoryProps
  extends
    IntegrationsSectionProps,
    Omit<ComponentProps<'section'>, 'title' | 'children'> {
  integrations: DirectoryIntegration[]
  /** In the order they read; a first category, All, holds every tool. */
  categories: IntegrationCategory[]
  /** The category shown, by its `value`, or `all`. */
  category?: string
  /** The category shown at first: All, unless you give another. */
  defaultCategory?: string
  onCategoryChange?: (category: string) => void
  /** What the search field holds. */
  query?: string
  defaultQuery?: string
  onQueryChange?: (query: string) => void
  /** Where a visitor asks for a tool that isn't listed. */
  requestHref?: string
}

function IntegrationsDirectory({
  title,
  eyebrow,
  description,
  heading = 'h2',
  integrations,
  categories,
  category: categoryProp,
  defaultCategory = ALL,
  onCategoryChange,
  query: queryProp,
  defaultQuery = '',
  onQueryChange,
  requestHref,
  className,
  ...props
}: IntegrationsDirectoryProps) {
  const titleId = useId()
  const gridId = useId()
  const [category, setCategory] = useControllable(
    categoryProp,
    defaultCategory,
    onCategoryChange,
  )
  const [query, setQuery] = useControllable(queryProp, defaultQuery, onQueryChange)
  const { frame, row } = useFlow<HTMLDivElement, HTMLUListElement>(
    '[data-slot=integrations-directory-item]',
    'data-integration',
  )
  const rowRef = useMemo(() => mergeRefs(row, markMounted), [row])
  // The empty state's buttons go with it, so the focus goes back to the search.
  const search = useRef<HTMLInputElement>(null)

  const shown = filterIntegrations(integrations, categories, category, query)
  const elsewhere =
    shown.length === 0 && category !== ALL
      ? filterIntegrations(integrations, categories, ALL, query).length
      : 0
  const picked = categories.find((entry) => entry.value === category)
  const searching = query.trim() !== ''
  const cardHeading = HEADING_BELOW[heading]

  const pick = (next: string) => {
    setCategory(next)
    // The search field reads its own count; a category's is said here.
    if (!searching) {
      const count = filterIntegrations(integrations, categories, next, '').length
      announce(toolCount(count))
    }
  }

  return (
    <section
      data-slot='integrations-directory'
      aria-labelledby={titleId}
      className={cn(integrationsSectionClassName, className)}
      {...props}
    >
      <div className={cn(pageColumnClassName, 'flex flex-col gap-10 py-16 @3xl:py-24')}>
        <SectionHeading
          id={titleId}
          eyebrow={eyebrow}
          title={title}
          description={description}
          heading={heading}
        />
        <div className='flex min-w-0 flex-col gap-6'>
          {/* Side by side only where every category fits beside the search. */}
          <div className='flex min-w-0 flex-col gap-3 @5xl/integrations:flex-row @5xl/integrations:items-center @5xl/integrations:justify-between'>
            <SegmentedControl
              aria-label='Category'
              aria-controls={gridId}
              value={category}
              onValueChange={(next) => pick(String(next))}
            >
              <SegmentedControlItem value={ALL}>All</SegmentedControlItem>
              {categories.map((entry) => (
                <SegmentedControlItem key={entry.value} value={entry.value}>
                  {entry.label}
                </SegmentedControlItem>
              ))}
            </SegmentedControl>
            <SearchField
              ref={search}
              aria-label='Search integrations'
              aria-controls={gridId}
              placeholder='Search integrations'
              shortcut='/'
              value={query}
              onValueChange={(next) => setQuery(String(next))}
              count={searching ? shown.length : undefined}
              countLabel={toolCount}
              className='@5xl/integrations:w-72'
            />
          </div>
          <div
            ref={frame}
            className='overflow-clip transition-[height] duration-(--motion-layout-duration) ease-(--motion-layout-easing) motion-reduce:transition-none'
          >
            <ul
              ref={rowRef}
              id={gridId}
              aria-label={picked ? picked.label : 'All integrations'}
              className='group/flow relative isolate grid min-w-0 grid-cols-1 gap-3 @xl/integrations:grid-cols-2 @4xl/integrations:grid-cols-3'
            >
              {shown.map((integration) => (
                <li
                  key={integration.value}
                  data-slot='integrations-directory-item'
                  data-integration={integration.value}
                  className={cn(flowItemClassName, 'flex min-w-0')}
                >
                  <IntegrationCard integration={integration} heading={cardHeading} />
                </li>
              ))}
              {/* In the grid, so the grid moves to its height as the last cards fade. */}
              <li className='col-span-full flex empty:hidden'>
                <Empty show={shown.length === 0} className='py-10'>
                  <EmptyHeader>
                    <EmptyMedia variant='icon'>
                      <IconPlaceholder
                        lucide='SearchIcon'
                        tabler='IconSearch'
                        hugeicons='Search01Icon'
                        phosphor='MagnifyingGlassIcon'
                        remixicon='RiSearchLine'
                        aria-hidden
                      />
                    </EmptyMedia>
                    <EmptyTitle>{emptyTitle(picked?.label, query)}</EmptyTitle>
                    <EmptyDescription>
                      {elsewhere > 0
                        ? `${toolCount(elsewhere)} in other categories.`
                        : searching
                          ? 'Check the spelling, or tell us what to connect next.'
                          : 'Tell us what to connect next.'}
                    </EmptyDescription>
                  </EmptyHeader>
                  <EmptyContent className='flex-row flex-wrap justify-center'>
                    {elsewhere > 0 ? (
                      <Button
                        variant='outline'
                        size='sm'
                        onClick={() => {
                          pick(ALL)
                          search.current?.focus()
                        }}
                      >
                        {searching ? 'Search all categories' : 'Show all integrations'}
                      </Button>
                    ) : searching ? (
                      <Button
                        variant='outline'
                        size='sm'
                        onClick={() => {
                          setQuery('')
                          // The search field says nothing once it is empty, so the count is said here.
                          announce(
                            toolCount(
                              filterIntegrations(integrations, categories, category, '')
                                .length,
                            ),
                          )
                          search.current?.focus()
                        }}
                      >
                        Clear search
                      </Button>
                    ) : null}
                    {requestHref ? (
                      <a
                        href={requestHref}
                        className={buttonVariants({
                          variant: 'ghost',
                          size: 'sm',
                        })}
                      >
                        Request an integration
                      </a>
                    ) : null}
                  </EmptyContent>
                </Empty>
              </li>
            </ul>
          </div>
          {requestHref && shown.length > 0 ? (
            <p className='text-muted-foreground text-center text-sm'>
              Missing a tool?{' '}
              <a
                href={requestHref}
                className='text-foreground focus-visible:ring-ring/50 rounded-(--control-radius-xs) font-medium underline-offset-4 hover:underline focus-visible:ring-3 focus-visible:outline-hidden'
              >
                Request an integration
              </a>
            </p>
          ) : null}
        </div>
      </div>
    </section>
  )
}

/** A tool's card: its mark, its name, which leads to its page, and what it does. */
function IntegrationCard({
  integration,
  heading: Heading,
}: {
  integration: DirectoryIntegration
  heading: 'h2' | 'h3' | 'h4'
}) {
  return (
    <Card className='flex-1'>
      <CardContent className='flex items-start gap-3'>
        <IntegrationTile logo={integration.logo} />
        <div className='flex min-w-0 flex-1 flex-col gap-1'>
          <div className='flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1'>
            <CardTitle render={<Heading />}>
              <CardLink href={integration.href}>
                <bdi>{integration.name}</bdi>
              </CardLink>
            </CardTitle>
            {integration.badge ? (
              <Badge variant='secondary'>{integration.badge}</Badge>
            ) : null}
          </div>
          <CardDescription>{integration.description}</CardDescription>
        </div>
      </CardContent>
    </Card>
  )
}

/**
 * What the empty grid says: that nothing matches what was typed, or, with
 * nothing typed, that the category has no tools yet.
 */
function emptyTitle(category: string | undefined, query: string): string {
  const typed = query.trim()
  if (typed === '') return category ? `No ${category} tools yet` : 'No tools yet'
  return category
    ? `No ${category} tool matches “${typed}”`
    : `No tool matches “${typed}”`
}

/**
 * The tools in `category` (or every one, for `all`) whose name, category or
 * line holds every word of `query`, ignoring case and accents, in the order
 * given.
 */
function filterIntegrations(
  integrations: readonly DirectoryIntegration[],
  categories: readonly IntegrationCategory[],
  category: string,
  query: string,
): DirectoryIntegration[] {
  const words = query.split(/\s+/).filter(Boolean)
  const labels = new Map(categories.map((entry) => [entry.value, entry.label]))
  return integrations.filter((integration) => {
    if (category !== ALL && integration.category !== category) return false
    const text = [
      integration.name,
      labels.get(integration.category) ?? '',
      integration.description,
    ].join(' ')
    return words.every((word) => matchRange(text, word) !== null)
  })
}

/** How many tools there are, in words: “1 integration”, “12 integrations”. */
function toolCount(count: number): string {
  return resultsLabel(count, ['integration', 'integrations'])
}

export { IntegrationsDirectory }
export { emptyTitle, filterIntegrations, toolCount }
export type { DirectoryIntegration, IntegrationCategory }
