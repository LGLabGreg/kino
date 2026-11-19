'use client'

import { mergeProps } from '@base-ui/react/merge-props'
import { useRender } from '@base-ui/react/use-render'
import type { CSSProperties } from 'react'

import { cn } from '@/lib/utils'

/*
 * A box that keeps its width to height, for an image, a video or a map. Its
 * ratio is the `--ratio` variable, so a class can change it at a breakpoint,
 * and a new ratio glides on `layout`, pushing what sits below it along.
 */

function AspectRatio({
  ratio,
  className,
  style,
  render,
  ...props
}: Omit<useRender.ComponentProps<'div'>, 'className'> & {
  className?: string
  /** Width over height, such as `16 / 9`. Without it, the `--ratio` variable's value, or 1. */
  ratio?: number
}) {
  return useRender({
    defaultTagName: 'div',
    render,
    props: mergeProps<'div'>(
      {
        className: cn(
          // `min-h-0` and `shrink-0` keep the ratio when content is taller than the box or a
          // flex column is shorter than it, so a child sized `size-full` fills it. `--ratio` is
          // set here so the box never takes it from an AspectRatio around it.
          'relative min-h-0 shrink-0 [--ratio:1] aspect-(--ratio)',
          'transition-[aspect-ratio] duration-(--motion-layout-duration) ease-(--motion-layout-easing) motion-reduce:transition-none',
          className,
        ),
        style: { '--ratio': ratio, ...style } as CSSProperties,
      },
      props,
    ),
    state: { slot: 'aspect-ratio' },
  })
}

export { AspectRatio }
