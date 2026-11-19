'use client'

import {
  choiceBoxClassName,
  choiceClassName,
  choicePressHandlers,
  choiceWipeClassName,
} from '@/registry/lib/choice'
import { Radio as RadioPrimitive } from '@base-ui/react/radio'
import { RadioGroup as RadioGroupPrimitive } from '@base-ui/react/radio-group'

import { cn } from '@/lib/utils'

function RadioGroup({
  className,
  ...props
}: Omit<RadioGroupPrimitive.Props, 'className'> & { className?: string }) {
  return (
    <RadioGroupPrimitive
      data-slot='radio-group'
      className={cn('flex flex-col gap-3', className)}
      {...props}
    />
  )
}

function Radio({
  className,
  onKeyDown,
  onKeyUp,
  onBlur,
  ...props
}: Omit<RadioPrimitive.Root.Props, 'className'> & { className?: string }) {
  return (
    <RadioPrimitive.Root
      data-slot='radio'
      className={cn(choiceClassName, choiceBoxClassName, 'rounded-full', className)}
      {...choicePressHandlers({ onKeyDown, onKeyUp, onBlur })}
      {...props}
    >
      <RadioMark />
    </RadioPrimitive.Root>
  )
}

/**
 * The picked disc with its dot, wiping in from the start side. Inside any
 * Radio.Root: a Radio's own box, or a Radio card's indicator.
 */
function RadioMark() {
  return (
    <RadioPrimitive.Indicator
      keepMounted
      className={cn(
        'bg-primary pointer-events-none absolute -inset-px flex items-center justify-center rounded-full forced-colors:bg-[Highlight]',
        choiceWipeClassName,
        'data-checked:[clip-path:inset(0_0_0_0)]!',
      )}
    >
      <span className='bg-primary-foreground size-1.5 rounded-full forced-colors:bg-[HighlightText]' />
    </RadioPrimitive.Indicator>
  )
}

export { Radio, RadioGroup, RadioMark }
