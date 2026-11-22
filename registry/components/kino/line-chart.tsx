'use client'

import {
  type CategoryChartInput,
  type CartesianChartProps,
  type ChartPartDeclaration,
  figureProps,
  useCartesianChart,
  useDeclared,
} from '@/registry/lib/chart-core'
import {
  framePoints,
  frameRest,
  frameTop,
  LineFamilyFrame,
  LineSeries,
  type LineSeriesProps,
} from '@/registry/lib/chart-line'
import { lineMarks } from '@/registry/lib/chart-line-marks'
import { plotPoint } from '@/registry/lib/chart-math'
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

interface LineChartProps extends CartesianChartProps {
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
  const { chart, model, placeholder, phase } = useCartesianChart(props, {
    kinds: [lineMarks],
    orientation: 'vertical',
    stack: 'none',
    entrance: entrance !== 'none',
    y: { zero },
  })
  const full: CategoryChartInput = {
    ...chart,
    // A line has no fill to pattern, so its key in the legend and the tooltip stays solid too.
    patternOf: () => 'solid',
    // The tooltip sits over the highest of the category's points.
    pointOf: (at) => {
      const category = chart.current[at]
      if (!category) return null
      const along = chart.entered ? model.reach(category.index) : null
      return plotPoint(
        category.band,
        along ?? model.baselines.value,
        'vertical',
        chart.direction,
      )
    },
  }
  return (
    <LineFamilyFrame
      chart={full}
      family={{
        name: 'line-chart',
        phase,
        entrance,
        // Hidden, or waiting to rise, a line lies flat along its baseline.
        pointsOf: (key, rising) =>
          framePoints(full, model, key, rising || chart.hidden.includes(key), false),
        topOf: (key, category) => frameTop(model, key, category),
        restOf: (key) => frameRest(model, key),
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
  useDeclared('Line', Line.declare(props))
  return <LineSeries {...props} />
}

// A line is its series, drawn as one; the tooltip, the slider and the table say which values
// are projected.
Line.declare = ({ dataKey, forecastFrom }: LineProps): ChartPartDeclaration => ({
  series: { key: dataKey, mark: 'line' },
  ...(forecastFrom === undefined
    ? {}
    : { forecast: { series: dataKey, from: forecastFrom } }),
})

export {
  Line,
  LineChart,
  type LineChartProps,
  type LineCurve,
  type LinePoint,
  type LineProps,
}
