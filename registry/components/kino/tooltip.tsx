'use client'

import {
  GlideContent,
  type GlideGroup,
  GlideGroupMemory,
  glidePopupClassName,
  GlideSurface,
  glideTriggerProps,
  useGlideGroup,
  useGlideGroupItem,
} from '@/registry/lib/glide'
import {
  HOVER_DELAY,
  popupGrowContentClassName,
  popupPositionerProps,
  usePopupGrow,
} from '@/registry/lib/popup'
import { mergeRefs } from '@/registry/lib/refs'
import { Tooltip as TooltipPrimitive } from '@base-ui/react/tooltip'
import {
  type ComponentProps,
  createContext,
  type ReactNode,
  use,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import { cn } from '@/lib/utils'

type TooltipContentProps = Omit<TooltipPrimitive.Popup.Props, 'className'> & {
  className?: string
} & Pick<
    TooltipPrimitive.Positioner.Props,
    'side' | 'align' | 'sideOffset' | 'alignOffset' | 'anchor'
  >

/** The delay of the provider around a trigger, or the default without one. */
const DelayContext = createContext(HOVER_DELAY)

/** The tooltips under it wait `delay` ms before the first opens, then open at once while the pointer moves on. */
function TooltipProvider({
  delay = HOVER_DELAY,
  ...props
}: TooltipPrimitive.Provider.Props) {
  return (
    <DelayContext value={delay}>
      <TooltipPrimitive.Provider data-slot='tooltip-provider' delay={delay} {...props} />
    </DelayContext>
  )
}

const GroupContext = createContext<GlideGroup<
  TooltipPrimitive.Handle<unknown>,
  TooltipContentProps
> | null>(null)
const ItemContext = createContext<string | null>(null)
/** The id of the hidden copy of the label that describes the trigger. */
const DescriptionContext = createContext<string | undefined>(undefined)

/**
 * Tooltips that sit together, such as a toolbar's, share one tooltip that
 * slides from trigger to trigger. Each `Tooltip` inside keeps its own
 * trigger and content.
 */
function TooltipGroup({ children }: { children: ReactNode }) {
  const { group, contentOf } = useGlideGroup<
    TooltipPrimitive.Handle<unknown>,
    TooltipContentProps
  >(() => TooltipPrimitive.createHandle<unknown>())
  return (
    <GroupContext value={group}>
      <GlideGroupMemory>
        {children}
        <TooltipPrimitive.Root handle={group.handle}>
          {({ payload }) => {
            const content = contentOf(payload)
            return content ? <TooltipPopup {...content} /> : null
          }}
        </TooltipPrimitive.Root>
      </GlideGroupMemory>
    </GroupContext>
  )
}

/**
 * One tooltip: a trigger and its content. Inside a `TooltipGroup`, the group
 * holds whether it is open, and Root props are ignored.
 */
function Tooltip({
  children,
  ...props
}: Omit<TooltipPrimitive.Root.Props, 'children'> & { children?: ReactNode }) {
  const group = use(GroupContext)
  const id = useId()
  const described = (
    <DescriptionContext value={`${id}-label`}>{children}</DescriptionContext>
  )
  if (group) return <ItemContext value={id}>{described}</ItemContext>
  return <TooltipPrimitive.Root {...props}>{described}</TooltipPrimitive.Root>
}

/**
 * Without a `delay` of its own, it waits as long as its provider says, or
 * 200ms. It is described by the label, unless its name already says the same,
 * as an icon button's `aria-label` often does.
 */
function TooltipTrigger({ ref, ...props }: TooltipPrimitive.Trigger.Props) {
  const group = use(GroupContext)
  const id = use(ItemContext)
  const description = use(DescriptionContext)
  const delay = use(DelayContext)
  const own = useRef<HTMLElement>(null)
  const refs = useMemo(() => mergeRefs(own, ref), [ref])
  const [named, setNamed] = useState(false)
  // The name and the label are read once both are in the page, after every render.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- either can change on any render, and setting the same value renders nothing
  useLayoutEffect(() => {
    const label = description ? document.getElementById(description) : null
    setNamed(repeatsName(own.current?.getAttribute('aria-label'), label?.textContent))
  })
  return (
    <TooltipPrimitive.Trigger
      ref={refs}
      data-slot='tooltip-trigger'
      aria-describedby={named ? undefined : description}
      delay={delay}
      {...glideTriggerProps(group, id)}
      {...props}
    />
  )
}

/**
 * The label. It grows out of its trigger, slides to the next trigger of its
 * group, and folds back in. `className` goes to the label inside the box;
 * every other prop goes to Base UI's Popup.
 */
function TooltipContent(props: TooltipContentProps) {
  const group = use(GroupContext)
  const id = use(ItemContext)
  const description = use(DescriptionContext)
  // Inside a group, the group's one tooltip shows this content.
  useGlideGroupItem(group, id, props)
  // Base UI doesn't tie the label to its trigger, so the trigger is
  // described by this hidden copy, there whether the tooltip is open or not.
  const copy = (
    <span id={description} hidden>
      {props.children}
    </span>
  )
  if (group && id) return copy
  return (
    <>
      {copy}
      <TooltipPopup {...props} />
    </>
  )
}

/**
 * The tooltip's box, for a `Tooltip.Root` of Base UI's own that a component
 * drives itself, such as a chart's, whose triggers share one handle. Inside
 * a `GlideGroupMemory`, it slides from trigger to trigger as the group's
 * does. `anchor` places it against an element other than the trigger.
 */
function TooltipPopup({
  className,
  children,
  style,
  side = 'top',
  align = 'center',
  sideOffset = 6,
  alignOffset = 0,
  anchor: placeAgainst,
  ...props
}: TooltipContentProps) {
  const { dir, anchor } = usePopupGrow()
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Positioner
        {...popupPositionerProps}
        side={side}
        align={align}
        sideOffset={sideOffset}
        alignOffset={alignOffset}
        anchor={placeAgainst}
        positionMethod='fixed'
      >
        <TooltipPrimitive.Popup
          data-slot='tooltip-content'
          // Portalled out of the page's tree, so it takes the reading direction with it.
          dir={dir}
          style={style}
          className={cn(
            glidePopupClassName,
            '[--glide-radius:var(--control-radius-capped)]',
          )}
          {...props}
        >
          <GlideSurface
            fill='bg-foreground forced-colors:bg-[Canvas]'
            ring='bg-foreground forced-colors:bg-[CanvasText]'
          />
          <GlideContent>
            <div
              data-slot='tooltip-label'
              className={cn(
                'text-background max-w-64 px-2 py-1 text-xs leading-snug text-pretty forced-colors:text-[CanvasText]',
                popupGrowContentClassName,
                'group-data-instant/popup:transition-none',
                className,
              )}
            >
              {children}
            </div>
          </GlideContent>
          <TooltipPrimitive.Arrow {...anchor} />
        </TooltipPrimitive.Popup>
      </TooltipPrimitive.Positioner>
    </TooltipPrimitive.Portal>
  )
}

/** A keyboard shortcut after the label. */
function TooltipShortcut({ className, children, ...props }: ComponentProps<'kbd'>) {
  return (
    <kbd
      data-slot='tooltip-shortcut'
      className={cn(
        'text-background/70 ms-2 font-sans tracking-wide forced-colors:text-[CanvasText]',
        className,
      )}
      {...props}
    >
      {/* Keys read left to right in any language; `dir` on the kbd would flip its margin. */}
      <span dir='ltr'>{children}</span>
    </kbd>
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
  TooltipPopup,
  TooltipProvider,
  TooltipShortcut,
  TooltipTrigger,
}
export { repeatsName }
export type { TooltipContentProps }
