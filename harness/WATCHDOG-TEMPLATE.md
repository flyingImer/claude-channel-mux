# Watchdog template (harness v2.8, trial)

One Tier-0 watchdog for every effort: `harness/watchdog-template.sh <watchdog.conf>`.

Derivation (the effort's delta on the v2.8 intake):
1. Write `<harness dir>/watchdog.conf` from `harness/watchdog.conf.example` (STATUS_DIR, ORCH_DIR,
   EXAM_SOURCES, REVIEW_CMD, budgets, doc names; override ACT_RE/TRIAGE_RE only if the effort's
   status vocabulary differs).
2. Replace `<harness dir>/watchdog.sh` with the two-line wrapper shown in the example header. The
   daemon-owned unit keeps running `watchdog.sh`, so the entry point does not change; editing the
   file restarts the unit.
3. Smoke check: `WATCHDOG_ONCE=1 bash watchdog.sh` against a copy of the status dir, or read the
   first cycle's digest lines.
4. Delete the effort's old inline copy; record the derivation note and version.

What the template does per cycle: (1) terminal/ask status files -> ESCALATIONS; (2) confirmation
files -> haiku triage against expectation rows; (3) expectation sweep (any other changed file
matching an expectation glob is an event); (4) deadline sweep; (5) active checks from
`#check=` rows; (6) context budgets + metrics; (7) exam regeneration, validated (size, Q-count,
no error body) before it replaces EXAM.md; (8) daily REVIEW via REVIEW_CMD; (9) hourly GC with
conservation checks. Escalation and digest line formats are unchanged from the seeding effort's
watchdog, so existing readers (orchestrator Monitors, eval scripts) keep working.

Not in the template: effort-specific one-shots (custom checks belong in `#check=` rows) and
per-room hooks (the daemon composes those).
