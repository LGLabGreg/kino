'use client'

import {
  InputInvalidIcon,
  inputBoxClassName,
  inputControlClassName,
} from '@/registry/components/kino/input'
import { IconPlaceholder } from '@/registry/icons/icon-placeholder'
import { keptOnReset } from '@/registry/lib/field-control'
import {
  type NativeSelectOptions,
  nativeSelectControl,
} from '@/registry/lib/native-select-control'
import { useFieldControl } from '@ui-sdk/react/field'
import { usePart, usePrimitive } from '@ui-sdk/react/primitive'
import { type ComponentProps, useLayoutEffect } from 'react'

import { cn } from '@/lib/utils'

/*
 * The browser's own select in Kino's box, for long lists a phone should
 * pick from with its own wheel. Its options take the page's font. It is a
 * ui-sdk primitive (`registry/lib/native-select-control`), so an agent reads
 * its value and options and picks one, and it joins its Field as ui-sdk's
 * controls do: the Field's label names it and its name goes with the form.
 */
function NativeSelect({
  className,
  children,
  name,
  onValueChange,
  ...props
}: Omit<ComponentProps<'select'>, 'className'> & {
  className?: string
} & NativeSelectOptions) {
  const field = useFieldControl()
  const select = usePrimitive(nativeSelectControl, {
    onValueChange: (value, details) => {
      // A held select with no default keeps its value through a form's reset, as ui-sdk's controls do.
      if (details.reason === 'reset' && keptOnReset(props.value, props.defaultValue))
        details.cancel()
      else onValueChange?.(value, details)
    },
  })
  // A value set by a render, as a controlled select's is, is read after it.
  useLayoutEffect(() => select.api.read())
  const own = {
    ...props,
    // The primitive hears each pick, so a select held by `value` and `onValueChange` isn't read-only.
    onChange: props.onChange ?? (onValueChange ? heard : undefined),
    name: name ?? field?.name,
    disabled: props.disabled || field?.disabled || undefined,
    className: cn(
      inputControlClassName,
      // A select matches `:read-only`, which would grey its value.
      'appearance-none pe-9 read-only:text-foreground group-has-aria-invalid/input:pe-14 [&_option]:bg-[Canvas] [&_option]:font-[inherit] [&_option]:text-[CanvasText]',
    ),
    children,
  }
  return (
    <div data-slot='native-select' className={cn(inputBoxClassName, className)}>
      {usePart(select, 'root', {}, field ? field.props(own) : own, 'select')}
      <span className='pointer-events-none absolute end-(--control-padding) flex items-center gap-1.5'>
        <InputInvalidIcon className='pe-0' />
        <IconPlaceholder
          lucide='ChevronDownIcon'
          tabler='IconChevronDown'
          hugeicons='ArrowDown01Icon'
          phosphor='CaretDownIcon'
          remixicon='RiArrowDownSLine'
          aria-hidden
        />
      </span>
    </div>
  )
}

function heard() {}

function NativeSelectOption(props: ComponentProps<'option'>) {
  return <option data-slot='native-select-option' {...props} />
}

function NativeSelectOptGroup(props: ComponentProps<'optgroup'>) {
  return <optgroup data-slot='native-select-optgroup' {...props} />
}

export { NativeSelect, NativeSelectOptGroup, NativeSelectOption }
