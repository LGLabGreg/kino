'use client'

import { TooltipPopup } from '@/registry/components/kino/tooltip'
import {
  axisLayerClassName,
  axisSlide,
  plotOffset,
  stickTo,
  type ChartAxis,
  type ChartAxisName,
  type ChartCategory,
  type ChartContextValue,
  type ChartFormat,
  ChartGroup,
  ChartLegendToggles,
  ChangeText,
  forcedSeriesColor,
  swatchClassName,
  formatterOf,
  isForecast,
  plotLayerClassName,
  scalesOf,
  slideLine,
  swatchStyle,
  tickMove,
  useChart,
  useChartActive,
  useTicks,
  valuePlace,
} from '@/registry/lib/chart-core'
import {
  axisNames,
  type ChartSummary,
  changeSince,
  fractionOf,
  numberOf,
  physicalStart,
  summaryOf,
} from '@/registry/lib/chart-math'
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
  const chart = useChart()
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
        axis='value'
        line={chart.orientation === 'vertical' ? 'y' : 'x'}
      />
      {chart.xy && <GridLines layer={xLayer} axis='x' line='x' />}
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
  const chart = useChart()
  const { scale, previousScale } = scalesOf(chart, axis)
  const ticks = useTicks(layer, axis)
  return (
    <div ref={layer} className='absolute inset-0 [container-type:size]'>
      {chart.status === 'ready' &&
        ticks.map(({ value: tick, leaving }) => (
          <div
            key={tick}
            data-leaving={leaving ? '' : undefined}
            // The line at the axis's start sits on the plot's edge, unless the chart keeps an inset.
            data-edge={tick === scale.domain[0] && !chart.inset ? '' : undefined}
            className={cn(
              'border-border border-dashed data-edge:opacity-0 forced-colors:border-[GrayText]',
              tickMove,
              slideLine[line],
              line === 'y' ? 'border-t' : 'border-l',
            )}
            style={axisSlide(
              line,
              valuePlace(tick, scale),
              valuePlace(tick, previousScale),
              chart.direction,
            )}
          />
        ))}
    </div>
  )
}

interface AxisProps extends Omit<ComponentProps<'div'>, 'children'> {
  /** How the values on a value axis are written; the chart's `format`, shortened, by default. */
  format?: ChartFormat
  /** How the categories on a category axis are written; the chart's `categoryFormat` by default. */
  categoryFormat?: (value: unknown) => string
  /** The axis's title, such as its unit. */
  label?: ReactNode
}

type AxisSide = 'start' | 'end' | 'top' | 'bottom'

/**
 * The axis beside the plot: the values of upright bars, or the categories of
 * lying ones. At the reading start, or with `side='end'` at the end.
 */
function ChartYAxis({
  side = 'start',
  format,
  categoryFormat,
  ...props
}: AxisProps & { side?: 'start' | 'end' }) {
  const { orientation, xy, grid } = useChart()
  // A grid of cells names its rows down the side.
  if (grid) return <CategoryAxis side={side} categoryFormat={categoryFormat} {...props} />
  return orientation === 'vertical' ? (
    <ValueAxis side={side} format={format} label={xy?.labels?.y} {...props} />
  ) : (
    <CategoryAxis side={side} categoryFormat={categoryFormat} {...props} />
  )
}

/**
 * The axis under the plot: the categories of upright bars, the values of
 * lying ones, or on a chart whose x is a value too, such as a scatter, its
 * x values. With `side='top'`, above it.
 */
function ChartXAxis({
  side = 'bottom',
  format,
  categoryFormat,
  ...props
}: AxisProps & { side?: 'top' | 'bottom' }) {
  const { orientation, xy, grid } = useChart()
  // A grid of cells names its columns along it.
  if (grid) return <CategoryAxis side={side} categoryFormat={categoryFormat} {...props} />
  // On a chart whose x is a value, each axis is titled with what it measures unless given a label.
  if (xy)
    return (
      <ValueAxis side={side} format={format} axis='x' label={xy.labels?.x} {...props} />
    )
  return orientation === 'vertical' ? (
    <CategoryAxis side={side} categoryFormat={categoryFormat} {...props} />
  ) : (
    <ValueAxis side={side} format={format} {...props} />
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
  const { direction } = useChart()
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
  axis = 'value',
  label,
  className,
  ...props
}: AxisProps & { side: AxisSide; axis?: ChartAxis }) {
  const chart = useChart()
  const { stack, locale, status, direction } = chart
  const { scale, previousScale } = scalesOf(chart, axis)
  // The chart's own format, shortened; an XY frame's x axis follows the format it was given.
  const own = axis === 'x' ? (chart.xy?.format ?? chart.format) : chart.format
  const write = formatterOf(
    locale,
    format ??
      (stack === 'expand' && axis === 'value'
        ? { style: 'percent' }
        : typeof own === 'function'
          ? own
          : { maximumFractionDigits: 1, ...own, notation: 'compact' }),
  )
  const layer = useRef<HTMLSpanElement>(null)
  const all = useTicks(layer, axis)
  const ticks = status === 'ready' ? all : []
  const texts = ticks.flatMap((tick) => (tick.leaving ? [] : [write(tick.value)]))
  const across = side === 'start' || side === 'end'
  return (
    <AxisFrame
      side={side}
      label={label}
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
        <span ref={layer} className={axisLayerClassName}>
          {ticks.map(({ value: tick, leaving }) => (
            <span
              key={tick}
              data-leaving={leaving ? '' : undefined}
              className={cn(tickMove, slideLine[across ? 'y' : 'x'])}
              style={axisSlide(
                across ? 'y' : 'x',
                valuePlace(tick, scale),
                valuePlace(tick, previousScale),
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
                {write(tick)}
              </span>
            </span>
          ))}
        </span>
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
  categoryFormat,
  label,
  className,
  ...props
}: AxisProps & { side: AxisSide }) {
  const chart = useChart()
  const { direction, status, textWidth, categoryText } = chart
  const across = side === 'start' || side === 'end'
  const axis = across === (chart.orientation === 'vertical') ? 'y' : 'x'
  const { names: all, current, spotlit, active } = useAxisNames(chart, axis)
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
  const write = categoryFormat ?? chart.grid?.[axis].format ?? categoryText
  // How wide a name is with its padding, measured in the chart's font.
  const nameLength = (name: ChartAxisName) => textWidth(write(name.value)) + 12
  // A few categories each keep a name, cut short if they must; a long run, such as days,
  // shows every few in full instead.
  const longest =
    current.length > MANY_CATEGORIES
      ? Math.max(MIN_LABEL, ...current.map(nameLength))
      : MIN_LABEL
  const shown = status === 'loading' ? [] : all
  const centreOf = (name: ChartAxisName) =>
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
                  ? `${(side === 'start') === (direction === 'ltr') ? 'calc(100cqw - 100% - 0.125rem)' : '0.125rem'} ${chart.grid ? `calc(${centre * 100}cqh - 50%)` : `clamp(0px, ${centre * 100}cqh - 50%, 100cqh - 100%)`}`
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
 * The names on a category axis, and which is under the pointer or the
 * focus (`active`) and which stays lit (`spotlit`), by place among the names
 * still in the data: the categories, or on a grid of cells, the names of
 * its columns (`x`) or its rows (`y`) over the cell lit.
 */
function useAxisNames(chart: ChartContextValue, axis: 'x' | 'y') {
  const { spotlit, active } = useChartActive()
  const { grid } = chart
  if (!grid) {
    return { names: chart.categories, current: chart.current, spotlit, active }
  }
  const { nameOf } = grid[axis]
  // A grid's names come from its layout, so they wait for the cells as a category's do.
  const names =
    chart.status === 'ready' || chart.status === 'hidden' ? grid[axis].names : []
  return {
    names,
    current: names,
    spotlit: spotlit === null ? null : nameOf(spotlit),
    active: active === null ? null : nameOf(active),
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
      ? `; max-width: calc(100cqw * ${run.every} / ${names.length} - ${gap}px)`
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
function useReferenceValue(value: number | ChartSummary | undefined, axis: ChartAxis) {
  const { current, series, hidden, stack, xy } = useChart()
  if (value === undefined || typeof value === 'number') return value ?? null
  const shown = series.filter((key) => !hidden.includes(key))
  // An XY frame's points each have a value on either axis.
  const values = xy
    ? xy.points.map((point) => (axis === 'x' ? point.x : point.y))
    : stack === 'none'
      ? current.flatMap((category) => shown.map((key) => category.datum[key]))
      : current.map((category) =>
          shown.reduce((sum, key) => sum + (numberOf(category.datum[key]) ?? 0), 0),
        )
  return summaryOf(values, value)
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
function ChartReferenceLine({
  value,
  category,
  axis = 'value',
  label,
  labelPosition = 'end',
  className,
  ...props
}: Omit<ComponentProps<'div'>, 'children'> & {
  value?: number | ChartSummary
  /** The key of the category to mark, in place of a value. */
  category?: string
  /** The axis `value` is on: the value axis, or the x axis of a chart whose x is a value too. */
  axis?: ChartAxis
  label?: ReactNode | ((value: number) => ReactNode)
  labelPosition?: 'start' | 'end'
}) {
  const chart = useChart()
  const { orientation, direction, status, current } = chart
  const onX = axis === 'x' && chart.xy !== undefined
  const { scale, previousScale } = scalesOf(chart, onX ? 'x' : 'value')
  const addReference = onX && chart.xy ? chart.xy.addReference : chart.addReference
  const marked = useReferenceValue(value, onX ? 'x' : 'value')
  useLayoutEffect(
    () =>
      marked === null || typeof value !== 'number' ? undefined : addReference(marked),
    [addReference, marked, value],
  )
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

  if (category !== undefined) {
    const at = current.find((c) => c.key === category)
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
          {...props}
        >
          <div
            className={cn(tickMove, slideLine[line])}
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
                    ? cn(
                        lineLabelAcross,
                        labelPosition === 'end' ? labelAbove : 'bottom-0',
                      )
                    : cn(
                        'top-0 -translate-y-1/2',
                        labelPosition === 'end' ? 'end-0' : 'start-0',
                      )
                }
              >
                {named}
              </ReferenceLabel>
            )}
          </div>
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
        {...props}
      >
        <div
          className={cn(tickMove, slideLine[line])}
          style={
            {
              ...axisSlide(
                line,
                valuePlace(marked, scale),
                valuePlace(marked, previousScale),
                direction,
              ),
              '--line-x': plotOffset(
                direction === 'rtl'
                  ? 1 - valuePlace(marked, scale)
                  : valuePlace(marked, scale),
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
                  : cn(lineLabelAcross, labelPosition === 'end' ? labelAbove : 'bottom-0')
              }
            >
              {named}
            </ReferenceLabel>
          )}
        </div>
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
function ChartReferenceArea({
  from,
  to,
  axis = 'value',
  label,
  className,
  ...props
}: Omit<ComponentProps<'div'>, 'children'> & {
  from: number
  to: number
  /** The axis `from` and `to` are on: the value axis, or the x axis of a chart whose x is a value too. */
  axis?: ChartAxis
  label?: ReactNode
}) {
  const chart = useChart()
  const { direction, status } = chart
  const onX = axis === 'x' && chart.xy !== undefined
  const { scale } = scalesOf(chart, onX ? 'x' : 'value')
  const addReference = onX && chart.xy ? chart.xy.addReference : chart.addReference
  // A band on an x axis runs down the plot, as a lying bar chart's values do.
  const orientation = onX ? 'horizontal' : chart.orientation
  useLayoutEffect(() => {
    const letFrom = addReference(from)
    const letTo = addReference(to)
    return () => {
      letFrom()
      letTo()
    }
  }, [addReference, from, to])
  if (status !== 'ready') return null
  const low = fractionOf(Math.min(from, to), scale.domain)
  const high = fractionOf(Math.max(from, to), scale.domain)
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
      {...props}
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
    markerOf,
    messages,
  } = useChart()
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
        markerOf={markerOf}
        hidden={hidden}
        onHiddenChange={setHidden}
        onEmphasisChange={setEmphasis}
      />
    </div>
  )
}

/** What a tooltip of your own gets for the category it shows. */
interface ChartTooltipItem {
  /** The category's place in the data. */
  index: number
  category: ChartCategory
}

type ChartTooltipProps = Omit<
  ComponentProps<typeof TooltipPopup>,
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
  const { active, setActive } = useChartActive()
  const chart = useChart()
  const { tooltip, columnId, status, stack, orientation, plot, current } = chart
  const open = active !== null && status === 'ready'
  // A series the pointer brought forward goes back with the category it lit.
  const release = () => {
    setActive(null)
    if (chart.seriesAt) chart.setEmphasis(null)
  }
  return (
    <GlideGroupMemory>
      <TooltipPrimitive.Root
        handle={tooltip}
        open={open}
        triggerId={open ? columnId(active) : null}
        onOpenChange={(next, details) => {
          if (next) return
          // The columns clear it when the pointer leaves or focus goes, so only Escape and
          // a press away from the chart close it here. A press on the chart, or on another
          // chart in its group, leaves the values showing.
          if (details.reason === 'escape-key') {
            release()
            return
          }
          if (details.reason !== 'outside-press') return
          const target = details.event?.target
          const figure = plot.current?.closest('figure')
          if (
            target instanceof Element &&
            (figure?.contains(target) || target.closest("[data-slot='chart-columns']"))
          )
            return
          release()
        }}
        disableHoverablePopup
      >
        {({ payload }) => {
          const category = payload === undefined ? undefined : current[payload]
          if (payload === undefined || !category) return null
          return (
            <ChartTooltipPopup
              // A new side starts the popup afresh there, rather than sliding it across the marks.
              key={chart.pointOf(payload)?.side}
              index={payload}
              side={
                side ??
                chart.pointOf(payload)?.side ??
                (orientation === 'vertical' ? 'top' : 'inline-end')
              }
              align={align}
              className={className}
              {...props}
            >
              {children ? (
                children({ index: payload, category })
              ) : chart.tooltipContent ? (
                chart.tooltipContent(payload)
              ) : (
                <ChartTooltipContent index={payload} total={total ?? stack !== 'none'} />
              )}
            </ChartTooltipPopup>
          )
        }}
      </TooltipPrimitive.Root>
    </GlideGroupMemory>
  )
}

/**
 * The tooltip's popup, on the point the marks of the category at `index`
 * are going to, so it never waits behind them. The point is a new anchor
 * only when it moves, as the popup sets its positioning up again for each
 * new anchor.
 */
function ChartTooltipPopup({
  index,
  className,
  ...props
}: ComponentProps<typeof TooltipPopup> & { index: number }) {
  const { plot, pointOf } = useChart()
  const point = pointOf(index)
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
    <TooltipPopup
      sideOffset={8}
      anchor={anchor}
      className={cn('max-w-72 px-2.5 py-2', className)}
      {...props}
    />
  )
}

/**
 * The values of the category at `index`: its name, then a row for each
 * shown series, with its change since the category before when the
 * categories run in order, and their total with `total`.
 */
function ChartTooltipContent({
  index,
  total = false,
  hideLabel = false,
  className,
  children,
  ...props
}: ComponentProps<'div'> & {
  index: number
  total?: boolean
  hideLabel?: boolean
}) {
  const chart = useChart()
  const {
    id,
    current,
    series,
    hidden,
    config,
    valueText,
    datumText,
    categoryText,
    ordered,
    locale,
    patternOf,
    messages,
  } = chart
  const category = current[index]
  if (!category) return null
  const before = ordered ? current[index - 1] : undefined
  const shown = series.filter((key) => !hidden.includes(key))
  const sum = shown.reduce((all, key) => all + (numberOf(category.datum[key]) ?? 0), 0)
  return (
    // The tooltip sits outside the chart, so it carries the chart's id for its colours.
    <div data-chart={id} className={cn('grid min-w-36 gap-1', className)} {...props}>
      {!hideLabel && <div className='font-medium'>{categoryText(category.value)}</div>}
      {shown.map((key) => {
        const value = category.datum[key]
        return (
          <div key={key} className='flex items-center gap-2'>
            <span
              aria-hidden
              className={cn(swatchClassName, forcedSeriesColor(series.indexOf(key)))}
              style={swatchStyle(key, patternOf(key))}
            />
            <span className='text-background/75 min-w-0 flex-1 truncate forced-colors:text-[CanvasText]'>
              {config[key]?.label ?? key}
              {isForecast(chart, key, index) && ` · ${messages.forecast}`}
            </span>
            {before && (
              <ChangeText
                change={changeSince(value, before.datum[key])}
                locale={locale}
                className='text-background/75 forced-colors:text-[CanvasText]'
              />
            )}
            {/* A value with a unit reads in its own order whatever the page's direction. */}
            <span dir='auto' className='font-medium tabular-nums'>
              {datumText(value)}
            </span>
          </div>
        )
      })}
      {total && shown.length > 1 && (
        <div className='border-background/20 mt-0.5 flex items-center gap-2 border-t pt-1 forced-colors:border-[CanvasText]'>
          <span className='text-background/75 flex-1 forced-colors:text-[CanvasText]'>
            {messages.total}
          </span>
          <span className='font-medium tabular-nums'>{valueText(sum)}</span>
        </div>
      )}
      {children}
    </div>
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
