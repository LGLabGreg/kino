'use client'

import { Collapsible, CollapsibleContent } from '@/registry/components/kino/collapsible'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@/registry/components/kino/input-group'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/registry/components/kino/select'
import { Slider } from '@/registry/components/kino/slider'
import { IconPlaceholder } from '@/registry/icons/icon-placeholder'
import { choicePressHandlers } from '@/registry/lib/choice'
import { mergeRefs } from '@/registry/lib/refs'
import { markResizing } from '@/registry/lib/resize'
import {
  channelThumbClassName,
  thumbDotClassName,
  trackDirClassName,
} from '@/registry/lib/track'
import { useDirection } from '@base-ui/react/direction-provider'
import { Radio as RadioPrimitive } from '@base-ui/react/radio'
import { RadioGroup as RadioGroupPrimitive } from '@base-ui/react/radio-group'
import {
  type ComponentProps,
  createContext,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  use,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'

import { cn } from '@/lib/utils'

/** Hue in degrees, saturation and brightness from 0 to 1: the area's x is saturation, its y brightness. */
interface Hsb {
  h: number
  s: number
  b: number
}

/** Lightness 0 to 1, chroma 0 to about 0.4, hue in degrees. */
interface Oklch {
  l: number
  c: number
  h: number
}

/** Red, green and blue from 0 to 1. */
interface Rgb {
  r: number
  g: number
  b: number
}

/** The spaces a picker edits in: HSB for an area, OKLCH for channels that mean what they say. */
type ColorSpace = 'hsb' | 'oklch'

/** How the value is written. */
type ColorFormat = 'hex' | 'rgb' | 'hsl' | 'oklch'

/**
 * A colour as it was read or set, in the space it's in, with alpha from 0 to
 * 1. An HSB colour read from OKLCH keeps the OKLCH it came from, so writing
 * it back as OKLCH, or showing it on a wide-gamut screen, loses nothing.
 */
type Color =
  | { space: 'rgb'; rgb: Rgb; alpha: number }
  | { space: 'hsb'; hsb: Hsb; alpha: number; oklch?: Oklch }
  | { space: 'oklch'; oklch: Oklch; alpha: number }

/** The colour a picker edits, in its own space. */
type EditColor = Extract<Color, { space: ColorSpace }>

interface ColorPickerContextValue {
  color: EditColor
  /** The colour as CSS in `format`. */
  value: string
  format: ColorFormat
  setFormat: (format: ColorFormat) => void
  disabled: boolean
  /** Sets the colour, as an edit still under way, and returns it as written. */
  change: (color: EditColor) => string
  /** Ends an edit: a drag let go, a key, a typed value, a preset. */
  commit: (value: string) => void
  /** Sets a colour from outside the picker's space and ends the edit. */
  pick: (color: Color) => void
}

const ColorPickerContext = createContext<ColorPickerContextValue | null>(null)

function useColorPicker() {
  const context = use(ColorPickerContext)
  if (!context) throw new Error('A Color picker part must sit inside a ColorPicker.')
  return context
}

/** The colour last set and how it was written, so the same value coming back in isn't read again. */
interface Held {
  color: EditColor
  written: string
}

const BLACK: Color = { space: 'rgb', rgb: { r: 0, g: 0, b: 0 }, alpha: 1 }

interface ColorPickerProps extends Omit<
  ComponentProps<'div'>,
  'defaultValue' | 'onChange'
> {
  /**
   * A CSS colour in hex, `rgb()`, `hsl()`, `oklch()` or `color(srgb …)`. A
   * value it can't read leaves the colour where it was.
   */
  value?: string
  defaultValue?: string
  /** Called on every change, including each step of a drag. */
  onValueChange?: (value: string) => void
  /** Called once a drag, a key press, a typed value or a preset ends, with the colour as it then is. */
  onValueCommitted?: (value: string) => void
  /** The space it edits in: HSB for `ColorPickerArea`, OKLCH for the channel sliders. Hue follows it. */
  space?: ColorSpace
  format?: ColorFormat
  defaultFormat?: ColorFormat
  onFormatChange?: (format: ColorFormat) => void
  disabled?: boolean
}

function ColorPicker({
  space = 'hsb',
  value,
  defaultValue,
  onValueChange,
  onValueCommitted,
  format: formatProp,
  defaultFormat,
  onFormatChange,
  disabled = false,
  className,
  children,
  ...props
}: ColorPickerProps) {
  const [formatState, setFormatState] = useState<ColorFormat>(
    defaultFormat ?? (space === 'oklch' ? 'oklch' : 'hex'),
  )
  const format = formatProp ?? formatState
  const [held, setHeld] = useState<Held>(() => {
    const color = inSpace(parseColor(value ?? defaultValue ?? '') ?? BLACK, space)
    return { color, written: writeColor(color, format) }
  })
  // Controlled, the colour moves only when `value` follows; the held colour
  // keeps the hue a grey has lost.
  const color = shownColor(held, value, space)
  const current = writeColor(color, format)

  const write = (next: EditColor, nextFormat: ColorFormat) => {
    const written = writeColor(next, nextFormat)
    setHeld({ color: next, written })
    if (written !== current) onValueChange?.(written)
    return written
  }
  const change = (next: EditColor) => write(next, format)
  const commit = (written: string) => onValueCommitted?.(written)

  const context: ColorPickerContextValue = {
    color,
    value: current,
    format,
    setFormat: (next) => {
      setFormatState(next)
      onFormatChange?.(next)
      write(color, next)
    },
    disabled,
    change,
    commit,
    pick: (next) => commit(change(inSpace(next, space, color))),
  }

  return (
    <ColorPickerContext value={context}>
      <div
        data-slot='color-picker'
        role='group'
        aria-label='Colour picker'
        data-disabled={disabled || undefined}
        className={cn('flex w-full min-w-0 flex-col gap-(--surface-gap)', className)}
        {...props}
      >
        {children}
      </div>
    </ColorPickerContext>
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

/**
 * A colour shown as a square: the current colour beside a value, or in a
 * trigger. It's a picture of a value, so it's hidden from screen readers;
 * the text beside it names the colour. It needs no ColorPicker around it.
 */
function ColorPickerSwatch({
  color,
  className,
  style,
  ...props
}: Omit<ComponentProps<'span'>, 'color' | 'children'> & {
  /** Any CSS colour. */
  color: string
}) {
  return (
    <span
      data-slot='color-picker-swatch'
      aria-hidden
      style={{ background: swatchBackground(color), ...style }}
      className={cn(
        'inline-block size-4 shrink-0 rounded-(--control-radius-xs) inset-ring inset-ring-foreground/10 forced-color-adjust-none',
        className,
      )}
      {...props}
    />
  )
}

// ---------------------------------------------------------------------------
// Area

const percent = (n: number) => `${Math.round(n * 100)}%`

/**
 * Saturation across and brightness down, at the colour's hue. The thumb
 * glides on `layout` to a colour picked, typed or keyed, and follows a drag
 * at once, as a Slider's does. Its keyboard and screen reader controls are
 * two hidden range inputs, one per axis, so touch screen readers can move
 * each one.
 */
function ColorPickerArea({
  ref,
  className,
  style,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onLostPointerCapture,
  'aria-label': ariaLabel = 'Saturation and brightness',
  ...props
}: Omit<ComponentProps<'div'>, 'children'>) {
  const { color, change, commit, disabled } = useColorPicker()
  const rtl = useDirection() === 'rtl'
  const [following, setFollowing] = useState(false)
  const [held, setHeld] = useState(false)
  // The colour a press has set so far, committed when it is let go.
  const pressed = useRef<string | null>(null)
  const id = useId()
  const hsb = toHsb(color)
  const name = colorName(color)

  const set = (next: Hsb) =>
    change(inSpace({ space: 'hsb', hsb: next, alpha: color.alpha }, color.space, color))

  const move = (event: PointerEvent<HTMLDivElement>) => {
    const { s, b } = areaPoint(
      event.currentTarget.getBoundingClientRect(),
      event.clientX,
      event.clientY,
      rtl,
    )
    pressed.current = set({ h: hsb.h, s, b })
  }

  const end = () => {
    setFollowing(false)
    setHeld(false)
    if (pressed.current === null) return
    commit(pressed.current)
    pressed.current = null
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const next = areaKeyMove(hsb, event.key, event.shiftKey, rtl)
    if (!next) return
    event.preventDefault()
    commit(set({ h: hsb.h, ...next }))
  }

  const thumbStyle = {
    // Rounded, so the server's arithmetic and the browser's write the same style.
    '--area-x': Math.round(hsb.s * 10000) / 100,
    '--area-y': Math.round(hsb.b * 10000) / 100,
    translate:
      'calc(var(--track-dir) * (var(--area-x) * 1cqw - 50%)) calc((100 - var(--area-y)) * 1cqh - 50%)',
    '--slider-thumb': cssColor({ space: 'hsb', hsb, alpha: 1 }),
  } as CSSProperties

  return (
    <div
      data-slot='color-picker-area'
      role='group'
      aria-label={ariaLabel}
      ref={mergeRefs(markResizing, ref)}
      data-following={following || undefined}
      data-disabled={disabled || undefined}
      {...props}
      onPointerDown={(event) => {
        onPointerDown?.(event)
        if (event.defaultPrevented || disabled || event.button !== 0) return
        event.preventDefault()
        event.currentTarget.setPointerCapture(event.pointerId)
        setHeld(true)
        // A press shows no focus ring, as a press on a channel Slider doesn't.
        document
          .getElementById(`${id}-s`)
          ?.focus({ preventScroll: true, focusVisible: false })
        move(event)
      }}
      onPointerMove={(event) => {
        onPointerMove?.(event)
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
        setFollowing(true)
        move(event)
      }}
      onPointerUp={(event) => {
        onPointerUp?.(event)
        end()
      }}
      onLostPointerCapture={(event) => {
        onLostPointerCapture?.(event)
        end()
      }}
      style={{ '--area-hue': `hsl(${hsb.h} 100% 50%)`, ...style } as CSSProperties}
      className={cn(
        'group/area relative h-40 w-full touch-none rounded-(--control-radius-capped) select-none [container-type:size] forced-color-adjust-none',
        trackDirClassName,
        // Brightness falls to black at the bottom; saturation rises from white at the start.
        '[background:linear-gradient(to_top,#000,transparent),linear-gradient(to_right,#fff,var(--area-hue))] rtl:[background:linear-gradient(to_top,#000,transparent),linear-gradient(to_left,#fff,var(--area-hue))]',
        'inset-ring inset-ring-foreground/10 data-disabled:pointer-events-none data-disabled:opacity-50',
        className,
      )}
    >
      <div
        data-slot='color-picker-area-thumb'
        data-dragging={held || undefined}
        style={thumbStyle}
        className={cn(
          'group/thumb absolute start-0 top-0 flex size-6 items-center justify-center rounded-full',
          // After a press, a key or a new colour it glides on `layout`; dragged, it follows at once.
          'transition-[translate] duration-(--motion-layout-duration) ease-(--motion-layout-easing) group-data-following/area:duration-0 group-data-resizing/area:transition-none motion-reduce:transition-none',
        )}
      >
        {/* The same dot as a channel Slider's thumb, so the two press and focus alike. */}
        <span aria-hidden className={cn(thumbDotClassName, channelThumbClassName)} />
        <input
          id={`${id}-s`}
          type='range'
          className='sr-only'
          aria-label='Saturation'
          aria-roledescription='2D slider'
          aria-valuetext={`Saturation ${percent(hsb.s)}, brightness ${percent(hsb.b)}, ${name}`}
          min={0}
          max={100}
          step={1}
          value={Math.round(hsb.s * 100)}
          disabled={disabled}
          onChange={(event) =>
            commit(set({ ...hsb, s: Number(event.target.value) / 100 }))
          }
          onKeyDown={onKeyDown}
        />
        <input
          type='range'
          tabIndex={-1}
          className='sr-only'
          aria-label='Brightness'
          aria-roledescription='2D slider'
          aria-valuetext={`Brightness ${percent(hsb.b)}, saturation ${percent(hsb.s)}, ${name}`}
          min={0}
          max={100}
          step={1}
          value={Math.round(hsb.b * 100)}
          disabled={disabled}
          onChange={(event) =>
            commit(set({ ...hsb, b: Number(event.target.value) / 100 }))
          }
          onKeyDown={onKeyDown}
        />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Channel sliders

type Channel = 'hue' | 'alpha' | 'lightness' | 'chroma'

/** The largest chroma the channels offer: a little past the most vivid sRGB colour. */
const MAX_CHROMA = 0.37

const CHANNELS: Record<
  Channel,
  {
    label: string
    min: number
    max: number
    step: number
    format: Intl.NumberFormatOptions
  }
> = {
  hue: {
    label: 'Hue',
    min: 0,
    max: 360,
    step: 1,
    format: {
      style: 'unit',
      unit: 'degree',
      unitDisplay: 'narrow',
      maximumFractionDigits: 0,
    },
  },
  alpha: { label: 'Opacity', min: 0, max: 1, step: 0.01, format: { style: 'percent' } },
  lightness: {
    label: 'Lightness',
    min: 0,
    max: 1,
    step: 0.005,
    format: { style: 'percent', maximumFractionDigits: 1 },
  },
  chroma: {
    label: 'Chroma',
    min: 0,
    max: MAX_CHROMA,
    step: 0.001,
    format: { minimumFractionDigits: 3, maximumFractionDigits: 3 },
  },
}

/** Every hue at full saturation, red round to red. */
const HUE_STOPS = '#f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00'

/** Along the track, start to end: 90deg, or -90deg right to left, from the Slider's `--track-dir`. */
const ALONG = 'calc(90deg * var(--track-dir))'

/** OKLCH hue stops every 30 degrees at `l` and `c`. */
const oklchHueStops = (l: number, c: number) =>
  Array.from({ length: 13 }, (_, i) => `oklch(${l} ${c} ${i * 30})`).join(', ')

/**
 * The channel's track, as a CSS background, and its thumb's colour: the
 * colours the channel runs through with the others held where they are.
 */
function channelPaint(
  color: EditColor,
  channel: Channel,
): { track: string; thumb: string } {
  const solid = cssColor({ ...color, alpha: 1 })
  if (channel === 'alpha') {
    return {
      track: `linear-gradient(${ALONG}, ${cssColor({ ...color, alpha: 0 })}, ${solid}), ${checkerboard}`,
      thumb: cssColor(color),
    }
  }
  if (channel === 'hue' && color.space === 'hsb') {
    return {
      track: `linear-gradient(${ALONG}, ${HUE_STOPS})`,
      thumb: `hsl(${color.hsb.h} 100% 50%)`,
    }
  }
  const { l, c, h } = toOklch(color)
  if (channel === 'hue') {
    // A grey has no hue to show, so the track keeps enough chroma to see each one.
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
  return {
    track: `linear-gradient(${ALONG} in oklch, oklch(${l} 0 ${h}), oklch(${l} ${MAX_CHROMA} ${h}))`,
    thumb: solid,
  }
}

type ChannelSliderProps = Omit<
  ComponentProps<typeof Slider<number>>,
  'value' | 'defaultValue' | 'min' | 'max' | 'step' | 'format' | 'variant'
>

/**
 * One channel as a Kino Slider, its track drawn in the colours it runs
 * through. Its children are a `SliderLabel` and `SliderValue`; without them,
 * the channel's name labels it.
 */
function ChannelSlider({
  channel,
  style,
  children,
  'aria-label': ariaLabel,
  getAriaValueText,
  onValueChange,
  onValueCommitted,
  disabled,
  ...props
}: ChannelSliderProps & { channel: Channel }) {
  const { color, format, change, commit, disabled: pickerDisabled } = useColorPicker()
  const spec = CHANNELS[channel]
  const paint = channelPaint(color, channel)
  return (
    <Slider
      variant='channel'
      value={channelValue(color, channel)}
      min={spec.min}
      max={spec.max}
      step={spec.step}
      format={spec.format}
      disabled={disabled ?? pickerDisabled}
      aria-label={children ? undefined : (ariaLabel ?? spec.label)}
      getAriaValueText={
        getAriaValueText ?? ((formatted) => `${formatted}, ${colorName(color)}`)
      }
      onValueChange={(next, details) => {
        change(withChannel(color, channel, next))
        onValueChange?.(next, details)
      }}
      onValueCommitted={(next, details) => {
        commit(writeColor(withChannel(color, channel, next), format))
        onValueCommitted?.(next, details)
      }}
      style={(state) =>
        ({
          '--slider-track': paint.track,
          '--slider-thumb': paint.thumb,
          ...(typeof style === 'function' ? style(state) : style),
        }) as CSSProperties
      }
      {...props}
    >
      {children}
    </Slider>
  )
}

/** Hue, in the picker's space: HSB's hue round the colour wheel, or OKLCH's. */
function ColorPickerHue(props: ChannelSliderProps) {
  return <ChannelSlider channel='hue' {...props} />
}

function ColorPickerAlpha(props: ChannelSliderProps) {
  return <ChannelSlider channel='alpha' {...props} />
}

/** OKLCH lightness, so two colours at the same value look as light. */
function ColorPickerLightness(props: ChannelSliderProps) {
  return <ChannelSlider channel='lightness' {...props} />
}

/** OKLCH chroma, up to a little past the most vivid colour an sRGB screen shows. */
function ColorPickerChroma(props: ChannelSliderProps) {
  return <ChannelSlider channel='chroma' {...props} />
}

// ---------------------------------------------------------------------------
// Preview

/**
 * The colour, large, and a note when the screen can't show it as it is: a
 * colour past sRGB is kept as it is and drawn as the nearest one the screen
 * shows.
 */
function ColorPickerPreview({ className, ...props }: ComponentProps<'div'>) {
  const { color } = useColorPicker()
  const outside = !inSrgb(oklchToRgb(toOklch(color)))
  return (
    <div
      data-slot='color-picker-preview'
      className={cn('flex flex-col gap-1.5', className)}
      {...props}
    >
      <div
        aria-hidden
        style={{ background: swatchBackground(cssColor(color)) }}
        className='h-14 w-full rounded-(--control-radius-capped) inset-ring inset-ring-foreground/10 forced-color-adjust-none'
      />
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

/** What was typed, and the value it was typed over. */
interface Draft {
  text: string
  over: string
  invalid: boolean
}

/**
 * The colour as text, with its swatch at the start. What's typed is read on
 * Enter or when focus leaves; Escape puts the colour back. Something that
 * isn't a colour stays as typed and is marked invalid. A colour's name, such
 * as `rebeccapurple`, is read by the browser.
 */
function ColorPickerInput({
  className,
  children,
  'aria-label': ariaLabel = 'Colour',
  disabled,
  onChange,
  onBlur,
  onKeyDown,
  ...props
}: Omit<
  ComponentProps<typeof InputGroupInput>,
  'value' | 'defaultValue' | 'children' | 'type'
> & {
  /** Buttons at the end of the box, such as `ColorPickerEyeDropper`. */
  children?: ReactNode
}) {
  const { color, value, pick, disabled: pickerDisabled } = useColorPicker()
  const [typed, setTyped] = useState<Draft | null>(null)
  // Once the colour changes another way, what was typed gives way to it.
  if (typed && typed.over !== value) setTyped(null)
  const draft = typed?.over === value ? typed : null

  const apply = () => {
    if (!draft) return
    const parsed = readColor(draft.text)
    if (!parsed) {
      setTyped({ ...draft, invalid: true })
      return
    }
    pick(parsed)
    setTyped(null)
  }

  return (
    <InputGroup data-slot='color-picker-input' className={cn('w-full', className)}>
      <InputGroupAddon>
        <ColorPickerSwatch color={cssColor(color)} />
      </InputGroupAddon>
      <InputGroupInput
        aria-label={ariaLabel}
        aria-invalid={draft?.invalid || undefined}
        spellCheck={false}
        autoComplete='off'
        autoCapitalize='off'
        // A colour is written left to right in any language; right to left it still sits at the start.
        dir='ltr'
        className='tabular-nums rtl:text-right'
        {...props}
        value={draft?.text ?? value}
        disabled={disabled ?? pickerDisabled}
        onChange={(event) => {
          onChange?.(event)
          setTyped({ text: event.target.value, over: value, invalid: false })
        }}
        onBlur={(event) => {
          onBlur?.(event)
          apply()
        }}
        onKeyDown={(event) => {
          onKeyDown?.(event)
          if (event.defaultPrevented) return
          if (event.key === 'Enter') {
            event.preventDefault()
            apply()
          } else if (event.key === 'Escape' && draft) {
            // Only puts the colour back; a second Escape closes what the picker sits in.
            event.preventDefault()
            event.stopPropagation()
            setTyped(null)
          }
        }}
      />
      {children}
    </InputGroup>
  )
}

const FORMATS: { value: ColorFormat; label: string }[] = [
  { value: 'hex', label: 'Hex' },
  { value: 'rgb', label: 'RGB' },
  { value: 'hsl', label: 'HSL' },
  { value: 'oklch', label: 'OKLCH' },
]

/** Picks how the value is written. Its props go to the Select's trigger. */
function ColorPickerFormat({
  className,
  disabled,
  ...props
}: ComponentProps<typeof SelectTrigger>) {
  const { format, setFormat, disabled: pickerDisabled } = useColorPicker()
  return (
    <Select
      items={FORMATS}
      value={format}
      disabled={disabled ?? pickerDisabled}
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

interface EyeDropperApi {
  new (): { open: () => Promise<{ sRGBHex: string }> }
}

const noSubscribe = () => () => {}

/**
 * Picks a colour from anywhere on the screen, at the end of a
 * `ColorPickerInput`. Only Chrome and Edge on a desktop can, so elsewhere it
 * isn't drawn at all.
 */
function ColorPickerEyeDropper({
  disabled,
  onClick,
  ...props
}: Omit<ComponentProps<typeof InputGroupButton>, 'children'>) {
  const { pick, disabled: pickerDisabled } = useColorPicker()
  const supported = useSyncExternalStore(
    noSubscribe,
    () => 'EyeDropper' in window,
    () => false,
  )
  if (!supported) return null
  return (
    <InputGroupAddon align='inline-end'>
      <InputGroupButton
        size='icon-xs'
        aria-label='Pick a colour from the screen'
        {...props}
        disabled={disabled ?? pickerDisabled}
        onClick={(event, details) => {
          onClick?.(event, details)
          if (event.defaultPrevented) return
          const EyeDropper = (window as unknown as { EyeDropper: EyeDropperApi })
            .EyeDropper
          new EyeDropper()
            .open()
            .then(({ sRGBHex }) => {
              const parsed = parseColor(sRGBHex)
              if (parsed) pick(parsed)
            })
            // Escape, or a click away, cancels it: nothing changes.
            .catch(() => {})
        }}
      >
        <IconPlaceholder
          lucide='PipetteIcon'
          tabler='IconColorPicker'
          hugeicons='ColorPickerIcon'
          phosphor='EyedropperIcon'
          remixicon='RiSipLine'
          aria-hidden
        />
      </InputGroupButton>
    </InputGroupAddon>
  )
}

// ---------------------------------------------------------------------------
// Presets

/** A preset colour and its name. */
interface ColorPreset {
  /** A CSS colour: hex, `rgb()`, `hsl()` or `oklch()`. */
  value: string
  /** Its name, for screen readers; without one it's described in words, such as "dark blue". */
  label?: string
}

const presetsClassName =
  'grid grid-cols-[repeat(auto-fill,var(--control-height-xs))] justify-between gap-2'

/** The ring a checked swatch takes, 2px out from it, and the press it shares with a Radio. */
const presetClassName = cn(
  'group/preset relative inline-grid size-(--control-height-xs) shrink-0 place-items-center rounded-(--control-radius-xs) *:col-start-1 *:row-start-1 inset-ring inset-ring-foreground/10 forced-color-adjust-none',
  'transition-[scale] duration-(--motion-press-duration) ease-(--motion-press-easing) active:duration-[calc(var(--motion-press-duration)*0.4)] data-pressing:duration-[calc(var(--motion-press-duration)*0.4)] motion-safe:active:scale-(--motion-press-scale) motion-safe:data-pressing:scale-(--motion-press-scale)',
  // Focus draws outside the checked ring, so the swatch picked and focused still shows it.
  'focus-visible:outline-ring focus-visible:outline-2 focus-visible:outline-offset-4 forced-colors:focus-visible:outline-[Highlight]',
  // The ring sits 2px out, 2px thick: its corner is the swatch's plus 4px (arbitrary, to follow it).
  'after:border-foreground after:pointer-events-none after:absolute after:-inset-1 after:rounded-[calc(var(--control-radius-xs)+4px)] after:border-2 after:opacity-0 after:transition-[opacity,scale] after:duration-(--motion-press-duration) after:ease-(--motion-press-easing) motion-safe:after:scale-90 data-checked:after:opacity-100 motion-safe:data-checked:after:scale-100',
  'data-disabled:pointer-events-none data-disabled:opacity-50',
)

const tickClassName =
  'size-3.5 opacity-0 transition-[opacity,scale] duration-(--motion-press-duration) ease-(--motion-press-easing) motion-safe:scale-50 group-data-checked/preset:opacity-100 motion-safe:group-data-checked/preset:scale-100'

/**
 * One preset colour, a radio inside `ColorPickerPresets`. It's checked while
 * the colour, as the picker writes it, is this one.
 */
function ColorPickerPreset({
  value,
  label,
  ...props
}: Omit<PresetRadioProps, 'value' | 'shown' | 'label'> & ColorPreset) {
  const { color, format } = useColorPicker()
  return (
    <PresetRadio
      value={presetValue(value, color.space, format) ?? value}
      shown={parseColor(value)}
      label={label}
      {...props}
    />
  )
}

type PresetRadioProps = Omit<RadioPrimitive.Root.Props, 'value' | 'className'> & {
  value: string
  shown: Color | null
  label: string | undefined
  className?: string
}

/**
 * One swatch of a preset row, a radio. It shows `shown` (or nothing when
 * that's `null`), and its children are a mark shown while it isn't checked,
 * in the tick's place.
 */
function PresetRadio({
  value,
  shown,
  label,
  className,
  style,
  children,
  onKeyDown,
  onKeyUp,
  onBlur,
  ...props
}: PresetRadioProps) {
  return (
    <RadioPrimitive.Root
      data-slot='color-picker-preset'
      aria-label={label ?? (shown ? colorName(shown) : undefined)}
      className={cn(presetClassName, className)}
      style={(state) => ({
        background: shown ? swatchBackground(cssColor(shown)) : undefined,
        ...(typeof style === 'function' ? style(state) : style),
      })}
      {...choicePressHandlers({ onKeyDown, onKeyUp, onBlur })}
      {...props}
      value={value}
    >
      {children}
      <IconPlaceholder
        lucide='CheckIcon'
        tabler='IconCheck'
        hugeicons='Tick02Icon'
        phosphor='CheckIcon'
        remixicon='RiCheckLine'
        aria-hidden
        strokeWidth={3}
        className={cn(
          tickClassName,
          !shown || prefersLightMark(shown) ? 'text-white' : 'text-black',
        )}
      />
    </RadioPrimitive.Root>
  )
}

type PresetsProps = Omit<
  RadioGroupPrimitive.Props,
  'className' | 'value' | 'defaultValue' | 'onValueChange' | 'children'
> & {
  className?: string
}

/**
 * A row of preset colours, one stop in the tab order, picked with the arrow
 * keys as radios are. The preset that matches the colour, as the picker
 * writes it, is checked; while the colour is one of its own, none is.
 */
function ColorPickerPresets({
  presets,
  children,
  className,
  'aria-label': ariaLabel = 'Presets',
  disabled,
  ...props
}: PresetsProps &
  (
    | {
        /** The colours, a `ColorPickerPreset` each. */ presets: readonly ColorPreset[]
        children?: never
      }
    | {
        presets?: never
        /** `ColorPickerPreset`s, to compose them yourself. */ children: ReactNode
      }
  )) {
  const { value, pick, disabled: pickerDisabled } = useColorPicker()
  return (
    <RadioGroupPrimitive
      data-slot='color-picker-presets'
      aria-label={ariaLabel}
      disabled={disabled ?? pickerDisabled}
      className={cn(presetsClassName, className)}
      {...props}
      value={value}
      onValueChange={(next) => {
        const parsed = typeof next === 'string' ? parseColor(next) : null
        if (parsed) pick(parsed)
      }}
    >
      {presets
        ? presets.map((preset) => <ColorPickerPreset key={preset.value} {...preset} />)
        : children}
    </RadioGroupPrimitive>
  )
}

const CUSTOM = 'custom'

/**
 * Presets first: the presets and a Custom swatch after them. Picking Custom
 * opens the children, the controls for a colour of your own, under the row
 * on `layout`; they stay open while the colour is your own, even when a drag
 * passes over a preset's colour. Your own colour is kept while a preset is
 * tried, and Custom puts it back.
 */
function ColorPickerPalette({
  presets,
  className,
  'aria-label': ariaLabel = 'Presets',
  disabled,
  children,
  ...props
}: PresetsProps & {
  /** The colours before Custom; the Palette needs them all to know when the colour is your own. */
  presets: readonly ColorPreset[]
  /** The controls for a colour of your own, such as an area, a hue and an input. */
  children: ReactNode
}) {
  const { color, value, format, pick, disabled: pickerDisabled } = useColorPicker()
  const presetValues = presets.map(
    (preset) => presetValue(preset.value, color.space, format) ?? preset.value,
  )
  const [palette, setPalette] = useState<PaletteState>({ mode: 'preset', own: null })
  const custom = paletteShowsCustom(palette, value, presetValues)

  return (
    <Collapsible open={custom} className={className}>
      <RadioGroupPrimitive
        data-slot='color-picker-presets'
        aria-label={ariaLabel}
        disabled={disabled ?? pickerDisabled}
        className={presetsClassName}
        {...props}
        value={custom ? CUSTOM : value}
        onValueChange={(next) => {
          if (typeof next !== 'string') return
          const toCustom = next === CUSTOM
          setPalette(
            paletteStep(palette, toCustom ? 'custom' : 'preset', value, presetValues),
          )
          // Custom puts your own colour back, if a preset was tried since.
          const parsed = parseColor(toCustom ? (palette.own ?? '') : next)
          if (parsed) pick(parsed)
        }}
      >
        {presets.map((preset, index) => (
          <PresetRadio
            key={preset.value}
            value={presetValues[index]}
            shown={parseColor(preset.value)}
            label={preset.label}
          />
        ))}
        <PresetRadio
          value={CUSTOM}
          shown={custom ? color : null}
          label='Custom colour'
          style={
            custom
              ? undefined
              : { background: `conic-gradient(from 90deg, ${HUE_STOPS})` }
          }
        >
          <IconPlaceholder
            lucide='PlusIcon'
            tabler='IconPlus'
            hugeicons='PlusSignIcon'
            phosphor='PlusIcon'
            remixicon='RiAddLine'
            aria-hidden
            strokeWidth={3}
            className='size-3.5 text-white drop-shadow-[0_1px_1px_rgb(0_0_0/0.4)] transition-[opacity,scale] duration-(--motion-press-duration) ease-(--motion-press-easing) group-data-checked/preset:opacity-0 motion-safe:group-data-checked/preset:scale-50'
          />
        </PresetRadio>
      </RadioGroupPrimitive>
      {/* The room above and below keeps the area's thumb and the focus rings clear of the panel's clip. */}
      <CollapsibleContent className='flex flex-col gap-(--surface-gap) ps-0 pe-0 pt-(--surface-gap) pb-1'>
        {children}
      </CollapsibleContent>
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
  presetValues: readonly string[],
): PaletteState {
  if (picked === 'custom') return { ...state, mode: 'custom' }
  return {
    mode: 'preset',
    own: paletteShowsCustom(state, value, presetValues) ? value : state.own,
  }
}

/** Whether Custom is checked and its controls open: picked, or the colour is no preset. */
function paletteShowsCustom(
  state: PaletteState,
  value: string,
  presetValues: readonly string[],
) {
  return state.mode === 'custom' || !presetValues.includes(value)
}

// ---------------------------------------------------------------------------
// Colour arithmetic. Channels are 0 to 1, hue in degrees from 0 to 360, alpha 0 to 1.

const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value))

/** A hue brought into 0 to 360. */
function wrapHue(hue: number) {
  const wrapped = hue % 360
  return wrapped < 0 ? wrapped + 360 : wrapped
}

/**
 * Rounded to six places: far finer than a screen shows, and coarse enough
 * that the server's arithmetic and the browser's agree when the page hydrates.
 */
const round6 = (n: number) => Math.round(n * 1e6) / 1e6

function hsbToRgb({ h, s, b }: Hsb): Rgb {
  const channel = (n: number) => {
    const k = (n + h / 60) % 6
    return b - b * s * Math.max(0, Math.min(k, 4 - k, 1))
  }
  return { r: channel(5), g: channel(3), b: channel(1) }
}

/** `hue` is kept when the colour has none of its own: a grey, black or white. */
function rgbToHsb({ r, g, b }: Rgb, hue = 0): Hsb {
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const range = max - min
  let h = hue
  if (range > 1e-6) {
    if (max === r) h = 60 * (((g - b) / range + 6) % 6)
    else if (max === g) h = 60 * ((b - r) / range + 2)
    else h = 60 * ((r - g) / range + 4)
  }
  return { h: wrapHue(h), s: max === 0 ? 0 : range / max, b: max }
}

/** HSL's saturation and lightness, from HSB's. */
function hsbToHsl({ h, s, b }: Hsb) {
  const l = b * (1 - s / 2)
  const sl = l === 0 || l === 1 ? 0 : (b - l) / Math.min(l, 1 - l)
  return { h, s: sl, l }
}

function hslToHsb(h: number, s: number, l: number): Hsb {
  const b = l + s * Math.min(l, 1 - l)
  return { h: wrapHue(h), s: b === 0 ? 0 : 2 * (1 - l / b), b }
}

const toLinear = (c: number) =>
  Math.abs(c) <= 0.04045
    ? c / 12.92
    : Math.sign(c) * ((Math.abs(c) + 0.055) / 1.055) ** 2.4
const fromLinear = (c: number) =>
  Math.abs(c) <= 0.0031308
    ? c * 12.92
    : Math.sign(c) * (1.055 * Math.abs(c) ** (1 / 2.4) - 0.055)

/** `hue` is kept when the colour has none of its own. */
function rgbToOklch(rgb: Rgb, hue = 0): Oklch {
  const r = toLinear(rgb.r)
  const g = toLinear(rgb.g)
  const b = toLinear(rgb.b)
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  const c = Math.hypot(A, B)
  return {
    l: L,
    c: c < 1e-4 ? 0 : c,
    h: c < 1e-4 ? hue : wrapHue((Math.atan2(B, A) * 180) / Math.PI),
  }
}

/** The sRGB colour, which falls outside 0 to 1 when OKLCH asks for more chroma than sRGB has. */
function oklchToRgb({ l, c, h }: Oklch): Rgb {
  const angle = (h * Math.PI) / 180
  const A = c * Math.cos(angle)
  const B = c * Math.sin(angle)
  const l3 = (l + 0.3963377774 * A + 0.2158037573 * B) ** 3
  const m3 = (l - 0.1055613458 * A - 0.0638541728 * B) ** 3
  const s3 = (l - 0.0894841775 * A - 1.291485548 * B) ** 3
  return {
    r: fromLinear(4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3),
    g: fromLinear(-1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3),
    b: fromLinear(-0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3),
  }
}

/** Whether sRGB can show the colour, give or take a rounding error. */
function inSrgb({ r, g, b }: Rgb) {
  return [r, g, b].every((c) => c >= -0.0005 && c <= 1.0005)
}

const clipRgb = ({ r, g, b }: Rgb): Rgb => ({ r: clamp(r), g: clamp(g), b: clamp(b) })

/**
 * The colour sRGB shows for `color`: the same lightness and hue with as much
 * of its chroma as sRGB holds, as CSS Color 4 maps a colour into a gamut.
 */
function oklchToSrgb(color: Oklch): Rgb {
  const exact = oklchToRgb(color)
  if (inSrgb(exact)) return clipRgb(exact)
  let low = 0
  let high = color.c
  while (high - low > 1e-4) {
    const mid = (low + high) / 2
    if (inSrgb(oklchToRgb({ ...color, c: mid }))) low = mid
    else high = mid
  }
  return clipRgb(oklchToRgb({ ...color, c: low }))
}

/** The colour in HSB, keeping `hue` for one that has none. */
function toHsb(color: Color, hue = 0): Hsb {
  switch (color.space) {
    case 'hsb':
      return color.hsb
    case 'rgb':
      return rgbToHsb(color.rgb, hue)
    case 'oklch':
      return rgbToHsb(oklchToSrgb(color.oklch), hue)
  }
}

/** The colour in OKLCH, keeping `hue` for one that has none. */
function toOklch(color: Color, hue = 0): Oklch {
  switch (color.space) {
    case 'oklch':
      return color.oklch
    case 'rgb':
      return rgbToOklch(color.rgb, hue)
    case 'hsb':
      return color.oklch ?? rgbToOklch(hsbToRgb(color.hsb), hue)
  }
}

/** The colour sRGB shows for it. */
function toRgb(color: Color): Rgb {
  switch (color.space) {
    case 'rgb':
      return color.rgb
    case 'hsb':
      return hsbToRgb(color.hsb)
    case 'oklch':
      return oklchToSrgb(color.oklch)
  }
}

const roundOklch = ({ l, c, h }: Oklch): Oklch => ({
  l: round6(l),
  c: round6(c),
  h: round6(h),
})

/**
 * `color` in `space`, keeping `previous`'s hue for a colour that has none.
 * An OKLCH colour taken into HSB keeps its OKLCH, so it's written back as it was.
 */
function inSpace(color: Color, space: ColorSpace, previous?: EditColor): EditColor {
  if (space === 'hsb') {
    const { h, s, b } = toHsb(color, previous ? toHsb(previous).h : 0)
    const oklch = color.space === 'rgb' ? undefined : color.oklch
    return {
      space,
      hsb: { h: round6(h), s: round6(s), b: round6(b) },
      alpha: color.alpha,
      ...(oklch && { oklch: roundOklch(oklch) }),
    }
  }
  return {
    space,
    oklch: roundOklch(toOklch(color, previous ? toOklch(previous).h : 0)),
    alpha: color.alpha,
  }
}

/** The colour with one channel set. Lightness and chroma are OKLCH's, in either space. */
function channelValue(color: EditColor, channel: Channel) {
  switch (channel) {
    case 'alpha':
      return color.alpha
    case 'hue':
      return color.space === 'hsb' ? color.hsb.h : color.oklch.h
    case 'lightness':
      return toOklch(color).l
    case 'chroma':
      return Math.min(MAX_CHROMA, toOklch(color).c)
  }
}

/** The colour with one channel set. */
function withChannel(color: EditColor, channel: Channel, value: number): EditColor {
  if (channel === 'alpha') return { ...color, alpha: value }
  if (channel === 'hue') {
    return color.space === 'hsb'
      ? { space: 'hsb', hsb: { ...color.hsb, h: value }, alpha: color.alpha }
      : { ...color, oklch: { ...color.oklch, h: value } }
  }
  const oklch: Oklch = { ...toOklch(color), [channel === 'lightness' ? 'l' : 'c']: value }
  return inSpace({ space: 'oklch', oklch, alpha: color.alpha }, color.space, color)
}

/** The colour to show: the one held, unless a `value` from outside says otherwise. */
function shownColor(held: Held, value: string | undefined, space: ColorSpace): EditColor {
  if (value === undefined || value === held.written) return held.color
  const parsed = parseColor(value)
  return parsed ? inSpace(parsed, space, held.color) : held.color
}

/** A preset as a picker in `space` writes it in `format`, so it matches the colour once picked; `null` for one that isn't a colour. */
function presetValue(preset: string, space: ColorSpace, format: ColorFormat) {
  const parsed = parseColor(preset)
  return parsed ? writeColor(inSpace(parsed, space), format) : null
}

/** Where a pointer at `x`, `y` falls on an area, as saturation and brightness from 0 to 1. */
function areaPoint(
  rect: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>,
  x: number,
  y: number,
  rtl: boolean,
) {
  const across = rect.width > 0 ? clamp((x - rect.left) / rect.width) : 0
  const down = rect.height > 0 ? clamp((y - rect.top) / rect.height) : 0
  return { s: rtl ? 1 - across : across, b: 1 - down }
}

/**
 * Where a key moves the area's thumb: the arrows by 1%, or 10% with Shift,
 * Page Up and Page Down 10% in brightness, Home and End to either end of
 * saturation. Left and right follow the screen, so right to left they're
 * reversed. `null` for a key the area doesn't take.
 */
function areaKeyMove(
  point: { s: number; b: number },
  key: string,
  shift: boolean,
  rtl: boolean,
): { s: number; b: number } | null {
  const step = shift ? 0.1 : 0.01
  const near = (n: number) => clamp(Math.round(n * 1000) / 1000)
  const right = rtl ? -step : step
  switch (key) {
    case 'ArrowRight':
      return { s: near(point.s + right), b: point.b }
    case 'ArrowLeft':
      return { s: near(point.s - right), b: point.b }
    case 'ArrowUp':
      return { s: point.s, b: near(point.b + step) }
    case 'ArrowDown':
      return { s: point.s, b: near(point.b - step) }
    case 'PageUp':
      return { s: point.s, b: near(point.b + 0.1) }
    case 'PageDown':
      return { s: point.s, b: near(point.b - 0.1) }
    case 'Home':
      return { s: 0, b: point.b }
    case 'End':
      return { s: 1, b: point.b }
    default:
      return null
  }
}

// ---------------------------------------------------------------------------
// Reading CSS

const NUMBER = String.raw`[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?`

/** A number, or a percentage of `percentOf`; `null` when it isn't one. */
function readNumber(token: string, percentOf: number): number | null {
  const match = new RegExp(`^(${NUMBER})(%)?$`, 'i').exec(token)
  if (!match) return token.toLowerCase() === 'none' ? 0 : null
  const value = Number(match[1])
  return match[2] ? (value / 100) * percentOf : value
}

/** An angle in degrees, from a bare number or deg, grad, rad or turn. */
function readHue(token: string): number | null {
  const match = new RegExp(`^(${NUMBER})(deg|grad|rad|turn)?$`, 'i').exec(token)
  if (!match) return token.toLowerCase() === 'none' ? 0 : null
  const value = Number(match[1])
  const unit = match[2]?.toLowerCase()
  const degrees =
    unit === 'turn'
      ? value * 360
      : unit === 'rad'
        ? (value * 180) / Math.PI
        : unit === 'grad'
          ? value * 0.9
          : value
  return wrapHue(degrees)
}

/** The function's arguments and its alpha, in modern or comma syntax. */
function readArguments(body: string): { args: string[]; alpha: string | null } | null {
  const trimmed = body.trim()
  if (trimmed.includes(',')) {
    const parts = trimmed.split(',').map((part) => part.trim())
    if (parts.length !== 3 && parts.length !== 4) return null
    return { args: parts.slice(0, 3), alpha: parts[3] ?? null }
  }
  const [main, alpha, ...rest] = trimmed.split('/').map((part) => part.trim())
  if (rest.length > 0) return null
  const args = main.split(/\s+/).filter(Boolean)
  if (args.length !== 3) return null
  return { args, alpha: alpha ?? null }
}

function readAlpha(token: string | null): number | null {
  if (token === null) return 1
  const value = readNumber(token, 1)
  return value === null ? null : clamp(value)
}

function readHex(text: string): Color | null {
  const match = /^#([\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i.exec(text)
  if (!match) return null
  const digits =
    match[1].length <= 4
      ? match[1]
          .split('')
          .map((d) => d + d)
          .join('')
      : match[1]
  const byteAt = (index: number) => Number.parseInt(digits.slice(index, index + 2), 16)
  return {
    space: 'rgb',
    rgb: { r: byteAt(0) / 255, g: byteAt(2) / 255, b: byteAt(4) / 255 },
    alpha: digits.length === 8 ? byteAt(6) / 255 : 1,
  }
}

/**
 * Reads a hex colour, `rgb()`, `hsl()`, `oklch()`, `color(srgb …)` or
 * `transparent`, in the modern or the comma syntax. Returns `null` for
 * anything else, such as a colour's name, which only a browser reads.
 */
function parseColor(input: string): Color | null {
  const text = input.trim().toLowerCase()
  if (text === 'transparent') return { ...BLACK, alpha: 0 }
  if (text.startsWith('#')) return readHex(text)
  const fn = /^([a-z]+)\((.*)\)$/.exec(text)
  if (!fn) return null
  const [, name, body] = fn
  if (name === 'color') {
    const [space, ...rest] = body.trim().split(/\s+/)
    if (space !== 'srgb') return null
    const parsed = readArguments(rest.join(' '))
    if (!parsed) return null
    const [r, g, b] = parsed.args.map((arg) => readNumber(arg, 1))
    const alpha = readAlpha(parsed.alpha)
    if (r === null || g === null || b === null || alpha === null) return null
    return { space: 'rgb', rgb: clipRgb({ r, g, b }), alpha }
  }
  const parsed = readArguments(body)
  if (!parsed) return null
  const alpha = readAlpha(parsed.alpha)
  if (alpha === null) return null
  const [first, second, third] = parsed.args
  switch (name) {
    case 'rgb':
    case 'rgba': {
      const [r, g, b] = [first, second, third].map((arg) => readNumber(arg, 255))
      if (r === null || g === null || b === null) return null
      return { space: 'rgb', rgb: clipRgb({ r: r / 255, g: g / 255, b: b / 255 }), alpha }
    }
    case 'hsl':
    case 'hsla': {
      const h = readHue(first)
      // Modern syntax allows bare numbers out of 100; percentages are the usual way.
      const s = readNumber(second.endsWith('%') ? second : `${second}%`, 1)
      const l = readNumber(third.endsWith('%') ? third : `${third}%`, 1)
      if (h === null || s === null || l === null) return null
      return { space: 'hsb', hsb: hslToHsb(h, clamp(s), clamp(l)), alpha }
    }
    case 'oklch': {
      const l = readNumber(first, 1)
      const c = readNumber(second, 0.4)
      const h = readHue(third)
      if (l === null || c === null || h === null) return null
      return { space: 'oklch', oklch: { l: clamp(l), c: clamp(c, 0, 0.5), h }, alpha }
    }
    default:
      return null
  }
}

/**
 * Reads what a person typed: what `parseColor` reads, or anything else the
 * browser takes as a colour, such as `rebeccapurple`.
 */
function readColor(text: string): Color | null {
  const parsed = parseColor(text)
  if (parsed || typeof document === 'undefined') return parsed
  const trimmed = text.trim()
  if (/^currentcolor$/i.test(trimmed) || !CSS.supports('color', trimmed)) return null
  const probe = document.createElement('span')
  // Mixed with nothing, any colour comes back as OKLCH, which parseColor
  // reads: lab(), display-p3 and the rest, keeping their full chroma.
  probe.style.color = `color-mix(in oklch, ${trimmed} 100%, transparent)`
  if (!probe.style.color) probe.style.color = trimmed
  document.body.append(probe)
  const computed = getComputedStyle(probe).color
  probe.remove()
  return parseColor(computed)
}

// ---------------------------------------------------------------------------
// Writing CSS

const byte = (c: number) => Math.round(clamp(c) * 255)
const hex2 = (n: number) => n.toString(16).padStart(2, '0')
/** Up to `places` decimals, without trailing zeros. */
const fixed = (n: number, places: number) => String(Number(n.toFixed(places)))
const alphaSuffix = (alpha: number) =>
  alpha >= 1 ? '' : ` / ${fixed(clamp(alpha) * 100, 1)}%`

/** An sRGB colour as CSS in `format`. */
function formatColor(rgb: Rgb, alpha: number, format: ColorFormat): string {
  switch (format) {
    case 'hex': {
      const digits = [rgb.r, rgb.g, rgb.b].map((c) => hex2(byte(c))).join('')
      return `#${digits}${alpha >= 1 ? '' : hex2(byte(alpha))}`
    }
    case 'rgb':
      return `rgb(${byte(rgb.r)} ${byte(rgb.g)} ${byte(rgb.b)}${alphaSuffix(alpha)})`
    case 'hsl': {
      const { h, s, l } = hsbToHsl(rgbToHsb(clipRgb(rgb)))
      return `hsl(${Math.round(h) % 360} ${Math.round(s * 100)}% ${Math.round(l * 100)}%${alphaSuffix(alpha)})`
    }
    case 'oklch':
      return formatOklch(rgbToOklch(clipRgb(rgb)), alpha)
  }
}

/** OKLCH as CSS, to three decimals as shadcn writes its tokens. */
function formatOklch({ l, c, h }: Oklch, alpha: number) {
  return `oklch(${fixed(l, 3)} ${fixed(c, 3)} ${fixed(c === 0 ? 0 : h, 3)}${alphaSuffix(alpha)})`
}

/** The colour as CSS in `format`. OKLCH is written as it is, even past sRGB. */
function writeColor(color: EditColor, format: ColorFormat) {
  if (format === 'oklch' && color.oklch) return formatOklch(color.oklch, color.alpha)
  return formatColor(toRgb(color), color.alpha, format)
}

/** A colour with its alpha as CSS a browser draws: OKLCH as it is, so a wide-gamut screen shows it all. */
function cssColor(color: Color) {
  if (color.space !== 'rgb' && color.oklch) return formatOklch(color.oklch, color.alpha)
  const { r, g, b } = toRgb(color)
  return `rgb(${fixed(r * 255, 2)} ${fixed(g * 255, 2)} ${fixed(b * 255, 2)} / ${fixed(color.alpha, 3)})`
}

/** WCAG relative luminance, 0 for black to 1 for white. */
function luminance(color: Color) {
  const { r, g, b } = toRgb(color)
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b)
}

/**
 * Whether a mark drawn over the colour reads best in white rather than black:
 * the one with the higher WCAG contrast. A colour mostly see-through shows
 * the page under it, so it takes black.
 */
function prefersLightMark(color: Color) {
  const y = luminance(color)
  return color.alpha > 0.35 && 1.05 / (y + 0.05) >= (y + 0.05) / 0.05
}

// ---------------------------------------------------------------------------
// Words

// Where each name's OKLCH hue ends, set from the CSS named colours and Tailwind's 500s.
const HUE_NAMES: readonly [number, string][] = [
  [12, 'pink'],
  [40, 'red'],
  [80, 'orange'],
  [120, 'yellow'],
  [137, 'yellow green'],
  [175, 'green'],
  [190, 'teal'],
  [245, 'cyan'],
  [285, 'blue'],
  [315, 'violet'],
  [340, 'magenta'],
  [360, 'pink'],
]

/**
 * A few words for the colour that a screen reader speaks beside its numbers,
 * such as "dark blue" or "light grey", from its OKLCH lightness, chroma and hue.
 */
function colorName(color: Color): string {
  const { l, c, h } = toOklch(color)
  let name: string
  if (c < 0.03) {
    if (l > 0.97) name = 'white'
    else if (l < 0.15) name = 'black'
    else name = l > 0.75 ? 'light grey' : l < 0.4 ? 'dark grey' : 'grey'
  } else {
    const hue = HUE_NAMES.find(([end]) => h < end)?.[1] ?? 'pink'
    // A dark orange is brown, and a vivid yellow or green is light by nature, not "light".
    if (hue === 'orange' && l < 0.6) name = 'brown'
    else {
      const tone = l > 0.8 && c < 0.15 ? 'light ' : l < 0.45 ? 'dark ' : ''
      const muted = c < 0.07 ? 'greyish ' : ''
      name = `${tone}${muted}${hue}`
    }
  }
  return color.alpha < 1 ? `${name}, ${Math.round(color.alpha * 100)}% opaque` : name
}

export {
  ColorPicker,
  ColorPickerAlpha,
  ColorPickerArea,
  ColorPickerChroma,
  ColorPickerEyeDropper,
  ColorPickerFormat,
  ColorPickerHue,
  ColorPickerInput,
  ColorPickerLightness,
  ColorPickerPalette,
  ColorPickerPreset,
  ColorPickerPresets,
  ColorPickerPreview,
  ColorPickerSwatch,
  areaKeyMove,
  areaPoint,
  channelValue,
  colorName,
  cssColor,
  formatColor,
  formatOklch,
  hsbToRgb,
  inSpace,
  inSrgb,
  oklchToRgb,
  oklchToSrgb,
  paletteShowsCustom,
  paletteStep,
  parseColor,
  prefersLightMark,
  presetValue,
  rgbToHsb,
  rgbToOklch,
  shownColor,
  toHsb,
  toOklch,
  withChannel,
  writeColor,
}
export type { Color, ColorFormat, ColorPickerProps, ColorPreset, ColorSpace, EditColor }
