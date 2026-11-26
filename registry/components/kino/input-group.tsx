'use client'

import { Button } from '@/registry/components/kino/button'
import {
  focusControl,
  InputInvalidIcon,
  InputControl,
  inputBoxClassName,
} from '@/registry/components/kino/input'
import { TextareaControl } from '@/registry/components/kino/textarea'
import { InputGroup as InputGroupPrimitive } from '@ui-sdk/react/input'
import { cva, type VariantProps } from 'class-variance-authority'
import type { ComponentProps, ReactNode } from 'react'

import { cn } from '@/lib/utils'

/*
 * ui-sdk's Input group, as a box that holds a control and what sits beside
 * it: an icon, a prefix, a button, a counter. A press anywhere on it outside
 * a button puts the caret in the control, and the invalid mark sits before
 * what ends the row.
 */
function InputGroup({
  className,
  children,
  ...props
}: Omit<ComponentProps<typeof InputGroupPrimitive>, 'className' | 'children'> & {
  className?: string
  children?: ReactNode
}) {
  return (
    <InputGroupPrimitive
      role='group'
      onPointerDown={focusControl}
      className={cn(
        inputBoxClassName,
        'cursor-text has-[>[data-align=block-end]]:flex-col has-[>[data-align=block-end]]:items-stretch has-[textarea]:items-stretch',
        'has-[textarea]:rounded-(--control-radius-capped)',
        className,
      )}
      {...props}
    >
      {children}
      <InputInvalidIcon className='group-has-[>[data-align=block-end]]/input:absolute group-has-[>[data-align=block-end]]/input:end-0 group-has-[>[data-align=block-end]]/input:top-2.5' />
    </InputGroupPrimitive>
  )
}

const inputGroupAddonVariants = cva(
  'text-muted-foreground flex shrink-0 items-center gap-1.5 text-sm select-none',
  {
    variants: {
      align: {
        'inline-start': 'order-first ps-(--control-padding)',
        'inline-end':
          'order-last pe-1.5 has-[>[data-slot=input-group-text]:last-child]:pe-(--control-padding)',
        'block-end': 'order-last justify-end px-(--control-padding) pb-2',
      },
    },
    defaultVariants: {
      align: 'inline-start',
    },
  },
)

function InputGroupAddon({
  className,
  align = 'inline-start',
  ...props
}: Omit<
  ComponentProps<'div'> & VariantProps<typeof inputGroupAddonVariants>,
  'className'
> & { className?: string }) {
  return (
    <div
      data-slot='input-group-addon'
      data-align={align}
      className={cn(inputGroupAddonVariants({ align }), className)}
      {...props}
    />
  )
}

function InputGroupText({ className, ...props }: ComponentProps<'span'>) {
  return (
    <span
      data-slot='input-group-text'
      className={cn('text-muted-foreground flex items-center gap-1.5 text-sm', className)}
      {...props}
    />
  )
}

function InputGroupButton({
  variant = 'ghost',
  size = 'xs',
  ...props
}: ComponentProps<typeof Button>) {
  return <Button data-input-group-button='' variant={variant} size={size} {...props} />
}

/**
 * How a part of the group shows and hides, such as a clear button that is
 * there once the field holds something: it fades and scales on `enter` and
 * `exit` where it is and turns back from where it is, and while hidden it is
 * gone from the tab order and from screen readers. It shows with
 * `data-shown`.
 */
const inputGroupPresence =
  'transition-[opacity,scale,visibility,display] transition-discrete duration-(--motion-exit-duration) ease-(--motion-exit-easing) data-shown:duration-(--motion-enter-duration) data-shown:ease-(--motion-enter-easing) not-data-shown:invisible not-data-shown:opacity-0 motion-safe:not-data-shown:scale-75'

/** After an addon at the start, the value moves up to it: for a control of your own in the group. */
const inputGroupBesideStart =
  'group-has-[>[data-align=inline-start]]/input:ps-1.5 group-has-[>[data-align=inline-start]>[data-slot=input-group-text]:last-child]/input:ps-0'

function InputGroupInput({ className, ...props }: ComponentProps<typeof InputControl>) {
  return <InputControl className={cn(inputGroupBesideStart, className)} {...props} />
}

function InputGroupTextarea({
  className,
  ...props
}: ComponentProps<typeof TextareaControl>) {
  return (
    <TextareaControl
      className={cn('group-has-[>[data-align=block-end]]/input:pb-1', className)}
      {...props}
    />
  )
}

export {
  InputGroup,
  InputGroupAddon,
  inputGroupBesideStart,
  InputGroupButton,
  InputGroupInput,
  inputGroupPresence,
  InputGroupText,
  InputGroupTextarea,
}
