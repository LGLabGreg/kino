'use client'

import { AnimatedNumber } from '@/registry/components/kino/animated-number'
import { Button, buttonVariants } from '@/registry/components/kino/button'
import { useAnnouncer } from '@/registry/lib/announce'
import {
  type ChartConfig,
  type ChartDatum,
  type ChartPattern,
  labelLength,
  type ReadingDirection,
} from '@/registry/lib/chart-math'
import {
  type ChartStatus,
  type ChartTable,
  type ChartTarget,
  durationOf,
  leavingAfter,
  moveTiming,
  resolveFocus,
  sameTarget,
  targetKey,
  travelOf,
} from '@/registry/lib/chart-state'
import { useControllable } from '@/registry/lib/controllable'
import { CutTooltip } from '@/registry/lib/cut'
import { numberFormatter } from '@/registry/lib/number-format'
import { reducesMotion } from '@/registry/lib/reduce-motion'
import { markMounted, mergeRefs } from '@/registry/lib/refs'
import { FOLLOWS_TRANSITION } from '@/registry/lib/resize'
import { revealBehavior, revealBy } from '@/registry/lib/scroll'
import { Swap } from '@/registry/lib/swap'
import { useDirection } from '@base-ui/react/direction-provider'
import { Toggle as TogglePrimitive } from '@base-ui/react/toggle'
import { Tooltip as TooltipPrimitive } from '@base-ui/react/tooltip'
import {
  type ComponentProps,
  createContext,
  type CSSProperties,
  type ReactNode,
  type Ref,
  type RefObject,
  use,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { flushSync } from 'react-dom'

import { cn } from '@/lib/utils'

/*
 * The root every chart sits on, whatever its shape: its series and their
 * colours, what is hidden and brought forward, its status and its words,
 * the figure and its plot, the one tooltip, the data table, what a screen
 * reader hears, the focus and the moves. It knows nothing about categories,
 * bands or axes: each family of charts hands it a reader (`ChartReader`)
 * that answers for its own marks.
 */

/** A point of the plot under the pointer, in px from its top left, and the plot's size. */
interface PlotPoint {
  x: number
  y: number
  width: number
  height: number
}

/** Where a tooltip sits, as fractions of the plot from its top left, and the side it opens on. */
interface ChartPoint {
  x: number
  y: number
  side: 'top' | 'bottom' | 'left' | 'right' | 'inline-start' | 'inline-end'
}

/** One thing a chart's API counts and hands back: a category, a tile, a slice, a flow. */
interface ChartItem {
  key: string
  /** As the data has it: the category, or a tile's or a node's name. */
  value: unknown
  /** Its row of your data, or null where none sits: a Sankey node, the Waffle's remaining share, a heatmap cell the data leaves out, a stop only a series' own data has. */
  datum: ChartDatum | null
  /** Its place in the chart's items: what `activeIndex` counts. */
  index: number
}

/**
 * What a family of charts answers for its marks, so the root can keep the
 * focus, bring series forward and hand items back through the chart's API.
 */
interface ChartReader {
  /** Whether `target` is one of the chart's now: a stop the keys reach and the tooltip shows. */
  holds: (target: ChartTarget) => boolean
  /** The series `target` brings forward, or null. */
  lights: (target: ChartTarget) => string | null
  /** The item `target` is on, as the public API hands it back, or null. */
  item: (target: ChartTarget) => ChartItem | null
  /** Every item, in the order `activeIndex` counts. */
  items: readonly ChartTarget[]
  /** What the pointer, the keys, the tooltip and the data table read, or null on a chart they don't reach, such as the Bar list. */
  browse: ChartBrowseReader | null
}

/**
 * How the pointer and the keys move through a chart's marks, where its
 * tooltip sits and what it says, and how the chart is read out.
 */
interface ChartBrowseReader {
  /** What is under the pointer, or null for nothing. */
  targetAt: (point: PlotPoint) => ChartTarget | null
  /** Where the keys start when nothing is reached or picked yet. */
  start: ChartTarget | null
  /** Where `key` goes from `from`, or null for a key the chart doesn't take. */
  step: (from: ChartTarget, key: string) => ChartTarget | null
  /** The place of `target` among the stops, from 1, as the slider's value. */
  rank: (target: ChartTarget) => number
  /** How many stops the keys reach, as the slider's most. */
  stops: number
  /** The way the keys step, as the slider's orientation. */
  orientation: 'horizontal' | 'vertical'
  /** Where the tooltip of `target` sits, or null before the plot is measured. */
  anchor: (target: ChartTarget) => ChartPoint | null
  /** What a screen reader hears on `target`. */
  describe: (target: ChartTarget) => string
  /** What the tooltip shows on `target`. */
  tooltip: (target: ChartTarget) => ReactNode
  table: ChartTable
  /** What opening `target` does, such as zooming into its group, or null. */
  open: (target: ChartTarget) => (() => void) | null
  /** What Escape goes back to once nothing is lit, such as zooming back out, or null. */
  back: (() => void) | null
}

/** Every word the chart says or reads out, for a chart in another language. */
interface ChartMessages {
  /** The data table's name. */
  table: string
  /** The data table's first column. */
  category: string
  /** The name of the layer that steps through the categories by keyboard. */
  browse: string
  noValue: string
  /** A value's column of the data table, when the chart has no name for its values. */
  value: string
  total: string
  /** A value's share of the whole, as a column of the data table. */
  share: string
  /** The legend's name. */
  series: string
  selected: string
  /** Said of a value that is projected, not measured. */
  forecast: string
  /** A change since the category before, such as "up 22%". */
  change: (change: number, size: string) => string
  /** A value against the most it could be, such as "86 of 120". */
  outOf: (value: string, most: string) => string
  /** The column of the data table naming the group a value is in, such as a treemap tile's. */
  group: string
  /** The whole of a chart that zooms, such as a treemap's first crumb. */
  whole: string
  /** The data table's columns for where a flow starts and where it ends, such as a Sankey's. */
  from: string
  to: string
  /** A flow from one node to another, with their names. */
  flow: (from: string, to: string) => string
  /** The way back out of a chart that zooms, with the chart's `label`, so each chart's is its own. */
  zoomPath: (label: string) => string
  /** Said once a chart that zooms shows another part of it, with the part's name. */
  zoomedTo: (name: string) => string
  /** A funnel step's share of the first step, as a row of its tooltip and a column of the data table. */
  ofFirst: string
  /** A funnel step's share of the step before. */
  ofPrevious: string
  /** How many a funnel lost since the step before. */
  droppedOff: string
  loading: string
  /** Said when the data arrives, with the chart's `label`. */
  loaded: (label: string) => string
  empty: string
  allHidden: string
  showAll: (count: number) => string
  error: string
  retry: string
}

const defaultMessages: ChartMessages = {
  table: 'Chart data',
  category: 'Category',
  browse: 'Values',
  noValue: 'No value',
  value: 'Value',
  total: 'Total',
  share: 'Share',
  series: 'Series',
  selected: 'selected',
  forecast: 'forecast',
  change: (change, size) =>
    change > 0 ? `up ${size}` : change < 0 ? `down ${size}` : 'no change',
  outOf: (value, most) => `${value} of ${most}`,
  group: 'Group',
  whole: 'All',
  from: 'From',
  to: 'To',
  flow: (from, to) => `${from} to ${to}`,
  zoomPath: (label) => `Zoom path for ${label}`,
  zoomedTo: (name) => `Showing ${name}`,
  ofFirst: 'Of the first step',
  ofPrevious: 'Of the step before',
  droppedOff: 'Dropped off',
  loading: 'Loading chart',
  loaded: (label) => `${label} loaded`,
  empty: 'No data for this range',
  allHidden: 'Every series is hidden',
  showAll: (count) => `Show all ${count} series`,
  error: 'The chart couldn’t load',
  retry: 'Try again',
}

/** How values are written: Intl's number options, or a function of your own. */
type ChartFormat = Intl.NumberFormatOptions | ((value: number) => string)

/** The series' colour as a CSS value, set on the chart as `--color-<key>`. */
function seriesColor(key: string) {
  return `var(--color-${key})`
}

/**
 * Each series' colour as `--color-<key>`, from its `color`, its `theme`, or
 * else the next of `--chart-1` to `--chart-5`, as shadcn's chart does. While
 * the chart changes size, nothing in it eases, so the bars keep up with the
 * axes.
 */
function ChartStyle({
  id,
  config,
  series,
}: {
  id: string
  config: ChartConfig
  series: readonly string[]
}) {
  const rule = (theme: 'light' | 'dark') =>
    series
      .map((key, slot) => {
        const entry = config[key]
        const color =
          entry?.theme?.[theme] ?? entry?.color ?? `var(--chart-${(slot % 5) + 1})`
        return `--color-${key}: ${color};`
      })
      .join(' ')
  return (
    // oxlint-disable-next-line react/no-danger -- the colours are the chart's own config
    <style
      dangerouslySetInnerHTML={{
        __html: `[data-chart='${id}'] { ${rule('light')} } .dark [data-chart='${id}'] { ${rule('dark')} } [data-chart='${id}'][data-resizing] * { transition-property: none; }`,
      }}
    />
  )
}

/**
 * The colour forced colours draw a series in, by its place: system colours
 * stand in for the chart's, five apart so neighbours differ.
 */
const forcedSeriesColors = [
  'forced-colors:bg-[CanvasText]',
  'forced-colors:bg-[Highlight]',
  'forced-colors:bg-[LinkText]',
  'forced-colors:bg-[GrayText]',
  'forced-colors:bg-[VisitedText]',
] as const

function forcedSeriesColor(slot: number) {
  return forcedSeriesColors[slot % forcedSeriesColors.length]
}

/** The same colours for a mark drawn in its text colour, such as a line. */
const forcedSeriesTextColors = [
  'forced-colors:text-[CanvasText]',
  'forced-colors:text-[Highlight]',
  'forced-colors:text-[LinkText]',
  'forced-colors:text-[GrayText]',
  'forced-colors:text-[VisitedText]',
] as const

function forcedSeriesTextColor(slot: number) {
  return forcedSeriesTextColors[slot % forcedSeriesTextColors.length]
}

/**
 * The patterns the chart's `patterns` hands out, in series order, the first
 * left plain: fine lines and dots that tell series apart in grey and in
 * print without fighting their colours.
 */
const patternOrder: readonly ChartPattern[] = [
  'solid',
  'diagonal',
  'dots',
  'stripes',
  'grid',
]

/**
 * A pattern's ink: the page's background, a little see-through, so it reads
 * as a lighter tone of a series' colour in light mode and a darker one in
 * dark.
 */
const ink = 'color-mix(in oklab, var(--background) 42%, transparent)'

/** A pattern's tile, in px: its lines are a px wide, this far apart. */
const PATTERN_TILE = 6

/** A swatch's tile, in px: finer, so a swatch shows a few of its lines. */
const SWATCH_TILE = 3

/**
 * The pattern as a `background-image` over the series' colour, or none, its
 * lines `tile` px apart: a swatch takes a finer one, so a few show in it.
 */
function patternImage(pattern: ChartPattern, tile = PATTERN_TILE): string | undefined {
  switch (pattern) {
    case 'stripes':
      return `repeating-linear-gradient(90deg, ${ink} 0 1px, transparent 1px ${tile}px)`
    case 'diagonal':
      return `repeating-linear-gradient(45deg, ${ink} 0 1px, transparent 1px ${tile / Math.SQRT2}px)`
    case 'dots':
      // Two dots a tile, staggered, so they sit evenly rather than in rows.
      return `radial-gradient(${ink} 0.9px, transparent 1.2px) 0 0 / ${tile}px ${tile}px, radial-gradient(${ink} 0.9px, transparent 1.2px) ${tile / 2}px ${tile / 2}px / ${tile}px ${tile}px`
    case 'grid':
      return `linear-gradient(${ink} 1px, transparent 1px) 0 0 / ${tile}px ${tile}px, linear-gradient(90deg, ${ink} 1px, transparent 1px) 0 0 / ${tile}px ${tile}px`
    default:
      return undefined
  }
}

/**
 * The same pattern for an SVG mark, as a `<pattern>` with the id `id`, drawn
 * over `currentColor` in px. `turn` undoes a rotation of the mark that uses
 * it, in degrees, so its lines run the way the swatches' do.
 */
function ChartSvgPattern({
  id,
  pattern,
  turn = 0,
}: {
  id: string
  pattern: ChartPattern
  turn?: number
}) {
  // A CSS gradient at 45deg runs its stripes down to the right, so the SVG's turn the other way.
  const angle = turn + (pattern === 'diagonal' ? -45 : 0)
  // Diagonal lines a tile apart across, as the gradient's are.
  const tile = pattern === 'diagonal' ? PATTERN_TILE / Math.SQRT2 : PATTERN_TILE
  const half = tile / 2
  return (
    <pattern
      id={id}
      width={tile}
      height={tile}
      patternUnits='userSpaceOnUse'
      patternTransform={angle === 0 ? undefined : `rotate(${angle})`}
    >
      <rect width={tile} height={tile} fill='currentColor' />
      {(pattern === 'stripes' || pattern === 'diagonal') && (
        <rect width={1} height={tile} style={{ fill: ink }} />
      )}
      {pattern === 'dots' && (
        <>
          <circle cx={0} cy={0} r={0.9} style={{ fill: ink }} />
          <circle cx={tile} cy={0} r={0.9} style={{ fill: ink }} />
          <circle cx={0} cy={tile} r={0.9} style={{ fill: ink }} />
          <circle cx={tile} cy={tile} r={0.9} style={{ fill: ink }} />
          <circle cx={half} cy={half} r={0.9} style={{ fill: ink }} />
        </>
      )}
      {pattern === 'grid' && (
        <>
          <rect width={tile} height={1} style={{ fill: ink }} />
          <rect width={1} height={tile} style={{ fill: ink }} />
        </>
      )}
    </pattern>
  )
}

/** A swatch of a series: its colour and its pattern, as the legend and the tooltip draw it. */
function swatchStyle(key: string, pattern: ChartPattern): CSSProperties {
  const image = patternImage(pattern, SWATCH_TILE)
  return {
    '--swatch': seriesColor(key),
    background: image ? `${image}, var(--swatch)` : undefined,
  } as CSSProperties
}

/**
 * One of the legend's toggles, which shows and hides `series`: its colour
 * fills the swatch while it shows. Pointing at it, or focusing it, asks for
 * its series to be brought forward. Every chart's legend is drawn from
 * these, so each looks and answers the same.
 */
function ChartLegendToggle({
  series,
  slot,
  shown,
  pattern,
  marker,
  onShownChange,
  onEmphasisChange,
  children,
}: {
  series: string
  /** The series' place, for its colour in forced colours. */
  slot: number
  shown: boolean
  pattern: ChartPattern
  /** The shape its marks take, as `markerOf` gives it, which the swatch takes in place of a square. */
  marker?: string
  onShownChange: (shown: boolean) => void
  /** Whether the series is pointed at or focused, so it can come forward. */
  onEmphasisChange: (emphasised: boolean) => void
  children: ReactNode
}) {
  return (
    <CutTooltip
      render={
        <TogglePrimitive
          pressed={shown}
          onPressedChange={onShownChange}
          onPointerEnter={() => onEmphasisChange(true)}
          onPointerLeave={() => onEmphasisChange(false)}
          onFocus={(event) => {
            if (event.currentTarget.matches(':focus-visible')) onEmphasisChange(true)
          }}
          onBlur={() => onEmphasisChange(false)}
          className={cn(
            buttonVariants({ variant: 'ghost', size: 'xs' }),
            'group/legend text-muted-foreground data-pressed:text-foreground gap-1.5 font-medium',
          )}
        >
          {marker ? (
            <svg
              aria-hidden
              viewBox='-1.2 -1.2 2.4 2.4'
              className={cn(
                'size-3 shrink-0 overflow-visible fill-transparent stroke-(--swatch) [stroke-width:1.5] transition-[fill] duration-(--motion-press-duration) ease-(--motion-press-fade-easing) [vector-effect:non-scaling-stroke] group-data-pressed/legend:fill-(--swatch)',
                forcedMarkerColors[slot % forcedMarkerColors.length],
              )}
              style={{ '--swatch': seriesColor(series) } as CSSProperties}
            >
              <path d={marker} vectorEffect='non-scaling-stroke' />
            </svg>
          ) : (
            <span
              aria-hidden
              className={cn(
                'size-2.5 shrink-0 rounded-[calc(var(--control-radius-xs)/2.5)] border-2 border-(--swatch) bg-transparent transition-[background-color] duration-(--motion-press-duration) ease-(--motion-press-fade-easing) group-data-pressed/legend:bg-(--swatch)',
                forcedSwatchColors[slot % forcedSwatchColors.length],
              )}
              style={swatchStyle(series, shown ? pattern : 'solid')}
            />
          )}
          <span data-cut className='truncate'>
            {children}
          </span>
        </TogglePrimitive>
      }
    />
  )
}

/**
 * A series' key beside words that name it, such as a value axis's title:
 * its colour and pattern in a square, or its marks' shape, as the legend's
 * pressed toggle draws it, and in forced colours, the series' system colour.
 */
function SeriesKey({
  series,
  slot,
  pattern,
  marker,
}: {
  series: string
  /** The series' place, for its colour in forced colours. */
  slot: number
  pattern: ChartPattern
  /** The shape its marks take, as `markerOf` gives it, in place of a square. */
  marker?: string
}) {
  return marker ? (
    <svg
      aria-hidden
      viewBox='-1.2 -1.2 2.4 2.4'
      className={cn(
        'size-3 shrink-0 overflow-visible fill-(--swatch)',
        forcedMarkerFills[slot % forcedMarkerFills.length],
      )}
      style={{ '--swatch': seriesColor(series) } as CSSProperties}
    >
      <path d={marker} />
    </svg>
  ) : (
    <span
      aria-hidden
      className={cn(
        'size-2.5 shrink-0 rounded-[calc(var(--control-radius-xs)/2.5)] bg-(--swatch)',
        forcedSeriesColor(slot),
      )}
      style={swatchStyle(series, pattern)}
    />
  )
}

/**
 * A toggle for each of `series`, as every chart's legend draws them: one
 * pressed off hides its series, and pointing at or focusing one that shows
 * brings it forward.
 */
function ChartLegendToggles({
  series,
  labelOf,
  patternOf,
  markerOf,
  hidden,
  onHiddenChange,
  onEmphasisChange,
}: {
  series: readonly string[]
  labelOf: (key: string) => ReactNode
  patternOf: (key: string) => ChartPattern
  markerOf?: (key: string) => string | undefined
  hidden: readonly string[]
  onHiddenChange: (hidden: string[]) => void
  /** The series brought forward, or null for none. */
  onEmphasisChange: (key: string | null) => void
}) {
  return series.map((key, slot) => {
    const shown = !hidden.includes(key)
    return (
      <ChartLegendToggle
        key={key}
        series={key}
        slot={slot}
        shown={shown}
        pattern={patternOf(key)}
        marker={markerOf?.(key)}
        onShownChange={(pressed) => {
          onHiddenChange(pressed ? hidden.filter((k) => k !== key) : [...hidden, key])
          onEmphasisChange(pressed ? key : null)
        }}
        onEmphasisChange={(emphasised) =>
          onEmphasisChange(emphasised && shown ? key : null)
        }
      >
        {labelOf(key)}
      </ChartLegendToggle>
    )
  })
}

/** The legend's swatch in forced colours: its outline always, its fill while the series shows. */
const forcedSwatchColors = [
  'forced-colors:border-[CanvasText] forced-colors:group-data-pressed/legend:bg-[CanvasText]',
  'forced-colors:border-[Highlight] forced-colors:group-data-pressed/legend:bg-[Highlight]',
  'forced-colors:border-[LinkText] forced-colors:group-data-pressed/legend:bg-[LinkText]',
  'forced-colors:border-[GrayText] forced-colors:group-data-pressed/legend:bg-[GrayText]',
  'forced-colors:border-[VisitedText] forced-colors:group-data-pressed/legend:bg-[VisitedText]',
] as const

/** The same for a swatch drawn as a marker's shape, which an SVG strokes and fills. */
const forcedMarkerColors = [
  'forced-colors:stroke-[CanvasText] forced-colors:group-data-pressed/legend:fill-[CanvasText]',
  'forced-colors:stroke-[Highlight] forced-colors:group-data-pressed/legend:fill-[Highlight]',
  'forced-colors:stroke-[LinkText] forced-colors:group-data-pressed/legend:fill-[LinkText]',
  'forced-colors:stroke-[GrayText] forced-colors:group-data-pressed/legend:fill-[GrayText]',
  'forced-colors:stroke-[VisitedText] forced-colors:group-data-pressed/legend:fill-[VisitedText]',
] as const

/** The series' system colours for a marker that stands alone, beside an axis's title or in the tooltip. */
const forcedMarkerFills = [
  'forced-colors:fill-[CanvasText]',
  'forced-colors:fill-[Highlight]',
  'forced-colors:fill-[LinkText]',
  'forced-colors:fill-[GrayText]',
  'forced-colors:fill-[VisitedText]',
] as const

/**
 * The chart's frame: an optional legend above and below, an axis on each
 * side of the plot, and the plot. Every part takes its own area, and the
 * plot's layers share one.
 */
const chartFrameClassName =
  'group/chart @container/chart relative isolate grid h-72 min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] grid-rows-[auto_auto_minmax(0,1fr)_auto_auto] [grid-template-areas:"top_top_top"_"._top-axis_."_"start-axis_plot_end-axis"_"._bottom-axis_."_"bottom_bottom_bottom"] text-xs'

/** A tooltip row's quieter text, in full colour on the row of the series brought forward. */
const tooltipQuietClassName =
  'text-background/75 transition-colors duration-(--motion-layout-duration) ease-(--motion-layout-fade-easing) group-data-lit/row:text-background forced-colors:text-[CanvasText]'

/**
 * Text written on a mark, such as a slice's or a tile's label: near white or
 * near black, whichever reads on the mark's colour, `--label-on`; in forced
 * colours, the page's text on a box of its own.
 */
const labelOnClassName =
  'text-[oklch(from_var(--label-on)_clamp(0.15,(0.6-l)*1000,0.99)_0_0)] forced-colors:rounded-(--control-radius-xs) forced-colors:bg-[Canvas] forced-colors:px-1 forced-colors:text-[CanvasText]'

/** A series' colour beside its name in a tooltip, on its `--swatch` (`swatchStyle`). */
const swatchClassName =
  'size-2 shrink-0 rounded-[calc(var(--control-radius-xs)/4)] bg-(--swatch)'

/**
 * The size a chart draws at: its plot's, or before the plot is measured, as
 * on the page's first paint from the server, a stand-in that its SVGs fit to
 * the plot with `drawingFrame`, so the marks show from the first frame.
 */
function drawingSize(size: { width: number; height: number }) {
  return size.width > 0 && size.height > 0 ? size : UNMEASURED
}

/**
 * An SVG's frame for `drawingSize`: none once the plot is measured, else the
 * stand-in fitted to the plot, stretched (`none`) for marks whose shape follows
 * the plot's, such as lines, or kept square (`xMidYMid meet`), such as a ring.
 */
function drawingFrame(
  size: { width: number; height: number },
  fit: 'none' | 'xMidYMid meet',
) {
  return size.width > 0 && size.height > 0
    ? {}
    : {
        viewBox: `0 0 ${UNMEASURED.width} ${UNMEASURED.height}`,
        preserveAspectRatio: fit,
      }
}

/** About a plot's size, so what a chart draws in pixels, such as a ring's gaps, starts out near it. */
const UNMEASURED = { width: 240, height: 240 }

/** A layer of the plot: the size of the plot, and the box its insets are measured in. */
const plotLayerClassName =
  'pointer-events-none relative min-h-0 min-w-0 [grid-area:plot] [container-type:size]'

/**
 * Whether the chart has come into view, so its entrance plays then and not on
 * a page that loads with it out of sight. `skip` is there at once.
 */
function useEntered(ref: { current: Element | null }, skip: boolean) {
  const [entered, setEntered] = useState(skip)
  useEffect(() => {
    const element = ref.current
    if (entered || !element) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          // A frame after it is first painted, so the bars rise from the baseline.
          requestAnimationFrame(() => setEntered(true))
          observer.disconnect()
        }
      },
      { threshold: 0.3 },
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [entered, ref])
  return entered
}

/**
 * Marks `root` with `data-resizing` while it changes size after it is
 * first laid out, and for two frames after, which stops every transition in
 * it: a size change moves everything by the same amount at once, rather
 * than easing the bars behind the axes. Only the chart's own size counts: the
 * plot also changes size when new values widen the value axis, and that move
 * eases with the rest. A chart whose height comes from its data, such as a
 * grid of cells growing a row or its legend arriving, counts only a change
 * of width, so its data still arrives as it moves.
 */
function useResizing(root: RefObject<HTMLElement | null>, widthOnly: boolean) {
  useEffect(() => {
    const element = root.current
    if (!element) return
    let width: number | null = null
    let frame = 0
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return
      const was = width
      width = entry.contentRect.width
      if (was === null || (widthOnly && was === width)) return
      element.dataset.resizing = ''
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(() => {
          delete element.dataset.resizing
        })
      })
    })
    observer.observe(element)
    return () => {
      observer.disconnect()
      cancelAnimationFrame(frame)
    }
  }, [root, widthOnly])
}

/** An element's size in px, kept up to date. */
function useSize(ref: RefObject<HTMLElement | null>) {
  const [size, setSize] = useState({ width: 0, height: 0 })
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const { width, height } = element.getBoundingClientRect()
    setSize({ width, height })
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return
      const { width, height } = entry.contentRect
      setSize((was) =>
        was.width === width && was.height === height ? was : { width, height },
      )
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref])
  return size
}

/**
 * A value that rolls to each new one: digit by digit for Intl's options,
 * crossfading for a format of your own, such as a bar list's values or a
 * funnel's rates.
 */
function ChartNumber({
  value,
  format,
  locale,
}: {
  value: number
  format: ChartFormat | undefined
  locale: Intl.LocalesArgument
}) {
  if (typeof format === 'function') {
    return (
      <Swap align='end'>
        <span>{format(value)}</span>
      </Swap>
    )
  }
  return <AnimatedNumber value={value} locale={locale} format={format} />
}

/** The formatter of `format`: a function of yours, or Intl's options, once per locale. */
function formatterOf(
  locale: Intl.LocalesArgument,
  format: ChartFormat | undefined,
): (value: number) => string {
  if (typeof format === 'function') return format
  const formatter = numberFormatter(locale, format)
  return (value) => formatter.format(value)
}

/**
 * Charts in a group share the category under the pointer by its key, so
 * pointing at a day on one chart lights that day on the others, as the
 * dashboards of a product compare one day across several charts.
 */
const ChartGroupContext = createContext<{
  active: string | null
  setActive: (key: string | null) => void
} | null>(null)

function ChartGroup({ children }: { children: ReactNode }) {
  const [active, setActive] = useState<string | null>(null)
  const value = useMemo(() => ({ active, setActive }), [active])
  return <ChartGroupContext value={value}>{children}</ChartGroupContext>
}

/** The group the chart is in, or null for a chart on its own. */
function useChartGroup() {
  return use(ChartGroupContext)
}

function percent(locale: Intl.LocalesArgument) {
  return numberFormatter(locale, {
    style: 'percent',
    maximumFractionDigits: 0,
  })
}

/** A change since the category before, as a share: `▲ 22%`, `▼ 4%`, or `0%` for none. */
function ChangeText({
  change,
  locale,
  format,
  className,
}: {
  change: number | null
  locale: Intl.LocalesArgument
  /** Writes the size of the change; a share by default, such as `12%`. */
  format?: (size: number) => string
  className?: string
}) {
  if (change === null) return null
  const size = format
    ? format(Math.abs(change))
    : percent(locale).format(Math.abs(change))
  // A change too small to write as more than zero takes no arrow, which would say it moved.
  const moved = /[1-9]/.test(size)
  return (
    // Sign and number read left to right in either direction, as a number does.
    <span dir='ltr' className={cn('text-[0.625rem] tabular-nums', className)}>
      {moved && change > 0 ? '▲ ' : moved && change < 0 ? '▼ ' : ''}
      {size}
    </span>
  )
}

/** The part of a chart that scrolls sideways that its marks show in: inside the axes that stay at its sides. */
function inView(frame: HTMLElement): { left: number; right: number } {
  const view = frame.getBoundingClientRect()
  let { left, right } = view
  const middle = (view.left + view.right) / 2
  for (const axis of frame.querySelectorAll(
    ':scope > [data-side=start], :scope > [data-side=end]',
  )) {
    const box = axis.getBoundingClientRect()
    if (box.right <= middle) left = Math.max(left, box.right)
    else right = Math.min(right, box.left)
  }
  return { left, right }
}

/**
 * Measures text in the chart's own font, at medium weight, as its labels
 * are written; measured again once the page's fonts load. Before the chart
 * is drawn, it guesses from the number of characters.
 */
function useTextWidth(root: RefObject<HTMLElement | null>) {
  const [font, setFont] = useState<string | null>(null)
  useLayoutEffect(() => {
    const element = root.current
    if (!element) return
    let live = true
    const read = () => {
      if (!live) return
      const style = getComputedStyle(element)
      setFont(`500 ${style.fontSize} ${style.fontFamily}`)
    }
    read()
    void document.fonts?.ready.then(read)
    return () => {
      live = false
    }
  }, [root])
  return useMemo(() => textMeasure(font), [font])
}

/** Measures text in `font`, remembering each width; an estimate until the font is known. */
function textMeasure(font: string | null) {
  const context = font ? document.createElement('canvas').getContext('2d') : null
  if (context && font) context.font = font
  const widths = new Map<string, number>()
  return (text: string) => {
    if (!context) return labelLength(text) - 12
    let width = widths.get(text)
    if (width === undefined) {
      width = context.measureText(text).width
      widths.set(text, width)
    }
    return width
  }
}

function useChartId() {
  return useId().replaceAll(':', '')
}

/*
 * Moves. The root owns every move: whatever changes in one commit, such as
 * new data, a series hidden or the entrance, starts one run of the chart's
 * clock, a Web Animation timed by the feel's roles. Marks that move in a
 * straight line in CSS keep their own transitions on the same roles; what
 * redraws each frame, such as a line's path, follows the run's progress;
 * and what leaves is let go when the run ends. Nothing waits on a CSS
 * property by name.
 */

/** The roles a chart's marks move on. */
type MoveRole = 'enter' | 'exit' | 'layout' | 'draw'

const MOVE_ROLES: readonly MoveRole[] = ['enter', 'exit', 'layout', 'draw']

/** A role's timing where `element` is, from the feel's variables, or null for one that doesn't run. */
function roleTiming(style: CSSStyleDeclaration, role: MoveRole) {
  const duration = durationOf(style.getPropertyValue(`--motion-${role}-duration`))
  if (duration === null || duration <= 0) return null
  return {
    duration,
    easing: style.getPropertyValue(`--motion-${role}-easing`).trim() || 'linear',
  }
}

/** A clock for the length of a run, which the playground's Speed retimes as it does CSS. */
function playClock(target: Element, timing: KeyframeEffectOptions) {
  const clock = new Animation(new KeyframeEffect(target, null, timing), document.timeline)
  clock.id = FOLLOWS_TRANSITION
  clock.play()
  return clock
}

/** How far a clock is through its role, 0 to 1 on its easing. */
function clockProgress(clock: Animation) {
  if (clock.playState === 'finished') return 1
  return clock.effect?.getComputedTiming().progress ?? 0
}

/** A run of the clock that a part follows. */
interface MoveRun {
  /** How far along it is, 0 to 1 on its role's easing. */
  progress: () => number
  /** Whether its role's clock is still running, stopped or not. */
  running: () => boolean
}

type Draw = (progress: number, done: boolean) => void

interface Follower {
  role: MoveRole
  draw: Draw
  clock: Animation | null
  stopped: boolean
}

interface PendingRun {
  span: number
  ends: { resolve: () => void; travels: boolean }[]
  followers: Follower[]
}

/**
 * The chart's moves: one run of its clock for each commit in which
 * something moves. A part asks in its layout effect, and the run starts once
 * the commit is done, in the same frame as the CSS transitions it started.
 */
interface ChartMoves {
  /**
   * Moves with this commit, its marks starting one after another over
   * `span` of their role's duration. Resolves once the longest role has
   * run, cascade and all, so everything has arrived or gone. A move that
   * `travels`, such as an entrance, ends at once where motion is reduced,
   * since travel goes; one with something fading out waits for the fade.
   */
  request: (span?: number, travels?: boolean) => Promise<void>
  /**
   * Draws with this commit's run, on `role`'s timing: `draw` gets each
   * frame's progress, then 1 and `done`. Where motion is reduced it gets 1
   * at once, since travel goes. Stopped, it draws no more.
   */
  follow: (role: MoveRole, draw: Draw) => { run: MoveRun; stop: () => void }
}

function createChartMoves(figure: RefObject<HTMLElement | null>): ChartMoves {
  let pending: PendingRun | null = null
  const queue = () => {
    if (pending) return pending
    const next: PendingRun = { span: 0, ends: [], followers: [] }
    pending = next
    queueMicrotask(() => {
      pending = null
      start(next)
    })
    return next
  }
  return {
    request: (span = 0, travels = false) => {
      const run = queue()
      run.span = Math.max(run.span, span)
      return new Promise((resolve) => run.ends.push({ resolve, travels }))
    },
    follow: (role, draw) => {
      const follower: Follower = { role, draw, clock: null, stopped: false }
      queue().followers.push(follower)
      return {
        run: {
          progress: () => (follower.clock ? clockProgress(follower.clock) : 0),
          running: () =>
            follower.clock !== null && follower.clock.playState !== 'finished',
        },
        stop: () => {
          follower.stopped = true
        },
      }
    },
  }

  function start({ span, ends, followers }: PendingRun) {
    const element = figure.current
    const reduced = element !== null && reducesMotion(element)
    const end = (all: boolean) => {
      for (const { resolve, travels } of ends) if (all || travels) resolve()
    }
    if (!element) {
      end(true)
      for (const follower of followers) if (!follower.stopped) follower.draw(1, true)
      return
    }
    const style = getComputedStyle(element)
    const longest = Math.max(
      0,
      ...MOVE_ROLES.map((role) => roleTiming(style, role)?.duration ?? 0),
    )
    const whole = moveTiming(
      longest > 0 ? { duration: longest, easing: 'linear' } : null,
      span,
    )
    if (reduced) end(false)
    if (whole) {
      void playClock(element, {
        duration: whole.duration,
        endDelay: whole.endDelay,
      }).finished.then(
        () => end(true),
        () => undefined,
      )
    } else end(true)
    const clocks = new Map<MoveRole, Animation | null>()
    for (const follower of followers) {
      if (!clocks.has(follower.role)) {
        const timing = reduced ? null : roleTiming(style, follower.role)
        clocks.set(follower.role, timing && playClock(element, timing))
      }
      follower.clock = clocks.get(follower.role) ?? null
    }
    const frame = () => {
      let moving = false
      for (const follower of followers) {
        if (follower.stopped) continue
        const { clock } = follower
        const done = clock === null || clock.playState === 'finished'
        follower.draw(done ? 1 : travelOf(clockProgress(clock), reduced), done)
        if (done) follower.stopped = true
        else moving = true
      }
      if (moving) requestAnimationFrame(frame)
    }
    frame()
  }
}

/**
 * What has left `items` and is still leaving: kept, with what it last
 * showed, until the move it left in has ended, however often another change
 * turns it round on the way. Items are told apart by `keyOf`.
 */
function useLeaving<T>(
  moves: ChartMoves,
  items: readonly T[],
  keyOf: (item: T) => string,
): readonly T[] {
  const signature = items.map(keyOf).join('\u0000')
  const [state, setState] = useState({
    signature,
    items,
    leaving: [] as readonly T[],
    change: 0,
  })
  if (state.signature !== signature) {
    setState({
      signature,
      items,
      leaving: leavingAfter(state.items, items, state.leaving, keyOf),
      change: state.change + 1,
    })
  }
  const { change, leaving } = state
  const waiting = leaving.length > 0
  useLayoutEffect(() => {
    if (!waiting) return
    let live = true
    void moves.request().then(() => {
      if (live) setState((was) => (was.change === change ? { ...was, leaving: [] } : was))
    })
    return () => {
      live = false
    }
  }, [moves, waiting, change])
  return state.signature === signature ? leaving : []
}

/** How a set of points moves: what pairs them up, and where they are part way. */
interface PointsMove<Point, Moves> {
  /** Matches the points drawn now, `from`, with those they move to. */
  align: (from: readonly Point[], to: readonly Point[]) => Moves
  /** Where the points are `progress` of the way through `moves`. */
  at: (moves: Moves, progress: number) => readonly Point[]
  /** Draws the points; `moving` while a move is under way. */
  draw: (points: readonly Point[], moving: boolean) => void
}

/**
 * Moves a set of points, such as a line's or a shape's, to `to` whenever
 * they change, `signature` telling one set from the next: from wherever
 * they are drawn, even halfway through a move, with the chart's moves on
 * `role`. The first set, and any before the chart has painted, are drawn
 * where they are; with none drawn yet, a move starts from `start`. A new
 * `redraw` alone, such as a new size, draws again at once, mid-move too.
 */
function usePointsMove<Point, Moves>(
  role: MoveRole,
  to: readonly Point[],
  signature: string,
  start: readonly Point[],
  redraw: string,
  move: PointsMove<Point, Moves>,
) {
  const { moves, root } = useChartRootValue()
  // The move under way, or the last: its points matched up, where it goes, and its run.
  const state = useRef<{
    moves: Moves
    to: readonly Point[]
    run: MoveRun | null
  } | null>(null)
  const mounting = useRef(true)
  const latest = useRef(move)
  useLayoutEffect(() => {
    latest.current = move
  })
  useLayoutEffect(() => {
    const atMount = mounting.current
    mounting.current = false
    const was = state.current
    // Points not drawn, while the chart loads or is empty, start again from `start`.
    if (to.length === 0) {
      state.current = null
      return
    }
    // From where they are drawn mid-move; at rest from where they went, so the points that came
    // in only to grow or fold a part don't stay and pile up from move to move.
    const shown = !was
      ? []
      : was.run?.running()
        ? latest.current.at(was.moves, was.run.progress())
        : was.to
    const matched = latest.current.align(shown.length > 0 ? shown : start, to)
    // A chart that loads with its data shows its points where they are, with no move, until it
    // has painted: the value axis may still settle on its ticks as the page hydrates.
    if (atMount || !root.current?.closest('[data-mounted]')) {
      state.current = { moves: matched, to, run: null }
      latest.current.draw(to, false)
      return
    }
    const { run, stop } = moves.follow(role, (progress, done) =>
      done
        ? latest.current.draw(to, false)
        : latest.current.draw(latest.current.at(matched, progress), true),
    )
    state.current = { moves: matched, to, run }
    return stop
    // The points are compared by their signature, so a new array of the same points moves nothing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature])
  // A new `redraw` with no new points draws where they are: on their way, mid-move.
  useLayoutEffect(() => {
    const under = state.current?.run?.running() ? state.current : null
    if (under?.run)
      latest.current.draw(latest.current.at(under.moves, under.run.progress()), true)
    else latest.current.draw(to, false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [redraw])
}

/**
 * `value` as it was before the last change to `key`, so what arrives can
 * start where the old value put it, such as a tick from where the old range
 * had it.
 */
function useBefore<T>(value: T, key: string): T {
  const [state, setState] = useState({ key, value, before: value })
  if (state.key !== key) setState({ key, value, before: state.value })
  return state.key === key ? state.before : state.value
}

/**
 * Whether what is lit now was lit from rest, for a frame: what marks it then
 * appears in place, since after a rest there is no move to explain, and
 * glides from there on. A rest begins once the last lit mark has finished
 * leaving, at the end of the move it left in, so a pointer that comes back
 * while it still fades glides on from where it is.
 */
function useFromRest(spotlit: unknown) {
  const moves = useChartMoves()
  const [fromRest, setFromRest] = useState(false)
  const previous = useRef(spotlit)
  const rested = useRef(true)
  const lit = spotlit !== null
  useLayoutEffect(() => {
    const before = previous.current
    previous.current = spotlit
    if (spotlit === null) {
      if (before === null) return
      rested.current = false
      let live = true
      void moves.request().then(() => {
        if (live) rested.current = true
      })
      return () => {
        live = false
      }
    }
    setFromRest(before === null && rested.current)
    return undefined
    // Only lighting and letting go count, not a move from one mark to the next.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lit, moves])
  useEffect(() => {
    if (!fromRest) return
    const frame = requestAnimationFrame(() => setFromRest(false))
    return () => cancelAnimationFrame(frame)
  }, [fromRest])
  return fromRest
}

/** The props every chart takes on its root, whatever its shape. */
interface ChartRootProps {
  config: ChartConfig
  /** What the chart shows, for screen readers: a short title, such as "Visitors by month". */
  label: string
  /** How values are written in the tooltip, the labels and the table. */
  format?: ChartFormat
  /** The locale numbers are written in. Give one, so the server and the browser agree. */
  locale?: Intl.LocalesArgument
  /** Gives each series after the first a pattern over its colour, so series differ by more than colour. */
  patterns?: boolean
  /** The series hidden, for a legend you control. */
  hiddenSeries?: string[]
  defaultHiddenSeries?: string[]
  onHiddenSeriesChange?: (hidden: string[]) => void
  /** The data couldn't load: `true` for the chart's own words, or what to say. */
  error?: ReactNode
  /** Shows a button that tries again, with `error`. */
  onRetry?: () => void
  /** Every word the chart says or reads out, for a chart in another language. */
  messages?: Partial<ChartMessages>
}

/** What a root keeps whatever the chart's shape, before its family adds its reader. */
interface ChartRootState {
  id: string
  label: string
  config: ChartConfig
  /** Every series key, in the order written in the config. */
  series: readonly string[]
  hidden: readonly string[]
  setHidden: (keys: string[]) => void
  /** The series brought forward by the legend, or by what the pointer or the keys are on. */
  emphasis: string | null
  setEmphasis: (key: string | null) => void
  direction: ReadingDirection
  locale: Intl.LocalesArgument
  format: ChartFormat | undefined
  /** A value as the chart's `format` writes it. */
  valueText: (value: number) => string
  messages: ChartMessages
  error: ReactNode
  onRetry: (() => void) | null
  patternOf: (key: string) => ChartPattern
  /** The figure. */
  root: RefObject<HTMLElement | null>
  /** The plot's box: the layer that takes the pointer, as large as the plot. */
  plot: RefObject<HTMLElement | null>
  /** The plot's size in px, once measured. */
  plotSize: { width: number; height: number }
  /** How wide `text` is in px, in the chart's medium-weight text. */
  textWidth: (text: string) => number
  /** Whether the chart has come into view, or doesn't wait to. */
  seen: boolean
  tooltip: TooltipPrimitive.Handle<undefined>
  moves: ChartMoves
}

/**
 * Everything a chart keeps whatever its shape: its series and what is hidden
 * and brought forward, its words and how it writes values, its figure and
 * plot and their size, its tooltip and its moves. `entrance` waits for the
 * chart to come into view; `heightFromData` counts only a change of width as
 * a resize, for a chart whose height comes from its data.
 */
function useChartRoot(
  props: ChartRootProps,
  { entrance, heightFromData }: { entrance: boolean; heightFromData: boolean },
): ChartRootState {
  const {
    config,
    label,
    format,
    locale,
    patterns = false,
    hiddenSeries,
    defaultHiddenSeries = [],
    onHiddenSeriesChange,
    error,
    onRetry,
    messages,
  } = props
  const id = useChartId()
  const direction = useDirection()
  // The figure, which the moves read once each run starts, never while rendering.
  const [root] = useState<RefObject<HTMLElement | null>>(() => ({
    current: null,
  }))
  const plot = useRef<HTMLElement | null>(null)
  const plotSize = useSize(plot)
  const [tooltip] = useState(() => TooltipPrimitive.createHandle<undefined>())
  const [moves] = useState(() => createChartMoves(root))
  const series = Object.keys(config)
  const [hidden, setHidden] = useControllable(
    hiddenSeries,
    defaultHiddenSeries,
    onHiddenSeriesChange,
  )
  const [emphasis, setEmphasis] = useState<string | null>(null)
  useResizing(root, heightFromData)
  const textWidth = useTextWidth(root)
  const seen = useEntered(root, !entrance)
  return {
    id,
    label,
    config,
    series,
    hidden,
    setHidden,
    emphasis,
    setEmphasis,
    direction,
    locale,
    format,
    valueText: formatterOf(locale, format),
    messages: { ...defaultMessages, ...messages },
    error,
    onRetry: onRetry ?? null,
    patternOf: (key) =>
      config[key]?.pattern ??
      (patterns
        ? (patternOrder[series.indexOf(key) % patternOrder.length] ?? 'solid')
        : 'solid'),
    root,
    plot,
    plotSize,
    textWidth,
    seen,
    tooltip,
    moves,
  }
}

/** Everything the root shows from: what it keeps, and what the chart's family adds. */
interface ChartRootValue extends ChartRootState {
  status: ChartStatus
  reader: ChartReader
  /** The shape a series' marks take, such as a scatter's points, which its legend swatch takes; null for a plain swatch. */
  markerOf: (key: string) => string | null
  /** Whether a press, Enter or Space picks what it is on. */
  selectable: boolean
  picked: ChartTarget | null
  /** Picks `target`, or lets it go if it was picked. */
  togglePicked: (target: ChartTarget) => void
}

const ChartRootContext = createContext<ChartRootValue | null>(null)

function useChartRootValue() {
  const value = use(ChartRootContext)
  if (!value) throw new Error('Chart parts go inside a chart, such as a `BarChart`.')
  return value
}

function useChartMoves() {
  return useChartRootValue().moves
}

/**
 * What the pointer, the focus or the keys are on, kept apart from the rest
 * of the chart, so a hover re-renders only the parts that show it.
 */
interface ChartFocusValue {
  focus: ChartTarget | null
  setFocus: (target: ChartTarget | null) => void
  /** What stays bright: what the focus is on, or else what is picked. */
  spotlit: ChartTarget | null
}

const ChartFocusContext = createContext<ChartFocusValue | null>(null)

function useChartFocus() {
  const value = use(ChartFocusContext)
  if (!value) throw new Error('Chart parts go inside a chart, such as a `BarChart`.')
  return value
}

/** The focus for a chart you control: yours, and what to tell when it moves. */
interface ChartFocusProps {
  /** Yours, or undefined for the chart's own. */
  focus: ChartTarget | null | undefined
  defaultFocus: ChartTarget | null
  onFocusChange: (target: ChartTarget | null) => void
}

/**
 * Keeps the focus: yours, or the group's by its key, or the chart's own,
 * held by key so new data keeps it, and let go when its key leaves the
 * chart. What the focus is on brings its series forward.
 */
function ChartFocus({
  root,
  focus: yours,
  defaultFocus,
  onFocusChange,
  children,
}: ChartFocusProps & { root: ChartRootValue; children: ReactNode }) {
  const { reader, picked, setEmphasis } = root
  const group = use(ChartGroupContext)
  const grouped = group !== null && yours === undefined
  const [own, setOwn] = useState(defaultFocus)
  const resolved = resolveFocus(own, yours, grouped ? group.active : undefined)
  const focus = resolved !== null && reader.holds(resolved) ? resolved : null
  const set = (next: ChartTarget | null) => {
    setEmphasis(next === null ? null : reader.lights(next))
    const kept = next !== null && reader.holds(next) ? next : null
    if (sameTarget(kept, focus)) return
    if (grouped) group.setActive(kept === null || kept.kind === 'node' ? null : kept.key)
    setOwn(kept)
    onFocusChange(kept)
  }
  // Yours to keep, when you pass it; the group's is held by key already.
  const gone = own !== null && !reader.holds(own)
  useLayoutEffect(() => {
    if (!gone || yours !== undefined || grouped) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- new data took the key away, and the change is told as it lands, so it is let go here, not in render
    setOwn(null)
    onFocusChange(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gone, yours, grouped])
  // One function for the chart's life, so parts that take it redraw only when what they
  // show changes, without the React Compiler.
  const latest = useRef(set)
  useLayoutEffect(() => {
    latest.current = set
  })
  const setFocus = useCallback((next: ChartTarget | null) => latest.current(next), [])
  const spotlit = focus ?? (picked !== null && reader.holds(picked) ? picked : null)
  const focusKey = focus === null ? null : JSON.stringify(focus)
  const spotlitKey = spotlit === null ? null : JSON.stringify(spotlit)
  const value = useMemo(
    () => ({ focus, setFocus, spotlit }),
    // Compared by what they are on, so a new object for the same target renders nothing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [focusKey, setFocus, spotlitKey],
  )
  return <ChartFocusContext value={value}>{children}</ChartFocusContext>
}

/** Half the width the keys bring into view around a mark of a chart that scrolls, in px. */
const REVEAL_HALF = 8

/** Where the pointer is on the plot: in px from its top left, with its size. */
function plotPointOf(event: {
  clientX: number
  clientY: number
  currentTarget: HTMLElement
}) {
  const box = event.currentTarget.getBoundingClientRect()
  return {
    x: event.clientX - box.left,
    y: event.clientY - box.top,
    width: box.width,
    height: box.height,
  }
}

/**
 * The layer that takes the pointer and the keys. By keyboard the plot is one
 * stop, a slider over what the reader reaches, as the WAI-ARIA slider
 * pattern has it: the reader says where each key goes, and a screen reader
 * hears what each stop holds as the slider's value. With things to pick, a
 * press, Enter or Space picks the one reached. The tooltip's one trigger
 * fills it.
 */
function ChartBrowse({ reader }: { reader: ChartBrowseReader }) {
  const {
    reader: { holds },
    status,
    messages,
    plot,
    selectable,
    picked,
    togglePicked,
    tooltip,
    id,
  } = useChartRootValue()
  const { focus, setFocus } = useChartFocus()
  // Where the keys start from when focus comes back: the last stop they reached.
  const [last, setLast] = useState<ChartTarget | null>(null)
  // Whether the keys opened something, so they start again from its first stop once it shows.
  const [restart, setRestart] = useState(false)
  const ready = status === 'ready'
  const held = (target: ChartTarget | null) =>
    target !== null && holds(target) ? target : null
  const resting = held(last) ?? held(picked) ?? reader.start
  const reached = focus ?? resting
  useLayoutEffect(() => {
    if (!restart) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the first stop is the new view's, known once the zoom has rendered
    setRestart(false)
    setLast(null)
    setFocus(reader.start)
  }, [restart, reader, setFocus])
  // In a chart that scrolls sideways, the keys bring the mark they reach into view, clear of
  // the axes that stay at its sides; the pointer only lights what is already in view.
  const anchor = focus === null ? null : reader.anchor(focus)
  const anchorX = anchor?.x ?? null
  const focusKey = focus === null ? null : targetKey(focus)
  const revealed = useRef<string | null>(null)
  useEffect(() => {
    if (focusKey === revealed.current) return
    revealed.current = focusKey
    const element = plot.current
    const frame = element?.parentElement
    if (anchorX === null || !element || !frame || !element.matches(':focus-visible'))
      return
    if (frame.scrollWidth <= frame.clientWidth) return
    const box = element.getBoundingClientRect()
    const x = box.left + anchorX * box.width
    frame.scrollTo({
      // From where it is now, so a glide still running for the last key is replaced.
      left:
        frame.scrollLeft +
        revealBy(inView(frame), {
          left: x - REVEAL_HALF,
          right: x + REVEAL_HALF,
        }),
      behavior: revealBehavior(frame),
    })
  }, [focusKey, anchorX, plot])

  const point = (event: {
    clientX: number
    clientY: number
    currentTarget: HTMLElement
  }) => {
    if (!ready) return
    const target = reader.targetAt(plotPointOf(event))
    setFocus(target)
    // The keys come back to where the pointer was, without the series it was over.
    const rest =
      target?.kind === 'datum' ? { kind: 'x' as const, key: target.key } : target
    if (held(rest)) setLast(rest)
  }

  const className = cn(
    'focus-visible:ring-ring/50 relative z-30 min-h-0 min-w-0 rounded-(--control-radius-capped) focus-visible:outline-hidden [grid-area:plot] focus-visible:ring-3 group-data-scrolls/chart:focus-visible:ring-inset',
    reader.orientation === 'horizontal' ? 'touch-pan-y' : 'touch-pan-x',
  )
  // The slider only while there is something to step through, so a screen reader doesn't
  // find a disabled one beside the note that says why.
  if (!ready) {
    return (
      <div
        ref={plot as Ref<HTMLDivElement>}
        tabIndex={-1}
        data-slot='chart-columns'
        data-chart-plot=''
        className={className}
      />
    )
  }

  return (
    <div
      ref={plot as Ref<HTMLDivElement>}
      role='slider'
      tabIndex={0}
      aria-label={messages.browse}
      aria-orientation={reader.orientation}
      aria-valuemin={1}
      aria-valuemax={Math.max(1, reader.stops)}
      aria-valuenow={reached === null ? 1 : reader.rank(reached)}
      aria-valuetext={reached === null ? '' : reader.describe(reached)}
      data-slot='chart-columns'
      data-chart-plot=''
      className={className}
      onPointerMove={point}
      onPointerDown={point}
      onPointerLeave={(event) => {
        if (event.pointerType === 'mouse') setFocus(null)
      }}
      onClick={(event) => {
        if (!ready) return
        const target = reader.targetAt(plotPointOf(event))
        const zoom = target === null ? null : reader.open(target)
        if (zoom) {
          zoom()
          return
        }
        if (!selectable) return
        if (held(target)) togglePicked(target as ChartTarget)
      }}
      onFocus={(event) => {
        if (ready && event.currentTarget.matches(':focus-visible')) setFocus(resting)
      }}
      onBlur={() => setFocus(null)}
      onKeyDown={(event) => {
        if (!ready || reached === null) return
        if (event.key === 'Escape' && focus !== null) {
          // Only the tooltip closes, not a dialog or popover the chart sits in.
          event.preventDefault()
          event.stopPropagation()
          setFocus(null)
          return
        }
        if (event.key === 'Escape' && reader.back) {
          event.preventDefault()
          event.stopPropagation()
          reader.back()
          setLast(null)
          return
        }
        if (event.key === 'Enter' || event.key === ' ') {
          const zoom = reader.open(reached)
          if (zoom) {
            event.preventDefault()
            zoom()
            setRestart(true)
            return
          }
        }
        const next = reader.step(reached, event.key)
        if (next !== null) {
          event.preventDefault()
          setLast(next)
          setFocus(next)
          return
        }
        if (selectable && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault()
          togglePicked(reached)
          setFocus(reached)
        }
      }}
    >
      <TooltipPrimitive.Trigger
        handle={tooltip}
        id={tooltipTriggerId(id)}
        delay={0}
        closeDelay={0}
        render={
          <span
            aria-hidden
            className='pointer-events-none absolute inset-0 rounded-(--control-radius-capped)'
          />
        }
      />
    </div>
  )
}

/** The id of the tooltip's one trigger, over the whole plot. */
function tooltipTriggerId(id: string) {
  return `${id}-tooltip`
}

/** The data as a table for screen readers, which the chart's picture doesn't reach. */
function ChartDataTable({ table }: { table: ChartTable }) {
  const { status, messages } = useChartRootValue()
  if (status !== 'ready') return null
  // The table sits in a hidden box: a table grows to fit its cells past `sr-only`'s 1px.
  return (
    <div className='sr-only'>
      <table aria-label={messages.table}>
        <thead>
          <tr>
            <th scope='col'>{table.header}</th>
            {table.columns.map((column, at) => (
              // oxlint-disable-next-line react/no-array-index-key -- the columns are fixed
              <th key={at} scope='col'>
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row) => (
            <tr key={row.key}>
              <th scope='row'>{row.name}</th>
              {row.cells.map((cell, at) => (
                // oxlint-disable-next-line react/no-array-index-key -- the columns are fixed
                <td key={at}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
        {table.footer.length > 0 && (
          <tfoot>
            <tr>
              <th scope='row'>{messages.total}</th>
              {table.footer.map((cell, at) => (
                // oxlint-disable-next-line react/no-array-index-key -- the columns are fixed
                <td key={at}>{cell}</td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  )
}

/**
 * What shows over the plot while there is nothing to draw, and what a
 * screen reader hears as that changes: a loading note (the chart draws its
 * own placeholder), the error and a way to try again, `empty` when there's
 * no data, or a way back when every series is hidden.
 */
function ChartStatusOverlay({ empty }: { empty?: ReactNode }) {
  const { status, series, setHidden, label, messages, error, onRetry } =
    useChartRootValue()
  const overlay = useRef<HTMLDivElement>(null)
  const { announce, region } = useAnnouncer()
  const was = useRef(status)
  useEffect(() => {
    if (was.current === status) return
    if (status === 'loading') announce(messages.loading)
    else if (status === 'error') announce(messages.error)
    else if (was.current === 'loading' || was.current === 'error')
      announce(status === 'empty' ? messages.empty : messages.loaded(label))
    was.current = status
  })
  const focusPlot = (run: () => void) => {
    // The button goes once the chart shows or loads again, so focus moves to the legend, or
    // to the plot (`data-chart-plot`), which keeps it while the chart loads.
    const figure = overlay.current?.closest('figure')
    flushSync(run)
    figure
      ?.querySelector<HTMLElement>('[data-slot=chart-legend] button, [data-chart-plot]')
      ?.focus()
  }
  return (
    <>
      {region}
      {(status === 'empty' || status === 'hidden' || status === 'error') && (
        <div
          ref={overlay}
          data-slot='chart-status'
          className='relative z-40 flex min-h-0 flex-col items-center justify-center gap-2 p-4 text-center [grid-area:plot]'
        >
          {status === 'empty' &&
            (empty ?? <p className='text-muted-foreground text-sm'>{messages.empty}</p>)}
          {status === 'error' && (
            <>
              {typeof error === 'string' || error === true ? (
                <p className='text-muted-foreground text-sm'>
                  {error === true ? messages.error : error}
                </p>
              ) : (
                error
              )}
              {onRetry && (
                <Button size='xs' variant='outline' onClick={() => focusPlot(onRetry)}>
                  {messages.retry}
                </Button>
              )}
            </>
          )}
          {status === 'hidden' && (
            <>
              <p className='text-muted-foreground text-sm'>{messages.allHidden}</p>
              <Button
                size='xs'
                variant='outline'
                onClick={() => focusPlot(() => setHidden([]))}
              >
                {messages.showAll(series.length)}
              </Button>
            </>
          )}
        </div>
      )}
    </>
  )
}

/**
 * The chart's `<figure>`, named by its `label`: the series' colours, the
 * parts written inside it, then, on a chart the pointer and the keys browse
 * (`reader.browse`), the layer that takes them, the status, and the data
 * table. A chart whose marks are read and reached as they are, such as a bar
 * list's rows, each a link or a button of its own, gives `plot` to the
 * element that holds them.
 */
function ChartFrame({
  root,
  focus,
  slot,
  description,
  empty,
  measuring,
  inset,
  className,
  children,
  ref,
  style,
  ...props
}: Omit<ComponentProps<'figure'>, 'ref'> & {
  root: ChartRootValue
  focus: ChartFocusProps
  slot: string
  description?: string
  empty?: ReactNode
  /**
   * Whether its scales wait for the plot's size, as labels past the bars
   * do: until the plot is measured, everything but the legend holds its
   * place unseen rather than show a range that then shifts.
   */
  measuring: boolean
  /** The px kept clear inside each edge of the plot, as `--chart-inset`, for marks drawn round a point. */
  inset: number
  ref?: Ref<HTMLElement>
}) {
  const figure = root.root
  const figureRef = useMemo(() => mergeRefs(figure, ref, markMounted), [figure, ref])
  const descriptionId = `${root.id}-description`
  const { browse } = root.reader
  return (
    <ChartRootContext value={root}>
      <ChartFocus root={root} {...focus}>
        <figure
          ref={figureRef}
          data-slot={slot}
          data-chart={root.id}
          data-measuring={measuring ? '' : undefined}
          aria-label={root.label}
          aria-describedby={description ? descriptionId : undefined}
          className={cn(
            chartFrameClassName,
            // Waiting for the plot's size, everything but the legend holds its place unseen.
            'data-measuring:*:not-data-[slot=chart-legend]:invisible',
            className,
          )}
          style={
            inset ? ({ '--chart-inset': `${inset}px`, ...style } as CSSProperties) : style
          }
          {...props}
        >
          <ChartStyle id={root.id} config={root.config} series={root.series} />
          {description && (
            <p id={descriptionId} className='sr-only'>
              {description}
            </p>
          )}
          {children}
          {browse && <ChartBrowse reader={browse} />}
          <ChartStatusOverlay empty={empty} />
          {browse && <ChartDataTable table={browse.table} />}
        </figure>
      </ChartFocus>
    </ChartRootContext>
  )
}

export {
  SeriesKey,
  type ChartBrowseReader,
  type ChartItem,
  type ChartFocusProps,
  type ChartFocusValue,
  ChartFrame,
  type ChartFormat,
  ChartGroup,
  ChartLegendToggles,
  type ChartMessages,
  type ChartMoves,
  type ChartPoint,
  type ChartReader,
  type ChartRootProps,
  type ChartRootState,
  type ChartRootValue,
  ChartStyle,
  ChartSvgPattern,
  ChangeText,
  ChartNumber,
  chartFrameClassName,
  defaultMessages,
  drawingFrame,
  drawingSize,
  forcedSeriesColor,
  forcedSeriesColors,
  forcedSeriesTextColor,
  formatterOf,
  labelOnClassName,
  type MoveRole,
  type MoveRun,
  patternImage,
  percent,
  plotLayerClassName,
  type PlotPoint,
  type PointsMove,
  seriesColor,
  swatchClassName,
  swatchStyle,
  tooltipQuietClassName,
  tooltipTriggerId,
  useBefore,
  useChartFocus,
  useChartGroup,
  useChartMoves,
  useChartRoot,
  useChartRootValue,
  useEntered,
  useFromRest,
  useLeaving,
  usePointsMove,
}
