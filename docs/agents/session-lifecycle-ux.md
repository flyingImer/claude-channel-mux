# Session Lifecycle UX Contract

This document records the agreed room/session lifecycle contract for Claude and Codex.

## Identity Model

- A CCM `sessionId` is the durable envelope id used by room mappings, callbacks, and operator-facing session actions.
- A provider `nativeSessionId` is the provider's own resumable session/thread id.
- Claude can make the provider id equal the CCM envelope id because Claude accepts a caller-provided session id.
- Codex converges the two ids for new sessions by using the Codex-native `thread.id` returned by `thread/start` as both `AgentSession.sessionId` and `AgentSession.nativeSessionId`.
- Legacy Codex sessions may still have a CCM UUID envelope plus separate `agentMeta.nativeSessionId`. Resume paths must trust stored native ids and must not fall back to the old envelope UUID as a Codex native id.
- Codex TUI has no independent session id. It is a view/control surface over an app-server thread.

## Codex App-Server Shape

- A CCM daemon owns one shared Codex app-server client/process for Codex app-server mode.
- Each Codex room owns one native app-server thread.
- Stopping one Codex room stops/removes that per-thread runtime from CCM, but does not kill the shared app-server process.
- Daemon shutdown owns shared app-server lifecycle implicitly through process teardown, unless a future explicit shutdown hook is added.

## Ready Semantics

- Claude ready means the Claude pane/bridge is ready.
- Codex ready means the app-server runtime, native thread materialization, effective cwd update, and remote TUI are ready.
- A fresh `thread/start` is not enough for Codex readiness because immediate `thread/resume` / TUI resume may fail with no rollout materialized.
- Codex readiness requires `thread/inject_items` with a minimal user message, then `thread/settings/update` to the effective cwd.
- `thread/settings/update` requires the app-server client to initialize with `capabilities.experimentalApi: true`.
- Codex remote TUI readiness requires an alive pane whose command targets the shared app-server URL and selects the native thread id.
- The expected Codex TUI command shape is `codex --remote <appServerUrl> resume <nativeSessionId> -C <cwd>`.
- If Codex TUI cannot be made ready, Codex new/resume/repair/direct-turn/cue/command flows should fail rather than send work into an unobservable or stale thread.

## Worktree Semantics

- New Codex sessions first allocate a native thread id in the source cwd.
- CCM then creates the Codex worktree using the native thread id as the slug source.
- CCM materializes the thread and updates its cwd to the worktree path before attaching TUI.
- `thread/read.cwd` is not sufficient proof of effective cwd; prefer `thread/settings/updated`, shell/turn event cwd, or first real turn evidence.

## Room Mapping And Desired State

- Room mappings point to CCM session ids. For new Codex sessions, that id is the Codex-native thread id.
- Room mappings persist across `stop`.
- `desiredRunning` is room-local per-agent metadata.
- `stop` keeps the room-to-session mapping, sets `desiredRunning=false`, and stops the runtime/view.
- `resume` without an id resumes only the current room mapping.
- Explicit `resume <id>` may rebind/recover a selected session when the id resolves unambiguously.
- `new` creates a new provider session/thread, then replaces the old room mapping only after the new session is fully ready.
- If `new` fails, the old mapping remains unchanged.
- Daemon startup should not eagerly repair sessions just because `desiredRunning=true`; repair happens on the next user/action trigger.
- Callback/session id parsing must accept callback-safe native Codex ids, not UUID-only ids.

## Lifecycle Gate

Direct/default messages, peer cues, and commands should share the same lifecycle gate:

- Mapping exists and `desiredRunning=false`: resume the mapped session, then act.
- Mapping exists and `desiredRunning=true` but actual runtime/view is broken: repair the mapped session, then act.
- No mapping and room path exists: create a new session, then act.
- No mapping and no room path exists: run the room path setup flow.

Resume or repair failure should drop the message/handoff with a clear error and retry/new/stop/delete options. Do not queue work across failed lifecycle transitions.

## Status And Navigation UX

- If a stopped Codex mapping exists, `/cx ss` and navigation should show a stopped panel with Resume/New/Delete Room actions.
- If a desired-running Codex mapping exists, status/navigation should repair app-server plus TUI if needed, then dump the TUI screen with controls.
- If no Codex mapping exists, status/navigation should report that no active room Codex session is mapped.
- Codex status output should make the shared app-server URL and per-room native thread id visible enough for debugging.

## Delete Room And Path Change

- `delete room` is a confirmed reset.
- A confirmed room delete stops live mapped sessions, removes room path, removes room mappings/meta/default, and clears room-local pending UI state.
- Durable provider/session history is kept for now.
- Changing the room path while existing room state is present requires confirmation and behaves as delete-room plus set-new-path.
- Native-id recovery or rebind after delete-room is out of scope for this iteration.

## Room Default Agent

- The room default agent is changed only by `ccm default claude|codex`.
- `new`, `resume`, and `stop` do not change the room default agent.
- `delete room` and confirmed path-change cleanup clear the room-local default agent.

## Related Design Records

- `docs/codex-shared-app-server-thread-identity.md` records the June 2026 Codex shared app-server / native thread id direction, rationale, execution progress, and follow-ups.
- `docs/agents/codex-app-server-debugging.md` records operational debugging checks for app-server config, provider/model routing, and TUI attachment.
