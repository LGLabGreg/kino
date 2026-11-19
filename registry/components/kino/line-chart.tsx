'use client'

import {
  type CategoryChartProps,
  type ChartContextValue,
  figureProps,
  useCategoryChart,
} from '@/registry/lib/chart-core'
import {
  LINE_PROGRESS,
  LineFamilyFrame,
  LineSeries,
  type LineSeriesProps,
  pointBand,
  zeroY,
} from '@/registry/lib/chart-line'
import {
  type ChartDatum,
  fractionOf,
  numberOf,
  plotPoint,
  type Span,
} from '@/registry/lib/chart-math'
import type { LineCurve, LinePoint } from '@/registry/lib/line-path'

/*
 * The Line chart: one or more series across categories that run in order,
 * such as days. Its lines, their moves and the window that keeps the lit
 * category bright come from the chart line lib, which the Area chart shares.
 * When the data changes, points that stay glide to their new place, points
 * that arrive grow out of the old line and points that leave fold into the
 * new one, so a new range reads as the same line stretching rather than a
 * new one.
 */

interface LineChartProps extends CategoryChartProps {
  /**
   * How the lines arrive the first time the chart comes into view: rising
   * from zero, drawn along from the reading start, or simply there, the
   * default, since a page that loads doesn't animate into place.
   */
  entrance?: 'rise' | 'draw' | 'none'
  /** Keeps zero on the value axis, so a line's rise and fall read in proportion; off fits the axis to the data. */
  zero?: boolean
}

const lineChartKeys = ['entrance', 'zero']

/** The lowest and highest value the shown series reach, taking in zero unless `zero` is off. */
function lineExtent(
  rows: readonly ChartDatum[],
  keys: readonly string[],
  zero: boolean,
): Span {
  let low = zero ? 0 : Infinity
  let high = zero ? 0 : -Infinity
  for (const row of rows) {
    for (const key of keys) {
      const value = numberOf(row[key])
      if (value === null) continue
      low = Math.min(low, value)
      high = Math.max(high, value)
    }
  }
  return Number.isFinite(low) ? [low, high] : [0, 0]
}

/** A line's points for the categories shown, at their place on the value axis, or along zero when `flat`. */
function linePoints(chart: ChartContextValue, key: string, flat: boolean): LinePoint[] {
  const zero = zeroY(chart)
  return chart.current.map((category) => {
    const value = numberOf(category.datum[key])
    return {
      key: category.key,
      x: category.band.start,
      y: flat || value === null ? zero : 1 - fractionOf(value, chart.scale.domain),
      defined: value !== null,
    }
  })
}

/**
 * The chart's root: it lays out the frame its parts draw in, places each
 * category along the plot from edge to edge, and fits the value axis to the
 * lines.
 */
function LineChart(props: LineChartProps) {
  const {
    entrance = 'none',
    zero = true,
    description,
    empty,
    className,
    children,
    ref,
  } = props
  const { chart, root, placeholder, phase } = useCategoryChart(props, {
    orientation: 'vertical',
    stack: 'none',
    entrance: entrance !== 'none',
    moveProperty: LINE_PROGRESS,
    nice: true,
    bandOf: pointBand,
    measure: (rows, shown) => ({ extent: lineExtent(rows, shown, zero) }),
  })
  const shown = chart.series.filter((key) => !chart.hidden.includes(key))
  const full: ChartContextValue = {
    ...chart,
    // A line has no fill to pattern, so its key in the legend and the tooltip stays solid too.
    patternOf: () => 'solid',
    // The tooltip sits over the highest of the category's points.
    pointOf: (at) => {
      const category = chart.current[at]
      if (!category) return null
      const top = chart.entered
        ? Math.max(
            ...shown.map((key) => numberOf(category.datum[key]) ?? -Infinity),
            -Infinity,
          )
        : -Infinity
      const along = Number.isFinite(top) ? fractionOf(top, chart.scale.domain) : 0
      return plotPoint(category.band, along, 'vertical', chart.direction)
    },
  }
  return (
    <LineFamilyFrame
      chart={full}
      root={root}
      family={{
        name: 'line-chart',
        phase,
        entrance,
        // Hidden, or waiting to rise, a line lies flat along zero.
        pointsOf: (key, rising) =>
          linePoints(full, key, rising || chart.hidden.includes(key)),
        topOf: (key, category) => {
          const value = numberOf(category.datum[key])
          return value === null ? null : 1 - fractionOf(value, chart.scale.domain)
        },
      }}
      description={description}
      empty={empty}
      placeholder={placeholder}
      fill={false}
      className={className}
      ref={ref}
      {...figureProps(props, lineChartKeys)}
    >
      {children}
    </LineFamilyFrame>
  )
}

type LineProps = LineSeriesProps

/**
 * One series' line, in the series' colour: a layer of the plot holding the
 * line, a dashed bridge over each missing value, and a dot on each point.
 * When a category is lit, the line steps back, leaving it bright around the
 * category, a window that glides with the axis's pill.
 */
function Line(props: LineProps) {
  return <LineSeries {...props} />
}

export {
  Line,
  LineChart,
  type LineChartProps,
  type LineCurve,
  type LinePoint,
  type LineProps,
  lineExtent,
}
