'use client'

import {
  type CategoryChartProps,
  type ChartCategory,
  type ChartContextValue,
  type ChartFormat,
  figureProps,
  forcedSeriesTextColor,
  formatterOf,
  CategoryChartFrame,
  drawingSize,
  plotLayerClassName,
  seriesColor,
  useCategoryChart,
  useChart,
  useChartActive,
  xyPlace,
  plotOffset,
  plotFraction,
} from '@/registry/lib/chart-core'
import {
  allWhole,
  type ChartDatum,
  type DomainEnd,
  numberOf,
  type Span,
  type XYValue,
} from '@/registry/lib/chart-math'
import {
  placeholderBreatheClassName,
  placeholderFillClassName,
} from '@/registry/lib/placeholder'
import {
  type ComponentProps,
  createContext,
  type CSSProperties,
  memo,
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
 * The shapes each series' points take, in series order, as SVG paths in a
 * box 2 across: shapes of about the same weight, told apart at a glance and
 * in grey.
 */
const markers = [
  // A circle.
  'M1,0A1,1,0,1,1,-1,0A1,1,0,1,1,1,0Z',
  // A square.
  'M-0.85,-0.85H0.85V0.85H-0.85Z',
  // A triangle, pointing up, centred on its height.
  'M0,-0.975L1.126,0.975H-1.126Z',
  // A diamond.
  'M0,-1.15L1.15,0L0,1.15L-1.15,0Z',
  // A plus.
  'M-0.36,-1H0.36V-0.36H1V0.36H0.36V1H-0.36V0.36H-1V-0.36H-0.36Z',
] as const

/** The shape of the series at `slot`: the five in turn. */
function markerAt(slot: number): string {
  return markers[slot % markers.length]!
}

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
 * with a mistyped series is left out rather than drawn as another's.
 */
function scatterRows(
  data: readonly ChartDatum[],
  x: string,
  y: string,
  seriesOf: (row: ChartDatum) => string | null = () => '',
): readonly ChartDatum[] {
  return data.filter(
    (row) =>
      numberOf(row[x]) !== null && numberOf(row[y]) !== null && seriesOf(row) !== null,
  )
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
  const { chart, root, placeholder } = useCategoryChart(
    {
      ...props,
      data: rows,
      allowDecimals: allowDecimals ?? !allWhole(rows, [y]),
    },
    {
      orientation: 'vertical',
      stack: 'none',
      entrance: false,
      moveProperty: 'opacity',
      nice: true,
      // Every point is one category, but none sits in a band: the XY frame places them.
      bandOf: () => ({ start: 0, size: 0 }),
      seriesOfRow,
      keyOf: (row) => `${seriesOfRow(row)}\u0000${String(row[props.index])}`,
      inset: size ? BUBBLE_RADIUS.max + 2 : POINT_RADIUS + 2,
      x: {
        domain: xDomain,
        tickCount: xTickCount,
        allowDecimals: !allWhole(rows, [x]),
        format: xFormat,
        labels: { x: xLabel, y: yLabel },
      },
      measure: (drawn) => {
        const points: XYValue[] = drawn.map((row) => ({
          x: numberOf(row[x]) ?? 0,
          y: numberOf(row[y]) ?? 0,
        }))
        return {
          extent: valueExtent(points.map((point) => point.y)),
          xy: {
            extent: valueExtent(points.map((point) => point.x)),
            points,
          },
        }
      },
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
  const full: ChartContextValue = {
    ...chart,
    // A shape, not a pattern, tells series apart.
    patternOf: () => 'solid',
    markerOf: scatter.markerOf,
    // The tooltip sits over the point, clear of its bubble.
    pointOf: (at) => {
      const point = chart.xy?.points[at]
      const category = chart.current[at]
      if (!point || !category) return null
      const place = xyPlace(chart, point)
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
        root={root}
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
 * The lowest and highest of `values`, or 0 to 1 with none. Values that are
 * all the same get a range around them, a tenth of their size each way, so
 * a single point sits in the middle of the plot rather than in its corner.
 */
function valueExtent(values: readonly number[]): Span {
  if (values.length === 0) return [0, 1]
  const low = Math.min(...values)
  const high = Math.max(...values)
  if (low !== high) return [low, high]
  const room = Math.abs(low) / 10 || 1
  return [low - room, high + room]
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

/**
 * One series' points: a layer of the plot holding a point for each row of
 * the series, in its colour and shape, sized by `size` as a bubble. While a
 * point is lit, the layer steps back as one, a single filter whatever the
 * number of points, and the lit point is drawn again over every series, so
 * it stays bright and whole. New data glides each point to its new place.
 */
function Scatter({
  dataKey,
  className,
  ...props
}: Omit<ComponentProps<'div'>, 'children'> & {
  /** The series' key in the config: the rows of this series are its points. */
  dataKey: string
}) {
  const chart = useChart()
  const scatter = useScatter()
  const { spotlit } = useChartActive()
  if (chart.status === 'empty') return null
  const slot = chart.series.indexOf(dataKey)
  const marker = scatter.markerOf(dataKey)
  const lit = spotlit === null ? undefined : chart.current[spotlit]
  const shownLit =
    lit !== undefined && !lit.leaving && scatter.seriesOf(lit) === dataKey
      ? lit
      : undefined
  const dim = spotlit !== null || (chart.emphasis !== null && chart.emphasis !== dataKey)
  const style = { '--point-color': seriesColor(dataKey) } as CSSProperties
  return (
    <>
      <div
        data-slot='scatter-chart-series'
        data-series={dataKey}
        data-dim={dim ? '' : undefined}
        aria-hidden
        className={cn(
          plotLayerClassName,
          'z-10 transition-[filter] duration-(--motion-layout-duration) ease-(--motion-layout-fade-easing) not-forced-colors:data-dim:[filter:saturate(var(--scatter-chart-dim,0.3))]',
          className,
        )}
        style={style}
        {...props}
      >
        {chart.categories.map((category) => {
          if (scatter.seriesOf(category) !== dataKey) return null
          const place = xyPlace(chart, scatter.valueOf(category))
          return (
            <ScatterPoint
              key={category.key}
              x={place.x}
              y={place.y}
              radius={scatter.radiusOf(category)}
              marker={marker}
              slot={slot}
              depth={scatter.depthOf(category.key)}
              leaving={category.leaving}
            />
          )
        })}
      </div>
      {shownLit && (
        <div
          data-slot='scatter-chart-lit'
          aria-hidden
          className={cn(plotLayerClassName, 'z-11')}
          style={style}
        >
          <ScatterPoint
            key={shownLit.key}
            {...xyPlace(chart, scatter.valueOf(shownLit))}
            radius={scatter.radiusOf(shownLit)}
            marker={marker}
            slot={slot}
            depth={0}
            leaving={false}
            still
          />
        </div>
      )}
    </>
  )
}

/**
 * One point: placed by `x` and `y`, fractions of the plot from its left
 * and top, and drawn as the series' shape at `radius` px. It glides to a
 * new place, grows in as it arrives and shrinks away as it leaves; a
 * `still` one, the lit point's copy, is simply there. Memoised, so lighting
 * a point redraws none of them.
 */
const ScatterPoint = memo(function ScatterPoint({
  x,
  y,
  radius,
  marker,
  slot,
  depth,
  leaving,
  still = false,
}: {
  x: number
  y: number
  radius: number
  marker: string
  slot: number
  depth: number
  leaving: boolean
  still?: boolean
}) {
  return (
    <span
      data-slot='scatter-chart-point'
      data-leaving={leaving ? '' : undefined}
      data-still={still ? '' : undefined}
      className={cn(
        // A point that leaves goes on the exit role, faster than it came and with no bounce.
        'group/point absolute top-0 left-0 size-0 text-(--point-color) [translate:var(--point-at)] transition-none group-data-mounted/chart:transition-[translate,opacity] duration-(--motion-layout-duration) ease-[var(--motion-layout-easing),var(--motion-layout-fade-easing)] group-data-mounted/chart:starting:opacity-0 data-leaving:opacity-0 data-leaving:duration-(--motion-exit-duration) data-leaving:ease-[var(--motion-exit-easing),var(--motion-exit-fade-easing)] data-still:transition-none! motion-reduce:group-data-mounted/chart:transition-[opacity] motion-reduce:ease-(--motion-layout-fade-easing) motion-reduce:data-leaving:ease-(--motion-exit-fade-easing)',
        forcedSeriesTextColor(slot),
      )}
      style={
        {
          '--point-at': `${plotOffset(x, 'cqw')} ${plotOffset(y, 'cqh')}`,
          zIndex: depth,
        } as CSSProperties
      }
    >
      <svg aria-hidden width={1} height={1} className='absolute overflow-visible'>
        <path
          d={marker}
          vectorEffect='non-scaling-stroke'
          // The page's colour around each shape keeps overlapping points apart. Under reduced
          // motion a leaving shape keeps its size, so it fades out as an arriving one fades in.
          className='stroke-background fill-current [stroke-width:1.5] [transform:scale(var(--point-radius))] transition-none group-data-mounted/chart:transition-[transform] duration-(--motion-layout-duration) ease-(--motion-layout-easing) group-data-mounted/chart:starting:[transform:scale(0)] group-data-leaving/point:[transform:scale(0)] group-data-leaving/point:duration-(--motion-exit-duration) group-data-leaving/point:ease-(--motion-exit-easing) group-data-still/point:transition-none! motion-reduce:group-data-mounted/chart:transition-none motion-reduce:group-data-leaving/point:[transform:scale(var(--point-radius))] forced-colors:stroke-[Canvas]'
          style={{ '--point-radius': radius } as CSSProperties}
        />
      </svg>
    </span>
  )
})

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
  valueExtent,
}
