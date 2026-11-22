'use client'

import { barBand, barMarks, farEnd } from '@/registry/lib/chart-bar-marks'
import {
  barClip,
  BarFrameContext,
  type BarFrameValue,
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
  trackClip,
  useBarFrame,
} from '@/registry/lib/chart-bars'
import {
  figureProps,
  seriesWords,
  useChartActive,
  useDeclared,
} from '@/registry/lib/chart-base'
import {
  CartesianChartFrame,
  type CartesianChartProps,
  type CartesianChartValue,
  cartesianChartKeys,
  cartesianSignature,
  type CartesianStop,
  cartesianWords,
  type ChartPartDeclaration,
  type ChartRoomState,
  useCartesian,
  useCartesianChart,
} from '@/registry/lib/chart-cartesian'
import { markLayer, VALUE_AXIS } from '@/registry/lib/chart-frame'
import {
  type ChartLive,
  ChartLiveLayer,
  LIVE_SPAN,
} from '@/registry/lib/chart-live-clock'
import {
  cascadeAt,
  type ChartDatum,
  type ChartOrientation,
  type ChartStack,
  numberOf,
  plotPoint,
  rangeOf,
  type Span,
} from '@/registry/lib/chart-math'
import {
  type ChartFormat,
  type ChartItem,
  type ChartRootState,
  formatterOf,
  patternImage,
  plotLayerClassName,
  seriesColor,
} from '@/registry/lib/chart-root'
import type { BandGaps } from '@/registry/lib/chart-scale'
import type { ComponentProps } from 'react'

import { cn } from '@/lib/utils'

/*
 * The Bar chart: values across categories, side by side, stacked, or as
 * shares, upright or lying. Each bar is the clip of a layer as large as the
 * plot, so a new value, a new range, a series hidden or the categories
 * sorted is one CSS transition of each bar, which turns back from wherever
 * it is. The category under the pointer stays bright while the rest step
 * back, and the tooltip sits on the end of its bars.
 */

interface BarChartProps extends CartesianChartProps {
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

const barChartKeys = [
  ...cartesianChartKeys,
  'orientation',
  'stack',
  'entrance',
  'cascadeFrom',
  'categoryGap',
  'barGap',
  'describe',
]

/** Every series at a stop, read along x. */
const X_BROWSE = { kind: 'x' } as const

/** The legend's keys are plain swatches. */
function noMarker() {
  return null
}

/**
 * The chart's root: it works out each series' bars from the data, and
 * lays out the frame its parts draw in.
 */
function BarChart(props: BarChartProps) {
  const {
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
  const gaps: BandGaps = categoryGap === undefined ? {} : { gap: categoryGap }
  const cartesian = useCartesianChart(props, {
    kinds: [barMarks],
    orientation,
    stack,
    entrance: entrance !== 'none',
    cascade:
      entrance === 'cascade'
        ? { variable: '--bar-chart-cascade', fallback: 0.8 }
        : undefined,
    gaps,
  })
  const { chart, model, placeholder, fromPlaceholder, phase } = cartesian
  const stops = chart.current
  // The cascade's order reads the bars against the chart's own value axis.
  const shown = totalled(chart)
  const reaches = stops.map((_, at) => farEnd(model.spans, shown, at))
  const order = reaches
    .map((reach, at) => ({ at, size: Math.abs(reach) }))
    .toSorted((a, b) => b.size - a.size)
  const cascade = stops.map((_, at) =>
    cascadeFrom === 'value'
      ? cascadeAt(
          at,
          stops.length,
          'start',
          order.findIndex((o) => o.at === at),
        )
      : cascadeAt(at, stops.length, cascadeFrom),
  )
  // What each stop holds, read out and in the data table, in place of each series' value.
  const own = describe
    ? {
        name: describe.name,
        text: (stop: ChartItem) => (stop.datum ? describe.text(stop.datum) : ''),
      }
    : null
  return (
    <BarFrameContext
      value={{
        model,
        phase,
        fromPlaceholder,
        entrance,
        cascade,
        cascadeSpan: 'var(--bar-chart-cascade, 0.8)',
        barGap,
      }}
    >
      <CartesianChartFrame
        chart={cartesian}
        ref={ref}
        slot='bar-chart'
        description={description}
        empty={empty}
        className={className}
        placeholder={placeholder && <BarPlaceholder chart={chart} />}
        markerOf={noMarker}
        // The tooltip sits on the far end of the stop's bars: the tallest, or the stack's top.
        anchor={(stop) => {
          const along = chart.entered ? model.reach(stop.index) : null
          return plotPoint(
            stop.band,
            along ?? model.baselines.value,
            orientation,
            chart.direction,
          )
        }}
        words={seriesWords(chart, cartesianWords(chart, own))}
        browse={X_BROWSE}
        {...figureProps(props, barChartKeys)}
      >
        {children}
      </CartesianChartFrame>
    </BarFrameContext>
  )
}

/**
 * Where the bar of `key` at `stop` stands: in its slot of the band
 * side by side, or across the band stacked, beside the chart's other stacks.
 * A hidden series, a missing value, a bar that hasn't risen yet and a
 * category that leaves all stand at zero.
 */
function barPlace(
  chart: CartesianChartValue,
  bar: BarFrameValue,
  stop: CartesianStop,
  key: string,
): BarPlace {
  const { model } = bar
  const bars = chart.series.filter((k) => model.markOf(k) === 'bar')
  const band = barBand(
    stop.band,
    key,
    bars,
    chart.hidden,
    chart.stack,
    model.stackOf,
    bar.barGap,
  )
  const { scale, baseline: zero } = model.valueAxisOf(key)
  const span = stop.leaving ? null : model.spans[key]?.[stop.index]
  if (!span || !chart.entered) return { band, from: zero, to: zero }
  return { band, from: scale.place(span[0]), to: scale.place(span[1]) }
}

/** Whether the bar of `key` is the last of its stack on its side of zero, which takes the round end. */
function isOutermost(
  chart: CartesianChartValue,
  bar: BarFrameValue,
  stop: CartesianStop,
  key: string,
) {
  if (chart.stack === 'none') return true
  const { spans, stackOf } = bar.model
  const own = spans[key]?.[stop.index]
  if (!own || rangeOf(chart.valueOf(key, stop))) return true
  const positive = own[1] >= own[0]
  const shown = chart.series.filter(
    (k) => !chart.hidden.includes(k) && stackOf(k) === stackOf(key),
  )
  const after = shown.slice(shown.indexOf(key) + 1)
  return !after.some((k) => {
    const span = spans[k]?.[stop.index]
    return (
      span &&
      !rangeOf(chart.valueOf(k, stop)) &&
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
function Bar(props: BarProps) {
  const {
    dataKey,
    color,
    negativeColor,
    label = false,
    labelFormat,
    track = false,
    fill = 'solid',
    className,
    style,
    ...rest
  } = props
  useDeclared('Bar', Bar.declare(props), cartesianSignature)
  const chart = useCartesian()
  const { spotlit } = useChartActive()
  const bar = useBarFrame()
  const position = labelPosition(label)
  const { orientation } = chart
  const write = formatterOf(chart.locale, labelFormat ?? chart.format)
  if (chart.status === 'empty') return null
  const slot = chart.series.indexOf(dataKey)
  const zero = bar.model.valueAxisOf(dataKey).baseline
  const pattern = patternImage(chart.patternOf(dataKey))
  const gradient =
    fill === 'gradient'
      ? `linear-gradient(${orientation === 'vertical' ? 'to top' : chart.direction === 'rtl' ? 'to left' : 'to right'}, color-mix(in oklab, var(--bar-fill) 35%, transparent), var(--bar-fill))`
      : undefined
  const images = [pattern, gradient].filter(Boolean).join(', ')
  const live = chart.frame.live
  const dimmed = (stop: CartesianStop) =>
    (spotlit !== null && spotlit !== stop.index) ||
    (chart.emphasis !== null && chart.emphasis !== dataKey)
  return (
    <>
      <div
        data-slot='bar-chart-series'
        data-series={dataKey}
        aria-hidden
        className={cn(plotLayerClassName, markLayer.bar, className)}
        style={style}
        {...rest}
      >
        <ChartLiveLayer live={live} direction={chart.direction} reach='plot'>
          <div
            className={
              live
                ? 'absolute inset-y-0 start-0 w-[300%] [container-type:size]'
                : 'contents'
            }
          >
            {/* A live plot's rows that leave have scrolled out already, so only the rows still in it draw. */}
            {(live ? chart.current : chart.stops).map((stop) => {
              const place = liveBand(barPlace(chart, bar, stop, dataKey), live)
              const raw = chart.valueOf(dataKey, stop)
              const value = numberOf(raw)
              const range = rangeOf(raw)
              const below = range ? range[1] < range[0] : value !== null && value < 0
              const own =
                (stop.datum && color?.(stop.datum, stop.index)) ??
                (below && negativeColor ? negativeColor : undefined)
              const clip = barClip(chart, place, isOutermost(chart, bar, stop, dataKey))
              const at = Math.min(stop.index, PLACEHOLDER_COUNT - 1)
              // A bar that arrives grows out of the placeholder in its place, or up from zero.
              const from = bar.fromPlaceholder
                ? placeholderClip(chart, at, placeholderValues(PLACEHOLDER_COUNT)[at]!)
                : barClip(chart, { band: place.band, from: zero, to: zero }, true)
              const missing =
                !stop.leaving &&
                chart.entered &&
                !chart.hidden.includes(dataKey) &&
                value === null &&
                range === null
              const delay = cascadeDelay(bar, stop.index)
              return (
                <BarShape
                  key={stop.key}
                  clip={clip}
                  from={from}
                  dim={dimmed(stop)}
                  entering={bar.phase === 'entering'}
                  delay={delay}
                  color={own ?? seriesColor(dataKey)}
                  images={images}
                  slot={slot}
                  track={track ? trackClip(chart, place.band) : undefined}
                  missing={missing ? missingMark(chart, place.band, zero) : undefined}
                />
              )
            })}
          </div>
        </ChartLiveLayer>
      </div>
      {/* A live chart's bars scroll past too fast to read a label on each. */}
      {position && chart.status === 'ready' && !live && (
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

/**
 * A bar's place in its layer: on a live chart, a box `LIVE_SPAN` plots wide
 * from the plot's reading start, so a bar past the plot's end, which the
 * clock will bring into view, isn't clipped away.
 */
function liveBand(place: BarPlace, live: ChartLive | null): BarPlace {
  if (!live) return place
  const { start, size } = place.band
  return {
    ...place,
    band: { start: start / LIVE_SPAN, size: size / LIVE_SPAN },
  }
}

/** Where a bar's label sits, or null for none: `true` puts it past the bar's end. */
function labelPosition(label: BarProps['label']): BarLabelPosition | null {
  return label === true ? 'outside' : label || null
}

// A bar is its series; labels past the bars' ends keep room for themselves past the value
// axis's far end, worked out from what they will read.
Bar.declare = ({
  dataKey,
  label = false,
  labelFormat,
}: BarProps): ChartPartDeclaration => ({
  series: { key: dataKey, mark: 'bar' },
  ...(labelPosition(label) === 'outside'
    ? {
        room: (chart: ChartRoomState) => {
          const write = formatterOf(chart.locale, labelFormat ?? chart.format)
          return outsideRoom(
            chart,
            chart.rows.map((row) => labelText(row[dataKey], write)),
          )
        },
      }
    : {}),
})

/** How long the bars of the stop at `index` wait in a cascade's entrance; none otherwise. */
function cascadeDelay(bar: BarFrameValue, index: number) {
  return bar.entrance === 'cascade' && bar.phase === 'entering'
    ? `calc(var(--motion-draw-duration) * ${bar.cascadeSpan} * ${bar.cascade[index] ?? 0})`
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
  dimmed: (stop: CartesianStop) => boolean
}) {
  const chart = useCartesian()
  const bar = useBarFrame()
  if (chart.hidden.includes(dataKey)) return null
  return (
    <>
      {chart.stops.map((stop) => {
        const place = barPlace(chart, bar, stop, dataKey)
        const span = bar.model.spans[dataKey]?.[stop.index]
        const text = labelText(chart.valueOf(dataKey, stop), write)
        const outermost = isOutermost(chart, bar, stop, dataKey)
        const shown =
          !stop.leaving &&
          span !== null &&
          span !== undefined &&
          text !== '' &&
          (position !== 'outside' || outermost) &&
          labelFits(chart, place, text, position)
        return (
          <BarLabel
            key={stop.key}
            {...labelPlace(chart, place, position)}
            shown={shown}
            dim={dimmed(stop)}
            entering={bar.phase === 'entering'}
            delay={cascadeDelay(bar, stop.index)}
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
type BarTotalsProps = Omit<ComponentProps<'div'>, 'children'> & {
  format?: ChartFormat
}

/**
 * The series a stack's total adds: the shown bars read against the chart's
 * own value axis, never a line or a point beside them, or a bar on an axis
 * of its own.
 */
function totalled(chart: Pick<ChartRootState, 'series' | 'hidden' | 'config'>) {
  return chart.series.filter(
    (key) =>
      !chart.hidden.includes(key) &&
      (chart.config[key]?.mark ?? 'bar') === 'bar' &&
      (chart.config[key]?.axis ?? VALUE_AXIS) === VALUE_AXIS,
  )
}

/** The total of a stop's shown series, each read with `valueOf`. */
function totalOf(valueOf: (key: string) => unknown, shown: readonly string[]) {
  return shown.reduce((sum, key) => sum + (numberOf(valueOf(key)) ?? 0), 0)
}

function BarTotals(props: BarTotalsProps) {
  const { format, className, ...rest } = props
  useDeclared('BarTotals', BarTotals.declare(props), cartesianSignature)
  const chart = useCartesian()
  const { spotlit } = useChartActive()
  const bar = useBarFrame()
  const write = formatterOf(chart.locale, format ?? chart.format)
  const shown = totalled(chart)
  const scale = bar.model.y.value
  const zero = bar.model.baselines.value
  if (chart.status !== 'ready') return null
  return (
    <div
      data-slot='bar-chart-totals'
      aria-hidden
      className={cn(plotLayerClassName, 'z-20', className)}
      {...rest}
    >
      {chart.stops.map((stop) => {
        const total = totalOf((key) => chart.valueOf(key, stop), shown)
        const place = {
          band: stop.band,
          from: zero,
          to:
            stop.leaving || !chart.entered
              ? zero
              : scale.place(farEnd(bar.model.spans, shown, stop.index)),
        }
        return (
          <BarLabel
            key={stop.key}
            {...labelPlace(chart, place, 'outside')}
            shown={!stop.leaving && labelFits(chart, place, write(total), 'outside')}
            dim={spotlit !== null && spotlit !== stop.index}
          >
            {chart.stack === 'expand' ? '' : write(total)}
          </BarLabel>
        )
      })}
    </div>
  )
}

// The totals keep room for themselves past the value axis's far end.
BarTotals.declare = ({ format }: BarTotalsProps): ChartPartDeclaration => ({
  room: (chart) => {
    const write = formatterOf(chart.locale, format ?? chart.format)
    const shown = totalled(chart)
    return outsideRoom(
      chart,
      chart.stack === 'expand'
        ? []
        : chart.rows.map((row) => write(totalOf((key) => row[key], shown))),
    )
  },
})

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
