/**
 * Deterministic Markdown extraction.
 *
 * Turns a brainstorm document into bounded, line-anchored units — the
 * Talk-to-the-City discipline of keeping every extracted item tied to the
 * exact text it came from, without the LLM. Same input, same units, same
 * order, every time.
 *
 * What it does not do, on purpose: summarise, merge across sections, or decide
 * what anything means. Kinds come from the author's own section headings, so
 * the classification is the author's, not the importer's.
 */
import type { ContributionKind } from '../domain/types.js'
import { inferKind } from '../curation/deterministic.js'

export interface MarkdownUnit {
  text: string
  /** 1-based, inclusive. */
  startLine: number
  endLine: number
  /** Heading trail from H2 down, e.g. ["Ideas", "Routing"]. The H1 is the document title. */
  headings: string[]
  shape: 'paragraph' | 'list' | 'quote'
}

export interface ExtractResult {
  title?: string
  units: MarkdownUnit[]
  skipped: { code: number; table: number; short: number; leadIn: number }
}

/** Shorter than this is a fragment ("Potentially:"), not a contribution. */
const MIN_UNIT_LENGTH = 12
/** List items this short are enumerations; they are kept together with their lead-in. */
const SHORT_ITEM_WORDS = 6

const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/
const LIST_ITEM = /^(\s*)(?:[-*+]|\d+[.)])\s+(.*)$/
const QUOTE = /^\s{0,3}>\s?(.*)$/
const FENCE = /^\s{0,3}(```|~~~)/
const RULE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/
const TABLE = /^\s*\|/

/** Light inline cleanup: emphasis, code ticks, links. The words stay the author's. */
export function plainText(markdown: string): string {
  return markdown
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(^|[^\w*])[*_]([^*_\n]+)[*_](?=[^\w*]|$)/g, '$1$2')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

const words = (text: string) => text.split(/\s+/).filter(Boolean).length

interface Block {
  shape: MarkdownUnit['shape'] | 'code' | 'table'
  lines: string[]
  start: number
  end: number
  headings: string[]
  /** For lists: each top-level item with its own line span. */
  items?: Array<{ text: string; start: number; end: number }>
}

export function extractUnits(markdown: string): ExtractResult {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n')
  const skipped = { code: 0, table: 0, short: 0, leadIn: 0 }
  const blocks: Block[] = []
  let title: string | undefined
  let headings: string[] = []
  let current: Block | undefined
  let inFence = false
  let inTable = false

  const close = () => {
    if (current) blocks.push(current)
    current = undefined
  }

  lines.forEach((line, i) => {
    const n = i + 1

    // Code and tables are skipped, but kept as blocks so a lead-in paragraph
    // ("Possible flow:") can see that what it introduces was not imported.
    if (FENCE.test(line)) {
      if (!inFence) {
        close()
        skipped.code += 1
        blocks.push({ shape: 'code', lines: [], start: n, end: n, headings })
      }
      inFence = !inFence
      return
    }
    if (inFence) return

    if (TABLE.test(line)) {
      if (!inTable) {
        close()
        skipped.table += 1
        blocks.push({ shape: 'table', lines: [], start: n, end: n, headings })
      }
      inTable = true
      return
    }
    inTable = false

    const heading = HEADING.exec(line)
    if (heading) {
      close()
      const level = heading[1].length
      const text = plainText(heading[2])
      if (level === 1) {
        title ??= text
        headings = []
      } else {
        headings = [...headings.slice(0, level - 2), text]
      }
      return
    }

    if (line.trim() === '' || RULE.test(line)) {
      // A blank line ends paragraphs and quotes; a list survives blank lines
      // between its items (loose lists), so it is closed by what comes next.
      if (current && current.shape !== 'list') close()
      return
    }

    const item = LIST_ITEM.exec(line)
    if (item) {
      const indent = item[1].replace(/\t/g, '  ').length
      if (current?.shape !== 'list') {
        close()
        current = { shape: 'list', lines: [], start: n, end: n, headings, items: [] }
      }
      const items = current.items!
      if (indent < 2 || items.length === 0) {
        items.push({ text: item[2], start: n, end: n })
      } else {
        // Nested item: belongs to the current top-level item.
        const last = items[items.length - 1]
        last.text += `; ${item[2]}`
        last.end = n
      }
      current.end = n
      return
    }

    const quote = QUOTE.exec(line)
    if (quote) {
      if (current?.shape !== 'quote') {
        close()
        current = { shape: 'quote', lines: [], start: n, end: n, headings }
      }
      current.lines.push(quote[1])
      current.end = n
      return
    }

    // Indented or lazy continuation of the last list item.
    if (current?.shape === 'list' && current.items!.length > 0 && (/^\s{2,}/.test(line) || current.end === n - 1)) {
      const last = current.items![current.items!.length - 1]
      last.text += ` ${line.trim()}`
      last.end = n
      current.end = n
      return
    }

    if (current?.shape !== 'paragraph') {
      close()
      current = { shape: 'paragraph', lines: [], start: n, end: n, headings }
    }
    current.lines.push(line)
    current.end = n
  })
  close()

  const units: MarkdownUnit[] = []
  const push = (unit: MarkdownUnit) => {
    if (unit.text.length < MIN_UNIT_LENGTH) {
      skipped.short += 1
      return
    }
    units.push(unit)
  }

  blocks.forEach((block, index) => {
    if (block.shape === 'list') {
      const items = block.items!.map((item) => ({ ...item, text: plainText(item.text).replace(/[;,]\s*$/, '') }))
      const prev = blocks[index - 1]
      // Same predicate the paragraph pass uses (`introducesEnumeration`), so a
      // lead-in is either folded here or emitted there — never both.
      const leadIn = prev && introducesEnumeration(prev, block) ? prev : undefined
      const enumeration = isEnumeration(items.map((item) => item.text))

      if (enumeration) {
        // "Potential actors: Basel-Stadt; MeteoSwiss; …" is one statement, not nine.
        const lead = leadIn ? `${plainText(leadIn.lines.join(' ')).replace(/:\s*$/, '')}: ` : ''
        push({
          text: `${lead}${items.map((item) => item.text).join('; ')}`,
          startLine: leadIn?.start ?? block.start,
          endLine: block.end,
          headings: block.headings,
          shape: 'list',
        })
        return
      }
      for (const item of items) {
        push({ text: item.text, startLine: item.start, endLine: item.end, headings: block.headings, shape: 'list' })
      }
      return
    }

    if (block.shape === 'code' || block.shape === 'table') return

    const text = plainText(block.lines.join(' '))
    const next = blocks[index + 1]
    const prev = blocks[index - 1]

    // A quote introduced by "Working principle:" reads as one statement.
    if (block.shape === 'quote' && prev && sameSection(prev, block) && isLeadIn(prev)) {
      push({
        text: `${plainText(prev.lines.join(' '))} ${text}`,
        startLine: prev.start,
        endLine: block.end,
        headings: block.headings,
        shape: 'quote',
      })
      return
    }

    // Carried by the enumeration it introduces, whatever its length (see the list pass).
    if (next && introducesEnumeration(block, next)) return

    if (isLeadIn(block) && next && sameSection(block, next)) {
      // Carried by the quote it introduces (see above)...
      if (next.shape === 'quote') return
      // ...or too slight to stand alone ("Potentially:") before separate
      // items or skipped code. Dropped, but counted, never silently lost.
      if (next.shape === 'code' || next.shape === 'table' || (next.shape === 'list' && text.length < 80)) {
        skipped.leadIn += 1
        return
      }
    }

    push({ text, startLine: block.start, endLine: block.end, headings: block.headings, shape: block.shape })
  })

  return { ...(title ? { title } : {}), units, skipped }
}

const endsWithColon = (block: Block) => /:\s*$/.test(plainText(block.lines.join(' ')))

/** A paragraph ending in ":" directly before a short enumeration in the same section. */
const introducesEnumeration = (paragraph: Block, list: Block): boolean =>
  paragraph.shape === 'paragraph' &&
  list.shape === 'list' &&
  sameSection(paragraph, list) &&
  endsWithColon(paragraph) &&
  isEnumeration(list.items!.map((item) => plainText(item.text).replace(/[;,]\s*$/, '')))

/** A paragraph that only introduces what follows ("Potential actors:"). */
const isLeadIn = (block: Block): boolean => {
  if (block.shape !== 'paragraph') return false
  const text = plainText(block.lines.join(' '))
  return /:\s*$/.test(text) && text.length < 200
}

/** Short items read as one statement. Questions are never folded together: each one is something to answer. */
const isEnumeration = (items: string[]): boolean =>
  items.length > 1 && items.every((item) => words(item) <= SHORT_ITEM_WORDS) && !items.some((item) => /\?\s*$/.test(item))

const sameSection = (a: Pick<Block, 'headings'>, b: Pick<Block, 'headings'>) => a.headings.join('\u0000') === b.headings.join('\u0000')

/**
 * Kind from the author's own section headings, deepest first; the text's own
 * shape (a trailing "?") wins over the section. Falls back to the same lexical
 * classifier the deterministic curator uses.
 */
export function kindFor(unit: Pick<MarkdownUnit, 'text' | 'headings'>): ContributionKind {
  if (/\?\s*$/.test(unit.text)) return 'question'
  for (const heading of [...unit.headings].reverse()) {
    const h = heading.toLowerCase()
    if (/tension|conflict|contradict|disagree/.test(h)) return 'contradiction'
    if (/assum|risk|hypothes/.test(h)) return 'assumption'
    if (/question|unknown|open issue/.test(h)) return 'question'
    if (/evidence|data|resource|source|finding|research|signal/.test(h)) return 'evidence'
    if (/idea|approach|concept|experiment|intervention|direction|option|solution|proposal|output|what .* for|plan/.test(h)) {
      return 'approach'
    }
    if (/problem|cause|principle|decision|framing|why|beneath|context|situation|stay|explicit|deterministic|boundar|constraint/.test(h)) {
      return 'claim'
    }
  }
  const inferred = inferKind(unit.text)
  // A lexical guess never promotes an imported line to a contradiction: that
  // is a relation between statements, and only review can establish it.
  return inferred === 'contradiction' ? 'claim' : inferred
}

/**
 * The problem description a brief offers: its tagline quote if it opens with
 * one, else its first paragraph.
 */
export function briefSummary(markdown: string): { title?: string; tagline?: string; description?: string } {
  const { title, units } = extractUnits(markdown)
  const quote = units.find((u) => u.shape === 'quote')
  const firstParagraph = units.find((u) => u.shape === 'paragraph')
  return {
    ...(title ? { title } : {}),
    ...(quote && quote === units[0] ? { tagline: quote.text } : {}),
    ...(firstParagraph ? { description: firstParagraph.text } : {}),
  }
}
