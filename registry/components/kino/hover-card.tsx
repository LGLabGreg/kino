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
import { edgeFadeClassName, useEdgeFades } from '@/registry/lib/scroll'
import { PreviewCard as PreviewCardPrimitive } from '@base-ui/react/preview-card'
import { createContext, type ReactNode, use, useId } from 'react'

import { cn } from '@/lib/utils'

type HoverCardContentProps = Omit<PreviewCardPrimitive.Popup.Props, 'className'> & {
  className?: string
} & Pick<
    PreviewCardPrimitive.Positioner.Props,
    'side' | 'align' | 'sideOffset' | 'alignOffset'
  >

const GroupContext = createContext<GlideGroup<
  PreviewCardPrimitive.Handle<unknown>,
  HoverCardContentProps
> | null>(null)
const ItemContext = createContext<string | null>(null)

/**
 * Hover cards that sit together, such as an avatar stack's or the mentions
 * in a comment, share one card that slides from link to link. Each
 * `HoverCard` inside keeps its own trigger and content.
 */
function HoverCardGroup({ children }: { children: ReactNode }) {
  const { group, contentOf } = useGlideGroup<
    PreviewCardPrimitive.Handle<unknown>,
    HoverCardContentProps
  >(() => PreviewCardPrimitive.createHandle<unknown>())
  return (
    <GroupContext value={group}>
      <GlideGroupMemory>
        {children}
        <PreviewCardPrimitive.Root handle={group.handle}>
          {({ payload }) => {
            const content = contentOf(payload)
            return content ? <HoverCardPopup {...content} /> : null
          }}
        </PreviewCardPrimitive.Root>
      </GlideGroupMemory>
    </GroupContext>
  )
}

/**
 * One hover card: a link and the card it previews. Inside a
 * `HoverCardGroup`, the group holds whether it is open, and Root props are
 * ignored.
 */
function HoverCard({
  children,
  ...props
}: Omit<PreviewCardPrimitive.Root.Props, 'children'> & {
  children?: ReactNode
}) {
  const group = use(GroupContext)
  const id = useId()
  if (group) return <ItemContext value={id}>{children}</ItemContext>
  return <PreviewCardPrimitive.Root {...props}>{children}</PreviewCardPrimitive.Root>
}

/** The link the card previews. Renders an `<a>`, and waits 200ms before the card opens. */
function HoverCardTrigger(props: PreviewCardPrimitive.Trigger.Props) {
  const group = use(GroupContext)
  const id = use(ItemContext)
  return (
    <PreviewCardPrimitive.Trigger
      data-slot='hover-card-trigger'
      delay={HOVER_DELAY}
      {...glideTriggerProps(group, id)}
      {...props}
    />
  )
}

/**
 * The card. It grows out of its link, slides to the next link of its group,
 * and folds back in. `className` goes to the content inside the box; every
 * other prop goes to Base UI's Popup.
 */
function HoverCardContent(props: HoverCardContentProps) {
  const group = use(GroupContext)
  const id = use(ItemContext)
  // Inside a group, the group's one card shows this content.
  useGlideGroupItem(group, id, props)
  if (group && id) return null
  return <HoverCardPopup {...props} />
}

function HoverCardPopup({
  className,
  children,
  style,
  side = 'bottom',
  align = 'center',
  sideOffset = 6,
  alignOffset = 0,
  ...props
}: HoverCardContentProps) {
  const { dir, anchor } = usePopupGrow()
  const fades = useEdgeFades<HTMLDivElement>()
  return (
    <PreviewCardPrimitive.Portal>
      <PreviewCardPrimitive.Positioner
        {...popupPositionerProps}
        side={side}
        align={align}
        sideOffset={sideOffset}
        alignOffset={alignOffset}
        positionMethod='fixed'
      >
        <PreviewCardPrimitive.Popup
          data-slot='hover-card-content'
          // Portalled out of the page's tree, so it takes the reading direction with it.
          dir={dir}
          style={style}
          className={cn(
            glidePopupClassName,
            'text-popover-foreground max-w-(--available-width) text-sm [--glide-radius:var(--surface-radius)]',
          )}
          {...props}
        >
          <GlideSurface
            fill='bg-popover'
            ring='bg-foreground/10 forced-colors:bg-[CanvasText]'
            shadow
          />
          <GlideContent>
            <div
              ref={fades}
              data-slot='hover-card-body'
              className={cn(
                'scrollbar-thin flex max-h-(--available-height) w-80 max-w-full flex-col gap-(--surface-gap) overflow-y-auto overscroll-contain p-(--surface-padding)',
                edgeFadeClassName,
                popupGrowContentClassName,
                'group-data-instant/popup:transition-none',
                className,
              )}
            >
              {children}
            </div>
          </GlideContent>
          <PreviewCardPrimitive.Arrow {...anchor} />
        </PreviewCardPrimitive.Popup>
      </PreviewCardPrimitive.Positioner>
    </PreviewCardPrimitive.Portal>
  )
}

export { HoverCard, HoverCardContent, HoverCardGroup, HoverCardTrigger }
