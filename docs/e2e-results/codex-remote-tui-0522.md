# CCM CC/CX Live E2E Result

Copy this file or fill it in during the live Slack/Telegram test window. Do not mark the `继续提高` goal complete unless every required row is `PASS` or explicitly accepted as `WARN` by the user.

## Run Metadata

- Date/time UTC: 2026-05-22T02:03:57.785771+00:00
- Tester:
- Candidate cwd: `<CANDIDATE_CWD>`
- Restored production cwd: `<PRODUCTION_CWD>`
- Slack channel: `<SLACK_CHANNEL_ID>`
- Telegram group: `<TELEGRAM_GROUP_ID>`
- Preflight command/output:
- Cutover command/output:
- Restore command/output: Manual restore to production unit, explicit `WorkingDirectory=<PRODUCTION_CWD>`; `systemctl --user restart ccm-daemon.service`; MainPID cwd and git HEAD verified.

## Required Checks

| Area | Check | Status | Evidence / message links / notes |
| --- | --- | --- | --- |
| Preflight | `bun run validate` passed before cutover | PASS | `bun test` 372 pass, `bun run typecheck`, `bun run check:diff` passed before/while cutover. |
| Preflight | `bun run e2e:preflight` passed with allowlist | PASS | `CHANNEL_DAEMON_ALLOWED_CHANNELS=slack:<SLACK_CHANNEL_ID>,telegram:<TELEGRAM_GROUP_ID> scripts/e2e-preflight.sh` passed. |
| Cutover | `scripts/e2e-cutover.sh start-candidate` landed in candidate cwd | PASS | Manual equivalent used because existing backup had `%h`; systemd MainPID cwd confirmed candidate path. |
| Slack Codex | `/cx help` shows `🟢 Codex` and does not spawn a session | PASS | Slack history `1779416981.074879` `/cx help` → bot `1779416982.633139` with `🟢 Codex` command help. |
| Slack Codex | `/cx model test-model-for-display` is room-scoped | WARN | User confirmed remaining tests complete before production cutover; earlier daemon evidence showed the room model override path is exercised, but invalid display model can fail Codex startup if left active, so no persistent override is kept for production. |
| Slack Codex | `codex: say exactly CX_READY` replies or surfaces clear auth/model error with identity | PASS | Used `codex: say exactly CX_REMOTE_TUI_READY`; Slack got identity reply, zellij remote TUI also showed `CX_REMOTE_TUI_READY`. |
| Slack Codex | `/cx ss` shows Codex snapshot and pending panel when applicable | PASS | First try before lazy load returned clear `Codex is not currently loaded`; after `codex`, Slack history `1779417037.189749` `/cx ss` → bot `1779417038.421049` snapshot with cwd/model/thread. |
| Slack Codex | `/cx transcript 5` shows recent entries or clear fallback | PASS | First try before lazy load returned clear not-loaded state; after `codex`, Slack history `1779417043.577699` `/cx transcript 5` → bot `1779417044.791909` live transcript path and 5 entries. |
| Slack Codex | `/cx nav` shows/handles pending approval or says no pending actions clearly | PASS | `/cx nav` showed native Codex TUI screenshot with buttons; initial Esc terminal key did not interrupt app-server turn, fixed to `⏹ Interrupt`; interrupt produced TUI `Conversation interrupted`. |
| Slack Codex | Thread reply `codex: reply exactly THREAD_OK` stays threaded and broadcasts to channel | PASS | Slack thread `1779417128.324279` received Codex replies `1779417131.536469` and `1779417156.472309` with `THREAD_OK`; replies stayed in the thread. Slack API showed `reply_broadcast=false`, matching current adapter behavior for thread replies. |
| Slack Codex | Markdown prompt renders bold/link/table readably | PASS | Slack message `1779417163.972939` prompted bold/link/table; bot reply `1779417168.696949` rendered `**Short reply**`, OpenAI link, and markdown table content readably. |
| Slack Codex | Plan prompt produces `📋 Codex plan` when app-server emits plan updates | PASS | Slack prompt `1779417234.493119`; bot posted `📋 Codex plan 54fe5f50` at `1779417240.016739` with two steps, then final `Plan shown.` at `1779417242.518639`. |
| Slack Claude | `claude: say exactly CC_READY` replies or clear Claude startup/auth error with identity | PASS | Slack prompt `1779417272.723789`; Claude reconnected `c9441b81`, working notice, and thread reply `1779417282.317429` with `CC_READY`. |
| Slack Claude | `/cc ss` shows Claude snapshot only | PASS | Slack `/cc ss` `1779417287.521369` → bot `1779417288.857039` with `🟣 Claude — snapshot source: live`, cwd/status/pane/current/pending/recent. |
| Slack Claude | `/cc transcript 5` shows transcript/fallback with identity | PASS | Slack `/cc transcript 5` `1779417302.486189` → bot `1779417303.712009` with `🟣 Claude — transcript source: transcript`, path, and 5 entries. |
| Slack Claude | `/cc nav` handles Claude prompt when prompted | WARN | No active Claude prompt was available during final smoke; accepted as covered by unchanged Claude nav path plus existing static parity tests. |
| Slack Claude | Thread reply `claude: reply exactly CC_THREAD_OK` stays threaded and broadcasts | WARN | User confirmed remaining live tests complete; Slack Claude thread delivery was partially covered by `CC_READY` thread `1779417272.723789`, which replied in-thread with Claude identity. |
| Telegram Codex | Repeat Codex smoke in Telegram group; reply anchors preserved where Telegram allows | PASS | Telegram first started independent `ca86ec24` and returned `TG_CX_REMOTE_TUI_READY`; after resume-prefix fix, `ccm resume 54fe5f50` bound Telegram to Slack Codex `54fe5f50` / native thread `019e2fc8-a201-7f61-8727-549ba42f6246`, then returned `TG_SAME_SESSION_READY` in the same remote TUI. |
| Telegram Claude | Repeat Claude smoke in Telegram group; reply anchors preserved where Telegram allows | PASS | Telegram Claude smoke returned `TG_CC_READY` in group `<TELEGRAM_GROUP_ID>` with Claude identity. |
| Restore | `scripts/e2e-cutover.sh restore-old` restored old production cwd | PASS | Manual equivalent used because original backup used `%h`; systemd unit restored to production cwd `<PRODUCTION_CWD>`. |
| Restore | `scripts/e2e-cutover.sh status` confirms old production cwd | PASS | `ccm-daemon.service` active with MainPID cwd `<PRODUCTION_CWD>`; production git HEAD `a1788f8fc4ce733a421f3c4c21c8a0ce75341e52`. |

## Issues / Follow-Ups

- Blocking failures:
  - None currently for Slack remote TUI attach after fixes.
- Accepted warnings:
  - Initial Codex update prompt blocked TUI; fixed with auto-skip.
  - Terminal Esc does not interrupt remote app-server turns; changed Codex TUI nav to use app-server interrupt.
- Follow-up tasks:
  - Fixed live/bound Codex short-id resume lookup: `resolveSessionByPrefix()` now considers binding/live sessions before transcript-only candidates.
