---
title: CCM orchestration shared Codex bridge routing failures
date: 2026-06-16
category: docs/solutions/integration-issues
module: CCM orchestration / Shared Codex bridge
problem_type: integration_issue
component: assistant
symptoms:
  - "Codex `/cx goal` orchestration turns lost CCM room metadata and could not call Agent Control Path tools"
  - "Shared Codex bridge tool calls failed or routed ambiguously across multiple logical CCM rooms"
  - "Duplicate daemon processes or stale daemon files could corrupt room and shared-bridge routing state"
  - "Synthetic `acp:*` worker-task ids were used as Slack thread or reaction anchors"
root_cause: logic_error
resolution_type: code_fix
severity: critical
tags: [ccm-orchestration, shared-codex-bridge, room-capability-token, daemon-singleton, agent-control-path]
---

> Superseded on 2026-06-16: this incident originally fixed token propagation, but repeated native Codex TUI/internal-goal failures showed the token model blocks valid TUI-originated tasks. Shared Codex bridge calls now route by explicit `chat_id` plus the current Codex room binding.

# CCM orchestration shared Codex bridge routing failures

## Problem

A Codex Orchestrator session was resumed through `/cx goal` and asked to continue CCM worker orchestration, but it could not reliably operate visible Worker Rooms through Agent Control Path. The failure was not one bug: it was a multi-layer routing break across Codex command-turn envelopes, the shared Codex MCP bridge, daemon singleton ownership, and Slack-visible worker-task anchors.

The durable orchestration invariant is that any Codex turn expected to call CCM room tools must receive a full CCM turn envelope with a real `ccm_room_token`. Without that token, the shared Codex bridge cannot prove which logical CCM Room owns a tool call.

## Symptoms

- Codex saw a native `/goal` turn with `<codex_internal_context source="goal">`, but no `<ccm_turn ccm_room_token="...">` envelope.
- Agent Control Path tool calls from the shared Codex app-server bridge failed closed when `ccm_room_token` was missing, stale, unknown, or replaced with `ccm-shared-codex-app-server`.
- Multiple Codex app-server bridge connections competed for one shared bridge identity, so tool results could be sent to the wrong socket or lose caller context.
- Restart experiments exposed duplicate daemon/socket races where one process could unlink state owned by another live daemon.
- Worker tasks created synthetic `acp:*` ids, and those ids leaked into Slack typing, reaction, or thread operations as if they were platform message ids.

## What Didn't Work

- Treating a native Codex `/goal` continuation as equivalent to a CCM-delivered room turn. Native goal text can preserve intent while still bypassing the room-token envelope required for tools.
- Using `CC_CHANNEL_SESSION_UUID`, `CODEX_CHANNEL_SESSION_UUID`, or `ccm-shared-codex-app-server` as a token substitute. Those identify a bridge or app-server session, not a room capability.
- Fixing only the original attachment-command case. Orchestration goal turns without attachments still need the same CCM envelope when they carry room metadata.
- Restarting the daemon without singleton ownership. Restart could appear to help briefly while leaving stale sockets, pid files, or duplicate processes that broke routing again.
- Letting Worker Room orchestration fall back to Codex native subagents, model-side delegation, or manual worker-room setup. That avoids the failing Agent Control Path instead of validating it.

## Solution

Route room-aware Codex command turns through the full CCM turn envelope, not only attachment-bearing commands. The Codex driver now treats `ccm_room_token`, `chat_id`, or `room_id` metadata as sufficient reason to use `startCommandTurn()`, so `/cx goal` reaches Codex with the same token envelope expected by shared bridge tools.

```ts
const nativeTurnId = this.commandNeedsTurnEnvelope(input.command) || this.commandHasCcmRoomMetadata(input.command)
  ? await this.startCommandTurn(runtime, input.command, text)
  : await this.startNativeTurn(runtime, 'user', text)
```

Keep the shared bridge strict about token identity. The daemon rejects missing tokens, stale tokens, unknown tokens, and the literal shared bridge id with actionable recovery text, while the MCP server instructions tell Codex to stop and ask for a fresh CCM-delivered `/cx goal ...` or `codex:` turn when no `ccm_room_token` is present.

Support multiple shared Codex bridge connections without treating the bridge process as a single caller socket. Shared bridge registrations can coexist, route resolution finds the logical CCM Room from the room capability token, and `sendToIpcConn()` returns tool results or errors on the caller connection that made the request.

Make daemon ownership explicit. Startup creates a `daemon.lock` with exclusive open semantics, refuses duplicates held by live pids, cleans stale locks only when their owner is gone, and unlinks socket, pid, and lock files only when they still belong to the current daemon process.

Filter synthetic Agent Control Path ids before platform calls. `platformMessageAnchor()` returns no Slack anchor for absent ids or `acp:*` ids, so internal worker-task identifiers cannot be used as Slack `thread_ts`, typing, or reaction targets.

## Why This Works

The fix separates three identities that had become easy to confuse:

- the shared Codex bridge id, which identifies the process-level MCP bridge;
- the app-server or environment session ids, which identify the Codex runtime connection; and
- the room capability token, which authorizes a specific logical CCM Room and Codex session.

The shared bridge is intentionally process-shared, so process identity is not enough to route a tool call. Requiring the CCM turn envelope for room-aware goal commands keeps the room capability token attached to the user-visible orchestration turn. Returning responses on the caller socket then preserves transport correctness even when multiple shared bridge connections are registered.

The daemon lock and owner-aware cleanup remove a separate source of false routing failures: duplicate daemons should fail closed instead of sharing or unlinking the same socket state. Filtering `acp:*` ids closes the final platform boundary by keeping internal control-path identifiers out of Slack APIs that expect real platform message ids.

## Prevention

- Add fixture coverage for every command-turn path that can call CCM tools. A regression transcript for orchestration should contain `<ccm_turn ... ccm_room_token="...">`; a bare `<codex_internal_context source="goal">` is not authorized for Agent Control Path.
- Treat shared bridge ids as invalid capability tokens in both tests and runtime errors. Error text should tell the agent how to obtain a fresh token-bearing turn instead of encouraging guesses.
- Test shared bridge routing with concurrent bridge registrations and assert tool results/errors are sent on the caller IPC connection.
- Test daemon startup as a singleton with stale-lock cleanup and owner-checked socket, pid, and lock removal.
- Keep Worker Room orchestration tests explicit that Codex native subagents, `spawn_agent`, model-side delegation, and hidden parallel agents are not CCM Worker Rooms.
- Filter internal control-path ids before every platform adapter call that expects a Slack or Telegram message anchor.

## Related Issues

- `docs/solutions/integration-issues/codex-attachment-command-turns-need-room-tokens.md` covers the earlier attachment-specific version of the same room-token envelope invariant.
- `docs/solutions/workflow-issues/ccm-orchestration-steering-vs-execution.md` covers why visible Worker Rooms must be controlled through Agent Control Path instead of hidden or manual execution.
- `CONCEPTS.md` defines CCM Room, Shared Codex Bridge, Room Capability Token, Worker Room, and Agent Control Path.
- GitHub issues #2 and #3 track broader Codex parity and room-centric routing goals that this failure exercised.
