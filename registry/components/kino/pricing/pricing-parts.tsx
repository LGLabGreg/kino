'use client'

import { AnimatedNumber } from '@/registry/components/kino/animated-number'
import { Badge } from '@/registry/components/kino/badge'
import { Button, buttonVariants } from '@/registry/components/kino/button'
import {
  type PricingBilling,
  type PricingPlan,
  moneyFormat,
  savingPercent,
  yearlyTotal,
} from '@/registry/components/kino/pricing/pricing-model'
import {
  SegmentedControl,
  SegmentedControlItem,
} from '@/registry/components/kino/segmented-control'
import { IconPlaceholder } from '@/registry/icons/icon-placeholder'
import { numberFormatter } from '@/registry/lib/number-format'
import { Swap } from '@/registry/lib/swap'
import { createContext, type MouseEvent, use } from 'react'

import { cn } from '@/lib/utils'

/*
 * What every arrangement of the Pricing block shares: the billing switch,
 * a plan's price that rolls to its new amount, its button, its features,
 * and a value in the comparison.
 */

type PricingHeading = 'h1' | 'h2' | 'h3'

interface PricingChoice {
  plan: string
  billing: PricingBilling
}

interface PricingContextValue {
  plans: PricingPlan[]
  billing: PricingBilling
  setBilling: (billing: PricingBilling) => void
  /** The plan the comparison shows in a column as narrow as a phone. */
  plan: string
  setPlan: (plan: string) => void
  /** The plan the person is on, if they are signed in. */
  current?: string
  locale: Intl.LocalesArgument
  currency: string
  /** The level of the block's title; plans and the comparison take the next. */
  heading: PricingHeading
  onChoose?: (choice: PricingChoice, event: MouseEvent<HTMLElement>) => void
}

const PricingContext = createContext<PricingContextValue | null>(null)

function usePricing() {
  const context = use(PricingContext)
  if (!context) throw new Error('A Pricing part must be inside Pricing.')
  return context
}

/** The heading a level below each: a plan's name under the block's title. */
const HEADING_BELOW = { h1: 'h2', h2: 'h3', h3: 'h4' } as const

/** Monthly or yearly, with what the year saves on the yearly side. */
function PricingBillingSwitch({ className }: { className?: string }) {
  const { plans, billing, setBilling } = usePricing()
  const { most, same } = savingPercent(plans)
  return (
    <SegmentedControl
      aria-label='Billing period'
      value={billing}
      onValueChange={(next) => setBilling(next as PricingBilling)}
      className={className}
    >
      <SegmentedControlItem value='monthly'>Monthly</SegmentedControlItem>
      <SegmentedControlItem value='yearly'>
        Yearly
        {most > 0 ? (
          <Badge variant='secondary'>
            {/* Shorter in a column as narrow as a small phone, so the switch fits it; read in full. */}
            <span className='@max-xs:sr-only'>
              {same ? `Save ${most}%` : `Save up to ${most}%`}
            </span>
            <span aria-hidden className='@xs:hidden'>
              {same ? `−${most}%` : `Up to −${most}%`}
            </span>
          </Badge>
        ) : null}
      </SegmentedControlItem>
    </SegmentedControl>
  )
}

/** What the plan costs a month, rolling to the new amount when the billing changes. */
function PlanPrice({ plan, className }: { plan: PricingPlan; className?: string }) {
  const { billing, locale, currency } = usePricing()
  const amount = plan.price[billing]
  const free = plan.price.monthly === 0
  const total = yearlyTotal(plan)
  const money = numberFormatter(locale, moneyFormat(currency, total)).format(total)
  // As text, so the line rolls when it changes.
  const billed =
    plan.note ??
    (free
      ? 'Free forever'
      : billing === 'monthly'
        ? 'Billed monthly'
        : plan.per
          ? `${money} per ${plan.per}, billed yearly`
          : `${money} billed yearly`)
  return (
    <div className={cn('flex min-w-0 flex-col gap-1', className)}>
      <p className='flex min-w-0 flex-wrap items-baseline gap-x-1.5'>
        <AnimatedNumber
          value={amount}
          locale={locale}
          format={moneyFormat(currency, amount)}
          className='text-foreground text-4xl font-semibold tracking-tight'
        />
        {free ? null : (
          <span className='text-muted-foreground text-sm'>
            {plan.per ? `per ${plan.per} a month` : 'a month'}
          </span>
        )}
      </p>
      <p className='text-muted-foreground flex min-w-0 text-sm'>
        {/* Its words keep their own direction, so `$96 per member` reads the same way round right to left. */}
        <Swap roll align='start'>
          <bdi>{billed}</bdi>
        </Swap>
      </p>
    </div>
  )
}

/** The plan's button: its link, or the plan the person is already on. */
function PlanAction({
  plan,
  emphasis,
  className,
}: {
  plan: PricingPlan
  /** The plan you recommend, in the primary colour; the rest are outlined. */
  emphasis: boolean
  className?: string
}) {
  const { billing, current, onChoose } = usePricing()
  if (current === plan.value) {
    return (
      <Button variant='outline' disabled className={cn('w-full', className)}>
        Current plan
      </Button>
    )
  }
  return (
    // A link in a Button's look, as it goes to another page.
    <a
      href={plan.action.href}
      onClick={(event) => onChoose?.({ plan: plan.value, billing }, event)}
      className={cn(
        buttonVariants({ variant: emphasis ? 'default' : 'outline' }),
        'w-full',
        className,
      )}
    >
      {plan.action.label}
    </a>
  )
}

const CheckMark = (props: { className?: string }) => (
  <IconPlaceholder
    lucide='CheckIcon'
    tabler='IconCheck'
    hugeicons='Tick02Icon'
    phosphor='CheckIcon'
    remixicon='RiCheckLine'
    aria-hidden
    {...props}
  />
)

/** What the plan is for, a line each, under the line that leads them. */
function PlanFeatures({ plan, className }: { plan: PricingPlan; className?: string }) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-3 text-sm', className)}>
      {plan.featuresTitle ? <p className='font-medium'>{plan.featuresTitle}</p> : null}
      <ul className='flex flex-col gap-2'>
        {plan.features.map((feature) => (
          <li key={feature} className='flex min-w-0 gap-2'>
            <CheckMark className='text-muted-foreground mt-0.5 size-4 shrink-0' />
            <span className='min-w-0 text-pretty'>
              <bdi>{feature}</bdi>
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** A value in the comparison: included and not as a mark with words for screen readers, or the value. */
function FeatureValue({ value }: { value: boolean | string | undefined }) {
  // Its own direction, so `250 MB` reads the same way round in a page that runs right to left.
  if (typeof value === 'string')
    return (
      <span dir='auto' className='tabular-nums'>
        {value}
      </span>
    )
  return value ? (
    <span className='inline-flex'>
      <CheckMark className='size-4' />
      <span className='sr-only'>Included</span>
    </span>
  ) : (
    <span className='text-muted-foreground inline-flex'>
      <IconPlaceholder
        lucide='MinusIcon'
        tabler='IconMinus'
        hugeicons='MinusSignIcon'
        phosphor='MinusIcon'
        remixicon='RiSubtractLine'
        aria-hidden
        className='size-4'
      />
      <span className='sr-only'>Not included</span>
    </span>
  )
}

export {
  FeatureValue,
  HEADING_BELOW,
  PlanAction,
  PlanFeatures,
  PlanPrice,
  PricingBillingSwitch,
  PricingContext,
  usePricing,
  type PricingChoice,
  type PricingContextValue,
  type PricingHeading,
}
