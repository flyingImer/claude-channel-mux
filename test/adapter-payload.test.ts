import { test, expect } from 'bun:test'
import type { WebClient } from '@slack/web-api'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { SlackAdapter, slackInteractionCallback } from '../adapters/slack.ts'
import { TelegramAdapter } from '../adapters/telegram.ts'


function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function blocksFrom(payload: Record<string, unknown>): Array<Record<string, unknown>> {
  expect(Array.isArray(payload.blocks)).toBe(true)
  return (payload.blocks as unknown[]).flatMap(block => recordValue(block) ?? [])
}

function blockText(block: Record<string, unknown> | undefined): string {
  const text = recordValue(block?.text)
  return typeof text?.text === 'string' ? text.text : ''
}

test('Slack send/edit payloads preserve forwarded markdown styling and thread broadcast', async () => {
  const slack = new SlackAdapter({ botToken: 'xoxb-test', appToken: 'xapp-test', inboxDir: '/tmp' })
  let posted: Record<string, unknown> = {}
  let updated: Record<string, unknown> = {}
  slack.injectWebClientForTest({
    chat: {
      postMessage: async (payload: Record<string, unknown>) => { posted = payload; return { ts: '123.456' } },
      update: async (payload: Record<string, unknown>) => { updated = payload; return {} },
    },
  } as unknown as WebClient)

  const keyboard = [{ type: 'actions', elements: [{ type: 'button', text: { type: 'plain_text', text: 'OK' }, value: 'ok' }] }]
  const ts = await slack.sendMessage('C123', '**bold** [OpenAI](https://openai.com)', { replyTo: '111.222', broadcast: true, inlineKeyboard: keyboard })
  await slack.editMessage('C123', '123.456', '**edit** [Docs](https://example.com)', { inlineKeyboard: keyboard })

  expect(ts).toBe('123.456')
  expect(posted.channel).toBe('C123')
  expect(posted.thread_ts).toBe('111.222')
  expect(posted.reply_broadcast).toBe(true)
  const postedBlocks = blocksFrom(posted)
  expect(postedBlocks[0]).toMatchObject({ type: 'section', text: { type: 'mrkdwn' } })
  expect(blockText(postedBlocks[0])).toContain('*bold*')
  expect(blockText(postedBlocks[0])).toContain('<https://openai.com|OpenAI>')
  expect(postedBlocks.at(-1)).toBe(keyboard[0])

  expect(updated.channel).toBe('C123')
  expect(updated.ts).toBe('123.456')
  const updatedBlocks = blocksFrom(updated)
  expect(updatedBlocks[0]).toMatchObject({ type: 'section', text: { type: 'mrkdwn' } })
  expect(blockText(updatedBlocks[0])).toContain('*edit*')
  expect(blockText(updatedBlocks[0])).toContain('<https://example.com|Docs>')
  expect(updatedBlocks.at(-1)).toBe(keyboard[0])
})


test('Slack send/edit keep rich payloads within block limit when buttons are present', async () => {
  const slack = new SlackAdapter({ botToken: 'xoxb-test', appToken: 'xapp-test', inboxDir: '/tmp' })
  let posted: Record<string, unknown> = {}
  let updated: Record<string, unknown> = {}
  slack.injectWebClientForTest({
    chat: {
      postMessage: async (payload: Record<string, unknown>) => { posted = payload; return { ts: '123.456' } },
      update: async (payload: Record<string, unknown>) => { updated = payload; return {} },
    },
  } as unknown as WebClient)

  const keyboard = Array.from({ length: 10 }, (_, index) => ({ type: 'actions', elements: [{ type: 'button', text: { type: 'plain_text', text: `B${index}` }, value: `b:${index}` }] }))
  const text = Array.from({ length: 80 }, (_, index) => `paragraph ${index} ${'x'.repeat(2800)}`).join('\n\n')
  await slack.sendMessage('C123', text, { inlineKeyboard: keyboard })
  await slack.editMessage('C123', '123.456', text, { inlineKeyboard: keyboard })

  expect(blocksFrom(posted).length).toBeLessThanOrEqual(50)
  expect(blocksFrom(updated).length).toBeLessThanOrEqual(50)
  expect(blocksFrom(posted).slice(-10)).toEqual(keyboard)
  expect(blocksFrom(updated).slice(-10)).toEqual(keyboard)
})

test('Slack rich payloads keep a visible text section even with too many button blocks', async () => {
  const slack = new SlackAdapter({ botToken: 'xoxb-test', appToken: 'xapp-test', inboxDir: '/tmp' })
  let posted: Record<string, unknown> = {}
  slack.injectWebClientForTest({
    chat: {
      postMessage: async (payload: Record<string, unknown>) => { posted = payload; return { ts: '123.456' } },
    },
  } as unknown as WebClient)

  const keyboard = Array.from({ length: 60 }, (_, index) => ({ type: 'actions', elements: [{ type: 'button', text: { type: 'plain_text', text: `B${index}` }, value: `b:${index}` }] }))
  await slack.sendMessage('C123', '**important prompt**', { inlineKeyboard: keyboard })

  const blocks = blocksFrom(posted)
  expect(blocks.length).toBe(50)
  expect(blocks[0]).toMatchObject({ type: 'section', text: { type: 'mrkdwn' } })
  expect(blockText(blocks[0])).toContain('*important prompt*')
  expect(blocks.slice(1).length).toBe(49)
})

test('Slack send/edit retry as plain text when rich blocks are rejected', async () => {
  const slack = new SlackAdapter({ botToken: 'xoxb-test', appToken: 'xapp-test', inboxDir: '/tmp' })
  const postCalls: Record<string, unknown>[] = []
  const updateCalls: Record<string, unknown>[] = []
  slack.injectWebClientForTest({
    chat: {
      postMessage: async (payload: Record<string, unknown>) => {
        postCalls.push(payload)
        if (postCalls.length === 1) throw { data: { error: 'invalid_blocks' } }
        return { ts: '123.456' }
      },
      update: async (payload: Record<string, unknown>) => {
        updateCalls.push(payload)
        if (updateCalls.length === 1) throw { data: { error: 'msg_blocks_too_long' } }
        return {}
      },
    },
  } as unknown as WebClient)

  await expect(slack.sendMessage('C123', '**fallback**', { replyTo: '111.222', broadcast: true })).resolves.toBe('123.456')
  await expect(slack.editMessage('C123', '123.456', '**fallback edit**')).resolves.toBeUndefined()

  expect(postCalls[0].blocks).toBeDefined()
  expect(postCalls[1].blocks).toBeUndefined()
  expect(postCalls[1]).toMatchObject({ channel: 'C123', thread_ts: '111.222', reply_broadcast: true })
  expect(String(postCalls[1].text)).toContain('*fallback*')
  expect(updateCalls[0].blocks).toBeDefined()
  expect(updateCalls[1].blocks).toBeUndefined()
  expect(updateCalls[1]).toMatchObject({ channel: 'C123', ts: '123.456' })
  expect(String(updateCalls[1].text)).toContain('*fallback edit*')
})


test('Slack reaction remove logs unexpected failures but ignores expected misses', async () => {
  const slack = new SlackAdapter({ botToken: 'xoxb-test', appToken: 'xapp-test', inboxDir: '/tmp' })
  const writes: string[] = []
  const originalWrite = process.stderr.write.bind(process.stderr)
  process.stderr.write = ((chunk: string | Uint8Array) => {
    writes.push(String(chunk))
    return true
  }) as typeof process.stderr.write
  try {
    const errors = [{ data: { error: 'ratelimited' } }, { data: { error: 'no_reaction' } }]
    slack.injectWebClientForTest({
      reactions: {
        remove: async () => { throw errors.shift() },
      },
    } as unknown as WebClient)
    await slack.removeReaction('C123', '111.222', '👀')
    await slack.removeReaction('C123', '111.222', '👀')
    expect(writes.join('')).toContain('slack: removeReaction(👀→eyes) on C123/111.222 failed: ratelimited')
    expect(writes.join('')).not.toContain('no_reaction')
  } finally {
    process.stderr.write = originalWrite
  }
})


test('Slack reaction add/remove use the same emoji normalization', async () => {
  const slack = new SlackAdapter({ botToken: 'xoxb-test', appToken: 'xapp-test', inboxDir: '/tmp' })
  const added: Record<string, unknown>[] = []
  const removed: Record<string, unknown>[] = []
  slack.injectWebClientForTest({
    reactions: {
      add: async (payload: Record<string, unknown>) => { added.push(payload); return {} },
      remove: async (payload: Record<string, unknown>) => { removed.push(payload); return {} },
    },
  } as unknown as WebClient)

  await slack.addReaction('C123', '111.222', '👀')
  await slack.removeReaction('C123', '111.222', '👀')

  expect(added[0]).toMatchObject({ channel: 'C123', timestamp: '111.222', name: 'eyes' })
  expect(removed[0]).toMatchObject({ channel: 'C123', timestamp: '111.222', name: 'eyes' })
})

test('Slack typing status sets and clears the same assistant thread', async () => {
  const slack = new SlackAdapter({ botToken: 'xoxb-test', appToken: 'xapp-test', inboxDir: '/tmp' })
  const statuses: Record<string, unknown>[] = []
  slack.injectWebClientForTest({
    assistant: {
      threads: {
        setStatus: async (payload: Record<string, unknown>) => { statuses.push(payload); return {} },
      },
    },
  } as unknown as WebClient)

  await slack.showTyping('C123', '111.222')
  await slack.clearTyping('C123', '111.222')
  await slack.showTyping('C123')
  await slack.clearTyping('C123')

  expect(statuses).toEqual([
    { channel_id: 'C123', thread_ts: '111.222', status: 'is thinking...' },
    { channel_id: 'C123', thread_ts: '111.222', status: '' },
  ])
})

test('Slack typing errors include redacted diagnostic message fallback', async () => {
  const slack = new SlackAdapter({ botToken: 'xoxb-test', appToken: 'xapp-test', inboxDir: '/tmp' })
  const writes: string[] = []
  const originalWrite = process.stderr.write.bind(process.stderr)
  process.stderr.write = ((chunk: string | Uint8Array) => {
    writes.push(String(chunk))
    return true
  }) as typeof process.stderr.write
  try {
    slack.injectWebClientForTest({
      assistant: {
        threads: {
          setStatus: async () => { throw new Error('status failed OPENAI_API_KEY=sk-1234567890abcdef') },
        },
      },
    } as unknown as WebClient)

    await slack.showTyping('C123', '111.222')
    expect(writes.join('')).toContain('slack: assistant.threads.setStatus failed: status failed OPENAI_API_KEY=…redacted')
    expect(writes.join('')).not.toContain('sk-1234567890abcdef')
  } finally {
    process.stderr.write = originalWrite
  }
})

test('Telegram typing sends chat action and surfaces failures', async () => {
  const telegram = new TelegramAdapter({ token: 'test-token', inboxDir: '/tmp' })
  const calls: Record<string, unknown>[] = []
  telegram.injectApiForTest(async (method, body) => {
    calls.push({ method, body })
    if (calls.length > 1) throw new Error('typing unavailable')
    return true
  })

  await telegram.showTyping('-1001')
  await expect(telegram.showTyping('-1001')).rejects.toThrow('typing unavailable')

  expect(calls).toEqual([
    { method: 'sendChatAction', body: { chat_id: '-1001', action: 'typing' } },
    { method: 'sendChatAction', body: { chat_id: '-1001', action: 'typing' } },
  ])
})


test('Telegram compact callback data round-trips through polling', async () => {
  const telegram = new TelegramAdapter({ token: 'test-token', inboxDir: '/tmp' })
  const longData = `perm:${'u'.repeat(36)}:${'r'.repeat(80)}:allow`
  const keyboard = telegram.renderButtons([{ text: 'Allow', data: longData }]).inlineKeyboard as Array<Array<{ callback_data: string }>>
  const token = keyboard[0][0].callback_data
  const seen = new Promise<string>(resolve => telegram.onInteraction(interaction => resolve(interaction.data)))
  let polled = false
  telegram.injectApiForTest(async (method: string) => {
    if (method === 'getMe') return { id: 42, username: 'bot' }
    if (method === 'getUpdates') {
      if (polled) throw new Error('stop polling')
      polled = true
      return [{ update_id: 1, callback_query: { id: 'cb1', data: token, message: { message_id: 7, chat: { id: -1001 } } } }]
    }
    return true
  })

  expect(Buffer.byteLength(token, 'utf8')).toBeLessThanOrEqual(64)
  expect(token).not.toBe(longData)
  await telegram.start()
  await expect(seen).resolves.toBe(longData)
  await telegram.stop()
})

test('Telegram stale compact callback data shows refresh alert and does not dispatch', async () => {
  const telegram = new TelegramAdapter({ token: 'test-token', inboxDir: '/tmp' })
  const interactions: string[] = []
  const answers: Record<string, unknown>[] = []
  let polled = false
  telegram.onInteraction(interaction => { interactions.push(interaction.data) })
  telegram.injectApiForTest(async (method: string, body?: Record<string, unknown>) => {
    if (method === 'getMe') return { id: 42, username: 'bot' }
    if (method === 'getUpdates') {
      if (polled) throw new Error('stop polling')
      polled = true
      return [{ update_id: 1, callback_query: { id: 'cb1', data: 'tgcb:stale', message: { message_id: 7, chat: { id: -1001 } } } }]
    }
    if (method === 'answerCallbackQuery') answers.push(body ?? {})
    return true
  })

  await telegram.start()
  await new Promise(resolve => setTimeout(resolve, 0))
  await telegram.stop()

  expect(interactions).toEqual([])
  expect(answers).toContainEqual({ callback_query_id: 'cb1', text: 'This button expired. Please rerun the command to refresh it.', show_alert: true })
})

test('Slack buttons compact oversized values and restore daemon payloads', () => {
  const slack = new SlackAdapter({ botToken: 'xoxb-test', appToken: 'xapp-test', inboxDir: '/tmp' })
  const longData = `perm:${'u'.repeat(36)}:${'r'.repeat(2500)}:allow`
  const keyboard = slack.renderButtons([{ text: 'Allow', data: longData }]).inlineKeyboard as Array<{ elements: Array<{ action_id: string; value: string }> }>
  const button = keyboard[0].elements[0]
  const resolveValue = (slack as unknown as { resolveCallbackValue(data: string, opts?: { consume?: boolean }): string | undefined }).resolveCallbackValue.bind(slack)

  expect(Buffer.byteLength(button.value, 'utf8')).toBeLessThanOrEqual(1900)
  expect(button.value).not.toBe(longData)
  expect(resolveValue(button.value, { consume: false })).toBe(longData)
  expect(resolveValue(button.value)).toBe(longData)
  expect(resolveValue(button.value)).toBeUndefined()
})

test('Slack buttons keep long daemon payloads in value with short action ids', () => {
  const slack = new SlackAdapter({ botToken: 'xoxb-test', appToken: 'xapp-test', inboxDir: '/tmp' })
  const longData = `perm:${'u'.repeat(36)}:${'r'.repeat(300)}:allow`
  const otherLongData = `${longData}:other`
  const keyboard = slack.renderButtons([{ text: 'Allow', data: longData }, { text: 'Deny', data: otherLongData }]).inlineKeyboard as Array<{ elements: Array<{ action_id: string; value: string }> }>
  const [button, otherButton] = keyboard[0].elements

  expect(button.action_id.length).toBeLessThanOrEqual(64)
  expect(otherButton.action_id.length).toBeLessThanOrEqual(64)
  expect(button.action_id).not.toBe(otherButton.action_id)
  expect(button.value).toBe(longData)
  expect(otherButton.value).toBe(otherLongData)
  expect(slackInteractionCallback({ channel: { id: 'C1' }, actions: [{ action_id: button.action_id, value: button.value }] })?.data).toBe(longData)
})

test('Slack and Telegram renderButtons chunk platform button rows', () => {
  const buttons = Array.from({ length: 6 }, (_, index) => ({ text: `Button ${index}`, data: `data:${index}` }))
  const slack = new SlackAdapter({ botToken: 'xoxb-test', appToken: 'xapp-test', inboxDir: '/tmp' })
  const telegram = new TelegramAdapter({ token: 'test-token', inboxDir: '/tmp' })

  const slackKeyboard = (slack.renderButtons(buttons).inlineKeyboard as Array<{ elements: unknown[] }>)
  const telegramKeyboard = (telegram.renderButtons(buttons).inlineKeyboard as unknown[][])

  expect(slackKeyboard.map(block => block.elements.length)).toEqual([5, 1])
  expect(telegramKeyboard.map(row => row.length)).toEqual([2, 2, 2])
})

test('Slack sendMessage ignores malformed postMessage timestamps', async () => {
  const slack = new SlackAdapter({ botToken: 'xoxb-test', appToken: 'xapp-test', inboxDir: '/tmp' })
  slack.injectWebClientForTest({
    chat: {
      postMessage: async () => ({ ts: 123 }),
    },
  } as unknown as WebClient)

  await expect(slack.sendMessage('C123', 'hello')).resolves.toBeUndefined()
})

test('Slack downloadFile sanitizes file ids and names before writing locally', async () => {
  const inboxDir = mkdtempSync(`${tmpdir()}/ccm-inbox-`)
  const slack = new SlackAdapter({ botToken: 'xoxb-test', appToken: 'xapp-test', inboxDir })
  const originalFetch = globalThis.fetch
  let fetchedUrl = ''
  globalThis.fetch = (async (url: string | URL | Request) => {
    fetchedUrl = String(url)
    return new Response('ok')
  }) as unknown as typeof fetch
  slack.injectWebClientForTest({
    files: {
      info: async () => ({ file: { url_private_download: 'https://files.example/download', name: '../bad/name.txt' } }),
    },
  } as unknown as WebClient)

  try {
    await expect(slack.downloadFile('../F/1')).resolves.toBe(`${inboxDir}/.._F_1-.._bad_name.txt`)
    expect(fetchedUrl).toBe('https://files.example/download')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('Slack downloadFile reports file id and status on download failure', async () => {
  const inboxDir = mkdtempSync(`${tmpdir()}/ccm-inbox-`)
  const slack = new SlackAdapter({ botToken: 'xoxb-test', appToken: 'xapp-test', inboxDir })
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async () => new Response('nope OPENAI_API_KEY=sk-1234567890abcdef', { status: 403, headers: { 'content-type': 'text/plain' } })) as unknown as typeof fetch
  slack.injectWebClientForTest({
    files: {
      info: async () => ({ file: { url_private_download: 'https://files.example/download', name: 'a.txt' } }),
    },
  } as unknown as WebClient)

  try {
    await expect(slack.downloadFile('F403')).rejects.toThrow('Slack download F403: HTTP 403, text/plain, body: nope OPENAI_API_KEY=…redacted')
    await expect(slack.downloadFile('F403')).rejects.not.toThrow('sk-1234567890abcdef')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('Slack fetchThread normalizes unsafe reply payloads', async () => {
  const slack = new SlackAdapter({ botToken: 'xoxb-test', appToken: 'xapp-test', inboxDir: '/tmp' })
  slack.injectWebClientForTest({
    conversations: {
      replies: async () => ({ messages: [
        null,
        { ts: '171000.5abc', user: { bad: true }, text: { bad: true } },
        { ts: '171000.5', user: 'U1', text: 'hello' },
      ] }),
    },
    users: {
      info: async () => ({ user: { profile: { display_name: 'Ada' } } }),
    },
  } as unknown as WebClient)

  await expect(slack.fetchThread('C123', '171000.1')).resolves.toEqual([
    { messageId: '171000.5abc', userId: '', userName: 'unknown', text: '', ts: new Date(0).toISOString() },
    { messageId: '171000.5', userId: 'U1', userName: 'Ada', text: 'hello', ts: new Date(171000.5 * 1000).toISOString() },
  ])
})

test('Telegram send/edit payloads preserve MarkdownV2 styling and reply anchoring', async () => {
  const telegram = new TelegramAdapter({ token: 'test-token', inboxDir: '/tmp' })
  const calls: Array<{ method: string; body?: Record<string, unknown> }> = []
  telegram.injectApiForTest(async (method: string, body?: Record<string, unknown>) => {
    calls.push({ method, body })
    if (method === 'sendMessage') return { message_id: 42 }
    return true
  })

  const keyboard = [[{ text: 'OK', callback_data: 'ok' }]]
  const messageId = await telegram.sendMessage('-1001', '**bold** [OpenAI](https://openai.com)', { replyTo: '7', inlineKeyboard: keyboard })
  await telegram.editMessage('-1001', '42', '**edit** [Docs](https://example.com)', { inlineKeyboard: keyboard })

  expect(messageId).toBe('42')
  expect(calls[0]).toMatchObject({ method: 'sendMessage', body: { chat_id: '-1001', parse_mode: 'MarkdownV2', reply_to_message_id: 7 } })
  expect(calls[0].body?.text).toContain('*bold*')
  expect(calls[0].body?.text).toContain('[OpenAI](https://openai.com)')
  expect(calls[0].body?.reply_markup).toEqual({ inline_keyboard: keyboard })

  expect(calls[1]).toMatchObject({ method: 'editMessageText', body: { chat_id: '-1001', message_id: 42, parse_mode: 'MarkdownV2' } })
  expect(calls[1].body?.text).toContain('*edit*')
  expect(calls[1].body?.text).toContain('[Docs](https://example.com)')
  expect(calls[1].body?.reply_markup).toEqual({ inline_keyboard: keyboard })
})


test('Telegram send/edit retry as plain text when Telegram rejects MarkdownV2', async () => {
  const telegram = new TelegramAdapter({ token: 'test-token', inboxDir: '/tmp' })
  const calls: Array<{ method: string; body?: Record<string, unknown> }> = []
  let sendAttempts = 0
  let editAttempts = 0
  telegram.injectApiForTest(async (method: string, body?: Record<string, unknown>) => {
    calls.push({ method, body })
    if (method === 'sendMessage') {
      sendAttempts++
      if (sendAttempts === 1) throw new Error("Telegram sendMessage: Bad Request: can't parse entities")
      return { message_id: 43 }
    }
    if (method === 'editMessageText') {
      editAttempts++
      if (editAttempts === 1) throw new Error("Telegram editMessageText: Bad Request: can't parse entities")
      return true
    }
    return true
  })

  const keyboard = [[{ text: 'OK', callback_data: 'ok' }]]
  await expect(telegram.sendMessage('-1001', '**broken** - text', { replyTo: '7', inlineKeyboard: keyboard })).resolves.toBe('43')
  await expect(telegram.editMessage('-1001', '43', '**broken edit** - text', { inlineKeyboard: keyboard })).resolves.toBeUndefined()

  expect(calls[0].body?.parse_mode).toBe('MarkdownV2')
  expect(calls[1].body?.parse_mode).toBeUndefined()
  expect(calls[1].body).toMatchObject({ chat_id: '-1001', text: '**broken** - text', reply_to_message_id: 7, reply_markup: { inline_keyboard: keyboard } })
  expect(calls[2].body?.parse_mode).toBe('MarkdownV2')
  expect(calls[3].body?.parse_mode).toBeUndefined()
  expect(calls[3].body).toMatchObject({ chat_id: '-1001', message_id: 43, text: '**broken edit** - text', reply_markup: { inline_keyboard: keyboard } })
})


test('Telegram long messages return the button-bearing final message id', async () => {
  const telegram = new TelegramAdapter({ token: 'test-token', inboxDir: '/tmp' })
  const calls: Array<{ method: string; body?: Record<string, unknown> }> = []
  telegram.injectApiForTest(async (method: string, body?: Record<string, unknown>) => {
    calls.push({ method, body })
    return { message_id: calls.length }
  })

  const keyboard = [[{ text: 'OK', callback_data: 'ok' }]]
  const messageId = await telegram.sendMessage('-1001', 'x '.repeat(5000), { inlineKeyboard: keyboard })

  expect(calls.filter(call => call.method === 'sendMessage').length).toBeGreaterThan(1)
  expect(calls.at(-1)?.body?.reply_markup).toEqual({ inline_keyboard: keyboard })
  expect(messageId).toBe(String(calls.length))
})


test('Telegram markdown fallback never sends an unsplit oversized original', async () => {
  const telegram = new TelegramAdapter({ token: 'test-token', inboxDir: '/tmp' })
  const calls: Array<{ method: string; body?: Record<string, unknown> }> = []
  telegram.injectApiForTest(async (method: string, body?: Record<string, unknown>) => {
    calls.push({ method, body })
    if (method === 'sendMessage' && body?.parse_mode === 'MarkdownV2') throw new Error("Telegram sendMessage: Bad Request: can't parse entities")
    return { message_id: calls.length }
  })

  const text = '**x** '.repeat(1200)
  await expect(telegram.sendMessage('-1001', text)).resolves.toBe('2')

  const fallbackCalls = calls.filter(call => call.method === 'sendMessage' && call.body?.parse_mode === undefined)
  expect(fallbackCalls.length).toBeGreaterThan(1)
  for (const call of fallbackCalls) {
    expect(String(call.body?.text ?? '').length).toBeLessThanOrEqual(3800)
  }
})


test('Telegram sendMessage ignores malformed message ids', async () => {
  const telegram = new TelegramAdapter({ token: 'test-token', inboxDir: '/tmp' })
  telegram.injectApiForTest(async (method: string) => {
    if (method === 'sendMessage') return []
    return true
  })

  await expect(telegram.sendMessage('-1001', 'hello')).resolves.toBeUndefined()
})

test('Telegram start normalizes malformed bot identity fields', async () => {
  const telegram = new TelegramAdapter({ token: 'test-token', inboxDir: '/tmp' })
  const methods: string[] = []
  telegram.injectApiForTest(async (method: string) => {
    methods.push(method)
    if (method === 'getMe') return { id: { bad: true }, username: { bad: true } }
    if (method === 'getUpdates') throw new Error('stop polling')
    return true
  })

  await telegram.start()
  expect(methods).toContain('getMe')
  expect(methods).toContain('setMyCommands')
})


test('Telegram skips malformed message id fields instead of partially parsing them', async () => {
  const telegram = new TelegramAdapter({ token: 'test-token', inboxDir: '/tmp' })
  const calls: Array<{ method: string; body?: Record<string, unknown> }> = []
  telegram.injectApiForTest(async (method: string, body?: Record<string, unknown>) => {
    calls.push({ method, body })
    if (method === 'sendMessage') return { message_id: 42 }
    return true
  })

  await telegram.sendMessage('-1001', 'hello', { replyTo: '7abc' })
  await telegram.editMessage('-1001', '42abc', 'edit')
  await telegram.addReaction('-1001', '42abc', '👍')
  await telegram.removeReaction('-1001', '42abc', '👍')

  expect(calls).toHaveLength(1)
  expect(calls[0]).toMatchObject({ method: 'sendMessage', body: { chat_id: '-1001' } })
  expect(calls[0].body).not.toHaveProperty('reply_to_message_id')
})


test('Telegram downloadFile sanitizes file ids before writing locally', async () => {
  const inboxDir = mkdtempSync(`${tmpdir()}/ccm-inbox-`)
  const telegram = new TelegramAdapter({ token: 'test-token', inboxDir })
  const originalFetch = globalThis.fetch
  let fetchedUrl = ''
  globalThis.fetch = (async (url: string | URL | Request) => {
    fetchedUrl = String(url)
    return new Response('ok')
  }) as unknown as typeof fetch
  telegram.injectApiForTest(async method => {
    if (method === 'getFile') return { file_path: 'remote/path/name.txt' }
    return true
  })

  try {
    await expect(telegram.downloadFile('../TG/1')).resolves.toBe(`${inboxDir}/.._TG_1-name.txt`)
    expect(fetchedUrl).toBe('https://api.telegram.org/file/bottest-token/remote/path/name.txt')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('Telegram downloadFile reports file id, status, and redacted body on download failure', async () => {
  const inboxDir = mkdtempSync(`${tmpdir()}/ccm-inbox-`)
  const telegram = new TelegramAdapter({ token: 'test-token', inboxDir })
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async () => new Response('nope OPENAI_API_KEY=sk-1234567890abcdef', { status: 404, headers: { 'content-type': 'text/plain' } })) as unknown as typeof fetch
  telegram.injectApiForTest(async method => {
    if (method === 'getFile') return { file_path: 'remote/path/name.txt' }
    return true
  })

  try {
    await expect(telegram.downloadFile('TG404')).rejects.toThrow('Telegram download TG404: HTTP 404, text/plain, body: nope OPENAI_API_KEY=…redacted')
    await expect(telegram.downloadFile('TG404')).rejects.not.toThrow('sk-1234567890abcdef')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('Telegram uploadFile uses checked Bot API calls for images and documents', async () => {
  const telegram = new TelegramAdapter({ token: 'test-token', inboxDir: '/tmp' })
  const calls: Array<{ method: string; body?: Record<string, unknown> }> = []
  telegram.injectApiForTest(async (method: string, body?: Record<string, unknown>) => {
    calls.push({ method, body })
    if (method === 'sendDocument') throw new Error('Telegram sendDocument: request failed')
    return { message_id: 42 }
  })

  await expect(telegram.uploadFile('-1001', 'package.json', 'image.png')).resolves.toBeUndefined()
  await expect(telegram.uploadFile('-1001', 'package.json', 'notes.txt')).rejects.toThrow('Telegram sendDocument: request failed')

  expect(calls[0].method).toBe('sendPhoto')
  expect(calls[0].body?.chat_id).toBe('-1001')
  expect(calls[0].body?.photo).toBeInstanceOf(Blob)
  expect(calls[1].method).toBe('sendDocument')
  expect(calls[1].body?.chat_id).toBe('-1001')
  expect(calls[1].body?.document).toBeInstanceOf(Blob)
})


test('Telegram search replies require channel id and non-empty query', () => {
  const telegram = new TelegramAdapter({ token: 'test-token', inboxDir: '/tmp' })
  const searches: Array<{ channelId: string; query: string }> = []
  telegram.onSearch((channelId, query) => searches.push({ channelId, query }))

  expect(telegram.handleSearchReply({ reply_to_message: { text: '🔍 Search:' }, text: ' repo ', chat: { id: -1001 } })).toBe(true)
  expect(telegram.handleSearchReply({ reply_to_message: { text: '🔍 Search:' }, text: '   ', chat: { id: -1001 } })).toBe(false)
  expect(telegram.handleSearchReply({ reply_to_message: { text: '🔍 Search:' }, text: 'repo' })).toBe(false)
  expect(searches).toEqual([{ channelId: '-1001', query: 'repo' }])
})


test('Telegram search reply handler isolates async callback failures', async () => {
  const telegram = new TelegramAdapter({ token: 'test-token', inboxDir: '/tmp' })
  const writes: string[] = []
  const originalWrite = process.stderr.write.bind(process.stderr)
  process.stderr.write = ((chunk: string | Uint8Array) => {
    writes.push(String(chunk))
    return true
  }) as typeof process.stderr.write
  try {
    telegram.onSearch(async () => { throw new Error('search boom') })
    expect(telegram.handleSearchReply({ reply_to_message: { text: '🔍 Search:' }, text: ' repo ', chat: { id: -1001 } })).toBe(true)
    await Promise.resolve()
    expect(writes.join('')).toContain('telegram: search handler failed: search boom')
  } finally {
    process.stderr.write = originalWrite
  }
})


test('Telegram search contexts are scoped to prompt message id', async () => {
  const telegram = new TelegramAdapter({ token: 'test-token', inboxDir: '/tmp' })
  let nextMessageId = 10
  telegram.injectApiForTest(async (method: string) => {
    expect(method).toBe('sendMessage')
    return { message_id: nextMessageId++ }
  })
  const searches: Array<{ channelId: string; query: string; runtime?: string }> = []
  telegram.onSearch((channelId, query, context) => searches.push({ channelId, query, runtime: context?.runtime }))

  await telegram.promptSearch('-1001', 'Claude dirs', { runtime: 'claude' })
  await telegram.promptSearch('-1001', 'Codex dirs', { runtime: 'codex' })

  expect(telegram.handleSearchReply({ reply_to_message: { message_id: 10, text: '🔍 Search:' }, text: ' alpha ', chat: { id: -1001 } })).toBe(true)
  expect(telegram.handleSearchReply({ reply_to_message: { message_id: 11, text: '🔍 Search:' }, text: ' beta ', chat: { id: -1001 } })).toBe(true)
  expect(searches).toEqual([
    { channelId: '-1001', query: 'alpha', runtime: 'claude' },
    { channelId: '-1001', query: 'beta', runtime: 'codex' },
  ])
})
