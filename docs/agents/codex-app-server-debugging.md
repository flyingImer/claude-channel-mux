# Codex App Server Debugging Notes

These notes capture lessons from the June 2026 Codex app-server authentication/model-routing incident. Keep this file public-safe: describe mechanisms and invariants, not private provider names, private URLs, private model IDs, personal launch flags, or local credentials.

## Configuration Direction

- Codex runtime configuration should have one seam: `agents/codex/config.ts`.
- Public source should only contain generic environment/config parsing. Deployment-specific values belong in local environment, service units, or other private config outside the public repo.
- Treat `CODEX_BIN` as the command prefix for deployment-specific CLI flags and wrappers. CCM may append generic runtime args after it, but should not hardcode private provider details or personal preferences.
- Keep room-specific model overrides as room metadata only. Do not write them into global Codex config files.
- The app-server process, native thread creation, per-turn requests, and remote TUI attachment must all derive command/model config from the same resolved config object.
- For the current shared app-server architecture and native thread id rationale, read `docs/codex-shared-app-server-thread-identity.md` before changing Codex lifecycle code.

## Lifecycle Direction

- CCM should run one shared Codex app-server process per daemon and one native app-server thread per Codex room.
- For new Codex sessions, `AgentSession.sessionId` should equal `AgentSession.nativeSessionId`, and both should equal the Codex-native `thread.id`.
- New Codex threads must be materialized with `thread/inject_items` before remote TUI resume is treated as ready.
- The app-server client must initialize with `capabilities.experimentalApi: true`; otherwise `thread/settings/update` fails.
- Remote TUI commands should include `--remote <url> resume <threadId> -C <cwd>` and readiness checks should match both URL and native thread id.

## Debugging Checklist

When a Codex app-server turn reports authentication, policy, provider, or invalid-model errors, audit these layers separately:

1. **Daemon service environment** — inspect the active user service environment, not just source defaults.
2. **Actual child argv** — inspect the running app-server process argv and ordering. Config args that appear after an app-server subcommand may not affect app-server startup.
3. **App-server config** — call `config/read` on the live app-server and confirm the provider/base route is what the deployment expects.
4. **Native thread state** — inspect `thread/read`, native thread id, status, and session JSONL path. Old native threads may preserve stale config/model assumptions.
5. **Materialization gate** — confirm `thread/inject_items` succeeded, `thread/settings/update` succeeded, and the effective cwd is the worktree path.
6. **Remote TUI command** — confirm the pane command includes the shared app-server URL, `resume <threadId>`, and `-C <cwd>`.
7. **Per-turn request shape** — confirm every `turn/start` carries the effective model when CCM has resolved one. It is not enough for only `thread/start` to carry it.
8. **Real room route** — verify the Slack/Telegram room binding and canonical `chat_id` resolution so tools and turns do not route through a stale room.
9. **Structured errors** — prefer structured app-server `error` events, daemon stderr hits, and live thread status over broad text search. Memory/context text may contain historical error strings and create false positives.

## Lessons Learned

- `config/read.model` may show the global Codex default even when CCM intends a different effective model. Do not use it alone as proof of the model used for a turn.
- Stronger model evidence is: child argv includes the generic model arg, `thread/start` receives the effective model, `turn/start` receives the same effective model, and a live turn completes without provider/model errors.
- When a deployment/room model is explicit, avoid resuming stale native threads that were created under different config. Start a fresh native thread instead.
- A production-equivalent probe is useful, but completion requires a real room-triggered turn when the bug was reported through Slack/Telegram.
- Keep validation layered: targeted regression tests, full `bun run validate`, service restart, live app-server probe, then real room audit.

## Public-Safety Rules

- Do not add private provider names, internal hostnames, localhost proxy ports, private model IDs, personal flags, account names, or local credential paths to public source, tests, docs, or examples.
- If a test needs deployment-specific values, use neutral placeholders such as `public.key=value`, `base-model`, or `room-model`.
- If a local service needs private values, put them in the local systemd user unit or env file, not in this repo.
