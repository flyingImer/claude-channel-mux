# Orchestrator Preflight Checklist

- [ ] A fresh `get_current_ccm_context` or runtime resolver result is recorded for this dispatch loop and proves the current room is repo-bound and `is_orchestrator: true`.
- [ ] Lifecycle create will use the Orchestrator parent room as `chat_id` and `parent_chat_id`; worker-room `chat_id` is used only after that room has its own binding.
- [ ] `docs/orchestration/AGENTS.md` and initiative `state.md`, `workers.md`, `stage.md`, unread `inbox/*.md`, open `recall/`, and latest `reports/` were read.
- [ ] Durable intake and Stage Contract are persisted with attribution.
- [ ] Every planned worker has a stable `worker_task_id` and deterministic `desired_room_name` before room creation.
- [ ] Orchestrator has a parent-controlled path to bind/start/resume the worker agent and send the Worker Task; required human or Guiding Principal worker-room intervention is degraded fallback and an orchestration failure, not success.
- [ ] Worker execution will use visible CCM Worker Rooms through Agent Control Path, not Codex native subagents, `spawn_agent`, or hidden model-side delegation.
- [ ] Any stale durable note claiming "no chat_id", "CCM rooms unavailable", or an in-process fallback is revalidated against the fresh resolver result before dispatch; fresh `resolved` + `is_orchestrator: true` wins over stale notes.
- [ ] Missing, ambiguous, or non-orchestrator room context is treated as `attention_needed`, not as permission to use hidden subagents.
- [ ] Bootstrap/adopt/repair and GP packet import have already reported readiness in a prior step, or the human explicitly asked to dispatch after that report.
- [ ] Platform limitations are known: Slack create/archive only; Telegram returns `unsupported_capability`.
- [ ] Human/review gates are listed for credential, deploy, destructive, policy, release, or scope changes.
