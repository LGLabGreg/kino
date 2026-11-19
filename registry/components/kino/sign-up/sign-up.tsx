'use client'

import { CheckEmail } from '@/registry/components/kino/sign-up/check-email'
import {
  SignUpContext,
  type SignUpSent,
} from '@/registry/components/kino/sign-up/sign-up-context'
import type { SignUpValues } from '@/registry/components/kino/sign-up/sign-up-flow'
import { SignUpForm } from '@/registry/components/kino/sign-up/sign-up-form'
import { SignUpSocial } from '@/registry/components/kino/sign-up/sign-up-social'
import { AuthDivider, type AuthHeading, AuthScreen } from '@/registry/lib/auth-screen'
import { type ReactNode, useCallback, useMemo, useState } from 'react'

/*
 * A sign-up screen, built from the ways in your app offers: a name, an email
 * and a password, and Google, GitHub and Apple, in any order, with
 * SignUpDivider between two. Once the account is made, the card asks the
 * person to check their email, and the form goes with it, as a password
 * manager expects before it offers to save the password. It shares the Sign
 * in block's screen, so the two read as one.
 *
 *   <SignUp footer={signInLink}>
 *     <SignUpForm onSignUp={createAccount} onResendEmail={resendLink} />
 *     <SignUpDivider />
 *     <SignUpSocial onSignUp={openProvider} />
 *   </SignUp>
 */

function SignUp({
  title = 'Create your account',
  description = 'It takes less than a minute.',
  footer,
  heading = 'h1',
  className,
  children,
}: {
  title?: string
  /** The title's level: the page's `h1` on a sign-up page, lower inside another page. */
  heading?: AuthHeading
  description?: ReactNode
  /** Under the card: a link to sign in. */
  footer?: ReactNode
  className?: string
  /** The ways in: SignUpForm, SignUpSocial and SignUpDivider. */
  children: ReactNode
}) {
  const [sent, setSent] = useState<SignUpSent | null>(null)
  // What the form held when it was sent, so it comes back filled.
  const [draft, setDraft] = useState<SignUpValues | null>(null)
  const created = useCallback((next: SignUpSent) => {
    setDraft(next.values)
    setSent(next)
  }, [])
  const context = useMemo(() => ({ created, draft }), [created, draft])

  return (
    <SignUpContext value={context}>
      <AuthScreen
        slot='sign-up'
        title={title}
        description={description}
        heading={heading}
        footer={footer}
        className={className}
        end={
          sent ? (
            <CheckEmail
              email={sent.values.email}
              onResend={sent.onResend}
              resendAfter={sent.resendAfter}
              onBack={() => setSent(null)}
              heading={heading}
            />
          ) : null
        }
      >
        {children}
      </AuthScreen>
    </SignUpContext>
  )
}

/** "or", between two ways in. */
function SignUpDivider({ children = 'or' }: { children?: ReactNode }) {
  return (
    <div className='flex flex-col pt-(--surface-gap)'>
      <AuthDivider>{children}</AuthDivider>
    </div>
  )
}

export { SignUp, SignUpDivider, SignUpForm, SignUpSocial }
export type { SignUpErrors } from '@/registry/components/kino/sign-up/sign-up-flow'
