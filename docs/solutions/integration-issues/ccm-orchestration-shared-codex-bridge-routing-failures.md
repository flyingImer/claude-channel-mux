---
title: Shared Codex bridge tool calls route by chat_id and room binding
date: 2026-06-16
category: docs/solutions/integration-issues
module: CCM orchestration / Shared Codex bridge
problem_type: integration_issue
component: assistant
symptoms:
  - "Codex orchestration turns could not call Agent Control Path tools from the shared app-server bridge"
  - "Native Codex TUI or goal continuations exposed only the shared bridge identity, not a CCM room"
  - "Stale guidance encouraged using `ccm_room_token` or bridge/session ids as routing substitutes"
  - "Attachment command turns needed room metadata for `download_attachment`, but legacy token metadata was no longer valid"
root_cause: logic_error
resolution_type: code_fix
severity: critical
tags: [ccm-orchestration, shared-codex-bridge, chat-id-routing, room-binding, agent-control-path]
---

# Shared Codex bridge tool calls route by chat_id and room binding

## Problem

CCM uses one shared Codex app-server bridge identity for many logical Codex sessions. That makes process identity insufficient for Agent Control Path and room tools: the daemon must know which CCM room owns the tool call before it can create, bind, start, send to, capture from, archive, react in, reply to, or download from that room.

Earlier fixes tried to solve this with an opaque `ccm_room_token` embedded in Codex turn metadata. That approach fixed some command-turn failures, including attachment downloads, but later orchestration runs showed it blocked legitimate native Codex TUI/internal-goal tasks. Current routing uses explicit `chat_id` from the CCM room context plus the room's bound Codex session instead.

## Symptoms

- Codex had `CC_CHANNEL_SESSION_UUID=ccm-shared-codex-app-server` or `CODEX_CHANNEL_SESSION_UUID=ccm-shared-codex-app-server`, but those values identified only the shared bridge, not the room that owned the task.
- Agent Control Path attempts failed or routed ambiguously when guidance asked Codex to invent or reuse `ccm_room_token`.
- Native Codex `/goal` continuations preserved the task text but lacked the current CCM room context, so they could not safely dispatch worker rooms.
- Attachment command turns could include attachment metadata while still lacking the room metadata needed for `download_attachment` to route back to the source room.

## What Didn't Work

- Treating `CC_CHANNEL_SESSION_UUID`, `CODEX_CHANNEL_SESSION_UUID`, or `ccm-shared-codex-app-server` as a `chat_id`. Those identify the shared Codex bridge, not a Slack or Telegram room.
- Preserving the old `ccm_room_token` contract in prompts, skills, tests, or recovery notes. The daemon no longer maintains token files or accepts token-based shared bridge routing.
- Treating a native Codex `/goal` continuation as equivalent to a CCM-delivered turn. Native goal text can preserve intent while still omitting the room context required for tools.
- Fixing only attachment command metadata. Attachments need the CCM envelope for file metadata, but shared bridge authorization still comes from `chat_id` routing.
- Falling back to Codex native subagents, model-side delegation, or manual worker-room setup for CCM orchestration. That avoids validating the visible Worker Room control path.

## Solution

Route shared Codex bridge tool calls by explicit room `chat_id`. Server instructions now tell agents to pass `chat_id` exactly from the current room/context, and static tests assert that shared Codex app-server calls are routed by the room-bound Codex session for that `chat_id`.

```ts
function resolveToolCallRoute(callerUuid: string, args: JsonObject): { responseUuid: string; sessionId: string; channelKey: string } {
  if (callerUuid === SHARED_CODEX_BRIDGE_ID) {
    const requestedCk = stringValue(args.chat_id)
    const sessionId = bindingUuid(requestedCk, 'codex')
    if (!sessionId) throw new Error(`Tool chat_id ${requestedCk || '(missing)'} is not bound to a Codex session`)
    return { responseUuid: callerUuid, sessionId, channelKey: canonicalToolChannelKey(sessionId, requestedCk) }
  }

  return { responseUuid: callerUuid, sessionId: callerUuid, channelKey: canonicalToolChannelKey(callerUuid, stringValue(args.chat_id)) }
}
```

Keep the Codex turn envelope for commands that need trusted CCM room metadata. `/goal` commands and attachment-bearing `/raw` commands call `startCommandTurn()` when the command has room metadata or attachment metadata, and the envelope includes `chat_id`/`room_id` rather than legacy room-token fields.

```ts
const nativeTurnId = this.commandNeedsTurnEnvelope(input.command) || this.commandHasCcmRoomMetadata(input.command)
  ? await this.startCommandTurn(runtime, input.command, text)
  : await this.startNativeTurn(runtime, 'user', text)
```

The orchestrator and recovery skills should therefore require one of these current-room sources before calling Agent Control Path tools:

- `<ccm_turn ... chat_id="slack:C123">` or equivalent Telegram room context.
- Command metadata containing `chat_id` or `room_id` from the parent Orchestrator room.
- A fresh parent-room `/cx goal ...` or explicit `codex:` cue when a native Codex continuation lacks room metadata.

## Why This Works

The shared bridge has stable process identity so one Codex app-server can serve multiple logical sessions, while `chat_id` selects the logical CCM room for each tool call. The daemon then verifies that the requested room has a Codex binding and routes the response through the shared bridge without needing per-turn opaque tokens.

This also keeps attachment handling and orchestration aligned. Attachments still ride inside the CCM turn envelope so Codex can see `attachment_file_id` and related metadata, but room authority comes from the same `chat_id` contract used by replies, reactions, worker lifecycle tools, and capture/reportback.

## Prevention

- Regression tests should assert that shared bridge routing uses `args.chat_id`, `bindingUuid(requestedCk, 'codex')`, and `canonicalToolChannelKey(sessionId, requestedCk)`.
- Static tests should reject reintroducing `ccm_room_token`, token files, token generation, or token invalidation in the shared Codex bridge path.
- Skills and checklists should say “current parent room `chat_id`” and “room binding,” not “opaque token.”
- When debugging attachment failures, distinguish attachment metadata (`attachment_file_id` / `attachment_files`) from room routing metadata (`chat_id` / `room_id`). Both can matter, but only `chat_id` routes shared bridge tool calls.
- When debugging orchestration failures from native Codex continuations, ask whether the turn includes current CCM room context before trying Agent Control Path calls.

## Related Issues

- `docs/solutions/integration-issues/agent-command-visible-notices-must-not-use-audit-previews.md` covers adjacent command-debugging visibility: visible confirmations must show the actual parsed command text rather than bounded audit previews.
- `docs/solutions/workflow-issues/ccm-orchestration-steering-vs-execution.md` documents why Agent Control Path and room-control tools need explicit, auditable control semantics.
