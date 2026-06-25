# Concepts

Shared domain vocabulary for this project — entities, named processes, and status concepts with project-specific meaning. Seeded with core domain vocabulary, then accretes as ce-compound and ce-compound-refresh process learnings; direct edits are fine. Glossary only, not a spec or catch-all.

## CCM Orchestration

### Guiding Principal
A strategic steering role that supplies human-context judgment, quality bars, framing, and key review decisions for an orchestration initiative.

The Guiding Principal is not a routine worker-room operator. They should not be required to bind rooms, start agents, send worker prompts, debug worker execution, capture reports, or archive rooms unless explicitly assigned that artifact as the work product.

### Orchestrator
The parent-room agent responsible for turning durable human and Guiding Principal context into autonomous worker coordination, bounded low-level execution decisions, evidence capture, integration or rejection, and cleanup.

The Orchestrator owns worker-room lifecycle through Agent Control Path and escalates only when durable context and stage policy are insufficient.

### Worker Room
A visible CCM room dedicated to one bounded Worker Task and controlled by the parent Orchestrator rather than by direct human setup.

Worker Rooms created, adopted, or bound by Agent Control Path are worker-forced-disabled non-orchestrators by default. They do not inherit parent-room orchestration capability and cannot coordinate peer rooms unless a human operator later re-enables one with an explicit `/ccm orch on` break-glass command (audit-logged); worker lifecycle automation and agent-originated messages never do this.

Human or Guiding Principal presence in a Worker Room is optional inspection. Required manual intervention inside a Worker Room is degraded recovery or orchestration failure, not successful orchestration.

### Agent Control Path
The structured parent-room control surface that lets an Orchestrator operate worker-room lifecycle without simulating chat commands or requiring humans to type in worker rooms.

For worker execution, Agent Control Path must make bind, start/resume, native setup, task delivery, capture/reportback, and archive steps explicit so the Orchestrator can prove what happened without entering the worker room manually. Lifecycle calls may recover a missing room identity only through Current CCM Context; they must not guess from unrelated rooms or bridge ids.

### Orchestrator Room Flag
The effective CCM Room capability that authorizes Agent Control Path lifecycle tools from a parent room.

Ordinary CCM rooms are default-enabled unless explicitly disabled. Existing explicit-enabled rooms remain enabled, explicit-disabled rooms stay disabled across restarts and binding serialization, and worker-forced-disabled Worker Rooms remain non-orchestrators unless a human operator re-enables one with an explicit `/ccm orch on` break-glass command (audit-logged). This capability state is control-plane state, not disposable session metadata. Room reset paths may clear cwd, agent slots, pending UI, or runtime metadata, but must preserve explicit enabled, explicit disabled, and worker-forced-disabled states.

### Dispatch Decision Matrix
The Orchestrator policy for choosing single-agent execution, visible Worker Rooms, worker-local internal fan-out, Orchestrator meta-work fan-out, `ask_peer`, or `attention_needed`.

The matrix weighs task independence, dependencies, concurrency value, expected context demand, current context pressure, compaction/corrosion risk, auditability, and explicit user preference after hard control-path boundaries. User preference biases the choice, but hidden subagents are not CCM Worker Rooms, Worker Rooms are not controllers, and missing current CCM context remains an `attention_needed` failure.

### Worker Task
A bounded assignment sent to a worker agent with objective, inputs, non-goals, output format, and acceptance evidence.

A Worker Task should be durable in orchestration state before room creation starts and should be delivered by the Orchestrator through Agent Control Path after the worker room is bound, the worker agent is running, and any native setup has been sent. Runtime-native setup configures the worker session; it is not part of the Worker Task.

## CCM Agent Bridge

### CCM Room
A Slack or Telegram conversation bound to a working directory, a default agent, and optional live agent slots.

The CCM Room is the routing boundary for visible user messages, agent replies, attachment downloads, and tool calls. A room key such as `slack:<channel>` or `telegram:<chat>` identifies this boundary across daemon state and agent turns.

### Shared Codex Bridge
The single Codex MCP bridge process used by Codex app-server sessions to call CCM tools on behalf of many logical CCM Codex sessions.

Because the Shared Codex Bridge is process-shared, tool calls must carry the current room identity. For shared-bridge calls this is normally explicit `chat_id`; the bridge id itself is never a room id.

### Current CCM Context
The daemon-resolved room identity for an agent session, derived from an explicit turn route or from that session's direct room binding when exactly one authorized room matches.

Current CCM Context is a control boundary: a resolved context may authorize Agent Control Path tools for an Orchestrator room, while ambiguous or unbound context requires the agent to pass an explicit room id or re-enter through a bound CCM room.

### CCM Daemon
The local long-running service that owns CCM Room state, platform connections, agent registrations, and tool-call routing.

Exactly one CCM Daemon should own active routing state at a time. In normal operation that owner is the supervised user service; detached manual daemons are emergency-only and must hand ownership back to the supervisor before status or recovery decisions are trusted. A replacement daemon may take over only after the previous owner is gone or its ownership records are stale.

### Agent Routing Environment
The provider-routing and authentication environment that CCM must pass to every managed agent launch surface so model calls use the intended local or remote provider path.

Agent Routing Environment is part of the launcher contract, not incidental shell state. The CCM Daemon owns the effective values, while Claude zellij tabs, Codex app-server processes, and Codex remote TUIs must receive a consistent view when they are launched.

### Attachment Command Turn
A Codex command turn, such as `/cx goal ...` or `/cx raw ...`, that also carries platform attachment metadata from Slack or Telegram.

Attachment Command Turns must use the CCM turn envelope when attachment metadata is present so the agent receives both the attachment id and the room `chat_id` needed to call attachment tools.

### Native Goal Passthrough
A CCM room command that starts or replaces an agent's native goal while still preserving the CCM room context needed for visible orchestration.

Native Goal Passthrough must not be treated as plain terminal text. If the goal originates from a CCM Room, the turn must carry or recover Current CCM Context before deciding whether Agent Control Path Worker Rooms are available.

Worker-native goal setup follows the same separation: native slash-shaped setup configures a worker session, while the Worker Task remains the bounded assignment delivered afterward.

### Backend Zellij Session
A zellij session that owns a running agent TUI process without requiring a human client to be attached.

For Claude, a Backend Zellij Session is the durable terminal owner: detaching or closing human zellij clients must not kill the Claude process. Backend sessions are named and observed per logical agent session so memory growth and lifecycle actions do not accumulate inside one shared `ccmux` server.

### Disposable Codex TUI Session
A zellij session that hosts only the Codex remote TUI connected to a durable Codex app-server session.

Unlike a Claude Backend Zellij Session, a Disposable Codex TUI Session may be killed without stopping the Codex app-server or losing the logical Codex session. It exists to provide an on-demand local TUI, not to own the agent runtime.

### CCM MCP Tool Registry
The canonical inventory of callable CCM tool names, descriptions, and input schemas shared by the MCP bridge and runtime launch surfaces.

The registry prevents server tool exposure, agent allowlists, tests, and documentation from becoming independent sources of truth. Runtime-specific adapters may still differ in transport, but they should derive their CCM tool inventory from this shared contract.

## Relationships

The Human and Guiding Principal steer intent and review quality. The Orchestrator owns execution against that durable context. Worker Rooms host bounded Worker Tasks. Agent Control Path is the mechanism that lets the Orchestrator control Worker Rooms without turning humans or the Guiding Principal into routine operators. The Orchestrator Room Flag records which CCM Room is allowed to use that control surface.

CCM Rooms are the routing boundary for user-agent interaction. The CCM Daemon owns active room routing state and the Agent Routing Environment for managed launches. The Shared Codex Bridge executes tools for many Codex sessions, so shared-process tool calls route by explicit `chat_id` and the current Codex room binding. Current CCM Context lets a directly bound session recover its room identity when turn metadata is missing, but only when the binding is unambiguous. Attachment Command Turns combine command semantics with platform attachments and therefore need both attachment metadata and room identity. Native Goal Passthrough starts or replaces native agent goals while preserving the same room identity needed for Agent Control Path decisions. The CCM MCP Tool Registry keeps the callable tool inventory consistent across those routing surfaces.
