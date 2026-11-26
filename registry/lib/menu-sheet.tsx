'use client'

import {
  Drawer,
  DrawerContent,
  DrawerTitle,
  DrawerTrigger,
} from '@/registry/components/kino/drawer'
import { Separator } from '@/registry/components/kino/separator'
import { useControllable } from '@/registry/lib/controllable'
import { followPointer, itemMatching } from '@/registry/lib/highlight'
import {
  MenuContent,
  MenuHighlight,
  MenuItem,
  MenuLabel,
  MenuLinkItem,
  MenuRadioItem,
  MenuSeparator,
  MenuShortcut,
  MenuSubContent,
  MenuSubTrigger,
  menuInset,
  menuLabelClassName,
  menuPickedRowClassName,
  menuRowVariants,
  menuSeparatorClassName,
} from '@/registry/lib/menu'
import { useRoomy } from '@/registry/lib/roomy'
import { edgeFadeClassName, followEdges } from '@/registry/lib/scroll'
import { createChangeEventDetails } from '@base-ui/react/internals/createBaseUIEventDetails'
import { Menu as MenuPrimitive } from '@base-ui/react/menu'
import { mergeProps } from '@base-ui/react/merge-props'
import { Radio as RadioPrimitive } from '@base-ui/react/radio'
import { RadioGroup as RadioGroupPrimitive } from '@base-ui/react/radio-group'
import { useRender } from '@base-ui/react/use-render'
import {
  type ComponentProps,
  createContext,
  type MouseEvent,
  type ReactNode,
  use,
  useEffect,
  useId,
  useRef,
} from 'react'

import { cn } from '@/lib/utils'

/*
 * A menu that opens as a bottom sheet on a phone. On a wider screen its parts
 * are the Dropdown menu's, growing from the trigger with one highlight
 * gliding between the rows. Below 40rem the same parts open in a Drawer, a
 * dialog rather than a menu: items become buttons and links, a radio group
 * becomes radios, and a submenu's rows sit in place under its name, since a
 * sheet has no room beside it. Rows there are a control tall, for a finger,
 * and the highlight follows the pointer and the keyboard's focus.
 */

interface MenuSheetContextValue {
  sheet: boolean
  /** Closes it after a row in it was pressed with `event`. */
  close: (event: globalThis.MouseEvent) => void
}

/** Why it opened or closed: the Menu's details, or on a phone the Drawer's. */
type MenuSheetOpenChangeDetails =
  | MenuPrimitive.Root.ChangeEventDetails
  | Parameters<NonNullable<ComponentProps<typeof Drawer>['onOpenChange']>>[1]

const MenuSheetContext = createContext<MenuSheetContextValue>({
  sheet: false,
  close: () => {},
})

/** Inside a sheet's group: the id its label takes, which names the group. */
const GroupLabelContext = createContext<string | undefined>(undefined)

/** Inside a sheet's submenu: its rows sit in place under its name. */
const SubContext = createContext(false)

/** Props for a sheet's plain element: what only Base UI's menu parts read is left out. */
function sheetProps<Props extends object>(props: Props) {
  const rest = { ...props } as Record<string, unknown>
  delete rest.label
  delete rest.nativeButton
  delete rest.render
  delete rest.closeOnClick
  return rest
}

function useMenuSheet() {
  return use(MenuSheetContext)
}

/**
 * The menu, or on a phone the Drawer. `open`, `defaultOpen` and
 * `onOpenChange` hold for both, and so does `modal`; every other prop goes to
 * Base UI's Menu.
 */
function MenuSheet<Payload>({
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  children,
  ...props
}: Omit<MenuPrimitive.Root.Props<Payload>, 'open' | 'defaultOpen' | 'onOpenChange'> & {
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean, eventDetails: MenuSheetOpenChangeDetails) => void
}) {
  const sheet = !useRoomy()
  const [open, change] = useControllable<boolean, [MenuSheetOpenChangeDetails]>(
    openProp,
    defaultOpen,
    onOpenChange,
  )
  const context = {
    sheet,
    close: (event: globalThis.MouseEvent) =>
      change(false, createChangeEventDetails('item-press', event)),
  }
  return (
    <MenuSheetContext value={context}>
      {sheet ? (
        <Drawer
          open={open}
          onOpenChange={change}
          {...(props.modal === undefined ? {} : { modal: props.modal })}
        >
          {/* A trigger that passes a payload is the menu's; the drawer opens from its own trigger. */}
          {typeof children === 'function' ? children({ payload: undefined }) : children}
        </Drawer>
      ) : (
        <MenuPrimitive.Root<Payload> open={open} onOpenChange={change} {...props}>
          {children}
        </MenuPrimitive.Root>
      )}
    </MenuSheetContext>
  )
}

/** The button that opens it: Base UI's Menu trigger, or the Drawer's. */
function MenuSheetTrigger(
  props: Omit<
    MenuPrimitive.Trigger.Props,
    'openOnHover' | 'delay' | 'closeDelay' | 'handle' | 'payload'
  >,
) {
  const { sheet } = useMenuSheet()
  if (sheet) {
    return (
      <DrawerTrigger
        data-menu-sheet-trigger=''
        {...(props as ComponentProps<typeof DrawerTrigger>)}
      />
    )
  }
  return <MenuPrimitive.Trigger data-slot='menu-sheet-trigger' {...props} />
}

/** The rows of a sheet, with the highlight that follows the pointer and the keyboard. */
function SheetList({ className, children }: { className?: string; children: ReactNode }) {
  const listRef = useRef<HTMLDivElement>(null)
  const layerRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const list = listRef.current
    if (!list || !layerRef.current) return
    const stopPointer = followPointer(list, layerRef.current, {
      itemOf: itemMatching(list, '[data-menu-row]'),
      focus: true,
    })
    const stopEdges = followEdges(list, '--scroll-fade')
    return () => {
      stopPointer()
      stopEdges()
    }
  }, [])
  return (
    <div
      ref={listRef}
      data-slot='menu-list'
      className={cn(
        'group/menu scrollbar-thin relative flex min-h-0 flex-col overflow-x-hidden overflow-y-auto overscroll-contain px-2 pt-1 pb-3 text-sm',
        edgeFadeClassName,
        className,
      )}
    >
      <MenuHighlight ref={layerRef} />
      {children}
    </div>
  )
}

/**
 * The menu's box, or the sheet. `title` names the sheet for a screen reader;
 * the menu takes its name from the trigger. `className` goes to the list of
 * rows.
 */
function MenuSheetContent({
  title,
  className,
  children,
  side,
  align,
  sideOffset,
  alignOffset,
  ...props
}: Omit<ComponentProps<typeof MenuContent>, 'title'> & {
  /** What the sheet is, such as "Account", read when it opens. */
  title: string
}) {
  const { sheet } = useMenuSheet()
  if (sheet) {
    return (
      <DrawerContent
        data-menu-sheet-content=''
        showCloseButton={false}
        {...(sheetProps(props) as ComponentProps<typeof DrawerContent>)}
      >
        <DrawerTitle className='sr-only'>{title}</DrawerTitle>
        <SheetList className={className}>{children}</SheetList>
      </DrawerContent>
    )
  }
  return (
    <MenuContent
      data-slot='menu-sheet-content'
      side={side}
      align={align}
      sideOffset={sideOffset}
      alignOffset={alignOffset}
      className={className}
      {...props}
    >
      {children}
    </MenuContent>
  )
}

/** A row a finger can press: a control tall, not a menu's small row. */
const sheetRowClassName =
  'min-h-(--control-height) focus-visible:outline-hidden forced-colors:focus-visible:outline-2 forced-colors:focus-visible:outline-[Highlight]'

type ItemProps = ComponentProps<typeof MenuItem>

/** A sheet's row that acts: a button that closes the sheet, unless `closeOnClick` is false. */
function SheetItem({
  className,
  variant = 'default',
  closeOnClick = true,
  disabled,
  render,
  onClick,
  ...props
}: ItemProps) {
  const { close } = useMenuSheet()
  return useRender({
    defaultTagName: 'button',
    render: render as useRender.RenderProp,
    props: mergeProps<'button'>(
      {
        type: 'button',
        disabled,
        'data-menu-row': '',
        'data-variant': variant ?? 'default',
        'data-disabled': disabled ? '' : undefined,
        className: cn(
          menuRowVariants({ variant }),
          menuInset,
          sheetRowClassName,
          className,
        ),
        onClick: (event: MouseEvent<HTMLButtonElement>) => {
          ;(onClick as ((event: MouseEvent<HTMLButtonElement>) => void) | undefined)?.(
            event,
          )
          if (closeOnClick && !event.defaultPrevented) close(event.nativeEvent)
        },
      } as ComponentProps<'button'>,
      sheetProps(props) as ComponentProps<'button'>,
    ),
  })
}

function MenuSheetItem(props: ItemProps) {
  const { sheet } = useMenuSheet()
  if (sheet) return <SheetItem data-slot='menu-sheet-item' {...props} />
  return <MenuItem data-slot='menu-sheet-item' {...props} />
}

/** A row that navigates: an `<a>` in the menu and in the sheet. */
function MenuSheetLinkItem({
  className,
  variant = 'default',
  closeOnClick = true,
  onClick,
  ...props
}: ComponentProps<typeof MenuLinkItem>) {
  const { sheet, close } = useMenuSheet()
  if (!sheet) {
    return (
      <MenuLinkItem
        data-slot='menu-sheet-link-item'
        variant={variant}
        closeOnClick={closeOnClick}
        onClick={onClick}
        className={className}
        {...props}
      />
    )
  }
  return (
    <SheetLink
      render={props.render}
      className={className}
      variant={variant}
      onClick={(event) => {
        ;(onClick as ((event: MouseEvent<HTMLAnchorElement>) => void) | undefined)?.(
          event,
        )
        if (closeOnClick && !event.defaultPrevented) close(event.nativeEvent)
      }}
      {...(sheetProps(props) as ComponentProps<'a'>)}
    />
  )
}

function SheetLink({
  render,
  className,
  variant,
  ...props
}: ComponentProps<'a'> & {
  render?: ComponentProps<typeof MenuLinkItem>['render']
  variant: ItemProps['variant']
}) {
  return useRender({
    defaultTagName: 'a',
    render: render as useRender.RenderProp,
    props: mergeProps<'a'>(
      {
        'data-slot': 'menu-sheet-link-item',
        'data-menu-row': '',
        'data-variant': variant ?? 'default',
        className: cn(
          menuRowVariants({ variant }),
          menuInset,
          sheetRowClassName,
          className,
        ),
      } as ComponentProps<'a'>,
      props,
    ),
  })
}

/** Rows that belong together, named by their label. */
function MenuSheetGroup({
  className,
  ...props
}: Omit<MenuPrimitive.Group.Props, 'className'> & { className?: string }) {
  const { sheet } = useMenuSheet()
  const id = useId()
  if (sheet) {
    return (
      <GroupLabelContext value={id}>
        <div
          role='group'
          aria-labelledby={id}
          data-slot='menu-sheet-group'
          className={cn('flex flex-col', className)}
          {...(sheetProps(props) as ComponentProps<'div'>)}
        />
      </GroupLabelContext>
    )
  }
  return (
    <MenuPrimitive.Group data-slot='menu-sheet-group' className={className} {...props} />
  )
}

/** A group's heading, which names it. */
function MenuSheetLabel({
  className,
  ...props
}: Omit<MenuPrimitive.GroupLabel.Props, 'className'> & { className?: string }) {
  const { sheet } = useMenuSheet()
  const id = use(GroupLabelContext)
  if (sheet) {
    return (
      <div
        id={id}
        data-slot='menu-sheet-label'
        className={cn(menuLabelClassName, className)}
        {...(sheetProps(props) as ComponentProps<'div'>)}
      />
    )
  }
  return <MenuLabel data-slot='menu-sheet-label' className={className} {...props} />
}

function MenuSheetSeparator({
  className,
  ...props
}: Omit<MenuPrimitive.Separator.Props, 'className'> & { className?: string }) {
  const { sheet } = useMenuSheet()
  if (sheet) {
    return (
      <Separator
        data-menu-sheet-separator=''
        className={cn(menuSeparatorClassName, 'mx-0', className)}
        {...(sheetProps(props) as ComponentProps<typeof Separator>)}
      />
    )
  }
  return (
    <MenuSeparator data-slot='menu-sheet-separator' className={className} {...props} />
  )
}

/** Keys that do the same: shown in the menu only, since a phone has no keyboard to press them. */
function MenuSheetShortcut(props: ComponentProps<typeof MenuShortcut>) {
  const { sheet } = useMenuSheet()
  if (sheet) return null
  return <MenuShortcut data-slot='menu-sheet-shortcut' {...props} />
}

/**
 * Inside a group whose pick closes the menu: what is picked, and the pick.
 * In the sheet its rows are then buttons, not radios, so an arrow key never
 * makes a pick that changes the page.
 */
const PickContext = createContext<{
  closes: boolean
  value: unknown
  pick: (value: unknown, event: globalThis.MouseEvent) => void
} | null>(null)

/**
 * One choice of several: the menu's radio rows, or radios in the sheet,
 * which stays open. With `closeOnClick`, a pick closes it, for a pick that
 * changes the page, such as a workspace; in the sheet those rows are buttons
 * marked `aria-current`. `onValueChange` hears the event that made the pick.
 */
function MenuSheetRadioGroup<Value>({
  value: valueProp,
  defaultValue,
  onValueChange,
  closeOnClick = false,
  className,
  children,
  ...props
}: Omit<
  MenuPrimitive.RadioGroup.Props,
  'value' | 'defaultValue' | 'onValueChange' | 'className'
> & {
  value?: Value
  defaultValue?: Value
  onValueChange?: (value: Value, event: Event | undefined) => void
  /** A pick closes the menu or the sheet. */
  closeOnClick?: boolean
  className?: string
}) {
  const { sheet, close } = useMenuSheet()
  const id = useId()
  const [value, setValue] = useControllable<Value | undefined>(
    valueProp,
    defaultValue,
    undefined,
  )
  const change = (next: Value, event: Event | undefined) => {
    setValue(next)
    onValueChange?.(next, event)
  }
  const pickContext = {
    closes: closeOnClick,
    value,
    pick: (next: unknown, event: globalThis.MouseEvent) => {
      change(next as Value, event)
      close(event)
    },
  }
  if (sheet && closeOnClick) {
    return (
      <GroupLabelContext value={id}>
        <PickContext value={pickContext}>
          <div
            role='group'
            data-slot='menu-sheet-radio-group'
            aria-labelledby={props['aria-label'] ? undefined : id}
            className={cn('flex flex-col', className)}
            {...(sheetProps(props) as ComponentProps<'div'>)}
          >
            {children}
          </div>
        </PickContext>
      </GroupLabelContext>
    )
  }
  if (sheet) {
    return (
      <GroupLabelContext value={id}>
        <RadioGroupPrimitive<Value>
          data-slot='menu-sheet-radio-group'
          value={value}
          onValueChange={(next, details) => change(next, details.event)}
          aria-labelledby={props['aria-label'] ? undefined : id}
          className={cn('flex flex-col', className)}
          {...(sheetProps(props) as RadioGroupPrimitive.Props<Value>)}
        >
          {children}
        </RadioGroupPrimitive>
      </GroupLabelContext>
    )
  }
  return (
    <PickContext value={pickContext}>
      <MenuPrimitive.RadioGroup
        data-slot='menu-sheet-radio-group'
        value={value}
        onValueChange={(next: Value, details) => change(next, details.event)}
        className={className}
        {...props}
      >
        {children}
      </MenuPrimitive.RadioGroup>
    </PickContext>
  )
}

function MenuSheetRadioItem({
  className,
  children,
  closeOnClick,
  ...props
}: ComponentProps<typeof MenuRadioItem>) {
  const { sheet } = useMenuSheet()
  const group = use(PickContext)
  if (!sheet) {
    return (
      <MenuRadioItem
        data-slot='menu-sheet-radio-item'
        closeOnClick={closeOnClick ?? group?.closes}
        className={className}
        {...props}
      >
        {children}
      </MenuRadioItem>
    )
  }
  if (group?.closes) {
    const current = Object.is(group.value, props.value)
    return (
      <button
        type='button'
        data-slot={
          (props as { 'data-slot'?: string })['data-slot'] ?? 'menu-sheet-radio-item'
        }
        data-menu-row=''
        aria-current={current ? 'true' : undefined}
        disabled={props.disabled}
        onClick={(event) => group.pick(props.value, event.nativeEvent)}
        className={cn(
          menuRowVariants(),
          'group/menu-row',
          menuInset,
          sheetRowClassName,
          menuPickedRowClassName,
          className,
        )}
      >
        {children}
      </button>
    )
  }
  return (
    <RadioPrimitive.Root
      data-slot='menu-sheet-radio-item'
      data-menu-row=''
      nativeButton
      render={(buttonProps) => <button type='button' {...buttonProps} />}
      className={cn(
        menuRowVariants(),
        'group/menu-row',
        menuInset,
        sheetRowClassName,
        menuPickedRowClassName,
        className,
      )}
      {...(sheetProps(props) as unknown as RadioPrimitive.Root.Props)}
    >
      {children}
    </RadioPrimitive.Root>
  )
}

/** A submenu in the menu; in the sheet, its rows in place under its name. */
function MenuSheetSub({ children, ...props }: MenuPrimitive.SubmenuRoot.Props) {
  const { sheet } = useMenuSheet()
  if (sheet) {
    return (
      <SubContext value={true}>
        <MenuSheetGroup>{children}</MenuSheetGroup>
      </SubContext>
    )
  }
  return <MenuPrimitive.SubmenuRoot {...props}>{children}</MenuPrimitive.SubmenuRoot>
}

/**
 * The row that opens a submenu. In the sheet it is the heading of the rows
 * under it, showing `sheetLabel` (its own content when left out).
 */
function MenuSheetSubTrigger({
  sheetLabel,
  children,
  ...props
}: ComponentProps<typeof MenuSubTrigger> & {
  /** What the heading reads in the sheet, such as "Theme" where the row reads "Theme: System". */
  sheetLabel?: ReactNode
}) {
  const { sheet } = useMenuSheet()
  if (sheet && use(SubContext)) {
    return (
      <MenuSheetLabel data-slot={(props as { 'data-slot'?: string })['data-slot']}>
        {sheetLabel ?? children}
      </MenuSheetLabel>
    )
  }
  return (
    <MenuSubTrigger data-slot='menu-sheet-sub-trigger' {...props}>
      {children}
    </MenuSubTrigger>
  )
}

function MenuSheetSubContent({
  children,
  ...props
}: ComponentProps<typeof MenuSubContent>) {
  const { sheet } = useMenuSheet()
  if (sheet) return children
  return (
    <MenuSubContent data-slot='menu-sheet-sub-content' {...props}>
      {children}
    </MenuSubContent>
  )
}

export {
  MenuSheet,
  MenuSheetContent,
  MenuSheetGroup,
  MenuSheetItem,
  MenuSheetLabel,
  MenuSheetLinkItem,
  MenuSheetRadioGroup,
  MenuSheetRadioItem,
  MenuSheetSeparator,
  MenuSheetShortcut,
  MenuSheetSub,
  MenuSheetSubContent,
  MenuSheetSubTrigger,
  MenuSheetTrigger,
  useMenuSheet,
}

export { sheetProps }
export type { MenuSheetOpenChangeDetails }
