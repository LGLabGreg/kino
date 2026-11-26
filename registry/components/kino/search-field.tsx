'use client'

import type { InputControl } from '@/registry/components/kino/input'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  inputGroupPresence,
} from '@/registry/components/kino/input-group'
import { KbdGroup } from '@/registry/components/kino/kbd'
import { Spinner, useSpinner } from '@/registry/components/kino/spinner'
import { IconPlaceholder } from '@/registry/icons/icon-placeholder'
import { useAriaKeyshortcuts, useShortcut } from '@/registry/lib/keys'
import { numberFormatter } from '@/registry/lib/number-format'
import { markMounted, mergeRefs } from '@/registry/lib/refs'
import { Roll } from '@/registry/lib/roll'
import { Swap, swapIconClassName } from '@/registry/lib/swap'
import { createInputController } from '@ui-sdk/react/input'
import { cva, type VariantProps } from 'class-variance-authority'
import {
  type ComponentProps,
  type MouseEvent,
  type PointerEvent,
  useMemo,
  useState,
} from 'react'

import { cn } from '@/lib/utils'

/*
 * A text field for searching. Its icon turns into the spinner while results
 * come, the end of the field trades the shortcut's keys for the clear button
 * once there is text, and Escape clears it before it closes anything around
 * it. Nothing else moves, unless the field is told to widen.
 */

const searchFieldVariants = cva('', {
  variants: {
    variant: {
      default: '',
      // Short at rest, so it sits in a toolbar; it widens into the room it is
      // given while it is in use, and what sits beside it moves with it. The
      // width moves on `layout`, the box's colours on `press`, scoped to the
      // slot so it wins over the box's own transition; with less motion the
      // width changes at once.
      widen:
        'w-(--search-field-width,15rem) max-w-full data-wide:w-full motion-safe:data-search-field:[transition:width_var(--motion-layout-duration)_var(--motion-layout-easing),color_var(--motion-press-duration)_var(--motion-press-fade-easing),background-color_var(--motion-press-duration)_var(--motion-press-fade-easing),border-color_var(--motion-press-duration)_var(--motion-press-fade-easing),box-shadow_var(--motion-press-duration)_var(--motion-press-fade-easing)]',
    },
  },
  defaultVariants: {
    variant: 'default',
  },
})

type SearchFieldProps = Omit<ComponentProps<typeof InputControl>, 'type'> &
  VariantProps<typeof searchFieldVariants> & {
    /** Results are on their way: the icon turns into a spinner once it lasts 200ms. */
    loading?: boolean
    /**
     * Keys that focus the field from anywhere on the page, shown at its end
     * until the person types, and not on a touch screen, as ui-sdk writes them:
     * `'mod+k'` or `'/'`.
     */
    shortcut?: string
    /** Called once the clear button or Escape has emptied the field. */
    onClear?: () => void
    /** How many results the search found, shown while there is text and read out. */
    count?: number
    /** What the count says, shown and read out: “24 results” by default. */
    countLabel?: (count: number) => string
  }

/** The event a handler of ui-sdk's Input gets. */
type InputEvent<Handler extends 'onFocus' | 'onBlur' | 'onKeyDown'> = Parameters<
  NonNullable<SearchFieldProps[Handler]>
>[0]

function SearchField({
  className,
  variant,
  loading = false,
  shortcut,
  onClear,
  count,
  countLabel = resultsLabel,
  value,
  defaultValue,
  onValueChange,
  onKeyDown,
  onFocus,
  onBlur,
  disabled,
  readOnly,
  controller: controllerProp,
  ref,
  ...props
}: SearchFieldProps) {
  const [ownController] = useState(createInputController)
  const controller = controllerProp ?? ownController
  const [input, setInput] = useState<HTMLInputElement | null>(null)
  // One callback for the field's life, so React doesn't hand it the element again each render.
  const ariaKeys = useAriaKeyshortcuts(disabled ? null : shortcut)
  const inputRef = useMemo(
    () => mergeRefs<HTMLInputElement>(setInput, ariaKeys, ref),
    [ariaKeys, ref],
  )
  const [typed, setTyped] = useState(() => String(defaultValue ?? '') !== '')
  const filled = value === undefined ? typed : String(value) !== ''
  const [focused, setFocused] = useState(false)
  const spinning = useSpinner(loading)
  const editable = !disabled && !readOnly
  const hinting = shortcut !== undefined && !filled && !focused && !disabled
  const counting = filled && count !== undefined

  // The last count stays while it fades out, and rolls up when it grew and down when it fell.
  const label = count === undefined ? '' : countLabel(count)
  const [counted, setCounted] = useState({ label, count, trend: 1 })
  if (count !== undefined && label !== counted.label) {
    setCounted({ label, count, trend: count - (counted.count ?? count) })
  }
  const number = countNumber(counted.label)

  useShortcut(
    disabled || !input ? undefined : shortcut,
    () => {
      input?.focus()
      input?.select()
    },
    input,
  )

  return (
    <InputGroup
      data-search-field=''
      data-wide={variant === 'widen' && (focused || filled) ? '' : undefined}
      className={cn(searchFieldVariants({ variant }), className)}
    >
      <InputGroupAddon>
        <Swap roll className={swapIconClassName}>
          {spinning ? (
            <Spinner />
          ) : (
            <IconPlaceholder
              lucide='SearchIcon'
              tabler='IconSearch'
              hugeicons='Search01Icon'
              phosphor='MagnifyingGlassIcon'
              remixicon='RiSearchLine'
              aria-hidden
            />
          )}
        </Swap>
      </InputGroupAddon>
      <InputGroupInput
        {...props}
        ref={inputRef}
        type='search'
        enterKeyHint='search'
        autoComplete='off'
        spellCheck={false}
        value={value}
        defaultValue={defaultValue}
        controller={controller}
        disabled={disabled}
        readOnly={readOnly}
        onValueChange={(next, details) => {
          setTyped(next !== '')
          onValueChange?.(next, details)
          if (next === '' && details.reason === 'clear-press') onClear?.()
        }}
        onFocus={(event: InputEvent<'onFocus'>) => {
          setFocused(true)
          onFocus?.(event)
        }}
        onBlur={(event: InputEvent<'onBlur'>) => {
          setFocused(false)
          onBlur?.(event)
        }}
        onKeyDown={(event: InputEvent<'onKeyDown'>) => {
          onKeyDown?.(event)
          // With text, Escape empties the field and stops there, so the dialog
          // or popover around it stays open; with none it closes them as usual.
          // The browser's own clear on Escape is held back, since it lets the
          // key carry on and one press would do both.
          // The input's own value, since a form's reset empties it without a word.
          if (
            event.key !== 'Escape' ||
            event.defaultPrevented ||
            event.currentTarget.value === '' ||
            !editable
          )
            return
          event.preventDefault()
          event.stopPropagation()
          controller.clear({ reason: 'clear-press', event: event.nativeEvent })
        }}
      />
      <InputGroupAddon align='inline-end' className='gap-1.5'>
        <span
          ref={markMounted}
          data-slot='search-field-count'
          data-shown={counting ? '' : undefined}
          aria-hidden
          className={cn(
            inputGroupPresence,
            // It leaves the row while hidden, so it fades in from
            // @starting-style; one there on page load is simply there.
            'text-xs whitespace-pre tabular-nums not-data-shown:hidden data-mounted:starting:opacity-0 motion-safe:data-mounted:starting:scale-75',
          )}
        >
          {/* Only the number rolls, so the words around it read in their own direction. */}
          {number ? (
            <>
              {counted.label.slice(0, number.start)}
              <Roll value={number.text} trend={counted.trend} />
              {counted.label.slice(number.end)}
            </>
          ) : (
            counted.label
          )}
        </span>
        {/* There before the first count, so every count is heard. */}
        <span className='sr-only' role='status'>
          {counting ? label : ''}
        </span>
        <span className='grid justify-items-end *:col-start-1 *:row-start-1'>
          {shortcut ? (
            // The field says the shortcut as `aria-keyshortcuts`. A touch screen
            // has no keys to press, so its room goes to the text there.
            <KbdGroup
              ref={markMounted}
              data-slot='search-field-shortcut'
              data-shown={hinting ? '' : undefined}
              aria-hidden
              // It leaves the row once hidden, so its room goes to the text.
              className={cn(
                inputGroupPresence,
                'me-1 text-xs not-data-shown:hidden pointer-coarse:hidden data-mounted:starting:opacity-0 motion-safe:data-mounted:starting:scale-75',
              )}
              keys={shortcut}
            />
          ) : null}
          {/* The wrapper shows and hides it, so the button keeps its own hover and press, and its room. */}
          <span
            data-slot='search-field-clear'
            data-shown={filled && editable ? '' : undefined}
            className={cn(inputGroupPresence, 'flex')}
          >
            {/* Out of the tab order, as the browser's own is, since Escape clears; a screen reader still reaches it. */}
            <InputGroupButton
              size='icon-xs'
              aria-label='Clear search'
              tabIndex={-1}
              // Pressing it leaves focus in the field, so a phone's keyboard stays up.
              onPointerDown={(event: PointerEvent) => event.preventDefault()}
              // ui-sdk's clear, so the change reaches `onValueChange` as a `clear-press`.
              onClick={(event: MouseEvent) =>
                controller.clear({
                  reason: 'clear-press',
                  event: event.nativeEvent,
                })
              }
              className='text-muted-foreground'
            >
              <IconPlaceholder
                lucide='XIcon'
                tabler='IconX'
                hugeicons='Cancel01Icon'
                phosphor='XIcon'
                remixicon='RiCloseLine'
                aria-hidden
              />
            </InputGroupButton>
          </span>
        </span>
      </InputGroupAddon>
    </InputGroup>
  )
}

const plural = new Intl.PluralRules('en-US')

/** “1 result”, “1,024 results”, or the same with another `noun`, given as its one and its many. */
function resultsLabel(
  count: number,
  noun: readonly [one: string, many: string] = ['result', 'results'],
) {
  return `${numberFormatter('en-US').format(count)} ${plural.select(count) === 'one' ? noun[0] : noun[1]}`
}

/**
 * Where the number sits in a count's words, in any script's digits and with
 * its group separators, or null when it has none: in “1,024 results” it is
 * `1,024`, from 0 to 5.
 */
function countNumber(label: string): { text: string; start: number; end: number } | null {
  const match = /\p{Nd}(?:[\p{Nd},.\u00A0\u202F]*\p{Nd})?/u.exec(label)
  if (!match) return null
  return {
    text: match[0],
    start: match.index,
    end: match.index + match[0].length,
  }
}

export { SearchField, searchFieldVariants }
export { countNumber, resultsLabel }
