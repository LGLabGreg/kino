'use client'

import { Checkbox } from '@/registry/components/kino/checkbox'
import { CodeBlock } from '@/registry/components/kino/code-block'
import { Separator } from '@/registry/components/kino/separator'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/registry/components/kino/table'
import {
  type MarkdownAlign,
  type MarkdownBlock,
  type MarkdownDocument,
  type MarkdownInline,
  type MarkdownRange,
  parseMarkdown,
  plain,
} from '@/registry/lib/markdown-parse'
import { languageName } from '@/registry/lib/syntax'
import {
  type ComponentProps,
  createContext,
  Fragment,
  isValidElement,
  memo,
  type ReactNode,
  use,
  useMemo,
  useState,
} from 'react'

import { cn } from '@/lib/utils'

/*
 * Markdown, drawn with Kino's own parts, that reads well while it is still
 * being written. New text shows the moment it arrives. Only the block being
 * written renders again; the blocks above it keep their elements. Raw HTML
 * shows as text.
 */

/** Something to put at the end of a range of the source, such as a citation. */
export interface MarkdownMark {
  /** Where its range starts in the source; the range lights while the mark has the pointer or focus. */
  from: number
  /** Where its range ends in the source, and where the mark goes. */
  to: number
  content: ReactNode
}

/** Draws the code of one fenced language, in place of the Code block: a diagram, a chart. */
export type MarkdownCodeRenderer = (
  code: string,
  state: { streaming: boolean },
) => ReactNode

const headingClassName = {
  1: 'mt-2 text-xl leading-7 font-semibold tracking-tight text-balance first:mt-0',
  2: 'mt-2 text-lg leading-7 font-semibold tracking-tight text-balance first:mt-0',
  3: 'mt-1 text-base font-semibold text-balance first:mt-0',
  4: 'font-semibold',
  5: 'font-semibold',
  6: 'text-muted-foreground font-semibold',
} as const

// The ring's corner and the code's box are in `em`, so they follow the text's size in a heading as in a paragraph.
const linkClassName =
  'text-foreground font-medium underline decoration-foreground/30 underline-offset-4 transition-[text-decoration-color] duration-(--motion-press-duration) ease-(--motion-press-fade-easing) hover:decoration-foreground focus-visible:rounded-[min(var(--control-radius-xs),0.2em)] focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-hidden data-pending:no-underline'

const inlineCodeClassName =
  'bg-muted rounded-[min(var(--control-radius-xs),0.375em)] px-[0.35em] py-[0.1em] font-mono text-[0.875em] [overflow-wrap:anywhere]'

/* Rendering */

/** What every block reads: it changes only with `headingLevel`, so a new chunk renders only the blocks it changed. */
interface Render {
  headingLevel: number
  onLight: (index: number | null) => void
}

const RenderContext = createContext<Render | null>(null)

/** Read by code blocks alone, so new renderers render only them. */
const RenderersContext = createContext<Record<string, MarkdownCodeRenderer> | undefined>(
  undefined,
)

/** Whether more text is coming, read by code blocks alone: a stopped reply's open fence is finished code. */
const ArrivingContext = createContext(false)

/** A mark a block holds, with its index for lighting its range. */
interface PlacedMark {
  index: number
  mark: MarkdownMark
}

/** The marks a block holds or lights. */
interface BlockMarks {
  /** Marks whose content goes in this block. */
  placed: readonly PlacedMark[]
  /** The lit mark, when its range reaches into this block. */
  lit: MarkdownMark | null
}

const NO_MARKS: BlockMarks = { placed: [], lit: null }
const NO_MARK_LIST: readonly MarkdownMark[] = []

/** A leaf's place for each mark it ends: the source offset its content follows. */
type Placements = Map<number, PlacedMark[]>

function MarkdownBlockView({
  block,
  marks,
}: {
  block: MarkdownBlock
  marks: BlockMarks
}) {
  const render = use(RenderContext)!
  const placements = useMemo(() => placeMarks(block, marks.placed), [block, marks.placed])
  return blockElement(block, { render, marks, placements })
}

const MemoBlock = memo(
  MarkdownBlockView,
  (a, b) => a.block === b.block && sameBlockMarks(a.marks, b.marks),
)

interface Scope {
  render: Render
  marks: BlockMarks
  placements: Placements
}

const HEADINGS = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'] as const

function blockElement(block: MarkdownBlock, scope: Scope, tight = false): ReactNode {
  switch (block.type) {
    case 'paragraph':
      return tight ? (
        inlines(block.children, scope)
      ) : (
        <p data-slot='markdown-paragraph' dir='auto'>
          {inlines(block.children, scope)}
        </p>
      )
    case 'heading': {
      const Heading =
        HEADINGS[Math.min(6, block.depth + scope.render.headingLevel - 1) - 1]
      return (
        <Heading
          data-slot='markdown-heading'
          dir='auto'
          className={headingClassName[block.depth]}
        >
          {inlines(block.children, scope)}
        </Heading>
      )
    }
    case 'code':
      return <CodeView block={block} />
    case 'quote':
      return (
        <blockquote
          data-slot='markdown-quote'
          dir='auto'
          className='text-muted-foreground flex flex-col gap-3 border-s-2 ps-3'
        >
          {block.children.map((child) => (
            <BlockFragment key={child.from} block={child} scope={scope} />
          ))}
        </blockquote>
      )
    case 'list': {
      const List = block.ordered ? 'ol' : 'ul'
      return (
        <List
          data-slot='markdown-list'
          start={block.ordered && block.start !== 1 ? block.start : undefined}
          className={cn(
            'marker:text-muted-foreground flex list-disc flex-col gap-1',
            block.ordered && 'list-decimal marker:tabular-nums',
            !block.tight && 'gap-3',
          )}
        >
          {block.items.map((item) => (
            <li
              key={item.from}
              data-slot='markdown-item'
              dir='auto'
              data-task={item.checked === null ? undefined : ''}
              data-loose={block.tight ? undefined : ''}
              className={cn(
                // The marker's room is the item's own margin, so it sits on the item's start side in either direction.
                'ms-5 ps-0.5 [&>ol]:mt-1 [&>ul]:mt-1 data-loose:[&>*+*]:mt-3',
                item.checked !== null && 'ms-0 flex list-none gap-2',
              )}
            >
              {item.checked !== null ? (
                <>
                  <TaskCheck checked={item.checked} />
                  <div
                    className={cn(
                      'flex min-w-0 flex-1 flex-col',
                      block.tight ? 'gap-1' : 'gap-3',
                    )}
                  >
                    {/* Its own `dir`, so the item's direction comes from the task's text. */}
                    <span dir='ltr' className='sr-only'>
                      {item.checked ? 'Done: ' : 'To do: '}
                    </span>
                    {item.children.map((child) => (
                      <BlockFragment
                        key={child.from}
                        block={child}
                        scope={scope}
                        tight={block.tight}
                      />
                    ))}
                  </div>
                </>
              ) : (
                item.children.map((child) => (
                  <BlockFragment
                    key={child.from}
                    block={child}
                    scope={scope}
                    tight={block.tight}
                  />
                ))
              )}
            </li>
          ))}
        </List>
      )
    }
    case 'table': {
      const wraps = block.head.map((_, column) => columnWraps(block.rows, column))
      return (
        <Table
          data-slot='markdown-table'
          aria-label={`Table: ${block.head.map(plain).join(', ')}`}
          containerClassName='rounded-(--surface-radius) border'
        >
          <TableHeader>
            <TableRow>
              {block.head.map((cell, index) => (
                <TableHead
                  key={index}
                  dir='auto'
                  numeric={block.align[index] === 'right'}
                  className={alignClassName(block.align[index])}
                >
                  {inlines(cell, scope)}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {block.rows.map((row, rowIndex) => (
              <TableRow key={rowIndex}>
                {row.map((cell, index) => (
                  <TableCell
                    key={index}
                    dir='auto'
                    numeric={block.align[index] === 'right'}
                    className={cn(
                      // A wrapped cell keeps the row's room above and below it; one line stays the row's height.
                      wraps[index] && 'py-2 whitespace-normal',
                      alignClassName(block.align[index]),
                    )}
                  >
                    {inlines(cell, scope)}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )
    }
    case 'rule':
      return <Separator data-slot='markdown-rule' className='my-1' />
    case 'html':
      return (
        <p data-slot='markdown-paragraph' dir='auto' className='whitespace-pre-wrap'>
          {block.value}
        </p>
      )
  }
}

function BlockFragment({
  block,
  scope,
  tight,
}: {
  block: MarkdownBlock
  scope: Scope
  tight?: boolean
}) {
  return blockElement(block, scope, tight)
}

// A column set to the right holds numbers, as the Table's `numeric` does.
const alignClassName = (align: MarkdownAlign) =>
  align === 'center' ? 'text-center' : undefined

/** A task's box: a mark, not a control, since a reply can't be ticked. The item's text says which. */
function TaskCheck({ checked }: { checked: boolean }) {
  return (
    <span inert className='contents'>
      <Checkbox checked={checked} readOnly className='mt-[calc((1lh-1rem)/2)]' />
    </span>
  )
}

function CodeView({ block }: { block: Extract<MarkdownBlock, { type: 'code' }> }) {
  const renderers = use(RenderersContext)
  const streaming = block.open && use(ArrivingContext)
  const custom = block.language ? renderers?.[block.language] : undefined
  if (custom) return custom(block.value, { streaming })
  return (
    <CodeBlock
      streaming={streaming}
      files={[
        {
          // Two blocks of one language are told apart by their first line.
          label: `${languageName(block.language ?? 'text')} code: ${block.value.split('\n', 1)[0].trim().slice(0, 48)}`,
          language: block.language ?? 'text',
          code: block.value,
        },
      ]}
    />
  )
}

/* Inlines */

function inlines(list: MarkdownInline[], scope: Scope): ReactNode[] {
  return list.map((inline) => inlineElement(inline, scope))
}

function inlineElement(inline: MarkdownInline, scope: Scope): ReactNode {
  const key = `${inline.type}-${inline.from}`
  switch (inline.type) {
    case 'text':
      return <TextRun key={key} inline={inline} scope={scope} />
    case 'code':
      return (
        <Leaf key={key} inline={inline} scope={scope}>
          <code data-slot='markdown-code' className={inlineCodeClassName}>
            {inline.value}
          </code>
        </Leaf>
      )
    case 'break':
      return (
        <Leaf key={key} inline={inline} scope={scope}>
          <br />
        </Leaf>
      )
    case 'image':
      return (
        <Leaf key={key} inline={inline} scope={scope}>
          {safeHref(inline.src) ? (
            // oxlint-disable-next-line nextjs/no-img-element -- a registry item can't use next/image
            <img
              src={inline.src}
              alt={inline.alt}
              loading='lazy'
              className='max-w-full rounded-(--surface-radius) border'
            />
          ) : (
            inline.alt
          )}
        </Leaf>
      )
    case 'emphasis':
      return <em key={key}>{inlines(inline.children, scope)}</em>
    case 'strong':
      return (
        <strong key={key} className='font-semibold'>
          {inlines(inline.children, scope)}
        </strong>
      )
    case 'delete':
      return <del key={key}>{inlines(inline.children, scope)}</del>
    case 'link': {
      const href = inline.href === null ? null : safeHref(inline.href)
      // An address no reply may open shows its text alone.
      if (inline.href !== null && href === null)
        return <Fragment key={key}>{inlines(inline.children, scope)}</Fragment>
      return href === null ? (
        <span
          key={key}
          data-slot='markdown-link'
          data-pending=''
          className={linkClassName}
        >
          {inlines(inline.children, scope)}
        </span>
      ) : (
        <a
          key={key}
          data-slot='markdown-link'
          href={href}
          {...(/^https?:/i.test(href)
            ? { target: '_blank', rel: 'noopener noreferrer' }
            : {})}
          className={linkClassName}
        >
          {inlines(inline.children, scope)}
        </a>
      )
    }
  }
}

/** A leaf that can't be split: a mark that ends inside it goes after it. */
function Leaf({
  inline,
  scope,
  children,
}: {
  inline: MarkdownRange
  scope: Scope
  children: ReactNode
}) {
  const placed = scope.placements.get(inline.to)
  return (
    <>
      {children}
      {placed?.map((item) => (
        <MarkSlot key={item.index} placed={item} scope={scope} />
      ))}
    </>
  )
}

/** Text, cut where a mark's range starts or ends and where a mark goes. */
function TextRun({
  inline,
  scope,
}: {
  inline: Extract<MarkdownInline, { type: 'text' }>
  scope: Scope
}) {
  const { marks, placements } = scope
  const splittable = inline.value.length === inline.to - inline.from
  if (!splittable)
    return (
      <Leaf inline={inline} scope={scope}>
        {inline.value}
      </Leaf>
    )
  const lit = marks.lit
  const points = textCuts(inline, lit, placements.keys())
  const pieces: ReactNode[] = []
  for (let i = 0; i < points.length - 1; i++) {
    const from = points[i]
    const to = points[i + 1]
    const text = inline.value.slice(from - inline.from, to - inline.from)
    pieces.push(
      lit && from >= lit.from && to <= lit.to ? (
        <span
          key={from}
          data-slot='markdown-lit'
          className='bg-primary/15 rounded-[min(var(--control-radius-xs),0.2em)] [box-decoration-break:clone] forced-colors:bg-[Highlight] forced-colors:text-[HighlightText]'
        >
          {text}
        </span>
      ) : (
        <span key={from} className='contents'>
          {text}
        </span>
      ),
    )
    for (const placed of placements.get(to) ?? []) {
      pieces.push(<MarkSlot key={`mark-${placed.index}`} placed={placed} scope={scope} />)
    }
  }
  return pieces
}

function MarkSlot({ placed, scope }: { placed: PlacedMark; scope: Scope }) {
  const { onLight } = scope.render
  return (
    <span
      data-slot='markdown-mark'
      onPointerEnter={() => onLight(placed.index)}
      onPointerLeave={() => onLight(null)}
      onFocus={() => onLight(placed.index)}
      onBlur={() => onLight(null)}
    >
      {placed.mark.content}
    </span>
  )
}

/* The component */

interface Parsed {
  text: string
  cut: boolean
  doc: MarkdownDocument
}

function Markdown({
  children,
  streaming = false,
  stopped = false,
  marks = NO_MARK_LIST,
  renderers,
  headingLevel = 1,
  className,
  ...props
}: Omit<ComponentProps<'div'>, 'children'> & {
  /** The Markdown source. */
  children: string
  /** The text is still being written: what is cut at its end is closed. */
  streaming?: boolean
  /** The text was stopped before its end: what is cut there stays closed, as while it streamed. */
  stopped?: boolean
  /** Keep each mark's `content` the same node, or an element with the same props, so a new chunk renders only the block being written. */
  marks?: readonly MarkdownMark[]
  /** Draws fenced code by its language, in place of the Code block: `{ mermaid: (code) => <Diagram source={code} /> }`. Made once, outside the component or in `useMemo`, since a new object renders every code block again. */
  renderers?: Record<string, MarkdownCodeRenderer>
  /** The level a `#` heading takes on the page, so a reply's headings sit under the page's own; deeper ones follow, up to `h6`. */
  headingLevel?: 1 | 2 | 3 | 4 | 5 | 6
}) {
  // Parsed while rendering, from the last parse, so only the block being written is parsed again.
  const cut = streaming || stopped
  const [parsed, setParsed] = useState<Parsed>(() => ({
    text: children,
    cut,
    doc: parseMarkdown(children, { streaming: cut }),
  }))
  let doc = parsed.doc
  if (parsed.text !== children || parsed.cut !== cut) {
    doc = parseMarkdown(children, { streaming: cut, previous: parsed.doc })
    setParsed({ text: children, cut, doc })
  }

  const [lit, setLit] = useState<number | null>(null)
  const render = useMemo<Render>(
    () => ({ headingLevel, onLight: setLit }),
    [headingLevel],
  )
  const perBlock = useMemo(
    () => blockMarks(doc.blocks, marks, lit),
    [doc.blocks, marks, lit],
  )

  return (
    <RenderContext value={render}>
      <RenderersContext value={renderers}>
        <ArrivingContext value={streaming}>
          <div
            data-slot='markdown'
            data-streaming={streaming ? '' : undefined}
            className={cn(
              'flex min-w-0 flex-col gap-3 text-sm leading-6 text-pretty wrap-break-word',
              className,
            )}
            {...props}
          >
            {doc.blocks.map((block, index) => (
              <MemoBlock key={block.from} block={block} marks={perBlock[index]} />
            ))}
          </div>
        </ArrivingContext>
      </RenderersContext>
    </RenderContext>
  )
}

export { Markdown }

/** A link's address, when it is one a reply may open: never `javascript:` or `data:`. */
export function safeHref(href: string): string | null {
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(href)?.[1]?.toLowerCase()
  if (!scheme) return href
  return ['http', 'https', 'mailto', 'tel'].includes(scheme) ? href : null
}

/** Text longer than this wraps its column; shorter values, such as a name or an amount, stay on one line and the table scrolls. */
const WRAP_AFTER = 24

/** Whether a table's column holds prose that wraps, rather than values kept whole. */
export function columnWraps(
  rows: readonly MarkdownInline[][][],
  column: number,
): boolean {
  return rows.some((row) => plain(row[column] ?? []).length > WRAP_AFTER)
}

/** Where a text run is cut: its ends, the lit range's ends and each mark's place inside it. */
export function textCuts(
  inline: MarkdownRange,
  lit: MarkdownRange | null,
  places: Iterable<number>,
): number[] {
  const cuts = new Set<number>([inline.from, inline.to])
  const inside = (at: number) => at > inline.from && at < inline.to
  if (lit && inside(lit.from)) cuts.add(lit.from)
  if (lit && inside(lit.to)) cuts.add(lit.to)
  for (const at of places) if (inside(at)) cuts.add(at)
  return [...cuts].sort((a, b) => a - b)
}

/** The leaves of a block, in order: what a mark can follow. */
function leavesOf(block: MarkdownBlock): MarkdownInline[] {
  const out: MarkdownInline[] = []
  const walk = (list: MarkdownInline[]) => {
    for (const inline of list) {
      if ('children' in inline) walk(inline.children)
      else out.push(inline)
    }
  }
  const visit = (block: MarkdownBlock) => {
    switch (block.type) {
      case 'paragraph':
      case 'heading':
        return walk(block.children)
      case 'quote':
        return block.children.forEach(visit)
      case 'list':
        return block.items.forEach((item) => item.children.forEach(visit))
      case 'table':
        block.head.forEach(walk)
        return block.rows.forEach((row) => row.forEach(walk))
    }
  }
  visit(block)
  return out
}

/**
 * Where each mark of a block goes: the end of its range, inside the text
 * that holds it, or after the last leaf before it when it ends on markup.
 */
export function placeMarks(
  block: MarkdownBlock,
  placed: readonly PlacedMark[],
): Placements {
  const placements: Placements = new Map()
  if (!placed.length) return placements
  const leaves = leavesOf(block)
  for (const item of placed) {
    const to = item.mark.to
    let at: number | null = null
    for (const leaf of leaves) {
      if (leaf.from >= to) break
      const splittable = leaf.type === 'text' && leaf.value.length === leaf.to - leaf.from
      at = to <= leaf.to && splittable ? to : leaf.to
      if (to <= leaf.to) break
    }
    if (at === null) continue
    placements.set(at, [...(placements.get(at) ?? []), item])
  }
  return placements
}

/** Which block each mark goes in, the last that starts before the mark's end, and which blocks the lit mark reaches. */
export function blockMarks(
  blocks: readonly MarkdownRange[],
  marks: readonly MarkdownMark[],
  lit: number | null,
): BlockMarks[] {
  const placed: PlacedMark[][] = blocks.map(() => [])
  marks.forEach((mark, index) => {
    let target = -1
    for (let i = 0; i < blocks.length && blocks[i].from < mark.to; i++) target = i
    if (target >= 0) placed[target].push({ index, mark })
  })
  const litMark = lit === null ? null : (marks[lit] ?? null)
  return blocks.map((block, i) => {
    const reaches = litMark !== null && litMark.from < block.to && litMark.to > block.from
    return placed[i].length || reaches
      ? { placed: placed[i], lit: reaches ? litMark : null }
      : NO_MARKS
  })
}

/** Whether a block's marks would draw the same: the same lit range, and the same marks with the same ranges and content. */
export function sameBlockMarks(a: BlockMarks, b: BlockMarks): boolean {
  return (
    a.lit?.from === b.lit?.from &&
    a.lit?.to === b.lit?.to &&
    a.placed.length === b.placed.length &&
    a.placed.every(
      (item, i) =>
        item.index === b.placed[i].index &&
        item.mark.from === b.placed[i].mark.from &&
        item.mark.to === b.placed[i].mark.to &&
        sameContent(item.mark.content, b.placed[i].mark.content),
    )
  )
}

/** Whether two marks' content draws the same: the same node, or elements of one type and key with equal props. */
export function sameContent(a: ReactNode, b: ReactNode): boolean {
  if (Object.is(a, b)) return true
  if (!isValidElement(a) || !isValidElement(b)) return false
  if (a.type !== b.type || a.key !== b.key) return false
  const aProps = a.props as Record<string, unknown>
  const bProps = b.props as Record<string, unknown>
  const keys = Object.keys(aProps)
  return (
    keys.length === Object.keys(bProps).length &&
    keys.every((key) => Object.hasOwn(bProps, key) && Object.is(aProps[key], bProps[key]))
  )
}
