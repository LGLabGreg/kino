import type { ChartConfig, ChartDatum, ReadingDirection } from '@/registry/lib/chart-math'
import { hierarchy, type HierarchyNode, partition, treemap } from 'd3-hierarchy'

/*
 * The tiles of a chart drawn as nested boxes sized by value, such as a
 * treemap: the tree its rows make, the part of it in view, the boxes
 * d3-hierarchy's squarify lays it out in, where a box comes from and goes to
 * when the view zooms in or out, and whether a label fits its box. Pure, so
 * the chart only draws.
 */

/** A node of the tree: a row, and the rows under its `children`. */
interface TileNode {
  /** Its path joined, unique in the tree: the root's is the empty string. */
  key: string
  /** The `index` values from the top down to it, as text. */
  path: readonly string[]
  /** Its own `index` value. */
  name: unknown
  datum: ChartDatum
  /** Its own value, or its children's added up; never below zero. */
  value: number
  /** Whether it has no value to say: a row's that isn't a number, or every child's. */
  missing: boolean
  children: readonly TileNode[]
}

/** A box, as fractions of the plot from its physical left and its top. */
interface TileBox {
  x0: number
  y0: number
  x1: number
  y1: number
}

/** A tile in view: a node, the group it sits in, and its box. */
interface LaidTile {
  key: string
  node: TileNode
  /** The group around it, or none for a tile that is a group of its own. */
  group: TileNode | null
  /** The top of the tree it is under: its path's first name, its key in the config. */
  top: string
  box: TileBox
}

/** A group in view: a node whose children are tiles, its box, and whether it has room for a header. */
interface LaidGroup {
  key: string
  node: TileNode
  top: string
  box: TileBox
  header: boolean
}

interface TileLayout {
  view: TileNode
  groups: readonly LaidGroup[]
  tiles: readonly LaidTile[]
}

/** What separates the names of a path in a node's key. */
const PATH_SEPARATOR = '\u001f'

/** The room a group's header takes above its tiles, in px. */
const HEADER_HEIGHT = 20

/** The least room a group keeps for its tiles under a header, in px, or it has none. */
const LEAST_UNDER_HEADER = 24

/** The narrowest group that has a header, in px. */
const LEAST_HEADER_WIDTH = 48

/** A label's room inside its tile, in px: its padding, and a line of the chart's text. */
const LABEL_PADDING = 6
const LABEL_LINE = 16

/** The room between a header's name and its worth. */
const HEADER_SPACE = 8

/** How near an edge, in px, a box counts as touching it. */
const EDGE = 1e-6

function keyOf(path: readonly string[]) {
  return path.join(PATH_SEPARATOR)
}

/** A value above zero, or zero for one missing, not a number, or below zero. */
function positive(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
}

/**
 * The tree `rows` make: each row a node, named by its `index` value, worth
 * its `dataKey` value, with the rows under its `children` inside it, which
 * it is then worth together. Rows that aren't objects are left out.
 */
function tileTree(rows: readonly ChartDatum[], index: string, dataKey: string): TileNode {
  const build = (datum: ChartDatum, path: readonly string[]): TileNode => {
    const below = datum.children
    const children = Array.isArray(below)
      ? below
          .filter(
            (row): row is ChartDatum =>
              typeof row === 'object' && row !== null && !Array.isArray(row),
          )
          .map((row) => build(row, [...path, String(row[index])]))
      : []
    return {
      key: keyOf(path),
      path,
      name: datum[index],
      datum,
      value:
        children.length > 0
          ? children.reduce((sum, child) => sum + child.value, 0)
          : positive(datum[dataKey]),
      missing:
        children.length > 0
          ? children.every((child) => child.missing)
          : !(typeof datum[dataKey] === 'number' && Number.isFinite(datum[dataKey])),
      children,
    }
  }
  return build({ children: rows }, [])
}

/**
 * The node `path` leads to, as far as the tree has it, that has children to
 * show: a path to a leaf, or past the tree's end, stops at the deepest node
 * on the way that has some.
 */
function tileNodeAt(root: TileNode, path: readonly string[]): TileNode {
  let node = root
  for (const name of path) {
    const next = node.children.find((child) => child.path.at(-1) === name)
    if (!next || next.children.length === 0) break
    node = next
  }
  return node
}

/** The nodes from the root down to `node`'s parent, which a way back out shows. */
function tileAncestors(root: TileNode, node: TileNode): TileNode[] {
  const out: TileNode[] = []
  let at = root
  for (const name of node.path) {
    out.push(at)
    const next = at.children.find((child) => child.path.at(-1) === name)
    if (!next) break
    at = next
  }
  return out
}

/** Biggest first; a tie keeps the order of the data. */
function bySize(nodes: readonly TileNode[]) {
  return nodes.toSorted((a, b) => b.value - a.value)
}

/**
 * The tiles `view` shows, in the order the keys step through them: its
 * children, biggest first, each the group of its own children, biggest
 * first, or a tile of its own when it has none. Tops in `hidden` are left
 * out at the root.
 */
function viewTiles(
  view: TileNode,
  hidden: readonly string[] = [],
): { node: TileNode; group: TileNode | null }[] {
  const shown = view.children.filter(
    (child) => view.path.length > 0 || !hidden.includes(child.path[0] ?? ''),
  )
  return bySize(shown).flatMap((group): { node: TileNode; group: TileNode | null }[] =>
    group.children.length > 0
      ? bySize(group.children).map((node) => ({ node, group }))
      : [{ node: group, group: null }],
  )
}

/**
 * Lays `nodes` out in a box `width` by `height` px with squarify, `gap` px
 * apart, biggest first. With a `shape` (width over height), they are laid
 * out in a box of that shape and the same area, then stretched to fit, so a
 * group zoomed into keeps the arrangement it had.
 */
function squarify(
  nodes: readonly TileNode[],
  width: number,
  height: number,
  gap: number,
  shape?: number,
): { node: TileNode; x0: number; y0: number; x1: number; y1: number }[] {
  const across = Math.max(0, width)
  const down = Math.max(0, height)
  const shaped =
    shape !== undefined && Number.isFinite(shape) && shape > 0 && across * down > 0
  const laidWidth = shaped ? Math.sqrt(across * down * shape) : across
  const laidHeight = shaped ? Math.sqrt((across * down) / shape) : down
  const root = hierarchy<{ node?: TileNode; nodes?: readonly TileNode[] }>(
    { nodes },
    (datum) => datum.nodes?.map((node) => ({ node })),
  )
    .sum((datum) => datum.node?.value ?? 0)
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0))
  const laid = treemap<{ node?: TileNode }>().size([laidWidth, laidHeight]).round(false)(
    root as HierarchyNode<{ node?: TileNode }>,
  )
  const stretchX = laidWidth === 0 ? 0 : across / laidWidth
  const stretchY = laidHeight === 0 ? 0 : down / laidHeight
  // The gap goes in after the stretch, half on each side that meets another
  // box, so it stays `gap` px both ways and the outer edges stay flush.
  const half = gap / 2
  const inset = (start: number, end: number, size: number) => ({
    start: start > EDGE ? start + half : start,
    end: end < size - EDGE ? end - half : end,
  })
  return (laid.children ?? []).map((child) => {
    const x = inset(child.x0 * stretchX, child.x1 * stretchX, across)
    const y = inset(child.y0 * stretchY, child.y1 * stretchY, down)
    return {
      node: child.data.node!,
      x0: x.start,
      y0: y.start,
      x1: Math.max(x.start, x.end),
      y1: Math.max(y.start, y.end),
    }
  })
}

type TileLayoutOptions = {
  width: number
  height: number
  groupGap: number
  tileGap: number
  direction: ReadingDirection
  hidden?: readonly string[]
  shape?: number
}

/**
 * The boxes of `view`'s groups and tiles in a plot `width` by `height` px:
 * the groups by their worth with `groupGap` px between them, a header above
 * the tiles of each group with the room for one, and the tiles inside with
 * `tileGap` px between them. Right to left mirrors it. Tops in `hidden` are
 * left out at the root. A `shape` lays the groups out as they sat in a box
 * of that shape (`viewShape`).
 */
function tileLayout(
  view: TileNode,
  { width, height, groupGap, tileGap, direction, hidden = [], shape }: TileLayoutOptions,
): TileLayout {
  const shown = view.children.filter(
    (child) => view.path.length > 0 || !hidden.includes(child.path[0] ?? ''),
  )
  const box = (x0: number, y0: number, x1: number, y1: number): TileBox => {
    const left = width === 0 ? 0 : x0 / width
    const right = width === 0 ? 0 : x1 / width
    return {
      x0: direction === 'rtl' ? 1 - right : left,
      x1: direction === 'rtl' ? 1 - left : right,
      y0: height === 0 ? 0 : y0 / height,
      y1: height === 0 ? 0 : y1 / height,
    }
  }
  const groups: LaidGroup[] = []
  const tiles: LaidTile[] = []
  for (const laid of squarify(shown, width, height, groupGap, shape)) {
    const { node } = laid
    const top = node.path[0] ?? ''
    if (node.children.length === 0) {
      tiles.push({
        key: node.key,
        node,
        group: null,
        top,
        box: box(laid.x0, laid.y0, laid.x1, laid.y1),
      })
      continue
    }
    const header =
      laid.y1 - laid.y0 >= HEADER_HEIGHT + LEAST_UNDER_HEADER &&
      laid.x1 - laid.x0 >= LEAST_HEADER_WIDTH
    const under = header ? HEADER_HEIGHT : 0
    groups.push({
      key: node.key,
      node,
      top,
      box: box(laid.x0, laid.y0, laid.x1, laid.y1),
      header,
    })
    for (const inner of squarify(
      node.children,
      laid.x1 - laid.x0,
      laid.y1 - laid.y0 - under,
      tileGap,
    )) {
      tiles.push({
        key: inner.node.key,
        node: inner.node,
        group: node,
        top,
        box: box(
          laid.x0 + inner.x0,
          laid.y0 + under + inner.y0,
          laid.x0 + inner.x1,
          laid.y0 + under + inner.y1,
        ),
      })
    }
  }
  return { view, groups, tiles }
}

/** `inner`, a box of the whole plot, drawn inside `frame` instead. */
/**
 * The shape (width over height) the tiles of the view at `path` had in the
 * view above it, walking down from `root`, so zooming in keeps them where
 * they were, only bigger. None at the root, or for a path that isn't laid out.
 */
function viewShape(
  root: TileNode,
  path: readonly string[],
  options: Omit<TileLayoutOptions, 'shape'>,
): number | undefined {
  const view = tileNodeAt(root, path)
  let node = root
  let shape: number | undefined
  for (const name of view.path) {
    const layout = tileLayout(node, { ...options, shape })
    const next = node.children.find((child) => child.path.at(-1) === name)
    const group = layout.groups.find((laid) => laid.key === next?.key)
    if (!next || !group) return undefined
    const across = (group.box.x1 - group.box.x0) * options.width
    const down =
      (group.box.y1 - group.box.y0) * options.height - (group.header ? HEADER_HEIGHT : 0)
    if (!(across > 0 && down > 0)) return undefined
    shape = across / down
    node = next
  }
  return shape
}

function boxWithin(inner: TileBox, frame: TileBox): TileBox {
  const width = frame.x1 - frame.x0
  const height = frame.y1 - frame.y0
  return {
    x0: frame.x0 + inner.x0 * width,
    x1: frame.x0 + inner.x1 * width,
    y0: frame.y0 + inner.y0 * height,
    y1: frame.y0 + inner.y1 * height,
  }
}

/**
 * `box` once `frame` is stretched to fill the plot, the reverse of
 * `boxWithin`, cut to the plot's edges, so a box pushed out of it lies
 * flat against the edge it went past.
 */
function boxOutOf(box: TileBox, frame: TileBox): TileBox {
  const width = frame.x1 - frame.x0
  const height = frame.y1 - frame.y0
  const clamp = (value: number) => Math.min(1, Math.max(0, value))
  if (width <= 0 || height <= 0) return box
  return {
    x0: clamp((box.x0 - frame.x0) / width),
    x1: clamp((box.x1 - frame.x0) / width),
    y0: clamp((box.y0 - frame.y0) / height),
    y1: clamp((box.y1 - frame.y0) / height),
  }
}

/** A box with no size, at the middle of `box`: where a tile grows from and shrinks into. */
function centreOf(box: TileBox): TileBox {
  const x = (box.x0 + box.x1) / 2
  const y = (box.y0 + box.y1) / 2
  return { x0: x, x1: x, y0: y, y1: y }
}

/** Whether `path` starts with `start`, or is it. */
function startsWith(path: readonly string[], start: readonly string[]) {
  return start.length <= path.length && start.every((name, at) => path[at] === name)
}

/** The box `layout` shows for the node at `path`, or for its nearest ancestor it shows. */
function shownBox(layout: TileLayout, path: readonly string[]): TileBox | null {
  let best: { length: number; box: TileBox } | null = null
  for (const shown of [...layout.groups, ...layout.tiles]) {
    const length = shown.node.path.length
    if (startsWith(path, shown.node.path) && (!best || length > best.length)) {
      best = { length, box: shown.box }
    }
  }
  return best?.box ?? null
}

/**
 * Where each box that arrives with `now` comes from, and where each box that
 * leaves with it goes, by key, after the view was `was`. Zooming in, what
 * arrives grows out of where the new view sat, and what leaves is pushed
 * past the plot's edges; zooming out, the reverse. Otherwise, what arrives
 * grows from its box's centre, and what leaves shrinks into it. A box in
 * both moves between them.
 */
function tileMoves(
  was: TileLayout | null,
  now: TileLayout,
): { from: Map<string, TileBox>; to: Map<string, TileBox> } {
  const from = new Map<string, TileBox>()
  const to = new Map<string, TileBox>()
  if (!was) return { from, to }
  const all = (layout: TileLayout) => [...layout.groups, ...layout.tiles]
  const before = new Map(all(was).map((shown) => [shown.key, shown.box]))
  const after = new Map(all(now).map((shown) => [shown.key, shown.box]))
  const zoomedIn =
    now.view.key !== was.view.key && startsWith(now.view.path, was.view.path)
  const zoomedOut =
    now.view.key !== was.view.key && startsWith(was.view.path, now.view.path)
  // Zooming in, where the new view sat before; zooming out, where the old one sits now.
  const frame = zoomedIn
    ? shownBox(was, now.view.path)
    : zoomedOut
      ? shownBox(now, was.view.path)
      : null
  for (const [key, box] of after) {
    if (before.has(key)) continue
    from.set(
      key,
      !frame ? centreOf(box) : zoomedIn ? boxWithin(box, frame) : boxOutOf(box, frame),
    )
  }
  for (const [key, box] of before) {
    if (after.has(key)) continue
    to.set(
      key,
      !frame ? centreOf(box) : zoomedIn ? boxOutOf(box, frame) : boxWithin(box, frame),
    )
  }
  return { from, to }
}

/**
 * What a tile's label can show in a box `width` by `height` px: its name
 * and value on two lines, its name only, or nothing, never cut short.
 */
function labelFit(
  width: number,
  height: number,
  nameWidth: number,
  valueWidth: number,
  wanted: 'value' | 'name' | 'none',
): 'value' | 'name' | 'none' {
  if (wanted === 'none') return 'none'
  const room = width - LABEL_PADDING * 2
  if (
    wanted === 'value' &&
    room >= Math.max(nameWidth, valueWidth) &&
    height >= LABEL_LINE * 2 + LABEL_PADDING * 2
  ) {
    return 'value'
  }
  if (room >= nameWidth && height >= LABEL_LINE + LABEL_PADDING * 2) return 'name'
  return 'none'
}

/**
 * What a group's header can show across `width` px: its name and worth,
 * 8px apart, its name only, or nothing, never cut short.
 */
function headerFit(
  width: number,
  nameWidth: number,
  valueWidth: number,
): 'value' | 'name' | 'none' {
  const room = width - LABEL_PADDING * 2
  if (room >= nameWidth + HEADER_SPACE + valueWidth) return 'value'
  if (room >= nameWidth) return 'name'
  return 'none'
}

function inBox(box: TileBox, x: number, y: number) {
  return x >= box.x0 && x <= box.x1 && y >= box.y0 && y <= box.y1
}

/** How far a point is from a box, in px; none inside it. */
function boxDistance(box: TileBox, x: number, y: number, width: number, height: number) {
  const dx = Math.max(box.x0 - x, 0, x - box.x1) * width
  const dy = Math.max(box.y0 - y, 0, y - box.y1) * height
  return Math.hypot(dx, dy)
}

/**
 * What sits at `point`, in px from the plot's top left corner: a group's
 * header, or the tile under it, or the nearest within `reach` px, so a
 * pointer in the gap between tiles still finds one. A tile is its place in
 * `tiles`, where none (a tile leaving) can't be found.
 */
function tileAt(
  point: { x: number; y: number },
  {
    width,
    height,
    groups,
    tiles,
    reach,
  }: {
    width: number
    height: number
    groups: readonly LaidGroup[]
    tiles: readonly ({ box: TileBox } | null)[]
    reach: number
  },
): { tile: number } | { group: LaidGroup } | null {
  if (width === 0 || height === 0) return null
  const x = point.x / width
  const y = point.y / height
  const header = groups.find(
    (group) =>
      group.header && inBox(group.box, x, y) && y < group.box.y0 + HEADER_HEIGHT / height,
  )
  if (header) return { group: header }
  let best: number | null = null
  let nearest = reach
  for (const [at, tile] of tiles.entries()) {
    if (!tile) continue
    const distance = boxDistance(tile.box, x, y, width, height)
    if (distance <= nearest) {
      best = at
      nearest = distance
    }
  }
  return best === null ? null : { tile: best }
}

/**
 * The colour of the nodes under `top`: its own from the config, or the next
 * of the chart's colours for a top the config leaves out, whose name may
 * not be a CSS variable's.
 */
function topColor(series: readonly string[], config: ChartConfig, top: string): string {
  const ramp = `var(--chart-${(Math.max(0, series.indexOf(top)) % 5) + 1})`
  return config[top] ? `var(--color-${top}, ${ramp})` : ramp
}

/*
 * Rings: a tree laid out as arcs round a centre, such as a sunburst's. Each
 * node takes its share of its parent's turn, by d3-hierarchy's partition,
 * and a ring for its depth below the part in view. Places are fractions, of
 * a turn clockwise from the top and of the room from the hole to the edge,
 * so a zoom or new data moves each arc by straight lines between two places.
 */

/** A node's place round the whole: its share of the turn from the top, and its depth below the whole. */
interface RingNode {
  key: string
  node: TileNode
  /** The top of the tree it is under: its path's first name, its key in the config. */
  top: string
  /** 1 for a top. */
  depth: number
  start: number
  end: number
}

/**
 * Where an arc sits: `start` to `end` round the turn, clockwise from the
 * top, and `inner` to `outer` across the rings, as fractions of the room
 * from the hole to the edge.
 */
interface ArcPlace {
  start: number
  end: number
  inner: number
  outer: number
}

/** An arc in view: a node, its place, and its depth below the whole. */
interface RingArc extends ArcPlace {
  key: string
  node: TileNode
  top: string
  depth: number
}

interface RingLayout {
  /** The part in view, which the arcs ring. */
  view: TileNode
  /** How many rings the view shows. */
  rings: number
  /** The arcs in view, depth first: a parent, then its children clockwise. */
  arcs: readonly RingArc[]
  /** Every node's place round the whole, by key, the hidden tops' left out. */
  places: ReadonlyMap<string, RingNode>
}

/** The most rings a chart of rings shows from the part in view. */
const RINGS = 3

/**
 * Every node below `root`, but those under a top in `hidden`, laid round a
 * whole turn by d3's partition, depth first: a parent, then its children
 * clockwise, biggest first, or with `sort` false in the data's order.
 */
function ringTree(
  root: TileNode,
  { hidden = [], sort = true }: { hidden?: readonly string[]; sort?: boolean } = {},
): RingNode[] {
  const tree = hierarchy<TileNode>(root, (node) =>
    node.path.length === 0
      ? node.children.filter((child) => !hidden.includes(child.path[0] ?? ''))
      : node.children,
  ).sum((node) => (node.children.length > 0 ? 0 : node.value))
  // A stable sort, so a tie keeps the data's order.
  if (sort) tree.sort((a, b) => (b.value ?? 0) - (a.value ?? 0))
  const laid = partition<TileNode>().size([1, 1]).round(false)(tree)
  const out: RingNode[] = []
  laid.eachBefore((placed) => {
    if (placed.depth === 0) return
    out.push({
      key: placed.data.key,
      node: placed.data,
      top: placed.data.path[0] ?? '',
      depth: placed.depth,
      // A whole worth nothing gives every node an empty share at the top.
      start: Number.isFinite(placed.x0) ? placed.x0 : 0,
      end: Number.isFinite(placed.x1) ? placed.x1 : 0,
    })
  })
  return out
}

function clampUnit(value: number) {
  return Math.min(1, Math.max(0, value))
}

/**
 * Where the node at `place` sits once `window`, a part's share of the turn
 * at `depth`, fills the turn with `rings` rings round it: a node outside the
 * window folds to the top, at its start or its end, and one above the
 * window's depth into the hole, one past the last ring onto the edge.
 */
function placeIn(
  place: Pick<RingNode, 'start' | 'end' | 'depth'>,
  window: { start: number; end: number; depth: number },
  rings: number,
): ArcPlace {
  const span = window.end - window.start
  const turn = (at: number) => (span > 0 ? clampUnit((at - window.start) / span) : 0)
  const ring = (depth: number) => clampUnit((depth - window.depth) / rings)
  return {
    start: turn(place.start),
    end: turn(place.end),
    inner: ring(place.depth - 1),
    outer: ring(place.depth),
  }
}

/** The window a part in view fills: its own share of the turn, or the whole turn for the whole. */
function windowOf(layout: Pick<RingLayout, 'view' | 'places'>) {
  const own = layout.places.get(layout.view.key)
  return own ?? { start: 0, end: 1, depth: 0 }
}

/**
 * The arcs `view` shows, out of the places `ringTree` laid round the whole:
 * every node under it on up to `rings` rings, fewer where the tree under it
 * is shallower, so its rings fill the room.
 */
function ringLayout(
  view: TileNode,
  places: readonly RingNode[],
  rings: number = RINGS,
): RingLayout {
  const byKey = new Map(places.map((place) => [place.key, place]))
  const depth = view.path.length
  const under = places.filter(
    (place) => place.depth > depth && startsWith(place.node.path, view.path),
  )
  const deepest = under.reduce((most, place) => Math.max(most, place.depth - depth), 0)
  const count = Math.max(1, Math.min(rings, deepest))
  const window = windowOf({ view, places: byKey })
  const arcs = under
    .filter((place) => place.depth - depth <= count)
    .map((place) => ({
      key: place.key,
      node: place.node,
      top: place.top,
      depth: place.depth,
      ...placeIn(place, window, count),
    }))
  return { view, rings: count, arcs, places: byKey }
}

/** An empty place at the middle of `place`'s turn: where an arc grows from and shrinks into. */
function middleOf(place: ArcPlace): ArcPlace {
  const middle = (place.start + place.end) / 2
  return { ...place, start: middle, end: middle }
}

/**
 * Where an arc that arrives with a layout comes from, after `was`: where
 * its node sat under `was`'s view, so a zoom moves every arc as one
 * (zooming in, the deeper ring arrives from the edge, and zooming out the
 * parent's siblings unfold from the top); or for a node new to the data,
 * its own middle, which it grows from.
 */
function arcFrom(arc: RingArc, was: RingLayout | null): ArcPlace {
  const place = was?.places.get(arc.key)
  return was && place ? placeIn(place, windowOf(was), was.rings) : middleOf(arc)
}

/**
 * Where an arc that leaves goes, in `now`: where its node sits under
 * `now`'s view (zooming in, the parent folds into the hole and its siblings
 * into the top); or for a node gone from the data, its own middle, which it
 * shrinks into.
 */
function arcTo(arc: RingArc, now: RingLayout): ArcPlace {
  const place = now.places.get(arc.key)
  return place ? placeIn(place, windowOf(now), now.rings) : middleOf(arc)
}

/** The place `progress` of the way from `from` to `to`, in straight lines. */
function placeBetween(from: ArcPlace, to: ArcPlace, progress: number): ArcPlace {
  const at = (a: number, b: number) => a + (b - a) * progress
  return {
    start: at(from.start, to.start),
    end: at(from.end, to.end),
    inner: at(from.inner, to.inner),
    outer: at(from.outer, to.outer),
  }
}

export {
  type ArcPlace,
  placeBetween,
  RINGS,
  type RingArc,
  ringLayout,
  type RingLayout,
  arcFrom,
  arcTo,
  middleOf,
  type RingNode,
  ringTree,
  boxOutOf,
  centreOf,
  boxWithin,
  HEADER_HEIGHT,
  headerFit,
  LABEL_PADDING,
  type LaidGroup,
  type LaidTile,
  labelFit,
  shownBox,
  type TileBox,
  tileAncestors,
  tileAt,
  type TileLayout,
  tileLayout,
  type TileLayoutOptions,
  tileMoves,
  type TileNode,
  tileNodeAt,
  topColor,
  tileTree,
  viewShape,
  viewTiles,
}
