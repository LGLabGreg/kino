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
import { CellStepLegend, StepLegendContext } from '@/registry/lib/chart-cells'
import { stepEdges, stepExtent, stepOf, stepStrength } from '@/registry/lib/chart-grid'
import { allWhole, numberOf } from '@/registry/lib/chart-math'
import {
  type ChartFormat,
  ChartFrame,
  type ChartRootValue,
  forcedSeriesColor,
  formatterOf,
  isMeasured,
  labelOnClassName,
  plotLayerClassName,
  type PlotPoint,
  swatchClassName,
  useChartRootValue,
  useLeaving,
} from '@/registry/lib/chart-root'
import { linearScale } from '@/registry/lib/chart-scale'
import {
  circleLabelFit,
  packAt,
  type PackedCircle,
  type PackLayout,
  packLayout,
  packPoint,
  packView,
  type PackView,
  startsWith,
  type TileNode,
  tileNodeAt,
  tileTree,
  topColor,
} from '@/registry/lib/chart-tiles'
import {
  TreeZoomContext,
  TreeZoomPath,
  useTreeZoomRoot,
} from '@/registry/lib/chart-tree-path'
import { treeItem, type TreeStop, treeReader } from '@/registry/lib/chart-tree-reader'
import { numberFormatter } from '@/registry/lib/number-format'
import {
  placeholderBreatheClassName,
  placeholderFillClassName,
} from '@/registry/lib/placeholder'
import { SwapText } from '@/registry/lib/swap'
import {
  type ComponentProps,
  createContext,
  type CSSProperties,
  memo,
  type RefObject,
  use,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'

import { cn } from '@/lib/utils'

/*
 * The Circle packing chart: a whole as circles packed inside each other,
 * each leaf as large as its value. A row's `children` are the circles inside
 * it; rows with none pack into one cloud of bubbles. The part in view fills
 * the chart's round window, its circles coloured by the top of the tree they
 * are under or by a value of their own, and a press on a group zooms into it
 * as one move of the whole layer. The way back out, Escape, or the path
 * above the chart zoom out again. The circle under the pointer or the keys
 * stays bright while the rest step back, and new data moves every circle
 * from where it is.
 */

interface CirclePackingChartProps extends Omit<
  CategoryChartProps,
  | 'domain'
  | 'tickCount'
  | 'tickValues'
  | 'allowDecimals'
  | 'ordered'
  | 'patterns'
  | 'selected'
  | 'defaultSelected'
  | 'onSelectedChange'
> {
  /** The key of each row's value in the data: a circle's area. A row with `children` is worth them added up. */
  dataKey: string
  /** What the values are, such as "Spend": the tooltip's, the size key's and the data table's word for them. */
  valueLabel?: string
  /** The part zoomed into, as the `index` values from the top down to it; `[]`, the whole, by default. */
  zoom?: string[]
  defaultZoom?: string[]
  onZoomChange?: (zoom: string[]) => void
  /** What each circle of the part in view writes on itself, where it has the room: its name and value, its name, or nothing. */
  labels?: 'value' | 'name' | 'none'
  /** The key of a second value to colour the circles by, such as a change, in place of their group's colour. */
  colorKey?: string
  /** What the `colorKey` values are, such as "Change": the legend's, the tooltip's and the table's word for them. */
  colorLabel?: string
  /** How the `colorKey` values are written. */
  colorFormat?: ChartFormat
  /**
   * How the circles arrive the first time the chart comes into view:
   * growing from their centres, or simply there, the default, since a page
   * that loads doesn't animate into place.
   */
  entrance?: 'draw' | 'none'
}

const circlePackingChartKeys = [
  'dataKey',
  'valueLabel',
  'zoom',
  'defaultZoom',
  'onZoomChange',
  'labels',
  'colorKey',
  'colorLabel',
  'colorFormat',
  'entrance',
]

/** The room between two circles, and inside a group's edge, in px of the whole. */
const PADDING = 3

/** How far from a circle, in px, the pointer still lights it: across the gaps between the circles in view. */
const NEAR_CIRCLE = 8

/**
 * Each circle is a disc this many px across, scaled to its size, so a new
 * size is a transform rather than a box laid out again. 100 keeps the
 * scale a plain fraction of the radius.
 */
const DISC = 100

/** The room a group's name chip adds to its width, in px. */
const GROUP_CHIP = 12

/** The size key's largest circle, in px across its radius. */
const KEY_RADIUS = 28

interface CirclePackingContextValue {
  /** A circle's radius on screen for each square root of value, in the part in view; none with nothing packed. */
  perValue: number | null
  /** Whether the plot is measured: until it is, the key keeps its room with nothing in it, so the plot doesn't move when it fills. */
  measured: boolean
  valueLabel: string
  valueText: (value: number) => string
}

const CirclePackingContext = createContext<CirclePackingContextValue | null>(null)

function useCirclePacking() {
  const packing = use(CirclePackingContext)
  if (!packing)
    throw new Error('Circle packing chart parts go inside a `CirclePackingChart`.')
  return packing
}

/** How a circle is filled: its colour, the slot and the way forced colours draw it, and whether it is a group's tint. */
interface CircleFill {
  color: string
  slot: number
  group: boolean
  /** In forced colours: the series' system colour, a faint wash, or the page's text at a step's strength. */
  forced: 'series' | 'faint' | number
}

/** A label of a circle of the part in view: where it sits now and where it came from, in px of the plot. */
interface PackLabel {
  key: string
  x: number
  y: number
  fromX: number
  fromY: number
  name: string
  value: string | null
  group: boolean
  color: string
}

/**
 * The chart's root: the tree from the rows, the part of it in view, its
 * circles packed in the plot, and the colour each takes, with the frame its
 * path, legends and tooltip draw in.
 */
function CirclePackingChart(props: CirclePackingChartProps) {
  const {
    data,
    index,
    dataKey,
    config,
    valueLabel,
    labels = 'value',
    colorKey,
    colorLabel,
    colorFormat,
    entrance = 'none',
    description,
    empty,
    className,
    ref,
  } = props
  const tree = tileTree(data, index, dataKey)
  const { state, hidden, view, nameOf, valueOf, zoomTo, region } = useTreeZoomRoot(
    props,
    tree,
    {
      entrance: entrance !== 'none',
    },
  )
  const { messages: words, valueText, locale, direction } = state

  const load = useChartLoad(props)
  const size = state.plotSize
  const layout = packLayout(tree, {
    width: size.width,
    height: size.height,
    padding: PADDING,
    direction,
    hidden,
  })
  const shown = packView(layout, view)
  // While the placeholder or the error stands in for the data, no circle is drawn.
  const circles = load.placeholder || load.failed ? [] : layout.circles
  // The circles inside the part in view, in the order the keys step through them: the
  // layout's, depth first, biggest first, without a hidden group's.
  const inside = circles
    .filter(
      (circle) => circle.key !== view.key && startsWith(circle.node.path, view.path),
    )
    .map((circle) => circle.node)
  const stops: TreeStop[] = inside.map((node, at) => ({
    id: node.key,
    name: nameOf(node),
    value: node.value,
    datum: node.datum,
    index: at,
  }))
  const nodes = new Map(inside.map((node) => [node.key, node]))
  const life = useChartLife(
    props,
    state,
    load,
    {
      rows: inside.length,
      shown: state.series.filter((key) => !hidden.includes(key)).length,
      drawn: stops.length,
    },
    { entrance: entrance !== 'none', cascade: null },
  )
  const { status, phase } = life
  // Its props leave out `selected`, so nothing is picked; a press opens or does nothing.
  const pick = useChartPick(
    {},
    stops.map((stop) => stop.id),
  )

  // A second value's colour: a step of a ramp from zero, one way for below and the other for above.
  const colorValues = colorKey
    ? leavesOf(tree).map((node) => numberOf(node.datum[colorKey]))
    : []
  const colorScale = linearScale(stepExtent(colorValues), {
    tickCount: 5,
    nice: true,
    allowDecimals: colorKey
      ? !allWhole(
          leavesOf(tree).map((node) => node.datum),
          [colorKey],
        )
      : false,
  })
  const edges = colorKey ? stepEdges(colorScale.domain, colorScale.ticks) : []
  const colorText = formatterOf(locale, colorFormat)
  const colorName = colorLabel ?? colorKey ?? ''
  const [stepEmphasis, setStepEmphasis] = useState<number | null>(null)
  const zoomRef = useRef<HTMLDivElement>(null)
  const labelsRef = useRef<HTMLDivElement>(null)
  const colorOf = (node: TileNode): number | null =>
    colorKey ? numberOf(node.datum[colorKey]) : null
  const fillOf = (circle: PackedCircle): CircleFill => {
    const slot = Math.max(0, state.series.indexOf(circle.top))
    const group = circle.node.children.length > 0
    if (colorKey) {
      if (group) return { color: NEUTRAL_TINT, slot, group, forced: 'faint' }
      const step = stepOf(colorOf(circle.node), edges)
      return {
        color: step === null ? 'var(--muted)' : divergingFill(step, edges),
        slot,
        group,
        forced: step === null ? 'faint' : divergingStep(step, edges).strength,
      }
    }
    const color = topColor(state.series, config, circle.top)
    return group
      ? { color: groupTint(color), slot, group, forced: 'faint' }
      : { color, slot, group, forced: 'series' }
  }

  const viewTotal = view.children
    .filter((child) => view.path.length > 0 || !hidden.includes(child.path[0] ?? ''))
    .reduce((sum, child) => sum + child.value, 0)
  const percent = numberFormatter(locale, {
    style: 'percent',
    maximumFractionDigits: 1,
  })
  const shareOf = (node: TileNode) => (viewTotal === 0 ? 0 : node.value / viewTotal)
  const label = valueLabel ?? words.value
  /** The groups between the part in view and `node`, by name: where it sits. */
  const placeOf = (node: TileNode) =>
    node.path
      .slice(view.path.length, -1)
      .map((_, at) =>
        nameOf(tileNodeAt(tree, node.path.slice(0, view.path.length + at + 1))),
      )
      .join(' / ')
  const anyDeep = inside.some((node) => node.path.length > view.path.length + 1)
  const colourCell = (node: TileNode) => {
    const value = colorOf(node)
    return value === null ? words.noValue : colorText(value)
  }

  /** What a press or Enter on a circle zooms to: a group itself, a leaf's group, or nothing in view already. */
  const zoomFor = (node: TileNode | undefined) => {
    if (!node) return null
    const target =
      node.children.length > 0 ? node : tileNodeAt(tree, node.path.slice(0, -1))
    return target.key === view.key ? null : () => zoomTo(target.path)
  }
  const under = (point: PlotPoint) => packAt(point, layout, view, shown, NEAR_CIRCLE)

  const reader = treeReader({
    stops,
    direction,
    hit: (point) => {
      const key = under(point)
      const found = key === null ? -1 : stops.findIndex((stop) => stop.id === key)
      return found === -1 ? null : { kind: 'stop', index: found }
    },
    openAt: (point) => {
      const key = under(point)
      return key === null ? null : zoomFor(nodes.get(key))
    },
    open: (stop) => zoomFor(nodes.get(stop.id)),
    back: view.path.length > 0 ? () => zoomTo(view.path.slice(0, -1)) : null,
    // The tooltip sits above the circle's top, as fractions of the plot.
    anchor: (stop) => {
      const circle = layout.byKey.get(stop.id)
      if (!circle || !isMeasured(size)) return null
      const centre = packPoint(circle, shown)
      return {
        x: centre.x / size.width,
        y: (centre.y - circle.r * shown.k) / size.height,
        side: 'top',
      }
    },
    words: {
      describe: (stop) => {
        const node = nodes.get(stop.id)
        const name = pickedName(stop.name, pick.picked === stop.id, words)
        if (!node) return `${name}: `
        const place = placeOf(node)
        const value = `${label} ${valueOf(node)}, ${percent.format(shareOf(node))}`
        const colour = colorKey ? `, ${colorName} ${colourCell(node)}` : ''
        return `${name}: ${place ? `${place}, ` : ''}${value}${colour}`
      },
      table: {
        header: words.category,
        columns: [
          ...(anyDeep ? [words.group] : []),
          label,
          words.share,
          ...(colorKey ? [colorName] : []),
        ],
        // Only the leaves, so the rows add up to the footer's total: a group is the sum of its own.
        rows: inside.flatMap((node, at) =>
          node.children.length > 0
            ? []
            : [
                {
                  key: node.key,
                  name: stops[at]?.name ?? '',
                  cells: [
                    ...(anyDeep ? [placeOf(node)] : []),
                    valueOf(node),
                    percent.format(shareOf(node)),
                    ...(colorKey ? [colourCell(node)] : []),
                  ],
                },
              ],
        ),
        footer: [
          ...(anyDeep ? [''] : []),
          valueText(viewTotal),
          percent.format(viewTotal === 0 ? 0 : 1),
          ...(colorKey ? [''] : []),
        ],
      },
      tooltip: (stop) => {
        const node = nodes.get(stop.id)
        const circle = layout.byKey.get(stop.id)
        if (!node || !circle) return null
        const fill = fillOf(circle)
        const place = placeOf(node)
        const share = percent.format(shareOf(node))
        return (
          <ShareTooltipContent
            chart={state}
            category={treeItem(stop)}
            name={place ? `${place} / ${stop.name}` : stop.name}
            rows={
              colorKey
                ? [
                    { label, value: valueOf(node), share },
                    { label: colorName, value: colourCell(node), share: null },
                  ]
                : [{ label: null, value: valueOf(node), share }]
            }
            swatch={
              <span
                aria-hidden
                className={cn(swatchClassName, forcedSeriesColor(fill.slot))}
                style={{ '--swatch': fill.color } as CSSProperties}
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

  // Where the layer was drawn when the view last changed, and the labels that came with that
  // change, which start where their circles were then and ride the zoom in. Any other label
  // that arrives, with new data or a group shown again, starts in its own place.
  const viewSignature = `${view.key}#${shown.k}#${shown.x}#${shown.y}`
  const labelKeys = view.children.map((child) => child.key).join('\u0000')
  const [held, setHeld] = useState({
    signature: viewSignature,
    view: view.key,
    labelKeys,
    now: shown,
    was: shown,
    fresh: new Set<string>(),
    pending: false,
  })
  if (held.signature !== viewSignature) {
    const zoomed = held.view !== view.key
    setHeld({
      signature: viewSignature,
      view: view.key,
      labelKeys,
      now: shown,
      was: held.now,
      fresh: zoomed
        ? new Set(view.children.map((child) => child.key))
        : new Set<string>(),
      pending: zoomed,
    })
  } else if (held.labelKeys !== labelKeys) {
    setHeld({ ...held, labelKeys, fresh: new Set<string>(), pending: false })
  }
  // The zoom's labels wait one commit, before the frame paints, for where the layer is drawn
  // now: part way through a zoom turned elsewhere, it isn't the view before.
  useLayoutEffect(() => {
    if (!held.pending) return
    const drawn = drawnFrom(zoomRef.current)
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the layer's drawn place is known only once the zoom has committed
    setHeld((now) => ({ ...now, pending: false, was: drawn ?? now.was }))
  }, [held.pending])
  // The labels that just arrived began their moves a commit after the layer: start them with it.
  useLayoutEffect(() => {
    if (!held.pending && held.fresh.size > 0)
      alignMoves(zoomRef.current, labelsRef.current)
  }, [held])

  // The labels of the view's own circles, where they fit whole on screen.
  const ownLabels: PackLabel[] = []
  if (status === 'ready') {
    for (const child of view.children) {
      const circle = layout.byKey.get(child.key)
      if (!circle || circle.r <= 0) continue
      const name = nameOf(child)
      const group = child.children.length > 0
      const value = valueText(child.value)
      const fit = circleLabelFit(
        circle.r * shown.k,
        // A group's name sits on a chip, 6px wider each side.
        state.textWidth(name) + (group ? GROUP_CHIP : 0),
        state.textWidth(value),
        group && labels === 'value' ? 'name' : labels,
      )
      if (fit === 'none') continue
      const fresh = held.fresh.has(child.key)
      if (fresh && held.pending) continue
      const at = packPoint(circle, shown)
      const from = fresh ? packPoint(circle, held.was) : at
      ownLabels.push({
        key: child.key,
        x: at.x,
        y: at.y,
        fromX: from.x,
        fromY: from.y,
        name,
        value: fit === 'value' ? value : null,
        group,
        color: fillOf(circle).color,
      })
    }
  }

  const perValue = packScale(layout)
  return (
    <TreeZoomContext value={{ tree, view, zoomTo, nameOf }}>
      <StepLegendContext
        value={{
          slot: 'circle-packing-chart',
          label: colorName,
          edges,
          fillOf: (step) => ({
            color: divergingFill(step, edges),
            strength: divergingStep(step, edges).strength,
          }),
          valueText: colorText,
          textWidth: state.textWidth,
          emphasis: stepEmphasis,
          setEmphasis: setStepEmphasis,
        }}
      >
        <CirclePackingContext
          value={{
            perValue: perValue === null ? null : perValue * shown.k,
            measured: isMeasured(size),
            valueLabel: label,
            valueText,
          }}
        >
          <ChartFrame
            root={root}
            focus={focusProps}
            ref={ref}
            slot='circle-packing-chart'
            description={description}
            empty={empty}
            measuring={false}
            inset={0}
            data-orientation='vertical'
            className={className}
            {...figureProps(props, circlePackingChartKeys)}
          >
            <IndexActive items={reader.items} active={props} toldRef={toldRef}>
              <CirclePackingCircles
                zoomRef={zoomRef}
                labelsRef={labelsRef}
                layout={layout}
                circles={circles}
                shown={shown}
                stops={stops}
                labels={ownLabels}
                phase={phase}
                fillOf={fillOf}
                stepOfCircle={(circle) =>
                  colorKey && circle.node.children.length === 0
                    ? stepOf(colorOf(circle.node), edges)
                    : null
                }
                stepEmphasis={colorKey ? stepEmphasis : null}
              />
              {props.children}
              {region}
              {load.placeholder && <CirclePackingPlaceholder />}
            </IndexActive>
          </ChartFrame>
        </CirclePackingContext>
      </StepLegendContext>
    </TreeZoomContext>
  )
}

/** The leaves of the tree, whose second value colours them. */
function leavesOf(node: TileNode): TileNode[] {
  return node.children.length === 0 ? [node] : node.children.flatMap(leavesOf)
}

/** A circle's radius for each square root of value in `layout`, from any leaf with a size; none with none. */
function packScale(layout: PackLayout): number | null {
  const leaf = layout.circles.find(
    (circle) =>
      circle.node.children.length === 0 && circle.r > 0 && circle.node.value > 0,
  )
  return leaf ? leaf.r / Math.sqrt(leaf.node.value) : null
}

/** A group's see-through tint of its colour, so a group inside another reads a step deeper. */
function groupTint(color: string) {
  return `color-mix(in oklab, ${color} 16%, transparent)`
}

/** A group's tint when the circles are coloured by a value of their own, which a group doesn't take. */
const NEUTRAL_TINT = 'color-mix(in oklab, var(--foreground) 7%, transparent)'

/**
 * Which side of zero the step at `step` among `edges` lies on, and how
 * strong its colour is: the step next to zero the faintest on either side,
 * steps as far from zero as strong on both, and one side only when every
 * value has one sign.
 */
function divergingStep(
  step: number,
  edges: readonly number[],
): { side: 'below' | 'above'; strength: number } {
  const steps = Math.max(0, edges.length - 1)
  const below = edges.slice(1).filter((edge) => edge <= 0).length
  const above = steps - below
  const side = step < below ? 'below' : 'above'
  const fromZero = side === 'below' ? below - 1 - step : step - below
  return { side, strength: stepStrength(fromZero, Math.max(below, above)) }
}

/** The colour of a step of the ramp: its side's colour, as strong as the step, over the page's muted fill. */
function divergingFill(step: number, edges: readonly number[]) {
  const { side, strength } = divergingStep(step, edges)
  const color =
    side === 'below'
      ? 'var(--circle-packing-chart-negative, var(--destructive))'
      : 'var(--circle-packing-chart-positive, var(--chart-2))'
  return `color-mix(in oklab, ${color} ${Math.round(strength * 100)}%, var(--muted))`
}

/** Orders by key, the path joined, so a parent comes before what is inside it. */
function byKey(a: { key: string }, b: { key: string }) {
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0
}

/** The zoom's move on `layer`, if one is running. */
function zoomMove(layer: HTMLElement | null) {
  return layer
    ?.getAnimations()
    .find(
      (animation) =>
        animation instanceof CSSTransition &&
        animation.transitionProperty === 'transform',
    )
}

/**
 * Starts every label's move in `labels` when the layer's zoom started, on
 * the same duration and easing, so each label stays on its circle the
 * whole way.
 */
function alignMoves(layer: HTMLElement | null, labels: HTMLElement | null) {
  const zoom = zoomMove(layer)
  if (!zoom || !labels || zoom.startTime === null) return
  for (const move of labels.getAnimations({ subtree: true })) {
    if (move instanceof CSSTransition && move.transitionProperty === 'translate') {
      move.startTime = zoom.startTime
    }
  }
}

/**
 * Where the layer's zoom starts from, as drawn: the first frame of the move
 * the browser has just begun, from wherever the last one had reached, or
 * none with no move, as under reduced motion.
 */
function drawnFrom(layer: HTMLElement | null): PackView | null {
  const move = zoomMove(layer)
  const first =
    move?.effect instanceof KeyframeEffect ? move.effect.getKeyframes()[0] : undefined
  if (typeof first?.transform !== 'string') return null
  const { a, e, f } = new DOMMatrixReadOnly(first.transform)
  return { k: a, x: e, y: f }
}

/**
 * The circles: one layer as large as the plot, cut to its round window,
 * moved and scaled as one to show the part in view, stepping back as one
 * while a circle or a group is lit, with what is lit shown bright above
 * it; and the labels of the view's circles above them, each riding its
 * circle.
 */
function CirclePackingCircles({
  zoomRef,
  labelsRef,
  layout,
  circles,
  shown,
  stops,
  labels,
  phase,
  fillOf,
  stepOfCircle,
  stepEmphasis,
}: {
  zoomRef: RefObject<HTMLDivElement | null>
  labelsRef: RefObject<HTMLDivElement | null>
  layout: PackLayout
  circles: readonly PackedCircle[]
  shown: PackView
  stops: readonly TreeStop[]
  labels: readonly PackLabel[]
  phase: EntrancePhase
  fillOf: (circle: PackedCircle) => CircleFill
  stepOfCircle: (circle: PackedCircle) => number | null
  stepEmphasis: number | null
}) {
  const chart = useChartRootValue()
  const { spotlit } = useChartActive()
  const leaving = useLeaving(chart.moves, circles, circleKey)
  const leavingLabels = useLeaving(chart.moves, labels, labelKey)
  // Lit: the circle under the pointer or the keys with what is inside it, or a group the
  // legend brings forward, or the circles of a colour's step.
  const litKey = spotlit === null ? null : (stops[spotlit]?.id ?? null)
  const litCircle = litKey === null ? null : layout.byKey.get(litKey)
  const lit = circles.filter((circle) =>
    litCircle
      ? circle.key === litCircle.key || startsWith(circle.node.path, litCircle.node.path)
      : chart.emphasis !== null
        ? circle.top === chart.emphasis
        : stepEmphasis !== null && stepOfCircle(circle) === stepEmphasis,
  )
  const litSignature = lit.map(circleKey).join('\u0000')
  const [heldLit, setHeldLit] = useState({ signature: '', circles: lit })
  if (lit.length > 0 && heldLit.signature !== litSignature) {
    setHeldLit({ signature: litSignature, circles: lit })
  }
  const showLit = lit.length > 0 ? lit : heldLit.circles
  if (chart.status === 'empty' || !isMeasured(chart.plotSize)) return null
  const { window } = layout
  const clip = `circle(${window.r}px at ${window.x}px ${window.y}px)`
  const view = `translate(${shown.x}px, ${shown.y}px) scale(${shown.k})`
  const waiting = phase === 'waiting'
  const entering = phase === 'entering'
  const litKeys = new Set(lit.map(circleKey))
  // Drawn in the tree's order, a parent before what is inside it, whatever the values: a
  // circle React moved in the page would lose its move and grow in again from nothing.
  const drawn = [
    ...circles.map((circle) => ({ circle, gone: false })),
    ...leaving.map((circle) => ({ circle, gone: true })),
  ].toSorted((a, b) => byKey(a.circle, b.circle))
  return (
    <>
      <div
        data-slot='circle-packing-chart-circles'
        aria-hidden
        // The clip-path cuts the zoomed layer to its window, but only `overflow-clip` keeps what
        // it cuts from widening every scroller above the chart.
        className={cn(plotLayerClassName, 'z-10 overflow-clip')}
        style={{ clipPath: clip }}
      >
        {/* The view on the layer's own transform, never a variable its thousand circles inherit
            and restyle with on every zoom. */}
        <div
          ref={zoomRef}
          className='absolute inset-0 origin-top-left transition-none group-data-mounted/chart:transition-[transform] duration-(--motion-layout-duration) ease-(--motion-layout-easing) motion-reduce:group-data-mounted/chart:transition-none'
          style={{ transform: view }}
        >
          <div
            data-dim={lit.length > 0 ? '' : undefined}
            className='absolute inset-0 [--pack-dim:var(--circle-packing-chart-dim,0.3)] transition-[filter] duration-(--motion-layout-duration) ease-(--motion-layout-fade-easing) not-forced-colors:data-dim:[filter:saturate(var(--pack-dim))]'
          >
            {drawn.map(({ circle, gone }) => (
              <PackCircle
                key={circle.key}
                x={circle.x}
                y={circle.y}
                scale={(circle.r * 2) / DISC}
                {...fillOf(circle)}
                leaving={gone}
                waiting={!gone && waiting}
                entering={!gone && entering}
              />
            ))}
          </div>
          <div
            data-slot='circle-packing-chart-lit'
            data-off={lit.length === 0 ? '' : undefined}
            className='absolute inset-0 transition-opacity duration-(--motion-layout-duration) ease-(--motion-layout-fade-easing) data-off:opacity-0'
          >
            {showLit.toSorted(byKey).map((circle) => {
              const now = layout.byKey.get(circle.key) ?? circle
              return (
                <PackCircle
                  key={circle.key}
                  x={now.x}
                  y={now.y}
                  scale={(now.r * 2) / DISC}
                  {...fillOf(now)}
                  leaving={false}
                  waiting={false}
                  entering={false}
                  still
                />
              )
            })}
          </div>
        </div>
      </div>
      <div
        ref={labelsRef}
        data-slot='circle-packing-chart-labels'
        aria-hidden
        className={cn(plotLayerClassName, 'z-10 overflow-clip')}
        style={{ clipPath: clip }}
      >
        {[...labels, ...leavingLabels].toSorted(byKey).map((one) => {
          const gone = !labels.includes(one)
          // A label that leaves rides its circle to where the new view draws it.
          const circle = layout.byKey.get(one.key)
          const at = gone && circle ? packPoint(circle, shown) : one
          return (
            <PackLabelMark
              key={one.key}
              at={`${at.x}px ${at.y}px`}
              from={`${one.fromX}px ${one.fromY}px`}
              name={one.name}
              value={one.value}
              group={one.group}
              color={one.color}
              off={gone || waiting}
              quiet={litKeys.size > 0 && !litKeys.has(one.key)}
            />
          )
        })}
      </div>
    </>
  )
}

function circleKey(circle: PackedCircle) {
  return circle.key
}

function labelKey(label: PackLabel) {
  return label.key
}

/**
 * One circle: a point placed at `x` and `y` px, holding a disc scaled to its
 * size, so a move and a new size are each one transform that turns back
 * from wherever it is. It grows in from its centre and shrinks into it as
 * it leaves; a `still` one, a lit circle's copy, appears in place and moves with its circle.
 * Memoised, so lighting a circle redraws none of them.
 */
const PackCircle = memo(function PackCircle({
  x,
  y,
  scale,
  color,
  slot,
  group,
  forced,
  leaving,
  waiting,
  entering,
  still = false,
}: CircleFill & {
  x: number
  y: number
  /** The disc's scale: its size across over `DISC`. */
  scale: number
  leaving: boolean
  /** Before the entrance, out of sight at its centre. */
  waiting: boolean
  entering: boolean
  still?: boolean
}) {
  return (
    <span
      data-slot='circle-packing-chart-circle'
      data-group={group ? '' : undefined}
      data-leaving={leaving ? '' : undefined}
      data-waiting={waiting ? '' : undefined}
      data-entering={entering ? '' : undefined}
      data-still={still ? '' : undefined}
      className='group/circle absolute top-0 left-0 size-0 [translate:var(--circle-at)] transition-none group-data-mounted/chart:transition-[translate,opacity] duration-(--motion-layout-duration) ease-[var(--motion-layout-easing),var(--motion-layout-fade-easing)] group-data-mounted/chart:not-data-still:starting:opacity-0 data-waiting:opacity-0 data-entering:duration-(--motion-draw-duration) data-entering:ease-[var(--motion-draw-easing),var(--motion-draw-fade-easing)] data-leaving:opacity-0 data-leaving:duration-(--motion-exit-duration) data-leaving:ease-[var(--motion-exit-easing),var(--motion-exit-fade-easing)] motion-reduce:group-data-mounted/chart:transition-[opacity] motion-reduce:ease-(--motion-layout-fade-easing) motion-reduce:data-entering:ease-(--motion-draw-fade-easing) motion-reduce:data-leaving:ease-(--motion-exit-fade-easing)'
      style={{ '--circle-at': `${x}px ${y}px` } as CSSProperties}
    >
      <span
        className={cn(
          // A disc `DISC` px across, centred on the point.
          'absolute -top-[50px] -left-[50px] size-[100px] rounded-full bg-(--circle-fill) [transform:scale(var(--circle-scale))] transition-none group-data-mounted/chart:transition-[background-color,transform] duration-(--motion-layout-duration) ease-[var(--motion-layout-fade-easing),var(--motion-layout-easing)] group-data-mounted/chart:not-group-data-still/circle:starting:[transform:scale(0)] group-data-waiting/circle:[transform:scale(0)] group-data-leaving/circle:[transform:scale(0)] group-data-entering/circle:duration-(--motion-draw-duration) group-data-entering/circle:ease-[var(--motion-draw-fade-easing),var(--motion-draw-easing)] group-data-leaving/circle:duration-(--motion-exit-duration) group-data-leaving/circle:ease-[var(--motion-exit-fade-easing),var(--motion-exit-easing)] motion-reduce:group-data-mounted/chart:transition-[background-color] motion-reduce:ease-(--motion-layout-fade-easing) motion-reduce:group-data-mounted/chart:starting:[transform:scale(var(--circle-scale))] motion-reduce:group-data-waiting/circle:[transform:scale(var(--circle-scale))] motion-reduce:group-data-leaving/circle:[transform:scale(var(--circle-scale))]',
          // In forced colours, a group is a faint wash of the page's grey, its circles each a system
          // colour, or the text's colour at the strength of their step, as the colour key draws it.
          forced === 'faint'
            ? 'forced-colors:bg-[GrayText] forced-colors:opacity-30'
            : forced === 'series'
              ? forcedSeriesColor(slot)
              : 'forced-colors:bg-[CanvasText] forced-colors:opacity-(--circle-strength)',
        )}
        style={
          {
            '--circle-fill': color,
            '--circle-strength': typeof forced === 'number' ? forced : undefined,
            '--circle-scale': scale,
          } as CSSProperties
        }
      />
    </span>
  )
})

/**
 * A label of a circle in view, centred on it: a circle's name and value in
 * near white or near black for its colour, or a group's name in the text
 * colour on a chip of the page's colour, since it sits over the circles
 * inside.
 * It rides its circle while the view zooms, on the same move as the layer,
 * so it stays on it, and fades in and out where it comes and goes.
 */
const PackLabelMark = memo(function PackLabelMark({
  at,
  from,
  name,
  value,
  group,
  color,
  off,
  quiet,
}: {
  at: string
  from: string
  name: string
  value: string | null
  group: boolean
  color: string
  off: boolean
  quiet: boolean
}) {
  return (
    <span
      className='absolute top-0 left-0 size-0 [translate:var(--label-at)] transition-none duration-(--motion-layout-duration) ease-(--motion-layout-easing) group-data-mounted/chart:transition-[translate] group-data-mounted/chart:starting:[translate:var(--label-from)] motion-reduce:group-data-mounted/chart:transition-none'
      style={{ '--label-at': at, '--label-from': from } as CSSProperties}
    >
      <span
        data-off={off ? '' : undefined}
        data-quiet={quiet ? '' : undefined}
        className={cn(
          'absolute top-0 left-0 flex -translate-1/2 flex-col items-center text-center leading-4 whitespace-nowrap transition-[opacity,color] duration-(--motion-layout-duration) ease-(--motion-layout-fade-easing) group-data-mounted/chart:starting:opacity-0 data-off:opacity-0',
          group
            ? 'text-foreground data-quiet:text-muted-foreground bg-background/90 rounded-(--control-radius-xs) px-1.5 py-0.5 shadow-xs ring-1 ring-foreground/5 forced-colors:bg-[Canvas] forced-colors:text-[CanvasText] forced-colors:ring-[CanvasText]'
            : labelOnClassName,
        )}
        style={group ? undefined : ({ '--label-on': color } as CSSProperties)}
      >
        {/* A name or value with a unit reads in its own order whatever the page's direction. */}
        <span dir='auto' className='font-medium'>
          {name}
        </span>
        {value !== null && (
          <span dir='auto' className='tabular-nums'>
            {value}
          </span>
        )}
      </span>
    </span>
  )
})

/** The circles in the placeholder's tint, breathing slowly, while the data loads. */
function CirclePackingPlaceholder() {
  const chart = useChartRootValue()
  if (!isMeasured(chart.plotSize)) return null
  const layout = packLayout(PLACEHOLDER_TREE, {
    width: chart.plotSize.width,
    height: chart.plotSize.height,
    padding: PADDING,
    direction: chart.direction,
  })
  return (
    <div
      data-slot='circle-packing-chart-placeholder'
      aria-hidden
      className={cn(plotLayerClassName, 'z-10', placeholderBreatheClassName)}
    >
      {layout.circles.map((circle) => (
        <span
          key={circle.key}
          className={cn('absolute rounded-full', placeholderFillClassName)}
          style={{
            left: circle.x - circle.r,
            top: circle.y - circle.r,
            width: circle.r * 2,
            height: circle.r * 2,
          }}
        />
      ))}
    </div>
  )
}

/** The shape the placeholder's circles take: a few of falling size, as most packings have. */
const PLACEHOLDER_TREE = tileTree(
  [34, 22, 16, 11, 8, 5, 4].map((value, at) => ({ name: String(at), value })),
  'name',
  'value',
)

/**
 * The way back out: Kino's Breadcrumb of the parts above the one in view,
 * the whole first, each a button that zooms out to it, and the part in view
 * last. It sits above the plot, under a legend at the top.
 */
function CirclePackingPath(props: ComponentProps<'nav'>) {
  return <TreeZoomPath slot='circle-packing-chart-path' {...props} />
}

/**
 * The legend: a key of three nested circles with the values their sizes
 * stand for in the part in view, and with `colorKey`, the colour's steps,
 * whose values are written at their edges. Pointing at a step brings its
 * circles forward. It sits under or over the plot; the groups' colours are
 * `ChartLegend`'s.
 */
function CirclePackingLegend({
  position = 'bottom',
  className,
  ...props
}: Omit<ComponentProps<'div'>, 'children'> & { position?: 'top' | 'bottom' }) {
  const chart = useChartRootValue()
  const packing = useCirclePacking()
  if (chart.status !== 'ready') return null
  return (
    <div
      data-slot='circle-packing-chart-legend'
      className={cn(
        'flex flex-wrap items-end justify-end gap-x-6 gap-y-2',
        position === 'top' ? 'pb-3 [grid-area:top]' : 'pt-3 [grid-area:bottom]',
        className,
      )}
      {...props}
    >
      {(packing.perValue !== null || !packing.measured) && (
        <SizeKey
          perValue={packing.perValue ?? 0}
          label={packing.valueLabel}
          valueText={packing.valueText}
        />
      )}
      <CellStepLegend
        data-slot='circle-packing-chart-steps'
        className='p-0 [grid-area:auto]'
      />
    </div>
  )
}

/**
 * Three circles nested on one base, the largest about `KEY_RADIUS` px
 * across its radius, each with the value it stands for at its top.
 */
function SizeKey({
  perValue,
  label,
  valueText,
}: {
  perValue: number
  label: string
  valueText: (value: number) => string
}) {
  const values = sizeKey(perValue, KEY_RADIUS)
  // Values the format writes the same, such as two that round to 0, say nothing more.
  const written = values
    .map((value) => ({ value, text: valueText(value), r: Math.sqrt(value) * perValue }))
    .filter((one, at, all) => all.findIndex((other) => other.text === one.text) === at)
  // The key's box never follows its circles, which follow the plot's size: a box that did
  // would resize the plot beside it, and the plot the key again, every frame.
  const height = KEY_RADIUS * 2
  return (
    <div data-slot='circle-packing-chart-size-key' className='flex items-end gap-3'>
      <span className='text-muted-foreground font-medium'>{label}</span>
      <div aria-hidden className='flex' style={{ height }}>
        <svg
          width={height + 8}
          height={height}
          className='shrink-0 overflow-visible rtl:-scale-x-100'
        >
          {written.map((one) => (
            <g key={one.value}>
              <circle
                cx={KEY_RADIUS}
                cy={height - one.r}
                r={one.r}
                className='stroke-muted-foreground/60 fill-none forced-colors:stroke-[CanvasText]'
              />
              {/* From the circle's top to its value, beside the largest. */}
              <line
                x1={KEY_RADIUS}
                x2={height + 8}
                y1={height - one.r * 2}
                y2={height - one.r * 2}
                strokeDasharray='2 2'
                className='stroke-muted-foreground/60 forced-colors:stroke-[CanvasText]'
              />
            </g>
          ))}
        </svg>
        <span className='relative'>
          {written.map((one) => (
            <span
              key={one.value}
              className='text-muted-foreground absolute start-1 -translate-y-1/2 leading-4 whitespace-nowrap tabular-nums'
              style={{ top: height - one.r * 2 }}
            >
              <SwapText text={one.text} />
            </span>
          ))}
          {/* As wide as the widest value, so the key's width follows what it writes. */}
          <span className='invisible ps-1 leading-4 whitespace-nowrap tabular-nums'>
            {written.reduce(
              (wide, one) => (one.text.length > wide.length ? one.text : wide),
              '',
            )}
          </span>
        </span>
      </div>
      <ul aria-label={label} className='sr-only'>
        {written.map((one) => (
          <li key={one.value}>{one.text}</li>
        ))}
      </ul>
    </div>
  )
}

/** The steps the size key's values round down to, within each power of ten. */
const KEY_STEPS = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8]

/** The roundest value at or below `value`: 1, 1.5, 2, 2.5, 3, 4, 5, 6 or 8 times a power of ten. */
function roundBelow(value: number): number {
  if (!(value > 0) || !Number.isFinite(value)) return 0
  const power = 10 ** Math.floor(Math.log10(value))
  const step = KEY_STEPS.findLast((one) => one * power <= value * (1 + 1e-9)) ?? 1
  // Rounded, since a power of ten below 1 isn't exact: 3 × 0.1 is 0.30000000000000004.
  return Number((step * power).toPrecision(12))
}

/**
 * The size key's values, largest first, for circles `perValue` px across
 * their radius for each square root of value: the roundest value whose
 * circle is at most `largest` px across its radius, then about a quarter
 * and a twenty-fifth of it, half and a fifth as wide.
 */
function sizeKey(perValue: number, largest: number): number[] {
  if (!(perValue > 0)) return []
  const top = roundBelow((largest / perValue) ** 2)
  return [top, roundBelow(top / 4), roundBelow(top / 25)].filter((value) => value > 0)
}

export {
  CirclePackingChart,
  type CirclePackingChartProps,
  CirclePackingLegend,
  CirclePackingPath,
  divergingStep,
  roundBelow,
  sizeKey,
}
