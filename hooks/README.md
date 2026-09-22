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
Install in every room that can push/create PRs (orchestrator rooms included). Self-test:
`hooks/outbound-gate-selftest.sh` (v3, 2026-09-08: heredoc/grep/commit-message mentions allow;
push blocks with the full sha; `git -C` and `cd`-prefixed pushes match and resolve the nested
repo; quoted refspecs match; a >= 12-char prefix record admits only its own repo) plus the
original 5 cases in CHANGELOG-G.md v2.

## expectation-sweep.sh (v2.7) — G9 BOOT: a satisfied expectation is an event
Called by the effort watchdog after its ACT/TRIAGE passes:
`expectation-sweep.sh STATUS_DIR STAMP EXPECTATIONS_TSV ACT_RE TRIAGE_RE` prints
`<file>\t<expectation id>\t<note>` for each changed status file that matches an expectation
glob but neither regex; the watchdog triages each line as it would a TRIAGE file.

## rotation-preflight.py (v2.9) — G9 HARD/BOOT: G10 rule 2, rotation floor
`rotation-preflight.py TRANSCRIPT_JSONL --floor N [--exception FILE]` reads the
coordinating room's own transcript, prints its current context, and exits non-zero below
the floor unless an exception marker (created only after the owner's exception is
recorded in the decision log) is present. The rotation procedure runs this and quotes the
line; a missing/unreadable transcript fails loud (exit 3), never a silent pass. Self-test:
`hooks/rotation-preflight-selftest.sh` (above-floor pass, below-floor fail, below-floor
with exception marker warns-and-passes, unreadable transcript fails loud).

## save-game-validator.py (v2.9) — G9 HARD/BOOT: G10 rule 6, save-game hygiene
`save-game-validator.py SAVE_GAME STATE_FILE [--cap-bytes N]` fails a checkpoint when the
save-game's first line grew since the last passing check (the signature of a
predecessor's paragraph being prepended instead of archived) or the file exceeds its size
cap (default 32768B). A rejected run leaves STATE_FILE at the last-good length. Self-test:
`hooks/save-game-validator-selftest.sh` (first checkpoint passes, stable length passes,
line-1 growth fails without corrupting state, oversize file fails, missing file is a
no-op pass).

## Decision-packet SLA + inbox-touch check (v2.9) — G10 rule 8 / G4, in the watchdog template
Not separate hook scripts: both live in `harness/watchdog-template.sh` itself so they run
every cycle unconditionally. See `harness/WATCHDOG-TEMPLATE.md` and
`harness/watchdog.conf.example` (`DECISIONS_DIR`, `DECISION_SLA_HOURS`,
`DEVIATIONS_INBOX`).
