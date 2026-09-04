# G9 first wiring — two HARD-tier hooks (tested 2026-09-01)

## room-path-guard.py (PreToolUse; G1 materials allowlist, enforced)

Room launcher writes a room-local settings file and starts the room with it:

```json
{"hooks": {"PreToolUse": [{"matcher": "Read|Grep|Glob|Edit|Write",
  "hooks": [{"type": "command", "command":
    "CLAUDE_ROOM_ALLOWED_ROOTS=<ROOM_DIR> python3 <THIS_DIR>/room-path-guard.py"}]}]}}
```

`claude -p "$(cat charter.md)" --settings room-settings.json --allowedTools Read Glob Grep Write`
(keep --allowedTools too: defense in depth — tool-level + path-level).

Tested: in-room read allowed (rc 0); out-of-room read blocked (rc 2, reason fed back to
the model); `..` traversal escape blocked (realpath normalization). Fail-open only on
malformed hook input, never on a resolvable out-of-root path.

## deferred-queue-reminder.py (SessionStart; G7 rule 2, enforced)

In the project settings of whichever session owns the queue (orchestrator):

```json
{"hooks": {"SessionStart": [{"hooks": [{"type": "command", "command":
  "python3 <THIS_DIR>/deferred-queue-reminder.py <PROJECT>/deferred-queue.md"}]}]}}
```

Every boot injects all non-done entries (name, status, trigger) into context. A missing
queue file prints a loud NOT FOUND line instead of silence (a broken wiring must not
look like an empty queue). Tested against the exp-b reference entry.

## Derivation note (T-layer, the orchestrator's lane)

Installing these into the tag orch project settings and the tag room launcher is
instance work — it rides with the exp-b derivation or its own directive. This dir only
ships the generic scripts + wiring recipe. Next candidates per G9 mapping: Stop-hook
report validator, mirror-freshness PreToolUse guard, push-time leak-scan guard.

## outbound-gate.py (v2, 2026-09-04) — G9 HARD: no public-facing action without a close-out record
PreToolUse on Bash. Env: CLAUDE_OUTBOUND_MANIFEST=/abs/manifest.json (effort-derived: public
command patterns, close-out dir, optional ref_cmd, owner override token path, correction log).
Install in every room that can push/create PRs (orchestrator rooms included). Self-test: see
CHANGELOG-G.md v2 (5 cases: non-public allow / public block / record allow / token allow+log /
missing manifest block).
