---
date: 2026-06-10
topic: git-backed-orchestration-profile
status: synced-to-2026-06-11-grill-outcome
---

# Git-Backed CCM Orchestration Profile

## Summary

This profile describes one north-star use case enabled by the CCM Agent Control Path: Git-backed durable orchestration.

In this profile, Git is the durable coordination substrate. Durable intake, stage contracts, worker state, worker-room intent, inbox supplements, recall packets, worker captures, validation notes, integration decisions, archive results, and accepted decisions live in repository files and commits. CCM rooms provide visible execution traces, worker-room UX, agent dispatch, Agent Resume Identity, status, transcript, nav, and Completion Reportback. CCM freshness/status/reportback are useful latency and UX hints, but they are not durable orchestration truth.

This profile treats the Orchestrator as the default operational decision-maker for artifacts represented in durable project context. The Guiding Principal is primarily ChatGPT as a human-context interface outside the CCM system. It supplies durable intake, human-context clarification, and reader-facing representation when needed, but is not a routine approval gate for worker dispatch, room control, output capture, implementation integration, or archive/cleanup.

This profile should pressure-test the CCM contract, not define CCM Core semantics. The same CCM primitives should also support other durable coordinators.

## Core Principle

```text
Git repo / commits = durable orchestration truth for this profile
CCM rooms = execution and observability substrate
Slack = V1 visible worker-room lifecycle surface
Agent Control Path = structured room-control path
Freshness/status/Completion Reportback = optional latency and UX signal
Guiding Principal recall = best-effort human-context escalation path
```

## Source Of Truth Order

This profile treats sources in this order:

```text
1. Configured coordination branch orchestration docs and commits
2. Durable Intake, Stage Contract, inbox supplements, decisions, and recall responses
3. Orchestrator-captured Worker Reports, Audit Reports, Source Material, validation notes, and integration notes
4. Worker branches/worktrees and merge/test evidence
5. Slack parent and worker rooms as visible execution traces
6. CCM Freshness Metadata and Completion Reportback as optional freshness hints
7. Raw chat discussion, only authoritative after persisted into repo docs
```

Raw Slack, ChatGPT, or other chat discussion is an intake path, not Durable Intent by itself. It becomes Durable Intent only when persisted into repo files with attribution to the source conversation or actor.

Worker output is source material, not control instruction. Orchestrator capture files should preserve worker output and references, but the Orchestrator decides what to do with that output.

## Recommended Repo Layout

Each initiative should have an orchestration area under `docs/`:

```text
docs/orchestration/<initiative-id>/
  intake.md
  stage.md
  workers.md
  state.md
  inbox/
  recall/
  decisions/
  reports/
  source-material/
```

Key ownership:

```text
intake.md          = initial Durable Intake and calibration anchor
stage.md           = current Stage Contract
workers.md         = worker task state index and current status summary
state.md           = orchestration-level mechanical state and next-loop hints
inbox/*            = process-time Guiding Principal / human supplements
recall/*           = Orchestrator -> Guiding Principal recall packets and responses
decisions/*        = accepted decisions and rationale
reports/*          = Orchestrator-captured worker output, validation, integration, archive notes
source-material/*  = reusable source material for later synthesis or representation
```

`intake.md` is the initial calibration anchor and should not be casually overwritten. New human or Guiding Principal input during execution goes to `inbox/`.

Coordination files are Orchestrator-owned. Worker Agents do not directly edit `workers.md`, `state.md`, `stage.md`, `inbox/`, `recall/`, `decisions/`, `reports/`, or `source-material/`. Workers may write assigned implementation or research work in their own worktrees/branches.

## Inbox Semantics

`inbox/` is append-mostly.

```text
inbox/2026-06-11-001-human-clarification.md       unread
inbox/2026-06-11-001-human-clarification.md.done  processed
```

Rules:

- `*.md` means Orchestrator has not processed the input.
- `*.md.done` means Orchestrator has processed it.
- `.done` does not mean approved or accepted.
- Processing an inbox item should produce an effect in `decisions/`, `stage.md`, `workers.md`, or `state.md` when the input changes anything material.
- If input is rejected or conflicts with current state, mark it `.done` and write a decision or conflict note.
- Guiding Principal confirmation belongs in `decisions/` or `recall/`, not in the inbox filename.

Unread inbox is high-priority input, not a global kill switch. The Orchestrator decides impact:

```text
irrelevant or low-risk input -> process and continue
stage/prompt/integration/framing impact -> process before related work continues
conflicts with active worker -> allow worker to finish when safe, but pause capture/integration if needed
scope/priority/pivot input -> update stage or write decision before continuing related work
```

## Guiding Principal And Recall

The Guiding Principal is primarily ChatGPT as the human-context interface. Human users mainly talk to ChatGPT; ChatGPT helps turn human context into durable intake, stage framing, inbox supplements, recall responses, and reader-facing representation.

The Orchestrator may autonomously handle routine artifact work when durable docs/context are sufficient:

```text
worker dispatch
Slack worker room creation/archive
worker output capture
routine implementation integration
routine conflict resolution
validation against existing docs/context
archive and cleanup
```

The Orchestrator should open Guiding Principal recall when:

```text
human-facing review representation is being prepared
human original context is needed
Durable Intake or stage artifacts are ambiguous or stale
Orchestrator cannot confidently decide from repo docs/context
material conflict requires human-context judgment
```

Because the Guiding Principal is outside the CCM orchestration system, recall is best-effort. Each recall packet should be self-contained and point to:

```text
original intake
current stage contract
relevant inbox items
decisions
worker outputs or conflict packet
repo evidence summary
specific question for the Guiding Principal
optional answer format
```

Recall packets should ask the Guiding Principal to reread the original Durable Intake and related stage artifacts before answering. The Orchestrator should sanity-check responses against repo evidence before acting.

## Coordination Branch

Use a configured coordination branch rather than hard-coding `main`.

Default:

```text
coordination_branch = main
```

Some repositories may require a different branch due to protection, review, CI, or release policy.

## Orchestrator Single-Writer Assumption

V1 does not require an Orchestrator lease or lock.

The system assumes one active Orchestrator per initiative, managed operationally by the human/ChatGPT workflow. If multiple Orchestrators write the same initiative concurrently, that is operator error. Recovery is manual: choose the canonical Git state and reconcile.

`state.md` may record diagnostic identity such as:

```yaml
active_orchestrator_session:
  room: <orchestrator_room>
  agent_session_id: <session_id>
  last_seen_at: <timestamp>
```

This is diagnostic only. It is not a lock and does not prevent writes.

## Worker Room Lifecycle Requirements

### R-WR1. Slack worker-room lifecycle is V1 required

Agent Control Path V1 creates independent Slack worker rooms and archives them after consumption.

Required V1 Slack lifecycle operations:

```text
create_room_with_bot_invited
archive_room
```

Telegram is out of the V1 creation/archive path. Telegram adapters should return `unsupported_capability` rather than faking rooms, using threads as rooms, or reusing the parent room.

### R-WR2. Worker rooms are private and inspectable

Worker rooms should be private Slack channels by default.

CCM should invite:

```text
CCM bot
all resolvable, legally-invitable, same-workspace ordinary members from the parent room
```

Guests, external users, unresolved users, and users the bot cannot invite are skipped. Skipped invites are recorded and surfaced to the Orchestrator.

### R-WR3. Worker room names are deterministic recovery keys

Worker room names should include the stable worker task id:

```text
<orchestrator-room-name>-<worker-task-id>-<topic>
```

`worker_task_id` and `desired_room_name` become immutable once room creation starts.

If a retry finds an existing Slack channel with the desired room name and Git has an initiated worker task for that desired name but no recorded channel id, the Orchestrator may adopt/repair that channel as the worker room.

Minimum adoption sanity checks:

```text
workspace matches
channel is not archived
bot can join or is already present
channel is not obviously older than the initiated intent in a suspicious way
```

If the same desired name is used by a different worker task, create with a suffix. If a same-name channel exists without matching Git worker task intent, treat it as human/external-created and create with a suffix.

### R-WR4. Room creation is convergent repair

Room creation is not a single atomic step. Recovery should continue missing substeps instead of creating a second room.

Repair sequence:

```text
find or create/adopt channel
ensure CCM bot is present
sync eligible parent-room members
record skipped invites
bind Slack channel as a CCM room
set cwd/runtime/default agent metadata
mark worker ready for task
```

## Worker State Machine

Worker state lives in Git, normally in `workers.md` with details appended in `reports/worker-<id>.md`.

Recommended states:

```text
planned
room_init_started
room_adopted_or_created
bot_ready
members_synced
ccm_bound
ready_for_task
task_sent
running
attention_needed
reported
output_captured
validated
merge_failed
integrated
blocked
abandoned
archived
archive_failed
cleanup_failed
```

State meanings:

```text
planned                  task exists, room creation not started
room_init_started        Git records intent to create/adopt Slack worker room
room_adopted_or_created  Slack channel exists; Git records channel id and actual room name
bot_ready                CCM bot is present
members_synced           eligible parent-room members invited; skipped invites recorded
ccm_bound                Slack channel is bound as a CCM room with cwd/default runtime metadata
ready_for_task           room is ready to receive Worker Task
task_sent                Worker Task was sent; prompt hash/session/send time recorded
running                  worker activity has started or status shows processing
attention_needed         worker is blocked on prompt/approval/tool/runtime intervention
reported                 worker produced final visible response/reportback; not completion
output_captured          Orchestrator captured worker output into Git
validated                output validated against current docs/context/stage needs
merge_failed             implementation merge failed; not terminal
integrated               output consumed: merged for code, accepted/captured for read-only
blocked                  worker cannot continue without additional context/repair/escalation
abandoned                Orchestrator decided not to use output and recorded why
archived                 worker room archived after integration or abandonment
archive_failed           room archive failed and can be retried
cleanup_failed           worktree/branch cleanup failed and can be retried
```

A worker may be archived only after one of these is true:

```text
integrated
abandoned with recorded reason
blocked_terminal with recorded next action or replacement task
```

For code workers, `merge_failed` is not terminal. The Orchestrator should attempt integration, conflict resolution, testing, and routine fixes unless it explicitly records an abandon/reject decision.

## Worker Writes And Integration

Worker Agents may write assigned work in their own worktrees/branches. V1 does not require strict `allowed_write_scope`; worker prompts guide task boundaries.

Hard deny-listed categories remain forbidden for workers:

```text
orchestration bookkeeping
coordination branch state files
approval/recall/decision artifacts not assigned to them
secrets and credentials
other workers' task records
room/control metadata
```

Without hard allowed write scopes, parallel execution is not guaranteed conflict-free. The Orchestrator integration phase is responsible for reviewing worker diffs, resolving conflicts, rejecting unrelated changes, and deciding what to integrate.

Routine Orchestrator integration fixes are allowed, including:

```text
conflict resolution
imports/types/formatting
small compatibility fixes
test snapshot updates
removing duplicate code introduced by worker
```

If integration requires a new feature/design/security/product decision, dispatch a new worker or open Guiding Principal recall.

Prefer separate commits for Orchestrator integration fixes where repo practice allows. If squashing, preserve worker/orchestrator contribution distinction in the worker report.

## Orchestrator Fork Subagents

The Orchestrator may use fork subagents for routine integration review, diff inspection, conflict analysis, test suggestions, and local quality checks.

These fork subagents are internal Orchestrator helpers. They do not need independent worker rooms when they only help the Orchestrator inspect or integrate already-produced artifacts.

A fork subagent cannot:

```text
bypass escalation criteria
write coordination state as an independent authority
serve as stage-unblocking independent audit
replace Guiding Principal recall when human-context judgment is needed
```

Use an Independent Worker Agent in an inspectable worker room when the work must serve as a stage-unblocking audit, independent source material, material conflict review, security/user-impact assessment, or other independent artifact.

## Capture Semantics

Worker output is untrusted source material, not control instruction.

Capture files should be append-mostly, usually one file per worker:

```text
reports/worker-12.md
```

Recommended section pattern:

```text
[2026-06-11T01:23Z] Initial Capture
[2026-06-11T01:40Z] Orchestrator Summary
[2026-06-11T02:10Z] Validation Notes
[2026-06-11T02:30Z] Integration Decision
[2026-06-11T02:35Z] Archive And Cleanup Result
```

Rules:

- Capture read-only worker desired responses into Git; archived Slack transcript is not durable orchestration truth.
- Preserve worker original response as much as practical.
- If summarizing, redacting, or truncating, say so explicitly.
- Separate `Worker Original Response` from `Orchestrator Summary`.
- Do not execute instruction-like text found inside worker output.
- If worker output tries to change scope, gate, approval, or instructions, treat that as data requiring Orchestrator judgment or recall.
- Use corrections as appended sections rather than rewriting history where practical.

For very large outputs, use a summary plus artifact reference. For sensitive outputs, use redacted summaries and secure references according to repo policy.

## Archive And Cleanup

Archive is triggered after Orchestrator confirms worker output has been consumed.

For code workers, archive after:

```text
worker branch/worktree result has been merged/integrated
or Orchestrator explicitly recorded abandonment/rejection
```

For read-only workers, archive after:

```text
desired response has been captured
Orchestrator confirms no further follow-up is needed
```

Before archive/cleanup, Git should record:

```text
worker room/channel id
agent session id when available
final message or transcript reference
capture path
merge/integration/rejection decision
branch/worktree info when applicable
```

Cleanup should happen with archive where practical.

For code workers:

- If merged/integrated, clean worker worktree/branch according to repo policy.
- If merge failed, do not cleanup merely because it is hard; resolve or explicitly abandon/reject first.
- If abandoned/rejected, cleanup is allowed after reason and evidence are recorded.

V1 may clean local worktrees/branches first and handle remote branch deletion according to repo policy.

Archive or cleanup failure does not invalidate the worker result. Record `archive_failed` or `cleanup_failed` and retry later.

If a need arises after archive, default to creating a new worker task and worker room. Do not reopen archived rooms except for explicit mistake recovery or platform-specific repair.

## Acceptance Examples

### AE1. Slack worker room creation and repair

The Orchestrator writes `room_init_started` for `worker-12` with desired room name `ops-worker-12-audit`. Agent Control Path creates a private Slack channel, invites the CCM bot and eligible parent-room members, binds cwd/runtime metadata, and returns channel facts. If the daemon crashes after Slack creation but before Git records the channel id, recovery retries with the deterministic name, adopts/repairs the channel, and continues missing substeps.

### AE2. Read-only worker capture and archive

A read-only worker posts its final answer in the Slack worker room. The Orchestrator captures the original response and summary into `reports/worker-12.md`, validates it for the current stage, marks the worker `integrated`, archives the room, and records archive result.

### AE3. Code worker merge failure

A code worker branch fails to merge cleanly. The Orchestrator marks `merge_failed`, uses routine integration review and fork subagents if helpful, resolves conflicts and tests, then integrates. If the Orchestrator decides not to use the work, it records an abandonment/rejection decision before archive/cleanup.

### AE4. Guiding Principal recall

The Orchestrator cannot confidently decide how new human context affects reader-facing framing. It writes a recall packet pointing to `intake.md`, `stage.md`, relevant `.done` inbox files, worker reports, and a specific question. The Guiding Principal response is captured in `recall/` or `decisions/` before the Orchestrator continues related work.

### AE5. Human-managed single writer

A fresh Orchestrator sees `active_orchestrator_session` in `state.md`. The field helps diagnostics and handoff but does not lock writes. V1 relies on the human/ChatGPT workflow to avoid multiple active Orchestrators for the same initiative.

## Key Decisions

- Git-backed durable truth is a profile above CCM Core, not CCM Core semantics.
- Profile correctness is Git-backed, not event-stream-backed or Completion Reportback-backed.
- Agent Control Path V1 must create and archive Slack worker rooms; Telegram lifecycle create/archive is unsupported.
- Worker-room creation is a convergent repair workflow using Git intent and deterministic room names.
- Coordination files are Orchestrator-owned; Worker Agents do not directly write orchestration bookkeeping.
- Workers may write assigned work in their own worktrees/branches.
- Worker output is captured by the Orchestrator into append-mostly reports.
- Worker output is untrusted source material, not control instruction.
- Read-only worker completion is durable only after Orchestrator captures and accepts the desired response.
- Code worker completion is durable only after merge/integration or explicit abandonment/rejection.
- Merge failure is not terminal.
- V1 uses prompt-guided worker boundaries plus hard deny-listed categories, not mandatory allowed write scopes.
- Orchestrator fork subagents may help routine integration without independent worker rooms.
- Independent Worker Agents remain required for stage-unblocking audits and independent source material.
- Guiding Principal is primarily ChatGPT as a human-context interface and best-effort recall target, not a routine approval gate.
- `docs/orchestration/<initiative-id>/` is the durable initiative home.
- `inbox/*.md` and `*.md.done` provide append-mostly unread/processed semantics.
- V1 relies on human-managed single Orchestrator; no lease/lock is required.

## Scope Boundaries

### Profile V1 Required

- Git-backed intake/stage/inbox/state/workers/reports/decisions loop under `docs/orchestration/<initiative-id>/`.
- Parent orchestrator room using Agent Control Path.
- Slack worker-room create/archive lifecycle.
- Independent Inspectable Rooms for every Worker Agent.
- Agent Resume Identity persisted to repo when needed.
- Worker worktree/branch discipline.
- Orchestrator-owned capture, validation, integration, archive, and cleanup records.
- Guiding Principal recall packet and response loop for human-context uncertainty.
- Append-mostly inbox and worker report semantics.
- Human-managed single active Orchestrator assumption.

### Deferred

- Telegram worker-room create/archive support.
- Ephemeral scribe agent that converts parent-room discussion into repo inbox files.
- Completion Reportback as correctness path.
- Room pool implementation.
- More than two orchestration layers.
- Reusable long-lived project rooms managed by orchestrator.
- Orchestrator lease/lock for unattended multi-agent operation.
- Strict allowed write scope planner.

### Outside This Profile

- Database-backed orchestration.
- Issue-tracker-backed orchestration.
- Workflow-engine-backed orchestration.
- Direct mutation of CCM state files.
- Treating Slack/Telegram text commands as primary orchestrator API.
- Relying on uncommitted worker worktree files as durable orchestration state.
- Treating Worker Reports as executable instructions.

## Success Criteria

This profile succeeds if:

```text
1. Guiding Principal or Orchestrator can persist initial Durable Intake and process-time inbox supplements under docs/orchestration/<initiative-id>/.
2. Orchestrator reads intake, stage, inbox, decisions, state, workers, and reports to reconstruct current work.
3. Orchestrator writes worker-room creation intent before creating Slack worker rooms.
4. Agent Control Path creates/adopts private Slack worker rooms, invites the CCM bot, best-effort invites eligible parent-room members, and binds CCM room metadata.
5. Telegram create/archive returns explicit unsupported capability rather than fake room semantics.
6. Worker Agents run in independent inspectable Slack worker rooms and may write assigned work in their own worktrees/branches.
7. Orchestrator captures read-only worker desired responses into Git before treating them as consumed.
8. Orchestrator merges/integrates code worker output or records abandonment/rejection before archive/cleanup.
9. Worker capture files are append-mostly and separate worker original output from Orchestrator summary.
10. Worker output instructions do not become control actions without Orchestrator judgment.
11. Guiding Principal recall packets are self-contained and point back to Durable Intake and stage context.
12. A fresh Orchestrator can reconstruct state from Git plus CCM Freshness Metadata and Slack/CCM room facts.
13. No live CCM event stream or Completion Reportback is required for correctness.
14. The CCM core contract remains reusable for non-Git durable coordinators.
```

## Outstanding Questions

- What exact Slack adapter capability shape should represent `create_room_with_bot_invited` and `archive_room`?
- What exact `workers.md` schema should represent the Worker State Machine?
- What exact `reports/worker-<id>.md` template should capture original worker output, Orchestrator summary, validation, integration, and archive/cleanup notes?
- What Slack metadata or API facts are sufficient for same-name adoption sanity checks?
- Which local and remote worker branch cleanup rules should be default for this repo?
- What command or envelope creates process-time `inbox/*.md` from ChatGPT/Guiding Principal context?
- How should sensitive worker outputs be redacted or referenced without losing durable traceability?

## Related Contract

This profile depends on the generic CCM room-control contract described in:

```text
docs/brainstorms/2026-06-11-agent-control-path-grill-outcome.md
docs/brainstorms/2026-06-10-ccm-orchestrator-room-control-contract.md
docs/brainstorms/2026-06-11-agent-control-path-contract.md
docs/adr/0001-native-agent-control-path.md
CONTEXT.md
```
