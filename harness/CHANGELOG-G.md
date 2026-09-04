# Generic-harness changelog (versions apply to the whole directory; per-doc Status lines match)

## v2.3 — 2026-09-04
- G2: row schema gains `class:` (code | spec | submission); class isolation rule (rooms load
  rows by class, mechanically); pass conditions never from author-authored text; taste-seeded
  submission rows are provisional until an audience receipt. G1 rule 3 and G9 updated.
  Provenance: the seeding project's first submission-class derivation (four rows planned into
  the code-conformance room; a code row accepting "named in PR body" as a pass) — doc gaps
  per G0 ("systematic misses convict the doc"), fixed as rules.

## v2.2 — 2026-09-04
- Moved into claude-channel-mux (`harness/` + `hooks/` + `skills/harness-refresh`); the standalone
  repo is now a symlink. Owner ruling: "this was always meant to be the CCM worker-room harness".
- Convention `<cwd>/.ccm-harness/<name>/` = the harness instance dir (no pointer files). Binding
  field `harness` (like `orchestrator`): set at creation (parent inheritance or single candidate),
  never inferred at read time; `/ccm harness [name]` shows/sets live; startup backfill for legacy
  bindings; daemon materializes STATE_DIR/harness/<session>.json for hooks; SessionStart +
  PreToolUse(Bash) hooks wired by the daemon for every room. 531/531 CCM tests pass.
- Watchdog ownership: a watchdog spawned from a room dies with the room (observed 2026-09-04,
  all three efforts). Now DAEMON-OWNED: the daemon computes one watchdog per harness dir referenced by any binding
  and runs it as a systemd --user transient unit (Restart=always), reconciled at startup, after
  /ccm harness, and every 5 min; retired harnesses are stopped; edited watchdog.sh restarts.
  (harness/systemd/ template kept for non-daemon hosts.)
- Blind audit rooms are harness-agnostic (they only see their room dir); the launcher copies
  charter excerpts in. Outbound gate fails open with a warning until the effort derives
  `outbound.json` (migration).

## v2.1 — 2026-09-04
- Source of truth moved to its own git repo (this dir); effort copies replaced by symlinks.
- G0: single-source + automatic refresh (harness-sync.sh --check in SessionStart) + explicit
  refresh (/harness-refresh) + ownership after scaffolding (disposable GENERIC-REVISION room,
  inbox threshold 5 or owner's word). Provenance: owner ruling 2026-09-04 ("脚手架要拆").
- G9/hooks: audit-report-validator.py landed (severity rubric + close-out completeness);
  on tag v12 findings it flags 8/15 nits as contract-cited.

## v2 — 2026-09-04
Owner rulings 2026-09-04 (four approved), landed generically with portability notes:
- G0: versioning + inheritance protocol (sealed copies do not self-update); enumerate-ALL-
  G-docs on any intake; portability test for entering the generic layer.
- G1: severity rubric (derived from receipt; contract-cited => >= should-fix); reconciliation
  stage as a mechanism (PLAUSIBLE contract-cited must be resolved; severity orders, never
  removes). Provenance: the seeding project, revision 12 F12/F9 graded nit and skipped; external judge graded blocker.
- G2: seed-row library (concurrent-same-identity-writers; precedent-shape-parity replacing
  smell catalogs; pointers to the other generic-worded rows); new artifact class submission-
  to-an-audience with judge role, materials, audience-ground-truth seeding rule, 4 seed rows,
  once-per-candidate cadence. Provenance: external round 2 on the seeding project, revision 13 (D, F).
- G9: tiers for the above; hooks/outbound-gate.py (generic, manifest-driven, owner override
  logged as correction event), self-tested 5/5.
Adopting efforts: tag (source), a second adopting effort, a third adopting effort. Each derives the delta per G0 §Versioning and records the version.
Not in v2 (still in DEVIATIONS-inbox): bwrap-invisible sessions in fleet discovery; nested-
worktree cwd; plan-mode refuter prompts; CCM rooms cannot publish Artifacts; watchdog flock.

## v1 — 2026-08-31 .. 2026-09-01
G0-G9 drafts; hooks room-path-guard.py, deferred-queue-reminder.py.
