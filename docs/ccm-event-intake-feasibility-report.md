# CCM Event Intake Feasibility Report

Status: Adjacent feasibility report. It is useful background for event/status export, but it is not the current lifecycle contract; Agent Control Path lifecycle authority lives in the ADR and current Agent Control Path docs.

## Verdict

POSSIBLE WITH SMALL PATCH.

CCM already has most of the internal shape needed for a repo-backed Codex Orchestrator: stable room/session IDs, Slack channel/thread metadata, a normalized `AgentEvent` bus, Codex app-server progress events, and append-only local audit persistence. The missing piece is not a full orchestration rewrite; it is an orchestrator-facing event/status export surface.

The smallest viable change is an opt-in append-only normalized JSONL event log from the daemon, followed by a read-only JSON polling surface. This preserves the preferred architecture: a controller/daemon owns event intake and state transitions, while Codex reasoning turns handle planning, reconciliation, and audit.

## Current CCM Architecture Summary

- Slack intake path: `SlackAdapter.start()` uses Slack Socket Mode, registers `message`, `interactive`, and `slash_commands` callbacks, and normalizes Slack events into `InboundMessage` before the daemon sees them.
- command dispatch path: adapter callbacks call daemon `onMessage(ck, msg)`; `parseCmd()` routes `ccm`, `/cc`, `/cx`, mentions, room commands, and normal agent turns; agent-specific command delivery goes through `deliverAgentCommand()` and the relevant `AgentDriver`.
- session/job model: `AgentSession.sessionId` is CCM's stable worker UUID; `nativeSessionId` is Claude's CCM UUID or Codex's app-server thread ID; bindings persist channel key to active runtime, cwd, per-runtime sessions, and agent metadata. There is no separate durable job/goal/task object yet.
- worker output/result path: drivers emit `AgentEvent` values; all drivers register through `agentRegistry.all().forEach(driver => driver.onEvent(event => { void handleAgentEvent(event) }))`; `handleAgentEvent()` posts status, mid-turn messages, finals, errors, plan updates, requests, and compaction notices back to bound channels.
- persistence/state path: daemon state lives under `CHANNEL_DAEMON_STATE_DIR` or `~/.config/claude-channel-mux`; key files include `bindings.json`, `codex-sessions.json`, `codex-pending-requests.json`, `transcript-delivery.json`, `recent-agent-replies.json`, `collabs.json`, and append-only `audit.jsonl`.

## Existing Integration Points

- `bindings.ts`: defines `ChannelBinding`, `NormalizedBinding`, and `AgentSlotMeta`; this is the durable room/session registry an orchestrator can use to resume after restart.
- `agents/types.ts`: defines `AgentSession`, `AgentTurn`, `AgentCommand`, `AgentEvent`, `AgentSnapshot`, and `AgentTranscript`; these are already close to the proposed worker event/status vocabulary.
- `adapters/slack.ts`: maps Slack `channel`, `ts`, `text`, and `thread_ts` into daemon `channelId`, `messageId`, `text`, and `replyToId`; slash commands `/ccm`, `/cc`, and `/cx` are normalized into normal inbound messages.
- `daemon.ts` `onMessage()`: central adapter-normalized dispatch path; a future programmatic launch API should synthesize the same `ck` and `InboundMessage` shape rather than bypass room binding logic.
- `daemon.ts` `parseCmd()`: command parser for `ccm /path`, `ccm new/start`, `/cc`, `/cx`, mentions, status, transcript, nav, cancel, and room operations.
- `daemon.ts` `startNew()`: starts a fresh Claude or Codex slot, generates a CCM UUID, creates/binds the session, and persists binding metadata; it is the right place to emit `session_created`.
- `daemon.ts` `handleAgentEvent()`: single best hook for progress export; it already receives structured status, request, plan, message, final, compaction, and error events.
- `agents/claude/channel-driver.ts`: emits `status: running` when a Claude turn is sent and `status: stopped` when stopped; Claude native session identity is the CCM UUID.
- `agents/codex/app-server-driver.ts`: emits Codex `status`, `assistant_message`, `assistant_final`, `plan_updated`, `server_request`, and `error` from app-server notifications; Codex native session identity is the app-server thread ID.
- `server.ts`: per-session MCP bridge talks to the daemon over Unix socket; this is useful for worker-visible tools but is not the right primary orchestrator API because it is session-scoped.
- `daemon.ts` `auditEvent()`: proves the daemon already has an append-only JSONL pattern; a dedicated orchestrator event log can reuse that operational style without changing Slack behavior.

## Gaps

- missing stable worker ID: CCM has stable session UUIDs and Codex native thread IDs, but no first-class durable `job_id`, `goal_id`, `stage_id`, or `task_id`. MVP should treat `session_id + turn_id/command_id` as sufficient and let the external orchestrator maintain goal/task IDs.
- missing status API: status exists internally through sessions, snapshots, bindings, and Slack-facing `ccm agents`/`/cx ss` style commands, but there is no `ccm sessions --json`, `ccm status --json <session_id>`, or daemon query endpoint.
- missing event hooks: driver `AgentEvent` hooks exist, but normalized orchestrator events are not persisted/exported. Launch/stop/cancel/timeout are only partially represented as typed events.
- missing Slack thread mapping: incoming Slack channel/message/thread data is preserved in turns and replies, but there is no durable per-worker event record that consistently packages `channel_id`, `thread_ts`, Slack message timestamp, and CCM session ID.
- missing persistence: bindings and recent replies are persisted, and `audit.jsonl` exists, but there is no durable general-purpose `worker_events.jsonl` for progress, completion, failure, and questions.

## Recommended MVP

- option chosen: Option 2 append-only event log first, plus Option 1 polling/query API as the next increment.
- why: an append-only JSONL log is lowest risk, durable, restart-friendly, easy for repo-backed orchestration to consume, and avoids webhook auth, SSE/WebSocket lifecycle, Slack polling duplication, or changing Slack behavior.
- exact files/functions likely touched: `daemon.ts` constants/config, new `emitOrchestratorEvent()` helper near `auditEvent()`, `handleAgentEvent()`, `startNew()`, stop/cancel paths such as `stopRoomMappedSession()`/`interruptAgentTurn()`, and optionally `handleTool()` reply/send branches for worker-visible replies.
- event schema: use the proposed minimal schema with `event_id`, `ts`, `source`, `workspace`, `channel_id`, `channel_name`, `thread_ts`, `session_id`, `native_session_id`, `worker_type`, optional `goal_id/stage_id/task_id`, `event_type`, `status`, `summary`, and `raw_ref`.
- API/CLI shape: MVP env var `CCM_ORCHESTRATOR_EVENTS_FILE=/absolute/path/events.jsonl`; follow-up `ccm sessions --json`, `ccm status --json <session_id>`, and `ccm events --json --since <cursor>` backed by the daemon state directory and event log.
- failure/timeout behavior: map `AgentEvent.error` to `failed`; map `assistant_final` to `completed` with `status: passed|unknown` left to orchestrator text classification; map `status: stopped` to `cancelled`; add explicit timeout events later where app-server request/tool-call timeout handlers currently only surface errors/logs.

### Minimal Event Mapping

```json
{
  "event_id": "random-uuid",
  "ts": "2026-06-10T00:00:00.000Z",
  "source": "ccm",
  "workspace": "/absolute/path/to/repo",
  "channel_id": "C123",
  "thread_ts": "1710000000.000000",
  "session_id": "ccm-session-uuid",
  "native_session_id": "codex-thread-id-or-claude-uuid",
  "worker_type": "codex",
  "event_type": "progress",
  "status": "running",
  "summary": "short text",
  "raw_ref": {
    "turn_id": "turn-id",
    "message_id": "slack-ts-or-daemon-message-id"
  }
}
```

Suggested mappings:

- `status: running` -> `event_type: goal_started`, `status: running` when associated with a turn, otherwise `progress`.
- `status: idle` -> `event_type: progress`, `status: unknown`; do not treat idle alone as completion.
- `status: stopped` -> `event_type: cancelled`, `status: cancelled`.
- `assistant_message` -> `event_type: progress`, `status: running`.
- `assistant_final` -> `event_type: completed`, `status: unknown` until orchestrator classifies PASS/BLOCKED/FAIL text.
- `server_request` -> `event_type: question`, `status: blocked` for approval/input/elicitation-style requests.
- `plan_updated` -> `event_type: progress`, `status: running`.
- `error` -> `event_type: failed`, `status: failed`.
- `compaction` -> `event_type: progress`, `status: running`.
- `startNew()` success -> `event_type: session_created`, `status: running|unknown`.

## Patch Plan

1. Add opt-in orchestrator event configuration: `CCM_ORCHESTRATOR_EVENTS_FILE`, parent directory creation, safe append helper, and stderr-only failure logging so Slack behavior is unaffected.
2. Add a small normalizer from `AgentEvent` and launch/stop context into JSON-safe orchestrator events, keeping unknown fields optional and avoiding goal/task over-modeling.
3. Emit normalized events from `handleAgentEvent()` and `startNew()` first; add stop/cancel/worker-reply emission only where the existing code already has reliable context.
4. Add tests for JSONL opt-in behavior using static/unit coverage: no file when env var unset, valid event shape when set, final/error/status mapping, and no secret-bearing payloads.
5. Add follow-up read-only query commands or a tiny CLI utility that reads `bindings.json` plus event log and prints sessions/status/events as JSON.

## Risks

- security: worker messages may include secrets, file paths, or prompt content. MVP should store short summaries by default and avoid raw full transcripts unless explicitly enabled.
- concurrency: multiple daemon paths can append events concurrently. Synchronous local `appendFileSync()` is probably sufficient for MVP in one daemon process; cross-process writers should be avoided.
- Slack rate limits: append-only local events do not add Slack calls. Query APIs must not call Slack thread history by default.
- stale sessions: bindings can outlive live processes; query output must distinguish live, transcript-derived, stopped, and missing sessions.
- worktree/canonical path mismatch: `session.cwd`, binding cwd, source cwd, and materialized Codex worktree paths can differ. Events should include `workspace` from `session.cwd` and optional `source_cwd/worktree_path` from metadata when present.
- accidental scope expansion: webhook/SSE, external auth, repo state writers, and full orchestrator daemon should stay out of the CCM MVP unless separately approved.

## Acceptance Criteria for MVP

- can launch two workers in parallel: CCM already supports per-room Claude/Codex slots and independent session UUIDs; MVP event records must include unique `session_id` and `worker_type` for each worker.
- can query their status independently: follow-up query API or JSON reader must resolve sessions from `bindings.json`/live driver state and show `session_id`, runtime, native ID, cwd, channel key, and status.
- can detect completion/failure: event log must record `assistant_final` as `completed` and `error` as `failed`; stopped/cancelled should be recorded distinctly when reliable.
- can update `events.jsonl`/`state.md` externally: external orchestrator daemon tails/polls CCM's event log and owns repo state writes; CCM should not write the orchestration repo state except for the optional event file if configured there.
- can resume after orchestrator restart using stored session/channel IDs: event records plus `bindings.json` must include enough to recover `channel_id/channel_key`, `thread_ts` when available, `session_id`, `native_session_id`, `worker_type`, and `workspace`.
- does not require a long-running Codex LLM turn: the event loop remains in CCM/external controller code; Codex is invoked only for reasoning/reconciliation turns.

## Open Questions

- Should CCM accept orchestrator-supplied `goal_id`, `stage_id`, and `task_id` in a command envelope, or should the external orchestrator correlate them entirely outside CCM?
- Should the first patch emit full assistant text, truncated summaries, hashes, or file references to avoid storing sensitive content?
- What is the canonical session status for Claude completion, given Claude progress is weaker and often transcript/tool-message based rather than a structured app-server final event?
- Should `ccm events --since <cursor>` be implemented as a standalone file-reading CLI, a daemon IPC request, or both?
- Should direct programmatic launch be a daemon IPC endpoint that synthesizes `InboundMessage`, or should launch remain Slack-first for MVP while only status/events are exported?
- How should timeouts be classified: explicit `timeout` event, `failed` with reason `timeout`, or both?
- Where should channel names come from, given durable bindings store channel keys/IDs but not necessarily human-readable Slack channel names?
