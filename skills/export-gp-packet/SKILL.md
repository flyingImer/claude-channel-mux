---
name: export-gp-packet
description: Use when ChatGPT or a Guiding Principal must export advisory CCM orchestration judgment as a standardized packet for an Orchestrator to import later.
---

# Export GP Packet

Use `guide-orchestration` judgment to package Guiding Principal advice without operating the repo.

## Role Boundary

- You are exporting advisory input, not updating orchestration source of truth.
- Do not read, reconcile, mutate, or validate repo files as part of this skill.
- Do not dispatch workers, process inbox, update decisions, or resolve conflicts.
- Preserve attribution and source references from the conversation, pasted context, docs, issues, transcripts, or user-provided refs.
- If repo facts are uncertain, put them in `Repo Sanity Checks` instead of asserting them as truth.

## Output Destination

- If the user gives a file path, write the packet to that path.
- If the user asks for chat output or gives no path, output the packet as fenced Markdown in chat.
- If writing a file would require choosing a path and chat output would be insufficient for the user's stated workflow, ask whether to write a file or return chat only.
- Do not ask when chat output is acceptable; default to a chat packet.

## Packet Shape

Use `docs/orchestration/_templates/gp-packet.md` when available. Keep these sections:

- Metadata: packet id, timestamp, exporter, intended initiative, destination, advisory status.
- Source References: attributed links, message refs, transcript refs, docs, issues, PRs, or file refs.
- Intent: the directional guidance or framing.
- Quality Bars: evidence, audit, acceptance, safety, or reader-facing thresholds.
- Non-Goals: work the Orchestrator should not infer.
- Acceptance: observable outcomes or evidence.
- Risks: uncertainty, stale assumptions, trade-offs, or failure modes.
- Open Questions: ambiguity that may require human, GP, or repo evidence.
- Decision Requests: explicit decisions requested.
- Repo Sanity Checks: facts the Orchestrator must verify before acting.
- Export Instructions: advisory status, preserve raw packet, reconcile before acting, escalate conflicts.

## Export Rules

1. Gather only the context already provided in the conversation or explicitly referenced by the user.
2. Apply `guide-orchestration` framing to separate intent, quality bars, non-goals, risks, and decisions.
3. Keep unverified repo claims as sanity checks or questions.
4. Preserve source attribution even when summarizing.
5. Emit one complete packet to the requested path or fenced Markdown chat block.
