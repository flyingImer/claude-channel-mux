# Agent Control Path V1 Contract

Agent Control Path V1 exposes narrow room lifecycle operations to an agent in a CCM room whose binding has `isOrchestrator: true`.

The product intent is hands-off execution after direction is set: humans and the Guiding Principal steer intent, quality bars, framing, and key review gates; the parent-room Orchestrator uses Agent Control Path to coordinate worker rooms, make bounded low-level execution decisions, and escalate only when durable context is insufficient.

## Operations

### `create_room_with_bot_invited`

Input:

- `chat_id`: current orchestrator room channel key.
- `ccm_room_token`: opaque room-session token when required by the runtime.
- `parent_chat_id`: parent room channel key whose eligible ordinary members may be invited best-effort.
- `desired_room_name`: Orchestrator-owned desired worker room name.

Result facts:

- Slack may return created, existing, archived, bot-invite, member-invite, and bind facts.
- Telegram returns `unsupported_capability`.
- CCM Core does not decide adopt, reject, repair, or suffix policy.

### `archive_room`

Input:

- `chat_id`: current orchestrator room channel key.
- `ccm_room_token`: opaque room-session token when required by the runtime.
- `room_id`: platform-local worker room id to archive.

Result facts:

- Slack may return archived or failure facts.
- Telegram returns `unsupported_capability`.
- Archive timing belongs to Git-backed Orchestrator state and must happen after consumption or explicit rejection/abandonment.

### `bind_worker_room`

Input:

- `chat_id`: current orchestrator room channel key.
- `ccm_room_token`: opaque room-session token when required by the runtime.
- `room_id`: worker room channel key or platform-local id returned by create/adopt.
- `cwd`: absolute working directory for the worker room.
- `runtime`: default worker agent runtime, `claude` or `codex`.

Result facts:

- Records worker-room cwd/runtime metadata from the parent Orchestrator context.
- Ensures the worker room does not inherit `isOrchestrator`.
- Does not start execution or send task text.

### `start_worker_agent`

Input:

- `chat_id`: current orchestrator room channel key.
- `ccm_room_token`: opaque room-session token when required by the runtime.
- `room_id`: worker room channel key or platform-local id.
- `runtime`: worker agent runtime, `claude` or `codex`.

Result facts:

- Starts, resumes, or reports an already-running worker session in the worker room.
- Requires prior `bind_worker_room` cwd metadata.
- This explicit operation is part of the contract; `send_worker_task` must not hide lazy-start behavior.

### `send_worker_task`

Input:

- `chat_id`: current orchestrator room channel key.
- `ccm_room_token`: opaque room-session token when required by the runtime.
- `room_id`: worker room channel key or platform-local id.
- `runtime`: worker agent runtime, `claude` or `codex`.
- `text`: bounded Worker Task prompt.
- `thread_id`: optional worker-room thread/message pointer.

Result facts:

- Delivers the Worker Task to the worker room's bound agent as a worker-room turn.
- Returns the synthetic message/thread ids used for later transcript/reportback capture.
- Requires an already-started/running worker agent.

### `capture_worker_report`

Input:

- `chat_id`: current orchestrator room channel key.
- `ccm_room_token`: opaque room-session token when required by the runtime.
- `room_id`: worker room channel key or platform-local id.
- `runtime`: worker agent runtime, `claude` or `codex`.
- `limit`: optional maximum transcript entries to return.

Result facts:

- Retrieves worker-room transcript/reportback facts from the parent Orchestrator room.
- Returns transcript source, path when available, recent entries, and latest assistant message candidate.
- Does not mark output accepted, consumed, or archived; the Orchestrator must persist the Worker Report into Git-backed `reports/` before making those state transitions.

## Required Parent-Controlled Worker Execution

Creating a worker room is not sufficient orchestration success. After create/adopt, the Orchestrator control path must support operating the worker room from the parent room without asking the human to manually type commands in the worker room.

The required worker execution path is:

1. Bind worker room cwd/runtime/default agent metadata from the Orchestrator parent context with `bind_worker_room`.
2. Start or resume the assigned worker agent in the worker room with `start_worker_agent`.
3. Send the bounded Worker Task to that worker agent with `send_worker_task`.
4. Monitor or retrieve the worker room reportback/transcript facts with `capture_worker_report`.
5. Capture the Worker Report into Git-backed `reports/` before acceptance, abandonment, or archive.

Manual human or Guiding Principal commands inside the worker room are allowed only as optional observation/inspection or as a degraded recovery fallback. If the orchestration depends on human or Guiding Principal intervention to bind, start, prompt, debug, or unblock a worker room, that is an orchestration failure and must not be counted as successful autonomous orchestration.

## Invariants

- Worker rooms do not inherit `isOrchestrator`.
- Lifecycle operations are never emulated on unsupported platforms.
- CCM Core returns facts; orchestration policy lives outside CCM Core.
- Completion Reportback and transcripts are freshness/evidence signals, not durable orchestration truth until captured.
- Parent-controlled bind/start/send/capture is part of the orchestration contract; create/archive-only control is incomplete.
