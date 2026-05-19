export function escapedCurrentMessageBytes(text: string): number {
  return Buffer.byteLength(text.replace(/&/g, '&amp;').replace(/</g, '&lt;'), 'utf8')
}

export function truncateAgentContextTurnText(text: string, pointerHint: string, maxEscapedBytes: number): { text: string; truncated: boolean } {
  if (!Number.isFinite(maxEscapedBytes) || maxEscapedBytes <= 0) return { text: '', truncated: true }
  if (escapedCurrentMessageBytes(text) <= maxEscapedBytes) return { text, truncated: false }
  const fullSuffix = `\n\n… truncated by CCM after ${maxEscapedBytes} escaped current-message bytes. ${pointerHint}`
  const fallbackSuffix = `\n\n… truncated by CCM after ${maxEscapedBytes} escaped bytes.`
  const suffix = escapedCurrentMessageBytes(fullSuffix) <= maxEscapedBytes ? fullSuffix : fallbackSuffix
  if (escapedCurrentMessageBytes(suffix) > maxEscapedBytes) return { text: '', truncated: true }
  let lo = 0
  let hi = text.length
  while (lo < hi) {
    const mid = Math.floor((lo + hi + 1) / 2)
    const candidate = `${text.slice(0, mid).trimEnd()}${suffix}`
    if (escapedCurrentMessageBytes(candidate) <= maxEscapedBytes) lo = mid
    else hi = mid - 1
  }
  return { text: `${text.slice(0, lo).trimEnd()}${suffix}`, truncated: true }
}
