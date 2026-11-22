'use client'

import {
  type CategoryChartProps,
  figureProps,
  numberAxis,
  plotPlace,
  useChartActive,
  useDeclared,
  plotFraction,
} from '@/registry/lib/chart-base'
import {
  type CategoryChartInput,
  type ChartCategory,
  type ChartContextValue,
  type ChartPartDeclaration,
  CategoryChartFrame,
  useCartesianChart,
  useChart,
  cartesianSignature,
  cartesianChartKeys,
} from '@/registry/lib/chart-core'
import {
  allWhole,
  type ChartDatum,
  numberOf,
  type XYValue,
} from '@/registry/lib/chart-math'
import { pointMarks } from '@/registry/lib/chart-point-marks'
import { markerAt, type PlacedPoint, PointSeries } from '@/registry/lib/chart-points'
import {
  type ChartFormat,
  forcedSeriesTextColor,
  formatterOf,
  drawingSize,
  plotLayerClassName,
  seriesColor,
} from '@/registry/lib/chart-root'
import type { DomainEnd } from '@/registry/lib/chart-scale'
import {
  placeholderBreatheClassName,
  placeholderFillClassName,
} from '@/registry/lib/placeholder'
import {
  type ComponentProps,
  createContext,
  type CSSProperties,
  use,
  useMemo,
} from 'react'

import { cn } from '@/lib/utils'

/*
 * The Scatter chart: each row a point placed by two values, and with
 * `size`, a bubble whose area is a third. Each series has its colour and a
 * shape of its own, so colour is never the only sign. The point nearest the
 * pointer stays bright while the rest step back, and new data glides every
 * point from where it was to where it goes, so each one can be followed.
 * It is the chart core's XY frame: the x axis, the grid and reference lines
 * read its x scale, and the pointer and the keys find points in two
 * dimensions.
 */

interface ScatterChartProps extends Omit<CategoryChartProps, 'ordered' | 'patterns'> {
  /** The key of each row's value along the x axis. */
  x: string
  /** The key of each row's value up the y axis. */
  y: string
  /** The key of each row's value that sizes its bubble by area; without it, every point is the same size. */
  size?: string
  /**
   * The key of each row's series, a key of the config, which gives the point
   * its colour and shape; without it, every point is the config's first series.
   */
  series?: string
  /** What the x values are: the x axis's title, and in the tooltip and the table; the key by default. */
  xLabel?: string
  /** What the y values are: the y axis's title, and in the tooltip and the table; the key by default. */
  yLabel?: string
  /** What the sizes are, in the tooltip and the table; the key by default. */
  sizeLabel?: string
  /** How x values are written, and the x axis by default; the chart's `format` by default. */
  xFormat?: ChartFormat
  /** How sizes are written; the chart's `format` by default. */
  sizeFormat?: ChartFormat
  /** The values at the ends of the x axis; `'auto'` fits the data. */
  xDomain?: readonly [DomainEnd, DomainEnd]
  /** About how many ticks the x axis marks. */
  xTickCount?: number
}

const scatterChartKeys = [
  ...cartesianChartKeys,
  'x',
  'y',
  'size',
  'series',
  'xLabel',
  'yLabel',
  'sizeLabel',
  'xFormat',
  'sizeFormat',
  'xDomain',
  'xTickCount',
]

/** A point's radius, in px, without a `size`. */
const POINT_RADIUS = 5

/** The smallest and largest bubble's radius, in px. */
const BUBBLE_RADIUS = { min: 4, max: 22 } as const

/**
 * A bubble's radius in px for `value` among sizes up to `largest`: its
 * area in proportion, as a bubble is read, but never under the smallest
 * that still reads as a mark. A missing size, or one of zero or less, takes
 * the smallest.
 */
function bubbleRadius(value: number | null, largest: number): number {
  if (value === null || value <= 0 || largest <= 0) return BUBBLE_RADIUS.min
  return Math.max(BUBBLE_RADIUS.min, BUBBLE_RADIUS.max * Math.sqrt(value / largest))
}

/**
 * The rows that are points: those with a number for both `x` and `y`, since
 * a point needs both, in a series the config names, by `seriesOf`, so a row
 * with a mistyped series is left out rather than drawn as another's. Each
 * holds its `y` under its series' key too, where the frame reads a series'
 * values, as it does in rows that hold every series.
 */
function scatterRows(
  data: readonly ChartDatum[],
  x: string,
  y: string,
  seriesOf: (row: ChartDatum) => string | null = () => '',
): readonly ChartDatum[] {
  return data.flatMap((row) => {
    const series = seriesOf(row)
    if (numberOf(row[x]) === null || numberOf(row[y]) === null || series === null)
      return []
    return [{ ...row, [series]: row[y] }]
  })
}

/**
 * The series a row's point is in: its `series` value, or with no `series`
 * key, the config's only or first series; null when the config has no such
 * series.
 */
function pointSeries(
  row: ChartDatum,
  seriesKey: string | undefined,
  keys: readonly string[],
): string | null {
  const named = seriesKey === undefined ? keys[0] : String(row[seriesKey])
  return named !== undefined && keys.includes(named) ? named : null
}

/**
 * The order points are drawn in, from the back: the largest first, so a
 * small bubble is never hidden behind a large one, then in data order.
 */
function drawOrder(radii: readonly number[]): number[] {
  return radii
    .map((radius, index) => ({ radius, index }))
    .toSorted((a, b) => b.radius - a.radius || a.index - b.index)
    .map(({ index }) => index)
}

interface ScatterContextValue {
  /** A point's two values, from its row: a leaving one keeps the ones it had. */
  valueOf: (category: ChartCategory) => XYValue
  /** Each point's series, by its category's key. */
  seriesOf: (category: ChartCategory) => string
  /** Each point's radius in px, by its category's key. */
  radiusOf: (category: ChartCategory) => number
  /** Where each point sits from the back, by its category's key. */
  depthOf: (key: string) => number
  markerOf: (key: string) => string
}

const ScatterContext = createContext<ScatterContextValue | null>(null)

function useScatter() {
  const scatter = use(ScatterContext)
  if (!scatter) throw new Error('`Scatter` goes inside a `ScatterChart`.')
  return scatter
}

/**
 * The chart's root: it places each row's point by its two values, lays out
 * the frame its parts draw in, and keeps the largest bubble clear of the
 * plot's edges.
 */
function ScatterChart(props: ScatterChartProps) {
  const {
    data,
    config,
    x,
    y,
    size,
    series: seriesKey,
    xLabel = x,
    yLabel = y,
    sizeLabel = size ?? '',
    format,
    xFormat,
    sizeFormat,
    xDomain,
    xTickCount,
    allowDecimals,
    locale,
    description,
    empty,
    className,
    children,
    ref,
  } = props
  const keys = Object.keys(config)
  // Every row drawn is in a series the config names, which `scatterRows` makes sure of.
  const seriesOfRow = (row: ChartDatum) => pointSeries(row, seriesKey, keys) ?? ''
  const rows = useMemo(
    () =>
      scatterRows(data, x, y, (row) => pointSeries(row, seriesKey, Object.keys(config))),
    [data, x, y, seriesKey, config],
  )
  // Sizes count every row, the hidden series too, so hiding one never resizes the rest.
  const largest = size ? Math.max(0, ...rows.map((row) => numberOf(row[size]) ?? 0)) : 0
  const radiusOfRow = (row: ChartDatum) =>
    size ? bubbleRadius(numberOf(row[size]), largest) : POINT_RADIUS
  const { chart, placeholder } = useCartesianChart(
    {
      ...props,
      data: rows,
      allowDecimals: allowDecimals ?? !allWhole(rows, [y]),
    },
    {
      kinds: [pointMarks],
      orientation: 'vertical',
      stack: 'none',
      entrance: false,
      seriesOfRow,
      keyOf: (row) => `${seriesOfRow(row)}\u0000${String(row[props.index])}`,
      inset: size ? BUBBLE_RADIUS.max + 2 : POINT_RADIUS + 2,
      // Every point is one row, placed by both values rather than in a band.
      x: {
        key: x,
        domain: xDomain,
        tickCount: xTickCount,
        allowDecimals: !allWhole(rows, [x]),
        format: xFormat,
        label: xLabel,
      },
      y: { zero: false, label: yLabel },
    },
  )
  const xText = formatterOf(locale, xFormat ?? format)
  const sizeText = formatterOf(locale, sizeFormat ?? format)
  const several = keys.length > 1
  const seriesName = (key: string) => {
    const label = config[key]?.label
    return typeof label === 'string' ? label : key
  }
  const radii = chart.categories.map((category) => radiusOfRow(category.datum))
  const depth = new Map(
    drawOrder(radii).map((at, place) => [chart.categories[at]?.key ?? '', place]),
  )
  const scatter: ScatterContextValue = {
    valueOf: (category) => ({
      x: numberOf(category.datum[x]) ?? 0,
      y: numberOf(category.datum[y]) ?? 0,
    }),
    seriesOf: (category) => seriesOfRow(category.datum),
    radiusOf: (category) => radiusOfRow(category.datum),
    depthOf: (key) => depth.get(key) ?? 0,
    markerOf: (key) => markerAt(Math.max(0, keys.indexOf(key))),
  }
  // What a point holds, in the order it is read: its series, then each value.
  const valuesOf = (category: ChartCategory) => {
    const values = [
      [xLabel, xText(numberOf(category.datum[x]) ?? 0)],
      [yLabel, chart.valueText(numberOf(category.datum[y]) ?? 0)],
    ]
    if (size) {
      const value = numberOf(category.datum[size])
      values.push([sizeLabel, value === null ? chart.messages.noValue : sizeText(value)])
    }
    return values
  }
  const { width, height } = drawingSize(chart.plotSize)
  const full: CategoryChartInput = {
    ...chart,
    // A shape, not a pattern, tells series apart.
    patternOf: () => 'solid',
    markerOf: scatter.markerOf,
    // The tooltip sits over the point, clear of its bubble.
    pointOf: (at) => {
      const point = chart.xyOf(at)
      const category = chart.current[at]
      if (!point || !category) return null
      const place = plotPlace(point.place, chart.direction)
      return {
        x: plotFraction(place.x, width, chart.inset),
        y:
          plotFraction(place.y, height, chart.inset) -
          (height === 0 ? 0 : radiusOfRow(category.datum) / height),
        side: 'top',
      }
    },
    describe: (at) => {
      const category = chart.current[at]
      if (!category) return ''
      const values = valuesOf(category).map(([name, value]) => `${name} ${value}`)
      return [several ? seriesName(seriesOfRow(category.datum)) : null, ...values]
        .filter(Boolean)
        .join(', ')
    },
    table: {
      columns: [
        ...(several ? [chart.messages.series] : []),
        xLabel,
        yLabel,
        ...(size ? [sizeLabel] : []),
      ],
      cells: (category) => [
        ...(several ? [seriesName(seriesOfRow(category.datum))] : []),
        ...valuesOf(category).map(([, value]) => value ?? ''),
      ],
    },
    tooltipContent: (at) => (
      <ScatterTooltipContent
        index={at}
        values={(category) => valuesOf(category)}
        seriesName={several ? seriesName : undefined}
      />
    ),
  }
  return (
    <ScatterContext value={scatter}>
      <CategoryChartFrame
        chart={full}
        ref={ref}
        slot='scatter-chart'
        description={description}
        empty={empty}
        className={className}
        placeholder={placeholder && <ScatterPlaceholder />}
        {...figureProps(props, scatterChartKeys)}
      >
        {children}
      </CategoryChartFrame>
    </ScatterContext>
  )
}

/**
 * Where a point with `value` sits on the plot, as fractions of it from its
 * physical left and its top: a leaving one keeps the values it had, placed
 * on the axes as they are now.
 */
function pointPlace(chart: ChartContextValue, value: XYValue): XYValue {
  const along = numberAxis(chart, 'x')
  if (!along) throw new Error('A scatter places its points along an x axis of numbers.')
  return plotPlace(
    { x: along.scale.place(value.x), y: chart.frame.y.value.scale.place(value.y) },
    chart.direction,
  )
}

/**
 * A point's tooltip: its name, its series beside its shape when the chart
 * has several, and each of its values.
 */
function ScatterTooltipContent({
  index,
  values,
  seriesName,
}: {
  index: number
  values: (category: ChartCategory) => string[][]
  seriesName?: (key: string) => string
}) {
  const chart = useChart()
  const scatter = useScatter()
  const category = chart.current[index]
  if (!category) return null
  const key = scatter.seriesOf(category)
  return (
    // The tooltip sits outside the chart, so it carries the chart's id for its colours.
    <div data-chart={chart.id} className='grid min-w-36 gap-1'>
      <div className='font-medium'>{chart.categoryText(category.value)}</div>
      {seriesName && (
        <div className='flex items-center gap-2'>
          <svg
            aria-hidden
            viewBox='-1.2 -1.2 2.4 2.4'
            className={cn(
              'size-2.5 shrink-0 fill-(--swatch)',
              forcedSeriesTextColor(chart.series.indexOf(key)),
              'forced-colors:fill-current',
            )}
            style={{ '--swatch': seriesColor(key) } as CSSProperties}
          >
            <path d={scatter.markerOf(key)} />
          </svg>
          <span className='text-background/75 min-w-0 flex-1 truncate forced-colors:text-[CanvasText]'>
            {seriesName(key)}
          </span>
        </div>
      )}
      {/* One grid, so the values line up from row to row. */}
      <div className='grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1'>
        {values(category).map(([name, value]) => (
          <div key={name} className='col-span-full grid grid-cols-subgrid'>
            <span className='text-background/75 min-w-0 truncate forced-colors:text-[CanvasText]'>
              {name}
            </span>
            {/* A value with a unit reads in its own order whatever the page's direction. */}
            <span dir='auto' className='text-end font-medium tabular-nums'>
              {value}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

Scatter.declare = ({ dataKey }: ScatterProps): ChartPartDeclaration => ({
  series: { key: dataKey, mark: 'point' },
})

/**
 * One series' points: a layer of the plot holding a point for each row of
 * the series, in its colour and shape, sized by `size` as a bubble. While a
 * point is lit, the layer steps back as one, a single filter whatever the
 * number of points, and the lit point is drawn again over every series, so
 * it stays bright and whole. New data glides each point to its new place.
 */
type ScatterProps = Omit<ComponentProps<'div'>, 'children'> & {
  /** The series' key in the config: the rows of this series are its points. */
  dataKey: string
}

function Scatter(props: ScatterProps) {
  const { dataKey, ...rest } = props
  useDeclared('Scatter', Scatter.declare(props), cartesianSignature)
  const chart = useChart()
  const scatter = useScatter()
  const { spotlit } = useChartActive()
  if (chart.status === 'empty') return null
  const placed = (category: ChartCategory): PlacedPoint => ({
    key: category.key,
    ...pointPlace(chart, scatter.valueOf(category)),
    radius: scatter.radiusOf(category),
    depth: scatter.depthOf(category.key),
    leaving: category.leaving,
  })
  const litNow = spotlit === null ? undefined : chart.current[spotlit]
  const lit =
    litNow !== undefined && !litNow.leaving && scatter.seriesOf(litNow) === dataKey
      ? { ...placed(litNow), depth: 0 }
      : undefined
  return (
    <PointSeries
      name='scatter-chart'
      dataKey={dataKey}
      points={chart.categories
        .filter((category) => scatter.seriesOf(category) === dataKey)
        .map(placed)}
      lit={lit}
      seriesIndex={chart.series.indexOf(dataKey)}
      marker={scatter.markerOf(dataKey)}
      dim={spotlit !== null || (chart.emphasis !== null && chart.emphasis !== dataKey)}
      around={(marks) => marks}
      {...rest}
    />
  )
}

/** The placeholder's points, as fractions of the plot from its left and top: a loose rising cloud. */
const PLACEHOLDER_POINTS = [
  [0.08, 0.78],
  [0.16, 0.62],
  [0.22, 0.72],
  [0.3, 0.52],
  [0.36, 0.66],
  [0.44, 0.46],
  [0.5, 0.58],
  [0.58, 0.38],
  [0.64, 0.5],
  [0.72, 0.3],
  [0.8, 0.42],
  [0.88, 0.22],
] as const

/** The placeholder while the data loads: a loose cloud of points, breathing slowly. */
function ScatterPlaceholder() {
  return (
    <div
      data-slot='scatter-chart-placeholder'
      aria-hidden
      className={cn(
        plotLayerClassName,
        'z-10 transition-opacity duration-(--motion-enter-duration) ease-(--motion-enter-easing) group-data-mounted/chart:starting:opacity-0',
      )}
    >
      <div className={cn('absolute inset-0', placeholderBreatheClassName)}>
        {PLACEHOLDER_POINTS.map(([x, y]) => (
          <span
            key={`${x}-${y}`}
            className={cn(
              'absolute size-2.5 -translate-1/2 rounded-full rtl:translate-x-1/2',
              placeholderFillClassName,
            )}
            style={{ insetInlineStart: `${x * 100}%`, top: `${y * 100}%` }}
          />
        ))}
      </div>
    </div>
  )
}

export {
  Scatter,
  ScatterChart,
  type ScatterChartProps,
  bubbleRadius,
  drawOrder,
  markerAt,
  pointSeries,
  scatterRows,
}
