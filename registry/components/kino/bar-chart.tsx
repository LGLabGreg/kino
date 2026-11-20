'use client'

import {
  barClip,
  BarLabel,
  type BarLabelPosition,
  type BarPlace,
  BarPlaceholder,
  BarShape,
  labelFits,
  labelPlace,
  missingMark,
  outsideRoom,
  PLACEHOLDER_COUNT,
  placeholderClip,
  placeholderValues,
  slotBand,
  trackClip,
} from '@/registry/lib/chart-bars'
import {
  CategoryChartFrame,
  type CategoryChartProps,
  type ChartCategory,
  type ChartContextValue,
  type ChartFormat,
  type EntrancePhase,
  figureProps,
  formatterOf,
  patternImage,
  plotLayerClassName,
  seriesColor,
  useCategoryChart,
  useChart,
  useChartActive,
} from '@/registry/lib/chart-core'
import {
  type BandGaps,
  cascadeAt,
  categoryBand,
  type ChartDatum,
  type ChartOrientation,
  type ChartStack,
  fractionOf,
  numberOf,
  plotPoint,
  rangeOf,
  reachOf,
  hiddenSpans,
  seriesSpans,
  type Span,
  spanExtent,
  stacksOf,
} from '@/registry/lib/chart-math'
import { type ComponentProps, createContext, use, useLayoutEffect } from 'react'

import { cn } from '@/lib/utils'

/*
 * The Bar chart: values across categories, side by side, stacked, or as
 * shares, upright or lying. Each bar is the clip of a layer as large as the
 * plot, so a new value, a new range, a series hidden or the categories
 * sorted is one CSS transition of each bar, which turns back from wherever
 * it is. The category under the pointer stays bright while the rest step
 * back, and the tooltip sits on the end of its bars.
 */

interface BarChartProps extends CategoryChartProps {
  /** Upright bars over the categories, or bars lying along them. */
  orientation?: ChartOrientation
  /** How each category's series combine: side by side, stacked, or stacked as shares of their total. */
  stack?: ChartStack
  /**
   * How the bars arrive the first time the chart comes into view: all
   * rising together, rising one after another, or simply there, the
   * default, since a page that loads doesn't animate into place.
   */
  entrance?: 'rise' | 'cascade' | 'none'
  /** Where a cascade starts: the reading start, the end, the centre, or the largest value. */
  cascadeFrom?: 'start' | 'end' | 'centre' | 'value'
  /** The space between two categories, as a share of one category's step. */
  categoryGap?: number
  /** The space between bars side by side, as a share of one bar's slot. */
  barGap?: number
  /**
   * What each category holds, for a screen reader and the data table, in
   * place of each series' value: a day's state in a strip of days, whose
   * series are only its colours. `name` heads the data table's column.
   */
  describe?: { name: string; text: (datum: ChartDatum) => string }
}

interface BarContextValue {
  spans: Record<string, (Span | null)[]>
  /** Where each hidden series would sit, so it shrinks into place and grows back out of it. */
  hiddenSpans: Record<string, (Span | null)[]>
  phase: EntrancePhase
  /** The chart was loading, so its bars grow out of the placeholder. */
  fromPlaceholder: boolean
  entrance: NonNullable<BarChartProps['entrance']>
  /** How far through the cascade each category's bars start, by its place in the data. */
  cascade: readonly number[]
  barGap: number
  stackOf: (key: string) => string
}

const BarContext = createContext<BarContextValue | null>(null)

function useBarChart() {
  const bar = use(BarContext)
  if (!bar) throw new Error('`Bar` goes inside a `BarChart`.')
  return bar
}

const barChartKeys = [
  'orientation',
  'stack',
  'entrance',
  'cascadeFrom',
  'categoryGap',
  'barGap',
  'describe',
]

/**
 * The chart's root: it works out each series' bars from the data, and
 * lays out the frame its parts draw in.
 */
function BarChart(props: BarChartProps) {
  const {
    config,
    orientation = 'vertical',
    stack = 'none',
    entrance = 'none',
    cascadeFrom = 'start',
    categoryGap,
    barGap = 0.12,
    describe,
    description,
    empty,
    className,
    children,
    ref,
  } = props
  const stackOf = (key: string) => config[key]?.stack ?? ''
  const gaps: BandGaps = categoryGap === undefined ? {} : { gap: categoryGap }
  const { chart, shapes, rows, root, placeholder, fromPlaceholder, phase } =
    useCategoryChart(props, {
      orientation,
      stack,
      entrance: entrance !== 'none',
      moveProperty: 'clip-path',
      nice: stack !== 'expand',
      bandOf: (index, count) => categoryBand(index, count, gaps),
      measure: (data, shown) => {
        const series = Object.keys(config)
        const spans = seriesSpans(data, shown, stack, stackOf)
        return {
          spans,
          hiddenSpans: hiddenSpans(data, series, shown, stack, stackOf),
          extent: spanExtent(spans),
        }
      },
    })
  const shown = chart.series.filter((key) => !chart.hidden.includes(key))
  const reaches = rows.map((_, at) => farEnd(shapes.spans, shown, at))
  const order = reaches
    .map((reach, at) => ({ at, size: Math.abs(reach) }))
    .toSorted((a, b) => b.size - a.size)
  const cascade = rows.map((_, at) =>
    cascadeFrom === 'value'
      ? cascadeAt(
          at,
          rows.length,
          'start',
          order.findIndex((o) => o.at === at),
        )
      : cascadeAt(at, rows.length, cascadeFrom),
  )
  const full: ChartContextValue = {
    ...chart,
    ...(describe && {
      describe: (at: number) => {
        const category = chart.current[at]
        return category ? describe.text(category.datum) : ''
      },
      table: {
        columns: [describe.name],
        cells: (category: ChartCategory) => [describe.text(category.datum)],
      },
    }),
    // The tooltip sits on the far end of the category's bars: the tallest, or the stack's top.
    pointOf: (at) => {
      const category = chart.current[at]
      if (!category) return null
      const reach = chart.entered ? (reaches[at] ?? 0) : 0
      return plotPoint(
        category.band,
        fractionOf(reach, chart.scale.domain),
        orientation,
        chart.direction,
      )
    },
  }

  return (
    <BarContext
      value={{
        spans: shapes.spans,
        hiddenSpans: shapes.hiddenSpans,
        phase,
        fromPlaceholder,
        entrance,
        cascade,
        barGap,
        stackOf,
      }}
    >
      <CategoryChartFrame
        chart={full}
        root={root}
        ref={ref}
        slot='bar-chart'
        description={description}
        empty={empty}
        className={className}
        placeholder={placeholder && <BarPlaceholder chart={full} />}
        {...figureProps(props, barChartKeys)}
      >
        {children}
      </CategoryChartFrame>
    </BarContext>
  )
}

/** How far the bars of row `index` reach from zero: the highest above it, or, with none above, the lowest below. */
function farEnd(
  spans: Record<string, readonly (Span | null)[]>,
  keys: readonly string[],
  index: number,
) {
  const up = reachOf(spans, keys, index)
  return up > 0 ? up : reachOf(spans, keys, index, true)
}

/**
 * Where the bar of `key` in `category` stands: in its slot of the band
 * side by side, or across the band stacked, beside the chart's other stacks.
 * A hidden series, a missing value, a bar that hasn't risen yet and a
 * category that leaves all stand at zero.
 */
function barPlace(
  chart: ChartContextValue,
  bar: BarContextValue,
  category: ChartCategory,
  key: string,
): BarPlace {
  const { series, hidden, stack, scale } = chart
  const isHidden = hidden.includes(key)
  const order = series.filter((k) => k === key || !hidden.includes(k))
  const stacks = stacksOf(order, bar.stackOf)
  const band =
    stack === 'none'
      ? slotBand(category.band, order.indexOf(key), order.length, bar.barGap)
      : slotBand(
          category.band,
          stacks.indexOf(bar.stackOf(key)),
          stacks.length,
          bar.barGap,
        )
  const zero = fractionOf(0, scale.domain)
  const span = category.leaving
    ? null
    : (isHidden ? bar.hiddenSpans[key] : bar.spans[key])?.[category.index]
  if (!span || !chart.entered) return { band, from: zero, to: zero }
  return {
    band,
    from: fractionOf(span[0], scale.domain),
    to: fractionOf(span[1], scale.domain),
  }
}

/** Whether the bar of `key` is the last of its stack on its side of zero, which takes the round end. */
function isOutermost(
  chart: ChartContextValue,
  bar: BarContextValue,
  category: ChartCategory,
  key: string,
) {
  if (chart.stack === 'none') return true
  const own = bar.spans[key]?.[category.index]
  if (!own || rangeOf(category.datum[key])) return true
  const positive = own[1] >= own[0]
  const shown = chart.series.filter(
    (k) => !chart.hidden.includes(k) && bar.stackOf(k) === bar.stackOf(key),
  )
  const after = shown.slice(shown.indexOf(key) + 1)
  return !after.some((k) => {
    const span = bar.spans[k]?.[category.index]
    return (
      span &&
      !rangeOf(category.datum[k]) &&
      span[1] !== span[0] &&
      span[1] >= span[0] === positive
    )
  })
}

/** What a bar's label reads: its value, its range, or nothing for a missing value. */
function labelText(raw: unknown, write: (value: number) => string) {
  const range = rangeOf(raw)
  if (range) return `${write(range[0])} – ${write(range[1])}`
  const number = numberOf(raw)
  return number === null ? '' : write(number)
}

type BarProps = Omit<ComponentProps<'div'>, 'children' | 'color'> & {
  /** The key of this series' values in the data, and of its entry in the config. */
  dataKey: string
  /** A colour for one bar, such as one that stands out, from its row; the series' colour when it returns nothing. */
  color?: (datum: ChartDatum, index: number) => string | undefined
  /** The colour of a bar below zero. */
  negativeColor?: string
  /** Writes each bar's value on it: `true` puts it past the bar's end. */
  label?: boolean | BarLabelPosition
  /** How the labels write values; the chart's `format` by default. */
  labelFormat?: ChartFormat
  /** Draws each bar's whole length behind it, for values out of a whole. */
  track?: boolean
  /** Fills the bars with the series' colour, or with it fading toward zero. */
  fill?: 'solid' | 'gradient'
}

/**
 * One series' bars: a layer of the plot holding a bar for each category,
 * in the series' colour. While the chart enters, the bars rise on `draw`,
 * one after another with `entrance='cascade'`; after that every change
 * moves on `layout`. A missing value shows a short dashed mark at zero, so
 * it reads apart from a zero.
 */
function Bar({
  dataKey,
  color,
  negativeColor,
  label = false,
  labelFormat,
  track = false,
  fill = 'solid',
  className,
  style,
  ...props
}: BarProps) {
  const chart = useChart()
  const { spotlit } = useChartActive()
  const bar = useBarChart()
  const position: BarLabelPosition | null = label === true ? 'outside' : label || null
  const { addRoom, orientation } = chart
  const write = formatterOf(chart.locale, labelFormat ?? chart.format)
  const room =
    position === 'outside'
      ? outsideRoom(
          chart,
          chart.current.map((category) => labelText(category.datum[dataKey], write)),
        )
      : 0
  useLayoutEffect(() => (room > 0 ? addRoom(room) : undefined), [addRoom, room])
  if (chart.status === 'empty') return null
  const slot = chart.series.indexOf(dataKey)
  const zero = fractionOf(0, chart.scale.domain)
  const pattern = patternImage(chart.patternOf(dataKey))
  const gradient =
    fill === 'gradient'
      ? `linear-gradient(${orientation === 'vertical' ? 'to top' : chart.direction === 'rtl' ? 'to left' : 'to right'}, color-mix(in oklab, var(--bar-fill) 35%, transparent), var(--bar-fill))`
      : undefined
  const images = [pattern, gradient].filter(Boolean).join(', ')
  const dimmed = (category: ChartCategory) =>
    (spotlit !== null && spotlit !== category.index) ||
    (chart.emphasis !== null && chart.emphasis !== dataKey)
  return (
    <>
      <div
        data-slot='bar-chart-series'
        data-series={dataKey}
        aria-hidden
        className={cn(plotLayerClassName, 'z-10', className)}
        style={style}
        {...props}
      >
        {chart.categories.map((category) => {
          const place = barPlace(chart, bar, category, dataKey)
          const value = numberOf(category.datum[dataKey])
          const range = rangeOf(category.datum[dataKey])
          const below = range ? range[1] < range[0] : value !== null && value < 0
          const own =
            color?.(category.datum, category.index) ??
            (below && negativeColor ? negativeColor : undefined)
          const clip = barClip(chart, place, isOutermost(chart, bar, category, dataKey))
          const at = Math.min(category.index, PLACEHOLDER_COUNT - 1)
          // A bar that arrives grows out of the placeholder in its place, or up from zero.
          const from = bar.fromPlaceholder
            ? placeholderClip(chart, at, placeholderValues(PLACEHOLDER_COUNT)[at]!)
            : barClip(chart, { band: place.band, from: zero, to: zero }, true)
          const missing =
            !category.leaving &&
            chart.entered &&
            !chart.hidden.includes(dataKey) &&
            value === null &&
            range === null
          const delay = cascadeDelay(bar, category.index)
          return (
            <BarShape
              key={category.key}
              clip={clip}
              from={from}
              dim={dimmed(category)}
              entering={bar.phase === 'entering'}
              delay={delay}
              color={own ?? seriesColor(dataKey)}
              images={images}
              slot={slot}
              track={track ? trackClip(chart, place.band) : undefined}
              missing={missing ? missingMark(chart, place.band) : undefined}
            />
          )
        })}
      </div>
      {position && chart.status === 'ready' && (
        // Above the reference lines, so a line across a value never runs through it.
        <div aria-hidden className={cn(plotLayerClassName, 'z-20')}>
          <BarLabels
            dataKey={dataKey}
            position={position}
            write={write}
            dimmed={dimmed}
          />
        </div>
      )}
    </>
  )
}

/** How long the bars of the category at `index` wait in a cascade's entrance; none otherwise. */
function cascadeDelay(bar: BarContextValue, index: number) {
  return bar.entrance === 'cascade' && bar.phase === 'entering'
    ? `calc(var(--motion-draw-duration) * var(--bar-chart-cascade, 0.8) * ${bar.cascade[index] ?? 0})`
    : undefined
}

/**
 * Each bar's value, written past its end, just inside it, or in its middle.
 * A label that doesn't fit its bar is skipped, and every label slides with
 * its bar.
 */
function BarLabels({
  dataKey,
  position,
  write,
  dimmed,
}: {
  dataKey: string
  position: BarLabelPosition
  write: (value: number) => string
  dimmed: (category: ChartCategory) => boolean
}) {
  const chart = useChart()
  const bar = useBarChart()
  if (chart.hidden.includes(dataKey)) return null
  return (
    <>
      {chart.categories.map((category) => {
        const place = barPlace(chart, bar, category, dataKey)
        const span = bar.spans[dataKey]?.[category.index]
        const text = labelText(category.datum[dataKey], write)
        const outermost = isOutermost(chart, bar, category, dataKey)
        const shown =
          !category.leaving &&
          span !== null &&
          span !== undefined &&
          text !== '' &&
          (position !== 'outside' || outermost) &&
          labelFits(chart, place, text, position)
        return (
          <BarLabel
            key={category.key}
            {...labelPlace(chart, place, position)}
            shown={shown}
            dim={dimmed(category)}
            entering={bar.phase === 'entering'}
            delay={cascadeDelay(bar, category.index)}
          >
            {text}
          </BarLabel>
        )
      })}
    </>
  )
}

/**
 * The total of each category's stack, written past its end, for stacked
 * bars, whose length the tooltip alone would otherwise tell.
 */
function BarTotals({
  format,
  className,
  ...props
}: Omit<ComponentProps<'div'>, 'children'> & { format?: ChartFormat }) {
  const chart = useChart()
  const { spotlit } = useChartActive()
  const bar = useBarChart()
  const { addRoom } = chart
  const write = formatterOf(chart.locale, format ?? chart.format)
  const shown = chart.series.filter((key) => !chart.hidden.includes(key))
  const totalOf = (datum: ChartDatum) =>
    shown.reduce((sum, key) => sum + (numberOf(datum[key]) ?? 0), 0)
  const room = outsideRoom(
    chart,
    chart.stack === 'expand'
      ? []
      : chart.current.map((category) => write(totalOf(category.datum))),
  )
  useLayoutEffect(() => addRoom(room), [addRoom, room])
  if (chart.status !== 'ready') return null
  return (
    <div
      data-slot='bar-chart-totals'
      aria-hidden
      className={cn(plotLayerClassName, 'z-20', className)}
      {...props}
    >
      {chart.categories.map((category) => {
        const total = totalOf(category.datum)
        const reach =
          category.leaving || !chart.entered
            ? 0
            : farEnd(bar.spans, shown, category.index)
        const place = {
          band: category.band,
          from: fractionOf(0, chart.scale.domain),
          to: fractionOf(reach, chart.scale.domain),
        }
        return (
          <BarLabel
            key={category.key}
            {...labelPlace(chart, place, 'outside')}
            shown={!category.leaving && labelFits(chart, place, write(total), 'outside')}
            dim={spotlit !== null && spotlit !== category.index}
          >
            {chart.stack === 'expand' ? '' : write(total)}
          </BarLabel>
        )
      })}
    </div>
  )
}

/**
 * The steps of a waterfall from each change in `values`: each runs from
 * where the last one ended, as the `[from, to]` a bar takes, so a running
 * total reads as it builds. With `total`, a last step runs from zero to the
 * sum.
 */
function waterfall(values: readonly number[], total = false): Span[] {
  const steps: Span[] = []
  let at = 0
  for (const value of values) {
    steps.push([at, at + value])
    at += value
  }
  if (total) steps.push([0, at])
  return steps
}

export {
  Bar,
  BarChart,
  type BarChartProps,
  type BarLabelPosition,
  type BarProps,
  BarTotals,
  waterfall,
}
