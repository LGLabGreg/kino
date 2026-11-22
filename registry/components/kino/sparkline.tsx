'use client'

import { Area, AreaChart } from '@/registry/components/kino/area-chart'
import { Bar, BarChart } from '@/registry/components/kino/bar-chart'
import { Line, LineChart } from '@/registry/components/kino/line-chart'
import type { CategoryChartProps } from '@/registry/lib/chart-core'
import { type ChartDatum, numberOf, rangeOf } from '@/registry/lib/chart-math'
import type { DomainEnd } from '@/registry/lib/chart-scale'
import type { LineCurve } from '@/registry/lib/line-path'
import type { CSSProperties } from 'react'

import { cn } from '@/lib/utils'

/*
 * The Sparkline: a trend small enough to sit beside a value, in a table row
 * or a stat card. It is the Line, Area or Bar chart with no axes, so it
 * looks, moves and reads as they do: the point under the pointer or the
 * keys stays bright while the rest steps back, a new range moves every point
 * from where it is, and the plot is a slider a keyboard steps through. A
 * line fits its range to the data, so its rise and fall fill the room; an
 * area and bars start at zero, since their size is their value.
 */

type SparklineVariant = 'line' | 'area' | 'bar'

interface SparklineProps extends Omit<
  CategoryChartProps,
  | 'tickCount'
  | 'tickValues'
  | 'allowDecimals'
  | 'patterns'
  | 'hiddenSeries'
  | 'defaultHiddenSeries'
  | 'onHiddenSeriesChange'
> {
  /** Draws each series as a line, a line with the area under it filled, or bars. */
  variant?: SparklineVariant
  /** How a line runs between its points: a smooth curve that never overshoots them, straight, or in steps. */
  curve?: LineCurve
  /** Marks the last value of each line with a dot, where the value beside it reads. */
  endDot?: boolean
  /**
   * Series drawn as a dashed line with no fill, behind the rest: the period
   * before, to compare with. Bars draw no dashes, so a bar sparkline draws them as bars.
   */
  dashed?: readonly string[]
  /**
   * The key of the first category whose values are still coming in, such as
   * the minute now running: a line is dashed from the one before it on, and
   * the tooltip says so. Areas and bars draw it as the rest.
   */
  forecastFrom?: string
  /**
   * Fits an area's range to its data, as a line's is, with room below, in
   * place of starting at zero: for a trend whose shape matters more than its
   * size, such as a KPI's, whose number says the size. Values that never go
   * below zero are never grounded below it. Lines and bars keep their range.
   */
  fit?: boolean
  /**
   * How it arrives the first time it comes into view: drawn along from the
   * reading start, bars one after another, or simply there, the default,
   * since a page that loads doesn't animate into place.
   */
  entrance?: 'draw' | 'none'
}

/** The words a sparkline says in its own small room, in place of the charts' longer ones. */
const sparklineMessages = {
  empty: 'No data',
  error: 'Couldn’t load',
}

/**
 * The range a sparkline's values run over: the ends `given`, and each end
 * left `'auto'` where the data reaches, never rounded out to a tick. A
 * line's runs from its lowest value to its highest, so its shape fills the
 * room, and an area's or bars' from zero, since their size is their value.
 * A `fit` area runs from below its lowest value, by half its rise and fall,
 * so its shape fills the room above a band of fill.
 */
function sparklineDomain(
  data: readonly ChartDatum[],
  keys: readonly string[],
  variant: SparklineVariant,
  given: readonly [DomainEnd, DomainEnd] = ['auto', 'auto'],
  fit = false,
): readonly [DomainEnd, DomainEnd] {
  const fits = fit && variant === 'area'
  const [low, high] = fittedDomain(data, keys, fits ? 'line' : variant)
  // The floor comes from the data's own lowest value, before a flat line's room is added.
  const [floor] = fits ? fittedDomain(data, keys, 'area') : [low]
  const lowest =
    typeof floor === 'number'
      ? floor
      : typeof low === 'number' && typeof high === 'number'
        ? (low + high) / 2
        : low
  const ground =
    fits && typeof low === 'number' && typeof high === 'number'
      ? Math.max(
          typeof lowest === 'number' && lowest >= 0 ? 0 : -Infinity,
          low - (high - low) / 2,
        )
      : low
  return [given[0] === 'auto' ? ground : given[0], given[1] === 'auto' ? high : given[1]]
}

/** Where the data reaches: a line with one value sits in the middle; with no values, it is left to fit. */
function fittedDomain(
  data: readonly ChartDatum[],
  keys: readonly string[],
  variant: SparklineVariant,
): readonly [DomainEnd, DomainEnd] {
  let low = variant === 'line' ? Infinity : 0
  let high = variant === 'line' ? -Infinity : 0
  for (const row of data) {
    for (const key of keys) {
      const values = rangeOf(row[key]) ?? [numberOf(row[key])]
      for (const value of values) {
        if (value === null) continue
        low = Math.min(low, value)
        high = Math.max(high, value)
      }
    }
  }
  if (!Number.isFinite(low)) return ['auto', 'auto']
  if (low === high) {
    if (variant !== 'line') return ['auto', 'auto']
    const room = Math.abs(low) / 10 || 1
    return [low - room, high + room]
  }
  return [low, high]
}

/** The charts' own variables, read from the sparkline's, so one name tunes every variant. */
const sparklineVariables = {
  line: {
    '--line-chart-width': 'var(--sparkline-width, 1.5px)',
    '--line-chart-dim': 'var(--sparkline-dim, 0.3)',
    '--line-chart-window-fade': 'var(--sparkline-window-fade, 0.75rem)',
  },
  area: {
    '--area-chart-width': 'var(--sparkline-width, 1.5px)',
    '--area-chart-dim': 'var(--sparkline-dim, 0.3)',
    '--area-chart-window-fade': 'var(--sparkline-window-fade, 0.75rem)',
    '--area-chart-fill-top': 'var(--sparkline-fill-top, 0.32)',
    '--area-chart-fill-bottom': 'var(--sparkline-fill-bottom, 0.04)',
  },
  bar: {
    '--bar-chart-dim': 'var(--sparkline-dim, 0.3)',
  },
} as const

/**
 * A sparkline: one or more series drawn small, with no axes, in a
 * `<figure>` named by its `label`. A chart's `ChartTooltip` goes inside it
 * as it goes inside a chart.
 */
function Sparkline({
  variant = 'line',
  curve = 'monotone',
  endDot = false,
  dashed = [],
  forecastFrom,
  fit = false,
  entrance = 'none',
  domain,
  messages,
  className,
  style,
  children,
  ...props
}: SparklineProps) {
  const keys = Object.keys(props.config)
  const shared = {
    'data-slot': 'sparkline',
    ...props,
    domain: sparklineDomain(props.data, keys, variant, domain, fit),
    messages: { ...sparklineMessages, ...messages },
    'data-variant': variant,
    // Every variant keeps room beside the plot for an end dot, so sparklines in a column line
    // up, and the status's words and button sit in one row, in the room a sparkline has.
    className: cn(
      'h-10 grid-cols-[minmax(0.375rem,auto)_minmax(0,1fr)_minmax(0.375rem,auto)] py-1 [&_[data-slot=chart-status]]:flex-row [&_[data-slot=chart-status]]:gap-1.5 [&_[data-slot=chart-status]]:p-0 [&_[data-slot=chart-status]_p]:text-xs',
      className,
    ),
    style: { ...sparklineVariables[variant], ...style } as CSSProperties,
  }
  if (variant === 'bar') {
    return (
      <BarChart {...shared} entrance={entrance === 'draw' ? 'cascade' : 'none'}>
        {keys.map((key) => (
          <Bar key={key} dataKey={key} />
        ))}
        {children}
      </BarChart>
    )
  }
  const dots = endDot ? 'last' : false
  const solid = keys.filter((key) => !dashed.includes(key))
  // Drawn first, so the series compared with them sit over them.
  const behind = keys
    .filter((key) => dashed.includes(key))
    .map((key) => <Line key={key} dataKey={key} curve={curve} dashed />)
  if (variant === 'area') {
    // Its dashed series are lines among the areas.
    const config = Object.fromEntries(
      keys.map((key) => [
        key,
        dashed.includes(key)
          ? { ...props.config[key], mark: 'line' as const }
          : props.config[key],
      ]),
    )
    return (
      <AreaChart {...shared} config={config} entrance={entrance}>
        {behind}
        {solid.map((key) => (
          <Area key={key} dataKey={key} curve={curve} dots={dots} />
        ))}
        {children}
      </AreaChart>
    )
  }
  return (
    <LineChart {...shared} zero={false} entrance={entrance}>
      {behind}
      {solid.map((key) => (
        <Line
          key={key}
          dataKey={key}
          curve={curve}
          dots={dots}
          forecastFrom={forecastFrom}
        />
      ))}
      {children}
    </LineChart>
  )
}

export { Sparkline, type SparklineProps, type SparklineVariant, sparklineDomain }
