import type { MarkKind } from '@/registry/lib/chart-frame'
import { highestPlace, valueExtent, valueSpans } from '@/registry/lib/chart-line-marks'
import { numberExtent } from '@/registry/lib/chart-scale'

/*
 * Points: each series' value in a row is a point, as a scatter's are. A
 * value axis that only points stand on fits them with no room to spare,
 * and a single value sits in the middle of a range around it.
 */

const pointMarks: MarkKind = {
  mark: 'point',
  stacks: false,
  spans: ({ rows, series, shown }) => {
    const reached = valueExtent(rows, shown)
    return {
      spans: valueSpans(rows, series),
      extent: reached && numberExtent(reached),
    }
  },
  // Over the highest of the row's points.
  reach: highestPlace,
}

export { pointMarks }
