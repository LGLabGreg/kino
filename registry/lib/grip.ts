/**
 * The bar a handle shows to say it can be dragged: the Drawer's, on top of
 * its sheet, and the Resizable's, on the line between panels. It darkens
 * while the pointer is over the handle, marked `group/grip`. A handle sets
 * its length and thickness, since it runs across or along.
 */
export const gripClassName =
  'bg-muted-foreground/30 group-hover/grip:bg-muted-foreground/50 block shrink-0 rounded-full transition-[background-color,scale] duration-(--motion-press-duration) ease-[var(--motion-press-fade-easing),var(--motion-press-easing)] motion-reduce:transition-[background-color] motion-reduce:ease-(--motion-press-fade-easing) forced-colors:bg-[CanvasText]!'
