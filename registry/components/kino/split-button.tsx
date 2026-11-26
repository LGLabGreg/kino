'use client'

import { Button } from '@/registry/components/kino/button'
import { ButtonGroup } from '@/registry/components/kino/button-group'
import { DropdownMenuTrigger } from '@/registry/components/kino/dropdown-menu'
import { IconPlaceholder } from '@/registry/icons/icon-placeholder'
import type { Menu as MenuPrimitive } from '@base-ui/react/menu'
import { type ComponentProps, createContext, use, useEffect, useState } from 'react'

import { cn } from '@/lib/utils'

type SplitButtonVariant = 'default' | 'secondary' | 'outline' | 'destructive'
type SplitButtonSize = 'xs' | 'sm' | 'default' | 'lg'

/** The menu's button is square, the height of the action beside it. */
const triggerSize = {
  xs: 'icon-xs',
  sm: 'icon-sm',
  default: 'icon',
  lg: 'icon-lg',
} as const

const SplitButtonContext = createContext<{
  variant: SplitButtonVariant
  size: SplitButtonSize
  disabled: boolean
  loading: boolean
  /** The action tells the group it is loading, so the menu's button holds too. */
  setActionLoading: (loading: boolean) => void
}>({
  variant: 'default',
  size: 'default',
  disabled: false,
  loading: false,
  setActionLoading: () => {},
})

/**
 * A main action joined to a menu of the actions next to it. The variant and
 * size are set here once, for both halves. Other props go to the Button group.
 */
function SplitButton({
  variant = 'default',
  size = 'default',
  disabled = false,
  loading = false,
  ...props
}: Omit<ComponentProps<typeof ButtonGroup>, 'orientation'> & {
  variant?: SplitButtonVariant
  size?: SplitButtonSize
  /** Disables the action and the menu's button. */
  disabled?: boolean
  /**
   * The action is running: it shows the Button's spinner and blocks presses,
   * and the menu's button is disabled, neither of them dimmed.
   */
  loading?: boolean
}) {
  const [actionLoading, setActionLoading] = useState(false)
  return (
    <SplitButtonContext
      value={{
        variant,
        size,
        disabled,
        loading: loading || actionLoading,
        setActionLoading,
      }}
    >
      <ButtonGroup {...props} />
    </SplitButtonContext>
  )
}

/**
 * The main action. `loading` here, as a Copy button that waits for its value
 * sets it, holds the menu's button too, as the group's `loading` does.
 */
function SplitButtonAction({
  disabled,
  loading = false,
  ...props
}: Omit<ComponentProps<typeof Button>, 'variant' | 'size'>) {
  const context = use(SplitButtonContext)
  const { setActionLoading } = context
  useEffect(() => {
    setActionLoading(loading)
    return () => setActionLoading(false)
  }, [loading, setActionLoading])
  return (
    <Button
      data-split-button-action=''
      variant={context.variant}
      size={context.size}
      loading={loading || context.loading}
      disabled={disabled ?? context.disabled}
      {...props}
    />
  )
}

/**
 * The button that opens the menu, with a chevron unless you give it another
 * icon. Put it in a `DropdownMenu`, beside its `DropdownMenuContent`.
 */
function SplitButtonTrigger<Payload>({
  className,
  disabled,
  children,
  onClick,
  onKeyDown,
  ...props
}: Omit<MenuPrimitive.Trigger.Props<Payload>, 'className' | 'render' | 'aria-label'> & {
  className?: string
  /** What the menu holds, such as "Choose how to merge": the button shows only an icon. */
  'aria-label': string
}) {
  const context = use(SplitButtonContext)
  // While loading, the menu won't open but its button keeps focus: a pick from
  // the menu that starts the action hands focus back to it as the menu closes.
  const held = context.loading && !(disabled ?? context.disabled)
  return (
    <DropdownMenuTrigger
      data-split-button-trigger=''
      disabled={disabled ?? context.disabled}
      aria-disabled={held || undefined}
      onClick={(event) => {
        onClick?.(event)
        if (held) event.preventBaseUIHandler()
      }}
      onKeyDown={(event) => {
        onKeyDown?.(event)
        if (held) event.preventBaseUIHandler()
      }}
      render={
        <Button
          data-pending={context.loading ? '' : undefined}
          variant={context.variant}
          size={triggerSize[context.size]}
          className={cn('aria-disabled:pointer-events-none', className)}
        />
      }
      {...props}
    >
      {children ?? (
        <IconPlaceholder
          lucide='ChevronDownIcon'
          tabler='IconChevronDown'
          hugeicons='ArrowDown01Icon'
          phosphor='CaretDownIcon'
          remixicon='RiArrowDownSLine'
          aria-hidden
        />
      )}
    </DropdownMenuTrigger>
  )
}

export { SplitButton, SplitButtonAction, SplitButtonTrigger }
