'use client'

import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/registry/components/kino/card'
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  Form,
  useFormSubmission,
} from '@/registry/components/kino/field'
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemTitle,
} from '@/registry/components/kino/item'
import { labelClassName } from '@/registry/components/kino/label'
import { SaveBar } from '@/registry/components/kino/save-bar'
import { SettingsChannel } from '@/registry/components/kino/settings-page/settings-channel'
import {
  SettingsPhoto,
  type SettingsPhotoValue,
} from '@/registry/components/kino/settings-page/settings-photo'
import { Tabs, TabsPanel, TabsList, TabsTab } from '@/registry/components/kino/tabs'
import { useControllable } from '@/registry/lib/controllable'
import { revealBehavior, scrollerOf } from '@/registry/lib/scroll'
import {
  Children,
  type ComponentProps,
  createContext,
  isValidElement,
  type ReactElement,
  type ReactNode,
  use,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'

import { cn } from '@/lib/utils'

/*
 * An app's settings: the sections in a list beside the page, and the page
 * of the one picked; across the top of the page in a column too narrow for
 * both. The whole page is one Kino Form, so a change in any section raises
 * the Save bar, Save sends every section at once, and moving to another
 * section keeps what was typed. A field turned down in a section out of
 * sight, by the form's checks or by the save, brings its section back.
 *
 *   <SettingsPage onSave={save}>
 *     <SettingsNav>
 *       <SettingsNavItem value='profile' icon={<UserIcon />}>Profile</SettingsNavItem>
 *     </SettingsNav>
 *     <SettingsSection value='profile' title='Profile'>
 *       <SettingsGroup title='Your details'>
 *         <SettingsRow name='name' label='Name'><Input defaultValue={me.name} /></SettingsRow>
 *       </SettingsGroup>
 *     </SettingsSection>
 *   </SettingsPage>
 */

interface SettingsPageContextValue {
  /** Whether the list sits beside the page, rather than across its top. */
  beside: boolean
  /** Whether `beside` has been read from the page's width, which the server can't do. */
  measured: boolean
  /** The page title's level: sections take the next, groups the one after. */
  level: 1 | 2
}

const SettingsPageContext = createContext<SettingsPageContextValue | null>(null)

function useSettingsPage(part: string) {
  const context = use(SettingsPageContext)
  if (!context) throw new Error(`${part} goes inside a SettingsPage.`)
  return context
}

/** How wide the page's column must be for the list to sit beside the sections, in px: 48rem, Tailwind's `@3xl`. */
const BESIDE_WIDTH = 768

/** Whether a page `width` px wide has room for the list beside the sections. */
function fitsBeside(width: number) {
  return width >= BESIDE_WIDTH
}

/**
 * The page's own width, read before it paints: the list sits beside the
 * sections only when both fit. The server can't know it, so until it's
 * `measured` a narrow page shows no list rather than one that doesn't fit.
 */
function useBeside(root: { current: HTMLElement | null }) {
  const [beside, setBeside] = useState<boolean | null>(null)
  useLayoutEffect(() => {
    const element = root.current
    if (!element) return undefined
    const measure = () => setBeside(fitsBeside(element.offsetWidth))
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [root])
  return { beside: beside ?? true, measured: beside !== null }
}

/** The top of `scroller`'s view, inside its border, in the viewport's pixels: the window's is 0. */
function viewTop(scroller: HTMLElement | null) {
  return scroller ? scroller.getBoundingClientRect().top + scroller.clientTop : 0
}

/**
 * How far to scroll so an element whose top is at `top` sits `margin` below
 * the view's top at `view`, both in the viewport's pixels: nothing while its
 * top is still in view, and a negative distance, up, once the page has
 * scrolled past it. `room` is how far the page could still be scrolled down
 * after the change, which may be less than now, as when a shorter section
 * shows: it never scrolls to where the page can't rest.
 */
function scrollToTopBy(top: number, view: number, margin: number, room = 0) {
  return top >= view ? 0 : Math.min(top - margin - view, room)
}

/**
 * Holds `element` at its height while the section in it changes, so the
 * page doesn't shorten under a scroll. Returns the function that lets go.
 */
function holdHeight(element: HTMLElement) {
  element.style.minHeight = `${element.offsetHeight}px`
  return () => {
    element.style.minHeight = ''
  }
}

/**
 * Scrolls `element`'s top, less its scroll margin, up to the top of the box
 * that scrolls it when the page has scrolled past it, so a section picked
 * from far down its neighbour opens at its heading. `release` lets go of
 * the height held through the switch, once the scroll ends. Only that box
 * scrolls, never the ones around it, as `scrollIntoView` would.
 */
function bringIntoView(element: HTMLElement, release: () => void) {
  const box = scrollerOf(element)
  const page = box ?? document.scrollingElement ?? document.documentElement
  // How far the page will scroll once the held height goes: what it can
  // now, less what the held height adds under the new section.
  const { top, bottom } = element.getBoundingClientRect()
  const content = Math.max(
    top,
    ...[...element.children].map((child) => child.getBoundingClientRect().bottom),
  )
  const room = page.scrollHeight - page.clientHeight - page.scrollTop - (bottom - content)
  const margin = Number.parseFloat(getComputedStyle(element).scrollMarginTop) || 0
  const by = scrollToTopBy(top, viewTop(box), margin, room)
  if (by === 0) {
    release()
    return
  }
  // Held until the glide ends, so the browser never cuts it short.
  const target = box ?? window
  const done = () => {
    clearTimeout(timer)
    target.removeEventListener('scrollend', done)
    release()
  }
  // A scroll the browser can't make never ends.
  const timer = setTimeout(done, 1000)
  target.addEventListener('scrollend', done)
  target.scrollBy({ top: by, behavior: revealBehavior(element) })
}

/** The first field the last submit turned down, and the section it sits in. */
function firstInvalid(form: HTMLFormElement) {
  // A Field's root comes before its control, so the first match is the field.
  const field = form.querySelector<HTMLElement>('[data-invalid]')
  const section = field?.closest<HTMLElement>('[data-settings-section]')
  return field && section?.dataset.value
    ? { field, section: section.dataset.value }
    : null
}

/** The control in `field` a person types in or presses, for focus. */
function controlIn(field: HTMLElement) {
  return field.querySelector<HTMLElement>(
    'input:not([type=hidden]):not([aria-hidden=true]), textarea, button, [role=combobox], [tabindex="0"]',
  )
}

/**
 * The settings screen: its title, the list of sections and the section
 * picked, in one form with a Save bar. It fills the height its parent gives
 * it, and the list stays in view as the page scrolls.
 */
function SettingsPage({
  title = 'Settings',
  description,
  heading = 'h1',
  section,
  defaultSection,
  onSectionChange,
  onSave,
  onDiscard,
  className,
  children,
  ...props
}: Omit<ComponentProps<'div'>, 'title' | 'children'> & {
  title?: ReactNode
  description?: ReactNode
  /** The title's level: the page's `h1` on a page of its own, lower inside a dialog. Sections and groups take the levels under it. */
  heading?: 'h1' | 'h2'
  /** The section shown, when you hold it, such as from the address. */
  section?: string
  /** The section it opens on: the first when left out. */
  defaultSection?: string
  onSectionChange?: (section: string) => void
  /** Saves the form's values, by field name. A promise keeps the Save bar saving until it settles; a throw or a rejection says it failed; errors by field, such as `{ email: '…' }`, show on those fields. */
  onSave?: (values: Record<string, unknown>) => unknown
  /** Runs after Discard has put every field back, for state the form doesn't hold. */
  onDiscard?: () => void
  /** A SettingsNav, then the SettingsSections. */
  children: ReactNode
}) {
  const parts = Children.toArray(children)
  const nav = parts.filter((part) => isValidElement(part) && part.type === SettingsNav)
  const sections = parts.filter((part) => !nav.includes(part))
  const first = sections.find(
    (part): part is ReactElement<{ value: string }> =>
      isValidElement<{ value?: unknown }>(part) && typeof part.props.value === 'string',
  )?.props.value
  const [current, setCurrent] = useControllable(
    section,
    defaultSection ?? first ?? '',
    onSectionChange,
  )
  const root = useRef<HTMLDivElement>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const tabsRef = useRef<HTMLDivElement>(null)
  const { beside, measured } = useBeside(root)
  // Lets go of the height held through a section switch, once the new section is in.
  const switching = useRef<(() => void) | null>(null)
  useLayoutEffect(() => {
    const release = switching.current
    const tabs = tabsRef.current
    switching.current = null
    if (release && tabs) bringIntoView(tabs, release)
  }, [current])

  // A field turned down in a section out of sight brings its section into
  // view, and takes focus there: the form couldn't focus it while it hid.
  const pending = useRef<HTMLElement | null>(null)
  const setCurrentRef = useRef(setCurrent)
  useEffect(() => {
    setCurrentRef.current = setCurrent
  })
  const revealInvalid = () => {
    const form = formRef.current
    const invalid = form ? firstInvalid(form) : null
    if (!invalid) return
    const panel = invalid.field.closest<HTMLElement>('[data-settings-section]')
    if (!panel?.hidden) return
    pending.current = invalid.field
    setCurrentRef.current(invalid.section)
  }
  useEffect(() => {
    const field = pending.current
    if (!field) return
    pending.current = null
    controlIn(field)?.focus()
  }, [current])

  const Heading = heading
  return (
    <SettingsPageContext value={{ beside, measured, level: heading === 'h1' ? 1 : 2 }}>
      <div
        ref={root}
        data-slot='settings-page'
        className={cn('@container min-h-full min-w-0', className)}
        {...props}
      >
        <Form
          ref={formRef}
          aria-label={typeof title === 'string' ? title : 'Settings'}
          onFormSubmit={onSave}
          className='flex min-w-0 flex-col gap-(--surface-padding-lg)'
        >
          <div className='flex min-w-0 flex-col gap-1'>
            <Heading className='text-2xl font-semibold tracking-tight'>{title}</Heading>
            {description ? (
              <p className='text-muted-foreground text-sm'>{description}</p>
            ) : null}
          </div>
          <Tabs
            ref={tabsRef}
            value={current}
            onValueChange={(value) => {
              // The page keeps its height until the new section is in, then scrolls to its heading.
              const tabs = tabsRef.current
              if (tabs) switching.current = holdHeight(tabs)
              setCurrent(String(value))
            }}
            orientation={beside ? 'vertical' : 'horizontal'}
            className={cn(
              'scroll-mt-(--settings-page-top,1.5rem)',
              beside ? 'items-start gap-10' : 'gap-(--surface-padding-lg)',
            )}
          >
            {nav}
            {sections}
          </Tabs>
          <RevealInvalid onInvalid={revealInvalid} />
          <SaveBar onDiscard={onDiscard} />
        </Form>
      </div>
    </SettingsPageContext>
  )
}

/**
 * Calls `onInvalid` a frame after the form is sent, once its checks have
 * run, and again when a save comes back with errors by field, which land
 * on fields that may be out of sight.
 */
function RevealInvalid({ onInvalid }: { onInvalid: () => void }) {
  const latest = useRef(onInvalid)
  useEffect(() => {
    latest.current = onInvalid
  })
  const marker = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    const form = marker.current?.closest('form')
    if (!form) return undefined
    let frame = 0
    const onSubmit = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => latest.current())
    }
    form.addEventListener('submit', onSubmit, true)
    return () => {
      cancelAnimationFrame(frame)
      form.removeEventListener('submit', onSubmit, true)
    }
  }, [])
  const status = useFormSubmission()?.status
  const last = useRef(status)
  useEffect(() => {
    const was = last.current
    last.current = status
    if (was !== 'saving' || status === 'saving') return undefined
    const frame = requestAnimationFrame(() => latest.current())
    return () => cancelAnimationFrame(frame)
  }, [status])
  return <span ref={marker} hidden />
}

/** The list of sections: beside the page, or across its top in a narrow column. */
function SettingsNav({
  className,
  children,
  'aria-label': label = 'Sections',
  ...props
}: Omit<ComponentProps<typeof TabsList>, 'children' | 'variant'> & {
  /** SettingsNavItems, one for each section, in the same order. */
  children: ReactNode
}) {
  const { beside, measured } = useSettingsPage('SettingsNav')
  return (
    <TabsList
      data-settings-nav=''
      aria-label={label}
      {...props}
      className={cn(
        beside && 'sticky top-(--settings-page-top,1.5rem) w-52 shrink-0',
        // Until the page's width is read, a narrow page shows no list rather than one beside it that doesn't fit.
        !measured && '@max-3xl:hidden',
        className,
      )}
    >
      {children}
    </TabsList>
  )
}

/** A section's tab. */
function SettingsNavItem({
  value,
  icon,
  children,
  ...props
}: Omit<ComponentProps<typeof TabsTab>, 'value'> & {
  /** The section's `value`. */
  value: string
  /** Before the label, sized by the item. */
  icon?: ReactNode
}) {
  return (
    <TabsTab value={value} {...props}>
      {icon}
      {children}
    </TabsTab>
  )
}

/** One section: its heading, and the groups under it, shown while it's picked. */
function SettingsSection({
  value,
  title,
  description,
  className,
  children,
  ...props
}: Omit<
  ComponentProps<typeof TabsPanel>,
  'value' | 'title' | 'keepMounted' | 'children'
> & {
  children?: ReactNode
  /** Names the section for its SettingsNavItem, `section` and `onSectionChange`. */
  value: string
  title: string
  description?: ReactNode
}) {
  const { level } = useSettingsPage('SettingsSection')
  const Heading = level === 1 ? 'h2' : 'h3'
  return (
    <TabsPanel
      value={value}
      // Every section stays in the form while another shows, so its changes wait for Save.
      keepMounted
      data-settings-section=''
      data-value={value}
      {...props}
      className={cn(
        'flex w-full max-w-2xl min-w-0 flex-col gap-(--surface-padding-lg) rounded-(--surface-radius)',
        className,
      )}
    >
      <div className='flex min-w-0 flex-col gap-1'>
        <Heading className='text-lg font-semibold tracking-tight'>{title}</Heading>
        {description ? (
          <p className='text-muted-foreground text-sm'>{description}</p>
        ) : null}
      </div>
      {children}
    </TabsPanel>
  )
}

/** A card of related settings, in rows. `destructive` is the danger zone's: actions that can't be taken back. */
function SettingsGroup({
  title,
  description,
  variant = 'default',
  className,
  children,
  ...props
}: Omit<ComponentProps<'div'>, 'title'> & {
  title: ReactNode
  description?: ReactNode
  variant?: 'default' | 'destructive'
  /** SettingsRows, SettingsActions and SettingsPhotos. */
  children: ReactNode
}) {
  const id = useId()
  // A level under its section's heading, which is a level under the page's.
  const level = use(SettingsPageContext)?.level ?? 1
  return (
    <Card
      // A group of settings, named by its title: a landmark of its own would crowd the page's.
      role='group'
      aria-labelledby={id}
      data-slot='settings-group'
      {...props}
      className={cn(
        '@container gap-0 py-0',
        variant === 'destructive' && 'border-destructive/40 dark:border-destructive/50',
        className,
      )}
    >
      <CardHeader className='border-b py-(--surface-padding)'>
        <CardTitle
          id={id}
          render={
            level === 2
              ? // oxlint-disable-next-line jsx-a11y/heading-has-content -- the title's text goes in through the part's children.
                (props) => <h4 {...props} />
              : undefined
          }
          className={cn(variant === 'destructive' && 'text-destructive')}
        >
          {title}
        </CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <div className='flex min-w-0 flex-col divide-y'>{children}</div>
    </Card>
  )
}

/** Where a row's control sits: beside its label when there's room (`auto`), always beside it (`row`), or under it (`column`). */
type SettingsRowLayout = 'auto' | 'row' | 'column'

const rowLayouts: Record<SettingsRowLayout, string> = {
  // Under the label in a narrow card, the description beneath it; beside it from 28rem.
  auto: "[grid-template-areas:'label'_'message'_'control'] @md:grid-cols-[minmax(0,1fr)_auto] @md:gap-x-6 @md:[grid-template-areas:'label_control'_'message_control'] [&>[data-slot=settings-row-control]]:pt-2 @md:[&>[data-slot=settings-row-control]]:pt-0",
  row: "grid-cols-[minmax(0,1fr)_auto] gap-x-4 [grid-template-areas:'label_control'_'message_control']",
  column: '',
}

/**
 * One setting: its label and description at the start, its control at the
 * end. It is a Field, so the label names the control, the description
 * describes it, and `name` is what Save sends. A control made of options,
 * such as a Segmented control, takes `group`: the label then names the
 * group, and each option keeps its own name.
 */
function SettingsRow({
  name,
  label,
  description,
  layout = 'auto',
  group = false,
  className,
  children,
  ...props
}: Omit<ComponentProps<typeof Field>, 'children'> & {
  label: ReactNode
  description?: ReactNode
  layout?: SettingsRowLayout
  /** Whether the control is a group of options, such as a Segmented control or a Radio group. */
  group?: boolean
  /** The control: an Input, a Select, a Switch, a Segmented control. */
  children: ReactNode
}) {
  const labelId = useId()
  const descriptionId = useId()
  const labelClass = cn(layout !== 'column' && 'pb-0.5 self-end')
  return (
    <Field
      name={name}
      data-settings-row=''
      className={cn('p-(--surface-padding)', rowLayouts[layout], className)}
      {...props}
    >
      {group ? (
        // Not the Field's label, which would name every option after the row.
        <span
          id={labelId}
          className={cn(labelClassName, 'w-fit pb-2 [grid-area:label]', labelClass)}
        >
          {label}
        </span>
      ) : (
        <FieldLabel className={labelClass}>{label}</FieldLabel>
      )}
      <div
        role={group ? 'group' : undefined}
        aria-labelledby={group ? labelId : undefined}
        aria-describedby={group && description ? descriptionId : undefined}
        data-slot='settings-row-control'
        className={cn(
          'flex min-w-0 [grid-area:control]',
          // A text field takes the row's width, up to what a long email needs.
          layout === 'column'
            ? 'flex-col *:max-w-md'
            : // A control wider than a narrow card, such as a row of options, keeps inside it and scrolls.
              'items-center self-center *:max-w-full *:min-w-0 @md:justify-end',
        )}
      >
        {children}
      </div>
      {description ? (
        <FieldDescription
          id={descriptionId}
          className={cn(layout !== 'column' && 'pt-0.5')}
        >
          {description}
        </FieldDescription>
      ) : null}
      <FieldError />
    </Field>
  )
}

/** A row for an action rather than a value, such as the danger zone's: an Item, with the action at its end. */
function SettingsAction({
  title,
  description,
  className,
  children,
  ...props
}: Omit<ComponentProps<typeof Item>, 'title' | 'render'> & {
  title: ReactNode
  description?: ReactNode
  /** The action: a Button or a Confirm button. */
  children: ReactNode
}) {
  return (
    <Item
      data-slot='settings-action'
      {...props}
      className={cn(
        // A row of its group: its line under it where the group's other rows have theirs, and their padding.
        'rounded-none border-0 p-(--surface-padding) not-last:border-b not-last:border-border',
        className,
      )}
    >
      <ItemContent className='gap-0.5'>
        <ItemTitle>{title}</ItemTitle>
        {description ? (
          // As small as a setting's description, so the rows of a page read alike.
          <ItemDescription className='text-xs'>{description}</ItemDescription>
        ) : null}
      </ItemContent>
      <ItemActions>{children}</ItemActions>
    </Item>
  )
}

export {
  SettingsAction,
  SettingsChannel,
  SettingsGroup,
  SettingsNav,
  SettingsNavItem,
  SettingsPage,
  SettingsPhoto,
  SettingsRow,
  SettingsSection,
}

export { fitsBeside, scrollToTopBy }

export type { SettingsPhotoValue, SettingsRowLayout }
