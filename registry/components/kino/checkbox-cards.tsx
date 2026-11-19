'use client'

import { CheckboxMark } from '@/registry/components/kino/checkbox'
import {
  ChoiceCardContext,
  choiceBoxClassName,
  choiceCardClassName,
  choiceCardDescriptionClassName,
  choiceCardFloodClassName,
  choiceCardFloodHandlers,
  choiceCardTitleClassName,
  choiceCheckboxClassName,
  choicePressHandlers,
} from '@/registry/lib/choice'
import { Checkbox as CheckboxPrimitive } from '@base-ui/react/checkbox'
import { CheckboxGroup as CheckboxGroupPrimitive } from '@base-ui/react/checkbox-group'
import { type ComponentProps, use, useId } from 'react'

import { cn } from '@/lib/utils'

/*
 * Several options, each a card: add-ons, notification channels. Ticked, the
 * card's tint spreads out from where it was pressed until it fills the card,
 * and its border turns primary; cleared, the tint drains back to the press.
 * Space spreads it from the checkbox.
 */

function CheckboxCards({
  className,
  ...props
}: Omit<CheckboxGroupPrimitive.Props, 'className'> & { className?: string }) {
  return (
    <CheckboxGroupPrimitive
      data-slot='checkbox-cards'
      className={cn(
        // Columns at least 14rem wide, as many as fit, so the cards wrap from a phone to a wide page.
        'relative isolate grid grid-cols-[repeat(auto-fit,minmax(min(100%,14rem),1fr))] gap-3',
        className,
      )}
      {...props}
    />
  )
}

function CheckboxCard({
  className,
  children,
  onPointerDown,
  onFocus,
  onKeyDown,
  onKeyUp,
  onBlur,
  ...props
}: Omit<CheckboxPrimitive.Root.Props, 'className' | 'nativeButton' | 'render'> & {
  className?: string
}) {
  const id = useId()
  const ids = { title: `${id}-title`, description: `${id}-description` }
  const press = choicePressHandlers({ onKeyDown, onKeyUp, onBlur })
  return (
    <CheckboxPrimitive.Root
      data-slot='checkbox-card'
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
        data-slot='checkbox-card-flood'
        className={choiceCardFloodClassName}
      />
      <ChoiceCardContext value={ids}>{children}</ChoiceCardContext>
    </CheckboxPrimitive.Root>
  )
}

/** The card's checkbox, whose tick wipes in along its stroke. */
function CheckboxCardIndicator({
  className,
  ...props
}: Omit<CheckboxPrimitive.Indicator.Props, 'className' | 'keepMounted'> & {
  className?: string
}) {
  return (
    <CheckboxPrimitive.Indicator
      data-slot='checkbox-card-indicator'
      keepMounted
      aria-hidden
      className={cn(
        choiceBoxClassName,
        choiceCheckboxClassName,
        'group/checkbox relative inline-flex',
        className,
      )}
      {...props}
    >
      <CheckboxMark />
    </CheckboxPrimitive.Indicator>
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
