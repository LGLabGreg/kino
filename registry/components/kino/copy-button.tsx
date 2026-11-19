'use client'

import { Button } from '@/registry/components/kino/button'
import {
  Tooltip,
  TooltipContent,
  type TooltipContentProps,
  TooltipTrigger,
} from '@/registry/components/kino/tooltip'
import { IconPlaceholder } from '@/registry/icons/icon-placeholder'
import { useAnnouncer } from '@/registry/lib/announce'
import { useRender } from '@base-ui/react/use-render'
import {
  type ComponentProps,
  type ReactElement,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from 'react'

type CopyStatus = 'idle' | 'copied' | 'failed'

/** What goes on the clipboard: the text, or a function read at the press that returns it or a promise of it. */
type CopyValue = string | (() => string | Promise<string>)

/*
 * A Button that copies a value. Its icon rolls to a tick, its label changes to
 * "Copied", a status region says so, and after `timeout` it goes back. An
 * icon-only one is named in a tooltip, which says how the copy went.
 */
function CopyButton({
  value,
  timeout = 2000,
  icon,
  copiedLabel = 'Copied',
  failedLabel = 'Couldn’t copy',
  tooltipProps,
  render,
  variant,
  size,
  children = 'Copy',
  onClick,
  'aria-label': ariaLabel,
  ...props
}: Omit<ComponentProps<typeof Button>, 'value' | 'render'> & {
  /**
   * What goes on the clipboard. A function is read at the press, for text that
   * is only on the page; it may return a promise, for text it has to fetch.
   */
  value: CopyValue
  /** How long the result shows before the button goes back, in ms. `Infinity` keeps it. */
  timeout?: number
  /** The icon at rest, in place of the copy icon. */
  icon?: ReactNode
  copiedLabel?: string
  failedLabel?: string
  /** An icon-only button's tooltip; its text is the button's `aria-label`, then the result. */
  tooltipProps?: Omit<TooltipContentProps, 'children'>
  /**
   * The button to render in place of the Button, such as a `ToolbarButton` or
   * a `SplitButtonAction`. Its own props win over the Copy button's.
   */
  render?: ReactElement
}) {
  const [status, setStatus] = useState<CopyStatus>('idle')
  const [waiting, setWaiting] = useState(false)
  const { announce, region } = useAnnouncer()
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])

  const copy = async (event: Parameters<NonNullable<typeof onClick>>[0]) => {
    onClick?.(event)
    const result = await copyText(value, () => setWaiting(true))
    clearTimeout(timer.current)
    setWaiting(false)
    setStatus(result)
    announce(result === 'copied' ? copiedLabel : failedLabel)
    if (Number.isFinite(timeout)) {
      timer.current = setTimeout(() => setStatus('idle'), timeout)
    }
  }

  const iconOnly = size?.startsWith('icon') ?? false
  const name = ariaLabel ?? 'Copy'
  // Each result is its own span, so the Button's swap rolls from one to the next.
  const shownIcon = (
    <span key={status} data-icon='inline-start' className='flex'>
      {status === 'copied' ? (
        <IconPlaceholder
          lucide='CheckIcon'
          tabler='IconCheck'
          hugeicons='Tick02Icon'
          phosphor='CheckIcon'
          remixicon='RiCheckLine'
          aria-hidden
        />
      ) : status === 'failed' ? (
        <IconPlaceholder
          lucide='CircleAlertIcon'
          tabler='IconAlertCircle'
          hugeicons='AlertCircleIcon'
          phosphor='WarningCircleIcon'
          remixicon='RiErrorWarningLine'
          className='text-destructive'
          aria-hidden
        />
      ) : (
        (icon ?? (
          <IconPlaceholder
            lucide='CopyIcon'
            tabler='IconCopy'
            hugeicons='Copy01Icon'
            phosphor='CopyIcon'
            remixicon='RiFileCopyLine'
            aria-hidden
          />
        ))
      )}
    </span>
  )
  const result =
    status === 'copied' ? copiedLabel : status === 'failed' ? failedLabel : undefined

  const button = useRender({
    render: render ?? <Button />,
    props: {
      // A rendered button keeps its own slot, such as `split-button-action`;
      // an icon size's takes the tooltip trigger's, as any button in a Tooltip does.
      ...(render ? null : { 'data-slot': 'copy-button' }),
      'data-copied': status === 'copied' ? '' : undefined,
      'data-failed': status === 'failed' ? '' : undefined,
      // A rendered button keeps its own look unless one is asked for, as a
      // Split button's action takes the group's.
      ...(variant || !render ? { variant: variant ?? 'ghost' } : null),
      ...(size ? { size } : null),
      ...(waiting ? { loading: true } : null),
      'aria-label': iconOnly ? name : ariaLabel,
      onClick: copy,
      ...props,
      children: iconOnly ? (
        shownIcon
      ) : (
        <>
          {shownIcon}
          {result ?? children}
        </>
      ),
    },
  })

  if (iconOnly) {
    return (
      <>
        <Tooltip>
          {/* It stays open on the press, so the tooltip can say how it went. */}
          <TooltipTrigger closeOnClick={false} render={button} />
          <TooltipContent {...tooltipProps}>{result ?? name}</TooltipContent>
        </Tooltip>
        {region}
      </>
    )
  }

  return (
    <>
      {button}
      {region}
    </>
  )
}

/**
 * Puts `value` on the clipboard. Where the Clipboard API is missing or refuses,
 * as on plain http or in an iframe without `clipboard-write`, it copies a
 * selection instead. A value that throws or rejects, or a browser that refuses
 * every way, is a failure. `onWait` runs when the value is a promise.
 */
async function copyText(
  value: CopyValue,
  onWait?: () => void,
): Promise<'copied' | 'failed'> {
  let read: string | Promise<string>
  try {
    read = typeof value === 'function' ? value() : value
  } catch {
    return 'failed'
  }
  let text: string
  if (typeof read === 'string') {
    text = read
  } else {
    onWait?.()
    // Safari allows a write only inside the press, so the text goes in as a
    // promise; the browser waits for it.
    if (await writeLater(read)) return 'copied'
    try {
      text = await read
    } catch {
      return 'failed'
    }
  }
  try {
    await navigator.clipboard.writeText(text)
    return 'copied'
  } catch {
    return copyBySelection(text) ? 'copied' : 'failed'
  }
}

/** Writes text that is still on its way, where the browser takes a `ClipboardItem`. */
async function writeLater(text: Promise<string>): Promise<boolean> {
  if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) return false
  try {
    await navigator.clipboard.write([
      new ClipboardItem({
        'text/plain': text.then((done) => new Blob([done], { type: 'text/plain' })),
      }),
    ])
    return true
  } catch {
    return false
  }
}

/** The older way to copy: select the text in a hidden box and ask the browser to copy it. */
function copyBySelection(text: string): boolean {
  if (typeof document === 'undefined') return false
  const focused = document.activeElement
  const box = document.createElement('textarea')
  box.value = text
  box.setAttribute('readonly', '')
  box.setAttribute('aria-hidden', 'true')
  box.style.cssText = 'position:fixed;inset-block-start:0;opacity:0;pointer-events:none'
  document.body.append(box)
  box.select()
  let copied: boolean
  try {
    // Deprecated, but still the only way to copy where the Clipboard API is refused.
    copied = document.execCommand('copy')
  } catch {
    copied = false
  }
  box.remove()
  if (focused instanceof HTMLElement) focused.focus({ preventScroll: true })
  return copied
}

export { CopyButton }

export { copyText }
