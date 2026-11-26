'use client'

import { IconPlaceholder } from '@/registry/icons/icon-placeholder'
import { choicePressingClassName } from '@/registry/lib/choice'
import { renderElement } from '@ui-sdk/react/primitive'
import {
  Rating as RatingPrimitive,
  RatingItem as RatingItemPrimitive,
} from '@ui-sdk/react/rating'
import {
  type ComponentProps,
  type CSSProperties,
  createContext,
  type KeyboardEvent,
  type PointerEvent,
  use,
  useState,
} from 'react'

import { cn } from '@/lib/utils'

type RatingProps = Omit<
  ComponentProps<typeof RatingPrimitive>,
  'className' | 'children' | 'step'
> & {
  className?: string
  /** `0.5` lets a person pick half a star. */
  step?: 0.5 | 1
}

const defaultValueLabel = (value: number, max: number) => `${value} out of ${max} stars`

// Each star sits in a cell as large as the density's smallest control, which
// is what the pointer aims at: a whole star is one target, and with half steps
// the half it lands on picks the score, as a slider's track does. In a column
// narrower than the row, the cells share it and the stars shrink to fit.
const rootClassName =
  'group/rating relative inline-flex w-[calc(var(--rating-max)*var(--control-height-xs))] max-w-full [--rating-star:1.25rem]'

const cellClassName =
  'relative flex h-(--control-height-xs) min-w-0 flex-1 items-center justify-center'

const starClassName =
  'flex size-full items-center justify-center [&_svg]:h-(--rating-star) [&_svg]:w-[min(var(--rating-star),100%)]'

// Phosphor fills a star with its weight, which the other libraries ignore.
const phosphorFill = { weight: 'fill' } as const

const emptyStarClassName = cn(
  choicePressingClassName,
  starClassName,
  'text-muted-foreground group-aria-invalid/rating:text-destructive',
)

// The filled stars are one layer as wide as the row, clipped to the score, so
// a new score wipes along the row from the old one in a single move and turns
// back from wherever it is when the score changes again.
const fillClassName =
  'text-primary pointer-events-none absolute inset-0 flex transition-[clip-path] duration-(--motion-draw-duration) ease-(--motion-draw-easing) [clip-path:inset(0_calc(100%_-_var(--rating-reach))_0_0)] motion-reduce:transition-none rtl:[clip-path:inset(0_0_0_calc(100%_-_var(--rating-reach)))] forced-colors:text-[Highlight] [&_svg]:fill-current'

/** The star a press is on, by pointer or Space, for its stars to sink a little. */
const PressContext = createContext<{
  pressed: number | null
  press: (index: number | null) => void
}>({ pressed: null, press: () => {} })

function EmptyStar({ pressing }: { pressing: boolean }) {
  return (
    <span data-pressing={pressing || undefined} className={emptyStarClassName}>
      <IconPlaceholder
        lucide='StarIcon'
        tabler='IconStar'
        hugeicons='StarIcon'
        phosphor='StarIcon'
        remixicon='RiStarLine'
        aria-hidden
      />
    </span>
  )
}

/** The filled stars, one layer over the row, clipped to the score shown. */
function Fill({
  max,
  shown,
  pressed,
}: {
  max: number
  shown: number
  pressed: number | null
}) {
  return (
    <span
      aria-hidden
      data-rating-fill=''
      className={fillClassName}
      style={{ '--rating-reach': ratingFill(shown, max) } as CSSProperties}
    >
      {Array.from({ length: max }, (_, at) => (
        // oxlint-disable-next-line react/no-array-index-key -- a star is its place in the row
        <span key={at} className={cellClassName}>
          <span
            data-pressing={pressed === at + 1 || undefined}
            className={cn(choicePressingClassName, starClassName)}
          >
            <IconPlaceholder
              lucide='StarIcon'
              tabler='IconStarFilled'
              hugeicons='StarIcon'
              phosphor='StarIcon'
              remixicon='RiStarFill'
              aria-hidden
              {...phosphorFill}
            />
          </span>
        </span>
      ))}
    </span>
  )
}

/** One star's cell: its empty icon, under ui-sdk's radios for its score. */
function RatingItem() {
  const { pressed, press } = use(PressContext)
  return (
    <RatingItemPrimitive
      onPointerDown={(event: PointerEvent<HTMLSpanElement>) => {
        if (event.button === 0) press(Number(event.currentTarget.dataset.index))
      }}
      onKeyDown={(event: KeyboardEvent<HTMLSpanElement>) => {
        if (event.key === ' ') press(Number(event.currentTarget.dataset.index))
      }}
      onKeyUp={() => press(null)}
      onBlur={() => press(null)}
      render={(props, { index }) => (
        <span {...props} data-index={index}>
          {props.children}
        </span>
      )}
      // A half's radio covers the star's first half and the whole's the rest, so the ring shows which is focused.
      className={cn(
        cellClassName,
        '[&_[role=radio]]:rounded-(--control-radius-xs) [&_[role=radio]]:focus-visible:ring-3 [&_[role=radio]]:focus-visible:ring-ring/50 [&_[role=radio]]:focus-visible:outline-hidden',
      )}
    >
      {({ index }) => <EmptyStar pressing={pressed === index} />}
    </RatingItemPrimitive>
  )
}

function Rating({
  className,
  max = 5,
  getValueLabel = defaultValueLabel,
  readOnly,
  style,
  render,
  onPointerLeave,
  onPointerUp,
  onPointerCancel,
  ...props
}: RatingProps) {
  const [pressed, press] = useState<number | null>(null)
  return (
    <PressContext value={{ pressed, press }}>
      <RatingPrimitive
        max={max}
        getValueLabel={getValueLabel}
        readOnly={readOnly}
        onPointerLeave={(event) => {
          press(null)
          onPointerLeave?.(event)
        }}
        onPointerUp={(event) => {
          press(null)
          onPointerUp?.(event)
        }}
        onPointerCancel={(event) => {
          press(null)
          onPointerCancel?.(event)
        }}
        style={(state) =>
          ({
            ...(typeof style === 'function' ? style(state) : style),
            '--rating-max': max,
          }) as CSSProperties
        }
        className={cn(
          rootClassName,
          !readOnly &&
            'data-disabled:pointer-events-none data-disabled:opacity-50 forced-colors:aria-invalid:outline-2 forced-colors:aria-invalid:outline-dashed',
          className,
        )}
        // The filled stars are one layer after the stars, so a new score wipes along the row.
        render={(rootProps, state) => {
          const children = (
            <>
              {rootProps.children}
              <Fill
                max={max}
                shown={state.highlighted ?? state.value ?? 0}
                pressed={readOnly ? null : pressed}
              />
            </>
          )
          return renderElement('div', { ...rootProps, children }, render, state)
        }}
        {...props}
      >
        {/* Each star, which ui-sdk repeats along the row. A score that can't change is one image: its stars hold no radios, which a screen reader could still reach. */}
        {readOnly ? (
          <span aria-hidden className={cellClassName}>
            <EmptyStar pressing={false} />
          </span>
        ) : (
          <RatingItem />
        )}
      </RatingPrimitive>
    </PressContext>
  )
}

/**
 * How far along the row the filled stars reach for `value`, as a CSS length
 * in percent of the row: every whole star's cell, then that share of the next
 * star's own width, which is `--rating-star` or its cell's, if narrower.
 */
function ratingFill(value: number, max: number) {
  const score = Math.min(max, Math.max(0, value))
  const whole = Math.floor(score)
  const part = Math.round((score - whole) * 1000) / 1000
  const cell = `(100% / ${max})`
  if (part === 0) return `calc(${whole} * ${cell})`
  const star = `min(var(--rating-star), ${cell})`
  return `calc(${whole} * ${cell} + (${cell} - ${star}) / 2 + ${part} * ${star})`
}

export { Rating }
export { ratingFill }
export type { RatingProps }
