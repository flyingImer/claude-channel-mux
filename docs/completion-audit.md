# CCM CC/CX Completion Audit

This document turns the open-ended `继续提高` goal into concrete deliverables and evidence. It is the handoff checklist before declaring the goal complete.

## Objective Restatement

Deliver a production-safe CCM candidate where Claude Code (`/cc`) and Codex (`/cx`) coexist in the same Slack/Telegram rooms with low cognitive load, visible agent identity, lightweight daemon state, scalable same-room peer handoffs, and parity with existing Claude use cases. Do not mark complete until local evidence and live Slack/Telegram E2E both pass.

## Prompt-to-Artifact Checklist

| Requirement | Evidence | Current Status |
| --- | --- | --- |
| Keep production usable unless a test window is explicitly granted | `systemctl --user` checks show `ccm-daemon.service` cwd at `<PRODUCTION_CWD>`; `docs/e2e-parity-plan.md` has a reversible cutover runbook | Locally verified; live cutover not active |
| Support both Claude and Codex as first-class agent slots | `agents/`, `agents/registry.ts`, `daemon.ts`, `server.ts`, `.claude-plugin/plugin.json`, `.codex-plugin/`; `test/parity-static.test.ts` checks metadata and runtime routing | Covered by static/type tests |
| Preserve original Claude use cases | `docs/legacy-parity-audit.md` maps every pre-Codex commit through `547033c`; `test/parity-static.test.ts` guards legacy coverage | Covered locally; needs live Claude smoke |
| Make `/cc` and `/cx` command UX shape consistent | README command tables, `commands.ts`, `daemon.ts` command handlers, Telegram command hints, `test/commands.test.ts`, `test/parity-static.test.ts` | Covered locally; needs live slash smoke |
| Keep Codex mental model close to Codex CLI without pretending TUI passthrough exists | `/cx help`, `/cx ss`, `/cx nav`, `/cx transcript`, `/cx model`, `/cx compact`, `/cx raw`; README notes unsupported commands fail closed | Covered locally; needs live Codex smoke |
| Provide visible identity in shared rooms | `agents/identity.ts`, `formatAgentReply`, `test/agent-identity.test.ts`, `test/slack-identity.test.ts`, `docs/e2e-parity-plan.md` | Covered locally; needs visual live confirmation |
| Preserve Slack thread broadcast and Telegram reply anchoring | `daemon.ts`, `adapters/slack.ts`, `adapters/telegram.ts`, `test/parity-static.test.ts`, `test/adapter-payload.test.ts`, `docs/e2e-parity-plan.md` | Covered locally; needs live platform confirmation |
| Preserve markdown forwarding/styling | `adapters/markdown.ts`, `test/markdown-rendering.test.ts`, `docs/e2e-parity-plan.md` | Covered locally; needs live render confirmation |
| Handle Codex approvals/input/nav like Claude nav where possible | `codex-response.ts`, Codex app-server driver/client, pending request state, `/cx ss` and `/cx nav` tests | Covered locally; needs live pending-action confirmation |
| Support Codex transcript fallback | `transcript.ts`, `daemon.ts`, `test/parity-static.test.ts`, README `/cx transcript` docs | Covered locally; needs live transcript smoke |
| Support Codex worktree/cwd UX aligned with Claude | `worktree.ts`, `daemon.ts`, `test/worktree.test.ts`, README spawn-mode docs | Covered locally; live worktree not yet exercised |
| Keep daemon state lightweight | README architecture, `state.ts` pending request persistence omits sensitive params, ask_peer audit only stores bounded metadata | Covered locally |
| Make same-room peer handoff controlled but async | `server.ts` `ask_peer`, `daemon.ts` rate/inflight/audit gates, `docs/ask-peer-load-test-plan.md`, `test/parity-static.test.ts` | Covered locally; peer load plan optional before completion unless user asks |
| Support safe E2E cutover using same Slack/Telegram tokens | `scripts/e2e-preflight.sh`, `scripts/e2e-cutover.sh`, `docs/e2e-parity-plan.md`, `test/e2e-preflight.test.ts`, `test/e2e-cutover.test.ts`, reversible cutover runbook with auto-restore and backup overwrite guard | Covered locally; needs user-granted window |
| Keep production old version after testing unless user requests otherwise | E2E runbook restore step and current systemd cwd check | Currently true |
| Type/test/diff quality gate | `bun run validate` | Passing locally |
| E2E readiness gate | `CHANNEL_DAEMON_ALLOWED_CHANNELS='slack:<SLACK_CHANNEL_ID>,telegram:<TELEGRAM_GROUP_ID>' bun run e2e:preflight` | Passing locally |
| Final live Slack/Telegram E2E | `docs/e2e-parity-plan.md` Slack, Claude, Telegram smoke sections; `docs/e2e-result-template.md`; `scripts/e2e-result.sh new/check`; `test/e2e-result.test.ts` | Missing; required before 100% |

## Completion Decision

Current state is not complete because live Slack/Telegram E2E has not been executed against the candidate. The remaining gate is intentionally manual/live: it verifies platform rendering, slash delivery, buttons, thread broadcast, Telegram reply anchoring, and real agent startup behavior that local tests cannot fully prove. During that window, create a result file with `scripts/e2e-result.sh new <run-name>`, fill every required row, and pass `scripts/e2e-result.sh check <result-file>` before marking complete.
