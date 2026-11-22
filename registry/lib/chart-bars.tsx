'use client'

import type { ChartContextValue } from '@/registry/lib/chart-core'
import {
  type ChartOrientation,
  physicalStart,
  plotPoint,
  type ReadingDirection,
} from '@/registry/lib/chart-math'
import { forcedSeriesColor, plotLayerClassName } from '@/registry/lib/chart-root'
import { type Band, bandAt } from '@/registry/lib/chart-scale'
import {
  placeholderBreatheClassName,
  placeholderFillClassName,
} from '@/registry/lib/placeholder'
import { type CSSProperties, memo, type ReactNode } from 'react'

import { cn } from '@/lib/utils'

/*
 * What the charts drawn as bars share: a bar as the clip of a layer as large
 * as the plot, its shape that dims, rises and glides, the label on its end,
 * the mark of a missing value and the placeholder's bars. The Bar chart and
 * the Funnel chart draw with it, so every bar looks and moves the same.
 */

const PLACEHOLDER_COUNT = 7

/** Where a bar stands: the band it takes and the span of the value axis it covers, as fractions. */
interface BarPlace {
  band: Band
  from: number
  to: number
}

/** The bar's shape as a clip, rounded at the end its value reaches. */
function barClip(chart: ChartContextValue, place: BarPlace, outermost: boolean) {
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
  chart: ChartContextValue
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
  chart: ChartContextValue,
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
  chart: Pick<ChartContextValue, 'orientation' | 'textWidth'>,
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
function trackClip(chart: ChartContextValue, band: Band) {
  return barClipPath(
    barInsets(band, 0, 1, chart.orientation, chart.direction),
    [true, true, true, true],
    chart.orientation,
  )
}

/** Where the mark of a missing value sits: across its band, on `zero`, the fraction of the value axis bars grow from. */
function missingMark(chart: ChartContextValue, band: Band, zero: number): CSSProperties {
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
function labelPlace(
  chart: ChartContextValue,
  place: BarPlace,
  position: BarLabelPosition,
) {
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
      <span
        className={cn(
          'absolute w-max font-medium whitespace-nowrap tabular-nums transition-none duration-(--motion-enter-duration) ease-(--motion-enter-fade-easing) group-data-mounted/chart:transition-[opacity,color]',
          outside
            ? 'bg-background/85'
            : 'bg-background/85 text-foreground rounded-(--control-radius-xs) px-1',
          !shown && 'opacity-0',
          placeClass,
        )}
      >
        {children}
      </span>
    </span>
  )
})

/** Whether `text` fits where its label goes on the bar at `place`, at the chart's size. */
function labelFits(
  chart: ChartContextValue,
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
  const half = `min(${round(size * 50)}${across}, var(--bar-chart-max-thickness, 4rem) / 2)`
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
  const radius = `min(var(--bar-chart-radius, var(--control-radius-xs)), ${half})`
  // Never all square: Chromium can't run a clip-path transition off the main thread between
  // an inset with no `round` and one with, and a corner of 0px drops the `round`.
  const radii = corners.map((rounded) => (rounded ? radius : '0.01px'))
  return `inset(${edges.join(' ')} round ${radii.join(' ')})`
}

/** A fraction written to four decimals, enough for a plot thousands of px long. */
function round(value: number): number {
  return Math.round(value * 10_000) / 10_000
}

export {
  barClip,
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
  roundCorners,
  trackClip,
}
