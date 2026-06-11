# Orchestrator Preflight Checklist

- [ ] Current room is repo-bound and `isOrchestrator: true`.
- [ ] Lifecycle create will use the Orchestrator parent room as `chat_id` and `parent_chat_id`; worker-room `chat_id` is used only after that room has its own bound session/token.
- [ ] `docs/orchestration/AGENTS.md` and initiative `state.md`, `workers.md`, `stage.md`, unread `inbox/*.md`, open `recall/`, and latest `reports/` were read.
- [ ] Durable intake and Stage Contract are persisted with attribution.
- [ ] Every planned worker has a stable `worker_task_id` and deterministic `desired_room_name` before room creation.
- [ ] Orchestrator has a parent-controlled path to bind/start/resume the worker agent and send the Worker Task; required human or Guiding Principal worker-room intervention is degraded fallback and an orchestration failure, not success.
- [ ] Platform limitations are known: Slack create/archive only; Telegram returns `unsupported_capability`.
- [ ] Human/review gates are listed for credential, deploy, destructive, policy, release, or scope changes.
