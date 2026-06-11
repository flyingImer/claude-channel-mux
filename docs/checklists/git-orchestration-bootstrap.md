# Git Orchestration Bootstrap Checklist

Use this before creating or adopting `docs/orchestration/<initiative-id>/`.

- [ ] Repo path, remote, branch policy, and worktree cleanliness are known.
- [ ] Repo-local push/author rules from root `AGENTS.md` or equivalent docs were read.
- [ ] `coordination_branch` is explicitly chosen; `main` is used only when repo practice allows it and the choice is recorded.
- [ ] Exactly one active Orchestrator owns this initiative, or a human reconciliation/handoff note exists.
- [ ] Durable Intake is captured with attribution and source reference.
- [ ] External-repo bootstraps use `--root <repo>/docs/orchestration` so root instructions, state machine, and templates travel with the initiative.
- [ ] `stage.md`, `workers.md`, `state.md`, `inbox/`, `recall/`, `decisions/`, `reports/`, and `source-material/` exist before worker dispatch.
- [ ] No worker-room create/adopt/repair starts until `worker_task_id` and `desired_room_name` are durable in `workers.md`.
- [ ] Bootstrap validation ran with `bun run validate:orchestration` or the repo's broader validation gate.
- [ ] Ready-to-dispatch validation ran with `bun run validate:orchestration -- --ready` or an equivalent placeholder-free gate.
- [ ] Existing initiatives are adopted with `bun run orchestration:adopt -- <initiative-id>` or equivalent no-overwrite inspection before repair.
