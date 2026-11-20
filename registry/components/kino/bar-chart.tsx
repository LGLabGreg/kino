'use client'

import {
  CategoryChartFrame,
  type CategoryChartProps,
  type ChartCategory,
  type ChartContextValue,
  type ChartFormat,
  type EntrancePhase,
  figureProps,
  forcedSeriesColor,
  formatterOf,
  patternImage,
  plotLayerClassName,
  seriesColor,
  useCategoryChart,
  useChart,
  useChartActive,
} from '@/registry/lib/chart-core'
import {
  type Band,
  type BandGaps,
  cascadeAt,
  categoryBand,
  type ChartDatum,
  type ChartOrientation,
  type ChartStack,
  fractionOf,
  numberOf,
  physicalStart,
  plotPoint,
  rangeOf,
  reachOf,
  type ReadingDirection,
  hiddenSpans,
  seriesSpans,
  type Span,
  spanExtent,
  stacksOf,
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
  useLayoutEffect,
} from 'react'

import { cn } from '@/lib/utils'

/*
 * The Bar chart: values across categories, side by side, stacked, or as
 * shares, upright or lying. Each bar is the clip of a layer as large as the
 * plot, so a new value, a new range, a series hidden or the categories
 * sorted is one CSS transition of each bar, which turns back from wherever
 * it is. The category under the pointer stays bright while the rest step
 * back, and the tooltip sits on the end of its bars.
 */

interface BarChartProps extends CategoryChartProps {
  /** Upright bars over the categories, or bars lying along them. */
  orientation?: ChartOrientation
  /** How each category's series combine: side by side, stacked, or stacked as shares of their total. */
  stack?: ChartStack
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

interface BarContextValue {
  spans: Record<string, (Span | null)[]>
  /** Where each hidden series would sit, so it shrinks into place and grows back out of it. */
  hiddenSpans: Record<string, (Span | null)[]>
  phase: EntrancePhase
  /** The chart was loading, so its bars grow out of the placeholder. */
  fromPlaceholder: boolean
  entrance: NonNullable<BarChartProps['entrance']>
  /** How far through the cascade each category's bars start, by its place in the data. */
  cascade: readonly number[]
  barGap: number
  stackOf: (key: string) => string
}

const BarContext = createContext<BarContextValue | null>(null)

function useBarChart() {
  const bar = use(BarContext)
  if (!bar) throw new Error('`Bar` goes inside a `BarChart`.')
  return bar
}

const PLACEHOLDER_COUNT = 7

const barChartKeys = [
  'orientation',
  'stack',
  'entrance',
  'cascadeFrom',
  'categoryGap',
  'barGap',
  'describe',
]

/**
 * The chart's root: it works out each series' bars from the data, and
 * lays out the frame its parts draw in.
 */
function BarChart(props: BarChartProps) {
  const {
    config,
    orientation = 'vertical',
    stack = 'none',
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
  const stackOf = (key: string) => config[key]?.stack ?? ''
  const gaps: BandGaps = categoryGap === undefined ? {} : { gap: categoryGap }
  const { chart, shapes, rows, root, placeholder, fromPlaceholder, phase } =
    useCategoryChart(props, {
      orientation,
      stack,
      entrance: entrance !== 'none',
      moveProperty: 'clip-path',
      nice: stack !== 'expand',
      bandOf: (index, count) => categoryBand(index, count, gaps),
      measure: (data, shown) => {
        const series = Object.keys(config)
        const spans = seriesSpans(data, shown, stack, stackOf)
        return {
          spans,
          hiddenSpans: hiddenSpans(data, series, shown, stack, stackOf),
          extent: spanExtent(spans),
        }
      },
    })
  const shown = chart.series.filter((key) => !chart.hidden.includes(key))
  const reaches = rows.map((_, at) => farEnd(shapes.spans, shown, at))
  const order = reaches
    .map((reach, at) => ({ at, size: Math.abs(reach) }))
    .toSorted((a, b) => b.size - a.size)
  const cascade = rows.map((_, at) =>
    cascadeFrom === 'value'
      ? cascadeAt(
          at,
          rows.length,
          'start',
          order.findIndex((o) => o.at === at),
        )
      : cascadeAt(at, rows.length, cascadeFrom),
  )
  const full: ChartContextValue = {
    ...chart,
    ...(describe && {
      describe: (at: number) => {
        const category = chart.current[at]
        return category ? describe.text(category.datum) : ''
      },
      table: {
        columns: [describe.name],
        cells: (category: ChartCategory) => [describe.text(category.datum)],
      },
    }),
    // The tooltip sits on the far end of the category's bars: the tallest, or the stack's top.
    pointOf: (at) => {
      const category = chart.current[at]
      if (!category) return null
      const reach = chart.entered ? (reaches[at] ?? 0) : 0
      return plotPoint(
        category.band,
        fractionOf(reach, chart.scale.domain),
        orientation,
        chart.direction,
      )
    },
  }

  return (
    <BarContext
      value={{
        spans: shapes.spans,
        hiddenSpans: shapes.hiddenSpans,
        phase,
        fromPlaceholder,
        entrance,
        cascade,
        barGap,
        stackOf,
      }}
    >
      <CategoryChartFrame
        chart={full}
        root={root}
        ref={ref}
        slot='bar-chart'
        description={description}
        empty={empty}
        className={className}
        placeholder={placeholder && <BarPlaceholder chart={full} />}
        {...figureProps(props, barChartKeys)}
      >
        {children}
      </CategoryChartFrame>
    </BarContext>
  )
}

/** How far the bars of row `index` reach from zero: the highest above it, or, with none above, the lowest below. */
function farEnd(
  spans: Record<string, readonly (Span | null)[]>,
  keys: readonly string[],
  index: number,
) {
  const up = reachOf(spans, keys, index)
  return up > 0 ? up : reachOf(spans, keys, index, true)
}

/** Where a bar stands: the band it takes and the span of the value axis it covers, as fractions. */
interface BarPlace {
  band: Band
  from: number
  to: number
}

/**
 * Where the bar of `key` in `category` stands: in its slot of the band
 * side by side, or across the band stacked, beside the chart's other stacks.
 * A hidden series, a missing value, a bar that hasn't risen yet and a
 * category that leaves all stand at zero.
 */
function barPlace(
  chart: ChartContextValue,
  bar: BarContextValue,
  category: ChartCategory,
  key: string,
): BarPlace {
  const { series, hidden, stack, scale } = chart
  const isHidden = hidden.includes(key)
  const order = series.filter((k) => k === key || !hidden.includes(k))
  const stacks = stacksOf(order, bar.stackOf)
  const band =
    stack === 'none'
      ? slotBand(category.band, order.indexOf(key), order.length, bar.barGap)
      : slotBand(
          category.band,
          stacks.indexOf(bar.stackOf(key)),
          stacks.length,
          bar.barGap,
        )
  const zero = fractionOf(0, scale.domain)
  const span = category.leaving
    ? null
    : (isHidden ? bar.hiddenSpans[key] : bar.spans[key])?.[category.index]
  if (!span || !chart.entered) return { band, from: zero, to: zero }
  return {
    band,
    from: fractionOf(span[0], scale.domain),
    to: fractionOf(span[1], scale.domain),
  }
}

/** The bar's shape as a clip, rounded at the end its value reaches. */
function barClip(chart: ChartContextValue, place: BarPlace, outermost: boolean) {
  const insets = barInsets(
    place.band,
    place.from,
    place.to,
    chart.orientation,
    chart.direction,
  )
  const positive = place.to >= place.from
  const corners = outermost
    ? roundCorners(chart.orientation, chart.direction, positive)
    : ([false, false, false, false] as const)
  const far =
    place.to === place.from
      ? undefined
      : farSide(chart.orientation, chart.direction, positive)
  return barClipPath(insets, corners, chart.orientation, far)
}

/** Whether the bar of `key` is the last of its stack on its side of zero, which takes the round end. */
function isOutermost(
  chart: ChartContextValue,
  bar: BarContextValue,
  category: ChartCategory,
  key: string,
) {
  if (chart.stack === 'none') return true
  const own = bar.spans[key]?.[category.index]
  if (!own || rangeOf(category.datum[key])) return true
  const positive = own[1] >= own[0]
  const shown = chart.series.filter(
    (k) => !chart.hidden.includes(k) && bar.stackOf(k) === bar.stackOf(key),
  )
  const after = shown.slice(shown.indexOf(key) + 1)
  return !after.some((k) => {
    const span = bar.spans[k]?.[category.index]
    return (
      span &&
      !rangeOf(category.datum[k]) &&
      span[1] !== span[0] &&
      span[1] >= span[0] === positive
    )
  })
}

/**
 * The placeholder while the data loads: one bar for each of a few
 * categories, at uneven heights, breathing slowly. It fades in while the
 * bars there were shrink away, and the real bars grow out of it when the
 * data arrives.
 */
function BarPlaceholder({ chart }: { chart: ChartContextValue }) {
  return (
    <div
      data-slot='bar-chart-placeholder'
      aria-hidden
      className={cn(
        plotLayerClassName,
        'z-10 transition-opacity duration-(--motion-enter-duration) ease-(--motion-enter-easing) group-data-mounted/chart:starting:opacity-0',
      )}
    >
      <div className={cn('absolute inset-0', placeholderBreatheClassName)}>
        {placeholderValues(PLACEHOLDER_COUNT).map((value, at) => (
          <div
            // oxlint-disable-next-line react/no-array-index-key -- a fixed row
            key={at}
            className={cn('absolute inset-0', placeholderFillClassName)}
            style={{ clipPath: placeholderClip(chart, at, value) }}
          />
        ))}
      </div>
    </div>
  )
}

function placeholderClip(chart: ChartContextValue, at: number, value: number) {
  const band = categoryBand(at, PLACEHOLDER_COUNT)
  return barClipPath(
    barInsets(band, 0, value, chart.orientation, chart.direction),
    roundCorners(chart.orientation, chart.direction, true),
    chart.orientation,
  )
}

/** Where a value label sits on its bar: past its end, just inside it, or in its middle. */
type BarLabelPosition = 'outside' | 'inside' | 'center'

/** The room a label past the bars' ends takes along the value axis, in px: a line of text upright; lying, its width and the gap before it. */
const OUTSIDE_ROOM = { vertical: 18, gap: 10 } as const

/** The room past the bars' ends that labels reading `texts` take, in px. */
function outsideRoom(chart: ChartContextValue, texts: readonly string[]) {
  if (chart.orientation === 'vertical') return OUTSIDE_ROOM.vertical
  return Math.ceil(Math.max(0, ...texts.map(chart.textWidth)) + OUTSIDE_ROOM.gap)
}

/** What a bar's label reads: its value, its range, or nothing for a missing value. */
function labelText(raw: unknown, write: (value: number) => string) {
  const range = rangeOf(raw)
  if (range) return `${write(range[0])} – ${write(range[1])}`
  const number = numberOf(raw)
  return number === null ? '' : write(number)
}

type BarProps = Omit<ComponentProps<'div'>, 'children' | 'color'> & {
  /** The key of this series' values in the data, and of its entry in the config. */
  dataKey: string
  /** A colour for one bar, such as one that stands out, from its row; the series' colour when it returns nothing. */
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
function Bar({
  dataKey,
  color,
  negativeColor,
  label = false,
  labelFormat,
  track = false,
  fill = 'solid',
  className,
  style,
  ...props
}: BarProps) {
  const chart = useChart()
  const { spotlit } = useChartActive()
  const bar = useBarChart()
  const position: BarLabelPosition | null = label === true ? 'outside' : label || null
  const { addRoom, orientation } = chart
  const write = formatterOf(chart.locale, labelFormat ?? chart.format)
  const room =
    position === 'outside'
      ? outsideRoom(
          chart,
          chart.current.map((category) => labelText(category.datum[dataKey], write)),
        )
      : 0
  useLayoutEffect(() => (room > 0 ? addRoom(room) : undefined), [addRoom, room])
  if (chart.status === 'empty') return null
  const slot = chart.series.indexOf(dataKey)
  const cascading = bar.entrance === 'cascade' && bar.phase === 'entering'
  const zero = fractionOf(0, chart.scale.domain)
  const pattern = patternImage(chart.patternOf(dataKey))
  const gradient =
    fill === 'gradient'
      ? `linear-gradient(${orientation === 'vertical' ? 'to top' : chart.direction === 'rtl' ? 'to left' : 'to right'}, color-mix(in oklab, var(--bar-fill) 35%, transparent), var(--bar-fill))`
      : undefined
  const images = [pattern, gradient].filter(Boolean).join(', ')
  const dimmed = (category: ChartCategory) =>
    (spotlit !== null && spotlit !== category.index) ||
    (chart.emphasis !== null && chart.emphasis !== dataKey)
  return (
    <>
      <div
        data-slot='bar-chart-series'
        data-series={dataKey}
        aria-hidden
        className={cn(plotLayerClassName, 'z-10', className)}
        style={style}
        {...props}
      >
        {chart.categories.map((category) => {
          const place = barPlace(chart, bar, category, dataKey)
          const value = numberOf(category.datum[dataKey])
          const range = rangeOf(category.datum[dataKey])
          const below = range ? range[1] < range[0] : value !== null && value < 0
          const own =
            color?.(category.datum, category.index) ??
            (below && negativeColor ? negativeColor : undefined)
          const clip = barClip(chart, place, isOutermost(chart, bar, category, dataKey))
          const at = Math.min(category.index, PLACEHOLDER_COUNT - 1)
          // A bar that arrives grows out of the placeholder in its place, or up from zero.
          const from = bar.fromPlaceholder
            ? placeholderClip(chart, at, placeholderValues(PLACEHOLDER_COUNT)[at]!)
            : barClip(chart, { band: place.band, from: zero, to: zero }, true)
          const missing =
            !category.leaving &&
            chart.entered &&
            !chart.hidden.includes(dataKey) &&
            value === null &&
            range === null
          const delay = cascading
            ? `calc(var(--motion-draw-duration) * var(--bar-chart-cascade, 0.8) * ${bar.cascade[category.index] ?? 0})`
            : undefined
          return (
            <BarShape
              key={category.key}
              clip={clip}
              from={from}
              dim={dimmed(category)}
              entering={bar.phase === 'entering'}
              delay={delay}
              color={own ?? seriesColor(dataKey)}
              images={images}
              slot={slot}
              track={track ? trackClip(chart, place.band) : undefined}
              missing={missing ? missingMark(chart, place.band) : undefined}
            />
          )
        })}
      </div>
      {position && chart.status === 'ready' && (
        // Above the reference lines, so a line across a value never runs through it.
        <div aria-hidden className={cn(plotLayerClassName, 'z-20')}>
          <BarLabels
            dataKey={dataKey}
            position={position}
            write={write}
            dimmed={dimmed}
          />
        </div>
      )}
    </>
  )
}

/**
 * One bar: its track, the bar, and the mark of a missing value. Memoised,
 * so a pointer moving between categories redraws only the bars it lights
 * or dims.
 */
const BarShape = memo(function BarShape({
  clip,
  from,
  dim,
  entering,
  delay,
  color,
  images,
  slot,
  track,
  missing,
}: {
  clip: string
  from: string
  dim: boolean
  entering: boolean
  delay: string | undefined
  color: string
  images: string
  slot: number
  track: string | undefined
  missing: CSSProperties | undefined
}) {
  return (
    <>
      {track && (
        <div
          className='bg-foreground/6 dark:bg-foreground/10 absolute inset-0 duration-(--motion-layout-duration) ease-(--motion-layout-easing) [clip-path:var(--bar-clip)] transition-none group-data-mounted/chart:transition-[clip-path] motion-reduce:group-data-mounted/chart:transition-none forced-colors:bg-[GrayText]!'
          style={{ '--bar-clip': track } as CSSProperties}
        />
      )}
      <div
        data-entering={entering ? '' : undefined}
        data-dim={dim ? '' : undefined}
        className={cn(
          'absolute inset-0 bg-(--bar-fill) transition-none [--bar-fill:var(--bar-color)] group-data-mounted/chart:transition-[background-color,clip-path] duration-(--motion-layout-duration) ease-[var(--motion-layout-fade-easing),var(--motion-layout-easing)] [clip-path:var(--bar-clip)] group-data-mounted/chart:starting:[clip-path:var(--bar-from)] data-dim:[--bar-fill:oklch(from_var(--bar-color)_l_calc(c*var(--bar-chart-dim,0.3))_h)] data-entering:duration-(--motion-draw-duration) data-entering:ease-[var(--motion-draw-fade-easing),var(--motion-draw-easing)] motion-reduce:group-data-mounted/chart:transition-[background-color] motion-reduce:ease-(--motion-layout-fade-easing)',
          forcedSeriesColor(slot),
        )}
        style={
          {
            '--bar-color': color,
            '--bar-from': from,
            // A variable, not `clipPath`, so the class's starting shape isn't overruled by an inline style.
            '--bar-clip': clip,
            backgroundImage: images || undefined,
            transitionDelay: delay,
          } as CSSProperties
        }
      />
      {missing && (
        <div className='absolute' style={missing}>
          <div className='border-muted-foreground/60 mx-auto max-w-(--bar-chart-max-thickness,4rem) border-t-2 border-dashed forced-colors:border-[GrayText]' />
        </div>
      )}
    </>
  )
})

/** A bar's whole length, from one end of the value axis to the other, in its band. */
function trackClip(chart: ChartContextValue, band: Band) {
  return barClipPath(
    barInsets(band, 0, 1, chart.orientation, chart.direction),
    [true, true, true, true],
    chart.orientation,
  )
}

/** Where the mark of a missing value sits: across its band, on zero. */
function missingMark(chart: ChartContextValue, band: Band): CSSProperties {
  const zero = fractionOf(0, chart.scale.domain)
  const start = physicalStart(
    band,
    chart.orientation === 'vertical' ? 'inline' : 'block',
    chart.direction,
  )
  return chart.orientation === 'vertical'
    ? {
        left: `${start * 100}%`,
        width: `${band.size * 100}%`,
        bottom: `calc(${zero * 100}% - 1px)`,
      }
    : {
        top: `calc(${(band.start + band.size / 2) * 100}% - 1px)`,
        height: 2,
        width: 0,
        [chart.direction === 'rtl' ? 'right' : 'left']: `${zero * 100}%`,
      }
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
  dimmed,
}: {
  dataKey: string
  position: BarLabelPosition
  write: (value: number) => string
  dimmed: (category: ChartCategory) => boolean
}) {
  const chart = useChart()
  const bar = useBarChart()
  if (chart.hidden.includes(dataKey)) return null
  return (
    <>
      {chart.categories.map((category) => {
        const place = barPlace(chart, bar, category, dataKey)
        const span = bar.spans[dataKey]?.[category.index]
        const text = labelText(category.datum[dataKey], write)
        const outermost = isOutermost(chart, bar, category, dataKey)
        const shown =
          !category.leaving &&
          span !== null &&
          span !== undefined &&
          text !== '' &&
          (position !== 'outside' || outermost) &&
          labelFits(chart, place, text, position)
        return (
          <BarLabel
            key={category.key}
            {...labelPlace(chart, place, position)}
            shown={shown}
            dim={dimmed(category)}
          >
            {text}
          </BarLabel>
        )
      })}
    </>
  )
}

/** Where a label on the bar at `place` goes: the point it sits on, and which way is out from the bar's end. */
function labelPlace(
  chart: ChartContextValue,
  place: BarPlace,
  position: BarLabelPosition,
) {
  const { orientation, direction } = chart
  const positive = place.to >= place.from
  const along = position === 'center' ? (place.from + place.to) / 2 : place.to
  const point = plotPoint(place.band, along, orientation, direction)
  const out: 'up' | 'down' | 'left' | 'right' =
    orientation === 'vertical'
      ? positive
        ? 'up'
        : 'down'
      : positive === (direction === 'ltr')
        ? 'right'
        : 'left'
  return { x: point.x, y: point.y, out, position }
}

/**
 * A label on a bar, sliding with it: past its end, inside it, or in its
 * middle. Memoised, as the bars are.
 */
const BarLabel = memo(function BarLabel({
  x,
  y,
  out,
  position,
  shown,
  dim,
  children,
}: {
  x: number
  y: number
  out: 'up' | 'down' | 'left' | 'right'
  position: BarLabelPosition
  shown: boolean
  dim: boolean
  children: string
}) {
  const outside = position === 'outside'
  const placeClass =
    position === 'center'
      ? '-translate-x-1/2 -translate-y-1/2'
      : out === 'up'
        ? cn('-translate-x-1/2', outside ? 'bottom-1' : 'top-1')
        : out === 'down'
          ? cn('-translate-x-1/2', outside ? 'top-1' : 'bottom-1')
          : out === 'right'
            ? cn('-translate-y-1/2', outside ? 'left-1.5' : 'right-1.5')
            : cn('-translate-y-1/2', outside ? 'right-1.5' : 'left-1.5')
  return (
    <span
      data-dim={dim ? '' : undefined}
      className='absolute top-0 left-0 size-0 [translate:var(--label-at)] duration-(--motion-layout-duration) ease-[var(--motion-layout-fade-easing),var(--motion-layout-fade-easing),var(--motion-layout-easing)] transition-none group-data-mounted/chart:transition-[color,opacity,translate] data-dim:text-muted-foreground motion-reduce:group-data-mounted/chart:transition-opacity motion-reduce:ease-(--motion-layout-fade-easing)'
      style={
        {
          '--label-at': `${x * 100}cqw ${y * 100}cqh`,
        } as CSSProperties
      }
    >
      <span
        className={cn(
          'absolute font-medium whitespace-nowrap tabular-nums transition-none duration-(--motion-enter-duration) ease-(--motion-enter-fade-easing) group-data-mounted/chart:transition-[opacity,color]',
          outside
            ? 'bg-background/85'
            : 'bg-background/85 text-foreground rounded-(--control-radius-xs) px-1',
          !shown && 'opacity-0',
          placeClass,
        )}
      >
        {children}
      </span>
    </span>
  )
})

/** Whether `text` fits where its label goes on the bar at `place`, at the chart's size. */
function labelFits(
  chart: ChartContextValue,
  place: BarPlace,
  text: string,
  position: BarLabelPosition,
) {
  const { width, height } = chart.plotSize
  const vertical = chart.orientation === 'vertical'
  const thickness = place.band.size * (vertical ? width : height)
  const length = Math.abs(place.to - place.from) * (vertical ? height : width)
  const textWidth = chart.textWidth(text)
  // A line of the chart's 12px text.
  const textHeight = 16
  if (position === 'outside') {
    // Past the end, a label may be wider than its bar, but not than its category's step.
    const step = (vertical ? width : height) / Math.max(1, chart.current.length)
    return vertical ? step >= textWidth + 4 : thickness >= textHeight - 2
  }
  // Inside, a label and its backdrop fit the bar's thickness and its length, past the inset
  // from the end; centred, its length.
  const inset = position === 'inside' ? (vertical ? 4 : 6) : 0
  return vertical
    ? thickness >= textWidth + 4 && length >= textHeight + inset + 2
    : thickness >= textHeight - 2 && length >= textWidth + 8 + inset + 2
}

/**
 * The total of each category's stack, written past its end, for stacked
 * bars, whose length the tooltip alone would otherwise tell.
 */
function BarTotals({
  format,
  className,
  ...props
}: Omit<ComponentProps<'div'>, 'children'> & { format?: ChartFormat }) {
  const chart = useChart()
  const { spotlit } = useChartActive()
  const bar = useBarChart()
  const { addRoom } = chart
  const write = formatterOf(chart.locale, format ?? chart.format)
  const shown = chart.series.filter((key) => !chart.hidden.includes(key))
  const totalOf = (datum: ChartDatum) =>
    shown.reduce((sum, key) => sum + (numberOf(datum[key]) ?? 0), 0)
  const room = outsideRoom(
    chart,
    chart.stack === 'expand'
      ? []
      : chart.current.map((category) => write(totalOf(category.datum))),
  )
  useLayoutEffect(() => addRoom(room), [addRoom, room])
  if (chart.status !== 'ready') return null
  return (
    <div
      data-slot='bar-chart-totals'
      aria-hidden
      className={cn(plotLayerClassName, 'z-20', className)}
      {...props}
    >
      {chart.categories.map((category) => {
        const total = totalOf(category.datum)
        const reach =
          category.leaving || !chart.entered
            ? 0
            : farEnd(bar.spans, shown, category.index)
        const place = {
          band: category.band,
          from: fractionOf(0, chart.scale.domain),
          to: fractionOf(reach, chart.scale.domain),
        }
        return (
          <BarLabel
            key={category.key}
            {...labelPlace(chart, place, 'outside')}
            shown={!category.leaving && labelFits(chart, place, write(total), 'outside')}
            dim={spotlit !== null && spotlit !== category.index}
          >
            {chart.stack === 'expand' ? '' : write(total)}
          </BarLabel>
        )
      })}
    </div>
  )
}

/**
 * The steps of a waterfall from each change in `values`: each runs from
 * where the last one ended, as the `[from, to]` a bar takes, so a running
 * total reads as it builds. With `total`, a last step runs from zero to the
 * sum.
 */
function waterfall(values: readonly number[], total = false): Span[] {
  const steps: Span[] = []
  let at = 0
  for (const value of values) {
    steps.push([at, at + value])
    at += value
  }
  if (total) steps.push([0, at])
  return steps
}

/** The part of `band` the series in `slot` takes when `slots` series sit side by side, `gap` apart as a share of one slot. */
function slotBand(band: Band, slot: number, slots: number, gap = 0.12): Band {
  if (slots <= 1 || slot < 0) return band
  const inner = categoryBand(slot, slots, { gap, outer: 0 })
  return {
    start: band.start + inner.start * band.size,
    size: inner.size * band.size,
  }
}

/** The edges of a bar, as fractions of the plot from each side. */
interface Insets {
  top: number
  right: number
  bottom: number
  left: number
}

/**
 * Where a bar is drawn in the plot: across `band` of the category axis, and
 * along the value axis from `from` to `to`, both fractions of the value axis.
 * Upright bars run left to right in reading order and up from the bottom;
 * lying bars run down the page and away from the reading start.
 */
function barInsets(
  band: Band,
  from: number,
  to: number,
  orientation: ChartOrientation,
  direction: ReadingDirection,
): Insets {
  const low = Math.min(from, to)
  const high = Math.max(from, to)
  if (orientation === 'vertical') {
    const left = physicalStart(band, 'inline', direction)
    return { top: 1 - high, right: 1 - left - band.size, bottom: low, left }
  }
  return {
    top: band.start,
    right: direction === 'rtl' ? low : 1 - high,
    bottom: 1 - band.start - band.size,
    left: direction === 'rtl' ? 1 - high : low,
  }
}

/**
 * Which corners of a bar are round, as top left, top right, bottom right and
 * bottom left: the two at the end its value reaches, away from zero.
 */
function roundCorners(
  orientation: ChartOrientation,
  direction: ReadingDirection,
  positive: boolean,
): readonly [boolean, boolean, boolean, boolean] {
  if (orientation === 'vertical') {
    return positive ? [true, true, false, false] : [false, false, true, true]
  }
  const right = positive === (direction === 'ltr') ? true : false
  return right ? [false, true, true, false] : [true, false, false, true]
}

/** The side of the plot a bar's far end faces: the end its value reaches, away from zero. */
function farSide(
  orientation: ChartOrientation,
  direction: ReadingDirection,
  positive: boolean,
): keyof Insets {
  if (orientation === 'vertical') return positive ? 'top' : 'bottom'
  return positive === (direction === 'ltr') ? 'right' : 'left'
}

/**
 * The heights a loading chart's bars stand at, as fractions of the plot: a
 * fixed, uneven row, so it reads as a chart and never flickers between renders.
 */
function placeholderValues(count: number): number[] {
  const pattern = [0.42, 0.68, 0.55, 0.82, 0.61, 0.74, 0.48, 0.9, 0.58, 0.7, 0.38, 0.64]
  return Array.from({ length: count }, (_, index) => pattern[index % pattern.length]!)
}

/**
 * A bar as the `clip-path` of a layer as large as the plot, which must be a
 * size container: its edges from `insets`, its thickness capped at
 * `--bar-chart-max-thickness` and centred in its band, at least
 * `--bar-chart-min-length` long toward its `far` side, so a tiny value
 * still shows, and the `corners` from `roundCorners` rounded by
 * `--bar-chart-radius`, never past half the bar's thickness. Moving from one
 * bar to the next is then a transition of one property, which turns back
 * from wherever it is.
 */
function barClipPath(
  insets: Insets,
  corners: readonly [boolean, boolean, boolean, boolean],
  orientation: ChartOrientation,
  far?: keyof Insets,
): string {
  const across = orientation === 'vertical' ? 'cqw' : 'cqh'
  const along = orientation === 'vertical' ? 'cqh' : 'cqw'
  const [start, end] =
    orientation === 'vertical' ? [insets.left, insets.right] : [insets.top, insets.bottom]
  const size = Math.max(0, 1 - start - end)
  const centre = start + size / 2
  const half = `min(${round(size * 50)}${across}, var(--bar-chart-max-thickness, 4rem) / 2)`
  const near = `calc(${round(centre * 100)}${across} - ${half})`
  const farAcross = `calc(${round((1 - centre) * 100)}${across} - ${half})`
  const opposite = {
    top: 'bottom',
    bottom: 'top',
    left: 'right',
    right: 'left',
  } as const
  const edge = (side: keyof Insets) => {
    const at = `${round(insets[side] * 100)}${along}`
    if (side !== far) return at
    // Pulled in no further than leaves the bar its least length from its other end.
    return `min(${at}, 100${along} - ${round(insets[opposite[side]] * 100)}${along} - var(--bar-chart-min-length, 0px))`
  }
  const edges =
    orientation === 'vertical'
      ? [edge('top'), farAcross, edge('bottom'), near]
      : [near, edge('right'), farAcross, edge('left')]
  const radius = `min(var(--bar-chart-radius, var(--control-radius-xs)), ${half})`
  // Never all square: Chromium can't run a clip-path transition off the main thread between
  // an inset with no `round` and one with, and a corner of 0px drops the `round`.
  const radii = corners.map((rounded) => (rounded ? radius : '0.01px'))
  return `inset(${edges.join(' ')} round ${radii.join(' ')})`
}

/** A fraction written to four decimals, enough for a plot thousands of px long. */
function round(value: number): number {
  return Math.round(value * 10_000) / 10_000
}

export {
  Bar,
  BarChart,
  type BarChartProps,
  type BarLabelPosition,
  type BarProps,
  BarTotals,
  barClipPath,
  barInsets,
  farSide,
  placeholderValues,
  roundCorners,
  slotBand,
  waterfall,
}
