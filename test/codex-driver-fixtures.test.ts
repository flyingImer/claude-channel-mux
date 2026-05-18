import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { test, expect } from 'bun:test'
import { CodexAppServerAgentDriver, codexEntriesFromTurns, codexNativeTurnId, codexResponseArray, codexResponseObject, codexTranscriptEntryFromItem } from '../agents/codex/app-server-driver.ts'
import type { JsonObject } from '../agents/codex/app-server-client.ts'
import type { AgentCommand, AgentCommandResult, AgentEvent, AgentSession, AgentSnapshotPendingItem, AgentTurn } from '../agents/types.ts'

type TestCodexClient = {
  request?: (method: string, params: JsonObject) => Promise<JsonObject>
}

type TestCodexRuntime = {
  session: AgentSession
  modelOverride?: string
  client: TestCodexClient
  threadId: string
  activeTurns: Map<string, string>
  turnThreads: Map<string, string>
  turnChannels: Map<string, string>
  buffers: Map<string, string>
  deliveredMessages: Map<string, string[]>
  latestNativeTurnId?: string
  pendingRequests: Map<string, number>
  pendingRequestDetails: Map<string, { method: string; params: JsonObject }>
}

type CodexDriverHarness = {
  runtimes: Map<string, TestCodexRuntime>
  threadToSession: Map<string, string>
  onEvent(cb: (event: AgentEvent) => void): void
  handleNotification(msg: JsonObject): void
  handleServerRequest(msg: JsonObject): void
  readTranscriptRecent(path: string, limit: number): Array<{ role: string; text: string }>
  formatTurn(turn: AgentTurn): string
  sendCommand(input: { session: AgentSession; command: AgentCommand }): Promise<AgentCommandResult>
  snapshot(input: { session: AgentSession; cwd: string }): Promise<{ health: string[]; source: string; recent: Array<{ role: string; text: string }>; pending: AgentSnapshotPendingItem[] }>
}

const codexCapabilities = { streaming: true, cancel: true, resume: true, toolCalling: true } as const

function codexSession(sessionId: string, nativeSessionId: string): AgentSession {
  return { kind: 'codex', sessionId, nativeSessionId, transport: 'codex-app-server', cwd: '/tmp', status: 'idle', capabilities: codexCapabilities }
}

function testRuntime(session: AgentSession, client: TestCodexClient = {}): TestCodexRuntime {
  return { session, client, threadId: session.nativeSessionId, activeTurns: new Map(), turnThreads: new Map(), turnChannels: new Map(), buffers: new Map(), deliveredMessages: new Map(), pendingRequests: new Map(), pendingRequestDetails: new Map() }
}

function driver(): CodexDriverHarness {
  return new CodexAppServerAgentDriver({
    codexBin: 'codex',
    daemonSock: '/tmp/no.sock',
    mcpServerPath: '/tmp/server.ts',
    baseEnv: {},
  }) as unknown as CodexDriverHarness
}

test('Codex transcript parser covers user, assistant, plan, reasoning, and tool rows', () => {
  const d = driver()
  const dir = mkdtempSync(join(tmpdir(), 'ccm-codex-fixture-'))
  const path = join(dir, 'codex.jsonl')
  writeFileSync(path, [
    { item: { type: 'userMessage', content: [{ type: 'text', text: 'hello' }] } },
    { item: { type: 'agentMessage', text: 'hi' } },
    { item: { type: 'plan', text: '1. check build' } },
    { item: { type: 'reasoning', summary: ['thought summary'], content: [] } },
    { item: { type: 'commandExecution', status: 'completed', command: 'bun test' } },
  ].map(entry => JSON.stringify(entry)).join('\n') + '\n')
  expect(d.readTranscriptRecent(path, 10)).toEqual([
    { role: 'user', text: 'hello' },
    { role: 'codex', text: 'hi' },
    { role: 'plan', text: '1. check build' },
    { role: 'reasoning', text: 'thought summary' },
    { role: 'tool', text: 'commandExecution: completed: bun test' },
  ])
})

test('Codex live turn parser covers the same transcript roles', () => {
  const entries = codexEntriesFromTurns([{ items: [
    { type: 'userMessage', content: [{ type: 'text', text: 'u' }] },
    { type: 'agentMessage', text: 'a' },
    { type: 'plan', text: 'plan' },
    { type: 'reasoning', summary: [], content: ['why'] },
    { type: 'mcpToolCall', status: 'inProgress', text: 'tooling' },
  ] }])
  expect(entries).toEqual([
    { role: 'user', text: 'u' },
    { role: 'codex', text: 'a' },
    { role: 'plan', text: 'plan' },
    { role: 'reasoning', text: 'why' },
    { role: 'tool', text: 'mcpToolCall: inProgress: tooling' },
  ])
})

test('Codex plan notification emits normalized plan_updated event', () => {
  const d = driver()
  const session = codexSession('s1', 't1')
  const events: AgentEvent[] = []
  d.runtimes.set('s1', { ...testRuntime(session), activeTurns: new Map([['native-turn', 'ccm-turn']]), turnThreads: new Map([['native-turn', 'room-thread']]), turnChannels: new Map([['native-turn', 'test:room']]) })
  d.threadToSession.set('t1', 's1')
  d.onEvent((event: AgentEvent) => events.push(event))
  d.handleNotification({ method: 'turn/plan/updated', params: { threadId: 't1', turnId: 'native-turn', explanation: 'why', plan: [{ step: 'do it', status: 'inProgress' }, { step: 'done', status: 'completed' }, { step: 'later', status: 'weird' }] } })
  expect(events).toEqual([{ type: 'plan_updated', session, turnId: 'ccm-turn', explanation: 'why', plan: [{ step: 'do it', status: 'inProgress' }, { step: 'done', status: 'completed' }, { step: 'later', status: 'pending' }] }])
})

test('Codex server requests accept only safe integer JSON-RPC ids', () => {
  const d = driver()
  const session = codexSession('server-request-session', 'server-request-thread')
  const events: AgentEvent[] = []
  const runtime = testRuntime(session)
  d.runtimes.set('server-request-session', runtime)
  d.threadToSession.set('server-request-thread', 'server-request-session')
  d.onEvent((event: AgentEvent) => events.push(event))

  d.handleServerRequest({ id: 1.5, method: 'item/permissions/requestApproval', params: { threadId: 'server-request-thread' } })
  d.handleServerRequest({ id: Number.MAX_SAFE_INTEGER + 1, method: 'item/permissions/requestApproval', params: { threadId: 'server-request-thread' } })
  expect(events).toEqual([])
  expect(runtime.pendingRequests.size).toBe(0)

  runtime.turnThreads.set('native-turn', 'channel-thread')
  d.handleServerRequest({ id: 7, method: 'item/permissions/requestApproval', params: { threadId: 'server-request-thread', turnId: 'native-turn' } })
  expect(events).toHaveLength(1)
  expect(events[0]).toMatchObject({ type: 'server_request', request: { requestId: '7', threadId: 'channel-thread', turnId: 'native-turn' } })
  expect(runtime.pendingRequests.get('7')).toBe(7)
})



test('Codex help documents pending request controls', async () => {
  const d = driver()
  const session = codexSession('help-session', 'thread-help')
  d.runtimes.set('help-session', testRuntime(session))
  const result = await d.sendCommand({ session, command: { commandId: 'help', roomId: 'room', channelKey: 'test:room', platform: 'test', channelId: 'room', threadId: 'msg', messageId: 'msg', cwd: '/tmp', command: '/help', meta: {} } })
  expect(result.display).toContain('/cx nav N allow|session|policy|network|deny|abort|answer <text>')
  expect(result.display).toContain('pending requests include action buttons and target id')
  expect(result.display).toContain('pending requests: `/cx ss` and `/cx nav` show the same actionable requests')
  expect(result.display).toContain('stale requests expose only `Clear stale request`')
})

test('Codex sendCommand fails closed for unknown commands and only raw starts a turn', async () => {
  const d = driver()
  const calls: Array<{ method: string; params: JsonObject }> = []
  const session = codexSession('s2', 't2')
  const client = { request: async (method: string, params: JsonObject) => { calls.push({ method, params }); return { result: { turn: { id: 'native' } } } } }
  d.runtimes.set('s2', testRuntime(session, client))
  const base = { commandId: 'cmd', roomId: 'room', channelKey: 'test:room', platform: 'test', channelId: 'room', threadId: 'msg', messageId: 'msg', cwd: '/tmp', meta: {} }

  const unknown = await d.sendCommand({ session, command: { ...base, command: '/memory list' } })
  expect(unknown.display).toContain('Unsupported Codex command')
  expect(calls).toEqual([])

  const raw = await d.sendCommand({ session, command: { ...base, command: '/raw /goal create x' } })
  expect(raw.nativeCommandId).toBe('native')
  expect(calls).toHaveLength(1)
  expect(calls[0]).toMatchObject({ method: 'turn/start', params: { threadId: 't2', cwd: '/tmp' } })
  expect(calls[0].params.input[0].text).toBe('/goal create x')
  const runtime = d.runtimes.get('s2')
  expect(runtime?.turnChannels.get('native')).toBe('test:room')
})

test('Codex goal command interrupts active turn and starts replacement goal turn', async () => {
  const d = driver()
  const calls: Array<{ method: string; params: JsonObject }> = []
  const session = codexSession('goal-session', 'goal-thread')
  const client = {
    request: async (method: string, params: JsonObject) => {
      calls.push({ method, params })
      if (method === 'turn/start') return { result: { turn: { id: 'native-goal' } } }
      return { result: {} }
    },
  }
  const runtime = testRuntime(session, client)
  runtime.latestNativeTurnId = 'native-old'
  runtime.activeTurns.set('native-old', 'ccm-old')
  d.runtimes.set('goal-session', runtime)
  const base = { commandId: 'goal-cmd', roomId: 'room', channelKey: 'test:room', platform: 'test', channelId: 'room', threadId: 'msg', messageId: 'msg', cwd: '/tmp', meta: {} }

  const result = await d.sendCommand({ session, command: { ...base, command: '/goal ship better UX' } })

  expect(result.nativeCommandId).toBe('native-goal')
  expect(result.display).toContain('interrupted active turn native-old')
  expect(calls.map(call => call.method)).toEqual(['turn/interrupt', 'turn/start'])
  expect(calls[0]).toMatchObject({ method: 'turn/interrupt', params: { threadId: 'goal-thread', turnId: 'native-old' } })
  expect(String(calls[1].params.input[0].text)).toContain('Replace the current CCM Codex goal')
  expect(String(calls[1].params.input[0].text)).toContain('ship better UX')
  expect(runtime.turnChannels.get('native-goal')).toBe('test:room')
  expect(runtime.turnThreads.get('native-goal')).toBe('msg')
})

test('Codex snapshot records typed app-server read/config failures', async () => {
  const d = driver()
  const session = codexSession('snap-session', 'snap-thread')
  const calls: Array<{ method: string; params: JsonObject }> = []
  const client = {
    request: async (method: string, params: JsonObject) => {
      calls.push({ method, params })
      if (method === 'thread/read' && params.includeTurns === true) throw new Error('turns unavailable')
      if (method === 'thread/read') return { result: { thread: { id: 'snap-thread', status: 'idle' } } }
      if (method === 'config/read') throw new Error('config unavailable')
      return {}
    },
  }
  d.runtimes.set('snap-session', testRuntime(session, client))

  const snapshot = await d.snapshot({ session, cwd: '/tmp' })

  expect(calls.map(call => call.method)).toEqual(['thread/read', 'config/read', 'thread/read'])
  expect(snapshot.source).toBe('live')
  expect(snapshot.health).toContain('thread/read turns: turns unavailable')
  expect(snapshot.health).toContain('config/read: config unavailable')
})

test('Codex model command updates runtime override without config writes', async () => {
  const d = driver()
  const calls: Array<{ method: string; params: JsonObject }> = []
  const session = codexSession('s3', 't3')
  const client = { request: async (method: string, params: JsonObject) => { calls.push({ method, params }); return { result: { config: { model: 'base-model' } } } } }
  const runtime = testRuntime(session, client)
  d.runtimes.set('s3', runtime)
  const base = { commandId: 'cmd', roomId: 'room', channelKey: 'test:room', platform: 'test', channelId: 'room', threadId: 'msg', messageId: 'msg', cwd: '/tmp', meta: {} }

  const set = await d.sendCommand({ session, command: { ...base, command: '/model test-model' } })
  expect(set.display).toContain('test-model')
  expect(runtime.modelOverride).toBe('test-model')
  expect(calls).toEqual([])

  const get = await d.sendCommand({ session, command: { ...base, command: '/model' } })
  expect(get.display).toContain('test-model')
  expect(calls.map(c => c.method)).toEqual(['config/read'])
  expect(calls.map(c => c.method)).not.toContain('config/value/write')
})

test('Codex compaction notifications emit lifecycle events', () => {
  const d = driver()
  const session = codexSession('s4', 't4')
  const events: AgentEvent[] = []
  d.runtimes.set('s4', { ...testRuntime(session), activeTurns: new Map([['native-turn', 'ccm-turn']]), turnThreads: new Map([['native-turn', 'room-thread']]), turnChannels: new Map([['native-turn', 'test:room']]) })
  d.threadToSession.set('t4', 's4')
  d.onEvent((event: AgentEvent) => events.push(event))
  d.handleNotification({ method: 'item/started', params: { threadId: 't4', turnId: 'native-turn', item: { type: 'contextCompaction' } } })
  d.handleNotification({ method: 'item/completed', params: { threadId: 't4', turnId: 'native-turn', item: { type: 'contextCompaction' } } })
  expect(events).toEqual([
    { type: 'compaction', session, turnId: 'ccm-turn', status: 'started' },
    { type: 'compaction', session, turnId: 'ccm-turn', status: 'completed' },
  ])
})

test('Codex snapshot classifies MCP tool approvals from typed _meta or meta only', async () => {
  const d = driver()
  const session = codexSession('pending-session', 'pending-thread')
  const runtime = testRuntime(session, { request: async () => ({ result: { thread: { id: 'pending-thread', status: 'idle' } } }) })
  runtime.pendingRequestDetails.set('mcp-tool', {
    method: 'mcpServer/elicitation/request',
    params: { serverName: 'fs', _meta: { codex_approval_kind: 'mcp_tool_call', tool_params: { path: '/tmp/a' } } },
  })
  runtime.pendingRequestDetails.set('mcp-form', {
    method: 'mcpServer/elicitation/request',
    params: { serverName: 'forms', _meta: 'not-an-object', meta: { codex_approval_kind: 'form' } },
  })
  d.runtimes.set('pending-session', runtime)

  const snapshot = await d.snapshot({ session, cwd: '/tmp' })

  expect(snapshot.pending.map(item => [item.id, item.kind, item.title])).toEqual([
    ['mcp-tool', 'approval', 'MCP tool approval (fs)'],
    ['mcp-form', 'elicitation', 'MCP elicitation (forms)'],
  ])
  expect(snapshot.pending[0].detail).toContain('{\"path\":\"/tmp/a\"}')
})

test('Codex turn envelope includes whitelisted message meta but not arbitrary metadata', () => {
  const d = driver()
  const text = d.formatTurn({
    turnId: 'turn', roomId: 'slack:C', channelKey: 'slack:C', platform: 'slack', channelId: 'C', threadId: 'T', messageId: 'M', cwd: '/tmp', text: 'hello',
    addressedAgent: 'codex', defaultAgent: 'claude', peerAgents: [],
    meta: { attachment_file_id: 'F1', attachment_name: 'a.png', reply_to_id: 'R1', user_id: 'U1', secret: 'NOPE' },
  })
  expect(text).toContain('<message_meta trust="untrusted">')
  expect(text).toContain('attachment_file_id')
  expect(text).toContain('reply_to_id')
  expect(text).not.toContain('NOPE')
})


test('Codex transcript item parser ignores malformed rows safely', () => {
  expect(codexTranscriptEntryFromItem(null)).toBeUndefined()
  expect(codexTranscriptEntryFromItem({ type: 'userMessage', content: [{ text: 123 }] })).toBeUndefined()
  expect(codexTranscriptEntryFromItem({ type: 'reasoning', summary: ['s1'], content: ['c1'] })).toEqual({ role: 'reasoning', text: 's1' })
  expect(codexTranscriptEntryFromItem({ status: 'done', command: 'bun test' }, 'commandExecution')).toEqual({ role: 'tool', text: 'commandExecution: done: bun test' })
})


test('Codex response helpers safely extract app-server result fields', () => {
  const response = { result: { turn: { id: 'native-turn' }, config: { model: 'gpt' }, data: [{ name: 'mcp', bad: () => {}, nested: { ok: true } }, null, 'bad'] } }
  expect(codexNativeTurnId(response, 'fallback')).toBe('native-turn')
  expect(codexNativeTurnId({ result: { turn: {} } }, 'fallback')).toBe('fallback')
  expect(codexResponseObject(response, 'config')).toEqual({ model: 'gpt' })
  expect(codexResponseObject({ result: { config: 'bad' } }, 'config')).toBeUndefined()
  expect(codexResponseArray(response, 'data')).toEqual([{ name: 'mcp', nested: { ok: true } }])
  expect(codexResponseArray({ result: { data: 'bad' } }, 'data')).toEqual([])
})

test('Codex turn error completion clears active turn state', () => {
  const d = driver()
  const session = codexSession('error-session', 'error-thread')
  const events: AgentEvent[] = []
  const runtime = testRuntime(session)
  runtime.activeTurns.set('native-error-turn', 'ccm-error-turn')
  runtime.turnThreads.set('native-error-turn', 'room-thread')
  runtime.turnChannels.set('native-error-turn', 'test:room')
  runtime.buffers.set('native-error-turn', 'partial text')
  d.runtimes.set('error-session', runtime)
  d.threadToSession.set('error-thread', 'error-session')
  d.onEvent((event: AgentEvent) => events.push(event))

  d.handleNotification({ method: 'turn/completed', params: { threadId: 'error-thread', turn: { id: 'native-error-turn', error: { message: 'boom OPENAI_API_KEY=sk-1234567890abcdef' } } } })

  expect(events).toEqual([
    { type: 'status', session, status: 'idle' },
    { type: 'error', session, turnId: 'ccm-error-turn', error: 'boom OPENAI_API_KEY=…redacted', channelKey: 'test:room', threadId: 'room-thread' },
  ])
  expect(runtime.activeTurns.size).toBe(0)
  expect(runtime.turnThreads.size).toBe(0)
  expect(runtime.turnChannels.size).toBe(0)
  expect(runtime.buffers.size).toBe(0)
})

test('Codex error notification clears active turn state', () => {
  const d = driver()
  const session = codexSession('notify-error-session', 'notify-error-thread')
  const events: AgentEvent[] = []
  const runtime = testRuntime(session)
  runtime.activeTurns.set('native-notify-error-turn', 'ccm-notify-error-turn')
  runtime.turnThreads.set('native-notify-error-turn', 'room-thread')
  runtime.turnChannels.set('native-notify-error-turn', 'test:room')
  runtime.buffers.set('native-notify-error-turn', 'partial text')
  d.runtimes.set('notify-error-session', runtime)
  d.threadToSession.set('notify-error-thread', 'notify-error-session')
  d.onEvent((event: AgentEvent) => events.push(event))

  d.handleNotification({ method: 'error', params: { threadId: 'notify-error-thread', turnId: 'native-notify-error-turn', error: { message: 'notify boom token: ghp_abcdefghijklmnopqrstuvwxyz' } } })

  expect(events).toEqual([
    { type: 'status', session, status: 'idle' },
    { type: 'error', session, turnId: 'ccm-notify-error-turn', error: 'notify boom token: …redacted', channelKey: 'test:room', threadId: 'room-thread' },
  ])
  expect(runtime.session.status).toBe('idle')
  expect(runtime.latestNativeTurnId).toBeUndefined()
  expect(runtime.activeTurns.size).toBe(0)
  expect(runtime.turnThreads.size).toBe(0)
  expect(runtime.turnChannels.size).toBe(0)
  expect(runtime.buffers.size).toBe(0)
})

test('Codex completed agent message emits routable mid-turn event', () => {
  const d = driver()
  const session = codexSession('mid-session', 'mid-thread')
  const events: AgentEvent[] = []
  const runtime = testRuntime(session)
  runtime.activeTurns.set('native-mid-turn', 'ccm-mid-turn')
  runtime.turnThreads.set('native-mid-turn', 'room-thread')
  runtime.turnChannels.set('native-mid-turn', 'test:room')
  d.runtimes.set('mid-session', runtime)
  d.threadToSession.set('mid-thread', 'mid-session')
  d.onEvent((event: AgentEvent) => events.push(event))

  d.handleNotification({ method: 'item/completed', params: { threadId: 'mid-thread', turnId: 'native-mid-turn', item: { type: 'agentMessage', text: 'mid update' } } })

  expect(events).toEqual([
    { type: 'assistant_message', session, turnId: 'ccm-mid-turn', text: 'mid update', channelKey: 'test:room', threadId: 'room-thread' },
  ])
  expect(runtime.buffers.get('native-mid-turn')).toBe('mid update')
  expect(runtime.deliveredMessages.get('native-mid-turn')).toEqual(['mid update'])
})

test('Codex final turn preserves channel/thread before clearing turn state', () => {
  const d = driver()
  const session = codexSession('final-session', 'final-thread')
  const events: AgentEvent[] = []
  const runtime = testRuntime(session)
  runtime.activeTurns.set('native-final-turn', 'ccm-final-turn')
  runtime.turnThreads.set('native-final-turn', 'room-thread')
  runtime.turnChannels.set('native-final-turn', 'test:room')
  runtime.buffers.set('native-final-turn', 'final text')
  d.runtimes.set('final-session', runtime)
  d.threadToSession.set('final-thread', 'final-session')
  d.onEvent((event: AgentEvent) => events.push(event))

  d.handleNotification({ method: 'turn/completed', params: { threadId: 'final-thread', turn: { id: 'native-final-turn' } } })

  expect(events).toEqual([
    { type: 'status', session, status: 'idle' },
    { type: 'assistant_final', session, turnId: 'ccm-final-turn', text: 'final text', channelKey: 'test:room', threadId: 'room-thread' },
  ])
  expect(runtime.activeTurns.size).toBe(0)
  expect(runtime.turnThreads.size).toBe(0)
  expect(runtime.turnChannels.size).toBe(0)
  expect(runtime.buffers.size).toBe(0)
})

test('Codex completed turn clears latest turn id before cancel', async () => {
  const d = driver()
  const session = codexSession('cancel-session', 'cancel-thread')
  const calls: Array<{ method: string; params: unknown }> = []
  const runtime = testRuntime(session, {
    request: async (method: string, params: unknown) => {
      calls.push({ method, params })
      return {}
    },
  })
  runtime.activeTurns.set('native-done-turn', 'ccm-done-turn')
  runtime.turnThreads.set('native-done-turn', 'room-thread')
  runtime.turnChannels.set('native-done-turn', 'test:room')
  runtime.latestNativeTurnId = 'native-done-turn'
  d.runtimes.set('cancel-session', runtime)
  d.threadToSession.set('cancel-thread', 'cancel-session')

  d.handleNotification({ method: 'turn/completed', params: { threadId: 'cancel-thread', turn: { id: 'native-done-turn' } } })
  const result = await d.sendCommand({
    session,
    command: { commandId: 'cmd-cancel', roomId: 'room', channelKey: 'test:room', platform: 'test', channelId: 'room', threadId: 'msg', messageId: 'msg', cwd: '/tmp', meta: {}, command: '/cancel' },
  })

  expect(runtime.latestNativeTurnId).toBeUndefined()
  expect(runtime.turnChannels.size).toBe(0)
  expect(result.display).toBe('No active Codex turn to interrupt.')
  expect(calls.map(call => call.method)).not.toContain('turn/interrupt')
})

