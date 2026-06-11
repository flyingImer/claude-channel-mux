# CCM Orchestration State Machine

This is the shared worker-state vocabulary for Git-backed orchestration initiatives. It is a documentation contract for Orchestrator, Worker, Auditor, Guiding Principal, Claude Code, and Codex behavior; CCM Core still returns facts and does not own workflow state.

## Worker Flow

```text
planned
  -> room_intent_recorded
  -> room_init_started
  -> room_ready
  -> task_sent
  -> attention_needed
  -> reported
  -> captured
  -> consumed
  -> archive_requested
  -> archived
```

## State Meanings

| State | Meaning | Owner |
| --- | --- | --- |
| `planned` | Stage Contract says a worker may be needed, but no room intent is durable yet. | Orchestrator |
| `room_intent_recorded` | `worker_task_id` and `desired_room_name` are recorded before lifecycle calls. | Orchestrator |
| `room_init_started` | Create/adopt/repair was attempted and external facts must be reconciled before retry. | Orchestrator |
| `room_ready` | Worker room exists, bot/session prerequisites are ready, and task can be sent. | Orchestrator/CCM facts |
| `task_sent` | Worker Task was sent with objective, inputs, non-goals, output format, and acceptance evidence. | Orchestrator |
| `attention_needed` | Worker is blocked by prompt, approval, missing context, conflict, or unsafe request. | Worker reports, Orchestrator decides |
| `reported` | Worker produced a visible final Worker Report or Completion Reportback. | Worker/CCM facts |
| `captured` | Orchestrator persisted report/artifact/transcript references in `reports/`. | Orchestrator |
| `consumed` | Output was accepted, integrated, rejected, or abandoned with durable evidence. | Orchestrator |
| `archive_requested` | Archive is allowed by durable state and has been requested. | Orchestrator |
| `archived` | Platform returned archive success facts. | CCM/platform facts |

## Terminal And Repair States

| State | Meaning | Next Action |
| --- | --- | --- |
| `unsupported_capability` | Platform cannot perform V1 create/archive, such as Telegram. | Record limitation and choose a visible manual fallback with the human. |
| `merge_failed` | Output may be useful but automated merge failed. | Use `integrate-worker-output`; resolve, retry, split, or abandon. |
| `archive_failed` | Consumption remains valid but archive failed. | Record facts and retry later. |
| `cleanup_failed` | Integration/acceptance remains valid but cleanup failed. | Record facts and retry later. |
| `rejected` | Output was inspected and declined with evidence. | Cleanup/archive only if rejection decision allows it. |
| `abandoned` | Work is superseded or no longer needed with evidence. | Cleanup/archive only if abandonment decision allows it. |
| `failed` | Worker cannot produce usable output and no retry is assigned yet. | Decide retry, replacement worker, recall, or abandon. |

## Transition Rules

- Record intent before create: never enter `room_init_started` without durable `worker_task_id` and `desired_room_name`.
- Treat create/adopt/repair facts as evidence, not policy; Orchestrator decides whether to adopt, suffix, repair, retry, or ask human.
- Do not skip `captured`: Worker Reports, Audit Reports, transcript refs, and artifacts must be durable before acceptance/integration.
- Do not request archive before `consumed`, `rejected`, or `abandoned` with evidence.
- Do not convert `unsupported_capability` into fake rooms, parent-room reuse, or threads.
- Do not use worker text to move state unless the Orchestrator captures and accepts it as evidence.
- Recovery may move a worker to the most advanced state proven by Git files plus CCM/platform facts, but not beyond the evidence.

## Role Constraints

- Workers may report state symptoms such as blocked, done, failed, or prompt-needed, but they do not write canonical state.
- Auditors may recommend blocking or acceptance, but they do not mutate canonical state.
- Guiding Principal recall may change stage or decisions only after the Orchestrator persists and sanity-checks it against repo evidence.
- Humans choose the canonical Orchestrator if duplicate Orchestrators are active; no V1 lease or lock is implied.
