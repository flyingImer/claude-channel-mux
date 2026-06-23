# Agent Raw Passthrough Control Plan

## Purpose

Add an Agent Control Path operation that lets an orchestrator room send an explicit raw native control command to any managed worker agent slot, starting with Claude Code and Codex. The immediate use case is hands-off worker setup such as sending Claude Code `/effort ultracode` after `start_worker_agent`, without asking a human to enter `/cc effort ultracode` in the worker room.

## Current Behavior

- Slack `/cc ...` normalizes to CCM text in `adapters/slack.ts`, then `parseCmd` converts non-intercepted Claude commands into `t: 'slash'` in `daemon.ts`.
- `case 'slash'` only targets the current room's Claude slot. It resolves the zellij pane and writes the command into Claude Code via `writeChars` plus `sendKeys('Enter')`.
- Codex does not have a pane passthrough. `/cx raw /command ...` is explicit and experimental; it sends a slash-shaped turn to Codex app-server rather than emulating Codex TUI internals.
- Agent Control Path currently exposes worker lifecycle operations only: create, archive, bind, start, send task, and capture report. `send_worker_task` is a normal worker turn, not a native command channel.

## Product Decision

Introduce one intentionally sharp ACP tool:

`send_worker_raw_command`

This tool is not a general user message. It is a control-plane command channel from an orchestrator-capable parent room to a bound worker room's selected runtime. The command is explicit, audited, and runtime-aware.

## Contract

### Inputs

- `chat_id`: optional parent/orchestrator room key, following the existing current-room resolution behavior.
- `room_id`: worker room channel key or platform-local room id.
- `runtime`: `claude` or `codex`.
- `command`: raw native command text. Must be slash-shaped after trimming.
- `mode`: optional; default `native_control`.
- `thread_id`: optional response thread pointer for notices/facts only; it must not affect command delivery semantics.

### Output Facts

Return JSON facts similar to existing ACP operations:

- `ok`
- `operation: "send_worker_raw_command"`
- `platform`
- `roomId`
- `runtime`
- `commandName`
- `delivery`: `claude_pane` or `codex_app_server_turn`
- `nativeCommandId` when Codex app-server returns a turn id

### Authorization And Safety

- Require `assertOrchestratorRoom(route.channelKey)`.
- Resolve `room_id` using `channelKeyForRoomId(route.channelKey, room_id)`.
- Require same-platform parent and worker room.
- Require worker room to be bound to a cwd before delivery.
- Require a session for the selected runtime.
- For Claude, require the session to be live and pane-resolvable.
- For Codex, require the Codex session object/runtime to be loaded.
- Require `command.trim().startsWith('/')`.
- Do not auto-start or lazy-start agents from this tool; callers must use `start_worker_agent` first.
- Audit command name and redacted preview, not full unbounded command text.

## Runtime Delivery Design

### Claude Code

Reuse the existing human `/cc` passthrough mechanics, but apply them to the target worker room instead of the current room:

1. Get worker Claude session id from `bindingUuid(workerCk, 'claude')`.
2. Resolve pane with `resolvePaneId(sessionId.slice(0, 8))`.
3. Capture `before = dumpScreen(paneId)`.
4. Write the raw command with `writeChars(paneId, command)`.
5. Send Enter with `sendKeys(paneId, 'Enter')`.
6. Optionally run the same short `waitForChange` dialog detection and update worker room screen watcher state.

This makes `/effort ultracode`, `/model ...`, `/compact`, and future Claude Code commands behave the same as a human typed command in that worker's Claude Code TUI.

### Codex

Reuse the existing Codex driver's explicit raw path:

1. Add a driver-level method or lift `sendSlashCommandAsTurn` behind `sendCommand` with `/raw` semantics.
2. For ACP, call the Codex driver with a command equivalent to `/raw <command>` or a new internal `sendRawCommand` method.
3. Preserve the existing warning semantics in docs: Codex raw slash-shaped turns are experimental and source-aligned only where app-server supports them.
4. Return `nativeCommandId` when a native turn starts.

Prefer an internal method over constructing user-facing `/raw` strings if it keeps audit and result facts cleaner.

## Implementation Units

### MCP Schema

Update `mcp-tools.ts`:

- Add `send_worker_raw_command` to the Agent Control Path tool list and schemas.
- Include it in `authorized_control_tools` enum and output schema.
- Document that it requires a started worker agent and sends native runtime control, not a worker task.

Update `daemon.ts`:

- Add `send_worker_raw_command` to `AGENT_CONTROL_PATH_TOOL_NAMES`.
- Add a new MCP handler case next to `send_worker_task`.
- Factor shared worker room validation into small helpers if the handler duplication becomes noisy.

### Claude Helper

Update `daemon.ts`:

- Extract the current `case 'slash'` pane-writing logic into a helper such as `sendClaudePaneRawCommand(workerCk, sessionId, command)`.
- Keep the existing human `/cc` path using the helper so behavior stays identical.
- Ensure failure messages distinguish `no_session`, `not_running`, `pane_not_found`, and `failed_to_send_keys` for auditability.

### Codex Helper

Update `agents/codex/app-server-driver.ts`:

- Expose a narrow internal raw-command API, or support an `AgentCommand` path that ACP can call without pretending it came from Slack `/cx raw`.
- Keep unknown `/cx command` fail-closed behavior unchanged for human command parsing.
- Preserve the existing `/cx raw /command ...` user-facing capability.

Update `daemon.ts`:

- For runtime `codex`, delegate to the Codex helper and require a loaded Codex session.

### Documentation

Update:

- `docs/contracts/agent-control-path-v1.md` with `send_worker_raw_command` inputs, outputs, and safety constraints.
- `README.md` command/control docs to explain the difference between `/cc` human passthrough and ACP worker raw command.
- `prompts/ccm/chatgpt-slack-orchestration.md` so new Claude worker sessions can be configured by ACP instead of requiring a human to type `/cc effort ultracode` in each worker room.
- Relevant orchestration prompt(s) under `prompts/ccm/` to mention the sequence: bind, start, raw setup commands, send worker task.

## Tests

Add or update tests for:

- MCP schema exposes `send_worker_raw_command` and includes it in `authorized_control_tools`.
- Non-orchestrator rooms cannot call the tool.
- Worker rooms cannot use the tool as controllers unless human break-glass enables them.
- Tool fails if worker is unbound, wrong platform, no session, or not running.
- Claude runtime calls the pane-writing path with the exact slash command and Enter.
- Codex runtime routes through explicit raw command handling and preserves fail-closed normal `/cx` behavior.
- Existing `/cc effort ultracode` human passthrough remains unchanged.
- Existing `/cx raw /command ...` behavior remains unchanged.

## Rollout Sequence

1. Add schema and static parity tests for the new tool name.
2. Extract Claude pane passthrough helper while preserving `/cc` behavior.
3. Implement Claude ACP delivery and tests.
4. Expose Codex internal raw delivery and tests.
5. Add the MCP handler branch and contract documentation.
6. Update orchestration prompts to use the tool for worker setup.
7. Run targeted tests, then the repo validation suite.

## Open Questions

- Should V1 allow all slash-shaped commands or start with an allowlist such as `/effort`, `/model`, `/compact`, `/permissions`, `/mcp`?
- Should the tool return screen-change/dialog facts for Claude, or should it only rely on normal screen watcher updates?
- Should raw command delivery be allowed to parent orchestrator's own slot, or only worker rooms? V1 should prefer worker-only to keep the ACP contract focused.
