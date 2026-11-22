'use client'

import { AnimatedNumber } from '@/registry/components/kino/animated-number'
import { Button } from '@/registry/components/kino/button'
import {
  CategoryChartFrame,
  type CategoryChartProps,
  type ChartCategory,
  figureProps,
  useCategoryChart,
  useChart,
  useChartActive,
} from '@/registry/lib/chart-core'
import {
  cascadeAt,
  type ChartDatum,
  numberOf,
  type ReadingDirection,
} from '@/registry/lib/chart-math'
import {
  ChartNumber,
  type ChartFormat,
  type ChartMessages,
  seriesColor,
} from '@/registry/lib/chart-root'
import { bandAt } from '@/registry/lib/chart-scale'
import { useControllable } from '@/registry/lib/controllable'
import { CutTooltip } from '@/registry/lib/cut'
import { useFlow } from '@/registry/lib/flow'
import {
  placeholderBreatheClassName,
  placeholderFillClassName,
} from '@/registry/lib/placeholder'
import { mergeRefs } from '@/registry/lib/refs'
import { sameOrder } from '@/registry/lib/sort'
import { mergeProps } from '@base-ui/react/merge-props'
import { useRender } from '@base-ui/react/use-render'
import {
  type ComponentProps,
  type CSSProperties,
  type FocusEvent,
  memo,
  type PointerEvent,
  type ReactElement,
  type ReactNode,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import { cn } from '@/lib/utils'

/*
 * The Bar list: a ranked list with a bar behind each row, as long as its
 * value against the largest, such as a site's top pages. Each row writes its
 * value, so there is no tooltip: the row under the pointer or the focus stays
 * bright while the rest step back. A row can be a link or a pick. New values
 * swap the rows into their new order where they are, roll each value and
 * slide each bar to its new length; rows past `limit` wait behind Show more.
 */

/** Every word the list says, the chart's and its Show more button's. */
interface BarListMessages extends ChartMessages {
  /** The button that shows the rows past `limit`, with how many there are. */
  showMore: (count: number) => string
  /** The same button once they show. */
  showLess: string
}

/** How the rows are ordered: largest first, smallest first, or as the data has them. */
type BarListSort = 'descending' | 'ascending' | 'none'

interface BarListProps extends Omit<
  CategoryChartProps,
  | 'ordered'
  | 'tickCount'
  | 'tickValues'
  | 'allowDecimals'
  | 'patterns'
  | 'hiddenSeries'
  | 'defaultHiddenSeries'
  | 'onHiddenSeriesChange'
  | 'messages'
  | 'color'
> {
  /** How the rows are ordered; largest first by default. */
  sort?: BarListSort
  /** A picture before each row's name, such as a site's icon or a flag, sized by the row. */
  icon?: (row: ChartDatum) => ReactNode
  /** Where each row leads: with one, the row is a link. */
  href?: (row: ChartDatum) => string | undefined
  /** The element a row's link renders, such as your router's `Link`, which takes the row's `href`. */
  linkRender?: ReactElement
  /** A row's own bar colour, in place of the config's. */
  color?: (row: ChartDatum, index: number) => string | undefined
  /** Writes each row's share of the total after its value. */
  share?: boolean
  /** How many rows show until Show more is pressed; every row by default. */
  limit?: number
  /** Whether the rows past `limit` show, for a list you control. */
  expanded?: boolean
  defaultExpanded?: boolean
  onExpandedChange?: (expanded: boolean) => void
  /**
   * How the bars arrive the first time the list comes into view: growing
   * from the start one after another, or simply there, the default, since a
   * page that loads doesn't animate into place.
   */
  entrance?: 'draw' | 'none'
  /** Every word the list says or reads out, for a list in another language. */
  messages?: Partial<BarListMessages>
}

const barListKeys = [
  'sort',
  'icon',
  'href',
  'linkRender',
  'color',
  'share',
  'limit',
  'expanded',
  'defaultExpanded',
  'onExpandedChange',
  'entrance',
]

/** How long the placeholder's bars are, as fractions of the row: a typical ranking, knowing nothing of the data. */
const PLACEHOLDER_LENGTHS = [0.92, 0.7, 0.54, 0.4, 0.3] as const

/** What a row shows, worked out once by the root. */
interface BarListRowData {
  category: ChartCategory
  /** Its place in the list, from the top. */
  rank: number
  value: number | null
  /** Its share of the total, from 0 to 1. */
  share: number
  clip: string
  from: string
  color: string
  icon: ReactNode
  href: string | undefined
  delay: string | undefined
}

/**
 * The list's root: it orders the rows, scales the bars to the largest value
 * (or the end of `domain`), and lays out the frame its rows draw in.
 */
function BarList(props: BarListProps) {
  const {
    config,
    sort = 'descending',
    icon,
    href,
    linkRender,
    color,
    share = false,
    limit,
    expanded: expandedProp,
    defaultExpanded = false,
    onExpandedChange,
    entrance = 'none',
    messages,
    description,
    empty,
    className,
    ref,
  } = props
  const dataKey = Object.keys(config)[0] ?? ''
  const { showMore, showLess, ...chartMessages } = messages ?? {}
  const { chart, placeholder, fromPlaceholder, phase } = useCategoryChart(
    {
      ...props,
      color: undefined,
      messages: { empty: 'No data yet', ...chartMessages },
    },
    {
      orientation: 'horizontal',
      stack: 'none',
      entrance: entrance !== 'none',
      cascade: { variable: '--bar-list-cascade', fallback: 0.8 },
      nice: false,
      heightFromData: true,
      bandOf: (at, count) => bandAt(at, count),
      measure: (rows) => ({
        extent: [
          0,
          Math.max(0, ...rows.map((row) => Math.max(0, numberOf(row[dataKey]) ?? 0))),
        ] as const,
      }),
    },
  )
  const [expanded, setExpanded] = useControllable(
    expandedProp,
    defaultExpanded,
    onExpandedChange,
  )
  const listId = `${useId()}-rows`

  const values = chart.current.map((category) => numberOf(category.datum[dataKey]))
  const order = barListOrder(values, sort)
  const shares = barListShares(values)
  const most = limit === undefined ? order.length : Math.max(0, Math.floor(limit))
  const shownCount = expanded ? order.length : Math.min(order.length, most)
  const waiting = phase === 'waiting'
  const drawing = phase === 'entering'
  const rows: BarListRowData[] = order.slice(0, shownCount).map((at, rank) => {
    const category = chart.current[at]!
    const value = values[at] ?? null
    const fraction =
      value === null || value <= 0 ? 0 : chart.frame.y.value.scale.place(value)
    const zero = barListClip(0, chart.direction)
    const startAt = PLACEHOLDER_LENGTHS[Math.min(rank, PLACEHOLDER_LENGTHS.length - 1)]!
    return {
      category,
      rank,
      value,
      share: shares[at] ?? 0,
      clip: waiting ? zero : barListClip(fraction, chart.direction),
      // A bar that arrives grows out of the placeholder in its place, or from the start.
      from: fromPlaceholder ? barListClip(startAt, chart.direction) : zero,
      color: color?.(category.datum, at) ?? seriesColor(dataKey),
      icon: icon?.(category.datum),
      href: href?.(category.datum),
      delay: drawing
        ? `calc(var(--motion-draw-duration) * var(--bar-list-cascade, 0.8) * ${cascadeAt(rank, shownCount)})`
        : undefined,
    }
  })
  const hiddenCount = order.length - Math.min(order.length, most)

  // Rows that swap places move in the DOM, and a moved element is styled
  // afresh, so its bar's slide would be lost. New values first land on the
  // rows where they are, so each bar's slide is running, then the rows move,
  // taking their slides with them.
  const keys = rows.map((row) => row.category.key)
  const [placed, setPlaced] = useState(keys)
  const shown = barListPlacing(placed, keys)
  const settled = sameOrder(shown, keys)
  if (settled && !sameOrder(placed, keys)) setPlaced(keys)
  const keysKey = keys.join('\u0000')
  useEffect(() => {
    if (settled) return
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => setPlaced(keysKey.split('\u0000')))
    })
    return () => cancelAnimationFrame(frame)
  }, [settled, keysKey])
  const byKey = new Map(rows.map((row) => [row.category.key, row]))
  const placedRows = settled ? rows : shown.map((key) => byKey.get(key)!)

  return (
    <CategoryChartFrame
      chart={{ ...chart, pointOf: () => null }}
      ref={ref}
      slot='bar-list'
      description={description}
      empty={empty}
      browse={false}
      className={cn('h-auto min-h-(--control-height) text-sm', className)}
      placeholder={
        placeholder && (
          <BarListPlaceholder
            count={Math.min(
              limit ?? PLACEHOLDER_LENGTHS.length,
              PLACEHOLDER_LENGTHS.length,
            )}
          />
        )
      }
      {...figureProps({ ...props, color: undefined }, barListKeys)}
    >
      <BarListRows
        id={listId}
        rows={placedRows}
        dataKey={dataKey}
        share={share}
        linkRender={linkRender}
        entering={drawing}
      />
      {chart.status === 'ready' && hiddenCount > 0 && (
        <Button
          size='sm'
          variant='ghost'
          aria-expanded={expanded}
          aria-controls={listId}
          className='mt-1 justify-self-start [grid-area:bottom]'
          onClick={() => setExpanded(!expanded)}
        >
          {expanded
            ? (showLess ?? 'Show fewer')
            : (showMore?.(hiddenCount) ?? `Show ${hiddenCount} more`)}
        </Button>
      )}
    </CategoryChartFrame>
  )
}

/**
 * The rows, in a box that moves to their height as rows come and go, and
 * each row gliding to its new place when the order changes.
 */
function BarListRows({
  id,
  rows,
  dataKey,
  share,
  linkRender,
  entering,
}: {
  id: string
  rows: readonly BarListRowData[]
  dataKey: string
  share: boolean
  linkRender: ReactElement | undefined
  entering: boolean
}) {
  const chart = useChart()
  const { spotlit, setActive } = useChartActive()
  const { frame, row: list } = useFlow<HTMLDivElement, HTMLOListElement>(
    '[data-slot=bar-list-row]',
  )
  const own = useRef<HTMLOListElement>(null)
  const listRef = useMemo(() => mergeRefs(list, chart.plot, own), [list, chart.plot])
  const ready = chart.status === 'ready'
  // A focused row that goes, past the limit or out of the data, hands the
  // focus to the list rather than to the page, and lets its light go.
  const holding = useRef(false)
  useEffect(() => {
    const element = own.current
    if (!element) return
    const hold = () => {
      holding.current = true
    }
    const release = (event: globalThis.FocusEvent) => {
      const target = event.target as Node
      const to = event.relatedTarget as Node | null
      // A row taken out of the page blurs as it goes, while still in it:
      // told apart once React has finished, by being gone.
      queueMicrotask(() => {
        if (target.isConnected && !element.contains(to)) holding.current = false
      })
    }
    element.addEventListener('focusin', hold)
    element.addEventListener('focusout', release)
    return () => {
      element.removeEventListener('focusin', hold)
      element.removeEventListener('focusout', release)
    }
  }, [])
  useLayoutEffect(() => {
    const element = own.current
    if (!holding.current || !element || element.contains(document.activeElement)) return
    setActive(null)
    element.focus({ preventScroll: true })
  })
  const valueLabel = chart.config[dataKey]?.label
  return (
    <div
      ref={frame}
      className='relative overflow-clip transition-[height] duration-(--motion-layout-duration) ease-(--motion-layout-easing) [grid-area:plot] motion-reduce:transition-none'
    >
      <ol
        ref={listRef}
        id={id}
        tabIndex={-1}
        data-chart-plot=''
        data-slot='bar-list-rows'
        className='focus-visible:ring-ring/50 relative isolate flex min-w-0 flex-col gap-1 rounded-(--item-radius) focus-visible:ring-3 focus-visible:outline-hidden focus-visible:ring-inset'
      >
        {ready &&
          rows.map((row) => (
            <BarListRow
              key={row.category.key}
              index={row.category.index}
              name={chart.categoryText(row.category.value)}
              value={row.value}
              share={share ? (row.value === null ? 'none' : row.share) : null}
              valueLabel={typeof valueLabel === 'string' ? valueLabel : undefined}
              clip={row.clip}
              from={row.from}
              color={row.color}
              icon={row.icon}
              href={row.href}
              linkRender={linkRender}
              delay={row.delay}
              entering={entering}
              dim={spotlit !== null && spotlit !== row.category.index}
              picked={chart.selected === row.category.index}
              selectable={chart.selectable}
              setActive={setActive}
              toggleSelected={chart.toggleSelected}
              format={chart.format}
              locale={chart.locale}
              noValue={chart.messages.noValue}
            />
          ))}
      </ol>
    </div>
  )
}

/**
 * One row: its bar, its icon, its name, its value and its share. A link
 * with an `href`, a toggle on a list whose rows can be picked, or else
 * text. Memoised, so a pointer moving between rows redraws only the rows it
 * lights or dims.
 */
const BarListRow = memo(function BarListRow({
  index,
  name,
  value,
  share,
  valueLabel,
  clip,
  from,
  color,
  icon,
  href,
  linkRender,
  delay,
  entering,
  dim,
  picked,
  selectable,
  setActive,
  toggleSelected,
  format,
  locale,
  noValue,
}: {
  index: number
  name: string
  value: number | null
  /** Its share of the total, `none` for a missing value, or null when shares aren't written. */
  share: number | 'none' | null
  valueLabel: string | undefined
  clip: string
  from: string
  color: string
  icon: ReactNode
  href: string | undefined
  linkRender: ReactElement | undefined
  delay: string | undefined
  entering: boolean
  dim: boolean
  picked: boolean
  selectable: boolean
  setActive: (index: number | null) => void
  toggleSelected: (index: number) => void
  format: ChartFormat | undefined
  locale: Intl.LocalesArgument
  noValue: string
}) {
  const link = href !== undefined
  const pressable = !link && selectable
  const interactive = link || pressable
  const events = {
    // Only a mouse lights a row: a tap has no way to leave it.
    onPointerEnter: (event: PointerEvent) => {
      if (event.pointerType === 'mouse') setActive(index)
    },
    onPointerLeave: (event: PointerEvent) => {
      if (event.pointerType === 'mouse') setActive(null)
    },
    onFocus: (event: FocusEvent<HTMLElement>) => {
      if (event.currentTarget.matches(':focus-visible')) setActive(index)
    },
    onBlur: () => setActive(null),
  }
  const content = (
    <>
      <span
        aria-hidden
        data-slot='bar-list-bar'
        data-dim={dim ? '' : undefined}
        data-entering={entering ? '' : undefined}
        className={barClassName}
        style={
          {
            '--bar-color': color,
            '--bar-from': from,
            // A variable, not `clipPath`, so the class's starting shape isn't overruled by an inline style.
            '--bar-clip': clip,
            transitionDelay: delay,
          } as CSSProperties
        }
      />
      {icon !== undefined && icon !== null && (
        <span
          aria-hidden
          data-slot='bar-list-icon'
          className='flex size-4 shrink-0 items-center justify-center [&_img]:size-4 [&_img]:object-contain [&_svg]:size-4'
        >
          {icon}
        </span>
      )}
      {interactive ? (
        <span
          data-cut
          data-slot='bar-list-name'
          className={cn(nameClassName, 'truncate')}
        >
          <bdi>{name}</bdi>
        </span>
      ) : (
        <CutTooltip
          labels={NAME}
          render={
            <span
              data-cut
              data-slot='bar-list-name'
              className={cn(nameClassName, 'truncate')}
            >
              <bdi>{name}</bdi>
            </span>
          }
        />
      )}
      <span className='sr-only'>, </span>
      <span data-slot='bar-list-value' className={valueClassName}>
        {value === null ? (
          <span className='text-muted-foreground'>{noValue}</span>
        ) : (
          <ChartNumber value={value} format={format} locale={locale} />
        )}
        {/* A value written its own way says what it is; a missing one has nothing to name. */}
        {valueLabel && value !== null && typeof format !== 'function' && (
          <span className='sr-only'> {valueLabel}</span>
        )}
      </span>
      {share !== null && (
        <>
          {share !== 'none' && <span className='sr-only'>, </span>}
          {/* In the text colour, lighter than the value: a muted colour over a bar falls below 4.5:1. */}
          <span
            data-slot='bar-list-share'
            className='min-w-12 shrink-0 text-end tabular-nums forced-colors:text-[CanvasText]!'
          >
            {share !== 'none' && (
              <AnimatedNumber value={share} locale={locale} format={SHARE_FORMAT} />
            )}
          </span>
        </>
      )}
    </>
  )
  const rowClassName = cn(
    'relative isolate flex h-(--control-height) w-full min-w-0 items-center gap-2 text-start rounded-(--item-radius) px-(--control-padding) select-none',
    interactive &&
      'focus-visible:ring-ring/50 cursor-pointer focus-visible:ring-3 focus-visible:outline-hidden focus-visible:ring-inset',
    pressable &&
      'aria-pressed:font-medium forced-colors:aria-pressed:outline-2 forced-colors:aria-pressed:outline-[Highlight] forced-colors:aria-pressed:outline-solid',
  )
  return (
    <li
      data-slot='bar-list-row'
      data-dim={dim ? '' : undefined}
      className={rowMoveClassName}
    >
      {link ? (
        <BarListLink
          href={href}
          linkRender={linkRender}
          className={rowClassName}
          {...events}
        >
          {content}
        </BarListLink>
      ) : pressable ? (
        <CutTooltip
          labels={NAME}
          render={
            <button
              type='button'
              aria-pressed={picked}
              className={rowClassName}
              onClick={() => toggleSelected(index)}
              {...events}
            >
              {content}
            </button>
          }
        />
      ) : (
        <div className={rowClassName} {...events}>
          {content}
        </div>
      )}
    </li>
  )
})

/** A share is written to a tenth of a percent. */
const SHARE_FORMAT: Intl.NumberFormatOptions = {
  style: 'percent',
  maximumFractionDigits: 1,
}

/** A row as a link: the list's own `linkRender`, such as a router's, or an `<a>`, with the row's name shown whole while it is cut. */
function BarListLink({
  linkRender,
  ...props
}: ComponentProps<'a'> & { linkRender: ReactElement | undefined }) {
  const element = useRender({
    defaultTagName: 'a',
    render: linkRender,
    props: mergeProps<'a'>(
      { 'data-slot': 'bar-list-link' } as ComponentProps<'a'>,
      props,
    ),
  })
  return <CutTooltip labels={NAME} render={element} />
}

/** A row's name, the one label in it that can be cut short: its value and share never are. */
const NAME = '[data-slot=bar-list-name]'

/** What waits in the rows' place while the data loads: bars of a typical ranking, breathing. */
function BarListPlaceholder({ count }: { count: number }) {
  return (
    <div
      aria-hidden
      data-slot='bar-list-placeholder'
      className='pointer-events-none flex min-w-0 flex-col gap-1 [grid-area:plot]'
    >
      {PLACEHOLDER_LENGTHS.slice(0, Math.max(1, count)).map((length) => (
        <span
          key={length}
          className={cn(
            'block h-(--control-height) rounded-(--item-radius)',
            placeholderFillClassName,
            placeholderBreatheClassName,
          )}
          style={{ width: `${length * 100}%` }}
        />
      ))}
    </div>
  )
}

/**
 * A row moving: gliding to its place when the order changes, fading in when
 * it arrives after the first paint, and its copy fading out where it was
 * when it leaves.
 */
const rowMoveClassName =
  'min-w-0 [transition:translate_var(--motion-layout-duration)_var(--motion-layout-easing),opacity_var(--motion-enter-duration)_var(--motion-enter-easing)] group-data-mounted/chart:starting:opacity-0 data-[flow=start]:[transition:opacity_var(--motion-enter-duration)_var(--motion-enter-easing)] motion-reduce:[transition:opacity_var(--motion-enter-duration)_var(--motion-enter-easing)] data-leaving:opacity-0 data-leaving:[transition:opacity_var(--motion-exit-duration)_var(--motion-exit-easing),translate_var(--motion-layout-duration)_var(--motion-layout-easing)] motion-reduce:data-leaving:[transition:opacity_var(--motion-exit-duration)_var(--motion-exit-easing)]'

/**
 * A bar: a tint of its colour behind the row, as long as `--bar-clip` lets
 * it be, stepping back to a greyer tint while another row is lit. In forced
 * colours, a line under the row's text.
 */
const barClassName =
  'pointer-events-none absolute inset-0 -z-10 rounded-(--item-radius) bg-(--bar-fill) [--bar-fill:color-mix(in_oklab,var(--bar-color)_var(--bar-list-tint,22%),transparent)] data-dim:[--bar-fill:color-mix(in_oklab,oklch(from_var(--bar-color)_l_calc(c*var(--bar-list-dim,0.3))_h)_var(--bar-list-tint,22%),transparent)] [clip-path:var(--bar-clip)] transition-none group-data-mounted/chart:transition-[background-color,clip-path] duration-(--motion-layout-duration) ease-[var(--motion-layout-fade-easing),var(--motion-layout-easing)] group-data-mounted/chart:starting:[clip-path:var(--bar-from)] data-entering:duration-(--motion-draw-duration) data-entering:ease-[var(--motion-draw-fade-easing),var(--motion-draw-easing)] motion-reduce:group-data-mounted/chart:transition-[background-color] motion-reduce:ease-(--motion-layout-fade-easing) forced-colors:top-auto forced-colors:h-1 forced-colors:bg-[CanvasText]! forced-colors:data-dim:bg-[GrayText]!'

/**
 * A row's name: cut short (`truncate`) with the rest of it in a tooltip. It
 * keeps its full colour while another row is lit, as the value does: only the
 * bar steps back, since muted text over a bar falls below 4.5:1.
 */
const nameClassName = 'min-w-0 flex-1 forced-colors:text-[CanvasText]!'

/** A row's value, after its name. */
const valueClassName =
  'shrink-0 font-medium whitespace-nowrap tabular-nums forced-colors:text-[CanvasText]!'

/**
 * The order the rows show in, as places in `values`: largest first,
 * smallest first, or as given. A missing value goes last either way, and
 * rows with the same value keep the data's order, so a tie never swaps.
 */
function barListOrder(values: readonly (number | null)[], sort: BarListSort): number[] {
  const places = values.map((_, at) => at)
  if (sort === 'none') return places
  const sign = sort === 'descending' ? -1 : 1
  return places.toSorted((a, b) => {
    const left = values[a] ?? null
    const right = values[b] ?? null
    if (left === null || right === null) {
      if (left === right) return a - b
      return left === null ? 1 : -1
    }
    return (left - right) * sign || a - b
  })
}

/**
 * The rows to draw, by key, while they move from `placed` to `next`: `next`
 * itself when the rows that stay keep their order, or else only those rows,
 * still in `placed`'s order, until they have taken their new values.
 */
function barListPlacing(
  placed: readonly string[],
  next: readonly string[],
): readonly string[] {
  const now = new Set(next)
  const was = new Set(placed)
  const staying = placed.filter((key) => now.has(key))
  return sameOrder(
    staying,
    next.filter((key) => was.has(key)),
  )
    ? next
    : staying
}

/** Each value's share of the total of every value above zero, from 0 to 1; none when there is nothing to share. */
function barListShares(values: readonly (number | null)[]): number[] {
  const total = values.reduce<number>((sum, value) => sum + Math.max(0, value ?? 0), 0)
  return values.map((value) => (total === 0 ? 0 : Math.max(0, value ?? 0) / total))
}

/**
 * The `clip-path` that shows a bar `fraction` of its row long from the
 * reading start, with its corners rounded. Above nothing, a bar is never
 * shorter than `--bar-list-least`, so the smallest value still shows; at
 * nothing, it shows none.
 */
function barListClip(fraction: number, direction: ReadingDirection): string {
  const share = Math.round(Math.min(1, Math.max(0, fraction)) * 1e6) / 1e4
  const cut =
    share === 0 ? '100%' : `calc(100% - max(var(--bar-list-least, 0.375rem), ${share}%))`
  return direction === 'rtl'
    ? `inset(0 0 0 ${cut} round var(--item-radius))`
    : `inset(0 ${cut} 0 0 round var(--item-radius))`
}

export {
  BarList,
  type BarListMessages,
  type BarListProps,
  type BarListSort,
  barListClip,
  barListOrder,
  barListPlacing,
  barListShares,
}
