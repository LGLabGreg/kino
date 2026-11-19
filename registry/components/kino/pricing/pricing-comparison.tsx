'use client'

import { Badge } from '@/registry/components/kino/badge'
import {
  planStep,
  type PricingFeatureGroup,
  type PricingPlan,
} from '@/registry/components/kino/pricing/pricing-model'
import {
  FeatureValue,
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
 * Every plan's features side by side, grouped, a column per plan. In a
 * column narrower than a tablet's it shows one plan at a time, picked above
 * it, and switching plans changes only the values that differ, in place, so
 * the switch shows what one plan has that the other hasn't.
 */

// A plan's own column shows from a tablet's width up; the one picked column below it.
const wideOnly = 'hidden @2xl:table-cell'
const narrowOnly = '@2xl:hidden'

/**
 * The tint down the column of the plan it marks, its colour fading as it
 * moves to another. One band from the header to the last row: square where
 * its cells meet, over the rows' own rounding, and round at its two ends.
 * Muted text in it darkens, as in a picked choice card, so it keeps 4.5:1
 * on the tint, and fades with it.
 */
const bandClassName =
  '[&_.text-muted-foreground]:transition-[color] [&_.text-muted-foreground]:duration-(--motion-press-duration) [&_.text-muted-foreground]:ease-(--motion-press-fade-easing) data-band:bg-primary/5 dark:data-band:bg-primary/10 data-band:[--muted-foreground:color-mix(in_oklab,var(--foreground)_70%,var(--background))] data-band:rounded-none! in-[thead>tr:first-child]:data-band:rounded-t-(--surface-radius)! in-[tbody:last-of-type>tr:last-child]:data-band:rounded-b-(--surface-radius)!'

function PricingComparison({
  groups,
  labelledBy,
  band,
  className,
}: {
  groups: PricingFeatureGroup[]
  /** The id of the heading that names the table. */
  labelledBy: string
  /** The plan whose column is tinted. */
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
    cell: (plan: PricingPlan, narrow: boolean) => ReactNode,
    Cell: typeof TableCell | typeof TableHead = TableCell,
    cellClassName?: string,
  ) => (
    <>
      {plans.map((plan) => (
        <Cell
          key={plan.value}
          data-band={band === plan.value ? '' : undefined}
          className={cn(wideOnly, bandClassName, cellClassName)}
        >
          {cell(plan, false)}
        </Cell>
      ))}
      <Cell
        data-band={band === pickedPlan.value ? '' : undefined}
        className={cn(narrowOnly, bandClassName, cellClassName)}
      >
        {cell(pickedPlan, true)}
      </Cell>
    </>
  )

  return (
    <div className={cn('flex min-w-0 flex-col gap-3', className)}>
      <SegmentedControl
        aria-label='Plan to compare'
        value={pickedPlan.value}
        onValueChange={(next) => setPlan(next as string)}
        className={cn(narrowOnly, 'self-center')}
      >
        {plans.map((plan) => (
          <SegmentedControlItem key={plan.value} value={plan.value}>
            {plan.name}
          </SegmentedControlItem>
        ))}
      </SegmentedControl>
      <Table aria-labelledby={labelledBy} className='table-fixed'>
        <TableHeader>
          <TableRow>
            <TableHead className='w-1/2 @2xl:w-auto'>
              <span className='sr-only'>Feature</span>
            </TableHead>
            {cells(
              (plan, narrow) =>
                narrow ? (
                  <Swap slide={slide} wait align='start'>
                    {plan.name}
                  </Swap>
                ) : (
                  <PlanName plan={plan} />
                ),
              TableHead,
              'text-foreground align-bottom text-sm font-semibold whitespace-normal',
            )}
          </TableRow>
        </TableHeader>
        {groups.map((group) => (
          <TableBody key={group.name}>
            <TableRow>
              <TableHead
                scope='rowgroup'
                className='text-foreground h-(--control-height) pt-4 text-xs font-semibold whitespace-normal'
              >
                {group.name}
              </TableHead>
              {/* Empty, so a tinted column runs on through the group's title. */}
              {cells(() => null)}
            </TableRow>
            {group.features.map((feature) => (
              <TableRow key={feature.name}>
                <TableHead scope='row' className='font-normal whitespace-normal'>
                  {feature.name}
                </TableHead>
                {cells((plan, narrow) =>
                  narrow ? (
                    <Swap slide={slide} wait align='start'>
                      <FeatureValue value={feature.values[plan.value]} />
                    </Swap>
                  ) : (
                    <FeatureValue value={feature.values[plan.value]} />
                  ),
                )}
              </TableRow>
            ))}
          </TableBody>
        ))}
      </Table>
    </div>
  )
}

/** A plan's name in its column's header, with its badge. */
function PlanName({ plan }: { plan: PricingPlan }) {
  return (
    <span className='flex flex-wrap items-center gap-x-2 gap-y-1 font-semibold'>
      {plan.name}
      {plan.badge ? <Badge>{plan.badge}</Badge> : null}
    </span>
  )
}

export { PricingComparison }
