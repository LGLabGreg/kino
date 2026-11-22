'use client'

import {
  type ActiveIndexProps,
  type CategoryChartProps,
  writeDatum,
  IndexActive,
  useChartLife,
  useChartLoad,
  useChartPick,
  useIndexFocus,
  useLeavingItems,
} from '@/registry/lib/chart-base'
import type { ListStop } from '@/registry/lib/chart-list-reader'
import type { ChartDatum } from '@/registry/lib/chart-math'
import {
  ChartFrame,
  type ChartReader,
  type ChartRootState,
  type ChartRootValue,
  useChartRoot,
} from '@/registry/lib/chart-root'
import { type ChartStatus, indexOfKey } from '@/registry/lib/chart-state'
import type { ComponentProps, ReactNode, Ref } from 'react'

/*
 * What the charts whose stops are a list share on the root: the Donut, the
 * Radial chart and the Radar. Each row of the data is a stop, kept by its
 * key while it leaves, and the chart hands the root a list reader
 * (`chart-list-reader`) for them. The chart draws its own marks and works
 * out its own words; this keeps the rest the same for every one of them.
 */

/** A stop to draw: still in the data, or leaving it, where it keeps its last place. */
type ListChartStop = ListStop & { datum: ChartDatum; leaving: boolean }

/** What a list chart keeps before it draws its marks. */
interface ListChart {
  state: ChartRootState
  /** The rows of the data, none while it loads or failed. */
  rows: readonly ChartDatum[]
  /** The rows still drawn with the hidden series hidden. */
  drawn: readonly ChartDatum[]
  /** The series not hidden. */
  shown: readonly string[]
  /** The stops still in the data, in its order. */
  current: readonly (ListStop & { datum: ChartDatum })[]
  /** Every stop to draw, the leaving ones too, in a fixed order that sorting the data doesn't change. */
  stops: readonly ListChartStop[]
  status: ChartStatus
  /** The placeholder shows while the data loads. */
  placeholder: boolean
  /** The entrance is playing. */
  entering: boolean
  /** The entrance has played, or wasn't asked for. */
  entered: boolean
  /** The key of the stop picked, or null. */
  picked: string | null
  selectable: boolean
  /** Picks the stop keyed `key`, or lets it go if it was picked. */
  togglePicked: (key: string) => void
  activeProps: ActiveIndexProps
  /** How a stop is named: the chart's `categoryFormat`, or `String`. */
  stopText: (value: unknown) => string
  /** Anything under a series' key as the chart writes it: a number, a `[from, to]` range, or no value. */
  datumText: (value: unknown) => string
}

/** What the frame of a chart whose stops are held by key reads of it: a list chart's, or the Waffle's, whose remaining room is a stop with no row. */
type ListChartRoot = Pick<
  ListChart,
  'state' | 'status' | 'drawn' | 'selectable' | 'picked' | 'togglePicked' | 'activeProps'
>

/** The rows of a chart that loads or failed: one array, so what compares rows sees no change. */
const NO_ROWS: readonly ChartDatum[] = []

/**
 * A list chart's root state, its rows and its stops, what it shows, where
 * its entrance is and what is picked. With `rowsAreSeries`, each row is a
 * series of its own under the chart's `index`, as a donut's slices are, so
 * hiding the series takes its row out.
 */
function useListChart(
  props: CategoryChartProps,
  { entrance, rowsAreSeries }: { entrance: boolean; rowsAreSeries: boolean },
): ListChart {
  const { data, index, categoryFormat = String } = props
  const state = useChartRoot(props, { entrance, heightFromData: false })
  const load = useChartLoad(props)
  const rows = load.placeholder || load.failed ? NO_ROWS : data
  const keyOf = (row: ChartDatum) => String(row[index])
  const drawn = rowsAreSeries
    ? rows.filter((row) => !state.hidden.includes(keyOf(row)))
    : rows
  const shown = state.series.filter((key) => !state.hidden.includes(key))
  const current = drawn.map((datum, at) => ({
    key: keyOf(datum),
    value: datum[index],
    datum,
    index: at,
  }))
  const stops = useLeavingItems(state.moves, current, stopKey)
  const { status, phase, entered } = useChartLife(
    props,
    state,
    load,
    { rows: rows.length, shown: shown.length, drawn: drawn.length },
    { entrance, cascade: null },
  )
  const keys = current.map(stopKey)
  const pick = useChartPick(props, keys)
  return {
    state,
    rows,
    drawn,
    shown,
    current,
    stops,
    status,
    placeholder: load.placeholder,
    entering: phase === 'entering',
    entered,
    picked: pick.picked,
    selectable: pick.selectable,
    togglePicked: (key) => {
      if (indexOfKey(keys, key) !== null) pick.toggle(key)
    },
    activeProps: {
      activeIndex: props.activeIndex,
      defaultActiveIndex: props.defaultActiveIndex ?? null,
      onActiveIndexChange: props.onActiveIndexChange,
    },
    stopText: categoryFormat,
    datumText: (value) => writeDatum(value, state.valueText, state.messages.noValue),
  }
}

function stopKey(stop: { key: string }) {
  return stop.key
}

/**
 * The `<figure>` of a list chart, on the root's frame: its reader, the focus
 * by the stops' places for `activeIndex`, its marks and its placeholder.
 */
function ListChartFrame({
  chart,
  reader,
  slot,
  description,
  empty,
  measuring,
  placeholder,
  children,
  ...props
}: Omit<ComponentProps<'figure'>, 'ref'> & {
  chart: ListChartRoot
  reader: ChartReader
  slot: string
  description?: string
  empty?: ReactNode
  /**
   * Whether the chart's range needs its plot's size. It waits for it unseen,
   * as `ChartFrame` does, only while it has rows to draw: the placeholder,
   * no data and the error show at once.
   */
  measuring: boolean
  placeholder: ReactNode
  ref?: Ref<HTMLElement>
}) {
  const root: ChartRootValue = {
    ...chart.state,
    status: chart.status,
    reader,
    markerOf: () => null,
    selectable: chart.selectable,
    picked: chart.picked === null ? null : { kind: 'x', key: chart.picked },
    togglePicked: (target) => {
      if (target.kind !== 'node') chart.togglePicked(target.key)
    },
  }
  const { focusProps, toldRef } = useIndexFocus(reader.items, chart.activeProps)
  return (
    <ChartFrame
      root={root}
      focus={focusProps}
      slot={slot}
      description={description}
      empty={empty}
      measuring={measuring && chart.drawn.length > 0}
      inset={0}
      {...props}
    >
      <IndexActive items={reader.items} active={chart.activeProps} toldRef={toldRef}>
        {children}
        {placeholder}
      </IndexActive>
    </ChartFrame>
  )
}

export {
  type ListChart,
  ListChartFrame,
  type ListChartRoot,
  type ListChartStop,
  useListChart,
}
