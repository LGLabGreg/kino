'use client'

import { CheckboxIndicator } from '@/registry/components/kino/checkbox'
import {
  ChoiceCardContext,
  choiceCardBoxClassName,
  choiceCardClassName,
  choiceCardDescriptionClassName,
  choiceCardFloodClassName,
  choiceCardFloodHandlers,
  choiceCardTitleClassName,
  choiceCheckboxClassName,
  choicePressHandlers,
} from '@/registry/lib/choice'
import {
  Checkbox as CheckboxPrimitive,
  CheckboxGroup as CheckboxGroupPrimitive,
} from '@ui-sdk/react/checkbox'
import { type ComponentProps, type ReactNode, use, useId } from 'react'

import { cn } from '@/lib/utils'

/*
 * Several options, each a card: add-ons, notification channels. The card is
 * a label around its checkbox, so a press anywhere on it ticks the box.
 * Ticked, the card's tint spreads out from where it was pressed until it
 * fills the card, and its border turns primary; cleared, the tint drains
 * back to the press. Space spreads it from the checkbox.
 */

function CheckboxCards<T extends string = string>({
  className,
  ...props
}: Omit<ComponentProps<typeof CheckboxGroupPrimitive<T>>, 'className'> & {
  className?: string
}) {
  return (
    <CheckboxGroupPrimitive<T>
      className={cn(
        // Columns at least 14rem wide, as many as fit, so the cards wrap from a phone to a wide page.
        'relative isolate grid grid-cols-[repeat(auto-fit,minmax(min(100%,14rem),1fr))] gap-3',
        className,
      )}
      {...props}
    />
  )
}

type CheckboxProps = ComponentProps<typeof CheckboxPrimitive>

/** One option's card. Its props go to its checkbox, the `CheckboxCardIndicator` inside it, and `className` to the card. */
function CheckboxCard({
  className,
  children,
  ...props
}: Omit<CheckboxProps, 'className' | 'children'> & {
  className?: string
  children?: ReactNode
}) {
  const id = useId()
  return (
    <label
      data-slot='checkbox-card'
      data-choice-card=''
      className={cn(choiceCardClassName, className)}
      {...choiceCardFloodHandlers}
    >
      <span
        aria-hidden
        data-slot='checkbox-card-flood'
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

/** The card's checkbox, named by the card's title and described by its description, whose tick wipes in along its stroke. */
function CheckboxCardIndicator({ className }: { className?: string }) {
  const { title, description, control } = use(ChoiceCardContext)
  const { onKeyDown, onKeyUp, onBlur, ...props } = control as CheckboxProps
  return (
    <CheckboxPrimitive
      aria-labelledby={title}
      aria-describedby={description}
      className={cn(
        choiceCardBoxClassName,
        choiceCheckboxClassName,
        'group/checkbox relative inline-flex',
        className,
      )}
      {...choicePressHandlers({ onKeyDown, onKeyUp, onBlur })}
      {...props}
    >
      <CheckboxIndicator />
    </CheckboxPrimitive>
  )
}

function CheckboxCardTitle({ className, ...props }: ComponentProps<'div'>) {
  const { title } = use(ChoiceCardContext)
  return (
    <div
      data-slot='checkbox-card-title'
      id={title}
      className={cn(choiceCardTitleClassName, className)}
      {...props}
    />
  )
}

function CheckboxCardDescription({ className, ...props }: ComponentProps<'div'>) {
  const { description } = use(ChoiceCardContext)
  return (
    <div
      data-slot='checkbox-card-description'
      id={description}
      className={cn(choiceCardDescriptionClassName, className)}
      {...props}
    />
  )
}

export {
  CheckboxCard,
  CheckboxCardDescription,
  CheckboxCardIndicator,
  CheckboxCards,
  CheckboxCardTitle,
}
