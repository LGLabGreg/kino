'use client'

import { IconPlaceholder } from '@/registry/icons/icon-placeholder'
import { collapseClassName, followPanelContent } from '@/registry/lib/resize'
import {
  CollapsiblePanel as CollapsiblePanelPrimitive,
  Collapsible as CollapsiblePrimitive,
  CollapsibleTrigger as CollapsibleTriggerPrimitive,
} from '@ui-sdk/react/collapsible'
import { type ComponentProps, useEffect, useRef } from 'react'

import { cn } from '@/lib/utils'

/* A header row whose leading chevron turns down as its panel opens. */

function Collapsible({
  className,
  ...props
}: Omit<ComponentProps<typeof CollapsiblePrimitive>, 'className'> & {
  className?: string
}) {
  return (
    <CollapsiblePrimitive className={cn('flex min-w-0 flex-col', className)} {...props} />
  )
}

/**
 * A row as tall as a control for one line; a label that wraps grows it, its
 * icons level with the first line. A tree's rows share it.
 */
const collapsibleRowClassName =
  "flex w-full min-w-0 items-start gap-2 rounded-(--control-radius-capped) px-(--control-padding) py-[calc((var(--control-height)-1lh)/2)] text-start text-sm wrap-anywhere [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&>svg]:mt-0.5"

/**
 * Rows nested under a row, as a tree's branch and a sidebar's section: a
 * line runs down beside them and their labels line up with the parent's.
 * Add where the line runs, under the parent's chevron or icon, as `before:start-*`.
 */
const collapsibleNestedClassName =
  'before:bg-border forced-colors:before:bg-[CanvasText] relative flex min-w-0 flex-col gap-px pt-px ps-6 before:pointer-events-none before:absolute before:inset-y-0 before:w-px'

/**
 * The chevron that turns down as its panel opens, for a row that carries
 * `group/collapsible-trigger` and ui-sdk's `data-open`. Mirrored in right to
 * left, it points to the start and turns the other way to point down.
 */
function CollapsibleIndicator({
  className,
  open,
}: {
  className?: string
  /** Whether what it opens is open, for an indicator outside a `CollapsibleTrigger`, such as the Table's `TableExpand`. */
  open?: boolean
}) {
  return (
    <IconPlaceholder
      lucide='ChevronRightIcon'
      tabler='IconChevronRight'
      hugeicons='ArrowRight01Icon'
      phosphor='CaretRightIcon'
      remixicon='RiArrowRightSLine'
      data-slot='collapsible-indicator'
      data-open={open ? '' : undefined}
      aria-hidden
      className={cn(
        'text-muted-foreground group-hover/collapsible-trigger:text-foreground group-data-disabled/collapsible-trigger:text-foreground/30 transition-[color,rotate] duration-(--motion-layout-duration) ease-[var(--motion-layout-fade-easing),var(--motion-layout-easing)] group-data-open/collapsible-trigger:rotate-90 motion-reduce:transition-[color] motion-reduce:ease-(--motion-layout-fade-easing) rtl:-scale-x-100 rtl:group-data-open/collapsible-trigger:-rotate-90 data-open:rotate-90 rtl:data-open:-rotate-90',
        className,
      )}
    />
  )
}

function CollapsibleTrigger({
  className,
  children,
  ...props
}: Omit<ComponentProps<typeof CollapsibleTriggerPrimitive>, 'className' | 'children'> & {
  className?: string
  children?: ComponentProps<'button'>['children']
}) {
  return (
    <CollapsibleTriggerPrimitive
      className={cn(
        collapsibleRowClassName,
        'group/collapsible-trigger text-foreground hover:bg-muted focus-visible:ring-ring/50 data-disabled:text-foreground/40 font-medium transition-[color,background-color,box-shadow] duration-(--motion-press-duration) ease-(--motion-press-fade-easing) focus-visible:ring-3 focus-visible:outline-hidden data-disabled:hover:bg-transparent',
        className,
      )}
      {...props}
    >
      <CollapsibleIndicator />
      {children}
    </CollapsibleTriggerPrimitive>
  )
}

/**
 * The content's own box, which mounts with the panel. ui-sdk sizes the panel
 * while it opens and closes and leaves it at `auto` once open, so content
 * that grows or shrinks after that would jump: this moves the panel to the
 * new height on the same transition.
 */
function CollapsiblePanelContent(props: ComponentProps<'div'>) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const inner = ref.current
    const panel = inner?.parentElement
    if (!inner || !panel) return
    return followPanelContent(panel, inner, '--collapsible-panel-height')
  }, [])

  return <div ref={ref} data-slot='collapsible-panel-content' {...props} />
}

/**
 * `className` goes on the content's own box, which lines its start up with
 * the trigger's label; the other props go to ui-sdk's panel.
 */
function CollapsiblePanel({
  className,
  children,
  ...props
}: Omit<ComponentProps<typeof CollapsiblePanelPrimitive>, 'className' | 'children'> & {
  className?: string
  children?: ComponentProps<'div'>['children']
}) {
  return (
    <CollapsiblePanelPrimitive
      // Clipped down the page only, so a focus ring inside keeps its sides.
      className={cn(
        collapseClassName,
        'overflow-y-clip text-sm [--collapse-height:var(--collapsible-panel-height)]',
      )}
      {...props}
    >
      <CollapsiblePanelContent
        className={cn(
          'min-w-0 pt-1 pe-(--control-padding) pb-(--row-padding) ps-[calc(var(--control-padding)+--spacing(6))] wrap-break-word',
          className,
        )}
      >
        {children}
      </CollapsiblePanelContent>
    </CollapsiblePanelPrimitive>
  )
}

export {
  Collapsible,
  CollapsibleTrigger,
  CollapsiblePanel,
  CollapsibleIndicator,
  collapsibleNestedClassName,
  collapsibleRowClassName,
}
