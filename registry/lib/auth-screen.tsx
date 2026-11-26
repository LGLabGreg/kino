'use client'

import { Button } from '@/registry/components/kino/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/registry/components/kino/card'
import type { InputControl } from '@/registry/components/kino/input'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from '@/registry/components/kino/input-group'
import { Separator } from '@/registry/components/kino/separator'
import {
  providers,
  SocialSignIn,
  SocialSignInButton,
  type SocialProvider,
  type SocialSignInLayout,
} from '@/registry/components/kino/social-sign-in'
import { announce } from '@/registry/lib/announce'
import { markMounted } from '@/registry/lib/refs'
import { Swap } from '@/registry/lib/swap'
import {
  type ComponentProps,
  type ReactNode,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'

import { cn } from '@/lib/utils'

/*
 * What the Sign in and Sign up blocks share, so the two screens look, move
 * and read as one: the screen with your logo and the card, the email box,
 * the "or" line, the Google, GitHub and Apple buttons, the screen that ends
 * the card, and a resend that counts down.
 */

/**
 * Your product's logo, at the top of the screen. Replace the mark and the
 * name with your own; it's drawn in the text colour, in `--font-logo` when
 * you set it and the page's font when you don't.
 */
function AuthLogo({ className }: { className?: string }) {
  const id = useId()
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-baseline gap-[0.33em] font-[family-name:var(--font-logo,inherit)] text-[26px] leading-none font-semibold tracking-[-0.025em] lowercase',
        className,
      )}
    >
      <svg viewBox='0 0 84.6 90' aria-hidden className='h-[0.73em] w-auto shrink-0'>
        <mask id={id}>
          <g fill='none' strokeWidth='18' strokeLinecap='round' strokeLinejoin='round'>
            <path
              d='M75.6 9 L39.6 45 L75.6 81'
              className='stroke-[#727272] dark:stroke-[#4d4d4d]'
            />
            <path
              d='M60.3 9 L24.3 45 L60.3 81'
              className='stroke-[#bcbcbc] dark:stroke-[#959595]'
            />
            <path d='M45 9 L9 45 L45 81' stroke='white' />
          </g>
        </mask>
        <rect width='84.6' height='90' fill='currentColor' mask={`url(#${id})`} />
      </svg>
      <span>Kino</span>
    </span>
  )
}

type AuthHeading = 'h1' | 'h2' | 'h3'

/**
 * The screen: the logo, the card with its heading and the form, and what
 * sits under the card. Given `end`, the card gives way to it, taking its
 * height, and focus moves to it once it has arrived; without, the form
 * comes back and focus goes to its first field.
 */
function AuthScreen({
  title,
  description,
  heading: Heading = 'h1',
  footer,
  end,
  slot,
  className,
  children,
}: {
  /** The screen's `data-slot`, such as `sign-in`, so each block can be styled and found on its own. */
  slot: string
  title: string
  description?: ReactNode
  heading?: AuthHeading
  footer?: ReactNode
  /** What ends the screen, such as who is signed in; the form goes while it shows. */
  end?: ReactNode
  className?: string
  children: ReactNode
}) {
  const ended = end != null && end !== false
  const focusRef = useFocusStep<HTMLDivElement>(ended ? 'end' : 'form')

  return (
    <div
      data-slot={slot}
      ref={markMounted}
      className={cn('@container flex min-h-full w-full flex-col items-center', className)}
    >
      {/* Held at the top, so the card grows and shrinks downward and the logo never
          moves. A container query reads the page, so this column takes the padding. */}
      <div className='flex w-full max-w-sm flex-col items-center gap-6 @md:py-16'>
        {/* Narrower than a small tablet, the card drops its frame, as a phone's sign-in does. */}
        <Card
          ref={focusRef}
          className='w-full @max-md:border-transparent @max-md:bg-transparent @max-md:shadow-none'
        >
          <div className='px-(--surface-padding)'>
            <AuthLogo />
          </div>
          <Swap fill block wait id={ended ? 'end' : 'form'}>
            {ended ? (
              <CardContent className='w-full'>{end}</CardContent>
            ) : (
              <div className='flex w-full min-w-0 flex-col gap-(--surface-gap)'>
                <CardHeader>
                  {/* oxlint-disable-next-line jsx-a11y/heading-has-content -- the title's text goes in through the part's props. */}
                  <CardTitle render={<Heading />}>{title}</CardTitle>
                  {description ? <CardDescription>{description}</CardDescription> : null}
                </CardHeader>
                {/* Each part brings the space above it, so one that folds takes it away. */}
                <CardContent className='-mt-(--surface-gap) flex flex-col'>
                  {children}
                </CardContent>
              </div>
            )}
          </Swap>
        </Card>
        {footer ? (
          <div className='text-muted-foreground text-center text-sm'>{footer}</div>
        ) : null}
      </div>
    </div>
  )
}

/**
 * What ends the card: a mark, a heading that takes focus as it arrives, a
 * line under it, and what the person can do next.
 */
function AuthEnd({
  icon,
  title,
  description,
  heading: Heading = 'h1',
  children,
}: {
  /** Drawn in a soft green circle, such as a tick or an envelope. */
  icon: ReactNode
  title: ReactNode
  description?: ReactNode
  heading?: AuthHeading
  children?: ReactNode
}) {
  return (
    <div className='flex flex-col items-center gap-3 py-2 text-center'>
      <span className='bg-success/15 text-success-foreground flex size-10 items-center justify-center rounded-full [&_svg]:size-5'>
        {icon}
      </span>
      <div className='flex flex-col gap-1'>
        <Heading
          data-autofocus=''
          tabIndex={-1}
          className='text-base font-semibold focus:outline-hidden'
        >
          {title}
        </Heading>
        {description ? (
          <p className='text-muted-foreground text-sm wrap-break-word'>{description}</p>
        ) : null}
      </div>
      {children}
    </div>
  )
}

/**
 * Moves focus to a new step's first field once it has arrived, but never on
 * load, where focus belongs to the page. A step's field marks itself
 * `data-autofocus`; content still leaving is inert and passed over. Given
 * `field`, the input of that name takes focus whenever it changes, such as
 * a field the person has to fill.
 */
function useFocusStep<Element extends HTMLElement>(
  step: string,
  field: string | null = null,
) {
  const ref = useRef<Element>(null)
  // The step focus last followed: an effect that runs again for the same
  // step, as React's Strict Mode runs it, moves nothing.
  const followed = useRef(step)
  useLayoutEffect(() => {
    if (followed.current === step) return
    followed.current = step
    const target = [
      ...(ref.current?.querySelectorAll<HTMLElement>('[data-autofocus]') ?? []),
    ].find((element) => !element.closest('[inert]'))
    const focusable = target?.matches('input, button, [tabindex]')
      ? target
      : target?.querySelector<HTMLElement>('input, button')
    focusable?.focus({ preventScroll: true })
  }, [step])
  useLayoutEffect(() => {
    if (!field) return
    ref.current?.querySelector<HTMLInputElement>(`input[name=${field}]`)?.focus()
  }, [field])
  return ref
}

/**
 * The email box. Text with an email keyboard, so the screen's own check
 * speaks rather than the browser's, in another voice; an address reads left
 * to right in any language. `end` sits at the end of the box, such as a
 * Change button once the address is in use.
 */
function AuthEmailInput({
  end,
  className,
  ...props
}: ComponentProps<typeof InputControl> & { end?: ReactNode }) {
  return (
    <InputGroup>
      <InputGroupInput
        type='text'
        autoCapitalize='none'
        autoCorrect='off'
        spellCheck={false}
        inputMode='email'
        placeholder='name@company.com'
        dir='ltr'
        className={cn('text-ellipsis rtl:text-end', className)}
        {...props}
      />
      {end ? <InputGroupAddon align='inline-end'>{end}</InputGroupAddon> : null}
    </InputGroup>
  )
}

/** "or", between two ways in. */
function AuthDivider({ children = 'or' }: { children?: ReactNode }) {
  return (
    <div className='text-muted-foreground flex items-center gap-3 text-xs'>
      <Separator className='flex-1' />
      {children}
      <Separator className='flex-1' />
    </div>
  )
}

/**
 * Google, GitHub and Apple, with the one used last first. A press opens
 * the provider; one that can't be reached goes back to rest and says so
 * under the buttons.
 */
function AuthSocial({
  label,
  onOpen,
  lastUsed,
  layout,
}: {
  /** Names the group, such as "Sign in with Google, GitHub or Apple". */
  label: string
  /** Opens the provider. A throw or a rejected promise says it couldn't be reached. */
  onOpen?: (provider: SocialProvider) => unknown
  lastUsed?: SocialProvider
  layout?: SocialSignInLayout
}) {
  const [unreachable, setUnreachable] = useState<SocialProvider | null>(null)
  return (
    <>
      <SocialSignIn
        aria-label={label}
        layout={layout}
        lastUsed={lastUsed}
        onSignIn={async (provider) => {
          setUnreachable(null)
          try {
            await onOpen?.(provider)
          } catch (error) {
            setUnreachable(provider)
            throw error
          }
        }}
      >
        <SocialSignInButton provider='google' />
        <SocialSignInButton provider='github' />
        <SocialSignInButton provider='apple' />
      </SocialSignIn>
      <AuthMessage>
        {unreachable
          ? `We couldn’t reach ${providers[unreachable].name}. Try again in a moment.`
          : null}
      </AuthMessage>
    </>
  )
}

/**
 * Something that went wrong away from any field, such as a server that
 * couldn't be reached. The region is there before the message, so a screen
 * reader reads it as it arrives, and the line opens to fit it.
 */
function AuthMessage({ children }: { children?: ReactNode }) {
  return (
    <div role='status'>
      <Swap fill block>
        {children ? <p className='text-destructive pt-2 text-sm'>{children}</p> : null}
      </Swap>
    </div>
  )
}

/**
 * Didn't get it? Another can go once the wait is over; until then the
 * button counts down. One that's sent is announced, in `sent`'s words.
 */
function AuthResend({
  left,
  busy = false,
  onResend,
  sent,
  question = 'Didn’t get it?',
  children,
  className,
}: {
  /** Seconds before another can go. */
  left: number
  busy?: boolean
  /** Sends another, resolving with whether it went. */
  onResend: () => Promise<boolean>
  /** What a screen reader hears once another has gone. */
  sent: string
  question?: ReactNode
  /** The button's label once the wait is over. */
  children: ReactNode
  className?: string
}) {
  const waiting = left > 0
  return (
    <div
      className={cn(
        'text-muted-foreground flex flex-wrap items-center gap-x-1 text-sm',
        className,
      )}
    >
      <span>{question}</span>
      <Button
        type='button'
        variant='link'
        size='sm'
        className='h-auto min-h-6 px-0 tabular-nums'
        disabled={waiting}
        // Still found by Tab while it counts down, so the wait can be read.
        focusableWhenDisabled
        loading={busy}
        onClick={async () => {
          if (await onResend()) announce(sent)
        }}
      >
        {waiting ? `Resend in ${countdownLabel(left)}` : children}
      </Button>
    </div>
  )
}

/** Seconds left of a wait that restarts each time `key` changes, ticking once a second, from `initial` at first. */
function useCountdown(key: number, seconds: number, initial = seconds) {
  const [left, setLeft] = useState(initial)
  const [last, setLast] = useState(key)
  if (key !== last) {
    setLast(key)
    setLeft(seconds)
  }
  useEffect(() => {
    if (left <= 0) return
    const timer = setTimeout(() => setLeft((now) => now - 1), 1000)
    return () => clearTimeout(timer)
  }, [left])
  return { left, end: () => setLeft(0) }
}

/** Seconds as minutes and seconds, as a countdown reads: 0:09. */
function countdownLabel(seconds: number) {
  const whole = Math.max(0, Math.ceil(seconds))
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}

/** Whether `email` reads as an address: something, an @, and a domain with a dot. */
function looksLikeEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
}

export {
  AuthDivider,
  AuthEmailInput,
  AuthEnd,
  AuthLogo,
  AuthMessage,
  AuthResend,
  AuthScreen,
  AuthSocial,
  useCountdown,
  useFocusStep,
}
export { countdownLabel, looksLikeEmail }
export type { AuthHeading }
