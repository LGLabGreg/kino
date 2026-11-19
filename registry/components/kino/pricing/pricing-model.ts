/*
 * The Pricing block's plans and the sums it shows from them: what a year
 * comes to, and how much paying for the year saves. Prices are what a month
 * costs, as every pricing page shows them, so a yearly price is the month's
 * share of the year's bill.
 */

type PricingBilling = 'monthly' | 'yearly'

interface PricingPlan {
  /** Names the plan in the comparison's values, the pick and `onChoose`. */
  value: string
  name: string
  /** Who it's for, in a line. */
  description: string
  /**
   * What a month costs, billed monthly and billed yearly, in the currency's
   * units: `{ monthly: 10, yearly: 8 }`. A free plan costs 0 on both.
   */
  price: { monthly: number; yearly: number }
  /** What one price buys, when it isn't the whole plan: `member`, for a price per member. */
  per?: string
  /** Under the price, in place of how it's billed: `Free for up to 3 members`. */
  note?: string
  /** The line that leads its features: `Everything in Free, plus`. */
  featuresTitle?: string
  /** What it's for, a line each, the ones that set it apart first. */
  features: string[]
  /** Its button: what it says, and where it goes. */
  action: { label: string; href: string }
  /** Marks the plan you recommend, with this label: `Most popular`. */
  badge?: string
}

/** A row of the comparison, by plan: included, not, or a value such as `10 GB`. */
interface PricingFeature {
  name: string
  values: Record<string, boolean | string>
}

interface PricingFeatureGroup {
  name: string
  features: PricingFeature[]
}

/** Cents survive the sums: 12 × 9.99 is 119.88, never 119.88000000000001. */
const round = (amount: number) => Math.round(amount * 100) / 100

/** What a year costs, paid yearly: twelve of its months. */
function yearlyTotal(plan: PricingPlan) {
  return round(plan.price.yearly * 12)
}

/**
 * How much the yearly price takes off the monthly one, as a whole percent,
 * rounded down so it never promises more than it gives: the most any paid
 * plan saves, and whether every paid plan saves that much.
 */
function savingPercent(plans: PricingPlan[]): { most: number; same: boolean } {
  const percents = plans.flatMap(({ price }) =>
    price.monthly > 0
      ? // Nudged up, so 20% worked out as 19.999… still reads as 20.
        [Math.floor(((price.monthly - price.yearly) / price.monthly) * 100 + 1e-9)]
      : [],
  )
  const most = Math.max(0, ...percents)
  return { most, same: percents.every((percent) => percent === most) }
}

/** Which way the plans run from `from` to `to`: 1 to a later plan, -1 to an earlier one. */
function planStep(plans: PricingPlan[], from: string, to: string): 1 | -1 {
  const index = (value: string) => plans.findIndex((plan) => plan.value === value)
  return index(to) < index(from) ? -1 : 1
}

/** Money in whole units when it has no cents, so `$10` and `$12.50` read as they would on a bill. */
function moneyFormat(currency: string, amount: number): Intl.NumberFormatOptions {
  const digits = Number.isInteger(amount) ? 0 : 2
  return {
    style: 'currency',
    currency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }
}

export {
  moneyFormat,
  planStep,
  savingPercent,
  yearlyTotal,
  type PricingBilling,
  type PricingFeature,
  type PricingFeatureGroup,
  type PricingPlan,
}
