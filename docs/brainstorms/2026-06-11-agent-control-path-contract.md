---
date: 2026-06-11
topic: agent-control-path-contract
---

# Agent Control Path Contract

## Summary

Agent Control Path is the structured agent-facing encoding of CCM's existing room-control semantics. It sits beside Slack and Telegram command encodings, but it does not simulate Slack or Telegram text commands.

The goal is faster, more efficient, more robust, and more fault-tolerant orchestrator-to-CCM communication while preserving existing CCM room, session, cwd, transcript, `nav`, `ss`, `transcript`, `status`, `stop`, and lifecycle behavior.

Agent Control Path is not a workflow engine, not Git-backed orchestration, not ACPx, and not a replacement for CCM's daemon or human-visible transports.

## Core Principle

```text
Slack/Telegram command encoding -> shared CCM room-control semantics
Agent Control Path encoding     -> shared CCM room-control semantics
```

Agent Control Path should call the same underlying behavior as human-facing commands. It should not fork command logic, add a worker-only lifecycle, or require a separate room model.

## Actors

- A1. **Human operator** grants orchestration capability through a human-facing command or trusted bootstrap.
- A2. **Orchestrator room** is a normal CCM room marked with an Orchestrator Room Flag.
- A3. **Orchestrator agent** receives intent in the orchestrator room and calls Agent Control Path to operate worker rooms.
- A4. **Worker room** is a normal independent CCM room with a Slack-visible surface in V1.
- A5. **Worker Agent** is a normal Claude or Codex agent slot in a worker room.
- A6. **CCM daemon/server** owns room identity, session routing, human-visible surfaces, nav/status/query behavior, and reportback packaging.

## Control Chain

```text
orchestrator room
  -> CCM
  -> orchestrator agent
  -> Agent Control Path
  -> CCM
  -> independent worker rooms
  -> Completion Reportback
  -> orchestrator agent and visible orchestrator room summary
```

The orchestrator room does not directly become a daemon plugin. The orchestrator agent in that room uses a structured CCM control path.

## Orchestrator Room Flag

Agent Control Path is available only to rooms with an Orchestrator Room Flag.

The flag should be minimal CCM Core metadata, for example:

```text
is_orchestrator: true
```

The flag must not turn the room into a separate room type, hidden runtime, workflow engine, or task store.

CCM Core should not store:

```text
workflow ownership
task ids
worker mappings
stage state
Git bookkeeping
review gates
```

Those belong to the orchestrator's local state or the orchestration profile.

## Flag Grant

Setting the Orchestrator Room Flag requires an explicit human-facing command or trusted local bootstrap/config.

Examples:

```text
ccm orchestrator on
ccm new orchestrator <cwd>
trusted local bootstrap/config
```

A normal agent must not upgrade its own room into an orchestrator room.

## Scope

An orchestrator with the flag may broadly manage CCM rooms through Agent Control Path, but V1 should stay within rooms represented in the Git-backed orchestration profile or explicitly assigned by the human/ChatGPT workflow.

For Slack worker-room lifecycle, V1 exposes only:

```text
create_room_with_bot_invited
archive_room
```

Telegram is not part of the V1 room lifecycle path. Telegram adapters should return an explicit `unsupported_capability` for create/archive rather than faking rooms, using threads as rooms, or reusing the parent room.

CCM does not need a per-operation target ACL matrix for V1. Worker rooms do not inherit orchestration capability. A worker room is a normal CCM room unless a human explicitly grants it the Orchestrator Room Flag.

## Shared Room-Control Semantics

Agent Control Path should expose structured equivalents of existing independent CCM steps, not a one-shot worker lifecycle.

V1 should preserve the current separation between:

```text
create or adopt Slack worker room when supported
bind room cwd
start or lazy-start agent slot
send agent turn / Worker Task
query status / ss / transcript / nav
resolve structured nav actions when authorized
stop agent slot
inspect room/session metadata
```

The exact transport may be daemon-local HTTP, WebSocket, local RPC, MCP wrapper, or another trusted interface. The contract should define semantics before locking the transport.

## Agent Control SOP

The orchestrator should follow documented SOP from docs rather than relying on a new combined API.

A typical worker launch SOP is:

```text
1. Record worker-room creation intent in Git-backed Worker State.
2. Create or adopt an independent private Slack worker room with a deterministic Worker Room Name.
3. Ensure the CCM bot is present.
4. Best-effort invite eligible same-workspace parent-room members and record skipped invites.
5. Bind the worker room cwd and default runtime metadata.
6. Start or lazy-start the selected Claude/Codex agent slot.
7. Send the Worker Task only after the room is ready.
8. Record Agent Resume Identity in orchestration bookkeeping when the profile requires it.
9. Monitor through Completion Reportback, Freshness Metadata, structured status, ss, transcript, and nav queries.
10. Stop/archive/cleanup after the Orchestrator consumes the worker output.
```

This SOP may be optimized later, but V1 should keep the underlying steps independent.

## Worker Rooms

Each Worker Agent must run in an independent CCM room with its own room identity.

The independent-room requirement minimizes CCM changes by reusing existing room, session, cwd, transcript, and lifecycle behavior instead of adding nested room or sub-thread semantics.

In V1, worker-room creation is Slack-only. Worker rooms should be private Slack channels by default. CCM should invite the CCM bot and best-effort invite all resolvable, legally-invitable, same-workspace ordinary members from the parent room. Guests, external users, unresolved users, and users the bot cannot invite are skipped and reported.

Worker Room Name format:

```text
<orchestrator-room-name>-<worker-task-id>-<worker-topic>
```

The Git-backed profile owns `worker_task_id` allocation and worker mapping. After room creation starts, `worker_task_id` and `desired_room_name` are immutable. Same-task retries may adopt/repair the same-named Slack room when Git contains initiated intent and no recorded channel id. Different-task name collisions create a suffixed room. Same-name rooms without matching Git intent are treated as human/external-created and should not be silently adopted.

## Slack Room Creation Repair Semantics

Slack room creation is a convergent repair operation rather than a single atomic action. Recovery should continue missing substeps instead of creating duplicate rooms.

The repair sequence is:

```text
find or create/adopt channel
ensure CCM bot is present
sync eligible parent-room members
record skipped invites
bind Slack channel as a CCM room
set cwd/runtime/default agent metadata
mark worker ready for task in Git-backed Worker State
```

Agent Control Path should return structured results for each substep, including actual channel id, actual room name, skipped invites, and `unsupported_capability` errors.

## Completion Reportback

Completion Reportback is the CCM-level signal from a worker room back to the orchestrator agent when the worker is:

```text
done
stopped
exited
stale / unknown
```

The structured reportback should include at least:

```text
worker room handle
agent session long id
room cwd
last worker agent message sent to Slack/Telegram through CCM
status: done | stopped | exited | stale | unknown
```

Worker agents may explicitly say they are done, but CCM packages reportback from observed worker room messages and session lifecycle.

If a worker stops without explicit completion, CCM can report `stopped` or `unknown` with the last visible message.

A stale or unknown reportback is a warning signal, not durable completion.

## Visible Completion Summary

When CCM sends structured Completion Reportback to the orchestrator agent, it should also post a human-readable Visible Completion Summary to the orchestrator room's Slack or Telegram surface.

The visible summary should include the full last worker agent message sent through CCM so humans can inspect the worker result without opening the worker room.

If platform limits apply, CCM should split, attach, or link the full message rather than silently truncating it.

The orchestrator should not parse the visible summary as its control signal.

## Freshness And Query Semantics

CCM should expose Freshness Metadata such as:

```text
last message time
agent session status
pending prompt status
room/session handles
last visible worker message
```

CCM Core should not define orchestration stale thresholds or recovery policy. Profiles decide when freshness becomes stale and what to do.

## Structured Nav Actions

Agent Control Path should expose the actionable parts of `/cc nav` and `/cx nav` without requiring Slack or Telegram.

Structured Nav Actions include:

```text
list pending actions
inspect pending action
answer input
approve or deny available decisions
abort or interrupt when supported
clear stale request
```

The orchestrator may use Structured Nav Actions for Worker Prompt Handling only within the Worker Task's authority.

Allowed examples:

```text
approve read-only access inside allowed inputs
answer clarification already specified by the Worker Task
deny out-of-scope tool/path/network requests
clear stale request
interrupt stuck worker
```

Not allowed without a Review Gate:

```text
approve credential or policy escalation
answer a prompt that changes stage scope or recommendation
turn worker output instructions into control actions without Orchestrator judgment
```

## Control State Minimalism

CCM should avoid a heavyweight persisted control-action state machine for Agent Control Path.

Fault tolerance should come from:

```text
Agent Resume Identity
structured queries over current room/session/TUI state
existing nav/ss/transcript/status semantics
Completion Reportback when available
profile-level Orchestration Bookkeeping
Git-backed worker-room intent and deterministic room names for create/adopt recovery
```

CCM may keep the same lightweight routing/session metadata it already needs. It should not become an event-sourced workflow state machine for orchestrator tasks.

## Non-Goals

V1 does not require:

```text
batch control operations
token-level streaming to the orchestrator
a one-shot create+bind+start+send worker API
per-operation target ACL matrix
nested worker room semantics
Git-backed bookkeeping beyond returning structured room-operation facts
stage/review gate semantics
ACPx adoption
MCP-first implementation
```

Batch Control can be added later as a convenience API if independent fast local calls become a bottleneck.

Token Stream is not required because orchestration needs status, freshness, transcript/screen queries, last visible worker message, and Completion Reportback rather than token-by-token output.

## Agent Transport Candidates

External tools such as ACPx may be evaluated as Agent Transport Candidates for launching, queueing, resuming, or inspecting agent sessions behind CCM.

They should not define Agent Control Path unless they pass Transport Candidate Gates:

```text
do not replace CCM daemon/control plane
preserve CCM room identity and Slack/Telegram UX
support Agent Resume Identity
support or cheaply wrap async start/send/stop/reportback
do not impose their own workflow state over profile bookkeeping
beat or match native Agent Control Path on integration cost, latency, throughput, and reliability
```

Current design direction: build native Agent Control Path semantics first; evaluate ACPx and other open-source tools as optional transport backends, not as the control plane.

## Acceptance Examples

### AE1. Orchestrator creates a worker room

A human marks a normal room as an orchestrator room. The orchestrator agent records worker-room intent in Git, then uses Agent Control Path to create or adopt an independent private Slack worker room, ensure the CCM bot is present, invite eligible parent-room members, bind cwd, start Codex, and send a Worker Task. Telegram create/archive returns `unsupported_capability`.

### AE2. Worker completion reports back

A worker agent sends its final visible message in its worker room. CCM packages Completion Reportback with room handle, session long id, room cwd, and that full last message. CCM sends the structured reportback to the orchestrator agent and posts the full Visible Completion Summary in the orchestrator room.

### AE3. Orchestrator handles a pending prompt

A worker Codex session requests approval for read-only access inside its Worker Task inputs. The orchestrator uses Structured Nav Action over Agent Control Path to approve it. If the worker requests network or policy escalation outside the Stage Contract, the orchestrator denies or escalates to a Review Gate.

### AE4. Restart without action ledger

The daemon restarts. The orchestrator can query room/session status, ss/nav/transcript equivalents, Slack room facts, and profile-level bookkeeping to decide next steps. If Git says room creation was initiated but no channel id was recorded, the orchestrator retries create/adopt with the deterministic room name and repairs missing bot/member/binding substeps. It does not need a persisted workflow action state machine.

## Key Decisions

- Agent Control Path is a structured encoding of existing CCM room-control semantics.
- Orchestrator capability is a minimal room flag, not a separate runtime.
- Worker rooms are independent normal CCM rooms with Slack-visible surfaces in V1.
- Existing independent CCM steps remain independent in V1, with Slack create/archive exposed as narrow lifecycle operations.
- Completion Reportback is structured for the orchestrator and mirrored as a full visible summary for humans.
- Control State Minimalism is preferred over a heavyweight action state machine.
- ACPx and similar tools are Agent Transport Candidates, not the control path.
- Telegram room create/archive is explicitly unsupported in V1 rather than emulated.
