import type { MarkKind, SeriesSpans } from '@/registry/lib/chart-frame'
import { type ChartDatum, numberOf, type Span } from '@/registry/lib/chart-math'
import type { Band, LinearScale } from '@/registry/lib/chart-scale'
import type { LinePoint } from '@/registry/lib/line-path'

/*
 * Lines: each series' line runs through its values, one for each category,
 * and never stacks. Its span in a row is its value at both ends. The points
 * a line or an area is drawn through, as fractions of the plot, come from
 * here too.
 */

const lineMarks: MarkKind = {
  mark: 'line',
  stacks: false,
  spans: ({ rows, series, shown }) => ({
    spans: valueSpans(rows, series),
    extent: valueExtent(rows, shown),
  }),
  // Over the highest of the row's points.
  reach: highestPlace,
}

/** Each series' value in every row, as a span from it to itself, null where it is missing. */
function valueSpans(rows: readonly ChartDatum[], series: readonly string[]): SeriesSpans {
  return Object.fromEntries(
    series.map((key) => [
      key,
      rows.map((row): Span | null => {
        const value = numberOf(row[key])
        return value === null ? null : [value, value]
      }),
    ]),
  )
}

/** The lowest and highest values of `keys` in `rows`, or null with none. */
function valueExtent(rows: readonly ChartDatum[], keys: readonly string[]): Span | null {
  const values = rows.flatMap((row) =>
    keys.flatMap((key) => {
      const value = numberOf(row[key])
      return value === null ? [] : [value]
    }),
  )
  return values.length === 0 ? null : [Math.min(...values), Math.max(...values)]
}

/** The highest place on `scale` the far end of a shown series' span reaches in row `index`, or null with none. */
function highestPlace(
  spans: SeriesSpans,
  shown: readonly string[],
  index: number,
  scale: LinearScale,
): number | null {
  let far: number | null = null
  for (const key of shown) {
    const span = spans[key]?.[index]
    if (!span) continue
    const place = scale.place(span[1])
    far = far === null ? place : Math.max(far, place)
  }
  return far
}

/**
 * A series' points through `categories`, as fractions of the plot from the
 * reading start and the top: the line at the far end of its span, and with
 * `withBase`, an area's baseline at the near end. Where it has no value,
 * and all along when it lies `flat`, they sit on `baseline`, the fraction of
 * the value axis marks grow from.
 */
function seriesPoints(
  categories: readonly { key: string; index: number; band: Band }[],
  spans: readonly (Span | null)[],
  scale: LinearScale,
  baseline: number,
  flat: boolean,
  withBase: boolean,
): LinePoint[] {
  const rest = 1 - baseline
  return categories.map((category) => {
    const own = spans[category.index] ?? null
    const span = flat ? null : own
    return {
      key: category.key,
      x: category.band.start,
      y: span ? 1 - scale.place(span[1]) : rest,
      ...(withBase ? { base: span ? 1 - scale.place(span[0]) : rest } : {}),
      defined: own !== null,
    }
  })
}

export { highestPlace, lineMarks, seriesPoints, valueExtent, valueSpans }
