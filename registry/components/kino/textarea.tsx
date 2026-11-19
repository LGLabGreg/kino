'use client'

import {
  focusControl,
  InputInvalidIcon,
  inputBoxClassName,
} from '@/registry/components/kino/input'
import { Field as FieldPrimitive } from '@base-ui/react/field'
import type { ComponentProps } from 'react'

import { cn } from '@/lib/utils'

/** A textarea's corner: the control's, but never a pill. */
const textareaRadiusClassName = 'rounded-(--control-radius-capped)'

/** A multiline control's size in its box, which the Token input shares: it grows to a height, then scrolls. */
const textareaSizeClassName =
  'max-h-64 min-h-20 w-full px-(--control-padding) text-base scrollbar-thin outline-hidden group-has-aria-invalid/input:pe-9 md:text-sm'

/** The textarea inside a box: it grows with its text, then scrolls. */
const textareaControlClassName = cn(
  textareaSizeClassName,
  'field-sizing-content resize-none bg-transparent py-2 placeholder:text-muted-foreground read-only:text-muted-foreground',
)

type TextareaProps = Omit<ComponentProps<'textarea'>, 'className'> & {
  className?: string
}

/**
 * The textarea, wired to its Field. Base UI types Field.Control's props as an
 * input's, though it renders the textarea it is given, so a textarea's props
 * go through untyped here, in the one place.
 */
function TextareaControl({ className, ...props }: TextareaProps) {
  return (
    <FieldPrimitive.Control
      data-slot='textarea-control'
      render={<textarea />}
      className={cn(textareaControlClassName, className)}
      {...(props as object)}
    />
  )
}

function Textarea({ className, ...props }: TextareaProps) {
  return (
    <div
      data-slot='textarea'
      onPointerDown={focusControl}
      className={cn(
        inputBoxClassName,
        textareaRadiusClassName,
        'cursor-text items-stretch',
        className,
      )}
    >
      <TextareaControl {...props} />
      <InputInvalidIcon className='absolute end-0 top-2.5' />
    </div>
  )
}

export { Textarea, TextareaControl, textareaRadiusClassName, textareaSizeClassName }
