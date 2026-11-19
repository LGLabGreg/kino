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
  type ChartStack,
  fractionOf,
  hiddenSpans,
  plotPoint,
  rangeOf,
  reachOf,
  seriesSpans,
  type Span,
  spanExtent,
} from '@/registry/lib/chart-math'
import type { LineCurve, LinePoint } from '@/registry/lib/line-path'

/*
 * The Area chart: the Line chart's lines with the area under each filled,
 * side by side or stacked. Its areas, their moves and the window that keeps
 * the lit category bright come from the chart line lib, which the Line chart
 * shares, and its fill from the area fill lib, which the Sparkline shares.
 * Each area's line and baseline move together, so a new range stretches
 * the area, a hidden series folds into the one below it, and the areas
 * above settle onto what is left.
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
 * The rows as the areas draw them: stacked, a missing value counts as
 * nothing, so the areas above it stay whole; side by side it leaves a gap.
 */
function stackedRows(
  rows: readonly ChartDatum[],
  series: readonly string[],
  stack: ChartStack,
): readonly ChartDatum[] {
  if (stack === 'none') return rows
  return rows.map((row) => {
    const out = { ...row }
    for (const key of series) {
      if (typeof out[key] !== 'number' && !rangeOf(out[key])) out[key] = 0
    }
    return out
  })
}

/** Each series' span in every row, the hidden ones collapsed in their place, and the values the shown ones reach. */
function areaSpans(
  rows: readonly ChartDatum[],
  series: readonly string[],
  shown: readonly string[],
  stack: ChartStack,
  stackOf: (key: string) => string,
) {
  const drawn = stackedRows(rows, series, stack)
  const spans = seriesSpans(drawn, shown, stack, stackOf)
  return {
    spans: { ...spans, ...hiddenSpans(drawn, series, shown, stack, stackOf) },
    extent: spanExtent(spans),
  }
}

/** An area's points for the categories shown: its line at the top of its span, its baseline at the bottom, or both along zero when `flat`. */
function areaPoints(
  chart: ChartContextValue,
  spans: readonly (Span | null)[],
  flat: boolean,
): LinePoint[] {
  const zero = zeroY(chart)
  return chart.current.map((category) => {
    const span = spans[category.index] ?? null
    const place = (value: number) => 1 - fractionOf(value, chart.scale.domain)
    return {
      key: category.key,
      x: category.band.start,
      y: flat || !span ? zero : place(span[1]),
      base: flat || !span ? zero : place(span[0]),
      defined: span !== null,
    }
  })
}

/**
 * The chart's root: it lays out the frame its parts draw in, places each
 * category along the plot from edge to edge, and fits the value axis to the
 * areas, always from zero, since an area's size is its value.
 */
function AreaChart(props: AreaChartProps) {
  const {
    config,
    stack = 'none',
    entrance = 'none',
    description,
    empty,
    className,
    children,
    ref,
  } = props
  const stackOf = (key: string) => config[key]?.stack ?? ''
  const { chart, shapes, placeholder, root, phase } = useCategoryChart(props, {
    orientation: 'vertical',
    stack,
    entrance: entrance !== 'none',
    moveProperty: LINE_PROGRESS,
    nice: stack !== 'expand',
    bandOf: pointBand,
    measure: (rows, shown) => areaSpans(rows, Object.keys(config), shown, stack, stackOf),
  })
  const shown = chart.series.filter((key) => !chart.hidden.includes(key))
  const full: ChartContextValue = {
    ...chart,
    // An area's fill fades, so a pattern on it would fade away; its key stays solid.
    patternOf: () => 'solid',
    // The tooltip sits over the highest of the category's areas.
    pointOf: (at) => {
      const category = chart.current[at]
      if (!category) return null
      const top = chart.entered ? reachOf(shapes.spans, shown, category.index) : 0
      return plotPoint(
        category.band,
        fractionOf(top, chart.scale.domain),
        'vertical',
        chart.direction,
      )
    },
  }
  return (
    <LineFamilyFrame
      chart={full}
      root={root}
      family={{
        name: 'area-chart',
        phase,
        entrance,
        pointsOf: (key, rising) => areaPoints(full, shapes.spans[key] ?? [], rising),
        topOf: (key, category) => {
          const span = shapes.spans[key]?.[category.index]
          return span ? 1 - fractionOf(span[1], chart.scale.domain) : null
        },
        // A value given as a range is marked at both ends.
        bottomOf: (key, category) => {
          const span = shapes.spans[key]?.[category.index]
          return span && rangeOf(category.datum[key])
            ? 1 - fractionOf(span[0], chart.scale.domain)
            : null
        },
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
  return <LineSeries {...props} fill />
}

export {
  Area,
  AreaChart,
  type AreaChartProps,
  type AreaProps,
  type LineCurve as AreaCurve,
  areaPoints,
  areaSpans,
}
