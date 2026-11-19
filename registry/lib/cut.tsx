'use client'

import {
  Tooltip,
  TooltipContent,
  type TooltipContentProps,
  TooltipTrigger,
} from '@/registry/components/kino/tooltip'
import { overflows } from '@/registry/lib/scroll'
import { SwapTextTitleContext } from '@/registry/lib/swap'
import { type ReactElement, useEffect, useState } from 'react'

/*
 * Text cut short shows whole, one way: a label that truncates is marked
 * `data-cut`, and the control it sits in shows the cut labels' text in a
 * Tooltip, by pointer and by keyboard focus, only while one is cut.
 */

/** The labels whose text can be cut short, as a selector. */
const cutLabels = '[data-cut]'

/** A label that says whether it is cut, such as a `SwapText`. */
const said = '[data-cut=cut], [data-cut=whole]'

/**
 * Whether a label's text is cut short. A label that knows it, such as a
 * `SwapText`, says so with `data-cut='cut'` or `'whole'`; any other is cut
 * while its text is larger than its box.
 */
function isCut(label: {
  dataset: DOMStringMap
  scrollWidth: number
  clientWidth: number
  scrollHeight: number
  clientHeight: number
}) {
  const said = label.dataset.cut
  if (said === 'cut') return true
  if (said === 'whole') return false
  return overflows(label)
}

/** The text of each label marked `data-cut` in or on `owner`, while any of them is cut; otherwise none. */
function cutLines(owner: HTMLElement, selector = cutLabels): readonly string[] {
  // A count beside a label, such as a Badge's, isn't part of what it names.
  const labels = [
    ...(owner.matches(selector) ? [owner] : []),
    ...owner.querySelectorAll<HTMLElement>(selector),
  ].filter((label) => !label.closest('[data-slot=badge]'))
  // A label may hold what cuts across, such as a name that truncates beside
  // an icon; one that says whether it is cut is taken at its word.
  const cut = (label: HTMLElement) =>
    isCut(label) ||
    (!label.matches(said) &&
      [...label.querySelectorAll<HTMLElement>('*')].some(
        (part) => !part.closest(said) && part.scrollWidth - part.clientWidth > 1,
      ))
  if (!labels.some(cut)) return []
  return labels.map((label) => label.textContent?.trim() ?? '').filter(Boolean)
}

/**
 * The text of the labels cut short in `owner`, each on its own line, such as
 * a name over an email; none while they all fit. It follows each label's size
 * and its text, so a value changed in place is checked again.
 */
function useCut(owner: HTMLElement | null, selector = cutLabels): readonly string[] {
  const [lines, setLines] = useState<readonly string[]>([])
  useEffect(() => {
    if (!owner) return
    const sizes = new ResizeObserver(() => measure())
    const watch = () => {
      sizes.disconnect()
      sizes.observe(owner)
      for (const label of owner.querySelectorAll(selector)) sizes.observe(label)
    }
    const measure = () => {
      const next = cutLines(owner, selector)
      setLines((current) => (sameLines(current, next) ? current : next))
    }
    const changes = new MutationObserver(() => {
      watch()
      measure()
    })
    changes.observe(owner, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['data-cut'],
    })
    watch()
    measure()
    return () => {
      sizes.disconnect()
      changes.disconnect()
    }
  }, [owner, selector])
  return lines
}

function sameLines(a: readonly string[], b: readonly string[]) {
  return a.length === b.length && a.every((line, index) => line === b[index])
}

/** The cut labels' text in a tooltip, each on its own line. */
function CutLines({ lines }: { lines: readonly string[] }) {
  return lines.map((line, index) => (
    // oxlint-disable-next-line react/no-array-index-key -- lines repeat, so their place is their key
    <span key={index} dir='auto' className='block wrap-anywhere'>
      {line}
    </span>
  ))
}

/**
 * `render`, such as a Button or a Select's trigger, with a Tooltip that shows
 * whole the labels marked `data-cut` inside it, while any of them is cut
 * short. It opens on hover and on keyboard focus, so `render` should be what
 * takes focus. The trigger isn't described by the tooltip: its name already
 * holds the whole text.
 */
function CutTooltip({
  render,
  labels = cutLabels,
  text,
  disabled = false,
  side,
  align,
}: {
  render: ReactElement
  /** The labels that can be cut short, as a selector, where they can't be marked `data-cut`. */
  labels?: string
  /** What the tooltip shows, where it isn't the cut labels' text. */
  text?: string
  /** Keeps it closed while the labels can't be seen, such as in a sidebar's icon rail. */
  disabled?: boolean
} & Pick<TooltipContentProps, 'side' | 'align'>) {
  const [owner, setOwner] = useState<HTMLElement | null>(null)
  const cut = useCut(owner, labels)
  const lines = cut.length > 0 && text !== undefined ? [text] : cut
  return (
    <SwapTextTitleContext value={false}>
      <Tooltip>
        <TooltipTrigger
          ref={setOwner}
          disabled={disabled || lines.length === 0}
          aria-describedby={undefined}
          render={render}
        />
        <TooltipContent side={side} align={align}>
          <CutLines lines={lines} />
        </TooltipContent>
      </Tooltip>
    </SwapTextTitleContext>
  )
}

export { CutLines, CutTooltip, cutLines, isCut, useCut }
