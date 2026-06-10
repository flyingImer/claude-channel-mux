# Slack Inbound Normalization Notes

This document records Slack-specific inbound message normalization rules that affect room setup, command parsing, and agent cues.

## ChatGPT App Attribution Footer

Slack messages sent through the ChatGPT app can append an attribution footer to the same `event.text` that CCM parses as user input.

Observed payloads in `C0B9E0RT9GE` on 2026-06-10:

- `ccm /home/repo/ejwang/ws-spi *Sent using* <@U0B92AQGU3G>`
- `ccm new codex *Sent using* <@U0B92AQGU3G>`

CCM must strip this footer before command parsing. Otherwise:

- `ccm /path *Sent using* <@app>` no longer matches the single-token path parser and falls back to bare `ccm` directory-picker behavior.
- `ccm new codex *Sent using* <@app>` no longer matches the exact `ccm new codex` parser and also falls back instead of starting Codex.

The normalization lives in `slackInboundEventFields()` so it applies to all Slack inbound message text before the daemon sees it, not only to `ccm` commands.

## Guardrails

- Strip only trailing app attribution, not arbitrary in-message text that happens to contain `sent using`.
- Support both newline footer forms and inline Slack mrkdwn forms such as `*Sent using* <@APP>`.
- Keep the normalized command text identical to what the daemon parser expects; do not teach the daemon parser about Slack app attribution syntax.
- Regression tests belong with Slack adapter identity/event field tests because this is an adapter-normalization concern.

