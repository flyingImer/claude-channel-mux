import type { AgentKind, AgentPeerPointer } from './types.js'

export type RecentAgentReplyKind = 'midturn' | 'final' | 'reply_tool' | 'poll'
export type RecentAgentReplySource = 'event' | 'reply_tool' | 'poll'
export type RecentAgentReplyPointer = {
  runtime: AgentKind
  roomId: string
  threadId: string
  messageId?: string
  preview: string
  kind: RecentAgentReplyKind
  source: RecentAgentReplySource
  createdAt: number
}

export function recentAgentReplyPointerFromJson(value: unknown): RecentAgentReplyPointer | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const item = value as Record<string, unknown>
  const runtime = item.runtime === 'claude' || item.runtime === 'codex' ? item.runtime : undefined
  if (!runtime || typeof item.roomId !== 'string' || typeof item.threadId !== 'string' || typeof item.preview !== 'string') return undefined
  const createdAt = typeof item.createdAt === 'number' && Number.isFinite(item.createdAt) ? item.createdAt : undefined
  if (!createdAt) return undefined
  const kind = item.kind === 'midturn' || item.kind === 'final' || item.kind === 'reply_tool' || item.kind === 'poll' ? item.kind : 'final'
  const source = item.source === 'event' || item.source === 'reply_tool' || item.source === 'poll' ? item.source : 'event'
  return { runtime, roomId: item.roomId, threadId: item.threadId, ...(typeof item.messageId === 'string' && item.messageId ? { messageId: item.messageId } : {}), preview: item.preview, kind, source, createdAt }
}

export function referenceHintForPeerPointer(item: RecentAgentReplyPointer, sameThread: boolean, likelyReference: boolean): string | undefined {
  if (!likelyReference) return undefined
  const where = sameThread ? 'same thread' : 'recent peer thread'
  return `Likely referenced ${item.runtime} ${item.kind} message in ${where}; use fetch_thread(thread_id="${item.threadId}") if exact/full text matters.`
}

export function recentPeerReplyPointers(
  items: Iterable<RecentAgentReplyPointer>,
  runtime: AgentKind,
  roomId?: string,
  threadId?: string,
  now = Date.now(),
): NonNullable<AgentPeerPointer['recent']> | undefined {
  if (!roomId) return undefined
  const candidates = [...items]
    .filter(item => item.runtime === runtime && item.roomId === roomId)
    .sort((a, b) => {
      const sameThreadDelta = (b.threadId === threadId ? 1 : 0) - (a.threadId === threadId ? 1 : 0)
      const finalDelta = (b.kind === 'final' || b.kind === 'reply_tool' ? 1 : 0) - (a.kind === 'final' || a.kind === 'reply_tool' ? 1 : 0)
      return sameThreadDelta || finalDelta || b.createdAt - a.createdAt
    })
    .slice(0, 5)
    .map((item, index) => {
      const sameThread = item.threadId === threadId
      const likelyReference = index === 0
      const referenceHint = referenceHintForPeerPointer(item, sameThread, likelyReference)
      return {
        threadId: item.threadId,
        ...(item.messageId ? { messageId: item.messageId } : {}),
        preview: item.preview,
        kind: item.kind,
        source: item.source,
        ageMs: Math.max(0, now - item.createdAt),
        ...(sameThread ? { sameThread: true } : {}),
        ...(likelyReference ? { likelyReference: true } : {}),
        ...(referenceHint ? { referenceHint } : {}),
      }
    })
  return candidates.length ? candidates : undefined
}
