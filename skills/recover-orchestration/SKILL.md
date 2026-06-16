---
name: recover-orchestration
description: Use when CCM orchestration needs recovery after restart, crash, partial room creation, duplicate orchestrators, stale worker state, archive failure, cleanup failure, or unsupported platform behavior.
---

# Recover Orchestration

Recover from Git state plus CCM/platform facts. Do not invent workflow truth from chat logs or daemon memory.

If recovery must call Agent Control Path tools from Codex, require an opaque `ccm_room_token` from the current `<ccm_turn>`. Native Codex `/goal` turns, Codex internal goal continuations, `CC_CHANNEL_SESSION_UUID`, `CODEX_CHANNEL_SESSION_UUID`, and `ccm-shared-codex-app-server` are not valid room tokens; record the blocker and ask for a fresh parent CCM room `/cx goal ...` or `codex:` cue.

## Restart Runbook

1. Stop new dispatch. Read `state.md`, `workers.md`, latest `stage.md`, unread `inbox/`, `decisions/`, and `reports/`.
2. Confirm human-managed single Orchestrator. If another active session may exist, ask the human to choose canonical state before writing.
3. Inspect CCM room status, screen/nav, transcript, Agent Resume Identity, and Slack room facts for each non-terminal worker.
4. Reconcile each worker to the most advanced state proven by both Git and external facts.
5. Write a recovery note in `reports/` or `state.md` with evidence and next action.

## Create/Adopt/Repair

For workers at or after `room_init_started`:

```text
find or create/adopt channel
ensure CCM bot is present
sync eligible parent-room members
record skipped invites
bind Slack channel as CCM room
set cwd/runtime/default agent metadata
mark ready_for_task only after evidence
```

Adopt only when Git intent matches the desired room name, workspace matches, channel is not archived, bot can join or is present, and age is not suspicious. Otherwise suffix the desired name or ask the human.

## Failure States

- `unsupported_capability`: record platform limitation; do not fake rooms, reuse parent rooms, or emulate with threads.
- `archive_failed` / `cleanup_failed`: keep worker result valid, record failure, retry later.
- `merge_failed`: not terminal; use `integrate-worker-output`.
- Unknown reportback: inspect transcript/session before marking `reported`.
- Duplicate Orchestrators: freeze writes, pick canonical Git state, record reconciliation.

## Recovery Output

When available, use `prompts/ccm/recovery.md`, `docs/checklists/recovery.md`, and `docs/orchestration/_templates/recovery-note.md` to make recovery portable across Claude Code and Codex.

```text
Recovery Note: <timestamp>
Observed Git State: <worker/state refs>
External Facts: <room/session/transcript/status refs>
Decision: <resume | repair | retry | abandon | ask human>
Next Action: <single concrete step>
```
