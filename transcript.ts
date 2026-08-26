function transcriptRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

export function transcriptRecordFromLine(line: string): Record<string, unknown> | undefined {
  let parsed: unknown
  try { parsed = JSON.parse(line) } catch { return undefined }
  return transcriptRecord(parsed)
}

export function nestedRecord(value: Record<string, unknown> | undefined, key: string): Record<string, unknown> | undefined {
  return transcriptRecord(value?.[key])
}

export function transcriptString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

export function extractTextFromContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.map(item => {
    if (typeof item === 'string') return item
    const record = transcriptRecord(item)
    if (typeof record?.text === 'string') return record.text
    if (typeof record?.input_text === 'string') return record.input_text
    if (typeof record?.output_text === 'string') return record.output_text
    return ''
  }).filter(Boolean).join('\n')
}

const CHANNEL_TAG_MESSAGE_ID_RE = /<channel[^>]*\bmessage_id="([^"]+)"[^>]*>/

export function channelMessageIdFromContent(content: unknown): string | undefined {
  const matchText = (text: string): string | undefined => text.match(CHANNEL_TAG_MESSAGE_ID_RE)?.[1]
  if (typeof content === 'string') return matchText(content)
  if (!Array.isArray(content)) return undefined
  for (const item of content) {
    if (typeof item === 'string') {
      const id = matchText(item)
      if (id) return id
      continue
    }
    const block = transcriptRecord(item)
    if (block?.type !== 'text' || typeof block.text !== 'string') continue
    const id = matchText(block.text)
    if (id) return id
  }
  return undefined
}

export function textBlocksFromContent(content: unknown): string {
  if (!Array.isArray(content)) return ''
  return content.map(block => {
    const record = transcriptRecord(block)
    return record?.type === 'text' && typeof record.text === 'string' ? record.text : ''
  }).filter(Boolean).join('\n').trim()
}

const CURRENT_MESSAGE_RE = /<current_message>([\s\S]*?)<\/current_message>/
// A same-tag-name strip, unlike a bare <[^>]+>...<\/[^>]+> strip (which can't tell one tag's
// closing tag from another's and spans across unrelated tags). Fallback only, for content that
// never went through the <current_message> wrapper at all.
const SAME_NAME_TAG_PAIR_RE = /<([\w:-]+)(?:\s[^>]*)?>[\s\S]*?<\/\1>/g

function unescapeXmlEntities(value: string): string {
  return value.replace(/&lt;/g, '<').replace(/&amp;/g, '&')
}

// Undo the CCM inbound turn wrapper (agents/claude/channel-driver.ts formatTurn) around a Claude
// Code transcript's recorded user-role text, without corrupting the real message body. formatTurn
// wraps every inbound turn as
// <ccm_turn ...><context_pointers .../><message_meta>...</message_meta><current_message>
// TEXT</current_message></ccm_turn>. A tag-agnostic strip can't tell one tag's closing tag from
// another's, so it matches from the first '<' through an unrelated later '</...>' and swallows the
// real body (verified: it consumes through </message_meta>, then a second /g pass consumes the
// entirety of <current_message>...</current_message> too, leaving only a stray '</ccm_turn>').
// Extract <current_message> directly when present — its content is guaranteed tag-free, since
// escapeXmlText escapes every '<' in turn.text before embedding it — otherwise fall back to a
// same-tag-name strip for content that never went through the wrapper (native continuations,
// ask_peer/chime_in injections).
export function unwrapClaudeTurnText(raw: string): string {
  const wrapped = raw.match(CURRENT_MESSAGE_RE)
  if (wrapped) return unescapeXmlEntities(wrapped[1])
  return raw.replace(SAME_NAME_TAG_PAIR_RE, '')
}


export type TranscriptTextBlock = { index: number; text: string }

export function transcriptTextBlocks(content: unknown): TranscriptTextBlock[] {
  if (!Array.isArray(content)) return []
  const blocks: TranscriptTextBlock[] = []
  content.forEach((block, index) => {
    const record = transcriptRecord(block)
    const text = record?.type === 'text' && typeof record.text === 'string' ? record.text.trim() : ''
    if (text) blocks.push({ index, text })
  })
  return blocks
}
