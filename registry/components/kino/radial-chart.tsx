'use client'

import { ChartCentreText } from '@/registry/lib/chart-centre'
import {
  type CategoryChartInput,
  CategoryChartFrame,
  type CategoryChartProps,
  type ChartCategory,
  figureProps,
  shareColor,
  ShareTooltipContent,
  useCategoryChart,
  useChart,
  useChartActive,
  useRegistry,
} from '@/registry/lib/chart-core'
import {
  categoryBand,
  type ChartDatum,
  type ChartPattern,
  numberOf,
  valueScale,
} from '@/registry/lib/chart-math'
import {
  fitRound,
  outerPoint,
  type RadialBox,
  ringAt,
  ringBandsOf,
  type RingBand,
  type RoundMark,
  round,
  standsClear,
  type Sweep,
  sweepMarks,
  sweepOf,
  TEXT_HEIGHT,
  turnOf,
  withinSweep,
} from '@/registry/lib/chart-radial'
import {
  ChartSvgPattern,
  forcedSeriesTextColor,
  plotLayerClassName,
} from '@/registry/lib/chart-root'
import { numberFormatter } from '@/registry/lib/number-format'
import {
  placeholderBreatheClassName,
  placeholderInkClassName,
} from '@/registry/lib/placeholder'
import { registerProperties } from '@/registry/lib/run-progress'
import {
  Children,
  type ComponentProps,
  createContext,
  type CSSProperties,
  isValidElement,
  memo,
  type ReactNode,
  use,
  useLayoutEffect,
} from 'react'

import { cn } from '@/lib/utils'

/*
 * The Radial chart: values as arcs round a centre, one ring per row, such
 * as a day's activity against its goals, or a gauge with a needle. Each
 * ring moves on one number, its value as a share of its top, from which CSS
 * works out its arc, the lap past its top and the needle's turn, so a new
 * value sweeps from wherever the ring is, in one transition that turns back
 * cleanly when it's cut short. The ring under the pointer or the keys stays
 * bright while the rest step back, and its value rolls into the centre.
 */

interface RadialChartProps extends Omit<
  CategoryChartProps,
  'ordered' | 'tickCount' | 'tickValues' | 'allowDecimals'
> {
  /** The key of each ring's value in the data. The config's keys are the rings, under `index`. */
  dataKey: string
  /**
   * The key of each ring's own top in the data, such as a goal: each ring is
   * drawn as its share of it, and on a whole circle, laps past it.
   */
  maxKey?: string
  /** What the values are, such as "Visitors": the centre's caption for a value of your own, and the data table's column. */
  valueLabel?: string
  /** Where the arc starts, in degrees clockwise from the top. */
  startAngle?: number
  /** Where the arc ends, in degrees clockwise from the top: 360 past the start for a whole circle. */
  endAngle?: number
  /** The hole's radius as a share of the chart's; by default, each ring takes 15% of the radius, down to a hole of 0.3. */
  innerRadius?: number
  /** Below this value a ring warns: its arc and value turn red. A notch across the ring marks it. */
  low?: number
  /** Past this value a ring warns, as below `low`. */
  high?: number
  /**
   * How the rings arrive the first time the chart comes into view: drawn
   * round from their start, or simply there, the default, since a page that
   * loads doesn't animate into place.
   */
  entrance?: 'draw' | 'none'
}

/** A ring as the chart draws it. */
interface RadialRing {
  category: ChartCategory
  band: RingBand
  value: number
  /** The ring's top: its `maxKey`'s value, or the domain's end. */
  top: number
  /** How far round the arc its value reaches, from 0; past 1 it laps, on a whole circle. */
  fraction: number
  /**
   * The value as a share of its top, for the words: never held, so 150% reads
   * as 150%. With no top of its own (no `maxKey` and no domain's end), a share
   * of the rings' total, since a rounded-out top means nothing to the reader.
   */
  share: number
  warn: boolean
  /** Where `low` and `high` sit along the arc, from 0 to 1. */
  notches: readonly number[]
}

/** What a part needs room for round the arc. */
type RadialPart = 'needle' | 'range' | 'centre'

interface RadialContextValue {
  /** Every ring, a leaving one too, outermost first. */
  rings: readonly RadialRing[]
  /** Each ring still in the data's, by its place among them. */
  current: readonly RadialRing[]
  sweep: Sweep
  /** The circle's centre and radius, in the px the chart draws in. */
  centre: { x: number; y: number }
  radius: number
  /** The hole's radius, in px. */
  hole: number
  /** The size the chart draws at: its plot's, or before the plot is measured, a stand-in the drawing is fitted from. */
  drawn: { width: number; height: number }
  measured: boolean
  /** Where the centre's words sit: in the middle of the hole, above the centre on an arc open below, or under the needle's hub. */
  centrePlace: 'middle' | 'above' | 'below'
  /** The domain's ends, which the range writes. */
  domain: readonly [number, number]
  laps: boolean
  addPart: (part: RadialPart) => () => void
  valueLabel: string
  entering: boolean
}

const RadialContext = createContext<RadialContextValue | null>(null)

function useRadial() {
  const radial = use(RadialContext)
  if (!radial) throw new Error('Radial chart parts go inside a `RadialChart`.')
  return radial
}

const radialChartKeys = [
  'dataKey',
  'maxKey',
  'valueLabel',
  'startAngle',
  'endAngle',
  'innerRadius',
  'low',
  'high',
  'entrance',
]

/** The room between two rings, in px. */
const RING_GAP = 4

/** The needle's hub, in px from its centre. */
const HUB = 6

/** The room between the needle's tip and the ring, in px. */
const NEEDLE_GAP = 6

/** The room the centre's words take under the hub: the gap, the value at its largest and its caption, in px. */
const CENTRE_HEIGHT = 64

/** The room between an arc's end and the range's value under it, in px. */
const RANGE_GAP = 6

/** The room between a ring's start and its label, in px. */
const LABEL_GAP = 8

/** How far a label's line of text may pass the plot's top or bottom, in px: the room above and below its letters. */
const EDGE_SLACK = 4

/** The radius the chart is drawn at before its plot is measured, in px. */
const STAND_IN_RADIUS = 120

/** The most laps a ring draws past its top. */
const MOST_LAPS = 10

const TURN = Math.PI * 2

/** The properties the rings and the needle move on, so their transitions can run them. Once per page. */
function registerRadialProperties() {
  registerProperties([
    {
      name: '--radial-value',
      syntax: '<number>',
      inherits: true,
      initialValue: '0',
    },
    {
      name: '--radial-needle',
      syntax: '<number>',
      inherits: false,
      initialValue: '0',
    },
    ...(['--ring-r', '--ring-t'] as const).map((name) => ({
      name,
      syntax: '<length>',
      inherits: true,
      initialValue: '0px',
    })),
  ])
}

/**
 * How far round its arc a value reaches: its share of the way from `low`
 * to `top`, from 0, and at most a whole arc, or on a whole circle that
 * `laps`, a few turns. No room between the two, or no value, reaches none.
 */
function ringFraction(value: number | null, low: number, top: number, laps: boolean) {
  if (value === null || !Number.isFinite(top) || top <= low) return 0
  const share = (value - low) / (top - low)
  return Math.min(laps ? MOST_LAPS : 1, Math.max(0, share))
}

/** The hole's radius by default, as a share of the chart's: each of `count` rings takes 15% of the radius, down to 0.3. */
function defaultInnerRadius(count: number) {
  return Math.max(0.3, 1 - 0.15 * Math.max(1, count))
}

/**
 * The rings from the outside in: in the data's order, each leaving one in
 * the place it had, after the ring that has taken that place now.
 */
function ringOrder<T extends { index: number; leaving: boolean }>(
  categories: readonly T[],
) {
  return [...categories].sort(
    (a, b) => a.index - b.index || Number(a.leaving) - Number(b.leaving),
  )
}

/** Where the centre's words sit: under the needle's hub, above the centre on an arc open at the bottom, or in the middle. */
function centrePlaceOf(sweep: Sweep, inner: number, needle: boolean) {
  if (needle) return 'below' as const
  const lowest = Math.max(...sweepMarks(sweep, inner).map((mark) => mark.y))
  return lowest < 0.3 ? ('above' as const) : ('middle' as const)
}

/**
 * Where an arc that ends at `turn` with a hole of `inner` reaches lowest
 * there, as fractions of the radius from the centre: across, the middle of
 * the ring's end; down, its inside or its outside, whichever is lower.
 */
function endPoint(turn: number, inner: number) {
  const sin = Math.sin(turn * TURN)
  const cos = Math.cos(turn * TURN)
  return {
    x: ((1 + inner) / 2) * sin,
    y: Math.max(-cos, -inner * cos),
  }
}

/**
 * The box of a ring's label, in px from the centre: before the ring starts,
 * at `turn`, on its middle `radius` px out, against that point and away
 * from where the ring runs.
 */
function startLabelBox(turn: number, radius: number, width: number, height: number) {
  const sin = Math.sin(turn * TURN)
  const cos = Math.cos(turn * TURN)
  // The way the ring runs from its start, clockwise: a label sits the other way.
  const x = radius * sin - cos * (LABEL_GAP + width / 2)
  const y = -radius * cos - sin * (LABEL_GAP + height / 2)
  return {
    left: x - width / 2,
    right: x + width / 2,
    top: y - height / 2,
    bottom: y + height / 2,
  }
}

/**
 * Whether a box, in px from the centre, stays clear of the rings from
 * `inner` to `outer` px along the arc `sweep`: none of its corners, the
 * middles of its sides or its middle lies on them.
 */
function clearsArc(box: RadialBox, inner: number, outer: number, sweep: Sweep) {
  const xs = [box.left, (box.left + box.right) / 2, box.right]
  const ys = [box.top, (box.top + box.bottom) / 2, box.bottom]
  return xs.every((x) =>
    ys.every((y) => {
      const distance = Math.hypot(x, y)
      if (distance < inner - 1 || distance > outer + 1) return true
      return !withinSweep(turnOf(x, y), sweep)
    }),
  )
}

/**
 * The turn a ring's value ends at, for its tooltip: as far round its arc as
 * it reaches, and on a lap, as far round that lap.
 */
function endTurn(fraction: number, sweep: Sweep) {
  const along = fraction > 1 ? fraction % 1 : fraction
  return sweep.start + along * sweep.size
}

/**
 * The size the chart draws at before its plot is measured: a box as large as
 * what `marks` reach at the stand-in radius, which the drawing is fitted to
 * the plot from, so it shows from the server's first paint.
 */
function standInSize(marks: readonly RoundMark[]) {
  const across = marks.flatMap((mark) => [
    mark.x * STAND_IN_RADIUS - (mark.left ?? 0),
    mark.x * STAND_IN_RADIUS + (mark.right ?? 0),
  ])
  const down = marks.flatMap((mark) => [
    mark.y * STAND_IN_RADIUS - (mark.up ?? 0),
    mark.y * STAND_IN_RADIUS + (mark.down ?? 0),
  ])
  return {
    width: Math.ceil(Math.max(...across) - Math.min(...across)) + 1,
    height: Math.ceil(Math.max(...down) - Math.min(...down)) + 1,
  }
}

/** The highest value of `dataKey` in the rows, from zero, rounded out as an axis would be. */
function radialTop(rows: readonly ChartDatum[], dataKey: string) {
  let high = 0
  for (const row of rows) high = Math.max(high, numberOf(row[dataKey]) ?? 0)
  return valueScale([0, high]).domain[1]
}

/**
 * The chart's root: it fits the arc to its plot, works out each ring's
 * band and how far round it reaches, and lays out the frame its centre,
 * labels, needle and tooltip draw in.
 */
function RadialChart(props: RadialChartProps) {
  const {
    dataKey,
    maxKey,
    valueLabel,
    startAngle = 0,
    endAngle = 360,
    innerRadius,
    low,
    high,
    entrance = 'none',
    domain,
    messages,
    description,
    empty,
    className,
    children,
    ref,
  } = props
  registerRadialProperties()
  const { chart, placeholder, phase } = useCategoryChart(
    {
      ...props,
      // A ring is named by its config's label, as its legend entry is.
      categoryFormat:
        props.categoryFormat ??
        ((value) => {
          const named = props.config[String(value)]?.label
          return typeof named === 'string' ? named : String(value)
        }),
      domain: domain ?? [0, 'auto'],
      messages: {
        series: 'Rings',
        empty: 'No data yet',
        allHidden: 'Every ring is hidden',
        showAll: (count) => `Show all ${count} rings`,
        ...messages,
      },
    },
    {
      orientation: 'vertical',
      stack: 'none',
      entrance: entrance !== 'none',
      nice: false,
      seriesOfRow: (row) => String(row[props.index]),
      bandOf: (at, count) => categoryBand(at, count),
      // Rounded out here, once, so the top never changes with the plot's size.
      measure: (rows) => ({ extent: [0, radialTop(rows, dataKey)] as const }),
    },
  )
  const parts = useRegistry<RadialPart>()
  // The parts among its own children are known from the first render, as on the server's
  // first paint; any deeper one joins once it mounts.
  const declared = Children.toArray(children).flatMap((child) =>
    !isValidElement(child)
      ? []
      : child.type === RadialChartNeedle
        ? ['needle' as const]
        : child.type === RadialChartRange
          ? ['range' as const]
          : child.type === RadialChartCentre
            ? ['centre' as const]
            : [],
  )
  const has = (part: RadialPart) => declared.includes(part) || parts.values.includes(part)
  const sweep = sweepOf(startAngle, endAngle)
  const laps = sweep.size >= 1
  const inner = Math.min(
    0.95,
    Math.max(0, innerRadius ?? defaultInnerRadius(chart.series.length)),
  )
  const needle = has('needle')
  const range = has('range') && !laps
  const centrePlace = centrePlaceOf(sweep, inner, needle)
  const [min, max] = chart.scale.domain
  const endText = (value: number) => chart.textWidth(chart.valueText(value))
  const marks: RoundMark[] = sweepMarks(sweep, inner)
  if (needle) marks.push({ x: 0, y: 0, left: HUB, right: HUB, up: HUB, down: HUB })
  if (needle && has('centre')) {
    marks.push({ x: 0, y: 0, down: HUB + CENTRE_HEIGHT })
  }
  if (range) {
    for (const [turn, value] of [
      [sweep.start, min],
      [sweep.start + sweep.size, max],
    ] as const) {
      const half = endText(value) / 2
      marks.push({
        ...endPoint(turn, inner),
        left: half,
        right: half,
        down: RANGE_GAP + TEXT_HEIGHT,
      })
    }
  }
  const measured = chart.plotSize.width > 0 && chart.plotSize.height > 0
  // Before the plot is measured, the chart is drawn at a stand-in radius, in a box as large
  // as what it reaches there, which the drawing is fitted to the plot from.
  const drawn = measured ? chart.plotSize : standInSize(marks)
  const fit = fitRound(drawn.width, drawn.height, marks)
  const radius = fit.radius
  const centre = { x: fit.x, y: fit.y }
  const hole = radius * inner

  // Outermost first, in the data's order; a leaving ring keeps the place it had.
  const order = ringOrder(chart.categories)
  const bandList = ringBandsOf(
    radius,
    hole,
    order.map((category) => !category.leaving),
    RING_GAP,
  )
  const bands = new Map(order.map((category, at) => [category.key, bandList[at]!]))
  const notchesOf = (top: number) =>
    [low, high].flatMap((mark) =>
      mark === undefined ? [] : [ringFraction(mark, min, top, false)],
    )
  // A top the reader knows: each ring's own, or a domain's end they set.
  const ownTop = maxKey !== undefined || typeof domain?.[1] === 'number'
  const total = order.reduce(
    (sum, category) =>
      category.leaving ? sum : sum + Math.max(0, numberOf(category.datum[dataKey]) ?? 0),
    0,
  )
  const rings: RadialRing[] = order.map((category) => {
    const value = numberOf(category.datum[dataKey])
    const top = maxKey === undefined ? max : (numberOf(category.datum[maxKey]) ?? 0)
    const fraction = ringFraction(value, min, top, laps)
    return {
      category,
      band: bands.get(category.key) ?? { inner: 0, outer: 0 },
      value: value ?? 0,
      top,
      fraction: chart.entered && !category.leaving ? fraction : 0,
      share: !value
        ? 0
        : ownTop
          ? top > min
            ? (value - min) / (top - min)
            : 0
          : total > 0
            ? value / total
            : 0,
      warn:
        value !== null &&
        ((high !== undefined && value > high) || (low !== undefined && value < low)),
      notches: notchesOf(top),
    }
  })
  const current = chart.current.map((category) =>
    rings.find((ring) => ring.category.key === category.key)!,
  )
  const percent = numberFormatter(chart.locale, {
    style: 'percent',
    maximumFractionDigits: 0,
  })
  const label = valueLabel ?? chart.messages.value
  const amountText = (ring: RadialRing) =>
    maxKey === undefined
      ? chart.valueText(ring.value)
      : chart.messages.outOf(chart.valueText(ring.value), chart.valueText(ring.top))

  const full: CategoryChartInput = {
    ...chart,
    // The tooltip sits past the outer ring, where the ring's value ends.
    pointOf: (at) => {
      const ring = current[at]
      if (!ring || !measured) return null
      return outerPoint(
        endTurn(ring.fraction, sweep),
        drawn.width,
        drawn.height,
        radius,
        centre,
      )
    },
    pickAt: (point, box) =>
      ringAt(
        point.x - box.left - centre.x,
        point.y - box.top - centre.y,
        current.map((ring) => ring.band),
        sweep,
      ),
    seriesText: (category) => {
      const ring = current.find((each) => each.category.key === category.key)
      return ring ? amountText(ring) : chart.messages.noValue
    },
    describe: (at) => {
      const ring = current[at]
      return ring ? `${amountText(ring)}, ${percent.format(ring.share)}` : ''
    },
    table: {
      columns: [label, chart.messages.share],
      cells: (category) => {
        const ring = current.find((each) => each.category.key === category.key)
        return ring ? [amountText(ring), percent.format(ring.share)] : []
      },
    },
    tooltipContent: (at) => {
      const ring = current[at]
      if (!ring) return null
      return (
        <ShareTooltipContent
          chart={chart}
          category={ring.category}
          name={chart.categoryText(ring.category.value)}
          rows={[
            {
              label: null,
              value: amountText(ring),
              share: percent.format(ring.share),
            },
          ]}
        />
      )
    },
  }

  return (
    <RadialContext
      value={{
        rings,
        current,
        sweep,
        centre,
        radius,
        hole,
        drawn,
        measured,
        centrePlace,
        domain: [min, max],
        laps,
        addPart: parts.add,
        valueLabel: label,
        entering: phase === 'entering',
      }}
    >
      <CategoryChartFrame
        chart={full}
        ref={ref}
        slot='radial-chart'
        description={description}
        empty={empty}
        className={className}
        placeholder={
          placeholder ? (
            <RadialTracks slot='radial-chart-placeholder' breathe />
          ) : (
            (chart.status === 'empty' || chart.status === 'hidden') && (
              <RadialTracks slot='radial-chart-track' />
            )
          )
        }
        {...figureProps(props, radialChartKeys)}
      >
        <RadialRings />
        {children}
      </CategoryChartFrame>
    </RadialContext>
  )
}

/**
 * Where the HTML parts sit: the circle's centre and how large a px of the
 * drawing is, as CSS variables. Before the plot is measured, the stand-in's
 * px are scaled to the plot as its SVG is, from the plot's own size.
 */
function placeStyle(radial: RadialContextValue): CSSProperties {
  const { drawn, centre, measured } = radial
  if (measured) {
    return {
      '--radial-unit': '1px',
      '--radial-x': `${round(centre.x)}px`,
      '--radial-y': `${round(centre.y)}px`,
    } as CSSProperties
  }
  const unit = `min(calc(100cqw / ${drawn.width}), calc(100cqh / ${drawn.height}))`
  return {
    '--radial-unit': unit,
    '--radial-x': `calc(50cqw + ${round(centre.x - drawn.width / 2)} * ${unit})`,
    '--radial-y': `calc(50cqh + ${round(centre.y - drawn.height / 2)} * ${unit})`,
  } as CSSProperties
}

/** An SVG as large as the plot, drawn in the chart's px, or fitted to it from the stand-in. */
function RadialSvg({ children }: { children: ReactNode }) {
  const { drawn } = useRadial()
  return (
    <svg
      className='absolute inset-0 size-full overflow-visible'
      viewBox={`0 0 ${round(drawn.width)} ${round(drawn.height)}`}
      preserveAspectRatio='xMidYMid meet'
    >
      {children}
    </svg>
  )
}

/** The rings, each in its category's colour, the one under the pointer or the keys bright. */
function RadialRings() {
  const chart = useChart()
  const { spotlit } = useChartActive()
  const radial = useRadial()
  if (chart.status === 'empty' || chart.status === 'loading') return null
  return (
    <div
      data-slot='radial-chart-rings'
      aria-hidden
      className={cn(plotLayerClassName, 'z-10')}
    >
      <RadialSvg>
        {/*
         * In the chart's fixed order, not the rings' from the outside in: an element moved in
         * the page starts again with no transition, so a ring that leaves would vanish.
         */}
        {inPageOrder(chart.categories, radial.rings).map((ring) => {
          const { category } = ring
          const slot = chart.series.indexOf(category.key)
          const lit = spotlit === category.index && !category.leaving
          const dim =
            (spotlit !== null && !lit && !category.leaving) ||
            (chart.emphasis !== null && chart.emphasis !== category.key)
          return (
            <RingShape
              key={category.key}
              id={`${chart.id}-${category.key}`}
              cx={round(radial.centre.x)}
              cy={round(radial.centre.y)}
              band={ring.band}
              reach={radial.radius + 10}
              fraction={ring.fraction}
              sweep={radial.sweep}
              laps={radial.laps}
              notches={ring.notches}
              dim={dim}
              warn={ring.warn && !category.leaving}
              leaving={category.leaving}
              entering={radial.entering}
              color={shareColor(chart, category)}
              slot={slot === -1 ? category.index : slot}
              pattern={slot === -1 ? 'solid' : chart.patternOf(category.key)}
            />
          )
        })}
      </RadialSvg>
    </div>
  )
}

/** A circle's length, as a multiple of its radius. */
const CIRCLE = round(TURN * 10_000) / 10_000

/**
 * The dash along a ring's circle that draws a share of its arc, as CSS from
 * the ring's own `--ring-r` and `--ring-t`: its round caps reach exactly to
 * where the share starts and ends, and the dash never repeats round the
 * circle. `reach` is the share, as CSS, from 0 to 1.
 */
function arcDash(reach: string, size: number): CSSProperties {
  const length = `max(0.01px, calc(${reach} * ${round(size * CIRCLE * 10_000) / 10_000} * var(--ring-r) - var(--ring-t)))`
  return {
    '--dash': length,
    strokeDasharray: `var(--dash) calc(${CIRCLE} * var(--ring-r) + var(--ring-t))`,
    strokeDashoffset: `calc(var(--dash) + ${CIRCLE} * var(--ring-r) + var(--ring-t) / 2)`,
  } as CSSProperties
}

/**
 * One ring: its track along the whole arc in a tint of its colour, its
 * value's arc over it, and on a whole circle, the lap past its top with a
 * shadow under the lap's end, as activity rings show it. Everything is
 * worked out from the ring's `--radial-value`, `--ring-r` and `--ring-t`,
 * which its transition runs from wherever they are. Memoised, so the
 * pointer moving between rings redraws only the ones it lights or dims.
 */
const RingShape = memo(function RingShape({
  id,
  cx,
  cy,
  band,
  reach,
  fraction,
  sweep,
  laps,
  notches,
  dim,
  warn,
  leaving,
  entering,
  color,
  slot,
  pattern,
}: {
  id: string
  cx: number
  cy: number
  band: RingBand
  /** How far out anything of a ring can reach while it moves, in px: the chart's radius and a little. */
  reach: number
  fraction: number
  sweep: Sweep
  laps: boolean
  notches: readonly number[]
  dim: boolean
  warn: boolean
  leaving: boolean
  entering: boolean
  color: string
  slot: number
  pattern: ChartPattern
}) {
  const middle = (band.inner + band.outer) / 2
  const thickness = band.outer - band.inner
  const patternId = `${id}-pattern`
  const notchId = `${id}-notches`
  const lapId = `${id}-lap`
  // A circle starts on its right; turned back a quarter and on to the arc's start, it starts there.
  const startDegrees = round(sweep.start * 360)
  const turned = `rotate(${round(startDegrees - 90)} ${cx} ${cy})`
  // The lap's end cap sits half the ring's thickness back from where the value ends.
  const capBack = middle > 0 ? round((thickness / 2 / (TURN * middle)) * 360) : 0
  const circle = {
    cx,
    cy,
    style: {
      r: 'var(--ring-r)',
      strokeWidth: 'var(--ring-t)',
    } as CSSProperties,
  }
  const share = laps ? 'clamp(0, var(--radial-value), 1)' : 'var(--radial-value)'
  const lapReach = 'clamp(0, calc(var(--radial-value) - 1), 1)'
  const stroke = pattern === 'solid' ? 'currentColor' : `url(#${patternId})`
  const box = {
    x: round(cx - reach),
    y: round(cy - reach),
    width: round(reach * 2),
    height: round(reach * 2),
  }
  return (
    <g
      data-slot='radial-chart-ring'
      data-dim={dim ? '' : undefined}
      data-warn={warn ? '' : undefined}
      data-leaving={leaving ? '' : undefined}
      data-entering={entering ? '' : undefined}
      className={cn(
        '[--radial-value:var(--radial-to)] [--ring-ink:var(--ring-color)] [--ring-r:var(--ring-r-to)] [--ring-t:var(--ring-t-to)] text-(--ring-ink) transition-none duration-(--motion-layout-duration) ease-[var(--motion-layout-fade-easing),var(--motion-layout-fade-easing),var(--motion-layout-easing),var(--motion-layout-easing),var(--motion-layout-easing)] group-data-mounted/chart:transition-[color,opacity,--radial-value,--ring-r,--ring-t] group-data-mounted/chart:starting:[--radial-value:0] group-data-mounted/chart:starting:[--ring-t:0px] data-entering:duration-(--motion-draw-duration) data-entering:ease-[var(--motion-layout-fade-easing),var(--motion-layout-fade-easing),var(--motion-draw-easing),var(--motion-layout-easing),var(--motion-layout-easing)] data-leaving:opacity-0 data-warn:[--ring-ink:var(--destructive)] not-forced-colors:data-dim:text-[oklch(from_var(--ring-ink)_l_calc(c*var(--radial-chart-dim,0.3))_h)] motion-reduce:group-data-mounted/chart:transition-[color,opacity]',
        forcedSeriesTextColor(slot),
      )}
      style={
        {
          '--ring-color': color,
          // Variables, not the properties, so the class's starting values aren't overruled.
          '--radial-to': round(fraction * 10_000) / 10_000,
          '--ring-r-to': `${round(middle)}px`,
          '--ring-t-to': `${round(thickness)}px`,
        } as CSSProperties
      }
    >
      {pattern !== 'solid' && <ChartSvgPattern id={patternId} pattern={pattern} />}
      {notches.length > 0 && (
        <defs>
          {/* Where the ring warns: a notch cut through the track and the arc, as the Meter's. */}
          <mask id={notchId} maskUnits='userSpaceOnUse' {...box}>
            <rect {...box} fill='white' />
            {notches.map((notch) => (
              <line
                key={notch}
                x1={cx}
                y1={cy}
                x2={cx}
                y2={round(cy - band.outer - 2)}
                stroke='black'
                strokeWidth={2}
                transform={`rotate(${round(startDegrees + notch * sweep.size * 360)} ${cx} ${cy})`}
              />
            ))}
          </mask>
        </defs>
      )}
      <g mask={notches.length > 0 ? `url(#${notchId})` : undefined}>
        <circle
          {...circle}
          data-slot='radial-chart-track'
          transform={turned}
          className='fill-none [stroke-linecap:round] stroke-[color-mix(in_oklab,var(--ring-color)_16%,transparent)] forced-colors:stroke-[GrayText]'
          style={{ ...circle.style, ...(laps ? {} : arcDash('1', sweep.size)) }}
        />
        <circle
          {...circle}
          transform={turned}
          className='fill-none [stroke-linecap:round] opacity-[min(1,calc(var(--radial-value)*1000000))]'
          style={{
            ...circle.style,
            stroke,
            ...arcDash(share, sweep.size),
          }}
        />
        {laps && (
          // From its top on, the ring is whole, its start and end no longer meeting in a seam,
          // and the lap past it shows, ending in a cap that casts its shadow.
          <g className='opacity-[clamp(0,calc((var(--radial-value)_-_1)*1000000_+_1),1)]'>
            <defs>
              <mask id={lapId} maskUnits='userSpaceOnUse' {...box}>
                <circle {...circle} fill='none' stroke='white' />
              </mask>
            </defs>
            <circle
              {...circle}
              className='fill-none'
              style={{ ...circle.style, stroke }}
            />
            {/*
             * The lap's end casts a shadow on the ring under it, ahead of where it ends, and only
             * on the ring, so the overlap reads.
             */}
            <g
              mask={`url(#${lapId})`}
              // Only once it laps: at its top exactly, nothing overlaps to cast on.
              className='opacity-[clamp(0,calc((var(--radial-value)_-_1)*1000000),1)]'
            >
              <g
                className='[transform:rotate(calc(var(--radial-value)*360deg_+_var(--cap-turn)))]'
                style={
                  {
                    transformOrigin: `${cx}px ${cy}px`,
                    '--cap-turn': `${round(startDegrees - capBack)}deg`,
                  } as CSSProperties
                }
              >
                <circle
                  cx={cx}
                  className='fill-current [filter:drop-shadow(calc(var(--ring-t)*0.18)_0_calc(var(--ring-t)*0.18)_rgb(0_0_0/0.45))] forced-colors:hidden'
                  style={
                    {
                      cy: `calc(${cy}px - var(--ring-r))`,
                      r: 'calc(var(--ring-t) / 2)',
                    } as CSSProperties
                  }
                />
              </g>
            </g>
            {/* The lap, one turn at most, ending where the value ends. */}
            <g
              className='[transform:rotate(calc((var(--radial-value)_-_clamp(0,calc(var(--radial-value)_-_1),1))*360deg))]'
              style={{ transformOrigin: `${cx}px ${cy}px` }}
            >
              <circle
                {...circle}
                transform={turned}
                className='fill-none [stroke-linecap:round]'
                style={{ ...circle.style, stroke, ...arcDash(lapReach, 1) }}
              />
            </g>
          </g>
        )}
      </g>
    </g>
  )
})

/**
 * Every ring's track along the whole arc in the placeholder's tint: what
 * shows while the data loads, breathing slowly, and behind a chart with
 * nothing to draw, so it keeps its shape.
 */
function RadialTracks({ slot, breathe = false }: { slot: string; breathe?: boolean }) {
  const chart = useChart()
  const radial = useRadial()
  const bands = ringBandsOf(
    radial.radius,
    radial.hole,
    chart.series.map(() => true),
    RING_GAP,
  )
  const cx = round(radial.centre.x)
  const cy = round(radial.centre.y)
  const turned = `rotate(${round(radial.sweep.start * 360 - 90)} ${cx} ${cy})`
  return (
    <div
      data-slot={slot}
      aria-hidden
      className={cn(
        plotLayerClassName,
        'z-10 transition-opacity duration-(--motion-enter-duration) ease-(--motion-enter-easing) group-data-mounted/chart:starting:opacity-0',
      )}
    >
      <div className={cn('absolute inset-0', breathe && placeholderBreatheClassName)}>
        <RadialSvg>
          {bands.map((band, at) => (
            <circle
              key={chart.series[at]}
              cx={cx}
              cy={cy}
              transform={turned}
              className={cn(
                'fill-none [stroke-linecap:round] stroke-current',
                placeholderInkClassName,
              )}
              style={
                {
                  '--ring-r': `${round((band.inner + band.outer) / 2)}px`,
                  '--ring-t': `${round(band.outer - band.inner)}px`,
                  r: 'var(--ring-r)',
                  strokeWidth: 'var(--ring-t)',
                  ...(radial.laps ? {} : arcDash('1', radial.sweep.size)),
                } as CSSProperties
              }
            />
          ))}
        </RadialSvg>
      </div>
    </div>
  )
}

/** The rings in the chart's fixed order, which sorting or hiding them doesn't change. */
function inPageOrder(categories: readonly ChartCategory[], rings: readonly RadialRing[]) {
  return categories.flatMap((category) => {
    const ring = rings.find((each) => each.category.key === category.key)
    return ring ? [ring] : []
  })
}

/** Tells the chart a part is there, so it leaves the part's room round the arc. */
function useRadialPart(part: RadialPart) {
  const { addPart } = useRadial()
  useLayoutEffect(() => addPart(part), [addPart, part])
}

/**
 * What sits in the hole: the value and name of the ring under the pointer,
 * the keys, or picked, rolling in as it changes, and at rest, the first
 * ring's, or a value of your own under `label`. A ring that warns writes
 * its value in red, as the Meter does.
 */
function RadialChartCentre({
  value,
  label,
  content = 'value',
  className,
  style,
  ...props
}: Omit<ComponentProps<'div'>, 'children' | 'content'> & {
  /** The value at rest, such as a total, in place of the first ring's. */
  value?: number
  /** The caption at rest: the first ring's name, or with `value`, the chart's `valueLabel`. */
  label?: ReactNode
  /** What the centre writes: each ring's value, or its share of its top. */
  content?: 'value' | 'share'
}) {
  useRadialPart('centre')
  const chart = useChart()
  const { spotlit } = useChartActive()
  const radial = useRadial()
  if (chart.status !== 'ready') return null
  const lit = spotlit === null ? undefined : radial.current[spotlit]
  const ring = lit ?? radial.current[0]
  if (!ring) return null
  const own = !lit && value !== undefined
  const shown = own ? value : content === 'share' ? ring.share : ring.value
  const caption = lit
    ? chart.categoryText(lit.category.value)
    : (label ?? (own ? radial.valueLabel : chart.categoryText(ring.category.value)))
  const format =
    content === 'share' && !own
      ? ({ style: 'percent', maximumFractionDigits: 0 } as const)
      : chart.format
  const place = radial.centrePlace
  return (
    <div
      data-slot='radial-chart-centre'
      aria-hidden
      className={cn(plotLayerClassName, 'z-20', className)}
      style={{ ...placeStyle(radial), ...style }}
      {...props}
    >
      <div
        className={cn(
          'absolute top-(--radial-y) left-(--radial-x) flex justify-center',
          place === 'middle' && '-translate-1/2',
          place === 'above' && '-translate-x-1/2 -translate-y-full',
        )}
        style={
          {
            '--centre-hole': `calc(var(--radial-unit) * ${round(radial.hole * 2 * (place === 'below' ? 1.15 : 1))})`,
            ...(place === 'below'
              ? { translate: `-50% calc(var(--radial-unit) * ${HUB + 6})` }
              : {}),
          } as CSSProperties
        }
      >
        <ChartCentreText
          value={shown}
          caption={caption}
          format={format}
          locale={chart.locale}
          className={cn(
            'transition-colors duration-(--motion-layout-duration) ease-(--motion-layout-fade-easing)',
            !own && ring.warn && 'text-destructive',
          )}
        />
      </div>
    </div>
  )
}

/**
 * A needle from a hub at the centre, pointing at the first ring's value, as
 * a gauge's. It turns in step with the ring's arc, on the same role, and
 * never past the arc's ends.
 */
function RadialChartNeedle({
  className,
  ...props
}: Omit<ComponentProps<'div'>, 'children'>) {
  useRadialPart('needle')
  const chart = useChart()
  const radial = useRadial()
  const ring = radial.current[0]
  if (chart.status !== 'ready' || !ring) return null
  const { x: cx, y: cy } = radial.centre
  const innermost = radial.current.at(-1)?.band.inner ?? radial.hole
  const length = Math.max(HUB * 2, innermost - NEEDLE_GAP)
  const startDegrees = round(radial.sweep.start * 360)
  return (
    <div
      data-slot='radial-chart-needle'
      aria-hidden
      className={cn(plotLayerClassName, 'z-20', className)}
      {...props}
    >
      <RadialSvg>
        <g
          data-entering={radial.entering ? '' : undefined}
          className='fill-foreground [--radial-needle:var(--needle-to)] [transform:rotate(calc(var(--needle-start)_+_clamp(0,var(--radial-needle),1)*var(--needle-span)))] transition-none duration-(--motion-layout-duration) ease-(--motion-layout-easing) group-data-mounted/chart:transition-[--radial-needle] group-data-mounted/chart:starting:[--radial-needle:0] data-entering:duration-(--motion-draw-duration) data-entering:ease-(--motion-draw-easing) motion-reduce:group-data-mounted/chart:transition-none forced-colors:fill-[CanvasText]'
          style={
            {
              transformOrigin: `${round(cx)}px ${round(cy)}px`,
              '--needle-to': round(ring.fraction * 10_000) / 10_000,
              '--needle-start': `${startDegrees}deg`,
              '--needle-span': `${round(radial.sweep.size * 360)}deg`,
            } as CSSProperties
          }
        >
          {/* Narrowing from the hub to its tip, at the top, turned to the value. */}
          <path
            d={`M${round(cx - HUB / 2)} ${round(cy)} L${round(cx - 0.75)} ${round(cy - length)} L${round(cx + 0.75)} ${round(cy - length)} L${round(cx + HUB / 2)} ${round(cy)} Z`}
          />
          <circle cx={round(cx)} cy={round(cy)} r={HUB} />
          <circle cx={round(cx)} cy={round(cy)} r={HUB / 3} className='fill-background' />
        </g>
      </RadialSvg>
    </div>
  )
}

/**
 * The domain's ends, written under the arc's ends: what an empty and a
 * full arc stand for, as a gauge shows them. Nothing on a whole circle,
 * whose ends meet.
 */
function RadialChartRange({
  className,
  style,
  ...props
}: Omit<ComponentProps<'div'>, 'children'>) {
  useRadialPart('range')
  const chart = useChart()
  const radial = useRadial()
  if (chart.status !== 'ready' || radial.laps) return null
  const outer = radial.radius
  const inner = outer === 0 ? 0 : radial.hole / outer
  const ends = [
    { turn: radial.sweep.start, value: radial.domain[0] },
    { turn: radial.sweep.start + radial.sweep.size, value: radial.domain[1] },
  ]
  return (
    <div
      data-slot='radial-chart-range'
      aria-hidden
      className={cn(plotLayerClassName, 'z-20', className)}
      style={{ ...placeStyle(radial), ...style }}
      {...props}
    >
      {ends.map((end, at) => {
        const point = endPoint(end.turn, inner)
        return (
          <span
            key={at === 0 ? 'min' : 'max'}
            dir='auto'
            className='text-muted-foreground absolute top-(--radial-y) left-(--radial-x) tabular-nums'
            style={{
              translate: `calc(-50% + var(--radial-unit) * ${round(point.x * outer)}) calc(var(--radial-unit) * ${round(point.y * outer + RANGE_GAP)})`,
            }}
          >
            {chart.valueText(end.value)}
          </span>
        )
      })}
    </div>
  )
}

/** What a ring's label is given to write. */
interface RadialLabelRing {
  key: string
  /** The ring's name, from its config's label. */
  name: string
  value: number
  /** Its value as a share of its top, or of the rings' total when it has none. */
  share: number
}

/**
 * Writes each ring's name, value or share before its start, in the open
 * part of the circle, as a column that names the rings where they begin. A
 * label that would cross a ring, another label or the plot's edge is
 * skipped, and each moves with its ring's band.
 */
function RadialChartLabels({
  content = 'name',
  className,
  style,
  ...props
}: Omit<ComponentProps<'div'>, 'children' | 'content'> & {
  /** What each label writes: the ring's name, its value, its share, or your own words. */
  content?: 'name' | 'value' | 'share' | ((ring: RadialLabelRing) => string)
}) {
  const chart = useChart()
  const { spotlit } = useChartActive()
  const radial = useRadial()
  if (chart.status !== 'ready') return null
  const percent = numberFormatter(chart.locale, {
    style: 'percent',
    maximumFractionDigits: 0,
  })
  const textOf = (ring: RadialRing) => {
    const named: RadialLabelRing = {
      key: ring.category.key,
      name: chart.categoryText(ring.category.value),
      value: ring.value,
      share: ring.share,
    }
    if (typeof content === 'function') return content(named)
    if (content === 'share') return percent.format(named.share)
    if (content === 'value') return chart.valueText(named.value)
    return named.name
  }
  const shown = labelsShown(
    radial.rings.map((ring) => ({
      width: chart.textWidth(textOf(ring)),
      band: ring.band,
      present: !ring.category.leaving,
    })),
    radial.sweep,
    radial.centre,
    radial.drawn,
  )
  return (
    <div
      data-slot='radial-chart-labels'
      aria-hidden
      className={cn(plotLayerClassName, 'z-20', className)}
      style={{ ...placeStyle(radial), ...style }}
      {...props}
    >
      {inPageOrder(chart.categories, radial.rings).map((ring) => {
        const at = radial.rings.indexOf(ring)
        const width = chart.textWidth(textOf(ring))
        const box = startLabelBox(
          radial.sweep.start,
          (ring.band.inner + ring.band.outer) / 2,
          width,
          TEXT_HEIGHT,
        )
        return (
          <RingLabel
            key={ring.category.key}
            x={(box.left + box.right) / 2}
            y={(box.top + box.bottom) / 2}
            shown={(shown[at] ?? false) && !radial.entering}
            dim={
              spotlit !== null &&
              radial.current[spotlit]?.category.key !== ring.category.key
            }
          >
            {textOf(ring)}
          </RingLabel>
        )
      })}
    </div>
  )
}

/**
 * Which rings' labels show, by place: each present ring's, before its start,
 * unless it would cross a ring, a label of a ring further out, or the
 * plot's edge. Sizes in px, the centre's place in the plot `plot` px.
 */
function labelsShown(
  labels: readonly { width: number; band: RingBand; present: boolean }[],
  sweep: Sweep,
  centre: { x: number; y: number },
  plot: { width: number; height: number },
): boolean[] {
  const drawnRings = labels.filter((label) => label.present)
  const inner = drawnRings.at(-1)?.band.inner ?? 0
  const outer = drawnRings[0]?.band.outer ?? 0
  const placed: RadialBox[] = []
  return labels.map((label) => {
    if (!label.present || label.band.outer <= label.band.inner) return false
    const box = startLabelBox(
      sweep.start,
      (label.band.inner + label.band.outer) / 2,
      label.width,
      TEXT_HEIGHT,
    )
    // A line of text is taller than its letters, so it may pass the plot's edge by a little.
    const inside =
      box.left + centre.x >= 0 &&
      box.right + centre.x <= plot.width &&
      box.top + centre.y >= -EDGE_SLACK &&
      box.bottom + centre.y <= plot.height + EDGE_SLACK
    if (!inside || !clearsArc(box, inner, outer, sweep) || !standsClear(box, placed)) {
      return false
    }
    placed.push(box)
    return true
  })
}

/** One ring's label, moving with its ring's band. Memoised, as the rings are. */
const RingLabel = memo(function RingLabel({
  x,
  y,
  shown,
  dim,
  children,
}: {
  x: number
  y: number
  shown: boolean
  dim: boolean
  children: string
}) {
  return (
    <div
      className={cn(
        'absolute top-(--radial-y) left-(--radial-x) size-0 [translate:calc(var(--radial-unit)*var(--label-x))_calc(var(--radial-unit)*var(--label-y))] transition-none duration-(--motion-layout-duration) ease-[var(--motion-layout-fade-easing),var(--motion-layout-easing)] group-data-mounted/chart:transition-[opacity,translate] motion-reduce:group-data-mounted/chart:transition-opacity',
        !shown && 'opacity-0',
      )}
      style={{ '--label-x': round(x), '--label-y': round(y) } as CSSProperties}
    >
      <span
        dir='auto'
        className={cn(
          'absolute top-0 left-0 -translate-1/2 font-medium whitespace-nowrap tabular-nums transition-colors duration-(--motion-layout-duration) ease-(--motion-layout-fade-easing)',
          dim ? 'text-muted-foreground' : 'text-foreground',
        )}
      >
        {children}
      </span>
    </div>
  )
})

export {
  clearsArc,
  defaultInnerRadius,
  endTurn,
  labelsShown,
  RadialChart,
  RadialChartCentre,
  RadialChartLabels,
  type RadialChartProps,
  RadialChartNeedle,
  RadialChartRange,
  type RadialLabelRing,
  radialTop,
  ringFraction,
  ringOrder,
  standInSize,
  startLabelBox,
}
