'use client'

import { SwapText } from '@/registry/lib/swap'
import { mergeProps } from '@base-ui/react/merge-props'
import { useRender } from '@base-ui/react/use-render'
import { cva, type VariantProps } from 'class-variance-authority'
import { useState } from 'react'

import { cn } from '@/lib/utils'

/*
 * Text that shows work going on, such as "Thinking…". While `loading`, light
 * moves over the words at an even pace; when the work ends they settle once
 * at their full colour. A label that changes crossfades as the Badge's and the
 * Button's do, and starts a new pass.
 *
 * The words are drawn twice while it runs: the copy underneath, which is the
 * one read, selected and drawn at rest, and a copy on top that carries the
 * light. In `sweep` and `glow` the top copy sits in a window as wide as the
 * words twice over and the band; the window slides across while the words in
 * it slide back as far, so they stand still. Everything moves on `translate`
 * and `opacity`, which run off the main thread, so the light keeps moving
 * while the page is busy with the work it shows. The loops pause rather than
 * stop, so what settles starts from wherever it was.
 */

// The copy underneath. In `sweep` and `breathe` it fades down while the top copy is
// already on, and comes back up before the top copy goes, so the words never dim
// outside the light as it starts and stops.
const baseVariants = cva('inline-flex max-w-full min-w-0', {
  variants: {
    variant: {
      sweep:
        'transition-opacity duration-(--motion-exit-duration) ease-(--motion-exit-easing) group-data-loading/text-shimmer:opacity-35 group-data-loading/text-shimmer:duration-(--motion-enter-duration) group-data-loading/text-shimmer:ease-(--motion-enter-easing) motion-reduce:group-data-loading/text-shimmer:opacity-75 forced-colors:opacity-100',
      glow: '',
      breathe:
        'transition-opacity duration-(--motion-exit-duration) ease-(--motion-exit-easing) group-data-loading/text-shimmer:opacity-50 motion-reduce:group-data-loading/text-shimmer:opacity-100 forced-colors:opacity-100',
    },
  },
  defaultVariants: { variant: 'sweep' },
})

// The top layer: the band's window, or in `breathe` a layer over the words. One pass and
// its rest, or one breath, take five `layout` durations, as the Progress's sheen does. A
// new label flips `data-pass`, which runs the same loop under a second name and so starts
// a new pass: the band's path is measured in the label's width.
const layerVariants = cva('pointer-events-none absolute select-none', {
  variants: {
    variant: {
      // Light taken: under the band the words fade towards the page, so it shows on any
      // colour and surface, and the words keep their full colour everywhere else.
      sweep:
        'inset-y-0 -start-[calc(100%+var(--text-shimmer-spread,2em)*3)] w-[calc(200%+var(--text-shimmer-spread,2em)*4)] opacity-0 transition-opacity delay-[calc(var(--motion-exit-duration)*0.9)] duration-[calc(var(--motion-exit-duration)*0.1)] group-data-loading/text-shimmer:opacity-100 group-data-loading/text-shimmer:transition-none [mask-image:linear-gradient(to_right,black_calc(50%-var(--text-shimmer-spread,2em)),transparent_50%,black_calc(50%+var(--text-shimmer-spread,2em)))] motion-reduce:[mask-image:none] forced-colors:[mask-image:none] motion-safe:animate-[kino-text-shimmer-sweep_calc(var(--motion-layout-duration)*5)_linear_infinite_paused] motion-safe:group-data-loading/text-shimmer:animate-[kino-text-shimmer-sweep_calc(var(--motion-layout-duration)*5)_linear_infinite_running] motion-safe:group-data-[pass=b]/text-shimmer:animate-[kino-text-shimmer-sweep-b_calc(var(--motion-layout-duration)*5)_linear_infinite_paused] motion-safe:group-data-loading/text-shimmer:group-data-[pass=b]/text-shimmer:animate-[kino-text-shimmer-sweep-b_calc(var(--motion-layout-duration)*5)_linear_infinite_running]',
      // Light added: the band lights the words up to `--text-shimmer-highlight`, the
      // foreground by default, so it shows on muted text.
      glow: 'inset-y-0 -start-[calc(100%+var(--text-shimmer-spread,2em)*3)] w-[calc(200%+var(--text-shimmer-spread,2em)*4)] text-(--text-shimmer-highlight,var(--foreground)) opacity-0 transition-opacity duration-(--motion-exit-duration) ease-(--motion-exit-easing) group-data-loading/text-shimmer:opacity-100 group-data-loading/text-shimmer:duration-(--motion-enter-duration) group-data-loading/text-shimmer:ease-(--motion-enter-easing) [mask-image:linear-gradient(to_right,transparent_calc(50%-var(--text-shimmer-spread,2em)),black_50%,transparent_calc(50%+var(--text-shimmer-spread,2em)))] motion-reduce:[mask-image:none] forced-colors:hidden motion-safe:animate-[kino-text-shimmer-sweep_calc(var(--motion-layout-duration)*5)_linear_infinite_paused] motion-safe:group-data-loading/text-shimmer:animate-[kino-text-shimmer-sweep_calc(var(--motion-layout-duration)*5)_linear_infinite_running] motion-safe:group-data-[pass=b]/text-shimmer:animate-[kino-text-shimmer-sweep-b_calc(var(--motion-layout-duration)*5)_linear_infinite_paused] motion-safe:group-data-loading/text-shimmer:group-data-[pass=b]/text-shimmer:animate-[kino-text-shimmer-sweep-b_calc(var(--motion-layout-duration)*5)_linear_infinite_running]',
      // Nothing travels: the whole line fades a little and comes back.
      breathe:
        'inset-0 flex opacity-0 motion-reduce:hidden transition-opacity delay-[calc(var(--motion-exit-duration)*0.9)] duration-[calc(var(--motion-exit-duration)*0.1)] group-data-loading/text-shimmer:opacity-100 group-data-loading/text-shimmer:transition-none',
    },
  },
  defaultVariants: { variant: 'sweep' },
})

// The words on top. Under reduced motion nothing travels: in `sweep` and `glow` they
// breathe in place over the copy underneath; `breathe` holds still.
const copyVariants = cva('flex', {
  variants: {
    variant: {
      sweep:
        'absolute inset-y-0 start-[calc(50%+var(--text-shimmer-spread,2em))] w-[calc(50%-var(--text-shimmer-spread,2em)*2)] motion-safe:animate-[kino-text-shimmer-sweep-text_calc(var(--motion-layout-duration)*5)_linear_infinite_paused] motion-safe:group-data-loading/text-shimmer:animate-[kino-text-shimmer-sweep-text_calc(var(--motion-layout-duration)*5)_linear_infinite_running] motion-safe:group-data-[pass=b]/text-shimmer:animate-[kino-text-shimmer-sweep-text-b_calc(var(--motion-layout-duration)*5)_linear_infinite_paused] motion-safe:group-data-loading/text-shimmer:group-data-[pass=b]/text-shimmer:animate-[kino-text-shimmer-sweep-text-b_calc(var(--motion-layout-duration)*5)_linear_infinite_running] motion-reduce:animate-[kino-text-shimmer-breathe_calc(var(--motion-layout-duration)*5)_ease-in-out_infinite_paused] motion-reduce:group-data-loading/text-shimmer:animate-[kino-text-shimmer-breathe_calc(var(--motion-layout-duration)*5)_ease-in-out_infinite_running] forced-colors:animate-none',
      glow: 'absolute inset-y-0 start-[calc(50%+var(--text-shimmer-spread,2em))] w-[calc(50%-var(--text-shimmer-spread,2em)*2)] motion-safe:animate-[kino-text-shimmer-sweep-text_calc(var(--motion-layout-duration)*5)_linear_infinite_paused] motion-safe:group-data-loading/text-shimmer:animate-[kino-text-shimmer-sweep-text_calc(var(--motion-layout-duration)*5)_linear_infinite_running] motion-safe:group-data-[pass=b]/text-shimmer:animate-[kino-text-shimmer-sweep-text-b_calc(var(--motion-layout-duration)*5)_linear_infinite_paused] motion-safe:group-data-loading/text-shimmer:group-data-[pass=b]/text-shimmer:animate-[kino-text-shimmer-sweep-text-b_calc(var(--motion-layout-duration)*5)_linear_infinite_running] motion-reduce:animate-[kino-text-shimmer-breathe_calc(var(--motion-layout-duration)*5)_ease-in-out_infinite_paused] motion-reduce:group-data-loading/text-shimmer:animate-[kino-text-shimmer-breathe_calc(var(--motion-layout-duration)*5)_ease-in-out_infinite_running]',
      breathe:
        'min-w-0 flex-1 motion-safe:animate-[kino-text-shimmer-breathe_calc(var(--motion-layout-duration)*5)_ease-in-out_infinite_paused] motion-safe:group-data-loading/text-shimmer:animate-[kino-text-shimmer-breathe_calc(var(--motion-layout-duration)*5)_ease-in-out_infinite_running] forced-colors:animate-none',
    },
  },
  defaultVariants: { variant: 'sweep' },
})

function TextShimmer({
  className,
  variant,
  loading = true,
  children,
  render,
  ...props
}: Omit<useRender.ComponentProps<'span'>, 'className' | 'children'> &
  VariantProps<typeof layerVariants> & {
    className?: string
    /** The status, such as "Thinking…". One line: it truncates, with the whole text as its `title`. */
    children: string
    /** Whether the work is going on, as a Button's `loading`. When it ends, the words settle at their full colour. */
    loading?: boolean
  }) {
  // A new label while it loads starts a new pass. One that comes as the work ends waits, so
  // the light settles from where it was; it starts a new pass if loading begins again.
  const [pass, setPass] = useState({ text: children, second: false })
  if (loading && pass.text !== children) setPass({ text: children, second: !pass.second })
  const look = { variant: variant ?? 'sweep' }
  return useRender({
    defaultTagName: 'span',
    render,
    props: mergeProps<'span'>(
      {
        className: cn(
          'group/text-shimmer relative inline-flex w-fit max-w-full min-w-0 overflow-x-clip align-bottom [--text-shimmer-dir:1] rtl:[--text-shimmer-dir:-1]',
          className,
        ),
        children: (
          <>
            <span data-slot='text-shimmer-text' className={baseVariants(look)}>
              <SwapText text={children} />
            </span>
            <span
              aria-hidden
              data-slot='text-shimmer-light'
              className={layerVariants(look)}
            >
              <span className={copyVariants(look)}>
                <SwapText text={children} />
              </span>
            </span>
          </>
        ),
      },
      props,
    ),
    state: {
      slot: 'text-shimmer',
      variant: look.variant,
      loading,
      pass: pass.second ? 'b' : 'a',
    },
  })
}

export { TextShimmer }
