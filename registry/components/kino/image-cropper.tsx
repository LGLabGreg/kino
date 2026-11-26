'use client'

import { Button } from '@/registry/components/kino/button'
import {
  sliderThumbClassName,
  sliderTrackClassName,
} from '@/registry/components/kino/slider'
import { Spinner, useSpinner } from '@/registry/components/kino/spinner'
import { IconPlaceholder } from '@/registry/icons/icon-placeholder'
import { useAnnouncer } from '@/registry/lib/announce'
import { insetsOf, translateOf } from '@/registry/lib/highlight'
import { mergeRefs } from '@/registry/lib/refs'
import {
  FOLLOWS_TRANSITION,
  markResizing,
  runningTransitions,
} from '@/registry/lib/resize'
import { trackDirClassName, trackFillClassName } from '@/registry/lib/track'
import type { OptionsOf, TypesOf } from '@ui-sdk/core'
import type { ImageCrop } from '@ui-sdk/core/image'
import {
  type ImageCropperCropChangeReason,
  type ImageCropperHandlePosition,
  type ImageCropperMode,
  type ImageCropperShape,
  imageCropper,
} from '@ui-sdk/core/image-cropper'
import {
  ImageCropperGrid as ImageCropperGridPrimitive,
  ImageCropperHandle as ImageCropperHandlePrimitive,
  ImageCropperImage as ImageCropperImagePrimitive,
  ImageCropperRotate as ImageCropperRotatePrimitive,
  ImageCropperSelection as ImageCropperSelectionPrimitive,
  ImageCropperViewport as ImageCropperViewportPrimitive,
  ImageCropperZoom as ImageCropperZoomPrimitive,
} from '@ui-sdk/react/image-cropper'
import { type PrimitiveHandle, usePart, usePrimitive } from '@ui-sdk/react/primitive'
import {
  type ComponentProps,
  createContext,
  type ReactNode,
  use,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { flushSync } from 'react-dom'

import { cn } from '@/lib/utils'

/*
 * ui-sdk's Image cropper holds the crop, the pointer, the wheel and the keys.
 * Kino draws it: ui-sdk places its parts in pixels with inline `left`, `top`,
 * `width` and `height`, which only move on the main thread, so the parts here
 * take their place from `translate`, `rotate`, `scale` and `clip-path`
 * instead, worked out from ui-sdk's state, and those glide on `layout` after a
 * key or a button, and follow at once while a pointer, the wheel or the zoom
 * thumb moves the crop (`data-following`).
 *
 * The image is the same way round in either text direction, so the layers
 * over it are placed from its physical top left, as ui-sdk places them, and
 * the corner marks' 3px arms and 17px offsets (a 20px mark less its arm) are
 * physical too.
 */

// ---------------------------------------------------------------------------
// The arithmetic ui-sdk keeps to itself

/** A width and height in pixels. */
interface Size {
  width: number
  height: number
}

interface Point {
  x: number
  y: number
}

/** A rectangle in pixels, from its top left corner. */
interface Rect extends Point, Size {}

type Crop = Required<ImageCrop>

/** The image's size once it is turned `rotation` degrees. */
function rotatedSize(size: Size, rotation: number): Size {
  return rotation % 180 === 0 ? size : { width: size.height, height: size.width }
}

/** The point of the image as it was taken that shows at `point` once it is turned `rotation` degrees. */
function toNatural(point: Point, natural: Size, rotation: number): Point {
  if (rotation === 90) return { x: point.y, y: natural.height - point.x }
  if (rotation === 180) return { x: natural.width - point.x, y: natural.height - point.y }
  if (rotation === 270) return { x: natural.width - point.y, y: point.x }
  return { ...point }
}

/** The smallest rectangle `aspect` wide for each pixel high that covers `bounds`, centred on it. */
function coverRect(bounds: Rect, aspect: number): Rect {
  const width = Math.max(bounds.width, bounds.height * aspect)
  const height = width / aspect
  return {
    x: bounds.x + (bounds.width - width) / 2,
    y: bounds.y + (bounds.height - height) / 2,
    width,
    height,
  }
}

/** The whole of an image, as a rectangle. */
function imageRect(size: Size): Rect {
  return { x: 0, y: 0, ...size }
}

/** How the image is placed to show `view` in `frame`: how much it is scaled, and where its top left corner lands. */
/**
 * The largest crop at `aspect` in the middle of an image of `natural` size,
 * in whole pixels, as ui-sdk works its crops out: the whole image when there
 * is no ratio.
 */
function largestCrop(natural: Size, aspect: number | undefined): Crop {
  const ratio = aspect && aspect > 0 ? aspect : natural.width / natural.height
  const width = Math.round(Math.min(natural.width, natural.height * ratio))
  const height = Math.round(Math.min(natural.height, natural.width / ratio))
  return {
    x: Math.round((natural.width - width) / 2),
    y: Math.round((natural.height - height) / 2),
    width,
    height,
    rotation: 0,
    flipX: false,
    flipY: false,
  }
}

/** Whether two crops cover the same pixels. */
function sameRect(one: Rect, other: Rect) {
  return (
    one.x === other.x &&
    one.y === other.y &&
    one.width === other.width &&
    one.height === other.height
  )
}

function viewTransform(view: Rect, frame: Rect) {
  const scale = frame.width / view.width
  return { scale, x: frame.x - view.x * scale, y: frame.y - view.y * scale }
}

type ViewTransform = ReturnType<typeof viewTransform>

/**
 * Where ui-sdk shows the image and the selection in its viewport's padding
 * box (`box`), as its own parts place them, so what Kino draws lies under
 * ui-sdk's pointer. A frame keeps the selection as large as it fits at the
 * ratio and scales the image to it; a box fits the whole image.
 */
function cropLayout(
  crop: Crop,
  natural: Size,
  box: Rect,
  mode: ImageCropperMode,
  aspect: number | undefined,
): { transform: ViewTransform; selection: Rect } {
  const shown = rotatedSize(natural, crop.rotation)
  if (mode === 'frame') {
    const ratio = aspect ?? crop.width / crop.height
    const width = Math.min(box.width, box.height * ratio)
    const height = width / ratio
    const selection = {
      x: box.x + (box.width - width) / 2,
      y: box.y + (box.height - height) / 2,
      width,
      height,
    }
    const scale = width / crop.width
    return {
      transform: {
        scale,
        x: selection.x - crop.x * scale,
        y: selection.y - crop.y * scale,
      },
      selection,
    }
  }
  const scale = Math.min(box.width / shown.width, box.height / shown.height)
  const transform = {
    scale,
    x: box.x + (box.width - shown.width * scale) / 2,
    y: box.y + (box.height - shown.height * scale) / 2,
  }
  return {
    transform,
    selection: {
      x: transform.x + crop.x * scale,
      y: transform.y + crop.y * scale,
      width: crop.width * scale,
      height: crop.height * scale,
    },
  }
}

/** The angle the image is drawn at: the crop's rotation, reached by the shorter way round from the last one, so a turn past 270 keeps going. */
function nextAngle(angle: number, rotation: number) {
  const delta = ((((rotation - angle) % 360) + 540) % 360) - 180
  return angle + delta
}

function round(value: number) {
  return Math.round(value * 100) / 100
}

/**
 * Which of the image's own sides a crop mirrors: ui-sdk flips the image as it
 * shows, after its turn, so on a quarter turn a flip left to right mirrors
 * the image as taken top to bottom. A turn swaps ui-sdk's flips with its
 * sides, so these stay put through it.
 */
function mirrorOf(crop: Crop): readonly [boolean, boolean] {
  return crop.rotation % 180 === 0 ? [crop.flipX, crop.flipY] : [crop.flipY, crop.flipX]
}

/** Where a turn starts or ends: the frame's `translate`, `rotate` (degrees) and `scale`, the crop's centre in the image as drawn, and the crop on screen. */
interface TurnPose {
  translate: readonly [number, number]
  rotate: number
  scale: number
  pivot: readonly [number, number]
  hole: Rect
}

/**
 * The image as drawn for `crop`: a frame at the crop's centre on screen,
 * turned `angle` degrees and scaled about it, with the image inside moved so
 * the crop's centre sits on the frame's corner. The image is drawn mirrored
 * for a flip, so `pivot` is the crop's centre in the mirrored image.
 */
function imagePose(
  natural: Size,
  angle: number,
  transform: ViewTransform,
  crop: Crop,
): Omit<TurnPose, 'hole'> {
  const shown = rotatedSize(natural, crop.rotation)
  const centre = { x: crop.x + crop.width / 2, y: crop.y + crop.height / 2 }
  const unflipped = {
    x: crop.flipX ? shown.width - centre.x : centre.x,
    y: crop.flipY ? shown.height - centre.y : centre.y,
  }
  const taken = toNatural(unflipped, natural, crop.rotation)
  const [mirrorX, mirrorY] = mirrorOf(crop)
  return {
    translate: [
      transform.x + centre.x * transform.scale,
      transform.y + centre.y * transform.scale,
    ],
    rotate: angle,
    scale: transform.scale,
    pivot: [
      mirrorX ? natural.width - taken.x : taken.x,
      mirrorY ? natural.height - taken.y : taken.y,
    ],
  }
}

/** `imagePose` as the styles that draw it: the frame's, and the `<img>`'s inside it. */
function imagePlacement(
  natural: Size,
  angle: number,
  transform: ViewTransform,
  crop: Crop,
) {
  const { translate, scale, pivot } = imagePose(natural, angle, transform, crop)
  const [mirrorX, mirrorY] = mirrorOf(crop)
  return {
    frame: {
      translate: `${round(translate[0])}px ${round(translate[1])}px`,
      rotate: `${angle}deg`,
      scale: `${Math.round(scale * 10000) / 10000}`,
    },
    image: {
      width: `${natural.width}px`,
      height: `${natural.height}px`,
      translate: `${round(-pivot[0])}px ${round(-pivot[1])}px`,
      scale: `${mirrorX ? -1 : 1} ${mirrorY ? -1 : 1}`,
    },
  }
}

/**
 * How much larger the image is drawn `progress` of the way through a turn
 * from `from` to `to`, about the frame's corner, so it covers the crop at
 * that angle: 1 when it already does. Each value moves in a straight line,
 * as CSS moves it, by one progress for all of them or by each its own. A
 * `round` crop is the circle inside the hole.
 */
function turnCover(
  from: TurnPose,
  to: TurnPose,
  natural: Size,
  progress: number | TurnProgress,
  round = false,
) {
  const mix = (part: keyof TurnProgress, a: number, b: number) =>
    a + (b - a) * (typeof progress === 'number' ? progress : progress[part])
  const tx = mix('translate', from.translate[0], to.translate[0])
  const ty = mix('translate', from.translate[1], to.translate[1])
  const turn = (mix('rotate', from.rotate, to.rotate) * Math.PI) / 180
  const scale = mix('scale', from.scale, to.scale)
  const px = mix('pivot', from.pivot[0], to.pivot[0])
  const py = mix('pivot', from.pivot[1], to.pivot[1])
  const x = mix('hole', from.hole.x, to.hole.x)
  const y = mix('hole', from.hole.y, to.hole.y)
  const right = x + mix('hole', from.hole.width, to.hole.width)
  const bottom = y + mix('hole', from.hole.height, to.hole.height)
  const cos = Math.cos(turn)
  const sin = Math.sin(turn)
  // How far the image reaches from its pivot on each side, in its own pixels.
  const reach = {
    left: Math.max(px, 1e-6),
    right: Math.max(natural.width - px, 1e-6),
    top: Math.max(py, 1e-6),
    bottom: Math.max(natural.height - py, 1e-6),
  }
  let cover = 1
  if (round) {
    // A round crop only needs its circle covered: its centre, and its radius each way.
    const radius = Math.min(right - x, bottom - y) / 2 / scale
    const ox = (x + right) / 2 - tx
    const oy = (y + bottom) / 2 - ty
    const dx = (ox * cos + oy * sin) / scale
    const dy = (-ox * sin + oy * cos) / scale
    return Math.max(
      1,
      (dx + radius) / reach.right,
      (radius - dx) / reach.left,
      (dy + radius) / reach.bottom,
      (radius - dy) / reach.top,
    )
  }
  for (const [cx, cy] of [
    [x, y],
    [right, y],
    [right, bottom],
    [x, bottom],
  ] as const) {
    // The corner in the image's own pixels from its pivot: turned back, and unscaled.
    const dx = ((cx - tx) * cos + (cy - ty) * sin) / scale
    const dy = (-(cx - tx) * sin + (cy - ty) * cos) / scale
    cover = Math.max(
      cover,
      dx > 0 ? dx / reach.right : -dx / reach.left,
      dy > 0 ? dy / reach.bottom : -dy / reach.top,
    )
  }
  return cover
}

const curves = new Map<string, (time: number) => number>()

/** An easing, any CSS easing, as a function from time to progress, both from 0 to 1, as the browser reads it once and remembers. */
function easingCurve(easing: string): (time: number) => number {
  const known = curves.get(easing)
  if (known) return known
  // The probe never plays: it only reads progress at moments of a span of 1.
  const duration = 1
  const SAMPLES = 200
  let curve: (time: number) => number
  try {
    const probe = new Animation(
      new KeyframeEffect(null, null, { duration, easing, fill: 'both' }),
      document.timeline,
    )
    const table = Array.from({ length: SAMPLES + 1 }, (_, step) => {
      probe.currentTime = (step / SAMPLES) * duration
      return Number(probe.effect?.getComputedTiming().progress ?? step / SAMPLES)
    })
    curve = (time) => {
      const at = Math.min(SAMPLES, Math.max(0, time * SAMPLES))
      const below = Math.floor(at)
      const low = table[below] ?? 0
      const high = table[Math.min(SAMPLES, below + 1)] ?? low
      return low + (high - low) * (at - below)
    }
  } catch {
    curve = (time) => time
  }
  curves.set(easing, curve)
  return curve
}

/** The hole a clip of insets leaves in a box of `box`. */
function holeOf(clip: string, box: Size): Rect | null {
  const insets = insetsOf(clip)
  if (!insets) return null
  const [top, right, bottom, left] = insets
  return {
    x: left,
    y: top,
    width: box.width - left - right,
    height: box.height - top - bottom,
  }
}

/** How far each part of a turn has got, from 0 to 1, or past 1 when its easing overshoots. */
interface TurnProgress {
  translate: number
  rotate: number
  scale: number
  pivot: number
  hole: number
}

/**
 * Scales `frames` up through a turn just enough to cover the crop, in step
 * with the transitions that make the turn: each one's own start value,
 * start, duration and easing, since a transition turned back runs shorter
 * and a nudge or drag mid-turn starts a part again. So the feel, a nested
 * `data-feel` and reduced motion all hold. Returns what it plays, for the
 * next paint to stop; it stops by itself if the turn is cut off.
 */
function coverTurn(
  frames: HTMLElement[],
  image: HTMLElement | null,
  hole: HTMLElement | null,
  box: Size,
  to: TurnPose,
  natural: Size,
  round: boolean,
  again: () => void,
): Animation[] {
  const frame = frames[0]
  if (!frame) return []
  const turn = runningTransitions(frame, { property: 'rotate' })[0]
  if (!turn) return []
  // A part already moving when the turn began started a frame or two before it,
  // which only shows once the turn has a start of its own.
  if (turn.startTime === null) void turn.ready.then(again, () => {})
  const running = {
    translate: runningTransitions(frame, { property: 'translate' })[0],
    rotate: turn,
    scale: runningTransitions(frame, { property: 'scale' })[0],
    pivot: image ? runningTransitions(image, { property: 'translate' })[0] : undefined,
    hole: hole ? runningTransitions(hole, { property: 'clip-path' })[0] : undefined,
  }
  // Each part moves from where its own transition started, or is already where it goes.
  const startOf = (transition: CSSTransition | undefined, property: string) => {
    const value = (transition?.effect as KeyframeEffect | null)?.getKeyframes()[0]?.[
      property
    ]
    return typeof value === 'string' ? value : null
  }
  const translate = startOf(running.translate, 'translate')
  const rotate = startOf(running.rotate, 'rotate')
  const scale = startOf(running.scale, 'scale')
  const pivot = startOf(running.pivot, 'translate')
  const clip = startOf(running.hole, 'clipPath')
  const pivotFrom = pivot === null ? null : translateOf(pivot)
  const from: TurnPose = {
    translate: translate === null ? to.translate : translateOf(translate),
    rotate: rotate === null ? to.rotate : Number.parseFloat(rotate) || 0,
    scale: scale === null ? to.scale : Number.parseFloat(scale) || 1,
    pivot: pivotFrom === null ? to.pivot : [-pivotFrom[0], -pivotFrom[1]],
    hole: (clip === null ? null : holeOf(clip, box)) ?? to.hole,
  }
  const clockOf = (transition: CSSTransition | undefined) => {
    if (!transition) return null
    const effect = transition.effect as KeyframeEffect
    const duration = Number(effect.getComputedTiming().duration) || 0
    // A transition keeps its easing on its timing, not on its keyframes.
    const easing = effect.getTiming().easing ?? 'linear'
    return {
      // How far into the turn it started, in the turn's own time, so a slowed turn
      // holds too. Before the turn has a start, both read 0: it is asked again then.
      delay: Number(turn.currentTime ?? 0) - Number(transition.currentTime ?? 0),
      duration,
      curve: easingCurve(easing),
    }
  }
  const clocks = {
    translate: clockOf(running.translate),
    rotate: clockOf(running.rotate),
    scale: clockOf(running.scale),
    pivot: clockOf(running.pivot),
    hole: clockOf(running.hole),
  }
  const span = Math.max(
    ...Object.values(clocks).map((clock) =>
      clock === null ? 0 : clock.delay + clock.duration,
    ),
  )
  if (!(span > 0)) return []
  const STEPS = 40
  const scales = Array.from({ length: STEPS + 1 }, (_, step) => {
    const time = (span * step) / STEPS
    const at = (clock: (typeof clocks)['rotate']) =>
      clock && clock.duration > 0
        ? clock.curve(Math.min(1, Math.max(0, (time - clock.delay) / clock.duration)))
        : 1
    return turnCover(
      from,
      to,
      natural,
      {
        translate: at(clocks.translate),
        rotate: at(clocks.rotate),
        scale: at(clocks.scale),
        pivot: at(clocks.pivot),
        hole: at(clocks.hole),
      },
      round,
    )
  })
  if (scales.every((scale) => scale <= 1.0005)) return []
  // While it covers, it reaches up to 2px past the crop, so the straight
  // lines between its steps never leave a sliver; it tapers as it nears 1,
  // so it never jumps, at the end or when a turn takes over from another.
  const bleed = 2 / Math.max(1, Math.min(to.hole.width, to.hole.height) / 2)
  const keyframes = scales.map((scale) => ({
    transform: `scale(${scale + Math.min(bleed, scale - 1)})`,
  }))
  const covers = frames.map((element) => {
    const cover = element.animate(keyframes, {
      duration: span,
      easing: 'linear',
      id: FOLLOWS_TRANSITION,
    })
    // A transition that takes over from a running one starts on this frame's
    // clock, a frame before a new animation would, so the cover takes its start.
    cover.playbackRate = turn.playbackRate
    if (turn.startTime != null) cover.startTime = turn.startTime
    return cover
  })
  // A turn cut off (a resize turns transitions off) lands at rest, so its cover goes with it.
  turn.addEventListener('cancel', () => covers.forEach((cover) => cover.cancel()), {
    once: true,
  })
  return covers
}

/** A clip to `rect` inside a box of `size`, `grow` px larger on every side, and round for a circle. */
function insetClip(rect: Rect, size: Size, circle: boolean, grow = 0) {
  const top = round(rect.y - grow)
  const right = round(size.width - rect.x - rect.width - grow)
  const bottom = round(size.height - rect.y - rect.height - grow)
  const left = round(rect.x - grow)
  return `inset(${top}px ${right}px ${bottom}px ${left}px${circle ? ` round ${round(rect.width / 2 + grow)}px` : ''})`
}

/** Where each handle sits on the selection, as fractions of its width and height. */
const HANDLE_SPOTS: Record<ImageCropperHandlePosition, readonly [number, number]> = {
  n: [0.5, 0],
  e: [1, 0.5],
  s: [0.5, 1],
  w: [0, 0.5],
  ne: [1, 0],
  nw: [0, 0],
  se: [1, 1],
  sw: [0, 1],
}

/**
 * The styles that draw a crop in a viewport `stage` large: the image's
 * frame and `<img>`, the hole the crop shows through and the hairline round
 * it, the thirds and each handle's point, as the custom properties the parts
 * read.
 */
function viewportStyles(
  natural: Size,
  angle: number,
  layout: ReturnType<typeof cropLayout>,
  crop: Crop,
  stage: Size,
  circle: boolean,
): Record<string, string> {
  const { transform, selection } = layout
  const placement = imagePlacement(natural, angle, transform, crop)
  const styles: Record<string, string> = {
    '--image-cropper-frame-translate': placement.frame.translate,
    '--image-cropper-frame-rotate': placement.frame.rotate,
    '--image-cropper-frame-scale': placement.frame.scale,
    '--image-cropper-image-width': placement.image.width,
    '--image-cropper-image-height': placement.image.height,
    '--image-cropper-image-translate': placement.image.translate,
    '--image-cropper-image-scale': placement.image.scale,
    '--image-cropper-hole': insetClip(selection, stage, circle),
    '--image-cropper-ring': insetClip(selection, stage, circle, 1),
    '--image-cropper-selection-width': `${round(selection.width)}px`,
    '--image-cropper-selection-height': `${round(selection.height)}px`,
  }
  for (const third of [1, 2]) {
    styles[`--image-cropper-third-x${third}`] =
      `${round(selection.x + (selection.width * third) / 3)}px 0px`
    styles[`--image-cropper-third-y${third}`] =
      `0px ${round(selection.y + (selection.height * third) / 3)}px`
  }
  for (const [position, [across, down]] of Object.entries(HANDLE_SPOTS)) {
    // Centred on its point: a percentage of the handle's own size.
    styles[`--image-cropper-handle-${position}`] =
      `calc(${round(selection.x + selection.width * across)}px - 50%) calc(${round(selection.y + selection.height * down)}px - 50%)`
  }
  return styles
}

// ---------------------------------------------------------------------------
// The root

type CropperState = TypesOf<typeof imageCropper>['state']

/** Changes a pointer, the wheel or the zoom thumb makes: what draws the crop follows them at once. */
const FOLLOWED = new Set<ImageCropperCropChangeReason>([
  'drag',
  'pinch',
  'wheel',
  'zoom-input',
])

/**
 * ui-sdk's state as it is this moment, for the parts that draw the crop: a
 * pointer changes it on every frame, and they read it and write their styles
 * themselves, so nothing re-renders while it moves.
 */
interface CropperFeed {
  read: () => CropperState
  subscribe: (listener: () => void) => () => void
  /** Whether the last change came from a pointer, the wheel or the zoom thumb, and hasn't been committed yet. */
  following: () => boolean
}

interface ImageCropperContextValue {
  handle: PrimitiveHandle<typeof imageCropper>
  feed: CropperFeed
  src: string | undefined
  announce: (text: string) => void
}

const ImageCropperContext = createContext<ImageCropperContextValue | null>(null)

function useImageCropper() {
  const context = use(ImageCropperContext)
  if (!context) throw new Error('Image cropper parts go inside an ImageCropper.')
  return context
}

/** The crop can be drawn: the image has loaded and the viewport has room. */
function drawable(state: CropperState) {
  const { crop, natural, box } = state
  if (state.status !== 'loaded' || !crop || !natural || !box) return null
  if (box.width <= 0 || box.height <= 0) return null
  return {
    crop,
    natural,
    box: { x: box.left, y: box.top, width: box.width, height: box.height },
  }
}

type ImageCropperProps = OptionsOf<typeof imageCropper> &
  Omit<ComponentProps<'div'>, 'children' | 'defaultValue' | 'onChange'> & {
    children?: ReactNode
  }

/** Holds the image and its crop: ui-sdk's Image cropper. */
function ImageCropper({
  src,
  crop,
  defaultCrop,
  onCropChange,
  onCropCommit,
  mode = 'frame',
  aspectRatio,
  shape = 'rectangle',
  minWidth,
  minHeight,
  maxZoom = 3,
  disabled,
  controller,
  debug,
  className,
  children,
  ...props
}: ImageCropperProps) {
  const following = useRef(false)
  const covering = useRef<Crop | null>(null)
  const [committed] = useState(() => new Set<() => void>())
  const { announce, region } = useAnnouncer()
  const handle = usePrimitive(imageCropper, {
    src,
    crop,
    defaultCrop,
    mode,
    // A circle is always as wide as it is high.
    aspectRatio: shape === 'circle' ? 1 : aspectRatio,
    shape,
    minWidth,
    minHeight,
    maxZoom,
    disabled,
    controller,
    debug,
    onCropChange: (next, details) => {
      // ui-sdk starts a box at four fifths of the largest crop; Kino's starts at the largest,
      // so the image opens whole at a zoom of 1. ui-sdk takes a crop only once it has one, so
      // its first lands and the largest replaces it as the load commits, before a paint, and
      // only the largest reaches a buyer.
      const natural = handle.instance.get().natural
      if (details.reason === 'image-load' && mode === 'box' && natural) {
        const full = largestCrop(natural, shape === 'circle' ? 1 : aspectRatio)
        if (!sameRect(next, full)) {
          covering.current = full
          return
        }
      }
      following.current = FOLLOWED.has(details.reason)
      onCropChange?.(next, details)
    },
    onCropCommit: (next, details) => {
      const cover = covering.current
      if (cover && details.reason === 'image-load') {
        covering.current = null
        handle.api.setCrop(cover, { reason: 'image-load', event: details.event })
        return
      }
      following.current = false
      for (const listener of committed) listener()
      onCropCommit?.(next, details)
      if (details.reason === 'rotate-press' || details.reason === 'rotate-key')
        announce(`Rotated to ${next.rotation} degrees`)
    },
  })
  const { instance } = handle
  const feed = useMemo<CropperFeed>(
    () => ({
      read: () => instance.get(),
      subscribe(listener) {
        const unsubscribe = instance.subscribe(listener)
        committed.add(listener)
        return () => {
          unsubscribe()
          committed.delete(listener)
        }
      },
      following: () => following.current,
    }),
    [instance, committed],
  )
  return usePart(
    handle,
    'root',
    {},
    {
      ...props,
      className: cn('flex w-full min-w-0 flex-col gap-3', className),
      children: (
        <ImageCropperContext value={{ handle, feed, src, announce }}>
          {children}
          {region}
        </ImageCropperContext>
      ),
    },
    'div',
  )
}

// ---------------------------------------------------------------------------
// The viewport and what it shows

/** A layer that glides on `layout`, and follows at once while followed or while the viewport resizes. */
const glideClassName =
  'transition-[translate,scale,rotate,clip-path] duration-(--motion-layout-duration) ease-(--motion-layout-easing) group-data-following/cropper:duration-0 group-data-resizing/cropper:transition-none motion-reduce:transition-none'

/** The image's frame: at the crop's centre, turned and scaled about it. */
const frameClassName = cn(
  'absolute top-0 left-0 origin-top-left [translate:var(--image-cropper-frame-translate)] [rotate:var(--image-cropper-frame-rotate)] [scale:var(--image-cropper-frame-scale)]',
  glideClassName,
)

/** The image in its frame: at its own size, moved so the crop's centre is on the frame's corner, and mirrored for a flip. */
const pictureClassName = cn(
  'absolute top-0 left-0 h-(--image-cropper-image-height) w-(--image-cropper-image-width) max-w-none [translate:var(--image-cropper-image-translate)] [scale:var(--image-cropper-image-scale)]',
  // The flip doesn't glide: the paint that changes it moves everything at once.
  'transition-[translate] duration-(--motion-layout-duration) ease-(--motion-layout-easing) group-data-following/cropper:duration-0 group-data-resizing/cropper:transition-none motion-reduce:transition-none',
)

/**
 * Where the image and its crop show: ui-sdk's viewport, which a pointer pans
 * in a frame and the wheel zooms, and whose padding keeps the crop off its
 * edges. It draws whatever is inside it from ui-sdk's state.
 */
function ImageCropperViewport({
  className,
  ref,
  children,
  ...props
}: Omit<ComponentProps<typeof ImageCropperViewportPrimitive>, 'className'> & {
  className?: string
}) {
  const { feed } = useImageCropper()
  const own = useRef<HTMLDivElement>(null)
  // Placed in pixels worked out from its size, so while it resizes nothing glides.
  const refs = useMemo(() => mergeRefs(own, markResizing, ref), [ref])
  useLayoutEffect(() => {
    let painted = false
    /** The angle last drawn, so a turn goes the shorter way round from it. */
    let angle: number | null = null
    let flips = ''
    let covers: Animation[] = []
    const paint = () => {
      const element = own.current
      const state = feed.read()
      const ready = drawable(state)
      if (!element || !ready) {
        painted = false
        angle = null
        return
      }
      const { crop, natural, box } = ready
      const mirrored = mirrorOf(crop).join()
      // Nothing glides into place on first paint, and a flip lands at once.
      const instant = !painted || mirrored !== flips
      painted = true
      flips = mirrored
      element.toggleAttribute('data-following', feed.following() || instant)
      const last = angle
      angle = last === null ? crop.rotation : nextAngle(last, crop.rotation)
      const stage = { width: element.clientWidth, height: element.clientHeight }
      const layout = cropLayout(crop, natural, box, state.mode, state.aspectRatio)
      const circle = state.shape === 'circle'
      for (const [name, value] of Object.entries(
        viewportStyles(natural, angle, layout, crop, stage, circle),
      ))
        element.style.setProperty(name, value)
      const frames = [
        ...element.querySelectorAll<HTMLElement>('[data-image-cropper-frame]'),
      ]
      // A turn, and any move while one plays, works its cover out again.
      const recover =
        !instant &&
        ((last !== null && angle !== last) ||
          (frames[0] !== undefined &&
            runningTransitions(frames[0], { property: 'rotate' }).length > 0))
      if (!recover) return
      for (const cover of covers) cover.cancel()
      // Once everything that turns has its transition.
      const made = coverTurn(
        frames,
        frames[0]?.querySelector('img') ?? null,
        element.querySelector('[data-image-cropper-hole]'),
        stage,
        { ...imagePose(natural, angle, layout.transform, crop), hole: layout.selection },
        natural,
        circle,
        () => {
          if (covers === made) paint()
        },
      )
      covers = made
    }
    paint()
    const unsubscribe = feed.subscribe(paint)
    return () => {
      unsubscribe()
      for (const cover of covers) cover.cancel()
    }
  }, [feed])
  // ui-sdk zooms on every wheel over a frame. It gets the wheel only once the crop has focus, or with Ctrl or Cmd, as a trackpad's pinch is sent, so the page still scrolls past it.
  useEffect(() => {
    const element = own.current
    if (!element) return
    const gate = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey || element.contains(document.activeElement))
        return
      event.stopImmediatePropagation()
    }
    element.addEventListener('wheel', gate, { capture: true })
    return () => element.removeEventListener('wheel', gate, { capture: true })
  }, [])
  return (
    <ImageCropperViewportPrimitive
      ref={refs}
      className={cn(
        'group/cropper bg-muted relative isolate h-80 w-full overflow-hidden rounded-(--surface-radius) select-none',
        // ui-sdk's box: room round a frame for the image around it, and round a box for its handles.
        'data-[mode=box]:p-4 data-[mode=frame]:p-6',
        // A frame is dragged; ui-sdk's own cursor for it is `move`.
        'data-[mode=frame]:cursor-grab! data-[mode=frame]:data-dragging:cursor-grabbing! data-disabled:cursor-default!',
        // The selection and the handles take focus inside it, and it shows the ring.
        'has-focus-visible:ring-ring/50 has-focus-visible:ring-3 has-focus-visible:outline-hidden',
        'data-disabled:pointer-events-none data-disabled:opacity-50',
        className,
      )}
      {...props}
    >
      {children}
    </ImageCropperViewportPrimitive>
  )
}

/**
 * The image: dimmed outside the crop, with a hairline round the crop, and at
 * full brightness through it.
 * ui-sdk's image is the one at full brightness, which it loads and names.
 */
function ImageCropperImage({
  alt,
  crossOrigin,
  className,
  ...props
}: Omit<ComponentProps<typeof ImageCropperImagePrimitive>, 'className'> & {
  alt: string
  className?: string
}) {
  const { src } = useImageCropper()
  return (
    <>
      {/* The whole image, dimmed outside the crop. */}
      <div
        aria-hidden
        className='pointer-events-none absolute inset-0 group-data-error/cropper:hidden group-data-loading/cropper:invisible'
      >
        <div data-image-cropper-frame='' className={frameClassName}>
          {/* oxlint-disable-next-line nextjs/no-img-element -- a registry item can't use next/image */}
          <img
            src={src}
            alt=''
            crossOrigin={crossOrigin}
            draggable={false}
            className={pictureClassName}
          />
        </div>
        <div className='absolute inset-0 bg-black/55 forced-color-adjust-none' />
      </div>
      {/* A hairline round the crop, one pixel outside it, under the crop. */}
      <div
        aria-hidden
        className={cn(
          'pointer-events-none absolute inset-0 bg-white/80 [clip-path:var(--image-cropper-ring,inset(50%))] group-data-error/cropper:hidden group-data-loading/cropper:invisible forced-colors:bg-[CanvasText]',
          glideClassName,
        )}
      />
      {/* The crop at full brightness: the same image, clipped to it. */}
      <div
        data-image-cropper-hole=''
        className={cn(
          'pointer-events-none absolute inset-0 [clip-path:var(--image-cropper-hole,inset(50%))] group-data-error/cropper:hidden group-data-loading/cropper:invisible',
          glideClassName,
        )}
      >
        <div data-image-cropper-frame='' className={frameClassName}>
          <ImageCropperImagePrimitive
            alt={alt}
            crossOrigin={crossOrigin}
            // ui-sdk places the image with `left`, `top`, `width`, `height` and `transform`; its frame places it instead.
            className={cn(
              pictureClassName,
              'top-0! left-0! h-(--image-cropper-image-height)! w-(--image-cropper-image-width)! transform-none!',
              className,
            )}
            {...props}
          />
        </div>
      </div>
    </>
  )
}

/**
 * The crop: ui-sdk's selection, a slider that a box drags and the keys move,
 * as large as the viewport and clipped to the crop.
 */
function ImageCropperSelection({
  className,
  ...props
}: Omit<ComponentProps<typeof ImageCropperSelectionPrimitive>, 'className'> & {
  className?: string
}) {
  return (
    <ImageCropperSelectionPrimitive
      // ui-sdk places the selection with `left`, `top`, `width` and `height`; a clip places it instead, so its edge glides.
      className={cn(
        'top-0! left-0! h-full! w-full! [clip-path:var(--image-cropper-hole,inset(50%))] focus-visible:outline-hidden',
        glideClassName,
        className,
      )}
      {...props}
    />
  )
}

/** Thirds across the crop, while a pointer drags it. Goes inside the selection. */
function ImageCropperGrid({
  className,
  ...props
}: Omit<ComponentProps<typeof ImageCropperGridPrimitive>, 'className' | 'children'> & {
  className?: string
}) {
  return (
    <ImageCropperGridPrimitive
      className={cn(
        'opacity-0 data-dragging:opacity-100',
        // It fades in on `enter` and out on `exit`.
        'transition-opacity duration-(--motion-exit-duration) ease-(--motion-exit-easing) data-dragging:duration-(--motion-enter-duration) data-dragging:ease-(--motion-enter-easing)',
        className,
      )}
      {...props}
    >
      {(['x1', 'y1', 'x2', 'y2'] as const).map((third) => (
        <span
          key={third}
          className={cn(
            'absolute top-0 left-0 bg-white/60 forced-colors:bg-[CanvasText]',
            third.startsWith('x') ? 'h-full w-px' : 'h-px w-full',
            third === 'x1' && '[translate:var(--image-cropper-third-x1)]',
            third === 'x2' && '[translate:var(--image-cropper-third-x2)]',
            third === 'y1' && '[translate:var(--image-cropper-third-y1)]',
            third === 'y2' && '[translate:var(--image-cropper-third-y2)]',
            glideClassName,
          )}
        />
      ))}
    </ImageCropperGridPrimitive>
  )
}

/** Each handle's point, in the classes Tailwind reads. */
const HANDLE_PLACES: Record<ImageCropperHandlePosition, string> = {
  n: '[translate:var(--image-cropper-handle-n)]',
  e: '[translate:var(--image-cropper-handle-e)]',
  s: '[translate:var(--image-cropper-handle-s)]',
  w: '[translate:var(--image-cropper-handle-w)]',
  ne: '[translate:var(--image-cropper-handle-ne)]',
  nw: '[translate:var(--image-cropper-handle-nw)]',
  se: '[translate:var(--image-cropper-handle-se)]',
  sw: '[translate:var(--image-cropper-handle-sw)]',
}

/** A corner's mark: its arms, and the offset that puts its outer edge on the crop's corner. */
const CORNER_MARKS: Partial<Record<ImageCropperHandlePosition, string>> = {
  nw: 'top-[calc(50%-3px)] left-[calc(50%-3px)] border-t-[3px] border-l-[3px]',
  ne: 'top-[calc(50%-3px)] left-[calc(50%-17px)] border-t-[3px] border-r-[3px]',
  se: 'top-[calc(50%-17px)] left-[calc(50%-17px)] border-r-[3px] border-b-[3px]',
  sw: 'top-[calc(50%-17px)] left-[calc(50%-3px)] border-b-[3px] border-l-[3px]',
}

/** A rectangle's side, as long as the selection less a corner's reach at each end. */
const EDGE_LENGTHS: Partial<Record<ImageCropperHandlePosition, string>> = {
  n: 'w-[max(0px,calc(var(--image-cropper-selection-width)-1.5rem))] pointer-coarse:w-[max(0px,calc(var(--image-cropper-selection-width)-2.5rem))]',
  s: 'w-[max(0px,calc(var(--image-cropper-selection-width)-1.5rem))] pointer-coarse:w-[max(0px,calc(var(--image-cropper-selection-width)-2.5rem))]',
  e: 'h-[max(0px,calc(var(--image-cropper-selection-height)-1.5rem))] pointer-coarse:h-[max(0px,calc(var(--image-cropper-selection-height)-2.5rem))]',
  w: 'h-[max(0px,calc(var(--image-cropper-selection-height)-1.5rem))] pointer-coarse:h-[max(0px,calc(var(--image-cropper-selection-height)-2.5rem))]',
}

/**
 * A side or corner of a box's selection, by `position`: ui-sdk's handle, a
 * slider whose arrows move its edges. A corner shows its mark, a side of a
 * rectangle runs along it, and a side of a circle shows a dot.
 */
function ImageCropperHandle({
  position,
  className,
  ...props
}: Omit<ComponentProps<typeof ImageCropperHandlePrimitive>, 'className' | 'children'> & {
  className?: string
}) {
  const corner = CORNER_MARKS[position]
  return (
    <ImageCropperHandlePrimitive
      position={position}
      className={(state) =>
        cn(
          // ui-sdk places a handle with `left` and `top`; it takes its point from `translate` instead, so it glides.
          'group/handle top-0! left-0! rounded-full focus-visible:ring-3 focus-visible:ring-white focus-visible:outline-hidden',
          // At least 24px to take hold of by mouse, the quality bar's smallest target, and 40px by touch.
          'size-6 pointer-coarse:size-10',
          // A rectangle's side runs along it, between its corners.
          !corner && state.shape === 'rectangle' && EDGE_LENGTHS[position],
          HANDLE_PLACES[position],
          glideClassName,
          className,
        )
      }
      {...props}
    >
      {corner ? (
        <span
          aria-hidden
          className={cn(
            'pointer-events-none absolute size-5 border-white drop-shadow-[0_0_1px_rgb(0_0_0/0.6)] forced-colors:border-[CanvasText]',
            corner,
          )}
        />
      ) : (
        <span
          aria-hidden
          className='pointer-events-none absolute top-1/2 left-1/2 hidden size-3 -translate-1/2 rounded-full bg-white shadow-[0_0_0_1px_rgb(0_0_0/0.25)] group-data-[shape=circle]/cropper:block forced-colors:bg-[CanvasText]'
        />
      )}
    </ImageCropperHandlePrimitive>
  )
}

const INSTRUCTIONS: Record<ImageCropperMode, string> = {
  frame:
    'Drag or use the arrow keys to move the crop over the image, pinch, scroll or press plus and minus to zoom, and press R to rotate, or Shift and R to rotate back.',
  box: 'Drag or use the arrow keys to move the selection, Tab to its edges and corners to resize it, press plus and minus to zoom, and press R to rotate, or Shift and R to rotate back.',
}

/** Says the image failed, in the cropper's status region, once. */
function LoadFailed() {
  const { announce } = useImageCropper()
  const announced = useRef(announce)
  useEffect(() => {
    announced.current('The image couldn’t be loaded.')
  }, [])
  return (
    <div className='text-muted-foreground absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center text-sm [&_svg]:size-5'>
      <IconPlaceholder
        lucide='ImageOffIcon'
        tabler='IconPhotoOff'
        phosphor='ImageBrokenIcon'
        hugeicons='ImageNotFound01Icon'
        remixicon='RiImageCircleLine'
        aria-hidden
      />
      <span className='text-foreground'>The image couldn’t be loaded.</span>
    </div>
  )
}

/** A spinner once the image has taken a moment to load. */
function Loading({ loading }: { loading: boolean }) {
  const spinning = useSpinner(loading)
  return loading && spinning ? (
    <div className='text-muted-foreground absolute inset-0 flex items-center justify-center'>
      <Spinner aria-label='Loading image' />
    </div>
  ) : null
}

const RECTANGLE_HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const
const CIRCLE_HANDLES = ['n', 'e', 's', 'w'] as const

/**
 * The ready-made area: the viewport with the image, the crop and its thirds,
 * the handles a box resizes with, and the loading and failed states.
 */
function ImageCropperArea({
  alt,
  crossOrigin,
  className,
  ...props
}: Omit<ComponentProps<typeof ImageCropperViewport>, 'children'> & {
  /** What the image shows, for a screen reader. */
  alt: string
  crossOrigin?: ComponentProps<'img'>['crossOrigin']
}) {
  const instructionsId = useId()
  return (
    <ImageCropperViewport className={className} {...props}>
      {({ loading, error, mode, shape }) => (
        <>
          {error ? (
            <LoadFailed />
          ) : (
            <p id={instructionsId} className='sr-only'>
              {INSTRUCTIONS[mode]}
            </p>
          )}
          <Loading loading={loading} />
          <ImageCropperImage alt={alt} crossOrigin={crossOrigin} />
          <ImageCropperSelection aria-describedby={error ? undefined : instructionsId}>
            <ImageCropperGrid />
          </ImageCropperSelection>
          {mode === 'box'
            ? (shape === 'circle' ? CIRCLE_HANDLES : RECTANGLE_HANDLES).map(
                (position) => <ImageCropperHandle key={position} position={position} />,
              )
            : null}
        </>
      )}
    </ImageCropperViewport>
  )
}

// ---------------------------------------------------------------------------
// Controls

/** How much the zoom buttons zoom by, as ui-sdk's plus and minus keys do. */
const ZOOM_STEP = 1.25

/** Where the zoom is between 1 and the most, from 0 to 100. */
function zoomPercent(zoom: number, maxZoom: number) {
  if (!(maxZoom > 1)) return 0
  return Math.min(100, Math.max(0, ((zoom - 1) / (maxZoom - 1)) * 100))
}

/** Which ends of the zoom it is at, as one word, so a render only follows a change of it. */
function zoomEnds(state: CropperState, zoom: number) {
  if (state.disabled || state.status !== 'loaded' || !state.crop || !state.natural)
    return 'inactive'
  if (zoom <= 1.001) return 'out'
  if (zoom >= state.maxZoom - 0.001) return 'in'
  return 'between'
}

/**
 * Zooms the crop in and out: ui-sdk's zoom, a range input, drawn as Kino's
 * Slider, with a button at each end.
 */
function ImageCropperZoom({
  className,
  ...props
}: Omit<ComponentProps<typeof ImageCropperZoomPrimitive>, 'className'> & {
  /** For the row's layout: the buttons and the slider sit in it. */
  className?: string
}) {
  const { handle, feed, announce } = useImageCropper()
  const ends = useSyncExternalStore(
    feed.subscribe,
    () => zoomEnds(feed.read(), handle.api.getZoom()),
    () => 'inactive',
  )
  const controlRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const paint = () => {
      const control = controlRef.current
      if (!control) return
      control.toggleAttribute('data-following', feed.following())
      control.style.setProperty(
        '--image-cropper-zoom',
        `${zoomPercent(handle.api.getZoom(), feed.read().maxZoom)}`,
      )
    }
    paint()
    return feed.subscribe(paint)
  }, [feed, handle])
  const inactive = ends === 'inactive'
  const step = (factor: number) => {
    handle.api.setZoom(handle.api.getZoom() * factor)
    announce(`Zoom ${Math.round(handle.api.getZoom() * 100)}%`)
  }
  return (
    <div
      data-image-cropper-zoom=''
      className={cn('flex min-w-0 items-center gap-4', className)}
    >
      <Button
        variant='ghost'
        size='icon-sm'
        aria-label='Zoom out'
        // It stays in the tab order at the end of its range, so focus isn't lost when it gets there.
        focusableWhenDisabled={!inactive}
        disabled={inactive || ends === 'out'}
        onClick={() => step(1 / ZOOM_STEP)}
      >
        <IconPlaceholder
          lucide='ZoomOutIcon'
          tabler='IconZoomOut'
          phosphor='MagnifyingGlassMinusIcon'
          hugeicons='SearchMinusIcon'
          remixicon='RiZoomOutLine'
          aria-hidden
        />
      </Button>
      <div
        ref={controlRef}
        className={cn(
          trackDirClassName,
          'group/thumb @container relative flex h-(--control-height-xs) min-w-0 flex-1 touch-none items-center select-none has-disabled:opacity-50',
        )}
      >
        <span aria-hidden className={sliderTrackClassName}>
          <span
            className={cn(
              trackFillClassName,
              'pointer-events-none inset-x-0',
              'transition-[clip-path] duration-(--motion-layout-duration) ease-(--motion-layout-easing) group-data-following/thumb:duration-0 motion-reduce:transition-none',
              '[clip-path:inset(0_calc(100%-var(--image-cropper-zoom)*1%)_0_0_round_9999px)] rtl:[clip-path:inset(0_0_0_calc(100%-var(--image-cropper-zoom)*1%)_round_9999px)]',
            )}
          />
        </span>
        <span
          aria-hidden
          className={cn(
            'pointer-events-none absolute start-0 top-1/2 flex size-6 [translate:calc(var(--track-dir)*(var(--image-cropper-zoom)*1cqw-50%))_-50%] items-center justify-center rounded-full',
            'transition-[translate] duration-(--motion-layout-duration) ease-(--motion-layout-easing) group-data-following/thumb:duration-0 motion-reduce:transition-none',
          )}
        >
          <span className={sliderThumbClassName} />
        </span>
        <ImageCropperZoomPrimitive
          // The range input takes the pointer and the keys; the track and thumb under it draw it.
          className='absolute inset-0 m-0 size-full appearance-none opacity-0 disabled:pointer-events-none [&::-moz-range-thumb]:size-px [&::-webkit-slider-thumb]:size-px [&::-webkit-slider-thumb]:appearance-none'
          {...props}
        />
      </div>
      <Button
        variant='ghost'
        size='icon-sm'
        aria-label='Zoom in'
        focusableWhenDisabled={!inactive}
        disabled={inactive || ends === 'in'}
        onClick={() => step(ZOOM_STEP)}
      >
        <IconPlaceholder
          lucide='ZoomInIcon'
          tabler='IconZoomIn'
          phosphor='MagnifyingGlassPlusIcon'
          hugeicons='SearchAddIcon'
          remixicon='RiZoomInLine'
          aria-hidden
        />
      </Button>
    </div>
  )
}

/** Turns the image a quarter clockwise, keeping the same part of it in the crop: ui-sdk's rotate, as Kino's Button. */
function ImageCropperRotate({
  className,
  ...props
}: Omit<ComponentProps<typeof Button>, 'onClick' | 'children'>) {
  return (
    <ImageCropperRotatePrimitive
      render={
        <Button
          data-image-cropper-rotate=''
          variant='ghost'
          size='icon-sm'
          aria-label='Rotate clockwise'
          className={className}
          {...props}
        />
      }
    >
      <IconPlaceholder
        lucide='RotateCwIcon'
        tabler='IconRotateClockwise'
        phosphor='ArrowClockwiseIcon'
        hugeicons='RotateClockwiseIcon'
        remixicon='RiClockwiseLine'
        aria-hidden
      />
    </ImageCropperRotatePrimitive>
  )
}

/**
 * The crop as it will look, live, such as the avatar it becomes: it fills
 * its own box, which its class sizes, and is round for a round crop.
 */
function ImageCropperPreview({ className, ref, ...props }: ComponentProps<'div'>) {
  const { src, feed } = useImageCropper()
  const shape = useSyncExternalStore(
    feed.subscribe,
    () => feed.read().shape,
    () => 'rectangle' as ImageCropperShape,
  )
  const loaded = useSyncExternalStore(
    feed.subscribe,
    () => feed.read().status === 'loaded',
    () => false,
  )
  const [box, setBox] = useState<Size | null>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const boxRefs = useMemo(() => mergeRefs(boxRef, markResizing, ref), [ref])
  const frameRef = useRef<HTMLDivElement>(null)
  const imageRef = useRef<HTMLImageElement>(null)
  useEffect(() => {
    const element = boxRef.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) =>
      flushSync(() =>
        setBox({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        }),
      ),
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  // It follows ui-sdk's state, so it keeps up with a drag without rendering.
  useLayoutEffect(() => {
    let angle: number | null = null
    let flips = ''
    let covers: Animation[] = []
    const paint = () => {
      const element = boxRef.current
      const state = feed.read()
      const { crop, natural } = state
      if (!element || !natural || !crop || !box) return
      const mirrored = mirrorOf(crop).join()
      const instant = angle === null || mirrored !== flips
      flips = mirrored
      element.toggleAttribute('data-following', feed.following() || instant)
      const last = angle
      angle = last === null ? crop.rotation : nextAngle(last, crop.rotation)
      const frame = coverRect(imageRect(box), crop.width / crop.height)
      const transform = viewTransform(crop, frame)
      const recover =
        !instant &&
        ((last !== null && angle !== last) ||
          (frameRef.current !== null &&
            runningTransitions(frameRef.current, { property: 'rotate' }).length > 0))
      const placement = imagePlacement(natural, angle, transform, crop)
      if (frameRef.current) Object.assign(frameRef.current.style, placement.frame)
      if (imageRef.current) Object.assign(imageRef.current.style, placement.image)
      if (!recover || !frameRef.current) return
      for (const cover of covers) cover.cancel()
      const made: Animation[] = coverTurn(
        [frameRef.current],
        imageRef.current,
        null,
        box,
        { ...imagePose(natural, angle, transform, crop), hole: imageRect(box) },
        natural,
        state.shape === 'circle',
        () => {
          if (covers === made) paint()
        },
      )
      covers = made
    }
    paint()
    const unsubscribe = feed.subscribe(paint)
    return () => {
      unsubscribe()
      for (const cover of covers) cover.cancel()
    }
  }, [feed, box, loaded])
  return (
    <div
      ref={boxRefs}
      data-image-cropper-preview=''
      aria-hidden
      className={cn(
        'group/cropper bg-muted relative size-16 shrink-0 overflow-hidden',
        shape === 'circle' ? 'rounded-full' : 'rounded-(--control-radius-capped)',
        className,
      )}
      {...props}
    >
      {loaded && box ? (
        <div
          ref={frameRef}
          className={cn('absolute top-0 left-0 origin-top-left', glideClassName)}
        >
          {/* oxlint-disable-next-line nextjs/no-img-element -- a registry item can't use next/image */}
          <img
            ref={imageRef}
            src={src}
            alt=''
            draggable={false}
            className={cn(
              'absolute top-0 left-0 max-w-none',
              'transition-[translate] duration-(--motion-layout-duration) ease-(--motion-layout-easing) group-data-following/cropper:duration-0 group-data-resizing/cropper:transition-none motion-reduce:transition-none',
            )}
          />
        </div>
      ) : null}
    </div>
  )
}

export {
  ImageCropper,
  ImageCropperArea,
  ImageCropperGrid,
  ImageCropperHandle,
  ImageCropperImage,
  ImageCropperPreview,
  ImageCropperRotate,
  ImageCropperSelection,
  ImageCropperViewport,
  ImageCropperZoom,
}

export {
  cropLayout,
  imagePlacement,
  imagePose,
  insetClip,
  largestCrop,
  mirrorOf,
  nextAngle,
  turnCover,
  viewportStyles,
  zoomPercent,
}

export type { Rect, Size, TurnPose }
