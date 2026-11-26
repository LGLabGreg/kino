import {
  type ChangeDetails,
  createChange,
  createInlineEdit,
  definePrimitive,
  type InlineEditReason,
} from '@ui-sdk/core'

/*
 * Text that becomes a field in place, built on ui-sdk's `createInlineEdit`:
 * the Inline edit's primitive. The component around it owns the value, the
 * save and whether the field is open, and passes them in as options; this
 * says when the field opens, fills it, hears Enter, Escape and focus leaving,
 * and hands each commit to `commit`, which says whether the field closes.
 * An agent renames it with `setValue`, as a person who typed the text and
 * pressed Enter would.
 */

/** Why a value was saved: a key, focus leaving, or code and agents (`imperative`). */
type EditInPlaceReason = InlineEditReason

type EditInPlaceOptions = {
  /** The value on show, which a commit of the same text leaves as it is. */
  value?: string
  /** Saves a value: called through `save`, with who asked for it in `details.source`. */
  onValueChange?: (value: string, details: ChangeDetails<EditInPlaceReason>) => void
  /** Whether the field is open. */
  editing?: boolean
  onEditingChange?: (editing: boolean) => void
  /** The text the field opens with; the value by default. */
  opening?: () => string
  /**
   * Decides a commit of `text`: saves it through `save`, or doesn't, and says
   * whether the field closes. Without it, the trimmed text is saved.
   */
  commit?: (
    text: string,
    details: { reason: EditInPlaceReason; event?: Event },
  ) => boolean
  /** The save the last commit started, while it runs: an agent's rename waits for it. */
  saving?: () => Promise<void> | undefined
  /** A save is running that the field waits for: Escape does nothing. */
  busy?: boolean
  /** Whether the field has been open since the component mounted, so it leaves focus where it is. */
  openSinceMount?: () => boolean
  disabled?: boolean
}

/** The one value this edits, as `createInlineEdit` names what it edits. */
const TEXT = 'text'

const editInPlace = definePrimitive({
  name: 'inline-edit',
  options: {
    value: 'string',
    onValueChange: 'callback',
    editing: 'boolean',
    onEditingChange: 'callback',
    opening: 'value',
    commit: 'action',
    saving: 'value',
    busy: 'boolean',
    openSinceMount: 'value',
    disabled: 'boolean',
  },
  controlled: ['value'],
  state: (options: EditInPlaceOptions) => ({
    value: options.value ?? '',
    session: options.editing ? TEXT : (null as string | null),
    disabled: !!options.disabled,
  }),
  sync: (options) => ({
    ...(options.value === undefined ? {} : { value: options.value }),
    ...(options.editing === undefined ? {} : { session: options.editing ? TEXT : null }),
    disabled: !!options.disabled,
  }),
  api: (context) => {
    const { store, options } = context
    const change = createChange(context)
    const save = (value: string, details: { reason: EditInPlaceReason; event?: Event }) =>
      change('value', value, details)
    const decide = (
      text: string,
      details: { reason: EditInPlaceReason; event?: Event },
    ) => options().commit?.(text, details) ?? save(text.trim(), details)
    const edit = createInlineEdit(context, {
      key: 'session',
      value: () => store.get().value,
      commit: (_id, text, details) => decide(text, details),
      disabled: () => !!options().disabled,
    })
    return {
      edit,
      save,
      /** Opens the field, as a press on the text does. */
      open: (reason: EditInPlaceReason = 'imperative', event?: Event) =>
        edit.start(TEXT, { reason, event }),
      /**
       * Saves `text` as if it was typed and Enter pressed: an agent's rename.
       * A save that takes a while returns its promise, which fails with the
       * reason the save failed.
       */
      setValue: (
        text: string,
        details: { reason?: EditInPlaceReason; event?: Event } = {},
      ) => {
        const done = decide(text, {
          reason: details.reason ?? 'imperative',
          event: details.event,
        })
        return options().saving?.() ?? done
      },
      /** Closes the field without saving, unless a save it waits for runs. */
      cancel: () => {
        if (!options().busy) edit.cancel()
      },
      /** What the field opens with. */
      opening: () => options().opening?.() ?? store.get().value,
      /** Tells the owner the field opened or closed. */
      notify: (editing: boolean) => options().onEditingChange?.(editing),
      /** Whether the field is the one open since the component mounted. */
      openSinceMount: () => options().openSinceMount?.() ?? false,
    }
  },
  slots: (slot) => ({
    root: slot({
      attrs: (state) => ({
        role: 'group',
        'data-editing': state.session ? '' : undefined,
        'data-disabled': state.disabled ? '' : undefined,
      }),
      on: {
        // Escape puts the text back from anywhere in the field, its buttons included; only the field closes, not a dialog it sits in.
        keydown: (event, { api, store }) => {
          if (!store.get().session || event.key !== 'Escape' || event.isComposing) return
          event.preventDefault()
          event.stopPropagation()
          api.cancel()
        },
        // Focus that leaves the field, its buttons included, saves; another window taking focus isn't a press elsewhere.
        focusout: (event, { api, store, el }) => {
          if (!store.get().session || !document.hasFocus()) return
          if (el?.contains(event.relatedTarget as Node | null)) return
          api.edit.end('focus-out', event)
        },
      },
      // The owner hears the field open and close, however it happened.
      bind: (_el, { store, api }) => {
        let open = store.get().session !== null
        return store.subscribe(() => {
          const now = store.get().session !== null
          if (now === open) return
          open = now
          api.notify(now)
        })
      },
    }),
    input: slot({
      on: {
        keydown: (event, { api }) => {
          // Enter that picks a word in an input method editor isn't a save, and a held Enter would open the field it just closed.
          if (event.key !== 'Enter' || event.isComposing) return
          event.preventDefault()
          if (!event.repeat) api.edit.end('enter-key', event)
        },
      },
      bind: (el, { api }) => {
        const input = el as HTMLInputElement
        // `bindInput` focuses the field, which is right for one that opens
        // now; one open from the first paint leaves focus where it is, so
        // its focus and select, which focuses too, wait for a person.
        const still = api.openSinceMount()
        if (still) {
          input.focus = () => {}
          input.select = () => {}
        }
        const unbind = api.edit.bindInput(input)
        if (still) {
          delete (input as Partial<HTMLInputElement>).focus
          delete (input as Partial<HTMLInputElement>).select
        }
        input.value = api.opening()
        // Picked from the end back, with the start in view, so a long text stays where it was.
        input.setSelectionRange(0, input.value.length, 'backward')
        input.scrollLeft = 0
        return unbind
      },
    }),
    text: slot({
      attrs: () => ({ type: 'button' }),
      press: ({ api }, event) => api.open('imperative', event),
      on: {
        keydown: (event, { api }) => {
          // A held key repeats its press, which would save the field it just opened.
          if (event.repeat && (event.key === 'Enter' || event.key === ' ')) {
            event.preventDefault()
          } else if (event.key === 'F2') {
            event.preventDefault()
            api.open('edit-key', event)
          }
        },
      },
    }),
  }),
  agent: { actions: ['setValue'] },
})

export { editInPlace }
export type { EditInPlaceOptions, EditInPlaceReason }
