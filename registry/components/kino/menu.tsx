'use client'

import { KbdGroup } from '@/registry/components/kino/kbd'
import { IconPlaceholder } from '@/registry/icons/icon-placeholder'
import { followRows, tintedRowTextClassName } from '@/registry/lib/highlight'
import { useAriaKeyshortcuts } from '@/registry/lib/keys'
import {
  listIndicatorClassName,
  menuGutterClassName,
  MenuHighlight,
  menuIndicatorSlot,
  menuInset,
  menuLabelClassName,
  menuPickedRowClassName,
  menuRowVariants,
  menuSeparatorClassName,
  menuShortcutClassName,
  MenuTick,
} from '@/registry/lib/list-rows'
import {
  PanelHandle,
  panelSheetBackdropClassName,
  popupSheetClassName,
  popupSheetPanelClassName,
} from '@/registry/lib/panel'
import {
  POPUP_COLLISION_PADDING,
  popupGrowBoxClassName,
  popupGrowContentClassName,
  popupPlacedClassName,
  popupSurfaceClassName,
  usePopupPresentation,
} from '@/registry/lib/popup'
import { mergeRefs } from '@/registry/lib/refs'
import { edgeFadeClassName, followEdges } from '@/registry/lib/scroll'
import {
  Menu as MenuPrimitive,
  MenuCheckboxItem as MenuCheckboxItemPrimitive,
  MenuContent as MenuContentPrimitive,
  MenuContextTrigger as MenuContextTriggerPrimitive,
  MenuGroup as MenuGroupPrimitive,
  MenuGroupLabel as MenuGroupLabelPrimitive,
  MenuItem as MenuItemPrimitive,
  MenuItemIcon as MenuItemIconPrimitive,
  MenuItemIndicator as MenuItemIndicatorPrimitive,
  MenuRadioGroup as MenuRadioGroupPrimitive,
  MenuRadioItem as MenuRadioItemPrimitive,
  MenuSeparator as MenuSeparatorPrimitive,
  MenuShortcut as MenuShortcutPrimitive,
  MenuSub as MenuSubPrimitive,
  MenuSubContent as MenuSubContentPrimitive,
  MenuSubTrigger as MenuSubTriggerPrimitive,
  MenuTrigger as MenuTriggerPrimitive,
} from '@ui-sdk/react/menu'
import {
  type ComponentProps,
  createContext,
  type ReactNode,
  type Ref,
  type RefCallback,
  use,
  useMemo,
} from 'react'

import { cn } from '@/lib/utils'

/*
 * A menu of actions and settings, opened from a button or by a right click.
 * It grows out of what opened it and folds back into it, and one highlight
 * glides between its rows, across separators and into its submenus.
 */

/** Tells the presentation where the trigger is, to read the motion preference there. */
const TriggerContext = createContext<((element: HTMLElement | null) => void) | null>(null)

/**
 * With `presentation='auto'`, a small touch screen opens it as a sheet,
 * unless motion is reduced around its trigger (`popupPresentation`). A
 * context menu and a Menubar's menus are always popovers.
 */
function Menu({
  presentation = 'popover',
  ...props
}: ComponentProps<typeof MenuPrimitive>) {
  const [shown, setTrigger] = usePopupPresentation(presentation)
  return (
    <TriggerContext value={setTrigger}>
      <MenuPrimitive presentation={shown} {...props} />
    </TriggerContext>
  )
}

/** What opens it, such as a Button, through `render`. */
function MenuTrigger({ ref, ...props }: ComponentProps<typeof MenuTriggerPrimitive>) {
  const setTrigger = use(TriggerContext)
  const refs = useMemo(() => mergeRefs(setTrigger, ref), [setTrigger, ref])
  return <MenuTriggerPrimitive ref={refs} {...props} />
}

/**
 * The area that opens it on a right click, a long press or Shift F10. Give
 * it `tabIndex={0}` where nothing inside it takes focus, so the keyboard
 * reaches it too.
 */
function MenuContextTrigger({
  className,
  ...props
}: Omit<ComponentProps<typeof MenuContextTriggerPrimitive>, 'className'> & {
  className?: string
}) {
  return (
    <MenuContextTriggerPrimitive className={cn('select-none', className)} {...props} />
  )
}

/** A ref for the rows: the highlight that glides between them, and the list's fading edges. */
const followMenu: RefCallback<HTMLDivElement> = (rows) => {
  const list = rows?.parentElement
  const content = rows?.closest<HTMLElement>('[data-menu-content]')
  const layer = rows?.querySelector<HTMLElement>(':scope > [data-slot=menu-highlight]')
  if (!rows || !list || !content || !layer) return
  const stops = [
    followRows(rows, layer, { popup: content, bounds: list }),
    followEdges(list, '--scroll-fade'),
  ]
  return () => {
    for (const stop of stops) stop()
  }
}

/** What the box takes: ui-sdk's content props, with `className` for the list of rows. */
type MenuContentProps = Omit<
  ComponentProps<typeof MenuContentPrimitive>,
  'className' | 'children'
> & {
  className?: string
  children?: ReactNode
}

/**
 * The box: it grows out of what opened it and folds back into it, or as a
 * sheet, it has a handle. A list taller than the screen, or than
 * `--menu-max-height` (24rem unless a menu that holds more sets it), scrolls.
 */
function MenuBox({
  Content,
  className,
  children,
  ...props
}: MenuContentProps & { Content: typeof MenuContentPrimitive }) {
  return (
    <Content
      data-menu-content=''
      collisionPadding={POPUP_COLLISION_PADDING}
      arrowPadding={0}
      className={cn(
        popupPlacedClassName,
        panelSheetBackdropClassName,
        'flex max-h-[min(var(--available-height),var(--menu-max-height,24rem))] max-w-[max(12rem,min(20rem,var(--available-width)))] flex-col text-sm',
        popupSheetClassName,
      )}
      {...props}
    >
      {({ presentation }) => (
        <div
          className={cn(
            'flex min-h-0 flex-1 flex-col',
            // A sheet opens on a touch screen, where there are no keys to show.
            presentation === 'sheet'
              ? cn(popupSheetPanelClassName, '**:data-menu-shortcut:hidden')
              : cn(
                  'relative rounded-(--list-radius)',
                  popupSurfaceClassName,
                  popupGrowBoxClassName,
                ),
          )}
        >
          {presentation === 'sheet' ? <PanelHandle /> : null}
          {/* The rows scroll inside the surface, so their fading edges leave its shadow, ring and outline whole. Never sideways: at some zooms a scrollbar takes a fraction of a pixel more than the box made room for. */}
          <div
            className={cn(
              'scrollbar-thin relative min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain rounded-[inherit]',
              edgeFadeClassName,
            )}
          >
            <div
              ref={followMenu}
              className={cn(
                // The 4px around the rows is the highlight's margin, not a
                // surface's padding, so it stays the same at every density. The
                // width follows the longest row, from 12rem.
                'group/menu relative flex min-w-48 flex-col p-1',
                menuGutterClassName,
                // A sheet spans the screen: its rows take a control's height for a finger, and they and their lines sit inside its edges.
                presentation === 'sheet'
                  ? 'px-2 pt-1 pb-3 **:data-menu-row:min-h-(--control-height) **:[[role=separator]]:mx-0'
                  : popupGrowContentClassName,
                className,
              )}
            >
              <MenuHighlight />
              {children}
            </div>
          </div>
        </div>
      )}
    </Content>
  )
}

/**
 * The menu: under its trigger, or at the pointer for a context menu.
 * `className` goes to the list of rows; every other prop goes to ui-sdk's
 * content.
 */
function MenuContent({
  side = 'bottom',
  align = 'start',
  sideOffset = 6,
  ...props
}: MenuContentProps) {
  return (
    <MenuBox
      Content={MenuContentPrimitive}
      side={side}
      align={align}
      sideOffset={sideOffset}
      {...props}
    />
  )
}

/**
 * A row that acts. `onSelect` runs it, or the menu's `onAction` with its
 * `value`; render it as a link with `render={<a href='…' />}`.
 */
function MenuItem({
  className,
  ref,
  destructive = false,
  shortcut,
  children,
  ...props
}: Omit<ComponentProps<typeof MenuItemPrimitive>, 'className' | 'children' | 'shortcut'> &
  ShortcutProps & {
    className?: string
    children?: ReactNode
  }) {
  return (
    <MenuItemPrimitive
      data-menu-row=''
      data-variant={destructive ? 'destructive' : 'default'}
      destructive={destructive}
      ref={useShortcutRef(shortcut, ref)}
      className={cn(
        menuRowVariants({ variant: destructive ? 'destructive' : 'default' }),
        menuInset,
        className,
      )}
      {...props}
    >
      {children}
      {shortcut ? <MenuShortcut shortcut={shortcut} /> : null}
    </MenuItemPrimitive>
  )
}

/** A row that turns a setting on and off, with a tick in the gutter. */
function MenuCheckboxItem({
  className,
  ref,
  shortcut,
  children,
  ...props
}: Omit<ComponentProps<typeof MenuCheckboxItemPrimitive>, 'className' | 'children'> &
  ShortcutProps & {
    className?: string
    children?: ReactNode
  }) {
  return (
    <MenuCheckboxItemPrimitive
      data-menu-row=''
      ref={useShortcutRef(shortcut, ref)}
      className={cn(menuRowVariants(), 'group/menu-row', className)}
      {...props}
    >
      <span data-menu-indicator='' className={menuIndicatorSlot}>
        <MenuItemIndicatorPrimitive keepMounted className={listIndicatorClassName}>
          <MenuTick />
        </MenuItemIndicatorPrimitive>
      </span>
      {children}
      {shortcut ? <MenuShortcut shortcut={shortcut} /> : null}
    </MenuCheckboxItemPrimitive>
  )
}

/**
 * A row's icon, before its text: screen readers and typing to a row skip it,
 * and `mirror` flips one that points a way in right to left.
 */
function MenuItemIcon({
  className,
  ...props
}: Omit<ComponentProps<typeof MenuItemIconPrimitive>, 'className'> & {
  className?: string
}) {
  return (
    <MenuItemIconPrimitive
      data-menu-icon=''
      className={cn('flex shrink-0 items-center', className)}
      {...props}
    />
  )
}

function MenuRadioGroup<T extends string = string>(
  props: ComponentProps<typeof MenuRadioGroupPrimitive<T>>,
) {
  return <MenuRadioGroupPrimitive<T> {...props} />
}

/** One choice of a radio group: the picked one is tinted, with a medium label. */
function MenuRadioItem({
  className,
  ref,
  shortcut,
  children,
  ...props
}: Omit<ComponentProps<typeof MenuRadioItemPrimitive>, 'className' | 'children'> &
  ShortcutProps & {
    className?: string
    children?: ReactNode
  }) {
  return (
    <MenuRadioItemPrimitive
      data-menu-row=''
      ref={useShortcutRef(shortcut, ref)}
      className={cn(
        menuRowVariants(),
        'group/menu-row',
        menuInset,
        menuPickedRowClassName,
        className,
      )}
      {...props}
    >
      {children}
      {shortcut ? <MenuShortcut shortcut={shortcut} /> : null}
    </MenuRadioItemPrimitive>
  )
}

function MenuGroup(props: ComponentProps<typeof MenuGroupPrimitive>) {
  return <MenuGroupPrimitive {...props} />
}

/** A group's heading, which names it, lined up with the rows' text past any tick's gutter. */
function MenuGroupLabel({
  className,
  ...props
}: Omit<ComponentProps<typeof MenuGroupLabelPrimitive>, 'className'> & {
  className?: string
}) {
  return (
    <MenuGroupLabelPrimitive className={cn(menuLabelClassName, className)} {...props} />
  )
}

/** The Separator's line between groups of rows, across the list's 4px margin. */
function MenuSeparator({
  className,
  ...props
}: Omit<ComponentProps<typeof MenuSeparatorPrimitive>, 'className'> & {
  className?: string
}) {
  return (
    <MenuSeparatorPrimitive
      className={cn(menuSeparatorClassName, className)}
      {...props}
    />
  )
}

interface ShortcutProps {
  /**
   * The keys that do the same as the row, as ui-sdk writes them, such as
   * `'mod+shift+d'`: shown as `Kbd`s at the row's end and given to it as
   * `aria-keyshortcuts`. A hint only: the app runs the shortcut.
   */
  shortcut?: string
}

/** A row's ref, which also says its `shortcut` as `aria-keyshortcuts`. */
function useShortcutRef<T extends Element>(shortcut: string | undefined, ref?: Ref<T>) {
  const ariaKeys = useAriaKeyshortcuts(shortcut)
  return useMemo(() => mergeRefs<T>(ariaKeys, ref), [ariaKeys, ref])
}

/**
 * A row's keys at its end, hidden from screen readers, which hear the row's
 * `aria-keyshortcuts`. A row's `shortcut` draws it; use it yourself for a
 * hint of your own, such as a key you hold.
 */
function MenuShortcut({
  shortcut,
  className,
  children,
  ...props
}: Omit<ComponentProps<typeof MenuShortcutPrimitive>, 'className'> & {
  /** The keys, as a row's `shortcut` takes them: `'mod+shift+d'`. */
  shortcut?: string
  className?: string
}) {
  return (
    <MenuShortcutPrimitive
      data-menu-shortcut=''
      className={cn(menuShortcutClassName, className)}
      {...props}
    >
      {children ?? <KbdGroup keys={shortcut} />}
    </MenuShortcutPrimitive>
  )
}

function MenuSub(props: ComponentProps<typeof MenuSubPrimitive>) {
  return <MenuSubPrimitive {...props} />
}

/** The row that opens a submenu beside it, with a chevron at its end. */
function MenuSubTrigger({
  className,
  children,
  ...props
}: Omit<ComponentProps<typeof MenuSubTriggerPrimitive>, 'className' | 'children'> & {
  className?: string
  children?: ReactNode
}) {
  return (
    <MenuSubTriggerPrimitive
      data-menu-row=''
      data-variant='default'
      className={cn(menuRowVariants(), menuInset, tintedRowTextClassName, className)}
      {...props}
    >
      {children}
      <MenuItemIconPrimitive
        mirror
        data-menu-chevron=''
        className='text-muted-foreground ms-auto flex shrink-0 items-center'
      >
        <IconPlaceholder
          aria-hidden
          lucide='ChevronRightIcon'
          tabler='IconChevronRight'
          hugeicons='ArrowRight01Icon'
          phosphor='CaretRightIcon'
          remixicon='RiArrowRightSLine'
        />
      </MenuItemIconPrimitive>
    </MenuSubTriggerPrimitive>
  )
}

/** A submenu's box: beside its row, with its first row level with it. */
function MenuSubContent({
  sideOffset = 2,
  alignOffset = -5,
  ...props
}: MenuContentProps) {
  return (
    <MenuBox
      Content={MenuSubContentPrimitive}
      sideOffset={sideOffset}
      // Up by the list's 4px margin and the surface's 1px ring, so its first row meets its trigger.
      alignOffset={alignOffset}
      {...props}
    />
  )
}

export {
  Menu,
  MenuCheckboxItem,
  MenuContent,
  MenuContextTrigger,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuItemIcon,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuShortcut,
  MenuSub,
  MenuSubContent,
  MenuSubTrigger,
  MenuTrigger,
}
