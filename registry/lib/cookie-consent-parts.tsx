'use client'

import { Field, FieldDescription, FieldLabel } from '@/registry/components/kino/field'
import { Switch } from '@/registry/components/kino/switch'
import { useAnnouncer } from '@/registry/lib/announce'
import {
  type Consent,
  type ConsentCategory,
  isGranted,
  useConsent,
} from '@/registry/lib/consent'
import { panelDescriptionClassName } from '@/registry/lib/panel'
import { revealBehavior } from '@/registry/lib/scroll'
import {
  type ReactNode,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'

import { cn } from '@/lib/utils'

/*
 * What every arrangement of the Cookie consent banner shares: when it shows,
 * the switches a visitor sets before saving, the three ways to answer, where
 * focus goes, what a screen reader hears, and a category's row.
 */

interface CookieConsentText {
  /** The banner's heading. */
  title?: ReactNode
  /** What the cookies are for, in a sentence or two. */
  description?: ReactNode
  /** The cookie policy, linked after the description. */
  policyHref?: string
}

const defaultText = {
  title: 'Cookies',
  description:
    'We use them to keep the site working and, with your OK, to learn how it’s used and to show ads that fit.',
} satisfies CookieConsentText

/**
 * The banner's state: shown while the consent asks, the switches as they
 * stand, whether its settings are open, and its answers.
 */
function useCookieConsent<Id extends string>(
  consent: Consent<Id>,
  surfaceRef: RefObject<HTMLElement | null>,
) {
  const { state, save } = useConsent(consent)
  const { announce, region } = useAnnouncer()
  // Where focus was when a link opened the banner, to go back to once it's answered.
  const returnTo = useRef<HTMLElement | null>(null)

  const ready = state.status !== 'unknown'
  const shown = state.status === 'asking'
  const opened = state.status === 'asking' && state.opened
  const gpc = consent.gpc()
  // The switches start from what applies, and nothing is on until it's turned on.
  const [granted, setGranted] = useState<readonly Id[]>([])
  const [customising, setCustomising] = useState(false)
  const [asked, setAsked] = useState(state)
  if (state !== asked) {
    setAsked(state)
    // The switches start again only when the banner comes back; one that
    // leaves keeps what it showed until it has gone.
    if (state.status === 'asking' && asked.status !== 'asking') {
      setGranted(state.choice?.granted ?? [])
      setCustomising(state.opened)
    } else if (opened) setCustomising(true)
  }

  // Opened from a link, the banner takes focus, so a keyboard is where the choices are.
  useLayoutEffect(() => {
    if (!opened) return
    const active = document.activeElement
    const surface = surfaceRef.current
    if (!surface || surface.contains(active)) return
    returnTo.current = active instanceof HTMLElement ? active : null
    surface.focus({ preventScroll: true })
    // A banner in the page's flow may be out of view, as the Top bar is from the footer.
    surface.scrollIntoView({
      block: 'nearest',
      behavior: revealBehavior(surface),
    })
  }, [opened, surfaceRef])

  // Customise takes focus to the first switch, so the settings are next by
  // keyboard and a screen reader lands in them. Folding them back, or a
  // button that went away with them, as the Island's pill does, leaves focus
  // on the banner itself.
  const focusSwitch = useRef(false)
  useLayoutEffect(() => {
    const surface = surfaceRef.current
    if (!surface) return
    const first = focusSwitch.current
      ? surface.querySelector<HTMLElement>('[role="switch"]:not([data-disabled])')
      : null
    focusSwitch.current = false
    if (first) return first.focus()
    const active = document.activeElement
    if (active === document.body || active?.closest('[inert]'))
      surface.focus({ preventScroll: true })
  }, [customising, surfaceRef])

  // Escape folds the settings back; it never counts as an answer.
  useEffect(() => {
    const surface = surfaceRef.current
    if (!surface || !customising) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      setCustomising(false)
      surface.focus({ preventScroll: true })
    }
    surface.addEventListener('keydown', onKeyDown)
    return () => surface.removeEventListener('keydown', onKeyDown)
  }, [customising, surfaceRef])

  const answer = (next: readonly Id[], said: string) => {
    const surface = surfaceRef.current
    // Never left on a button that is going away (cookieconsent #530).
    if (surface?.contains(document.activeElement)) {
      const back = returnTo.current
      if (back?.isConnected) back.focus({ preventScroll: true })
      else if (document.activeElement instanceof HTMLElement)
        document.activeElement.blur()
    }
    returnTo.current = null
    save(next)
    announce(said)
  }

  return {
    ready,
    shown,
    customising,
    region,
    categories: consent.categories,
    isOn: (category: ConsentCategory<Id>) => isGranted(category, { granted }, gpc),
    /** Kept off by the browser's Global Privacy Control. */
    locked: (category: ConsentCategory<Id>) => Boolean(category.gpc && gpc),
    toggle: (id: Id, on: boolean) =>
      setGranted((last) =>
        on
          ? [...last.filter((each) => each !== id), id]
          : last.filter((each) => each !== id),
      ),
    /**
     * Customise, then Save choices on the same button: the second click of a
     * double-click on Customise never saves the switches it just showed.
     */
    customiseOrSave: (event: { detail: number }) => {
      if (customising) {
        if (event.detail <= 1) answer(granted, 'Cookie choices saved.')
        return
      }
      focusSwitch.current = true
      setCustomising(true)
      announce('Cookie settings shown.')
    },
    // The store leaves out what GPC keeps off, and the visitor hears that it did.
    acceptAll: () => {
      const kept = consent.categories.filter((category) => category.gpc && gpc)
      answer(
        consent.categories.map((category) => category.id),
        kept.length
          ? `Cookies accepted, except ${kept.map((category) => category.label).join(', ')}: your browser asks sites not to share your data.`
          : 'All cookies accepted.',
      )
    },
    rejectAll: () => answer([], 'Only necessary cookies kept.'),
  }
}

type CookieConsentModel<Id extends string> = ReturnType<typeof useCookieConsent<Id>>

/**
 * Where the banner comes from and goes to: it rises into place
 * `--cookie-consent-rise` far, and once gone it is hidden and inert, so
 * nothing in it keeps focus.
 */
const cookieConsentStatesClassName =
  'starting:opacity-0 motion-safe:starting:translate-y-(--cookie-consent-rise,0.75rem) data-closed:invisible data-closed:opacity-0 motion-safe:data-closed:translate-y-(--cookie-consent-rise,0.75rem)'

/**
 * The banner arriving on `enter` and leaving on `exit`, between its states.
 * It is visible from the start of its entrance, so focus can move into it
 * at once, and hidden only once its exit has played.
 */
const cookieConsentPresenceClassName = cn(
  cookieConsentStatesClassName,
  '[transition:opacity_var(--motion-enter-duration)_var(--motion-enter-easing),translate_var(--motion-enter-duration)_var(--motion-enter-easing),visibility_0s] data-closed:[transition:opacity_var(--motion-exit-duration)_var(--motion-exit-easing),translate_var(--motion-exit-duration)_var(--motion-exit-easing),visibility_0s_var(--motion-exit-duration)] motion-reduce:[transition:opacity_var(--motion-enter-duration)_var(--motion-enter-easing),visibility_0s] motion-reduce:data-closed:[transition:opacity_var(--motion-exit-duration)_var(--motion-exit-easing),visibility_0s_var(--motion-exit-duration)]',
)

/** The banner takes focus when reopened: its ring, as a focusable region's. */
const cookieConsentFocusClassName =
  'focus-visible:ring-ring/50 focus-visible:ring-3 focus-visible:outline-hidden'

/** What the cookies are for, then the link to the cookie policy. */
function CookieConsentDescription({
  description,
  policyHref,
  className,
}: {
  description: ReactNode
  policyHref?: string
  className?: string
}) {
  return (
    <p className={cn(panelDescriptionClassName, className)}>
      {description}
      {policyHref ? (
        <>
          {' '}
          <a href={policyHref}>Cookie policy</a>
        </>
      ) : null}
    </p>
  )
}

/** One category: its name and what it's for, the tools it covers, and its switch. */
function CookieConsentCategory<Id extends string>({
  category,
  model,
  className,
}: {
  category: ConsentCategory<Id>
  model: CookieConsentModel<Id>
  className?: string
}) {
  const locked = model.locked(category)
  return (
    <Field
      disabled={locked}
      className={cn(
        "grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 [grid-template-areas:'label_control'_'message_control']",
        className,
      )}
    >
      <FieldLabel className='self-end pb-0.5'>{category.label}</FieldLabel>
      <FieldDescription className='self-start pt-0.5'>
        {category.description}
        {category.services?.length ? (
          <span className='text-foreground/70 block'>{category.services.join(', ')}</span>
        ) : null}
        {locked ? (
          <span className='block'>
            Off: your browser asks sites not to share your data.
          </span>
        ) : null}
      </FieldDescription>
      {category.required ? (
        <span className='text-muted-foreground text-xs font-medium [grid-area:control]'>
          Always on
        </span>
      ) : (
        <Switch
          checked={model.isOn(category)}
          onCheckedChange={(on) => model.toggle(category.id, on)}
          className='[grid-area:control]'
        />
      )}
    </Field>
  )
}

export {
  CookieConsentCategory,
  CookieConsentDescription,
  cookieConsentFocusClassName,
  cookieConsentPresenceClassName,
  cookieConsentStatesClassName,
  defaultText,
  useCookieConsent,
}

export type { CookieConsentModel, CookieConsentText }
