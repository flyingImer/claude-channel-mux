---
name: bootstrap-git-orchestration
description: Use when starting or adopting a CCM Git-backed orchestration initiative, setting up docs/orchestration state, GitHub repo policy, coordination branch, or durable intake.
---

# Bootstrap Git Orchestration

Set up the durable coordination substrate before dispatching workers. Git files are orchestration truth; CCM rooms are execution and observability.

## Preconditions

- Confirm repo path, remote, branch policy, and current worktree cleanliness.
- Confirm GitHub account/remote rules from repo docs before pushing or creating branches.
- Choose `coordination_branch` explicitly; use `main` only when repo practice allows it and the choice is recorded.
- Confirm exactly one active Orchestrator owns this initiative, or record a human handoff/reconciliation note.

## Scaffold

Create or adopt:

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
  conflicts/
```

Seed files with durable facts, not chat vibes:

- `intake.md`: initial human/Guiding Principal intent, attribution, source links or transcript refs.
- `stage.md`: current stage contract, non-goals, acceptance evidence, audit requirement.
- `workers.md`: worker index with `worker_task_id`, desired room name, state, branch/worktree, room ids.
- `state.md`: coordination branch, active orchestrator diagnostic identity, next-loop hints.
- `conflicts/`: material mismatches between GP/human advice, durable state, repo evidence, active workers, or policy.

## Bootstrap Workflow

1. Read repo-local agent docs, `docs/orchestration/AGENTS.md` when present, and orchestration docs.
2. Create/adopt initiative directory and record source-of-truth order.
3. Persist initial Durable Intake before worker dispatch.
4. Persist current Stage Contract before room creation.
5. Record `active_orchestrator_session` as diagnostic only; do not treat it as a lock.
6. Run the repo's relevant validation or at least `git diff --check` before treating bootstrap files as ready.
7. Prepare persistence or commit only when repo and user policy allow it; do not assume bootstrap grants commit/push permission.

## Portable Harness

- Prefer `bun run orchestration:new -- <initiative-id> --from <actor> --source-ref <ref> --coordination-branch <branch>` to create the full repo structure from templates.
- For another repo, pass `--root <repo>/docs/orchestration`; the command copies root orchestration instructions, state machine, and templates as well as the initiative directory.
- Use `bun run orchestration:adopt -- <initiative-id> [--repair]` to validate or repair an existing partial initiative without overwriting required files.
- Use `bun run validate:orchestration -- --root <repo>/docs/orchestration --ready` before live dispatch when placeholder-free readiness matters.
- Prefer canonical templates from `docs/orchestration/_templates/` when this repo provides them.
- Use `docs/checklists/git-orchestration-bootstrap.md` as the setup gate before dispatch.
- Use `prompts/ccm/orchestrator.md` and `prompts/ccm/worker.md` as runtime-neutral prompt packs for Claude Code, Codex, or other agents.
- Use `docs/checklists/orchestrator-preflight.md` before lifecycle operations and `docs/checklists/worker-dispatch.md` before sending Worker Tasks.
- Treat `docs/contracts/agent-control-path-v1.md` as the portable Agent Control Path contract when comparing Claude/Codex behavior.
- Use `bun run orchestration:inbox -- <initiative-id> --kind intake|inbox --from <actor> --source-ref <ref>` when turning pasted human, ChatGPT, or Guiding Principal context into durable intake or inbox supplements.

## Guardrails

- Workers never own coordination files unless explicitly assigned a narrow doc task.
- Raw Slack, ChatGPT, or terminal discussion is intake only after persisted with attribution.
- Do not hard-code `main` if branch protection, review, or release policy says otherwise.
- Do not start worker-room creation until `worker_task_id` and `desired_room_name` are recorded.
