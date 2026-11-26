'use client'

import { AnimatedNumber } from '@/registry/components/kino/animated-number'
import { buttonVariants } from '@/registry/components/kino/button'
import { IconPlaceholder } from '@/registry/icons/icon-placeholder'
import { announce } from '@/registry/lib/announce'
import { deck } from '@/registry/lib/deck'
import { withoutTransition } from '@/registry/lib/resize'
import type { ChangeDetails } from '@ui-sdk/core'
import type { CarouselPageChangeReason } from '@ui-sdk/core/carousel'
import {
  CarouselContent as CarouselContentPrimitive,
  CarouselIndicatorGroup as CarouselIndicatorGroupPrimitive,
  CarouselIndicator as CarouselIndicatorPrimitive,
  CarouselItem as CarouselItemPrimitive,
  CarouselNext as CarouselNextPrimitive,
  CarouselPrevious as CarouselPreviousPrimitive,
  Carousel as CarouselPrimitive,
  CarouselViewport as CarouselViewportPrimitive,
} from '@ui-sdk/react/carousel'
import { createParts, type PartProps } from '@ui-sdk/react/primitive'
import type { VariantProps } from 'class-variance-authority'
import {
  Children,
  createContext,
  type CSSProperties,
  isValidElement,
  type ReactNode,
  use,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import { cn } from '@/lib/utils'

/*
 * A carousel of slides, moved by a drag, Previous and Next, the indicators
 * and the arrow keys. The track is ui-sdk's Carousel: a row that scrolls
 * natively under a window, a page at a time. The deck stacks the slides as
 * cards and throws the top one off, on the deck primitive. Both take the
 * same props and parts, and page from 1.
 */

type CarouselVariant = 'track' | 'deck'

interface CarouselContextValue {
  variant: CarouselVariant
  loop: boolean
  /** The page in view, from 1. */
  page: number
  /** How many pages there are, or null before the slides are measured. */
  pageCount: number | null
  /** How many slides there are. */
  slides: number
  setSlides: (slides: number) => void
}

const CarouselContext = createContext<CarouselContextValue | null>(null)

function useCarousel() {
  const context = use(CarouselContext)
  if (!context) throw new Error('Carousel parts must be inside <Carousel>.')
  return context
}

/** A Kino part's props: ui-sdk's, with a string class name and plain children. */
type CarouselPartProps<Tag extends 'div' | 'button'> = Omit<
  PartProps<Tag>,
  'className' | 'children' | 'style'
> & {
  className?: string
  children?: ReactNode
  style?: CSSProperties
}

type CarouselProps = Omit<
  CarouselPartProps<'div'>,
  'defaultValue' | 'onChange' | 'render'
> & {
  /** The page in view, from 1. Pass it to control the carousel. */
  page?: number
  defaultPage?: number
  /** Called when the page wants to change, with why in `details.reason`; `details.cancel()` stays. */
  onPageChange?: (page: number, details: ChangeDetails<CarouselPageChangeReason>) => void
  /** Whether the last page goes on to the first. The deck always does. */
  loop?: boolean
  /** `track` scrolls a row along; `deck` stacks the slides as cards. */
  variant?: CarouselVariant
}

function Carousel({
  variant = 'track',
  page,
  defaultPage,
  onPageChange,
  loop = false,
  className,
  children,
  ...props
}: CarouselProps) {
  const [slides, setSlides] = useState(0)
  const scope = (state: { page: number; pageCount: number | null }) => (
    <CarouselScope
      variant={variant}
      loop={loop || variant === 'deck'}
      page={state.page}
      pageCount={state.pageCount}
      slides={slides}
      setSlides={setSlides}
    >
      {children}
    </CarouselScope>
  )
  const rootClassName = cn(
    'group/carousel relative flex min-w-0 flex-col gap-(--surface-gap)',
    className,
  )
  if (variant === 'deck') {
    return (
      <DeckRoot
        data-variant='deck'
        page={page}
        defaultPage={defaultPage}
        onPageChange={onPageChange}
        className={rootClassName}
        {...props}
      >
        {scope}
      </DeckRoot>
    )
  }
  return (
    <CarouselPrimitive
      data-variant='track'
      page={page}
      defaultPage={defaultPage}
      onPageChange={onPageChange}
      loop={loop}
      // A page is as many slides as show, so Next moves a whole view.
      slidesPerPage='auto'
      className={rootClassName}
      {...props}
    >
      {scope}
    </CarouselPrimitive>
  )
}

/** Shares the carousel's state with its parts; the deck also says which card is on top once it changes. */
function CarouselScope({
  children,
  variant,
  loop,
  page,
  pageCount,
  slides,
  setSlides,
}: CarouselContextValue & { children: ReactNode }) {
  const value = useMemo(
    () => ({ variant, loop, page, pageCount, slides, setSlides }),
    [variant, loop, page, pageCount, slides, setSlides],
  )
  // ui-sdk's slides are a live region; the deck's cards under the top one are
  // inert, so it says the card that comes up instead. Nothing on load.
  const announced = useRef<number | null>(null)
  useEffect(() => {
    if (variant !== 'deck' || pageCount === null) return
    if (announced.current === null) announced.current = page
    if (announced.current === page) return
    announced.current = page
    announce(`Slide ${page} of ${pageCount}`)
  }, [variant, page, pageCount])
  return <CarouselContext value={value}>{children}</CarouselContext>
}

/*
 * A tab stop while the slides in view hold nothing that takes focus, so the
 * arrow keys reach it: ui-sdk's on the track, the deck's own on the deck. Its
 * outline sits outside, since the slides would cover one inside. The track
 * scrolls, which clips what it holds: room above and below keeps a slide's
 * shadow and focus ring whole.
 */
const viewportClassName =
  'group/carousel-viewport -my-1 scrollbar-none rounded-(--surface-radius) py-1 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-ring/50 data-dragging:select-none'

function CarouselViewport({ className, ...props }: CarouselPartProps<'div'>) {
  const { variant } = useCarousel()
  if (variant === 'deck') {
    return <DeckViewport className={cn(viewportClassName, className)} {...props} />
  }
  return (
    <CarouselViewportPrimitive className={cn(viewportClassName, className)} {...props} />
  )
}

/** Counts the slides for the parts that name pages by them. */
function useSlideCount(count: number) {
  const { setSlides } = useCarousel()
  useLayoutEffect(() => {
    setSlides(count)
  }, [count, setSlides])
}

function CarouselContent({ className, children, ...props }: CarouselPartProps<'div'>) {
  const { variant } = useCarousel()
  const slides = Children.toArray(children)
  useSlideCount(slides.length)
  if (variant === 'deck') {
    return (
      <DeckContent
        className={cn(
          'grid touch-pan-y pb-[calc(var(--carousel-recede,0.75rem)*2)] group-data-dragging/carousel-viewport:select-none',
          className,
        )}
        {...props}
      >
        {slides.map((child, index) => (
          <ItemIndexProvider
            key={keyOf(child, index)}
            index={index}
            count={slides.length}
          >
            {child}
          </ItemIndexProvider>
        ))}
      </DeckContent>
    )
  }
  return (
    <CarouselContentPrimitive className={className} {...props}>
      {children}
    </CarouselContentPrimitive>
  )
}

function CarouselItem({ className, ...props }: CarouselPartProps<'div'>) {
  const { variant } = useCarousel()
  if (variant === 'deck') return <DeckItem className={className} {...props} />
  return (
    <CarouselItemPrimitive className={cn('min-w-0 basis-full', className)} {...props} />
  )
}

type CarouselStepProps = CarouselPartProps<'button'> &
  Pick<VariantProps<typeof buttonVariants>, 'variant' | 'size'>

/** Whether a page holds more than one slide, so Previous and Next move several. */
function severalPerPage(slides: number, pageCount: number | null) {
  return pageCount !== null && pageCount > 0 && slides > pageCount
}

/*
 * The Button's look on ui-sdk's own element, which stays focusable while it
 * is off at an end, so the way back works from it.
 */
function CarouselPrevious({
  className,
  variant = 'outline',
  size = 'icon-sm',
  children,
  ...props
}: CarouselStepProps) {
  const { variant: kind, slides, pageCount } = useCarousel()
  const step = {
    'data-carousel-previous': '',
    'aria-label': severalPerPage(slides, pageCount)
      ? 'Show previous slides'
      : 'Show previous slide',
    className: cn(
      buttonVariants({ variant, size }),
      'rtl:[&_svg]:-scale-x-100',
      className,
    ),
    ...props,
  }
  const icon = children ?? (
    <IconPlaceholder
      lucide='ChevronLeftIcon'
      tabler='IconChevronLeft'
      hugeicons='ArrowLeft01Icon'
      phosphor='CaretLeftIcon'
      remixicon='RiArrowLeftSLine'
      aria-hidden
    />
  )
  return kind === 'deck' ? (
    <DeckPrevious {...step}>{icon}</DeckPrevious>
  ) : (
    <CarouselPreviousPrimitive {...step}>{icon}</CarouselPreviousPrimitive>
  )
}

function CarouselNext({
  className,
  variant = 'outline',
  size = 'icon-sm',
  children,
  ...props
}: CarouselStepProps) {
  const { variant: kind, slides, pageCount } = useCarousel()
  const step = {
    'data-carousel-next': '',
    'aria-label': severalPerPage(slides, pageCount)
      ? 'Show next slides'
      : 'Show next slide',
    className: cn(
      buttonVariants({ variant, size }),
      'rtl:[&_svg]:-scale-x-100',
      className,
    ),
    ...props,
  }
  const icon = children ?? (
    <IconPlaceholder
      lucide='ChevronRightIcon'
      tabler='IconChevronRight'
      hugeicons='ArrowRight01Icon'
      phosphor='CaretRightIcon'
      remixicon='RiArrowRightSLine'
      aria-hidden
    />
  )
  return kind === 'deck' ? (
    <DeckNext {...step}>{icon}</DeckNext>
  ) : (
    <CarouselNextPrimitive {...step}>{icon}</CarouselNextPrimitive>
  )
}

/** More pages than this show as a count, "3 / 12", which fits any column. */
const MAX_INDICATORS = 8

/*
 * One indicator per page, each a 24px target. The current page's is longer,
 * so it never shows by colour alone, and it travels to the new page on
 * `layout`. Before the slides are measured, and with one page, the row
 * keeps its height and shows nothing.
 */
function CarouselIndicatorGroup({
  className,
  ...props
}: Omit<CarouselPartProps<'div'>, 'children'>) {
  const { variant, page, pageCount, loop } = useCarousel()
  if (pageCount === null || pageCount < 2) {
    return (
      <div aria-hidden data-carousel-indicators='' className={cn('h-6', className)} />
    )
  }
  if (pageCount > MAX_INDICATORS) {
    return (
      <div
        data-carousel-indicators=''
        className={cn(
          'flex h-6 items-center self-center text-xs font-medium text-muted-foreground tabular-nums',
          className,
        )}
        {...props}
      >
        {/* ui-sdk's live region, or the deck's announcement, says where it is; this is for the eye. */}
        <span aria-hidden className='flex items-center gap-1'>
          <AnimatedNumber value={page} locale='en-US' className='text-foreground' />
          <span>/</span>
          <span>{pageCount}</span>
        </span>
      </div>
    )
  }
  const group = {
    'aria-label': 'Slides',
    className: cn('relative flex h-6 min-w-0 items-center self-center', className),
    ...props,
  }
  const indicators = (
    <>
      {Array.from({ length: pageCount }, (_, index) => (
        <CarouselIndicator key={index} page={index + 1} />
      ))}
      <IndicatorPill page={page} pageCount={pageCount} loop={loop} />
    </>
  )
  return variant === 'deck' ? (
    <DeckIndicatorGroup {...group}>{indicators}</DeckIndicatorGroup>
  ) : (
    <CarouselIndicatorGroupPrimitive {...group}>
      {indicators}
    </CarouselIndicatorGroupPrimitive>
  )
}

/** An indicator's name: the slide it shows, or the page when a page holds several. */
function indicatorLabel(page: number, pageCount: number, slides: number) {
  return slides > pageCount
    ? `Show page ${page} of ${pageCount}`
    : `Show slide ${page} of ${pageCount}`
}

function CarouselIndicator({
  page,
  className,
  ...props
}: Omit<CarouselPartProps<'button'>, 'children'> & {
  /** The page it shows and goes to, from 1. */
  page: number
}) {
  const { variant, pageCount, slides } = useCarousel()
  const indicator = {
    'aria-label': indicatorLabel(page, pageCount ?? page, slides),
    className: cn(
      'group/indicator flex size-6 shrink-0 items-center justify-center rounded-full focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-hidden',
      className,
    ),
    ...props,
  }
  const dot = (
    <span className='size-1.5 rounded-full bg-foreground/50 transition-colors duration-(--motion-press-duration) ease-(--motion-press-fade-easing) group-hover/indicator:bg-foreground/75 forced-colors:bg-[CanvasText]' />
  )
  return variant === 'deck' ? (
    <DeckIndicator page={page} {...indicator}>
      {dot}
    </DeckIndicator>
  ) : (
    <CarouselIndicatorPrimitive page={page} {...indicator}>
      {dot}
    </CarouselIndicatorPrimitive>
  )
}

/** Whether going from page `from` to `to` goes round the end of a loop, where the indicator jumps rather than sweep back across every dot. */
function wrapsRound(from: number, to: number, pageCount: number, loop: boolean) {
  return loop && pageCount > 2 && Math.abs(to - from) === pageCount - 1
}

/** The current page's mark, which travels between the indicators. */
function IndicatorPill({
  page,
  pageCount,
  loop,
}: {
  page: number
  pageCount: number
  loop: boolean
}) {
  const ref = useRef<HTMLSpanElement>(null)
  const [first] = useState(page)
  const shown = useRef(page)
  useLayoutEffect(() => {
    const pill = ref.current
    const from = shown.current
    shown.current = page
    if (!pill || from === page) return
    const write = () => pill.style.setProperty('--carousel-page-index', `${page - 1}`)
    if (wrapsRound(from, page, pageCount, loop)) withoutTransition(pill, write)
    else write()
  }, [page, pageCount, loop])
  return (
    <span
      ref={ref}
      aria-hidden
      data-carousel-indicator=''
      style={{ '--carousel-page-index': first - 1 } as CSSProperties}
      className='pointer-events-none absolute start-0 top-0 flex size-6 items-center justify-center [translate:calc(var(--carousel-page-index,0)*100%)_0] transition-[translate] duration-[calc(var(--motion-layout-duration)*var(--carousel-swipe-strength,1))] ease-(--motion-layout-easing) motion-reduce:transition-none rtl:[translate:calc(var(--carousel-page-index,0)*-100%)_0]'
    >
      <span className='h-1.5 w-4 rounded-full bg-foreground forced-colors:bg-[Highlight]' />
    </span>
  )
}

/*
 * Deck: the slides are a stack of cards, the next two showing under the one
 * on top. The top card follows a drag and tilts with it; let go far or fast
 * enough, it is thrown off and goes to the bottom of the deck while the rest
 * step up. Previous brings the last card back from the side it left. The
 * deck primitive holds which card is on top, and moves them as it changes.
 */

const ItemIndexContext = createContext({ index: 0, count: 0 })

/** Gives each card its place, so it knows its depth and names itself "3 of 8" from the first render. */
function ItemIndexProvider({
  index,
  count,
  children,
}: {
  index: number
  count: number
  children: ReactNode
}) {
  const place = useMemo(() => ({ index, count }), [index, count])
  return <ItemIndexContext value={place}>{children}</ItemIndexContext>
}

/** A slide's own key, which `Children.toArray` made unique, so a card keeps its place as others come and go. */
function keyOf(child: ReactNode, index: number) {
  return isValidElement(child) && child.key !== null ? child.key : index
}

/** The deck primitive's parts, each on the element ui-sdk's Carousel uses for it. */
const DeckParts = createParts(deck, {
  root: 'div',
  viewport: 'div',
  content: 'div',
  item: 'div',
  previous: 'button',
  next: 'button',
  'indicator-group': 'div',
  indicator: 'button',
})

const DeckRoot = DeckParts.Root
const DeckViewport = DeckParts.Viewport
const DeckContent = DeckParts.Content
const DeckPrevious = DeckParts.Previous
const DeckNext = DeckParts.Next
const DeckIndicatorGroup = DeckParts.IndicatorGroup
const DeckIndicator = DeckParts.Indicator

function DeckItem({ className, ...props }: CarouselPartProps<'div'>) {
  const { index, count } = use(ItemIndexContext)
  return (
    <DeckParts.Item
      index={index}
      count={count}
      className={cn(
        // Cards under the top one step back and peek out below it; while the
        // top one is dragged off, they step up towards their next place.
        'z-(--carousel-z) min-w-0 origin-bottom [grid-area:1/1] [--carousel-step:max(0,calc(var(--carousel-depth)-var(--carousel-swipe-progress,0)))] [translate:0_calc(var(--carousel-step)*var(--carousel-recede,0.75rem))] [scale:calc(1-var(--carousel-step)*var(--carousel-recede-scale,0.05))] [opacity:clamp(0,calc(3-var(--carousel-step)),1)]',
        // The drag moves the top card on `transform`, which follows the pointer
        // at once, while its place in the deck keeps settling on `layout`.
        '[transform:translateX(var(--carousel-drag-x,0px))_rotate(calc(var(--carousel-drag-share,0)*var(--carousel-tilt,8deg)))]',
        '[transition:translate_var(--motion-layout-duration)_var(--motion-layout-easing),scale_var(--motion-layout-duration)_var(--motion-layout-easing),rotate_var(--motion-layout-duration)_var(--motion-layout-easing),opacity_var(--motion-layout-duration)_var(--motion-layout-easing),transform_var(--motion-layout-duration)_var(--motion-layout-easing)] motion-safe:group-data-dragging/carousel-viewport:[transition:translate_var(--motion-layout-duration)_var(--motion-layout-easing),scale_var(--motion-layout-duration)_var(--motion-layout-easing),rotate_var(--motion-layout-duration)_var(--motion-layout-easing),opacity_var(--motion-layout-duration)_var(--motion-layout-easing)] motion-reduce:[transition:opacity_var(--motion-layout-duration)_var(--motion-layout-easing)]',
        // Thrown, it leaves sideways and fades, above the rest, sooner the faster
        // it was flicked; with less motion, it fades where it was let go.
        'data-thrown:z-50 data-thrown:[translate:calc(var(--carousel-throw,-1)*var(--carousel-slide,60%))_0] data-thrown:[rotate:calc(var(--carousel-throw,-1)*var(--carousel-tilt,8deg))] data-thrown:[scale:1] data-thrown:opacity-0 data-thrown:duration-[calc(var(--motion-exit-duration)*var(--carousel-swipe-strength,1))] data-thrown:ease-(--motion-exit-easing) motion-reduce:data-thrown:[translate:0_0] motion-reduce:data-thrown:[rotate:0deg]',
        className,
      )}
      {...props}
    />
  )
}

export {
  Carousel,
  CarouselContent,
  CarouselIndicator,
  CarouselIndicatorGroup,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
  CarouselViewport,
  indicatorLabel,
  severalPerPage,
  wrapsRound,
}
export type { CarouselProps, CarouselVariant }
