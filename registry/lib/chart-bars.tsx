'use client'

import type { BarMarkKind } from '@/registry/lib/chart-bar-marks'
import type { EntrancePhase } from '@/registry/lib/chart-base'
import type { CartesianModel } from '@/registry/lib/chart-frame'
import {
  type ChartOrientation,
  numberOf,
  physicalStart,
  plotPoint,
  rangeOf,
  type ReadingDirection,
  type Span,
} from '@/registry/lib/chart-math'
import {
  type ChartRootState,
  forcedSeriesColor,
  plotLayerClassName,
} from '@/registry/lib/chart-root'
import { type Band, bandAt } from '@/registry/lib/chart-scale'
import {
  placeholderBreatheClassName,
  placeholderFillClassName,
} from '@/registry/lib/placeholder'
import { createContext, type CSSProperties, memo, type ReactNode, use } from 'react'

import { cn } from '@/lib/utils'

/*
 * What the charts drawn as bars share: a bar as the clip of a layer as large
 * as the plot, its shape that dims, rises and glides, the label on its end,
 * the mark of a missing value and the placeholder's bars. The Bar chart and
 * the Funnel chart draw with it, so every bar looks and moves the same.
 */

const PLACEHOLDER_COUNT = 7

/** What a chart's bars stand in, which every `Bar` reads: the Bar chart's and the Composed chart's. */
interface BarFrameValue {
  /** The frame the bars stand in: each series' spans, a hidden one where it would sit, so it shrinks into place and grows back out of it, and the axis it is read against. */
  model: CartesianModel
  /** Its bars' kind of mark, which says what each bar's label reads. */
  kind: BarMarkKind
  phase: EntrancePhase
  /** The chart was loading, so its bars grow out of the placeholder. */
  fromPlaceholder: boolean
  entrance: 'rise' | 'cascade' | 'none'
  /** How far through the cascade each category's bars start, by its place in the data. */
  cascade: readonly number[]
  /** The share of `draw` a cascade's bars start over, as CSS: its chart's variable, with its default. */
  cascadeSpan: string
  barGap: number
  /**
   * What the pointer and the keys light: a stop's bars, the rest stepping
   * back, or a series' bars across every stop, as a Bar chart's ribbons do.
   */
  lights: 'stop' | 'series'
}

const BarFrameContext = createContext<BarFrameValue | null>(null)

function useBarFrame() {
  const bar = use(BarFrameContext)
  if (!bar) throw new Error('`Bar` goes inside a `BarChart` or a `ComposedChart`.')
  return bar
}

/** Which way a chart's bars lie and its text reads, which places and rounds them. */
interface BarLayout {
  orientation: ChartOrientation
  direction: ReadingDirection
}

/** What a chart's labels are fitted to: its bars' layout, the plot's size and its text, and how many stops share it. */
type BarLabelLayout = BarLayout &
  Pick<ChartRootState, 'plotSize' | 'textWidth'> & {
    current: readonly unknown[]
  }

/** Where a bar stands: the band it takes and the span of the value axis it covers, as fractions. */
interface BarPlace {
  band: Band
  from: number
  to: number
}

/** The bar's shape as a clip, rounded at the end its value reaches. */
function barClip(chart: BarLayout, place: BarPlace, outermost: boolean) {
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

/**
 * The placeholder while the data loads: one bar for each of a few
 * categories, at uneven heights, breathing slowly. It fades in while the
 * bars there were shrink away, and the real bars grow out of it when the
 * data arrives.
 */
function BarPlaceholder({
  chart,
  values = placeholderValues(PLACEHOLDER_COUNT),
}: {
  chart: BarLayout
  /** The bars' lengths, as fractions of the plot. */
  values?: readonly number[]
}) {
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
        {values.map((value, at) => (
          <div
            // oxlint-disable-next-line react/no-array-index-key -- a fixed row
            key={at}
            className={cn('absolute inset-0', placeholderFillClassName)}
            style={{
              clipPath: placeholderClip(chart, at, value, values.length),
            }}
          />
        ))}
      </div>
    </div>
  )
}

/** The placeholder's bar at `at` of `count`, `value` long, as a clip. */
function placeholderClip(
  chart: BarLayout,
  at: number,
  value: number,
  count = PLACEHOLDER_COUNT,
) {
  const band = bandAt(at, count)
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
function outsideRoom(
  chart: Pick<BarLabelLayout, 'orientation' | 'textWidth'>,
  texts: readonly string[],
) {
  if (chart.orientation === 'vertical') return OUTSIDE_ROOM.vertical
  return Math.ceil(Math.max(0, ...texts.map(chart.textWidth)) + OUTSIDE_ROOM.gap)
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
  forced = forcedSeriesColor(slot),
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
  /** Its colour under forced colours, the series' own by default. */
  forced?: string
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
          forced,
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
function trackClip(chart: BarLayout, band: Band) {
  return barClipPath(
    barInsets(band, 0, 1, chart.orientation, chart.direction),
    [true, true, true, true],
    chart.orientation,
  )
}

/** Where the mark of a missing value sits: across its band, on `zero`, the fraction of the value axis bars grow from. */
function missingMark(chart: BarLayout, band: Band, zero: number): CSSProperties {
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

/** Where a label on the bar at `place` goes: the point it sits on, and which way is out from the bar's end. */
function labelPlace(chart: BarLayout, place: BarPlace, position: BarLabelPosition) {
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
  entering = false,
  delay,
  children,
}: {
  x: number
  y: number
  out: 'up' | 'down' | 'left' | 'right'
  position: BarLabelPosition
  shown: boolean
  dim: boolean
  /** Its bar is rising for the entrance, so it rises with it, on `draw`, after the same `delay`. */
  entering?: boolean
  delay?: string
  children: ReactNode
}) {
  const outside = position === 'outside'
  const placeClass =
    // A physical `left-0` beside the centring translate, so it centres on the anchor in
    // either reading direction; right to left would start it from the anchor's right.
    position === 'center'
      ? 'left-0 top-0 -translate-x-1/2 -translate-y-1/2'
      : out === 'up'
        ? cn('left-0 -translate-x-1/2', outside ? 'bottom-1' : 'top-1')
        : out === 'down'
          ? cn('left-0 -translate-x-1/2', outside ? 'top-1' : 'bottom-1')
          : out === 'right'
            ? cn('-translate-y-1/2', outside ? 'left-1.5' : 'right-1.5')
            : cn('-translate-y-1/2', outside ? 'right-1.5' : 'left-1.5')
  return (
    <span
      data-dim={dim ? '' : undefined}
      data-entering={entering ? '' : undefined}
      className='absolute top-0 left-0 size-0 [translate:var(--label-at)] duration-(--motion-layout-duration) ease-[var(--motion-layout-fade-easing),var(--motion-layout-fade-easing),var(--motion-layout-easing)] transition-none group-data-mounted/chart:transition-[color,opacity,translate] data-dim:text-muted-foreground data-entering:duration-(--motion-draw-duration) data-entering:ease-[var(--motion-draw-fade-easing),var(--motion-draw-fade-easing),var(--motion-draw-easing)] motion-reduce:group-data-mounted/chart:transition-opacity motion-reduce:ease-(--motion-layout-fade-easing)'
      style={
        {
          '--label-at': `${x * 100}cqw ${y * 100}cqh`,
          transitionDelay: delay,
        } as CSSProperties
      }
    >
      {/* A value with a sign or a unit reads in its own order whatever the page's direction. */}
      <span
        dir='auto'
        className={cn(
          'absolute w-max font-medium whitespace-nowrap tabular-nums transition-none duration-(--motion-enter-duration) ease-(--motion-enter-fade-easing) group-data-mounted/chart:transition-[opacity,color]',
          // Past the bar, it hides the grid under it in the colour of the surface the chart is on.
          outside
            ? 'bg-(--chart-surface,var(--card))/85'
            : 'bg-background/85 text-foreground rounded-(--control-radius-xs) px-1',
          !shown && 'opacity-0',
          placeClass,
        )}
        // In a cascade it fades in as its bar starts to rise.
        style={{ transitionDelay: delay }}
      >
        {children}
      </span>
    </span>
  )
})

/** Whether `text` fits where its label goes on the bar at `place`, at the chart's size. */
function labelFits(
  chart: BarLabelLayout,
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
  const half = halfThickness(size, across)
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
  const radius = barRadius(half)
  // Never all square: Chromium can't run a clip-path transition off the main thread between
  // an inset with no `round` and one with, and a corner of 0px drops the `round`.
  const radii = corners.map((rounded) => (rounded ? radius : '0.01px'))
  return `inset(${edges.join(' ')} round ${radii.join(' ')})`
}

/**
 * Half a bar's thickness across `size` of the plot, in `unit` (`%` in a
 * shape that resolves against the plot), as CSS: capped at
 * `--bar-chart-max-thickness`.
 */
function halfThickness(size: number, unit: 'cqw' | 'cqh' | '%') {
  return `min(${round(size * 50)}${unit}, var(--bar-chart-max-thickness, 4rem) / 2)`
}

/** A bar's rounded corner, as CSS: `--bar-chart-radius`, never past `half`, half its thickness. */
function barRadius(half: string) {
  return `min(var(--bar-chart-radius, var(--control-radius-xs)), ${half})`
}

/** A fraction written to four decimals, enough for a plot thousands of px long. */
function round(value: number): number {
  return Math.round(value * 10_000) / 10_000
}

/*
 * Ribbons: each series of a stack joined from its bar in one column to its
 * bar in the next, so a viewer follows its share across them. A ribbon is a
 * clip of the plot, as a bar is, drawn from the same places, each of its two
 * edges a cubic that leaves one bar and meets the next flat.
 */

/** A ribbon of `series` from its bar in the column at `from` to the one at `to`, by their places in the data. */
interface RibbonPair {
  series: string
  from: number
  to: number
}

/**
 * The ribbons of a stack of `count` columns: one for each series between
 * each two neighbouring columns where it has a value at both. None crosses
 * a missing value or a change of sign, since its bars there stand on
 * opposite sides of zero; a zero joins either side, and its ribbon tapers to
 * a point there.
 */
function ribbonsOf(
  series: readonly string[],
  count: number,
  valueOf: (key: string, index: number) => unknown,
): RibbonPair[] {
  return series.flatMap((key) =>
    Array.from({ length: Math.max(0, count - 1) }, (_, at) => at).flatMap((at) => {
      const from = valueSign(valueOf(key, at))
      const to = valueSign(valueOf(key, at + 1))
      return from === null || to === null || from * to < 0
        ? []
        : [{ series: key, from: at, to: at + 1 }]
    }),
  )
}

/** Which side of zero a value or a `[from, to]` range runs to: 1, -1, or 0 for none; null for no value. */
function valueSign(raw: unknown): number | null {
  const value = numberOf(raw)
  if (value !== null) return Math.sign(value)
  const range = rangeOf(raw)
  return range ? Math.sign(range[1] - range[0]) : null
}

/** How a chart's ribbons are laid out: its bars', with the bars' greatest thickness as a share of the plot across the categories. */
interface RibbonLayout extends BarLayout {
  cap: number
}

/**
 * Where a ribbon meets a bar: the bar's edge that faces it, as a fraction of
 * the plot from its physical left (upright) or top (lying), and the bar's
 * span along the value axis, as fractions of it, which it covers whole.
 */
interface RibbonEnd {
  edge: number
  from: number
  to: number
}

/** The middle of a bar across the categories, and half its thickness, as fractions of the plot: capped as `barClipPath` caps it. */
function barAcross(place: BarPlace, layout: RibbonLayout) {
  const { band } = place
  const axis = layout.orientation === 'vertical' ? 'inline' : 'block'
  return {
    centre: physicalStart(band, axis, layout.direction) + band.size / 2,
    half: Math.min(band.size, layout.cap) / 2,
  }
}

/** The two ends of a ribbon from the bar at `start` to the bar at `end`: the edges that face each other, whichever way the columns run. */
function ribbonEnds(
  start: BarPlace,
  end: BarPlace,
  layout: RibbonLayout,
): readonly [RibbonEnd, RibbonEnd] {
  const a = barAcross(start, layout)
  const b = barAcross(end, layout)
  const forward = b.centre >= a.centre ? 1 : -1
  return [
    { edge: a.centre + forward * a.half, from: start.from, to: start.to },
    { edge: b.centre - forward * b.half, from: end.from, to: end.to },
  ]
}

/**
 * How a ribbon meets the bar at one end: running under it `share` of the way
 * from its edge to its middle, and, at the outermost bar of a stack, at least
 * as far as the bar's rounded corner reaches in, so the ribbon fills the
 * corner and runs on behind it.
 */
interface RibbonTuck {
  share: number
  corner: boolean
}

/**
 * How far a ribbon runs under its bars: halfway to their middles. The bars
 * cover it there, so it meets them with no seam whatever their thickness.
 */
const RIBBON_TUCK = 0.5

/** A ribbon that stops at its bars' edges. */
const NO_TUCK: RibbonTuck = { share: 0, corner: false }

/**
 * A ribbon as the `clip-path` of a layer as large as the plot: a `shape()`
 * from the end of its first bar's span to the end of the next's and back
 * along their starts, each edge a cubic whose handles sit halfway across, so
 * it leaves each bar flat. Its places across are the bars' own, in the same
 * CSS as `barClipPath`, so it meets each bar's edge at any size, and moving
 * it is one transition beside theirs, which lands with them and turns back
 * with them. Its edge along the ends of the spans stands
 * `--bar-chart-ribbon-gap` back, apart from the ribbon stacked past it.
 */
function ribbonClipPath(
  start: BarPlace,
  end: BarPlace,
  layout: BarLayout,
  [startTuck, endTuck]: readonly [RibbonTuck, RibbonTuck],
): string {
  const { orientation, direction } = layout
  const across = (place: BarPlace) => {
    const { band } = place
    const axis = orientation === 'vertical' ? 'inline' : 'block'
    return {
      centre: physicalStart(band, axis, direction) + band.size / 2,
      half: halfThickness(band.size, '%'),
    }
  }
  const a = across(start)
  const b = across(end)
  const forward = b.centre >= a.centre ? 1 : -1
  // A place across `sign` of the way out from a bar's middle, less how far it runs under the bar.
  const out = (
    { centre, half }: { centre: number; half: string },
    sign: number,
    tuck?: RibbonTuck,
  ) => {
    const reach = tuck
      ? // Never past the bar's middle.
        `(${half} - min(${half}, max(${half} * ${tuck.share}, ${barRadius(half)} * ${tuck.corner ? 1 : 0})))`
      : half
    return `calc(${round(centre * 100)}% ${sign < 0 ? '-' : '+'} ${reach})`
  }
  const startEdge = out(a, forward)
  const endEdge = out(b, -forward)
  const startUnder = out(a, forward, startTuck)
  const endUnder = out(b, -forward, endTuck)
  const middle = `calc((${startEdge} + ${endEdge}) / 2)`
  // A fraction of the value axis as a place along the plot, from its top (upright) or its left (lying).
  const place = (along: number) =>
    round((orientation === 'horizontal' && direction === 'ltr' ? along : 1 - along) * 100)
  // The end of a span, the gap back toward its start, never past it.
  const far = ({ from, to }: BarPlace) => {
    const near = place(from)
    const at = place(to)
    const gap = 'var(--bar-chart-ribbon-gap, 1px)'
    return at <= near
      ? `min(${near}%, calc(${at}% + ${gap}))`
      : `max(${near}%, calc(${at}% - ${gap}))`
  }
  const point = (acrossAt: string, along: string) =>
    orientation === 'vertical' ? `${acrossAt} ${along}` : `${along} ${acrossAt}`
  const startFar = far(start)
  const endFar = far(end)
  const startNear = `${place(start.from)}%`
  const endNear = `${place(end.from)}%`
  return `shape(${[
    `from ${point(startUnder, startFar)}`,
    `line to ${point(startEdge, startFar)}`,
    `curve to ${point(endEdge, endFar)} with ${point(middle, startFar)} / ${point(middle, endFar)}`,
    `line to ${point(endUnder, endFar)}`,
    `line to ${point(endUnder, endNear)}`,
    `line to ${point(endEdge, endNear)}`,
    `curve to ${point(startEdge, startNear)} with ${point(middle, endNear)} / ${point(middle, startNear)}`,
    `line to ${point(startUnder, startNear)}`,
    'close',
  ].join(', ')})`
}

/**
 * The span of the value axis a ribbon covers at `across`, as fractions, or
 * null where it doesn't reach: each edge read off its cubic, whose share of
 * the way across is `1.5t - 1.5t² + t³` and of the way along `3t² - 2t³`.
 */
function ribbonSpanAt(
  [start, end]: readonly [RibbonEnd, RibbonEnd],
  across: number,
): Span | null {
  const width = end.edge - start.edge
  if (width === 0) return null
  const share = (across - start.edge) / width
  if (share < 0 || share > 1) return null
  // The curve's share across only grows, so halving finds its `t`.
  let low = 0
  let high = 1
  for (let step = 0; step < 32; step += 1) {
    const t = (low + high) / 2
    if (1.5 * t - 1.5 * t * t + t * t * t < share) low = t
    else high = t
  }
  const t = (low + high) / 2
  const eased = 3 * t * t - 2 * t * t * t
  return [
    start.from + (end.from - start.from) * eased,
    start.to + (end.to - start.to) * eased,
  ]
}

/** What the pointer can land on in a stack with ribbons: each series' bars and its ribbons. */
interface StackMarks {
  bars: readonly { series: string; place: BarPlace }[]
  ribbons: readonly { series: string; ends: readonly [RibbonEnd, RibbonEnd] }[]
}

/**
 * The series whose bar or ribbon holds a point, `across` the categories as
 * the ribbon ends have it and `along` the value axis, both fractions of the
 * plot; null over neither, such as past a stack's end or where no ribbon
 * crosses a missing value. A mark with no length holds nothing.
 */
function stackSeriesAt(
  marks: StackMarks,
  point: { across: number; along: number },
  layout: RibbonLayout,
): string | null {
  const inside = (span: Span) => {
    const low = Math.min(span[0], span[1])
    const high = Math.max(span[0], span[1])
    return high > low && point.along >= low && point.along <= high
  }
  const bar = marks.bars.find(({ place }) => {
    const { centre, half } = barAcross(place, layout)
    return Math.abs(point.across - centre) <= half && inside([place.from, place.to])
  })
  if (bar) return bar.series
  const ribbon = marks.ribbons.find(({ ends }) => {
    const span = ribbonSpanAt(ends, point.across)
    return span !== null && inside(span)
  })
  return ribbon?.series ?? null
}

export {
  barAcross,
  barClip,
  BarFrameContext,
  type BarFrameValue,
  useBarFrame,
  barClipPath,
  barInsets,
  BarLabel,
  type BarLabelPosition,
  type BarPlace,
  BarPlaceholder,
  BarShape,
  farSide,
  labelFits,
  labelPlace,
  missingMark,
  outsideRoom,
  PLACEHOLDER_COUNT,
  placeholderClip,
  placeholderValues,
  type RibbonEnd,
  ribbonEnds,
  type RibbonLayout,
  type RibbonPair,
  NO_TUCK,
  RIBBON_TUCK,
  type RibbonTuck,
  ribbonClipPath,
  ribbonsOf,
  ribbonSpanAt,
  roundCorners,
  type StackMarks,
  stackSeriesAt,
  trackClip,
}
