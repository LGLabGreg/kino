'use client'

import {
  type CategoryChartProps,
  figureProps,
  pickedName,
  shareColor,
  ShareTooltipContent,
  shareValue,
  useChartActive,
  useChartLife,
  useChartLoad,
  useChartPick,
  writeDatum,
} from '@/registry/lib/chart-base'
import {
  CellGridCell,
  cellLayerVariables,
  CellGridPlaceholder,
  CellGridSizer,
} from '@/registry/lib/chart-cells'
import { ListChartFrame } from '@/registry/lib/chart-list'
import { listReader, type ListStop } from '@/registry/lib/chart-list-reader'
import { type ChartDatum, gridCellAt } from '@/registry/lib/chart-math'
import {
  type ChartPoint,
  type ChartRootState,
  forcedSeriesColor,
  patternImage,
  plotLayerClassName,
  swatchClassName,
  useChartRoot,
  useChartRootValue,
} from '@/registry/lib/chart-root'
import { indexOfKey } from '@/registry/lib/chart-state'
import { numberFormatter } from '@/registry/lib/number-format'
import { createContext, type CSSProperties, memo, use, useState } from 'react'

import { cn } from '@/lib/utils'

/*
 * The Waffle chart: shares of a whole as a grid of squares, a hundred by
 * default, so each square is a percent and a share can be counted. The
 * squares are dealt out so they always add up to the grid, and any share
 * above nothing gets at least one. A `total` larger than the values leaves
 * the squares past them as the remaining room, such as the free part of a
 * plan. Its shares are a list of stops on the list reader
 * (`chart-list-reader`), the remaining room last, and it is drawn on the
 * cells' squares (`chart-cells`): the share under
 * the pointer, the keys or the legend stays bright while the rest step back,
 * and new data turns each square to its new share in a wave from the first.
 */

interface WaffleChartProps extends Omit<
  CategoryChartProps,
  'domain' | 'tickCount' | 'tickValues' | 'allowDecimals' | 'ordered'
> {
  /** The key of each share's value in the data. The config's keys are the shares, under `index`. */
  dataKey: string
  /** What the values are, such as "Visitors": the data table's column. */
  valueLabel?: string
  /** The whole the values are shares of; the sum of the values by default. A larger total leaves the squares past them as the remaining room. */
  total?: number
  /** What the squares past the values are, with `total`, such as "Free": in the tooltip, the data table and for screen readers. */
  remainingLabel?: string
  /** How many rows of squares the grid has. */
  rows?: number
  /** How many squares each row has. */
  columns?: number
  /** How the shares fill the grid from its bottom start corner: along each row, as a rising bar does, or up each column, as a bar across does. */
  fill?: 'rows' | 'columns'
  /**
   * How the squares arrive the first time the chart comes into view: turning
   * to their shares in a wave from the first, or simply there, the default,
   * since a page that loads doesn't animate into place.
   */
  entrance?: 'draw' | 'none'
}

const waffleChartKeys = [
  'dataKey',
  'valueLabel',
  'total',
  'remainingLabel',
  'rows',
  'columns',
  'fill',
  'entrance',
]

/** The remaining room's key, for `selected`: a share can't take it. Its stop holds no row of the data. */
const WAFFLE_REMAINING = 'remaining'

/** The most squares a side, so a grid stays one a pointer can find its squares in. */
const MOST_LINES = 40

/** A square: where it sits, and the share it shows, by its place among the chart's categories, or none. */
interface WaffleSquare {
  column: number
  row: number
  owner: number | null
}

interface WaffleContextValue {
  rows: number
  columns: number
  squares: readonly WaffleSquare[]
  /** The shares still in the data, and the remaining room last, which holds no row. */
  stops: readonly ListStop[]
  /** The entrance has played, or wasn't asked for. */
  entered: boolean
}

const WaffleContext = createContext<WaffleContextValue | null>(null)

function useWaffleChart() {
  const waffle = use(WaffleContext)
  if (!waffle) throw new Error('Waffle chart parts go inside a `WaffleChart`.')
  return waffle
}

/** A count of squares a side: a whole number from 1 to `MOST_LINES`. */
function lineCount(value: number | undefined, fallback: number) {
  if (value === undefined || !Number.isFinite(value)) return fallback
  return Math.min(MOST_LINES, Math.max(1, Math.round(value)))
}

/**
 * The chart's root: it deals the squares out to the shares, and lays out the
 * frame its legend and tooltip draw in, with square cells from the first
 * paint.
 */
function WaffleChart(props: WaffleChartProps) {
  const {
    data,
    index,
    dataKey,
    valueLabel,
    total,
    remainingLabel = 'Remaining',
    fill = 'rows',
    entrance = 'none',
    messages,
    description,
    empty,
    className,
    ref,
  } = props
  const rows = lineCount(props.rows, 10)
  const columns = lineCount(props.columns, 10)
  const cells = rows * columns
  const whole = total !== undefined && Number.isFinite(total) ? Math.max(0, total) : null
  // Every value, the hidden ones too: they still take their part of a total.
  const all = data.reduce((sum, row) => sum + shareValue(row, dataKey), 0)
  const left = whole === null ? 0 : Math.max(0, whole - all)
  const state = useChartRoot(
    {
      ...props,
      messages: {
        series: 'Shares',
        empty: 'No data yet',
        allHidden: 'Every share is hidden',
        showAll: (count) => `Show all ${count} shares`,
        ...messages,
      },
    },
    { entrance: entrance !== 'none', heightFromData: true },
  )
  const load = useChartLoad(props)
  const loaded = !load.placeholder && !load.failed
  const shares = loaded ? data : NO_ROWS
  const drawn = shares.filter((row) => !state.hidden.includes(String(row[index])))
  // What a total leaves is a stop of its own after the shares, so the pointer, the keys, the
  // tooltip and the table reach it as they reach a share; it holds no row.
  const remaining = loaded && left > 0
  const stops: ListStop[] = drawn.map((datum, at) => ({
    key: String(datum[index]),
    value: datum[index],
    datum,
    index: at,
  }))
  if (remaining) {
    stops.push({
      key: WAFFLE_REMAINING,
      value: WAFFLE_REMAINING,
      datum: null,
      index: drawn.length,
    })
  }
  const shown = state.series.filter((key) => !state.hidden.includes(key))
  const { status, entered } = useChartLife(
    props,
    state,
    load,
    {
      rows: shares.length + (remaining ? 1 : 0),
      shown: shown.length,
      drawn: stops.length,
    },
    { entrance: entrance !== 'none', cascade: null },
  )
  const keys = stops.map((stop) => stop.key)
  const pick = useChartPick(props, keys)
  const { messages: words, direction, plotSize } = state
  // A share is named by its config's label, as its legend entry is.
  const nameOf = (stop: ListStop) => {
    if (stop.datum === null) return remainingLabel
    if (props.categoryFormat) return props.categoryFormat(stop.value)
    const named = props.config[String(stop.value)]?.label
    return typeof named === 'string' ? named : String(stop.value)
  }
  const label = valueLabel ?? words.total
  const values = stops.map((stop) =>
    stop.datum === null ? left : shareValue(stop.datum, dataKey),
  )
  const shownSum = values.reduce((sum, value) => sum + value, 0)
  // Against a total, a hidden share keeps its squares, as nobody's, before the remaining room;
  // with none, the shares shown take every square.
  const hidden = whole === null ? 0 : Math.max(0, all + left - shownSum)
  const before = remaining ? stops.length - 1 : stops.length
  const counts = waffleCounts(
    [...values.slice(0, before), hidden, ...values.slice(before)],
    cells,
  )
  const squares = waffleSquares(counts, columns, rows, fill, (part) =>
    part < before ? part : part === before ? null : part - 1,
  )
  const counted = whole === null ? shownSum : Math.max(whole, all)
  const percent = numberFormatter(state.locale, {
    style: 'percent',
    maximumFractionDigits: 1,
  })
  const shareOf = (at: number) => (counted === 0 ? 0 : (values[at] ?? 0) / counted)
  // A share's own value as written, so a missing one reads as missing, as a Donut's does; the
  // remaining room's is the total's room left.
  const valueText = (stop: ListStop) =>
    stop.datum === null
      ? state.valueText(left)
      : writeDatum(stop.datum[dataKey], state.valueText, words.noValue)

  const reader = listReader({
    current: stops,
    walk: { kind: 'straight', orientation: 'vertical' },
    series: { kind: 'none' },
    direction,
    hit: (point) => {
      const box = waffleBox(point.width, point.height, columns, rows, direction)
      if (box.width === 0 || box.height === 0) return null
      const x = (point.x - box.left) / box.width
      const y = (point.y - box.top) / box.height
      if (x < 0 || x > 1 || y < 0 || y > 1) return null
      const { column, row } = gridCellAt({ x, y }, columns, rows, direction)
      return squares[waffleOrder(column, row, columns, rows, fill)]?.owner ?? null
    },
    // The tooltip sits over the middle of the share's top row of squares.
    anchor: (stop) => {
      const point = waffleAnchor(
        squares,
        stop.index,
        waffleStart(counts, before, stop.index),
        columns,
        rows,
        fill,
        direction,
      )
      const box = waffleBox(plotSize.width, plotSize.height, columns, rows, direction)
      if (box.width === 0 || box.height === 0) return point
      return {
        x: (box.left + point.x * box.width) / plotSize.width,
        y: (box.top + point.y * box.height) / plotSize.height,
        side: 'top',
      }
    },
    words: {
      describe: (stop) =>
        `${pickedName(nameOf(stop), pick.picked === stop.key, words)}: ${label} ${valueText(stop)}, ${percent.format(shareOf(stop.index))}`,
      tooltip: (stop) => (
        <ShareTooltipContent
          chart={state}
          category={stop}
          name={nameOf(stop)}
          rows={[
            {
              label: null,
              value: valueText(stop),
              share: percent.format(shareOf(stop.index)),
            },
          ]}
          swatch={
            stop.datum === null ? (
              <span aria-hidden className={cn(swatchClassName, remainingClassName)} />
            ) : undefined
          }
        />
      ),
      table: {
        header: words.category,
        columns: [label, words.share],
        rows: stops.map((stop) => ({
          key: stop.key,
          name: nameOf(stop),
          cells: [valueText(stop), percent.format(shareOf(stop.index))],
        })),
        footer: [state.valueText(counted), percent.format(counted === 0 ? 0 : 1)],
      },
    },
  })

  const boxStyle = waffleBoxStyle(columns, rows)
  return (
    <WaffleContext value={{ rows, columns, squares, stops, entered }}>
      <ListChartFrame
        chart={{
          state,
          status,
          drawn,
          selectable: pick.selectable,
          picked: pick.picked,
          togglePicked: (key) => {
            if (indexOfKey(keys, key) !== null) pick.toggle(key)
          },
          activeProps: {
            activeIndex: props.activeIndex,
            defaultActiveIndex: props.defaultActiveIndex ?? null,
            onActiveIndexChange: props.onActiveIndexChange,
          },
        }}
        reader={reader}
        ref={ref}
        slot='waffle-chart'
        description={description}
        empty={empty}
        measuring={false}
        className={cn('h-auto', className)}
        placeholder={
          load.placeholder && (
            <CellGridPlaceholder
              slot='waffle-chart'
              shape='square'
              columns={columns}
              rows={rows}
              className={waffleBoxClassName}
              style={boxStyle}
            />
          )
        }
        {...figureProps(props, waffleChartKeys)}
      >
        <CellGridSizer shape='square' columns={columns} rows={rows} />
        <WaffleSquares />
        {props.children}
      </ListChartFrame>
    </WaffleContext>
  )
}

/** The shares of a chart that loads or failed: one array, so what compares them sees no change. */
const NO_ROWS: readonly ChartDatum[] = []

/** The remaining room's look: the page's muted fill, and a dashed outline in forced colours. */
const remainingClassName =
  'bg-(--muted) forced-colors:bg-transparent forced-colors:outline-1 forced-colors:-outline-offset-1 forced-colors:outline-dashed forced-colors:outline-[GrayText]'

/** The box the squares take: from the plot's start, as wide as square cells make it. */
const waffleBoxClassName = 'absolute inset-y-0 start-0 [container-type:size]'

function waffleBoxStyle(columns: number, rows: number): CSSProperties {
  return { width: `min(100cqw, 100cqh * ${columns / rows})` }
}

/** What a square shows: its share's colour, pattern and forced colour, or the remaining room's. */
interface SquareLook {
  /** The square's colour, or none for a square nobody holds, drawn as a dashed outline. */
  color: string | null
  image?: string
  forced?: string
}

/** A square nobody holds, such as a hidden share's against a total, or every square with nothing to share. */
const NOBODY: SquareLook = { color: null }

function lookOf(
  chart: Pick<ChartRootState, 'series' | 'patternOf'>,
  stop: ListStop | undefined,
): SquareLook {
  if (!stop || stop.datum === null) {
    return { color: 'var(--muted)', forced: remainingClassName }
  }
  const slot = chart.series.indexOf(stop.key)
  return {
    color: shareColor(chart, stop),
    image: slot === -1 ? undefined : patternImage(chart.patternOf(stop.key)) || undefined,
    forced: forcedSeriesColor(slot === -1 ? stop.index : slot),
  }
}

/**
 * The squares: one layer of every square, in its share's colour, that steps
 * back as one while a share is lit, a single filter whatever the number of
 * squares; over it, each share's squares again, bright, faded in while it is
 * lit and out as another is, so moving from share to share crossfades.
 */
function WaffleSquares() {
  const chart = useChartRootValue()
  const waffle = useWaffleChart()
  const { stops } = waffle
  const { spotlit } = useChartActive()
  // Which share holds each square, by its key, now and before the data last changed, so a lit
  // share's copies turn in the same wave as the squares below.
  const owners = waffle.squares
    .map((square) => (square.owner === null ? '' : (stops[square.owner]?.key ?? '')))
    .join(OWNER_SEPARATOR)
  const [held, setHeld] = useState({ now: owners, was: owners })
  if (held.now !== owners) setHeld({ now: owners, was: held.now })
  if (chart.status === 'empty') return null
  const litNow = spotlit === null ? undefined : stops[spotlit]
  const lit = litNow ? litNow.key : chart.emphasis
  const looks = stops.map((stop) => lookOf(chart, stop))
  const rest = lookOf(chart, undefined)
  // Until the chart enters, every square waits in the remaining room's look, then turns.
  const waiting = !waffle.entered
  return (
    <>
      <SquareLayer
        dim={lit !== null}
        squares={waffle.squares}
        looks={looks}
        waiting={waiting}
        rest={rest}
        columns={waffle.columns}
        rows={waffle.rows}
      />
      <div
        data-slot='waffle-chart-lit'
        aria-hidden
        className={cn(plotLayerClassName, 'z-11')}
        style={cellLayerVariables('waffle-chart')}
      >
        <div
          className={waffleBoxClassName}
          style={waffleBoxStyle(waffle.columns, waffle.rows)}
        >
          {stops.map((stop) => (
            <LitShare
              key={stop.key}
              on={lit === stop.key}
              share={stop.key}
              look={looks[stop.index]!}
              squares={waffle.squares}
              owners={held.now}
              was={held.was}
              columns={waffle.columns}
              rows={waffle.rows}
            />
          ))}
        </div>
      </div>
    </>
  )
}

/**
 * Every square, by its place in the fill, so a square that changes share
 * turns its colour where it is. Memoised, so lighting a share redraws none
 * of them.
 */
const SquareLayer = memo(function SquareLayer({
  dim,
  squares,
  looks,
  waiting,
  rest,
  columns,
  rows,
}: {
  dim: boolean
  /** Every square shows the remaining room's look until the chart enters. */
  waiting: boolean
  squares: readonly WaffleSquare[]
  looks: readonly SquareLook[]
  rest: SquareLook
  columns: number
  rows: number
}) {
  const last = Math.max(1, squares.length - 1)
  return (
    <div
      data-slot='waffle-chart-squares'
      data-dim={dim ? '' : undefined}
      aria-hidden
      className={cn(
        plotLayerClassName,
        'z-10 transition-[filter] duration-(--motion-layout-duration) ease-(--motion-layout-fade-easing) not-forced-colors:data-dim:[filter:saturate(var(--cells-dim))]',
      )}
      style={cellLayerVariables('waffle-chart')}
    >
      <div className={waffleBoxClassName} style={waffleBoxStyle(columns, rows)}>
        {squares.map((square, order) => {
          const look = waiting
            ? rest
            : square.owner === null
              ? NOBODY
              : (looks[square.owner] ?? NOBODY)
          return (
            <CellGridCell
              // oxlint-disable-next-line react/no-array-index-key -- a square is its place in the fill
              key={order}
              slot='waffle-chart'
              shape='square'
              column={square.column}
              row={square.row}
              columns={columns}
              rows={rows}
              color={look.color}
              strength={1}
              leaving={false}
              along={order / last}
              image={look.image}
              forced={look.forced}
            />
          )
        })}
      </div>
    </div>
  )
})

/** What separates the shares' keys in a list of the squares' owners. */
const OWNER_SEPARATOR = '\u0001'

/** A square of a lit share's copy that its share no longer holds: clear, in forced colours too. */
const CLEAR: SquareLook = { color: 'transparent', forced: 'forced-colors:bg-transparent' }

/**
 * One share's squares, bright over the rest, shown while it is lit and
 * fading on `layout`. Each turns in the same wave as the square below when
 * new data comes: one it gains fades in, and one it loses clears, so a lit
 * share refills from where it is too.
 */
const LitShare = memo(function LitShare({
  on,
  share,
  look,
  squares,
  owners,
  was,
  columns,
  rows,
}: {
  on: boolean
  share: string
  look: SquareLook
  squares: readonly WaffleSquare[]
  /** Each square's share's key, now and before the data last changed, joined by `OWNER_SEPARATOR`. */
  owners: string
  was: string
  columns: number
  rows: number
}) {
  const now = owners.split(OWNER_SEPARATOR)
  const before = was.split(OWNER_SEPARATOR)
  const last = Math.max(1, squares.length - 1)
  return (
    <div
      data-off={on ? undefined : ''}
      className='absolute inset-0 transition-opacity duration-(--motion-layout-duration) ease-(--motion-layout-fade-easing) data-off:opacity-0'
    >
      {squares.map((square, order) => {
        const holds = now[order] === share
        if (!holds && before[order] !== share) return null
        const shown = holds ? look : CLEAR
        return (
          <CellGridCell
            // oxlint-disable-next-line react/no-array-index-key -- a square is its place in the fill
            key={order}
            slot='waffle-chart'
            shape='square'
            column={square.column}
            row={square.row}
            columns={columns}
            rows={rows}
            color={shown.color}
            strength={1}
            leaving={false}
            along={order / last}
            image={shown.image}
            forced={shown.forced}
          />
        )
      })}
    </div>
  )
})

/**
 * How many of `cells` squares each value takes: its share of their sum, by
 * largest remainder, so the counts always add up to `cells`. A value above
 * zero takes at least one, from the value whose count is furthest over its
 * share, while there is one to give; a value at or below zero takes none.
 */
function waffleCounts(values: readonly number[], cells: number): number[] {
  const positive = values.map((value) =>
    Number.isFinite(value) ? Math.max(0, value) : 0,
  )
  const sum = positive.reduce((all, value) => all + value, 0)
  if (sum === 0 || cells <= 0) return positive.map(() => 0)
  const exact = positive.map((value) => (value / sum) * cells)
  const counts = exact.map(Math.floor)
  let left = cells - counts.reduce((all, count) => all + count, 0)
  // The biggest remainders first; a tie goes to the bigger value, then to the earlier.
  const byRemainder = exact
    .map((share, at) => ({ at, remainder: share - Math.floor(share), share }))
    .sort((a, b) => b.remainder - a.remainder || b.share - a.share || a.at - b.at)
  for (const { at } of byRemainder) {
    if (left === 0) break
    counts[at]! += 1
    left -= 1
  }
  // The smallest values left with none, biggest first, each take one where one can be spared.
  const unseen = positive
    .map((value, at) => ({ value, at }))
    .filter(({ value, at }) => value > 0 && counts[at] === 0)
    .sort((a, b) => b.value - a.value || a.at - b.at)
  for (const { at } of unseen) {
    let donor = -1
    for (let other = 0; other < counts.length; other += 1) {
      if (counts[other]! < 2) continue
      const over = counts[other]! - exact[other]!
      const best = donor === -1 ? -Infinity : counts[donor]! - exact[donor]!
      if (over > best) donor = other
    }
    if (donor === -1) break
    counts[donor]! -= 1
    counts[at] = 1
  }
  return counts
}

/**
 * Where the square at place `order` in the fill sits, counted from the grid's
 * bottom start corner: along each row and then up, or up each column and
 * then along. Rows are counted from the top.
 */
function waffleCellAt(
  order: number,
  columns: number,
  rows: number,
  fill: 'rows' | 'columns',
): { column: number; row: number } {
  if (fill === 'columns') {
    return { column: Math.floor(order / rows), row: rows - 1 - (order % rows) }
  }
  return { column: order % columns, row: rows - 1 - Math.floor(order / columns) }
}

/** The place in the fill of the square at `column` and `row`, the reverse of `waffleCellAt`. */
function waffleOrder(
  column: number,
  row: number,
  columns: number,
  rows: number,
  fill: 'rows' | 'columns',
) {
  const up = rows - 1 - row
  return fill === 'columns' ? column * rows + up : up * columns + column
}

/**
 * Every square of a grid `columns` by `rows`, in the order they fill, each
 * given in turn to the owner of its part of `counts`: the part's own place by
 * default, or none.
 */
function waffleSquares(
  counts: readonly number[],
  columns: number,
  rows: number,
  fill: 'rows' | 'columns',
  ownerOf: (part: number) => number | null = (part) => part,
): WaffleSquare[] {
  const owners: (number | null)[] = []
  counts.forEach((count, part) => {
    for (let at = 0; at < count; at += 1) owners.push(ownerOf(part))
  })
  return Array.from({ length: columns * rows }, (_, order) => ({
    ...waffleCellAt(order, columns, rows, fill),
    owner: owners[order] ?? null,
  }))
}

/**
 * The box the squares take in a plot `width` by `height` px: as large as
 * square cells allow, from the top and the start, under the legend's start.
 * Before the plot is measured, nothing.
 */
function waffleBox(
  width: number,
  height: number,
  columns: number,
  rows: number,
  direction: 'ltr' | 'rtl',
) {
  if (width <= 0 || height <= 0) return { left: 0, top: 0, width: 0, height: 0 }
  const side = Math.min(width / columns, height / rows)
  const boxWidth = side * columns
  return {
    left: direction === 'rtl' ? width - boxWidth : 0,
    top: 0,
    width: boxWidth,
    height: side * rows,
  }
}

/**
 * Where share `owner`'s squares start in the fill: the squares of the parts
 * before it in `counts`, where a hidden share's part sits at `gap`.
 */
function waffleStart(counts: readonly number[], gap: number, owner: number) {
  const part = owner < gap ? owner : owner + 1
  return counts.slice(0, part).reduce((all, count) => all + count, 0)
}

/**
 * Where the tooltip for share `owner` sits, as fractions of the squares' box:
 * over the middle of the share's top row of squares, the one nearest the top.
 * A share with no squares points where the fill reaches it, at its place
 * `from`, or at the last square when the grid is full.
 */
function waffleAnchor(
  squares: readonly WaffleSquare[],
  owner: number,
  from: number,
  columns: number,
  rows: number,
  fill: 'rows' | 'columns',
  direction: 'ltr' | 'rtl',
): ChartPoint {
  const own = squares.filter((square) => square.owner === owner)
  if (own.length === 0) {
    const at = waffleCellAt(
      Math.max(0, Math.min(from, columns * rows - 1)),
      columns,
      rows,
      fill,
    )
    const middle = (at.column + 0.5) / columns
    return { x: direction === 'rtl' ? 1 - middle : middle, y: at.row / rows, side: 'top' }
  }
  const top = Math.min(...own.map((square) => square.row))
  const across = own.filter((square) => square.row === top).map((square) => square.column)
  const middle = (Math.min(...across) + Math.max(...across) + 1) / 2 / columns
  return { x: direction === 'rtl' ? 1 - middle : middle, y: top / rows, side: 'top' }
}

export {
  WAFFLE_REMAINING,
  waffleStart,
  WaffleChart,
  type WaffleChartProps,
  waffleAnchor,
  waffleBox,
  waffleCellAt,
  waffleCounts,
  waffleOrder,
  waffleSquares,
}
