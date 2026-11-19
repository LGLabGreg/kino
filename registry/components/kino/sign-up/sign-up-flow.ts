import {
  estimatePasswordScore,
  type PasswordRule,
  usesUserInputs,
} from '@/registry/components/kino/password-strength'
import { looksLikeEmail } from '@/registry/lib/auth-screen'
import { graphemes } from '@/registry/lib/swap'

/*
 * What the sign-up checks, apart from how it looks: each field's rule and
 * what it says when the rule isn't met. An empty field is asked for only
 * once the person has tried to create the account, so tabbing through the
 * form never fills it with errors.
 */

/** Your product's name: a password built on it is easy to guess. */
const PRODUCT_NAME = 'Kino'

/** How long a password has to be: 15 characters where a password alone signs in (NIST SP 800-63B). */
const MIN_PASSWORD_LENGTH = 15

/** What the person has typed so far. */
interface SignUpValues {
  name: string
  email: string
  password: string
  agreed: boolean
}

/** What your server refuses, by field, such as a password found in a breach. */
type SignUpErrors = Partial<Record<'name' | 'email' | 'password', string>>

/** What the person typed that a password shouldn't be built on, with your product's name. */
function userInputs({ name, email }: Pick<SignUpValues, 'name' | 'email'>) {
  return [name, email, PRODUCT_NAME].filter(Boolean)
}

/** The rules a new password must meet, listed under it and ticked as they're met. */
function passwordRules(values: Pick<SignUpValues, 'name' | 'email'>): PasswordRule[] {
  const inputs = userInputs(values)
  return [
    {
      label: `${MIN_PASSWORD_LENGTH} characters or more`,
      met: (password) => graphemes(password).length >= MIN_PASSWORD_LENGTH,
    },
    {
      label: `Doesn’t use your name, your email or ${PRODUCT_NAME}`,
      met: (password) => password.length > 0 && !usesUserInputs(password, inputs),
    },
  ]
}

const signUpMessages = {
  'missing-name': 'Enter your name.',
  'missing-email': 'Enter your email address.',
  'invalid-email': 'Enter an email address, such as maya@kinoui.com.',
  'missing-password': 'Choose a password.',
  'password-rules': 'Meet every rule above to create your account.',
  'weak-password': 'It’s still easy to guess. Add a word or two.',
  'missing-terms': 'Agree to the terms to create your account.',
  'sign-up-failed': 'We couldn’t create your account just now. Try again in a moment.',
  'resend-failed': 'We couldn’t send another email just now. Try again in a moment.',
} as const

/** What's wrong with the name, or null; an empty one only once the person has `tried`. */
function nameError(name: string, tried: boolean) {
  return !name.trim() && tried ? signUpMessages['missing-name'] : null
}

/** What's wrong with the email, or null; an empty one only once the person has `tried`. */
function emailError(email: string, tried: boolean) {
  if (!email.trim()) return tried ? signUpMessages['missing-email'] : null
  return looksLikeEmail(email) ? null : signUpMessages['invalid-email']
}

/**
 * What's wrong with the password, or null: an empty one once the person has
 * `tried`, then a rule not met, then one that's still easy to guess.
 */
function passwordError(values: Omit<SignUpValues, 'agreed'>, tried: boolean) {
  const { password } = values
  if (!password) return tried ? signUpMessages['missing-password'] : null
  if (!passwordRules(values).every((rule) => rule.met(password))) {
    return signUpMessages['password-rules']
  }
  return estimatePasswordScore(password, userInputs(values)) < 2
    ? signUpMessages['weak-password']
    : null
}

/** What's wrong with the terms, or null; asked for only once the person has `tried`. */
function termsError(agreed: boolean, tried: boolean) {
  return !agreed && tried ? signUpMessages['missing-terms'] : null
}

export {
  emailError,
  nameError,
  passwordError,
  passwordRules,
  signUpMessages,
  termsError,
  userInputs,
}
export type { SignUpErrors, SignUpValues }
