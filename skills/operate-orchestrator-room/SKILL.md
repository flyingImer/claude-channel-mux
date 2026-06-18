---
name: operate-orchestrator-room
description: Use when a human or operator wants to set up, inspect, enable, disable, test, or troubleshoot a CCM orchestrator room.
---

# Operate Orchestrator Room

Use this for repeated human/operator tasks around CCM orchestrator rooms.

## Room Flag Commands

Run these in the target Slack CCM room:

```text
/ccm orch status
/ccm orch on
/ccm orch off
```

The long form `/ccm orchestrator status|on|off` is also supported. Plain-message forms such as `ccm orch status` route through the same parser. Ordinary rooms are orchestrator-capable by default: `on` is only needed to re-enable an explicitly-disabled room or to break-glass enable a Worker Room, and `off` explicitly disables a room. `status` reports the source, e.g. `ordinary default-enabled`, `explicitly disabled`, `worker-forced-disabled`, or `worker room, human break-glass enabled`.

## Setup Checklist

1. Bind the room to the intended repo/cwd with `ccm /path/to/repo`.
2. Confirm agent slots with `ccm agents` and set the default if needed with `ccm default claude|codex`.
3. Ordinary rooms are orchestrator-capable by default — no enable step needed. Run `/ccm orch on` only to re-enable an explicitly-disabled room.
4. Ask the Orchestrator to use the `orchestrate-workers` skill.
5. For live worker-room lifecycle tests, use Slack; Telegram V1 returns `unsupported_capability`.

## Slack Capability Checklist

The deployed Slack app needs these scopes for private worker-room lifecycle:

- `groups:write` for private channel create, invite, and archive.
- `groups:read` and `groups:history` for private channel inspection and traffic.
- `users:read` for best-effort member filtering.
- Normal CCM scopes such as `chat:write`, `commands`, `reactions:write`, `files:read`, and `files:write`.

## Operator Verification

Local gate before relying on lifecycle automation:

```bash
bun test test/room-lifecycle-types.test.ts test/slack-room-lifecycle.test.ts test/room-control-daemon.test.ts test/orchestrator-state.test.ts test/orchestrator-runner.test.ts
bun run typecheck
```

Live Slack smoke: create from an orchestrator room, confirm structured create facts, confirm bot presence and invite facts, mark worker output consumed in orchestration state, then archive.

## Troubleshooting

- `policy_error`: the room is explicitly disabled or is a worker-forced-disabled Worker Room (ordinary rooms are orchestrator-capable by default). Re-enable a disabled room with `/ccm orch on`; a Worker Room only becomes a controller through a human break-glass `/ccm orch on`, and worker rooms do not inherit the parent's capability.
- `unsupported_capability`: the adapter does not support V1 lifecycle; do not emulate room creation.
- Slack create/archive fails: check Slack scopes, bot installation, channel naming collision facts, and daemon logs.
- Alias not shown in Slack UI: parser already supports it; update the Slack app manifest only if the displayed slash-command usage hint matters.
