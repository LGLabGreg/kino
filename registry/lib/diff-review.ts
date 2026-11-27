import type { Resolution, Resolved } from '@/registry/lib/diff-math'
import { type ChangeDetails, createChange, definePrimitive } from '@ui-sdk/core'

/*
 * What a person decided about each change of a diff: the Diff's primitive.
 * Accept and Reject decide one change, Accept all and Reject all every
 * change still open. A decision reaches `onResolvedChange` with who made it
 * in `details.source` and the changes it decided in `details.ids`, so an app
 * can refuse one with `details.cancel()`. An agent decides through the same
 * actions.
 */

/** Why changes were decided: a press on a change's own button or on Accept all or Reject all, or code and agents (`imperative`). */
type DiffReviewReason = 'accept-press' | 'reject-press' | 'all-press' | 'imperative'

/** What a decision reports, beside a change's usual details. */
type DiffReviewDetails = ChangeDetails<DiffReviewReason> & {
  /** The changes this decision decided. */
  ids: readonly string[]
  resolution: Resolution
}

type DiffReviewOptions = {
  resolved?: Resolved
  defaultResolved?: Resolved
  onResolvedChange?: (resolved: Resolved, details: DiffReviewDetails) => void
  /** Every change's id, in order: what Accept all and Reject all decide. */
  changes?: readonly string[]
  /** What a person and an agent hear each change called as the diff reads with `resolved`, by id, such as "change at line 8". */
  namesOf?: (resolved: Resolved) => ReadonlyMap<string, string>
  /** The changes after may still rewrite while it arrives, which wait to be decided. */
  growing?: readonly string[]
  /** Whether after has all arrived. Until then Accept all and Reject all wait, since more changes may come. */
  complete?: boolean
  /** Shows the changes with nothing to decide. */
  readOnly?: boolean
}

const NONE: Resolved = {}
const NO_IDS: readonly string[] = []

const diffReview = definePrimitive({
  name: 'diff',
  options: {
    resolved: 'value',
    defaultResolved: 'value',
    onResolvedChange: 'callback',
    changes: 'list',
    namesOf: 'callback',
    growing: 'list',
    complete: 'boolean',
    readOnly: 'boolean',
  },
  controlled: ['resolved'],
  state: (options: DiffReviewOptions) => ({
    resolved: options.resolved ?? options.defaultResolved ?? NONE,
    changes: options.changes ?? NO_IDS,
    growing: options.growing ?? NO_IDS,
    complete: options.complete ?? true,
    readOnly: !!options.readOnly,
  }),
  sync: (options) => ({
    ...(options.resolved === undefined ? {} : { resolved: options.resolved }),
    changes: options.changes ?? NO_IDS,
    growing: options.growing ?? NO_IDS,
    complete: options.complete ?? true,
    readOnly: !!options.readOnly,
  }),
  api: (context) => {
    const { store } = context
    const change = createChange(context)
    /** Whether change `id` can be decided now: it is one of the diff's, and after won't rewrite it. */
    const decidable = (id: string) => {
      const { changes, growing, readOnly } = store.get()
      return !readOnly && !growing.includes(id) && changes.includes(id)
    }
    const decide = (
      ids: readonly string[],
      resolution: Resolution,
      reason: DiffReviewReason,
      event?: Event,
    ) => {
      const { resolved } = store.get()
      const open = ids.filter((id) => decidable(id) && resolved[id] !== resolution)
      if (open.length === 0) return false
      const next = { ...resolved }
      for (const id of open) next[id] = resolution
      return change('resolved', next, { reason, event, ids: open, resolution })
    }
    /** The changes not decided yet, by id. */
    const open = () => {
      const { changes, resolved } = store.get()
      return changes.filter((id) => resolved[id] === undefined)
    }
    /** Whether Accept all and Reject all can decide now: after has all arrived and a change is open. */
    const canDecideAll = () => {
      const { complete, readOnly } = store.get()
      return complete && !readOnly && open().length > 0
    }
    const all = (resolution: Resolution, event?: Event) =>
      canDecideAll() &&
      decide(open(), resolution, event ? 'all-press' : 'imperative', event)
    /** The changes an agent can decide now, by id and name: one after may still rewrite is left out until it can't. */
    const items = () => {
      const { changes, resolved } = store.get()
      const names = context.options().namesOf?.(resolved)
      return changes
        .filter(decidable)
        .map((id) => ({ value: id, label: names?.get(id) ?? id }))
    }
    return {
      open,
      items,
      decidable,
      canDecideAll,
      /** Takes change `id`'s after. */
      accept: (id: string, event?: Event) =>
        decide([id], 'accepted', event ? 'accept-press' : 'imperative', event),
      /** Keeps change `id`'s before. */
      reject: (id: string, event?: Event) =>
        decide([id], 'rejected', event ? 'reject-press' : 'imperative', event),
      /** Takes every open change's after, once after has all arrived. */
      acceptAll: (event?: Event) => all('accepted', event),
      /** Keeps every open change's before, once after has all arrived. */
      rejectAll: (event?: Event) => all('rejected', event),
    }
  },
  slots: (slot) => ({
    root: slot<Record<never, never>, { resolved: Resolved; readOnly: boolean }>({
      state: (state) => ({ resolved: state.resolved, readOnly: state.readOnly }),
      attrs: (state) => ({
        role: 'group',
        'data-read-only': state.readOnly ? '' : undefined,
      }),
    }),
  }),
  agent: {
    actions: ['accept', 'reject', 'acceptAll', 'rejectAll'],
    // The changes `accept` and `reject` take, by name, so an agent never guesses an id.
    items: (api) => api.items(),
    closed: true,
  },
})

export { diffReview }
export type { DiffReviewDetails, DiffReviewOptions, DiffReviewReason }
