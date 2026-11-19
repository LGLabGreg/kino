import { curves, type LinePoint, type PathCurve } from '@/registry/lib/line-path'
import { area as areaPath } from 'd3-shape'
import type { ComponentProps, RefObject } from 'react'

import { cn } from '@/lib/utils'

/*
 * The fill under a line: the shape between its points and their baselines,
 * in the current text colour, fading from its peak to the plot's bottom so
 * it reads as a wash under the line rather than a block. It is an SVG path
 * with a gradient of its own, so a move redraws it as cheaply as the line
 * above it, and a change of the text colour, such as a series stepping
 * back, fades it with the line. The Area chart draws one under each area,
 * and the Sparkline under its line.
 *
 * How strong the wash is comes from `--trace-fill-top`, at the shape's peak,
 * and `--trace-fill-bottom`, at the plot's bottom, both from 0 to 1, which
 * the chart that draws it sets from its own variables, such as
 * `--area-chart-fill-top`.
 */

/** The shape between `points` and their baselines in px, for a plot `width` by `height`, broken at each missing value. */
function areaPathThrough(
  points: readonly LinePoint[],
  curve: PathCurve,
  width: number,
  height: number,
): string {
  return (
    areaPath<LinePoint>()
      .defined((point) => point.defined)
      .x((point) => point.x * width)
      .y0((point) => (point.base ?? 1) * height)
      .y1((point) => point.y * height)
      .curve(curves[curve])(points) ?? ''
  )
}

/** The highest any shown point reaches, as a fraction of the plot from its top, where the wash is strongest; 0 with none. */
function fillPeak(points: readonly LinePoint[]): number {
  let peak = Infinity
  for (const point of points) {
    if (point.defined) peak = Math.min(peak, point.y, point.base ?? 1)
  }
  return Number.isFinite(peak) ? Math.max(0, peak) : 0
}

/** The elements a fill redraws on each frame of a move. */
interface AreaFillElements {
  path: RefObject<SVGPathElement | null>
  gradient: RefObject<SVGLinearGradientElement | null>
}

/** Writes the fill's shape, `path` in px, and where its wash starts, `peak` px from the top, straight into its elements. */
function paintFill(elements: AreaFillElements, path: string, peak: number) {
  elements.path.current?.setAttribute('d', path)
  elements.gradient.current?.setAttribute('y1', String(peak))
}

/**
 * The fill, inside an `<svg>`: its gradient, named `id`, and its shape, in
 * the text colour, which forced colours set too.
 */
function AreaFill({
  id,
  path,
  peak,
  height,
  elements,
  className,
  ...props
}: Omit<ComponentProps<'path'>, 'id' | 'd' | 'ref'> & {
  /** The gradient's id, unique on the page. */
  id: string
  /** The shape in px, from `areaPathThrough`. */
  path: string
  /** Where the wash is strongest, in px from the top. */
  peak: number
  /** The plot's height in px, where the wash is faintest. */
  height: number
  /** Refs to the path and its gradient, for a move to redraw them. */
  elements?: AreaFillElements
}) {
  return (
    <>
      <defs>
        <linearGradient
          ref={elements?.gradient}
          id={id}
          gradientUnits='userSpaceOnUse'
          x1={0}
          x2={0}
          y1={peak}
          y2={height}
        >
          <stop
            offset={0}
            className='[stop-color:currentColor] [stop-opacity:var(--trace-fill-top,0.32)]'
          />
          <stop
            offset={1}
            className='[stop-color:currentColor] [stop-opacity:var(--trace-fill-bottom,0.04)]'
          />
        </linearGradient>
      </defs>
      <path
        ref={elements?.path}
        data-slot='area-fill'
        d={path}
        fill={`url(#${id})`}
        className={cn('stroke-none', className)}
        {...props}
      />
    </>
  )
}

export { AreaFill, type AreaFillElements, areaPathThrough, fillPeak, paintFill }
