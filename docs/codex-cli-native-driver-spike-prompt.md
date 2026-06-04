# Prompt: Codex CLI Native Driver Feasibility Spike

You are working in the CCM repo at:

`<CANDIDATE_CWD>`

Goal: determine whether CCM should add a Codex CLI-native driver, or stay App Server-first and build a zellij observer panel.

Read first:

- `docs/codex-cli-native-driver-spike.md`
- `README.md`
- `agents/types.ts`
- `agents/codex/app-server-driver.ts`
- Relevant `daemon.ts` command/event routing paths
- Claude Code reference tarball: `<LOCAL_CLAUDE_CODE_TARBALL>`
- Local Codex install/source entrypoints under `<LOCAL_CODEX_INSTALL>/node_modules/@openai/codex*`
- If needed, inspect the upstream Codex repo/source matching local version.

Deliverable:

Write a concise report answering:

1. Is there a non-paste inbound path for real Codex CLI turns?
2. Can Codex CLI expose structured events for assistant messages, plan updates, approvals, tool requests, errors, and turn completion?
3. Where are goal/memory implemented, and can CCM invoke those semantics without reimplementing them?
4. What are the minimal `AgentDriver`/daemon changes needed for a CLI-native driver?
5. Which path should CCM choose: App Server-only, CLI-native, or App Server + zellij observer panel?
6. If CLI-native is viable, list implementation steps and tests. If not, list observer-panel steps and tests.

Constraints:

- Do not implement the driver in this spike unless the answer is obvious and changes are tiny.
- Do not propose blind terminal paste as a final architecture.
- Push back if CLI internals are too unstable.
- Preserve CCM priorities: UX first, lightweight daemon, deterministic routing/audit/approval, scalable multi-room operation.
- Be explicit about facts vs assumptions.
