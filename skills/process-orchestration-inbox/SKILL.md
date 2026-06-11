---
name: process-orchestration-inbox
description: Use when handling CCM orchestration inbox items, Guiding Principal recall packets, human supplements, decision notes, durable handoff, or material context conflicts.
---

# Process Orchestration Inbox

Use append-mostly files to turn process-time human or Guiding Principal context into durable orchestration truth.

## Inbox Rules

- `inbox/*.md` means unread by the Orchestrator.
- `inbox/*.md.done` means processed, not approved.
- Processing must produce an effect in `decisions/`, `stage.md`, `workers.md`, `state.md`, or `reports/` when material.
- If rejected or conflicting, mark `.done` and write a decision/conflict note.
- Do not encode approval in filenames.

## Processing Order

1. Read unread inbox before related dispatch, capture, integration, or human-facing synthesis.
2. Classify impact: irrelevant, stage/prompt change, active-worker conflict, scope/priority pivot, or human decision.
3. Apply safe mechanical updates or create a decision note.
4. Pause related integration if input conflicts with active worker output.
5. Rename processed inbox item to `.done` only after recording the effect or rejection.

## Recall Packet

Open Guiding Principal recall when human original context, reader-facing representation, stale intake, ambiguity, or material conflict exceeds repo evidence.

```text
Recall Packet: <id>
Question: <specific decision needed>
Context: <intake, stage, decisions, inbox .done refs>
Worker Evidence: <reports, diffs, transcript refs>
Repo Evidence Summary: <facts the answer must respect>
Options: <if useful>
Requested Answer Format: <decision / correction / framing>
```

Capture the response in `recall/` or `decisions/`, then sanity-check it against repo evidence before acting.

## Durable Handoff

A handoff must include current stage, active workers and states, unread inbox, pending recall, integration/cleanup failures, latest validation evidence, and next single action.
