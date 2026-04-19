# claude-channel-mux

Multi-channel session multiplexer for [Claude Code](https://claude.ai/code). One daemon routes Slack + Telegram conversations to independent CC sessions, each running in its own zellij tab.

Talk to Claude Code from your phone. Manage multiple sessions across channels. Get inline buttons for interactive dialogs. All without touching a terminal.

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                        daemon.ts                                 │
│  Platform-agnostic core: magic words, session lifecycle,         │
│  bindings, IPC routing, screen watching, git worktree            │
│                                                                  │
│  ┌─────────────────┐  ┌──────────────────┐  ┌────────────────┐  │
│  │ adapters/slack   │  │ adapters/telegram │  │ adapters/???   │  │
│  │ Socket Mode      │  │ Long Poll        │  │ (future)       │  │
│  └────────┬────────┘  └────────┬─────────┘  └───────┬────────┘  │
│           └─────────────────────┴─────────────────────┘           │
│                         ChannelAdapter interface                  │
│                                                                  │
│  ┌──────────────┐  ┌──────────────────────┐                     │
│  │ escort.ts    │  │ zellij-plugin/ (WASM) │                    │
│  │ zellij I/O   │  │ PaneRenderReport      │                    │
│  └──────────────┘  └──────────────────────┘                     │
└──────────┬───────────────────┬──────────────────┬────────────────┘
           │ IPC               │ IPC              │ IPC
           ▼                   ▼                  ▼
    CC session + server.ts   CC session          CC session
    [zellij tab]             [zellij tab]        [zellij tab]
```

### Key components

| File | Role |
|------|------|
| `daemon.ts` | Core orchestrator: commands, session spawn, bindings, IPC, screen watch |
| `server.ts` | Per-session MCP bridge: daemon IPC <-> CC channel protocol |
| `escort.ts` | Zellij helpers: dump-screen, send-keys, pane lookup |
| `adapters/types.ts` | `ChannelAdapter` interface |
| `adapters/slack.ts` | Slack (Socket Mode + Web API + slash commands + modal search) |
| `adapters/telegram.ts` | Telegram (Bot API long poll + force_reply search + bot commands) |
| `zellij-plugin/` | WASM pane watcher for real-time screen change detection |

## Features

- **Multi-session** - Run multiple CC sessions simultaneously, each bound to a different channel
- **Cross-channel relay** - Same session accessible from Slack AND Telegram
- **Inline keyboard navigation** - CC startup dialogs rendered as chat buttons
- **Directory picker** - Browse, search, and jump to directories from chat
- **Session picker** - Two-level menu (project folders, then sessions) with title extraction
- **Image/file support** - Bidirectional: send images to CC, CC sends files back
- **Permission forwarding** - CC permission prompts appear as Allow/Deny buttons in chat
- **Git worktree isolation** - Optional per-session worktree branches
- **Reply context** - Quoted messages carry `reply_to_id` for thread awareness
- **Slash commands** - Native `/ccm` and `/cc` commands (Slack + Telegram)
- **Fault tolerant** - IPC auto-reconnect, daemon restart recovery, stale tab cleanup

## Commands

Type in any connected Slack channel or Telegram chat (plain text or `/ccm` slash command):

| Command | Action |
|---------|--------|
| `ccm` | New session (directory picker) + bind channel |
| `ccm /path/to/dir` | New session in directory + bind channel |
| `ccm resume` | Interactive session picker |
| `ccm resume <id>` | Resume specific session + bind channel |
| `ccm stop` | Unbind channel (or list active sessions) |
| `ccm stop <id>` | Stop specific session |
| `ccm find <query>` | Fuzzy search directories |
| `ccm help` | Status + commands + action buttons |

CC commands (forwarded to session terminal):

| Command | Action |
|---------|--------|
| `/cc compact` | Compact context |
| `/cc model` | Switch model |
| `/cc exit` | Exit session |

## Prerequisites

| Dependency | Required | Notes |
|------------|----------|-------|
| [Bun](https://bun.sh) >= 1.0 | Yes | Runtime |
| [Claude Code](https://claude.ai/code) >= 2.1 | Yes | `claude` in PATH |
| [zellij](https://zellij.dev) >= 0.40 | Recommended | Sessions as tabs with screen watching. Falls back to background processes. |
| Rust toolchain | No | Only if rebuilding the WASM pane watcher plugin |

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
adds `/claude-channel-mux:access` + `/claude-channel-mux:configure` skills.
The daemon (`daemon.ts`) is a separate long-running process you start in
step 4 below.

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
2. Paste the contents of `slack-app-manifest.yml`
3. In Socket Mode settings, generate an App-Level Token with `connections:write` scope
4. Install to your workspace

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

For auto-restart with systemd (Linux):
```bash
cp ccm.service ~/.config/systemd/user/
systemctl --user enable --now ccm
```

For auto-restart with launchd (macOS):
```bash
cp ccm.plist ~/Library/LaunchAgents/com.claude.ccm.plist
launchctl load ~/Library/LaunchAgents/com.claude.ccm.plist
```

### 5. Use it

Send `ccm` in any connected Slack channel or Telegram chat. Pick a directory. Claude Code starts in a zellij tab and responds through your chat.

## MCP Tools

Each CC session gets these tools via the MCP bridge (`server.ts`):

| Tool | Description |
|------|-------------|
| `reply` | Send message to channel (supports files, thread reply) |
| `react` | Add emoji reaction |
| `edit_message` | Edit a previously sent message |
| `download_attachment` | Download file/image to local inbox |
| `fetch_thread` | Pull full thread history (Slack only) |

## Configuration

### Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `SLACK_BOT_TOKEN` | - | Slack Bot Token (`xoxb-...`) |
| `SLACK_APP_TOKEN` | - | Slack App Token (`xapp-...`) |
| `TELEGRAM_BOT_TOKEN` | - | Telegram Bot Token |
| `CHANNEL_DAEMON_STATE_DIR` | `~/.config/claude-channel-mux` | State directory |
| `CHANNEL_DAEMON_CWD` | `~` | Default working directory for new sessions |
| `CHANNEL_DAEMON_SPAWN_MODE` | `same-dir` | `same-dir` or `worktree` (git worktree isolation) |
| `CLAUDE_CHANNEL_MUX_PLUGIN_DIR` | - | Plugin directory for dev mode (`--plugin-dir`) |
| `CLAUDE_BIN` | `claude` | Path to Claude Code binary |

### Persistent state

One file: `~/.config/claude-channel-mux/bindings.json`

```json
{
  "slack:C0123ABCD": "550e8400-e29b-41d4-a716-446655440000",
  "telegram:123456789": "550e8400-e29b-41d4-a716-446655440000"
}
```

Channel key -> CC session UUID. Session data lives in CC's own transcript files. No duplication.

## Adding a new platform

Create `adapters/yourplatform.ts` implementing the `ChannelAdapter` interface, add it to the `adapters[]` array in `daemon.ts`. Zero changes to the core.

The adapter interface handles: message send/receive, reactions, file upload/download, inline keyboards, search prompts, and UI rendering (list pickers, grids, buttons).

## Fault tolerance

| Failure | Recovery |
|---------|----------|
| Daemon crash | systemd/launchd restarts. `bindings.json` on disk. Sessions resumable. |
| CC session crash | Transcript on disk. `ccm resume` restores. |
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

- Daemon-spawned CC sub-sessions load the plugin via `--dangerously-load-development-channels` (because third-party plugins aren't on Claude Code's built-in `--channels` allowlist). CC prompts once per session to confirm the dev channel load; `bypass permissions` skips it. Regular installs into your personal CC session via `plugin install` don't hit this — the flag only applies to the sub-sessions the daemon spawns.
- Threading is owned by CC's context management via the `reply` tool's `reply_to` arg. The daemon forwards CC's choice verbatim and does not override. When you have multiple Slack threads open in parallel, CC has to correctly attribute each reply to the right inbound — if CC drifts (reuses a stale `reply_to` from an earlier turn), the reply lands in the wrong thread. Tell CC to correct `reply_to` and it will; the plugin contract doesn't give the daemon a way to disambiguate parallel threads on its own.
- Mid-turn text forwarded via the transcript poll loop (💬 / 📬 prefix) goes to the main channel, not any thread. The poll path reads CC's JSONL without a threading signal, so the daemon doesn't guess. If you want CC's mid-turn updates inside a thread, have CC call `reply` with `reply_to` instead of only writing text.
- Telegram Bot API has no message history/search. Use `fetch_thread` (Slack only) for context recovery after compaction.
- Telegram file downloads are capped at 20MB by the Bot API.

## License

Apache-2.0
