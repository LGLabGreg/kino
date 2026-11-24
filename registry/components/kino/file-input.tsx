'use client'

import { Alert, AlertDescription, AlertTitle } from '@/registry/components/kino/alert'
import { Button, buttonVariants } from '@/registry/components/kino/button'
import { Collapsible, CollapsibleContent } from '@/registry/components/kino/collapsible'
import { emptyVariants } from '@/registry/components/kino/empty'
import { InputInvalidIcon, inputBoxClassName } from '@/registry/components/kino/input'
import { Progress } from '@/registry/components/kino/progress'
import { IconPlaceholder } from '@/registry/icons/icon-placeholder'
import { useAnnouncer } from '@/registry/lib/announce'
import { useLocale } from '@/registry/lib/dates'
import { FieldValues, FieldWiring, OutsideField } from '@/registry/lib/field-control'
import { useFlow } from '@/registry/lib/flow'
import { formatFileSize } from '@/registry/lib/number-format'
import { markMounted, mergeRefs } from '@/registry/lib/refs'
import { transitionsSettled } from '@/registry/lib/resize'
import { Swap, SwapText } from '@/registry/lib/swap'
import {
  rowProgress,
  type SavedFile,
  savedFileOf,
  savedValueOf,
  settledAnnouncement,
  type Upload,
  type UploadFile,
  type UploadOptions,
  type UploadSummary,
  useUploads,
} from '@/registry/lib/uploads'
import { Field as FieldPrimitive } from '@base-ui/react/field'
import { useFieldRootContext } from '@base-ui/react/internals/field-root-context'
import { mergeProps } from '@base-ui/react/merge-props'
import { useRender } from '@base-ui/react/use-render'
import type { VariantProps } from 'class-variance-authority'
import {
  type ClipboardEvent,
  type ComponentProps,
  createContext,
  type DragEvent,
  type MouseEvent,
  type ReactNode,
  type RefObject,
  use,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { flushSync } from 'react-dom'

import { cn } from '@/lib/utils'

/*
 * Files picked, dropped or pasted, checked against what the field takes, and
 * listed with their progress. One native `<input type="file">` holds them, so
 * a form submits them and a Field labels and describes them as it does any
 * control. A row that arrives rises into place, and one that leaves fades
 * where it was while the rows below close its gap (`followFlow`).
 *
 * Files come in through a drop target: `FileInputDropzone`, an area of its
 * own in the Empty state's outlined look, or `FileInputBox`, a box the size
 * of a text field for a form where a file is one answer among others.
 */

/** Why a file wasn't added. */
type FileRejectionReason = 'type' | 'size' | 'count' | 'duplicate'

interface FileRejection {
  file: File
  reason: FileRejectionReason
}

interface FileRules {
  /** What it takes, as the native `accept`: MIME types (`image/*`) and extensions (`.pdf`), comma separated. */
  accept?: string
  /** The largest file it takes, in bytes. */
  maxSize?: number
  /** How many files it holds at most. */
  maxFiles?: number
  /** Whether it holds more than one file. One that doesn't swaps its file for the next. */
  multiple?: boolean
}

function acceptRules(accept: string | undefined) {
  return (accept ?? '')
    .split(',')
    .map((rule) => rule.trim().toLowerCase())
    .filter(Boolean)
}

function matchesType(type: string, rule: string) {
  if (rule.endsWith('/*')) return type.startsWith(rule.slice(0, -1))
  return type === rule
}

/** Whether `accept` takes a file of this name and MIME type, as the browser's picker would. */
function acceptsFile(file: { name: string; type: string }, accept: string | undefined) {
  const rules = acceptRules(accept)
  if (rules.length === 0) return true
  const name = file.name.toLowerCase()
  const type = file.type.toLowerCase()
  return rules.some((rule) =>
    rule.startsWith('.') ? name.endsWith(rule) : matchesType(type, rule),
  )
}

/**
 * What a drop of files of these MIME types would do, while they are still
 * being dragged: names aren't known until the drop, and Safari gives no types
 * at all, so `unknown` means the drop has to tell.
 */
function dragVerdict(
  types: readonly string[],
  accept: string | undefined,
): 'accept' | 'reject' | 'unknown' {
  const rules = acceptRules(accept)
  if (rules.length === 0) return 'accept'
  if (types.length === 0) return 'unknown'
  const byName = rules.some((rule) => rule.startsWith('.'))
  let unknown = false
  for (const type of types) {
    if (rules.some((rule) => !rule.startsWith('.') && matchesType(type, rule)))
      return 'accept'
    if (!type || byName) unknown = true
  }
  return unknown ? 'unknown' : 'reject'
}

/** The same file picked twice: same name, size and time it was last changed. */
function sameFile(a: File, b: File) {
  return a.name === b.name && a.size === b.size && a.lastModified === b.lastModified
}

interface FilesAdded {
  /** The files after the change. */
  value: File[]
  added: File[]
  /** Files it held that the change took out: a single file swapped for another. */
  removed: File[]
  rejected: FileRejection[]
}

/**
 * Adds `incoming` to `value` under `rules`: each file is checked for its
 * type, then its size, then whether it is already there, then whether there
 * is room. One that holds a single file swaps it for the first that passes.
 */
function addFiles(
  value: readonly File[],
  incoming: readonly File[],
  { accept, maxSize, maxFiles, multiple = true }: FileRules,
): FilesAdded {
  const single = !multiple || maxFiles === 1
  const limit = single ? 1 : (maxFiles ?? Number.POSITIVE_INFINITY)
  const next = single ? [] : [...value]
  const added: File[] = []
  const rejected: FileRejection[] = []
  for (const file of incoming) {
    let reason: FileRejectionReason | undefined
    if (!acceptsFile(file, accept)) reason = 'type'
    else if (maxSize !== undefined && file.size > maxSize) reason = 'size'
    else if (next.some((held) => sameFile(held, file))) reason = 'duplicate'
    else if (next.length >= limit) reason = 'count'
    if (reason) rejected.push({ file, reason })
    else {
      next.push(file)
      added.push(file)
    }
  }
  if (single && added.length === 0)
    return { value: [...value], added, removed: [], rejected }
  const removed = single ? value.filter((held) => !next.includes(held)) : []
  return { value: next, added, removed, rejected }
}

const TYPE_NAMES: Record<string, string> = {
  'image/*': 'images',
  'video/*': 'videos',
  'audio/*': 'audio',
  'text/*': 'text files',
  'application/pdf': 'PDF',
  'image/jpeg': 'JPG',
  'image/svg+xml': 'SVG',
  'image/webp': 'WebP',
  'text/plain': 'TXT',
  'text/csv': 'CSV',
  'application/zip': 'ZIP',
}

/** The names of the types `accept` takes, deduplicated: `image/jpeg,.jpg` is one JPG. */
function typeNames(accept: string | undefined): string[] {
  const names = (accept ?? '')
    .split(',')
    .map((rule) => rule.trim().toLowerCase())
    .filter(Boolean)
    .map((rule) => {
      if (TYPE_NAMES[rule]) return TYPE_NAMES[rule]
      if (rule.startsWith('.'))
        return rule === '.jpeg' ? 'JPG' : rule.slice(1).toUpperCase()
      const subtype = rule.split('/')[1] ?? rule
      return subtype.split(/[.+-]/).pop()!.toUpperCase()
    })
  return [...new Set(names)]
}

/** “PDF, PNG or SVG”: the types `accept` takes, as a list a person reads. */
function typesText(accept: string | undefined, locale?: string) {
  const names = typeNames(accept)
  if (names.length === 0) return ''
  return new Intl.ListFormat(locale, { type: 'disjunction' }).format(names)
}

function capitalize(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/** The limits, stated up front: “PDF, PNG or SVG · Up to 50 MB each · 20 files at most”. */
function limitsText({ accept, maxSize, maxFiles, multiple }: FileRules, locale?: string) {
  const one = multiple === false || maxFiles === 1
  return [
    typesText(accept, locale),
    maxSize === undefined
      ? ''
      : `up to ${formatFileSize(maxSize, locale)}${one ? '' : ' each'}`,
    maxFiles === undefined || one ? '' : `${maxFiles} files at most`,
  ]
    .filter(Boolean)
    .map(capitalize)
    .join(' · ')
}

/** Why a file wasn't added, in a few words. */
function rejectionText(rejection: FileRejection, rules: FileRules, locale?: string) {
  switch (rejection.reason) {
    case 'type': {
      const types = typesText(rules.accept, locale)
      return types ? `Only ${types}` : 'This type isn’t taken'
    }
    case 'size':
      return rules.maxSize === undefined
        ? 'Too large'
        : `${formatFileSize(rejection.file.size, locale)}, over ${formatFileSize(rules.maxSize, locale)}`
    case 'duplicate':
      return 'Already in the list'
    case 'count':
      if (rules.multiple === false || rules.maxFiles === 1)
        return 'Only one file goes here'
      return rules.maxFiles === undefined
        ? 'Too many files'
        : `Over the ${rules.maxFiles}-file limit`
  }
}

/** The title of the files turned away: “brief.key wasn’t added”, or “3 files weren’t added”. */
function rejectedTitle(rejected: readonly FileRejection[]) {
  if (rejected.length === 1) return `${rejected[0].file.name} wasn’t added`
  return `${rejected.length} files weren’t added`
}

/** The batch's line while it runs: “2 of 5 uploaded · 12 of 20 MB”. */
function progressText(summary: UploadSummary, locale?: string) {
  return `${summary.done} of ${summary.count} uploaded · ${formatFileSize(summary.loaded, locale)} of ${formatFileSize(summary.total, locale)}`
}

/** The batch's line once nothing is left uploading: “5 files uploaded · 20 MB”, or what failed. */
function settledText(summary: UploadSummary, locale?: string) {
  const files = (count: number) => (count === 1 ? '1 file' : `${count} files`)
  if (summary.failed === 0)
    return `${files(summary.done)} uploaded · ${formatFileSize(summary.total, locale)}`
  if (summary.done === 0)
    return summary.failed === 1 ? 'The upload failed' : `${files(summary.failed)} failed`
  return `${summary.done} uploaded · ${summary.failed} failed`
}

/** The line for files that go with the form: “3 files · 4.2 MB”. */
function heldText(summary: UploadSummary, locale?: string) {
  const files = summary.count === 1 ? '1 file' : `${summary.count} files`
  return `${files} · ${formatFileSize(summary.total, locale)}`
}

/** The field's error while files that failed hold its form back. */
function failedMessage(failed: number) {
  return failed === 1
    ? '1 file couldn’t be uploaded. Retry it or remove it.'
    : `${failed} files couldn’t be uploaded. Retry them or remove them.`
}

/** What is said while a submit waits for the uploads. */
function waitingText(active: number) {
  return active === 1
    ? 'Sending once the last file is up'
    : `Sending once ${active} files are up`
}

/** What the status says: the batch going up, how it went, or the files that go with the form. */
type StatusState = 'empty' | 'held' | 'uploading' | 'waiting' | 'failed' | 'done'

function statusState(
  summary: UploadSummary,
  uploading: boolean,
  waiting: boolean,
): StatusState {
  if (summary.count === 0) return 'empty'
  if (summary.active > 0) return waiting ? 'waiting' : 'uploading'
  if (!uploading || summary.done + summary.failed < summary.count) return 'held'
  return summary.failed > 0 ? 'failed' : 'done'
}

/** What a screen reader hears when uploads are cancelled, and other files taken out with them. */
function cancelAnnouncement(stopped: readonly File[], others: number) {
  const cancelled =
    stopped.length === 1
      ? `Upload of ${stopped[0].name} cancelled`
      : `${stopped.length} uploads cancelled`
  return others > 0 ? `${cancelled}, ${others} more removed` : cancelled
}

/** What a screen reader hears after files come or go. */
function announcement(added: readonly File[], removed: readonly File[]) {
  if (added.length === 1 && removed.length === 1)
    return `${added[0].name} replaced ${removed[0].name}`
  if (added.length > 1) return `${added.length} files added`
  if (added.length === 1) return `${added[0].name} added`
  if (removed.length > 1) return `${removed.length} files removed`
  if (removed.length === 1) return `${removed[0].name} removed`
  return ''
}

const fileKeys = new WeakMap<File, string>()
let fileCount = 0

/** A key that stays with a `File` object for as long as it lives. */
function fileKey(file: File) {
  let key = fileKeys.get(file)
  if (!key) {
    fileCount += 1
    key = `file-${fileCount}`
    fileKeys.set(file, key)
  }
  return key
}

interface FileInputContextValue extends FileRules {
  files: readonly File[]
  add: (files: readonly File[]) => void
  remove: (file: File) => void
  /** Whether files upload as they're added, rather than going with the form. */
  uploading: boolean
  /** Each file's upload. */
  uploads: ReadonlyMap<File, Upload>
  summary: UploadSummary
  /** What the form sends for the files that are up or were saved. */
  values: readonly string[]
  retry: (file: File) => void
  retryFailed: () => void
  /** Cancels every upload still waiting or going up, and takes those files out. */
  cancelActive: () => void
  /** A submit is waiting for the uploads, and goes once they are up. */
  waiting: boolean
  /** What the last pick, drop or paste turned away. */
  rejected: readonly FileRejection[]
  dismissRejected: () => void
  /** Back to the files it started with, as a form's reset does; returns them. */
  reset: () => File[]
  disabled: boolean
  locale: string
  inputRef: RefObject<HTMLInputElement | null>
  /** Opens the picker from a press on a drop target, unless it landed on a control of its own. */
  openPicker: (event: MouseEvent<HTMLElement>) => void
  announce: (text: string) => void
}

const FileInputContext = createContext<FileInputContextValue | null>(null)

function useFileInput() {
  const context = use(FileInputContext)
  if (!context) throw new Error('File input parts go inside a FileInput.')
  return context
}

interface FileInputChangeDetails {
  added: File[]
  removed: File[]
}

type FileInputProps = Omit<useRender.ComponentProps<'div'>, 'defaultValue' | 'onChange'> &
  FileRules & {
    value?: File[]
    /** The files it starts with, and goes back to on a form's reset. A saved file, `{ value, name, size }`, shows as uploaded and never uploads. */
    defaultValue?: (File | SavedFile)[]
    /**
     * Sends each file as it's added, calling `onProgress` with the bytes
     * sent, and resolves with what the form sends for it, such as its id;
     * a thrown `Error`'s message shows on its row. A submit waits for the
     * uploads. Left out, the files themselves go with the form.
     */
    upload?: UploadFile
    /** How many files upload at once. */
    concurrency?: number
    onValueChange?: (value: File[], details: FileInputChangeDetails) => void
    /** Files that were picked, dropped or pasted and not added, each with the reason. */
    onReject?: (rejected: FileRejection[]) => void
    disabled?: boolean
    /** Formats the files' sizes; the browser's language when left out. */
    locale?: string
  }

/**
 * Holds the files. A file pasted anywhere inside it, such as on its button,
 * is added as a picked one is.
 */
function FileInput({
  value,
  defaultValue,
  onValueChange,
  onReject,
  upload,
  concurrency,
  accept,
  maxSize,
  maxFiles,
  multiple = true,
  disabled: disabledProp = false,
  locale: localeProp,
  className,
  render,
  ref,
  ...props
}: FileInputProps) {
  // The server writes sizes in en-US, then the visitor's own once the page has loaded.
  const locale = useLocale(localeProp)
  const field = useFieldRootContext()
  const disabled = disabledProp || field.disabled === true
  // A saved file stands in the list as a File that holds no bytes.
  const [defaults] = useState(() =>
    (defaultValue ?? []).map((entry) =>
      entry instanceof File ? entry : savedFileOf(entry),
    ),
  )
  const [own, setOwn] = useState<File[]>(defaults)
  const files = value ?? own
  const inputRef = useRef<HTMLInputElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const { announce, region } = useAnnouncer()
  // The last change put a file in another's place.
  const [swapping, setSwapping] = useState(false)
  const [rejected, setRejected] = useState<FileRejection[]>([])
  const [waiting, setWaiting] = useState<{ submitter: HTMLElement | null } | null>(null)
  const rules: FileRules = { accept, maxSize, maxFiles, multiple }
  const uploads = useUploads({ files, upload, concurrency })
  const { summary } = uploads

  // A batch ended by a cancel isn't told as one that went up.
  const [cancelled, setCancelled] = useState(false)
  const change = (next: File[], details: FileInputChangeDetails) => {
    if (value === undefined) setOwn(next)
    setSwapping(details.added.length > 0 && details.removed.length > 0)
    onValueChange?.(next, details)
    const stopped = details.removed.filter((file) => uploads.active.includes(file))
    const cancelling = stopped.length > 0 && details.added.length === 0
    setCancelled(cancelling)
    announce(
      cancelling
        ? cancelAnnouncement(stopped, details.removed.length - stopped.length)
        : announcement(details.added, details.removed),
    )
  }
  const add = (incoming: readonly File[]) => {
    if (disabled || incoming.length === 0) return
    const result = addFiles(files, incoming, rules)
    if (result.added.length > 0)
      change(result.value, { added: result.added, removed: result.removed })
    // What this pick turned away, or nothing once a pick adds them all.
    setRejected(result.rejected)
    if (result.rejected.length > 0) onReject?.(result.rejected)
  }
  const reset = () => {
    change(defaults, {
      added: defaults.filter((file) => !files.includes(file)),
      removed: files.filter((file) => !defaults.includes(file)),
    })
    setRejected([])
    return defaults
  }
  const remove = (file: File) => {
    if (disabled) return
    change(
      files.filter((held) => held !== file),
      { added: [], removed: [file] },
    )
  }
  const cancelActive = () => {
    const active = uploads.active
    if (disabled || active.length === 0) return
    setWaiting(null)
    change(
      files.filter((file) => !active.includes(file)),
      { added: [], removed: active },
    )
  }

  // A submit that comes while files go up waits for them, then goes again;
  // then the field's check stops it if one failed.
  const latest = useRef(summary)
  useLayoutEffect(() => {
    latest.current = summary
  })
  useEffect(() => {
    const form = rootRef.current?.closest('form')
    if (!form || !upload) return
    const onSubmit = (event: SubmitEvent) => {
      const now = latest.current
      if (now.active === 0) return
      // A form that fails elsewhere goes on to say so; the wait is for one that's ready.
      const others = [...form.elements].filter(
        (element): element is HTMLInputElement =>
          'validity' in element && element !== inputRef.current,
      )
      if (others.some((element) => !element.validity.valid)) return
      event.preventDefault()
      event.stopImmediatePropagation()
      setWaiting({ submitter: event.submitter })
      announce(waitingText(now.active))
    }
    form.addEventListener('submit', onSubmit, { capture: true })
    return () => form.removeEventListener('submit', onSubmit, { capture: true })
  }, [announce, upload])
  const resumed = useRef<typeof waiting>(null)
  useEffect(() => {
    if (!waiting || summary.active > 0 || resumed.current === waiting) return
    resumed.current = waiting
    // The uploads ending, from outside React, ends the wait: once this commit is done.
    queueMicrotask(() => {
      setWaiting(null)
      const form = rootRef.current?.closest('form')
      const { submitter } = waiting
      form?.requestSubmit(submitter && form.contains(submitter) ? submitter : undefined)
    })
  }, [waiting, summary])

  const wasActive = useRef(summary.active > 0)
  useEffect(() => {
    if (wasActive.current && summary.active === 0 && !cancelled)
      announce(settledAnnouncement(summary))
    wasActive.current = summary.active > 0
  })

  const onPaste = (event: ClipboardEvent<HTMLDivElement>) => {
    const pasted = [...event.clipboardData.files]
    if (pasted.length === 0) return
    event.preventDefault()
    add(pasted)
  }

  const element = useRender({
    defaultTagName: 'div',
    ref: ref ? [rootRef, ref] : rootRef,
    props: mergeProps<'div'>(
      {
        className: cn('group/file-input flex min-w-0 flex-col gap-3', className),
        onPaste,
      },
      props,
    ),
    render,
    state: { slot: 'file-input', disabled, empty: files.length === 0, swapping },
  })

  const openPicker = (event: MouseEvent<HTMLElement>) => {
    const input = inputRef.current
    if (disabled || !input || event.defaultPrevented) return
    const target = event.target as HTMLElement
    if (target.closest('button, a, input, label, select, textarea, [role=listitem], li'))
      return
    input.click()
  }

  return (
    <FileInputContext
      value={{
        ...rules,
        files,
        add,
        remove,
        reset,
        uploading: upload !== undefined,
        uploads: uploads.uploads,
        summary,
        values: uploads.values,
        retry: uploads.retry,
        retryFailed: uploads.retryFailed,
        cancelActive,
        waiting: waiting !== null,
        rejected,
        dismissRejected: () => setRejected([]),
        disabled,
        locale,
        inputRef,
        openPicker,
        announce,
      }}
    >
      {element}
      {region}
    </FileInputContext>
  )
}

/** Puts `files` in a file input, so a form submits them; no change event fires. */
function putFiles(input: HTMLInputElement, files: readonly File[]) {
  if (typeof DataTransfer === 'undefined') return
  const transfer = new DataTransfer()
  for (const file of files) transfer.items.add(file)
  input.files = transfer.files
}

type FileInputTriggerProps = Omit<
  FieldPrimitive.Control.Props,
  | 'className'
  | 'type'
  | 'value'
  | 'defaultValue'
  | 'onValueChange'
  | 'render'
  | 'size'
  | 'accept'
  | 'multiple'
  | 'disabled'
> & {
  className?: string
  /** What the button says. */
  children?: ReactNode
} & VariantProps<typeof buttonVariants>

/**
 * The way in by keyboard and pointer: a button that opens the browser's file
 * picker. It is the native file input, inside a label that looks like a
 * Kino Button, so a Field's label names it and a form submits the files.
 */
function FileInputTrigger({
  className,
  children,
  variant = 'outline',
  size = 'default',
  name: nameProp,
  onChange,
  ref,
  ...props
}: FileInputTriggerProps) {
  const {
    files,
    add,
    reset,
    accept,
    multiple,
    maxFiles,
    disabled,
    inputRef,
    uploading,
    values,
    summary,
  } = useFileInput()
  const field = useFieldRootContext()
  const name = field.name ?? nameProp
  const ownRef = useRef<HTMLInputElement>(null)
  const heldRef = useRef<HTMLInputElement>(null)
  const textId = useId()
  // The first trigger holds the files for the form; another one, such as a
  // second button in an empty state, only opens a picker, so nothing is
  // submitted twice.
  const [owner, setOwner] = useState(false)
  useLayoutEffect(() => {
    const own = ownRef.current
    if (!own || (inputRef.current && inputRef.current !== own)) return
    inputRef.current = own
    setOwner(true)
    return () => {
      if (inputRef.current === own) inputRef.current = null
    }
  }, [inputRef])

  // The files that go with the form themselves: none when they upload, and
  // never a saved file's stand-in, whose value goes in its place.
  const held = uploading ? [] : files.filter((file) => savedValueOf(file) === undefined)
  // What the form's values give the field: what the uploads gave back, or
  // the files themselves. A new array only when what it holds changes.
  const valueOf = () => [...values, ...held]
  const [formValue, setFormValue] = useState(valueOf)
  const now = valueOf()
  if (
    formValue.length !== now.length ||
    formValue.some((entry, index) => entry !== now[index])
  )
    setFormValue(now)

  // After every change, so the inputs hold the files it made: the control
  // all of them, for the field's checks, and the named one those that go
  // with the form.
  useLayoutEffect(() => {
    if (!owner) return
    if (ownRef.current) putFiles(ownRef.current, files)
    if (heldRef.current) putFiles(heldRef.current, held)
  })

  // A form that is reset goes back to the files it started with, as its
  // other controls do.
  useEffect(() => {
    const own = ownRef.current
    const form = owner ? own?.form : null
    if (!own || !form) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const onReset = () => {
      const initial = reset()
      // The browser empties the input once the event is done.
      timer = setTimeout(() => putFiles(own, initial))
    }
    form.addEventListener('reset', onReset)
    return () => {
      form.removeEventListener('reset', onReset)
      clearTimeout(timer)
    }
  }, [owner, reset])

  return (
    <FieldWiring
      value={formValue}
      filled={files.length > 0}
      disabled={disabled || !owner}
      name={name}
      // A file that failed to upload holds the form back, as an invalid field does.
      invalidMessage={summary.failed > 0 ? failedMessage(summary.failed) : ''}
    >
      {(wiring) => (
        <>
          <label
            data-slot='file-input-trigger'
            className={cn(
              buttonVariants({ variant, size }),
              'has-focus-visible:border-ring has-focus-visible:ring-3 has-focus-visible:ring-ring/50 has-disabled:pointer-events-none has-disabled:opacity-50 forced-colors:has-focus-visible:outline-2 forced-colors:has-focus-visible:outline-offset-2',
              // Space held on the input presses it, as on a Button.
              'has-[input:active]:duration-[calc(var(--motion-press-duration)*0.4)] motion-safe:has-[input:active]:scale-[calc(1_-_(1_-_var(--motion-press-scale))_*_var(--button-press-depth,1))]',
              // In a box, the box's ring shows the focus, as a text field's does,
              // and a disabled box fades once, not twice.
              'in-data-[slot=file-input-box]:has-focus-visible:border-transparent in-data-[slot=file-input-box]:has-focus-visible:ring-0 in-data-[slot=file-input-box]:has-disabled:opacity-100 in-data-[slot=file-input-dropzone]:has-disabled:opacity-100',
              className,
            )}
          >
            {/* Read as part of the input's name, after the Field's label, so what
                it says is what it is called ("Receipts, Choose files"). */}
            <span
              id={textId}
              aria-hidden
              className='inline-flex items-center gap-[inherit]'
            >
              {children}
            </span>
            {/* The Field takes the files, or what their uploads gave back, from
                FieldWiring; this input is its label's target and holds the files
                for its checks, and sends nothing itself. */}
            <OutsideField>
              <FieldPrimitive.Control
                {...props}
                ref={mergeRefs(ownRef, ref, owner ? wiring.control.ref : undefined)}
                id={owner ? wiring.control.id : undefined}
                aria-invalid={
                  props['aria-invalid'] ??
                  (owner ? wiring.control['aria-invalid'] : undefined)
                }
                aria-describedby={
                  [props['aria-describedby'], owner && wiring.control['aria-describedby']]
                    .filter(Boolean)
                    .join(' ') || undefined
                }
                render={(controlProps) => (
                  <input
                    {...controlProps}
                    type='file'
                    aria-labelledby={[
                      controlProps['aria-labelledby'],
                      owner ? wiring.control['aria-labelledby'] : undefined,
                      textId,
                    ]
                      .filter(Boolean)
                      .join(' ')}
                  />
                )}
                data-slot='file-input-control'
                accept={accept}
                multiple={multiple && maxFiles !== 1}
                disabled={disabled}
                className='sr-only'
                onChange={(event) => {
                  // The picker puts only what was just picked in the input; the
                  // field's files go back in once they are added.
                  const picked = [...(event.currentTarget.files ?? [])]
                  if (picked.length > 0) add(picked)
                  putFiles(event.currentTarget, owner ? files : [])

                  onChange?.(event)
                }}
              />
            </OutsideField>
          </label>
          {owner ? (
            <>
              {/* A disabled field sends nothing, as a disabled input doesn't. */}
              <FieldValues name={disabled ? undefined : name} values={values} />
              {name && !uploading ? (
                <input
                  ref={heldRef}
                  type='file'
                  name={name}
                  multiple
                  hidden
                  disabled={disabled}
                  tabIndex={-1}
                  aria-hidden
                />
              ) : null}
            </>
          ) : null}
        </>
      )}
    </FieldWiring>
  )
}

interface PageDrag {
  /** A file is being dragged somewhere over the page. */
  dragging: boolean
}

/*
 * Whether a file is being dragged over the page, shared by every file input
 * on it: one listens on the window while any is mounted. A drop that lands
 * outside a drop target is stopped there, so the browser doesn't leave the
 * page to open the file.
 */
const pageDrag = {
  depth: 0,
  state: { dragging: false } as PageDrag,
  listeners: new Set<() => void>(),
}

function hasFiles(event: globalThis.DragEvent) {
  return event.dataTransfer?.types.includes('Files') ?? false
}

function setPageDragging(dragging: boolean) {
  if (pageDrag.state.dragging === dragging) return
  pageDrag.state = { dragging }
  for (const listener of pageDrag.listeners) listener()
}

function onPageDragEnter(event: globalThis.DragEvent) {
  if (!hasFiles(event)) return
  pageDrag.depth += 1
  setPageDragging(true)
}

function onPageDragLeave(event: globalThis.DragEvent) {
  if (!hasFiles(event)) return
  pageDrag.depth = Math.max(0, pageDrag.depth - 1)
  // Leaving the window has no element to go to.
  if (pageDrag.depth === 0 || event.relatedTarget === null) {
    pageDrag.depth = 0
    setPageDragging(false)
  }
}

/**
 * Whether a drop here is the browser's own to take: a field that takes text
 * or files. Anywhere else, a stray drop would open the file in place of the page.
 */
function takesDrop(event: globalThis.DragEvent) {
  return (
    event.target instanceof Element &&
    event.target.closest(
      'input, textarea, [contenteditable]:not([contenteditable=false])',
    ) !== null
  )
}

function onPageDragOver(event: globalThis.DragEvent) {
  if (!hasFiles(event) || event.defaultPrevented || takesDrop(event)) return
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'none'
}

function onPageDrop(event: globalThis.DragEvent) {
  pageDrag.depth = 0
  setPageDragging(false)
  if (hasFiles(event) && !event.defaultPrevented && !takesDrop(event))
    event.preventDefault()
}

function onPageDragEnd() {
  pageDrag.depth = 0
  setPageDragging(false)
}

const pageEvents = [
  ['dragenter', onPageDragEnter],
  ['dragleave', onPageDragLeave],
  ['dragover', onPageDragOver],
  ['drop', onPageDrop],
  ['dragend', onPageDragEnd],
] as const

function subscribePageDrag(listener: () => void) {
  if (pageDrag.listeners.size === 0) {
    for (const [type, handler] of pageEvents) window.addEventListener(type, handler)
  }
  pageDrag.listeners.add(listener)
  return () => {
    pageDrag.listeners.delete(listener)
    if (pageDrag.listeners.size > 0) return
    for (const [type, handler] of pageEvents) window.removeEventListener(type, handler)
    pageDrag.depth = 0
    pageDrag.state = { dragging: false }
  }
}

const notDragging: PageDrag = { dragging: false }

function usePageDrag() {
  return useSyncExternalStore(
    subscribePageDrag,
    () => pageDrag.state,
    () => notDragging,
  )
}

interface FileDropState {
  /** A file is being dragged somewhere over the page. */
  dragging: boolean
  /** It is over the drop target. */
  over: boolean
  /** What the drop would do, as far as the browser can tell before it. */
  verdict: 'accept' | 'reject' | 'unknown'
  /** How many files are being dragged; 0 when the browser doesn't say. */
  count: number
}

/** The file types and count a drag carries, as far as the browser says. */
function dragged(transfer: DataTransfer) {
  const items = [...transfer.items].filter((item) => item.kind === 'file')
  return { types: items.map((item) => item.type), count: items.length }
}

/**
 * Makes an element a drop target for the file input it sits in, and says
 * what a drag over it is doing: give the handlers to the element and read
 * the state for how it looks. Its children don't break the drag.
 */
function useFileDrop() {
  const { add, accept, disabled } = useFileInput()
  const page = usePageDrag()
  const depth = useRef(0)
  const [over, setOver] = useState<Omit<FileDropState, 'dragging'>>({
    over: false,
    verdict: 'unknown',
    count: 0,
  })
  // A drag that leaves the page or ends elsewhere ends over this too.
  if (!page.dragging && over.over) setOver({ over: false, verdict: 'unknown', count: 0 })

  const handlers = {
    onDragEnter(event: DragEvent<HTMLElement>) {
      if (disabled || !event.dataTransfer.types.includes('Files')) return
      event.preventDefault()
      // A drag that ended elsewhere left its count behind.
      depth.current = over.over ? depth.current + 1 : 1
      const { types, count } = dragged(event.dataTransfer)
      setOver({ over: true, verdict: dragVerdict(types, accept), count })
    },
    onDragOver(event: DragEvent<HTMLElement>) {
      if (disabled || !event.dataTransfer.types.includes('Files')) return
      event.preventDefault()
      event.dataTransfer.dropEffect = 'copy'
    },
    onDragLeave(event: DragEvent<HTMLElement>) {
      if (disabled || !event.dataTransfer.types.includes('Files')) return
      depth.current = Math.max(0, depth.current - 1)
      if (depth.current === 0) setOver({ over: false, verdict: 'unknown', count: 0 })
    },
    onDrop(event: DragEvent<HTMLElement>) {
      if (disabled || !event.dataTransfer.types.includes('Files')) return
      event.preventDefault()
      depth.current = 0
      setOver({ over: false, verdict: 'unknown', count: 0 })
      add([...event.dataTransfer.files])
    },
  }

  const state: FileDropState = { dragging: page.dragging && !disabled, ...over }
  return { state, handlers }
}

/** A drop target's state as data attributes, for its look. */
function dropAttributes(state: FileDropState) {
  return {
    'data-dragging': state.dragging ? '' : undefined,
    'data-over': state.over ? '' : undefined,
    'data-reject': state.over && state.verdict === 'reject' ? '' : undefined,
  }
}

/**
 * The files, one row each, from `children`: a function that takes a file and
 * returns its `FileInputItem`. A row that arrives rises into place, and one
 * that leaves fades where it was while the rest close its gap. Removing a
 * row moves focus to the next row's remove button, or the one before.
 */
function FileInputList({
  className,
  children,
  ...props
}: Omit<ComponentProps<'ul'>, 'children'> & {
  children: (file: File, index: number) => ReactNode
}) {
  const { files } = useFileInput()
  const { frame: frameRef, row: listRef } = useFlow<HTMLDivElement, HTMLUListElement>(
    'li',
  )
  useEffect(() => markMounted(listRef.current), [listRef])
  return (
    <div
      ref={frameRef}
      data-slot='file-input-list-frame'
      // Its rows' rings show past its edges as it changes height. It is
      // never hidden: the root's gap above it is taken back here (`-mt-4`)
      // and given again inside the height that moves, while it holds a row.
      className='-m-1 -mt-4 overflow-clip p-1 transition-[height] duration-(--motion-layout-duration) ease-(--motion-layout-easing) motion-reduce:transition-none'
    >
      <ul
        ref={listRef}
        data-slot='file-input-list'
        className={cn(
          'group/file-input-list relative isolate flex flex-col gap-2 has-[>li:not([data-leaving])]:pt-3',
          className,
        )}
        {...props}
      >
        {files.map((file, index) => (
          <FileItemContext key={fileKey(file)} value={file}>
            {children(file, index)}
          </FileItemContext>
        ))}
      </ul>
    </div>
  )
}

const FileItemContext = createContext<File | null>(null)

interface Preview {
  url: string
  users: number
}

const previews = new WeakMap<File, Preview>()

/** The object URL a picture's rows share, made the first time one asks. */
function previewOf(file: File) {
  let preview = previews.get(file)
  if (!preview) {
    preview = { url: URL.createObjectURL(file), users: 0 }
    previews.set(file, preview)
  }
  return preview
}

/**
 * Lets go of a picture's URL once nothing shows it: a row's leaving copy
 * shows the same picture while it fades, so it waits for that to go.
 */
function releasePreview(file: File, preview: Preview) {
  preview.users -= 1
  const check = () => {
    if (preview.users > 0) return
    if (document.querySelector(`img[src="${preview.url}"]`)) {
      setTimeout(check, 1000)
      return
    }
    URL.revokeObjectURL(preview.url)
    if (previews.get(file) === preview) previews.delete(file)
  }
  setTimeout(check, 0)
}

function noChanges() {
  return () => {}
}

/** An object URL for a picture's preview, revoked once nothing shows it. */
function usePreview(file: File) {
  const picture = file.type.startsWith('image/')
  // None on the server, so a page that opens with pictures hydrates the same.
  const url = useSyncExternalStore(
    noChanges,
    () => (picture ? previewOf(file).url : undefined),
    () => undefined,
  )
  useEffect(() => {
    if (!picture) return
    const preview = previewOf(file)
    preview.users += 1
    return () => releasePreview(file, preview)
  }, [file, picture])
  return url
}

type FileItemState = 'idle' | 'uploading' | 'complete' | 'failed'

/** Where a row's upload is, from its progress and error. */
function itemState(progress: number | null | undefined, failed: boolean): FileItemState {
  if (failed) return 'failed'
  if (progress === undefined) return 'idle'
  if (progress !== null && progress >= 100) return 'complete'
  return 'uploading'
}

/** What a row's end button is called: it cancels an upload still going, and removes the file otherwise. */
function removeLabel(name: string, state: FileItemState) {
  return state === 'uploading' ? `Cancel upload of ${name}` : `Remove ${name}`
}

/** What a screen reader hears when a row's upload ends. */
function uploadAnnouncement(name: string, state: FileItemState) {
  if (state === 'complete') return `${name} uploaded`
  if (state === 'failed') return `${name} failed to upload`
  return ''
}

/**
 * A file's row: its picture or icon, its name and size, and a button that
 * removes it. Given `progress`, it shows the upload drawing on its track,
 * then a tick once it reaches 100; given `error`, it says why it failed.
 * While it uploads, its end button cancels the upload, and says so.
 * `children` are more actions, such as a Retry button, before the remove one.
 */
function FileInputItem({
  className,
  ref,
  progress: progressProp,
  error: errorProp,
  children,
  ...props
}: ComponentProps<'li'> & {
  /** How far its upload has got, from 0 to 100; `null` while that isn't known. Left out, it shows its own upload's, if the FileInput has `upload`, or no track. */
  progress?: number | null
  /** Why its upload failed. Left out, it shows why its own upload did. */
  error?: ReactNode
}) {
  const file = use(FileItemContext)
  if (!file) throw new Error('A FileInputItem goes inside a FileInputList.')
  const { remove, disabled, locale, inputRef, announce, uploads, retry } = useFileInput()
  // Its own upload, when the FileInput runs them and nothing is given in its place.
  const upload = uploads.get(file)
  const progress =
    progressProp !== undefined ? progressProp : rowProgress(upload, file.size)
  const ownError = errorProp === undefined && upload?.status === 'failed'
  const error = ownError ? upload.error : errorProp
  const preview = usePreview(file)
  // A picture the browser can't draw, such as a HEIC on most of them, keeps the icon.
  const [broken, setBroken] = useState<string>()
  const failed = error != null && error !== false && error !== ''
  const state = itemState(progress, failed)
  const size = formatFileSize(file.size, locale)

  // A finished upload's line comes once its track has drawn to the end; any
  // other state shows at once.
  const lineRef = useRef<HTMLSpanElement>(null)
  const [shown, setShown] = useState(state)
  const drawing = state === 'complete' && shown === 'uploading'
  if (shown !== state && !drawing) setShown(state)
  useEffect(() => {
    const line = lineRef.current
    if (!drawing || !line) return
    let cancelled = false
    void transitionsSettled(line, { subtree: true }).then(() => {
      if (!cancelled) setShown('complete')
    })
    return () => {
      cancelled = true
    }
  }, [drawing])

  // An upload the FileInput runs is told once for the whole batch; one the
  // caller drives is told here, row by row.
  const own = progressProp === undefined && upload !== undefined
  const lastState = useRef(state)
  useEffect(() => {
    if (lastState.current === state) return
    lastState.current = state
    if (!own) announce(uploadAnnouncement(file.name, state))
  }, [state, file, announce, own])

  // A control of the caller's that goes with a state, such as Retry, takes
  // the focus with it: the row keeps it, on its remove button.
  const rowRef = useRef<HTMLLIElement>(null)
  const focused = useRef<Element | null>(null)
  useEffect(() => {
    const row = rowRef.current
    if (!row) return
    const enter = (event: FocusEvent) => {
      focused.current = event.target as Element
    }
    row.addEventListener('focusin', enter)
    return () => row.removeEventListener('focusin', enter)
  }, [])
  useLayoutEffect(() => {
    const row = rowRef.current
    const last = focused.current
    if (!row || !last || last.isConnected) return
    focused.current = null
    const active = document.activeElement
    if (active === null || active === document.body) {
      row.querySelector<HTMLElement>('[data-slot=file-input-item-remove]')?.focus()
    }
  }, [state])

  const onRemove = (event: MouseEvent<HTMLButtonElement>) => {
    const row = event.currentTarget.closest('li')
    const rows = [
      ...(row?.parentElement?.querySelectorAll<HTMLElement>(
        ':scope > li:not([data-leaving])',
      ) ?? []),
    ]
    const at = row ? rows.indexOf(row) : -1
    const next = rows[at + 1] ?? rows[at - 1]
    flushSync(() => remove(file))
    const button = next?.querySelector<HTMLElement>('[data-slot=file-input-item-remove]')
    ;(button ?? inputRef.current)?.focus()
  }

  return (
    <li
      ref={mergeRefs(rowRef, ref)}
      data-slot='file-input-item'
      data-state={state}

      className={cn(
        // A container, so a row too narrow for its picture gives that room to its words.
        'group/file-item @container/file-item bg-card flex min-w-0 items-center gap-3 rounded-(--surface-radius) border p-(--control-padding) shadow-xs',
        // Once the list has painted, it fades in on `enter` and rises on
        // `layout`, the role its glides to a new place take too (`followFlow`);
        // its copy fades where it was on `exit`.
        '[transition:opacity_var(--motion-enter-duration)_var(--motion-enter-easing),translate_var(--motion-layout-duration)_var(--motion-layout-easing)] group-data-mounted/file-input-list:starting:opacity-0 motion-safe:group-data-mounted/file-input-list:starting:translate-y-(--file-input-rise,0.5rem)',
        'data-[flow=start]:[transition:opacity_var(--motion-enter-duration)_var(--motion-enter-easing)] motion-reduce:[transition:opacity_var(--motion-enter-duration)_var(--motion-enter-easing)]',
        // A copy that leaves mid-glide finishes its glide as it fades.
        'data-leaving:opacity-0 data-leaving:[transition:opacity_var(--motion-exit-duration)_var(--motion-exit-easing),translate_var(--motion-layout-duration)_var(--motion-layout-easing)] motion-reduce:data-leaving:[transition:opacity_var(--motion-exit-duration)_var(--motion-exit-easing)]',
        // A file that takes another's place waits for it to fade, so the two never overlap.
        'group-data-swapping/file-input:not-data-leaving:not-data-flowing:[transition-delay:var(--motion-exit-duration)]',
        'data-[state=failed]:border-destructive/40 forced-colors:data-[state=failed]:border-dashed',
        // A failed row whose reason wraps grows at once: it sits above the row
        // below while that one glides out of its way, so its reason never hides.
        'data-[state=failed]:relative data-[state=failed]:z-1',
        className,
      )}
      {...props}
    >
      <span
        aria-hidden
        // Under 15rem a row keeps its name and status, and leaves its picture out.
        className='bg-muted text-muted-foreground relative grid size-(--control-height) shrink-0 place-items-center overflow-hidden rounded-(--control-radius-sm) @max-[15rem]/file-item:hidden [&_svg:not([class*="size-"])]:size-4'
      >
        {preview && broken !== preview ? (
          // oxlint-disable-next-line next/no-img-element -- a picture from the user's own disk, as an object URL: next/image can't load it.
          <img
            src={preview}
            alt=''
            onError={() => setBroken(preview)}
            className='size-full object-cover'
          />
        ) : (
          <IconPlaceholder
            lucide='FileIcon'
            tabler='IconFile'
            hugeicons='File01Icon'
            phosphor='FileIcon'
            remixicon='RiFileLine'
            aria-hidden
          />
        )}
      </span>
      <span className='flex min-w-0 flex-1 flex-col gap-0.5'>
        <span
          data-slot='file-input-item-name'
          // A name keeps its own direction, and sits at the row's start
          // (`self-start` follows the row's direction). A long one wraps, at
          // any character, so the whole of it shows.
          dir='auto'
          className='max-w-full self-start text-sm leading-5 font-medium wrap-anywhere'
        >
          {file.name}
        </span>
        {/* The size, the track while it uploads and what happened, in one
            line that stays one height, so nothing beside it moves. A new
            state rolls in through `Swap`. */}
        <span
          ref={lineRef}
          data-slot='file-input-item-status'
          className='text-muted-foreground flex min-h-5 items-center text-xs'
        >
          <Swap roll fill align='start' id={shown}>
            {shown === 'uploading' ? (
              <span className='flex min-w-0 flex-1 items-center gap-2'>
                <Progress
                  value={progress ?? null}
                  aria-label={`Uploading ${file.name}`}
                  className='min-w-0 flex-1'
                />
                <span className='shrink-0 tabular-nums'>
                  <bdi>{progress == null ? size : `${Math.round(progress)}%`}</bdi>
                </span>
              </span>
            ) : shown === 'failed' ? (
              // The reason takes the line, and wraps under itself in a narrow row, so all of it shows.
              <span className='text-destructive flex min-w-0 items-start gap-1 [&_svg:not([class*="size-"])]:size-3.5 [&>svg]:mt-0.5'>
                <IconPlaceholder
                  lucide='CircleAlertIcon'
                  tabler='IconAlertCircle'
                  hugeicons='AlertCircleIcon'
                  phosphor='WarningCircleIcon'
                  remixicon='RiErrorWarningLine'
                  aria-hidden
                  className='shrink-0'
                />
                <span className='min-w-0 wrap-break-word'>{error}</span>
              </span>
            ) : (
              <span className='flex min-w-0 items-center gap-1'>
                <bdi className='shrink-0 tabular-nums'>{size}</bdi>
                {shown === 'complete' ? (
                  <span className='text-foreground inline-flex shrink-0 items-center gap-1 [&_svg:not([class*="size-"])]:size-3.5'>
                    <span aria-hidden>·</span>
                    <IconPlaceholder
                      lucide='CheckIcon'
                      tabler='IconCheck'
                      hugeicons='Tick02Icon'
                      phosphor='CheckIcon'
                      remixicon='RiCheckLine'
                      aria-hidden
                    />
                    Uploaded
                  </span>
                ) : null}
              </span>
            )}
          </Swap>
        </span>
      </span>
      {/* Its own failed upload's Retry: the file's name is in its label, so the reason keeps the room. */}
      {ownError ? (
        <Button
          variant='ghost'
          size='icon-sm'
          data-slot='file-input-item-retry'
          aria-label={`Retry ${file.name}`}
          disabled={disabled}
          onClick={() => retry(file)}
        >
          <IconPlaceholder
            lucide='RotateCwIcon'
            tabler='IconRotateClockwise'
            hugeicons='RotateClockwiseIcon'
            phosphor='ArrowClockwiseIcon'
            remixicon='RiRestartLine'
            aria-hidden
          />
        </Button>
      ) : null}
      {children}
      <Button
        variant='ghost'
        size='icon-sm'
        data-slot='file-input-item-remove'
        aria-label={removeLabel(file.name, state)}
        disabled={disabled}
        onClick={onRemove}
      >
        <IconPlaceholder
          lucide='XIcon'
          tabler='IconX'
          hugeicons='Cancel01Icon'
          phosphor='XIcon'
          remixicon='RiCloseLine'
          aria-hidden
        />
      </Button>
    </li>
  )
}

/*
 * The files turned away: what the last pick, drop or paste didn't add, each
 * with why, in a warning that closes once a pick adds them all, or with its
 * close button. Where nothing was turned away it takes no room.
 */

function FileInputRejected({
  className,
  ...props
}: Omit<ComponentProps<'div'>, 'children'>) {
  const { rejected, dismissRejected, accept, maxSize, maxFiles, multiple, locale } =
    useFileInput()
  return (
    <div
      data-slot='file-input-rejected'
      // Closed, it gives back the gap above it; open, the gap is inside what it measures.
      className={cn(
        '-mt-3 [&_[data-slot=alert-panel]]:flow-root [&_[data-slot=alert-surface]]:mt-3',
        className,
      )}
      {...props}
    >
      <FileRejections
        rejected={rejected}
        rules={{ accept, maxSize, maxFiles, multiple }}
        locale={locale}
        onDismiss={dismissRejected}
      />
    </div>
  )
}

/**
 * The files turned away and why, as a warning that closes once they're
 * dismissed: the File input's, and any part's that takes files by its rules.
 */
function FileRejections({
  rejected,
  rules,
  locale,
  onDismiss,
}: {
  /** Empty closes it. */
  rejected: readonly FileRejection[]
  rules: FileRules
  locale?: string
  onDismiss: () => void
}) {
  // What it said, kept while it closes.
  const [shown, setShown] = useState(rejected)
  if (rejected.length > 0 && shown !== rejected) setShown(rejected)
  return (
    <Alert
      type='warning'
      open={rejected.length > 0}
      onOpenChange={(open) => {
        if (!open) onDismiss()
      }}
      showCloseButton
    >
      <AlertTitle dir='auto'>{rejectedTitle(shown)}</AlertTitle>
      <AlertDescription>
        {shown.length === 1 ? (
          // The title names the file: the reason is all that's left to say.
          <span dir='auto'>{rejectionText(shown[0], rules, locale)}</span>
        ) : (
          <ul className='flex flex-col gap-0.5'>
            {shown.slice(0, 4).map((rejection) => (
              <li
                key={`${rejection.file.name}-${rejection.reason}`}
                className='flex min-w-0 flex-col'
              >
                <span dir='auto' className='max-w-full font-medium wrap-anywhere'>
                  {rejection.file.name}
                  <span className='sr-only'>: </span>
                </span>
                <span dir='auto'>{rejectionText(rejection, rules, locale)}</span>
              </li>
            ))}
            {shown.length > 4 ? <li>And {shown.length - 4} more</li> : null}
          </ul>
        )}
      </AlertDescription>
    </Alert>
  )
}

const STATUS_DONE_ICON = (
  <IconPlaceholder
    lucide='CircleCheckIcon'
    tabler='IconCircleCheck'
    hugeicons='CheckmarkCircle02Icon'
    phosphor='CheckCircleIcon'
    remixicon='RiCheckboxCircleLine'
    aria-hidden
    className='text-success shrink-0'
  />
)

const STATUS_FAILED_ICON = (
  <IconPlaceholder
    lucide='CircleAlertIcon'
    tabler='IconAlertCircle'
    hugeicons='AlertCircleIcon'
    phosphor='WarningCircleIcon'
    remixicon='RiErrorWarningLine'
    aria-hidden
    className='text-destructive shrink-0'
  />
)

const STATUS_FILES_ICON = (
  <IconPlaceholder
    lucide='PaperclipIcon'
    tabler='IconPaperclip'
    hugeicons='Attachment01Icon'
    phosphor='PaperclipIcon'
    remixicon='RiAttachment2'
    aria-hidden
    className='text-muted-foreground shrink-0'
  />
)

/*
 * The status: the whole batch in one bar under the rows. While files go up
 * it shows one bar for all of them and Cancel uploads; once they are, how
 * it went, with Retry failed if one failed; for files that go with the
 * form, how many and how big. It opens with the first file and closes with
 * the last, keeping its line as it goes. The bar stays while only its words
 * change; its button fades out on `exit` rather than vanishing.
 */

function FileInputStatus({
  className,
  ...props
}: Omit<ComponentProps<'div'>, 'children'>) {
  const {
    summary,
    uploading,
    waiting,
    locale,
    disabled,
    cancelActive,
    retryFailed,
    files,
    inputRef,
  } = useFileInput()
  const state = statusState(summary, uploading, waiting)
  // The last line, kept while it closes, so it leaves as it was.
  const [kept, setKept] = useState({ state, summary })
  const keptKey = (entry: typeof kept) =>
    `${entry.state}|${entry.summary.count}|${entry.summary.done}|${entry.summary.failed}|${entry.summary.active}`
  if (state !== 'empty' && keptKey(kept) !== keptKey({ state, summary }))
    setKept({ state, summary })
  const shown = state === 'empty' ? kept : { state, summary }
  const going = shown.state === 'uploading' || shown.state === 'waiting'
  // Cancel uploads while files go up, Retry failed once one has failed.
  const action = state === 'uploading' || state === 'waiting' || state === 'failed'
  // What the button last was, kept while it fades out, so it leaves as it was.
  const kind = state === 'failed' ? 'retry' : 'cancel'
  const [buttonKind, setButtonKind] = useState(kind)
  if (action && buttonKind !== kind) setButtonKind(kind)
  const rootRef = useRef<HTMLDivElement>(null)
  const actionRef = useRef<HTMLButtonElement>(null)

  /** Where the focus goes when the button goes: the first row left, or the way in. */
  const focusAfterAction = () => {
    const list = rootRef.current?.closest('[data-slot=file-input]')
    const row = list?.querySelector<HTMLElement>(
      '[data-slot=file-input-item]:is([data-state=complete],[data-state=failed],[data-state=idle]) [data-slot=file-input-item-remove]',
    )
    ;(row ?? inputRef.current)?.focus()
  }
  // The button goes once nothing is left to cancel or retry: the focus goes with it.
  useEffect(() => {
    if (!action && actionRef.current?.contains(document.activeElement)) focusAfterAction()
  })
  const cancel = () => {
    const left = files.length - summary.active
    cancelActive()
    if (left === 0) inputRef.current?.focus()
    else focusAfterAction()
  }
  // Retry goes with the failures: the focus goes to the first file it retries.
  const retry = () => {
    rootRef.current
      ?.closest('[data-slot=file-input]')
      ?.querySelector<HTMLElement>(
        '[data-slot=file-input-item][data-state=failed] [data-slot=file-input-item-remove]',
      )
      ?.focus()
    retryFailed()
  }

  return (
    <div
      ref={rootRef}
      data-slot='file-input-status'
      // Closed, it gives back the gap above it; open, the gap is inside what it measures.
      className={cn('@container -mt-3', className)}
      {...props}
    >
      <Collapsible open={state !== 'empty'}>
        <CollapsibleContent className='p-0 pt-3'>
          <div
            // As tall with its button as without, so nothing moves when the button comes or goes.
            className='bg-muted/50 relative flex min-h-(--control-height) flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-(--surface-radius) border px-(--control-padding) py-1'
          >
            <div className='flex min-w-0 flex-1 basis-48 text-xs'>
              {/* The bar stays while only its words change; it rolls out when the batch settles. */}
              <Swap roll fill align='start' id={going ? 'going' : shown.state}>
                {going ? (
                  <span className='flex min-w-0 flex-1 items-center gap-3'>
                    <Progress
                      value={shown.summary.percent}
                      aria-label='All uploads'
                      className='w-16 shrink-0 @sm:w-24'
                    />
                    <span className='text-muted-foreground flex min-w-0 flex-1'>
                      <Swap roll fill align='start' id={shown.state}>
                        <span dir='auto' className='min-w-0 text-pretty tabular-nums'>
                          {shown.state === 'waiting'
                            ? waitingText(shown.summary.active)
                            : progressText(shown.summary, locale)}
                        </span>
                      </Swap>
                    </span>
                  </span>
                ) : (
                  <span className='flex min-w-0 items-center gap-1.5 font-medium [&_svg:not([class*="size-"])]:size-4'>
                    {shown.state === 'failed'
                      ? STATUS_FAILED_ICON
                      : shown.state === 'done'
                        ? STATUS_DONE_ICON
                        : STATUS_FILES_ICON}
                    <span dir='auto' className='min-w-0 text-pretty tabular-nums'>
                      {shown.state === 'held'
                        ? heldText(shown.summary, locale)
                        : settledText(shown.summary, locale)}
                    </span>
                  </span>
                )}
              </Swap>
            </div>
            {/* Files that go with the form have nothing to cancel or retry. */}
            {uploading ? (
              <>
                {/* Kept in place while it's open, so it fades out on `exit` rather than vanishing. */}
                <Button
                  ref={actionRef}
                  variant={buttonKind === 'retry' ? 'outline' : 'ghost'}
                  size='xs'
                  data-hidden={action ? undefined : ''}
                  inert={!action}
                  aria-hidden={action ? undefined : true}
                  disabled={disabled}
                  // Hidden, it leaves the flow, so the line gets its room; it still fades where it was.
                  className='ms-auto shrink-0 data-hidden:absolute data-hidden:end-(--control-padding) data-hidden:invisible data-hidden:opacity-0 data-hidden:[transition:opacity_var(--motion-exit-duration)_var(--motion-exit-easing),visibility_0s_var(--motion-exit-duration)]'
                  onClick={buttonKind === 'retry' ? retry : cancel}
                >
                  <SwapText
                    text={buttonKind === 'retry' ? 'Retry failed' : 'Cancel uploads'}
                  />
                </Button>
              </>
            ) : null}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  )
}

/*
 * The dropzone: a drop target of its own, above the list, in the Empty
 * state's outlined look. While a file is dragged anywhere on the page its
 * edge darkens, so it says where to go; over it, the edge and a tint come
 * in on `press` and its picture lifts on `enter`. A press anywhere on it
 * opens the picker, as its button does.
 */

function FileInputDropzone({
  className,
  children,
  render,
  ...props
}: Omit<useRender.ComponentProps<'div'>, 'children'> & {
  /** Its content, or a function of the drag's state, to say something else while a file is over it. */
  children?: ReactNode | ((state: FileDropState) => ReactNode)
}) {
  const { openPicker, disabled } = useFileInput()
  const { state, handlers } = useFileDrop()
  return useRender({
    defaultTagName: 'div',
    props: mergeProps<'div'>(
      {
        ...handlers,
        ...dropAttributes(state),
        'aria-disabled': disabled || undefined,
        onClick: openPicker,
        className: cn(
          emptyVariants({ variant: 'outline' }),
          'group/dropzone relative transition-[background-color,border-color,box-shadow] duration-(--motion-press-duration) ease-(--motion-press-fade-easing)',
          'has-aria-invalid:border-destructive/60 forced-colors:has-aria-invalid:outline-2 forced-colors:has-aria-invalid:outline-offset-1 forced-colors:has-aria-invalid:outline-dashed',
          'data-dragging:border-foreground/30',
          'data-over:border-primary data-over:bg-primary/[0.02] data-over:ring-3 data-over:ring-ring/30 dark:data-over:bg-primary/[0.07] forced-colors:data-over:border-[Highlight] forced-colors:data-over:border-solid',
          'data-reject:border-destructive data-reject:bg-destructive/[0.02] data-reject:ring-destructive/20 dark:data-reject:bg-destructive/[0.08] forced-colors:data-reject:border-[Mark]',
          'in-data-[disabled]:pointer-events-none in-data-[disabled]:opacity-50',
          // The picture lifts towards the file over it, and settles when it leaves.
          '[&_[data-slot=empty-media]]:transition-[scale,translate] [&_[data-slot=empty-media]]:duration-(--motion-enter-duration) [&_[data-slot=empty-media]]:ease-(--motion-enter-easing) motion-safe:data-over:[&_[data-slot=empty-media]]:-translate-y-1 motion-safe:data-over:[&_[data-slot=empty-media]]:scale-110',
          className,
        ),
        children: typeof children === 'function' ? children(state) : children,
      },
      props,
    ),
    render,
    state: { slot: 'file-input-dropzone' },
  })
}

/*
 * The box: the drop target is a box the size of a text field,
 * with the Input's edge and focus ring, for a form where a file is one
 * answer among others. It says what to do, and while a file is over it, what
 * the drop will do; the words change in place (`SwapText`). The button at
 * its end is the way in by keyboard.
 */

function FileInputBox({
  className,
  placeholder,
  children,
  render,
  ...props
}: useRender.ComponentProps<'div'> & {
  /** What it says while no file is over it: “Drop files here”, or “Drop a file here” for one file. */
  placeholder?: string
}) {
  const { openPicker, disabled, multiple, maxFiles } = useFileInput()
  const { state, handlers } = useFileDrop()
  const one = !multiple || maxFiles === 1
  const text = !state.over
    ? (placeholder ?? (one ? 'Drop a file here' : 'Drop files here'))
    : state.verdict === 'reject'
      ? `Can’t add ${state.count === 1 ? 'this type' : 'these types'}`
      : one || state.count === 1
        ? 'Drop to add it'
        : state.count > 1
          ? `Drop to add ${state.count} files`
          : 'Drop to add them'
  return useRender({
    defaultTagName: 'div',
    props: mergeProps<'div'>(
      {
        ...handlers,
        ...dropAttributes(state),
        'aria-disabled': disabled || undefined,
        onClick: openPicker,
        className: cn(
          inputBoxClassName,
          'h-(--control-height) gap-2 ps-(--control-padding) pe-[calc((var(--control-height)-var(--control-height-xs))/2-1px)]',
          'data-dragging:border-dashed data-dragging:border-foreground/30',
          'data-over:border-solid data-over:border-ring data-over:ring-3 data-over:ring-ring/50 forced-colors:data-over:outline-2 forced-colors:data-over:outline-[Highlight]',
          'data-reject:border-destructive data-reject:ring-destructive/20 dark:data-reject:ring-destructive/40',
          'in-data-[disabled]:pointer-events-none in-data-[disabled]:opacity-50',
          className,
        ),
        children: (
          <>
            <IconPlaceholder
              lucide='PaperclipIcon'
              tabler='IconPaperclip'
              hugeicons='Attachment01Icon'
              phosphor='PaperclipIcon'
              remixicon='RiAttachment2'
              aria-hidden
            />
            <span
              className={cn(
                'text-muted-foreground flex min-w-0 flex-1 text-sm transition-colors duration-(--motion-press-duration) ease-(--motion-press-fade-easing)',
                state.over && 'text-foreground',
                state.over && state.verdict === 'reject' && 'text-destructive',
              )}
            >
              <SwapText text={text} />
            </span>
            <InputInvalidIcon className='pe-0' />
            {children}
          </>
        ),
      },
      props,
    ),
    render,
    state: { slot: 'file-input-box' },
  })
}

export {
  FileInput,
  FileInputBox,
  FileInputDropzone,
  FileInputItem,
  FileInputList,
  FileInputRejected,
  FileInputStatus,
  FileInputTrigger,
  FileRejections,
}

export type {
  FileDropState,
  FileInputChangeDetails,
  FileRejection,
  FileRejectionReason,
  FileRules,
  SavedFile,
  UploadFile,
  UploadOptions,
}

export {
  acceptsFile,
  addFiles,
  announcement,
  cancelAnnouncement,
  dragVerdict,
  failedMessage,
  formatFileSize,
  heldText,
  itemState,
  limitsText,
  progressText,
  rejectedTitle,
  rejectionText,
  removeLabel,
  settledText,
  statusState,
  typeNames,
  typesText,
  uploadAnnouncement,
  waitingText,
}
