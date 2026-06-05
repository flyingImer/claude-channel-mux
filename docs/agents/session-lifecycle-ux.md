# Session Lifecycle UX Contract

This document records the agreed room/session lifecycle contract for Claude and Codex. It is a design target for future implementation work, not a claim that every path already behaves this way.

## Identity Model

- A CCM `sessionId` is the durable envelope id used by room mappings.
- A provider `nativeSessionId` is stored under that envelope once known.
- Claude can currently make the provider id equal the CCM envelope id because Claude accepts a caller-provided session id.
- Codex cannot currently make the provider id equal the CCM envelope id on new threads because `thread/start` returns a Codex-created thread id.
- Codex TUI has no independent session id. It is a view/control surface over an app-server thread.

## Ready Semantics

- Claude ready means the Claude pane/bridge is ready.
- Codex ready means both the app-server runtime and the remote TUI are ready.
- Codex remote TUI readiness requires an alive pane whose command targets the app-server URL and selects the native thread id.
- The expected Codex TUI command shape is `codex --remote <appServerUrl> resume <nativeSessionId>`.
- If Codex TUI cannot be made ready, Codex new/resume/repair/direct-turn/cue/command flows should fail rather than send work into a session that is not fully visible/control-ready.

## Room Mapping And Desired State

- Room mappings point to CCM envelope ids, not provider native ids.
- Room mappings persist across `stop`.
- `desiredRunning` is room-local per-agent metadata.
- `stop` keeps the room-to-session mapping, sets `desiredRunning=false`, and stops the runtime/view.
- `resume` without an id resumes only the current room mapping.
- Explicit `resume <id>` rebind/recovery is out of scope for this iteration.
- `new` creates a new envelope and native provider session, then replaces the old room mapping only after the new session is fully ready.
- If `new` fails, the old mapping remains unchanged.
- Daemon startup should not eagerly repair sessions just because `desiredRunning=true`; repair happens on the next user/action trigger.

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

