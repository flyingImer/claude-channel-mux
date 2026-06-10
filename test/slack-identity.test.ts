import { test, expect } from 'bun:test'
import { isSlackSearchAction, normalizeSlackSlashCommandText, slackFileMetadata, slackInboundEventFields, slackInboundIdentity, slackInteractionCallback, slackModalSubmission, slackModalViewId, slackSearchRuntimeFromAction, slackSlashInboundMessage } from '../adapters/slack.ts'

test('slackInboundIdentity prefers human user ids', () => {
  expect(slackInboundIdentity({ user: 'U123', bot_id: 'B999', username: 'bot' }, 'UBOT', 'BSELF')).toEqual({
    userId: 'U123',
    fallbackName: undefined,
  })
  expect(slackInboundIdentity({ user: { bad: true } as unknown as string, bot_id: 'B999', username: 'bot' }, 'UBOT', 'BSELF')).toEqual({
    userId: 'B999',
    fallbackName: 'bot',
  })
  expect(slackInboundIdentity({ user: { bad: true } as unknown as string, bot_id: { bad: true } as unknown as string }, 'UBOT', 'BSELF')).toEqual({
    userId: 'UBOT',
    fallbackName: 'UBOT',
  })
})

test('slackInboundIdentity falls back for bot messages without event.user', () => {
  expect(slackInboundIdentity({ bot_id: 'B999', bot_profile: { name: 'ccm-bot' } }, 'UBOT', 'BSELF')).toEqual({
    userId: 'B999',
    fallbackName: 'ccm-bot',
  })
  expect(slackInboundIdentity({ bot_id: 'B999', username: { bad: true } as unknown as string, bot_profile: { name: { bad: true } as unknown as string } }, 'UBOT', 'BSELF')).toEqual({
    userId: 'B999',
    fallbackName: 'B999',
  })
})

test('slackInboundIdentity handles sparse self-test events deterministically', () => {
  expect(slackInboundIdentity({}, 'UBOT', 'BSELF')).toEqual({ userId: 'UBOT', fallbackName: 'UBOT' })
  expect(slackInboundIdentity({}, '', 'BSELF')).toEqual({ userId: 'BSELF', fallbackName: 'BSELF' })
})

test('slackInboundEventFields rejects messages without required routing fields', () => {
  expect(slackInboundEventFields({ channel: 'C1', ts: '171000.5', text: 'hello', thread_ts: '171000.1' })).toEqual({
    channelId: 'C1',
    messageId: '171000.5',
    text: 'hello',
    timestampIso: new Date(171000.5 * 1000).toISOString(),
    replyToId: '171000.1',
  })
  expect(slackInboundEventFields({ channel: 'C1', ts: '171000.5', text: 42 as unknown as string })?.text).toBe('')
  expect(slackInboundEventFields({ ts: '171000.5' })).toBeUndefined()
  expect(slackInboundEventFields({ channel: 'C1' })).toBeUndefined()
  expect(slackInboundEventFields({ channel: 'C1', ts: 'not-a-number' })).toBeUndefined()
  expect(slackInboundEventFields({ channel: 'C1', ts: '0' })).toBeUndefined()
})

test('slackInboundEventFields strips app attribution footer from forwarded text', () => {
  expect(slackInboundEventFields({
    channel: 'C1',
    ts: '171000.5',
    text: 'please review this\n\n*Sent using <https://example.com/app|Some App>*',
  })?.text).toBe('please review this')
  expect(slackInboundEventFields({
    channel: 'C1',
    ts: '171000.5',
    text: 'please review this\n\n_Sent using Some App_',
  })?.text).toBe('please review this')
})


test('normalizeSlackSlashCommandText maps Slack slash commands to message text', () => {
  expect(normalizeSlackSlashCommandText('/ccm', 'resume')).toBe('ccm resume')
  expect(normalizeSlackSlashCommandText('/cc', 'compact')).toBe('/cc compact')
  expect(normalizeSlackSlashCommandText('/cx', 'status')).toBe('/cx status')
  expect(normalizeSlackSlashCommandText('/cc', '')).toBe('/cc')
})

test('normalizeSlackSlashCommandText trims unknown command fallback text', () => {
  expect(normalizeSlackSlashCommandText('/unknown', '  hello  ')).toBe('hello')
})


test('slackFileMetadata keeps first-file compatibility fields', () => {
  expect(slackFileMetadata([{ id: 'F1', name: 'a.txt', mimetype: 'text/plain', size: 12 }])).toEqual({
    attachment_file_id: 'F1',
    attachment_name: 'a.txt',
    attachment_mime: 'text/plain',
    attachment_size: '12',
  })
})

test('slackFileMetadata adds all-files JSON for multi-file messages', () => {
  const meta = slackFileMetadata([
    { id: 'F1', name: 'a.txt', mimetype: 'text/plain', size: 12 },
    { id: 'F2', name: 'b.png', mimetype: 'image/png', size: 34 },
  ])
  expect(meta.attachment_file_id).toBe('F1')
  expect(JSON.parse(meta.attachment_files!)).toEqual([
    { file_id: 'F1', name: 'a.txt', mime: 'text/plain', size: 12 },
    { file_id: 'F2', name: 'b.png', mime: 'image/png', size: 34 },
  ])
})

test('slackFileMetadata normalizes unsafe file payloads', () => {
  expect(slackFileMetadata('bad')).toEqual({})
  const meta = slackFileMetadata([
    null,
    { id: { bad: true }, name: 'a.txt', mimetype: { bad: true }, size: { bad: true } },
    { id: 'F2', name: 12, mimetype: 'image/png', size: 34 },
  ])
  expect(meta).toMatchObject({ attachment_name: 'a.txt' })
  expect(meta.attachment_file_id).toBeUndefined()
  expect(meta.attachment_mime).toBeUndefined()
  expect(meta.attachment_size).toBeUndefined()
  expect(JSON.parse(meta.attachment_files!)).toEqual([
    { name: 'a.txt' },
    { file_id: 'F2', mime: 'image/png', size: 34 },
  ])
})


test('slackInteractionCallback extracts button clicks from unknown SDK payloads', () => {
  expect(slackInteractionCallback({
    channel: { id: 'C1' },
    message: { ts: '171000.1' },
    actions: [{ action_id: 'fallback', value: 'cx:approve:req1' }],
  })).toEqual({ channelId: 'C1', data: 'cx:approve:req1', messageId: '171000.1' })
  expect(slackInteractionCallback({ actions: [] })).toBeUndefined()
  expect(slackInteractionCallback([])).toBeUndefined()
  expect(slackInteractionCallback({ channel: { id: 'C1' }, actions: [{ action_id: '', value: '' }] })).toBeUndefined()
  expect(slackInteractionCallback({ actions: [{ action_id: 'cmd:resume' }] })).toBeUndefined()
})

test('slackSlashInboundMessage maps slash payloads without SDK any casts', () => {
  const msg = slackSlashInboundMessage({ command: '/cx', text: 'status', channel_id: 'C1', user_id: 'U1', user_name: 'Ada' })
  expect(msg).toMatchObject({ channelId: 'C1', userId: 'U1', userName: 'Ada', text: '/cx status', messageId: '' })
  expect(msg?.meta.ts).toBeString()
  expect(slackSlashInboundMessage({ command: '/cx', text: 'status' })).toBeUndefined()
  expect(slackSlashInboundMessage({ command: '/cx', text: 'status', channel_id: 'C1' })).toBeUndefined()
  expect(slackSlashInboundMessage({ command: '/cx', text: 'status', channel_id: 'C1', user_id: 'U1' })?.userName).toBe('U1')
  expect(slackSlashInboundMessage([])).toBeUndefined()
})


test('slackSearchRuntimeFromAction accepts only exact search actions', () => {
  expect(slackSearchRuntimeFromAction('cmd:search')).toBeUndefined()
  expect(slackSearchRuntimeFromAction('cmd:search:codex')).toEqual({ runtime: 'codex' })
  expect(slackSearchRuntimeFromAction('cmd:search:claude')).toEqual({ runtime: 'claude' })
  expect(slackSearchRuntimeFromAction('cmd:searching')).toBeNull()
  expect(slackSearchRuntimeFromAction('cmd:search:other')).toBeNull()
})

test('isSlackSearchAction identifies exact search actions for fail-closed intercepts', () => {
  expect(isSlackSearchAction('cmd:search')).toBe(true)
  expect(isSlackSearchAction('cmd:search:codex')).toBe(true)
  expect(isSlackSearchAction('cmd:search:claude')).toBe(true)
  expect(isSlackSearchAction('cmd:searching')).toBe(false)
  expect(isSlackSearchAction('cmd:search:other')).toBe(false)
})

test('slackModalSubmission extracts trimmed search query from modal payloads', () => {
  const payload = {
    type: 'view_submission',
    view: {
      id: 'V1',
      state: { values: { search_block: { search_input: { value: '  repo-name  ' } } } },
    },
  }
  expect(slackModalViewId(payload)).toBe('V1')
  expect(slackModalSubmission(payload)).toEqual({ viewId: 'V1', query: 'repo-name' })
  expect(slackModalViewId({ type: 'view_submission', view: { id: 'V1', state: { values: {} } } })).toBe('V1')
  expect(slackModalSubmission({ type: 'view_submission', view: { id: 'V1', state: { values: {} } } })).toBeUndefined()
  expect(slackModalViewId({ type: 'view_submission', view: { id: '' } })).toBeUndefined()
  expect(slackModalSubmission({ type: 'block_actions' })).toBeUndefined()
  expect(slackModalSubmission([])).toBeUndefined()
})
