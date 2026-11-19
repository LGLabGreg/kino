'use client'

import { animateSize, startRun } from '@/registry/lib/resize'
import { scrollRegionRingClassName, useScrollRegion } from '@/registry/lib/scroll'
import {
  type CodeLanguage,
  type CodeToken,
  highlightCode,
  lineSet,
  plainTokens,
} from '@/registry/lib/syntax'
import {
  type ComponentProps,
  type CSSProperties,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import { cn } from '@/lib/utils'

/*
 * The lines of a code block: coloured tokens, a gutter of line numbers, and
 * lines marked as highlighted, added or removed. The Code block frames them.
 */

/** Lines by number from 1, as single lines and inclusive ranges: `[2, [5, 7]]`. */
type LineList = readonly (number | readonly [number, number])[]

type LineMark = 'highlighted' | 'added' | 'removed'

/** One file of a Code block, or one package manager's command. */
interface CodeFile {
  /** The tab's value; the title or the language when not given. */
  value?: string
  /** A file name, such as `button.tsx`, or a package manager. */
  title?: string
  /** What a screen reader calls the code, when the title doesn't set it apart from other code on the page. */
  label?: string
  code: string
  language: CodeLanguage
  /** The number of the first line, for an excerpt from further down a file. */
  startLine?: number
  highlighted?: LineList
  added?: LineList
  removed?: LineList
  /** Lines worked out ahead with `highlightCode`, on a server, so the colours are there on the first paint. */
  tokens?: CodeToken[][]
}

interface CodeBlockProps {
  files: CodeFile[]
  /** The file shown, by value, when there are several. */
  value?: string
  defaultValue?: string
  onValueChange?: (value: string) => void
  lineNumbers?: boolean
  /** Longer files show this many lines until expanded. */
  collapsedLines?: number
  expanded?: boolean
  defaultExpanded?: boolean
  onExpandedChange?: (expanded: boolean) => void
  /** The tabs' name, for a screen reader: "Package manager". */
  label?: string
  className?: string
}

/** A file's tab value: its own, its title, or its language. */
function fileValue(file: CodeFile) {
  return file.value ?? file.title ?? file.language
}

/**
 * `code` as coloured lines. It is plain lines until the colours have loaded,
 * so the text is there on the first paint and nothing moves when they arrive.
 * `tokens` worked out ahead, on a server, skip the loading.
 */
function useCodeTokens(
  code: string,
  language: CodeLanguage,
  tokens?: CodeToken[][],
): CodeToken[][] {
  const plain = useMemo(() => plainTokens(code), [code])
  const [loaded, setLoaded] = useState<{ key: string; lines: CodeToken[][] }>()
  const key = `${language}\n${code}`

  useEffect(() => {
    if (tokens) return
    let active = true
    void highlightCode(code, language).then(
      (lines) => active && setLoaded({ key, lines }),
      () => {},
    )
    return () => {
      active = false
    }
  }, [code, language, key, tokens])

  if (tokens) return tokens
  return loaded?.key === key ? loaded.lines : plain
}

/** The mark of each line, by number from 1. A removed or added mark wins over a highlight. */
function lineMarks({
  highlighted,
  added,
  removed,
}: {
  highlighted?: LineList
  added?: LineList
  removed?: LineList
}): (line: number) => LineMark | undefined {
  const sets = {
    removed: lineSet(removed),
    added: lineSet(added),
    highlighted: lineSet(highlighted),
  }
  return (line) =>
    sets.removed.has(line)
      ? 'removed'
      : sets.added.has(line)
        ? 'added'
        : sets.highlighted.has(line)
          ? 'highlighted'
          : undefined
}

// A marked line's band is its colour over the surface; its bar runs down the start edge.
const lineMarkClassName =
  "relative before:pointer-events-none before:absolute before:inset-y-0 before:start-0 before:w-0.5 before:content-[''] data-[mark=added]:bg-[color-mix(in_oklab,var(--code-added)_14%,transparent)] data-[mark=added]:before:bg-(--code-added) data-[mark=highlighted]:bg-[color-mix(in_oklab,var(--primary)_9%,transparent)] data-[mark=highlighted]:before:bg-primary data-[mark=removed]:bg-[color-mix(in_oklab,var(--code-removed)_14%,transparent)] data-[mark=removed]:before:bg-(--code-removed) forced-colors:data-mark:before:bg-[CanvasText]"

const SIGNS: Record<LineMark, string> = { added: '+', removed: '−', highlighted: '' }

/** One line: its number, its sign when it is added or removed, and its tokens. */
function CodeLine({
  number,
  mark,
  tokens,
  lineNumbers,
  signs,
  className,
  ...props
}: ComponentProps<'span'> & {
  number: number
  mark?: LineMark
  tokens: CodeToken[]
  lineNumbers: boolean
  /** Whether the block has added or removed lines, so every line keeps a column for the sign. */
  signs: boolean
}) {
  return (
    <span
      data-slot='code-line'
      data-line={number}
      data-mark={mark}
      className={cn('flex min-h-lh px-(--surface-padding)', lineMarkClassName, className)}
      {...props}
    >
      {lineNumbers ? (
        <span
          aria-hidden
          data-slot='code-line-number'
          className='w-(--code-gutter) shrink-0 pe-4 text-end text-(--code-comment) tabular-nums select-none'
        >
          {number}
        </span>
      ) : null}
      {signs ? (
        <span
          aria-hidden
          data-slot='code-line-sign'
          className='w-4 shrink-0 select-none data-[mark=added]:text-(--code-added) data-[mark=removed]:text-(--code-removed)'
          data-mark={mark}
        >
          {mark ? SIGNS[mark] : ''}
        </span>
      ) : null}
      <span className='flex-1 whitespace-pre'>
        {tokens.map((token, index) => (
          <span
            key={index}
            style={token.color ? { color: token.color } : undefined}
            className={token.italic ? 'italic' : undefined}
          >
            {token.content}
          </span>
        ))}
        {/* A marked line says so to a screen reader, which hears no colour. */}
        {mark ? <span className='sr-only'>{` (${mark})`}</span> : null}
      </span>
    </span>
  )
}

/** The gutter's width, in characters, for numbers up to `last`. */
function gutterWidth(last: number) {
  return `${String(last).length + 1}ch`
}

/**
 * Every line of a block, in a `<code>` as wide as its longest line, so a
 * marked line's band runs the whole width while it scrolls.
 */
function CodeLines({
  lines,
  lineNumbers = false,
  startLine = 1,
  highlighted,
  added,
  removed,
  className,
  style,
  ...props
}: ComponentProps<'code'> & {
  lines: CodeToken[][]
  lineNumbers?: boolean
  /** The number of the first line, for an excerpt from further down a file. */
  startLine?: number
  highlighted?: LineList
  added?: LineList
  removed?: LineList
}) {
  const markOf = lineMarks({ highlighted, added, removed })
  const signs = Boolean(added?.length || removed?.length)
  return (
    <code
      data-slot='code-lines'
      className={cn('grid w-max min-w-full', className)}
      style={
        {
          '--code-gutter': gutterWidth(startLine + lines.length - 1),
          ...style,
        } as CSSProperties
      }
      {...props}
    >
      {lines.map((tokens, index) => {
        const number = startLine + index
        return (
          <CodeLine
            key={index}
            number={number}
            mark={markOf(number)}
            tokens={tokens}
            lineNumbers={lineNumbers}
            signs={signs}
          />
        )
      })}
    </code>
  )
}

/**
 * The box a block's lines scroll in, on both axes, with a thin scrollbar.
 * While it scrolls it takes focus as a region named by `labelledBy`'s
 * element, or `label`. Collapsed, it shows its first `collapsedLines` lines
 * and moves to its whole height on `layout` as it expands, and back.
 */
function CodeScroller({
  label,
  labelledBy,
  collapsedLines,
  collapsed = false,
  className,
  style,
  children,
  ...props
}: ComponentProps<'pre'> & {
  label: string
  labelledBy?: string
  /** How many lines show while collapsed. */
  collapsedLines?: number
  collapsed?: boolean
}) {
  const ref = useRef<HTMLPreElement>(null)
  const folded = collapsed && collapsedLines !== undefined
  // Folded, it scrolls only sideways, so it takes focus only when its lines are wider than it.
  const region = useScrollRegion(ref, {
    axis: folded ? 'x' : 'both',
    labelledBy: () => labelledBy,
  })
  useFoldMove(ref, folded)

  return (
    // The box draws the region's focus ring over the lines, which would cover one of the scroller's own.
    <div
      data-slot='code-scroller-frame'
      className={cn('min-w-0 rounded-[inherit]', scrollRegionRingClassName)}
    >
      <pre
        ref={ref}
        data-slot='code-scroller'
        data-fold={folded ? '' : undefined}
        dir='ltr'
        {...region}
        aria-label={region && !labelledBy ? label : undefined}
        className={cn(
          'scrollbar-thin max-h-(--code-block-max-height) overflow-auto py-(--surface-padding) font-mono text-[0.8125rem] leading-6 focus-visible:outline-hidden',
          // Folded, its height is its lines' and its padding's, and it scrolls only sideways.
          // `data-folded` comes once a fold has finished moving, so the cap never cuts the move short.
          'data-folded:max-h-[calc(var(--code-collapsed-lines)*1lh+var(--surface-padding)*2)] data-folded:overflow-y-hidden data-moving:overflow-y-hidden',
          // The last lines fade while it is folded, to say there are more. The fade's height is a
          // registered property (code-css.ts), so it grows and shrinks with the box.
          '[mask-image:linear-gradient(to_top,transparent,black_var(--code-fade,0px))] data-fold:[--code-fade:2.5rem]',
          'rounded-[inherit] transition-[height,--code-fade] duration-(--motion-layout-duration) ease-(--motion-layout-easing) motion-reduce:transition-none',
          className,
        )}
        style={
          collapsedLines === undefined
            ? style
            : ({ '--code-collapsed-lines': collapsedLines, ...style } as CSSProperties)
        }
        {...props}
      >
        {children}
      </pre>
    </div>
  )
}

/**
 * Moves the box to its new height when it folds or unfolds, from the height
 * it is at, so a change cut short turns back where it is. The folded cap,
 * `data-folded`, goes on only once a fold has finished.
 */
function useFoldMove(ref: RefObject<HTMLElement | null>, folded: boolean) {
  const first = useRef(true)

  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    if (first.current) {
      first.current = false
      if (folded) element.dataset.folded = ''
      return
    }
    const from = element.getBoundingClientRect().height
    element.style.height = ''
    // The height it comes to rest at, measured with the cap on.
    if (folded) element.dataset.folded = ''
    else delete element.dataset.folded
    const to = element.offsetHeight
    delete element.dataset.folded
    if (Math.abs(to - from) < 0.5) {
      startRun(element)
      delete element.dataset.moving
      if (folded) element.dataset.folded = ''
      return
    }
    // While it moves its lines don't scroll, so no scrollbar comes and goes.
    element.dataset.moving = ''
    void animateSize(element, 'height', from, to).then((latest) => {
      if (!latest) return
      element.style.height = ''
      delete element.dataset.moving
      if (folded) element.dataset.folded = ''
    })
  }, [ref, folded])
}

export {
  CodeLine,
  CodeLines,
  CodeScroller,
  fileValue,
  gutterWidth,
  lineMarks,
  useCodeTokens,
}
export type { CodeBlockProps, CodeFile, LineList, LineMark }
