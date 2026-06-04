# CCM CC/CX Live E2E Result

Copy this file or fill it in during the live Slack/Telegram test window. Do not mark the `继续提高` goal complete unless every required row is `PASS` or explicitly accepted as `WARN` by the user.

## Run Metadata

- Date/time UTC:
- Tester:
- Candidate cwd: `<CANDIDATE_CWD>`
- Restored production cwd: `<PRODUCTION_CWD>`
- Slack channel: `<SLACK_CHANNEL_ID>`
- Telegram group: `<TELEGRAM_GROUP_ID>`
- Preflight command/output:
- Cutover command/output:
- Restore command/output:

## Required Checks

| Area | Check | Status | Evidence / message links / notes |
| --- | --- | --- | --- |
| Preflight | `bun run validate` passed before cutover | TODO | |
| Preflight | `bun run e2e:preflight` passed with allowlist | TODO | |
| Cutover | `scripts/e2e-cutover.sh start-candidate` landed in candidate cwd | TODO | |
| Slack Codex | `/cx help` shows `🟢 Codex` and does not spawn a session | TODO | |
| Slack Codex | `/cx model test-model-for-display` is room-scoped | TODO | |
| Slack Codex | `codex: say exactly CX_READY` replies or surfaces clear auth/model error with identity | TODO | |
| Slack Codex | `/cx ss` shows Codex snapshot and pending panel when applicable | TODO | |
| Slack Codex | `/cx transcript 5` shows recent entries or clear fallback | TODO | |
| Slack Codex | `/cx nav` shows/handles pending approval or says no pending actions clearly | TODO | |
| Slack Codex | Thread reply `codex: reply exactly THREAD_OK` stays threaded and broadcasts to channel | TODO | |
| Slack Codex | Markdown prompt renders bold/link/table readably | TODO | |
| Slack Codex | Plan prompt produces `📋 Codex plan` when app-server emits plan updates | TODO | |
| Slack Claude | `claude: say exactly CC_READY` replies or clear Claude startup/auth error with identity | TODO | |
| Slack Claude | `/cc ss` shows Claude snapshot only | TODO | |
| Slack Claude | `/cc transcript 5` shows transcript/fallback with identity | TODO | |
| Slack Claude | `/cc nav` handles Claude prompt when prompted | TODO | |
| Slack Claude | Thread reply `claude: reply exactly CC_THREAD_OK` stays threaded and broadcasts | TODO | |
| Telegram Codex | Repeat Codex smoke in Telegram group; reply anchors preserved where Telegram allows | TODO | |
| Telegram Claude | Repeat Claude smoke in Telegram group; reply anchors preserved where Telegram allows | TODO | |
| Restore | `scripts/e2e-cutover.sh restore-old` restored old production cwd | TODO | |
| Restore | `scripts/e2e-cutover.sh status` confirms old production cwd | TODO | |

## Issues / Follow-Ups

- Blocking failures:
- Accepted warnings:
- Follow-up tasks:
