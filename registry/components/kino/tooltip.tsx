'use client'

import { Kbd } from '@/registry/components/kino/kbd'
import {
  GLIDE_GROUP_CLOSE_DELAY,
  GlideContent,
  type GlideGroup,
  GlideGroupMemory,
  tooltipBoxClassName,
  tooltipLabelClassName,
  TooltipSurface,
  useGlideGroup,
  useGlideGroupItem,
} from '@/registry/lib/glide'
import { HOVER_DELAY, POPUP_COLLISION_PADDING } from '@/registry/lib/popup'
import { mergeRefs } from '@/registry/lib/refs'
import { ariaKeyshortcuts } from '@ui-sdk/core'
import {
  createTooltipController,
  Tooltip as TooltipPrimitive,
  TooltipContent as TooltipContentPrimitive,
  type TooltipController,
  TooltipShortcut as TooltipShortcutPrimitive,
  TooltipTrigger as TooltipTriggerPrimitive,
} from '@ui-sdk/react/tooltip'
import {
  type ComponentProps,
  createContext,
  type ReactNode,
  use,
  useId,
  useEffect,
  useMemo,
  useState,
} from 'react'

import { cn } from '@/lib/utils'

type TooltipContentProps = Omit<
  ComponentProps<typeof TooltipContentPrimitive>,
  'className' | 'children'
> & {
  className?: string
  children?: ReactNode
}

/** Tells the tooltip around a trigger whether the trigger's name says what the label does. */
const RepeatsContext = createContext<((repeats: boolean) => void) | null>(null)

interface Group {
  glide: GlideGroup<TooltipController<string>, TooltipContentProps>
  repeats: (id: string, repeats: boolean) => void
  /** Keeps the group's tooltip closed on one tooltip's trigger while it is `disabled`. */
  disable: (id: string, disabled: boolean) => void
  /** The `shortcut` of each tooltip, which the group's tooltip shows for its trigger. */
  shortcut: (id: string, shortcut: string | undefined) => void
}

const GroupContext = createContext<Group | null>(null)
const ItemContext = createContext<{ id: string; shortcut?: string } | null>(null)

/**
 * Tooltips that sit together, such as a toolbar's, share one tooltip that
 * slides from trigger to trigger. Each `Tooltip` inside keeps its own
 * trigger and content.
 */
function TooltipGroup({ children }: { children: ReactNode }) {
  const { group, contentOf } = useGlideGroup<
    TooltipController<string>,
    TooltipContentProps
  >(() => createTooltipController<string>())
  const [shown, setShown] = useState<string | null>(null)
  const [labelled, setLabelled] = useState(false)
  const [repeating, setRepeating] = useState<ReadonlySet<string>>(new Set())
  const [shortcuts, setShortcuts] = useState<ReadonlyMap<string, string>>(new Map())
  const [off] = useState(() => new Set<string>())
  const value = useMemo<Group>(
    () => ({
      glide: group,
      disable: (id, disabled) => {
        if (disabled) off.add(id)
        else off.delete(id)
        if (disabled && group.handle.getPayload() === id) group.handle.close()
      },
      shortcut: (id, shortcut) =>
        setShortcuts((previous) => {
          if (previous.get(id) === shortcut) return previous
          const next = new Map(previous)
          if (shortcut) next.set(id, shortcut)
          else next.delete(id)
          return next
        }),
      repeats: (id, repeats) =>
        setRepeating((previous) => {
          if (previous.has(id) === repeats) return previous
          const next = new Set(previous)
          if (repeats) next.add(id)
          else next.delete(id)
          return next
        }),
    }),
    [group, off],
  )
  // The group's one box is placed as the shown trigger's content asks.
  const content = shown === null ? undefined : contentOf(shown)
  const { side, align, sideOffset, alignOffset } = content ?? {}
  return (
    <GroupContext value={value}>
      <GlideGroupMemory>
        {children}
        <TooltipPrimitive
          controller={group.handle}
          delay={HOVER_DELAY}
          closeDelay={GLIDE_GROUP_CLOSE_DELAY}
          // The payload is the opening trigger's by now.
          onOpenChange={(open, details) => {
            if (open && off.has(group.handle.getPayload() ?? '')) details.cancel()
          }}
          onPayloadChange={(payload, details) => {
            if (typeof payload === 'string' && off.has(payload)) {
              details.cancel()
              group.handle.close()
              return
            }
            if (typeof payload === 'string') setLabelled(true)
            setShown(typeof payload === 'string' ? payload : null)
          }}
          type={shown !== null && repeating.has(shown) ? 'label' : undefined}
          shortcut={shown === null ? undefined : shortcuts.get(shown)}
        >
          {/* One popup for many triggers has no one name an agent could find
              it by, so the agent bridge leaves it out. Its first label mounts a
              fresh box, so ui-sdk places it with the label in it. */}
          <TooltipBox<string>
            key={labelled ? 'label' : 'rest'}
            side={side}
            align={align}
            sideOffset={sideOffset}
            alignOffset={alignOffset}
            data-agent-hidden
          >
            {({ payload }) => {
              const shownContent = payload ? contentOf(payload) : undefined
              return shownContent ? (
                <TooltipInside className={shownContent.className}>
                  {shownContent.children}
                </TooltipInside>
              ) : null
            }}
          </TooltipBox>
        </TooltipPrimitive>
      </GlideGroupMemory>
    </GroupContext>
  )
}

/**
 * One tooltip: a trigger and its content. It waits 200ms before it opens,
 * then the next one opens at once while the pointer moves on. Inside a
 * `TooltipGroup`, the group holds whether it is open, and its props are
 * ignored, except `disabled` and `shortcut`. One open as it turns disabled
 * closes.
 */
function Tooltip({
  children,
  delay = HOVER_DELAY,
  type,
  disabled = false,
  shortcut,
  open: openProp,
  onOpenChange,
  ...props
}: ComponentProps<typeof TooltipPrimitive>) {
  const group = use(GroupContext)
  const id = useId()
  const [repeats, setRepeats] = useState(false)
  // ui-sdk's `disabled` only stops it opening, so one open as it turns
  // disabled is closed here, as a group closes it.
  const [ownOpen, setOwnOpen] = useState(props.defaultOpen ?? false)
  // Closed for good: enabled again, it waits for a pointer or focus.
  if (disabled && ownOpen) setOwnOpen(false)
  useEffect(() => {
    if (!group) return
    group.disable(id, disabled)
    return () => group.disable(id, false)
  }, [group, id, disabled])
  useEffect(() => {
    if (!group) return
    group.shortcut(id, shortcut)
    return () => group.shortcut(id, undefined)
  }, [group, id, shortcut])
  const item = useMemo(() => ({ id, shortcut }), [id, shortcut])
  if (group) return <ItemContext value={item}>{children}</ItemContext>
  return (
    <TooltipPrimitive
      delay={delay}
      type={type ?? (repeats ? 'label' : undefined)}
      disabled={disabled}
      shortcut={shortcut}
      {...props}
      open={(openProp ?? ownOpen) && !disabled}
      onOpenChange={(open, details) => {
        onOpenChange?.(open, details)
        if (!details.canceled) setOwnOpen(open)
      }}
    >
      <RepeatsContext value={setRepeats}>{children}</RepeatsContext>
    </TooltipPrimitive>
  )
}

/*
 * The label names a trigger with no name of its own, and describes one that
 * has a name. A name that already says what the label does, as an icon
 * button's `aria-label` often does, would be read twice: the label then
 * names it instead. Kept outside any component: the React Compiler can drop
 * a side effect written inside one.
 */
function watchRepeats(trigger: HTMLElement, report: (repeats: boolean) => void) {
  const check = () => {
    const by =
      trigger.getAttribute('aria-describedby') ?? trigger.getAttribute('aria-labelledby')
    const label = by ? trigger.ownerDocument.getElementById(by) : null
    if (label) report(repeatsName(trigger.getAttribute('aria-label'), label.textContent))
  }
  check()
  const observer = new MutationObserver(check)
  observer.observe(trigger, {
    attributes: true,
    attributeFilter: ['aria-label', 'aria-describedby', 'aria-labelledby'],
  })
  return () => observer.disconnect()
}

function TooltipTrigger({
  ref,
  ...props
}: ComponentProps<typeof TooltipTriggerPrimitive>) {
  const group = use(GroupContext)
  const item = use(ItemContext)
  const id = item?.id
  const setRepeats = use(RepeatsContext)
  const watch = useMemo(() => {
    const report =
      group && id ? (repeats: boolean) => group.repeats(id, repeats) : setRepeats
    if (!report) return undefined
    return (trigger: HTMLElement | null) =>
      trigger ? watchRepeats(trigger, report) : undefined
  }, [group, id, setRepeats])
  const own = useMemo(() => mergeRefs(ref, watch), [ref, watch])
  return (
    <TooltipTriggerPrimitive
      ref={own}
      {...(group && id
        ? {
            controller: group.glide.handle,
            payload: id,
            // The group's tooltip has one shortcut, its shown trigger's: each trigger says its own.
            'aria-keyshortcuts': item?.shortcut
              ? ariaKeyshortcuts(item.shortcut)
              : undefined,
          }
        : {})}
      {...props}
    />
  )
}

/**
 * The label. It grows out of its trigger, slides to the next trigger of its
 * group, and folds back in. `className` goes to the label inside the box;
 * every other prop goes to ui-sdk's content.
 */
function TooltipContent(props: TooltipContentProps) {
  const group = use(GroupContext)
  const id = use(ItemContext)?.id ?? null
  // Inside a group, the group's one tooltip shows this content.
  useGlideGroupItem(group?.glide ?? null, id, props)
  if (group && id) return null
  return <TooltipLabel {...props} />
}

/** The box: one for a tooltip, one for a group, placed by ui-sdk. */
function TooltipBox<Payload>({
  side = 'top',
  align = 'center',
  sideOffset = 6,
  className,
  ...props
}: Omit<ComponentProps<typeof TooltipContentPrimitive<Payload>>, 'className'> & {
  className?: string
}) {
  return (
    <TooltipContentPrimitive<Payload>
      side={side}
      align={align}
      sideOffset={sideOffset}
      collisionPadding={POPUP_COLLISION_PADDING}
      arrowPadding={0}
      className={cn(tooltipBoxClassName, className)}
      {...props}
    />
  )
}

/** The box with the label in it, for one tooltip. */
function TooltipLabel({ className, children, ...props }: TooltipContentProps) {
  return (
    <TooltipBox {...props}>
      <TooltipInside className={className}>{children}</TooltipInside>
    </TooltipBox>
  )
}

/** What a box holds: its surface and the label, for one tooltip or a group's. */
function TooltipInside({
  className,
  children,
}: {
  className?: string
  children?: ReactNode
}) {
  return (
    <>
      <TooltipSurface />
      <GlideContent>
        <div className={cn(tooltipLabelClassName, className)}>{children}</div>
      </GlideContent>
    </>
  )
}

/**
 * A keyboard shortcut after the label, as keys. Give the tooltip its
 * `shortcut`, such as `Mod+K`, and it is written for the platform and set on
 * the trigger for assistive technology; or pass the keys as children.
 */
function TooltipShortcut({
  className,
  children = ({ text }) => (text ? <Kbd>{text}</Kbd> : null),
  ...props
}: Omit<ComponentProps<typeof TooltipShortcutPrimitive>, 'className'> & {
  className?: string
}) {
  return (
    <TooltipShortcutPrimitive
      className={cn(
        'text-background/70 ms-2 font-sans tracking-wide forced-colors:text-[CanvasText]',
        className,
      )}
      {...props}
    >
      {children}
    </TooltipShortcutPrimitive>
  )
}

/** Whether a trigger's `aria-label` already says what its tooltip's label does, so describing it would read it twice. */
function repeatsName(name: string | null | undefined, label: string | null | undefined) {
  if (!name || !label) return false
  const words = (text: string) => text.trim().replace(/\s+/g, ' ').toLowerCase()
  return words(name) === words(label)
}

export {
  Tooltip,
  TooltipContent,
  TooltipGroup,
  TooltipShortcut,
  TooltipTrigger,
  repeatsName,
}
export type { TooltipContentProps }
