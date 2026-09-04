# G1 — Blind-audit protocol (generic worker-room harness mechanism, DRAFT for the owner)

Status: v2, 2026-09-04 (v1 draft 2026-08-31). Layer: GENERIC. Tag appears below only as instance examples.
Validation: experiment exp-a-rung1 (orch/experiments/) tests this protocol head-to-head
against the historical external-judge baseline on a frozen artifact.

## Problem this mechanism solves

Audit failures observed in production traced to protocol, not judge identity: auditors
were anchored by author claims (DONE/status files), worked from stale contract copies,
and no audit charter ever owned exhaustive conformance sweeps. This protocol makes the
audit stage a first-class design with independence guarantees.

## Protocol

1. **Blind materials (allowlist)**. The auditor room receives EXACTLY:
   - the artifact under audit: frozen ref + its diff against its base;
   - the governing contract(s), freshness-verified per G3 (source-freshness gate);
   - designated pattern references (in-tree precedent code counts).
   Nothing else. No orchestrator digest, no author status/DONE/description files, no
   prior analysis of this artifact, no project memory injection (run the room under a
   neutral project path).

2. **Claims are audited, never trusted.** Author claims (commit body, description) enter
   only as audit SUBJECTS under the claims-vs-code dimension. A claim is never evidence.

3. **Charter-driven mandate.** The room's sweep list comes verbatim from the project's
   G2 audit charter, FILTERED TO THIS ROOM'S ARTIFACT CLASS (v2.3: the launcher selects rows
   by `class:`; a room never receives another class's rows), plus one mandatory open adversarial
   residual pass ("anything else violating contract or internal consistency").

4. **Receipts discipline.** Every finding: verdict CONFIRMED or PLAUSIBLE + receipt
   (file:line + contract clause). Precision is a duty equal to recall: borderline items
   are adjudicated explicitly as NOT_A_DEFECT with the reason, not silently dropped and
   not inflated into findings.

5. **Coverage proof, not vibes.** Each charter dimension's report must show the
   enumeration it swept (e.g. the endpoint x error-case table with per-cell outcome),
   so "swept" is verifiable and termination is machine-checkable: all enumerated cells
   dispositioned + residual pass done.

6. **No fixes.** Audit output is findings only; fixing is the author lane's job.

7. **Model is pinned at launch, never inherited** (v2.4). An audit room is a one-shot `claude -p`
   launched outside CCM, so nothing pins its model for it; an unpinned launch resolves to the
   caller's global default, which in a fable-default environment is the most expensive tier.
   Launch only through `harness/launch-audit-room.sh`, which refuses to start without
   `--model` and records the model in `run-meta/launch.json`. The tier is the owner's choice
   per artifact class (G9 lists it as HARD).

## Independence ladder (cheap -> expensive; climb only when the rung below leaks)

L1 single fresh room under this protocol.
L2 N independent same-model rooms; compare union/intersection (self-consistency).
L3 internal adversarial pair: finder + refuter with decision-history access.
L4 heterogeneous external judges + convergence protocol. Value NOT_ESTABLISHED as of
   2026-08-31; priced by what escapes L1-L3 (exp-a ladder measures this).

## Owner review surface

Audit output stays machine-first (structured findings files with receipts). The
reconciled result reaches the owner per G8 (owner review surface): a rendered Artifact
page generated from the files. Never inside blind rooms — no consumer there.

## Escalation

Findings the auditor cannot disposition against the contract (genuine contract tensions,
two prior decisions in conflict) escalate to the project owner as QUESTIONS, never as
findings. Instance example: the seeding PR's B3 (§6.3 fence vs E7 scope) was exactly this class.

## Severity rubric (v2, 2026-09-04) — severity is derived, not judged

Provenance: a production audit (the seeding project, revision 12) found a contract-defined operation that
surfaced an unhandled failure under a valid concurrent input (findings F12) and an
accepted input that failed at a lower layer (F9); both were graded "nit" by judgment,
the reconciliation stage skipped nits, and both shipped to the next revision. An
external judge graded the same two "blocker". The field with no rule was severity.

Severity is a function of the receipt, computed after the verdict:
- **blocks-merge**: the contract's primary path is violated, or durable/shared state can
  be corrupted or leaked.
- **should-fix** (floor): for ANY valid input or interleaving, the contract has already
  assigned an outcome and the artifact produces a different one — including an
  unhandled/undefined failure where the contract defines a handled outcome. A finding
  whose receipt cites a contract clause is at least should-fix, regardless of how rare
  the trigger is or whether in-tree precedent has the same hole.
- **nit**: no contract clause is cited; style, naming, wording, or hardening beyond the
  contract.
Instance readings: HTTP API → a reachable 5xx where the contract defines 2xx/4xx; SPI /
store method → an exception type or state outside the method's declared contract
escaping to the caller; research/spec artifact → a claim contradicting its cited
source. PORTABILITY NOTE: the rule needs only "contract clause cited in receipt".
Tier (G9): HARD — the report validator rejects a finding that cites a contract clause
and carries severity nit.

## Reconciliation stage (v2, 2026-09-04)

The stage between audit findings and fixes is a mechanism, not a courtesy. Inputs: the
findings file + the project's decision store (rulings, prior dispositions). Output: one
disposition per finding — FIX (with the leg list), RULED-BEFORE (receipt to the ruling;
this is the anti-re-prosecution valve), NOT_A_DEFECT (reason), or QUESTION-TO-OWNER.
Rules:
1. A PLAUSIBLE finding whose receipt cites a contract clause must be resolved to
   CONFIRMED or REFUTED (by test, code read, or precedent) before disposition. It may
   not be dropped on verdict or severity grounds.
2. Severity orders the fix queue; it never removes an item from it. Deferral of a
   should-fix is an owner ruling, recorded in the decision store with its backflow item.
3. Every disposition carries a receipt; a finding with no disposition line blocks the
   revision's close-out (G9: report validator).
