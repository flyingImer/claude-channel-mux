# Codex Shared App-Server Thread Identity Direction

This document records the June 2026 Codex lifecycle direction that moved CCM from one app-server/client per Codex room toward one shared app-server process with one native Codex thread per room.

## Rationale

The old Codex lifecycle had two identities for the same logical Codex room:

- a CCM-generated envelope/session id, usually a UUID;
- a Codex-native `thread.id` / `sessionId` returned by `thread/start`.

That split made start/resume/stop/debugging harder than necessary. Room bindings, pending request keys, TUI tab names, worktree names, transcript records, and app-server notifications could each point at different ids. Bugs then surfaced as stale TUI panes, failed resume, hard-to-explain app-server readiness states, and confusion about which id a user-visible action targeted.

The new direction is:

```text
ccm daemon process 1
  -> codex app-server process 1
      -> ccm rooms N
          -> codex native thread 1 per room
              -> zellij TUI tab 1 per thread
```

For new Codex sessions, CCM treats the Codex-native `thread.id` as both:

- `AgentSession.sessionId`, the CCM envelope id used by room mappings and callbacks;
- `AgentSession.nativeSessionId`, the provider-native Codex id.

This makes the user-visible Codex session, the app-server route, and the TUI target converge on one id.

## Upstream Context

Local source checks against Codex app-server showed that one app-server process is intended to manage multiple threads/connections:

- `ThreadStateManagerInner` keeps a `HashMap<ThreadId, ThreadEntry>`.
- `MessageProcessor` owns process-scoped thread managers.
- app-server APIs expose thread lifecycle methods such as `thread/start`, `thread/resume`, `thread/read`, and `thread/list`.

Smoke experiments against `codex-cli 0.136.0` established these practical constraints:

1. `thread/start` returns a native thread id, and `thread/read` reports `id === sessionId` for that native id.
2. A fresh `thread/start` is not enough for `thread/resume` or `codex --remote <url> resume <threadId>` to work; it can fail with `no rollout found for thread id ...`.
3. `thread/settings/update` requires `initialize.capabilities.experimentalApi = true`.
4. `thread/inject_items` with a minimal user message materializes resumability without a model turn.
5. After materialization, `thread/settings/update` can set the effective cwd even when `thread/read.cwd` is stale.
6. The TUI should be attached with both native thread id and explicit cwd:

```bash
codex --remote <shared-app-server-url> resume <threadId> -C <worktree>
```

## Current Production Shape

June 9, 2026 update: production is temporarily back to one Codex app-server/MCP bridge per CCM Codex session. Native Codex thread id is still used as the stable session id, but the app-server client is no longer shared across unrelated CCM rooms.

This containment preserves the daemon's existing per-session MCP registration and duplicate-registration model while avoiding stale `CC_CHANNEL_SESSION_UUID` inheritance inside Codex-launched MCP bridge processes.

## Previous Shared-App-Server Shape

The shared-app-server implementation followed this sequence for new Codex sessions:

1. Ensure the driver has a shared `CodexAppServerClient`; starting one Codex room no longer creates a separate app-server process.
2. Initialize the app-server client with `experimentalApi: true`.
3. Call `thread/start` in the source cwd to allocate a native Codex thread id.
4. Treat the returned thread id as the CCM session id for the new room.
5. Create the Codex worktree using that native thread id as the worktree/branch slug source.
6. Materialize resumability with `thread/inject_items` using a minimal user message.
7. Apply the worktree cwd with `thread/settings/update`.
8. Store the Codex room binding under the native thread id.
9. Attach remote TUI with `codex --remote <url> resume <threadId> -C <worktree>`.
10. Consider the TUI ready only if the pane command matches both the shared app-server URL and the native thread id.

Important code seams:

- `agents/codex/app-server-client.ts` owns process transport and app-server `initialize` capability negotiation.
- `agents/codex/app-server-driver.ts` owns app-server clients, per-thread runtime records, `thread/inject_items`, `thread/settings/update`, and native-thread runtime lookup.
- `agents/codex/session.ts` owns remote TUI command construction and readiness checks.
- `daemon.ts` owns provisional start orchestration, worktree creation after native id allocation, room binding updates, and service callbacks.

## Resolved Detour: Shared MCP Bridge Session Identity

The shared Codex app-server baked the first Codex session id into the `claude-channel-mux` MCP server environment and config args. Later Codex threads in the same app-server could therefore load MCP bridge processes that registered with a stale `CC_CHANNEL_SESSION_UUID` / `CODEX_CHANNEL_SESSION_UUID` instead of the room's current Codex thread id.

Two related failure modes have been observed:

- A connected stale bridge may call `reply` for a different room and hit the daemon's cross-room `chat_id` guard unless the daemon recognizes that both rooms share the same Codex app-server URL.
- A secondary stale bridge may be rejected by daemon duplicate-registration protection and then fail tool calls locally with `reply failed: not connected to daemon`, including file-upload attempts.

The shipped short-term containment stops sharing Codex app-server clients across CCM Codex sessions and restores one app-server/MCP bridge per session. That keeps the daemon's existing per-session UUID authorization model and duplicate-registration protection intact, directly addresses both observed failure modes, and is simpler to validate and roll back than introducing a thread-neutral bridge protocol.

The longer-term design can revisit a thread-neutral shared bridge, but that should be a separate protocol change: `server.ts` and daemon registration would need an app-server identity distinct from an agent session UUID, and daemon tool authorization would need to preserve the previous cross-room safety invariant while routing by `chat_id`, app-server URL, and Codex thread context.

## Execution Progress

Completed and shipped:

- Per-CCM-session app-server client after the June 9 containment fix; the earlier shared app-server client remains documented here as a direction to revisit only with a thread-neutral bridge protocol.
- New Codex `AgentSession.sessionId === AgentSession.nativeSessionId === Codex thread.id`.
- Per-thread runtime lookup prefers native session id and keeps aliases for provisional/legacy ids where needed.
- Per-room stop now kills that room's app-server client because each room owns its bridge process again.
- `thread/inject_items` + `thread/settings/update` materialization gate.
- `experimentalApi: true` in app-server initialize payload.
- Worktree creation moved after native thread allocation so new worktrees use the native id.
- Remote TUI launch changed to `--remote <url> resume <threadId> -C <cwd>`.
- TUI stale/readiness checks require URL and native thread id, not URL alone.
- Callback/session id validation relaxed from UUID-only to callback-safe native ids.
- Regression coverage for app-server startup, materialization, cwd update, TUI attach/readiness, and experimental API initialization.
- Full validation passed before production deploy: `bun run validate` with `416 pass / 0 fail` after the experimental API hotfix.
- Regression coverage for the containment fix ensures distinct CCM sessions get distinct app-server clients, while rematerializing the same native thread reuses its existing client.
- Full validation passed after the containment fix: targeted Codex driver/static/binding tests, `bun run typecheck`, `bun run check:diff`, and `bun test` with `422 pass / 0 fail`.

Observed after deploy:

- `ccm new codex` can line up the app-server native thread and TUI session at least at the visible/session-control level.
- The first production restart exposed the missing `experimentalApi` capability; the hotfix was shipped in commit `948ab9a Enable Codex experimental API`.

## Compatibility Notes

Legacy Codex room bindings may still contain a CCM UUID envelope plus separate `agentMeta.nativeSessionId`. Resume paths should continue to trust stored native ids and avoid falling back to the old envelope UUID as a Codex native id.

Callbacks and user-entered ids now need to tolerate safe non-UUID native Codex ids. Keep id parsing strict enough for callback safety, but do not reintroduce UUID-only assumptions for Codex.

Pending request state is still keyed through CCM session ids in some persisted structures. For new Codex sessions this is the native thread id, but old pending records may still reference legacy envelope ids until they expire or are cleared.

## Operational Checks

When diagnosing a Codex start/TUI issue, check these in order:

1. app-server process starts once per active Codex room/session under the daemon;
2. initialize payload includes `capabilities.experimentalApi: true`;
3. `thread/start` returned the id stored in room binding/session state;
4. `thread/inject_items` succeeded before TUI attach;
5. `thread/settings/update` succeeded for the worktree cwd;
6. TUI command includes `--remote`, `resume <threadId>`, and `-C <worktree>`;
7. pane readiness checks match both app-server URL and native thread id;
8. room binding and app-server notifications route through the same native thread id;
9. the MCP bridge process for that app-server registers with the same session id as the room binding, not the first Codex session started by the daemon.

## Open Follow-Ups

- Add a production-equivalent smoke that starts a real Codex room and verifies app-server thread id, binding id, worktree path, and TUI command in one flow.
- Revisit shared app-server only after designing a thread-neutral bridge registration and authorization protocol.
- Audit transcript discovery and old persisted session maps for any remaining UUID-only assumptions.
- Improve operator-facing status output to show each app-server URL plus per-room native thread ids clearly.
