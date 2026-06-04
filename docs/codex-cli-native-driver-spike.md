# Codex CLI Native Driver Spike

## Decision Context

CCM currently drives Codex through `codex app-server --listen stdio://`. That is a production-safe default because App Server is a structured JSON-RPC integration surface: CCM can start turns, receive events, route approvals, interrupt turns, and keep Slack/Telegram UX deterministic without scraping a terminal.

The tradeoff is UX parity. Codex CLI has user-facing semantics such as goals, memory, and a live terminal experience that are not always exposed as stable App Server methods. CCM has already had to bridge gaps with compatibility commands such as `/cx goal <new goal>` and a projected `/cx ss` snapshot. This spike decides whether a separate Codex CLI-native driver would reduce long-term complexity and improve UX, or whether CCM should stay App Server-first and improve observability around that backend.

## Non-Goals

- Do not replace the current Codex App Server driver during the spike.
- Do not build a blind terminal paste transport as the proposed final design.
- Do not fork Codex CLI unless the spike proves a small, testable patch is the only robust route.
- Do not promise parity for commands whose implementation is not exposed through a stable seam.

## Candidate Architectures

### A. Keep App Server as the Production Driver

CCM continues using `codex app-server` for real Slack/Telegram turns. Improve missing UX with explicit compatibility commands and a zellij observer panel rendered from app-server events.

Pros:
- Structured event/request lifecycle.
- Deterministic approvals, interruptions, and routing.
- Lower risk of upstream TUI drift.
- Fits CCM's lightweight daemon principle.

Cons:
- CLI-native commands may require CCM compatibility shims.
- zellij view is projected, not the real Codex TUI.
- Some user-facing CLI affordances may lag until App Server exposes them.

### B. Add a Codex CLI-Native Driver

CCM runs real Codex CLI in zellij and injects inbound Slack/Telegram turns through a non-paste bridge discovered in Codex source or a small upstreamable patch. The driver also extracts structured events for replies, plans, approvals, goal/memory state, and turn completion.

Pros:
- Best chance of matching Codex CLI mental model.
- Real zellij live view.
- Less need to manually mirror CLI slash semantics if a stable internal command path exists.

Cons:
- TUI internals may not be stable SPI.
- A fork or patch could create upgrade drag.
- If inbound requires paste/screen scraping, reliability regresses toward the old fragile path.
- Structured Slack/Telegram UX still needs deterministic events, not just terminal text.

### C. Hybrid: App Server Driver + zellij Observer

CCM keeps App Server for turns and runs a local observer panel in zellij that renders current turn, plan, pending requests, transcript tail, approvals, and recent peer handoffs.

Pros:
- Preserves structured backend.
- Gives users an always-visible zellij surface.
- Avoids TUI input hacks.

Cons:
- Still not the real Codex TUI.
- Native CLI-only features still need App Server APIs or compatibility commands.

## Acceptance Gates for CLI-Native

A CLI-native driver is worth building only if the spike finds a path that satisfies all of these:

1. **Non-paste inbound**: Slack/Telegram turns can enter Codex without blind terminal paste or fragile prompt timing.
2. **Structured outbound**: The driver can observe assistant messages, plan updates, approvals, tool requests, errors, and turn completion as structured events.
3. **Command parity seam**: Goal, memory, compact, model/mode, approvals, and interrupt paths can use Codex CLI internals or stable public APIs rather than reimplementing CLI behavior in CCM.
4. **Real or equivalent live view**: zellij can show either the real Codex TUI or an observer panel whose fidelity is good enough to lower cognitive load.
5. **Upgrade discipline**: The integration is no-fork or tiny-patch with tests that fail clearly when upstream Codex changes the contract.
6. **Multi-room scalability**: Multiple CCM rooms and multiple Codex sessions can run independently with worktree isolation and no daemon bottleneck.
7. **Security/UX controls**: Approvals, sandbox/yolo policy, interrupt, stale request handling, and shutdown notices remain deterministic and channel-visible.

If any of gates 1-3 fail, keep App Server as the production driver and prefer the observer-panel path.

## Source Areas to Inspect

- Codex CLI source tree: turn submission, TUI event loop, session persistence, approval handling, slash command dispatch, goal/memory feature implementation, and app-server harness boundary.
- Current CCM Codex driver: `agents/codex/app-server-driver.ts`.
- Current CCM Agent SPI: `agents/types.ts` and `daemon.ts` command/event routing.
- Claude Code reference package: `<LOCAL_CLAUDE_CODE_TARBALL>`, especially channel/inbound behavior and how CCM's Claude path maps it into zellij.

## Required Spike Output

Produce a short report that answers:

1. Is a non-paste Codex CLI inbound path available today?
2. Can Codex CLI emit or expose structured lifecycle events comparable to App Server?
3. Where are goal and memory implemented, and can CCM invoke them without reimplementing their behavior?
4. What minimal driver interface changes would be needed in CCM?
5. Which architecture should CCM choose: App Server-only, CLI-native, or App Server plus observer panel?
6. What are the concrete implementation steps and tests if CLI-native is viable?

## Current Recommendation Before Spike

Keep App Server as the production-safe default. Treat CLI-native as a high-value spike, not a committed direction. If Codex source exposes a stable controller/event seam, add `codex-cli-native-driver` behind the existing Agent SPI. If not, invest in a zellij observer panel and keep compatibility commands explicit about not being native App Server APIs.
