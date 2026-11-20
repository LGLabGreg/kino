import type { ChartDatum, ReadingDirection } from '@/registry/lib/chart-math'
import {
  sankey,
  sankeyCenter,
  sankeyJustify,
  sankeyLeft,
  sankeyRight,
  type SankeyLink,
  type SankeyNode,
} from 'd3-sankey'

/*
 * The flows of a chart drawn as bands between steps, such as a Sankey: the
 * graph its rows make, the columns its nodes stand in, the boxes and bands
 * d3-sankey lays it out in, the path through a node or a flow, what sits
 * under a point, and where each shape comes from and goes to when the data
 * changes. Pure, so the chart only draws.
 */

/** A step of the flows: everything that goes into it or out of it. */
interface FlowNode {
  /** Its name as text: unique among the nodes. */
  key: string
  /** Its name as the rows give it. */
  name: unknown
  /** What passes through it: the most of what comes in and what goes out. */
  value: number
  /** How many flows lie before it on its longest way in. */
  depth: number
  /** How many lie after it on its longest way out. */
  height: number
  /** The column it stands in, from the reading start. */
  layer: number
  sourceLinks: FlowLink[]
  targetLinks: FlowLink[]
}

/** What goes from one node to another: every row between the two, added up. */
interface FlowLink {
  /** Its two nodes' keys, joined. */
  key: string
  source: FlowNode
  target: FlowNode
  value: number
  /** The first row between the two. */
  datum: ChartDatum
}

interface FlowGraph {
  /** Column by column from the reading start, each in the order the rows first name them. */
  nodes: readonly FlowNode[]
  /** In the order the rows first give them. */
  links: readonly FlowLink[]
  columns: number
}

type FlowAlign = 'justify' | 'start' | 'end' | 'center'

/** A node's box, in px from the plot's physical left and its top. */
interface LaidNode {
  key: string
  x0: number
  x1: number
  y0: number
  y1: number
}

/**
 * A flow's band, along its middle: from the edge of its source, `x0`, to the
 * edge of its target, `x1`, at the heights where it leaves and arrives, and
 * as thick as its value. In px, from the plot's physical left and its top.
 */
interface LaidLink {
  key: string
  source: string
  target: string
  x0: number
  x1: number
  y0: number
  y1: number
  width: number
}

interface FlowLayout {
  nodes: readonly LaidNode[]
  links: readonly LaidLink[]
}

/** What separates a flow's two nodes in its key. */
const KEY_SEPARATOR = '\u001f'

const aligns = {
  justify: sankeyJustify,
  start: sankeyLeft,
  end: sankeyRight,
  center: sankeyCenter,
} as const

/**
 * The graph the rows make: a node for each name a row goes from or to, and a
 * flow for each pair of them, its rows' values added up. A row without both
 * names, or whose value is missing, zero or below, takes no room, nor does a
 * row from or to a node in `hidden`. Flows can't loop: a row leading back to
 * where it came from throws, naming it.
 */
function flowGraph(
  rows: readonly ChartDatum[],
  keys: {
    source: string
    target: string
    dataKey: string
    hidden?: readonly string[]
    align?: FlowAlign
  },
): FlowGraph {
  const hidden = new Set(keys.hidden ?? [])
  const byKey = new Map<string, FlowNode>()
  const linkByKey = new Map<string, FlowLink>()
  const nodeOf = (key: string, name: unknown) => {
    let node = byKey.get(key)
    if (!node) {
      node = {
        key,
        name,
        value: 0,
        depth: 0,
        height: 0,
        layer: 0,
        sourceLinks: [],
        targetLinks: [],
      }
      byKey.set(key, node)
    }
    return node
  }
  for (const row of rows) {
    const from = nameText(row[keys.source])
    const to = nameText(row[keys.target])
    const value = row[keys.dataKey]
    if (from === null || to === null) continue
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) continue
    if (hidden.has(from) || hidden.has(to)) continue
    if (from === to) throw new Error(`A flow can't go from "${from}" back into itself.`)
    const key = flowKey(from, to)
    const link = linkByKey.get(key)
    if (link) {
      link.value += value
      continue
    }
    const source = nodeOf(from, row[keys.source])
    const target = nodeOf(to, row[keys.target])
    const made: FlowLink = { key, source, target, value, datum: row }
    linkByKey.set(key, made)
    source.sourceLinks.push(made)
    target.targetLinks.push(made)
  }
  const named = [...byKey.values()]
  const links = [...linkByKey.values()]
  for (const node of named) {
    node.value = Math.max(sumOf(node.sourceLinks), sumOf(node.targetLinks))
  }
  depthsOf(named)
  const columns =
    named.length === 0 ? 0 : Math.max(...named.map((node) => node.depth)) + 1
  const align = aligns[keys.align ?? 'justify']
  for (const node of named) {
    // d3-sankey's own alignments, on nodes shaped as its own.
    const layer = align(node as unknown as SankeyNode<object, object>, columns)
    node.layer = Math.max(0, Math.min(columns - 1, Math.floor(layer)))
  }
  const order = new Map(named.map((node, at) => [node.key, at]))
  const nodes = named.toSorted(
    (a, b) => a.layer - b.layer || (order.get(a.key) ?? 0) - (order.get(b.key) ?? 0),
  )
  return {
    nodes,
    links,
    columns: nodes.length === 0 ? 0 : Math.max(...nodes.map((node) => node.layer)) + 1,
  }
}

/** A node's name as text: a string or a number, or null for a row that names none. */
function nameText(name: unknown): string | null {
  if (typeof name === 'string') return name === '' ? null : name
  if (typeof name === 'number' && Number.isFinite(name)) return String(name)
  return null
}

function sumOf(links: readonly FlowLink[]) {
  return links.reduce((sum, link) => sum + link.value, 0)
}

/**
 * Each node's depth, its longest way in, and height, its longest way out,
 * walking the flows from the nodes nothing flows into. A node reached again
 * on its own way is a loop, which throws, naming the flow that closes it.
 */
function depthsOf(nodes: readonly FlowNode[]) {
  const state = new Map<FlowNode, 'open' | 'done'>()
  const order: FlowNode[] = []
  const visit = (node: FlowNode) => {
    state.set(node, 'open')
    for (const link of node.sourceLinks) {
      const seen = state.get(link.target)
      if (seen === 'open') {
        throw new Error(
          `Flows can't loop: the flow from "${link.source.key}" to "${link.target.key}" leads back to where it came from.`,
        )
      }
      if (seen === undefined) visit(link.target)
    }
    state.set(node, 'done')
    order.push(node)
  }
  for (const node of nodes) if (!state.has(node)) visit(node)
  // `order` runs from the last nodes back to the first.
  for (const node of order.toReversed()) {
    for (const link of node.sourceLinks) {
      link.target.depth = Math.max(link.target.depth, node.depth + 1)
    }
  }
  for (const node of order) {
    for (const link of node.targetLinks) {
      link.source.height = Math.max(link.source.height, node.height + 1)
    }
  }
}

function flowKey(source: string, target: string) {
  return `${source}${KEY_SEPARATOR}${target}`
}

/** A flow's two node keys, from its key. */
function flowEnds(key: string): [string, string] {
  const at = key.indexOf(KEY_SEPARATOR)
  return [key.slice(0, at), key.slice(at + 1)]
}

/**
 * The graph laid out in a plot `width` by `height` px: each column's nodes
 * stacked `nodePadding` apart, as tall as their values, and each flow as
 * thick as its value, by d3-sankey. `start` and `end` keep room clear at the
 * plot's reading start and end, for the outer columns' labels. With `sort`
 * `data`, each column keeps the rows' order; with `auto`, nodes move to
 * where their flows cross least. In right to left, the columns run from the
 * right.
 */
function flowLayout(
  graph: FlowGraph,
  options: {
    width: number
    height: number
    nodeWidth: number
    nodePadding: number
    start?: number
    end?: number
    sort?: 'auto' | 'data'
    direction?: ReadingDirection
  },
): FlowLayout {
  const { width, height, nodeWidth, nodePadding } = options
  if (graph.nodes.length === 0 || width <= 0 || height <= 0)
    return { nodes: [], links: [] }
  const start = options.start ?? 0
  const end = options.end ?? 0
  // At least a node's width across, so a plot too narrow for its labels still draws.
  const right = Math.max(start + nodeWidth, width - end)
  const order = new Map(graph.nodes.map((node, at) => [node.key, at]))
  const layers = new Map(graph.nodes.map((node) => [node.key, node.layer]))
  type Node = { key: string }
  type Link = { source: string; target: string; value: number; key: string }
  const layout = sankey<Node, Link>()
    .nodeId((node) => node.key)
    .nodeWidth(nodeWidth)
    .nodePadding(nodePadding)
    // The columns the graph already worked out, so the layout and the keys agree.
    .nodeAlign((node) => layers.get(node.key) ?? 0)
    .extent([
      [start, 0],
      [right, height],
    ])
  if (options.sort === 'data') {
    layout.nodeSort((a, b) => (order.get(a.key) ?? 0) - (order.get(b.key) ?? 0))
  }
  const laid = layout({
    nodes: graph.nodes.map((node) => ({ key: node.key })),
    links: graph.links.map((link) => ({
      source: link.source.key,
      target: link.target.key,
      value: link.value,
      key: link.key,
    })),
  })
  const mirror = options.direction === 'rtl'
  const x = (at: number) => (mirror ? width - at : at)
  const nodes = laid.nodes.map((node) => {
    const [x0, x1] = [x(node.x0 ?? 0), x(node.x1 ?? 0)].toSorted((a, b) => a - b) as [
      number,
      number,
    ]
    return { key: node.key, x0, x1, y0: node.y0 ?? 0, y1: node.y1 ?? 0 }
  })
  const links = laid.links.map((link: SankeyLink<Node, Link>) => {
    const source = link.source as SankeyNode<Node, Link>
    const target = link.target as SankeyNode<Node, Link>
    return {
      key: link.key,
      source: source.key,
      target: target.key,
      x0: x(source.x1 ?? 0),
      x1: x(target.x0 ?? 0),
      y0: link.y0 ?? 0,
      y1: link.y1 ?? 0,
      width: link.width ?? 0,
    }
  })
  // The keys' order, column by column, so the layout's shapes match the chart's categories.
  return {
    nodes: nodes.toSorted((a, b) => (order.get(a.key) ?? 0) - (order.get(b.key) ?? 0)),
    links,
  }
}

/**
 * Every node and flow that lies on a way through `from`: the node itself,
 * or a flow and its two nodes, and everything upstream and downstream of
 * it. Each node is walked once, so a graph of many crossing ways stays quick.
 */
function flowPath(
  graph: FlowGraph,
  from: { node: string } | { link: string },
): { nodes: Set<string>; links: Set<string> } {
  const nodes = new Set<string>()
  const links = new Set<string>()
  const byKey = new Map(graph.nodes.map((node) => [node.key, node]))
  const walk = (node: FlowNode, way: 'up' | 'down') => {
    const seen = way === 'up' ? upSeen : downSeen
    if (seen.has(node)) return
    seen.add(node)
    nodes.add(node.key)
    for (const link of way === 'up' ? node.targetLinks : node.sourceLinks) {
      links.add(link.key)
      walk(way === 'up' ? link.source : link.target, way)
    }
  }
  const upSeen = new Set<FlowNode>()
  const downSeen = new Set<FlowNode>()
  if ('node' in from) {
    const node = byKey.get(from.node)
    if (!node) return { nodes, links }
    walk(node, 'up')
    walk(node, 'down')
    return { nodes, links }
  }
  const link = graph.links.find((one) => one.key === from.link)
  if (!link) return { nodes, links }
  links.add(link.key)
  walk(link.source, 'up')
  walk(link.target, 'down')
  return { nodes, links }
}

/**
 * How far along a flow's band a point `along` its length across is, as the
 * curve's own `t`: the band is a cubic from its source to its target with
 * both handles at the middle across, as d3-sankey draws it, so across runs
 * as 1.5t − 1.5t² + t³, which only rises.
 */
function curveAt(along: number) {
  let low = 0
  let high = 1
  for (let step = 0; step < 30; step++) {
    const t = (low + high) / 2
    if (1.5 * t - 1.5 * t * t + t * t * t < along) low = t
    else high = t
  }
  return (low + high) / 2
}

/**
 * The node or flow under a point, in px of the plot: a node within `reach`
 * of it across, or else the flow whose band covers it, nearest its middle
 * where bands overlap. Null over the empty plot.
 */
function flowAt(
  point: { x: number; y: number },
  layout: FlowLayout,
  reach = 0,
): { node: string } | { link: string } | null {
  for (const node of layout.nodes) {
    if (
      point.x >= node.x0 - reach &&
      point.x <= node.x1 + reach &&
      point.y >= Math.min(node.y0, node.y1 - 1) &&
      point.y <= Math.max(node.y1, node.y0 + 1)
    ) {
      return { node: node.key }
    }
  }
  let best: { key: string; off: number } | null = null
  for (const link of layout.links) {
    const left = Math.min(link.x0, link.x1)
    const right = Math.max(link.x0, link.x1)
    if (right <= left || point.x < left || point.x > right) continue
    const along = (point.x - link.x0) / (link.x1 - link.x0)
    const t = curveAt(along)
    const middle = link.y0 + (link.y1 - link.y0) * (3 * t * t - 2 * t * t * t)
    // The band's thickness is across its line, so up and down it reaches further where it slopes.
    const slope =
      ((link.y1 - link.y0) * (6 * t - 6 * t * t)) /
      ((link.x1 - link.x0) * (1.5 - 3 * t + 3 * t * t))
    const half = (Math.max(link.width, 1) / 2) * Math.sqrt(1 + slope * slope)
    const off = Math.abs(point.y - middle) / half
    if (off <= 1 && (!best || off < best.off)) best = { key: link.key, off }
  }
  return best ? { link: best.key } : null
}

/** A flow's band as an SVG path along its middle, stroked as thick as the flow. */
function linkPath(link: Pick<LaidLink, 'x0' | 'x1' | 'y0' | 'y1'>) {
  const middle = (link.x0 + link.x1) / 2
  return `M${round(link.x0)},${round(link.y0)}C${round(middle)},${round(link.y0)} ${round(middle)},${round(link.y1)} ${round(link.x1)},${round(link.y1)}`
}

function round(value: number) {
  return Math.round(value * 100) / 100
}

/**
 * Where a key goes from the node keyed `from`, as a grid's keys move: Up
 * and Down to the node above or below in its column, the arrow pointing
 * along reading order to the next column and the other to the one before,
 * landing on the node there whose middle is nearest, Page Up and Page Down
 * to the top and bottom of the column, and Home and End to the first and
 * last node. Past an edge, the node reached stays. Null for a key the
 * chart doesn't take.
 */
function stepNode(
  graph: FlowGraph,
  layout: FlowLayout,
  from: string,
  key: string,
  direction: ReadingDirection,
): string | null {
  const boxes = new Map(layout.nodes.map((node) => [node.key, node]))
  const at = graph.nodes.find((node) => node.key === from)
  const box = boxes.get(from)
  if (!at || !box) return null
  const middle = (node: LaidNode) => (node.y0 + node.y1) / 2
  const column = (layer: number) =>
    graph.nodes
      .filter((node) => node.layer === layer && boxes.has(node.key))
      .map((node) => boxes.get(node.key) as LaidNode)
      .toSorted((a, b) => a.y0 - b.y0)
  const own = column(at.layer)
  const place = own.findIndex((node) => node.key === from)
  const forward = direction === 'rtl' ? 'ArrowLeft' : 'ArrowRight'
  const back = direction === 'rtl' ? 'ArrowRight' : 'ArrowLeft'
  if (key === 'ArrowUp') return own[Math.max(0, place - 1)]?.key ?? from
  if (key === 'ArrowDown') return own[Math.min(own.length - 1, place + 1)]?.key ?? from
  if (key === 'PageUp') return own[0]?.key ?? from
  if (key === 'PageDown') return own.at(-1)?.key ?? from
  // The first node drawn, at the top of the first column, and the last, at the bottom of the last.
  if (key === 'Home') return column(0)[0]?.key ?? from
  if (key === 'End') return column(graph.columns - 1).at(-1)?.key ?? from
  if (key !== forward && key !== back) return null
  const step = key === forward ? 1 : -1
  for (let layer = at.layer + step; layer >= 0 && layer < graph.columns; layer += step) {
    const there = column(layer)
    if (there.length === 0) continue
    return there.reduce((best, node) =>
      Math.abs(middle(node) - middle(box)) < Math.abs(middle(best) - middle(box))
        ? node
        : best,
    ).key
  }
  return from
}

/** A node's label to place: where it stands, how wide each of its forms is, and how many lines each takes. */
interface FlowLabel {
  key: string
  /** Which side of its node it stands. */
  side: 'left' | 'right'
  /** Its forms, most first, each as wide as its widest line, in px. */
  forms: readonly { fit: 'value' | 'name'; width: number; lines: number }[]
}

/**
 * Which form of its label each node writes, so no two labels and no label
 * and another node cover each other: the biggest nodes first, each taking
 * its fullest form that fits beside what is already placed, its name only,
 * or nothing. A label also stays inside the plot, `width` px wide.
 */
function fitLabels(
  labels: readonly FlowLabel[],
  layout: FlowLayout,
  options: { width: number; gap: number; line: number },
): Map<string, 'value' | 'name' | 'none'> {
  const boxes = new Map(layout.nodes.map((node) => [node.key, node]))
  const placed: { x0: number; x1: number; y0: number; y1: number }[] = []
  const fits = new Map<string, 'value' | 'name' | 'none'>()
  const overlaps = (a: LaidNode | (typeof placed)[number], b: typeof a) =>
    a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1
  const order = labels.toSorted((a, b) => {
    const [boxA, boxB] = [boxes.get(a.key), boxes.get(b.key)]
    return (boxB ? boxB.y1 - boxB.y0 : 0) - (boxA ? boxA.y1 - boxA.y0 : 0)
  })
  for (const label of order) {
    const node = boxes.get(label.key)
    fits.set(label.key, 'none')
    if (!node) continue
    const middle = (node.y0 + node.y1) / 2
    for (const form of label.forms) {
      const half = (form.lines * options.line) / 2
      const x0 =
        label.side === 'left' ? node.x0 - options.gap - form.width : node.x1 + options.gap
      const box = { x0, x1: x0 + form.width, y0: middle - half, y1: middle + half }
      if (box.x0 < 0 || box.x1 > options.width) continue
      if (placed.some((other) => overlaps(box, other))) continue
      if (layout.nodes.some((other) => other.key !== node.key && overlaps(box, other)))
        continue
      placed.push(box)
      fits.set(label.key, form.fit)
      break
    }
  }
  return fits
}

/** A shape the chart draws and moves: a node's box, or a flow's band. */
type FlowShape = ({ kind: 'node' } & LaidNode) | ({ kind: 'link' } & LaidLink)

/** Every node and flow of a layout, as shapes to move. */
function flowShapes(layout: FlowLayout): FlowShape[] {
  return [
    ...layout.nodes.map((node) => ({ kind: 'node' as const, ...node })),
    ...layout.links.map((link) => ({ kind: 'link' as const, ...link })),
  ]
}

interface FlowMove {
  from: FlowShape
  to: FlowShape
}

/**
 * Where each shape moves from and to, between the shapes drawn now, `from`,
 * and the next, `to`. A shape in both moves between its two places. A node
 * that arrives grows from its middle and one that leaves shrinks to it. A
 * flow that arrives starts where it ends, moved by as much as its nodes move,
 * so it keeps to them; one that leaves stays on its nodes where they stay,
 * and else thins away with them.
 */
function flowMoves(from: readonly FlowShape[], to: readonly FlowShape[]): FlowMove[] {
  const before = new Map(from.map((shape) => [shape.key, shape]))
  const after = new Map(to.map((shape) => [shape.key, shape]))
  const nodeBefore = (key: string) => {
    const shape = before.get(key)
    return shape?.kind === 'node' ? shape : undefined
  }
  const nodeAfter = (key: string) => {
    const shape = after.get(key)
    return shape?.kind === 'node' ? shape : undefined
  }
  const shifted = (
    link: LaidLink,
    nodes: (key: string) => LaidNode | undefined,
    others: (key: string) => LaidNode | undefined,
  ): LaidLink => {
    const source = nodes(link.source)
    const target = nodes(link.target)
    const sourceThere = others(link.source)
    const targetThere = others(link.target)
    const gone = !sourceThere && !targetThere
    return {
      ...link,
      y0: link.y0 + (sourceThere && source ? sourceThere.y0 - source.y0 : 0),
      y1: link.y1 + (targetThere && target ? targetThere.y0 - target.y0 : 0),
      width: gone ? 0 : link.width,
    }
  }
  const collapsed = (node: LaidNode): LaidNode => {
    const middle = (node.y0 + node.y1) / 2
    return { ...node, y0: middle, y1: middle }
  }
  const moves: FlowMove[] = []
  for (const shape of to) {
    const was = before.get(shape.key)
    if (was && was.kind === shape.kind) {
      moves.push({ from: was, to: shape })
    } else if (shape.kind === 'node') {
      moves.push({ from: { ...collapsed(shape), kind: 'node' }, to: shape })
    } else {
      moves.push({
        from: { ...shifted(shape, nodeAfter, nodeBefore), kind: 'link' },
        to: shape,
      })
    }
  }
  for (const shape of from) {
    if (after.has(shape.key)) continue
    moves.push({
      from: shape,
      to:
        shape.kind === 'node'
          ? { ...collapsed(shape), kind: 'node' }
          : { ...shifted(shape, nodeBefore, nodeAfter), kind: 'link' },
    })
  }
  return moves
}

/** Every shape `progress` of the way through its move. */
function flowShapesAt(moves: readonly FlowMove[], progress: number): FlowShape[] {
  const mix = (a: number, b: number) => a + (b - a) * progress
  return moves.map(({ from, to }) => {
    if (from.kind === 'node' || to.kind === 'node') {
      return {
        ...to,
        x0: mix(from.x0, to.x0),
        x1: mix(from.x1, to.x1),
        y0: mix(from.y0, to.y0),
        y1: mix(from.y1, to.y1),
      }
    }
    return {
      ...to,
      x0: mix(from.x0, to.x0),
      x1: mix(from.x1, to.x1),
      y0: mix(from.y0, to.y0),
      y1: mix(from.y1, to.y1),
      width: mix(from.width, to.width),
    }
  })
}

export {
  curveAt,
  type FlowAlign,
  flowAt,
  flowEnds,
  type FlowGraph,
  flowGraph,
  type FlowLabel,
  fitLabels,
  flowKey,
  type FlowLayout,
  flowLayout,
  type FlowLink,
  type FlowMove,
  flowMoves,
  type FlowNode,
  flowPath,
  type FlowShape,
  flowShapes,
  flowShapesAt,
  type LaidLink,
  type LaidNode,
  linkPath,
  stepNode,
}
