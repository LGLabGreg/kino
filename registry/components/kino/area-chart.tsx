'use client'

import { areaMarks } from '@/registry/lib/chart-area-marks'
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
import { type ChartStack, plotPoint, rangeOf } from '@/registry/lib/chart-math'
import type { LineCurve } from '@/registry/lib/line-path'

/*
 * The Area chart: the Line chart's lines with the area under each filled,
 * side by side or stacked. Its areas, their moves and the window that keeps
 * the lit category bright come from the chart line lib, which the Line chart
 * shares, and its fill from the area fill lib, which the Sparkline shares.
 * Each area's line and baseline move together, so a new range stretches
 * the area, a hidden series folds into the one below it, and the areas
 * above settle onto what is left. A series the config draws as a `line`,
 * such as last year's to compare with, is a `Line` among the areas.
 */

interface AreaChartProps extends CartesianChartProps, LiveChartProps {
  /**
   * How the areas of one category combine: each from zero, overlapping, the
   * default; stacked on each other in the order of the config; or stacked
   * to fill the axis as shares of their total.
   */
  stack?: ChartStack
  /**
   * How the areas arrive the first time the chart comes into view: rising
   * from zero, drawn along from the reading start, or simply there, the
   * default, since a page that loads doesn't animate into place.
   */
  entrance?: 'rise' | 'draw' | 'none'
}

const areaChartKeys = [...cartesianChartKeys, 'stack', 'entrance']

/** Every series at a stop, read along x. */
const X_BROWSE = { kind: 'x' } as const

/** The legend's keys are plain swatches. */
function noMarker() {
  return null
}

/**
 * The chart's root: it lays out the frame its parts draw in, places each
 * category along the plot from edge to edge, and fits the value axis to the
 * areas, always from zero, since an area's size is its value.
 */
function AreaChart(props: AreaChartProps) {
  const {
    stack = 'none',
    entrance = 'none',
    description,
    empty,
    className,
    children,
    ref,
  } = props
  const made = useCartesianChart(props, {
    kinds: [areaMarks, lineMarks],
    orientation: 'vertical',
    stack,
    entrance: entrance !== 'none',
  })
  const { model, placeholder, phase } = made
  // An area's fill fades, so a pattern on it would fade away; its key stays solid.
  const chart = { ...made.chart, patternOf: () => 'solid' as const }
  const cartesian = { ...made, chart }
  const isLine = (key: string) => model.markOf(key) === 'line'
  return (
    <LineFamilyFrame
      chart={cartesian}
      markerOf={noMarker}
      // The tooltip sits over the highest of the stop's areas.
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
        name: 'area-chart',
        phase,
        entrance,
        // A hidden area folds into the one below it; a hidden line lies flat, as the Line chart's.
        pointsOf: (key, rising) =>
          framePoints(
            chart,
            model,
            key,
            rising || (isLine(key) && chart.hidden.includes(key)),
            !isLine(key),
          ),
        topOf: (key, stop) => frameTop(model, key, stop),
        // A value given as a range is marked at both ends.
        bottomOf: (key, stop) =>
          !isLine(key) && rangeOf(chart.valueOf(key, stop))
            ? frameTop(model, key, stop, true)
            : null,
        restOf: (key) => frameRest(model, key),
      }}
      description={description}
      empty={empty}
      placeholder={placeholder && <LinePlaceholder name='area-chart' fill />}
      className={className}
      ref={ref}
      {...figureProps(props, areaChartKeys)}
    >
      {children}
    </LineFamilyFrame>
  )
}

type AreaProps = Omit<LineSeriesProps, 'forecastFrom' | 'connectNulls' | 'dashed'>

/**
 * One series' area, in the series' colour: a layer of the plot holding its
 * fill, the line along its top, and a dot on each point. When a category is
 * lit, the area steps back, leaving it bright around the category, a window
 * that glides with the axis's pill.
 */
function Area(props: AreaProps) {
  useDeclared('Area', Area.declare(props), cartesianSignature)
  return <LineSeries {...props} fill />
}

Area.declare = ({ dataKey }: AreaProps): ChartPartDeclaration => ({
  series: { key: dataKey, mark: 'area' },
})

export {
  Area,
  AreaChart,
  type AreaChartProps,
  type AreaProps,
  type LineCurve as AreaCurve,
}
