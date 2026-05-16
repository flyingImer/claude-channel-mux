# CCM CC/CX Live E2E Result

Copy this file or fill it in during the live Slack/Telegram test window. Do not mark the `继续提高` goal complete unless every required row is `PASS` or explicitly accepted as `WARN` by the user.

## Run Metadata

- Date/time UTC: 2026-05-16T05:26:15.127600+00:00
- Tester: EJ / Codex
- Candidate cwd: `/home/repo/ejwang/.claude/plugins/marketplaces/claude-channel-mux__wt__0514-0730-bright-spark`
- Restored production cwd: `/home/repo/ejwang/.claude/plugins/marketplaces/claude-channel-mux`
- Slack channel: `C0B3V2ZSLER`
- Telegram group: `-1003714310865`
- Preflight command/output: PASS — `bun run validate` passed with 346 tests; `bun run e2e:preflight` passed for slack:C0B3V2ZSLER,telegram:-1003714310865.
- Cutover command/output: PASS — `scripts/e2e-cutover.sh start-candidate` landed in candidate cwd; later restarted candidate after importing OPENAI_API_KEY into systemd user env.
- Restore command/output: PASS — `scripts/e2e-cutover.sh restore-old` restored `WorkingDirectory=/home/yijwang/.claude/plugins/marketplaces/claude-channel-mux`; `scripts/e2e-cutover.sh status` confirmed pid 420277 running old cwd.

## Required Checks

| Area | Check | Status | Evidence / message links / notes |
| --- | --- | --- | --- |
| Preflight | `bun run validate` passed before cutover | PASS | 346 pass / 0 fail before cutover. |
| Preflight | `bun run e2e:preflight` passed with allowlist | PASS | allowlist slack:C0B3V2ZSLER,telegram:-1003714310865. |
| Cutover | `scripts/e2e-cutover.sh start-candidate` landed in candidate cwd | PASS | Candidate cwd `/home/repo/ejwang/.claude/plugins/marketplaces/claude-channel-mux__wt__0514-0730-bright-spark`; pid 284167 then 291415 after env restart. |
| Slack Codex | `/cx help` shows `🟢 Codex` and does not spawn a session | PASS | Slack 10:29 PM: help listed Codex commands with `🟢 Codex` identity. |
| Slack Codex | `/cx model test-model-for-display` is room-scoped | PASS | Slack 10:33 PM set room-scoped override and confirmed global Codex config was not changed; user input included trailing colon, stored literally as typed. |
| Slack Codex | `codex: say exactly CX_READY` replies or surfaces clear auth/model error with identity | PASS | Initial WARN for missing `OPENAI_API_KEY` was fixed by importing env and restarting candidate; retry at 10:30 PM replied in thread with `🟢 Codex` and `CX_READY`. |
| Slack Codex | `/cx ss` shows Codex snapshot and pending panel when applicable | PASS | Slack 10:33 PM showed live Codex snapshot, cwd, model, thread, idle status, Current/Recent panels, and Pending none. |
| Slack Codex | `/cx transcript 5` shows recent entries or clear fallback | PASS | Slack 10:33 PM showed live transcript path and 2 entries including `CX_READY`. |
| Slack Codex | `/cx nav` shows/handles pending approval or says no pending actions clearly | PASS | Slack 10:33 PM returned `No pending actions.` with `🟢 Codex` identity. |
| Slack Codex | Thread reply `codex: reply exactly THREAD_OK` stays threaded and broadcasts to channel | PASS | Slack 10:46/10:47 PM: `THREAD_OK` reply posted by Codex with `🟢 Codex` identity in the originating Slack thread; verified via Slack history and Codex transcript `019e2f52...`. |
| Slack Codex | Markdown prompt renders bold/link/table readably | PASS | Slack 11:05 PM: Codex replied in thread with `🟢 Codex`, preserved bold/link/table text readably; renderer forwarded markdown without losing identity. |
| Slack Codex | Plan prompt produces `📋 Codex plan` when app-server emits plan updates | PASS | Slack 11:05 PM: Codex plan notice appeared in channel with `🟢 Codex`, `📋 Codex plan`/clipboard styling, two steps, then thread reply `PLAN_DONE`. |
| Slack Claude | `claude: say exactly CC_READY` replies or clear Claude startup/auth error with identity | PASS | Slack 10:38 PM: Claude joined room, dev-channel nav surfaced with `🟣 Claude`, auto navigation proceeded, session `10fe01b4` reconnected, and thread reply returned `CC_READY`. |
| Slack Claude | `/cc ss` shows Claude snapshot only | PASS | Slack 10:38 PM after Claude start: live snapshot showed cwd, running pane 1, Pending none, and Recent `claude: CC_READY`; no Codex state mixed in. Earlier pre-start `/cc ss` correctly warned not started. |
| Slack Claude | `/cc transcript 5` shows transcript/fallback with identity | PASS | Slack 11:04 PM: `/cc transcript 5` returned `🟣 Claude — transcript`, source `transcript`, JSONL path, and recent entries `CC_READY` / `Done.` with Claude identity. |
| Slack Claude | `/cc nav` handles Claude prompt when prompted | PASS | Slack 10:39 PM: `/cc nav` showed live Claude screen with `CC_READY`, prompt footer, and `🟣 Claude` identity. Dev-channel prompt had also surfaced as `Claude nav 10fe01b4` during startup. |
| Slack Claude | Thread reply `claude: reply exactly CC_THREAD_OK` stays threaded and broadcasts | PASS | Slack 11:02 PM: retry after transcript-cwd fix reconnected Claude `10fe01b4` and replied in the originating thread with `🟣 Claude` `CC_THREAD_OK`; transcript poll also emitted `💡 Done.` in the same thread. |
| Telegram Codex | Repeat Codex smoke in Telegram group; reply anchors preserved where Telegram allows | PASS | Telegram group `-1003714310865`: after `ccm <candidate cwd>` binding, Codex session `35c98deb` started and sent `TG_CX_OK` as `🟢 Codex` message `/1823`; transcript confirms message `1819` and final `TG_CX_OK`. |
| Telegram Claude | Repeat Claude smoke in Telegram group; reply anchors preserved where Telegram allows | PASS | Telegram group `-1003714310865`: stale Claude `185dabf3` surfaced visible unresumable error, was unbound, then new Claude `9ac29e2c` lazy-started and sent `TG_CC_OK` as `🟣 Claude` message `/1833`. |
| Restore | `scripts/e2e-cutover.sh restore-old` restored old production cwd | PASS | `restore-old` printed restored production service; follow-up status showed `cwd: /home/repo/ejwang/.claude/plugins/marketplaces/claude-channel-mux` and `WorkingDirectory=/home/yijwang/.claude/plugins/marketplaces/claude-channel-mux`. |
| Restore | `scripts/e2e-cutover.sh status` confirms old production cwd | PASS | status after restore: service active, pid `420277`, `cwd: /home/repo/ejwang/.claude/plugins/marketplaces/claude-channel-mux`, `WorkingDirectory=/home/yijwang/.claude/plugins/marketplaces/claude-channel-mux`. |

## Issues / Follow-Ups

- Blocking failures: Initial Codex real turn blocked by missing OPENAI_API_KEY in systemd service env; fixed by `systemctl --user import-environment OPENAI_API_KEY` and candidate restart.
- Blocking failures: Claude startup exposed zellij recovery bug: colored `zellij list-sessions` output hid exited `ccmux`, causing fallback to non-TTY Claude and `--print` exit. Fixed by parsing `list-sessions --no-formatting`, stripping ANSI defensively, and failing closed instead of direct non-TTY fallback.
- Accepted warnings: `/cc ss` before Claude start correctly returned `Claude is not started in this room` with `🟣 Claude`; will retry after starting Claude.
- Follow-up tasks:
