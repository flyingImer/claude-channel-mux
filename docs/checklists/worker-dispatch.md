# Worker Dispatch Checklist

- [ ] Worker task is bounded to one objective, inputs, non-goals, output format, and acceptance evidence.
- [ ] Worker room creation/adoption facts are recorded in `workers.md`.
- [ ] Worker is a visible CCM Worker Room; Codex native subagents, Claude `Task`, Claude `Workflow`, `spawn_agent`, and hidden model-side delegation are not used as substitutes for visible Worker Room execution.
- [ ] Any human request for fan-out, dynamic workflows, or `subagent-driven-development` is scoped: Orchestrator internal fan-out is orchestration meta-work only, Worker internal fan-out is worker-local quality/throughput only, and stage execution still requires visible Worker Rooms.
- [ ] Worker room cwd/runtime/default agent metadata is bound with `bind_worker_room`, not by asking the human to type setup commands in the worker room.
- [ ] Worker agent is started/resumed with `start_worker_agent` from the parent Orchestrator room.
- [ ] Worker Task is delivered with `send_worker_task` from the parent Orchestrator room.
- [ ] Worker transcript/reportback is retrieved with `capture_worker_report` from the parent Orchestrator room before state moves to captured/consumed.
- [ ] Human or Guiding Principal presence in the worker room is optional inspection only; required intervention is recorded as orchestration failure/degraded recovery.
- [ ] Worker prompt uses `prompts/ccm/worker.md` and references the Stage Contract.
- [ ] Worker prompt passes down inherited quality principles such as think-harder and verification-before-completion.
- [ ] If worker-local fan-out is allowed, worker prompt requires synthesis and verification of internal subagent outputs before final Worker Report.
- [ ] Worker is told not to mutate orchestration bookkeeping or coordinate other rooms.
- [ ] Expected Worker Report format is supplied.
- [ ] Prompt/nav authority is limited to the Worker Task scope.
