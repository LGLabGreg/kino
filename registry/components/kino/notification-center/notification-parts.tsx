'use client'

import { AnimatedNumber } from '@/registry/components/kino/animated-number'
import { Badge } from '@/registry/components/kino/badge'
import { Button } from '@/registry/components/kino/button'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/registry/components/kino/empty'
import { NotificationBell } from '@/registry/components/kino/notification-center/notification-bell'
import {
  type Archived,
  dayGroups,
  focusAfterLeaving,
  markRead,
  type NotificationChange,
  restoreItems,
  type NotificationItem,
  type NotificationTab,
  unreadCount,
  visibleItems,
  withoutItems,
} from '@/registry/components/kino/notification-center/notification-list'
import {
  Popover,
  PopoverBody,
  PopoverClose,
  PopoverContent,
  PopoverFooter,
  PopoverHeader,
  type PopoverOpenChangeDetails,
  PopoverTitle,
} from '@/registry/components/kino/popover'
import { Tabs, TabsList, TabsPanel, TabsTab } from '@/registry/components/kino/tabs'
import {
  Tooltip,
  TooltipContent,
  TooltipGroup,
  TooltipTrigger,
} from '@/registry/components/kino/tooltip'
import { IconPlaceholder } from '@/registry/icons/icon-placeholder'
import { announce } from '@/registry/lib/announce'
import { useControllable } from '@/registry/lib/controllable'
import {
  clockTime,
  dayHeading,
  instantLabel,
  timeAgo,
  useLocale,
  wallClock,
} from '@/registry/lib/dates'
import { useFlow } from '@/registry/lib/flow'
import {
  followPointer,
  itemMatching,
  rowHighlightClassName,
  tintedRowTextClassName,
} from '@/registry/lib/highlight'
import { markMounted, mergeRefs } from '@/registry/lib/refs'
import { Swap } from '@/registry/lib/swap'
import {
  type ComponentType,
  createContext,
  type MouseEvent,
  type ReactNode,
  use,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'

import { cn } from '@/lib/utils'

/*
 * What every notification center shares: the bell, the panel it opens (a
 * popover, or a bottom sheet on a phone unless motion is reduced), the All and Unread tabs, the days
 * the notifications fall on, and the rows' common parts. A row that leaves
 * fades where it was on `exit` while the rows under it glide up on `layout`
 * to close its gap (`useFlow`), and focus moves to the row that takes its
 * place. Nothing is marked read by being seen: only by opening the row, its
 * own button, or Mark all as read.
 */

export interface NotificationCenterProps {
  /** The notifications, newest or oldest first. Give them with `onNotificationsChange` to own them. */
  notifications?: NotificationItem[]
  defaultNotifications?: NotificationItem[]
  /** Called with the notifications after a change, and what changed, so the app can tell its server. */
  onNotificationsChange?: (
    notifications: NotificationItem[],
    change: NotificationChange,
  ) => void
  /** Called when a row is opened, before its link is followed; the panel then closes. */
  onOpenNotification?: (item: NotificationItem, event: MouseEvent) => void
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean, details: PopoverOpenChangeDetails) => void
  /** Which notifications show: `all`, or only those still `unread`. */
  tab?: NotificationTab
  defaultTab?: NotificationTab
  onTabChange?: (tab: NotificationTab) => void
  /** Whether the popover holds the focus and makes the page inert. The sheet on a phone always does. */
  modal?: boolean
  /** What the notifications are called: the panel's title and the bell's name. */
  title?: string
  /** Under the list, such as a link to the notification settings. */
  footer?: ReactNode
  /** The locale times and days are written in; the browser's when left out. */
  locale?: string
  /** The time zone days start in; the visitor's own when left out. */
  timeZone?: string
  /** For the bell's place in the page. */
  className?: string
}

interface CenterContextValue {
  locale: string
  timeZone: string | undefined
  /** The time now, in ms, a minute at a time; null until the browser has it. */
  now: number | null
  /** Every notification, in the order given. */
  items: NotificationItem[]
  setRead: (item: NotificationItem, read: boolean) => void
  /** Records that the row's action at `index` was taken: it is read, and in Unread it stays until the tab changes. */
  act: (item: NotificationItem, index: number) => void
  /** Takes these out of the list, to be put back with `restore`. */
  archive: (archived: NotificationItem[]) => void
  /** Puts back what archives took, latest last, each where it was, and focuses the first. */
  restore: (taken: readonly Archived[]) => void
  /** Moves focus to the row's title, once it has rendered. */
  focusRow: (item: NotificationItem) => void
  open: (item: NotificationItem, event: MouseEvent) => void
  /** Whether a row can be opened: it has a link, or the app listens. */
  opens: (item: NotificationItem) => boolean
}

const CenterContext = createContext<CenterContextValue | null>(null)

function useCenter() {
  const center = use(CenterContext)
  if (!center)
    throw new Error('A notification part must sit inside its NotificationCenter.')
  return center
}

/** The id of the row's title, which names it and describes its buttons. */
const RowContext = createContext<{
  item: NotificationItem
  titleId: string
} | null>(null)

function useRow() {
  const row = use(RowContext)
  if (!row) throw new Error('A notification row part must sit inside NotificationRow.')
  return row
}

/*
 * The time now, a minute at a time, shared by every open panel. On the server,
 * and before hydration, there is none, so a time is never written twice.
 */
let minute = 0
const MINUTE = 60_000

function watchMinutes(change: () => void) {
  const tick = () => {
    minute = Date.now()
    change()
  }
  tick()
  const timer = setInterval(tick, MINUTE)
  return () => clearInterval(timer)
}

function useNow(): number | null {
  return useSyncExternalStore(
    watchMinutes,
    () => minute || null,
    () => null,
  )
}

/** The words a screen reader hears after a change. */
function changeMessage(change: NotificationChange): string {
  const many = change.ids.length > 1
  if (change.reason === 'read') return many ? 'All marked as read' : 'Marked as read'
  if (change.reason === 'unread') return 'Marked as unread'
  if (change.reason === 'action') return ''
  // Undo is at the bottom of the panel, which Tab reaches last.
  if (change.reason === 'archive')
    return `${many ? `${change.ids.length} archived` : 'Archived'}. Undo is at the bottom of the panel.`
  return many ? `${change.ids.length} restored` : 'Restored'
}

/**
 * The notification center's state, the bell and the panel, which each
 * variant fills: `Header` is what acts on every row, beside the title;
 * `row` draws one notification; `below` sits over the footer, such as an
 * undo.
 */
function NotificationShell({
  notifications,
  defaultNotifications = [],
  onNotificationsChange,
  onOpenNotification,
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  tab: tabProp,
  defaultTab = 'all',
  onTabChange,
  modal,
  title = 'Notifications',
  footer,
  locale: localeProp,
  timeZone,
  className,
  header: Header,
  row,
  empty,
  below,
  onArchived,
}: NotificationCenterProps & {
  /** A component, not a function called here: it gets handlers that read the latest list. */
  header: ComponentType<{ unread: number; markAllRead: () => void }>
  row: (item: NotificationItem) => ReactNode
  /** The empty state of each tab. */
  empty: Record<NotificationTab, { title: string; description: string }>
  below?: ReactNode
  /** Called with what an archive took, so a direction can offer it back. */
  onArchived?: (taken: Archived) => void
}) {
  const locale = useLocale(localeProp)
  const now = useNow()
  const [items, setItems] = useControllable(
    notifications,
    defaultNotifications,
    undefined,
  )
  const [tab, changeTab] = useControllable(tabProp, defaultTab, onTabChange)
  // Rows answered in Unread stay there, read, until the tab changes or the panel closes, so
  // what the answer did can be seen.
  const [kept, setKept] = useState<readonly string[]>([])
  const setTab = (next: NotificationTab) => {
    setKept([])
    changeTab(next)
  }
  const [isOpen, setOpen] = useControllable<boolean, [PopoverOpenChangeDetails]>(
    openProp,
    defaultOpen,
    onOpenChange,
  )
  const changeOpen = (next: boolean, details: PopoverOpenChangeDetails) => {
    setOpen(next, details)
    if (!next && !details.canceled) setKept([])
  }
  // What a handler that runs later, such as an action's once its promise
  // settles, works on: the list and the tab as they are then.
  const latest = useRef({ items, tab })
  useLayoutEffect(() => {
    latest.current = { items, tab }
  })
  const unread = unreadCount(items)

  // A notification that arrives is heard, with how many are unread now; one
  // marked unread again, or put back, is not new.
  const known = useRef<Set<string> | null>(null)
  useEffect(() => {
    const seen = known.current
    known.current = new Set([...(seen ?? []), ...items.map((item) => item.id)])
    if (!seen) return
    const arrived = items.filter((item) => !item.read && !seen.has(item.id)).length
    if (arrived === 0) return
    announce(
      `${arrived === 1 ? 'New notification' : `${arrived} new notifications`}. ${unreadCount(items)} unread`,
    )
  }, [items])

  const change = (next: NotificationItem[], what: NotificationChange) => {
    setItems(next)
    latest.current = { ...latest.current, items: next }
    onNotificationsChange?.(next, what)
    announce(changeMessage(what))
  }

  // Where focus goes once a row that had it leaves.
  const [focusNext, setFocusNext] = useState<{
    id: string | null
    control: string
  } | null>(null)
  const leave = (leaving: string[]) => {
    const active = document.activeElement
    const from = active?.closest<HTMLElement>('[data-notification-id]')
    if (!from) return
    const now = latest.current
    const order = visibleItems(now.items, now.tab, kept).map((item) => item.id)
    setFocusNext({
      id: focusAfterLeaving(order, leaving, from.dataset.notificationId ?? ''),
      control: active?.getAttribute('data-notification-control') ?? 'open',
    })
  }

  const api: CenterContextValue = {
    locale,
    timeZone,
    now,
    setRead: (item, read) => {
      const now = latest.current
      if (now.tab === 'unread' && read) leave([item.id])
      change(markRead(now.items, [item.id], read), {
        reason: read ? 'read' : 'unread',
        ids: [item.id],
      })
    },
    act: (item, index) => {
      const now = latest.current
      if (now.tab === 'unread') setKept((was) => [...was, item.id])
      change(
        now.items.map((each) =>
          each.id === item.id ? { ...each, read: true, done: index } : each,
        ),
        { reason: 'action', ids: [item.id], action: index },
      )
    },
    items,
    archive: (archived) => {
      if (archived.length === 0) return
      const now = latest.current
      const ids = archived.map((item) => item.id)
      leave(ids)
      // Where each was, put back first to last so each lands where it was.
      const at = ids.map((id) => now.items.findIndex((item) => item.id === id))
      const order = at.map((_, index) => index).sort((a, b) => at[a] - at[b])
      change(withoutItems(now.items, ids), { reason: 'archive', ids })
      onArchived?.({
        items: order.map((index) => archived[index]),
        at: order.map((index) => at[index]),
      })
    },
    restore: (taken) => {
      const ids = taken.flatMap((archived) => archived.items.map((item) => item.id))
      change(restoreItems(latest.current.items, taken), { reason: 'restore', ids })
      // What restored them is about to go: focus goes to the first one back.
      setFocusNext({ id: ids[0] ?? null, control: 'open' })
    },
    focusRow: (item) => setFocusNext({ id: item.id, control: 'open' }),
    open: (item, event) => {
      if (!item.read)
        change(markRead(latest.current.items, [item.id], true), {
          reason: 'read',
          ids: [item.id],
        })
      onOpenNotification?.(item, event)
    },
    opens: (item) => item.href !== undefined || onOpenNotification !== undefined,
  }

  const markAllRead = () => {
    const now = latest.current
    const ids = now.items.filter((item) => !item.read).map((item) => item.id)
    if (ids.length === 0) return
    if (now.tab === 'unread') leave(ids)
    // Rows kept in Unread after an answer go with the rest.
    setKept([])
    change(markRead(now.items, ids, true), { reason: 'read', ids })
  }

  return (
    <CenterContext value={api}>
      {/* A bottom sheet on a phone, where a list this long needs the screen's width, unless motion is reduced. */}
      <Popover open={isOpen} onOpenChange={changeOpen} modal={modal} presentation='auto'>
        <NotificationBell
          count={unread}
          title={title}
          locale={localeProp}
          className={className}
        />
        <PopoverContent
          align='end'
          // The picked tab, so a press of Enter on opening never marks everything read.
          initialFocus='[role=tab][aria-selected=true]'
          // A header, a body that scrolls and a footer. The popover is always
          // `--notification-center-height` tall, so the other tab never resizes it;
          // the sheet follows what it holds.
          className='min-h-0 w-(--notification-center-width,24rem) gap-0 p-0 group-data-[presentation=popover]/popup:h-(--notification-center-height,32rem) group-data-[presentation=popover]/popup:max-h-[calc(var(--popup-available-height)-2px)]'
        >
          <Tabs
            value={tab}
            onValueChange={(next) => setTab(next as NotificationTab)}
            className='contents'
          >
            <PopoverHeader className='shrink-0 gap-3 px-(--popover-edge) pt-(--popover-edge) pb-2 group-data-[presentation=sheet]/popup:pb-5'>
              <div className='flex min-h-(--control-height-sm) items-center gap-2'>
                <PopoverTitle className='min-w-0 flex-1 text-base wrap-break-word'>
                  {title}
                </PopoverTitle>
                <Header unread={unread} markAllRead={markAllRead} />
              </div>
              <TabsList
                aria-label='Filter notifications'
                className='self-stretch *:w-full'
              >
                <TabsTab value='all' className='flex-1'>
                  All
                </TabsTab>
                <TabsTab value='unread' className='flex-1'>
                  Unread
                  {/* The count fades away at none as the label glides back to the middle, and back. */}
                  <Swap id={unread > 0 ? 'count' : 'none'} className='-ms-(--button-gap)'>
                    {unread > 0 ? (
                      <span className='ps-(--button-gap)'>
                        <Badge variant='secondary'>
                          <AnimatedNumber value={unread} locale={localeProp} />
                        </Badge>
                      </span>
                    ) : null}
                  </Swap>
                </TabsTab>
              </TabsList>
            </PopoverHeader>
            {/* Rows sit `--notification-inset` in from the body's sides, so their content lines up with the title. */}
            <PopoverBody className='min-h-full px-[calc(var(--popover-edge)-var(--notification-inset))] pb-1.5 [--notification-inset:calc(var(--control-padding)*0.8)]'>
              {(['all', 'unread'] as const).map((value) => (
                <TabsPanel
                  key={value}
                  value={value}
                  // Its rows take focus, and the body scrolls by keyboard: the panel needn't, except empty.
                  tabIndex={visibleItems(items, value, kept).length > 0 ? -1 : 0}
                  className='relative flex min-h-64 flex-1 flex-col rounded-(--list-radius)'
                >
                  <NotificationList
                    items={visibleItems(items, value, kept)}
                    empty={empty[value]}
                    row={row}
                    focusNext={focusNext}
                    onFocused={() => setFocusNext(null)}
                  />
                </TabsPanel>
              ))}
            </PopoverBody>
          </Tabs>
          {below}
          {footer ? (
            // From the start edge, as in the popover, not a dialog's buttons at the end.
            <PopoverFooter className='@xs:justify-start'>{footer}</PopoverFooter>
          ) : null}
        </PopoverContent>
      </Popover>
    </CenterContext>
  )
}

/**
 * Each item that moves in a list: a day's heading or a row. It glides to a
 * new place on `layout`. One that leaves folds up from its bottom edge as
 * the rows under it rise into its place, both on `layout`, fading on
 * `exit`; one that arrives unfolds as the rows under it make room, fading
 * in on `enter`. So no two rows ever show over each other. Its clip rests
 * a little past its edges, where a focus ring reaches.
 */
const flowItemClassName = cn(
  // Under reduced motion one that arrives only fades in, and one that leaves goes at once, as
  // the rows under it take its place at once.
  '[clip-path:inset(-0.25rem)] [transition:translate_var(--motion-layout-duration)_var(--motion-layout-easing),clip-path_var(--motion-layout-duration)_var(--motion-layout-easing),opacity_var(--motion-enter-duration)_var(--motion-enter-easing)] group-data-mounted/notifications:starting:opacity-0 group-data-mounted/notifications:starting:[clip-path:inset(0_0_100%_0)] data-[flow=start]:[transition:opacity_var(--motion-enter-duration)_var(--motion-enter-easing)] motion-reduce:[clip-path:none]! motion-reduce:[transition:opacity_var(--motion-enter-duration)_var(--motion-enter-easing)]',
  'data-leaving:opacity-0 data-leaving:[clip-path:inset(0_0_100%_0)] data-leaving:[transition:clip-path_var(--motion-layout-duration)_var(--motion-layout-easing),opacity_var(--motion-exit-duration)_var(--motion-exit-easing)] motion-reduce:data-leaving:[transition:none]',
)

/** One tab's notifications, under the days they fall on, or its empty state. */
function NotificationList({
  items,
  empty,
  row,
  focusNext,
  onFocused,
}: {
  items: NotificationItem[]
  empty: { title: string; description: string }
  row: (item: NotificationItem) => ReactNode
  focusNext: { id: string | null; control: string } | null
  onFocused: () => void
}) {
  const { locale, timeZone, now } = useCenter()
  const { frame, row: list } = useFlow<HTMLDivElement, HTMLDivElement>(
    '[data-slot=notification], [data-slot=notification-day]',
    'data-flow-key',
  )
  const layerRef = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    const area = list.current
    if (!area || !layerRef.current) return
    return followPointer(area, layerRef.current, {
      itemOf: itemMatching(area, '[data-slot=notification][data-opens]'),
      focus: true,
    })
  }, [list])

  // Focus goes to the row that took the place of the one that left, or to
  // the tab once none is left.
  useLayoutEffect(() => {
    if (!focusNext) return
    const area = list.current
    if (!area) return
    const next = focusNext.id
      ? area.querySelector<HTMLElement>(
          `[data-notification-id="${CSS.escape(focusNext.id)}"]:not([data-leaving])`,
        )
      : null
    const target =
      next?.querySelector<HTMLElement>(
        `[data-notification-control="${CSS.escape(focusNext.control)}"]`,
      ) ??
      next?.querySelector<HTMLElement>('[data-notification-control]') ??
      area
        .closest('[role=dialog]')
        ?.querySelector<HTMLElement>('[role=tab][aria-selected=true]')
    target?.focus()
    onFocused()
  }, [focusNext, list, onFocused])

  const today = now === null ? null : wallClock(now, timeZone).slice(0, 10)
  const groups = dayGroups(items, timeZone)
  const listRef = useMemo(() => mergeRefs(list, markMounted), [list])
  return (
    <TooltipGroup>
      <div
        ref={frame}
        className='[overflow-clip-margin:0.25rem] overflow-clip transition-[height] duration-(--motion-layout-duration) ease-(--motion-layout-easing) motion-reduce:transition-none'
      >
        <div
          ref={listRef}
          data-slot='notification-list'
          className='group/notifications relative isolate flex flex-col'
        >
          {groups.flatMap((group) => [
            <h3
              key={`day-${group.day}`}
              data-slot='notification-day'
              data-flow-key={`day-${group.day}`}
              className={cn(
                'text-muted-foreground px-(--notification-inset) pt-3 pb-1 text-xs font-medium first:pt-1.5',
                flowItemClassName,
              )}
            >
              {today === null ? ' ' : dayHeading(group.day, today, locale)}
            </h3>,
            ...group.items.map((item) => row(item)),
          ])}
          <span ref={layerRef} aria-hidden className={rowHighlightClassName} />
        </div>
      </div>
      {/* Over the list's place, so the rows leaving don't push it: it rises in once they've gone. */}
      <Empty show={items.length === 0} className='absolute inset-0 [--empty-wait:1]'>
        <EmptyHeader>
          <EmptyMedia variant='icon'>
            <IconPlaceholder
              lucide='InboxIcon'
              tabler='IconInbox'
              phosphor='TrayIcon'
              remixicon='RiInboxLine'
              hugeicons='InboxIcon'
              aria-hidden
            />
          </EmptyMedia>
          {/* oxlint-disable-next-line jsx-a11y/heading-has-content -- the title's text goes in through the part's children. */}
          <EmptyTitle render={<h3 />}>{empty.title}</EmptyTitle>
          <EmptyDescription>{empty.description}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    </TooltipGroup>
  )
}

/**
 * One notification: an article named by its title. It takes the rows' tint
 * under the pointer when it opens, and a ring when its title has focus. The
 * title, `NotificationOpen`, covers the whole row; the row's own buttons
 * sit above it.
 */
function NotificationRow({
  item,
  className,
  children,
}: {
  item: NotificationItem
  className?: string
  children: ReactNode
}) {
  const { opens } = useCenter()
  const titleId = useId()
  const context = useMemo(() => ({ item, titleId }), [item, titleId])
  return (
    <RowContext value={context}>
      <article
        data-slot='notification'
        data-notification-id={item.id}
        data-flow-key={item.id}
        data-read={item.read ? '' : undefined}
        data-opens={opens(item) ? '' : undefined}
        aria-labelledby={titleId}
        className={cn(
          'group/notification relative flex min-w-0 gap-2.5 rounded-(--list-radius) text-sm',
          // Muted text under the highlight's tint is darker, so it keeps 4.5:1 on it.
          tintedRowTextClassName,
          'has-[[data-notification-control=open]:focus-visible]:ring-ring/50 has-[[data-notification-control=open]:focus-visible]:ring-3 has-[[data-notification-control=open]:focus-visible]:ring-inset',
          flowItemClassName,
          className,
        )}
      >
        {children}
      </article>
    </RowContext>
  )
}

/**
 * The row's title, which opens it: a link to its `href`, or a button when
 * the app opens it. It covers the whole row, so the row opens wherever it is
 * pressed, except on its own buttons. "Unread" is read before it.
 */
function NotificationOpen({
  className,
  children,
}: {
  className?: string
  children: ReactNode
}) {
  const { open, opens } = useCenter()
  const { item, titleId } = useRow()
  const label = (
    <>
      {item.read ? null : <span className='sr-only'>Unread: </span>}
      {children}
    </>
  )
  // Unread shows by more than its colour, with no mark beside it: an unread
  // title is in full colour and medium, a read one muted and regular, its
  // names included. A title that changes weight may wrap differently, so
  // the rows below glide to make room.
  const textClassName = cn(
    'min-w-0 transition-colors duration-(--motion-press-duration) ease-(--motion-press-fade-easing)',
    item.read ? 'text-muted-foreground **:font-normal' : 'text-foreground font-medium',
    className,
  )
  if (!opens(item)) {
    return (
      <span id={titleId} className={textClassName}>
        {label}
      </span>
    )
  }
  const cover =
    'focus-visible:outline-hidden after:absolute after:inset-0 after:rounded-[inherit] forced-colors:focus-visible:after:outline-2 forced-colors:focus-visible:after:outline-[Highlight]'
  // Opening a row closes the panel. The app hears of it once the click has
  // closed it, from the box around, so its `preventDefault()`, such as a
  // router's, stops the link but never the close.
  return (
    // oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- the click comes from the link or button inside, which answers the keys too.
    <span className='contents' onClick={(event) => open(item, event)}>
      {item.href !== undefined ? (
        <PopoverClose
          render={({ children, ...props }) => (
            <a {...props} href={item.href}>
              {children}
            </a>
          )}
          id={titleId}
          data-notification-control='open'
          className={cn(textClassName, cover)}
        >
          {label}
        </PopoverClose>
      ) : (
        <PopoverClose
          id={titleId}
          data-notification-control='open'
          className={cn(textClassName, cover, 'text-start')}
        >
          {label}
        </PopoverClose>
      )}
    </span>
  )
}

/**
 * Who did it, or the app's icon, in a circle `className` sizes: an Avatar
 * fills it, an icon sits on the muted tint.
 */
function NotificationMedia({ className }: { className?: string }) {
  const { item } = useRow()
  if (!item.media) return null
  return (
    <span
      aria-hidden
      data-slot='notification-media'
      className={cn(
        "bg-muted text-muted-foreground flex size-(--control-height-sm) shrink-0 items-center justify-center overflow-hidden rounded-full *:data-[slot=avatar]:size-full [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
    >
      {item.media}
    </span>
  )
}

/** When it happened: how long ago today, the time of day before; the whole date and time on hover. */
function NotificationTime({ className }: { className?: string }) {
  const { locale, timeZone, now } = useCenter()
  const { item } = useRow()
  const today = now === null ? null : wallClock(now, timeZone).slice(0, 10)
  const day = wallClock(item.at, timeZone).slice(0, 10)
  const text =
    now === null
      ? ' '
      : ((day === today ? timeAgo(item.at, now, locale) : null) ??
        clockTime(item.at, locale, timeZone))
  return (
    <time
      dateTime={item.at}
      // Its words run the way the locale writes them, whatever the page's direction: 4:05 PM.
      dir='auto'
      title={now === null ? undefined : instantLabel(item.at, locale, timeZone)}
      className={cn(
        'text-muted-foreground shrink-0 text-xs whitespace-nowrap tabular-nums',
        className,
      )}
    >
      {text}
    </time>
  )
}

/** A row's own icon button, described by its title, with its name as a tooltip. */
function NotificationButton({
  label,
  control,
  onClick,
  children,
}: {
  label: string
  /** Which of the row's buttons it is, so focus lands on the same one in the next row. */
  control: string
  onClick: () => void
  children: ReactNode
}) {
  const { titleId } = useRow()
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant='ghost'
            size='icon-sm'
            aria-label={label}
            aria-describedby={titleId}
            data-notification-control={control}
            onClick={onClick}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

/** Marks the row read, or unread again. */
function NotificationReadToggle() {
  const { setRead } = useCenter()
  const { item } = useRow()
  return (
    <NotificationButton
      label={item.read ? 'Mark as unread' : 'Mark as read'}
      control='read'
      onClick={() => setRead(item, !item.read)}
    >
      {item.read ? (
        <IconPlaceholder
          lucide='MailIcon'
          tabler='IconMail'
          phosphor='EnvelopeIcon'
          remixicon='RiMailLine'
          hugeicons='Mail01Icon'
          aria-hidden
        />
      ) : (
        <IconPlaceholder
          lucide='CheckIcon'
          tabler='IconCheck'
          phosphor='CheckIcon'
          remixicon='RiCheckLine'
          hugeicons='Tick02Icon'
          aria-hidden
        />
      )}
    </NotificationButton>
  )
}

/** Takes the row out of the list, until undone. */
function NotificationArchive() {
  const { archive } = useCenter()
  const { item } = useRow()
  return (
    <NotificationButton label='Archive' control='archive' onClick={() => archive([item])}>
      <IconPlaceholder
        lucide='ArchiveIcon'
        tabler='IconArchive'
        phosphor='ArchiveIcon'
        remixicon='RiArchiveLine'
        hugeicons='Archive02Icon'
        aria-hidden
      />
    </NotificationButton>
  )
}

/**
 * The row's buttons. With a pointer that hovers they float over the row's
 * end (place them with `className`) while the row is hovered or shows focus,
 * on the panel's colour, so they cover what's under them rather than
 * squeezing the row; on a touch screen they always show, in the row.
 */
function NotificationActions({
  className,
  children,
}: {
  className?: string
  children: ReactNode
}) {
  return (
    <div
      data-slot='notification-actions'
      className={cn(
        'relative z-10 flex shrink-0 items-center gap-0.5 transition-opacity duration-(--motion-enter-duration) ease-(--motion-enter-fade-easing)',
        // A short fade on its start edge, so the words it covers trail off under it.
        '[@media(hover:hover)]:bg-popover [@media(hover:hover)]:absolute [@media(hover:hover)]:rounded-(--control-radius) [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-has-[:focus-visible]/notification:opacity-100 [@media(hover:hover)]:group-hover/notification:opacity-100 [@media(hover:hover)]:before:from-popover [@media(hover:hover)]:before:pointer-events-none [@media(hover:hover)]:before:absolute [@media(hover:hover)]:before:inset-y-0 [@media(hover:hover)]:before:-start-4 [@media(hover:hover)]:before:w-4 [@media(hover:hover)]:before:bg-linear-to-l rtl:[@media(hover:hover)]:before:bg-linear-to-r',
        className,
      )}
    >
      {children}
    </div>
  )
}

/** Mark all as read, with its icon; held while none is unread. */
function MarkAllRead({ unread, onClick }: { unread: number; onClick: () => void }) {
  return (
    <Button
      variant='ghost'
      size='sm'
      disabled={unread === 0}
      focusableWhenDisabled
      onClick={onClick}
      className='text-muted-foreground shrink-0'
    >
      <IconPlaceholder
        lucide='CheckCheckIcon'
        tabler='IconChecks'
        phosphor='ChecksIcon'
        remixicon='RiCheckDoubleLine'
        hugeicons='TickDouble02Icon'
        aria-hidden
      />
      Mark all as read
    </Button>
  )
}

export {
  MarkAllRead,
  NotificationActions,
  NotificationArchive,
  NotificationButton,
  NotificationMedia,
  NotificationOpen,
  NotificationReadToggle,
  NotificationRow,
  NotificationShell,
  NotificationTime,
  useCenter,
  useRow,
}
export type { Archived }
