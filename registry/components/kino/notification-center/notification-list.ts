import { compareInstants, wallClock } from '@/registry/lib/dates'
import type { ReactNode } from 'react'

/*
 * What a notification center holds and works out, outside the DOM: the
 * notifications, which of them a tab shows, how many are unread, the days
 * they fall on, and where focus goes when one leaves.
 */

/** A thing to do from the row itself, such as accepting an invite. */
export interface NotificationAction {
  /** What the button says, such as "Accept". */
  label: string
  /** The button's look: the row's main action, or one beside it. */
  variant?: 'primary' | 'secondary'
  /** Runs when it's pressed; a promise holds the row's buttons until it settles. */
  run: () => void | Promise<void>
  /** What the row says once it has run, such as "You joined Design review". */
  done: ReactNode
}

export interface NotificationItem {
  id: string
  /** When it happened, as an ISO instant: `2026-11-17T09:42:00Z`. */
  at: string
  read: boolean
  /** What happened, such as "Maya Chen assigned you KIN-142". It names the row. */
  title: ReactNode
  /** A line of detail under the title, such as a comment's first words. */
  description?: ReactNode
  /** Who did it, as an Avatar, or an icon for news from the app itself. */
  media?: ReactNode
  /** Where opening the row goes. Opening it marks it read. */
  href?: string
  /** Things to do from the row, where the direction shows them. */
  actions?: NotificationAction[]
  /** Which of its `actions` was taken, by index: the row shows that action's `done`. */
  done?: number
}

/** Which notifications show: every one, or only those still unread. */
export type NotificationTab = 'all' | 'unread'

/** What changed, so the app can tell its server. */
export interface NotificationChange {
  reason: 'read' | 'unread' | 'action' | 'archive' | 'restore'
  ids: string[]
  /** With `action`: which of the row's actions was taken, by index. */
  action?: number
}

/** How many are unread. */
export function unreadCount(items: readonly NotificationItem[]): number {
  return items.reduce((count, item) => count + (item.read ? 0 : 1), 0)
}

/** A count as a badge shows it: up to `max`, then `max+`. */
export function countLabel(count: number, max = 99): string {
  return count > max ? `${max}+` : String(count)
}

/** The bell's name, with how many are unread: "Notifications, 3 unread". */
export function bellLabel(title: string, count: number): string {
  return count > 0 ? `${title}, ${count} unread` : title
}

/** The notifications `tab` shows, newest first; Unread also shows those `kept` there once read. */
export function visibleItems(
  items: readonly NotificationItem[],
  tab: NotificationTab,
  kept: readonly string[] = [],
): NotificationItem[] {
  return items
    .filter((item) => tab === 'all' || !item.read || kept.includes(item.id))
    .sort((a, b) => compareInstants(b.at, a.at))
}

/** Notifications that fall on one day (`yyyy-mm-dd`), in the order given. */
export interface DayGroup {
  day: string
  items: NotificationItem[]
}

/** `items`, newest first, split into the days they fall on in `timeZone`. */
export function dayGroups(
  items: readonly NotificationItem[],
  timeZone?: string,
): DayGroup[] {
  const groups: DayGroup[] = []
  for (const item of items) {
    const day = wallClock(item.at, timeZone).slice(0, 10)
    const last = groups.at(-1)
    if (last?.day === day) last.items.push(item)
    else groups.push({ day, items: [item] })
  }
  return groups
}

/** `items` with those in `ids` marked read, or unread. */
export function markRead(
  items: readonly NotificationItem[],
  ids: readonly string[],
  read: boolean,
): NotificationItem[] {
  const marked = new Set(ids)
  return items.map((item) =>
    marked.has(item.id) && item.read !== read ? { ...item, read } : item,
  )
}

/** `items` without those in `ids`. */
export function withoutItems(
  items: readonly NotificationItem[],
  ids: readonly string[],
): NotificationItem[] {
  const gone = new Set(ids)
  return items.filter((item) => !gone.has(item.id))
}

/** What one archive took, and where each was in the list then, first to last. */
export interface Archived {
  items: NotificationItem[]
  at: number[]
}

/** The items each archive took out of `items`, `taken` in the order they were made, put back where they were. */
export function restoreItems(
  items: readonly NotificationItem[],
  taken: readonly Archived[],
): NotificationItem[] {
  const next = [...items]
  for (const archived of [...taken].reverse()) {
    archived.items.forEach((item, index) => {
      next.splice(Math.min(archived.at[index] ?? next.length, next.length), 0, item)
    })
  }
  return next
}

/**
 * The row focus goes to when the rows in `leaving` leave a list shown in
 * `order` while focus is on `from`: the next one that stays, else the one
 * before. Null when none stays, or focus wasn't on one that leaves.
 */
export function focusAfterLeaving(
  order: readonly string[],
  leaving: readonly string[],
  from: string,
): string | null {
  const gone = new Set(leaving)
  if (!gone.has(from)) return null
  const at = order.indexOf(from)
  if (at === -1) return null
  const after = order.slice(at + 1).find((id) => !gone.has(id))
  if (after) return after
  return (
    order
      .slice(0, at)
      .reverse()
      .find((id) => !gone.has(id)) ?? null
  )
}
