---
title: Agent Control Path V1 Implementation Plan
date: 2026-06-11
status: draft
source_docs:
  - docs/brainstorms/2026-06-11-agent-control-path-grill-outcome.md
  - docs/adr/0001-native-agent-control-path.md
  - docs/brainstorms/2026-06-11-agent-control-path-contract.md
  - docs/brainstorms/2026-06-10-git-backed-orchestration-profile.md
---

> Superseded on 2026-06-16: Agent Control Path authorization no longer depends on `ccm_room_token`. Shared Codex bridge calls route by explicit parent `chat_id` plus current Codex room binding, then require the parent room's orchestrator flag.

# Agent Control Path V1 Implementation Plan

## Goal

Implement the V1 Agent Control Path so a Git-backed Orchestrator can create independent Slack worker rooms, route CCM agents into those rooms, consume durable worker output, and archive worker rooms after output has been consumed.

V1 intentionally keeps CCM Core semantically minimal. CCM exposes room lifecycle capabilities and structured operation facts; Git-backed orchestration owns worker/task mapping, create/adopt/repair intent, deterministic naming, inbox semantics, recall packets, integration, archive timing, and recovery decisions.

## Scope

### In Scope

- Add typed room lifecycle capability contracts for:
  - `create_room_with_bot_invited`
  - `archive_room`
- Implement Slack support for private worker-room creation and archival.
- Return `unsupported_capability` for Telegram and other adapters without lifecycle support.
- Best-effort invite the CCM bot and eligible same-workspace ordinary parent-room members to Slack worker rooms.
- Surface structured room-operation facts to the caller.
- Gate lifecycle operations on the minimal Orchestrator Room Flag.
- Expose the capabilities through the daemon/MCP control path.
- Add Git-backed orchestration state files and task mappings outside CCM Core workflow semantics.
- Add an Orchestrator loop skeleton that can create/adopt/repair worker rooms, capture output, and archive after consumption.
- Add focused tests for adapter contracts, Slack request shaping, daemon routing, unsupported capability handling, and Git-backed state transitions.

### Out of Scope

- Telegram worker-room create/archive implementation.
- Emulating Telegram worker rooms with fake room IDs, parent-room reuse, or thread-as-room fallback.
- CCM Core ownership of worker lifecycle decisions, task assignment semantics, inbox semantics, or integration policy.
- Distributed Orchestrator lease/lock in V1.
- Mandatory Guiding Principal approval gates for routine worker output integration.
- Direct production push or merge automation before durable output has been captured and reviewed by Orchestrator policy.

## Current Codebase Anchors

- `adapters/types.ts` defines the `ChannelAdapter` contract used by daemon code.
- `adapters/slack.ts` owns Slack Web API calls, Socket Mode events, Slack thread fetch, message send/edit, reactions, uploads, and Slack-specific rendering.
- `adapters/telegram.ts` implements the same adapter interface for Telegram and should explicitly report lifecycle unsupported rather than silently omit semantics.
- `daemon.ts` resolves CCM rooms, channel keys, adapter instances, bindings, session routing, command handling, and MCP tool dispatch.
- `server.ts` exposes MCP tools (`reply`, `react`, `download_attachment`, `fetch_thread`, `ask_peer`, `chime_in`) and forwards tool calls to the daemon.
- `state.ts` contains JSON normalization helpers for persisted daemon state.
- Existing tests under `test/*.test.ts` use Bun and should be extended with small focused tests rather than broad live Slack integration tests.

## Key Technical Decisions

### KTD-1: Put lifecycle capability in the adapter contract

Add optional lifecycle methods and typed result objects in `adapters/types.ts` rather than special-casing Slack directly in daemon or server code.

Rationale: daemon can keep routing and authorization concerns separate from platform-specific API details, while unsupported adapters can return the exact V1 `unsupported_capability` shape.

Directional contract:

```text
createRoomWithBotInvited(parentRoom, desiredRoomName, invitePolicy) -> RoomOperationResult
archiveRoom(room, reason) -> RoomOperationResult
```

The concrete TypeScript names can follow existing style, but the externally visible operation names must remain `create_room_with_bot_invited` and `archive_room`.

### KTD-2: Slack adapter owns Slack API details

`adapters/slack.ts` should own calls such as `conversations.create`, `conversations.invite`, `conversations.info`, `conversations.members`, `users.info`, and `conversations.archive`.

Rationale: Slack-specific constraints such as private-channel creation, bot membership, same-workspace filtering, archived/existing-channel API facts, and skipped-invite details belong with Slack API code. The Slack adapter reports existing/archived channel facts and API errors; the Git-backed Orchestrator decides whether an existing room is adoptable, repairable, rejected, or requires a suffixed name.

### KTD-3: Daemon exposes structured operation facts, not workflow policy

`daemon.ts` should route lifecycle tool calls to the correct adapter and validate room tokens/channel identity, then return facts such as platform, channel ID, channel name, created/existing/archived API status, invited/skipped members, and error codes.

Rationale: preserving the baseline boundary prevents CCM Core from becoming the Orchestrator.

### KTD-4: Git-backed orchestration state lives outside core room operation code

Add orchestration state under a dedicated repo-local profile/state path, with explicit mappings from `worker_task_id` and `desired_room_name` to Slack channel facts and worker output artifacts.

Rationale: deterministic naming and create/adopt/repair semantics are Orchestrator responsibilities, not Slack adapter responsibilities.

### KTD-5: Test without live Slack dependency

Use injected or mocked Slack Web API clients for unit tests. Do not require real Slack credentials for CI or local validation.

Rationale: lifecycle behavior is mostly request shaping, error mapping, and state transition logic; live Slack testing belongs in a separate manual/e2e checklist.

## Implementation Units

### Unit 1: Room Lifecycle Types and Unsupported Capability Baseline

Files:

- `adapters/types.ts`
- `adapters/telegram.ts`
- `test/adapter-payload.test.ts` or a new `test/room-lifecycle-types.test.ts`

Work:

- Define lifecycle operation names, request types, result types, and a structured `unsupported_capability` result.
- Add optional lifecycle methods to `ChannelAdapter` or a nested capability object.
- Ensure Telegram explicitly reports unsupported for `create_room_with_bot_invited` and `archive_room` if called through a helper, without adding fake room behavior.

Acceptance:

- Tests prove unsupported adapters return the exact `unsupported_capability` code and include platform/operation context.
- Existing adapter interface users still typecheck.

### Unit 2: Slack Worker-Room Lifecycle Implementation

Files:

- `adapters/slack.ts`
- `test/slack-room-lifecycle.test.ts`

Work:

- Add Slack private-channel creation for deterministic `desired_room_name`.
- Invite the CCM bot after creation when Slack does not already include it.
- Best-effort invite eligible same-workspace ordinary parent-room members.
- Report skipped members with reasons such as bot user, external user, deactivated user, already in channel, invite failure, or unavailable profile details.
- Implement archive via `conversations.archive`.
- Map common Slack errors into structured operation facts rather than opaque strings.

Acceptance:

- Tests cover create success, existing/archived channel fact reporting, bot invite behavior, member invite filtering, partial invite failures, Slack API error mapping, and archive success/failure.
- No test requires live Slack tokens.

### Unit 3: Shared Daemon Room-Control Operations

Files:

- `daemon.ts`
- `server.ts`
- `server-ipc.ts` or `ipc.ts` if a shared message type is introduced
- `test/server-ipc.test.ts`
- `test/slack-identity.test.ts` or a new `test/room-control-daemon.test.ts`

Work:

- Add MCP tools or internal tool-call routes for `create_room_with_bot_invited` and `archive_room`.
- Route calls through the existing daemon IPC path instead of bypassing room token enforcement.
- Require the caller room to carry the minimal Orchestrator Room Flag before either lifecycle operation is allowed.
- Ensure worker rooms do not inherit Agent Control Path capability merely because they were created by an orchestrator room.
- Resolve parent room/channel keys using existing binding and adapter helpers.
- Return structured JSON content to the caller.
- Fail closed when the caller lacks a valid `ccm_room_token` or targets a room outside its authority.

Acceptance:

- Tests prove Slack calls reach the lifecycle adapter method with the expected parent room and desired name.
- Tests prove Telegram returns `unsupported_capability`.
- Tests prove invalid room token or missing adapter fails without side effects.
- Tests prove unflagged rooms and worker rooms fail closed for both lifecycle operations.

### Unit 4: Git-Backed Orchestration Profile and State

Files:

- New orchestration module, for example `orchestrator/profile.ts`
- New orchestration state module, for example `orchestrator/state.ts`
- `test/orchestrator-state.test.ts`
- Documentation updates if file layout differs from this plan

Work:

- Define a profile file format that records Orchestrator room identity and worker task mappings.
- Persist immutable `worker_task_id` and `desired_room_name` before room creation starts.
- Record room facts returned by CCM lifecycle calls.
- Represent create/adopt/repair/archive intent explicitly.
- Decide adopt/repair/reject/suffixed-name outcomes from Git-backed state and Slack facts, never inside the Slack adapter.
- Represent worker output consumption status separately from room archival status.

Acceptance:

- Tests prove `worker_task_id` and `desired_room_name` become immutable after creation starts.
- Tests prove same-task retry can adopt/repair the same desired room mapping.
- Tests prove different-task name collisions require a distinct suffixed desired room name.
- Tests prove archive cannot be marked requested until output is marked consumed.

### Unit 5: Orchestrator Loop Skeleton

Files:

- New orchestration runner, for example `orchestrator/runner.ts`
- `commands.ts` or a small command module if a CLI entry is added
- `test/tasks.test.ts` or new `test/orchestrator-runner.test.ts`

Work:

- Add a minimal Orchestrator loop that reads task mappings, calls CCM lifecycle operations, records facts, and writes state transitions.
- Keep task assignment and integration policy in the Orchestrator layer, not daemon or adapter code.
- Add capture placeholders for worker output artifacts and recall packets.
- Add archive-after-consumption transition.

Acceptance:

- Tests cover create → output captured → output consumed → archive requested → archived.
- Tests cover create failure, unsupported capability, partial invite facts, and repair retry.
- Runner behavior is deterministic from state files and injected CCM client responses.

### Unit 6: Documentation and Operator Verification

Files:

- `CONTEXT.md`
- `docs/adr/0001-native-agent-control-path.md` only if implementation details need an accepted-decision update
- New operator checklist, for example `docs/agent-control-path-v1-operator-checklist.md`

Work:

- Document exact V1 capability surface, Slack scope assumptions, structured result examples, and manual Slack e2e checklist.
- Keep older brainstorm docs as history rather than editing them into implementation manuals.
- Add any required Slack app manifest scope notes if new scopes are required.

Acceptance:

- Docs distinguish authoritative runtime contract from historical brainstorm material.
- Manual checklist covers private channel creation, bot invitation, best-effort member invite, unsupported Telegram response, and archive.

## Suggested Execution Order

1. Unit 1: establish types and unsupported baseline.
2. Unit 2: implement Slack adapter lifecycle with mocked Slack tests.
3. Unit 3: expose daemon/MCP room-control operations.
4. Unit 4: add Git-backed orchestration state/profile.
5. Unit 5: add Orchestrator loop skeleton.
6. Unit 6: update operator docs and e2e checklist.

This order keeps platform capability proven before orchestration depends on it, and keeps CCM Core boundaries visible before adding higher-level workflow semantics.

## Subagent-Driven Development Breakdown

Use `$superpowers:subagent-driven-development` after this plan is accepted. Dispatch one implementation subagent per unit, sequentially, with spec-compliance and code-quality review after each unit.

For each unit, provide the subagent:

- This plan section for the unit.
- The baseline docs listed in frontmatter.
- The relevant codebase anchors from this plan.
- A hard constraint that CCM Core must not own Orchestrator semantics.
- A hard constraint that Telegram create/archive is unsupported in V1 and must not be emulated.

Do not dispatch implementation subagents in parallel because Units 1-3 touch shared adapter and daemon contracts.

### Controller Preconditions

- Do not start implementation while on `main` unless the human explicitly authorizes implementation on `main`.
- Before dispatching Unit 1, run `git status --short` and confirm the only intentional changes are this plan or already-accepted work.
- Provide each implementer the unit brief below, not just the plan path.
- After each implementer returns, run spec compliance review before code quality review.
- Do not advance to the next unit while either review has unresolved issues.

### Unit 1 Implementer Brief

Implement the Room Lifecycle Types and Unsupported Capability Baseline.

Context:

- Source plan section: Unit 1.
- Baseline docs: `docs/brainstorms/2026-06-11-agent-control-path-grill-outcome.md`, `docs/adr/0001-native-agent-control-path.md`, `docs/brainstorms/2026-06-11-agent-control-path-contract.md`, `docs/brainstorms/2026-06-10-git-backed-orchestration-profile.md`.
- Relevant files: `adapters/types.ts`, `adapters/telegram.ts`, `test/adapter-payload.test.ts` or a new `test/room-lifecycle-types.test.ts`.

Hard constraints:

- V1 lifecycle operations are exactly `create_room_with_bot_invited` and `archive_room`.
- Telegram create/archive returns `unsupported_capability` and must not emulate worker rooms with fake IDs, parent-room reuse, or thread-as-room fallback.
- CCM Core must expose structured room-operation facts only; it must not own worker/task mapping, deterministic naming, or Orchestrator policy.

Expected result:

- Typed lifecycle request/result definitions exist.
- Unsupported capability helper/result shape exists and is tested.
- Existing adapter users still typecheck.

Targeted verification:

```text
bun test test/room-lifecycle-types.test.ts
bun run typecheck
```

### Unit 2 Implementer Brief

Implement Slack Worker-Room Lifecycle support.

Context:

- Source plan section: Unit 2.
- Relevant files: `adapters/slack.ts`, `test/slack-room-lifecycle.test.ts`.
- Unit 1 must already be complete.

Hard constraints:

- Slack creates private worker rooms for the requested `desired_room_name`.
- Slack adapter reports Slack API facts and errors; it does not decide adopt/repair/reject/suffixed-name policy.
- Bot invite is required when not already present; ordinary parent-room member invites are best-effort and same-workspace only.
- Partial ordinary-member invite failure must be reported as structured facts, not silently swallowed.

Expected result:

- Slack lifecycle methods call Slack Web API through injected/mocked seams that are testable without live credentials.
- Tests cover create success, existing/archived channel fact reporting, bot invite behavior, member filtering, partial invite failure, error mapping, archive success, and archive failure.

Targeted verification:

```text
bun test test/slack-room-lifecycle.test.ts
bun run typecheck
```

### Unit 3 Implementer Brief

Expose shared daemon room-control operations.

Context:

- Source plan section: Unit 3.
- Relevant files: `daemon.ts`, `server.ts`, `server-ipc.ts` or `ipc.ts`, `test/server-ipc.test.ts`, `test/room-control-daemon.test.ts` if added.
- Units 1 and 2 must already be complete.

Hard constraints:

- Calls must flow through the existing daemon IPC/tool-call path.
- Lifecycle calls fail closed without valid `ccm_room_token` authority.
- Lifecycle calls fail closed unless the caller room has the minimal Orchestrator Room Flag.
- Worker rooms do not inherit Agent Control Path capability merely because they were created by an orchestrator room.
- Telegram returns `unsupported_capability` through the same public path.

Expected result:

- `create_room_with_bot_invited` and `archive_room` are available to authorized orchestrator rooms.
- The daemon returns structured JSON operation facts.
- Tests prove valid Slack routing, Telegram unsupported handling, invalid token rejection, missing adapter rejection, unflagged room rejection, and worker-room non-inheritance.

Targeted verification:

```text
bun test test/room-control-daemon.test.ts
bun test test/server-ipc.test.ts
bun run typecheck
```

### Unit 4 Implementer Brief

Add Git-backed orchestration profile and state.

Context:

- Source plan section: Unit 4.
- Relevant files: new `orchestrator/profile.ts`, new `orchestrator/state.ts`, `test/orchestrator-state.test.ts` unless repo conventions suggest better names.
- Unit 3 must already expose structured lifecycle operation facts.

Hard constraints:

- Git-backed orchestration owns `worker_task_id`, `desired_room_name`, task mappings, create/adopt/repair intent, collision decisions, and archive decisions.
- `worker_task_id` and `desired_room_name` are immutable after room creation starts.
- Archive request state is separate from worker output consumption state.
- V1 must not implement a distributed Orchestrator lease or lock; any active-orchestrator/session field is diagnostic only and must not prevent writes.

Expected result:

- Profile/state modules can load, validate, mutate, and persist orchestration state deterministically.
- Tests prove same-task retry can adopt/repair the same mapping, different-task name collisions require a suffixed name, and archive cannot be requested before output is consumed.
- If new `orchestrator/**/*.ts` production files are added, `tsconfig.json` include patterns cover them so `bun run typecheck` checks them directly.

Targeted verification:

```text
bun test test/orchestrator-state.test.ts
bun run typecheck
```

### Unit 5 Implementer Brief

Add the Orchestrator loop skeleton.

Context:

- Source plan section: Unit 5.
- Relevant files: new `orchestrator/runner.ts`, `commands.ts` only if a CLI entry is added, `test/orchestrator-runner.test.ts`.
- Unit 4 must already provide deterministic state operations.

Hard constraints:

- The Orchestrator layer owns task assignment and integration policy.
- CCM Core remains a room-operation provider and does not gain workflow semantics.
- Archive happens only after worker output is captured and marked consumed.
- Guiding Principal recall is best-effort human-context recall/interface, not a routine approval gate.

Expected result:

- Runner can progress create → output captured → output consumed → archive requested → archived using injected CCM client responses.
- Tests cover create failure, unsupported capability, partial invite facts, and repair retry.

Targeted verification:

```text
bun test test/orchestrator-runner.test.ts
bun run typecheck
```

### Unit 6 Implementer Brief

Update docs and operator verification.

Context:

- Source plan section: Unit 6.
- Relevant files: `CONTEXT.md`, `docs/adr/0001-native-agent-control-path.md` only if implementation details change accepted decisions, new `docs/agent-control-path-v1-operator-checklist.md`, `slack-app-manifest.json` if scopes need documenting.
- Units 1-5 should be complete so docs describe implemented behavior, not guesses.

Hard constraints:

- Keep brainstorm docs as history unless a specific correction is necessary.
- Documentation must preserve Slack-only V1, Telegram `unsupported_capability`, Orchestrator Room Flag gating, and archive-after-consumption semantics.

Expected result:

- Operator checklist covers private channel creation, bot invitation, best-effort same-workspace ordinary parent-member invite, unsupported Telegram response, and archive.
- Slack scope assumptions are documented.

Targeted verification:

```text
git diff --check
bun run typecheck
```

### Reviewer Briefs

Spec compliance reviewer prompt for each unit:

```text
Review the completed Unit N changes against docs/plans/2026-06-11-agent-control-path-implementation.md and the four source docs listed in its frontmatter. Do not review general code quality yet. Identify any under-build, over-build, or baseline contradiction. Pay special attention to Slack-only V1, exact operation names, Telegram unsupported/no emulation, Orchestrator Room Flag gating, CCM Core semantic minimalism, Git-backed ownership of mappings/naming/adopt/repair/archive decisions, archive-after-consumption, and no V1 lease/lock. Return approved or concrete required fixes with file references.
```

Code quality reviewer prompt for each unit:

```text
Review the completed Unit N changes for maintainability, test quality, minimality, and consistency with existing repo style. Assume spec compliance has already passed. Do not request scope expansion. Return approved or concrete required fixes with file references.
```

Final reviewer prompt after all units:

```text
Review the full Agent Control Path V1 implementation against docs/plans/2026-06-11-agent-control-path-implementation.md and the source baseline docs. Confirm every implementation unit is complete, tests cover the acceptance criteria, CCM Core remains semantically minimal, Orchestrator state owns workflow semantics, and no unsupported Telegram fallback or unflagged lifecycle access exists. Return approved or concrete required fixes.
```

## Verification Strategy

Run, at minimum:

```text
bun test
bun run typecheck
git diff --check
```

Prefer more targeted test runs while iterating:

```text
bun test test/slack-room-lifecycle.test.ts
bun test test/room-control-daemon.test.ts
bun test test/orchestrator-state.test.ts
bun test test/orchestrator-runner.test.ts
```

Manual Slack e2e verification should be documented but not required for ordinary unit-test completion unless live Slack credentials and a safe test workspace are available.

## Risks and Mitigations

- Slack scopes may be insufficient for creating, inviting, listing, or archiving private channels. Mitigate by documenting required scopes and returning explicit missing-scope errors.
- Slack channel-name collisions can happen despite deterministic names. Mitigate by keeping collision policy in Orchestrator state and recording adopted/suffixed outcomes.
- Inviting ordinary parent-room members can fail partially. Mitigate by treating member invites as best-effort facts, not all-or-nothing success.
- Daemon tool expansion can accidentally bypass room-token authority. Mitigate with fail-closed tests around tool routing.
- Orchestrator state can drift from Slack reality. Mitigate with create/adopt/repair state transitions and explicit facts from CCM operations.

## Open Questions

- Exact Slack scopes needed by the current installed app should be confirmed against `slack-app-manifest.json` during Unit 2 or Unit 6.
- The final file names for orchestration modules can change if repo conventions point to a better home, but orchestration code should remain separate from adapter and daemon room-control code.
- Whether Agent Control Path tools are exposed only to bound agent sessions or also to a standalone orchestrator client should be decided during Unit 3 based on the existing IPC/MCP registration model.
