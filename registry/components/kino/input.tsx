'use client'

import { IconPlaceholder } from '@/registry/icons/icon-placeholder'
import { markMounted } from '@/registry/lib/refs'
import { Input as InputPrimitive } from '@base-ui/react/input'
import type { ComponentProps, PointerEvent } from 'react'

import { cn } from '@/lib/utils'

/*
 * The box every text control sits in: Input, Textarea, Input group, Number
 * field, Native select and the code field's slots. It reads its state from
 * the control inside it, so it works in a Field or on its own.
 */
const inputBoxClassName =
  "group/input relative flex min-w-0 items-center rounded-(--control-radius) border border-input bg-transparent shadow-xs transition-[color,background-color,border-color,box-shadow] duration-(--motion-press-duration) ease-(--motion-press-fade-easing) has-focus-visible:border-ring has-focus-visible:ring-3 has-focus-visible:ring-ring/50 has-aria-invalid:border-destructive has-aria-invalid:has-focus-visible:border-destructive has-aria-invalid:has-focus-visible:ring-destructive/20 forced-colors:has-aria-invalid:outline-2 forced-colors:has-aria-invalid:outline-offset-1 forced-colors:has-aria-invalid:outline-dashed has-[:is(input,textarea,select):disabled]:pointer-events-none has-[:is(input,textarea,select):disabled]:opacity-50 has-[:is(input,textarea,select)[aria-disabled=true]]:opacity-50 dark:bg-input/30 dark:has-aria-invalid:border-destructive/70 dark:has-aria-invalid:has-focus-visible:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-muted-foreground"

/**
 * The text inside a box, at the control's height. A search box hides the
 * browser's own clear button, which only some browsers draw and none lets us
 * style: a clear button is an `InputGroupButton`, as in the docs.
 */
const inputControlClassName =
  '[&::-webkit-search-cancel-button]:appearance-none h-(--control-height) w-full min-w-0 flex-1 bg-transparent px-(--control-padding) text-base focus-visible:outline-hidden placeholder:text-muted-foreground read-only:text-muted-foreground md:text-sm'

/** A press on a box, outside its value and its buttons, puts the caret in the value. */
function focusControl(event: PointerEvent<HTMLElement>) {
  const target = event.target as HTMLElement
  if (target.closest('input, textarea, select, button, a, [data-slot*=scrub]')) return
  // Not a part's own hidden input, such as a Combobox's or a field's form value.
  const control = event.currentTarget.querySelector<HTMLElement>(
    ':is(input, textarea, select):not([type=hidden], [aria-hidden=true])',
  )
  if (!control) return
  event.preventDefault()
  control.focus()
}

/**
 * The mark an invalid control shows, so an error isn't told by colour alone:
 * in a box whose control is invalid, or inside an invalid control, such as a
 * select's trigger.
 */
function InputInvalidIcon({ className, ...props }: ComponentProps<'span'>) {
  return (
    <span
      ref={markMounted}
      data-slot='input-invalid-icon'
      aria-hidden
      className={cn(
        // It scales in on `enter` and out on `exit`, and turns back from
        // where it is; one that is invalid on page load is simply there.
        'text-destructive hidden shrink-0 items-center pe-(--control-padding) opacity-0 transition-[opacity,scale,display] transition-discrete duration-(--motion-exit-duration) ease-(--motion-exit-easing) group-has-aria-invalid/input:flex motion-safe:group-has-aria-invalid/input:scale-100 group-has-aria-invalid/input:opacity-100 group-has-aria-invalid/input:duration-(--motion-enter-duration) group-has-aria-invalid/input:ease-(--motion-enter-easing) in-aria-invalid:flex motion-safe:in-aria-invalid:scale-100 in-aria-invalid:opacity-100 in-aria-invalid:duration-(--motion-enter-duration) in-aria-invalid:ease-(--motion-enter-easing) data-mounted:starting:opacity-0 motion-safe:scale-50 motion-safe:data-mounted:starting:scale-50',
        className,
      )}
      {...props}
    >
      {/* Its own colour class, so the box's muted icon colour skips it. */}
      <IconPlaceholder
        className='text-destructive'
        lucide='CircleXIcon'
        tabler='IconCircleX'
        hugeicons='CancelCircleIcon'
        phosphor='XCircleIcon'
        remixicon='RiCloseCircleLine'
        aria-hidden
      />
    </span>
  )
}

type InputControlProps = Omit<InputPrimitive.Props, 'className'> & { className?: string }

/** The `<input>` alone, at the control's height, for a box of your own. */
function InputControl({ className, ...props }: InputControlProps) {
  return (
    <InputPrimitive
      data-slot='input-control'
      className={cn(inputControlClassName, className)}
      {...props}
    />
  )
}

function Input({ className, ...props }: InputControlProps) {
  return (
    <div
      data-slot='input'
      onPointerDown={focusControl}
      className={cn(inputBoxClassName, 'cursor-text', className)}
    >
      <InputControl {...props} />
      <InputInvalidIcon />
    </div>
  )
}

export {
  focusControl,
  Input,
  InputControl,
  InputInvalidIcon,
  inputBoxClassName,
  inputControlClassName,
}
