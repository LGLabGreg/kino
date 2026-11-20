import type { ComponentProps } from 'react'

import { cn } from '@/lib/utils'

/*
 * A studio backdrop: what a picture of the product stands on, lit softly
 * behind it and falling off towards the edges and floor, like a
 * photographer's paper. Grey only, from the theme's own background and
 * foreground, so it suits any colour scheme. It fills the box around it,
 * which is `relative isolate`, and sits behind everything in it.
 */
function Studio({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      aria-hidden
      data-slot='studio'
      className={cn(
        'pointer-events-none absolute inset-0 -z-10 forced-colors:hidden',
        // The light: brightest just above the middle, where a picture's top sits.
        'bg-[radial-gradient(90%_80%_at_50%_38%,var(--color-background),color-mix(in_oklab,var(--color-foreground)_2%,var(--color-background)))] dark:bg-[radial-gradient(90%_80%_at_50%_38%,color-mix(in_oklab,var(--color-foreground)_9%,var(--color-background)),var(--color-background))]',
        className,
      )}
      {...props}
    >
      {/* The floor, a shade deeper, so what stands on it has somewhere to stand. */}
      <div className='absolute inset-x-0 bottom-0 h-1/3 bg-[linear-gradient(to_bottom,transparent,--alpha(var(--color-black)/1.5%))] dark:bg-[linear-gradient(to_bottom,transparent,--alpha(var(--color-black)/25%))]' />
    </div>
  )
}

export { Studio }
