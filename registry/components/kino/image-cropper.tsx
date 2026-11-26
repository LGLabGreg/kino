'use client'

import { Button } from '@/registry/components/kino/button'
import { Slider } from '@/registry/components/kino/slider'
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
import {
  type ComponentProps,
  createContext,
  type KeyboardEvent,
  type PointerEvent,
  use,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { flushSync } from 'react-dom'

import { cn } from '@/lib/utils'

/*
 * Picking the part of an image to keep. The crop is a rectangle in the
 * image's own pixels, as it is shown after a quarter-turn rotation, so it
 * means the same at any size on screen, and `cropImage` cuts it out of the
 * file exactly.
 *
 * What a person moves depends on the area's mode:
 * - `frame`: the frame stays still and the image pans and zooms under it.
 * - `box`: the image stays still and a selection moves and resizes over it.
 * - `settle`: the selection resizes over the image, and when it is let go it
 *   glides back to fill the area while the image zooms to match.
 *
 * The image is the same way round in either text direction, so the layers
 * over it are placed from its physical top left, measured in pixels, and the
 * corner marks' 3px arms and 17px offsets (a 20px mark less its arm) are
 * physical too.
 *
 * Everything that moves is placed with `translate`, `scale`, `rotate` and
 * `clip-path`, written as numbers for CSS to carry: a change from a key, a
 * press on the zoom track or a let-go glides there on `layout`, and a
 * pointer, a wheel or a pinch is followed at once (`data-following`).
 */

// ---------------------------------------------------------------------------
// The crop's arithmetic

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

/** Quarter turns clockwise, in degrees. */
type CropRotation = 0 | 90 | 180 | 270

/**
 * The part of the image to keep: a rectangle in the pixels of the image as
 * it is shown, after it is turned `rotation` degrees clockwise. Its edges can
 * fall between pixels; `cropImage` rounds them.
 */
interface Crop extends Rect {
  rotation: CropRotation
}

/** A side or corner of the selection, by compass point. */
type CropHandle = 'n' | 'e' | 's' | 'w' | 'ne' | 'se' | 'sw' | 'nw'

/** Why the crop changed. */
type CropChangeReason =
  | 'load'
  | 'drag'
  | 'resize'
  | 'draw'
  | 'pinch'
  | 'wheel'
  | 'keyboard'
  | 'zoom'
  | 'rotate'
  | 'aspect'
  | 'cancel'

interface CropChangeDetails {
  reason: CropChangeReason
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

/** The image's size once it is turned `rotation` degrees. */
function rotatedSize(size: Size, rotation: CropRotation): Size {
  return rotation % 180 === 0 ? size : { width: size.height, height: size.width }
}

/** Where a point of the image as it was taken lands once the image is turned `rotation` degrees clockwise. */
function toShown(point: Point, natural: Size, rotation: CropRotation): Point {
  if (rotation === 90) return { x: natural.height - point.y, y: point.x }
  if (rotation === 180) return { x: natural.width - point.x, y: natural.height - point.y }
  if (rotation === 270) return { x: point.y, y: natural.width - point.x }
  return { ...point }
}

/** The point of the image as it was taken that shows at `point` once it is turned `rotation` degrees. */
function toNatural(point: Point, natural: Size, rotation: CropRotation): Point {
  if (rotation === 90) return { x: point.y, y: natural.height - point.x }
  if (rotation === 180) return { x: natural.width - point.x, y: natural.height - point.y }
  if (rotation === 270) return { x: natural.width - point.y, y: point.x }
  return { ...point }
}

/** The largest rectangle `aspect` wide for each pixel high that fits in `bounds`, centred in it; all of `bounds` with no aspect. */
function fitRect(bounds: Rect, aspect?: number): Rect {
  if (!aspect) return { ...bounds }
  const width = Math.min(bounds.width, bounds.height * aspect)
  const height = width / aspect
  return {
    x: bounds.x + (bounds.width - width) / 2,
    y: bounds.y + (bounds.height - height) / 2,
    width,
    height,
  }
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

/** The part of `a` inside `b`. */
function intersectRect(a: Rect, b: Rect): Rect {
  const x = Math.max(a.x, b.x)
  const y = Math.max(a.y, b.y)
  return {
    x,
    y,
    width: Math.max(0, Math.min(a.x + a.width, b.x + b.width) - x),
    height: Math.max(0, Math.min(a.y + a.height, b.y + b.height) - y),
  }
}

/** How far a crop is zoomed in: 1 when it is the largest of its shape the image holds, 2 at half that width. */
function cropZoom(rect: Size, image: Size) {
  return fitRect(imageRect(image), rect.width / rect.height).width / rect.width
}

/** `rect` moved the least it takes to lie inside `bounds`, and shrunk about its centre first if it is larger. */
function keepInside(rect: Rect, bounds: Rect): Rect {
  const shrink = Math.min(1, bounds.width / rect.width, bounds.height / rect.height)
  const width = rect.width * shrink
  const height = rect.height * shrink
  const x = rect.x + (rect.width - width) / 2
  const y = rect.y + (rect.height - height) / 2
  return {
    x: clamp(x, bounds.x, bounds.x + bounds.width - width),
    y: clamp(y, bounds.y, bounds.y + bounds.height - height),
    width,
    height,
  }
}

/** `rect` moved by `dx` and `dy`, as far as the image allows. */
function moveRect(rect: Rect, image: Size, dx: number, dy: number): Rect {
  return keepInside({ ...rect, x: rect.x + dx, y: rect.y + dy }, imageRect(image))
}

/**
 * `rect` zoomed to `zoom`, between 1 and `maxZoom`, about `anchor`: the point
 * of the image there stays where it is, unless that would leave the image.
 */
function zoomRect(
  rect: Rect,
  image: Size,
  zoom: number,
  maxZoom: number,
  anchor: Point = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 },
): Rect {
  const largest = fitRect(imageRect(image), rect.width / rect.height)
  const ratio = largest.width / clamp(zoom, 1, maxZoom) / rect.width
  return keepInside(
    {
      x: anchor.x - (anchor.x - rect.x) * ratio,
      y: anchor.y - (anchor.y - rect.y) * ratio,
      width: rect.width * ratio,
      height: rect.height * ratio,
    },
    imageRect(image),
  )
}

/**
 * `rect` given `aspect` about its centre, at the same zoom, inside the image:
 * a crop after the aspect changes, or after a turn swaps its sides.
 */
function reshapeRect(rect: Rect, image: Size, aspect: number | undefined): Rect {
  if (!aspect) return keepInside(rect, imageRect(image))
  const zoom = cropZoom(rect, image)
  const largest = fitRect(imageRect(image), aspect)
  const width = largest.width / zoom
  const height = largest.height / zoom
  return keepInside(
    {
      x: rect.x + (rect.width - width) / 2,
      y: rect.y + (rect.height - height) / 2,
      width,
      height,
    },
    imageRect(image),
  )
}

interface ResizeLimits {
  /** Width over height, kept while resizing; free when left out. */
  aspect?: number
  /** The smallest the rectangle may get, in the same pixels. */
  minWidth: number
  minHeight: number
}

/**
 * `start` with the side or corner `handle` dragged by `dx` and `dy`, inside
 * `bounds` and no smaller than the limits. The opposite side or corner stays
 * put; with an aspect, a side drag keeps the centre of the side it runs
 * along, and a corner follows whichever of the pointer's moves changes the
 * size more.
 */
function resizeRect(
  start: Rect,
  handle: CropHandle,
  dx: number,
  dy: number,
  bounds: Rect,
  { aspect, minWidth, minHeight }: ResizeLimits,
): Rect {
  const west = handle.includes('w')
  const east = handle.includes('e')
  const north = handle.includes('n')
  const south = handle.includes('s')
  const left = start.x
  const top = start.y
  const right = start.x + start.width
  const bottom = start.y + start.height
  const boundsRight = bounds.x + bounds.width
  const boundsBottom = bounds.y + bounds.height

  if (!aspect) {
    const x0 = west ? clamp(left + dx, bounds.x, right - minWidth) : left
    const x1 = east ? clamp(right + dx, left + minWidth, boundsRight) : right
    const y0 = north ? clamp(top + dy, bounds.y, bottom - minHeight) : top
    const y1 = south ? clamp(bottom + dy, top + minHeight, boundsBottom) : bottom
    return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }
  }

  const smallest = Math.max(minWidth, minHeight * aspect)
  const centreX = left + start.width / 2
  const centreY = top + start.height / 2
  // How wide it may get from the side or corner that stays put.
  const roomX = west
    ? right - bounds.x
    : east
      ? boundsRight - left
      : 2 * Math.min(centreX - bounds.x, boundsRight - centreX)
  const roomY = north
    ? bottom - bounds.y
    : south
      ? boundsBottom - top
      : 2 * Math.min(centreY - bounds.y, boundsBottom - centreY)
  const largest = Math.min(roomX, roomY * aspect)

  const fromX = start.width + (west ? -dx : east ? dx : 0)
  const fromY = (start.height + (north ? -dy : south ? dy : 0)) * aspect
  const horizontal = west || east
  const vertical = north || south
  const wanted =
    horizontal && vertical
      ? Math.abs(fromX - start.width) >= Math.abs(fromY - start.width)
        ? fromX
        : fromY
      : horizontal
        ? fromX
        : fromY
  const width = clamp(wanted, Math.min(smallest, largest), largest)
  const height = width / aspect
  return {
    x: west ? right - width : east ? left : centreX - width / 2,
    y: north ? bottom - height : south ? top : centreY - height / 2,
    width,
    height,
  }
}

/** The smallest a selection gets on screen, in px. */
const MIN_SELECTION = 48

/**
 * How small a selection may get while it is resized: the deepest zoom, and
 * never under `MIN_SELECTION` px on screen at `scale`. Without an aspect,
 * the deepest zoom keeps the shape of `start`.
 */
function resizeLimits(
  start: Size,
  shown: Size,
  scale: number,
  aspect: number | undefined,
  maxZoom: number,
): ResizeLimits {
  const onScreen = MIN_SELECTION / scale
  const deepest = fitRect(imageRect(shown), aspect ?? start.width / start.height)
  return {
    aspect,
    minWidth: Math.max(onScreen, deepest.width / maxZoom),
    minHeight: Math.max(onScreen, deepest.height / maxZoom),
  }
}

/** The smallest crop of `rect`'s shape that meets both limits. */
function smallestCrop(rect: Size, { minWidth, minHeight }: ResizeLimits): Size {
  const width = Math.max(minWidth, (minHeight * rect.width) / rect.height)
  return { width, height: (width * rect.height) / rect.width }
}

/**
 * A new selection drawn from `anchor` to `point`, inside `bounds`, keeping
 * `aspect` when given.
 */
function drawRect(anchor: Point, point: Point, bounds: Rect, aspect?: number): Rect {
  const dx = point.x - anchor.x
  const dy = point.y - anchor.y
  const handle = `${dy < 0 ? 'n' : 's'}${dx < 0 ? 'w' : 'e'}` as CropHandle
  return resizeRect({ ...anchor, width: 0, height: 0 }, handle, dx, dy, bounds, {
    aspect,
    minWidth: 0,
    minHeight: 0,
  })
}

/**
 * The same part of the image after it turns a quarter: clockwise for 1,
 * anticlockwise for -1. `natural` is the image's size before any turn.
 */
function rotateCrop(crop: Crop, natural: Size, turn: 1 | -1): Crop {
  const shown = rotatedSize(natural, crop.rotation)
  const rotation = (((crop.rotation + turn * 90) % 360) + 360) % 360
  return turn === 1
    ? {
        x: shown.height - crop.y - crop.height,
        y: crop.x,
        width: crop.height,
        height: crop.width,
        rotation: rotation as CropRotation,
      }
    : {
        x: crop.y,
        y: shown.width - crop.x - crop.width,
        width: crop.height,
        height: crop.width,
        rotation: rotation as CropRotation,
      }
}

/**
 * The crop while two fingers pinch: the image point that was under their
 * middle stays under it as it moves, and the image scales by `spread`
 * (their distance now over at the start) under a crop that stays at
 * `selection` on screen, as far as the zoom limits and the image's edges
 * allow.
 */
function pinchCrop(
  start: Rect,
  shown: Size,
  selection: Rect,
  held: Point,
  middle: Point,
  spread: number,
  maxZoom: number,
): Rect {
  const largest = fitRect(imageRect(shown), start.width / start.height)
  const width = clamp(start.width / spread, largest.width / maxZoom, largest.width)
  const height = (width * start.height) / start.width
  const scale = selection.width / width
  return {
    x: clamp(held.x - (middle.x - selection.x) / scale, 0, shown.width - width),
    y: clamp(held.y - (middle.y - selection.y) / scale, 0, shown.height - height),
    width,
    height,
  }
}

/** How the image is placed to show `view` in `frame`: how much it is scaled, and where its top left corner lands. */
function viewTransform(view: Rect, frame: Rect) {
  const scale = frame.width / view.width
  return { scale, x: frame.x - view.x * scale, y: frame.y - view.y * scale }
}

type ViewTransform = ReturnType<typeof viewTransform>

/** `rect`, in the image's pixels, where it is on screen. */
function toStage(rect: Rect, transform: ViewTransform): Rect {
  return {
    x: transform.x + rect.x * transform.scale,
    y: transform.y + rect.y * transform.scale,
    width: rect.width * transform.scale,
    height: rect.height * transform.scale,
  }
}

/** A point on screen, in the image's pixels. */
function toImage(point: Point, transform: ViewTransform): Point {
  return {
    x: (point.x - transform.x) / transform.scale,
    y: (point.y - transform.y) / transform.scale,
  }
}

/**
 * What a press at `point` takes hold of: a corner, a side, the inside of
 * `selection`, or nothing. A handle reaches `reach` pixels each way, less
 * inwards on a small selection, so its inside can still be dragged.
 */
function handleAt(
  point: Point,
  selection: Rect,
  reach: number,
): CropHandle | 'inside' | null {
  const inward = Math.min(reach, Math.min(selection.width, selection.height) / 4)
  const near = (value: number, edge: number, outwards: 1 | -1) => {
    const offset = (value - edge) * outwards
    return offset <= reach && offset >= -inward
  }
  const right = selection.x + selection.width
  const bottom = selection.y + selection.height
  const withinX = point.x >= selection.x - reach && point.x <= right + reach
  const withinY = point.y >= selection.y - reach && point.y <= bottom + reach
  if (!withinX || !withinY) return null
  const north = near(point.y, selection.y, -1)
  const south = !north && near(point.y, bottom, 1)
  const west = near(point.x, selection.x, -1)
  const east = !west && near(point.x, right, 1)
  const vertical = north ? 'n' : south ? 's' : ''
  const horizontal = west ? 'w' : east ? 'e' : ''
  if (vertical || horizontal) return `${vertical}${horizontal}` as CropHandle
  const inside =
    point.x >= selection.x &&
    point.x <= right &&
    point.y >= selection.y &&
    point.y <= bottom
  return inside ? 'inside' : null
}

/** The crop in whole pixels, inside the image, so the output's edge never shows a sliver of what is beside it. */
function pixelCrop(crop: Crop, natural: Size): Crop {
  const shown = rotatedSize(natural, crop.rotation)
  const x0 = clamp(Math.round(crop.x), 0, shown.width - 1)
  const y0 = clamp(Math.round(crop.y), 0, shown.height - 1)
  const x1 = clamp(Math.round(crop.x + crop.width), x0 + 1, shown.width)
  const y1 = clamp(Math.round(crop.y + crop.height), y0 + 1, shown.height)
  return {
    x: x0,
    y: y0,
    width: x1 - x0,
    height: y1 - y0,
    rotation: crop.rotation,
  }
}

/**
 * The size the cropped image is drawn at: its own pixels, never more,
 * within `maxWidth` and `maxHeight`, and under the largest canvas iOS draws.
 */
function outputSize(
  crop: Size,
  {
    maxWidth = Infinity,
    maxHeight = Infinity,
  }: { maxWidth?: number; maxHeight?: number },
  maxArea = 16_777_216,
): Size {
  let ratio = Math.min(1, maxWidth / crop.width, maxHeight / crop.height)
  const area = crop.width * crop.height * ratio * ratio
  if (area > maxArea) ratio *= Math.sqrt(maxArea / area)
  return {
    // Rounded, since a ratio such as 512 / 833 can land a hair under the whole pixel it means.
    width: clamp(
      Math.round(crop.width * ratio),
      1,
      Math.floor(Math.min(maxWidth, crop.width)),
    ),
    height: clamp(
      Math.round(crop.height * ratio),
      1,
      Math.floor(Math.min(maxHeight, crop.height)),
    ),
  }
}

/** The crop in words, for a screen reader. */
function describeCrop(crop: Crop) {
  const round = (value: number) => Math.round(value)
  return `Crop ${round(crop.width)} by ${round(crop.height)} pixels, ${round(crop.x)} from the left and ${round(crop.y)} from the top`
}

// ---------------------------------------------------------------------------
// The root

type CropShape = 'rectangle' | 'circle'

type LoadStatus = 'loading' | 'loaded' | 'error'

/**
 * The crop as it is this moment. A pointer, a wheel or the zoom thumb
 * changes it on every frame, and the parts that draw it read it from here
 * and write their styles themselves, so nothing re-renders while it moves.
 */
interface CropStore {
  getCrop: () => Crop | null
  setCrop: (crop: Crop | null) => void
  /** Something follows the pointer, the wheel or the zoom thumb: the area moves at once. */
  isFollowing: () => boolean
  setFollowing: (following: boolean) => void
  /** Ends a follow that is waiting to rest, such as the wheel's, so a key or a button that comes next glides. */
  settle: () => void
  /** What `settle` does; the area sets it. */
  onSettle: (settle: () => void) => () => void
  subscribe: (listener: () => void) => () => void
}

function createCropStore(initial: Crop | null): CropStore {
  let crop = initial
  let following = false
  let settle = () => {}
  const listeners = new Set<() => void>()
  const notify = () => {
    for (const listener of listeners) listener()
  }
  return {
    getCrop: () => crop,
    setCrop(next) {
      if (next === crop) return
      crop = next
      notify()
    },
    isFollowing: () => following,
    setFollowing(next) {
      if (next === following) return
      following = next
      notify()
    },
    settle: () => settle(),
    onSettle(next) {
      settle = next
      return () => {
        if (settle === next) settle = () => {}
      }
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

interface ImageCropperContextValue {
  src: string
  alt: string
  crossOrigin: ComponentProps<'img'>['crossOrigin']
  status: LoadStatus
  /** The image's own size, before any turn; null until it has loaded. */
  natural: Size | null
  /** The crop as last rendered; `store` has it as it is this moment. */
  crop: Crop | null
  store: CropStore
  /** Width over height; free when left out. A circle is always 1. */
  aspect: number | undefined
  shape: CropShape
  maxZoom: number
  disabled: boolean
  change: (crop: Crop, reason: CropChangeReason) => void
  commit: () => void
  rotate: (turn: 1 | -1) => void
  announce: (text: string) => void
}

const ImageCropperContext = createContext<ImageCropperContextValue | null>(null)

function useImageCropper() {
  const context = use(ImageCropperContext)
  if (!context) throw new Error('Image cropper parts go inside an ImageCropper.')
  return context
}

/** The crop that fills as much of the image as `aspect` allows. */
function initialCrop(natural: Size, aspect: number | undefined): Crop {
  return { ...fitRect(imageRect(natural), aspect), rotation: 0 }
}

/** Loads `src`, and says how big it is once it has. */
function useNaturalSize(src: string, crossOrigin: ComponentProps<'img'>['crossOrigin']) {
  const [loaded, setLoaded] = useState<{
    src: string
    natural: Size | null
    status: LoadStatus
  }>({ src, natural: null, status: 'loading' })
  useEffect(() => {
    let current = true
    const image = new Image()
    if (crossOrigin !== undefined) image.crossOrigin = crossOrigin
    image.src = src
    image
      .decode()
      .then(() => {
        if (!current) return
        setLoaded({
          src,
          natural: { width: image.naturalWidth, height: image.naturalHeight },
          status: 'loaded',
        })
      })
      .catch(() => {
        if (current) setLoaded({ src, natural: null, status: 'error' })
      })
    return () => {
      current = false
    }
  }, [src, crossOrigin])
  // A new image is loading until its own size arrives.
  return loaded.src === src ? loaded : { src, natural: null, status: 'loading' as const }
}

type ImageCropperProps = Omit<ComponentProps<'div'>, 'defaultValue' | 'onChange'> & {
  /** The image to crop: a URL, or an object URL for a file a person picked. */
  src: string
  /** What the image shows, for a screen reader. */
  alt: string
  crossOrigin?: ComponentProps<'img'>['crossOrigin']
  /** The crop, when you hold it. `null` until there is one: the cropper then starts from the largest it can and reports it with the reason `load`. */
  value?: Crop | null
  defaultValue?: Crop
  /** Called as the crop changes, on every frame of a drag. */
  onValueChange?: (value: Crop, details: CropChangeDetails) => void
  /** Called once a change is done: on letting go, after a key, and once a wheel stops. Save the crop here. */
  onValueCommitted?: (value: Crop) => void
  /** Width over height, such as `1` or `16 / 9`; free when left out. */
  aspectRatio?: number
  /** `circle` keeps a round crop, always as wide as it is high. */
  shape?: CropShape
  /** How far it zooms in: 3 shows a third of the width of the largest crop. */
  maxZoom?: number
  disabled?: boolean
}

/** Holds the image and its crop. */
function ImageCropper({
  src,
  alt,
  crossOrigin,
  value: cropProp,
  defaultValue: defaultCrop,
  onValueChange: onCropChange,
  onValueCommitted: onCropCommit,
  aspectRatio,
  shape = 'rectangle',
  maxZoom = 3,
  disabled = false,
  className,
  children,
  ...props
}: ImageCropperProps) {
  const { natural, status } = useNaturalSize(src, crossOrigin)
  const aspect = shape === 'circle' ? 1 : aspectRatio
  const [own, setOwn] = useState<{ src: string; crop: Crop | null }>({
    src,
    crop: defaultCrop ?? null,
  })
  const ownCrop = own.src === src ? own.crop : null
  const held = cropProp !== undefined
  const fallback = useMemo(
    () => (natural ? initialCrop(natural, aspect) : null),
    [natural, aspect],
  )
  const crop = (held ? cropProp : ownCrop) ?? fallback
  const [store] = useState(() => createCropStore(crop))
  // Once nothing follows, the rendered crop is the live one: a new value, a
  // commit, or a value the page kept when it turned a change down.
  const [, rerender] = useReducer((count: number) => count + 1, 0)
  useLayoutEffect(() => {
    if (!store.isFollowing() && store.getCrop() !== crop) store.setCrop(crop)
  })
  const { announce, region } = useAnnouncer()
  const announceRef = useRef(announce)
  useEffect(() => {
    announceRef.current = announce
  })
  useEffect(() => {
    if (status === 'error') announceRef.current('The image couldn’t be loaded.')
  }, [status])

  const latest = useRef({ onCropChange, onCropCommit })
  useEffect(() => {
    latest.current = { onCropChange, onCropCommit }
  })

  // While something follows the pointer, only the store changes; the crop
  // is rendered again once the change is done.
  const change = (next: Crop, reason: CropChangeReason) => {
    store.setCrop(next)
    latest.current.onCropChange?.(next, { reason })
    if (store.isFollowing()) return
    if (held) rerender()
    else setOwn({ src, crop: next })
  }
  const commit = () => {
    const current = store.getCrop()
    if (!current) return
    if (held) rerender()
    else setOwn({ src, crop: current })
    latest.current.onCropCommit?.(current)
  }

  // A crop the cropper chose is reported, so a form can save it untouched:
  // once the image loads, and again when a new aspect reshapes it.
  const chosen = natural !== null && (held ? cropProp === null : ownCrop === null)
  const reportedFor = useRef<Size | null>(null)
  useEffect(() => {
    if (!chosen || !fallback) return
    const reason = reportedFor.current === natural ? 'aspect' : 'load'
    reportedFor.current = natural
    latest.current.onCropChange?.(fallback, { reason })
    latest.current.onCropCommit?.(fallback)
  }, [chosen, fallback, natural])

  // A new aspect reshapes the crop about its centre, at the same zoom.
  const [shownAspect, setShownAspect] = useState(aspect)
  const [reshaped, setReshaped] = useState<Crop | null>(null)
  if (shownAspect !== aspect) {
    setShownAspect(aspect)
    if (natural && crop && aspect !== undefined) {
      if (Math.abs(crop.width / crop.height - aspect) >= 1e-3) {
        const shown = rotatedSize(natural, crop.rotation)
        const next = { ...reshapeRect(crop, shown, aspect), rotation: crop.rotation }
        if (!held) setOwn({ src, crop: next })
        setReshaped(next)
      }
    }
  }
  useEffect(() => {
    if (!reshaped) return
    // Reported only: the crop on screen is the one rendered, so a page that
    // holds the crop and turns the change down keeps its own.
    latest.current.onCropChange?.(reshaped, { reason: 'aspect' })
    latest.current.onCropCommit?.(reshaped)
  }, [reshaped])

  const rotate = (turn: 1 | -1) => {
    store.settle()
    const current = store.getCrop()
    if (!natural || !current || disabled) return
    const turned = rotateCrop(current, natural, turn)
    const shown = rotatedSize(natural, turned.rotation)
    change({ ...reshapeRect(turned, shown, aspect), rotation: turned.rotation }, 'rotate')
    commit()
    announce(`Rotated to ${turned.rotation} degrees`)
  }

  return (
    <ImageCropperContext
      value={{
        src,
        alt,
        crossOrigin,
        status,
        natural,
        crop,
        store,
        aspect,
        shape,
        maxZoom,
        disabled,
        change,
        commit,
        rotate,
        announce,
      }}
    >
      <div
        data-slot='image-cropper'
        data-disabled={disabled || undefined}
        className={cn('flex w-full min-w-0 flex-col gap-3', className)}
        {...props}
      >
        {children}
      </div>
      {region}
    </ImageCropperContext>
  )
}

// ---------------------------------------------------------------------------
// The area

type CropMode = 'frame' | 'box' | 'settle'

/** How far the frame sits inside the area, in px, so the image around it shows and the handles have room. */
const AREA_INSET: Record<CropMode, number> = { frame: 24, box: 16, settle: 24 }

/** How far around a side or corner a handle can be grabbed, in px: 24 by mouse, the quality bar's smallest target, and 40 by touch. */
const HANDLE_REACH = { fine: 24, coarse: 40 }

/** How far an arrow key moves, in px on screen, and with Shift. */
const KEY_STEP = { small: 8, large: 48 }

/** How much plus and minus zoom by. */
const KEY_ZOOM = 1.2

/** How long a wheel rests before its zoom is done, in ms. */
const WHEEL_REST_MS = 160

const INSTRUCTIONS: Record<CropMode, string> = {
  frame:
    'Drag or use the arrow keys to move the image, pinch or press plus and minus to zoom, and press R to rotate, or Shift and R to rotate back.',
  box: 'Drag or use the arrow keys to move the selection, drag its edges, hold Alt with the arrow keys or press plus and minus to resize it, and press R to rotate, or Shift and R to rotate back.',
  settle:
    'Drag or use the arrow keys to move the image, drag the edges of the crop or hold Alt with the arrow keys to resize it, pinch or press plus and minus to zoom, and press R to rotate, or Shift and R to rotate back.',
}

type Gesture =
  | {
      kind: 'pan'
      start: Crop
      from: Point
      transform: ViewTransform
      /** Settle's view, held where a glide was when the image was caught. */
      held: ViewTransform | null
    }
  | { kind: 'move'; start: Crop; from: Point; transform: ViewTransform }
  | {
      kind: 'resize'
      handle: CropHandle
      start: Crop
      from: Point
      transform: ViewTransform
    }
  | { kind: 'draw'; start: Crop; anchor: Point; transform: ViewTransform }
  | {
      kind: 'pinch'
      start: Crop
      distance: number
      middle: Point
      transform: ViewTransform
      /** Where the crop is on screen as the fingers land: it stays there while the image moves under it. */
      selection: Rect
      /** Settle's view is held: the fingers move it, not the crop. */
      held: boolean
    }

const CURSORS: Record<CropHandle | 'inside', string> = {
  n: 'cursor-ns-resize',
  s: 'cursor-ns-resize',
  e: 'cursor-ew-resize',
  w: 'cursor-ew-resize',
  ne: 'cursor-nesw-resize',
  sw: 'cursor-nesw-resize',
  nw: 'cursor-nwse-resize',
  se: 'cursor-nwse-resize',
  inside: 'cursor-move',
}

/** The angle the image is drawn at: the crop's rotation, reached by the shorter way round from the last one, so a turn past 270 keeps going. */
function nextAngle(angle: number, rotation: CropRotation) {
  const delta = ((((rotation - angle) % 360) + 540) % 360) - 180
  return angle + delta
}

function round(value: number) {
  return Math.round(value * 100) / 100
}

/**
 * How the image is drawn: the `<img>` at its own size, moved so the crop's
 * centre sits on a frame's top left corner, and the frame moved to where
 * that centre shows, then turned `angle` degrees and scaled about it. A turn
 * keeps the same point of the image in the crop's centre, so the image
 * turns about it and what the crop holds stays in it as it turns.
 */
function imagePlacement(
  natural: Size,
  angle: number,
  transform: ViewTransform,
  crop: Crop,
) {
  const { translate, scale, pivot } = imagePose(natural, angle, transform, crop)
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
    },
  }
}

/** Where a turn starts or ends: the frame's `translate`, `rotate` (degrees) and `scale`, the crop's centre in the image's own pixels, and the crop on screen. */
interface TurnPose {
  translate: readonly [number, number]
  rotate: number
  scale: number
  pivot: readonly [number, number]
  hole: Rect
}

/** `imagePlacement` as numbers, without the crop on screen. */
function imagePose(
  natural: Size,
  angle: number,
  transform: ViewTransform,
  crop: Crop,
): Omit<TurnPose, 'hole'> {
  const centre = { x: crop.x + crop.width / 2, y: crop.y + crop.height / 2 }
  const pivot = toNatural(centre, natural, crop.rotation)
  return {
    translate: [
      transform.x + centre.x * transform.scale,
      transform.y + centre.y * transform.scale,
    ],
    rotate: angle,
    scale: transform.scale,
    pivot: [pivot.x, pivot.y],
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

/** The pose on screen now, mid-glide or at rest, from a frame, its `<img>` and the hole's clip in a box of `box`. */
function poseOnScreen(
  frame: HTMLElement,
  image: HTMLElement,
  hole: HTMLElement | null,
  box: Size,
): TurnPose | null {
  const style = getComputedStyle(frame)
  const opening = hole ? holeOf(getComputedStyle(hole).clipPath, box) : imageRect(box)
  if (!opening) return null
  const pivot = translateOf(getComputedStyle(image).translate)
  return {
    translate: translateOf(style.translate),
    rotate: Number.parseFloat(style.rotate) || 0,
    scale: Number.parseFloat(style.scale) || 1,
    pivot: [-pivot[0], -pivot[1]],
    hole: opening,
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

/**
 * The crop and view that a placement on screen shows, the other way round
 * from `imagePlacement` and `insetClip`: from the frame's `translate` and
 * `scale`, the `<img>`'s `translate` (minus the crop's centre in the image's
 * own pixels) and the hole's insets in a box of `stage`.
 */
function placementToCrop(
  placement: {
    translate: readonly [number, number]
    scale: number
    pivot: readonly [number, number]
    insets: readonly [number, number, number, number]
  },
  stage: Size,
  natural: Size,
  rotation: CropRotation,
) {
  const { translate, scale, pivot, insets } = placement
  const centre = toShown({ x: -pivot[0], y: -pivot[1] }, natural, rotation)
  const transform = {
    scale,
    x: translate[0] - centre.x * scale,
    y: translate[1] - centre.y * scale,
  }
  const [top, right, bottom, left] = insets
  const topLeft = toImage({ x: left, y: top }, transform)
  const crop: Crop = {
    x: topLeft.x,
    y: topLeft.y,
    width: (stage.width - left - right) / scale,
    height: (stage.height - top - bottom) / scale,
    rotation,
  }
  return { crop, transform }
}

/** Puts a frame and its `<img>` where `imagePlacement` says. */
function placeImage(
  frame: HTMLElement | null,
  image: HTMLImageElement | null,
  placement: ReturnType<typeof imagePlacement>,
) {
  if (frame) Object.assign(frame.style, placement.frame)
  if (image) Object.assign(image.style, placement.image)
}

/** A clip to `rect` inside a box of `size`, `grow` px larger on every side, and round for a circle. */
function insetClip(rect: Rect, size: Size, circle: boolean, grow = 0) {
  const top = round(rect.y - grow)
  const right = round(size.width - rect.x - rect.width - grow)
  const bottom = round(size.height - rect.y - rect.height - grow)
  const left = round(rect.x - grow)
  return `inset(${top}px ${right}px ${bottom}px ${left}px${circle ? ` round ${round(rect.width / 2 + grow)}px` : ''})`
}

/** The properties a glide moves. */
const MOVED = new Set(['translate', 'scale', 'rotate', 'clip-path'])

// Layers that glide on `layout`, and follow at once while dragged or while the area resizes.
const glideClassName =
  'transition-[translate,scale,rotate,clip-path] duration-(--motion-layout-duration) ease-(--motion-layout-easing) group-data-following/cropper:duration-0 group-data-resizing/cropper:transition-none motion-reduce:transition-none'

/** Where each handle sits on the selection, as fractions of its width and height. */
const HANDLE_SPOTS = {
  circle: [
    [0.5, 0],
    [1, 0.5],
    [0.5, 1],
    [0, 0.5],
  ],
  corners: [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ],
} as const

/** The corner marks, in the order of `HANDLE_SPOTS.corners`: each one's arms and the offset that puts its outer edge on the crop's. */
const CORNER_CLASSNAMES = [
  '-mt-[3px] -ml-[3px] border-t-[3px] border-l-[3px]',
  '-mt-[3px] -ml-[17px] border-t-[3px] border-r-[3px]',
  '-mt-[17px] -ml-[17px] border-r-[3px] border-b-[3px]',
  '-mt-[17px] -ml-[3px] border-b-[3px] border-l-[3px]',
]

function ImageCropperArea({
  mode = 'frame',
  className,
  ref,
  'aria-label': ariaLabel = 'Crop area',
  ...props
}: Omit<ComponentProps<'div'>, 'children'> & {
  /**
   * What a person moves: `frame` pans and zooms the image under a still
   * frame, `box` moves and resizes a selection over a still image, and
   * `settle` resizes the selection, then glides it back to fill the area as
   * the image zooms to match.
   */
  mode?: CropMode
}) {
  const {
    src,
    alt,
    crossOrigin,
    status,
    natural,
    crop,
    store,
    aspect,
    shape,
    maxZoom,
    disabled,
    change,
    commit,
    rotate,
    announce,
  } = useImageCropper()
  const instructionsId = useId()
  const stageRef = useRef<HTMLDivElement>(null)
  // Placed in pixels worked out from its size, so while it resizes nothing glides.
  const stageRefs = useMemo(() => mergeRefs(stageRef, markResizing, ref), [ref])
  const frameRefs = useRef<(HTMLDivElement | null)[]>([])
  const imageRefs = useRef<(HTMLImageElement | null)[]>([])
  const holeRef = useRef<HTMLDivElement>(null)
  const ringRef = useRef<HTMLDivElement>(null)
  const thirdsRef = useRef<HTMLDivElement>(null)
  const lineRefs = useRef<(HTMLSpanElement | null)[]>([])
  const handleRefs = useRef<(HTMLSpanElement | null)[]>([])
  const [stage, setStage] = useState<Size | null>(null)
  // While a side or corner of the settle mode's selection is dragged, the
  // image stays where it was; it glides to frame the new crop on letting go.
  const held = useRef<ViewTransform | null>(null)
  const [hover, setHover] = useState<CropHandle | 'inside' | null>(null)
  const [interacting, setInteracting] = useState(false)
  /** The angle last drawn, so a turn goes the shorter way round from it. */
  const paintedAngle = useRef<number | null>(null)
  const covers = useRef<Animation[]>([])
  const spinning = useSpinner(status === 'loading')

  const gesture = useRef<Gesture | null>(null)
  const pointers = useRef(new Map<number, Point>())
  const keyed = useRef(false)
  /** The crop to go back to when a gesture is cancelled. */
  const undo = useRef<Crop | null>(null)
  /** The wheel's follow ends once it has rested this long. */
  const wheelRest = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => {
    const element = stageRef.current
    if (!element) return
    // Applied at once, while `markResizing` still holds the glides back.
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      flushSync(() => setStage({ width, height }))
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const ready = natural && crop && stage && stage.width > 0 && stage.height > 0
  const inset = AREA_INSET[mode]
  const room: Rect | null = stage
    ? {
        x: inset,
        y: inset,
        width: Math.max(1, stage.width - inset * 2),
        height: Math.max(1, stage.height - inset * 2),
      }
    : null

  /** Where `current` is on screen, and how the image is drawn for it. */
  const geometry = (current: Crop | null) => {
    if (!natural || !current || !room) return null
    const shown = rotatedSize(natural, current.rotation)
    const view = mode === 'box' ? imageRect(shown) : current
    const transform =
      held.current ?? viewTransform(view, fitRect(room, view.width / view.height))
    return { shown, transform, selection: toStage(current, transform) }
  }

  /**
   * Where a glide still under way has got to: the crop and view that match
   * what is on screen, so a gesture that catches it carries on from there.
   * Null when nothing glides, or while the image turns, which finishes first.
   */
  const whereGlideIs = (current: Crop) => {
    const element = stageRef.current
    const frame = frameRefs.current[1]
    const image = imageRefs.current[1]
    const hole = holeRef.current
    if (!element || !frame || !image || !hole || !natural || !stage) return null
    const gliding = runningTransitions(element, { subtree: true }).filter(
      (transition) =>
        transition.playState === 'running' && MOVED.has(transition.transitionProperty),
    )
    if (gliding.length === 0) return null
    if (gliding.some((transition) => transition.transitionProperty === 'rotate'))
      return null
    const pose = poseOnScreen(frame, image, hole, stage)
    if (!pose) return null
    return placementToCrop(
      {
        translate: pose.translate,
        scale: pose.scale,
        pivot: [-pose.pivot[0], -pose.pivot[1]],
        insets: [
          pose.hole.y,
          stage.width - pose.hole.x - pose.hole.width,
          stage.height - pose.hole.y - pose.hole.height,
          pose.hole.x,
        ],
      },
      stage,
      natural,
      current.rotation,
    )
  }

  // Everything that moves with the crop is written here, from the store, so
  // a drag changes the styles without rendering.
  const paint = () => {
    const element = stageRef.current
    if (!element) return
    element.toggleAttribute('data-following', store.isFollowing())
    const current = store.getCrop()
    const placed = geometry(current)
    if (!placed || !stage || !natural || !current) return
    const { transform, selection } = placed
    const last = paintedAngle.current
    const angle = last === null ? current.rotation : nextAngle(last, current.rotation)
    paintedAngle.current = angle
    const frames = frameRefs.current.filter((frame) => frame !== null)
    // A turn, and any move while one plays, works its cover out again.
    const recover =
      (last !== null && angle !== last) ||
      (frames[0] !== undefined &&
        runningTransitions(frames[0], { property: 'rotate' }).length > 0)
    imageRefs.current.forEach((image, index) =>
      placeImage(
        frameRefs.current[index] ?? null,
        image,
        imagePlacement(natural, angle, transform, current),
      ),
    )
    const circle = shape === 'circle'
    // Each layer takes its own clip, so a move restyles three elements, not the whole area.
    const hole = insetClip(selection, stage, circle)
    if (holeRef.current) holeRef.current.style.clipPath = hole
    // Once everything that turns has its transition.
    if (recover) {
      for (const cover of covers.current) cover.cancel()
      const made: Animation[] = coverTurn(
        frames,
        imageRefs.current[0] ?? null,
        holeRef.current,
        stage,
        { ...imagePose(natural, angle, transform, current), hole: selection },
        natural,
        circle,
        () => {
          if (covers.current === made) paint()
        },
      )
      covers.current = made
    }
    if (thirdsRef.current) thirdsRef.current.style.clipPath = hole
    if (ringRef.current)
      ringRef.current.style.clipPath = insetClip(selection, stage, circle, 1)
    lineRefs.current.forEach((line, index) => {
      if (!line) return
      const third = (index >> 1) + 1
      line.style.translate =
        index % 2 === 0
          ? `${round(selection.x + (selection.width * third) / 3)}px 0px`
          : `0px ${round(selection.y + (selection.height * third) / 3)}px`
    })
    const spots = HANDLE_SPOTS[circle ? 'circle' : 'corners']
    handleRefs.current.forEach((handle, index) => {
      const spot = spots[index]
      if (!handle || !spot) return
      handle.style.translate = `${round(selection.x + selection.width * spot[0])}px ${round(selection.y + selection.height * spot[1])}px`
    })
  }
  useLayoutEffect(() => {
    paint()
    return store.subscribe(paint)
  })

  /** The part of the image the area shows, in the image's pixels: a selection can't grow past it. */
  const visibleBounds = (shownSize: Size, at: ViewTransform): Rect => {
    if (!stage) return imageRect(shownSize)
    const topLeft = toImage({ x: 0, y: 0 }, at)
    const bottomRight = toImage({ x: stage.width, y: stage.height }, at)
    return intersectRect(imageRect(shownSize), {
      x: topLeft.x,
      y: topLeft.y,
      width: bottomRight.x - topLeft.x,
      height: bottomRight.y - topLeft.y,
    })
  }

  const limits = (start: Rect, shownSize: Size, at: ViewTransform) =>
    resizeLimits(start, shownSize, at.scale, aspect, maxZoom)

  const pointIn = (event: { clientX: number; clientY: number }): Point => {
    const box = stageRef.current!.getBoundingClientRect()
    return { x: event.clientX - box.left, y: event.clientY - box.top }
  }

  const reachFor = (event: PointerEvent) =>
    event.pointerType === 'mouse' ? HANDLE_REACH.fine / 2 : HANDLE_REACH.coarse / 2

  const startPinch = () => {
    const current = store.getCrop()
    const placed = geometry(current)
    if (!current || !placed) return
    const [a, b] = [...pointers.current.values()]
    // It starts from what is on screen; a held view stays held, and glides to frame the crop on letting go.
    gesture.current = {
      kind: 'pinch',
      start: current,
      distance: Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)),
      middle: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      transform: placed.transform,
      selection: placed.selection,
      held: held.current !== null,
    }
  }

  const finish = (cancelled: boolean) => {
    const current = gesture.current
    gesture.current = null
    pointers.current.clear()
    held.current = null
    setInteracting(false)
    // Letting go glides: the store stops following before anything moves.
    store.setFollowing(false)
    if (!current) return
    const before = undo.current ?? current.start
    undo.current = null
    if (cancelled) {
      change(before, 'cancel')
      return
    }
    // A selection drawn smaller than one can be resized to is a click: the last one stays.
    const drawn = store.getCrop()
    const smallest =
      current.kind === 'draw' && natural
        ? limits(
            current.start,
            rotatedSize(natural, current.start.rotation),
            current.transform,
          )
        : null
    if (
      smallest &&
      drawn &&
      (drawn.width < smallest.minWidth - 0.5 || drawn.height < smallest.minHeight - 0.5)
    ) {
      change(before, 'cancel')
      return
    }
    commit()
  }

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    props.onPointerDown?.(event)
    if (event.defaultPrevented || disabled || !ready || !geometry(store.getCrop())) return
    if (event.pointerType === 'mouse' && event.button !== 0) return
    // A press carries on a wheel's follow, and commits when it lets go.
    clearTimeout(wheelRest.current)
    // A gesture that catches a glide starts from where it is on screen; cancelling it goes back to where the glide was heading.
    if (pointers.current.size === 0) undo.current = store.getCrop()
    const caught = pointers.current.size === 0 ? whereGlideIs(store.getCrop()!) : null
    if (caught) {
      store.setFollowing(true)
      if (mode === 'settle') held.current = caught.transform
      change(caught.crop, 'drag')
    }
    const current = store.getCrop()
    const placed = geometry(current)
    if (!current || !placed) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    event.currentTarget.focus({
      preventScroll: true,
      focusVisible: false,
    } as FocusOptions)
    const point = pointIn(event)
    pointers.current.set(event.pointerId, point)
    if (pointers.current.size === 2) {
      if (mode !== 'box') startPinch()
      return
    }
    if (pointers.current.size > 2) return
    const { transform, selection, shown } = placed
    const hit = handleAt(point, selection, reachFor(event))
    setInteracting(true)
    store.setFollowing(true)
    if (mode === 'frame' || (mode === 'settle' && (hit === null || hit === 'inside'))) {
      gesture.current = {
        kind: 'pan',
        start: current,
        from: point,
        transform,
        held: held.current,
      }
      return
    }
    if (hit && hit !== 'inside') {
      if (mode === 'settle') held.current = transform
      gesture.current = {
        kind: 'resize',
        handle: hit,
        start: current,
        from: point,
        transform,
      }
      return
    }
    if (hit === 'inside') {
      gesture.current = {
        kind: 'move',
        start: current,
        from: point,
        transform,
      }
      return
    }
    const anchor = toImage(point, transform)
    gesture.current = {
      kind: 'draw',
      start: current,
      anchor: {
        x: clamp(anchor.x, 0, shown.width),
        y: clamp(anchor.y, 0, shown.height),
      },
      transform,
    }
  }

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    props.onPointerMove?.(event)
    const point = pointIn(event)
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) {
      const current = store.getCrop()
      const placed = mode !== 'frame' && !disabled ? geometry(current) : null
      if (current && placed) {
        // Mid-glide, the handles are where they show, not where they are heading.
        const caught = whereGlideIs(current)
        const selection = caught
          ? toStage(caught.crop, caught.transform)
          : placed.selection
        const hit = handleAt(point, selection, reachFor(event))
        const next = mode === 'settle' && hit === 'inside' ? null : hit
        if (next !== hover) setHover(next)
      }
      return
    }
    pointers.current.set(event.pointerId, point)
    const current = gesture.current
    if (!current || !natural) return
    const shownSize = rotatedSize(natural, current.start.rotation)
    const { rotation } = current.start
    const at = current.transform
    if (current.kind === 'pinch') {
      const [a, b] = [...pointers.current.values()]
      if (!a || !b) return
      const pinched = pinchCrop(
        current.start,
        shownSize,
        current.selection,
        toImage(current.middle, at),
        { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
        Math.hypot(b.x - a.x, b.y - a.y) / current.distance,
        maxZoom,
      )
      if (current.held) held.current = viewTransform(pinched, current.selection)
      change({ ...pinched, rotation }, 'pinch')
      return
    }
    if (current.kind === 'draw') {
      const bounds = visibleBounds(shownSize, at)
      const drawn = drawRect(current.anchor, toImage(point, at), bounds, aspect)
      change({ ...drawn, rotation }, 'draw')
      return
    }
    const dx = (point.x - current.from.x) / at.scale
    const dy = (point.y - current.from.y) / at.scale
    if (current.kind === 'pan') {
      const moved = moveRect(current.start, shownSize, -dx, -dy)
      // A held view moves with the image, so the selection stays where it was caught.
      if (current.held)
        held.current = {
          ...current.held,
          x: current.held.x + (current.start.x - moved.x) * at.scale,
          y: current.held.y + (current.start.y - moved.y) * at.scale,
        }
      change({ ...moved, rotation }, 'drag')
      return
    }
    if (current.kind === 'move') {
      change({ ...moveRect(current.start, shownSize, dx, dy), rotation }, 'drag')
      return
    }
    const resized = resizeRect(
      current.start,
      current.handle,
      dx,
      dy,
      visibleBounds(shownSize, at),
      limits(current.start, shownSize, at),
    )
    change({ ...resized, rotation }, 'resize')
  }

  const onPointerEnd = (event: PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(event.pointerId)
    const placed = geometry(store.getCrop())
    if (gesture.current?.kind === 'pinch' && pointers.current.size === 1 && placed) {
      // One finger left on the image carries on panning.
      const [rest] = [...pointers.current.values()]
      gesture.current = {
        kind: 'pan',
        start: store.getCrop()!,
        from: rest,
        transform: placed.transform,
        held: held.current,
      }
      return
    }
    if (pointers.current.size === 0) finish(false)
  }

  // A frame has no handles, so with no aspect it takes the image's own
  // shape, at the same zoom: a crop left in another shape couldn't change.
  const ownShape =
    mode === 'frame' && aspect === undefined && natural && crop
      ? rotatedSize(natural, crop.rotation)
      : null
  const reshaped =
    ownShape &&
    crop &&
    Math.abs(crop.width / crop.height - ownShape.width / ownShape.height) > 1e-3
      ? {
          ...reshapeRect(crop, ownShape, ownShape.width / ownShape.height),
          rotation: crop.rotation,
        }
      : null
  const reshape = useRef({ reshaped, change, commit })
  useEffect(() => {
    reshape.current = { reshaped, change, commit }
  })
  const needsReshape = reshaped !== null
  useEffect(() => {
    const next = reshape.current.reshaped
    if (!needsReshape || !next) return
    reshape.current.change(next, 'aspect')
    reshape.current.commit()
  }, [needsReshape])

  // The wheel zooms about the pointer once the area has focus, or with
  // Control or Command held (a trackpad's pinch), so it never takes over the
  // page's scrolling.
  const wheel = useRef({
    geometry,
    whereGlideIs,
    natural,
    maxZoom,
    mode,
    disabled,
    change,
    commit,
  })
  useEffect(() => {
    wheel.current = {
      geometry,
      whereGlideIs,
      natural,
      maxZoom,
      mode,
      disabled,
      change,
      commit,
    }
  })
  useEffect(() => {
    const element = stageRef.current
    if (!element) return
    // The wheel's zoom is done: a held view glides to frame the crop, and the crop is committed.
    const rest = () => {
      clearTimeout(wheelRest.current)
      wheelRest.current = undefined
      held.current = null
      store.setFollowing(false)
      wheel.current.commit()
    }
    const stopSettle = store.onSettle(() => {
      if (wheelRest.current !== undefined) rest()
    })
    const onWheel = (event: WheelEvent) => {
      const current = wheel.current
      if (current.mode === 'box' || current.disabled) return
      if (!event.ctrlKey && !event.metaKey && document.activeElement !== element) return
      // The first turn of the wheel catches a glide where it is, as a pointer does.
      const caught =
        !store.isFollowing() && store.getCrop()
          ? current.whereGlideIs(store.getCrop()!)
          : null
      if (caught) {
        store.setFollowing(true)
        // Settle holds the view where it was caught, as a pointer does.
        if (current.mode === 'settle') held.current = caught.transform
        current.change(caught.crop, 'wheel')
      }
      const now = store.getCrop()
      const placed = current.geometry(now)
      if (!now || !placed || !current.natural) return
      event.preventDefault()
      const lines = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 400 : 1
      const speed = event.ctrlKey ? 0.01 : 0.002
      const box = element.getBoundingClientRect()
      const anchor = toImage(
        { x: event.clientX - box.left, y: event.clientY - box.top },
        placed.transform,
      )
      const zoom = cropZoom(now, placed.shown) * Math.exp(-event.deltaY * lines * speed)
      const next = zoomRect(now, placed.shown, zoom, current.maxZoom, anchor)
      store.setFollowing(true)
      current.change({ ...next, rotation: now.rotation }, 'wheel')
      // Turned during a drag, the drag's let-go ends the follow instead.
      clearTimeout(wheelRest.current)
      wheelRest.current = gesture.current ? undefined : setTimeout(rest, WHEEL_REST_MS)
    }
    element.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      element.removeEventListener('wheel', onWheel)
      stopSettle()
      clearTimeout(wheelRest.current)
    }
  }, [store])

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    props.onKeyDown?.(event)
    const current = store.getCrop()
    const placed = geometry(current)
    if (event.defaultPrevented || disabled || !current || !placed) return
    if (event.key === 'Escape' && gesture.current) {
      event.preventDefault()
      event.stopPropagation()
      finish(true)
      return
    }
    // A drag owns the crop until it lets go.
    if (gesture.current) return
    if (event.metaKey || event.ctrlKey) return
    // A key after the wheel glides, from where the wheel left it.
    store.settle()
    const { shown: shownSize, transform } = placed
    const { rotation } = current
    if (event.key === 'r' || event.key === 'R') {
      event.preventDefault()
      rotate(event.shiftKey ? -1 : 1)
      return
    }
    const zoomIn = event.key === '+' || event.key === '='
    const zoomOut = event.key === '-' || event.key === '_'
    if (zoomIn || zoomOut) {
      event.preventDefault()
      const factor = zoomIn ? KEY_ZOOM : 1 / KEY_ZOOM
      // A selection drawn over the image stops at its smallest on screen too.
      const deepest =
        mode === 'box'
          ? Math.min(
              maxZoom,
              cropZoom(
                smallestCrop(current, limits(current, shownSize, transform)),
                shownSize,
              ),
            )
          : maxZoom
      const zoom = cropZoom(current, shownSize) * factor
      change(
        {
          ...zoomRect(current, shownSize, zoom, Math.max(1, deepest)),
          rotation,
        },
        'keyboard',
      )
      keyed.current = true
      return
    }
    const arrows: Record<string, Point> = {
      ArrowLeft: { x: -1, y: 0 },
      ArrowRight: { x: 1, y: 0 },
      ArrowUp: { x: 0, y: -1 },
      ArrowDown: { x: 0, y: 1 },
    }
    const arrow = arrows[event.key]
    if (!arrow) return
    event.preventDefault()
    const step = (event.shiftKey ? KEY_STEP.large : KEY_STEP.small) / transform.scale
    if (mode !== 'frame' && event.altKey) {
      const handle: CropHandle = arrow.x !== 0 ? 'e' : 's'
      const resized = resizeRect(
        current,
        aspect ? 'se' : handle,
        arrow.x * step,
        arrow.y * step,
        imageRect(shownSize),
        limits(current, shownSize, transform),
      )
      change({ ...resized, rotation }, 'keyboard')
    } else {
      // The image moves the way the arrow points; in box mode, the selection does.
      const sign = mode === 'box' ? 1 : -1
      change(
        {
          ...moveRect(current, shownSize, sign * arrow.x * step, sign * arrow.y * step),
          rotation,
        },
        'keyboard',
      )
    }
    keyed.current = true
  }

  const onKeyUp = (event: KeyboardEvent<HTMLDivElement>) => {
    props.onKeyUp?.(event)
    if (!keyed.current) return
    keyed.current = false
    commit()
    const current = store.getCrop()
    if (current) announce(describeCrop(current))
  }

  const circle = shape === 'circle'
  const showHandles = mode !== 'frame'
  const cornerClassName =
    'pointer-events-none absolute top-0 left-0 size-5 border-white drop-shadow-[0_0_1px_rgb(0_0_0/0.6)] forced-colors:border-[CanvasText]'

  return (
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- an application takes its own keys, which jsx-a11y doesn't count as interactive
    <div
      ref={stageRefs}
      data-slot='image-cropper-area'
      data-mode={mode}
      data-interacting={interacting || undefined}
      data-disabled={disabled || undefined}
      // An application, so a screen reader in browse mode passes the arrow keys on.
      role='application'
      aria-roledescription='image cropper'
      aria-label={ariaLabel}
      aria-describedby={status === 'error' ? undefined : instructionsId}
      aria-busy={status === 'loading' || undefined}
      aria-disabled={disabled || undefined}
      tabIndex={disabled || status === 'error' ? -1 : 0}
      {...props}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(event) => {
        props.onPointerUp?.(event)
        onPointerEnd(event)
      }}
      onPointerCancel={(event) => {
        props.onPointerCancel?.(event)
        onPointerEnd(event)
      }}
      onLostPointerCapture={(event) => {
        props.onLostPointerCapture?.(event)
        if (pointers.current.has(event.pointerId)) onPointerEnd(event)
      }}
      onPointerLeave={(event) => {
        props.onPointerLeave?.(event)
        setHover(null)
      }}
      onKeyDown={onKeyDown}
      onKeyUp={onKeyUp}
      className={cn(
        'group/cropper bg-muted relative isolate h-80 w-full touch-none overflow-hidden rounded-(--surface-radius) select-none',
        'focus-visible:ring-ring/50 focus-visible:ring-3 focus-visible:outline-hidden',
        'data-disabled:pointer-events-none data-disabled:opacity-50',
        mode === 'frame' || (mode === 'settle' && hover === null)
          ? 'cursor-grab data-interacting:cursor-grabbing'
          : hover
            ? CURSORS[hover]
            : mode === 'box'
              ? 'cursor-crosshair'
              : '',
        className,
      )}
    >
      {status === 'error' ? null : (
        <p id={instructionsId} className='sr-only'>
          {INSTRUCTIONS[mode]}
        </p>
      )}
      {status === 'error' ? (
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
      ) : null}
      {status === 'loading' && spinning ? (
        <div className='text-muted-foreground absolute inset-0 flex items-center justify-center'>
          <Spinner aria-label='Loading image' />
        </div>
      ) : null}
      {ready ? (
        <>
          {/* The whole image, dimmed outside the crop. */}
          <div aria-hidden className='pointer-events-none absolute inset-0'>
            <div
              ref={(node) => {
                frameRefs.current[0] = node
              }}
              className={cn('absolute top-0 left-0 origin-top-left', glideClassName)}
            >
              {/* oxlint-disable-next-line nextjs/no-img-element -- a registry item can't use next/image */}
              <img
                ref={(node) => {
                  imageRefs.current[0] = node
                }}
                src={src}
                alt=''
                crossOrigin={crossOrigin}
                draggable={false}
                className={cn('absolute top-0 left-0 max-w-none', glideClassName)}
              />
            </div>
            <div className='absolute inset-0 bg-black/55 forced-color-adjust-none' />
          </div>
          {/* A hairline around the crop, one pixel outside it. */}
          <div
            ref={ringRef}
            aria-hidden
            className={cn(
              'pointer-events-none absolute inset-0 bg-white/80 forced-colors:bg-[CanvasText]',
              glideClassName,
            )}
          />
          {/* The crop at full brightness: the same image, clipped to it. */}
          <div
            ref={holeRef}
            className={cn('pointer-events-none absolute inset-0', glideClassName)}
          >
            <div
              ref={(node) => {
                frameRefs.current[1] = node
              }}
              className={cn('absolute top-0 left-0 origin-top-left', glideClassName)}
            >
              {/* oxlint-disable-next-line nextjs/no-img-element -- a registry item can't use next/image */}
              <img
                ref={(node) => {
                  imageRefs.current[1] = node
                }}
                src={src}
                alt={alt}
                crossOrigin={crossOrigin}
                draggable={false}
                className={cn('absolute top-0 left-0 max-w-none', glideClassName)}
              />
            </div>
          </div>
          {/* Thirds, while the crop is moved, resized or zoomed. */}
          <div
            ref={thirdsRef}
            aria-hidden
            className={cn(
              'pointer-events-none absolute inset-0 opacity-0 group-data-interacting/cropper:opacity-100',
              // It fades on `enter` and `exit`, and its edge keeps to the crop's on `layout`, or at once while followed.
              '[transition:opacity_var(--motion-exit-duration)_var(--motion-exit-easing),clip-path_var(--motion-layout-duration)_var(--motion-layout-easing)] group-data-following/cropper:[transition:opacity_var(--motion-enter-duration)_var(--motion-enter-easing)] group-data-interacting/cropper:[transition:opacity_var(--motion-enter-duration)_var(--motion-enter-easing),clip-path_var(--motion-layout-duration)_var(--motion-layout-easing)] group-data-interacting/cropper:group-data-following/cropper:[transition:opacity_var(--motion-enter-duration)_var(--motion-enter-easing)] group-data-resizing/cropper:transition-none motion-reduce:[transition-property:opacity]',
            )}
          >
            {[0, 1, 2, 3].map((index) => (
              <span
                key={index}
                ref={(node) => {
                  lineRefs.current[index] = node
                }}
                className={cn(
                  'absolute top-0 left-0 bg-white/60 forced-colors:bg-[CanvasText]',
                  index % 2 === 0 ? 'h-full w-px' : 'h-px w-full',
                  glideClassName,
                )}
              />
            ))}
          </div>
          {showHandles ? (
            <div aria-hidden className='pointer-events-none absolute inset-0'>
              {[0, 1, 2, 3].map((index) => (
                <span
                  key={`${shape}-${index}`}
                  ref={(node) => {
                    handleRefs.current[index] = node
                  }}
                  className={cn(
                    circle
                      ? 'absolute top-0 left-0 -mt-1.5 -ml-1.5 size-3 rounded-full bg-white shadow-[0_0_0_1px_rgb(0_0_0/0.25)] forced-colors:bg-[CanvasText]'
                      : cn(cornerClassName, CORNER_CLASSNAMES[index]),
                    glideClassName,
                  )}
                />
              ))}
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Controls

/** Zooms the crop in and out, on Kino's Slider, with a button at each end. */
function ImageCropperZoom({ className, ...props }: ComponentProps<'div'>) {
  const { natural, store, maxZoom, disabled, status, change, commit, announce } =
    useImageCropper()
  const zoomOf = () => {
    const crop = store.getCrop()
    return crop && natural ? cropZoom(crop, rotatedSize(natural, crop.rotation)) : 1
  }
  // Only the zoom renders as a drag goes, and only when it changes.
  const zoom = useSyncExternalStore(store.subscribe, zoomOf, () => 1)
  // While the area is followed, the thumb follows it at once too.
  const following = useSyncExternalStore(store.subscribe, store.isFollowing, () => false)
  const inactive = disabled || status !== 'loaded'
  const zoomTo = (value: number) => {
    const crop = store.getCrop()
    if (!crop || !natural) return
    const shown = rotatedSize(natural, crop.rotation)
    change({ ...zoomRect(crop, shown, value, maxZoom), rotation: crop.rotation }, 'zoom')
  }
  const step = (factor: number) => {
    store.settle()
    const crop = store.getCrop()
    if (!crop || !natural) return
    const shown = rotatedSize(natural, crop.rotation)
    const next = zoomRect(crop, shown, cropZoom(crop, shown) * factor, maxZoom)
    change({ ...next, rotation: crop.rotation }, 'zoom')
    commit()
    announce(`Zoom ${Math.round(cropZoom(next, shown) * 100)}%`)
  }
  return (
    <div
      data-slot='image-cropper-zoom'
      className={cn('flex min-w-0 items-center gap-4', className)}
      {...props}
    >
      <Button
        variant='ghost'
        size='icon-sm'
        aria-label='Zoom out'
        // It stays in the tab order at the end of its range, so focus isn't lost when it gets there.
        focusableWhenDisabled={!inactive}
        disabled={inactive || zoom <= 1.001}
        onClick={() => step(1 / KEY_ZOOM)}
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
      <Slider
        aria-label='Zoom'
        min={1}
        max={maxZoom}
        step={0.01}
        value={Math.min(zoom, maxZoom)}
        disabled={inactive}
        data-following={following || undefined}
        getAriaValueText={(_, value) => `${Math.round(value * 100)}%`}
        onValueChange={(value, details) => {
          if (details.reason !== 'drag') store.settle()
          store.setFollowing(details.reason === 'drag')
          zoomTo(value)
        }}
        onValueCommitted={() => {
          store.setFollowing(false)
          commit()
        }}
        className='flex-1'
      />
      <Button
        variant='ghost'
        size='icon-sm'
        aria-label='Zoom in'
        focusableWhenDisabled={!inactive}
        disabled={inactive || zoom >= maxZoom - 0.001}
        onClick={() => step(KEY_ZOOM)}
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

/** Turns the image a quarter clockwise, keeping the same part of it in the crop. */
function ImageCropperRotate({
  className,
  ...props
}: Omit<ComponentProps<typeof Button>, 'onClick' | 'children'>) {
  const { rotate, disabled, status } = useImageCropper()
  return (
    <Button
      data-image-cropper-rotate=''
      variant='ghost'
      size='icon-sm'
      aria-label='Rotate clockwise'
      disabled={disabled || status !== 'loaded'}
      onClick={() => rotate(1)}
      className={className}
      {...props}
    >
      <IconPlaceholder
        lucide='RotateCwIcon'
        tabler='IconRotateClockwise'
        phosphor='ArrowClockwiseIcon'
        hugeicons='RotateClockwiseIcon'
        remixicon='RiClockwiseLine'
        aria-hidden
      />
    </Button>
  )
}

/**
 * The crop as it will look, live, such as the avatar it becomes: it fills
 * its own box, which its class sizes, and is round for a round crop.
 */
function ImageCropperPreview({ className, ref, ...props }: ComponentProps<'div'>) {
  const { src, crossOrigin, natural, store, shape } = useImageCropper()
  const [box, setBox] = useState<Size | null>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const boxRefs = useMemo(() => mergeRefs(boxRef, markResizing, ref), [ref])
  const frameRef = useRef<HTMLDivElement>(null)
  const imageRef = useRef<HTMLImageElement>(null)
  const angle = useRef<number | null>(null)
  const covers = useRef<Animation[]>([])
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
  // It follows the store, so it keeps up with a drag without rendering.
  useLayoutEffect(() => {
    const paint = () => {
      boxRef.current?.toggleAttribute('data-following', store.isFollowing())
      const crop = store.getCrop()
      if (!natural || !crop || !box) return
      const last = angle.current
      angle.current = last === null ? crop.rotation : nextAngle(last, crop.rotation)
      const frame = coverRect(imageRect(box), crop.width / crop.height)
      const transform = viewTransform(crop, frame)
      const recover =
        (last !== null && angle.current !== last) ||
        (frameRef.current !== null &&
          runningTransitions(frameRef.current, { property: 'rotate' }).length > 0)
      placeImage(
        frameRef.current,
        imageRef.current,
        imagePlacement(natural, angle.current, transform, crop),
      )
      if (recover && frameRef.current) {
        for (const cover of covers.current) cover.cancel()
        const made: Animation[] = coverTurn(
          [frameRef.current],
          imageRef.current,
          null,
          box,
          { ...imagePose(natural, angle.current, transform, crop), hole: imageRect(box) },
          natural,
          shape === 'circle',
          () => {
            if (covers.current === made) paint()
          },
        )
        covers.current = made
      }
    }
    paint()
    return store.subscribe(paint)
  }, [store, natural, box, shape])
  return (
    <div
      ref={boxRefs}
      data-slot='image-cropper-preview'
      aria-hidden
      className={cn(
        'group/cropper bg-muted relative size-16 shrink-0 overflow-hidden',
        shape === 'circle' ? 'rounded-full' : 'rounded-(--control-radius-capped)',
        className,
      )}
      {...props}
    >
      {natural && box ? (
        <div
          ref={frameRef}
          className={cn('absolute top-0 left-0 origin-top-left', glideClassName)}
        >
          {/* oxlint-disable-next-line nextjs/no-img-element -- a registry item can't use next/image */}
          <img
            ref={imageRef}
            src={src}
            alt=''
            crossOrigin={crossOrigin}
            draggable={false}
            className={cn('absolute top-0 left-0 max-w-none', glideClassName)}
          />
        </div>
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// The output

interface CropImageOptions {
  /** The file type, such as `image/png`. A circle is a PNG, so its corners stay clear; anything else a JPEG. */
  type?: string
  /** From 0 to 1, for JPEG and WebP. */
  quality?: number
  /** The largest the output may be, in px; it is never made larger than the crop. */
  maxWidth?: number
  maxHeight?: number
  /** `circle` keeps only the round part. */
  shape?: CropShape
  /** What shows through a transparent image in a JPEG. */
  background?: string
}

async function loadBitmap(source: string | Blob | HTMLImageElement) {
  if (typeof source === 'string') {
    const response = await fetch(source)
    if (!response.ok)
      throw new Error(`The image couldn't be loaded (${response.status}).`)
    return createImageBitmap(await response.blob())
  }
  return createImageBitmap(source)
}

/**
 * The cropped image as a file's contents, cut from the original at full
 * resolution: the crop's own pixels, turned, and never enlarged. A URL on
 * another site needs CORS, as any canvas does.
 */
async function cropImage(
  source: string | Blob | HTMLImageElement,
  crop: Crop,
  {
    shape = 'rectangle',
    type = shape === 'circle' ? 'image/png' : 'image/jpeg',
    quality = 0.92,
    maxWidth,
    maxHeight,
    background = '#fff',
  }: CropImageOptions = {},
): Promise<Blob> {
  const bitmap = await loadBitmap(source)
  const natural = { width: bitmap.width, height: bitmap.height }
  const exact = pixelCrop(crop, natural)
  const size = outputSize(exact, { maxWidth, maxHeight })
  const canvas = document.createElement('canvas')
  canvas.width = size.width
  canvas.height = size.height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('The browser couldn’t draw the image.')
  context.imageSmoothingQuality = 'high'
  if (type === 'image/jpeg') {
    context.fillStyle = background
    context.fillRect(0, 0, size.width, size.height)
  }
  if (shape === 'circle') {
    context.beginPath()
    context.ellipse(
      size.width / 2,
      size.height / 2,
      size.width / 2,
      size.height / 2,
      0,
      0,
      Math.PI * 2,
    )
    context.clip()
  }
  context.scale(size.width / exact.width, size.height / exact.height)
  context.translate(-exact.x, -exact.y)
  // From the image's own pixels to the pixels of the image as it is shown.
  if (exact.rotation === 90) context.translate(natural.height, 0)
  if (exact.rotation === 180) context.translate(natural.width, natural.height)
  if (exact.rotation === 270) context.translate(0, natural.width)
  context.rotate((exact.rotation * Math.PI) / 180)
  context.drawImage(bitmap, 0, 0)
  bitmap.close()
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new Error('The browser couldn’t make the image.')),
      type,
      quality,
    )
  })
}

export {
  ImageCropper,
  ImageCropperArea,
  ImageCropperPreview,
  ImageCropperRotate,
  ImageCropperZoom,
  cropImage,
}

export {
  coverRect,
  cropZoom,
  describeCrop,
  drawRect,
  fitRect,
  handleAt,
  imagePlacement,
  insetClip,
  keepInside,
  moveRect,
  nextAngle,
  outputSize,
  pinchCrop,
  pixelCrop,
  placementToCrop,
  reshapeRect,
  resizeLimits,
  resizeRect,
  rotateCrop,
  rotatedSize,
  smallestCrop,
  toImage,
  toStage,
  turnCover,
  viewTransform,
  zoomRect,
}

export type {
  Crop,
  CropChangeDetails,
  CropChangeReason,
  CropHandle,
  CropImageOptions,
  CropMode,
  CropRotation,
  CropShape,
  Rect,
  Size,
  TurnPose,
}
