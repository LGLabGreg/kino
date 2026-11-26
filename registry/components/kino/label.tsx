'use client'

import { Label as LabelPrimitive } from '@ui-sdk/react/label'
import type { ComponentProps } from 'react'

import { cn } from '@/lib/utils'

const labelClassName =
  'flex items-center gap-2 text-sm leading-5 font-medium select-none group-data-disabled/field:opacity-50 peer-disabled:opacity-50 has-disabled:opacity-50'

/** Names any control by its `htmlFor` or by holding it, and a press on it reaches the control. */
function Label({
  className,
  ...props
}: Omit<ComponentProps<typeof LabelPrimitive>, 'className'> & { className?: string }) {
  return <LabelPrimitive className={cn(labelClassName, className)} {...props} />
}

export { Label, labelClassName }
