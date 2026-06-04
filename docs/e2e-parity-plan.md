# CCM CC/CX Parity E2E Plan

This plan is the remaining live-channel gate for the CC/CX parity work. It is intentionally short and runnable during a temporary production cutover or with separate Slack/Telegram test tokens.

## Preconditions

- Production state is backed up or untouched.
- Run the candidate daemon from this worktree with either:
  - temporary cutover of `ccm-daemon.service`, or
  - isolated `CHANNEL_DAEMON_STATE_DIR`, `CHANNEL_DAEMON_ZELLIJ_SESSION`, and separate platform tokens.
- Restrict traffic with `CHANNEL_DAEMON_ALLOWED_CHANNELS` to the test Slack channel and Telegram group. This gates inbound events plus daemon fan-out back to bound rooms that are not in the allowlist. It is a product-level routing guard, not exclusive platform event delivery; if reusing production Slack/Telegram tokens, keep production paused or expect both daemons may receive events.
- Keep `CHANNEL_DAEMON_SELF_TEST_PREFIX` unset unless intentionally testing bot-authored self messages.
- Run `bun run validate` and `bun run e2e:preflight` from the candidate worktree before switching any live service.
- Create a result file with `scripts/e2e-result.sh new <run-name>` and fill it during the test window so the final completion decision has auditable evidence instead of relying on memory. Validate it with `scripts/e2e-result.sh check <result-file>`.

## Temporary Cutover Runbook

Use this only after the production user has paused normal CCM work. The goal is to run the candidate from the same user service while preserving the old unit for immediate rollback. The helper script wraps the same commands below:

```bash
scripts/e2e-cutover.sh status
scripts/e2e-cutover.sh start-candidate
# run the smoke sections
scripts/e2e-cutover.sh restore-old
```

Manual equivalent:

1. Record the currently running version:

   ```bash
   systemctl --user is-active ccm-daemon.service
   systemctl --user show ccm-daemon.service -p FragmentPath -p WorkingDirectory -p MainPID --no-pager
   pid=$(systemctl --user show ccm-daemon.service -p MainPID --value)
   test -n "$pid" && test "$pid" != 0 && readlink /proc/$pid/cwd
   ```

2. Back up the production unit and stop the old daemon before reusing Slack/Telegram tokens:

   ```bash
   unit="$HOME/.config/systemd/user/ccm-daemon.service"
   cp "$unit" "$unit.before-cx-e2e"
   systemctl --user stop ccm-daemon.service
   ```

3. Edit the unit for the candidate window only:

   ```ini
   WorkingDirectory=<CANDIDATE_CWD>
   Environment=CHANNEL_DAEMON_ALLOWED_CHANNELS=slack:<SLACK_CHANNEL_ID>,telegram:<TELEGRAM_GROUP_ID>
   ```

   Keep the existing token, proxy, path, spawn-mode, and forward-env settings. Do not set `CHANNEL_DAEMON_SELF_TEST_PREFIX` for manual E2E.

4. Start the candidate and confirm it is really running from the worktree:

   ```bash
   systemctl --user daemon-reload
   systemctl --user start ccm-daemon.service
   pid=$(systemctl --user show ccm-daemon.service -p MainPID --value)
   readlink /proc/$pid/cwd
   systemctl --user status ccm-daemon.service --no-pager
   ```

5. Run the Slack and Telegram smoke sections below.

6. Always restore the old unit after the test window, even if the smoke fails:

   ```bash
   unit="$HOME/.config/systemd/user/ccm-daemon.service"
   systemctl --user stop ccm-daemon.service
   cp "$unit.before-cx-e2e" "$unit"
   systemctl --user daemon-reload
   systemctl --user start ccm-daemon.service
   pid=$(systemctl --user show ccm-daemon.service -p MainPID --value)
   readlink /proc/$pid/cwd
   ```

   The final cwd should be `<PRODUCTION_CWD>` unless the user explicitly requests a different production version.

## Slack Smoke

Use the provided Slack test channel.

1. Send `ccm /path/to/this/repo`.
   - Expect room cwd confirmation; no agent starts yet.
2. Send `/cx help`.
   - Expect Codex identity header and command capability list; no Codex session start required.
3. Send `/cx model test-model-for-display`.
   - Expect room-scoped override confirmation and no global Codex config write.
4. Send `codex: say exactly CX_READY`.
   - Expect `🟢 Codex` reply with `CX_READY` or a clear Codex error if auth/model is unavailable.
5. Send `/cx ss`.
   - Expect Codex snapshot with thread/cwd/model/status/recent messages. If a Codex request is pending, expect the same action panel as `/cx nav`, including target request id/method.
6. Send `/cx transcript 5`.
   - Expect recent Codex transcript entries or clear partial fallback.
7. Trigger a Codex command requiring approval/input if safe, then run `/cx nav`.
   - Expect pending action list or a clear `No pending actions` if the request completed without approval. `/cx nav N allow|session|policy|network|deny|abort` should operate the Nth pending request for the current Codex slot; `/cx nav N answer <text>` should answer input requests. If Codex exposes policy/network amendment decisions, expect explicit `Allow Policy` / `Allow Network` buttons and no invented actions outside `availableDecisions`. After clicking or replying, the acknowledgement/edit should still show the `🟢 Codex` identity header.
8. In Slack, reply in a thread with `codex: reply exactly THREAD_OK`.
   - Expect Codex to reply in the same thread with `🟢 Codex`, and Slack should also broadcast the threaded reply back to the channel (`reply_broadcast` parity). In Telegram, use a quoted reply and expect the reply anchor to be preserved where Telegram allows it.
9. Send a markdown styling prompt: `codex: reply with markdown only: **bold**, [link](https://example.com), and a 2-row markdown table with columns Name and Value`.
   - Expect Slack to render bold/link styling and preserve table readability in a monospace/code-block style. Expect Telegram to render bold/link styling without showing raw escape clutter.
10. Send a task/plan prompt: `codex: make a two-step plan for checking this repo; do not run commands`.
   - Expect editable `📋 Codex plan` message when Codex emits `turn/plan/updated`.

## Claude Regression Smoke

Run this in the same Slack test channel before or after the Codex smoke to verify the original Claude use cases still work under the multi-agent room model.

1. Send `claude: say exactly CC_READY`.
   - Expect `🟣 Claude` reply with `CC_READY`, or a clear Claude startup/auth error with the Claude identity header.
2. Send `/cc ss`.
   - Expect a Claude snapshot/screen-like response with `🟣 Claude` identity and no Codex state mixed in.
3. Send `/cc transcript 5`.
   - Expect recent Claude transcript entries or a clear fallback, with `🟣 Claude` identity.
4. If a Claude TUI prompt or permission prompt appears, send `/cc nav`.
   - Expect Claude navigation/approval buttons with Enter/Esc and arrow controls where applicable.
5. Reply in a Slack thread with `claude: reply exactly CC_THREAD_OK`.
   - Expect Claude to reply in the same thread with `🟣 Claude`, and Slack should broadcast the threaded reply back to the channel.

## Telegram Smoke

Repeat the same command sequence in the test Telegram group. Telegram lacks message history/search, so do not require `fetch_thread` parity.

## Pass Criteria

- `/cc` and `/cx` controls have the same command-shape UX for `help`, `ss`, `nav`, `transcript`, `model`, and cancel/stop semantics where supported.
- Claude regression smoke passes: `claude:` turn delivery, `/cc ss`, `/cc transcript`, `/cc nav` when prompted, identity header, and Slack thread broadcast.
- Unsupported `/cx <other>` commands fail closed with guidance to `/cx raw`, not silent fake passthrough.
- Codex replies are visibly identified as `🟢 Codex`.
- Codex pending requests are visible/recoverable through `/cx ss` and `/cx nav`; both show the target request id/method. Stale pending state after daemon/runtime restart exposes only a safe clear-stale action, and all pending acknowledgements/edited panels keep the `🟢 Codex` identity header.
- Slack threaded replies preserve same-thread delivery and channel broadcast; Telegram quoted replies preserve reply anchoring where supported.
- Markdown forward styling works on both platforms: Slack renders bold/link and keeps tables readable; Telegram renders MarkdownV2 bold/link without raw escape clutter.
- Codex plan/task-forward equivalent appears as `📋 Codex plan` when app-server emits `turn/plan/updated`.
- Production service is restored to the requested version after testing if a temporary cutover was used.
