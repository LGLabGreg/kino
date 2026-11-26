'use client'

import { Separator } from '@/registry/components/kino/separator'
import {
  followPointer,
  hoveredRowTextClassName,
  itemMatching,
  rowHighlightClassName,
  rowTintClassName,
  tintedRowTextClassName,
} from '@/registry/lib/highlight'
import { mergeProps, type PartProps, renderElement } from '@ui-sdk/react/primitive'
import { cva, type VariantProps } from 'class-variance-authority'
import {
  type ComponentProps,
  createContext,
  type MouseEvent,
  type ReactNode,
  use,
  useEffect,
  useRef,
  useState,
} from 'react'

import { cn } from '@/lib/utils'

/*
 * A row of content: a picture or an icon, a title and a line under it, and
 * actions at the end. One that is a link or a button takes the rows' tint
 * under the pointer, as a Listbox's or a Sidebar's rows do: in a group, one
 * highlight glides from row to row.
 */

const GroupContext = createContext(false)

const itemVariants = cva(
  [
    // A row as wide as its group; a header or a footer takes a line of its own.
    'group/item relative flex min-w-0 flex-wrap items-center rounded-(--list-radius) border border-transparent text-sm',
    '[&_svg]:pointer-events-none [&_svg]:shrink-0',
    'transition-[border-color,box-shadow] duration-(--motion-press-duration) ease-(--motion-press-fade-easing)',
    // Inset, as on the Listbox's and the Sidebar's rows, so a list that scrolls never clips it.
    'focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset focus-visible:outline-hidden',
    'aria-disabled:pointer-events-none aria-disabled:opacity-50 data-disabled:pointer-events-none data-disabled:opacity-50 disabled:pointer-events-none disabled:opacity-50',
    // Muted text in a tinted row is darker, so it keeps 4.5:1 on the tint.
    tintedRowTextClassName,
  ],
  {
    variants: {
      variant: {
        default: '',
        /** A border, for an item that stands on its own. */
        outline: 'border-border',
        /** A muted fill, for an item set apart from what's around it. */
        muted: 'bg-muted/50',
      },
      size: {
        // Less the 1px border, so the content lines up with a card's header beside it.
        default: 'gap-3 p-[calc(var(--surface-padding)-1px)]',
        // As tall as a control with one line of text, as a Sidebar's row is.
        sm: 'gap-2.5 px-[calc(var(--surface-padding)-1px)] py-[calc((var(--control-height)-1lh)/2-1px)]',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
)

/*
 * A lone item that acts takes the highlight's tint under the pointer, over
 * its own fill and border, fading in on `enter` and out on `exit` as the
 * highlight does. In a group, the group's one highlight does it instead.
 */
const loneTintClassName = cn(
  rowTintClassName,
  'pointer-events-none absolute -inset-px rounded-[inherit] opacity-0 [transition:opacity_var(--motion-exit-duration)_var(--motion-exit-easing)] group-hover/item:opacity-100 group-hover/item:[transition:opacity_var(--motion-enter-duration)_var(--motion-enter-easing)]',
  // Only on an item that acts.
  'group-[:not(a[href],button)]/item:hidden',
)

/**
 * A row: a `<div>`, or a link or a button with `render`. In a group it sits
 * in a list item of its own, so the group reads as a list.
 */
function Item({
  className,
  variant,
  size,
  render,
  children,
  onClick,
  ...props
}: Omit<PartProps<'div'>, 'className'> & {
  className?: string
} & VariantProps<typeof itemVariants>) {
  const inGroup = use(GroupContext)
  const item = renderElement(
    'div',
    mergeProps(
      {
        'data-slot': 'item',
        'data-variant': variant ?? 'default',
        'data-size': size ?? 'default',
        className: cn(
          itemVariants({ variant, size }),
          !inGroup && hoveredRowTextClassName,
          className,
        ),
        onClick: (event: MouseEvent<HTMLDivElement>) => {
          // A link can't be disabled: one marked `aria-disabled` still takes focus, so it
          // is read, but Enter and a press do nothing.
          if (event.currentTarget.getAttribute('aria-disabled') === 'true') {
            event.preventDefault()
            return
          }
          onClick?.(event)
        },
        children: inGroup ? (
          children
        ) : (
          <>
            {children}
            <span aria-hidden data-slot='item-tint' className={loneTintClassName} />
          </>
        ),
      },
      props,
    ),
    render,
  )
  if (!inGroup) return item
  return (
    <div role='listitem' data-slot='item-listitem' className='grid min-w-0'>
      {item}
    </div>
  )
}

/**
 * Items read as a list, with one highlight that glides between those that
 * act, under the pointer and with focus.
 */
function ItemGroup({
  className,
  children,
  render,
  ...props
}: Omit<PartProps<'div'>, 'className' | 'children'> & {
  className?: string
  children?: ReactNode
}) {
  const [group, setGroup] = useState<HTMLDivElement | null>(null)
  const layerRef = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    const layer = layerRef.current
    if (!group || !layer) return
    return followPointer(group, layer, {
      itemOf: itemMatching(group, 'a[href][data-slot=item], button[data-slot=item]', {
        rows: '[data-slot=item-listitem]',
      }),
      focus: true,
    })
  }, [group])
  return renderElement(
    'div',
    mergeProps(
      {
        'data-slot': 'item-group',
        ref: setGroup,
        role: 'list',
        className: cn(
          'group/item-group relative isolate flex min-w-0 flex-col',
          className,
        ),
        children: (
          <GroupContext value>
            {children}
            <span
              ref={layerRef}
              aria-hidden
              data-slot='item-highlight'
              className={rowHighlightClassName}
            />
          </GroupContext>
        ),
      },
      props,
    ),
    render,
  )
}

/** A line between items. Decorative: the list already says where each item ends. */
function ItemSeparator({ className, ...props }: ComponentProps<typeof Separator>) {
  return (
    <Separator
      aria-hidden
      data-item-separator=''
      className={cn('my-0', className)}
      {...props}
    />
  )
}

const itemMediaVariants = cva(
  // Level with the title when a description runs under it.
  'flex shrink-0 items-center justify-center gap-2 group-has-data-[slot=item-description]/item:self-start [&_svg]:pointer-events-none',
  {
    variants: {
      variant: {
        /** Whatever it holds, as it is: an avatar, a logo. */
        default: 'bg-transparent',
        /** An icon in a tile. */
        icon: "bg-muted text-foreground size-8 rounded-(--control-radius-sm) border [&_svg:not([class*='size-'])]:size-4",
        /** A picture, cropped to a square. */
        image:
          'size-10 overflow-hidden rounded-(--control-radius-sm) group-data-[size=sm]/item:size-8 [&_img]:size-full [&_img]:object-cover',
      },
    },
    defaultVariants: { variant: 'default' },
  },
)

/** The picture: decorative, since the title names the item. */
function ItemMedia({
  className,
  variant,
  render,
  ...props
}: Omit<PartProps<'div'>, 'className'> & {
  className?: string
} & VariantProps<typeof itemMediaVariants>) {
  return renderElement(
    'div',
    mergeProps(
      {
        'data-slot': 'item-media',
        'data-variant': variant ?? 'default',
        'aria-hidden': true,
        className: cn(itemMediaVariants({ variant }), className),
      },
      props,
    ),
    render,
  )
}

/** The title and the description, taking the room the media and actions leave. */
function ItemContent({
  className,
  render,
  ...props
}: Omit<PartProps<'div'>, 'className'> & { className?: string }) {
  return renderElement(
    'div',
    mergeProps(
      {
        'data-slot': 'item-content',
        className: cn(
          // Never narrower than a short name: below that, the actions wrap onto a line of
          // their own rather than squeeze the text to a letter a line. A second content
          // block, such as a price at the end, keeps its own width.
          'flex min-w-0 grow basis-28 flex-col gap-1 group-data-[size=sm]/item:gap-0.5 [&+[data-slot=item-content]]:flex-none',
          className,
        ),
      },
      props,
    ),
    render,
  )
}

/** A long unbroken word, such as an ID or a URL, breaks rather than run out of the row. */
function ItemTitle({
  className,
  render,
  ...props
}: Omit<PartProps<'div'>, 'className'> & { className?: string }) {
  return renderElement(
    'div',
    mergeProps(
      {
        'data-slot': 'item-title',
        className: cn(
          'flex w-fit max-w-full min-w-0 items-center gap-2 text-sm leading-5 font-medium wrap-anywhere',
          className,
        ),
      },
      props,
    ),
    render,
  )
}

function ItemDescription({
  className,
  render,
  ...props
}: Omit<PartProps<'p'>, 'className'> & { className?: string }) {
  return renderElement(
    'p',
    mergeProps(
      {
        'data-slot': 'item-description',
        className: cn(
          // A small item's line is the small print under a name, as in a list of people.
          'text-muted-foreground *:[a]:hover:text-foreground text-sm leading-5 text-pretty wrap-anywhere group-data-[size=sm]/item:text-xs group-data-[size=sm]/item:leading-4 *:[a]:underline *:[a]:underline-offset-3',
          className,
        ),
      },
      props,
    ),
    render,
  )
}

/** Buttons and controls at the end of the row. */
function ItemActions({
  className,
  render,
  ...props
}: Omit<PartProps<'div'>, 'className'> & { className?: string }) {
  return renderElement(
    'div',
    mergeProps(
      {
        'data-slot': 'item-actions',
        className: cn('flex shrink-0 items-center gap-2', className),
      },
      props,
    ),
    render,
  )
}

/** A line across the whole row, above the rest, such as a picture's. */
function ItemHeader({
  className,
  render,
  ...props
}: Omit<PartProps<'div'>, 'className'> & { className?: string }) {
  return renderElement(
    'div',
    mergeProps(
      {
        'data-slot': 'item-header',
        className: cn('flex basis-full items-center justify-between gap-2', className),
      },
      props,
    ),
    render,
  )
}

/** A line across the whole row, below the rest. */
function ItemFooter({
  className,
  render,
  ...props
}: Omit<PartProps<'div'>, 'className'> & { className?: string }) {
  return renderElement(
    'div',
    mergeProps(
      {
        'data-slot': 'item-footer',
        className: cn('flex basis-full items-center justify-between gap-2', className),
      },
      props,
    ),
    render,
  )
}

export {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemFooter,
  ItemGroup,
  ItemHeader,
  ItemMedia,
  ItemSeparator,
  ItemTitle,
  itemMediaVariants,
  itemVariants,
}
