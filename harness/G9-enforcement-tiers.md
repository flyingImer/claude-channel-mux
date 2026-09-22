# G9 — Enforcement tiers (generic worker-room harness mechanism, DRAFT for the owner)

Status: v2.11, 2026-09-22 (v2.10 2026-09-22; v2.9 2026-09-22; v1 draft 2026-09-01; v2.1
2026-09-04). Layer: GENERIC.

## The problem (the owner's diagnosis, confirmed)

Most of this harness rides on files plus the HOPE that sessions read and follow them.
PR2 proved that hope fails. Files are the right substrate for CONTENT and PROVENANCE;
they are the wrong substrate for CONTROL.

## Tier model

Every rule in G1-G8 (and future mechanisms) declares one of three tiers:

- **HARD** — deterministic, the model cannot bypass. Claude Code primitives:
  - PreToolUse hooks: run before a tool call; can BLOCK it (a path-guard can refuse a
    Read/Grep outside a room's allowlist, a push-guard can refuse git push until a leak
    scan passes).
  - Stop hooks: can refuse to let a session finish until a validator passes (e.g. audit
    report missing its enumeration tables => not done).
  - SessionStart hooks: inject context unconditionally at boot (due deferred-queue
    entries, freshness state) — no reliance on the session thinking to look.
  - Permission rules (settings.json allow/deny) and --allowedTools at room launch:
    tool- and path-level sandboxing (exp-a used allowedTools; it held perfectly while
    the prompt-level denylist needed a post-hoc transcript check).
- **BOOT** — injected at launch, model-followed but always present: launcher-composed
  room prompts (charter text), CLAUDE.md auto-load, skills that trigger on match,
  plugin packaging so every room gets the same skills/hooks (CCM plugin is the
  precedent and the generalization target).
- **CONTENT** — files consumed as material. Valid for evidence, charters' row bodies,
  reports, queues' payloads. NEVER for control-critical steps.

Rule of thumb: if skipping the step must be impossible, it is HARD; if forgetting the
step must be impossible, it is at least BOOT; only what may legitimately be judged or
deferred stays CONTENT.

## Mapping of existing mechanisms (proposed wiring)

- G1 blind-room materials allowlist: HARD — launch with --allowedTools + a PreToolUse
  path-guard hook scoped to the room dir (upgrades exp-a's purity from post-checked to
  enforced).
- G1 coverage proof / report structure: HARD — Stop-hook validator (structural check of
  findings.md sections/tables).
- G3 source-freshness gate: HARD — PreToolUse guard on mirror paths (blocks reads when
  the fingerprint marker is stale, instructs live fetch); SessionStart freshness banner.
- G7 reminders: HARD — SessionStart hook injects due/overdue entries into every
  orchestrator session; watchdog tick as backstop. (This is the direct fix for
  "寄希望于 session 及时参考", the PR2 failure mode.)
- Leak scan on outbound: HARD — PreToolUse guard on push/PR-create Bash commands.
- G2 ruling backflow: SEMI — PostToolUse validator on decision-store edits flags a
  ruling without a queue entry (heuristic; final judgment stays human).
- G6 packing quality, charter sweep quality: CONTENT + review — judgment, not hookable;
  this is what audits and scoring are for.

## Staging

1. First wiring (cheap, one script each): blind-room path-guard + deferred-queue
   SessionStart reminder. Validate on the next audit room and next orch session.
2. Package generic-harness as a Claude Code plugin (hooks + skills + agent defs) so
   every room inherits enforcement without per-room setup; converge with the CCM plugin
   per the approved generalization path.
3. Each later G-rule lands WITH its tier declared and its hook (if HARD) in the same
   change.

## v2 additions (2026-09-04)

- G1 severity floor + reconciliation completeness: HARD — the audit-report validator
  (Stop hook on audit rooms; PostToolUse on the reconciliation close-out file) rejects
  (a) a finding citing a contract clause with severity nit, (b) a close-out with any
  finding lacking a disposition line, (c) a PLAUSIBLE contract-cited finding disposed
  without CONFIRMED/REFUTED. Script: hooks/audit-report-validator.py (to land with the
  next audit room; until then BOOT — the rule text is injected into the room task).
- Outbound gate: HARD — hooks/outbound-gate.py (PreToolUse on Bash). Blocks any command
  matching the effort's declared PUBLIC patterns (push to a PR-backed branch, PR create,
  doc publish) unless a close-out record exists for the outbound ref that names the
  audited base, the dispositioned findings, and the delta-only-fixes verification. An
  owner override token file allows the action and appends a correction event. The
  script is generic; the effort derives the manifest (patterns, record dir, token path).
  (v2.8 correction) Since v2.3 the daemon composes this hook into every room and the
  script resolves the manifest from the room's own harness dir (`<harness dir>/
  outbound.json`); nothing is installed per room by hand, and v2.1-era wiring in a repo's
  `.claude/settings.json` must be removed (it runs the hook twice). A repository hosting
  two efforts needs no shared manifest: each room resolves its own. Only an owner session
  outside any room falls back to `CLAUDE_OUTBOUND_MANIFEST`; set it to a union manifest or
  leave it unset. Provenance: two efforts in one repo merged manifests for a constraint
  that no longer existed (2026-09-04).
- G0 inheritance: BOOT — a generic version bump lands in each effort's deferred queue
  via its intake channel; the SessionStart reminder surfaces it until derived.
- (v2.1) hooks/audit-report-validator.py LANDED: Stop hook on audit rooms
  (CLAUDE_AUDIT_FINDINGS=<findings path>) and close-out mode for reconciliation. First run
  on the seeding project's v12 audit flagged 8 of 15 "nit" findings as contract-cited
  (F6-F12, F20): the severity gap was systemic, not two items.
- (v2.1) harness-sync.sh: BOOT — SessionStart in every effort; explicit via /harness-refresh.
  (v2.8 correction) Since v2.3 the daemon composes the SessionStart check into every room and
  files version-bump intakes itself; repo-level wiring is only for owner sessions outside rooms.
- (v2.3) Charter class isolation: HARD — the audit-room launcher loads only rows whose
  `class:` equals the room's class and refuses rows without a class (script:
  hooks/charter-select.py; BOOT until it lands with the next audit room).

- (v2.4) Audit-room model pin: HARD — `launch-audit-room.sh` exits 2 without `--model`; the
  chosen model is written to run-meta/launch.json so the audit report's cost line can be
  verified. Provenance: three blind-audit revisions ran unpinned on the global default.
- (v2.4, revised v2.5) Subagent model / prompt-cache TTL are OWNER POLICY: they live in the
  owner's user settings.json (env block), which the launcher wrapper passes into every room;
  neither CCM nor the wrapper restates them. Layering rule: wrapper = transport (proxy, auth,
  aliases, sandbox); user settings = policy; CCM = room lifecycle; launcher = one-shot room.

- (v2.5) Single launcher binary: BOOT — the daemon forwards CLAUDE_BIN into every room's
  settings env and into every watchdog unit; harness scripts (audit-room launcher,
  watchdog one-shots, any `-p` call) invoke `${CLAUDE_BIN:-claude}`, never a bare `claude`.
  Rationale: the launcher wrapper is where proxy routing, model aliases and prompt-cache
  TTL live; a bare `claude` silently escapes all three. Provenance: a seeding project's
  watchdog one-shots ran outside the wrapper for three weeks.

- (v2.6) Derived-files rule (G0 step 6): T1 — the daily REVIEW flags any instance harness
  file whose latest change cites no generic version or derivation note in its provenance
  line; the fix is a deviation entry plus re-derivation, never a local patch.
- (v2.6) Validator additions (hooks/audit-report-validator.py): HARD — (a) RULED-BEFORE
  lines without a `premise:` token are rejected (G1 reconciliation rule 4); (b) a
  close-out without a `standards-lint:` line is rejected (rule 6); (c) finding ids of the
  form `F-<n>` parse like `F<n>` (a seeding project's close-out had to be checked by hand).
- (v2.6) Directive delivery receipt: BOOT — a directive or kickoff counts as delivered only
  when the receiving room's transcript shows it as a user turn; the sender re-delivers
  once verbatim if it is absent after a bounded wait and records a deviation. Before
  rotate_orchestrator, the kickoff must be present in the successor's transcript.
  Provenance: a prompt-blocking plugin hook dropped three worker directives and one
  orchestrator kickoff without any error reaching the sender (2026-09-04..06).
- (v2.6) Generated artifacts are validated before use: BOOT — a watchdog that regenerates a
  file from a model call (exam, digest) checks the body for the expected shape and keeps
  the previous file on failure. Provenance: an exam regeneration accepted a hook-error
  body as a valid exam (2026-09-06).

- (v2.7) Outbound gate v3: HARD — patterns match the command surface (heredoc bodies removed,
  whitespace-bearing quoted strings blanked, pipeline stages tested individually, text-only
  stage heads never match, `git -C <dir>` normalized so nested pushes cannot bypass); the
  outbound ref resolves in the repo the stage acts on (`git -C`, preceding `cd`, push
  `<src>`); records may be named by a >= 12-char sha prefix and the block message prints the
  full sha. Self-test hooks/outbound-gate-selftest.sh. Provenance: two false-positive shapes
  blocked a kickoff file and a legitimate publication (2026-09-04/05); the message's 12-char
  hint could never match; `git -C` pushes never matched at all.
- (v2.7) Expectation sweep: BOOT — every effort watchdog runs hooks/expectation-sweep.sh
  after its ACT/TRIAGE passes; a changed status file matching any expectation glob is an
  EVENT (triaged like TRIAGE), whatever its name. Provenance: an expectation was satisfied
  silently by a file whose name matched neither regex (2026-09-04).
- (v2.7) Audit tiers default (G1 rule 7): BOOT — code class at the orchestrator tier,
  submission class one tier below; effort launch recipes derive both; owner override per
  effort. Trial ruling 2026-09-08.

- (v2.8, trial) Watchdog template: BOOT — `harness/watchdog-template.sh` is the one Tier-0
  watchdog; an effort's `watchdog.sh` becomes a two-line wrapper that execs the template
  with the effort's `watchdog.conf` (see `harness/watchdog.conf.example`). Built in: the
  expectation sweep (v2.7), exam-body validation before replacement (v2.6), a last-seen stamp
  that persists across restarts (events during a daemon restart are no longer aged out), a
  run lock, `${CLAUDE_BIN:-claude}` for every one-shot, no PATH shim (the unit carries PATH).
  `WATCHDOG_ONCE=1` runs one cycle for derivation smoke checks. Provenance: three effort
  copies of one script had diverged (66 and 53 differing lines) and every fix needed three
  derivations; the v2.7 sweep was wired three different ways in one afternoon.

## v2.9 additions (2026-09-22) — G10 (new): orchestrator lifecycle discipline

G1-G9 govern rooms; none of them governed the standing coordinating room's own
continuity (wait, rotate, boot, hold, restart, save-game). G10 is that missing
mechanism; this bump wires its rules:

- (G10 rule 1) Owner-wait discipline: BOOT — injected into the coordinating room's
  standing rules digest at boot/rotation. Not mechanically blockable (arming a watch is
  a tool call the room itself chooses to make or not), the same category as G6 packing
  quality: judged, not hooked. Provenance: 17h of owner silence cost 210/251 calls (77%
  of weighted tokens) to three staggered 30-min watches.
- (G10 rule 2) Rotation floor: HARD (mechanical) / BOOT (wiring) — `hooks/
  rotation-preflight.py` reads the coordinating room's transcript, prints context, exits
  non-zero below the soft ceiling unless an exception marker (created only after a
  decision-log entry) is present. The rotation procedure must run it and quote the
  output; until it is wired as a blocking gate on the rotation action itself, the
  requirement to run + quote it is BOOT (procedure text). Self-test: hooks/
  rotation-preflight-selftest.sh. Provenance: three rotations at ~70-80% of the ceiling,
  each citing "quiet boundary" alone.
- (G10 rule 3) Successor boot tiering: BOOT — kickoff file structure (tiered read order)
  injected at every rotation; the successor's own context-at-checkpoint line in its
  takeover record is the receipt, checked by the next REVIEW, not by a hook. Provenance:
  boot context at a fixed early checkpoint trending up generation over generation before
  any work began.
- (G10 rule 4) Hold-cycle duties: BOOT — report-format rule (non-blocking owed items
  re-listed; pending decisions re-fetched live, never inferred from a stale reply count).
  Provenance: 17h of an unchanged "nothing to do" line beside five unmentioned owed
  items, and a decision edited in place that a stale count called untouched.
- (G10 rule 5) Planned-restart hygiene: BOOT — restart-checklist step (stop background
  watches before a KNOWN restart). Provenance: the double-recache failure measured only
  in rooms whose first post-restart turn was self-started.
- (G10 rule 6) Save-game hygiene: HARD (mechanical) / BOOT (wiring) — `hooks/
  save-game-validator.py` fails a checkpoint when the save-game's first line grew since
  the last passing check or the file exceeds its size cap (default 32768B; propose per
  instance from its own healthy/pathological numbers). A rejected checkpoint leaves the
  validator's state at the last-good length. Self-test: hooks/
  save-game-validator-selftest.sh. Provenance: line-1 accumulation of tens of KB per
  rotation, one measured instance reaching 87KB on line 1 of a 112KB file (healthy
  baseline ~10KB).
- (G10 rule 7) Takeover exam removed: HARD by omission — `harness/watchdog-template.sh`
  v2.9 carries no exam-generation code path; the rotation/kickoff procedure text carries
  no exam-answering step. The independent ground-truth re-derivation step is unaffected
  and stays in the rotation procedure. Provenance: the self-graded exam scored a perfect
  result in most sampled rotations, was skipped in the rest, and never caught a
  divergence in its measured lifetime.
- (G10 rule 8 / G4 inbox-touch check) Decision-packet SLA + learning-loop check: BOOT —
  `harness/watchdog-template.sh` v2.9 runs both unconditionally every cycle: `#decision=`
  rows escalate once past `DECISION_SLA_HOURS` unless answered; the daily REVIEW step
  escalates once if the configured correction-event inbox's mtime has not advanced since
  the previous REVIEW. Provenance: a 17h unanswered decision with no escalation; an
  inbox untouched 12 days while 7 lessons were recorded elsewhere.

Not taken in this bump (recorded, not silently dropped): daemon-side MCP trimming — out
of this layer's scope (daemon composition, not room/orchestrator procedure) and not
measured by any of the nine items above. A task-notification size guard — the
measurement behind it turned out to be an artifact of the owner-wait watch duplication
(item 1), not an independent problem; fixing item 1 removes the signal that motivated
it, so a separate guard would have no measured target left.

## v2.10 additions (2026-09-22) — G0: derivation receipts

- (v2.10) Derivation-receipt rule: T1 — the daily REVIEW re-scans every derivation note
  written since the previous review with `hooks/derivation-check.py NOTE VERSION`
  against the CHANGELOG-G.md version section the note claims to derive. A note that
  closes a hook-bearing item without a `receipt:` line for that hook (the script's path
  as wired, the command run, its exit code, one quoted output line), or that carries an
  undated deferral for one, or that restates a threshold/policy the generic rule under
  derivation has superseded, is a T1 deviation. Fixed by a follow-up derivation note that
  supplies the missing receipt, never by editing the flagged note in place (same
  non-hand-edit discipline as the G0 step-6 mapping above). Script:
  `hooks/derivation-check.py` (parses hook-bearing items out of a named CHANGELOG-G.md
  section; exit 2 lists the missing receipts; exit 3 when the note or the section cannot
  be read — fail loud, never a silent pass). Self-test:
  `hooks/derivation-check-selftest.sh` (a receipted note passes; a note in the "already
  as policy" / "record item" shape, with no receipt, fails and names the missing hook).
  Provenance: the derivation-quality gap observed at the first intake of this harness's
  own previous bump (see CHANGELOG-G.md v2.10) — three hook-bearing items closed on
  disposition words and undated deferrals, none receipted.

## v2.11 additions (2026-09-22)

- (v2.11) Save-game prepend detection (G10 rule 6, refined): HARD/BOOT — unchanged tier;
  `hooks/save-game-validator.py` now fails only when the last passing line 1 (or its
  leading 200B) is found verbatim at a positive offset inside the new line 1 — old
  content sitting BEHIND new text, the actual signature of a prepend. A whole rewrite
  that is merely longer, with no old text reused deeper in the line, now passes. Self-test:
  `hooks/save-game-validator-selftest.sh` (adds: a longer whole-rewrite passes; a true
  prepend fails and names the offset; an identical line 1 still passes). Provenance: two
  DEVIATIONS-inbox receipts (2026-09-22) — a legitimate longer rewrite rejected and
  trimmed to pass once, and a second instance of the same false positive on a
  whole-rewrite takeover line, on the same day.
- (v2.11) Outbound gate v4 (generalized public-action detection): HARD — unchanged tier;
  `hooks/outbound-gate.py` no longer relies on the effort's `public_patterns` alone to
  recognize a public action. `git push`, `gh pr create|edit`, and `gt submit` are public
  BY DEFAULT: for `gh pr create|edit`/`gt submit` unconditionally, for `git push` unless
  the resolved remote is a local filesystem path (no `scheme://`, no `user@host:`)
  and — even then — only when the manifest does not flag that specific remote private
  via a new `private_remotes` key. `public_patterns` keeps working as an additional,
  effort-declared match. Self-test: `hooks/outbound-gate-selftest.sh` (adds: a push to a
  non-local https remote with a branch name absent from any manifest pattern still
  gates; a push to a local filesystem path remote does not). Provenance: DEVIATIONS-inbox
  (2026-09-22) — a manifest whose `public_patterns` only named known branch names let a
  push on an unlisted branch through with no close-out record.
- (v2.11, G10 rule 9, new) Shared host-resource isolation: BOOT — judged at directive
  time, the same category as G10 rule 1 (arming a watch is a choice the room makes, not
  something a hook can force); no generic hook exists yet that can tell a legitimate
  resource-specific stop from a host-wide one across arbitrary resource types, so this
  stays BOOT until a lease-file convention is standardized enough to gate on. Receipt: the
  directive names the per-room isolation knob or the lease file for the shared resource it
  assigns. Provenance: DEVIATIONS-inbox (2026-09-22) — one room's routine stop of a shared,
  per-user build daemon killed a second room's running test gate three separate times.
- (v2.11, G10 rule 10, new) Time-sensitive state travels with the transmission: BOOT —
  directive-authoring procedure text; the property being enforced (absence of a
  bounded-window claim from a file's own text) is not something a static analysis of the
  file alone can certify, since the rule is about which channel carries the live value,
  not about the file's contents in isolation. Receipt: the delivery transmission, not the
  directive file, carries the live value of every time-sensitive fact at send time.
  Provenance: a daily review's tuning proposal (2026-09-22) — a directive file said "run
  nothing until gates free" while the transmission delivering it, sent later, said gates
  were free as of send; the two disagreed and the receiving room had to notice and choose.
- (v2.11) Successor boot tiering clarification (G10 rule 3): BOOT — unchanged tier; the
  rule's existing receipt (context-at-checkpoint in the takeover row) is unchanged. Tier A
  is now stated as exactly four file classes (save-game, head-state, kickoff, log tail);
  contract/spec sections and older head-state items move to index-only, read at the FIRST
  judgment that needs them, named in the kickoff with a "read when <trigger>" note.
  Provenance: a daily review's tuning proposal (2026-09-22) — a successor's boot read
  order opened the full contract/spec text and a large head-state backlog before the
  day's first judgment needed any of it, tracking a multi-generation rise in boot cost at
  a fixed early checkpoint.
- (v2.11) Watchdog burn-row keying: BOOT — template composition, the same tier as the
  v2.8 watchdog template itself; `harness/watchdog-template.sh` keys the `$MET` burn row
  for the coordinating room on that room's own session id (its transcript's filename),
  read live from the `#orch_transcript=` row every cycle, instead of a fixed "orch" label
  that spans every generation. `WATCHDOG-TEMPLATE.md` and `watchdog.conf.example` also
  now say an instance's own scorecard must drop any row reporting the takeover exam,
  since that instrument carries no code path as of v2.9. Tested: `bash -n` clean, plus a
  `WATCHDOG_ONCE=1` smoke cycle against a fixture transcript confirming the metrics row
  is keyed by the transcript's own name, not the literal string "orch". Provenance: a
  daily review's tuning proposal (2026-09-22) — a burn-row label spanning every
  generation read as a flat, uninformative figure, and a scorecard kept reporting a row
  for an instrument already removed.

Not taken in this bump: a mechanical hook for G10 rule 9 (shared host-resource
isolation) — no receipt yet exists for what a generic lease-file convention should look
like across resource types (a build daemon and a port are not interchangeable), so
writing a hook now would be guessing at a shape; revisit once an instance derives a
concrete lease convention and the guess can be checked against it.
