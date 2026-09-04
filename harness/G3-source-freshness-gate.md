# G3 — Source-freshness gate (generic worker-room harness mechanism, DRAFT for the owner)

Status: draft v1, 2026-09-01. Layer: GENERIC.
Provenance: tag mirrors sat at doc v1161 while the live doc was v1188, and a second
source of truth (the public contract doc) was never mirrored at all — internal rooms
judged from stale contracts while externally-fed judges got live ones (exp-a round 2/3).

## Rules

1. **Registry.** Every mirrored external source of truth has a fingerprint entry: source
   id, mirror path(s), pinned version + modified-time, pin date, and the exact check
   command. (Tag precedent: docs/inputs/spec-fingerprint.md — generalize that shape.)
2. **Check before judging.** Any room about to render verdicts against a mirrored
   contract verifies the fingerprint first (run the check command, or consume a
   freshness marker the orchestrator refreshed this session). Stale => fetch live or
   refresh the mirror BEFORE judging; judging from a known-stale mirror is a protocol
   violation, not a shortcut.
3. **Register at discovery.** A newly discovered source of truth (a second doc, a
   linked sheet) is registered the moment it is discovered — an unregistered source is
   how the public contract doc went unmirrored for a week.
4. **Staleness is loud.** A failed or impossible check is reported, never bypassed
   silently.

## Tier mapping (per G9)

- BOOT: orchestrator injects freshness state at room launch (marker file with age).
- HARD upgrade: PreToolUse guard on mirror paths blocks reads when the marker is stale
  (candidate #3 in hooks/README's next list).
