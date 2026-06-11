# Orchestration State

## Coordination

- Initiative ID: `<initiative-id>`
- Coordination Branch: `<branch>`
- Target Integration Base: `<branch-or-sha>`
- Active Orchestrator Session: `<diagnostic only; not a lock>`
- Current Stage: `<stage-name>`

## Repo Policy

- Remote: `<remote-url-or-policy-ref>`
- Branch Policy: `<coordination branch, review, protection, or direct-commit rule>`
- Commit/Push Policy: `<author, account, approval, or push transport requirements>`
- Validation Gate: `<repo validation command>`

## Source Of Truth Order

1. This initiative directory and committed coordination history
2. Durable intake, stage contract, inbox supplements, decisions, and recall responses
3. Orchestrator-captured worker/audit reports, validation notes, and integration notes
4. Worker branches/worktrees and merge/test evidence
5. Slack parent and worker rooms as visible execution traces
6. CCM status/freshness/reportback as optional hints
7. Raw chat only after persisted with attribution

## Next Loop

- Read before write: `state.md`, `workers.md`, `stage.md`, unread `inbox/*.md`, open `recall/`, latest `reports/`.
- Next Action: `<single next action>`
- Blockers: `<none or exact blocker>`
