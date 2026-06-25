# Per-Session Zellij TUI Lifecycle

CCM uses zellij as the real interactive terminal surface for Claude and Codex, but the ownership model differs by runtime.

## Claude: durable backend zellij

Each Claude slot runs inside its own backend zellij session named `ccm-cc-<session-prefix>`. The Claude process stays in that backend session even when no human terminal client is attached.

- `/cc tui on` reports the local attach command, for example `zellij attach ccm-cc-019e94e5`.
- `/cc tui status` reports the backend session name, attach command, connected client count, zellij server PID when discoverable, and RSS fields when `/proc` exposes them.
- `/cc tui off` does not stop Claude and does not kill the backend zellij server. It reports connected clients and asks the operator to close/detach any remaining local terminals when targeted client termination is unavailable.
- `ccm stop claude` is the operation that tears down the Claude backend zellij session.

This keeps the Claude TUI fully interactive on demand while avoiding a single shared `ccmux` zellij server accumulating many Claude tabs.

## Codex: durable app-server, disposable TUI

Codex durability is owned by `codex app-server`. The zellij TUI is only an optional remote terminal client for that app-server thread.

- `/cx tui on` creates or reuses a zellij session named `ccm-cx-<session-prefix>` and launches the real Codex remote TUI in it.
- `/cx tui status` reports the disposable TUI session name, attach command, connected client count, server PID, and RSS when discoverable.
- `/cx tui off` kills only the disposable zellij TUI session. The Codex app-server session continues running.
- `ccm stop codex` stops the Codex app-server and also removes its disposable TUI session if present.

## Memory expectations

Per-session zellij isolates memory growth by agent slot. It is not proof that zellij RSS is low. Use `scripts/measure-zellij-tui-memory.ts` before treating the remedy as successful for large deployments.

Useful comparisons:

```bash
bun scripts/measure-zellij-tui-memory.ts --sessions ccm-cc-019e94e5 ccm-cx-019e94e5
bun scripts/measure-zellij-tui-memory.ts --prefix ccm-
bun scripts/measure-zellij-tui-memory.ts --prefix ccm- --require-per-session --max-per-session-rss-kb 1048576
```

Interpretation:

- `rss_kb` is total zellij server RSS for the discovered session server process.
- `rss_anon_kb` is anonymous RSS when Linux `/proc/<pid>/status` exposes it.
- `unknown` means the process was not discoverable or `/proc` did not expose the field; it is not a zero value.
- The `gate` object exits non-zero when `--require-per-session` or threshold options fail, so rollout checks can compare shared `ccmux` RSS against aggregate per-session RSS without restarting CCM.
