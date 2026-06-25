import type { AgentCommandSpec, AgentDriver, AgentEvent, AgentSession, AgentTurn, ResumeAgentInput, SendTurnInput, StartAgentInput } from '../types.js'

export type ClaudeChannelDriverOptions = {
  spawn: (sessionId: string, cwd: string, resumeMode: boolean) => Promise<boolean>
  sendInbound: (sessionId: string, msg: { channelKey: string; content: string; meta: Record<string, unknown> }) => boolean
  log?: (line: string) => void
}

export class ClaudeChannelAgentDriver implements AgentDriver {
  readonly kind = 'claude' as const
  private sessions = new Map<string, AgentSession>()
  private listeners = new Set<(event: AgentEvent) => void>()

  constructor(private opts: ClaudeChannelDriverOptions) {}

  onEvent(cb: (event: AgentEvent) => void): void {
    this.listeners.add(cb)
  }

  commandSpec(): AgentCommandSpec {
    return {
      rawPassthrough: 'supported',
      capabilities: [
        { name: 'ss', status: 'supported', summary: 'Show Claude screen/transcript snapshot.', aliases: ['screen'] },
        { name: 'nav', status: 'supported', summary: 'Show and operate pending Claude TUI prompts.' },
        { name: 'transcript', status: 'supported', summary: 'Show recent Claude transcript from jsonl.' },
        { name: 'status', status: 'supported', summary: 'Alias of ccm agents/status for room state.' },
        { name: 'tui', status: 'supported', summary: 'Show, attach, or detach the per-session Claude zellij TUI with `/cc tui on|off|status`.' },
        { name: 'compact', status: 'supported', summary: 'Forward to Claude Code native /compact.' },
        { name: 'cancel', status: 'supported', summary: 'Forward to Claude Code native interruption command.', aliases: ['stop', 'interrupt'] },
        { name: 'model', status: 'supported', summary: 'Forward to Claude Code native /model.' },
      ],
    }
  }

  async start(input: StartAgentInput): Promise<AgentSession> {
    const ok = await this.opts.spawn(input.sessionId, input.cwd, false)
    if (!ok) throw new Error('failed to start Claude Code session')
    return this.record(input.sessionId, input.cwd, 'idle')
  }

  async resume(input: ResumeAgentInput): Promise<AgentSession> {
    const ok = await this.opts.spawn(input.sessionId, input.cwd, true)
    if (!ok) throw new Error('failed to resume Claude Code session')
    return this.record(input.sessionId, input.cwd, 'idle')
  }

  async sendTurn(input: SendTurnInput): Promise<string> {
    const meta = {
      ...input.turn.meta,
      chat_id: input.turn.channelKey,
      room_id: input.turn.roomId,
      cwd: input.turn.cwd,
      addressed_agent: input.turn.addressedAgent,
      default_agent: input.turn.defaultAgent,
      message_id: input.turn.messageId,
      thread_id: input.turn.threadId,
      peer_agents: JSON.stringify(input.turn.peerAgents),
    }
    const delivered = this.opts.sendInbound(input.session.sessionId, {
      channelKey: input.turn.channelKey,
      content: this.formatTurn(input.turn),
      meta,
    })
    if (!delivered) throw new Error('Claude Code channel bridge is not connected')
    input.session.status = 'running'
    this.emit({ type: 'status', session: input.session, status: 'running' })
    return input.turn.turnId
  }

  async stop(session: AgentSession): Promise<void> {
    session.status = 'stopped'
    this.sessions.delete(session.sessionId)
    this.emit({ type: 'status', session, status: 'stopped' })
  }

  get(sessionId: string): AgentSession | undefined {
    return this.sessions.get(sessionId)
  }

  private record(sessionId: string, cwd: string, status: AgentSession['status']): AgentSession {
    const session: AgentSession = {
      kind: 'claude',
      sessionId,
      nativeSessionId: sessionId,
      transport: 'claude-channel',
      cwd,
      status,
      capabilities: { streaming: false, cancel: false, resume: true, toolCalling: true },
    }
    this.sessions.set(sessionId, session)
    this.emit({ type: 'status', session, status })
    return session
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
      ...(turn.roomCapability ? [
        `is_orchestrator="${turn.roomCapability.isOrchestrator ? 'true' : 'false'}"`,
        `orchestrator_source="${escapeXmlAttr(turn.roomCapability.source)}"`,
        ...(turn.roomCapability.parentRoomId ? [`parent_room_id="${escapeXmlAttr(turn.roomCapability.parentRoomId)}"`] : []),
      ] : []),
      `message_id="${escapeXmlAttr(turn.messageId)}"`,
      `thread_id="${escapeXmlAttr(turn.threadId)}"`,
    ].join(' ')
    const meta = this.formatMessageMeta(turn.meta)
    return `<ccm_turn ${attrs}>
<context_pointers trust="untrusted" platform="${escapeXmlAttr(turn.platform)}" channel_id="${escapeXmlAttr(turn.channelId)}" thread_id="${escapeXmlAttr(turn.threadId)}" peer_agents="${escapeXmlAttr(JSON.stringify(turn.peerAgents))}" />
${meta ? `<message_meta trust="untrusted">${meta}</message_meta>\n` : ''}<current_message>${escapeXmlText(turn.text)}</current_message>
</ccm_turn>`
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

function escapeXmlAttr(value: unknown): string {
  return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}

function escapeXmlText(value: unknown): string {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;')
}
