'use client'

import { Button } from '@/registry/components/kino/button'
import { IconPlaceholder } from '@/registry/icons/icon-placeholder'
import type { Consent } from '@/registry/lib/consent'
import {
  CookieConsentCategory,
  CookieConsentDescription,
  cookieConsentFocusClassName,
  cookieConsentStatesClassName,
  type CookieConsentText,
  defaultText,
  useCookieConsent,
} from '@/registry/lib/cookie-consent-parts'
import {
  islandPlaceClassName,
  islandMotionClassName,
  islandSurfaceClassName,
} from '@/registry/lib/island'
import { panelTitleClassName } from '@/registry/lib/panel'
import { edgeFadeClassName, useEdgeFades } from '@/registry/lib/scroll'
import { Swap } from '@/registry/lib/swap'
import { type ComponentProps, type ReactNode, useId, useRef } from 'react'

import { cn } from '@/lib/utils'

/*
 * A pill at the foot of the page that asks about cookies in one line:
 * Customise, Reject all and Accept all, as easy as each other. Customise
 * opens the pill into a panel with a switch for each category, on the
 * `layout` role; Escape closes it back. In a column too narrow for one line,
 * the pill is a card. The page places it with its className, pinned across
 * the foot of the window above everything else: it centres itself there.
 *
 *   <CookieConsentIsland
 *     consent={consent}
 *     summary='Kino uses cookies for analytics and ads, with your OK.'
 *     policyHref='/cookies'
 *     className={foot}
 *   />
 */

interface CookieConsentIslandProps<Id extends string>
  extends Omit<ComponentProps<'div'>, 'title'>, CookieConsentText {
  consent: Consent<Id>
  /** The pill's one line: what the cookies are for, as the first thing a visitor reads. */
  summary?: ReactNode
}

function CookieConsentIsland<Id extends string>({
  consent,
  title = defaultText.title,
  description = defaultText.description,
  policyHref,
  summary = 'We use cookies for analytics and ads, with your OK.',
  className,
  ...props
}: CookieConsentIslandProps<Id>) {
  const surfaceRef = useRef<HTMLElement>(null)
  const model = useCookieConsent(consent, surfaceRef)
  const titleId = useId()
  // Reject all and Accept all weigh the same; once the switches show, Save choices leads.
  const answerVariant = model.customising ? 'outline' : 'default'
  const fades = useEdgeFades<HTMLDivElement>()
  if (!model.ready) return null

  const buttons = (
    <>
      <Button
        variant={model.customising ? 'default' : 'ghost'}
        onClick={model.customiseOrSave}
      >
        {model.customising ? 'Save choices' : 'Customise'}
      </Button>
      <Button variant={answerVariant} onClick={model.rejectAll}>
        Reject all
      </Button>
      <Button variant={answerVariant} onClick={model.acceptAll}>
        Accept all
      </Button>
    </>
  )

  return (
    <div
      data-slot='cookie-consent'
      className={cn(islandPlaceClassName, className)}
      {...props}
    >
      {model.region}
      <section
        ref={surfaceRef}
        aria-labelledby={titleId}
        tabIndex={-1}
        data-closed={model.shown ? undefined : ''}
        data-customising={model.customising ? '' : undefined}
        inert={!model.shown}
        className={cn(
          islandSurfaceClassName,
          cookieConsentStatesClassName,
          islandMotionClassName,
          cookieConsentFocusClassName,
          // One line: its corner wraps the buttons' at its padding, a pill when they are. A card once it opens or wraps.
          'rounded-(--surface-radius) @2xl/island:rounded-(--island-pill) @2xl/island:data-customising:rounded-(--surface-radius)',
        )}
      >
        <Swap block id={model.customising ? 'panel' : 'pill'}>
          {/* As wide as a card, or the column less the border on each side. */}
          {model.customising ? (
            <div className='flex w-[min(28rem,calc(100cqw-2px))] flex-col p-(--surface-padding)'>
              <h2 id={titleId} className={panelTitleClassName}>
                {title}
              </h2>
              <CookieConsentDescription
                className='mt-1'
                description={description}
                policyHref={policyHref}
              />
              <div
                ref={fades}
                className={cn(
                  edgeFadeClassName,
                  'scrollbar-thin -mx-(--surface-padding) mt-(--surface-gap) max-h-72 overflow-y-auto border-t px-(--surface-padding) pt-(--surface-gap)',
                )}
              >
                <div className='flex flex-col gap-4 pb-1'>
                  {model.categories.map((category) => (
                    <CookieConsentCategory
                      key={category.id}
                      category={category}
                      model={model}
                    />
                  ))}
                </div>
              </div>
              <div className='mt-(--surface-gap) flex flex-col gap-2 @xs/island:flex-row @xs/island:[&>:first-child]:me-auto'>
                {buttons}
              </div>
            </div>
          ) : (
            <div className='flex w-[min(28rem,calc(100cqw-2px))] flex-col gap-3 p-(--surface-padding) @2xl/island:w-auto @2xl/island:flex-row @2xl/island:items-center @2xl/island:gap-4 @2xl/island:py-(--island-padding) @2xl/island:ps-5 @2xl/island:pe-(--island-padding)'>
              <p className='flex min-w-0 items-center gap-2.5 text-sm'>
                <IconPlaceholder
                  lucide='CookieIcon'
                  tabler='IconCookie'
                  hugeicons='CookieIcon'
                  phosphor='CookieIcon'
                  remixicon='RiCookieLine'
                  aria-hidden
                  className='text-muted-foreground size-4 shrink-0'
                />
                <span>
                  <span id={titleId}>{summary}</span>
                  {policyHref ? (
                    <>
                      {' '}
                      <a
                        href={policyHref}
                        className='text-muted-foreground hover:text-foreground underline underline-offset-3'
                      >
                        Cookie policy
                      </a>
                    </>
                  ) : null}
                </span>
              </p>
              <div className='flex flex-col gap-2 @xs/island:flex-row @xs/island:[&>:first-child]:me-auto @2xl/island:[&>:first-child]:me-0'>
                {buttons}
              </div>
            </div>
          )}
        </Swap>
      </section>
    </div>
  )
}

export { CookieConsentIsland }

export type { CookieConsentIslandProps }
