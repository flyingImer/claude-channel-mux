import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { test, expect } from 'bun:test'
import { CodexAppServerAgentDriver, codexEntriesFromTurns, codexNativeTurnId, codexResponseArray, codexResponseObject, codexTranscriptEntryFromItem } from '../agents/codex/app-server-driver.ts'
import type { CodexAppServerClientOptions, JsonObject } from '../agents/codex/app-server-client.ts'
import { codexResolvedConfigFromEnv, type CodexResolvedConfig } from '../agents/codex/config.ts'
import type { AgentCommand, AgentCommandResult, AgentEvent, AgentSession, AgentSnapshotPendingItem, AgentTurn } from '../agents/types.ts'
import { slackFileMetadata } from '../adapters/slack.ts'
import { telegramInboundMessage } from '../adapters/telegram.ts'

type TestCodexClient = {
  start?: () => Promise<void>
  stop?: () => Promise<void>
  url?: () => string | undefined
  request?: (method: string, params: JsonObject) => Promise<JsonObject>
}

type TestCodexRuntime = {
  session: AgentSession
  modelOverride?: string
  effectiveModel?: string
  config: CodexResolvedConfig
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
  client?: TestCodexClient
  clientStart?: Promise<TestCodexClient>
  onEvent(cb: (event: AgentEvent) => void): void
  start(input: { sessionId: string; cwd: string; options?: { model?: string; materializeCwd?: string } }): Promise<AgentSession>
  resume(input: { sessionId: string; cwd: string; nativeSessionId?: string; options?: { model?: string; materializeCwd?: string } }): Promise<AgentSession>
  stop(session: AgentSession): Promise<void>
  handleNotification(msg: JsonObject): void
  handleServerRequest(msg: JsonObject): void
  readTranscriptRecent(path: string, limit: number): Array<{ role: string; text: string }>
  formatTurn(turn: AgentTurn): string
  sendTurn(input: { session: AgentSession; turn: AgentTurn }): Promise<string>
  sendCommand(input: { session: AgentSession; command: AgentCommand }): Promise<AgentCommandResult>
  snapshot(input: { session: AgentSession; cwd: string }): Promise<{ health: string[]; source: string; recent: Array<{ role: string; text: string }>; pending: AgentSnapshotPendingItem[] }>
}

const codexCapabilities = { streaming: true, cancel: true, resume: true, toolCalling: true } as const

function codexSession(sessionId: string, nativeSessionId: string): AgentSession {
  return { kind: 'codex', sessionId, nativeSessionId, transport: 'codex-app-server', cwd: '/tmp', status: 'idle', capabilities: codexCapabilities }
}

function testRuntime(session: AgentSession, client: TestCodexClient = {}): TestCodexRuntime {
  return { session, config: codexResolvedConfigFromEnv({}), client, threadId: session.nativeSessionId, activeTurns: new Map(), turnThreads: new Map(), turnChannels: new Map(), buffers: new Map(), deliveredMessages: new Map(), pendingRequests: new Map(), pendingRequestDetails: new Map() }
}

function testRuntimeWithModel(session: AgentSession, model: string, client: TestCodexClient): TestCodexRuntime {
  return { ...testRuntime(session, client), effectiveModel: model }
}

function driver(): CodexDriverHarness {
  return new CodexAppServerAgentDriver({
    codexCommand: ['codex'],
    daemonSock: '/tmp/no.sock',
    mcpServerPath: '/tmp/server.ts',
    baseEnv: {},
  }) as unknown as CodexDriverHarness
}

function driverWithClient(client: Required<Pick<TestCodexClient, 'start' | 'stop' | 'url' | 'request'>>): CodexDriverHarness {
  return driverWithClientFactory(() => client)
}

function driverWithClientFactory(clientFactory: (options: CodexAppServerClientOptions) => Required<Pick<TestCodexClient, 'start' | 'stop' | 'url' | 'request'>>): CodexDriverHarness {
  return new CodexAppServerAgentDriver({
    codexCommand: ['codex'],
    daemonSock: '/tmp/no.sock',
    mcpServerPath: '/tmp/server.ts',
    baseEnv: {},
    appServerListen: 'websocket',
    clientFactory: options => clientFactory(options) as never,
  }) as unknown as CodexDriverHarness
}

test('Codex app-server driver starts one shared client and preserves CCM session ids with native thread ids', async () => {
  const clients: Array<{ session: string; options: CodexAppServerClientOptions; calls: Array<{ method: string; params: JsonObject }> }> = []
  let nextClient = 0
  let nextThread = 0
  const d = driverWithClientFactory(options => {
    const index = ++nextClient
    const calls: Array<{ method: string; params: JsonObject }> = []
    clients.push({ session: `client-${index}`, options, calls })
    return {
      start: async () => {},
      stop: async () => {},
      url: () => `ws://127.0.0.1:${12344 + index}`,
      request: async (method: string, params: JsonObject) => {
        calls.push({ method, params })
        if (method === 'thread/start') return { result: { thread: { id: ++nextThread === 1 ? 'thread-a' : 'thread-b' } } }
        return { result: {} }
      },
    }
  })

  const first = await d.start({ sessionId: 'provisional-a', cwd: '/repo-a' })
  const second = await d.start({ sessionId: 'provisional-b', cwd: '/repo-b' })

  expect(clients).toHaveLength(1)
  expect(first.sessionId).toBe('provisional-a')
  expect(first.nativeSessionId).toBe('thread-a')
  expect(first.meta?.appServerUrl).toBe('ws://127.0.0.1:12345')
  expect(second.sessionId).toBe('provisional-b')
  expect(second.nativeSessionId).toBe('thread-b')
  expect(second.meta?.appServerUrl).toBe('ws://127.0.0.1:12345')
  expect(clients[0].options.env.CC_CHANNEL_SESSION_UUID).toBe('ccm-shared-codex-app-server')
  expect(clients[0].options.configArgs).toContain('mcp_servers.claude-channel-mux.env.CC_CHANNEL_SESSION_UUID="ccm-shared-codex-app-server"')
  expect(d.runtimes.has('thread-a')).toBe(true)
  expect(d.runtimes.has('provisional-a')).toBe(false)
  expect(d.runtimes.get('thread-a')?.session.sessionId).toBe('provisional-a')
  expect(clients[0].calls.map(call => call.method)).toEqual([
    'thread/start',
    'thread/inject_items',
    'thread/settings/update',
    'thread/start',
    'thread/inject_items',
    'thread/settings/update',
  ])
  expect(clients[0].calls[1]).toMatchObject({ method: 'thread/inject_items', params: { threadId: 'thread-a' } })
  expect(clients[0].calls[2]).toMatchObject({ method: 'thread/settings/update', params: { threadId: 'thread-a', cwd: '/repo-a' } })
  expect(clients[0].calls[4]).toMatchObject({ method: 'thread/inject_items', params: { threadId: 'thread-b' } })
  expect(clients[0].calls[5]).toMatchObject({ method: 'thread/settings/update', params: { threadId: 'thread-b', cwd: '/repo-b' } })
})

test('Codex app-server driver reuses the same client when rematerializing an existing native thread', async () => {
  let starts = 0
  const calls: Array<{ method: string; params: JsonObject }> = []
  const client = {
    start: async () => { starts += 1 },
    stop: async () => {},
    url: () => 'ws://127.0.0.1:12345',
    request: async (method: string, params: JsonObject) => {
      calls.push({ method, params })
      if (method === 'thread/start') return { result: { thread: { id: 'thread-a' } } }
      return { result: {} }
    },
  }
  const d = driverWithClient(client)

  const first = await d.start({ sessionId: 'provisional-a', cwd: '/repo-a' })
  const second = await d.start({ sessionId: 'provisional-a', cwd: '/repo-b', options: { materializeCwd: '/repo-b' } })

  expect(starts).toBe(1)
  expect(first.sessionId).toBe('provisional-a')
  expect(first.nativeSessionId).toBe('thread-a')
  expect(second.sessionId).toBe('provisional-a')
  expect(second.nativeSessionId).toBe('thread-a')
  expect(d.runtimes.has('thread-a')).toBe(true)
  expect(d.runtimes.has('provisional-a')).toBe(false)
  expect(calls.map(call => call.method)).toEqual([
    'thread/start',
    'thread/inject_items',
    'thread/settings/update',
    'thread/inject_items',
    'thread/settings/update',
  ])
  expect(calls[1]).toMatchObject({ method: 'thread/inject_items', params: { threadId: 'thread-a' } })
  expect(calls[2]).toMatchObject({ method: 'thread/settings/update', params: { threadId: 'thread-a', cwd: '/repo-a' } })
  expect(calls[3]).toMatchObject({ method: 'thread/inject_items', params: { threadId: 'thread-a' } })
  expect(calls[4]).toMatchObject({ method: 'thread/settings/update', params: { threadId: 'thread-a', cwd: '/repo-b' } })
})

test('Codex app-server driver stops shared client only after final thread runtime stops', async () => {
  let stops = 0
  let nextThread = 0
  const client = {
    start: async () => {},
    stop: async () => { stops += 1 },
    url: () => 'ws://127.0.0.1:12345',
    request: async (method: string) => method === 'thread/start' ? { result: { thread: { id: ++nextThread === 1 ? 'thread-a' : 'thread-b' } } } : { result: {} },
  }
  const d = driverWithClient(client)
  const first = await d.start({ sessionId: 'provisional-a', cwd: '/repo-a' })
  const second = await d.start({ sessionId: 'provisional-b', cwd: '/repo-b' })

  await d.stop(first)

  expect(stops).toBe(0)
  expect(d.runtimes.has('thread-a')).toBe(false)
  expect(d.runtimes.has('thread-b')).toBe(true)
  expect(d.client).toBe(client)

  await d.stop(second)

  expect(stops).toBe(1)
  expect(d.runtimes.has('thread-b')).toBe(false)
  expect(d.client).toBeUndefined()
  expect(d.clientStart).toBeUndefined()
})

test('Codex app-server driver can update an existing native thread to its materialized cwd', async () => {
  const calls: Array<{ method: string; params: JsonObject }> = []
  const client = {
    start: async () => {},
    stop: async () => {},
    url: () => 'ws://127.0.0.1:12345',
    request: async (method: string, params: JsonObject) => {
      calls.push({ method, params })
      if (method === 'thread/start') return { result: { thread: { id: 'thread-a' } } }
      return { result: {} }
    },
  }
  const d = driverWithClient(client)
  const session = await d.start({ sessionId: 'provisional-a', cwd: '/source' })

  const updated = await d.resume({ sessionId: session.sessionId, cwd: '/source', nativeSessionId: session.nativeSessionId, options: { materializeCwd: '/source/.codex/worktrees/thread-a' } })

  expect(updated.cwd).toBe('/source/.codex/worktrees/thread-a')
  expect(calls.map(call => call.method)).toEqual([
    'thread/start',
    'thread/inject_items',
    'thread/settings/update',
    'thread/inject_items',
    'thread/settings/update',
  ])
  expect(calls.at(-1)).toMatchObject({ method: 'thread/settings/update', params: { threadId: 'thread-a', cwd: '/source/.codex/worktrees/thread-a' } })
})

test('Codex app-server driver resumes native threads even when a model is configured', async () => {
  const calls: Array<{ method: string; params: JsonObject }> = []
  const client = {
    start: async () => {},
    stop: async () => {},
    url: () => 'ws://127.0.0.1:12345',
    request: async (method: string, params: JsonObject) => {
      calls.push({ method, params })
      if (method === 'thread/resume') return { result: { thread: { id: params.threadId } } }
      if (method === 'thread/start') return { result: { thread: { id: 'new-thread' } } }
      return { result: {} }
    },
  }
  const d = driverWithClient(client)

  const session = await d.resume({ sessionId: 'ccm-session', cwd: '/repo', nativeSessionId: 'native-thread', options: { model: 'room-model' } })

  expect(session.sessionId).toBe('ccm-session')
  expect(session.nativeSessionId).toBe('native-thread')
  expect(calls.map(call => call.method)).toEqual(['thread/resume', 'thread/inject_items', 'thread/settings/update'])
  expect(calls[0]).toMatchObject({ method: 'thread/resume', params: { threadId: 'native-thread' } })
})

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

test('Codex raw goal command carries CCM room metadata when available', async () => {
  const d = driver()
  const calls: Array<{ method: string; params: JsonObject }> = []
  const session = codexSession('raw-goal-session', 'raw-goal-thread')
  const client = { request: async (method: string, params: JsonObject) => { calls.push({ method, params }); return { result: { turn: { id: 'native-raw-goal' } } } } }
  d.runtimes.set('raw-goal-session', testRuntime(session, client))
  const command: AgentCommand = {
    commandId: 'raw-goal-cmd',
    roomId: 'slack:C123',
    channelKey: 'slack:C123',
    platform: 'slack',
    channelId: 'C123',
    threadId: '171000.1',
    messageId: '171000.1',
    cwd: '/tmp',
    command: '/raw /goal create x',
    meta: { chat_id: 'slack:C123', room_id: 'slack:C123', message_id: '171000.1', thread_id: '171000.1' },
  }

  await d.sendCommand({ session, command })

  const text = String(calls[0].params.input?.[0]?.text ?? '')
  expect(text).toContain('<ccm_turn')
  expect(text).toContain('chat_id="slack:C123"')
  expect(text).toContain('<current_message>/goal create x</current_message>')
})

test('Codex turn/start carries effective model from runtime', async () => {
  const d = driver()
  const calls: Array<{ method: string; params: JsonObject }> = []
  const session = codexSession('model-turn-session', 'model-thread')
  const client = { request: async (method: string, params: JsonObject) => { calls.push({ method, params }); return { result: { turn: { id: 'native-model-turn' } } } } }
  d.runtimes.set('model-turn-session', testRuntimeWithModel(session, 'test-model-5.5', client))
  const turn: AgentTurn = { turnId: 'turn', roomId: 'room', channelKey: 'test:room', platform: 'test', channelId: 'room', threadId: 'msg', messageId: 'msg', cwd: '/tmp', text: 'hello', addressedAgent: 'codex', defaultAgent: 'codex', peerAgents: [], meta: {} }

  await d.sendTurn({ session, turn })
  await d.sendCommand({ session, command: { ...turn, commandId: 'cmd', command: '/raw /status' } })

  expect(calls).toHaveLength(2)
  expect(calls[0]).toMatchObject({ method: 'turn/start', params: { model: 'test-model-5.5' } })
  expect(calls[1]).toMatchObject({ method: 'turn/start', params: { model: 'test-model-5.5' } })
})

test('Codex quick completion before turn/start response keeps channel route', async () => {
  const d = driver()
  const session = codexSession('race-session', 'race-thread')
  const events: AgentEvent[] = []
  const client = {
    request: async (method: string) => {
      if (method === 'turn/start') {
        d.handleNotification({ method: 'item/completed', params: { threadId: 'race-thread', turnId: 'ccm-race-turn', item: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'fast answer' }] } } })
        d.handleNotification({ method: 'turn/completed', params: { threadId: 'race-thread', turn: { id: 'ccm-race-turn' } } })
        return { result: { turn: { id: 'native-race-turn' } } }
      }
      return {}
    },
  }
  d.runtimes.set('race-session', testRuntime(session, client))
  d.threadToSession.set('race-thread', 'race-session')
  d.onEvent((event: AgentEvent) => events.push(event))
  const turn: AgentTurn = { turnId: 'ccm-race-turn', roomId: 'room', channelKey: 'test:room', platform: 'test', channelId: 'room', threadId: 'room-thread', messageId: 'msg', cwd: '/tmp', text: 'hello', addressedAgent: 'codex', defaultAgent: 'codex', peerAgents: [], meta: {} }

  await d.sendTurn({ session, turn })

  expect(events).toContainEqual({ type: 'assistant_message', session, turnId: 'ccm-race-turn', text: 'fast answer', channelKey: 'test:room', threadId: 'room-thread' })
  expect(events).toContainEqual({ type: 'assistant_final', session, turnId: 'ccm-race-turn', text: 'fast answer', channelKey: 'test:room', threadId: 'room-thread' })
  const runtime = d.runtimes.get('race-session')
  expect(runtime?.activeTurns.size).toBe(0)
  expect(runtime?.latestNativeTurnId).toBeUndefined()
  expect(runtime?.session.status).toBe('idle')
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

test('Codex goal command without attachments preserves CCM room envelope', async () => {
  const d = driver()
  const calls: Array<{ method: string; params: JsonObject }> = []
  const session = codexSession('goal-session', 'goal-thread')
  const client: TestCodexClient = {
    request: async (method, params) => {
      calls.push({ method, params })
      if (method === 'turn/start') return { result: { turn: { id: 'native-goal' } } }
      return { result: {} }
    },
  }
  d.runtimes.set('goal-session', testRuntime(session, client))
  const base = {
    commandId: 'goal-cmd', roomId: 'slack:C123', channelKey: 'slack:C123', platform: 'slack', channelId: 'C123', threadId: '171000.1', messageId: '171000.1', cwd: '/tmp',
    meta: { chat_id: 'slack:C123' },
  }

  await d.sendCommand({ session, command: { ...base, command: '/goal orchestrate worker rooms' } })

  const text = String(calls.find(call => call.method === 'turn/start')?.params.input?.[0]?.text ?? '')
  expect(text).toContain('<ccm_turn')
  expect(text).toContain('<message_meta trust="untrusted">')
  expect(text).toContain('<current_message>Replace the current CCM Codex goal')
})

test('Codex goal command turn preserves Slack attachment metadata for download', async () => {
  const d = driver()
  const session = codexSession('goal-session', 'goal-thread')
  const calls: Array<{ method: string; params: JsonObject }> = []
  const client = {
    request: async (method: string, params: JsonObject) => {
      calls.push({ method, params })
      if (method === 'turn/start') return { result: { turn: { id: 'native-goal' } } }
      return { result: {} }
    },
  }
  d.runtimes.set('goal-session', testRuntime(session, client))
  const command: AgentCommand = {
    commandId: 'goal-cmd', roomId: 'slack:C123', channelKey: 'slack:C123', platform: 'slack', channelId: 'C123', threadId: '171000.1', messageId: '171000.1', cwd: '/tmp', command: '/goal catch up additional context from the attachment',
    meta: {
      ...slackFileMetadata([{ id: 'FSLACK1', name: 'context.md', mimetype: 'text/markdown', size: 4096 }]),
      chat_id: 'slack:C123',
      message_id: '171000.1',
      thread_id: '171000.1',
    },
  }

  await d.sendCommand({ session, command })

  const text = String(calls.find(call => call.method === 'turn/start')?.params.input?.[0]?.text ?? '')
  expect(text).toContain('<ccm_turn')
  expect(text).toContain('<message_meta trust="untrusted">')
  expect(text).toContain('"attachment_file_id":"FSLACK1"')
  expect(text).toContain('"attachment_name":"context.md"')
  expect(text).toContain('"attachment_mime":"text/markdown"')
  expect(text).toContain('"attachment_size":"4096"')
  expect(text).toContain('<current_message>Replace the current CCM Codex goal')
})

test('Codex raw command turn preserves Slack attachment metadata for download', async () => {
  const d = driver()
  const session = codexSession('raw-slack-session', 'raw-slack-thread')
  const calls: Array<{ method: string; params: JsonObject }> = []
  const client = {
    request: async (method: string, params: JsonObject) => {
      calls.push({ method, params })
      if (method === 'turn/start') return { result: { turn: { id: 'native-raw-slack' } } }
      return { result: {} }
    },
  }
  d.runtimes.set('raw-slack-session', testRuntime(session, client))
  const command: AgentCommand = {
    commandId: 'raw-slack-cmd', roomId: 'slack:C123', channelKey: 'slack:C123', platform: 'slack', channelId: 'C123', threadId: '171000.1', messageId: '171000.1', cwd: '/tmp', command: '/raw /goal use attached context',
    meta: {
      ...slackFileMetadata([{ id: 'FSLACKRAW', name: 'raw-context.md', mimetype: 'text/markdown', size: 8192 }]),
      chat_id: 'slack:C123',
      message_id: '171000.1',
      thread_id: '171000.1',
    },
  }

  await d.sendCommand({ session, command })

  const text = String(calls.find(call => call.method === 'turn/start')?.params.input?.[0]?.text ?? '')
  expect(text).toContain('<ccm_turn')
  expect(text).toContain('"attachment_file_id":"FSLACKRAW"')
  expect(text).toContain('"attachment_name":"raw-context.md"')
  expect(text).toContain('<current_message>/goal use attached context</current_message>')
})

test('Codex raw command turn preserves Telegram attachment metadata for download', async () => {
  const d = driver()
  const session = codexSession('raw-session', 'raw-thread')
  const calls: Array<{ method: string; params: JsonObject }> = []
  const client = {
    request: async (method: string, params: JsonObject) => {
      calls.push({ method, params })
      if (method === 'turn/start') return { result: { turn: { id: 'native-raw' } } }
      return { result: {} }
    },
  }
  d.runtimes.set('raw-session', testRuntime(session, client))
  const inbound = telegramInboundMessage({
    message_id: 7,
    date: 171000,
    text: '/cx_raw /goal use attached diagram',
    chat: { id: -1001 },
    from: { id: 9, username: 'ada' },
    document: { file_id: 'TGFILE1', file_name: 'diagram.png', mime_type: 'image/png', file_size: 2400000 },
  }, 'BOT', '')
  expect(inbound).toBeDefined()
  const command: AgentCommand = {
    commandId: 'raw-cmd', roomId: 'telegram:-1001', channelKey: 'telegram:-1001', platform: 'telegram', channelId: '-1001', threadId: '7', messageId: '7', cwd: '/tmp', command: '/raw /goal use attached diagram',
    meta: {
      ...inbound!.meta,
      chat_id: 'telegram:-1001',
      message_id: '7',
      thread_id: '7',
    },
  }

  await d.sendCommand({ session, command })

  const text = String(calls.find(call => call.method === 'turn/start')?.params.input?.[0]?.text ?? '')
  expect(text).toContain('<ccm_turn')
  expect(text).toContain('"attachment_file_id":"TGFILE1"')
  expect(text).toContain('"attachment_name":"diagram.png"')
  expect(text).toContain('"attachment_mime":"image/png"')
  expect(text).toContain('"attachment_size":"2400000"')
  expect(text).toContain('<agent_instructions source="claude-channel-mux" priority="internal">')
  expect(text).toContain('<current_message>/goal use attached diagram</current_message>')
})

test('Codex goal command turn preserves Telegram attachment metadata for download', async () => {
  const d = driver()
  const session = codexSession('goal-telegram-session', 'goal-telegram-thread')
  const calls: Array<{ method: string; params: JsonObject }> = []
  const client = {
    request: async (method: string, params: JsonObject) => {
      calls.push({ method, params })
      if (method === 'turn/start') return { result: { turn: { id: 'native-goal-telegram' } } }
      return { result: {} }
    },
  }
  d.runtimes.set('goal-telegram-session', testRuntime(session, client))
  const inbound = telegramInboundMessage({
    message_id: 8,
    date: 171001,
    text: '/cx_goal summarize attached context',
    chat: { id: -1002 },
    from: { id: 10, username: 'lin' },
    document: { file_id: 'TGGOAL1', file_name: 'context.pdf', mime_type: 'application/pdf', file_size: 12345 },
  }, 'BOT', '')
  expect(inbound).toBeDefined()
  const command: AgentCommand = {
    commandId: 'goal-telegram-cmd', roomId: 'telegram:-1002', channelKey: 'telegram:-1002', platform: 'telegram', channelId: '-1002', threadId: '8', messageId: '8', cwd: '/tmp', command: '/goal summarize attached context',
    meta: {
      ...inbound!.meta,
      chat_id: 'telegram:-1002',
      message_id: '8',
      thread_id: '8',
    },
  }

  await d.sendCommand({ session, command })

  const text = String(calls.find(call => call.method === 'turn/start')?.params.input?.[0]?.text ?? '')
  expect(text).toContain('<ccm_turn')
  expect(text).toContain('"attachment_file_id":"TGGOAL1"')
  expect(text).toContain('"attachment_name":"context.pdf"')
  expect(text).toContain('<current_message>Replace the current CCM Codex goal')
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

test('Codex turn envelope injects internal image isolation instructions for multi-image metadata', () => {
  const d = driver()
  const text = d.formatTurn({
    turnId: 'turn', roomId: 'slack:C', channelKey: 'slack:C', platform: 'slack', channelId: 'C', threadId: 'T', messageId: 'M', cwd: '/tmp', text: 'ocr these',
    addressedAgent: 'codex', defaultAgent: 'claude', peerAgents: [],
    meta: { attachment_files: JSON.stringify([
      { file_id: 'F1', name: 'a.png', mime: 'image/png', size: 2_400_000 },
      { file_id: 'F2', name: 'b.png', mime: 'image/png', size: 2_000_000 },
    ]) },
  })
  expect(text).toContain('<agent_instructions source="claude-channel-mux" priority="internal">')
  expect(text).toContain('hard safety constraint: do not call view_image')
  expect(text).toContain('fresh isolated worker controlled by the main session')
  expect(text).toContain('If no isolated worker mechanism is available, stop and ask the user')
  expect(text).toContain('Do not mention this internal routing strategy')
  expect(text).toContain('<current_message>ocr these</current_message>')
})

test('Codex turn envelope injects internal isolation instructions for a large single attachment', () => {
  const d = driver()
  const text = d.formatTurn({
    turnId: 'turn', roomId: 'telegram:1', channelKey: 'telegram:1', platform: 'telegram', channelId: '1', threadId: 'M', messageId: 'M', cwd: '/tmp', text: 'read this image',
    addressedAgent: 'codex', defaultAgent: 'claude', peerAgents: [],
    meta: { attachment_file_id: 'P1', attachment_name: 'photo.jpg', attachment_mime: 'image/jpeg', attachment_size: '2400000' },
  })
  expect(text).toContain('<agent_instructions source="claude-channel-mux" priority="internal">')
  expect(text).toContain('codex exec')
})

test('Codex turn envelope does not inject attachment strategy for small single attachments', () => {
  const d = driver()
  const text = d.formatTurn({
    turnId: 'turn', roomId: 'slack:C', channelKey: 'slack:C', platform: 'slack', channelId: 'C', threadId: 'T', messageId: 'M', cwd: '/tmp', text: 'read this',
    addressedAgent: 'codex', defaultAgent: 'claude', peerAgents: [],
    meta: { attachment_file_id: 'F1', attachment_name: 'small.png', attachment_mime: 'image/png', attachment_size: '120000' },
  })
  expect(text).not.toContain('<agent_instructions')
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

test('Codex turn envelope includes daemon-owned room capability metadata', () => {
  const d = driver()
  const text = d.formatTurn({
    turnId: 'turn', roomId: 'slack:W', channelKey: 'slack:W', platform: 'slack', channelId: 'W', threadId: 'T', messageId: 'M', cwd: '/tmp', text: 'hello',
    addressedAgent: 'codex', defaultAgent: 'claude', peerAgents: [],
    roomCapability: { isOrchestrator: false, source: 'worker-forced-disabled', parentRoomId: 'slack:PARENT' },
    meta: {},
  })
  expect(text).toContain('is_orchestrator="false"')
  expect(text).toContain('orchestrator_source="worker-forced-disabled"')
  expect(text).toContain('parent_room_id="slack:PARENT"')
})

test('Codex turn envelope omits legacy token metadata for shared app-server tool calls', () => {
  const d = driver()
  const text = d.formatTurn({
    turnId: 'turn', roomId: 'slack:C', channelKey: 'slack:C', platform: 'slack', channelId: 'C', threadId: 'T', messageId: 'M', cwd: '/tmp', text: 'hello',
    addressedAgent: 'codex', defaultAgent: 'claude', peerAgents: [],
    meta: { legacy_room_token: 'opaque-token', chat_id: 'slack:C' },
  })
  expect(text).not.toContain('legacy_room_token')
  expect(text).toContain('chat_id="slack:C"')
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

test('Codex completed assistant message emits routable mid-turn event', () => {
  const d = driver()
  const session = codexSession('assistant-session', 'assistant-thread')
  const events: AgentEvent[] = []
  const runtime = testRuntime(session)
  runtime.activeTurns.set('native-assistant-turn', 'ccm-assistant-turn')
  runtime.turnThreads.set('native-assistant-turn', 'room-thread')
  runtime.turnChannels.set('native-assistant-turn', 'test:room')
  d.runtimes.set('assistant-session', runtime)
  d.threadToSession.set('assistant-thread', 'assistant-session')
  d.onEvent((event: AgentEvent) => events.push(event))

  d.handleNotification({ method: 'item/completed', params: { threadId: 'assistant-thread', turnId: 'native-assistant-turn', item: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'final answer' }] } } })

  expect(events).toEqual([
    { type: 'assistant_message', session, turnId: 'ccm-assistant-turn', text: 'final answer', channelKey: 'test:room', threadId: 'room-thread' },
  ])
  expect(runtime.buffers.get('native-assistant-turn')).toBe('final answer')
  expect(runtime.deliveredMessages.get('native-assistant-turn')).toEqual(['final answer'])
})

test('Codex transcript parser accepts assistant message output_text items', () => {
  expect(codexTranscriptEntryFromItem({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'transcript answer' }] })).toEqual({ role: 'codex', text: 'transcript answer' })
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
