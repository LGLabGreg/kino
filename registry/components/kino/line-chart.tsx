'use client'

import { figureProps, seriesWords, useDeclared } from '@/registry/lib/chart-base'
import {
  type CartesianChartProps,
  cartesianChartKeys,
  cartesianSignature,
  cartesianWords,
  type ChartPartDeclaration,
  type LiveChartProps,
  useCartesianChart,
} from '@/registry/lib/chart-cartesian'
import {
  framePoints,
  frameRest,
  frameTop,
  LineFamilyFrame,
  LinePlaceholder,
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

interface LineChartProps extends CartesianChartProps, LiveChartProps {
  /**
   * How the lines arrive the first time the chart comes into view: rising
   * from zero, drawn along from the reading start, or simply there, the
   * default, since a page that loads doesn't animate into place.
   */
  entrance?: 'rise' | 'draw' | 'none'
  /** Keeps zero on the value axis, so a line's rise and fall read in proportion; off fits the axis to the data. */
  zero?: boolean
}

const lineChartKeys = [...cartesianChartKeys, 'entrance', 'zero']

/** Every series at a stop, read along x. */
const X_BROWSE = { kind: 'x' } as const

/** The legend's keys are plain swatches. */
function noMarker() {
  return null
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
  const made = useCartesianChart(props, {
    kinds: [lineMarks],
    orientation: 'vertical',
    stack: 'none',
    entrance: entrance !== 'none',
    y: { zero },
  })
  const { model, placeholder, phase } = made
  // A line has no fill to pattern, so its key in the legend and the tooltip stays solid too.
  const chart = { ...made.chart, patternOf: () => 'solid' as const }
  const cartesian = { ...made, chart }
  return (
    <LineFamilyFrame
      chart={cartesian}
      markerOf={noMarker}
      // The tooltip sits over the highest of the stop's points.
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
        name: 'line-chart',
        phase,
        entrance,
        // Hidden, or waiting to rise, a line lies flat along its baseline.
        pointsOf: (key, rising) =>
          framePoints(chart, model, key, rising || chart.hidden.includes(key), false),
        topOf: (key, stop) => frameTop(model, key, stop),
        restOf: (key) => frameRest(model, key),
      }}
      description={description}
      empty={empty}
      placeholder={placeholder && <LinePlaceholder name='line-chart' fill={false} />}
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
  useDeclared('Line', Line.declare(props), cartesianSignature)
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
