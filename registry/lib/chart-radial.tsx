'use client'

import type { ChartPoint } from '@/registry/lib/chart-core'
import { type ComponentProps, type CSSProperties, memo, type Ref } from 'react'

import { cn } from '@/lib/utils'

/*
 * What the charts drawn round a centre share, on the chart core: the Donut
 * chart's rings and the Radar chart's axes. Places are turns, fractions of a
 * whole turn clockwise from the top, so a part moves by turning, and every
 * label round the edge stands upright on the same transform.
 */

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

/** How far past the ring, in px, the pointer still finds a slice. */
const PICK_SLACK = 8

/** A label's line past the ring: the gap before it and its length, then the gap before the text, in px. */
const LEADER = { gap: 3, length: 10, text: 4 } as const

/** A line of the chart's text, in px. */
const TEXT_HEIGHT = 16

/**
 * Each value's slice of the ring, in order clockwise from the top, as
 * fractions of a turn. A value above zero takes at least `least` of the turn,
 * taken from the others in proportion, so it shows and can be pointed at.
 * With nothing to share, every slice is empty at the top.
 */
function ringSlices(values: readonly number[], least = 0): Slice[] {
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
  return { x, y, side: tooltipSide(turn) }
}

/**
 * The side a tooltip opens on at `turn`: above the top half and below the
 * bottom half, never beside the centre, where a tooltip that doesn't fit
 * would flip across it.
 */
function tooltipSide(turn: number): 'top' | 'bottom' {
  return turn >= 0.25 && turn < 0.75 ? 'bottom' : 'top'
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

/** A box in px from the centre. */
interface RadialBox {
  left: number
  right: number
  top: number
  bottom: number
}

/**
 * A label's box round the edge, in px from the centre: its point sits
 * `radius` out, `turn` round, and the box `width` by `height` px sits
 * against that point, away from the centre, as `RadialLabel` places it.
 */
function labelBoxAt(
  turn: number,
  radius: number,
  width: number,
  height = TEXT_HEIGHT,
): RadialBox {
  const angle = turn * Math.PI * 2
  const sin = Math.sin(angle)
  const cos = Math.cos(angle)
  const x = radius * sin + (sin * width) / 2
  const y = -radius * cos - (cos * height) / 2
  return {
    left: x - width / 2,
    right: x + width / 2,
    top: y - height / 2,
    bottom: y + height / 2,
  }
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

/** A label to place round the edge: where it is, and its size in px. */
interface EdgeLabel {
  turn: number
  width: number
  height: number
}

/**
 * The room labels round the edge take, in px inward from the largest circle
 * a plot `width` by `height` px holds, so that each label, `gap` px past the
 * edge at its own turn, stays inside the plot: the labels at the sides hold
 * the edge in by their widths, those at the top and bottom by their heights.
 */
function edgeRoom(
  width: number,
  height: number,
  labels: readonly EdgeLabel[],
  gap: number,
) {
  if (width === 0 || height === 0) return 0
  const half = Math.min(width, height) / 2 - 0.5
  let radius = half
  for (const label of labels) {
    const angle = label.turn * Math.PI * 2
    const sin = Math.abs(Math.sin(angle))
    const cos = Math.abs(Math.cos(angle))
    // How far out its point may sit before the box, against it, crosses a side.
    if (sin > 1e-9) {
      radius = Math.min(radius, (width / 2 - (label.width * (1 + sin)) / 2) / sin - gap)
    }
    if (cos > 1e-9) {
      radius = Math.min(radius, (height / 2 - (label.height * (1 + cos)) / 2) / cos - gap)
    }
  }
  return Math.ceil(Math.max(0, half - Math.max(0, radius)))
}

/** Whether a label's box stands clear of every box in `placed`, with a little room across. */
function standsClear(box: RadialBox, placed: readonly RadialBox[]) {
  return placed.every(
    (other) =>
      box.right + 2 <= other.left ||
      box.left - 2 >= other.right ||
      box.bottom <= other.top ||
      box.top >= other.bottom,
  )
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
  const placed: RadialBox[] = []
  const order = slices
    .map((slice, at) => ({ slice, at }))
    .filter(({ slice }) => slice.size > 0)
    .sort((a, b) => b.slice.size - a.slice.size)
  for (const { slice, at } of order) {
    const box = labelBoxAt(slice.start + slice.size / 2, radius, widths[at] ?? 0)
    if (!standsClear(box, placed)) continue
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
 * A label round the centre, turned to `turn` and stood back upright, so it
 * travels round with what it names: against its point, away from the
 * centre, or with `centred`, centred on it. With `edge`, a short line leads
 * to it from that far out. Memoised, as what it names is.
 */
const RadialLabel = memo(function RadialLabel({
  turn,
  radius,
  stretch,
  edge = null,
  centred = false,
  shown,
  className,
  style,
  ref,
  ...props
}: Omit<ComponentProps<'span'>, 'ref'> & {
  turn: number
  radius: number
  /** Before the plot is measured, one over the stand-in's shorter side, which `radius` is in; else null. */
  stretch: number | null
  /** How far out the line before it starts, in px; null for no line. */
  edge?: number | null
  /** Centred on its point, as a label on its slice is, rather than against it. */
  centred?: boolean
  shown: boolean
  ref?: Ref<HTMLSpanElement>
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
       * Out along its turn and turned back as far, in one transform, so both turns move in
       * step and the text stays upright all the way round.
       */}
      <div className='absolute size-0 [transform:rotate(var(--label-turn))_translateY(var(--label-out))_rotate(calc(var(--label-turn)*-1))] transition-none duration-(--motion-layout-duration) ease-(--motion-layout-easing) motion-reduce:group-data-mounted/chart:transition-none group-data-mounted/chart:transition-[transform]'>
        <span
          ref={ref}
          className={cn(
            'absolute top-0 left-0 transition-none duration-(--motion-layout-duration) ease-[var(--motion-layout-fade-easing),var(--motion-layout-easing)] group-data-mounted/chart:transition-[color,translate] motion-reduce:group-data-mounted/chart:transition-[color]',
            className,
          )}
          style={{
            // Against its point and away from the centre, or centred on it.
            translate: centred
              ? '-50% -50%'
              : `calc(-50% + ${round(Math.sin(angle) * 50)}%) calc(-50% - ${round(Math.cos(angle) * 50)}%)`,
            ...style,
          }}
          {...props}
        />
      </div>
    </div>
  )
})

export {
  edgeRoom,
  type EdgeLabel,
  foldPoint,
  insideLabelFits,
  labelBoxAt,
  LEADER,
  outerPoint,
  outsideLabelsShown,
  outsideRoom,
  type RadialBox,
  RadialLabel,
  ringBands,
  type RingBand,
  ringSlices,
  round,
  type Slice,
  sliceAt,
  sliceDash,
  type SliceDash,
  standsClear,
  TEXT_HEIGHT,
  tooltipSide,
  turnOf,
}
