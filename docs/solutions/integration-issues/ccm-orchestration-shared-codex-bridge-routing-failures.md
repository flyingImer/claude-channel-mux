---
title: Shared Codex bridge tool calls route by chat_id and session-bound fallback
date: 2026-06-16
last_updated: 2026-06-17
category: docs/solutions/integration-issues
module: CCM orchestration / Agent Control Path resolver
problem_type: integration_issue
component: assistant
symptoms:
  - "Codex orchestration turns could not call Agent Control Path tools from the shared app-server bridge"
  - "Room-bound TUI or goal continuations could lose explicit `chat_id` even though the daemon still had a session binding"
  - "Native goal continuations could silently degrade visible Worker Room orchestration into hidden Workflow or subagent execution"
  - "`create_room_with_bot_invited` required redundant `parent_chat_id` instead of defaulting to the resolved Orchestrator room"
  - "Orchestrator and worker prompts blurred inherited quality principles with orchestrator-only delegation authority"
root_cause: logic_error
resolution_type: code_fix
severity: critical
tags: [ccm-orchestration, shared-codex-bridge, chat-id-routing, session-binding, agent-control-path, get-current-ccm-context, worker-rooms, regression-test]
---

# Shared Codex bridge tool calls route by chat_id and session-bound fallback

## Problem

CCM uses one shared Codex app-server bridge identity for many logical Codex sessions. That makes process identity insufficient for Agent Control Path and room tools: the daemon must know which CCM room owns the tool call before it can create, bind, start, send to, capture from, archive, react in, reply to, or download from that room.

Earlier fixes moved shared bridge routing away from opaque room tokens and toward explicit `chat_id` plus room binding. That solved the shared-process routing problem, but it left a second failure mode: a CCM-launched Claude or Codex session can continue work inside a native TUI or `/goal` flow after the visible turn metadata is gone. In that case, requiring the agent to pass `chat_id` on every Agent Control Path call is brittle even though the daemon can still prove the session is bound to exactly one room.

The concrete incident was Claude session `9961993d`: it was bound to an orchestrator room, but treated the native `/goal` continuation as lacking room context, skipped visible Worker Rooms, and degraded into hidden Workflow/subagent execution. The fallback then stalled on a large synthesis task before verification. The root problem was not the orchestrator flag; it was missing context resolution plus prompt policy that allowed hidden delegation to stand in for visible CCM workers.

A related Claude-side failure also appeared earlier: Claude session `43b2a58e` said `ask_peer` was not available even though the MCP server exposed it and the process launch allowed it. That was a tool-discovery failure, not a missing-tool failure. Claude Code can defer MCP schemas behind ToolSearch/MCP search, so a tool can be callable even when it is absent from the model's immediate visible tool set.

## Symptoms

- Codex had `CC_CHANNEL_SESSION_UUID=ccm-shared-codex-app-server` or `CODEX_CHANNEL_SESSION_UUID=ccm-shared-codex-app-server`, but those values identified only the shared bridge, not the room that owned the task.
- Agent Control Path attempts failed or routed ambiguously when guidance asked Codex to invent or reuse `ccm_room_token`.
- Native Codex or Claude `/goal` continuations preserved the task text but could omit the current CCM room context required for room-control tools.
- A room-bound session with one eligible orchestrator room still had no read-only way to ask CCM, “what room am I currently authorized to control?”
- `create_room_with_bot_invited` required callers to pass both `chat_id` and `parent_chat_id` even when both should be the current parent Orchestrator room.
- Missing `chat_id` could cause orchestration to stop prematurely or, worse, silently replace visible Worker Rooms with hidden Workflow/subagent execution.
- Worker prompts could inherit the parent’s “fan out agents whenever possible” direction and accidentally treat a bounded Worker Task as permission to create more hidden workers.
- Claude could use basic CCM MCP tools such as `reply` and `fetch_thread`, but still claim `ask_peer` was absent and trigger the daemon's `text_fallback` visible peer cue path.

## What Didn't Work

- Treating `CC_CHANNEL_SESSION_UUID`, `CODEX_CHANNEL_SESSION_UUID`, or `ccm-shared-codex-app-server` as a `chat_id`. Those identify the shared Codex bridge, not a Slack or Telegram room.
- Preserving the old `ccm_room_token` contract in prompts, skills, tests, or recovery notes. The daemon no longer maintains token files or accepts token-based shared bridge routing.
- Treating a native Codex or Claude `/goal` continuation as equivalent to a CCM-delivered turn. Native goal text can preserve intent while still omitting explicit room metadata.
- Relying only on prompt-passed `chat_id`. That is correct when present, but brittle for room-launched sessions continued through TUI/native flows.
- Letting agents poll or list all rooms to find a candidate. `chat_id` acts like a control capability; agents should only resolve rooms already authorized for their current session.
- Requiring `parent_chat_id` on `create_room_with_bot_invited` after the parent Orchestrator room has already been resolved.
- Falling back to Codex native subagents, model-side delegation, hidden Workflow agents, or manual worker-room setup for CCM orchestration. That avoids validating the visible Worker Room control path and loses room-level transcript evidence.
- Passing orchestrator-only delegation authority into Worker prompts. Workers should inherit quality standards, not permission to fan out, create rooms, control peer workers, or mutate orchestration state.
- Treating Claude's immediately visible MCP tool list as authoritative. `ask_peer` was present in the live `tools/list` response and in the launched `--allowedTools` arguments; the missing step was searching or loading the deferred MCP tool schema before falling back.
- Maintaining separate hand-written MCP tool lists in the server, daemon launch allowlist, docs, and tests. That makes future tool additions depend on synchronized manual edits and obscures whether a failure is exposure, authorization, or discovery.

Session history adds two cautionary details: the RCA first verified that `9961993d`'s parent room was already `isOrchestrator: true`, so changing room flags would not have fixed the incident; and an early implementation pass briefly had overlapping resolver helper drafts and static-test mismatches before consolidation (session history).

## Solution

Route shared Codex bridge tool calls by explicit room `chat_id` when it is present. For room-bound non-shared sessions, add a safe session-bound fallback for the cases where the daemon can prove exactly one eligible room. The new `get_current_ccm_context` MCP tool exposes this as a read-only probe before lifecycle calls.

```ts
function resolveCurrentCcmContext(callerUuid: string, route?: { channelKey: string }, orchestratorOnly = false): CurrentCcmContext {
  if (route?.channelKey) return currentCcmContextFromChannelKey(route.channelKey, 'route.channelKey', callerUuid)
  if (callerUuid === SHARED_CODEX_BRIDGE_ID) {
    return {
      status: 'not_bound',
      source: 'shared_codex_bridge',
      reason: 'Shared Codex app-server calls do not carry a unique native session binding yet; pass chat_id or attach the native TUI session to a CCM room before lifecycle control.',
      authorized_control_tools: [],
    }
  }
  const candidates = boundChannelKeysForSession(callerUuid)
    .filter(ck => !orchestratorOnly || normalizeBinding(loadBindings()[ck]).isOrchestrator)
  if (candidates.length === 0) return { status: 'not_bound', source, reason, authorized_control_tools: [] }
  if (candidates.length > 1) return { status: 'ambiguous', source, candidate_chat_ids: candidates, reason, authorized_control_tools: [] }
  return currentCcmContextFromChannelKey(candidates[0], source, callerUuid)
}
```

The resolver has three outcomes:

- `resolved`: exactly one current room was proven from the explicit route or session binding.
- `ambiguous`: more than one authorized candidate exists, so the agent must pass `chat_id` explicitly.
- `not_bound`: the caller is not bound to a usable room, or the call came from the shared bridge without explicit room identity.

Agent Control Path routing uses the same proof rule. If `chat_id` is omitted, lifecycle tools infer an orchestrator room only when the caller is bound to exactly one orchestrator room. If `chat_id` is supplied, it still must be authorized for the caller.

```ts
function orchestratorToolChannelKey(uuid: string, requestedCk: string): string {
  if (requestedCk) {
    const ck = canonicalToolChannelKey(uuid, requestedCk)
    if (normalizeBinding(loadBindings()[ck]).isOrchestrator) return ck
    throw new Error('Room is not flagged as an Agent Control Path orchestrator room')
  }
  return requireResolvedCurrentCcmContext(
    resolveCurrentCcmContext(uuid, undefined, true),
    uuid,
    'Agent Control Path lifecycle',
  ).chat_id
}
```

`create_room_with_bot_invited` now defaults `parent_chat_id` to the resolved parent Orchestrator room. Agents no longer need to repeat the same room id twice for the normal create path, and they still cannot use the desired worker room as `chat_id` before that room has a binding.

```ts
case 'create_room_with_bot_invited': {
  assertOrchestratorRoom(route.channelKey)
  const parentChatId = stringValue(msg.args.parent_chat_id) || route.channelKey
  const parentAdapter = adapterFor(parentChatId)
  if (!parentAdapter || parentAdapter.platform !== adapter.platform) throw new Error('parent_chat_id must use the same configured adapter as chat_id')
  const resultFacts = await adapter.createRoomWithBotInvited({ parentRoomId: localId(parentChatId), desiredRoomName })
  result = JSON.stringify(resultFacts)
  break
}
```

The MCP tool registry exposes the read-only context probe and relaxes lifecycle schemas so `chat_id` can be omitted where resolver fallback is safe:

```ts
{
  name: 'get_current_ccm_context',
  description: 'Read-only Agent Control Path context probe. Resolves the current CCM room from this turn/session binding and returns status resolved, ambiguous, or not_bound plus authorized_control_tools for the resolved room.',
  inputSchema: { type: 'object', properties: {}, required: [] },
}
```

Keep the Codex turn envelope for commands that need trusted CCM room metadata. `/goal` commands and attachment-bearing `/raw` commands still need `chat_id`/`room_id` in the current context; the resolver is a recovery path for sessions the daemon can already associate with a bound room, not a replacement for room identity in unbound native sessions.

The orchestrator and recovery skills should therefore use this order before calling Agent Control Path tools:

1. Use `<ccm_turn ... chat_id="slack:C123">` or equivalent Telegram room context when present.
2. Use command metadata containing `chat_id` or `room_id` from the parent Orchestrator room when present.
3. If explicit metadata is missing, call `get_current_ccm_context`.
4. Retry with the resolved parent room only when the status is `resolved` and the room is an orchestrator room.
5. Stop on `ambiguous` or `not_bound`; ask for a parent-room `/cx goal ...`, explicit `codex:` cue, or session attach rather than guessing.

Prompt policy now separates quality inheritance from authority inheritance. Workers may inherit principles such as think-harder and verification-before-completion, but they must not inherit fan-out directives, subagent-driven-development, room lifecycle control, peer-worker control, or hidden delegation authority.

```text
Inherited Quality Principles: think-harder on ambiguous tradeoffs; verify with the most relevant available evidence before completion
Authority Boundary: no fan-out, no subagent-driven-development, no hidden subagents, no worker-room creation/adoption/archive, and no control over peer workers
```

Keep CCM MCP tool exposure in one registry. The MCP server, Claude launch allowlist, and documentation should not each own a separate list of tool names. The shared registry declares callable tools once, and runtime-specific surfaces derive their exposure from it.

```ts
export const CCM_MCP_TOOL_NAMES = [
  'reply',
  'react',
  'edit_message',
  'download_attachment',
  'fetch_thread',
  'get_current_ccm_context',
  'create_room_with_bot_invited',
  'archive_room',
  'bind_worker_room',
  'start_worker_agent',
  'send_worker_task',
  'capture_worker_report',
  'ask_peer',
  'chime_in',
] as const
```

When a Claude-managed CCM session says a named CCM MCP tool such as `ask_peer` is missing, first verify the live MCP `tools/list` response and the launch allowlist, then search/load the named MCP tool. Do not simulate the tool by posting Slack or Telegram text unless the actual tool path is unavailable.

## Why This Works

The shared bridge has stable process identity so one Codex app-server can serve multiple logical sessions, while `chat_id` selects the logical CCM room for each tool call. The daemon then verifies that the requested room has the relevant session binding and routes the response through the shared bridge without needing per-turn opaque tokens.

The session-bound resolver covers a different case: room-launched Claude or Codex sessions that continue in a TUI/native flow. In those cases, the caller’s session UUID is itself a durable binding key. If that key maps to exactly one routable room, the daemon can safely recover current room context without asking the model to remember a `chat_id` string. If the binding maps to zero or multiple rooms, the resolver fails closed.

This preserves CCM’s visible-room orchestration model. Missing `chat_id` is often a transport/context continuity issue, not proof that orchestration cannot proceed. But a missing or ambiguous binding is still a control-plane failure and must not be papered over with hidden Workflow agents.

The prompt split prevents the opposite leak: worker agents get the parent’s quality bar but not the parent’s delegation authority. That keeps Worker Rooms bounded and inspectable while still letting each worker challenge weak assumptions and verify before reporting completion.

## Prevention

- Regression tests should assert that shared bridge routing uses `args.chat_id`, `bindingUuid(requestedCk, 'codex')`, and `canonicalToolChannelKey(sessionId, requestedCk)`.
- Regression tests should also assert the resolver fallback path: `get_current_ccm_context` is exposed, `resolved` / `ambiguous` / `not_bound` are documented, lifecycle schemas allow omitted `chat_id`, and Agent Control Path tools require exactly one orchestrator room before inferring context.
- Static tests should reject reintroducing `ccm_room_token`, token files, token generation, or token invalidation in the shared Codex bridge path.
- Skills and checklists should say “current parent room `chat_id`,” “room binding,” and “call `get_current_ccm_context` before stopping,” not “opaque token.”
- When debugging attachment failures, distinguish attachment metadata (`attachment_file_id` / `attachment_files`) from room routing metadata (`chat_id` / `room_id`). Both can matter, but only `chat_id` or a proven session-bound context routes shared bridge tool calls.
- When debugging orchestration failures from native continuations, ask whether the turn has current CCM room context or whether the daemon can resolve exactly one bound orchestrator room before trying Agent Control Path calls.
- Do not let visible Worker Room failures silently degrade to native subagents, hidden Workflow agents, or manual room setup. Treat those as degraded recovery paths, not successful orchestration.
- Keep MCP tool definitions centralized. Every new CCM MCP tool should be added to the shared registry so `tools/list`, Claude `--allowedTools`, docs, and tests derive from the same source rather than drifting.
- Treat tool availability and tool discovery as separate debugging questions. A model-visible tool list can be incomplete when MCP schemas are deferred behind ToolSearch or MCP search.
- Production smoke for this area should verify both the context probe and an Agent Control Path call without explicit `chat_id`. The 2026-06-17 smoke confirmed `get_current_ccm_context` resolved `9961993d` to `slack:C0BB2CQUUTU` with `is_orchestrator: true`, and that a no-`chat_id` create call reached Slack validation rather than failing on missing context.

## Related Issues

- `docs/solutions/workflow-issues/ccm-orchestration-steering-vs-execution.md` documents why Agent Control Path and room-control tools need explicit, auditable control semantics.
- `docs/solutions/integration-issues/agent-command-visible-notices-must-not-use-audit-previews.md` covers adjacent command-debugging visibility: visible confirmations must show the actual parsed command text rather than bounded audit previews.
- GitHub issue `#2` tracks broader Claude/Codex UX parity in CCM.
- GitHub issue `#3` tracks room-centric observer turns and structured chime-in, including the peer-collaboration surfaces that rely on `ask_peer` and `chime_in` being discoverable.
