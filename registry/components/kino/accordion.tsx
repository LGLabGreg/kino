'use client'

import { IconPlaceholder } from '@/registry/icons/icon-placeholder'
import {
  collapseClassName,
  followPanelContent,
  runningTransitions,
} from '@/registry/lib/resize'
import { scrollerOf } from '@/registry/lib/scroll'
import { Accordion as AccordionPrimitive } from '@base-ui/react/accordion'
import { cva } from 'class-variance-authority'
import {
  type ComponentProps,
  createContext,
  type MouseEvent,
  use,
  useEffect,
  useRef,
} from 'react'

import { cn } from '@/lib/utils'

type AccordionVariant = 'default' | 'card'

/** Each part reads its accordion's variant here, so one nested in a panel keeps its own. */
const AccordionVariantContext = createContext<AccordionVariant>('default')

/** Frames with nothing moving before the pressed trigger is let go. */
const SETTLE_FRAMES = 4
/** The room left above a trigger held at the top edge, so its focus ring and its card's border show. */
const EDGE_GAP_PX = 8

/**
 * Keeps the trigger that was pressed on screen. With one item open at a time,
 * opening an item closes the one above it, and a tall one takes the pressed
 * trigger up and out of view. The trigger rides up to the top edge and waits
 * there while the page scrolls under it. The edge is lowered by the scroller's
 * `scroll-padding-top` and the trigger's `scroll-margin-top`, for a sticky
 * header.
 */
function keepPressedTriggerInView(event: MouseEvent<HTMLElement>) {
  const root = event.currentTarget
  const trigger =
    event.target instanceof Element
      ? event.target.closest<HTMLElement>('[data-slot=accordion-trigger]')
      : null
  if (!trigger || trigger.closest('[data-slot=accordion]') !== root) return
  const scroller = scrollerOf(root)
  const edge =
    (scroller ? scroller.getBoundingClientRect().top : 0) +
    (Number.parseFloat(
      getComputedStyle(scroller ?? document.documentElement).scrollPaddingTop,
    ) || 0) +
    (Number.parseFloat(getComputedStyle(trigger).scrollMarginTop) || 0) +
    EDGE_GAP_PX
  // A trigger already cut by the edge when pressed stays where it is.
  const line = Math.min(trigger.getBoundingClientRect().top, edge)
  let quiet = 0
  const frame = () => {
    if (!trigger.isConnected) return
    const over = trigger.getBoundingClientRect().top - line
    if (over < -0.5) (scroller ?? window).scrollBy({ top: over, behavior: 'instant' })
    const moving =
      runningTransitions(root, { property: 'height', subtree: true }).length > 0
    quiet = moving ? 0 : quiet + 1
    if (quiet < SETTLE_FRAMES) requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)
}

function Accordion({
  className,
  variant = 'default',
  onClick,
  ...props
}: Omit<AccordionPrimitive.Root.Props, 'className'> & { className?: string } & {
  variant?: AccordionVariant
}) {
  return (
    <AccordionVariantContext value={variant}>
      <AccordionPrimitive.Root
        data-slot='accordion'
        data-variant={variant}
        className={cn('flex w-full min-w-0 flex-col', className)}
        onClick={(event) => {
          onClick?.(event)
          keepPressedTriggerInView(event)
        }}
        {...props}
      />
    </AccordionVariantContext>
  )
}

// A card item says through variables what its card looks like: which corners are round,
// whether its shadow shows, and whether it shares its top border with the card above.
// The gap is the height of a spacer before the card, so the items around it move on the
// same transition as the panel.
const accordionItemVariants = cva('min-w-0', {
  variants: {
    variant: {
      default: 'border-b last:border-b-0',
      card: 'relative flex flex-col [--accordion-card-bottom:0px] [--accordion-card-lift:0] [--accordion-card-overlap:-1px] [--accordion-card-top:0px] before:block before:h-0 before:shrink-0 before:transition-[height] before:duration-(--motion-layout-duration) before:ease-(--motion-layout-easing) first:[--accordion-card-overlap:0px] first:[--accordion-card-top:var(--surface-radius)] last:[--accordion-card-bottom:var(--surface-radius)] has-[+[data-slot=accordion-item][data-open]]:[--accordion-card-bottom:var(--surface-radius)] data-open:z-10 data-open:[--accordion-card-bottom:var(--surface-radius)] data-open:[--accordion-card-lift:1] data-open:[--accordion-card-top:var(--surface-radius)] not-first:data-open:before:h-[calc(var(--accordion-gap,--spacing(2))+1px)] motion-reduce:before:transition-none [[data-slot=accordion-item][data-open]+&]:[--accordion-card-top:var(--surface-radius)] [[data-slot=accordion-item][data-open]+&]:before:h-[calc(var(--accordion-gap,--spacing(2))+1px)]',
    },
  },
  defaultVariants: { variant: 'default' },
})

function AccordionItem({
  className,
  children,
  ...props
}: Omit<AccordionPrimitive.Item.Props, 'className'> & { className?: string }) {
  const variant = use(AccordionVariantContext)
  return (
    <AccordionPrimitive.Item
      data-slot='accordion-item'
      className={cn(accordionItemVariants({ variant }), className)}
      {...props}
    >
      {variant === 'card' ? (
        <div
          data-slot='accordion-card'
          // The shadow is a layer of its own that fades in, so nothing is painted again while it shows.
          className='bg-card text-card-foreground relative mt-(--accordion-card-overlap) min-w-0 rounded-t-(--accordion-card-top) rounded-b-(--accordion-card-bottom) border transition-[border-radius] duration-(--motion-layout-duration) ease-(--motion-layout-easing) after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] after:opacity-(--accordion-card-lift) after:shadow-md after:transition-opacity after:duration-(--motion-layout-duration) after:ease-(--motion-layout-easing) has-focus-visible:z-10 motion-reduce:transition-none'
        >
          {children}
        </div>
      ) : (
        children
      )}
    </AccordionPrimitive.Item>
  )
}

const accordionTriggerVariants = cva(
  "group/accordion-trigger text-foreground focus-visible:ring-ring/50 flex min-w-0 flex-1 items-start gap-3 text-start text-sm font-medium wrap-anywhere transition-[color,background-color,box-shadow] duration-(--motion-press-duration) ease-(--motion-press-fade-easing) focus-visible:ring-3 focus-visible:outline-hidden data-disabled:text-foreground/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&>svg]:mt-0.5",
  {
    variants: {
      variant: {
        default: 'rounded-(--control-radius-capped) py-(--row-padding)',
        // A card's rows are 2px tighter than flat rows, at every density.
        card: 'not-data-panel-open:not-data-disabled:hover:bg-muted/60 rounded-[inherit] px-(--surface-padding) py-[calc(var(--row-padding)_-_2px)]',
      },
    },
    defaultVariants: { variant: 'default' },
  },
)

const accordionIndicator =
  'text-muted-foreground group-hover/accordion-trigger:text-foreground group-data-disabled/accordion-trigger:text-foreground/30 ms-auto'

// The indicator turns with the panel, so the two end together.
const accordionIndicatorTurn =
  'origin-center transition-[rotate] duration-(--motion-layout-duration) ease-(--motion-layout-easing) group-data-panel-open/accordion-trigger:rotate-180 motion-reduce:transition-none'

function AccordionTrigger({
  className,
  children,
  ...props
}: Omit<AccordionPrimitive.Trigger.Props, 'className'> & {
  className?: string
}) {
  const variant = use(AccordionVariantContext)
  return (
    <AccordionPrimitive.Header className='flex min-w-0 rounded-[inherit]'>
      <AccordionPrimitive.Trigger
        data-slot='accordion-trigger'
        className={cn(accordionTriggerVariants({ variant }), className)}
        {...props}
      >
        {children}
        {variant === 'card' ? (
          // A plus whose upright bar lies down into a minus, both bars turning the same way.
          <svg
            data-slot='accordion-indicator'
            aria-hidden
            viewBox='0 0 16 16'
            fill='none'
            stroke='currentColor'
            strokeWidth='1.5'
            strokeLinecap='round'
            className={cn(
              accordionIndicator,
              'transition-[color] duration-(--motion-press-duration) ease-(--motion-press-fade-easing)',
            )}
          >
            <path d='M3.5 8h9' className={accordionIndicatorTurn} />
            <path d='M3.5 8h9' className={cn(accordionIndicatorTurn, 'rotate-90')} />
          </svg>
        ) : (
          <IconPlaceholder
            lucide='ChevronDownIcon'
            tabler='IconChevronDown'
            hugeicons='ArrowDown01Icon'
            phosphor='CaretDownIcon'
            remixicon='RiArrowDownSLine'
            data-slot='accordion-indicator'
            aria-hidden
            className={cn(
              accordionIndicator,
              'transition-[color,rotate] duration-(--motion-layout-duration) ease-[var(--motion-layout-fade-easing),var(--motion-layout-easing)] group-data-panel-open/accordion-trigger:rotate-180 motion-reduce:transition-[color] motion-reduce:ease-(--motion-layout-fade-easing)',
            )}
          />
        )}
      </AccordionPrimitive.Trigger>
    </AccordionPrimitive.Header>
  )
}

// The panel's states reach only its own content, so an accordion nested in it keeps its own.
const accordionPanelVariants = cva(
  cn(collapseClassName, 'text-sm [--collapse-height:var(--accordion-panel-height)]'),
  {
    variants: {
      variant: {
        // Clipped down the page only, so a focus ring inside keeps its sides.
        // It keeps a ring's width (3px) above the first row and starts that
        // much higher, so a focused control there keeps its whole ring and
        // nothing moves; shut, the 3px and the pull cancel out.
        default: '-mt-0.75 overflow-y-clip pt-0.75',
        card: '-mt-0.75 overflow-clip rounded-b-[inherit] pt-0.75',
      },
    },
    defaultVariants: { variant: 'default' },
  },
)

const accordionContentVariants = cva('text-muted-foreground wrap-break-word', {
  variants: {
    variant: {
      default: 'pb-(--row-padding)',
      card: 'px-(--surface-padding) pb-(--surface-padding)',
    },
  },
  defaultVariants: { variant: 'default' },
})

/**
 * The content's own box. It mounts with the panel. Base UI sizes the panel
 * while it opens and closes, and leaves it at `auto` once open, so content
 * that grows or shrinks after that would jump: this moves the panel to the
 * new height on the same transition.
 */
function AccordionContentInner(props: ComponentProps<'div'>) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const inner = ref.current
    const panel = inner?.parentElement
    if (!inner || !panel) return
    return followPanelContent(panel, inner, '--accordion-panel-height')
  }, [])

  return <div ref={ref} data-slot='accordion-content-inner' {...props} />
}

/**
 * `className` goes on the content's own box, the one with the padding; the
 * other props go to Base UI's panel.
 */
function AccordionContent({
  className,
  children,
  ...props
}: Omit<AccordionPrimitive.Panel.Props, 'className'> & { className?: string }) {
  const variant = use(AccordionVariantContext)
  return (
    <AccordionPrimitive.Panel
      data-slot='accordion-content'
      className={accordionPanelVariants({ variant })}
      {...props}
    >
      <AccordionContentInner
        className={cn(accordionContentVariants({ variant }), className)}
      >
        {children}
      </AccordionContentInner>
    </AccordionPrimitive.Panel>
  )
}

export { Accordion, AccordionItem, AccordionTrigger, AccordionContent }
