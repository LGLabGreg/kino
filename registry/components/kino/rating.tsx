'use client'

import { IconPlaceholder } from '@/registry/icons/icon-placeholder'
import { choicePressingClassName } from '@/registry/lib/choice'
import { useControllable } from '@/registry/lib/controllable'
import { focusPicked, useFieldProps, useLabelFocus } from '@/registry/lib/field-control'
import { mergeRefs } from '@/registry/lib/refs'
import { useDirection } from '@base-ui/react/direction-provider'
import { Radio as RadioPrimitive } from '@base-ui/react/radio'
import { RadioGroup as RadioGroupPrimitive } from '@base-ui/react/radio-group'
import {
  type CSSProperties,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  useCallback,
  useMemo,
  useState,
} from 'react'

import { cn } from '@/lib/utils'

type RatingStep = 0.5 | 1

type RatingProps = Omit<
  RadioGroupPrimitive.Props<number | null>,
  'className' | 'style' | 'value' | 'defaultValue' | 'onValueChange' | 'children'
> & {
  className?: string
  style?: CSSProperties
  value?: number | null
  defaultValue?: number | null
  onValueChange?: (value: number, details: RadioGroupPrimitive.ChangeEventDetails) => void
  /** How many stars. */
  max?: number
  /** `0.5` lets a person pick half a star. */
  step?: RatingStep
  /**
   * Names each score, and the score a read-only rating shows. The default
   * reads `3.5 out of 5 stars`.
   */
  getAriaLabel?: (value: number, max: number) => string
}

const defaultAriaLabel = (value: number, max: number) => `${value} out of ${max} stars`

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
  'text-muted-foreground group-aria-invalid/rating:text-destructive group-data-invalid/rating:text-destructive',
)

// The filled stars are one layer as wide as the row, clipped to the score, so
// a new score wipes along the row from the old one in a single move and turns
// back from wherever it is when the score changes again.
const fillClassName =
  'text-primary pointer-events-none absolute inset-0 flex transition-[clip-path] duration-(--motion-draw-duration) ease-(--motion-draw-easing) [clip-path:inset(0_calc(100%_-_var(--rating-fill))_0_0)] motion-reduce:transition-none rtl:[clip-path:inset(0_0_0_calc(100%_-_var(--rating-fill)))] forced-colors:text-[Highlight] [&_svg]:fill-current'

function Stars({
  max,
  shown,
  pressed,
  cell,
}: {
  max: number
  shown: number
  pressed: number | null
  cell: (index: number, star: ReactNode) => ReactNode
}) {
  const stars = Array.from({ length: max }, (_, index) => index)
  return (
    <>
      {stars.map((index) =>
        cell(
          index,
          <span
            data-pressing={pressed === index || undefined}
            className={emptyStarClassName}
          >
            <IconPlaceholder
              lucide='StarIcon'
              tabler='IconStar'
              hugeicons='StarIcon'
              phosphor='StarIcon'
              remixicon='RiStarLine'
              aria-hidden
            />
          </span>,
        ),
      )}
      <span
        aria-hidden
        data-slot='rating-fill'
        className={fillClassName}
        style={{ '--rating-fill': ratingFill(shown, max) } as CSSProperties}
      >
        {stars.map((index) => (
          <span key={index} className={cellClassName}>
            <span
              data-pressing={pressed === index || undefined}
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
    </>
  )
}

function Rating({
  className,
  value,
  defaultValue = null,
  onValueChange,
  max = 5,
  step = 1,
  readOnly,
  disabled,
  name,
  form,
  required,
  inputRef,
  getAriaLabel = defaultAriaLabel,
  style: styleProp,
  ...props
}: RatingProps) {
  const rtl = useDirection() === 'rtl'
  const { field, invalid, props: fieldProps } = useFieldProps(props)
  // A label can't focus a group for itself: a press on it focuses the score.
  const [group, setGroup] = useState<HTMLElement | null>(null)
  const fieldRef = fieldProps.ref
  const groupRef = useMemo(() => mergeRefs(setGroup, fieldRef), [fieldRef])
  const focusScore = useCallback(() => focusPicked(group), [group])
  useLabelFocus(
    props['aria-labelledby'] ? undefined : fieldProps['aria-labelledby']?.split(' ')[0],
    disabled === true || field?.disabled === true,
    focusScore,
  )
  const [current, setCurrent] = useControllable(
    value,
    defaultValue,
    (next: number | null, details: RadioGroupPrimitive.ChangeEventDetails) => {
      if (next !== null) onValueChange?.(next, details)
    },
  )
  const [preview, setPreview] = useState<number | null>(null)
  // A press by the pointer ends when it's let go; by Space, when the key comes
  // up or focus leaves, which the pointer's own press also makes happen.
  const [pressed, setPressed] = useState<{ index: number; by: 'pointer' | 'key' } | null>(
    null,
  )
  const releaseKey = () => setPressed((held) => (held?.by === 'key' ? null : held))

  const style = { ...styleProp, '--rating-max': max } as CSSProperties

  if (readOnly) {
    const score = current ?? 0
    return (
      <div
        data-slot='rating'
        data-readonly=''
        role='img'
        aria-label={getAriaLabel(score, max)}
        {...props}
        style={style}
        className={cn(rootClassName, className)}
      >
        <Stars
          max={max}
          shown={score}
          pressed={null}
          cell={(index, star) => (
            <span key={index} className={cellClassName}>
              {star}
            </span>
          )}
        />
      </div>
    )
  }

  /** The score under the pointer in the star at `index`. */
  const scoreAt = (
    event: PointerEvent<HTMLElement> | MouseEvent<HTMLElement>,
    index: number,
  ) => {
    const box = event.currentTarget.getBoundingClientRect()
    const offset = rtl ? box.right - event.clientX : event.clientX - box.left
    return ratingAt(offset, box.width, index, step)
  }

  const pick = (event: MouseEvent<HTMLElement>, index: number) => {
    // The radios take no pointer, so a press on a star picks the radio for
    // the half it landed on; the click that radio dispatches comes back here.
    if ((event.target as Element).closest('[role=radio]')) return
    const score = scoreAt(event, index)
    const radio = event.currentTarget.querySelector<HTMLElement>(
      `[data-score="${score}"]`,
    )
    radio?.click()
    radio?.focus({ focusVisible: false })
  }

  return (
    <RadioGroupPrimitive<number | null>
      {...fieldProps}
      ref={groupRef}
      data-slot='rating'
      data-invalid={invalid || undefined}
      value={current}
      disabled={disabled || field?.disabled}
      name={name ?? field?.name}
      form={form}
      required={required}
      inputRef={inputRef}
      onValueChange={(next, details) => {
        if (next === null) return
        setCurrent(next, details)
      }}
      onPointerLeave={(event) => {
        setPreview(null)
        setPressed(null)
        props.onPointerLeave?.(event)
      }}
      onPointerUp={(event) => {
        setPressed(null)
        props.onPointerUp?.(event)
      }}
      onPointerCancel={(event) => {
        setPressed(null)
        props.onPointerCancel?.(event)
      }}
      onKeyDown={(event) => {
        setPreview(null)
        props.onKeyDown?.(event)
      }}
      className={cn(
        rootClassName,
        'data-disabled:pointer-events-none data-disabled:opacity-50 forced-colors:aria-invalid:outline-2 forced-colors:aria-invalid:outline-dashed forced-colors:data-invalid:outline-2 forced-colors:data-invalid:outline-dashed',
        className,
      )}
      style={style}
    >
      <Stars
        max={max}
        shown={preview ?? current ?? 0}
        pressed={pressed?.index ?? null}
        cell={(index, star) => (
          // oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- the star is the pointer's target; the radios inside it take the keys
          <span
            key={index}
            data-slot='rating-item'
            className={cellClassName}
            onPointerMove={(event) => {
              if (event.pointerType === 'touch') return
              setPreview(scoreAt(event, index))
            }}
            onPointerDown={(event) => {
              if (event.button === 0) setPressed({ index, by: 'pointer' })
            }}
            onClick={(event) => pick(event, index)}
          >
            {star}
            {ratingScores(index, step).map((score) => (
              <RadioPrimitive.Root
                key={score}
                value={score}
                data-score={score}
                aria-label={getAriaLabel(score, max)}
                onKeyDown={(event) => {
                  if (event.key === ' ') setPressed({ index, by: 'key' })
                }}
                onKeyUp={releaseKey}
                onBlur={releaseKey}
                // A half covers the star's first half, so a screen reader's tap
                // on it picks the half and its ring shows which half is focused.
                className={cn(
                  'focus-visible:ring-ring/50 pointer-events-none absolute inset-y-0 start-0 rounded-(--control-radius-xs) focus-visible:ring-3 focus-visible:outline-hidden',
                  score % 1 === 0 ? 'end-0' : 'w-1/2',
                )}
              />
            ))}
          </span>
        )}
      />
    </RadioGroupPrimitive>
  )
}

/** The scores a person can pick in the star at `index`, counted from 0: its half, then all of it. */
function ratingScores(index: number, step: RatingStep) {
  return step === 0.5 ? [index + 0.5, index + 1] : [index + 1]
}

/**
 * The score a pointer `offset` px from the start edge of the star at `index`
 * picks, in a star `width` px wide: half of it on its first half when the
 * step is a half.
 */
function ratingAt(offset: number, width: number, index: number, step: RatingStep) {
  return step === 0.5 && offset < width / 2 ? index + 0.5 : index + 1
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
export { ratingAt, ratingFill, ratingScores }
export type { RatingProps, RatingStep }
