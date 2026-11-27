'use client'

import {
  focusControl,
  InputInvalidIcon,
  inputBoxClassName,
} from '@/registry/components/kino/input'
import { InputGroup as InputGroupPrimitive } from '@ui-sdk/react/input'
import { Textarea as TextareaPrimitive } from '@ui-sdk/react/textarea'
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
  'resize-none bg-transparent py-2 placeholder:text-muted-foreground read-only:text-muted-foreground',
)

type TextareaProps = Omit<ComponentProps<typeof TextareaPrimitive>, 'className'> & {
  className?: string
}

/** ui-sdk's textarea alone, growing with its text up to its height, for a box of your own. */
function TextareaControl({ className, autoResize = true, ...props }: TextareaProps) {
  return (
    <TextareaPrimitive
      autoResize={autoResize}
      // CSS sizes it on first paint, before ui-sdk's autoResize runs, so nothing below it moves on load.
      className={cn(
        textareaControlClassName,
        autoResize && 'field-sizing-content',
        // One row is a one-line field that grows as its text wraps, such as a title.
        props.rows === 1 && 'min-h-0',
        className,
      )}
      {...props}
    />
  )
}

/** The box the textarea sits in, with its invalid mark; the props go to the textarea, `className` to the box. */
function Textarea({ className, ...props }: TextareaProps) {
  return (
    <InputGroupPrimitive
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
    </InputGroupPrimitive>
  )
}

export { Textarea, TextareaControl, textareaRadiusClassName, textareaSizeClassName }
