# claude-channel-mux

Multi-channel, multi-agent session multiplexer for [Claude Code](https://claude.ai/code) and Codex. One lightweight daemon routes Slack + Telegram conversations to CCM rooms; each room owns a cwd, a default agent, and lazily-created agent sessions.

Talk to Claude Code or Codex from your phone. Let multiple agents coexist in one Slack/Telegram thread, with visible agent identity headers and on-demand context fetching instead of daemon-side conversation memory.

## Architecture

```
Slack / Telegram
      │
      ▼
ChannelAdapter (platform send/receive, files, reactions, buttons)
      │
      ▼
daemon.ts
  - lightweight room router: cwd, default agent, lazy slots
  - no daemon conversation memory or unread peer inbox
  - visible identity headers for shared transcript UX
      │
      ▼
AgentRegistry / AgentDriver SPI
      ├─ ClaudeChannelAgentDriver
      │    wraps the existing Claude Code channel/MCP notification bridge
      │    because Claude Code has no Codex-style app-server inbound API
      └─ CodexAppServerAgentDriver
           owns `codex app-server --listen stdio://`, sends `turn/start`,
           receives app-server events, and injects the CCM MCP server
```

### Key components

| File | Role |
|------|------|
| `daemon.ts` | Core orchestrator: room commands, bindings, lazy session lifecycle, Agent SPI routing |
| `agents/types.ts` | Shared Agent SPI types: sessions, turns, capabilities, events |
| `agents/registry.ts` | Runtime registry for current and future agent drivers |
| `agents/claude/channel-driver.ts` | Claude driver that encapsulates current channel notification transport |
| `agents/codex/app-server-driver.ts` | Codex driver that uses Codex App Server for inbound/session/events |
| `agents/codex/app-server-client.ts` | Minimal stdio JSON client for `codex app-server` |
| `server.ts` | Per-agent MCP bridge and tools: reply, react, edit, attachment, fetch_thread |
| `adapters/types.ts` | `ChannelAdapter` interface |
| `adapters/slack.ts` | Slack Socket Mode + Web API + slash commands + modal search |
| `adapters/telegram.ts` | Telegram Bot API long poll + force_reply search + bot commands |
| `escort.ts` / `zellij-plugin/` | Claude UI support: zellij helpers and optional pane watcher |

Claude and Codex intentionally share the same high-level SPI, not the same low-level transport. Codex can be cleanly app-server driven. Claude is encapsulated behind `ClaudeChannelAgentDriver`, but internally still needs channel notification support from `server.ts`; a plugin/MCP tool alone is not enough to deliver inbound user turns to Claude Code.

## Features

- **Multi-room, multi-agent** - Each Slack/Telegram room can host Claude and Codex side by side
- **Lazy agent slots** - `ccm /repo` binds the room; `claude:` or `codex:` starts that agent only when cued
- **Inline keyboard navigation** - Claude Code startup dialogs rendered as chat buttons
- **Directory picker** - Browse, search, and jump to directories from chat
- **Session picker** - Two-level menu (project folders, then sessions) with title extraction
- **Image/file support** - Bidirectional: send images to agents, agents send files back
- **Permission forwarding** - Claude Code permission prompts appear as Allow/Deny buttons in chat; undeliverable prompts fail closed as Deny
- **Git worktree isolation** - Optional per-session worktree branches
- **Shared transcript UX** - Agent replies are prepended with identity headers (`🟣 Claude`, `🟢 Codex`) so users and peer agents can see who said what
- **Slash commands** - Native `/ccm`, `/cc`, and `/cx` commands (Slack + Telegram)
- **Fault tolerant** - IPC auto-reconnect, daemon restart recovery, stale tab cleanup

## Commands

Type in any connected Slack channel or Telegram chat (plain text or `/ccm` slash command):

| Command | Action |
|---------|--------|
| `ccm` | Directory picker for the room |
| `ccm /path/to/dir` | Bind this room to a cwd; does not start agents |
| `claude: ...` / `@claude ...` | Send a turn to Claude, lazy-starting its slot if needed |
| `codex: ...` / `@codex ...` | Send a turn to Codex, lazy-starting its slot if needed |
| `ccm default claude|codex` | Set the plain-message default agent |
| `@agents ...` / `agents: ...` | Fan out one turn to all agent slots, without recursive auto-rounds |
| `ccm agents` | Show room cwd, default agent, and agent slot status |
| `ccm route` | Explain how the next plain message routes |
| `ccm new [agent]` / `ccm start [agent]` | Start a fresh agent slot session in this room |
| `ccm resume [agent\|id]` | Interactive session picker, or resume a specific session into this room |
| `ccm stop [agent\|id]` | Stop one agent slot session; if other rooms reference it, unbind those rooms first |
| `ccm find <query>` | Fuzzy search directories |
| `ccm help` | Status + commands + action buttons |

Claude Code terminal commands (forwarded only to the Claude slot):

| Command | Action |
|---------|--------|
| `/cc ss` | Show Claude snapshot using the shared screen-like renderer |
| `/cc transcript [N]` | Show recent Claude transcript from jsonl |
| `/cc status` | Show room/Claude status |
| `/cc nav` | Show and operate pending Claude TUI prompts |
| `/cc compact` | Forward to Claude Code native `/compact` |
| `/cc model` | Forward to Claude Code native `/model` |
| `/cc cancel` / `/cc stop` | Forward Claude Code interruption command |

Codex command proxy (forwarded only to the Codex slot):

| Command | Action |
|---------|--------|
| `/cx ss` | Show a Codex TUI-like snapshot projected from app-server/thread state; pending Codex requests include action buttons and target request id |
| `/cx nav [N] [allow\|session\|policy\|network\|deny\|abort\|answer <text>]` | Show or resolve pending Codex approvals/input actions scoped to the current Codex slot; stale requests expose a safe `Clear stale request` button |
| `/cx transcript [N]` | Show recent Codex transcript from app-server, with jsonl fallback |
| `/cx status` | Show loaded Codex thread/config status |
| `/cx compact` | Start Codex app-server compaction |
| `/cx stop` / `/cx cancel` | Interrupt the latest Codex turn |
| `/cx mcp` | List Codex MCP servers reported by app-server |
| `/cx model [name]` | Show or set this room’s Codex model override; applies on next Codex start/resume and does not edit global Codex config |
| `/cx goal <new goal>` | Replace the current CCM Codex goal by interrupting any active Codex turn and starting a new replacement-goal turn; this is a CCM-level compatibility command, not a native app-server goal API |
| `/cx raw /command ...` | Explicit experimental raw slash-shaped turn; unsupported `/cx <other>` commands show help instead of silently running |

Codex pending request UX:

- `/cx ss` and `/cx nav` share the same pending-action panel so snapshot and navigation do not disagree.
- The panel names the target request id/method and says when more pending requests exist; `/cx nav N ...` addresses the same slot-scoped, created-time order.
- Live requests can be answered with buttons, `/cx nav N allow|session|policy|network|deny|abort`, or `/cx nav N answer <text>`. Approval buttons mirror Codex `availableDecisions`: when Codex exposes policy/network amendment choices, CCM shows explicit `Allow Policy` / `Allow Network` buttons instead of inventing hidden defaults.
- Stale requests after daemon/runtime restart cannot be answered safely; use the `Clear stale request` button, then resume or cue Codex again.
- If all channel deliveries fail, CCM logs the failure and rejects the live Codex request so the agent does not wait on an invisible prompt.

## Prerequisites

| Dependency | Required | Notes |
|------------|----------|-------|
| [Bun](https://bun.sh) >= 1.0 | Yes | Runtime |
| [Claude Code](https://claude.ai/code) >= 2.1 | Default runtime | `claude` in PATH |
| [Codex CLI](https://github.com/openai/codex) >= 0.130 | Optional | Codex slots use `codex app-server` over stdio; no TUI paste path |
| [zellij](https://zellij.dev) >= 0.40 | Recommended | Sessions as tabs with screen watching. Falls back to background processes. |
| Rust toolchain | No | Only if rebuilding the WASM pane watcher plugin |


## Development

Run the local static/test gate before a live Slack/Telegram cutover:

```bash
bun run validate
```

`bun run validate` runs the Bun test suite, project-level TypeScript coverage via `tsconfig.json`, `validate:orchestration`, and `git diff --check`. Live platform behavior still needs the E2E smoke in `docs/e2e-parity-plan.md`.

## Setup

### 1. Install the plugin

This repo is a Claude Code plugin marketplace with one plugin in it
(`.claude-plugin/marketplace.json` + `.claude-plugin/plugin.json`). Install
with the two-step `marketplace add` + `plugin install` flow. Anthropic's
official channels don't accept third-party submissions, so GitHub is the
distribution path.

From GitHub (recommended):

```bash
claude plugin marketplace add flyingImer/claude-channel-mux
claude plugin install claude-channel-mux@claude-channel-mux
```

From a local clone (development):

```bash
git clone https://github.com/flyingImer/claude-channel-mux.git ~/src/ccm
claude plugin marketplace add ~/src/ccm
claude plugin install claude-channel-mux@claude-channel-mux
```

`plugin install claude-channel-mux@claude-channel-mux` is
`<plugin-name>@<marketplace-name>`. Both happen to be the same string here
(the marketplace holds one plugin).

Installing the plugin registers the per-session MCP bridge (`server.ts`) and
adds `/claude-channel-mux:access`, `/claude-channel-mux:configure`, and the
CCM orchestration role skills under `skills/`.
The daemon (`daemon.ts`) is a separate long-running process you start in
step 4 below.

### Bundled skills

The plugin ships skills for both setup work and Agent Control Path operation:

| Skill | Use |
|-------|-----|
| `access` | Manage DM/channel allowlists and pairing approvals |
| `configure` | Configure Slack tokens and basic plugin setup |
| `operate-orchestrator-room` | Human/operator setup, status, smoke tests, and troubleshooting |
| `bootstrap-git-orchestration` | Seed or adopt durable `docs/orchestration/<initiative-id>/` state |
| `guide-orchestration` | Define stage contracts, acceptance bars, audits, and human decision points |
| `export-gp-packet` | Package ChatGPT/Guiding Principal advisory context for later import |
| `import-gp-packet` | Persist and reconcile GP packets against durable Git context |
| `orchestrate-workers` | Coordinate visible CCM worker rooms from a flagged orchestrator room |
| `manage-worker-protocol` | Start, brief, monitor, prompt, stop, and interpret worker rooms |
| `work-in-worker-room` | Execute a bounded worker task and report back to the orchestrator |
| `process-orchestration-inbox` | Process inbox, recall, decisions, conflicts, and handoffs |
| `audit-worker-output` | Run independent audit workers over reports, diffs, claims, or evidence |
| `integrate-worker-output` | Capture, merge, validate, abandon, cleanup, and archive worker output |
| `recover-orchestration` | Reconstruct and repair orchestration after restarts or partial failures |

The orchestration skills are intentionally role-specific. The Orchestrator owns
worker assignment, validation, integration, and archive timing; Worker Agents
execute only their stage contract; the Guiding Principal sets quality bars and
human decision boundaries; the human/operator manages room flags and platform
readiness.

For cross-runtime orchestration, the repo also ships portable harness artifacts:

| Path | Purpose |
|------|---------|
| `docs/orchestration/AGENTS.md` | Role boundaries and source-of-truth rules for initiative directories |
| `docs/orchestration/_templates/` | Canonical intake, stage, state, worker, recall, Guiding Principal, audit, and recovery templates |
| `prompts/ccm/` | Runtime-neutral Orchestrator, Worker, Guiding Principal, Auditor, and Recovery prompts for Claude Code or Codex |
| `docs/checklists/` | Short bootstrap, preflight, dispatch, Guiding Principal recall, integration, and recovery gates |
| `docs/contracts/agent-control-path-v1.md` | Portable Agent Control Path lifecycle contract and invariants |

Create a new Git-backed orchestration structure with `bun run orchestration:new -- <initiative-id> --from <actor> --source-ref <ref> --coordination-branch <branch>`.
Pass `--root <repo>/docs/orchestration` when bootstrapping another repo; the command copies the portable root instructions, state machine, and templates before creating the initiative.
Adopt or repair an existing partial initiative with `bun run orchestration:adopt -- <initiative-id> [--repair]`.
Capture pasted human, ChatGPT, or Guiding Principal context with `bun run orchestration:inbox -- <initiative-id> --kind intake|inbox --from <actor> --source-ref <ref>` so attribution and unread inbox semantics are durable.
For ChatGPT-as-Guiding-Principal handoff, use `export-gp-packet` to produce a standardized advisory packet, then use `import-gp-packet` from the Orchestrator side to persist the raw packet, reconcile it with `intake.md`, `stage.md`, `state.md`, `decisions/`, unread inbox, and repo evidence, and write a conflict artifact instead of silently choosing between GP advice and durable Git state.
Validate scaffold shape with `bun run validate:orchestration -- --root <repo>/docs/orchestration`; add `--ready` when checking that an initiative has no unresolved template placeholders before live dispatch.

The lean path is intentional: start from durable intake, stage, worker state, orchestration state, and repo policy; add inbox, recall, audit, and recovery artifacts only when new context, uncertainty, risk, or failure makes them necessary.

### 2. Configure tokens

```bash
mkdir -p ~/.config/claude-channel-mux
cp .env.example ~/.config/claude-channel-mux/.env
# Edit with your tokens
chmod 600 ~/.config/claude-channel-mux/.env
```

Configure at least one platform (Slack, Telegram, or both).

### 3. Platform setup

**Slack:**
1. Go to https://api.slack.com/apps -> Create New App -> From manifest
2. Paste the contents of `slack-app-manifest.json`
3. Install to your workspace and copy the Bot User OAuth Token (`xoxb-...`) into `SLACK_BOT_TOKEN`
4. In Basic Information -> App-Level Tokens, generate an app-level token with `connections:write` scope and copy it into `SLACK_APP_TOKEN`
5. Invite the bot user to each channel that should talk to CCM (`/invite @CCM Mux`, or your manifest's bot display name)

The manifest enables Socket Mode, interactivity, `/ccm`, `/cc`, `/cx`, message events, file access, reactions, and Slack assistant status updates. Because CCM uses Socket Mode, no public request URL is required. If you update an existing Slack app, replace its App Manifest with `slack-app-manifest.json`, save it, reinstall the app to the workspace so new scopes and slash commands apply, then restart the daemon.

**Telegram:**
1. Message [@BotFather](https://t.me/BotFather) -> `/newbot`
2. Copy the bot token

### 4. Start the daemon

```bash
cd /path/to/claude-channel-mux
bun install
bun daemon.ts
```

For background operation:
```bash
nohup bun daemon.ts > /tmp/ccm.log 2>&1 &
```

For auto-restart with systemd (Linux), copy the template, replace `/path/to/claude-channel-mux` with this checkout path, then enable the copied unit name:
```bash
mkdir -p ~/.config/systemd/user
cp ccm.service ~/.config/systemd/user/ccm.service
$EDITOR ~/.config/systemd/user/ccm.service
systemctl --user daemon-reload
systemctl --user enable --now ccm.service
```

For auto-restart with launchd (macOS), copy the template and replace `/path/to/claude-channel-mux` plus `/Users/YOU` before loading it:
```bash
mkdir -p ~/Library/LaunchAgents
cp ccm.plist ~/Library/LaunchAgents/com.claude.ccm.plist
$EDITOR ~/Library/LaunchAgents/com.claude.ccm.plist
launchctl load ~/Library/LaunchAgents/com.claude.ccm.plist
```

### 5. Use it

Send `ccm` in any connected Slack channel or Telegram chat and pick a directory, or send `ccm /path/to/repo`. This creates a lightweight CCM room only. Send `claude: ...`, `codex: ...`, `@agents ...`, or a plain message to the default agent to lazy-start the corresponding native session(s).


### Multi-agent room mode

Codex support coexists with Claude Code inside the same CCM room. The daemon stays intentionally lightweight:

- `ccm /path/to/project` stores the room cwd and default agent; it does not eagerly start every agent.
- Claude and Codex each have at most one active native session per room, created lazily on first cue.
- Agent replies are delivered with visible identity headers (`🟣 Claude`, `🟢 Codex`) so the Slack/Telegram thread itself is the shared transcript.
- The daemon sends a minimal `<ccm_turn>` envelope with room/thread/message pointers, cwd, addressed agent, and peer-agent session pointers. It does not maintain a full message log, unread peer inbox, or summaries.
- The daemon is a product control plane for routing, UX, approval prompts, and auditability; it is not a hard security boundary between agents that already share local credentials, filesystem access, or tools.
- `ask_peer` handoffs get a `handoff_id`; the daemon records lightweight audit metadata in `audit.jsonl`, applies bounded per-room in-flight/rate gates visible in `ccm agents`, and asks the peer to include the id in the visible reply for transcript correlation; if a peer has exactly one in-flight handoff in the same thread, a visible reply without the id safely clears that single thread-local slot as a fallback.
- ACPX is tracked as a possible future `AgentDriver` backend, not a daemon replacement; see `docs/acpx-agent-driver-spike.md` for acceptance gates.
- Agents fetch context on demand through tools such as `fetch_thread`; platform/peer context must be treated as untrusted data.
- `ask_peer` routes a user-authorized peer task, not a hidden answer channel: the receiving agent may act on the task while still treating quoted platform/thread/peer context inside it as untrusted evidence.
- `/cx` is intentionally a thin Codex CLI-compatibility proxy where app-server APIs exist. Unsupported `/cx <other>` commands now fail closed with help text; use `/cx raw /command ...` to explicitly test a raw slash-shaped Codex turn. Empirical testing on Codex `0.130.0` showed `/goal create ...` as a raw turn returns success text but no app-server goal update event, while `/memory ...` is not a native app-server command and can trigger tool approval/input flows. `/cx goal <new goal>` is therefore implemented as a CCM-level replacement turn: CCM interrupts any active Codex turn, then sends explicit replacement-goal instructions into the same Codex thread. Do not rely on raw `/cx goal` or `/cx memory` for production UX until Codex exposes stable app-server requests or CCM adds source-aligned handlers.
- Codex app-server interactive requests are forwarded back to Slack/Telegram like Claude Code prompts: command/file/permission approvals use buttons, `request_user_input` supports option buttons or replying to the prompt message, and MCP elicitation supports replying with JSON/text plus decline/cancel buttons. Command approvals respect Codex `availableDecisions`; explicit policy/network amendment approvals are shown as `Allow Policy` / `Allow Network`. If no configured channel can receive a Codex request, CCM rejects that request back to Codex instead of leaving it pending forever.
- Telegram reactions are best-effort: unsupported CCM status emojis are normalized to supported Telegram reactions when possible, otherwise skipped so acknowledgments never fail the user task.
- Telegram threading uses `reply_to_message_id` anchors. For peer handoffs, the daemon records the routed message/thread id as a known anchor before sending the peer turn, so valid peer replies stay threaded when Telegram accepts them; if Telegram rejects a reply anchor, CCM falls back to a visible main-room reply rather than dropping the message.
- `/cc ss` and `/cx ss` share a screen-like renderer: Claude uses real TUI screen/transcript data, while Codex projects app-server thread/config/pending state into the same low-cognitive-load layout.
- `/cx ss` intentionally mirrors the low-cognitive-load feel of a terminal UI without using a Codex TUI transport: app-server thread/config/pending state is projected into a screen-like snapshot, with transcript fallback when live turns are unavailable.
- Codex pending requests are persisted as minimal routing state so daemon restarts do not silently erase approval/input prompts; if the app-server runtime is gone, `/cx ss` marks those prompts as stale/partial and exposes only `Clear stale request`, not live approval buttons.
- Codex `turn/plan/updated` notifications are forwarded as editable `📋 Codex plan` messages, giving CX the same task-forward intent as Claude task snapshots without inventing a daemon-side task store.

Typical use:

```bash
ccm /path/to/project
ccm default claude
Explain this failure
codex: inspect the adapter boundary
claude: review Codex's suggestion in this thread
@agents propose two alternative plans
ccm agents
ccm start codex
ccm stop codex
```

For plain messages, choose the default with `CHANNEL_DAEMON_DEFAULT_AGENT=claude|codex` or `ccm default claude|codex`.
When a message cues multiple agents, CCM picks the room default as the lead/default agent and sends the same request to the other cued agents as observers. Observers should stay quiet unless they have high-signal detail/context to add, missing evidence, a risk, a correction, or a materially better approach; they can use `chime_in` to inject that note into the lead context while the lead owns the final room answer.

## MCP Tools

Claude agent slot sessions get these tools via the MCP bridge (`server.ts`). Codex agent slot sessions receive the same MCP server through the Codex App Server config override. Inbound delivery is transport-specific behind the Agent SPI: Claude uses its channel notification bridge, while Codex uses `codex app-server` `turn/start` and app-server notifications.

| Tool | Description |
|------|-------------|
| `reply` | Send message to channel (supports files, thread reply) |
| `react` | Add emoji reaction |
| `edit_message` | Edit a previously sent message |
| `download_attachment` | Download file/image to local inbox |
| `fetch_thread` | Pull full thread history (Slack only) |
| `create_room_with_bot_invited` | Create a Slack private worker room and invite the CCM bot from an orchestrator room |
| `archive_room` | Archive a worker room from an orchestrator room |
| `bind_worker_room` | Bind worker-room cwd/runtime metadata from an orchestrator room |
| `start_worker_agent` | Start or resume the assigned worker agent in a bound worker room |
| `send_worker_task` | Send a bounded Worker Task to a started/bound worker room |
| `capture_worker_report` | Retrieve worker-room transcript/reportback facts for durable orchestration state |
| `ask_peer` | Asynchronously cue another agent in the same room for context/second opinion; answer is visible in the room |
| `chime_in` | Observer-only collaboration note injected into the lead/default agent context |

If Claude says a named CCM MCP tool such as `ask_peer` is not in its visible toolset, do not fall back to manually posting a Slack/Telegram message. Claude Code may defer MCP tool schemas behind `ToolSearch`/MCP search when the live tool list is large; the correct behavior is to search/load the named MCP tool and call it with the current `chat_id`. CCM-managed Claude and Codex TUI sessions are room-bound and can initiate these tool calls when the current turn carries the room `chat_id`; non-CCM native continuations that lack room metadata cannot.

## Configuration


### Safe live testing

When testing a candidate daemon with the same Slack/Telegram tokens as production, isolate daemon state and restrict traffic. `CHANNEL_DAEMON_ALLOWED_CHANNELS` gates inbound events plus daemon fan-out back to bound rooms that are not in the allowlist. This limits the blast radius but does not make platform event delivery exclusive: two daemons using the same tokens may both receive Slack/Telegram events, so keep production paused or use separate tokens for true parallel isolation.

```bash
CHANNEL_DAEMON_STATE_DIR=/tmp/ccm-e2e-state \
CHANNEL_DAEMON_ZELLIJ_SESSION=ccmux-test \
CHANNEL_DAEMON_ALLOWED_CHANNELS=slack:C123TEST,telegram:-100123TEST \
bun run daemon
```

Keep `CHANNEL_DAEMON_SELF_TEST_PREFIX` unset unless intentionally running bot-authored inbound tests. Run `bun run validate` and `bun run e2e:preflight` before any temporary `ccm-daemon.service` cutover.

### Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `SLACK_BOT_TOKEN` | - | Slack Bot Token (`xoxb-...`) |
| `SLACK_APP_TOKEN` | - | Slack App Token (`xapp-...`) |
| `TELEGRAM_BOT_TOKEN` | - | Telegram Bot Token |
| `CHANNEL_DAEMON_STATE_DIR` | `~/.config/claude-channel-mux` | State directory |
| `CHANNEL_DAEMON_CWD` | `~` | Default working directory for new sessions |
| `CHANNEL_DAEMON_SPAWN_MODE` | `same-dir` | `same-dir`, `worktree`, or `disabled` for E2E safety |
| `CHANNEL_DAEMON_ZELLIJ_SESSION` | `ccmux` | Zellij session name; set a different value for parallel test daemons |
| `CHANNEL_DAEMON_ALLOWED_CHANNELS` | unset | Optional comma-separated allowlist (`slack:C123`, `telegram:456`, or raw channel id) for cutover/E2E testing |
| `CHANNEL_DAEMON_SELF_TEST_PREFIX` | unset | Test-only prefix that lets bot-authored messages drive inbound E2E tests; keep unset in production |
| `CLAUDE_CHANNEL_MUX_PLUGIN_DIR` | - | Plugin directory for dev mode (`--plugin-dir`) |
| `CLAUDE_CHANNEL_MUX_MARKETPLACE` | `claude-channel-mux` | Marketplace name used in the Claude channel tag when not using `CLAUDE_CHANNEL_MUX_PLUGIN_DIR` |
| `CHANNEL_DAEMON_FORWARD_ENV` | unset | Comma-separated env var names to explicitly export into Claude zellij tabs when zellij inherited stale environment; invalid shell env names are ignored |
| `CHANNEL_DAEMON_DEFAULT_AGENT` / `CHANNEL_DAEMON_AGENT` / `CCM_AGENT` | `claude` | Default agent for plain messages in new rooms; override per room with `ccm default` |
| `CLAUDE_BIN` | `claude` | Path to Claude Code binary |
| `CODEX_BIN` | `codex` | Codex CLI command prefix; may include deployment-specific CLI flags before CCM appends runtime args |
| `CODEX_HOME` | `~/.codex` | Codex config/auth home used by the auto-attached remote TUI |
| `CCM_CODEX_APP_SERVER_LISTEN` / `CHANNEL_DAEMON_CODEX_APP_SERVER_LISTEN` | `websocket` | Codex app-server transport; `websocket` enables native `codex --remote` TUI attachment, `stdio` is retained for tests/fallback |
| `OPENAI_API_KEY` | Codex config/login | Optional Codex App Server credential; set when `codex app-server` is not already authenticated via Codex config/login |
| `CCM_CODEX_WORKTREE` / `CHANNEL_DAEMON_CODEX_WORKTREE` | `auto` | Codex App Server slots create an in-repo `.codex/worktrees/<short session id>` git worktree by default when the room cwd is a git repo; set `off` to run in the room cwd |
| `CCM_CODEX_MODEL` / `CODEX_MODEL` | Codex config default | Optional Codex CLI model passed to App Server, remote TUI launches, and new app-server threads |
| `CCM_CODEX_APPROVAL_POLICY` / `CHANNEL_DAEMON_CODEX_APPROVAL_POLICY` | `on-request` | Codex app-server approval policy for CCM turns; set `never`/`yolo` only for trusted production rooms |
| `CCM_CODEX_SANDBOX` / `CHANNEL_DAEMON_CODEX_SANDBOX` | `workspace-write` | Codex app-server sandbox for CCM turns; set `danger-full-access`/`yolo` only for trusted production rooms |
| `CCM_ASK_PEER_RATE_LIMIT` / `CHANNEL_DAEMON_ASK_PEER_RATE_LIMIT` | `12` | Max ask_peer handoffs per room/from-agent/to-agent per rate window |
| `CCM_ASK_PEER_RATE_WINDOW_MS` / `CHANNEL_DAEMON_ASK_PEER_RATE_WINDOW_MS` | `60000` | Rate window for ask_peer handoffs |
| `CCM_ASK_PEER_MAX_INFLIGHT_PER_ROOM` / `CHANNEL_DAEMON_ASK_PEER_MAX_INFLIGHT_PER_ROOM` | `4` | Max uncorrelated ask_peer handoffs per room before rejecting new ones |
| `CCM_ASK_PEER_INFLIGHT_TTL_MS` / `CHANNEL_DAEMON_ASK_PEER_INFLIGHT_TTL_MS` | `600000` | TTL for uncorrelated ask_peer handoff ids |
| `CCM_COLLAB_MAX_HANDOFFS` / `CHANNEL_DAEMON_COLLAB_MAX_HANDOFFS` | `777` | Max peer handoffs per CCM collaboration before the lead must converge or ask the user to continue |
| `CCM_COLLAB_INLINE_CONTEXT_MAX_CHARS` / `CHANNEL_DAEMON_COLLAB_INLINE_CONTEXT_MAX_CHARS` | `24000` | Total inline peer-reply chars injected back to the lead per collaboration; once exhausted, CCM injects a pointer-only omitted reply |
| `CCM_COLLAB_STALE_TTL_MS` / `CHANNEL_DAEMON_COLLAB_STALE_TTL_MS` | `7200000` | Inactive collaboration TTL before active collabs are marked stale |
| `CCM_PEER_REPLY_INJECTION_MAX_CHARS` / `CHANNEL_DAEMON_PEER_REPLY_INJECTION_MAX_CHARS` | `2000` | Max inline peer reply chars injected back to the lead; full text remains available through Slack thread pointers |
| `CCM_AGENT_CONTEXT_TURN_MAX_CHARS` / `CHANNEL_DAEMON_AGENT_CONTEXT_TURN_MAX_CHARS` | `8000` | Hard cap for escaped daemon-generated peer/collaboration current-message text; agents should fetch full context from thread pointers |

### Persistent state

Bindings live in `~/.config/claude-channel-mux/bindings.json`. Each channel/thread key stores a lightweight CCM room: cwd, default agent, and optional lazy agent session slots. Conversation history stays in Slack/Telegram and native agent transcripts; the daemon does not duplicate it.

```json
{
  "slack:C0123ABCD": {
    "active": "codex",
    "cwd": "/Users/me/src/app",
    "sessions": {
      "claude": "550e8400-e29b-41d4-a716-446655440000",
      "codex": "019e2565-07b2-7b93-bf51-4e184d519b5b"
    },
    "agentMeta": {
      "codex": {
        "transport": "codex-app-server",
        "nativeSessionId": "019e2565-07b2-7b93-bf51-4e184d519b5b",
        "cwd": "/Users/me/src/app",
        "model": "gpt-5.4"
      }
    }
  },
  "telegram:123456789": {
    "active": "claude",
    "sessions": {
      "claude": "550e8400-e29b-41d4-a716-446655440000"
    }
  }
}
```

Channel key -> `{ active, cwd, sessions, agentMeta }`. `active` is the room default agent, `cwd` is the room path, `sessions` contains only agents that have been started or rebound, and `agentMeta` stores transport-native pointers such as the Codex App Server thread id plus small room-scoped preferences such as the Codex model override. Conversation history stays in Slack/Telegram and native agent transcripts; CCM stores only routing/session metadata.

## Adding a new platform

Create `adapters/yourplatform.ts` implementing the `ChannelAdapter` interface, add it to the `adapters[]` array in `daemon.ts`. Zero changes to the core.

The adapter interface handles: message send/receive, reactions, file upload/download, inline keyboards, search prompts, and UI rendering (list pickers, grids, buttons).

## Fault tolerance

| Failure | Recovery |
|---------|----------|
| Daemon crash | systemd/launchd restarts. `bindings.json` on disk. Sessions resumable. |
| Agent session crash | Transcript on disk. `ccm resume` restores when the runtime supports resume. |
| IPC disconnect | Auto-reconnect with exponential backoff (1s -> 30s). |
| Stale bindings | Cleaned on daemon startup. |
| Spawn failure | Error reported to channel with retry buttons. |
| Zellij unavailable | Falls back to background processes. |

## Building the WASM plugin

The zellij pane watcher plugin is optional (pre-built binary included). To rebuild:

```bash
cd zellij-plugin
rustup target add wasm32-wasip1
cargo build --release --target wasm32-wasip1
```

## Known limitations

- Daemon-spawned Claude agent slot sessions load the plugin via `--dangerously-load-development-channels` (because third-party plugins aren't on Claude Code's built-in `--channels` allowlist). Claude Code prompts once per session to confirm the dev channel load; `bypass permissions` skips it. Regular installs into your personal Claude Code session via `plugin install` don't hit this — the flag only applies to daemon-spawned Claude agent slot sessions.
- Threading: both the reply tool and the poll path derive their threading signal from Claude Code's context. The reply tool carries Claude Code's explicit `reply_to` arg (forwarded verbatim, with a safety-net fallback to main channel on unrecognized anchors). The poll path derives threading from the `message_id` in the JSONL user entry's `<channel>` tag — Claude Code processes messages serially, so the latest user entry identifies which thread all subsequent assistant text belongs to. On daemon restart, poll-path threading resets until the first new inbound arrives.
- Telegram Bot API has no message history/search. Use `fetch_thread` (Slack only) for context recovery after compaction.
- Telegram file downloads are capped at 20MB by the Bot API.

## License

Apache-2.0
