'use client'

import { Button } from '@/registry/components/kino/button'
import {
  MenuGroupLabel,
  MenuRadioGroup,
  MenuRadioItem,
} from '@/registry/components/kino/menu'
import { colorSchemePreference } from '@/registry/components/kino/preferences'
import {
  SegmentedControl,
  SegmentedControlItem,
} from '@/registry/components/kino/segmented-control'
import {
  Tooltip,
  TooltipContent,
  type TooltipContentProps,
  TooltipTrigger,
} from '@/registry/components/kino/tooltip'
import { IconPlaceholder } from '@/registry/icons/icon-placeholder'
import {
  followPick,
  followPointer,
  highlightClassName,
  itemMatching,
  pickClassName,
} from '@/registry/lib/highlight'
import {
  pillBackdropClassName,
  pillClassName,
  pillItemClassName,
  pillItemLayout,
  pillRowClassName,
  pillTrackClassName,
} from '@/registry/lib/pill'
import { reducesMotion } from '@/registry/lib/reduce-motion'
import type { ChangeReason, ChangeSource } from '@ui-sdk/core'
import { withSource } from '@ui-sdk/core/observe'
import { MenuRadioItem as MenuRadioItemPrimitive } from '@ui-sdk/react/menu'
import { usePreference } from '@ui-sdk/react/preferences'
import {
  type ComponentProps,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useSyncExternalStore,
} from 'react'
import { flushSync } from 'react-dom'

import { cn } from '@/lib/utils'

/*
 * Light, dark or the device's own, through the `preferences` item's colour
 * scheme: saved, on the page before it paints, and shared by every switcher
 * on it. Three ways to pick: an icon button that flips between light and
 * dark, a Segmented control and a Dropdown menu's radio group.
 *
 * The toggle's icon `roll`s as every Button icon does, or is drawn: the
 * `eclipse` sun becomes a crescent as its shadow slides in, and the `dial`
 * turns half a circle so the sun sets as the moon rises. The page crosses
 * over to the new theme with a view transition where the browser has them:
 * a `fade`, a circle that grows from the control (`reveal`), or a `band`
 * that opens from its row. A change while it crosses over turns it round
 * from where it is, and under reduced motion the change is instant.
 */

type Theme = 'system' | 'light' | 'dark'

/** What a choice shows: `system` is the device's scheme, light while it isn't known. */
function resolveTheme(
  value: Theme,
  system: 'light' | 'dark' | 'unknown',
): 'light' | 'dark' {
  const resolved = value === 'system' ? system : value
  return resolved === 'dark' ? 'dark' : 'light'
}

const THEMES: readonly { value: Theme; label: string; icon: ReactNode }[] = [
  {
    value: 'system',
    label: 'System',
    icon: (
      <IconPlaceholder
        lucide='MonitorIcon'
        tabler='IconDeviceDesktop'
        hugeicons='ComputerIcon'
        phosphor='MonitorIcon'
        remixicon='RiComputerLine'
        aria-hidden
      />
    ),
  },
  {
    value: 'light',
    label: 'Light',
    icon: (
      <IconPlaceholder
        lucide='SunIcon'
        tabler='IconSun'
        hugeicons='Sun03Icon'
        phosphor='SunIcon'
        remixicon='RiSunLine'
        aria-hidden
      />
    ),
  },
  {
    value: 'dark',
    label: 'Dark',
    icon: (
      <IconPlaceholder
        lucide='MoonIcon'
        tabler='IconMoon'
        hugeicons='Moon02Icon'
        phosphor='MoonIcon'
        remixicon='RiMoonLine'
        aria-hidden
      />
    ),
  },
]

/** How the toggle's icon changes. */
type ThemeIcon = 'roll' | 'eclipse' | 'dial'

/** How the page crosses over to the new theme. */
type ThemeCrossover = 'fade' | 'reveal' | 'band'

interface Point {
  x: number
  y: number
}

/** The centre of the control the person used, which a reveal or a band opens from. */
function originOf(event: Event | undefined): Point | null {
  const target = event?.target
  if (!(target instanceof Element)) return null
  const box = (target.closest('button, [role]') ?? target).getBoundingClientRect()
  return { x: box.left + box.width / 2, y: box.top + box.height / 2 }
}

// A fade is the new theme arriving, on `enter`. A reveal and a band spread
// along their length, on `draw`, which never bounces, so the old theme
// never peeks back at the far edges.
const timing = (role: 'enter' | 'draw') =>
  `animation-duration:var(--motion-${role}-duration);animation-timing-function:var(--motion-${role}-easing)`

// Only the new theme moves: the old one stays still beneath it.
const CLIPPED =
  '::view-transition-old(root),::view-transition-new(root){animation:none;mix-blend-mode:normal}'

/**
 * The view transition's CSS for a crossover. Pure, so its geometry can be
 * tested. Without a control to start from, a reveal grows from the top
 * centre, and a band opens from the top for dark and the bottom for light.
 */
function crossoverCss(
  crossover: ThemeCrossover,
  {
    origin,
    toDark,
    width,
    height,
  }: {
    origin: Point | null
    toDark: boolean
    /** The viewport, in px. */
    width: number
    height: number
  },
): string {
  if (crossover === 'fade') {
    return `::view-transition-group(root),::view-transition-old(root),::view-transition-new(root){${timing('enter')}}`
  }
  let from: string
  let to: string
  if (crossover === 'reveal') {
    const { x, y } = origin ?? { x: width / 2, y: 0 }
    // Far enough to reach the corner furthest from where it starts.
    const radius = Math.ceil(Math.hypot(Math.max(x, width - x), Math.max(y, height - y)))
    from = `circle(0px at ${x}px ${y}px)`
    to = `circle(${radius}px at ${x}px ${y}px)`
  } else {
    const y = origin?.y ?? (toDark ? 0 : height)
    from = `inset(${y}px 0 ${Math.max(0, height - y)}px 0)`
    to = 'inset(0)'
  }
  return `${CLIPPED}::view-transition-new(root){animation-name:kino-theme-crossover;${timing('draw')}}@keyframes kino-theme-crossover{from{clip-path:${from}}to{clip-path:${to}}}`
}

/** What a switcher hands on with a change: its `onValueChange` reads them all. */
type ThemeChange = {
  reason?: ChangeReason
  event?: Event
  source?: ChangeSource
}

/** The crossover running now: the theme it leaves, whether it is turning back to it, and the change asked for last. */
let crossing: {
  from: 'light' | 'dark'
  back: boolean
  value: Theme
  change: ThemeChange
} | null = null

/**
 * Sets the preference with the change's reason and event, as the person or
 * agent who asked: a crossover sets it after the press is over, when ui-sdk
 * would read the source as `programmatic`.
 */
function setTheme(value: Theme, { reason, event, source }: ThemeChange) {
  withSource(source, () => colorSchemePreference.set(value, { reason, event }))
}

// The value asked for last while a crossover runs. A turned-back crossover
// sets the preference only once it closes, so the switchers show this instead.
let asked: Theme | null = null
const askedListeners = new Set<() => void>()

function setAsked(value: Theme | null) {
  if (value === asked) return
  asked = value
  for (const listener of askedListeners) listener()
}

function subscribeAsked(listener: () => void) {
  askedListeners.add(listener)
  return () => {
    askedListeners.delete(listener)
  }
}

/**
 * The theme as the switchers show it: the one asked for last, even while the
 * page turns back. For a switcher of your own, such as a submenu's row that
 * names the theme.
 */
function useTheme() {
  const preference = usePreference(colorSchemePreference)
  const value = useSyncExternalStore(
    subscribeAsked,
    () => asked,
    () => null,
  )
  const shown = value ?? preference.value
  return { value: shown, resolved: resolveTheme(shown, preference.system) }
}

function crossoverAnimations() {
  return document
    .getAnimations()
    .filter((animation) =>
      (animation.effect as KeyframeEffect | null)?.pseudoElement?.startsWith(
        '::view-transition',
      ),
    )
}

/**
 * Sets the theme, crossing the page over to it where the browser can. A
 * change while it crosses over turns the crossover round from where it is.
 */
function changeTheme(value: Theme, crossover: ThemeCrossover, change: ThemeChange = {}) {
  const { system } = colorSchemePreference.get()
  const resolved = resolveTheme(value, system)
  if (crossing) {
    crossing.value = value
    crossing.change = change
    setAsked(value)
    const back = resolved === crossing.from
    if (back !== crossing.back) {
      crossing.back = back
      for (const animation of crossoverAnimations()) animation.reverse()
    }
    // Going on to the same look, such as from dark to a system that is dark, changes nothing on screen.
    if (!back) setTheme(value, change)
    return
  }
  const from = resolveTheme(colorSchemePreference.get().value, system)
  if (resolved === from || !('startViewTransition' in document) || reducesMotion()) {
    setTheme(value, change)
    return
  }
  const style = document.createElement('style')
  style.textContent = crossoverCss(crossover, {
    origin: originOf(change.event),
    toDark: resolved === 'dark',
    width: window.innerWidth,
    height: window.innerHeight,
  })
  document.head.append(style)
  const current = { from, back: false, value, change }
  crossing = current
  setAsked(value)
  // The page is captured as the callback leaves it, so React renders the new theme at once.
  const transition = document.startViewTransition(() =>
    flushSync(() => setTheme(value, change)),
  )
  void transition.ready.then(async () => {
    await Promise.allSettled(crossoverAnimations().map((animation) => animation.finished))
    // Turned back: the old theme returns under the closed crossover, before the page shows again.
    if (current.back) flushSync(() => setTheme(current.value, current.change))
  })
  void transition.finished.finally(() => {
    style.remove()
    if (crossing === current) {
      // Turned back after the crossover closed, before the transition ended: nothing above has set it.
      if (current.back) flushSync(() => setTheme(current.value, current.change))
      crossing = null
      setAsked(null)
    }
  })
}

const noSubscription = () => () => {}

/** False on the server and while hydrating, when the saved theme isn't known yet. */
function useMounted() {
  return useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  )
}

/**
 * Each theme's icon is its own keyed span, so the Button's swap rolls from
 * one to the next. Before hydration both are drawn and the page's `dark`
 * class shows one; the change to the known theme comes before the first
 * paint settles, so it takes its place without moving.
 */
function RollMark({ dark }: { dark: boolean | null }) {
  return dark === null ? (
    <span key='unknown' className='grid *:col-start-1 *:row-start-1'>
      <span className='flex dark:hidden'>{THEMES[1].icon}</span>
      <span className='hidden dark:flex'>{THEMES[2].icon}</span>
    </span>
  ) : (
    <span key={dark ? 'dark' : 'light'} className='flex'>
      {dark ? THEMES[2].icon : THEMES[1].icon}
    </span>
  )
}

const RAYS = [
  [12, 2, 12, 4],
  [12, 20, 12, 22],
  [4.93, 4.93, 6.34, 6.34],
  [17.66, 17.66, 19.07, 19.07],
  [2, 12, 4, 12],
  [20, 12, 22, 12],
  [6.34, 17.66, 4.93, 19.07],
  [17.66, 6.34, 19.07, 4.93],
] as const

// Everything turns about the centre of the 24-unit box.
const ABOUT_CENTRE = '[transform-box:view-box] [transform-origin:12px_12px]'
const MORPH =
  'transition-[transform,opacity] duration-(--motion-morph-duration) ease-(--motion-morph-easing) motion-reduce:transition-none'
// The disc's outline is two filled circles, one unit either side of its
// edge, so it stays two units wide as the disc grows from the sun's 4 to the
// moon's 9: 5 and 3 for the sun, 10 and 8 for the moon.
const OUTER = `${ABOUT_CENTRE} ${MORPH} [transform:scale(0.5)] dark:[transform:scale(1)]`
const INNER = `${ABOUT_CENTRE} ${MORPH} [transform:scale(0.375)] dark:[transform:scale(1)]`
// The shadow waits beyond the top end corner, and slides in to bite the moon.
const SHADOW = `${MORPH} [transform:translate(9px,-9px)] dark:[transform:translate(0,0)]`
const BOX = { x: -12, y: -12, width: 48, height: 48 }

/** A sun that becomes a crescent moon as the page turns dark, drawn by the page's `dark` class. */
function EclipseMark() {
  const id = useId()
  const outline = `${id}-outline`
  const lit = `${id}-lit`
  return (
    <svg
      viewBox='0 0 24 24'
      fill='none'
      stroke='currentColor'
      strokeWidth={2}
      strokeLinecap='round'
      aria-hidden
      data-slot='theme-toggle-mark'
    >
      {/* The lit part of the disc: all of it, less the shadow's own edge. */}
      <mask id={lit} maskUnits='userSpaceOnUse' {...BOX}>
        <rect {...BOX} fill='white' stroke='none' />
        <circle
          cx={17.5}
          cy={6.5}
          r={7.4}
          fill='black'
          stroke='none'
          className={SHADOW}
        />
      </mask>
      {/* The crescent's outline: the disc's ring, less the shadow, and less the lit part's inside. */}
      <mask id={outline} maskUnits='userSpaceOnUse' {...BOX}>
        <circle cx={12} cy={12} r={10} fill='white' stroke='none' className={OUTER} />
        <circle
          cx={17.5}
          cy={6.5}
          r={5.4}
          fill='black'
          stroke='none'
          className={SHADOW}
        />
        <g mask={`url(#${lit})`}>
          <circle cx={12} cy={12} r={8} fill='black' stroke='none' className={INNER} />
        </g>
      </mask>
      <g
        className={`${ABOUT_CENTRE} ${MORPH} dark:[transform:rotate(45deg)_scale(0.5)] dark:opacity-0`}
      >
        {RAYS.map(([x1, y1, x2, y2]) => (
          <line key={`${x1}-${y1}`} x1={x1} y1={y1} x2={x2} y2={y2} />
        ))}
      </g>
      <rect {...BOX} fill='currentColor' stroke='none' mask={`url(#${outline})`} />
    </svg>
  )
}

/** A crescent: the disc's 9-unit edge, less a 6.4-unit shadow from the top end corner. */
const MOON = 'M21 11.86A9 9 0 1 1 12.14 3a6.4 6.4 0 0 0 8.86 8.86Z'

/** The sun above the box and the moon below it, upside down, on a dial the page's `dark` class turns. */
function DialMark() {
  return (
    <svg
      viewBox='0 0 24 24'
      fill='none'
      stroke='currentColor'
      strokeWidth={2}
      strokeLinecap='round'
      strokeLinejoin='round'
      aria-hidden
      data-slot='theme-toggle-mark'
      className='overflow-hidden'
    >
      <g
        className={`${MORPH} [transform-box:view-box] [transform-origin:12px_24px] dark:[transform:rotate(180deg)]`}
      >
        <circle cx={12} cy={12} r={4} />
        {RAYS.map(([x1, y1, x2, y2]) => (
          <line key={`${x1}-${y1}`} x1={x1} y1={y1} x2={x2} y2={y2} />
        ))}
        <path d={MOON} transform='rotate(180 12 24)' />
      </g>
    </svg>
  )
}

/**
 * An icon button that flips between light and dark, named in a tooltip. On
 * `system`, it shows what the device asks for and flips away from it.
 */
function ThemeToggle({
  icon = 'roll',
  crossover = 'fade',
  variant = 'ghost',
  size = 'icon',
  tooltipProps,
  onClick,
  ...props
}: Omit<ComponentProps<typeof Button>, 'children'> & {
  /** How its icon changes: rolling as a Button's icon does, or a drawn `eclipse` or `dial`. */
  icon?: ThemeIcon
  /** How the page crosses over to the new theme. */
  crossover?: ThemeCrossover
  /** The tooltip that names it. */
  tooltipProps?: Omit<TooltipContentProps, 'children'>
}) {
  const { resolved } = useTheme()
  const mounted = useMounted()
  const dark = mounted ? resolved === 'dark' : null
  const label =
    dark === null
      ? 'Switch the theme'
      : dark
        ? 'Switch to the light theme'
        : 'Switch to the dark theme'
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            data-theme-toggle=''
            variant={variant}
            size={size}
            aria-label={label}
            onClick={(event, details) => {
              onClick?.(event, details)
              if (!event.defaultPrevented) {
                changeTheme(dark ? 'light' : 'dark', crossover, {
                  event: event.nativeEvent,
                  source: details.source,
                })
              }
            }}
            {...props}
          />
        }
      >
        {icon === 'eclipse' ? (
          <EclipseMark />
        ) : icon === 'dial' ? (
          <DialMark />
        ) : (
          <RollMark dark={dark} />
        )}
      </TooltipTrigger>
      <TooltipContent {...tooltipProps}>{label}</TooltipContent>
    </Tooltip>
  )
}

/** System, light and dark in a Segmented control, with their icons and labels or the icons alone. */
function ThemeSegmentedControl({
  iconOnly = false,
  crossover = 'fade',
  ...props
}: Omit<
  ComponentProps<typeof SegmentedControl<Theme>>,
  'className' | 'value' | 'defaultValue' | 'onValueChange' | 'children'
> & {
  className?: string
  /** Icons alone, each named for a screen reader: for a header or a footer. */
  iconOnly?: boolean
  /** How the page crosses over to the new theme. */
  crossover?: ThemeCrossover
}) {
  const { value } = useTheme()
  return (
    <SegmentedControl<Theme>
      data-theme-segmented-control=''
      aria-label='Theme'
      value={value}
      onValueChange={(next, details) => {
        if (next) changeTheme(next, crossover, details)
      }}
      {...props}
    >
      {THEMES.map((theme) => (
        <SegmentedControlItem
          key={theme.value}
          value={theme.value}
          aria-label={iconOnly ? theme.label : undefined}
        >
          {theme.icon}
          {iconOnly ? null : theme.label}
        </SegmentedControlItem>
      ))}
    </SegmentedControl>
  )
}

/**
 * System, light and dark as a Dropdown menu's radio group, for a menu of
 * your own: rows under a heading, or `inline`, one row with the heading at
 * its start and the three as icons in a Segmented control's track, the pill
 * sliding to the pick. Each is still a radio item, reached with the arrows.
 */
function ThemeMenuRadioGroup({
  label = 'Theme',
  crossover = 'fade',
  inline = false,
  className,
  ...props
}: Omit<
  ComponentProps<typeof MenuRadioGroup<Theme>>,
  'value' | 'defaultValue' | 'onValueChange' | 'children' | 'className'
> & {
  className?: string
  /** The group's heading, which names it for a screen reader; `null` for none, with an `aria-label` instead. */
  label?: ReactNode
  /** How the page crosses over to the new theme. */
  crossover?: ThemeCrossover
  /** One row, the three as icons beside the heading. */
  inline?: boolean
}) {
  const { value } = useTheme()
  return (
    <MenuRadioGroup<Theme>
      data-theme-menu-radio-group=''
      value={value}
      onValueChange={(next, details) => changeTheme(next, crossover, details)}
      className={cn(
        inline && 'flex items-center gap-3 py-0.5 ps-(--control-padding) pe-0.5',
        className,
      )}
      {...props}
    >
      {inline ? (
        <>
          <MenuGroupLabel className='text-foreground min-w-0 flex-1 p-0 text-sm font-normal'>
            {label}
          </MenuGroupLabel>
          <ThemeMenuSegments />
        </>
      ) : (
        <>
          {label === null ? null : <MenuGroupLabel>{label}</MenuGroupLabel>}
          {THEMES.map((theme) => (
            <MenuRadioItem key={theme.value} value={theme.value}>
              {theme.icon}
              {theme.label}
            </MenuRadioItem>
          ))}
        </>
      )}
    </MenuRadioGroup>
  )
}

const SEGMENT = '[data-theme-menu-segment]'

// The row and the pill's copy of it share this, so every icon sits exactly on its twin.
const segmentRow = cn('flex', pillRowClassName)

// Square, as tall as the track less its inset, so each is a 24px target or more.
const segmentLayout = cn(
  pillItemLayout,
  'size-[calc(var(--control-height-sm)_-_2px)] min-h-6 min-w-6 px-0',
)

/** The three as icons in a track, as the Segmented control draws them, the pill on the pick. */
function ThemeMenuSegments() {
  const trackRef = useRef<HTMLSpanElement>(null)
  const pillRef = useRef<HTMLSpanElement>(null)
  const backdropRef = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    const track = trackRef.current
    if (!track || !pillRef.current || !backdropRef.current) return
    const stopPick = followPick(track, pillRef.current, {
      picked: () => track.querySelector<HTMLElement>(`:scope > ${SEGMENT}[data-checked]`),
      attributes: ['data-checked'],
    })
    // The menu moves focus to the item it highlights, from the keyboard and
    // the pointer alike, so the backdrop follows that.
    const stopHover = followPointer(track, backdropRef.current, {
      itemOf: itemMatching(track, SEGMENT),
      focus: true,
    })
    return () => {
      stopPick()
      stopHover()
    }
  }, [])
  return (
    <span
      ref={trackRef}
      data-slot='theme-menu-segments'
      className={cn(pillTrackClassName, segmentRow, 'relative isolate shrink-0')}
    >
      {THEMES.map((theme) => (
        <MenuRadioItemPrimitive
          key={theme.value}
          value={theme.value}
          label={theme.label}
          aria-label={theme.label}
          data-theme-menu-segment=''
          className={cn(segmentLayout, pillItemClassName, 'cursor-default')}
        >
          {theme.icon}
        </MenuRadioItemPrimitive>
      ))}
      <span
        ref={backdropRef}
        aria-hidden
        className={cn(highlightClassName, pillBackdropClassName)}
      />
      <span
        ref={pillRef}
        aria-hidden
        inert
        className={cn(pickClassName, pillClassName, 'z-10')}
      >
        <span className={cn(segmentRow, 'h-full')}>
          {THEMES.map((theme) => (
            <span key={theme.value} className={segmentLayout}>
              {theme.icon}
            </span>
          ))}
        </span>
      </span>
    </span>
  )
}

export { ThemeMenuRadioGroup, ThemeSegmentedControl, ThemeToggle }

export { crossoverCss, resolveTheme, THEMES as themeOptions, useTheme }

export type { Theme, ThemeCrossover, ThemeIcon }
