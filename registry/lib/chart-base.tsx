'use client'

import { useSpinner } from '@/registry/components/kino/spinner'
import type { ChartLive } from '@/registry/lib/chart-live-clock'
import {
  type ChartConfig,
  type ChartDatum,
  type ChartMark,
  type ChartOrientation,
  numberOf,
  rangeOf,
  type ReadingDirection,
  type XYValue,
} from '@/registry/lib/chart-math'
import {
  ChangeText,
  type ChartFocusProps,
  type ChartFormat,
  type ChartItem,
  type ChartMessages,
  type ChartMoves,
  type ChartRootState,
  forcedSeriesColor,
  percent,
  SeriesKey,
  swatchClassName,
  swatchStyle,
  tooltipQuietClassName,
  useBefore,
  useChartFocus,
  useChartGroup,
  useChartMoves,
  useChartRootValue,
  useLeaving,
} from '@/registry/lib/chart-root'
import {
  type Band,
  type ChartScale,
  type DomainEnd,
  type LinearScale,
  scaleSignature,
  type TimeScale,
} from '@/registry/lib/chart-scale'
import {
  chartStatus,
  type ChartStatus,
  type ChartTable,
  type ChartTarget,
  indexOfKey,
  targetKey,
} from '@/registry/lib/chart-state'
import { useControllable } from '@/registry/lib/controllable'
import {
  Children,
  type ComponentProps,
  createContext,
  type CSSProperties,
  Fragment,
  isValidElement,
  type ReactNode,
  type Ref,
  type RefObject,
  use,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import { cn } from '@/lib/utils'

/*
 * What every family of charts shares beside the root (`chart-root`): the
 * props every chart takes, how it loads, plays its entrance and keeps what
 * leaves, `activeIndex` and picking, the parts written inside it and what
 * they declare, the frame its axes read, the words of a chart whose stops
 * hold a value per series, and the tooltip of a share. A family's frame
 * provides the contexts here, so the shared parts (`chart.tsx`) read the
 * root and these, never a family's own.
 */

/* The frame: the scales the axes, the grid and reference lines read. */

/**
 * One axis of the frame: its scale, the one before its last change, so what
 * arrives starts where it would have been, and how it writes and titles its
 * values when its part is given neither.
 */
interface FrameAxis<Scale extends ChartScale> {
  scale: Scale
  previous: Scale
  /** How it writes its values; the chart's `format` by default. */
  format?: ChartFormat
  /** What it measures, which titles it unless its part is given a `label`. */
  label?: string
}

/**
 * The frame the marks stand in: the x axis, categories or numbers, and the
 * value axes by their ids, `'value'` the chart's own. The axes, the grid and
 * reference lines read it, and the pointer and the keys find what is under
 * them by it: along the categories, or among points by both values.
 */
interface ChartFrame {
  x: FrameAxis<ChartScale>
  /** Each value axis, by its id: the chart's own, `value`, always. */
  y: Readonly<Record<string, FrameAxis<LinearScale>>> & { value: FrameAxis<LinearScale> }
  /** Where marks grow from on each value axis, as a fraction of it. */
  baselines: Readonly<Record<string, number>> & { value: number }
  /** The id of the value axis a series is read against. */
  axisOf: (key: string) => string
  /** Whether a series adds to its category's total, as the tooltip's total row sums it: one that stacks on the chart's own value axis. */
  totals: (key: string) => boolean
  /**
   * Whether its range waits for the plot's size, because a part keeps room
   * in px past the value axis's end, as labels past the bars do: until the
   * plot is measured, as in the server's HTML, the plot and its axes hold
   * their place unseen rather than show a range that then shifts.
   */
  measuring: boolean
  /**
   * An x of times that shows a window of them, still or live: the clock the
   * layers placed by x move with (`ChartLiveLayer`). Null for an x that
   * shows all of it.
   */
  live: ChartLive | null
}

/** An axis of the frame by its id: `'x'`, or a value axis's, `'value'` the chart's own. */
type ChartAxis = string

/**
 * A name on an axis that names things: a category's, or on a grid of cells,
 * a column's or a row's, over the band of the axis it names, such as a
 * month over its weeks.
 */
interface ChartAxisName {
  key: string
  /** The name as the data has it, which the axis writes. */
  value: unknown
  /** Its place among the axis's names. */
  index: number
  band: Band
  leaving: boolean
}

/**
 * The frame's axis `axis` when it runs along numbers: a value axis, or the x
 * axis of a chart whose x is a number, such as a scatter. None for an x
 * axis of categories, or an id the chart has no axis for.
 */
function numberAxis(
  chart: { frame: ChartFrame },
  axis: ChartAxis,
): FrameAxis<LinearScale> | null {
  if (axis !== 'x') return chart.frame.y[axis] ?? null
  const { scale, previous, format, label } = chart.frame.x
  if (scale.kind !== 'linear') return null
  // A new x of numbers slides from where the same range put it.
  return { scale, previous: previous.kind === 'linear' ? previous : scale, format, label }
}

/** The frame's x axis when it runs along times, such as a year of days on a line chart; none otherwise. */
function timeAxis(chart: { frame: ChartFrame }): FrameAxis<TimeScale> | null {
  const { scale, previous, format, label } = chart.frame.x
  if (scale.kind !== 'time') return null
  return { scale, previous: previous.kind === 'time' ? previous : scale, format, label }
}

/**
 * The scale a value axis had before its last change, by its signature, for
 * each axis of `scales`, so ticks and marks slide from where they were.
 */
function usePreviousScales<Scale extends ChartScale>(
  scales: Readonly<Record<string, Scale>>,
): Readonly<Record<string, Scale>> {
  const signature = Object.entries(scales)
    .map(([axis, scale]) => `${axis}=${scaleSignature(scale)}`)
    .join(';')
  return useBefore(scales, signature)
}

/** The least room between two value ticks, in px: up the axis, and along it. */
const TICK_SPACING = { upright: 32, across: 56 } as const

/* Places on the plot, in CSS and as fractions. */

/** A line along the plot's height, or across its width, that `axisSlide` moves. */
const slideLine = {
  x: 'absolute inset-y-0 left-0 w-0',
  y: 'absolute inset-x-0 top-0 h-0',
} as const

/** A layer over an axis's area that its sliding labels measure their slide in. */
const axisLayerClassName = 'pointer-events-none absolute inset-0 [container-type:size]'

/**
 * A tick, a grid line or a reference sliding along the value axis: in from
 * where the old range put it, and fading as it leaves. The resting place is
 * a variable too, so an inline style never overrules the starting one.
 */
const tickMove =
  '[translate:var(--tick-to)] transition-none group-data-mounted/chart:transition-[translate,opacity] duration-(--motion-layout-duration) ease-(--motion-layout-easing) group-data-mounted/chart:starting:[translate:var(--tick-from)] group-data-mounted/chart:starting:opacity-0 data-leaving:opacity-0 motion-reduce:group-data-mounted/chart:transition-opacity'

/**
 * A line of no thickness slid to `place` along one axis of the size
 * container it sits in, a fraction of the value axis from its start, from
 * where `from` put it. Across the page, values run from the reading start;
 * up the page, from the bottom. Being no thicker than a line, it never makes
 * the page scroll wherever it slides. What sits on it is placed from its
 * physical top left.
 */
function axisSlide(
  axis: 'x' | 'y',
  place: number,
  from: number,
  direction: ReadingDirection,
): CSSProperties {
  return {
    '--tick-to': slideTo(axis, place, direction),
    '--tick-from': slideTo(axis, from, direction),
  } as CSSProperties
}

/** The `translate` that puts a line at `place` along the value axis. */
function slideTo(axis: 'x' | 'y', place: number, direction: ReadingDirection) {
  return axis === 'x'
    ? `${plotOffset(direction === 'rtl' ? 1 - place : place, 'cqw')} 0`
    : `0 ${plotOffset(1 - place, 'cqh')}`
}

/**
 * Where `place`, a fraction of the plot from its physical left or top, sits
 * along it in CSS, with `unit` the plot's width (`cqw`) or height (`cqh`).
 * A chart with an `inset`, such as a scatter, keeps that many px clear
 * inside each edge, as `--chart-inset`, so a point at either end of an axis
 * is drawn whole; on any other chart it is the place itself.
 */
function plotOffset(place: number, unit: 'cqw' | 'cqh') {
  const share = Math.round(place * 1e6) / 1e6
  return `calc(var(--chart-inset, 0px) + ${share} * (100${unit} - 2 * var(--chart-inset, 0px)))`
}

/**
 * The same place as a fraction of the plot's whole `length` in px, for what
 * JavaScript places, such as a tooltip.
 */
function plotFraction(place: number, length: number, inset: number) {
  if (length <= 0) return place
  return (inset + place * Math.max(0, length - inset * 2)) / length
}

/**
 * Where a point placed by both values sits on the plot, as fractions of it
 * from its physical left and its top, from its place along x from the
 * reading start and up the value axis.
 */
function plotPlace(point: XYValue, direction: ReadingDirection): XYValue {
  return { x: direction === 'rtl' ? 1 - point.x : point.x, y: 1 - point.y }
}

/** The physical side a part of a chart that scrolls sideways holds still on: the frame takes the opposite direction to the page, so a logical inset would land on the wrong side. */
function stickTo(side: 'start' | 'end', direction: ReadingDirection) {
  return (side === 'start') === (direction === 'ltr')
    ? 'group-data-scrolls/chart:left-0'
    : 'group-data-scrolls/chart:right-0'
}

/**
 * The ticks to draw, `drawn` or `scale`'s own, and, until the move their
 * range changed in has ended, every one drawn before that the scale no
 * longer has, which fades as it slides toward where the new scale puts it,
 * so the change of range shows. A tick still fading in when the range turns
 * back fades out from where it is. In value order, so no tick's element
 * moves in the page, which would make it jump.
 */
function useTicks(scale: { ticks: readonly number[] } | null, drawn?: readonly number[]) {
  const ticks = drawn ?? scale?.ticks ?? NO_TICKS
  const leaving = useLeaving(useChartMoves(), ticks, String)
  return [
    ...ticks.map((value) => ({ value, leaving: false })),
    ...leaving.map((value) => ({ value, leaving: true })),
  ].toSorted((a, b) => a.value - b.value)
}

const NO_TICKS: readonly number[] = []

/* Times and locales. */

/** A locale for the dates lib: the chart's own when it is one tag. */
function localeTag(locale: Intl.LocalesArgument): string | undefined {
  if (typeof locale === 'string') return locale
  if (locale instanceof Intl.Locale) return locale.toString()
  if (Array.isArray(locale)) return localeTag(locale[0])
  return undefined
}

/* The parts written inside a chart, and what they declare as it renders. */

/** A series whose values from the category keyed `from` on are projected. */
interface ChartForecast {
  series: string
  from: string
}

/** Whether the value of `series` at `index`, a place among `current`, is a forecast. */
function isForecast(
  chart: { forecasts: readonly ChartForecast[]; current: readonly { key: string }[] },
  series: string,
  index: number,
) {
  return chart.forecasts.some((forecast) => {
    if (forecast.series !== series) return false
    const from = chart.current.findIndex((category) => category.key === forecast.from)
    return from !== -1 && index >= from
  })
}

/** A component that tells its chart about itself as it renders, with a static `declare` of its props. */
type DeclaringPart<Props, Declaration> = ((props: Props) => ReactNode) & {
  declare: (props: Props) => Declaration
}

/** What the parts in a chart declared, and each declaration's signature, which a part looks for to know it was read. */
interface ChartParts<Declaration> {
  declarations: readonly Declaration[]
  signatures: ReadonlySet<string>
}

/**
 * What the parts in `children` declare: straight inside the chart, in a
 * fragment, or in an array. A part wrapped in a component of yours can't be
 * read, and says so when it renders (`useDeclared`). `signatureOf` tells one
 * declaration from another; an empty signature says nothing to read.
 */
function chartParts<Declaration>(
  children: ReactNode,
  signatureOf: (declaration: Declaration) => string,
): ChartParts<Declaration> {
  const declarations: Declaration[] = []
  const visit = (nodes: ReactNode) => {
    Children.forEach(nodes, (node) => {
      if (!isValidElement<{ children?: ReactNode }>(node)) return
      if (node.type === Fragment) {
        visit(node.props.children)
        return
      }
      // A part a server component wrote reaches the chart not yet loaded, so it can't be read.
      if ((node.type as { $$typeof?: symbol }).$$typeof === LAZY) {
        throw new Error(
          "A chart's parts are read as it renders, so it is written in a client component: put `'use client'` at the top of the file that composes it.",
        )
      }
      const declare = (node.type as { declare?: (props: unknown) => Declaration }).declare
      if (typeof declare === 'function') declarations.push(declare(node.props))
    })
  }
  visit(children)
  return { declarations, signatures: new Set(declarations.map(signatureOf)) }
}

/** What React marks a component that is still loading with. */
const LAZY = Symbol.for('react.lazy')

/** The signatures of what the chart's parts declared, which each family's frame provides. */
const ChartPartsContext = createContext<{ signatures: ReadonlySet<string> } | null>(null)

/**
 * Throws when a part that declares something wasn't read by its chart,
 * because it sits inside a component of yours: the chart would draw a range
 * that leaves it out, or a series it doesn't know.
 */
function useDeclared<Declaration>(
  name: string,
  declaration: Declaration,
  signatureOf: (declaration: Declaration) => string,
) {
  const parts = use(ChartPartsContext)
  if (!parts) throw new Error('Chart parts go inside a chart, such as a `BarChart`.')
  const signature = signatureOf(declaration)
  if (signature !== '' && !parts.signatures.has(signature)) {
    throw new Error(
      `\`${name}\` goes straight inside its chart, or in a fragment there, so the chart reads it as it renders; inside a component of yours, the chart can't see it.`,
    )
  }
}

/**
 * Throws when the config and the parts disagree: a series in the config no
 * part draws, a part's series the config doesn't name, or a part that draws
 * a series as other than the config says. `marks` are the series the parts
 * draw, and as what; `own` is what a series that names no mark is drawn as.
 */
function checkSeries(
  config: ChartConfig,
  marks: ReadonlyMap<string, ChartMark>,
  own: ChartMark,
) {
  for (const [key, mark] of marks) {
    const entry = config[key]
    if (!entry) {
      throw new Error(
        `A part draws the series \`${key}\`, which the chart's \`config\` doesn't name. Add it to the config.`,
      )
    }
    const says = entry.mark ?? own
    if (says !== mark) {
      throw new Error(
        `The config draws the series \`${key}\` as \`${says}\`, but its part draws it as \`${mark}\`. Set its \`mark\` in the config to \`${mark}\`.`,
      )
    }
  }
  for (const key of Object.keys(config)) {
    if (!marks.has(key)) {
      throw new Error(
        `The config names the series \`${key}\`, but no part inside the chart draws it. Add one, such as \`<Bar dataKey='${key}' />\`, or take it out of the config.`,
      )
    }
  }
}

/** Values that parts of the chart add while they show, such as the room a radar's names take. */
function useRegistry<T>() {
  const [values, setValues] = useState<readonly T[]>([])
  const add = useCallback((value: T) => {
    setValues((all) => [...all, value])
    return () =>
      setValues((all) => {
        const at = all.indexOf(value)
        return at === -1 ? all : [...all.slice(0, at), ...all.slice(at + 1)]
      })
  }, [])
  return { values, add }
}

/* The props every chart takes. */

/** The props every chart with categories takes on its root. */
interface CategoryChartProps extends Omit<
  ComponentProps<'figure'>,
  'children' | 'onSelect'
> {
  /** One row per category: the category under `index`, and a value under each series' key. */
  data: readonly ChartDatum[]
  /** The key of each row's category. */
  index: string
  config: ChartConfig
  /** What the chart shows, for screen readers: a short title, such as "Visitors by month". */
  label: string
  /** A longer account for screen readers, such as the trend the chart shows. */
  description?: string
  /** How values are written in the tooltip, the labels and the table, and the value axis by default. */
  format?: ChartFormat
  /**
   * The categories run in order, such as days or months, so the tooltip and
   * the screen reader give each value's change since the category before.
   */
  ordered?: boolean
  /** How a category is written; `String` by default. */
  categoryFormat?: (value: unknown) => string
  /** The locale numbers are written in. Give one, so the server and the browser agree. */
  locale?: Intl.LocalesArgument
  /** The values at the ends of the value axis; `'auto'` fits the data. */
  domain?: readonly [DomainEnd, DomainEnd]
  /** About how many ticks the value axis marks. */
  tickCount?: number
  /** The ticks to mark, in place of round ones. */
  tickValues?: readonly number[]
  /** Ticks between whole numbers, such as 0.5; off by default when every value is whole. */
  allowDecimals?: boolean
  /** Gives each series after the first a pattern over its colour, so series differ by more than colour. */
  patterns?: boolean
  /** The series hidden, for a legend you control. */
  hiddenSeries?: string[]
  defaultHiddenSeries?: string[]
  onHiddenSeriesChange?: (hidden: string[]) => void
  /** The category under the pointer or the focus, by its place in `data`, for a chart you control. */
  activeIndex?: number | null
  defaultActiveIndex?: number | null
  onActiveIndexChange?: (index: number | null) => void
  /** The category picked, by its key; giving this, `defaultSelected` or `onSelectedChange` lets a press pick one. */
  selected?: string | null
  defaultSelected?: string | null
  onSelectedChange?: (key: string | null) => void
  /** Waiting for the data: a placeholder shows, and the marks grow out of it when the data arrives. */
  loading?: boolean
  /** The data couldn't load: `true` for the chart's own words, or what to say. */
  error?: ReactNode
  /** Shows a button that tries again, with `error`. */
  onRetry?: () => void
  /** What shows when `data` is empty. */
  empty?: ReactNode
  /** Every word the chart says or reads out, for a chart in another language. */
  messages?: Partial<ChartMessages>
  ref?: Ref<HTMLElement>
  children?: ReactNode
}

/** The props a chart's root takes that every chart reads, so the root passes the rest to its frame. */
const categoryChartKeys = [
  'data',
  'index',
  'config',
  'label',
  'description',
  'format',
  'ordered',
  'categoryFormat',
  'locale',
  'domain',
  'tickCount',
  'tickValues',
  'allowDecimals',
  'patterns',
  'hiddenSeries',
  'defaultHiddenSeries',
  'onHiddenSeriesChange',
  'activeIndex',
  'defaultActiveIndex',
  'onActiveIndexChange',
  'selected',
  'defaultSelected',
  'onSelectedChange',
  'loading',
  'error',
  'onRetry',
  'empty',
  'messages',
  'ref',
  'children',
  'className',
] as const satisfies readonly (keyof CategoryChartProps)[]

/** The props a root passes on to its `<figure>`: those that aren't every chart's, nor in `own`, the chart's own. */
function figureProps(
  props: object,
  own: readonly string[] = [],
): ComponentProps<'figure'> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(props)) {
    if (!(categoryChartKeys as readonly string[]).includes(key) && !own.includes(key))
      out[key] = value
  }
  return out as ComponentProps<'figure'>
}

/* Loading, the entrance, and what leaves. */

/** Where the entrance is: waiting to be seen, playing, or over. */
type EntrancePhase = 'waiting' | 'entering' | 'settled'

/** Whether a chart shows its placeholder, and whether its data failed to load. */
interface ChartLoad {
  placeholder: boolean
  failed: boolean
}

/**
 * Whether the chart shows its placeholder while it loads, and whether it
 * failed. A chart that mounts loading shows its placeholder from the first
 * paint. Later, the placeholder shows once loading has lasted, then long
 * enough to be seen; until then the marks there are stay.
 */
function useChartLoad({
  loading = false,
  error,
}: {
  loading?: boolean
  error?: ReactNode
}): ChartLoad {
  const [firstLoad, setFirstLoad] = useState(loading)
  if (firstLoad && !loading) setFirstLoad(false)
  const placeholder = useSpinner(loading) || firstLoad
  return { placeholder, failed: Boolean(error) && !loading }
}

/** How a chart's marks play their entrance. */
interface ChartLifeOptions {
  /** Whether the marks play an entrance the first time the chart comes into view. */
  entrance: boolean
  /**
   * How the marks start one after another in the entrance, such as bars in
   * a cascade: the CSS variable on the chart that holds the share of their
   * role's duration they start over, and its default. Null when they start
   * together.
   */
  cascade: { variable: string; fallback: number } | null
}

/**
 * What the chart shows (`status`), and where its entrance is: whether the
 * data arrived as the placeholder went, so the marks grow out of the
 * placeholder's (`fromPlaceholder`), the entrance's `phase`, and whether it
 * has played or wasn't asked for (`entered`). `counts` are the rows in the
 * data, the series shown and the rows drawn.
 */
function useChartLife(
  props: { data: unknown; loading?: boolean },
  root: Pick<ChartRootState, 'moves' | 'seen' | 'root'>,
  load: ChartLoad,
  counts: { rows: number; shown: number; drawn: number },
  options: ChartLifeOptions,
) {
  const { data, loading = false } = props
  const { placeholder, failed } = load
  const { moves } = root
  const status: ChartStatus = chartStatus({ placeholder, loading, failed, ...counts })
  // The data that arrived as the placeholder went: until it changes, its marks grow out of the
  // placeholder's.
  const [loaded, setLoaded] = useState({ placeholder, data: null as unknown })
  if (loaded.placeholder !== placeholder) {
    setLoaded({ placeholder, data: placeholder ? null : data })
  }
  const fromPlaceholder = !placeholder && loaded.data === data
  const [phase, setPhase] = useState<EntrancePhase>(
    options.entrance ? 'waiting' : 'settled',
  )
  if (phase === 'waiting' && (root.seen || fromPlaceholder) && status !== 'loading') {
    setPhase(fromPlaceholder ? 'settled' : 'entering')
  }
  // The entrance is over once its move has run, its cascade too.
  const entering = phase === 'entering'
  const figure = root.root
  const cascade = options.cascade?.variable
  const cascadeFallback = options.cascade?.fallback ?? 0
  useLayoutEffect(() => {
    if (!entering) return
    let live = true
    const element = figure.current
    const span = cascade && element ? cascadeSpan(element, cascade, cascadeFallback) : 0
    void moves.request(span, true).then(() => {
      if (live) setPhase('settled')
    })
    return () => {
      live = false
    }
  }, [entering, moves, figure, cascade, cascadeFallback])
  return { status, fromPlaceholder, phase, entered: phase !== 'waiting' }
}

/** The share of its role's duration a cascade's marks start over, from its variable on the chart. */
function cascadeSpan(element: Element, variable: string, fallback: number) {
  const value = Number.parseFloat(getComputedStyle(element).getPropertyValue(variable))
  return Number.isFinite(value) ? Math.max(0, value) : fallback
}

/**
 * Every item to draw: `current`, those in the data, and `leaving`, those
 * just taken out, marked so, in one fixed order by key whatever the data's:
 * an element moved in the page starts again with no transition, so a sort
 * would jump instead of sliding.
 */
function withLeaving<Item extends object>(
  current: readonly Item[],
  leaving: readonly Item[],
  keyOf: (item: Item) => string,
): (Item & { leaving: boolean })[] {
  return [
    ...current.map((item) => ({ ...item, leaving: false })),
    ...leaving.map((item) => ({ ...item, leaving: true })),
  ].toSorted((a, b) => {
    const ka = keyOf(a)
    const kb = keyOf(b)
    return ka < kb ? -1 : ka > kb ? 1 : 0
  })
}

/**
 * The items to draw: those in the data, and those just taken out, kept
 * where they were until the move they left in has ended, fading out
 * (`withLeaving`).
 */
function useLeavingItems<Item extends object>(
  moves: ChartMoves,
  current: readonly Item[],
  keyOf: (item: Item) => string,
) {
  return withLeaving(current, useLeaving(moves, current, keyOf), keyOf)
}

/* Picking. */

/** What picking is for a chart: whether a press picks, what is picked by key, and the toggle. */
function useChartPick(
  props: {
    selected?: string | null
    defaultSelected?: string | null
    onSelectedChange?: (key: string | null) => void
  },
  keys: readonly string[],
) {
  const { selected, defaultSelected = null, onSelectedChange } = props
  const selectable =
    selected !== undefined ||
    props.defaultSelected !== undefined ||
    onSelectedChange !== undefined
  const [own, setOwn] = useControllable(selected, defaultSelected, onSelectedChange)
  // A key the data no longer has is picked by nothing.
  const picked = own !== null && keys.includes(own) ? own : null
  return {
    selectable,
    picked,
    /** Picks `key`, or lets it go if it was picked. */
    toggle: (key: string) => setOwn(picked === key ? null : key),
  }
}

/* `activeIndex`: the item under the pointer or the focus, by its place. */

/** The props of a chart you control what is under the pointer or the focus of. */
interface ActiveIndexProps {
  activeIndex?: number | null
  defaultActiveIndex?: number | null
  onActiveIndexChange?: (index: number | null) => void
}

/** The index of `target` among `keys`, or null. */
function toldIndex(keys: readonly string[], target: ChartTarget | null): number | null {
  return target === null ? null : indexOfKey(keys, targetKey(target))
}

/** Tells `index` once: not again while it is the one `told` last told or saw. */
function tellIndex(
  told: { current: number | null },
  index: number | null,
  tell: ((index: number | null) => void) | undefined,
) {
  if (index === told.current) return
  told.current = index
  tell?.(index)
}

/** The item at `index` of `items`, or null for none. */
function itemAt(items: readonly ChartTarget[], index: number | null | undefined) {
  return index === null || index === undefined ? null : (items[index] ?? null)
}

/**
 * The root's focus for a chart whose API counts `items` (`reader.items`):
 * `activeIndex` as the item it counts, and each change told once as an
 * index. `toldRef` holds the index last told or seen, which `IndexActive`
 * reads too.
 */
function useIndexFocus(items: readonly ChartTarget[], props: ActiveIndexProps) {
  // The index last told to `onActiveIndexChange`, or seen, so each change is told once.
  const toldRef = useRef<number | null>(null)
  const keys = items.map(targetKey)
  const focusProps: ChartFocusProps = {
    focus: props.activeIndex === undefined ? undefined : itemAt(items, props.activeIndex),
    defaultFocus: itemAt(items, props.defaultActiveIndex),
    onFocusChange: (target) =>
      tellIndex(toldRef, toldIndex(keys, target), props.onActiveIndexChange),
  }
  return { focusProps, toldRef }
}

/**
 * What is under the pointer, kept apart from the rest of the chart, so a
 * hover re-renders only the parts that show it, never the data table or
 * each category's column.
 */
interface ChartActiveValue {
  /** The item under the pointer or the focus, by its place among the items. */
  active: number | null
  setActive: (index: number | null) => void
  /** The item that stays bright: the one under the pointer, or else the one picked. */
  spotlit: number | null
}

const ChartActiveContext = createContext<ChartActiveValue | null>(null)

function useChartActive() {
  const value = use(ChartActiveContext)
  if (!value) throw new Error('Chart parts go inside a chart, such as a `BarChart`.')
  return value
}

/**
 * The focus as the parts of a chart that counts `items` read it: the item it
 * is on, by its place. Told when new data moves the item it is on, for a
 * chart that keeps its own. Each frame renders it inside the root's focus.
 */
function IndexActive({
  items,
  active: props,
  toldRef,
  children,
}: {
  items: readonly ChartTarget[]
  active: ActiveIndexProps
  toldRef: RefObject<number | null>
  children: ReactNode
}) {
  const { focus, setFocus, spotlit } = useChartFocus()
  const grouped = useChartGroup() !== null
  const keys = items.map(targetKey)
  const active = toldIndex(keys, focus)
  const lit = toldIndex(keys, spotlit)
  const { activeIndex, onActiveIndexChange } = props
  useLayoutEffect(() => {
    if (active === toldRef.current) return
    // Moves the focus made are told as they happen, so this is new data moving its key.
    toldRef.current = active
    if (activeIndex === undefined && !grouped && active !== null)
      onActiveIndexChange?.(active)
  })
  // One function for the chart's life, so parts that take it, such as the
  // Bar list's rows, redraw only when what they show changes, without the
  // React Compiler.
  const latest = useRef(items)
  useLayoutEffect(() => {
    latest.current = items
  })
  const setActive = useCallback(
    (index: number | null) => setFocus(itemAt(latest.current, index)),
    [setFocus],
  )
  const value = useMemo(
    () => ({ active, setActive, spotlit: lit }),
    [active, setActive, lit],
  )
  return <ChartActiveContext value={value}>{children}</ChartActiveContext>
}

/* Words: what a chart whose every stop holds a value per series says. */

/** What a chart whose every stop holds a value per series reads its words from. */
interface SeriesWordsInput {
  /** The stops still in the data, in order. */
  stops: readonly ChartItem[]
  seriesText: (item: ChartItem, series: string) => string
  /**
   * A series' value at `item` for the tooltip and what is read out: its row
   * there, with `at` null, or a row of its own near it, with `at` that row's
   * own time as the axis writes a stop; null leaves the series out there.
   * The data table writes only a row exactly at the stop.
   */
  seriesNear: (
    item: ChartItem,
    series: string,
  ) => { text: string; at: string | null } | null
  /** How much a series' value changed since `before`, as a share of it, or null. */
  seriesChange: (item: ChartItem, before: ChartItem, series: string) => number | null
  /** How a stop is named. */
  stopText: (item: ChartItem) => string
  /** The stops run in order, such as days, so a change since the one before means something. */
  ordered: boolean
  /** The total of `item`'s shown series, or null where it has none or fewer than two shown series add to it. */
  totals: (item: ChartItem) => number | null
  /** Whether the tooltip shows the total when `<ChartTooltip>` doesn't say. */
  totalByDefault: boolean
  /** Whether the value of `series` on `item` is projected. */
  forecast: (series: string, item: ChartItem) => boolean
  /** The key of the stop picked, or null. */
  picked: string | null
  /** The series the keys brought forward, read out alone so Up and Down are heard, or null. */
  alone: string | null
  /**
   * A chart's own words in place of the series' values, with their table
   * column, or null. A stop with no row of the chart's own, where only a
   * series' own rows are, reads its series' values and leaves the column
   * empty.
   */
  own: { name: string; text: (item: ChartItem) => string } | null
}

/** Anything under a series' key as `write` writes a number: a number, a `[from, to]` range, or `noValue` for none. */
function writeDatum(value: unknown, write: (value: number) => string, noValue: string) {
  const range = rangeOf(value)
  if (range) return `${write(range[0])} – ${write(range[1])}`
  const number = numberOf(value)
  return number === null ? noValue : write(number)
}

/** What a reader says of its stops: to a screen reader, in the tooltip, and as the data table. */
interface ChartWords {
  describe: (item: ChartItem) => string
  tooltip: (item: ChartItem) => ReactNode
  table: ChartTable
}

/** A stop's name as every chart reads it out: with ", selected" when it is picked. */
function pickedName(name: string, picked: boolean, messages: ChartMessages): string {
  return picked ? `${name}, ${messages.selected}` : name
}

/** A series' name as the chart writes it in words: its label when that is text, else its key. */
function seriesName(config: ChartConfig, key: string) {
  const label = config[key]?.label
  return typeof label === 'string' ? label : key
}

/**
 * The words of a chart whose every stop holds a value per series: each
 * stop's name, then each shown series' value near it, with the time of a
 * row of its own beside the stop, its change since the stop before when
 * they run in order and whether it is projected; or the series brought
 * forward alone; or the chart's own words.
 */
function seriesWords(
  root: Pick<ChartRootState, 'series' | 'hidden' | 'config' | 'messages' | 'locale'>,
  input: SeriesWordsInput,
): ChartWords {
  const { series, hidden, config, messages, locale } = root
  const { stops, own } = input
  const shown = series.filter((key) => !hidden.includes(key))
  const projected = (key: string, item: ChartItem) =>
    input.forecast(key, item) ? `, ${messages.forecast}` : ''
  return {
    describe: (item) => {
      const name = pickedName(input.stopText(item), input.picked === item.key, messages)
      if (own && item.datum !== null) return `${name}: ${own.text(item)}`
      const at = stops.findIndex((stop) => stop.key === item.key)
      const before = input.ordered && at > 0 ? stops[at - 1] : undefined
      const keys =
        input.alone !== null && shown.includes(input.alone) ? [input.alone] : shown
      const values = keys.flatMap((key) => {
        const near = input.seriesNear(item, key)
        if (!near) return []
        const change = before ? input.seriesChange(item, before, key) : null
        const said =
          change === null
            ? ''
            : `, ${messages.change(change, percent(locale).format(Math.abs(change)))}`
        const when = near.at === null ? '' : ` (${near.at})`
        return [
          `${seriesName(config, key)}${when} ${near.text}${projected(key, item)}${said}`,
        ]
      })
      return values.length === 0 ? name : `${name}: ${values.join(', ')}`
    },
    tooltip: (item) => <ChartTooltipContent index={item.index} />,
    table: {
      header: messages.category,
      columns: own ? [own.name] : shown.map((key) => config[key]?.label ?? key),
      rows: stops.map((stop) => ({
        key: stop.key,
        name: input.stopText(stop),
        // Only a row exactly at the stop: the table never shows a value from beside it.
        cells: own
          ? [stop.datum === null ? '' : own.text(stop)]
          : shown.map((key) =>
              input.seriesNear(stop, key)?.at === null
                ? `${input.seriesText(stop, key)}${projected(key, stop)}`
                : '',
            ),
      })),
      footer: [],
    },
  }
}

/**
 * The total a stop's tooltip adds: the sum of its shown series when the
 * total is on (`own`, the content's, else `told`, the tooltip's, else the
 * chart's default), or null.
 */
function tooltipTotal(
  words: Pick<SeriesWordsInput, 'totals' | 'totalByDefault'>,
  item: ChartItem,
  own: boolean | undefined,
  told: boolean | undefined,
): number | null {
  return (own ?? told ?? words.totalByDefault) ? words.totals(item) : null
}

/** The words of the chart a part sits in, for `ChartTooltipContent`; each frame that uses `seriesWords` provides them. */
const SeriesWordsContext = createContext<SeriesWordsInput | null>(null)

/** Whether a stop's tooltip adds the total of its shown values: the tooltip's `total`, or undefined to follow the chart. */
const ChartTooltipTotal = createContext<boolean | undefined>(undefined)

/**
 * The values of the stop at `index`: its name, then a row for each shown
 * series, with its change since the stop before when the stops run in
 * order, and their total with `total`, which follows the tooltip's own, and
 * the chart's, by default.
 */
function ChartTooltipContent({
  index,
  total: own,
  hideLabel = false,
  className,
  children,
  ...props
}: ComponentProps<'div'> & {
  index: number
  total?: boolean
  hideLabel?: boolean
}) {
  const words = use(SeriesWordsContext)
  const told = use(ChartTooltipTotal)
  const {
    id,
    series,
    hidden,
    config,
    valueText,
    locale,
    patternOf,
    messages,
    emphasis,
    markerOf,
  } = useChartRootValue()
  if (!words) {
    throw new Error(
      '`ChartTooltipContent` goes inside a chart with series, such as a `BarChart`.',
    )
  }
  const at = words.stops.findIndex((stop) => stop.index === index)
  const item = words.stops[at]
  if (!item) return null
  const before = words.ordered && at > 0 ? words.stops[at - 1] : undefined
  const shown = series.filter((key) => !hidden.includes(key))
  const sum = tooltipTotal(words, item, own, told)
  return (
    // The tooltip sits outside the chart, so it carries the chart's id for its colours.
    <div data-chart={id} className={cn('grid min-w-36 gap-1', className)} {...props}>
      {!hideLabel && <div className='font-medium'>{words.stopText(item)}</div>}
      {shown.map((key) => {
        const near = words.seriesNear(item, key)
        if (!near) return null
        const marker = markerOf(key)
        return (
          // The series brought forward reads in full colour; the rest stay as they are, legible.
          <div
            key={key}
            data-lit={emphasis === key ? '' : undefined}
            className='group/row flex items-center gap-2'
          >
            {/* A series drawn in a shape of its own, such as a line or points, keys it by that shape, as the legend does. */}
            {marker ? (
              <SeriesKey
                series={key}
                slot={series.indexOf(key)}
                pattern={patternOf(key)}
                marker={marker}
              />
            ) : (
              <span
                aria-hidden
                className={cn(swatchClassName, forcedSeriesColor(series.indexOf(key)))}
                style={swatchStyle(key, patternOf(key))}
              />
            )}
            <span className={cn(tooltipQuietClassName, 'min-w-0 flex-1 truncate')}>
              {config[key]?.label ?? key}
              {near.at !== null && ` (${near.at})`}
              {words.forecast(key, item) && ` · ${messages.forecast}`}
            </span>
            {before && (
              <ChangeText
                change={words.seriesChange(item, before, key)}
                locale={locale}
                className={tooltipQuietClassName}
              />
            )}
            {/* A value with a unit reads in its own order whatever the page's direction. */}
            <span dir='auto' className='font-medium tabular-nums'>
              {near.text}
            </span>
          </div>
        )
      })}
      {sum !== null && (
        <div className='border-background/20 mt-0.5 flex items-center gap-2 border-t pt-1 forced-colors:border-[CanvasText]'>
          <span className='text-background/75 flex-1 forced-colors:text-[CanvasText]'>
            {messages.total}
          </span>
          <span className='font-medium tabular-nums'>{valueText(sum)}</span>
        </div>
      )}
      {children}
    </div>
  )
}

/* The axes: what the axes, the grid and reference parts read. */

/** The names along one axis, and which one a target is under. */
interface AxisNames {
  /** Drawn, the leaving ones too. */
  all: readonly ChartAxisName[]
  /** Still in the data. */
  current: readonly ChartAxisName[]
  /** The name `target` is under, by its place in `current`, or null. */
  nameOf: (target: ChartTarget) => number | null
  /** How the axis writes a name, unless the part is given a `categoryFormat`. */
  format: (value: unknown) => string
  /** Whether a name at either end is kept inside the axis. A grid's rows are each a name's height or more, so they centre freely. */
  keepInside: boolean
}

/** What a chart's axes, grid and reference parts read, which each family with axes provides. */
interface ChartAxesValue {
  /** The chart's scales, or null on a chart whose axes only name things, such as the Heatmap. */
  frame: ChartFrame | null
  orientation: ChartOrientation
  inset: number
  /** The names along each axis: categories, a grid's columns or rows, or a time axis's stops (for its lit pill). Null on an axis of values or numbers. */
  names: { x: AxisNames | null; y: AxisNames | null }
  /** Every value read against `axis`, for a reference at a summary such as the mean. Empty with no frame. */
  summaryValues: (axis: string) => readonly unknown[]
  /** The chart's own value axis is shares of 100% (stack `expand`), so it is written in percent. */
  percent: boolean
}

const ChartAxesContext = createContext<ChartAxesValue | null>(null)

function useChartAxes() {
  const value = use(ChartAxesContext)
  if (!value) throw new Error('Chart parts go inside a chart, such as a `BarChart`.')
  return value
}

/* Shares of a whole, such as the Donut's and the Waffle's. */

/** A share's value: a number above zero, or zero for one that is missing or below it. */
function shareValue(datum: ChartDatum, dataKey: string) {
  return Math.max(0, numberOf(datum[dataKey]) ?? 0)
}

/** A share's colour: its own, or the next of the chart's colours for one the config leaves out. */
function shareColor(chart: Pick<ChartRootState, 'series'>, item: ChartItem) {
  const slot = chart.series.indexOf(item.key)
  return `var(--color-${item.key}, var(--chart-${((slot === -1 ? item.index : slot) % 5) + 1}))`
}

/** A row of a share's tooltip: one of its values, and its share. */
interface ShareTooltipRow {
  /** The value's name, when there are several, such as a ring's. */
  label: string | null
  /** The value the share is of, or null for a row that is a share alone, such as a share of the whole. */
  value: string | null
  /** Its part of the whole, or null for a value that isn't one, such as a second value beside it. */
  share: string | null
}

/**
 * The tooltip for a share: its swatch and its name, its share and its
 * value, or under its name, each of its values'. `swatch` stands in for the
 * share's own, for a share drawn otherwise, such as a waffle's remaining
 * cells.
 */
function ShareTooltipContent({
  chart,
  category,
  name,
  rows,
  swatch: own,
}: {
  chart: Pick<ChartRootState, 'id' | 'series' | 'patternOf'>
  category: ChartItem
  name: string
  rows: readonly ShareTooltipRow[]
  swatch?: ReactNode
}) {
  const slot = chart.series.indexOf(category.key)
  const swatch = own ?? (
    <span
      aria-hidden
      className={cn(
        swatchClassName,
        forcedSeriesColor(slot === -1 ? category.index : slot),
      )}
      style={swatchStyle(
        category.key,
        slot === -1 ? 'solid' : chart.patternOf(category.key),
      )}
    />
  )
  const figures = (row: ShareTooltipRow) => (
    <>
      {/* A value with a unit reads in its own order whatever the page's direction. */}
      {row.share !== null && (
        <span
          dir='auto'
          className='text-background/75 tabular-nums forced-colors:text-[CanvasText]'
        >
          {row.share}
        </span>
      )}
      {row.value !== null && (
        <span dir='auto' className='font-medium tabular-nums'>
          {row.value}
        </span>
      )}
    </>
  )
  const single = rows.length === 1 ? rows[0] : undefined
  return (
    // The tooltip sits outside the chart, so it carries the chart's id for its colours.
    <div data-chart={chart.id} className='flex min-w-36 flex-col gap-1'>
      <div className='flex items-center gap-2'>
        {swatch}
        <span
          className={cn(
            'min-w-0 flex-1 break-words',
            single ? 'text-background/75 forced-colors:text-[CanvasText]' : 'font-medium',
          )}
        >
          {name}
        </span>
        {single && figures(single)}
      </div>
      {!single &&
        rows.map((row) => (
          <div key={row.label} className='flex items-center gap-2 ps-4'>
            <span className='text-background/75 min-w-0 flex-1 break-words forced-colors:text-[CanvasText]'>
              {row.label}
            </span>
            {figures(row)}
          </div>
        ))}
    </div>
  )
}

/** The rows whose series isn't hidden, for a chart whose rows each belong to one. */
function rowsShown(
  rows: readonly ChartDatum[],
  seriesOf: (row: ChartDatum) => string,
  hidden: readonly string[],
) {
  return rows.filter((row) => !hidden.includes(seriesOf(row)))
}

export {
  type ActiveIndexProps,
  type AxisNames,
  axisLayerClassName,
  axisSlide,
  cascadeSpan,
  type CategoryChartProps,
  categoryChartKeys,
  type ChartActiveValue,
  type ChartAxesValue,
  ChartAxesContext,
  type ChartAxis,
  type ChartAxisName,
  type ChartForecast,
  type ChartFrame,
  type ChartLifeOptions,
  type ChartLoad,
  type ChartParts,
  ChartPartsContext,
  chartParts,
  ChartTooltipContent,
  ChartTooltipTotal,
  type ChartWords,
  checkSeries,
  writeDatum,
  type DeclaringPart,
  type EntrancePhase,
  figureProps,
  type FrameAxis,
  IndexActive,
  isForecast,
  localeTag,
  numberAxis,
  pickedName,
  plotFraction,
  plotOffset,
  plotPlace,
  rowsShown,
  seriesWords,
  type SeriesWordsInput,
  SeriesWordsContext,
  shareColor,
  ShareTooltipContent,
  type ShareTooltipRow,
  shareValue,
  slideLine,
  slideTo,
  stickTo,
  TICK_SPACING,
  tickMove,
  timeAxis,
  tellIndex,
  toldIndex,
  tooltipTotal,
  useChartActive,
  useChartAxes,
  useChartLife,
  useChartLoad,
  useChartPick,
  useDeclared,
  useIndexFocus,
  useLeavingItems,
  usePreviousScales,
  useRegistry,
  useTicks,
  withLeaving,
}
