export type CcmMcpToolName = typeof CCM_MCP_TOOL_NAMES[number]

export type CcmMcpToolDefinition = {
  name: CcmMcpToolName
  description: string
  inputSchema: {
    type: 'object'
    properties: Record<string, unknown>
    required: string[]
  }
  outputSchema?: {
    type: 'object'
    properties: Record<string, unknown>
    required: string[]
  }
}

export const CCM_MCP_TOOL_NAMES = [
  'reply',
  'react',
  'edit_message',
  'download_attachment',
  'fetch_thread',
  'get_current_ccm_context',
  'create_room_with_bot_invited',
  'archive_room',
  'bind_worker_room',
  'start_worker_agent',
  'stop_worker_agent',
  'get_worker_status',
  'list_worker_rooms',
  'set_worker_model',
  'send_worker_raw_command',
  'send_worker_task',
  'capture_worker_report',
  'rotate_orchestrator',
  'ask_peer',
  'chime_in',
] as const

export function ccmMcpToolId(tool: CcmMcpToolName, prefix: string): string {
  return `${prefix}__${tool}`
}

export function ccmMcpToolIds(prefix: string): string[] {
  return CCM_MCP_TOOL_NAMES.map(tool => ccmMcpToolId(tool, prefix))
}

export const CCM_MCP_TOOLS: CcmMcpToolDefinition[] = [
  {
    name: 'reply',
    description: 'Reply to a Slack/Telegram channel. Pass chat_id from the inbound message.',
    inputSchema: {
      type: 'object',
      properties: {
        chat_id: { type: 'string', description: 'Channel key (e.g. slack:C123 or telegram:456)' },
        text: { type: 'string' },
        reply_to: { type: 'string', description: 'Message ID to thread under (optional)' },
        files: { type: 'array', items: { type: 'string' }, description: 'File paths to attach' },
      },
      required: ['chat_id', 'text'],
    },
  },
  {
    name: 'react',
    description: 'Add an emoji reaction.',
    inputSchema: {
      type: 'object',
      properties: {
        chat_id: { type: 'string' },
        message_id: { type: 'string' },
        emoji: { type: 'string' },
      },
      required: ['chat_id', 'message_id', 'emoji'],
    },
  },
  {
    name: 'edit_message',
    description: 'Edit a previously sent message.',
    inputSchema: {
      type: 'object',
      properties: {
        chat_id: { type: 'string' },
        message_id: { type: 'string' },
        text: { type: 'string' },
      },
      required: ['chat_id', 'message_id', 'text'],
    },
  },
  {
    name: 'download_attachment',
    description: 'Download a file attachment to local inbox.',
    inputSchema: {
      type: 'object',
      properties: {
        chat_id: { type: 'string', description: 'Channel key (needed to determine platform)' },
        file_id: { type: 'string' },
      },
      required: ['chat_id', 'file_id'],
    },
  },
  {
    name: 'fetch_thread',
    description: 'Fetch full thread/conversation history. Use when you need context from earlier messages that may have been compacted. Slack: returns full thread. Telegram: not supported.',
    inputSchema: {
      type: 'object',
      properties: {
        chat_id: { type: 'string', description: 'Channel key' },
        thread_id: { type: 'string', description: 'Thread ID (Slack: thread_ts from reply_to_id)' },
      },
      required: ['chat_id', 'thread_id'],
    },
  },
  {
    name: 'get_current_ccm_context',
    description: 'Read-only Agent Control Path context probe. Resolves the current CCM room from this turn/session binding and returns status resolved, ambiguous, or not_bound plus authorized_control_tools for the resolved room.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
    outputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['resolved', 'ambiguous', 'not_bound'], description: 'Whether the current CCM turn/session binding resolved to exactly one room, multiple possible rooms, or no bound room.' },
        chat_id: { type: 'string', description: 'Resolved current CCM room channel key when status is resolved.' },
        is_orchestrator: { type: 'boolean', description: 'Effective Agent Control Path capability for the resolved room.' },
        orchestrator_source: { type: 'string', description: 'Why the resolved room is or is not orchestrator-capable, such as ordinary-default-enabled, explicit-disabled, worker-forced-disabled, or worker-enabled.' },
        parent_room_id: { type: 'string', description: 'For a CCM-managed Worker Room, the channel key of the parent Orchestrator room that created or bound it.' },
        candidate_chat_ids: { type: 'array', items: { type: 'string' }, description: 'Candidate bound room channel keys when status is ambiguous.' },
        authorized_control_tools: { type: 'array', items: { type: 'string', enum: ['create_room_with_bot_invited', 'archive_room', 'bind_worker_room', 'start_worker_agent', 'stop_worker_agent', 'get_worker_status', 'list_worker_rooms', 'set_worker_model', 'send_worker_raw_command', 'send_worker_task', 'capture_worker_report', 'rotate_orchestrator'] }, description: 'Agent Control Path tools authorized for the resolved current CCM room.' },
      },
      required: ['status', 'authorized_control_tools'],
    },
  },
  {
    name: 'create_room_with_bot_invited',
    description: 'Agent Control Path V1: create a Slack private worker room and invite the CCM bot. Requires an orchestrator room. chat_id is optional when the current CCM turn/session binding resolves to one room; parent_chat_id defaults to the resolved/current Orchestrator parent room when omitted. Do not use the desired/new worker room as chat_id until that room has its own binding.',
    inputSchema: {
      type: 'object',
      properties: {
        chat_id: { type: 'string', description: 'Current Orchestrator parent room channel key; optional when resolver fallback can infer it from this turn/session binding' },
        parent_chat_id: { type: 'string', description: 'Parent room channel key whose eligible ordinary members may be invited best-effort; defaults to the resolved/current Orchestrator parent room' },
        desired_room_name: { type: 'string', description: 'Desired worker room name. Orchestrator owns naming/collision policy.' },
      },
      required: ['desired_room_name'],
    },
  },
  {
    name: 'archive_room',
    description: 'Agent Control Path V1: archive a worker room. Requires an orchestrator room; archive timing policy belongs to the orchestrator. chat_id is optional when the current CCM turn/session binding resolves to one room.',
    inputSchema: {
      type: 'object',
      properties: {
        chat_id: { type: 'string', description: 'Current orchestrator room channel key; optional when resolver fallback can infer it from this turn/session binding' },
        room_id: { type: 'string', description: 'Platform-local worker room id to archive' },
      },
      required: ['room_id'],
    },
  },
  {
    name: 'bind_worker_room',
    description: 'Agent Control Path V1: bind a worker room cwd/runtime metadata from the current Orchestrator parent room. Requires an orchestrator room; the worker room does not inherit isOrchestrator. chat_id is optional when the current CCM turn/session binding resolves to one room.',
    inputSchema: {
      type: 'object',
      properties: {
        chat_id: { type: 'string', description: 'Current Orchestrator parent room channel key; optional when resolver fallback can infer it from this turn/session binding' },
        room_id: { type: 'string', description: 'Worker room channel key or platform-local id' },
        cwd: { type: 'string', description: 'Absolute working directory to bind to the worker room' },
        runtime: { type: 'string', enum: ['claude', 'codex'], description: 'Default worker agent runtime' },
        label: { type: 'string', description: 'Optional short human-readable purpose label stored in the room binding' },
      },
      required: ['room_id', 'cwd', 'runtime'],
    },
  },
  {
    name: 'start_worker_agent',
    description: 'Agent Control Path V1: start or resume the assigned worker agent in a bound worker room from the current Orchestrator parent room. Requires an orchestrator room. chat_id is optional when the current CCM turn/session binding resolves to one room.',
    inputSchema: {
      type: 'object',
      properties: {
        chat_id: { type: 'string', description: 'Current Orchestrator parent room channel key; optional when resolver fallback can infer it from this turn/session binding' },
        room_id: { type: 'string', description: 'Worker room channel key or platform-local id' },
        runtime: { type: 'string', enum: ['claude', 'codex'], description: 'Worker agent runtime to start or resume' },
      },
      required: ['room_id', 'runtime'],
    },
  },
  {
    name: 'send_worker_raw_command',
    description: 'Agent Control Path V1: send a raw native runtime slash command to a started worker agent from the current Orchestrator parent room. Requires an orchestrator room. This is native control delivery, not a Worker Task; use it for setup commands such as Claude Code /effort ultracode. chat_id is optional when the current CCM turn/session binding resolves to one room.',
    inputSchema: {
      type: 'object',
      properties: {
        chat_id: { type: 'string', description: 'Current Orchestrator parent room channel key; optional when resolver fallback can infer it from this turn/session binding' },
        room_id: { type: 'string', description: 'Worker room channel key or platform-local id' },
        runtime: { type: 'string', enum: ['claude', 'codex'], description: 'Worker agent runtime to receive the native command' },
        command: { type: 'string', description: 'Slash-shaped native runtime command, for example /effort ultracode' },
        thread_id: { type: 'string', description: 'Optional worker-room thread/message pointer for result facts; does not affect native command delivery' },
      },
      required: ['room_id', 'runtime', 'command'],
    },
  },
  {
    name: 'send_worker_task',
    description: 'Agent Control Path V1: send a bounded Worker Task to a started/bound worker room from the current Orchestrator parent room. Requires an orchestrator room. chat_id is optional when the current CCM turn/session binding resolves to one room.',
    inputSchema: {
      type: 'object',
      properties: {
        chat_id: { type: 'string', description: 'Current Orchestrator parent room channel key; optional when resolver fallback can infer it from this turn/session binding' },
        room_id: { type: 'string', description: 'Worker room channel key or platform-local id' },
        runtime: { type: 'string', enum: ['claude', 'codex'], description: 'Worker agent runtime to receive the task' },
        text: { type: 'string', description: 'Bounded Worker Task prompt to deliver' },
        thread_id: { type: 'string', description: 'Optional worker-room thread/message id pointer' },
      },
      required: ['room_id', 'runtime', 'text'],
    },
  },
  {
    name: 'capture_worker_report',
    description: 'Agent Control Path V1: retrieve worker-room transcript/reportback facts from the current Orchestrator parent room so the Orchestrator can capture a durable Worker Report in Git. Requires an orchestrator room. chat_id is optional when the current CCM turn/session binding resolves to one room.',
    inputSchema: {
      type: 'object',
      properties: {
        chat_id: { type: 'string', description: 'Current Orchestrator parent room channel key; optional when resolver fallback can infer it from this turn/session binding' },
        room_id: { type: 'string', description: 'Worker room channel key or platform-local id' },
        runtime: { type: 'string', enum: ['claude', 'codex'], description: 'Worker agent runtime to capture from' },
        limit: { type: 'number', description: 'Maximum transcript entries to return, clamped by daemon limits' },
      },
      required: ['room_id', 'runtime'],
    },
  },
  {
    name: 'stop_worker_agent',
    description: 'Agent Control Path V1: stop the worker agent session in a bound worker room while KEEPING the room mapping, so a later start_worker_agent resumes the same session with its context (the ccm stop / ccm resume pair). Also clears a wedged pane so the next start spawns fresh. Requires an orchestrator room. chat_id is optional when the current CCM turn/session binding resolves to one room.',
    inputSchema: {
      type: 'object',
      properties: {
        chat_id: { type: 'string', description: 'Current Orchestrator parent room channel key; optional when resolver fallback can infer it from this turn/session binding' },
        room_id: { type: 'string', description: 'Worker room channel key or platform-local id' },
        runtime: { type: 'string', enum: ['claude', 'codex'], description: 'Worker agent runtime to stop' },
      },
      required: ['room_id', 'runtime'],
    },
  },
  {
    name: 'get_worker_status',
    description: 'Agent Control Path V1: read-only status probe for a bound worker room: session id, live/IPC state, desiredRunning, effective Claude model and its source (pin / worker-default / inherited), cwd, label, queueDepth (pending ask_peer replies waiting to be injected on this session\'s next idle), sessionStatus (the driver\'s starting/idle/running/stopped/missing value -- for claude rooms this flips idle->running on the first turn and nothing currently flips it back, so it reads \'running\' forever after that, a known gap; codex clears it back to idle on turn completion), and (claude only) paneDialog -- true/false when a Claude TUI dialog/prompt is currently showing in the zellij pane, or null when that can\'t be determined (no session, no pane, or a dump-screen failure). Distinguishes "pane alive but IPC not connected" from "not running". Requires an orchestrator room.',
    inputSchema: {
      type: 'object',
      properties: {
        chat_id: { type: 'string', description: 'Current Orchestrator parent room channel key; optional when resolver fallback can infer it from this turn/session binding' },
        room_id: { type: 'string', description: 'Worker room channel key or platform-local id' },
        runtime: { type: 'string', enum: ['claude', 'codex'], description: 'Worker agent runtime to probe; defaults to the room default' },
      },
      required: ['room_id'],
    },
  },
  {
    name: 'list_worker_rooms',
    description: 'Agent Control Path V1: list worker rooms whose parent is the current Orchestrator room, each with get_worker_status facts and label. Read-only. Requires an orchestrator room.',
    inputSchema: {
      type: 'object',
      properties: {
        chat_id: { type: 'string', description: 'Current Orchestrator parent room channel key; optional when resolver fallback can infer it from this turn/session binding' },
        all: { type: 'boolean', description: 'When true, include worker rooms of OTHER parent rooms too (read-only visibility; lifecycle operations still require the owning parent)' },
      },
      required: [],
    },
  },
  {
    name: 'set_worker_model',
    description: 'Agent Control Path V1: set or clear the persistent per-room Claude model pin for a worker room, and forward /model to the live session when one is running so it takes effect immediately. The pin survives restarts; without a pin, worker rooms come up on the worker default model. This is the sanctioned way to put a worker room on a non-default model. Requires an orchestrator room.',
    inputSchema: {
      type: 'object',
      properties: {
        chat_id: { type: 'string', description: 'Current Orchestrator parent room channel key; optional when resolver fallback can infer it from this turn/session binding' },
        room_id: { type: 'string', description: 'Worker room channel key or platform-local id' },
        runtime: { type: 'string', enum: ['claude'], description: 'Runtime whose model to pin; only claude is supported (codex has /cx model)' },
        model: { type: 'string', description: 'Model to pin (e.g. opus, fable[1m]), or "reset" to clear the pin' },
      },
      required: ['room_id', 'model'],
    },
  },
  {
    name: 'rotate_orchestrator',
    description: 'Agent Control Path V1: promote an existing room to be the new Agent Control Path orchestrator, succeeding the current one. This is succession, not escalation: worker lifecycle automation never creates orchestrators, and this operation does not grow the net orchestrator count. It is the single audited exception, logged as an orchestrator_rotated event and announced in both rooms. Requires an orchestrator room. chat_id is optional when the current CCM turn/session binding resolves to one room.',
    inputSchema: {
      type: 'object',
      properties: {
        chat_id: { type: 'string', description: 'Current Orchestrator room channel key; optional when resolver fallback can infer it from this turn/session binding' },
        successor_room_id: { type: 'string', description: 'Existing room channel key or platform-local id to promote to orchestrator, typically one just created via create_room_with_bot_invited' },
        worker_room_ids: { type: 'array', items: { type: 'string' }, description: 'Worker room channel keys or platform-local ids to re-parent to the successor. Defaults to every worker room currently parented to this orchestrator, excluding the successor.' },
        demote_self: { type: 'boolean', description: 'When true (default), demote this calling room to non-orchestrator after the successor is promoted' },
      },
      required: ['successor_room_id'],
    },
  },
  {
    name: 'ask_peer',
    description: 'Ask another agent in the same CCM room for context or a second opinion. Use peer_agents from the current turn to choose the peer. This is an async visible handoff: the tool returns after routing, and the peer answer appears in the room/thread. The daemon does not maintain a hidden peer inbox or wait for answers.',
    inputSchema: {
      type: 'object',
      properties: {
        chat_id: { type: 'string', description: 'Channel key for the current CCM room (e.g. slack:C123 or telegram:456)' },
        agent: { type: 'string', enum: ['claude', 'codex'], description: 'Peer agent to ask' },
        question: { type: 'string', description: 'Question/context request for the peer agent' },
        thread_id: { type: 'string', description: 'Current thread/message id pointer (optional)' },
        collab_id: { type: 'string', description: 'Current CCM collaboration id if provided in ccm_collab_context (optional)' },
      },
      required: ['chat_id', 'agent', 'question'],
    },
  },
  {
    name: 'chime_in',
    description: 'Observer-only collaboration note. Inject concise high-signal detail, context, evidence, risk, correction, or a better approach into the lead/default agent context without taking over the visible room answer.',
    inputSchema: {
      type: 'object',
      properties: {
        chat_id: { type: 'string', description: 'Channel key for the current CCM room' },
        collab_id: { type: 'string', description: 'Collaboration id from ccm_collab_context' },
        summary: { type: 'string', description: 'Concise high-signal detail/context/evidence/correction for the lead/default agent' },
        thread_id: { type: 'string', description: 'Current thread/message id pointer (optional)' },
      },
      required: ['chat_id', 'collab_id', 'summary'],
    },
  },
]
