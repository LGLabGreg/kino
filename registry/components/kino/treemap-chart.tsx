'use client'

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/registry/components/kino/breadcrumb'
import { useAnnouncer } from '@/registry/lib/announce'
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
  type ChartCategory,
  type ChartContextValue,
  useCategoryChart,
  useChart,
} from '@/registry/lib/chart-core'
import type { ChartConfig, ChartDatum } from '@/registry/lib/chart-math'
import {
  drawingSize,
  forcedSeriesColor,
  labelOnClassName,
  patternImage,
  plotLayerClassName,
  swatchClassName,
} from '@/registry/lib/chart-root'
import { bandAt } from '@/registry/lib/chart-scale'
import {
  centreOf,
  LABEL_PADDING,
  type LaidTile,
  labelFit,
  type TileBox,
  tileAncestors,
  type TileLayout,
  tileLayout,
  tileMoves,
  type TileNode,
  tileNodeAt,
  tileTree,
  tileAt,
  headerFit,
  viewShape,
  viewTiles,
} from '@/registry/lib/chart-tiles'
import { useControllable } from '@/registry/lib/controllable'
import { numberFormatter } from '@/registry/lib/number-format'
import {
  placeholderBreatheClassName,
  placeholderFillClassName,
} from '@/registry/lib/placeholder'
import {
  type ComponentProps,
  createContext,
  type CSSProperties,
  Fragment,
  memo,
  use,
  useState,
} from 'react'

import { cn } from '@/lib/utils'

/*
 * The Treemap chart: a whole as nested tiles, each as large as its value. A
 * row's `children` are its tiles, so the chart shows the groups of the part
 * in view, each with a header and its tiles inside, coloured by the top of
 * the tree they are under. A press on a group zooms into it until it fills
 * the chart, and the way back out, Escape, or the path above the chart zoom
 * out again. The tile under the pointer or the keys stays bright while the
 * rest step back, and new data moves every tile from where it is. Each tile
 * is a layer as large as the plot, cut to its box, so moving and resizing
 * it is one property that turns back from wherever it is.
 */

interface TreemapChartProps extends Omit<
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
  /** What the values are, such as "Cost": the tooltip's and the data table's word for them. */
  valueLabel?: string
  /** The part zoomed into, as the `index` values from the top down to it; `[]`, the whole, by default. */
  zoom?: string[]
  defaultZoom?: string[]
  onZoomChange?: (zoom: string[]) => void
  /** What each tile writes on itself, where it has the room: its name and value, its name, or nothing. */
  labels?: 'value' | 'name' | 'none'
  /** A tile's own colour, such as one for its value, in place of its group's; `undefined` keeps the group's. */
  color?: (row: ChartDatum, index: number) => string | undefined
  /**
   * How the tiles arrive the first time the chart comes into view: growing
   * from their centres, or simply there, the default, since a page that
   * loads doesn't animate into place.
   */
  entrance?: 'draw' | 'none'
}

const treemapChartKeys = [
  'dataKey',
  'valueLabel',
  'zoom',
  'defaultZoom',
  'onZoomChange',
  'labels',
  'color',
  'entrance',
]

/** Where each tile's own fields sit in the rows the chart core is given. */
const TILE_KEY = '\u0000tile'
const TILE_TOP = '\u0000top'

/** The room between two groups, on top of the room between two tiles, in px. */
const GROUP_GAP = 4

/** How far from a tile, in px, the pointer still lights it: across the room between groups. */
const NEAR_TILE = 8

interface TreemapContextValue {
  tree: TileNode
  view: TileNode
  zoomTo: (path: readonly string[]) => void
  nameOf: (node: TileNode) => string
}

const TreemapContext = createContext<TreemapContextValue | null>(null)

function useTreemapChart() {
  const treemap = use(TreemapContext)
  if (!treemap) throw new Error('Treemap chart parts go inside a `TreemapChart`.')
  return treemap
}

/**
 * The chart's root: the tree from the rows, the part of it in view, and its
 * tiles laid out in the plot, with the frame its path, legend and tooltip
 * draw in.
 */
function TreemapChart(props: TreemapChartProps) {
  const {
    data,
    index,
    dataKey,
    config,
    valueLabel,
    labels = 'value',
    color,
    entrance = 'none',
    messages,
    description,
    empty,
    className,
    ref,
  } = props
  const tree = tileTree(data, index, dataKey)
  // Every top is a group the legend and the keys know, the ones the config leaves out after
  // its own, named by their names.
  const groups: ChartConfig = { ...config }
  for (const top of tree.children) {
    const key = top.path[0] ?? ''
    groups[key] ??= {
      label: props.categoryFormat ? props.categoryFormat(top.name) : String(top.name),
    }
  }
  const [hidden, setHidden] = useControllable(
    props.hiddenSeries,
    props.defaultHiddenSeries ?? [],
    props.onHiddenSeriesChange,
  )
  const [zoom, setZoom] = useControllable(
    props.zoom,
    props.defaultZoom ?? [],
    props.onZoomChange,
  )
  const asked = tileNodeAt(tree, zoom)
  // A part whose top is hidden can't be in view, so the whole is.
  const view = hidden.includes(asked.path[0] ?? '') ? tree : asked
  const { announce, region } = useAnnouncer()
  const nameOf = (node: TileNode): string => {
    if (node.path.length === 0) return chart.messages.whole
    if (props.categoryFormat) return props.categoryFormat(node.name)
    const named = node.path.length === 1 ? groups[node.path[0] ?? '']?.label : undefined
    return typeof named === 'string' ? named : String(node.name)
  }
  const zoomTo = (path: readonly string[]) => {
    const next = tileNodeAt(tree, path)
    if (next.key === view.key) return
    setZoom([...next.path])
    announce(chart.messages.zoomedTo(nameOf(next)))
  }

  const inView = viewTiles(view)
  const { chart, placeholder, phase } = useCategoryChart(
    {
      ...props,
      config: groups,
      color: undefined,
      data: inView.map(({ node }) => ({
        ...node.datum,
        [TILE_KEY]: node.key,
        [TILE_TOP]: node.path[0] ?? '',
      })),
      hiddenSeries: hidden,
      defaultHiddenSeries: undefined,
      onHiddenSeriesChange: (next) => {
        // Hiding the top in view zooms back out to the whole, where the rest still are.
        if (next.includes(view.path[0] ?? '\u0000')) {
          setZoom([])
          announce(chart.messages.zoomedTo(nameOf(tree)))
        }
        setHidden(next)
      },
      categoryFormat: (value) => {
        if (props.categoryFormat) return props.categoryFormat(value)
        const named = groups[String(value)]?.label
        return typeof named === 'string' ? named : String(value)
      },
      messages: {
        series: 'Groups',
        empty: 'No data yet',
        allHidden: 'Every group is hidden',
        showAll: (count) => `Show all ${count} groups`,
        ...messages,
      },
    },
    {
      orientation: 'vertical',
      stack: 'none',
      entrance: entrance !== 'none',
      // Every tile that arrives or leaves fades, in full and reduced motion alike, so the
      // chart waits on that before letting one go.
      nice: false,
      seriesOfRow: (row) => String(row[TILE_TOP]),
      keyOf: (row) => String(row[TILE_KEY]),
      bandOf: (at, count) => bandAt(at, count),
      measure: () => ({ extent: [0, 1] as const }),
    },
  )

  const size = drawingSize(chart.plotSize)
  const layoutOptions = {
    width: size.width,
    height: size.height,
    groupGap: GROUP_GAP,
    tileGap: 0,
    direction: chart.direction,
    hidden: chart.hidden,
  }
  // Zoomed in, the tiles keep the arrangement they had in their group, only bigger.
  const layout = tileLayout(view, {
    ...layoutOptions,
    shape: viewShape(tree, view.path, layoutOptions),
  })
  // The layout shown before this one, kept while what left it finishes leaving.
  const signature = layoutSignature(layout)
  const [held, setHeld] = useState<{
    signature: string
    now: TileLayout
    was: TileLayout | null
  }>({ signature, now: layout, was: null })
  if (held.signature !== signature) setHeld({ signature, now: layout, was: held.now })
  const was = held.signature === signature ? held.was : held.now

  const tileOf = (category: ChartCategory) => {
    const key = String(category.datum[TILE_KEY])
    return (
      layout.tiles.find((tile) => tile.key === key) ??
      was?.tiles.find((tile) => tile.key === key) ??
      null
    )
  }
  const shownTiles = chart.current.map(tileOf)
  const viewTotal = layout.tiles.reduce((sum, tile) => sum + tile.node.value, 0)
  const percent = numberFormatter(chart.locale, {
    style: 'percent',
    maximumFractionDigits: 1,
  })
  const shareOf = (tile: LaidTile | null) =>
    !tile || viewTotal === 0 ? 0 : tile.node.value / viewTotal
  const label = valueLabel ?? chart.messages.value
  const groupText = (tile: LaidTile | null) => (tile?.group ? nameOf(tile.group) : '')
  const tileText = (tile: LaidTile | null) => (tile ? nameOf(tile.node) : '')
  const anyGroup = layout.tiles.some((tile) => tile.group)
  const colorOf = (category: ChartCategory) =>
    tileColor(chart, config, String(category.datum[TILE_TOP]), category, color)

  /** The tile at a point of the plot, or the nearest one in reach, or the header of a group there. */
  const under = (point: { x: number; y: number }, box: DOMRect) =>
    tileAt(
      { x: point.x - box.left, y: point.y - box.top },
      {
        width: box.width,
        height: box.height,
        groups: layout.groups,
        tiles: shownTiles.map((tile, at) => (chart.current[at]?.leaving ? null : tile)),
        reach: NEAR_TILE,
      },
    )
  const zoomInto = (group: TileNode | null | undefined) =>
    group && group.children.length > 0 ? () => zoomTo(group.path) : null

  const full: CategoryChartInput = {
    ...chart,
    // The tooltip sits above the middle of its tile's top edge.
    pointOf: (at) => {
      const tile = shownTiles[at]
      if (!tile) return null
      return {
        x: (tile.box.x0 + tile.box.x1) / 2,
        y: tile.box.y0,
        side: 'top',
      }
    },
    pickAt: (point, box) => {
      const found = under(point, box)
      return found && 'tile' in found ? found.tile : null
    },
    seriesAt: (point) => {
      // The core gives x from the reading start; the boxes are from the left.
      const plot = chart.plot.current?.getBoundingClientRect()
      if (!plot) return null
      const x = chart.direction === 'rtl' ? 1 - point.x : point.x
      const found = under(
        { x: plot.left + x * plot.width, y: plot.top + point.y * plot.height },
        plot,
      )
      return found && 'group' in found ? found.group.key : null
    },
    zoomAt: (point, box) => {
      const found = under(point, box)
      if (!found) return null
      return 'group' in found
        ? zoomInto(found.group.node)
        : zoomInto(shownTiles[found.tile]?.group)
    },
    zoomIn: (at) => zoomInto(shownTiles[at]?.group),
    zoomOut: view.path.length > 0 ? () => zoomTo(view.path.slice(0, -1)) : null,
    describe: (at) => {
      const tile = shownTiles[at]
      if (!tile) return ''
      const value = `${label} ${chart.valueText(tile.node.value)}, ${percent.format(shareOf(tile))}`
      return tile.group ? `${groupText(tile)}, ${value}` : value
    },
    table: {
      columns: [...(anyGroup ? [chart.messages.group] : []), label, chart.messages.share],
      cells: (category) => {
        const tile = shownTiles[category.index] ?? null
        return [
          ...(anyGroup ? [groupText(tile)] : []),
          chart.valueText(tile?.node.value ?? 0),
          percent.format(shareOf(tile)),
        ]
      },
      footer: [
        ...(anyGroup ? [''] : []),
        chart.valueText(viewTotal),
        percent.format(viewTotal === 0 ? 0 : 1),
      ],
    },
    tooltipContent: (at) => {
      const category = chart.current[at]
      const tile = shownTiles[at]
      if (!category || !tile) return null
      const slot = chart.series.indexOf(tile.top)
      return (
        <ShareTooltipContent
          chart={chart}
          category={category}
          name={tile.group ? `${groupText(tile)} / ${tileText(tile)}` : tileText(tile)}
          rows={[
            {
              label: null,
              value: chart.valueText(tile.node.value),
              share: percent.format(shareOf(tile)),
            },
          ]}
          swatch={
            <span
              aria-hidden
              className={cn(swatchClassName, forcedSeriesColor(slot === -1 ? 0 : slot))}
              style={{ '--swatch': colorOf(category) } as CSSProperties}
            />
          }
        />
      )
    },
  }

  const moves = tileMoves(was, layout)
  return (
    <TreemapContext value={{ tree, view, zoomTo, nameOf }}>
      <CategoryChartFrame
        chart={full}
        ref={ref}
        slot='treemap-chart'
        description={description}
        empty={empty}
        className={className}
        placeholder={placeholder && <TreemapPlaceholder />}
        {...figureProps({ ...props, color: undefined }, treemapChartKeys)}
      >
        <TreemapTiles
          layout={layout}
          was={was}
          moves={moves}
          shownTiles={shownTiles}
          labels={labels}
          phase={phase}
          colorOf={colorOf}
          nameOf={nameOf}
        />
        {props.children}
        {region}
      </CategoryChartFrame>
    </TreemapContext>
  )
}

/** What tells one layout from another: the view, and every box, to a tenth of a px at 1000px. */
function layoutSignature(layout: TileLayout) {
  const boxes = [...layout.groups, ...layout.tiles]
    .map(({ key, box }) =>
      [key, box.x0, box.y0, box.x1, box.y1].map((part) =>
        typeof part === 'number' ? part.toFixed(4) : part,
      ),
    )
    .join('|')
  return `${layout.view.key}#${boxes}`
}

/**
 * A tile's colour: its own from `color`, or its top's from the config, or
 * the next of the chart's colours for a top the config leaves out, whose
 * name may not be a CSS variable's.
 */
function tileColor(
  chart: Pick<ChartContextValue, 'series'>,
  config: ChartConfig,
  top: string,
  category: ChartCategory,
  color: TreemapChartProps['color'],
) {
  const own = color?.(category.datum, category.index)
  if (own) return own
  const ramp = `var(--chart-${(Math.max(0, chart.series.indexOf(top)) % 5) + 1})`
  return config[top] ? `var(--color-${top}, ${ramp})` : ramp
}

/**
 * A box as the `clip-path` of a layer as large as the plot, which must be a
 * size container: inset by half the room between tiles on each side, its
 * corners rounded by `--treemap-chart-radius`, never past a quarter of its
 * smaller side and never quite square, so a move between boxes stays one
 * transition (as a bar's, `barClipPath`).
 */
function tileClip(box: TileBox): string {
  const half = 'var(--treemap-chart-gap, 2px) / 2'
  // A quarter of the smaller side at most, so a small tile stays a tile, never a pill.
  const across = round((box.x1 - box.x0) * 25)
  const down = round((box.y1 - box.y0) * 25)
  const radius = `max(0.01px, min(var(--treemap-chart-radius, var(--control-radius-xs)), ${across}cqw - ${half}, ${down}cqh - ${half}))`
  return `inset(calc(${round(box.y0 * 100)}cqh + ${half}) calc(${round((1 - box.x1) * 100)}cqw + ${half}) calc(${round((1 - box.y1) * 100)}cqh + ${half}) calc(${round(box.x0 * 100)}cqw + ${half}) round ${radius})`
}

/** Where a box's label sits: its reading start corner, from the plot's start. */
function labelAt(box: TileBox, direction: 'ltr' | 'rtl') {
  const x = direction === 'rtl' ? box.x1 - 1 : box.x0
  return `${round(x * 100)}cqw ${round(box.y0 * 100)}cqh`
}

function isMeasured(size: { width: number; height: number }) {
  return size.width > 0 && size.height > 0
}

/** A fraction written to four decimals, enough for a plot thousands of px long. */
function round(value: number): number {
  return Math.round(value * 10_000) / 10_000
}

/**
 * Every tile, in its group's colour, stepping back while another is lit or
 * another group is brought forward, with its label written on it where it
 * fits. A tile that arrives grows from where the move says, and one that
 * leaves goes to where it says, then fades.
 */
function TreemapTiles({
  layout,
  was,
  moves,
  shownTiles,
  labels,
  phase,
  colorOf,
  nameOf,
}: {
  layout: TileLayout
  was: TileLayout | null
  moves: ReturnType<typeof tileMoves>
  shownTiles: readonly (LaidTile | null)[]
  labels: 'value' | 'name' | 'none'
  phase: EntrancePhase
  colorOf: (category: ChartCategory) => string
  nameOf: (node: TileNode) => string
}) {
  const chart = useChart()
  const { spotlit } = useChartActive()
  // Squarify follows the plot's shape, so until it is measured there is no layout to draw:
  // a guess would rearrange itself once the page is running.
  if (chart.status === 'empty' || !isMeasured(chart.plotSize)) return null
  const size = drawingSize(chart.plotSize)
  const litNow = spotlit === null ? undefined : chart.current[spotlit]
  const lit = litNow && !litNow.leaving ? litNow.key : null
  const stack = stackOrder(layout, was)
  return (
    <div
      data-slot='treemap-chart-tiles'
      aria-hidden
      className={cn(plotLayerClassName, 'z-10')}
    >
      <TreemapHeaders
        layout={layout}
        was={was}
        moves={moves}
        nameOf={nameOf}
        stack={stack}
        shownTiles={shownTiles}
      />
      {chart.categories.map((category) => {
        const key = String(category.datum[TILE_KEY])
        const top = String(category.datum[TILE_TOP])
        const tile =
          (category.leaving ? null : shownTiles[category.index]) ??
          layout.tiles.find((one) => one.key === key) ??
          was?.tiles.find((one) => one.key === key)
        if (!tile) return null
        const to = category.leaving ? (moves.to.get(key) ?? centreOf(tile.box)) : tile.box
        const shown = phase === 'waiting' ? centreOf(tile.box) : to
        // A label drawn for the first time on a tile that stays starts where the tile was.
        const from =
          moves.from.get(key) ??
          was?.tiles.find((one) => one.key === key)?.box ??
          tile.box
        const width = (tile.box.x1 - tile.box.x0) * size.width
        const height = (tile.box.y1 - tile.box.y0) * size.height
        const name = nameOf(tile.node)
        const value = chart.valueText(tile.node.value)
        const fit = labelFit(
          width,
          height,
          chart.textWidth(name),
          chart.textWidth(value),
          labels,
        )
        const dim =
          (lit !== null && lit !== category.key) ||
          (chart.emphasis !== null &&
            chart.emphasis !== top &&
            chart.emphasis !== tile.group?.key)
        const slot = chart.series.indexOf(top)
        return (
          <TreemapTile
            key={category.key}
            layer={stack(tile.group?.key ?? tile.key)}
            clip={tileClip(shown)}
            from={tileClip(from)}
            labelAt={labelAt(shown, chart.direction)}
            labelFrom={labelAt(from, chart.direction)}
            color={colorOf(category)}
            image={
              slot === -1 ? undefined : patternImage(chart.patternOf(top)) || undefined
            }
            forced={forcedSeriesColor(slot === -1 ? 0 : slot)}
            dim={dim}
            leaving={category.leaving}
            waiting={phase === 'waiting'}
            entering={phase === 'entering'}
            name={fit === 'none' ? null : name}
            value={fit === 'value' ? value : null}
          />
        )
      })}
    </div>
  )
}

/**
 * One tile, and its label. Memoised, so a pointer moving between tiles
 * redraws only the ones it lights or dims.
 */
const TreemapTile = memo(function TreemapTile({
  layer,
  clip,
  from,
  labelAt: at,
  labelFrom,
  color,
  image,
  forced,
  dim,
  leaving,
  waiting,
  entering,
  name,
  value,
}: {
  /** Where it stacks: above every group before its own, below its header. */
  layer: number
  clip: string
  from: string
  labelAt: string
  labelFrom: string
  color: string
  image: string | undefined
  forced: string | undefined
  dim: boolean
  leaving: boolean
  /** Before the entrance, out of sight at its centre. */
  waiting: boolean
  entering: boolean
  /** The name written on the tile, or none where it doesn't fit. */
  name: string | null
  value: string | null
}) {
  // A tile that has never had room for its words draws no label at all, so a
  // chart of hundreds of small tiles styles only the elements it shows.
  const [labelled, setLabelled] = useState(name !== null)
  if (name !== null && !labelled) setLabelled(true)
  return (
    <div
      data-slot='treemap-chart-tile'
      data-dim={dim ? '' : undefined}
      data-leaving={leaving ? '' : undefined}
      data-waiting={waiting ? '' : undefined}
      data-entering={entering ? '' : undefined}
      className={cn(
        'absolute inset-0 [clip-path:var(--tile-clip)] bg-(--tile-fill) transition-none duration-(--motion-layout-duration) ease-[var(--motion-layout-fade-easing),var(--motion-layout-easing),var(--motion-layout-fade-easing)] [--tile-fill:var(--tile-color)] group-data-mounted/chart:transition-[background-color,clip-path,opacity] group-data-mounted/chart:starting:[clip-path:var(--tile-from)] group-data-mounted/chart:starting:opacity-0 data-dim:[--tile-fill:oklch(from_var(--tile-color)_l_calc(c*var(--treemap-chart-dim,0.3))_h)] data-entering:duration-(--motion-draw-duration) data-entering:ease-[var(--motion-draw-fade-easing),var(--motion-draw-easing),var(--motion-draw-fade-easing)] data-waiting:opacity-0 data-leaving:opacity-0 data-leaving:duration-(--motion-exit-duration) data-leaving:ease-[var(--motion-exit-fade-easing),var(--motion-exit-easing),var(--motion-exit-fade-easing)] motion-reduce:group-data-mounted/chart:transition-[background-color,opacity] motion-reduce:ease-(--motion-layout-fade-easing) motion-reduce:data-entering:ease-(--motion-draw-fade-easing) motion-reduce:data-leaving:ease-(--motion-exit-fade-easing)',
        forced,
      )}
      style={
        {
          zIndex: layer,
          '--tile-color': color,
          // Variables, not `clipPath`, so the class's starting shape isn't overruled by an inline style.
          '--tile-clip': clip,
          '--tile-from': from,
          backgroundImage: image,
        } as CSSProperties
      }
    >
      {labelled && (
        <span
          className='absolute top-0 start-0 size-0 [translate:var(--label-at)] transition-none duration-(--motion-layout-duration) ease-(--motion-layout-easing) group-data-mounted/chart:transition-[translate] group-data-mounted/chart:starting:[translate:var(--label-from)] in-data-entering:duration-(--motion-draw-duration) in-data-entering:ease-(--motion-draw-easing) in-data-leaving:duration-(--motion-exit-duration) in-data-leaving:ease-(--motion-exit-easing) motion-reduce:group-data-mounted/chart:transition-none'
          style={{ '--label-at': at, '--label-from': labelFrom } as CSSProperties}
        >
          <span
            data-off={name === null ? '' : undefined}
            className={cn(
              'absolute top-0 start-0 flex flex-col items-start leading-4 whitespace-nowrap transition-none group-data-mounted/chart:transition-opacity duration-(--motion-layout-duration) ease-(--motion-layout-fade-easing) data-off:opacity-0',
              labelOnClassName,
            )}
            style={
              {
                '--label-on': color,
                // Inside the room between tiles, so the words line up with their group's header.
                margin: `calc(var(--treemap-chart-gap, 2px) / 2 + ${LABEL_PADDING}px)`,
              } as CSSProperties
            }
          >
            {/* A label that no longer fits keeps its words while it fades. */}
            <HeldText className='font-medium'>{name}</HeldText>
            <HeldText className='tabular-nums'>{value}</HeldText>
          </span>
        </span>
      )}
    </div>
  )
})

/** Text that keeps what it last said while it goes, so a label fading out keeps its words. */
function HeldText({
  className,
  children,
}: {
  className: string
  children: string | null
}) {
  const [last, setLast] = useState(children)
  if (children !== null && children !== last) setLast(children)
  if (last === null) return null
  return (
    // A value with a unit reads in its own order whatever the page's direction.
    <span
      dir='auto'
      data-off={children === null ? '' : undefined}
      className={cn(
        className,
        'transition-none group-data-mounted/chart:transition-opacity duration-(--motion-layout-duration) ease-(--motion-layout-fade-easing) data-off:opacity-0',
      )}
    >
      {last}
    </span>
  )
}

/**
 * Each group's header above its tiles: its name and its worth, where they
 * fit, cut to the group's box as it moves, so a group that leaves takes its
 * header with it.
 */
function TreemapHeaders({
  layout,
  was,
  moves,
  nameOf,
  stack,
  shownTiles,
}: {
  layout: TileLayout
  was: TileLayout | null
  moves: ReturnType<typeof tileMoves>
  nameOf: (node: TileNode) => string
  stack: (key: string) => number
  shownTiles: readonly (LaidTile | null)[]
}) {
  const chart = useChart()
  const { spotlit } = useChartActive()
  // Until the tiles arrive, their headers wait with them.
  if (chart.status !== 'ready' || !chart.entered) return null
  const size = drawingSize(chart.plotSize)
  const now = new Set(layout.groups.map((group) => group.key))
  const leaving = (was?.groups ?? []).filter((group) => !now.has(group.key))
  const litNow = spotlit === null ? undefined : chart.current[spotlit]
  const litGroup =
    litNow && !litNow.leaving ? (shownTiles[spotlit ?? -1]?.group?.key ?? null) : null
  return (
    <>
      {[...layout.groups, ...leaving].map((group) => {
        const gone = !now.has(group.key)
        const box = gone ? (moves.to.get(group.key) ?? group.box) : group.box
        const from = moves.from.get(group.key) ?? group.box
        const name = nameOf(group.node)
        const value = chart.valueText(group.node.value)
        const fit = group.header
          ? headerFit(
              (group.box.x1 - group.box.x0) * size.width,
              chart.textWidth(name),
              chart.textWidth(value),
            )
          : 'none'
        const quiet =
          (litGroup !== null && litGroup !== group.key) ||
          (chart.emphasis !== null &&
            chart.emphasis !== group.key &&
            chart.emphasis !== group.top)
        return (
          <TreemapHeader
            key={group.key}
            layer={stack(group.key) + 1}
            clip={headerClip(box)}
            from={headerClip(from)}
            at={labelAt(box, chart.direction)}
            labelFrom={labelAt(from, chart.direction)}
            leaving={gone}
            quiet={quiet}
            name={fit === 'none' ? null : name}
            value={fit === 'value' ? value : null}
          />
        )
      })}
    </>
  )
}

/**
 * Where each group stacks among the tiles, by its key, so the order never
 * changes as groups come and go: a group's header just above its own tiles,
 * and the next group's tiles above both, so a header moving with its group
 * never shows over another's tiles. Even numbers; a header takes the odd one
 * above.
 */
function stackOrder(layout: TileLayout, was: TileLayout | null) {
  const keys = new Set<string>()
  for (const shown of [layout, was]) {
    for (const group of shown?.groups ?? []) keys.add(group.key)
    for (const tile of shown?.tiles ?? []) if (!tile.group) keys.add(tile.key)
  }
  const order = new Map([...keys].sort().map((key, at) => [key, at * 2]))
  return (key: string) => order.get(key) ?? 0
}

/** A group's whole box, as a header's `clip-path`, square, so its words are cut where the group's tiles are. */
function headerClip(box: TileBox) {
  return tileClip(box).replace(/ round .*\)$/, ' round 0.01px)')
}

const TreemapHeader = memo(function TreemapHeader({
  layer,
  clip,
  from,
  at,
  labelFrom,
  leaving,
  quiet,
  name,
  value,
}: {
  layer: number
  clip: string
  from: string
  at: string
  labelFrom: string
  leaving: boolean
  quiet: boolean
  name: string | null
  value: string | null
}) {
  return (
    <div
      data-leaving={leaving ? '' : undefined}
      className='absolute inset-0 [clip-path:var(--header-clip)] transition-none duration-(--motion-layout-duration) ease-[var(--motion-layout-easing),var(--motion-layout-fade-easing)] group-data-mounted/chart:transition-[clip-path,opacity] group-data-mounted/chart:starting:[clip-path:var(--header-from)] group-data-mounted/chart:starting:opacity-0 data-leaving:opacity-0 data-leaving:duration-(--motion-exit-duration) data-leaving:ease-[var(--motion-exit-easing),var(--motion-exit-fade-easing)] motion-reduce:group-data-mounted/chart:transition-opacity motion-reduce:ease-(--motion-layout-fade-easing)'
      style={
        { zIndex: layer, '--header-clip': clip, '--header-from': from } as CSSProperties
      }
    >
      <span
        className='absolute top-0 start-0 size-0 [translate:var(--label-at)] transition-none duration-(--motion-layout-duration) ease-(--motion-layout-easing) group-data-mounted/chart:transition-[translate] group-data-mounted/chart:starting:[translate:var(--label-from)] in-data-leaving:duration-(--motion-exit-duration) in-data-leaving:ease-(--motion-exit-easing) motion-reduce:group-data-mounted/chart:transition-none'
        style={{ '--label-at': at, '--label-from': labelFrom } as CSSProperties}
      >
        <span
          data-quiet={quiet ? '' : undefined}
          // In line with the labels of the tiles below it.
          style={{
            paddingInline: `calc(var(--treemap-chart-gap, 2px) / 2 + ${LABEL_PADDING}px)`,
          }}
          className='text-foreground data-quiet:text-muted-foreground absolute top-0 start-0 flex h-5 items-center gap-2 leading-4 whitespace-nowrap transition-colors duration-(--motion-layout-duration) ease-(--motion-layout-fade-easing) forced-colors:text-[CanvasText]'
        >
          <HeldText className='font-medium'>{name}</HeldText>
          <HeldText className='text-muted-foreground tabular-nums'>{value}</HeldText>
        </span>
      </span>
    </div>
  )
})

/** The tiles in the placeholder's tint, breathing slowly, while the data loads. */
function TreemapPlaceholder() {
  const chart = useChart()
  if (!isMeasured(chart.plotSize)) return null
  const size = drawingSize(chart.plotSize)
  const layout = tileLayout(PLACEHOLDER_TREE, {
    width: size.width,
    height: size.height,
    groupGap: GROUP_GAP,
    tileGap: 0,
    direction: chart.direction,
  })
  return (
    <div
      data-slot='treemap-chart-placeholder'
      aria-hidden
      className={cn(plotLayerClassName, 'z-10', placeholderBreatheClassName)}
    >
      {layout.tiles.map((tile) => (
        <div
          key={tile.key}
          className={cn('absolute inset-0', placeholderFillClassName)}
          style={{ clipPath: tileClip(tile.box) }}
        />
      ))}
    </div>
  )
}

/** How long focus is kept off the page after a crumb is pressed, in ms: past a menu that closes and hands focus back to "…". */
const FOCUS_WATCH = 600

/**
 * Puts focus on `target` whenever it falls to the page in the next moments,
 * as it does when the crumb or the menu that had it goes.
 */
function keepFocusOn(target: { current: HTMLElement | null }) {
  const until = performance.now() + FOCUS_WATCH
  const check = () => {
    const now = document.activeElement
    if (!now || now === document.body) target.current?.focus({ preventScroll: true })
    if (performance.now() < until) requestAnimationFrame(check)
  }
  requestAnimationFrame(check)
}

/** The shape the placeholder's tiles take: a few of falling size, as most treemaps have. */
const PLACEHOLDER_TREE = tileTree(
  [34, 22, 16, 11, 8, 5, 4].map((value, at) => ({ name: String(at), value })),
  'name',
  'value',
)

/**
 * The way back out: Kino's Breadcrumb of the parts above the one in view,
 * the whole first, each a button that zooms out to it, and the part in view
 * last. It sits above the plot, under a legend at the top. It shows the
 * whole's name before the first zoom too, so zooming never moves the plot,
 * but with nothing to press it is hidden from screen readers until then.
 */
function TreemapPath({ className, ...props }: ComponentProps<'nav'>) {
  const chart = useChart()
  const { tree, view, zoomTo, nameOf } = useTreemapChart()
  const above = tileAncestors(tree, view)
  return (
    <Breadcrumb
      data-slot='treemap-chart-path'
      aria-label={chart.messages.zoomPath(chart.label)}
      aria-hidden={above.length === 0 ? true : undefined}
      className={cn('pb-2 [grid-area:top-axis]', className)}
      {...props}
    >
      <BreadcrumbList>
        {above.map((node) => (
          <Fragment key={node.key || 'whole'}>
            <BreadcrumbItem>
              <BreadcrumbLink
                // oxlint-disable-next-line jsx-a11y/control-has-associated-label -- the crumb's name, its children, labels the button
                render={<button type='button' />}
                onClick={() => {
                  zoomTo(node.path)
                  // The crumb pressed becomes the part in view, and "…" may fold away with it:
                  // focus goes to the tiles rather than to the page.
                  keepFocusOn(chart.plot)
                }}
              >
                {nameOf(node)}
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
          </Fragment>
        ))}
        <BreadcrumbItem>
          <BreadcrumbPage>{nameOf(view)}</BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  )
}

export { labelAt, TreemapChart, type TreemapChartProps, TreemapPath, tileClip }
