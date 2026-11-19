'use client'

import type {
  SocialProvider,
  SocialSignInLayout,
} from '@/registry/components/kino/social-sign-in'
import { AuthSocial } from '@/registry/lib/auth-screen'

/*
 * Signing up with an account the person already has: Google, GitHub or
 * Apple. A press opens the provider, which makes the account on its way
 * back; one that can't be reached goes back to rest and says so under the
 * buttons.
 */

function SignUpSocial({
  onSignUp,
  layout,
}: {
  /** Opens the provider's sign-up. A throw or a rejected promise says it couldn't be reached. */
  onSignUp?: (provider: SocialProvider) => unknown
  /** `stack`: full-width buttons with their names. `row`: the logos alone, side by side. */
  layout?: SocialSignInLayout
}) {
  return (
    <div className='flex flex-col pt-(--surface-gap)'>
      <AuthSocial
        label='Sign up with Google, GitHub or Apple'
        onOpen={onSignUp}
        layout={layout}
      />
    </div>
  )
}

export { SignUpSocial }
