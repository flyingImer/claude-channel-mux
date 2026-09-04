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
