'use client'

import { AnimatedNumber } from '@/registry/components/kino/animated-number'
import { Badge } from '@/registry/components/kino/badge'
import { Button } from '@/registry/components/kino/button'
import { bellLabel } from '@/registry/components/kino/notification-center/notification-list'
import { IconPlaceholder } from '@/registry/icons/icon-placeholder'
import { PopoverSheetTrigger } from '@/registry/lib/popover-sheet'
import { useState } from 'react'

import { cn } from '@/lib/utils'

/** The most a count shows before it reads 99+. */
const MAX_COUNT = 99

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
  // While the badge shrinks away it keeps the last count it showed.
  const [shown, setShown] = useState(count)
  if (count > 0 && count !== shown) setShown(count)
  return (
    <span data-slot='notification-bell' className={cn('relative inline-flex', className)}>
      <PopoverSheetTrigger
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
      </PopoverSheetTrigger>
      <Badge
        aria-hidden
        data-empty={count === 0 ? '' : undefined}
        className={cn(
          // On the bell's top end corner, ringed in the page's colour so it reads apart from the bell.
          'pointer-events-none absolute -end-1.5 -top-1.5 ring-2 ring-background',
          // It shrinks away at none and grows back. A page that opens with none shows nothing moving.
          'transition-[scale,opacity] duration-(--motion-enter-duration) ease-(--motion-enter-easing) data-empty:scale-50 data-empty:opacity-0 data-empty:duration-(--motion-exit-duration) data-empty:ease-(--motion-exit-easing) motion-reduce:data-empty:scale-100',
        )}
      >
        <span className='flex items-center'>
          <AnimatedNumber value={Math.min(shown, MAX_COUNT)} locale={locale} />
          {shown > MAX_COUNT ? '+' : null}
        </span>
      </Badge>
    </span>
  )
}

export { NotificationBell }
