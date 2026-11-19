'use client'

import { settle } from '@/registry/lib/settle'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

/*
 * Each file's upload, for a list of files someone else holds, such as a
 * File input's, followed from the list itself, whoever changes it: a file added waits its turn, uploads with its progress, and
 * ends uploaded, with what the server gave back for it, or failed. A few
 * upload at once; a file taken out has its upload cancelled, and a failed
 * one can be tried again. A saved file, such as one an edit form opens
 * with, stands in the list as uploaded and never uploads.
 */

/** Where a file's upload is. */
type UploadStatus = 'queued' | 'uploading' | 'done' | 'failed'

interface Upload {
  status: UploadStatus
  /** How many of its bytes have gone up. */
  loaded: number
  /** What a form sends for it once it is up: what `upload` resolved with. */
  value?: string
  /** Why it failed, when it did. */
  error?: string
}

interface UploadOptions {
  /** Aborts when the person cancels the upload: stop sending, and the promise's answer is ignored. */
  signal: AbortSignal
  /** Call with how many bytes have gone up so far. */
  onProgress: (loaded: number) => void
}

/**
 * Sends one file. Resolves, once it is stored, with what a form sends for
 * it, such as its id; throws an `Error` whose message says why not.
 */
type UploadFile = (file: File, options: UploadOptions) => Promise<string>

/** A file already saved, such as one an edit form opens with. */
interface SavedFile {
  /** What a form sends for it, such as its id. */
  value: string
  name: string
  /** In bytes. */
  size: number
  /** Its MIME type, for its picture. */
  type?: string
}

const savedValues = new WeakMap<File, string>()

/** A `File` that stands for a saved one in a list: it holds no bytes and never uploads. */
function savedFileOf(saved: SavedFile) {
  const file = new File([], saved.name, { type: saved.type ?? '', lastModified: 0 })
  Object.defineProperty(file, 'size', { value: saved.size })
  savedValues.set(file, saved.value)
  return file
}

/** What a form sends for a saved file's stand-in; nothing for any other file. */
function savedValueOf(file: File) {
  return savedValues.get(file)
}

/** A file's upload: its record, or, with none, uploaded if it stands for a saved file and waiting if files upload. */
function uploadOf(
  file: File,
  record: Upload | undefined,
  uploading: boolean,
): Upload | undefined {
  if (record) return record
  const value = savedValueOf(file)
  if (value !== undefined) return { status: 'done', loaded: file.size, value }
  return uploading ? { status: 'queued', loaded: 0 } : undefined
}

/** The files that start uploading now: the first that wait, up to `concurrency` uploading at once. */
function startable(
  files: readonly File[],
  uploads: ReadonlyMap<File, Upload>,
  concurrency: number,
): File[] {
  const running = files.filter((file) => uploads.get(file)?.status === 'uploading').length
  const room = Math.max(0, concurrency - running)
  return files.filter((file) => uploads.get(file)?.status === 'queued').slice(0, room)
}

interface UploadSummary {
  /** Files in the list. */
  count: number
  done: number
  failed: number
  /** Waiting or uploading. */
  active: number
  /** Bytes gone up, a failed file's counted as finished with, so a bar never goes back. */
  loaded: number
  /** Bytes of every file. */
  total: number
  /** How far the whole batch has got, from 0 to 100. */
  percent: number
}

/** Where the files' uploads are, taken together. */
function summarize(
  files: readonly File[],
  uploads: ReadonlyMap<File, Upload>,
): UploadSummary {
  let done = 0
  let failed = 0
  let active = 0
  let loaded = 0
  let total = 0
  for (const file of files) {
    const upload = uploads.get(file)
    total += file.size
    if (upload?.status === 'done') done += 1
    else if (upload?.status === 'failed') failed += 1
    else if (upload) active += 1
    const finished = upload?.status === 'done' || upload?.status === 'failed'
    loaded += finished ? file.size : Math.min(upload?.loaded ?? 0, file.size)
  }
  const percent = total > 0 ? (loaded / total) * 100 : active === 0 ? 100 : 0
  return { count: files.length, done, failed, active, loaded, total, percent }
}

/** A row's progress: 100 once it's up, 0 while it waits, and none when it doesn't upload. */
function rowProgress(upload: Upload | undefined, size: number): number | undefined {
  if (!upload) return undefined
  if (upload.status === 'done') return 100
  if (size === 0) return 0
  // Held under 100 until the server says it's stored: the last byte isn't the end.
  return Math.min(99, (upload.loaded / size) * 100)
}

/** Why an upload failed, in the person's words. */
function failureText(reason: unknown) {
  if (reason instanceof Error && reason.message) return reason.message
  if (typeof reason === 'string' && reason) return reason
  return 'Couldn’t be uploaded. Try again.'
}

/** What a screen reader hears once nothing is left uploading. */
function settledAnnouncement(summary: UploadSummary) {
  if (summary.count === 0 || summary.active > 0) return ''
  if (summary.failed === 0)
    return summary.done === 1 ? 'Upload complete' : `All ${summary.done} files uploaded`
  return `${summary.done} uploaded, ${summary.failed} failed`
}

/**
 * The uploads of `files`: a file added waits its turn, and one taken out has
 * its upload cancelled. Without `upload`, nothing uploads, and only saved
 * files count as uploaded.
 */
function useUploads({
  files,
  upload,
  concurrency = 3,
}: {
  files: readonly File[]
  upload?: UploadFile
  /** How many files upload at once. */
  concurrency?: number
}) {
  // The uploads that have started, ended or been retried; a file with none
  // waits its turn, or is uploaded if it stands for a saved one.
  const [records, setRecords] = useState<ReadonlyMap<File, Upload>>(() => new Map())
  const controllers = useRef(new Map<File, AbortController>())
  const latest = useRef(upload)
  useLayoutEffect(() => {
    latest.current = upload
  })

  // Progress arrives far more often than a screen can show it: one render a frame.
  const pending = useRef(new Map<File, number>())
  const frame = useRef(0)
  const flush = useCallback(() => {
    frame.current = 0
    const loaded = new Map(pending.current)
    pending.current.clear()
    setRecords((last) => {
      const next = new Map(last)
      for (const [file, bytes] of loaded) {
        const now = next.get(file)
        if (now?.status === 'uploading') next.set(file, { ...now, loaded: bytes })
      }
      return next
    })
  }, [])

  const set = useCallback((file: File, entry: Upload | null) => {
    pending.current.delete(file)
    setRecords((last) => {
      const next = new Map(last)
      if (entry) next.set(file, entry)
      else next.delete(file)
      return next
    })
  }, [])

  const begin = useCallback(
    (file: File) => {
      const send = latest.current
      if (controllers.current.has(file) || !send) return
      const controller = new AbortController()
      controllers.current.set(file, controller)
      set(file, { status: 'uploading', loaded: 0 })
      const onProgress = (loaded: number) => {
        if (controller.signal.aborted) return
        pending.current.set(file, loaded)
        if (!frame.current) frame.current = requestAnimationFrame(flush)
      }
      settle(
        () => send(file, { signal: controller.signal, onProgress }),
        (ok, _waited, reason, value) => {
          if (controller.signal.aborted) return
          controllers.current.delete(file)
          set(
            file,
            ok
              ? { status: 'done', loaded: file.size, value: String(value ?? '') }
              : { status: 'failed', loaded: 0, error: failureText(reason) },
          )
        },
      )
    },
    [flush, set],
  )

  // Each file's upload, from the list itself: whoever changed it, a file
  // added waits its turn, and one taken out is cancelled below.
  const uploads = new Map<File, Upload>()
  for (const file of files) {
    const entry = uploadOf(file, records.get(file), upload !== undefined)
    if (entry) uploads.set(file, entry)
  }

  useEffect(() => {
    for (const file of startable(files, uploads, concurrency)) begin(file)
    // A file taken out of the list stops going up, and its record goes.
    for (const [file, controller] of controllers.current) {
      if (files.includes(file)) continue
      controller.abort()
      controllers.current.delete(file)
    }
    const gone = [...records.keys()].filter((file) => !files.includes(file))
    // Once this commit is done, so a file added back starts afresh.
    if (gone.length > 0) queueMicrotask(() => gone.forEach((file) => set(file, null)))
  })

  // Leaving the page cancels what is still going up.
  useEffect(() => {
    const running = controllers.current
    return () => {
      cancelAnimationFrame(frame.current)
      frame.current = 0
      for (const controller of running.values()) controller.abort()
      running.clear()
    }
  }, [])

  /** Tries a failed file again, where it is in the list. */
  const retry = (file: File) => {
    if (uploads.get(file)?.status === 'failed') set(file, null)
  }

  /** The files still waiting or going up. */
  const active = files.filter((file) => {
    const status = uploads.get(file)?.status
    return status === 'queued' || status === 'uploading'
  })

  /** What a form sends: each uploaded or saved file's value, in the list's order. */
  const values = files.flatMap((file) => {
    const value = uploads.get(file)?.value
    return value === undefined ? [] : [value]
  })

  return {
    uploads,
    summary: summarize(files, uploads),
    values,
    active,
    retry,
    /** Tries every failed file again. */
    retryFailed: () => {
      for (const file of files) retry(file)
    },
  }
}

export { savedFileOf, savedValueOf, useUploads }

export type { SavedFile, Upload, UploadFile, UploadOptions, UploadStatus, UploadSummary }

export { failureText, rowProgress, settledAnnouncement, startable, summarize, uploadOf }
