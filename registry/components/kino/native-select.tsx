'use client'

import {
  InputInvalidIcon,
  inputBoxClassName,
  inputControlClassName,
} from '@/registry/components/kino/input'
import { IconPlaceholder } from '@/registry/icons/icon-placeholder'
import { Field as FieldPrimitive } from '@base-ui/react/field'
import type { ComponentProps } from 'react'

import { cn } from '@/lib/utils'

/*
 * The browser's own select in Kino's box, for long lists a phone should
 * pick from with its own wheel. Its options take the page's font.
 */
function NativeSelect({ className, children, ...props }: ComponentProps<'select'>) {
  return (
    <div data-slot='native-select' className={cn(inputBoxClassName, className)}>
      <FieldPrimitive.Control
        data-slot='native-select-control'
        // oxlint-disable-next-line jsx-a11y/control-has-associated-label -- a Field's label or the caller's `aria-label` names it.
        render={<select />}
        className={cn(
          inputControlClassName,
          // A select matches `:read-only`, which would grey its value.
          'cursor-pointer appearance-none pe-9 read-only:text-foreground group-has-aria-invalid/input:pe-14 [&_option]:bg-[Canvas] [&_option]:font-[inherit] [&_option]:text-[CanvasText]',
        )}
        // Field.Control's types are an input's; it renders the select above.
        {...(props as object)}
      >
        {children}
      </FieldPrimitive.Control>
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

function NativeSelectOption(props: ComponentProps<'option'>) {
  return <option data-slot='native-select-option' {...props} />
}

function NativeSelectOptGroup(props: ComponentProps<'optgroup'>) {
  return <optgroup data-slot='native-select-optgroup' {...props} />
}

export { NativeSelect, NativeSelectOptGroup, NativeSelectOption }
