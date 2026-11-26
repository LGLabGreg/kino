'use client'

import {
  GLIDE_GROUP_CLOSE_DELAY,
  GlideContent,
  type GlideGroup,
  GlideGroupMemory,
  glidePopupClassName,
  GlideSurface,
  useGlideGroup,
  useGlideGroupItem,
} from '@/registry/lib/glide'
import {
  HOVER_DELAY,
  POPUP_COLLISION_PADDING,
  popupGrowContentClassName,
} from '@/registry/lib/popup'
import { edgeFadeClassName, useEdgeFades } from '@/registry/lib/scroll'
import {
  createHoverCardController,
  HoverCard as HoverCardPrimitive,
  HoverCardContent as HoverCardContentPrimitive,
  type HoverCardController,
  HoverCardTrigger as HoverCardTriggerPrimitive,
} from '@ui-sdk/react/hover-card'
import {
  type ComponentProps,
  createContext,
  type ReactNode,
  use,
  useId,
  useState,
} from 'react'

import { cn } from '@/lib/utils'

type HoverCardContentProps = Omit<
  ComponentProps<typeof HoverCardContentPrimitive>,
  'className' | 'children'
> & {
  className?: string
  children?: ReactNode
}

const GroupContext = createContext<GlideGroup<
  HoverCardController<string>,
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
    HoverCardController<string>,
    HoverCardContentProps
  >(() => createHoverCardController<string>())
  // The group's one box is placed as the shown link's content asks.
  const [shown, setShown] = useState<string | null>(null)
  const content = shown === null ? undefined : contentOf(shown)
  const { side, align, sideOffset, alignOffset } = content ?? {}
  return (
    <GroupContext value={group}>
      <GlideGroupMemory>
        {children}
        <HoverCardPrimitive
          controller={group.handle}
          delay={HOVER_DELAY}
          closeDelay={GLIDE_GROUP_CLOSE_DELAY}
          onPayloadChange={(payload) => {
            if (typeof payload === 'string') setShown(payload)
          }}
        >
          {/* One popup for many triggers has no one name an agent could find
              it by, so the agent bridge leaves it out. Its first card mounts a
              fresh box, so ui-sdk places it with the card in it. */}
          <HoverCardBox<string>
            key={content ? 'card' : 'rest'}
            side={side}
            align={align}
            sideOffset={sideOffset}
            alignOffset={alignOffset}
            keepMounted
            data-agent-hidden
          >
            {({ payload }) => {
              const shownContent = payload ? contentOf(payload) : undefined
              return shownContent ? (
                <HoverCardInside className={shownContent.className}>
                  {shownContent.children}
                </HoverCardInside>
              ) : null
            }}
          </HoverCardBox>
        </HoverCardPrimitive>
      </GlideGroupMemory>
    </GroupContext>
  )
}

/**
 * One hover card: a link and the card it previews. It waits 200ms before
 * the card opens. Inside a `HoverCardGroup`, the group holds whether it is
 * open, and its props are ignored.
 */
function HoverCard({
  children,
  delay = HOVER_DELAY,
  ...props
}: ComponentProps<typeof HoverCardPrimitive>) {
  const group = use(GroupContext)
  const id = useId()
  if (group) return <ItemContext value={id}>{children}</ItemContext>
  return (
    <HoverCardPrimitive delay={delay} {...props}>
      {children}
    </HoverCardPrimitive>
  )
}

/** The link the card previews. Renders an `<a>`. */
function HoverCardTrigger(props: ComponentProps<typeof HoverCardTriggerPrimitive>) {
  const group = use(GroupContext)
  const id = use(ItemContext)
  return (
    <HoverCardTriggerPrimitive
      {...(group && id ? { controller: group.handle, payload: id } : {})}
      {...props}
    />
  )
}

/**
 * The card. It grows out of its link, slides to the next link of its group,
 * and folds back in. `className` goes to the content inside the box; every
 * other prop goes to ui-sdk's content.
 */
function HoverCardContent(props: HoverCardContentProps) {
  const group = use(GroupContext)
  const id = use(ItemContext)
  // Inside a group, the group's one card shows this content.
  useGlideGroupItem(group, id, props)
  if (group && id) return null
  return <HoverCardCard {...props} />
}

/** The box: one for a card, one for a group, placed by ui-sdk. */
function HoverCardBox<Payload>({
  side = 'bottom',
  align = 'center',
  sideOffset = 6,
  className,
  ...props
}: Omit<ComponentProps<typeof HoverCardContentPrimitive<Payload>>, 'className'> & {
  className?: string
}) {
  return (
    <HoverCardContentPrimitive<Payload>
      side={side}
      align={align}
      sideOffset={sideOffset}
      collisionPadding={POPUP_COLLISION_PADDING}
      arrowPadding={0}
      className={cn(
        glidePopupClassName,
        'text-popover-foreground max-w-(--available-width) text-sm [--glide-radius:var(--surface-radius)] [--popup-available-height:var(--available-height)]',
        className,
      )}
      {...props}
    />
  )
}

/** The box with the card in it, for one hover card. */
function HoverCardCard({ className, children, ...props }: HoverCardContentProps) {
  return (
    <HoverCardBox {...props}>
      <HoverCardInside className={className}>{children}</HoverCardInside>
    </HoverCardBox>
  )
}

/** What a box holds: its surface and the card, for one hover card or a group's. */
function HoverCardInside({
  className,
  children,
}: {
  className?: string
  children?: ReactNode
}) {
  const fades = useEdgeFades<HTMLDivElement>()
  return (
    <>
      <GlideSurface
        fill='bg-popover'
        ring='bg-foreground/10 forced-colors:bg-[CanvasText]'
        shadow
      />
      <GlideContent>
        <div
          ref={fades}
          className={cn(
            'scrollbar-thin flex max-h-(--popup-available-height) w-80 max-w-full flex-col gap-(--surface-gap) overflow-y-auto overscroll-contain p-(--surface-padding)',
            edgeFadeClassName,
            popupGrowContentClassName,
            'group-data-instant/popup:transition-none',
            className,
          )}
        >
          {children}
        </div>
      </GlideContent>
    </>
  )
}

export { HoverCard, HoverCardContent, HoverCardGroup, HoverCardTrigger }
