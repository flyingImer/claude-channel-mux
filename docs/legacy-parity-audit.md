# Legacy parity audit

This checklist maps the pre-Codex CCM commits to the current multi-agent implementation so regressions are easier to spot during cutover. It is intentionally implementation-facing: each row names the legacy intent, the current artifact/evidence, and current status.

| Legacy commit | Intent | Current evidence | Status |
| --- | --- | --- | --- |
| `e345377` initial release | Slack/Telegram adapters, session routing, zellij tabs, pickers, files, permissions, worktrees | `adapters/slack.ts`, `adapters/telegram.ts`, `daemon.ts`, `server.ts`; `test/parity-static.test.ts` covers adapters, directory runtime preservation, permission/Codex pending coverage, worktree support | Covered |
| `6d88ada` marketplace install | Add `.claude-plugin/marketplace.json` so the plugin can be installed through Claude Code marketplace flow | `.claude-plugin/marketplace.json`; README install docs use `marketplace add` + `plugin install` | Covered |
| `f644aef` marketplace source format | Keep marketplace source shape compatible with Claude Code plugin install | `.claude-plugin/marketplace.json`; README documents GitHub and local marketplace install forms | Covered |
| `388db81` installed-plugin channel tag | Use the marketplace-qualified channel tag when spawned Claude sessions load the installed plugin | `daemon.ts` builds `plugin:claude-channel-mux@${MARKETPLACE}` unless `CLAUDE_CHANNEL_MUX_PLUGIN_DIR` is set; README documents `CLAUDE_CHANNEL_MUX_MARKETPLACE` | Covered |
| `8db20f9` live screen streaming | Stream Claude screens, detect dialogs, and expose manual nav controls | `startScreenWatch`, `sendDialogButtons`, and `sendClaudeNav`; static coverage for `/cc ss` and `/cc nav`; false-positive/task-list coverage for dialog classification | Covered |
| `a513ea7` auto-recovered screen watcher | Auto-recovered sessions should resume screen watching | `daemon.ts` auto-recover/register path and `startScreenWatch`; static coverage for nav/screen routing | Covered |
| `5b33648` dev-channel loading | Use `--dangerously-load-development-channels` for daemon-spawned Claude plugin sessions | `spawnClaude` always passes `--dangerously-load-development-channels` with the CCM channel tag; README explains why | Covered |
| `d316d34` dialog hint variants | Detect `Esc to exit`, `Enter to confirm`, and `Enter to select`-style prompts, not only one wording | `PROMPT_HINT_RE` covers `Esc`, `Enter`, `Tab`, `Space`, `Ctrl+...`, and arrow hints; `MAYBE_PROMPT_HINT_RE` logs unknown prompt shapes | Covered |
| `badc391` transcript polling | Forward mid-turn/end-turn transcript text, dedupe reply-tool duplicates, preserve thread consistency | `daemon.ts` transcript poll loop, `recentReplies`, delivery ledger, thread anchors; ask_peer tests verify poll fallback and visible delivery | Covered |
| `eac96bf` README install commands | Keep plugin install commands accurate | README setup uses current `claude plugin marketplace add` and `claude plugin install claude-channel-mux@claude-channel-mux` flow | Covered |
| `e4cc90f` screen-scraping hardening | Avoid brittle dialog detection and unsafe screen handling during interactive prompts | A pure dialog classifier filters non-dialog task/subagent list footers; `MAYBE_PROMPT_HINT_RE`, throttled `startScreenWatch`, bounded nav text, and edit-failure no-replacement behavior guard against nav spam | Covered |
| `fb942bd` CC-authoritative threading | Do not override semantic `reply_to` with daemon latest-inbound heuristic | `server.ts` reply tool keeps explicit `reply_to`; `daemon.ts` forwards `replyTo`; `test/parity-static.test.ts` covers explicit reply delivery, safe fallback, and Slack thread broadcast parity | Covered |
| `1ed95fe` reply_to instructions | Strong MCP instruction contract for copying reply anchors | `server.ts` channel tool instructions and `daemon.ts` anchor checks | Covered |
| `197b39f` unknown reply_to safety net | Drop unknown thread anchors and fall back visibly to main channel | `daemon.ts` `rememberThreadAnchor` / fallback logging; `test/parity-static.test.ts` guards unknown-anchor fallback and main-channel retry evidence | Covered |
| `51740a5` reactions | Hard-gate reaction instructions, Telegram add-semantics, Slack error logging | `server.ts` react tool, `adapters/telegram.ts` reaction cache/fallbacks, `adapters/slack.ts` reaction logging; `test/parity-static.test.ts` covers Telegram reaction normalization | Covered |
| `09595fc` concise MCP instructions | Keep channel/MCP instructions concise enough not to swamp agent context | `server.ts` instructions are scoped to routing, identity, thread safety, attachments, reactions, and ask_peer without embedding full daemon history | Covered |
| `6705697` platform markdown | Convert GFM to Slack mrkdwn and Telegram MarkdownV2, split long messages | `adapters/markdown.ts`, `adapters/slack.ts`, `adapters/telegram.ts`, package deps; `test/markdown-rendering.test.ts` covers Slack/Telegram styling and split fences | Covered |
| `8110083` stop/resume re-announces | Clear per-session announcement/runtime state on kill | `daemon.ts` `killSession` and runtime cleanup | Covered |
| `64f3947` Esc nav | Navigation buttons must include Esc | `sendDialogButtons` and `sendClaudeNav` include `✕ Esc` | Covered |
| `88d3b83` idle false-dialog fix | Do not treat idle Claude screens as interactive dialogs | `isClaudeDialogScreen` requires actionable key hints and explicitly rejects Claude task/subagent list footers; non-dialog screen changes are not forwarded as dialog controls | Covered |
| `1e64111` poll reply_to from channel tag | Poll path derives reply target from user entry channel metadata | `daemon.ts` poll delivery uses transcript-derived reply/thread metadata; README threading docs mention poll path | Covered |
| `857d06f` Slack markdown tables/outer fence | GFM tables become aligned code blocks; outer fenced markdown unwraps only for generated markdown documents | `adapters/markdown.ts`; `test/markdown-rendering.test.ts` covers tables, explicit markdown unwrap, preserving whole-message code fences, and no double-wrapping fenced tables | Covered |
| `aa3bdda` resume no transcript fallback | Resume without transcript starts fresh instead of loop-failing | `daemon.ts` resume cwd/transcript fallback paths; current Codex/Claude resume robustness preserved | Covered |
| `ea7aa34` poll-path emojis | Use `💭` for mid-turn transcript forwarding and `💡` for end-turn delivery | `daemon.ts` poll delivery uses `const prefix = isEndOfTurn ? '💡' : '💭'` | Covered |
| `ac3c943` Slack typing indicator | Show Slack typing/status while processing | `adapters/slack.ts` `showTyping`; `daemon.ts` starts typing per active anchor | Covered |
| `a04dc51` bot messages and JSON manifest | Allow non-self bot messages and keep Slack manifest JSON-compatible | `adapters/slack.ts` filters by own bot id; `slack-app-manifest.json` remains JSON | Covered |
| `5fd5899` assistant view experiment | Track the assistant-view requirement tried for Slack assistant status | Final manifest path intentionally does not depend on obsolete assistant_view assumptions; typing is implemented through adapter status methods | Covered |
| `9df4b67` assistant thread event experiment | Track assistant_thread_started event handling tried for Slack assistant view | Final desired state avoids assistant view complexity; `adapters/slack.ts` handles current event/message paths and typing cleanup | Covered |
| `1c10885` revert assistant view | Drop assistant_view-only manifest assumptions | Current Slack manifest and adapter path keep the simpler bot/socket-mode flow plus assistant write status where available | Covered |
| `ea23e21` assistant write typing | Add assistant write status support for typing indicator | `adapters/slack.ts` `showTyping`/`clearTyping`; `daemon.ts` clears status on final/error/idle/stopped | Covered |
| `88df602` own-bot filtering | Filter only the CCM bot, not all bot messages | `adapters/slack.ts` own bot id filtering | Covered |
| `293865c` stale tabs | Kill stale CC tabs on spawn instead of reusing dead IPC | `daemon.ts` stale tab cleanup/spawn path | Covered |
| `8806672` slash command nav | Slash commands that open dialogs must surface nav buttons immediately | `daemon.ts` slash handling waits for screen change and `sendDialogButtons`; `/cx nav` has app-server pending panel equivalent | Covered |
| `4917f9c` horizontal nav | Include left/right nav and detect horizontal selectors | `sendDialogButtons` and `sendClaudeNav` include ←/→; `PROMPT_HINT_RE` covers arrows | Covered |
| `441ab0d` session UX robustness | Compaction visibility, thread context fetch, forwarded env, settings hooks | `hooks/pre-compact.ts`, `daemon.ts` compact_starting, `adapter.fetchThread`, forwarded env handling | Covered |
| `25386c3` stale zellij recovery | Recover stale zellij sessions during resume | `daemon.ts` resume/register path and stale live-session cleanup | Covered |
| `db0424e` transcript end-turn hardening | Make transcript delivery reliable across edit/fallback/thread paths | `flushTranscriptDelivery`, delivery ledger, safe fallback to main channel, and `test/parity-static.test.ts` coverage | Covered |
| `ceb4eb5` compaction notify | Notify channels when compaction starts/completes | `daemon.ts` pre-compact hook and transcript completion detection; Codex compaction events; `test/parity-static.test.ts` guards before/after lifecycle messages | Covered |
| `547033c` task snapshots | Forward task/plan snapshots to channels | Claude task snapshots remain; Codex `turn/plan/updated` maps to editable `📋 Codex plan`; `test/parity-static.test.ts` and `test/codex-driver-fixtures.test.ts` cover plan forwarding | Covered |

## Markdown-specific audit

Current forwarding coverage is implemented in `adapters/markdown.ts` and used by both adapter send/edit paths:

- Slack send/edit: `renderForSlack`, `splitForLimit`, `mrkdwn` blocks.
- Telegram send/edit: `renderForTelegram`, `splitForLimit`, `parse_mode: MarkdownV2`.
- Dependencies: `slackify-markdown` and `telegramify-markdown` remain in `package.json`.

This pass found and fixed two edge cases that were not protected by the old tests:

- Whole-message fenced code blocks such as ```` ```ts ... ``` ```` must remain code blocks. Only explicit `markdown`/`md` outer fences are unwrapped as generated markdown documents.
- GFM-looking tables inside existing code fences must not be converted or double-wrapped by the table alignment pass.

`test/markdown-rendering.test.ts` now locks the key behavior from `6705697` and `857d06f`: Slack bold/link conversion, Telegram MarkdownV2 styling, GFM table code-block alignment, pipe prose not being table-fenced, explicit markdown outer-fence unwrap, whole-message code-fence preservation, fenced-table no-double-wrap behavior, ASCII-art auto-fencing, code-fence-safe splitting, and adapter send/edit paths continuing to call the platform renderers. `test/adapter-payload.test.ts` verifies Slack/Telegram payloads preserve rendered styling plus reply/broadcast metadata. `test/parity-static.test.ts` also guards non-markdown legacy UX that was easy to regress during CC/CX refactors: visible agent identity across replies/status/agent command acknowledgements, explicit reply/thread broadcast, typing cleanup, Codex pending acknowledgement identity, and compaction lifecycle notifications.

## Known follow-ups

No unimplemented legacy markdown/forward-styling feature remains after this pass. Remaining risk is E2E/platform-rendering variance: Slack/Telegram may render slightly differently than converter string output, so keep the Slack/Telegram smoke plan for final cutover.
