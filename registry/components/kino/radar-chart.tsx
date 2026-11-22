'use client'

import {
  type CategoryChartInput,
  CategoryChartFrame,
  type CategoryChartProps,
  type ChartCategory,
  type ChartContextValue,
  figureProps,
  tickMove,
  useCategoryChart,
  useChart,
  useChartActive,
  useRegistry,
  useTicks,
} from '@/registry/lib/chart-core'
import {
  type ChartDatum,
  numberOf,
  type Span,
  stepThrough,
} from '@/registry/lib/chart-math'
import {
  edgeRoom,
  labelBoxAt,
  type RadialBox,
  outerPoint,
  RadialLabel,
  standsClear,
  round,
  TEXT_HEIGHT,
  tooltipSide,
  turnOf,
} from '@/registry/lib/chart-radial'
import {
  type ChartFormat,
  ChartSvgPattern,
  drawingFrame,
  drawingSize,
  forcedSeriesColor,
  forcedSeriesTextColor,
  formatterOf,
  plotLayerClassName,
  type MoveRole,
  seriesColor,
  useFromRest,
  usePointsMove,
} from '@/registry/lib/chart-root'
import { bandAt, type LinearScale, tickCountFor } from '@/registry/lib/chart-scale'
import {
  createHighlight,
  type Highlight,
  highlightClassName,
} from '@/registry/lib/highlight'
import {
  placeholderBreatheClassName,
  placeholderInkClassName,
} from '@/registry/lib/placeholder'
import { registerProperties } from '@/registry/lib/run-progress'
import {
  type ComponentProps,
  createContext,
  type CSSProperties,
  use,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'

import { cn } from '@/lib/utils'

/*
 * The Radar chart: several values of each series on axes round a centre,
 * one shape per series. The axes are the chart's categories, clockwise from
 * the top. New data moves each point along its spoke from where it is, an
 * axis that arrives grows out of the old outline and one that leaves folds
 * into the new, on one CSS transition of a number, `--radar-progress`, so
 * the feel, reduced motion and a slowed playback time it as they time
 * everything else.
 *
 * The axis under the pointer or the keys stays bright in a wedge that
 * glides round with the axis's pill, while the rest of every shape steps
 * back; a series whose outline the pointer is on, or the Up and Down arrows
 * reach, or its legend entry, comes forward whole.
 */

interface RadarChartProps extends Omit<CategoryChartProps, 'ordered'> {
  /**
   * The key of each axis's own top value in the data, for axes measured on
   * different scales, such as a price beside a score: each point is drawn as
   * its share of its axis's top, so the rings read as shares and the value
   * axis has nothing to write.
   */
  maxKey?: string
  /**
   * How the shapes arrive the first time the chart comes into view: growing
   * out of the centre, or simply there, the default, since a page that loads
   * doesn't animate into place.
   */
  entrance?: 'rise' | 'none'
}

/** A point of an outline: its axis, how far round it is, and how far out, as a fraction of the edge. */
interface RadarVertex {
  key: string
  turn: number
  r: number
}

/** Where a point of an outline moves from and to. */
interface VertexMove {
  key: string
  from: { turn: number; r: number }
  to: { turn: number; r: number }
}

/** What `RadarAxis` tells the chart: the room its names take past the edge, and each name's box. */
interface RadarNames {
  /** The axes the names are of, so a fit for other axes is never used. */
  axes: string
  room: number
  boxes: ReadonlyMap<string, { width: number; height: number }>
}

interface RadarContextValue {
  /** How far out the outer ring is, in px. */
  edge: number
  /** The plot's centre, in px. */
  centre: { x: number; y: number }
  /** Each axis's turn, by its key: the shown axes', and a leaving one's last. */
  turns: ReadonlyMap<string, number>
  /**
   * Each axis's turn as its spoke and name are turned, counting past a whole
   * turn, so when the axes reorder they turn the short way, as the outline's
   * points do.
   */
  rotations: ReadonlyMap<string, number>
  /** A series' outline over the shown axes: at the centre when `flat`. */
  outlineOf: (key: string, flat: boolean) => RadarVertex[]
  /** Where the point of `key` on `category` sits, as a fraction of the edge; null for no value. */
  fractionAt: (category: ChartCategory, key: string) => number | null
  addNames: (names: RadarNames) => () => void
  /** Each axis on a scale of its own, so the values have no shared axis. */
  ownScales: boolean
  entrance: 'rise' | 'none'
  entering: boolean
}

const RadarContext = createContext<RadarContextValue | null>(null)

function useRadar() {
  const radar = use(RadarContext)
  if (!radar) throw new Error('Radar chart parts go inside a `RadarChart`.')
  return radar
}

const radarChartKeys = ['maxKey', 'entrance']

/** The room between the edge and the axes' names, in px. */
const NAME_GAP = 8
/** The narrowest names wrap at, in px: a few words a line. */
const NARROWEST_NAME = 56

/** A name's padding inside the pill, across and down, in px. */
const NAME_PADDING = { x: 12, y: 4 } as const

/** The least room between two rings, in px. */
const RING_SPACING = 24
/** The least room between rings given as values, in px: a line of the value axis's text. */
const GIVEN_RING_SPACING = 16
const OWN_SCALE_TICKS = [0, 0.25, 0.5, 0.75, 1]

/**
 * The ticks a radius with room for `most` rings keeps: the outermost, then every
 * so many inward, evenly where a step lands on the innermost too, so rings given
 * as values thin out as `tickCount` does.
 */
function thinTicks(values: readonly number[], most: number): number[] {
  const sorted = [...values].sort((a, b) => a - b)
  const least = Math.max(1, Math.ceil(sorted.length / Math.max(1, most)))
  // A step up to twice as long that lands on the innermost value too keeps the rings even.
  const span = sorted.length - 1
  const even = Array.from({ length: least }, (_, at) => least + at).find(
    (step) => step <= span && span % step === 0,
  )
  const every = even ?? least
  return sorted.filter((_, at) => (sorted.length - 1 - at) % every === 0)
}

/** The placeholder's shape while the data loads, as fractions of the edge: six axes, uneven, so it reads as a radar. */
const PLACEHOLDER_SHAPE = [0.72, 0.5, 0.64, 0.42, 0.7, 0.48] as const

/** The placeholder's outline, which the shapes fold into while the data loads and grow back out of. */
const PLACEHOLDER_OUTLINE: readonly RadarVertex[] = PLACEHOLDER_SHAPE.map((r, at) => ({
  // Keys no axis has, so the shapes that grow out of it match none of its points.
  key: `\u0000${at}`,
  turn: at / PLACEHOLDER_SHAPE.length,
  r,
}))

const PLACEHOLDER_RINGS = [1 / 3, 2 / 3, 1]

/** The properties the chart moves on, so their transitions can run them. Once per page. */
function registerRadarProperties() {
  registerProperties([
    // Where the lit wedge points and how wide it is: the whole turn while nothing is lit.
    ...(['--radar-window-turn', '--radar-window-span'] as const).map((name) => ({
      name,
      syntax: '<angle>',
      inherits: true,
      initialValue: '0deg',
    })),
    // How much the wedge shows its bright copy: 0 while another series is brought forward.
    {
      name: '--radar-window-shown',
      syntax: '<number>',
      inherits: true,
      initialValue: '1',
    },
  ])
}

/** The lowest and highest the shown series reach, from zero: a radar's centre is zero. */
function radarExtent(rows: readonly ChartDatum[], keys: readonly string[]): Span {
  let high = 0
  for (const row of rows) {
    for (const key of keys) {
      const value = numberOf(row[key])
      if (value !== null) high = Math.max(high, value)
    }
  }
  return [0, high]
}

/**
 * The chart's root: it places each axis round the centre, fits the value
 * axis to the shapes, and lays out the frame its grid, names, shapes and
 * tooltip draw in.
 */
function RadarChart(props: RadarChartProps) {
  const {
    maxKey,
    entrance = 'none',
    tickCount = 4,
    domain,
    description,
    empty,
    className,
    children,
    ref,
  } = props
  registerRadarProperties()
  const ownScales = maxKey !== undefined
  // The rings are as many as the radius has room for, once it is measured: a ring every 24px or
  // more, or rings given as values at least a line of text apart. The value axis fits its ticks
  // to the plot's height, twice the radius.
  const [measuredEdge, setMeasuredEdge] = useState<number | null>(null)
  const rings = tickCountFor(tickCount, measuredEdge ?? 0, RING_SPACING)
  const given = ownScales ? OWN_SCALE_TICKS : props.tickValues
  const tickValues =
    given && measuredEdge !== null
      ? thinTicks(given, Math.floor(measuredEdge / GIVEN_RING_SPACING))
      : given
  const { chart, placeholder, phase } = useCategoryChart(
    {
      ...props,
      tickCount: rings,
      // On scales of their own, every axis runs from nothing to its top.
      domain: ownScales ? [0, 1] : domain,
      tickValues,
      allowDecimals: ownScales ? true : props.allowDecimals,
    },
    {
      orientation: 'vertical',
      stack: 'none',
      entrance: entrance !== 'none',
      round: true,
      nice: !ownScales,
      bandOf: bandAt,
      measure: (rows, shown) => ({
        extent: ownScales ? ([0, 1] as const) : radarExtent(rows, shown),
      }),
    },
  )
  const names = useRegistry<RadarNames>()
  const { width, height } = drawingSize(chart.plotSize)
  const measured = chart.plotSize.width > 0 && chart.plotSize.height > 0
  const turns = useAxisTurns(chart.categories, chart.current)
  const rotations = useAxisRotations(turns)
  // Until RadarAxis tells the chart its names' room, on the server and on the first paint, the
  // room is worked out here from the names as the chart writes them, so nothing jumps once it does.
  // A fit RadarAxis made for other axes, such as before the data loaded, isn't used: the names
  // land where they will stay, rather than sliding in from where the old room put them.
  const registered = names.values.at(-1)
  const named =
    registered?.axes === axesOf(chart.categories)
      ? registered
      : measured && registered === undefined
        ? undefined
        : fitNamesOn(
            namesToFit(chart, turns, chart.categoryText),
            chart.plotSize,
            chart.textWidth(' '),
          )
  const edge = Math.max(0, Math.min(width, height) / 2 - 0.5 - (named?.room ?? 0))
  const centre = { x: width / 2, y: height / 2 }
  useLayoutEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the rings fit the radius the axis names leave, measured once the chart is laid out, before it paints
    if (measured) setMeasuredEdge(Math.round(edge))
  }, [measured, edge])
  const shown = chart.series.filter((key) => !chart.hidden.includes(key))

  const fractionAt = (category: ChartCategory, key: string) => {
    const value = numberOf(category.datum[key])
    if (value === null) return null
    if (!ownScales) return chart.frame.y.value.scale.place(value)
    const top = numberOf(category.datum[maxKey])
    return top === null || top <= 0 ? 0 : Math.min(1, Math.max(0, value / top))
  }
  const outlineOf = (key: string, flat: boolean): RadarVertex[] =>
    chart.current.map((category) => ({
      key: category.key,
      turn: turns.get(category.key) ?? 0,
      r: flat ? 0 : (fractionAt(category, key) ?? 0),
    }))

  const full: CategoryChartInput = {
    ...chart,
    // The tooltip sits past the axis's name, so it covers neither the name nor the shapes.
    pointOf: (at) => {
      const category = chart.current[at]
      if (!category || width === 0 || height === 0) return null
      const turn = turns.get(category.key) ?? 0
      const box = named?.boxes.get(category.key)
      if (!box) return outerPoint(turn, width, height, edge)
      const { left, right, top, bottom } = labelBoxAt(
        turn,
        edge + NAME_GAP,
        box.width,
        box.height,
      )
      const side = nameSide(turn)
      const x = side === 'left' ? left : side === 'right' ? right : (left + right) / 2
      const y = side === 'top' ? top : side === 'bottom' ? bottom : (top + bottom) / 2
      return { x: (centre.x + x) / width, y: (centre.y + y) / height, side }
    },
    pickAt: (point, box) => {
      const x = point.x - box.left - box.width / 2
      const y = point.y - box.top - box.height / 2
      // On an axis's name, which the pill shows there, that axis, wherever round the plot it is.
      const onName = chart.current.findIndex((category) => {
        const size = named?.boxes.get(category.key)
        if (!size) return false
        const name = labelBoxAt(
          turns.get(category.key) ?? 0,
          edge + NAME_GAP,
          size.width,
          size.height,
        )
        return x >= name.left && x <= name.right && y >= name.top && y <= name.bottom
      })
      if (onName !== -1) return onName
      if (Math.hypot(x, y) > Math.min(box.width, box.height) / 2 + NAME_GAP) return null
      return axisAt(turnOf(x, y), chart.current.length)
    },
    // With one series shown there is none to bring forward, so the lit axis's wedge stays.
    stepSeries: (at, from, step) => {
      const category = chart.current[at]
      if (!category || shown.length < 2) return null
      return stepOutward(
        shown.map((key) => ({ key, value: fractionAt(category, key) })),
        from,
        step,
      )
    },
    // On scales of their own, each value is written against its axis's top, as the shape draws it.
    seriesText: (category, key) => {
      const value = numberOf(category.datum[key])
      const top = ownScales ? numberOf(category.datum[maxKey]) : null
      return value === null || top === null
        ? chart.datumText(category.datum[key])
        : chart.messages.outOf(chart.valueText(value), chart.valueText(top))
    },
    // The series brought forward alone, so Up and Down are heard to move.
    describe: (at) => {
      const category = chart.current[at]
      if (!category) return ''
      const keys =
        chart.emphasis !== null && shown.includes(chart.emphasis)
          ? [chart.emphasis]
          : shown
      return keys
        .map((key) => {
          const name = chart.config[key]?.label
          return `${typeof name === 'string' ? name : key} ${full.seriesText(category, key)}`
        })
        .join(', ')
    },
  }

  return (
    <RadarContext
      value={{
        edge,
        centre,
        turns,
        rotations,
        outlineOf,
        fractionAt,
        addNames: names.add,
        ownScales,
        entrance,
        entering: phase === 'entering',
      }}
    >
      <CategoryChartFrame
        chart={full}
        ref={ref}
        slot='radar-chart'
        description={description}
        empty={empty}
        className={className}
        placeholder={placeholder && <RadarPlaceholder />}
        {...figureProps(props, radarChartKeys)}
      >
        {children}
        <RadarLitMarks />
      </CategoryChartFrame>
    </RadarContext>
  )
}

/**
 * Each axis's turn, by its key: the shown axes evenly round from the top,
 * and an axis that leaves keeps the turn it had, so it fades where it was.
 */
function useAxisTurns(
  categories: readonly ChartCategory[],
  current: readonly ChartCategory[],
): ReadonlyMap<string, number> {
  const signature = current.map((category) => category.key).join('\u0000')
  const now = new Map(
    current.map((category, at) => [category.key, at / current.length] as const),
  )
  const [kept, setKept] = useState({ signature, turns: now })
  if (kept.signature !== signature)
    setKept({ signature, turns: new Map([...kept.turns, ...now]) })
  const turns = new Map(now)
  for (const category of categories) {
    if (turns.has(category.key)) continue
    const last = kept.turns.get(category.key)
    if (last !== undefined) turns.set(category.key, last)
  }
  return turns
}

/** Each axis's `turns`, counted on from the turn it was last drawn at, so it turns the short way. */
function useAxisRotations(
  turns: ReadonlyMap<string, number>,
): ReadonlyMap<string, number> {
  const [kept, setKept] = useState<ReadonlyMap<string, number>>(turns)
  const next = new Map(
    [...turns].map(([key, turn]) => {
      const was = kept.get(key)
      if (was === undefined) return [key, turn] as const
      const near = nearestTurn(was, turn)
      // The same axis where it was stays exactly as kept, so a rounding error never renders again.
      return [key, Math.abs(near - was) < 1e-9 ? was : near] as const
    }),
  )
  const changed =
    next.size !== kept.size || [...next].some(([key, turn]) => kept.get(key) !== turn)
  if (changed) setKept(next)
  return next
}

/**
 * Where the lit axis points, in turns that keep counting past a whole turn,
 * so the wedge, the dots and the spoke glide the short way round from the
 * last axis to the first. Kept where it was while nothing is lit.
 */
function useLitTurn() {
  const chart = useChart()
  const radar = useRadar()
  const { spotlit } = useChartActive()
  const key = spotlit === null ? undefined : chart.current[spotlit]?.key
  const target = key === undefined ? undefined : radar.turns.get(key)
  const [turn, setTurn] = useState(target ?? 0)
  const next = target === undefined ? turn : nearestTurn(turn, target)
  if (next !== turn) setTurn(next)
  return { lit: target !== undefined, turn: next }
}

/**
 * Moves an outline to `to` whenever it changes, from wherever it is, on the
 * frames of `--radar-progress` on `element`, calling `draw` with each
 * frame's outline. A new size alone redraws at once.
 */
function useOutlineMove(
  role: MoveRole,
  draw: (outline: readonly RadarVertex[]) => void,
  to: readonly RadarVertex[],
  start: readonly RadarVertex[],
  size: string,
) {
  usePointsMove(
    role,
    to,
    to
      .map((vertex) => `${vertex.key}:${vertex.turn.toFixed(5)}:${vertex.r.toFixed(5)}`)
      .join('|'),
    start,
    size,
    { align: alignOutlines, at: outlineAt, draw },
  )
}

interface RadarProps extends Omit<ComponentProps<'div'>, 'children' | 'color'> {
  /** The key of this series' values in the data, and of its entry in the config. */
  dataKey: string
  /** Fills the shape with a light wash of the series' colour; off draws only its outline. */
  fill?: boolean
  /** Marks each point with a dot, not only those on the lit axis. */
  dots?: boolean
  /** Draws the outline dashed, such as a target or last year's shape. */
  dashed?: boolean
}

/**
 * One series' shape, in its colour: a light fill and an outline through its
 * value on each axis, and a dot on each point with `dots`. While an axis is
 * lit, the shape steps back but for a wedge round that axis, which glides
 * round with the axis's pill.
 */
function Radar({
  dataKey,
  fill = true,
  dots = false,
  dashed = false,
  className,
  style,
  ...props
}: RadarProps) {
  const chart = useChart()
  const radar = useRadar()
  const { spotlit } = useChartActive()
  const lit = useLitTurn()
  const spot = useRef<HTMLDivElement>(null)
  const fromRest = useFromRest(spotlit)
  const id = useId().replaceAll(':', '')
  const hidden = chart.hidden.includes(dataKey)
  const rising = !chart.entered && radar.entrance === 'rise'
  // While the chart loads, the shape folds into the placeholder's and fades, and grows back
  // out of it when the data arrives.
  const loading = chart.status === 'loading'
  const drawn = chart.status === 'ready' || chart.status === 'hidden' || loading
  const to = loading
    ? PLACEHOLDER_OUTLINE
    : drawn
      ? radar.outlineOf(dataKey, rising || hidden)
      : []
  const start = to.map((vertex) => ({ ...vertex, r: 0 }))
  const outlines = useRef<(SVGPathElement | null)[]>([])
  const marks = useRef<(SVGGElement | null)[]>([])
  const { edge, centre } = radar
  useOutlineMove(
    // The entrance grows the outline out of the centre; every change after moves it.
    radar.entering ? 'draw' : 'layout',
    (outline) => {
      const d = outlinePath(outline, centre.x, centre.y, edge)
      for (const path of outlines.current) path?.setAttribute('d', d)
      for (const group of marks.current) {
        if (!group) continue
        for (const dot of group.querySelectorAll<SVGCircleElement>('[data-key]')) {
          const vertex = outline.find((point) => point.key === dot.dataset.key)
          if (!vertex) continue
          const [x, y] = pointOf(vertex, centre.x, centre.y, edge)
          dot.setAttribute('cx', String(round(x)))
          dot.setAttribute('cy', String(round(y)))
        }
      }
    },
    to,
    start,
    `${round(edge)}:${round(centre.x)}:${round(centre.y)}`,
  )
  if (!drawn) return null
  const slot = chart.series.indexOf(dataKey)
  const pattern = chart.patternOf(dataKey)
  const emphasised = chart.emphasis === dataKey
  const otherEmphasised = chart.emphasis !== null && !emphasised
  // The shape steps back while an axis is lit, all but its bright wedge, or whole while another
  // series is brought forward. Brought forward itself, it stays bright all round.
  const windowAt = emphasised ? null : spotlit
  const stepsBack = windowAt !== null || otherEmphasised
  const count = Math.max(1, chart.current.length)
  const { width, height } = drawingSize(chart.plotSize)
  const frame = drawingFrame(chart.plotSize, 'xMidYMid meet')
  const viewBox = `0 0 ${round(width)} ${round(height)}`
  const d = outlinePath(to, centre.x, centre.y, edge)
  const points = chart.status === 'ready' && !hidden && dots ? chart.current : []

  const shape = (copy: 'stepped' | 'bright', part: 'fill' | 'outline') => {
    const at = (copy === 'bright' ? 1 : 0) + (part === 'fill' ? 2 : 0)
    const patternId = `${id}-${copy}-pattern`
    if (part === 'fill') {
      return (
        <>
          {pattern !== 'solid' && <ChartSvgPattern id={patternId} pattern={pattern} />}
          <path
            ref={(element) => {
              outlines.current[at] = element
            }}
            d={d}
            className='stroke-none [fill-opacity:var(--radar-chart-fill,0.24)]'
            style={{
              fill: pattern === 'solid' ? 'currentColor' : `url(#${patternId})`,
            }}
          />
        </>
      )
    }
    return (
      <>
        <path
          ref={(element) => {
            outlines.current[at] = element
          }}
          d={d}
          className={cn(
            'fill-none stroke-current [stroke-width:var(--radar-chart-width,2px)] [stroke-linejoin:round] [vector-effect:non-scaling-stroke]',
            dashed && '[stroke-dasharray:6_5]',
          )}
        />
        {points.length > 0 && (
          <g
            ref={(element) => {
              marks.current[copy === 'bright' ? 1 : 0] = element
            }}
          >
            {points.map((category) => {
              const r = radar.fractionAt(category, dataKey)
              if (r === null) return null
              const [x, y] = pointOf(
                {
                  key: category.key,
                  turn: radar.turns.get(category.key) ?? 0,
                  r,
                },
                centre.x,
                centre.y,
                edge,
              )
              return (
                <circle
                  key={category.key}
                  data-key={category.key}
                  cx={round(x)}
                  cy={round(y)}
                  r={3}
                  className='fill-background stroke-current [stroke-width:2px] [vector-effect:non-scaling-stroke]'
                />
              )
            })}
          </g>
        )}
      </>
    )
  }

  const svgClass = 'absolute inset-0 size-full overflow-visible'
  const dimClass =
    'not-forced-colors:data-dim:text-[oklch(from_var(--radar-color)_l_calc(c*var(--radar-chart-dim,0.3))_h)]'
  return (
    <div
      data-slot='radar-chart-series'
      data-series={dataKey}
      data-hidden={hidden || loading ? '' : undefined}
      data-forward={emphasised ? '' : undefined}
      aria-hidden
      className={cn(
        plotLayerClassName,
        // The series brought forward paints over the rest, under the lit marks' z-20.
        'z-10 data-forward:z-15 transition-opacity duration-(--motion-layout-duration) ease-(--motion-layout-easing) data-hidden:opacity-0',
        className,
      )}
      style={
        {
          '--radar-color': seriesColor(dataKey),
          '--radar-fade': 'var(--radar-chart-window-fade, 6deg)',
          ...style,
        } as CSSProperties
      }
      {...props}
    >
      {/* The wedge round the lit axis, which the fill and the bright copy of the outline share,
          so they glide as one, and how much it shows, which fades both ways. */}
      <div
        ref={spot}
        data-snap={fromRest ? '' : undefined}
        // Opening as the pointer leaves, it leaves on `exit`, as the dots and the pill do, so all
        // that marks the axis comes to rest together.
        data-leaving={windowAt === null ? '' : undefined}
        className='absolute inset-0 transition-[--radar-window-turn,--radar-window-span,--radar-window-shown] duration-(--motion-layout-duration) ease-(--motion-layout-easing) data-leaving:duration-(--motion-exit-duration) data-leaving:ease-(--motion-exit-easing) data-snap:transition-[--radar-window-shown] motion-reduce:transition-[--radar-window-shown]'
        style={
          {
            '--radar-window-turn': `${round(lit.turn * 360)}deg`,
            // Nothing lit, the wedge opens past a whole turn, so the whole shape is bright.
            '--radar-window-span':
              windowAt === null
                ? 'calc(360deg + 2 * var(--radar-fade))'
                : `${round(360 / count)}deg`,
            '--radar-window-shown': otherEmphasised ? 0 : 1,
          } as CSSProperties
        }
      >
        {/* The fill, stepped back, seen everywhere but through the wedge, so the bright copy's
            fill there never lies over it. With another series brought forward, it is whole. */}
        {fill && (
          <div className='absolute inset-0 [mask-image:conic-gradient(from_calc(var(--radar-window-turn)-var(--radar-window-span)/2),black,rgb(0_0_0/calc(1-var(--radar-window-shown)))_var(--radar-fade),rgb(0_0_0/calc(1-var(--radar-window-shown)))_calc(var(--radar-window-span)-var(--radar-fade)),black_var(--radar-window-span))]'>
            <svg
              viewBox={viewBox}
              {...frame}
              data-dim={stepsBack ? '' : undefined}
              // A wash steps back in strength as well as colour, or it reads as strong as the lit one.
              className={cn(
                svgClass,
                'text-(--radar-color) transition-[color,opacity] duration-(--motion-layout-duration) ease-(--motion-layout-fade-easing) data-dim:opacity-60',
                dimClass,
                forcedSeriesTextColor(slot),
              )}
            >
              {shape('stepped', 'fill')}
            </svg>
          </div>
        )}
        <svg
          viewBox={viewBox}
          {...frame}
          data-entering={radar.entering ? '' : undefined}
          data-dim={stepsBack ? '' : undefined}
          className={cn(
            svgClass,
            'text-(--radar-color) transition-[color] duration-(--motion-layout-duration) ease-(--motion-layout-fade-easing) forced-colors:data-dim:[--radar-chart-width:1px] data-entering:duration-(--motion-draw-duration) data-entering:ease-(--motion-draw-fade-easing)',
            dimClass,
            forcedSeriesTextColor(slot),
          )}
        >
          {shape('stepped', 'outline')}
        </svg>
        {/* The shape again in its own colour, seen only through the wedge round the lit axis,
            while the rest of it steps back. */}
        <div
          className={cn(
            forcedSeriesTextColor(slot),
            'absolute inset-0 text-(--radar-color) [mask-image:conic-gradient(from_calc(var(--radar-window-turn)-var(--radar-window-span)/2),transparent,black_var(--radar-fade),black_calc(var(--radar-window-span)-var(--radar-fade)),transparent_var(--radar-window-span))] opacity-(--radar-window-shown)',
          )}
        >
          <svg viewBox={viewBox} {...frame} className={svgClass}>
            {fill && shape('bright', 'fill')}
            {shape('bright', 'outline')}
          </svg>
        </div>
      </div>
    </div>
  )
}

/**
 * What marks the lit axis: a dot on each shown series where it crosses the
 * axis. They turn round the centre from axis to axis with the wedge, appear
 * in place after a rest, and fade where they are when the pointer leaves.
 */
function RadarLitMarks() {
  const chart = useChart()
  const radar = useRadar()
  const { spotlit } = useChartActive()
  const lit = useLitTurn()
  const layer = useRef<HTMLDivElement>(null)
  const fromRest = useFromRest(spotlit)
  // The axis last lit, where the dots stay while they fade out.
  const [last, setLast] = useState(spotlit)
  if (spotlit !== null && spotlit !== last) setLast(spotlit)
  const shownAt = spotlit ?? last
  const category = shownAt === null ? undefined : chart.current[shownAt]
  if (chart.status !== 'ready' || !category || !chart.entered) return null
  const shown = chart.series.filter((key) => !chart.hidden.includes(key))
  const snap = fromRest ? '' : undefined
  return (
    <div
      ref={layer}
      aria-hidden
      data-slot='radar-chart-lit'
      data-hidden={spotlit === null ? '' : undefined}
      className={cn(
        plotLayerClassName,
        'z-20 transition-opacity duration-(--motion-enter-duration) ease-(--motion-enter-easing) data-hidden:opacity-0 data-hidden:duration-(--motion-exit-duration) data-hidden:ease-(--motion-exit-easing)',
      )}
    >
      {shown.map((key) => {
        const r = radar.fractionAt(category, key)
        if (r === null) return null
        return (
          <span
            key={key}
            data-snap={snap}
            // Turned round the centre and out along the axis in one transform, so a glide to the
            // next axis turns round the centre rather than cutting across the shape.
            className='absolute top-1/2 left-1/2 size-0 [transform:rotate(var(--dot-turn))_translateY(var(--dot-out))] transition-none duration-(--motion-layout-duration) ease-(--motion-layout-easing) group-data-mounted/chart:transition-[transform] data-snap:group-data-mounted/chart:transition-none motion-reduce:group-data-mounted/chart:transition-none'
            style={
              {
                '--dot-turn': `${round(lit.turn * 360)}deg`,
                '--dot-out': `${-round(r * radar.edge)}px`,
                '--radar-color': seriesColor(key),
              } as CSSProperties
            }
          >
            {/* A series that steps back while another is brought forward takes its dot with it. */}
            <span
              data-dim={
                chart.emphasis !== null && chart.emphasis !== key ? '' : undefined
              }
              className={cn(
                'ring-background absolute -top-1 -left-1 size-2 rounded-full bg-(--radar-color) ring-2 transition-[background-color] duration-(--motion-layout-duration) ease-(--motion-layout-fade-easing) not-forced-colors:data-dim:bg-[oklch(from_var(--radar-color)_l_calc(c*var(--radar-chart-dim,0.3))_h)]',
                forcedSeriesColor(chart.series.indexOf(key)),
              )}
            />
          </span>
        )
      })}
    </div>
  )
}

/**
 * The grid: a ring at each of the value axis's ticks, as the axes'
 * polygon or as circles, and a spoke out to each axis. Rings grow and
 * shrink to their new place when the range changes, spokes turn to their
 * axis's new place when axes come and go, and the lit axis's spoke stands
 * out, turning with the wedge.
 */
function RadarGrid({
  shape = 'polygon',
  spokes = true,
  className,
  ...props
}: Omit<ComponentProps<'div'>, 'children'> & {
  /** The rings' shape: the axes' polygon, or circles. */
  shape?: 'polygon' | 'circle'
  /** Draws a spoke from the centre out to each axis. */
  spokes?: boolean
}) {
  const chart = useChart()
  const radar = useRadar()
  const { spotlit } = useChartActive()
  const lit = useLitTurn()
  const layer = useRef<HTMLDivElement>(null)
  const litSpoke = useRef<SVGLineElement>(null)
  const fromRest = useFromRest(spotlit)
  const ticks = useTicks()
  const framePath = useRef<SVGPathElement>(null)
  const id = useId().replaceAll(':', '')
  const { edge, centre } = radar
  const ready = chart.status === 'ready' || chart.status === 'hidden'
  const polygon = shape === 'polygon' && ready
  const outline = polygon
    ? chart.current.map((category) => ({
        key: category.key,
        turn: radar.turns.get(category.key) ?? 0,
        r: 1,
      }))
    : []
  useOutlineMove(
    'layout',
    (now) =>
      framePath.current?.setAttribute('d', outlinePath(now, centre.x, centre.y, edge)),
    outline,
    outline,
    `${round(edge)}:${round(centre.x)}:${round(centre.y)}`,
  )
  const { width, height } = drawingSize(chart.plotSize)
  const { scale, previous: previousScale } = chart.frame.y.value
  const line =
    'fill-none stroke-border [stroke-dasharray:3_3] [stroke-width:1px] [vector-effect:non-scaling-stroke] forced-colors:stroke-[GrayText]'
  const turning =
    'transition-none duration-(--motion-layout-duration) ease-[var(--motion-layout-easing),var(--motion-layout-fade-easing)] group-data-mounted/chart:transition-[transform,opacity] group-data-mounted/chart:starting:opacity-0 data-leaving:opacity-0 motion-reduce:group-data-mounted/chart:transition-[opacity]'
  return (
    <div
      ref={layer}
      data-slot='radar-chart-grid'
      aria-hidden
      className={cn(plotLayerClassName, 'z-0', className)}
      {...props}
    >
      {ready && (
        <svg
          viewBox={`0 0 ${round(width)} ${round(height)}`}
          {...drawingFrame(chart.plotSize, 'xMidYMid meet')}
          className='absolute inset-0 size-full overflow-visible'
        >
          {polygon && (
            <defs>
              <path
                ref={framePath}
                id={`${id}-frame`}
                d={outlinePath(outline, centre.x, centre.y, edge)}
              />
            </defs>
          )}
          {ticks.map(({ value: tick, leaving }) => {
            const place = scale.place(tick)
            if (place <= 0 && !leaving) return null
            const ring = {
              'data-leaving': leaving ? '' : undefined,
              className: cn(line, '[transform:scale(var(--ring-to))]', tickTurn),
              style: {
                transformOrigin: `${round(centre.x)}px ${round(centre.y)}px`,
                '--ring-to': round(place * 1e4) / 1e4,
                '--ring-from': round(previousScale.place(tick) * 1e4) / 1e4,
              } as CSSProperties,
            }
            return polygon ? (
              <use key={tick} href={`#${id}-frame`} {...ring} />
            ) : (
              <circle
                key={tick}
                cx={round(centre.x)}
                cy={round(centre.y)}
                r={round(edge)}
                {...ring}
              />
            )
          })}
          {spokes &&
            chart.categories.map((category) => (
              <line
                key={category.key}
                data-leaving={category.leaving ? '' : undefined}
                x1={round(centre.x)}
                y1={round(centre.y)}
                x2={round(centre.x)}
                y2={round(centre.y - edge)}
                className={cn(line, '[transform:rotate(var(--spoke-turn))]', turning)}
                style={
                  {
                    transformOrigin: `${round(centre.x)}px ${round(centre.y)}px`,
                    '--spoke-turn': `${round((radar.rotations.get(category.key) ?? 0) * 360)}deg`,
                  } as CSSProperties
                }
              />
            ))}
          {/* The lit axis's spoke, turning with the wedge. */}
          <line
            ref={litSpoke}
            data-snap={fromRest ? '' : undefined}
            data-hidden={spotlit === null ? '' : undefined}
            x1={round(centre.x)}
            y1={round(centre.y)}
            x2={round(centre.x)}
            y2={round(centre.y - edge)}
            className='stroke-muted-foreground/60 [stroke-width:1px] [transform:rotate(var(--spoke-turn))] [vector-effect:non-scaling-stroke] transition-[transform,opacity] duration-(--motion-layout-duration) ease-[var(--motion-layout-easing),var(--motion-layout-fade-easing)] data-hidden:opacity-0 data-hidden:duration-(--motion-exit-duration) data-hidden:ease-[var(--motion-exit-easing),var(--motion-exit-fade-easing)] data-snap:transition-[opacity] motion-reduce:transition-[opacity] forced-colors:stroke-[CanvasText]'
            style={
              {
                transformOrigin: `${round(centre.x)}px ${round(centre.y)}px`,
                '--spoke-turn': `${round(lit.turn * 360)}deg`,
              } as CSSProperties
            }
          />
        </svg>
      )}
    </div>
  )
}

/** A ring growing to its tick's new place, and in from where the old range put it. */
const tickTurn =
  'transition-none duration-(--motion-layout-duration) ease-[var(--motion-layout-easing),var(--motion-layout-fade-easing)] group-data-mounted/chart:transition-[transform,opacity] group-data-mounted/chart:starting:[transform:scale(var(--ring-from))] group-data-mounted/chart:starting:opacity-0 data-leaving:opacity-0 motion-reduce:group-data-mounted/chart:transition-[opacity]'

/**
 * Each axis's name, outside the outer ring at its turn, against it and
 * upright, wrapping when it is long, with room kept for it inside the
 * chart's own box. The name of the axis lit sits in the pill, which slides
 * from name to name as the axis lit changes.
 */
function RadarAxis({
  categoryFormat,
  className,
  ...props
}: Omit<ComponentProps<'div'>, 'children'> & {
  /** How each axis is named; the chart's `categoryFormat` by default. */
  categoryFormat?: (value: unknown) => string
}) {
  const chart = useChart()
  const radar = useRadar()
  const { spotlit } = useChartActive()
  const { addNames } = radar
  const pill = useRef<HTMLSpanElement>(null)
  const names = useRef(new Map<string, HTMLElement>())
  const write = categoryFormat ?? chart.categoryText
  const measured = chart.plotSize.width > 0 && chart.plotSize.height > 0
  const { width, height } = drawingSize(chart.plotSize)
  // Long names wrap, narrower until neighbours stop meeting, and the grid makes room for them.
  const { boxes, room, hidden } = fitNamesOn(
    namesToFit(chart, radar.turns, write),
    chart.plotSize,
    chart.textWidth(' '),
  )
  const signature = [...boxes]
    .map(([key, box]) => `${key}:${box.width}:${box.height}`)
    .join('|')
  useLayoutEffect(
    () => addNames({ axes: axesOf(chart.categories), room, boxes }),
    // The boxes are compared by their signature.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [addNames, room, signature, axesOf(chart.categories)],
  )
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
    const key = spotlit === null ? undefined : chart.current[spotlit]?.key
    const item = key === undefined ? null : (names.current.get(key) ?? null)
    // An axis lit as the chart first paints, such as a pick, has the pill there at once.
    if (item && !item.closest('[data-mounted]')) highlight.current?.jump(item)
    else highlight.current?.move(item)
  }, [spotlit, chart, radar.edge])
  const ready = chart.status === 'ready'
  // Before the plot is measured, the names sit round the stand-in the chart is drawn in.
  const stretch = measured ? null : 1 / Math.min(width, height)

  // The names, drawn twice: once round the chart, and once in the pill's colours inside the pill,
  // which shows only the part under it, so the name it slides onto reads in its colours.
  const layer = (copy: boolean) => (
    <span className='absolute inset-0 [container-type:size]'>
      {ready &&
        chart.categories.map((category) => {
          const turn = radar.rotations.get(category.key) ?? 0
          const box = boxes.get(category.key)
          const sin = Math.sin(turn * Math.PI * 2)
          return (
            <RadialLabel
              key={category.key}
              ref={
                copy
                  ? undefined
                  : (element) => {
                      if (!element || category.leaving) return
                      names.current.set(category.key, element)
                      return () => {
                        if (names.current.get(category.key) === element)
                          names.current.delete(category.key)
                      }
                    }
              }
              turn={turn}
              radius={radar.edge + NAME_GAP}
              stretch={stretch}
              // A name with no room shows only in the pill, which is above the rest.
              shown={!category.leaving && (copy || !hidden.has(category.key))}
              dir='auto'
              className='rounded-(--control-radius-xs) px-1.5 py-0.5 text-balance'
              style={{
                width: box?.width,
                // Each side reads from the chart outward, so wrapped lines hug the grid.
                textAlign: Math.abs(sin) < 0.2 ? 'center' : sin > 0 ? 'left' : 'right',
              }}
            >
              {write(category.value)}
            </RadialLabel>
          )
        })}
    </span>
  )
  return (
    <div
      data-slot='radar-chart-axis'
      aria-hidden
      className={cn(plotLayerClassName, 'text-muted-foreground z-20', className)}
      {...props}
    >
      {layer(false)}
      <span
        ref={pill}
        data-slot='radar-chart-pill'
        className={cn(
          highlightClassName,
          'bg-foreground text-background z-10 forced-colors:bg-[Highlight] forced-colors:text-[HighlightText] forced-colors:forced-color-adjust-none',
        )}
      >
        {layer(true)}
      </span>
    </div>
  )
}

/**
 * The value axis: each ring's value up the top spoke, sliding to its ring's
 * new place when the range changes. Axes on scales of their own share no
 * values, so it writes nothing then.
 */
function RadarValueAxis({
  format,
  className,
  ...props
}: Omit<ComponentProps<'div'>, 'children'> & {
  /** How the values are written; the chart's `format`, shortened, by default. */
  format?: ChartFormat
}) {
  const chart = useChart()
  const radar = useRadar()
  const layer = useRef<HTMLDivElement>(null)
  const all = useTicks()
  const own = chart.format
  const write = formatterOf(
    chart.locale,
    format ??
      (typeof own === 'function'
        ? own
        : { maximumFractionDigits: 1, ...own, notation: 'compact' }),
  )
  if (radar.ownScales) return null
  const ticks = chart.status === 'ready' ? all : []
  const { edge, centre } = radar
  const { width, height } = drawingSize(chart.plotSize)
  const place = (tick: number, scale: LinearScale) =>
    `0.25rem calc(${round(centre.y - scale.place(tick) * edge)} / ${round(height)} * 100cqh - 50%)`
  return (
    <div
      ref={layer}
      data-slot='radar-chart-value-axis'
      aria-hidden
      className={cn(plotLayerClassName, 'text-foreground z-20 tabular-nums', className)}
      {...props}
    >
      {ticks.map(({ value: tick, leaving }) =>
        chart.frame.y.value.scale.place(tick) <= 0 && !leaving ? null : (
          <span
            key={tick}
            data-leaving={leaving ? '' : undefined}
            // A halo of the page's colour keeps each value legible over the shapes.
            className={cn(
              tickMove,
              'absolute top-0 whitespace-nowrap [text-shadow:0_0_2px_var(--background),0_0_4px_var(--background)]',
            )}
            style={
              {
                left: `${round((centre.x / width) * 100)}%`,
                '--tick-to': place(tick, chart.frame.y.value.scale),
                '--tick-from': place(tick, chart.frame.y.value.previous),
              } as CSSProperties
            }
          >
            {write(tick)}
          </span>
        ),
      )}
    </div>
  )
}

/**
 * The placeholder while the data loads: rings and a soft shape breathing
 * slowly, which the shapes grow out of when the data arrives.
 */
function RadarPlaceholder() {
  const chart = useChart()
  const radar = useRadar()
  const { width, height } = drawingSize(chart.plotSize)
  const { edge, centre } = radar
  return (
    <div
      data-slot='radar-chart-placeholder'
      aria-hidden
      className={cn(
        plotLayerClassName,
        'z-10 transition-opacity duration-(--motion-enter-duration) ease-(--motion-enter-easing) group-data-mounted/chart:starting:opacity-0',
      )}
    >
      <div
        className={cn(
          'absolute inset-0',
          placeholderInkClassName,
          placeholderBreatheClassName,
        )}
      >
        <svg
          viewBox={`0 0 ${round(width)} ${round(height)}`}
          {...drawingFrame(chart.plotSize, 'xMidYMid meet')}
          className='absolute inset-0 size-full overflow-visible'
        >
          {/* A radar's frame, its rings and spokes, under a shape still to come. */}
          <g className='fill-none stroke-current' strokeWidth={1}>
            {PLACEHOLDER_RINGS.map((r) => (
              <path
                key={r}
                d={outlinePath(
                  PLACEHOLDER_OUTLINE.map((vertex) => ({ ...vertex, r })),
                  centre.x,
                  centre.y,
                  edge,
                )}
              />
            ))}
            {PLACEHOLDER_OUTLINE.map((vertex) => {
              const [x, y] = pointOf({ ...vertex, r: 1 }, centre.x, centre.y, edge)
              return (
                <line
                  key={vertex.key}
                  x1={centre.x}
                  y1={centre.y}
                  x2={round(x)}
                  y2={round(y)}
                />
              )
            })}
          </g>
          <path
            d={outlinePath(PLACEHOLDER_OUTLINE, centre.x, centre.y, edge)}
            className='fill-current stroke-none'
          />
        </svg>
      </div>
    </div>
  )
}

/** The axes the chart names, as a key. */
function axesOf(categories: readonly ChartCategory[]) {
  return categories
    .filter((category) => !category.leaving)
    .map((category) => category.key)
    .join('\u0000')
}

/** About a radar's plot, in px, to fit its names against before the plot is measured. */
const TYPICAL_PLOT = 320

/**
 * `fitNames` on a plot `size` px. Before it is measured, the names, in px,
 * fit round a plot of a typical size, and their room scales to the
 * stand-in the chart is drawn in, which then stretches to the plot.
 */
function fitNamesOn(
  names: readonly NameToFit[],
  size: { width: number; height: number },
  space: number,
) {
  if (size.width > 0 && size.height > 0)
    return fitNames(names, size.width, size.height, space)
  const fitted = fitNames(names, TYPICAL_PLOT, TYPICAL_PLOT, space)
  const drawn = drawingSize(size)
  return {
    ...fitted,
    room: (fitted.room * Math.min(drawn.width, drawn.height)) / TYPICAL_PLOT,
  }
}

/** The chart's axes' names to fit round it, written by `write`. */
function namesToFit(
  chart: Pick<ChartContextValue, 'categories' | 'textWidth'>,
  turns: ReadonlyMap<string, number>,
  write: (value: unknown) => string,
): NameToFit[] {
  return chart.categories.map((category) => ({
    key: category.key,
    turn: turns.get(category.key) ?? 0,
    words: write(category.value)
      .split(/\s+/)
      .filter(Boolean)
      .map((word) => chart.textWidth(word)),
    shown: !category.leaving,
  }))
}

/** An axis's name to fit round the chart: where it is, and how wide its words are, in px. */
interface NameToFit {
  key: string
  turn: number
  /** Each word's width on one line, in px. */
  words: readonly number[]
  /** Still in the data; a leaving name takes no room. */
  shown: boolean
}

/**
 * Each name's box, the room the names take past the edge, and which names
 * show, in a plot `width` by `height` px. A name wraps at about a quarter
 * of the plot's width; where two names would still meet, every name wraps
 * narrower, down to a few words a line. Names that meet even then make way
 * for the ones before them, as the Donut's labels do: the pill still shows
 * the lit axis's name in full.
 */
function fitNames(
  names: readonly NameToFit[],
  width: number,
  height: number,
  space: number,
) {
  const widest = Math.max(72, Math.min(160, width * 0.28))
  const shown = names.filter((name) => name.shown).toSorted((a, b) => a.turn - b.turn)
  let fitted = boxesAt(names, widest, width, height, space)
  for (
    let most = widest - 8;
    most >= NARROWEST_NAME && placedClear(shown, fitted, width, height).includes(false);
    most -= 8
  ) {
    fitted = boxesAt(names, most, width, height, space)
  }
  const clear = placedClear(shown, fitted, width, height)
  const hidden = new Set(shown.filter((_, at) => !clear[at]).map((name) => name.key))
  return { ...fitted, hidden }
}

/** How many lines words `words` px wide take, wrapped at spaces `space` px wide to `most` px, and the widest line. */
function wrapWords(words: readonly number[], space: number, most: number) {
  let lines = 0
  let line = 0
  let widest = 0
  for (const word of words) {
    if (lines > 0 && line + space + word <= most) line += space + word
    else {
      lines += 1
      line = word
    }
    widest = Math.max(widest, line)
  }
  return { lines: Math.max(1, lines), widest }
}

/** The names' boxes when they wrap at `most` px, and the room they take. */
function boxesAt(
  names: readonly NameToFit[],
  most: number,
  width: number,
  height: number,
  space: number,
) {
  const boxes = new Map(
    names.map((name) => {
      // The box's padding is outside the text's width.
      const { lines, widest } = wrapWords(name.words, space, most - NAME_PADDING.x)
      return [
        name.key,
        {
          // A pixel to spare, so the page's text never wraps where the measure didn't.
          width: Math.ceil(widest) + 1 + NAME_PADDING.x,
          height: lines * TEXT_HEIGHT + NAME_PADDING.y,
        },
      ] as const
    }),
  )
  const room = edgeRoom(
    width,
    height,
    names
      .filter((name) => name.shown)
      .map((name) => ({ turn: name.turn, ...boxes.get(name.key)! })),
    NAME_GAP,
  )
  return { boxes, room }
}

/**
 * Whether each of `shown`, in turn order, stands clear of every name kept
 * before it, with the edge where `fitted` leaves it.
 */
function placedClear(
  shown: readonly NameToFit[],
  { boxes, room }: ReturnType<typeof boxesAt>,
  width: number,
  height: number,
) {
  const radius = Math.max(0, Math.min(width, height) / 2 - 0.5 - room) + NAME_GAP
  const kept: RadialBox[] = []
  return shown.map((name) => {
    const size = boxes.get(name.key)!
    const box = labelBoxAt(name.turn, radius, size.width, size.height)
    const clear = standsClear(box, kept)
    if (clear) kept.push(box)
    return clear
  })
}

/** Where a point of an outline sits, in px, round a centre `cx`, `cy` with the edge `edge` px out. */
function pointOf(vertex: RadarVertex, cx: number, cy: number, edge: number) {
  const angle = vertex.turn * Math.PI * 2
  const out = vertex.r * edge
  return [cx + out * Math.sin(angle), cy - out * Math.cos(angle)] as const
}

/** An outline as a closed SVG path round a centre `cx`, `cy`, with the edge `edge` px out. */
function outlinePath(
  outline: readonly RadarVertex[],
  cx: number,
  cy: number,
  edge: number,
): string {
  if (outline.length === 0) return ''
  return `${outline
    .map((vertex, at) => {
      const [x, y] = pointOf(vertex, cx, cy, edge)
      return `${at === 0 ? 'M' : 'L'}${round(x)} ${round(y)}`
    })
    .join('')}Z`
}

/**
 * The side a tooltip opens on past an axis's name at `turn`: outward, so it
 * covers neither the name nor the shapes; beside the name for the axes at
 * the sides, above or below it for those at the top and bottom.
 */
function nameSide(turn: number): 'top' | 'bottom' | 'left' | 'right' {
  const angle = turn * Math.PI * 2
  const sin = Math.sin(angle)
  if (Math.abs(sin) > Math.SQRT1_2) return sin > 0 ? 'right' : 'left'
  return tooltipSide(turn)
}

/** The axis nearest `turn`, among `count` axes evenly round from the top. */
function axisAt(turn: number, count: number): number | null {
  if (count === 0) return null
  return Math.round((((turn % 1) + 1) % 1) * count) % count
}

/** `target`, a turn from 0 to 1, as the turn nearest `from` that lands on it, whole turns apart. */
function nearestTurn(from: number, target: number) {
  const delta = ((((target - from) % 1) + 1.5) % 1) - 0.5
  return from + delta
}

/**
 * How far out an outline is at `turn`, as a fraction of the edge: where a
 * line from the centre at that turn crosses it, between the two points
 * either side of it. Nothing to cross is the centre.
 */
function outlineRadius(outline: readonly RadarVertex[], turn: number): number {
  if (outline.length === 0) return 0
  if (outline.length === 1) return 0
  const sorted = outline.toSorted((a, b) => a.turn - b.turn)
  const at = ((turn % 1) + 1) % 1
  let after = sorted.findIndex((vertex) => vertex.turn > at)
  if (after === -1) after = 0
  const a = sorted[(after - 1 + sorted.length) % sorted.length]!
  const b = sorted[after]!
  const [ax, ay] = pointOf(a, 0, 0, 1)
  const [bx, by] = pointOf(b, 0, 0, 1)
  const angle = at * Math.PI * 2
  const dx = Math.sin(angle)
  const dy = -Math.cos(angle)
  const ex = bx - ax
  const ey = by - ay
  const across = dx * ey - dy * ex
  // The line runs along the edge: the nearer of its ends.
  if (Math.abs(across) < 1e-12) return Math.max(a.r, b.r)
  return Math.max(0, (ax * ey - ay * ex) / across)
}

/**
 * Matches the points of an outline drawn now, `from`, with those it moves
 * to: a point on an axis in both moves along its spoke; one on an axis that
 * arrives starts on the old outline at its own turn, so it grows out of it;
 * and one on an axis that leaves ends on the new outline at its turn, so it
 * folds into it. In the order they are drawn round, those that leave beside
 * the point before them.
 */
function alignOutlines(
  from: readonly RadarVertex[],
  to: readonly RadarVertex[],
): VertexMove[] {
  const after = new Map(to.map((vertex) => [vertex.key, vertex] as const))
  const before = new Map(from.map((vertex) => [vertex.key, vertex] as const))
  const order = to.map((vertex) => vertex.key)
  // Those that leave go in after the point before them that stays, or first.
  for (const [at, vertex] of from.entries()) {
    if (after.has(vertex.key)) continue
    let anchor = -1
    for (let back = at - 1; back >= 0 && anchor === -1; back--) {
      anchor = order.indexOf(from[back]!.key)
    }
    order.splice(anchor + 1, 0, vertex.key)
  }
  return order.map((key) => {
    const target = after.get(key)
    const source = before.get(key)
    if (target && source) return { key, from: source, to: target }
    if (target) {
      return {
        key,
        from: { turn: target.turn, r: outlineRadius(from, target.turn) },
        to: target,
      }
    }
    return {
      key,
      from: source!,
      to: { turn: source!.turn, r: outlineRadius(to, source!.turn) },
    }
  })
}

/** The outline `progress` of the way through `moves`, each point turning the short way round. */
function outlineAt(moves: readonly VertexMove[], progress: number): RadarVertex[] {
  return moves.map((move) => {
    const turn = nearestTurn(move.from.turn, move.to.turn)
    return {
      key: move.key,
      turn: move.from.turn + (turn - move.from.turn) * progress,
      r: move.from.r + (move.to.r - move.from.r) * progress,
    }
  })
}

/**
 * The series the Up or Down arrow brings forward from `from` on one axis:
 * Up the next further out, Down the next further in, and past either end
 * every series again. From none, Up the furthest out and Down the furthest
 * in. A series with no value there is skipped.
 */
function stepOutward(
  values: readonly { key: string; value: number | null }[],
  from: string | null,
  step: -1 | 1,
): string | null {
  const order = values
    .filter((item): item is { key: string; value: number } => item.value !== null)
    .toSorted((a, b) => b.value - a.value)
    .map((item) => item.key)
  return stepThrough(order, from, step)
}

export {
  alignOutlines,
  axisAt,
  fitNames,
  nameSide,
  nearestTurn,
  outlineAt,
  outlinePath,
  outlineRadius,
  Radar,
  RadarAxis,
  RadarChart,
  type RadarChartProps,
  RadarGrid,
  type RadarProps,
  RadarValueAxis,
  type RadarVertex,
  radarExtent,
  stepOutward,
  thinTicks,
  wrapWords,
}
