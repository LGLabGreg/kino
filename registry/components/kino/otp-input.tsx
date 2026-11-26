'use client'

import { separatorVariants } from '@/registry/components/kino/separator'
import { markMounted } from '@/registry/lib/refs'
import {
  OTPInputGroup as OTPInputGroupPrimitive,
  OTPInput as OTPInputPrimitive,
  OTPInputSeparator as OTPInputSeparatorPrimitive,
  OTPInputSlot as OTPInputSlotPrimitive,
} from '@ui-sdk/react/otp-input'
import { type ComponentProps, createContext, use } from 'react'

import { cn } from '@/lib/utils'

/*
 * A one-time code in separate boxes. ui-sdk keeps the code in one input laid
 * over the boxes, which a screen reader hears as one field; each box draws a
 * character, which rises into it as it's typed or pasted, and the box typing
 * goes to shows the focus and, while empty, a caret.
 */

/** Whether the boxes show a dot for each character. */
const MaskContext = createContext(false)

function OTPInput({
  className,
  mask = false,
  ...props
}: Omit<ComponentProps<typeof OTPInputPrimitive>, 'className'> & {
  className?: string
  /** Shows a dot for each character, as a password does. */
  mask?: boolean
}) {
  return (
    <MaskContext value={mask}>
      <OTPInputPrimitive
        className={cn('group/otp flex min-w-0 items-center gap-2', className)}
        {...props}
      />
    </MaskContext>
  )
}

function OTPInputGroup({
  className,
  ...props
}: Omit<ComponentProps<typeof OTPInputGroupPrimitive>, 'className'> & {
  className?: string
}) {
  return (
    <OTPInputGroupPrimitive
      className={cn('flex min-w-0 items-center gap-2', className)}
      {...props}
    />
  )
}

/**
 * A box drawn as Input's is, whose states come from the one input over the
 * boxes: the focus ring on the box typing goes to, and the invalid mark, a
 * dashed outline under forced colours, on every box. It narrows when the row
 * is short of room, so a long code stays on one line.
 */
const slotClassName =
  'group/slot relative flex h-(--control-height-lg) w-[calc(var(--control-height-lg)*0.9)] min-w-6 items-center justify-center rounded-(--control-radius) border border-input bg-transparent shadow-xs transition-[color,background-color,border-color,box-shadow] duration-(--motion-press-duration) ease-(--motion-press-fade-easing) group-has-focus-visible/otp:data-active:border-ring group-has-focus-visible/otp:data-active:ring-3 group-has-focus-visible/otp:data-active:ring-ring/50 forced-colors:group-has-focus-visible/otp:data-active:outline-2 forced-colors:group-has-focus-visible/otp:data-active:outline-[Highlight] group-has-aria-invalid/otp:border-destructive group-has-aria-invalid/otp:group-has-focus-visible/otp:data-active:border-destructive group-has-aria-invalid/otp:group-has-focus-visible/otp:data-active:ring-destructive/20 forced-colors:group-has-aria-invalid/otp:outline-2 forced-colors:group-has-aria-invalid/otp:outline-offset-1 forced-colors:group-has-aria-invalid/otp:outline-dashed data-disabled:opacity-50 dark:bg-input/30 dark:group-has-aria-invalid/otp:border-destructive/70 dark:group-has-aria-invalid/otp:group-has-focus-visible/otp:data-active:ring-destructive/40'

function OTPInputSlot({
  className,
  ...props
}: Omit<ComponentProps<typeof OTPInputSlotPrimitive>, 'className' | 'children'> & {
  className?: string
}) {
  const mask = use(MaskContext)
  return (
    <OTPInputSlotPrimitive
      ref={markMounted}
      className={cn(slotClassName, className)}
      {...props}
    >
      {({ char }) => (
        <>
          <span
            key={char}
            className='pointer-events-none text-lg font-medium tabular-nums transition-[opacity,translate,scale] duration-(--motion-enter-duration) ease-(--motion-enter-easing) group-data-mounted/slot:starting:opacity-0 motion-safe:group-data-mounted/slot:starting:translate-y-(--otp-input-rise,0.375rem) motion-safe:group-data-mounted/slot:starting:scale-75'
          >
            {mask && char ? '•' : char}
          </span>
          <span className='bg-foreground pointer-events-none absolute hidden h-5 w-px animate-pulse group-data-fake-caret/slot:block motion-reduce:animate-none' />
        </>
      )}
    </OTPInputSlotPrimitive>
  )
}

function OTPInputSeparator({
  className,
  ...props
}: Omit<ComponentProps<typeof OTPInputSeparatorPrimitive>, 'className'> & {
  className?: string
}) {
  return (
    <OTPInputSeparatorPrimitive
      className={cn(separatorVariants(), 'w-2.5', className)}
      {...props}
    />
  )
}

export { OTPInput, OTPInputGroup, OTPInputSeparator, OTPInputSlot }
