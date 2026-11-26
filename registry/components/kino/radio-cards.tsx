'use client'

import { RadioIndicator } from '@/registry/components/kino/radio'
import {
  ChoiceCardContext,
  choiceCardBoxClassName,
  choiceCardClassName,
  choiceCardDescriptionClassName,
  choiceCardFloodClassName,
  choiceCardFloodHandlers,
  choiceCardTitleClassName,
  choicePressHandlers,
} from '@/registry/lib/choice'
import {
  Radio as RadioPrimitive,
  RadioGroup as RadioGroupPrimitive,
} from '@ui-sdk/react/radio'
import { type ComponentProps, type ReactNode, use, useId } from 'react'

import { cn } from '@/lib/utils'

/*
 * One of a few options, each a card: a plan, a shipping method. The card is
 * a label around its radio, so a press anywhere on it picks it. Picked, the
 * card's tint spreads out from where it was pressed until it fills the card,
 * as Checkbox cards' does, while the old pick's tint drains away; the picked
 * card's border and its radio answer the press. Arrow keys and Space spread
 * it from the radio.
 */

function RadioCards<T extends string = string>({
  className,
  ...props
}: Omit<ComponentProps<typeof RadioGroupPrimitive<T>>, 'className'> & {
  className?: string
}) {
  return (
    <RadioGroupPrimitive<T>
      className={cn(
        // Columns at least 14rem wide, as many as fit, so the cards wrap from a phone to a wide page.
        'relative isolate grid grid-cols-[repeat(auto-fit,minmax(min(100%,14rem),1fr))] gap-3',
        className,
      )}
      {...props}
    />
  )
}

type RadioProps = ComponentProps<typeof RadioPrimitive>

/** One option's card. Its props go to its radio, the `RadioCardIndicator` inside it, and `className` to the card. */
function RadioCard({
  className,
  children,
  ...props
}: Omit<RadioProps, 'className' | 'children'> & {
  className?: string
  children?: ReactNode
}) {
  const id = useId()
  return (
    <label
      data-slot='radio-card'
      data-choice-card=''
      className={cn(choiceCardClassName, className)}
      {...choiceCardFloodHandlers}
    >
      <span
        aria-hidden
        data-slot='radio-card-flood'
        className={choiceCardFloodClassName}
      />
      <ChoiceCardContext
        value={{ title: `${id}-title`, description: `${id}-description`, control: props }}
      >
        {children}
      </ChoiceCardContext>
    </label>
  )
}

/** The card's radio, named by the card's title and described by its description, which shows the pick as a disc that wipes in. */
function RadioCardIndicator({ className }: { className?: string }) {
  const { title, description, control } = use(ChoiceCardContext)
  const { onKeyDown, onKeyUp, onBlur, ...props } = control as RadioProps
  return (
    <RadioPrimitive
      aria-labelledby={title}
      aria-describedby={description}
      className={cn(
        choiceCardBoxClassName,
        'relative inline-flex rounded-full',
        className,
      )}
      {...choicePressHandlers({ onKeyDown, onKeyUp, onBlur })}
      {...props}
    >
      <RadioIndicator />
    </RadioPrimitive>
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
