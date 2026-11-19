'use client'

import { SignInCode } from '@/registry/components/kino/sign-in/sign-in-code'
import { nextActive } from '@/registry/components/kino/sign-in/sign-in-flow'
import {
  SignedIn,
  SignInContext,
  SignInFold,
  useSignInPart,
} from '@/registry/components/kino/sign-in/sign-in-parts'
import { SignInPassword } from '@/registry/components/kino/sign-in/sign-in-password'
import { SignInSocial } from '@/registry/components/kino/sign-in/sign-in-social'
import { AuthDivider, AuthScreen, type AuthHeading } from '@/registry/lib/auth-screen'
import { type ReactNode, useCallback, useLayoutEffect, useRef, useState } from 'react'

import { cn } from '@/lib/utils'

/*
 * A sign-in screen, built from the ways in your app offers: a password, a
 * code by email, Google, GitHub and Apple, in any order, with SignInDivider
 * between two. When one moves on (a code sent, a reset link sent), the
 * others fold away under it and come back with it. Once the person is in,
 * the card gives way to the signed-in screen and the forms go with it, as a
 * password manager expects.
 *
 *   <SignIn onSignedIn={openApp}>
 *     <SignInPassword onSignIn={checkPassword} onResetPassword={sendResetLink} />
 *     <SignInDivider />
 *     <SignInSocial onSignIn={openProvider} lastUsed='github' />
 *   </SignIn>
 */

function SignIn({
  title = 'Sign in',
  description = 'Welcome back. Pick up where you left off.',
  footer,
  heading = 'h1',
  onSignedIn,
  className,
  children,
}: {
  title?: string
  /** The title's level: the page's `h1` on a sign-in page, lower inside another page. */
  heading?: AuthHeading
  description?: ReactNode
  /** Under the card: a link to sign up, or your terms. */
  footer?: ReactNode
  /** Runs once the person is in, with their email: open the app. */
  onSignedIn?: (email: string) => void
  className?: string
  /** The ways in: SignInPassword, SignInCode, SignInSocial and SignInDivider. */
  children: ReactNode
}) {
  const [active, setActive] = useState<string | null>(null)
  const [signedInAs, setSignedInAs] = useState<string | null>(null)
  const latest = useRef(onSignedIn)
  useLayoutEffect(() => {
    latest.current = onSignedIn
  })
  // Once the person is in, the form leaves as it was: nothing folds inside it on its way out.
  const done = useRef(false)
  const setMoved = useCallback((part: string, moved: boolean) => {
    if (!done.current) setActive((now) => nextActive(now, part, moved))
  }, [])
  const signedIn = useCallback((email: string) => {
    done.current = true
    setSignedInAs(email)
    latest.current?.(email)
  }, [])

  return (
    <SignInContext value={{ active, setMoved, signedIn }}>
      <AuthScreen
        slot='sign-in'
        title={title}
        description={description}
        heading={heading}
        footer={footer}
        end={
          signedInAs === null ? null : <SignedIn email={signedInAs} heading={heading} />
        }
        className={cn(
          // Until React runs, a part that opened on its next step folds the
          // others itself, so a page from the server never shows them for a moment.
          'not-data-mounted:[&:has([data-slot=sign-in-fold][data-moved])_[data-slot=sign-in-fold]:not([data-moved])]:hidden',
          className,
        )}
      >
        {children}
      </AuthScreen>
    </SignInContext>
  )
}

/** "or", between two ways in. It folds away with the others when one moves on. */
function SignInDivider({ children = 'or' }: { children?: ReactNode }) {
  const { hidden } = useSignInPart(false)
  return (
    <SignInFold hidden={hidden}>
      <AuthDivider>{children}</AuthDivider>
    </SignInFold>
  )
}

export { SignIn, SignInCode, SignInDivider, SignInPassword, SignInSocial }
export type { CodeCheck } from '@/registry/components/kino/sign-in/sign-in-flow'
