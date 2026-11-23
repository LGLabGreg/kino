'use client'

import {
  barBand,
  barKind,
  barMarks,
  type BarReading,
  bridgeMarks,
  bridgeSpans,
  farEnd,
  runningTotals,
} from '@/registry/lib/chart-bar-marks'
import {
  barAcross,
  barClip,
  BarFrameContext,
  type BarFrameValue,
  BarLabel,
  type BarLabelPosition,
  type BarPlace,
  BarPlaceholder,
  BarShape,
  labelFits,
  labelPlace,
  missingMark,
  NO_TUCK,
  outsideRoom,
  PLACEHOLDER_COUNT,
  placeholderClip,
  placeholderValues,
  RIBBON_TUCK,
  ribbonEnds,
  type RibbonLayout,
  ribbonClipPath,
  ribbonsOf,
  type RibbonTuck,
  type StackMarks,
  stackSeriesAt,
  trackClip,
  useBarFrame,
} from '@/registry/lib/chart-bars'
import {
  type ChartWords,
  figureProps,
  pickedName,
  seriesWords,
  useChartActive,
  useDeclared,
  useLeavingItems,
} from '@/registry/lib/chart-base'
import {
  CartesianChartFrame,
  type CartesianChartProps,
  type CartesianChartValue,
  cartesianChartKeys,
  cartesianSignature,
  type CartesianStop,
  cartesianTable,
  cartesianWords,
  type ChartPartDeclaration,
  type ChartRoomState,
  useCartesian,
  useCartesianChart,
} from '@/registry/lib/chart-cartesian'
import { type CartesianModel, markLayer, VALUE_AXIS } from '@/registry/lib/chart-frame'
import {
  type ChartLive,
  ChartLiveLayer,
  LIVE_SPAN,
} from '@/registry/lib/chart-live-clock'
import {
  cascadeAt,
  type ChartDatum,
  type ChartOrientation,
  type ChartStack,
  numberOf,
  plotPoint,
  rangeOf,
  type ReadingDirection,
  type Span,
  stacksOf,
  stepThrough,
} from '@/registry/lib/chart-math'
import {
  type ChartFormat,
  type ChartItem,
  type ChartMoves,
  type ChartPoint,
  type ChartRootState,
  forcedSeriesColor,
  formatterOf,
  patternImage,
  plotLayerClassName,
  seriesColor,
  swatchClassName,
  tooltipQuietClassName,
  useBefore,
  useChartMoves,
  useSize,
} from '@/registry/lib/chart-root'
import type { BandGaps } from '@/registry/lib/chart-scale'
import { numberFormatter } from '@/registry/lib/number-format'
import {
  type ComponentProps,
  createContext,
  type CSSProperties,
  use,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'

import { cn } from '@/lib/utils'

/*
 * The Bar chart: values across categories, side by side, stacked, or as
 * shares, upright or lying. Each bar is the clip of a layer as large as the
 * plot, so a new value, a new range, a series hidden or the categories
 * sorted is one CSS transition of each bar, which turns back from wherever
 * it is. The category under the pointer stays bright while the rest step
 * back, and the tooltip sits on the end of its bars. As a bridge, one
 * series' changes float from the running total before each to the total
 * after it, joined by thin lines, with totals standing on the axis.
 */

interface BarChartProps extends CartesianChartProps {
  /**
   * Bars that stand on the axis, or a bridge: how a start becomes an end,
   * such as revenue to profit. A bridge's one series holds signed changes,
   * each floating from the running total before it, and the categories in
   * `totals` stand on the axis. Rows keep the data's order.
   */
  layout?: 'bars' | 'bridge'
  /**
   * The categories of a bridge that stand on the axis as totals: at their
   * value, which the run carries on from, such as an opening balance, or with
   * none, at the running total, worked out.
   */
  totals?: readonly string[]
  /** Upright bars over the categories, or bars lying along them. */
  orientation?: ChartOrientation
  /** How each category's series combine: side by side, stacked, or stacked as shares of their total. */
  stack?: ChartStack
  /**
   * Joins each series' bar in one stack to its bar in the next with a soft
   * ribbon, so its share reads across them, such as a country's cars from
   * one year to the next. For one stack, `stacked` or `expand`; the stops
   * then run in order, so the tooltip gives each change since the one before.
   */
  ribbons?: boolean
  /**
   * How the bars arrive the first time the chart comes into view: all
   * rising together, rising one after another, or simply there, the
   * default, since a page that loads doesn't animate into place.
   */
  entrance?: 'rise' | 'cascade' | 'none'
  /** Where a cascade starts: the reading start, the end, the centre, or the largest value. */
  cascadeFrom?: 'start' | 'end' | 'centre' | 'value'
  /** The space between two categories, as a share of one category's step. */
  categoryGap?: number
  /** The space between bars side by side, as a share of one bar's slot. */
  barGap?: number
  /**
   * What each category holds, for a screen reader and the data table, in
   * place of each series' value: a day's state in a strip of days, whose
   * series are only its colours. `name` heads the data table's column.
   */
  describe?: { name: string; text: (datum: ChartDatum) => string }
}

const barChartKeys = [
  ...cartesianChartKeys,
  'layout',
  'totals',
  'orientation',
  'stack',
  'ribbons',
  'entrance',
  'cascadeFrom',
  'categoryGap',
  'barGap',
  'describe',
]

/** Every series at a stop, read along x. */
const X_BROWSE = { kind: 'x' } as const

/** The legend's keys are plain swatches. */
function noMarker() {
  return null
}

/**
 * The chart's root: it works out each series' bars from the data, and
 * lays out the frame its parts draw in.
 */
function BarChart(props: BarChartProps) {
  const {
    layout = 'bars',
    totals,
    orientation = 'vertical',
    stack = 'none',
    ribbons = false,
    entrance = 'none',
    cascadeFrom = 'start',
    categoryGap,
    barGap = 0.12,
    describe,
    description,
    empty,
    className,
    children,
    ref,
  } = props
  const gaps: BandGaps = categoryGap === undefined ? {} : { gap: categoryGap }
  const isTotal = layout === 'bridge' ? bridgeTotals(props, stack, totals ?? []) : null
  if (totals !== undefined && !isTotal) {
    throw new Error('`totals` names the totals of a bridge: give `layout="bridge"` too.')
  }
  if (isTotal && props.cascadeFrom !== undefined && props.cascadeFrom !== 'start') {
    throw new Error(
      'A bridge builds from its first step, as it reads: leave out `cascadeFrom`.',
    )
  }
  if (ribbons) ribbonsAllowed(stack, props)
  const kind = isTotal ? bridgeMarks(isTotal) : barMarks
  // A bridge's bars start one after another, each as the one before has nearly landed, so none
  // hangs in the air before the bar it starts from.
  const cascadeFallback = isTotal
    ? Math.min(BRIDGE_STEP_WAIT * Math.max(0, props.data.length - 1), BRIDGE_CASCADE_MOST)
    : 0.8
  // Ribbons join stops in order, so each one's change since the one before means something.
  const cartesian = useCartesianChart(
    { ...props, ordered: props.ordered ?? ribbons },
    {
      kinds: [kind],
      orientation,
      stack,
      entrance: entrance !== 'none',
      cascade:
        entrance === 'cascade'
          ? { variable: '--bar-chart-cascade', fallback: cascadeFallback }
          : undefined,
      gaps,
    },
  )
  const { chart, model, placeholder, fromPlaceholder, phase } = cartesian
  const stops = chart.current
  const bridge = useBridge(chart, isTotal, totals ?? [])
  // The bars' greatest thickness, `--bar-chart-max-thickness`, measured where the chart is.
  const capProbe = useRef<HTMLDivElement>(null)
  const capSize = useSize(capProbe)
  if (ribbons) oneStack(chart, model)
  // The cascade's order reads the bars against the chart's own value axis.
  const shown = totalled(chart).filter(model.totals)
  const reaches = stops.map((_, at) => farEnd(model.spans, shown, at))
  const order = reaches
    .map((reach, at) => ({ at, size: Math.abs(reach) }))
    .toSorted((a, b) => b.size - a.size)
  const cascade = stops.map((_, at) =>
    cascadeFrom === 'value'
      ? cascadeAt(
          at,
          stops.length,
          'start',
          order.findIndex((o) => o.at === at),
        )
      : cascadeAt(at, stops.length, cascadeFrom),
  )
  // What each stop holds, read out and in the data table, in place of each series' value.
  const own = describe
    ? {
        name: describe.name,
        text: (stop: ChartItem) => (stop.datum ? describe.text(stop.datum) : ''),
      }
    : null
  const bar: BarFrameValue = {
    model,
    kind,
    phase,
    fromPlaceholder,
    entrance,
    cascade,
    cascadeSpan: `var(--bar-chart-cascade, ${cascadeFallback})`,
    barGap,
    lights: ribbons ? 'series' : 'stop',
  }
  const across: RibbonLayout = {
    orientation,
    direction: chart.direction,
    cap: capOf(capSize.width, chart.plotSize, orientation),
  }
  const words = bridge
    ? bridgeWords(chart, bridge)
    : seriesWords(chart, {
        ...cartesianWords(chart, own),
        // With ribbons, the series the keys bring forward is read out alone, so Up and Down are heard.
        alone: ribbons ? chart.emphasis : null,
      })
  return (
    <BarFrameContext value={bar}>
      <CartesianChartFrame
        chart={cartesian}
        ref={ref}
        slot='bar-chart'
        description={description}
        empty={empty}
        className={className}
        placeholder={placeholder && <BarPlaceholder chart={chart} />}
        markerOf={noMarker}
        // The tooltip sits on the far end of the stop's bars: the tallest, or the stack's top.
        anchor={(stop, series) => {
          const lit =
            series === null ? null : segmentAnchor(chart, bar, stop, series, across)
          if (lit) return lit
          const along = chart.entered ? model.reach(stop.index) : null
          return plotPoint(
            stop.band,
            along ?? model.baselines.value,
            orientation,
            chart.direction,
          )
        }}
        words={words}
        browse={
          ribbons
            ? {
                kind: 'x-series',
                seriesAt: (point) =>
                  stackSeriesAt(
                    stackMarks(chart, bar, across),
                    pointAcross(point, orientation, chart.direction),
                    across,
                  ),
                step: (at, from, step) =>
                  stepThrough(segmentsOutward(chart, bar, at), from, step),
              }
            : X_BROWSE
        }
        {...figureProps(props, barChartKeys)}
      >
        {/* The bars' greatest thickness, measured, for where the pointer lands on a stack with
        ribbons and where its tooltip sits. Always there, so ribbons turned on later find it measured. */}
        <div
          ref={capProbe}
          aria-hidden
          className='invisible absolute h-0 w-(--bar-chart-max-thickness,4rem)'
        />
        {ribbons && <BarRibbons layout={across} />}
        <BridgeContext value={bridge}>{children}</BridgeContext>
      </CartesianChartFrame>
    </BarFrameContext>
  )
}

/* Ribbons. */

/** Throws on a chart ribbons can't join: one whose bars stand side by side. */
function ribbonsAllowed(stack: ChartStack, props: object) {
  if (stack === 'none') {
    throw new Error(
      "Ribbons join each series from one stack to the next: give `stack='stacked'` or `stack='expand'` too.",
    )
  }
  // A bar chart's type has no window of time, but a chart written in JavaScript can pass one.
  const { window, live } = props as { window?: number; live?: boolean }
  if (window !== undefined || live) {
    throw new Error(
      'Ribbons join stacks that stand still: leave out `window` and `live`.',
    )
  }
}

/** Throws when the bars stand in more than one stack, whose ribbons would cross each other. */
function oneStack(chart: CartesianChartValue, model: CartesianModel) {
  const bars = chart.series.filter((key) => model.markOf(key) === 'bar')
  if (stacksOf(bars, model.stackOf).length > 1) {
    throw new Error(
      'Ribbons join one stack across the categories: give every `Bar` the same `stack` and axis in the config, and no rows of its own.',
    )
  }
}

/** The bars' greatest thickness, `px`, as a share of the plot across the categories; no cap before either is measured. */
function capOf(
  px: number,
  plot: { width: number; height: number },
  orientation: ChartOrientation,
) {
  const across = orientation === 'vertical' ? plot.width : plot.height
  return px > 0 && across > 0 ? px / across : Number.POSITIVE_INFINITY
}

/**
 * A point the pointer is on, from the reading start and the top as the
 * reader hands it, as the ribbons read it: across the categories from the
 * physical left (upright) or the top (lying), and along the value axis.
 */
function pointAcross(
  point: { x: number; y: number },
  orientation: ChartOrientation,
  direction: ReadingDirection,
) {
  return orientation === 'vertical'
    ? {
        across: direction === 'rtl' ? 1 - point.x : point.x,
        along: 1 - point.y,
      }
    : { across: point.y, along: point.x }
}

/** The part of a category's band the bar of `key` at `stop` takes, beside the chart's other stacks. */
function bandOf(
  chart: CartesianChartValue,
  bar: BarFrameValue,
  stop: CartesianStop,
  key: string,
) {
  return barBand(
    stop.band,
    key,
    chart.series.filter((k) => bar.model.markOf(k) === 'bar'),
    chart.hidden,
    chart.stack,
    bar.model.stackOf,
    bar.barGap,
    (k) => chart.rowOf(k, stop) !== null,
  )
}

/**
 * Where the bar of `key` at `stop` stands once risen: a hidden series' where
 * it would stack, so its ribbons collapse with it; null with no value.
 */
function standingPlace(
  chart: CartesianChartValue,
  bar: BarFrameValue,
  stop: CartesianStop,
  key: string,
): BarPlace | null {
  const span = bar.model.spans[key]?.[stop.index]
  if (!span) return null
  const { scale } = bar.model.valueAxisOf(key)
  return {
    band: bandOf(chart, bar, stop, key),
    from: scale.place(span[0]),
    to: scale.place(span[1]),
  }
}

/** One series' ribbon from the stack at `from` to the next, by their keys, and where its two bars stand. */
interface Ribbon {
  key: string
  series: string
  from: string
  to: string
  start: BarPlace
  end: BarPlace
  /** Whether its bar at each end is the outermost of its stack, whose far corners are rounded. */
  outer: readonly [boolean, boolean]
}

/** The chart's ribbons between its stops, each where its bars stand, a hidden series' collapsed. */
function ribbonsAt(chart: CartesianChartValue, bar: BarFrameValue): Ribbon[] {
  const stops = chart.current
  const bars = chart.series.filter((key) => bar.model.markOf(key) === 'bar')
  return ribbonsOf(bars, stops.length, (key, at) => {
    const stop = stops[at]
    return stop ? chart.valueOf(key, stop) : null
  }).flatMap((pair) => {
    const from = stops[pair.from]
    const to = stops[pair.to]
    const start = from && standingPlace(chart, bar, from, pair.series)
    const end = to && standingPlace(chart, bar, to, pair.series)
    if (!from || !to || !start || !end) return []
    return [
      {
        key: `${pair.series}\u0000${from.key}\u0000${to.key}`,
        series: pair.series,
        from: from.key,
        to: to.key,
        start,
        end,
        outer: [
          isOutermost(chart, bar, from, pair.series),
          isOutermost(chart, bar, to, pair.series),
        ] as const,
      },
    ]
  })
}

/** The bars and ribbons the pointer can land on: the shown series' only, once the bars have risen. */
function stackMarks(
  chart: CartesianChartValue,
  bar: BarFrameValue,
  layout: RibbonLayout,
): StackMarks {
  if (!chart.entered) return { bars: [], ribbons: [] }
  const shown = (key: string) => !chart.hidden.includes(key)
  return {
    bars: chart.current.flatMap((stop) =>
      chart.series.filter(shown).flatMap((series) => {
        const place = standingPlace(chart, bar, stop, series)
        return place ? [{ series, place }] : []
      }),
    ),
    ribbons: ribbonsAt(chart, bar)
      .filter((ribbon) => shown(ribbon.series))
      .map((ribbon) => ({
        series: ribbon.series,
        ends: ribbonEnds(ribbon.start, ribbon.end, layout),
      })),
  }
}

/** The shown series with a bar at the stop at `index`, the one furthest along the value axis first, as they stand. */
function segmentsOutward(chart: CartesianChartValue, bar: BarFrameValue, index: number) {
  const stop = chart.current[index]
  if (!stop) return []
  return chart.series
    .filter((key) => !chart.hidden.includes(key))
    .flatMap((key) => {
      const place = standingPlace(chart, bar, stop, key)
      return place ? [{ key, middle: (place.from + place.to) / 2 }] : []
    })
    .toSorted((a, b) => b.middle - a.middle)
    .map(({ key }) => key)
}

/**
 * Where the tooltip of a lit series sits on its bar at `stop`: beside it at
 * its middle, upright, or above it, lying, so it covers none of the stack;
 * null where the series has no bar.
 */
function segmentAnchor(
  chart: CartesianChartValue,
  bar: BarFrameValue,
  stop: CartesianStop,
  series: string,
  layout: RibbonLayout,
): ChartPoint | null {
  const place = chart.entered ? standingPlace(chart, bar, stop, series) : null
  if (!place) return null
  const { centre, half } = barAcross(place, layout)
  const middle = (place.from + place.to) / 2
  if (layout.orientation === 'vertical') {
    return {
      x: centre + (layout.direction === 'rtl' ? -half : half),
      y: 1 - middle,
      side: 'inline-end',
    }
  }
  return {
    x: layout.direction === 'rtl' ? 1 - middle : middle,
    y: centre - half,
    side: 'top',
  }
}

/** Where a ribbon's draw along its length starts: at the stack it leaves, or at the one it meets. */
function wipeFrom(
  origin: 'from' | 'to',
  orientation: ChartOrientation,
  direction: ReadingDirection,
) {
  // The clip that hides all but the side it grows from, as `inset()` sides: top, right, bottom, left.
  const start =
    orientation === 'vertical' ? (direction === 'rtl' ? 'right' : 'left') : 'top'
  const side = origin === 'from' ? start : OPPOSITE[start]
  const sides = { top: '0', right: '0', bottom: '0', left: '0' }
  sides[OPPOSITE[side]] = '100%'
  return `inset(${sides.top} ${sides.right} ${sides.bottom} ${sides.left})`
}

const OPPOSITE = {
  top: 'bottom',
  bottom: 'top',
  left: 'right',
  right: 'left',
} as const

/**
 * The columns that stand still: those there before the last change to `keys`
 * while it moves, and all of them once its move has ended, so a ribbon to a
 * column that arrived runs on under its bars from then.
 */
function useStood(moves: ChartMoves, keys: readonly string[]) {
  const joined = keys.join('\u0000')
  const before = useBefore(keys, joined)
  const [settled, setSettled] = useState(joined)
  useLayoutEffect(() => {
    if (settled === joined) return
    let live = true
    void moves.request().then(() => {
      if (live) setSettled(joined)
    })
    return () => {
      live = false
    }
  }, [moves, joined, settled])
  return settled === joined ? keys : before
}
/**
 * The ribbons: a layer under the bars, each series' ribbons in its colour,
 * faint, brighter while its series is lit and stepping back with its bars.
 * Each is a clip of the plot that moves on the same transition as the bars'
 * clips, so it lands with them and turns back with them; a new one draws
 * along its length from the stack that stood before, and one that leaves
 * fades where it was.
 */
function BarRibbons({ layout }: { layout: RibbonLayout }) {
  const chart = useCartesian()
  const bar = useBarFrame()
  const moves = useChartMoves()
  const ready = chart.status === 'ready'
  // Each time the data comes back, such as after a reload, its ribbons are new elements, so one
  // still fading out draws in again with its stacks rather than coming back where it stood.
  const [arrival, setArrival] = useState({ ready, count: 0 })
  if (arrival.ready !== ready) {
    setArrival({ ready, count: arrival.count + (ready ? 1 : 0) })
  }
  const ribbons = ready
    ? ribbonsAt(chart, bar).map((ribbon) => ({ ...ribbon, arrival: arrival.count }))
    : NO_RIBBONS
  // In key order, current and leaving alike, so no ribbon's element moves in the page, which
  // would restart its wipe and drop its fade.
  const drawn = useLeavingItems(moves, ribbons, ribbonKey)
  const keys = chart.current.map((stop) => stop.key)
  const stood = useStood(moves, keys)
  const at = new Map(chart.current.map((stop) => [stop.key, stop.index]))
  const { orientation, direction } = layout
  const entrance = bar.phase !== 'settled' && bar.entrance !== 'none'
  // A ribbon runs on under its bars, and behind an outermost bar's rounded corner, which it
  // fills; one that leaves stops at their edges, since its bars go without it.
  const tuck = (outer: boolean, leaving: boolean): RibbonTuck =>
    leaving ? NO_TUCK : { share: RIBBON_TUCK, corner: outer }
  return (
    <div
      data-slot='bar-chart-ribbons'
      aria-hidden
      // Under the bars, which cover the ends of their ribbons. Only where a browser can draw a
      // ribbon's shape: elsewhere its unclipped layer would cover the plot.
      className={cn(
        plotLayerClassName,
        'z-7 hidden supports-[clip-path:shape(from_0_0,line_to_1px_1px)]:block',
      )}
    >
      {chart.series.map((series) => {
        const own = drawn.filter((ribbon) => ribbon.series === series)
        if (own.length === 0) return null
        const lit = chart.emphasis === series
        return (
          <div
            key={series}
            data-series={series}
            data-lit={lit ? '' : undefined}
            data-dim={chart.emphasis !== null && !lit ? '' : undefined}
            className='absolute inset-0 opacity-(--bar-chart-ribbon,0.24) transition-none [--ribbon-fill:var(--bar-color)] duration-(--motion-layout-duration) ease-(--motion-layout-fade-easing) group-data-mounted/chart:transition-opacity data-dim:opacity-[calc(var(--bar-chart-ribbon,0.24)*0.6)] data-dim:[--ribbon-fill:oklch(from_var(--bar-color)_l_calc(c*var(--bar-chart-dim,0.3))_h)] data-lit:opacity-[calc(var(--bar-chart-ribbon,0.24)*2)]'
            style={{ '--bar-color': seriesColor(series) } as CSSProperties}
          >
            {own.map((ribbon) => {
              const fresh = !stood.includes(ribbon.from) || !stood.includes(ribbon.to)
              const later = at.get(ribbon.to) ?? 0
              // On the entrance, a ribbon waits for its later stack to rise; a new one, for a
              // new stack to grow.
              const wait = entrance
                ? `calc(var(--motion-draw-duration) * ${bar.entrance === 'cascade' ? `(${bar.cascadeSpan} * ${bar.cascade[later] ?? 0} + 1)` : 1})`
                : fresh
                  ? 'var(--motion-layout-duration)'
                  : '0s'
              const leaving = Boolean(ribbon.leaving)
              return (
                <div
                  key={`${ribbon.key}\u0000${ribbon.arrival}`}
                  data-waiting={bar.phase === 'waiting' ? '' : undefined}
                  data-leaving={leaving ? '' : undefined}
                  className='absolute inset-0 [clip-path:inset(0)] transition-none group-data-mounted/chart:[transition:clip-path_var(--motion-draw-duration)_var(--motion-draw-easing)_var(--ribbon-wait),opacity_var(--motion-exit-duration)_var(--motion-exit-fade-easing)] group-data-mounted/chart:starting:[clip-path:var(--ribbon-hidden)] data-leaving:opacity-0 data-waiting:[clip-path:var(--ribbon-hidden)] motion-reduce:group-data-mounted/chart:[transition:opacity_var(--motion-exit-duration)_var(--motion-exit-fade-easing)]'
                  style={
                    {
                      '--ribbon-hidden': wipeFrom(
                        stood.includes(ribbon.from) || !stood.includes(ribbon.to)
                          ? 'from'
                          : 'to',
                        orientation,
                        direction,
                      ),
                      '--ribbon-wait': wait,
                    } as CSSProperties
                  }
                >
                  <div
                    data-entering={bar.phase === 'entering' ? '' : undefined}
                    className='absolute inset-0 bg-(--ribbon-fill) transition-none duration-(--motion-layout-duration) ease-[var(--motion-layout-fade-easing),var(--motion-layout-easing)] [clip-path:var(--ribbon-clip)] group-data-mounted/chart:transition-[background-color,clip-path] data-entering:duration-(--motion-draw-duration) data-entering:ease-[var(--motion-draw-fade-easing),var(--motion-draw-easing)] motion-reduce:ease-(--motion-layout-fade-easing) motion-reduce:group-data-mounted/chart:transition-[background-color] forced-colors:bg-[GrayText]'
                    style={
                      {
                        // A variable, as the bars' clip is, so the two read alike.
                        '--ribbon-clip': ribbonClipPath(
                          ribbon.start,
                          ribbon.end,
                          layout,
                          [
                            tuck(ribbon.outer[0], leaving),
                            tuck(ribbon.outer[1], leaving),
                          ],
                        ),
                      } as CSSProperties
                    }
                  />
                </div>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}

/** No ribbons, each as drawn: with the count of the data's arrival it came with. */
const NO_RIBBONS: readonly (Ribbon & { arrival: number })[] = []

function ribbonKey(ribbon: Ribbon) {
  return ribbon.key
}

/* The bridge. */

/** What a bridge's bars and words read. */
interface BridgeValue {
  /** Its one series. */
  key: string
  /** Whether a step, still in the data or just taken out, is a total. */
  isTotal: (stop: ChartItem) => boolean
  /** Each step's change, by its place in the data: null for a total or a missing change. */
  changes: readonly (number | null)[]
  /** The running total after each step, by its place. */
  runs: readonly number[]
  /** Where a step just taken out stood, by its key, so it folds into its start. */
  left: (key: string) => Span | null
}

const BridgeContext = createContext<BridgeValue | null>(null)

/** The share of `draw` a bridge's bar waits after the one before starts: by then that one has nearly landed. */
const BRIDGE_STEP_WAIT = 0.4

/** The most of `draw` a bridge's cascade spreads over, so a long one builds faster rather than slower. */
const BRIDGE_CASCADE_MOST = 1.6

/** A bridge's colours, each a variable a buyer sets on the chart or above it. */
const BRIDGE_TONES = {
  rise: 'var(--bar-chart-rise, var(--chart-1))',
  fall: 'var(--bar-chart-fall, var(--destructive))',
  total: 'var(--bar-chart-total, var(--chart-4))',
} as const

/** The colour of a bridge's step: a total's, or a change's as it rises or falls. */
function bridgeTone(bridge: BridgeValue, stop: ChartItem, value: number | null) {
  if (bridge.isTotal(stop)) return BRIDGE_TONES.total
  return value !== null && value < 0 ? BRIDGE_TONES.fall : BRIDGE_TONES.rise
}

/**
 * What a bridge works out from its rows as it renders: each step's change,
 * the running total after it and whether it joins the next, and where each
 * step just taken out stood. Null for bars that stand on the axis.
 */
function useBridge(
  chart: CartesianChartValue,
  isTotal: readonly boolean[] | null,
  totals: readonly string[],
): BridgeValue | null {
  const key = chart.series[0] ?? ''
  if (isTotal && chart.series.length > 1) {
    throw new Error(
      'A bridge draws one series: its changes from a start to an end. Give it one `Bar`, or use `layout="bars"`.',
    )
  }
  const values = chart.current.map((stop) => numberOf(chart.valueOf(key, stop)))
  const steps = bridgeSpans(values, isTotal ?? [])
  // Bars that stand on the axis keep nothing.
  const kept = useLeft(
    isTotal ? chart.current.map((stop) => stop.key) : [],
    steps,
    leavingKeys(chart),
    (span) => span?.join(',') ?? '',
  )
  if (!isTotal) return null
  return {
    key,
    isTotal: (stop) => totals.includes(String(stop.value)),
    changes: values.map((value, at) => (isTotal[at] ? null : value)),
    runs: runningTotals(steps),
    // With no steps left, as while it loads, every step folds onto the axis, as bars do.
    left: (key) => (chart.current.length > 0 ? (kept(key) ?? null) : null),
  }
}

/** The keys of the stops just taken out, while they leave. */
function leavingKeys(chart: CartesianChartValue) {
  return chart.stops.filter((stop) => stop.leaving).map((stop) => stop.key)
}

/**
 * What each key last had, for the keys just taken out: kept from the render
 * before, while they leave, and let go once they have left. `signature`
 * writes a value, so a render that changes none keeps what it has.
 */
function useLeft<T>(
  keys: readonly string[],
  values: readonly T[],
  leaving: readonly string[],
  signature: (value: T | undefined) => string,
) {
  const said = keys.map((key, at) => `${key}=${signature(values[at])}`).join('\u0000')
  const now = new Map(keys.map((key, at) => [key, values[at]]))
  const [state, setState] = useState({
    said,
    now,
    gone: new Map<string, T | undefined>(),
  })
  let gone = state.gone
  if (state.said !== said) {
    gone = new Map([...state.gone, ...state.now])
    for (const key of keys) gone.delete(key)
    setState({ said, now, gone })
  } else if ([...gone.keys()].some((key) => !leaving.includes(key))) {
    // The data changes a render before its keys are marked leaving, so only a render after it lets them go.
    gone = new Map([...gone].filter(([key]) => leaving.includes(key)))
    setState({ ...state, gone })
  }
  return (key: string) => gone.get(key)
}

/** How a bridge writes a change: with its sign, so a rise reads `+120`. */
function signedWriter(locale: Intl.LocalesArgument, format: ChartFormat | undefined) {
  if (typeof format === 'function') {
    return (value: number) => (value > 0 ? `+${format(value)}` : format(value))
  }
  const formatter = numberFormatter(locale, {
    ...format,
    signDisplay: 'exceptZero',
  })
  return (value: number) => formatter.format(value)
}

/**
 * A bridge's words: each step's change in words, so its sign never rests on
 * colour, and the running total after it, or a total's value; the tooltip's
 * change and running total; and a data table of both.
 */
function bridgeWords(chart: CartesianChartValue, bridge: BridgeValue): ChartWords {
  const { messages, valueText } = chart
  const signed = signedWriter(chart.locale, chart.format)
  const run = (stop: ChartItem) => valueText(bridge.runs[stop.index] ?? 0)
  const change = (stop: ChartItem) => bridge.changes[stop.index] ?? null
  return {
    describe: (stop) => {
      const name = pickedName(chart.stopText(stop), chart.selected === stop.key, messages)
      if (bridge.isTotal(stop)) return `${name}, ${messages.bridgeTotal(run(stop))}`
      const value = change(stop)
      const said =
        value === null
          ? messages.noValue
          : messages.change(value, valueText(Math.abs(value)))
      return `${name}, ${messages.bridgeStep(said, run(stop))}`
    },
    tooltip: (stop) => (
      <BridgeTooltipContent
        chart={chart}
        name={chart.stopText(stop)}
        tone={bridgeTone(bridge, stop, change(stop))}
        rows={
          bridge.isTotal(stop)
            ? [[messages.total, run(stop)]]
            : [
                [
                  messages.stepChange,
                  change(stop) === null ? messages.noValue : signed(change(stop) ?? 0),
                ],
                [messages.runningTotal, run(stop)],
              ]
        }
      />
    ),
    table: {
      ...cartesianTable(chart, [messages.stepChange, messages.runningTotal], (stop) => {
        const value = change(stop)
        return [
          bridge.isTotal(stop)
            ? messages.total
            : value === null
              ? messages.noValue
              : signed(value),
          run(stop),
        ]
      }),
      header: messages.step,
    },
  }
}

/** A bridge step's tooltip: its name keyed by its colour, then its change and the running total after it, or a total's value. */
function BridgeTooltipContent({
  chart,
  name,
  tone,
  rows,
}: {
  chart: CartesianChartValue
  name: string
  /** The step's colour, which keys it to its bar. */
  tone: string
  rows: readonly (readonly [string, string])[]
}) {
  return (
    // The tooltip sits outside the chart, so it carries the chart's id, as every chart's does.
    <div data-chart={chart.id} className='grid min-w-36 gap-1'>
      <div className='flex items-center gap-2'>
        <span
          aria-hidden
          className={cn(swatchClassName, forcedSeriesColor(0))}
          style={{ '--swatch': tone } as CSSProperties}
        />
        <span className='font-medium'>{name}</span>
      </div>
      {rows.map(([term, value]) => (
        <div key={term} className='flex items-center gap-4'>
          <span className={cn(tooltipQuietClassName, 'flex-1')}>{term}</span>
          {/* A value with a unit reads in its own order whatever the page's direction. */}
          <span dir='auto' className='font-medium tabular-nums'>
            {value}
          </span>
        </div>
      ))}
    </div>
  )
}

/**
 * Where the bar of `key` at `stop` stands: in its slot of the band
 * side by side, or across the band stacked, beside the chart's other stacks.
 * A hidden series, a missing value, a bar that hasn't risen yet and a
 * category that leaves all stand at zero.
 */
function barPlace(
  chart: CartesianChartValue,
  bar: BarFrameValue,
  stop: CartesianStop,
  key: string,
  bridge: BridgeValue | null,
): BarPlace {
  const { model } = bar
  const band = bandOf(chart, bar, stop, key)
  const { scale, baseline: zero } = model.valueAxisOf(key)
  if (bridge) {
    // A step folds into where it starts: the running total before it.
    const span = stop.leaving ? bridge.left(stop.key) : model.spans[key]?.[stop.index]
    const start = span
      ? scale.place(span[0])
      : stop.leaving
        ? zero
        : scale.place(bridge.runs[stop.index] ?? 0)
    if (!span || stop.leaving || !chart.entered) return { band, from: start, to: start }
    return { band, from: start, to: scale.place(span[1]) }
  }
  const span = stop.leaving ? null : model.spans[key]?.[stop.index]
  if (!span || !chart.entered) return { band, from: zero, to: zero }
  return { band, from: scale.place(span[0]), to: scale.place(span[1]) }
}

/** Whether the bar of `key` is the last of its stack on its side of zero, which takes the round end. */
function isOutermost(
  chart: CartesianChartValue,
  bar: BarFrameValue,
  stop: CartesianStop,
  key: string,
) {
  if (chart.stack === 'none') return true
  const { spans, stackOf } = bar.model
  const own = spans[key]?.[stop.index]
  if (!own || rangeOf(chart.valueOf(key, stop))) return true
  const positive = own[1] >= own[0]
  const shown = chart.series.filter(
    (k) => !chart.hidden.includes(k) && stackOf(k) === stackOf(key),
  )
  const after = shown.slice(shown.indexOf(key) + 1)
  return !after.some((k) => {
    const span = spans[k]?.[stop.index]
    return (
      span &&
      !rangeOf(chart.valueOf(k, stop)) &&
      span[1] !== span[0] &&
      span[1] >= span[0] === positive
    )
  })
}

/** What a bar's label says it reads: its value, its range, or a change with its sign; nothing for none. */
function readingText(
  reading: BarReading | undefined,
  write: (value: number) => string,
  signed: (value: number) => string,
) {
  if (!reading) return ''
  const { value } = reading
  if (typeof value !== 'number') return `${write(value[0])} – ${write(value[1])}`
  return reading.signed ? signed(value) : write(value)
}

type BarProps = Omit<ComponentProps<'div'>, 'children' | 'color'> & {
  /** The key of this series' values in the data, and of its entry in the config. */
  dataKey: string
  /**
   * The series' own rows, on an x of times, in place of the chart's: each
   * with the chart's `index` and the series' `dataKey`, in time order. Its
   * bars stand at their own times and stack with nothing.
   */
  data?: readonly ChartDatum[]
  /**
   * A colour for one bar, such as one that stands out, from the row it is
   * drawn from and its stop's place; the series' colour when it returns
   * nothing.
   */
  color?: (datum: ChartDatum, index: number) => string | undefined
  /** The colour of a bar below zero. */
  negativeColor?: string
  /** Writes each bar's value on it: `true` puts it past the bar's end. */
  label?: boolean | BarLabelPosition
  /** How the labels write values; the chart's `format` by default. */
  labelFormat?: ChartFormat
  /** Draws each bar's whole length behind it, for values out of a whole. */
  track?: boolean
  /** Fills the bars with the series' colour, or with it fading toward zero. */
  fill?: 'solid' | 'gradient'
}

/**
 * One series' bars: a layer of the plot holding a bar for each category,
 * in the series' colour. While the chart enters, the bars rise on `draw`,
 * one after another with `entrance='cascade'`; after that every change
 * moves on `layout`. A missing value shows a short dashed mark at zero, so
 * it reads apart from a zero.
 */
function Bar(props: BarProps) {
  const {
    dataKey,
    data,
    color,
    negativeColor,
    label = false,
    labelFormat,
    track = false,
    fill = 'solid',
    className,
    style,
    ...rest
  } = props
  useDeclared('Bar', Bar.declare(props), cartesianSignature)
  const chart = useCartesian()
  const { spotlit } = useChartActive()
  const bar = useBarFrame()
  const bridge = use(BridgeContext)
  if (bridge && negativeColor !== undefined) {
    throw new Error(
      'A bridge colours its falls with `--bar-chart-fall`, not `negativeColor`: set the variable on the chart.',
    )
  }
  const position = labelPosition(label)
  const { orientation } = chart
  const write = formatterOf(chart.locale, labelFormat ?? chart.format)
  if (chart.status === 'empty') return null
  const slot = chart.series.indexOf(dataKey)
  const zero = bar.model.valueAxisOf(dataKey).baseline
  const pattern = patternImage(chart.patternOf(dataKey))
  const gradient =
    fill === 'gradient'
      ? `linear-gradient(${orientation === 'vertical' ? 'to top' : chart.direction === 'rtl' ? 'to left' : 'to right'}, color-mix(in oklab, var(--bar-fill) 35%, transparent), var(--bar-fill))`
      : undefined
  const images = [pattern, gradient].filter(Boolean).join(', ')
  const live = chart.frame.live
  // A stop lit steps the others back, unless the pointer lights a series across every stop.
  const dimmed = (stop: CartesianStop) =>
    (bar.lights === 'stop' && spotlit !== null && spotlit !== stop.index) ||
    (chart.emphasis !== null && chart.emphasis !== dataKey)
  return (
    <>
      <div
        data-slot='bar-chart-series'
        data-series={dataKey}
        data-own={data ? '' : undefined}
        aria-hidden
        className={cn(plotLayerClassName, markLayer.bar, className)}
        style={style}
        {...rest}
      >
        <ChartLiveLayer live={live} direction={chart.direction} reach='plot'>
          <div
            className={
              live
                ? 'absolute inset-y-0 start-0 w-[300%] [container-type:size]'
                : 'contents'
            }
          >
            {/* A live plot's rows that leave have scrolled out already, so only the rows still in it draw.
              A bar stands only where its series has a row. */}
            {rowStops(chart, live ? chart.current : chart.stops, dataKey).map((stop) => {
              const place = liveBand(barPlace(chart, bar, stop, dataKey, bridge), live)
              const row = chart.rowOf(dataKey, stop)
              const raw = row?.[dataKey]
              const value = numberOf(raw)
              const range = rangeOf(raw)
              const below = range ? range[1] < range[0] : value !== null && value < 0
              const own =
                (row && color?.(row, stop.index)) ??
                (bridge
                  ? bridgeTone(bridge, stop, value)
                  : below && negativeColor
                    ? negativeColor
                    : undefined)
              const clip = barClip(chart, place, isOutermost(chart, bar, stop, dataKey))
              const at = Math.min(stop.index, PLACEHOLDER_COUNT - 1)
              // A bar that arrives grows out of the placeholder in its place, or up from zero; a
              // bridge's, up from where it starts.
              const start = bridge ? place.from : zero
              const from = bar.fromPlaceholder
                ? placeholderClip(chart, at, placeholderValues(PLACEHOLDER_COUNT)[at]!)
                : barClip(chart, { band: place.band, from: start, to: start }, true)
              const missing =
                !stop.leaving &&
                chart.entered &&
                !chart.hidden.includes(dataKey) &&
                value === null &&
                range === null &&
                // A bridge's total with no value stands at the running total.
                !bridge?.isTotal(stop)
              const delay = cascadeDelay(bar, stop.index)
              return (
                <BarShape
                  key={stop.key}
                  clip={clip}
                  from={from}
                  dim={dimmed(stop)}
                  entering={bar.phase === 'entering'}
                  delay={delay}
                  color={own ?? seriesColor(dataKey)}
                  images={images}
                  slot={slot}
                  track={track ? trackClip(chart, place.band) : undefined}
                  // A bridge's missing change sits at the running total, which carries on past it.
                  missing={missing ? missingMark(chart, place.band, start) : undefined}
                />
              )
            })}
          </div>
        </ChartLiveLayer>
      </div>
      {/* A live chart's bars scroll past too fast to read a label on each. */}
      {position && chart.status === 'ready' && !live && (
        // Above the reference lines, so a line across a value never runs through it.
        <div aria-hidden className={cn(plotLayerClassName, 'z-20')}>
          <BarLabels
            dataKey={dataKey}
            position={position}
            write={write}
            signed={signedWriter(chart.locale, labelFormat ?? chart.format)}
            dimmed={dimmed}
          />
        </div>
      )}
    </>
  )
}

/**
 * A bar's place in its layer: on a live chart, a box `LIVE_SPAN` plots wide
 * from the plot's reading start, so a bar past the plot's end, which the
 * clock will bring into view, isn't clipped away.
 */
function liveBand(place: BarPlace, live: ChartLive | null): BarPlace {
  if (!live) return place
  const { start, size } = place.band
  return {
    ...place,
    band: { start: start / LIVE_SPAN, size: size / LIVE_SPAN },
  }
}

/** The stops among `stops` where `key` has a row, which its bars stand at. */
function rowStops(
  chart: Pick<CartesianChartValue, 'rowOf'>,
  stops: readonly CartesianStop[],
  key: string,
) {
  return stops.filter((stop) => chart.rowOf(key, stop) !== null)
}

/** Where a bar's label sits, or null for none: `true` puts it past the bar's end. */
function labelPosition(label: BarProps['label']): BarLabelPosition | null {
  return label === true ? 'outside' : label || null
}

// A bar is its series; labels past the bars' ends keep room for themselves past the value
// axis's far end, worked out from what they will read.
Bar.declare = ({
  dataKey,
  data,
  label = false,
  labelFormat,
}: BarProps): ChartPartDeclaration => ({
  series: { key: dataKey, mark: 'bar' },
  ...(data === undefined ? {} : { rows: data }),
  ...(labelPosition(label) === 'outside'
    ? {
        room: (chart: ChartRoomState) => {
          const format = labelFormat ?? chart.format
          const write = formatterOf(chart.locale, format)
          const signed = signedWriter(chart.locale, format)
          const readings = barKind(chart.kinds).reads(
            chart.rows.map((row) => row[dataKey]),
          )
          return outsideRoom(
            chart,
            readings.map((reading) => readingText(reading, write, signed)),
          )
        },
      }
    : {}),
})

/** How long the bars of the stop at `index` wait in a cascade's entrance; none otherwise. */
function cascadeDelay(bar: BarFrameValue, index: number) {
  return bar.entrance === 'cascade' && bar.phase === 'entering'
    ? `calc(var(--motion-draw-duration) * ${bar.cascadeSpan} * ${bar.cascade[index] ?? 0})`
    : undefined
}

/**
 * Each bar's value, written past its end, just inside it, or in its middle.
 * A label that doesn't fit its bar is skipped, and every label slides with
 * its bar.
 */
function BarLabels({
  dataKey,
  position,
  write,
  signed,
  dimmed,
}: {
  dataKey: string
  position: BarLabelPosition
  write: (value: number) => string
  /** How a bridge's change is written, with its sign. */
  signed: (value: number) => string
  dimmed: (stop: CartesianStop) => boolean
}) {
  const chart = useCartesian()
  const bar = useBarFrame()
  const bridge = use(BridgeContext)
  const readings = bar.kind.reads(
    chart.current.map((stop) => chart.valueOf(dataKey, stop)),
  )
  const texts = readings.map((reading) => readingText(reading, write, signed))
  // A label taken out keeps what it read as it fades, since its place in the data has gone.
  const kept = useLeft(
    chart.current.map((stop) => stop.key),
    texts,
    leavingKeys(chart),
    (text) => text ?? '',
  )
  if (chart.hidden.includes(dataKey)) return null
  return (
    <>
      {rowStops(chart, chart.stops, dataKey).map((stop) => {
        const place = barPlace(chart, bar, stop, dataKey, bridge)
        const span = bar.model.spans[dataKey]?.[stop.index]
        const text = (stop.leaving ? kept(stop.key) : texts[stop.index]) ?? ''
        const outermost = isOutermost(chart, bar, stop, dataKey)
        // Until the chart has entered, its bars haven't risen, so their labels wait unseen.
        const shown =
          chart.entered &&
          !stop.leaving &&
          span !== null &&
          span !== undefined &&
          text !== '' &&
          (position !== 'outside' || outermost) &&
          labelFits(chart, place, text, position)
        return (
          <BarLabel
            key={stop.key}
            {...labelPlace(chart, place, position)}
            shown={shown}
            dim={dimmed(stop)}
            entering={bar.phase === 'entering'}
            delay={cascadeDelay(bar, stop.index)}
          >
            {text}
          </BarLabel>
        )
      })}
    </>
  )
}

/**
 * The total of each category's stack, written past its end, for stacked
 * bars, whose length the tooltip alone would otherwise tell.
 */
type BarTotalsProps = Omit<ComponentProps<'div'>, 'children'> & {
  format?: ChartFormat
}

/**
 * The series a stack's total adds: the shown bars read against the chart's
 * own value axis, never a line or a point beside them, or a bar on an axis
 * of its own.
 */
function totalled(chart: Pick<ChartRootState, 'series' | 'hidden' | 'config'>) {
  return chart.series.filter(
    (key) =>
      !chart.hidden.includes(key) &&
      (chart.config[key]?.mark ?? 'bar') === 'bar' &&
      (chart.config[key]?.axis ?? VALUE_AXIS) === VALUE_AXIS,
  )
}

/** The total of a stop's shown series, each read with `valueOf`. */
function totalOf(valueOf: (key: string) => unknown, shown: readonly string[]) {
  return shown.reduce((sum, key) => sum + (numberOf(valueOf(key)) ?? 0), 0)
}

function BarTotals(props: BarTotalsProps) {
  const { format, className, ...rest } = props
  useDeclared('BarTotals', BarTotals.declare(props), cartesianSignature)
  const chart = useCartesian()
  const { spotlit } = useChartActive()
  const bar = useBarFrame()
  const write = formatterOf(chart.locale, format ?? chart.format)
  // A series with rows of its own stacks with nothing, so it adds to no total.
  const shown = totalled(chart).filter(bar.model.totals)
  const scale = bar.model.y.value
  const zero = bar.model.baselines.value
  if (chart.status !== 'ready') return null
  return (
    <div
      data-slot='bar-chart-totals'
      aria-hidden
      className={cn(plotLayerClassName, 'z-20', className)}
      {...rest}
    >
      {/* A stop where only a series' own rows are has no stack. */}
      {chart.stops.flatMap((stop) => {
        if (stop.datum === null) return []
        const total = totalOf((key) => chart.valueOf(key, stop), shown)
        const place = {
          band: stop.band,
          from: zero,
          to:
            stop.leaving || !chart.entered
              ? zero
              : scale.place(farEnd(bar.model.spans, shown, stop.index)),
        }
        return [
          <BarLabel
            key={stop.key}
            {...labelPlace(chart, place, 'outside')}
            shown={
              chart.entered &&
              !stop.leaving &&
              labelFits(chart, place, write(total), 'outside')
            }
            dim={bar.lights === 'stop' && spotlit !== null && spotlit !== stop.index}
          >
            {chart.stack === 'expand' ? '' : write(total)}
          </BarLabel>,
        ]
      })}
    </div>
  )
}

// The totals keep room for themselves past the value axis's far end.
BarTotals.declare = ({ format }: BarTotalsProps): ChartPartDeclaration => ({
  room: (chart) => {
    const write = formatterOf(chart.locale, format ?? chart.format)
    const shown = totalled(chart)
    return outsideRoom(
      chart,
      chart.stack === 'expand'
        ? []
        : chart.rows.map((row) => write(totalOf((key) => row[key], shown))),
    )
  },
})

/**
 * Whether each row of a bridge is a total: its category is in `totals`.
 * Throws on what a bridge can't be: on times, stacked, or with a total no
 * row has.
 */
function bridgeTotals(
  props: Pick<BarChartProps, 'data' | 'index' | 'indexType'>,
  stack: ChartStack,
  totals: readonly string[],
): boolean[] {
  if (props.indexType === 'time') {
    throw new Error(
      'A bridge steps through named changes, not times: leave out `indexType="time"`.',
    )
  }
  if (stack !== 'none') {
    throw new Error(
      'A bridge doesn’t stack: its one series runs from each step to the next.',
    )
  }
  const names = props.data.map((row) => String(row[props.index]))
  const unknown =
    props.data.length > 0 ? totals.find((name) => !names.includes(name)) : undefined
  if (unknown !== undefined) {
    throw new Error(
      `\`totals\` names "${unknown}", which no row's \`${props.index}\` has. Name a total by its category.`,
    )
  }
  return names.map((name) => totals.includes(name))
}

export {
  Bar,
  BarChart,
  type BarChartProps,
  type BarLabelPosition,
  type BarProps,
  BarTotals,
  bridgeTotals,
  ribbonsAllowed,
}
