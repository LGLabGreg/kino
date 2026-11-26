'use client'

import { buttonVariants } from '@/registry/components/kino/button'
import { ButtonGroup } from '@/registry/components/kino/button-group'
import { SwapIcon } from '@/registry/lib/swap'
import {
  Toggle as TogglePrimitive,
  ToggleGroup as ToggleGroupPrimitive,
  ToggleIcon as ToggleIconPrimitive,
  type ToggleState,
} from '@ui-sdk/react/toggle'
import type { VariantProps } from 'class-variance-authority'
import { type ComponentProps, createContext, type ReactNode, use } from 'react'

import { cn } from '@/lib/utils'

type ToggleSize = NonNullable<VariantProps<typeof buttonVariants>['size']>
type ToggleVariant = 'default' | 'outline'

// Off and on are both a Button's variants, of one size, so a toggle that turns
// on never changes size. The sizes are the Button's: an icon size is square and
// presses as deep as an icon Button, and a short label is never narrower than that.
const toggleMinWidth: Record<ToggleSize, string> = {
  xs: 'min-w-(--control-height-xs)',
  sm: 'min-w-(--control-height-sm)',
  default: 'min-w-(--control-height)',
  lg: 'min-w-(--control-height-lg)',
  'icon-xs': '',
  'icon-sm': '',
  icon: '',
  'icon-lg': '',
}

/** A toggle's classes, pressed or not, for an element that isn't a `Toggle`. */
function toggleVariants({
  pressed = false,
  variant = 'default',
  size = 'default',
}: {
  pressed?: boolean
  variant?: ToggleVariant | null
  size?: ToggleSize | null
} = {}) {
  return cn(
    buttonVariants({
      variant: pressed ? 'default' : variant === 'outline' ? 'outline' : 'ghost',
      size: size ?? 'default',
    }),
    toggleMinWidth[size ?? 'default'],
    // Forced colours drop the fill, so a pressed toggle takes the system's own, hovered or not.
    pressed
      ? 'forced-colors:bg-[Highlight]! forced-colors:text-[HighlightText]! forced-colors:forced-color-adjust-none forced-colors:focus-visible:outline-[CanvasText]'
      : 'text-muted-foreground hover:text-foreground',
  )
}

/** Whether the toggle around it is pressed, for its icon. */
const PressedContext = createContext(false)

/** The size a group gives the toggles in it, or null outside one. */
const ToggleGroupSizeContext = createContext<ToggleSize | null>(null)

/** The variant a toggle takes unless given one: outline in a group or a Toolbar, beside their outline buttons. */
const ToggleVariantContext = createContext<ToggleVariant>('default')

type TogglePrimitiveProps = ComponentProps<typeof TogglePrimitive>

function Toggle({
  className,
  variant,
  size,
  children,
  ...props
}: Omit<TogglePrimitiveProps, 'children'> & {
  /** Outline in a group or a Toolbar, beside the controls around it. */
  variant?: ToggleVariant
  /** The group's size in a group. */
  size?: ToggleSize
  children?: ReactNode
}) {
  const groupSize = use(ToggleGroupSizeContext)
  const inGroup = groupSize !== null
  const ownSize = size ?? groupSize ?? 'default'
  const ownVariant = variant ?? use(ToggleVariantContext)
  return (
    <TogglePrimitive
      // ui-sdk takes `className` as a function of state too, so this one keeps that type.
      className={(state: ToggleState) =>
        cn(
          toggleVariants({ pressed: state.pressed, variant: ownVariant, size: ownSize }),
          // A column of labels reads down its start edge; an icon stays centred.
          inGroup &&
            !ownSize.startsWith('icon') &&
            'in-data-[orientation=vertical]:justify-start',
          typeof className === 'function' ? className(state) : className,
        )
      }
      {...props}
    >
      {(state: ToggleState) => (
        <PressedContext value={state.pressed}>{children}</PressedContext>
      )}
    </TogglePrimitive>
  )
}

/**
 * The toggle's icon: `children` at rest and `pressedIcon` while pressed. The
 * one leaving rolls up and the one arriving rises from below, as a Button's
 * icon does, so the toggle shows what it turned into.
 */
function ToggleIcon({
  pressedIcon,
  children,
  ...props
}: Omit<ComponentProps<typeof ToggleIconPrimitive>, 'children' | 'className'> & {
  pressedIcon: ReactNode
  children: ReactNode
}) {
  return (
    // ui-sdk's part hides the icon from screen readers; the roll draws it.
    <ToggleIconPrimitive className='contents' {...props}>
      <SwapIcon on={use(PressedContext)} onIcon={pressedIcon}>
        {children}
      </SwapIcon>
    </ToggleIconPrimitive>
  )
}

/**
 * Toggles joined as a Button group, pressed one at a time or several at once:
 * one highlight glides between them under the pointer, and the pressed ones
 * are filled. `size` sets every toggle's.
 */
function ToggleGroup<Value extends string>({
  size = 'default',
  orientation = 'horizontal',
  ...props
}: ComponentProps<typeof ToggleGroupPrimitive<Value>> & { size?: ToggleSize }) {
  return (
    <ToggleGroupSizeContext value={size}>
      <ToggleVariantContext value='outline'>
        <ToggleGroupPrimitive<Value>
          orientation={orientation}
          render={(groupProps) => (
            <ButtonGroup {...groupProps} orientation={orientation} />
          )}
          {...props}
        />
      </ToggleVariantContext>
    </ToggleGroupSizeContext>
  )
}

export { Toggle, ToggleGroup, ToggleIcon, ToggleVariantContext, toggleVariants }
export type { ToggleSize, ToggleVariant }
