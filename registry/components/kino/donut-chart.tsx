'use client'

import { ChartCentreText } from '@/registry/lib/chart-centre'
import {
  CategoryChartFrame,
  ChartSvgPattern,
  type CategoryChartProps,
  type ChartCategory,
  type ChartContextValue,
  shareColor,
  ShareTooltipContent,
  shareValue,
  drawingFrame,
  drawingSize,
  figureProps,
  forcedSeriesTextColor,
  labelOnClassName,
  plotLayerClassName,
  useCategoryChart,
  useChart,
  useChartActive,
  useRegistry,
} from '@/registry/lib/chart-core'
import { categoryBand, type ChartPattern } from '@/registry/lib/chart-math'
import {
  foldPoint,
  insideLabelFits,
  LEADER,
  outerPoint,
  outsideLabelsShown,
  outsideRoom,
  RadialLabel,
  ringBands,
  type RingBand,
  ringSlices,
  round,
  type Slice,
  sliceAt,
  sliceDash,
} from '@/registry/lib/chart-radial'
import { numberFormatter } from '@/registry/lib/number-format'
import {
  placeholderBreatheClassName,
  placeholderFillClassName,
} from '@/registry/lib/placeholder'
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

/** How much a growing slice scales, when `--donut-chart-grow` isn't set. */
const GROW = 1.08

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
      round: true,
      nice: false,
      seriesOfRow: (row) => String(row[props.index]),
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
    const values = chart.current.map((category) =>
      shareValue(category.datum, key.dataKey),
    )
    const circumference = Math.PI * (band.inner + band.outer)
    const shares = ringSlices(values, circumference > 0 ? MIN_ARC / circumference : 0)
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
        <ShareTooltipContent
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
                const slice = ring.slices.get(category.key) ?? {
                  start: 0,
                  size: 0,
                }
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
            const slice = ring.slices.get(category.key) ?? {
              start: 0,
              size: 0,
            }
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
                color={shareColor(chart, category)}
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
    const value = shareValue(category.datum, ring.dataKey)
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
            color={shareColor(chart, category)}
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
 * One slice's label, on its slice or past the ring on a short line from its
 * `edge`, in the words' colours there. Memoised, as the slices are.
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
  stretch: number | null
  /** The ring's edge, in px, for a label outside; null for one on its slice. */
  edge: number | null
  /** The slice's colour, which a label on it is written against. */
  color: string
  shown: boolean
  dim: boolean
  children: string
}) {
  return (
    <RadialLabel
      turn={turn}
      radius={radius}
      stretch={stretch}
      edge={edge}
      centred={edge === null}
      shown={shown}
      className={cn(
        'font-medium whitespace-nowrap tabular-nums',
        edge === null
          ? // On its slice: near white or near black, whichever reads on the slice's colour.
            labelOnClassName
          : dim
            ? 'text-muted-foreground'
            : 'text-foreground',
      )}
      style={{ '--label-on': color } as CSSProperties}
    >
      {children}
    </RadialLabel>
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
          '--centre-hole':
            chart.plotSize.width > 0 && chart.plotSize.height > 0
              ? `${round(hole)}px`
              : `calc(min(100cqw, 100cqh) * ${hole / Math.min(drawn.width, drawn.height)})`,
          ...style,
        } as CSSProperties
      }
      {...props}
    >
      <ChartCentreText
        value={value}
        caption={caption}
        format={chart.format}
        locale={chart.locale}
      />
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
}
