'use client'

import { mergeProps, type PartProps, renderElement } from '@ui-sdk/react/primitive'
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
}: Omit<PartProps<'div'>, 'className' | 'style'> & {
  className?: string
  style?: CSSProperties
  /** Width over height, such as `16 / 9`. Without it, the `--ratio` variable's value, or 1. */
  ratio?: number
}) {
  return renderElement(
    'div',
    mergeProps(
      {
        'data-slot': 'aspect-ratio',
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
    render,
  )
}

export { AspectRatio }
