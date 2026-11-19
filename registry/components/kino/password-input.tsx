'use client'

import type { InputControl } from '@/registry/components/kino/input'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@/registry/components/kino/input-group'
import { IconPlaceholder } from '@/registry/icons/icon-placeholder'
import { mergeRefs } from '@/registry/lib/refs'
import { Toggle as TogglePrimitive } from '@base-ui/react/toggle'
import {
  type ComponentProps,
  type MouseEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { flushSync } from 'react-dom'

type Selection = [number | null, number | null, 'forward' | 'backward' | 'none' | null]

/**
 * Whether the password shows, and what keeps it safe while it changes: the
 * caret stays where it was, and the password hides again when its form is
 * submitted or reset, or the page comes back from the history cache, so the
 * browser never saves it as text.
 */
function usePasswordVisibility({
  visible,
  defaultVisible,
  onVisibleChange,
}: {
  visible: boolean | undefined
  defaultVisible: boolean
  onVisibleChange: ((visible: boolean) => void) | undefined
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [ownVisible, setOwnVisible] = useState(defaultVisible)
  const shown = visible ?? ownVisible
  const selection = useRef<Selection | null>(null)
  // The box's own id and disabled state, which a Field or a Fieldset may set.
  const [control, setControl] = useState({ id: '', disabled: false })
  useLayoutEffect(() => {
    const input = inputRef.current
    if (!input) return
    const read = () => setControl({ id: input.id, disabled: input.disabled })
    read()
    const observer = new MutationObserver(read)
    observer.observe(input, { attributes: true, attributeFilter: ['id', 'disabled'] })
    return () => observer.disconnect()
  }, [])

  const change = (next: boolean) => {
    setOwnVisible(next)
    if (next !== shown) onVisibleChange?.(next)
  }
  const changeRef = useRef(change)
  useEffect(() => {
    changeRef.current = change
  })

  useEffect(() => {
    const input = inputRef.current
    if (!input) return
    // At once, before the form reads its fields.
    const hide = () => flushSync(() => changeRef.current(false))
    const fromHistory = (event: PageTransitionEvent) => {
      if (event.persisted) hide()
    }
    const form = input.form
    form?.addEventListener('submit', hide)
    form?.addEventListener('reset', hide)
    window.addEventListener('pageshow', fromHistory)
    return () => {
      form?.removeEventListener('submit', hide)
      form?.removeEventListener('reset', hide)
      window.removeEventListener('pageshow', fromHistory)
    }
  }, [])

  // A new type can drop the caret, so it goes back where it was.
  useLayoutEffect(() => {
    const input = inputRef.current
    const kept = selection.current
    selection.current = null
    if (!input || !kept || document.activeElement !== input) return
    input.setSelectionRange(kept[0], kept[1], kept[2] ?? undefined)
  }, [shown])

  const toggle = () => {
    const input = inputRef.current
    if (input && document.activeElement === input) {
      selection.current = [
        input.selectionStart,
        input.selectionEnd,
        input.selectionDirection,
      ]
    }
    change(!shown)
  }

  // A press with the pointer leaves focus, and the caret, in the password.
  const keepFocus = (event: MouseEvent) => {
    if (document.activeElement === inputRef.current) event.preventDefault()
  }

  return { shown, inputRef, control, toggle, keepFocus }
}

/*
 * A password box with a button that shows or hides what was typed. The button
 * keeps one name and says whether it is pressed, and its eye rolls to the
 * crossed eye as a Button's icon does.
 */
function PasswordInput({
  className,
  visible,
  defaultVisible = false,
  onVisibleChange,
  toggleLabel = 'Show password',
  autoComplete = 'current-password',
  disabled,
  ref,
  ...props
}: Omit<ComponentProps<typeof InputControl>, 'type'> & {
  /** Whether the password shows as text. */
  visible?: boolean
  defaultVisible?: boolean
  onVisibleChange?: (visible: boolean) => void
  /** The button's name; give each password field on a page its own, such as "Show new password". */
  toggleLabel?: string
}) {
  const { shown, inputRef, control, toggle, keepFocus } = usePasswordVisibility({
    visible,
    defaultVisible,
    onVisibleChange,
  })

  return (
    <InputGroup
      data-slot='password-input'
      data-visible={shown ? '' : undefined}
      className={className}
    >
      <InputGroupInput
        ref={mergeRefs(ref, inputRef)}
        type={shown ? 'text' : 'password'}
        autoComplete={autoComplete}
        spellCheck={false}
        autoCapitalize='none'
        autoCorrect='off'
        disabled={disabled}
        // Edge draws an eye of its own in a password box.
        className='[&::-ms-reveal]:hidden'
        {...props}
      />
      <InputGroupAddon align='inline-end'>
        <TogglePrimitive
          pressed={shown}
          onPressedChange={toggle}
          aria-label={toggleLabel}
          aria-controls={control.id || undefined}
          disabled={disabled || control.disabled}
          onMouseDown={keepFocus}
          render={<InputGroupButton size='icon-xs' />}
        >
          {shown ? (
            <IconPlaceholder
              lucide='EyeOffIcon'
              tabler='IconEyeOff'
              hugeicons='ViewOffSlashIcon'
              phosphor='EyeSlashIcon'
              remixicon='RiEyeOffLine'
              aria-hidden
            />
          ) : (
            <IconPlaceholder
              lucide='EyeIcon'
              tabler='IconEye'
              hugeicons='ViewIcon'
              phosphor='EyeIcon'
              remixicon='RiEyeLine'
              aria-hidden
            />
          )}
        </TogglePrimitive>
      </InputGroupAddon>
    </InputGroup>
  )
}

export { PasswordInput }
