---
date: 2026-06-10
topic: ccm-orchestrator-room-control-contract
---

# CCM Orchestrator Room Control Contract

## Summary

CCM should provide a uniform, authorized, observable room-control substrate that can be used by human-facing channels and programmatic orchestrator-facing surfaces.

Slack and Telegram remain normal human-facing channel adapters. A new Agent Control Path gives a marked orchestrator room's normal agent a structured way to operate the same room-control semantics without simulating Slack or Telegram text commands. The orchestrator is not a separate product runtime, not a hidden daemon loop, and not a new agent driver. It is a regular CCM agent slot in a visible room with an Orchestrator Room Flag.

Git-backed orchestration is an important north-star use case, but it is not part of the CCM core contract. CCM should enable an orchestrator to bind room handles and execution traces to an external durable coordination system such as Git, a database, an issue tracker, or a workflow engine.

The goal is not to remove ChatGPT or humans from orchestration judgment. The goal is to remove them from low-level transport operations while letting profiles decide when human-context recall is needed. In the current Git-backed profile, the Guiding Principal is primarily ChatGPT as a best-effort human-context interface rather than a routine approval gate.

## Core Principle

```text
CCM core = room-control and observability substrate
External durable system = source of orchestration truth
Orchestrator agent = operational coordination through Agent Control Path
Slack/Telegram = human-visible transport
Agent Control Path = structured encoding of existing room-control semantics
Agent events/status = optional freshness and UX signals
```

The CCM contract should expose stable primitives and handles. It should not embed any one durable-truth strategy, repository layout, workflow policy, merge policy, or stage-gate model.

Profile-specific gates may require an orchestrator to stop before major transitions, ask for durable Guiding Principal recall, and resume only after an external coordinator records the response. CCM core should support that pattern through normal room/session handles, visible worker rooms, structured status/nav/transcript queries, and Completion Reportback, but it should not define the profile's review authority, file layout, or approval semantics.

## Actors

- A1. **Human operator** uses a Slack or Telegram CCM room to provide goals, corrections, approvals, and high-level direction.
- A2. **Orchestrator agent** is a normal Claude or Codex agent slot in a visible room marked by an Orchestrator Room Flag.
- A3. **Worker Agent** is a normal Claude or Codex agent slot in an independent worker room created, selected, or assigned by the Orchestrator. V1 worker-room creation is Slack lifecycle support only; unsupported adapters return `unsupported_capability`.
- A4. **Channel adapter** maps Slack, Telegram, or future platform-specific interactions into the shared CCM room contract.
- A5. **Programmatic control surface** maps structured tool/API calls into the same room lifecycle and dispatch semantics.
- A6. **CCM daemon/server** owns room identity, permissions, lifecycle, dispatch, session routing, visible UX, audit, and durable CCM metadata.
- A7. **External durable coordinator** stores intent, progress, decisions, reports, approvals, and recovery state outside CCM core semantics.

## Non-Goals

CCM core should not define or require:

```text
Git repository layout
work-plan.md / state.md semantics
worker worktree policy
merge or push discipline
stage-gate recall/review policy
issue tracker workflow
business-specific task schema
Completion Reportback as correctness source
profile-owned normalized worker state machine
workflow ownership/task ids/worker mappings in CCM Core
```

Those belong to orchestration profiles built on top of CCM.

## Room Model Requirements

### R1. Rooms remain uniform

CCM rooms must remain a single uniform entity regardless of whether reached by Slack, Telegram, programmatic tools, or another CCM agent.

### R2. Worker rooms use normal room/session semantics

Orchestrator-created rooms must use the same underlying room, binding, session, transcript, and dispatch semantics as human-created rooms.

### R3. Rooms may have multiple interaction surfaces

A room may have a human channel surface and a programmatic control surface when daemon policy allows.

### R4. Orchestrator is a role, not a hidden daemon

The orchestrator agent is a normal room participant in a room with an Orchestrator Room Flag. It is not a privileged hidden control loop and not a new agent driver.

### R4a. Human explicitly grants orchestrator role

A human or trusted administrative workflow must explicitly mark or create a room as an orchestrator room before that room's agent receives worker-control capabilities.

### R4b. Broadness is policy-controlled

The daemon may allow broad room management for an orchestrator room, but the orchestrator normally manages rooms it created or rooms listed in its local/profile state. Managing other existing rooms should require explicit human instruction.

### R4c. CCM stores minimal orchestration metadata

CCM Core should store only the minimal metadata needed to know that a room is an orchestrator room:

```text
is_orchestrator: true
```

CCM Core should not store workflow ownership, worker mappings, task ids, stage state, or Git-backed bookkeeping. Those belong to Orchestrator Local State or a profile's Orchestration Bookkeeping.

## Canonical Control Contract

### R-C1. Structured operations are canonical

The orchestrator should not generate raw Slack/Telegram messages or fragile textual commands as its primary control path. It should call structured operations that map into the same daemon room lifecycle and dispatch semantics as human interactions.

### R-C2. Human text commands are transport encodings

Human-facing commands such as these are adapter-level encodings:

```text
ccm /path
ccm new codex
/cc goal ...
/cx raw /goal ...
```

The canonical daemon-level contract should be structured actions such as:

```text
bind_room
create_room
select_room
start_agent
send_turn
send_agent_command
get_status
get_room_reference
mark_inactive
archive_room
```

### R-C3. Human and programmatic paths share semantics

Slack/Telegram adapters should parse human text, buttons, or files into shared room-control semantics. Agent Control Path should construct structured calls into the same semantics. The implementation should avoid divergent paths:

```text
bad: human parser path vs special worker-code path
good: human adapter and Agent Control Path both call shared room-control service functions
```

### R-C4. Operations return durable handles

Room creation, agent start/resume, status, transcript, nav, and Completion Reportback operations should expose enough stable handle information for an external coordinator to persist and later reconcile:

```text
orchestrator room key when applicable
worker room key when applicable
platform channel id / url when available
adapter id
agent runtime
CCM session id
native session id when known
cwd / workspace
turn or command id when available
transcript pointer or room reference
created/updated timestamps
current lifecycle marker
```

### R-C5. Prefer control state minimalism

Agent Control Path should not require CCM to persist a heavyweight control-action state machine. Fault tolerance should come from stable room/session handles, Agent Resume Identity, structured queries over current CCM and TUI state, Completion Reportback, and profile bookkeeping.

## Orchestrator Capabilities

### R5. V1 required capabilities

V1 should let an authorized orchestrator:

```text
create/select an independent worker room
bind room cwd
start or lazy-start a Claude or Codex agent slot
send a worker task or message
query structured equivalents of nav/ss/transcript/status
handle structured nav actions within task authority
stop an agent slot
receive Completion Reportback
```

These are structured encodings of existing CCM room-control semantics. V1 should not introduce a one-shot worker lifecycle API.

### R5a. Status is freshness, not durable truth

CCM status and events should provide best-available freshness signals, not universal orchestration truth.

Useful V1 signals include:

```text
room exists
agent slot started
last activity time
last outbound message reference
last visible worker message
runtime known running/stopped/error signal when available
pending prompt status
needs attention / unsupported / policy denied marker
```

An orchestration profile may choose to treat these as hints while using an external durable system for correctness.

### R6. Out of V1 capability set

V1 does not require:

```text
pause
resume
reassign
automatic cancel/retry policy
deep transcript query
arbitrary nested spawning
full event stream
headless or hidden worker rooms
token-level stream to the orchestrator
batch control operations
one-shot worker lifecycle API
```

These may be added later if the core contract leaves room for them.

### R7. Daemon enforces authorization

The daemon/server must enforce that only rooms with the Orchestrator Room Flag can use Agent Control Path. Agents must not directly mutate CCM daemon state files.

## Worker Room Visibility And Lifecycle

### R10. Worker rooms are independent and visible

Every Worker Agent must run in an independent CCM room with its own room identity and a visible surface. V1 worker-room creation/archive is Slack-only; Telegram lifecycle operations return unsupported capability responses rather than emulated worker rooms.

Independent worker rooms minimize CCM changes by reusing existing room, session, cwd, transcript, and lifecycle behavior instead of adding nested room or sub-thread semantics.

### R11. Prefer genuine platform rooms

CCM should create worker rooms using the same adapter/workspace/channel context as the orchestrator room by default. Cross-adapter or cross-workspace worker rooms should require explicit human instruction.

### R12. Worker output remains normal room output

Worker output must appear in the worker room transcript and visible channel as normal CCM room output.

### R13. Parent room gets summaries, not token mirroring

The parent orchestrator room should receive Visible Completion Summaries. A Visible Completion Summary should include the full last worker agent message sent through CCM; if platform limits apply, CCM should split, attach, or link the full message rather than silently truncating it.

The parent room should not mirror every worker token or low-value event.

### R14. Worker rooms are task-scoped by default

A worker room created for a task remains inspectable after completion. The normal worker lifecycle is Complete And Stop: after durable output is written, the active Claude or Codex agent slot is stopped while the room remains inspectable.

### R15. Finalization preserves auditability

Stopping a worker agent or archiving/closing a room must not erase transcript, final result references, or enough handle information for later inspection.

Minimum reference bundle:

```text
room or channel key
adapter id
runtime
CCM session id
native session id when applicable
cwd/workspace
transcript pointer
final turn or message id when available
parent orchestrator room key
external artifact references when provided by the orchestrator
```

The minimal Agent Resume Identity is room cwd plus the full agent session long id.

## Channel Adapter Capabilities

### R16. Adapters declare lifecycle capabilities

Channel adapters must declare whether they support:

```text
create visible room/channel/chat
invite members/bot
archive/close room
rename/topic update
room pooling or leasing
direct room URL
thread-only fallback
```

### R17. Unsupported operations fail explicitly

When a requested lifecycle operation is unsupported, CCM must return `unsupported_capability`. It must not silently pretend success or degrade into emulated worker-room behavior.

### R18. Slack and Telegram differ

The contract must tolerate platform-specific lifecycle limits. Slack and Telegram must not be assumed equivalent.

## Parallelism And Dispatch

### R-P1. Contract should not force serialization

The control contract should allow independent worker rooms to be created, started, and messaged concurrently or through non-blocking dispatch.

### R-P2. Batch operations are optional but useful

Batch creation/start may be added as an optimization. V1 can expose single-room operations if they are idempotent and fast enough to compose safely.

### R-P3. Room pool mode should remain possible

The room lifecycle contract should not preclude future allocation modes:

```text
create_new
lease_from_pool
reuse_existing
```

Room pooling may be deferred, but the handle model should be compatible with it.

## Security And Authorization

### R-A1. Orchestrator flag enables broad management

An orchestrator room with the Orchestrator Room Flag may broadly manage CCM rooms through Agent Control Path. In normal operation, the orchestrator manages rooms it created or rooms listed in Orchestrator Local State or profile bookkeeping; other existing rooms require explicit human instruction.

### R-A2. Worker rooms do not inherit orchestration

Worker rooms created by an orchestrator do not inherit the Orchestrator Room Flag:

```text
orchestrator room: is_orchestrator=true
worker room: is_orchestrator=false
```

Nested orchestration requires explicit human grant.

### R-A3. Trusted flag grant

Setting the Orchestrator Room Flag requires an explicit human-facing command or trusted local bootstrap/config. A normal agent must not upgrade its own room into an orchestrator room.

### R-A4. Direct state-file mutation is forbidden

Agents must interact through CCM semantic operations. They must not directly mutate daemon state files.

### R-A5. Prefer control state minimalism

CCM should avoid a heavyweight persisted control-action state machine for Agent Control Path. Fault tolerance should come from Agent Resume Identity, structured queries over current room/session/TUI state, existing nav/ss/transcript/status semantics, Completion Reportback when available, and profile-level Orchestration Bookkeeping.

## Acceptance Examples

### AE1. Split task through structured room control

A human asks an orchestrator in a Slack CCM room to split work three ways. The orchestrator uses Agent Control Path to create three independent private Slack worker rooms, ensure the CCM bot is present, best-effort invite eligible parent-room members, bind cwd, start worker agents, send each task, and record Agent Resume Identity externally when its profile requires it.

### AE2. External durable coordinator binds handles

An orchestrator persists returned room handles and Agent Resume Identity into a Git repo, issue tracker, database, or workflow engine. CCM does not need to know which durable system is used.

### AE3. Visible worker progress

During a worker run, detailed worker messages appear in the worker's visible room. When the worker completes, CCM sends structured Completion Reportback to the orchestrator agent and posts a Visible Completion Summary containing the full last worker message in the orchestrator room.

### AE4. Adapter capability failure

If Telegram cannot create a new external chat, the orchestrator receives a clear `unsupported_capability` response, not a fake room identifier, parent-room reuse, or thread pretending to be a room.

### AE5. Orchestrator role grant

A human marks a room as an orchestrator room. CCM stores minimal metadata such as `is_orchestrator: true`. An unmarked room attempting Agent Control Path operations receives a policy error.

### AE6. Restart by external coordinator

After an orchestrator restarts, it uses its external durable coordinator to reload room handles and Agent Resume Identity, then calls CCM to inspect room references and current freshness signals.

## Key Decisions

- CCM core is a room-control and observability substrate, not an orchestration strategy engine.
- Git-backed durable truth is a north-star use case, not a CCM core semantic dependency.
- Orchestrator is an agent pattern, not a new agent driver or hidden daemon role.
- Rooms stay uniform; orchestration adds control surfaces and capabilities, not a separate worker-room model.
- Worker agents run in independent visible worker rooms for human observability and minimal CCM changes. V1 creation/archive support is Slack-only; Telegram create/archive is unsupported rather than emulated.
- Structured operations are canonical; Slack/Telegram text commands are adapter encodings.
- Agent Control Path is the agent-facing structured encoding of the same room-control semantics.
- CCM Core stores only a minimal Orchestrator Room Flag, not workflow ownership or task state.
- Control State Minimalism is preferred over a heavyweight control-action state machine.
- CCM status/events are useful freshness signals but should not be required for durable orchestration correctness.

## Scope Boundaries

### V1 Required

- Parent orchestrator room role and authorization.
- Agent Control Path exposing structured equivalents of existing create/select/bind/start/send/nav/ss/transcript/status/stop semantics.
- Durable room/session handles.
- Minimal Orchestrator Room Flag metadata.
- Adapter lifecycle capability declarations.
- Independent Slack worker room create/archive support.
- Completion Reportback and Visible Completion Summary.

### Deferred

- Pause/resume/reassign/cancel.
- Deep transcript search/query.
- Profile-owned normalized worker status state machine.
- Public JSON event export or JSONL observability API.
- Headless-only workers as default.
- More than two orchestration layers.
- Room pool implementation.
- Batch operations if single-room operations are adequate for V1.
- Token-level stream to the orchestrator.
- One-shot worker lifecycle API.

### Outside CCM Core

- Git repo path conventions.
- `work-plan.md`, `state.md`, or inbox file semantics.
- Worker worktree discipline.
- Merge/push policy.
- Stage-gate approval policy.
- Business or project-specific task schemas.
- Treating Slack/Telegram text commands as the primary orchestrator API.
- Agent Transport Candidate adoption such as ACPx.

## Success Criteria

A V1 CCM room-control implementation succeeds if:

```text
1. A human can mark a visible room as an orchestrator room.
2. The orchestrator can operate existing room-control semantics through Agent Control Path without simulating Slack/Telegram commands.
3. The orchestrator can create/select independent Slack-visible worker rooms, while Telegram create/archive returns explicit unsupported capability responses.
4. Worker rooms use normal CCM room/session/dispatch/transcript behavior.
5. Unsupported adapter lifecycle operations fail or degrade explicitly.
6. Completion Reportback reaches the orchestrator agent and Visible Completion Summary reaches the orchestrator room.
7. CCM avoids storing workflow ownership, worker mappings, task ids, or stage state.
8. CCM does not require Git, event streams, or Completion Reportback for durable orchestration correctness.
9. A Git-backed orchestration profile can be built on top without special CCM code paths.
```

## Outstanding Questions

- Which code path should host the canonical command bus or `RoomService`?
- What is the exact V1 operation envelope and response schema?
- What is the exact Agent Control Path transport after the contract is accepted?
- What is the minimum worker room handle returned by room creation?
- What Slack lifecycle operations can be supported immediately?
- Superseded by current baseline: Telegram create/archive returns `unsupported_capability` in V1 rather than using fallback worker-room emulation.
- How should structured `nav`, `ss`, `transcript`, and `status` responses be shaped?

## Source Anchors

Use these source areas when validating implementation feasibility:

```text
docs/brainstorms/2026-06-11-agent-control-path-contract.md
docs/adr/0001-native-agent-control-path.md
CONTEXT.md
```

```text
README.md
  Project framing: multi-channel, multi-agent session multiplexer with rooms, bindings, Slack/Telegram adapters, and Claude/Codex drivers.

daemon.ts
  Daemon-owned dispatch, binding, room/session lifecycle, and agent event handling.

agents/types.ts
  Existing AgentSession, AgentTurn, AgentCommand, AgentEvent, AgentDriver SPI.

agents/codex/app-server-driver.ts
  Existing Codex app-server event bridge and turn lifecycle mapping.

server.ts
  MCP bridge and room-aware tools / room token safety concepts.

adapters/slack.ts
  Slack adapter message/thread behavior and future lifecycle capability declarations.

bindings.ts / state.ts
  Existing binding/session/persistence helpers.
```
