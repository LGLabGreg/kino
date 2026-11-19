'use client'

import { useSpinner } from '@/registry/components/kino/spinner'
import {
  placeholderBreatheClassName,
  placeholderFillClassName,
} from '@/registry/lib/placeholder'
import { transitionsSettled } from '@/registry/lib/resize'
import { mergeProps } from '@base-ui/react/merge-props'
import { useRender } from '@base-ui/react/use-render'
import { type ReactNode, type RefObject, useEffect, useRef, useState } from 'react'

import { cn } from '@/lib/utils'

/*
 * Placeholders for content that hasn't loaded yet. Nothing about the data is
 * known, so they take the sizes the layout sets before it arrives: a shape at
 * a part's own size (an avatar, a badge, an image), and lines of text at the
 * height of the text's line, each as wide as a typical value. When the content
 * arrives it takes the same rows, so nothing moves.
 *
 * `SkeletonContent` swaps the placeholder for the content as the Spinner
 * shows: at once when it mounts loading, otherwise once loading has lasted
 * 200ms, and then for at least 300ms, so a fast request never flashes it.
 */

const shapeClassName = cn(
  'rounded-(--control-radius-capped)',
  placeholderFillClassName,
  placeholderBreatheClassName,
)

/** A shape sized by its classes, such as `size-8 rounded-full` for an avatar. */
function Skeleton({
  className,
  render,
  ...props
}: Omit<useRender.ComponentProps<'div'>, 'className'> & { className?: string }) {
  return useRender({
    defaultTagName: 'div',
    render,
    props: mergeProps<'div'>(
      { 'aria-hidden': true, className: cn(shapeClassName, className) },
      props,
    ),
    state: { slot: 'skeleton' },
  })
}

/**
 * Lines of text still loading, each the height of the line it sits in, so a
 * placeholder inside a title or a paragraph is as tall as its text will be.
 * Its width is the line's; the last of several is shorter, as a paragraph's is.
 */
function SkeletonText({
  className,
  lines = 1,
  render,
  ...props
}: Omit<useRender.ComponentProps<'span'>, 'className'> & {
  className?: string
  /** How many lines of text it stands in for. */
  lines?: number
}) {
  return useRender({
    defaultTagName: 'span',
    render,
    props: mergeProps<'span'>(
      {
        'aria-hidden': true,
        className: cn('flex max-w-full flex-col', className),
        children: Array.from({ length: lines }, (_, line) => (
          <span key={line} className='flex h-lh items-center'>
            {/* About as tall as the letters, so lines stand apart as text does. */}
            <span
              className={cn(
                'h-[0.8em] w-full',
                lines > 1 && line === lines - 1 && 'w-3/5',
                shapeClassName,
              )}
            />
          </span>
        )),
      },
      props,
    ),
    state: { slot: 'skeleton-text' },
  })
}

/**
 * Shows its `placeholder` while `loading`, and its children once they arrive.
 * Each swap crossfades: the side that leaves fades out on the `exit` role
 * over the one that arrives, which fades in on the `enter` role.
 */
function SkeletonContent({
  loading,
  placeholder,
  children,
  ...props
}: Omit<useRender.ComponentProps<'div'>, 'className'> & {
  className?: string
  /** Whether the content is still loading. */
  loading: boolean
  /** What stands in for the content while it loads: skeletons laid out as it will be. */
  placeholder: ReactNode
}) {
  const shown = useSpinner(loading)
  const [side, setSide] = useState(shown)
  // Which side is fading out, by whether it is the placeholder.
  const [leaving, setLeaving] = useState<boolean | null>(null)
  // Nothing fades on first paint: only once it has swapped (motion rule 6).
  const [swapped, setSwapped] = useState(false)
  if (side !== shown) {
    setSide(shown)
    setLeaving(side)
    setSwapped(true)
  }
  const leavingRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const element = leavingRef.current
    if (leaving === null || element === null) return
    let current = true
    void transitionsSettled(element, { property: 'opacity' }).then(() => {
      if (current) setLeaving(null)
    })
    return () => {
      current = false
    }
  }, [leaving])
  const sides = leaving === null ? [shown] : [leaving, shown]
  return (
    // Both sides share one cell while one leaves, so neither moves.
    <div data-slot='skeleton-content-stack' className='grid *:[grid-area:1/1]'>
      {sides.map((isPlaceholder) => (
        <SkeletonContentSide
          // One element per side, so a swap cut short turns back from where it is.
          key={isPlaceholder ? 'placeholder' : 'content'}
          sideRef={isPlaceholder === leaving ? leavingRef : undefined}
          placeholder={isPlaceholder}
          leaving={isPlaceholder === leaving}
          busy={loading || shown}
          fades={swapped}
          {...props}
        >
          {isPlaceholder ? placeholder : children}
        </SkeletonContentSide>
      ))}
    </div>
  )
}

function SkeletonContentSide({
  sideRef,
  placeholder,
  leaving,
  busy,
  fades,
  className,
  render,
  ...props
}: Omit<useRender.ComponentProps<'div'>, 'className'> & {
  className?: string
  sideRef: RefObject<HTMLDivElement | null> | undefined
  placeholder: boolean
  leaving: boolean
  busy: boolean
  fades: boolean
}) {
  return useRender({
    defaultTagName: 'div',
    render,
    ref: sideRef,
    props: mergeProps<'div'>(
      {
        // The placeholder says nothing to a screen reader; a status region says what loads.
        'aria-hidden': placeholder || leaving || undefined,
        'aria-busy': (busy && !leaving) || undefined,
        inert: leaving || undefined,
        className: cn(
          fades &&
            'transition-opacity duration-(--motion-enter-duration) ease-(--motion-enter-easing) starting:opacity-0',
          leaving &&
            'pointer-events-none opacity-0 duration-(--motion-exit-duration) ease-(--motion-exit-easing)',
          className,
        ),
      },
      props,
    ),
    state: { slot: 'skeleton-content', loading: placeholder },
  })
}

export { Skeleton, SkeletonContent, SkeletonText }
