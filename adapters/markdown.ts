/**
 * Markdown rendering helpers shared by the Slack and Telegram adapters.
 *
 * CC emits standard GitHub-flavored markdown. Neither Slack's mrkdwn nor
 * Telegram's MarkdownV2 is a superset of that, so sending raw CC output
 * to either loses formatting and sometimes shows literal syntax. Each
 * adapter runs its incoming text through the platform-specific converter
 * here before handing it to the platform API.
 *
 * ASCII-art protection: CC sometimes produces box-drawing tables or other
 * ASCII art without wrapping them in code fences. The remark-based
 * converters preserve fenced content verbatim but mangle unfenced
 * ASCII art (treating `|` as table separators, `---` as a setext-heading
 * underline, etc.). `autoFenceAsciiArt` scans for unfenced runs that look
 * like ASCII art and wraps them in a code fence before conversion.
 */

import { slackifyMarkdown } from 'slackify-markdown'
// @ts-ignore — telegramify-markdown is CommonJS with type definitions
import telegramify from 'telegramify-markdown'

// Unicode box-drawing block (U+2500–257F). These are used almost
// exclusively for tables / diagrams — a single occurrence is a strong
// signal that the line is part of ASCII art. Prose rarely contains them.
const BOX_DRAWING_RE = /[\u2500-\u257F]/
// ASCII fallback for lines made purely of `+` / `-` / `|` / `=` etc.
// (common for CC-drawn boxes without box-drawing Unicode).
const ASCII_STRUCT_LINE_RE = /^\s*[+\-|=_*#<>/\\]+\s*$/
// Markdown GFM table row: `| ... |` (ASCII pipe).
const TABLE_ROW_RE = /^\s*\|.*\|\s*$/

function looksArty(line: string): boolean {
  const trimmed = line.trim()
  if (!trimmed) return false
  // Any Unicode box-drawing char → art-like (boxes, trees, separators).
  if (BOX_DRAWING_RE.test(trimmed)) return true
  // Pure ASCII structural line (like `+------+`, `======`, `----`).
  if (ASCII_STRUCT_LINE_RE.test(trimmed) && trimmed.length >= 3) return true
  return false
}

/**
 * Wrap unfenced runs of ASCII-art-looking lines in triple-backtick fences.
 * Content already inside a fence is left alone. Conservative: only fences
 * when we see ≥2 consecutive art-like lines, to avoid fencing ordinary
 * prose that happens to contain `-` or `|`.
 */
export function autoFenceAsciiArt(text: string): string {
  const lines = text.split('\n')
  const out: string[] = []
  let insideFence = false
  let fenceMarker = ''
  let pending: string[] = []

  const flushPending = () => {
    if (pending.length >= 2) {
      out.push('```')
      out.push(...pending)
      out.push('```')
    } else {
      out.push(...pending)
    }
    pending = []
  }

  for (const line of lines) {
    // Detect fence open/close
    const fenceMatch = line.match(/^(\s*)(`{3,}|~{3,})/)
    if (fenceMatch) {
      if (!insideFence) {
        flushPending()
        insideFence = true
        fenceMarker = fenceMatch[2]
        out.push(line)
        continue
      }
      // Matching close fence (same char, at least as long)
      if (line.trim().startsWith(fenceMarker[0].repeat(fenceMarker.length))) {
        insideFence = false
        fenceMarker = ''
        out.push(line)
        continue
      }
    }
    if (insideFence) {
      out.push(line)
      continue
    }
    // Outside any fence — classify line
    if (looksArty(line) || TABLE_ROW_RE.test(line)) {
      pending.push(line)
    } else {
      flushPending()
      out.push(line)
    }
  }
  flushPending()
  // Close any unterminated fence to keep remark happy
  if (insideFence) out.push('```')
  return out.join('\n')
}

/** Convert CC's markdown to Slack's mrkdwn (bold/italic/links/etc). */
export function renderForSlack(text: string): string {
  if (!text) return text
  try {
    return slackifyMarkdown(autoFenceAsciiArt(text))
  } catch (err) {
    process.stderr.write(`slack: markdown render failed: ${err}\n`)
    return text
  }
}

/** Convert CC's markdown to Telegram MarkdownV2 with proper escaping. */
export function renderForTelegram(text: string): string {
  if (!text) return text
  try {
    return telegramify(autoFenceAsciiArt(text), 'escape')
  } catch (err) {
    process.stderr.write(`telegram: markdown render failed: ${err}\n`)
    return text
  }
}

/**
 * Split `text` into chunks no larger than `limit`, prefering paragraph
 * boundaries (`\n\n`), then single newline, then whitespace as fallback.
 * Each chunk has complete markdown structure where possible. Never
 * truncates; pure chunking.
 */
export function splitForLimit(text: string, limit: number): string[] {
  if (text.length <= limit) return [text]
  const chunks: string[] = []
  let remaining = text
  while (remaining.length > limit) {
    let cut = remaining.lastIndexOf('\n\n', limit)
    if (cut < limit * 0.5) cut = remaining.lastIndexOf('\n', limit)
    if (cut < limit * 0.5) cut = remaining.lastIndexOf(' ', limit)
    if (cut <= 0) cut = limit  // hard break — give up on finding a boundary
    chunks.push(remaining.slice(0, cut).trimEnd())
    remaining = remaining.slice(cut).trimStart()
  }
  if (remaining) chunks.push(remaining)
  return chunks
}
