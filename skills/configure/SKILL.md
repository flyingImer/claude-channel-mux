---
name: configure
description: Set up the Slack channel — save bot/app tokens and review access policy. Use when the user pastes a Slack bot token, asks to configure Slack, or wants to check channel status.
---

# Slack Channel Configuration

Help the user set up their Slack channel plugin.

## Setup Steps

### 1. Create a Slack App

Guide the user to https://api.slack.com/apps and create a new app:

1. **Create New App** → "From scratch"
2. **Socket Mode**: Enable in Settings → Socket Mode. Generate an App-Level Token with `connections:write` scope. This gives an `xapp-...` token.
3. **Event Subscriptions**: Enable and subscribe to bot events:
   - `message.channels` (public channels)
   - `message.groups` (private channels)
   - `message.im` (DMs)
   - `message.mpim` (group DMs)
4. **OAuth & Permissions**: Add Bot Token Scopes:
   - `channels:history` — read public channel messages
   - `channels:read` — list channels
   - `chat:write` — send messages
   - `reactions:write` — add reactions
   - `files:read` — download files
   - `files:write` — upload files
   - `users:read` — resolve user names
   - `im:history` — read DM messages
   - `im:write` — open DMs
   - `groups:history` — read private channel messages
5. **Install to Workspace**: Install the app and copy the Bot User OAuth Token (`xoxb-...`)

### 2. Save Tokens

Write both tokens to `~/.config/claude-channel-mux/.env`:

```
SLACK_BOT_TOKEN=xoxb-your-bot-token
SLACK_APP_TOKEN=xapp-your-app-token
```

Set file permissions to 600:
```bash
chmod 600 ~/.config/claude-channel-mux/.env
```

### 3. Invite Bot to Channels

The bot must be invited to any channel it should monitor:
```
/invite @your-bot-name
```

### 4. Start Claude Code with Channel

```bash
claude --dangerously-load-development-channels server:claude-channel-mux
```

### 5. Configure Access

Use `/claude-channel-mux:access` to:
- Set DM policy (pairing/allowlist/disabled)
- Add channels to monitor
- Manage user allowlists

## Checking Status

Read `~/.config/claude-channel-mux/access.json` and report:
- Current DM policy
- Number of allowlisted users
- Monitored channels
- Any pending pairings
