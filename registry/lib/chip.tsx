import { IconPlaceholder } from '@/registry/icons/icon-placeholder'

/*
 * A chip: a small piece that stands for one value, such as a tag in the Tag
 * input or a token in the Token input's text. Every chip takes its look,
 * its remove button and its exit from here, so they all read as one.
 */

/** Its look. Its side padding is the component's: a remove button at the end takes its place. */
const chipClassName =
  'bg-muted text-foreground flex h-(--control-height-xs) max-w-full min-w-0 shrink-0 cursor-default items-center gap-1 rounded-(--control-radius-xs) text-xs font-medium select-none forced-colors:border [&_svg:not([class*="size-"])]:size-3'

/**
 * How it arrives once its field has painted (`data-mounted` on the element
 * named in the component's own `group-`/`in-` variant), and how a copy of it
 * leaves (`data-leaving`, from `leaveAsCopy` in the flow lib): it fades and
 * shrinks where it was, on `exit`. The component's own transition names
 * opacity and scale on `enter`.
 */
const chipLeavingClassName =
  'data-leaving:opacity-0 motion-safe:data-leaving:scale-75 data-leaving:[transition:opacity_var(--motion-exit-duration)_var(--motion-exit-easing),scale_var(--motion-exit-duration)_var(--motion-exit-easing),translate_var(--motion-layout-duration)_var(--motion-layout-easing)]'

/** Its remove button: as tall as the chip, square, at its end. */
const chipRemoveClassName =
  'text-muted-foreground hover:text-foreground hover:bg-foreground/10 focus-visible:ring-ring/50 grid size-(--control-height-xs) shrink-0 place-items-center rounded-(--control-radius-xs) transition-[color,background-color,box-shadow] duration-(--motion-press-duration) ease-(--motion-press-fade-easing) focus-visible:ring-3 focus-visible:outline-hidden'

/** The cross on a chip's remove button: an xs icon button's size, larger than the chip's own icons. */
function ChipRemoveIcon() {
  return (
    <IconPlaceholder
      lucide='XIcon'
      tabler='IconX'
      hugeicons='Cancel01Icon'
      phosphor='XIcon'
      remixicon='RiCloseLine'
      className='size-3.5'
      aria-hidden
    />
  )
}

export { ChipRemoveIcon, chipClassName, chipLeavingClassName, chipRemoveClassName }
