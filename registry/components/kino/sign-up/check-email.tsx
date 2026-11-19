'use client'

import { Button } from '@/registry/components/kino/button'
import { signUpMessages } from '@/registry/components/kino/sign-up/sign-up-flow'
import { IconPlaceholder } from '@/registry/icons/icon-placeholder'
import {
  AuthEnd,
  type AuthHeading,
  AuthMessage,
  AuthResend,
  useCountdown,
} from '@/registry/lib/auth-screen'
import { settle } from '@/registry/lib/settle'
import { useState } from 'react'

/*
 * Once the account is made: where the link went, a resend once the wait is
 * over, and a way back to the form to fix the address, with everything
 * typed still there. It says the same whether or not the email already had
 * an account, so the form never tells anyone who has signed up.
 */

function CheckEmail({
  email,
  onResend,
  resendAfter,
  onBack,
  heading,
}: {
  email: string
  /** Emails the link again. A throw or a rejected promise says it couldn't. */
  onResend?: (email: string) => unknown
  /** Seconds before another email can go. */
  resendAfter: number
  /** Back to the form, to use another address. */
  onBack: () => void
  heading?: AuthHeading
}) {
  const [sent, setSent] = useState(0)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const countdown = useCountdown(sent, resendAfter)

  const resend = () =>
    new Promise<boolean>((resolve) => {
      setBusy(true)
      setFailed(false)
      settle(
        () => onResend?.(email),
        (ok) => {
          setBusy(false)
          if (ok) setSent((count) => count + 1)
          else setFailed(true)
          resolve(ok)
        },
      )
    })

  return (
    <AuthEnd
      heading={heading}
      title='Check your email'
      description={
        <>
          We sent a link to <span className='text-foreground font-medium'>{email}</span>.
          Open it to finish creating your account.
        </>
      }
      icon={
        <IconPlaceholder
          lucide='MailIcon'
          tabler='IconMail'
          hugeicons='Mail01Icon'
          phosphor='EnvelopeSimpleIcon'
          remixicon='RiMailLine'
          aria-hidden
        />
      }
    >
      <div className='flex flex-col items-center'>
        <AuthResend
          className='justify-center'
          left={countdown.left}
          busy={busy}
          onResend={resend}
          sent={`We sent another link to ${email}.`}
        >
          Resend email
        </AuthResend>
        <AuthMessage>{failed ? signUpMessages['resend-failed'] : null}</AuthMessage>
        <Button
          type='button'
          variant='link'
          size='sm'
          className='text-muted-foreground hover:text-foreground h-auto min-h-6 px-0 font-normal'
          onClick={onBack}
        >
          Use a different email
        </Button>
      </div>
    </AuthEnd>
  )
}

export { CheckEmail }
