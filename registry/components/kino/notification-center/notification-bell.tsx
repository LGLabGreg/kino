'use client'

import { Button } from '@/registry/components/kino/button'
import { bellLabel } from '@/registry/components/kino/notification-center/notification-list'
import { PopoverTrigger } from '@/registry/components/kino/popover'
import { IconPlaceholder } from '@/registry/icons/icon-placeholder'
import { CountBadge } from '@/registry/lib/count-badge'

import { cn } from '@/lib/utils'

/**
 * The bell that opens the notifications, with how many are unread on its
 * corner. The count rolls to its new value; at none it shrinks away on
 * `exit`, and comes back on `enter`. A screen reader hears the count in the
 * bell's name, not from the badge.
 */
function NotificationBell({
  count,
  title,
  locale,
  className,
}: {
  count: number
  /** What the notifications are called, which names the bell: "Notifications, 3 unread". */
  title: string
  locale?: string
  className?: string
}) {
  return (
    <span data-slot='notification-bell' className={cn('relative inline-flex', className)}>
      <PopoverTrigger
        render={
          <Button variant='ghost' size='icon' aria-label={bellLabel(title, count)} />
        }
      >
        <IconPlaceholder
          lucide='BellIcon'
          tabler='IconBell'
          phosphor='BellIcon'
          remixicon='RiNotification3Line'
          hugeicons='Notification03Icon'
          aria-hidden
        />
      </PopoverTrigger>
      <CountBadge count={count} locale={locale} />
    </span>
  )
}

export { NotificationBell }
