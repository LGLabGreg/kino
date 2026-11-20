'use client'

import {
  InputInvalidIcon,
  inputBoxClassName,
  inputControlClassName,
} from '@/registry/components/kino/input'
import { IconPlaceholder } from '@/registry/icons/icon-placeholder'
import { runningTransitions } from '@/registry/lib/resize'
import { Roll } from '@/registry/lib/roll'
import { NumberField as NumberFieldPrimitive } from '@base-ui/react/number-field'
import {
  type ComponentProps,
  createContext,
  type TransitionEvent,
  use,
  useState,
} from 'react'

import { cn } from '@/lib/utils'

/*
 * A number field whose digits roll when the value is stepped: by the
 * buttons, the arrow keys, the wheel or a scrub. Typing never rolls.
 */

/** The digits are still, or rolling up (`1`) or down (`-1`). */
type RollState = { phase: 'still' } | { phase: 'rolling'; trend: 1 | -1 }

const STILL: RollState = { phase: 'still' }

const STEP_REASONS = new Set<NumberFieldPrimitive.Root.ChangeEventReason>([
  'increment-press',
  'decrement-press',
  'keyboard',
  'wheel',
  'scrub',
])

/** Whether a change of this reason, from `prev` to `next`, rolls the digits, and which way. */
function rollOf(
  reason: NumberFieldPrimitive.Root.ChangeEventReason,
  next: number | null,
  prev: number | null,
): RollState {
  return isStep(reason) ? rollTo(next, prev) : STILL
}

/** Whether a change of this reason stepped the value, by a button, a key, the wheel or a scrub, rather than typing or pasting it. */
function isStep(reason: NumberFieldPrimitive.Root.ChangeEventReason) {
  return STEP_REASONS.has(reason)
}

/** The roll from `prev` to `next`: none when either is empty or they are the same. */
function rollTo(next: number | null, prev: number | null): RollState {
  if (next === null || prev === null || next === prev) return STILL
  return { phase: 'rolling', trend: next > prev ? 1 : -1 }
}

const RollContext = createContext<{ roll: RollState; settle: () => void }>({
  roll: STILL,
  settle: () => {},
})

function NumberField({
  className,
  onValueChange,
  ...props
}: Omit<NumberFieldPrimitive.Root.Props, 'className'> & { className?: string }) {
  const [roll, setRoll] = useState<RollState>(STILL)
  // The value it showed last. A parent that owns the value may change it on its own, as a pager's Next does: that rolls too.
  const [shown, setShown] = useState<number | null>(
    props.value === undefined ? (props.defaultValue ?? null) : props.value,
  )
  if (props.value !== undefined && props.value !== shown) {
    setShown(props.value)
    setRoll(rollTo(props.value, shown))
  }
  const settle = () => setRoll(STILL)

  return (
    <RollContext value={{ roll, settle }}>
      <NumberFieldPrimitive.Root
        data-slot='number-field'
        className={cn('flex min-w-0 flex-col', className)}
        onValueChange={(value, details) => {
          setShown(value)
          setRoll(rollOf(details.reason, value, shown))
          onValueChange?.(value, details)
        }}
        {...props}
      />
    </RollContext>
  )
}

function NumberFieldGroup({
  className,
  ...props
}: Omit<NumberFieldPrimitive.Group.Props, 'className'> & { className?: string }) {
  return (
    <NumberFieldPrimitive.Group
      data-slot='number-field-group'
      className={cn(inputBoxClassName, 'w-full overflow-hidden', className)}
      {...props}
    />
  )
}

const stepperClassName =
  'flex size-(--control-height) shrink-0 items-center justify-center text-muted-foreground transition-[color,background-color] duration-(--motion-press-duration) ease-(--motion-press-fade-easing) select-none hover:bg-muted hover:text-foreground data-disabled:opacity-50 data-disabled:hover:bg-transparent'

function NumberFieldDecrement({
  className,
  children,
  ...props
}: Omit<NumberFieldPrimitive.Decrement.Props, 'className'> & { className?: string }) {
  return (
    <NumberFieldPrimitive.Decrement
      data-slot='number-field-decrement'
      aria-label='Decrease'
      className={cn(stepperClassName, 'border-e border-input', className)}
      {...props}
    >
      {children ?? (
        <IconPlaceholder
          lucide='MinusIcon'
          tabler='IconMinus'
          hugeicons='MinusSignIcon'
          phosphor='MinusIcon'
          remixicon='RiSubtractLine'
          aria-hidden
        />
      )}
    </NumberFieldPrimitive.Decrement>
  )
}

function NumberFieldIncrement({
  className,
  children,
  ...props
}: Omit<NumberFieldPrimitive.Increment.Props, 'className'> & { className?: string }) {
  return (
    <NumberFieldPrimitive.Increment
      data-slot='number-field-increment'
      aria-label='Increase'
      className={cn(stepperClassName, 'border-s border-input', className)}
      {...props}
    >
      {children ?? (
        <IconPlaceholder
          lucide='PlusIcon'
          tabler='IconPlus'
          hugeicons='Add01Icon'
          phosphor='PlusIcon'
          remixicon='RiAddLine'
          aria-hidden
        />
      )}
    </NumberFieldPrimitive.Increment>
  )
}

/**
 * A number field's `<input>`, with a copy of its value drawn over it that
 * rolls while the value is stepped. `className` sets where the text sits and
 * its padding, on the input and the copy alike. For a field of your own
 * around Base UI's input, such as the Money input.
 */
function RollingInput({
  inputProps,
  inputValue,
  decimal,
  className,
}: {
  inputProps: ComponentProps<'input'>
  inputValue: string
  /** The locale's decimal point, so digits line up on it when a step adds decimals: 1,280 to 1,281.00 rolls one digit. */
  decimal?: string
  className?: string
}) {
  const { roll, settle } = use(RollContext)
  const rolling = roll.phase === 'rolling'
  const settleWhenStill = (event: TransitionEvent<HTMLSpanElement>) => {
    const moving = runningTransitions(event.currentTarget, { subtree: true }).some(
      (transition) => transition.playState === 'running',
    )
    if (!moving) settle()
  }
  return (
    // While the digits roll, the input's own text hides under a copy that rolls.
    <span className='relative flex min-w-0 flex-1'>
      <input
        {...inputProps}
        className={cn(
          inputControlClassName,
          'tabular-nums',
          className,
          rolling && 'text-transparent caret-transparent',
        )}
      />
      <span
        className={cn(
          'pointer-events-none absolute inset-0 flex items-center overflow-hidden px-(--control-padding) text-base tabular-nums md:text-sm',
          className,
          !rolling && 'invisible',
        )}
        // The input shows again once every digit has landed, however long the feel takes.
        onTransitionEnd={settleWhenStill}
        onTransitionCancel={settleWhenStill}
      >
        {/* A full-width line, so the copy sits where the input's text-align puts its text. */}
        <span className='w-full'>
          <Roll
            value={inputValue}
            tail={rollTail(inputValue, decimal)}
            trend={rolling ? roll.trend : 1}
          />
        </span>
      </span>
    </span>
  )
}

/** How many characters come after the decimal point, the place a value's digits line up on; 0 without one. */
function rollTail(value: string, decimal: string | undefined) {
  const at = decimal ? value.lastIndexOf(decimal) : -1
  return at === -1 ? 0 : value.length - at
}

function NumberFieldInput({
  className,
  ...props
}: Omit<NumberFieldPrimitive.Input.Props, 'className'> & { className?: string }) {
  return (
    <NumberFieldPrimitive.Input
      data-slot='number-field-input'
      render={(inputProps, state) => (
        <span className={cn('flex min-w-0 flex-1 items-center', className)}>
          <RollingInput
            inputProps={inputProps}
            inputValue={state.inputValue}
            className='text-center'
          />
          <InputInvalidIcon />
        </span>
      )}
      {...props}
    />
  )
}

/**
 * An area, such as the field's label, that changes the value when dragged
 * sideways, or up and down with `direction`. While it drags, the pointer is locked and hidden, so the area
 * draws its own cursor where the pointer would be.
 */
function NumberFieldScrubArea({
  className,
  children,
  direction = 'horizontal',
  ...props
}: Omit<NumberFieldPrimitive.ScrubArea.Props, 'className'> & { className?: string }) {
  const vertical = direction === 'vertical'
  return (
    <NumberFieldPrimitive.ScrubArea
      data-slot='number-field-scrub-area'
      direction={direction}
      className={cn(
        'w-fit',
        vertical ? 'cursor-ns-resize' : 'cursor-ew-resize',
        className,
      )}
      {...props}
    >
      {children}
      <NumberFieldPrimitive.ScrubAreaCursor
        data-slot='number-field-scrub-area-cursor'
        // An outline in the background colour keeps it readable over any content.
        className='text-foreground z-50 drop-shadow-[0_0_1px_var(--background)] [&_svg]:size-5'
      >
        {vertical ? (
          <IconPlaceholder
            lucide='MoveVerticalIcon'
            tabler='IconArrowsVertical'
            hugeicons='MoveVerticalIcon'
            phosphor='ArrowsVerticalIcon'
            remixicon='RiExpandUpDownLine'
            aria-hidden
          />
        ) : (
          <IconPlaceholder
            lucide='MoveHorizontalIcon'
            tabler='IconArrowsHorizontal'
            hugeicons='MoveHorizontalIcon'
            phosphor='ArrowsHorizontalIcon'
            remixicon='RiExpandLeftRightLine'
            aria-hidden
          />
        )}
      </NumberFieldPrimitive.ScrubAreaCursor>
    </NumberFieldPrimitive.ScrubArea>
  )
}

export {
  isStep,
  NumberField,
  NumberFieldDecrement,
  NumberFieldGroup,
  NumberFieldIncrement,
  NumberFieldInput,
  NumberFieldScrubArea,
  RollingInput,
  rollOf,
  rollTail,
}
