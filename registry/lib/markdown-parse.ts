/*
 * Markdown as a tree: CommonMark, with GFM's tables, task lists,
 * strikethrough and autolinks. Every node carries its offsets into the
 * source, so a mark can be placed on it. Raw HTML is kept as text.
 *
 * While the text streams, what is cut at its end is closed in the tree, not
 * patched in the string: an open fence is code still being written, an open
 * emphasis wraps what follows it, a half link shows its text, and a marker
 * that may still become something else waits for its next character.
 */

/** A range of the source, from `from` up to `to`. */
export interface MarkdownRange {
  from: number
  to: number
}

export type MarkdownInline =
  | (MarkdownRange & { type: 'text'; value: string })
  | (MarkdownRange & { type: 'code'; value: string })
  | (MarkdownRange & {
      type: 'emphasis' | 'strong' | 'delete'
      children: MarkdownInline[]
    })
  | (MarkdownRange & {
      type: 'link'
      /** Null while the link's address is still arriving. */
      href: string | null
      title: string | null
      children: MarkdownInline[]
    })
  | (MarkdownRange & {
      type: 'image'
      src: string
      alt: string
      title: string | null
    })
  | (MarkdownRange & { type: 'break' })

export type MarkdownAlign = 'left' | 'center' | 'right' | null

export interface MarkdownItem extends MarkdownRange {
  /** A task's state, or null for a plain item. */
  checked: boolean | null
  children: MarkdownBlock[]
}

export type MarkdownBlock =
  | (MarkdownRange & { type: 'paragraph'; children: MarkdownInline[] })
  | (MarkdownRange & {
      type: 'heading'
      depth: 1 | 2 | 3 | 4 | 5 | 6
      children: MarkdownInline[]
    })
  | (MarkdownRange & {
      type: 'code'
      language: string | null
      value: string
      /** True while its closing fence hasn't arrived. */
      open: boolean
    })
  | (MarkdownRange & { type: 'quote'; children: MarkdownBlock[] })
  | (MarkdownRange & {
      type: 'list'
      ordered: boolean
      start: number
      tight: boolean
      items: MarkdownItem[]
    })
  | (MarkdownRange & {
      type: 'table'
      align: MarkdownAlign[]
      head: MarkdownInline[][]
      rows: MarkdownInline[][][]
    })
  | (MarkdownRange & { type: 'rule' })
  | (MarkdownRange & { type: 'html'; value: string })

interface Definition {
  href: string
  title: string | null
  /** Where it is defined in the source. */
  at: number
}

/** A parsed text, which the next parse of the same text grown longer starts from. */
export interface MarkdownDocument {
  source: string
  streaming: boolean
  blocks: MarkdownBlock[]
  /** Where the line of each top-level block starts. */
  starts: number[]
  definitions: Map<string, Definition>
}

/* Characters and patterns */

const ESCAPABLE = '[!-/:-@[-`{-~]'
const ENTITY = '&(?:#[xX][a-fA-F0-9]{1,6}|#[0-9]{1,7}|[A-Za-z][A-Za-z0-9]{1,31});'
const reEscapeOrEntity = new RegExp(`\\\\${ESCAPABLE}|${ENTITY}`, 'g')
const reEntityHere = new RegExp(`^${ENTITY}`)
const reEscapable = new RegExp(`^${ESCAPABLE}`)

const TAG_NAME = '[A-Za-z][A-Za-z0-9-]*'
const ATTRIBUTE =
  '(?:\\s+[a-zA-Z_:][a-zA-Z0-9:._-]*(?:\\s*=\\s*(?:[^"\'=<>`\\x00-\\x20]+|\'[^\']*\'|"[^"]*"))?)'
const OPEN_TAG = `<${TAG_NAME}${ATTRIBUTE}*\\s*/?>`
const CLOSE_TAG = `</${TAG_NAME}\\s*[>]`
const reHtmlTag = new RegExp(
  `^(?:${OPEN_TAG}|${CLOSE_TAG}|<!-->|<!--->|<!--[\\s\\S]*?-->|[<][?][\\s\\S]*?[?][>]|<![A-Za-z][^>]*>|<!\\[CDATA\\[[\\s\\S]*?\\]\\]>)`,
  'i',
)
const reHtmlBlockOpen = [
  /^<(?:script|pre|textarea|style)(?:\s|>|$)/i,
  /^<!--/,
  /^<[?]/,
  /^<![A-Za-z]/,
  /^<!\[CDATA\[/,
  /^<[/]?(?:address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul)(?:\s|[/]?[>]|$)/i,
  new RegExp(`^(?:${OPEN_TAG}|${CLOSE_TAG})\\s*$`, 'i'),
]
const reHtmlBlockClose = [
  /<\/(?:script|pre|textarea|style)>/i,
  /-->/,
  /\?>/,
  />/,
  /\]\]>/,
]

const reThematicBreak = /^(?:\*[ \t]*){3,}$|^(?:_[ \t]*){3,}$|^(?:-[ \t]*){3,}$/
const reAtxHeading = /^#{1,6}(?:[ \t]+|$)/
const reFenceOpen = /^`{3,}(?!.*`)|^~{3,}/
const reFenceClose = /^(?:`{3,}|~{3,})(?=[ \t]*$)/
const reSetext = /^(?:=+|-+)[ \t]*$/
// eslint-disable-next-line no-control-regex -- CommonMark rules control characters out of an address
const reUriAutolink = /^<([a-zA-Z][a-zA-Z0-9.+-]{1,31}:[^<>\x00-\x20]*)>/
const reLinkTitle =
  // eslint-disable-next-line no-control-regex -- CommonMark rules out NUL in a title
  /^(?:"(?:\\[\s\S]|[^"\\\x00])*"|'(?:\\[\s\S]|[^'\\\x00])*'|\((?:\\[\s\S]|[^()\\\x00])*\))/
const reMaybeSpecial = /^[#`~*+_=<>0-9|:-]/
const reDelimiterRow = /^\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/

// Named references a reply is likely to use; any other stays as written.
const NAMED: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: '\u00a0',
  copy: '©',
  reg: '®',
  trade: '™',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  laquo: '«',
  raquo: '»',
  times: '×',
  divide: '÷',
  deg: '°',
  plusmn: '±',
  middot: '·',
  bull: '•',
  euro: '€',
  pound: '£',
  yen: '¥',
  cent: '¢',
  sect: '§',
  para: '¶',
  frac12: '½',
  frac14: '¼',
  frac34: '¾',
  larr: '←',
  rarr: '→',
  uarr: '↑',
  darr: '↓',
  harr: '↔',
  ne: '≠',
  le: '≤',
  ge: '≥',
  infin: '∞',
}

function decodeEntity(entity: string): string {
  const name = entity.slice(1, -1)
  if (name[0] !== '#') return NAMED[name] ?? entity
  const code =
    name[1] === 'x' || name[1] === 'X'
      ? parseInt(name.slice(2), 16)
      : parseInt(name.slice(1), 10)
  return code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)
    ? '\ufffd'
    : String.fromCodePoint(code)
}

function unescape(text: string): string {
  return text.replace(reEscapeOrEntity, (match) =>
    match[0] === '\\' ? match[1] : decodeEntity(match),
  )
}

/** A reference's label as it is matched: case folded, its spaces collapsed. */
function normalizeLabel(label: string): string {
  return label.slice(1, -1).trim().replace(/\s+/g, ' ').toLowerCase().toUpperCase()
}

function normalizeHref(href: string): string {
  return href.replace(/%(?![0-9a-fA-F]{2})|[^\w\-.~:/?#@!$&'()*+,;=%]/g, (char) =>
    char === '%' ? '%25' : encodeURIComponent(char),
  )
}

const isSpace = (char: string | undefined) => char === ' ' || char === '\t'

/* Blocks */

type Kind =
  | 'document'
  | 'quote'
  | 'list'
  | 'item'
  | 'paragraph'
  | 'heading'
  | 'fence'
  | 'indented'
  | 'html'
  | 'table'
  | 'rule'

interface ListData {
  ordered: boolean
  marker: string
  start: number
  padding: number
  offset: number
}

interface Container {
  kind: Kind
  parent: Container | null
  children: Container[]
  open: boolean
  from: number
  to: number
  /** The line it started on. */
  line: number
  lastLineBlank: boolean
  checkedBlank: boolean
  /** Text and the source offset of each of its characters. */
  text: string
  map: number[]
  list?: ListData
  level?: number
  /** `named`: its opening line, which names the language, has ended. */
  fence?: {
    char: string
    length: number
    offset: number
    closed: boolean
    named: boolean
  }
  htmlType?: number
  table?: { align: MarkdownAlign[]; rows: { text: string; map: number[] }[] }
  checked?: boolean | null
}

function container(kind: Kind, parent: Container | null, from: number, line: number) {
  const block: Container = {
    kind,
    parent,
    children: [],
    open: true,
    from,
    to: from,
    line,
    lastLineBlank: false,
    checkedBlank: false,
    text: '',
    map: [],
  }
  parent?.children.push(block)
  return block
}

const acceptsLines = (kind: Kind) =>
  kind === 'paragraph' ||
  kind === 'fence' ||
  kind === 'indented' ||
  kind === 'html' ||
  kind === 'table'

const canContain = (parent: Kind, child: Kind) =>
  parent === 'document' || parent === 'quote' || parent === 'item'
    ? child !== 'item'
    : parent === 'list'
      ? child === 'item'
      : false

class BlockParser {
  root: Container
  tip: Container
  oldTip: Container
  lastMatched: Container
  allClosed = true
  definitions = new Map<string, Definition>()

  line = ''
  lineStart = 0
  lineNumber = 0
  offset = 0
  column = 0
  nextNonspace = 0
  nextNonspaceColumn = 0
  indent = 0
  indented = false
  blank = false
  partialTab = false
  previousLineEnd = 0
  lineEnded = true

  private base: number

  constructor(base: number) {
    this.base = base
    this.root = container('document', null, base, 0)
    this.tip = this.root
    this.oldTip = this.root
    this.lastMatched = this.root
  }

  findNextNonspace() {
    let i = this.offset
    let cols = this.column
    let char: string | undefined
    while ((char = this.line[i]) !== undefined) {
      if (char === ' ') {
        i++
        cols++
      } else if (char === '\t') {
        i++
        cols += 4 - (cols % 4)
      } else break
    }
    this.blank = char === undefined
    this.nextNonspace = i
    this.nextNonspaceColumn = cols
    this.indent = cols - this.column
    this.indented = this.indent >= 4
  }

  advanceNextNonspace() {
    this.offset = this.nextNonspace
    this.column = this.nextNonspaceColumn
    this.partialTab = false
  }

  advanceOffset(count: number, columns: boolean) {
    let char: string | undefined
    while (count > 0 && (char = this.line[this.offset]) !== undefined) {
      if (char === '\t') {
        const toTab = 4 - (this.column % 4)
        if (columns) {
          this.partialTab = toTab > count
          const advance = toTab > count ? count : toTab
          this.column += advance
          this.offset += this.partialTab ? 0 : 1
          count -= advance
        } else {
          this.partialTab = false
          this.column += toTab
          this.offset += 1
          count -= 1
        }
      } else {
        this.partialTab = false
        this.offset += 1
        this.column += 1
        count -= 1
      }
    }
  }

  addLine() {
    const tip = this.tip
    if (this.partialTab) {
      this.offset += 1
      const toTab = 4 - (this.column % 4)
      for (let i = 0; i < toTab; i++) {
        tip.text += ' '
        tip.map.push(this.lineStart + this.offset - 1)
      }
    }
    tip.text += this.line.slice(this.offset) + '\n'
    for (let i = this.offset; i <= this.line.length; i++) tip.map.push(this.lineStart + i)
  }

  addChild(kind: Kind, from: number) {
    while (!canContain(this.tip.kind, kind)) this.finalize(this.tip, this.previousLineEnd)
    const block = container(kind, this.tip, from, this.lineNumber)
    this.tip = block
    return block
  }

  closeUnmatched() {
    if (this.allClosed) return
    while (this.oldTip !== this.lastMatched) {
      const parent = this.oldTip.parent!
      this.finalize(this.oldTip, this.previousLineEnd)
      this.oldTip = parent
    }
    this.allClosed = true
  }

  /** 0: it goes on; 1: it doesn't; 2: it ended on this line. */
  continues(block: Container): 0 | 1 | 2 {
    switch (block.kind) {
      case 'document':
      case 'list':
        return 0
      case 'quote':
        if (!this.indented && this.line[this.nextNonspace] === '>') {
          this.advanceNextNonspace()
          this.advanceOffset(1, false)
          if (isSpace(this.line[this.offset])) this.advanceOffset(1, true)
          return 0
        }
        return 1
      case 'item': {
        const list = block.list!
        if (this.blank) {
          if (block.children.length === 0) return 1
          this.advanceNextNonspace()
          return 0
        }
        if (this.indent >= list.offset + list.padding) {
          this.advanceOffset(list.offset + list.padding, true)
          return 0
        }
        return 1
      }
      case 'fence': {
        const fence = block.fence!
        const rest = this.line.slice(this.nextNonspace)
        const close =
          this.indent <= 3 && rest[0] === fence.char ? reFenceClose.exec(rest) : null
        if (close && close[0].length >= fence.length) {
          fence.closed = true
          this.finalize(block, this.lineStart + this.line.length)
          return 2
        }
        let skip = fence.offset
        while (skip > 0 && isSpace(this.line[this.offset])) {
          this.advanceOffset(1, true)
          skip--
        }
        return 0
      }
      case 'indented':
        if (this.indent >= 4) this.advanceOffset(4, true)
        else if (this.blank) this.advanceNextNonspace()
        else return 1
        return 0
      case 'html':
        return this.blank && (block.htmlType === 6 || block.htmlType === 7) ? 1 : 0
      case 'paragraph':
      case 'table':
        return this.blank ? 1 : 0
      default:
        return 1
    }
  }

  /** 0: none; 1: a container started; 2: a leaf started. */
  start(parent: Container): 0 | 1 | 2 {
    const rest = this.line.slice(this.nextNonspace)
    const from = this.lineStart + this.nextNonspace
    const paragraphLike = parent.kind === 'paragraph' || parent.kind === 'table'
    if (this.indented) {
      if (this.tip.kind === 'paragraph' || this.tip.kind === 'table' || this.blank)
        return 0
      this.advanceOffset(4, true)
      this.closeUnmatched()
      this.addChild('indented', this.lineStart + this.offset)
      return 2
    }
    const first = rest[0]
    if (first === '>') {
      this.advanceNextNonspace()
      this.advanceOffset(1, false)
      if (isSpace(this.line[this.offset])) this.advanceOffset(1, true)
      this.closeUnmatched()
      this.addChild('quote', from)
      return 1
    }
    let match: RegExpExecArray | null
    if (first === '#' && (match = reAtxHeading.exec(rest))) {
      this.advanceNextNonspace()
      this.advanceOffset(match[0].length, false)
      this.closeUnmatched()
      const heading = this.addChild('heading', from)
      heading.level = match[0].trim().length
      // The text, without the closing sequence of #s.
      let text = this.line.slice(this.offset)
      const start = this.lineStart + this.offset
      text = text.replace(/^[ \t]*#+[ \t]*$/, '').replace(/[ \t]+#+[ \t]*$/, '')
      const lead = text.length - text.trimStart().length
      text = text.trim()
      heading.text = text
      heading.map = Array.from({ length: text.length }, (_, i) => start + lead + i)
      this.advanceOffset(this.line.length - this.offset, false)
      return 2
    }
    if ((first === '`' || first === '~') && (match = reFenceOpen.exec(rest))) {
      this.closeUnmatched()
      const fence = this.addChild('fence', from)
      fence.fence = {
        char: first,
        length: match[0].length,
        offset: this.indent,
        closed: false,
        named: this.lineEnded,
      }
      this.advanceNextNonspace()
      this.advanceOffset(match[0].length, false)
      return 2
    }
    if (first === '<') {
      for (let type = 1; type <= 7; type++) {
        if (reHtmlBlockOpen[type - 1].test(rest) && (type < 7 || !paragraphLike)) {
          this.closeUnmatched()
          this.addChild('html', from).htmlType = type
          return 2
        }
      }
    }
    if (parent.kind === 'paragraph' && reSetext.test(rest)) {
      this.closeUnmatched()
      this.takeDefinitions(parent)
      if (parent.text) {
        parent.kind = 'heading'
        parent.level = rest[0] === '=' ? 1 : 2
        trimEnd(parent)
        this.advanceOffset(this.line.length - this.offset, false)
        return 2
      }
      return 0
    }
    if (reThematicBreak.test(rest)) {
      this.closeUnmatched()
      this.addChild('rule', from)
      this.advanceOffset(this.line.length - this.offset, false)
      return 2
    }
    if (
      parent.kind === 'paragraph' &&
      reDelimiterRow.test(rest) &&
      this.startTable(parent, rest)
    )
      return 2
    if (parent.kind === 'list' || !this.indented) {
      const list = this.listMarker(parent)
      if (list) {
        this.closeUnmatched()
        if (
          this.tip.kind !== 'list' ||
          this.tip.list!.ordered !== list.ordered ||
          this.tip.list!.marker !== list.marker
        ) {
          this.addChild('list', from).list = list
        }
        this.addChild('item', from).list = list
        return 1
      }
    }
    return 0
  }

  listMarker(parent: Container): ListData | null {
    const rest = this.line.slice(this.nextNonspace)
    let match: RegExpExecArray | null
    let data: ListData
    if ((match = /^[*+-]/.exec(rest))) {
      data = {
        ordered: false,
        marker: match[0],
        start: 1,
        padding: 0,
        offset: this.indent,
      }
    } else if (
      (match = /^(\d{1,9})([.)])/.exec(rest)) &&
      (parent.kind !== 'paragraph' || match[1] === '1')
    ) {
      data = {
        ordered: true,
        marker: match[2],
        start: parseInt(match[1], 10),
        padding: 0,
        offset: this.indent,
      }
    } else return null
    const next = this.line[this.nextNonspace + match[0].length]
    if (next !== undefined && !isSpace(next)) return null
    if (
      parent.kind === 'paragraph' &&
      !/\S/.test(this.line.slice(this.nextNonspace + match[0].length))
    )
      return null
    this.advanceNextNonspace()
    this.advanceOffset(match[0].length, true)
    const spacesColumn = this.column
    const spacesOffset = this.offset
    let char: string | undefined
    do {
      this.advanceOffset(1, true)
      char = this.line[this.offset]
    } while (this.column - spacesColumn < 5 && isSpace(char))
    const blankItem = this.line[this.offset] === undefined
    const spaces = this.column - spacesColumn
    if (spaces >= 5 || spaces < 1 || blankItem) {
      data.padding = match[0].length + 1
      this.column = spacesColumn
      this.offset = spacesOffset
      this.partialTab = false
      if (isSpace(this.line[this.offset])) this.advanceOffset(1, true)
    } else {
      data.padding = match[0].length + spaces
    }
    return data
  }

  startTable(paragraph: Container, delimiter: string): boolean {
    const lines = splitLines(paragraph)
    const header = lines.at(-1)!
    const head = splitCells(header.text, header.map)
    const align = splitCells(delimiter, []).map(({ text }): MarkdownAlign => {
      const left = text.startsWith(':')
      const right = text.endsWith(':')
      return left && right ? 'center' : left ? 'left' : right ? 'right' : null
    })
    if (head.length !== align.length) return false
    this.closeUnmatched()
    // The lines above the header stay a paragraph.
    const above = lines.slice(0, -1)
    const parent = paragraph.parent!
    if (above.length) {
      paragraph.text = above.map((line) => line.text + '\n').join('')
      paragraph.map = above.flatMap((line) => [...line.map, line.end])
      this.finalize(paragraph, header.map[0] - 1)
      this.tip = parent
    } else {
      parent.children.pop()
      this.tip = parent
    }
    const table = this.addChild('table', header.map[0] ?? header.end)
    table.table = { align, rows: [{ text: header.text, map: header.map }] }
    this.advanceOffset(this.line.length - this.offset, false)
    return true
  }

  finalize(block: Container, end: number) {
    const above = block.parent
    block.open = false
    block.to = Math.max(block.from, end)
    if (block.kind === 'paragraph') {
      this.takeDefinitions(block)
      if (!block.text.trim()) above!.children.splice(above!.children.indexOf(block), 1)
    } else if (block.kind === 'indented') {
      const trimmed = block.text.replace(/(\n[ \t]*)+$/, '\n')
      block.text = trimmed
      block.map.length = trimmed.length
    }
    this.tip = above ?? block
  }

  takeDefinitions(block: Container) {
    let consumed: number
    while (
      block.text[0] === '[' &&
      (consumed = this.definition(block.text, block.map[0]))
    ) {
      block.text = block.text.slice(consumed)
      block.map = block.map.slice(consumed)
    }
  }

  /** The length of a link reference definition at the start of `text`, or 0. */
  definition(text: string, at: number): number {
    const label = /^\[(?:[^\\[\]]|\\.){0,999}\]/.exec(text)
    if (!label || !/\S/.test(label[0].slice(1, -1)) || text[label[0].length] !== ':')
      return 0
    const inline = new InlineParser(text, [], this.definitions, false)
    inline.pos = label[0].length + 1
    inline.spaces()
    const href = inline.destination()
    if (href === null) return 0
    const beforeTitle = inline.pos
    inline.spaces()
    let title: string | null = null
    if (inline.pos !== beforeTitle) title = inline.title()
    if (title === null) inline.pos = beforeTitle
    let end = /^[ \t]*(?:\n|$)/.exec(text.slice(inline.pos))
    if (!end) {
      if (title === null) return 0
      title = null
      inline.pos = beforeTitle
      end = /^[ \t]*(?:\n|$)/.exec(text.slice(inline.pos))
      if (!end) return 0
    }
    const key = normalizeLabel(label[0])
    if (!this.definitions.has(key)) this.definitions.set(key, { href, title, at })
    return inline.pos + end[0].length
  }

  incorporate(line: string, lineStart: number) {
    this.line = line
    this.lineStart = lineStart
    this.offset = 0
    this.column = 0
    this.blank = false
    this.partialTab = false
    this.lineNumber += 1
    this.oldTip = this.tip

    let block: Container = this.root
    let last: Container | undefined
    while ((last = block.children.at(-1)) && last.open) {
      this.findNextNonspace()
      const result = this.continues(last)
      if (result === 1) break
      if (result === 2) {
        this.previousLineEnd = lineStart + line.length
        return
      }
      block = last
    }
    this.allClosed = block === this.oldTip
    this.lastMatched = block

    let matchedLeaf =
      block.kind !== 'paragraph' && block.kind !== 'table' && acceptsLines(block.kind)
    while (!matchedLeaf) {
      this.findNextNonspace()
      if (!this.indented && !reMaybeSpecial.test(line.slice(this.nextNonspace))) {
        this.advanceNextNonspace()
        break
      }
      const result = this.start(block)
      if (result === 0) {
        this.advanceNextNonspace()
        break
      }
      block = this.tip
      if (result === 2) matchedLeaf = true
    }

    if (!this.allClosed && !this.blank && this.tip.kind === 'paragraph') {
      this.addLine()
    } else {
      this.closeUnmatched()
      const kind = block.kind
      if (this.blank && block.children.length) block.children.at(-1)!.lastLineBlank = true
      const lastLineBlank =
        this.blank &&
        !(
          kind === 'quote' ||
          kind === 'fence' ||
          (kind === 'item' && !block.children.length && block.line === this.lineNumber)
        )
      for (let up: Container | null = block; up; up = up.parent)
        up.lastLineBlank = lastLineBlank
      if (kind === 'table') {
        // The delimiter row that started it is not a row.
        if (block.line === this.lineNumber)
          return void (this.previousLineEnd = lineStart + line.length)
        const start = lineStart + this.offset
        block.table!.rows.push({
          text: line.slice(this.offset),
          map: Array.from({ length: line.length - this.offset }, (_, i) => start + i),
        })
      } else if (acceptsLines(kind)) {
        this.addLine()
        if (
          kind === 'html' &&
          block.htmlType! <= 5 &&
          reHtmlBlockClose[block.htmlType! - 1].test(line.slice(this.offset))
        ) {
          this.finalize(block, lineStart + line.length)
        }
      } else if (this.offset < line.length && !this.blank) {
        this.addChild('paragraph', lineStart + this.nextNonspace)
        this.advanceNextNonspace()
        this.addLine()
      }
    }
    this.previousLineEnd = lineStart + line.length
  }

  run(source: string) {
    let lineStart = 0
    while (lineStart < source.length) {
      let end = source.indexOf('\n', lineStart)
      if (end === -1) end = source.length
      this.lineEnded = end < source.length
      this.incorporate(source.slice(lineStart, end), this.base + lineStart)
      lineStart = end + 1
    }
    while (this.tip !== this.root) this.finalize(this.tip, this.base + source.length)
    this.finalize(this.root, this.base + source.length)
  }
}

function trimEnd(block: Container) {
  const trimmed = block.text.replace(/[ \t\n]+$/, '')
  block.text = trimmed.replace(/^[ \t]+/gm, '')
  // Leading spaces on each line go too, so the map is rebuilt line by line.
  const map: number[] = []
  let i = 0
  for (const line of trimmed.split('\n')) {
    const lead = line.length - line.trimStart().length
    for (let j = lead; j < line.length; j++) map.push(block.map[i + j])
    map.push(block.map[i + line.length])
    i += line.length + 1
  }
  map.length = block.text.length
  block.map = map
}

function splitLines(block: Container) {
  const lines: { text: string; map: number[]; end: number }[] = []
  let start = 0
  const text = block.text
  while (start < text.length) {
    const end = text.indexOf('\n', start)
    const stop = end === -1 ? text.length : end
    lines.push({
      text: text.slice(start, stop),
      map: block.map.slice(start, stop),
      end: block.map[stop] ?? block.map[stop - 1] + 1,
    })
    start = stop + 1
  }
  return lines
}

/** A table row's cells: split on pipes that aren't escaped or in code, each trimmed. */
function splitCells(text: string, map: number[]) {
  const cells: { text: string; map: number[] }[] = []
  let i = 0
  const trimmed = text.replace(/[ \t]+$/, '')
  let end = trimmed.length
  while (i < end && isSpace(trimmed[i])) i++
  if (trimmed[i] === '|') i++
  if (end > i && trimmed[end - 1] === '|' && trimmed[end - 2] !== '\\') end--
  let start = i
  for (; i <= end; i++) {
    if (i === end || (trimmed[i] === '|' && trimmed[i - 1] !== '\\')) {
      let a = start
      let b = i
      while (a < b && isSpace(trimmed[a])) a++
      while (b > a && isSpace(trimmed[b - 1])) b--
      // An escaped pipe is a pipe in the cell.
      let cell = ''
      const cellMap: number[] = []
      for (let j = a; j < b; j++) {
        if (trimmed[j] === '\\' && trimmed[j + 1] === '|') continue
        cell += trimmed[j]
        cellMap.push(map[j])
      }
      cells.push({ text: cell, map: cellMap })
      start = i + 1
    }
  }
  return cells
}

/* Inlines */

interface Node {
  inline: MarkdownInline
  prev: Node | null
  next: Node | null
}

interface Delimiter {
  char: string
  count: number
  original: number
  node: Node
  canOpen: boolean
  canClose: boolean
  prev: Delimiter | null
  next: Delimiter | null
}

interface Bracket {
  node: Node
  image: boolean
  index: number
  active: boolean
  bracketAfter: boolean
  delimiter: Delimiter | null
  prev: Bracket | null
}

const rePunctuation = /^[\p{P}\p{S}]/u
const reWhitespace = /^\s/u
const reText = /^[^\n`[\]\\!<&*_~]+/

class InlineParser {
  pos = 0
  first: Node | null = null
  last: Node | null = null
  delimiters: Delimiter | null = null
  brackets: Bracket | null = null
  /** Where the cut end starts, when the text is still streaming. */
  cut: number

  s: string
  private map: number[]
  private definitions: Map<string, Definition>
  private streaming: boolean

  constructor(
    s: string,
    map: number[],
    definitions: Map<string, Definition>,
    streaming: boolean,
  ) {
    this.s = s
    this.map = map
    this.definitions = definitions
    this.streaming = streaming
    this.cut = s.length
    if (streaming) {
      // Markers at the very end may still become something else: they wait.
      const tail = /(?:[*_~`[\\<]|!\[?)+$/.exec(s)
      if (tail) this.cut = tail.index
      this.s = s.slice(0, this.cut)
    }
  }

  at(i: number) {
    if (i < this.map.length) return this.map[i]
    return this.map.length ? this.map[this.map.length - 1] + 1 : 0
  }

  end(i: number) {
    return i > 0 ? this.map[i - 1] + 1 : this.at(0)
  }

  peek() {
    return this.s[this.pos]
  }

  spaces() {
    const match = /^[ \t]*(?:\n[ \t]*)?/.exec(this.s.slice(this.pos))!
    this.pos += match[0].length
    return true
  }

  append(inline: MarkdownInline): Node {
    const node: Node = { inline, prev: this.last, next: null }
    if (this.last) this.last.next = node
    else this.first = node
    this.last = node
    return node
  }

  text(value: string, from: number, to: number) {
    return this.append({ type: 'text', value, from: this.at(from), to: this.end(to) })
  }

  parse(): MarkdownInline[] {
    while (this.pos < this.s.length) this.step()
    this.processEmphasis(null, this.streaming)
    if (this.streaming) this.closeCut()
    return finish(collect(this.first), false)
  }

  step() {
    const start = this.pos
    const char = this.s[start]
    let match: RegExpExecArray | null
    switch (char) {
      case '\n':
        return this.newline()
      case '\\':
        this.pos++
        if (this.peek() === '\n') {
          this.pos++
          this.append({ type: 'break', from: this.at(start), to: this.end(this.pos) })
          this.skipLeadingSpaces()
        } else if (this.peek() !== undefined && reEscapable.test(this.peek()!)) {
          this.pos++
          this.text(this.s[start + 1], start, this.pos)
        } else this.text('\\', start, this.pos)
        return
      case '`':
        return this.backticks()
      case '*':
      case '_':
      case '~':
        return this.delimiter(char)
      case '[':
        this.pos++
        this.pushBracket(this.text('[', start, this.pos), start, false)
        return
      case '!':
        this.pos++
        if (this.peek() === '[') {
          this.pos++
          this.pushBracket(this.text('![', start, this.pos), start + 1, true)
        } else this.text('!', start, this.pos)
        return
      case ']':
        return this.closeBracket()
      case '<':
        if ((match = reUriAutolink.exec(this.s.slice(start)))) {
          return this.autolink(match[0], match[1], normalizeHref(match[1]))
        }
        if (
          (match =
            /^<([a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*)>/.exec(
              this.s.slice(start),
            ))
        ) {
          return this.autolink(match[0], match[1], 'mailto:' + normalizeHref(match[1]))
        }
        if ((match = reHtmlTag.exec(this.s.slice(start)))) {
          this.pos += match[0].length
          this.text(match[0], start, this.pos)
          return
        }
        this.pos++
        this.text('<', start, this.pos)
        return
      case '&':
        if ((match = reEntityHere.exec(this.s.slice(start)))) {
          this.pos += match[0].length
          this.text(decodeEntity(match[0]), start, this.pos)
        } else {
          this.pos++
          this.text('&', start, this.pos)
        }
        return
      default:
        match = reText.exec(this.s.slice(start))
        this.pos += match ? match[0].length : 1
        this.text(this.s.slice(start, this.pos), start, this.pos)
    }
  }

  autolink(raw: string, label: string, href: string) {
    const start = this.pos
    this.pos += raw.length
    this.append({
      type: 'link',
      href,
      title: null,
      from: this.at(start),
      to: this.end(this.pos),
      children: [
        {
          type: 'text',
          value: label,
          from: this.at(start + 1),
          to: this.end(this.pos - 1),
        },
      ],
    })
  }

  newline() {
    const start = this.pos
    this.pos++
    const last = this.last?.inline
    if (last?.type === 'text' && last.value.endsWith(' ')) {
      const hard = last.value.endsWith('  ')
      const kept = last.value.replace(/ +$/, '')
      last.to -= last.value.length - kept.length
      last.value = kept
      if (!kept) this.remove(this.last!)
      if (hard) {
        this.append({ type: 'break', from: this.at(start), to: this.end(this.pos) })
        this.skipLeadingSpaces()
        return
      }
    }
    this.text('\n', start, this.pos)
    this.skipLeadingSpaces()
  }

  skipLeadingSpaces() {
    while (this.peek() === ' ') this.pos++
  }

  backticks() {
    const start = this.pos
    const ticks = /^`+/.exec(this.s.slice(start))![0]
    const after = start + ticks.length
    const re = /`+/g
    re.lastIndex = after
    let match: RegExpExecArray | null
    while ((match = re.exec(this.s))) {
      if (match[0].length === ticks.length) {
        this.pos = match.index + ticks.length
        this.code(this.s.slice(after, match.index), start, this.pos)
        return
      }
    }
    if (this.streaming && this.cut < Infinity) {
      // A code span still being written: what has arrived is its code.
      this.pos = this.s.length
      this.code(this.s.slice(after), start, this.pos, true)
      return
    }
    this.pos = after
    this.text(ticks, start, after)
  }

  code(raw: string, start: number, end: number, open = false) {
    let value = raw.replace(/\n/g, ' ')
    if (
      !open &&
      value.length > 2 &&
      value[0] === ' ' &&
      value.at(-1) === ' ' &&
      /[^ ]/.test(value)
    ) {
      value = value.slice(1, -1)
    }
    this.append({ type: 'code', value, from: this.at(start), to: this.end(end) })
  }

  delimiter(char: string) {
    const start = this.pos
    while (this.s[this.pos] === char) this.pos++
    const count = this.pos - start
    const before = start === 0 ? '\n' : this.s[start - 1]
    const after = this.pos >= this.s.length ? '\n' : this.s[this.pos]
    const afterSpace = reWhitespace.test(after)
    const afterPunct = rePunctuation.test(after)
    const beforeSpace = reWhitespace.test(before)
    const beforePunct = rePunctuation.test(before)
    const leftFlanking = !afterSpace && (!afterPunct || beforeSpace || beforePunct)
    const rightFlanking = !beforeSpace && (!beforePunct || afterSpace || afterPunct)
    let canOpen = leftFlanking
    let canClose = rightFlanking
    if (char === '_') {
      canOpen = leftFlanking && (!rightFlanking || beforePunct)
      canClose = rightFlanking && (!leftFlanking || afterPunct)
    }
    if (char === '~' && count > 2) canOpen = canClose = false
    const node = this.text(this.s.slice(start, this.pos), start, this.pos)
    if (canOpen || canClose) {
      const delimiter: Delimiter = {
        char,
        count,
        original: count,
        node,
        canOpen,
        canClose,
        prev: this.delimiters,
        next: null,
      }
      if (this.delimiters) this.delimiters.next = delimiter
      this.delimiters = delimiter
    }
  }

  removeDelimiter(delimiter: Delimiter) {
    if (delimiter.prev) delimiter.prev.next = delimiter.next
    if (delimiter.next) delimiter.next.prev = delimiter.prev
    else this.delimiters = delimiter.prev
  }

  remove(node: Node) {
    if (node.prev) node.prev.next = node.next
    else this.first = node.next
    if (node.next) node.next.prev = node.prev
    else this.last = node.prev
  }

  /** Moves the nodes after `opener` and before `closer` into a new node between them. */
  wrap(
    opener: Node,
    closer: Node | null,
    inline: MarkdownInline & { children: MarkdownInline[] },
  ) {
    const children: MarkdownInline[] = []
    let node = opener.next
    while (node && node !== closer) {
      children.push(node.inline)
      node = node.next
    }
    inline.children = children
    const wrapped: Node = { inline, prev: opener, next: closer }
    opener.next = wrapped
    if (closer) closer.prev = wrapped
    else this.last = wrapped
    return wrapped
  }

  /** Matches emphasis above `bottom`. Openers left unmatched stay on the stack when `keep` is set. */
  processEmphasis(bottom: Delimiter | null, keep = false) {
    const openersBottom: Record<string, Delimiter | null> = {}
    let closer = this.delimiters
    while (closer && closer.prev !== bottom) closer = closer.prev
    while (closer) {
      if (!closer.canClose) {
        closer = closer.next
        continue
      }
      const key = `${closer.char}${closer.canOpen ? 1 : 0}${closer.original % 3}`
      let opener = closer.prev
      let found = false
      while (opener && opener !== bottom && opener !== openersBottom[key]) {
        const oddMatch =
          (closer.canOpen || opener.canClose) &&
          closer.original % 3 !== 0 &&
          (opener.original + closer.original) % 3 === 0
        if (
          opener.char === closer.char &&
          opener.canOpen &&
          !oddMatch &&
          (closer.char !== '~' || opener.count === closer.count)
        ) {
          found = true
          break
        }
        opener = opener.prev
      }
      const oldCloser = closer
      if (found && opener) {
        const used =
          closer.char === '~'
            ? closer.count
            : closer.count >= 2 && opener.count >= 2
              ? 2
              : 1
        const openerText = opener.node.inline as {
          value: string
          to: number
          from: number
        }
        const closerText = closer.node.inline as {
          value: string
          to: number
          from: number
        }
        opener.count -= used
        closer.count -= used
        openerText.value = openerText.value.slice(0, opener.count)
        openerText.to -= used
        closerText.value = closerText.value.slice(0, closer.count)
        closerText.from += used
        this.wrap(opener.node, closer.node, {
          type: closer.char === '~' ? 'delete' : used === 2 ? 'strong' : 'emphasis',
          from: openerText.to,
          to: closerText.from,
          children: [],
        })
        // Delimiters between the two are used up.
        let between = closer.prev
        while (between && between !== opener) {
          const prev = between.prev
          this.removeDelimiter(between)
          between = prev
        }
        if (opener.count === 0) {
          this.remove(opener.node)
          this.removeDelimiter(opener)
        }
        if (closer.count === 0) {
          const next = closer.next
          this.remove(closer.node)
          this.removeDelimiter(closer)
          closer = next
        }
      } else {
        closer = closer.next
        if (!found) {
          openersBottom[key] = oldCloser.prev
          if (!oldCloser.canOpen) this.removeDelimiter(oldCloser)
        }
      }
    }
    if (keep) return
    while (this.delimiters && this.delimiters !== bottom)
      this.removeDelimiter(this.delimiters)
  }

  pushBracket(node: Node, index: number, image: boolean) {
    if (this.brackets) this.brackets.bracketAfter = true
    this.brackets = {
      node,
      image,
      index: index + 1,
      active: true,
      bracketAfter: false,
      delimiter: this.delimiters,
      prev: this.brackets,
    }
  }

  destination(): string | null {
    const rest = this.s.slice(this.pos)
    // eslint-disable-next-line no-control-regex -- CommonMark rules these characters out here
    const angle = /^<(?:[^<>\n\\\x00]|\\.)*>/.exec(rest)
    if (angle) {
      this.pos += angle[0].length
      return normalizeHref(unescape(angle[0].slice(1, -1)))
    }
    if (rest[0] === '<') return null
    let depth = 0
    let i = 0
    for (; i < rest.length; i++) {
      const char = rest[i]
      if (char === '\\' && reEscapable.test(rest[i + 1] ?? '')) i++
      else if (char === '(') depth++
      else if (char === ')') {
        if (depth === 0) break
        depth--
        // eslint-disable-next-line no-control-regex -- CommonMark rules these characters out here
      } else if (/[\x00-\x20]/.test(char)) break
    }
    if (i === 0 && rest[0] !== ')') return null
    if (depth !== 0) return null
    this.pos += i
    return normalizeHref(unescape(rest.slice(0, i)))
  }

  title(): string | null {
    const match = reLinkTitle.exec(this.s.slice(this.pos))
    if (!match) return null
    this.pos += match[0].length
    return unescape(match[0].slice(1, -1))
  }

  label(): number {
    const match = /^\[(?:[^\\[\]]|\\.){0,999}\]/s.exec(this.s.slice(this.pos))
    return match ? match[0].length : 0
  }

  closeBracket() {
    const start = this.pos
    this.pos++
    const opener = this.brackets
    if (!opener) {
      this.text(']', start, this.pos)
      return
    }
    if (!opener.active) {
      this.text(']', start, this.pos)
      this.brackets = opener.prev
      return
    }
    const after = this.pos
    let href: string | null = null
    let title: string | null = null
    let matched = false
    let pending = false
    if (this.peek() === '(') {
      this.pos++
      this.spaces()
      const dest = this.destination()
      if (dest !== null) {
        const beforeTitle = this.pos
        this.spaces()
        if (this.pos !== beforeTitle) title = this.title()
        this.spaces()
        if (this.peek() === ')') {
          this.pos++
          href = dest
          matched = true
        }
      }
      if (!matched && this.streaming && !this.s.slice(after).includes(')')) {
        // The address is still arriving.
        this.pos = this.s.length
        matched = pending = true
        title = null
      }
      if (!matched) this.pos = after
    } else if (this.streaming && after === this.s.length) {
      matched = pending = true
    }
    if (!matched) {
      const beforeLabel = this.pos
      const length = this.label()
      let reference: string | null = null
      if (length > 2) reference = this.s.slice(beforeLabel, beforeLabel + length)
      else if (!opener.bracketAfter) reference = this.s.slice(opener.index - 1, start + 1)
      this.pos = length ? beforeLabel + length : after
      const definition = reference
        ? this.definitions.get(normalizeLabel(reference))
        : undefined
      if (definition) {
        href = definition.href
        title = definition.title
        matched = true
      } else this.pos = after
    }
    if (!matched) {
      this.brackets = opener.prev
      this.text(']', start, after)
      return
    }
    const from = this.at(opener.index - (opener.image ? 2 : 1))
    const to = this.end(this.pos)
    this.processEmphasis(opener.delimiter)
    const children = finish(collect(opener.node.next), true)
    const node: Node = {
      inline: opener.image
        ? { type: 'image', src: href ?? '', alt: plain(children), title, from, to }
        : { type: 'link', href: pending ? null : href, title, from, to, children },
      prev: null,
      next: null,
    }
    // The link takes the place of everything from its opening bracket on.
    const before = opener.node.prev
    node.prev = before
    if (before) before.next = node
    else this.first = node
    this.last = node
    this.brackets = opener.prev
    if (!opener.image) {
      for (let up = this.brackets; up; up = up.prev) if (!up.image) up.active = false
    }
    if (pending && opener.image) this.remove(node)
  }

  /** Closes what is still open at the cut end of a streaming text. */
  closeCut() {
    // Brackets still open: the text after them is a link still being written.
    const open: { node: Node; kind: 'bracket' | 'delimiter'; delimiter?: Delimiter }[] =
      []
    for (let bracket = this.brackets; bracket; bracket = bracket.prev) {
      if (bracket.active) open.push({ node: bracket.node, kind: 'bracket' })
    }
    // Emphasis left open after processing: what follows the opener is its content.
    for (let delimiter = this.delimiters; delimiter; delimiter = delimiter.prev) {
      if (delimiter.canOpen && delimiter.count > 0)
        open.push({ node: delimiter.node, kind: 'delimiter', delimiter })
    }
    // Innermost first: the one that starts last.
    open.sort((a, b) => b.node.inline.from - a.node.inline.from)
    for (const item of open) {
      const marker = item.node.inline as { value: string; from: number; to: number }
      if (item.kind === 'bracket') {
        const image = marker.value === '!['
        const wrapped = this.wrap(item.node, null, {
          type: 'link',
          href: null,
          title: null,
          from: marker.from,
          to: this.end(this.s.length),
          children: [],
        })
        this.remove(item.node)
        if (image) this.remove(wrapped)
        continue
      }
      const delimiter = item.delimiter!
      type Wrapper = Extract<MarkdownInline, { type: 'emphasis' | 'strong' | 'delete' }>
      let inline: Wrapper
      const make = (type: Wrapper['type']): Wrapper => ({
        type,
        from: marker.to,
        to: this.end(this.s.length),
        children: [],
      })
      if (delimiter.char === '~') inline = make('delete')
      else inline = make(delimiter.count >= 2 ? 'strong' : 'emphasis')
      this.wrap(item.node, null, inline)
      if (delimiter.char !== '~' && delimiter.count >= 3) {
        inline.children = [{ ...make('emphasis'), children: inline.children }]
      }
      this.remove(item.node)
    }
    this.delimiters = null
    this.brackets = null
  }
}

function collect(first: Node | null): MarkdownInline[] {
  const list: MarkdownInline[] = []
  for (let node = first; node; node = node.next) list.push(node.inline)
  return list
}

/** Joins text runs that sit side by side in the source, drops empty ones, and finds bare links. */
function finish(list: MarkdownInline[], inLink: boolean): MarkdownInline[] {
  const out: MarkdownInline[] = []
  for (const inline of list) {
    if (inline.type === 'text') {
      if (!inline.value) continue
      const last = out.at(-1)
      if (
        last?.type === 'text' &&
        last.to === inline.from &&
        last.value.length === last.to - last.from &&
        inline.value.length === inline.to - inline.from &&
        inline.value !== '\n' &&
        last.value !== '\n'
      ) {
        last.value += inline.value
        last.to = inline.to
        continue
      }
      out.push({ ...inline })
    } else if ('children' in inline) {
      inline.children = finish(inline.children, inLink || inline.type === 'link')
      out.push(inline)
    } else out.push(inline)
  }
  return inLink ? out : out.flatMap(bareLinks)
}

const reBareLink =
  /(?:^|(?<=[\s*_~(]))(?:(?:https?:\/\/|www\.)[\w-]+(?:\.[\w-]+)*[^\s<]*|[\w.+-]+@[\w-]+(?:\.[\w-]+)*\.[\w-]*[a-zA-Z0-9])/g

/** GFM's autolinks: bare `www.`, `http://` and email addresses in plain text. */
function bareLinks(inline: MarkdownInline): MarkdownInline[] {
  if (inline.type !== 'text' || inline.value.length !== inline.to - inline.from)
    return [inline]
  const out: MarkdownInline[] = []
  let last = 0
  const value = inline.value
  for (const match of value.matchAll(reBareLink)) {
    let link = match[0]
    const email = !/^(?:https?:\/\/|www\.)/.test(link)
    if (!email) {
      // Trailing punctuation isn't part of the link, nor a parenthesis it doesn't open.
      link = link.replace(/[?!.,:*_~]+$/, '')
      while (link.endsWith(')') && count(link, '(') < count(link, ')'))
        link = link.slice(0, -1)
      link = link.replace(/&[a-zA-Z0-9]+;$/, '').replace(/[?!.,:*_~]+$/, '')
      if (!/^(?:https?:\/\/|www\.)[\w-]+(?:\.[\w-]+)/.test(link)) continue
      if (/_[^.]*\.[^.]*$/.test(link.replace(/^(?:https?:\/\/)?/, '').split('/')[0]))
        continue
    } else if (/[-_]/.test(value[match.index + link.length] ?? '')) continue
    const start = match.index
    if (start > last)
      out.push({
        type: 'text',
        value: value.slice(last, start),
        from: inline.from + last,
        to: inline.from + start,
      })
    const from = inline.from + start
    const to = from + link.length
    out.push({
      type: 'link',
      href: email ? 'mailto:' + link : link.startsWith('www.') ? 'http://' + link : link,
      title: null,
      from,
      to,
      children: [{ type: 'text', value: link, from, to }],
    })
    last = start + link.length
  }
  if (last === 0) return [inline]
  if (last < value.length)
    out.push({
      type: 'text',
      value: value.slice(last),
      from: inline.from + last,
      to: inline.to,
    })
  return out
}

const count = (text: string, char: string) => text.split(char).length - 1

/** The text of inlines with no marks, for an image's alt text. */
export function plain(list: MarkdownInline[]): string {
  return list
    .map((inline) =>
      inline.type === 'text' || inline.type === 'code'
        ? inline.value
        : inline.type === 'image'
          ? inline.alt
          : inline.type === 'break'
            ? '\n'
            : plain(inline.children),
    )
    .join('')
}

/* The tree */

function inlines(
  text: string,
  map: number[],
  definitions: Map<string, Definition>,
  streaming: boolean,
): MarkdownInline[] {
  return new InlineParser(
    text.replace(/[ \t\n]+$/, ''),
    map,
    definitions,
    streaming,
  ).parse()
}

function toBlocks(
  block: Container,
  definitions: Map<string, Definition>,
  streamEnd: Container | null,
): MarkdownBlock[] {
  return block.children.flatMap((child): MarkdownBlock[] => {
    const range = { from: child.from, to: child.to }
    const cut = child === streamEnd
    switch (child.kind) {
      case 'paragraph':
        return [
          {
            type: 'paragraph',
            ...range,
            children: inlines(
              child.text.trim() ? child.text.replace(/^[ \t]+/gm, '') : '',
              mapWithoutIndent(child),
              definitions,
              cut,
            ),
          },
        ]
      case 'heading':
        return [
          {
            type: 'heading',
            ...range,
            depth: child.level as 1 | 2 | 3 | 4 | 5 | 6,
            children: inlines(child.text, child.map, definitions, cut),
          },
        ]
      case 'fence': {
        const newline = child.text.indexOf('\n')
        const info = unescape(
          (newline === -1 ? child.text : child.text.slice(0, newline)).trim(),
        )
        const closedInfo = child.fence!.named || child.fence!.closed
        return [
          {
            type: 'code',
            ...range,
            language: closedInfo ? info.split(/\s+/)[0] || null : null,
            value: newline === -1 ? '' : child.text.slice(newline + 1),
            open: !child.fence!.closed,
          },
        ]
      }
      case 'indented':
        return [
          { type: 'code', ...range, language: null, value: child.text, open: false },
        ]
      case 'html':
        return [{ type: 'html', ...range, value: child.text.replace(/\n$/, '') }]
      case 'rule':
        return [{ type: 'rule', ...range }]
      case 'quote':
        return [
          { type: 'quote', ...range, children: toBlocks(child, definitions, streamEnd) },
        ]
      case 'list':
        return [
          {
            type: 'list',
            ...range,
            ordered: child.list!.ordered,
            start: child.list!.start,
            tight: isTight(child),
            items: child.children.map((item) => toItem(item, definitions, streamEnd)),
          },
        ]
      case 'table': {
        const { align, rows } = child.table!
        const cells = (row: { text: string; map: number[] }, last: boolean) => {
          const split = splitCells(row.text, row.map).slice(0, align.length)
          while (split.length < align.length) split.push({ text: '', map: [] })
          return split.map((cell, i) =>
            inlines(cell.text, cell.map, definitions, last && i === split.length - 1),
          )
        }
        return [
          {
            type: 'table',
            ...range,
            align,
            head: cells(rows[0], false),
            rows: rows.slice(1).map((row, i) => cells(row, cut && i === rows.length - 2)),
          },
        ]
      }
      default:
        return []
    }
  })
}

function mapWithoutIndent(block: Container): number[] {
  const map: number[] = []
  let atLineStart = true
  for (let i = 0; i < block.text.length; i++) {
    const char = block.text[i]
    if (atLineStart && isSpace(char)) continue
    atLineStart = char === '\n'
    map.push(block.map[i])
  }
  return map
}

function toItem(
  item: Container,
  definitions: Map<string, Definition>,
  streamEnd: Container | null,
): MarkdownItem {
  const children = toBlocks(item, definitions, streamEnd)
  let checked: boolean | null = null
  const first = item.children[0]
  const task =
    first?.kind === 'paragraph'
      ? /^\[([ xX])\](?=[ \t\n]|$)[ \t]*/.exec(first.text)
      : null
  if (task && children[0]?.type === 'paragraph') {
    checked = task[1] !== ' '
    const end = first.map[task[0].length - 1] + 1
    const paragraph = children[0]
    paragraph.children = paragraph.children
      .map((inline) => {
        if (inline.to <= end) return null
        if (inline.type === 'text' && inline.from < end) {
          const cut = end - inline.from
          return { ...inline, value: inline.value.slice(cut), from: end }
        }
        return inline
      })
      .filter((inline): inline is MarkdownInline => inline !== null)
  }
  return { from: item.from, to: item.to, checked, children }
}

function endsWithBlankLine(block: Container | undefined): boolean {
  while (block) {
    if (block.lastLineBlank) return true
    if (!block.checkedBlank && (block.kind === 'list' || block.kind === 'item')) {
      block.checkedBlank = true
      block = block.children.at(-1)
    } else {
      block.checkedBlank = true
      break
    }
  }
  return false
}

function isTight(list: Container): boolean {
  const items = list.children
  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    const nextItem = i < items.length - 1
    if (endsWithBlankLine(item) && nextItem) return false
    const children = item.children
    for (let j = 0; j < children.length; j++) {
      if (endsWithBlankLine(children[j]) && (nextItem || j < children.length - 1))
        return false
    }
  }
  return true
}

/** The leaf a streaming text is cut in: the last, when nothing but blank lines follows it. */
function cutLeaf(root: Container, text: string, base: number): Container | null {
  let last = root.children.at(-1)
  while (last && last.children.length) last = last.children.at(-1)
  return last && !/\S/.test(text.slice(last.to - base)) ? last : null
}

/** A line still arriving that may turn into a different block once it ends, or a fence whose language is still arriving. */
const reUnsettledLine =
  /^[ \t>]*(?:[-=_*+]+|#{1,6}|[`~]{1,2}|`{3,}[^`]*|~{3,}.*|\d{1,9}[.)]?|[|:\- \t]+|\|.*|(?:[-*+]|\d{1,9}[.)])[ \t]+\[[ xX]?\]?)?[ \t]*$/

function parseBlocks(
  source: string,
  base: number,
  streaming: boolean,
  definitions: Map<string, Definition>,
) {
  let text = source
  if (streaming) {
    const lineStart = text.lastIndexOf('\n') + 1
    if (reUnsettledLine.test(text.slice(lineStart)) && text.slice(lineStart).trim()) {
      text = text.slice(0, lineStart)
    }
  }
  let parser = new BlockParser(base)
  parser.definitions = new Map(definitions)
  parser.run(text)
  if (streaming) {
    // A table's header waits for its delimiter row, so it never shows as text first.
    const leaf = cutLeaf(parser.root, text, base)
    if (leaf?.kind === 'paragraph') {
      const lines = splitLines(leaf)
      let keep = lines.length
      while (keep > 0 && /^\s*\|/.test(lines[keep - 1].text)) keep--
      if (keep < lines.length) {
        const cutAt = lines[keep].map[0] - base
        const lineStart = text.lastIndexOf('\n', cutAt - 1) + 1
        text = text.slice(0, lineStart)
        parser = new BlockParser(base)
        parser.definitions = new Map(definitions)
        parser.run(text)
      }
    }
  }
  return { parser, cutEnd: streaming ? cutLeaf(parser.root, text, base) : null }
}

/**
 * Parses `source`. Given the parse of an earlier, shorter version of the same
 * text, only its last top-level block is parsed again, and the blocks before
 * it are the same objects as before.
 */
export function parseMarkdown(
  source: string,
  {
    streaming = false,
    previous,
  }: { streaming?: boolean; previous?: MarkdownDocument } = {},
): MarkdownDocument {
  if (previous && previous.streaming && source.startsWith(previous.source)) {
    const { blocks, starts } = previous
    let last = blocks.length - 1
    // A block that broke into a paragraph may turn back into its next line: the paragraph is parsed again too.
    const before = blocks[last - 1]
    if (
      before?.type === 'paragraph' &&
      !/\n[ \t]*\n/.test(source.slice(before.to, starts[last]))
    )
      last--
    const restart = starts[last] ?? 0
    const kept = blocks.slice(0, last)
    const keptStarts = starts.slice(0, last)
    // The definitions above the last block hold; the last block's are found again.
    const above = new Map([...previous.definitions].filter(([, { at }]) => at < restart))
    const { parser, cutEnd } = parseBlocks(
      source.slice(restart),
      restart,
      streaming,
      above,
    )
    // A definition that is new or changed can turn text above into a link: parse it all again.
    if (sameDefinitions(parser.definitions, previous.definitions)) {
      const blocks = toBlocks(parser.root, parser.definitions, cutEnd)
      return {
        source,
        streaming,
        blocks: [...kept, ...blocks],
        starts: [...keptStarts, ...lineStarts(source, parser.root)],
        definitions: parser.definitions,
      }
    }
  }
  const { parser, cutEnd } = parseBlocks(source, 0, streaming, new Map())
  return {
    source,
    streaming,
    blocks: toBlocks(parser.root, parser.definitions, cutEnd),
    starts: lineStarts(source, parser.root),
    definitions: parser.definitions,
  }
}

function sameDefinitions(a: Map<string, Definition>, b: Map<string, Definition>) {
  if (a.size !== b.size) return false
  for (const [key, value] of a) {
    const other = b.get(key)
    if (!other || other.href !== value.href || other.title !== value.title) return false
  }
  return true
}

function lineStarts(source: string, root: Container): number[] {
  return root.children.map((child) => source.lastIndexOf('\n', child.from - 1) + 1)
}
