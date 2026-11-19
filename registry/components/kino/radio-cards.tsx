'use client'

import { RadioMark } from '@/registry/components/kino/radio-group'
import {
  ChoiceCardContext,
  choiceBoxClassName,
  choiceCardClassName,
  choiceCardDescriptionClassName,
  choiceCardFloodClassName,
  choiceCardFloodHandlers,
  choiceCardTitleClassName,
  choicePressHandlers,
} from '@/registry/lib/choice'
import { Radio as RadioPrimitive } from '@base-ui/react/radio'
import { RadioGroup as RadioGroupPrimitive } from '@base-ui/react/radio-group'
import { type ComponentProps, use, useId } from 'react'

import { cn } from '@/lib/utils'

/*
 * One of a few options, each a card: a plan, a shipping method. Picked, the
 * card's tint spreads out from where it was pressed until it fills the card,
 * as Checkbox cards' does, while the old pick's tint drains away; the picked
 * card's border and its radio answer the press. Arrow keys and Space spread
 * it from the radio.
 */

function RadioCards<Value>({
  className,
  ...props
}: Omit<RadioGroupPrimitive.Props<Value>, 'className'> & { className?: string }) {
  return (
    <RadioGroupPrimitive
      data-slot='radio-cards'
      className={cn(
        // Columns at least 14rem wide, as many as fit, so the cards wrap from a phone to a wide page.
        'relative isolate grid grid-cols-[repeat(auto-fit,minmax(min(100%,14rem),1fr))] gap-3',
        className,
      )}
      {...props}
    />
  )
}

function RadioCard({
  className,
  children,
  onPointerDown,
  onFocus,
  onKeyDown,
  onKeyUp,
  onBlur,
  ...props
}: Omit<RadioPrimitive.Root.Props, 'className' | 'nativeButton' | 'render'> & {
  className?: string
}) {
  const id = useId()
  const ids = { title: `${id}-title`, description: `${id}-description` }
  const press = choicePressHandlers({ onKeyDown, onKeyUp, onBlur })
  return (
    <RadioPrimitive.Root
      data-slot='radio-card'
      data-choice-card=''
      render={<div />}
      aria-labelledby={ids.title}
      aria-describedby={ids.description}
      className={cn(choiceCardClassName, className)}
      {...press}
      {...choiceCardFloodHandlers({ onPointerDown, onFocus, onKeyDown: press.onKeyDown })}
      {...props}
    >
      <span
        aria-hidden
        data-slot='radio-card-flood'
        className={choiceCardFloodClassName}
      />
      <ChoiceCardContext value={ids}>{children}</ChoiceCardContext>
    </RadioPrimitive.Root>
  )
}

/** The card's radio, which shows the pick as a disc that wipes in. */
function RadioCardIndicator({
  className,
  ...props
}: Omit<RadioPrimitive.Indicator.Props, 'className' | 'keepMounted'> & {
  className?: string
}) {
  return (
    <RadioPrimitive.Indicator
      data-slot='radio-card-indicator'
      keepMounted
      aria-hidden
      className={cn(choiceBoxClassName, 'relative inline-flex rounded-full', className)}
      {...props}
    >
      <RadioMark />
    </RadioPrimitive.Indicator>
  )
}

function RadioCardTitle({ className, ...props }: ComponentProps<'div'>) {
  const { title } = use(ChoiceCardContext)
  return (
    <div
      data-slot='radio-card-title'
      id={title}
      className={cn(choiceCardTitleClassName, className)}
      {...props}
    />
  )
}

function RadioCardDescription({ className, ...props }: ComponentProps<'div'>) {
  const { description } = use(ChoiceCardContext)
  return (
    <div
      data-slot='radio-card-description'
      id={description}
      className={cn(choiceCardDescriptionClassName, className)}
      {...props}
    />
  )
}

export { RadioCard, RadioCardDescription, RadioCardIndicator, RadioCards, RadioCardTitle }
