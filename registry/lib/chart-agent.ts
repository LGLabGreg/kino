import type { ChartStatus, ChartTable } from '@/registry/lib/chart-state'
import { definePrimitive } from '@ui-sdk/core'

/*
 * A chart as an agent reads and drives it: the chart root's figure, which
 * `snapshot()` names by the chart's `label`, with its description as text,
 * its status, and its data table as its value. On a chart the keys browse,
 * `focus` moves the browse stop to the stop a row of the table names and
 * shows its tooltip, `open` does what Enter does on it, such as zooming a
 * Treemap in, and `back` what Escape does: each runs the moves the keys
 * run, which the chart hands in. A chart the keys don't browse, such as the
 * Bar list, has no table and no actions: its rows are links and buttons an
 * agent finds as they are.
 */

/** A chart's data table as an agent reads it: its words, without the keys the page holds rows by. */
interface ChartAgentTable {
  header: string
  columns: readonly string[]
  rows: readonly { name: string; cells: readonly string[] }[]
  footer: readonly string[]
}

/** A row of the table as an item an agent names: its key as the value, its name as the label. */
interface ChartAgentRow {
  value: string
  label: string
}

/** What the browse stop does for an agent, as the keys do it. Each throws, with why, when it can't. */
interface ChartAgentMoves {
  /** Moves the browse stop to the stop held by `key` and shows its tooltip. */
  focus: (key: string) => void
  /** Opens the stop held by `key`, as Enter does. */
  open: (key: string) => void
  /** Lets go of the stop the browse stop is on, and goes back out, as Escape does. */
  back: () => void
}

type ChartAgentOptions = {
  status?: ChartStatus
  /** The data table, or null on a chart the keys don't browse. An agent reads it only while the chart is `ready`. */
  table?: ChartTable | null
  /** The browse stop's moves, or null on a chart the keys don't browse. Fixed for the chart's life. */
  moves?: ChartAgentMoves | null
}

/** The table's words, as `snapshot()` shows them. */
function agentTable(table: ChartTable | null): ChartAgentTable | null {
  if (table === null) return null
  return {
    header: table.header,
    columns: table.columns,
    rows: table.rows.map((row) => ({ name: row.name, cells: row.cells })),
    footer: table.footer,
  }
}

/** What the chart holds now: its table only once it shows, as a screen reader's table is. */
function stateOf(options: ChartAgentOptions): {
  status: ChartStatus
  value: ChartAgentTable | null
} {
  const status = options.status ?? 'loading'
  return {
    status,
    value: status === 'ready' ? agentTable(options.table ?? null) : null,
  }
}

/** The table's rows as the items an agent names them by. */
function agentRows(table: ChartTable | null | undefined): ChartAgentRow[] {
  return (table?.rows ?? []).map((row) => ({
    value: row.key,
    label: row.name,
  }))
}

const chart = definePrimitive({
  name: 'chart',
  options: { status: 'string', table: 'value', moves: 'value' },
  controlled: ['status', 'value'],
  state: (options: ChartAgentOptions) => stateOf(options),
  sync: (options) => stateOf(options),
  api: (context) => {
    const moves = () => {
      const { moves: own, status } = context.options()
      if (!own) throw new Error('This chart has nothing to browse.')
      if (status !== 'ready') throw new Error(`The chart is ${status} now.`)
      return own
    }
    const rows = () =>
      context.options().status === 'ready' ? agentRows(context.options().table) : []
    // A chart that doesn't browse offers no moves at all, rather than moves that always fail.
    if (!context.options().moves) return { rows }
    return {
      rows,
      /** Moves the browse stop to the row with this key, and shows its tooltip. */
      focus: (key: string) => moves().focus(key),
      /** Opens the row with this key, as Enter does: a Treemap or a Sunburst zooms into it. */
      open: (key: string) => moves().open(key),
      /** Closes the tooltip and goes back out of what was opened, as Escape does. */
      back: () => moves().back(),
    }
  },
  slots: (slot) => ({
    root: slot({}),
    description: slot({}),
  }),
  agent: {
    actions: ['focus', 'open', 'back'],
    closed: true,
    items: (api) => api.rows(),
  },
})

export type { ChartAgentMoves, ChartAgentTable }
export { chart }
