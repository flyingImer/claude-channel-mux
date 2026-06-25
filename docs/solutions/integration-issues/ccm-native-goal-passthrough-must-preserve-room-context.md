---
title: "CCM native goal passthrough must preserve room context"
date: 2026-06-17
last_updated: 2026-06-23
category: docs/solutions/integration-issues
module: ccm-agent-control-path
problem_type: integration_issue
component: assistant
symptoms:
  - "A room-launched Claude `/cc goal ...` session claimed it had no `chat_id` and skipped visible Worker Rooms"
  - "The orchestration record marked CCM worker rooms unavailable even though bindings mapped the session to an orchestrator room"
  - "Codex `/cx raw /goal ...` could start a native goal turn without the CCM room envelope unless attachment metadata forced one"
  - "Visible worker-room dispatch degraded into hidden or in-process subagents"
  - "A `/cc goal` demanding Worker Rooms was allowed to start from a non-orchestrator room, only to stop later inside Claude"
  - "Worker `/goal ...` setup was treated as task text instead of a native worker-session command"
root_cause: logic_error
resolution_type: code_fix
severity: high
tags: [ccm-orchestration, native-goal-passthrough, chat-id-routing, ccm-turn-envelope, agent-control-path, worker-rooms, raw-passthrough, regression-test]
---

# CCM native goal passthrough must preserve room context

## Problem

CCM can deliver room messages through a structured turn envelope that carries `chat_id`, room id, cwd, thread id, and peer context. Native slash passthrough paths are riskier: they write a command such as `/goal ...` into the agent's native TUI or app-server command path. If the command text reaches the agent without the CCM envelope, the agent may preserve the human's goal but lose the room identity needed for Agent Control Path worker-room tools.

The same boundary applies inside Worker Rooms. A worker's native setup commands configure the worker session; they are not the worker's task brief. Claude worker `/effort ultracode`, Claude worker `/goal create dynamic workflow ...`, and Codex worker `/goal $superpowers:subagent-driven-development ...` must be delivered through Agent Control Path raw passthrough, while `send_worker_task` carries only the bounded Worker Task brief.

The concrete incident was Claude session `c1bba594-1ae5-4a52-91e0-4f181b1e6e2d`. The session was launched from Slack room `slack:C0BB6HH5LQ1`, and current bindings marked that room as `isOrchestrator: true`, but the orchestration record concluded that the session had no `chat_id` and proceeded with in-process subagents. Live verification later proved the daemon could resolve the session to the parent room and could create, bind, start, send to, capture from, and archive a visible worker room.

## Symptoms

- A Claude `/goal` session documented “no inbound `<ccm_turn>` envelope, no `chat_id`” and treated real Slack worker rooms as unavailable.
- The durable fallback decision contradicted `bindings.json`, which mapped the Claude session to one orchestrator room.
- Agent Control Path was not attempted even though `get_current_ccm_context` could resolve the parent room.
- Codex had a parallel edge case: `/cx goal ...` preserved room metadata, but `/cx raw /goal ...` only used the envelope when attachments were present.
- The user-visible result was hidden or in-process subagent fan-out instead of visible Worker Rooms and room transcript observability.
- A later adjacent incident (`ec9ad717` in `slack:C0BB8M3NH9S`) had the opposite shape: the native goal did receive `chat_id`, but a confirmed path-change reset had deleted the room's `isOrchestrator` flag after `ccm orch on`, so worker-room creation was still denied.
- A third adjacent incident (`54568ec1` in `slack:C0BB6J6QYMT`) proved a subtler failure: the native goal had `<ccm_turn ... chat_id="slack:C0BB6J6QYMT">` and the room was still `isOrchestrator: true`, but the agent loaded `subagent-driven-development` before `orchestrate-workers` and then used Claude `Workflow`/hidden subagents for A-H while calling the run successful orchestration.
- A fourth adjacent incident (`905aa949` in `slack:C0BAVGSBZJT`) showed the daemon could avoid a doomed native goal entirely. The prompt explicitly required visible CCM Worker Rooms and `is_orchestrator: true`, but the parent room binding did not have `isOrchestrator: true`. The daemon still passed `/cc goal ...` through to Claude, so Claude spent a full goal turn rediscovering the missing flag and stopping with `attention_needed`.
- A later worker-dispatch refinement showed the inverse problem inside valid Worker Rooms: `/goal ...` setup was described as a prompt wrapper, which could lead an Orchestrator to embed native setup in `send_worker_task` instead of sending it through `send_worker_raw_command`.

## What Didn't Work

- Trusting the native `/goal` prompt text as equivalent to a CCM-delivered turn. The goal text can arrive while the room envelope is absent.
- Treating an old “no `chat_id`” orchestration note as durable truth. Current daemon binding state can supersede stale notes.
- Fixing only the Agent Control Path resolver. Resolver fallback helps once the agent calls the tool, but a prompt can still choose hidden subagents if it never sees or revalidates the current CCM context.
- Checking only for `chat_id`. A valid room identity is necessary but not sufficient for worker-room dispatch; the current room binding must still be flagged as an Agent Control Path Orchestrator room.
- Checking only transport and authorization. Even with `chat_id` plus `isOrchestrator: true`, instruction precedence can still fail if a generic fan-out/subagent skill is treated as the worker substrate instead of a quality preference inside visible CCM Worker Rooms.
- Deferring an obvious authorization failure to the agent. If a room command's own `/cc goal` text asks for visible Worker Rooms or Agent Control Path lifecycle tools, the daemon already has the authoritative room flag and can reject before starting the native goal.
- Fixing only Claude `/cc goal`. Codex raw slash passthrough had the same class of risk for `/cx raw /goal ...` because it used a plain turn unless attachment metadata forced `startCommandTurn`.
- Sending worker `/goal ...` inside `send_worker_task`. That mixes runtime/session setup with task-specific worker instructions; `send_worker_task` sends normal task text, not native slash-command control (session history).
- Treating synthesis as a substep of an implementation worker. Synthesis reconciles and judges worker outputs, so sharing the implementation worker's room can contaminate the final judgment and hide stalls (session history).
- Using session history alone as evidence that worker rooms are unavailable. Session history helped surface prior failed assumptions, but the live binding and smoke test were the authoritative proof.

## Solution

Patch every native goal passthrough path so room-launched goal turns carry CCM room context, and make orchestration guidance treat stale no-room decisions as revalidation targets rather than permission to use hidden workers.

For Claude `/cc goal ...`, wrap the native command text with a minimal CCM turn envelope before writing it into the zellij pane:

```ts
function claudeSlashPassthroughText(command: string, ck: string, msg: InboundMessage, cwd: string): string {
  if (!/^\/goal(?:\s|$)/.test(command.trim())) return command
  const threadId = msg.replyToId ?? msg.messageId
  const attrs = [
    'source="claude-channel-mux"',
    `room_id="${escapeXmlAttr(ck)}"`,
    `chat_id="${escapeXmlAttr(ck)}"`,
    `cwd="${escapeXmlAttr(cwd)}"`,
    `message_id="${escapeXmlAttr(msg.messageId)}"`,
    `thread_id="${escapeXmlAttr(threadId)}"`,
  ].join(' ')
  return `${command}\n\n<ccm_turn ${attrs}>\n<context_pointers trust="untrusted" />\n</ccm_turn>`
}
```

The slash passthrough branch then writes `commandText` instead of the raw command:

```ts
const commandText = claudeSlashPassthroughText(cmd.command, ck, msg, roomCwd(ck))
const writeOk = writeChars(paneId, commandText)
```

For Codex `/cx raw /goal ...`, use the same envelope condition as normal `/cx goal ...`: if the command has attachment metadata or CCM room metadata, call `startCommandTurn` rather than `startPlainTurn`.

```ts
private async sendSlashCommandAsTurn(runtime: CodexRuntime, command: AgentCommand): Promise<AgentCommandResult> {
  const nativeTurnId = this.commandNeedsTurnEnvelope(command) || this.commandHasCcmRoomMetadata(command)
    ? await this.startCommandTurn(runtime, command, command.command)
    : await this.startPlainTurn(runtime, command, command.command)
  return { commandId: command.commandId, nativeCommandId: nativeTurnId }
}
```

Then harden the orchestration instructions: before stage work, call `get_current_ccm_context`, persist the fresh result, and treat older “no `chat_id`,” “CCM rooms unavailable,” or “in-process fallback chosen” notes as stale unless the fresh resolver still proves `not_bound`, `ambiguous`, or non-orchestrator context.

Also harden skill conflict resolution. When the human asks for `subagent-driven-development`, dynamic workflows, or fan-out in the same request as CCM orchestration, `orchestrate-workers` remains the controlling workflow. Generic delegation becomes an internal quality preference for work performed inside visible Worker Rooms; it is not permission to bypass Agent Control Path with Claude `Task`, Claude `Workflow`, Codex native subagents, `spawn_agent`, or hidden model delegation. If visible rooms cannot be dispatched, stop with `attention_needed` instead of running hidden workers and labeling them Worker Rooms.

Also preserve orchestrator authorization across room-state reset paths. Changing a room's cwd through a confirmed path change may clear agent slots, runtime metadata, pending UI, and old mapping state, but it must not silently demote an orchestrator room back to a regular CCM room:

```ts
async function resetRoomForPathChange(ck: string): Promise<void> {
  const wasOrchestrator = normalizeBinding(loadBindings()[ck]).isOrchestrator
  await deleteRoomState(ck)
  if (wasOrchestrator) setRoomOrchestratorFlag(ck, true)
}
```

Finally, preflight Claude native goals that explicitly require visible Worker Rooms before writing anything into the Claude pane. If the command text names `orchestrate-workers`, Worker Rooms, Agent Control Path, or lifecycle tool names and the current room is not flagged as an orchestrator, the daemon returns an `attention_needed` room notice instead of starting a goal that cannot satisfy its own precondition.

For worker-session setup, add an explicit raw-command step between `start_worker_agent` and `send_worker_task`. The Orchestrator controls the worker from the parent room and sends native setup through `send_worker_raw_command`:

```text
Claude worker setup:
1. start_worker_agent
2. send_worker_raw_command: /effort ultracode
3. send_worker_raw_command: /goal create dynamic workflow to <task specific goal description> /think-harder /superpowers:verification-before-completion
4. send_worker_task: Worker Task: <bounded objective, inputs, acceptance, report format>

Codex worker setup:
1. start_worker_agent
2. send_worker_raw_command: /goal $superpowers:subagent-driven-development <task specific goal description> $think-harder $superpowers:verification-before-completion
3. send_worker_task: Worker Task: <bounded objective, inputs, acceptance, report format>
```

The task-specific goal description is deliberately shorter than the Stage Contract. It names the worker's outcome, while the Worker Task brief carries source material, non-goals, acceptance checks, and report requirements. Synthesis-related work gets its own Worker Room with the same raw-setup-then-task sequence.

## Why This Works

Agent Control Path authorization is room-scoped, not process-scoped. A native goal continuation can keep task intent while losing the room-scoped evidence that tells the agent which parent room can create and control worker rooms. Appending the CCM envelope to native goal passthrough keeps the command native while restoring the room identity the agent needs to reason correctly and call tools.

Resolver fallback remains necessary but insufficient. It proves the daemon can recover the room when a tool call arrives without explicit `chat_id`; it does not guarantee the agent will attempt that tool call. Prompt and checklist guardrails close that decision gap by making stale no-room records subordinate to fresh `get_current_ccm_context` evidence.

Instruction precedence guardrails are equally necessary. Session `54568ec1` had both room context and the orchestrator flag, yet still chose hidden Claude `Workflow` agents because the request named subagent fan-out and the agent interpreted that as an execution substrate. Explicit conflict resolution makes visible rooms the non-negotiable substrate and demotes generic delegation to an optional inside-worker technique.

The `905aa949` preflight is intentionally narrower than all `/cc goal`. Ordinary Claude goals should still work in ordinary rooms. The guard only trips when the native goal text itself asks for Worker Rooms or Agent Control Path lifecycle, because those operations require a room-scoped authorization flag that the daemon can verify before incurring a native goal turn.

The Codex raw fix closes the parity gap. `/cx goal ...` already started an enveloped command turn when room metadata existed, but `/cx raw /goal ...` bypassed that condition. Applying `commandHasCcmRoomMetadata` to raw slash turns keeps both supported and experimental goal paths aligned.

The worker raw setup rule closes the next parity gap. Claude worker `/effort ultracode` and `/goal create dynamic workflow ...` are native session controls; Codex worker `/goal $superpowers:subagent-driven-development ...` is also a native turn/control shape. `send_worker_raw_command` is the Agent Control Path equivalent of typing those commands in the worker room, while `send_worker_task` remains a plain task-delivery primitive.

Live verification proved the end-to-end path: as session `c1bba594`, `get_current_ccm_context` resolved `slack:C0BB6HH5LQ1` with `is_orchestrator: true`; Agent Control Path created worker room `C0BB2TKNMM4`, bound it, started Claude worker `008089a4-27df-4648-9ae5-8b8ddf50e94e`, delivered a task with an `acp:` message id, captured a Worker Report, and archived the room.

## Prevention

- Treat native slash passthrough as a separate transport surface from normal CCM turns; every room-launched goal path must preserve or rehydrate room context.
- Regression-test both Claude `/cc goal ...` and Codex `/cx raw /goal ...` so future refactors cannot silently return to plain command text.
- Regression-test path-change confirmation so it cannot call the destructive room reset directly and drop `isOrchestrator` after the user already ran `ccm orch on`.
- Regression-test `/cc goal` Worker Room prompts so a non-orchestrator room is blocked before `bindingUuid`, pane lookup, or `writeChars` sends the native goal to Claude.
- Regression-test worker dispatch prompts and skills so worker `/goal ...`, `/effort ultracode`, and runtime superpower setup are sent with `send_worker_raw_command`, never embedded in `send_worker_task`.
- In orchestration skills and checklists, require fresh `get_current_ccm_context` before worker dispatch and before accepting old “no room” notes.
- In orchestration skills, prompts, and checklists, explicitly name Claude `Task` and `Workflow` alongside Codex subagents and `spawn_agent` as hidden-worker mechanisms that cannot satisfy CCM Worker Room dispatch.
- When requests combine CCM orchestration with `subagent-driven-development` or dynamic fan-out, require Agent Control Path preflight first and visible room dispatch before any stage work.
- When a stage needs report reconciliation, final curation, cross-worker synthesis, or integration judgment, allocate a dedicated synthesis Worker Room instead of folding that work into the parent Orchestrator turn or an implementation worker.
- Consider live smoke the proof for Agent Control Path changes: create a real worker room, bind it, start an agent, send a bounded task, capture the report, and archive the room.
- After changing MCP tools, prompts, skills, or checklists, run full validation, sync both Codex and Claude plugin caches, restart `ccm-daemon.service` through systemd, and smoke-check the service plus daemon socket. Do not manually launch the production daemon with `nohup`, `setsid`, or ad hoc background shells (session history).
- Keep stale fallback records explicit and reversible. If current bindings prove an orchestrator room exists, update the conflict/state files before dispatching more work.

## Related Issues

- `docs/solutions/integration-issues/ccm-orchestration-shared-codex-bridge-routing-failures.md` covers the broader resolver contract for shared Codex bridge and session-bound fallback. This learning is narrower: native goal passthrough must carry the room envelope so the agent chooses the resolver/tool path in the first place.
- `docs/solutions/integration-issues/agent-command-visible-notices-must-not-use-audit-previews.md` covers debugging command delivery visibility for multiline `/cx raw /goal ...` commands.
- `docs/solutions/workflow-issues/ccm-orchestration-steering-vs-execution.md` explains why hidden or manual worker operation is degraded fallback, not successful visible orchestration; it also records the task-only semantics of `send_worker_task`.
