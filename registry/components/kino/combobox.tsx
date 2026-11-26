'use client'

import {
  focusControl,
  InputInvalidIcon,
  inputBoxClassName,
} from '@/registry/components/kino/input'
import { labelClassName } from '@/registry/components/kino/label'
import {
  ChipRemoveIcon,
  chipClassName,
  chipLeavingClassName,
  chipRemoveClassName,
} from '@/registry/lib/chip'
import { CutTooltip } from '@/registry/lib/cut'
import { useField } from '@/registry/lib/field-control'
import {
  FilterListClear,
  FilterListContent,
  type FilterListContentProps,
  FilterListEmpty,
  FilterListGroupLabel,
  FilterListInput,
  FilterListInputGroup,
  FilterListItem,
  FilterListList,
  FilterListSeparator,
  FilterListStatus,
  FilterListTrigger,
} from '@/registry/lib/filter-list'
import { useFlow } from '@/registry/lib/flow'
import { markMounted, mergeRefs } from '@/registry/lib/refs'
import { Combobox as ComboboxPrimitive } from '@base-ui/react/combobox'
import {
  type ComponentProps,
  createContext,
  type ReactNode,
  use,
  useId,
  useState,
} from 'react'

import { cn } from '@/lib/utils'

/*
 * The box grows out of the field, and as you type it moves to the height of
 * what still matches, on `layout`. The rows swap in place, and one highlight
 * glides between them.
 */

/** The chips' box, when there is one: the list opens under it, not under the input inside. */
const ChipsContext = createContext<{
  chips: HTMLElement | null
  setChips: (chips: HTMLElement | null) => void
} | null>(null)

/** What the list's box is anchored to, when it isn't the field. */
function useChipsAnchor() {
  return use(ChipsContext)?.chips ?? undefined
}

/**
 * The root. As you type, the first match is highlighted, so Enter picks it;
 * pass `autoHighlight={false}` to leave the highlight to the arrow keys.
 */
function Combobox<Value, Multiple extends boolean | undefined = false>({
  autoHighlight = true,
  name,
  disabled,
  ...props
}: ComboboxPrimitive.Root.Props<Value, Multiple>) {
  const [chips, setChips] = useState<HTMLElement | null>(null)
  const field = useField()
  return (
    <ChipsContext value={{ chips, setChips }}>
      <ComboboxPrimitive.Root
        autoHighlight={autoHighlight}
        name={name ?? field?.name}
        disabled={disabled || field?.disabled}
        {...props}
      />
    </ChipsContext>
  )
}

function ComboboxLabel({
  className,
  ...props
}: Omit<ComboboxPrimitive.Label.Props, 'className'> & { className?: string }) {
  return (
    <ComboboxPrimitive.Label
      data-slot='combobox-label'
      className={cn(labelClassName, className)}
      {...props}
    />
  )
}

/**
 * The field: the input and the buttons beside it, in the box every text
 * control has. The list opens under it and is as wide as it.
 */
function ComboboxInputGroup(props: ComponentProps<typeof FilterListInputGroup>) {
  return <FilterListInputGroup data-slot='combobox-input-group' {...props} />
}

/**
 * The text you type. In a field or among chips it fills the room left; at
 * the top of the list's box it is the box's search line.
 */
function ComboboxInput({ className, ...props }: ComponentProps<typeof FilterListInput>) {
  return (
    <FilterListInput
      data-slot='combobox-input'
      className={cn(
        // Among chips: a chip's height, beside the last chip, and never
        // narrower than a short word; a longer placeholder ends in an ellipsis.
        'in-data-[slot=combobox-chips]:h-(--control-height-xs) in-data-[slot=combobox-chips]:min-w-28 in-data-[slot=combobox-chips]:text-ellipsis in-data-[slot=combobox-chips]:px-1.5',
        // Among chips it glides on `layout` to where a chip that came or went
        // leaves it (`followFlow`), from where it was seen.
        'in-data-[slot=combobox-chips]:[transition:translate_var(--motion-layout-duration)_var(--motion-layout-easing)] data-[flow=start]:transition-none motion-reduce:transition-none',
        className,
      )}
      {...props}
    />
  )
}

/** Empties the value; it shows only while there is one. */
function ComboboxClear(props: ComponentProps<typeof FilterListClear>) {
  return <FilterListClear data-slot='combobox-clear' {...props} />
}

/**
 * Opens the list. In a field it is the chevron at its end. On its own, with
 * the value inside (`ComboboxValue`), it is a button that looks like a
 * select, for a list whose search sits at its top.
 */
function ComboboxTrigger(props: ComponentProps<typeof FilterListTrigger>) {
  return <FilterListTrigger data-slot='combobox-trigger' {...props} />
}

const ComboboxValue = ComboboxPrimitive.Value

/** What moves among the chips: the chips and the input after them. */
const flowItems = '[data-slot=combobox-chip], [data-slot=combobox-input]'

/**
 * The picked values, as chips, with the input after the last one: the field
 * of a combobox that takes many. A chip that comes or goes moves the others
 * to their new places, across lines too, and the field grows or shrinks a
 * line at a time, on `layout`; a chip that goes fades where it was.
 */
function ComboboxChips({
  className,
  children,
  ref,
  ...props
}: Omit<ComboboxPrimitive.Chips.Props, 'className'> & { className?: string }) {
  const setChips = use(ChipsContext)?.setChips
  return (
    <ComboboxPrimitive.Chips
      ref={mergeRefs(markMounted, setChips, ref)}
      data-slot='combobox-chips'
      onPointerDown={focusControl}
      className={cn(
        inputBoxClassName,
        // It wraps, so its corner is capped.
        'group/chips min-h-(--control-height) cursor-text rounded-(--control-radius-capped)',
        className,
      )}
      {...props}
    >
      <ChipsFlow>{children}</ChipsFlow>
      <InputInvalidIcon className='pe-1' />
    </ComboboxPrimitive.Chips>
  )
}

/*
 * The frame moves to the row's height as it wraps, and the row's chips flow.
 * A component of its own, so the effect has its elements on the first render.
 */
function ChipsFlow({ children }: { children: ReactNode }) {
  const { frame, row } = useFlow<HTMLDivElement, HTMLDivElement>(flowItems)
  return (
    <div
      ref={frame}
      className='min-w-0 flex-1 self-stretch overflow-clip transition-[height] duration-(--motion-layout-duration) ease-(--motion-layout-easing) motion-reduce:transition-none'
    >
      <div
        ref={row}
        data-slot='combobox-chips-row'
        // A chip sits the same distance from every edge of the box as from
        // the next chip, at every density.
        className='relative isolate flex min-h-[calc(var(--control-height)-2px)] flex-wrap items-center gap-1 p-[calc((var(--control-height)-var(--control-height-xs)-2px)/2)]'
      >
        {children}
      </div>
    </div>
  )
}

/**
 * A picked value, with its remove button. Arrow keys reach it from the
 * input; Backspace or Delete removes it. It scales in when picked.
 */
function ComboboxChip({
  className,
  children,
  ...props
}: Omit<ComboboxPrimitive.Chip.Props, 'className'> & { className?: string }) {
  const labelId = useId()
  return (
    <CutTooltip
      render={
        <ComboboxPrimitive.Chip
          data-slot='combobox-chip'
          // Base UI marks a read-only chip `aria-readonly`, which a chip's role
          // doesn't allow; its remove button, disabled, says it already.
          aria-readonly={undefined}
          aria-description='Press Backspace or Delete to remove'
          className={cn(
            chipClassName,
            // Above the input, whose caret and placeholder glide behind the chips.
            'z-1 ps-2 has-[>[aria-disabled=true]]:pe-2 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-hidden forced-colors:focus-visible:outline-2 forced-colors:focus-visible:outline-solid',
            // It scales in on `enter` once the field has painted, glides to a new
            // place on `layout` (`followFlow`), and its copy fades and shrinks
            // where it was on `exit`. A chip pointed out (`data-flash`), such as
            // one typed again, inverts for a moment on `press`.
            '[transition:opacity_var(--motion-enter-duration)_var(--motion-enter-easing),scale_var(--motion-enter-duration)_var(--motion-enter-easing),translate_var(--motion-layout-duration)_var(--motion-layout-easing),color_var(--motion-press-duration)_var(--motion-press-fade-easing),background-color_var(--motion-press-duration)_var(--motion-press-fade-easing),box-shadow_var(--motion-press-duration)_var(--motion-press-fade-easing)] group-data-mounted/chips:starting:opacity-0 motion-safe:group-data-mounted/chips:starting:scale-75',
            'data-[flow=start]:[transition:opacity_var(--motion-enter-duration)_var(--motion-enter-easing),scale_var(--motion-enter-duration)_var(--motion-enter-easing),color_var(--motion-press-duration)_var(--motion-press-fade-easing),background-color_var(--motion-press-duration)_var(--motion-press-fade-easing),box-shadow_var(--motion-press-duration)_var(--motion-press-fade-easing)] motion-reduce:[transition:opacity_var(--motion-enter-duration)_var(--motion-enter-easing),color_var(--motion-press-duration)_var(--motion-press-fade-easing),background-color_var(--motion-press-duration)_var(--motion-press-fade-easing),box-shadow_var(--motion-press-duration)_var(--motion-press-fade-easing)]',
            chipLeavingClassName,
            'data-flash:bg-foreground data-flash:text-background forced-colors:data-flash:outline-2 forced-colors:data-flash:outline-offset-1',
            className,
          )}
          {...props}
        >
          <span id={labelId} data-cut className='min-w-0 truncate'>
            {children}
          </span>
          <ComboboxChipRemove labelledBy={labelId} />
        </ComboboxPrimitive.Chip>
      }
    />
  )
}

/** `labelledBy` is the chip's label, so the button reads "Remove Billing". */
function ComboboxChipRemove({
  className,
  labelledBy,
  ...props
}: Omit<ComboboxPrimitive.ChipRemove.Props, 'className'> & {
  className?: string
  labelledBy?: string
}) {
  const id = useId()
  return (
    <ComboboxPrimitive.ChipRemove
      id={id}
      data-slot='combobox-chip-remove'
      aria-label='Remove'
      aria-labelledby={labelledBy ? `${id} ${labelledBy}` : undefined}
      className={cn(
        chipRemoveClassName,
        'in-data-flash:text-background aria-disabled:hidden',
        className,
      )}
      {...props}
    >
      <ChipRemoveIcon />
    </ComboboxPrimitive.ChipRemove>
  )
}

/**
 * The rows, with the highlight that glides between them. Give it a function
 * child, called for each item that matches what was typed, or rows and
 * groups of your own. It scrolls once it is taller than the box allows.
 */
function ComboboxList(props: ComponentProps<typeof FilterListList>) {
  return <FilterListList data-slot='combobox-list' {...props} />
}

/** A row: the menus' own, with the tick first, as on the Select. */
function ComboboxItem({
  indicator = true,
  ...props
}: Omit<ComponentProps<typeof FilterListItem>, 'indicator'> & {
  /** Whether the row keeps room for the tick of a picked value. Off for a list that never shows a picked value. */
  indicator?: boolean
}) {
  return <FilterListItem data-slot='combobox-item' indicator={indicator} {...props} />
}

function ComboboxGroup(props: ComboboxPrimitive.Group.Props) {
  return <ComboboxPrimitive.Group data-slot='combobox-group' {...props} />
}

function ComboboxGroupLabel(props: ComponentProps<typeof FilterListGroupLabel>) {
  return <FilterListGroupLabel data-slot='combobox-group-label' {...props} />
}

function ComboboxSeparator(props: ComponentProps<typeof FilterListSeparator>) {
  return <FilterListSeparator data-slot='combobox-separator' {...props} />
}

const ComboboxCollection = ComboboxPrimitive.Collection

/** What shows when nothing matches: say what was looked for. */
function ComboboxEmpty(props: ComponentProps<typeof FilterListEmpty>) {
  return <FilterListEmpty data-slot='combobox-empty' {...props} />
}

/** Announces a search that is running, or how many results it found. */
function ComboboxStatus(props: ComponentProps<typeof FilterListStatus>) {
  return <FilterListStatus data-slot='combobox-status' {...props} />
}

type ComboboxContentProps = FilterListContentProps

/**
 * The box, under the field, the chips or the trigger. `className` goes on
 * the box's content; every other prop goes to Base UI's Popup.
 */
function ComboboxContent({ anchor, ...props }: ComboboxContentProps) {
  const chips = useChipsAnchor()
  return (
    <FilterListContent data-slot='combobox-content' anchor={anchor ?? chips} {...props} />
  )
}

export {
  Combobox,
  ComboboxChip,
  ComboboxChipRemove,
  ComboboxChips,
  ComboboxClear,
  ComboboxCollection,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxGroupLabel,
  ComboboxInput,
  ComboboxInputGroup,
  ComboboxItem,
  ComboboxLabel,
  ComboboxList,
  ComboboxSeparator,
  ComboboxStatus,
  ComboboxTrigger,
  ComboboxValue,
}
export type { ComboboxContentProps }
