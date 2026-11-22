'use client'

import { areaMarks } from '@/registry/lib/chart-area-marks'
import {
  type CategoryChartInput,
  type CategoryChartProps,
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

interface AreaChartProps extends CategoryChartProps {
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

const areaChartKeys = ['stack', 'entrance']

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
  const { chart, model, placeholder, phase } = useCartesianChart(props, {
    kinds: [areaMarks, lineMarks],
    orientation: 'vertical',
    stack,
    entrance: entrance !== 'none',
  })
  const full: CategoryChartInput = {
    ...chart,
    // An area's fill fades, so a pattern on it would fade away; its key stays solid.
    patternOf: () => 'solid',
    // The tooltip sits over the highest of the category's areas.
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
  const isLine = (key: string) => model.markOf(key) === 'line'
  return (
    <LineFamilyFrame
      chart={full}
      family={{
        name: 'area-chart',
        phase,
        entrance,
        // A hidden area folds into the one below it; a hidden line lies flat, as the Line chart's.
        pointsOf: (key, rising) =>
          framePoints(
            full,
            model,
            key,
            rising || (isLine(key) && chart.hidden.includes(key)),
            !isLine(key),
          ),
        topOf: (key, category) => frameTop(model, key, category),
        // A value given as a range is marked at both ends.
        bottomOf: (key, category) =>
          !isLine(key) && rangeOf(category.datum[key])
            ? frameTop(model, key, category, true)
            : null,
        restOf: (key) => frameRest(model, key),
      }}
      description={description}
      empty={empty}
      placeholder={placeholder}
      fill
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
  useDeclared('Area', Area.declare(props))
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
