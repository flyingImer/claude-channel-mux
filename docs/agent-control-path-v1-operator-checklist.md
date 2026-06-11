# Agent Control Path V1 Operator Checklist

Use this checklist before relying on CCM Agent Control Path worker-room lifecycle automation.

## Scope

- V1 lifecycle operations are exactly `create_room_with_bot_invited` and `archive_room`.
- Slack is the only V1 platform with room create/archive behavior.
- Telegram returns a structured `unsupported_capability` result for both lifecycle operations.
- Lifecycle calls must originate from a CCM room whose binding has `isOrchestrator: true`.
- Worker rooms do not inherit `isOrchestrator` from the parent/orchestrator room.

## Slack App Capabilities

Confirm the Slack app has enough bot scopes for the deployed workspace:

- `groups:write` for private channel creation, invites, and archive operations.
- `groups:read` and `groups:history` for private channel inspection and room traffic.
- `users:read` for member profile filtering before best-effort invites.
- Existing CCM messaging scopes such as `chat:write`, `commands`, `reactions:write`, `files:read`, and `files:write` remain required for normal operation.

If the deployed Slack manifest is missing `groups:write`, update/reinstall the Slack app before live lifecycle verification.

## Expected Create Behavior

For `create_room_with_bot_invited`:

- CCM Core creates a private Slack room with the Orchestrator-provided `desired_room_name`.
- CCM Core ensures the CCM bot is present or reports the bot invite fact.
- CCM Core best-effort invites same-workspace ordinary parent-room members.
- CCM Core reports skipped invite facts for bot users, external users, deactivated users, profile lookup failures, existing membership, and invite failures.
- CCM Core reports existing or archived channel facts but does not decide whether to adopt, reject, repair, or suffix a room name.

## Expected Archive Behavior

For `archive_room`:

- CCM Core calls Slack archive for the supplied platform-local room id.
- The Git-backed Orchestrator decides when archive is allowed.
- The implemented Orchestrator state requires worker output to be marked consumed before archive can be requested.

## Verification

Run local verification first:

```text
bun test test/room-lifecycle-types.test.ts test/slack-room-lifecycle.test.ts test/room-control-daemon.test.ts test/orchestrator-state.test.ts test/orchestrator-runner.test.ts
bun run typecheck
```

For live Slack verification, use a safe test workspace and an orchestrator room with `isOrchestrator: true`. Confirm that create returns structured facts, Telegram returns `unsupported_capability`, and archive runs only after the Orchestrator has consumed worker output.
