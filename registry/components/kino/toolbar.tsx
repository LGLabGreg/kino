'use client'

import { Button, buttonVariants } from '@/registry/components/kino/button'
import { ButtonGroup } from '@/registry/components/kino/button-group'
import { Input } from '@/registry/components/kino/input'
import { separatorVariants } from '@/registry/components/kino/separator'
import { ToggleVariantContext } from '@/registry/components/kino/toggle'
import { followFlow } from '@/registry/lib/flow'
import { mergeRefs } from '@/registry/lib/refs'
import {
  Toolbar as ToolbarPrimitive,
  ToolbarButton as ToolbarButtonPrimitive,
  ToolbarGroup as ToolbarGroupPrimitive,
  ToolbarInput as ToolbarInputPrimitive,
  ToolbarLink as ToolbarLinkPrimitive,
  ToolbarSeparator as ToolbarSeparatorPrimitive,
} from '@ui-sdk/react/toolbar'
import type { VariantProps } from 'class-variance-authority'
import {
  type ComponentProps,
  createContext,
  use,
  useEffect,
  useMemo,
  useRef,
} from 'react'

import { cn } from '@/lib/utils'

/*
 * A row of Kino's own controls that Tab reaches once and the arrow keys move
 * through. Every item is the control it names, drawn and moving as it does
 * anywhere else: a Button, a Toggle, a Button group, a Toggle group, an Input.
 * A Toggle and a Toggle group join the toolbar on their own.
 */

type Orientation = 'horizontal' | 'vertical'

const OrientationContext = createContext<Orientation>('horizontal')

// A Tooltip's hidden copy of its label, and what an open popup's trigger owns, aren't items.
const FLOW_ITEMS = ':not([aria-owns],[hidden])'

function Toolbar({
  ref,
  className,
  orientation = 'horizontal',
  ...props
}: Omit<ComponentProps<typeof ToolbarPrimitive>, 'className' | 'orientation'> & {
  className?: string
  orientation?: Orientation
}) {
  const rowRef = useRef<HTMLDivElement>(null)
  const rowRefs = useMemo(() => mergeRefs(rowRef, ref), [ref])
  // An item that changes width (a label, a spinner) moves the ones after it,
  // and once the row wraps, onto another line: they glide there.
  useEffect(() => {
    if (!rowRef.current) return
    return followFlow(rowRef.current, FLOW_ITEMS)
  }, [])
  return (
    <OrientationContext value={orientation}>
      {/* A toggle in the row is outline, as its buttons are. */}
      <ToggleVariantContext value='outline'>
        <ToolbarPrimitive
          ref={rowRefs}
          orientation={orientation}
          className={cn(
            // A row that runs out of room wraps, so no control is ever out of reach.
            'relative isolate flex flex-wrap items-center gap-2 data-[orientation=vertical]:flex-col',
            // Each item glides on `layout` (`followFlow`) and keeps its own
            // press, in one shorthand; one removed fades where it was on `exit`.
            '[&>*]:[transition:translate_var(--motion-layout-duration)_var(--motion-layout-easing),scale_var(--motion-press-duration)_var(--motion-press-easing),color_var(--motion-press-duration)_var(--motion-press-fade-easing),background-color_var(--motion-press-duration)_var(--motion-press-fade-easing),border-color_var(--motion-press-duration)_var(--motion-press-fade-easing),box-shadow_var(--motion-press-duration)_var(--motion-press-fade-easing)] [&>[data-flow=start]]:[transition:scale_var(--motion-press-duration)_var(--motion-press-easing),color_var(--motion-press-duration)_var(--motion-press-fade-easing),background-color_var(--motion-press-duration)_var(--motion-press-fade-easing),border-color_var(--motion-press-duration)_var(--motion-press-fade-easing),box-shadow_var(--motion-press-duration)_var(--motion-press-fade-easing)] motion-reduce:[&>*]:[transition:color_var(--motion-press-duration)_var(--motion-press-fade-easing),background-color_var(--motion-press-duration)_var(--motion-press-fade-easing),border-color_var(--motion-press-duration)_var(--motion-press-fade-easing),box-shadow_var(--motion-press-duration)_var(--motion-press-fade-easing)]',
            '[&>[data-leaving]]:opacity-0 [&>[data-leaving]]:[transition:opacity_var(--motion-exit-duration)_var(--motion-exit-easing),translate_var(--motion-layout-duration)_var(--motion-layout-easing)]',
            className,
          )}
          {...props}
        />
      </ToggleVariantContext>
    </OrientationContext>
  )
}

function ToolbarButton({
  className,
  variant = 'outline',
  size = 'default',
  loading,
  disabled,
  ...props
}: Omit<ComponentProps<typeof ToolbarButtonPrimitive>, 'className' | 'render'> & {
  className?: string
} & VariantProps<typeof buttonVariants> & {
    /** As a Button's: blocks presses at once, and shows the spinner once it lasts 200ms. */
    loading?: boolean
  }) {
  return (
    <ToolbarButtonPrimitive
      // Loading blocks presses as disabled does, and the toolbar's button says so.
      disabled={disabled || loading}
      render={
        <Button variant={variant} size={size} loading={loading} className={className} />
      }
      {...props}
    />
  )
}

/**
 * Joins its items as a Button group, slot included, so a Button inside sits
 * exactly as it does in one. It runs the way the toolbar does.
 */
function ToolbarGroup(props: ComponentProps<typeof ToolbarGroupPrimitive>) {
  const orientation = use(OrientationContext)
  return (
    <ToolbarGroupPrimitive
      render={(groupProps) => <ButtonGroup {...groupProps} orientation={orientation} />}
      {...props}
    />
  )
}

/** The Separator's line, across the toolbar's whole height (or width, when it runs down). */
function ToolbarSeparator({
  className,
  ...props
}: Omit<ComponentProps<typeof ToolbarSeparatorPrimitive>, 'className'> & {
  className?: string
}) {
  return (
    <ToolbarSeparatorPrimitive
      // The toolbar decides the line's orientation: across a row, it runs down.
      className={(state) =>
        cn(
          separatorVariants({ orientation: state.orientation }),
          'self-stretch',
          className,
        )
      }
      {...props}
    />
  )
}

/** A link drawn as a Button. */
function ToolbarLink({
  className,
  variant = 'outline',
  size = 'default',
  ...props
}: Omit<ComponentProps<typeof ToolbarLinkPrimitive>, 'className'> & {
  className?: string
} & VariantProps<typeof buttonVariants>) {
  return (
    <ToolbarLinkPrimitive
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  )
}

/**
 * An Input whose text the arrow keys move through, leaving for the next item
 * once the caret is at that end. `className` goes to the box.
 */
function ToolbarInput({
  focusableWhenDisabled,
  ...props
}: Omit<ComponentProps<typeof Input>, 'render'> &
  Pick<ComponentProps<typeof ToolbarInputPrimitive>, 'focusableWhenDisabled'>) {
  return (
    <Input
      render={(inputProps) => (
        <ToolbarInputPrimitive
          {...inputProps}
          focusableWhenDisabled={focusableWhenDisabled}
        />
      )}
      {...props}
    />
  )
}

export {
  Toolbar,
  ToolbarButton,
  ToolbarGroup,
  ToolbarInput,
  ToolbarLink,
  ToolbarSeparator,
}
