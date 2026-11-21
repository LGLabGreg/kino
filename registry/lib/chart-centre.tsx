'use client'

import { AnimatedNumber } from '@/registry/components/kino/animated-number'
import type { ChartFormat } from '@/registry/lib/chart-root'
import { Swap } from '@/registry/lib/swap'
import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

/*
 * The words in the middle of a chart drawn round a centre, the Donut's and
 * the Radial chart's: a value that rolls to each new one, over a caption
 * that swaps in place and wraps, both sized to the hole they sit in, `--centre-hole`,
 * set by the layer around them.
 */

function ChartCentreText({
  value,
  caption,
  format,
  locale,
  className,
}: {
  value: number
  caption: ReactNode
  format?: ChartFormat
  locale: Intl.LocalesArgument
  /** The value's own classes, such as a colour for a warning. */
  className?: string
}) {
  // Sized to the hole, between the body text and the size of a page's figure.
  const size =
    'text-[clamp(1rem,calc(var(--centre-hole)*0.2),1.875rem)] font-semibold tracking-tight'
  return (
    // As wide as most of the hole, so the text never reaches the ring.
    <div className='flex w-[calc(var(--centre-hole)*0.78)] min-w-0 flex-col items-center gap-0.5 text-center'>
      {typeof format === 'function' ? (
        <span className={cn(size, 'tabular-nums', className)}>
          <Swap roll>{format(value)}</Swap>
        </span>
      ) : (
        <AnimatedNumber
          value={value}
          locale={locale}
          format={format}
          className={cn('max-w-full', size, className)}
        />
      )}
      {/*
       * The caption wraps rather than cutting, since nothing around it can show it whole, and
       * steps aside in a hole too small for a word.
       */}
      <div className='@container w-full'>
        <span className='text-muted-foreground hidden max-w-full justify-center text-center text-xs text-balance [overflow-wrap:anywhere] @min-[3.5rem]:flex'>
          <Swap block>{caption}</Swap>
        </span>
      </div>
    </div>
  )
}

export { ChartCentreText }
