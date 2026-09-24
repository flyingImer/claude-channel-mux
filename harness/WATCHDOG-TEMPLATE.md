# Watchdog template (harness v2.12)

One Tier-0 watchdog for every effort: `harness/watchdog-template.sh <watchdog.conf>`.

Derivation (the effort's delta on the v2.9 intake):
1. Write `<harness dir>/watchdog.conf` from `harness/watchdog.conf.example` (STATUS_DIR, ORCH_DIR,
   REVIEW_CMD, budgets, doc names, DECISIONS_DIR/DECISION_SLA_HOURS, DEVIATIONS_INBOX; override
   ACT_RE/TRIAGE_RE only if the effort's status vocabulary differs). Drop any pre-v2.9
   EXAM_SOURCES/EXAM_MIN_* keys — they are inert (G10 rule 7).
2. Replace `<harness dir>/watchdog.sh` with the two-line wrapper shown in the example header. The
   daemon-owned unit keeps running `watchdog.sh`, so the entry point does not change; editing the
   file restarts the unit.
3. Smoke check: `WATCHDOG_ONCE=1 bash watchdog.sh` against a copy of the status dir, or read the
   first cycle's digest lines.
4. Delete the effort's old inline copy; record the derivation note and version.

What the template does per cycle: (1) terminal/ask status files -> ESCALATIONS; (2) confirmation
files -> haiku triage against expectation rows; (3) expectation sweep (any other changed file
matching an expectation glob is an event); (4) deadline sweep; (5) active checks from
`#check=` rows; (6) context budgets + metrics; (7) decision-packet SLA (`#decision=` rows,
G10 rule 8) — escalates once per id past DECISION_SLA_HOURS unless answered; (8) daily REVIEW via
REVIEW_CMD, plus an inbox-touch check (G4) that escalates once if DEVIATIONS_INBOX's mtime has not
advanced since the previous REVIEW; (9) hourly GC with conservation checks. Escalation and digest
line formats are unchanged from the seeding effort's watchdog, so existing readers (orchestrator
Monitors, eval scripts) keep working.

(v2.9) Takeover-exam regeneration is REMOVED (G10 rule 7): the self-graded exam scored a perfect
result in most sampled rotations, was skipped in the rest, and never once caught a divergence in
its measured lifetime. The independent ground-truth re-derivation step it duplicated (the
successor re-verifies live state against the system of record) is NOT in this script — it belongs
to the rotation procedure itself and stays there. Since the instrument is gone, an effort's own
scorecard (REVIEW_CMD's output) must not carry an EXAM-derived row either — a row for an
instrument that no longer runs is dead and reads as if it were still measuring something.

(v2.11) The `$MET` burn row for the coordinating room is keyed on that room's own SESSION id (its
transcript's filename, no extension), read fresh from `#orch_transcript=` every cycle, never on a
fixed role label such as "orch": a label spanning every generation makes one generation's burn
indistinguishable from the next's in the metrics file. This is automatic (no conf key to set) —
whatever session is currently named in the `#orch_transcript=` row is the id that lands in `$MET`.

(v2.12) Three changes, all inside the per-cycle list above. Timing: `triage_file` computes ON
TIME / LATE per matching expectation row from the status file's mtime against the row's deadline
and hands the verdict to the one-shot as an authoritative line; an ESCALATE worded on timing for an
on-time file is folded with the tag `[timing-ok]`. A deadline is an upper bound: the only deadline
faults are a file missing at the deadline (step 4) or arriving after it. Step 6b (G10 rule 11):
per `#fleet_transcript=` row, assistant entries matching `API_ERROR_RE` are counted and an increase
escalates TURNDEATH with the last error text's first 60 characters (first sight is a silent
baseline). Step 6c (G10 rule 12): when `ROUTES_FILE` is set, `hooks/route-probe.sh` probes each
route every `ROUTE_PROBE_SECONDS`, records the alive set in `.checks/routes.alive`, and a change of
the set escalates ROUTE once. Smoke: `hooks/watchdog-template-selftest.sh` runs two WATCHDOG_ONCE
cycles against a stub launcher and checks all three.

Not in the template: effort-specific one-shots (custom checks belong in `#check=` rows) and
per-room hooks (the daemon composes those).
