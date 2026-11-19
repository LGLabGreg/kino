'use client'

import { TooltipPopup } from '@/registry/components/kino/tooltip'
import {
  axisLayerClassName,
  axisSlide,
  type ChartCategory,
  type ChartFormat,
  ChartGroup,
  ChartLegendToggles,
  ChangeText,
  forcedSeriesColor,
  formatterOf,
  isForecast,
  plotLayerClassName,
  slideLine,
  swatchStyle,
  tickMove,
  useChart,
  useChartActive,
  useTicks,
  valuePlace,
} from '@/registry/lib/chart-core'
import {
  type ChartSummary,
  changeSince,
  fractionOf,
  labelBox,
  type Span,
  labelsMeet,
  labelStep,
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
  useEffect,
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
 * the one on the category axis's edge, which the names stand in for. They
 * slide to their new place when the range changes, and new ones fade in
 * from where they would have been.
 */
function ChartGrid({ className, ...props }: Omit<ComponentProps<'div'>, 'children'>) {
  const { scale, previousScale, orientation, direction, status } = useChart()
  const layer = useRef<HTMLDivElement>(null)
  const ticks = useTicks(layer)
  const axis = orientation === 'vertical' ? 'y' : 'x'
  return (
    <div
      ref={layer}
      data-slot='chart-grid'
      aria-hidden
      className={cn(plotLayerClassName, 'z-0 overflow-visible', className)}
      {...props}
    >
      {status === 'ready' &&
        ticks.map(({ value: tick, leaving }) => (
          <div
            key={tick}
            data-leaving={leaving ? '' : undefined}
            data-edge={tick === scale.domain[0] ? '' : undefined}
            className={cn(
              'border-border border-dashed data-edge:opacity-0 forced-colors:border-[GrayText]',
              tickMove,
              slideLine[axis],
              axis === 'y' ? 'border-t' : 'border-l',
            )}
            style={axisSlide(
              axis,
              valuePlace(tick, scale),
              valuePlace(tick, previousScale),
              direction,
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
  const { orientation } = useChart()
  return orientation === 'vertical' ? (
    <ValueAxis side={side} format={format} {...props} />
  ) : (
    <CategoryAxis side={side} categoryFormat={categoryFormat} {...props} />
  )
}

/**
 * The axis under the plot: the categories of upright bars, or the values of
 * lying ones. With `side='top'`, above it.
 */
function ChartXAxis({
  side = 'bottom',
  format,
  categoryFormat,
  ...props
}: AxisProps & { side?: 'top' | 'bottom' }) {
  const { orientation } = useChart()
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
}: ComponentProps<'div'> & { side: AxisSide; label?: ReactNode; slot: string }) {
  const across = side === 'start' || side === 'end'
  const title = label && (
    <span
      className={cn(
        'text-muted-foreground shrink-0 truncate font-medium',
        across ? 'self-center [writing-mode:vertical-rl] rotate-180' : 'self-center',
      )}
    >
      {label}
    </span>
  )
  return (
    <div
      data-slot={slot}
      className={cn(
        'flex min-h-0 min-w-0 select-none',
        across ? 'flex-row gap-1' : 'flex-col gap-0.5',
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
  label,
  className,
  ...props
}: AxisProps & { side: AxisSide }) {
  const chart = useChart()
  const { scale, previousScale, stack, locale, status, direction } = chart
  const write = formatterOf(
    locale,
    format ??
      (stack === 'expand'
        ? { style: 'percent' }
        : typeof chart.format === 'function'
          ? chart.format
          : { maximumFractionDigits: 1, ...chart.format, notation: 'compact' }),
  )
  const layer = useRef<HTMLSpanElement>(null)
  const all = useTicks(layer)
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
                  // last value ends at the plot's edge, so it stays inside the chart.
                  side === 'bottom' && 'top-0 left-0',
                  side === 'top' && 'bottom-0 left-0',
                  !across &&
                    (tick !== scale.domain[1]
                      ? '-translate-x-1/2'
                      : direction === 'rtl'
                        ? 'translate-x-0'
                        : '-translate-x-full'),
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
  const { categories, current, categoryText, direction, status, textWidth } = useChart()
  const { spotlit, active } = useChartActive()
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
  const across = side === 'start' || side === 'end'
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
  const write = categoryFormat ?? categoryText
  // How wide a name is with its padding, measured in the chart's font.
  const nameLength = (category: ChartCategory) => textWidth(write(category.value)) + 12
  // A few categories each keep a name, cut short if they must; a long run, such as days,
  // shows every few in full instead.
  const longest =
    current.length > MANY_CATEGORIES
      ? Math.max(MIN_LABEL, ...current.map(nameLength))
      : MIN_LABEL
  const every = across ? 1 : labelStep(current.length, length, longest + LABEL_GAP)
  const shown = status === 'loading' ? [] : categories
  const pitch = current.length === 0 ? 0 : length / current.length
  const room = Math.max(0, pitch * every - LABEL_GAP)
  const centreOf = (category: ChartCategory) =>
    across
      ? category.band.start + category.band.size / 2
      : physicalStart(category.band, 'inline', direction) + category.band.size / 2
  // Where the spotlit name lands, whole, so the names it would meet step aside.
  // Only a name under the pointer or the focus shows whole; a picked one keeps its room, so
  // its neighbours keep theirs while it stays picked.
  const lit = active === null ? undefined : current[active]
  const litBox =
    across || !lit || length === 0
      ? null
      : labelBox(centreOf(lit), nameLength(lit), length)
  // The names that step aside: those between every few, and any that would meet the lit
  // name or the last one shown, as a name kept inside the axis at either end can.
  const skippedKeys = new Set<string>()
  if (!across && length > 0) {
    let last: Span | null = null
    for (const category of current) {
      if (category.index === active) continue
      const box = labelBox(
        centreOf(category),
        Math.min(nameLength(category), room),
        length,
      )
      if (
        category.index % every !== 0 ||
        (litBox !== null && labelsMeet(box, litBox)) ||
        (last !== null && labelsMeet(box, last))
      ) {
        skippedKeys.add(category.key)
        continue
      }
      last = box
    }
  }

  // The names, drawn twice: once on the axis, and once in the pill's colours inside the pill,
  // which shows only the part under it, so the name it slides onto reads in its colours.
  const layer = (copy: boolean) => (
    <span className={axisLayerClassName}>
      {shown.map((category) => {
        const centre = centreOf(category)
        const isLit = active === category.index && !category.leaving
        // A long run shows no names until the axis is measured, so they never pile up first.
        const skipped =
          !across &&
          !isLit &&
          (length === 0
            ? current.length > MANY_CATEGORIES
            : skippedKeys.has(category.key))
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
              skipped && 'opacity-0',
            )}
            style={{
              // Centred on its category, but kept inside the axis, so a whole name at either
              // end stays in view and inside the pill. Beside the plot, it sits against it.
              translate: across
                ? `${(side === 'start') === (direction === 'ltr') ? 'calc(100cqw - 100% - 0.125rem)' : '0.125rem'} clamp(0px, ${centre * 100}cqh - 50%, 100cqh - 100%)`
                : `clamp(0px, ${centre * 100}cqw - 50%, 100cqw - 100%) 0`,
              maxWidth: across || isLit ? undefined : `${room}px`,
            }}
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

/** The value a reference line marks: worked out from the data, or the number given. */
function useReferenceValue(value: number | ChartSummary | undefined) {
  const { current, series, hidden, stack } = useChart()
  if (value === undefined || typeof value === 'number') return value ?? null
  const shown = series.filter((key) => !hidden.includes(key))
  const values =
    stack === 'none'
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
 * `value`, it marks that category instead, such as the day of a launch.
 */
function ChartReferenceLine({
  value,
  category,
  label,
  labelPosition = 'end',
  className,
  ...props
}: Omit<ComponentProps<'div'>, 'children'> & {
  value?: number | ChartSummary
  /** The key of the category to mark, in place of a value. */
  category?: string
  label?: ReactNode | ((value: number) => ReactNode)
  labelPosition?: 'start' | 'end'
}) {
  const chart = useChart()
  const { scale, previousScale, orientation, direction, status, addReference, current } =
    chart
  const marked = useReferenceValue(value)
  useLayoutEffect(
    () =>
      marked === null || typeof value !== 'number' ? undefined : addReference(marked),
    [addReference, marked, value],
  )
  // The room stays while the chart loads or fails, so the plot keeps its size.
  const room =
    label !== undefined &&
    labelPosition === 'end' &&
    (category !== undefined) === (orientation === 'vertical') ? (
      <LabelRoom />
    ) : null
  if (status !== 'ready') return room
  const named = typeof label === 'function' ? marked !== null && label(marked) : label

  if (category !== undefined) {
    const at = current.find((c) => c.key === category)
    if (!at) return room
    // Across the value axis, at the category's centre.
    const axis = orientation === 'vertical' ? 'x' : 'y'
    const centre =
      physicalStart(at.band, orientation === 'vertical' ? 'inline' : 'block', direction) +
      at.band.size / 2
    const place = axis === 'x' ? (direction === 'rtl' ? 1 - centre : centre) : 1 - centre
    return (
      <>
        {room}
        <div
          data-slot='chart-reference-line'
          className={cn(plotLayerClassName, 'z-15', className)}
          {...props}
        >
          <div
            className={cn(tickMove, slideLine[axis])}
            style={
              {
                ...axisSlide(axis, place, place, direction),
                '--line-x': `${place * 100}cqw`,
              } as CSSProperties
            }
          >
            <div
              className={cn(
                'border-foreground/60 absolute border-dashed forced-colors:border-[CanvasText]',
                axis === 'y' ? 'inset-x-0 top-0 border-t' : 'inset-y-0 left-0 border-l',
              )}
            />
            {named && (
              <ReferenceLabel
                className={
                  axis === 'x'
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
  const axis = orientation === 'vertical' ? 'y' : 'x'
  return (
    <>
      {room}
      <div
        data-slot='chart-reference-line'
        className={cn(plotLayerClassName, 'z-15', className)}
        {...props}
      >
        <div
          className={cn(tickMove, slideLine[axis])}
          style={
            {
              ...axisSlide(
                axis,
                valuePlace(marked, scale),
                valuePlace(marked, previousScale),
                direction,
              ),
              '--line-x': `${(direction === 'rtl' ? 1 - valuePlace(marked, scale) : valuePlace(marked, scale)) * 100}cqw`,
            } as CSSProperties
          }
        >
          <div
            className={cn(
              'border-foreground/60 absolute border-dashed forced-colors:border-[CanvasText]',
              axis === 'y' ? 'inset-x-0 top-0 border-t' : 'inset-y-0 left-0 border-l',
            )}
          />
          {named && (
            <ReferenceLabel
              className={
                axis === 'y'
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
 * enough to show it, and it moves with the range.
 */
function ChartReferenceArea({
  from,
  to,
  label,
  className,
  ...props
}: Omit<ComponentProps<'div'>, 'children'> & {
  from: number
  to: number
  label?: ReactNode
}) {
  const { scale, orientation, direction, status, addReference } = useChart()
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
  const pct = (fraction: number) => `${Math.round(fraction * 10_000) / 100}`
  const clip =
    orientation === 'vertical'
      ? `inset(${pct(1 - high)}cqh 0 ${pct(low)}cqh 0)`
      : direction === 'rtl'
        ? `inset(0 ${pct(low)}cqw 0 ${pct(1 - high)}cqw)`
        : `inset(0 ${pct(1 - high)}cqw 0 ${pct(low)}cqw)`
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
              '--area-label': `0 ${orientation === 'vertical' ? pct(1 - high) : 0}cqh`,
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
  const { series, config, hidden, setHidden, setEmphasis, patternOf, messages } =
    useChart()
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
            setActive(null)
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
          setActive(null)
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
}: ComponentProps<'div'> & { index: number; total?: boolean; hideLabel?: boolean }) {
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
              className={cn(
                'size-2 shrink-0 rounded-[calc(var(--control-radius-xs)/4)] bg-(--swatch)',
                forcedSeriesColor(series.indexOf(key)),
              )}
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
