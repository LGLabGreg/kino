'use client'

import { Collapsible, CollapsiblePanel } from '@/registry/components/kino/collapsible'
import { inputControlClassName } from '@/registry/components/kino/input'
import {
  InputGroup,
  InputGroupAddon,
  inputGroupBesideStart,
  InputGroupButton,
} from '@/registry/components/kino/input-group'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/registry/components/kino/select'
import { IconPlaceholder } from '@/registry/icons/icon-placeholder'
import { choicePressHandlers } from '@/registry/lib/choice'
import { thumbDotClassName, trackDirClassName } from '@/registry/lib/track'
import {
  type Color,
  type ColorFormat,
  colorDistance,
  contrastRatio,
  convertColor,
  formatColor,
  isInGamut,
  parseColor,
} from '@ui-sdk/core/color'
import {
  type ColorChannel,
  ColorPickerArea as ColorPickerAreaPrimitive,
  ColorPickerAreaCanvas as ColorPickerAreaCanvasPrimitive,
  ColorPickerAreaThumb as ColorPickerAreaThumbPrimitive,
  ColorPickerChannelInput as ColorPickerChannelInputPrimitive,
  type ColorPickerController,
  ColorPickerEyeDropper as ColorPickerEyeDropperPrimitive,
  ColorPickerInput as ColorPickerInputPrimitive,
  ColorPicker as ColorPickerPrimitive,
  ColorPickerSlider as ColorPickerSliderPrimitive,
  ColorPickerSliderThumb as ColorPickerSliderThumbPrimitive,
  type ColorPickerSpace,
  type ColorPickerState,
  ColorPickerSwatch as ColorPickerSwatchPrimitive,
  ColorPickerSwatches as ColorPickerSwatchesPrimitive,
  ColorPickerSwatchItem as ColorPickerSwatchItemPrimitive,
  type ColorPickerValueChangeDetails,
  type ColorPickerValueCommitDetails,
  createColorPickerController,
} from '@ui-sdk/react/color-picker'
import { Toggle as TogglePrimitive } from '@ui-sdk/react/toggle'
import {
  type ComponentProps,
  createContext,
  type CSSProperties,
  type ReactNode,
  use,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'

import { cn } from '@/lib/utils'

/*
 * ui-sdk's Color picker with Kino's look. ui-sdk holds the colour, the
 * pointer and the keys; Kino draws the tracks and thumbs, glides a thumb on
 * `layout` to a colour picked, typed or keyed, and has it follow a drag at
 * once.
 */

type ChangeListener = (value: string, details: ColorPickerValueChangeDetails) => void

interface ColorPickerContextValue {
  state: ColorPickerState
  format: ColorFormat
  setFormat: (format: ColorFormat) => void
  /** Sets a colour as a press on a member of the picker does: a change, then a commit. */
  choose: (value: string, details: { event?: Event; source: CommitSource }) => void
  /** Hears every change, before the picker's own `onValueChange`. */
  listen: (listener: ChangeListener) => () => void
}

type CommitSource = ColorPickerValueCommitDetails['source']

const ColorPickerContext = createContext<ColorPickerContextValue | null>(null)

function useColorPicker() {
  const context = use(ColorPickerContext)
  if (!context) throw new Error('A Color picker part must sit inside a ColorPicker.')
  return context
}

/** How a picker writes its value when no format is given: as ui-sdk does, hex for HSV and the space otherwise. */
const formatOf = (space: ColorPickerSpace | undefined): ColorFormat =>
  space === undefined || space === 'hsv' ? 'hex' : space

type ColorPickerProps = Omit<
  ComponentProps<typeof ColorPickerPrimitive>,
  'className' | 'children' | 'format'
> & {
  className?: string
  children?: ReactNode
  /** How the value is written; `ColorPickerFormat` changes it. */
  format?: ColorFormat
  defaultFormat?: ColorFormat
  onFormatChange?: (format: ColorFormat) => void
}

function ColorPicker({
  space,
  gamut = false,
  format: formatProp,
  defaultFormat,
  onFormatChange,
  value,
  defaultValue,
  onValueChange,
  onValueCommit,
  controller: controllerProp,
  className,
  children,
  'aria-label': ariaLabel = 'Colour picker',
  ...props
}: ColorPickerProps) {
  const [formatState, setFormatState] = useState(defaultFormat ?? formatOf(space))
  const format = formatProp ?? formatState
  const [ownController] = useState(createColorPickerController)
  const controller: ColorPickerController = controllerProp ?? ownController
  // While a drag runs the thumbs follow it at once; a press, a key or a new colour glides.
  // A drag ends in a commit; one that ends where it began commits nothing, and the next
  // change, which commits at once, clears it before it draws.
  const [following, setFollowing] = useState(false)
  const listeners = useRef(new Set<ChangeListener>())
  const commitRef = useRef(onValueCommit)
  useLayoutEffect(() => {
    commitRef.current = onValueCommit
  })

  // A new format rewrites the value: ui-sdk writes it in the format it has once it renders.
  const written = useRef(format)
  useLayoutEffect(() => {
    if (written.current === format) return
    written.current = format
    controller.setValue(controller.getValue())
  }, [controller, format])

  const context = (state: ColorPickerState): ColorPickerContextValue => ({
    state,
    format,
    setFormat: (next) => {
      setFormatState(next)
      onFormatChange?.(next)
    },
    choose: (value, { event, source }) => {
      if (!controller.setValue(value, { reason: 'item-press', event })) return
      const color = parseColor(value)
      if (!color) return
      commitRef.current?.(controller.getValue(), {
        reason: 'item-press',
        event: event as MouseEvent | KeyboardEvent | undefined,
        source,
        color: convertColor(color, state.space),
      })
    },
    listen: (listener) => {
      listeners.current.add(listener)
      return () => listeners.current.delete(listener)
    },
  })

  return (
    <ColorPickerPrimitive
      space={space}
      gamut={gamut}
      format={format}
      value={value === undefined ? undefined : inFormat(value, format)}
      defaultValue={
        defaultValue === undefined ? undefined : inFormat(defaultValue, format)
      }
      controller={controller}
      aria-label={ariaLabel}
      data-following={following || undefined}
      onValueChange={(value, details) => {
        for (const listener of listeners.current) listener(value, details)
        if (details.reason === 'drag') setFollowing(true)
        onValueChange?.(value, details)
      }}
      onValueCommit={(value, details) => {
        setFollowing(false)
        onValueCommit?.(value, details)
      }}
      className={cn(
        'group/color-picker flex w-full min-w-0 flex-col gap-(--surface-gap)',
        trackDirClassName,
        className,
      )}
      {...props}
    >
      {(state) => (
        <ColorPickerContext value={context(state)}>{children}</ColorPickerContext>
      )}
    </ColorPickerPrimitive>
  )
}

// ---------------------------------------------------------------------------
// Swatch

/** The squares a translucent colour is drawn over, in the theme's own colours. */
const checkerboard =
  'repeating-conic-gradient(var(--muted) 0 25%, var(--background) 0 50%) 0 0 / 0.5rem 0.5rem'

/** A colour over the checkerboard, so its alpha shows. */
const swatchBackground = (color: string) =>
  `linear-gradient(${color}, ${color}), ${checkerboard}`

/** `--color-picker-color`, ui-sdk's colour on a part, over the checkerboard. */
const swatchFillClassName =
  '[background:linear-gradient(var(--color-picker-color),var(--color-picker-color)),repeating-conic-gradient(var(--muted)_0_25%,var(--background)_0_50%)_0_0/0.5rem_0.5rem] inset-ring inset-ring-foreground/10 forced-color-adjust-none'

/** The colour as a square, named for screen readers: beside the value, or in a trigger. */
function ColorPickerSwatch({
  className,
  ...props
}: Omit<ComponentProps<typeof ColorPickerSwatchPrimitive>, 'className'> & {
  className?: string
}) {
  return (
    <ColorPickerSwatchPrimitive
      className={cn(
        'inline-block size-4 shrink-0 rounded-(--control-radius-xs)',
        swatchFillClassName,
        className,
      )}
      {...props}
    />
  )
}

// ---------------------------------------------------------------------------
// Area

/** Whether ui-sdk draws an area with a gradient: saturation across, brightness or lightness up, in HSV or HSL. */
function areaHasGradient(
  space: ColorPickerSpace,
  x: ColorChannel | undefined,
  y: ColorChannel | undefined,
) {
  if (space !== 'hsv' && space !== 'hsl') return false
  const down = y ?? (space === 'hsv' ? 'brightness' : 'lightness')
  return (
    (x ?? 'saturation') === 'saturation' &&
    (down === 'brightness' || down === 'lightness')
  )
}

/**
 * A colour channel's dot: filled with `--slider-thumb`, the colour under it,
 * ringed in white and a hairline shadow so it stands out on any colour, in
 * either theme, and kept in forced colours.
 */
const channelThumbClassName =
  'size-5 border-white bg-(--slider-thumb) shadow-[0_0_0_1px_rgb(0_0_0/0.2),0_1px_3px_rgb(0_0_0/0.25)] forced-color-adjust-none'

/** A thumb's place glides on `layout`, and follows a drag at once. */
const thumbMoveClassName =
  'transition-[translate] duration-(--motion-layout-duration) ease-(--motion-layout-easing) group-data-following/color-picker:duration-0 motion-reduce:transition-none'

/**
 * The dot a thumb shows, centred on its point: the same as a channel
 * Slider's, so the two press and focus alike. It shrinks while the area or
 * the track under it is held.
 */
function ThumbDot({ held, className }: { held: string; className: string }) {
  return (
    <span
      className={cn(
        'pointer-events-auto absolute start-0 flex size-6 [translate:calc(var(--track-dir)*-50%)_-50%] items-center justify-center',
        className,
      )}
    >
      <span aria-hidden className={cn(thumbDotClassName, channelThumbClassName, held)} />
    </span>
  )
}

/**
 * The colour as a surface for two channels: saturation across and
 * brightness up, by default. ui-sdk draws it with a gradient where one can,
 * and with a `ColorPickerAreaCanvas` otherwise, such as OKLCH's chroma by
 * lightness. Without children it holds its thumb, and the canvas it needs.
 */
function ColorPickerArea({
  className,
  children,
  x,
  y,
  ...props
}: Omit<ComponentProps<typeof ColorPickerAreaPrimitive>, 'className'> & {
  className?: string
}) {
  const { state } = useColorPicker()
  return (
    <ColorPickerAreaPrimitive
      x={x}
      y={y}
      className={cn(
        'group/area h-40 w-full shrink-0 rounded-(--control-radius-capped) select-none [background:var(--color-area-background)] inset-ring inset-ring-foreground/10 forced-color-adjust-none data-disabled:pointer-events-none data-disabled:opacity-50',
        className,
      )}
      {...props}
    >
      {children ?? (
        <>
          {areaHasGradient(state.space, x, y) ? null : <ColorPickerAreaCanvas />}
          <ColorPickerAreaThumb />
        </>
      )}
    </ColorPickerAreaPrimitive>
  )
}

/** Paints the area where no gradient can, inside its rounded corners. */
function ColorPickerAreaCanvas({
  className,
  ...props
}: Omit<ComponentProps<typeof ColorPickerAreaCanvasPrimitive>, 'className'> & {
  className?: string
}) {
  return (
    <ColorPickerAreaCanvasPrimitive
      className={cn('rounded-(--control-radius-capped)', className)}
      {...props}
    />
  )
}

/**
 * The area's thumb, a slider screen readers hear as both channels. It spans
 * the area and moves its dot by `translate`, from ui-sdk's `--area-x` and
 * `--area-y`, so it glides on the compositor.
 */
function ColorPickerAreaThumb({
  className,
  style,
  ...props
}: Omit<
  ComponentProps<typeof ColorPickerAreaThumbPrimitive>,
  'className' | 'children'
> & {
  className?: string
}) {
  return (
    <ColorPickerAreaThumbPrimitive
      style={(state) => ({
        '--slider-thumb': cssOf({ ...state.color, alpha: 1 }),
        ...(typeof style === 'function' ? style(state) : style),
      })}
      className={cn(
        // ui-sdk places it with insets, which motion.md won't let us animate: it fills the area instead.
        'group/thumb pointer-events-none absolute inset-0! [translate:calc(var(--track-dir)*var(--area-x)*100%)_calc((1-var(--area-y))*100%)] focus-visible:outline-hidden',
        thumbMoveClassName,
        className,
      )}
      {...props}
    >
      <ThumbDot
        className='top-0'
        held='motion-safe:group-active/area:scale-[calc(1_-_(1_-_var(--motion-press-scale))_*_3)] group-active/area:duration-[calc(var(--motion-press-duration)*0.4)]'
      />
    </ColorPickerAreaThumbPrimitive>
  )
}

// ---------------------------------------------------------------------------
// Channel sliders

/** The channel a slider edits, for its thumb. */
const SliderChannelContext = createContext<ColorChannel>('hue')

/** Every hue at full saturation, red round to red. */
const HUE_STOPS = '#f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00'

/** Along the track, start to end: 90deg, or -90deg right to left, from `--track-dir`. */
const ALONG = 'calc(90deg * var(--track-dir))'

/** A colour as CSS: OKLCH as OKLCH, so a colour past sRGB keeps it, and the rest as `rgb()`. */
const cssOf = (color: Color) =>
  formatColor(color, color.space === 'oklch' ? 'oklch' : 'srgb')

/** OKLCH hue stops every 30 degrees at `l` and `c`. */
const oklchHueStops = (l: number, c: number) =>
  Array.from({ length: 13 }, (_, i) => `oklch(${l} ${c} ${i * 30})`).join(', ')

/** The most chroma a lightness or chroma track runs to: ui-sdk's own end for chroma. */
const MAX_CHROMA = 0.4

/**
 * A channel's track, as a CSS background, and its thumb's colour: the
 * colours the channel runs through with the others held where they are.
 * A hue runs round the wheel even for a grey, which has none of its own.
 * Channels it doesn't draw take ui-sdk's `--color-slider-background`.
 */
function channelPaint(
  color: Color,
  channel: ColorChannel,
): { track: string; thumb: string } {
  const solid = cssOf({ ...color, alpha: 1 })
  if (channel === 'alpha') {
    return {
      track: `linear-gradient(${ALONG}, ${cssOf({ ...color, alpha: 0 })}, ${solid}), ${checkerboard}`,
      thumb: cssOf(color),
    }
  }
  if (channel === 'hue' && color.space !== 'oklch') {
    const hue = convertColor(color, 'hsv').coords[0] ?? 0
    return {
      track: `linear-gradient(${ALONG}, ${HUE_STOPS})`,
      thumb: `hsl(${round(hue)} 100% 50%)`,
    }
  }
  if (color.space === 'oklch') {
    const [l = 0, c = 0, h = 0] = color.coords.map((n) => round(n ?? 0))
    if (channel === 'hue') {
      const shown = Math.max(c, 0.1)
      return {
        track: `linear-gradient(${ALONG} in oklch, ${oklchHueStops(l, shown)})`,
        thumb: `oklch(${l} ${shown} ${h})`,
      }
    }
    if (channel === 'lightness') {
      return {
        track: `linear-gradient(${ALONG} in oklch, oklch(0 ${c} ${h}), oklch(0.5 ${c} ${h}), oklch(1 ${c} ${h}))`,
        thumb: solid,
      }
    }
    if (channel === 'chroma') {
      return {
        track: `linear-gradient(${ALONG} in oklch, oklch(${l} 0 ${h}), oklch(${l} ${MAX_CHROMA} ${h}))`,
        thumb: solid,
      }
    }
  }
  return { track: 'var(--color-slider-background)', thumb: solid }
}

/** Rounded to four places, so the server's arithmetic and the browser's write the same style. */
const round = (n: number) => Math.round(n * 1e4) / 1e4

/**
 * One channel of the colour, such as `hue` or `alpha`, on a track drawn in
 * the colours it runs through. Without children it holds its thumb.
 */
function ColorPickerSlider({
  channel,
  className,
  style,
  children,
  ...props
}: Omit<
  ComponentProps<typeof ColorPickerSliderPrimitive>,
  'className' | 'style' | 'orientation' | 'children'
> & {
  className?: string
  style?: CSSProperties
  /** The thumb; without one it holds its own. */
  children?: ReactNode
}) {
  const { state } = useColorPicker()
  const shown = channel ?? (state.space === 'srgb' ? 'blue' : 'hue')
  const paint = channelPaint(state.color, shown)
  return (
    <SliderChannelContext value={shown}>
      <ColorPickerSliderPrimitive
        channel={channel}
        style={
          {
            '--slider-track': paint.track,
            '--slider-thumb': paint.thumb,
            ...style,
          } as CSSProperties
        }
        className={cn(
          'group/channel flex h-(--control-height-xs) w-full shrink-0 items-center select-none data-disabled:pointer-events-none data-disabled:opacity-50',
          className,
        )}
        {...props}
      >
        {/* A channel's track is its colours, which forced colours must keep. */}
        <span
          aria-hidden
          className='h-3 w-full rounded-full [background:var(--slider-track)] shadow-[inset_0_0_0_1px_var(--border)] forced-color-adjust-none'
        />
        {children ?? <ColorPickerSliderThumb />}
      </ColorPickerSliderPrimitive>
    </SliderChannelContext>
  )
}

/**
 * The slider's thumb. It spans the track and moves its dot by `translate`,
 * from ui-sdk's `--color-slider-thumb-position`, so it glides on the
 * compositor. The alpha channel is called Opacity.
 */
function ColorPickerSliderThumb({
  className,
  ...props
}: Omit<
  ComponentProps<typeof ColorPickerSliderThumbPrimitive>,
  'className' | 'children'
> & {
  className?: string
}) {
  const channel = use(SliderChannelContext)
  return (
    <ColorPickerSliderThumbPrimitive
      aria-label={channel === 'alpha' ? 'Opacity' : undefined}
      className={cn(
        // ui-sdk places it with an inset, which motion.md won't let us animate: it spans the track instead.
        'group/thumb pointer-events-none absolute inset-y-0! start-0! end-0! [translate:calc(var(--track-dir)*var(--color-slider-thumb-position))_0] focus-visible:outline-hidden',
        thumbMoveClassName,
        className,
      )}
      {...props}
    >
      <ThumbDot
        className='top-1/2'
        held='motion-safe:group-active/channel:scale-[calc(1_-_(1_-_var(--motion-press-scale))_*_3)] group-active/channel:duration-[calc(var(--motion-press-duration)*0.4)]'
      />
    </ColorPickerSliderThumbPrimitive>
  )
}

// ---------------------------------------------------------------------------
// Preview

/**
 * The colour, large, and a note when the screen can't show it as it is: a
 * colour past sRGB is kept as it is and drawn as the nearest one the screen
 * shows.
 */
function ColorPickerPreview({ className, ...props }: ComponentProps<'div'>) {
  const { state } = useColorPicker()
  const outside = !isInGamut(state.color, 'srgb')
  return (
    <div className={cn('flex flex-col gap-1.5', className)} {...props}>
      <ColorPickerSwatch className='h-14 w-full rounded-(--control-radius-capped)' />
      <p
        className={cn(
          'text-muted-foreground text-xs transition-opacity duration-(--motion-enter-duration) ease-(--motion-enter-easing)',
          !outside &&
            'opacity-0 duration-(--motion-exit-duration) ease-(--motion-exit-easing)',
          // A wide-gamut screen shows it as it is. CSS knows the screen, so the server's page is the same.
          '[@media(color-gamut:p3)]:invisible',
        )}
        aria-hidden={!outside}
      >
        This screen can’t show this colour, so it’s drawn as the nearest one it can.
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Typing a colour

/** The text the colour's inputs share: written left to right in any language, at the start right to left. */
const colorTextClassName = cn(
  inputControlClassName,
  inputGroupBesideStart,
  'tabular-nums rtl:text-right',
)

/**
 * The colour as text, with its swatch at the start. ui-sdk reads what's
 * typed on Enter or when focus leaves, puts back the colour on Escape, and
 * puts it back too for text that isn't a colour. A colour's name, such as
 * `rebeccapurple`, reads too.
 */
function ColorPickerInput({
  className,
  children,
  'aria-label': ariaLabel = 'Colour',
  ...props
}: Omit<ComponentProps<typeof ColorPickerInputPrimitive>, 'className' | 'children'> & {
  className?: string
  /** Buttons at the end of the box, such as `ColorPickerEyeDropper`. */
  children?: ReactNode
}) {
  return (
    <InputGroup data-color-picker-input='' className={cn('w-full', className)}>
      <InputGroupAddon>
        <ColorPickerSwatch aria-hidden />
      </InputGroupAddon>
      <ColorPickerInputPrimitive
        aria-label={ariaLabel}
        dir='ltr'
        className={colorTextClassName}
        {...props}
      />
      {children}
    </InputGroup>
  )
}

/**
 * One channel as a number, in the units people read it in: 0 to 100 for
 * lightness and opacity, degrees for hue. Its children sit at the end of the
 * box, such as the unit.
 */
function ColorPickerChannelInput({
  className,
  children,
  ...props
}: Omit<
  ComponentProps<typeof ColorPickerChannelInputPrimitive>,
  'className' | 'children'
> & {
  className?: string
  children?: ReactNode
}) {
  return (
    <InputGroup className={cn('h-(--control-height-sm) w-24 shrink-0', className)}>
      <ColorPickerChannelInputPrimitive
        dir='ltr'
        className={cn(colorTextClassName, 'h-full text-end rtl:text-left')}
        {...props}
      />
      {children}
    </InputGroup>
  )
}

const FORMATS: { value: ColorFormat; label: string }[] = [
  { value: 'hex', label: 'Hex' },
  { value: 'srgb', label: 'RGB' },
  { value: 'hsl', label: 'HSL' },
  { value: 'oklch', label: 'OKLCH' },
]

/** Picks how the value is written. Its props go to the Select's trigger. */
function ColorPickerFormat({
  className,
  disabled,
  ...props
}: ComponentProps<typeof SelectTrigger>) {
  const { state, format, setFormat } = useColorPicker()
  return (
    <Select
      items={FORMATS}
      value={format}
      disabled={disabled ?? state.disabled}
      onValueChange={(next) => {
        if (next) setFormat(next)
      }}
    >
      <SelectTrigger
        aria-label='Format'
        className={cn('w-24 shrink-0', className)}
        {...props}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {FORMATS.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

const noSubscribe = () => () => {}

/**
 * Picks a colour from anywhere on the screen, at the end of a
 * `ColorPickerInput`. Only Chrome and Edge on a desktop can, so elsewhere it
 * isn't drawn at all.
 */
function ColorPickerEyeDropper({
  'aria-label': ariaLabel = 'Pick a colour from the screen',
  ...props
}: Omit<ComponentProps<typeof InputGroupButton>, 'children'>) {
  const supported = useSyncExternalStore(
    noSubscribe,
    () => 'EyeDropper' in window,
    () => false,
  )
  if (!supported) return null
  return (
    <InputGroupAddon align='inline-end'>
      <ColorPickerEyeDropperPrimitive
        render={<InputGroupButton size='icon-xs' aria-label={ariaLabel} {...props} />}
      >
        <IconPlaceholder
          lucide='PipetteIcon'
          tabler='IconColorPicker'
          hugeicons='ColorPickerIcon'
          phosphor='EyedropperIcon'
          remixicon='RiSipLine'
          aria-hidden
        />
      </ColorPickerEyeDropperPrimitive>
    </InputGroupAddon>
  )
}

// ---------------------------------------------------------------------------
// Swatches

/** A preset colour and its name. */
interface ColorPreset {
  /** Any CSS colour. */
  value: string
  /** Its name, for screen readers; without one ui-sdk describes it, such as "dark blue". */
  label?: string
}

const swatchesClassName =
  'grid grid-cols-[repeat(auto-fill,var(--control-height-xs))] justify-between gap-2'

/** The ring a picked swatch takes, 2px out from it, and the press it shares with a Radio. */
const swatchItemClassName = cn(
  'group/swatch relative inline-grid size-(--control-height-xs) shrink-0 place-items-center rounded-(--control-radius-xs) *:col-start-1 *:row-start-1',
  'transition-[scale] duration-(--motion-press-duration) ease-(--motion-press-easing) active:duration-[calc(var(--motion-press-duration)*0.4)] data-pressing:duration-[calc(var(--motion-press-duration)*0.4)] motion-safe:active:scale-(--motion-press-scale) motion-safe:data-pressing:scale-(--motion-press-scale)',
  // Focus draws outside the picked ring, so the swatch picked and focused still shows it.
  'focus-visible:outline-ring focus-visible:outline-2 focus-visible:outline-offset-4 forced-colors:focus-visible:outline-[Highlight]',
  // The ring sits 2px out, 2px thick: its corner is the swatch's plus 4px (arbitrary, to follow it).
  'after:border-foreground after:pointer-events-none after:absolute after:-inset-1 after:rounded-[calc(var(--control-radius-xs)+4px)] after:border-2 after:opacity-0 after:transition-[opacity,scale] after:duration-(--motion-press-duration) after:ease-(--motion-press-easing) motion-safe:after:scale-90 data-[selected]:after:opacity-100 motion-safe:data-[selected]:after:scale-100 aria-pressed:after:opacity-100 motion-safe:aria-pressed:after:scale-100',
  'data-disabled:pointer-events-none data-disabled:opacity-50',
)

/** A swatch's tick: in, while it's the colour. */
const tickClassName =
  'size-3.5 opacity-0 transition-[opacity,scale] duration-(--motion-press-duration) ease-(--motion-press-easing) motion-safe:scale-50 group-data-[selected]/swatch:opacity-100 motion-safe:group-data-[selected]/swatch:scale-100 group-aria-pressed/swatch:opacity-100 motion-safe:group-aria-pressed/swatch:scale-100'

function Tick({ light }: { light: boolean }) {
  return (
    <IconPlaceholder
      lucide='CheckIcon'
      tabler='IconCheck'
      hugeicons='Tick02Icon'
      phosphor='CheckIcon'
      remixicon='RiCheckLine'
      aria-hidden
      strokeWidth={3}
      className={cn(tickClassName, light ? 'text-white' : 'text-black')}
    />
  )
}

/**
 * A row of preset colours, a list that's one stop in the tab order: the
 * arrow keys move between them, and Enter, Space or a press picks one. The
 * one that is the colour is picked; while the colour is one of its own, none is.
 */
function ColorPickerSwatches({
  className,
  'aria-label': ariaLabel = 'Presets',
  ...props
}: Omit<ComponentProps<typeof ColorPickerSwatchesPrimitive>, 'className'> & {
  className?: string
}) {
  return (
    <ColorPickerSwatchesPrimitive
      aria-label={ariaLabel}
      className={cn(swatchesClassName, className)}
      {...props}
    />
  )
}

/** One preset colour, inside `ColorPickerSwatches`: picked while it's the colour. */
function ColorPickerSwatchItem({
  value,
  label,
  className,
  onKeyDown,
  onKeyUp,
  onBlur,
  ...props
}: Omit<ComponentProps<typeof ColorPickerSwatchItemPrimitive>, 'className' | 'children'> &
  ColorPreset & { className?: string }) {
  return (
    <ColorPickerSwatchItemPrimitive
      value={value}
      aria-label={label}
      className={cn(swatchItemClassName, swatchFillClassName, className)}
      {...choicePressHandlers({ onKeyDown, onKeyUp, onBlur })}
      {...props}
    >
      <Tick light={prefersLightMark(value)} />
    </ColorPickerSwatchItemPrimitive>
  )
}

/**
 * Presets first: the presets and a Custom swatch after them. Custom opens
 * the children, the controls for a colour of your own, under the row on
 * `layout`; they stay open while the colour is your own, even when a drag
 * passes over a preset's colour. Your own colour is kept while a preset is
 * tried, and Custom puts it back.
 */
function ColorPickerPalette({
  presets,
  className,
  'aria-label': ariaLabel = 'Presets',
  children,
}: {
  /** The colours before Custom; the Palette needs them all to know when the colour is your own. */
  presets: readonly ColorPreset[]
  /** The controls for a colour of your own, such as an area, a hue and an input. */
  children: ReactNode
  className?: string
  'aria-label'?: string
}) {
  const { state, choose, listen } = useColorPicker()
  const values = presets.map((preset) => preset.value)
  const [palette, setPalette] = useState<PaletteState>({ mode: 'preset', own: null })
  const custom = paletteShowsCustom(palette, state.value, values)

  // A preset picked from the row keeps the colour you had, if it was your own, for Custom.
  const latest = useRef({ palette, value: state.value, values })
  useLayoutEffect(() => {
    latest.current = { palette, value: state.value, values }
  })
  useLayoutEffect(
    () =>
      listen((_next, details) => {
        if (details.reason !== 'item-press') return
        const { palette: was, value, values: shown } = latest.current
        setPalette(paletteStep(was, 'preset', value, shown))
      }),
    [listen],
  )

  return (
    <Collapsible
      open={custom}
      aria-label='Custom colour controls'
      // Custom and the presets open and close it, so an agent can't either.
      disabled
      className={className}
    >
      <div className={swatchesClassName}>
        {/* The row is one grid with Custom, which isn't a preset and so isn't in the list. */}
        <ColorPickerSwatches aria-label={ariaLabel} className='contents'>
          {presets.map((preset) => (
            <ColorPickerSwatchItem key={preset.value} {...preset} />
          ))}
        </ColorPickerSwatches>
        {/* Custom is picked, not opened: a preset unpicks it, so pressing it again does nothing. */}
        <TogglePrimitive
          aria-label='Custom colour'
          pressed={custom}
          onPressedChange={(pressed, details) => {
            if (!pressed) return details.cancel()
            // Custom puts your own colour back, if a preset was tried since. Before Custom's own
            // step, which the step that change makes as a preset would otherwise overwrite.
            if (palette.own !== null && palette.own !== state.value) {
              choose(palette.own, details)
            }
            setPalette(paletteStep(palette, 'custom', state.value, values))
          }}
          disabled={state.disabled}
          style={{
            background: custom
              ? swatchBackground('var(--color-picker-color)')
              : `conic-gradient(from 90deg, ${HUE_STOPS})`,
          }}
          className={cn(
            swatchItemClassName,
            'inset-ring inset-ring-foreground/10 forced-color-adjust-none',
          )}
          {...choicePressHandlers({})}
        >
          <IconPlaceholder
            lucide='PlusIcon'
            tabler='IconPlus'
            hugeicons='PlusSignIcon'
            phosphor='PlusIcon'
            remixicon='RiAddLine'
            aria-hidden
            strokeWidth={3}
            className='size-3.5 text-white drop-shadow-[0_1px_1px_rgb(0_0_0/0.4)] transition-[opacity,scale] duration-(--motion-press-duration) ease-(--motion-press-easing) group-aria-pressed/swatch:opacity-0 motion-safe:group-aria-pressed/swatch:scale-50'
          />
          <Tick light={prefersLightMark(state.value)} />
        </TogglePrimitive>
      </div>
      {/* The room above and below keeps the area's thumb and the focus rings clear of the panel's clip. */}
      <CollapsiblePanel className='flex flex-col gap-(--surface-gap) ps-0 pe-0 pt-(--surface-gap) pb-1'>
        {children}
      </CollapsiblePanel>
    </Collapsible>
  )
}

/** What a Palette remembers: whether Custom was picked, and your own colour while a preset is tried. */
interface PaletteState {
  mode: 'preset' | 'custom'
  own: string | null
}

/**
 * A Palette's state once Custom or a preset is picked, while the colour is
 * `value`. Picking a preset keeps the colour you had, if it was your own, for
 * Custom to put back.
 */
function paletteStep(
  state: PaletteState,
  picked: 'preset' | 'custom',
  value: string,
  presets: readonly string[],
): PaletteState {
  if (picked === 'custom') return { ...state, mode: 'custom' }
  return {
    mode: 'preset',
    own: paletteShowsCustom(state, value, presets) ? value : state.own,
  }
}

/**
 * A colour given to the picker, written in its format, as the field shows
 * it: ui-sdk keeps a value as it is given until it changes. A colour the
 * format can't hold, such as one past sRGB in hex, stays as it is, since
 * ui-sdk reads the colour from the value and would clip it. So does text
 * that isn't a colour.
 */
function inFormat(value: string, format: ColorFormat) {
  const color = parseColor(value)
  if (!color) return value
  if (format !== 'oklch' && !isInGamut(color, 'srgb')) return value
  return formatColor(color, format)
}

/** Whether Custom is picked and its controls open: picked, or the colour is no preset. */
function paletteShowsCustom(
  state: PaletteState,
  value: string,
  presets: readonly string[],
) {
  return state.mode === 'custom' || !presets.some((preset) => sameColor(preset, value))
}

/**
 * Whether two CSS colours look the same, as ui-sdk matches a swatch to the
 * colour: a preset written in another format, or rounded, still matches.
 */
function sameColor(one: string, other: string) {
  const a = parseColor(one)
  const b = parseColor(other)
  if (!a || !b) return one === other
  return colorDistance(a, b) < 2e-3 && Math.abs(a.alpha - b.alpha) < 5e-3
}

/**
 * Whether a mark drawn over the colour reads best in white rather than black:
 * the one with the higher WCAG contrast. A colour mostly see-through shows
 * the page under it, so it takes black.
 */
function prefersLightMark(color: string) {
  const parsed = parseColor(color)
  if (!parsed) return true
  if (parsed.alpha <= 0.35) return false
  const opaque = { ...parsed, alpha: 1 }
  return contrastRatio(WHITE, opaque) >= contrastRatio(BLACK, opaque)
}

const WHITE: Color = { space: 'srgb', coords: [1, 1, 1], alpha: 1 }
const BLACK: Color = { space: 'srgb', coords: [0, 0, 0], alpha: 1 }

export {
  ColorPicker,
  ColorPickerArea,
  ColorPickerAreaCanvas,
  ColorPickerAreaThumb,
  ColorPickerChannelInput,
  ColorPickerEyeDropper,
  ColorPickerFormat,
  ColorPickerInput,
  ColorPickerPalette,
  ColorPickerPreview,
  ColorPickerSlider,
  ColorPickerSliderThumb,
  ColorPickerSwatch,
  ColorPickerSwatches,
  ColorPickerSwatchItem,
  channelPaint,
  inFormat,
  paletteShowsCustom,
  paletteStep,
  prefersLightMark,
  sameColor,
}
export type { ColorPickerProps, ColorPreset }
