# G2 — Audit-charter mechanism (generic worker-room harness mechanism, DRAFT for the owner)

Status: v2, 2026-09-04 (v1 draft 2026-08-31). Layer: GENERIC. This file defines schema + rules only;
each project derives an instance file holding its rows (tag instance: to be created by
tag orch as audit-charter.md after the owner approves this mechanism).

## What a charter is

The project's persistent list of audit sweep dimensions — the machine-readable half of
"what a competent audit must always check here". It feeds G1 step 3 verbatim. It is the
sedimentation target: audit capability compounds by row accretion, not by re-review.

## Row schema

```
id:        short slug (stable)
class:     artifact class this row sweeps: code | spec | submission (v2.3; a row without a
           class is invalid and is never loaded into any room)
dimension: generic wording of the sweep CLASS. Never names a specific past bug.
scope:     enumeration rule — how the auditor derives the concrete sweep set from the
           artifact (e.g. "every endpoint the diff touches x every error case the
           contract defines for it").
origin:    provenance — the escape/correction event(s) that created or refined this row
           (event ids or receipts). Rows without provenance are suspect by default.
tier:      T0 mechanical (scriptable) | T1 objective-judged | T2 judgment-judged.
state:     active | suspended (owner can flip anytime).
```

## Rules

1. **Escape -> row.** Every escape (a defect caught by a later layer than the one that
   should have caught it) MUST produce a charter change: a new row, or a refinement of
   the row that should have caught it. This is the learning-substrate hook (G4).
2. **Classes, not instances.** Rows are worded as defect classes. Writing the specific
   past bug into a row teaches to the test and caps the row's future yield.
3. **Owner nod, lightweight.** Row additions/edits are approved by the project owner
   (one nod); the mechanism itself (this file) changes only via generic-layer review.
4. **Tier drives automation.** T0 rows graduate into scripted checks (CI/leak-scan
   class); T1/T2 stay in the auditor mandate. Graduation is recorded in `origin`.
5. **Coverage is reportable.** A row is only "swept" when the auditor shows the
   enumeration table it produced under `scope` (G1 step 5).

## Charters are per ARTIFACT CLASS, not only per project

A project holds one charter file per artifact class it produces. Observed classes so far:
code commits (the seed classes below), and CONTRACT/SPEC ARTIFACTS. A spec revision is
an auditable artifact at INTAKE — before any implementation consumes it — under a
spec-class charter whose seed dimensions are:
- self-consistency: every normative statement x every other statement governing the same
  operation (provenance: a privilege-wording contradiction shipped in the spec, survived
  spec revision AND plan review, rediscovered at code audit);
- normative-vs-illustrative labeling: any section marked illustrative that downstream
  text or code treats as normative;
- precedent-alignment claims vs the precedent's actual shape in the tree.

## Ruling backflow rule

Any ruling recorded in a decision store that contradicts contract text MUST, at recording
time, also enqueue a contract-edit item (the E-queue). A ruling without its backflow item
is an incomplete ruling. (Provenance: the attach/detach x 3 privilege ruling was recorded
in the decision store 2026-08-24 but §7.6 was never queued for edit; a blind auditor re-derived the
contradiction 8 days later as an open question.)

## Seed classes observed so far (for instance derivation; provenance = tag escapes)

- wire-contract conformance: every endpoint touched x every contract-defined error
  case; literal wire error type/status compared to contract text.
- lifecycle completeness: every new persistence surface x every existing lifecycle
  operation (create/drop/purge/rename/migrate) that must account for it.
- stated-claims vs code: every factual claim in commit body / description checked
  against the tree.

## Seed-row library (v2, 2026-09-04) — generic dimension classes any project derives

Rows here carry dimension + generic scope template + portability note + provenance.
Projects derive instance rows (filling scope with their nouns) and may add rows of their
own; a project row is promoted here only after it passes G0's portability test.

- **concurrent-same-identity-writers** — every read-then-write on an identity in the
  artifact x one concurrent writer of the same identity; each cell = the loser's
  contract-facing outcome. Scope template: enumerate (write path, identity) pairs from
  the diff; per pair, the interleaving "both read empty/stale, both write". Receipt form:
  a barrier/interleaving test or a line-level trace. Boundary (provenance, tag 08-28):
  a one-way rw-antidependency that is serializable in a contract-sanctioned order is
  NOT_A_DEFECT; the row asks for the loser's OUTCOME, never for a serializability
  proof or a prescribed fix. PORTABILITY: durable record stores (commit-preempting
  writers), HTTP create-or-replace, spec registries with last-writer rules. Tier T1.
- **precedent-shape-parity** — the artifact's structure, naming, layering and error
  handling compared to the DESIGNATED in-tree precedent for the same kind of feature;
  each finding cites precedent file:line as the counter-shape. Scope template: list the
  artifact's new types/entry points; for each, the precedent's counterpart or "none".
  Exclusion: the comparison target is code in the tree the artifact lands in, never a
  direction/roadmap document (keeps blind rooms free of non-contract material and keeps
  findings defensible to the receiving reviewers). Replaces generic smell catalogs,
  which carry no citable ground truth. PORTABILITY: OSS feature PRs (precedent = prior
  feature), SPI tickets (precedent = sibling SPI), specs (precedent = sibling spec). T2.
- **cross-layer-representability**, **stated-claims-vs-code**, **capability-gate-
  outcome-surface**, **miss-identity-precedence**, **lifecycle-parity (create/purge)**:
  already generic-worded in the seeding project's charter (tag audit-charter.md rows);
  promote verbatim dimension + scope template when a second domain derives them.

## Artifact class: submission-to-an-audience (v2, 2026-09-04)

A PR to an external project, a design document handed to a community, a mailing-list
proposal: the artifact is judged by an audience with its own norms, and no conformance
row above asks "what will that audience say". Provenance: an external round on an
already-audited tip found only two new items, both of this class (an unused interface
added to a public extension point; a project rule requiring list approval before
Ready), i.e. the conformance charter was complete and this class did not exist.

- **Judge role**: a fresh blind room role-playing the receiving audience's reviewer.
- **Materials** (G1 allowlist): the artifact + its description/cover text; the
  audience's PUBLISHED norms (contributing guide, review conventions); precedent
  submissions of the same kind AND their real review threads. Never internal documents.
- **Seeding rule** (owner ruling 2026-09-04): rows are seeded from the audience's real
  past review comments on precedent submissions, then grown from feedback on our own
  submissions (each comment = correction event, G4). Our own taste documents are at most
  a secondary source; a row citing only our taste is suspect (G2 provenance rule).
- **Seed rows**: (a) extension-surface delta — every public interface/abstract method
  added or changed x "has a production caller in this artifact?" x "covered by the
  audience's approval process?"; (b) deferred-dependency disclosure — every dependency
  the plan defers is stated in the cover text with its consequence; (c) problem-before-
  mechanism — the cover text states the problem and the observable change before
  module structure; (d) precedent-shaped structure — commit granularity, tests and docs
  follow the audience's precedent submission.
- **Cadence**: once per submission candidate (before it becomes visible), not per
  revision. PORTABILITY: OSS PRs; community design docs; internal PRs to a repo with
  its own reviewers (audience = those reviewers, norms = that repo's guide).

## Class isolation and pass-condition provenance (v2.3, 2026-09-04)

Provenance: the seeding project's first derivation of the submission class placed its four
rows in the shared charter file and planned to feed all rows to the next code-conformance
blind room; one code-class row's pass condition accepted "named in the live PR body" as
equivalent to "has a caller". Both are doc gaps, fixed here as rules, not as instructions:

1. **Rows are loaded by class, mechanically.** A room is launched for exactly one artifact
   class and receives only that class's rows (the launcher filters on `class:`; G9 HARD).
   Rows of different classes may share a file; they never share a room. A code-conformance
   room therefore never sees submission rows, and never receives cover text as material
   (G1 allowlist) — cover text reaches it only as a claim under stated-claims-vs-code.
2. **Pass conditions come from artifact, contract, or precedent — never from author-authored
   text.** A cell may not be satisfied by a sentence in a PR body, commit body, plan, or
   report; those are subjects of the claims rows. A legitimate exception (e.g. shipping an
   interface ahead of its first caller) is a RULED-BEFORE disposition at reconciliation,
   with a receipt, not a charter pass.
3. **Taste-seeded rows are provisional by construction.** Seed-library rows for the
   submission class that were authored from the owner's own writing rules (rows (c) and (d)
   in the library above) carry `state: provisional` until an audience receipt exists (a real
   reviewer comment on a precedent or on our own submission). Provisional rows are swept and
   reported but their findings are NOT_A_DEFECT by default; the first audience receipt
   activates the row (G4 correction event), absence after two audience reviews retires it.
   The generic layer applies this to itself: this file's seed rows (c)/(d) are provisional.
