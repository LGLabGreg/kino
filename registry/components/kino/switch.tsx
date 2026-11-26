'use client'

import { choiceClassName, choicePressHandlers } from '@/registry/lib/choice'
import {
  Switch as SwitchPrimitive,
  SwitchThumb as SwitchThumbPrimitive,
} from '@ui-sdk/react/switch'
import { cva, type VariantProps } from 'class-variance-authority'
import type { ComponentProps } from 'react'

import { cn } from '@/lib/utils'

const switchVariants = cva(
  [
    choiceClassName,
    'group/switch p-0.5',
    '[--switch-thumb:calc(var(--switch-height)-4px)] [--switch-travel:calc(var(--switch-width)-var(--switch-height))] [--switch-stretch:calc(var(--switch-thumb)*0.3)] [--switch-radius:min(var(--control-radius-xs),calc(var(--switch-height)/2))]',
    'h-(--switch-height) w-(--switch-width) rounded-(--switch-radius)',
    'bg-muted-foreground/80 dark:bg-muted-foreground/60 data-checked:bg-primary dark:data-checked:bg-primary',
    'transition-[background-color,box-shadow] duration-(--motion-press-duration) ease-(--motion-press-fade-easing)',
    'not-data-checked:not-data-disabled:not-data-readonly:hover:bg-muted-foreground dark:not-data-checked:not-data-disabled:not-data-readonly:hover:bg-muted-foreground/75',
    'forced-colors:border forced-colors:border-[CanvasText] forced-colors:data-checked:bg-[Highlight]! forced-colors:[--switch-travel:calc(var(--switch-width)-var(--switch-height)-2px)]',
  ],
  {
    variants: {
      size: {
        default: '[--switch-height:1.25rem] [--switch-width:2.25rem]',
        sm: '[--switch-height:1rem] [--switch-width:1.75rem]',
      },
    },
    defaultVariants: { size: 'default' },
  },
)

function Switch({
  className,
  size = 'default',
  onKeyDown,
  onKeyUp,
  onBlur,
  ...props
}: Omit<ComponentProps<typeof SwitchPrimitive>, 'className' | 'children'> &
  VariantProps<typeof switchVariants> & {
    className?: string
  }) {
  return (
    <SwitchPrimitive
      data-size={size}
      className={cn(switchVariants({ size }), className)}
      {...choicePressHandlers({ onKeyDown, onKeyUp, onBlur })}
      {...props}
    >
      {/*
       * The thumb is as wide as it gets when stretched, and a clip shows one
       * round thumb of it, on the side it sits on. A press opens the clip
       * toward the other side. The drop shadow is on the outer element, so it
       * follows what the clip leaves.
       */}
      <SwitchThumbPrimitive
        className={cn(
          'pointer-events-none flex h-(--switch-thumb) w-[calc(var(--switch-thumb)+var(--switch-stretch))] drop-shadow-sm',
          'transition-[translate] duration-(--motion-layout-duration) ease-(--motion-layout-easing) motion-reduce:transition-none',
          'data-checked:translate-x-[calc(var(--switch-travel)-var(--switch-stretch))] rtl:data-checked:-translate-x-[calc(var(--switch-travel)-var(--switch-stretch))]',
        )}
      >
        <span
          aria-hidden
          className={cn(
            'bg-background dark:bg-foreground dark:group-data-checked/switch:bg-primary-foreground size-full rounded-[max(0px,calc(var(--switch-radius)-2px))] forced-colors:bg-[CanvasText]! forced-colors:group-data-checked/switch:bg-[HighlightText]!',
            '[--switch-clip-round:round_max(0px,calc(var(--switch-radius)-2px))]',
            '[transition:clip-path_var(--motion-layout-duration)_var(--motion-layout-easing),background-color_var(--motion-press-duration)_var(--motion-press-fade-easing)] motion-reduce:[transition:background-color_var(--motion-press-duration)_var(--motion-press-fade-easing)]',
            '[clip-path:inset(0_var(--switch-stretch)_0_0_var(--switch-clip-round))] rtl:[clip-path:inset(0_0_0_var(--switch-stretch)_var(--switch-clip-round))]',
            'group-data-checked/switch:[clip-path:inset(0_0_0_var(--switch-stretch)_var(--switch-clip-round))]! rtl:group-data-checked/switch:[clip-path:inset(0_var(--switch-stretch)_0_0_var(--switch-clip-round))]!',
            // Pressed: on the switch, on the label around it, on its Field's label, or Space held down.
            '[[data-slot=switch]:active:not([data-disabled],[data-readonly])_&]:[clip-path:inset(0_0_0_0_var(--switch-clip-round))]! [label:active:not(:has([data-disabled],[data-readonly]))_&]:[clip-path:inset(0_0_0_0_var(--switch-clip-round))]! [[data-slot=switch][data-pressing]:not([data-disabled],[data-readonly])_&]:[clip-path:inset(0_0_0_0_var(--switch-clip-round))]! [[data-slot=field]:has(>[data-slot=field-label]:active):not(:has([data-disabled],[data-readonly]))_&]:[clip-path:inset(0_0_0_0_var(--switch-clip-round))]!',
            '[[data-slot=switch]:active_&]:duration-(--motion-press-duration) [[data-slot=switch]:active_&]:ease-(--motion-press-easing) [label:active_&]:duration-(--motion-press-duration) [label:active_&]:ease-(--motion-press-easing) [[data-slot=switch][data-pressing]_&]:duration-(--motion-press-duration) [[data-slot=switch][data-pressing]_&]:ease-(--motion-press-easing) [[data-slot=field]:has(>[data-slot=field-label]:active)_&]:duration-(--motion-press-duration) [[data-slot=field]:has(>[data-slot=field-label]:active)_&]:ease-(--motion-press-easing)',
          )}
        />
      </SwitchThumbPrimitive>
    </SwitchPrimitive>
  )
}

export { Switch, switchVariants }
