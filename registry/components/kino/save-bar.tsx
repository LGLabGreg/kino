'use client'

import { Button, buttonIconSwap } from '@/registry/components/kino/button'
import { Spinner, useSpinner } from '@/registry/components/kino/spinner'
import { useSaveBar } from '@/registry/lib/form-changes'
import { ariaShortcut, useApplePlatform } from '@/registry/lib/keys'
import { mergeRefs } from '@/registry/lib/refs'
import { Swap, SwapText } from '@/registry/lib/swap'
import { useDirection } from '@base-ui/react/direction-provider'
import {
  type ComponentProps,
  createContext,
  type ReactNode,
  use,
  useId,
  useMemo,
  useRef,
} from 'react'
import { createPortal } from 'react-dom'

import { cn } from '@/lib/utils'

/** Where the Save bars inside it render, in place of the page's end. */
const SaveBarContainerContext = createContext<HTMLElement | null>(null)

/**
 * Renders the Save bars inside it into `container`, an element of your own,
 * rather than at the end of the page: for a bar rendered by a part, such as
 * the Settings page's, whose own `container` you don't pass.
 */
function SaveBarContainer({
  container,
  children,
}: {
  container: HTMLElement | null
  children: ReactNode
}) {
  return <SaveBarContainerContext value={container}>{children}</SaveBarContainerContext>
}

/*
 * A bar that floats up from the bottom of the screen, centred on its form,
 * while the form has changes it hasn't saved. It goes in a Kino Form, after
 * the fields, and renders at the end of the page, so no layer around the
 * form can cover it; inside a dialog it stays in the dialog. Tab still
 * reaches it after the form's last field, a screen reader reads it there,
 * and Save submits the form. It keeps one width whatever it says, so its
 * edges and buttons never move: the message keeps room for its longest
 * text, and the spinner shows beside the message rather than in Save.
 */
function SaveBar({
  className,
  onDiscard,
  container: containerProp,
  ref,
  ...props
}: Omit<ComponentProps<'div'>, 'children'> & {
  /** Runs after Discard has put every Field back, for state the form doesn't hold. */
  onDiscard?: () => void
  /** An element of your own to render into, in place of the end of the page. */
  container?: HTMLElement | null
}) {
  const frame = useRef<HTMLDivElement>(null)
  const contextContainer = use(SaveBarContainerContext)
  const { barRef, open, view, text, texts, saving, locked, discard, region, placement } =
    useSaveBar({
      frame,
      onDiscard,
      container: containerProp ?? contextContainer,
    })
  const { here, into, away, anchorRef, guardRef, onGuardFocus, onButtonKeyDown, formId } =
    placement
  const refs = useMemo(() => mergeRefs(ref, barRef), [ref, barRef])
  const apple = useApplePlatform()
  const spinning = useSpinner(saving)
  const direction = useDirection()
  const barId = useId()

  const bar = (
    <div
      ref={frame}
      dir={direction}
      data-slot='save-bar-frame'
      // Across the form's width, so the bar sits centred under it however the page lays it out; above another bar open before it.
      className='@container pointer-events-none fixed bottom-0 left-(--save-bar-left,0px) z-40 flex w-(--save-bar-width,100%) -translate-y-(--save-bar-stack,0px) justify-center px-4 transition-[translate] duration-(--motion-layout-duration) ease-(--motion-layout-easing) motion-reduce:transition-none'
    >
      <div
        ref={refs}
        id={barId}
        role='region'
        data-slot='save-bar'
        data-open={open ? '' : undefined}
        data-view={view}
        aria-busy={saving || undefined}
        className={cn(
          // The message starts as far in as Save's label ends: the gap, the buttons' padding and their 1px border.
          'group/save-bar pointer-events-auto mb-(--save-bar-inset,1rem) flex @max-sm:flex-wrap max-w-full min-w-0 items-center gap-(--save-bar-gap) [--save-bar-gap:calc(var(--surface-padding)/2)] p-(--save-bar-gap) ps-[calc(var(--save-bar-gap)+var(--control-padding)+1px)]',
          // The bar's corner is its buttons' corner and the padding round them, so the curves run alike.
          'bg-popover text-popover-foreground ring-foreground/10 rounded-[calc(var(--control-radius-sm)+var(--save-bar-gap))] shadow-lg ring-1 forced-colors:outline',
          // Rises from under the screen's edge as it arrives, and drops back as it goes; hidden once gone.
          // Under reduced motion it only fades, from where it rests.
          '[transition:translate_var(--motion-enter-duration)_var(--motion-enter-easing),opacity_var(--motion-enter-duration)_var(--motion-enter-easing),scale_var(--motion-press-duration)_var(--motion-press-easing),box-shadow_var(--motion-press-duration)_var(--motion-press-fade-easing)] not-data-open:invisible not-data-open:translate-y-[calc(100%+var(--save-bar-inset,1rem))] not-data-open:opacity-0 not-data-open:[transition:translate_var(--motion-exit-duration)_var(--motion-exit-easing),opacity_var(--motion-exit-duration)_var(--motion-exit-easing),visibility_0s_var(--motion-exit-easing)_var(--motion-exit-duration)] motion-reduce:not-data-open:translate-y-0 motion-reduce:[transition-property:opacity] motion-reduce:not-data-open:[transition-property:opacity,visibility]',
          // Leaving with changes unsaved, it swells as the Alert dialog does, and its ring turns to the warning colour.
          'data-refused:scale-[calc(1+(1-var(--motion-press-scale))*0.6)] data-refused:duration-[calc(var(--motion-press-duration)*0.4)] motion-reduce:data-refused:scale-100',
          'data-[view=blocked]:ring-destructive/60 data-[view=failed]:ring-destructive/60 forced-colors:data-[view=blocked]:outline-2 forced-colors:data-[view=blocked]:outline-dashed',
          className,
        )}
        {...props}
      >
        {/* Every text sits in one cell, hidden but the one it says, so the cell is as wide as the longest. */}
        <span
          className={cn(
            // In a narrow form, the message takes a line of its own over the buttons.
            'grid min-w-0 text-sm font-medium @max-sm:basis-full',
            (view === 'blocked' || view === 'failed') && 'text-destructive',
          )}
        >
          {Object.entries(texts).map(([key, room]) => (
            <span
              key={key}
              aria-hidden
              className='invisible flex min-w-0 items-center gap-1.5 [grid-area:1/1]'
            >
              {key === 'saving' ? <span className='size-4 shrink-0' /> : null}
              <span className='truncate'>{room}</span>
            </span>
          ))}
          <span className='flex min-w-0 items-center [grid-area:1/1]'>
            <Swap align='start' roll className={buttonIconSwap}>
              {spinning ? (
                <span className='flex pe-1.5'>
                  <Spinner aria-hidden />
                </span>
              ) : null}
            </Swap>
            <SwapText text={text} className='min-w-0' />
          </span>
        </span>
        <div className='ms-auto flex shrink-0 items-center gap-(--save-bar-gap)'>
          <Button
            type='button'
            variant='ghost'
            size='sm'
            disabled={locked}
            focusableWhenDisabled
            onClick={discard}
            tabIndex={away ? -1 : undefined}
            onKeyDown={onButtonKeyDown('first')}
          >
            Discard
          </Button>
          <Button
            type='submit'
            // Away from its form, it still submits it.
            form={formId}
            size='sm'
            disabled={locked}
            focusableWhenDisabled
            aria-keyshortcuts={ariaShortcut(['Mod', 'S'], apple)}
            tabIndex={away ? -1 : undefined}
            onKeyDown={onButtonKeyDown('last')}
          >
            Save
          </Button>
        </div>
      </div>
    </div>
  )

  return (
    <>
      {region}
      <span ref={anchorRef} hidden />
      {away ? (
        <>
          {/* While it shows, Tab from the form's last field goes on into it. It has no name: it hands focus on the moment it has it. */}
          {open ? (
            <span
              ref={guardRef}
              // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a focus guard: it hands focus on into the bar the moment it has it, as Base UI's portals' guards do.
              tabIndex={0}
              data-slot='save-bar-guard'
              onFocus={onGuardFocus}
              className='sr-only'
            />
          ) : null}
          {/* A screen reader reads it here, after the form's fields. */}
          <span aria-owns={barId} />
          {into ? createPortal(bar, into) : null}
        </>
      ) : here ? (
        bar
      ) : null}
    </>
  )
}

export { SaveBar, SaveBarContainer }
