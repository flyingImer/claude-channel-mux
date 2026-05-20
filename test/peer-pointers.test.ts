import { test, expect } from 'bun:test'
import { recentAgentReplyPointerFromJson, recentPeerReplyPointers, type RecentAgentReplyPointer } from '../agents/peer-pointers.ts'

const now = 1_000_000

function pointer(overrides: Partial<RecentAgentReplyPointer>): RecentAgentReplyPointer {
  return {
    runtime: 'codex',
    roomId: 'slack:C1',
    threadId: 't1',
    messageId: 'm1',
    preview: 'preview',
    kind: 'midturn',
    source: 'event',
    createdAt: now - 1000,
    ...overrides,
  }
}

test('recentPeerReplyPointers prefers same thread, then final/reply messages, then recency', () => {
  const items = [
    pointer({ threadId: 'other', messageId: 'mid-recent', preview: 'mid recent', kind: 'midturn', createdAt: now - 1 }),
    pointer({ threadId: 'other', messageId: 'final-older', preview: 'final older', kind: 'final', createdAt: now - 5000 }),
    pointer({ threadId: 'same', messageId: 'same-mid', preview: 'same mid', kind: 'midturn', createdAt: now - 9000 }),
  ]
  const recent = recentPeerReplyPointers(items, 'codex', 'slack:C1', 'same', now)
  expect(recent?.[0]).toMatchObject({ threadId: 'same', messageId: 'same-mid', sameThread: true, likelyReference: true, kind: 'midturn' })
  expect(recent?.[0]?.referenceHint).toContain('fetch_thread(thread_id="same")')
  expect(recent?.[1]).toMatchObject({ messageId: 'final-older', kind: 'final' })
})

test('recentAgentReplyPointerFromJson normalizes persisted pointers safely', () => {
  expect(recentAgentReplyPointerFromJson({ runtime: 'codex', roomId: 'r', threadId: 't', preview: 'p', createdAt: 10 })).toMatchObject({ runtime: 'codex', kind: 'final', source: 'event' })
  expect(recentAgentReplyPointerFromJson({ runtime: 'bad', roomId: 'r', threadId: 't', preview: 'p', createdAt: 10 })).toBeUndefined()
})
