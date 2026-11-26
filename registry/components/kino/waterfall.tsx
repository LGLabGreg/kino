'use client'

import {
  CollapsibleIndicator,
  collapsibleRowClassName,
} from '@/registry/components/kino/collapsible'
import { useSpinner } from '@/registry/components/kino/spinner'
import { Tooltip } from '@/registry/components/kino/tooltip'
import { useAnnouncer } from '@/registry/lib/announce'
import {
  type ChartConfig,
  type Span,
  labelBox,
  labelLength,
  labelsMeet,
  labelStep,
} from '@/registry/lib/chart-math'
import {
  type ChartFormat,
  ChartLegendToggles,
  ChartStyle,
  ChartTooltipBox,
  forcedSeriesColor,
  stepBackInkClassName,
  stepBackScopeClassName,
  swatchClassName,
  formatterOf,
  seriesColor,
  swatchStyle,
  useEntered,
} from '@/registry/lib/chart-root'
import { linearScale, tickCountFor } from '@/registry/lib/chart-scale'
import { useControllable } from '@/registry/lib/controllable'
import { GlideGroupMemory } from '@/registry/lib/glide'
import {
  followPointer,
  highlightStep,
  type HighlightState,
  type HighlightStep,
  itemMatching,
  pickedRowClassName,
  rowHighlightClassName,
  tintedRowTextClassName,
} from '@/registry/lib/highlight'
import { menuIndicatorClassName, menuIndicatorSlot, MenuTick } from '@/registry/lib/menu'
import { NoticeIcon } from '@/registry/lib/notice'
import {
  placeholderBreatheClassName,
  placeholderFillClassName,
} from '@/registry/lib/placeholder'
import { markMounted, mergeRefs } from '@/registry/lib/refs'
import { Roll } from '@/registry/lib/roll'
import { edgeFadeClassName, followEdges } from '@/registry/lib/scroll'
import type { OptionsOf } from '@ui-sdk/core'
import {
  visibleWaterfallRows,
  waterfall,
  type WaterfallBarLabelDetails,
  type WaterfallDataItem,
} from '@ui-sdk/core/waterfall'
import { type PrimitiveHandle, usePart, usePrimitive } from '@ui-sdk/react/primitive'
import {
  WaterfallAxis as WaterfallAxisPrimitive,
  WaterfallBar as WaterfallBarPrimitive,
  WaterfallColumnHeader as WaterfallColumnHeaderPrimitive,
  WaterfallHeaderRow as WaterfallHeaderRowPrimitive,
  WaterfallIndicator as WaterfallIndicatorPrimitive,
  WaterfallRow as WaterfallRowPrimitive,
  WaterfallRowHeader as WaterfallRowHeaderPrimitive,
  WaterfallTick as WaterfallTickPrimitive,
} from '@ui-sdk/react/waterfall'
import {
  type ComponentProps,
  createContext,
  Fragment,
  type CSSProperties,
  use,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import { cn } from '@/lib/utils'

/*
 * A trace, or a page's requests, as bars on one time axis: ui-sdk's
 * Waterfall, a treegrid that owns the rows' keys, focus, selection and
 * what opens. Kino draws it as the Bar chart's sibling: the span under the
 * pointer or the focus stays bright while the rest step back, a pill glides
 * along the axis to where it starts, and a tooltip and a legend read as the
 * charts'. A span opens to show the spans inside it, which unfold under a
 * rail from its chevron and draw in the order they ran.
 */

/** One span: ui-sdk's, with its kind, which colours its bar, and whether it failed. */
interface WaterfallItem extends Omit<WaterfallDataItem, 'children'> {
  /** Its kind, a key of the Waterfall's `config`. */
  kind?: string
  /** It failed: `true`, or what went wrong, which its tooltip shows. */
  error?: string | boolean
  /** The spans it started. */
  children?: WaterfallItem[]
}

/** What the Waterfall writes, for a page in another language. */
interface WaterfallMessages {
  /** The heading over the spans' names. */
  span: string
  /** The heading over their durations. */
  duration: string
  /** The name of the column the bars are in. */
  timeline: string
  starts: string
  /** Said of a span that failed, after its times. */
  failed: string
  /** The legend's name. */
  kinds: string
  empty: string
  loading: string
  loaded: string
  /** How a span's times are read: when it starts and how long it lasts. */
  times: (start: string, duration: string) => string
}

const defaultMessages: WaterfallMessages = {
  span: 'Span',
  duration: 'Duration',
  timeline: 'Timeline',
  starts: 'Starts',
  failed: 'Failed',
  kinds: 'Services',
  empty: 'No spans to show',
  loading: 'Loading spans',
  loaded: 'Spans loaded',
  times: (start, duration) => `starts at ${start}, lasts ${duration}`,
}

const defaultFormat: ChartFormat = {
  style: 'unit',
  unit: 'millisecond',
  maximumFractionDigits: 1,
}

/** A span with the value of the span it sits in, or null at the top. */
interface Placed {
  item: WaterfallItem
  up: string | null
}

interface WaterfallContextValue {
  id: string
  handle: PrimitiveHandle<typeof waterfall>
  items: readonly WaterfallItem[]
  /** Every span, by `value`, in the order the rows show. */
  spans: ReadonlyMap<string, Placed>
  config: ChartConfig
  kinds: readonly string[]
  write: (value: number) => string
  hidden: readonly string[]
  setHidden: (hidden: string[]) => void
  emphasis: string | null
  setEmphasis: (kind: string | null) => void
  messages: WaterfallMessages
  /** Each span's bar, for the tooltip. */
  bars: Map<string, HTMLElement>
  setActive: (value: string | null) => void
  setTrackWidth: (width: number) => void
}

const WaterfallContext = createContext<WaterfallContextValue | null>(null)

function useWaterfall() {
  const context = use(WaterfallContext)
  if (!context) throw new Error('Waterfall parts go inside a `Waterfall`.')
  return context
}

/**
 * What changes as the pointer moves, apart from what the rows read, so a
 * span lit or the axis measured re-renders only the axis and the tooltip.
 */
const WaterfallActiveContext = createContext<{
  /** The span under the pointer, the focus or the last touch. */
  active: string | null
  /** How wide the bars' column is, in pixels; 0 before it is measured. */
  trackWidth: number
}>({ active: null, trackWidth: 0 })

/** The stretch of time the axis shows, from ui-sdk's root. */
const RangeContext = createContext<Span>([0, 0])

/**
 * How many ticks the axis marks at most. ui-sdk rounds its step up from the
 * room each tick gets, so it marks about half this many on a long axis.
 */
const TICKS = 10
/** The least room a tick's label needs, in pixels. */
const TICK_SPACING = 64

type WaterfallProps = Omit<OptionsOf<typeof waterfall>, 'items' | 'format' | 'locale'> &
  Omit<ComponentProps<'div'>, 'defaultValue' | 'onChange' | 'onSelect'> & {
    /** The spans, each with a `value`, a `label`, a `start`, a `duration`, a `kind` and the spans it started as `children`. */
    items: WaterfallItem[]
    /** Each kind of span by its `kind`: its name and colour, as a chart's series. */
    config?: ChartConfig
    /** How times are written: in milliseconds by default. */
    format?: ChartFormat
    locale?: string
    /**
     * How the bars come in when the Waterfall first comes into view: drawn
     * from their starts in the order the spans ran, or already there, as a
     * page that loads doesn't animate into place.
     */
    entrance?: 'cascade' | 'none'
    /** The kinds whose bars are hidden, by key, when you hold the state. */
    hiddenKinds?: string[]
    defaultHiddenKinds?: string[]
    onHiddenKindsChange?: (hidden: string[]) => void
    messages?: Partial<WaterfallMessages>
  }

/**
 * The trace: ui-sdk's Waterfall, which holds the spans, which are open and
 * which is picked, with the colour of each kind of span and how times are
 * written. Holds a `WaterfallLegend`, a `WaterfallList` and a
 * `WaterfallTooltip`.
 */
function Waterfall({
  items,
  range,
  value,
  defaultValue,
  onValueChange,
  expanded,
  defaultExpanded,
  onExpandedChange,
  onHighlight,
  getBarLabel,
  controller,
  debug,
  config = {},
  format = defaultFormat,
  locale,
  entrance = 'none',
  hiddenKinds,
  defaultHiddenKinds = [],
  onHiddenKindsChange,
  messages: ownMessages,
  className,
  children,
  ref,
  ...props
}: WaterfallProps) {
  const id = `waterfall-${useId().replace(/[^a-zA-Z0-9-]/g, '')}`
  const rootRef = useRef<HTMLDivElement>(null)
  const refs = useMemo(() => mergeRefs(rootRef, ref, markMounted), [ref])
  const kinds = useMemo(() => Object.keys(config), [config])
  const [hidden, setHiddenNow] = useControllable(
    hiddenKinds,
    defaultHiddenKinds,
    onHiddenKindsChange,
  )
  // One function for the life of the Waterfall, so the rows' context holds still as the
  // pointer moves; it always calls the latest setter.
  const setHiddenRef = useRef(setHiddenNow)
  useLayoutEffect(() => {
    setHiddenRef.current = setHiddenNow
  })
  const setHidden = useCallback((next: string[]) => setHiddenRef.current(next), [])
  const [emphasis, setEmphasis] = useState<string | null>(null)
  const [active, setActive] = useState<string | null>(null)
  const [width, setWidth] = useState(0)
  const entered = useEntered(rootRef, entrance === 'none')
  const [bars] = useState(() => new Map<string, HTMLElement>())
  const messages = useMemo(() => ({ ...defaultMessages, ...ownMessages }), [ownMessages])
  const write = useMemo(() => formatterOf(locale, format), [format, locale])
  const spans = useMemo(() => placeAll(items), [items])
  const handle = usePrimitive(waterfall, {
    items,
    range,
    value,
    defaultValue,
    onValueChange,
    expanded,
    defaultExpanded,
    onExpandedChange,
    onHighlight,
    format,
    locale,
    // What a screen reader hears on a bar: its kind, its times and what went wrong.
    getBarLabel:
      getBarLabel ??
      ((item, times) => barLabel(spans.get(item.value)?.item, times, config, messages)),
    controller,
    debug,
  })
  const context = useMemo(
    () => ({
      id,
      handle,
      items,
      spans,
      config,
      kinds,
      write,
      hidden,
      setHidden,
      emphasis,
      setEmphasis,
      messages,
      bars,
      setActive,
      setTrackWidth: setWidth,
    }),
    [
      id,
      handle,
      items,
      spans,
      config,
      kinds,
      write,
      hidden,
      setHidden,
      emphasis,
      messages,
      bars,
    ],
  )
  const live = useMemo(() => ({ active, trackWidth: width }), [active, width])

  return (
    <WaterfallContext value={context}>
      <WaterfallActiveContext value={live}>
        <ChartStyle id={id} config={config} series={kinds} />
        <div
          ref={refs}
          data-waterfall=''
          data-chart={id}
          data-entered={entered ? '' : undefined}
          className={cn(
            'group/waterfall @container/waterfall flex min-w-0 flex-col bg-inherit text-sm',
            className,
          )}
          {...props}
        >
          {children}
        </div>
      </WaterfallActiveContext>
    </WaterfallContext>
  )
}

/** Every span by its value, in the order its row shows, with the span it sits in. */
function placeAll(items: readonly WaterfallItem[]) {
  const spans = new Map<string, Placed>()
  const visit = (list: readonly WaterfallItem[], up: string | null) => {
    for (const item of list) {
      spans.set(item.value, { item, up })
      if (item.children) visit(item.children, item.value)
    }
  }
  visit(items, null)
  return spans
}

/** A bar's name for a screen reader: its kind, when it starts and how long it lasts, and what went wrong. */
function barLabel(
  item: WaterfallItem | undefined,
  { start, duration }: WaterfallBarLabelDetails,
  config: ChartConfig,
  messages: WaterfallMessages,
) {
  const kind = item?.kind
  const error = item?.error
  const kindName = kind === undefined ? undefined : config[kind]?.label
  return [
    kind === undefined ? null : typeof kindName === 'string' ? kindName : kind,
    messages.times(start, duration),
    error === undefined || error === false
      ? null
      : error === true
        ? messages.failed
        : `${messages.failed}: ${error}`,
  ]
    .filter((part) => part !== null)
    .join(', ')
}

/**
 * A toggle for each kind of span, as the charts' legend: off, its bars keep
 * only their outline, so the rest read on their own. Pointing at one brings
 * its spans forward.
 */
function WaterfallLegend({
  className,
  ...props
}: Omit<ComponentProps<'div'>, 'children'>) {
  const { kinds, config, hidden, setHidden, setEmphasis, messages } = useWaterfall()
  return (
    <div
      data-waterfall-legend=''
      role='group'
      aria-label={messages.kinds}
      className={cn('flex flex-wrap items-center gap-x-1 gap-y-0.5 pb-3', className)}
      {...props}
    >
      <ChartLegendToggles
        series={kinds}
        labelOf={(kind) => config[kind]?.label ?? kind}
        patternOf={() => 'solid'}
        hidden={hidden}
        onHiddenChange={setHidden}
        onEmphasisChange={setEmphasis}
      />
    </div>
  )
}

/**
 * The bars' column: as wide as the row allows past the names' room, so every
 * row's bar starts at the same place whatever its depth. The rows and the
 * axis measure it against the list, the container they share.
 */
const trackClassName =
  'relative shrink-0 w-[max(50cqw,calc(100cqw-var(--waterfall-name-width,24rem)))]'

/**
 * In a narrow list the bars take a line of their own under the names, as wide
 * as the list less the tick's room. Each row's line starts at its depth, so
 * it reaches back by as much to line up with the axis.
 */
const narrowTrackClassName =
  '@max-lg/rows:h-3 @max-lg/rows:w-[calc(100cqw-2*var(--control-padding)-1.5rem)] @max-lg/rows:ms-[calc((var(--waterfall-level)-1)*var(--waterfall-indent)*-1)]'

/** The axis and the grid in a narrow list: the bars' column alone, as wide as the rows'. */
const narrowColumnClassName = '@max-lg:w-[calc(100cqw-2*var(--control-padding)-1.5rem)]'

/**
 * The gap above a row, folding with it: a gap between the rows would stay
 * until a folded row leaves, and the rows under it would then jump up.
 */
const rowGapClassName =
  'h-px shrink-0 transition-[height] duration-(--motion-layout-duration) ease-(--motion-layout-easing) motion-reduce:transition-none [&:has(+[hidden])]:h-0'

/** A span's row. */
const rowSelector = '[data-slot=waterfall-row]'

/** The span a row, or anything in one, belongs to. */
function spanOf(node: Element | null) {
  return node?.closest<HTMLElement>('[data-span]')?.dataset.span ?? null
}

/** The room the row keeps for the tick of a picked row, so the axis lines up with the bars. */
const tickRoomClassName = 'size-4 shrink-0'

/**
 * The spans under a time axis that stays in view as they scroll: ui-sdk's
 * treegrid, with a row for every span in the Waterfall's `items`. Give it a
 * height (`max-h-96`) to scroll a long trace. `className` and `style` go to
 * its box, the rest to ui-sdk's root, which needs a name (`aria-label`).
 */
function WaterfallList({
  className,
  style,
  loading = false,
  ...props
}: Omit<ComponentProps<'div'>, 'children'> & {
  /** Shows a placeholder while the spans load, after a moment, and for long enough to read. */
  loading?: boolean
}) {
  const { handle, items, spans, messages, setActive, bars } = useWaterfall()
  const boxRef = useRef<HTMLDivElement>(null)
  const scrollerRef = useRef<HTMLDivElement>(null)
  const rowsRef = useRef<HTMLDivElement>(null)
  const layerRef = useRef<HTMLSpanElement>(null)
  const waiting = useSpinner(loading)
  const hasSpans = items.length > 0
  const { announce, region } = useAnnouncer()

  useEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller) return
    const box = boxRef.current
    const stopEdges = followEdges(scroller, '--scroll-fade')
    // The room the scrollbar takes, which the axis keeps clear: none where scrollbars float.
    const gutter = () =>
      box?.style.setProperty(
        '--waterfall-gutter',
        `${scrollbarRoom(scroller.offsetWidth, scroller.clientWidth)}px`,
      )
    gutter()
    const resized = new ResizeObserver(gutter)
    resized.observe(scroller)
    if (scroller.firstElementChild) resized.observe(scroller.firstElementChild)
    return () => {
      stopEdges()
      resized.disconnect()
    }
  }, [])

  const wasWaiting = useRef(waiting)
  useEffect(() => {
    if (waiting === wasWaiting.current) return
    wasWaiting.current = waiting
    announce(waiting ? messages.loading : hasSpans ? messages.loaded : messages.empty)
  })

  // One highlight for every row, so it glides from row to row.
  useEffect(() => {
    const rows = rowsRef.current
    const layer = layerRef.current
    if (!rows || !layer) return
    return followPointer(rows, layer, {
      itemOf: itemMatching(rows, rowSelector),
      focus: true,
    })
  }, [waiting])

  // The spans a span shows as it opens draw in the order they ran inside it, its open children
  // with them, where those there from the start draw in the order they ran in the trace.
  useEffect(() => {
    const rows = rowsRef.current
    if (!rows) return
    const { instance } = handle
    const showing = (expanded: readonly string[]) =>
      new Set(visibleWaterfallRows(items, [...expanded]).map((row) => row.item.value))
    let shown = showing(instance.get().expanded)
    return instance.subscribe(() => {
      const now = showing(instance.get().expanded)
      for (const value of now) {
        if (shown.has(value)) continue
        const row = rows.querySelector<HTMLElement>(`[data-span="${CSS.escape(value)}"]`)
        const opened = spans.get(
          openedBy(value, (key) => spans.get(key)?.up ?? null, shown) ?? '',
        )
        const start = spans.get(value)?.item.start
        if (!row || !opened || start === undefined) continue
        const { item } = opened
        row.style.setProperty(
          '--waterfall-at-opened',
          `${fractionOf(start, [item.start, item.start + item.duration])}`,
        )
        row.setAttribute('data-revealed', '')
      }
      shown = now
    })
  }, [handle, items, spans, waiting])

  // The span lit for the tooltip, the pill and Spotlight: the one the highlight is on, or else
  // the one last pressed by touch, which has no highlight. None while it has scrolled out of sight.
  useEffect(() => {
    const scroller = scrollerRef.current
    const rows = rowsRef.current
    if (!scroller || !rows) return
    let glided: string | null = null
    let touched: string | null = null
    const sync = () => {
      const lit = glided ?? touched
      const bar = lit === null ? null : (bars.get(lit) ?? null)
      const view = scroller.getBoundingClientRect()
      const seen =
        bar !== null &&
        bar.getClientRects().length > 0 &&
        inSight(bar.getBoundingClientRect(), view.top, view.bottom)
      const next = seen ? lit : null
      // Spotlight reads the lit row from the page, so no row re-renders as the pointer moves.
      const litRow = next === null ? null : (bar?.closest(rowSelector) ?? null)
      for (const row of rows.querySelectorAll('[data-lit]')) {
        if (row !== litRow) row.removeAttribute('data-lit')
      }
      litRow?.setAttribute('data-lit', '')
      // Set here rather than found with `:has()`, which would restyle every bar on each move.
      rows.toggleAttribute('data-spotlit', next !== null)
      setActive(next)
    }
    const observer = new MutationObserver(() => {
      glided = spanOf(rows.querySelector(`${rowSelector}[data-glided]`))
      sync()
    })
    observer.observe(rows, { subtree: true, attributeFilter: ['data-glided', 'hidden'] })
    const press = (event: PointerEvent) => {
      if (event.pointerType !== 'touch') return
      touched =
        event.target instanceof Element && rows.contains(event.target)
          ? spanOf(event.target)
          : null
      sync()
    }
    document.addEventListener('pointerdown', press)
    scroller.addEventListener('scroll', sync, { passive: true })
    return () => {
      observer.disconnect()
      document.removeEventListener('pointerdown', press)
      scroller.removeEventListener('scroll', sync)
      setActive(null)
    }
  }, [setActive, bars, waiting])

  const root = usePart(
    handle,
    'root',
    {},
    {
      ...props,
      className: 'flex min-h-0 flex-1 flex-col',
      children: ({ range }: { range: [number, number] }) => (
        <RangeContext value={range}>
          {/* The axis sits over the box that scrolls, not in it, so it needs no background of
              its own to hide the rows, whatever the Waterfall sits on. It keeps the scrollbar's
              room at its end, so its column lines up with the rows'. */}
          <WaterfallHeader />
          <div
            ref={scrollerRef}
            data-waterfall-scroller=''
            className={cn(
              'scrollbar-thin relative min-h-0 flex-1 overflow-y-auto overscroll-contain',
              edgeFadeClassName,
            )}
          >
            {/* While a span is lit, every other bar steps back; the lit row sets it back to 0. */}
            <div className='@container/rows relative min-w-0'>
              {/* The ticks' lines down the rows: the axis again, drawn as lines, so the first
                  paint has them too. */}
              <WaterfallGrid hidden={waiting || (!hasSpans && !loading)} />
              {waiting ? (
                <WaterfallPlaceholder />
              ) : (
                <div
                  ref={rowsRef}
                  className={cn(
                    'relative isolate flex min-w-0 flex-col data-spotlit:[--mark-step:1]',
                    // A deeper span steps in, less so in a narrow list.
                    '[--waterfall-indent:1.5rem] @max-xs/rows:[--waterfall-indent:1rem]',
                    stepBackScopeClassName,
                  )}
                >
                  {[...spans.values()].map(({ item, up }, at) => (
                    <Fragment key={item.value}>
                      {at > 0 && <span aria-hidden className={rowGapClassName} />}
                      <WaterfallSpanRow item={item} up={up} />
                    </Fragment>
                  ))}
                  <span
                    ref={layerRef}
                    aria-hidden
                    data-waterfall-highlight=''
                    className={rowHighlightClassName}
                  />
                </div>
              )}
              {/* Loading with no spans yet is loading, never empty, while the placeholder waits to show. */}
              {!hasSpans && !loading && (
                <div className='text-muted-foreground px-(--control-padding) py-8 text-center'>
                  {messages.empty}
                </div>
              )}
            </div>
          </div>
        </RangeContext>
      ),
    },
    'div',
  )

  return (
    <div
      ref={boxRef}
      data-waterfall-list=''
      className={cn('flex min-h-0 flex-col overflow-hidden', className)}
      style={style}
    >
      {root}
      {region}
    </div>
  )
}

/** The columns every row shares: the names, the bars, the tick's room. */
const columnsClassName = 'flex gap-2 px-(--control-padding)'

/**
 * The header: the names' and durations' headings, and the time axis over
 * the bars, with a label at each tick and a pill that glides to where the
 * span under the pointer starts, the labels it would cover stepping aside.
 */
function WaterfallHeader() {
  const { messages, setTrackWidth } = useWaterfall()
  const trackRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const track = trackRef.current
    if (!track) return
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setTrackWidth(entry.contentRect.width)
    })
    observer.observe(track)
    return () => observer.disconnect()
  }, [setTrackWidth])

  return (
    // The container holds no padding, so its columns are as wide as the rows' below.
    <div className='@container min-w-0 shrink-0 border-b me-(--waterfall-gutter,0px)'>
      <WaterfallHeaderRowPrimitive
        className={cn(
          columnsClassName,
          'text-muted-foreground h-(--control-height) items-center text-xs',
        )}
      >
        <WaterfallColumnHeaderPrimitive className='flex min-w-0 flex-1 items-center gap-2 font-medium @max-lg:sr-only'>
          <span data-waterfall-heading='' className='flex-1 truncate ps-6'>
            {messages.span}
          </span>
          {/* The durations sit in the names' cells, so only the column's name is read. */}
          <span aria-hidden className='shrink-0'>
            {messages.duration}
          </span>
        </WaterfallColumnHeaderPrimitive>
        <WaterfallColumnHeaderPrimitive
          ref={trackRef}
          className={cn(
            trackClassName,
            narrowColumnClassName,
            '@container/track self-stretch',
          )}
        >
          {/* A column's name is its text, which the ticks drawn over it aren't. */}
          <span className='sr-only'>{messages.timeline}</span>
          <WaterfallAxisPrimitive className='absolute inset-0 rtl:[--waterfall-flip:-1] [&>*]:absolute [&>*]:top-1/2'>
            <WaterfallTicks />
          </WaterfallAxisPrimitive>
        </WaterfallColumnHeaderPrimitive>
        <span aria-hidden className={tickRoomClassName} />
      </WaterfallHeaderRowPrimitive>
    </div>
  )
}

/** Where a fraction of the axis sits, kept inside it, for a label of its own width. */
function placeAt(fraction: number): CSSProperties {
  return {
    insetInlineStart: 0,
    // The y half is here too: an inline `translate` overrides a class's.
    translate: `calc(var(--waterfall-flip, 1) * clamp(0px, ${fraction * 100}cqw - 50%, 100cqw - 100%)) -50%`,
  }
}

/** The axis's labels and its pill. */
function WaterfallTicks() {
  const { spans, write } = useWaterfall()
  const { active, trackWidth } = use(WaterfallActiveContext)
  const range = use(RangeContext)
  const ticks = useTicks()
  const start = active === null ? null : (spans.get(active)?.item.start ?? null)
  // The pill appears where it is going when it had gone, glides from span to span, and fades
  // where it is, by the highlight's own steps: brought back while it fades, it glides on.
  const [pill, setPill] = useState<{
    state: HighlightState
    step: HighlightStep
    at: number | null
    /** Which way its number rolls: up for a later start, down for an earlier one. */
    trend: number
    /** Counts its appearances, so a number that appears in place starts at rest. */
    shows: number
  }>({ state: 'hidden', step: 'stay', at: null, trend: 1, shows: 0 })
  const [seen, setSeen] = useState(start)
  if (seen !== start) {
    setSeen(start)
    const [state, step] = highlightStep(pill.state, start === null ? 'none' : 'item')
    setPill({
      state,
      step,
      at: start ?? pill.at,
      trend:
        start === null || pill.at === null ? pill.trend : Math.sign(start - pill.at) || 1,
      shows: step === 'appear' ? pill.shows + 1 : pill.shows,
    })
  }
  const faded = () => {
    const [state, step] = highlightStep(pill.state, 'faded')
    if (state !== pill.state) setPill({ ...pill, state, step })
  }

  const shown = pill.state === 'shown'
  const pillAt = pill.at === null ? null : fractionOf(pill.at, range)
  const pillText = pill.at === null ? '' : write(pill.at)
  // Every few ticks keep a label when they all would crowd.
  const every = labelStep(
    ticks.length,
    trackWidth,
    Math.max(...ticks.map((tick) => labelLength(tick.label))) + 8,
  )
  const covered = (tick: { label: string; position: number }) =>
    shown &&
    pillAt !== null &&
    tickCovered(
      tick.position / 100,
      labelLength(tick.label),
      pillAt,
      labelLength(pillText),
      trackWidth,
    )

  return (
    <>
      {/* No labels until the axis is measured, so none fade out on load. */}
      {trackWidth > 0 &&
        ticks.map((tick, at) => (
          <WaterfallTickPrimitive
            key={tick.time}
            time={tick.time}
            data-covered={covered(tick) || at % every !== 0 ? '' : undefined}
            className='px-0.5 tabular-nums transition-opacity duration-(--motion-layout-duration) ease-(--motion-layout-easing) data-covered:opacity-0'
            style={placeAt(tick.position / 100)}
          >
            <bdi>{tick.label}</bdi>
          </WaterfallTickPrimitive>
        ))}
      <span
        data-waterfall-pill=''
        data-shown={shown ? '' : undefined}
        data-instant={pill.step === 'appear' ? '' : undefined}
        onTransitionEnd={(event) => {
          if (event.propertyName === 'opacity' && pill.state === 'fading') faded()
        }}
        className='bg-foreground text-background rounded-(--control-radius-xs) px-1.5 py-0.5 font-medium tabular-nums opacity-0 [transition:opacity_var(--motion-exit-duration)_var(--motion-exit-easing),translate_var(--motion-layout-duration)_var(--motion-layout-easing)] data-instant:[transition:opacity_var(--motion-enter-duration)_var(--motion-enter-easing)] data-shown:opacity-100 motion-reduce:[transition:opacity_var(--motion-exit-duration)_var(--motion-exit-easing)] forced-colors:bg-[Highlight] forced-colors:text-[HighlightText] forced-colors:forced-color-adjust-none'
        style={pillAt === null ? undefined : placeAt(pillAt)}
      >
        {pill.at !== null && (
          <bdi>
            <Roll key={pill.shows} value={pillText} trend={pill.trend} />
          </bdi>
        )}
      </span>
    </>
  )
}

/**
 * The axis's round times, across the whole range to its end, as many as the
 * track has room for. ui-sdk's stop a step short of the end, which leaves
 * the last stretch of a trace with no line.
 */
function useTicks() {
  const { write } = useWaterfall()
  const { trackWidth } = use(WaterfallActiveContext)
  const range = use(RangeContext)
  return useMemo(
    () =>
      linearScale(range, {
        domain: range,
        tickCount: tickCountFor(TICKS, trackWidth, TICK_SPACING),
      }).ticks.map((time) => ({
        time,
        label: write(time),
        position: fractionOf(time, range) * 100,
      })),
    [range, trackWidth, write],
  )
}

/** The lines down the bars' column at each tick, behind the rows. */
function WaterfallGrid({ hidden }: { hidden: boolean }) {
  const ticks = useTicks()
  return (
    <div
      hidden={hidden}
      className={cn(columnsClassName, 'pointer-events-none absolute inset-0')}
    >
      <div className='flex min-w-0 flex-1 @max-lg:hidden' />
      <WaterfallAxisPrimitive className={cn(trackClassName, narrowColumnClassName)}>
        {ticks.map((tick) => (
          <span
            key={tick.time}
            data-edge={tick.position === 0 ? '' : undefined}
            className='border-border absolute inset-y-0 border-s border-dashed data-edge:border-solid forced-colors:border-[GrayText]'
            style={{ insetInlineStart: `${tick.position}%` }}
          />
        ))}
      </WaterfallAxisPrimitive>
      <span className={tickRoomClassName} />
    </div>
  )
}

/** Rows that wait for the spans: a name and a bar each, stepping on as a trace would. */
function WaterfallPlaceholder() {
  const rows = [
    [0, 0.92, 9],
    [0.04, 0.2, 7],
    [0.08, 0.1, 6],
    [0.26, 0.42, 8],
    [0.3, 0.16, 5],
    [0.7, 0.22, 7],
  ] as const
  return (
    <div
      aria-hidden
      data-waterfall-placeholder=''
      className={placeholderBreatheClassName}
    >
      {rows.map(([from, size, name], at) => (
        <div
          key={at}
          className={cn(
            columnsClassName,
            'min-h-(--control-height) items-center @max-lg:flex-wrap @max-lg:gap-y-1 @max-lg:py-2',
          )}
        >
          <div className='flex min-w-0 flex-1 items-center gap-2 @max-lg:basis-full'>
            <span
              className={cn('h-2 rounded-full', placeholderFillClassName)}
              style={{
                width: `${name}ch`,
                marginInlineStart: at === 0 ? 0 : '1.5rem',
              }}
            />
          </div>
          <div className={cn(trackClassName, narrowColumnClassName)}>
            <span
              className={cn(
                'absolute top-1/2 h-2.5 -translate-y-1/2 rounded-(--control-radius-xs)',
                placeholderFillClassName,
              )}
              style={{
                insetInlineStart: `${from * 100}%`,
                width: `${size * 100}%`,
              }}
            />
          </div>
          <span className={tickRoomClassName} />
        </div>
      ))}
    </div>
  )
}

/** The corner of a bar, never more than half its thickness. */
const barRadius = 'min(var(--waterfall-radius,var(--control-radius-xs)),0.3125rem)'

/** A row that takes focus: the controls' ring, inside it, as rows sit edge to edge. */
const focusRingClassName =
  'ring-ring/50 focus-visible:ring-3 focus-visible:outline-hidden ring-inset forced-colors:focus-visible:outline-2 forced-colors:focus-visible:-outline-offset-2 forced-colors:focus-visible:outline-[CanvasText] forced-colors:focus-visible:outline-solid'

/**
 * A cell that takes focus, as Right moves into a row: the same ring, on the
 * cell's own `:focus-visible` alone, so a state that holds the row's ring
 * (a page showing every state at once) leaves its cells without one.
 */
const cellFocusRingClassName =
  'ring-ring/50 [&:focus-visible]:ring-3 [&:focus-visible]:outline-hidden ring-inset forced-colors:[&:focus-visible]:outline-2 forced-colors:[&:focus-visible]:-outline-offset-2 forced-colors:[&:focus-visible]:outline-[CanvasText] forced-colors:[&:focus-visible]:outline-solid'

/**
 * One span's row: ui-sdk's row, as deep as the span, with the rail of each
 * span it sits in, its name and duration, its bar, and the tick of a picked
 * row. It unfolds on `layout` as the span it sits in opens.
 */
function WaterfallSpanRow({ item }: Placed) {
  const { kinds, hidden, emphasis, write, bars } = useWaterfall()
  const range = use(RangeContext)
  const { value, kind, error, start, duration } = item
  const failed = error !== undefined && error !== false
  const slot = kind === undefined ? -1 : kinds.indexOf(kind)
  const bar = useCallback(
    (element: HTMLElement | null) => {
      if (element) bars.set(value, element)
      else bars.delete(value)
    },
    [bars, value],
  )

  return (
    <WaterfallRowPrimitive
      value={value}
      data-span={value}
      className={cn(
        'group/collapsible-trigger relative grid min-w-0 grid-rows-[1fr] rounded-(--control-radius-capped) select-none',
        // Indented by its depth, so its highlight and its tint start where its name does.
        'ms-[calc((var(--waterfall-level)-1)*var(--waterfall-indent))]',
        // It unfolds as the span it sits in opens and folds as it closes, never on load.
        // Less motion: it fades where it stands, and its colours still fade.
        '[transition:grid-template-rows_var(--motion-layout-duration)_var(--motion-layout-easing),opacity_var(--motion-layout-duration)_var(--motion-layout-easing),display_var(--motion-layout-duration)_allow-discrete,color_var(--motion-press-duration)_var(--motion-press-fade-easing),background-color_var(--motion-press-duration)_var(--motion-press-fade-easing),box-shadow_var(--motion-press-duration)_var(--motion-press-fade-easing)] motion-reduce:[transition:opacity_var(--motion-layout-duration)_var(--motion-layout-easing),display_var(--motion-layout-duration)_allow-discrete,color_var(--motion-press-duration)_var(--motion-press-fade-easing),background-color_var(--motion-press-duration)_var(--motion-press-fade-easing),box-shadow_var(--motion-press-duration)_var(--motion-press-fade-easing)]',
        'group-data-mounted/waterfall:starting:grid-rows-[0fr] group-data-mounted/waterfall:starting:opacity-0 [&[hidden]]:grid-rows-[0fr] [&[hidden]]:opacity-0',
        'text-foreground data-lit:[--mark-step:0]',
        focusRingClassName,
        pickedRowClassName,
        // Muted text in a tinted row is darker, so it keeps 4.5:1 on the tint.
        tintedRowTextClassName,
      )}
    >
      {({ branch, expanded, selected, level }) => (
        <>
          {/* The rail of each span it sits in, under that span's chevron, across the gap above it too. */}
          {Array.from({ length: level - 1 }, (_, up) => (
            <span
              key={up}
              aria-hidden
              className='bg-border pointer-events-none absolute -top-px bottom-0 w-px forced-colors:bg-[CanvasText]'
              style={{
                insetInlineStart: `calc(var(--control-padding) + 0.5rem - ${up + 1} * var(--waterfall-indent))`,
              }}
            />
          ))}
          {/* Clipped down only, as it folds: a narrow row's bar reaches back past its start.
              Its padding is inside, so the row folds all the way. */}
          <div className='min-h-0 min-w-0 overflow-y-clip'>
            <div
              className={cn(
                collapsibleRowClassName,
                '@max-lg/rows:flex-wrap @max-lg/rows:gap-y-0.5',
              )}
            >
              <WaterfallRowHeaderPrimitive
                className={cn(
                  'flex min-w-0 flex-1 items-start gap-2 @max-lg/rows:basis-full',
                  cellFocusRingClassName,
                )}
              >
                {branch ? (
                  // Its target grown to 24px.
                  <WaterfallIndicatorPrimitive className='relative mt-0.5 flex shrink-0 before:absolute before:-inset-x-1 before:-inset-y-1'>
                    <CollapsibleIndicator open={expanded} className='size-4' />
                  </WaterfallIndicatorPrimitive>
                ) : (
                  <span aria-hidden className='size-4 shrink-0' />
                )}
                <span className='flex min-w-0 flex-1 items-center gap-2'>
                  {/* Its own direction, so a name in another script reads and cuts short at its end, on the row's start. */}
                  <span
                    dir='auto'
                    className='min-w-0 flex-1 truncate text-left rtl:text-right'
                  >
                    {item.label}
                  </span>
                  {failed && <NoticeIcon type='error' className='h-auto' />}
                  <span
                    aria-hidden
                    dir='auto'
                    className='text-muted-foreground shrink-0 text-xs tabular-nums'
                  >
                    {write(duration)}
                  </span>
                </span>
              </WaterfallRowHeaderPrimitive>
              <WaterfallBarPrimitive
                className={cn(
                  trackClassName,
                  narrowTrackClassName,
                  'h-lh',
                  cellFocusRingClassName,
                )}
              >
                <span
                  ref={bar}
                  aria-hidden
                  data-waterfall-span-bar=''
                  data-error={failed ? '' : undefined}
                  data-hidden={
                    kind !== undefined && hidden.includes(kind) ? '' : undefined
                  }
                  data-dim={emphasis !== null && emphasis !== kind ? '' : undefined}
                  className={cn(
                    'absolute top-1/2 h-2.5 -translate-y-1/2 opacity-100',
                    // Spotlight: a bar keeps its lightness and loses colour while another span is lit.
                    'bg-(--mark-ink)',
                    stepBackInkClassName,
                    // A hidden kind keeps its outline, which forced colours keep too.
                    'data-hidden:bg-transparent data-hidden:outline-[1.5px] data-hidden:-outline-offset-[1.5px] data-hidden:outline-(--mark-color) forced-colors:data-hidden:bg-transparent!',
                    // How far through the draw it waits: into the trace, or into the span it sits in once that opens.
                    '[--waterfall-at:var(--waterfall-at-trace)] in-data-revealed:[--waterfall-at:var(--waterfall-at-opened)]',
                    // The cascade fits in one draw: a later span waits longer and draws faster.
                    '[--waterfall-delay:calc(var(--motion-draw-duration)*var(--waterfall-cascade,0.6)*var(--waterfall-at))] [--waterfall-span:calc(var(--motion-draw-duration)*(1-var(--waterfall-cascade,0.6)*var(--waterfall-at)))]',
                    // It draws from its start on `draw` once the Waterfall is in view, and as the span it sits in opens.
                    '[clip-path:inset(0_0_0_0_round_var(--bar-radius))] not-group-data-entered/waterfall:opacity-0 not-group-data-entered/waterfall:[clip-path:inset(0_100%_0_0_round_var(--bar-radius))] rtl:not-group-data-entered/waterfall:[clip-path:inset(0_0_0_100%_round_var(--bar-radius))]',
                    'group-data-entered/waterfall:[transition:clip-path_var(--waterfall-span)_var(--motion-draw-easing)_var(--waterfall-delay),opacity_var(--waterfall-span)_var(--motion-draw-easing)_var(--waterfall-delay),background-color_var(--motion-layout-duration)_var(--motion-layout-fade-easing)] motion-reduce:group-data-entered/waterfall:[transition:opacity_var(--motion-draw-duration)_var(--motion-draw-easing),background-color_var(--motion-layout-duration)_var(--motion-layout-fade-easing)] motion-reduce:[clip-path:inset(0_0_0_0_round_var(--bar-radius))]!',
                    // A span that comes in later (the span it sits in opens) draws in too, but never one there on load.
                    'group-data-mounted/waterfall:starting:opacity-0 group-data-mounted/waterfall:starting:[clip-path:inset(0_100%_0_0_round_var(--bar-radius))] rtl:group-data-mounted/waterfall:starting:[clip-path:inset(0_0_0_100%_round_var(--bar-radius))]',
                    slot === -1
                      ? 'forced-colors:bg-[CanvasText]'
                      : forcedSeriesColor(slot),
                    // Forced colours: a failed bar is hollow and dashed, apart from a hidden kind's solid outline,
                    // and a bar on a picked row takes the row's text colour, as its tint is the system's highlight.
                    'forced-colors:data-error:bg-transparent! forced-colors:data-error:outline-[1.5px] forced-colors:data-error:-outline-offset-[1.5px] forced-colors:data-error:outline-dashed forced-colors:data-error:outline-[CanvasText]',
                    'forced-colors:in-[[data-selected]]:bg-[HighlightText]! forced-colors:in-[[data-selected]]:outline-[HighlightText]! forced-colors:in-[[data-selected]]:data-error:bg-transparent! forced-colors:in-[[data-selected]]:data-hidden:bg-transparent!',
                  )}
                  style={
                    {
                      '--mark-color': failed
                        ? 'var(--destructive)'
                        : kind === undefined
                          ? 'var(--foreground)'
                          : seriesColor(kind),
                      '--bar-radius': barRadius,
                      '--waterfall-at-trace': fractionOf(start, range),
                      insetInlineStart: 'var(--waterfall-start)',
                      width:
                        'max(var(--waterfall-min-length, 2px), var(--waterfall-size))',
                    } as CSSProperties
                  }
                />
              </WaterfallBarPrimitive>
              {/* Picked shows by more than its tint: the Select's tick, in a slot kept for it. */}
              <span aria-hidden className={menuIndicatorSlot}>
                <span
                  data-ending-style={selected ? undefined : ''}
                  className={menuIndicatorClassName}
                >
                  <MenuTick />
                </span>
              </span>
            </div>
          </div>
        </>
      )}
    </WaterfallRowPrimitive>
  )
}

/**
 * The tooltip of the span under the pointer or the focus, on its bar: its
 * whole name, its kind, when it starts, how long it lasts, and what went
 * wrong. It opens at once and glides from bar to bar, as the charts' does.
 */
function WaterfallTooltip({
  className,
  ...props
}: Omit<ComponentProps<typeof ChartTooltipBox>, 'children' | 'anchor'>) {
  const { spans, config, kinds, write, messages, id, bars } = useWaterfall()
  const { active } = use(WaterfallActiveContext)
  // Escape closes it until another span is lit, or this one again.
  const [dismissed, setDismissed] = useState<string | null>(null)
  const [seen, setSeen] = useState(active)
  if (seen !== active) {
    setSeen(active)
    setDismissed(null)
  }
  // The span it last showed stays while it closes, so it fades out where it was.
  const [last, setLast] = useState<string | null>(null)
  const lit = active === null ? undefined : spans.get(active)
  if (lit !== undefined && active !== last) setLast(active)
  const shownValue = lit === undefined ? last : active
  const span = shownValue === null ? undefined : spans.get(shownValue)?.item
  const anchor = shownValue === null ? null : (bars.get(shownValue) ?? null)
  const open = lit !== undefined && dismissed !== active
  const failed = span?.error !== undefined && span.error !== false
  return (
    <GlideGroupMemory>
      <Tooltip
        open={open}
        onOpenChange={(next, details) => {
          if (next) return
          // The lit span opens and closes it; of the Tooltip's own closes, only Escape stands.
          if (details.reason === 'escape-key') setDismissed(active)
          else details.cancel()
        }}
      >
        {span && anchor && (
          <ChartTooltipBox
            side='top'
            sideOffset={8}
            anchor={anchor}
            className={cn('max-w-72 px-2.5 py-2', className)}
            {...props}
          >
            <div data-chart={id} className='grid min-w-40 gap-1'>
              <div dir='auto' className='text-start font-medium wrap-break-word'>
                {span.label}
              </div>
              {span.kind !== undefined && (
                <div className='flex items-center gap-2'>
                  <span
                    aria-hidden
                    className={cn(
                      swatchClassName,
                      forcedSeriesColor(kinds.indexOf(span.kind)),
                    )}
                    style={swatchStyle(span.kind, 'solid')}
                  />
                  <span className='text-background/75 forced-colors:text-[CanvasText]'>
                    {config[span.kind]?.label ?? span.kind}
                  </span>
                </div>
              )}
              <div className='flex items-center gap-2'>
                <span className='text-background/75 flex-1 forced-colors:text-[CanvasText]'>
                  {messages.starts}
                </span>
                <span dir='auto' className='font-medium tabular-nums'>
                  {write(span.start)}
                </span>
              </div>
              <div className='flex items-center gap-2'>
                <span className='text-background/75 flex-1 forced-colors:text-[CanvasText]'>
                  {messages.duration}
                </span>
                <span dir='auto' className='font-medium tabular-nums'>
                  {write(span.duration)}
                </span>
              </div>
              {failed && (
                <div className='border-background/20 mt-0.5 border-t pt-1 wrap-break-word forced-colors:border-[CanvasText]'>
                  {span.error === true ? messages.failed : span.error}
                </div>
              )}
            </div>
          </ChartTooltipBox>
        )}
      </Tooltip>
    </GlideGroupMemory>
  )
}

/**
 * How far into `span` a time falls, from 0 to 1: where a pill sits on the
 * axis, and how far through its draw a span's bar waits, as far as it starts
 * into the span it sits in (or the trace), so the spans replay in the order
 * they ran.
 */
function fractionOf(time: number, span: Span): number {
  const length = span[1] - span[0]
  if (length <= 0) return 0
  return Math.min(1, Math.max(0, (time - span[0]) / length))
}

/**
 * Whether a tick's label steps aside for the pill: each is a label `width`
 * px wide centred on its fraction of an axis `length` px long and kept
 * inside it, and they would come too close.
 */
function tickCovered(
  tick: number,
  tickWidth: number,
  pill: number,
  pillWidth: number,
  length: number,
): boolean {
  if (length <= 0) return false
  return labelsMeet(labelBox(tick, tickWidth, length), labelBox(pill, pillWidth, length))
}

/**
 * The span a row that has just come into view is timed against: the nearest
 * one above it that already showed, which is the span that opened, so its
 * children that open with it draw in the order they ran inside it.
 */
function openedBy(
  value: string,
  upOf: (value: string) => string | null,
  shown: ReadonlySet<string>,
): string | null {
  let up = upOf(value)
  while (up !== null && !shown.has(up)) up = upOf(up)
  return up
}

/** How many px a box's scrollbar takes beside its content, from its outer and inner widths. */
function scrollbarRoom(offsetWidth: number, clientWidth: number): number {
  return Math.max(0, offsetWidth - clientWidth)
}

/** Whether a box, top to bottom, shows any of itself between `top` and `bottom`. */
function inSight(
  box: { top: number; bottom: number },
  top: number,
  bottom: number,
): boolean {
  return box.bottom > top && box.top < bottom
}

export { Waterfall, WaterfallLegend, WaterfallList, WaterfallTooltip }
export { fractionOf, inSight, openedBy, scrollbarRoom, tickCovered }
export type { WaterfallItem, WaterfallMessages }
