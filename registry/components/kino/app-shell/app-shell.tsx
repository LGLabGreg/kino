'use client'

import { Button } from '@/registry/components/kino/button'
import { CommandDialog } from '@/registry/components/kino/command'
import { Kbd, KbdGroup } from '@/registry/components/kino/kbd'
import { Separator } from '@/registry/components/kino/separator'
import {
  Sidebar,
  type SidebarCollapsible,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  type SidebarSide,
  SidebarTrigger,
} from '@/registry/components/kino/sidebar'
import {
  Tooltip,
  TooltipContent,
  TooltipShortcut,
  TooltipTrigger,
} from '@/registry/components/kino/tooltip'
import {
  UserMenu,
  UserMenuContent,
  UserMenuHeader,
  UserMenuSeparator,
  UserMenuTrigger,
  UserMenuWorkspace,
  UserMenuWorkspaces,
} from '@/registry/components/kino/user-menu'
import { IconPlaceholder } from '@/registry/icons/icon-placeholder'
import { useControllable } from '@/registry/lib/controllable'
import { CutTooltip } from '@/registry/lib/cut'
import { ariaShortcut, useApplePlatform, useShortcut } from '@/registry/lib/keys'
import {
  type ComponentProps,
  createContext,
  type MouseEvent,
  type ReactNode,
  use,
  useId,
  useState,
} from 'react'

import { cn } from '@/lib/utils'

/*
 * The frame of an app: the Sidebar with the workspaces and the person signed
 * in, a header with the breadcrumb, the search and the notifications, and the
 * page. Three arrangements:
 *
 * - `inset`, the default: the page is a card on the sidebar's tint, its
 *   header inside it.
 * - `flat`: the sidebar and the page share one plane, split by a line.
 * - `top-bar`: the header runs across the top, holding the workspaces, the
 *   search and the person; the sidebar under it holds only the pages.
 *
 * The sidebar collapses to its icons (or out of sight) with ⌘B, and is a
 * Sheet on a phone. ⌘K opens the search.
 *
 *   <AppShell
 *     sidebar={<AppShellSidebar>…</AppShellSidebar>}
 *     header={<AppShellHeader actions={<AppShellSearch>…</AppShellSearch>}>…</AppShellHeader>}
 *   >
 *     <AppShellPageHeader title='Billing revamp' actions={<Button>New issue</Button>} />
 *   </AppShell>
 */

type AppShellVariant = 'inset' | 'flat' | 'top-bar'

interface AppShellContextValue {
  variant: AppShellVariant
  side: SidebarSide
  collapsible: SidebarCollapsible
  /** Whether the header and the page are landmarks. */
  landmarks: boolean
}

const AppShellContext = createContext<AppShellContextValue>({
  variant: 'inset',
  side: 'start',
  collapsible: 'icon',
  landmarks: true,
})

/** Whether a part sits in the header, where it shows smaller than in the sidebar. */
const InHeaderContext = createContext(false)

/*
 * The header's height, set once on the shell as `--app-shell-header-height`
 * for the header and the page's scroll padding under it: as tall as the
 * sidebar's header, its large row, which holds two lines of text (2rem) or a
 * small control, whichever is taller, and a gutter above and below it. Inside
 * the inset's card, a gutter and the card's border shorter, so its line meets
 * the sidebar's header's.
 */
const headerHeight =
  '[--app-shell-header-height:calc(var(--control-height-lg)-var(--control-height-sm)+max(var(--control-height-sm),2rem)+2*var(--control-padding))]'
const insetHeaderHeight =
  '[--app-shell-header-height:calc(var(--control-height-lg)-var(--control-height-sm)+max(var(--control-height-sm),2rem)+var(--control-padding)-1px)]'

/** The keys that open the search from anywhere on the page. */
const SEARCH_SHORTCUT = ['Mod', 'K'] as const

/**
 * The app's frame. It fills the height its parent gives it, and the page
 * scrolls inside it, under a header that stays. The first tab stop skips to
 * the page.
 */
function AppShell({
  variant = 'inset',
  side = 'start',
  collapsible = 'icon',
  sidebar,
  header,
  open,
  defaultOpen,
  onOpenChange,
  shortcut,
  landmarks = true,
  skipLabel = 'Skip to content',
  className,
  children,
  ...props
}: Omit<ComponentProps<'div'>, 'children'> & {
  /** How the frame is arranged: see above. */
  variant?: AppShellVariant
  /** The edge the sidebar docks to: `start` and `end` follow the text direction. */
  side?: SidebarSide
  /** How the sidebar collapses: to its icons, or out of sight. */
  collapsible?: SidebarCollapsible
  /** The AppShellSidebar. */
  sidebar: ReactNode
  /** The AppShellHeader: across the top in `top-bar`, else over the page. */
  header?: ReactNode
  /** Whether the sidebar is docked open, when you hold the state. */
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  /** The keys that collapse the sidebar, or null for none. */
  shortcut?: readonly string[] | null
  /**
   * Whether the header and the page are the page's banner and `main`. Turn it
   * off inside a page that has its own, such as a preview.
   */
  landmarks?: boolean
  skipLabel?: string
  /** The page: an AppShellPageHeader and what the page holds. */
  children: ReactNode
}) {
  const mainId = useId()
  const top = variant === 'top-bar'
  const Main = landmarks ? 'main' : 'div'
  return (
    <AppShellContext value={{ variant, side, collapsible, landmarks }}>
      <SidebarProvider
        open={open}
        defaultOpen={defaultOpen}
        onOpenChange={onOpenChange}
        shortcut={shortcut}
        {...props}
        data-app-shell=''
        data-variant={variant}
        className={cn(
          'text-foreground h-full min-h-full flex-col',
          variant === 'inset' ? insetHeaderHeight : headerHeight,
          // Flat: the sidebar takes the page's colour, so the two are one plane split by its edge.
          variant === 'flat'
            ? 'bg-background [--sidebar:var(--background)]'
            : 'bg-sidebar',
          className,
        )}
      >
        <SkipLink target={mainId}>{skipLabel}</SkipLink>
        {top ? header : null}
        {/* The sidebar's panel is laid out against this row, under a top bar. */}
        <div className='relative flex min-h-0 min-w-0 flex-1'>
          {sidebar}
          <SidebarInset
            render={<div />}
            className={cn(
              // A sticky header covers the top of the page: what scrolls into view stops below it.
              !top && 'scroll-pt-(--app-shell-header-height)',
              // Inset: a card a gutter from the edges, beside the sidebar; on a phone the whole screen.
              variant === 'inset' &&
                '@3xl/sidebar-provider:my-(--control-padding) @3xl/sidebar-provider:rounded-(--surface-radius) @3xl/sidebar-provider:border @3xl/sidebar-provider:shadow-xs',
              variant === 'inset' &&
                (side === 'start'
                  ? '@3xl/sidebar-provider:me-(--control-padding)'
                  : '@3xl/sidebar-provider:ms-(--control-padding)'),
            )}
          >
            {top ? null : header}
            <Main
              id={mainId}
              tabIndex={-1}
              data-slot='app-shell-main'
              className='@container/app-shell-main flex min-w-0 flex-1 flex-col focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset focus-visible:outline-hidden'
            >
              {children}
            </Main>
          </SidebarInset>
        </div>
      </SidebarProvider>
    </AppShellContext>
  )
}

/**
 * The first tab stop, out of sight until it has focus: it takes focus past
 * the header and the sidebar to the page.
 */
function SkipLink({ target, children }: { target: string; children: ReactNode }) {
  return (
    <a
      href={`#${target}`}
      data-slot='app-shell-skip-link'
      onClick={(event: MouseEvent<HTMLAnchorElement>) => {
        const main = document.getElementById(target)
        if (!main) return
        event.preventDefault()
        main.focus()
      }}
      className='bg-background text-foreground focus-visible:ring-ring/50 sr-only rounded-(--control-radius) border text-sm font-medium shadow-sm focus-visible:not-sr-only focus-visible:absolute focus-visible:start-(--control-padding) focus-visible:top-(--control-padding) focus-visible:z-50 focus-visible:px-(--control-padding) focus-visible:py-2 focus-visible:ring-3 focus-visible:outline-hidden'
    >
      {children}
    </a>
  )
}

/**
 * The app's Sidebar, set for the shell: it docks to the shell's side,
 * collapses its way, and in `inset` leaves its edge to the page's card.
 */
function AppShellSidebar(
  props: Omit<ComponentProps<typeof Sidebar>, 'side' | 'collapsible' | 'variant'>,
) {
  const { variant, side, collapsible } = use(AppShellContext)
  return (
    <Sidebar
      side={side}
      collapsible={collapsible}
      variant={variant === 'inset' ? 'inset' : 'sidebar'}
      {...props}
    />
  )
}

/**
 * The header: the sidebar's toggle, then `children`, such as the Breadcrumb
 * (and the workspaces, in `top-bar`), and `actions` at its end: the search,
 * the notifications and, in `top-bar`, the person. It stays at the top while
 * the page scrolls under it.
 */
function AppShellHeader({
  actions,
  className,
  children,
  ...props
}: ComponentProps<'header'> & {
  /** At the end: AppShellSearch, the notifications, AppShellUser. */
  actions?: ReactNode
}) {
  const { variant, side, landmarks } = use(AppShellContext)
  // Beside the sidebar it opens: at the header's end when the sidebar docks there, its panel drawn on that side.
  const trigger = (
    <SidebarTrigger
      className={cn(side === 'end' && '[&_svg]:-scale-x-100 rtl:[&_svg]:scale-x-100')}
    />
  )
  const separator =
    variant === 'top-bar' ? null : (
      <Separator orientation='vertical' className='h-4 self-center' />
    )
  // Inside a page that has its own banner, it is a plain box.
  const Element = (landmarks ? 'header' : 'div') as 'header'
  return (
    <InHeaderContext value>
      <Element
        data-slot='app-shell-header'
        className={cn(
          '@container/app-shell-header flex min-w-0 shrink-0 items-center gap-2 px-(--control-padding)',
          variant === 'top-bar'
            ? 'bg-sidebar h-(--app-shell-header-height) border-b'
            : cn(
                // Opaque enough that muted text keeps 4.5:1 over the page scrolling under it.
                'bg-background/95 sticky top-0 z-10 border-b backdrop-blur',
                'h-(--app-shell-header-height)',
              ),
          // Inset, on a wide screen, it follows the card's rounded top.
          variant === 'inset' &&
            '@3xl/sidebar-provider:rounded-t-[calc(var(--surface-radius)-1px)]',
          className,
        )}
        {...props}
      >
        {side === 'start' ? (
          <>
            {trigger}
            {separator}
          </>
        ) : null}
        <div className='flex min-w-0 flex-1 items-center gap-2'>{children}</div>
        {actions ? (
          <div className='flex shrink-0 items-center gap-1'>{actions}</div>
        ) : null}
        {side === 'end' ? (
          <>
            {separator}
            {trigger}
          </>
        ) : null}
      </Element>
    </InHeaderContext>
  )
}

/**
 * The search: a button that opens `children`, a Command, in a dialog, and
 * ⌘K from anywhere on the page. On a wide header it reads like a field with
 * its keys; on a narrow one it is an icon, named by its tooltip.
 */
function AppShellSearch({
  label = 'Search',
  title = 'Search',
  shortcut = SEARCH_SHORTCUT,
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  className,
  children,
}: {
  /** For layout, on the button in either of its looks. */
  className?: string
  /** The button's words, and its name. */
  label?: string
  /** Names the dialog for a screen reader. */
  title?: string
  /** The keys that open it from anywhere on the page, or null for none. */
  shortcut?: readonly string[] | null
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  /** The Command it opens. */
  children: ReactNode
}) {
  const [open, setOpen] = useControllable(openProp, defaultOpen, onOpenChange)
  const apple = useApplePlatform()
  const [box, setBox] = useState<HTMLSpanElement | null>(null)
  // Left to another dialog that covers the page, but the search's own keys close it.
  useShortcut(shortcut ?? undefined, () => setOpen(!open), open ? null : box)
  const keys = shortcut ? ariaShortcut(shortcut, apple) : undefined
  return (
    <span ref={setBox} data-slot='app-shell-search' className='contents'>
      {/* A field's look on a wide shell, by the shell's width, so the sidebar's collapse doesn't swap it: its keys are read as aria-keyshortcuts, not as its name. */}
      <CutTooltip
        render={
          <Button
            variant='outline'
            aria-keyshortcuts={keys}
            onClick={() => setOpen(true)}
            className={cn(
              'text-muted-foreground hidden w-56 justify-start @4xl/sidebar-provider:inline-flex',
              className,
            )}
          >
            <IconPlaceholder
              lucide='SearchIcon'
              tabler='IconSearch'
              hugeicons='Search01Icon'
              phosphor='MagnifyingGlassIcon'
              remixicon='RiSearchLine'
              aria-hidden
              data-icon='inline-start'
            />
            <span data-cut className='min-w-0 flex-1 truncate text-start'>
              {label}
            </span>
            {shortcut ? (
              <KbdGroup aria-hidden className='pointer-coarse:hidden'>
                {shortcut.map((key) => (
                  <Kbd key={key} name={key} />
                ))}
              </KbdGroup>
            ) : null}
          </Button>
        }
      />
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant='ghost'
              size='icon'
              aria-label={label}
              aria-keyshortcuts={keys}
              onClick={() => setOpen(true)}
              className={cn(
                'text-muted-foreground @4xl/sidebar-provider:hidden',
                className,
              )}
            />
          }
        >
          <IconPlaceholder
            lucide='SearchIcon'
            tabler='IconSearch'
            hugeicons='Search01Icon'
            phosphor='MagnifyingGlassIcon'
            remixicon='RiSearchLine'
            aria-hidden
          />
        </TooltipTrigger>
        <TooltipContent>
          {label}
          {shortcut ? (
            <TooltipShortcut>
              <KbdGroup>
                {shortcut.map((key) => (
                  <Kbd key={key} name={key} />
                ))}
              </KbdGroup>
            </TooltipShortcut>
          ) : null}
        </TooltipContent>
      </Tooltip>
      <CommandDialog title={title} open={open} onOpenChange={setOpen}>
        {children}
      </CommandDialog>
    </span>
  )
}

interface AppShellWorkspace {
  value: string
  name: string
  /** Read after the name, such as the plan. */
  description?: string
  /** Its logo, as tall as a small control. */
  logo: ReactNode
}

/**
 * The workspace you are in, and a press away, the others. In the sidebar's
 * header it is a large row, the logo alone in the rail; in a top bar a small
 * button. `children` adds rows under the workspaces, such as one that
 * creates one. Pass `open` and `onOpenChange` to hold the menu's state.
 */
function AppShellWorkspaces({
  workspaces,
  value: valueProp,
  defaultValue,
  onValueChange,
  label = 'Workspaces',
  children,
  ...root
}: Omit<ComponentProps<typeof UserMenu>, 'children'> & {
  workspaces: readonly AppShellWorkspace[]
  value?: string
  defaultValue?: string
  onValueChange?: (value: string) => void
  /** Names the menu and the sheet on a phone, and is read after the workspace's name on its button. */
  label?: string
  /** More rows under the workspaces, after a separator. */
  children?: ReactNode
}) {
  const inHeader = use(InHeaderContext)
  const [value, setValue] = useControllable(
    valueProp,
    defaultValue ?? workspaces[0]?.value ?? '',
    onValueChange,
  )
  const current =
    workspaces.find((workspace) => workspace.value === value) ?? workspaces[0]
  const chevrons = (
    <IconPlaceholder
      lucide='ChevronsUpDownIcon'
      tabler='IconSelector'
      hugeicons='UnfoldMoreIcon'
      phosphor='CaretUpDownIcon'
      remixicon='RiExpandUpDownLine'
      aria-hidden
      className='text-muted-foreground ms-auto self-center'
    />
  )
  const menu = (
    <UserMenuContent align='start' side='bottom'>
      <UserMenuWorkspaces<string>
        label={label}
        value={value}
        onValueChange={(next) => setValue(next)}
      >
        {workspaces.map((workspace) => (
          <UserMenuWorkspace
            key={workspace.value}
            value={workspace.value}
            logo={workspace.logo}
            description={workspace.description}
          >
            {workspace.name}
          </UserMenuWorkspace>
        ))}
      </UserMenuWorkspaces>
      {children ? (
        <>
          <UserMenuSeparator />
          {children}
        </>
      ) : null}
    </UserMenuContent>
  )

  if (inHeader) {
    return (
      <UserMenu {...root}>
        <CutTooltip
          render={
            <UserMenuTrigger
              data-app-shell-workspaces=''
              render={
                <Button
                  variant='ghost'
                  size='sm'
                  aria-label={`${current?.name}, ${label}`}
                  className='max-w-60 min-w-0 shrink px-[calc(var(--control-padding)/2)]'
                />
              }
            >
              {current?.logo}
              <span
                data-cut
                className='hidden min-w-0 truncate font-medium @md/app-shell-header:inline'
              >
                {current?.name}
              </span>
              {chevrons}
            </UserMenuTrigger>
          }
        />
        {menu}
      </UserMenu>
    )
  }

  return (
    <SidebarMenu data-app-shell-workspaces=''>
      <SidebarMenuItem>
        <UserMenu {...root}>
          <UserMenuTrigger
            render={<SidebarMenuButton size='lg' tooltip={current?.name} />}
          >
            <span data-slot='app-shell-workspace-logo' className='flex shrink-0'>
              {current?.logo}
            </span>
            <span className='flex min-w-0 flex-col'>
              <span data-cut className='truncate text-sm leading-4 font-medium'>
                {current?.name}
              </span>
              {current?.description ? (
                <span
                  data-cut
                  className='text-muted-foreground truncate text-xs leading-4'
                >
                  {current.description}
                </span>
              ) : null}
              {/* Named as the header's button is, after the words it shows. */}
              <span className='sr-only'>, {label}</span>
            </span>
            {chevrons}
          </UserMenuTrigger>
          {menu}
        </UserMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}

/**
 * The person signed in, and their menu: `children`, such as Profile, the
 * theme and Sign out. In the sidebar's footer it is a large row with their
 * name and email; in a top bar, their avatar, the menu opening with who
 * they are. Pass `open` and `onOpenChange` to hold the menu's state.
 */
function AppShellUser({
  name,
  email,
  avatar,
  label = 'Account',
  children,
  ...root
}: Omit<ComponentProps<typeof UserMenu>, 'children'> & {
  name: string
  email?: string
  /** Their Avatar, at `sm`. */
  avatar: ReactNode
  /** Names the menu, and the sheet on a phone. */
  label?: string
  /** The menu's rows: UserMenuItem, UserMenuTheme, UserMenuSeparator. */
  children: ReactNode
}) {
  const inHeader = use(InHeaderContext)
  if (inHeader) {
    return (
      <UserMenu {...root}>
        <UserMenuTrigger
          data-app-shell-user=''
          render={<Button variant='ghost' size='icon' aria-label={`${name}, ${label}`} />}
        >
          {avatar}
        </UserMenuTrigger>
        <UserMenuContent>
          <UserMenuHeader name={name} email={email} avatar={avatar} />
          <UserMenuSeparator />
          {children}
        </UserMenuContent>
      </UserMenu>
    )
  }
  return (
    <SidebarMenu data-app-shell-user=''>
      <SidebarMenuItem>
        <UserMenu {...root}>
          <UserMenuTrigger render={<SidebarMenuButton size='lg' tooltip={name} />}>
            {avatar}
            <span className='flex min-w-0 flex-col'>
              <span data-cut className='truncate text-sm leading-4 font-medium'>
                {name}
              </span>
              {email ? (
                <span
                  data-cut
                  className='text-muted-foreground truncate text-xs leading-4'
                >
                  {email}
                </span>
              ) : null}
              <span className='sr-only'>, {label}</span>
            </span>
            <IconPlaceholder
              lucide='ChevronsUpDownIcon'
              tabler='IconSelector'
              hugeicons='UnfoldMoreIcon'
              phosphor='CaretUpDownIcon'
              remixicon='RiExpandUpDownLine'
              aria-hidden
              className='text-muted-foreground ms-auto self-center'
            />
          </UserMenuTrigger>
          <UserMenuContent side='top' align='start'>
            {children}
          </UserMenuContent>
        </UserMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}

/**
 * The page's title, what it is, and its actions. On a narrow page the
 * actions go under the title.
 */
function AppShellPageHeader({
  title,
  description,
  actions,
  heading: Heading = 'h1',
  className,
  ...props
}: Omit<ComponentProps<'div'>, 'title' | 'children'> & {
  title: ReactNode
  description?: ReactNode
  /** Buttons for what the page does, the main one last. */
  actions?: ReactNode
  /** The title's level: the page's `h1`, lower inside another page. */
  heading?: 'h1' | 'h2'
}) {
  return (
    <div
      {...props}
      data-slot='app-shell-page-header'
      className={cn(
        'flex min-w-0 flex-col gap-3 px-(--surface-padding-lg) pt-(--surface-padding-lg) pb-(--surface-padding) @3xl/sidebar-provider:flex-row @3xl/sidebar-provider:items-end',
        className,
      )}
    >
      <div className='flex min-w-0 flex-1 flex-col gap-1'>
        <Heading className='text-xl font-semibold tracking-tight break-words'>
          {title}
        </Heading>
        {description ? (
          <p className='text-muted-foreground text-sm'>{description}</p>
        ) : null}
      </div>
      {actions ? (
        <div className='flex shrink-0 flex-wrap items-center gap-2'>{actions}</div>
      ) : null}
    </div>
  )
}

export {
  AppShell,
  AppShellHeader,
  AppShellPageHeader,
  AppShellSearch,
  AppShellSidebar,
  AppShellUser,
  AppShellWorkspaces,
}
export type { AppShellVariant, AppShellWorkspace }
