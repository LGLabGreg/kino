/**
 * Runs `action` and calls `finish` with whether it worked, at once or when its
 * promise settles, and whether it had to wait for one: an action that answers
 * at once has nothing to show while it runs. A throw is a failure, and its
 * reason goes to `finish` too; a success passes on what the action gave back.
 * The Confirm button's action, the Inline edit's save, the Form's submit, the
 * Sign in block's requests and the Sign up block's resend share it.
 */
export function settle<Value>(
  action: (() => Value | Promise<Value>) | undefined,
  finish: (ok: boolean, waited: boolean, reason?: unknown, value?: Value) => void,
) {
  let result: Value | Promise<Value> | undefined
  try {
    result = action?.()
  } catch (error) {
    finish(false, false, error)
    return
  }
  if (result instanceof Promise) {
    result.then(
      (value) => finish(true, true, undefined, value),
      (error: unknown) => finish(false, true, error),
    )
  } else finish(true, false, undefined, result)
}
