'use client'

import { slotBand } from '@/registry/lib/chart-bar-marks'
import {
  barClip,
  BarLabel,
  type BarPlace,
  BarPlaceholder,
  BarShape,
  labelFits,
  labelPlace,
  missingMark,
  outsideRoom,
  placeholderClip,
} from '@/registry/lib/chart-bars'
import {
  type CategoryChartProps,
  type ChartWords,
  type EntrancePhase,
  figureProps,
  pickedName,
  useChartActive,
  useDeclared,
} from '@/registry/lib/chart-base'
import {
  CartesianChartFrame,
  type CartesianChartValue,
  cartesianSignature,
  type CartesianStop,
  cartesianTable,
  type ChartPartDeclaration,
  type ChartRoomState,
  useCartesian,
  useCartesianChart,
} from '@/registry/lib/chart-cartesian'
import type { MarkKind } from '@/registry/lib/chart-frame'
import {
  cascadeAt,
  type ChartDatum,
  type ChartOrientation,
  numberOf,
  plotPoint,
  type SeriesValueOf,
  seriesSpans,
} from '@/registry/lib/chart-math'
import {
  ChartNumber,
  type ChartItem,
  forcedSeriesColor,
  formatterOf,
  plotLayerClassName,
  seriesColor,
  swatchClassName,
  swatchStyle,
  tooltipQuietClassName,
} from '@/registry/lib/chart-root'
import type { BandGaps } from '@/registry/lib/chart-scale'
import { numberFormatter } from '@/registry/lib/number-format'
import { type ComponentProps, createContext, Fragment, use } from 'react'

import { cn } from '@/lib/utils'

/*
 * The Funnel chart: how many get through each step, such as sign-up to
 * paid, as bars on one baseline. Behind each step's bar stands a lighter
 * one as tall as the step before, the people who dropped off between them,
 * and over each column its rate rolls to every new value: its share of the
 * first step, or of the step before. Two periods compare as bars side by
 * side. The bars are the Bar chart's own, on the same cartesian frame, so a
 * funnel moves, dims and loads as every bar does; the step under the
 * pointer stays bright while the rest step back.
 */

/** What each step's rate is a share of: the first step, or the step before it. */
type FunnelRate = 'first' | 'previous'

interface FunnelChartProps extends Omit<CategoryChartProps, 'ordered'> {
  /** Upright bars over the steps, or bars lying along them. */
  orientation?: ChartOrientation
  /**
   * How the bars arrive the first time the chart comes into view: all
   * rising together, one step after another, or simply there, the default,
   * since a page that loads doesn't animate into place.
   */
  entrance?: 'rise' | 'cascade' | 'none'
  /** The space between two steps, as a share of one step. */
  categoryGap?: number
  /** The space between bars side by side, as a share of one bar's slot. */
  barGap?: number
  /** Draws the step before behind each step's bar, lighter, for those who dropped off between them. */
  drop?: boolean
}

/** One step of one series: its value, its shares of the first step and of the step before, and how many dropped off since. */
interface FunnelStep {
  value: number | null
  /** The step before's value; none for the first step. */
  previous: number | null
  ofFirst: number | null
  ofPrevious: number | null
  /** How many the step before had that this one hasn't; none when this one has more. */
  dropped: number | null
}

interface FunnelContextValue {
  /** Each series' steps, in the data's order. */
  steps: Record<string, readonly FunnelStep[]>
  drop: boolean
  phase: EntrancePhase
  fromPlaceholder: boolean
  entrance: NonNullable<FunnelChartProps['entrance']>
  /** How far through the cascade each step's bars start. */
  cascade: readonly number[]
  barGap: number
}

const FunnelContext = createContext<FunnelContextValue | null>(null)

function useFunnelChart() {
  const funnel = use(FunnelContext)
  if (!funnel) throw new Error('`Funnel` goes inside a `FunnelChart`.')
  return funnel
}

/** How tall the placeholder's bars stand, as fractions of the plot: a typical funnel, knowing nothing of the data. */
const PLACEHOLDER_VALUES = [0.92, 0.68, 0.5, 0.36, 0.24] as const

/** How rates are written: whole percents, with a tenth below 10%, where a whole one hides the change. */
const RATE_FORMAT = { style: 'percent', maximumFractionDigits: 1 } as const

const funnelChartKeys = ['orientation', 'entrance', 'categoryGap', 'barGap', 'drop']

/** Every series at a step, read along the steps. */
const X_BROWSE = { kind: 'x' } as const

/** The legend's keys are plain swatches. */
function noMarker() {
  return null
}

/**
 * The chart's root: it works out each series' steps from the data, and
 * lays out the frame its parts draw in.
 */
function FunnelChart(props: FunnelChartProps) {
  const {
    config,
    orientation = 'vertical',
    entrance = 'none',
    categoryGap,
    barGap = 0.12,
    drop = true,
    locale,
    description,
    empty,
    className,
    children,
    ref,
  } = props
  const gaps: BandGaps = categoryGap === undefined ? {} : { gap: categoryGap }
  const cartesian = useCartesianChart(
    { ...props, ordered: false },
    {
      kinds: [funnelMarks(drop)],
      orientation,
      stack: 'none',
      entrance: entrance !== 'none',
      cascade:
        entrance === 'cascade'
          ? { variable: '--funnel-chart-cascade', fallback: 0.8 }
          : undefined,
      y: { nice: true },
      gaps,
    },
  )
  const { chart, model, placeholder, fromPlaceholder, phase } = cartesian
  const stops = chart.current
  const steps = Object.fromEntries(
    chart.series.map((key) => [
      key,
      funnelSteps(stops.map((stop) => numberOf(chart.valueOf(key, stop)))),
    ]),
  )
  const shown = chart.series.filter((key) => !chart.hidden.includes(key))
  const cascade = stops.map((_, at) => cascadeAt(at, stops.length, 'start'))
  const write = chart.valueText
  const writeRate = numberFormatter(locale, RATE_FORMAT)
  const { messages } = chart
  /**
   * A step's value, its shares and its drop, as written; briefly, the first
   * step's share of itself and the second's of the first, which is its
   * share of the step before, are left out.
   */
  const figures = (key: string, at: number, brief = true) => {
    const step = steps[key]?.[at]
    if (!step) return []
    return [
      step.value === null ? messages.noValue : write(step.value),
      step.ofFirst === null || (brief && at < 2) ? '' : writeRate.format(step.ofFirst),
      step.ofPrevious === null ? '' : writeRate.format(step.ofPrevious),
      step.dropped === null ? '' : write(step.dropped),
    ] as const
  }
  const terms = [messages.ofFirst, messages.ofPrevious, messages.droppedOff] as const
  const nameOf = (key: string) => {
    const label = config[key]?.label
    return typeof label === 'string' ? label : key
  }
  const words: ChartWords = {
    describe: (stop) => {
      const name = pickedName(chart.stopText(stop), chart.selected === stop.key, messages)
      const said = shown
        .map((key) => {
          const [value, ...rest] = figures(key, stop.index)
          const more = rest.flatMap((figure, w) =>
            figure ? `${terms[w]} ${figure}` : [],
          )
          return [`${nameOf(key)} ${value}`, ...more].join(', ')
        })
        .join('; ')
      return `${name}: ${said}`
    },
    tooltip: (stop) => (
      <FunnelTooltipContent
        chart={chart}
        stop={stop}
        shown={shown}
        figures={figures}
        terms={terms}
      />
    ),
    table: cartesianTable(
      chart,
      shown.flatMap((key) => {
        const name = nameOf(key)
        return shown.length === 1
          ? [name, ...terms]
          : [name, ...terms.map((term) => `${name}, ${term}`)]
      }),
      (stop) => shown.flatMap((key) => figures(key, stop.index, false)),
    ),
  }

  return (
    <FunnelContext
      value={{ steps, drop, phase, fromPlaceholder, entrance, cascade, barGap }}
    >
      <CartesianChartFrame
        chart={cartesian}
        ref={ref}
        slot='funnel-chart'
        description={description}
        empty={empty}
        className={className}
        placeholder={
          placeholder && <BarPlaceholder chart={chart} values={PLACEHOLDER_VALUES} />
        }
        markerOf={noMarker}
        // The tooltip sits on the top of the step's columns: the tallest bar, or the step before's behind it.
        anchor={(stop) => {
          const along = chart.entered ? model.reach(stop.index) : null
          return plotPoint(
            stop.band,
            along ?? model.baselines.value,
            orientation,
            chart.direction,
          )
        }}
        words={words}
        browse={X_BROWSE}
        {...figureProps(props, funnelChartKeys)}
      >
        {children}
      </CartesianChartFrame>
    </FunnelContext>
  )
}

/**
 * A step's values in the tooltip: for each shown series its value, and
 * after the first step its shares of the first step and of the step
 * before, and how many dropped off, each under its series.
 */
function FunnelTooltipContent({
  chart,
  stop,
  shown,
  figures,
  terms,
}: {
  chart: CartesianChartValue
  stop: ChartItem
  shown: readonly string[]
  figures: (key: string, at: number) => readonly string[]
  terms: readonly string[]
}) {
  const { id, series, config, patternOf, emphasis } = chart
  return (
    // The tooltip sits outside the chart, so it carries the chart's id for its colours.
    <div data-chart={id} className='grid min-w-40 gap-1'>
      <div className='font-medium'>{chart.stopText(stop)}</div>
      {shown.map((key) => {
        const [value, ...rest] = figures(key, stop.index)
        return (
          <div
            key={key}
            data-lit={emphasis === key ? '' : undefined}
            className='group/row grid gap-0.5'
          >
            <div className='flex items-center gap-2'>
              <span
                aria-hidden
                className={cn(swatchClassName, forcedSeriesColor(series.indexOf(key)))}
                style={swatchStyle(key, patternOf(key))}
              />
              <span className={cn(tooltipQuietClassName, 'min-w-0 flex-1 truncate')}>
                {config[key]?.label ?? key}
              </span>
              <span dir='auto' className='font-medium tabular-nums'>
                {value}
              </span>
            </div>
            {rest.map(
              (figure, w) =>
                figure && (
                  <div key={terms[w]} className='flex items-center gap-2 ps-4'>
                    <span className={cn(tooltipQuietClassName, 'flex-1')}>
                      {terms[w]}
                    </span>
                    <span dir='auto' className='tabular-nums'>
                      {figure}
                    </span>
                  </div>
                ),
            )}
          </div>
        )
      })}
    </div>
  )
}

/** The part of the step's band that series `key` takes, beside the other shown series. */
function slotOf(
  chart: CartesianChartValue,
  funnel: FunnelContextValue,
  stop: CartesianStop,
  key: string,
) {
  const order = chart.series.filter((k) => k === key || !chart.hidden.includes(k))
  return slotBand(stop.band, order.indexOf(key), order.length, funnel.barGap)
}

/**
 * Where the bar of `key` stands on `stop`, and, behind it, the step
 * before's: from zero to each value. A hidden series, a missing value, a
 * bar that hasn't risen yet and a step that leaves all stand at zero; a
 * step that has more than the one before has nothing behind it, so its
 * drop sinks into the bar's end.
 */
function funnelPlaces(
  chart: CartesianChartValue,
  funnel: FunnelContextValue,
  stop: CartesianStop,
  key: string,
): { bar: BarPlace; drop: BarPlace } {
  const band = slotOf(chart, funnel, stop, key)
  const { scale } = chart.frame.y.value
  const zero = scale.place(0)
  const step = funnel.steps[key]?.[stop.index]
  const standing = step && !stop.leaving && chart.entered && !chart.hidden.includes(key)
  if (!standing) {
    return {
      bar: { band, from: zero, to: zero },
      drop: { band, from: zero, to: zero },
    }
  }
  const value = scale.place(step.value ?? 0)
  // A missing step shows its dashed mark alone: nothing is known to have dropped off before it.
  const before = scale.place(
    funnel.drop && step.value !== null
      ? Math.max(step.value, step.previous ?? 0)
      : (step.value ?? 0),
  )
  return {
    bar: { band, from: zero, to: value },
    drop: { band, from: zero, to: before },
  }
}

type FunnelProps = Omit<ComponentProps<'div'>, 'children' | 'color'> & {
  /** The key of this series' values in the data, and of its entry in the config. */
  dataKey: string
  /** A colour for one step's bar, such as one that stands out, from its row; the series' colour when it returns nothing. */
  color?: (datum: ChartDatum, index: number) => string | undefined
  /** What each column writes over it: the step's rate, its value, or nothing. */
  label?: 'rate' | 'value' | 'none'
  /** What each step's rate over its column is a share of; the first step by default. */
  rate?: FunnelRate
}

/**
 * One series' steps: a bar for each, in the series' colour, with the step
 * before standing lighter behind it, and its rate or value over the
 * column. While the chart enters, the bars rise on `draw`, one step after
 * another with `entrance='cascade'`; after that every change moves on
 * `layout`. A missing value shows a short dashed mark at zero, so it reads
 * apart from a zero.
 */
function Funnel(props: FunnelProps) {
  const {
    dataKey,
    color,
    label = 'rate',
    rate = 'first',
    className,
    style,
    ...rest
  } = props
  useDeclared('Funnel', Funnel.declare(props), cartesianSignature)
  const chart = useCartesian()
  const { spotlit } = useChartActive()
  const funnel = useFunnelChart()
  const { locale } = chart
  const steps = funnel.steps[dataKey] ?? []
  const writeRate = numberFormatter(locale, RATE_FORMAT)
  const textOf = (step: FunnelStep | undefined) =>
    labelText(step, label, rate, chart.valueText, (share) => writeRate.format(share))
  if (chart.status === 'empty') return null
  const slot = chart.series.indexOf(dataKey)
  const shown = chart.series.filter((key) => !chart.hidden.includes(key))
  // The widest label of any shown series' steps, so side by side they all fit or all go.
  const widest = Math.max(
    0,
    ...shown.flatMap((key) =>
      chart.current.map((stop) =>
        chart.textWidth(textOf(funnel.steps[key]?.[stop.index])),
      ),
    ),
  )
  const zero = chart.frame.y.value.scale.place(0)
  const dimmed = (stop: CartesianStop) =>
    (spotlit !== null && spotlit !== stop.index) ||
    (chart.emphasis !== null && chart.emphasis !== dataKey)
  return (
    <>
      <div
        data-slot='funnel-chart-series'
        data-series={dataKey}
        aria-hidden
        className={cn(plotLayerClassName, 'z-10', className)}
        style={style}
        {...rest}
      >
        {chart.stops.map((stop) => {
          const places = funnelPlaces(chart, funnel, stop, dataKey)
          const step = steps[stop.index]
          const own =
            (stop.datum ? color?.(stop.datum, stop.index) : undefined) ??
            seriesColor(dataKey)
          const at = Math.min(stop.index, PLACEHOLDER_VALUES.length - 1)
          // A bar that arrives grows out of the placeholder in its place, or up from zero.
          const from = funnel.fromPlaceholder
            ? placeholderClip(
                chart,
                at,
                PLACEHOLDER_VALUES[at]!,
                PLACEHOLDER_VALUES.length,
              )
            : barClip(chart, { band: places.bar.band, from: zero, to: zero }, true)
          const missing =
            !stop.leaving &&
            chart.entered &&
            !chart.hidden.includes(dataKey) &&
            step?.value === null
          const delay = cascadeDelay(funnel, stop.index)
          const dim = dimmed(stop)
          const entering = funnel.phase === 'entering'
          return (
            <Fragment key={stop.key}>
              {funnel.drop && stop.index > 0 && (
                <BarShape
                  clip={barClip(chart, places.drop, true)}
                  from={from}
                  dim={dim}
                  entering={entering}
                  delay={delay}
                  color={`color-mix(in oklab, ${own} calc(var(--funnel-chart-drop-opacity, 0.22) * 100%), transparent)`}
                  images=''
                  slot={slot}
                  forced='forced-colors:bg-[GrayText]'
                  track={undefined}
                  missing={undefined}
                />
              )}
              <BarShape
                clip={barClip(chart, places.bar, true)}
                from={from}
                dim={dim}
                entering={entering}
                delay={delay}
                color={own}
                images=''
                slot={slot}
                track={undefined}
                missing={
                  missing
                    ? missingMark(chart, places.bar.band, chart.frame.baselines.value)
                    : undefined
                }
              />
            </Fragment>
          )
        })}
      </div>
      {label !== 'none' && chart.status === 'ready' && (
        // Above the reference lines, so a line across a value never runs through it.
        <div aria-hidden className={cn(plotLayerClassName, 'z-20')}>
          {chart.stops.map((stop) => {
            const { bar, drop: behind } = funnelPlaces(chart, funnel, stop, dataKey)
            const step = steps[stop.index]
            const text = textOf(step)
            const top = funnel.drop ? behind : bar
            const across =
              top.band.size *
              (chart.orientation === 'vertical'
                ? chart.plotSize.width
                : chart.plotSize.height)
            const fits =
              labelFits(chart, top, text, 'outside') &&
              // Beside another series' labels, each keeps to its own bar's width, and every
              // series shows its labels or none does, so no rate stands alone.
              (shown.length === 1 ||
                chart.orientation === 'horizontal' ||
                across >= widest + 4)
            const value = step && (label === 'value' ? step.value : rateOf(step, rate))
            return (
              <BarLabel
                key={stop.key}
                {...labelPlace(chart, top, 'outside')}
                // A hidden series' labels fade as its bars sink.
                shown={
                  !stop.leaving && !chart.hidden.includes(dataKey) && text !== '' && fits
                }
                dim={dimmed(stop)}
                entering={funnel.phase === 'entering'}
                delay={cascadeDelay(funnel, stop.index)}
              >
                {value !== null && value !== undefined && (
                  <ChartNumber
                    value={value}
                    locale={locale}
                    format={label === 'value' ? chart.format : RATE_FORMAT}
                  />
                )}
              </BarLabel>
            )
          })}
        </div>
      )}
    </>
  )
}

// A funnel is its series; its labels over the columns keep room for themselves past the value
// axis's far end, worked out from what they will read.
Funnel.declare = ({
  dataKey,
  label = 'rate',
  rate = 'first',
}: FunnelProps): ChartPartDeclaration => ({
  series: { key: dataKey, mark: 'bar' },
  ...(label === 'none'
    ? {}
    : { room: (chart: ChartRoomState) => funnelRoom(chart, dataKey, label, rate) }),
})

/** The share a step's label writes: of the first step, or of the step before. */
function rateOf(step: FunnelStep, rate: FunnelRate) {
  return rate === 'first' ? step.ofFirst : step.ofPrevious
}

/** What a step's label reads: its rate, its value, or nothing for none or a missing one. */
function labelText(
  step: FunnelStep | undefined,
  label: NonNullable<FunnelProps['label']>,
  rate: FunnelRate,
  write: (value: number) => string,
  writeRate: (share: number) => string,
) {
  if (!step || label === 'none') return ''
  if (label === 'value') return step.value === null ? '' : write(step.value)
  const share = rateOf(step, rate)
  return share === null ? '' : writeRate(share)
}

/** The room past the value axis's far end that the labels of the series `dataKey` take, in px, from the rows the chart draws. */
function funnelRoom(
  chart: ChartRoomState,
  dataKey: string,
  label: NonNullable<FunnelProps['label']>,
  rate: FunnelRate,
) {
  const write = formatterOf(chart.locale, chart.format)
  const writeRate = numberFormatter(chart.locale, RATE_FORMAT)
  const steps = funnelSteps(chart.rows.map((row) => numberOf(row[dataKey])))
  return outsideRoom(
    chart,
    steps.map((step) =>
      labelText(step, label, rate, write, (share) => writeRate.format(share)),
    ),
  )
}

/** How long the bars of the step at `index` wait in a cascade's entrance; none otherwise. */
function cascadeDelay(funnel: FunnelContextValue, index: number) {
  return funnel.entrance === 'cascade' && funnel.phase === 'entering'
    ? `calc(var(--motion-draw-duration) * var(--funnel-chart-cascade, 0.8) * ${funnel.cascade[index] ?? 0})`
    : undefined
}

/**
 * Each step of one series from its values in order: its shares of the
 * first step and of the step before, and how many dropped off since. A
 * share of a missing or zero step, and a drop from or to a missing one,
 * is none.
 */
function funnelSteps(values: readonly (number | null)[]): FunnelStep[] {
  const first = values[0] ?? null
  return values.map((value, at) => {
    const previous = at === 0 ? null : (values[at - 1] ?? null)
    const share = (of: number | null) =>
      value === null || of === null || of <= 0 ? null : value / of
    return {
      value,
      previous,
      ofFirst: share(first),
      ofPrevious: share(previous),
      dropped:
        value === null || previous === null || previous < value ? null : previous - value,
    }
  })
}

/**
 * How high the tallest column of `count` steps stands across the `keys`
 * shown, each value read with `valueOf`: each step's own value, or with
 * `drop` the step before's, which stands behind any step that has a value.
 * With `at`, only that step's column, with the step before it standing
 * behind.
 */
function columnTop(
  count: number,
  valueOf: SeriesValueOf,
  keys: readonly string[],
  drop: boolean,
  at?: number,
): number {
  let top = 0
  const first = at ?? 0
  const end = at === undefined ? count : Math.min(at + 1, count)
  for (let step = first; step < end; step += 1) {
    for (const key of keys) {
      const own = numberOf(valueOf(key, step))
      // A missing step has nothing standing behind it.
      const behind =
        drop && step > 0 && own !== null ? (numberOf(valueOf(key, step - 1)) ?? 0) : 0
      top = Math.max(top, own ?? 0, behind)
    }
  }
  return top
}

/**
 * A funnel's bars as a kind of mark on the cartesian frame: each step's bar
 * from zero to its value, side by side and never stacked, with the value
 * axis reaching the tallest column, the step before's behind it with
 * `drop`, which the tooltip sits on too.
 */
function funnelMarks(drop: boolean): MarkKind {
  return {
    mark: 'bar',
    stacks: false,
    spans: ({ count, valueOf, series, shown }) => ({
      spans: seriesSpans(count, valueOf, series, 'none'),
      extent: [0, columnTop(count, valueOf, shown, drop)],
    }),
    reach: (spans, shown, index, scale) =>
      scale.place(
        columnTop(
          index + 1,
          (key, at) => spans[key]?.[at]?.[1] ?? null,
          shown,
          drop,
          index,
        ),
      ),
  }
}

export {
  Funnel,
  FunnelChart,
  type FunnelChartProps,
  type FunnelProps,
  type FunnelRate,
  type FunnelStep,
  columnTop,
  funnelMarks,
  funnelSteps,
}
