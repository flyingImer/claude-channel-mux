# Production Restart Checklist

Use this when shipping local changes to the live CCM daemon on this host.

## Ground Rules

- Production daemon is controlled by user systemd unit `ccm-daemon.service`.
- Do not use `nohup bun daemon.ts`, `setsid`, or manual background processes for production. Those processes can be killed with the shell/session and can conflict with the systemd-owned socket and pid files.
- The production unit currently runs from the marketplace checkout path and uses `~/.config/claude-channel-mux/daemon.sock` plus `daemon.pid`.
- Keep GitHub/repo practice: commit with `flyingImer <flyingImer@users.noreply.github.com>` and verify auth before any push.

## Before Restart

1. Run the regression suite from the marketplace checkout:

   ```bash
   bun run validate
   ```

2. Refresh Claude and Codex plugin caches when skills, prompts, MCP tools, schemas, or plugin runtime code changed. At minimum sync the active checkout into:

   ```text
   ~/.codex/plugins/cache/claude-channel-mux-local/claude-channel-mux/0.3.2
   ~/.claude/plugins/cache/claude-channel-mux/claude-channel-mux/0.3.0
   ```

   Preserve cache-local metadata such as `.git/`, `node_modules/`, and `.in_use/` when syncing.

3. Verify MCP tool cache markers for Agent Control Path changes. For example, after raw worker command changes, both caches should contain `send_worker_raw_command` in `mcp-tools.ts`, `authorized_control_tools`, and the daemon handler.

## Restart

Use systemd only:

```bash
systemctl --user restart ccm-daemon.service
sleep 3
systemctl --user status ccm-daemon.service --no-pager
```

Confirm the daemon process is systemd-owned:

```bash
PID="$(cat ~/.config/claude-channel-mux/daemon.pid)"
ps -p "$PID" -o pid,ppid,sid,pgid,etime,stat,cmd
systemctl --user is-active --quiet ccm-daemon.service
```

Expected shape: `PPID` is the user systemd process, command is `bun daemon.ts`, and the service is active.

## Smoke Test

1. Confirm socket and logs:

   ```bash
   test -S ~/.config/claude-channel-mux/daemon.sock
   tail -n 120 /tmp/ccm-daemon-error.log
   tail -n 120 /tmp/ccm-daemon-output.log
   ```

2. Run targeted smoke for changed surfaces. For MCP/tool/prompt changes, include:

   ```bash
   bun test test/room-control-daemon.test.ts test/orchestration-harness.test.ts test/parity-static.test.ts -t "MCP exposes|daemon room control routes|portable prompt pack|orchestrate-workers resolves|plugin ships CCM orchestration role skills|path binding and slash passthrough confirmations"
   ```

3. Run or confirm full validation after restart when practical:

   ```bash
   bun run validate
   ```

4. Confirm service survived validation:

   ```bash
   systemctl --user is-active --quiet ccm-daemon.service
   PID="$(cat ~/.config/claude-channel-mux/daemon.pid)"
   ps -p "$PID" -o pid,ppid,etime,stat,cmd
   ```

## Known Benign Warnings

- `Session 'ccmux' not found` and related zellij pane cleanup warnings can appear after restart when the historical zellij session is gone. Treat them as non-fatal if the service is active, Slack/Telegram startup logs are present, and no fatal patterns appear.

## Fatal Log Scan

Fail the smoke if recent daemon logs include:

```text
uncaught
unhandled
EADDRINUSE
failed to write pid
IPC server error
TypeError
ReferenceError
SyntaxError
```
