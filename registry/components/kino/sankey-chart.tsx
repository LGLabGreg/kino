'use client'

import {
  type CategoryChartProps,
  type EntrancePhase,
  figureProps,
  ShareTooltipContent,
  useChartActive,
} from '@/registry/lib/chart-base'
import {
  type CategoryChartInput,
  CategoryChartFrame,
  useCategoryChart,
  useChart,
} from '@/registry/lib/chart-core'
import {
  type FlowAlign,
  flowAt,
  flowEnds,
  type FlowGraph,
  flowGraph,
  fitLabels,
  type FlowLayout,
  flowLayout,
  flowMoves,
  flowPath,
  type FlowShape,
  flowShapes,
  flowShapesAt,
  type LaidNode,
  linkPath,
  stepNode,
} from '@/registry/lib/chart-flows'
import type { ChartConfig } from '@/registry/lib/chart-math'
import { drawingSize, swatchClassName, usePointsMove } from '@/registry/lib/chart-root'
import { bandAt } from '@/registry/lib/chart-scale'
import { useControllable } from '@/registry/lib/controllable'
import { numberFormatter } from '@/registry/lib/number-format'
import {
  placeholderBreatheClassName,
  placeholderInkClassName,
} from '@/registry/lib/placeholder'
import { type CSSProperties, memo, useMemo, useRef, useState } from 'react'

import { cn } from '@/lib/utils'

/*
 * The Sankey chart: flows between steps, such as where visitors go or where
 * money goes, as bands as thick as their value between nodes as tall as
 * what passes through them. Each row is a flow from one node to another;
 * the nodes come from the flows and stand in columns from the reading
 * start. A node or a flow under the pointer, or a node the keys reach,
 * keeps every way through it bright while the rest step back. New data
 * moves every node and flow from where it is, on the chart's moves, which
 * write their shapes each frame, so the feel, reduced motion and a slowed
 * playback time it as they time everything else; a flow that arrives draws
 * along its length.
 */

interface SankeyChartProps extends Omit<
  CategoryChartProps,
  | 'index'
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
  /** The key of the node each flow starts from. */
  source: string
  /** The key of the node each flow goes to. */
  target: string
  /** The key of each flow's value. Rows between the same two nodes add up. */
  dataKey: string
  /** What the values are, such as "Visitors": the tooltip's and the data table's word for them. */
  valueLabel?: string
  /** How each column's nodes are ordered: where their flows cross least, or the rows' order. */
  sort?: 'auto' | 'data'
  /**
   * Which column a node stands in: as far along as its longest way in, with
   * the nodes nothing leaves in the last column (`justify`), as early as it
   * can (`start`), as late as it can (`end`), or near its flows (`center`).
   */
  align?: FlowAlign
  /** The colour of each flow: from its source's to its target's, or either one's. */
  linkColor?: 'gradient' | 'source' | 'target'
  /** What each node writes beside itself, where it has the room: its name and value, its name, or nothing. */
  labels?: 'value' | 'name' | 'none'
  /**
   * How the flows arrive the first time the chart comes into view: drawn
   * along their length, or simply there, the default, since a page that
   * loads doesn't animate into place.
   */
  entrance?: 'draw' | 'none'
}

const sankeyChartKeys = [
  'source',
  'target',
  'dataKey',
  'valueLabel',
  'sort',
  'align',
  'linkColor',
  'labels',
  'entrance',
]

/** Where each mark's own fields sit in the rows the chart core is given. */
const MARK_KEY = '\u0000mark'
const MARK_KIND = '\u0000kind'

/** A node's width, in px. */
const NODE_WIDTH = 8
/** The least room between two nodes of a column, in px. */
const NODE_PADDING = 12
/** The room between a node and its label, in px. */
const LABEL_GAP = 6
/** A line of a label, in px: the chart's text and its leading. */
const LABEL_LINE = 16
/** The most of the plot's width the outer columns' labels may take, each, before they sit inside. */
const MOST_LABEL_ROOM = 0.3
/** How far from a node, in px, the pointer still lights it. */
const NEAR_NODE = 4

/**
 * The chart's root: the graph from the rows, laid out in the plot, with the
 * frame its legend and tooltip draw in.
 */
function SankeyChart(props: SankeyChartProps) {
  const {
    data,
    source,
    target,
    dataKey,
    config,
    valueLabel,
    sort = 'auto',
    align = 'justify',
    linkColor = 'gradient',
    labels = 'value',
    entrance = 'none',
    messages,
    description,
    empty,
    className,
    ref,
  } = props
  const [hidden, setHidden] = useControllable(
    props.hiddenSeries,
    props.defaultHiddenSeries ?? [],
    props.onHiddenSeriesChange,
  )
  // Every node the rows name, so the legend can hide one; the shown ones make the graph.
  const all = flowGraph(data, { source, target, dataKey, align })
  const graph = flowGraph(data, { source, target, dataKey, align, hidden })
  const nodes: ChartConfig = { ...config }
  for (const node of all.nodes) nodes[node.key] ??= { label: nameText(node.name) }
  const nodeByKey = new Map(graph.nodes.map((node) => [node.key, node]))
  const drawnKeys = new Set([
    ...graph.nodes.map((node) => node.key),
    ...graph.links.map((link) => link.key),
  ])

  const nameOf = (key: string): string => {
    const name =
      nodeByKey.get(key)?.name ?? all.nodes.find((one) => one.key === key)?.name ?? key
    if (props.categoryFormat) return props.categoryFormat(name)
    const named = config[key]?.label
    return typeof named === 'string' ? named : nameText(name)
  }
  const flowName = (key: string): string => {
    const [from, to] = flowEnds(key)
    return chart.messages.flow(nameOf(from), nameOf(to))
  }

  const { chart, placeholder, phase } = useCategoryChart(
    {
      ...props,
      index: MARK_KEY,
      config: nodes,
      // Every node and flow, so hiding them all says so rather than that there are none.
      data: [
        ...all.nodes.map((node) => ({
          [MARK_KEY]: node.key,
          [MARK_KIND]: 'node',
        })),
        ...all.links.map((link) => ({
          ...link.datum,
          [MARK_KEY]: link.key,
          [MARK_KIND]: 'link',
        })),
      ],
      hiddenSeries: hidden,
      defaultHiddenSeries: undefined,
      onHiddenSeriesChange: setHidden,
      categoryFormat: (value): string =>
        nodeByKey.has(String(value)) ? nameOf(String(value)) : flowName(String(value)),
      messages: {
        series: 'Steps',
        empty: 'No flows yet',
        allHidden: 'Hiding these steps leaves no flows',
        showAll: (count) => `Show all ${count} steps`,
        ...messages,
      },
    },
    {
      orientation: 'vertical',
      stack: 'none',
      entrance: entrance !== 'none',
      // What leaves moves with the rest, so the chart waits on the move before letting it go.
      nice: false,
      bandOf: (at, count) => bandAt(at, count),
      measure: () => ({ extent: [0, 1] as const }),
      rowsShown: (rows) => rows.filter((row) => drawnKeys.has(String(row[MARK_KEY]))),
    },
  )

  const size = drawingSize(chart.plotSize)
  const label = valueLabel ?? chart.messages.value
  const twoLines = labels === 'value'
  const labelWidth = (key: string) => {
    if (labels === 'none') return 0
    const node = nodeByKey.get(key)
    const name = chart.textWidth(nameOf(key))
    return twoLines && node
      ? Math.max(name, chart.textWidth(chart.valueText(node.value)))
      : name
  }
  // The first column's labels stand before it and the last's after it, where they fit.
  const lastLayer = graph.columns - 1
  const roomFor = (layer: number) => {
    const widest = Math.max(
      0,
      ...graph.nodes
        .filter((node) => node.layer === layer)
        .map((node) => labelWidth(node.key)),
    )
    const room = widest === 0 ? 0 : widest + LABEL_GAP
    return room <= size.width * MOST_LABEL_ROOM ? room : 0
  }
  const startRoom = graph.columns > 1 ? roomFor(0) : 0
  const endRoom = graph.columns > 1 ? roomFor(lastLayer) : 0
  const layout = flowLayout(graph, {
    width: size.width,
    height: size.height,
    nodeWidth: NODE_WIDTH,
    nodePadding: NODE_PADDING,
    start: startRoom,
    end: endRoom,
    sort,
    direction: chart.direction,
  })
  // Each node's label, on its side, in the fullest form that clears the other labels and nodes.
  const room = { start: startRoom, end: endRoom }
  const sideOf = (key: string) =>
    labelSide(nodeByKey.get(key)?.layer ?? 0, graph.columns, chart.direction, room)
  const valueOf = (key: string) => chart.valueText(nodeByKey.get(key)?.value ?? 0)
  const fits = fitLabels(
    labels === 'none'
      ? []
      : graph.nodes.map((node) => {
          const name = chart.textWidth(nameOf(node.key))
          return {
            key: node.key,
            side: sideOf(node.key),
            forms: [
              ...(twoLines
                ? [
                    {
                      fit: 'value' as const,
                      width: Math.max(name, chart.textWidth(valueOf(node.key))),
                      lines: 2,
                    },
                  ]
                : []),
              { fit: 'name' as const, width: name, lines: 1 },
            ],
          }
        }),
    layout,
    { width: size.width, gap: LABEL_GAP, line: LABEL_LINE },
  )
  const labelOf = (key: string): NodeLabel | null => {
    const fit = fits.get(key) ?? 'none'
    if (fit === 'none') return null
    return {
      side: sideOf(key),
      name: nameOf(key),
      value: fit === 'value' ? valueOf(key) : null,
    }
  }
  // The layout shown before this one, kept while what left it finishes leaving.
  const signature = layoutSignature(layout)
  const [held, setHeld] = useState<{
    signature: string
    now: FlowLayout
    was: FlowLayout | null
  }>({ signature, now: layout, was: null })
  if (held.signature !== signature) setHeld({ signature, now: layout, was: held.now })
  const was = held.signature === signature ? held.was : held.now
  // The same layout object while its signature holds, so the marks' shapes stay the same objects.
  const steady = held.signature === signature ? held.now : layout

  const total = Math.max(
    0,
    ...Array.from({ length: graph.columns }, (_, layer) =>
      graph.nodes
        .filter((node) => node.layer === layer)
        .reduce((sum, node) => sum + node.value, 0),
    ),
  )
  const percent = numberFormatter(chart.locale, {
    style: 'percent',
    maximumFractionDigits: 1,
  })
  const share = (value: number, of: number) => percent.format(of === 0 ? 0 : value / of)
  const linkByKey = new Map(graph.links.map((link) => [link.key, link]))
  const keyAt = (at: number) => chart.current[at]?.key ?? null
  const nodeBox = new Map(layout.nodes.map((node) => [node.key, node]))
  const linkBox = new Map(layout.links.map((link) => [link.key, link]))
  const indexOf = (key: string) =>
    chart.current.findIndex((category) => category.key === key)
  const colorOf = (key: string) =>
    nodeColor(config, key, nodeByKey.get(key)?.layer ?? 0, graph.columns)

  // The nodes as they are drawn: column by column from the reading start, each from the top.
  const drawnOrder = graph.nodes
    .toSorted(
      (a, b) =>
        a.layer - b.layer ||
        (nodeBox.get(a.key)?.y0 ?? 0) - (nodeBox.get(b.key)?.y0 ?? 0),
    )
    .map((node) => node.key)
  const full: CategoryChartInput = {
    ...chart,
    // The tooltip sits above a node's top, or above the middle of a flow.
    pointOf: (at) => {
      const key = keyAt(at)
      if (key === null || size.width === 0 || size.height === 0) return null
      const node = nodeBox.get(key)
      if (node) {
        return {
          x: (node.x0 + node.x1) / 2 / size.width,
          y: node.y0 / size.height,
          side: 'top',
        }
      }
      const link = linkBox.get(key)
      if (!link) return null
      const middle = (link.y0 + link.y1) / 2 - link.width / 2
      return {
        x: (link.x0 + link.x1) / 2 / size.width,
        y: middle / size.height,
        side: 'top',
      }
    },
    pickAt: (point, box) => {
      if (box.width === 0 || box.height === 0) return null
      const found = flowAt(
        {
          x: ((point.x - box.left) / box.width) * size.width,
          y: ((point.y - box.top) / box.height) * size.height,
        },
        layout,
        NEAR_NODE,
      )
      if (!found) return null
      const at = indexOf('node' in found ? found.node : found.link)
      return at === -1 ? null : at
    },
    keys: {
      stops: graph.nodes.length,
      start: Math.max(0, indexOf(drawnOrder[0] ?? '')),
      rank: (at) => {
        const reached = keyAt(at)
        if (reached === null) return 1
        // From a flow the pointer lit, its source's place.
        const key = nodeByKey.has(reached) ? reached : flowEnds(reached)[0]
        return Math.max(1, drawnOrder.indexOf(key) + 1)
      },
      step: (at, key) => {
        const reached = keyAt(at)
        if (reached === null) return null
        // From a flow the pointer lit, the keys start at its source.
        const from = nodeByKey.has(reached) ? reached : flowEnds(reached)[0]
        const next = stepNode(graph, layout, from, key, chart.direction)
        if (next === null) return null
        const found = indexOf(next)
        return found === -1 ? null : found
      },
    },
    describe: (at) => {
      const key = keyAt(at)
      if (key === null) return ''
      const node = nodeByKey.get(key)
      if (node)
        return `${label} ${chart.valueText(node.value)}, ${share(node.value, total)}`
      const link = linkByKey.get(key)
      if (!link) return ''
      return `${label} ${chart.valueText(link.value)}, ${chart.messages.outOf(share(link.value, link.source.value), nameOf(link.source.key))}`
    },
    table: {
      columns: [chart.messages.to, label, chart.messages.share],
      cells: () => [],
      rows: {
        header: chart.messages.from,
        cells: graph.links.map((link) => ({
          key: link.key,
          name: nameOf(link.source.key),
          cells: [
            nameOf(link.target.key),
            chart.valueText(link.value),
            share(link.value, link.source.value),
          ],
        })),
      },
    },
    tooltipContent: (at) => {
      const category = chart.current[at]
      if (!category) return null
      const node = nodeByKey.get(category.key)
      if (node) {
        // Where it goes, or for a last step, where it came from: the biggest first, a few.
        const out = node.sourceLinks.length > 0
        const flows = (out ? node.sourceLinks : node.targetLinks)
          .toSorted((a, b) => b.value - a.value)
          .slice(0, TOOLTIP_FLOWS)
        return (
          <ShareTooltipContent
            chart={chart}
            category={category}
            name={nameOf(node.key)}
            rows={[
              {
                label,
                value: chart.valueText(node.value),
                share: share(node.value, total),
              },
              ...flows.map((link) => ({
                label: `${out ? chart.messages.to : chart.messages.from} ${nameOf(out ? link.target.key : link.source.key)}`,
                value: chart.valueText(link.value),
                share: share(link.value, node.value),
              })),
            ]}
            swatch={<Swatch color={colorOf(node.key)} />}
          />
        )
      }
      const link = linkByKey.get(category.key)
      if (!link) return null
      return (
        <ShareTooltipContent
          chart={chart}
          category={category}
          name={flowName(link.key)}
          rows={[
            {
              label: null,
              value: chart.valueText(link.value),
              share: share(link.value, link.source.value),
            },
          ]}
          swatch={
            <Swatch
              color={colorOf(linkColor === 'target' ? link.target.key : link.source.key)}
            />
          }
        />
      )
    },
  }

  return (
    <CategoryChartFrame
      chart={full}
      ref={ref}
      slot='sankey-chart'
      description={description}
      empty={empty}
      className={className}
      placeholder={placeholder && <SankeyPlaceholder />}
      {...figureProps({ ...props, index: MARK_KEY }, sankeyChartKeys)}
    >
      <SankeyMarks
        graph={graph}
        layout={steady}
        was={was}
        phase={phase}
        linkColor={linkColor}
        colorOf={colorOf}
        labelOf={labelOf}
      />
      {props.children}
    </CategoryChartFrame>
  )
}

/** How many of a node's flows its tooltip lists. */
const TOOLTIP_FLOWS = 4

function nameText(name: unknown) {
  return String(name)
}

/** What tells one layout from another: every box and band, to a hundredth of a px. */
function layoutSignature(layout: FlowLayout) {
  return flowShapes(layout)
    .map((shape) =>
      [
        shape.key,
        shape.x0,
        shape.x1,
        shape.y0,
        shape.y1,
        shape.kind === 'link' ? shape.width : '',
      ]
        .map((part) => (typeof part === 'number' ? part.toFixed(2) : part))
        .join(':'),
    )
    .join('|')
}

/**
 * A node's colour: its own from the config's `color` or `theme`, or the chart's colours spread
 * along the columns, lightest first, so the flows deepen as they go.
 */
function nodeColor(config: ChartConfig, key: string, layer: number, columns: number) {
  const slot =
    columns <= 1 ? 0 : columns <= 5 ? Math.round((layer * 4) / (columns - 1)) : layer % 5
  const ramp = `var(--chart-${slot + 1})`
  // Only a colour of its own: a node the config names for its label keeps its column's.
  const own = config[key]
  return own?.color || own?.theme ? `var(--color-${key}, ${ramp})` : ramp
}

function Swatch({ color }: { color: string }) {
  return (
    <span
      aria-hidden
      className={cn(swatchClassName, 'forced-colors:bg-[CanvasText]')}
      style={{ '--swatch': color } as CSSProperties}
    />
  )
}

function isMeasured(size: { width: number; height: number }) {
  return size.width > 0 && size.height > 0
}

/** Which side of its node a label stands, physically: outside the outer columns where they have room, else after the node. */
function labelSide(
  layer: number,
  columns: number,
  direction: 'ltr' | 'rtl',
  room: { start: number; end: number },
): 'left' | 'right' {
  // Before its node, at the reading start's side: the first column's, in its room, and the
  // last column's when it has none, so it stays inside the plot.
  const before =
    (layer === 0 && room.start > 0) ||
    (layer === columns - 1 && columns > 1 && room.end === 0)
  if (direction === 'rtl') return before ? 'right' : 'left'
  return before ? 'left' : 'right'
}

/** What a node writes beside itself, and on which side. */
interface NodeLabel {
  side: 'left' | 'right'
  name: string
  value: string | null
}

/**
 * Every node, flow and label, drawn in one SVG as large as the plot. Their
 * shapes are written each frame of the chart's move while new data moves
 * them; at rest they are the layout's. What steps back is everything off the
 * way through the node or flow lit, or the node brought forward.
 */
function SankeyMarks({
  graph,
  layout,
  was,
  phase,
  linkColor,
  colorOf,
  labelOf,
}: {
  graph: FlowGraph
  layout: FlowLayout
  was: FlowLayout | null
  phase: EntrancePhase
  linkColor: 'gradient' | 'source' | 'target'
  colorOf: (key: string) => string
  labelOf: (key: string) => NodeLabel | null
}) {
  const chart = useChart()
  const { spotlit } = useChartActive()
  const svg = useRef<SVGSVGElement>(null)
  const size = drawingSize(chart.plotSize)
  const shapes = useMemo(() => flowShapes(layout), [layout])
  // Each mark's shape, the leaving layout's first, so a mark the pointer doesn't change keeps its
  // props and its memo holds.
  const byKey = useMemo(
    () =>
      new Map(
        [...(was ? flowShapes(was) : []), ...shapes].map((shape) => [shape.key, shape]),
      ),
    [was, shapes],
  )
  const shown = useMemo(() => new Set(shapes.map((shape) => shape.key)), [shapes])
  usePointsMove(
    'layout',
    shapes,
    layoutSignature(layout),
    shapes,
    `${size.width}x${size.height}`,
    {
      align: flowMoves,
      at: flowShapesAt,
      draw: (now) => drawShapes(svg.current, now),
    },
  )
  // The layout follows the plot's shape, so until it is measured there is nothing to draw:
  // a guess would rearrange itself once the page is running.
  if (chart.status === 'empty' || !isMeasured(chart.plotSize)) return null

  const lit = spotlit === null ? null : chart.current[spotlit]
  const litKey = lit && !lit.leaving ? lit.key : null
  const way =
    litKey !== null
      ? flowPath(
          graph,
          layout.nodes.some((node) => node.key === litKey)
            ? { node: litKey }
            : { link: litKey },
        )
      : chart.emphasis !== null
        ? flowPath(graph, { node: chart.emphasis })
        : null
  const id = chart.id

  const linkCategories = chart.categories.filter(
    (category) => byKey.get(category.key)?.kind === 'link',
  )
  const nodeCategories = chart.categories.filter(
    (category) => byKey.get(category.key)?.kind === 'node',
  )

  return (
    <div
      data-slot='sankey-chart-flows'
      aria-hidden
      className='pointer-events-none relative z-10 min-h-0 min-w-0 [grid-area:plot]'
    >
      <svg
        ref={svg}
        data-entering={phase === 'entering' ? '' : undefined}
        data-waiting={phase === 'waiting' ? '' : undefined}
        width={size.width}
        height={size.height}
        className='absolute inset-0 size-full overflow-visible'
      >
        {linkCategories.map((category) => {
          const shape = byKey.get(category.key)
          if (shape?.kind !== 'link') return null
          const color = (key: string) => colorOf(key)
          return (
            <SankeyLink
              key={category.key}
              id={`${id}-flow-${category.index}`}
              flowKey={category.key}
              shape={shape}
              from={color(shape.source)}
              to={color(shape.target)}
              mode={linkColor}
              dim={way !== null && !way.links.has(category.key)}
              leaving={category.leaving || !shown.has(category.key)}
            />
          )
        })}
        {nodeCategories.map((category) => {
          const shape = byKey.get(category.key)
          if (shape?.kind !== 'node') return null
          return (
            <SankeyNode
              key={category.key}
              flowKey={category.key}
              shape={shape}
              color={colorOf(category.key)}
              dim={way !== null && !way.nodes.has(category.key)}
              leaving={category.leaving || !shown.has(category.key)}
              side={labelOf(category.key)?.side ?? null}
              name={labelOf(category.key)?.name ?? null}
              value={labelOf(category.key)?.value ?? null}
            />
          )
        })}
      </svg>
    </div>
  )
}

/** Writes each shape where it is now onto its element, found by its key. */
function drawShapes(svg: SVGSVGElement | null, shapes: readonly FlowShape[]) {
  if (!svg) return
  const byKey = new Map(shapes.map((shape) => [shape.key, shape]))
  for (const element of svg.querySelectorAll<SVGElement>('[data-flow]')) {
    const shape = byKey.get(element.dataset.flow ?? '')
    if (!shape) continue
    if (shape.kind === 'node') placeNode(element, shape)
    else placeLink(element, shape)
  }
}

function placeNode(element: SVGElement, node: LaidNode) {
  const [rect, label] = [element.querySelector('rect'), element.querySelector('g')]
  rect?.setAttribute('x', String(node.x0))
  rect?.setAttribute('y', String(node.y0))
  rect?.setAttribute('width', String(Math.max(0, node.x1 - node.x0)))
  rect?.setAttribute('height', String(Math.max(1, node.y1 - node.y0)))
  label?.setAttribute(
    'transform',
    labelTransform(node, label.dataset.side === 'left' ? 'left' : 'right'),
  )
}

function placeLink(element: SVGElement, link: Extract<FlowShape, { kind: 'link' }>) {
  const path = element.querySelector('path')
  path?.setAttribute('d', linkPath(link))
  path?.setAttribute('stroke-width', String(Math.max(1, link.width)))
  const gradient = element.querySelector('linearGradient')
  gradient?.setAttribute('x1', String(link.x0))
  gradient?.setAttribute('x2', String(link.x1))
}

function labelTransform(node: LaidNode, side: 'left' | 'right') {
  const x = side === 'left' ? node.x0 - LABEL_GAP : node.x1 + LABEL_GAP
  return `translate(${Math.round(x * 100) / 100} ${Math.round(((node.y0 + node.y1) / 2) * 100) / 100})`
}

const fadeClassName =
  'transition-none duration-(--motion-layout-duration) ease-(--motion-layout-fade-easing) group-data-mounted/chart:transition-[stroke,fill,stop-color,opacity]'

/**
 * One flow: its band, stroked as thick as it, in its colour or a gradient
 * from its source's to its target's, stepping back while another way is
 * lit. Memoised, so a pointer moving between marks redraws only the ones
 * it lights or dims.
 */
const SankeyLink = memo(function SankeyLink({
  id,
  flowKey,
  shape,
  from,
  to,
  mode,
  dim,
  leaving,
}: {
  id: string
  flowKey: string
  shape: Extract<FlowShape, { kind: 'link' }>
  from: string
  to: string
  mode: 'gradient' | 'source' | 'target'
  dim: boolean
  leaving: boolean
}) {
  const stopClassName = cn(
    fadeClassName,
    '[stop-color:var(--stop-ink)] [--stop-ink:var(--stop-color)] in-data-dim:[--stop-ink:oklch(from_var(--stop-color)_l_calc(c*var(--sankey-chart-dim,0.3))_h)] forced-colors:[stop-color:GrayText]',
  )
  return (
    <g
      data-flow={flowKey}
      data-dim={dim ? '' : undefined}
      data-leaving={leaving ? '' : undefined}
    >
      {mode === 'gradient' && (
        <linearGradient
          id={id}
          gradientUnits='userSpaceOnUse'
          x1={shape.x0}
          x2={shape.x1}
          y1={0}
          y2={0}
        >
          <stop
            offset='0%'
            className={stopClassName}
            style={{ '--stop-color': from } as CSSProperties}
          />
          <stop
            offset='100%'
            className={stopClassName}
            style={{ '--stop-color': to } as CSSProperties}
          />
        </linearGradient>
      )}
      <path
        d={linkPath(shape)}
        pathLength={1}
        strokeWidth={Math.max(1, shape.width)}
        className={cn(
          'fill-none [stroke-opacity:var(--sankey-chart-flow-opacity,0.4)] [stroke-dasharray:1] [stroke-dashoffset:0]',
          mode === 'gradient'
            ? '[stroke:var(--flow-paint)]'
            : '[stroke:var(--flow-ink)] [--flow-ink:var(--flow-color)] in-data-dim:[--flow-ink:oklch(from_var(--flow-color)_l_calc(c*var(--sankey-chart-dim,0.3))_h)]',
          'transition-none group-data-mounted/chart:[transition:stroke_var(--motion-layout-duration)_var(--motion-layout-fade-easing),stroke-dashoffset_var(--motion-draw-duration)_var(--motion-draw-easing),opacity_var(--motion-exit-duration)_var(--motion-exit-fade-easing)] group-data-mounted/chart:starting:[stroke-dashoffset:1] in-data-waiting:[stroke-dashoffset:1] in-data-leaving:opacity-0 motion-reduce:group-data-mounted/chart:[transition:stroke_var(--motion-layout-duration)_var(--motion-layout-fade-easing),opacity_var(--motion-exit-duration)_var(--motion-exit-fade-easing)] motion-reduce:group-data-mounted/chart:starting:opacity-0 motion-reduce:in-data-waiting:opacity-0 motion-reduce:[stroke-dashoffset:0]! forced-colors:[stroke:GrayText] forced-colors:in-data-dim:[stroke-opacity:0.15]',
        )}
        style={
          {
            '--flow-color': mode === 'target' ? to : from,
            '--flow-paint': `url(#${id})`,
          } as CSSProperties
        }
      />
    </g>
  )
})

/**
 * One node, and its label beside it: its name, and under it its value,
 * where they fit.
 */
const SankeyNode = memo(function SankeyNode({
  flowKey,
  shape,
  color,
  dim,
  leaving,
  side: givenSide,
  name: givenName,
  value: givenValue,
}: {
  flowKey: string
  shape: Extract<FlowShape, { kind: 'node' }>
  color: string
  dim: boolean
  leaving: boolean
  side: 'left' | 'right' | null
  name: string | null
  value: string | null
}) {
  // A node on its way out keeps the words it had while it fades.
  const given =
    givenSide === null || givenName === null
      ? null
      : { side: givenSide, name: givenName, value: givenValue }
  const [held, setHeld] = useState(given)
  if (!leaving && !sameLabel(given, held)) setHeld(given)
  const label = leaving ? held : given
  const side = label?.side ?? 'right'
  const name = label?.name ?? null
  const value = label?.value ?? null
  const two = name !== null && value !== null
  // The label's own edge faces its node, whatever the page's direction.
  const anchor = side === 'left' ? 'end' : 'start'
  return (
    <g
      data-flow={flowKey}
      data-dim={dim ? '' : undefined}
      data-leaving={leaving ? '' : undefined}
      className={cn(
        fadeClassName,
        'opacity-100 group-data-mounted/chart:starting:opacity-0 in-data-waiting:opacity-0 data-leaving:opacity-0 data-leaving:duration-(--motion-exit-duration) data-leaving:ease-(--motion-exit-fade-easing) in-data-entering:duration-(--motion-draw-duration)',
      )}
    >
      <rect
        x={shape.x0}
        y={shape.y0}
        width={Math.max(0, shape.x1 - shape.x0)}
        height={Math.max(1, shape.y1 - shape.y0)}
        rx={1.5}
        className={cn(
          fadeClassName,
          '[fill:var(--node-ink)] [--node-ink:var(--node-color)] in-data-dim:[--node-ink:oklch(from_var(--node-color)_l_calc(c*var(--sankey-chart-dim,0.3))_h)] forced-colors:[fill:CanvasText] forced-colors:in-data-dim:[fill:GrayText]',
        )}
        style={{ '--node-color': color } as CSSProperties}
      />
      {name !== null && (
        <g
          data-side={side}
          transform={labelTransform(shape, side)}
          textAnchor={anchor}
          className='[direction:ltr]'
        >
          <text
            y={two ? -LABEL_LINE / 2 : 0}
            dominantBaseline='central'
            // Labels never step back, and a halo in the surface's colour keeps them clear of the flows.
            className='fill-foreground font-medium forced-colors:fill-[CanvasText] stroke-(--chart-surface,var(--card)) [stroke-width:3] [stroke-linejoin:round] [paint-order:stroke] forced-colors:stroke-[Canvas]'
          >
            {name}
          </text>
          {value !== null && (
            <text
              y={LABEL_LINE / 2}
              dominantBaseline='central'
              className='fill-foreground tabular-nums forced-colors:fill-[CanvasText] stroke-(--chart-surface,var(--card)) [stroke-width:3] [stroke-linejoin:round] [paint-order:stroke] forced-colors:stroke-[Canvas]'
            >
              {value}
            </text>
          )}
        </g>
      )}
    </g>
  )
})

function sameLabel(a: NodeLabel | null, b: NodeLabel | null) {
  return a?.side === b?.side && a?.name === b?.name && a?.value === b?.value
}

/** The shape the placeholder takes: a few steps narrowing, as most flows do. */
const PLACEHOLDER = flowGraph(
  [
    { from: 'a', to: 'd', value: 30 },
    { from: 'b', to: 'd', value: 20 },
    { from: 'b', to: 'e', value: 14 },
    { from: 'c', to: 'e', value: 12 },
    { from: 'd', to: 'f', value: 34 },
    { from: 'd', to: 'g', value: 16 },
    { from: 'e', to: 'g', value: 18 },
  ],
  { source: 'from', target: 'to', dataKey: 'value' },
)

/** The flows in the placeholder's tint, breathing slowly, while the data loads. */
function SankeyPlaceholder() {
  const chart = useChart()
  if (!isMeasured(chart.plotSize)) return null
  const size = drawingSize(chart.plotSize)
  const layout = flowLayout(PLACEHOLDER, {
    width: size.width,
    height: size.height,
    nodeWidth: NODE_WIDTH,
    nodePadding: NODE_PADDING,
    sort: 'data',
    direction: chart.direction,
  })
  return (
    <div
      data-slot='sankey-chart-placeholder'
      aria-hidden
      className={cn(
        'pointer-events-none relative z-10 min-h-0 min-w-0 [grid-area:plot]',
        placeholderBreatheClassName,
      )}
    >
      <svg
        width={size.width}
        height={size.height}
        className={cn('absolute inset-0 size-full', placeholderInkClassName)}
      >
        {layout.links.map((link) => (
          <path
            key={link.key}
            d={linkPath(link)}
            strokeWidth={Math.max(1, link.width)}
            className='fill-none stroke-current [stroke-opacity:0.6]'
          />
        ))}
        {layout.nodes.map((node) => (
          <rect
            key={node.key}
            x={node.x0}
            y={node.y0}
            width={node.x1 - node.x0}
            height={Math.max(1, node.y1 - node.y0)}
            rx={1.5}
            className='fill-current'
          />
        ))}
      </svg>
    </div>
  )
}

export { labelSide, nodeColor, SankeyChart, type SankeyChartProps }
