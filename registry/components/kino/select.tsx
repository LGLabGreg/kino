'use client'

import { InputInvalidIcon } from '@/registry/components/kino/input'
import { IconPlaceholder } from '@/registry/icons/icon-placeholder'
import { CutTooltip } from '@/registry/lib/cut'
import { useField, useFieldProps } from '@/registry/lib/field-control'
import { followRows } from '@/registry/lib/highlight'
import {
  MenuHighlight,
  menuIndicatorClassName,
  menuIndicatorSlot,
  menuLabelClassName,
  menuRowVariants,
  menuSeparatorClassName,
  MenuTick,
} from '@/registry/lib/menu'
import {
  popupGrowClassName,
  popupGrowContentClassName,
  basePositionerProps,
  popupSurfaceClassName,
  basePopupGrow,
  usePopupLayer,
} from '@/registry/lib/popup'
import { mergeRefs } from '@/registry/lib/refs'
import { edgeFadeClassName, followEdges } from '@/registry/lib/scroll'
import { useDirection } from '@base-ui/react/direction-provider'
import { Select as SelectPrimitive } from '@base-ui/react/select'
import { cva, type VariantProps } from 'class-variance-authority'
import {
  type ComponentProps,
  createContext,
  type RefObject,
  use,
  useEffect,
  useMemo,
  useRef,
} from 'react'

import { cn } from '@/lib/utils'

/*
 * A select that opens over its trigger, with the picked row on the trigger's
 * value, and unfolds out of the trigger's own outline. Where there is no
 * room above and below, or on touch, it opens under the trigger and grows
 * as the Popover does.
 */

const TriggerContext = createContext<RefObject<HTMLButtonElement | null> | null>(null)

function Select<Value, Multiple extends boolean | undefined = false>({
  name,
  disabled,
  ...props
}: SelectPrimitive.Root.Props<Value, Multiple>) {
  const triggerRef = useRef<HTMLButtonElement>(null)
  // In a Field, it sends its value under the Field's name and turns off with it.
  const field = useField()
  return (
    <TriggerContext value={triggerRef}>
      <SelectPrimitive.Root
        name={name ?? field?.name}
        disabled={disabled || field?.disabled}
        {...props}
      />
    </TriggerContext>
  )
}

function SelectGroup(props: SelectPrimitive.Group.Props) {
  return <SelectPrimitive.Group data-slot='select-group' {...props} />
}

function SelectValue({
  className,
  ...props
}: Omit<SelectPrimitive.Value.Props, 'className'> & { className?: string }) {
  return (
    <SelectPrimitive.Value
      data-slot='select-value'
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

const selectTriggerVariants = cva(
  "flex w-fit min-w-0 items-center justify-between gap-2 rounded-(--control-radius) border border-input bg-transparent text-start text-sm whitespace-nowrap shadow-xs transition-[color,background-color,border-color,box-shadow] duration-(--motion-press-duration) ease-(--motion-press-fade-easing) select-none hover:bg-muted/50 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-hidden data-disabled:pointer-events-none data-disabled:opacity-50 data-popup-open:bg-muted/50 aria-invalid:border-destructive aria-invalid:focus-visible:border-destructive aria-invalid:focus-visible:ring-destructive/20 forced-colors:aria-invalid:outline-2 forced-colors:aria-invalid:outline-offset-1 forced-colors:aria-invalid:outline-dashed dark:bg-input/30 dark:hover:bg-input/50 dark:aria-invalid:border-destructive/70 dark:aria-invalid:focus-visible:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-muted-foreground",
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
}: Omit<
  SelectPrimitive.Trigger.Props & VariantProps<typeof selectTriggerVariants>,
  'className'
> & { className?: string }) {
  const triggerRef = use(TriggerContext)
  // The trigger is what a Field's label names, its description describes and its check marks.
  const field = useFieldProps(props)
  const fieldRef = field.props.ref
  const refs = useMemo(
    () => mergeRefs(triggerRef ?? undefined, ref, fieldRef),
    [triggerRef, ref, fieldRef],
  )
  return (
    <CutTooltip
      render={
        <SelectPrimitive.Trigger
          data-slot='select-trigger'
          data-size={size}
          className={cn(selectTriggerVariants({ size }), className)}
          {...field.props}
          ref={refs}
        >
          {children}
          {/* As on every text control, an invalid value is marked by more than its colour. */}
          <InputInvalidIcon className='-me-1 pe-0' />
          <SelectPrimitive.Icon className='flex shrink-0'>
            <IconPlaceholder
              lucide='ChevronDownIcon'
              tabler='IconChevronDown'
              hugeicons='ArrowDown01Icon'
              phosphor='CaretDownIcon'
              remixicon='RiArrowDownSLine'
              aria-hidden
            />
          </SelectPrimitive.Icon>
        </SelectPrimitive.Trigger>
      }
    />
  )
}

/*
 * Where the trigger is inside the popup, as the `inset()` the popup unfolds
 * from. Measured once Base UI has placed the popup over the trigger, and
 * again whenever the popup moves or grows. Kept outside the component: the
 * React Compiler can drop side effects written inside one.
 */
type Edges = { top: number; right: number; bottom: number; left: number }

/**
 * The `inset()` sides, in pixels, that show the trigger inside the popup:
 * inside the trigger's 1px border, so its outline still shows on the first
 * frame, and past the tick's tip, which sits 5px inside its start (the
 * right in right to left).
 */
function triggerInset(popup: Edges, trigger: Edges, rtl: boolean): Edges {
  return {
    top: trigger.top - popup.top + 1,
    right: popup.right - trigger.right + (rtl ? 6 : 1),
    bottom: popup.bottom - trigger.bottom + 1,
    left: trigger.left - popup.left + (rtl ? 1 : 6),
  }
}

function trackTriggerBox(popup: HTMLElement, trigger: HTMLElement) {
  const write = () => {
    const box = popup.getBoundingClientRect()
    if (!box.width) return
    const { top, right, bottom, left } = triggerInset(
      box,
      trigger.getBoundingClientRect(),
      getComputedStyle(popup).direction === 'rtl',
    )
    popup.style.setProperty(
      '--select-trigger-box',
      `inset(${top}px ${right}px ${bottom}px ${left}px round max(0px, calc(var(--control-radius-capped) - 1px)))`,
    )
  }
  // A close that interrupts the unfold fades where the box is, rather than
  // letting it grow on while it fades.
  const hold = () => {
    if (popup.hasAttribute('data-starting-style')) popup.style.clipPath = ''
    else if (popup.hasAttribute('data-ending-style') && popup.dataset.side === 'none') {
      popup.style.clipPath = getComputedStyle(popup).clipPath
    }
  }
  write()
  const observer = new MutationObserver((records) => {
    write()
    if (records.some((record) => record.target === popup)) hold()
  })
  if (popup.parentElement) {
    observer.observe(popup.parentElement, {
      attributes: true,
      attributeFilter: ['style'],
    })
  }
  observer.observe(popup, {
    attributes: true,
    attributeFilter: ['data-side', 'data-starting-style', 'data-ending-style'],
  })
  const resize = new ResizeObserver(write)
  resize.observe(popup)
  return () => {
    observer.disconnect()
    resize.disconnect()
  }
}

/*
 * Over the trigger (`data-side='none'`), the box starts as the trigger's own
 * outline with its rows already showing, so the picked row sits on the value
 * from the first frame. It closes by fading where it is, quickly, so the
 * trigger and its new value show through at once and are never covered by a
 * box folding back over them. Under the trigger, the Popover's Grow.
 */
const selectUnfoldClassName =
  'data-[side=none]:data-starting-style:[clip-path:var(--select-trigger-box)] data-[side=none]:data-ending-style:[clip-path:var(--popup-grow-to)] data-[side=none]:data-ending-style:opacity-0 data-[side=none]:data-ending-style:duration-[calc(var(--motion-exit-duration)*0.5)] motion-reduce:data-[side=none]:data-starting-style:[clip-path:var(--popup-grow-to)]'

// Over the trigger the rows show at once and fade with the box; under it
// they fade in and out as a Popover's content does. While it starts, the
// rows take their starting opacity at once, so a popup Base UI moves from
// over the trigger to under it still fades its rows in.
const selectRowsClassName =
  'group-data-starting-style/popup:transition-none group-data-[side=none]/popup:transition-none group-data-[side=none]/popup:group-data-starting-style/popup:opacity-100 group-data-[side=none]/popup:group-data-ending-style/popup:opacity-100'

/**
 * The popup's box, its rows and the highlight. Base UI keeps it mounted,
 * hidden, while the list is closed, so the highlight starts afresh on every
 * open.
 */
function SelectPopup({
  className,
  children,
  style,
  ref,
  ...props
}: Omit<SelectPrimitive.Popup.Props, 'className'> & { className?: string }) {
  const triggerRef = use(TriggerContext)
  const { dir, style: growStyle, anchor } = basePopupGrow(useDirection())
  const popupRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const rowsRef = useRef<HTMLDivElement>(null)
  const layerRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const popup = popupRef.current
    if (!popup || !rowsRef.current || !layerRef.current || !listRef.current) return
    const stopRows = followRows(rowsRef.current, layerRef.current, {
      popup,
      bounds: listRef.current,
    })
    const stopEdges = followEdges(listRef.current, '--scroll-fade')
    return () => {
      stopRows()
      stopEdges()
    }
  }, [])
  useEffect(() => {
    if (!popupRef.current || !triggerRef?.current) return
    return trackTriggerBox(popupRef.current, triggerRef.current)
  }, [triggerRef])
  return (
    <SelectPrimitive.Popup
      // A ref of the user's own still lets the popup measure itself.
      ref={mergeRefs(popupRef, ref)}
      data-slot='select-content'
      // Portalled out of the page's tree, so it takes the reading direction with it.
      dir={dir}
      style={(state) => ({
        ...growStyle({ side: state.side === 'none' ? 'bottom' : state.side }),
        ...(typeof style === 'function' ? style(state) : style),
      })}
      className={cn(
        // Over the trigger, Base UI sizes the box to the screen, and it starts
        // a tick's width before the trigger so its text lines up with the value.
        'group/popup relative flex max-h-[min(var(--available-height),24rem)] max-w-[min(20rem,var(--available-width))] min-w-(--anchor-width) flex-col overflow-hidden rounded-(--list-radius) text-sm data-[side=none]:max-h-none data-[side=none]:min-w-[calc(var(--anchor-width)+1.75rem)]',
        popupSurfaceClassName,
        popupGrowClassName,
        selectUnfoldClassName,
      )}
      {...props}
    >
      <SelectScrollUpButton />
      <SelectPrimitive.List
        ref={listRef}
        // Its scroll padding, the fade's width, is also the scroll buttons' height,
        // so a row the keys move to is never under one.
        className={cn(
          'scrollbar-thin min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain',
          edgeFadeClassName,
        )}
      >
        <div
          ref={rowsRef}
          className={cn(
            // The 4px around the rows is the highlight's margin, not a
            // surface's padding, so it stays the same at every density.
            'group/menu relative flex flex-col p-1',
            popupGrowContentClassName,
            selectRowsClassName,
            className,
          )}
        >
          <MenuHighlight ref={layerRef} />
          {children}
        </div>
      </SelectPrimitive.List>
      <SelectScrollDownButton />
      <SelectPrimitive.Arrow {...anchor} />
    </SelectPrimitive.Popup>
  )
}

/**
 * The list. Over the trigger by default, with the picked row on the
 * trigger's value; `side`, `align` and the offsets apply when it opens under
 * the trigger instead. `className` goes to the rows inside the box; every
 * other prop goes to Base UI's Popup. A long list scrolls.
 */
function SelectContent({
  alignItemWithTrigger = true,
  side = 'bottom',
  align = 'start',
  sideOffset = 6,
  alignOffset = 0,
  ...props
}: ComponentProps<typeof SelectPopup> &
  Pick<
    SelectPrimitive.Positioner.Props,
    'alignItemWithTrigger' | 'side' | 'align' | 'sideOffset' | 'alignOffset'
  >) {
  return (
    <SelectPrimitive.Portal container={usePopupLayer()}>
      <SelectPrimitive.Positioner
        {...basePositionerProps}
        alignItemWithTrigger={alignItemWithTrigger}
        side={side}
        align={align}
        sideOffset={sideOffset}
        alignOffset={alignOffset}
      >
        <SelectPopup {...props} />
      </SelectPrimitive.Positioner>
    </SelectPrimitive.Portal>
  )
}

function SelectLabel({
  className,
  ...props
}: Omit<SelectPrimitive.GroupLabel.Props, 'className'> & { className?: string }) {
  return (
    <SelectPrimitive.GroupLabel
      data-slot='select-label'
      className={cn(menuLabelClassName, className)}
      {...props}
    />
  )
}

/** A row: the menus' own, with the tick first, as on macOS, so the text lines up with the trigger's value. */
function SelectItem({
  className,
  children,
  ...props
}: Omit<SelectPrimitive.Item.Props, 'className'> & { className?: string }) {
  return (
    <SelectPrimitive.Item
      data-slot='select-item'
      data-menu-row=''
      className={cn(menuRowVariants(), 'group/menu-row', className)}
      {...props}
    >
      <span data-menu-indicator='' className={menuIndicatorSlot}>
        <SelectPrimitive.ItemIndicator className={menuIndicatorClassName}>
          <MenuTick />
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText className='flex min-w-0 flex-1 items-center gap-2'>
        {children}
      </SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  )
}

function SelectSeparator({
  className,
  ...props
}: Omit<SelectPrimitive.Separator.Props, 'className'> & {
  className?: string
}) {
  return (
    <SelectPrimitive.Separator
      data-slot='select-separator'
      className={cn(menuSeparatorClassName, className)}
      {...props}
    />
  )
}

const scrollButtonClassName =
  'from-popover text-muted-foreground absolute inset-x-0 z-10 flex h-6 cursor-default items-center justify-center to-transparent transition-opacity duration-(--motion-enter-duration) ease-(--motion-enter-easing) data-starting-style:opacity-0 data-ending-style:opacity-0 data-ending-style:duration-(--motion-exit-duration) data-ending-style:ease-(--motion-exit-easing)'

function SelectScrollUpButton({
  className,
  ...props
}: Omit<SelectPrimitive.ScrollUpArrow.Props, 'className'> & { className?: string }) {
  return (
    <SelectPrimitive.ScrollUpArrow
      data-slot='select-scroll-up-button'
      className={cn(scrollButtonClassName, 'top-0 bg-linear-to-b', className)}
      {...props}
    >
      <IconPlaceholder
        lucide='ChevronUpIcon'
        tabler='IconChevronUp'
        hugeicons='ArrowUp01Icon'
        phosphor='CaretUpIcon'
        remixicon='RiArrowUpSLine'
        aria-hidden
      />
    </SelectPrimitive.ScrollUpArrow>
  )
}

function SelectScrollDownButton({
  className,
  ...props
}: Omit<SelectPrimitive.ScrollDownArrow.Props, 'className'> & { className?: string }) {
  return (
    <SelectPrimitive.ScrollDownArrow
      data-slot='select-scroll-down-button'
      className={cn(scrollButtonClassName, 'bottom-0 bg-linear-to-t', className)}
      {...props}
    >
      <IconPlaceholder
        lucide='ChevronDownIcon'
        tabler='IconChevronDown'
        hugeicons='ArrowDown01Icon'
        phosphor='CaretDownIcon'
        remixicon='RiArrowDownSLine'
        aria-hidden
      />
    </SelectPrimitive.ScrollDownArrow>
  )
}

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
  selectTriggerVariants,
  triggerInset,
}
