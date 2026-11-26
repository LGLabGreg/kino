'use client'

import { Tabs, TabsPanel, TabsList, TabsTab } from '@/registry/components/kino/tabs'
import { useControllable } from '@/registry/lib/controllable'
import {
  type Feature,
  FeatureIcon,
  featuresColumnClassName,
  featuresSectionClassName,
  featurePictureClassName,
  FeatureStage,
} from '@/registry/lib/feature-parts'
import { HeroShot } from '@/registry/lib/hero-parts'
import { tintedRowTextClassName } from '@/registry/lib/highlight'
import { SectionHeading, type SectionHeadingLevel } from '@/registry/lib/section-heading'
import { type ComponentProps, type ReactNode, useId } from 'react'

import { cn } from '@/lib/utils'

/*
 * A landing page's features as a tour: a list of them on the start side and
 * one large picture beside it. Picking a feature opens its description in
 * the list and plays its picture. In a phone's column the picture follows
 * the list, in the order a keyboard reaches them.
 *
 *   <FeaturesTour
 *     title='Plan less. Ship more.'
 *     features={[{ value: 'cycles', title: 'Cycles that size themselves', description: '…', picture: <CyclePicture /> }]}
 *   />
 */

interface FeaturesTourProps extends Omit<
  ComponentProps<'section'>,
  'title' | 'children' | 'defaultValue' | 'onChange'
> {
  /** Each with its `picture`: the tour is the pictures. */
  features: (Feature & { picture: ReactNode })[]
  title: ReactNode
  eyebrow?: ReactNode
  description?: ReactNode
  actions?: ReactNode
  heading?: SectionHeadingLevel
  /** The feature shown, by its `value`. */
  value?: string
  /** The feature shown at first: the first, unless you give another. */
  defaultValue?: string
  onValueChange?: (value: string) => void
}

function FeaturesTour({
  features,
  title,
  eyebrow,
  description,
  actions,
  heading = 'h2',
  value: valueProp,
  defaultValue,
  onValueChange,
  className,
  ...props
}: FeaturesTourProps) {
  const titleId = useId()
  const [value, setValue] = useControllable(
    valueProp,
    defaultValue ?? features[0]?.value ?? '',
    onValueChange,
  )
  return (
    <section
      data-slot='features-tour'
      aria-labelledby={titleId}
      className={cn(featuresSectionClassName, className)}
      {...props}
    >
      <div className={featuresColumnClassName}>
        <SectionHeading
          id={titleId}
          eyebrow={eyebrow}
          title={title}
          description={description}
          heading={heading}
          align='start'
        >
          {actions ? (
            <div className='mt-3 flex flex-wrap items-center gap-3'>{actions}</div>
          ) : null}
        </SectionHeading>
        <Tabs
          value={value}
          onValueChange={(next) => setValue(String(next))}
          orientation='vertical'
          className='grid min-w-0 gap-6 @3xl/features:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] @3xl/features:items-start @3xl/features:gap-10'
        >
          <TabsList variant='rows' aria-labelledby={titleId} className='min-w-0'>
            {features.map((feature) => (
              <TourTab key={feature.value} feature={feature} />
            ))}
          </TabsList>
          {/* One frame for every feature: only the picture changes as the pick does. */}
          <div className='min-w-0'>
            {/* The stage's room, for the picture laid over it. */}
            <div className='@container/stage relative'>
              <HeroShot decorative>
                <FeatureStage className='aspect-[4/3]' />
              </HeroShot>
              {features.map((feature) => (
                <TabsPanel
                  key={feature.value}
                  value={feature.value}
                  // Over the frame's window, inside its bezel, with its ring inside it.
                  className='absolute inset-1.5 flex min-w-0 overflow-hidden rounded-(--surface-radius) focus-visible:ring-inset'
                >
                  <p className='sr-only'>{feature.description}</p>
                  <div
                    inert
                    aria-hidden
                    className={cn(featurePictureClassName, '@3xl/features:*:[zoom:1.1]')}
                  >
                    {feature.picture}
                  </div>
                </TabsPanel>
              ))}
            </div>
            {features.some((feature) => feature.action) ? (
              // Under the frame, the picked feature's link, in a row kept for it so nothing moves.
              <div className='flex min-h-9 items-center justify-end pt-3 text-sm'>
                {features.find((feature) => feature.value === value)?.action}
              </div>
            ) : null}
          </div>
        </Tabs>
      </div>
    </section>
  )
}

/**
 * A feature in the list: its icon and title, and under them, once picked,
 * its description, which opens on `layout` as the one before closes.
 */
function TourTab({ feature }: { feature: Feature }) {
  return (
    <TabsTab
      value={feature.value}
      className={cn(
        'group/tab flex w-full min-w-0 flex-col items-stretch rounded-(--surface-radius) px-(--surface-padding) py-3 text-start',
        'transition-[box-shadow] duration-(--motion-press-duration) ease-(--motion-press-fade-easing)',
        'focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-hidden',
        // Its muted words keep 4.5:1 on the picked row's tint.
        tintedRowTextClassName,
        // Forced colours drop the tint: the picked row takes the system's highlight as an outline.
        'forced-colors:data-[selected]:outline-2 forced-colors:data-[selected]:outline-[Highlight]',
      )}
    >
      <span className='flex min-w-0 items-center gap-3'>
        {feature.icon ? (
          <FeatureIcon className='group-data-[selected]/tab:bg-background transition-[background-color] duration-(--motion-press-duration) ease-(--motion-press-fade-easing)'>
            {feature.icon}
          </FeatureIcon>
        ) : null}
        <span className='text-muted-foreground group-hover/tab:text-foreground group-data-[selected]/tab:text-foreground min-w-0 flex-1 text-sm font-medium text-balance transition-colors duration-(--motion-press-duration) ease-(--motion-press-fade-easing)'>
          <bdi>{feature.title}</bdi>
        </span>
      </span>
      {/* The tab's name is its title: the panel says the description to a screen reader. */}
      <span
        aria-hidden
        className='grid grid-rows-[0fr] transition-[grid-template-rows] duration-(--motion-layout-duration) ease-(--motion-layout-easing) group-data-[selected]/tab:grid-rows-[1fr] motion-reduce:transition-none'
      >
        <span className='min-h-0 overflow-hidden'>
          <span
            className={cn(
              'text-muted-foreground block pt-1.5 text-sm text-pretty',
              feature.icon && 'ps-11',
              'opacity-0 transition-opacity duration-(--motion-exit-duration) ease-(--motion-exit-fade-easing) group-data-[selected]/tab:opacity-100 group-data-[selected]/tab:duration-(--motion-enter-duration) group-data-[selected]/tab:ease-(--motion-enter-fade-easing)',
            )}
          >
            <bdi>{feature.description}</bdi>
          </span>
        </span>
      </span>
    </TabsTab>
  )
}

export { FeaturesTour, type FeaturesTourProps }
