'use client'

import type { SignUpValues } from '@/registry/components/kino/sign-up/sign-up-flow'
import { createContext, use } from 'react'

/*
 * How the sign-up's form tells the screen the account is made, and gets
 * back what it held when the person comes back to fix the address.
 */

/** An account just made: what was sent, and how to send its email again. */
interface SignUpSent {
  values: SignUpValues
  onResend?: (email: string) => unknown
  /** Seconds before another email can go. */
  resendAfter: number
}

interface SignUpContextValue {
  /** Shows the check-your-email screen. */
  created: (sent: SignUpSent) => void
  /** What the form held when it was last sent, or null. */
  draft: SignUpValues | null
}

const SignUpContext = createContext<SignUpContextValue | null>(null)

function useSignUp() {
  return use(SignUpContext)
}

export { SignUpContext, useSignUp }
export type { SignUpContextValue, SignUpSent }
