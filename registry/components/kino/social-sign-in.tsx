'use client'

import { Badge } from '@/registry/components/kino/badge'
import { Button } from '@/registry/components/kino/button'
import {
  Tooltip,
  TooltipContent,
  TooltipGroup,
  TooltipTrigger,
} from '@/registry/components/kino/tooltip'
import { useControllable } from '@/registry/lib/controllable'
import { settle } from '@/registry/lib/settle'
import { flattenChildren } from '@/registry/lib/swap'
import {
  type ComponentProps,
  type ComponentType,
  createContext,
  isValidElement,
  type MouseEvent,
  type ReactNode,
  use,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
} from 'react'

import { cn } from '@/lib/utils'

/*
 * Buttons that sign a person in with another account, each with its
 * provider's logo: full width in a stack, or logos alone in a row. A press
 * runs `onSignIn`; the button shows the Button's spinner while the provider
 * opens and the others wait, so two sign-ins never run at once. A sign-in
 * that fails, or a page restored with Back, goes back to rest. Given
 * `lastUsed`, the provider the person signed in with last comes first,
 * marked Last used.
 */

const providers = {
  google: { name: 'Google', Logo: GoogleLogo },
  github: { name: 'GitHub', Logo: GitHubLogo },
  apple: { name: 'Apple', Logo: AppleLogo },
} satisfies Record<string, { name: string; Logo: ComponentType<{ className?: string }> }>

type SocialProvider = keyof typeof providers

type SocialSignInLayout = 'stack' | 'row'

interface SocialSignInContextValue {
  layout: SocialSignInLayout
  pending: SocialProvider | null
  disabled: boolean
  lastUsed: SocialProvider | null
  lastUsedLabel: string
  start: (provider: SocialProvider) => void
}

const SocialSignInContext = createContext<SocialSignInContextValue | null>(null)

/**
 * The children, fragments opened, with the button for `lastUsed` first, so it
 * leads in reading and focus order too.
 */
function lastUsedFirst(
  children: ReactNode,
  lastUsed: SocialProvider | null,
): ReactNode[] {
  const items = flattenChildren(children)
  const index = items.findIndex(
    (item) =>
      isValidElement<{ provider?: unknown }>(item) && item.props.provider === lastUsed,
  )
  if (index <= 0) return items
  return [items[index], ...items.slice(0, index), ...items.slice(index + 1)]
}

function SocialSignIn({
  layout = 'stack',
  pending: pendingProp,
  defaultPending = null,
  onPendingChange,
  onSignIn,
  disabled = false,
  lastUsed = null,
  lastUsedLabel = 'Last used',
  className,
  children,
  ...props
}: ComponentProps<'div'> & {
  /** `stack`: full-width buttons with their labels. `row`: the logos alone, side by side. */
  layout?: SocialSignInLayout
  /** The provider that is opening, or null. */
  pending?: SocialProvider | null
  defaultPending?: SocialProvider | null
  onPendingChange?: (pending: SocialProvider | null) => void
  /**
   * Opens the provider. The button stays busy until the page moves on; a
   * throw or a rejected promise puts it back to rest.
   */
  onSignIn?: (provider: SocialProvider) => unknown
  disabled?: boolean
  /** The provider this person signed in with last time, which comes first. */
  lastUsed?: SocialProvider | null
  lastUsedLabel?: string
}) {
  const [pending, change] = useControllable(pendingProp, defaultPending, onPendingChange)
  // A sign-in settles after renders that have moved on, so it ends with the latest setter.
  const latestChange = useRef(change)
  useLayoutEffect(() => {
    latestChange.current = change
  })

  const start = (provider: SocialProvider) => {
    if (pending || disabled) return
    change(provider)
    settle(
      () => onSignIn?.(provider),
      (ok) => {
        if (!ok) latestChange.current(null)
      },
    )
  }

  // Back from the provider can bring the page out of the browser's cache as
  // it was left, busy; it opens at rest instead.
  useEffect(() => {
    const restore = (event: PageTransitionEvent) => {
      if (event.persisted) change(null)
    }
    window.addEventListener('pageshow', restore)
    return () => window.removeEventListener('pageshow', restore)
  })

  const group = (
    <div
      data-slot='social-sign-in'
      data-layout={layout}
      role='group'
      className={cn(
        'flex w-full',
        layout === 'stack' ? 'flex-col gap-2' : 'flex-row gap-2',
        className,
      )}
      {...props}
    >
      {lastUsedFirst(children, lastUsed)}
    </div>
  )

  return (
    <SocialSignInContext
      value={{ layout, pending, disabled, lastUsed, lastUsedLabel, start }}
    >
      {layout === 'row' ? <TooltipGroup>{group}</TooltipGroup> : group}
    </SocialSignInContext>
  )
}

function SocialSignInButton({
  provider,
  children,
  disabled,
  onClick,
  className,
  ...props
}: Omit<
  ComponentProps<typeof Button>,
  'children' | 'loading' | 'variant' | 'size' | 'onClick'
> & {
  provider: SocialProvider
  /** The label. Defaults to "Continue with" and the provider's name. */
  children?: string
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void
}) {
  const group = use(SocialSignInContext)
  const badgeId = useId()
  const { name, Logo } = providers[provider]
  const last = group?.lastUsed === provider
  const label = children ?? `Continue with ${name}`
  const pending = group?.pending ?? null
  const busy = pending === provider
  const press = (event: MouseEvent<HTMLButtonElement>) => {
    onClick?.(event)
    if (!event.defaultPrevented) group?.start(provider)
  }
  const shared = {
    'data-slot': 'social-sign-in-button',
    'data-provider': provider,
    variant: 'outline',
    loading: busy,
    disabled: disabled || group?.disabled || (pending !== null && !busy),
    onClick: press,
    ...(last ? { 'aria-describedby': badgeId } : {}),
    ...props,
  } as const
  // On the button's top edge at the end, over its border, as a tab on a folder;
  // in a row it rises further, clear of the logo in a short icon button.
  const badge = last ? (
    // Read once, as the button's description.
    <Badge
      id={badgeId}
      aria-hidden
      className='pointer-events-none absolute -top-2.5 end-2 z-10 in-data-[layout=row]:-top-3.5 transition-opacity duration-(--motion-press-duration) ease-(--motion-press-easing)'
    >
      {group?.lastUsedLabel}
    </Badge>
  ) : null

  // The button and its badge press as one, so the badge stays on its edge.
  // While the button waits on another provider, or is disabled, the badge
  // fades out: the hint means nothing then, and faded text would read as
  // too faint. `className` lays the pair out in the group.
  const item = cn(
    'relative flex transition-[scale] duration-(--motion-press-duration) ease-(--motion-press-easing) has-[[data-slot=social-sign-in-button]:active]:duration-[calc(var(--motion-press-duration)*0.4)] motion-safe:has-[[data-slot=social-sign-in-button]:active]:scale-[calc(1_-_(1_-_var(--motion-press-scale))_*_var(--social-sign-in-press-depth,1))] has-[[data-slot=social-sign-in-button][data-disabled]:not([data-loading])]:[&>[data-slot=badge]]:opacity-0',
    group?.layout === 'row'
      ? 'min-w-(--button-height) flex-1 [--social-sign-in-press-depth:2.5]'
      : 'w-full',
    className,
  )

  if (group?.layout === 'row') {
    return (
      <div data-slot='social-sign-in-item' className={item}>
        <Tooltip>
          <TooltipTrigger
            {...(last ? { 'aria-describedby': badgeId } : {})}
            render={
              <Button
                {...shared}
                size='icon'
                aria-label={label}
                className='w-full [--button-press-depth:0]'
              >
                <Logo />
              </Button>
            }
          />
          {/* Above the badge, which rises 14px over the button's edge. */}
          <TooltipContent sideOffset={last ? 20 : undefined}>{label}</TooltipContent>
        </Tooltip>
        {badge}
      </div>
    )
  }

  return (
    <div data-slot='social-sign-in-item' className={item}>
      <Button {...shared} className='w-full [--button-press-depth:0]'>
        <Logo data-icon='inline-start' />
        {label}
      </Button>
      {badge}
    </div>
  )
}

/*
 * Each provider's mark, drawn as its brand asks: Google's G in its four
 * colours, and GitHub's and Apple's marks in the text colour, so they follow
 * light and dark. Sized by the Button, as an icon is, and decorative: the
 * label or the tooltip names the provider. Paths: Google's G from its own
 * sign-in button script, GitHub's mark from Octicons (MIT), Apple's from
 * Simple Icons (CC0).
 */

type LogoProps = Omit<ComponentProps<'svg'>, 'children' | 'viewBox'>

function GoogleLogo({ className, ...props }: LogoProps) {
  return (
    <svg
      data-slot='social-sign-in-logo'
      viewBox='0 0 48 48'
      aria-hidden
      // Google's G is only ever in its own four colours, under forced colours too.
      className={cn('forced-color-adjust-none', className)}
      {...props}
    >
      <path
        fill='#EA4335'
        d='M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z'
      />
      <path
        fill='#4285F4'
        d='M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z'
      />
      <path
        fill='#FBBC05'
        d='M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z'
      />
      <path
        fill='#34A853'
        d='M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z'
      />
    </svg>
  )
}

function GitHubLogo({ className, ...props }: LogoProps) {
  return (
    <svg
      data-slot='social-sign-in-logo'
      viewBox='0 0 24 24'
      fill='currentColor'
      aria-hidden
      className={className}
      {...props}
    >
      <path d='M10.226 17.284c-2.965-.36-5.054-2.493-5.054-5.256 0-1.123.404-2.336 1.078-3.144-.292-.741-.247-2.314.09-2.965.898-.112 2.111.36 2.83 1.01.853-.269 1.752-.404 2.853-.404 1.1 0 1.999.135 2.807.382.696-.629 1.932-1.1 2.83-.988.315.606.36 2.179.067 2.942.72.854 1.101 2 1.101 3.167 0 2.763-2.089 4.852-5.098 5.234.763.494 1.28 1.572 1.28 2.807v2.336c0 .674.561 1.056 1.235.786 4.066-1.55 7.255-5.615 7.255-10.646C23.5 6.188 18.334 1 11.978 1 5.62 1 .5 6.188.5 12.545c0 4.986 3.167 9.12 7.435 10.669.606.225 1.19-.18 1.19-.786V20.63a2.9 2.9 0 0 1-1.078.224c-1.483 0-2.359-.808-2.987-2.313-.247-.607-.517-.966-1.034-1.033-.27-.023-.359-.135-.359-.27 0-.27.45-.471.898-.471.652 0 1.213.404 1.797 1.235.45.651.921.943 1.483.943.561 0 .92-.202 1.437-.719.382-.381.674-.718.944-.943' />
    </svg>
  )
}

function AppleLogo({ className, ...props }: LogoProps) {
  return (
    <svg
      data-slot='social-sign-in-logo'
      viewBox='0 0 24 24'
      fill='currentColor'
      aria-hidden
      className={className}
      {...props}
    >
      <path d='M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701' />
    </svg>
  )
}

export { providers, SocialSignIn, SocialSignInButton }
export { lastUsedFirst }
export type { SocialProvider, SocialSignInLayout }
