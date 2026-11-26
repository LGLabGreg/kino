'use client'

import { Alert, AlertDescription, AlertTitle } from '@/registry/components/kino/alert'
import { Button, buttonVariants } from '@/registry/components/kino/button'
import { Collapsible, CollapsiblePanel } from '@/registry/components/kino/collapsible'
import { emptyVariants } from '@/registry/components/kino/empty'
import { InputInvalidIcon, inputBoxClassName } from '@/registry/components/kino/input'
import { Progress } from '@/registry/components/kino/progress'
import { IconPlaceholder } from '@/registry/icons/icon-placeholder'
import { useAnnouncer } from '@/registry/lib/announce'
import { useLocale } from '@/registry/lib/dates'
import { FieldValues } from '@/registry/lib/field-control'
import { useFlow } from '@/registry/lib/flow'
import { formatFileSize } from '@/registry/lib/number-format'
import { markMounted, mergeRefs } from '@/registry/lib/refs'
import { transitionsSettled } from '@/registry/lib/resize'
import { Swap, SwapText } from '@/registry/lib/swap'
import {
  rowProgress,
  type SavedFile,
  savedFileOf,
  settledAnnouncement,
  type Upload,
  type UploadFile,
  type UploadOptions,
  type UploadSummary,
  useUploads,
} from '@/registry/lib/uploads'
import { useFieldControl } from '@ui-sdk/react/field'
import {
  createFileInputController,
  type FileInputController,
  FileInputDropzone as FileInputDropzonePrimitive,
  type FileInputDropzoneState as DropzoneState,
  FileInputItem as FileInputItemPrimitive,
  FileInputItemRemove as FileInputItemRemovePrimitive,
  FileInputList as FileInputListPrimitive,
  FileInput as FileInputPrimitive,
  FileInputTrigger as FileInputTriggerPrimitive,
  type FileInputValueChangeDetails,
  type FileRejection,
  type FileRejectionReason,
  type FileRules,
} from '@ui-sdk/react/file-input'
import type { VariantProps } from 'class-variance-authority'
import {
  type ComponentProps,
  createContext,
  type MouseEvent,
  type ReactNode,
  type Ref,
  use,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'

import { cn } from '@/lib/utils'

/*
 * Files picked, dropped or pasted, on ui-sdk's File input: it checks them
 * against `accept`, the sizes and the count, takes drops and pastes, says
 * what was added, removed or turned away, and submits them through its own
 * native input. Kino adds the look, the uploads (`registry/lib/uploads`)
 * with their status, the warning for files turned away, and the motion: a
 * row that arrives rises into place, and one that leaves fades where it was
 * while the rows below close its gap (`useFlow`).
 *
 * Files come in through a drop target: `FileInputDropzone`, an area of its
 * own in the Empty state's outlined look, or `FileInputBox`, a box the size
 * of a text field for a form where a file is one answer among others.
 */

/** The same file picked twice: same name, size and time it was last changed. */
function sameFile(a: File, b: File) {
  return a.name === b.name && a.size === b.size && a.lastModified === b.lastModified
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
function typeNames(accept: FileRules['accept']): string[] {
  const rules = typeof accept === 'string' ? accept.split(',') : (accept ?? [])
  const names = rules
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
function typesText(accept: FileRules['accept'], locale?: string) {
  const names = typeNames(accept)
  if (names.length === 0) return ''
  return new Intl.ListFormat(locale, { type: 'disjunction' }).format(names)
}

function capitalize(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/** Whether these rules hold one file at most. */
function holdsOne({ multiple, maxFiles }: FileRules) {
  return !multiple || maxFiles === 1
}

/** The limits, stated up front: “PDF, PNG or SVG · Up to 50 MB each · 20 files at most”. */
function limitsText(rules: FileRules, locale?: string) {
  const { accept, maxSize, maxFiles } = rules
  const one = holdsOne(rules)
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

/**
 * Why a file wasn't added, in a few words, from the first of its reasons:
 * ui-sdk's, `duplicate` from the File input's own check, or a reason a
 * `validate` gave, which reads as it is.
 */
function rejectionText(rejection: FileRejection, rules: FileRules, locale?: string) {
  const [reason] = rejection.reasons
  switch (reason) {
    case 'file-type': {
      const types = typesText(rules.accept, locale)
      return types ? `Only ${types}` : 'This type isn’t taken'
    }
    case 'file-too-large':
      return rules.maxSize === undefined
        ? 'Too large'
        : `${formatFileSize(rejection.file.size, locale)}, over ${formatFileSize(rules.maxSize, locale)}`
    case 'file-too-small':
      return rules.minSize === undefined
        ? 'Too small'
        : `${formatFileSize(rejection.file.size, locale)}, under ${formatFileSize(rules.minSize, locale)}`
    case 'duplicate':
      return 'Already in the list'
    case 'too-many-files':
      if (holdsOne(rules)) return 'Only one file goes here'
      return rules.maxFiles === undefined
        ? 'Too many files'
        : `Over the ${rules.maxFiles}-file limit`
    default:
      return reason ?? ''
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

interface FileInputContextValue {
  files: readonly File[]
  /** The rules it checks files by, for the words that state them. */
  rules: FileRules
  /** Whether files upload as they're added, rather than going with the form. */
  uploading: boolean
  /** Each file's upload. */
  uploads: ReadonlyMap<File, Upload>
  summary: UploadSummary
  retry: (file: File) => void
  retryFailed: () => void
  /** Cancels every upload still waiting or going up, and takes those files out. */
  cancelActive: () => void
  /** A submit is waiting for the uploads, and goes once they are up. */
  waiting: boolean
  /** What the last pick, drop or paste turned away. */
  rejected: readonly FileRejection[]
  dismissRejected: () => void
  disabled: boolean
  locale: string
  controller: FileInputController
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

type FileInputProps = Omit<
  ComponentProps<typeof FileInputPrimitive>,
  'className' | 'defaultValue'
> & {
  className?: string
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
  /** Formats the files' sizes; the browser's language when left out. */
  locale?: string
}

/** The reasons a change of files is a pick, a drop or a paste, which say again what was turned away. */
const ARRIVALS = new Set(['picker', 'drop', 'paste'])

/**
 * Holds the files, on ui-sdk's File input. A file pasted anywhere inside it,
 * such as on its button, is added as a picked one is, and a file that is
 * already in the list is turned away as `duplicate`.
 */
function FileInput({
  value,
  defaultValue,
  onValueChange,
  onReject,
  validate,
  upload,
  concurrency,
  accept,
  maxSize,
  minSize,
  maxFiles,
  multiple = false,
  name,
  disabled: disabledProp = false,
  locale: localeProp,
  controller: controllerProp,
  className,
  onPaste,
  children,
  ref,
  ...props
}: FileInputProps) {
  // The server writes sizes in en-US, then the visitor's own once the page has loaded.
  const locale = useLocale(localeProp)
  const field = useFieldControl()
  const disabled = disabledProp || field?.disabled === true
  // A saved file stands in the list as a File that holds no bytes.
  const [defaults] = useState(() =>
    (defaultValue ?? []).map((entry) =>
      entry instanceof File ? entry : savedFileOf(entry),
    ),
  )
  const [own, setOwn] = useState<File[]>(defaults)
  const files = value ?? own
  const [ownController] = useState(createFileInputController)
  const controller = controllerProp ?? ownController
  const rootRef = useRef<HTMLDivElement>(null)
  const refs = useMemo(() => mergeRefs(rootRef, ref), [ref])
  const { announce, region } = useAnnouncer()
  // The last change put a file in another's place.
  const [swapping, setSwapping] = useState(false)
  const [rejected, setRejected] = useState<FileRejection[]>([])
  const [waiting, setWaiting] = useState<{ submitter: HTMLElement | null } | null>(null)
  const rules: FileRules = { accept, maxSize, minSize, maxFiles, multiple }
  const uploads = useUploads({ files, upload, concurrency })
  const { summary } = uploads
  // A batch ended by a cancel isn't told as one that went up.
  const [cancelled, setCancelled] = useState(false)

  // The files held now, ahead of the render: two picks in one go each check against the last.
  const held = useRef(files)
  // Only a render's new files: an effect that runs again on the same render, as Strict Mode's does, would put back files older than a pick's.
  const rendered = useRef(files)
  useLayoutEffect(() => {
    if (rendered.current === files) return
    rendered.current = files
    held.current = files
  })

  const change = (next: File[], details: FileInputValueChangeDetails) => {
    onValueChange?.(next, details)
    if (details.canceled) return
    held.current = next
    if (value === undefined) setOwn(next)
    setSwapping(details.added.length > 0 && details.removed.length > 0)
    setCancelled(
      details.added.length === 0 &&
        details.removed.some((file) => uploads.active.includes(file)),
    )
    // What this pick turned away, or nothing once a pick adds them all.
    if (ARRIVALS.has(details.reason)) setRejected(details.rejected)
    if (details.reason === 'reset') setRejected([])
  }

  const cancelActive = () => {
    const active = uploads.active
    if (disabled || active.length === 0) return
    setWaiting(null)
    controller.setValue(files.filter((file) => !active.includes(file)))
  }

  /** The native input ui-sdk keeps the files in, which the form checks. */
  const control = () =>
    rootRef.current?.querySelector<HTMLInputElement>(':scope > input[type=file]') ?? null

  // A file that failed to upload holds the form back, as an invalid field
  // does; the Field reads the input's message again whenever it changes.
  const failure = summary.failed > 0 ? failedMessage(summary.failed) : ''
  useLayoutEffect(() => {
    const input = control()
    if (!input) return
    const message = disabled ? '' : failure
    if (input.validationMessage === message) return
    input.setCustomValidity(message)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }, [failure, disabled])

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
      const own = control()
      // A form that fails elsewhere goes on to say so; the wait is for one that's ready.
      const others = [...form.elements].filter(
        (element): element is HTMLInputElement =>
          'validity' in element && element !== own,
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

  const openPicker = (event: MouseEvent<HTMLElement>) => {
    if (disabled || event.defaultPrevented) return
    const target = event.target as HTMLElement
    if (target.closest('button, a, input, label, select, textarea, [role=listitem], li'))
      return
    controller.open()
  }

  return (
    <FileInputContext
      value={{
        files,
        rules,
        uploading: upload !== undefined,
        uploads: uploads.uploads,
        summary,
        retry: uploads.retry,
        retryFailed: uploads.retryFailed,
        cancelActive,
        waiting: waiting !== null,
        rejected,
        dismissRejected: () => setRejected([]),
        disabled,
        locale,
        controller,
        openPicker,
        announce,
      }}
    >
      <FileInputPrimitive
        {...props}
        ref={refs}
        value={value}
        // A form's reset goes back to the defaults; one held with none keeps its files, as ui-sdk's do.
        defaultValue={defaultValue === undefined ? undefined : defaults}
        onValueChange={change}
        onReject={(turnedAway, details) => {
          setRejected(turnedAway)
          onReject?.(turnedAway, details)
        }}
        validate={(file, batch) => {
          if (
            multiple &&
            (held.current.some((each) => sameFile(each, file)) ||
              batch.accepted.some((taken) => sameFile(taken, file)))
          )
            return 'duplicate'
          return validate?.(file, batch)
        }}
        accept={accept}
        maxSize={maxSize}
        minSize={minSize}
        maxFiles={maxFiles}
        multiple={multiple}
        // Files that upload send what each upload resolved with instead, so
        // the native input sends nothing; an empty name keeps the Field's.
        name={upload ? '' : name}
        disabled={disabled}
        controller={controller}
        data-swapping={swapping || undefined}
        onPaste={(event) => {
          onPaste?.(event)
          const pasted = [...event.clipboardData.files]
          if (event.defaultPrevented || pasted.length === 0) return
          event.preventDefault()
          controller.addFiles(pasted, { reason: 'paste', event: event.nativeEvent })
        }}
        className={cn('group/file-input flex min-w-0 flex-col gap-3', className)}
      >
        {(state) => (
          <>
            {typeof children === 'function' ? children(state) : children}
            {upload ? (
              // A disabled field sends nothing, as a disabled input doesn't.
              <FieldValues
                name={disabled ? undefined : (name ?? field?.name)}
                values={uploads.values}
                many={!holdsOne(rules)}
              />
            ) : null}
          </>
        )}
      </FileInputPrimitive>
      {region}
    </FileInputContext>
  )
}

type FileInputTriggerProps = Omit<
  ComponentProps<typeof FileInputTriggerPrimitive>,
  'className'
> & {
  className?: string
} & VariantProps<typeof buttonVariants>

/**
 * The way in by keyboard and pointer: ui-sdk's trigger, in a Kino Button's
 * look, which opens the browser's file picker. In a Field, the Field's label
 * and its own text name it ("Receipts, Choose files").
 */
/** Each look's own edge, which an invalid Button would turn red. */
const keptBorder = {
  default:
    'in-data-[slot=file-input-dropzone]:aria-invalid:not-focus-visible:border-transparent',
  outline:
    'in-data-[slot=file-input-dropzone]:aria-invalid:not-focus-visible:border-border dark:in-data-[slot=file-input-dropzone]:aria-invalid:not-focus-visible:border-input',
  secondary:
    'in-data-[slot=file-input-dropzone]:aria-invalid:not-focus-visible:border-transparent',
  ghost:
    'in-data-[slot=file-input-dropzone]:aria-invalid:not-focus-visible:border-transparent',
  destructive:
    'in-data-[slot=file-input-dropzone]:aria-invalid:not-focus-visible:border-transparent',
  link: 'in-data-[slot=file-input-dropzone]:aria-invalid:not-focus-visible:border-transparent',
} satisfies Record<NonNullable<FileInputTriggerProps['variant']>, string>

function FileInputTrigger({
  className,
  variant = 'outline',
  size = 'default',
  ...props
}: FileInputTriggerProps) {
  return (
    <FileInputTriggerPrimitive
      {...props}
      className={cn(
        buttonVariants({ variant, size }),
        // In a box, the box's ring shows the focus, as a text field's does,
        // and a disabled box or zone fades once, not twice.
        'in-data-file-input-box:focus-visible:border-transparent in-data-file-input-box:focus-visible:ring-0 in-data-file-input-box:data-disabled:opacity-100 in-data-[slot=file-input-dropzone]:data-disabled:opacity-100',
        // It is the Field's control, so it says it's invalid; the zone or box around it shows it, once.
        'in-data-[slot=file-input-dropzone]:aria-invalid:not-focus-visible:ring-0',
        keptBorder[variant ?? 'default'],
        className,
      )}
    />
  )
}

interface PageDrag {
  /** A file is being dragged somewhere over the page. */
  dragging: boolean
  /** How many files it carries; 0 when the browser doesn't say. */
  count: number
}

/*
 * Whether a file is being dragged over the page, and how many, shared by
 * every drop target on it: one listener on the window while any is mounted.
 * It is for the look only: ui-sdk takes the drop, and stops one that lands
 * outside every drop target from opening the file in place of the page.
 */
const pageDrag = {
  depth: 0,
  state: { dragging: false, count: 0 } as PageDrag,
  listeners: new Set<() => void>(),
}

function hasFiles(event: globalThis.DragEvent) {
  return event.dataTransfer?.types.includes('Files') ?? false
}

function setPageDrag(state: PageDrag) {
  if (pageDrag.state.dragging === state.dragging && pageDrag.state.count === state.count)
    return
  pageDrag.state = state
  for (const listener of pageDrag.listeners) listener()
}

function onPageDragEnter(event: globalThis.DragEvent) {
  if (!hasFiles(event)) return
  pageDrag.depth += 1
  const items = [...(event.dataTransfer?.items ?? [])]
  setPageDrag({
    dragging: true,
    count: items.filter((item) => item.kind === 'file').length,
  })
}

function onPageDragLeave(event: globalThis.DragEvent) {
  if (!hasFiles(event)) return
  pageDrag.depth = Math.max(0, pageDrag.depth - 1)
  // Leaving the window has no element to go to.
  if (pageDrag.depth === 0 || event.relatedTarget === null) onPageDragEnd()
}

function onPageDragEnd() {
  pageDrag.depth = 0
  setPageDrag({ dragging: false, count: 0 })
}

const pageEvents = [
  ['dragenter', onPageDragEnter],
  ['dragleave', onPageDragLeave],
  ['drop', onPageDragEnd],
  ['dragend', onPageDragEnd],
] as const

function subscribePageDrag(listener: () => void) {
  if (pageDrag.listeners.size === 0) {
    for (const [type, handler] of pageEvents)
      window.addEventListener(type, handler, { capture: true })
  }
  pageDrag.listeners.add(listener)
  return () => {
    pageDrag.listeners.delete(listener)
    if (pageDrag.listeners.size > 0) return
    for (const [type, handler] of pageEvents)
      window.removeEventListener(type, handler, { capture: true })
    pageDrag.depth = 0
    pageDrag.state = { dragging: false, count: 0 }
  }
}

const notDragging: PageDrag = { dragging: false, count: 0 }

function usePageDrag() {
  return useSyncExternalStore(
    subscribePageDrag,
    () => pageDrag.state,
    () => notDragging,
  )
}

/** A drop target's state: ui-sdk's, with how many files the drag carries. */
type FileInputDropzoneState = DropzoneState & {
  /** How many files are being dragged; 0 when the browser doesn't say. */
  count: number
}

/**
 * The files, one row each, from `children`: a function that takes a file and
 * returns its `FileInputItem`. A row that arrives rises into place, and one
 * that leaves fades where it was while the rest close its gap. The list is
 * one tab stop: the arrow keys move between rows, and Delete removes one.
 */
function FileInputList({
  className,
  children,
  ...props
}: Omit<ComponentProps<typeof FileInputListPrimitive>, 'className' | 'children'> & {
  className?: string
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
      <FileInputListPrimitive
        {...props}
        className={cn(
          'group/file-input-list relative isolate flex flex-col gap-2 has-[>li:not([data-leaving])]:pt-3',
          className,
        )}
        // ui-sdk types a part's ref by its default tag; this one is the list element.
        ref={listRef as unknown as Ref<HTMLDivElement>}
        // Each row is what `children` makes of its file, in a list element.
        render={
          <ul>
            {files.map((file, index) => (
              <FileItemContext key={fileKey(file)} value={file}>
                {children(file, index)}
              </FileItemContext>
            ))}
          </ul>
        }
      />
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
 * A file's row, on ui-sdk's item: its picture or icon, its name and size,
 * and a button that removes it. Given `progress`, it shows the upload
 * drawing on its track, then a tick once it reaches 100; given `error`, it
 * says why it failed. While it uploads, its end button cancels the upload,
 * and says so. `children` are more actions, such as a Retry button, before
 * the remove one.
 */
function FileInputItem({
  className,
  progress: progressProp,
  error: errorProp,
  children,
  ref,
  ...props
}: Omit<
  ComponentProps<typeof FileInputItemPrimitive>,
  'className' | 'children' | 'file'
> & {
  className?: string
  /** How far its upload has got, from 0 to 100; `null` while that isn't known. Left out, it shows its own upload's, if the FileInput has `upload`, or no track. */
  progress?: number | null
  /** Why its upload failed. Left out, it shows why its own upload did. */
  error?: ReactNode
  children?: ReactNode
}) {
  const file = use(FileItemContext)
  if (!file) throw new Error('A FileInputItem goes inside a FileInputList.')
  const { disabled, locale, announce, uploads, retry } = useFileInput()
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
  const id = useId()

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

  // A control that goes with a state, such as Retry, takes the focus with
  // it: the row keeps it.
  const rowRef = useRef<HTMLDivElement>(null)
  const refs = useMemo(() => mergeRefs(rowRef, ref), [ref])
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
    if (active === null || active === document.body) row.focus()
  }, [state])

  return (
    <FileInputItemPrimitive
      {...props}
      ref={refs}
      file={file}
      data-state={state}
      // Named by its file and its line, read apart: "receipt.pdf, 1.2 MB · Uploaded".
      aria-labelledby={`${id}-name ${id}-status`}
      render={<li />}
      className={cn(
        // A container, so a row too narrow for its picture gives that room to its words.
        'group/file-item @container/file-item bg-card flex min-w-0 items-center gap-3 rounded-(--surface-radius) border p-(--control-padding) shadow-xs',
        // The list's one tab stop: the row that has it shows the controls' ring.
        'focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-hidden',
        // Once the list has painted, it fades in on `enter` and rises on
        // `layout`, the role its glides to a new place take too (`useFlow`);
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
          id={`${id}-name`}
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
            state rolls in through `Swap`. An agent reads the row by its
            file's name alone, as ui-sdk lists the files, so a step that names
            a file still finds it while its status changes. */}
        <span
          ref={lineRef}
          id={`${id}-status`}
          data-slot='file-input-item-status'
          data-agent-hidden=''
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
          data-file-input-item-retry=''
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
      {/* Out of the tab order, as Delete on the row does the same. */}
      <FileInputItemRemovePrimitive
        data-file-input-item-remove=''
        aria-label={removeLabel(file.name, state)}
        className={buttonVariants({ variant: 'ghost', size: 'icon-sm' })}
      >
        <IconPlaceholder
          lucide='XIcon'
          tabler='IconX'
          hugeicons='Cancel01Icon'
          phosphor='XIcon'
          remixicon='RiCloseLine'
          aria-hidden
        />
      </FileInputItemRemovePrimitive>
    </FileInputItemPrimitive>
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
  const { rejected, dismissRejected, rules, locale } = useFileInput()
  return (
    <div
      data-slot='file-input-rejected'
      // Closed, it gives back the gap above it; open, the gap is inside what it measures.
      className={cn(
        '-mt-3 [&_[data-alert-panel]]:flow-root [&_[data-slot=alert-surface]]:mt-3',
        className,
      )}
      {...props}
    >
      <FileRejections
        rejected={rejected}
        rules={rules}
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
      // Closed, it holds nothing for an agent to read or open: only files turned away open it.
      data-agent-hidden={rejected.length > 0 ? undefined : ''}
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
                key={`${rejection.file.name}-${rejection.reasons.join()}`}
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
    controller,
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

  const rowOf = (states: string) =>
    rootRef.current
      ?.closest('[data-slot=file-input]')
      ?.querySelector<HTMLElement>(`[data-slot=file-input-item]:is(${states})`)
  /** Where the focus goes when the button goes: the first row left, or the way in. */
  const focusAfterAction = () => {
    const row = rowOf('[data-state=complete],[data-state=failed],[data-state=idle]')
    if (row) row.focus()
    else controller.focus()
  }
  // The button goes once nothing is left to cancel or retry: the focus goes with it.
  useEffect(() => {
    if (!action && actionRef.current?.contains(document.activeElement)) focusAfterAction()
  })
  const cancel = () => {
    const left = files.length - summary.active
    cancelActive()
    if (left === 0) controller.focus()
    else focusAfterAction()
  }
  // Retry goes with the failures: the focus goes to the first file it retries.
  const retry = () => {
    rowOf('[data-state=failed]')?.focus()
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
      <Collapsible
        open={state !== 'empty'}
        // The files open and close it, so an agent can't either; it reads as the uploads' summary.
        disabled
        role='group'
        aria-label='Uploads'
      >
        <CollapsiblePanel className='p-0 pt-3'>
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
              // Kept in place while it's open, so it fades out on `exit` rather than vanishing.
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
            ) : null}
          </div>
        </CollapsiblePanel>
      </Collapsible>
    </div>
  )
}

/** A drop target's look from its state: ui-sdk's attributes, and ours for a drag anywhere on the page. */
function useDropzone(className: string, own: string | undefined) {
  const { openPicker, disabled } = useFileInput()
  const page = usePageDrag()
  return {
    page,
    props: {
      'data-page-drag': page.dragging || undefined,
      // Says the faded words are off, as the button inside does.
      'aria-disabled': disabled || undefined,
      onClick: openPicker,
      className: cn(
        className,
        'data-disabled:pointer-events-none data-disabled:opacity-50',
        own,
      ),
    },
  }
}

/*
 * The dropzone: ui-sdk's drop target, above the list, in the Empty state's
 * outlined look. While a file is dragged anywhere on the page its edge
 * darkens, so it says where to go; over it, the edge and a tint come in on
 * `press` and its picture lifts on `enter`. A press anywhere on it opens
 * the picker, as its button does.
 */

const dropzoneClassName = cn(
  emptyVariants({ variant: 'outline' }),
  'group/dropzone relative transition-[background-color,border-color,box-shadow] duration-(--motion-press-duration) ease-(--motion-press-fade-easing)',
  'has-aria-invalid:border-destructive/60 forced-colors:has-aria-invalid:outline-2 forced-colors:has-aria-invalid:outline-offset-1 forced-colors:has-aria-invalid:outline-dashed',
  'data-page-drag:border-foreground/30',
  'data-dragging:border-primary data-dragging:bg-primary/[0.02] data-dragging:ring-3 data-dragging:ring-ring/30 dark:data-dragging:bg-primary/[0.07] forced-colors:data-dragging:border-[Highlight] forced-colors:data-dragging:border-solid',
  'data-drag-reject:border-destructive data-drag-reject:bg-destructive/[0.02] data-drag-reject:ring-destructive/20 dark:data-drag-reject:bg-destructive/[0.08] forced-colors:data-drag-reject:border-[Mark]',
  // The picture lifts towards the file over it, and settles when it leaves.
  '[&_[data-slot=empty-media]]:transition-[scale,translate] [&_[data-slot=empty-media]]:duration-(--motion-enter-duration) [&_[data-slot=empty-media]]:ease-(--motion-enter-easing) motion-safe:data-dragging:[&_[data-slot=empty-media]]:-translate-y-1 motion-safe:data-dragging:[&_[data-slot=empty-media]]:scale-110',
)

function FileInputDropzone({
  className,
  children,
  ...props
}: Omit<ComponentProps<typeof FileInputDropzonePrimitive>, 'className' | 'children'> & {
  className?: string
  /** Its content, or a function of the drag's state, to say something else while a file is over it. */
  children?: ReactNode | ((state: FileInputDropzoneState) => ReactNode)
}) {
  const { page, props: own } = useDropzone(dropzoneClassName, className)
  return (
    <FileInputDropzonePrimitive {...props} {...own}>
      {(state) =>
        typeof children === 'function'
          ? children({ ...state, count: page.count })
          : children
      }
    </FileInputDropzonePrimitive>
  )
}

/*
 * The box: ui-sdk's drop target as a box the size of a text field, with the
 * Input's edge and focus ring, for a form where a file is one answer among
 * others. It says what to do, and while a file is over it, what the drop
 * will do; the words change in place (`SwapText`). The button at its end is
 * the way in by keyboard.
 */

const boxClassName = cn(
  inputBoxClassName,
  'h-(--control-height) gap-2 ps-(--control-padding) pe-[calc((var(--control-height)-var(--control-height-xs))/2-1px)]',
  'data-page-drag:border-dashed data-page-drag:border-foreground/30',
  'data-dragging:border-solid data-dragging:border-ring data-dragging:ring-3 data-dragging:ring-ring/50 forced-colors:data-dragging:outline-2 forced-colors:data-dragging:outline-[Highlight]',
  'data-drag-reject:border-destructive data-drag-reject:ring-destructive/20 dark:data-drag-reject:ring-destructive/40',
)

/** What the box says: what to do, or what a drop of the files over it will do. */
function boxText(
  state: FileInputDropzoneState,
  one: boolean,
  placeholder: string | undefined,
) {
  if (!state.dragging)
    return placeholder ?? (one ? 'Drop a file here' : 'Drop files here')
  if (state.dragReject)
    return `Can’t add ${state.count === 1 ? 'this type' : 'these types'}`
  if (one || state.count === 1) return 'Drop to add it'
  return state.count > 1 ? `Drop to add ${state.count} files` : 'Drop to add them'
}

function FileInputBox({
  className,
  placeholder,
  children,
  ...props
}: Omit<ComponentProps<typeof FileInputDropzonePrimitive>, 'className' | 'children'> & {
  className?: string
  /** What it says while no file is over it: “Drop files here”, or “Drop a file here” for one file. */
  placeholder?: string
  children?: ReactNode
}) {
  const { rules } = useFileInput()
  const { page, props: own } = useDropzone(boxClassName, className)
  return (
    <FileInputDropzonePrimitive
      {...props}
      {...own}
      // A box, not a zone: the trigger inside it reads which.
      data-file-input-box=''
    >
      {(state) => {
        const drag = { ...state, count: page.count }
        return (
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
                drag.dragging && 'text-foreground',
                drag.dragReject && 'text-destructive',
              )}
            >
              <SwapText text={boxText(drag, holdsOne(rules), placeholder)} />
            </span>
            <InputInvalidIcon className='pe-0' />
            {children}
          </>
        )
      }}
    </FileInputDropzonePrimitive>
  )
}

export {
  createFileInputController,
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
  FileInputController,
  FileInputDropzoneState,
  FileInputValueChangeDetails,
  FileRejection,
  FileRejectionReason,
  FileRules,
  SavedFile,
  UploadFile,
  UploadOptions,
}

export {
  boxText,
  sameFile,
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
