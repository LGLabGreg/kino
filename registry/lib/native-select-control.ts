import { type ChangeDetails, createChange, definePrimitive } from '@ui-sdk/core'

/*
 * The browser's own `<select>` as a ui-sdk primitive: the Native select's.
 * The select keeps its value and its options, as a native one does; this
 * reads them, so an agent's `snapshot()` lists the select with its name,
 * value and options, and `setValue` picks an option as a person does, with
 * `change` and `input` events the page hears. Each change reaches
 * `onValueChange` with who made it in `details.source`.
 */

/** Why the value changed: a pick in the select, a form's reset, or code and agents (`imperative`). */
type NativeSelectReason = 'input-change' | 'reset' | 'imperative'

type NativeSelectOptions = {
  /** Called after each change of the picked option, with who made it in `details.source`; `details.cancel()` puts the last one back. */
  onValueChange?: (value: string, details: ChangeDetails<NativeSelectReason>) => void
}

const nativeSelectControl = definePrimitive({
  name: 'native-select-control',
  options: { onValueChange: 'callback' },
  // The primitive reads its options' type from this parameter; the select holds the value.
  state: (options: NativeSelectOptions) => {
    void options
    return { value: '' }
  },
  api: (context) => {
    const { store } = context
    const change = createChange(context)
    const select = () =>
      (context.element('root') as HTMLSelectElement | undefined) ?? null
    // The events `setValue` sends are its own: the select's handler leaves them.
    let writing = false
    /** Tells the owner of a change the select has already made; a cancel puts the last value back. */
    const changed = (
      el: HTMLSelectElement,
      details: { reason: NativeSelectReason; event?: Event },
    ) => {
      const last = store.get().value
      if (el.value === last) return
      if (!change('value', el.value, details)) el.value = last
    }
    return {
      /** The picked option's value, from the select itself: after a render that set it. */
      read: () => {
        const el = select()
        if (el && el.value !== store.get().value) store.set({ value: el.value })
      },
      changed,
      writing: () => writing,
      /** Picks the option with this value, as a person does: false when there is none, or it's off. */
      setValue: (
        value: string,
        details: { reason?: NativeSelectReason; event?: Event } = {},
      ) => {
        const el = select()
        if (!el || el.disabled) return false
        const option = [...el.options].find((each) => each.value === value)
        if (!option || option.disabled) return false
        if (value === el.value) return true
        if (
          !change('value', value, {
            reason: details.reason ?? 'imperative',
            event: details.event,
          })
        )
          return false
        el.value = value
        writing = true
        el.dispatchEvent(new Event('input', { bubbles: true }))
        el.dispatchEvent(new Event('change', { bubbles: true }))
        writing = false
        return true
      },
      /** The options an agent can pick. */
      options: () =>
        [...(select()?.options ?? [])]
          .filter((option) => !option.disabled)
          .map((option) => ({ value: option.value, label: option.label })),
    }
  },
  slots: (slot) => ({
    root: slot({
      on: {
        change: (event, { api, el }) => {
          if (el && !api.writing())
            api.changed(el as HTMLSelectElement, { reason: 'input-change', event })
        },
      },
      bind: (el, { api }) => {
        const select = el as HTMLSelectElement
        api.read()
        // A form's reset puts the select back once the event is done.
        const onReset = (event: Event) => {
          if (event.target !== select.form) return
          queueMicrotask(() => api.changed(select, { reason: 'reset' }))
        }
        select.ownerDocument.addEventListener('reset', onReset, true)
        return () => select.ownerDocument.removeEventListener('reset', onReset, true)
      },
    }),
  }),
  agent: { actions: ['setValue'], closed: true, items: (api) => api.options() },
})

export { nativeSelectControl }
export type { NativeSelectOptions, NativeSelectReason }
