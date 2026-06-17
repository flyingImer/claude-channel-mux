---
title: "CCM agent sessions must forward LiteLLM routing environment"
date: 2026-06-17
category: docs/solutions/integration-issues
module: ccm-agent-routing
problem_type: integration_issue
component: tooling
symptoms:
  - "CCM-launched Claude and Codex sessions bypassed local LiteLLM routing"
  - "Claude session 9961993d Stop hook evaluator hit Snowhouse Cortex directly"
  - "Snowhouse Cortex rejected `output_config.format` with a 400 invalid request"
root_cause: config_error
resolution_type: config_change
severity: high
tags: [ccm-daemon, litellm-routing, agent-env-forwarding, claude-hooks, codex-remote-tui]
---

# CCM agent sessions must forward LiteLLM routing environment

## Problem

CCM-launched Claude and Codex sessions were expected to route model traffic through the local LiteLLM sidecar, but Claude session `9961993d` kept failing its Stop hook evaluator with:

```text
Hook evaluator API error: API Error: 400 invalid request parameters:
"output_config.format: Extra inputs are not permitted"
```

The confusing part was that the LiteLLM sidecar had already been fixed and restarted: a direct `/v1/messages` request to `http://127.0.0.1:24000` with `output_config.format` returned HTTP 200. The live sidecar path was healthy, but the running Claude session was still using a stale direct Snowhouse route.

## Symptoms

- Claude session `9961993d` produced a new Stop hook error after `litellm.service` was restarted and the sidecar repro passed.
- The error matched Snowhouse Cortex's native rejection of `output_config.format`, not the fixed local LiteLLM behavior.
- The failing Stop summary had normal shell hooks succeeding, followed by a prompt-style hook evaluator entry failing with the same `output_config.format` error.
- The CCM daemon service had `CHANNEL_DAEMON_FORWARD_ENV=ANTHROPIC_BASE_URL,...`, but its actual process environment did not contain an `ANTHROPIC_BASE_URL` value to forward.
- Codex had a parallel launch gap: app-server inherited daemon env, while the remote TUI command only explicitly exported `CODEX_HOME` and `DISABLE_AUTOUPDATER`.

## What Didn't Work

- **Restarting only `litellm.service`.** This proved the sidecar could handle the request, but it did not change the environment of already-running Claude sessions.
- **Changing global Claude settings after session start.** Existing Claude processes keep their startup environment; a running session does not automatically reread new `ANTHROPIC_BASE_URL` values.
- **Trusting zellij inheritance.** A long-lived zellij server can keep stale environment from when it was created. New tabs spawned inside that zellij session do not necessarily inherit the daemon's current routing variables.
- **Setting only `CHANNEL_DAEMON_FORWARD_ENV`.** The forwarding list names variables, but forwarding cannot produce a value that is absent from the daemon process environment.
- **Assuming Codex was covered by app-server env inheritance.** The app-server path inherited daemon env, but the remote TUI launch path had its own shell export layer and did not carry the same routing contract. (session history)

## Solution

Treat provider routing as part of the CCM launch contract. The daemon now has a shared list of agent routing and auth variables that are always forwarded into CCM-managed agent launch surfaces:

```ts
export const DEFAULT_FORWARDED_AGENT_ENV = [
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS',
  'OPENAI_BASE_URL',
  'OPENAI_API_BASE',
  'OPENAI_API_KEY',
]
```

Claude zellij tab launches combine that default set with any operator-provided `CHANNEL_DAEMON_FORWARD_ENV` names before building the shell export:

```ts
const explicitForwardList = (process.env.CHANNEL_DAEMON_FORWARD_ENV ?? '').split(',')
const forwardList = [...DEFAULT_FORWARDED_AGENT_ENV, ...explicitForwardList]
const forwardedExports = forwardedEnvExports(forwardList, process.env, name => {
  process.stderr.write(`daemon: ignoring invalid forwarded env name ${JSON.stringify(name)}\n`)
})
const envExports = `export ${forwardedExports} CC_CHANNEL_SESSION_UUID=${shellArg(uuid)} CC_CHANNEL_DAEMON_SOCK=${shellArg(SOCK_PATH)} CLAUBBIT=1 DISABLE_AUTOUPDATER=1;`
```

Codex remote TUI launches export the same default routing environment instead of only Codex-specific variables:

```ts
const agentEnvExports = forwardedEnvExports(DEFAULT_FORWARDED_AGENT_ENV, process.env)
const envExports = `export ${agentEnvExports} CODEX_HOME=${shellArg(config.home)} DISABLE_AUTOUPDATER=1;`
```

Production also needs actual values in the daemon environment. The live systemd drop-in sets the local LiteLLM route explicitly:

```ini
[Service]
Environment=ANTHROPIC_BASE_URL=http://127.0.0.1:24000
Environment=CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS=1
Environment=OPENAI_BASE_URL=http://127.0.0.1:24000/v1
Environment=OPENAI_API_BASE=http://127.0.0.1:24000/v1
```

After `systemctl --user daemon-reload` and `systemctl --user restart ccm-daemon.service`, the daemon process environment showed those values and new CCM-managed sessions can forward them into their child launch surfaces.

## Why This Works

The failing request was not proof that LiteLLM still rejected `output_config.format`; it was proof that the Stop hook evaluator was not using the LiteLLM route. The sidecar repro and the transcript evidence split the problem into two paths:

1. `http://127.0.0.1:24000/v1/messages` stripped or handled `output_config.format` correctly and returned HTTP 200.
2. The existing Claude session still used a direct Snowhouse `ANTHROPIC_BASE_URL`, where Cortex rejected `output_config.format`.

Forwarding default routing variables from the daemon into Claude zellij tabs closes the stale-zellij gap. Exporting the same routing set into Codex remote TUI commands closes the parity gap between Codex app-server and TUI launch paths. Supplying the actual base URLs through the systemd service environment closes the deployment gap where the daemon had a forwarding list but no value to forward.

Already-running sessions remain a special case: they must be stopped and restarted before they can pick up changed provider-routing environment. (session history)

## Prevention

- Treat model-provider routing env as a launcher contract, not incidental process state.
- Verify both the service environment and child-session environment when debugging routing:

```bash
systemctl --user show ccm-daemon.service -p Environment --no-pager
tr '\0' '\n' < /proc/<daemon-pid>/environ | grep -E 'ANTHROPIC|OPENAI|BASE_URL'
```

- When zellij is involved, assume the zellij server environment may be stale unless the launch command explicitly exports the variables that matter.
- When changing provider routing, restart both the service and any existing Claude or Codex sessions that were launched before the change.
- Keep Claude and Codex launch parity covered by tests: Claude zellij tab exports, Codex app-server env, and Codex remote TUI env should all agree on the same routing contract.
- Use a live sidecar repro to distinguish proxy compatibility bugs from stale-session routing bugs:

```bash
curl -sS -w '\nHTTP:%{http_code}\n' http://127.0.0.1:24000/v1/messages \
  -H 'Content-Type: application/json' \
  -H 'anthropic-version: 2023-06-01' \
  -d '{"model":"claude-opus-4-8","max_tokens":16,"output_config":{"format":{"type":"json_schema","name":"hook_result","schema":{"type":"object"}}},"messages":[{"role":"user","content":"Reply with exactly: output config ok"}]}'
```

## Related Documentation

- `docs/solutions/integration-issues/ccm-orchestration-shared-codex-bridge-routing-failures.md` covers an adjacent routing failure around Agent Control Path room identity and shared Codex bridge routing. This learning is distinct: it covers provider base URL and environment propagation into CCM-managed agent sessions.
- `docs/solutions/workflow-issues/ccm-orchestration-steering-vs-execution.md` provides related context for why visible CCM orchestration should not silently degrade into hidden execution paths.

## Verification

The fix was verified with:

```bash
bun run validate
```

That ran the full test suite, TypeScript typecheck, orchestration validation, and `git diff --check` successfully. A live sidecar request containing `output_config.format` returned HTTP 200, and the restarted `ccm-daemon.service` process environment contained the local LiteLLM `ANTHROPIC_BASE_URL`, `OPENAI_BASE_URL`, and `OPENAI_API_BASE` values.
