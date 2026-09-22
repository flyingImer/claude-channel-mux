# G4 — Learning substrate (generic worker-room harness mechanism, DRAFT for the owner)

Status: draft v1, 2026-09-01. Layer: GENERIC.
Premise (Warp lesson + the owner round-2 ruling): every correction is a training signal, and
rules are never written from thin air — they SEDIMENT from real corrections. This
mechanism is the sedimentation engine; G2 charters and the G-docs are its outputs.

## Correction-event log

Append-only file per project (instance decides location). One event per correction:

```
ts / id
caught-by:  author-self | internal-audit | reconciliation | external-judge | owner
corrected:  what was wrong, one line, plain language
class:      spec-gap | quality | taste | factual | mechanism-gap
receipt:    pointer (file:line, message, report section)
disposition: pointer to what it changed (charter row, G-doc diff, fix commit) — filled
             by the distiller, empty until then
```

## Capture points (write the event AT the moment, not retrospectively)

- Owner overrides or redirects a session's approach (the two role corrections on
  2026-09-01 are events of class mechanism-gap).
- An audit layer catches what an earlier layer missed (= escape; also triggers G2's
  escape->row rule).
- Reconciliation refutes a finding (an over-flag is a correction of the auditor).
- An external agent's report-back raises a valid new problem.
- The anti-coaching rule fires (G0): needing bespoke instructions = mechanism-gap event.

## Distiller

Runs at wave boundaries (or on owner request): reads events since last run, clusters,
proposes diffs — each tagged with its target layer: G-doc change (owner approves),
charter row (owner nods), SOP/skill change, or no-action-yet (pattern not established;
stays logged). Every proposed rule cites its source events (provenance discipline).
Undistilled events are never deleted.

## KPI

Intervention rate per class over time (feeds G5). The curve bending down is the entire
point: review cost converts from repeated spend into compounding capital.

## Inbox-touch check (v2, 2026-09-22)

**Rule.** A daily-REVIEW step checks whether the correction-event inbox — this
mechanism's own capture point, not any session's private memory file — was appended to
since the previous review, whenever new lessons were in fact recorded during that
window in ANY form outside this substrate (a private memory note, a chat log, anything
not written here). A lesson that never reaches the inbox has not entered the learning
loop, however well it is remembered elsewhere.

**Receipt.** The REVIEW record states the inbox's last-modified time relative to the
previous REVIEW's timestamp; when a lesson is independently known to exist outside the
inbox, the record states whether a matching inbox entry exists.

**Forbids.** Treating a private memory note or an ad-hoc log as equivalent to an inbox
entry; a REVIEW record that reports the scorecard but is silent on inbox freshness.

**Mechanical check.** `harness/watchdog-template.sh` (v2.9): the daily REVIEW step
compares the configured inbox file's mtime against the previous REVIEW stamp and
escalates once if it has not advanced. This is a freshness heuristic, not a proof that no
lesson was missed — it catches the inbox going untouched across an entire review window,
which is the measured failure.

**Origin.** The inbox went untouched for twelve days while seven lessons were recorded
elsewhere in that same window.

**Overfit check.** Any project keeping BOTH a durable, shared correction log and a
separate private per-session memory mechanism needs this cross-check; it says nothing
about what either mechanism is named.
