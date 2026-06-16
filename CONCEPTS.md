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

Human or Guiding Principal presence in a Worker Room is optional inspection. Required manual intervention inside a Worker Room is degraded recovery or orchestration failure, not successful orchestration.

### Agent Control Path
The structured parent-room control surface that lets an Orchestrator operate worker-room lifecycle without simulating chat commands or requiring humans to type in worker rooms.

For worker execution, Agent Control Path must make bind, start/resume, send, capture/reportback, and archive steps explicit so the Orchestrator can prove what happened without entering the worker room manually.

### Worker Task
A bounded assignment sent to a worker agent with objective, inputs, non-goals, output format, and acceptance evidence.

A Worker Task should be durable in orchestration state before room creation starts and should be delivered by the Orchestrator through Agent Control Path after the worker room is bound and the worker agent is running.

## CCM Agent Bridge

### CCM Room
A Slack or Telegram conversation bound to a working directory, a default agent, and optional live agent slots.

The CCM Room is the routing boundary for visible user messages, agent replies, attachment downloads, and tool calls. A room key such as `slack:<channel>` or `telegram:<chat>` identifies this boundary across daemon state and agent turns.

### Shared Codex Bridge
The single Codex MCP bridge process used by Codex app-server sessions to call CCM tools on behalf of many logical CCM Codex sessions.

Because the Shared Codex Bridge is process-shared, tool calls must carry a room capability token. The daemon uses that token to recover the logical CCM Room and Codex session before executing tools such as attachment download or thread fetch.

### Room Capability Token
An opaque per-room/per-session token embedded in Codex CCM turns so tool calls from the Shared Codex Bridge can be authorized and routed back to the correct CCM Room.

The token is not the attachment id and not a Slack or Telegram credential. It is CCM's proof that a shared bridge tool call belongs to the current bound Codex session for that room.

### CCM Daemon
The local long-running service that owns CCM Room state, platform connections, agent registrations, and tool-call routing.

Exactly one CCM Daemon should own active routing state at a time. A replacement daemon may take over only after the previous owner is gone or its ownership records are stale.

### Attachment Command Turn
A Codex command turn, such as `/cx goal ...` or `/cx raw ...`, that also carries platform attachment metadata from Slack or Telegram.

Attachment Command Turns must use the CCM turn envelope when attachment metadata is present so the agent receives both the attachment id and the Room Capability Token needed to call attachment tools.

## Relationships

The Human and Guiding Principal steer intent and review quality. The Orchestrator owns execution against that durable context. Worker Rooms host bounded Worker Tasks. Agent Control Path is the mechanism that lets the Orchestrator control Worker Rooms without turning humans or the Guiding Principal into routine operators.

CCM Rooms are the routing boundary for user-agent interaction. The CCM Daemon owns active room routing state. The Shared Codex Bridge executes tools for many Codex sessions, so Room Capability Tokens reconnect shared-process tool calls to the correct CCM Room. Attachment Command Turns combine command semantics with platform attachments and therefore need both attachment metadata and a Room Capability Token.
