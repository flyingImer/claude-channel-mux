# G5 — Metrics schema (generic worker-room harness mechanism, DRAFT for the owner)

Status: draft v1, 2026-09-01. Layer: GENERIC.
Premise (round-3 ratification): full autonomy is an asymptote; the KPI is the
intervention-rate decline curve, and parallelism is a GRADUATION, not a feature.

## Per-deliverable records (source: normal reports + G4 event log)

- escapes-found-by-layer: for each confirmed defect, which layer caught it
  (author-self / internal-audit / reconciliation / external / owner) vs which layer
  SHOULD have. Every "later than should" increments the escape count (and fires G2/G4).
- owner interventions: count + G4 class, per deliverable.
- acceptance: did the deliverable pass owner review without correction (binary).
- derivation deviations: count of recorded G-doc deviations (from G0 notes) — high
  deviation with good outcomes indicts the doc, not the project.

## Per-project rollups (scorecard, per wave)

- intervention rate per class over time (THE curve).
- escape rate by layer (internal-audit catching what author missed is healthy;
  owner catching what everyone missed is the number to drive to zero).
- audit precision (over-flags refuted at reconciliation / total flags).
- cost per deliverable (rooms, wall-clock, $) — so quality gains are priced.

## Graduation gates (per project, owner-set thresholds)

- A stage goes lighter-touch (sampling instead of full review) after N consecutive
  deliverables under X% owner-intervention for that stage.
- Parallelism unlocks when the project's overall intervention rate stays under the
  owner's threshold across a full wave. Regression re-locks: gates are reversible.

## Instance note

The tag instance extends the existing orch eval.sh/scorecard (framework lane owns the
script; this doc owns the schema). First baseline: the follow-up PR wave.
