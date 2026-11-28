'use client'

import { Textarea } from '@/registry/components/kino/textarea'
import {
  FilterListBody,
  FilterListRows,
  filterListGroupLabelClassName,
  filterListItemClassName,
  filterListNoticeClassName,
  filterListScrollerClassName,
  filterListSeparatorClassName,
  type MatchMode,
  MatchText,
} from '@/registry/lib/filter-list'
import { POPUP_COLLISION_PADDING, popupPlacedClassName } from '@/registry/lib/popup'
import { mergeRefs } from '@/registry/lib/refs'
import { useEdgeFades } from '@/registry/lib/scroll'
import {
  TriggerMenu as TriggerMenuPrimitive,
  TriggerMenuContent as TriggerMenuContentPrimitive,
  type TriggerMenuDataItem,
  TriggerMenuEmpty as TriggerMenuEmptyPrimitive,
  TriggerMenuGroup as TriggerMenuGroupPrimitive,
  TriggerMenuGroupLabel as TriggerMenuGroupLabelPrimitive,
  TriggerMenuHint as TriggerMenuHintPrimitive,
  TriggerMenuInput as TriggerMenuInputPrimitive,
  TriggerMenuItem as TriggerMenuItemPrimitive,
  TriggerMenuItemIcon as TriggerMenuItemIconPrimitive,
  TriggerMenuList as TriggerMenuListPrimitive,
  TriggerMenuSeparator as TriggerMenuSeparatorPrimitive,
  TriggerMenuStatus as TriggerMenuStatusPrimitive,
} from '@ui-sdk/react/trigger-menu'
import {
  type ComponentProps,
  createContext,
  Fragment,
  type ReactNode,
  use,
  useMemo,
} from 'react'

import { cn } from '@/lib/utils'

/*
 * ui-sdk's Trigger menu: suggestions that open at a character typed in a
 * field, @ for people, / for commands, # for tags, and put the pick in place
 * of what was typed. It is the Combobox's box, rows and gliding highlight,
 * grown out from under the character, while focus stays in the field. Inside
 * a Token input, it suggests into the token input, and a pick is a token.
 */

/** The characters that open the menu, by trigger, with how each one matches. */
const TriggersContext = createContext<ReadonlyMap<string, MatchMode | null>>(new Map())

/** What was typed after the trigger, and how its trigger matches, for the rows' marked text. */
const QueryContext = createContext<{ query: string; mode: MatchMode | null }>({
  query: '',
  mode: null,
})

/** The root: `triggers` are the characters that open it, and what each one lists. */
function TriggerMenu<T = string>(props: ComponentProps<typeof TriggerMenuPrimitive<T>>) {
  const { triggers } = props
  const modes = useMemo(
    () => new Map(triggers.map((each) => [each.char, matchModeOf(each.filter)])),
    [triggers],
  )
  return (
    <TriggersContext value={modes}>
      <TriggerMenuPrimitive<T> {...props} />
    </TriggersContext>
  )
}

/**
 * The marks a trigger's rows show, by how its `filter` matches: none for a
 * function or `false`, since only it knows what matched. Items a loader
 * brings are marked where they hold what was typed.
 */
function matchModeOf(filter: unknown): MatchMode | null {
  if (filter === undefined) return 'contains'
  return filter === 'contains' || filter === 'startsWith' || filter === 'fuzzy'
    ? filter
    : null
}

/**
 * The field to type in: Kino's Textarea, or a one-line field with
 * `render={<Input />}`. Leave it out inside a Token input.
 */
function TriggerMenuInput({
  render = <Textarea />,
  ...props
}: ComponentProps<typeof TriggerMenuInputPrimitive>) {
  return <TriggerMenuInputPrimitive render={render} {...props} />
}

/**
 * The box: it grows out from under the trigger character and folds back
 * into it, at one width while it is open, so a row that leaves never jolts
 * it narrower; a long row wraps. `className` goes on the box's content;
 * every other prop goes to ui-sdk's content.
 */
function TriggerMenuContent({
  className,
  children,
  side = 'bottom',
  align = 'start',
  sideOffset = 6,
  ...props
}: Omit<ComponentProps<typeof TriggerMenuContentPrimitive>, 'className' | 'children'> & {
  className?: string
  children?: ReactNode
}) {
  return (
    <TriggerMenuContentPrimitive
      data-filter-list-content=''
      side={side}
      align={align}
      sideOffset={sideOffset}
      collisionPadding={POPUP_COLLISION_PADDING}
      arrowPadding={0}
      className={cn(popupPlacedClassName, 'flex flex-col text-sm')}
      {...props}
    >
      {/* One width while it is open, whatever the caret it opens at, so a row that leaves never jolts it narrower. */}
      <FilterListBody
        presentation='popover'
        className={cn('w-[min(24rem,var(--popup-available-width))] min-w-0', className)}
      >
        {children}
      </FilterListBody>
    </TriggerMenuContentPrimitive>
  )
}

/**
 * The suggestions, with the highlight that glides between them: rows of
 * your own, a function of `{ trigger, query, items }` so each trigger lists
 * its own, or, without children, the trigger's `items`.
 */
function TriggerMenuList({
  className,
  children,
  ref,
  ...props
}: Omit<ComponentProps<typeof TriggerMenuListPrimitive>, 'className'> & {
  className?: string
}) {
  const fades = useEdgeFades<HTMLDivElement>()
  const refs = useMemo(() => mergeRefs(ref, fades), [ref, fades])
  const modes = use(TriggersContext)
  return (
    <TriggerMenuListPrimitive
      ref={refs}
      className={cn(filterListScrollerClassName, 'not-has-[[role=option]]:hidden')}
      {...props}
    >
      {(state) => (
        <QueryContext
          value={{
            query: state.query,
            // An argument's suggestions match as ui-sdk's lists do by default.
            mode: state.argument
              ? 'contains'
              : state.trigger
                ? (modes.get(state.trigger) ?? null)
                : null,
          }}
        >
          <FilterListRows className={className}>
            {typeof children === 'function'
              ? children(state)
              : (children ?? <DataItems items={state.items} />)}
          </FilterListRows>
        </QueryContext>
      )}
    </TriggerMenuListPrimitive>
  )
}

/** A trigger's `items`, as Kino's rows. */
function DataItems({ items }: { items: readonly unknown[] }) {
  return items.map((entry, index) => {
    if (typeof entry === 'string') {
      return (
        <TriggerMenuItem key={entry} value={entry} label={entry}>
          <TriggerMenuItemText>{entry}</TriggerMenuItemText>
        </TriggerMenuItem>
      )
    }
    const node = entry as
      | { type: 'separator' }
      | { type: 'group'; label: string; items: readonly unknown[] }
      | TriggerMenuDataItem<unknown>
    if ('type' in node && node.type === 'separator') {
      return <TriggerMenuSeparator key={`separator-${index}`} />
    }
    if ('type' in node && node.type === 'group' && 'items' in node) {
      return (
        <TriggerMenuGroup key={`group-${node.label}`}>
          <TriggerMenuGroupLabel>{node.label}</TriggerMenuGroupLabel>
          <DataItems items={node.items} />
        </TriggerMenuGroup>
      )
    }
    const item = node as TriggerMenuDataItem<unknown>
    return (
      <Fragment key={String(item.value)}>
        <TriggerMenuItem
          value={item.value}
          label={item.label}
          keywords={item.keywords}
          disabled={item.disabled}
        >
          <TriggerMenuItemText>{item.label}</TriggerMenuItemText>
        </TriggerMenuItem>
      </Fragment>
    )
  })
}

/** A suggestion: the menus' row. Its `label` is what it is matched by and inserts. */
function TriggerMenuItem<T = string>({
  className,
  ...props
}: Omit<ComponentProps<typeof TriggerMenuItemPrimitive<T>>, 'className'> & {
  className?: string
}) {
  return (
    <TriggerMenuItemPrimitive<T>
      data-menu-row=''
      className={cn(filterListItemClassName, className)}
      {...props}
    />
  )
}

/**
 * A suggestion's text with the part that matches what was typed in bold, so
 * the eye finds why it matched. ui-sdk's other lists mark it themselves; the
 * Trigger menu's leaves it to its rows.
 */
function TriggerMenuItemText(
  props: Omit<ComponentProps<typeof MatchText>, 'query' | 'mode'>,
) {
  const { query, mode } = use(QueryContext)
  return <MatchText query={query} mode={mode} {...props} />
}

/** A suggestion's icon, before its text. */
function TriggerMenuItemIcon({
  className,
  ...props
}: Omit<ComponentProps<typeof TriggerMenuItemIconPrimitive>, 'className'> & {
  className?: string
}) {
  return (
    <TriggerMenuItemIconPrimitive
      className={cn(
        "flex shrink-0 items-center [&_svg:not([class*='text-'])]:text-muted-foreground",
        className,
      )}
      {...props}
    />
  )
}

function TriggerMenuGroup(props: ComponentProps<typeof TriggerMenuGroupPrimitive>) {
  return <TriggerMenuGroupPrimitive {...props} />
}

function TriggerMenuGroupLabel({
  className,
  ...props
}: Omit<ComponentProps<typeof TriggerMenuGroupLabelPrimitive>, 'className'> & {
  className?: string
}) {
  return (
    <TriggerMenuGroupLabelPrimitive
      className={cn(filterListGroupLabelClassName, className)}
      {...props}
    />
  )
}

function TriggerMenuSeparator({
  className,
  ...props
}: Omit<ComponentProps<typeof TriggerMenuSeparatorPrimitive>, 'className'> & {
  className?: string
}) {
  return (
    <TriggerMenuSeparatorPrimitive
      className={cn(filterListSeparatorClassName, className)}
      {...props}
    />
  )
}

/** What shows when nothing matches, or while a loader looks: say what was looked for. */
function TriggerMenuEmpty({
  className,
  ...props
}: Omit<ComponentProps<typeof TriggerMenuEmptyPrimitive>, 'className'> & {
  className?: string
}) {
  return (
    <TriggerMenuEmptyPrimitive
      className={cn(filterListNoticeClassName, 'not-data-empty:hidden', className)}
      {...props}
    />
  )
}

/**
 * What a screen reader hears once typing pauses: how many suggestions there
 * are, and the keys. It is heard, not seen, unless you give it a look.
 */
function TriggerMenuStatus({
  className,
  ...props
}: Omit<ComponentProps<typeof TriggerMenuStatusPrimitive>, 'className'> & {
  className?: string
}) {
  return <TriggerMenuStatusPrimitive className={cn('sr-only', className)} {...props} />
}

/** Ghost text at the caret for a command's arguments still to type, such as `<status>`. */
function TriggerMenuHint({
  className,
  ...props
}: Omit<ComponentProps<typeof TriggerMenuHintPrimitive>, 'className'> & {
  className?: string
}) {
  return (
    <TriggerMenuHintPrimitive
      className={cn('text-muted-foreground pointer-events-none', className)}
      {...props}
    />
  )
}

export {
  TriggerMenu,
  TriggerMenuContent,
  TriggerMenuEmpty,
  TriggerMenuGroup,
  TriggerMenuGroupLabel,
  TriggerMenuHint,
  TriggerMenuInput,
  TriggerMenuItem,
  TriggerMenuItemIcon,
  TriggerMenuItemText,
  TriggerMenuList,
  TriggerMenuSeparator,
  TriggerMenuStatus,
  matchModeOf,
}
