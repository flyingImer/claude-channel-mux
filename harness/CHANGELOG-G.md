# Generic-harness changelog (versions apply to the whole directory; per-doc Status lines match)

## v2.10 — 2026-09-22
- **G0: derivation receipts.** An intake item that ships a hook/script/validator is
  derived only when the derivation note carries, for that instance, a receipt: the
  script's path as wired, the command run, its exit code, and one quoted output line.
  "Already covered", "already as policy", "in spirit", and "record item" are not valid
  dispositions for a hook-bearing item; a deferral must name a dated trigger and is
  re-checked at the next daily REVIEW. A derivation whose instance text contradicts the
  generic rule it derives from (e.g. restating a superseded threshold) is not derived
  regardless of receipt. Non-mechanical items keep the existing protocol step-3 rule.
- **G9**: T1 deviation for a derivation note that closes a hook-bearing item without a
  receipt; the daily REVIEW re-scans every derivation note written since the last review
  with the checker below.
- `hooks/derivation-check.py` (+ `hooks/derivation-check-selftest.sh`): `NOTE VERSION
  [--changelog PATH]` — parses the named CHANGELOG-G.md version section for items naming
  a `hooks/*.py`, `hooks/*.sh`, or `watchdog-template.sh`, and checks the derivation note
  for a matching `receipt: <path> | <command> | rc=<n> | <quoted output>` line per hook.
  Exit 0 when every hook-bearing item has one, exit 2 listing the missing items, exit 3
  when the note or the version section cannot be read (fail loud, never a silent pass).
  `python3 -m py_compile` clean; self-test covers a receipted note (exit 0) and a note in
  the "already as policy" / "record item" shape (exit 2).
- Not taken in this bump: nothing else. The v2.9 observation window — whether the eight
  G10 items actually reduce owner-wait cost and rotation-boot growth — is still running;
  this bump does not touch it.
- Provenance: the derivation-quality gap observed at the first intake of the v2.9 bump —
  three hook-bearing items closed with a disposition word and an undated "record item"
  deferral instead of a receipt, one of them restating a threshold number that the rule
  it was deriving from does not use.

## v2.9 — 2026-09-22
- **G10 (new): orchestrator lifecycle discipline.** G1-G9 governed rooms; nothing governed
  the standing coordinating room's own continuity (wait, rotate, boot, hold-cycle,
  restart, save-game). Eight rules, each with a receipt, a forbid, an origin and an
  overfit check:
  1. Owner-wait discipline — at most one merged watch while blocked; a wake only re-arms.
  2. Rotation floor, enforced — ceiling AND quiet boundary, never boundary alone; owner
     exception recorded before an under-floor rotation. `hooks/rotation-preflight.py`.
  3. Successor boot tiering — save-game + head-state + kickoff + log-tail read in full;
     everything else on demand; context-at-checkpoint recorded in the takeover row.
  4. Hold-cycle duties — non-blocking owed items re-listed every hold cycle; pending
     decisions re-fetched live, never inferred from a reply count.
  5. Planned-restart hygiene — stop background watches before a KNOWN restart; unplanned
     restarts are exempt.
  6. Save-game hygiene — rewritten whole, never appended; predecessor's sign-off archived
     as a log row, never prepended. `hooks/save-game-validator.py`.
  7. Takeover exam removed — zero measured catches, cut from the rotation procedure and
     the watchdog; the independent ground-truth re-derivation step is kept.
  8. Decision-packet SLA — watchdog escalates an unanswered owner decision packet past a
     configured hour count, keyed to the packet's own id.
- **G4**: inbox-touch check — daily REVIEW escalates once if the correction-event inbox's
  mtime has not advanced since the previous REVIEW (the second half of item 8's origin).
- **G9**: v2.9 additions section maps all of the above to tiers; two items explicitly
  logged as NOT taken (see G9) rather than silently dropped.
- `harness/watchdog-template.sh`: exam-generation code path removed entirely (no
  EXAM_SOURCES/EXAM_MIN_* keys, no `${CLAUDE_BIN:-claude}` exam call); decision-packet SLA
  step added (`#decision=` rows); daily REVIEW gains the inbox-touch check.
  `harness/watchdog.conf.example` and `WATCHDOG-TEMPLATE.md` updated to match.
- New hooks (each `python3 -m py_compile` / `bash -n` clean, with its own self-test):
  `hooks/rotation-preflight.py` + `hooks/rotation-preflight-selftest.sh`,
  `hooks/save-game-validator.py` + `hooks/save-game-validator-selftest.sh`.
- Not taken in this bump: daemon-side MCP trimming (out of this layer's scope; not
  measured by any of the eight items); a task-notification size guard (the "+500k per
  notification" figure behind it was a measurement artifact: per-call context deltas
  computed across zero-usage resume entries; no oversized notifications were found).
- Provenance: 19 orchestrator generations of one effort's own operating data (owner-wait
  cost, rotation timing, boot-context trend, hold-cycle reports, restart failure mode,
  save-game growth, exam hit rate, decision-SLA and inbox-freshness gaps); owner-approved
  2026-09-22. No instance directory touched by this bump — G-docs and hooks/watchdog
  template only; effort instances re-derive per G0.

## v2.8 — 2026-09-08
- harness/watchdog-template.sh + watchdog.conf.example + WATCHDOG-TEMPLATE.md (trial): one generic
  Tier-0 watchdog; efforts keep a two-line watchdog.sh wrapper and a conf. Adds a restart-safe
  last-seen stamp, exam-body validation (v2.6 rule), the expectation sweep (v2.7), a run lock,
  WATCHDOG_ONCE for smoke checks. Tested: events, triage, sweep, context fold, deadline, check,
  review, exam reject/accept (stub LLM).
- G9 corrections: Status line to v2.8; outbound-gate and harness-sync entries now describe the
  v2.3+ daemon composition (no per-room install, remove v2.1 repo wiring, no shared manifest for
  two-effort repos; owner sessions outside rooms use CLAUDE_OUTBOUND_MANIFEST or nothing).
- Provenance: DEVIATIONS-inbox 2026-09-04 (shared manifest; G9 text stale) and the three
  diverging watchdog copies observed 2026-09-08.

## v2.7 — 2026-09-08
- hooks/outbound-gate.py v3: command-surface matching (heredoc bodies, whitespace-bearing
  quotes, per-stage, text-only heads excluded, `git -C` normalized); ref resolved in the
  acted-on repo and from the push `<src>`; sha-prefix records; full sha in the block message.
  hooks/outbound-gate-selftest.sh (11 cases).
- hooks/expectation-sweep.sh + G9 rule: a status file matching an expectation glob is an event
  regardless of name (effort watchdogs wire the call on derivation).
- G1 rule 7: default audit tiers (code = orchestrator tier, submission = one below); owner
  trial ruling 2026-09-08.
- G2: lifecycle-parity (create/purge) promoted to a full seed row with its scope template.
- Provenance: DEVIATIONS-inbox entries 2026-09-04/05 (two efforts) and the v2.6 round record.

## v2.6 — 2026-09-08
- G0 step 6: derived files are never hand-edited; changes travel inbox -> generic -> re-derive.
  G9 T1 flag on instance edits without generic provenance. Provenance: instance-side boundary
  clause (2026-09-04) that the next audit's escape (2026-09-06) traced back to.
- G1 rule 4: concurrency claims need a MECHANISM receipt (lock / isolation / CAS / uniqueness);
  a transaction boundary is not one.
- G1 reconciliation rules 4-6: RULED-BEFORE carries the ruling's premise and whether the
  finding attacks it (else QUESTION-TO-OWNER); serializability refutations must survive an
  observer request consistent with real-time order; project-standards lint slot with a
  `standards-lint:` close-out line.
- G2 rule 6: library-row inheritance (state travels with the seed; owner nods once at the
  library). Seed-row states recorded. concurrent-same-identity-writers boundary clause
  rewritten to the observer form. stated-claims-vs-code promoted to a full seed row
  (second domain: a second adopting effort). Submission seed (e) series-consistency.
- G9: directive delivery receipt (transcript presence; re-deliver once; kickoff verified
  before rotate_orchestrator); generated artifacts validated before use.
- hooks/audit-report-validator.py: `premise:` on RULED-BEFORE; `standards-lint:` line
  required; `F-<n>` ids parse. Self-test: see hooks/README.md (v2.6 cases).
- Provenance: external round on the seeding project's third PR (2026-09-06, one reviewer P1
  the blind audit missed) + DEVIATIONS-inbox entries of 2026-09-04..08 (delivery drops, exam
  regen, library-row states, validator id regex). Not in this bump (CCM lane or effort-side):
  outbound-gate heredoc/ref false positives, watchdog glob-without-wake, unit PATH/SIGPIPE.

## v2.5 — 2026-09-04
- G9: single launcher binary. Daemon forwards CLAUDE_BIN into room settings env and
  watchdog units; launch-audit-room.sh and all harness one-shots use `${CLAUDE_BIN:-claude}`.
  Provenance: watchdog `claude -p` one-shots bypassed the wrapper (proxy, aliases, TTL).

## v2.4 — 2026-09-04
- G1 rule 7 + `launch-audit-room.sh`: audit rooms launch only with an explicit `--model`
  (script refuses otherwise; model recorded in run-meta/launch.json). G9: HARD.
- (reverted same day) daemon restating CLAUDE_CODE_SUBAGENT_MODEL: model policy belongs to the
  user's settings.json, which the launcher wrapper carries into every room; CCM only forwards
  CLAUDE_BIN.
- Provenance: usage audit 2026-09-04 — three blind-audit revisions ran on the global default
  tier because the launcher omitted --model; in-room subagents landed on the room's tier.

## v2.3 — 2026-09-04
- Daemon files the version-bump intake itself (ensureHarnessVersionNotices: per registered
  harness dir, when generic-version is behind, append ONE EVENT to its ESCALATIONS.md,
  idempotent marker). No human or scaffolding session in the refresh loop any more.
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
