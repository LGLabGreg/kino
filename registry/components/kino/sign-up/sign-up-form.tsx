'use client'

import { Button } from '@/registry/components/kino/button'
import { Checkbox } from '@/registry/components/kino/checkbox'
import {
  Field,
  FieldError,
  FieldLabel,
  Form,
  isFormErrors,
  useFormSubmission,
} from '@/registry/components/kino/field'
import { Input } from '@/registry/components/kino/input'
import { PasswordInput } from '@/registry/components/kino/password-input'
import { PasswordStrength } from '@/registry/components/kino/password-strength'
import { useSignUp } from '@/registry/components/kino/sign-up/sign-up-context'
import {
  emailError,
  nameError,
  passwordError,
  passwordRules,
  type SignUpErrors,
  type SignUpValues,
  signUpMessages,
  termsError,
  userInputs,
} from '@/registry/components/kino/sign-up/sign-up-flow'
import { AuthEmailInput, AuthMessage } from '@/registry/lib/auth-screen'
import { type FocusEvent, type ReactNode, useState } from 'react'

/*
 * A new account: a name, an email, a password with its strength and the
 * rules it must meet, and the terms. A field is checked when the person
 * leaves it, and every field when they press Create account; an error goes
 * as soon as they start fixing it. An empty field is asked for only after a
 * press, so tabbing through never fills the form with errors. One form with
 * a real submit, so a password manager offers a new password and saves it
 * with the email once the account is made.
 */

type FieldName = 'name' | 'email' | 'password' | 'terms'

/** Where the person is with a field: editing it since they last left it, or left it. */
type Visit = 'editing' | 'left'

const linkClassName =
  'text-foreground font-medium underline underline-offset-4 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-hidden'

const defaultTerms = (
  <>
    I agree to the{' '}
    {/* oxlint-disable-next-line next/no-html-link-for-pages -- a plain link works in any app; use your router's link if it has one. */}
    <a href='/terms' className={linkClassName}>
      Terms of Service
    </a>{' '}
    and {/* oxlint-disable-next-line next/no-html-link-for-pages -- as above. */}
    <a href='/privacy' className={linkClassName}>
      Privacy Policy
    </a>
  </>
)

function SignUpForm({
  onSignUp,
  onResendEmail,
  resendAfter = 30,
  terms = defaultTerms,
  defaultEmail = '',
}: {
  /**
   * Creates the account and emails a link to finish it. Return your
   * server's errors by field to show them there, such as a password found
   * in a breach; a throw or a rejected promise says it couldn't be reached.
   */
  onSignUp?: (
    account: Omit<SignUpValues, 'agreed'>,
  ) => SignUpErrors | void | Promise<SignUpErrors | void>
  /** Emails the link again. A throw or a rejected promise says it couldn't. */
  onResendEmail?: (email: string) => unknown
  /** Seconds before another email can go. */
  resendAfter?: number
  /** What the person agrees to, beside the checkbox, with links to read it. */
  terms?: ReactNode
  /** The email it opens with, such as the one an invite went to. */
  defaultEmail?: string
}) {
  const screen = useSignUp()
  const [values, setValues] = useState<SignUpValues>(
    () => screen?.draft ?? { name: '', email: defaultEmail, password: '', agreed: false },
  )
  const set = (change: Partial<SignUpValues>) =>
    setValues((now) => ({ ...now, ...change }))
  // Whether Create account has been pressed: until then, an empty field isn't an error.
  const [tried, setTried] = useState(false)

  return (
    <div className='flex flex-col pt-(--surface-gap)'>
      <Form
        className='flex flex-col gap-(--surface-gap)'
        // A press checks every field, whether the browser turns the form down or sends it.
        onInvalidCapture={() => setTried(true)}
        onSubmitCapture={() => setTried(true)}
        onFormSubmit={async () => {
          const { name, email, password } = values
          const refused = await onSignUp?.({ name, email, password })
          // Errors by field turn the submit down, and the Form shows them there.
          if (!isFormErrors(refused)) {
            screen?.created({ values, onResend: onResendEmail, resendAfter })
          }
          return refused
        }}
      >
        <SignUpFields values={values} set={set} tried={tried} terms={terms} />
      </Form>
    </div>
  )
}

/** The fields and the button, locked while the account is made, with what went wrong under them. */
function SignUpFields({
  values,
  set,
  tried,
  terms,
}: {
  values: SignUpValues
  set: (change: Partial<SignUpValues>) => void
  tried: boolean
  terms: ReactNode
}) {
  const status = useFormSubmission()?.status
  // Still busy once saved: the form leaves for the email screen as it was, spinner and all.
  const busy = status === 'saving' || status === 'saved'
  // Each check is the whole of it, so a press finds every problem; what shows
  // after the person leaves a field waits for a press to ask for an empty one.
  const check = (asked: boolean): Record<FieldName, string | null> => ({
    name: nameError(values.name, asked),
    email: emailError(values.email, asked),
    password: passwordError(values, asked),
    terms: termsError(values.agreed, asked),
  })
  const errors = check(true)
  const shown = check(tried)
  const [visits, setVisits] = useState<Partial<Record<FieldName, Visit>>>({})
  const visit = (name: FieldName, next: Visit) =>
    setVisits((last) => (last[name] === next ? last : { ...last, [name]: next }))
  // A field the person is editing hides its error, and one they left shows
  // it; until then, a press shows it.
  const checked = (name: FieldName) => ({
    name,
    validate: () => errors[name],
    invalid:
      visits[name] === 'editing'
        ? false
        : visits[name] === 'left' && shown[name]
          ? true
          : undefined,
    onInputCapture: () => visit(name, 'editing'),
    onChangeCapture: () => visit(name, 'editing'),
    onBlur: (event: FocusEvent<HTMLDivElement>) => {
      if (!event.currentTarget.contains(event.relatedTarget)) visit(name, 'left')
    },
  })
  return (
    <>
      <Field {...checked('name')}>
        <FieldLabel>Name</FieldLabel>
        <Input
          autoComplete='name'
          value={values.name}
          readOnly={busy}
          onValueChange={(name) => set({ name })}
        />
        <FieldError />
      </Field>
      <Field {...checked('email')}>
        <FieldLabel>Email</FieldLabel>
        <AuthEmailInput
          autoComplete='username'
          value={values.email}
          readOnly={busy}
          // Back from the email screen, the address is what needs fixing.
          data-autofocus=''
          onValueChange={(email) => set({ email })}
        />
        <FieldError />
      </Field>
      <Field {...checked('password')}>
        <FieldLabel>Password</FieldLabel>
        <PasswordInput
          autoComplete='new-password'
          value={values.password}
          readOnly={busy}
          onValueChange={(password) => set({ password })}
        />
        <PasswordStrength
          value={values.password}
          userInputs={userInputs(values)}
          rules={passwordRules(values)}
        />
        <FieldError />
      </Field>
      <Field {...checked('terms')}>
        <FieldLabel className='flex items-start gap-2.5 pb-0 text-sm leading-5 font-normal'>
          <Checkbox
            checked={values.agreed}
            readOnly={busy}
            className='mt-0.5'
            onCheckedChange={(agreed) => set({ agreed: agreed === true })}
          />
          <span className='text-muted-foreground'>{terms}</span>
        </FieldLabel>
        <FieldError className='ps-6.5' />
      </Field>
      <div className='flex flex-col'>
        <Button type='submit' loading={busy}>
          Create account
        </Button>
        <AuthMessage>
          {status === 'failed' ? signUpMessages['sign-up-failed'] : null}
        </AuthMessage>
      </div>
    </>
  )
}

export { SignUpForm }
