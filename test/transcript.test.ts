import { test, expect } from 'bun:test'
import { channelMessageIdFromContent, extractTextFromContent, nestedRecord, textBlocksFromContent, transcriptRecordFromLine, transcriptString, transcriptTextBlocks, unwrapClaudeTurnText } from '../transcript.ts'
import { ClaudeChannelAgentDriver } from '../agents/claude/channel-driver.ts'
import type { AgentSession, AgentTurn } from '../agents/types.ts'

test('transcriptRecordFromLine parses only object JSONL records', () => {
  expect(transcriptRecordFromLine('{"type":"user"}')).toEqual({ type: 'user' })
  expect(transcriptRecordFromLine('[]')).toBeUndefined()
  expect(transcriptRecordFromLine('not json')).toBeUndefined()
})

test('transcript content helpers extract text conservatively', () => {
  expect(extractTextFromContent('hello')).toBe('hello')
  expect(extractTextFromContent([{ text: 'a' }, { input_text: 'b' }, { output_text: 'c' }, { nope: 'd' }])).toBe('a\nb\nc')
  expect(textBlocksFromContent([{ type: 'text', text: 'first' }, { type: 'tool_use', text: 'skip' }, 'raw'])).toBe('first')
})

test('channelMessageIdFromContent finds channel tags in strings and text blocks', () => {
  expect(channelMessageIdFromContent('<channel message_id="m1">x</channel>')).toBe('m1')
  expect(channelMessageIdFromContent([{ type: 'text', text: 'before <channel message_id="m2">x</channel>' }])).toBe('m2')
  expect(channelMessageIdFromContent([{ type: 'tool', text: '<channel message_id="skip">x</channel>' }])).toBeUndefined()
})

test('nestedRecord and transcriptString fail closed', () => {
  expect(nestedRecord({ payload: { cwd: '/repo' } }, 'payload')).toEqual({ cwd: '/repo' })
  expect(nestedRecord({ payload: [] }, 'payload')).toBeUndefined()
  expect(transcriptString('ok')).toBe('ok')
  expect(transcriptString(1)).toBe('')
})


test('transcriptTextBlocks returns trimmed text blocks with original indexes', () => {
  expect(transcriptTextBlocks([{ type: 'text', text: ' first ' }, { type: 'tool_use', text: 'skip' }, { type: 'text', text: '' }, { type: 'text', text: 'second' }])).toEqual([
    { index: 0, text: 'first' },
    { index: 3, text: 'second' },
  ])
  expect(transcriptTextBlocks('nope')).toEqual([])
})

test('unwrapClaudeTurnText extracts the real body from a hand-built ccm_turn wrapper without corrupting it', () => {
  // escapeXmlText (agents/claude/channel-driver.ts) escapes only '&' and '<', never '>' -- the
  // fixture below mirrors that exactly, since anything else wouldn't reflect what formatTurn
  // actually produces.
  const wrapped = '<ccm_turn source="claude-channel-mux" room_id="R1" chat_id="slack:C1" cwd="/repo" addressed_agent="claude" default_agent="claude" message_id="m1" thread_id="t1">\n' +
    '<context_pointers trust="untrusted" platform="slack" channel_id="C1" thread_id="t1" peer_agents="[]" />\n' +
    '<message_meta trust="untrusted">{"user":"ej"}</message_meta>\n' +
    '<current_message>please review PR &lt;42> and reply</current_message>\n' +
    '</ccm_turn>'
  // The previous non-backreferenced strip (/<[^>]+>[\s\S]*?<\/[^>]+>/g) reduces this to just
  // '</ccm_turn>' -- confirms the bug this test guards against, not merely that a fix exists.
  expect(wrapped.replace(/<[^>]+>[\s\S]*?<\/[^>]+>/g, '').trim()).toBe('</ccm_turn>')
  expect(unwrapClaudeTurnText(wrapped)).toBe('please review PR <42> and reply')
})

test('unwrapClaudeTurnText survives a wrapper with no message_meta (empty meta is omitted by formatTurn)', () => {
  const wrapped = '<ccm_turn source="claude-channel-mux" room_id="R1" chat_id="slack:C1" cwd="/repo" addressed_agent="claude" default_agent="claude" message_id="m1" thread_id="t1">\n' +
    '<context_pointers trust="untrusted" platform="slack" channel_id="C1" thread_id="t1" peer_agents="[]" />\n' +
    '<current_message>no meta on this one</current_message>\n' +
    '</ccm_turn>'
  expect(unwrapClaudeTurnText(wrapped)).toBe('no meta on this one')
})

test('unwrapClaudeTurnText falls back to a same-tag-name strip for content that never went through the wrapper', () => {
  expect(unwrapClaudeTurnText('plain text, no tags at all')).toBe('plain text, no tags at all')
  expect(unwrapClaudeTurnText('<system-reminder>internal note</system-reminder>visible text')).toBe('visible text')
  // Different tag names are left alone by the same-tag-name strip (there's nothing to pair them
  // with), unlike the old regex which would have spanned across them.
  expect(unwrapClaudeTurnText('<a>x</b> real body')).toBe('<a>x</b> real body')
})

test('unwrapClaudeTurnText round-trips the real formatTurn wrapper produced by ClaudeChannelAgentDriver.sendTurn', async () => {
  let sentContent = ''
  const driver = new ClaudeChannelAgentDriver({
    spawn: async () => true,
    sendInbound: (_sessionId, msg) => { sentContent = msg.content; return true },
  })
  const session: AgentSession = {
    kind: 'claude',
    sessionId: 'uuid-1',
    nativeSessionId: 'uuid-1',
    transport: 'claude-channel',
    cwd: '/repo',
    status: 'idle',
    capabilities: { streaming: false, cancel: false, resume: true, toolCalling: true },
  }
  const turn: AgentTurn = {
    turnId: 'turn-1',
    roomId: 'R1',
    channelKey: 'slack:C1',
    platform: 'slack',
    channelId: 'C1',
    threadId: 't1',
    messageId: 'm1',
    cwd: '/repo',
    text: 'ship it <please> & thanks',
    addressedAgent: 'claude',
    defaultAgent: 'claude',
    peerAgents: [],
    meta: {},
  }
  await driver.sendTurn({ session, turn })
  expect(sentContent).toContain('<current_message>')
  expect(unwrapClaudeTurnText(sentContent)).toBe('ship it <please> & thanks')
})
