'use client'

import { buttonVariants } from '@/registry/components/kino/button'
import {
  focusControl,
  InputInvalidIcon,
  inputBoxClassName,
  inputControlClassName,
} from '@/registry/components/kino/input'
import { IconPlaceholder } from '@/registry/icons/icon-placeholder'
import { SwapIcon } from '@/registry/lib/swap'
import {
  PasswordInputControl as PasswordInputControlPrimitive,
  PasswordInput as PasswordInputPrimitive,
  PasswordInputToggle as PasswordInputTogglePrimitive,
} from '@ui-sdk/react/password-input'
import type { ComponentProps, ReactNode } from 'react'

import { cn } from '@/lib/utils'

/*
 * A password box with a button that shows or hides what was typed. ui-sdk
 * keeps the caret where it was, and hides the password again when its form
 * is sent or reset, or the page is left, so the browser never keeps it as
 * text. The button keeps one name and says whether it is pressed, and its eye
 * rolls to the crossed eye.
 */
function PasswordInput({
  className,
  autoComplete = 'current-password',
  toggleLabel = 'Show password',
  children,
  ...props
}: Omit<ComponentProps<typeof PasswordInputPrimitive>, 'className' | 'children'> & {
  className?: string
  /** The default toggle's name; give each password field on a page its own, such as "Show new password". */
  toggleLabel?: string
  /** The box and the button, when you lay them out yourself; a `PasswordInputControl` and a `PasswordInputToggle` by default. */
  children?: ReactNode
}) {
  return (
    <PasswordInputPrimitive
      autoComplete={autoComplete}
      onPointerDown={focusControl}
      className={cn(inputBoxClassName, 'cursor-text', className)}
      {...props}
    >
      {children ?? (
        <>
          <PasswordInputControl />
          <PasswordInputToggle aria-label={toggleLabel} />
        </>
      )}
      <InputInvalidIcon />
    </PasswordInputPrimitive>
  )
}

function PasswordInputControl({
  className,
  ...props
}: Omit<ComponentProps<typeof PasswordInputControlPrimitive>, 'className'> & {
  className?: string
}) {
  return (
    <PasswordInputControlPrimitive
      // Edge draws an eye of its own in a password box.
      className={cn(inputControlClassName, '[&::-ms-reveal]:hidden', className)}
      {...props}
    />
  )
}

/** The button at the box's end that shows or hides the password. Name it with `aria-label`, such as "Show password". */
function PasswordInputToggle({
  className,
  ...props
}: Omit<ComponentProps<typeof PasswordInputTogglePrimitive>, 'className' | 'children'> & {
  className?: string
}) {
  return (
    <PasswordInputTogglePrimitive
      data-variant='ghost'
      className={cn(
        buttonVariants({ variant: 'ghost', size: 'icon-xs' }),
        // Muted, as the box's other icons and the Search field's clear are.
        'text-muted-foreground order-last me-1.5',
        className,
      )}
      {...props}
    >
      {({ visible }) => (
        <SwapIcon
          on={visible}
          onIcon={
            <IconPlaceholder
              lucide='EyeOffIcon'
              tabler='IconEyeOff'
              hugeicons='ViewOffSlashIcon'
              phosphor='EyeSlashIcon'
              remixicon='RiEyeOffLine'
              aria-hidden
            />
          }
        >
          <IconPlaceholder
            lucide='EyeIcon'
            tabler='IconEye'
            hugeicons='ViewIcon'
            phosphor='EyeIcon'
            remixicon='RiEyeLine'
            aria-hidden
          />
        </SwapIcon>
      )}
    </PasswordInputTogglePrimitive>
  )
}

export { PasswordInput, PasswordInputControl, PasswordInputToggle }
