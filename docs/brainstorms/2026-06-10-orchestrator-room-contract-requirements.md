---
date: 2026-06-10
topic: orchestrator-room-contract
---

# Superseded Orchestrator Room Contract Requirements

## Status

This is an earlier combined requirements brainstorm. It remains useful historical context, but it is not the current V1 lifecycle baseline. Do not use this document for Agent Control Path lifecycle details where it conflicts with the current split docs:

```text
docs/brainstorms/2026-06-10-ccm-orchestrator-room-control-contract.md
docs/brainstorms/2026-06-10-git-backed-orchestration-profile.md
```

Use the split docs as the authoritative direction. This combined doc mixes CCM core room-control requirements with Git-backed orchestration profile concerns, including stage gates and durable coordination policy. In particular, current V1 lifecycle creation/archive is Slack-only, Telegram returns `unsupported_capability`, deterministic worker names are keyed by stable `worker_task_id`, and worker/task mappings live in Git-backed orchestration rather than CCM Core.

## Summary

CCM should evolve toward a uniform room contract with multiple channel adapters. Slack and Telegram remain normal human-facing channels, while a new Agent Control Path lets an Orchestrator use structured room-control operations, including Completion Reportback, without simulating Slack or Telegram commands. The Orchestrator is not a special daemon or separate product runtime; it is a regular Claude/Codex agent in a visible CCM room with explicit capabilities to operate other rooms.

## Actors

- A1. **Human operator** uses a Slack or Telegram CCM room to give goals, corrections, and high-level direction to the orchestrator.
- A2. **Orchestrator agent** is a normal CCM agent slot in a visible room, granted bounded capabilities for operating other CCM rooms.
- A3. **Worker Agent** is a normal Claude or Codex agent slot in a room created or selected by the Orchestrator.
- A4. **Channel adapter** maps platform-specific Slack, Telegram, or programmatic interactions into the shared CCM room contract.
- A5. **CCM daemon/server** owns room identity, permissions, lifecycle, dispatch, status, event routing, and durable transcripts.

## Requirements

### Room Model

- R1. CCM rooms must remain a single uniform entity regardless of whether they are reached by Slack, Telegram, programmatic tools, or another CCM agent.
- R2. Orchestrator-created rooms must use the same underlying room/session semantics as human-created rooms, not a separate worker-only model.
- R3. A room may have multiple interaction surfaces when policy allows, including a human channel surface and an orchestrator-control surface.
- R4. The orchestrator agent must be treated as a normal room participant with additional explicit capabilities, not as a privileged hidden control loop.
- R4a. A human must explicitly mark a room as an orchestrator room at creation time; once marked, CCM may grant that room's orchestrator agent the default capability to create and operate worker rooms under daemon policy.
- R4b. Current V1 lifecycle creation/archive is Slack-only and same-workspace policy-bound; Telegram creation/archive returns `unsupported_capability`, and cross-adapter or cross-workspace worker creation is deferred.
- R4c. CCM must durably record room role and capability facts needed for daemon authorization. Workflow ownership, worker mappings, task ids, deterministic name inputs, and sequence state live in Git-backed orchestration bookkeeping.

### Orchestrator Capabilities

- R5. V1 must let an orchestrator create a worker room, send an initial task, poll worker status/progress, and receive a final callback.
- R5a. V1 polling is a heartbeat and liveness check, not a full normalized status state machine: CCM should return the best available worker signal and enough freshness information for the orchestrator to infer whether the worker is still active, stuck, silent, or likely complete.
- R6. V1 must keep pause, resume, reassign, cancel, deep transcript query, and arbitrary nested spawning outside the required capability set.
- R7. Orchestrator-facing operations must be structured capabilities rather than requiring the agent to generate raw Slack/Telegram messages or fragile textual CCM commands.
- R8. Programmatic create and send operations must enter the same daemon room lifecycle and turn-dispatch path as ordinary CCM room interactions, or a named equivalent that produces identical binding, cwd, transcript, peer-routing, audit, and event behavior.
- R9. The daemon/server must enforce which orchestrator agents can create or operate which rooms; the orchestrator should not directly mutate daemon state files or bypass room policy.

### Worker Room Visibility And Lifecycle

- R10. V1 worker rooms should be externally visible by default, rather than purely headless, so humans can inspect raw worker progress directly.
- R11. V1 should prefer genuinely created platform rooms/channels/chats for workers when the channel adapter supports that capability.
- R12. Worker output must continue to appear in the worker room transcript and channel as normal room output.
- R13. The orchestrator should receive selected worker updates, with the final worker result pushed back by default and interim progress available through polling.
- R13a. Final callback routing must be backed by a durable worker subscription record that includes the parent orchestrator room key, child room key, create request ID, worker session ID and runtime, callback policy, idempotency key, and behavior when the parent room is missing or archived.
- R14. V1 worker rooms are task-scoped: after final completion, they should be automatically closed, archived, or otherwise marked inactive while preserving auditability.
- R14a. V1 completion/reportback signals may be runtime-specific: Codex can use structured final or error events, while Claude may use the best available stopped, idle, or transcript-derived completion signal defined during planning. Archive happens after the Orchestrator consumes worker output.
- R15. Closing or archiving a worker room must not erase the transcript, final result, or enough reference information for the orchestrator and human operator to understand what happened.
- R15a. The minimum machine reference after archive is a CCM resume bundle containing the room or channel key, runtime, CCM session ID, native session ID when applicable, cwd or workspace, transcript pointer, final turn or message ID when available, and parent Orchestrator room key.

### Channel Adapter Capabilities

- R16. Channel adapters must be able to declare whether they support creating visible rooms and archiving or closing those rooms.
- R17. When a requested lifecycle operation is unsupported by the selected channel, CCM must return `unsupported_capability` rather than silently pretending the operation succeeded.
- R18. Slack and Telegram must not be assumed to have identical lifecycle capabilities; the contract must tolerate platform-specific limits.
- R19. The programmatic interaction surface should be modeled as another channel-facing surface over the room contract, not as a new Claude/Codex agent driver.
- R19a. Structured orchestrator capabilities are the agent-facing API for the programmatic interaction surface; the daemon maps them into room-contract operations.

### Human Experience

- R20. The human operator should be able to interact with the orchestrator from an ordinary Slack or Telegram CCM room.
- R21. The orchestrator room should provide briefings, decisions, and final summaries rather than mirroring every worker token or low-value progress event.
- R22. The human operator should be able to inspect worker rooms directly when they want raw progress, debugging detail, or full context.
- R23. Worker room creation and finalization should produce enough visible context for a human to understand why the room exists and how it relates to the orchestrator request.
- R24. Worker room names should use immutable `worker_task_id` and `desired_room_name` values recorded by Git-backed orchestration before room creation starts.
- R25. V1 worker rooms should invite the CCM bot and the parent room humans by default, treating those humans as the orchestrator owners for worker-room visibility and participation.

## Acceptance Examples

- AE1. **Covers R1, R4, R5.** A human asks the orchestrator in a Slack CCM room to split a task three ways. The orchestrator creates three CCM rooms through structured capabilities, sends each one a task, polls them, and receives their final results without becoming a daemon-side special case.
- AE2. **Covers R10, R12, R13, R21.** During a worker run, detailed worker messages appear in the worker's visible channel. The orchestrator room does not mirror every message, but it can poll status and receives the final result when the worker stops.
- AE3. **Covers R14, R15.** After a worker completes, its visible channel is archived or marked inactive. A human can still find the transcript or final summary reference from the orchestrator context.
- AE4. **Covers R16, R17, R18.** If an adapter cannot create a new external chat, the Orchestrator receives a clear `unsupported_capability` response instead of parent-room reuse, threads, fake room identifiers, or any fallback that pretends to be worker-room creation.
- AE5. **Covers R4a, R6.** A human creates a CCM room and marks it as an orchestrator room. CCM grants only the V1 worker capabilities to that room's orchestrator agent; an unmarked room attempting the same operation receives a policy error.
- AE6. **Covers R24.** If the Orchestrator records `worker_task_id` values such as `audit-a`, `audit-b`, and `audit-c`, the desired worker room names are derived from those stable ids and task purposes before Slack creation starts.

## Key Decisions

- Orchestrator is an agent pattern, not a new agent driver or hidden daemon role.
- Rooms stay uniform; orchestration adds control surfaces and capabilities rather than a separate worker-room type.
- V1 favors visible worker rooms over headless workers so human observability remains native to CCM.
- Final worker output is pushed to the orchestrator; interim progress is primarily pulled through status polling.
- Channel lifecycle support is adapter-declared because Slack and Telegram capabilities differ.

## Scope Boundaries

### Deferred For Later

- Pause, resume, cancel, reassign, transcript search/query, and richer worker control.
- More than two orchestration layers, including worker rooms spawning their own worker rooms.
- Headless-only worker rooms as the default mode.
- Broad worker-room membership management beyond bot plus parent room humans.
- Read-only JSON event exports or JSONL event logs as observability surfaces.
- Reusable long-lived project rooms managed by an orchestrator.

### Outside V1 Identity

- A separate standalone orchestrator daemon that replaces agent reasoning.
- Direct state-file mutation by agents.
- Treating Slack/Telegram command text as the primary orchestrator API.
- Assuming every channel platform can create and archive rooms in the same way.

## Dependencies / Assumptions

- The existing CCM room, binding, agent event, and dispatch concepts are stable enough to become the foundation for the programmatic contract.
- Channel adapters can grow lifecycle capability declarations without breaking existing Slack/Telegram behavior.
- Visible worker room creation is acceptable from a workspace governance and permissions perspective where the adapter supports it.
- Archived worker rooms can preserve enough transcript and reference data for audit and later human inspection after the Orchestrator consumes worker output.

## Success Criteria

- A human can start from a normal Slack CCM room and ask an Orchestrator agent to create and coordinate worker rooms on adapters that declare the required lifecycle capabilities; unsupported adapters return `unsupported_capability`.
- Worker rooms behave like normal CCM rooms from the perspective of agents, transcripts, and visible channel output.
- The orchestrator can operate workers through structured capabilities without relying on brittle text command generation.
- Unsupported channel lifecycle operations fail or degrade explicitly.
- The design remains compatible with the existing CCM contract instead of forking orchestration into a separate product model.

## Outstanding Questions

### Deferred To Planning

- How should adapter capability declarations be represented and surfaced to the orchestrator?
- Superseded: Telegram worker-room creation/archive is an unsupported capability in V1.
- What best-available worker signals and freshness fields should the v1 heartbeat polling response include?
- What runtime-specific signals count as Completion Reportback for Claude and Codex, and when has the Orchestrator consumed enough output to archive?

## Sources / Research

- `docs/ccm-event-intake-feasibility-report.md` — prior feasibility report identifying existing room/session/event hooks and recommending event/status export as a small patch.
- `README.md` — current project framing: multi-channel, multi-agent session multiplexer with rooms, bindings, Slack/Telegram adapters, and Claude/Codex drivers.
- `daemon.ts` — current daemon owns dispatch, binding, room/session lifecycle, and agent event handling.
- `server.ts` — current MCP bridge already exposes room-aware tools and room token safety concepts.
- `adapters/slack.ts` — current Slack adapter supports message/thread operations but dynamic channel lifecycle appears to be a future adapter capability.
