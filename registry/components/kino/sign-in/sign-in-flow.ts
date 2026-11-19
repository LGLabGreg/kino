'use client'

import { looksLikeEmail, useCountdown } from '@/registry/lib/auth-screen'
import { settle } from '@/registry/lib/settle'
import { useLayoutEffect, useRef, useState } from 'react'

/*
 * What the sign-in does, apart from how it looks: which step it is on, the
 * email it is for, what is running and what went wrong. Each step that
 * waits on the server stays where it is until the answer comes, and an
 * answer that comes after the person has moved on is dropped.
 */

type SignInStep = 'email' | 'code' | 'reset' | 'done'

/** What the server says of a code: `ok` signs in. */
type CodeCheck = 'ok' | 'wrong' | 'expired'

type SignInError =
  | 'invalid-email'
  | 'send-failed'
  | 'incomplete-code'
  | 'wrong-code'
  | 'expired-code'
  | 'check-failed'
  | 'missing-password'
  | 'wrong-password'
  | 'sign-in-failed'
  | 'reset-failed'

type SignInBusy = 'send' | 'resend' | 'code' | 'password' | 'reset'

interface SignInHandlers {
  /** Emails a sign-in code. A throw or a rejected promise says it couldn't. */
  onSendCode?: (email: string) => unknown
  /** Checks a code against the last one sent. */
  onVerifyCode?: (email: string, code: string) => CodeCheck | Promise<CodeCheck>
  /** Checks a password; `true` signs in. */
  onPasswordSignIn?: (email: string, password: string) => boolean | Promise<boolean>
  /** Emails a link to choose a new password. */
  onResetPassword?: (email: string) => unknown
  /** Runs once the person is signed in, to open the app. */
  onSignedIn?: (email: string) => void
}

/** Where the sign-in opens: a link from an email can open on the code step, or with its code expired. */
interface SignInStart {
  step?: SignInStep
  email?: string
  error?: SignInError | null
}

interface SignInState {
  step: SignInStep
  email: string
  error: SignInError | null
  busy: SignInBusy | null
  /** Counts the codes sent, so the wait before another starts again with each. */
  sent: number
}

/** The state on `step`, with nothing running and nothing wrong. */
function moveTo(state: SignInState, step: SignInStep): SignInState {
  return { ...state, step, error: null, busy: null }
}

/**
 * Which part the others give way to, once `part` says whether it has moved
 * past its first step: the first to move holds it, and only it can let go.
 */
function nextActive(active: string | null, part: string, moved: boolean) {
  if (moved) return active ?? part
  return active === part ? null : active
}

function useSignInFlow(
  handlers: SignInHandlers,
  { start, resendAfter = 30 }: { start?: SignInStart; resendAfter?: number } = {},
) {
  const [state, setState] = useState<SignInState>(() => ({
    step: start?.step ?? 'email',
    email: start?.email ?? '',
    error: start?.error ?? null,
    busy: null,
    sent: 0,
  }))
  const latest = useRef({ state, handlers })
  useLayoutEffect(() => {
    latest.current = { state, handlers }
  })

  // A code that has already expired can be replaced at once.
  const countdown = useCountdown(
    state.sent,
    resendAfter,
    start?.error === 'expired-code' ? 0 : resendAfter,
  )

  // Each request takes a number; its answer is used only while it is the latest.
  const run = useRef(0)
  /**
   * Runs a handler, marked `busy` while it does, and resolves with whether it
   * worked and what it gave back, or with null once the person has moved on.
   */
  const request = <Value>(busy: SignInBusy, action: () => Value | Promise<Value>) => {
    run.current += 1
    const mine = run.current
    setState((now) => ({ ...now, busy, error: null }))
    return new Promise<{ ok: boolean; value?: Value } | null>((resolve) => {
      settle(action, (ok, _waited, _reason, value) =>
        resolve(run.current === mine ? { ok, value } : null),
      )
    })
  }
  const fail = (error: SignInError) => setState((now) => ({ ...now, busy: null, error }))
  const invalid = (email: string) => {
    if (looksLikeEmail(email)) return false
    setState((now) => ({ ...now, email, error: 'invalid-email' }))
    return true
  }

  const send = async (email: string, busy: 'send' | 'resend') => {
    const answer = await request(busy, () => latest.current.handlers.onSendCode?.(email))
    if (!answer) return false
    if (!answer.ok) {
      fail('send-failed')
      return false
    }
    setState((now) => ({
      // The code step is for the address the code went to.
      ...(busy === 'send' ? moveTo({ ...now, email }, 'code') : now),
      busy: null,
      error: null,
      sent: now.sent + 1,
    }))
    return true
  }

  const signedIn = (email: string) => {
    // Still busy: the form leaves for the signed-in screen as it was, spinner and all.
    setState((now) => ({ ...now, step: 'done', error: null }))
    latest.current.handlers.onSignedIn?.(email)
  }

  return {
    ...state,
    /** Seconds before another code can be sent. */
    resendIn: countdown.left,
    setEmail: (email: string) => setState((now) => ({ ...now, email, error: null })),
    /** Sends a code to `email` and moves to the code step once it's sent. */
    continueWithEmail: (email: string) =>
      invalid(email) ? Promise.resolve(false) : send(email.trim(), 'send'),
    sendNewCode: () => send(latest.current.state.email.trim(), 'resend'),
    verifyCode: async (code: string) => {
      const { email } = latest.current.state
      const answer = await request('code', () =>
        latest.current.handlers.onVerifyCode?.(email, code),
      )
      if (!answer) return undefined
      if (!answer.ok) fail('check-failed')
      else if (answer.value === 'ok') signedIn(email)
      else {
        if (answer.value === 'expired') countdown.end()
        fail(answer.value === 'expired' ? 'expired-code' : 'wrong-code')
      }
      return answer.ok ? answer.value : undefined
    },
    /** Signs in with `password`; an empty one is asked for without a trip to the server. */
    signInWithPassword: async (password: string) => {
      const { email } = latest.current.state
      if (invalid(email)) return
      if (!password) {
        fail('missing-password')
        return
      }
      const answer = await request('password', () =>
        latest.current.handlers.onPasswordSignIn?.(email, password),
      )
      if (!answer) return
      if (!answer.ok) fail('sign-in-failed')
      else if (answer.value) signedIn(email)
      else fail('wrong-password')
    },
    resetPassword: async () => {
      const { email } = latest.current.state
      if (invalid(email)) return
      const answer = await request('reset', () =>
        latest.current.handlers.onResetPassword?.(email),
      )
      if (!answer) return
      if (answer.ok) setState((now) => moveTo(now, 'reset'))
      else fail('reset-failed')
    },
    /** Refuses a code typed in part, without a trip to the server. */
    refuseCode: () => fail('incomplete-code'),
    /** Goes to another step at once, dropping anything still running. */
    goTo: (step: SignInStep) => {
      run.current += 1
      setState((now) => moveTo(now, step))
    },
    clearError: () => setState((now) => (now.error ? { ...now, error: null } : now)),
  }
}

type SignInFlow = ReturnType<typeof useSignInFlow>

/** What each error says. None of them tells whether an account exists for the email. */
const signInMessages: Record<SignInError, string> = {
  'invalid-email': 'Enter your email address, such as maya@kinoui.com.',
  'send-failed': 'We couldn’t send a code just now. Try again in a moment.',
  'incomplete-code': 'Enter the 6-digit code from the email.',
  'wrong-code': 'That code doesn’t match. Check the latest email from us.',
  'expired-code': 'That code has expired. Send a new one to carry on.',
  'check-failed': 'We couldn’t check that code just now. Try again in a moment.',
  'missing-password': 'Enter your password.',
  'wrong-password':
    'That email and password don’t match. Try again, or reset your password.',
  'sign-in-failed': 'We couldn’t sign you in just now. Try again in a moment.',
  'reset-failed': 'We couldn’t send a reset link just now. Try again in a moment.',
}

export { signInMessages, useSignInFlow }
export { nextActive }
export type {
  CodeCheck,
  SignInBusy,
  SignInError,
  SignInFlow,
  SignInHandlers,
  SignInStart,
  SignInState,
  SignInStep,
}
