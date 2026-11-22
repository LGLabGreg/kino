'use client'

import {
  AreaFill,
  type AreaFillElements,
  areaPathThrough,
  fillPeak,
  paintFill,
} from '@/registry/lib/area-fill'
import {
  CategoryChartFrame,
  type ChartCategory,
  type CategoryChartInput,
  type ChartContextValue,
  type EntrancePhase,
  useChart,
  useChartActive,
} from '@/registry/lib/chart-core'
import type { CartesianModel } from '@/registry/lib/chart-frame'
import { seriesPoints } from '@/registry/lib/chart-line-marks'
import type { ReadingDirection } from '@/registry/lib/chart-math'
import {
  forcedSeriesColor,
  forcedSeriesTextColor,
  plotLayerClassName,
  type MoveRole,
  seriesColor,
  useFromRest,
  usePointsMove,
} from '@/registry/lib/chart-root'
import { bandCentre } from '@/registry/lib/chart-scale'
import {
  alignLines,
  brightSpan,
  bridgesThrough,
  type LineCurve,
  type LinePoint,
  litSpan,
  lonePointsThrough,
  pathThrough,
  type PathCurve,
  pointsAt,
} from '@/registry/lib/line-path'
import { placeholderBreatheClassName } from '@/registry/lib/placeholder'
import { registerProperties } from '@/registry/lib/run-progress'
import {
  type ComponentProps,
  createContext,
  type CSSProperties,
  memo,
  type ReactNode,
  type Ref,
  type RefObject,
  use,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import { cn } from '@/lib/utils'

/*
 * What the charts drawn as lines share, on the chart core: the Line chart's
 * lines, the Area chart's areas and the Bump chart's ranks. Each series is a line drawn by d3-shape
 * from its points, with a fill under it for an area, and its points move on
 * one CSS transition of a number, `--line-progress`, so the feel, reduced
 * motion and a slowed playback time it as they time everything else. A frame
 * of that transition redraws the paths straight in the page, so nothing
 * re-renders while a line moves. Its paths are drawn in fractions of the
 * plot, in an SVG one unit square stretched over it, with strokes that keep
 * their width, so the server draws the lines the browser does and a plot
 * that changes size never redraws them.
 *
 * When a category is lit, every series steps back but for a window around
 * it, which glides with the axis's pill, and a dot on each series marks it.
 * A series brought forward, from the legend or the Bump chart's pointer,
 * stays bright end to end while every other one steps back whole.
 *
 * Each chart names the variables a buyer tunes after itself
 * (`--line-chart-width`, `--area-chart-width`): the root of each series reads
 * them into the `--trace-*` variables its parts draw with.
 */

/** Which chart a series belongs to, which names the variables it reads. */
type LineFamilyName = 'line-chart' | 'area-chart' | 'bump-chart'

interface LineFamilyValue {
  name: LineFamilyName
  phase: EntrancePhase
  entrance: 'rise' | 'draw' | 'none'
  /** The lit category's dot on each series, by series, which a series' move carries with it. */
  litDots: RefObject<Map<string, HTMLElement>>
  /**
   * A series' points for the categories shown, with their baselines for an
   * area; along zero when `rising`, before the chart's entrance.
   */
  pointsOf: (key: string, rising: boolean) => LinePoint[]
  /** Where a series' lit dot sits on `category`, as a fraction of the plot from its top, or null with no value. */
  topOf: (key: string, category: ChartCategory) => number | null
  /** Where a second lit dot marks the bottom of a value given as a range, as `topOf` does its top; null for a single value. */
  bottomOf?: (key: string, category: ChartCategory) => number | null
  /** Where a series lies flat, such as one that arrives on an empty chart, as a fraction of the plot from its top: its axis's baseline. */
  restOf: (key: string) => number
}

/** The key the lit dot on the bottom of a series' range goes by among the lit dots. */
function bottomDotKey(key: string) {
  return `${key}\u0000bottom`
}

const LineFamilyContext = createContext<LineFamilyValue | null>(null)

function useLineFamily() {
  const family = use(LineFamilyContext)
  if (!family) throw new Error('`Line` and `Area` go inside their chart.')
  return family
}

/**
 * A series' points through the categories shown, read against its own value
 * axis, as fractions of the plot: an area's baseline too `withBase`, and all
 * along its axis's baseline when it lies `flat`.
 */
function framePoints(
  chart: ChartContextValue,
  model: CartesianModel,
  key: string,
  flat: boolean,
  withBase: boolean,
): LinePoint[] {
  const { scale, baseline } = model.valueAxisOf(key)
  return seriesPoints(
    chart.current,
    model.spans[key] ?? [],
    scale,
    baseline,
    flat,
    withBase,
  )
}

/** Where a series' span on `category` ends, its value's far end or with `near` its near end, as a fraction of the plot from its top; null with no value. */
function frameTop(
  model: CartesianModel,
  key: string,
  category: ChartCategory,
  near = false,
): number | null {
  const span = model.spans[key]?.[category.index]
  const { scale } = model.valueAxisOf(key)
  return span ? 1 - scale.place(near ? span[0] : span[1]) : null
}

/** Where a series lies flat, as a fraction of the plot from its top: on its axis's baseline. */
function frameRest(model: CartesianModel, key: string): number {
  return 1 - model.valueAxisOf(key).baseline
}

/** The variables a series draws with, read from its chart's own. */
function traceVariables(name: LineFamilyName) {
  return {
    '--trace-width': `var(--${name}-width, 2px)`,
    '--trace-dim': `var(--${name}-dim, 0.3)`,
    '--trace-fade': `var(--${name}-window-fade, 1.5rem)`,
    '--trace-fill-top': `var(--${name}-fill-top, 0.32)`,
    '--trace-fill-bottom': `var(--${name}-fill-bottom, 0.04)`,
  } as CSSProperties
}

/**
 * The frame of a chart drawn as lines: the chart core's frame, with room
 * beside the plot for a dot on the first or last point, the placeholder
 * while it loads, and the dots that mark the lit category.
 */
function LineFamilyFrame({
  chart,
  family,
  description,
  empty,
  placeholder,
  fill,
  className,
  children,
  ref,
  ...props
}: Omit<ComponentProps<'figure'>, 'ref'> & {
  chart: CategoryChartInput
  family: Omit<LineFamilyValue, 'litDots'>
  description?: string
  empty?: ReactNode
  /** Whether the placeholder shows, while the data loads. */
  placeholder: boolean
  /** Whether the placeholder is filled, as the areas are. */
  fill: boolean
  ref?: Ref<HTMLElement>
}) {
  const litDots = useRef(new Map<string, HTMLElement>())
  useLayoutEffect(registerLineProperties, [])
  return (
    <LineFamilyContext value={{ ...family, litDots }}>
      <CategoryChartFrame
        chart={chart}
        ref={ref}
        slot={family.name}
        description={description}
        empty={empty}
        // The columns beside the plot keep room for a dot on the first or the last point, half of
        // which reaches past the plot, even with no axis there; the pointer finds it there too.
        className={cn(
          'grid-cols-[minmax(0.375rem,auto)_minmax(0,1fr)_minmax(0.375rem,auto)] **:data-[slot=chart-columns]:before:absolute **:data-[slot=chart-columns]:before:inset-y-0 **:data-[slot=chart-columns]:before:-inset-x-1.5',
          className,
        )}
        placeholder={placeholder && <LinePlaceholder name={family.name} fill={fill} />}
        {...props}
      >
        {children}
        <LineLitMarks />
      </CategoryChartFrame>
    </LineFamilyContext>
  )
}

/** The properties the series move on, so their transitions can run them. Once per page. */
function registerLineProperties() {
  registerProperties([
    ...(['--line-window-from', '--line-window-to'] as const).map((name, at) => ({
      name,
      syntax: '<length-percentage>',
      inherits: true,
      initialValue: at === 0 ? '0%' : '100%',
    })),
    // How much the window shows its bright copy, 0 while the legend brings another series forward,
    // and where the lit dots sit across the plot, as a fraction: both move as the window does.
    ...(['--line-window-shown', '--line-lit-x'] as const).map((name) => ({
      name,
      syntax: '<number>',
      inherits: true,
      initialValue: name === '--line-lit-x' ? '0' : '1',
    })),
  ])
}

/** Everything a series draws for one set of points: the line, the bridges over its gaps, its lone points, its fill, and where its forecast starts. */
interface LineDrawing {
  line: string
  bridges: string
  lone: string
  /** The fill under the line, for an area; empty for a bare line. */
  area: string
  /** Where the fill is strongest, as a fraction of the plot from its top. */
  peak: number
  /** Where the dashed forecast starts, as a fraction of the plot from the reading start, or null with none. */
  split: number | null
}

/** What a series draws through `points`, in fractions of the plot, for an SVG of `unitFrame`. */
function drawingOf(
  points: readonly LinePoint[],
  curve: PathCurve,
  splitKey: string | null,
  fill: boolean,
): LineDrawing {
  const split =
    splitKey === null ? null : (points.find((point) => point.key === splitKey)?.x ?? null)
  return {
    line: pathThrough(points, curve, 1, 1),
    bridges: bridgesThrough(points, 1, 1),
    lone: lonePointsThrough(points, 1, 1),
    area: fill ? areaPathThrough(points, curve, 1, 1) : '',
    peak: fill ? fillPeak(points) : 0,
    split,
  }
}

/**
 * The frame of a series' SVGs: one unit square, stretched over the plot,
 * so a path drawn in fractions of it fills it at any size. Every stroke in
 * it keeps its width with `non-scaling-stroke`, dashes and round caps too.
 */
const unitFrame = { viewBox: '0 0 1 1', preserveAspectRatio: 'none' } as const

/** The elements a series redraws on each frame of a move. */
interface LineElements {
  paths: RefObject<(SVGPathElement | null)[]>
  bridges: RefObject<SVGPathElement | null>
  lone: RefObject<(SVGPathElement | null)[]>
  splits: RefObject<(SVGRectElement | null)[]>
  /** The fill's path and gradient in each copy of the series: stepped back, and bright. */
  fills: readonly AreaFillElements[]
  dots: RefObject<Map<string, HTMLElement>>
  /** The series' dots on the lit category, if they show: on its top, and on the bottom of a range. */
  litDots: () => readonly [HTMLElement | undefined, HTMLElement | undefined]
}

/**
 * Writes a drawing and its points into the series' elements. While the
 * series is `moving`, the lit category's dot rides on it; after, it goes
 * back to where the chart places it.
 */
function paint(
  elements: LineElements,
  drawing: LineDrawing,
  points: readonly LinePoint[],
  moving = false,
) {
  for (const path of elements.paths.current) path?.setAttribute('d', drawing.line)
  elements.bridges.current?.setAttribute('d', drawing.bridges)
  for (const path of elements.lone.current) path?.setAttribute('d', drawing.lone)
  for (const fill of elements.fills) paintFill(fill, drawing.area, drawing.peak)
  const [solid, dashed] = elements.splits.current
  if (drawing.split !== null) {
    solid?.setAttribute('width', String(Math.max(0, drawing.split + SPLIT_BLEED)))
    dashed?.setAttribute('x', String(drawing.split))
  }
  for (const point of points) {
    if (point.key === null) continue
    const dot = elements.dots.current.get(point.key)
    if (dot) dot.style.translate = `${point.x * 100}cqw ${point.y * 100}cqh`
  }
  const [top, bottom] = elements.litDots()
  for (const [litDot, heightOf] of [
    [top, (point: LinePoint) => point.y],
    [bottom, (point: LinePoint) => point.base],
  ] as const) {
    if (!litDot) continue
    const lit = moving
      ? points.find((point) => point.key === litDot.dataset.key)
      : undefined
    const height = lit && heightOf(lit)
    if (height !== undefined) {
      litDot.dataset.moving = ''
      litDot.style.setProperty('--line-lit-y', `${height * 100}cqh`)
    } else {
      delete litDot.dataset.moving
      litDot.style.removeProperty('--line-lit-y')
    }
  }
}

/** How far past the plot's edges a series' clips reach, as a share of the plot, so its caps aren't cut. */
const SPLIT_BLEED = 1

/**
 * Moves a series' elements to `to` whenever it changes: from wherever they
 * are, even halfway through a move, on the frames of `--line-progress`. A
 * change of curve alone redraws at once.
 */
function useLineMove(
  role: MoveRole,
  elements: LineElements,
  to: readonly LinePoint[],
  curve: PathCurve,
  splitKey: string | null,
  fill: boolean,
  start: readonly LinePoint[],
) {
  usePointsMove(
    role,
    to,
    to
      .map(
        (point) =>
          `${point.key}:${point.x.toFixed(5)}:${point.y.toFixed(5)}:${point.base?.toFixed(5)}:${point.defined}`,
      )
      .join('|'),
    start,
    `${curve}|${splitKey}|${fill}`,
    {
      align: (from, next) => alignLines(from, next, curve),
      at: pointsAt,
      draw: (points, moving) =>
        paint(elements, drawingOf(points, curve, splitKey, fill), points, moving),
    },
  )
}

interface LineSeriesProps extends Omit<ComponentProps<'div'>, 'children' | 'color'> {
  /** The key of this series' values in the data, and of its entry in the config. */
  dataKey: string
  /** How the line runs between its points: a smooth curve that never overshoots them, straight, or in steps. */
  curve?: LineCurve
  /** Marks every point with a dot, not only the one lit; `'last'` marks only the last value, as a sparkline's end dot does. */
  dots?: boolean | 'last'
  /** Draws the whole line dashed, such as a target or last year's line. */
  dashed?: boolean
  /** The key of the first category that is a forecast: the line is dashed from the one before it on. */
  forecastFrom?: string
  /** Bridges each gap a missing value leaves with a dashed line, in place of a break. */
  connectNulls?: boolean
}

/**
 * One series, in the series' colour: a layer of the plot holding its fill
 * for an area, its line, a dashed bridge over each missing value, and a dot
 * on each point. When a category is lit, the series steps back, leaving it
 * bright around the category, a window that glides with the axis's pill.
 */
function LineSeries({
  dataKey,
  curve = 'monotone',
  dots = false,
  dashed = false,
  forecastFrom,
  connectNulls = false,
  fill = false,
  className,
  style,
  ...props
}: Omit<LineSeriesProps, 'curve'> & {
  /** How the line runs between its points, a bump chart's S among them. */
  curve?: PathCurve
  /** Fills the area under the line, down to its baseline. */
  fill?: boolean
}) {
  const chart = useChart()
  const { spotlit } = useChartActive()
  const family = useLineFamily()
  const spot = useRef<HTMLDivElement>(null)
  const fromRest = useFromRest(spotlit)
  const id = useId().replaceAll(':', '')
  const hidden = chart.hidden.includes(dataKey)
  const rising = !chart.entered && family.entrance === 'rise'
  // While the chart loads, the series folds into the placeholder's and fades, and grows back
  // out of it when the data arrives.
  const loading = chart.status === 'loading'
  const drawn = chart.status === 'ready' || chart.status === 'hidden' || loading
  const { pointsOf } = family
  // Worked out again only when the data, the scale or the size change, never on a hover over the plot.
  const to = useMemo(
    () => (loading ? placeholderPoints(fill) : drawn ? pointsOf(dataKey, rising) : []),
    // `pointsOf` is made again whenever the chart's data, scale or shown series change.
    [pointsOf, dataKey, rising, loading, drawn, fill],
  )
  const first = to.findIndex((point) => point.key === forecastFrom)
  const splitKey = first > 0 ? (to[first - 1]?.key ?? null) : null
  // A forecast from the first category on is the whole line.
  const allForecast = first === 0
  const paths = useRef<(SVGPathElement | null)[]>([])
  const bridges = useRef<SVGPathElement>(null)
  const lone = useRef<(SVGPathElement | null)[]>([])
  const splits = useRef<(SVGRectElement | null)[]>([])
  // The fill in the stepped-back copy of the series, and in the bright one. Each ref is its own
  // call: the React Compiler keeps an object it builds once, skipping hooks written inside it.
  const steppedFillPath = useRef<SVGPathElement>(null)
  const steppedFillGradient = useRef<SVGLinearGradientElement>(null)
  const litFillPath = useRef<SVGPathElement>(null)
  const litFillGradient = useRef<SVGLinearGradientElement>(null)
  const steppedFill = { path: steppedFillPath, gradient: steppedFillGradient }
  const litFill = { path: litFillPath, gradient: litFillGradient }
  const dotElements = useRef(new Map<string, HTMLElement>())
  const rest = family.restOf(dataKey)
  // Where a series that arrives on an empty chart starts: flat along its baseline.
  const start = useMemo(
    () =>
      to.map((point) => ({
        ...point,
        y: rest,
        ...(point.base === undefined ? {} : { base: rest }),
      })),
    [to, rest],
  )
  useLineMove(
    // The entrance draws the lines along their length; every change after moves them.
    family.phase === 'entering' ? 'draw' : 'layout',
    {
      paths,
      bridges,
      lone,
      splits,
      fills: [steppedFill, litFill],
      dots: dotElements,
      litDots: () => [
        family.litDots.current.get(dataKey),
        family.litDots.current.get(bottomDotKey(dataKey)),
      ],
    },
    to,
    curve,
    splitKey,
    fill,
    start,
  )
  const drawing = useMemo(
    () => drawingOf(to, curve, splitKey, fill),
    [to, curve, splitKey, fill],
  )
  if (!drawn) return null
  const slot = chart.series.indexOf(dataKey)
  const emphasised = chart.emphasis === dataKey
  const otherEmphasised = chart.emphasis !== null && !emphasised
  // The series steps back while a category is lit, all but its bright copy, or whole while
  // another series is brought forward. Brought forward itself, it stays bright end to end.
  const windowAt = emphasised ? null : spotlit
  const stepsBack = windowAt !== null || otherEmphasised
  const window = litWindow(chart, windowAt)
  const bright = brightSpan(windowAt, to.length)
  const pathClass =
    'fill-none stroke-current [stroke-width:calc(var(--trace-width)*var(--trace-weight,1))] [stroke-linecap:round] [stroke-linejoin:round] [vector-effect:non-scaling-stroke]'
  const strokes = (bright: boolean) => (
    <>
      {connectNulls && !bright && (
        <path
          ref={bridges}
          d={drawing.bridges}
          className={cn(pathClass, 'opacity-60 [stroke-dasharray:2_4]')}
        />
      )}
      <path
        ref={(element) => {
          paths.current[bright ? 1 : 0] = element
        }}
        d={drawing.line}
        clipPath={splitKey ? `url(#${id}-solid)` : undefined}
        className={cn(pathClass, (dashed || allForecast) && '[stroke-dasharray:6_5]')}
      />
      <path
        ref={(element) => {
          lone.current[bright ? 1 : 0] = element
        }}
        d={drawing.lone}
        className='fill-none stroke-current [stroke-width:calc(var(--trace-width)*3)] [stroke-linecap:round] [vector-effect:non-scaling-stroke]'
      />
      {splitKey && (
        <path
          ref={(element) => {
            paths.current[bright ? 3 : 2] = element
          }}
          d={drawing.line}
          clipPath={`url(#${id}-dashed)`}
          className={cn(pathClass, '[stroke-dasharray:6_5]')}
        />
      )}
    </>
  )
  const splitAt = drawing.split ?? 0
  return (
    <div
      data-slot={`${family.name}-series`}
      data-series={dataKey}
      data-hidden={hidden || loading ? '' : undefined}
      aria-hidden
      className={cn(
        plotLayerClassName,
        'z-10 transition-opacity duration-(--motion-layout-duration) ease-(--motion-layout-easing) data-hidden:opacity-0',
        className,
      )}
      style={
        {
          '--line-color': seriesColor(dataKey),
          ...traceVariables(family.name),
          ...style,
        } as CSSProperties
      }
      {...props}
    >
      <EntranceWipe>
        {/* The window around the lit category, which the fill and the bright copy of the line
            share, so they glide as one, and how much it shows, which fades both ways. */}
        <div
          ref={spot}
          data-snap={fromRest ? '' : undefined}
          className='absolute inset-0 transition-[--line-window-from,--line-window-to,--line-window-shown] duration-(--motion-layout-duration) ease-(--motion-layout-easing) data-snap:transition-[--line-window-shown] motion-reduce:transition-[--line-window-shown]'
          style={
            {
              '--line-window-from': window.from,
              '--line-window-to': window.to,
              '--line-window-shown': otherEmphasised ? 0 : 1,
            } as CSSProperties
          }
        >
          {/* The fill, stepped back, seen everywhere but through the window, so the bright copy's
              fill there never lies over it. With another series brought forward, it is whole. */}
          {fill && (
            <div className='absolute inset-0 [mask-image:linear-gradient(to_right,black_calc(var(--line-window-from)-var(--trace-fade)),rgb(0_0_0/calc(1-var(--line-window-shown)))_var(--line-window-from),rgb(0_0_0/calc(1-var(--line-window-shown)))_var(--line-window-to),black_calc(var(--line-window-to)+var(--trace-fade)))]'>
              <svg
                {...unitFrame}
                data-dim={stepsBack ? '' : undefined}
                // A wash steps back in strength as well as colour, or it reads as strong as the lit one.
                className={cn(
                  'absolute inset-0 size-full overflow-visible text-(--line-color) transition-[color,opacity] duration-(--motion-layout-duration) ease-(--motion-layout-fade-easing) not-forced-colors:data-dim:text-[oklch(from_var(--line-color)_l_calc(c*var(--trace-dim))_h)] data-dim:opacity-60',
                  forcedSeriesTextColor(slot),
                )}
              >
                <g transform={mirror(chart.direction)}>
                  <AreaFill
                    id={`${id}-fill`}
                    path={drawing.area}
                    peak={drawing.peak}
                    height={1}
                    elements={steppedFill}
                  />
                </g>
              </svg>
            </div>
          )}
          <svg
            {...unitFrame}
            data-entering={family.phase === 'entering' ? '' : undefined}
            data-dim={stepsBack ? '' : undefined}
            className={cn(
              'absolute inset-0 size-full overflow-visible text-(--line-color) transition-[color] duration-(--motion-layout-duration) ease-(--motion-layout-fade-easing) not-forced-colors:data-dim:text-[oklch(from_var(--line-color)_l_calc(c*var(--trace-dim))_h)] forced-colors:data-dim:[--trace-weight:0.5] data-entering:duration-(--motion-draw-duration) data-entering:ease-(--motion-draw-fade-easing)',
              forcedSeriesTextColor(slot),
            )}
          >
            {splitKey && (
              <defs>
                <clipPath id={`${id}-solid`}>
                  <rect
                    ref={(element) => {
                      splits.current[0] = element
                    }}
                    x={-SPLIT_BLEED}
                    y={-SPLIT_BLEED}
                    width={splitAt + SPLIT_BLEED}
                    height={1 + SPLIT_BLEED * 2}
                  />
                </clipPath>
                <clipPath id={`${id}-dashed`}>
                  <rect
                    ref={(element) => {
                      splits.current[1] = element
                    }}
                    x={splitAt}
                    y={-SPLIT_BLEED}
                    width={1 + SPLIT_BLEED}
                    height={1 + SPLIT_BLEED * 2}
                  />
                </clipPath>
              </defs>
            )}
            <g transform={mirror(chart.direction)}>{strokes(false)}</g>
          </svg>
          {/* The line again in its own colour, seen only through the window around the lit
              category, while the rest of the line steps back. */}
          <div
            aria-hidden
            className={cn(
              forcedSeriesTextColor(slot),
              'absolute inset-0 text-(--line-color) [mask-image:linear-gradient(to_right,transparent_calc(var(--line-window-from)-var(--trace-fade)),black_var(--line-window-from),black_var(--line-window-to),transparent_calc(var(--line-window-to)+var(--trace-fade)))] opacity-(--line-window-shown)',
            )}
          >
            <svg {...unitFrame} className='absolute inset-0 size-full overflow-visible'>
              <g transform={mirror(chart.direction)}>
                {fill && (
                  <AreaFill
                    id={`${id}-fill-lit`}
                    path={drawing.area}
                    peak={drawing.peak}
                    height={1}
                    elements={litFill}
                  />
                )}
                {strokes(true)}
              </g>
            </svg>
          </div>
        </div>
        {dots && chart.status === 'ready' && !hidden && (
          <LineDots
            dataKey={dataKey}
            points={to}
            dots={dotElements}
            last={dots === 'last'}
            slot={slot}
            dimmed={otherEmphasised}
            brightFrom={bright?.[0] ?? null}
            brightTo={bright?.[1] ?? null}
          />
        )}
      </EntranceWipe>
    </div>
  )
}

/** The transform that runs a series' unit frame from the right, in right to left. */
function mirror(direction: ReadingDirection) {
  return direction === 'rtl' ? 'translate(1 0) scale(-1 1)' : undefined
}

/**
 * Where the bright copy of the series shows, as the start and end of its
 * window in the plot's left-to-right order: around the lit category, from
 * the point before it to the point after. With nothing lit, it opens past
 * both ends, since the whole series is bright.
 */
function litWindow(
  chart: ChartContextValue,
  at: number | null,
): { from: string; to: string } {
  const centres = chart.current.map((category) => bandCentre(category.band))
  const window = at === null ? null : litSpan(centres, at)
  if (!window) return { from: '-100%', to: '200%' }
  const [from, to] = window
  // In right to left, the plot's reading start is its right edge.
  const left = chart.direction === 'rtl' ? 1 - to : from
  const right = chart.direction === 'rtl' ? 1 - from : to
  return { from: `${left * 100}%`, to: `${right * 100}%` }
}

/**
 * The chart's first appearance with `entrance='draw'`: the series are wiped
 * in from the reading start on `draw`, and stay whole from then on.
 */
function EntranceWipe({ children }: { children: ReactNode }) {
  const chart = useChart()
  const family = useLineFamily()
  if (family.entrance !== 'draw') return children
  return (
    <div
      data-entered={chart.entered ? '' : undefined}
      className={cn(
        'absolute -inset-3 transition-[clip-path] duration-(--motion-draw-duration) ease-(--motion-draw-easing) motion-reduce:transition-none',
        chart.direction === 'rtl'
          ? '[clip-path:inset(0_0_0_100%)] data-entered:[clip-path:inset(0)]'
          : '[clip-path:inset(0_100%_0_0)] data-entered:[clip-path:inset(0)]',
      )}
    >
      <div className='absolute inset-3 [container-type:size]'>{children}</div>
    </div>
  )
}

/**
 * A dot on each of a series' points, moved with it on each frame, or with
 * `last` a solid one on its last value only.
 */
const LineDots = memo(function LineDots({
  dataKey,
  points,
  dots,
  last,
  slot,
  dimmed,
  brightFrom,
  brightTo,
}: {
  dataKey: string
  points: readonly LinePoint[]
  dots: RefObject<Map<string, HTMLElement>>
  last: boolean
  slot: number
  /** Every dot steps back, while another series is brought forward. */
  dimmed: boolean
  /** The first and last points that stay bright while the rest step back, by place; null when none step back. */
  brightFrom: number | null
  brightTo: number | null
}) {
  const { direction } = useChart()
  const final = points.findLastIndex((point) => point.defined)
  return (
    <div className={cn('absolute inset-0', direction === 'rtl' && '-scale-x-100')}>
      {points.map((point, at) =>
        point.defined && (!last || at === final) ? (
          <span
            key={point.key}
            ref={(element) => {
              if (!element || point.key === null) return
              dots.current.set(point.key, element)
              return () => {
                if (point.key !== null && dots.current.get(point.key) === element)
                  dots.current.delete(point.key)
              }
            }}
            data-dim={
              dimmed ||
              (brightFrom !== null &&
                brightTo !== null &&
                (at < brightFrom || at > brightTo))
                ? ''
                : undefined
            }
            data-series={dataKey}
            className={cn(
              forcedSeriesTextColor(slot),
              'absolute top-0 left-0 size-0 transition-[color] duration-(--motion-layout-duration) ease-(--motion-layout-fade-easing) text-(--line-color) not-forced-colors:data-dim:text-[oklch(from_var(--line-color)_l_calc(c*var(--trace-dim))_h)]',
            )}
            style={{ translate: `${point.x * 100}cqw ${point.y * 100}cqh` }}
          >
            <span
              className={cn(
                'absolute -top-1 -left-1 size-2 rounded-full',
                last
                  ? cn('ring-background bg-current ring-2', forcedSeriesColor(slot))
                  : 'bg-background border-2 border-current',
              )}
            />
          </span>
        ) : null,
      )}
    </div>
  )
})

/**
 * What marks the lit category: a dot on each shown series where it crosses
 * the category. They glide from category to category with the tooltip,
 * appear in place after a rest, and fade where they are when the pointer
 * leaves.
 */
function LineLitMarks() {
  const chart = useChart()
  const family = useLineFamily()
  const at = useChartActive().spotlit
  const marks = useRef<HTMLDivElement>(null)
  const fromRest = useFromRest(at)
  // The category last lit, where the marks stay while they fade out.
  const [last, setLast] = useState(at)
  if (at !== null && at !== last) setLast(at)
  const shownAt = at ?? last
  const category = shownAt === null ? undefined : chart.current[shownAt]
  if (chart.status !== 'ready' || !category || !chart.entered) return null
  const x = chart.direction === 'rtl' ? 1 - category.band.start : category.band.start
  const shown = chart.series.filter((key) => !chart.hidden.includes(key))
  const move =
    'absolute top-0 left-0 transition-[translate] duration-(--motion-layout-duration) ease-(--motion-layout-easing) data-snap:transition-none motion-reduce:transition-none'
  const snap = fromRest ? '' : undefined
  return (
    <div
      ref={marks}
      aria-hidden
      data-slot={`${family.name}-lit`}
      data-hidden={at === null ? '' : undefined}
      className={cn(
        plotLayerClassName,
        'z-20 transition-opacity duration-(--motion-enter-duration) ease-(--motion-enter-easing) data-hidden:opacity-0 data-hidden:duration-(--motion-exit-duration) data-hidden:ease-(--motion-exit-easing)',
      )}
      style={traceVariables(family.name)}
    >
      {/* Across the plot, the dots move on a property, as the window does, so the two retarget
          alike when a glide changes course. */}
      <div
        data-snap={snap}
        className='absolute inset-0 transition-[--line-lit-x] duration-(--motion-layout-duration) ease-(--motion-layout-easing) data-snap:transition-none motion-reduce:transition-none'
        style={{ '--line-lit-x': x } as CSSProperties}
      >
        {shown.flatMap((key) => {
          const top = family.topOf(key, category)
          const bottom = family.bottomOf?.(key, category) ?? null
          if (top === null) return []
          const dot = (name: string, y: number) => (
            <span
              key={name}
              className='absolute top-0 left-0 size-0 [translate:calc(var(--line-lit-x)*100cqw)_0]'
            >
              <span
                ref={(element) => {
                  if (!element) return
                  family.litDots.current.set(name, element)
                  return () => {
                    if (family.litDots.current.get(name) === element)
                      family.litDots.current.delete(name)
                  }
                }}
                data-key={category.key}
                data-snap={snap}
                // While the series moves, it carries the dot on `--line-lit-y`, frame by frame.
                className={cn(move, 'size-0 data-moving:transition-none')}
                style={
                  {
                    translate: `0 var(--line-lit-y, ${y * 100}cqh)`,
                    '--line-color': seriesColor(key),
                  } as CSSProperties
                }
              >
                {/* A series that steps back while another is brought forward takes its dot with it. */}
                <span
                  data-dim={
                    chart.emphasis !== null && chart.emphasis !== key ? '' : undefined
                  }
                  className={cn(
                    'bg-(--line-color) ring-background absolute -top-1 -left-1 size-2 rounded-full ring-2 transition-[background-color] duration-(--motion-layout-duration) ease-(--motion-layout-fade-easing) not-forced-colors:data-dim:bg-[oklch(from_var(--line-color)_l_calc(c*var(--trace-dim))_h)]',
                    forcedSeriesColor(chart.series.indexOf(key)),
                  )}
                />
              </span>
            </span>
          )
          return bottom === null
            ? [dot(key, top)]
            : [dot(key, top), dot(bottomDotKey(key), bottom)]
        })}
      </div>
    </div>
  )
}

/** The placeholder's line while the data loads, as fractions of the plot: a fixed, gentle rise, so it reads as a chart. */
const PLACEHOLDER_VALUES = [0.38, 0.52, 0.46, 0.64, 0.58, 0.72, 0.66] as const

/** The placeholder's points, with a baseline along the plot's bottom when it is `filled`. */
function placeholderPoints(filled = false): LinePoint[] {
  return PLACEHOLDER_VALUES.map((value, at) => ({
    key: null,
    x: at / (PLACEHOLDER_VALUES.length - 1),
    y: 1 - value,
    ...(filled ? { base: 1 } : {}),
    defined: true,
  }))
}

/**
 * The placeholder while the data loads: a soft line breathing slowly, with
 * a soft fill under it for an area, which the series grow out of when the
 * data arrives.
 */
function LinePlaceholder({ name, fill }: { name: LineFamilyName; fill: boolean }) {
  const id = useId().replaceAll(':', '')
  const points = placeholderPoints(fill)
  return (
    <div
      data-slot={`${name}-placeholder`}
      aria-hidden
      className={cn(
        plotLayerClassName,
        'z-10 transition-opacity duration-(--motion-enter-duration) ease-(--motion-enter-easing) group-data-mounted/chart:starting:opacity-0',
      )}
      style={traceVariables(name)}
    >
      <div
        className={cn(
          'text-foreground/10 dark:text-foreground/15 absolute inset-0 forced-colors:text-[GrayText]!',
          placeholderBreatheClassName,
        )}
      >
        {/* The line is already a faint tint, so its fill is drawn stronger under it. */}
        <svg
          {...unitFrame}
          className='absolute inset-0 size-full overflow-visible [--trace-fill-top:0.6] [--trace-fill-bottom:0.15]'
        >
          {fill && (
            <AreaFill
              id={`${id}-fill`}
              path={areaPathThrough(points, 'monotone', 1, 1)}
              peak={fillPeak(points)}
              height={1}
            />
          )}
          <path
            d={pathThrough(points, 'monotone', 1, 1)}
            className='fill-none stroke-current [stroke-width:var(--trace-width)] [stroke-linecap:round] [vector-effect:non-scaling-stroke]'
          />
        </svg>
      </div>
    </div>
  )
}

export {
  framePoints,
  frameRest,
  frameTop,
  LineFamilyFrame,
  type LineFamilyName,
  type LineFamilyValue,
  LineSeries,
  type LineSeriesProps,
  useLineFamily,
}
