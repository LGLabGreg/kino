'use client'

import { choiceWipeClassName } from '@/registry/lib/choice'
import { mergeRefs } from '@/registry/lib/refs'
import {
  type StepStatus,
  stepLineClassName,
  stepLineFillClassName,
  stepStatusText,
  stepTileClassName,
  stepTiming,
} from '@/registry/lib/step'
import { Button as ButtonPrimitive } from '@base-ui/react/button'
import { mergeProps } from '@base-ui/react/merge-props'
import { useRender } from '@base-ui/react/use-render'
import {
  type ComponentProps,
  type CSSProperties,
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'

import { cn } from '@/lib/utils'

/*
 * Where a person is in a flow of steps, such as a checkout or a setup: each
 * step a marker on a line, with its title beside it. The markers and lines
 * are the Timeline's: a done step's marker fills with a tick that wipes in,
 * the current one is ringed, an upcoming one is hollow and an error takes
 * the destructive colour with a mark of its own.
 *
 * When the current step moves, the line out of each step passed fills along
 * its length on `draw` (or empties, going back) and each marker on the way
 * changes once the line reaching it has arrived, so the current ring travels
 * to its new step. A move of several steps takes as long as one.
 *
 * A horizontal stepper puts each title beside its marker; in a box narrower
 * than 42rem the titles go under the markers, so every one stays readable,
 * and below 28rem the descriptions are left to screen readers.
 */

type StepperOrientation = 'horizontal' | 'vertical'

interface StepperContextValue {
  value: number
  from: number
  orientation: StepperOrientation
  linear: boolean
  select: (step: number) => void
}

const StepperContext = createContext<StepperContextValue | null>(null)

function useStepper() {
  const context = useContext(StepperContext)
  if (!context) throw new Error('Stepper parts go inside a Stepper.')
  return context
}

interface StepperItemContextValue {
  step: number
  status: StepStatus
  setHasTrigger: (has: boolean) => void
}

const StepperItemContext = createContext<StepperItemContextValue | null>(null)

function useStepperItem() {
  const context = useContext(StepperItemContext)
  if (!context) throw new Error('A step’s parts go inside a StepperItem.')
  return context
}

/**
 * `value` is the current step, counted from 0: the steps before it are
 * complete and the ones after it upcoming, and one past the last marks every
 * step complete. `className` is for the list itself, as `<ol>`'s;
 * `containerClassName` for the box around it. Name it with `aria-label` or
 * `aria-labelledby`.
 */
function Stepper({
  className,
  containerClassName,
  value: valueProp,
  defaultValue = 0,
  onValueChange,
  orientation = 'horizontal',
  linear = true,
  ref,
  ...props
}: Omit<ComponentProps<'ol'>, 'defaultValue'> & {
  containerClassName?: string
  value?: number
  defaultValue?: number
  onValueChange?: (value: number) => void
  orientation?: StepperOrientation
  /**
   * In a linear flow a `StepperTrigger` goes back to a step already reached
   * but not on to an upcoming one; `false` lets every step be picked.
   */
  linear?: boolean
}) {
  const [own, setOwn] = useState(defaultValue)
  const value = valueProp ?? own
  // The step it last moved from, so the lines and markers between the two
  // take their turns. A move that starts while the last still runs takes no
  // turns, so everything turns back from where it is.
  const [move, setMove] = useState({ from: value, to: value })
  const [busy, setBusy] = useState(false)
  if (move.to !== value) setMove({ from: busy ? value : move.to, to: value })
  const list = useRef<HTMLOListElement>(null)
  useEffect(() => {
    const element = list.current
    if (!element) return
    const running = new Map<EventTarget, Set<string>>()
    const run = (event: TransitionEvent) => {
      if (!(event.target instanceof Element)) return
      if (!event.target.closest('[data-slot=stepper-line],[data-slot=stepper-marker]'))
        return
      const properties = running.get(event.target) ?? new Set<string>()
      properties.add(event.propertyName)
      running.set(event.target, properties)
      setBusy(true)
    }
    const end = (event: TransitionEvent) => {
      const properties = running.get(event.target as EventTarget)
      properties?.delete(event.propertyName)
      if (properties?.size === 0) running.delete(event.target as EventTarget)
      if (running.size === 0) setBusy(false)
    }
    element.addEventListener('transitionrun', run)
    element.addEventListener('transitionend', end)
    element.addEventListener('transitioncancel', end)
    return () => {
      element.removeEventListener('transitionrun', run)
      element.removeEventListener('transitionend', end)
      element.removeEventListener('transitioncancel', end)
    }
  }, [])

  const select = (step: number) => {
    if (step === value) return
    setOwn(step)
    onValueChange?.(step)
  }

  return (
    <StepperContext.Provider
      value={{ value, from: move.from, orientation, linear, select }}
    >
      <div
        data-slot='stepper'
        className={cn(
          // Horizontal reads its own width, so it fills its parent's.
          orientation === 'horizontal' && '@container/stepper w-full',
          containerClassName,
        )}
      >
        <ol
          ref={mergeRefs(list, ref)}
          data-slot='stepper-list'
          data-orientation={orientation}
          className={cn(
            'group/stepper flex [--stepper-gap:var(--control-padding)] [--stepper-marker:var(--control-height-xs)]',
            orientation === 'horizontal'
              ? 'items-start gap-(--stepper-gap)'
              : 'flex-col gap-(--stepper-gap) [--stepper-gap:var(--surface-gap)]',
            className,
          )}
          {...props}
        />
      </div>
    </StepperContext.Provider>
  )
}

/** Its colours wait (`--stepper-wait`) and its line fills (`--stepper-line-*`) in its turn of a move, as fractions of `draw`. */
function timingStyle(step: number, from: number, to: number) {
  const timing = stepTiming(step, from, to)
  return {
    '--stepper-wait': timing.markerWait,
    '--stepper-line-delay': timing.lineDelay,
    '--stepper-line-span': timing.lineSpan,
  } as CSSProperties
}

/**
 * One step, numbered by `step` from 0. Its status follows the Stepper's
 * `value`; `status` sets it instead, such as `error` on a step that needs
 * another look. Hold the marker and content in a `StepperTrigger` to make the
 * step one a person can go to, or put them straight in for a stepper that
 * only shows where they are.
 */
function StepperItem({
  className,
  step,
  status: statusProp,
  style,
  render,
  children,
  ...props
}: useRender.ComponentProps<'li'> & { step: number; status?: StepStatus }) {
  const { value, from, orientation } = useStepper()
  const status: StepStatus =
    statusProp ?? (step < value ? 'complete' : step === value ? 'current' : 'upcoming')
  const [hasTrigger, setHasTrigger] = useState(false)
  const horizontal = orientation === 'horizontal'
  const element = useRender({
    defaultTagName: 'li',
    props: mergeProps<'li'>(
      {
        // A trigger carries it instead, where a screen reader meets it.
        'aria-current': step === value && !hasTrigger ? 'step' : undefined,
        style: { ...timingStyle(step, from, value), ...style },
        className: cn(
          'group/step relative flex min-w-0 motion-safe:[--step-wait:calc(var(--motion-draw-duration)*var(--stepper-wait))]',
          horizontal
            ? 'flex-1 basis-0 flex-col items-center gap-y-1.5 text-center @2xl/stepper:flex-row @2xl/stepper:items-start @2xl/stepper:gap-x-(--control-padding) @2xl/stepper:text-start @2xl/stepper:last:flex-none'
            : 'items-start gap-x-(--control-padding)',
          className,
        ),
        children: (
          <>
            {children}
            <StepperLine passed={step < value} horizontal={horizontal} />
          </>
        ),
      },
      props,
    ),
    render,
    state: { slot: 'stepper-item', status, passed: step < value },
  })
  return (
    <StepperItemContext.Provider value={{ step, status, setHasTrigger }}>
      {element}
    </StepperItemContext.Provider>
  )
}

/**
 * The line to the next step, 4px clear of both markers. Once its step is
 * passed it fills from the start on `draw`, in its turn of a move.
 */
function StepperLine({ passed, horizontal }: { passed: boolean; horizontal: boolean }) {
  return (
    <span
      aria-hidden
      data-slot='stepper-line'
      data-passed={passed || undefined}
      className={cn(
        stepLineClassName,
        'group-last/step:hidden',
        horizontal
          ? // Under the titles, it runs from this marker's centre to the next
            // one's, across the gap between the steps; beside them, it takes
            // the room left after this title.
            'absolute start-[calc(50%+var(--stepper-marker)/2+0.25rem)] top-[calc(var(--stepper-marker)/2-0.5px)] h-px w-[calc(100%+var(--stepper-gap)-var(--stepper-marker)-0.5rem)] @2xl/stepper:relative @2xl/stepper:start-auto @2xl/stepper:top-auto @2xl/stepper:mt-[calc(var(--stepper-marker)/2-0.5px)] @2xl/stepper:w-auto @2xl/stepper:min-w-4 @2xl/stepper:flex-1'
          : 'absolute start-[calc(var(--stepper-marker)/2-0.5px)] top-[calc(var(--stepper-marker)+0.25rem)] -bottom-[calc(var(--stepper-gap)-0.25rem)] w-px',
      )}
    >
      <span
        className={cn(
          stepLineFillClassName,
          'delay-[calc(var(--motion-draw-duration)*var(--stepper-line-delay))] duration-[calc(var(--motion-draw-duration)*var(--stepper-line-span))]',
          horizontal
            ? 'origin-left scale-x-0 rtl:origin-right [[data-passed]>&]:scale-x-100'
            : 'origin-top scale-y-0 [[data-passed]>&]:scale-y-100',
        )}
      />
    </span>
  )
}

const markLayerClassName =
  'col-start-1 row-start-1 flex items-center justify-center transition-opacity duration-(--motion-morph-duration) ease-(--motion-morph-easing) [transition-delay:var(--step-wait,0s)]'

/** The checkbox's tick, and an exclamation mark drawn the same way. */
function Mark({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox='0 0 14 14'
      fill='none'
      stroke='currentColor'
      strokeWidth={2}
      strokeLinecap='round'
      strokeLinejoin='round'
      aria-hidden
      className='size-3.5 overflow-visible'
    >
      {children}
    </svg>
  )
}

/**
 * The step's mark: its number, or the icon given as its children. A done
 * step shows the Checkbox's tick, which wipes in on `draw`, and an error an
 * exclamation mark, so neither leans on colour alone. Decorative: the title
 * and the status a screen reader hears say what it is.
 */
function StepperMarker({
  className,
  render,
  children,
  ...props
}: useRender.ComponentProps<'span'>) {
  const { step } = useStepperItem()
  return useRender({
    defaultTagName: 'span',
    props: mergeProps<'span'>(
      {
        'aria-hidden': true,
        className: cn(
          'relative z-10 flex size-(--stepper-marker) shrink-0 items-center justify-center',
          className,
        ),
        children: (
          <span
            className={cn(
              stepTileClassName,
              'grid text-xs leading-none font-medium tabular-nums',
            )}
          >
            <span
              className={cn(
                markLayerClassName,
                'group-data-[status=complete]/step:opacity-0 group-data-[status=error]/step:opacity-0',
              )}
            >
              {children ?? step + 1}
            </span>
            <span className={markLayerClassName}>
              <Mark>
                <path
                  d='M3 7.4 5.8 10.2 11 4.2'
                  className={cn(
                    choiceWipeClassName,
                    '[transition-delay:var(--step-wait,0s)] group-data-[status=complete]/step:[clip-path:inset(0_0_0_0)]!',
                  )}
                />
              </Mark>
            </span>
            <span
              className={cn(
                markLayerClassName,
                'opacity-0 group-data-[status=error]/step:opacity-100',
              )}
            >
              <Mark>
                <path d='M7 3.5v4.25M7 10.5h.01' />
              </Mark>
            </span>
          </span>
        ),
      },
      props,
    ),
    render,
    state: { slot: 'stepper-marker' },
  })
}

/**
 * Makes a step one a person can go to: a `<button>`, or a link with
 * `render={<a href='…' />}` and `nativeButton={false}`. It picks its step
 * (`onValueChange`); in a `linear` stepper an upcoming step's trigger is
 * disabled, so it leaves the tab order.
 */
function StepperTrigger({
  className,
  disabled,
  onClick,
  role,
  ...props
}: Omit<ButtonPrimitive.Props, 'className'> & { className?: string }) {
  const { value, linear, select, orientation } = useStepper()
  const { step, setHasTrigger } = useStepperItem()
  useLayoutEffect(() => {
    setHasTrigger(true)
    return () => setHasTrigger(false)
  }, [setHasTrigger])
  return (
    <ButtonPrimitive
      data-slot='stepper-trigger'
      aria-current={step === value ? 'step' : undefined}
      disabled={disabled ?? (linear && step > value)}
      onClick={(event) => {
        onClick?.(event)
        select(step)
      }}
      className={cn(
        // Its backdrop reaches 4px past the marker and title, where it can't
        // move them, and over a line that runs under a title below its marker.
        'relative z-10 -m-1 flex min-w-0 rounded-(--control-radius-capped) p-1 transition-colors duration-(--motion-press-duration) ease-(--motion-press-fade-easing) outline-offset-2 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-hidden not-data-disabled:hover:bg-accent/70 not-data-disabled:active:bg-accent data-disabled:cursor-default',
        orientation === 'horizontal'
          ? 'flex-col items-center gap-y-1.5 text-center @2xl/stepper:flex-row @2xl/stepper:items-start @2xl/stepper:gap-x-(--control-padding) @2xl/stepper:text-start'
          : 'items-start gap-x-(--control-padding) text-start',
        className,
      )}
      {...props}
      // Base UI calls whatever it renders other than a `<button>` a button; a
      // link stays a link unless a role is given.
      role={role}
    />
  )
}

/** The title and any description, its first line level with the marker beside it. */
function StepperContent({
  className,
  render,
  children,
  ...props
}: useRender.ComponentProps<'div'>) {
  const { status } = useStepperItem()
  const { orientation } = useStepper()
  return useRender({
    defaultTagName: 'div',
    props: mergeProps<'div'>(
      {
        className: cn(
          'flex min-w-0 flex-col gap-0.5',
          orientation === 'horizontal'
            ? 'max-w-full @2xl/stepper:py-[calc((var(--stepper-marker)-1.25rem)/2)]'
            : 'py-[calc((var(--stepper-marker)-1.25rem)/2)]',
          className,
        ),
        children: (
          <>
            {stepStatusText[status] ? (
              <span className='sr-only'>{stepStatusText[status]}: </span>
            ) : null}
            {children}
          </>
        ),
      },
      props,
    ),
    render,
    state: { slot: 'stepper-content' },
  })
}

/**
 * Muted while upcoming, destructive on an error. A long unbroken word breaks
 * rather than run out of the box. Under the markers of a narrow horizontal
 * stepper it is a size smaller.
 */
function StepperTitle({ className, render, ...props }: useRender.ComponentProps<'div'>) {
  return useRender({
    defaultTagName: 'div',
    props: mergeProps<'div'>(
      {
        className: cn(
          'text-sm leading-5 font-medium wrap-anywhere transition-colors @max-md/stepper:group-data-[orientation=horizontal]/stepper:text-xs @max-md/stepper:group-data-[orientation=horizontal]/stepper:leading-4 duration-(--motion-morph-duration) ease-(--motion-morph-fade-easing) [transition-delay:var(--step-wait,0s)] group-data-[status=error]/step:text-destructive group-data-[status=upcoming]/step:text-muted-foreground',
          className,
        ),
      },
      props,
    ),
    render,
    state: { slot: 'stepper-title' },
  })
}

/**
 * A line under the title: what the step asks for, or that it's optional.
 * Under the markers of a narrow horizontal stepper only a screen reader
 * reads it, since the columns are too narrow for it.
 */
function StepperDescription({
  className,
  render,
  ...props
}: useRender.ComponentProps<'div'>) {
  return useRender({
    defaultTagName: 'div',
    props: mergeProps<'div'>(
      {
        className: cn(
          'text-muted-foreground text-sm leading-5 text-pretty wrap-anywhere @max-md/stepper:group-data-[orientation=horizontal]/stepper:sr-only',
          className,
        ),
      },
      props,
    ),
    render,
    state: { slot: 'stepper-description' },
  })
}

export {
  Stepper,
  StepperContent,
  StepperDescription,
  StepperItem,
  StepperMarker,
  StepperTitle,
  StepperTrigger,
}
export type { StepperOrientation }
