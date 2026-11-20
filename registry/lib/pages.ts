/*
 * The arithmetic of pages, for everything that splits items into them: the
 * Pagination and the table data. Pages are counted from 1.
 */

/** `page` as a whole page from 1 to `pageCount`, which may be `Infinity` while the count is unknown. */
export function clampPage(page: number, pageCount: number): number {
  if (!Number.isFinite(page)) return 1
  return Math.min(Math.max(1, Math.round(page)), Math.max(1, Math.floor(pageCount)))
}

/** How many pages `count` items take; one page when nothing pages them, or when there are none. */
export function pageCountOf(count: number, pageSize: number | undefined): number {
  if (!pageSize || pageSize <= 0) return 1
  return Math.max(1, Math.ceil(Math.max(0, count) / pageSize))
}

/** The items a page shows, from 1, out of `count`: 11–20 of 42, or 0–0 of 0. */
export function pageRange(
  page: number,
  pageSize: number | undefined,
  count: number,
): { from: number; to: number; of: number } {
  if (count <= 0) return { from: 0, to: 0, of: 0 }
  if (!pageSize || pageSize <= 0) return { from: 1, to: count, of: count }
  const from = (page - 1) * pageSize + 1
  return {
    from: Math.min(from, count),
    to: Math.min(page * pageSize, count),
    of: count,
  }
}

/** The page that holds the first item of `page` once a page holds `to` items instead of `from`. */
export function pageForSize(page: number, from: number, to: number): number {
  if (from <= 0 || to <= 0) return 1
  return Math.floor(((Math.max(1, page) - 1) * from) / to) + 1
}
