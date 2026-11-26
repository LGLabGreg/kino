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
  FilterListRows,
  filterListGroupLabelClassName,
  filterListItemClassName,
  filterListMatchClassName,
  filterListNoticeClassName,
  filterListScrollerClassName,
  filterListSeparatorClassName,
} from '@/registry/lib/filter-list'
import { leaveAsCopy } from '@/registry/lib/flow'
import { MenuShortcut } from '@/registry/lib/menu'
import { panelFooterTint } from '@/registry/lib/panel'
import { mergeRefs } from '@/registry/lib/refs'
import { followHeight, withoutTransition } from '@/registry/lib/resize'
import { useEdgeFades } from '@/registry/lib/scroll'
import { Swap } from '@/registry/lib/swap'
import {
  Command as CommandPrimitive,
  CommandEmpty as CommandEmptyPrimitive,
  CommandGroup as CommandGroupPrimitive,
  CommandGroupLabel as CommandGroupLabelPrimitive,
  CommandInput as CommandInputPrimitive,
  CommandItem as CommandItemPrimitive,
  CommandItemIcon as CommandItemIconPrimitive,
  CommandItemText as CommandItemTextPrimitive,
  CommandList as CommandListPrimitive,
  CommandPage as CommandPagePrimitive,
  type CommandProps as CommandPrimitiveProps,
  CommandSeparator as CommandSeparatorPrimitive,
  CommandShortcut as CommandShortcutPrimitive,
  CommandStatus as CommandStatusPrimitive,
  createCommandController,
} from '@ui-sdk/react/command'
import {
  type ComponentProps,
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import { cn } from '@/lib/utils'

/*
 * A command menu: ui-sdk's Command, its list in line under the search, on
 * its own or in a dialog. The rows, groups and the one highlight that glides
 * between them are the filter-list lib's, as on the Combobox and the
 * Autocomplete. A command that needs a choice opens a page (its `page`, a
 * `CommandPage`'s `value`, which is the page's name): the name sits at the
 * start of the search, and Escape or Backspace on an empty search goes back.
 * Pages are a stack: a new page pushes the one before it out across the
 * start edge, and going back pulls it in again. The box moves to the height
 * of what matches.
 */

interface CommandContextValue {
  pages: readonly string[]
  back: () => void
  /** The pages have changed since the menu opened: a page that mounts now arrives. */
  moved: boolean
}

const CommandContext = createContext<CommandContextValue | null>(null)

function useCommand() {
  const context = useContext(CommandContext)
  if (!context) throw new Error('Command parts must be inside <Command>.')
  return context
}

type CommandProps = Omit<CommandPrimitiveProps, 'className' | 'children'> & {
  className?: string
  children?: ReactNode
  /** The first page's name, announced when the person goes back to it. */
  label?: string
}

/**
 * The menu. It keeps the commands whose name or keywords hold what was
 * typed, as the Combobox does (`filter`), and the best match is highlighted,
 * so Enter runs it.
 * A command runs its `onSelect`, then the menu's `onAction`, from a click,
 * Enter or its shortcut.
 */
function Command({
  className,
  label = 'Commands',
  autoHighlight = true,
  filter = 'contains',
  pages,
  defaultPages = [],
  onPagesChange,
  controller,
  children,
  ...props
}: CommandProps) {
  const [ownPages, setOwnPages] = useState<string[]>(defaultPages)
  const shown = pages ?? ownPages
  const [ownController] = useState(createCommandController)
  const control = controller ?? ownController
  const page = shown.join('\u0000')
  // The page last seen, and whether it has changed since the menu opened:
  // a menu that opens on a page doesn't play a move.
  const [seen, setSeen] = useState({ page, moved: false })
  if (page !== seen.page) setSeen({ page, moved: true })
  const context = useMemo(
    () => ({ pages: shown, back: () => void control.pop(), moved: seen.moved }),
    [shown, control, seen.moved],
  )
  return (
    <CommandPrimitive
      controller={control}
      autoHighlight={autoHighlight}
      filter={filter}
      pages={shown}
      onPagesChange={(next, details) => {
        setOwnPages(next)
        onPagesChange?.(next, details)
      }}
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
      {...props}
    >
      <CommandContext value={context}>
        {children}
        {/* Says which page opened, since a name change on the search isn't read out. */}
        <div role='status' className='sr-only'>
          {seen.moved ? (shown.at(-1) ?? label) : null}
        </div>
      </CommandContext>
    </CommandPrimitive>
  )
}

/** The current page's name: a press on it goes back. */
function CommandPageName({ page }: { page: string }) {
  const { back } = useCommand()
  // The button goes with its page, so focus goes back to the search first.
  function goBack(event: { currentTarget: HTMLElement }) {
    event.currentTarget
      .closest('[data-slot=command]')
      ?.querySelector<HTMLElement>('[data-slot=command-input]')
      ?.focus()
    back()
  }
  return (
    <CutTooltip
      render={
        <Button
          variant='secondary'
          size='xs'
          data-command-back=''
          onClick={goBack}
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
 * The search, as the menu's first line. On a page it starts with the page's
 * name, which goes back when pressed. Escape empties a search first, then
 * goes back a page, and only then closes a dialog around it.
 */
function CommandInput({
  className,
  ...props
}: Omit<ComponentProps<typeof CommandInputPrimitive>, 'className'> & {
  className?: string
}) {
  const { pages } = useCommand()
  const page = pages.at(-1)
  return (
    <div data-command-input-group='' className={searchLineClassName}>
      {/* The search's icon gives way to the page's name, and back. */}
      <Swap align='start' className='-ms-1 max-w-[50%] shrink-0 ps-1'>
        {page ? <CommandPageName page={page} /> : searchLineIcon}
      </Swap>
      <CommandInputPrimitive
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
 * The rows, with the highlight that glides between them: `CommandPage`s,
 * groups and commands. It scrolls past 24rem. Inside a dialog the dialog
 * follows the height; on a page the list does. A page that shows something
 * above its rows, such as an answer or a preview, gives it as `lead`: the
 * lead scrolls with its rows held under it, and the page moves as one.
 */
function CommandList({
  className,
  lead,
  children,
  ref,
  ...props
}: Omit<ComponentProps<typeof CommandListPrimitive>, 'className' | 'children'> & {
  className?: string
  children?: ReactNode
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
  const fades = useEdgeFades<HTMLDivElement>()
  const listRef = useMemo(() => mergeRefs(ref, fades), [ref, fades])
  useEffect(() => {
    const frame = frameRef.current
    if (!frame || !innerRef.current) return
    if (frame.closest('[data-slot=dialog-content]')) return
    return followHeight(frame, innerRef.current)
  }, [])
  const list = (
    <CommandListPrimitive
      ref={listRef}
      className={cn(
        filterListScrollerClassName,
        // Collapsed rather than hidden while nothing matches, so the input's
        // aria-controls still names a listbox, as an expanded combobox must.
        'group-has-[[data-slot=command-empty][data-empty]]/command:max-h-0 group-has-[[data-slot=command-empty][data-empty]]/command:overflow-hidden',
      )}
      {...props}
    >
      <FilterListRows className={className}>{children}</FilterListRows>
    </CommandListPrimitive>
  )
  return (
    <div
      ref={frameRef}
      data-command-list-frame=''
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
          data-command-page={page}
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
      data-command-lead-page=''
      className='flex min-h-0 flex-1 flex-col *:[[role=listbox]]:flex-none *:[[role=listbox]]:not-has-[[role=option]]:hidden'
    >
      {/* A highlight that lands on a row never scrolls what the lead shows. */}
      <div
        ref={fades}
        data-command-lead-scroller=''
        className={cn(filterListScrollerClassName, 'relative')}
      >
        <div data-command-lead=''>{lead}</div>
      </div>
      {children}
    </div>
  )
}

/*
 * How a page of commands gives way to the next. A page's rows go the moment
 * it changes, so the old page leaves as a copy, through the flow lib's
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
      `:scope > [data-command-page="${CSS.escape(key)}"]`,
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
const SCROLLERS = '[role=listbox], [data-command-lead-scroller]'

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

/*
 * Both pages move together on `layout`, the new one from the end edge going
 * on and from the start edge going back, and each fades as it travels, so a
 * shorter `--command-slide` (on the menu or anything above it) still reads as
 * one page giving way to the next. With less motion nothing travels: the new
 * page fades in and the old one goes at once.
 */
const pageClassName =
  'min-h-0 [--page-from:1] [--page-to:-1] rtl:[--page-sign:-1] group-data-[page-direction=back]/pages:[--page-from:-1] group-data-[page-direction=back]/pages:[--page-to:1] flex flex-col transition-[translate,opacity] duration-(--motion-layout-duration) ease-(--motion-layout-easing) data-fresh:starting:translate-x-[calc(var(--command-slide,100%)*var(--page-from)*var(--page-sign,1))] data-fresh:starting:opacity-0 data-leaving:translate-x-[calc(var(--command-slide,100%)*var(--page-to)*var(--page-sign,1))] data-leaving:opacity-0 motion-reduce:transition-opacity motion-reduce:data-fresh:starting:translate-x-0 motion-reduce:data-leaving:translate-x-0 motion-reduce:data-leaving:transition-none'

/** The commands one page holds; `value` is the page's name. The first page has none. */
function CommandPage(props: ComponentProps<typeof CommandPagePrimitive>) {
  return <CommandPagePrimitive {...props} />
}

function CommandGroup(props: ComponentProps<typeof CommandGroupPrimitive>) {
  return <CommandGroupPrimitive {...props} />
}

function CommandGroupLabel({
  className,
  ...props
}: Omit<ComponentProps<typeof CommandGroupLabelPrimitive>, 'className'> & {
  className?: string
}) {
  return (
    <CommandGroupLabelPrimitive
      className={cn(filterListGroupLabelClassName, className)}
      {...props}
    />
  )
}

/** A command: the menus' row. It runs on a click, on Enter or on its `shortcut`. */
function CommandItem({
  className,
  ...props
}: Omit<ComponentProps<typeof CommandItemPrimitive>, 'className'> & {
  className?: string
}) {
  return (
    <CommandItemPrimitive
      data-menu-row=''
      className={cn(
        filterListItemClassName,
        'data-pending:text-muted-foreground',
        className,
      )}
      {...props}
    />
  )
}

/** A command's text, with the part that matched the search in bold. */
function CommandItemText({
  className,
  ...props
}: Omit<ComponentProps<typeof CommandItemTextPrimitive>, 'className'> & {
  className?: string
}) {
  return (
    <CommandItemTextPrimitive
      className={cn(filterListMatchClassName, className)}
      {...props}
    />
  )
}

/** A command's icon, before its text. */
function CommandItemIcon({
  className,
  ...props
}: Omit<ComponentProps<typeof CommandItemIconPrimitive>, 'className'> & {
  className?: string
}) {
  return (
    <CommandItemIconPrimitive
      className={cn(
        "flex shrink-0 items-center [&_svg:not([class*='text-'])]:text-muted-foreground",
        className,
      )}
      {...props}
    />
  )
}

/** A command's shortcut, at the row's end: its `shortcut`, or `Kbd` keys, as in the menus. */
function CommandShortcut(props: ComponentProps<typeof CommandShortcutPrimitive>) {
  return <CommandShortcutPrimitive render={<MenuShortcut />} {...props} />
}

function CommandSeparator({
  className,
  ...props
}: Omit<ComponentProps<typeof CommandSeparatorPrimitive>, 'className'> & {
  className?: string
}) {
  return (
    <CommandSeparatorPrimitive
      className={cn(filterListSeparatorClassName, className)}
      {...props}
    />
  )
}

/** What shows when nothing matches, announced as it appears: say what was looked for. */
function CommandEmpty({
  className,
  ...props
}: Omit<ComponentProps<typeof CommandEmptyPrimitive>, 'className'> & {
  className?: string
}) {
  return (
    <CommandEmptyPrimitive
      className={cn(filterListNoticeClassName, className)}
      {...props}
    />
  )
}

/** Announces a search that is running, or how many commands it found. */
function CommandStatus({
  className,
  ...props
}: Omit<ComponentProps<typeof CommandStatusPrimitive>, 'className'> & {
  className?: string
}) {
  return (
    <CommandStatusPrimitive
      className={cn(filterListNoticeClassName, className)}
      {...props}
    />
  )
}

/** The line under the rows, for the keys that work here. */
function CommandFooter({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-command-footer=''
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
      data-command-hint=''
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
  CommandDialog,
  CommandEmpty,
  CommandFooter,
  CommandGroup,
  CommandGroupLabel,
  CommandHint,
  CommandInput,
  CommandItem,
  CommandItemIcon,
  CommandItemText,
  CommandList,
  CommandPage,
  CommandSeparator,
  CommandShortcut,
  CommandStatus,
}
export type { CommandProps }
