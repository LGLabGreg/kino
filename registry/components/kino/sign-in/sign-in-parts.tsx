'use client'

import { Button } from '@/registry/components/kino/button'
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from '@/registry/components/kino/field'
import {
  InputOTP,
  InputOTPSeparator,
  InputOTPSlot,
} from '@/registry/components/kino/input-otp'
import { PasswordInput } from '@/registry/components/kino/password-input'
import {
  type SignInError,
  type SignInFlow,
  signInMessages,
} from '@/registry/components/kino/sign-in/sign-in-flow'
import { Spinner } from '@/registry/components/kino/spinner'
import { IconPlaceholder } from '@/registry/icons/icon-placeholder'
import {
  AuthEmailInput,
  AuthEnd,
  AuthResend,
  type AuthHeading,
  useFocusStep,
} from '@/registry/lib/auth-screen'
import { Swap } from '@/registry/lib/swap'
import {
  createContext,
  type FormEvent,
  type ReactNode,
  use,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'

/*
 * What the sign-in's parts share: how they tell the screen they have moved
 * on, the email and password fields, the code's boxes and its resend, the
 * other accounts, and the screen once the person is in.
 */

interface SignInContextValue {
  /** The part that has moved past its first step, which every other part gives way to. */
  active: string | null
  /** Says whether `part` has moved past its first step. */
  setMoved: (part: string, moved: boolean) => void
  /** Shows the signed-in screen. */
  signedIn: (email: string) => void
}

const SignInContext = createContext<SignInContextValue | null>(null)

/**
 * Tells the sign-in whether this part has moved past its first step, and
 * says whether it is hidden because another part has.
 */
function useSignInPart(moved: boolean) {
  const id = useId()
  const context = use(SignInContext)
  const setMoved = context?.setMoved
  // Before paint, so a part mounted on its next step never shows the others for a frame.
  useLayoutEffect(() => {
    setMoved?.(id, moved)
  }, [setMoved, id, moved])
  // A part that goes stops holding the others back.
  useLayoutEffect(() => () => setMoved?.(id, false), [setMoved, id])
  return { hidden: context?.active != null && context.active !== id }
}

/** Shows the signed-in screen, for a part's sign-in to call once the person is in. */
function useSignedIn() {
  return use(SignInContext)?.signedIn
}

/**
 * A part, or the line between two: it folds away while another part is on
 * its next step, and comes back with it. The space above it goes with it.
 * A part that has `moved` says so on the page, so the screen can fold the
 * others before React has run, as a page rendered on the server opens.
 */
function SignInFold({
  hidden,
  moved = false,
  children,
}: {
  hidden: boolean
  moved?: boolean
  children: ReactNode
}) {
  return (
    <div data-slot='sign-in-fold' data-moved={moved ? '' : undefined} className='flex'>
      <Swap fill block wait id={hidden ? 'hidden' : 'shown'}>
        {hidden ? null : (
          <div className='flex w-full min-w-0 flex-col pt-(--surface-gap)'>
            {children}
          </div>
        )}
      </Swap>
    </div>
  )
}

/** An error about the address, shown under the email while it is the step's field. */
function emailError(flow: SignInFlow) {
  if (flow.error === 'invalid-email') return signInMessages[flow.error]
  return flow.error === 'send-failed' && flow.step === 'email'
    ? signInMessages[flow.error]
    : null
}

/**
 * The email field. It names itself `username` too, so a password manager
 * offers the saved address and, after the password step, saves the pair.
 */
function EmailField({
  flow,
  readOnly,
  focusFirst = !readOnly,
  end,
  className,
}: {
  flow: SignInFlow
  readOnly?: boolean
  /** Whether a new step puts focus here first. */
  focusFirst?: boolean
  /** Sits at the end of the box, such as a Change button once the address is in use. */
  end?: ReactNode
  className?: string
}) {
  const error = emailError(flow)
  return (
    <Field name='email' invalid={error ? true : undefined} className={className}>
      <FieldLabel>Email</FieldLabel>
      <AuthEmailInput
        autoComplete='username webauthn'
        value={flow.email}
        readOnly={readOnly}
        data-autofocus={focusFirst ? '' : undefined}
        onChange={(event) => flow.setEmail(event.target.value)}
        end={end}
      />
      <FieldError>{error}</FieldError>
    </Field>
  )
}

/** The password, with Forgot password beside its label. */
function PasswordField({ flow, className }: { flow: SignInFlow; className?: string }) {
  const error =
    flow.error === 'missing-password' ||
    flow.error === 'wrong-password' ||
    flow.error === 'sign-in-failed' ||
    flow.error === 'reset-failed'
  return (
    <Field name='password' invalid={error ? true : undefined} className={className}>
      <FieldLabel>Password</FieldLabel>
      <PasswordInput
        data-autofocus=''
        onChange={() => {
          if (error) flow.clearError()
        }}
      />
      {/* After the box in tab order, so Tab from the email reaches the password first; shown beside the label. */}
      <Button
        type='button'
        variant='link'
        size='sm'
        className='text-muted-foreground hover:text-foreground -mt-0.5 h-auto min-h-6 self-start justify-self-end px-0 font-normal [grid-area:label]'
        loading={flow.busy === 'reset'}
        onClick={() => void flow.resetPassword()}
      >
        Forgot password?
      </Button>
      <FieldError>{error && flow.error ? signInMessages[flow.error] : null}</FieldError>
    </Field>
  )
}

/** Once in: a tick that draws, who is in, and the app opening. */
function SignedIn({ email, heading }: { email: string; heading?: AuthHeading }) {
  return (
    <AuthEnd
      heading={heading}
      title='You’re signed in'
      description={email}
      icon={
        // The tick wipes in along its stroke on `draw` once it arrives, never on load.
        <span className='flex transition-[clip-path] delay-[calc(var(--motion-enter-duration)*0.5)] duration-(--motion-draw-duration) ease-(--motion-draw-easing) [clip-path:inset(0_0_0_0)] in-data-mounted:starting:[clip-path:inset(0_100%_0_0)] motion-reduce:transition-none rtl:in-data-mounted:starting:[clip-path:inset(0_0_0_100%)]'>
          <IconPlaceholder
            lucide='CheckIcon'
            tabler='IconCheck'
            hugeicons='Tick02Icon'
            phosphor='CheckIcon'
            remixicon='RiCheckLine'
            aria-hidden
          />
        </span>
      }
    >
      <p className='text-muted-foreground flex items-center gap-2 text-sm'>
        <Spinner aria-hidden /> Opening your workspace
      </p>
    </AuthEnd>
  )
}

/**
 * Moves focus to a step's first field once it has arrived, and to a field
 * the person has to fill with its error, so a press on the button never
 * leaves them away from what to fix.
 */
function useSignInFocus<Element extends HTMLElement>(
  step: SignInFlow['step'],
  error: SignInError | null,
) {
  return useFocusStep<Element>(
    step,
    error === 'invalid-email'
      ? 'email'
      : error === 'missing-password'
        ? 'password'
        : null,
  )
}

/** The Change button at the end of the email once it's in use, which takes the person back to edit it. */
function ChangeEmail({ flow, shown }: { flow: SignInFlow; shown: boolean }) {
  return (
    <Swap align='end'>
      {shown ? (
        <Button
          type='button'
          variant='ghost'
          size='xs'
          onClick={() => flow.goTo('email')}
        >
          Change
        </Button>
      ) : null}
    </Swap>
  )
}

/*
 * The code step's parts: six boxes that check the code as soon as they're
 * full, and the line under them that sends a new code once the wait is over.
 * A code that doesn't match empties the boxes and keeps focus in them, so the
 * next try starts at the first.
 */

const CODE_LENGTH = 6

// A new code that can't be sent says so here too, where the person is looking.
const CODE_ERRORS = [
  'incomplete-code',
  'wrong-code',
  'expired-code',
  'check-failed',
  'send-failed',
] as const

/** The six boxes, in two groups of three as codes are read out, with the code's error under them. */
function CodeField({
  flow,
  label = 'Code',
  description,
  describedBy,
  className,
}: {
  flow: SignInFlow
  label?: string
  description?: ReactNode
  /** The id of text elsewhere that says where the code went, read with every box. */
  describedBy?: string
  className?: string
}) {
  const [code, setCode] = useState('')
  const root = useRef<HTMLDivElement>(null)
  const error = CODE_ERRORS.find((kind) => kind === flow.error)

  const check = async (value: string) => {
    const result = await flow.verifyCode(value)
    if (result === 'wrong' || result === 'expired') {
      setCode('')
      root.current?.querySelector('input')?.focus()
    }
  }

  return (
    <Field
      name='code'
      // Only the sign-in says a code is wrong, in its own words: never the
      // browser's check of the boxes' pattern, which would speak while typing.
      invalid={Boolean(error)}
      className={className}
    >
      <FieldLabel>{label}</FieldLabel>
      <InputOTP
        ref={root}
        aria-describedby={describedBy}
        length={CODE_LENGTH}
        value={code}
        readOnly={flow.busy === 'code'}
        data-autofocus=''
        onValueChange={(value) => {
          setCode(value)
          if (error) flow.clearError()
        }}
        onValueComplete={(value) => void check(value)}
      >
        {Array.from({ length: CODE_LENGTH }, (_, index) =>
          index === CODE_LENGTH / 2 ? (
            // oxlint-disable-next-line react/no-array-index-key -- a slot's place in the code is what it is.
            <CodeSlotAfterBreak key={index} />
          ) : (
            // oxlint-disable-next-line react/no-array-index-key -- a slot's place in the code is what it is.
            <InputOTPSlot key={index} />
          ),
        )}
      </InputOTP>
      {description ? <FieldDescription>{description}</FieldDescription> : null}
      <FieldError match={Boolean(error)}>
        {error ? signInMessages[error] : null}
      </FieldError>
    </Field>
  )
}

function CodeSlotAfterBreak() {
  return (
    <>
      <InputOTPSeparator />
      <InputOTPSlot />
    </>
  )
}

/**
 * Checks what's in the boxes when the form is sent, for a person who presses
 * rather than waits. It runs before the form's own check, so a code typed in
 * part is refused in the sign-in's words, not the browser's.
 */
function useCodeSubmit(flow: SignInFlow) {
  return (event: FormEvent<HTMLFormElement>) => {
    const value = new FormData(event.currentTarget).get('code')
    event.preventDefault()
    event.stopPropagation()
    if (typeof value === 'string' && value.length === CODE_LENGTH) {
      void flow.verifyCode(value)
    } else {
      flow.refuseCode()
      event.currentTarget
        .querySelector<HTMLInputElement>('[data-slot=input-otp] input')
        ?.focus()
    }
  }
}

/**
 * Didn't get it? A new code can go once the wait is over; until then the
 * button counts down. Sending one says so to a screen reader.
 */
function ResendCode({ flow, className }: { flow: SignInFlow; className?: string }) {
  return (
    <AuthResend
      className={className}
      left={flow.resendIn}
      busy={flow.busy === 'resend'}
      onResend={flow.sendNewCode}
      sent={`We sent a new code to ${flow.email}.`}
    >
      Resend code
    </AuthResend>
  )
}

export {
  ChangeEmail,
  CodeField,
  EmailField,
  PasswordField,
  ResendCode,
  SignedIn,
  SignInContext,
  SignInFold,
  useCodeSubmit,
  useSignedIn,
  useSignInFocus,
  useSignInPart,
}
export type { SignInContextValue }
