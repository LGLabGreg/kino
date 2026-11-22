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
import type { ChartConfig } from '@/registry/lib/chart-math'
import {
  type ChartRootProps,
  type ChartRootState,
  useChartRoot,
  useChartRootValue,
} from '@/registry/lib/chart-root'
import { tileAncestors, type TileNode, tileNodeAt } from '@/registry/lib/chart-tiles'
import { useControllable } from '@/registry/lib/controllable'
import { type ComponentProps, createContext, Fragment, type ReactNode, use } from 'react'

import { cn } from '@/lib/utils'

/*
 * What every chart of a tree that zooms shares, such as the Treemap, the
 * Circle packing and the Sunburst: its root, whose groups are the tree's
 * tops, with what is hidden and the part in view, and the way back out,
 * the path of the parts above the one in view, each a button that zooms
 * out to it.
 */

/** The props of a chart of a tree that zooms that its root reads: its groups, what is hidden and the part in view. */
interface TreeZoomRootProps extends ChartRootProps {
  categoryFormat?: (value: unknown) => string
  zoom?: string[]
  defaultZoom?: string[]
  onZoomChange?: (zoom: string[]) => void
}

/**
 * The root of a chart of a tree that zooms: every top is a group the legend
 * and the keys know, the ones the config leaves out after its own, named by
 * their names; a part whose top is hidden can't be in view, so the whole
 * is; and hiding the top in view zooms back out to the whole. Each zoom is
 * announced.
 */
function useTreeZoomRoot(
  props: TreeZoomRootProps,
  tree: TileNode,
  options: { entrance: boolean },
): {
  state: ChartRootState
  groups: ChartConfig
  hidden: readonly string[]
  view: TileNode
  nameOf: (node: TileNode) => string
  /** A part's value as written, or the chart's word for none. */
  valueOf: (node: TileNode) => string
  zoomTo: (path: readonly string[]) => void
  region: ReactNode
} {
  const { config, messages, categoryFormat } = props
  const groups: ChartConfig = { ...config }
  for (const top of tree.children) {
    const key = top.path[0] ?? ''
    groups[key] ??= {
      label: categoryFormat ? categoryFormat(top.name) : String(top.name),
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
  const view = hidden.includes(asked.path[0] ?? '') ? tree : asked
  const { announce, region } = useAnnouncer()
  const state = useChartRoot(
    {
      ...props,
      config: groups,
      hiddenSeries: hidden,
      defaultHiddenSeries: undefined,
      onHiddenSeriesChange: (next) => {
        // The whole has no top, so hiding a group from it zooms nowhere.
        if (view.path.length > 0 && next.includes(view.path[0] ?? '')) {
          setZoom([])
          announce(state.messages.zoomedTo(nameOf(tree)))
        }
        setHidden(next)
      },
      messages: {
        series: 'Groups',
        empty: 'No data yet',
        allHidden: 'Every group is hidden',
        showAll: (count) => `Show all ${count} groups`,
        ...messages,
      },
    },
    { entrance: options.entrance, heightFromData: false },
  )
  const nameOf = (node: TileNode): string => {
    if (node.path.length === 0) return state.messages.whole
    if (categoryFormat) return categoryFormat(node.name)
    const named = node.path.length === 1 ? groups[node.path[0] ?? '']?.label : undefined
    return typeof named === 'string' ? named : String(node.name)
  }
  const valueOf = (node: TileNode) =>
    node.missing ? state.messages.noValue : state.valueText(node.value)
  const zoomTo = (path: readonly string[]) => {
    const next = tileNodeAt(tree, path)
    if (next.key === view.key) return
    setZoom([...next.path])
    announce(state.messages.zoomedTo(nameOf(next)))
  }
  return { state, groups, hidden, view, nameOf, valueOf, zoomTo, region }
}

interface TreeZoomValue {
  tree: TileNode
  view: TileNode
  zoomTo: (path: readonly string[]) => void
  nameOf: (node: TileNode) => string
}

const TreeZoomContext = createContext<TreeZoomValue | null>(null)

function useTreeZoom(part: string) {
  const zoom = use(TreeZoomContext)
  if (!zoom) throw new Error(`\`${part}\` goes inside a chart of a tree that zooms.`)
  return zoom
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

/**
 * Kino's Breadcrumb of the parts above the one in view, the whole first,
 * each a button that zooms out to it, and the part in view last. It sits
 * above the plot, under a legend at the top. It shows the whole's name
 * before the first zoom too, so zooming never moves the plot, but with
 * nothing to press it is hidden from screen readers until then.
 */
function TreeZoomPath({
  slot,
  className,
  ...props
}: ComponentProps<'nav'> & {
  /** The chart's own name for it, such as `treemap-chart-path`. */
  slot: string
}) {
  const chart = useChartRootValue()
  const { tree, view, zoomTo, nameOf } = useTreeZoom(slot)
  const above = tileAncestors(tree, view)
  return (
    <Breadcrumb
      data-slot={slot}
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
                  // focus goes to the plot rather than to the page.
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

export {
  keepFocusOn,
  TreeZoomContext,
  TreeZoomPath,
  type TreeZoomRootProps,
  useTreeZoomRoot,
  type TreeZoomValue,
  useTreeZoom,
}
