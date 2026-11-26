'use client'

import {
  type AxisNames,
  axisLayerClassName,
  axisSlide,
  type ChartAxesValue,
  type ChartAxis,
  type ChartFrame,
  ChartTooltipContent,
  ChartTooltipTotal,
  numberAxis,
  plotOffset,
  slideLine,
  stickTo,
  TICK_SPACING,
  tickMove,
  timeAxis,
  useChartAxes,
  useDeclared,
  useTicks,
} from '@/registry/lib/chart-base'
import {
  cartesianSignature,
  type ChartPartDeclaration,
} from '@/registry/lib/chart-cartesian'
import { VALUE_AXIS } from '@/registry/lib/chart-frame'
import { ChartLiveLayer } from '@/registry/lib/chart-live-clock'
import {
  axisNames,
  namePitch,
  labelBox,
  labelsMeet,
  type ChartSummary,
  physicalStart,
  summaryOf,
} from '@/registry/lib/chart-math'
import {
  ChartTooltipBox,
  type ChartFormat,
  ChartGroup,
  ChartLegendToggles,
  formatterOf,
  type ChartItem,
  type ChartPoint,
  plotLayerClassName,
  tooltipTriggerId,
  useChartFocus,
  SeriesKey,
  useChartRootValue,
} from '@/registry/lib/chart-root'
import { bandCentre, tickLadder, timeLadder } from '@/registry/lib/chart-scale'
import { type ChartTarget, sameTarget } from '@/registry/lib/chart-state'
import { timeTickLabel } from '@/registry/lib/dates'
import { GlideGroupMemory } from '@/registry/lib/glide'
import {
  createHighlight,
  type Highlight,
  highlightClassName,
} from '@/registry/lib/highlight'
import { Swap } from '@/registry/lib/swap'
import { Tooltip as TooltipPrimitive } from '@base-ui/react/tooltip'
import {
  type ComponentProps,
  type CSSProperties,
  type ReactNode,
  type RefObject,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import { cn } from '@/lib/utils'

/*
 * The parts you write inside a chart: the grid, the axes, the legend, the
 * tooltip, and the lines and areas that mark a value. Each draws from the
 * chart it sits in, so it works the same in every kind of chart.
 */

/**
 * The lines across the plot at the value axis's ticks, all alike, except
 * the one on the category axis's edge, which the names stand in for. On a
 * chart whose x is a value too, such as a scatter, lines along the plot at
 * the x axis's ticks as well. They slide to their new place when the range
 * changes, and new ones fade in from where they would have been.
 */
function ChartGrid({ className, ...props }: Omit<ComponentProps<'div'>, 'children'>) {
  const axes = useChartAxes()
  const frame = framed(axes, 'ChartGrid')
  const valueLayer = useRef<HTMLDivElement>(null)
  const xLayer = useRef<HTMLDivElement>(null)
  return (
    <div
      data-slot='chart-grid'
      aria-hidden
      className={cn(plotLayerClassName, 'z-0 overflow-visible', className)}
      {...props}
    >
      <GridLines
        layer={valueLayer}
        axis={VALUE_AXIS}
        line={axes.orientation === 'vertical' ? 'y' : 'x'}
      />
      {frame.x.scale.kind === 'linear' && <GridLines layer={xLayer} axis='x' line='x' />}
    </div>
  )
}

/** The grid's lines at one axis's ticks: across the plot (`y`), or along it (`x`). */
function GridLines({
  layer,
  axis,
  line,
}: {
  layer: RefObject<HTMLDivElement | null>
  axis: ChartAxis
  line: 'x' | 'y'
}) {
  const { status, direction } = useChartRootValue()
  const axes = useChartAxes()
  const frame = numberAxis({ frame: framed(axes, 'ChartGrid') }, axis)
  const ladder = frame && tickLadder(frame.scale, tickSpacing[line])
  const ticks = useTicks(frame?.scale ?? null, ladder?.ticks)
  const id = useId()
  if (!frame || !ladder) return null
  const { scale, previous } = frame
  return (
    <div ref={layer} data-ticks={id} className='absolute inset-0 [container-type:size]'>
      {status === 'ready' && (
        <TickSteps
          id={id}
          ladder={ladder}
          before={tickLadder(previous, tickSpacing[line])}
          line={line}
        />
      )}
      {status === 'ready' &&
        ticks.map(({ value: tick, leaving }) => (
          <div
            key={tick}
            data-leaving={leaving ? '' : undefined}
            data-tick={tick}
            // The line at the axis's start sits on the plot's edge, unless the chart keeps an inset.
            data-edge={tick === scale.domain[0] && !axes.inset ? '' : undefined}
            className={cn(
              'border-border border-dashed data-edge:opacity-0 forced-colors:border-[GrayText]',
              tickMove,
              slideLine[line],
              line === 'y' ? 'border-t' : 'border-l',
            )}
            style={axisSlide(line, scale.place(tick), previous.place(tick), direction)}
          />
        ))}
    </div>
  )
}

/** The chart's scales, for a part that reads them, which throws on a chart that has none, such as the Heatmap. */
function framed(axes: ChartAxesValue, part: string): ChartFrame {
  if (!axes.frame) throw new Error(`\`${part}\` needs a chart with a value axis.`)
  return axes.frame
}

/** How far apart ticks stand at least, by the way they stack: values one over another, or side by side. */
const tickSpacing = {
  y: TICK_SPACING.upright,
  x: TICK_SPACING.across,
} as const

/**
 * The ticks that show at each length of a short axis, `line` the way its
 * ticks stack, by container queries, so they are right from the first
 * paint. The range stays the one the chart's tick count rounds to. A tick
 * leaving keeps what `before`, the ladder it left, showed, so one never
 * shown never shows as it goes; one the ladder hides fades as it slides.
 */
function TickSteps({
  id,
  ladder,
  before,
  line,
}: {
  id: string
  ladder: ReturnType<typeof tickLadder>
  before: ReturnType<typeof tickLadder>
  line: 'x' | 'y'
}) {
  const size = line === 'y' ? 'height' : 'width'
  const gone = before.ticks.filter((tick) => !ladder.ticks.includes(tick))
  const rules = [
    ...ladder.steps.map((step) => [step, ladder.ticks] as const),
    ...before.steps.map((step) => [step, gone] as const),
  ].flatMap(([{ from, to, shown }, ticks]) => {
    const hidden = ticks
      .filter((tick) => !shown.includes(tick))
      .map((tick) => `[data-ticks='${id}'] [data-tick='${tick}']`)
    if (hidden.length === 0) return []
    const query = [
      from > 0 && `(${size} >= ${from}px)`,
      to !== null && `(${size} < ${to}px)`,
    ]
      .filter(Boolean)
      .join(' and ')
    return [`@container ${query} { ${hidden.join(',')} { opacity: 0 } }`]
  })
  if (rules.length === 0) return null
  // oxlint-disable-next-line react/no-danger -- the rules are worked out from the chart's own ticks
  return <style dangerouslySetInnerHTML={{ __html: rules.join(' ') }} />
}

interface AxisProps extends Omit<ComponentProps<'div'>, 'children'> {
  /** How the values on a value axis are written; the chart's `format`, shortened, by default. */
  format?: ChartFormat
  /** How the categories on a category axis are written; the chart's `categoryFormat` by default. */
  categoryFormat?: (value: unknown) => string
  /** The axis's title, such as its unit; what it measures, where the chart says, by default. */
  label?: ReactNode
}

type AxisSide = 'start' | 'end' | 'top' | 'bottom'

/**
 * The axis beside the plot: the values of upright bars, or the categories of
 * lying ones. At the reading start, or with `side='end'` at the end.
 */
function ChartYAxis({
  side = 'start',
  axis = VALUE_AXIS,
  format,
  categoryFormat,
  ...props
}: AxisProps & {
  side?: 'start' | 'end'
  /** The value axis it shows, by the id series name in the config; the chart's own by default. */
  axis?: string
}) {
  const { names } = useChartAxes()
  if (names.y === null)
    return <ValueAxis side={side} format={format} axis={axis} {...props} />
  categoriesOnly('ChartYAxis', axis)
  // A grid of cells names its rows down the side, and lying bars their categories.
  return (
    <CategoryAxis
      side={side}
      names={names.y}
      categoryFormat={categoryFormat}
      {...props}
    />
  )
}

/** Throws for a value axis named on an axis that shows something else, which would show none of it. */
function categoriesOnly(part: string, axis: ChartAxis) {
  if (axis === VALUE_AXIS) return
  throw new Error(
    `\`${part}\` shows no value axis here, so it can't show \`${axis}\`. Name it on the axis the values run along.`,
  )
}

/**
 * The axis under the plot: the categories of upright bars, the values of
 * lying ones, or on a chart whose x is a value too, such as a scatter, its
 * x values. With `side='top'`, above it.
 */
function ChartXAxis({
  side = 'bottom',
  axis = VALUE_AXIS,
  format,
  categoryFormat,
  ...props
}: AxisProps & {
  side?: 'top' | 'bottom'
  /** On lying bars, the value axis it shows, by the id series name in the config; the chart's own by default. */
  axis?: string
}) {
  const { names, frame } = useChartAxes()
  const along = frame?.x.scale.kind
  if (along === 'time' || along === 'linear' || names.x !== null) {
    categoriesOnly('ChartXAxis', axis)
  }
  if (along === 'time') {
    if (names.x === null) throw new Error('`TimeAxis` names the times along x.')
    return (
      <TimeAxis
        side={side}
        names={names.x}
        format={format}
        categoryFormat={categoryFormat}
        {...props}
      />
    )
  }
  if (along === 'linear')
    return <ValueAxis side={side} format={format} axis='x' {...props} />
  if (names.x === null)
    return <ValueAxis side={side} format={format} axis={axis} {...props} />
  // A grid of cells names its columns along it, and upright bars their categories.
  return (
    <CategoryAxis
      side={side}
      names={names.x}
      categoryFormat={categoryFormat}
      {...props}
    />
  )
}

const axisArea = {
  start: '[grid-area:start-axis]',
  end: '[grid-area:end-axis]',
  top: '[grid-area:top-axis]',
  bottom: '[grid-area:bottom-axis]',
} as const

/** An axis's frame: its area, and its title before or after the ticks. */
function AxisFrame({
  side,
  label,
  slot,
  className,
  children,
  ...props
}: ComponentProps<'div'> & {
  side: AxisSide
  label?: ReactNode
  slot: string
}) {
  const { direction } = useChartRootValue()
  const across = side === 'start' || side === 'end'
  const title = label && (
    <span
      className={cn(
        'text-muted-foreground shrink-0 truncate font-medium',
        // Reads upwards with no rotation where the browser can, so it renders as sharply as the
        // ticks; a turned title is drawn softer, on Windows above all.
        across
          ? 'self-center [writing-mode:vertical-rl] rotate-180 supports-[writing-mode:sideways-lr]:[writing-mode:sideways-lr] supports-[writing-mode:sideways-lr]:rotate-none'
          : 'self-center',
      )}
    >
      {label}
    </span>
  )
  return (
    <div
      data-slot={slot}
      data-side={side}
      className={cn(
        'flex min-h-0 min-w-0 select-none',
        across ? 'flex-row gap-1' : 'flex-col gap-0.5',
        // While the chart scrolls sideways, an axis down a side stays in view over the marks
        // passing under it, on the colour behind the chart, at the width of its names (each
        // capped), which the plot's least width would otherwise squeeze out.
        across &&
          'group-data-scrolls/chart:sticky group-data-scrolls/chart:z-40 group-data-scroller/chart:min-w-max group-data-scrolls/chart:bg-(--chart-surface,var(--card))',
        across && stickTo(side, direction),
        axisArea[side],
        className,
      )}
      {...props}
    >
      {(side === 'start' || side === 'top') && title}
      {children}
      {(side === 'end' || side === 'bottom') && title}
    </div>
  )
}

function ValueAxis({
  side,
  format,
  axis = VALUE_AXIS,
  label,
  className,
  ...props
}: AxisProps & { side: AxisSide; axis?: ChartAxis }) {
  const chart = useChartRootValue()
  const axes = useChartAxes()
  const { markerOf, locale, status, direction } = chart
  const id = useId()
  const chartFrame = framed(axes, 'ValueAxis')
  const frame = numberAxis({ frame: chartFrame }, axis)
  const across = side === 'start' || side === 'end'
  const ladder = frame && tickLadder(frame.scale, tickSpacing[across ? 'y' : 'x'])
  // The axis's own format, shortened, or the chart's.
  const own = frame?.format ?? chart.format
  const write = formatterOf(
    locale,
    format ??
      (axes.percent && axis === VALUE_AXIS
        ? { style: 'percent' }
        : typeof own === 'function'
          ? own
          : // Shortened to 1.5K, never rounded to 2K: a whole-number format's ticks still differ.
            {
              ...own,
              minimumFractionDigits: 0,
              maximumFractionDigits: Math.max(1, own?.maximumFractionDigits ?? 1),
              notation: 'compact',
            }),
  )
  const all = useTicks(frame?.scale ?? null, ladder?.ticks, write)
  if (!frame || !ladder) {
    throw new Error(
      `The chart has no value axis \`${axis}\`: no series in its config names it.`,
    )
  }
  const { scale, previous } = frame
  const layer = useRef<HTMLSpanElement>(null)
  // Beside another value axis, one that holds a single series is titled with it and its key, so
  // which axis reads which series never rests on colour.
  const onAxis = chart.series.filter((key) => chartFrame.axisOf(key) === axis)
  // An axis whose series are all hidden reads nothing, so its ticks fade until one shows again.
  const reads = axis === 'x' || onAxis.some((key) => !chart.hidden.includes(key))
  const ticks = status === 'ready' && reads ? all : []
  const keyed =
    axis !== 'x' && Object.keys(chartFrame.y).length > 1 && onAxis.length === 1
      ? onAxis[0]
      : undefined
  const title = label ?? frame.label ?? (keyed && (chart.config[keyed]?.label ?? keyed))
  const texts = ticks.flatMap((tick) => (tick.leaving ? [] : [tick.text]))
  return (
    <AxisFrame
      side={side}
      label={
        keyed && title ? (
          <span className='inline-flex items-center gap-1.5'>
            <SeriesKey
              series={keyed}
              slot={chart.series.indexOf(keyed)}
              pattern={chart.patternOf(keyed)}
              marker={markerOf(keyed) ?? undefined}
            />
            {title}
          </span>
        ) : (
          title
        )
      }
      slot='chart-value-axis'
      aria-hidden
      className={className}
      {...props}
    >
      <div
        className={cn(
          'text-muted-foreground relative grid flex-1 tabular-nums',
          side === 'start' && 'pe-2',
          side === 'end' && 'ps-2',
          side === 'bottom' && 'pt-1.5',
          side === 'top' && 'pb-1.5',
        )}
      >
        {/* The widest value holds the axis open; the ticks themselves are placed. */}
        <span className='invisible col-start-1 row-start-1 grid'>
          {texts.map((text, at) => (
            // oxlint-disable-next-line react/no-array-index-key -- ticks repeat no text
            <span key={at} className='col-start-1 row-start-1 whitespace-nowrap'>
              {text}
            </span>
          ))}
        </span>
        <span ref={layer} data-ticks={id} className={axisLayerClassName}>
          {status === 'ready' && (
            <TickSteps
              id={id}
              ladder={ladder}
              before={tickLadder(previous, tickSpacing[across ? 'y' : 'x'])}
              line={across ? 'y' : 'x'}
            />
          )}
          {ticks.map(({ value: tick, text, leaving }) => (
            <span
              key={tick}
              data-leaving={leaving ? '' : undefined}
              data-tick={tick}
              className={cn(tickMove, slideLine[across ? 'y' : 'x'])}
              style={axisSlide(
                across ? 'y' : 'x',
                scale.place(tick),
                previous.place(tick),
                direction,
              )}
            >
              <span
                className={cn(
                  'absolute whitespace-nowrap',
                  side === 'start' && 'end-2 top-0 -translate-y-1/2',
                  side === 'end' && 'start-2 top-0 -translate-y-1/2',
                  // Under or over the plot, centred on the slide's physical left edge, but the
                  // last value goes no further than the plot's edge, so it stays inside the chart:
                  // it centres too when a chart's inset leaves it the room.
                  side === 'bottom' && 'top-0 left-0',
                  side === 'top' && 'bottom-0 left-0',
                  !across &&
                    (tick !== scale.domain[1]
                      ? '-translate-x-1/2'
                      : direction === 'rtl'
                        ? 'translate-x-[max(-50%,calc(-1*var(--chart-inset,0px)))]'
                        : 'translate-x-[min(-50%,calc(var(--chart-inset,0px)-100%))]'),
                )}
              >
                {text}
              </span>
            </span>
          ))}
        </span>
      </div>
    </AxisFrame>
  )
}

/** The least room between two tick labels on an axis of times, in px. */
const TIME_TICK_GAP = 16

/**
 * The axis under a plot whose x is times: ticks on the calendar's
 * boundaries, as many as fit its width, each saying only what changed at it
 * (14:00, 17 Nov, Dec, 2027), which slide when the range changes. The
 * category axis's pill glides along it to the time under the pointer, the
 * focus or picked, naming it whole, while the ticks it would cover step
 * aside.
 */
function TimeAxis({
  side,
  names,
  format,
  categoryFormat,
  label,
  className,
  ...props
}: AxisProps & { side: 'top' | 'bottom'; names: AxisNames }) {
  const { locale, status, direction, textWidth } = useChartRootValue()
  const axes = useChartAxes()
  const chartFrame = framed(axes, 'TimeAxis')
  const frame = timeAxis({ frame: chartFrame })
  const own = format ?? frame?.format
  const zone = frame?.scale.timeZone ?? 'UTC'
  const write =
    typeof own === 'function' ? own : (time: number) => timeTickLabel(time, locale, zone)
  const tickWidth = (tick: number) => textWidth(write(tick))
  const ladder = frame && timeLadder(frame.scale, tickWidth, TIME_TICK_GAP)
  const all = useTicks(frame?.scale ?? null, ladder?.ticks, write)
  const { current, spotlit, format: categoryText } = useAxisNames(names)
  const ref = useRef<HTMLDivElement>(null)
  const pill = useRef<HTMLSpanElement>(null)
  const target = useRef<HTMLSpanElement>(null)
  const [length, setLength] = useState(0)
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setLength(entry.contentRect.width)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  const highlight = useRef<Highlight | null>(null)
  useEffect(() => {
    const element = pill.current
    if (!element) return
    const created = createHighlight(element)
    highlight.current = created
    return () => {
      created.stop()
      highlight.current = null
    }
  }, [])
  const litKey = spotlit === null ? null : (current[spotlit]?.key ?? null)
  // The time the pill names: the one lit, kept once nothing is lit so the pill fades over it.
  // Only one, since two times close together would overlap inside the pill.
  const [named, setNamed] = useState<string | null>(null)
  if (litKey !== null && named !== litKey) setNamed(litKey)
  useEffect(() => {
    highlight.current?.move(litKey === null ? null : target.current)
  }, [litKey, length])
  const axisId = useId()
  if (!frame || !ladder) throw new Error('`TimeAxis` goes on a chart whose x is times.')
  const { scale } = frame
  // A window of time scrolls by its layer: a tick stays where its time is, with nothing to
  // slide, and goes past the axis's ends rather than being kept inside them.
  const live = chartFrame.live
  const previous = live ? scale : frame.previous
  // How far the layer has moved, which a held plot shows still, as the lit name is shown.
  const along = live ? live.offset() : 0
  const writeName = categoryFormat ?? categoryText
  const physical = (place: number) => (direction === 'rtl' ? 1 - place : place)
  // A place on the axis as it shows now, where the layer has moved to.
  const onAxis = (place: number) =>
    physical(place) - (direction === 'rtl' ? -along : along)
  const ticks = status === 'ready' ? all : []
  const nameOf = (key: string) => current.find((category) => category.key === key)
  const lit = litKey === null ? undefined : nameOf(litKey)
  // The ticks the pill would cover, kept inside the axis as its names are.
  const litBox =
    lit && length > 0
      ? labelBox(
          onAxis(bandCentre(lit.band)),
          textWidth(writeName(lit.value)) + 12,
          length,
        )
      : null
  const tickBox = (tick: number): readonly [number, number] => {
    if (!live) return labelBox(physical(scale.place(tick)), tickWidth(tick), length)
    const centre = onAxis(scale.place(tick)) * length
    return [centre - tickWidth(tick) / 2, centre + tickWidth(tick) / 2]
  }
  const covered = (tick: number) =>
    litBox !== null && labelsMeet(tickBox(tick), litBox, LABEL_GAP)
  const shown = named === null ? undefined : nameOf(named)
  // Where the axis as it shows now starts in its layer, physically from the left.
  const physicalShift = direction === 'rtl' ? -along : along
  const pillName = (copy: boolean) => {
    // Where the name's box starts: the layer's start, or the pill's, which sits where the axis
    // shows now.
    const origin = copy ? physicalShift : 0
    const from = physicalShift - origin
    return (
      shown && (
        <span className={axisLayerClassName}>
          <span
            key={shown.key}
            ref={copy ? undefined : target}
            dir='auto'
            className={cn(
              'absolute top-0 left-0 mt-1 rounded-(--control-radius-xs) px-1.5 py-0.5 whitespace-nowrap',
              // On the axis, the name is the pill's place; only the pill's copy shows it.
              !copy && 'opacity-0',
            )}
            // Kept inside the axis as it shows now: on a live plot, the stretch the layer has moved to.
            style={{
              translate: `clamp(${from * 100}cqw, ${(physical(bandCentre(shown.band)) - origin) * 100}cqw - 50%, ${(1 + from) * 100}cqw - 100%) 0`,
            }}
          >
            {writeName(shown.value)}
          </span>
        </span>
      )
    )
  }
  return (
    <AxisFrame
      side={side}
      label={label ?? frame.label}
      slot='chart-time-axis'
      aria-hidden
      className={className}
      {...props}
    >
      <div
        ref={ref}
        data-axis={axisId}
        className={cn(
          'text-muted-foreground relative min-h-0 min-w-0 flex-1 tabular-nums [container-type:inline-size]',
          side === 'bottom' && 'pt-1',
          side === 'top' && 'pb-1',
        )}
      >
        {/* One name's height under the plot, before any tick is placed. */}
        <span className='invisible mt-1 block py-0.5'>&nbsp;</span>
        <ChartLiveLayer live={live} direction={direction} fade='ends'>
          <span data-ticks={axisId} className={axisLayerClassName}>
            {status === 'ready' && (
              <TickSteps
                id={axisId}
                ladder={ladder}
                before={timeLadder(previous, tickWidth, TIME_TICK_GAP)}
                line='x'
              />
            )}
            {ticks.map(({ value: tick, text, leaving }) => {
              // A tick that leaves stays kept inside the axis as it was, rather than jumping to
              // where its place past the end would keep it.
              const place = physical((leaving ? previous : scale).place(tick))
              return (
                <span
                  key={tick}
                  data-leaving={leaving ? '' : undefined}
                  data-tick={tick}
                  data-covered={!leaving && covered(tick) ? '' : undefined}
                  className={cn(
                    tickMove,
                    slideLine.x,
                    'data-covered:opacity-0',
                    live &&
                      'group-data-mounted/chart:transition-opacity duration-(--motion-layout-duration) ease-(--motion-layout-fade-easing)',
                  )}
                  style={axisSlide(
                    'x',
                    scale.place(tick),
                    previous.place(tick),
                    direction,
                  )}
                >
                  <span
                    className='absolute top-0 left-0 mt-1 py-0.5 whitespace-nowrap transition-none group-data-mounted/chart:transition-[translate] duration-(--motion-layout-duration) ease-(--motion-layout-easing) motion-reduce:group-data-mounted/chart:transition-none'
                    // Centred on its time, but kept inside the axis, so a tick near either end stays in
                    // view. Reaching an end or leaving it, it eases there as it slides. Scrolling past,
                    // it stays centred.
                    style={{
                      translate: live
                        ? '-50% 0'
                        : `clamp(${-place * 100}cqw, -50%, ${(1 - place) * 100}cqw - 100%) 0`,
                    }}
                  >
                    {text}
                  </span>
                </span>
              )
            })}
          </span>
        </ChartLiveLayer>
        <ChartLiveLayer live={live} direction={direction}>
          {pillName(false)}
          <span
            ref={pill}
            data-slot='chart-category-pill'
            className={cn(
              highlightClassName,
              'bg-foreground text-background z-10 forced-colors:bg-[Highlight] forced-colors:text-[HighlightText] forced-colors:forced-color-adjust-none',
            )}
            // On a live plot, over the stretch of its layer the axis shows now, as its name is, so
            // the name is never cut at the layer's own end.
            style={live ? { translate: `${physicalShift * 100}cqw 0` } : undefined}
          >
            {pillName(true)}
          </span>
        </ChartLiveLayer>
      </div>
    </AxisFrame>
  )
}

/** A label is never squeezed narrower than this, in px: below it, labels are skipped instead. */
const MIN_LABEL = 44

/** Past this many categories, labels are skipped rather than cut short. */
const MANY_CATEGORIES = 12

/** The room between two names on the axis, in px. */
const LABEL_GAP = 6

/**
 * The category axis. Each category's name sits under it; in a long run,
 * such as days, every few. A pill glides along the axis to the name of the
 * category under the pointer, or the one picked, which shows whole while
 * the names it would land on step aside.
 */
function CategoryAxis({
  side,
  names: axisNamesOf,
  categoryFormat,
  label,
  className,
  ...props
}: AxisProps & { side: AxisSide; names: AxisNames }) {
  const { direction, status, textWidth } = useChartRootValue()
  const across = side === 'start' || side === 'end'
  const { all, current, spotlit, active, format, keepInside } = useAxisNames(axisNamesOf)
  const ref = useRef<HTMLDivElement>(null)
  const pill = useRef<HTMLSpanElement>(null)
  const names = useRef(new Map<string, HTMLElement>())
  const [length, setLength] = useState(0)
  // The names move only once they have been drawn where the measured axis puts them, so
  // nothing fades or slides in on load.
  const [settled, setSettled] = useState(false)
  useEffect(() => {
    if (settled || length === 0) return
    const frame = requestAnimationFrame(() => setSettled(true))
    return () => cancelAnimationFrame(frame)
  }, [settled, length])
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setLength(across ? entry.contentRect.height : entry.contentRect.width)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [across])
  const highlight = useRef<Highlight | null>(null)
  useEffect(() => {
    const element = pill.current
    if (!element) return
    const created = createHighlight(element)
    highlight.current = created
    return () => {
      created.stop()
      highlight.current = null
    }
  }, [])
  useEffect(() => {
    const key = spotlit === null ? undefined : current[spotlit]?.key
    highlight.current?.move(key === undefined ? null : (names.current.get(key) ?? null))
  }, [spotlit, current, length])
  const write = categoryFormat ?? format
  // How wide a name is with its padding, measured in the chart's font.
  const nameLength = (name: AxisNames['all'][number]) => textWidth(write(name.value)) + 12
  // A few categories each keep a name, cut short if they must; a long run, such as days,
  // shows every few in full instead.
  const longest =
    current.length > MANY_CATEGORIES
      ? Math.max(MIN_LABEL, ...current.map(nameLength))
      : MIN_LABEL
  const shown = status === 'loading' ? [] : all
  const centreOf = (name: AxisNames['all'][number]) =>
    across
      ? name.band.start + name.band.size / 2
      : physicalStart(name.band, 'inline', direction) + name.band.size / 2
  const axisNamed = current.map((category) => ({
    centre: centreOf(category),
    width: nameLength(category),
  }))
  const spacing = { minLength: longest + LABEL_GAP, gap: LABEL_GAP }
  // Only a name under the pointer or the focus shows whole, and the names it would land on
  // step aside; a picked one keeps its room, so its neighbours keep theirs while it stays picked.
  const { room, skipped } =
    across || length === 0
      ? { room: 0, skipped: new Set<number>() }
      : axisNames(axisNamed, length, { ...spacing, lit: active })
  const axisId = useId()
  // Down the side, the name the pill marks shows whole, a picked one at rest included.
  const marked = spotlit === null ? null : (current[spotlit]?.index ?? null)
  const acrossLit = active ?? marked

  // The names, drawn twice: once on the axis, and once in the pill's colours inside the pill,
  // which shows only the part under it, so the name it slides onto reads in its colours.
  const layer = (copy: boolean) => (
    <span className={axisLayerClassName}>
      {shown.map((category) => {
        const centre = centreOf(category)
        const isLit =
          (across ? acrossLit : active) === category.index && !category.leaving
        const isSkipped =
          !across && !isLit && !category.leaving && skipped.has(category.index)
        return (
          <span
            key={category.key}
            ref={
              copy
                ? undefined
                : (element) => {
                    if (element && !category.leaving) {
                      names.current.set(category.key, element)
                      return () => {
                        if (names.current.get(category.key) === element)
                          names.current.delete(category.key)
                      }
                    }
                    return undefined
                  }
            }
            data-leaving={category.leaving ? '' : undefined}
            data-name={category.index}
            data-active={isLit ? '' : undefined}
            // A date or a name with digits reads in its own order whatever the page's direction.
            dir='auto'
            className={cn(
              // One element both slides and is the name, so the pill finds where it is going. It
              // moves only once the chart has painted and the axis is measured, so nothing fades in
              // on load.
              'absolute top-0 left-0 truncate rounded-(--control-radius-xs) px-1.5 py-0.5 transition-none duration-(--motion-layout-duration) ease-(--motion-layout-easing) data-leaving:opacity-0',
              settled &&
                'transition-[translate,opacity] duration-(--motion-layout-duration) ease-(--motion-layout-easing) group-data-mounted/chart:starting:opacity-0 motion-reduce:transition-opacity',
              across ? 'max-w-[calc(100%-0.125rem)]' : 'text-center',
              side === 'bottom' && 'mt-1',
              isSkipped && 'opacity-0',
            )}
            style={
              {
                // Its place, which `UnmeasuredAxisNames` picks names by.
                '--axis-name': category.index,
                // Centred on its category, but kept inside the axis, so a whole name at either
                // end stays in view and inside the pill. Beside the plot, it sits against it. A
                // grid's rows are each a name's height or more, so each centres on its row, and
                // names that `AcrossAxisNames` spaces never meet at the ends.
                translate: across
                  ? `${(side === 'start') === (direction === 'ltr') ? 'calc(100cqw - 100% - 0.125rem)' : '0.125rem'} ${keepInside ? `clamp(0px, ${centre * 100}cqh - 50%, 100cqh - 100%)` : `calc(${centre * 100}cqh - 50%)`}`
                  : `clamp(0px, ${centre * 100}cqw - 50%, 100cqw - 100%) 0`,
                // Before the axis is measured, `UnmeasuredAxisNames` gives the room.
                maxWidth: across || isLit || length === 0 ? undefined : `${room}px`,
              } as CSSProperties
            }
          >
            {write(category.value)}
          </span>
        )
      })}
    </span>
  )

  return (
    <AxisFrame
      side={side}
      label={label}
      slot='chart-category-axis'
      aria-hidden
      className={className}
      {...props}
    >
      <div
        ref={ref}
        data-axis={axisId}
        // The name the pill marks, which `AcrossAxisNames` keeps whole.
        style={
          across ? ({ '--axis-lit': acrossLit ?? -1e3 } as CSSProperties) : undefined
        }
        className={cn(
          'text-muted-foreground relative min-h-0 min-w-0 flex-1',
          across ? 'grid max-w-[40cqw]' : '[container-type:inline-size]',
          side === 'start' && 'pe-1.5',
          side === 'end' && 'ps-1.5',
          side === 'bottom' && 'pt-1',
          side === 'top' && 'pb-1',
        )}
      >
        {across && (
          // The longest name holds the axis open, up to its cap; the names themselves are placed.
          <span className='invisible col-start-1 row-start-1 grid'>
            {shown.map((category) => (
              <span
                key={category.key}
                className='col-start-1 row-start-1 truncate px-1.5'
              >
                {write(category.value)}
              </span>
            ))}
          </span>
        )}
        {across && <AcrossAxisNames id={axisId} count={current.length} />}
        {!across && length === 0 && (
          <UnmeasuredAxisNames
            id={axisId}
            names={axisNamed}
            {...spacing}
            cut={current.length <= MANY_CATEGORIES}
          />
        )}
        {/* One name's height under the plot, before any name is placed. */}
        {!across && <span className='invisible block py-0.5'>&nbsp;</span>}
        {layer(false)}
        <span
          ref={pill}
          data-slot='chart-category-pill'
          className={cn(
            highlightClassName,
            'bg-foreground text-background z-10 forced-colors:bg-[Highlight] forced-colors:text-[HighlightText] forced-colors:forced-color-adjust-none',
          )}
        >
          {layer(true)}
        </span>
      </div>
    </AxisFrame>
  )
}

/**
 * The names on an axis that names things, and which is under the pointer or
 * the focus (`active`) and which stays lit (`spotlit`), by place among the
 * names still in the data.
 */
function useAxisNames(names: AxisNames) {
  const { focus, spotlit } = useChartFocus()
  return {
    ...names,
    spotlit: spotlit === null ? null : names.nameOf(spotlit),
    active: focus === null ? null : names.nameOf(focus),
  }
}

/** How tall a name on an axis down the side is, with the room it keeps from the next, in px. */
const ACROSS_NAME = 18

/**
 * Every few names on an axis down the side, when its bands are shorter than
 * a name, such as a calendar's days: worked out by container queries on the
 * axis's height, so they are right from the first paint. The name the pill
 * marks shows whole, and those it would touch step aside.
 */
function AcrossAxisNames({ id, count }: { id: string; count: number }) {
  const scope = `[data-axis='${id}'] [data-name]:not([data-leaving])`
  const rules: string[] = []
  for (let every = 2; every <= count; every += 1) {
    // Below this height, each name's band times `every - 1` is shorter than a name.
    const below = (ACROSS_NAME * count) / (every - 1)
    const away =
      'max(var(--axis-name) - var(--axis-lit), var(--axis-lit) - var(--axis-name))'
    rules.push(
      `@container (height < ${below}px) { ${scope} { opacity: max(1 - min(1, ${away}), (1 - min(1, mod(var(--axis-name), ${every}))) * min(1, max(0, ${away} - ${every - 1}))) } }`,
    )
  }
  // oxlint-disable-next-line react/no-danger -- the rules are worked out from the chart's own names
  return <style dangerouslySetInnerHTML={{ __html: rules.join(' ') }} />
}

/**
 * The names a category axis shows before it is measured, as on the page's
 * first paint from the server: the same ones, with the same room, that
 * `axisNames` gives it once measured, worked out at widths `NAMES_SAMPLE` px
 * apart and picked by container queries on the axis's own width.
 */
function UnmeasuredAxisNames({
  id,
  names,
  minLength,
  gap,
  cut,
}: {
  id: string
  names: readonly { centre: number; width: number }[]
  minLength: number
  gap: number
  /** Whether a name is cut short to its room, as a few are, rather than shown whole. */
  cut: boolean
}) {
  const scope = `[data-axis='${id}'] [data-name]`
  const rules: string[] = []
  let run: { from: number; every: number; held: string } | null = null
  const close = (to: number | null) => {
    if (!run) return
    const query = [
      run.from > NAMES_SAMPLE_FROM ? `(width >= ${run.from}px)` : '',
      to === null ? '' : `(width < ${to}px)`,
    ]
      .filter(Boolean)
      .join(' and ')
    // Every few show, by their place in `--axis-name`, but those held back. A long run's
    // names show whole, as once measured; a few are cut short if they must.
    const room = cut
      ? `; max-width: calc(100cqw * ${run.every * namePitch(names)} - ${gap}px)`
      : ''
    const body = `${scope} { opacity: calc(1 - min(1, mod(var(--axis-name), ${run.every})))${room} }${run.held ? ` ${scope}:is(${run.held}) { opacity: 0 }` : ''}`
    rules.push(query ? `@container ${query} { ${body} }` : body)
  }
  for (
    let width = NAMES_SAMPLE_FROM;
    width <= NAMES_SAMPLE_UP_TO;
    width += NAMES_SAMPLE
  ) {
    // Each run of widths is laid out at its middle.
    const { every, skipped } = axisNames(names, width + NAMES_SAMPLE / 2, {
      minLength,
      gap,
    })
    // The names on the step that step aside for a neighbour.
    const held = [...skipped]
      .filter((index) => index % every === 0)
      .map((index) => `[data-name='${index}']`)
      .join(',')
    if (run && run.every === every && run.held === held) continue
    close(width)
    run = { from: width, every, held }
  }
  close(null)
  // oxlint-disable-next-line react/no-danger -- the rules are worked out from the chart's own names
  return <style dangerouslySetInnerHTML={{ __html: rules.join(' ') }} />
}

/** How far apart the widths `UnmeasuredAxisNames` works its names out at are, in px, and from and to where. */
const NAMES_SAMPLE = 4
const NAMES_SAMPLE_FROM = 120
const NAMES_SAMPLE_UP_TO = 2560

/** The value a reference line marks: worked out from the data, or the number given. */
function referenceValue(
  axes: ChartAxesValue,
  value: number | ChartSummary | undefined,
  axis: ChartAxis,
) {
  if (value === undefined || typeof value === 'number') return value ?? null
  return summaryOf(axes.summaryValues(axis), value)
}

/** The axis a reference's values are on: the chart's own value axis unless it names another. */
function referenceOn(axis: ChartAxis | undefined): ChartAxis {
  return axis ?? VALUE_AXIS
}

/**
 * The frame's axis a reference marks: `'x'` on a chart whose x is a
 * number, or the value axis named, which an x of categories means too.
 */
function referenceAxis(axes: ChartAxesValue, part: string, given: ChartAxis | undefined) {
  const chartFrame = framed(axes, part)
  const axis = referenceOn(given)
  const onX = axis === 'x' && chartFrame.x.scale.kind === 'linear'
  const id = onX ? 'x' : axis === 'x' ? VALUE_AXIS : axis
  const frame = numberAxis({ frame: chartFrame }, id)
  if (!frame) {
    throw new Error(
      `The chart has no value axis \`${axis}\` for its reference: no series in its config names it.`,
    )
  }
  return { id, onX, live: chartFrame.live, ...frame }
}

/** A reference's name, which crossfades as it changes while the line slides. */
/**
 * A label on a line across the page: centred on it, but held inside the
 * plot, so a line near either edge keeps its whole label in view. It slides
 * as the line does.
 */
const lineLabelAcross =
  'left-0 [translate:max(calc(-1*var(--line-x)),min(-50%,calc(100cqw-var(--line-x)-100%)))_0] transition-none group-data-mounted/chart:transition-[translate] duration-(--motion-layout-duration) ease-(--motion-layout-easing) motion-reduce:group-data-mounted/chart:transition-none'

// A label at the end of a line across the categories sits above the plot, in the
// room `LabelRoom` keeps there, where it never covers the first category's bar.
const labelAbove = 'bottom-full mb-1'

function LabelRoom() {
  return <div aria-hidden className='h-5 [grid-area:top-axis]' />
}

function ReferenceLabel({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <span
      className={cn(
        'bg-background text-foreground absolute rounded-(--control-radius-xs) px-1 font-medium whitespace-nowrap ring-1 ring-foreground/15 tabular-nums',
        className,
      )}
    >
      <Swap>{children}</Swap>
    </span>
  )
}

/**
 * A line across the plot that marks `value`, such as a target, or one worked
 * out from the shown data (`'average'`, `'median'`, `'min'`, `'max'`), named
 * by `label` at the axis's end or start. The value axis reaches far enough to
 * show it, and it slides when the range changes. With `category` in place of
 * `value`, it marks that category instead, such as the day of a launch. With
 * `axis='x'`, on a chart whose x is a value too, such as a scatter, it marks
 * a value on the x axis.
 */
type ChartReferenceLineProps = Omit<ComponentProps<'div'>, 'children'> & {
  value?: number | ChartSummary
  /** The key of the category to mark, in place of a value. */
  category?: string
  /**
   * The axis `value` is on: the chart's value axis, another value axis by
   * the id its series name in the config, or `'x'` on a chart whose x is a
   * number too.
   */
  axis?: ChartAxis
  label?: ReactNode | ((value: number) => ReactNode)
  labelPosition?: 'start' | 'end'
}

function ChartReferenceLine(props: ChartReferenceLineProps) {
  const {
    value,
    category,
    axis,
    label,
    labelPosition = 'end',
    className,
    ...rest
  } = props
  useDeclared('ChartReferenceLine', ChartReferenceLine.declare(props), cartesianSignature)
  const { direction, status } = useChartRootValue()
  const axes = useChartAxes()
  const { orientation } = axes
  const {
    id,
    onX,
    scale,
    previous,
    live: frameLive,
  } = referenceAxis(axes, 'ChartReferenceLine', axis)
  const marked = referenceValue(axes, value, id)
  // Which way the line runs: a value on an x axis, or a category along one, makes a line
  // down the plot, whose label sits above it.
  const along =
    category !== undefined
      ? orientation === 'vertical'
        ? 'x'
        : 'y'
      : onX || orientation === 'horizontal'
        ? 'x'
        : 'y'
  // The room stays while the chart loads or fails, so the plot keeps its size.
  const room =
    label !== undefined && labelPosition === 'end' && along === 'x' ? <LabelRoom /> : null
  if (status !== 'ready') return room
  const named = typeof label === 'function' ? marked !== null && label(marked) : label
  // A line down a live plot scrolls with its rows, so its label centres on it rather than being
  // kept inside an axis that moves under it.
  const live = along === 'x' ? frameLive : null
  const scrollWith = (node: ReactNode) => (
    <ChartLiveLayer live={live} direction={direction} reach='label' fade='ends'>
      {node}
    </ChartLiveLayer>
  )
  const moves = live
    ? 'group-data-mounted/chart:transition-opacity duration-(--motion-layout-duration) ease-(--motion-layout-fade-easing)'
    : undefined
  const labelAcross = live ? 'left-0 [translate:-50%_0]' : lineLabelAcross

  if (category !== undefined) {
    const at = axes.names[orientation === 'vertical' ? 'x' : 'y']?.current.find(
      (name) => name.key === category,
    )
    if (!at) return room
    // Across the value axis, at the category's centre.
    const line = along
    const centre =
      physicalStart(at.band, orientation === 'vertical' ? 'inline' : 'block', direction) +
      at.band.size / 2
    const place = line === 'x' ? (direction === 'rtl' ? 1 - centre : centre) : 1 - centre
    return (
      <>
        {room}
        <div
          data-slot='chart-reference-line'
          className={cn(plotLayerClassName, 'z-15', className)}
          {...rest}
        >
          {scrollWith(
            <div
              className={cn(tickMove, slideLine[line], moves)}
              style={
                {
                  ...axisSlide(line, place, place, direction),
                  '--line-x': plotOffset(place, 'cqw'),
                } as CSSProperties
              }
            >
              <div
                className={cn(
                  'border-foreground/60 absolute border-dashed forced-colors:border-[CanvasText]',
                  line === 'y' ? 'inset-x-0 top-0 border-t' : 'inset-y-0 left-0 border-l',
                )}
              />
              {named && (
                <ReferenceLabel
                  className={
                    line === 'x'
                      ? cn(labelAcross, labelPosition === 'end' ? labelAbove : 'bottom-0')
                      : cn(
                          'top-0 -translate-y-1/2',
                          labelPosition === 'end' ? 'end-0' : 'start-0',
                        )
                  }
                >
                  {named}
                </ReferenceLabel>
              )}
            </div>,
          )}
        </div>
      </>
    )
  }

  if (marked === null) return room
  const line = along
  return (
    <>
      {room}
      <div
        data-slot='chart-reference-line'
        className={cn(plotLayerClassName, 'z-15', className)}
        {...rest}
      >
        {scrollWith(
          <div
            className={cn(tickMove, slideLine[line], moves)}
            style={
              {
                ...axisSlide(
                  line,
                  scale.place(marked),
                  previous.place(marked),
                  direction,
                ),
                '--line-x': plotOffset(
                  direction === 'rtl' ? 1 - scale.place(marked) : scale.place(marked),
                  'cqw',
                ),
              } as CSSProperties
            }
          >
            <div
              className={cn(
                'border-foreground/60 absolute border-dashed forced-colors:border-[CanvasText]',
                line === 'y' ? 'inset-x-0 top-0 border-t' : 'inset-y-0 left-0 border-l',
              )}
            />
            {named && (
              <ReferenceLabel
                className={
                  line === 'y'
                    ? cn(
                        'top-0 -translate-y-1/2',
                        labelPosition === 'end' ? 'end-0' : 'start-0',
                      )
                    : cn(labelAcross, labelPosition === 'end' ? labelAbove : 'bottom-0')
                }
              >
                {named}
              </ReferenceLabel>
            )}
          </div>,
        )}
      </div>
    </>
  )
}

/**
 * A band across the plot from `from` to `to` on the value axis, such as a
 * goal range or what is normal, named by `label`. The value axis reaches far
 * enough to show it, and it moves with the range. With `axis='x'`, on a
 * chart whose x is a value too, such as a scatter, a band down the plot
 * between two x values.
 */
type ChartReferenceAreaProps = Omit<ComponentProps<'div'>, 'children'> & {
  from: number
  to: number
  /**
   * The axis `from` and `to` are on: the chart's value axis, another value
   * axis by the id its series name in the config, or `'x'` on a chart whose
   * x is a number too.
   */
  axis?: ChartAxis
  label?: ReactNode
}

function ChartReferenceArea(props: ChartReferenceAreaProps) {
  const { from, to, axis, label, className, ...rest } = props
  useDeclared('ChartReferenceArea', ChartReferenceArea.declare(props), cartesianSignature)
  const { direction, status } = useChartRootValue()
  const axes = useChartAxes()
  const { onX, scale } = referenceAxis(axes, 'ChartReferenceArea', axis)
  // A band on an x axis runs down the plot, as a lying bar chart's values do.
  const orientation = onX ? 'horizontal' : axes.orientation
  if (status !== 'ready') return null
  const low = scale.place(Math.min(from, to))
  const high = scale.place(Math.max(from, to))
  // Its edges as the plot's own places from the top, the left and the right.
  const top = plotOffset(1 - high, 'cqh')
  const bottom = `calc(100cqh - ${plotOffset(1 - low, 'cqh')})`
  const left = plotOffset(direction === 'rtl' ? 1 - high : low, 'cqw')
  const right = `calc(100cqw - ${plotOffset(direction === 'rtl' ? 1 - low : high, 'cqw')})`
  const clip =
    orientation === 'vertical'
      ? `inset(${top} 0 ${bottom} 0)`
      : `inset(0 ${right} 0 ${left})`
  return (
    <div
      data-slot='chart-reference-area'
      // Over the grid, which shows through its tint, so no grid line strikes through its label.
      className={cn(plotLayerClassName, 'z-1', className)}
      {...rest}
    >
      <div
        className='bg-foreground/5 dark:bg-foreground/8 absolute inset-0 duration-(--motion-layout-duration) ease-(--motion-layout-easing) [clip-path:var(--area-clip)] transition-none group-data-mounted/chart:transition-[clip-path] motion-reduce:group-data-mounted/chart:transition-none forced-colors:bg-[GrayText]!'
        style={{ '--area-clip': clip } as CSSProperties}
      />
      {label && (
        <span
          className='text-muted-foreground absolute end-1 top-1 font-medium whitespace-nowrap [translate:var(--area-label)] duration-(--motion-layout-duration) ease-(--motion-layout-easing) transition-none group-data-mounted/chart:transition-[translate] motion-reduce:group-data-mounted/chart:transition-none'
          style={
            {
              // At the band's far end: its top, or the end of a band down the plot.
              '--area-label':
                orientation === 'vertical'
                  ? `0 ${top}`
                  : direction === 'rtl'
                    ? `${left} 0`
                    : `calc(-1 * ${right}) 0`,
            } as CSSProperties
          }
        >
          {label}
        </span>
      )}
    </div>
  )
}

// The values a reference marks join its axis's range as the chart renders; one worked out
// from the data is in it already.
ChartReferenceLine.declare = ({
  value,
  category,
  axis,
}: ChartReferenceLineProps): ChartPartDeclaration => ({
  references:
    typeof value === 'number' && category === undefined
      ? [{ axis: referenceOn(axis), value }]
      : [],
})

ChartReferenceArea.declare = ({
  from,
  to,
  axis,
}: ChartReferenceAreaProps): ChartPartDeclaration => ({
  references: [
    { axis: referenceOn(axis), value: from },
    { axis: referenceOn(axis), value: to },
  ],
})

/**
 * One toggle for each series, which shows and hides it: its colour fills the
 * swatch while it shows, and only its outline is left once hidden. Pointing
 * at one, or focusing it, brings its series forward. Above the plot, or with
 * `position='bottom'` under it.
 */
function ChartLegend({
  position = 'top',
  className,
  ...props
}: Omit<ComponentProps<'div'>, 'children'> & { position?: 'top' | 'bottom' }) {
  const {
    series,
    config,
    hidden,
    setHidden,
    setEmphasis,
    patternOf,
    messages,
    markerOf,
  } = useChartRootValue()
  return (
    <div
      data-slot='chart-legend'
      role='group'
      aria-label={messages.series}
      className={cn(
        'flex flex-wrap items-center gap-x-1 gap-y-0.5',
        position === 'top' ? 'pb-3 [grid-area:top]' : 'pt-3 [grid-area:bottom]',
        className,
      )}
      {...props}
    >
      <ChartLegendToggles
        series={series}
        labelOf={(key) => config[key]?.label ?? key}
        patternOf={patternOf}
        markerOf={(key) => markerOf(key) ?? undefined}
        hidden={hidden}
        onHiddenChange={setHidden}
        onEmphasisChange={setEmphasis}
      />
    </div>
  )
}

/** What a tooltip of your own gets for what it shows. */
interface ChartTooltipItem {
  /** Its place in the data. */
  index: number
  /** What it shows: its key, its value under the chart's `index`, and its row, which is null for what isn't a row of the data. */
  category: ChartItem
}

type ChartTooltipProps = Omit<
  ComponentProps<typeof ChartTooltipBox>,
  'children' | 'anchor'
> & {
  /** Adds a row with the total of the shown values; on by default when the series stack. */
  total?: boolean
  /** What the tooltip shows for a category; `ChartTooltipContent` by default, which yours can wrap. */
  children?: (item: ChartTooltipItem) => ReactNode
}

/**
 * The tooltip of the category under the pointer, the focus or the keys: its
 * name and each shown series' value, by default above the category's
 * marks. It opens at once, since it follows the pointer like a crosshair
 * rather than opening on a rest, slides from category to category, and goes
 * to where the marks are going when they move.
 */
function ChartTooltip({
  side,
  align = 'center',
  total,
  className,
  children,
  ...props
}: ChartTooltipProps) {
  const { reader, tooltip, id, status, plot } = useChartRootValue()
  const { focus, setFocus } = useChartFocus()
  const { browse } = reader
  const open = browse !== null && focus !== null && status === 'ready'
  // What it last showed, which it keeps showing while it closes.
  const [shown, setShown] = useState<ChartTarget | null>(null)
  if (focus !== null && !sameTarget(focus, shown)) setShown(focus)
  if (!browse) return null
  const target = focus ?? shown
  const item = target === null ? null : reader.item(target)
  const content =
    target === null
      ? null
      : children && item
        ? children({ index: item.index, category: item })
        : browse.tooltip(target)
  const point = target === null ? null : browse.anchor(target)
  return (
    <GlideGroupMemory>
      <TooltipPrimitive.Root
        handle={tooltip}
        open={open}
        triggerId={open ? tooltipTriggerId(id) : null}
        onOpenChange={(next, details) => {
          if (next) return
          // The plot clears it when the pointer leaves or focus goes, so only Escape and a press
          // away from the chart close it here. A press on the chart, or on another chart in its
          // group, leaves the values showing.
          if (details.reason === 'escape-key') {
            setFocus(null)
            return
          }
          if (details.reason !== 'outside-press') return
          const pressed = details.event?.target
          const figure = plot.current?.closest('figure')
          if (
            pressed instanceof Element &&
            (figure?.contains(pressed) || pressed.closest("[data-slot='chart-columns']"))
          )
            return
          setFocus(null)
        }}
        disableHoverablePopup
      >
        {target !== null && (item !== null || content != null) && (
          <ChartTooltipPopup
            // A new side starts the popup afresh there, rather than sliding it across the marks.
            key={point?.side}
            point={point}
            side={side ?? point?.side}
            align={align}
            className={className}
            {...props}
          >
            <ChartTooltipTotal value={total}>{content}</ChartTooltipTotal>
          </ChartTooltipPopup>
        )}
      </TooltipPrimitive.Root>
    </GlideGroupMemory>
  )
}

/**
 * The tooltip's popup, on `point`, where the marks it shows are going, so it
 * never waits behind them. The point is a new anchor only when it moves, as
 * the popup sets its positioning up again for each new anchor.
 */
function ChartTooltipPopup({
  point,
  className,
  ...props
}: ComponentProps<typeof ChartTooltipBox> & { point: ChartPoint | null }) {
  const { plot } = useChartRootValue()
  const x = point?.x ?? 0
  const y = point?.y ?? 0
  const anchor = useMemo(
    () => ({
      get contextElement() {
        return plot.current ?? undefined
      },
      getBoundingClientRect: () => {
        const box = plot.current?.getBoundingClientRect()
        if (!box) return new DOMRect()
        return new DOMRect(box.left + x * box.width, box.top + y * box.height, 0, 0)
      },
    }),
    [plot, x, y],
  )
  return (
    <ChartTooltipBox
      sideOffset={8}
      anchor={anchor}
      className={cn('max-w-72 px-2.5 py-2', className)}
      {...props}
    />
  )
}

export {
  ChartGrid,
  ChartGroup,
  ChartLegend,
  ChartReferenceArea,
  ChartReferenceLine,
  ChartTooltip,
  ChartTooltipContent,
  type ChartTooltipItem,
  ChartXAxis,
  ChartYAxis,
}
