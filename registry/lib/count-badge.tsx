'use client'

import { AnimatedNumber } from '@/registry/components/kino/animated-number'
import { Badge } from '@/registry/components/kino/badge'
import { useState } from 'react'

import { cn } from '@/lib/utils'

/*
 * A count on the top end corner of a control, such as the unread on a bell
 * or a chat's launcher. It rolls to its new value and reads 99+ past 99; at
 * none it shrinks away on `exit` and comes back on `enter`, keeping the last
 * count it showed while it goes. The control's name says the count, so a
 * screen reader hears it there and not from the badge. Its parent is
 * positioned.
 */

/** The most a count shows before it reads 99+. */
const MAX_COUNT = 99

function CountBadge({ count, locale }: { count: number; locale?: string }) {
  // While the badge shrinks away it keeps the last count it showed.
  const [shown, setShown] = useState(count)
  if (count > 0 && count !== shown) setShown(count)
  return (
    <Badge
      aria-hidden
      data-slot='count-badge'
      data-empty={count === 0 ? '' : undefined}
      className={cn(
        // On the control's top end corner, ringed in the page's colour so it reads apart from it.
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
  )
}

export { CountBadge, MAX_COUNT }
