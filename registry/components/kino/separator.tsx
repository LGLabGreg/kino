'use client'

import { Separator as SeparatorPrimitive } from '@base-ui/react/separator'
import { cva } from 'class-variance-authority'

import { cn } from '@/lib/utils'

/*
 * A 1px line in the border colour, between groups of content. The menus,
 * the Select, the Toolbar and the code field draw their own Base UI
 * separator parts with these classes, so every line in Kino is the same.
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
}: Omit<SeparatorPrimitive.Props, 'className'> & { className?: string }) {
  return (
    <SeparatorPrimitive
      data-slot='separator'
      orientation={orientation}
      className={cn(separatorVariants({ orientation }), className)}
      {...props}
    />
  )
}

export { Separator, separatorVariants }
