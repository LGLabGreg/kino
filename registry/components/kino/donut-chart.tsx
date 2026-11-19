'use client'

import { AnimatedNumber } from '@/registry/components/kino/animated-number'
import {
  CategoryChartFrame,
  ChartSvgPattern,
  type CategoryChartProps,
  type ChartCategory,
  type ChartContextValue,
  type ChartPoint,
  drawingFrame,
  drawingSize,
  figureProps,
  forcedSeriesColor,
  swatchClassName,
  forcedSeriesTextColor,
  plotLayerClassName,
  swatchStyle,
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
} from '@/registry/lib/chart-math'
import { numberFormatter } from '@/registry/lib/number-format'
import {
  placeholderBreatheClassName,
  placeholderFillClassName,
} from '@/registry/lib/placeholder'
import { Swap, SwapText } from '@/registry/lib/swap'
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
  useState,
} from 'react'

import { cn } from '@/lib/utils'

/*
 * The Donut chart: shares of a whole as slices of a ring, or of a pie. Each
 * slice is a dash along one circle, so a new value, a slice hidden or new
 * data moves every slice by its angles, in one CSS transition of the dash,
 * which turns back from wherever it is. The slice under the pointer or the
 * keys stays bright while the rest step back, and its value rolls into the
 * centre. `DonutChartRing` adds a ring inside for another value of the same
 * slices, and `DonutChartLabels` writes on or beside each slice.
 */

interface DonutChartProps extends Omit<
  CategoryChartProps,
  'domain' | 'tickCount' | 'tickValues' | 'allowDecimals' | 'ordered'
> {
  /** The key of each slice's value in the data. The config's keys are the slices, under `index`. */
  dataKey: string
  /** What the values are, such as "Visitors": the centre's caption at rest, and the data table's column. */
  valueLabel?: string
  /** The hole's radius as a share of the ring's, from 0, a pie, to below 1. */
  innerRadius?: number
  /** The room between two slices, in px, as wide at the hole as at the edge; 0 for none. */
  sliceGap?: number
  /** The slice under the pointer, the keys or picked grows out of the ring, as well as staying bright. */
  grow?: boolean
  /**
   * How the slices arrive the first time the chart comes into view: drawn
   * around the ring from the top, or simply there, the default, since a page
   * that loads doesn't animate into place.
   */
  entrance?: 'draw' | 'none'
}

/** A slice's place on the ring, as fractions of a turn clockwise from the top. */
interface Slice {
  start: number
  size: number
}

/** A ring's edges, in px from the centre. */
interface RingBand {
  inner: number
  outer: number
}

/** One ring's value of each slice, by its key in the data and its name. */
interface DonutRingKey {
  dataKey: string
  label: string
}

/** A ring as the chart draws it: its slices, their values and its band. */
interface DonutRing extends DonutRingKey {
  /** Where each category's slice sits, by its key, the leaving ones folded to nothing. */
  slices: ReadonlyMap<string, Slice>
  /** Each shown slice's place, by its place in the data, for the pointer and labels. */
  shares: readonly Slice[]
  /** The values of the slices shown, by their place in the data. */
  values: readonly number[]
  total: number
  band: RingBand
}

interface DonutContextValue {
  /** The rings, outermost first: the chart's own, then each `DonutChartRing`'s. */
  rings: readonly DonutRing[]
  addRing: (ring: DonutRingKey) => () => void
  innerRadius: number
  /** The outer ring's radius at rest, in px. */
  outer: number
  /** How far the slices reach, in px: the outer ring's radius, grown. */
  edge: number
  sliceGap: number
  grow: boolean
  valueLabel: string
  entering: boolean
}

const DonutContext = createContext<DonutContextValue | null>(null)

function useDonutChart() {
  const donut = use(DonutContext)
  if (!donut) throw new Error('Donut chart parts go inside a `DonutChart`.')
  return donut
}

const donutChartKeys = [
  'dataKey',
  'valueLabel',
  'innerRadius',
  'sliceGap',
  'grow',
  'entrance',
]

/** The room between two slices, in px, by default. */
const SLICE_GAP = 2

/** The room between two rings, in px. */
const RING_GAP = 4

/**
 * The least arc a slice with a value takes along the ring's middle, in px,
 * its gap included, so a tiny share still shows and the pointer can find it.
 */
const MIN_ARC = 6

/** How far past the ring, in px, the pointer still finds a slice. */
const PICK_SLACK = 8

/** How much a growing slice scales, when `--donut-chart-grow` isn't set. */
const GROW = 1.08

/** A label's line past the ring: the gap before it and its length, then the gap before the text, in px. */
const LEADER = { gap: 3, length: 10, text: 4 } as const

/** A line of the chart's text, in px. */
const TEXT_HEIGHT = 16

/**
 * The chart's root: it works out each ring's slices from the data, and lays
 * out the frame its legend, centre, labels and tooltip draw in.
 */
function DonutChart(props: DonutChartProps) {
  const {
    dataKey,
    valueLabel,
    innerRadius = 0.62,
    sliceGap = SLICE_GAP,
    grow = false,
    entrance = 'none',
    messages,
    description,
    empty,
    className,
    children,
    ref,
  } = props
  const hole = Math.min(0.95, Math.max(0, innerRadius))
  const gap = Math.max(0, sliceGap)
  const { chart, root, placeholder, phase, room } = useCategoryChart(
    {
      ...props,
      // A slice is named by its config's label, as its legend entry is.
      categoryFormat:
        props.categoryFormat ??
        ((value) => {
          const named = props.config[String(value)]?.label
          return typeof named === 'string' ? named : String(value)
        }),
      messages: {
        series: 'Slices',
        empty: 'No data yet',
        allHidden: 'Every slice is hidden',
        showAll: (count) => `Show all ${count} slices`,
        ...messages,
      },
    },
    {
      orientation: 'vertical',
      stack: 'none',
      entrance: entrance !== 'none',
      moveProperty: 'stroke-dasharray',
      nice: false,
      hideCategories: true,
      bandOf: (at, count) => categoryBand(at, count),
      measure: () => ({ extent: [0, 1] as const }),
    },
  )
  const added = useRegistry<DonutRingKey>()
  const label = valueLabel ?? chart.messages.total
  // The rings among its own children are known from the first render, as on the server's
  // first paint; any deeper one joins once it mounts.
  const declared = Children.toArray(children).flatMap((child) =>
    isValidElement<DonutRingKey>(child) && child.type === DonutChartRing
      ? [{ dataKey: child.props.dataKey, label: child.props.label }]
      : [],
  )
  const keys: DonutRingKey[] = [{ dataKey, label }]
  for (const ring of [...declared, ...added.values]) {
    if (!keys.some((key) => key.dataKey === ring.dataKey)) keys.push(ring)
  }
  const { width, height } = drawingSize(chart.plotSize)
  const scale = useGrowScale(root, grow, width, height)
  const edge = Math.max(0, Math.min(width, height) / 2 - 0.5 - room)
  const outer = edge / scale
  const bands = ringBands(outer, outer * hole, keys.length, RING_GAP)
  const rings: DonutRing[] = keys.map((key, at) => {
    const band = bands[at] ?? { inner: 0, outer: 0 }
    const values = chart.current.map((category) => valueOf(category.datum, key.dataKey))
    const circumference = Math.PI * (band.inner + band.outer)
    const shares = donutSlices(values, circumference > 0 ? MIN_ARC / circumference : 0)
    const slices = new Map<string, Slice>()
    for (const category of chart.categories) {
      if (!chart.entered) slices.set(category.key, { start: 0, size: 0 })
      else if (category.leaving) {
        // Folded to nothing where it would sit among the slices that stay.
        slices.set(category.key, {
          start: foldPoint(shares, category.index),
          size: 0,
        })
      } else slices.set(category.key, shares[category.index] ?? { start: 0, size: 0 })
    }
    return {
      ...key,
      band,
      values,
      shares,
      slices,
      total: values.reduce((sum, value) => sum + value, 0),
    }
  })
  const main = rings[0]!
  const percent = numberFormatter(chart.locale, {
    style: 'percent',
    maximumFractionDigits: 1,
  })
  const nameOf = (category: ChartCategory) => chart.categoryText(category.value)
  const shareOf = (ring: DonutRing, at: number) =>
    ring.total === 0 ? 0 : (ring.values[at] ?? 0) / ring.total
  const valueText = (ring: DonutRing, category: ChartCategory) =>
    chart.datumText(category.datum[ring.dataKey])
  const several = rings.length > 1

  const full: ChartContextValue = {
    ...chart,
    // The tooltip sits on the outer edge of the slice's middle, opening away from the ring.
    pointOf: (at) => {
      const slice = main.shares[at]
      if (!slice || width === 0 || height === 0) return null
      return outerPoint(slice.start + slice.size / 2, width, height, edge)
    },
    pickAt: (point, box) =>
      sliceAt(
        point.x - box.left - box.width / 2,
        point.y - box.top - box.height / 2,
        rings.map((ring, at) => ({
          inner: ring.band.inner,
          // The outer ring reaches as far as a slice of it grows.
          outer: at === 0 ? edge : ring.band.outer,
          slices: ring.shares,
        })),
      ),
    describe: (at) => {
      const category = chart.current[at]
      if (!category) return ''
      return rings
        .map(
          (ring) =>
            `${ring.label} ${valueText(ring, category)}, ${percent.format(shareOf(ring, at))}`,
        )
        .join('; ')
    },
    table: several
      ? {
          columns: rings.map((ring) => ring.label),
          cells: (category) => rings.map((ring) => valueText(ring, category)),
          footer: rings.map((ring) => chart.valueText(ring.total)),
        }
      : {
          columns: [label, chart.messages.share],
          cells: (category) => [
            valueText(main, category),
            percent.format(shareOf(main, category.index)),
          ],
          footer: [chart.valueText(main.total), percent.format(main.total === 0 ? 0 : 1)],
        },
    tooltipContent: (at) => {
      const category = chart.current[at]
      if (!category) return null
      return (
        <DonutTooltipContent
          chart={chart}
          category={category}
          name={nameOf(category)}
          rows={rings.map((ring) => ({
            label: several ? ring.label : null,
            value: valueText(ring, category),
            share: percent.format(shareOf(ring, at)),
          }))}
        />
      )
    },
  }

  return (
    <DonutContext
      value={{
        rings,
        addRing: added.add,
        innerRadius: hole,
        outer,
        edge,
        sliceGap: gap,
        grow,
        valueLabel: label,
        entering: phase === 'entering',
      }}
    >
      <CategoryChartFrame
        chart={full}
        root={root}
        ref={ref}
        slot='donut-chart'
        description={description}
        empty={empty}
        className={className}
        placeholder={
          placeholder ? (
            <DonutTrack slot='donut-chart-placeholder' breathe />
          ) : (
            chart.status === 'ready' &&
            main.total === 0 && <DonutTrack slot='donut-chart-track' />
          )
        }
        {...figureProps(props, donutChartKeys)}
      >
        <DonutSlices ring={0} />
        {children}
      </CategoryChartFrame>
    </DonutContext>
  )
}

/**
 * How much a growing slice scales: the `--donut-chart-grow` set on the chart
 * or above it, read again as the chart changes size, so the ring leaves room
 * for it.
 */
function useGrowScale(
  root: { current: HTMLElement | null },
  grow: boolean,
  width: number,
  height: number,
) {
  const [scale, setScale] = useState(GROW)
  useLayoutEffect(() => {
    const element = root.current
    if (!grow || !element) return
    const read = Number.parseFloat(
      getComputedStyle(element).getPropertyValue('--donut-chart-grow'),
    )
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the scale is the page's CSS, read once the chart is laid out, before it paints
    setScale(Number.isFinite(read) && read >= 1 ? read : GROW)
  }, [root, grow, width, height])
  return grow ? scale : 1
}

/** A slice's value: a number above zero, or zero for one that is missing or below it. */
function valueOf(datum: ChartDatum, dataKey: string) {
  return Math.max(0, numberOf(datum[dataKey]) ?? 0)
}

/**
 * Each value's slice of the ring, in order clockwise from the top, as
 * fractions of a turn. A value above zero takes at least `least` of the turn,
 * taken from the others in proportion, so it shows and can be pointed at.
 * With nothing to share, every slice is empty at the top.
 */
function donutSlices(values: readonly number[], least = 0): Slice[] {
  const positive = values.map((value) => Math.max(0, value))
  const count = positive.filter((value) => value > 0).length
  const floor = count === 0 ? 0 : Math.min(least, 1 / count)
  // The values held at the floor: each pass adds those the rest's shares leave below it.
  const held = new Set<number>()
  const sizesWith = () => {
    const free = 1 - held.size * floor
    const rest = positive.reduce(
      (sum, value, at) => (held.has(at) ? sum : sum + value),
      0,
    )
    return positive.map((value, at) =>
      value === 0 ? 0 : held.has(at) ? floor : rest === 0 ? 0 : (value / rest) * free,
    )
  }
  let sizes = sizesWith()
  for (;;) {
    const below = sizes.flatMap((size, at) =>
      positive[at]! > 0 && !held.has(at) && size < floor ? [at] : [],
    )
    if (below.length === 0) break
    for (const at of below) held.add(at)
    sizes = sizesWith()
  }
  let start = 0
  return sizes.map((size) => {
    const slice = { start, size }
    start += size
    return slice
  })
}

/**
 * The rings' bands, outermost first: the room from `inner` to `outer` px
 * shared evenly by `count` rings, `gap` px apart. A gap never takes more
 * than a fifth of a ring's room, so thin rings stay rings.
 */
function ringBands(outer: number, inner: number, count: number, gap: number): RingBand[] {
  const rings = Math.max(1, count)
  const room = Math.max(0, outer - inner)
  const between = rings === 1 ? 0 : Math.min(gap, room / rings / 5)
  const thickness = (room - between * (rings - 1)) / rings
  return Array.from({ length: rings }, (_, at) => {
    const edge = outer - at * (thickness + between)
    return { outer: edge, inner: Math.max(0, edge - thickness) }
  })
}

/** Where a slice that leaves from place `at` folds to: the start of the slice now there, or the end. */
function foldPoint(slices: readonly Slice[], at: number) {
  const next = slices[at]
  if (next) return next.start
  const last = slices.at(-1)
  return last ? last.start + last.size : 0
}

/**
 * The slice under a point `x` across and `y` down from the centre, in px, by
 * its place in the data: the ring the point is on, or nearest to while it is
 * close, then the slice its angle falls in.
 */
function sliceAt(
  x: number,
  y: number,
  rings: readonly (RingBand & { slices: readonly Slice[] })[],
): number | null {
  const distance = Math.hypot(x, y)
  const outermost = rings[0]
  const innermost = rings.at(-1)
  if (!outermost || !innermost || outermost.outer <= 0) return null
  if (distance > outermost.outer + PICK_SLACK) return null
  if (innermost.inner > 0 && distance < innermost.inner - PICK_SLACK) return null
  const away = (band: RingBand) =>
    Math.max(0, band.inner - distance, distance - band.outer)
  const ring = rings.reduce((near, next) => (away(next) < away(near) ? next : near))
  const turn = turnOf(x, y)
  const at = ring.slices.findIndex(
    (slice) => slice.size > 0 && turn >= slice.start && turn < slice.start + slice.size,
  )
  return at === -1 ? null : at
}

/** How far round a point is from the top, clockwise, as a fraction of a turn. */
function turnOf(x: number, y: number) {
  const turn = Math.atan2(x, -y) / (Math.PI * 2)
  return turn < 0 ? turn + 1 : turn
}

/**
 * The point `radius` px out from the centre, `turn` round from the top, as
 * fractions of a plot `width` by `height` px, and the side a tooltip there
 * opens on.
 */
function outerPoint(
  turn: number,
  width: number,
  height: number,
  radius = Math.min(width, height) / 2,
): ChartPoint {
  const angle = turn * Math.PI * 2
  const x = (width / 2 + radius * Math.sin(angle)) / width
  const y = (height / 2 - radius * Math.cos(angle)) / height
  // Above the ring's top half and below its bottom half, never beside it, where a tooltip
  // that doesn't fit would flip across the hole.
  const side = turn >= 0.25 && turn < 0.75 ? 'bottom' : 'top'
  return { x, y, side }
}

/** A dash along a circle, in px: its length and the offset that starts it where it belongs. */
interface SliceDash {
  dash: string
  offset: number
  /** The slice has nothing to draw, so it shows nothing rather than a hairline. */
  empty: boolean
}

/**
 * A slice as a dash along a circle `circumference` px round that starts at
 * the top: its length, and an offset that is never negative, as Safari
 * misplaces a negative one. Slices meet end to end; the gaps between them are
 * cut out by the ring's mask. The dash repeats a px later than the circle
 * ends, so a browser that measures the circle a little longer never draws a
 * slice a second time.
 */
function sliceDash(slice: Slice, circumference: number, alone: boolean): SliceDash {
  const period = circumference + 1
  const length = slice.size * circumference
  // Never a dash of nothing, which Safari draws as a hairline; a whole ring, the whole period,
  // so it has no seam.
  const drawn =
    alone && slice.size > 0 ? period : Math.max(0.01, Math.min(length, circumference))
  return {
    dash: `${round(drawn)} ${round(period - drawn)}`,
    offset: round(period - slice.start * circumference),
    empty: length === 0,
  }
}

function round(value: number) {
  return Math.round(value * 100) / 100
}

/**
 * One ring: a circle for each slice, each drawn as its dash, in its
 * category's colour. While the chart enters, the slices draw round from the
 * top on `draw`; after that every change moves on `layout`, and a slice that
 * arrives grows out from its own start.
 */
function DonutSlices({ ring: at }: { ring: number }) {
  const chart = useChart()
  const { spotlit } = useChartActive()
  const donut = useDonutChart()
  const ring = donut.rings[at]
  // Before the plot is measured, drawn in a square stand-in that the SVG fits to the plot.
  const { width, height } = drawingSize(chart.plotSize)
  if (!ring || chart.status === 'empty') return null
  const { inner, outer } = ring.band
  const radius = (inner + outer) / 2
  const circumference = 2 * Math.PI * radius
  // A circle starts on its right and runs clockwise; turned back a quarter, it starts at the
  // top, so a dash's offset is its start. Its length is exactly the circumference the dashes
  // are measured on, which a path drawn as two arcs isn't.
  const circle = {
    cx: round(width / 2),
    cy: round(height / 2),
    r: round(radius),
  }
  const drawn = [...ring.slices.values()].filter((slice) => slice.size > 0).length
  // The gaps are cut out of the ring as bands of an even width, so they don't taper towards
  // the centre as a dash's ends would; the dashes themselves meet end to end. The mask stays
  // while a ring shows a single slice, or none yet, so its gaps fade and turn rather than
  // vanish.
  const gaps = donut.sliceGap > 0
  const maskId = `${chart.id}-${at}-gaps`
  return (
    <div
      data-slot='donut-chart-slices'
      aria-hidden
      className={cn(plotLayerClassName, 'z-10')}
    >
      <svg
        className='absolute inset-0 size-full overflow-visible'
        viewBox={`0 0 ${round(width)} ${round(height)}`}
        {...drawingFrame(chart.plotSize, 'xMidYMid meet')}
      >
        {gaps && (
          <defs>
            <mask
              id={maskId}
              maskUnits='userSpaceOnUse'
              x={-round(width)}
              y={-round(height)}
              width={round(width * 3)}
              height={round(height * 3)}
            >
              <rect
                x={-round(width)}
                y={-round(height)}
                width={round(width * 3)}
                height={round(height * 3)}
                fill='white'
              />
              {chart.categories.map((category) => {
                const slice = ring.slices.get(category.key) ?? { start: 0, size: 0 }
                return (
                  <SliceGap
                    key={category.key}
                    cx={circle.cx}
                    cy={circle.cy}
                    // Past the ring's edge, and past a slice that grows.
                    reach={round(donut.edge * 1.5)}
                    width={donut.sliceGap}
                    turn={slice.start}
                    shown={drawn > 1 && slice.size > 0 && !category.leaving}
                    entering={donut.entering}
                  />
                )
              })}
            </mask>
          </defs>
        )}
        <g mask={gaps ? `url(#${maskId})` : undefined}>
          {chart.categories.map((category) => {
            const slice = ring.slices.get(category.key) ?? { start: 0, size: 0 }
            const { dash, offset, empty } = sliceDash(slice, circumference, drawn === 1)
            const arriving = sliceDash(
              { start: slice.start, size: 0 },
              circumference,
              drawn === 1,
            )
            const slot = chart.series.indexOf(category.key)
            const lit = spotlit === category.index && !category.leaving
            const dim =
              (spotlit !== null && !lit && !category.leaving) ||
              (chart.emphasis !== null && chart.emphasis !== category.key)
            return (
              <SliceShape
                key={category.key}
                id={`${chart.id}-${at}-${category.key}`}
                circle={circle}
                thickness={round(outer - inner)}
                dash={dash}
                offset={offset}
                fromDash={arriving.dash}
                fromOffset={arriving.offset}
                empty={empty || category.leaving}
                dim={dim}
                // Only the outer ring grows: an inner one would reach into the ring around it.
                grown={donut.grow && at === 0 && lit}
                entering={donut.entering}
                color={sliceColor(chart, category)}
                slot={slot === -1 ? category.index : slot}
                pattern={slot === -1 ? 'solid' : chart.patternOf(category.key)}
              />
            )
          })}
        </g>
      </svg>
    </div>
  )
}

/**
 * The gap before a slice: a band `width` px wide from the centre out past the
 * ring, cut out of the ring by its mask. It turns round to the slice's start
 * in step with the slice's dash, on the same role, and fades while its slice
 * has nothing to show.
 */
const SliceGap = memo(function SliceGap({
  cx,
  cy,
  reach,
  width,
  turn,
  shown,
  entering,
}: {
  cx: number
  cy: number
  reach: number
  width: number
  turn: number
  shown: boolean
  entering: boolean
}) {
  return (
    <line
      x1={cx}
      y1={cy}
      x2={cx}
      y2={round(cy - reach)}
      stroke='black'
      strokeWidth={width}
      data-entering={entering ? '' : undefined}
      className={cn(
        // An SVG element turns with `transform`, which runs off the main thread.
        '[transform:rotate(var(--gap-turn))] transition-none duration-(--motion-layout-duration) ease-[var(--motion-layout-easing),var(--motion-layout-fade-easing)] group-data-mounted/chart:transition-[transform,opacity] group-data-mounted/chart:starting:opacity-0 data-entering:duration-(--motion-draw-duration) data-entering:ease-[var(--motion-draw-easing),var(--motion-layout-fade-easing)] motion-reduce:group-data-mounted/chart:transition-[opacity]',
        !shown && 'opacity-0',
      )}
      style={
        {
          transformOrigin: `${cx}px ${cy}px`,
          '--gap-turn': `${round(turn * 360)}deg`,
        } as CSSProperties
      }
    />
  )
})

/** A slice's colour: its own, or the next of the chart's colours for a slice the config leaves out. */
function sliceColor(chart: Pick<ChartContextValue, 'series'>, category: ChartCategory) {
  const slot = chart.series.indexOf(category.key)
  return `var(--color-${category.key}, var(--chart-${((slot === -1 ? category.index : slot) % 5) + 1}))`
}

/**
 * One slice: its dash along the ring, with its pattern. Memoised, so the
 * pointer moving between slices redraws only the ones it lights or dims.
 */
const SliceShape = memo(function SliceShape({
  id,
  circle,
  thickness,
  dash,
  offset,
  fromDash,
  fromOffset,
  empty,
  dim,
  grown,
  entering,
  color,
  slot,
  pattern,
}: {
  id: string
  circle: { cx: number; cy: number; r: number }
  thickness: number
  dash: string
  offset: number
  fromDash: string
  fromOffset: number
  empty: boolean
  dim: boolean
  grown: boolean
  entering: boolean
  color: string
  slot: number
  pattern: ChartPattern
}) {
  const patternId = `${id}-pattern`
  return (
    <g
      data-dim={dim ? '' : undefined}
      data-grown={grown ? '' : undefined}
      className={cn(
        // An SVG element scales with `transform`, which runs off the main thread.
        'text-(--slice-color) [transform:scale(1)] transition-none group-data-mounted/chart:transition-[color,transform] duration-(--motion-layout-duration) ease-[var(--motion-layout-fade-easing),var(--motion-layout-easing)] not-forced-colors:data-dim:text-[oklch(from_var(--slice-color)_l_calc(c*var(--donut-chart-dim,0.3))_h)] data-grown:[transform:scale(var(--donut-chart-grow,1.08))] motion-reduce:group-data-mounted/chart:transition-[color]',
        forcedSeriesTextColor(slot),
      )}
      style={
        {
          '--slice-color': color,
          transformOrigin: `${circle.cx}px ${circle.cy}px`,
        } as CSSProperties
      }
    >
      {pattern !== 'solid' && (
        // The circle is turned back a quarter, so the pattern turns forward to match the swatches.
        <ChartSvgPattern id={patternId} pattern={pattern} turn={90} />
      )}
      <circle
        {...circle}
        transform={`rotate(-90 ${circle.cx} ${circle.cy})`}
        data-entering={entering ? '' : undefined}
        data-empty={empty ? '' : undefined}
        className='fill-none transition-none [stroke-dasharray:var(--slice-dash)] [stroke-dashoffset:var(--slice-offset)] group-data-mounted/chart:transition-[stroke-dasharray,stroke-dashoffset,opacity] duration-(--motion-layout-duration) ease-(--motion-layout-easing) group-data-mounted/chart:starting:[stroke-dasharray:var(--slice-from-dash)] group-data-mounted/chart:starting:[stroke-dashoffset:var(--slice-from-offset)] group-data-mounted/chart:starting:opacity-0 data-empty:opacity-0 data-entering:duration-(--motion-draw-duration) data-entering:ease-(--motion-draw-easing) motion-reduce:group-data-mounted/chart:transition-[opacity]'
        style={
          {
            stroke: pattern === 'solid' ? 'currentColor' : `url(#${patternId})`,
            strokeWidth: thickness,
            // Variables, not the properties, so the class's starting dash isn't overruled by an inline style.
            '--slice-dash': dash,
            '--slice-offset': `${offset}px`,
            '--slice-from-dash': fromDash,
            '--slice-from-offset': `${fromOffset}px`,
          } as CSSProperties
        }
      />
    </g>
  )
})

/**
 * Another ring inside the chart's own, for a second value of the same
 * slices, such as last year's beside this year's. Each ring takes an even
 * share of the room between the hole and the edge, outermost first, and the
 * tooltip, the data table and a screen reader give every ring's value.
 */
function DonutChartRing({
  dataKey,
  label,
}: {
  /** The key of each slice's value in this ring, in the chart's data. */
  dataKey: string
  /** What this ring's values are, such as "2025", in the tooltip and the data table. */
  label: string
}) {
  const donut = useDonutChart()
  const { addRing } = donut
  useLayoutEffect(() => addRing({ dataKey, label }), [addRing, dataKey, label])
  const at = donut.rings.findIndex((ring) => ring.dataKey === dataKey)
  return at > 0 ? <DonutSlices ring={at} /> : null
}

/** What a slice's label is given to write. */
interface DonutLabelSlice {
  key: string
  /** The slice's name, from its config's label. */
  name: string
  value: number
  /** Its share of the ring's total, from 0 to 1. */
  share: number
}

/** Where a label sits: past the ring's edge on a short line, or on its slice. */
type DonutLabelPosition = 'outside' | 'inside'

/**
 * Writes each slice's value, share or name, past the outer ring's edge on a
 * short line, or on the slice. A label with no room, or one that would
 * overlap a bigger slice's, is skipped, and every label travels round with
 * its slice.
 */
function DonutChartLabels({
  position = 'outside',
  content = 'value',
  className,
  ...props
}: Omit<ComponentProps<'div'>, 'children' | 'content'> & {
  position?: DonutLabelPosition
  /** What each label writes: the slice's value, its share, its name, or your own words. */
  content?: 'value' | 'share' | 'name' | ((slice: DonutLabelSlice) => string)
}) {
  const chart = useChart()
  const { spotlit } = useChartActive()
  const donut = useDonutChart()
  const { addRoom } = chart
  const ring = donut.rings[0]!
  const percent = numberFormatter(chart.locale, {
    style: 'percent',
    maximumFractionDigits: 0,
  })
  // Every category's, a leaving one's too, so its label fades out with its words.
  const textOf = (category: ChartCategory) => {
    const value = valueOf(category.datum, ring.dataKey)
    // A leaving slice keeps the share it had while it was part of the whole.
    const whole = category.leaving ? ring.total + value : ring.total
    const slice: DonutLabelSlice = {
      key: category.key,
      name: chart.categoryText(category.value),
      value,
      share: whole === 0 ? 0 : value / whole,
    }
    if (typeof content === 'function') return content(slice)
    if (content === 'share') return percent.format(slice.share)
    if (content === 'name') return slice.name
    return chart.valueText(value)
  }
  const widths = chart.current.map((category) => chart.textWidth(textOf(category)))
  const { width, height } = chart.plotSize
  const room =
    position === 'outside' ? outsideRoom(width, height, Math.max(0, ...widths)) : 0
  useLayoutEffect(() => (room > 0 ? addRoom(room) : undefined), [addRoom, room])
  const outside = position === 'outside'
  // Before the plot is measured, labels on their slices sit in the slices' square stand-in;
  // those past the ring wait, since the room they take is in pixels, not a share of the plot.
  const measured = width > 0 && height > 0
  if (chart.status !== 'ready' || (outside && !measured)) return null
  const drawn = drawingSize(chart.plotSize)
  const stretch = measured ? null : 1 / Math.min(drawn.width, drawn.height)
  const { inner, outer } = ring.band
  // On a pie, a little past halfway out, where a slice is wider; on a ring, its middle.
  const radius = outside
    ? donut.edge + LEADER.gap + LEADER.length + LEADER.text
    : inner === 0
      ? outer * 0.62
      : (inner + outer) / 2
  const shown = outside
    ? outsideLabelsShown(ring.shares, widths, radius)
    : ring.shares.map((slice, at) =>
        insideLabelFits(slice, widths[at] ?? 0, radius, outer - inner, donut.sliceGap),
      )
  return (
    <div
      data-slot='donut-chart-labels'
      aria-hidden
      className={cn(plotLayerClassName, 'z-20', className)}
      {...props}
    >
      {chart.categories.map((category) => {
        const slice = ring.slices.get(category.key) ?? { start: 0, size: 0 }
        const at = category.leaving ? -1 : category.index
        return (
          <DonutLabel
            key={category.key}
            turn={slice.start + slice.size / 2}
            radius={radius}
            stretch={stretch}
            edge={outside ? donut.edge : null}
            color={sliceColor(chart, category)}
            shown={at !== -1 && slice.size > 0 && !donut.entering && (shown[at] ?? false)}
            dim={spotlit !== null && spotlit !== category.index}
          >
            {textOf(category)}
          </DonutLabel>
        )
      })}
    </div>
  )
}

/**
 * The room outside labels take past the ring, in px, in a plot `width` by
 * `height` px whose widest label is `widest` px: a line of text above and
 * below, and the widest beside, each past its line.
 */
function outsideRoom(width: number, height: number, widest: number) {
  if (width === 0 || height === 0) return 0
  const past = LEADER.gap + LEADER.length + LEADER.text
  const half = Math.min(width, height) / 2 - 0.5
  const edge = Math.min(width / 2 - past - widest, height / 2 - past - TEXT_HEIGHT)
  return Math.ceil(Math.max(0, half - Math.max(0, edge)))
}

/**
 * A label's box past the ring, in px from the centre: the line ends `radius`
 * out, `turn` round, and the box sits against that end, away from the ring.
 */
function outsideLabelBox(turn: number, radius: number, width: number) {
  const angle = turn * Math.PI * 2
  const sin = Math.sin(angle)
  const cos = Math.cos(angle)
  const x = radius * sin + (sin * width) / 2
  const y = -radius * cos - (cos * TEXT_HEIGHT) / 2
  return {
    left: x - width / 2,
    right: x + width / 2,
    top: y - TEXT_HEIGHT / 2,
    bottom: y + TEXT_HEIGHT / 2,
  }
}

/**
 * Which outside labels show, by place: each slice with a share, unless its
 * box `widths` wide would overlap that of a bigger slice that shows. Labels
 * end `radius` px from the centre.
 */
function outsideLabelsShown(
  slices: readonly Slice[],
  widths: readonly number[],
  radius: number,
): boolean[] {
  const shown = slices.map(() => false)
  const placed: ReturnType<typeof outsideLabelBox>[] = []
  const order = slices
    .map((slice, at) => ({ slice, at }))
    .filter(({ slice }) => slice.size > 0)
    .sort((a, b) => b.slice.size - a.slice.size)
  for (const { slice, at } of order) {
    const box = outsideLabelBox(slice.start + slice.size / 2, radius, widths[at] ?? 0)
    const clear = placed.every(
      (other) =>
        box.right + 2 <= other.left ||
        box.left - 2 >= other.right ||
        box.bottom <= other.top ||
        box.top >= other.bottom,
    )
    if (!clear) continue
    placed.push(box)
    shown[at] = true
  }
  return shown
}

/**
 * Whether a label `width` px wide fits on its slice, centred `radius` px
 * out on a ring `thickness` px thick: the upright box, measured across the
 * ring and along it, with a little room to spare.
 */
function insideLabelFits(
  slice: Slice,
  width: number,
  radius: number,
  thickness: number,
  gap: number,
) {
  if (slice.size <= 0) return false
  const angle = (slice.start + slice.size / 2) * Math.PI * 2
  const sin = Math.abs(Math.sin(angle))
  const cos = Math.abs(Math.cos(angle))
  const across = width * sin + TEXT_HEIGHT * cos
  const along = width * cos + TEXT_HEIGHT * sin
  const chord = 2 * radius * Math.sin(Math.min(Math.PI / 2, slice.size * Math.PI)) - gap
  // A slice over half the ring is wide enough wherever the label sits along it.
  const room = slice.size >= 0.5 ? Infinity : chord
  return across + 4 <= thickness && along + 6 <= room
}

/**
 * One label, turned round the centre to its slice's middle and stood back
 * upright, so it travels along the ring with its slice. Outside, a short line
 * leads to it from the ring's `edge`. Memoised, as the slices are.
 */
const DonutLabel = memo(function DonutLabel({
  turn,
  radius,
  stretch,
  edge,
  color,
  shown,
  dim,
  children,
}: {
  turn: number
  radius: number
  /** Before the plot is measured, one over the stand-in's shorter side, which `radius` is in; else null. */
  stretch: number | null
  /** The ring's edge, in px, for a label outside; null for one on its slice. */
  edge: number | null
  /** The slice's colour, which a label on it is written against. */
  color: string
  shown: boolean
  dim: boolean
  children: string
}) {
  const angle = turn * Math.PI * 2
  return (
    <div
      className={cn(
        'absolute top-1/2 left-1/2 size-0 transition-none duration-(--motion-layout-duration) ease-(--motion-layout-fade-easing) group-data-mounted/chart:transition-[opacity]',
        !shown && 'opacity-0',
      )}
      style={
        {
          '--label-turn': `${round(turn * 360)}deg`,
          '--label-out':
            stretch === null
              ? `${-round(radius)}px`
              : `calc(min(100cqw, 100cqh) * ${-round(radius * stretch * 100) / 100})`,
        } as CSSProperties
      }
    >
      {edge !== null && (
        <div className='absolute size-0 [rotate:var(--label-turn)] transition-none duration-(--motion-layout-duration) ease-(--motion-layout-easing) motion-reduce:group-data-mounted/chart:transition-none group-data-mounted/chart:transition-[rotate]'>
          <span
            className='bg-muted-foreground/60 absolute left-0 w-px -translate-x-1/2 forced-colors:bg-[CanvasText]'
            style={{ bottom: round(edge + LEADER.gap), height: LEADER.length }}
          />
        </div>
      )}
      {/*
       * Out along its slice's middle and turned back as far, in one transform, so both turns
       * move in step and the text stays upright all the way round.
       */}
      <div className='absolute size-0 [transform:rotate(var(--label-turn))_translateY(var(--label-out))_rotate(calc(var(--label-turn)*-1))] transition-none duration-(--motion-layout-duration) ease-(--motion-layout-easing) motion-reduce:group-data-mounted/chart:transition-none group-data-mounted/chart:transition-[transform]'>
        <span
          className={cn(
            'absolute top-0 left-0 font-medium whitespace-nowrap tabular-nums transition-none duration-(--motion-layout-duration) ease-[var(--motion-layout-fade-easing),var(--motion-layout-easing)] group-data-mounted/chart:transition-[color,translate] motion-reduce:group-data-mounted/chart:transition-[color]',
            edge === null
              ? // On its slice: near white or near black, whichever reads on the slice's colour.
                'text-[oklch(from_var(--label-on)_clamp(0.15,(0.57-l)*1000,0.99)_0_0)] forced-colors:rounded-(--control-radius-xs) forced-colors:bg-[Canvas] forced-colors:px-1 forced-colors:text-[CanvasText]'
              : dim
                ? 'text-muted-foreground'
                : 'text-foreground',
          )}
          style={
            {
              '--label-on': color,
              // Outside, against the end of its line and away from the ring; on its slice, centred.
              translate:
                edge === null
                  ? '-50% -50%'
                  : `calc(-50% + ${round(Math.sin(angle) * 50)}%) calc(-50% - ${round(Math.cos(angle) * 50)}%)`,
            } as CSSProperties
          }
        >
          {children}
        </span>
      </div>
    </div>
  )
})

/**
 * The whole ring in the placeholder's tint: what shows while the data loads,
 * breathing slowly, and behind slices that add up to nothing, so the chart
 * keeps its shape.
 */
function DonutTrack({ slot, breathe = false }: { slot: string; breathe?: boolean }) {
  const donut = useDonutChart()
  const inner = donut.rings.at(-1)?.band.inner ?? 0
  return (
    <div
      data-slot={slot}
      aria-hidden
      className={cn(
        plotLayerClassName,
        'z-10 flex items-center justify-center transition-opacity duration-(--motion-enter-duration) ease-(--motion-enter-easing) group-data-mounted/chart:starting:opacity-0',
      )}
    >
      <div className={cn(breathe && placeholderBreatheClassName)}>
        <div
          // As large as the ring.
          className={cn(
            'size-(--donut-size) rounded-full [mask-image:radial-gradient(closest-side,transparent_var(--donut-hole),black_calc(var(--donut-hole)+0.5px))]',
            placeholderFillClassName,
          )}
          style={
            {
              '--donut-size': `${round(donut.outer * 2)}px`,
              '--donut-hole': `${donut.outer === 0 ? 0 : round((inner / donut.outer) * 100)}%`,
            } as CSSProperties
          }
        />
      </div>
    </div>
  )
}

/** A row of the tooltip: one ring's value of the slice, and its share. */
interface DonutTooltipRow {
  /** The ring's name, when there are several. */
  label: string | null
  value: string
  share: string
}

/**
 * The tooltip for a slice: its swatch and its name, its share and its value,
 * or under its name, each ring's.
 */
function DonutTooltipContent({
  chart,
  category,
  name,
  rows,
}: {
  chart: Omit<ChartContextValue, 'pointOf'>
  category: ChartCategory
  name: string
  rows: readonly DonutTooltipRow[]
}) {
  const slot = chart.series.indexOf(category.key)
  const swatch = (
    <span
      aria-hidden
      className={cn(
        swatchClassName,
        forcedSeriesColor(slot === -1 ? category.index : slot),
      )}
      style={swatchStyle(
        category.key,
        slot === -1 ? 'solid' : chart.patternOf(category.key),
      )}
    />
  )
  const figures = (row: DonutTooltipRow) => (
    <>
      {/* A value with a unit reads in its own order whatever the page's direction. */}
      <span
        dir='auto'
        className='text-background/75 tabular-nums forced-colors:text-[CanvasText]'
      >
        {row.share}
      </span>
      <span dir='auto' className='font-medium tabular-nums'>
        {row.value}
      </span>
    </>
  )
  const single = rows.length === 1 ? rows[0] : undefined
  return (
    // The tooltip sits outside the chart, so it carries the chart's id for its colours.
    <div data-chart={chart.id} className='flex min-w-36 flex-col gap-1'>
      <div className='flex items-center gap-2'>
        {swatch}
        <span
          className={cn(
            'min-w-0 flex-1 break-words',
            single ? 'text-background/75 forced-colors:text-[CanvasText]' : 'font-medium',
          )}
        >
          {name}
        </span>
        {single && figures(single)}
      </div>
      {!single &&
        rows.map((row) => (
          <div key={row.label} className='flex items-center gap-2 ps-4'>
            <span className='text-background/75 min-w-0 flex-1 break-words forced-colors:text-[CanvasText]'>
              {row.label}
            </span>
            {figures(row)}
          </div>
        ))}
    </div>
  )
}

/**
 * What sits in the hole: the total of the slices shown, under `label`, and
 * the value and name of the slice under the pointer, the keys, or picked,
 * rolling in as it changes. A pie has no hole, so it draws nothing there.
 */
function DonutChartCentre({
  label,
  className,
  style,
  ...props
}: Omit<ComponentProps<'div'>, 'children'> & {
  /** The caption under the total; the chart's `valueLabel` by default. */
  label?: ReactNode
}) {
  const chart = useChart()
  const { spotlit } = useChartActive()
  const donut = useDonutChart()
  const ring = donut.rings[0]
  if (!ring || chart.status !== 'ready' || donut.innerRadius < 0.4) return null
  const category = spotlit === null ? undefined : chart.current[spotlit]
  const value = category ? (ring.values[category.index] ?? 0) : ring.total
  const caption = category
    ? (chart.config[category.key]?.label ?? chart.categoryText(category.value))
    : (label ?? donut.valueLabel)
  const format = chart.format
  const hole = donut.outer * 2 * donut.innerRadius
  const drawn = drawingSize(chart.plotSize)
  return (
    <div
      data-slot='donut-chart-centre'
      aria-hidden
      className={cn(
        plotLayerClassName,
        'z-20 flex items-center justify-center',
        className,
      )}
      style={
        {
          // Before the plot is measured, the stand-in's hole as a share of the plot's shorter side.
          '--donut-hole':
            chart.plotSize.width > 0 && chart.plotSize.height > 0
              ? `${round(hole)}px`
              : `calc(min(100cqw, 100cqh) * ${hole / Math.min(drawn.width, drawn.height)})`,
          ...style,
        } as CSSProperties
      }
      {...props}
    >
      {/* As wide as most of the hole, so the text never reaches the ring. */}
      <div className='flex w-[calc(var(--donut-hole)*0.78)] min-w-0 flex-col items-center gap-0.5 text-center'>
        {typeof format === 'function' ? (
          <span className='text-[clamp(1rem,calc(var(--donut-hole)*0.2),1.875rem)] font-semibold tracking-tight tabular-nums'>
            <Swap roll>{format(value)}</Swap>
          </span>
        ) : (
          <AnimatedNumber
            value={value}
            locale={chart.locale}
            format={format}
            // Sized to the hole, between the body text and the size of a page's figure.
            className='max-w-full text-[clamp(1rem,calc(var(--donut-hole)*0.2),1.875rem)] font-semibold tracking-tight'
          />
        )}
        <span className='text-muted-foreground flex max-w-full min-w-0 justify-center text-xs'>
          {typeof caption === 'string' ? (
            <SwapText text={caption} />
          ) : (
            <Swap>{caption}</Swap>
          )}
        </span>
      </div>
    </div>
  )
}

export {
  DonutChart,
  DonutChartCentre,
  DonutChartLabels,
  type DonutChartProps,
  DonutChartRing,
  type DonutLabelPosition,
  type DonutLabelSlice,
  donutSlices,
  foldPoint,
  insideLabelFits,
  outerPoint,
  outsideLabelsShown,
  outsideRoom,
  ringBands,
  sliceAt,
  sliceDash,
  turnOf,
}
