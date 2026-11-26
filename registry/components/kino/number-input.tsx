'use client'

import {
  InputInvalidIcon,
  inputBoxClassName,
  inputControlClassName,
} from '@/registry/components/kino/input'
import { IconPlaceholder } from '@/registry/icons/icon-placeholder'
import { mergeRefs } from '@/registry/lib/refs'
import { runningTransitions } from '@/registry/lib/resize'
import { Roll } from '@/registry/lib/roll'
import {
  NumberInputControl as NumberInputControlPrimitive,
  NumberInputDecrement as NumberInputDecrementPrimitive,
  NumberInputGroup as NumberInputGroupPrimitive,
  NumberInputIncrement as NumberInputIncrementPrimitive,
  NumberInput as NumberInputPrimitive,
  NumberInputScrubAreaCursor as NumberInputScrubAreaCursorPrimitive,
  NumberInputScrubArea as NumberInputScrubAreaPrimitive,
  type NumberInputValueChangeReason,
} from '@ui-sdk/react/number-input'
import {
  type ComponentProps,
  createContext,
  type ReactNode,
  type TransitionEvent,
  use,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import { cn } from '@/lib/utils'

/*
 * A number input whose digits roll when the value is stepped: by the
 * buttons, the arrow keys, the wheel, a scrub or an agent. Typing never rolls.
 */

/** The digits are still, or rolling up (`1`) or down (`-1`). */
type RollState = { phase: 'still' } | { phase: 'rolling'; trend: 1 | -1 }

const STILL: RollState = { phase: 'still' }

const STEP_REASONS = new Set<NumberInputValueChangeReason>([
  'increment-press',
  'decrement-press',
  'step-key',
  'wheel',
  'scrub',
  'imperative',
])

/** Whether a change of this reason, from `prev` to `next`, rolls the digits, and which way. */
function rollOf(
  reason: NumberInputValueChangeReason,
  next: number | null,
  prev: number | null,
): RollState {
  return isStep(reason) ? rollTo(next, prev) : STILL
}

/**
 * Whether a change of this reason stepped the value, by a button, a key, the
 * wheel, a scrub, or an agent or a controller setting it, rather than typing,
 * pasting or a form's reset.
 */
function isStep(reason: NumberInputValueChangeReason) {
  return STEP_REASONS.has(reason)
}

/** The roll from `prev` to `next`: none when either is empty or they are the same. */
function rollTo(next: number | null, prev: number | null): RollState {
  if (next === null || prev === null || next === prev) return STILL
  return { phase: 'rolling', trend: next > prev ? 1 : -1 }
}

/** The roll, the input's text the copy shows (null until it has been read), and how the copy says it has landed. */
const RollContext = createContext<{
  roll: RollState
  text: string | null
  settle: () => void
}>({
  roll: STILL,
  text: null,
  settle: () => {},
})

function NumberInput({
  className,
  onValueChange,
  onInput,
  onBlur,
  onKeyUp,
  ref,
  ...props
}: Omit<ComponentProps<typeof NumberInputPrimitive>, 'className'> & {
  className?: string
}) {
  const [roll, setRoll] = useState<RollState>(STILL)
  // The value it showed last. A parent that owns the value may change it on its own, as a pager's Next does: that rolls too.
  const [shown, setShown] = useState<number | null>(
    props.value === undefined ? (props.defaultValue ?? null) : props.value,
  )
  if (props.value !== undefined && props.value !== shown) {
    setShown(props.value)
    setRoll(rollTo(props.value, shown))
  }

  // The input's text, which ui-sdk writes itself, read once it has: after
  // ui-sdk's own effects on every render, and after a keystroke or a blur
  // reaches the root. The copy that rolls shows it.
  const root = useRef<HTMLDivElement>(null)
  const refs = useMemo(() => mergeRefs(root, ref), [ref])
  // Null until the first read, so the copy starts with the text and nothing rolls in on load.
  const [text, setText] = useState<string | null>(null)
  const readText = () => {
    const input = root.current?.querySelector<HTMLInputElement>(
      '[data-slot=number-input-control]',
    )
    if (input && input.value !== text) setText(input.value)
  }
  useLayoutEffect(readText)

  return (
    <RollContext value={{ roll, text, settle: () => setRoll(STILL) }}>
      <NumberInputPrimitive
        ref={refs}
        className={cn('flex min-w-0 flex-col', className)}
        onValueChange={(value, details) => {
          onValueChange?.(value, details)
          if (details.canceled) return
          setShown(value)
          setRoll(rollOf(details.reason, value, shown))
        }}
        onInput={(event) => {
          onInput?.(event)
          readText()
        }}
        onBlur={(event) => {
          onBlur?.(event)
          readText()
        }}
        onKeyUp={(event) => {
          onKeyUp?.(event)
          readText()
        }}
        {...props}
      />
    </RollContext>
  )
}

function NumberInputGroup({
  className,
  ...props
}: Omit<ComponentProps<typeof NumberInputGroupPrimitive>, 'className'> & {
  className?: string
}) {
  return (
    <NumberInputGroupPrimitive
      className={cn(inputBoxClassName, 'w-full overflow-hidden', className)}
      {...props}
    />
  )
}

const stepperClassName =
  'flex size-(--control-height) shrink-0 items-center justify-center text-muted-foreground transition-[color,background-color] duration-(--motion-press-duration) ease-(--motion-press-fade-easing) select-none hover:bg-muted hover:text-foreground data-disabled:opacity-50 data-disabled:hover:bg-transparent'

function NumberInputDecrement({
  className,
  children,
  ...props
}: Omit<ComponentProps<typeof NumberInputDecrementPrimitive>, 'className'> & {
  className?: string
}) {
  return (
    <NumberInputDecrementPrimitive
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
    </NumberInputDecrementPrimitive>
  )
}

function NumberInputIncrement({
  className,
  children,
  ...props
}: Omit<ComponentProps<typeof NumberInputIncrementPrimitive>, 'className'> & {
  className?: string
}) {
  return (
    <NumberInputIncrementPrimitive
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
    </NumberInputIncrementPrimitive>
  )
}

type NumberInputControlProps = Omit<
  ComponentProps<typeof NumberInputControlPrimitive>,
  'className'
> & { className?: string }

/**
 * ui-sdk's number `<input>`, with a copy of its text drawn over it that
 * rolls while the value is stepped. `className` sets where the text sits and
 * its padding, on the input and the copy alike. For a field of your own
 * around it, such as the Money input.
 */
function RollingInput({
  decimal,
  className,
  ...props
}: NumberInputControlProps & {
  /** The locale's decimal point, so digits line up on it when a step adds decimals: 1,280 to 1,281.00 rolls one digit. */
  decimal?: string
}) {
  const { roll, text, settle } = use(RollContext)
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
      <NumberInputControlPrimitive
        className={cn(
          inputControlClassName,
          'tabular-nums',
          className,
          rolling && 'text-transparent caret-transparent',
        )}
        {...props}
      />
      <span
        aria-hidden
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
          {text === null ? null : (
            <Roll
              value={text}
              tail={rollTail(text, decimal)}
              trend={rolling ? roll.trend : 1}
            />
          )}
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

/** The number input's text box, centred, with the invalid mark at its end. `className` goes to the box around them. */
function NumberInputControl({ className, ...props }: NumberInputControlProps) {
  return (
    <span className={cn('flex min-w-0 flex-1 items-center', className)}>
      <RollingInput className='text-center' {...props} />
      <InputInvalidIcon />
    </span>
  )
}

/**
 * An area, such as the field's label, that changes the value when dragged
 * sideways, or up and down with `orientation`. While it drags, the pointer is
 * locked and hidden, so the area draws its own cursor where the pointer would be.
 */
function NumberInputScrubArea({
  className,
  children,
  orientation = 'horizontal',
  ...props
}: Omit<
  ComponentProps<typeof NumberInputScrubAreaPrimitive>,
  'className' | 'children'
> & {
  className?: string
  children?: ReactNode
}) {
  const vertical = orientation === 'vertical'
  return (
    <NumberInputScrubAreaPrimitive
      orientation={orientation}
      className={cn(
        'w-fit',
        vertical ? 'cursor-ns-resize' : 'cursor-ew-resize',
        className,
      )}
      {...props}
    >
      {children}
      <NumberInputScrubAreaCursorPrimitive
        // ui-sdk places it at the pointer from its corner, so the icon is centred on it. An outline in the background colour keeps it readable over any content.
        className='text-foreground z-50 -ms-2.5 -mt-2.5 drop-shadow-[0_0_1px_var(--background)] [&_svg]:size-5'
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
      </NumberInputScrubAreaCursorPrimitive>
    </NumberInputScrubAreaPrimitive>
  )
}

export {
  isStep,
  NumberInput,
  NumberInputControl,
  NumberInputDecrement,
  NumberInputGroup,
  NumberInputIncrement,
  NumberInputScrubArea,
  RollingInput,
  rollOf,
  rollTail,
}
