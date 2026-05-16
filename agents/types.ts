export type AgentKind = 'claude' | 'codex'

export type AgentSessionStatus = 'starting' | 'idle' | 'running' | 'stopped' | 'missing'

export type AgentCapabilities = {
  streaming: boolean
  cancel: boolean
  resume: boolean
  toolCalling: boolean
}

export type AgentSession = {
  kind: AgentKind
  sessionId: string
  nativeSessionId: string
  transport: 'claude-channel' | 'codex-app-server'
  cwd: string
  status: AgentSessionStatus
  capabilities: AgentCapabilities
}

export type AgentPeerPointer = {
  kind: AgentKind
  sessionId?: string
  status: 'active' | 'suspended' | 'missing'
}

export type AgentTurn = {
  turnId: string
  roomId: string
  channelKey: string
  platform: string
  channelId: string
  threadId: string
  messageId: string
  cwd: string
  text: string
  addressedAgent: AgentKind
  defaultAgent: AgentKind
  peerAgents: AgentPeerPointer[]
  meta: Record<string, unknown>
}

export type AgentServerRequest = {
  requestId: string
  method: string
  params: Record<string, unknown>
  threadId?: string
  turnId?: string
}

export type AgentPlanStep = { step: string; status: 'pending' | 'inProgress' | 'completed' }

export type AgentEvent =
  | { type: 'assistant_delta'; session: AgentSession; turnId: string; text: string }
  | { type: 'assistant_final'; session: AgentSession; turnId: string; text: string; channelKey?: string; threadId?: string }
  | { type: 'status'; session: AgentSession; status: AgentSessionStatus }
  | { type: 'server_request'; session: AgentSession; request: AgentServerRequest }
  | { type: 'plan_updated'; session: AgentSession; turnId: string; explanation?: string; plan: AgentPlanStep[] }
  | { type: 'compaction'; session: AgentSession; turnId?: string; status: 'started' | 'completed' }
  | { type: 'error'; session: AgentSession; turnId?: string; error: string; channelKey?: string; threadId?: string }

export type AgentStartOptions = {
  model?: string
}

export type StartAgentInput = {
  sessionId: string
  cwd: string
  options?: AgentStartOptions
}

export type ResumeAgentInput = StartAgentInput & {
  nativeSessionId?: string
}

export type SendTurnInput = {
  session: AgentSession
  turn: AgentTurn
}

export type AgentCommand = {
  commandId: string
  roomId: string
  channelKey: string
  platform: string
  channelId: string
  threadId: string
  messageId: string
  cwd: string
  command: string
  meta: Record<string, unknown>
}

export type AgentCommandResult = {
  commandId: string
  display?: string
  nativeCommandId?: string
}


export type AgentSnapshotPendingItem = {
  id: string
  kind: 'approval' | 'input' | 'elicitation' | 'other'
  title: string
  detail?: string
  actions: string[]
}

export type AgentSnapshot = {
  kind: AgentKind
  session: AgentSession
  source: 'live' | 'transcript' | 'partial'
  title: string
  cwd: string
  model?: string
  status: string
  threadId?: string
  activeTurnCount?: number
  current?: string
  pending: AgentSnapshotPendingItem[]
  recent: Array<{ role: string; text: string }>
  health: string[]
}

export type GetSnapshotInput = {
  session: AgentSession
  cwd: string
}


export type AgentTranscript = {
  kind: AgentKind
  session: AgentSession
  source: 'live' | 'transcript' | 'partial'
  path?: string
  entries: Array<{ role: string; text: string }>
}

export type GetTranscriptInput = {
  session: AgentSession
  cwd: string
  limit?: number
}


export type AgentCommandCapabilityStatus = 'supported' | 'experimental' | 'unsupported'

export type AgentCommandCapability = {
  name: string
  status: AgentCommandCapabilityStatus
  summary: string
  warning?: string
  aliases?: string[]
}

export type AgentCommandSpec = {
  capabilities: AgentCommandCapability[]
  rawPassthrough: AgentCommandCapabilityStatus
  rawPassthroughWarning?: string
}

export type SendCommandInput = {
  session: AgentSession
  command: AgentCommand
}

export type ResolveServerRequestInput = {
  session: AgentSession
  requestId: string
  result?: Record<string, unknown>
  error?: { code: number; message: string }
}

export interface AgentDriver {
  readonly kind: AgentKind
  start(input: StartAgentInput): Promise<AgentSession>
  resume(input: ResumeAgentInput): Promise<AgentSession>
  sendTurn(input: SendTurnInput): Promise<string>
  commandSpec?(): AgentCommandSpec
  sendCommand?(input: SendCommandInput): Promise<AgentCommandResult>
  snapshot?(input: GetSnapshotInput): Promise<AgentSnapshot>
  transcript?(input: GetTranscriptInput): Promise<AgentTranscript>
  resolveServerRequest?(input: ResolveServerRequestInput): Promise<void>
  stop?(session: AgentSession): Promise<void>
  cancel?(session: AgentSession, turnId: string): Promise<void>
  onEvent(cb: (event: AgentEvent) => void): void
}
