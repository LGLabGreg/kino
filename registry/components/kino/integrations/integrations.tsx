'use client'

import {
  Tooltip,
  TooltipContent,
  TooltipGroup,
  TooltipTrigger,
} from '@/registry/components/kino/tooltip'
import { BeamField, type BeamLayout, type BeamLink, BeamSpot } from '@/registry/lib/beams'
import { pageColumnClassName } from '@/registry/lib/hero-parts'
import { useHold, useTurns } from '@/registry/lib/hold'
import {
  type Integration,
  integrationsSectionClassName,
  type IntegrationsSectionProps,
  IntegrationTile,
} from '@/registry/lib/integrations-parts'
import { SectionHeading } from '@/registry/lib/section-heading'
import { type ComponentProps, type ReactNode, useId, useRef, useState } from 'react'

import { cn } from '@/lib/utils'

/*
 * The tools your product works with, around your product's mark, each with
 * a beam into it. The beams draw in the first time the picture is seen, and
 * a tool that is hovered or focused lights its beam and sends a pulse along
 * it into the hub, with its name and what it does beside it. `live` keeps
 * pulses coming, one tool at a time, held while the pointer is over it, an
 * item has focus or it is out of view. Under reduced motion the beams stand
 * still. Six to ten tools read best; the rest go behind `actions`.
 *
 *   <Integrations
 *     title='Kino works with the tools you have'
 *     hub={<Logo />}
 *     integrations={[{ value: 'github', name: 'GitHub', description: 'Link pull requests to issues.', logo: { src: '/logos/tools/github.svg', width: 24, height: 24 }, href: '/integrations/github' }]}
 *     actions={<a href='/integrations'>See every integration</a>}
 *   />
 */

interface IntegrationsProps
  extends
    IntegrationsSectionProps,
    Omit<ComponentProps<'section'>, 'title' | 'children'> {
  integrations: Integration[]
  /** Your product's mark, in the middle: a picture, as its name is the page's. */
  hub: ReactNode
  /** Under the picture: a link to every integration. */
  actions?: ReactNode
  /** Pulses keep coming, one tool at a time, while the picture is in view. */
  live?: boolean
}

/** How many `layout` durations pass between pulses when `live`. */
const PULSE_EVERY = 2

function Integrations({
  title,
  eyebrow,
  description,
  heading = 'h2',
  integrations,
  hub,
  actions,
  live = false,
  className,
  ...props
}: IntegrationsProps) {
  const titleId = useId()
  const values = integrations.map((integration) => integration.value)
  const layout = hubLayout(values)
  const links: BeamLink[] = values.map((value) => ({
    id: value,
    from: value,
    to: HUB,
    flow: 'forward',
  }))
  const [lit, setLit] = useState<string | null>(null)
  const [pulses, setPulses] = useState<Record<string, number>>({})
  const pulse = (value: string) =>
    setPulses((last) => ({ ...last, [value]: (last[value] ?? 0) + 1 }))

  const picture = useRef<HTMLDivElement>(null)
  const hold = useHold()
  const turn = useRef(0)
  useTurns(picture, live && hold.running && values.length > 0, PULSE_EVERY, () => {
    const order = liveOrder(values.length)
    const next = values[order[turn.current % order.length] ?? 0]
    turn.current += 1
    if (next) pulse(next)
  })

  return (
    <section
      data-slot='integrations'
      aria-labelledby={titleId}
      className={cn(integrationsSectionClassName, className)}
      {...props}
    >
      <div
        className={cn(
          pageColumnClassName,
          'flex flex-col items-center gap-10 py-16 @3xl:py-24',
        )}
      >
        <SectionHeading
          id={titleId}
          eyebrow={eyebrow}
          title={title}
          description={description}
          heading={heading}
        />
        <div ref={picture} className='w-full max-w-3xl' {...hold.handlers}>
          <TooltipGroup>
            <BeamField
              layout={layout}
              links={links}
              lit={lit ? [lit] : []}
              pulses={pulses}
            >
              <BeamSpot node={HUB}>
                <span
                  aria-hidden
                  data-slot='integrations-hub'
                  // Its size follows the picture's width, as the beams do, within a tile's sizes.
                  className='bg-card text-foreground grid size-[clamp(3.5rem,14cqi,6rem)] place-items-center rounded-(--surface-radius) border shadow-sm [&_svg]:size-1/2'
                >
                  {hub}
                </span>
              </BeamSpot>
              <ul aria-labelledby={titleId} className='contents'>
                {integrations.map((integration) => (
                  <BeamSpot
                    key={integration.value}
                    node={integration.value}
                    render={<li />}
                  >
                    <Tool
                      integration={integration}
                      onShow={() => {
                        setLit(integration.value)
                        pulse(integration.value)
                      }}
                      onHide={() =>
                        setLit((last) => (last === integration.value ? null : last))
                      }
                    />
                  </BeamSpot>
                ))}
              </ul>
            </BeamField>
          </TooltipGroup>
        </div>
        {actions ? (
          <div className='flex flex-wrap justify-center gap-3'>{actions}</div>
        ) : null}
      </div>
    </section>
  )
}

/** A tool on the picture: its tile, which leads to its page, with its name and line in a tooltip. */
function Tool({
  integration,
  onShow,
  onHide,
}: {
  integration: Integration
  onShow: () => void
  onHide: () => void
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <a
            href={integration.href}
            aria-label={integration.name}
            onPointerEnter={(event) => event.pointerType === 'mouse' && onShow()}
            onPointerLeave={onHide}
            // A press focuses the link too: only a keyboard's focus sends its own pulse.
            onFocus={(event) => event.currentTarget.matches(':focus-visible') && onShow()}
            onBlur={onHide}
          />
        }
        className='group/tool focus-visible:ring-ring/50 block rounded-(--control-radius-capped) focus-visible:ring-3 focus-visible:outline-hidden'
      >
        <IntegrationTile
          logo={integration.logo}
          // Its size follows the picture's width, as the beams do, within a tile's sizes.
          className='size-[clamp(1.75rem,8cqi,3.5rem)] transition-[border-color,box-shadow] duration-(--motion-press-duration) ease-(--motion-press-fade-easing) group-hover/tool:border-muted-foreground/50'
        />
      </TooltipTrigger>
      <TooltipContent className='flex max-w-60 flex-col gap-0.5'>
        {/* The link has the name already, so a screen reader hears only the line. */}
        <span aria-hidden className='font-medium'>
          {integration.name}
        </span>
        <span className='opacity-80'>{integration.description}</span>
      </TooltipContent>
    </Tooltip>
  )
}

/** The hub's node: your product, in the middle. */
const HUB = 'hub'

/** How far apart a column's tools sit, in the field's units: room for the smallest tile at a 280px column. */
const ROW_PITCH = 100

/**
 * Where the picture puts each tool: half of them in a column on each side
 * of the hub, the first half at the start, top to bottom, `ROW_PITCH` apart,
 * so more tools make a taller picture rather than tiles that overlap. Each
 * column bows towards the hub at its middle, so the beams fan in evenly.
 */
function hubLayout(tools: readonly string[]): BeamLayout {
  const width = 720
  const rows = Math.max(1, Math.ceil(tools.length / 2))
  const height = ROW_PITCH * (rows - 1) + 2 * HUB_MARGIN
  const middle = height / 2
  const span = Math.max(1, middle - HUB_MARGIN)
  const at: BeamLayout['at'] = { [HUB]: { x: width / 2, y: middle } }
  const columns = [tools.slice(0, rows), tools.slice(rows)]
  columns.forEach((column, side) => {
    // A shorter column sits in the middle of the longer one.
    const top = middle - (ROW_PITCH * (column.length - 1)) / 2
    column.forEach((tool, row) => {
      const y = top + row * ROW_PITCH
      // 70 from the edge at the top and bottom, 130 at the middle.
      const inset = 70 + 60 * (1 - Math.abs(y - middle) / span)
      at[tool] = { x: side === 0 ? inset : width - inset, y }
    })
  })
  return { width, height, at }
}

/** The room above the first row and below the last, in the field's units: half a tile at its largest, and the hub's. */
const HUB_MARGIN = 60

/**
 * The order `live` pulses the tools in: a side at a time, the start column
 * and then the end one, each column's rows in turn, the end column half a
 * column on, so no two pulses in a row come from neighbours.
 */
function liveOrder(count: number): number[] {
  const startCount = Math.ceil(count / 2)
  const endCount = count - startCount
  const order: number[] = []
  for (let turn = 0; turn < startCount; turn++) {
    order.push(turn)
    if (endCount > 0)
      order.push(startCount + ((turn + Math.ceil(endCount / 2)) % endCount))
  }
  return [...new Set(order)]
}

export { Integrations }
export { hubLayout, liveOrder }
