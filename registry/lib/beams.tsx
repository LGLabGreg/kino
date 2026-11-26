'use client'

import { reducesMotion } from '@/registry/lib/reduce-motion'
import { FOLLOWS_TRANSITION, transitionTiming } from '@/registry/lib/resize'
import { onScreen, type SceneSeen, useSeen } from '@/registry/lib/scene'
import { mergeProps, type PartProps, renderElement } from '@ui-sdk/react/primitive'
import {
  type ComponentProps,
  createContext,
  type CSSProperties,
  use,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'

import { cn } from '@/lib/utils'

/*
 * Lines between nodes, with a pulse that travels them, such as tools that
 * send their data into a product. The layout says where every node sits, in
 * the field's own units, and a beam is worked out from its two ends, so
 * nothing is measured: the beams are right in the page's HTML, at every
 * width and after any reflow. The field keeps its layout's shape and scales
 * as one drawing, the nodes with it.
 *
 * The beams draw in, one after another, the first time the field is seen;
 * on screen as the page loads, they are there already. A pulse runs along a
 * beam each time its count in `pulses` goes up, the way its data travels.
 * Under reduced motion the beams stand still and no pulse runs.
 *
 *   <BeamField layout={{ width: 300, height: 80, at: { form: { x: 30, y: 40 }, kino: { x: 150, y: 40 } } }} links={[{ id: 'in', from: 'form', to: 'kino', flow: 'forward' }]} pulses={{ in: sent }}>
 *     <BeamSpot node='form'>…</BeamSpot>
 *     <BeamSpot node='kino'>…</BeamSpot>
 *   </BeamField>
 */

/** A point in the field's own units, `x` from its start edge. */
interface BeamPoint {
  x: number
  y: number
}

/** The field's size in its own units, and where each node sits in it. */
interface BeamLayout {
  width: number
  height: number
  at: Record<string, BeamPoint>
}

/** Which way data travels a beam: from `from` to `to`, back, or both ways. */
type BeamFlow = 'forward' | 'back' | 'both'

/** A beam between two nodes of the layout. */
interface BeamLink {
  id: string
  from: string
  to: string
  flow: BeamFlow
}

/**
 * Where the beams are: drawn, as the page's HTML has them; waiting off
 * screen, undrawn, until the field is seen; or drawing in.
 */
type BeamsPhase = 'drawn' | 'waiting' | 'drawing'

const BeamLayoutContext = createContext<BeamLayout | null>(null)

/** How long a pulse's dash is, as a share of its beam. */
const PULSE_LENGTH = 0.2

/** How long a pulse's bright head is, as a share of its beam. */
const PULSE_HEAD = 0.05

function BeamField({
  layout,
  links,
  lit = [],
  pulses = {},
  className,
  style,
  children,
  ...props
}: ComponentProps<'div'> & {
  layout: BeamLayout
  links: BeamLink[]
  /** The beams brought forward, by `id`, such as the one whose node is hovered. */
  lit?: string[]
  /** A count for each beam, by `id`: each time one goes up, a pulse runs along that beam. */
  pulses?: Record<string, number>
}) {
  const { ref, seen } = useSeen<HTMLDivElement>(0.5)
  const beams = useRef<SVGSVGElement>(null)
  // Drawn until it is known to be off screen, so the page's HTML holds the beams.
  const [offScreen, setOffScreen] = useState(false)

  // Before the first paint: on screen as the page shows it, it stays as it is (motion rule 6);
  // further down, the beams go, which nobody sees, and draw in once the field is seen.
  useLayoutEffect(() => {
    const element = ref.current
    if (element && !reducesMotion(element) && !onScreen(element)) setOffScreen(true)
  }, [ref])

  const phase = beamsPhase(offScreen, seen)

  const sent = useRef(pulses)
  useEffect(() => {
    const last = sent.current
    sent.current = pulses
    const svg = beams.current
    if (!svg || phase === 'waiting') return
    for (const [id, count] of Object.entries(pulses)) {
      if (count > (last[id] ?? 0)) sendPulse(svg, id)
    }
  }, [pulses, phase])

  return (
    <div
      ref={ref}
      data-slot='beam-field'
      data-phase={phase}
      style={{ aspectRatio: `${layout.width} / ${layout.height}`, ...style }}
      className={cn('group/beams @container/beams relative w-full min-w-0', className)}
      {...props}
    >
      <svg
        ref={beams}
        aria-hidden
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        preserveAspectRatio='none'
        // The layout's `x` runs from the start edge, so right to left draws the picture mirrored.
        className='pointer-events-none absolute inset-0 size-full overflow-visible rtl:-scale-x-100'
      >
        {links.map((link, index) => {
          const d = beamPath(spotOf(layout, link.from), spotOf(layout, link.to))
          const on = lit.includes(link.id)
          return (
            <g key={link.id} data-beam={link.id}>
              <path
                d={d}
                pathLength={1}
                data-lit={on ? '' : undefined}
                // Each beam starts a quarter of `draw` after the one before it.
                style={
                  {
                    '--beam-delay': `calc(var(--motion-draw-duration) * ${index * 0.25})`,
                  } as CSSProperties
                }
                className={beamClassName}
              />
              {link.flow !== 'back' ? <Pulse d={d} way='forward' /> : null}
              {link.flow !== 'forward' ? <Pulse d={d} way='back' /> : null}
            </g>
          )
        })}
      </svg>
      <BeamLayoutContext value={layout}>{children}</BeamLayoutContext>
    </div>
  )
}

/**
 * A beam: a hairline that follows the line colour, darker while it is lit.
 * It is dashed as long as itself, so moving the dash draws it: undrawn while
 * the field waits to be seen, and drawn in on `draw`, each beam a share of
 * the role later than the one before, once it is.
 */
const beamClassName = cn(
  'fill-none stroke-border [stroke-width:1.5] [vector-effect:non-scaling-stroke] [stroke-dasharray:1] [stroke-dashoffset:0] data-lit:stroke-muted-foreground/60 forced-colors:stroke-[CanvasText] forced-colors:data-lit:stroke-[Highlight]',
  '[transition:stroke_var(--motion-enter-duration)_var(--motion-enter-fade-easing)]',
  'group-data-[phase=waiting]/beams:[stroke-dashoffset:1]',
  'group-data-[phase=drawing]/beams:[transition:stroke_var(--motion-enter-duration)_var(--motion-enter-fade-easing),stroke-dashoffset_var(--motion-draw-duration)_var(--motion-draw-easing)_var(--beam-delay)] motion-reduce:group-data-[phase=drawing]/beams:[transition:stroke_var(--motion-enter-duration)_var(--motion-enter-fade-easing)]',
)

/**
 * A pulse: a short faint dash with a bright head at its front, waiting
 * before its beam's start, hidden, until it runs to its end as a Web
 * Animation timed by the transition named on it, on `draw`, so the feel
 * and reduced motion hold.
 */
function Pulse({ d, way }: { d: string; way: 'forward' | 'back' }) {
  return (
    <g data-pulse={way}>
      <path
        d={d}
        pathLength={1}
        data-part='tail'
        className={cn(pulseClassName, 'stroke-foreground/40')}
      />
      <path
        d={d}
        pathLength={1}
        data-part='head'
        className={cn(pulseClassName, 'stroke-foreground')}
      />
    </g>
  )
}

const pulseClassName =
  'fill-none opacity-0 [stroke-width:2] [stroke-linecap:round] [vector-effect:non-scaling-stroke] transition-[stroke-dashoffset] duration-(--motion-draw-duration) ease-(--motion-draw-easing) motion-reduce:transition-none forced-colors:stroke-[Highlight]'

/** Runs one pulse along beam `id`, its own way; under reduced motion, none. */
function sendPulse(svg: SVGSVGElement, id: string) {
  const group = [...svg.querySelectorAll<SVGGElement>('[data-beam]')].find(
    (node) => node.dataset.beam === id,
  )
  if (!group) return
  // A pulse still on its way finishes, rather than jumping back to its start.
  const running = group
    .getAnimations({ subtree: true })
    .some((run) => run.id === FOLLOWS_TRANSITION && run.playState === 'running')
  if (running) return
  for (const pulse of group.querySelectorAll<SVGGElement>('[data-pulse]')) {
    const way = pulse.dataset.pulse === 'back' ? 'back' : 'forward'
    for (const path of pulse.querySelectorAll<SVGPathElement>('[data-part]')) {
      const timing = transitionTiming(getComputedStyle(path), 'stroke-dashoffset')
      if (!timing) continue
      const { dash, from, to } = pulseDash(
        way,
        path.dataset.part === 'head' ? 'head' : 'tail',
      )
      path.animate(
        [
          { strokeDasharray: dash, strokeDashoffset: from, opacity: 1 },
          { strokeDasharray: dash, strokeDashoffset: to, opacity: 1 },
        ],
        // Draw's duration, at an even pace, as a marquee's: on draw's spring the dash would race
        // across in a few frames and then drain out of sight behind the node.
        { duration: timing.duration, easing: 'linear', id: FOLLOWS_TRANSITION },
      )
    }
  }
}

/**
 * Places its child's centre on a node of the field's layout. The child is
 * yours: a tile, a link, a mark.
 */
function BeamSpot({
  node,
  className,
  style,
  render,
  ...props
}: Omit<PartProps<'div'>, 'className' | 'style'> & {
  node: string
  className?: string
  style?: CSSProperties
}) {
  const layout = use(BeamLayoutContext)
  if (!layout) throw new Error('A BeamSpot goes inside a BeamField.')
  return renderElement(
    'div',
    mergeProps(
      {
        'data-slot': 'beam-spot',
        style: { ...spotPlace(layout, node), ...style },
        className: cn(
          'absolute -translate-x-1/2 -translate-y-1/2 rtl:translate-x-1/2',
          className,
        ),
      },
      props,
    ),
    render,
  )
}

/** Node `node`'s point, or a thrown error naming it, since a beam to nowhere is a mistake in the layout. */
function spotOf(layout: BeamLayout, node: string): BeamPoint {
  const point = layout.at[node]
  if (!point) throw new Error(`The beams' layout has no node "${node}".`)
  return point
}

/** Where a node sits, as shares of the field: from its start edge and from its top. */
function spotPlace(layout: BeamLayout, node: string) {
  const { x, y } = spotOf(layout, node)
  return {
    insetInlineStart: `${round((x / layout.width) * 100)}%`,
    top: `${round((y / layout.height) * 100)}%`,
  }
}

/**
 * A beam from `from` to `to`: a curve that leaves and arrives level along
 * whichever way the two are further apart, bending halfway, so beams that
 * meet at one node arrive side by side rather than crossing.
 */
function beamPath(from: BeamPoint, to: BeamPoint): string {
  const across = Math.abs(to.x - from.x) >= Math.abs(to.y - from.y)
  const c1 = across
    ? { x: (from.x + to.x) / 2, y: from.y }
    : { x: from.x, y: (from.y + to.y) / 2 }
  const c2 = across
    ? { x: (from.x + to.x) / 2, y: to.y }
    : { x: to.x, y: (from.y + to.y) / 2 }
  const at = (point: BeamPoint) => `${round(point.x)} ${round(point.y)}`
  return `M${at(from)} C${at(c1)} ${at(c2)} ${at(to)}`
}

/**
 * A pulse's dash and where it runs, as dash offsets along a beam whose
 * length is 1: the tail from just before the start to just past the end
 * (or back), and the head the short piece at the tail's front.
 */
function pulseDash(
  way: 'forward' | 'back',
  part: 'tail' | 'head',
): { dash: string; from: number; to: number } {
  const length = part === 'tail' ? PULSE_LENGTH : PULSE_HEAD
  // Going forward, the front is the tail's far end, so the head sits that much further on.
  const ahead = way === 'forward' && part === 'head' ? PULSE_LENGTH - PULSE_HEAD : 0
  const [from, to] = way === 'forward' ? [PULSE_LENGTH, -1] : [-1, PULSE_LENGTH]
  return {
    dash: `${length} 2`,
    from: round(from - ahead),
    to: round(to - ahead),
  }
}

/** Where the beams are, from whether the field was off screen as the page showed it and whether it has been seen since. */
function beamsPhase(offScreen: boolean, seen: SceneSeen): BeamsPhase {
  if (!offScreen || seen === 'reduced') return 'drawn'
  return seen === 'seen' ? 'drawing' : 'waiting'
}

/** To three places, so the server's markup and the browser's agree. */
function round(value: number): number {
  return Math.round(value * 1000) / 1000
}

export {
  type BeamFlow,
  BeamField,
  type BeamLayout,
  type BeamLink,
  type BeamPoint,
  BeamSpot,
}
export { beamPath, beamsPhase, pulseDash, spotPlace }
