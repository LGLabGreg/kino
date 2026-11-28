'use client'

import {
  focusControl,
  InputInvalidIcon,
  inputBoxClassName,
  inputControlClassName,
} from '@/registry/components/kino/input'
import { selectTriggerVariants } from '@/registry/components/kino/select'
import { IconPlaceholder } from '@/registry/icons/icon-placeholder'
import { followRows } from '@/registry/lib/highlight'
import {
  MenuHighlight,
  menuGutterClassName,
  menuLabelClassName,
  menuNoticeClassName,
  menuRowVariants,
  menuSeparatorClassName,
} from '@/registry/lib/list-rows'
import {
  PanelHandle,
  panelSheetBackdropClassName,
  popupSheetClassName,
  popupSheetPanelClassName,
} from '@/registry/lib/panel'
import {
  popupGrowBoxClassName,
  popupGrowContentClassName,
  popupPlacedClassName,
  popupSurfaceClassName,
} from '@/registry/lib/popup'
import { followHeight } from '@/registry/lib/resize'
import { edgeFadeClassName } from '@/registry/lib/scroll'
import { matchRanges, matchSegments } from '@ui-sdk/core/text-match'
import { type PartProps, renderElement } from '@ui-sdk/react/primitive'
import { type ComponentProps, type ReactNode, useEffect, useRef } from 'react'

import { cn } from '@/lib/utils'

/*
 * The look the lists with an input share: the Combobox, the Autocomplete and
 * what sits on them. ui-sdk filters, highlights and picks; this is the field,
 * the box that grows out of it and moves to the height of what still
 * matches, its rows, and the one highlight that glides between them.
 */

/**
 * The field: the input and the buttons beside it, in the box every text
 * control has. The list opens under it and is as wide as it.
 */
function FilterListInputGroup({
  className,
  children,
  render,
  ...props
}: Omit<PartProps<'div'>, 'className' | 'children'> & {
  className?: string
  children?: ReactNode
}) {
  return renderElement(
    'div',
    {
      onPointerDown: focusControl,
      className: cn(
        inputBoxClassName,
        // The buttons sit at the end, after the invalid mark, 4px from the edge.
        'cursor-text gap-0.5 has-[>button]:pe-1',
        className,
      ),
      ...props,
      children: (
        <>
          {children}
          <InputInvalidIcon className='group-has-[>button]/input:pe-1' />
        </>
      ),
    },
    render,
  )
}

/**
 * The text you type. In a field it fills the room left; inside the list's
 * box, at its top or in a sheet's header, it is the box's search line.
 */
const filterListInputClassName = cn(
  inputControlClassName,
  'in-data-filter-list-content:h-(--control-height-lg) in-data-filter-list-content:flex-none in-data-filter-list-content:border-b in-data-filter-list-content:px-[calc(var(--control-padding)+0.25rem)] in-data-filter-list-content:focus-visible:border-ring',
)

/** A small icon button at the end of the field. */
const filterListButtonClassName = 'text-muted-foreground order-last'

function FilterListClearIcon() {
  return (
    <IconPlaceholder
      lucide='XIcon'
      tabler='IconX'
      hugeicons='Cancel01Icon'
      phosphor='XIcon'
      remixicon='RiCloseLine'
      aria-hidden
    />
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

/** A trigger with the value inside, for a list whose search sits at its top: it looks like a select. */
const filterListValueTriggerClassName = selectTriggerVariants()

/** What a trigger with the value inside shows, before its invalid mark and chevron. */
function FilterListValue({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <>
      {/* A bare label truncates; an icon and a label sit in a row, the label in a span that truncates. */}
      <span
        id={id}
        data-slot='filter-list-value'
        data-cut
        className='flex min-w-0 flex-1 items-center gap-2 truncate in-data-placeholder:text-muted-foreground [&>span:not([data-slot])]:min-w-0 [&>span:not([data-slot])]:truncate'
      >
        {children}
      </span>
      <InputInvalidIcon className='-me-1 pe-0' />
      <FilterListChevron />
    </>
  )
}

/** The scroller around a list's rows: thin, its own scroll only, its edges fading (`useEdgeFades`). */
const filterListScrollerClassName = cn(
  'scrollbar-thin relative min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain',
  edgeFadeClassName,
)

/**
 * A list's rows and the highlight that glides between them, to where ui-sdk
 * highlights. Its parent is the scroller, inside a box marked
 * `data-filter-list-content`.
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
        // padding, so it stays the same at every density. With no rows, it
        // takes no room, so the notice sits alone.
        'group/menu relative flex flex-col p-1 [&:not(:has([data-menu-row]))]:p-0',
        menuGutterClassName,
        className,
      )}
    >
      <MenuHighlight ref={layerRef} />
      {children}
    </div>
  )
}

/**
 * A row: the menus' own. Rows out of view skip style, layout and paint, so a
 * list of every country opens at once. A skipped row keeps its own height:
 * the intrinsic size is its content's, inside its `py-1`, or the list opens a
 * row too tall, shrinks, and a long one flips to the other side as it does.
 */
const filterListItemClassName = cn(
  menuRowVariants(),
  'group/menu-row [contain-intrinsic-size:auto_calc(var(--control-height-sm)-0.5rem)] [content-visibility:auto]',
)

/** The marked part of a row's text, the part that matched what was typed. */
const filterListMatchClassName =
  'min-w-0 [&_mark]:bg-transparent [&_mark]:font-semibold [&_mark]:text-current'

/** How a query matches a row's text: from the start of a word, anywhere, or as ui-sdk's matchRanges reads it. */
type MatchMode = Parameters<typeof matchRanges>[2]

/**
 * `children` with the parts that match `query` in bold, so the eye finds why
 * a row matched: for a list that filters rows of its own, as ui-sdk's lists
 * mark theirs. With no query or no `mode`, the text as it is.
 */
function MatchText({
  query,
  mode = 'contains',
  className,
  children,
  ...props
}: Omit<ComponentProps<'span'>, 'children'> & {
  children: string
  query: string
  mode?: MatchMode | null
}) {
  const segments =
    query && mode ? matchSegments(children, matchRanges(children, query, mode)) : []
  return (
    <span className={cn(filterListMatchClassName, className)} {...props}>
      {segments.length > 0
        ? segments.map((segment, at) =>
            segment.match ? <mark key={at}>{segment.text}</mark> : segment.text,
          )
        : children}
    </span>
  )
}

const filterListGroupLabelClassName = menuLabelClassName
const filterListSeparatorClassName = menuSeparatorClassName
const filterListNoticeClassName = menuNoticeClassName

/**
 * The popup's own element, placed by ui-sdk, as wide as what is in it. As a
 * sheet, it is the panel, as wide as the screen up to 40rem, and the input
 * sits in its header.
 */
function filterListContentClassName({
  presentation,
}: {
  presentation: 'popover' | 'sheet'
}) {
  return cn(
    popupPlacedClassName,
    panelSheetBackdropClassName,
    popupSheetClassName,
    'flex max-w-(--available-width) flex-col text-sm',
    // ui-sdk puts the input in a header of its own inside the content, so the content is the panel.
    presentation === 'sheet' && popupSheetPanelClassName,
  )
}

/**
 * What goes in the popup: in a box that grows out of the field and moves to
 * the height of what it holds, or under a sheet's handle.
 */
function FilterListBody({
  presentation,
  className,
  children,
}: {
  presentation: 'popover' | 'sheet'
  className?: string
  children: ReactNode
}) {
  if (presentation === 'sheet') {
    return (
      <>
        {/* Above the header ui-sdk puts the input in. */}
        <PanelHandle className='-order-1' />
        <div className={cn('flex min-h-0 flex-1 flex-col', className)}>{children}</div>
      </>
    )
  }
  return (
    <div
      className={cn(
        'relative rounded-(--list-radius)',
        popupSurfaceClassName,
        popupGrowBoxClassName,
      )}
    >
      <FilterListFrame className={className}>{children}</FilterListFrame>
    </div>
  )
}

/*
 * The frame moves to the content's height, and the box grows with it. Inside
 * the popup, so its refs are set: ui-sdk renders it only while it is open.
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
    const stops = [
      holdRowsAsItCloses(frameRef.current, innerRef.current),
      keepHighlightInView(innerRef.current),
    ]
    return () => {
      for (const stop of stops) stop()
    }
  }, [])
  return (
    <div
      ref={frameRef}
      className='overflow-clip rounded-[inherit] transition-[height] duration-(--motion-layout-duration) ease-(--motion-layout-easing) motion-reduce:transition-none'
    >
      <div
        ref={innerRef}
        className={cn(
          // As wide as what it opens from, never narrower than a name and its
          // tick; a long list stops at 24rem, so it never fills a tall screen.
          'flex max-h-[min(var(--popup-available-height),24rem)] w-(--anchor-width) max-w-(--popup-available-width) min-w-56 flex-col',
          // As it closes, only the rows it showed (`holdRowsAsItCloses`).
          'data-holding:[&_[role=group]:not([data-held])]:hidden data-holding:[&_[role=option]:not([data-held])]:hidden data-holding:[&_[role=separator]:not([data-held])]:hidden',
          popupGrowContentClassName,
          className,
        )}
      >
        {children}
      </div>
    </div>
  )
}

/*
 * The frame follows the rows' height while the list is open. As it closes,
 * ui-sdk empties the filter, which would bring every row back while the box
 * fades: the rows it showed stay, and no other shows, until it has gone or
 * opens again, and so does the line saying nothing matches. Each row is
 * marked while it shows with the list open, since ui-sdk shows the rows
 * again in the same task that closes it. Kept outside the
 * component: the React Compiler can drop side effects written inside one.
 */
function holdRowsAsItCloses(frame: HTMLElement, rows: HTMLElement) {
  const content = frame.closest<HTMLElement>('[data-presentation]')
  let stop: (() => void) | null = followHeight(frame, rows)
  if (!content) return () => stop?.()
  // What the line saying nothing matches said while the list was open.
  let said: Node[] = []
  const notice = () => rows.querySelector<HTMLElement>('[data-slot$="-empty"]')
  const mark = () => {
    const closed = content.hasAttribute('data-closed')
    rows.toggleAttribute('data-holding', closed)
    if (closed) {
      stop?.()
      stop = null
      // ui-sdk empties the line too: a copy of what it said stays, unread.
      const empty = notice()
      if (
        empty &&
        said.length > 0 &&
        !empty.textContent?.trim() &&
        !empty.querySelector('[data-held-copy]')
      ) {
        const copy = document.createElement('span')
        copy.dataset.heldCopy = ''
        copy.setAttribute('aria-hidden', 'true')
        copy.className = 'contents'
        copy.append(...said.map((node) => node.cloneNode(true)))
        empty.append(copy)
      }
      return
    }
    for (const copy of rows.querySelectorAll('[data-held-copy]')) copy.remove()
    const empty = notice()
    said = empty?.textContent?.trim()
      ? [...empty.childNodes].map((node) => node.cloneNode(true))
      : []
    for (const row of rows.querySelectorAll<HTMLElement>(
      '[role=group], [role=option], [role=separator]',
    )) {
      row.toggleAttribute('data-held', !row.hidden)
    }
    stop ??= followHeight(frame, rows)
  }
  mark()
  const watch = new MutationObserver(mark)
  watch.observe(content, {
    attributes: true,
    attributeFilter: ['data-closed', 'hidden'],
    characterData: true,
    childList: true,
    subtree: true,
  })
  return () => {
    watch.disconnect()
    stop?.()
  }
}

/*
 * ui-sdk scrolls the highlighted row into view as the list opens, but rows
 * out of view take their real height only once drawn
 * (`filterListItemClassName`), so a long list, such as every country, moves
 * its picked row on as it settles. Until the person scrolls or a moment has
 * passed, the row is kept in view.
 */
function keepHighlightInView(rows: HTMLElement) {
  const scroller = rows.querySelector<HTMLElement>('[role=listbox]')?.parentElement
  if (!scroller) return () => {}
  const keep = () =>
    rows
      .querySelector<HTMLElement>('[role=option][data-highlighted]')
      ?.scrollIntoView({ block: 'nearest' })
  const sizes = new ResizeObserver(keep)
  for (const list of rows.querySelectorAll('[role=listbox] > *')) sizes.observe(list)
  const stop = () => {
    sizes.disconnect()
    clearTimeout(timer)
    for (const type of ['wheel', 'touchstart', 'pointerdown'] as const)
      scroller.removeEventListener(type, stop)
  }
  const timer = setTimeout(stop, 1000)
  for (const type of ['wheel', 'touchstart', 'pointerdown'] as const)
    scroller.addEventListener(type, stop, { passive: true })
  return stop
}

export {
  FilterListBody,
  FilterListChevron,
  FilterListClearIcon,
  FilterListInputGroup,
  FilterListRows,
  FilterListValue,
  MatchText,
  filterListButtonClassName,
  filterListContentClassName,
  filterListGroupLabelClassName,
  filterListInputClassName,
  filterListItemClassName,
  filterListMatchClassName,
  filterListNoticeClassName,
  filterListScrollerClassName,
  filterListSeparatorClassName,
  filterListValueTriggerClassName,
}
export type { MatchMode }
