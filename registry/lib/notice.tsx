'use client'

import { Spinner } from '@/registry/components/kino/spinner'
import { IconPlaceholder } from '@/registry/icons/icon-placeholder'
import { Swap } from '@/registry/lib/swap'
import type { ComponentProps, ReactNode } from 'react'

import { cn } from '@/lib/utils'

/*
 * What a Toast and an Alert share: the icon for each kind of message, which
 * rolls into the next when the kind changes, and the type of the title and
 * description beside it.
 */

type NoticeType = 'info' | 'success' | 'warning' | 'error' | 'loading'

const NOTICE_ICONS: Record<NoticeType, ReactNode> = {
  loading: <Spinner key='loading' className='text-muted-foreground' />,
  success: (
    <IconPlaceholder
      key='success'
      lucide='CircleCheckIcon'
      tabler='IconCircleCheck'
      hugeicons='CheckmarkCircle02Icon'
      phosphor='CheckCircleIcon'
      remixicon='RiCheckboxCircleLine'
      className='text-success'
      aria-hidden
    />
  ),
  error: (
    <IconPlaceholder
      key='error'
      lucide='CircleAlertIcon'
      tabler='IconAlertCircle'
      hugeicons='AlertCircleIcon'
      phosphor='WarningCircleIcon'
      remixicon='RiErrorWarningLine'
      className='text-destructive'
      aria-hidden
    />
  ),
  warning: (
    <IconPlaceholder
      key='warning'
      lucide='TriangleAlertIcon'
      tabler='IconAlertTriangle'
      hugeicons='Alert02Icon'
      phosphor='WarningIcon'
      remixicon='RiAlertLine'
      className='text-warning'
      aria-hidden
    />
  ),
  info: (
    <IconPlaceholder
      key='info'
      lucide='InfoIcon'
      tabler='IconInfoCircle'
      hugeicons='InformationCircleIcon'
      phosphor='InfoIcon'
      remixicon='RiInformationLine'
      className='text-muted-foreground'
      aria-hidden
    />
  ),
}

function isNoticeType(type: string | undefined): type is NoticeType {
  return type !== undefined && Object.hasOwn(NOTICE_ICONS, type)
}

/** The icon to show: `icon` when it is given, even as `null` for none, or else `type`'s own. */
function noticeIcon(type: string | undefined, icon: ReactNode): ReactNode {
  if (icon !== undefined) return icon
  return isNoticeType(type) ? NOTICE_ICONS[type] : undefined
}

/**
 * The icon for a kind of message, level with the title's first line: `type`'s
 * own, or `icon` in its place. The icon that leaves rolls out as the next
 * rolls in, so the loading spinner turns into the result.
 */
function NoticeIcon({
  type,
  icon,
  className,
  ...props
}: ComponentProps<'span'> & { type?: string; icon?: ReactNode }) {
  const shown = noticeIcon(type, icon)
  if (shown === undefined || shown === null || shown === false) return null
  return (
    <span
      aria-hidden
      className={cn(
        "flex h-5 shrink-0 items-center [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    >
      <Swap roll>{shown}</Swap>
    </span>
  )
}

/** The column beside the icon: the title, the description and the actions. */
const noticeTextClassName = 'flex min-w-0 flex-1 flex-col gap-0.5 py-px'

const noticeTitleClassName = 'text-sm leading-5 font-medium wrap-break-word'

const noticeDescriptionClassName =
  'text-muted-foreground text-sm leading-5 wrap-break-word'

/** The row of actions under the description. */
const noticeActionsClassName = 'mt-2 flex flex-wrap gap-2'

export {
  isNoticeType,
  NoticeIcon,
  noticeIcon,
  noticeActionsClassName,
  noticeDescriptionClassName,
  noticeTextClassName,
  noticeTitleClassName,
  type NoticeType,
}
