import { readFileSync } from 'fs'
import type { AgentCommandResult, AgentCommandSpec, AgentDriver, AgentEvent, AgentPlanStep, AgentSession, AgentSnapshot, AgentSnapshotPendingItem, AgentTranscript, AgentTurn, GetSnapshotInput, GetTranscriptInput, ResolveServerRequestInput, ResumeAgentInput, SendCommandInput, SendTurnInput, StartAgentInput } from '../types.js'
import { CodexAppServerClient, jsonObject, parseAppServerMessage, type JsonObject } from './app-server-client.js'
import { errorMessage, redactSensitiveText } from '../../redact.js'
import { codexConfigWithModelOverride, codexDangerFullAccess, codexResolvedConfigFromEnv, type CodexResolvedConfig } from './config.js'

export type CodexAppServerDriverOptions = {
  codexCommand: string[]
  daemonSock: string
  mcpServerPath: string
  baseEnv: NodeJS.ProcessEnv
  codexConfig?: CodexResolvedConfig
  appServerListen?: 'stdio' | 'websocket'
  log?: (line: string) => void
}

function codexTurnSandboxPolicy(cwd: string, config: CodexResolvedConfig): JsonObject {
  if (codexDangerFullAccess(config)) return { type: 'dangerFullAccess' }
  return {
    type: 'workspaceWrite',
    writableRoots: [cwd],
    networkAccess: false,
    excludeTmpdirEnvVar: false,
    excludeSlashTmp: false,
  }
}

type CodexRuntime = {
  session: AgentSession
  modelOverride?: string
  effectiveModel?: string
  config: CodexResolvedConfig
  client: CodexAppServerClient
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

type TranscriptEntry = { role: string; text: string }

function jsonObjectArray(value: unknown): JsonObject[] {
  if (!Array.isArray(value)) return []
  return value.flatMap(item => {
    const object = jsonObject(item)
    return object ? [object] : []
  })
}

function jsonObjectOrEmpty(value: unknown): JsonObject {
  return jsonObject(value) ?? {}
}

function codexJsonErrorMessage(value: unknown): string {
  if (value instanceof Error) return errorMessage(value)
  if (typeof value === 'string') return redactSensitiveText(value)
  const encoded = JSON.stringify(value ?? 'unknown error')
  return errorMessage(encoded === undefined ? 'unknown error' : encoded)
}

function codexErrorResponse(error: unknown): JsonObject {
  return { error: codexJsonErrorMessage(error) }
}

function codexRequestError(response: unknown): string | undefined {
  const error = jsonObject(response)?.error
  return error === undefined ? undefined : codexJsonErrorMessage(error)
}

function codexEventErrorMessage(primary: unknown, fallback: unknown): string {
  if (primary instanceof Error) return errorMessage(primary)
  if (typeof primary === 'string') return redactSensitiveText(primary)
  return codexJsonErrorMessage(primary ?? fallback)
}

function textFromTextBlocks(value: unknown): string {
  if (!Array.isArray(value)) return ''
  return value.map(block => {
    const obj = jsonObject(block)
    return typeof obj?.text === 'string' ? obj.text : ''
  }).filter(Boolean).join('\n').trim()
}

function joinedStrings(value: unknown): string {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').join('\n').trim() : ''
}

function responseResult(value: unknown): JsonObject | undefined {
  return jsonObject(jsonObject(value)?.result)
}

export function codexResponseObject(value: unknown, key: string): JsonObject | undefined {
  return jsonObject(responseResult(value)?.[key])
}

export function codexResponseArray(value: unknown, key: string): JsonObject[] {
  const array = responseResult(value)?.[key]
  return jsonObjectArray(array)
}

export function codexNativeTurnId(value: unknown, fallback: string): string {
  const turn = codexResponseObject(value, 'turn')
  return typeof turn?.id === 'string' ? turn.id : fallback
}

export function codexTranscriptEntryFromItem(raw: unknown, fallbackType?: unknown): TranscriptEntry | undefined {
  const item = jsonObject(raw)
  if (!item) return undefined
  const type = String(item.type ?? fallbackType ?? '')
  if (type === 'userMessage') {
    const text = textFromTextBlocks(item.content)
    return text ? { role: 'user', text } : undefined
  }
  if (type === 'agentMessage' && typeof item.text === 'string') return { role: 'codex', text: item.text }
  if (type === 'plan' && typeof item.text === 'string') return { role: 'plan', text: item.text }
  if (type === 'reasoning') {
    const text = (joinedStrings(item.summary) || joinedStrings(item.content)).trim()
    return text ? { role: 'reasoning', text } : undefined
  }
  if (/commandExecution|fileChange|mcpToolCall|tool/i.test(type)) {
    const text = [type, typeof item.status === 'string' ? item.status : undefined, typeof item.command === 'string' ? item.command : undefined, typeof item.text === 'string' ? item.text : undefined].filter(Boolean).join(': ')
    return text ? { role: 'tool', text } : undefined
  }
  return undefined
}

export function codexEntriesFromTurns(turns: unknown): TranscriptEntry[] {
  if (!Array.isArray(turns)) return []
  const entries: TranscriptEntry[] = []
  for (const turn of turns) {
    const obj = jsonObject(turn)
    const items = Array.isArray(obj?.items) ? obj.items : []
    for (const item of items) {
      const entry = codexTranscriptEntryFromItem(item)
      if (entry) entries.push(entry)
    }
  }
  return entries
}

export class CodexAppServerAgentDriver implements AgentDriver {
  readonly kind = 'codex' as const
  private runtimes = new Map<string, CodexRuntime>()
  private threadToSession = new Map<string, string>()
  private listeners = new Set<(event: AgentEvent) => void>()
  private readonly baseConfig: CodexResolvedConfig

  constructor(private opts: CodexAppServerDriverOptions) {
    this.baseConfig = opts.codexConfig ?? { ...codexResolvedConfigFromEnv(opts.baseEnv), command: opts.codexCommand }
  }

  onEvent(cb: (event: AgentEvent) => void): void {
    this.listeners.add(cb)
  }

  async start(input: StartAgentInput): Promise<AgentSession> {
    return await this.createRuntime(input.sessionId, input.cwd, undefined, input.options?.model)
  }

  async resume(input: ResumeAgentInput): Promise<AgentSession> {
    return await this.createRuntime(input.sessionId, input.cwd, input.nativeSessionId, input.options?.model)
  }

  setModelOverride(sessionId: string, model?: string): void {
    const runtime = this.runtimes.get(sessionId)
    if (runtime) runtime.modelOverride = model
  }

  commandSpec(): AgentCommandSpec {
    return {
      rawPassthrough: 'experimental',
      rawPassthroughWarning: 'Raw Codex slash-shaped turns are not guaranteed to match Codex CLI. Use `/cx raw /command ...` to opt in.',
      capabilities: [
        { name: 'ss', status: 'supported', summary: 'Show Codex thread/config/pending snapshot; pending requests include action buttons and target id.', aliases: ['screen'] },
        { name: 'nav', status: 'supported', summary: 'Show pending actions, or resolve one with `/cx nav N allow|session|policy|network|deny|abort|answer <text>`.' },
        { name: 'transcript', status: 'supported', summary: 'Show recent Codex transcript from app-server, with jsonl fallback.' },
        { name: 'status', status: 'supported', summary: 'Show loaded Codex thread/config status.' },
        { name: 'compact', status: 'supported', summary: 'Start Codex app-server compaction.' },
        { name: 'cancel', status: 'supported', summary: 'Interrupt the latest Codex turn.', aliases: ['stop', 'interrupt'] },
        { name: 'mcp', status: 'supported', summary: 'List Codex MCP servers reported by app-server.' },
        { name: 'model', status: 'supported', summary: 'Show or set this CCM room’s Codex model override.' },
        { name: 'goal', status: 'supported', summary: 'Replace the current Codex goal by interrupting any active turn and starting a new goal turn.' },
        { name: 'raw', status: 'experimental', summary: 'Explicitly send a slash-shaped turn to Codex for source-aligned experiments.' },
      ],
    }
  }

  async sendTurn(input: SendTurnInput): Promise<string> {
    const runtime = this.runtimes.get(input.session.sessionId)
    if (!runtime) throw new Error(`No Codex app-server runtime for ${input.session.sessionId}`)
    const response = await runtime.client.request('turn/start', {
      threadId: runtime.threadId,
      input: [{ type: 'text', text: this.formatTurn(input.turn), text_elements: [] }],
      cwd: input.turn.cwd,
      ...(runtime.effectiveModel ? { model: runtime.effectiveModel } : {}),
      approvalPolicy: runtime.config.approvalPolicy,
      sandboxPolicy: codexTurnSandboxPolicy(input.turn.cwd, runtime.config),
    }, 120_000)
    const nativeTurnId = codexNativeTurnId(response, input.turn.turnId)
    runtime.activeTurns.set(nativeTurnId, input.turn.turnId)
    runtime.turnThreads.set(nativeTurnId, input.turn.threadId)
    runtime.turnChannels.set(nativeTurnId, input.turn.channelKey)
    runtime.latestNativeTurnId = nativeTurnId
    runtime.session.status = 'running'
    this.emit({ type: 'status', session: runtime.session, status: 'running' })
    return nativeTurnId
  }


  async sendCommand(input: SendCommandInput): Promise<AgentCommandResult> {
    const runtime = this.runtimes.get(input.session.sessionId)
    if (!runtime) throw new Error(`No Codex app-server runtime for ${input.session.sessionId}`)
    const command = input.command.command.trim().replace(/^\//, '')
    const [nameRaw, ...rest] = command.split(/\s+/)
    const name = (nameRaw ?? '').toLowerCase()
    const args = rest.join(' ')
    const commandId = input.command.commandId

    if (!name || name === 'help') {
      return { commandId, display: this.commandHelp() }
    }

    if (name === 'status') {
      const status = await this.codexStatus(runtime, input.command.cwd)
      return { commandId, display: status }
    }

    if (name === 'compact') {
      await runtime.client.request('thread/compact/start', { threadId: runtime.threadId }, 60_000)
      return { commandId, display: 'Codex compact started.' }
    }

    if (name === 'stop' || name === 'interrupt' || name === 'cancel') {
      const turnId = runtime.latestNativeTurnId ?? [...runtime.activeTurns.keys()][0]
      if (!turnId) return { commandId, display: 'No active Codex turn to interrupt.' }
      await runtime.client.request('turn/interrupt', { threadId: runtime.threadId, turnId }, 15_000)
      return { commandId, nativeCommandId: turnId, display: `Interrupted Codex turn ${turnId}.` }
    }

    if (name === 'mcp') {
      const response = await runtime.client.request('mcpServerStatus/list', { limit: 50, detail: 'full' }, 30_000)
      const data = codexResponseArray(response, 'data')
      const lines = data.map(server => {
        const label = String(server.name ?? server.id ?? 'unknown')
        const status = String(server.status ?? server.startupStatus ?? server.state ?? 'unknown')
        return `- ${label}: ${status}`
      })
      return { commandId, display: lines.length ? `Codex MCP servers:\n${lines.join('\n')}` : 'No Codex MCP servers reported.' }
    }

    if (name === 'model') {
      if (!args) {
        const response = await runtime.client.request('config/read', { includeLayers: false, cwd: input.command.cwd }, 30_000)
        const config = codexResponseObject(response, 'config')
        return { commandId, display: `Codex model: ${String(runtime.modelOverride ?? config?.model ?? 'config default')}${runtime.modelOverride ? ' (CCM room override)' : ''}` }
      }
      runtime.modelOverride = args
      return { commandId, display: `Codex model override for this CCM room set to \`${args}\`. Restart or resume the Codex slot for it to take effect; global Codex config was not changed.` }
    }

    if (name === 'goal') {
      const goal = args.trim()
      if (!goal) return { commandId, display: 'Usage: `/cx goal <new goal>` interrupts any active Codex turn and starts a replacement goal turn.' }
      const interrupted = runtime.latestNativeTurnId ?? [...runtime.activeTurns.keys()][0]
      if (interrupted) {
        await runtime.client.request('turn/interrupt', { threadId: runtime.threadId, turnId: interrupted }, 15_000).catch(() => ({}))
      }
      const nativeTurnId = await this.startPlainTurn(runtime, input.command, [
        'Replace the current CCM Codex goal with the following goal. Stop pursuing the previous goal unless it is directly needed for this replacement.',
        '',
        goal,
      ].join('\n'))
      return { commandId, nativeCommandId: nativeTurnId, display: interrupted ? `Replacing Codex goal; interrupted active turn ${interrupted}.` : 'Replacing Codex goal.' }
    }

    if (name === 'raw') {
      if (!args.trim()) return { commandId, display: 'Usage: `/cx raw /command ...` sends an experimental slash-shaped Codex turn.' }
      return await this.sendSlashCommandAsTurn(runtime, { ...input.command, command: args.trim().startsWith('/') ? args.trim() : `/${args.trim()}` })
    }

    return {
      commandId,
      display: [
        `Unsupported Codex command: \`/cx ${command}\`.`,
        'CCM only proxies source-aligned Codex controls by default to avoid a fake TUI mismatch.',
        'Use `/cx help` for supported commands, or `/cx raw /command ...` to explicitly try an experimental raw Codex turn.',
      ].join('\n'),
    }
  }




  async transcript(input: GetTranscriptInput): Promise<AgentTranscript> {
    const runtime = this.runtimes.get(input.session.sessionId)
    const limit = input.limit ?? 50
    if (!runtime) {
      return { kind: 'codex', session: input.session, source: 'partial', entries: [] }
    }
    const read = await runtime.client.request('thread/read', { threadId: runtime.threadId, includeTurns: true }, 30_000).catch(codexErrorResponse)
    const thread = codexResponseObject(read, 'thread')
    const turns = jsonObjectArray(thread?.turns)
    const entries = this.entriesFromTurns(turns).slice(-limit)
    if (entries.length > 0) return { kind: 'codex', session: runtime.session, source: 'live', path: typeof thread?.path === 'string' ? thread.path : undefined, entries }
    const fallbackRead = await runtime.client.request('thread/read', { threadId: runtime.threadId, includeTurns: false }, 30_000).catch(() => ({}))
    const meta = thread ?? codexResponseObject(fallbackRead, 'thread')
    const path = typeof meta?.path === 'string' ? meta.path : undefined
    return { kind: 'codex', session: runtime.session, source: path ? 'transcript' : 'partial', path, entries: path ? this.readTranscriptRecent(path, limit) : [] }
  }

  async snapshot(input: GetSnapshotInput): Promise<AgentSnapshot> {
    const runtime = this.runtimes.get(input.session.sessionId)
    if (!runtime) {
      return {
        kind: 'codex',
        session: input.session,
        source: 'partial',
        title: 'Codex snapshot',
        cwd: input.cwd,
        status: 'missing runtime',
        pending: [],
        recent: [],
        health: ['Codex app-server runtime is not loaded. Use resume or send a Codex turn to start it.'],
      }
    }
    const [threadWithTurnsRes, configRes] = await Promise.all([
      runtime.client.request('thread/read', { threadId: runtime.threadId, includeTurns: true }, 30_000).catch(codexErrorResponse),
      runtime.client.request('config/read', { includeLayers: false, cwd: input.cwd }, 30_000).catch(codexErrorResponse),
    ])
    const threadWithTurnsError = codexRequestError(threadWithTurnsRes)
    const threadFallbackRes = threadWithTurnsError
      ? await runtime.client.request('thread/read', { threadId: runtime.threadId, includeTurns: false }, 30_000).catch(codexErrorResponse)
      : threadWithTurnsRes
    const thread = codexResponseObject(threadWithTurnsRes, 'thread') ?? codexResponseObject(threadFallbackRes, 'thread')
    const config = codexResponseObject(configRes, 'config')
    const turns = Array.isArray(codexResponseObject(threadWithTurnsRes, 'thread')?.turns)
      ? jsonObjectArray(codexResponseObject(threadWithTurnsRes, 'thread')?.turns)
      : []
    const recent = this.entriesFromTurns(turns.slice(-6))
    if (recent.length === 0 && typeof thread?.path === 'string') recent.push(...this.readTranscriptRecent(thread.path, 8))
    const current = recent.length ? `${recent[recent.length - 1].role}: ${recent[recent.length - 1].text}` : undefined
    const pending: AgentSnapshotPendingItem[] = [...runtime.pendingRequestDetails.entries()].map(([id, req]) => this.snapshotPendingItem(id, req.method, req.params))
    const health: string[] = []
    if (threadWithTurnsError && !threadWithTurnsError.includes('includeTurns is unavailable before first user message')) health.push(`thread/read turns: ${threadWithTurnsError}`)
    const threadFallbackError = codexRequestError(threadFallbackRes)
    const configError = codexRequestError(configRes)
    if (threadFallbackError) health.push(`thread/read metadata: ${threadFallbackError}`)
    if (configError) health.push(`config/read: ${configError}`)
    const threadStatus = thread?.status ? JSON.stringify(thread.status) : 'unknown'
    return {
      kind: 'codex',
      session: runtime.session,
      source: thread ? 'live' : 'partial',
      title: 'Codex snapshot',
      cwd: runtime.session.cwd,
      model: typeof config?.model === 'string' ? config.model : undefined,
      status: `${runtime.session.status}; thread ${threadStatus}`,
      threadId: runtime.threadId,
      activeTurnCount: runtime.activeTurns.size,
      current,
      pending,
      recent: recent.slice(-8),
      health,
    }
  }

  async resolveServerRequest(input: ResolveServerRequestInput): Promise<void> {
    const runtime = this.runtimes.get(input.session.sessionId)
    if (!runtime) throw new Error(`No Codex app-server runtime for ${input.session.sessionId}`)
    const numericId = runtime.pendingRequests.get(input.requestId)
    if (numericId === undefined) throw new Error(`No pending Codex request ${input.requestId}`)
    runtime.pendingRequests.delete(input.requestId)
    runtime.pendingRequestDetails.delete(input.requestId)
    runtime.client.respond(numericId, input.result ? jsonObjectOrEmpty(input.result) : undefined, input.error ? jsonObjectOrEmpty(input.error) : undefined)
  }

  async cancel(session: AgentSession, turnId: string): Promise<void> {
    const runtime = this.runtimes.get(session.sessionId)
    if (!runtime) return
    await runtime.client.request('turn/interrupt', { threadId: runtime.threadId, turnId }, 15_000)
  }

  async stop(session: AgentSession): Promise<void> {
    const runtime = this.runtimes.get(session.sessionId)
    if (!runtime) return
    await runtime.client.stop()
    runtime.session.status = 'stopped'
    this.emit({ type: 'status', session: runtime.session, status: 'stopped' })
    this.threadToSession.delete(runtime.threadId)
    this.runtimes.delete(session.sessionId)
  }

  private async createRuntime(sessionId: string, cwd: string, nativeSessionId?: string, modelOverride?: string): Promise<AgentSession> {
    const existing = this.runtimes.get(sessionId)
    if (existing) {
      if (modelOverride) existing.modelOverride = modelOverride
      return existing.session
    }

    const runtimeConfig = codexConfigWithModelOverride(this.baseConfig, modelOverride)
    const effectiveModel = runtimeConfig.model
    const client = new CodexAppServerClient({
      codexCommand: [...runtimeConfig.command, ...runtimeConfig.launchArgs],
      cwd,
      env: {
        ...this.opts.baseEnv,
        CODEX_HOME: runtimeConfig.home,
        DISABLE_AUTOUPDATER: '1',
        CC_CHANNEL_SESSION_UUID: sessionId,
        CODEX_CHANNEL_SESSION_UUID: sessionId,
        CC_CHANNEL_DAEMON_SOCK: this.opts.daemonSock,
      },
      listen: this.opts.appServerListen ?? runtimeConfig.appServerListen,
      configArgs: this.configArgs(sessionId),
      stderr: line => this.opts.log?.(`[codex:${sessionId.slice(0, 8)}] ${line}`),
      notification: msg => this.handleNotification(msg),
      serverRequest: msg => this.handleServerRequest(msg),
    })
    let started = false
    try {
      await client.start()
      started = true
      const response = nativeSessionId && !effectiveModel
        ? await client.request('thread/resume', { threadId: nativeSessionId }, 60_000)
        : await client.request('thread/start', {
        cwd,
        ...(effectiveModel ? { model: effectiveModel } : {}),
        approvalPolicy: runtimeConfig.approvalPolicy,
        sandbox: runtimeConfig.sandbox,
      }, 60_000)
      const thread = codexResponseObject(response, 'thread')
      const threadId = typeof thread?.id === 'string' ? thread.id : nativeSessionId
      if (!threadId) throw new Error('codex app-server did not return a thread id')
      const session: AgentSession = {
        kind: 'codex',
        sessionId,
        nativeSessionId: threadId,
        transport: 'codex-app-server',
        cwd,
        status: 'idle',
        capabilities: { streaming: true, cancel: true, resume: true, toolCalling: true },
        meta: { appServerUrl: client.url() },
      }
      this.runtimes.set(sessionId, { session, modelOverride, effectiveModel, config: runtimeConfig, client, threadId, activeTurns: new Map(), turnThreads: new Map(), turnChannels: new Map(), buffers: new Map(), deliveredMessages: new Map(), pendingRequests: new Map(), pendingRequestDetails: new Map() })
      this.threadToSession.set(threadId, sessionId)
      this.emit({ type: 'status', session, status: 'idle' })
      return session
    } catch (err) {
      if (started) await client.stop().catch(stopErr => this.opts.log?.(`codex app-server cleanup failed after startup error for ${sessionId.slice(0, 8)}: ${errorMessage(stopErr)}`))
      throw err
    }
  }

  private configArgs(sessionId: string): string[] {
    const args = [
      '-c', 'mcp_servers.claude-channel-mux.command="bun"',
      '-c', `mcp_servers.claude-channel-mux.args=${JSON.stringify([this.opts.mcpServerPath])}`,
      '-c', `mcp_servers.claude-channel-mux.env.CC_CHANNEL_SESSION_UUID=${JSON.stringify(sessionId)}`,
      '-c', `mcp_servers.claude-channel-mux.env.CODEX_CHANNEL_SESSION_UUID=${JSON.stringify(sessionId)}`,
      '-c', `mcp_servers.claude-channel-mux.env.CC_CHANNEL_DAEMON_SOCK=${JSON.stringify(this.opts.daemonSock)}`,
    ]
    return args
  }

  private handleServerRequest(msg: JsonObject): void {
    if (typeof msg.method !== 'string' || typeof msg.id !== 'number' || !Number.isSafeInteger(msg.id)) return
    const params = jsonObject(msg.params)
    const threadId = typeof params?.threadId === 'string'
      ? params.threadId
      : typeof params?.conversationId === 'string'
        ? params.conversationId
        : undefined
    const sessionId = threadId ? this.threadToSession.get(threadId) : undefined
    const runtime = sessionId ? this.runtimes.get(sessionId) : undefined
    if (!runtime) return
    const requestId = String(msg.id)
    const requestParams = params ?? {}
    const nativeTurnId = typeof params?.turnId === 'string' ? params.turnId : undefined
    const channelThreadId = nativeTurnId ? runtime.turnThreads.get(nativeTurnId) : undefined
    runtime.pendingRequests.set(requestId, msg.id)
    runtime.pendingRequestDetails.set(requestId, { method: msg.method, params: requestParams })
    this.emit({
      type: 'server_request',
      session: runtime.session,
      request: {
        requestId,
        method: msg.method,
        params: requestParams,
        ...(channelThreadId ? { threadId: channelThreadId } : threadId ? { threadId } : {}),
        ...(nativeTurnId ? { turnId: nativeTurnId } : {}),
      },
    })
  }

  private clearTurnState(runtime: CodexRuntime, nativeTurnId: string): { channelThreadId?: string; channelKey?: string } {
    const channelThreadId = runtime.turnThreads.get(nativeTurnId)
    const channelKey = runtime.turnChannels.get(nativeTurnId)
    runtime.buffers.delete(nativeTurnId)
    runtime.deliveredMessages.delete(nativeTurnId)
    runtime.turnThreads.delete(nativeTurnId)
    runtime.turnChannels.delete(nativeTurnId)
    runtime.activeTurns.delete(nativeTurnId)
    if (runtime.latestNativeTurnId === nativeTurnId) runtime.latestNativeTurnId = undefined
    return { channelThreadId, channelKey }
  }

  private handleNotification(msg: JsonObject): void {
    if (typeof msg.method !== 'string') return
    const params = jsonObject(msg.params)
    const threadId = typeof params?.threadId === 'string' ? params.threadId : undefined
    const sessionId = threadId ? this.threadToSession.get(threadId) : undefined
    const runtime = sessionId ? this.runtimes.get(sessionId) : undefined
    if (!runtime) return
    const nativeTurnId = typeof params?.turnId === 'string'
      ? params.turnId
      : typeof jsonObject(params?.turn)?.id === 'string'
        ? String(jsonObject(params?.turn)?.id)
        : undefined
    const turnId = nativeTurnId ? runtime.activeTurns.get(nativeTurnId) ?? nativeTurnId : undefined

    if (msg.method === 'item/agentMessage/delta') {
      const text = typeof params?.delta === 'string' ? params.delta : ''
      if (!text || !turnId || !nativeTurnId) return
      runtime.buffers.set(nativeTurnId, (runtime.buffers.get(nativeTurnId) ?? '') + text)
      this.emit({ type: 'assistant_delta', session: runtime.session, turnId, text })
      return
    }
    if (msg.method === 'item/started') {
      const item = jsonObject(params?.item)
      if (item?.type === 'contextCompaction') this.emit({ type: 'compaction', session: runtime.session, turnId, status: 'started' })
      return
    }
    if (msg.method === 'item/completed') {
      const item = jsonObject(params?.item)
      if (item?.type === 'contextCompaction') {
        this.emit({ type: 'compaction', session: runtime.session, turnId, status: 'completed' })
        return
      }
      if (item?.type === 'agentMessage' && typeof item.text === 'string' && nativeTurnId && turnId) {
        const text = item.text.trim()
        const existing = runtime.buffers.get(nativeTurnId)
        if (!existing || item.text.length > existing.length) runtime.buffers.set(nativeTurnId, item.text)
        if (text) {
          const delivered = runtime.deliveredMessages.get(nativeTurnId) ?? []
          if (!delivered.includes(text)) {
            delivered.push(text)
            runtime.deliveredMessages.set(nativeTurnId, delivered)
            this.emit({
              type: 'assistant_message',
              session: runtime.session,
              turnId,
              text,
              channelKey: runtime.turnChannels.get(nativeTurnId),
              threadId: runtime.turnThreads.get(nativeTurnId),
            })
          }
        }
      }
      return
    }
    if (msg.method === 'turn/plan/updated') {
      if (!turnId) return
      const rawPlan = jsonObjectArray(params?.plan)
      const plan: AgentPlanStep[] = rawPlan.map(step => {
        const status: AgentPlanStep['status'] = step.status === 'inProgress' || step.status === 'completed' ? step.status : 'pending'
        return { step: String(step.step ?? '').trim(), status }
      }).filter(step => step.step)
      this.emit({
        type: 'plan_updated',
        session: runtime.session,
        turnId,
        explanation: typeof params?.explanation === 'string' ? params.explanation : undefined,
        plan,
      })
      return
    }
    if (msg.method === 'turn/completed') {
      runtime.session.status = 'idle'
      this.emit({ type: 'status', session: runtime.session, status: 'idle' })
      if (!turnId || !nativeTurnId) return
      const turn = jsonObject(params?.turn)
      const error = jsonObject(turn?.error)
      const text = (runtime.buffers.get(nativeTurnId) ?? '').trim()
      const { channelThreadId, channelKey } = this.clearTurnState(runtime, nativeTurnId)
      if (error) {
        this.emit({ type: 'error', session: runtime.session, turnId, error: codexEventErrorMessage(error.message, error), channelKey, threadId: channelThreadId })
        return
      }
      if (text) this.emit({ type: 'assistant_final', session: runtime.session, turnId, text, channelKey, threadId: channelThreadId })
      return
    }
    if (msg.method === 'error') {
      runtime.session.status = 'idle'
      this.emit({ type: 'status', session: runtime.session, status: 'idle' })
      const error = jsonObject(params?.error)
      const route = nativeTurnId ? this.clearTurnState(runtime, nativeTurnId) : {}
      this.emit({ type: 'error', session: runtime.session, turnId, error: codexEventErrorMessage(error?.message, params ?? msg), channelKey: route.channelKey, threadId: route.channelThreadId })
    }
  }


  private async startPlainTurn(runtime: CodexRuntime, command: import('../types.js').AgentCommand, text: string): Promise<string> {
    const response = await runtime.client.request('turn/start', {
      threadId: runtime.threadId,
      input: [{ type: 'text', text, text_elements: [] }],
      cwd: command.cwd,
      ...(runtime.effectiveModel ? { model: runtime.effectiveModel } : {}),
      approvalPolicy: runtime.config.approvalPolicy,
      sandboxPolicy: codexTurnSandboxPolicy(command.cwd, runtime.config),
    }, 120_000)
    const nativeTurnId = codexNativeTurnId(response, command.commandId)
    runtime.activeTurns.set(nativeTurnId, command.commandId)
    runtime.turnThreads.set(nativeTurnId, command.threadId)
    runtime.turnChannels.set(nativeTurnId, command.channelKey)
    runtime.latestNativeTurnId = nativeTurnId
    runtime.session.status = 'running'
    this.emit({ type: 'status', session: runtime.session, status: 'running' })
    return nativeTurnId
  }

  private async sendSlashCommandAsTurn(runtime: CodexRuntime, command: import('../types.js').AgentCommand): Promise<AgentCommandResult> {
    const nativeTurnId = await this.startPlainTurn(runtime, command, command.command)
    return {
      commandId: command.commandId,
      nativeCommandId: nativeTurnId,
    }
  }

  private async codexStatus(runtime: CodexRuntime, cwd: string): Promise<string> {
    const [threadRes, configRes] = await Promise.all([
      runtime.client.request('thread/read', { threadId: runtime.threadId, includeTurns: false }, 30_000).catch(codexErrorResponse),
      runtime.client.request('config/read', { includeLayers: false, cwd }, 30_000).catch(codexErrorResponse),
    ])
    const thread = codexResponseObject(threadRes, 'thread')
    const config = codexResponseObject(configRes, 'config')
    const lines = [
      'Codex status:',
      `- transport: codex-app-server`,
      `- session: ${runtime.session.sessionId.slice(0, 8)}`,
      `- thread: ${runtime.threadId}`,
      `- cwd: ${runtime.session.cwd}`,
      `- status: ${runtime.session.status}`,
      `- thread status: ${String(thread?.status ?? 'unknown')}`,
      `- model: ${String(runtime.modelOverride ?? config?.model ?? 'config default')}${runtime.modelOverride ? ' (CCM room override)' : ''}`,
    ]
    if (runtime.activeTurns.size > 0) lines.push(`- active turns: ${runtime.activeTurns.size}`)
    return lines.join('\n')
  }

  private commandHelp(): string {
    const spec = this.commandSpec()
    const lines = ['Codex commands in CCM:']
    for (const cap of spec.capabilities) {
      const aliases = cap.aliases?.length ? ` (${cap.aliases.join(', ')})` : ''
      const status = cap.status === 'supported' ? '' : ` [${cap.status}]`
      lines.push('- `/cx ' + cap.name + '`' + aliases + status + ' — ' + cap.summary)
    }
    lines.push('pending requests: `/cx ss` and `/cx nav` show the same actionable requests; stale requests expose only `Clear stale request`.')
    lines.push('raw passthrough: ' + spec.rawPassthrough + ' — ' + (spec.rawPassthroughWarning ?? 'not available'))
    return lines.join('\n')
  }

  private entriesFromTurns(turns: JsonObject[]): Array<{ role: string; text: string }> {
    return codexEntriesFromTurns(turns)
  }

  private readTranscriptRecent(path: string, limit: number): Array<{ role: string; text: string }> {
    try {
      const lines = readFileSync(path, 'utf8').trim().split('\n').filter(Boolean).slice(-200)
      const recent: Array<{ role: string; text: string }> = []
      for (const line of lines) {
        const obj = parseAppServerMessage(line)
        const item = jsonObject(obj?.item) ?? obj
        const entry = codexTranscriptEntryFromItem(item, obj?.type)
        if (entry) recent.push(entry)
      }
      return recent.slice(-limit)
    } catch (err) {
      this.opts.log?.(`Codex transcript fallback read failed for ${path}: ${errorMessage(err)}`)
      return []
    }
  }

  private snapshotPendingItem(id: string, method: string, params: JsonObject): AgentSnapshotPendingItem {
    const meta = jsonObject(params._meta) ?? jsonObject(params.meta)
    const isMcpToolApproval = method === 'mcpServer/elicitation/request' && meta?.codex_approval_kind === 'mcp_tool_call'
    const kind: AgentSnapshotPendingItem['kind'] = isMcpToolApproval || method.includes('requestApproval') || method.endsWith('Approval')
      ? 'approval'
      : method === 'item/tool/requestUserInput'
        ? 'input'
        : method === 'mcpServer/elicitation/request'
          ? 'elicitation'
          : 'other'
    const command = typeof params.command === 'string' ? params.command : undefined
    const reason = typeof params.reason === 'string' ? params.reason : undefined
    const message = typeof params.message === 'string' ? params.message : undefined
    const title = kind === 'approval'
      ? isMcpToolApproval ? `MCP tool approval${params.serverName ? ` (${String(params.serverName)})` : ''}` : method.includes('commandExecution') || method === 'execCommandApproval' ? 'Command approval' : method.includes('fileChange') || method === 'applyPatchApproval' ? 'File-change approval' : 'Permission approval'
      : kind === 'input'
        ? 'User input requested'
        : kind === 'elicitation'
          ? `MCP elicitation${params.serverName ? ` (${String(params.serverName)})` : ''}`
          : method
    const detail = [
      reason,
      message,
      isMcpToolApproval && meta?.tool_params ? JSON.stringify(meta.tool_params) : undefined,
      command ? `$ ${command}` : undefined,
      typeof params.cwd === 'string' ? `cwd: ${params.cwd}` : undefined,
    ].filter(Boolean).join('\n')
    const actions = kind === 'approval'
      ? ['allow', 'deny', 'abort']
      : kind === 'input'
        ? ['answer <text>', 'cancel']
        : kind === 'elicitation'
          ? ['answer <json/text>', 'decline', 'cancel']
          : ['deny', 'abort']
    return { id, kind, title, ...(detail ? { detail } : {}), actions }
  }

  private emit(event: AgentEvent): void {
    for (const cb of this.listeners) cb(event)
  }

  private formatTurn(turn: AgentTurn): string {
    const attrs = [
      `source="claude-channel-mux"`,
      `room_id="${escapeXmlAttr(turn.roomId)}"`,
      `chat_id="${escapeXmlAttr(turn.channelKey)}"`,
      `cwd="${escapeXmlAttr(turn.cwd)}"`,
      `addressed_agent="${turn.addressedAgent}"`,
      `default_agent="${turn.defaultAgent}"`,
      `message_id="${escapeXmlAttr(turn.messageId)}"`,
      `thread_id="${escapeXmlAttr(turn.threadId)}"`,
    ].join(' ')
    const meta = this.formatMessageMeta(turn.meta)
    const attachmentInstructions = this.formatAttachmentHandlingInstructions(turn.meta)
    return `<ccm_turn ${attrs}>
<context_pointers trust="untrusted" platform="${escapeXmlAttr(turn.platform)}" channel_id="${escapeXmlAttr(turn.channelId)}" thread_id="${escapeXmlAttr(turn.threadId)}" peer_agents="${escapeXmlAttr(JSON.stringify(turn.peerAgents))}" />
${meta ? `<message_meta trust="untrusted">${meta}</message_meta>\n` : ''}${attachmentInstructions ? `<agent_instructions source="claude-channel-mux" priority="internal">${escapeXmlText(attachmentInstructions)}</agent_instructions>\n` : ''}<current_message>${escapeXmlText(turn.text)}</current_message>
</ccm_turn>`
  }

  private formatAttachmentHandlingInstructions(meta: Record<string, unknown>): string {
    const summary = attachmentSummary(meta)
    if (!summary.needsIsolation) return ''
    return [
      'The user sent multiple or large attachments. Treat this as a hard safety constraint: do not call view_image, do not inline image bytes, and do not load multiple large images/files into this main Codex turn because providers can return 429 for large multimodal payloads.',
      'Use the download_attachment MCP tool only to save attachments locally in the main session. For images or large files, process each attachment in a fresh isolated worker controlled by the main session, one attachment per worker, then aggregate only the worker text summaries here. Prefer native subagents when available; otherwise run a fresh `codex exec`/isolated Codex session for each attachment.',
      'If no isolated worker mechanism is available, stop and ask the user to enable one or approve a text-only/manual path; do not fall back to view_image in the main session.',
      'Do not mention this internal routing strategy unless the user asks about implementation details; just complete the user task.',
    ].join('\n')
  }

  private formatMessageMeta(meta: Record<string, unknown>): string {
    const allowed = [
      'attachment_file_id',
      'attachment_name',
      'attachment_mime',
      'attachment_size',
      'attachment_files',
      'reply_to_id',
      'message_id',
      'thread_id',
      'user',
      'user_id',
      'chat_id',
      'room_id',
    ]
    const picked: Record<string, string> = {}
    for (const key of allowed) {
      const value = meta[key]
      if (typeof value === 'string' && value) picked[key] = value
    }
    return Object.keys(picked).length > 0 ? escapeXmlText(JSON.stringify(picked)) : ''
  }
}

type AttachmentSummary = {
  count: number
  imageCount: number
  totalSize: number
  maxSize: number
  needsIsolation: boolean
}

const LARGE_ATTACHMENT_BYTES = 1_500_000
const LARGE_ATTACHMENT_TOTAL_BYTES = 3_000_000

function attachmentSummary(meta: Record<string, unknown>): AttachmentSummary {
  const attachments = attachmentMetaItems(meta)
  const count = attachments.length
  const imageCount = attachments.filter(item => item.mime.startsWith('image/')).length
  const sizes = attachments.map(item => item.size).filter((size): size is number => typeof size === 'number' && Number.isFinite(size) && size > 0)
  const totalSize = sizes.reduce((sum, size) => sum + size, 0)
  const maxSize = sizes.length ? Math.max(...sizes) : 0
  return {
    count,
    imageCount,
    totalSize,
    maxSize,
    needsIsolation: imageCount >= 2 || maxSize >= LARGE_ATTACHMENT_BYTES || totalSize >= LARGE_ATTACHMENT_TOTAL_BYTES,
  }
}

function attachmentMetaItems(meta: Record<string, unknown>): Array<{ fileId?: string; name?: string; mime: string; size?: number }> {
  const fromList = attachmentMetaList(meta.attachment_files)
  if (fromList.length > 0) return fromList
  const fileId = stringValue(meta.attachment_file_id)
  const name = stringValue(meta.attachment_name)
  const mime = stringValue(meta.attachment_mime) ?? ''
  const size = numericAttachmentSize(meta.attachment_size)
  return fileId || name || mime || size != null ? [{ fileId, name, mime, size }] : []
}

function attachmentMetaList(value: unknown): Array<{ fileId?: string; name?: string; mime: string; size?: number }> {
  if (typeof value !== 'string' || !value) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  return parsed
    .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null && !Array.isArray(item))
    .map(item => ({
      fileId: stringValue(item.file_id),
      name: stringValue(item.name),
      mime: stringValue(item.mime) ?? '',
      size: numericAttachmentSize(item.size),
    }))
    .filter(item => item.fileId || item.name || item.mime || item.size != null)
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined
}

function numericAttachmentSize(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? value : undefined
  if (typeof value !== 'string' || !value.trim()) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined
}

function escapeXmlAttr(value: unknown): string {
  return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}

function escapeXmlText(value: unknown): string {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;')
}
