'use client'

import { Button, buttonVariants } from '@/registry/components/kino/button'
import type {
  NotificationItem,
  NotificationTab,
} from '@/registry/components/kino/notification-center/notification-list'
import {
  type Archived,
  MarkAllRead,
  NotificationActions,
  NotificationArchive,
  type NotificationCenterProps as ShellProps,
  NotificationMedia,
  NotificationOpen,
  NotificationReadToggle,
  NotificationRow,
  NotificationShell,
  NotificationTime,
  useCenter,
  useRow,
} from '@/registry/components/kino/notification-center/notification-parts'
import { PopoverFooter } from '@/registry/components/kino/popover'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/registry/components/kino/tooltip'
import { IconPlaceholder } from '@/registry/icons/icon-placeholder'
import { settle } from '@/registry/lib/settle'
import { Swap } from '@/registry/lib/swap'
import { type ComponentProps, type ReactNode, useId, useState } from 'react'

import { cn } from '@/lib/utils'

/*
 * A bell with how many are unread, which opens the notifications grouped by
 * day, with All and Unread tabs: a popover, or a bottom sheet on a phone
 * unless motion is reduced. Nothing is marked read by being seen, only by opening a row, its own
 * button, or Mark all as read. Three variants:
 *
 * - `triage`, the default: short rows, many to a screen, for a product that
 *   sends a lot of small news. Under the pointer the time gives way to the
 *   row's button.
 * - `feed`: led by the people in it, what they wrote quoted under them, and
 *   a notification's `actions` as buttons in its row (accept an invite,
 *   approve a review), whose result stays on the row.
 * - `inbox`: notifications are archived once dealt with, down to "You're
 *   all caught up", and come back with Undo until the panel closes.
 *
 *   <NotificationCenter
 *     notifications={notifications}
 *     onNotificationsChange={(next, change) => save(next, change)}
 *     footer={<NotificationSettingsLink href='/settings/notifications' />}
 *   />
 */

type NotificationCenterVariant = 'triage' | 'feed' | 'inbox'

type NotificationCenterProps = ShellProps & {
  /** How the rows read and what they do: see above. */
  variant?: NotificationCenterVariant
}

/** Each tab's empty state, in each variant's words. */
const EMPTY: Record<
  NotificationCenterVariant,
  Record<NotificationTab, { title: string; description: string }>
> = {
  triage: {
    all: {
      title: 'No notifications yet',
      description: 'When someone assigns or mentions you, it shows here.',
    },
    unread: {
      title: 'You’re all caught up',
      description: 'Nothing new since you last looked.',
    },
  },
  feed: {
    all: {
      title: 'No notifications yet',
      description: 'Mentions, replies and invites from your team show here.',
    },
    unread: {
      title: 'You’re all caught up',
      description: 'Nothing new since you last looked.',
    },
  },
  inbox: {
    all: { title: 'You’re all caught up', description: 'New notifications show here.' },
    unread: {
      title: 'Nothing unread',
      description: 'Read notifications wait in All until you archive them.',
    },
  },
}

function NotificationCenter({
  variant = 'triage',
  footer,
  onOpenChange,
  ...props
}: NotificationCenterProps) {
  // What Inbox's archives took, which Undo puts back, until the panel closes.
  const [taken, setTaken] = useState<Archived[]>([])
  const inbox = variant === 'inbox'
  return (
    <NotificationShell
      {...props}
      onOpenChange={(open, details) => {
        onOpenChange?.(open, details)
        if (!open && !details.canceled) setTaken([])
      }}
      // Archives made while Undo shows come back together.
      onArchived={(archived) => setTaken((was) => [...was, archived])}
      header={inbox ? InboxHeader : MarkAllReadHeader}
      empty={EMPTY[variant]}
      footer={inbox ? undefined : footer}
      below={
        inbox ? (
          <InboxFooter taken={taken} onDone={() => setTaken([])}>
            {footer}
          </InboxFooter>
        ) : null
      }
      row={(item) =>
        variant === 'feed' ? (
          <FeedRow key={item.id} item={item} />
        ) : inbox ? (
          <InboxRow key={item.id} item={item} />
        ) : (
          <TriageRow key={item.id} item={item} />
        )
      }
    />
  )
}

/** One line or two: who or what it's from, what happened and when. */
function TriageRow({ item }: { item: NotificationItem }) {
  return (
    <NotificationRow
      item={item}
      // Half a row's padding: many to a screen.
      className='min-h-(--control-height) items-center px-(--notification-inset) py-[calc(var(--row-padding)*0.5)]'
    >
      <NotificationMedia className='size-(--control-height-xs)' />
      <NotificationOpen className='line-clamp-2 flex-1 leading-snug'>
        {item.title}
      </NotificationOpen>
      {/* Under the pointer the row's button covers the time; on a touch screen they sit side by side. */}
      <NotificationTime className='transition-opacity duration-(--motion-enter-duration) ease-(--motion-enter-fade-easing) [@media(hover:hover)]:group-has-[:focus-visible]/notification:opacity-0 [@media(hover:hover)]:group-hover/notification:opacity-0' />
      <NotificationActions className='-ms-1.5 -me-1 [@media(hover:hover)]:end-1.5 [@media(hover:hover)]:top-1/2 [@media(hover:hover)]:-translate-y-1/2 [@media(hover:hover)]:m-0'>
        <NotificationReadToggle />
      </NotificationActions>
    </NotificationRow>
  )
}

/** Who did it, large, then what they did, when, what they wrote and the row's own actions. */
function FeedRow({ item }: { item: NotificationItem }) {
  return (
    <NotificationRow
      item={item}
      className='items-start gap-3 px-(--notification-inset) py-[calc(var(--row-padding)*0.8)]'
    >
      <NotificationMedia className='size-(--control-height)' />
      <div className='flex min-w-0 flex-1 flex-col gap-1.5'>
        {/* Clear of the row's button, which floats at its end. */}
        <div className='flex min-w-0 flex-col gap-0.5 [@media(hover:hover)]:pe-7'>
          <NotificationOpen className='leading-snug'>{item.title}</NotificationOpen>
          <NotificationTime />
        </div>
        {item.description ? (
          // What they wrote, quoted: a line on its start edge sets it apart from the title,
          // and in its own direction: an English comment in a Hebrew app reads left to right.
          <p
            dir='auto'
            className='text-muted-foreground border-border line-clamp-3 border-s-2 ps-2.5 leading-snug text-pretty'
          >
            {item.description}
          </p>
        ) : null}
        {item.actions?.length ? <FeedActions item={item} /> : null}
      </div>
      <NotificationActions className='-me-1 -mt-0.5 [@media(hover:hover)]:end-1.5 [@media(hover:hover)]:top-1.5 [@media(hover:hover)]:m-0'>
        <NotificationReadToggle />
      </NotificationActions>
    </NotificationRow>
  )
}

/** The title and a line of detail, the time, and the row's buttons: read and Archive. */
function InboxRow({ item }: { item: NotificationItem }) {
  return (
    <NotificationRow
      item={item}
      className='items-start gap-2.5 px-(--notification-inset) py-[calc(var(--row-padding)*0.65)]'
    >
      <NotificationMedia className='mt-px' />
      {/* Clear of the fade at the start of the row's buttons, which float over the time. */}
      <div className='flex min-w-0 flex-1 flex-col gap-0.5 [@media(hover:hover)]:pe-3'>
        <NotificationOpen className='line-clamp-2 leading-snug'>
          {item.title}
        </NotificationOpen>
        {item.description ? (
          // In its own direction, as words someone wrote may be.
          <span dir='auto' className='text-muted-foreground min-w-0 truncate text-xs'>
            {item.description}
          </span>
        ) : null}
      </div>
      <NotificationTime className='pt-0.5' />
      <NotificationActions className='-me-1 [@media(hover:hover)]:end-1.5 [@media(hover:hover)]:top-1.5 [@media(hover:hover)]:m-0'>
        <NotificationReadToggle />
        <NotificationArchive />
      </NotificationActions>
    </NotificationRow>
  )
}

/**
 * A row's own buttons, such as Accept and Decline. While one runs both are
 * held, and the one pressed shows it is working; once it has run they give
 * way to what it did, kept on the notification as its `done`, and the row
 * is read. In Unread the row stays, so what it did can be seen. One that
 * fails leaves them as they were, and says so.
 */
function FeedActions({ item }: { item: NotificationItem }) {
  const { act, announce, focusRow } = useCenter()
  const { titleId } = useRow()
  const [running, setRunning] = useState<number | null>(null)
  // The one that failed last, said under the buttons until it works or another is pressed.
  const [failed, setFailed] = useState<number | null>(null)
  const failureId = useId()
  const actions = item.actions ?? []
  const finished = item.done === undefined ? null : actions[item.done]
  return (
    <div className='relative z-10 pt-0.5'>
      <Swap block id={finished ? 'done' : 'actions'} align='start'>
        {finished ? (
          <p className='text-muted-foreground flex items-center gap-1.5 text-sm'>
            <IconPlaceholder
              lucide='CheckIcon'
              tabler='IconCheck'
              phosphor='CheckIcon'
              remixicon='RiCheckLine'
              hugeicons='Tick02Icon'
              aria-hidden
              className='text-success-foreground size-4'
            />
            {finished.done}
          </p>
        ) : (
          <div className='flex flex-col gap-1.5'>
            <div className='flex flex-wrap gap-2'>
              {actions.map((action, index) => (
                <Button
                  key={action.label}
                  size='sm'
                  variant={action.variant === 'secondary' ? 'outline' : 'default'}
                  // The failure, once there, describes the button it came from.
                  aria-describedby={
                    failed === index ? `${titleId} ${failureId}` : titleId
                  }
                  loading={running === index}
                  disabled={running !== null && running !== index}
                  onClick={() => {
                    setRunning(index)
                    // A retry keeps the line, so the row doesn't shrink and grow back.
                    if (failed !== index) setFailed(null)
                    settle(action.run, (ok) => {
                      setRunning(null)
                      if (!ok) {
                        setFailed(index)
                        announce(failure(action.label))
                        return
                      }
                      // Its buttons are about to go: focus on them goes to the row's title.
                      const active = document.activeElement
                      const row = `[data-notification-id="${CSS.escape(item.id)}"]`
                      if (!active || active === document.body || active.closest(row)) {
                        focusRow(item)
                      }
                      announce(typeof action.done === 'string' ? action.done : 'Done')
                      act(item, index)
                    })
                  }}
                >
                  {action.label}
                </Button>
              ))}
            </div>
            {/* Rolls in and out, as the done line does, and the row glides to its height. */}
            <Swap block id={failed === null ? 'none' : `failed-${failed}`} align='start'>
              {failed === null || !actions[failed] ? null : (
                <p id={failureId} className='text-destructive text-xs'>
                  {failure(actions[failed].label)}
                </p>
              )}
            </Swap>
          </div>
        )}
      </Swap>
    </div>
  )
}

/** What a row says when its action fails: Couldn't accept. Try again. */
function failure(label: string) {
  return `Couldn’t ${label.toLowerCase()}. Try again.`
}

/** Mark all as read, with its words: Triage's and Feed's header. */
function MarkAllReadHeader({
  unread,
  markAllRead,
}: {
  unread: number
  markAllRead: () => void
}) {
  return <MarkAllRead unread={unread} onClick={markAllRead} />
}

/** Mark all as read and Archive all read, as icons named by their tooltips. */
function InboxHeader({
  unread,
  markAllRead,
}: {
  unread: number
  markAllRead: () => void
}) {
  const { archiveRead, readCount } = useArchiveRead()
  return (
    <div className='-me-1.5 flex shrink-0 items-center gap-0.5'>
      <HeaderButton
        label='Mark all as read'
        disabled={unread === 0}
        onClick={markAllRead}
      >
        <IconPlaceholder
          lucide='CheckCheckIcon'
          tabler='IconChecks'
          phosphor='ChecksIcon'
          remixicon='RiCheckDoubleLine'
          hugeicons='TickDouble02Icon'
          aria-hidden
        />
      </HeaderButton>
      <HeaderButton
        label='Archive all read'
        disabled={readCount === 0}
        onClick={archiveRead}
      >
        <IconPlaceholder
          lucide='ArchiveIcon'
          tabler='IconArchive'
          phosphor='ArchiveIcon'
          remixicon='RiArchiveLine'
          hugeicons='Archive02Icon'
          aria-hidden
        />
      </HeaderButton>
    </div>
  )
}

/** Archives every read notification at once. */
function useArchiveRead() {
  const { archive, items } = useCenter()
  const read = items.filter((item) => item.read)
  return { archiveRead: () => archive(read), readCount: read.length }
}

function HeaderButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string
  disabled: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant='ghost'
            size='icon-sm'
            aria-label={label}
            disabled={disabled}
            focusableWhenDisabled
            onClick={onClick}
            className='text-muted-foreground'
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

/**
 * The footer: the app's own, such as a settings link, which gives way after
 * an archive to how many were archived and Undo, there until the panel
 * closes, so no one has to race a timer to it.
 */
function InboxFooter({
  taken,
  onDone,
  children,
}: {
  taken: Archived[]
  onDone: () => void
  children?: ReactNode
}) {
  const { restore } = useCenter()
  const count = taken.reduce((sum, archived) => sum + archived.items.length, 0)
  if (count === 0 && !children) return null
  return (
    <PopoverFooter className='min-h-(--control-height) @xs:justify-start'>
      <Swap
        block
        fill
        id={count > 0 ? 'undo' : 'footer'}
        align='start'
        className='min-w-0 flex-1'
      >
        {count > 0 ? (
          <div className='flex w-full items-center gap-2'>
            <span className='text-muted-foreground min-w-0 flex-1 text-sm tabular-nums'>
              {count === 1 ? 'Archived' : `${count} archived`}
            </span>
            <Button
              size='sm'
              variant='ghost'
              className='-me-2'
              onClick={() => {
                restore(taken)
                onDone()
              }}
            >
              <IconPlaceholder
                lucide='Undo2Icon'
                tabler='IconArrowBackUp'
                phosphor='ArrowUUpLeftIcon'
                remixicon='RiArrowGoBackLine'
                hugeicons='Undo02Icon'
                aria-hidden
              />
              Undo
            </Button>
          </div>
        ) : (
          <div className='flex w-full items-center'>{children}</div>
        )}
      </Swap>
    </PopoverFooter>
  )
}

/**
 * A link to the notification settings, with its icon, for the footer: a
 * link in a ghost Button's look, its icon lined up with the title.
 */
function NotificationSettingsLink({
  className,
  children = 'Notification settings',
  ...props
}: ComponentProps<'a'>) {
  return (
    <a
      data-slot='notification-settings-link'
      className={cn(
        buttonVariants({ variant: 'ghost', size: 'sm' }),
        // Its padding and its 1px border, so its icon lines up with the title.
        'text-muted-foreground -ms-[calc(var(--control-padding)+1px)]',
        className,
      )}
      {...props}
    >
      <IconPlaceholder
        lucide='SettingsIcon'
        tabler='IconSettings'
        phosphor='GearIcon'
        remixicon='RiSettings3Line'
        hugeicons='Settings01Icon'
        aria-hidden
      />
      {children}
    </a>
  )
}

export { NotificationCenter, NotificationSettingsLink }
export type { NotificationCenterProps, NotificationCenterVariant }
export type {
  NotificationAction,
  NotificationChange,
  NotificationItem,
  NotificationTab,
} from '@/registry/components/kino/notification-center/notification-list'
