import { numberFormatter } from '@/registry/lib/number-format'

/*
 * Money, written one way everywhere: a pricing page, a seat's price, a cart
 * and a bill. An amount is held in the currency's smallest unit, as payment
 * providers send it, so sums never pick up a stray fraction of a cent.
 */

/** An amount in the currency's smallest unit (cents for USD, yen for JPY), as ISO 4217 counts them. */
type Money = { amount: number; currency: string }

/** How many digits the currency's smallest unit has: USD 2, JPY 0, KWD 3. */
function minorDigits(currency: string): number {
  return (
    numberFormatter('en-US', { style: 'currency', currency }).resolvedOptions()
      .maximumFractionDigits ?? 2
  )
}

/** The amount in whole units, for the Animated number: 1999 USD is 19.99. */
function majorOf(money: Money): number {
  return money.amount / 10 ** minorDigits(money.currency)
}

/**
 * The format for an amount in whole units. `when-needed` drops the cents of a
 * whole amount (`$10`, `$12.50`), as a pricing page or a seat's price reads;
 * `always` keeps them (`$10.00`), as a bill reads.
 */
function moneyFormat(
  currency: string,
  amount: number,
  cents: 'always' | 'when-needed',
): Intl.NumberFormatOptions {
  return cents === 'when-needed' && Number.isInteger(amount)
    ? {
        style: 'currency',
        currency,
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
      }
    : { style: 'currency', currency }
}

/** An amount in whole units as text, for prices kept in whole units: 12.5 USD is `$12.50`. */
function formatAmount(
  amount: number,
  currency: string,
  cents: 'always' | 'when-needed',
  locale?: Intl.LocalesArgument,
): string {
  return numberFormatter(locale, moneyFormat(currency, amount, cents)).format(amount)
}

/** Money as text: 1999 USD is `$19.99`. */
function formatMoney(
  money: Money,
  cents: 'always' | 'when-needed',
  locale?: Intl.LocalesArgument,
): string {
  return formatAmount(majorOf(money), money.currency, cents, locale)
}

export { formatAmount, formatMoney, majorOf, minorDigits, moneyFormat, type Money }
