'use client'

import {
  axisLayerClassName,
  type CategoryChartProps,
  figureProps,
  slideLine,
  useDeclared,
} from '@/registry/lib/chart-base'
import {
  type CategoryChartInput,
  type ChartCategory,
  type ChartPartDeclaration,
  useCartesianChart,
  useChart,
  cartesianSignature,
  cartesianChartKeys,
} from '@/registry/lib/chart-core'
import {
  framePoints,
  frameRest,
  frameTop,
  LineFamilyFrame,
  LinePlaceholder,
  LineSeries,
  type LineSeriesProps,
  useLineFamily,
} from '@/registry/lib/chart-line'
import { lineMarks } from '@/registry/lib/chart-line-marks'
import {
  type ChartDatum,
  numberOf,
  plotPoint,
  stepThrough,
} from '@/registry/lib/chart-math'
import {
  ChangeText,
  type ChartMessages,
  defaultMessages,
  forcedSeriesColor,
  swatchClassName,
  swatchStyle,
  tooltipQuietClassName,
  type MoveRun,
  useChartMoves,
} from '@/registry/lib/chart-root'
import type { LinearScale } from '@/registry/lib/chart-scale'
import { CutTooltip } from '@/registry/lib/cut'
import { heightAt, type LinePoint } from '@/registry/lib/line-path'
import { numberFormatter } from '@/registry/lib/number-format'
import {
  type ComponentProps,
  createContext,
  type CSSProperties,
  type ReactNode,
  use,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import { cn } from '@/lib/utils'

/*
 * The Bump chart: ranks over time, one line per item, crossing where one
 * overtakes another. Rank 1 is the top row and each rank has a row of its
 * own. Its lines, their moves and their dots come from the chart line lib,
 * which the Line chart shares, drawn as S-curves that leave each period
 * level. The line under the pointer, or the one the Up and Down arrows
 * reach, stays bright from end to end while the rest step back, and a new
 * range or new ranks move every line from where it is.
 */

/**
 * What the values in the data are: ranks already, 1 the top, or amounts
 * the chart ranks in each period, the highest first or the lowest first.
 */
type BumpRankBy = 'given' | 'highest' | 'lowest'

/** Every word the Bump chart says or reads out, beyond what every chart says. */
interface BumpChartMessages extends ChartMessages {
  /** A rank, as a screen reader hears it, with the rank written: "rank 2". */
  rank: (rank: number, written: string) => string
  /** A move since the period before, `places` up when positive, with its size written: "up 2 places". */
  moved: (places: number, written: string) => string
  /** Said of an item with no rank in a period. */
  unranked: string
}

const bumpMessages = {
  rank: (_rank: number, written: string) => `rank ${written}`,
  moved: (places: number, written: string) => {
    const size = `${written} ${Math.abs(places) === 1 ? 'place' : 'places'}`
    return places > 0 ? `up ${size}` : places < 0 ? `down ${size}` : 'no change'
  },
  unranked: 'not ranked',
} satisfies Partial<BumpChartMessages>

interface BumpChartProps extends Omit<
  CategoryChartProps,
  | 'domain'
  | 'tickCount'
  | 'tickValues'
  | 'allowDecimals'
  | 'patterns'
  | 'messages'
  | 'ordered'
> {
  /**
   * What the values in the data are: ranks already, 1 the top, the default;
   * or amounts ranked in each period, the highest first or the lowest first.
   * Equal amounts share a rank, and the next rank is skipped (1, 1, 3).
   */
  rankBy?: BumpRankBy
  /**
   * How the lines arrive the first time the chart comes into view: drawn
   * along from the reading start, or simply there, the default, since a page
   * that loads doesn't animate into place.
   */
  entrance?: 'draw' | 'none'
  /** Every word the chart says or reads out, for a chart in another language. */
  messages?: Partial<BumpChartMessages>
}

const bumpChartKeys = [...cartesianChartKeys, 'rankBy', 'entrance']

/** Each period's ranks, and the row each series sits on. */
interface BumpRanking {
  /** Each row with every series' rank, as given or worked out from its amount; null with none. */
  ranks: ChartDatum[]
  /**
   * Each row with every series' row on the chart, 1 the top: in the order
   * of their ranks, a series sharing a rank on the next row free, so no two
   * lines lie on each other, and no row that no series reaches.
   */
  places: ChartDatum[]
}

/**
 * The ranks of each row: as given, or by amount, the highest or the lowest
 * first, equal amounts sharing a rank and the next rank skipped (1, 1, 3). A
 * missing value, or a given rank below 1, has none. Each series gets a row
 * of its own as well: series sharing a rank take the rows from it down, in
 * the order they held in the row before, so lines cross no more than they
 * must, and then in the order of `keys`. A row no series reaches in any
 * period is left out, so three songs in a top 100 take three rows, not 100.
 */
function bumpRanks(
  rows: readonly ChartDatum[],
  keys: readonly string[],
  rankBy: BumpRankBy,
): BumpRanking {
  const ranks: ChartDatum[] = []
  const places: ChartDatum[] = []
  rows.forEach((row, at) => {
    const values = keys.map((key) => numberOf(row[key]))
    const ranked: ChartDatum = { ...row }
    keys.forEach((key, slot) => {
      const value = values[slot] ?? null
      if (value === null) ranked[key] = null
      else if (rankBy === 'given') ranked[key] = value >= 1 ? Math.round(value) : null
      else {
        const ahead = values.filter(
          (other) =>
            other !== null && (rankBy === 'highest' ? other > value : other < value),
        ).length
        ranked[key] = ahead + 1
      }
    })
    const before = places[at - 1]
    const order = keys
      .filter((key) => numberOf(ranked[key]) !== null)
      .toSorted(
        (a, b) =>
          (numberOf(ranked[a]) ?? 0) - (numberOf(ranked[b]) ?? 0) ||
          (numberOf(before?.[a]) ?? Infinity) - (numberOf(before?.[b]) ?? Infinity) ||
          keys.indexOf(a) - keys.indexOf(b),
      )
    const placed: ChartDatum = { ...row }
    for (const key of keys) placed[key] = null
    let last = 0
    for (const key of order) {
      last = Math.max(numberOf(ranked[key]) ?? 0, last + 1)
      placed[key] = last
    }
    ranks.push(ranked)
    places.push(placed)
  })
  const reached = [
    ...new Set(places.flatMap((row) => keys.map((key) => numberOf(row[key])))),
  ]
    .filter((place) => place !== null)
    .toSorted((a, b) => a - b)
  const dense = new Map(reached.map((place, at) => [place, at + 1]))
  for (const row of places) {
    for (const key of keys) {
      const place = numberOf(row[key])
      if (place !== null) row[key] = dense.get(place) ?? null
    }
  }
  return { ranks, places }
}

/** How many rows the chart has: the lowest any series sits on in any row, at least 1. */
function rankCount(rows: readonly ChartDatum[], keys: readonly string[]): number {
  let count = 1
  for (const row of rows) {
    for (const key of keys) count = Math.max(count, numberOf(row[key]) ?? 1)
  }
  return count
}

/** How many places a series moved since the period before, up when positive; null with no rank in either. */
function rankMove(before: unknown, now: unknown): number | null {
  const was = numberOf(before)
  const is = numberOf(now)
  return was === null || is === null ? null : was - is
}

/** The series with a row in `row`, from the top. */
function rankOrder(row: ChartDatum, keys: readonly string[]): string[] {
  return keys
    .filter((key) => numberOf(row[key]) !== null)
    .toSorted((a, b) => (numberOf(row[a]) ?? 0) - (numberOf(row[b]) ?? 0))
}

/**
 * The series a step up (-1) or down (1) the rows of `row` from `from`,
 * kept at the ends; from none, or from one not ranked there, the top one.
 */
function stepRank(
  row: ChartDatum,
  keys: readonly string[],
  from: string | null,
  step: -1 | 1,
): string | null {
  return stepThrough(rankOrder(row, keys), from, step)
}

/**
 * The series whose line passes nearest a point of the plot, as fractions of
 * it from the reading start and the top, among `lines` drawn as bumps; null
 * where none is drawn.
 */
function nearestLine(
  lines: readonly { key: string; points: readonly LinePoint[] }[],
  point: { x: number; y: number },
): string | null {
  let nearest: string | null = null
  let distance = Infinity
  for (const line of lines) {
    const y = heightAt(line.points, 'bump', point.x)
    if (y === null || Math.abs(y - point.y) >= distance) continue
    nearest = line.key
    distance = Math.abs(y - point.y)
  }
  return nearest
}

/** Where a row sits, as a fraction of the plot from its top: its middle. */
function rowOf(place: number, scale: LinearScale) {
  return 1 - scale.place(place)
}

/** What the Bump chart's own parts read: each series' rank and amount in a period, and its words. */
interface BumpContextValue {
  rankOf: (category: ChartCategory, key: string) => number | null
  /** The amount a series was ranked by, or null when the ranks were given. */
  amountOf: (category: ChartCategory, key: string) => number | null
  /** A rank or a number of places, written in the chart's locale. */
  rankText: (rank: number) => string
  messages: BumpChartMessages
}

const BumpContext = createContext<BumpContextValue | null>(null)

function useBump() {
  const bump = use(BumpContext)
  if (!bump) throw new Error('`BumpNames` goes inside a `BumpChart`.')
  return bump
}

/**
 * The chart's root: it lays out the frame its parts draw in, places each
 * period along the plot from edge to edge and gives each rank a row, rank 1
 * at the top. The plot is at least a row's height for each rank,
 * `--bump-chart-row`, so names never crowd; a height of yours that is
 * taller spreads the rows.
 */
function BumpChart(props: BumpChartProps) {
  const {
    data,
    index,
    config,
    rankBy = 'given',
    entrance = 'none',
    messages,
    description,
    empty,
    className,
    style,
    children,
    ref,
  } = props
  const keys = Object.keys(config)
  const keyList = keys.join('\u0000')
  // Ranked once per change of the data, so the chart sees the same rows from render to render.
  const ranking = useMemo(
    () => bumpRanks(data, keyList.split('\u0000'), rankBy),
    [data, keyList, rankBy],
  )
  // Every series counts, the hidden ones too, so hiding one never moves the rows.
  const rows = rankCount(ranking.places, keys)
  const said: BumpChartMessages = { ...defaultMessages, ...bumpMessages, ...messages }
  const { chart, model, placeholder, phase } = useCartesianChart(
    {
      ...props,
      // The chart places each series on its row; its rank and amount are looked up by period.
      data: ranking.places,
      // Rank 1 at the top: the axis runs from the last row's bottom edge up to the first's top.
      domain: [rows + 0.5, 0.5],
      tickValues: Array.from({ length: rows }, (_, at) => at + 1),
      messages,
    },
    {
      kinds: [lineMarks],
      orientation: 'vertical',
      stack: 'none',
      entrance: entrance !== 'none',
      // The lines grow from the bottom row's edge, so one drawn in rises from below every rank.
      y: { nice: false, zero: false, base: rows + 0.5 },
    },
  )
  const byPeriod = useMemo(() => {
    const out = new Map<string, { rank: ChartDatum; amount: ChartDatum }>()
    data.forEach((row, at) => {
      out.set(String(row[index]), { rank: ranking.ranks[at] ?? {}, amount: row })
    })
    return out
  }, [data, index, ranking])
  const bump: BumpContextValue = {
    rankOf: (category, key) => numberOf(byPeriod.get(category.key)?.rank[key]),
    amountOf: (category, key) =>
      rankBy === 'given' ? null : numberOf(byPeriod.get(category.key)?.amount[key]),
    rankText: (rank) => numberFormatter(chart.locale).format(rank),
    messages: said,
  }
  const shown = chart.series.filter((key) => !chart.hidden.includes(key))
  // A period a series has no rank in leaves a gap; a hidden line fades where it is.
  const pointsOf = (key: string) => framePoints(chart, model, key, false, false)
  const labelOf = (key: string) => {
    const label = config[key]?.label
    return typeof label === 'string' ? label : key
  }
  // What each item says for a period: its rank, its move since the period before and, ranked
  // by amount, the amount.
  const itemText = (key: string, category: ChartCategory) => {
    const rank = bump.rankOf(category, key)
    if (rank === null) return `${labelOf(key)}, ${said.unranked}`
    const before = chart.current[category.index - 1]
    const move = before ? rankMove(bump.rankOf(before, key), rank) : null
    const amount = bump.amountOf(category, key)
    return [
      labelOf(key),
      said.rank(rank, bump.rankText(rank)),
      move === null ? null : said.moved(move, bump.rankText(Math.abs(move))),
      amount === null ? null : chart.valueText(amount),
    ]
      .filter(Boolean)
      .join(', ')
  }
  const full: CategoryChartInput = {
    ...chart,
    // A line has no fill to pattern, so its key in the legend and the tooltip stays solid too.
    patternOf: () => 'solid',
    // The tooltip sits over the period's top point, so it covers no line.
    pointOf: (at) => {
      const category = chart.current[at]
      if (!category) return null
      const along = model.reach(category.index) ?? 1
      return plotPoint(category.band, along, 'vertical', chart.direction)
    },
    seriesAt: (point) =>
      nearestLine(
        shown.map((key) => ({ key, points: pointsOf(key) })),
        point,
      ),
    stepSeries: (at, from, step) => {
      const category = chart.current[at]
      return category ? stepRank(category.datum, shown, from, step) : null
    },
    // The series brought forward alone, so Up and Down are heard to move; with none, every
    // ranked one, best first.
    describe: (at) => {
      const category = chart.current[at]
      if (!category) return ''
      if (chart.emphasis !== null && shown.includes(chart.emphasis)) {
        return itemText(chart.emphasis, category)
      }
      return rankOrder(category.datum, shown)
        .map((key) => itemText(key, category))
        .join('; ')
    },
    table: {
      columns: shown.map(labelOf),
      cells: (category) =>
        shown.map((key) => {
          const rank = bump.rankOf(category, key)
          const amount = bump.amountOf(category, key)
          if (rank === null) return said.unranked
          return amount === null
            ? said.rank(rank, bump.rankText(rank))
            : `${said.rank(rank, bump.rankText(rank))}, ${chart.valueText(amount)}`
        }),
    },
    tooltipContent: (at) => <BumpTooltipContent index={at} />,
  }
  return (
    <BumpContext value={bump}>
      <LineFamilyFrame
        chart={full}
        family={{
          name: 'bump-chart',
          phase,
          entrance,
          pointsOf,
          topOf: (key, category) => frameTop(model, key, category),
          restOf: (key) => frameRest(model, key),
        }}
        description={description}
        empty={empty}
        placeholder={placeholder && <LinePlaceholder name='bump-chart' fill={false} />}
        // Each rank's row is at least `--bump-chart-row` tall; the chart is as tall as its rows,
        // unless a height of yours spreads them.
        className={cn(
          'h-auto grid-rows-[auto_auto_minmax(calc(var(--bump-rows)*var(--bump-chart-row,2rem)),1fr)_auto_auto]',
          className,
        )}
        style={{ '--bump-rows': rows, ...style } as CSSProperties}
        ref={ref}
        {...figureProps(props, [...bumpChartKeys, 'style'])}
      >
        {children}
      </LineFamilyFrame>
    </BumpContext>
  )
}

/**
 * The tooltip of a period: every shown item, best first, with its rank, its
 * move since the period before and, ranked by amount, its amount. The item
 * brought forward reads in full, the rest a step back.
 */
function BumpTooltipContent({ index }: { index: number }) {
  const chart = useChart()
  const { rankOf, amountOf, rankText } = useBump()
  const {
    id,
    current,
    series,
    hidden,
    config,
    categoryText,
    valueText,
    emphasis,
    locale,
  } = chart
  const category = current[index]
  if (!category) return null
  const before = current[index - 1]
  const shown = series.filter((key) => !hidden.includes(key))
  return (
    // The tooltip sits outside the chart, so it carries the chart's id for its colours.
    <div data-chart={id} className='grid min-w-40 gap-1'>
      <div className='font-medium'>{categoryText(category.value)}</div>
      {/* One grid, so each column lines up from row to row. */}
      <div className='grid grid-cols-[auto_auto_minmax(0,1fr)_auto_auto] items-center gap-x-2 gap-y-1'>
        {rankOrder(category.datum, shown).map((key) => {
          const rank = rankOf(category, key)
          const move = before ? rankMove(rankOf(before, key), rank) : null
          const amount = amountOf(category, key)
          return (
            // The item brought forward reads in full colour; the rest stay as they are, legible.
            <div
              key={key}
              data-lit={emphasis === key ? '' : undefined}
              className='group/row col-span-full grid grid-cols-subgrid items-center'
            >
              <span className={cn(tooltipQuietClassName, 'text-end tabular-nums')}>
                {rank === null ? null : rankText(rank)}
              </span>
              <span
                aria-hidden
                className={cn(swatchClassName, forcedSeriesColor(series.indexOf(key)))}
                style={swatchStyle(key, 'solid')}
              />
              <span className={cn(tooltipQuietClassName, 'min-w-0 truncate')}>
                {config[key]?.label ?? key}
              </span>
              {/* A move up or down, in places; none says nothing. */}
              <ChangeText
                change={move === 0 ? null : move}
                locale={locale}
                format={rankText}
                className={cn(tooltipQuietClassName, 'text-end')}
              />
              <span dir='auto' className='text-end font-medium tabular-nums'>
                {amount === null ? null : valueText(amount)}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

type BumpProps = Omit<
  LineSeriesProps,
  'curve' | 'dots' | 'dashed' | 'forecastFrom' | 'connectNulls'
> & {
  /** Marks each period's rank with a dot; off draws the line alone, for a long run of periods. */
  dots?: boolean
}

/**
 * One item's line, in its colour, through its rank in each period: a dot on
 * each, an S from one to the next, and a gap where it has no rank. While
 * another item is brought forward, it steps back.
 */
function Bump({ dots = true, ...props }: BumpProps) {
  useDeclared('Bump', Bump.declare(props), cartesianSignature)
  return <LineSeries {...props} curve='bump' dots={dots} />
}

Bump.declare = ({ dataKey }: BumpProps): ChartPartDeclaration => ({
  series: { key: dataKey, mark: 'line' },
})

/**
 * Each item's name at one end of its line: its rank in the first period
 * beside the plot's start, or with `side='end'`, in the last beside its
 * end, with the rank between the name and the line. The names glide to new
 * ranks with the lines. The item brought forward reads in full while the
 * rest step back, and pointing at a name brings its item forward.
 */
function BumpNames({
  side = 'start',
  className,
  ...props
}: Omit<ComponentProps<'div'>, 'children'> & { side?: 'start' | 'end' }) {
  const {
    current,
    series,
    hidden,
    config,
    frame,
    status,
    emphasis,
    setEmphasis,
    entered,
  } = useChart()
  const { scale } = frame.y.value
  const { rankOf, rankText } = useBump()
  const family = useLineFamily()
  const period = side === 'start' ? current[0] : current.at(-1)
  // Where each name last sat, so one that loses its rank fades where it was.
  const [places, setPlaces] = useState<Record<string, number>>({})
  const now: Record<string, number> = {}
  for (const key of series) {
    const place = period ? numberOf(period.datum[key]) : null
    if (place !== null) now[key] = rowOf(place, scale)
  }
  if (Object.entries(now).some(([key, place]) => places[key] !== place)) {
    setPlaces({ ...places, ...now })
  }
  const ready = status === 'ready'
  const labelOf = (key: string): ReactNode => config[key]?.label ?? key
  const last = current.at(-1)
  const namedAtEnd = (key: string) => !!last && numberOf(last.datum[key]) !== null
  return (
    <div
      data-slot='bump-chart-names'
      data-side={side}
      // With the lines drawn in, the end's names wait for the lines to reach them.
      data-held={
        side === 'end' && family.entrance === 'draw' && !entered ? '' : undefined
      }
      aria-hidden
      // The ranks take the width of the longest, so the names beside them line up.
      style={{ '--bump-rank': `${String(scale.ticks.length).length}ch` } as CSSProperties}
      className={cn(
        'text-muted-foreground relative grid min-h-0 min-w-0 transition-opacity delay-[calc(var(--motion-draw-duration)*0.5)] duration-[calc(var(--motion-draw-duration)*0.5)] ease-(--motion-draw-fade-easing) select-none data-held:opacity-0',
        side === 'start'
          ? 'pe-2.5 [grid-area:start-axis]'
          : 'ps-2.5 [grid-area:end-axis]',
        className,
      )}
      {...props}
    >
      {/*
        The longest name holds the column open, up to its cap; the names
        themselves are placed. A pixel over it, since a track rounds a name's
        fractional width down and would cut it by a hair.
      */}
      <span className='invisible col-start-1 row-start-1 grid'>
        {series.map((key) => (
          <span key={key} className='col-start-1 row-start-1 flex max-w-[28cqw] gap-1.5'>
            <span
              className={cn(
                'min-w-0 overflow-hidden pe-px font-medium',
                side === 'start' && namedAtEnd(key) && startNamesNarrow,
              )}
            >
              {labelOf(key)}
            </span>
            <span className='w-(--bump-rank) shrink-0' />
          </span>
        ))}
      </span>
      <span className={axisLayerClassName}>
        {/* Each row's rank, beside the plot: it stays in its row while names glide past it. */}
        {scale.ticks.map((row) => {
          const key = series.find(
            (key) =>
              period && numberOf(period.datum[key]) === row && !hidden.includes(key),
          )
          const rank = key === undefined || !period ? null : rankOf(period, key)
          return (
            <span
              key={row}
              data-gone={ready && rank !== null ? undefined : ''}
              data-lit={emphasis !== null && emphasis === key ? '' : undefined}
              className={cn(
                slideLine.y,
                'transition-[color,opacity] duration-(--motion-layout-duration) ease-(--motion-layout-fade-easing) data-gone:opacity-0 data-lit:text-foreground forced-colors:text-[CanvasText]',
              )}
              style={{ translate: `0 ${rowOf(row, scale) * 100}cqh` }}
            >
              <span
                className={cn(
                  'absolute top-0 w-(--bump-rank) -translate-y-1/2 text-end tabular-nums',
                  side === 'start' ? nameInset.start : nameInset.end,
                )}
              >
                {rank === null ? null : rankText(rank)}
              </span>
            </span>
          )
        })}
        {series.map((key) => {
          const place = now[key] ?? places[key]
          if (place === undefined) return null
          const there = ready && key in now && !hidden.includes(key)
          return (
            <NameSlide
              key={key}
              at={place}
              data-gone={there ? undefined : ''}
              className={cn(side === 'start' && namedAtEnd(key) && startNamesNarrow)}
            >
              <CutTooltip
                render={
                  <span
                    data-dim={emphasis !== null && emphasis !== key ? '' : undefined}
                    onPointerEnter={() => {
                      if (there) setEmphasis(key)
                    }}
                    onPointerLeave={() => setEmphasis(null)}
                    className={cn(
                      'text-foreground data-dim:text-muted-foreground absolute top-0 flex -translate-y-1/2 font-medium whitespace-nowrap transition-colors duration-(--motion-layout-duration) ease-(--motion-layout-fade-easing) forced-colors:text-[CanvasText]',
                      // The name takes the pointer from the plot's edge, over its rank.
                      side === 'start' ? nameInset.startReach : nameInset.endReach,
                      side === 'start' ? nameInset.startName : nameInset.endName,
                      // The layer lets the pointer through; a name that shows takes it.
                      there && 'pointer-events-auto',
                    )}
                  >
                    <span data-cut className='truncate'>
                      {labelOf(key)}
                    </span>
                  </span>
                }
              />
            </NameSlide>
          )
        })}
      </span>
    </div>
  )
}

/** The number a name glides on, from 0 where it was to 1 where it goes, written each frame of the chart's move, as a line's points are. */
const NAME_PROGRESS = '--bump-name-progress'

/**
 * One name's row, `at` a fraction of the plot from its top. A new row
 * glides it there from where it shows, on the same role, start and length
 * as the lines' move, so a move cut short turns both back alike and the
 * name stays on its line's end.
 */
function NameSlide({
  at,
  className,
  style,
  ...props
}: Omit<ComponentProps<'span'>, 'children'> & { at: number; children: ReactNode }) {
  const ref = useRef<HTMLSpanElement>(null)
  const moves = useChartMoves()
  const glide = useRef<NameGlide>({ from: at, to: at, run: null, stop: () => {} })
  useLayoutEffect(() => {
    const element = ref.current
    const was = glide.current
    if (!element || at === was.to) return
    // From where it shows now, mid-glide too.
    const shown =
      was.from + (was.to - was.from) * (was.run?.running() ? was.run.progress() : 1)
    was.stop()
    element.style.setProperty('--name-from', `${shown * 100}cqh`)
    const write = (progress: number) =>
      element.style.setProperty(NAME_PROGRESS, String(progress))
    // On a chart not yet painted, it is there at once.
    if (!element.closest('[data-mounted]')) {
      write(1)
      glide.current = { from: shown, to: at, run: null, stop: () => {} }
      return
    }
    write(0)
    const { run, stop } = moves.follow('layout', write)
    glide.current = { from: shown, to: at, run, stop }
  }, [at, moves])
  useLayoutEffect(() => () => glide.current.stop(), [])
  return (
    <span
      ref={ref}
      className={cn(
        slideLine.y,
        '[translate:0_calc(var(--name-from,var(--name-to))+(var(--name-to)-var(--name-from,var(--name-to)))*var(--bump-name-progress,1))] transition-none group-data-mounted/chart:transition-opacity duration-(--motion-layout-duration) ease-(--motion-layout-fade-easing) data-gone:opacity-0',
        className,
      )}
      style={{ '--name-to': `${at * 100}cqh`, ...style } as CSSProperties}
      {...props}
    />
  )
}

/** A name's glide: from where it was, to where it goes, on its run of the chart's moves. */
interface NameGlide {
  from: number
  to: number
  run: MoveRun | null
  stop: () => void
}

/**
 * In a chart as narrow as a phone's, names at both ends would leave the
 * lines little room: with names at the end too, the start keeps its ranks
 * and names only the lines that don't reach the end.
 */
const startNamesNarrow =
  '@max-[20rem]/chart:group-has-[[data-slot=bump-chart-names][data-side=end]]/chart:hidden'

/**
 * Where the ranks and the names sit in their column: the ranks clear of a
 * line's end dot, which reaches 0.25rem past the plot, and the names past
 * the ranks, as wide as the column leaves them.
 */
const nameInset = {
  start: 'end-2.5',
  end: 'start-2.5',
  startName: 'end-[calc(1rem+var(--bump-rank))] max-w-[calc(100%-1rem-var(--bump-rank))]',
  endName: 'start-[calc(1rem+var(--bump-rank))] max-w-[calc(100%-1rem-var(--bump-rank))]',
  startReach:
    'before:absolute before:inset-y-0 before:start-0 before:-end-[calc(1rem+var(--bump-rank))]',
  endReach:
    'before:absolute before:inset-y-0 before:end-0 before:-start-[calc(1rem+var(--bump-rank))]',
} as const

export {
  Bump,
  BumpChart,
  type BumpChartMessages,
  type BumpChartProps,
  BumpNames,
  type BumpProps,
  type BumpRankBy,
  bumpRanks,
  nearestLine,
  rankCount,
  rankMove,
  rankOrder,
  stepRank,
}
