'use client'

import { AnimatedNumber } from '@/registry/components/kino/animated-number'
import { Badge } from '@/registry/components/kino/badge'
import { Bar, BarChart, type BarChartProps } from '@/registry/components/kino/bar-chart'
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/registry/components/kino/card'
import { ChartTooltip } from '@/registry/components/kino/chart'
import {
  Skeleton,
  SkeletonContent,
  SkeletonText,
} from '@/registry/components/kino/skeleton'
import { Sparkline, type SparklineProps } from '@/registry/components/kino/sparkline'
import { IconPlaceholder } from '@/registry/icons/icon-placeholder'
import type { ChartDatum } from '@/registry/lib/chart-math'
import { swatchClassName } from '@/registry/lib/chart-root'
import { numberFormatter } from '@/registry/lib/number-format'
import { placeholderFillClassName } from '@/registry/lib/placeholder'
import { Swap, SwapText } from '@/registry/lib/swap'
import {
  slidingFillClassName,
  slidingFillStyle,
  slidingMarkClassName,
  trackClassName,
  trackDirClassName,
  valuePercent,
} from '@/registry/lib/track'
import { Meter as MeterPrimitive } from '@base-ui/react/meter'
import { cva, type VariantProps } from 'class-variance-authority'
import {
  type ComponentProps,
  createContext,
  type ReactNode,
  use,
  useId,
  useMemo,
} from 'react'

import { cn } from '@/lib/utils'

/*
 * A key number on a card, and what it means: its value, how it moved since
 * the period before, and the picture its use needs. Every KPI shares the
 * card, the label, the value and the change; the picture is the variant,
 * each a part of its own: a trend over the period (with the period before
 * dashed behind it), progress to a goal or a limit with the pace it should
 * keep, a score in its bands, the parts of a whole, or a strip of days.
 *
 * Each part answers a new value in place, so the move explains the change:
 * the digits roll from the old value, the arrow turns to the new direction,
 * the trend reshapes, a fill or a marker glides to its new place, and the
 * parts of a whole make room for each other. Nothing moves on first paint.
 */

/** Which way of moving is good news: higher for revenue, lower for churn, neither for a count of sessions. */
type KpiBetter = 'higher' | 'lower' | 'neither'

/**
 * How a change is measured: as a share of the value before (`percent`), as
 * the difference itself (`amount`), or, for a value that is a rate such as
 * 2.1%, the difference in percentage points (`points`), since a rate going
 * from 2.1% to 1.8% fell 0.3 points, not 14%.
 */
type KpiChangeKind = 'percent' | 'amount' | 'points'

/** Which way the value moved: up, down, not at all, or none to tell, with nothing before it. */
type KpiDirection = 'up' | 'down' | 'flat' | 'none'

/** Whether a move or a state is good news, worth a look, bad news, or neither. */
type KpiTone = 'positive' | 'warning' | 'negative' | 'neutral'

interface KpiMessages {
  up: string
  down: string
  flat: string
  none: string
  noData: string
  /** A change in percentage points, already written as a number. */
  points: (size: string) => string
  /** The share of the goal reached, or of the limit used, already written as a percentage. */
  ofTarget: (share: string, target: string) => string
  achieved: string
  onTrack: string
  behind: string
  /** What is left before the goal, already written. */
  toGo: (left: string) => string
  /** What is left before the limit, already written. */
  left: (left: string) => string
  /** How far past the limit it is, already written. */
  over: (by: string) => string
  overPace: string
  live: string
  /** What the last value of a live trend says in the tooltip: it is still coming in. */
  soFar: string
}

const kpiMessages: KpiMessages = {
  up: 'Up',
  down: 'Down',
  flat: 'No change',
  none: 'New',
  noData: 'No data',
  points: (size) => `${size} pts`,
  ofTarget: (share, target) => `${share} of ${target}`,
  achieved: 'Achieved',
  onTrack: 'On track',
  behind: 'Behind pace',
  toGo: (left) => `${left} to go`,
  left: (left) => `${left} left`,
  over: (by) => `Over by ${by}`,
  overPace: 'Over pace',
  live: 'Live',
  soFar: 'so far',
}

interface KpiContextValue {
  value: number | null
  previous: number | null
  locale: Intl.LocalesArgument
  format: Intl.NumberFormatOptions | undefined
  better: KpiBetter
  loading: boolean
  labelId: string
  messages: KpiMessages
}

const KpiContext = createContext<KpiContextValue | null>(null)

function useKpi() {
  const kpi = use(KpiContext)
  if (!kpi) throw new Error('KPI parts go inside a `Kpi`.')
  return kpi
}

/** The decimals a change is written with below 10%, where a tenth still matters. */
const CHANGE_DECIMALS = 1

/**
 * The size of the change from `previous` to `value`, measured as `kind`
 * says, which way it went, and whether that is good news. A change too small
 * to show at the decimals it is written with is flat, so a badge never reads
 * "0.0%" in red or "$0" in green. With nothing to compare with (no value
 * before, or a zero before a share), the size is null and the direction `none`.
 */
function kpiChange(
  value: number | null,
  previous: number | null,
  kind: KpiChangeKind,
  better: KpiBetter,
  /** The decimals an amount is written with, from the KPI's format. */
  amountDecimals = 2,
) {
  const exact =
    value === null || previous === null
      ? null
      : kind === 'percent'
        ? previous === 0
          ? null
          : (value - previous) / Math.abs(previous)
        : kind === 'points'
          ? (value - previous) * 100
          : value - previous
  const decimals =
    exact === null
      ? 0
      : kind === 'percent'
        ? Math.abs(exact) < 0.1
          ? 3
          : 2
        : kind === 'amount'
          ? amountDecimals
          : // Points are written to a tenth, and to a hundredth below a tenth (pointsFormat).
            Math.abs(exact) < 0.1
            ? 2
            : CHANGE_DECIMALS
  const size =
    exact === null
      ? null
      : (Math.sign(exact) * Math.round(Math.abs(exact) * 10 ** decimals)) / 10 ** decimals
  const direction: KpiDirection =
    size === null ? 'none' : size > 0 ? 'up' : size < 0 ? 'down' : 'flat'
  const tone: KpiTone =
    better === 'neither' || direction === 'flat' || direction === 'none'
      ? 'neutral'
      : (direction === 'up') === (better === 'higher')
        ? 'positive'
        : 'negative'
  return { size, direction, tone }
}

/** How a share is written: with its decimal below 10%, whole from 10% up, as 18% and 250% read. */
function shareFormat(share: number): Intl.NumberFormatOptions {
  const decimals = Math.abs(share) < 0.1 && share !== 0 ? CHANGE_DECIMALS : 0
  return {
    style: 'percent',
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }
}

/** The KPI's own format, written as a difference: the same unit and currency, with no sign, since the arrow says it. */
function amountFormat(
  format: Intl.NumberFormatOptions | undefined,
): Intl.NumberFormatOptions {
  return { ...format, signDisplay: 'never' }
}

function Kpi({
  value,
  previous = null,
  locale,
  format,
  better = 'higher',
  loading = false,
  messages,
  className,
  children,
  ...props
}: Omit<ComponentProps<typeof Card>, 'children'> & {
  /** The number now, or null with no data for the period. */
  value: number | null
  /** The number the period before, which the change and the trend compare with. */
  previous?: number | null
  /** The locale the numbers are written in. Give one, so the page's server and browser agree. */
  locale?: Intl.LocalesArgument
  /** How the value is written: a currency, a percentage, a unit, compact. */
  format?: Intl.NumberFormatOptions
  /** Which way of moving is good news. */
  better?: KpiBetter
  /** Shows each part's placeholder while the number loads. */
  loading?: boolean
  /** The words it says, for another language. */
  messages?: Partial<KpiMessages>
  children?: ReactNode
}) {
  const labelId = useId()
  return (
    <KpiContext
      value={{
        value,
        previous,
        locale,
        format,
        better,
        loading,
        labelId,
        messages: { ...kpiMessages, ...messages },
      }}
    >
      <Card
        data-slot='kpi'
        aria-busy={loading || undefined}
        className={className}
        {...props}
      >
        {children}
      </Card>
    </KpiContext>
  )
}

/** The label and an action at its end, such as a period picker. */
function KpiHeader({ className, ...props }: ComponentProps<typeof CardHeader>) {
  return (
    <CardHeader
      data-slot='kpi-header'
      className={cn('items-center', className)}
      {...props}
    />
  )
}

/** What the number is: the card's title, which names the meters and charts below it. */
function KpiLabel({ className, ...props }: ComponentProps<typeof CardTitle>) {
  const { labelId } = useKpi()
  return (
    <CardTitle
      data-slot='kpi-label'
      className={cn('text-muted-foreground text-sm font-medium', className)}
      {...props}
      // The meters and charts below are named by it, so its id is the KPI's own.
      id={labelId}
    />
  )
}

/** An action at the label's end, in the label's row, so it never makes the header taller. */
function KpiAction({ className, ...props }: ComponentProps<typeof CardAction>) {
  return (
    <CardAction
      data-slot='kpi-action'
      className={cn('row-span-1 -my-2 self-center', className)}
      {...props}
    />
  )
}

/**
 * The figure and the picture under it. It takes the card's spare height and
 * the picture sits at its foot, so in a row of KPIs the numbers line up at
 * the top and the pictures at the bottom.
 */
function KpiContent({ className, ...props }: ComponentProps<typeof CardContent>) {
  return (
    <CardContent
      data-slot='kpi-content'
      className={cn(
        'flex flex-1 flex-col gap-4 *:not-first:data-[slot^=kpi-]:mt-auto',
        className,
      )}
      {...props}
    />
  )
}

function KpiFigure({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot='kpi-figure'
      className={cn('flex flex-col items-start gap-2', className)}
      {...props}
    />
  )
}

// The colour comes from around it; the size stays the same across a row of KPIs.
const kpiValueVariants = cva('leading-none font-semibold tracking-tight tabular-nums', {
  variants: {
    size: {
      sm: 'text-xl',
      default: 'text-3xl',
      lg: 'text-5xl',
    },
  },
  defaultVariants: { size: 'default' },
})

/** The number, rolling each digit that changes to its new one. */
function KpiValue({
  className,
  size,
  ...props
}: Omit<ComponentProps<'span'>, 'children'> & VariantProps<typeof kpiValueVariants>) {
  const { value, locale, format, loading, messages } = useKpi()
  return (
    <SkeletonContent
      loading={loading}
      placeholder={<SkeletonText className={cn(kpiValueVariants({ size }), 'w-32')} />}
      className={cn(kpiValueVariants({ size }), className)}
    >
      {value === null ? (
        <span data-slot='kpi-value' className='text-muted-foreground' {...props}>
          <span aria-hidden>—</span>
          <span className='sr-only'>{messages.noData}</span>
        </span>
      ) : (
        <AnimatedNumber
          data-slot='kpi-value'
          value={value}
          locale={locale}
          format={format}
          {...props}
        />
      )}
    </SkeletonContent>
  )
}

/** The arrow's turn from pointing up and on: no change points on, down points down and on. */
/** Mirrored in right to left, the arrow turns the other way to still point down or on. */
const ARROW_TURN: Record<KpiDirection, string> = {
  up: 'rotate-0',
  flat: 'rotate-45 rtl:-rotate-45',
  down: 'rotate-90 rtl:-rotate-90',
  none: 'rotate-45 rtl:-rotate-45',
}

const BADGE_OF: Record<KpiTone, 'success' | 'warning' | 'destructive' | 'secondary'> = {
  positive: 'success',
  warning: 'warning',
  negative: 'destructive',
  neutral: 'secondary',
}

/**
 * The change since the period before, as a badge: an arrow that turns to
 * the new direction and the size of the change, rolling, in green when it is
 * good news and red when it isn't. Its children say what it compares with,
 * such as "vs October", and read as one sentence with it.
 */
function KpiChange({
  kind = 'percent',
  className,
  children,
  ...props
}: ComponentProps<'div'> & {
  /** How the change is measured: a share, the difference, or percentage points for a rate. */
  kind?: KpiChangeKind
}) {
  const { value, previous, locale, format, better, loading, messages } = useKpi()
  const { size, direction, tone } = kpiChange(
    value,
    previous,
    kind,
    better,
    numberFormatter(locale, amountFormat(format)).resolvedOptions().maximumFractionDigits,
  )
  const magnitude = size === null ? null : Math.abs(size)
  // With no value, or none before to compare with, there is no change to show.
  if ((value === null || previous === null) && !loading) return null
  return (
    <div
      data-slot='kpi-change'
      data-direction={direction}
      data-tone={tone}
      className={cn('flex min-w-0 flex-wrap items-baseline gap-x-1.5 text-sm', className)}
      {...props}
    >
      <SkeletonContent
        loading={loading}
        placeholder={<Skeleton className='h-5 w-14 rounded-(--control-radius-xs)' />}
        className='shrink-0'
      >
        <Badge variant={BADGE_OF[tone]} className='gap-0.5 ps-1'>
          <IconPlaceholder
            lucide='ArrowUpRightIcon'
            tabler='IconArrowUpRight'
            hugeicons='ArrowUpRight01Icon'
            phosphor='ArrowUpRightIcon'
            remixicon='RiArrowRightUpLine'
            aria-hidden
            className={cn(
              // Up and on is up and to the reading end, so right to left mirrors it.
              'transition-[rotate] duration-(--motion-morph-duration) ease-(--motion-morph-easing) motion-reduce:transition-none rtl:-scale-x-100',
              ARROW_TURN[direction],
            )}
          />
          {/* With nothing before, the badge's own word says it: "New". */}
          {direction !== 'none' && (
            <span className='sr-only'>{messages[direction]} </span>
          )}
          {/* From a number to "New" and back, the words crossfade and the badge's width glides. */}
          <ChangeMagnitudeContext value={{ magnitude, kind }}>
            <Swap>
              {magnitude === null ? (
                <span key='none'>{messages.none}</span>
              ) : (
                <ChangeMagnitude key='amount' />
              )}
            </Swap>
          </ChangeMagnitudeContext>
        </Badge>
      </SkeletonContent>
      {children ? (
        <span className='text-muted-foreground min-w-0'> {children}</span>
      ) : null}
    </div>
  )
}

const ChangeMagnitudeContext = createContext<{
  magnitude: number | null
  kind: KpiChangeKind
}>({ magnitude: null, kind: 'percent' })

/**
 * The change's size. It takes no props, so the Swap around it sees the same
 * content as the number changes, and the number rolls instead.
 */
function ChangeMagnitude() {
  const { magnitude, kind } = use(ChangeMagnitudeContext)
  const { locale, format } = useKpi()
  if (magnitude === null) return null
  if (kind === 'points') return <PointsNumber size={magnitude} />
  return (
    <AnimatedNumber
      value={magnitude}
      locale={locale}
      format={kind === 'amount' ? amountFormat(format) : shareFormat(magnitude)}
    />
  )
}

/**
 * How a change in points is written: to a tenth, as a rate's 2.6 pts, and to
 * a hundredth below a tenth, where an uptime's 0.03 pts still matters.
 */
function pointsFormat(size: number): Intl.NumberFormatOptions {
  const decimals = Math.abs(size) < 0.1 && size !== 0 ? 2 : CHANGE_DECIMALS
  return { minimumFractionDigits: decimals, maximumFractionDigits: decimals }
}

/** A change in percentage points: the number rolls, the word after it stays. */
function PointsNumber({ size }: { size: number }) {
  const { locale, messages } = useKpi()
  const [before, after] = messages.points('\u0000').split('\u0000')
  return (
    <span>
      {before}
      <AnimatedNumber value={size} locale={locale} format={pointsFormat(size)} />
      {after}
    </span>
  )
}

/**
 * A line of small print at the foot, such as when the number was last
 * updated: at the card's bottom, so the footnotes of a row of KPIs line up.
 */
function KpiFooter({ className, ...props }: ComponentProps<'p'>) {
  return (
    <p
      data-slot='kpi-footer'
      className={cn(
        'text-muted-foreground mt-auto px-(--surface-padding) text-xs',
        className,
      )}
      {...props}
    />
  )
}

/** A live number's sign that it is live: a dot that breathes beside "Live". */
function KpiLive({ className, children, ...props }: ComponentProps<'span'>) {
  const { messages } = useKpi()
  return (
    <span
      data-slot='kpi-live'
      className={cn(
        'text-success-foreground inline-flex items-center gap-1.5 text-xs font-medium',
        className,
      )}
      {...props}
    >
      <span aria-hidden className='relative flex size-2'>
        <span className='bg-success absolute inset-0 animate-[ping_calc(var(--motion-layout-duration)*6)_ease-in-out_infinite] rounded-full opacity-60 motion-reduce:animate-none' />
        <span className='bg-success relative size-2 rounded-full forced-colors:bg-[CanvasText]' />
      </span>
      {children ?? messages.live}
    </span>
  )
}

type KpiTrendProps = Omit<
  SparklineProps,
  | 'label'
  | 'locale'
  | 'format'
  | 'loading'
  | 'config'
  | 'dashed'
  | 'forecastFrom'
  | 'ordered'
> & {
  /** Names the trend, such as "Revenue each day in November". */
  label: string
  /** The key of each row's value in the period before, drawn dashed behind it, to compare with. */
  compareKey?: string
  /** The key of each row's value. */
  dataKey: string
  /** The value's name in the tooltip. */
  dataLabel?: string
  /** The period before's name in the tooltip. */
  compareLabel?: string
  /**
   * Marks the last value as still coming in, such as the minute now running:
   * dashed, and "so far" in the tooltip. The trend is a line then, since an
   * area can't dash its last stretch.
   */
  partial?: boolean
}

/**
 * The value over its period, as a sparkline under the number, with the
 * period before dashed behind it to compare with. The day under the pointer
 * or the keys reads in a tooltip, never in place of the value. A new period
 * moves every point from where it was.
 */
function KpiTrend({
  dataKey,
  dataLabel,
  compareKey,
  compareLabel,
  partial = false,
  variant = partial ? 'line' : 'area',
  endDot = true,
  className,
  children,
  messages,
  ...props
}: KpiTrendProps) {
  const kpi = useKpi()
  const last = props.data.at(-1)
  return (
    <Sparkline
      data-slot='kpi-trend'
      variant={variant}
      endDot={endDot}
      locale={kpi.locale}
      format={kpi.format}
      loading={kpi.loading}
      config={{
        ...(compareKey
          ? {
              [compareKey]: {
                label: compareLabel ?? compareKey,
                color: 'var(--muted-foreground)',
              },
            }
          : {}),
        [dataKey]: { label: dataLabel ?? dataKey },
      }}
      dashed={compareKey ? [compareKey] : []}
      forecastFrom={partial && last ? String(last[props.index]) : undefined}
      messages={{ forecast: kpi.messages.soFar, ...messages }}
      ordered
      fit
      className={cn('h-16', className)}
      {...props}
    >
      {/* Under the plot, so it never covers the number it explains. */}
      {children ?? <ChartTooltip side='bottom' />}
    </Sparkline>
  )
}

/** The status of a value against its target, and what it says. */
function targetStatus(
  value: number,
  target: number,
  kind: 'goal' | 'limit',
  pace: number | undefined,
): {
  status: 'achieved' | 'onTrack' | 'behind' | 'left' | 'overPace' | 'over' | 'toGo'
  tone: KpiTone
} {
  // Where it ends at the pace it has kept so far.
  const projected = pace && pace > 0 ? value / pace : null
  if (kind === 'goal') {
    if (value >= target) return { status: 'achieved', tone: 'positive' }
    if (projected === null) return { status: 'toGo', tone: 'neutral' }
    return projected >= target
      ? { status: 'onTrack', tone: 'positive' }
      : { status: 'behind', tone: 'warning' }
  }
  if (value > target) return { status: 'over', tone: 'negative' }
  if (projected !== null && projected > target)
    return { status: 'overPace', tone: 'warning' }
  return { status: 'left', tone: 'positive' }
}

const TONE_TEXT: Record<KpiTone, string> = {
  positive: 'text-success-foreground',
  warning: 'text-warning-foreground',
  negative: 'text-destructive',
  neutral: 'text-muted-foreground',
}

/** A tone's fill stepped back toward the track's colour, for the bands the value isn't in. */
const TONE_FILL_DIM: Record<KpiTone, string> = {
  positive: 'bg-[color-mix(in_oklch,var(--success)_30%,var(--muted))]',
  warning: 'bg-[color-mix(in_oklch,var(--warning)_30%,var(--muted))]',
  negative: 'bg-[color-mix(in_oklch,var(--destructive)_30%,var(--muted))]',
  neutral: 'bg-muted',
}

const TONE_FILL: Record<KpiTone, string> = {
  positive: 'bg-success',
  warning: 'bg-warning',
  negative: 'bg-destructive',
  neutral: 'bg-muted-foreground/50',
}

/**
 * Progress to a target, as a bullet graph: a bar filled to the value, a
 * notch at the target, and a pale fill to where an even pace puts the value
 * now, which shows past the value's fill when it is behind, so "behind"
 * reads before the numbers do. A goal is good to
 * pass, such as a quota; a limit is not, such as a budget, whose fill turns
 * red past it. Past the target the scale grows, so the notch glides back to
 * make room. It is a meter, named by the KPI's label, that says its share,
 * its status and what is left.
 */
function KpiTarget({
  target,
  kind = 'goal',
  pace,
  className,
  ...props
}: Omit<ComponentProps<'div'>, 'children'> & {
  /** The goal to reach, or the limit to stay under. */
  target: number
  /** Whether passing the target is good news (a goal) or bad news (a limit). */
  kind?: 'goal' | 'limit'
  /** How much of the period has gone, from 0 to 1: where an even pace puts the value now. */
  pace?: number
}) {
  const { value, locale, format, loading, labelId, messages } = useKpi()
  const now = value ?? 0
  const max = Math.max(target, now)
  const filled = valuePercent(now, 0, max)
  const notch = valuePercent(target, 0, max)
  // With no value there is no status to give: the bar stays empty and says so.
  const empty = value === null
  const { status, tone } = empty
    ? ({ status: 'noData', tone: 'neutral' } as const)
    : targetStatus(now, target, kind, pace)
  // A period that has ended has no pace left to keep.
  const showsPace = !loading && !empty && pace !== undefined && pace < 1
  const pacePercent = valuePercent(target * Math.min(1, pace ?? 0), 0, max)
  const write = numberFormatter(locale, format)
  const share = target > 0 ? now / target : 0
  const shareText = numberFormatter(locale, shareFormat(share)).format(share)
  const left = write.format(Math.abs(target - now))
  const statusText =
    status === 'noData'
      ? messages.noData
      : status === 'achieved'
        ? messages.achieved
        : status === 'onTrack'
          ? messages.onTrack
          : status === 'behind'
            ? messages.behind
            : status === 'toGo'
              ? messages.toGo(left)
              : status === 'over'
                ? messages.over(left)
                : status === 'overPace'
                  ? messages.overPace
                  : messages.left(left)
  const ofText = messages.ofTarget(shareText, write.format(target))
  return (
    <div
      data-slot='kpi-target'
      data-kind={kind}
      data-status={status}
      className={cn('flex flex-col gap-2', trackDirClassName, className)}
      {...props}
    >
      <MeterPrimitive.Root
        value={now}
        min={0}
        max={max}
        aria-labelledby={labelId}
        getAriaValueText={() => (empty ? statusText : `${ofText}, ${statusText}`)}
        // Room above and below the bar for the target's notch.
        className='relative py-1'
      >
        <MeterPrimitive.Track
          className={cn(
            trackClassName,
            'overflow-hidden',
            loading && placeholderFillClassName,
          )}
        >
          {showsPace && (
            // The stretch an even pace has reached and the value hasn't: a
            // pale fill, which the value's own fill covers when it is ahead.
            <span
              aria-hidden
              style={slidingFillStyle(pacePercent)}
              className={cn(
                slidingFillClassName,
                'bg-foreground/15 forced-colors:bg-[GrayText]!',
              )}
            />
          )}
          {!loading && !empty && (
            <span
              aria-hidden
              data-slot='kpi-target-fill'
              style={slidingFillStyle(filled)}
              className={cn(
                slidingFillClassName,
                tone === 'neutral' ? 'bg-primary' : TONE_FILL[tone],
              )}
            />
          )}
          {showsPace && (
            // Where an even pace puts the value now: a gap cut through the
            // bar, so it shows on the fill as well as past it.
            <span
              aria-hidden
              data-slot='kpi-target-pace'
              style={slidingFillStyle(pacePercent)}
              className={slidingMarkClassName}
            >
              <span className='bg-card -me-px h-full w-0.5 forced-colors:bg-[Canvas]' />
            </span>
          )}
        </MeterPrimitive.Track>
        {!loading && (
          <>
            {/* The target: a notch cut through the bar, standing past it above and below. */}
            <span
              aria-hidden
              style={slidingFillStyle(notch)}
              className={slidingMarkClassName}
            >
              {/* Ringed in the card's colour, so it cuts through a fill that has passed it. */}
              <span className='bg-foreground ring-card -me-px h-full w-0.5 rounded-full ring-2 forced-colors:bg-[CanvasText]' />
            </span>
          </>
        )}
      </MeterPrimitive.Root>
      <div className='flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-0.5 text-xs'>
        {loading ? (
          <SkeletonText className='w-28' />
        ) : empty ? null : (
          <span className='text-muted-foreground tabular-nums'>{ofText}</span>
        )}
        {loading ? null : (
          <span
            data-slot='kpi-target-status'
            className={cn(
              'flex font-medium tabular-nums transition-colors duration-(--motion-layout-duration) ease-(--motion-layout-fade-easing)',
              TONE_TEXT[tone],
            )}
          >
            <SwapText text={statusText} />
          </span>
        )}
      </div>
    </div>
  )
}

interface KpiBand {
  /** Where the band ends; the last band runs to the scale's end and needs none. */
  to?: number
  label: string
  tone: KpiTone
}

/** Each band's start and end, from `min` to `max`, and the one `value` sits in. */
function bandsOf(
  bands: readonly KpiBand[],
  min: number,
  max: number,
  value: number | null,
) {
  let start = min
  const laid = bands.map((band, index) => {
    const end = index === bands.length - 1 ? max : Math.min(max, band.to ?? max)
    const span = { ...band, start, end }
    start = end
    return span
  })
  const at =
    value === null
      ? -1
      : laid.findIndex((band, index) => value < band.end || index === laid.length - 1)
  return { laid, at }
}

/**
 * A score on its scale of bands, such as a page's load time: Good, Needs
 * improvement, Poor. The bar is split into its bands, in their colours, the
 * one the value is in at full strength; a marker sits at the value and
 * glides to a new one, and the band's name under the bar says which it is
 * in, in words as well as in colour, swapping as the marker crosses into
 * another. It is a meter that says the value and its band.
 */
function KpiScore({
  bands,
  min = 0,
  max,
  className,
  ...props
}: Omit<ComponentProps<'div'>, 'children'> & {
  /** The bands from the scale's start, each ending where the next begins. */
  bands: readonly KpiBand[]
  min?: number
  max: number
}) {
  const { value, locale, format, loading, labelId, messages } = useKpi()
  const { laid, at } = bandsOf(bands, min, max, value)
  const write = numberFormatter(locale, format)
  const current = laid[at]
  return (
    <div
      data-slot='kpi-score'
      className={cn('flex flex-col gap-2', trackDirClassName, className)}
      {...props}
    >
      {/* The band it is in, in words: they change as the marker crosses into another. */}
      <div aria-hidden className='flex text-xs'>
        {loading ? (
          <SkeletonText className='w-16' />
        ) : current ? (
          <span
            data-slot='kpi-score-band'
            className={cn(
              'flex font-medium transition-colors duration-(--motion-layout-duration) ease-(--motion-layout-fade-easing)',
              TONE_TEXT[current.tone],
            )}
          >
            <SwapText text={current.label} />
          </span>
        ) : null}
      </div>
      <MeterPrimitive.Root
        value={Math.min(max, Math.max(min, value ?? min))}
        min={min}
        max={max}
        aria-labelledby={labelId}
        getAriaValueText={() =>
          value === null || !current
            ? messages.noData
            : `${write.format(value)}, ${current.label}`
        }
        className='relative py-1'
      >
        <MeterPrimitive.Track
          className={cn(
            trackClassName,
            'flex gap-0.5 bg-transparent forced-colors:outline-0',
          )}
        >
          {laid.map((band, index) => (
            <span
              key={band.label}
              aria-hidden
              style={{ flexGrow: band.end - band.start }}
              className={cn(
                'h-full basis-0 transition-colors duration-(--motion-layout-duration) ease-(--motion-layout-fade-easing) first:rounded-s-full last:rounded-e-full forced-colors:bg-[GrayText]!',
                loading
                  ? placeholderFillClassName
                  : index === at
                    ? TONE_FILL[band.tone]
                    : TONE_FILL_DIM[band.tone],
                index === at && 'forced-colors:bg-[Highlight]!',
              )}
            />
          ))}
        </MeterPrimitive.Track>
        {!loading && value !== null && (
          <span
            aria-hidden
            data-slot='kpi-score-marker'
            style={slidingFillStyle(valuePercent(value, min, max))}
            className={cn(slidingMarkClassName, 'items-center')}
          >
            {/* The marker: a ring in the card's colour around the value's place. */}
            <span className='bg-foreground ring-card -me-1.5 size-3 rounded-full ring-2 forced-colors:bg-[CanvasText]' />
          </span>
        )}
      </MeterPrimitive.Root>
      {/* Where each band ends, under the joins, so how close the value is to the next reads. */}
      <div
        aria-hidden
        className='text-muted-foreground relative h-4 text-xs tabular-nums'
      >
        {laid.slice(0, -1).map((band) => (
          <span
            key={band.label}
            style={{ insetInlineStart: `${valuePercent(band.end, min, max)}%` }}
            className='absolute top-0 -translate-x-1/2 whitespace-nowrap rtl:translate-x-1/2'
          >
            {loading ? null : write.format(band.end)}
          </span>
        ))}
      </div>
    </div>
  )
}

interface KpiPart {
  key: string
  label: string
  value: number
  /** Its colour, from the status colours; the charts' colours in turn by default. */
  tone?: KpiTone
}

/** Where each part ends along the bar, as a percentage of the whole, from the start. */
function partEnds(parts: readonly KpiPart[]): number[] {
  const total = parts.reduce((sum, part) => sum + Math.max(0, part.value), 0)
  let reached = 0
  return parts.map((part) => {
    reached += Math.max(0, part.value)
    return total > 0 ? (reached / total) * 100 : 0
  })
}

/**
 * Each value's share of their total, rounded to `decimals` of a percent so
 * that they still add up to the whole: the shares that lost most to rounding
 * get the units left over, as a legend's 87%, 8% and 5% must make 100%.
 */
function sharesOf(values: readonly number[], decimals: number): number[] {
  const kept = values.map((value) => Math.max(0, value))
  const total = kept.reduce((sum, value) => sum + value, 0)
  if (total === 0) return kept.map(() => 0)
  // The units a share is counted in: a percent, or a tenth of one with a decimal.
  const units = 100 * 10 ** decimals
  const exact = kept.map((value) => (value / total) * units)
  const floors = exact.map(Math.floor)
  let left = units - floors.reduce((sum, value) => sum + value, 0)
  const order = exact
    .map((value, index) => ({ index, lost: value - Math.floor(value) }))
    .toSorted((a, b) => b.lost - a.lost)
  for (const { index } of order) {
    if (left <= 0) break
    floors[index] = (floors[index] ?? 0) + 1
    left -= 1
  }
  return floors.map((value) => value / units)
}

/** The charts' colours, in turn, for parts with no tone. */
const CHART_FILL = ['bg-chart-1', 'bg-chart-2', 'bg-chart-3', 'bg-chart-4', 'bg-chart-5']

function partColor(part: KpiPart, index: number) {
  return part.tone ? TONE_FILL[part.tone] : CHART_FILL[index % CHART_FILL.length]
}

/**
 * A whole and its parts, such as the tickets that met their deadline and the
 * ones that missed it: one bar split into the parts, and a legend with each
 * part's count and share. Each part is a fill from the bar's start to its
 * end, laid over the ones after it, so a new count slides every end along
 * on the compositor and the parts make room for each other.
 */
function KpiBreakdown({
  parts,
  partFormat,
  className,
  ...props
}: Omit<ComponentProps<'div'>, 'children'> & {
  parts: readonly KpiPart[]
  /** How each part's own count is written, such as a currency for revenue by plan. */
  partFormat?: Intl.NumberFormatOptions
}) {
  const { locale, format, loading } = useKpi()
  const ends = partEnds(parts)
  // Shares written as the value is when it is a share too, so a 93.8% value reads 93.8% beside its part.
  const shareOf: Intl.NumberFormatOptions =
    format?.style === 'percent' ? format : { style: 'percent', maximumFractionDigits: 0 }
  const shares = sharesOf(
    parts.map((part) => part.value),
    numberFormatter(locale, shareOf).resolvedOptions().maximumFractionDigits ?? 0,
  )
  return (
    <div
      data-slot='kpi-breakdown'
      className={cn('flex flex-col gap-3', trackDirClassName, className)}
      {...props}
    >
      <div
        aria-hidden
        className={cn(
          trackClassName,
          'isolate overflow-hidden',
          loading && placeholderFillClassName,
        )}
      >
        {!loading &&
          parts.map((part, index) => (
            <span
              key={part.key}
              style={{
                ...slidingFillStyle(ends[index] ?? 0),
                zIndex: parts.length - index,
              }}
              className={cn(
                slidingFillClassName,
                // The gap before the next part, in the card's colour.
                'border-card rounded-none border-e-2 last:border-e-0 forced-colors:border-[Canvas]',
                partColor(part, index),
              )}
            />
          ))}
      </div>
      <ul className='text-muted-foreground flex flex-col gap-1 text-xs'>
        {parts.map((part, index) => (
          <li key={part.key} className='flex min-w-0 items-center gap-2'>
            <span
              aria-hidden
              className={cn(
                swatchClassName,
                'forced-colors:bg-[CanvasText]!',
                partColor(part, index),
              )}
            />
            <span className='min-w-0 flex-1 wrap-break-word'>{part.label}</span>
            {loading ? (
              <SkeletonText className='w-16' />
            ) : (
              <>
                <AnimatedNumber
                  value={part.value}
                  locale={locale}
                  format={partFormat}
                  className='text-muted-foreground'
                />
                <AnimatedNumber
                  value={shares[index] ?? 0}
                  locale={locale}
                  format={shareOf}
                  className='text-foreground min-w-10 text-end font-medium'
                />
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

/** A day's state in a strip of days. */
type KpiDayState = 'up' | 'degraded' | 'down' | 'none'

interface KpiHistoryMessages {
  /** Heads the data table's column of states. */
  state: string
  up: string
  degraded: string
  down: string
  none: string
}

const kpiHistoryMessages: KpiHistoryMessages = {
  state: 'Status',
  up: 'Operational',
  degraded: 'Degraded',
  down: 'Outage',
  none: 'No data',
}

/** The colour of each day's state. */
const DAY_COLOR: Record<KpiDayState, string> = {
  up: 'var(--success)',
  degraded: 'var(--warning)',
  down: 'var(--destructive)',
  none: 'var(--muted)',
}

/** The strip's rows: every day a full bar, coloured by its state. */
function historyRows(
  days: readonly { date: string; state: KpiDayState }[],
): ChartDatum[] {
  return days.map(({ date, state }) => ({ date, day: 1, state }))
}

/**
 * The state of each day in a period, as a strip of bars, a bar a day, such
 * as a service's uptime: green when all was well, amber when it was slow,
 * red when it was down. It is the Bar chart, so the day under the pointer
 * stays bright while the rest step back and its state reads in a tooltip,
 * and the strip is a slider the keys step through, day by day, each day
 * read as its state.
 */
function KpiHistory({
  days,
  messages,
  categoryFormat = String,
  className,
  ...props
}: Omit<
  BarChartProps,
  | 'data'
  | 'index'
  | 'config'
  | 'stack'
  | 'domain'
  | 'locale'
  | 'loading'
  | 'describe'
  | 'children'
> & {
  days: readonly { date: string; state: KpiDayState }[]
  messages?: Partial<KpiHistoryMessages>
}) {
  const { locale, loading } = useKpi()
  const words = { ...kpiHistoryMessages, ...messages }
  const stateText = (datum: ChartDatum) => words[(datum.state as KpiDayState) ?? 'none']
  const rows = useMemo(() => historyRows(days), [days])
  if (loading) {
    // A strip of days has no shape to hint at, so it waits as one flat bar.
    return <Skeleton data-slot='kpi-history' className={cn('h-9 w-full', className)} />
  }
  return (
    <BarChart
      data-slot='kpi-history'
      ordered
      categoryGap={0.3}
      categoryFormat={categoryFormat}
      {...props}
      data={rows}
      index='date'
      locale={locale}
      domain={[0, 1]}
      describe={{ name: words.state, text: stateText }}
      config={{ day: { label: words.state, color: DAY_COLOR.up } }}
      className={cn('h-9 grid-cols-[0_minmax(0,1fr)_0] py-0', className)}
    >
      <Bar
        dataKey='day'
        color={(datum) => DAY_COLOR[(datum.state as KpiDayState) ?? 'none']}
      />
      <ChartTooltip side='bottom'>
        {({ category }) => (
          <div className='grid gap-0.5'>
            <div className='font-medium'>{categoryFormat(category.value)}</div>
            <div className='text-background/75 forced-colors:text-[CanvasText]'>
              {stateText(category.datum)}
            </div>
          </div>
        )}
      </ChartTooltip>
    </BarChart>
  )
}

export {
  bandsOf,
  Kpi,
  KpiAction,
  type KpiBand,
  type KpiBetter,
  KpiBreakdown,
  KpiChange,
  type KpiChangeKind,
  kpiChange,
  KpiContent,
  type KpiDayState,
  KpiFigure,
  KpiFooter,
  KpiHeader,
  KpiHistory,
  KpiLabel,
  KpiLive,
  type KpiPart,
  KpiScore,
  KpiTarget,
  type KpiTone,
  KpiTrend,
  KpiValue,
  partEnds,
  sharesOf,
  targetStatus,
}
