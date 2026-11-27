'use client'

import { IconPlaceholder } from '@/registry/icons/icon-placeholder'
import { CutTooltip } from '@/registry/lib/cut'
import { useFoldMove } from '@/registry/lib/fold'
import { scrollRegionRingClassName, useScrollRegion } from '@/registry/lib/scroll'
import {
  type CodeLanguage,
  type CodeToken,
  highlightCode,
  holdColours,
  languageName,
  lineSet,
  plainTokens,
} from '@/registry/lib/syntax'
import {
  type ComponentProps,
  type CSSProperties,
  useEffect,
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
  /** A file name, such as `button.tsx`, or a package manager. Without one, the header names the language, such as TypeScript, with no file icon. */
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
 * When the code changes, as it does while it streams in, the lines that
 * haven't changed keep their colours until the new ones land, and one
 * highlight runs at a time, the next taking the code as it is by then.
 * `tokens` worked out ahead, on a server, skip the loading.
 */
function useCodeTokens(
  code: string,
  language: CodeLanguage,
  tokens?: CodeToken[][],
): CodeToken[][] {
  const plain = useMemo(() => plainTokens(code), [code])
  const [loaded, setLoaded] = useState<{
    code: string
    language: CodeLanguage
    lines: CodeToken[][]
  }>()
  const latest = useRef({ code, language })
  const running = useRef(false)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  useEffect(() => {
    latest.current = { code, language }
    if (tokens || running.current) return
    running.current = true
    void (async () => {
      let done: { code: string; language: CodeLanguage } | undefined
      while (mounted.current && latest.current !== done) {
        done = latest.current
        const lines = await highlightCode(done.code, done.language).catch(() => undefined)
        if (lines && mounted.current) setLoaded({ ...done, lines })
      }
      running.current = false
    })()
  }, [code, language, tokens])

  const held = useMemo(
    () => holdColours(plain, loaded?.language === language ? loaded.lines : undefined),
    [plain, loaded, language],
  )
  if (tokens) return tokens
  return loaded?.code === code && loaded.language === language ? loaded.lines : held
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

/** A stretch of a line's text, and whether the line kept it or changed it, such as a diff's words. */
type LineWord = { op: 'same' | 'added' | 'removed'; text: string }

/** A token, or the part of one, and whether it sits in a word its line changed. */
type MarkedToken = CodeToken & { changed: boolean }

/**
 * A line's tokens cut where its changed words start and end, so each piece
 * is either kept or changed. `words` spell the same line as `tokens` do;
 * where they run short, the rest is kept.
 */
function markWords(
  tokens: readonly CodeToken[],
  words: readonly LineWord[],
): MarkedToken[] {
  // Where each changed stretch of the line starts and ends, in characters.
  const stretches: [number, number][] = []
  let at = 0
  for (const word of words) {
    if (word.op !== 'same') stretches.push([at, at + word.text.length])
    at += word.text.length
  }
  const pieces: MarkedToken[] = []
  let start = 0
  for (const token of tokens) {
    const end = start + token.content.length
    let from = start
    for (const [stretchStart, stretchEnd] of stretches) {
      if (stretchEnd <= from || stretchStart >= end) continue
      if (stretchStart > from) {
        pieces.push({
          ...token,
          content: token.content.slice(from - start, stretchStart - start),
          changed: false,
        })
        from = stretchStart
      }
      const to = Math.min(stretchEnd, end)
      pieces.push({
        ...token,
        content: token.content.slice(from - start, to - start),
        changed: true,
      })
      from = to
    }
    if (from < end)
      pieces.push({
        ...token,
        content: token.content.slice(from - start),
        changed: false,
      })
    start = end
  }
  return pieces
}

// A changed word inside an added or removed line: a deeper band of the line's colour.
const changedWordClassName =
  'rounded-[2px] data-[mark=added]:bg-[color-mix(in_oklab,var(--code-added)_16%,transparent)] data-[mark=removed]:bg-[color-mix(in_oklab,var(--code-removed)_16%,transparent)] forced-colors:underline'

/** One line: its number, its sign when it is added or removed, and its tokens, with the words it changed marked. */
function CodeLine({
  number,
  mark,
  tokens,
  words,
  lineNumbers,
  signs,
  className,
  ...props
}: ComponentProps<'span'> & {
  /** Left out for a line the shown text doesn't number, such as a diff's removed line. */
  number?: number
  mark?: LineMark
  tokens: CodeToken[]
  /** The words an added or removed line kept and changed, from its partner on the other side. */
  words?: readonly LineWord[]
  lineNumbers: boolean
  /** Whether the block has added or removed lines, so every line keeps a column for the sign. */
  signs: boolean
}) {
  const pieces =
    words && (mark === 'added' || mark === 'removed')
      ? markWords(tokens, words)
      : tokens.map((token) => ({ ...token, changed: false }))
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
        {pieces.map((token, index) => (
          <span
            key={index}
            data-mark={token.changed ? mark : undefined}
            // A changed word takes the text colour on its band: a token's own colour, such as a string's green, falls under contrast there.
            style={token.color && !token.changed ? { color: token.color } : undefined}
            className={cn(
              token.italic && 'italic',
              token.changed && changedWordClassName,
            )}
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

// The card code sits in, and its header: what the Code block and the Diff share.
const codeCardClassName =
  'bg-card text-card-foreground flex min-w-0 flex-col overflow-clip rounded-(--surface-radius) border text-sm'
const codeHeaderClassName =
  'flex min-h-(--control-height-lg) min-w-0 items-center gap-2 border-b ps-(--surface-padding) pe-1.5'

/** What a code card's header names: a file with its icon, or else the language. */
function CodeTitle({
  title,
  language,
  id,
}: {
  title?: string
  language: CodeLanguage
  id?: string
}) {
  return (
    <>
      {title !== undefined ? (
        <IconPlaceholder
          lucide='FileCodeIcon'
          tabler='IconFileCode'
          hugeicons='FileScriptIcon'
          phosphor='FileCodeIcon'
          remixicon='RiFileCodeLine'
          aria-hidden
          className='text-muted-foreground size-4 shrink-0'
        />
      ) : null}
      <CutTooltip
        render={
          <span
            id={id}
            data-cut
            dir='auto'
            className={cn(
              'min-w-0 flex-1 truncate text-xs',
              title !== undefined ? 'font-mono' : 'text-muted-foreground font-medium',
            )}
          >
            {title ?? languageName(language)}
          </span>
        }
      />
    </>
  )
}

export {
  CodeLine,
  CodeTitle,
  codeCardClassName,
  codeHeaderClassName,
  CodeLines,
  markWords,
  CodeScroller,
  fileValue,
  gutterWidth,
  lineMarks,
  useCodeTokens,
}
export type { CodeBlockProps, CodeFile, LineList, LineMark, MarkedToken }
