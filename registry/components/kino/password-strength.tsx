'use client'

import { CheckboxMark } from '@/registry/components/kino/checkbox'
import { Meter, MeterLabel, MeterValue } from '@/registry/components/kino/meter'
import { useAnnouncer } from '@/registry/lib/announce'
import { choiceMarkBoxClassName } from '@/registry/lib/choice'
import { graphemes, Swap } from '@/registry/lib/swap'
import { FieldDescription, useFieldControl } from '@ui-sdk/react/field'
import { type ComponentProps, type ReactNode, useEffect, useRef } from 'react'

import { cn } from '@/lib/utils'

/** A rule the password must meet, ticked while `met` returns true. */
type PasswordRule = {
  label: ReactNode
  met: (password: string) => boolean
}

/** How long typing has to pause before the strength is read out, in milliseconds. */
const ANNOUNCE_WAIT = 1000

/*
 * How strong a new password is while it is typed: the Meter's bar under the
 * password box, the level in words, and the rules the form asks for, each
 * ticked as it is met. Weak warns in red, Fair in amber, and Good and Strong
 * are green. A screen reader hears the level once typing pauses, and the
 * rules describe the box inside a Field.
 */
function PasswordStrength({
  className,
  value,
  userInputs,
  score,
  rules,
  label = 'Password strength',
  levels = ['Weak', 'Fair', 'Good', 'Strong'],
  emptyLabel = 'Nothing typed yet',
  metLabel = 'Done',
  ...props
}: Omit<ComponentProps<'div'>, 'children'> & {
  /** The password as it is typed. */
  value: string
  /** What the person typed elsewhere, such as their name and email, and your product's name: a password built on them is weaker. */
  userInputs?: readonly string[]
  /** Your own score from 0 to 4, such as zxcvbn's, in place of Kino's estimate. */
  score?: number
  /** The rules the form asks for, listed under the bar. */
  rules?: readonly PasswordRule[]
  /** Names the meter, and starts what a screen reader hears. */
  label?: string
  /** The words for each level, weakest first. */
  levels?: readonly [string, string, string, string]
  /** What a screen reader hears for the level while the box is empty. */
  emptyLabel?: string
  /** Read after a rule that is met. */
  metLabel?: string
}) {
  const level = value
    ? strengthLevel(score ?? estimatePasswordScore(value, userInputs))
    : null
  const word = level === null ? null : levels[level]

  const { announce, region } = useAnnouncer()
  const announced = useRef(word)
  const said = `${label}: ${word ?? emptyLabel}`
  useEffect(() => {
    if (announced.current === word) return undefined
    const timer = setTimeout(() => {
      announced.current = word
      announce(said)
    }, ANNOUNCE_WAIT)
    return () => clearTimeout(timer)
  })

  const inField = useFieldControl() !== null
  const rulesClassName = 'flex flex-col gap-1.5 text-xs'
  const ruleItems = rules?.map((rule, index) => {
    const met = rule.met(value)
    return (
      <li
        key={index}
        data-slot='password-strength-rule'
        data-met={met || undefined}
        className='text-muted-foreground data-met:text-foreground flex items-start gap-2 leading-4 transition-colors duration-(--motion-press-duration) ease-(--motion-press-fade-easing)'
      >
        <span
          aria-hidden
          data-checked={met || undefined}
          className={cn(choiceMarkBoxClassName, 'group/checkbox')}
        >
          <CheckboxMark />
        </span>
        <span className='min-w-0 [overflow-wrap:anywhere]'>
          {rule.label}
          {met ? <span className='sr-only'>, {metLabel}</span> : null}
        </span>
      </li>
    )
  })

  return (
    <div
      data-slot='password-strength'
      data-level={level ?? undefined}
      className={cn(
        'group/password-strength flex min-w-0 flex-col gap-3 pt-3 [grid-area:detail] data-[level=1]:**:data-[slot=meter-indicator]:bg-warning data-[level=2]:**:data-[slot=meter-indicator]:bg-success data-[level=3]:**:data-[slot=meter-indicator]:bg-success',
        className,
      )}
      {...props}
    >
      <Meter
        value={level === null ? 0 : level + 1}
        max={4}
        low={2}
        getAriaValueText={() => word ?? emptyLabel}
      >
        <MeterLabel className='text-muted-foreground text-xs font-normal'>
          {label}
        </MeterLabel>
        <MeterValue className='group-data-[level=1]/password-strength:text-warning-foreground group-data-[level=2]/password-strength:text-success-foreground group-data-[level=3]/password-strength:text-success-foreground text-xs font-medium'>
          {() => (
            <Swap roll align='end'>
              {word ?? ''}
            </Swap>
          )}
        </MeterValue>
      </Meter>
      {rules?.length ? (
        inField ? (
          // In a Field, the rules describe its password box.
          <FieldDescription render={<ul />} className={rulesClassName}>
            {ruleItems}
          </FieldDescription>
        ) : (
          <ul data-slot='password-strength-rules' className={rulesClassName}>
            {ruleItems}
          </ul>
        )
      ) : null}
      {region}
    </div>
  )
}

/** A 0 to 4 score, zxcvbn's scale, as a level: 0 and 1 are Weak, then Fair, Good and Strong. */
function strengthLevel(score: number): 0 | 1 | 2 | 3 {
  if (score >= 4) return 3
  if (score >= 3) return 2
  if (score >= 2) return 1
  return 0
}

/*
 * Passwords and words that are guessed first. Each counts as one guess from a
 * short list, wherever it sits in a password, after look-alike characters
 * are read as letters ("p@ssw0rd" is "password").
 */
const COMMON_WORDS = [
  'password',
  'passwort',
  '1q2w3e4r5t6y',
  '1q2w3e4r',
  'q1w2e3r4',
  '1qaz2wsx3edc',
  '1qaz2wsx',
  'qazwsxedcrfv',
  'qazwsxedc',
  'zaq12wsx',
  'qazwsx',
  'qweasd',
  'basketball',
  'letmein',
  'welcome',
  'admin',
  'login',
  'master',
  'secret',
  'changeme',
  'default',
  'iloveyou',
  'trustno',
  'monkey',
  'dragon',
  'shadow',
  'sunshine',
  'princess',
  'football',
  'baseball',
  'soccer',
  'hockey',
  'superman',
  'batman',
  'starwars',
  'pokemon',
  'minecraft',
  'freedom',
  'whatever',
  'hello',
  'qwerty',
  'azerty',
  'qwertz',
  'asdf',
  'zxcv',
  'abc',
  'love',
  'angel',
  'cookie',
  'cheese',
  'chicken',
  'banana',
  'orange',
  'purple',
  'summer',
  'winter',
  'spring',
  'autumn',
  'flower',
  'hunter',
  'ranger',
  'killer',
  'charlie',
  'michael',
  'jennifer',
  'jordan',
  'thomas',
  'robert',
  'daniel',
  'jessica',
  'ashley',
  'pepper',
  'ginger',
  'maggie',
  'tigger',
  'buster',
  'matrix',
  'computer',
  'internet',
  'money',
  'guest',
  'user',
  'test',
  'root',
  'god',
  'access',
  'mustang',
  'harley',
  'ninja',
  'blink',
] as const

const KEYBOARD_ROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm', '1234567890'] as const

const LOOK_ALIKES: Record<string, string> = {
  '0': 'o',
  '1': 'i',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '7': 't',
  '@': 'a',
  $: 's',
  '!': 'i',
}

/** Each character in lower case, one for one, so places in the result are places in the password. */
function lowerChars(text: string) {
  return graphemes(text).map((char) => {
    const lower = char.toLowerCase()
    return graphemes(lower).length === 1 ? lower : char
  })
}

/** The password in lower case, with look-alike characters read as the letters they stand for. */
function readAsLetters(text: string) {
  return lowerChars(text).map((char) => LOOK_ALIKES[char] ?? char)
}

/** Whether `a` then `b` repeat or step through the alphabet, the digits or a keyboard row. */
function follows(a: string, b: string) {
  if (a === b) return true
  const step = b.charCodeAt(0) - a.charCodeAt(0)
  if ((step === 1 || step === -1) && /[a-z\d]/.test(a + b)) return true
  return KEYBOARD_ROWS.some((row) => {
    const at = row.indexOf(a)
    return at !== -1 && (row[at + 1] === b || row[at - 1] === b)
  })
}

/** The words of three letters or more in what the person typed elsewhere, read as `readAsLetters` reads a password. */
function ownWords(userInputs: readonly string[]) {
  return userInputs
    .flatMap((input) => input.split(/[^\p{L}\p{N}]+/u))
    .filter((part) => graphemes(part).length >= 3)
    .map((part) => readAsLetters(part).join(''))
}

/**
 * Whether the password holds a word of three letters or more from what the
 * person typed elsewhere, such as their name, their email or the product's
 * name, with look-alikes read as letters ("M@yaCh3n" holds "maya").
 */
function usesUserInputs(password: string, userInputs: readonly string[]) {
  const read = readAsLetters(password).join('')
  return ownWords(userInputs).some((word) => read.includes(word))
}

/** What a character no pattern explains costs a guesser, in bits: one of ten, as zxcvbn counts it, so mixing in capitals and symbols earns nothing on its own. */
const CHAR_BITS = Math.log2(10)

/**
 * About how many bits a guesser has to get through, in the way zxcvbn counts
 * them but much smaller: a known word or one of the person's own counts as
 * one pick from a short list, a run that repeats or steps (`aaaa`, `1234`,
 * `qwer`) or a year as a handful of guesses, and every other character as
 * `CHAR_BITS`.
 */
function passwordBits(password: string, userInputs: readonly string[] = []) {
  // Runs are read as typed, so "123456" steps rather than reading as letters.
  const typed = lowerChars(password)
  const read = readAsLetters(password).join('')
  const counted = typed.map(() => false)
  let bits = 0

  const own = ownWords(userInputs)
  const words = [
    ...own.map((word) => ({ word, bits: 4 })),
    ...COMMON_WORDS.map((word) => ({ word, bits: 8 })),
  ]
  // Longest first, so "password" is found before "pass" could be.
  words.sort((a, b) => b.word.length - a.word.length)
  // A block typed again ("elephantelephant") costs its first copy and a guess at how many times.
  const asTyped = typed.join('')
  const repeats = /(.{3,})\1+/gu
  for (let match = repeats.exec(asTyped); match; match = repeats.exec(asTyped)) {
    const start = graphemes(asTyped.slice(0, match.index)).length
    const copy = graphemes(match[1]!).length
    const all = graphemes(match[0]).length
    counted.fill(true, start + copy, start + all)
    bits += Math.log2(all / copy)
  }

  // Words are found with look-alikes read as letters, and as typed, for keyboard walks such as "1q2w3e4r".
  for (const { word, bits: wordBits } of words) {
    for (const text of [read, asTyped]) {
      let from = text.indexOf(word)
      while (from !== -1) {
        const span = graphemes(text.slice(0, from)).length
        const length = graphemes(word).length
        if (!counted.slice(span, span + length).some(Boolean)) {
          counted.fill(true, span, span + length)
          bits += wordBits
        }
        from = text.indexOf(word, from + 1)
      }
    }
  }

  // Years as typed, since look-alikes would read "2026" as "2o26".
  const years = /(?:19|20)\d\d/g
  for (let match = years.exec(asTyped); match; match = years.exec(asTyped)) {
    const span = graphemes(asTyped.slice(0, match.index)).length
    if (!counted.slice(span, span + 4).some(Boolean)) {
      counted.fill(true, span, span + 4)
      bits += 7
    }
  }

  let index = 0
  while (index < typed.length) {
    if (counted[index]) {
      index += 1
      continue
    }
    let end = index + 1
    while (end < typed.length && !counted[end] && follows(typed[end - 1]!, typed[end]!)) {
      end += 1
    }
    const run = end - index
    // A run of three or more is one guess of where it starts and how long it is.
    bits += run >= 3 ? CHAR_BITS + Math.log2(run) : run * CHAR_BITS
    index = end
  }
  return bits
}

/**
 * Kino's estimate of how hard the password is to guess, on zxcvbn's 0 to 4
 * scale. Length counts most: a password under 8 characters is never more than
 * 1, under 10 never more than 2, and under 12 never more than 3.
 */
function estimatePasswordScore(password: string, userInputs: readonly string[] = []) {
  if (!password) return 0
  const bits = passwordBits(password, userInputs)
  const length = graphemes(password).length
  // zxcvbn's bounds: 10^3, 10^6, 10^8 and 10^10 guesses.
  let score = bits < 10 ? 0 : bits < 20 ? 1 : bits < 26.6 ? 2 : bits < 33.2 ? 3 : 4
  if (length < 8) score = Math.min(score, 1)
  else if (length < 10) score = Math.min(score, 2)
  else if (length < 12) score = Math.min(score, 3)
  return score
}

/**
 * Whether the password is one that's guessed first: a known word or keyboard
 * walk with at most digits and symbols around it ("Password1!", "1q2w3e4r"),
 * only repeats and steps ("aaaaaa", "123456", "qwerty"), or one of those
 * typed again ("qwertyqwerty").
 */
function isCommonPassword(password: string): boolean {
  const lower = lowerChars(password).join('')
  if (!lower) return false
  // As typed, and with digits and symbols taken off its ends ("qwertyuiop123").
  const core = lower.replace(/^[\d\W_]+|[\d\W_]+$/gu, '')
  const known = COMMON_WORDS as readonly string[]
  for (const text of [lower, core]) {
    const chars = graphemes(text)
    if (chars.length === 0) continue
    if (chars.every((char, index) => index === 0 || follows(chars[index - 1]!, char))) {
      return true
    }
    if (known.includes(text) || known.includes(readAsLetters(text).join(''))) return true
  }
  // A known password typed more than once, in any case, such as "Passwordpassword".
  const block = /^(.{3,}?)\1+$/u.exec(core || lower)
  return block ? isCommonPassword(block[1]!) : false
}

export {
  PasswordStrength,
  estimatePasswordScore,
  isCommonPassword,
  strengthLevel,
  usesUserInputs,
}
export type { PasswordRule }
