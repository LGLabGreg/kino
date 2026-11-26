'use client'

import {
  type CategoryChartProps,
  type EntrancePhase,
  figureProps,
  IndexActive,
  pickedName,
  ShareTooltipContent,
  useChartActive,
  useChartLife,
  useChartLoad,
  useChartPick,
  useIndexFocus,
} from '@/registry/lib/chart-base'
import { ChartCentreText } from '@/registry/lib/chart-centre'
import type { ChartPattern } from '@/registry/lib/chart-math'
import {
  arcAt,
  arcBox,
  type ArcFractions,
  arcLabelFit,
  arcLabelSpin,
  arcLabelTransform,
  arcPath,
  outerPoint,
  type RingRoom,
  round,
} from '@/registry/lib/chart-radial'
import {
  ChartFrame,
  type ChartRootValue,
  ChartSvgPattern,
  drawingFrame,
  drawingSize,
  forcedSeriesColor,
  forcedSeriesTextColor,
  labelOnClassName,
  plotLayerClassName,
  stepBackInkClassName,
  swatchClassName,
  useChartFocus,
  useChartRootValue,
  useLeaving,
  usePointsMove,
} from '@/registry/lib/chart-root'
import {
  arcFrom,
  middleOf,
  type ArcPlace,
  arcTo,
  placeBetween,
  type RingArc,
  ringLayout,
  type RingLayout,
  ringTree,
  type TileNode,
  tileAncestors,
  tileNodeAt,
  tileTree,
  topColor,
} from '@/registry/lib/chart-tiles'
import {
  TreeZoomContext,
  TreeZoomPath,
  useTreeZoomRoot,
} from '@/registry/lib/chart-tree-path'
import {
  groupTarget,
  treeItem,
  type TreeStop,
  treeReader,
} from '@/registry/lib/chart-tree-reader'
import { numberFormatter } from '@/registry/lib/number-format'
import {
  placeholderBreatheClassName,
  placeholderInkClassName,
} from '@/registry/lib/placeholder'
import {
  type ComponentProps,
  createContext,
  type CSSProperties,
  memo,
  type ReactNode,
  use,
  useRef,
  useState,
} from 'react'

import { cn } from '@/lib/utils'

/*
 * The Sunburst chart: a tree as rings round a centre, each ring a level and
 * each arc a part of its parent, as large as its value, in the colour of
 * the top of the tree it is under. A press on an arc with parts zooms into
 * it until it rings the centre, and a press on the centre, Escape, or the
 * path above the chart zooms back out. The arc under the pointer or the
 * keys and its path to the centre stay bright while the rest step back, and
 * new data moves every arc from where it is. A path's shape can't
 * transition, so every arc's angles and radii follow the chart's clock.
 */

interface SunburstChartProps extends Omit<
  CategoryChartProps,
  | 'domain'
  | 'tickCount'
  | 'tickValues'
  | 'allowDecimals'
  | 'ordered'
  | 'selected'
  | 'defaultSelected'
  | 'onSelectedChange'
  | 'color'
> {
  /** The key of each row's value in the data. A row with `children` is worth them added up. */
  dataKey: string
  /** What the values are, such as "Size": the centre's caption, and the tooltip's and the data table's word for them. */
  valueLabel?: string
  /** The part zoomed into, as the `index` values from the top down to it; `[]`, the whole, by default. */
  zoom?: string[]
  defaultZoom?: string[]
  onZoomChange?: (zoom: string[]) => void
  /** What each arc writes on itself, where it has the room: its name, or nothing. */
  labels?: 'name' | 'none'
  /** The hole's radius as a share of the chart's, from 0, no hole, to 0.8. */
  innerRadius?: number
  /** Each part's arcs biggest first; `false` keeps the data's order. */
  sort?: boolean
  /**
   * How the arcs arrive the first time the chart comes into view: drawn
   * round from the top, or simply there, the default, since a page that
   * loads doesn't animate into place.
   */
  entrance?: 'draw' | 'none'
}

const sunburstChartKeys = [
  'dataKey',
  'valueLabel',
  'zoom',
  'defaultZoom',
  'onZoomChange',
  'labels',
  'innerRadius',
  'sort',
  'entrance',
]

/** How far each level below the top steps toward the background. */
const LEVEL_LIFT = 0.18

/** The furthest a level steps. */
const MOST_LIFT = 0.6

interface SunburstContextValue {
  layout: RingLayout
  /** The arcs in view, in the order the keys step through them. */
  stops: readonly TreeStop[]
  /** The view's worth, the hidden tops' left out. */
  viewValue: number
  valueLabel: string
  innerRadius: number
  room: RingRoom
  nameOf: (node: TileNode) => string
  colorOf: (arc: RingArc) => string
}

const SunburstContext = createContext<SunburstContextValue | null>(null)

function useSunburstChart() {
  const sunburst = use(SunburstContext)
  if (!sunburst) throw new Error('Sunburst chart parts go inside a `SunburstChart`.')
  return sunburst
}

/**
 * The chart's root: the tree from the rows, laid round the turn, the part
 * of it in view as up to three rings, and the frame its centre, path,
 * legend and tooltip draw in.
 */
function SunburstChart(props: SunburstChartProps) {
  const {
    data,
    index,
    dataKey,
    valueLabel,
    labels = 'name',
    innerRadius = 0.4,
    sort = true,
    entrance = 'none',
    messages,
    description,
    empty,
    className,
    ref,
  } = props
  const tree = tileTree(data, index, dataKey)
  const { state, groups, hidden, view, nameOf, valueOf, zoomTo } = useTreeZoomRoot(
    {
      ...props,
      messages: {
        series: 'Branches',
        allHidden: 'Every branch is hidden',
        showAll: (count) => `Show all ${count} branches`,
        ...messages,
      },
    },
    tree,
    { entrance: entrance !== 'none' },
  )
  const { messages: words, locale, direction } = state

  // The arcs in view, in the order the keys step through them.
  const load = useChartLoad(props)
  const places = load.placeholder || load.failed ? [] : ringTree(tree, { hidden, sort })
  const layout = ringLayout(view, places)
  const stops: TreeStop[] = layout.arcs.map((arc, at) => ({
    id: arc.key,
    name: nameOf(arc.node),
    value: arc.node.value,
    datum: arc.node.datum,
    index: at,
  }))
  const life = useChartLife(
    props,
    state,
    load,
    {
      rows: layout.arcs.length,
      shown: state.series.filter((key) => !hidden.includes(key)).length,
      drawn: stops.length,
    },
    { entrance: entrance !== 'none', cascade: null },
  )
  const { status, phase } = life
  // Its props leave out `selected`, so nothing is picked; a press opens or does nothing.
  const pick = useChartPick({}, stops.map(stopId))

  const size = drawingSize(state.plotSize)
  const edge = Math.max(0, Math.min(size.width, size.height) / 2 - 0.5)
  const hole = Math.min(0.8, Math.max(0, innerRadius))
  const room: RingRoom = { hole: edge * hole, edge }

  // The whole the shares are of: the tops shown, added up.
  const wholeValue = layout.arcs.length === 0 ? 0 : sumTops(places)
  const viewValue = view.path.length === 0 ? wholeValue : view.value
  const percent = numberFormatter(locale, {
    style: 'percent',
    maximumFractionDigits: 1,
  })
  const parentOf = (node: TileNode) => tileNodeAt(tree, node.path.slice(0, -1))
  const shareOf = (value: number, of: number) => percent.format(of === 0 ? 0 : value / of)
  const label = valueLabel ?? words.value
  /** The names from the top down to `node`, the whole left out. */
  const pathOf = (node: TileNode) =>
    [...tileAncestors(tree, node).slice(1), node].map((part) => nameOf(part))
  const colorOf = (arc: RingArc) =>
    levelColor(topColor(state.series, groups, arc.top), arc.depth)

  const arcOf = (stop: TreeStop) => layout.arcs[stop.index]
  const opens = (node: TileNode | undefined) =>
    node && node.children.length > 0 ? () => zoomTo(node.path) : null
  const back = view.path.length > 0 ? () => zoomTo(view.path.slice(0, -1)) : null
  const under = (point: { x: number; y: number; width: number; height: number }) =>
    arcAt(point.x - point.width / 2, point.y - point.height / 2, layout.arcs, room)

  const reader = treeReader({
    stops,
    direction,
    hit: (point) => {
      const found = under(point)
      if (!found) return null
      // The hole stands for the part in view, which a press there leaves.
      if (found.kind === 'hole') return back ? { kind: 'group', key: view.key } : null
      return { kind: 'stop', index: found.index }
    },
    openAt: (point) => {
      const found = under(point)
      if (!found) return null
      return found.kind === 'hole' ? back : opens(layout.arcs[found.index]?.node)
    },
    open: (stop) => opens(arcOf(stop)?.node),
    back,
    // The tooltip sits on the arc's outer edge, at its middle, opening away from the centre.
    anchor: (stop) => {
      const arc = arcOf(stop)
      if (!arc || size.width === 0 || size.height === 0) return null
      return outerPoint(
        (arc.start + arc.end) / 2,
        size.width,
        size.height,
        arcBox(arc, room).outer,
      )
    },
    words: {
      describe: (stop) => {
        const arc = arcOf(stop)
        const name = pickedName(stop.name, pick.picked === stop.id, words)
        if (!arc) return name
        const parent = parentOf(arc.node)
        const parts = [
          name,
          valueOf(arc.node),
          ...(arc.depth > 1
            ? [words.shareOf(shareOf(arc.node.value, parent.value), nameOf(parent))]
            : []),
          words.shareOf(shareOf(arc.node.value, wholeValue), nameOf(tree)),
          words.level(arc.depth),
        ]
        return parts.join(', ')
      },
      table: {
        header: words.category,
        columns: [words.group, label, words.share, words.ofPart(nameOf(tree))],
        rows: stops.map((stop) => {
          const arc = arcOf(stop)
          const node = arc?.node
          const parent = node ? parentOf(node) : tree
          const parentValue = node && node.path.length > 1 ? parent.value : wholeValue
          return {
            key: stop.id,
            name: stop.name,
            cells: [
              node ? pathOf(node).slice(0, -1).join(' / ') : '',
              node ? valueOf(node) : words.noValue,
              shareOf(node?.value ?? 0, parentValue),
              shareOf(node?.value ?? 0, wholeValue),
            ],
          }
        }),
        footer: [],
      },
      tooltip: (stop) => {
        const arc = arcOf(stop)
        if (!arc) return null
        const value = valueOf(arc.node)
        const parent = parentOf(arc.node)
        const slot = state.series.indexOf(arc.top)
        return (
          <ShareTooltipContent
            chart={state}
            category={treeItem(stop)}
            name={pathOf(arc.node).join(' / ')}
            rows={
              arc.depth > 1
                ? [
                    {
                      label: words.ofPart(nameOf(parent)),
                      value,
                      share: shareOf(arc.node.value, parent.value),
                    },
                    {
                      label: words.ofPart(nameOf(tree)),
                      value: null,
                      share: shareOf(arc.node.value, wholeValue),
                    },
                  ]
                : [
                    {
                      label: null,
                      value,
                      share: shareOf(arc.node.value, wholeValue),
                    },
                  ]
            }
            swatch={
              <span
                aria-hidden
                className={cn(swatchClassName, forcedSeriesColor(slot === -1 ? 0 : slot))}
                style={{ '--swatch': colorOf(arc) } as CSSProperties}
              />
            }
          />
        )
      },
    },
  })
  const root: ChartRootValue = {
    ...state,
    status,
    reader,
    markerOf: () => null,
    selectable: pick.selectable,
    picked: pick.picked === null ? null : { kind: 'node', id: pick.picked },
    togglePicked: (target) => {
      if (target.kind === 'node' && reader.holds(target)) pick.toggle(target.id)
    },
  }
  const { focusProps, toldRef } = useIndexFocus(reader.items, props)

  return (
    <TreeZoomContext value={{ tree, view, zoomTo, nameOf }}>
      <SunburstContext
        value={{
          layout,
          stops,
          viewValue,
          valueLabel: label,
          innerRadius: hole,
          room,
          nameOf,
          colorOf,
        }}
      >
        <ChartFrame
          root={root}
          focus={focusProps}
          ref={ref}
          slot='sunburst-chart'
          description={description}
          empty={empty}
          measuring={false}
          inset={0}
          data-orientation='vertical'
          className={className}
          {...figureProps(props, sunburstChartKeys)}
        >
          <IndexActive items={reader.items} active={props} toldRef={toldRef}>
            <SunburstArcs labels={labels} phase={phase} />
            {props.children}
            {load.placeholder && <SunburstPlaceholder />}
          </IndexActive>
        </ChartFrame>
      </SunburstContext>
    </TreeZoomContext>
  )
}

function stopId(stop: TreeStop) {
  return stop.id
}

function arcKey(arc: RingArc) {
  return arc.key
}

/** What the tops shown are worth together: the whole the chart's shares are of. */
function sumTops(places: readonly { depth: number; node: TileNode }[]) {
  return places.reduce(
    (sum, place) => (place.depth === 1 ? sum + place.node.value : sum),
    0,
  )
}

/**
 * The colour of an arc `depth` levels below the whole: its top's, a step
 * nearer the page's background for each level below the top, lighter in
 * light mode and darker in dark, so the rings read as one branch from the
 * centre out and the deeper ones step back.
 */
function levelColor(color: string, depth: number) {
  const lift = levelLift(depth)
  if (lift === 0) return color
  return `color-mix(in oklch, ${color} ${round((1 - lift) * 100)}%, var(--background))`
}

/** How far a level is from its top's colour, as a share of the way to the background. */
function levelLift(depth: number) {
  return round(Math.min(MOST_LIFT, Math.max(0, depth - 1) * LEVEL_LIFT))
}

/** What tells one layout from another: the view, its rings and every arc's place, to five places. */
function layoutSignature(layout: RingLayout) {
  const arcs = layout.arcs
    .map((arc) =>
      [arc.key, arc.start, arc.end, arc.inner, arc.outer]
        .map((part) => (typeof part === 'number' ? part.toFixed(5) : part))
        .join(':'),
    )
    .join('|')
  return `${layout.view.key}#${layout.rings}#${arcs}`
}

/** An arc as the chart draws it: its place, and how far its label turns past the arc's direction. */
interface ArcPoint extends ArcPlace {
  key: string
  spin: number
}

/** An arc's move: where it is drawn now, and where it goes. */
interface ArcMove {
  key: string
  from: ArcPoint
  to: ArcPoint
}

function pointsSignature(points: readonly ArcPoint[]) {
  return points
    .map((point) =>
      [point.key, point.start, point.end, point.inner, point.outer, point.spin]
        .map((part) => (typeof part === 'number' ? part.toFixed(5) : part))
        .join(':'),
    )
    .join('|')
}

/** The middle of an arc's turn. */
function middleTurn(place: ArcFractions) {
  return (place.start + place.end) / 2
}

/**
 * Every arc, in its branch's colour, a step lighter for each level, with
 * its name on it where it fits. The arc under the pointer and its path to
 * the centre stay bright while the rest step back. Each frame of a move
 * writes every arc's path and label where it is, from where it was drawn.
 */
function SunburstArcs({
  labels,
  phase,
}: {
  labels: 'name' | 'none'
  phase: EntrancePhase
}) {
  const chart = useChartRootValue()
  const { spotlit } = useChartActive()
  const { focus } = useChartFocus()
  const sunburst = useSunburstChart()
  const { layout, room } = sunburst
  // The layout shown before this one, which what arrives comes from.
  const signature = layoutSignature(layout)
  const [held, setHeld] = useState<{
    signature: string
    now: RingLayout
    was: RingLayout | null
  }>({ signature, now: layout, was: null })
  if (held.signature !== signature) setHeld({ signature, now: layout, was: held.now })
  const was = held.signature === signature ? held.was : held.now
  const leaving = useLeaving(chart.moves, layout.arcs, arcKey)
  const measured = chart.plotSize.width > 0 && chart.plotSize.height > 0
  const { width, height } = drawingSize(chart.plotSize)
  const waiting = phase === 'waiting'
  const entering = phase === 'entering'

  // Where each arc goes, and how its label lies there.
  const fits = new Map(
    layout.arcs.map((arc) => {
      const fit =
        labels === 'none' || !measured
          ? 'none'
          : arcLabelFit(arcBox(arc, room), chart.textWidth(sunburst.nameOf(arc.node)))
      return [arc.key, fit] as const
    }),
  )
  const spinOf = (key: string, place: ArcPlace) => {
    const fit = fits.get(key)
    return arcLabelSpin(fit === 'across' ? 'across' : 'along', middleTurn(place))
  }
  const current: ArcPoint[] = layout.arcs.map((arc) => {
    // Before the entrance, every arc waits folded to nothing at the top.
    const place: ArcPlace = waiting
      ? { start: 0, end: 0, inner: arc.inner, outer: arc.outer }
      : arc
    return { key: arc.key, ...placeOf(place), spin: spinOf(arc.key, arc) }
  })
  const gone: ArcPoint[] = leaving.map((arc) => {
    const place = arcTo(arc, layout)
    return {
      key: arc.key,
      ...placeOf(place),
      spin: arcLabelSpin('along', middleTurn(arc)),
    }
  })
  const to = [...current, ...gone]
  const arriving = new Map(
    layout.arcs.map((arc) => [arc.key, arcFrom(arc, was)] as const),
  )
  const paths = useRef(new Map<string, SVGPathElement>())
  const words = useRef(new Map<string, SVGTextElement>())
  // One function for the chart's life, so the memoised arcs keep theirs.
  const [register] = useState(
    () =>
      (
        key: string,
        kind: 'path' | 'text',
        element: SVGPathElement | SVGTextElement | null,
      ) => {
        const into = kind === 'path' ? paths.current : words.current
        if (element) into.set(key, element as SVGPathElement & SVGTextElement)
        else into.delete(key)
      },
  )
  const draw = (points: readonly ArcPoint[]) => {
    for (const point of points) {
      paths.current.get(point.key)?.setAttribute('d', arcPath(point, room))
      const text = words.current.get(point.key)
      if (text) {
        const box = arcBox(point, room)
        text.setAttribute(
          'transform',
          arcLabelTransform(middleTurn(point), (box.inner + box.outer) / 2, point.spin),
        )
      }
    }
  }
  usePointsMove<ArcPoint, readonly ArcMove[]>(
    // The entrance draws the arcs round from the top; every change after moves them.
    entering ? 'draw' : 'layout',
    to,
    pointsSignature(to),
    // With none drawn yet, such as after the placeholder, each grows from its middle.
    to.map((point) => ({
      ...point,
      start: middleTurn(point),
      end: middleTurn(point),
    })),
    `${round(room.hole)}:${round(room.edge)}`,
    {
      align: (from, next) => {
        const drawn = new Map(from.map((point) => [point.key, point]))
        return next.map((point) => {
          const place = arriving.get(point.key)
          return {
            key: point.key,
            from: drawn.get(point.key) ?? {
              ...point,
              ...placeOf(place ? place : middleOf(point)),
            },
            to: point,
          }
        })
      },
      at: (moves, progress) =>
        moves.map(({ key, from, to: end }) => ({
          key,
          ...placeBetween(from, end, progress),
          spin: from.spin + (end.spin - from.spin) * progress,
        })),
      draw,
    },
  )
  if (chart.status === 'empty') return null
  const lit = spotlit === null ? null : (layout.arcs[spotlit]?.node.path ?? null)
  const brightens = (path: readonly string[]) =>
    lit !== null &&
    path.length <= lit.length &&
    path.every((name, at) => lit[at] === name)
  // Brought forward from the legend: a top, whose branch alone stays bright.
  const emphasis =
    chart.emphasis !== null && chart.series.includes(chart.emphasis)
      ? chart.emphasis
      : null
  // The hole itself under the pointer, which zooms out; not the legend's item for the same branch.
  const holeLit =
    layout.view.path.length > 0 &&
    focus?.kind === 'node' &&
    focus.id === groupTarget(layout.view.key)
  const drawn = [
    ...layout.arcs.map((arc) => ({ arc, leaving: false })),
    ...leaving.map((arc) => ({ arc, leaving: true })),
  ]
  const points = new Map(to.map((point) => [point.key, point]))
  return (
    <div
      data-slot='sunburst-chart-arcs'
      aria-hidden
      className={cn(plotLayerClassName, 'z-10')}
    >
      <svg
        className='absolute inset-0 size-full overflow-visible'
        viewBox={`0 0 ${round(width)} ${round(height)}`}
        {...drawingFrame(chart.plotSize, 'xMidYMid meet')}
      >
        <g transform={`translate(${round(width / 2)} ${round(height / 2)})`}>
          {room.hole > 0 && (
            <circle
              r={round(Math.max(0, room.hole - 1))}
              data-lit={holeLit ? '' : undefined}
              className='fill-transparent transition-[fill] duration-(--motion-layout-duration) ease-(--motion-layout-fade-easing) data-lit:fill-muted forced-colors:data-lit:fill-[Highlight]'
            />
          )}
          {drawn.map(({ arc, leaving: gone }, at) => {
            const point = points.get(arc.key)
            if (!point) return null
            const slot = chart.series.indexOf(arc.top)
            const name = sunburst.nameOf(arc.node)
            const fit = gone || waiting ? 'none' : (fits.get(arc.key) ?? 'none')
            const dim =
              !gone &&
              ((lit !== null && !brightens(arc.node.path)) ||
                (emphasis !== null && emphasis !== arc.top))
            const box = arcBox(point, room)
            return (
              <SunburstArc
                key={arc.key}
                arcKey={arc.key}
                register={register}
                id={`${chart.id}-arc-${at}`}
                d={arcPath(point, room)}
                labelAt={arcLabelTransform(
                  middleTurn(point),
                  (box.inner + box.outer) / 2,
                  point.spin,
                )}
                color={sunburst.colorOf(arc)}
                slot={slot === -1 ? 0 : slot}
                pattern={slot === -1 ? 'solid' : chart.patternOf(arc.top)}
                dim={dim}
                leaving={gone}
                entering={entering}
                name={fit === 'none' ? null : name}
              />
            )
          })}
        </g>
      </svg>
    </div>
  )
}

/** An arc's place alone, without what else a point or an arc carries. */
function placeOf(place: ArcPlace): ArcPlace {
  return {
    start: place.start,
    end: place.end,
    inner: place.inner,
    outer: place.outer,
  }
}

/**
 * One arc and its label. Memoised, so a pointer moving between arcs redraws
 * only the ones it lights or dims; a move writes their paths directly.
 */
const SunburstArc = memo(function SunburstArc({
  arcKey: key,
  register,
  id,
  d,
  labelAt,
  color,
  slot,
  pattern,
  dim,
  leaving,
  entering,
  name,
}: {
  arcKey: string
  /** Hands the chart the arc's path and label, which each frame of a move writes. */
  register: (
    key: string,
    kind: 'path' | 'text',
    element: SVGPathElement | SVGTextElement | null,
  ) => void
  id: string
  d: string
  labelAt: string
  color: string
  slot: number
  pattern: ChartPattern
  dim: boolean
  leaving: boolean
  entering: boolean
  /** The name written on the arc, or none where it doesn't fit. */
  name: string | null
}) {
  // An arc that has never had room for its name draws no label at all, so a chart of hundreds
  // of small arcs styles only the elements it shows.
  const [labelled, setLabelled] = useState(name !== null)
  if (name !== null && !labelled) setLabelled(true)
  const [said, setSaid] = useState(name)
  if (name !== null && name !== said) setSaid(name)
  const patternId = `${id}-pattern`
  return (
    <g
      data-dim={dim ? '' : undefined}
      data-leaving={leaving ? '' : undefined}
      data-entering={entering ? '' : undefined}
      className={cn(
        'text-(--mark-ink) transition-none duration-(--motion-layout-duration) ease-[var(--motion-layout-fade-easing),var(--motion-layout-fade-easing)] group-data-mounted/chart:transition-[color,opacity] group-data-mounted/chart:starting:opacity-0 data-leaving:opacity-0 data-leaving:duration-(--motion-exit-duration) data-leaving:ease-[var(--motion-exit-fade-easing),var(--motion-exit-fade-easing)] data-entering:duration-(--motion-draw-duration)',
        stepBackInkClassName,
        forcedSeriesTextColor(slot),
      )}
      style={{ '--mark-color': color } as CSSProperties}
    >
      {pattern !== 'solid' && <ChartSvgPattern id={patternId} pattern={pattern} />}
      <path
        ref={(element) => register(key, 'path', element)}
        d={d}
        style={{
          fill: pattern === 'solid' ? 'currentColor' : `url(#${patternId})`,
        }}
      />
      {labelled && (
        <text
          ref={(element) => register(key, 'text', element)}
          transform={labelAt}
          textAnchor='middle'
          dominantBaseline='central'
          data-off={name === null ? '' : undefined}
          className={cn(
            'text-xs font-medium [fill:currentColor] transition-none group-data-mounted/chart:transition-opacity duration-(--motion-layout-duration) ease-(--motion-layout-fade-easing) data-off:opacity-0',
            labelOnClassName,
          )}
          style={{ '--label-on': color } as CSSProperties}
        >
          {/* A label that no longer fits keeps its words while it fades. */}
          {said}
        </text>
      )}
    </g>
  )
})

/** The rings in the placeholder's tint, breathing slowly, while the data loads. */
function SunburstPlaceholder() {
  const chart = useChartRootValue()
  const { room } = useSunburstChart()
  const { width, height } = drawingSize(chart.plotSize)
  const layout = ringLayout(PLACEHOLDER_TREE, ringTree(PLACEHOLDER_TREE))
  return (
    <div
      data-slot='sunburst-chart-placeholder'
      aria-hidden
      className={cn(plotLayerClassName, 'z-10', placeholderBreatheClassName)}
    >
      <svg
        className={cn(
          'absolute inset-0 size-full overflow-visible',
          placeholderInkClassName,
        )}
        viewBox={`0 0 ${round(width)} ${round(height)}`}
        {...drawingFrame(chart.plotSize, 'xMidYMid meet')}
      >
        <g transform={`translate(${round(width / 2)} ${round(height / 2)})`}>
          {layout.arcs.map((arc) => (
            <path key={arc.key} d={arcPath(arc, room)} className='fill-current' />
          ))}
        </g>
      </svg>
    </div>
  )
}

/** The shape the placeholder's rings take: a few branches of falling size, each with a few parts. */
const PLACEHOLDER_TREE = tileTree(
  [
    [14, 9, 6],
    [10, 7],
    [8, 4, 3],
    [5, 3],
  ].map((parts, at) => ({
    name: String(at),
    children: parts.map((value, part) => ({ name: String(part), value })),
  })),
  'name',
  'value',
)

/**
 * What sits in the hole: the worth of the part in view, under the chart's
 * `valueLabel` at the whole or the part's name once zoomed in, and the value
 * and name of the arc under the pointer or the keys, rolling in as it
 * changes. A press on it zooms back out. A hole too small for words draws
 * nothing there.
 */
function SunburstChartCentre({
  label,
  className,
  style,
  ...props
}: Omit<ComponentProps<'div'>, 'children'> & {
  /** The caption under the whole's worth; the chart's `valueLabel` by default. */
  label?: ReactNode
}) {
  const chart = useChartRootValue()
  const { spotlit } = useChartActive()
  const sunburst = useSunburstChart()
  if (chart.status !== 'ready' || sunburst.innerRadius < 0.3) return null
  const arc = spotlit === null ? undefined : sunburst.layout.arcs[spotlit]
  const view = sunburst.layout.view
  const value = arc ? arc.node.value : sunburst.viewValue
  const caption = arc
    ? sunburst.nameOf(arc.node)
    : view.path.length > 0
      ? sunburst.nameOf(view)
      : (label ?? sunburst.valueLabel)
  const hole = sunburst.room.hole * 2
  const drawn = drawingSize(chart.plotSize)
  return (
    <div
      data-slot='sunburst-chart-centre'
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

/**
 * The way back out: the path of the parts above the one in view, the whole
 * first, each a button that zooms out to it, above the plot.
 */
function SunburstChartPath(props: ComponentProps<'nav'>) {
  return <TreeZoomPath slot='sunburst-chart-path' {...props} />
}

export {
  levelColor,
  levelLift,
  SunburstChart,
  SunburstChartCentre,
  SunburstChartPath,
  type SunburstChartProps,
}
