---
title: CCM orchestration must separate steering from execution
date: 2026-06-11
category: docs/solutions/workflow-issues
module: CCM orchestration harness
problem_type: workflow_issue
component: development_workflow
severity: high
applies_when:
  - Dogfooding visible CCM worker rooms from a parent Orchestrator room
  - Designing Agent Control Path tools that replace manual Slack or Telegram worker-room operation
  - Writing prompts or checklists for Guiding Principal, Orchestrator, and Worker roles
tags: [ccm-orchestration, agent-control-path, guiding-principal, worker-rooms, dogfood]
---

# CCM orchestration must separate steering from execution

## Context

Dogfooding the orchestration harness against `/home/yijwang/ws-tag` exposed a product-level UX gap: after a parent Orchestrator created a visible worker room, the flow still implied that a human or Guiding Principal might manually enter the worker room to bind a repo, start an agent, send the task, or unblock execution.

That gap contradicted the harness goal. Humans and the Guiding Principal should steer direction, context, quality bars, framing, and key review. The Orchestrator should use that durable context to autonomously coordinate workers, make bounded low-level execution decisions, capture evidence, integrate or reject results, and archive after consumption.

## Guidance

Encode steering-vs-execution as an invariant everywhere the orchestration stack is described or enforced:

- Human and Guiding Principal are strategic steering and key-review roles, not routine worker-room operators.
- Orchestrator owns routine execution once durable intake, stage policy, and quality bars exist.
- Worker-room human/Guiding Principal presence is optional inspection; required intervention is degraded recovery or orchestration failure.
- Agent Control Path must cover more than create/archive. Parent-controlled worker execution needs explicit bind, start/resume, send, capture/reportback, and archive operations.
- Tool semantics should not hide control-plane steps. For example, `send_worker_task` must not silently lazy-start an agent because that masks whether `start_worker_agent` worked.

For the first parent-controlled execution patch, the harness added:

- `bind_worker_room` for parent-controlled cwd/runtime metadata binding.
- `start_worker_agent` for explicit start/resume/already-running worker session facts.
- `send_worker_task` for delivering the bounded Worker Task only after the worker agent is running.
- `capture_worker_report` for retrieving worker-room transcript/reportback facts from the parent Orchestrator room before durable Git capture.

The patch also hardened semantics after review:

- `bind_worker_room` rejects non-absolute `cwd` instead of relying on implicit normalization.
- `send_worker_task` requires an existing running worker session instead of falling through to lazy-start behavior.

## Why This Matters

If worker-room setup requires a person to type commands or prompts, orchestration moves effort back to the steering layer at the exact point the system is meant to improve delivery throughput. That makes visible worker rooms look successful while the actual execution burden remains manual.

Treating create-room as success is especially risky because room creation is easy to observe, but it does not prove autonomous execution. The acceptance bar is worker output captured from a worker agent that the parent Orchestrator controlled end-to-end.

## When to Apply

- When a dogfood run asks a human to operate inside a worker room.
- When an orchestration prompt, checklist, or skill describes worker-room setup.
- When adding MCP/Agent Control Path operations for worker lifecycle.
- When deciding whether live orchestration has passed or is only partially proven.

## Examples

Bad success criterion:

```text
The Orchestrator created a Slack worker room, then the human entered the room and typed ccm /repo plus the worker task.
```

Good success criterion:

```text
The Orchestrator created/adopted the worker room, called bind_worker_room, called start_worker_agent, called send_worker_task, called capture_worker_report, wrote the autonomous Worker Report into Git, consumed or rejected it, and archived only after the state was durable.
```

Bad tool semantic:

```text
send_worker_task implicitly starts the agent if no running session exists.
```

Good tool semantic:

```text
start_worker_agent reports started/resumed/already_running. send_worker_task fails if that explicit start did not happen or the session is not running.
```

## Related

- `docs/contracts/agent-control-path-v1.md`
- `docs/orchestration/AGENTS.md`
- `prompts/ccm/orchestrator.md`
- `docs/checklists/worker-dispatch.md`
- `docs/dogfood-reports/2026-06-11-orchestration-harness-ws-tag-dogfood.md`
