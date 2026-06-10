# Shared Codex App-Server Capability Routing Plan

Date: 2026-06-09

## Objective

Re-enable a shared Codex app-server for multiple CCM Codex sessions without reintroducing stale `CC_CHANNEL_SESSION_UUID` bridge routing bugs.

The long-term target is:

```text
ccm daemon
  -> shared Codex app-server process
      -> Codex native thread per CCM Codex session
      -> shared CCM MCP bridge registered as bridge identity
      -> tool calls routed by CCM room-session capability token
```

The current per-session app-server containment should be committed as the known-good baseline before shared work begins. After that, git history is the rollback mechanism. The target implementation should go all-in on shared app-server once the capability-routing protocol is in place; this plan does not preserve a permanent per-session runtime fallback.

## Current Problem

The previous shared app-server attempt correctly observed that Codex app-server can multiplex native threads, but it accidentally reused CCM's per-session MCP bridge identity model.

Current bridge assumptions:

- `server.ts` reads `CC_CHANNEL_SESSION_UUID` at startup.
- `server.ts` registers `{ type: "register", uuid }` with `daemon.ts`.
- `daemon.ts` records `socket -> uuid` and authorizes tool calls by checking that `args.chat_id` is bound to that UUID.
- Codex app-server MCP config is process-scoped, so a shared app-server bakes the first session UUID into all bridge instances.

This creates stale bridge identity for later Codex threads. The symptom is duplicate registration, local `not connected to daemon`, or Codex rooms stuck at `Codex app-server session starting up`.

## Design Decision

Use a **per room-session capability token**, not a per-turn TTL token.

Token identity:

```ts
token -> {
  runtime: 'codex'
  sessionId: string        // Codex native thread id / CCM Codex session id
  chatId: string           // CCM room key, e.g. slack:C123
  bindingGeneration: string
  sharedBridgeId?: string
  createdAt: number
  lastUsedAt?: number
}
```

Lifecycle:

- Create on room-to-Codex-session bind, new, or resume.
- Persist with CCM binding/session state, not transient turn state.
- Invalidate on room rebind, runtime switch, session stop/delete, explicit rotation, or binding generation change.
- Do not use short wall-clock TTL as the primary invalidation mechanism.
- Bound retention by live bindings and explicit cleanup, not by timing out active long-running turns.

Rationale:

- The missing primitive is correlation, not time-based security.
- `chat_id` is model-supplied routing hint and cannot be the proof.
- Short TTL introduces long-turn, retry, resume, and daemon-restart failures without solving the core identity gap.
- Room-session lifecycle matches the actual authorization unit.

## Required Invariants

1. A shared-bridge tool call without a valid `ccm_room_token` fails closed.
2. A valid token resolves to exactly one current Codex session and room binding.
3. `args.chat_id` is advisory under token routing; if present and mismatched with token `chatId`, reject and audit.
4. Tokens are opaque, random, and unguessable; never derive from `chat_id`, session id, or thread id.
5. Raw token values are never logged; logs and audit use token hashes or short fingerprints only.
6. Per-session bridge mode remains supported only until shared bridge mode is implemented and validated; it is not a long-term runtime branch.
7. Shared bridge registration uses bridge identity, not session UUID identity.
8. Stopping one Codex room in shared mode must not kill the shared app-server if other rooms still use it.
9. Daemon restart must either restore token state or fail stale calls with clear, recoverable UX.

## Implementation Phases

### Phase 0: Baseline and Audit-Only Token Plumbing

Goal: introduce the capability model without changing production routing.

Changes:

- Add token storage helpers in `daemon.ts` or a small extracted state module.
- Add a persisted token state file near existing CCM state files.
- Add binding generation metadata to distinguish old room-session mappings from current mappings.
- Generate `ccm_room_token` when Codex room/session binding is created or resumed.
- Include `ccm_room_token` in Codex turn context in `agents/codex/app-server-driver.ts`.
- Add optional `ccm_room_token` fields to CCM MCP tool schemas in `server.ts`.
- Keep current per-session socket UUID authorization as source of truth only for Phase 0 audit-only validation.
- Audit token presence and mismatches without requiring token.

Files:

- `daemon.ts`
- `agents/codex/app-server-driver.ts`
- `server.ts`
- `state.ts`
- `bindings.ts`
- `test/state.test.ts`
- `test/codex-driver-fixtures.test.ts`
- `test/parity-static.test.ts`

Tests:

- Token generated on Codex bind/new/resume.
- Token persists and reloads.
- Token is included in `<ccm_turn>` context.
- Tool schemas expose optional `ccm_room_token`.
- Audit-only path does not alter pre-cutover per-session behavior.

Exit gate:

- Existing per-session app-server behavior unchanged.
- No raw token appears in logs or test snapshots.
- Targeted and full test suite pass.

### Phase 1: Token-First Routing Resolver

Goal: teach daemon to route by token and prepare to replace UUID socket routing for Codex shared mode.

Changes:

- Split `handleTool(msg, uuid)` into caller resolution and tool execution.
- Introduce caller contexts:

```ts
type ToolCaller =
  | { kind: 'session'; sessionId: string }
  | { kind: 'capability'; tokenHash: string; sessionId: string; chatId: string; bindingGeneration: string }
```

- Resolve canonical room as:
  - valid token present: use token `chatId`; reject if supplied `chat_id` conflicts.
  - no token before cutover: use current `socket -> uuid -> canonicalToolChannelKey()` path.
- Add audit events:
  - `capability_token_used`
  - `capability_token_missing`
  - `capability_token_unknown`
  - `capability_token_chat_mismatch`
  - `capability_token_binding_stale`
  - `capability_pre_cutover_route`

Files:

- `daemon.ts`
- `server-ipc.ts`
- `test/parity-static.test.ts`
- potentially a new focused token test file under `test/`

Tests:

- Valid token routes to token room.
- Mismatched `chat_id` rejects and audits.
- Unknown token rejects in shared-bridge context; before cutover, current per-session context can still use socket UUID routing.
- Binding generation mismatch rejects.
- Room rebind invalidates old token.
- Stop/delete invalidates token.

Exit gate:

- Token routing can be exercised in tests without enabling shared app-server.
- Token routing can replace per-session socket authorization once shared mode is enabled.

### Phase 2: Shared Bridge Registration Mode

Goal: replace per-session MCP bridge identity with shared app-server bridge identity.

Changes:

- Add new `server.ts` startup mode for the shared Codex bridge:

```text
CC_CHANNEL_BRIDGE_MODE=codex-app-server
CC_CHANNEL_BRIDGE_ID=<opaque bridge id>
CC_CHANNEL_DAEMON_SOCK=<sock>
```

- In shared mode, `server.ts` registers with daemon using a new IPC frame instead of overloading session UUID:

```json
{ "type": "register_bridge", "bridgeKind": "codex-app-server", "bridgeId": "...", "pid": 123 }
```

- Daemon records `socket -> bridgeId` separately from `socket -> sessionId`.
- Tool calls from shared bridge require valid `ccm_room_token`.
- Tool calls from shared bridge never fall back to `chat_id` alone.
- Duplicate protection applies per bridge identity, not per session UUID.

Files:

- `server.ts`
- `server-ipc.ts`
- `daemon.ts`
- `test/parity-static.test.ts`

Tests:

- Shared bridge registers without `CC_CHANNEL_SESSION_UUID`.
- Shared bridge duplicate registration is handled independently of session duplicate registration.
- Shared bridge tool call without token fails closed.
- Shared bridge tool call with token routes correctly.
- Per-session bridge path still registers with `{ type: 'register', uuid }` only until the shared path is ready to become the normal path.

Exit gate:

- Shared bridge protocol exists and is tested before app-server sharing is turned on.

### Phase 3: Shared Codex App-Server Client Cutover

Goal: reintroduce shared Codex app-server client only after token routing and shared bridge registration exist.

Changes:

- `agents/codex/app-server-driver.ts` uses one app-server client per daemon/driver instead of one per session.
- Shared app-server launch config starts the CCM MCP bridge in bridge mode, not session mode.
- Session/runtime identity remains native Codex thread id.
- Stop in shared mode removes only runtime/thread/token/TUI state, and stops the shared app-server only when no Codex runtimes remain or on daemon shutdown.
- Resume in shared mode reuses app-server URL, native thread id, and room token generation.

Files:

- `agents/codex/app-server-driver.ts`
- `agents/codex/session.ts`
- `daemon.ts`
- `docs/codex-shared-app-server-thread-identity.md`
- `test/codex-driver-fixtures.test.ts`
- `test/codex-session.test.ts`

Tests:

- Two Codex rooms share one app-server URL.
- Each room gets distinct native thread id and distinct `ccm_room_token`.
- Reply from room A with token A routes to room A.
- Reply from room A with token A but `chat_id` B rejects.
- Stop room A leaves room B's runtime/app-server alive.
- Resume room A preserves or rotates token according to binding generation rules.
- App-server startup failure reports clearly without corrupting bindings.

Exit gate:

- Shared mode works in unit/integration tests and can be enabled in local/live validation.
- No automatic runtime downgrade from shared to per-session is added.

### Phase 4: Recovery, HA, and UX Hardening

Goal: make shared mode operationally safe as the normal Codex runtime architecture.

Scenarios to cover:

- daemon restart while shared app-server is alive;
- daemon restart while Codex turn is running;
- shared app-server crash;
- one Codex thread crashes or becomes unreadable;
- TUI tab dies while app-server remains alive;
- room rebind while old Codex context later calls a tool;
- token state file missing/corrupt;
- duplicate shared bridge registration;
- missing/wrong token in model tool call.

Expected UX:

- Missing token: visible tool error instructs agent to use current `ccm_room_token`.
- Stale token: visible tool error says room/session binding changed; user can retry or resume.
- Shared app-server crash: affected Codex rooms marked degraded, with resume/start buttons.
- Daemon restart with lost token state: fail closed for shared bridge, or restore tokens from persisted bindings if state is valid.
- Wrong-room attempt: reject loudly and audit, never silently deliver.

Observability:

- Add `ccm status` / `ccm agents` fields for Codex bridge mode, app-server URL, bridge id, native thread id, token generation/fingerprint, and degraded reason.
- Add audit counters for missing, mismatched, stale, and successful token routing.
- Never log raw tokens.

Exit gate:

- Local and live-like soak passes multi-room new/resume/stop/restart/crash matrix.
- Operator can identify whether a failure is token, bridge, app-server, TUI, or daemon state.

### Phase 5: Controlled Cutover and Per-Session Removal

Goal: complete the move to shared app-server as the single normal Codex architecture.

Rollout gates:

- New Codex session latency improves materially.
- Process count and memory usage improve under multi-room load.
- Missing-token and stale-token rates are near zero in normal use.
- No wrong-room delivery occurs in soak or production shadowing.
- Daemon restart recovery is documented and tested.
- Operational recovery is handled through shared-mode repair paths, not per-session runtime fallback.

Cutover steps:

1. Enable shared mode in local validation.
2. Enable shared mode in one low-risk live room for soak.
3. Enable shared mode for all new Codex sessions.
4. Let existing per-session sessions age out or explicitly restart them into shared mode.
5. Remove per-session runtime code after shared-mode recovery paths pass the full matrix; the committed baseline remains available through git history.

## Non-Goals

- Do not treat `ccm_room_token` as a hard security boundary against malicious prompt injection.
- Do not use `chat_id` alone as authorization proof in shared mode.
- Do not add short TTL as the primary lifecycle mechanism.
- Do not build automatic fallback from shared to per-session.
- Do not keep per-session app-server as a product/runtime mode after shared mode is proven.
- Do not require Codex upstream changes or per-thread MCP metadata.

## Open Questions

- Should token state live inside `bindings.json` agent metadata or in a separate `capability-tokens.json` file keyed by token hash?
  - Recommendation: separate file keyed by token hash, with binding generation mirrored in binding metadata.
- Should completed/rebound tokens be tombstoned briefly for better error messages?
  - Recommendation: yes, keep token hash tombstones without raw token for recent invalidations.
- Should `chat_id` mismatch be hard reject or corrected to token room?
  - Recommendation: hard reject and audit; silent correction hides model confusion.
- Should shared bridge support multiple app-server processes later?
  - Recommendation: design `bridgeId` as opaque and not globally singleton, so multiple shared app-servers are possible later.

## Validation Plan

Required commands before enabling shared mode in production:

```bash
bun run typecheck
bun run check:diff
bun test
```

Additional live validation before full cutover:

- Start two Codex rooms in shared mode.
- Confirm one app-server URL serves both native thread ids.
- Confirm each room has a distinct `ccm_room_token` fingerprint.
- Send replies from both rooms and verify routing.
- Attempt mismatched `chat_id` with valid token and verify rejection.
- Stop one room and verify the other remains alive.
- Restart daemon and verify token recovery or clear stale-token UX.
- Crash shared app-server and verify degraded state plus recovery controls.

## Implementation Order Summary

1. Add lifecycle token model and audit-only prompt/schema plumbing.
2. Add token-first daemon routing resolver.
3. Add shared bridge registration mode.
4. Cut over Codex driver to shared app-server.
5. Harden recovery/HA/UX.
6. Roll out shared mode, then remove the per-session runtime code.

## All-In Shared Runtime Philosophy

Per-session app-server is useful as a committed baseline, but carrying two runtime architectures would create maintenance drag and ambiguous failure recovery. The plan should converge on one normal Codex runtime: shared app-server with capability routing.

Do not silently convert a failed shared session into per-session mode at runtime. Fix shared-mode recovery instead.

Deletion gate for the current per-session runtime code:

- shared mode has passed daemon restart, shared app-server crash, stop-one-room, resume-many-rooms, and mismatched-token soak;
- operator status clearly separates token, bridge, app-server, TUI, and daemon-state failures;
- shared mode has run long enough in production that per-session runtime code is no longer needed;
- a final deletion review explicitly accepts relying on the committed baseline in git history instead of carrying a runtime branch.
