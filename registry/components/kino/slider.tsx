'use client'

import { numberFormatter } from '@/registry/lib/number-format'
import { markResizing } from '@/registry/lib/resize'
import {
  channelThumbClassName,
  thumbDotClassName,
  trackClassName,
  trackDirClassName,
  trackFillClassName,
  trackHeaderClassName,
  trackLabelClassName,
  trackRootClassName,
  valuePercent,
} from '@/registry/lib/track'
import { useDirection } from '@base-ui/react/direction-provider'
import { Slider as SliderPrimitive } from '@base-ui/react/slider'
import { Tooltip as TooltipPrimitive } from '@base-ui/react/tooltip'
import { cva, type VariantProps } from 'class-variance-authority'
import {
  type CSSProperties,
  Fragment,
  type ReactNode,
  useCallback,
  useReducer,
  useState,
} from 'react'

import { cn } from '@/lib/utils'

/** How many thumbs a value draws: one for a number, one per entry for an array. */
function thumbCount(value: number | readonly number[] | undefined) {
  return Array.isArray(value) ? value.length : 1
}

/**
 * Why each thumb shows its number, by index, -1 for none: the pointer is over
 * it, it is dragged, or the keys moved it last. More than one can be true, on
 * different thumbs.
 */
interface ThumbReveal {
  hovered: number
  dragged: number
  keyed: number
}

type ThumbEvent =
  | { type: 'enter'; thumb: number }
  | { type: 'leave'; thumb: number }
  | {
      type: 'change'
      reason: SliderPrimitive.Root.ChangeEventReason
      thumb: number
    }
  | { type: 'commit' }
  | { type: 'press' }
  | { type: 'focus' }
  | { type: 'blur' }

const HIDDEN: ThumbReveal = { hovered: -1, dragged: -1, keyed: -1 }

/**
 * A drag shows the thumb it moves until it is let go, and the keys show the
 * thumb they moved until the pointer presses the track or focus moves.
 */
function revealStep(state: ThumbReveal, event: ThumbEvent): ThumbReveal {
  switch (event.type) {
    case 'enter':
      return { ...state, hovered: event.thumb }
    case 'leave':
      return state.hovered === event.thumb ? { ...state, hovered: -1 } : state
    case 'change':
      return {
        ...state,
        dragged: event.reason === 'drag' ? event.thumb : -1,
        keyed: event.reason === 'keyboard' ? event.thumb : -1,
      }
    case 'commit':
      return { ...state, dragged: -1 }
    case 'press':
    case 'focus':
    case 'blur':
      return { ...state, keyed: -1 }
  }
}

/** Whether the thumb at `index` shows its number. */
function thumbShowsValue(state: ThumbReveal, index: number) {
  return state.hovered === index || state.dragged === index || state.keyed === index
}

// In forced colours the fill turns to the system highlight, so a dashed track keeps the invalid state.
const sliderTrackVariants = cva(
  cn(
    trackClassName,
    'forced-colors:group-data-invalid/slider:outline-2 forced-colors:group-data-invalid/slider:outline-dashed',
  ),
  {
    variants: {
      variant: {
        default: '',
        // A channel's track is its colours, which forced colours must keep.
        channel:
          'h-3 [background:var(--slider-track)] shadow-[inset_0_0_0_1px_var(--border)] forced-color-adjust-none',
      },
    },
    defaultVariants: { variant: 'default' },
  },
)

const sliderThumbVariants = cva(
  cn(
    thumbDotClassName,
    'group-data-invalid/slider:border-destructive group-data-invalid/slider:ring-destructive/20 dark:group-data-invalid/slider:ring-destructive/40',
    'group-data-disabled/slider:ring-0',
  ),
  {
    variants: {
      variant: {
        default:
          'bg-background border-primary size-4 shadow-sm forced-colors:border-[CanvasText]',
        channel: channelThumbClassName,
      },
    },
    defaultVariants: { variant: 'default' },
  },
)

// Base UI places a thumb with `inset-inline-start` and the fill with `width`,
// which motion.md won't let us animate. The thumb is pinned to the start and
// moved with `translate`, against the control's width (`cqw`: the control is a
// size container), and the fill is clipped, so both glide on the compositor.

type SliderProps<Value extends number | readonly number[]> = Omit<
  SliderPrimitive.Root.Props<Value>,
  'orientation'
> &
  Pick<SliderPrimitive.Thumb.Props, 'getAriaLabel' | 'getAriaValueText'> & {
    /** Names a slider that has no `SliderLabel`. */
    'aria-label'?: string
    /** The label and value, in a row above the track. */
    children?: ReactNode
    /**
     * `channel` draws one channel of a colour: the track is the `--slider-track`
     * background, with no fill, and the thumb is filled with `--slider-thumb`.
     */
    variant?: VariantProps<typeof sliderTrackVariants>['variant']
  }

function Slider<Value extends number | readonly number[]>({
  className,
  children,
  value,
  defaultValue,
  min = 0,
  max = 100,
  format,
  locale,
  disabled,
  onValueChange,
  onValueCommitted,
  onBlur,
  getAriaLabel,
  getAriaValueText,
  'aria-label': ariaLabel,
  style,
  onFocus,
  variant = 'default',
  ...props
}: SliderProps<Value>) {
  const count = thumbCount(value ?? defaultValue)
  const [reveal, send] = useReducer(revealStep, HIDDEN)
  const formatter = numberFormatter(locale, format)
  const [control, setControl] = useState<HTMLDivElement | null>(null)
  const controlRef = useCallback((element: HTMLDivElement | null) => {
    setControl(element)
    // Thumbs sit in `cqw`, so while the slider resizes they move at once.
    return markResizing(element)
  }, [])

  return (
    <SliderPrimitive.Root
      data-slot='slider'
      value={value}
      defaultValue={defaultValue}
      min={min}
      max={max}
      format={format}
      locale={locale}
      disabled={disabled}
      onValueChange={(next, details) => {
        send({
          type: 'change',
          reason: details.reason,
          thumb: details.activeThumbIndex,
        })
        onValueChange?.(next, details)
      }}
      onValueCommitted={(next, details) => {
        send({ type: 'commit' })
        onValueCommitted?.(next, details)
      }}
      onFocus={(event) => {
        send({ type: 'focus' })
        onFocus?.(event)
      }}
      onBlur={(event) => {
        send({ type: 'blur' })
        onBlur?.(event)
      }}
      aria-label={count > 1 ? ariaLabel : undefined}
      data-following={reveal.dragged >= 0 || undefined}
      style={(state) =>
        ({
          ...(typeof style === 'function' ? style(state) : style),
          '--slider-start':
            state.values.length > 1 ? valuePercent(state.values[0], min, max) : 0,
          '--slider-end': valuePercent(state.values[state.values.length - 1], min, max),
        }) as CSSProperties
      }
      className={cn(trackRootClassName, 'group/slider', className)}
      {...props}
    >
      {children ? (
        <div data-slot='slider-header' className={trackHeaderClassName}>
          {children}
        </div>
      ) : null}
      <SliderPrimitive.Control
        data-slot='slider-control'
        ref={controlRef}
        onPointerDown={() => send({ type: 'press' })}
        className='group/control @container relative flex h-(--control-height-xs) w-full touch-none items-center select-none data-disabled:pointer-events-none data-disabled:opacity-50'
      >
        <SliderPrimitive.Track
          data-slot='slider-track'
          // In forced colours the fill turns to the system highlight, so a dashed track keeps the invalid state.
          className={sliderTrackVariants({ variant })}
          render={(trackProps, state) => (
            <div {...trackProps}>
              {trackProps.children}
              {Array.from({ length: count }, (_, index) => (
                // oxlint-disable-next-line react/no-array-index-key -- a thumb is its index in the value
                <Fragment key={index}>
                  <SliderPrimitive.Thumb
                    data-slot='slider-thumb'
                    index={index}
                    aria-label={getAriaLabel ? undefined : ariaLabel}
                    getAriaLabel={getAriaLabel}
                    getAriaValueText={getAriaValueText}
                    style={
                      {
                        '--slider-value': valuePercent(
                          state.values[index] ?? min,
                          min,
                          max,
                        ),
                        insetInlineStart: 0,
                        translate:
                          'calc(var(--track-dir) * (var(--slider-value) * 1cqw - 50%)) -50%',
                      } as CSSProperties
                    }
                    onPointerEnter={() => send({ type: 'enter', thumb: index })}
                    onPointerLeave={() => send({ type: 'leave', thumb: index })}
                    className={cn(
                      'group/thumb flex size-6 items-center justify-center rounded-full outline-hidden',
                      // After a press on the track or a key, it glides on `layout`; while dragged, it follows the pointer at once.
                      'transition-[translate] duration-(--motion-layout-duration) ease-(--motion-layout-easing) group-data-following/slider:duration-0 group-data-resizing/control:transition-none motion-reduce:transition-none',
                    )}
                    render={(thumbProps) => (
                      <div {...thumbProps}>
                        {thumbProps.children}
                        <span aria-hidden className={sliderThumbVariants({ variant })} />
                      </div>
                    )}
                  />
                  <SliderThumbValue
                    control={control}
                    open={!disabled && thumbShowsValue(reveal, index)}
                    following={reveal.dragged >= 0}
                    percent={valuePercent(state.values[index] ?? min, min, max)}
                  >
                    {formatter.format(state.values[index] ?? min)}
                  </SliderThumbValue>
                </Fragment>
              ))}
            </div>
          )}
        >
          {variant === 'channel' ? null : (
            <SliderPrimitive.Indicator
              data-slot='slider-indicator'
              style={{ insetInlineStart: 0, width: '100%' }}
              className={cn(
                trackFillClassName,
                'pointer-events-none',
                'transition-[clip-path] duration-(--motion-layout-duration) ease-(--motion-layout-easing) group-data-following/slider:duration-0 motion-reduce:transition-none',
                '[clip-path:inset(0_calc(100%-var(--slider-end)*1%)_0_calc(var(--slider-start)*1%)_round_9999px)]',
                'rtl:[clip-path:inset(0_calc(var(--slider-start)*1%)_0_calc(100%-var(--slider-end)*1%)_round_9999px)]',
                'group-data-invalid/slider:bg-destructive',
              )}
            />
          )}
        </SliderPrimitive.Track>
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  )
}

/** A thumb's place and whether its number shows, with where the thumb was the render before. */
interface ValueTrail {
  percent: number
  open: boolean
  from: number
}

/**
 * Where a thumb's number appears: where the thumb was the render before, so
 * it glides with a thumb that the same change moves, such as a key that both
 * moves it and shows its number. Unchanged, it returns the same trail.
 */
function trailStep(trail: ValueTrail, percent: number, open: boolean): ValueTrail {
  if (trail.percent === percent && trail.open === open) return trail
  return { percent, open, from: trail.percent }
}

/**
 * A thumb's number, above it. It is portalled to the page's body, above its
 * containers, so none that clips, such as a Card, cuts it off. Its positioner is laid
 * over the control, as wide as it, and the number slides along it.
 */
function SliderThumbValue({
  control,
  open,
  following,
  percent,
  children,
}: {
  control: HTMLElement | null
  open: boolean
  /** A thumb is dragged, so the number trails it a little. */
  following: boolean
  /** Where the thumb is along the track, from 0 to 100. */
  percent: number
  children: ReactNode
}) {
  const dir = useDirection()
  const [trail, setTrail] = useState<ValueTrail>({ percent, open, from: percent })
  const next = trailStep(trail, percent, open)
  if (next !== trail) setTrail(next)
  // Portalled out of the slider, it takes the feel, the reduced motion and the
  // rise its thumb moves on, so the two stay in step.
  const inherit = useCallback(
    (positioner: HTMLDivElement | null) => {
      if (!positioner || !control) return
      for (const name of ['data-feel', 'data-motion']) {
        const value = control.closest(`[${name}]`)?.getAttribute(name)
        if (value) positioner.setAttribute(name, value)
      }
      const rise = getComputedStyle(control).getPropertyValue('--slider-value-rise')
      if (rise) positioner.style.setProperty('--slider-value-rise', rise)
    },
    [control],
  )
  return (
    <TooltipPrimitive.Root open={open}>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Positioner
          anchor={control}
          side='top'
          align='start'
          // 14px above the track's middle: the thumb's 8px radius and a 6px gap.
          sideOffset={({ anchor }) => 14 - anchor.height / 2}
          collisionAvoidance={{ side: 'none', align: 'none', fallbackAxisSide: 'none' }}
          positionMethod='fixed'
          ref={inherit}
          // Hidden with its thumb when a box it sits in scrolls it out of view.
          className='pointer-events-none isolate z-50 h-0 w-(--anchor-width) data-anchor-hidden:invisible'
        >
          <div
            dir={dir}
            data-following={following || undefined}
            style={
              { '--slider-value': percent, '--slider-from': next.from } as CSSProperties
            }
            className={cn(
              trackDirClassName,
              // A percentage of its own width, the track's, so a resize moves it at once rather than gliding.
              'absolute start-0 bottom-0 w-full [translate:calc(var(--track-dir)*var(--slider-value)*1%)_0]',
              // It appears where the thumb was, so it glides beside a thumb that the keys moved.
              'starting:[translate:calc(var(--track-dir)*var(--slider-from)*1%)_0]',
              // Glides with the thumb after a press or a key, and trails it a little while dragged.
              'transition-[translate] duration-(--motion-layout-duration) ease-(--motion-layout-easing) data-following:duration-(--motion-press-duration) data-following:ease-(--motion-press-easing) motion-reduce:transition-none',
            )}
          >
            <TooltipPrimitive.Popup
              aria-hidden
              data-slot='slider-thumb-value'
              className={cn(
                'bg-primary text-primary-foreground absolute start-0 bottom-0 flex h-6 -translate-x-1/2 items-center rounded-full px-2 text-xs font-medium whitespace-nowrap tabular-nums shadow-md outline-hidden rtl:translate-x-1/2 forced-colors:border',
                // Rises out of the thumb, from a little below and smaller, and sinks back into it.
                'origin-bottom data-ending-style:[transform:translateY(var(--slider-value-rise,6px))_scale(0.6)] data-ending-style:opacity-0 data-starting-style:[transform:translateY(var(--slider-value-rise,6px))_scale(0.6)] data-starting-style:opacity-0',
                '[transition:transform_var(--motion-enter-duration)_var(--motion-enter-easing),opacity_var(--motion-enter-duration)_var(--motion-enter-easing)] data-ending-style:[transition:transform_var(--motion-exit-duration)_var(--motion-exit-easing),opacity_var(--motion-exit-duration)_var(--motion-exit-easing)] motion-reduce:[transition-property:opacity] motion-reduce:data-ending-style:[transform:none] motion-reduce:data-starting-style:[transform:none]',
              )}
            >
              {children}
            </TooltipPrimitive.Popup>
          </div>
        </TooltipPrimitive.Positioner>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  )
}

function SliderLabel({
  className,
  ...props
}: Omit<SliderPrimitive.Label.Props, 'className'> & { className?: string }) {
  return (
    <SliderPrimitive.Label
      data-slot='slider-label'
      className={cn(
        trackLabelClassName,
        'group-data-disabled/slider:text-muted-foreground',
        className,
      )}
      {...props}
    />
  )
}

function SliderValue({
  className,
  ...props
}: Omit<SliderPrimitive.Value.Props, 'className'> & { className?: string }) {
  return (
    <SliderPrimitive.Value
      data-slot='slider-value'
      className={cn('text-muted-foreground ms-auto shrink-0 tabular-nums', className)}
      {...props}
    />
  )
}

export {
  revealStep,
  Slider,
  SliderLabel,
  SliderValue,
  thumbCount,
  thumbShowsValue,
  trailStep,
}
