'use client'

import { Button } from '@/registry/components/kino/button'
import { Collapsible, CollapsiblePanel } from '@/registry/components/kino/collapsible'
import type { Consent } from '@/registry/lib/consent'
import {
  CookieConsentCategory,
  CookieConsentDescription,
  cookieConsentFocusClassName,
  cookieConsentPresenceClassName,
  type CookieConsentText,
  defaultText,
  useCookieConsent,
} from '@/registry/lib/cookie-consent-parts'
import { panelTitleClassName } from '@/registry/lib/panel'
import { edgeFadeClassName, useEdgeFades } from '@/registry/lib/scroll'
import { type ComponentProps, useId, useRef } from 'react'

import { cn } from '@/lib/utils'

/*
 * A card in a corner of the page that asks about cookies: Customise, Reject
 * all and Accept all, as easy as each other. Customise grows the card in
 * place into a switch for each category, and turns into Save choices. The
 * page places it with its className, pinned to a corner of the window above
 * everything else, since a block lays out only inside the box it is given.
 *
 *   <CookieConsent consent={consent} policyHref='/cookies' className={corner} />
 */

interface CookieConsentProps<Id extends string>
  extends Omit<ComponentProps<'div'>, 'title'>, CookieConsentText {
  consent: Consent<Id>
}

function CookieConsent<Id extends string>({
  consent,
  title = defaultText.title,
  description = defaultText.description,
  policyHref,
  className,
  ...props
}: CookieConsentProps<Id>) {
  const surfaceRef = useRef<HTMLElement>(null)
  const model = useCookieConsent(consent, surfaceRef)
  const titleId = useId()
  // Reject all and Accept all weigh the same; once the switches show, Save choices leads.
  const answerVariant = model.customising ? 'outline' : 'default'
  const fades = useEdgeFades<HTMLDivElement>()
  if (!model.ready) return null
  return (
    <div
      data-slot='cookie-consent'
      className={cn(
        '@container/cookie-consent pointer-events-none w-full max-w-sm',
        className,
      )}
      {...props}
    >
      {model.region}
      <section
        ref={surfaceRef}
        aria-labelledby={titleId}
        tabIndex={-1}
        data-closed={model.shown ? undefined : ''}
        inert={!model.shown}
        className={cn(
          cookieConsentPresenceClassName,
          cookieConsentFocusClassName,
          'bg-popover text-popover-foreground pointer-events-auto flex flex-col rounded-(--surface-radius) border p-(--surface-padding) shadow-lg',
        )}
      >
        <h2 id={titleId} className={panelTitleClassName}>
          {title}
        </h2>
        <CookieConsentDescription
          className='mt-1'
          description={description}
          policyHref={policyHref}
        />
        <Collapsible open={model.customising}>
          <CollapsiblePanel className='p-0'>
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
          </CollapsiblePanel>
        </Collapsible>
        <div className='mt-(--surface-gap) flex flex-col gap-2 @xs/cookie-consent:flex-row'>
          <Button
            variant={model.customising ? 'default' : 'ghost'}
            className='@xs/cookie-consent:me-auto'
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
      </section>
    </div>
  )
}

export { CookieConsent }

export type { CookieConsentProps }
