'use client'

import { ButtonGroup } from '@/registry/components/kino/button-group'
import { Toggle, type ToggleSize } from '@/registry/components/kino/toggle'
import type { Toggle as TogglePrimitive } from '@base-ui/react/toggle'
import { ToggleGroup as ToggleGroupPrimitive } from '@base-ui/react/toggle-group'
import { createContext, use } from 'react'

import { cn } from '@/lib/utils'

const ToggleGroupSizeContext = createContext<ToggleSize>('default')

/**
 * A row or column of toggles joined as a Button group: one highlight glides
 * between them under the pointer, and the pressed ones are filled.
 */
function ToggleGroup<Value extends string>({
  size = 'default',
  orientation = 'horizontal',
  ...props
}: ToggleGroupPrimitive.Props<Value> & { size?: ToggleSize }) {
  return (
    <ToggleGroupSizeContext value={size}>
      <ToggleGroupPrimitive
        data-slot='toggle-group'
        orientation={orientation}
        render={(groupProps) => <ButtonGroup {...groupProps} orientation={orientation} />}
        {...props}
      />
    </ToggleGroupSizeContext>
  )
}

function ToggleGroupItem({
  className,
  size,
  ...props
}: TogglePrimitive.Props & {
  size?: ToggleSize
}) {
  const groupSize = use(ToggleGroupSizeContext)
  const itemSize = size ?? groupSize
  return (
    <Toggle
      data-slot='toggle-group-item'
      variant='outline'
      size={itemSize}
      className={(state) =>
        cn(
          // A segment's corner, as a Button's in a Button group, at every size.
          'rounded-(--control-radius)',
          // A column of labels reads down its start edge; an icon stays centred.
          !itemSize.startsWith('icon') && 'in-data-[orientation=vertical]:justify-start',
          typeof className === 'function' ? className(state) : className,
        )
      }
      {...props}
    />
  )
}

export { ToggleGroup, ToggleGroupItem }
