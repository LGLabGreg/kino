'use client'

import { Tooltip } from '@/registry/components/kino/tooltip'
import { numberFormatter } from '@/registry/lib/number-format'
import { markResizing } from '@/registry/lib/resize'
import {
  thumbDotClassName,
  trackClassName,
  trackDirClassName,
  trackFillClassName,
  trackHeaderClassName,
  trackLabelClassName,
  trackRootClassName,
  valuePercent,
} from '@/registry/lib/track'
import { type PartProps, renderElement } from '@ui-sdk/react/primitive'
import {
  SliderControl as SliderControlPrimitive,
  SliderIndicator as SliderIndicatorPrimitive,
  Slider as SliderPrimitive,
  SliderThumb as SliderThumbPrimitive,
  SliderTrack as SliderTrackPrimitive,
  SliderValue as SliderValuePrimitive,
  type SliderValueChangeReason,
} from '@ui-sdk/react/slider'
import { TooltipContent as TooltipContentPrimitive } from '@ui-sdk/react/tooltip'
import {
  type ComponentProps,
  createContext,
  type CSSProperties,
  Fragment,
  type ReactNode,
  use,
  useCallback,
  useId,
  useLayoutEffect,
  useMemo,
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
  | { type: 'change'; reason: SliderValueChangeReason; thumb: number }
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
        keyed: event.reason === 'step-key' ? event.thumb : -1,
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
const sliderTrackClassName = cn(
  trackClassName,
  'forced-colors:group-has-aria-invalid/slider:outline-2 forced-colors:group-has-aria-invalid/slider:outline-dashed forced-colors:group-aria-invalid/slider:outline-2 forced-colors:group-aria-invalid/slider:outline-dashed',
)

// ui-sdk's Field marks a single thumb's input invalid, and a range's group.
const sliderThumbClassName = cn(
  thumbDotClassName,
  'bg-background border-primary size-4 shadow-sm forced-colors:border-[CanvasText]',
  'group-has-aria-invalid/slider:border-destructive group-has-aria-invalid/slider:ring-destructive/20 dark:group-has-aria-invalid/slider:ring-destructive/40',
  'group-aria-invalid/slider:border-destructive group-aria-invalid/slider:ring-destructive/20 dark:group-aria-invalid/slider:ring-destructive/40',
  'group-data-disabled/slider:ring-0',
)

/** The slider's label's id, for its thumbs or its group, and the text the visible value shows. */
const SliderContext = createContext<{
  labelId: string
  labelled: (on: boolean) => void
  display: (value: number) => string
} | null>(null)

// ui-sdk places a thumb with `inset-inline` and the fill with `width`, which
// motion.md won't let us animate. The thumb is pinned to the start and moved
// with `translate`, against the control's width (`cqw`: the control is a size
// container), and the fill is clipped, so both glide on the compositor.

type SliderProps<Value extends number | number[]> = Omit<
  ComponentProps<typeof SliderPrimitive<Value>>,
  'orientation' | 'format' | 'className' | 'children'
> & {
  className?: string
  /** How the value is written, in its thumb's number and in `SliderValue`. */
  format?: Intl.NumberFormatOptions
  /** What a screen reader hears for a value, from its written form; the written form by default. */
  getAriaValueText?: (formatted: string, value: number) => string
  /** Names the thumb at `index` of a range, such as "Lowest price". */
  getAriaLabel?: (index: number) => string
  /** Names a slider that has no `SliderLabel` or Field. */
  'aria-label'?: string
  /** The label and value, in a row above the track. */
  children?: ReactNode
}

function Slider<Value extends number | number[]>({
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
  onValueCommit,
  onFocus,
  onBlur,
  getAriaLabel,
  getAriaValueText,
  'aria-label': ariaLabel,
  'aria-describedby': ariaDescribedBy,
  style,
  ...props
}: SliderProps<Value>) {
  const count = thumbCount(value ?? defaultValue)
  const labelId = useId()
  const [hasLabel, setHasLabel] = useState(false)
  const [reveal, send] = useReducer(revealStep, HIDDEN)
  const formatter = numberFormatter(locale, format)
  const display = useCallback((next: number) => formatter.format(next), [formatter])
  const context = useMemo(
    () => ({ labelId, labelled: setHasLabel, display }),
    [labelId, display],
  )
  const [control, setControl] = useState<HTMLDivElement | null>(null)
  const controlRef = useCallback((element: HTMLDivElement | null) => {
    setControl(element)
    // Thumbs sit in `cqw`, so while the slider resizes they move at once.
    return markResizing(element)
  }, [])
  const range = count > 1

  return (
    <SliderContext value={context}>
      <SliderPrimitive<Value>
        value={value}
        defaultValue={defaultValue}
        min={min}
        max={max}
        locale={locale}
        disabled={disabled}
        format={(next) => {
          if (next === null) return ''
          return getAriaValueText ? getAriaValueText(display(next), next) : display(next)
        }}
        onValueChange={(next, details) => {
          send({ type: 'change', reason: details.reason, thumb: details.thumb ?? -1 })
          onValueChange?.(next, details)
        }}
        onValueCommit={(next, details) => {
          send({ type: 'commit' })
          onValueCommit?.(next, details)
        }}
        onFocus={(event) => {
          send({ type: 'focus' })
          onFocus?.(event)
        }}
        onBlur={(event) => {
          send({ type: 'blur' })
          onBlur?.(event)
        }}
        aria-label={range ? ariaLabel : undefined}
        aria-labelledby={range && hasLabel && !ariaLabel ? labelId : undefined}
        style={(state) =>
          ({
            ...(typeof style === 'function' ? style(state) : style),
            '--slider-start': range
              ? valuePercent([state.value].flat()[0] ?? min, min, max)
              : 0,
            '--slider-end': valuePercent([state.value].flat().at(-1) ?? min, min, max),
          }) as CSSProperties
        }
        // ui-sdk marks a press on the track as dragging too, which still glides; only a drag follows at once.
        data-following={reveal.dragged >= 0 || undefined}
        className={cn(trackRootClassName, 'group/slider', className)}
        {...props}
      >
        {(state) => {
          const values = [state.value].flat()
          return (
            <>
              {children ? (
                <div data-slider-header='' className={trackHeaderClassName}>
                  {children}
                </div>
              ) : null}
              <SliderControlPrimitive
                ref={controlRef}
                onPointerDown={() => send({ type: 'press' })}
                className='group/control @container relative flex h-(--control-height-xs) w-full touch-none items-center select-none data-disabled:pointer-events-none data-disabled:opacity-50'
              >
                <SliderTrackPrimitive className={sliderTrackClassName}>
                  <SliderIndicatorPrimitive
                    // ui-sdk sizes the fill with `width`, which moves on the main thread: it stays the track's width and is clipped instead.
                    render={(fill) => <span {...fill} style={undefined} />}
                    className={cn(
                      trackFillClassName,
                      'pointer-events-none inset-x-0',
                      'transition-[clip-path] duration-(--motion-layout-duration) ease-(--motion-layout-easing) group-data-following/slider:duration-0 motion-reduce:transition-none',
                      '[clip-path:inset(0_calc(100%-var(--slider-end)*1%)_0_calc(var(--slider-start)*1%)_round_9999px)]',
                      'rtl:[clip-path:inset(0_calc(var(--slider-start)*1%)_0_calc(100%-var(--slider-end)*1%)_round_9999px)]',
                      'group-has-aria-invalid/slider:bg-destructive group-aria-invalid/slider:bg-destructive',
                    )}
                  />
                  {Array.from({ length: count }, (_, index) => (
                    // oxlint-disable-next-line react/no-array-index-key -- a thumb is its index in the value
                    <Fragment key={index}>
                      <SliderThumbPrimitive
                        index={index}
                        // A range's thumbs take the slider's name too, unless `getAriaLabel` names each.
                        aria-label={getAriaLabel?.(index) ?? ariaLabel}
                        aria-labelledby={
                          getAriaLabel || ariaLabel || !hasLabel ? undefined : labelId
                        }
                        aria-describedby={ariaDescribedBy}
                        // ui-sdk places a thumb with `inset-inline`, which moves on the main thread, so the thumb takes our place instead.
                        render={(thumb, { percent }) => (
                          <div
                            {...thumb}
                            style={{ '--slider-value': percent } as CSSProperties}
                          />
                        )}
                        onPointerEnter={() => send({ type: 'enter', thumb: index })}
                        onPointerLeave={() => send({ type: 'leave', thumb: index })}
                        className={cn(
                          'group/thumb absolute start-0 top-1/2 flex size-6 [translate:calc(var(--track-dir)*(var(--slider-value)*1cqw-50%))_-50%] items-center justify-center rounded-full data-dragging:z-2 has-focus-visible:z-1',
                          // After a press on the track or a key, it glides on `layout`; while dragged, it follows the pointer at once.
                          'transition-[translate] duration-(--motion-layout-duration) ease-(--motion-layout-easing) group-data-following/slider:duration-0 group-data-resizing/control:transition-none motion-reduce:transition-none',
                        )}
                      >
                        <span aria-hidden className={sliderThumbClassName} />
                      </SliderThumbPrimitive>
                      <SliderThumbValue
                        control={control}
                        open={!state.disabled && thumbShowsValue(reveal, index)}
                        following={reveal.dragged >= 0}
                        percent={valuePercent(values[index] ?? min, min, max)}
                      >
                        {display(values[index] ?? min)}
                      </SliderThumbValue>
                    </Fragment>
                  ))}
                </SliderTrackPrimitive>
              </SliderControlPrimitive>
            </>
          )
        }}
      </SliderPrimitive>
    </SliderContext>
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
 * The line through the middle of the control, as wide as it, that a thumb's
 * number is placed above: the number then slides along it in CSS, in step
 * with the thumb, rather than being placed again on every frame.
 */
function midline(control: HTMLElement) {
  return {
    getBoundingClientRect() {
      const box = control.getBoundingClientRect()
      return new DOMRect(box.left, box.top + box.height / 2, box.width, 0)
    },
  }
}

/**
 * A thumb's number, above it, in Kino's Tooltip: in the top layer, so no box
 * that clips, such as a Card, cuts it off. The tooltip is as wide as the
 * control, and the number slides along it.
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
  const [trail, setTrail] = useState<ValueTrail>({ percent, open, from: percent })
  const next = trailStep(trail, percent, open)
  if (next !== trail) setTrail(next)
  const anchor = useMemo(() => (control ? midline(control) : null), [control])
  return (
    <Tooltip open={open && anchor !== null}>
      <TooltipContentPrimitive
        anchor={anchor}
        side='top'
        align='start'
        // The thumb's 8px radius and a 6px gap above the track's middle.
        sideOffset={14}
        aria-hidden
        // The number repeats the thumb's value, which the thumb says itself.
        data-agent-hidden
        className={cn(
          trackDirClassName,
          'group/value pointer-events-none isolate h-0 w-(--anchor-width) overflow-visible',
        )}
      >
        <div
          data-following={following || undefined}
          style={
            { '--slider-value': percent, '--slider-from': next.from } as CSSProperties
          }
          className={cn(
            // A percentage of its own width, the track's, so a resize moves it at once rather than gliding.
            'absolute start-0 bottom-0 w-full [translate:calc(var(--track-dir)*var(--slider-value)*1%)_0]',
            // It appears where the thumb was, so it glides beside a thumb that the keys moved.
            'starting:[translate:calc(var(--track-dir)*var(--slider-from)*1%)_0]',
            // Glides with the thumb after a press or a key, and trails it a little while dragged.
            'transition-[translate] duration-(--motion-layout-duration) ease-(--motion-layout-easing) data-following:duration-(--motion-press-duration) data-following:ease-(--motion-press-easing) motion-reduce:transition-none',
          )}
        >
          <span
            data-slider-thumb-value=''
            className={cn(
              'bg-primary text-primary-foreground absolute start-0 bottom-0 flex h-6 -translate-x-1/2 items-center rounded-full px-2 text-xs font-medium whitespace-nowrap tabular-nums shadow-md rtl:translate-x-1/2 forced-colors:border',
              // Rises out of the thumb, from a little below and smaller, and sinks back into it.
              'origin-bottom group-data-ending-style/value:[transform:translateY(var(--slider-value-rise,6px))_scale(0.6)] group-data-ending-style/value:opacity-0 group-data-starting-style/value:[transform:translateY(var(--slider-value-rise,6px))_scale(0.6)] group-data-starting-style/value:opacity-0',
              '[transition:transform_var(--motion-enter-duration)_var(--motion-enter-easing),opacity_var(--motion-enter-duration)_var(--motion-enter-easing)] group-data-ending-style/value:[transition:transform_var(--motion-exit-duration)_var(--motion-exit-easing),opacity_var(--motion-exit-duration)_var(--motion-exit-easing)] motion-reduce:[transition-property:opacity] motion-reduce:group-data-ending-style/value:[transform:none] motion-reduce:group-data-starting-style/value:[transform:none]',
            )}
          >
            {children}
          </span>
        </div>
      </TooltipContentPrimitive>
    </Tooltip>
  )
}

/** The slider's name, in the row above the track: it names its thumb, or a range's group. */
function SliderLabel({
  className,
  render,
  ...props
}: Omit<PartProps<'div'>, 'className'> & { className?: string }) {
  const slider = use(SliderContext)
  const labelled = slider?.labelled
  useLayoutEffect(() => {
    labelled?.(true)
    return () => labelled?.(false)
  }, [labelled])
  return renderElement(
    'div',
    {
      id: slider?.labelId,
      'data-slider-label': '',
      className: cn(
        trackLabelClassName,
        'group-data-disabled/slider:text-muted-foreground',
        className,
      ),
      ...props,
    },
    render,
  )
}

/** The value, written as the slider's `format` says, a range's two joined with an en dash. Children replace it. */
function SliderValue({
  className,
  children,
  ...props
}: Omit<ComponentProps<typeof SliderValuePrimitive>, 'className'> & {
  className?: string
}) {
  const display = use(SliderContext)?.display
  return (
    <SliderValuePrimitive
      className={cn('text-muted-foreground ms-auto shrink-0 tabular-nums', className)}
      {...props}
    >
      {children ??
        (({ value, text }) => (display ? [value].flat().map(display).join(' – ') : text))}
    </SliderValuePrimitive>
  )
}

export {
  revealStep,
  Slider,
  SliderLabel,
  SliderValue,
  sliderThumbClassName,
  sliderTrackClassName,
  thumbCount,
  thumbShowsValue,
  trailStep,
}
