import { codeLines } from '@/registry/lib/syntax'

/*
 * The changes between a before and an after, by line for code and by word
 * for prose, on one diff of tokens: Myers' O(ND) with the common ends
 * trimmed, and for lines a patience pass first, so code lines up on the
 * lines that appear once on each side rather than on its braces. A change
 * is a run of removed and added tokens between unchanged ones, named by
 * where it starts in before, so its id holds while after still grows.
 *
 * While after is not complete, before past what after has reached stays as
 * it is (`pending`): the last change keeps only as much of before as after
 * has put something in place of, so a rewrite stopped half-way never marks
 * the rest as removed.
 */

/** What a run of tokens did between before and after. */
type DiffOp = 'same' | 'added' | 'removed'

/** Text that one side kept, gained or lost. */
interface DiffSpan {
  op: DiffOp
  text: string
}

/** What a person decided about one change. */
type Resolution = 'accepted' | 'rejected'

/** Decisions by change id. */
type Resolved = Readonly<Record<string, Resolution>>

/** A run of `length` tokens from before's `a` and after's `b`; one side's start is where the run sits in it. */
interface Run {
  op: DiffOp
  a: number
  b: number
  length: number
}

/** Past this many edits, the rest is one change: a removal and an addition. */
const MAX_EDITS = 4000

/** Below this share of a line kept, a pair of lines reads as a whole new line, with no word marks. */
const PAIR_SIMILARITY = 0.5

/** Pairs of lines tried in one change, past which lines pair in order. */
const MAX_PAIRINGS = 2500

function pushRun(runs: Run[], op: DiffOp, a: number, b: number, length: number) {
  if (length <= 0) return
  const last = runs.at(-1)
  const follows =
    last?.op === op &&
    (op === 'added' || last.a + last.length === a) &&
    (op === 'removed' || last.b + last.length === b)
  if (last && follows) last.length += length
  else runs.push({ op, a, b, length })
}

/** Myers' shortest edit script between `a[aLo, aHi)` and `b[bLo, bHi)`, whose ends already differ. */
function myers(
  a: readonly string[],
  b: readonly string[],
  aLo: number,
  aHi: number,
  bLo: number,
  bHi: number,
  runs: Run[],
) {
  const n = aHi - aLo
  const m = bHi - bLo
  const max = Math.min(n + m, MAX_EDITS)
  const offset = max + 1
  const v = new Int32Array(2 * max + 3)
  // Each step's furthest x on diagonals -d..d, kept to walk back along.
  const trace: Int32Array[] = []
  let found = -1
  for (let d = 0; d <= max && found < 0; d++) {
    for (let k = -d; k <= d; k += 2) {
      let x =
        k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])
          ? v[offset + k + 1]
          : v[offset + k - 1] + 1
      let y = x - k
      while (x < n && y < m && a[aLo + x] === b[bLo + y]) {
        x++
        y++
      }
      v[offset + k] = x
      if (x >= n && y >= m) found = d
    }
    trace.push(v.slice(offset - d, offset + d + 1))
  }
  if (found < 0) {
    pushRun(runs, 'removed', aLo, bLo, n)
    pushRun(runs, 'added', aHi, bLo, m)
    return
  }

  const steps: Run[] = []
  let x = n
  let y = m
  for (let d = found; d > 0; d--) {
    const k = x - y
    const previous = trace[d - 1]
    const at = (diagonal: number) => previous[diagonal + d - 1]
    const down = k === -d || (k !== d && at(k - 1) < at(k + 1))
    const prevK = down ? k + 1 : k - 1
    const prevX = at(prevK)
    const prevY = prevX - prevK
    const snakeX = down ? prevX : prevX + 1
    const snakeY = down ? prevY + 1 : prevY
    steps.push({
      op: 'same',
      a: aLo + snakeX,
      b: bLo + snakeY,
      length: x - snakeX,
    })
    steps.push(
      down
        ? { op: 'added', a: aLo + prevX, b: bLo + prevY, length: 1 }
        : { op: 'removed', a: aLo + prevX, b: bLo + prevY, length: 1 },
    )
    x = prevX
    y = prevY
  }
  steps.push({ op: 'same', a: aLo, b: bLo, length: x })
  for (const step of steps.reverse()) pushRun(runs, step.op, step.a, step.b, step.length)
}

/** The tokens of `range` that appear exactly once there, by token. */
function uniqueIn(
  tokens: readonly string[],
  lo: number,
  hi: number,
): Map<string, number> {
  const seen = new Map<string, number>()
  const twice = new Set<string>()
  for (let index = lo; index < hi; index++) {
    const token = tokens[index]
    if (seen.has(token)) twice.add(token)
    else seen.set(token, index)
  }
  for (const token of twice) seen.delete(token)
  return seen
}

/** The longest run of anchors in order on both sides: patience sorting on their places in b. */
function longestInOrder(pairs: readonly (readonly [number, number])[]) {
  const tails: number[] = []
  const back = new Int32Array(pairs.length).fill(-1)
  for (let index = 0; index < pairs.length; index++) {
    const value = pairs[index][1]
    let lo = 0
    let hi = tails.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (pairs[tails[mid]][1] < value) lo = mid + 1
      else hi = mid
    }
    if (lo > 0) back[index] = tails[lo - 1]
    tails[lo] = index
  }
  const chain: (readonly [number, number])[] = []
  for (let index = tails.at(-1) ?? -1; index >= 0; index = back[index])
    chain.push(pairs[index])
  return chain.reverse()
}

function diffRange(
  a: readonly string[],
  b: readonly string[],
  aLo: number,
  aHi: number,
  bLo: number,
  bHi: number,
  anchors: boolean,
  runs: Run[],
) {
  let start = 0
  while (aLo + start < aHi && bLo + start < bHi && a[aLo + start] === b[bLo + start])
    start++
  pushRun(runs, 'same', aLo, bLo, start)
  aLo += start
  bLo += start
  let end = 0
  while (aHi - end > aLo && bHi - end > bLo && a[aHi - end - 1] === b[bHi - end - 1])
    end++
  aHi -= end
  bHi -= end

  if (aLo === aHi) pushRun(runs, 'added', aLo, bLo, bHi - bLo)
  else if (bLo === bHi) pushRun(runs, 'removed', aLo, bLo, aHi - aLo)
  else {
    const chain = anchors ? anchorsIn(a, b, aLo, aHi, bLo, bHi) : []
    if (chain.length === 0 && !shareAny(a, b, aLo, aHi, bLo, bHi)) {
      pushRun(runs, 'removed', aLo, bLo, aHi - aLo)
      pushRun(runs, 'added', aHi, bLo, bHi - bLo)
    } else if (chain.length === 0) myers(a, b, aLo, aHi, bLo, bHi, runs)
    else {
      let fromA = aLo
      let fromB = bLo
      for (const [atA, atB] of chain) {
        diffRange(a, b, fromA, atA, fromB, atB, true, runs)
        pushRun(runs, 'same', atA, atB, 1)
        fromA = atA + 1
        fromB = atB + 1
      }
      diffRange(a, b, fromA, aHi, fromB, bHi, true, runs)
    }
  }
  pushRun(runs, 'same', aHi, bHi, end)
}

/** Whether the two ranges have any token in common, so a search for what they keep can find something. */
function shareAny(
  a: readonly string[],
  b: readonly string[],
  aLo: number,
  aHi: number,
  bLo: number,
  bHi: number,
) {
  const inA = new Set(a.slice(aLo, aHi))
  for (let index = bLo; index < bHi; index++) if (inA.has(b[index])) return true
  return false
}

/** Tokens unique on both sides of the range, matched, in the longest order both agree on. */
function anchorsIn(
  a: readonly string[],
  b: readonly string[],
  aLo: number,
  aHi: number,
  bLo: number,
  bHi: number,
) {
  const inB = uniqueIn(b, bLo, bHi)
  const pairs: [number, number][] = []
  for (const [token, atA] of uniqueIn(a, aLo, aHi)) {
    const atB = inB.get(token)
    if (atB !== undefined) pairs.push([atA, atB])
  }
  pairs.sort((one, other) => one[0] - other[0])
  return longestInOrder(pairs)
}

/**
 * The runs that turn tokens `a` into `b`. `anchors` lines them up on tokens
 * found once on each side first (patience), which suits lines of code.
 */
function diffTokens(
  a: readonly string[],
  b: readonly string[],
  { anchors = false }: { anchors?: boolean } = {},
): Run[] {
  const runs: Run[] = []
  diffRange(a, b, 0, a.length, 0, b.length, anchors, runs)
  return runs
}

/** A change's runs as one: the removed and added tokens between two unchanged ones. */
interface Hunk {
  /** Where it starts in before and in after, by token. */
  a: number
  b: number
  removed: number
  added: number
}

/** Runs as unchanged stretches and changes, in order. */
type Piece =
  | { kind: 'same'; a: number; b: number; length: number }
  | ({ kind: 'change' } & Hunk)

function piecesOf(runs: readonly Run[]): Piece[] {
  const pieces: Piece[] = []
  for (const run of runs) {
    if (run.op === 'same') {
      pieces.push({ kind: 'same', a: run.a, b: run.b, length: run.length })
      continue
    }
    let last = pieces.at(-1)
    if (last?.kind !== 'change') {
      last = { kind: 'change', a: run.a, b: run.b, removed: 0, added: 0 }
      pieces.push(last)
    }
    if (run.op === 'removed') last.removed += run.length
    else last.added += run.length
  }
  return pieces
}

/**
 * While after is still arriving, the last change, when nothing after it is
 * unchanged, keeps only as much of before as after has replaced; the rest of
 * before is pending. A short match where after ends, such as one word or a
 * closing brace, may be the start of a longer rewrite, so it isn't taken as
 * kept until more arrives: `trusted` says which are. Returns how many of
 * before's tokens are pending, from its end.
 */
function holdTail(
  pieces: Piece[],
  complete: boolean,
  trusted: (piece: Piece & { kind: 'same' }) => boolean,
): number {
  if (complete) return 0
  let last = pieces.at(-1)
  const match = pieces.at(-2)
  const earlier = pieces.at(-3)
  if (
    last?.kind === 'change' &&
    last.added === 0 &&
    match?.kind === 'same' &&
    earlier?.kind === 'change' &&
    !trusted(match)
  ) {
    earlier.removed += match.length + last.removed
    earlier.added += match.length
    pieces.length -= 2
    last = earlier
  }
  if (last?.kind !== 'change') return 0
  const kept = Math.min(last.removed, last.added)
  const pending = last.removed - kept
  if (last.added === 0) pieces.pop()
  else last.removed = kept
  return pending
}

/**
 * The changes after may still rewrite while it arrives: from its end back,
 * each change up to the first kept stretch `trusted` takes as kept, since a
 * shorter one can still turn into part of a change, or join two. Empty
 * once after is complete.
 */
function growingOf(
  pieces: readonly Piece[],
  complete: boolean,
  trusted: (piece: Piece & { kind: 'same' }) => boolean,
): Piece[] {
  if (complete) return []
  const growing: Piece[] = []
  for (let index = pieces.length - 1; index >= 0; index--) {
    const piece = pieces[index]
    if (piece.kind === 'same' && trusted(piece)) break
    if (piece.kind === 'change') growing.push(piece)
  }
  return growing
}

/** Whether text holds a letter or a digit, as a word or a line of code does and white space or a brace doesn't. */
const meaningful = (text: string) => /[\p{L}\p{N}]/u.test(text)

/** One line of a code diff: its number on its own side, from 1, and, when paired with its partner, the words it kept and changed. */
interface DiffLine {
  number: number
  text: string
  /** Words this side kept (`same`) and lost or gained; absent when the whole line is the change. */
  words?: DiffSpan[]
}

/** A run of changed lines: before's removed ones, then after's added ones. */
interface CodeChange {
  /** From the line before starts it on, so it holds while after grows. */
  id: string
  /** The line it starts on in before, from 1; for lines only added, the line they go before. */
  beforeLine: number
  /** The line it starts on in after, from 1. */
  afterLine: number
  removed: DiffLine[]
  added: DiffLine[]
}

type CodeDiffRow =
  | { kind: 'same'; before: number; after: number; text: string }
  | { kind: 'change'; change: CodeChange }
  /** A line of before that after hasn't reached yet. */
  | { kind: 'pending'; before: number; text: string }

interface CodeDiff {
  rows: CodeDiffRow[]
  changes: CodeChange[]
  /** The changes after may still rewrite while it arrives, which can't be decided yet. */
  growing: string[]
  /** How before ends its lines, `\r\n` or `\n`, and whether each side ends with one, for `resolveCode`. */
  eol: string
  ends: { before: boolean; after: boolean }
}

let wordSegmenter: Intl.Segmenter | null = null

/**
 * `text` as tokens: each word, each run of white space and each other mark
 * on its own, from `Intl.Segmenter`, so Chinese and Japanese split by word.
 */
function wordsOf(text: string): string[] {
  wordSegmenter ??= new Intl.Segmenter(undefined, { granularity: 'word' })
  const tokens: string[] = []
  for (const { segment } of wordSegmenter.segment(text)) tokens.push(segment)
  return tokens
}

/** The words of a pair of lines, each side's own, and how much of them both kept, from 0 to 1. */
function pairWords(before: string, after: string) {
  const a = wordsOf(before)
  const b = wordsOf(after)
  const removed: DiffSpan[] = []
  const added: DiffSpan[] = []
  let kept = 0
  const push = (spans: DiffSpan[], op: DiffOp, text: string) => {
    const last = spans.at(-1)
    if (last?.op === op) last.text += text
    else spans.push({ op, text })
  }
  for (const run of diffTokens(a, b)) {
    if (run.op === 'same') {
      const text = a.slice(run.a, run.a + run.length).join('')
      // White space alone doesn't make two lines alike.
      kept += text.trim().length
      push(removed, 'same', text)
      push(added, 'same', text)
    } else if (run.op === 'removed') {
      push(removed, 'removed', a.slice(run.a, run.a + run.length).join(''))
    } else push(added, 'added', b.slice(run.b, run.b + run.length).join(''))
  }
  const size = Math.max(before.trim().length, after.trim().length)
  return { removed, added, similarity: size === 0 ? 1 : kept / size }
}

/**
 * A change's lines, with each removed line paired, in order, to the first
 * added line still free that keeps most of it, and the words of each pair
 * marked. A change too large to try every pair pairs its lines by place.
 */
function pairLines(removed: DiffLine[], added: DiffLine[]) {
  const mark = (line: DiffLine, partner: DiffLine) => {
    const pair = pairWords(line.text, partner.text)
    if (pair.similarity < PAIR_SIMILARITY) return false
    line.words = pair.removed
    partner.words = pair.added
    return true
  }
  if (removed.length * added.length > MAX_PAIRINGS) {
    for (let index = 0; index < Math.min(removed.length, added.length); index++) {
      mark(removed[index], added[index])
    }
    return
  }
  let from = 0
  for (const line of removed) {
    for (let index = from; index < added.length; index++) {
      if (!mark(line, added[index])) continue
      from = index + 1
      break
    }
    if (from >= added.length) return
  }
}

/** The changes between two texts by line, each pair of changed lines marked by word. */
function diffCode(
  before: string,
  after: string,
  { complete = true }: { complete?: boolean } = {},
): CodeDiff {
  const a = before === '' ? [] : codeLines(before)
  const b = after === '' ? [] : codeLines(after)
  const pieces = piecesOf(diffTokens(a, b, { anchors: true }))
  // A kept line with a word in it is taken as kept; a brace or a blank line may be the start of a rewrite.
  const trusted = (piece: Piece & { kind: 'same' }) =>
    a.slice(piece.a, piece.a + piece.length).some(meaningful)
  const pending = holdTail(pieces, complete, trusted)
  const growing = new Set(growingOf(pieces, complete, trusted))
  const rows: CodeDiffRow[] = []
  const changes: CodeChange[] = []
  const growingIds: string[] = []
  for (const piece of pieces) {
    if (piece.kind === 'same') {
      for (let index = 0; index < piece.length; index++) {
        rows.push({
          kind: 'same',
          before: piece.a + index + 1,
          after: piece.b + index + 1,
          text: a[piece.a + index],
        })
      }
      continue
    }
    const change: CodeChange = {
      id: `line-${piece.a + 1}`,
      beforeLine: piece.a + 1,
      afterLine: piece.b + 1,
      removed: a
        .slice(piece.a, piece.a + piece.removed)
        .map((text, index) => ({ number: piece.a + index + 1, text })),
      added: b
        .slice(piece.b, piece.b + piece.added)
        .map((text, index) => ({ number: piece.b + index + 1, text })),
    }
    pairLines(change.removed, change.added)
    if (growing.has(piece)) growingIds.push(change.id)
    changes.push(change)
    rows.push({ kind: 'change', change })
  }
  for (let index = a.length - pending; index < a.length; index++) {
    rows.push({ kind: 'pending', before: index + 1, text: a[index] })
  }
  const eol = /\r\n/.test(before || after) ? '\r\n' : '\n'
  const ends = { before: /\n$/.test(before), after: /\n$/.test(after) }
  return { rows, changes, growing: growingIds, eol, ends }
}

/** A run of changed words in prose: what before had there, and what after puts in its place. */
interface TextChange {
  /** From the character before starts it at, so it holds while after grows. */
  id: string
  removed: string
  added: string
}

type TextDiffPart =
  | { kind: 'same'; text: string }
  | { kind: 'change'; change: TextChange }
  /** Before that after hasn't reached yet. */
  | { kind: 'pending'; text: string }

interface TextDiff {
  parts: TextDiffPart[]
  changes: TextChange[]
  /** The changes after may still rewrite while it arrives, which can't be decided yet. */
  growing: string[]
}

/**
 * The changes between two texts by word. Two changes with only white space
 * between them are one, so "the quick" to "a slow" is one change, not two.
 */
function diffText(
  before: string,
  after: string,
  { complete = true }: { complete?: boolean } = {},
): TextDiff {
  const a = wordsOf(before)
  const b = wordsOf(after)
  const pieces = piecesOf(diffTokens(a, b))
  // White space kept between two changes joins them, and so does one word
  // next to a change that only adds or only removes: "getting in touch" to
  // "writing in" reads as one rewritten phrase, not a word at a time.
  const onlyOneSide = (piece: Piece & { kind: 'change' }) =>
    piece.removed === 0 || piece.added === 0
  for (let index = pieces.length - 2; index > 0; index--) {
    const piece = pieces[index]
    const previous = pieces[index - 1]
    const next = pieces[index + 1]
    if (piece.kind !== 'same' || previous?.kind !== 'change' || next?.kind !== 'change')
      continue
    const words = a.slice(piece.a, piece.a + piece.length).filter(meaningful).length
    if (words > 1 || (words === 1 && !onlyOneSide(previous) && !onlyOneSide(next)))
      continue
    previous.removed += piece.length + next.removed
    previous.added += piece.length + next.added
    pieces.splice(index, 2)
  }
  // Two words or more where after ends are taken as kept.
  const trusted = (piece: Piece & { kind: 'same' }) =>
    a.slice(piece.a, piece.a + piece.length).filter(meaningful).length >= 2
  const pending = holdTail(pieces, complete, trusted)
  const growing = new Set(growingOf(pieces, complete, trusted))
  // Where each token starts in before, for the changes' ids.
  const starts: number[] = []
  let offset = 0
  for (const token of a) {
    starts.push(offset)
    offset += token.length
  }
  starts.push(offset)

  const parts: TextDiffPart[] = []
  const changes: TextChange[] = []
  const growingIds: string[] = []
  for (const piece of pieces) {
    if (piece.kind === 'same') {
      parts.push({
        kind: 'same',
        text: a.slice(piece.a, piece.a + piece.length).join(''),
      })
      continue
    }
    const change: TextChange = {
      id: `at-${starts[piece.a]}`,
      removed: a.slice(piece.a, piece.a + piece.removed).join(''),
      added: b.slice(piece.b, piece.b + piece.added).join(''),
    }
    changes.push(change)
    if (growing.has(piece)) growingIds.push(change.id)
    parts.push({ kind: 'change', change })
  }
  if (pending > 0)
    parts.push({ kind: 'pending', text: a.slice(a.length - pending).join('') })
  return { parts, changes, growing: growingIds }
}

/** What a change leaves: after's text once accepted, before's once rejected, and `rest`'s for one not decided. */
function keeps(id: string, resolved: Resolved, rest: Resolution) {
  return (resolved[id] ?? rest) === 'accepted'
}

/**
 * The code once each change is decided: its added lines where accepted, its
 * removed ones where rejected, and undecided ones as `rest` says. Lines after
 * hasn't reached stay as before has them. Lines end as before's do, and the
 * last one with a line ending where the side its line came from has one.
 */
function resolveCode(diff: CodeDiff, resolved: Resolved, rest: Resolution): string {
  const lines: string[] = []
  for (const row of diff.rows) {
    if (row.kind !== 'change') lines.push(row.text)
    else {
      const side = keeps(row.change.id, resolved, rest)
        ? row.change.added
        : row.change.removed
      for (const line of side) lines.push(line.text)
    }
  }
  const last = diff.rows.at(-1)
  // A final line ending is no change of its own, so with no change at the end, before's stays.
  const fromAfter = last?.kind === 'change' && keeps(last.change.id, resolved, rest)
  const ends = fromAfter ? diff.ends.after : diff.ends.before
  return lines.join(diff.eol) + (ends && lines.length > 0 ? diff.eol : '')
}

/** The prose once each change is decided, as `resolveCode` does for code. */
function resolveText(diff: TextDiff, resolved: Resolved, rest: Resolution): string {
  return diff.parts
    .map((part) =>
      part.kind !== 'change'
        ? part.text
        : keeps(part.change.id, resolved, rest)
          ? part.change.added
          : part.change.removed,
    )
    .join('')
}

export { diffCode, diffText, diffTokens, resolveCode, resolveText, wordsOf }
export type {
  CodeChange,
  CodeDiff,
  CodeDiffRow,
  DiffLine,
  DiffOp,
  DiffSpan,
  Resolution,
  Resolved,
  Run,
  TextChange,
  TextDiff,
  TextDiffPart,
}
