'use client'

import { followFlow } from '@/registry/lib/flow'
import { markMounted, mergeRefs } from '@/registry/lib/refs'
import { Roll } from '@/registry/lib/roll'
import {
  AvatarFallback as AvatarFallbackPrimitive,
  AvatarImage as AvatarImagePrimitive,
  Avatar as AvatarPrimitive,
} from '@ui-sdk/react/avatar'
import { mergeProps, type PartProps, renderElement } from '@ui-sdk/react/primitive'
import { cva, type VariantProps } from 'class-variance-authority'
import {
  type ComponentProps,
  createContext,
  use,
  useEffect,
  useRef,
  useState,
} from 'react'

import { cn } from '@/lib/utils'

/*
 * A person's photo in a circle, over their initials, and a stack of them.
 *
 * The photo sits over the initials. One that is there when the avatar
 * appears (from the page's HTML, or from the cache) is simply there; one
 * that has to load fades in on `enter` once it arrives, and one that fails
 * leaves the initials. Sizes are the controls' heights, so an avatar lines
 * up with a button of the same size, at every density.
 *
 * In a stack, each face sits over the one before, cut out of it by a ring
 * in the colour behind the stack (`--avatar-stack-ring`), with a count for
 * the rest. The picture of a face you can act on (a link or a button) lifts
 * `--avatar-stack-lift` on `layout` when pointed at, and every face keeps
 * its place in the stack; the link itself stays put, so the pointer never
 * slips off it. One focused from the keyboard comes to the front, so its
 * ring shows whole. When someone joins or
 * leaves, the others glide to their new places on `layout` (`followFlow`):
 * a face that arrives scales in on `enter`, and one that goes fades and
 * shrinks where it was on `exit`.
 */

/** Each size's circle, as `--avatar-size`, and the initials' text. */
const avatarSizes = {
  // Two initials fit the 24px circle at 10px; Tailwind's smallest text is 12px.
  xs: '[--avatar-size:var(--control-height-xs)] text-[0.625rem]/none',
  sm: '[--avatar-size:var(--control-height-sm)] text-xs/none',
  default: '[--avatar-size:var(--control-height)] text-xs/none',
  lg: '[--avatar-size:var(--control-height-lg)] text-sm/none',
}

type AvatarSize = keyof typeof avatarSizes

const avatarVariants = cva(
  'bg-muted text-foreground relative inline-flex size-(--avatar-size) shrink-0 items-center justify-center overflow-hidden rounded-full align-middle font-medium select-none',
  { variants: { size: avatarSizes }, defaultVariants: { size: 'default' } },
)

/** The size a stack gives the avatars in it. */
const AvatarSizeContext = createContext<AvatarSize | undefined>(undefined)

/** `size` defaults to that of the stack it sits in, and to `default` outside one. */
function Avatar({
  className,
  size,
  ...props
}: Omit<ComponentProps<typeof AvatarPrimitive>, 'className'> & {
  className?: string
} & VariantProps<typeof avatarVariants>) {
  const inherited = use(AvatarSizeContext)
  return (
    <AvatarPrimitive
      className={cn(avatarVariants({ size: size ?? inherited }), className)}
      {...props}
    />
  )
}

/**
 * The photo, over the initials. `alt` is the person's name, or empty where
 * the name is given beside it.
 */
function AvatarImage({
  className,
  ...props
}: Omit<ComponentProps<typeof AvatarImagePrimitive>, 'className'> & {
  className?: string
}) {
  return (
    <AvatarImagePrimitive
      className={cn(
        // ui-sdk keeps an image out of sight until it has loaded, and fades it
        // in on `enter` as it does. One in the page's HTML that it hasn't
        // checked yet shows, so a photo already there is there from the first
        // paint, and only one that has to load fades in.
        'absolute inset-0 size-full object-cover transition-opacity duration-(--motion-enter-duration) ease-(--motion-enter-easing) data-[loading-status=idle]:size-full! data-[loading-status=idle]:opacity-100!',
        className,
      )}
      {...props}
    />
  )
}

/** The initials, under the photo: they show while it loads, and when there is none or it fails. */
function AvatarFallback({
  className,
  ...props
}: Omit<ComponentProps<typeof AvatarFallbackPrimitive>, 'className'> & {
  className?: string
}) {
  return (
    <AvatarFallbackPrimitive
      className={cn('flex size-full items-center justify-center uppercase', className)}
      {...props}
    />
  )
}

/**
 * How far each face sits over the one before: a quarter of a face, but never
 * so far that a face you can act on shows less than a 24px target.
 */
const stackOverlap =
  '[--avatar-stack-overlap:calc(var(--avatar-size)/4)] has-[>:is(a,button)]:[--avatar-stack-overlap:min(calc(var(--avatar-size)/4),max(0px,calc(var(--avatar-size)-1.5rem)))]'

/** The ring that cuts each face out of the one before, in the colour behind the stack. */
const stackRing =
  'ring-2 ring-(--avatar-stack-ring,var(--color-background)) forced-colors:ring-0'

/** The row of faces: how they overlap, and how one that comes or goes moves. */
const stackClassName = cn(
  stackOverlap,
  '[&>:not([data-leaving])~:not([data-leaving])]:-ms-(--avatar-stack-overlap) [&>*]:rounded-full [&_[data-slot=avatar]]:ring-2 [&_[data-slot=avatar]]:ring-(--avatar-stack-ring,var(--color-background)) forced-colors:[&_[data-slot=avatar]]:ring-0',
  // A face glides to a new place on `layout`, and one that arrives after
  // the stack has painted scales in on `enter`.
  'data-mounted:[&>*]:starting:opacity-0 motion-safe:data-mounted:[&>*]:starting:scale-50',
  // The copy of one that left fades and shrinks where it was.
  '[&>[data-leaving]]:opacity-0 motion-safe:[&>[data-leaving]]:scale-50 [&>[data-leaving]]:[transition:opacity_var(--motion-exit-duration)_var(--motion-exit-easing),scale_var(--motion-exit-duration)_var(--motion-exit-easing)]',
)

/** `size` is every avatar's in it; `aria-label` says who they are, such as "Viewers". */
function AvatarStack({
  className,
  size = 'default',
  children,
  ref,
  ...props
}: ComponentProps<'div'> & { size?: AvatarSize }) {
  const row = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!row.current) return
    return followFlow(row.current, '*')
  }, [])
  return (
    <AvatarSizeContext value={size}>
      <div
        ref={mergeRefs(row, markMounted, ref)}
        role='group'
        data-slot='avatar-stack'
        className={cn(
          'relative isolate inline-flex shrink-0 items-center align-middle',
          avatarSizes[size],
          stackClassName,
          '[&>*]:[transition:translate_var(--motion-layout-duration)_var(--motion-layout-easing),opacity_var(--motion-enter-duration)_var(--motion-enter-easing),scale_var(--motion-enter-duration)_var(--motion-enter-easing),background-color_var(--motion-press-duration)_var(--motion-press-fade-easing),color_var(--motion-press-duration)_var(--motion-press-fade-easing)] [&>[data-flow=start]]:[transition:opacity_var(--motion-enter-duration)_var(--motion-enter-easing),scale_var(--motion-enter-duration)_var(--motion-enter-easing)] motion-reduce:[&>*]:[transition:opacity_var(--motion-enter-duration)_var(--motion-enter-easing)]',
          // A face focused from the keyboard comes to the front, so its ring
          // shows whole; one pointed at keeps its place and its picture
          // lifts on `layout`.
          '[&>:is(:focus-visible,:has(:focus-visible))]:z-10 [&>:is(a,button)]:focus-visible:ring-3 [&>:is(a,button)]:focus-visible:ring-ring/50 [&>:is(a,button)]:focus-visible:outline-hidden',
          '[&>:is(a,button)>[data-slot=avatar]]:transition-[translate] [&>:is(a,button)>[data-slot=avatar]]:duration-(--motion-layout-duration) [&>:is(a,button)>[data-slot=avatar]]:ease-(--motion-layout-easing) motion-safe:[&>:is(a,button):hover>[data-slot=avatar]]:-translate-y-(--avatar-stack-lift,0.25rem) motion-reduce:[&>:is(a,button)>[data-slot=avatar]]:transition-none',
          className,
        )}
        {...props}
      >
        {children}
      </div>
    </AvatarSizeContext>
  )
}

/**
 * How many more there are, as a face of its own: +4, or 99+ past 99.
 * Renders nothing at 0. Its text reads as it shows, then the full number
 * past 99.
 */
function AvatarStackCount({
  count,
  className,
  render,
  ...props
}: Omit<PartProps<'span'>, 'children' | 'className'> & {
  count: number
  className?: string
}) {
  const size = use(AvatarSizeContext) ?? 'default'
  const [seen, setSeen] = useState({ count, trend: 1 })
  if (seen.count !== count) setSeen({ count, trend: count - seen.count })
  const { shown, spoken } = stackCountLabel(count)
  const element = renderElement(
    'span',
    mergeProps(
      {
        'data-slot': 'avatar-stack-count',
        className: cn(
          'bg-muted text-foreground relative inline-flex size-(--avatar-size) shrink-0 items-center justify-center rounded-full font-medium tabular-nums select-none forced-colors:border',
          avatarSizes[size],
          stackRing,
          // A count that is a button, such as one that lists the rest.
          '[button&]:hover:bg-accent [button&]:hover:text-accent-foreground',
          className,
        ),
        children: (
          <>
            <Roll value={shown} trend={seen.trend} />
            <span className='sr-only'>{spoken}</span>
          </>
        ),
      },
      props,
    ),
    render,
  )
  return count > 0 ? element : null
}

/**
 * What a stack's count shows, and what it says: +4 and "+4 more", or past
 * 99, 99+ and "99+ more, 137 to be exact". The spoken text leads with what shows,
 * so a person using voice control can say it.
 */
function stackCountLabel(count: number) {
  const shown = count > 99 ? '99+' : `+${count}`
  return {
    shown,
    spoken: count > 99 ? `${shown} more, ${count} to be exact` : `${shown} more`,
  }
}

export {
  Avatar,
  AvatarFallback,
  AvatarImage,
  AvatarStack,
  AvatarStackCount,
  stackCountLabel,
}
export type { AvatarSize }
