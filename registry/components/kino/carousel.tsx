'use client'

import { AnimatedNumber } from '@/registry/components/kino/animated-number'
import { Button } from '@/registry/components/kino/button'
import { IconPlaceholder } from '@/registry/icons/icon-placeholder'
import { useAnnouncer } from '@/registry/lib/announce'
import { mergeRefs } from '@/registry/lib/refs'
import { withoutTransition } from '@/registry/lib/resize'
import {
  followSwipe,
  projectedOffset,
  rubberBand,
  swipeStrength,
} from '@/registry/lib/swipe'
import { useDirection } from '@base-ui/react/direction-provider'
import {
  Children,
  type ComponentProps,
  createContext,
  isValidElement,
  type CSSProperties,
  type FocusEvent,
  type KeyboardEvent,
  type ReactNode,
  use,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import { cn } from '@/lib/utils'

/*
 * A carousel of slides, moved by a drag, Previous and Next, the dots and the
 * arrow keys. The track variant slides a row along under a window; the deck
 * variant stacks the slides as cards and throws the top one off.
 */

type CarouselVariant = 'track' | 'deck'

interface Geometry {
  /** How many slides there are. */
  count: number
  /** How many slides can come first in view: the last few can't, once the row ends. */
  leadCount: number
  /** How many slides fit in view at once. */
  perView: number
}

interface CarouselContextValue extends Geometry {
  variant: CarouselVariant
  /** The first slide in view. */
  value: number
  pages: number[]
  loop: boolean
  rtl: boolean
  /** Shows `index` first, wrapping round when the carousel loops. */
  go: (index: number) => void
  setGeometry: (geometry: Geometry) => void
}

const CarouselContext = createContext<CarouselContextValue | null>(null)

function useCarousel() {
  const context = use(CarouselContext)
  if (!context) throw new Error('Carousel parts must be inside <Carousel>.')
  return context
}

const ItemIndexContext = createContext({ index: 0, count: 0 })

/** The slide this element is, counted from 0, and how many there are. */
function useItemIndex() {
  return use(ItemIndexContext)
}

/** Gives each child of a carousel's content its place, so it can name itself "3 of 8" from the first render. */
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

type CarouselProps = Omit<ComponentProps<'div'>, 'defaultValue' | 'onChange'> & {
  /** The first slide in view, counted from 0. */
  value?: number
  defaultValue?: number
  onValueChange?: (value: number) => void
  /** Whether the last slide goes on to the first. The deck always does. */
  loop?: boolean
  /** `track` slides a row along; `deck` stacks the slides as cards. */
  variant?: CarouselVariant
}

function Carousel({
  variant = 'track',
  className,
  value: valueProp,
  defaultValue = 0,
  onValueChange,
  loop: loopProp = false,
  onKeyDown,
  style,
  children,
  ...props
}: CarouselProps) {
  const rtl = useDirection() === 'rtl'
  const loop = loopProp || variant === 'deck'
  const [own, setOwn] = useState(defaultValue)
  const [geometry, setGeometryState] = useState<Geometry>({
    count: 0,
    leadCount: 1,
    perView: 1,
  })
  // Until the slides are measured, the value asked for stands.
  const asked = valueProp ?? own
  const value =
    geometry.count === 0 ? asked : Math.min(asked, Math.max(0, geometry.leadCount - 1))
  const pages = useMemo(
    () => slidePages(geometry.leadCount, geometry.perView),
    [geometry.leadCount, geometry.perView],
  )

  const valueRef = useRef(value)
  useLayoutEffect(() => {
    valueRef.current = value
  })
  const go = useCallback(
    (index: number) => {
      const next = wrapIndex(index, geometry.leadCount, loop)
      if (next === valueRef.current) return
      setOwn(next)
      onValueChange?.(next)
    },
    [geometry.leadCount, loop, onValueChange],
  )

  const setGeometry = useCallback((next: Geometry) => {
    setGeometryState((now) =>
      now.count === next.count &&
      now.leadCount === next.leadCount &&
      now.perView === next.perView
        ? now
        : next,
    )
  }, [])

  // What a screen reader hears once the view changes; nothing on load.
  const { announce, region } = useAnnouncer()
  const announced = useRef<number | null>(null)
  useEffect(() => {
    if (geometry.count === 0) return
    // The first measured view, even one clamped from the value asked for, is the load.
    if (announced.current === null) announced.current = value
    if (announced.current === value) return
    announced.current = value
    announce(viewLabel(value, geometry.perView, geometry.count))
  }, [value, geometry.perView, geometry.count, announce])

  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    onKeyDown?.(event)
    if (!(event.target instanceof Element)) return
    // Only the carousel's own controls take the arrow keys: in a slide, or
    // in a field or list of the buyer's beside them, they belong to what is there.
    // Base UI blocks every key on a button that is off but keeps focus, as
    // Previous and Next are at the ends, so the way back works through that.
    const control = event.target.closest(
      '[data-slot=carousel-previous], [data-slot=carousel-next], [data-slot=carousel-dot]',
    )
    if (!control || control.closest('[data-slot=carousel]') !== event.currentTarget)
      return
    const forward = rtl ? 'ArrowLeft' : 'ArrowRight'
    const back = rtl ? 'ArrowRight' : 'ArrowLeft'
    if (event.key !== forward && event.key !== back) return
    event.preventDefault()
    const step = event.key === forward ? nextLead : previousLead
    go(step(value, pages, loop ? geometry.leadCount : 0))
  }

  const context = useMemo<CarouselContextValue>(
    () => ({ ...geometry, variant, value, pages, loop, rtl, go, setGeometry }),
    [geometry, variant, value, pages, loop, rtl, go, setGeometry],
  )

  // The dots' indicator starts on the page asked for, before it is measured.
  const [startPage] = useState(() => valueProp ?? defaultValue)

  return (
    <CarouselContext value={context}>
      {/* oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- the arrow keys of the controls and slides inside bubble up to it. */}
      <div
        role='region'
        aria-roledescription='carousel'
        data-slot='carousel'
        data-variant={variant}
        onKeyDown={keyDown}
        style={{ '--carousel-page': startPage, ...style } as CSSProperties}
        className={cn(
          'group/carousel relative flex min-w-0 flex-col gap-(--surface-gap)',
          className,
        )}
        {...props}
      >
        {children}
        {region}
      </div>
    </CarouselContext>
  )
}

function CarouselPrevious({
  className,
  variant = 'outline',
  size = 'icon-sm',
  onClick,
  ...props
}: ComponentProps<typeof Button>) {
  const { value, pages, loop, count, leadCount, perView, go } = useCarousel()
  const disabled = controlsOff(value, count, leadCount, loop).previous
  return (
    <Button
      data-slot='carousel-previous'
      variant={variant}
      size={size}
      aria-label={perView > 1 ? 'Show previous slides' : 'Show previous slide'}
      disabled={disabled}
      focusableWhenDisabled
      onClick={(event) => {
        onClick?.(event)
        if (!event.defaultPrevented) go(previousLead(value, pages, loop ? leadCount : 0))
      }}
      className={cn('rtl:[&_svg]:-scale-x-100', className)}
      {...props}
    >
      <IconPlaceholder
        lucide='ChevronLeftIcon'
        tabler='IconChevronLeft'
        hugeicons='ArrowLeft01Icon'
        phosphor='CaretLeftIcon'
        remixicon='RiArrowLeftSLine'
        aria-hidden
      />
    </Button>
  )
}

function CarouselNext({
  className,
  variant = 'outline',
  size = 'icon-sm',
  onClick,
  ...props
}: ComponentProps<typeof Button>) {
  const { value, pages, loop, count, leadCount, perView, go } = useCarousel()
  const disabled = controlsOff(value, count, leadCount, loop).next
  return (
    <Button
      data-slot='carousel-next'
      variant={variant}
      size={size}
      aria-label={perView > 1 ? 'Show next slides' : 'Show next slide'}
      disabled={disabled}
      focusableWhenDisabled
      onClick={(event) => {
        onClick?.(event)
        if (!event.defaultPrevented) go(nextLead(value, pages, loop ? leadCount : 0))
      }}
      className={cn('rtl:[&_svg]:-scale-x-100', className)}
      {...props}
    >
      <IconPlaceholder
        lucide='ChevronRightIcon'
        tabler='IconChevronRight'
        hugeicons='ArrowRight01Icon'
        phosphor='CaretRightIcon'
        remixicon='RiArrowRightSLine'
        aria-hidden
      />
    </Button>
  )
}

/** More pages than this show as a count, "3 / 12", which fits any column. */
const MAX_DOTS = 8

/*
 * One dot per page, each a 24px target. The current page's dot is longer, so
 * it never shows by colour alone, and it travels with the slides: it follows
 * a drag or a scroll exactly, and settles on `layout` with them.
 */
function CarouselDots({ className, ...props }: Omit<ComponentProps<'div'>, 'children'>) {
  const { value, pages, count, perView, go } = useCarousel()
  const current = pageOf(value, pages)
  const groupRef = useRef<HTMLDivElement>(null)

  // A dot keeps focus on the page it shows, when keys or a scroll change it.
  useLayoutEffect(() => {
    const group = groupRef.current
    if (!group || !group.contains(document.activeElement)) return
    const dot = group.querySelectorAll<HTMLElement>('[data-slot=carousel-dot]')[current]
    if (dot && dot !== document.activeElement) dot.focus()
  }, [current])

  if (pages.length > MAX_DOTS) {
    return (
      <div
        data-slot='carousel-dots'
        className={cn(
          'flex h-6 items-center self-center text-xs font-medium text-muted-foreground tabular-nums',
          className,
        )}
        {...props}
      >
        {/* The live region says where it is; this is for the eye. */}
        <span aria-hidden className='flex items-center gap-1'>
          <AnimatedNumber
            value={current + 1}
            locale='en-US'
            className='text-foreground'
          />
          <span>/</span>
          <span>{pages.length}</span>
        </span>
      </div>
    )
  }

  return (
    <div
      ref={groupRef}
      role='group'
      aria-label='Slides'
      data-slot='carousel-dots'
      className={cn('relative flex h-6 min-w-0 items-center self-center', className)}
      {...props}
    >
      {count > 0 && pages.length > 1
        ? pages.map((lead, page) => (
            <button
              key={lead}
              type='button'
              data-slot='carousel-dot'
              aria-label={`Show ${viewLabel(lead, perView, count).replace(/^S/, 's')}`}
              aria-current={page === current || undefined}
              tabIndex={page === current ? 0 : -1}
              onClick={() => go(lead)}
              className='group/dot flex size-6 shrink-0 items-center justify-center rounded-full focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-hidden'
            >
              <span className='size-1.5 rounded-full bg-foreground/50 transition-colors duration-(--motion-press-duration) ease-(--motion-press-fade-easing) group-hover/dot:bg-foreground/75 forced-colors:bg-[CanvasText]' />
            </button>
          ))
        : null}
      {count > 0 && pages.length > 1 ? (
        <span
          aria-hidden
          data-slot='carousel-indicator'
          className='pointer-events-none absolute start-0 top-0 flex size-6 items-center justify-center [translate:calc(var(--carousel-page,0)*100%)_0] transition-[translate] duration-[calc(var(--motion-layout-duration)*var(--carousel-swipe-strength,1))] ease-(--motion-layout-easing) group-data-following/carousel:duration-0 motion-reduce:transition-none rtl:[translate:calc(var(--carousel-page,0)*-100%)_0]'
        >
          <span className='h-1.5 w-4 rounded-full bg-foreground forced-colors:bg-[Highlight]' />
        </span>
      ) : null}
    </div>
  )
}

function CarouselContent(props: ComponentProps<'div'>) {
  const { variant } = useCarousel()
  return variant === 'deck' ? <DeckContent {...props} /> : <TrackContent {...props} />
}

function CarouselItem(props: ComponentProps<'div'>) {
  const { variant } = useCarousel()
  return variant === 'deck' ? <DeckItem {...props} /> : <TrackItem {...props} />
}

/*
 * Track: the slides sit in a row that slides along under a window. A drag
 * moves the row with the pointer, the ends give a little and pull back, and
 * a flick throws it on by as many slides as its speed carries, settling on
 * `layout` sooner the faster it went, as a Drawer does.
 */
function TrackContent({ ref, className, children, ...props }: ComponentProps<'div'>) {
  const { value, rtl, go, setGeometry } = useCarousel()
  const viewportRef = useRef<HTMLDivElement>(null)
  const rowRef = useRef<HTMLDivElement>(null)
  const leads = useRef<number[]>([0])
  const pages = useRef<number[]>([0])
  const offset = useRef(0)
  const strength = useRef(1)
  const current = useRef({ value, go })
  useLayoutEffect(() => {
    current.current = { value, go }
  })
  const slides = Children.toArray(children)
  const count = slides.length

  // Writes the row's place, in pixels from its start, and the dots' page.
  const place = (to: number, instant: boolean) => {
    const row = rowRef.current
    const root = row && carouselOf(row)
    if (!root || !row) return
    offset.current = to
    const write = () =>
      placeRow(root, row, to, strength.current, leads.current, pages.current)
    if (instant) atOnce(root, write)
    else write()
  }
  const placeRef = useRef(place)
  useLayoutEffect(() => {
    placeRef.current = place
  })

  useLayoutEffect(() => {
    const viewport = viewportRef.current
    const row = rowRef.current
    if (!viewport || !row) return
    const measure = () => {
      // Measured, the slides before the first in view come back, to be placed.
      row.setAttribute('data-measured', '')
      const slides = [...row.children].filter(
        (child): child is HTMLElement => child instanceof HTMLElement,
      )
      const measured = slideLeads(measureSlides(slides, rtl), viewport.clientWidth)
      leads.current = measured.leads
      pages.current = slidePages(measured.leads.length, measured.perView)
      setGeometry({
        count: slides.length,
        leadCount: measured.leads.length,
        perView: measured.perView,
      })
      const lead = Math.min(current.current.value, measured.leads.length - 1)
      placeRef.current(measured.leads[lead] ?? 0, true)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(viewport)
    for (const slide of row.children) observer.observe(slide)
    return () => observer.disconnect()
  }, [rtl, count, setGeometry])

  // A new slide in view: the row slides there on `layout`.
  const shown = useRef(value)
  useLayoutEffect(() => {
    if (shown.current === value) return
    shown.current = value
    placeRef.current(leads.current[value] ?? 0, false)
    strength.current = 1
  }, [value])

  useEffect(() => {
    const viewport = viewportRef.current
    const row = rowRef.current
    const root = row && carouselOf(row)
    if (!viewport || !row || !root) return
    const sign = rtl ? -1 : 1
    let start = 0
    return followSwipe(viewport, {
      onStart: () => {
        // Caught while it settles, it carries on from where it is.
        const moving = Number.parseFloat(getComputedStyle(row).translate) || 0
        start = -moving * sign
        root.setAttribute('data-following', '')
        placeRef.current(start, false)
      },
      onMove: (dx) => {
        const max = leads.current[leads.current.length - 1] ?? 0
        const free = start - dx * sign
        const width = viewport.clientWidth
        const to =
          free < 0
            ? rubberBand(free, width)
            : free > max
              ? max + rubberBand(free - max, width)
              : free
        placeRef.current(to, false)
      },
      onEnd: (_dx, velocity) => {
        const along = -velocity * sign
        const target = nearestLead(leads.current, projectedOffset(offset.current, along))
        const to = leads.current[target] ?? 0
        strength.current = swipeStrength(Math.abs(to - offset.current), along)
        root.removeAttribute('data-following')
        // Back to the slide shown first: a new value, taken, moves it on in
        // the same frame, and one an owner holds back leaves it there.
        placeRef.current(leads.current[current.current.value] ?? 0, false)
        if (target === current.current.value) strength.current = 1
        else current.current.go(target)
      },
    })
  }, [rtl])

  // A slide focused out of view comes into it.
  const revealOnFocus = useRevealOnFocus()
  const focusIn = (event: FocusEvent<HTMLDivElement>) => {
    props.onFocus?.(event)
    revealOnFocus(event)
  }

  return (
    <div
      ref={viewportRef}
      data-slot='carousel-viewport'
      className='touch-pan-y overflow-x-clip group-data-following/carousel:select-none'
    >
      <div
        ref={mergeRefs(rowRef, ref)}
        data-slot='carousel-content'
        {...props}
        onFocus={focusIn}
        className={cn(
          'flex not-data-measured:[&>[data-before]]:hidden [translate:calc(var(--carousel-offset,0px)*-1)_0] transition-[translate] duration-[calc(var(--motion-layout-duration)*var(--carousel-swipe-strength,1))] ease-(--motion-layout-easing) group-data-following/carousel:duration-0 motion-reduce:transition-none rtl:[translate:var(--carousel-offset,0px)_0]',
          className,
        )}
      >
        {slides.map((child, index) => (
          <ItemIndexProvider key={keyOf(child, index)} index={index} count={count}>
            {child}
          </ItemIndexProvider>
        ))}
      </div>
    </div>
  )
}

/** Writes a row's place and the dots' page on the carousel, for CSS to move them. */
function placeRow(
  root: HTMLElement,
  row: HTMLElement,
  to: number,
  strength: number,
  leads: readonly number[],
  pages: readonly number[],
) {
  root.style.setProperty('--carousel-swipe-strength', `${strength}`)
  row.style.setProperty('--carousel-offset', `${to}px`)
  root.style.setProperty(
    '--carousel-page',
    `${dotsPage(to, leads, pages, root.hasAttribute('data-following'))}`,
  )
}

function TrackItem({ className, ...props }: ComponentProps<'div'>) {
  const { value } = useCarousel()
  const { index, count } = useItemIndex()
  return (
    <div
      role='group'
      aria-roledescription='slide'
      aria-label={props['aria-labelledby'] ? undefined : slideLabel(index, count)}
      data-slot='carousel-item'
      data-before={index < value || undefined}
      className={cn('min-w-0 shrink-0 grow-0 basis-full', className)}
      {...props}
    />
  )
}

/*
 * Deck: the slides are a stack of cards, the next two showing under the one
 * on top. The top card follows a drag and tilts with it; let go far or fast
 * enough, it is thrown off and goes to the bottom of the deck while the rest
 * step up. Previous brings the last card back from the side it left. The deck
 * always loops, so there is no end.
 */

/** How many cards show under the top one. */
const UNDER = 2

/** How far a thrown card goes on from where it was let go, as a share of its width: `--carousel-slide`'s default. */
const SLIDE_SHARE = 0.6

const FOCUSABLE =
  'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])'

/** How far a card is dragged, as a share of its width, before letting go throws it. */
const THROW_SHARE = 0.35

function DeckContent({ ref, className, children, ...props }: ComponentProps<'div'>) {
  const { value, rtl, go, setGeometry } = useCarousel()
  const stackRef = useRef<HTMLDivElement>(null)
  const current = useRef({ value, go })
  useLayoutEffect(() => {
    current.current = { value, go }
  })
  const slides = Children.toArray(children)
  const count = slides.length
  // Which way the next throw goes: the way it was dragged, or towards the start.
  const throwWay = useRef<number | null>(null)
  const towardsStart = rtl ? 1 : -1

  useLayoutEffect(() => {
    setGeometry({ count, leadCount: Math.max(1, count), perView: 1 })
  }, [count, setGeometry])

  // The top card changed: the one that was on top is thrown off, or the one
  // brought back comes in from the side it left by.
  const shown = useRef(value)
  useLayoutEffect(() => {
    const root = stackRef.current && carouselOf(stackRef.current)
    const from = shown.current
    shown.current = value
    if (!root) return
    // Going round from the last card to the first, or back, the dots'
    // indicator jumps: sweeping across every dot would point the wrong way.
    const wrapped = Math.abs(value - from) > 1 && count > 2
    const setPage = () => root.style.setProperty('--carousel-page', `${value}`)
    const indicator = root.querySelector<HTMLElement>('[data-slot=carousel-indicator]')
    if (wrapped && indicator) withoutTransition(indicator, setPage)
    else setPage()
    if (from === value) return
    const all = cardsIn(stackRef.current)
    // A card still on its way off that comes straight back on top, as in a
    // deck of two, turns back from where it is.
    const returning = all[value]
    const turnedBack = Boolean(returning?.hasAttribute('data-thrown'))
    if (turnedBack && returning) {
      returning.removeAttribute('data-thrown')
      returning.style.removeProperty('--carousel-drag-x')
      returning.style.removeProperty('--carousel-drag-share')
    }
    // Focus in the card leaving the top would be lost as it goes inert: it
    // moves to the new top card, or to Next.
    if (all[from]?.contains(document.activeElement)) {
      const next =
        all[value]?.querySelector<HTMLElement>(FOCUSABLE) ??
        root.querySelector<HTMLElement>('[data-slot=carousel-next]')
      next?.focus({ preventScroll: true, focusVisible: false } as FocusOptions)
    }
    const back = value === (from - 1 + count) % count && count > 2
    if (back) {
      const card = all[value]
      // One still on its way off is already turning back from where it is.
      if (!card || turnedBack) return
      withoutTransition(card, () => {
        card.style.setProperty('--carousel-throw', `${towardsStart}`)
        card.setAttribute('data-thrown', '')
      })
      card.removeAttribute('data-thrown')
      return
    }
    const card = all[from]
    if (!card) return
    // A press throws it in the role's own time; only a flick shortens it.
    if (throwWay.current === null)
      root.style.setProperty('--carousel-swipe-strength', '1')
    card.style.setProperty('--carousel-throw', `${throwWay.current ?? towardsStart}`)
    throwWay.current = null
    // It leaves from where the drag let it go.
    card.setAttribute('data-thrown', '')
    const land = (event?: TransitionEvent) => {
      if (event && (event.target !== card || event.propertyName !== 'opacity')) return
      card.removeEventListener('transitionend', land)
      clearTimeout(timer)
      // Brought back on top before it landed: it is already on its way back.
      if (!card.hasAttribute('data-thrown')) return
      // It goes under the deck where it can't be seen, then fades in there.
      withoutTransition(card, () => {
        card.removeAttribute('data-thrown')
        card.style.removeProperty('--carousel-drag-x')
        card.style.removeProperty('--carousel-drag-share')
        card.style.opacity = '0'
      })
      card.style.opacity = ''
    }
    card.addEventListener('transitionend', land)
    // In case it can't transition, such as while the tab is hidden.
    const timer = setTimeout(land, 4000)
  }, [value, count, towardsStart])

  useEffect(() => {
    const stack = stackRef.current
    const root = stack && carouselOf(stack)
    if (!stack || !root) return
    const top = () => cardsIn(stack)[current.current.value]
    const release = (card: HTMLElement) => {
      card.style.removeProperty('--carousel-drag-x')
      card.style.removeProperty('--carousel-drag-share')
      root.style.removeProperty('--carousel-swipe-progress')
    }
    return followSwipe(stack, {
      canStart: (target) => {
        const card = top()
        return Boolean(card?.contains(target)) && count > 1
      },
      onStart: () => {
        root.setAttribute('data-following', '')
      },
      onMove: (dx) => {
        const card = top()
        if (!card) return
        const width = card.offsetWidth || 1
        card.style.setProperty('--carousel-drag-x', `${dx}px`)
        card.style.setProperty('--carousel-drag-share', `${dx / width}`)
        root.style.setProperty(
          '--carousel-swipe-progress',
          `${Math.min(1, Math.abs(dx) / (width * THROW_SHARE))}`,
        )
      },
      onEnd: (dx, velocity) => {
        const card = top()
        root.removeAttribute('data-following')
        if (!card) return
        const width = card.offsetWidth || 1
        if (!throws(dx, velocity, width)) {
          root.style.setProperty('--carousel-swipe-strength', '1')
          release(card)
          return
        }
        root.style.setProperty(
          '--carousel-swipe-strength',
          `${swipeStrength(width * SLIDE_SHARE, velocity)}`,
        )
        throwWay.current = Math.sign(dx) || towardsStart
        root.style.removeProperty('--carousel-swipe-progress')
        const from = current.current.value
        current.current.go(from + 1)
        // An owner that holds the value back keeps the card: it returns.
        requestAnimationFrame(() => {
          if (current.current.value !== from) return
          throwWay.current = null
          root.style.setProperty('--carousel-swipe-strength', '1')
          release(card)
        })
      },
    })
  }, [count, towardsStart])

  return (
    <div
      ref={mergeRefs(stackRef, ref)}
      data-slot='carousel-content'
      {...props}
      className={cn(
        'grid touch-pan-y pb-[calc(var(--carousel-recede,0.75rem)*2)] group-data-following/carousel:select-none',
        className,
      )}
    >
      {slides.map((child, index) => (
        <ItemIndexProvider key={keyOf(child, index)} index={index} count={count}>
          {child}
        </ItemIndexProvider>
      ))}
    </div>
  )
}

/** A slide's own key, which `Children.toArray` made unique, so a slide keeps its place in context as others come and go. */
function keyOf(child: ReactNode, index: number) {
  return isValidElement(child) && child.key !== null ? child.key : index
}

function cardsIn(stack: HTMLElement | null) {
  return [...(stack?.children ?? [])].filter(
    (child): child is HTMLElement => child instanceof HTMLElement,
  )
}

function DeckItem({ className, style, ...props }: ComponentProps<'div'>) {
  const { value } = useCarousel()
  const { index, count } = useItemIndex()
  const depth = deckDepth(index, value, count)
  const top = depth === 0
  return (
    <div
      role='group'
      aria-roledescription='slide'
      aria-label={props['aria-labelledby'] ? undefined : slideLabel(index, count)}
      data-slot='carousel-item'
      data-top={top || undefined}
      // Only the top card can be read and used; the ones under it are a picture of the deck.
      inert={!top}
      style={
        {
          '--carousel-depth': Math.min(depth, UNDER + 1),
          '--carousel-z': count - depth,
          ...style,
        } as CSSProperties
      }
      className={cn(
        // Cards under the top one step back and peek out below it; while the
        // top one is dragged off, they step up towards their next place.
        'z-(--carousel-z) min-w-0 origin-bottom [grid-area:1/1] [--carousel-step:max(0,calc(var(--carousel-depth)-var(--carousel-swipe-progress,0)))] [translate:0_calc(var(--carousel-step)*var(--carousel-recede,0.75rem))] [scale:calc(1-var(--carousel-step)*var(--carousel-recede-scale,0.05))] [opacity:clamp(0,calc(3-var(--carousel-step)),1)]',
        // The drag moves the top card on `transform`, which follows the pointer
        // at once, while its place in the deck keeps settling on `layout`.
        '[transform:translateX(var(--carousel-drag-x,0px))_rotate(calc(var(--carousel-drag-share,0)*var(--carousel-tilt,8deg)))]',
        '[transition:translate_var(--motion-layout-duration)_var(--motion-layout-easing),scale_var(--motion-layout-duration)_var(--motion-layout-easing),rotate_var(--motion-layout-duration)_var(--motion-layout-easing),opacity_var(--motion-layout-duration)_var(--motion-layout-easing),transform_var(--motion-layout-duration)_var(--motion-layout-easing)] motion-safe:group-data-following/carousel:[transition:translate_var(--motion-layout-duration)_var(--motion-layout-easing),scale_var(--motion-layout-duration)_var(--motion-layout-easing),rotate_var(--motion-layout-duration)_var(--motion-layout-easing),opacity_var(--motion-layout-duration)_var(--motion-layout-easing)] motion-reduce:[transition:opacity_var(--motion-layout-duration)_var(--motion-layout-easing)]',
        // Thrown, it leaves sideways and fades, above the rest, sooner the faster
        // it was flicked; with less motion, it fades where it was let go.
        'data-thrown:z-50 data-thrown:[translate:calc(var(--carousel-throw,-1)*var(--carousel-slide,60%))_0] data-thrown:[rotate:calc(var(--carousel-throw,-1)*var(--carousel-tilt,8deg))] data-thrown:[scale:1] data-thrown:opacity-0 data-thrown:duration-[calc(var(--motion-exit-duration)*var(--carousel-swipe-strength,1))] data-thrown:ease-(--motion-exit-easing) motion-reduce:data-thrown:[translate:0_0] motion-reduce:data-thrown:[rotate:0deg]',
        className,
      )}
      {...props}
    />
  )
}

/**
 * Where each slide can come first in view, in pixels from the row's start,
 * and how many fit in view at once. `slides` are each slide's start and
 * end, from the first slide's start; `viewport` is the room they show in.
 * Once the row's end is in view, the slides after can't come first.
 */
function slideLeads(slides: readonly { start: number; end: number }[], viewport: number) {
  if (slides.length === 0) return { leads: [0], perView: 1 }
  const max = Math.max(0, slides[slides.length - 1].end - viewport)
  const leads: number[] = []
  for (const slide of slides) {
    const lead = Math.min(slide.start, max)
    leads.push(lead)
    if (lead >= max - 0.5) break
  }
  const perView = Math.max(1, slides.filter((slide) => slide.end <= viewport + 1).length)
  return { leads, perView }
}

/** The slide that comes first on each page: every `perView` slides, and the last that can lead. */
function slidePages(leadCount: number, perView: number) {
  const pages: number[] = []
  for (let lead = 0; lead < leadCount - 1; lead += Math.max(1, perView)) pages.push(lead)
  pages.push(Math.max(0, leadCount - 1))
  return pages
}

/** The page that `value` is on. */
function pageOf(value: number, pages: readonly number[]) {
  let page = 0
  pages.forEach((lead, index) => {
    if (lead <= value) page = index
  })
  return page
}

/** The next page's first slide; with `loop` (the slide count), the last page goes on to the first. */
function nextLead(value: number, pages: readonly number[], loop = 0) {
  const next = pages.find((lead) => lead > value)
  if (next !== undefined) return next
  return loop ? 0 : value
}

/** The page before's first slide; with `loop` (the slide count), the first goes back to the last. */
function previousLead(value: number, pages: readonly number[], loop = 0) {
  const before = pages.filter((lead) => lead < value)
  if (before.length > 0) return before[before.length - 1]
  return loop ? loop - 1 : value
}

/** The lead nearest `position`, in pixels. */
function nearestLead(leads: readonly number[], position: number) {
  let nearest = 0
  leads.forEach((lead, index) => {
    if (Math.abs(lead - position) < Math.abs(leads[nearest] - position)) nearest = index
  })
  return nearest
}

/**
 * Which page `position` shows, as a fraction between pages while it moves
 * between them, for the dots' indicator to follow.
 */
function pageProgress(
  position: number,
  leads: readonly number[],
  pages: readonly number[],
) {
  const at = pages.map((lead) => leads[lead] ?? 0)
  if (at.length < 2 || position <= at[0]) return 0
  for (let page = 1; page < at.length; page++) {
    if (position <= at[page]) {
      const span = at[page] - at[page - 1]
      return page - 1 + (span > 0 ? (position - at[page - 1]) / span : 1)
    }
  }
  return at.length - 1
}

/** The lead `index` asks for: wrapped round with `loop`, or held between the first and last. */
function wrapIndex(index: number, leadCount: number, loop: boolean) {
  const count = Math.max(1, leadCount)
  return loop
    ? ((index % count) + count) % count
    : Math.max(0, Math.min(count - 1, index))
}

/**
 * Which of Previous and Next are off. Before the slides are measured
 * (`count` 0, as in the server's HTML), only the way back from the start is.
 */
function controlsOff(value: number, count: number, leadCount: number, loop: boolean) {
  if (count === 0) return { previous: !loop && value === 0, next: false }
  const one = leadCount <= 1
  return {
    previous: one || (!loop && value === 0),
    next: one || (!loop && value === leadCount - 1),
  }
}

/** How far a card is under the deck's top one: 0 on top, wrapping round. */
function deckDepth(index: number, value: number, count: number) {
  return count > 0 ? (((index - value) % count) + count) % count : index
}

/** Whether a card let go `dx` pixels along, at `velocity` px/ms, is thrown off: dragged far enough, or flicked on the way it went. */
function throws(dx: number, velocity: number, width: number) {
  const flicked = Math.abs(velocity) >= 0.5 && Math.sign(velocity) === Math.sign(dx)
  return flicked || Math.abs(dx) >= width * THROW_SHARE
}

/** A slide's name among its siblings: "3 of 8". */
function slideLabel(index: number, count: number) {
  return `${index + 1} of ${count}`
}

/** What is in view, from the first slide in view: "Slide 3 of 8", or "Slides 4 to 6 of 8". */
function viewLabel(value: number, perView: number, count: number) {
  const last = Math.min(count, value + perView)
  return last - value <= 1
    ? `Slide ${value + 1} of ${count}`
    : `Slides ${value + 1} to ${last} of ${count}`
}

/**
 * The slide to show first so that the `index`th, just focused, is in view;
 * null when it already is.
 */
function leadForFocus(index: number, value: number, perView: number) {
  if (index < value) return index
  if (index >= value + perView) return index - perView + 1
  return null
}

/** Brings a slide that takes focus out of view into it, as a focus event on the row arrives. */
function useRevealOnFocus() {
  const { value, perView, go } = useCarousel()
  return (event: FocusEvent<HTMLElement>) => {
    const slide = event.target.closest<HTMLElement>('[data-slot=carousel-item]')
    if (!slide || slide.parentElement !== event.currentTarget) return
    const lead = leadForFocus(
      [...event.currentTarget.children].indexOf(slide),
      value,
      perView,
    )
    if (lead !== null) go(lead)
  }
}

/**
 * Makes `change` on a carousel land at once, with every transition inside it
 * off for that moment, as `data-following` turns them off during a drag.
 * Kept outside any component: the React Compiler drops the forced style
 * read a component would make, and then the change animates.
 */
function atOnce(root: HTMLElement, change: () => void) {
  const following = root.hasAttribute('data-following')
  root.setAttribute('data-following', '')
  change()
  void root.offsetWidth
  if (!following) root.removeAttribute('data-following')
}

/**
 * The page the dots show for a row `position` pixels along: a fraction while
 * it moves, and once it rests, the page its first slide is on, so the
 * indicator never rests between two dots.
 */
function dotsPage(
  position: number,
  leads: readonly number[],
  pages: readonly number[],
  moving: boolean,
) {
  return moving
    ? pageProgress(position, leads, pages)
    : pageOf(nearestLead(leads, position), pages)
}

/**
 * The carousel an element is in. A part's own layout effects run before the
 * carousel's ref is set, so they find it from their own element.
 */
function carouselOf(element: Element) {
  return element.closest<HTMLElement>('[data-slot=carousel]')
}

/** Each element's start and end along the row, in pixels from the first one's start, in either direction. */
function measureSlides(slides: readonly HTMLElement[], rtl: boolean) {
  if (slides.length === 0) return []
  const first = slides[0].getBoundingClientRect()
  return slides.map((slide) => {
    const box = slide.getBoundingClientRect()
    const start = rtl ? first.right - box.right : box.left - first.left
    return { start, end: start + box.width }
  })
}

export {
  Carousel,
  CarouselContent,
  CarouselDots,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
  controlsOff,
  deckDepth,
  dotsPage,
  leadForFocus,
  nearestLead,
  nextLead,
  pageOf,
  pageProgress,
  previousLead,
  slideLabel,
  slideLeads,
  slidePages,
  throws,
  viewLabel,
  wrapIndex,
}
export type { CarouselProps, CarouselVariant }
