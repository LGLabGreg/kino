'use client'

import { Avatar, AvatarFallback, AvatarImage } from '@/registry/components/kino/avatar'
import { Button } from '@/registry/components/kino/button'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/registry/components/kino/dialog'
import { Field, FieldDescription, FieldLabel } from '@/registry/components/kino/field'
import { FileInput, FileInputTrigger } from '@/registry/components/kino/file-input'
import {
  type Crop,
  cropImage,
  ImageCropper,
  ImageCropperArea,
  ImageCropperPreview,
  ImageCropperRotate,
  ImageCropperZoom,
} from '@/registry/components/kino/image-cropper'
import { FieldWiring, OutsideField } from '@/registry/lib/field-control'
import { type ReactNode, useEffect, useMemo, useState } from 'react'

import { cn } from '@/lib/utils'

/*
 * A profile photo as a setting: the photo, or the initials without one, and
 * Upload and Remove beside it. An upload opens the Image cropper in a
 * dialog, round, and the crop it keeps shows at once and waits for Save as
 * any other change does; Discard brings the old photo back. What Save sends
 * under `name` is the cropped image as a File, `null` once removed, or the
 * photo's address when it hasn't changed.
 */

/** What the photo setting holds: the saved photo's address, a new image, or none. */
type SettingsPhotoValue = string | File | null

/** A new image's address while it shows, released once another takes its place. */
function usePreview(value: SettingsPhotoValue) {
  const url = useMemo(
    () => (value instanceof Blob ? URL.createObjectURL(value) : null),
    [value],
  )
  useEffect(() => () => (url ? URL.revokeObjectURL(url) : undefined), [url])
  return typeof value === 'string' ? value : url
}

function SettingsPhoto({
  name = 'photo',
  label = 'Photo',
  description,
  defaultValue = null,
  fallback,
  alt = '',
  className,
}: {
  name?: string
  label?: ReactNode
  description?: ReactNode
  /** The saved photo's address, or `null` for none. */
  defaultValue?: string | null
  /** Shown without a photo: the person's initials. */
  fallback: ReactNode
  /** The person's name, for the cropper's picture. */
  alt?: string
  className?: string
}) {
  return (
    <Field
      name={name}
      data-slot='settings-photo'
      className={cn(
        "grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 p-(--surface-padding) [grid-template-areas:'picture_label'_'picture_message'_'control_control'] @md:grid-cols-[auto_minmax(0,1fr)_auto] @md:[grid-template-areas:'picture_label_control'_'picture_message_control']",
        className,
      )}
    >
      <PhotoControl
        name={name}
        defaultValue={defaultValue}
        fallback={fallback}
        alt={alt}
        label={label}
        description={description}
      />
    </Field>
  )
}

function PhotoControl({
  name,
  defaultValue,
  fallback,
  alt,
  label,
  description,
}: {
  name: string
  defaultValue: string | null
  fallback: ReactNode
  alt: string
  label: ReactNode
  description: ReactNode
}) {
  // Remounted by Discard, as every Field is, so it starts again from what was saved.
  const [value, setValue] = useState<SettingsPhotoValue>(defaultValue)
  const shown = usePreview(value)
  // The upload's own file input: where the label and a failed check send focus.
  const [upload, setUpload] = useState<HTMLInputElement | null>(null)

  // The image picked and waiting to be cropped, with its address.
  const [picked, setPicked] = useState<{ file: File; url: string } | null>(null)
  useEffect(() => (picked ? () => URL.revokeObjectURL(picked.url) : undefined), [picked])
  const [open, setOpen] = useState(false)
  const [crop, setCrop] = useState<Crop | null>(null)
  const [cropping, setCropping] = useState(false)
  const [failed, setFailed] = useState(false)

  // FieldWiring takes each new value as the person's edit.
  const change = (next: SettingsPhotoValue) => setValue(next)

  const keep = async () => {
    if (!picked || !crop) return
    setCropping(true)
    setFailed(false)
    try {
      const blob = await cropImage(picked.url, crop, { shape: 'circle', maxWidth: 512 })
      change(new File([blob], 'photo.png', { type: blob.type || 'image/png' }))
      setOpen(false)
    } catch {
      setFailed(true)
    } finally {
      setCropping(false)
    }
  }

  return (
    <>
      <Avatar
        size='lg'
        className='size-14 text-base [grid-area:picture] [--avatar-size:3.5rem]'
      >
        {shown ? <AvatarImage src={shown} alt='' draggable={false} /> : null}
        <AvatarFallback>{fallback}</AvatarFallback>
      </Avatar>
      <FieldLabel className='self-end pb-0.5'>{label}</FieldLabel>
      {description ? (
        <FieldDescription className='self-start pt-0.5'>{description}</FieldDescription>
      ) : null}
      <FieldWiring value={value} filled={value !== null} disabled={false} name={name}>
        {({ control }) => (
          // What the label points at and the form's checks read: focus that reaches it goes on to the upload.
          <input
            {...control}
            type='text'
            tabIndex={-1}
            aria-hidden
            name={name}
            value={typeof value === 'string' ? value : value ? value.name : ''}
            onChange={() => {}}
            onFocus={() => upload?.focus()}
            className='sr-only'
          />
        )}
      </FieldWiring>
      <div className='flex flex-wrap items-center gap-2 pt-3 [grid-area:control] @md:justify-end @md:pt-0'>
        <OutsideField>
          <FileInput
            accept='image/*'
            multiple={false}
            value={[]}
            onValueChange={(files) => {
              const file = files[0]
              if (!file) return
              setPicked({ file, url: URL.createObjectURL(file) })
              setCrop(null)
              setFailed(false)
              setOpen(true)
            }}
          >
            <FileInputTrigger ref={setUpload} size='sm'>
              {value === null ? 'Upload photo' : 'Change photo'}
            </FileInputTrigger>
          </FileInput>
        </OutsideField>
        <Button
          type='button'
          variant='ghost'
          size='sm'
          disabled={value === null}
          focusableWhenDisabled
          onClick={() => change(null)}
        >
          Remove photo
        </Button>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Crop your photo</DialogTitle>
            <DialogDescription>
              Move and zoom until your face fills the circle.
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            {picked ? (
              <ImageCropper
                key={picked.url}
                src={picked.url}
                alt={alt}
                shape='circle'
                onValueCommitted={setCrop}
              >
                <div className='flex min-w-0 gap-4'>
                  <ImageCropperArea
                    mode='frame'
                    className='h-72 flex-1'
                    aria-label='Photo'
                  />
                  <div className='hidden flex-col items-center gap-3 pt-1 @sm:flex'>
                    <ImageCropperPreview className='size-16' />
                    <ImageCropperPreview className='size-10' />
                    <ImageCropperPreview className='size-6' />
                  </div>
                </div>
                <div className='flex min-w-0 items-center gap-4'>
                  <ImageCropperZoom className='flex-1' />
                  <ImageCropperRotate />
                </div>
              </ImageCropper>
            ) : null}
          </DialogBody>
          <DialogFooter>
            {failed ? (
              <p role='alert' className='text-destructive w-full text-sm'>
                The photo couldn’t be cropped. Try another.
              </p>
            ) : null}
            <DialogClose render={<Button variant='outline' size='sm' />}>
              Cancel
            </DialogClose>
            <Button size='sm' loading={cropping} disabled={!crop} onClick={keep}>
              Use photo
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

export { SettingsPhoto }

export type { SettingsPhotoValue }
