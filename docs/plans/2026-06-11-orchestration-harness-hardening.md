# Orchestration Harness Hardening Plan

## Purpose

Make the Git-backed CCM orchestration profile reliable across Claude Code, Codex, and future agent runtimes by moving recurring role contracts out of prose-only docs into portable instructions, templates, prompts, contracts, checks, and tests.

## Requirements From The Orchestration Use Case

- Git-backed initiative files are durable truth; CCM rooms are execution and observability.
- Orchestrator owns stage contracts, worker state, create/adopt/repair decisions, capture, validation, integration, and archive timing.
- Worker Agents execute bounded tasks and produce reports; they do not mutate coordination state or control rooms.
- Guiding Principal and human input become durable only after being persisted with attribution in intake, inbox, recall, or decisions.
- Guiding Principal recall responses supply human-context judgment, quality bars, and reader-facing framing; they are not routine approval gates for dispatch, room control, integration, archive, or cleanup.
- Slack is the only Agent Control Path V1 create/archive platform; Telegram returns `unsupported_capability` without emulation.
- Lifecycle calls require `isOrchestrator: true`; worker rooms do not inherit that authority.
- Recovery must work from Git files plus CCM/platform facts, without a durable action ledger in CCM Core.

## AGENTS.md Design

Use `docs/orchestration/AGENTS.md` as a scoped, runtime-neutral policy layer for initiative directories:

- State source-of-truth ordering and role authority.
- Deny worker edits to orchestration bookkeeping unless exactly assigned.
- Require read-before-write reconstruction on every dispatch, integration, archive, or handoff loop.
- Encode inbox `.done`, recall, independent audit, unsupported-platform, and archive-after-consumption invariants.
- Keep hard denies close to the files agents are most likely to edit.

Do not put initiative-specific state in root `AGENTS.md`; root instructions should stay repo practice and broad agent-doc navigation.

## Skills Design

Keep skills as role-specific operating procedures rather than giant reference documents:

- `orchestrate-workers` remains the top-level Orchestrator skill.
- `bootstrap-git-orchestration`, `manage-worker-protocol`, `process-orchestration-inbox`, `integrate-worker-output`, `audit-worker-output`, and `recover-orchestration` stay narrow subroutine skills.
- Worker, auditor, and recovery skills reference canonical templates and prompt packs instead of duplicating every field.
- Skill tests assert trigger metadata, UI prompts, guardrails, and links to shared harness artifacts.

## Cross-Runtime Mechanisms Beyond AGENTS.md And Skills

1. **Canonical templates** in `docs/orchestration/_templates/` for intake, stage, state, workers, inbox, recall, worker report, audit report, and recovery note.
2. **Portable prompt packs** in `prompts/ccm/` for Orchestrator, Worker, Guiding Principal, Auditor, and Recovery roles, using plain Markdown variables and skill names.
3. **Checklist gates** in `docs/checklists/` for orchestrator preflight, worker dispatch, Guiding Principal recall, integration, and recovery.
4. **State-machine reference** in `docs/orchestration/state-machine.md` for worker states, terminal states, repair states, and legal transitions.
5. **Agent Control Path contract docs/schema** in `docs/contracts/` and `schemas/mcp/` to pin lifecycle invariants independent of runtime UI.
6. **Scaffold/adopt scripts** in `scripts/new-orchestration.ts` and `scripts/adopt-orchestration.ts` to create or validate durable repo layout without silent branch assumptions.
7. **Validation script** in `scripts/validate-orchestration.ts` to fail fast on missing templates, missing initiative layout entries, or missing hard invariants.
8. **Static tests** to keep README, skills, prompts, templates, and contracts aligned.

## Next Hardening Steps

- Add JSON schemas for machine-readable `state.json` or frontmatter if orchestration state graduates beyond Markdown tables.
- Add fixture initiatives for unsupported platform, duplicate Orchestrator, archive failure, merge failure, and partial room creation repair.
- Add fixture initiatives for minimal success, Telegram unsupported capability, archive failure, duplicate Orchestrator reconciliation, and merge failure.
- Add contract parity tests comparing Agent Control Path docs/schema with registered MCP tool schemas and adapter result unions.
- Add CI running `bun run validate` once the repo is ready for remote enforcement.
