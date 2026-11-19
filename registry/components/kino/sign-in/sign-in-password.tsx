'use client'

import { Button } from '@/registry/components/kino/button'
import { Form } from '@/registry/components/kino/field'
import { useSignInFlow } from '@/registry/components/kino/sign-in/sign-in-flow'
import {
  EmailField,
  PasswordField,
  SignInFold,
  useSignedIn,
  useSignInFocus,
  useSignInPart,
} from '@/registry/components/kino/sign-in/sign-in-parts'
import { looksLikeEmail } from '@/registry/lib/auth-screen'
import { Swap } from '@/registry/lib/swap'
import { type FormEvent, useId } from 'react'

/*
 * Signing in with an email and a password, both on screen in one form with a
 * real submit button, so a password manager fills the two at once and can
 * sign the person straight in. Forgot password sends a reset link to the
 * email above it, and the step that says so grows under the email in place
 * of the password, while the other ways in fold away.
 */

function SignInPassword({
  onSignIn,
  onResetPassword,
  defaultEmail,
}: {
  /** Checks the password; `true` signs in. A throw or a rejected promise says the server couldn't be reached. */
  onSignIn?: (email: string, password: string) => boolean | Promise<boolean>
  /** Emails a link to choose a new password. */
  onResetPassword?: (email: string) => unknown
  /** The email it opens with, such as the one the person signed in with last. */
  defaultEmail?: string
}) {
  const signedIn = useSignedIn()
  const flow = useSignInFlow(
    { onPasswordSignIn: onSignIn, onResetPassword, onSignedIn: signedIn },
    { start: { email: defaultEmail } },
  )
  const { hidden } = useSignInPart(flow.step !== 'email')
  const focusRef = useSignInFocus<HTMLFormElement>(flow.step, flow.error)
  const id = useId()
  const resetting = flow.step === 'reset'

  return (
    <SignInFold hidden={hidden} moved={flow.step !== 'email'}>
      <Form
        ref={focusRef}
        className='flex flex-col'
        onSubmit={(event: FormEvent<HTMLFormElement>) => {
          event.preventDefault()
          const password = new FormData(event.currentTarget).get('password')
          void flow.signInWithPassword(typeof password === 'string' ? password : '')
        }}
      >
        <EmailField
          flow={flow}
          readOnly={resetting}
          // Back from a reset with the email filled, the password is what's left.
          focusFirst={!resetting && !looksLikeEmail(flow.email)}
        />
        <Swap fill block wait id={resetting ? 'reset' : 'password'}>
          <div className='flex w-full min-w-0 flex-col gap-(--surface-gap) pt-(--surface-gap)'>
            {resetting ? (
              <>
                <p id={`${id}-reset`} className='text-muted-foreground text-sm'>
                  If this email has an account, a link to choose a new password is on its
                  way. It works for 30 minutes.
                </p>
                <Button
                  type='button'
                  variant='outline'
                  data-autofocus=''
                  aria-describedby={`${id}-reset`}
                  onClick={() => flow.goTo('email')}
                >
                  Back to sign in
                </Button>
              </>
            ) : (
              <>
                <PasswordField flow={flow} />
                <Button type='submit' loading={flow.busy === 'password'}>
                  Sign in
                </Button>
              </>
            )}
          </div>
        </Swap>
      </Form>
    </SignInFold>
  )
}

export { SignInPassword }
