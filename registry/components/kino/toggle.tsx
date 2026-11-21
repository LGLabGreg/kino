'use client'

import { buttonVariants } from '@/registry/components/kino/button'
import { mergeRefs } from '@/registry/lib/refs'
import { SwapIcon } from '@/registry/lib/swap'
import { mergeProps } from '@base-ui/react/merge-props'
import { Toggle as TogglePrimitive } from '@base-ui/react/toggle'
import type { VariantProps } from 'class-variance-authority'
import {
  cloneElement,
  createContext,
  isValidElement,
  type ReactNode,
  type Ref,
  use,
} from 'react'

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

const PressedContext = createContext(false)

/** The element Base UI renders, inside a context that tells a `ToggleIcon` whether it's pressed. */
function renderWithPressed(
  render: TogglePrimitive.Props['render'],
): NonNullable<TogglePrimitive.Props['render']> {
  return (props, state) => (
    <PressedContext value={state.pressed}>
      {typeof render === 'function' ? (
        render(props, state)
      ) : isValidElement<Record<string, unknown>>(render) ? (
        cloneElement(render, {
          ...mergeProps<'button'>(props, render.props),
          // mergeProps keeps one ref; Base UI's and the element's both need it.
          ref: mergeRefs(
            props.ref,
            render.props.ref as Ref<HTMLButtonElement> | undefined,
          ),
        })
      ) : (
        // oxlint-disable-next-line react/button-has-type -- Base UI's props carry the type
        <button {...props} />
      )}
    </PressedContext>
  )
}

function Toggle({
  className,
  variant = 'default',
  size = 'default',
  render,
  ...props
}: TogglePrimitive.Props & {
  variant?: ToggleVariant
  size?: ToggleSize
}) {
  return (
    <TogglePrimitive
      data-slot='toggle'
      className={(state) =>
        cn(
          toggleVariants({ pressed: state.pressed, variant, size }),
          typeof className === 'function' ? className(state) : className,
        )
      }
      render={renderWithPressed(render)}
      {...props}
    />
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
}: {
  pressedIcon: ReactNode
  children: ReactNode
}) {
  return (
    <SwapIcon on={use(PressedContext)} onIcon={pressedIcon} slot='toggle-icon'>
      {children}
    </SwapIcon>
  )
}

export { Toggle, ToggleIcon, toggleVariants }
export type { ToggleSize, ToggleVariant }
