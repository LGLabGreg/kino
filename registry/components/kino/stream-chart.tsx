'use client'

import { ChartYAxis } from '@/registry/components/kino/chart'
import { areaPathThrough } from '@/registry/lib/area-fill'
import {
  type StreamOffset,
  streamExtent,
  streamMarks,
  streamOrder,
} from '@/registry/lib/chart-area-marks'
import {
  type CategoryChartProps,
  figureProps,
  seriesWords,
  useChartActive,
  useDeclared,
} from '@/registry/lib/chart-base'
import {
  CartesianChartFrame,
  type CartesianChartProps,
  cartesianChartKeys,
  cartesianSignature,
  type CartesianStop,
  cartesianWords,
  type ChartPartDeclaration,
  useCartesian,
  useCartesianChart,
} from '@/registry/lib/chart-cartesian'
import { type CartesianModel, markLayer } from '@/registry/lib/chart-frame'
import {
  EntranceWipe,
  framePoints,
  litMaskClassName,
  litWindow,
  litWindowClassName,
  litWindowStyle,
  masked,
  maskedFrame,
  mirror,
  registerLineProperties,
  steppedMaskClassName,
  unitFrame,
} from '@/registry/lib/chart-line'
import { numberOf, rowValues, stepThrough } from '@/registry/lib/chart-math'
import {
  type ChartItem,
  ChartNumber,
  type ChartPoint,
  forcedSeriesColor,
  forcedSeriesTextColor,
  type MoveRole,
  plotLayerClassName,
  seriesColor,
  swatchClassName,
  swatchStyle,
  useFromRest,
  usePointsMove,
} from '@/registry/lib/chart-root'
import { bandCentre } from '@/registry/lib/chart-scale'
import {
  alignLines,
  type LinePoint,
  pathThrough,
  pointsAt,
  sampleLine,
} from '@/registry/lib/line-path'
import { numberFormatter } from '@/registry/lib/number-format'
import { placeholderBreatheClassName } from '@/registry/lib/placeholder'
import { Swap } from '@/registry/lib/swap'
import {
  Children,
  type ComponentProps,
  createContext,
  type CSSProperties,
  Fragment,
  isValidElement,
  type ReactNode,
  type RefObject,
  use,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import { cn } from '@/lib/utils'

/*
 * The Stream chart: every series stacked into one stream that swells and
 * thins around a centre line, such as income by region over months. Its
 * layers stack in d3's inside-out order, held from the first data it draws,
 * so new rows or a hidden layer never swap them. With callouts, the layer
 * under the pointer, or the one Up and Down reach, stays bright while the
 * rest step back; a guide follows the stop under the pointer or the keys,
 * and the callouts above and below the plot give the stream's total there
 * and the lit layer's value. Without them, the pointer lights the whole
 * stop, as the Area chart does, for the tooltip to read out. A soft glow of
 * the layers' colours sits behind them.
 *
 * Each layer is drawn through its points in fractions of the plot, as the
 * Area chart's are, and moves on the chart's clock: new data on `layout`, a
 * new offset on `morph`, so the layers' shared edges stay shared on every
 * frame. Layers run between their points as an S, d3's bump, or straight:
 * both keep each edge between the edges beside it, so no layer ever turns
 * inside out between two stops.
 */

/** How a layer runs from one value to the next: an S, level at each value, or straight. */
type StreamCurve = 'bump' | 'linear'

interface StreamChartProps extends Omit<CategoryChartProps, 'patterns'> {
  indexType?: CartesianChartProps['indexType']
  timeZone?: CartesianChartProps['timeZone']
  /**
   * Where the layers sit: centred so the stream's edges change as little as
   * they can, the default; centred on a line; or stacked up from zero,
   * which takes a value axis.
   */
  offset?: StreamOffset
  /** How each layer runs from one value to the next: an S, level at each value, the default, or straight. */
  curve?: StreamCurve
  /**
   * How the layers arrive the first time the chart comes into view: growing
   * out of the stream's centre line, drawn along from the reading start, or
   * simply there, the default, since a page that loads doesn't animate into
   * place.
   */
  entrance?: 'rise' | 'draw' | 'none'
  /** A soft glow of the layers' colours behind them; on by default. */
  glow?: boolean
}

const streamChartKeys = [...cartesianChartKeys, 'offset', 'curve', 'entrance', 'glow']

/** What the stream's own parts read. */
interface StreamContextValue {
  curve: StreamCurve
  entrance: 'rise' | 'draw' | 'none'
  /** What moves the layers now: a new offset morphs them, the entrance draws them in, the rest is layout. */
  role: MoveRole
  /** The series bottom first, as they stack. */
  order: readonly string[]
  /** A layer's points through the stops, its top and its bottom; on the stream's centre line when `rising`. */
  pointsOf: (key: string, rising: boolean) => LinePoint[]
  /** The sum of the shown layers' values at a stop. */
  totalOf: (stop: ChartItem) => number
  /**
   * What the pointer lights: with callouts, the layer under it, which the
   * guide and the value callout name; without, the whole stop, as the Area
   * chart does, which the tooltip reads out.
   */
  lights: 'layer' | 'stop'
  /** Writes a layer's points into its fills, its glow and the seam along its top. */
  paint: (
    key: string,
    points: readonly LinePoint[],
    fills: readonly (SVGPathElement | null)[],
  ) => void
  glows: RefObject<Map<string, SVGPathElement>>
  seams: RefObject<Map<string, SVGPathElement>>
}

const StreamContext = createContext<StreamContextValue | null>(null)

function useStream() {
  const stream = use(StreamContext)
  if (!stream) throw new Error('The stream’s parts go inside a `StreamChart`.')
  return stream
}

/** The legend's keys are plain swatches. */
function noMarker() {
  return null
}

/**
 * The chart's root: it lays out the frame its parts draw in, places each
 * stop along the plot from edge to edge, and stacks the layers into one
 * stream that fills the plot's height, or with `offset='zero'`, up from
 * zero on a value axis.
 */
function StreamChart(props: StreamChartProps) {
  const {
    data,
    config,
    offset = 'wiggle',
    curve = 'bump',
    entrance = 'none',
    glow = true,
    description,
    empty,
    className,
    children,
    ref,
  } = props
  const parts = partTypes(children)
  // A centred stream's centre means nothing, so a value axis would mislead.
  if (offset !== 'zero' && parts.has(ChartYAxis)) {
    throw new Error(
      `A stream centred with \`offset='${offset}'\` has no value axis. Use \`offset='zero'\` for one.`,
    )
  }
  const lights = parts.has(StreamTotal) || parts.has(StreamValue) ? 'layer' : 'stop'
  useLayoutEffect(registerLineProperties, [])
  if (offset !== 'zero' && props.domain !== undefined) {
    throw new Error(
      `A stream centred with \`offset='${offset}'\` fits its own range, so it takes no \`domain\`. Use \`offset='zero'\` for one.`,
    )
  }
  const keys = Object.keys(config)
  const keyList = keys.join('\u0000')
  // The order, worked out from the first rows the chart draws and held, so new rows or a hidden
  // layer never swap layers; again only for new series, which have no place in the old one. A
  // stream that starts on zero keeps the config's order, as stacked areas do.
  const [held, setHeld] = useState<{ keys: string; order: readonly string[] } | null>(
    null,
  )
  let order = held?.keys === keyList ? held.order : null
  if (order === null && data.length > 0) {
    order = offset === 'zero' ? keys : streamOrder(data.length, rowValues(data), keys)
    setHeld({ keys: keyList, order })
  }
  const stacked = order ?? keys
  const made = useCartesianChart(props, {
    kinds: [streamMarks(offset, stacked)],
    orientation: 'vertical',
    stack: 'stacked',
    entrance: entrance !== 'none',
    // A centred stream fills the plot's height; on zero, its axis rounds out to ticks from zero.
    y: { nice: offset === 'zero', zero: offset === 'zero' },
  })
  const { model, placeholder, phase } = made
  // A new offset morphs the layers, until new data or a hidden layer moves them again.
  const hiddenList = made.chart.hidden.join('\u0000')
  const [shape, setShape] = useState({ offset, data, hidden: hiddenList, morph: false })
  if (shape.offset !== offset) {
    setShape({ offset, data, hidden: hiddenList, morph: true })
  } else if (shape.morph && (shape.data !== data || shape.hidden !== hiddenList)) {
    setShape({ offset, data, hidden: hiddenList, morph: false })
  }
  // A layer's fill is one colour on a unit frame, which a pattern's tiles would stretch.
  const chart = { ...made.chart, patternOf: () => 'solid' as const }
  const shown = chart.series.filter((key) => !chart.hidden.includes(key))
  const glows = useRef(new Map<string, SVGPathElement>())
  const seams = useRef(new Map<string, SVGPathElement>())
  const scale = model.y.value
  const centreOf = (index: number) =>
    offset === 'zero' ? 1 - model.baselines.value : streamCentre(model, index)
  const totalOf = (stop: ChartItem) =>
    shown.reduce((sum, key) => sum + (numberOf(chart.valueOf(key, stop)) ?? 0), 0)
  const pointsOf = (key: string, rising: boolean) => {
    const points = framePoints(chart, model, key, false, true)
    return rising
      ? points.map((point, at) => {
          const centre = centreOf(at)
          return { ...point, y: centre, base: centre }
        })
      : points
  }
  const stream: StreamContextValue = {
    curve,
    entrance,
    role: phase === 'entering' ? 'draw' : shape.morph ? 'morph' : 'layout',
    order: stacked,
    pointsOf,
    totalOf,
    lights,
    paint: (key, points, fills) => {
      const area = areaPathThrough(points, curve, 1, 1)
      for (const fill of fills) fill?.setAttribute('d', area)
      glows.current.get(key)?.setAttribute('d', area)
      seams.current.get(key)?.setAttribute('d', pathThrough(points, curve, 1, 1))
    },
    glows,
    seams,
  }
  // Top first, as they read on the screen.
  const onScreen = [...stacked].reverse().filter((key) => shown.includes(key))
  const percent = numberFormatter(chart.locale, {
    style: 'percent',
    maximumFractionDigits: 0,
  })
  const labelOf = (key: string) => {
    const label = config[key]?.label
    return typeof label === 'string' ? label : key
  }
  // What a stop says: the lit layer alone, with its share of the total, so Up and Down are heard
  // to move; with none lit, every layer and the total.
  const stopText = (item: ChartItem) => {
    const total = totalOf(item)
    const lit = chart.emphasis
    if (lit !== null && shown.includes(lit)) {
      const value = numberOf(chart.valueOf(lit, item))
      const share =
        value === null || total === 0
          ? ''
          : `, ${chart.messages.outOf(percent.format(value / total), chart.valueText(total))}`
      return `${labelOf(lit)} ${chart.seriesText(item, lit)}${share}`
    }
    return [
      ...shown.map((key) => `${labelOf(key)} ${chart.seriesText(item, key)}`),
      `${chart.messages.total} ${chart.valueText(total)}`,
    ].join(', ')
  }
  const written = seriesWords(chart, cartesianWords(chart, null))
  const spoken = seriesWords(chart, cartesianWords(chart, { name: '', text: stopText }))
  const byKey = new Map(chart.current.map((stop) => [stop.key, stop]))
  const words = {
    describe: spoken.describe,
    tooltip: written.tooltip,
    // One column a layer, and the total.
    table: {
      ...written.table,
      columns: [...written.table.columns, chart.messages.total],
      rows: written.table.rows.map((row) => {
        const stop = byKey.get(row.key)
        return {
          ...row,
          cells: [...row.cells, stop ? chart.valueText(totalOf(stop)) : ''],
        }
      }),
    },
  }
  // Beside the guide, at the lit layer's middle, or the stream's, so it covers neither callout.
  const anchor = (stop: CartesianStop, series: string | null): ChartPoint => {
    const centre = bandCentre(stop.band)
    const span = series === null ? null : (model.spans[series]?.[stop.index] ?? null)
    return {
      x: chart.direction === 'rtl' ? 1 - centre : centre,
      y: span ? 1 - scale.place((span[0] + span[1]) / 2) : centreOf(stop.index),
      side: 'inline-end',
    }
  }
  return (
    <StreamContext value={stream}>
      <CartesianChartFrame
        chart={{ ...made, chart }}
        slot='stream-chart'
        markerOf={noMarker}
        anchor={anchor}
        words={words}
        // With callouts, the pointer lights the layer it is over, and Up and Down step through
        // them, top first; without, it lights the stop, as the Area chart's does.
        browse={
          lights === 'stop'
            ? { kind: 'x' }
            : {
                kind: 'x-series',
                seriesAt: (point) =>
                  layerAt(
                    shown.map((key) => ({ key, points: pointsOf(key, false) })),
                    curve,
                    point,
                  ),
                step: (_at, from, step) => stepThrough(onScreen, from, step),
              }
        }
        description={description}
        empty={empty}
        placeholder={placeholder && <StreamPlaceholder />}
        // A row above the plot and one below it for the callouts, which take no room without them.
        className={cn(
          'grid-rows-[auto_auto_auto_minmax(0,1fr)_auto_auto_auto] [grid-template-areas:"top_top_top"_"._top-axis_."_"._stream-above_."_"start-axis_plot_end-axis"_"._stream-below_."_"._bottom-axis_."_"bottom_bottom_bottom"]',
          className,
        )}
        ref={ref}
        {...figureProps(props, streamChartKeys)}
      >
        {glow && <StreamGlow />}
        {children}
        <StreamSeams />
        {lights === 'layer' && <StreamGuide />}
      </CartesianChartFrame>
    </StreamContext>
  )
}

/**
 * The kinds of part written straight inside the chart, or in a fragment
 * there, as the chart reads its parts (`chartParts`).
 */
function partTypes(children: ReactNode): Set<unknown> {
  const types = new Set<unknown>()
  const visit = (nodes: ReactNode) => {
    Children.forEach(nodes, (node) => {
      if (!isValidElement<{ children?: ReactNode }>(node)) return
      if (node.type === Fragment) visit(node.props.children)
      else types.add(node.type)
    })
  }
  visit(children)
  return types
}

/** Where the stream's centre sits at the stop at `index`, as a fraction of the plot from its top. */
function streamCentre(model: CartesianModel, index: number): number {
  const spans = Object.values(model.spans)
    .map((layer) => layer[index])
    .filter((span) => span !== null && span !== undefined)
  if (spans.length === 0) return 0.5
  const [low, high] = streamExtent({ stop: spans })
  return 1 - model.y.value.place((low + high) / 2)
}

/**
 * The layer whose shape holds `point`, as fractions of the plot from its
 * reading start and its top, among `layers` drawn with `curve` through
 * points along the same stops; null over none, such as above or below the
 * stream, or past a layer with nothing in it.
 */
function layerAt(
  layers: readonly { key: string; points: readonly LinePoint[] }[],
  curve: StreamCurve,
  point: { x: number; y: number },
): string | null {
  const stops = layers[0]?.points ?? []
  if (stops.length === 0) return null
  const after = stops.findIndex((stop) => stop.x >= point.x)
  // The place along the stops, fractional between two, as `sampleLine` reads it.
  const place =
    after === -1
      ? stops.length - 1
      : after === 0
        ? 0
        : (() => {
            const low = stops[after - 1]!
            const high = stops[after]!
            const share = high.x === low.x ? 1 : (point.x - low.x) / (high.x - low.x)
            return after - 1 + share
          })()
  for (const layer of layers) {
    const at = sampleLine(layer.points, curve)(place)
    const bottom = at.base ?? at.y
    if (bottom - at.y > 0 && point.y >= at.y && point.y <= bottom) return layer.key
  }
  return null
}

/** A layer's points as one string, so the same points from a new render move nothing. */
function pointsSignature(points: readonly LinePoint[]) {
  return points
    .map(
      (point) =>
        `${point.key}:${point.x.toFixed(5)}:${point.y.toFixed(5)}:${point.base?.toFixed(5)}`,
    )
    .join('|')
}

/** How softly the window around a lit stop fades into what steps back, for the shared window's masks. */
const windowFade = {
  '--trace-fade': 'var(--stream-chart-window-fade, 1.5rem)',
} as CSSProperties

/** The placeholder's swell while the data loads, as fractions of the plot's height. */
const PLACEHOLDER_SWELL = [0.36, 0.56, 0.5, 0.76, 0.62, 0.86, 0.7] as const

/** Where the layers wait while the data loads: flat along the placeholder's centre line, which they grow out of. */
const LOADING_POINTS: readonly LinePoint[] = PLACEHOLDER_SWELL.map((_, at) => ({
  key: null,
  x: at / (PLACEHOLDER_SWELL.length - 1),
  y: 0.5,
  base: 0.5,
  defined: true,
}))

const NO_POINTS: readonly LinePoint[] = []

type StreamLayerProps = Omit<ComponentProps<'div'>, 'children' | 'color'> & {
  /** The key of this series' values in the data, and of its entry in the config. */
  dataKey: string
}

/**
 * One series' layer of the stream, in its colour, from where the layer under
 * it ends. While another layer is brought forward, it steps back; while a
 * stop is lit, it steps back all but a soft window around the stop, as the
 * Area chart's do. A hidden layer thins to nothing where it sits.
 */
function StreamLayer({ dataKey, className, style, ...props }: StreamLayerProps) {
  useDeclared('StreamLayer', StreamLayer.declare({ dataKey }), cartesianSignature)
  const chart = useCartesian()
  const stream = useStream()
  const fill = useRef<SVGPathElement>(null)
  const litFill = useRef<SVGPathElement>(null)
  const { spotlit } = useChartActive()
  const fromRest = useFromRest(spotlit)
  const hidden = chart.hidden.includes(dataKey)
  const rising = !chart.entered && stream.entrance === 'rise'
  // While the chart loads, the layer folds into the placeholder's centre line and fades, and
  // grows back out of it when the data arrives.
  const loading = chart.status === 'loading'
  const drawn = chart.status === 'ready' || chart.status === 'hidden'
  const to = loading
    ? LOADING_POINTS
    : drawn
      ? stream.pointsOf(dataKey, rising)
      : NO_POINTS
  const signature = pointsSignature(to)
  // A layer that arrives on an empty chart grows out of the stream's centre line.
  const start = drawn ? stream.pointsOf(dataKey, true) : NO_POINTS
  usePointsMove(stream.role, to, signature, start, stream.curve, {
    align: (from, next) => alignLines(from, next, stream.curve),
    at: pointsAt,
    draw: (points) => stream.paint(dataKey, points, [fill.current, litFill.current]),
  })
  // Drawn as it renders, so the server and the first frame show it; moves write it after.
  const area = useMemo(
    () => areaPathThrough(to, stream.curve, 1, 1),
    // The points are compared by their signature.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [signature, stream.curve],
  )
  if (!drawn && !loading) return null
  const slot = chart.series.indexOf(dataKey)
  const emphasised = chart.emphasis === dataKey
  const otherEmphasised = chart.emphasis !== null && !emphasised
  // Lighting a stop, the layer steps back all but a bright copy in a soft window around it, as
  // the Area chart's do; it steps back whole while another layer is brought forward.
  const windowAt = stream.lights === 'stop' && !emphasised ? spotlit : null
  const stepsBack = windowAt !== null || otherEmphasised
  const window = litWindow(chart, windowAt, false)
  const shape = (ref: RefObject<SVGPathElement | null>) => (
    <g transform={mirror(chart.direction)}>
      <path ref={ref} d={area} className='fill-current' />
    </g>
  )
  return (
    <div
      data-slot='stream-chart-layer'
      data-series={dataKey}
      data-hidden={hidden || loading ? '' : undefined}
      aria-hidden
      className={cn(
        plotLayerClassName,
        markLayer.area,
        'transition-opacity duration-(--motion-layout-duration) ease-(--motion-layout-easing) data-hidden:opacity-0',
        className,
      )}
      style={
        {
          '--line-color': seriesColor(dataKey),
          ...windowFade,
          ...style,
        } as CSSProperties
      }
      {...props}
    >
      <EntranceWipe draws={stream.entrance === 'draw'}>
        {/* The window around the lit stop, which glides from stop to stop, and how much it shows. */}
        <div
          data-snap={fromRest ? '' : undefined}
          className={litWindowClassName}
          style={litWindowStyle(window, !otherEmphasised)}
        >
          {/* The layer stepped back, seen everywhere but through the window. */}
          <div className={cn(masked(false), steppedMaskClassName)}>
            <svg
              {...unitFrame}
              data-dim={stepsBack ? '' : undefined}
              // A layer that steps back loses colour and fades, so the lit one reads in front.
              className={cn(
                maskedFrame(false),
                'overflow-visible text-(--line-color) transition-[color,opacity] duration-(--motion-layout-duration) ease-(--motion-layout-fade-easing) not-forced-colors:data-dim:text-[oklch(from_var(--line-color)_l_calc(c*var(--stream-chart-dim,0.3))_h)] data-dim:opacity-60',
                forcedSeriesTextColor(slot),
              )}
            >
              {shape(fill)}
            </svg>
          </div>
          {/* The layer again in its own colour, seen only through the window. */}
          <div
            className={cn(
              masked(false),
              forcedSeriesTextColor(slot),
              'text-(--line-color)',
              litMaskClassName,
            )}
          >
            <svg {...unitFrame} className={cn(maskedFrame(false), 'overflow-visible')}>
              {shape(litFill)}
            </svg>
          </div>
        </div>
      </EntranceWipe>
    </div>
  )
}

StreamLayer.declare = ({
  dataKey,
}: Pick<StreamLayerProps, 'dataKey'>): ChartPartDeclaration => ({
  series: { key: dataKey, mark: 'area' },
})

/** Keeps `element` in `map` under `key` while it is mounted. */
function keep(map: RefObject<Map<string, SVGPathElement>>, key: string) {
  return (element: SVGPathElement | null) => {
    if (!element) return
    map.current.set(key, element)
    return () => {
      if (map.current.get(key) === element) map.current.delete(key)
    }
  }
}

/**
 * The glow: every layer again, in its colour, blurred once behind the
 * stream. A layer that steps back takes its glow with it, so the lit one
 * glows alone, and a lit stop keeps the glow only around it. It fades in
 * once the layers have arrived; its blur never moves. Forced colours leave
 * it out.
 */
function StreamGlow() {
  const chart = useCartesian()
  const stream = useStream()
  const { spotlit } = useChartActive()
  const fromRest = useFromRest(spotlit)
  // Lighting a stop, the glow stays only around it, as the layers' colour does.
  const window = litWindow(chart, stream.lights === 'stop' ? spotlit : null, false)
  // Kept while the data loads, so it fades as the layers fold away, rather than going at once.
  if (
    chart.status !== 'ready' &&
    chart.status !== 'hidden' &&
    chart.status !== 'loading'
  ) {
    return null
  }
  const rising = !chart.entered && stream.entrance === 'rise'
  return (
    <div
      aria-hidden
      data-slot='stream-chart-glow'
      data-waiting={chart.entered && chart.status !== 'loading' ? undefined : ''}
      className={cn(
        plotLayerClassName,
        'z-4 opacity-(--stream-chart-glow,0.4) blur-(--stream-chart-glow-blur,1.5rem) transition-opacity duration-(--motion-draw-duration) ease-(--motion-draw-fade-easing) group-data-mounted/chart:starting:opacity-0 data-waiting:opacity-0 forced-colors:hidden dark:opacity-(--stream-chart-glow,0.55)',
      )}
    >
      <div
        data-snap={fromRest ? '' : undefined}
        className={litWindowClassName}
        style={{ ...litWindowStyle(window, true), ...windowFade }}
      >
        <div className={cn(masked(false), litMaskClassName)}>
          <svg {...unitFrame} className={cn(maskedFrame(false), 'overflow-visible')}>
            <g transform={mirror(chart.direction)}>
              {stream.order.map((key) => (
                <path
                  key={key}
                  ref={keep(stream.glows, key)}
                  d={areaPathThrough(stream.pointsOf(key, rising), stream.curve, 1, 1)}
                  data-dim={
                    chart.emphasis !== null && chart.emphasis !== key ? '' : undefined
                  }
                  className='transition-opacity duration-(--motion-layout-duration) ease-(--motion-layout-fade-easing) data-dim:opacity-0'
                  style={{ fill: seriesColor(key) }}
                />
              ))}
            </g>
          </svg>
        </div>
      </div>
    </div>
  )
}

/**
 * The seams: a thin line of the page's background along each layer's top,
 * over every layer, so neighbours read apart whatever their colours. Its
 * width is `--stream-chart-gap`.
 */
function StreamSeams() {
  const chart = useCartesian()
  const stream = useStream()
  // Kept while the data loads, fading as the layers fold away, as they do.
  if (
    chart.status !== 'ready' &&
    chart.status !== 'hidden' &&
    chart.status !== 'loading'
  ) {
    return null
  }
  const rising = !chart.entered && stream.entrance === 'rise'
  return (
    <div
      aria-hidden
      data-slot='stream-chart-seams'
      data-hidden={chart.status === 'loading' ? '' : undefined}
      className={cn(
        plotLayerClassName,
        'z-7 transition-opacity duration-(--motion-layout-duration) ease-(--motion-layout-easing) data-hidden:opacity-0',
      )}
    >
      <EntranceWipe draws={stream.entrance === 'draw'}>
        <svg {...unitFrame} className='absolute inset-0 size-full overflow-visible'>
          <g transform={mirror(chart.direction)}>
            {stream.order.map((key) => (
              <path
                key={key}
                ref={keep(stream.seams, key)}
                d={pathThrough(stream.pointsOf(key, rising), stream.curve, 1, 1)}
                className='stroke-background fill-none [stroke-width:var(--stream-chart-gap,1px)] [vector-effect:non-scaling-stroke] forced-colors:stroke-[Canvas]'
              />
            ))}
          </g>
        </svg>
      </EntranceWipe>
    </div>
  )
}

/**
 * Where the guide is: the stop lit now, or the last one while the guide
 * fades; whether it shows; its place across the plot from the left, as a
 * fraction; and whether it was lit from rest, so it appears in place.
 */
function useStreamGuide() {
  const chart = useCartesian()
  const at = useChartActive().spotlit
  const fromRest = useFromRest(at)
  const [last, setLast] = useState(at)
  if (at !== null && at !== last) setLast(at)
  const shownAt = at ?? last
  const stop = shownAt === null ? undefined : chart.current[shownAt]
  const ready = chart.status === 'ready' && chart.entered && stop !== undefined
  const centre = stop ? bandCentre(stop.band) : 0
  return {
    stop,
    ready,
    shown: ready && at !== null,
    x: chart.direction === 'rtl' ? 1 - centre : centre,
    snap: fromRest,
  }
}

/** How the guide and its callouts glide from stop to stop, and appear in place from rest. */
const guideGlide =
  'transition-[translate] duration-(--motion-layout-duration) ease-(--motion-layout-easing) data-snap:transition-none motion-reduce:transition-none'

/** How the guide and its callouts fade in, and out where they are. */
const guideFade =
  'transition-opacity duration-(--motion-enter-duration) ease-(--motion-enter-easing) data-hidden:opacity-0 data-hidden:duration-(--motion-exit-duration) data-hidden:ease-(--motion-exit-easing)'

/**
 * The guide down the plot at the lit stop: a line of the page's background
 * over the layers, which cuts through the stream.
 */
function StreamGuide() {
  const guide = useStreamGuide()
  if (!guide.ready) return null
  return (
    <div
      aria-hidden
      data-slot='stream-chart-guide'
      data-hidden={guide.shown ? undefined : ''}
      className={cn(plotLayerClassName, guideFade, 'z-7')}
    >
      <div
        data-snap={guide.snap ? '' : undefined}
        className={cn('absolute inset-y-0 left-0', guideGlide)}
        style={{ translate: `${guide.x * 100}cqw 0` }}
      >
        <div className='bg-background absolute inset-y-0 w-0.5 -translate-x-1/2 forced-colors:w-px forced-colors:bg-[CanvasText]' />
      </div>
    </div>
  )
}

/**
 * A callout at the guide, in its row above or below the plot, held inside
 * the plot's width at either end. It glides with the guide and fades with it.
 */
function Callout({
  slot,
  side,
  shown,
  children,
  className,
  ...props
}: Omit<ComponentProps<'div'>, 'children'> & {
  slot: string
  side: 'above' | 'below'
  /** Whether it shows, beside the guide's own. */
  shown: boolean
  children: ReactNode
}) {
  const guide = useStreamGuide()
  return (
    <div
      aria-hidden
      data-slot={slot}
      className={cn(
        'pointer-events-none relative h-7 [container-type:inline-size]',
        side === 'above' ? '[grid-area:stream-above]' : '[grid-area:stream-below]',
        className,
      )}
      {...props}
    >
      {guide.ready && (
        <div
          data-snap={guide.snap ? '' : undefined}
          className={cn(
            'absolute left-0 [translate:clamp(0px,calc(var(--stream-guide-x)*100cqw_-_50%),calc(100cqw_-_100%))_0]',
            side === 'above' ? 'bottom-1' : 'top-1',
            guideGlide,
          )}
          style={{ '--stream-guide-x': guide.x } as CSSProperties}
        >
          <div
            data-hidden={guide.shown && shown ? undefined : ''}
            className={cn(
              'bg-background text-foreground flex h-6 items-center gap-1.5 rounded-(--control-radius-xs) px-2 whitespace-nowrap shadow-xs ring-1 ring-foreground/15 forced-colors:outline forced-colors:outline-1',
              guideFade,
            )}
          >
            {children}
          </div>
        </div>
      )}
    </div>
  )
}

/** The stream's total at the guide, in a callout above the plot; it rolls as the guide moves. */
function StreamTotal({ className, ...props }: Omit<ComponentProps<'div'>, 'children'>) {
  const chart = useCartesian()
  const stream = useStream()
  const guide = useStreamGuide()
  return (
    <Callout
      slot='stream-chart-total'
      side='above'
      shown
      className={className}
      {...props}
    >
      {guide.stop && (
        <>
          <span className='text-muted-foreground forced-colors:text-[CanvasText]'>
            {chart.messages.total}
          </span>
          <span className='font-medium tabular-nums'>
            <ChartNumber
              value={stream.totalOf(guide.stop)}
              format={chart.format}
              locale={chart.locale}
            />
          </span>
        </>
      )}
    </Callout>
  )
}

/**
 * The lit layer's value at the guide, with its swatch and name, in a
 * callout below the plot. It shows while a layer is lit, by the pointer, the
 * keys or the legend, and rolls as the guide or the layer changes.
 */
function StreamValue({ className, ...props }: Omit<ComponentProps<'div'>, 'children'>) {
  const chart = useCartesian()
  const guide = useStreamGuide()
  const lit =
    chart.emphasis !== null && !chart.hidden.includes(chart.emphasis)
      ? chart.emphasis
      : null
  // The layer last lit, which the callout keeps showing while it fades.
  const [last, setLast] = useState(lit)
  if (lit !== null && lit !== last) setLast(lit)
  const key = lit ?? last
  const value =
    key === null || !guide.stop ? null : numberOf(chart.valueOf(key, guide.stop))
  return (
    <Callout
      slot='stream-chart-value'
      side='below'
      shown={lit !== null}
      className={className}
      {...props}
    >
      {key !== null && (
        <>
          <span
            aria-hidden
            className={cn(
              swatchClassName,
              'transition-[background-color] duration-(--motion-layout-duration) ease-(--motion-layout-fade-easing)',
              forcedSeriesColor(chart.series.indexOf(key)),
            )}
            style={swatchStyle(key, 'solid')}
          />
          {/* Two fifths of the plot's width, so a long name leaves the value room in a narrow chart. */}
          <span className='text-muted-foreground flex min-w-0 max-w-[40cqw] forced-colors:text-[CanvasText]'>
            <Swap align='start' className='max-w-full'>
              <span data-cut className='block truncate'>
                {chart.config[key]?.label ?? key}
              </span>
            </Swap>
          </span>
          <span className='font-medium tabular-nums'>
            {value === null ? (
              chart.messages.noValue
            ) : (
              <ChartNumber value={value} format={chart.format} locale={chart.locale} />
            )}
          </span>
        </>
      )}
    </Callout>
  )
}

/**
 * The placeholder while the data loads: a soft stream breathing slowly,
 * three bands deep, which the layers grow out of when the data arrives.
 */
function StreamPlaceholder() {
  const bands = [0.84, 0.54, 0.24].map((depth) =>
    PLACEHOLDER_SWELL.map((swell, at): LinePoint => ({
      key: null,
      x: at / (PLACEHOLDER_SWELL.length - 1),
      y: 0.5 - (swell * depth) / 2,
      base: 0.5 + (swell * depth) / 2,
      defined: true,
    })),
  )
  return (
    <div
      data-slot='stream-chart-placeholder'
      aria-hidden
      className={cn(
        plotLayerClassName,
        'z-10 transition-opacity duration-(--motion-enter-duration) ease-(--motion-enter-easing) group-data-mounted/chart:starting:opacity-0',
      )}
    >
      <div
        className={cn(
          'text-foreground/8 dark:text-foreground/12 absolute inset-0 forced-colors:text-[GrayText]!',
          placeholderBreatheClassName,
        )}
      >
        <svg {...unitFrame} className='absolute inset-0 size-full overflow-visible'>
          {bands.map((points, at) => (
            <path
              key={at}
              d={areaPathThrough(points, 'bump', 1, 1)}
              className='fill-current'
            />
          ))}
        </svg>
      </div>
    </div>
  )
}

export {
  layerAt,
  StreamChart,
  type StreamChartProps,
  type StreamCurve,
  StreamLayer,
  type StreamLayerProps,
  type StreamOffset,
  StreamTotal,
  StreamValue,
}
