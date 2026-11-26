'use client'

import { InputInvalidIcon } from '@/registry/components/kino/input'
import { IconPlaceholder } from '@/registry/icons/icon-placeholder'
import { CutTooltip } from '@/registry/lib/cut'
import { followRows } from '@/registry/lib/highlight'
import {
  listIndicatorClassName,
  MenuHighlight,
  menuIndicatorSlot,
  menuLabelClassName,
  menuRowVariants,
  menuSeparatorClassName,
  MenuTick,
} from '@/registry/lib/menu'
import {
  PanelHandle,
  panelSheetBackdropClassName,
  popupSheetClassName,
  popupSheetPanelClassName,
} from '@/registry/lib/panel'
import {
  POPUP_COLLISION_PADDING,
  popupGrowBoxClassName,
  popupGrowContentClassName,
  popupPlacedClassName,
  popupSurfaceClassName,
  usePopupPresentation,
} from '@/registry/lib/popup'
import { mergeRefs } from '@/registry/lib/refs'
import { edgeFadeClassName, followEdges } from '@/registry/lib/scroll'
import {
  Select as SelectPrimitive,
  SelectContent as SelectContentPrimitive,
  SelectGroup as SelectGroupPrimitive,
  SelectGroupLabel as SelectGroupLabelPrimitive,
  SelectItem as SelectItemPrimitive,
  SelectItemIcon as SelectItemIconPrimitive,
  SelectItemIndicator as SelectItemIndicatorPrimitive,
  SelectList as SelectListPrimitive,
  type SelectProps,
  SelectSeparator as SelectSeparatorPrimitive,
  SelectTrigger as SelectTriggerPrimitive,
  SelectValue as SelectValuePrimitive,
  SelectValueIcon as SelectValueIconPrimitive,
} from '@ui-sdk/react/select'
import { cva, type VariantProps } from 'class-variance-authority'
import {
  type ComponentProps,
  createContext,
  type ReactNode,
  type RefCallback,
  use,
  useMemo,
  useRef,
} from 'react'

import { cn } from '@/lib/utils'

/*
 * A select that opens over its trigger, with the picked row's text on the
 * trigger's value, and unfolds out of the trigger's own outline. Where there
 * is no room above and below, with nothing picked, or on touch, it opens
 * under the trigger and grows as the Popover does.
 */

type TriggerContextValue = {
  /** The trigger, read when the list opens. */
  trigger: { current: HTMLButtonElement | null }
  /** Tells the presentation where the trigger is, to read the motion preference there. */
  setTrigger: (element: HTMLElement | null) => void
}

const TriggerContext = createContext<TriggerContextValue | null>(null)

/**
 * In a Field, it takes the Field's label, name and state, as ui-sdk's
 * controls do. With `presentation='auto'`, a small touch screen opens it
 * as a sheet, unless motion is reduced around its trigger
 * (`popupPresentation`).
 */
function Select<Value = string, Multiple extends boolean | undefined = false>(
  props: SelectProps<Value, Multiple>,
) {
  const trigger = useRef<HTMLButtonElement>(null)
  const [shown, setTrigger] = usePopupPresentation(props.presentation ?? 'popover')
  const context = useMemo(() => ({ trigger, setTrigger }), [setTrigger])
  return (
    <TriggerContext value={context}>
      <SelectPrimitive<Value, Multiple>
        // Focus stays on the trigger, as on a native select and in the APG's
        // select-only combobox; a sheet moves it into the rows, for touch screen readers.
        virtualFocus={shown !== 'sheet'}
        {...props}
        presentation={shown}
      />
    </TriggerContext>
  )
}

function SelectValue({
  className,
  ...props
}: Omit<ComponentProps<typeof SelectValuePrimitive>, 'className'> & {
  className?: string
}) {
  return (
    <SelectValuePrimitive
      data-cut
      className={cn(
        // A bare label truncates with an ellipsis; an icon and a label sit in a row.
        'block min-w-0 flex-1 truncate data-placeholder:text-muted-foreground has-[>*]:flex has-[>*]:items-center has-[>*]:gap-2',
        className,
      )}
      {...props}
    />
  )
}

/** The picked row's `SelectItemIcon`, before the value in the trigger. */
function SelectValueIcon({
  className,
  ...props
}: Omit<ComponentProps<typeof SelectValueIconPrimitive>, 'className'> & {
  className?: string
}) {
  return (
    <SelectValueIconPrimitive
      className={cn('flex shrink-0 items-center', className)}
      {...props}
    />
  )
}

const selectTriggerVariants = cva(
  "flex w-fit min-w-0 items-center justify-between gap-2 rounded-(--control-radius) border border-input bg-transparent text-start text-sm whitespace-nowrap shadow-xs transition-[color,background-color,border-color,box-shadow] duration-(--motion-press-duration) ease-(--motion-press-fade-easing) select-none hover:bg-muted/50 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-hidden data-disabled:pointer-events-none data-disabled:opacity-50 data-open:bg-muted/50 aria-invalid:border-destructive aria-invalid:focus-visible:border-destructive aria-invalid:focus-visible:ring-destructive/20 forced-colors:aria-invalid:outline-2 forced-colors:aria-invalid:outline-offset-1 forced-colors:aria-invalid:outline-dashed dark:bg-input/30 dark:hover:bg-input/50 dark:aria-invalid:border-destructive/70 dark:aria-invalid:focus-visible:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-muted-foreground",
  {
    variants: {
      size: {
        default: 'h-(--control-height) px-(--control-padding)',
        sm: 'h-(--control-height-sm) px-(--control-padding)',
      },
    },
    defaultVariants: { size: 'default' },
  },
)

function SelectTrigger({
  className,
  size = 'default',
  children,
  ref,
  ...props
}: Omit<ComponentProps<typeof SelectTriggerPrimitive>, 'className' | 'children'> &
  VariantProps<typeof selectTriggerVariants> & {
    className?: string
    children?: ReactNode
  }) {
  const context = use(TriggerContext)
  const refs = useMemo(
    () => mergeRefs(context?.trigger, context?.setTrigger, ref),
    [context, ref],
  )
  return (
    <CutTooltip
      render={
        <SelectTriggerPrimitive
          ref={refs}
          data-size={size}
          className={cn(selectTriggerVariants({ size }), className)}
          {...props}
        >
          {children}
          {/* As on every text control, an invalid value is marked by more than its colour. */}
          <InputInvalidIcon className='-me-1 pe-0' />
          <span aria-hidden className='flex shrink-0'>
            <IconPlaceholder
              lucide='ChevronDownIcon'
              tabler='IconChevronDown'
              hugeicons='ArrowDown01Icon'
              phosphor='CaretDownIcon'
              remixicon='RiArrowDownSLine'
              aria-hidden
            />
          </span>
        </SelectTriggerPrimitive>
      }
    />
  )
}

type Edges = { top: number; right: number; bottom: number; left: number }

/**
 * Whether the list sits over its trigger, as ui-sdk places it with
 * `alignItemWithTrigger`, rather than above or below it.
 */
function overTrigger(list: Edges, trigger: Edges) {
  return list.top < trigger.bottom && list.bottom > trigger.top
}

/**
 * How far, in px along the x axis, to move a list placed over its trigger so
 * its rows' content starts where the trigger's does: `textStart` and
 * `valueStart` are where each starts on screen (its left edge, or its right
 * in right to left), and `current` how far the list is moved now, which
 * `textStart` and `list` include. It stays `padding` inside the screen's
 * edges, `viewport` wide.
 */
function triggerShift({
  textStart,
  valueStart,
  list,
  current,
  viewport,
  padding = POPUP_COLLISION_PADDING,
}: {
  textStart: number
  valueStart: number
  list: Pick<Edges, 'left' | 'right'>
  current: number
  viewport: number
  padding?: number
}) {
  const wanted = current + valueStart - textStart
  const least = padding - (list.left - current)
  const most = viewport - padding - (list.right - current)
  return Math.round(Math.min(Math.max(wanted, least), most))
}

/** Where a row's or a trigger's content starts on screen: past its tick and gap, or past its border and padding. */
function contentStart(row: HTMLElement, rtl: boolean) {
  const style = getComputedStyle(row)
  const box = row.getBoundingClientRect()
  const tick = row.querySelector(':scope > [data-menu-indicator]')
  if (tick) {
    const at = tick.getBoundingClientRect()
    const gap = parseFloat(style.columnGap) || 0
    return rtl ? at.left - gap : at.right + gap
  }
  return rtl
    ? box.right - parseFloat(style.borderRightWidth) - parseFloat(style.paddingRight)
    : box.left + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft)
}

/**
 * The `inset()` sides, in pixels, that show the trigger inside the list's
 * box: inside the trigger's 1px border, so its outline still shows on the
 * first frame, and past the tick's tip, which sits 5px inside its start (the
 * right in right to left).
 */
function triggerInset(box: Edges, trigger: Edges, rtl: boolean): Edges {
  return {
    top: trigger.top - box.top + 1,
    right: box.right - trigger.right + (rtl ? 6 : 1),
    bottom: box.bottom - trigger.bottom + 1,
    left: trigger.left - box.left + (rtl ? 1 : 6),
  }
}

/*
 * Over its trigger, the list is marked `data-over-trigger`, moved so the
 * picked row's text lines up with the value (`--select-shift`) and widened
 * by as much (`--select-reach`), and its box unfolds from the trigger's own
 * outline (`--select-trigger-box`). Measured whenever ui-sdk places the list
 * and whenever it grows. Kept outside the component: the React Compiler can
 * drop side effects written inside one.
 */
function trackTrigger(content: HTMLElement, box: HTMLElement, trigger: HTMLElement) {
  const write = () => {
    const placed = content.getBoundingClientRect()
    if (!placed.width) return
    const at = trigger.getBoundingClientRect()
    const over = content.dataset.presentation !== 'sheet' && overTrigger(placed, at)
    content.toggleAttribute('data-over-trigger', over)
    if (!over) return
    const rtl = getComputedStyle(content).direction === 'rtl'
    const row = content.querySelector<HTMLElement>(
      '[data-slot=select-item][data-selected]',
    )
    const current = parseFloat(content.style.getPropertyValue('--select-shift')) || 0
    const shift = row
      ? triggerShift({
          textStart: contentStart(row, rtl),
          valueStart: contentStart(trigger, rtl),
          list: placed,
          current,
          viewport: document.documentElement.clientWidth,
        })
      : current
    if (shift !== current) {
      content.style.setProperty('--select-shift', `${shift}px`)
      content.style.setProperty('--select-reach', `${Math.abs(shift)}px`)
    }
    // Read once the move and the reach are written, which the box takes at once.
    const shown = box.getBoundingClientRect()
    const { top, right, bottom, left } = triggerInset(shown, at, rtl)
    box.style.setProperty(
      '--select-trigger-box',
      `inset(${top}px ${right}px ${bottom}px ${left}px round max(0px, calc(var(--control-radius-capped) - 1px)))`,
    )
  }
  // A close that interrupts the unfold fades where the box is, rather than
  // letting it grow on while it fades; once it has closed, the next open
  // unfolds again.
  const hold = () => {
    box.style.clipPath =
      content.hasAttribute('data-ending-style') &&
      content.hasAttribute('data-over-trigger')
        ? getComputedStyle(box).clipPath
        : ''
  }
  write()
  const placing = new MutationObserver((records) => {
    write()
    if (records.some((record) => record.attributeName !== 'style')) hold()
  })
  placing.observe(content, {
    attributes: true,
    attributeFilter: ['style', 'data-side', 'data-starting-style', 'data-ending-style'],
  })
  const resize = new ResizeObserver(write)
  resize.observe(content)
  return () => {
    placing.disconnect()
    resize.disconnect()
  }
}

/** A ref for the rows: the highlight that glides between them, the list's fading edges and its place over the trigger. */
function followSelect(trigger: { current: HTMLElement | null } | undefined) {
  return (rows: HTMLDivElement | null) => {
    const list = rows?.parentElement
    const content = rows?.closest<HTMLElement>('[data-slot=select-content]')
    const layer = rows?.querySelector<HTMLElement>(':scope > [data-slot=menu-highlight]')
    if (!rows || !list || !content || !layer) return
    const stops = [
      followRows(rows, layer, { popup: content, bounds: list }),
      followEdges(list, '--scroll-fade'),
    ]
    const box = list.parentElement
    if (box && trigger?.current) stops.push(trackTrigger(content, box, trigger.current))
    return () => {
      for (const stop of stops) stop()
    }
  }
}

/*
 * Over the trigger, the box starts as the trigger's own outline with its
 * rows already showing, so the picked row sits on the value from the first
 * frame. It closes by fading where it is, quickly, so the trigger and its
 * new value show through at once and are never covered by a box folding
 * back over them. Elsewhere, the Popover's Grow.
 */
const selectUnfoldClassName =
  'group-data-over-trigger/popup:group-data-starting-style/popup:[clip-path:var(--select-trigger-box)] group-data-over-trigger/popup:group-data-ending-style/popup:[clip-path:var(--popup-grow-to)] group-data-over-trigger/popup:group-data-ending-style/popup:opacity-0 group-data-over-trigger/popup:group-data-ending-style/popup:duration-[calc(var(--motion-exit-duration)*0.5)] motion-reduce:group-data-over-trigger/popup:group-data-starting-style/popup:[clip-path:var(--popup-grow-to)]'

// Over the trigger the rows show at once and fade with the box; elsewhere
// they fade in and out as a Popover's content does.
const selectRowsClassName =
  'group-data-over-trigger/popup:transition-none group-data-over-trigger/popup:group-data-starting-style/popup:opacity-100 group-data-over-trigger/popup:group-data-ending-style/popup:opacity-100'

/**
 * The list. Over the trigger by default, with the picked row on the
 * trigger's value; `side`, `align` and the offsets apply when it opens under
 * the trigger instead, or with `alignItemWithTrigger={false}`. `className`
 * goes to the rows inside the box; every other prop goes to ui-sdk's
 * content. A long list scrolls.
 */
function SelectContent({
  className,
  children,
  alignItemWithTrigger = true,
  side = 'bottom',
  align = 'start',
  sideOffset = 6,
  ...props
}: Omit<ComponentProps<typeof SelectContentPrimitive>, 'className' | 'children'> & {
  className?: string
  children?: ReactNode
}) {
  const context = use(TriggerContext)
  const rowsRef: RefCallback<HTMLDivElement> = useMemo(
    () => followSelect(context?.trigger),
    [context],
  )
  return (
    <SelectContentPrimitive
      alignItemWithTrigger={alignItemWithTrigger}
      side={side}
      align={align}
      sideOffset={sideOffset}
      collisionPadding={POPUP_COLLISION_PADDING}
      arrowPadding={0}
      className={cn(
        popupPlacedClassName,
        panelSheetBackdropClassName,
        // Over the trigger, it starts a tick's width before the trigger, so
        // its rows' text lines up with the value, and reaches as far past its end.
        'flex max-h-[min(var(--available-height),24rem)] max-w-[min(20rem,var(--available-width))] min-w-(--anchor-width) flex-col text-sm data-over-trigger:min-w-[calc(var(--anchor-width)+var(--select-reach,0px))] data-over-trigger:[translate:var(--select-shift,0px)_0]',
        popupSheetClassName,
      )}
      {...props}
    >
      {({ presentation }) => (
        <div
          className={cn(
            'flex min-h-0 flex-1 flex-col',
            presentation === 'sheet'
              ? popupSheetPanelClassName
              : cn(
                  'relative overflow-hidden rounded-(--list-radius)',
                  popupSurfaceClassName,
                  popupGrowBoxClassName,
                  selectUnfoldClassName,
                ),
          )}
        >
          {presentation === 'sheet' ? <PanelHandle /> : null}
          <SelectListPrimitive
            className={cn(
              'scrollbar-thin relative min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain rounded-[inherit]',
              edgeFadeClassName,
            )}
          >
            <div
              ref={rowsRef}
              className={cn(
                // The 4px around the rows is the highlight's margin, not a
                // surface's padding, so it stays the same at every density.
                'group/menu relative flex flex-col p-1',
                presentation === 'sheet' ? null : popupGrowContentClassName,
                selectRowsClassName,
                className,
              )}
            >
              <MenuHighlight />
              {children}
            </div>
          </SelectListPrimitive>
        </div>
      )}
    </SelectContentPrimitive>
  )
}

function SelectGroup(props: ComponentProps<typeof SelectGroupPrimitive>) {
  return <SelectGroupPrimitive {...props} />
}

function SelectGroupLabel({
  className,
  ...props
}: Omit<ComponentProps<typeof SelectGroupLabelPrimitive>, 'className'> & {
  className?: string
}) {
  return (
    <SelectGroupLabelPrimitive className={cn(menuLabelClassName, className)} {...props} />
  )
}

/**
 * A row: the menus' own, with the tick first, as on macOS, so the text lines
 * up with the trigger's value. Its text is what the trigger shows, or
 * `label` where it holds more than text. Put an icon in a `SelectItemIcon`
 * before the text, and the trigger's `SelectValueIcon` shows it.
 */
function SelectItem({
  className,
  children,
  ...props
}: Omit<ComponentProps<typeof SelectItemPrimitive>, 'className' | 'children'> & {
  className?: string
  children?: ReactNode
}) {
  return (
    <SelectItemPrimitive
      data-menu-row=''
      className={cn(menuRowVariants(), 'group/menu-row', className)}
      {...props}
    >
      <span data-menu-indicator='' className={menuIndicatorSlot}>
        <SelectItemIndicatorPrimitive keepMounted className={listIndicatorClassName}>
          <MenuTick />
        </SelectItemIndicatorPrimitive>
      </span>
      {children}
    </SelectItemPrimitive>
  )
}

/** A row's icon, before its text: the trigger shows the picked row's with `SelectValueIcon`. */
function SelectItemIcon({
  className,
  ...props
}: Omit<ComponentProps<typeof SelectItemIconPrimitive>, 'className'> & {
  className?: string
}) {
  return (
    <SelectItemIconPrimitive
      className={cn(
        "flex shrink-0 items-center [&_svg:not([class*='text-'])]:text-muted-foreground",
        className,
      )}
      {...props}
    />
  )
}

function SelectSeparator({
  className,
  ...props
}: Omit<ComponentProps<typeof SelectSeparatorPrimitive>, 'className'> & {
  className?: string
}) {
  return (
    <SelectSeparatorPrimitive
      className={cn(menuSeparatorClassName, className)}
      {...props}
    />
  )
}

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectGroupLabel,
  SelectItem,
  SelectItemIcon,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
  SelectValueIcon,
  selectTriggerVariants,
  overTrigger,
  triggerInset,
  triggerShift,
}
