'use client'

import { plotOffset } from '@/registry/lib/chart-base'
import { markLayer } from '@/registry/lib/chart-frame'
import {
  forcedSeriesTextColor,
  plotLayerClassName,
  seriesColor,
} from '@/registry/lib/chart-root'
import {
  type ComponentProps,
  type CSSProperties,
  memo,
  type ReactNode,
  useState,
} from 'react'

import { cn } from '@/lib/utils'

/*
 * What the charts drawn as points share: each series' shape, a point that
 * glides, grows in and shrinks away, and a series' layer of points, which
 * steps back while one is lit and shows that one bright above it. The
 * Scatter chart's points and the Composed chart's draw with it.
 */

/**
 * The shapes each series' points take, in series order, as SVG paths in a
 * box 2 across: shapes of about the same weight, told apart at a glance and
 * in grey.
 */
const markers = [
  // A circle.
  'M1,0A1,1,0,1,1,-1,0A1,1,0,1,1,1,0Z',
  // A square.
  'M-0.85,-0.85H0.85V0.85H-0.85Z',
  // A triangle, pointing up, centred on its height.
  'M0,-0.975L1.126,0.975H-1.126Z',
  // A diamond.
  'M0,-1.15L1.15,0L0,1.15L-1.15,0Z',
  // A plus.
  'M-0.36,-1H0.36V-0.36H1V0.36H0.36V1H-0.36V0.36H-1V-0.36H-0.36Z',
] as const

/** The shape of the series at `slot`: the five in turn. */
function markerAt(slot: number): string {
  return markers[slot % markers.length]!
}

/**
 * One point: placed by `x` and `y`, fractions of the plot from its left
 * and top, and drawn as the series' shape at `radius` px. It glides to a
 * new place, grows in as it arrives and shrinks away as it leaves; a
 * `still` one, the lit point's copy, is simply there. Memoised, so lighting
 * a point redraws none of them.
 */
const PointMark = memo(function PointMark({
  x,
  y,
  radius,
  marker,
  slot,
  depth,
  leaving,
  still = false,
}: {
  x: number
  y: number
  radius: number
  marker: string
  slot: number
  depth: number
  leaving: boolean
  still?: boolean
}) {
  return (
    <span
      data-slot='chart-point'
      data-leaving={leaving ? '' : undefined}
      data-still={still ? '' : undefined}
      className={cn(
        // A point that leaves goes on the exit role, faster than it came and with no bounce.
        'group/point absolute top-0 left-0 size-0 text-(--point-color) [translate:var(--point-at)] transition-none group-data-mounted/chart:transition-[translate,opacity] duration-(--motion-layout-duration) ease-[var(--motion-layout-easing),var(--motion-layout-fade-easing)] group-data-mounted/chart:starting:opacity-0 data-leaving:opacity-0 data-leaving:duration-(--motion-exit-duration) data-leaving:ease-[var(--motion-exit-easing),var(--motion-exit-fade-easing)] data-still:transition-none! motion-reduce:group-data-mounted/chart:transition-[opacity] motion-reduce:ease-(--motion-layout-fade-easing) motion-reduce:data-leaving:ease-(--motion-exit-fade-easing)',
        forcedSeriesTextColor(slot),
      )}
      style={
        {
          '--point-at': `${plotOffset(x, 'cqw')} ${plotOffset(y, 'cqh')}`,
          zIndex: depth,
        } as CSSProperties
      }
    >
      <svg aria-hidden width={1} height={1} className='absolute overflow-visible'>
        <path
          d={marker}
          vectorEffect='non-scaling-stroke'
          // The page's colour around each shape keeps overlapping points apart. Under reduced
          // motion a leaving shape keeps its size, so it fades out as an arriving one fades in.
          className='stroke-background fill-current [stroke-width:1.5] [transform:scale(var(--point-radius))] transition-none group-data-mounted/chart:transition-[transform] duration-(--motion-layout-duration) ease-(--motion-layout-easing) group-data-mounted/chart:starting:[transform:scale(0)] group-data-leaving/point:[transform:scale(0)] group-data-leaving/point:duration-(--motion-exit-duration) group-data-leaving/point:ease-(--motion-exit-easing) group-data-still/point:transition-none! motion-reduce:group-data-mounted/chart:transition-none motion-reduce:group-data-leaving/point:[transform:scale(var(--point-radius))] forced-colors:stroke-[Canvas]'
          style={{ '--point-radius': radius } as CSSProperties}
        />
      </svg>
    </span>
  )
})

/** A point as a series' layer draws it: where it sits, as fractions of the plot from its left and top, its radius in px, and where it sits from the back. */
interface PlacedPoint {
  key: string
  x: number
  y: number
  radius: number
  depth: number
  leaving: boolean
}

/**
 * A series' points: a layer of the plot holding each of `points` in the
 * series' colour and shape. While a point is lit, or another series is
 * brought forward, the layer steps back as one, with a filter the
 * compositor runs, and the lit point shows bright above it, kept while its
 * copy fades as the series comes back, so it never blinks. `name` is the
 * chart's, which names its slots and the variable a buyer tunes the step
 * back with (`--scatter-chart-dim`). `around` holds the marks in each layer,
 * as a live chart's layer that moves with the clock does.
 */
function PointSeries({
  name,
  dataKey,
  points,
  lit,
  seriesIndex,
  marker,
  dim,
  around,
  className,
  style,
  ...props
}: Omit<ComponentProps<'div'>, 'children'> & {
  name: string
  dataKey: string
  points: readonly PlacedPoint[]
  /** The point lit now, or none. */
  lit: PlacedPoint | undefined
  /** The series' place in the config, which picks its colour in forced colours. */
  seriesIndex: number
  marker: string
  dim: boolean
  around: (marks: ReactNode) => ReactNode
}) {
  const [held, setHeld] = useState<string | null>(null)
  if (lit && lit.key !== held) setHeld(lit.key)
  const shownLit = lit ?? points.find((point) => point.key === held && !point.leaving)
  const colours = {
    '--point-color': seriesColor(dataKey),
    '--point-dim': `var(--${name}-dim, 0.3)`,
  } as CSSProperties
  return (
    <>
      <div
        data-slot={`${name}-series`}
        data-series={dataKey}
        data-dim={dim ? '' : undefined}
        aria-hidden
        className={cn(
          plotLayerClassName,
          markLayer.point,
          'transition-[filter] duration-(--motion-layout-duration) ease-(--motion-layout-fade-easing) not-forced-colors:data-dim:[filter:saturate(var(--point-dim))]',
          className,
        )}
        style={{ ...colours, ...style }}
        {...props}
      >
        {around(
          points.map((point) => (
            <PointMark
              key={point.key}
              x={point.x}
              y={point.y}
              radius={point.radius}
              marker={marker}
              slot={seriesIndex}
              depth={point.depth}
              leaving={point.leaving}
            />
          )),
        )}
      </div>
      {shownLit && (
        <div
          data-slot={`${name}-lit`}
          data-off={lit === undefined ? '' : undefined}
          aria-hidden
          className={cn(
            plotLayerClassName,
            'z-13 transition-opacity duration-(--motion-layout-duration) ease-(--motion-layout-fade-easing) data-off:opacity-0',
          )}
          style={colours}
        >
          {around(
            <PointMark
              key={shownLit.key}
              x={shownLit.x}
              y={shownLit.y}
              radius={shownLit.radius}
              marker={marker}
              slot={seriesIndex}
              depth={0}
              leaving={false}
              still
            />,
          )}
        </div>
      )}
    </>
  )
}

export { markerAt, type PlacedPoint, PointMark, PointSeries }
