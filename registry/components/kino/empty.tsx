'use client'

import { mergeProps, type PartProps, renderElement } from '@ui-sdk/react/primitive'
import { cva, type VariantProps } from 'class-variance-authority'
import { type ReactNode, useState } from 'react'

import { cn } from '@/lib/utils'

/*
 * The empty state: a picture, the title, a line on what belongs there and the
 * next step, all in the middle of the space it fills. The picture is an icon
 * in a tile, or the same icon in a stack of outlined rows that shows a list
 * waiting for its rows. One that comes back after being hidden rises
 * `--empty-rise` into place on `enter`, its picture landing as it comes and
 * the actions a moment after the words. `--empty-wait: 1` holds the entrance
 * back while what it replaces leaves on `exit`, as a table's rows do.
 */

const emptyVariants = cva(
  'group/empty flex min-w-0 flex-1 flex-col items-center justify-center gap-(--surface-gap) p-(--surface-padding-lg) text-center',
  {
    variants: {
      variant: {
        default: '',
        /** A dashed edge, for an empty state that shares the page with other content. */
        outline: 'rounded-(--surface-radius) border border-dashed',
      },
    },
    defaultVariants: { variant: 'default' },
  },
)

interface Arrival {
  show: boolean | undefined
  /** It has just come back, so its entrance plays. */
  arrived: boolean
}

/**
 * What an empty state knows after its `show` changes to `show`. It has just
 * come back when it was hidden (`false`) and now shows, as when a list loses
 * its last row or a search stops matching. One that shows from the start, or
 * whose `show` is left out, is simply there, so nothing moves when a page
 * opens with it.
 */
function arrivalAfter(previous: Arrival, show: boolean | undefined): Arrival {
  if (previous.show === show) return previous
  return { show, arrived: previous.show === false && show === true }
}

function useArrived(show: boolean | undefined) {
  const [seen, setSeen] = useState<Arrival>({ show, arrived: false })
  const next = arrivalAfter(seen, show)
  if (next !== seen) setSeen(next)
  return next.arrived
}

/** A long unbroken word breaks rather than run out of the box. */
function EmptyTitle({
  className,
  render,
  ...props
}: Omit<PartProps<'div'>, 'className'> & { className?: string }) {
  return renderElement(
    'div',
    mergeProps(
      {
        'data-slot': 'empty-title',
        className: cn(
          'text-base leading-snug font-medium text-balance wrap-anywhere',
          className,
        ),
      },
      props,
    ),
    render,
  )
}

function EmptyDescription({
  className,
  render,
  ...props
}: Omit<PartProps<'p'>, 'className'> & { className?: string }) {
  return renderElement(
    'p',
    mergeProps(
      {
        'data-slot': 'empty-description',
        className: cn(
          'text-muted-foreground *:[a]:hover:text-foreground text-sm text-pretty wrap-anywhere *:[a]:underline *:[a]:underline-offset-3',
          className,
        ),
      },
      props,
    ),
    render,
  )
}

function Empty({
  className,
  variant,
  show,
  render,
  ...props
}: Omit<PartProps<'div'>, 'className'> & { className?: string } & VariantProps<
    typeof emptyVariants
  > & {
    /**
     * Whether it shows. Given, it stays mounted while hidden and plays its
     * entrance when it comes back, such as when a list loses its last row or
     * a search stops matching; one that shows from the start is simply there.
     * Left out, it always shows and never moves.
     */
    show?: boolean
  }) {
  const arrived = useArrived(show)
  const element = renderElement(
    'div',
    mergeProps(
      {
        'data-slot': 'empty',
        'data-arrived': arrived ? '' : undefined,
        className: cn(emptyVariants({ variant }), className),
      },
      props,
    ),
    render,
  )
  return show === false ? null : element
}

function EmptyHeader({
  className,
  render,
  ...props
}: Omit<PartProps<'div'>, 'className'> & { className?: string }) {
  return renderElement(
    'div',
    mergeProps(
      {
        'data-slot': 'empty-header',
        className: cn(
          'flex w-full max-w-sm min-w-0 flex-col items-center gap-1.5 transition-[opacity,translate] [transition-delay:calc(var(--motion-exit-duration)*var(--empty-wait,0))] duration-(--motion-enter-duration) ease-(--motion-enter-easing) group-data-arrived/empty:starting:opacity-0 motion-safe:group-data-arrived/empty:starting:translate-y-(--empty-rise,0.5rem)',
          className,
        ),
      },
      props,
    ),
    render,
  )
}

/** An outlined row: a picture's place and two lines of text. */
const rowClassName =
  'bg-card flex h-12 w-full items-center gap-2.5 rounded-(--surface-radius) border px-2.5 shadow-xs'

const barClassName = 'bg-muted h-1.5 rounded-full'

/**
 * A row behind the first: scaled down from its top edge and lifted, so its top
 * shows above the row in front. It starts hidden behind that row.
 */
const backRowClassName =
  'col-start-1 row-start-1 origin-top transition-[translate,scale,opacity] [transition-delay:calc(var(--motion-exit-duration)*var(--empty-wait,0))] duration-(--motion-enter-duration) ease-(--motion-enter-easing) group-data-arrived/empty:starting:opacity-0 motion-safe:group-data-arrived/empty:starting:translate-y-0 motion-safe:group-data-arrived/empty:starting:scale-100'

function BackRow({ className }: { className: string }) {
  return (
    <div className={cn(rowClassName, backRowClassName, className)}>
      <div className='bg-muted size-7 shrink-0 rounded-(--control-radius-sm)' />
      <div className='flex flex-1 flex-col gap-1.5'>
        <div className={cn(barClassName, 'w-3/5')} />
        <div className={cn(barClassName, 'w-2/5 opacity-60')} />
      </div>
    </div>
  )
}

const emptyMediaVariants = cva(
  'mb-2.5 flex shrink-0 items-center justify-center [&_svg]:pointer-events-none [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        /** Whatever it holds, as it is: an avatar, a picture. */
        default: '',
        /** An icon in a tile, which lands as the empty state comes back. */
        icon: "bg-muted text-foreground size-10 rounded-(--control-radius) transition-[scale] [transition-delay:calc(var(--motion-exit-duration)*var(--empty-wait,0))] duration-(--motion-enter-duration) ease-(--motion-enter-easing) motion-safe:group-data-arrived/empty:starting:scale-75 [&_svg:not([class*='size-'])]:size-5",
        /**
         * An icon in the first of three outlined rows, the two behind it
         * smaller and fainter, so the space reads as a list waiting for its
         * rows. They fan out from behind the first as it comes back.
         */
        stack: 'grid w-56 max-w-full grid-cols-1 pt-5',
      },
    },
    defaultVariants: { variant: 'default' },
  },
)

/** Decorative: the title says what it shows. */
function EmptyMedia({
  className,
  variant,
  render,
  children,
  ...props
}: Omit<PartProps<'div'>, 'className' | 'children'> & {
  className?: string
  children?: ReactNode
} & VariantProps<typeof emptyMediaVariants>) {
  return renderElement(
    'div',
    mergeProps(
      {
        'data-slot': 'empty-media',
        'data-variant': variant ?? 'default',
        className: cn(emptyMediaVariants({ variant }), className),
        'aria-hidden': true,
        children:
          variant === 'stack' ? (
            <>
              <BackRow className='-translate-y-5 scale-84 opacity-40' />
              <BackRow className='-translate-y-2.5 scale-92 opacity-70' />
              <div className={cn(rowClassName, 'relative col-start-1 row-start-1')}>
                <div className="bg-muted text-foreground flex size-7 shrink-0 items-center justify-center rounded-(--control-radius-sm) [&_svg:not([class*='size-'])]:size-4">
                  {children}
                </div>
                <div className='flex flex-1 flex-col gap-1.5'>
                  <div className={cn(barClassName, 'bg-foreground/15 w-3/5')} />
                  <div className={cn(barClassName, 'w-2/5')} />
                </div>
              </div>
            </>
          ) : (
            children
          ),
      },
      props,
    ),
    render,
  )
}

/** The next step: one action, a second where there are two real paths, and a link. */
function EmptyContent({
  className,
  render,
  ...props
}: Omit<PartProps<'div'>, 'className'> & { className?: string }) {
  return renderElement(
    'div',
    mergeProps(
      {
        'data-slot': 'empty-content',
        className: cn(
          'flex w-full max-w-sm min-w-0 flex-wrap items-center justify-center gap-2 text-sm transition-[opacity,translate] [transition-delay:calc(var(--motion-exit-duration)*var(--empty-wait,0)+var(--motion-enter-duration)*0.15)] duration-(--motion-enter-duration) ease-(--motion-enter-easing) group-data-arrived/empty:starting:opacity-0 motion-safe:group-data-arrived/empty:starting:translate-y-(--empty-rise,0.5rem)',
          className,
        ),
      },
      props,
    ),
    render,
  )
}

export {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  emptyMediaVariants,
  EmptyTitle,
  emptyVariants,
}

export { arrivalAfter }
