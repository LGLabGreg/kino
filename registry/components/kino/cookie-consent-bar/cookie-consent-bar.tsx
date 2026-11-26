'use client'

import { Button } from '@/registry/components/kino/button'
import { Collapsible, CollapsiblePanel } from '@/registry/components/kino/collapsible'
import type { Consent } from '@/registry/lib/consent'
import {
  CookieConsentCategory,
  CookieConsentDescription,
  cookieConsentFocusClassName,
  type CookieConsentText,
  defaultText,
  useCookieConsent,
} from '@/registry/lib/cookie-consent-parts'
import { pageColumnClassName } from '@/registry/lib/hero-parts'
import { panelTitleClassName } from '@/registry/lib/panel'
import { type ComponentProps, useId, useRef } from 'react'

import { cn } from '@/lib/utils'

/*
 * A bar at the top of the page, in its flow, that asks about cookies:
 * Customise, Reject all and Accept all, as easy as each other. It covers
 * nothing, so it never hides what has focus (WCAG 2.4.11), and the page
 * makes room for it on `layout`, as it does when Customise opens a switch
 * for each category below it. Put it first in the page, above the header.
 *
 *   <CookieConsentBar consent={consent} />
 *   <SiteHeader … />
 */

interface CookieConsentBarProps<Id extends string>
  extends Omit<ComponentProps<'div'>, 'title'>, CookieConsentText {
  consent: Consent<Id>
}

function CookieConsentBar<Id extends string>({
  consent,
  title = defaultText.title,
  description = defaultText.description,
  policyHref,
  className,
  ...props
}: CookieConsentBarProps<Id>) {
  const surfaceRef = useRef<HTMLElement>(null)
  const model = useCookieConsent(consent, surfaceRef)
  const titleId = useId()
  // Reject all and Accept all weigh the same; once the switches show, Save choices leads.
  const answerVariant = model.customising ? 'outline' : 'default'
  return (
    <div
      data-slot='cookie-consent'
      className={cn('@container/cookie-consent w-full', className)}
      {...props}
    >
      {/* Closed on the server and through hydration, so it opens onto the page once it knows to. */}
      <Collapsible open={model.shown}>
        <CollapsiblePanel className='p-0'>
          <section
            ref={surfaceRef}
            aria-labelledby={titleId}
            tabIndex={-1}
            className={cn(
              cookieConsentFocusClassName,
              'bg-muted/60 border-b focus-visible:ring-inset',
            )}
          >
            <div
              className={cn(
                pageColumnClassName,
                'flex flex-col gap-3 py-4 @3xl/cookie-consent:flex-row @3xl/cookie-consent:items-center @3xl/cookie-consent:gap-8',
              )}
            >
              <div className='min-w-0 flex-1'>
                <h2 id={titleId} className={panelTitleClassName}>
                  {title}
                </h2>
                <CookieConsentDescription
                  className='mt-0.5'
                  description={description}
                  policyHref={policyHref}
                />
              </div>
              <div className='flex shrink-0 flex-col gap-2 @xs/cookie-consent:flex-row'>
                <Button
                  variant={model.customising ? 'default' : 'ghost'}
                  className='@xs/cookie-consent:me-auto @3xl/cookie-consent:me-0'
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
              </div>
            </div>
            <Collapsible open={model.customising}>
              <CollapsiblePanel className='p-0'>
                <div
                  className={cn(
                    pageColumnClassName,
                    'grid gap-x-8 gap-y-4 pt-1 pb-5 @2xl/cookie-consent:grid-cols-2 @5xl/cookie-consent:grid-cols-4',
                  )}
                >
                  {model.categories.map((category) => (
                    <CookieConsentCategory
                      key={category.id}
                      category={category}
                      model={model}
                      className="bg-background content-start rounded-(--surface-radius) border p-(--surface-padding) [grid-template-areas:'label_control'_'message_message']"
                    />
                  ))}
                </div>
              </CollapsiblePanel>
            </Collapsible>
          </section>
        </CollapsiblePanel>
      </Collapsible>
    </div>
  )
}

export { CookieConsentBar }

export type { CookieConsentBarProps }
