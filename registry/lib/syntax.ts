import type { BundledLanguage } from 'shiki/langs'

/*
 * Code as lines of coloured tokens, for the Code block. Shiki reads the
 * grammar; the colours are CSS variables (`--code-keyword`, `--code-string`
 * and the rest), so they follow the theme and a project changes them in its
 * CSS. Shiki and each language load the first time they are needed, in the
 * browser or on a server, so a page that shows no code never fetches them.
 */

/** A run of text in one colour. With no `color` it takes the block's text colour. */
export interface CodeToken {
  content: string
  /** A CSS colour, such as `var(--code-keyword)`. */
  color?: string
  italic?: boolean
}

/**
 * A language by its name or alias (`tsx`, `bash`, `sh`), or plain `text`.
 * Any other, such as a Markdown fence's `mermaid`, shows as plain text.
 */
export type CodeLanguage = Exclude<BundledLanguage, 'ansi'> | 'text' | (string & {})

const LANGUAGE_NAMES: Record<string, string> = {
  bash: 'Bash',
  c: 'C',
  cpp: 'C++',
  csharp: 'C#',
  cs: 'C#',
  css: 'CSS',
  diff: 'Diff',
  dockerfile: 'Dockerfile',
  go: 'Go',
  graphql: 'GraphQL',
  html: 'HTML',
  java: 'Java',
  javascript: 'JavaScript',
  js: 'JavaScript',
  json: 'JSON',
  jsonc: 'JSON',
  jsx: 'JSX',
  kotlin: 'Kotlin',
  markdown: 'Markdown',
  md: 'Markdown',
  mdx: 'MDX',
  php: 'PHP',
  python: 'Python',
  py: 'Python',
  ruby: 'Ruby',
  rb: 'Ruby',
  rust: 'Rust',
  rs: 'Rust',
  scss: 'SCSS',
  sh: 'Shell',
  shell: 'Shell',
  shellscript: 'Shell',
  sql: 'SQL',
  swift: 'Swift',
  text: 'Plain text',
  toml: 'TOML',
  ts: 'TypeScript',
  tsx: 'TSX',
  typescript: 'TypeScript',
  xml: 'XML',
  yaml: 'YAML',
  yml: 'YAML',
  zsh: 'Zsh',
}

/** A language's name as a person writes it (`ts` is TypeScript), or the id itself for one not listed. */
export function languageName(language: string): string {
  return LANGUAGE_NAMES[language.toLowerCase()] ?? language
}

type Highlighter = import('shiki/core').HighlighterCore

let highlighter: Promise<Highlighter> | undefined

function getHighlighter(): Promise<Highlighter> {
  highlighter ??= Promise.all([
    import('shiki/core'),
    import('shiki/engine/javascript'),
  ]).then(
    ([
      { createHighlighterCore, createCssVariablesTheme },
      { createJavaScriptRegexEngine },
    ]) =>
      createHighlighterCore({
        // The regular expression engine in JavaScript, so there is no WebAssembly to fetch.
        engine: createJavaScriptRegexEngine(),
        themes: [
          createCssVariablesTheme({
            name: 'kino',
            variablePrefix: '--code-',
            fontStyle: true,
          }),
        ],
        langs: [],
      }),
  )
  return highlighter
}

/** The lines of `code`, without the newline that ends the last one. */
export function codeLines(code: string): string[] {
  return code.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n')
}

/** `code` as lines of one token each, as it shows before its colours load. */
export function plainTokens(code: string): CodeToken[][] {
  return codeLines(code).map((line) => (line ? [{ content: line }] : []))
}

/**
 * `plain` lines with the colours `coloured` gave them, for as much of each
 * line as hasn't changed since, so code that grows keeps its colours while
 * the new ones load, and only what changed shows plain.
 */
export function holdColours(
  plain: CodeToken[][],
  coloured: CodeToken[][] | undefined,
): CodeToken[][] {
  if (!coloured) return plain
  return plain.map((line, index) => {
    const held = coloured[index]
    if (!held) return line
    const text = line.map((token) => token.content).join('')
    const kept: CodeToken[] = []
    let at = 0
    for (const token of held) {
      const same = commonLength(token.content, text.slice(at))
      if (same)
        kept.push(
          same === token.content.length
            ? token
            : { ...token, content: token.content.slice(0, same) },
        )
      at += same
      if (same < token.content.length) break
    }
    if (at === text.length) return kept
    return [...kept, { content: text.slice(at) }]
  })
}

function commonLength(a: string, b: string): number {
  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i++
  return i
}

/**
 * Shiki's colour for a token, in Kino's names: `var(--code-token-keyword)`
 * becomes `var(--code-keyword)`, and its text colour none, so it inherits.
 */
export function tokenColor(color: string | undefined): string | undefined {
  if (!color || color === 'var(--code-foreground)') return undefined
  // A diff's lines take the colours of the block's added and removed lines.
  if (color === 'var(--code-token-inserted)') return 'var(--code-added)'
  if (color === 'var(--code-token-deleted)') return 'var(--code-removed)'
  return color.replace('var(--code-token-', 'var(--code-')
}

/** Joins tokens of one colour that follow each other, so a line has as few as it can. */
export function mergeTokens(line: CodeToken[]): CodeToken[] {
  const merged: CodeToken[] = []
  for (const token of line) {
    const last = merged.at(-1)
    if (last && last.color === token.color && last.italic === token.italic) {
      last.content += token.content
    } else {
      merged.push({ ...token })
    }
  }
  return merged
}

function isBundled(
  language: string,
  bundled: Record<BundledLanguage, unknown>,
): language is BundledLanguage {
  return Object.hasOwn(bundled, language)
}

/**
 * `code` as lines of coloured tokens. A language shiki doesn't know, or one
 * that fails to load, comes back as plain lines.
 */
export async function highlightCode(
  code: string,
  language: CodeLanguage,
): Promise<CodeToken[][]> {
  if (language === 'text') return plainTokens(code)
  const [shiki, { bundledLanguages }] = await Promise.all([
    getHighlighter(),
    import('shiki/langs'),
  ])
  if (!isBundled(language, bundledLanguages)) return plainTokens(code)
  try {
    if (!shiki.getLoadedLanguages().includes(language)) {
      await shiki.loadLanguage(bundledLanguages[language])
    }
  } catch {
    return plainTokens(code)
  }
  const lines = shiki.codeToTokensBase(codeLines(code).join('\n'), {
    lang: language,
    theme: 'kino',
  })
  return lines.map((line) =>
    mergeTokens(
      line.map((token) => ({
        content: token.content,
        color: tokenColor(token.color),
        // Shiki's FontStyle.Italic is 1.
        italic: ((token.fontStyle ?? 0) & 1) === 1 || undefined,
      })),
    ),
  )
}

/**
 * The line numbers a list names, counting from 1: single lines and
 * inclusive ranges, such as `[1, [4, 6]]` for 1, 4, 5 and 6. A range
 * written backwards counts the same.
 */
export function lineSet(lines: readonly (number | readonly [number, number])[] = []) {
  const set = new Set<number>()
  for (const entry of lines) {
    const [from, to] = typeof entry === 'number' ? [entry, entry] : entry
    for (let line = Math.min(from, to); line <= Math.max(from, to); line += 1)
      set.add(line)
  }
  return set
}
