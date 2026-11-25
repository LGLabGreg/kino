/*
 * The island: a surface that floats over the page, whose corner wraps a row
 * of controls as a pill and that grows into a panel, as the Cookie consent
 * island and the Live activity island do. It arrives on `enter`, leaves on
 * `exit`, and its corner follows its size on `layout`, so a `Swap` inside it
 * that changes its size moves it as one. Where it comes from and goes to,
 * and how far it rises, are each island's own: it is gone while marked
 * `data-closed`, hidden and, with `inert`, out of reach.
 */

/**
 * The surface: the popover's colours, a border and a shadow, clipped so what
 * grows inside it never shows past its corner. `--island-padding` is the
 * space round a row of controls, and `--island-pill` the corner that wraps
 * them at it: a pill when the controls are, the shape's corner otherwise.
 */
export const islandSurfaceClassName =
  'bg-popover text-popover-foreground pointer-events-auto max-w-full overflow-clip border shadow-lg [--island-padding:--spacing(2)] [--island-pill:min(calc(var(--control-height)/2+var(--island-padding)),calc(var(--control-radius)+var(--island-padding)))]'

/**
 * Arriving, leaving and the corner's move, for an island whose states set
 * where it comes from. It is visible from the start of its entrance, so
 * focus can move into it at once, and hidden only once its exit has played.
 * Under reduced motion it only fades, and its corner takes its new shape at
 * once.
 */
export const islandMotionClassName =
  '[transition:opacity_var(--motion-enter-duration)_var(--motion-enter-easing),translate_var(--motion-enter-duration)_var(--motion-enter-easing),visibility_0s,border-radius_var(--motion-layout-duration)_var(--motion-layout-easing)] motion-reduce:[transition:opacity_var(--motion-enter-duration)_var(--motion-enter-easing),visibility_0s] data-closed:[transition:opacity_var(--motion-exit-duration)_var(--motion-exit-easing),translate_var(--motion-exit-duration)_var(--motion-exit-easing),visibility_0s_var(--motion-exit-duration),border-radius_var(--motion-layout-duration)_var(--motion-layout-easing)] motion-reduce:data-closed:[transition:opacity_var(--motion-exit-duration)_var(--motion-exit-easing),visibility_0s_var(--motion-exit-duration)]'

/**
 * Where the island sits: across the box the page places it in, letting the
 * pointer through round it, with the surface centred. The surface's
 * container queries read this box, named `island`.
 */
export const islandPlaceClassName =
  '@container/island pointer-events-none flex w-full justify-center'
