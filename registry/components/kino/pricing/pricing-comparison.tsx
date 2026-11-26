'use client'

import { Badge } from '@/registry/components/kino/badge'
import {
  planStep,
  type PricingFeatureGroup,
  type PricingPlan,
} from '@/registry/components/kino/pricing/pricing-model'
import {
  FeatureValue,
  PlanAction,
  PlanPrice,
  usePricing,
} from '@/registry/components/kino/pricing/pricing-parts'
import {
  SegmentedControl,
  SegmentedControlItem,
} from '@/registry/components/kino/segmented-control'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/registry/components/kino/table'
import { Swap } from '@/registry/lib/swap'
import { type ReactNode, useState } from 'react'

import { cn } from '@/lib/utils'

/*
 * Every plan's features side by side, grouped, a column per plan under a
 * header that holds each plan's name, price and button and sticks to the
 * page as the rows scroll by. In a column narrower than a tablet's it shows
 * one plan at a time, picked in a switch that sticks instead, and switching
 * plans changes only the values that differ, in place, so the switch shows
 * what one plan has that the other hasn't. `--pricing-top` sets how
 * far from the top they stick, below a page's own sticky header.
 */

// A plan's own column shows from a tablet's width up; the one picked column below it.
const wideOnly = 'hidden @2xl:table-cell'
const narrowOnly = '@2xl:hidden'
const stickyTop = 'top-(--pricing-top,0px)'

/**
 * The plan you recommend, marked down its whole column as its card is: an
 * outline in the primary colour and a tint, from the header to the last row,
 * square where its cells meet and round at its two ends. Both fade in and
 * out as the mark moves to another plan. Muted text in it darkens, as in a
 * picked choice card, so it keeps 4.5:1 on the tint.
 */
const bandClassName =
  'relative after:pointer-events-none after:absolute after:inset-x-0 after:-inset-y-px after:border-x after:border-primary after:opacity-0 after:transition-opacity after:duration-(--motion-press-duration) after:ease-(--motion-press-fade-easing) data-band:after:opacity-100 [&_.text-muted-foreground]:transition-[color] [&_.text-muted-foreground]:duration-(--motion-press-duration) [&_.text-muted-foreground]:ease-(--motion-press-fade-easing) data-band:bg-primary/5 dark:data-band:bg-primary/10 data-band:[--muted-foreground:color-mix(in_oklab,var(--foreground)_70%,var(--background))] rounded-none! in-[thead>tr:first-child]:rounded-t-(--surface-radius)! in-[thead>tr:first-child]:after:rounded-t-(--surface-radius) in-[thead>tr:first-child]:after:border-t in-[tbody:last-of-type>tr:last-child]:rounded-b-(--surface-radius)! in-[tbody:last-of-type>tr:last-child]:after:rounded-b-(--surface-radius) in-[tbody:last-of-type>tr:last-child]:after:border-b'

function PricingComparison({
  groups,
  labelledBy,
  band,
  className,
}: {
  groups: PricingFeatureGroup[]
  /** The id of the heading that names the table. */
  labelledBy: string
  /** The plan whose column is marked, and whose button is in the primary colour. */
  band?: string
  className?: string
}) {
  const { plans, plan: picked, setPlan } = usePricing()
  const pickedPlan = plans.find((plan) => plan.value === picked) ?? plans[0]
  // The picked column's values slide the way the plans run, to a later plan or back.
  const [seen, setSeen] = useState<{ plan: string; slide: 1 | -1 }>({
    plan: pickedPlan.value,
    slide: 1,
  })
  if (seen.plan !== pickedPlan.value) {
    setSeen({
      plan: pickedPlan.value,
      slide: planStep(plans, seen.plan, pickedPlan.value),
    })
  }
  const slide = seen.slide

  /** The plan's own cell, from a tablet's width up, and the picked plan's, below it. */
  const cells = (
    cell: (plan: PricingPlan) => ReactNode,
    Cell: typeof TableCell | typeof TableHead = TableCell,
    cellClassName?: string,
  ) => (
    <>
      {plans.map((plan) => (
        <Cell
          key={plan.value}
          data-band={band === plan.value ? '' : undefined}
          className={cn(wideOnly, bandClassName, 'text-center', cellClassName)}
        >
          {cell(plan)}
        </Cell>
      ))}
      <Cell
        data-band={band === pickedPlan.value ? '' : undefined}
        className={cn(narrowOnly, bandClassName, 'text-center', cellClassName)}
      >
        {/* Its height glides to the new plan's, so the rows below follow. */}
        <Swap slide={slide} wait block>
          {cell(pickedPlan)}
        </Swap>
      </Cell>
    </>
  )

  return (
    <div className={cn('flex min-w-0 flex-col gap-1 bg-inherit', className)}>
      <div
        className={cn(
          narrowOnly,
          stickyTop,
          'sticky z-30 flex justify-center bg-inherit py-2',
        )}
      >
        <SegmentedControl
          aria-label='Plan to compare'
          value={pickedPlan.value}
          onValueChange={(next) => setPlan(next as string)}
        >
          {plans.map((plan) => (
            <SegmentedControlItem key={plan.value} value={plan.value}>
              {plan.name}
            </SegmentedControlItem>
          ))}
        </SegmentedControl>
      </div>
      <Table
        aria-labelledby={labelledBy}
        variant='lined'
        scroll={false}
        className='table-fixed'
      >
        <TableHeader className={cn(stickyTop, '@max-2xl:static')}>
          {/* Names, prices and buttons in rows of their own, so each lines up
              across the plans, and a column's header is only its plan's name. */}
          <TableRow>
            <TableHead rowSpan={3} className='border-b-border w-1/2 @2xl:w-auto'>
              <span className='sr-only'>Feature</span>
            </TableHead>
            {cells(
              (plan) => (
                <span className='flex flex-wrap items-center justify-center gap-x-2 gap-y-1'>
                  {plan.name}
                  {/* A space a flex row doesn't draw, so the header reads "Pro Most popular". */}
                  {plan.badge ? (
                    <>
                      {' '}
                      <Badge>{plan.badge}</Badge>
                    </>
                  ) : null}
                </span>
              ),
              TableHead,
              'text-foreground h-auto pt-4 pb-2 align-bottom text-base font-semibold whitespace-normal border-b-0',
            )}
          </TableRow>
          <TableRow>
            {cells(
              (plan) => (
                <PlanPrice plan={plan} size='sm' />
              ),
              TableCell,
              'h-auto py-1 align-top whitespace-normal',
            )}
          </TableRow>
          <TableRow>
            {cells(
              (plan) => (
                <PlanAction
                  plan={plan}
                  emphasis={plan.value === band}
                  size='sm'
                  className='max-w-48'
                />
              ),
              TableCell,
              'border-b-border h-auto border-b pt-3 pb-4 align-top',
            )}
          </TableRow>
        </TableHeader>
        {groups.map((group) => (
          <TableBody key={group.name}>
            <TableRow>
              <TableHead
                scope='rowgroup'
                className='text-foreground h-auto pt-8 pb-3 align-bottom text-sm font-semibold whitespace-normal'
              >
                {group.name}
              </TableHead>
              {/* Empty, so a marked column runs on through the group's title. */}
              {cells(() => null)}
            </TableRow>
            {group.features.map((feature) => (
              <TableRow key={feature.name}>
                <TableHead scope='row' className='font-normal whitespace-normal'>
                  {feature.name}
                </TableHead>
                {cells((plan) => (
                  <FeatureValue value={feature.values[plan.value]} />
                ))}
              </TableRow>
            ))}
          </TableBody>
        ))}
      </Table>
    </div>
  )
}

export { PricingComparison }
