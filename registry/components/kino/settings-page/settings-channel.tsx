'use client'

import { Card } from '@/registry/components/kino/card'
import { Collapsible, CollapsiblePanel } from '@/registry/components/kino/collapsible'
import {
  Field,
  FieldDescription,
  FieldLabel,
  useFormSubmission,
} from '@/registry/components/kino/field'
import { ItemMedia } from '@/registry/components/kino/item'
import { Switch } from '@/registry/components/kino/switch'
import { type ComponentProps, type ReactNode, useId, useState } from 'react'

import { cn } from '@/lib/utils'

/*
 * One way notifications reach the person, such as email or Slack: a switch
 * for the whole channel, and under it a row for each kind of notification
 * it sends. Turned off, the rows fold away under the switch, keeping what
 * they were set to for when it's turned back on; they still go with Save.
 */

function SettingsChannel({
  name,
  label,
  description,
  icon,
  defaultChecked = true,
  className,
  children,
  ...props
}: Omit<ComponentProps<'div'>, 'children'> & {
  /** What Save sends the channel's switch under. */
  name: string
  label: ReactNode
  description?: ReactNode
  /** In a tile before the label. */
  icon?: ReactNode
  /** Whether the channel is on, as it was saved. */
  defaultChecked?: boolean
  /** A SettingsRow for each kind of notification, each with a Switch. */
  children: ReactNode
}) {
  const [on, setOn] = useState(defaultChecked)
  // Discard puts every field back, the switch with them: the rows fold or
  // unfold to follow it, rather than the card starting again.
  const revision = useFormSubmission()?.revision ?? 0
  const [shownRevision, setShownRevision] = useState(revision)
  if (revision !== shownRevision) {
    setShownRevision(revision)
    setOn(defaultChecked)
  }
  const labelId = useId()
  return (
    <Card
      role='group'
      aria-labelledby={labelId}
      data-slot='settings-channel'
      {...props}
      className={cn('@container gap-0 py-0', className)}
    >
      <Field
        name={name}
        className="grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 px-(--surface-padding) py-(--surface-padding) [grid-template-areas:'icon_label_control'_'icon_message_control']"
      >
        {icon ? (
          <ItemMedia variant='icon' className='[grid-area:icon]'>
            {icon}
          </ItemMedia>
        ) : null}
        <FieldLabel id={labelId} className='self-end pb-0.5 text-sm font-semibold'>
          {label}
        </FieldLabel>
        {description ? (
          <FieldDescription className='self-start pt-0.5'>{description}</FieldDescription>
        ) : null}
        <Switch checked={on} onCheckedChange={setOn} className='[grid-area:control]' />
      </Field>
      <Collapsible open={on}>
        <CollapsiblePanel keepMounted className='p-0'>
          <div className='flex min-w-0 flex-col divide-y border-t'>{children}</div>
        </CollapsiblePanel>
      </Collapsible>
    </Card>
  )
}

export { SettingsChannel }
