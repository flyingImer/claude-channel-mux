import { test, expect } from 'bun:test'
import { normalizeCommandAliases, normalizeTelegramInboundText, normalizeTelegramReaction, telegramApiResult, telegramApiResultFromResponse, telegramCallbackInteraction, telegramInboundMessage } from '../adapters/telegram.ts'

test('normalizeCommandAliases maps Telegram underscore commands to CCM command text', () => {
  expect(normalizeCommandAliases('/ccm_resume')).toBe('/ccm resume')
  expect(normalizeCommandAliases('/cc_ss now')).toBe('/cc ss now')
  expect(normalizeCommandAliases('/cx_nav@MyBot pending')).toBe('/cx nav pending')
  expect(normalizeCommandAliases('/cx_cancel')).toBe('/cx cancel')
  expect(normalizeCommandAliases('/cc_stop')).toBe('/cc stop')
})

test('normalizeCommandAliases leaves regular text and unsupported slash commands alone', () => {
  expect(normalizeCommandAliases('/start')).toBe('/start')
  expect(normalizeCommandAliases('please /cc_ss')).toBe('please /cc_ss')
  expect(normalizeCommandAliases('/ccm-resume')).toBe('/ccm-resume')
})

test('normalizeTelegramReaction preserves allowed reactions and maps CCM status emojis', () => {
  expect(normalizeTelegramReaction('👍')).toBe('👍')
  expect(normalizeTelegramReaction('✅')).toBe('👍')
  expect(normalizeTelegramReaction('❌')).toBe('👎')
  expect(normalizeTelegramReaction('⏳')).toBe('👀')
  expect(normalizeTelegramReaction('🔄')).toBe('👀')
})

test('normalizeTelegramReaction drops unsupported reactions instead of throwing', () => {
  expect(normalizeTelegramReaction('🧪')).toBeUndefined()
})


test('normalizeTelegramInboundText handles ordinary user messages and aliases', () => {
  expect(normalizeTelegramInboundText('/cx_nav now', 'U1', 'BOT', '')).toBe('/cx nav now')
  expect(normalizeTelegramInboundText('hello', 'U1', 'BOT', '')).toBe('hello')
})

test('normalizeTelegramInboundText filters self messages unless prefixed for self-test', () => {
  expect(normalizeTelegramInboundText('hello', 'BOT', 'BOT', '')).toBeUndefined()
  expect(normalizeTelegramInboundText('TEST /cc_ss', 'BOT', 'BOT', 'TEST')).toBe('/cc ss')
  expect(normalizeTelegramInboundText('TEST   /cx_nav', 'BOT', 'BOT', 'TEST')).toBe('/cx nav')
})


test('telegramApiResult unwraps successful Telegram envelopes', () => {
  expect(telegramApiResult<{ id: number }>('getMe', { ok: true, result: { id: 42 } })).toEqual({ id: 42 })
})

test('telegramApiResult reports failed or malformed Telegram envelopes', () => {
  expect(() => telegramApiResult('sendMessage', { ok: false, description: 'bad chat', error_code: 400 })).toThrow('Telegram sendMessage: bad chat error_code=400')
  expect(() => telegramApiResult('sendMessage', { ok: false, description: 'retry OPENAI_API_KEY=sk-1234567890abcdef', error_code: 429, parameters: { retry_after: 12 } })).toThrow('Telegram sendMessage: retry OPENAI_API_KEY=…redacted error_code=429 retry_after=12')
  expect(() => telegramApiResult('sendMessage', { ok: false, description: 'migrated', parameters: { migrate_to_chat_id: -100123 } })).toThrow('Telegram sendMessage: migrated migrate_to_chat_id=-100123')
  expect(() => telegramApiResult('getUpdates', null)).toThrow('Telegram getUpdates: invalid response')
  expect(() => telegramApiResult('getUpdates', [])).toThrow('Telegram getUpdates: invalid response')
  expect(() => telegramApiResult('getUpdates', 'ok')).toThrow('Telegram getUpdates: invalid response')
})

test('telegramApiResultFromResponse reports invalid JSON with bounded redacted context', async () => {
  const response = new Response(`not json OPENAI_API_KEY=sk-1234567890abcdef ${'x'.repeat(300)}`, {
    status: 502,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  })
  await expect(telegramApiResultFromResponse('sendPhoto', response)).rejects.toThrow('Telegram sendPhoto: invalid JSON response (HTTP 502, text/html; charset=utf-8, body: not json OPENAI_API_KEY=…redacted')
  await expect(telegramApiResultFromResponse('sendPhoto', new Response('OPENAI_API_KEY=sk-1234567890abcdef', { status: 502 }))).rejects.not.toThrow('sk-1234567890abcdef')
})


test('telegramCallbackInteraction extracts button clicks from typed callback payloads', () => {
  expect(telegramCallbackInteraction({ id: 'ack1', data: 'cx:deny:req1', message: { message_id: 42, chat: { id: -1001 } } })).toEqual({
    channelId: '-1001',
    data: 'cx:deny:req1',
    ackId: 'ack1',
    messageId: '42',
  })
  expect(telegramCallbackInteraction({ data: 'missing-ack' })).toBeUndefined()
  expect(telegramCallbackInteraction({ id: 'ack1', message: { chat: { id: -1001 } } })).toBeUndefined()
  expect(telegramCallbackInteraction({ id: 'ack1', data: 'cx:deny:req1', message: {} })).toBeUndefined()
  expect(telegramCallbackInteraction({ id: 'ack1', data: 'cx:deny:req1', message: { message_id: {} as unknown as string, chat: { id: -1001 } } })).toEqual({
    channelId: '-1001',
    data: 'cx:deny:req1',
    ackId: 'ack1',
    messageId: undefined,
  })
})

test('telegramInboundMessage maps messages, replies, and attachments', () => {
  const msg = telegramInboundMessage({
    message_id: 7,
    date: 171000,
    text: '/cx_nav',
    chat: { id: -1001 },
    from: { id: 9, username: 'ada' },
    reply_to_message: { message_id: 6 },
    document: { file_id: 'F1', file_name: 'a.txt', mime_type: 'text/plain', file_size: 12 },
  }, 'BOT', '')
  expect(msg).toMatchObject({
    channelId: '-1001',
    userId: '9',
    userName: 'ada',
    text: '/cx nav',
    messageId: '7',
    replyToId: '6',
    meta: { attachment_file_id: 'F1', attachment_name: 'a.txt', attachment_mime: 'text/plain', attachment_size: '12' },
  })
  expect(telegramInboundMessage({ message_id: 1, text: 'hello', chat: { id: -1001 }, from: { id: 'BOT' } }, 'BOT', '')).toBeUndefined()
})

test('telegramInboundMessage rejects messages without required identity fields', () => {
  const base = { message_id: 7, text: 'hello', chat: { id: -1001 }, from: { id: 9 } }
  expect(telegramInboundMessage(base)).toMatchObject({ channelId: '-1001', userId: '9', messageId: '7', userName: '9' })
  expect(telegramInboundMessage({ ...base, chat: {} })).toBeUndefined()
  expect(telegramInboundMessage({ ...base, chat: { id: {} as unknown as string } })).toBeUndefined()
  expect(telegramInboundMessage({ ...base, from: {} })).toBeUndefined()
  expect(telegramInboundMessage({ ...base, from: { id: {} as unknown as string } })).toBeUndefined()
  expect(telegramInboundMessage({ ...base, message_id: undefined })).toBeUndefined()
  expect(telegramInboundMessage({ ...base, message_id: {} as unknown as string })).toBeUndefined()
  expect(telegramInboundMessage({ ...base, from: { id: 9, username: {} as unknown as string, first_name: 'Ada' } })?.userName).toBe('Ada')
})

test('telegramInboundMessage normalizes unsafe message dates', () => {
  const base = { message_id: 7, text: 'hello', chat: { id: -1001 }, from: { id: 9 } }
  expect(telegramInboundMessage({ ...base, date: '171000' })?.meta.ts).toBe(new Date(171000 * 1000).toISOString())
  expect(telegramInboundMessage({ ...base, date: 'not-a-number' })?.meta.ts).toBe(new Date(0).toISOString())
  expect(telegramInboundMessage({ ...base, date: -1 })?.meta.ts).toBe(new Date(0).toISOString())
})

test('telegramInboundMessage normalizes unsafe content fields', () => {
  const base = { message_id: 7, chat: { id: -1001 }, from: { id: 9 } }
  expect(telegramInboundMessage({ ...base, text: 42 as unknown as string })).toBeUndefined()
  expect(telegramInboundMessage({ ...base, caption: 'caption text' })?.text).toBe('caption text')
  expect(telegramInboundMessage({ ...base, text: 42 as unknown as string, caption: 'caption text' })?.text).toBe('caption text')
  expect(telegramInboundMessage({ ...base, photo: 'bad-photo' as unknown as [] })).toBeUndefined()
  expect(telegramInboundMessage({ ...base, photo: [null, { file_id: 'P1' }] as unknown as [] })?.meta).toMatchObject({
    attachment_file_id: 'P1',
    attachment_mime: 'image/jpeg',
    attachment_name: 'photo.jpg',
  })
})

test('telegramInboundMessage normalizes unsafe document metadata', () => {
  const base = { message_id: 7, chat: { id: -1001 }, from: { id: 9 } }
  expect(telegramInboundMessage({ ...base, document: 'bad-doc' as unknown as {} })).toBeUndefined()
  const msg = telegramInboundMessage({
    ...base,
    document: {
      file_id: { bad: true } as unknown as string,
      file_name: { bad: true } as unknown as string,
      mime_type: 'text/plain',
      file_size: { bad: true } as unknown as number,
    },
  })
  expect(msg?.meta).toEqual({ ts: new Date(0).toISOString(), attachment_name: '', attachment_mime: 'text/plain' })
})
