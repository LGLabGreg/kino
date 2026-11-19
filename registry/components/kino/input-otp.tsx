'use client'

import { inputBoxClassName } from '@/registry/components/kino/input'
import { separatorVariants } from '@/registry/components/kino/separator'
import { markMounted, mergeRefs } from '@/registry/lib/refs'
import { OTPField as OTPFieldPrimitive } from '@base-ui/react/otp-field'
import { useMemo } from 'react'

import { cn } from '@/lib/utils'

/*
 * A one-time code in separate boxes. Each character rises into its box as
 * it's typed or pasted, and an empty box that has focus shows a caret.
 */

/**
 * Gives every box the description and error that Base UI gives only the
 * group around them, so a screen reader says why a code is wrong in
 * whichever box has focus. Kept outside the component: the React Compiler
 * can drop side effects written inside one.
 */
function describeSlots(root: HTMLDivElement | null) {
  if (!root) return undefined
  const copy = () => {
    const ids = root.getAttribute('aria-describedby')
    for (const input of root.querySelectorAll('input')) {
      // Only on a change, or the observer would hear its own write.
      if (input.getAttribute('aria-describedby') === ids) continue
      if (ids) input.setAttribute('aria-describedby', ids)
      else input.removeAttribute('aria-describedby')
    }
  }
  copy()
  const observer = new MutationObserver(copy)
  observer.observe(root, {
    attributes: true,
    attributeFilter: ['aria-describedby'],
    childList: true,
    subtree: true,
  })
  return () => observer.disconnect()
}

function InputOTP({
  className,
  ref,
  ...props
}: Omit<OTPFieldPrimitive.Root.Props, 'className'> & {
  className?: string
}) {
  const refs = useMemo(() => mergeRefs(ref, describeSlots), [ref])
  return (
    <OTPFieldPrimitive.Root
      ref={refs}
      data-slot='input-otp'
      className={cn('flex min-w-0 items-center gap-2', className)}
      {...props}
    />
  )
}

function InputOTPSlot({
  className,
  ...props
}: Omit<OTPFieldPrimitive.Input.Props, 'className'> & {
  className?: string
}) {
  return (
    <OTPFieldPrimitive.Input
      data-slot='input-otp-slot'
      render={(inputProps, state) => (
        <span
          ref={markMounted}
          className={cn(
            inputBoxClassName,
            // Narrower when the row is short of room, so a long code stays on one line.
            'h-(--control-height-lg) w-[calc(var(--control-height-lg)*0.9)] min-w-6 justify-center',
            className,
          )}
        >
          <input
            {...inputProps}
            // Base UI names every slot after the field's label; each after the
            // first also says where it is.
            {...(state.index > 0 && !inputProps['aria-label'] && inputProps.id
              ? {
                  'aria-labelledby': [
                    inputProps['aria-labelledby'],
                    `${inputProps.id}-position`,
                  ]
                    .filter(Boolean)
                    .join(' '),
                }
              : {})}
            className='peer absolute inset-0 size-full rounded-[inherit] bg-transparent text-center text-transparent caret-transparent outline-hidden selection:bg-transparent'
          />
          <span
            key={state.value}
            aria-hidden
            className='pointer-events-none text-lg font-medium tabular-nums transition-[opacity,translate,scale] duration-(--motion-enter-duration) ease-(--motion-enter-easing) group-data-mounted/input:starting:opacity-0 motion-safe:group-data-mounted/input:starting:translate-y-(--input-otp-rise,0.375rem) motion-safe:group-data-mounted/input:starting:scale-75'
          >
            {inputProps.type === 'password' && state.value ? '•' : state.value}
          </span>
          {state.index > 0 && inputProps.id ? (
            <span id={`${inputProps.id}-position`} hidden>
              character {state.index + 1} of {state.length}
            </span>
          ) : null}
          <span
            aria-hidden
            className='bg-foreground pointer-events-none absolute h-5 w-px hidden animate-pulse peer-[:focus:not([data-filled])]:block motion-reduce:animate-none'
          />
        </span>
      )}
      {...props}
    />
  )
}

function InputOTPSeparator({
  className,
  ...props
}: Omit<OTPFieldPrimitive.Separator.Props, 'className'> & {
  className?: string
}) {
  return (
    <OTPFieldPrimitive.Separator
      data-slot='input-otp-separator'
      className={cn(separatorVariants(), 'w-2.5', className)}
      {...props}
    />
  )
}

export { InputOTP, InputOTPSeparator, InputOTPSlot }
