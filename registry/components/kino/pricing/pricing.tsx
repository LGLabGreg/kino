'use client'

import { Badge } from '@/registry/components/kino/badge'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/registry/components/kino/card'
import { PricingComparison } from '@/registry/components/kino/pricing/pricing-comparison'
import type {
  PricingBilling,
  PricingFeatureGroup,
  PricingPlan,
} from '@/registry/components/kino/pricing/pricing-model'
import {
  PlanAction,
  PlanFeatures,
  PlanPrice,
  type PricingChoice,
  PricingBillingSwitch,
  PricingContext,
  type PricingContextValue,
  type PricingHeading,
  usePricing,
} from '@/registry/components/kino/pricing/pricing-parts'
import { useAnnouncer } from '@/registry/lib/announce'
import { useControllable } from '@/registry/lib/controllable'
import { HEADING_BELOW, SectionHeading } from '@/registry/lib/section-heading'
import { type ComponentProps, type MouseEvent, type ReactNode, useId } from 'react'

import { cn } from '@/lib/utils'

/*
 * A pricing page: a card per plan under a monthly and yearly switch whose
 * prices roll to the new amount, the plan you recommend outlined in the
 * primary colour, what each plan includes, and every feature compared
 * below, one plan at a time in a column as narrow as a phone.
 *
 *   <Pricing plans={plans} features={features} onChoose={startCheckout} />
 */

interface PricingProps extends Omit<ComponentProps<'section'>, 'title' | 'children'> {
  plans: PricingPlan[]
  /** The comparison under the plans, in groups; leave it out for the plans alone. */
  features?: PricingFeatureGroup[]
  billing?: PricingBilling
  defaultBilling?: PricingBilling
  onBillingChange?: (billing: PricingBilling) => void
  /** The plan the comparison shows in a column as narrow as a phone. */
  plan?: string
  /** The plan picked at first: the one with a `badge`, unless you give another. */
  defaultPlan?: string
  onPlanChange?: (plan: string) => void
  /** The plan the person is on, when they are signed in: its button says so. */
  current?: string
  /** The locale prices are written in. Give one, so the page's server and browser agree. */
  locale?: Intl.LocalesArgument
  /** The prices' ISO 4217 currency code. */
  currency?: string
  title?: ReactNode
  description?: ReactNode
  /** The title's level: the page's `h1` on a pricing page, lower inside another page. */
  heading?: PricingHeading
  /** The comparison's heading. */
  comparisonTitle?: string
  /** Under the plans: an offer for larger teams, or what the prices include. */
  footer?: ReactNode
  /** Runs when a plan's button is pressed, before its link is followed. */
  onChoose?: (choice: PricingChoice, event: MouseEvent<HTMLElement>) => void
}

function Pricing({
  plans,
  features,
  billing: billingProp,
  defaultBilling = 'yearly',
  onBillingChange,
  plan: planProp,
  defaultPlan,
  onPlanChange,
  current,
  locale = 'en-US',
  currency = 'USD',
  title = 'Pricing',
  description,
  heading = 'h2',
  comparisonTitle = 'Compare plans',
  footer,
  onChoose,
  className,
  ...props
}: PricingProps) {
  const recommended = plans.find((plan) => plan.badge)?.value
  const [billing, setBilling] = useControllable(
    billingProp,
    defaultBilling,
    onBillingChange,
  )
  const [plan, setPlan] = useControllable(
    planProp,
    defaultPlan ?? recommended ?? plans[0]?.value ?? '',
    onPlanChange,
  )
  const { announce, region } = useAnnouncer()
  const titleId = useId()
  const featuresId = useId()
  const Subheading = HEADING_BELOW[heading]

  const context: PricingContextValue = {
    plans,
    billing,
    setBilling: (next) => {
      setBilling(next)
      // The prices change out of sight of a screen reader, which hears only the switch.
      announce(`Prices are now billed ${next}`)
    },
    plan,
    setPlan,
    current,
    locale,
    currency,
    heading,
    onChoose,
  }

  return (
    <PricingContext value={context}>
      <section
        data-slot='pricing'
        aria-labelledby={titleId}
        className={cn(
          '@container flex min-h-full w-full min-w-0 flex-col gap-10 bg-background px-(--surface-padding) py-12 @3xl:py-16',
          className,
        )}
        {...props}
      >
        <SectionHeading
          id={titleId}
          title={title}
          description={description}
          heading={heading}
        >
          <PricingBillingSwitch className='mt-3' />
        </SectionHeading>

        <PlanCards recommended={recommended} heading={Subheading} />

        {footer}

        {features ? (
          <div className='flex min-w-0 flex-col gap-4 bg-inherit'>
            <Subheading
              id={featuresId}
              className='text-xl font-semibold tracking-tight @2xl:text-center'
            >
              {comparisonTitle}
            </Subheading>
            <PricingComparison
              groups={features}
              labelledBy={featuresId}
              band={recommended}
            />
          </div>
        ) : null}
        {region}
      </section>
    </PricingContext>
  )
}

/** A card per plan, their rows lined up across the cards. */
function PlanCards({
  recommended,
  heading,
}: {
  recommended?: string
  heading: 'h2' | 'h3' | 'h4'
}) {
  const { plans } = usePricing()
  const Heading = heading
  return (
    <ul
      data-slot='pricing-plans'
      className='grid min-w-0 gap-4 @2xl:auto-cols-fr @2xl:grid-flow-col @2xl:grid-rows-[auto_auto_auto_1fr]'
    >
      {plans.map((plan) => {
        const emphasis = plan.value === recommended
        return (
          <Card
            key={plan.value}
            render={<li />}
            data-recommended={emphasis ? '' : undefined}
            className={cn(
              // Every card's name, price, button and features start on one line.
              '@2xl:row-span-4 @2xl:grid @2xl:grid-rows-subgrid',
              emphasis &&
                'border-primary ring-primary ring-1 forced-colors:outline-2 forced-colors:outline-[Highlight]',
            )}
          >
            <CardHeader>
              <CardTitle render={<Heading />}>{plan.name}</CardTitle>
              {plan.badge ? (
                <CardAction>
                  <Badge>{plan.badge}</Badge>
                </CardAction>
              ) : null}
              <CardDescription>
                {/* Its own direction, so its words read the same way round right to left. */}
                <bdi>{plan.description}</bdi>
              </CardDescription>
            </CardHeader>
            <CardContent>
              <PlanPrice plan={plan} />
            </CardContent>
            <CardContent>
              <PlanAction plan={plan} emphasis={emphasis} />
            </CardContent>
            <CardContent className='border-t pt-(--surface-padding)'>
              <PlanFeatures plan={plan} />
            </CardContent>
          </Card>
        )
      })}
    </ul>
  )
}

export { Pricing, type PricingProps }
