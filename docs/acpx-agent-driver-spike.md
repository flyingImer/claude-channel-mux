# ACPX AgentDriver Spike

Goal: decide whether ACPX should become an optional CCM `AgentDriver` backend. This spike must not migrate the existing Claude/Codex drivers unless the acceptance gates below pass.

## Current observation

Local ACPX is available through `npx acpx`:

- Version observed: `0.7.0`
- Relevant knobs from `acpx --help`:
  - `--cwd`
  - `--format text|json|quiet`
  - `--allowed-tools`
  - `--approve-all`, `--approve-reads`, `--deny-all`
  - `--non-interactive-permissions deny|fail`
  - `--timeout`
  - `--ttl`
  - `--no-wait` for agent prompt subcommands
  - named sessions via `-s` and `sessions`
- Relevant config from `acpx config show`:
  - `defaultAgent`
  - `defaultPermissions`
  - `nonInteractivePermissions`
  - `authPolicy`
  - `queueMaxDepth`
  - `agents`

## Non-goals

- Do not replace the CCM daemon.
- Do not change Slack/Telegram room UX.
- Do not migrate current Claude/Codex slots during the spike.
- Do not claim ACPX creates a security boundary; token/filesystem/network isolation is a separate track.

## Candidate architecture

- Add `AcpAgentDriver` behind the existing Agent SPI.
- Daemon remains the outer control plane:
  - room binding
  - identity header
  - channel tokens
  - reply/thread semantics
  - `ask_peer` policy/audit/rate gates
- ACPX owns only agent-session transport for ACP-compatible agents:
  - session creation/resume/status/cancel
  - queueing / `--no-wait`
  - structured output when reliable

## Spike tasks

1. One-shot baseline
   - Run `npx acpx codex exec --cwd <tmp-repo> --format json --timeout 60 "reply exactly ..."`.
   - Verify output is machine-parseable enough to map to `assistant_final`.

2. Named session lifecycle
   - Run `npx acpx codex sessions ensure -s <name>`.
   - Send two prompts to the same session.
   - Verify status/resume/cancel behavior maps to CCM `AgentSession`.

3. Async queue
   - Run a long prompt with `--no-wait`.
   - Immediately enqueue a second prompt.
   - Verify ACPX queue behavior, queue depth, and completion discovery.

4. Permission mapping
   - Test `--approve-reads`, `--deny-all`, `--allowed-tools ""`, and `--non-interactive-permissions deny`.
   - Verify denials surface as deterministic errors/events that CCM can render like `/cx nav` or fail-closed help.

5. Worktree/cwd
   - Run ACPX in a CCM-created Codex worktree.
   - Verify no global config writes are needed for cwd/model selection.

6. Room context envelope
   - Pass the same `<ccm_turn>` envelope used by current drivers.
   - Verify the agent can call CCM MCP tools or, if ACPX cannot expose them, document the blocker.

7. Performance / reliability
   - 10 named sessions × 3 async prompts each.
   - Measure startup overhead, completion latency, process count, and error modes.

## Acceptance gates

Adopt ACPX as an optional backend only if all are true:

- It preserves CCM UX: identity, room/thread semantics, `/cc`/`/cx` style commands, and visible `ask_peer` handoffs.
- It reduces driver complexity versus current dedicated drivers for at least one non-critical agent.
- It supports async enqueue without daemon waiting on agent answers.
- It exposes enough lifecycle/status/cancel information for `ss`, `nav`, `status`, and transcript fallback.
- It has deterministic permission behavior that can be mapped to CCM approvals or fail-closed UX.
- It works with CCM worktree/cwd model without modifying global agent config.
- It does not require giving Slack/Telegram tokens to agent processes.

Reject or defer ACPX if any are true:

- It obscures agent identity or returns hidden answer payloads by default.
- It cannot preserve visible room/thread transcript as source of truth.
- It makes `/cc` or `/cx` UX meaningfully less like native CC/Codex usage.
- It introduces a second product control plane competing with daemon policy.
- It requires broad tool/network credentials in the agent process.
- It is less reliable than the current Codex app-server / Claude channel drivers in E2E tests.

## Expected outcome

The likely near-term outcome is `AcpAgentDriver` as a third backend for future/generic ACP agents, not a replacement for current Claude/Codex drivers.
