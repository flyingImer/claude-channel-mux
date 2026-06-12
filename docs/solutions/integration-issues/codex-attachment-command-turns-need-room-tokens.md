---
title: Codex attachment command turns need room tokens
date: 2026-06-12
category: docs/solutions/integration-issues
module: Codex attachment bridge
problem_type: integration_issue
component: assistant
symptoms:
  - "Codex saw Slack attachment metadata but `download_attachment` timed out after 60 seconds"
  - "Daemon logs showed `Shared Codex bridge tool call used an unknown ccm_room_token`"
  - "A follow-up `fetch_thread` call could also hang instead of returning a tool error"
root_cause: missing_permission
resolution_type: code_fix
severity: high
tags: [codex, slack-attachments, ccm-room-token, mcp-tools, regression-test]
---

# Codex attachment command turns need room tokens

## Problem

A Slack user sent a `/cx goal ...` command with an attachment and asked Codex to catch up from the attached context. The Codex session received the `attachment_file_id`, but `download_attachment` timed out twice instead of saving the file.

The failure was misleading because the first visible symptom looked like a slow Slack file download. The real failure happened before Slack download: the shared Codex MCP bridge could not authorize the tool call because the command turn did not include the daemon-generated room capability token.

## Symptoms

- The Codex transcript for session `28e19c76` contained `<message_meta>` with `attachment_file_id: F0BA3EY1290`, `attachment_name: Untitled`, and Slack room/message metadata.
- The same `<ccm_turn>` did not include `ccm_room_token` in either the envelope attributes or `message_meta`.
- Codex called `download_attachment` with a token value, but the daemon logged `Shared Codex bridge tool call used an unknown ccm_room_token`.
- The MCP result surfaced to Codex only after `tool call timed out (60s)` because route resolution threw before `handleTool()` entered its normal `try/catch` response path.
- A later live smoke after the fix produced a new command turn with `ccm_room_token` present and `download_attachment` returned `/home/yijwang/.config/claude-channel-mux/inbox/...` in about 0.5 seconds.

## What Didn't Work

- Treating the problem as missing attachment metadata. The `28e19c76` transcript proved the attachment id reached Codex; the missing part was the capability token that lets the shared Codex MCP server route tools back to the correct room.
- Retrying `download_attachment`. The retry used the same invalid token, so it waited another 60 seconds.
- Looking for a cached attachment copy in the workspace. No local file existed because the daemon never got past capability-token authorization to call Slack `files.info` / download.
- Testing only the Codex driver envelope formatting with hand-written `ccm_room_token` values. That proved metadata could be rendered, but it bypassed the daemon path responsible for injecting real room tokens.

## Solution

Keep attachment command turns on the normal CCM turn envelope path, and make the daemon supply the real room token before the command reaches the Codex driver.

The daemon now builds command metadata once, then routes Codex command metadata through `codexTurnMeta()`:

```ts
const meta = {
  ...msg.meta,
  chat_id: ck,
  room_id: ck,
  cwd: roomCwd(ck),
  message_id: msg.messageId,
  thread_id: threadId,
  user: msg.userName,
  user_id: msg.userId,
  ...(msg.replyToId ? { reply_to_id: msg.replyToId } : {}),
}

const command: AgentCommand = {
  // ...
  meta: runtime === 'codex' ? codexTurnMeta(ck, uuid, meta) : meta,
}
```

The Codex driver wraps command turns in `<ccm_turn>` only when attachment metadata needs the envelope. That keeps metadata-rich attachment commands compatible with MCP tools while preserving plain raw command behavior for metadata-free commands:

```ts
private commandNeedsTurnEnvelope(command: AgentCommand): boolean {
  return ['attachment_file_id', 'attachment_files']
    .some(key => typeof command.meta[key] === 'string' && command.meta[key] !== '')
}
```

`handleTool()` also now catches route-resolution errors and sends `tool_error` immediately to the caller:

```ts
let route: { responseUuid: string; sessionId: string; channelKey: string }
try {
  route = resolveToolCallRoute(callerUuid, msg.args)
} catch (err) {
  sendToLive(callerUuid, { type: 'tool_error', callId: msg.callId, error: errorMessage(err) })
  return
}
```

This prevents invalid, stale, or mismatched tokens from turning into opaque MCP-side 60-second timeouts.

## Why This Works

The shared Codex app-server uses one MCP bridge process for multiple logical CCM Codex sessions. Because the bridge registers as `ccm-shared-codex-app-server`, the daemon cannot authorize a tool call solely from the process UUID. It must resolve the logical room/session from `ccm_room_token`.

Normal user turns already used `codexTurnMeta()` and therefore included a valid room token. Codex command turns were a separate path: `/cx goal` and `/cx raw ...` went through `sendCommand()` and `startPlainTurn()`, so attachment metadata could be present without the token that makes `download_attachment` usable.

The fix reconnects those two halves: attachment command turns get the same room-token metadata as normal turns, and authorization failures are reported synchronously through the tool response channel instead of escaping as daemon unhandled rejections.

## Prevention

- Regression tests should cover the cross-seam behavior, not just the driver formatter. Tests now cover Slack and Telegram attachment command turns for both `/goal` and `/raw` command paths.
- Static parity guards check that Codex command metadata is routed through `codexTurnMeta()` and that `handleTool()` sends `tool_error` when route resolution fails.
- When debugging attachment failures, inspect both fields:
  - `attachment_file_id` / `attachment_files` proves the platform attachment reached the agent.
  - `ccm_room_token` proves the agent can call back into CCM tools from the shared Codex MCP bridge.
- Tool routing errors should fail fast with actionable errors. A 60-second MCP timeout usually means the daemon failed to answer the tool call, not that Slack necessarily took 60 seconds.

## Related Documentation

- `docs/solutions/integration-issues/agent-command-visible-notices-must-not-use-audit-previews.md` covers an adjacent Slack/Codex command debugging issue: visible command confirmations must show the actual command text instead of bounded audit previews.
- `docs/solutions/workflow-issues/ccm-orchestration-steering-vs-execution.md` documents why Agent Control Path and room-control tools need explicit, auditable control semantics.
