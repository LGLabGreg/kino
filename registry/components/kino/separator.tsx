'use client'

import { Separator as SeparatorPrimitive } from '@ui-sdk/react/separator'
import { cva } from 'class-variance-authority'
import type { ComponentProps } from 'react'

import { cn } from '@/lib/utils'

/*
 * A 1px line in the border colour, between groups of content. The menus,
 * the Select, the Toolbar and the code field draw their own separator
 * parts with these classes, so every line in Kino is the same.
 */
const separatorVariants = cva('bg-border forced-colors:bg-[CanvasText] shrink-0', {
  variants: {
    orientation: {
      horizontal: 'h-px w-full',
      // Fills the row's height; give it a height to draw a shorter line.
      vertical: 'w-px self-stretch',
    },
  },
  defaultVariants: {
    orientation: 'horizontal',
  },
})

function Separator({
  className,
  orientation = 'horizontal',
  ...props
}: Omit<ComponentProps<typeof SeparatorPrimitive>, 'className'> & {
  className?: string
}) {
  return (
    <SeparatorPrimitive
      orientation={orientation}
      className={cn(separatorVariants({ orientation }), className)}
      {...props}
    />
  )
}

export { Separator, separatorVariants }
