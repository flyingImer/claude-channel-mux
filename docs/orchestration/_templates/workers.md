# Worker State Index

| Worker Task ID | desired_room_name | Runtime | State | Branch/Worktree | Room ID | Capture ID | Output Consumed | Archive State | Next Action |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `<worker_task_id>` | `<desired-room-name>` | `<claude|codex>` | `planned` | `<path-or-branch>` | `<room-id-or-empty>` | `<capture-id-or-empty>` | `no` | `not_requested` | `<next action>` |

## State Vocabulary

`planned` -> `room_intent_recorded` -> `room_init_started` -> `room_ready` -> `task_sent` -> `attention_needed` -> `reported` -> `captured` -> `consumed` -> `archive_requested` -> `archived`

Terminal alternatives: `rejected`, `abandoned`, `failed`, `unsupported_capability`, `cleanup_failed`.
