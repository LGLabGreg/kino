'use client'

import {
  choiceBoxClassName,
  choiceCheckboxClassName,
  choiceClassName,
  choicePressHandlers,
  choiceWipeClassName,
} from '@/registry/lib/choice'
import { reducesMotion } from '@/registry/lib/reduce-motion'
import { Checkbox as CheckboxPrimitive } from '@base-ui/react/checkbox'
import { CheckboxGroup as CheckboxGroupPrimitive } from '@base-ui/react/checkbox-group'

import { cn } from '@/lib/utils'

const mark = cn(choiceWipeClassName, '[transition-delay:var(--checkbox-delay)]')

function Checkbox({
  className,
  value,
  onKeyDown,
  onKeyUp,
  onBlur,
  ...props
}: Omit<CheckboxPrimitive.Root.Props, 'className'> & { className?: string }) {
  return (
    <CheckboxPrimitive.Root
      data-slot='checkbox'
      data-value={value}
      value={value}
      className={cn(
        choiceClassName,
        choiceBoxClassName,
        choiceCheckboxClassName,
        'group/checkbox',
        // The cascade waits on the colours only, in choiceBoxClassName's order
        // (background, border, ring, scale): a focus ring or a press answers at once.
        '[--checkbox-cascade:var(--checkbox-order,0)] [--checkbox-delay:calc(var(--motion-press-duration)*0.35*var(--checkbox-cascade))] [transition-delay:var(--checkbox-delay),var(--checkbox-delay),0s,0s] motion-reduce:[--checkbox-cascade:0]',
        className,
      )}
      {...choicePressHandlers({ onKeyDown, onKeyUp, onBlur })}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        keepMounted
        className='pointer-events-none flex items-center justify-center'
      >
        <CheckboxMark />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

/**
 * The tick and the dash, wiping in along their stroke, inside an element
 * marked `group/checkbox` that carries the state: a Checkbox's box, or a
 * Checkbox card's indicator.
 */
function CheckboxMark() {
  return (
    <svg
      viewBox='0 0 14 14'
      fill='none'
      stroke='currentColor'
      strokeWidth={2}
      strokeLinecap='round'
      strokeLinejoin='round'
      aria-hidden
      className='text-primary-foreground pointer-events-none size-3.5 overflow-visible forced-colors:text-[HighlightText]'
    >
      <path
        d='M3 7.4 5.8 10.2 11 4.2'
        className={cn(mark, 'group-data-checked/checkbox:[clip-path:inset(0_0_0_0)]!')}
      />
      <path
        d='M3.5 7h7'
        className={cn(
          mark,
          'group-data-indeterminate/checkbox:[clip-path:inset(0_0_0_0)]!',
        )}
      />
    </svg>
  )
}

/**
 * Where each box stands in a cascade: when one change ticks or clears more
 * than one box (a parent that selects all), the changed boxes are numbered in
 * reading order, so each one's mark wipes in a beat after the one before.
 * However many change, the last starts at most `CASCADE_STEPS` beats after the
 * first, so a long list still settles at once. A change to a single box
 * numbers none.
 */
const CASCADE_STEPS = 2

function cascadeOrder(
  boxes: readonly { value: string; checked: boolean }[],
  next: readonly string[],
): (number | null)[] {
  const changed = boxes.map((box) => box.checked !== next.includes(box.value))
  const count = changed.filter(Boolean).length
  if (count < 2) return boxes.map(() => null)
  const beat = Math.min(1, CASCADE_STEPS / (count - 1))
  let order = 0
  return changed.map((change) => (change ? order++ * beat : null))
}

const inGroup = (element: Element | null, group: Element) =>
  element?.closest('[data-slot=checkbox-group]') === group

function CheckboxGroup({
  className,
  onValueChange,
  onTransitionEnd,
  ...props
}: Omit<CheckboxGroupPrimitive.Props, 'className'> & { className?: string }) {
  return (
    <CheckboxGroupPrimitive
      data-slot='checkbox-group'
      className={cn('flex flex-col gap-3', className)}
      onValueChange={(next, details) => {
        const target = details.event.target
        const group =
          target instanceof Element ? target.closest('[data-slot=checkbox-group]') : null
        if (group && !reducesMotion(group)) {
          const boxes = [
            ...group.querySelectorAll<HTMLElement>('[data-slot=checkbox][data-value]'),
          ].filter((box) => inGroup(box, group))
          const order = cascadeOrder(
            boxes.map((box) => ({
              value: box.dataset.value ?? '',
              checked: box.hasAttribute('data-checked'),
            })),
            next,
          )
          boxes.forEach((box, index) => {
            const place = order[index]
            if (place === null) box.style.removeProperty('--checkbox-order')
            else box.style.setProperty('--checkbox-order', String(place))
          })
        }
        onValueChange?.(next, details)
      }}
      onTransitionEnd={(event) => {
        if (event.propertyName === 'clip-path' && event.target instanceof Element) {
          event.target
            .closest<HTMLElement>('[data-slot=checkbox]')
            ?.style.removeProperty('--checkbox-order')
        }
        onTransitionEnd?.(event)
      }}
      {...props}
    />
  )
}

export { Checkbox, CheckboxGroup, CheckboxMark, cascadeOrder }
