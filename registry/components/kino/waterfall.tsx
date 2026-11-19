'use client'

import { useSpinner } from '@/registry/components/kino/spinner'
import { TooltipPopup } from '@/registry/components/kino/tooltip'
import { Tree, TreeItem } from '@/registry/components/kino/tree'
import { useAnnouncer } from '@/registry/lib/announce'
import {
  type ChartFormat,
  ChartLegendToggles,
  ChartStyle,
  forcedSeriesColor,
  formatterOf,
  seriesColor,
  swatchStyle,
  useEntered,
} from '@/registry/lib/chart-core'
import {
  type ChartConfig,
  fractionOf,
  type Span,
  labelBox,
  labelLength,
  labelsMeet,
  labelStep,
  tickCountFor,
  valueScale,
  type ValueScale,
} from '@/registry/lib/chart-math'
import { useControllable } from '@/registry/lib/controllable'
import { GlideGroupMemory } from '@/registry/lib/glide'
import {
  highlightStep,
  type HighlightState,
  type HighlightStep,
} from '@/registry/lib/highlight'
import { NoticeIcon } from '@/registry/lib/notice'
import {
  placeholderBreatheClassName,
  placeholderFillClassName,
} from '@/registry/lib/placeholder'
import { markMounted, mergeRefs } from '@/registry/lib/refs'
import { Roll } from '@/registry/lib/roll'
import { edgeFadeClassName, followEdges } from '@/registry/lib/scroll'
import { Tooltip as TooltipPrimitive } from '@base-ui/react/tooltip'
import {
  type ComponentProps,
  createContext,
  type CSSProperties,
  type ReactNode,
  type Ref,
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
 * A trace, or a page's requests, as bars on one time axis: each span is a
 * row of the Tree, so it opens to show the spans inside it, and its bar sits
 * where it ran. It is the Bar chart's sibling: the span under the pointer or
 * the focus stays bright while the rest step back, a pill glides along the
 * axis to where it starts, and a tooltip and a legend read as the charts'.
 */

/** What the Waterfall writes, for a page in another language. */
interface WaterfallMessages {
  /** The heading over the spans' names. */
  span: string
  /** The heading over their durations. */
  duration: string
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
  starts: 'Starts',
  failed: 'Failed',
  kinds: 'Services',
  empty: 'No spans to show',
  loading: 'Loading spans',
  loaded: 'Spans loaded',
  times: (start, duration) => `starts at ${start}, lasts ${duration}`,
}

interface SpanInfo {
  label: ReactNode
  start: number
  duration: number
  kind: string | undefined
  error: ReactNode
  bar: HTMLElement | null
}

interface WaterfallContextValue {
  id: string
  config: ChartConfig
  kinds: readonly string[]
  scale: ValueScale
  write: (value: number) => string
  hidden: readonly string[]
  setHidden: (hidden: string[]) => void
  emphasis: string | null
  setEmphasis: (kind: string | null) => void
  entered: boolean
  messages: WaterfallMessages
  /** Every span shown, by `value`, for the tooltip and the axis's pill. */
  spans: Map<string, SpanInfo>
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
 * What changes as the pointer moves, apart from what the spans read, so a
 * span lit or the axis measured re-renders only the axis and the tooltip.
 */
const WaterfallActiveContext = createContext<{
  /** The span under the pointer, the focus or the last touch. */
  active: string | null
  /** How wide the bars' column is, in pixels; 0 before it is measured. */
  trackWidth: number
}>({ active: null, trackWidth: 0 })

/**
 * The span a child sits in, so it draws in when its parent opens in the order
 * the spans ran, and how deep the child is: 0 at the top.
 */
const ParentContext = createContext<{
  span: Span
  depth: number
  /** What the parent's own draw is timed against. */
  within: Span | null
  /** Whether the parent was already shown, so a child that mounts now came as it opened. */
  shown: boolean
} | null>(null)

/** How many ticks the axis marks at most. */
const TICKS = 6
/** The least room a tick's label needs, in pixels. */
const TICK_SPACING = 72

/**
 * The trace: what its spans are measured against, the colour of each kind
 * of span, and how times are written. Holds a `WaterfallLegend` and a
 * `WaterfallList`.
 */
function Waterfall({
  duration,
  config = {},
  format = { style: 'unit', unit: 'millisecond', maximumFractionDigits: 1 },
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
}: ComponentProps<'div'> & {
  /** How long the trace lasts, in the units of the spans' `start` and `duration`. The axis ends there. */
  duration: number
  /** Each kind of span by its `kind`: its name and colour, as a chart's series. */
  config?: ChartConfig
  /** How times are written: in milliseconds by default. */
  format?: ChartFormat
  locale?: Intl.LocalesArgument
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
}) {
  const id = `waterfall-${useId().replace(/[^a-zA-Z0-9-]/g, '')}`
  const rootRef = useRef<HTMLDivElement>(null)
  const kinds = useMemo(() => Object.keys(config), [config])
  const [hidden, setHiddenNow] = useControllable(
    hiddenKinds,
    defaultHiddenKinds,
    onHiddenKindsChange,
  )
  // One function for the life of the Waterfall, so the spans' context holds still as the
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
  const [spans] = useState(() => new Map<string, SpanInfo>())
  const messages = useMemo(() => ({ ...defaultMessages, ...ownMessages }), [ownMessages])
  const write = useMemo(() => formatterOf(locale, format), [format, locale])
  // The trace's own length is the axis's end, so its bars use the whole track.
  const scale = useMemo(
    () =>
      valueScale([0, duration], {
        domain: [0, duration],
        tickCount: tickCountFor(TICKS, width, TICK_SPACING),
      }),
    [duration, width],
  )
  const context = useMemo(
    () => ({
      id,
      config,
      kinds,
      scale,
      write,
      hidden,
      setHidden,
      emphasis,
      setEmphasis,
      entered,
      messages,
      spans,
      setActive,
      setTrackWidth: setWidth,
    }),
    [
      id,
      config,
      kinds,
      scale,
      write,
      hidden,
      setHidden,
      emphasis,
      entered,
      messages,
      spans,
    ],
  )
  const live = useMemo(() => ({ active, trackWidth: width }), [active, width])

  return (
    <WaterfallContext value={context}>
      <WaterfallActiveContext value={live}>
        <ChartStyle id={id} config={config} series={kinds} />
        <div
          ref={mergeRefs(rootRef, ref, markMounted)}
          data-slot='waterfall'
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
      data-slot='waterfall-legend'
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
  '@max-lg/tree:h-3 @max-lg/tree:w-[calc(100cqw-2*var(--control-padding)-1.5rem)] @max-lg/tree:ms-[calc(var(--waterfall-depth)*var(--waterfall-indent)*-1)]'

/** The axis and the grid in a narrow list: the bars' column alone, as wide as the rows'. */
const narrowColumnClassName = '@max-lg:w-[calc(100cqw-2*var(--control-padding)-1.5rem)]'

/** The room the Tree keeps for the tick of a picked row, so the axis lines up with the bars. */
const tickRoomClassName = 'size-4 shrink-0'

/**
 * The spans, as a Tree under a time axis that stays in view as they scroll.
 * Give it a height (`max-h-96`) to scroll a long trace. `className` and
 * `style` go to its box; the rest are the Tree's: `expanded` and `value`
 * with their defaults and callbacks.
 */
function WaterfallList({
  className,
  style,
  children,
  loading = false,
  ...props
}: ComponentProps<typeof Tree> & {
  /** Shows a placeholder while the spans load, after a moment, and for long enough to read. */
  loading?: boolean
}) {
  const { messages, setActive, spans } = useWaterfall()
  const rootRef = useRef<HTMLDivElement>(null)
  const scrollerRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const waiting = useSpinner(loading)
  const [hasSpans, setHasSpans] = useState(true)
  const { announce, region } = useAnnouncer()

  useEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller) return
    const root = rootRef.current
    const stopEdges = followEdges(scroller, '--scroll-fade')
    // The room the scrollbar takes, which the axis keeps clear: none where scrollbars float.
    const gutter = () =>
      root?.style.setProperty(
        '--waterfall-gutter',
        `${scrollbarRoom(scroller.offsetWidth, scroller.clientWidth)}px`,
      )
    gutter()
    const resized = new ResizeObserver(gutter)
    resized.observe(scroller)
    if (listRef.current) resized.observe(listRef.current)
    return () => {
      stopEdges()
      resized.disconnect()
    }
  }, [])

  // Whether any span shows, from what rendered, so spans drawn by a component of your own
  // count as well as those written out.
  useLayoutEffect(() => {
    const list = listRef.current
    if (!list) return
    const check = () => setHasSpans(list.querySelector('[role=treeitem]') !== null)
    check()
    const observer = new MutationObserver(check)
    observer.observe(list, { subtree: true, childList: true })
    return () => observer.disconnect()
    // Checked again before the paint as the spans replace the placeholder, so the empty
    // message never shows for a frame on the way.
  }, [waiting])

  const wasWaiting = useRef(waiting)
  useEffect(() => {
    if (waiting === wasWaiting.current) return
    wasWaiting.current = waiting
    const shown = listRef.current?.querySelector('[role=treeitem]') != null
    announce(waiting ? messages.loading : shown ? messages.loaded : messages.empty)
  })

  // The span lit for the tooltip, the pill and Spotlight: the one the Tree's highlight is on,
  // or else the one last pressed by touch, which has no highlight. None while it has scrolled
  // out of sight.
  useEffect(() => {
    const scroller = scrollerRef.current
    const list = listRef.current
    if (!scroller || !list) return
    let glided: string | null = null
    let touched: string | null = null
    const sync = () => {
      const lit = glided ?? touched
      const bar = lit === null ? null : (spans.get(lit)?.bar ?? null)
      const view = scroller.getBoundingClientRect()
      const seen =
        bar !== null && inSight(bar.getBoundingClientRect(), view.top, view.bottom)
      const next = seen ? lit : null
      // Spotlight reads the lit row from the page, so no span re-renders as the pointer moves.
      for (const row of list.querySelectorAll('[data-lit]')) {
        if (row.getAttribute('data-value') !== next) row.removeAttribute('data-lit')
      }
      if (next !== null) bar?.closest('[role=treeitem]')?.setAttribute('data-lit', '')
      // Set here rather than found with `:has()`, which would restyle every bar on each move.
      list.toggleAttribute('data-spotlit', next !== null)
      setActive(next)
    }
    const observer = new MutationObserver(() => {
      glided =
        list.querySelector<HTMLElement>('[role=treeitem][data-glided]')?.dataset.value ??
        null
      sync()
    })
    observer.observe(list, { subtree: true, attributeFilter: ['data-glided'] })
    const press = (event: PointerEvent) => {
      if (event.pointerType !== 'touch') return
      const row =
        event.target instanceof Element && list.contains(event.target)
          ? event.target.closest<HTMLElement>('[role=treeitem]')
          : null
      touched = row?.dataset.value ?? null
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
  }, [setActive, spans])

  return (
    // The axis sits over the box that scrolls, not in it, so it needs no background of its own
    // to hide the rows, whatever the Waterfall sits on. It keeps the scrollbar's room at its
    // end, so its column lines up with the rows'.
    <div
      ref={rootRef}
      data-slot='waterfall-list'
      className={cn('flex min-h-0 flex-col overflow-hidden', className)}
      style={style}
    >
      <div className='@container min-w-0 shrink-0 border-b me-(--waterfall-gutter,0px)'>
        <WaterfallAxis />
      </div>
      <div
        ref={scrollerRef}
        className={cn(
          'scrollbar-thin relative min-h-0 flex-1 overflow-y-auto overscroll-contain',
          edgeFadeClassName,
        )}
      >
        {/* While a span is lit, every other bar steps back; the lit row sets it back to 0. */}
        <div
          ref={listRef}
          className='@container relative min-w-0 [--waterfall-indent:1.5rem] @max-xs:[--waterfall-indent:1rem] data-spotlit:[--waterfall-spot:1]'
        >
          {!waiting && (hasSpans || loading) && <WaterfallGrid />}
          {waiting ? (
            <WaterfallPlaceholder />
          ) : (
            <>
              <Tree className='relative' {...props}>
                {children}
              </Tree>
              {/* Loading with no spans yet is loading, never empty, while the placeholder waits to show. */}
              {!hasSpans && !loading && (
                <p className='text-muted-foreground px-(--control-padding) py-8 text-center'>
                  {messages.empty}
                </p>
              )}
            </>
          )}
        </div>
      </div>
      {region}
    </div>
  )
}

/** The columns the axis and the grid share with every row: the names, the bars, the tick's room. */
function Columns({
  className,
  name,
  stack = false,
  track,
  trackRef,
}: {
  className?: string
  name?: ReactNode
  /** In a narrow list, the name keeps a line of its own over the bar, as a span's row does. */
  stack?: boolean
  track: ReactNode
  trackRef?: Ref<HTMLDivElement>
}) {
  return (
    <div className={cn('flex gap-2 px-(--control-padding)', className)}>
      <div
        className={cn(
          'flex min-w-0 flex-1 items-center gap-2',
          stack ? '@max-lg:basis-full' : '@max-lg:hidden',
        )}
      >
        {name}
      </div>
      <div
        ref={trackRef}
        className={cn(trackClassName, narrowColumnClassName, '@container/track')}
      >
        {track}
      </div>
      <span className={tickRoomClassName} />
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

/**
 * The time axis, over the spans and in view as they scroll: a label at each
 * tick, and a pill that glides to where the span under the pointer starts,
 * with the labels it would cover stepping aside.
 */
function WaterfallAxis() {
  const { scale, write, messages, spans, setTrackWidth } = useWaterfall()
  const { active, trackWidth } = use(WaterfallActiveContext)
  const trackRef = useRef<HTMLDivElement>(null)
  const start = active === null ? null : (spans.get(active)?.start ?? null)
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

  useLayoutEffect(() => {
    const track = trackRef.current
    if (!track) return
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setTrackWidth(entry.contentRect.width)
    })
    observer.observe(track)
    return () => observer.disconnect()
  }, [setTrackWidth])

  const shown = pill.state === 'shown'
  const pillAt = pill.at === null ? null : fractionOf(pill.at, scale.domain)
  const pillText = pill.at === null ? '' : write(pill.at)
  const roomOf = (text: string) => labelLength(text)
  // Every few ticks keep a label when they all would crowd.
  const every = labelStep(
    scale.ticks.length,
    trackWidth,
    Math.max(...scale.ticks.map((tick) => roomOf(write(tick)))) + 8,
  )
  const covered = (tick: number) =>
    shown &&
    pillAt !== null &&
    tickCovered(
      fractionOf(tick, scale.domain),
      roomOf(write(tick)),
      pillAt,
      roomOf(pillText),
      trackWidth,
    )

  return (
    <Columns
      className='text-muted-foreground h-(--control-height) items-center text-xs [&_[data-slot=waterfall-heading]]:font-medium'
      name={
        <>
          <span data-slot='waterfall-heading' className='flex-1 truncate ps-6'>
            {messages.span}
          </span>
          <span data-slot='waterfall-heading' className='shrink-0'>
            {messages.duration}
          </span>
        </>
      }
      trackRef={trackRef}
      track={
        <div
          aria-hidden
          className='absolute inset-0 rtl:[--waterfall-flip:-1] [&>*]:absolute [&>*]:top-1/2'
        >
          {/* No labels until the axis is measured, so none fade out on load. */}
          {trackWidth > 0 &&
            scale.ticks.map((tick, at) => (
              <span
                key={tick}
                data-covered={covered(tick) || at % every !== 0 ? '' : undefined}
                className='px-0.5 tabular-nums transition-opacity duration-(--motion-layout-duration) ease-(--motion-layout-easing) data-covered:opacity-0'
                style={placeAt(fractionOf(tick, scale.domain))}
              >
                <bdi>{write(tick)}</bdi>
              </span>
            ))}
          <span
            data-slot='waterfall-pill'
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
        </div>
      }
    />
  )
}

/** The lines down the bars' column at each tick, behind the rows. */
function WaterfallGrid() {
  const { scale } = useWaterfall()
  return (
    <Columns
      className='pointer-events-none absolute inset-0'
      track={
        <div aria-hidden className='absolute inset-0'>
          {scale.ticks.map((tick) => (
            <span
              key={tick}
              data-edge={tick === scale.domain[0] ? '' : undefined}
              className='border-border absolute inset-y-0 border-s border-dashed data-edge:border-solid forced-colors:border-[GrayText]'
              style={{ insetInlineStart: `${fractionOf(tick, scale.domain) * 100}%` }}
            />
          ))}
        </div>
      }
    />
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
      data-slot='waterfall-placeholder'
      className={placeholderBreatheClassName}
    >
      {rows.map(([from, size, name], at) => (
        <Columns
          key={at}
          stack
          className='min-h-(--control-height) items-center @max-lg:flex-wrap @max-lg:gap-y-1 @max-lg:py-2'
          name={
            <span
              className={cn('h-2 rounded-full', placeholderFillClassName)}
              style={{ width: `${name}ch`, marginInlineStart: at === 0 ? 0 : '1.5rem' }}
            />
          }
          track={
            <span
              className={cn(
                'absolute top-1/2 h-2.5 -translate-y-1/2 rounded-(--control-radius-xs)',
                placeholderFillClassName,
              )}
              style={{ insetInlineStart: `${from * 100}%`, width: `${size * 100}%` }}
            />
          }
        />
      ))}
    </div>
  )
}

/** The corner of a bar, never more than half its thickness. */
const barRadius = 'min(var(--waterfall-radius,var(--control-radius-xs)),0.3125rem)'

/**
 * One span: a row of the Tree, with its name, its duration and its bar.
 * With `children`, each a `WaterfallSpan`, it opens to show the spans inside
 * it, whose bars draw in from their starts in the order they ran.
 */
function WaterfallSpan({
  value,
  label,
  start,
  duration,
  kind,
  error,
  icon,
  className,
  children,
  ...props
}: Omit<ComponentProps<typeof TreeItem>, 'label' | 'aside'> & {
  /** What the row names it. Its text is what typing a name finds. */
  label: ReactNode
  /** When it starts, from the trace's start. */
  start: number
  /** How long it lasts. */
  duration: number
  /** Its kind, a key of the Waterfall's `config`, which colours its bar. */
  kind?: string
  /** It failed: `true`, or what went wrong, which its tooltip shows. */
  error?: ReactNode
}) {
  const waterfall = useWaterfall()
  const { scale, write, kinds, config, hidden, emphasis, spans, messages } = waterfall
  const parent = use(ParentContext)
  const depth = parent === null ? 0 : parent.depth + 1
  const barRef = useRef<HTMLSpanElement>(null)
  const failed = error !== undefined && error !== false && error !== null
  const slot = kind === undefined ? -1 : kinds.indexOf(kind)
  const [from, to] = [
    fractionOf(start, scale.domain),
    fractionOf(start + duration, scale.domain),
  ]
  // A span that comes as its parent opens draws in the order it ran inside the parent; one that
  // comes with its parent (the trace arriving) draws in the order it ran in the trace, so no
  // span draws ahead of its parent.
  const [late] = useState(() => parent?.shown ?? false)
  const within = late ? (parent?.span ?? null) : (parent?.within ?? null)
  const delay = drawDelay(start, within ?? scale.domain)
  // Shown a frame after its first paint, as `markMounted` marks a component.
  const [shown, setShown] = useState(false)
  useEffect(() => {
    const frame = requestAnimationFrame(() => setShown(true))
    return () => cancelAnimationFrame(frame)
  }, [])

  useEffect(() => {
    spans.set(value, { label, start, duration, kind, error, bar: barRef.current })
    return () => {
      spans.delete(value)
    }
  })

  const startText = write(start)
  const durationText = write(duration)

  return (
    <TreeItem
      value={value}
      icon={icon}
      className={cn(
        'data-lit:[--waterfall-spot:0] @max-lg/tree:flex-wrap @max-lg/tree:gap-y-0.5',
        className,
      )}
      label={
        <span className='flex min-w-0 items-center gap-2'>
          {/* Its own direction, so a name in another script reads and cuts short at its end, on the row's start. */}
          <span dir='auto' className='min-w-0 flex-1 truncate text-left rtl:text-right'>
            {label}
          </span>
          {failed && (
            <NoticeIcon
              type='error'
              className='h-auto [&_svg:not([class*=size-])]:size-3.5'
            />
          )}
          <span
            aria-hidden
            dir='auto'
            className='text-muted-foreground shrink-0 text-xs tabular-nums'
          >
            {durationText}
          </span>
          {/* What a screen reader hears after the name: the service, the times and what went wrong. */}
          <span className='sr-only'>
            {kind !== undefined && <>, {config[kind]?.label ?? kind}</>}
            {', '}
            {messages.times(startText, durationText)}
            {failed &&
              (error === true ? (
                <>, {messages.failed}</>
              ) : (
                <>
                  , {messages.failed}: {error}
                </>
              ))}
          </span>
        </span>
      }
      aside={
        <span
          aria-hidden
          data-slot='waterfall-track'
          className={cn(trackClassName, narrowTrackClassName, 'h-lh')}
          style={{ '--waterfall-depth': depth } as CSSProperties}
        >
          <span
            ref={barRef}
            data-slot='waterfall-bar'
            data-error={failed ? '' : undefined}
            data-hidden={kind !== undefined && hidden.includes(kind) ? '' : undefined}
            data-dim={emphasis !== null && emphasis !== kind ? '' : undefined}
            className={cn(
              'absolute top-1/2 h-2.5 -translate-y-1/2 opacity-100',
              // Spotlight: a bar keeps its lightness and loses colour while another span is lit.
              'bg-[oklch(from_var(--bar-color)_l_calc(c*(1-var(--waterfall-spot,0)*(1-var(--waterfall-dim,0.3))))_h)] data-dim:[--waterfall-spot:1]',
              // A hidden kind keeps its outline, which forced colours keep too.
              'data-hidden:bg-transparent data-hidden:outline-[1.5px] data-hidden:-outline-offset-[1.5px] data-hidden:outline-(--bar-color) forced-colors:data-hidden:bg-transparent!',
              // It draws from its start on `draw` once the Waterfall is in view, and as its parent opens.
              '[clip-path:inset(0_0_0_0_round_var(--bar-radius))] not-group-data-entered/waterfall:opacity-0 not-group-data-entered/waterfall:[clip-path:inset(0_100%_0_0_round_var(--bar-radius))] rtl:not-group-data-entered/waterfall:[clip-path:inset(0_0_0_100%_round_var(--bar-radius))]',
              'group-data-entered/waterfall:[transition:clip-path_var(--waterfall-span)_var(--motion-draw-easing)_var(--waterfall-delay),opacity_var(--waterfall-span)_var(--motion-draw-easing)_var(--waterfall-delay),background-color_var(--motion-layout-duration)_var(--motion-layout-fade-easing)] motion-reduce:group-data-entered/waterfall:[transition:opacity_var(--motion-draw-duration)_var(--motion-draw-easing),background-color_var(--motion-layout-duration)_var(--motion-layout-fade-easing)] motion-reduce:[clip-path:inset(0_0_0_0_round_var(--bar-radius))]!',
              // A span that comes in later (its parent opens) draws in too, but never one there on load.
              'group-data-mounted/waterfall:starting:opacity-0 group-data-mounted/waterfall:starting:[clip-path:inset(0_100%_0_0_round_var(--bar-radius))] rtl:group-data-mounted/waterfall:starting:[clip-path:inset(0_0_0_100%_round_var(--bar-radius))]',
              slot === -1 ? 'forced-colors:bg-[CanvasText]' : forcedSeriesColor(slot),
              // Forced colours: a failed bar is hollow and dashed, apart from a hidden kind's solid outline,
              // and a bar on a picked row takes the row's text colour, as its tint is the system's highlight.
              'forced-colors:data-error:bg-transparent! forced-colors:data-error:outline-[1.5px] forced-colors:data-error:-outline-offset-[1.5px] forced-colors:data-error:outline-dashed forced-colors:data-error:outline-[CanvasText]',
              'forced-colors:in-[[data-selected]]:bg-[HighlightText]! forced-colors:in-[[data-selected]]:outline-[HighlightText]! forced-colors:in-[[data-selected]]:data-error:bg-transparent! forced-colors:in-[[data-selected]]:data-hidden:bg-transparent!',
            )}
            style={
              {
                '--bar-color': failed
                  ? 'var(--destructive)'
                  : kind === undefined
                    ? 'var(--foreground)'
                    : seriesColor(kind),
                '--bar-radius': barRadius,
                // The cascade fits in one draw: a later span waits longer and draws faster.
                '--waterfall-delay': `calc(var(--motion-draw-duration) * var(--waterfall-cascade, 0.6) * ${delay})`,
                '--waterfall-span': `calc(var(--motion-draw-duration) * (1 - var(--waterfall-cascade, 0.6) * ${delay}))`,
                insetInlineStart: `${from * 100}%`,
                width: `max(var(--waterfall-min-length, 2px), ${(to - from) * 100}%)`,
              } as CSSProperties
            }
          />
        </span>
      }
      {...props}
    >
      {children === undefined ? undefined : (
        <ParentContext value={{ span: [start, start + duration], depth, within, shown }}>
          {children}
        </ParentContext>
      )}
    </TreeItem>
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
}: Omit<ComponentProps<typeof TooltipPopup>, 'children' | 'anchor'>) {
  const { spans, config, kinds, write, messages, id } = useWaterfall()
  const { active } = use(WaterfallActiveContext)
  // Escape closes it until another span is lit, or this one again.
  const [dismissed, setDismissed] = useState<string | null>(null)
  const [seen, setSeen] = useState(active)
  if (seen !== active) {
    setSeen(active)
    setDismissed(null)
  }
  // The span it last showed stays while it closes, so it fades out where it was.
  const [last, setLast] = useState<SpanInfo | undefined>(undefined)
  const lit = active === null ? undefined : spans.get(active)
  if (lit !== undefined && lit !== last) setLast(lit)
  const span = lit ?? last
  const open = lit !== undefined && dismissed !== active
  const failed = span?.error !== undefined && span.error !== false && span.error !== null
  return (
    <GlideGroupMemory>
      <TooltipPrimitive.Root
        open={open}
        onOpenChange={(next, details) => {
          if (!next && details.reason === 'escape-key') setDismissed(active)
        }}
        disableHoverablePopup
      >
        {span && (
          <TooltipPopup
            side='top'
            sideOffset={8}
            anchor={span.bar}
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
                      'size-2 shrink-0 rounded-[calc(var(--control-radius-xs)/4)] bg-(--swatch)',
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
          </TooltipPopup>
        )}
      </TooltipPrimitive.Root>
    </GlideGroupMemory>
  )
}

/**
 * How far through its draw a span's bar waits, from 0 to 1: as far as it
 * starts into `within`, the span it sits in (or the trace), so the spans
 * replay in the order they ran.
 */
function drawDelay(start: number, within: Span): number {
  const length = within[1] - within[0]
  if (length <= 0) return 0
  return Math.min(1, Math.max(0, (start - within[0]) / length))
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

export { Waterfall, WaterfallLegend, WaterfallList, WaterfallSpan, WaterfallTooltip }
export { drawDelay, inSight, scrollbarRoom, tickCovered }
export type { WaterfallMessages }
