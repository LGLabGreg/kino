'use client'

import {
  choiceBoxClassName,
  choiceClassName,
  choicePressHandlers,
  choiceWipeClassName,
} from '@/registry/lib/choice'
import {
  Radio as RadioPrimitive,
  RadioGroup as RadioGroupPrimitive,
  RadioIndicator as RadioIndicatorPrimitive,
} from '@ui-sdk/react/radio'
import type { ComponentProps } from 'react'

import { cn } from '@/lib/utils'

function RadioGroup<T extends string = string>({
  className,
  ...props
}: Omit<ComponentProps<typeof RadioGroupPrimitive<T>>, 'className'> & {
  className?: string
}) {
  return (
    <RadioGroupPrimitive<T> className={cn('flex flex-col gap-3', className)} {...props} />
  )
}

function Radio({
  className,
  onKeyDown,
  onKeyUp,
  onBlur,
  ...props
}: Omit<ComponentProps<typeof RadioPrimitive>, 'className' | 'children'> & {
  className?: string
}) {
  return (
    <RadioPrimitive
      className={cn(choiceClassName, choiceBoxClassName, 'rounded-full', className)}
      {...choicePressHandlers({ onKeyDown, onKeyUp, onBlur })}
      {...props}
    >
      <RadioIndicator />
    </RadioPrimitive>
  )
}

/**
 * The picked disc with its dot, wiping in from the start side, inside a
 * Radio: its own box, or a Radio card's indicator.
 */
function RadioIndicator({
  className,
  ...props
}: Omit<ComponentProps<typeof RadioIndicatorPrimitive>, 'className' | 'keepMounted'> & {
  className?: string
}) {
  return (
    <RadioIndicatorPrimitive
      keepMounted
      className={cn(
        'bg-primary pointer-events-none absolute -inset-px flex items-center justify-center rounded-full forced-colors:bg-[Highlight]',
        choiceWipeClassName,
        'data-checked:[clip-path:inset(0_0_0_0)]!',
        className,
      )}
      {...props}
    >
      <span className='bg-primary-foreground size-1.5 rounded-full forced-colors:bg-[HighlightText]' />
    </RadioIndicatorPrimitive>
  )
}

export { Radio, RadioGroup, RadioIndicator }
