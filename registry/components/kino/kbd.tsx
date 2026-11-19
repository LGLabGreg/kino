'use client'

import { type KbdKeyProps, useKbdKey, useOrderedKeys } from '@/registry/lib/keys'
import type { ComponentProps } from 'react'

import { cn } from '@/lib/utils'

/*
 * Each key is drawn as a key, with an edge under it, and sinks into
 * place while the person holds it down. Its colours come from the text it
 * sits in, so it reads the same on a page, a button, a tooltip or a picked row.
 */

function Kbd({
  className,
  name,
  children,
  ...props
}: Omit<ComponentProps<'kbd'>, 'children'> & KbdKeyProps) {
  const { held, label } = useKbdKey({ name, children })
  return (
    <kbd
      data-slot='kbd'
      data-held={held ? '' : undefined}
      className={cn(
        // In em, so a key fits the text it sits in, from a tooltip's line to a heading. Half the
        // shape's small corner, so Round makes it a pill and Standard keeps a key's soft corner.
        'relative inline-flex h-[1.75em] min-w-[1.75em] shrink-0 items-center justify-center gap-[0.25em] rounded-[min(calc(var(--control-radius-xs)/2),0.875em)] border border-current/20 px-[0.45em] align-middle font-sans text-[length:max(0.6875rem,0.8em)] leading-none font-medium whitespace-nowrap tabular-nums shadow-[0_1px_0_0_color-mix(in_oklab,currentColor_25%,transparent)] select-none',
        // Down quicker than back up, as a Button's press is.
        'transition-[box-shadow,translate] duration-(--motion-press-duration) ease-[var(--motion-press-fade-easing),var(--motion-press-easing)] data-held:translate-y-(--kbd-sink,1px) data-held:shadow-none data-held:duration-[calc(var(--motion-press-duration)*0.4)] motion-reduce:data-held:translate-y-0',
        'forced-colors:border-[CanvasText] forced-colors:data-held:bg-[Highlight] forced-colors:data-held:text-[HighlightText] forced-colors:data-held:forced-color-adjust-none',
        '[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*=size-])]:size-[1.1em]',
        className,
      )}
      {...props}
    >
      {label}
    </kbd>
  )
}

/** Keys pressed together, as ⇧⌘P, in the order the platform writes them. */
function KbdGroup({ className, children, ...props }: ComponentProps<'kbd'>) {
  const { keys } = useOrderedKeys(children)
  return (
    <kbd
      data-slot='kbd-group'
      className={cn('inline-flex items-center align-middle', className)}
      {...props}
    >
      {/* Keys read left to right in any language; `dir` on the kbd would flip its margin. */}
      <span dir='ltr' className='inline-flex items-center gap-[0.2em]'>
        {keys}
      </span>
    </kbd>
  )
}

export { Kbd, KbdGroup }
