'use client'

import { Button } from '@/registry/components/kino/button'
import { Dialog, DialogContent, DialogTitle } from '@/registry/components/kino/dialog'
import {
  searchLineClassName,
  searchLineIcon,
  searchLineInputClassName,
} from '@/registry/components/kino/input'
import { IconPlaceholder } from '@/registry/icons/icon-placeholder'
import { CutTooltip } from '@/registry/lib/cut'
import {
  FilterListEmpty,
  FilterListGroupLabel,
  FilterListItem,
  FilterListList,
  FilterListSeparator,
  filterListScrollerClassName,
  FilterListStatus,
} from '@/registry/lib/filter-list'
import { leaveAsCopy } from '@/registry/lib/flow'
import { MenuShortcut } from '@/registry/lib/menu'
import { panelFooterTint } from '@/registry/lib/panel'
import { followHeight, withoutTransition } from '@/registry/lib/resize'
import { useEdgeFades } from '@/registry/lib/scroll'
import { Swap } from '@/registry/lib/swap'
import { Autocomplete as CommandPrimitive } from '@base-ui/react/autocomplete'
import {
  type ComponentProps,
  createContext,
  type ReactElement,
  type ReactNode,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'

import { cn } from '@/lib/utils'

/*
 * A command menu: Base UI's Autocomplete, always open, with its list in line
 * under the search, on its own or in a dialog. The rows, groups and the one
 * highlight that glides between them are the filter-list lib's, as on the
 * Combobox and the Autocomplete. A command that needs a choice opens a page:
 * its name sits at the start of the search, and Escape or Backspace on an
 * empty search goes back. Pages are a stack: a new page pushes the one before
 * it out across the start edge, and going back pulls it in again. The box
 * moves to the height of what matches.
 */

interface CommandContextValue {
  pages: readonly string[]
  back: (() => void) | undefined
  query: string
  setQuery: (query: string) => void
  /** The pages have changed since the menu opened: a page that mounts now arrives. */
  moved: boolean
}

const CommandContext = createContext<CommandContextValue | null>(null)

function useCommand() {
  const context = useContext(CommandContext)
  if (!context) throw new Error('Command parts must be inside <Command>.')
  return context
}

type CommandProps<Item> = Omit<
  CommandPrimitive.Root.Props<Item>,
  'inline' | 'open' | 'value' | 'defaultValue' | 'onValueChange'
> & {
  className?: string
  /**
   * The pages opened from the first one, as their names: `['Assign to']`.
   * Each new page starts with an empty search and its first row highlighted.
   */
  pages?: readonly string[]
  /** The first page's name, announced when the person goes back to it. */
  label?: string
  /** Called when the person goes back a page: Escape or Backspace on an empty search, or the page's name. */
  onBack?: () => void
  /** The search, when you hold it: empty it when you change `pages`. */
  value?: string
  /** The search to begin with. */
  defaultValue?: string
  /** Called when the search changes. */
  onValueChange?: (value: string) => void
  children?: ReactNode
}

/**
 * The menu. Give it the current page's `items`, as Base UI's Autocomplete
 * takes them. Picking a row runs its `onClick`, from a click or Enter.
 */
function Command<Item>({
  className,
  items,
  pages = [],
  label = 'Commands',
  onBack,
  value,
  defaultValue = '',
  onValueChange,
  children,
  ...props
}: CommandProps<Item>) {
  const [ownQuery, setOwnQuery] = useState(defaultValue)
  const query = value ?? ownQuery
  function setQuery(next: string) {
    if (next === query) return
    setOwnQuery(next)
    onValueChange?.(next)
  }
  const page = pages.join('\u0000')
  // The page last seen, and whether it has changed since the menu opened:
  // a menu that opens on a page doesn't play a move.
  const [seen, setSeen] = useState({ page, moved: false })
  // Base UI keeps the highlighted row's index when the items change, so a
  // new page would open on the row the last one had: for one render it gets
  // no items, which lets the highlight go, and then the page's own, whose
  // first row it highlights. Both land before the page is painted.
  const [emptied, setEmptied] = useState<{ cleared: boolean } | null>(null)
  if (page !== seen.page) {
    setSeen({ page, moved: true })
    setOwnQuery('')
    setEmptied({ cleared: query !== '' && value === undefined })
  }
  useLayoutEffect(() => {
    if (!emptied) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the second of two renders Base UI needs, before the page is painted
    setEmptied(null)
    if (emptied.cleared) onValueChange?.('')
  }, [emptied, onValueChange])
  return (
    <CommandRoot
      inline
      open
      autoHighlight='always'
      keepHighlight
      value={query}
      onValueChange={setQuery}
      items={emptied ? [] : items}
      {...props}
    >
      <CommandContext.Provider
        value={{
          pages,
          back: onBack,
          query,
          setQuery,
          moved: seen.moved,
        }}
      >
        <div
          data-slot='command'
          // The filter-list lib’s rows look for the box they sit in, and their
          // highlight follows it while it is open, which a menu always is.
          data-filter-list-content=''
          data-open=''
          // In a dialog, its footer stays on the dialog's bottom edge as the height changes.
          data-panel='parts'
          className={cn(
            'group/command bg-popover text-popover-foreground relative flex min-w-0 flex-col overflow-clip rounded-(--surface-radius) text-sm ring-1 ring-foreground/10 forced-colors:outline',
            panelFooterTint,
            // In a dialog, the dialog is the box.
            'in-data-[slot=dialog-content]:rounded-none in-data-[slot=dialog-content]:bg-transparent in-data-[slot=dialog-content]:ring-0 in-data-[slot=dialog-content]:forced-colors:outline-0',
            className,
          )}
        >
          {children}
          {/* Says which page opened, since a name change on the search isn't read out. */}
          <div role='status' className='sr-only'>
            {seen.moved ? (pages.at(-1) ?? label) : null}
          </div>
        </div>
      </CommandContext.Provider>
    </CommandRoot>
  )
}

/*
 * Base UI types its Root as two overloads, one for groups and one for a flat
 * list, so props that may hold either fit neither: this is its own Props type.
 */
const CommandRoot = CommandPrimitive.Root as <Item>(
  props: CommandPrimitive.Root.Props<Item>,
) => ReactElement

/** The current page's name: a press on it goes back. */
function CommandPageName({ page }: { page: string }) {
  const { back } = useCommand()
  // The button goes with its page, so focus goes back to the search first.
  function goBack(event: { currentTarget: HTMLElement }) {
    event.currentTarget
      .closest('[data-slot=command]')
      ?.querySelector<HTMLElement>('[data-slot=command-input]')
      ?.focus()
    back?.()
  }
  return (
    <CutTooltip
      render={
        <Button
          variant='secondary'
          size='xs'
          data-command-back=''
          onClick={goBack}
          onKeyDown={(event) => {
            // As from the search: Escape goes back a page, not out of the dialog.
            if (event.key !== 'Escape' && event.key !== 'Backspace') return
            event.preventDefault()
            event.stopPropagation()
            goBack(event)
          }}
          className='min-w-0'
        >
          <IconPlaceholder
            lucide='ChevronLeftIcon'
            tabler='IconChevronLeft'
            hugeicons='ArrowLeft01Icon'
            phosphor='CaretLeftIcon'
            remixicon='RiArrowLeftSLine'
            data-icon='inline-start'
            aria-hidden
            className='rtl:-scale-x-100'
          />
          <span className='sr-only'>Back from </span>
          <span data-cut className='truncate'>
            {page}
          </span>
        </Button>
      }
    />
  )
}

/**
 * What a key does in the search before Base UI sees it, or nothing. Escape
 * empties a search first, then goes back a page, and only then is left to
 * close the dialog; Backspace on an empty search goes back.
 */
function searchKey(
  key: string,
  { query, depth }: { query: string; depth: number },
): 'clear' | 'back' | null {
  if (key === 'Escape') {
    if (query) return 'clear'
    return depth > 0 ? 'back' : null
  }
  if (key === 'Backspace' && !query && depth > 0) return 'back'
  return null
}

/**
 * The search, as the menu's first line. On a page it starts with the page's
 * name, which goes back when pressed.
 */
function CommandInput({
  className,
  onKeyDown,
  ...props
}: Omit<CommandPrimitive.Input.Props, 'className'> & { className?: string }) {
  const { pages, back, query, setQuery } = useCommand()
  const page = pages.at(-1)
  function keyDown(event: Parameters<NonNullable<typeof onKeyDown>>[0]) {
    onKeyDown?.(event)
    if (event.defaultPrevented || event.baseUIHandlerPrevented) return
    const action = searchKey(event.key, { query, depth: pages.length })
    if (!action) return
    // Base UI's Escape, and the dialog's, which closes where the document hears it.
    event.preventBaseUIHandler()
    event.preventDefault()
    event.stopPropagation()
    if (action === 'clear') setQuery('')
    else back?.()
  }
  return (
    <div data-slot='command-input-group' className={searchLineClassName}>
      {/* The search's icon gives way to the page's name, and back. */}
      <Swap align='start' className='-ms-1 max-w-[50%] shrink-0 ps-1'>
        {page ? <CommandPageName page={page} /> : searchLineIcon}
      </Swap>
      <CommandPrimitive.Input
        data-slot='command-input'
        onKeyDown={keyDown}
        className={cn(
          searchLineInputClassName,
          // Its forced-colours outline drawn inside, where the dialog's edge can't clip it.
          'forced-colors:-outline-offset-2',
          className,
        )}
        {...props}
      />
    </div>
  )
}

/**
 * The rows, with the highlight that glides between them. Give it a function
 * child, called for each group or item that matches the search. It scrolls
 * past 24rem. Inside a dialog the dialog follows the height; on a page the
 * list does. A page that shows something above its rows, such as an answer
 * or a preview, gives it as `lead`: the lead scrolls with its rows held
 * under it, and the page moves as one.
 */
function CommandList({
  className,
  lead,
  children,
  ref,
  ...props
}: ComponentProps<typeof FilterListList> & {
  /** What the page shows above its rows. */
  lead?: ReactNode
}) {
  const { pages, moved } = useCommand()
  const page = pages.join('\u0000')
  // Which way the last change of page went: on to a deeper page, or back.
  const [went, setWent] = useState({ depth: pages.length, back: false })
  if (went.depth !== pages.length)
    setWent({ depth: pages.length, back: pages.length < went.depth })
  const frameRef = useRef<HTMLDivElement>(null)
  const innerRef = useRef<HTMLDivElement>(null)
  const layerRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const frame = frameRef.current
    if (!frame || !innerRef.current) return
    if (frame.closest('[data-slot=dialog-content]')) return
    return followHeight(frame, innerRef.current)
  }, [])
  const list = (
    <FilterListList
      ref={ref}
      className={cn(
        'group-has-[[data-slot=command-empty]:not(:empty)]/command:hidden',
        className,
      )}
      {...props}
    >
      {children}
    </FilterListList>
  )
  return (
    <div
      ref={frameRef}
      data-slot='command-list-frame'
      data-page-direction={went.back ? 'back' : 'forward'}
      // Clipped at its bottom only on a page, where it follows the height: in
      // a dialog the dialog's own edge clips what leaves.
      className='group/pages relative overflow-x-clip not-in-data-[slot=dialog-content]:overflow-y-clip transition-[height] duration-(--motion-layout-duration) ease-(--motion-layout-easing) motion-reduce:transition-none'
    >
      <div
        ref={innerRef}
        className={cn(
          'flex flex-col',
          // A page that leads with its own content, such as an answer, takes more of the screen.
          lead ? 'max-h-[min(32rem,70dvh)]' : 'max-h-[min(24rem,60dvh)]',
        )}
      >
        {/*
         * A page of its own for each page of commands, around the list that
         * scrolls: it moves without the list scrolling sideways to follow its
         * highlighted row, and its highlight starts afresh on its first row.
         */}
        <div
          key={page}
          ref={pageMotion(layerRef, page)}
          data-slot='command-page'
          data-page={page}
          data-fresh={moved ? '' : undefined}
          className={pageClassName}
        >
          {lead ? <CommandLead lead={lead}>{list}</CommandLead> : list}
        </div>
      </div>
      <div
        ref={layerRef}
        aria-hidden
        className='pointer-events-none absolute inset-0 overflow-x-clip not-in-data-[slot=dialog-content]:overflow-y-clip'
      />
    </div>
  )
}

/** A page's lead, which scrolls in the room its rows leave, and its rows under it at their full height. */
function CommandLead({ lead, children }: { lead: ReactNode; children: ReactNode }) {
  const fades = useEdgeFades<HTMLDivElement>()
  return (
    <div
      data-slot='command-lead-page'
      className='flex min-h-0 flex-1 flex-col *:[[role=listbox]]:flex-none *:[[role=listbox]]:not-has-[[role=option]]:hidden'
    >
      {/* A highlight that lands on a row never scrolls what the lead shows. */}
      <div
        ref={fades}
        data-slot='command-lead-scroller'
        className={cn(filterListScrollerClassName, 'relative')}
      >
        <div data-slot='command-lead'>{lead}</div>
      </div>
      {children}
    </div>
  )
}

/*
 * Both pages move together on `layout`, the new one from the end edge going
 * on and from the start edge going back, and each fades as it travels, so a
 * shorter `--command-slide` (on the menu or anything above it) still reads as
 * one page giving way to the next. With less motion nothing travels: the new
 * page fades in and the old one goes at once.
 */
const pageClassName =
  'min-h-0 [--page-from:1] [--page-to:-1] rtl:[--page-sign:-1] group-data-[page-direction=back]/pages:[--page-from:-1] group-data-[page-direction=back]/pages:[--page-to:1] flex flex-col transition-[translate,opacity] duration-(--motion-layout-duration) ease-(--motion-layout-easing) data-fresh:starting:translate-x-[calc(var(--command-slide,100%)*var(--page-from)*var(--page-sign,1))] data-fresh:starting:opacity-0 data-leaving:translate-x-[calc(var(--command-slide,100%)*var(--page-to)*var(--page-sign,1))] data-leaving:opacity-0 motion-reduce:transition-opacity motion-reduce:data-fresh:starting:translate-x-0 motion-reduce:data-leaving:translate-x-0 motion-reduce:data-leaving:transition-none'

/*
 * How a page of commands gives way to the next. Base UI unmounts a page's rows the moment its
 * items change, so the old page leaves as a copy, through the flow lib's
 * `leaveAsCopy`, in a layer outside the list that scrolls. Kept outside
 * components: the React Compiler drops a forced reflow written inside one.
 */

/** The properties a page moves on. */
const MOVING = ['opacity', 'translate', 'scale'] as const

/** The values `element` is drawn with now, part way through a transition or not. */
function drawnNow(element: Element) {
  const style = getComputedStyle(element)
  return MOVING.map((property) => [property, style.getPropertyValue(property)] as const)
}

/** Puts `drawn` on `element`, and returns the properties it set. */
function hold(element: HTMLElement, drawn: ReturnType<typeof drawnNow>) {
  for (const [property, value] of drawn) element.style.setProperty(property, value)
  return drawn.map(([property]) => property)
}

/**
 * A ref for a page of commands. A page that arrives while a copy of it is
 * still leaving (a change turned round) takes over from where the copy is
 * drawn. A page that goes leaves as a copy in `layer`, from where it is
 * drawn; the copy goes once its leaving styles (`data-leaving`) have played.
 */
function pageMotion(layer: { current: HTMLElement | null }, key: string) {
  return (page: HTMLElement | null) => {
    if (!page) return
    const returning = layer.current?.querySelector<HTMLElement>(
      `:scope > [data-page="${CSS.escape(key)}"]`,
    )
    if (returning && page.hasAttribute('data-fresh')) {
      const drawn = drawnNow(returning)
      returning.remove()
      let held: string[] = []
      withoutTransition(page, () => {
        held = hold(page, drawn)
      })
      // Nothing is leaving now, so it turns back at once, with no wait.
      page.style.transitionDelay = '0s'
      for (const property of held) page.style.removeProperty(property)
    }
    return () => {
      if (layer.current) leavePage(page, layer.current)
    }
  }
}

/** What scrolls in a page: its rows, and its lead. */
const SCROLLERS = '[role=listbox], [data-slot=command-lead-scroller]'

function leavePage(page: HTMLElement, layer: HTMLElement) {
  // Read now, while the page is still laid out: once removed it has no box.
  const box = page.getBoundingClientRect()
  const area = layer.getBoundingClientRect()
  const drawn = drawnNow(page)
  const scrolled = [...page.querySelectorAll(SCROLLERS)].map((list) => list.scrollTop)
  // A ref let go but kept (React's second look in development), or a menu
  // that closed with its page, has nothing leaving.
  queueMicrotask(() => {
    if (page.isConnected || !layer.isConnected) return
    for (const node of page.querySelectorAll('[data-highlighted]'))
      node.removeAttribute('data-highlighted')
    page.removeAttribute('data-fresh')
    leaveAsCopy(page, {
      parent: layer,
      style: {
        insetInlineStart: '0',
        top: `${box.top - area.top}px`,
        width: `${box.width}px`,
        height: `${box.height}px`,
      },
      from: (copy) => {
        // A copy starts scrolled to the top: put its lists where they were.
        for (const [index, list] of copy.querySelectorAll(SCROLLERS).entries())
          list.scrollTo({ top: scrolled[index] ?? 0, behavior: 'instant' })
        return hold(copy, drawn).map((property) => [copy, property] as const)
      },
    })
  })
}

/** A group of rows, with its `items`, as Base UI's Autocomplete takes them. */
function CommandGroup(props: CommandPrimitive.Group.Props) {
  return <CommandPrimitive.Group data-slot='command-group' {...props} />
}

function CommandGroupLabel(props: ComponentProps<typeof FilterListGroupLabel>) {
  return <FilterListGroupLabel data-slot='command-group-label' {...props} />
}

const CommandCollection = CommandPrimitive.Collection

/** A command: the menus' row. Its `onClick` runs on a click or on Enter. */
function CommandItem(props: Omit<ComponentProps<typeof FilterListItem>, 'indicator'>) {
  return <FilterListItem data-slot='command-item' {...props} />
}

/** A command's shortcut, at the row's end: `Kbd` keys, as in the menus. */
function CommandShortcut(props: ComponentProps<typeof MenuShortcut>) {
  return <MenuShortcut data-slot='command-shortcut' {...props} />
}

function CommandSeparator(props: ComponentProps<typeof FilterListSeparator>) {
  return <FilterListSeparator data-slot='command-separator' {...props} />
}

/** What shows when nothing matches: say what was looked for. */
function CommandEmpty(props: ComponentProps<typeof FilterListEmpty>) {
  return <FilterListEmpty data-slot='command-empty' {...props} />
}

/** Announces a search that is running, or how many commands it found. */
function CommandStatus(props: ComponentProps<typeof FilterListStatus>) {
  return <FilterListStatus data-slot='command-status' {...props} />
}

/** The line under the rows, for the keys that work here. */
function CommandFooter({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot='command-footer'
      data-panel='footer'
      className={cn(
        // Its own tint, over a page that leaves, so the rows pass under it as the box resizes; it rides
        // the dialog's bottom edge on `layout`.
        'relative bg-(--panel-footer) transition-[translate] duration-(--motion-layout-duration) ease-(--motion-layout-easing) motion-reduce:transition-none',
        'text-muted-foreground flex min-h-(--control-height) shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-t px-[calc(var(--control-padding)+0.25rem)] py-1.5 text-xs',
        className,
      )}
      {...props}
    />
  )
}

/** A key and what it does, in the footer. */
function CommandHint({
  className,
  keys,
  children,
  ...props
}: ComponentProps<'span'> & { keys: ReactNode }) {
  return (
    <span
      data-slot='command-hint'
      className={cn('inline-flex items-center gap-1.5', className)}
      {...props}
    >
      {keys}
      {children}
    </span>
  )
}

/**
 * The menu in a dialog, high on the screen so the search stays where it is
 * as the rows below it come and go. `title` names it for screen readers.
 */
function CommandDialog({
  title = 'Command menu',
  className,
  contentProps,
  children,
  ...props
}: Omit<ComponentProps<typeof Dialog>, 'children'> & {
  title?: string
  className?: string
  /** Props for the dialog's popup, such as its own `data-*` attributes. */
  contentProps?: Omit<
    ComponentProps<typeof DialogContent>,
    'children' | 'className' | 'showCloseButton'
  >
  children?: ReactNode
}) {
  return (
    <Dialog {...props}>
      <DialogContent
        {...contentProps}
        showCloseButton={false}
        className={cn('sm:mt-[12vh] sm:mb-auto sm:max-w-xl', className)}
      >
        <DialogTitle className='sr-only'>{title}</DialogTitle>
        {children}
      </DialogContent>
    </Dialog>
  )
}

export {
  Command,
  CommandCollection,
  CommandDialog,
  CommandEmpty,
  CommandFooter,
  CommandGroup,
  CommandGroupLabel,
  CommandHint,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
  CommandStatus,
  searchKey,
}
export type { CommandProps }
