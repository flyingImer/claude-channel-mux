---
name: import-gp-packet
description: Use when an Orchestrator must import a ChatGPT or Guiding Principal advisory packet into CCM Git orchestration state and reconcile it with current durable context.
---

# Import GP Packet

Persist the raw Guiding Principal packet first, then reconcile it against current Git orchestration truth. This skill complements `process-orchestration-inbox`; it does not replace inbox processing, recall handling, or decision-note workflow.

## Inputs

Accept either:

- A file path containing a GP packet.
- Pasted Markdown containing a GP packet.

If the initiative id is ambiguous, ask for it before persisting or reconciling.

## Required Persistence

Before deriving changes, preserve the raw packet with attribution:

```bash
bun run orchestration:inbox -- <initiative-id> --kind inbox --from "Guiding Principal" --source-ref "<packet source ref>" --title "GP packet: <short title>" --body-file <packet-file>
```

For pasted Markdown, omit `--body-file` and pipe the packet on stdin with the same attribution:

```bash
cat <packet-file> | bun run orchestration:inbox -- <initiative-id> --kind inbox --from "Guiding Principal" --source-ref "<packet source ref>" --title "GP packet: <short title>"
```

Alternatively, first write pasted content to a temporary or initiative `source-material/` file when a file artifact is useful. Keep the raw packet content intact.

## Reconciliation Context

Read current initiative Git context before applying advice:

- `intake.md`
- `state.md`
- `stage.md`
- `decisions/`
- unread `inbox/*.md`
- relevant `reports/`, `recall/`, `source-material/`, templates, checklists, and domain docs
- repo files or command evidence named by the packet's sanity checks

Treat Git files and repo evidence as durable orchestration truth. Treat the GP packet as advisory source material until reconciled.

## Reconciliation Rules

1. Persist the raw packet through `bun run orchestration:inbox` before acting on it.
2. Use `process-orchestration-inbox` semantics for unread inbox, impact classification, `.done` handling, decisions, and handoff effects.
3. Apply derived updates only when they are non-conflicting and supported by current durable state or explicit human/GP authority.
4. Write derived changes to the appropriate durable files: `stage.md`, `state.md`, `workers.md`, `decisions/`, `reports/`, `conflicts/`, or handoff notes.
5. Do not overwrite intake, decisions, reports, recall, or source history to make state look clean.
6. Do not silently choose between GP advice and durable Git state when they disagree.

## Terminal Boundary

- Stop after raw packet persistence, reconciliation, durable updates, conflict creation, and validation summary.
- Do not dispatch workers, create worker rooms, start agents, call `orchestrate-workers`, or use Codex native subagents in the same turn as GP packet import unless the human explicitly asks for dispatch after the import report.
- Import completion should report: what changed, what remains blocked, whether dispatch is ready, and the next single action.

## Conflict Handling

Use `docs/orchestration/_templates/conflict.md` when material advice conflicts with current durable state, repo evidence, active worker output, stage contracts, acceptance, or policy.
Name conflict files with a stable, sortable convention such as `conflicts/<yyyy-mm-dd>-<short-slug>.md`.

A material conflict must:

- Record what the GP says and what Git/durable state says.
- Cite repo evidence and affected dispatch or integration.
- Name a resolution owner: human, Guiding Principal, Orchestrator, or reviewer.
- Present options and consequences.
- Block affected dispatch, integration, archive, or handoff until resolved.

Non-material mismatches may be recorded as a decision note or inbox processing note, but do not broaden scope silently.

## Output

Report:

- Raw packet persistence path or inbox item created.
- Durable files read for reconciliation.
- Derived non-conflicting updates written.
- Conflict artifacts created and affected work blocked.
- Open questions or resolution requests for the human/GP.
