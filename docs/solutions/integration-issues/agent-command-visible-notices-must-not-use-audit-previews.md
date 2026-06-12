---
title: Agent command visible notices must not use audit previews
date: 2026-06-12
category: docs/solutions/integration-issues
module: Slack slash command bridge
problem_type: integration_issue
component: assistant
symptoms:
  - "Slack `/cx raw /goal ...` parsed-command confirmations showed only the first line or stopped around 500 characters"
  - "The durable audit trail contained more of the slash-command body than the user-visible confirmation"
root_cause: logic_error
resolution_type: code_fix
severity: medium
tags: [slack-slash-commands, codex, command-visibility, audit-logging, regression-test]
---

# Agent command visible notices must not use audit previews

## Problem

Slack slash-command debugging depends on the `🧭 Parsed command` confirmation showing exactly what CCM parsed and is about to execute. Two regressions made that confirmation misleading: first it only displayed the first line of a multiline `/cx raw /goal ...` payload, then it preserved newlines but still stopped around 500 characters.

That broke the main purpose of the confirmation. The user-visible notice is the evidence for whether Slack, CCM, or the agent received the full command; if the notice truncates independently, it creates a false suspect.

## Symptoms

- A multiline `/cx raw /goal ...` command showed only the first line in the `Parsed command` notice.
- After the first fix, a longer multiline command still stopped around 500 characters even though the raw slash-command audit event contained more text.
- The final message still said `Executing on Codex.`, making it look like Codex received a truncated command.

## What Didn't Work

- Reusing `commandPreview()` for the visible confirmation. That helper intentionally redacts and slices to 500 characters for persistent audit/log fields.
- Wrapping the preview in a fenced block. Fencing fixed multiline rendering, but it did not fix the 500-character audit-preview limit.
- Looking only at `audit.jsonl`. Audit records are useful for recovery, but their preview fields are intentionally bounded and should not define user-visible behavior.

## Solution

Keep two separate formatting paths:

- Persistent audit/log fields use `commandPreview()`, which redacts and bounds stored text.
- User-visible parsed-command confirmations use `visibleCommandText()`, which redacts secrets but does not apply the audit preview length cap.

The visible confirmation then formats the complete redacted command as a fenced block:

```ts
function commandPreview(command: string): string {
  return redactSensitiveText(command).replace(/\r/g, '').slice(0, 500)
}

function visibleCommandText(command: string): string {
  return redactSensitiveText(command).replace(/\r/g, '')
}

function parsedCommandNotice(runtime: AgentRuntimeKind, command: string): string {
  return formatAgentReply(runtime, `${formatParsedAgentCommand(visibleCommandText(command))}\nExecuting on ${agentName(runtime)}.`)
}
```

`formatParsedAgentCommand()` lives with the shared command helpers so tests can assert the exact multiline shape without importing the daemon:

```ts
export function formatParsedAgentCommand(command: string): string {
  return `🧭 Parsed command:\n\`\`\`\n${command}\n\`\`\``
}
```

Regression coverage should include both dimensions:

- Multiline command bodies remain visible across newline boundaries.
- Long command bodies keep text past 500 characters in the user-visible formatter.
- Static coverage prevents `parsedCommandNotice()` from going back to `commandPreview(command)`.

## Why This Works

The bug was not Slack truncating the message and not Codex truncating the command. It was an internal boundary violation: a bounded audit preview helper was reused as a user-facing truth source.

Separating `commandPreview()` from `visibleCommandText()` lets each path optimize for its own job. Audit events stay bounded to protect disk usage and reduce long-lived content exposure. Visible confirmations stay complete enough to debug command delivery, while still using the shared redaction helper for secrets.

Slack and Telegram adapters already own platform message limits and splitting behavior. The daemon should not pre-truncate the content that users rely on for parse visibility.

## Prevention

- Name helpers by purpose, not by implementation detail. `commandPreview()` is for audit/log previews; it should not feed user-visible confirmations.
- Keep visible parse confirmations fenced and multiline-safe.
- Add regression tests for both newline preservation and long-body preservation whenever command visibility changes.
- Preserve static tests around the daemon path so a future refactor cannot silently route `parsedCommandNotice()` back through audit preview truncation.

## Related Issues

- `commands.ts`
- `daemon.ts`
- `test/commands.test.ts`
- `test/parity-static.test.ts`
