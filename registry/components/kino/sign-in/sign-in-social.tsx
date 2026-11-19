'use client'

import {
  SignInFold,
  useSignInPart,
} from '@/registry/components/kino/sign-in/sign-in-parts'
import type {
  SocialProvider,
  SocialSignInLayout,
} from '@/registry/components/kino/social-sign-in'
import { AuthSocial } from '@/registry/lib/auth-screen'

/*
 * Signing in with an account the person already has: Google, GitHub or Apple,
 * with the one they used last first. A press opens the provider; one that
 * can't be reached goes back to rest and says so under the buttons. It folds
 * away while another way in is on its next step.
 */

function SignInSocial({
  onSignIn,
  lastUsed,
  layout,
}: {
  /** Opens the provider's sign-in. A throw or a rejected promise says it couldn't be reached. */
  onSignIn?: (provider: SocialProvider) => unknown
  /** The provider this person signed in with last, which leads. */
  lastUsed?: SocialProvider
  /** `stack`: full-width buttons with their names. `row`: the logos alone, side by side. */
  layout?: SocialSignInLayout
}) {
  const { hidden } = useSignInPart(false)
  return (
    <SignInFold hidden={hidden}>
      <AuthSocial
        label='Sign in with Google, GitHub or Apple'
        onOpen={onSignIn}
        lastUsed={lastUsed}
        layout={layout}
      />
    </SignInFold>
  )
}

export { SignInSocial }
