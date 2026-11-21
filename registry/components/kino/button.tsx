'use client'

import { Spinner, useSpinner } from '@/registry/components/kino/spinner'
import { Swap, SwapText, flattenChildren, swapIconClassName } from '@/registry/lib/swap'
import { Button as ButtonPrimitive } from '@base-ui/react/button'
import { cva, type VariantProps } from 'class-variance-authority'
import { isValidElement, type ReactNode } from 'react'

import { cn } from '@/lib/utils'

const buttonVariants = cva(
  // The press is quicker on the way down than on the way back, so a short tap
  // still shows. A button that opens a popup stays still, so the popup doesn't
  // open from a moving anchor.
  "group/button relative inline-flex max-w-full shrink-0 touch-manipulation items-center justify-center gap-(--button-gap) overflow-clip rounded-(--control-radius) border bg-clip-padding text-sm font-medium whitespace-nowrap select-none transition-[color,background-color,border-color,box-shadow,opacity,scale] duration-(--motion-press-duration) ease-[var(--motion-press-fade-easing),var(--motion-press-fade-easing),var(--motion-press-fade-easing),var(--motion-press-fade-easing),var(--motion-press-fade-easing),var(--motion-press-easing)] focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-hidden active:duration-[calc(var(--motion-press-duration)*0.4)] motion-safe:active:not-aria-[haspopup]:scale-[calc(1_-_(1_-_var(--motion-press-scale))_*_var(--button-press-depth,1))] data-disabled:pointer-events-none data-disabled:not-data-loading:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 forced-colors:aria-invalid:outline-2 forced-colors:aria-invalid:outline-offset-1 forced-colors:aria-invalid:outline-dashed dark:aria-invalid:border-destructive/70 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      // Each variant names its own border colour, so the classes also work on a
      // link, without `cn()` to drop one of two.
      variant: {
        default:
          'border-transparent bg-primary text-primary-foreground hover:bg-primary/80',
        outline:
          'border-border bg-background shadow-xs hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50',
        secondary:
          'border-transparent bg-secondary text-secondary-foreground hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)] aria-expanded:bg-secondary aria-expanded:text-secondary-foreground',
        ghost:
          'border-transparent hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:hover:bg-muted/50',
        // The destructive colour on its own tint reads at 4:1 in light mode;
        // a fifth of the foreground mixed in takes the text past 4.5:1.
        destructive:
          'border-transparent bg-destructive/10 text-[color-mix(in_oklch,var(--destructive),var(--foreground)_20%)] hover:bg-destructive/20 focus-visible:border-destructive/40 focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:hover:bg-destructive/30 dark:focus-visible:ring-destructive/40',
        link: 'border-transparent text-primary underline-offset-4 hover:underline',
      },
      // The padding stays the same with or without an icon, so an icon that
      // arrives moves the label by its own width and nothing snaps. A small
      // target shrinks further when pressed, or the press can't be seen.
      size: {
        default:
          'h-(--button-height) [--button-height:var(--control-height)] px-(--control-padding) [--button-gap:--spacing(1.5)] in-data-[slot=button-group]:rounded-(--control-radius)',
        // An xs button's sides are four fifths of a control's: 8px at Balanced.
        xs: "h-(--button-height) [--button-height:var(--control-height-xs)] rounded-(--control-radius-xs) px-[calc(var(--control-padding)*0.8)] text-xs [--button-gap:--spacing(1)] in-data-[slot=button-group]:rounded-(--control-radius) [&_svg:not([class*='size-'])]:size-3.5",
        sm: 'h-(--button-height) [--button-height:var(--control-height-sm)] rounded-(--control-radius-sm) px-(--control-padding) [--button-gap:--spacing(1)] in-data-[slot=button-group]:rounded-(--control-radius)',
        lg: 'h-(--button-height) [--button-height:var(--control-height-lg)] px-(--control-padding) [--button-gap:--spacing(1.5)]',
        icon: 'size-(--button-height) [--button-height:var(--control-height)] [--button-press-depth:2.5]',
        'icon-xs':
          "size-(--button-height) [--button-height:var(--control-height-xs)] rounded-(--control-radius-xs) [--button-press-depth:2.5] in-data-[slot=button-group]:rounded-(--control-radius) [&_svg:not([class*='size-'])]:size-3.5",
        'icon-sm':
          'size-(--button-height) [--button-height:var(--control-height-sm)] rounded-(--control-radius-sm) [--button-press-depth:2.5] in-data-[slot=button-group]:rounded-(--control-radius)',
        'icon-lg':
          'size-(--button-height) [--button-height:var(--control-height-lg)] [--button-press-depth:2.5]',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

/** Where an icon or the spinner sits beside the label. Empty, it takes no room. */
function ButtonSlot({ side, children }: { side: 'start' | 'end'; children: ReactNode }) {
  return (
    <Swap align={side} roll className={swapIconClassName}>
      {children ? (
        <span
          className={cn(
            'flex',
            side === 'start' ? 'pe-(--button-gap)' : 'ps-(--button-gap)',
          )}
        >
          {children}
        </span>
      ) : null}
    </Swap>
  )
}

function isIcon(node: ReactNode, place: 'inline-start' | 'inline-end'): boolean {
  return (
    isValidElement(node) && (node.props as Record<string, unknown>)['data-icon'] === place
  )
}

function ButtonContent({
  iconOnly,
  spinning,
  children,
}: {
  iconOnly: boolean
  spinning: boolean
  children: ReactNode
}) {
  // An icon button has nowhere to make room: its icon gives way to the spinner.
  if (iconOnly) {
    return (
      <Swap roll className={swapIconClassName}>
        {spinning ? <Spinner /> : children}
      </Swap>
    )
  }
  const parts = flattenChildren(children)
  const last = parts.length - 1
  const start = isIcon(parts[0], 'inline-start') ? parts[0] : null
  const end = last > 0 && isIcon(parts[last], 'inline-end') ? parts[last] : null
  const label = parts.slice(start ? 1 : 0, end ? last : undefined)
  return (
    <>
      <ButtonSlot side='start'>{spinning ? <Spinner /> : start}</ButtonSlot>
      {label.every((part) => typeof part === 'string' || typeof part === 'number') ? (
        <SwapText text={label.join('')} />
      ) : (
        <Swap bleed className='[--swap-gap:var(--button-gap)]'>
          {label}
        </Swap>
      )}
      <ButtonSlot side='end'>{end}</ButtonSlot>
    </>
  )
}

function Button({
  className,
  variant = 'default',
  size = 'default',
  loading = false,
  disabled,
  focusableWhenDisabled,
  children,
  ...props
}: Omit<ButtonPrimitive.Props, 'className'> & { className?: string } & VariantProps<
    typeof buttonVariants
  > & {
    /**
     * Blocks presses at once and keeps focus. The spinner shows only when
     * loading lasts 200ms, and then for at least 300ms.
     */
    loading?: boolean
  }) {
  const spinning = useSpinner(loading)
  return (
    <ButtonPrimitive
      data-slot='button'
      data-variant={variant}
      data-loading={loading ? '' : undefined}
      aria-busy={loading || undefined}
      disabled={disabled || loading}
      focusableWhenDisabled={focusableWhenDisabled || loading}
      // The slots carry the gap, so an empty one takes no room.
      className={cn(buttonVariants({ variant, size }), 'gap-0', className)}
      {...props}
    >
      <ButtonContent iconOnly={size?.startsWith('icon') ?? false} spinning={spinning}>
        {children}
      </ButtonContent>
    </ButtonPrimitive>
  )
}

export { Button, buttonVariants }
