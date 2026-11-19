import type { ComponentProps } from 'react'

import { cn } from '@/lib/utils'

const labelClassName =
  'flex items-center gap-2 text-sm leading-5 font-medium select-none group-data-disabled/field:opacity-50 peer-disabled:opacity-50 has-disabled:opacity-50'

function Label({ className, ...props }: ComponentProps<'label'>) {
  return (
    // oxlint-disable-next-line jsx-a11y/label-has-associated-control -- the caller names the control with `htmlFor` or by nesting it.
    <label data-slot='label' className={cn(labelClassName, className)} {...props} />
  )
}

export { Label, labelClassName }
