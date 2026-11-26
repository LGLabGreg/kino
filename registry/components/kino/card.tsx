'use client'

import { panelDescriptionClassName, panelTitleClassName } from '@/registry/lib/panel'
import { mergeProps, type PartProps, renderElement } from '@ui-sdk/react/primitive'
import type { ComponentProps } from 'react'

import { cn } from '@/lib/utils'

/*
 * A surface on the page that groups related content. It has the edge of the
 * Checkbox and Radio cards and the Accordion's card, the corner of every
 * surface, and the Dialog's title and description. Its parts keep the sides'
 * padding, so a `CardSection` runs to the edges.
 *
 * A card that leads somewhere puts a `CardLink` in its title: the link's hit
 * area stretches over the whole card, the card's border darkens on hover as a
 * choice card's does, and it takes the controls' ring while the link has
 * focus. The link's name stays the title, never the whole card's text.
 */

function Card({
  className,
  render,
  ...props
}: Omit<PartProps<'div'>, 'className'> & { className?: string }) {
  return renderElement(
    'div',
    mergeProps(
      {
        'data-slot': 'card',
        className: cn(
          'group/card bg-card text-card-foreground relative flex min-w-0 flex-col gap-(--surface-gap) rounded-(--surface-radius) border py-(--surface-padding) text-sm shadow-xs',
          // A footer, and a section at either end, reach the card's edge.
          'has-[>[data-slot=card-footer]:last-child]:pb-0 has-[>[data-slot=card-section]:first-child]:pt-0 has-[>[data-slot=card-section]:last-child]:pb-0',
          className,
        ),
      },
      props,
    ),
    render,
  )
}

/** The title, the description and an action. With a `CardAction`, the action takes the end of the first row. */
function CardHeader({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot='card-header'
      className={cn(
        'grid auto-rows-min grid-cols-[minmax(0,1fr)] items-start gap-x-(--surface-gap) gap-y-1.5 px-(--surface-padding) has-data-[slot=card-action]:grid-cols-[minmax(0,1fr)_auto] [.border-b]:pb-(--surface-padding)',
        className,
      )}
      {...props}
    />
  )
}

/** An `<h3>`, as a card usually sits under a section's `<h2>`; `render` gives it the page's level. */
function CardTitle({
  className,
  render,
  ...props
}: Omit<PartProps<'h3'>, 'className'> & { className?: string }) {
  return renderElement(
    'h3',
    mergeProps(
      {
        'data-slot': 'card-title',
        className: cn(panelTitleClassName, className),
      },
      props,
    ),
    render,
  )
}

function CardDescription({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot='card-description'
      className={cn(panelDescriptionClassName, className)}
      {...props}
    />
  )
}

/**
 * Its controls sit above a `CardLink`'s stretched area and still take the
 * pointer; the rest of it, such as a status badge, still leads to the link.
 */
function CardAction({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot='card-action'
      className={cn(
        'relative z-1 col-start-2 group-has-data-[slot=card-link]/card:pointer-events-none group-has-data-[slot=card-link]/card:[&_:is(a,button,input,select,textarea,[tabindex])]:pointer-events-auto row-span-2 row-start-1 flex items-center gap-1 self-start justify-self-end',
        className,
      )}
      {...props}
    />
  )
}

function CardContent({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot='card-content'
      className={cn('min-w-0 px-(--surface-padding)', className)}
      {...props}
    />
  )
}

/**
 * What runs to the card's edges: a picture, a list of rows, a table. First or
 * last, it also takes the card's corner. Give a picture its shape with an
 * Aspect ratio inside it, or a class such as `aspect-video`; one inside fills it.
 */
function CardSection({
  className,
  render,
  ...props
}: Omit<PartProps<'div'>, 'className'> & { className?: string }) {
  return renderElement(
    'div',
    mergeProps(
      {
        'data-slot': 'card-section',
        className: cn(
          // Rows meet a header's border, with no gap. `min-h-0` lets an `aspect-*` hold a taller picture to its ratio. Inside the border, its corner is the card's less the border's width.
          'relative min-h-0 min-w-0 overflow-clip [[data-slot=card-header].border-b+&]:-mt-(--surface-gap) first:rounded-t-[calc(var(--surface-radius)-1px)] last:rounded-b-[calc(var(--surface-radius)-1px)] [&>img,&>video]:size-full [&>img,&>video]:object-cover',
          className,
        ),
      },
      props,
    ),
    render,
  )
}

/**
 * Tinted, under a border, as the Dialog's footer is. Last in the card, it
 * reaches the bottom edge, and it meets a section above it. In a linked card,
 * its controls sit above the link's stretched area, as a `CardAction`'s do.
 */
function CardFooter({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot='card-footer'
      className={cn(
        'bg-muted/50 relative z-1 group-has-data-[slot=card-link]/card:pointer-events-none group-has-data-[slot=card-link]/card:[&_:is(a,button,input,select,textarea,[tabindex])]:pointer-events-auto flex [[data-slot=card-section]+&]:-mt-(--surface-gap) min-w-0 items-center gap-2 border-t p-(--surface-padding) last:rounded-b-[calc(var(--surface-radius)-1px)]',
        className,
      )}
      {...props}
    />
  )
}

/**
 * The link a card leads to, around its title's text. Its hit area covers the
 * whole card; a `CardAction` and a `CardFooter` sit above it.
 */
function CardLink({
  className,
  render,
  ...props
}: Omit<PartProps<'a'>, 'className'> & { className?: string }) {
  return renderElement(
    'a',
    mergeProps(
      {
        'data-slot': 'card-link',
        className: cn(
          // Its hit area lies over the card's border box, and draws the card's hover
          // border and focus ring on it, on `press` as the choice cards do.
          'after:absolute after:-inset-px after:z-1 after:rounded-(--surface-radius) after:border after:border-transparent after:transition-[border-color,box-shadow] after:duration-(--motion-press-duration) after:ease-(--motion-press-fade-easing) hover:after:border-muted-foreground/50 focus-visible:outline-hidden focus-visible:after:ring-3 focus-visible:after:ring-ring/50',
          className,
        ),
      },
      props,
    ),
    render,
  )
}

export {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardLink,
  CardSection,
  CardTitle,
}
