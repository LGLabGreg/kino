'use client'

import { Button } from '@/registry/components/kino/button'
import {
  Field,
  FieldError,
  FieldLabel,
  Form,
  useFormSubmission,
} from '@/registry/components/kino/field'
import {
  AuthEmailInput,
  AuthMessage,
  looksLikeEmail,
  useFocusStep,
} from '@/registry/lib/auth-screen'
import { NoticeIcon } from '@/registry/lib/notice'
import { Swap } from '@/registry/lib/swap'
import { useRef, useState } from 'react'

import { cn } from '@/lib/utils'

/*
 * A form that signs an email address up for letters: the Footer's
 * newsletter and the Changelog's release emails. It lays out by its own
 * width, the button beside the box once there is room.
 */

/** What the newsletter says when the address is missing or doesn't read as one. */
function newsletterError(email: string): string | null {
  const address = email.trim()
  if (!address) return 'Enter your email address.'
  if (!looksLikeEmail(address)) return 'Enter an email address, like name@company.com.'
  return null
}

/**
 * The newsletter's form: an email box and a button, the box's label for
 * screen readers alone. While it sends, the button spins and a second press
 * does nothing; once it's done, the form gives way to a line that says where
 * the letters will go, as the Sign in's form gives way to its end, and a way
 * back to use another address. A failure says so under the box, and the address stays to try
 * again.
 */
function NewsletterForm({
  onSubscribe,
  submitLabel = 'Subscribe',
  className,
}: {
  /** Signs the address up. A throw or a rejected promise says it couldn't. */
  onSubscribe: (email: string) => unknown
  submitLabel?: string
  className?: string
}) {
  const [email, setEmail] = useState('')
  // The address last sent, so a failure shows only until the address changes.
  const [sent, setSent] = useState('')
  const triedRef = useRef(false)
  return (
    <Form
      data-slot='newsletter'
      className={cn('@container/newsletter min-w-0', className)}
      onSubmitCapture={() => {
        triedRef.current = true
      }}
      onFormSubmit={() => {
        setSent(email)
        return onSubscribe(email.trim())
      }}
    >
      <NewsletterFields
        email={email}
        sent={sent}
        setEmail={setEmail}
        triedRef={triedRef}
        submitLabel={submitLabel}
      />
    </Form>
  )
}

function NewsletterFields({
  email,
  sent,
  setEmail,
  triedRef,
  submitLabel,
}: {
  email: string
  sent: string
  setEmail: (email: string) => void
  triedRef: { current: boolean }
  submitLabel: string
}) {
  const submission = useFormSubmission()
  const status = submission?.status
  const done = status === 'saved'
  const failed = status === 'failed' && email === sent
  // The form that held focus goes: focus moves to the way back once the line arrives, and back to the box after.
  const focusRef = useFocusStep<HTMLDivElement>(done ? 'done' : 'form')
  return (
    <div ref={focusRef} className='min-w-0'>
      {/* There before the line arrives, so a screen reader reads it out. */}
      <p role='status' className='sr-only'>
        {done ? `You’re on the list. The next letter goes to ${email.trim()}.` : ''}
      </p>
      <Swap fill block wait id={done ? 'done' : 'form'}>
        {done ? (
          <div className='flex min-w-0 flex-col items-start gap-1'>
            <p className='flex min-w-0 items-start gap-2 text-sm leading-5'>
              <NoticeIcon type='success' />
              <span className='min-w-0 wrap-break-word'>
                You’re on the list. The next letter goes to{' '}
                <bdi dir='ltr' className='font-medium'>
                  {email.trim()}
                </bdi>
                .
              </span>
            </p>
            <Button
              data-autofocus=''
              type='button'
              variant='link'
              size='sm'
              className='text-muted-foreground hover:text-foreground h-auto min-h-6 px-0 ps-6 font-normal'
              onClick={() => {
                triedRef.current = false
                setEmail('')
                submission?.reset()
              }}
            >
              Use another email
            </Button>
          </div>
        ) : (
          <div className='flex w-full min-w-0 flex-col'>
            <Field
              name='email'
              validate={() => (triedRef.current ? newsletterError(email) : null)}
              className='w-full'
            >
              <FieldLabel className='sr-only'>Email</FieldLabel>
              {/* 21rem: room for the box and the button side by side, the width a 24rem footer leaves it. */}
              <div className='flex min-w-0 flex-col gap-2 [grid-area:control] @[21rem]/newsletter:flex-row [&>[data-slot=input-group]]:flex-1'>
                <AuthEmailInput
                  data-autofocus=''
                  autoComplete='email'
                  value={email}
                  readOnly={status === 'saving'}
                  onValueChange={setEmail}
                />
                <Button type='submit' loading={status === 'saving'} className='shrink-0'>
                  {submitLabel}
                </Button>
              </div>
              <FieldError />
            </Field>
            {/* The list couldn't be reached: nothing is wrong with the address, so it says so away from the box, as the Sign up does. */}
            <AuthMessage>
              {failed ? 'We couldn’t sign you up just now. Try again in a moment.' : null}
            </AuthMessage>
          </div>
        )}
      </Swap>
    </div>
  )
}

export { NewsletterForm, newsletterError }
