---
title: "CCM daemon systemd and TUI control-path drift"
date: 2026-06-25
category: docs/solutions/integration-issues
module: ccm-daemon-lifecycle
problem_type: integration_issue
component: tooling
symptoms:
  - "`/cc tui on` was delivered to Claude as a native slash command instead of handled by CCM"
  - "`systemctl --user status ccm-daemon` reported inactive while a detached daemon still answered the socket"
  - "Startup cleanup logged zellij errors after the shared `ccmux` session was intentionally removed"
  - "Claude resume flow could not observe a per-session backend pane after `ccmux` was killed"
root_cause: missing_workflow_step
resolution_type: code_fix
severity: high
related_components:
  - "zellij session lifecycle"
  - "Claude navigation watcher"
  - "Codex disposable TUI"
tags: [ccm-daemon, systemd, zellij, tui, observability]
---

# CCM daemon systemd and TUI control-path drift

## Problem

The per-session zellij TUI migration changed two operational assumptions at once: Claude no longer needed to live inside the shared `ccmux` zellij session, and Codex could create a disposable zellij TUI without owning the app-server runtime. That was the right lifecycle model, but it exposed stale control-path assumptions.

The visible failure was that `/cc tui on` reached the Claude process as a raw slash command instead of being handled by CCM. At the same time, daemon health looked contradictory: the PID and socket were alive, but `systemctl --user status ccm-daemon` showed the service as inactive because an emergency detached daemon had been started outside the supervisor.

## Symptoms

- `/cc tui on` became a Claude-native command attempt such as `/tui on`, so the user saw no CCM attach instructions.
- `/cx tui on` risked the same class of failure for Codex because prefixed agent commands were parsed before dedicated TUI control commands.
- `systemctl --user status ccm-daemon` was not authoritative after manual `bun daemon.ts` restarts, even though socket smoke checks and IPC calls could still succeed.
- `cleanExitedTabs()` produced misleading startup zellij noise after the shared `ccmux` session was intentionally absent.
- Claude resume/navigation for session `1f0012eb` depended on pane lookup through the old default zellij session and therefore missed the per-session backend pane.

## What Didn't Work

- **Treating an alive daemon PID as enough.** The daemon can answer its socket while no longer being the systemd-managed service that operators inspect and restart.
- **Keeping a detached manual daemon running.** It restores short-term message handling but splits operational truth between `daemon.pid`, the socket, and `systemctl`.
- **Letting `/cc` and `/cx` subcommands fall through to raw/native passthrough.** Agent-native slash commands are useful only after CCM has intercepted CCM-owned controls.
- **Assuming `ccmux` always exists.** After the per-session zellij migration, absence of the shared session can be intentional and must not be treated as a cleanup failure.
- **Listing panes only in the default zellij session.** Per-session backend ownership means resume, screen dump, and watcher code must query the target session name.

## Solution

Make daemon ownership and TUI command routing explicit.

First, return daemon process ownership to the user systemd service. For normal restarts, use `systemctl --user restart ccm-daemon` rather than a detached `bun daemon.ts`. If an emergency manual daemon is unavoidable, stop it and hand back to systemd before trusting service status.

Second, parse `/cc tui on|off|status` and `/cx tui on|off|status` as CCM commands before raw/native passthrough. The regression test slices the `/cc` and `/cx` parse blocks and asserts the `tuiSubM` interception appears before the raw slash or agent-command fallback.

Third, add command-path observability around TUI handling. The daemon now emits `tui_command_received` before dispatch and `tui_command_executed` with `ok` or an error after dispatch, and it surfaces failures back into the room instead of silently looking like a daemon outage.

Fourth, make zellij session lookup target-aware. `escort.ts` exposes `listPanesInSession(sessionName)` and checks that specific zellij session before listing panes, so Claude backend sessions do not depend on the legacy default `ccmux` server being alive.

Finally, make cleanup and navigation match the new lifecycle. Startup cleanup skips when `ccmux` is absent, and Claude navigation only suppresses true task-list screens; resume/selection prompts with `↑/↓ to select · Enter to view` still trigger actionable navigation.

## Why This Works

The fix separates three different lifecycles that had been blurred together:

- **Supervisor lifecycle:** systemd owns the production daemon process and is the source of truth for restart/status.
- **Claude backend lifecycle:** a per-session zellij server owns the long-running Claude TUI and can survive client detach/reattach.
- **Codex TUI lifecycle:** a disposable zellij TUI can be started or killed while the Codex app-server session continues.

With that separation, `/cc tui off` can remove zellij client overhead without stopping Claude, while `/cx tui off` can kill the disposable Codex TUI session without killing Codex app-server state. The parser and audit events make those lifecycle actions visible as CCM controls instead of ambiguous agent-native input.

## Prevention

- Use `systemctl --user restart ccm-daemon` for normal daemon restarts; do not leave a detached manual daemon as the steady-state owner.
- Verify both layers during incidents: `systemctl --user status ccm-daemon` for supervisor ownership and a socket/IPC smoke check for daemon responsiveness.
- Intercept every CCM-owned `/cc` or `/cx` control before raw/native passthrough, and add static tests that assert ordering inside `parseCmd`.
- Add explicit audit events for control commands that are expected to produce visible room notices.
- Treat missing shared `ccmux` as valid after per-session zellij migration unless the specific command requires the shared session.
- Query zellij panes by target session name whenever code operates on a per-session backend or disposable TUI.

## Related Issues

- `docs/solutions/integration-issues/ccm-agent-sessions-forward-litellm-routing-env.md` covers a neighboring daemon launch-contract failure where zellij/app-server surfaces did not receive the intended routing environment.
- `docs/solutions/integration-issues/ccm-orchestration-shared-codex-bridge-routing-failures.md` covers explicit control-path routing for shared Codex bridge calls.
- `docs/solutions/workflow-issues/ccm-orchestration-steering-vs-execution.md` covers the broader distinction between durable operator intent and low-level execution mechanics.
