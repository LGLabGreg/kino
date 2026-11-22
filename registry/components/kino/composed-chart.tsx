'use client'

import { Area, type AreaProps } from '@/registry/components/kino/area-chart'
import { Bar, type BarProps, BarTotals } from '@/registry/components/kino/bar-chart'
import { Line, type LineProps } from '@/registry/components/kino/line-chart'
import { areaMarks } from '@/registry/lib/chart-area-marks'
import { barMarks } from '@/registry/lib/chart-bar-marks'
import { BarFrameContext, BarPlaceholder } from '@/registry/lib/chart-bars'
import {
  figureProps,
  seriesWords,
  useChartActive,
  useDeclared,
} from '@/registry/lib/chart-base'
import {
  type CartesianChartProps,
  cartesianChartKeys,
  cartesianSignature,
  cartesianWords,
  type ChartPartDeclaration,
  type LiveChartProps,
  type NamedValueAxis,
  useCartesian,
  useCartesianChart,
} from '@/registry/lib/chart-cartesian'
import { VALUE_AXIS } from '@/registry/lib/chart-frame'
import {
  EntranceWipe,
  framePoints,
  frameRest,
  frameTop,
  LineFamilyFrame,
  LinePlaceholder,
  useLineFamily,
} from '@/registry/lib/chart-line'
import { lineMarks } from '@/registry/lib/chart-line-marks'
import { ChartLiveLayer } from '@/registry/lib/chart-live-clock'
import {
  cascadeAt,
  type ChartDatum,
  type ChartSeries,
  type ChartStack,
  plotPoint,
  rangeOf,
} from '@/registry/lib/chart-math'
import { pointMarks } from '@/registry/lib/chart-point-marks'
import { markerAt, type PlacedPoint, PointSeries } from '@/registry/lib/chart-points'
import type { BandGaps } from '@/registry/lib/chart-scale'
import type { ComponentProps } from 'react'

import { cn } from '@/lib/utils'

/*
 * The Composed chart: bars, lines, areas and points on one plot, each series
 * drawn as its config says and read against the value axis it names, up to
 * one on each side. Its parts are the single-mark charts' own, so a bar here
 * looks and moves as the Bar chart's does and a line as the Line chart's;
 * the frame fits every axis as it renders, lines the second axis's ticks up
 * with the first's gridlines, and stacks each kind of mark in its own layer,
 * areas at the back and points in front, whatever order the parts are
 * written in. The category under the pointer stays bright across every
 * mark, and one tooltip lists every series there.
 */

/** A series of a Composed chart: what it is drawn as, which the config always says, and for bars and areas, which stack it joins. */
type ComposedSeries = Omit<ChartSeries, 'mark' | 'stack'> &
  (
    | {
        mark: 'bar' | 'area'
        /** When the chart stacks, the series with the same `stack` stack together, beside the other stacks. */
        stack?: string
      }
    | { mark: 'line' | 'point' }
  )

/** Every key is a series the chart draws, in the order written, which is also the order they stack in. */
type ComposedChartConfig = Record<string, ComposedSeries>

interface ComposedChartProps extends Omit<CartesianChartProps, 'config'>, LiveChartProps {
  config: ComposedChartConfig
  /**
   * Every value axis besides the chart's own, by the id its series name in
   * their config's `axis`: how it fits, writes and titles its values. Its
   * ticks line up with the own axis's gridlines unless `align` is off.
   */
  axes?: Readonly<Record<string, NamedValueAxis>>
  /** How the bars, and the areas, of one category combine: side by side, stacked, or stacked as shares of their total. Each kind stacks among itself. */
  stack?: ChartStack
  /**
   * How the marks arrive the first time the chart comes into view: rising
   * from their baselines, drawn along from the reading start with the bars
   * rising one after another in step, or simply there, the default, since a
   * page that loads doesn't animate into place.
   */
  entrance?: 'rise' | 'draw' | 'none'
  /** The space between two categories, as a share of one category's step, when bars stand in them. */
  categoryGap?: number
  /** The space between bars side by side, as a share of one bar's slot. */
  barGap?: number
}

const composedChartKeys = [
  ...cartesianChartKeys,
  'axes',
  'stack',
  'entrance',
  'categoryGap',
  'barGap',
]

/** A line's key in the legend: a short stroke, told apart from a bar's square. */
const LINE_KEY = 'M-1.1,-0.3H1.1V0.3H-1.1Z'

/** Every series at a stop, read along x. */
const X_BROWSE = { kind: 'x' } as const

/**
 * The chart's root: it fits each value axis to the series read against it,
 * lays out the frame its parts draw in, and places every mark at its
 * category, bars in bands and lines, areas and points at their centres.
 */
function ComposedChart(props: ComposedChartProps) {
  const {
    config,
    axes = {},
    stack = 'none',
    entrance = 'none',
    categoryGap,
    barGap = 0.12,
    description,
    empty,
    className,
    children,
    ref,
  } = props
  checkAxes(config, axes)
  const marks = Object.values(config).map((series) => series.mark)
  const hasBars = marks.includes('bar')
  const gaps: BandGaps = categoryGap === undefined ? {} : { gap: categoryGap }
  const cartesian = useCartesianChart(props, {
    kinds: [barMarks, lineMarks, areaMarks, pointMarks],
    orientation: 'vertical',
    stack,
    entrance: entrance !== 'none',
    cascade:
      entrance === 'draw' && hasBars
        ? { variable: '--composed-chart-cascade', fallback: 0.6 }
        : undefined,
    gaps,
    axes,
  })
  const { chart, model, placeholder, fromPlaceholder, phase } = cartesian
  const stops = chart.current
  const markOf = model.markOf
  const pointKeys = chart.series.filter((key) => markOf(key) === 'point')
  // The legend's key takes each mark's shape, so a series reads by more than its colour.
  const markerOf = (key: string) => {
    const mark = markOf(key)
    if (mark === 'line') return LINE_KEY
    if (mark === 'point') return markerAt(pointKeys.indexOf(key))
    return null
  }
  const traced = (key: string) => markOf(key) === 'line' || markOf(key) === 'area'
  return (
    <BarFrameContext
      value={{
        model,
        phase,
        fromPlaceholder,
        entrance: entrance === 'draw' ? 'cascade' : entrance,
        cascade: stops.map((_, at) => cascadeAt(at, stops.length, 'start')),
        cascadeSpan: 'var(--composed-chart-cascade, 0.6)',
        barGap,
      }}
    >
      <LineFamilyFrame
        chart={cartesian}
        markerOf={markerOf}
        // The tooltip sits over the highest of the stop's marks, whatever they are.
        anchor={(stop) => {
          const along = chart.entered ? model.reach(stop.index) : null
          return plotPoint(
            stop.band,
            along ?? model.baselines.value,
            'vertical',
            chart.direction,
          )
        }}
        words={seriesWords(chart, cartesianWords(chart, null))}
        browse={X_BROWSE}
        family={{
          name: 'composed-chart',
          phase,
          entrance,
          // A hidden area folds into the one below it; a hidden line or point lies flat.
          pointsOf: (key, rising) =>
            framePoints(
              chart,
              model,
              key,
              rising || (markOf(key) !== 'area' && chart.hidden.includes(key)),
              markOf(key) === 'area',
            ),
          // The lit category's dot marks each line and area; a bar or a point is its own mark.
          topOf: (key, stop) => (traced(key) ? frameTop(model, key, stop) : null),
          bottomOf: (key, stop) =>
            markOf(key) === 'area' && rangeOf(chart.valueOf(key, stop))
              ? frameTop(model, key, stop, true)
              : null,
          restOf: (key) => frameRest(model, key),
        }}
        description={description}
        empty={empty}
        placeholder={
          placeholder &&
          (hasBars ? (
            <BarPlaceholder chart={chart} />
          ) : (
            <LinePlaceholder name='composed-chart' fill={marks.includes('area')} />
          ))
        }
        // The bars step back as far as the lines, by the chart's own variable.
        className={cn('[--bar-chart-dim:var(--composed-chart-dim,0.3)]', className)}
        ref={ref}
        {...figureProps(props, composedChartKeys)}
      >
        {children}
      </LineFamilyFrame>
    </BarFrameContext>
  )
}

/**
 * Throws for an axis the config and `axes` disagree on: a series read
 * against an axis `axes` doesn't name, or `axes` naming the chart's own,
 * which the root's own props fit.
 */
function checkAxes(
  config: ComposedChartConfig,
  axes: Readonly<Record<string, NamedValueAxis>>,
) {
  if (VALUE_AXIS in axes) {
    throw new Error(
      `\`axes\` names \`${VALUE_AXIS}\`, the chart's own value axis: fit it with the chart's own \`domain\`, \`tickCount\` and \`format\`, and title it with its \`ChartYAxis\`'s \`label\`.`,
    )
  }
  for (const [key, series] of Object.entries(config)) {
    const axis = series.axis
    if (axis !== undefined && axis !== VALUE_AXIS && !(axis in axes)) {
      throw new Error(
        `The series \`${key}\` is read against the axis \`${axis}\`, which \`axes\` doesn't name. Add it, such as \`axes={{ ${axis}: { format: { style: 'percent' } } }}\`.`,
      )
    }
  }
}

type PointsProps = Omit<ComponentProps<'div'>, 'children'> & {
  /** The key of this series' values in the data, and of its entry in the config. */
  dataKey: string
  /**
   * The series' own rows, on an x of times, in place of the chart's: each
   * with the chart's `index` and the series' `dataKey`, in time order. Its
   * points stand at their own times.
   */
  data?: readonly ChartDatum[]
  /** Each point's radius, in px. */
  radius?: number
}

/**
 * One series' points: a mark at each category's value, in the series'
 * colour and in a shape of its own, as a target beside each bar is. They
 * glide to new values on `layout`, grow in as they arrive and shrink away
 * as they leave or the series hides. The lit category's point stays bright
 * while the rest step back.
 */
function Points(props: PointsProps) {
  const { dataKey, radius = 5, data, ...rest } = props
  useDeclared('Points', Points.declare(props), cartesianSignature)
  const chart = useCartesian()
  const family = useLineFamily()
  const { spotlit } = useChartActive()
  if (chart.status !== 'ready' && chart.status !== 'hidden') return null
  const hidden = chart.hidden.includes(dataKey)
  const rising = !chart.entered && family.entrance === 'rise'
  const rtl = chart.direction === 'rtl'
  const placed = family.pointsOf(dataKey, rising).flatMap((point): PlacedPoint[] => {
    if (!point.defined || point.key === null) return []
    return [
      {
        key: point.key,
        x: rtl ? 1 - point.x : point.x,
        y: point.y,
        radius,
        depth: 0,
        leaving: hidden,
      },
    ]
  })
  // A series with no row at the lit stop lights its nearest own one, as the tooltip reads it.
  const litStop = spotlit === null || hidden ? undefined : chart.current[spotlit]
  const litKey = (litStop && chart.nearOf(dataKey, litStop)?.key) ?? null
  const pointKeys = chart.series.filter((key) => chart.config[key]?.mark === 'point')
  return (
    <PointSeries
      name='composed-chart'
      dataKey={dataKey}
      data-own={data ? '' : undefined}
      points={placed}
      lit={placed.find((point) => point.key === litKey)}
      seriesIndex={chart.series.indexOf(dataKey)}
      marker={markerAt(pointKeys.indexOf(dataKey))}
      dim={spotlit !== null || (chart.emphasis !== null && chart.emphasis !== dataKey)}
      around={(marks) => (
        <ChartLiveLayer live={chart.frame.live} direction={chart.direction} reach='plot'>
          <EntranceWipe>{marks}</EntranceWipe>
        </ChartLiveLayer>
      )}
      {...rest}
    />
  )
}

Points.declare = ({ dataKey, data }: PointsProps): ChartPartDeclaration => ({
  series: { key: dataKey, mark: 'point' },
  ...(data === undefined ? {} : { rows: data }),
})

export {
  Area,
  type AreaProps,
  Bar,
  type BarProps,
  BarTotals,
  ComposedChart,
  type ComposedChartConfig,
  type ComposedChartProps,
  type ComposedSeries,
  Line,
  type LineProps,
  Points,
  type PointsProps,
}
