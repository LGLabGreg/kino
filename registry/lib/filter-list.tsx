'use client'

import { Button } from '@/registry/components/kino/button'
import {
  fieldClearClassName,
  focusControl,
  InputInvalidIcon,
  inputBoxClassName,
  inputControlClassName,
} from '@/registry/components/kino/input'
import { selectTriggerVariants } from '@/registry/components/kino/select'
import { IconPlaceholder } from '@/registry/icons/icon-placeholder'
import { CutTooltip } from '@/registry/lib/cut'
import { followRows } from '@/registry/lib/highlight'
import { matchRange } from '@/registry/lib/match'
import {
  MenuHighlight,
  menuIndicatorClassName,
  menuIndicatorSlot,
  menuLabelClassName,
  menuNoticeClassName,
  menuRowVariants,
  menuSeparatorClassName,
  MenuTick,
} from '@/registry/lib/menu'
import {
  popupGrowClassName,
  popupGrowContentClassName,
  popupPositionerProps,
  popupSurfaceClassName,
  usePopupGrow,
} from '@/registry/lib/popup'
import { mergeRefs } from '@/registry/lib/refs'
import { followHeight } from '@/registry/lib/resize'
import { edgeFadeClassName, useEdgeFades } from '@/registry/lib/scroll'
import { Combobox as FilterListPrimitive } from '@base-ui/react/combobox'
import {
  type ComponentProps,
  createContext,
  type ReactNode,
  use,
  useEffect,
  useId,
  useMemo,
  useRef,
} from 'react'

import { cn } from '@/lib/utils'

/*
 * The parts Combobox and Autocomplete share, as Base UI's do: the field, the
 * box that grows out of it and moves to the height of what still matches,
 * its rows, and the one highlight that glides between them.
 */

/**
 * The field: the input and the buttons beside it, in the box every text
 * control has. The list opens under it and is as wide as it.
 */
function FilterListInputGroup({
  className,
  children,
  ...props
}: Omit<FilterListPrimitive.InputGroup.Props, 'className'> & {
  className?: string
}) {
  return (
    <FilterListPrimitive.InputGroup
      onPointerDown={focusControl}
      className={cn(
        inputBoxClassName,
        // The buttons sit at the end, after the invalid mark, 4px from the edge.
        'cursor-text gap-0.5 has-[>button]:pe-1',
        className,
      )}
      {...props}
    >
      {children}
      <InputInvalidIcon className='group-has-[>button]/input:pe-1' />
    </FilterListPrimitive.InputGroup>
  )
}

/**
 * The text you type. In a field it fills the room left; at the top of the
 * list's box it is the box's search line.
 */
function FilterListInput({
  className,
  ...props
}: Omit<FilterListPrimitive.Input.Props, 'className'> & {
  className?: string
}) {
  return (
    <FilterListPrimitive.Input
      className={cn(
        inputControlClassName,
        // In the box: a line of its own above the rows.
        'in-data-filter-list-content:flex-none in-data-filter-list-content:border-b in-data-filter-list-content:px-[calc(var(--control-padding)+0.25rem)] in-data-filter-list-content:focus-visible:border-ring',
        className,
      )}
      {...props}
    />
  )
}

/** A small icon button at the end of the field. */
const fieldButtonClassName = 'text-muted-foreground order-last'

/** Empties the field; it shows only while there is something to clear. */
function FilterListClear({
  className,
  children,
  ...props
}: Omit<FilterListPrimitive.Clear.Props, 'className'> & {
  className?: string
}) {
  return (
    <FilterListPrimitive.Clear
      data-field-clear=''
      aria-label='Clear'
      render={
        <Button
          variant='ghost'
          size='icon-xs'
          className={cn(
            fieldButtonClassName,
            // Nothing to clear in a field you can't change.
            'in-data-disabled:hidden in-data-readonly:hidden',
            fieldClearClassName,
            className,
          )}
        />
      }
      {...props}
    >
      {children ?? (
        <IconPlaceholder
          lucide='XIcon'
          tabler='IconX'
          hugeicons='Cancel01Icon'
          phosphor='XIcon'
          remixicon='RiCloseLine'
          aria-hidden
        />
      )}
    </FilterListPrimitive.Clear>
  )
}

function FilterListChevron() {
  return (
    <IconPlaceholder
      lucide='ChevronDownIcon'
      tabler='IconChevronDown'
      hugeicons='ArrowDown01Icon'
      phosphor='CaretDownIcon'
      remixicon='RiArrowDownSLine'
      aria-hidden
    />
  )
}

/**
 * Opens the list. In a field it is the chevron at its end. On its own, with
 * the value inside, it is a button that looks like a select, for a list
 * whose search sits at its top.
 */
function FilterListTrigger({
  className,
  children,
  ...props
}: Omit<FilterListPrimitive.Trigger.Props, 'className'> & {
  className?: string
  children?: ReactNode
}) {
  const id = useId()
  if (children === undefined) {
    return (
      <FilterListPrimitive.Trigger
        id={id}
        aria-label='Show options'
        // Base UI names it after the field's label, which the input already
        // carries: named after itself, it says what it does.
        aria-labelledby={id}
        render={
          <Button
            variant='ghost'
            size='icon-xs'
            className={cn(
              fieldButtonClassName,
              // Base UI marks it invalid with its field, which shows the error already.
              'aria-invalid:border-transparent aria-invalid:ring-0 dark:aria-invalid:border-transparent dark:aria-invalid:ring-0 forced-colors:aria-invalid:outline-0',
              className,
            )}
          />
        }
        {...props}
      >
        <FilterListChevron />
      </FilterListPrimitive.Trigger>
    )
  }
  return (
    <CutTooltip
      render={
        <FilterListPrimitive.Trigger
          className={cn(selectTriggerVariants(), className)}
          {...props}
        >
          {/* A bare label truncates; an icon and a label sit in a row. */}
          <span
            data-slot='filter-list-value'
            data-cut
            className='flex min-w-0 flex-1 items-center gap-2 truncate in-data-placeholder:text-muted-foreground'
          >
            {children}
          </span>
          <InputInvalidIcon className='-me-1 pe-0' />
          <FilterListChevron />
        </FilterListPrimitive.Trigger>
      }
    />
  )
}

/**
 * The rows, with the highlight that glides between them. Give it a function
 * child, called for each item that matches what was typed, or rows and
 * groups of your own. It scrolls once it is taller than the box allows.
 */
function FilterListList({
  className,
  children,
  ref,
  ...props
}: Omit<FilterListPrimitive.List.Props, 'className'> & { className?: string }) {
  const fades = useEdgeFades<HTMLDivElement>()
  const listRef = useMemo(() => mergeRefs(ref, fades), [ref, fades])
  return (
    <FilterListPrimitive.List
      ref={listRef}
      className={cn(filterListScrollerClassName, 'group-data-empty/popup:hidden')}
      {...props}
    >
      <FilterListRows className={className}>
        {typeof children === 'function' ? (
          <FilterListPrimitive.Collection>{children}</FilterListPrimitive.Collection>
        ) : (
          children
        )}
      </FilterListRows>
    </FilterListPrimitive.List>
  )
}

/** The scroller around a list's rows: thin, its own scroll only, its edges fading (`useEdgeFades`). */
const filterListScrollerClassName = cn(
  'scrollbar-thin min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain',
  edgeFadeClassName,
)

/**
 * A list's rows and the highlight that glides between them. Its parent is
 * the scroller, inside a box marked `data-filter-list-content`.
 */
function FilterListRows({
  className,
  children,
}: {
  className?: string
  children?: ReactNode
}) {
  const rowsRef = useRef<HTMLDivElement>(null)
  const layerRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const rows = rowsRef.current
    const list = rows?.parentElement
    const popup = list?.closest<HTMLElement>('[data-filter-list-content]')
    if (!rows || !list || !popup || !layerRef.current) return
    return followRows(rows, layerRef.current, { popup, bounds: list })
  }, [])
  return (
    <div
      ref={rowsRef}
      data-slot='filter-list-rows'
      className={cn(
        // The 4px around the rows is the highlight's margin, not a surface's
        // padding, so it stays the same at every density.
        'group/menu relative flex flex-col p-1',
        className,
      )}
    >
      <MenuHighlight ref={layerRef} />
      {children}
    </div>
  )
}

/**
 * `text` with the part that matches `query` in bold, as the list filters
 * it, so the eye finds why a row matched.
 */
function FilterListMatchedText({ text, query }: { text: string; query: string }) {
  const range = matchRange(text, query, use(MatchLocaleContext))
  if (!range) return text
  const [start, end] = range
  return (
    <>
      {text.slice(0, start)}
      <mark className='bg-transparent font-semibold text-current'>
        {text.slice(start, end)}
      </mark>
      {text.slice(end)}
    </>
  )
}

/**
 * A row: the menus' own. `indicator` keeps room for the picked row's tick first, as on the
 * Select; a list that picks nothing leaves it out.
 */
function FilterListItem({
  className,
  children,
  indicator = false,
  ...props
}: Omit<FilterListPrimitive.Item.Props, 'className'> & {
  className?: string
  /** Whether the row keeps room for the tick of a picked value. */
  indicator?: boolean
}) {
  return (
    <FilterListPrimitive.Item
      data-menu-row=''
      className={cn(
        menuRowVariants(),
        // Rows out of view skip style, layout and paint, so a list of every country opens at once.
        'group/menu-row [contain-intrinsic-size:auto_var(--control-height-sm)] [content-visibility:auto]',
        className,
      )}
      {...props}
    >
      {indicator ? (
        <span data-menu-indicator='' className={menuIndicatorSlot}>
          <FilterListPrimitive.ItemIndicator className={menuIndicatorClassName}>
            <MenuTick />
          </FilterListPrimitive.ItemIndicator>
        </span>
      ) : null}
      <span className='flex min-w-0 flex-1 items-center gap-2'>{children}</span>
    </FilterListPrimitive.Item>
  )
}

function FilterListGroupLabel({
  className,
  ...props
}: Omit<FilterListPrimitive.GroupLabel.Props, 'className'> & {
  className?: string
}) {
  return (
    <FilterListPrimitive.GroupLabel
      className={cn(menuLabelClassName, className)}
      {...props}
    />
  )
}

function FilterListSeparator({
  className,
  ...props
}: Omit<FilterListPrimitive.Separator.Props, 'className'> & {
  className?: string
}) {
  return (
    <FilterListPrimitive.Separator
      className={cn(menuSeparatorClassName, className)}
      {...props}
    />
  )
}

/** What shows when nothing matches: say what was looked for. */
function FilterListEmpty({
  className,
  ...props
}: Omit<FilterListPrimitive.Empty.Props, 'className'> & {
  className?: string
}) {
  return (
    <FilterListPrimitive.Empty
      className={cn(menuNoticeClassName, className)}
      {...props}
    />
  )
}

/** Announces a search that is running, or how many results it found. */
function FilterListStatus({
  className,
  ...props
}: Omit<FilterListPrimitive.Status.Props, 'className'> & {
  className?: string
}) {
  return (
    <FilterListPrimitive.Status
      className={cn(menuNoticeClassName, className)}
      {...props}
    />
  )
}

type FilterListContentProps = Omit<FilterListPrimitive.Popup.Props, 'className'> & {
  className?: string
} & Pick<
    FilterListPrimitive.Positioner.Props,
    'side' | 'align' | 'sideOffset' | 'alignOffset' | 'anchor'
  > &
  Pick<ComponentProps<'div'>, 'children'>

/*
 * The frame moves to the content's height, and the box grows with it. Inside
 * the popup, so its refs are set: Base UI renders nothing in the portal while
 * the list is closed.
 */
function FilterListFrame({
  className,
  children,
}: {
  className?: string
  children: ReactNode
}) {
  const frameRef = useRef<HTMLDivElement>(null)
  const innerRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!frameRef.current || !innerRef.current) return
    return followHeight(frameRef.current, innerRef.current)
  }, [])
  return (
    <div
      ref={frameRef}
      className='overflow-clip rounded-[inherit] transition-[height] duration-(--motion-layout-duration) ease-(--motion-layout-easing) motion-reduce:transition-none'
    >
      <div
        ref={innerRef}
        className={cn(
          // A long list stops at 24rem, so it never fills a tall screen.
          'flex max-h-[min(var(--available-height),24rem)] flex-col',
          popupGrowContentClassName,
          className,
        )}
      >
        {children}
      </div>
    </div>
  )
}

/**
 * The box, under the field or the trigger. `className` goes on the box's
 * content; every other prop goes to Base UI's Popup.
 */
function FilterListContent({
  className,
  children,
  style,
  side = 'bottom',
  align = 'start',
  sideOffset = 6,
  alignOffset = 0,
  anchor,
  ...props
}: FilterListContentProps) {
  const { dir, style: growStyle, anchor: anchorProps } = usePopupGrow()
  return (
    <FilterListPrimitive.Portal>
      <FilterListPrimitive.Positioner
        {...popupPositionerProps}
        side={side}
        align={align}
        sideOffset={sideOffset}
        alignOffset={alignOffset}
        anchor={anchor}
      >
        <FilterListPrimitive.Popup
          data-filter-list-content=''
          // Portalled out of the page's tree, so it takes the reading direction with it.
          dir={dir}
          style={(state) => ({
            ...growStyle(state),
            ...(typeof style === 'function' ? style(state) : style),
          })}
          className={cn(
            // As wide as the field, and never narrower than a name and its tick.
            'group/popup relative w-(--anchor-width) max-w-(--available-width) min-w-56 rounded-(--list-radius) text-sm',
            popupSurfaceClassName,
            popupGrowClassName,
          )}
          {...props}
        >
          <FilterListFrame className={className}>{children}</FilterListFrame>
          <FilterListPrimitive.Arrow {...anchorProps} />
        </FilterListPrimitive.Popup>
      </FilterListPrimitive.Positioner>
    </FilterListPrimitive.Portal>
  )
}

/** The `locale` the list matches in, as its root was given it, for the text that marks a match. */
const MatchLocaleContext = createContext<Intl.LocalesArgument>(undefined)

export {
  FilterListChevron,
  FilterListClear,
  FilterListContent,
  FilterListEmpty,
  FilterListFrame,
  FilterListGroupLabel,
  FilterListInput,
  FilterListInputGroup,
  FilterListItem,
  FilterListList,
  FilterListMatchedText,
  FilterListRows,
  FilterListSeparator,
  FilterListStatus,
  FilterListTrigger,
  filterListScrollerClassName,
  MatchLocaleContext,
}
export type { FilterListContentProps }
