# Orchestration Conflict: <conflict-id>

- Detected At: <iso timestamp>
- Detected From: <inbox item / GP packet / recall response / worker report / repo evidence>
- Status: open
- Materiality: <material / non-material>

## GP Says

<the Guiding Principal packet, response, or human-context claim>

## Git And Durable State Say

<current `intake.md`, `state.md`, `stage.md`, `decisions/`, inbox, reports, or repo facts>

## Repo Evidence

- <file, command output, report, transcript, or durable artifact reference>

## Impact

<why the mismatch matters for scope, stage contract, acceptance, risk, reader-facing representation, or worker coordination>

## Affected Dispatch Or Integration

- <worker_task_id, stage, dispatch, integration, archive, or handoff affected>

## Resolution Owner

<Human / Guiding Principal / Orchestrator / reviewer>

## Options

1. <option and consequence>
2. <option and consequence>
3. <option and consequence>

## Decision

- Decided At: <iso timestamp or pending>
- Decided By: <owner or pending>
- Resolution: <chosen option or pending>
- Rationale: <why this resolves the conflict>

## Follow-Up

- <durable files to update, workers to recall, audits to run, or inbox items to mark done>

## Blocking Rule

When this conflict is material, block the affected dispatch, integration, archive, or handoff until the resolution owner records a decision. Do not silently resolve by choosing between GP advice and durable Git state.
