'use client'

import { Button } from '@/registry/components/kino/button'
import {
  type CodeCheck,
  useSignInFlow,
} from '@/registry/components/kino/sign-in/sign-in-flow'
import {
  ChangeEmail,
  CodeField,
  EmailField,
  ResendCode,
  SignInFold,
  useCodeSubmit,
  useSignedIn,
  useSignInFocus,
  useSignInPart,
} from '@/registry/components/kino/sign-in/sign-in-parts'
import { Swap } from '@/registry/lib/swap'
import type { FormEvent } from 'react'

/*
 * Signing in with no password: the person gives their email, a 6-digit code
 * goes to it, and the code signs them in. The email stays where it was
 * typed, read-only with Change beside it, and the code grows out from under
 * it while the other ways in fold away. A wrong code empties the boxes, an
 * expired one can be replaced at once, and a new code can go once the wait
 * is over.
 */

function SignInCode({
  onSendCode,
  onVerifyCode,
  resendAfter,
  defaultEmail,
  defaultStep,
  defaultError,
}: {
  /** Emails a sign-in code. A throw or a rejected promise says it couldn't be sent. */
  onSendCode?: (email: string) => unknown
  /** Checks a code against the last one sent. */
  onVerifyCode?: (email: string, code: string) => CodeCheck | Promise<CodeCheck>
  /** Seconds before another code can be sent. */
  resendAfter?: number
  defaultEmail?: string
  /** `code` opens on the boxes, such as from a link in the email that carried the code. */
  defaultStep?: 'email' | 'code'
  /** Opens with the code refused, such as a link whose code has expired. */
  defaultError?: 'wrong-code' | 'expired-code'
}) {
  const signedIn = useSignedIn()
  const flow = useSignInFlow(
    { onSendCode, onVerifyCode, onSignedIn: signedIn },
    {
      start: { step: defaultStep, email: defaultEmail, error: defaultError },
      resendAfter,
    },
  )
  const { hidden } = useSignInPart(flow.step !== 'email')
  const focusRef = useSignInFocus<HTMLFormElement>(flow.step, flow.error)
  const submitCode = useCodeSubmit(flow)

  const submitEmail = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void flow.continueWithEmail(flow.email)
  }

  return (
    <SignInFold hidden={hidden} moved={flow.step !== 'email'}>
      {/* A plain form: Base UI's would check the boxes' pattern on every change once
          the email has been sent, in the browser's words. The sign-in checks the code. */}
      <form
        ref={focusRef}
        noValidate
        className='flex flex-col'
        onSubmit={submitEmail}
        // The code is checked before the form's own check runs.
        onSubmitCapture={flow.step === 'email' ? undefined : submitCode}
      >
        <EmailField
          flow={flow}
          readOnly={flow.step !== 'email'}
          end={<ChangeEmail flow={flow} shown={flow.step !== 'email'} />}
        />
        <Swap fill block wait id={flow.step === 'email' ? 'email' : 'code'}>
          <div className='flex w-full min-w-0 flex-col gap-(--surface-gap) pt-(--surface-gap)'>
            {flow.step === 'email' ? (
              <Button type='submit' loading={flow.busy === 'send'}>
                Email me a code
              </Button>
            ) : (
              <>
                <CodeField
                  flow={flow}
                  description='We emailed you a 6-digit code. It works for 10 minutes.'
                />
                <Button type='submit' loading={flow.busy === 'code'}>
                  Sign in
                </Button>
                <ResendCode flow={flow} />
              </>
            )}
          </div>
        </Swap>
      </form>
    </SignInFold>
  )
}

export { SignInCode }
