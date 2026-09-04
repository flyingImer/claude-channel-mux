# G6 — External-agent liaison (generic worker-room harness mechanism, DRAFT for the owner)

Status: draft v1, 2026-09-01. Layer: GENERIC.

## Purpose

A standard way to engage agents OUTSIDE this harness (a doc-editing an external doc-editing agent session,
an external reviewer, a second external reviewer, any future peer) that lets them contribute their full strength — including
finding things we missed — instead of being reduced to instruction executors. The packet
format is a means; the contract below is the mechanism.

## The contract

1. **Full story, never bare instructions.** Every handoff packet carries the problem, the
   history that led here (who decided what, when, why), and receipts — enough that the
   external agent could re-derive or CHALLENGE our position, not just apply it.
2. **Proposals, not orders.** Concrete changes are framed as suggestions with rationale.
   The packet says why we believe X; it invites disagreement.
3. **Standing 查漏补缺 mandate.** Every packet explicitly instructs: if you notice
   adjacent problems or contradictions while working, flag them as QUESTIONS (exact
   quotes + context + which reading the evidence supports), never silently fix beyond
   scope and never silently ignore.
4. **Decision rights stay home.** New issues the external agent raises come back for
   decision (owner or reconciliation), with enough context attached that deciding is
   cheap. The external agent never unilaterally expands scope.
5. **Report-back is part of the work.** A handoff is not done until the report lands:
   what was applied (exact final wording where text was edited), what was NOT applied
   and why, and the new-question list. Reports are archived next to the packet.
6. **Boundary scan.** A packet crossing the org boundary carries only what the
   destination may see (leak rule applies at packet-write time, not send time).

## Epistemic packing (the owner 2026-09-01)

The two sides never share context by default; asymmetric assumptions produce divergent
eval results that LOOK like disagreement about the subject. Therefore:

1. **Assumption register.** Every assumption the home position depends on is listed
   explicitly and self-contained — including the ones "everyone here knows". If the
   destination would evaluate differently under a different assumption, that assumption
   belongs in the register.
2. **Epistemic labels.** Every statement in the packet is one of: FACT (verifiable, with
   receipt), INFERENCE (our reading, could be wrong — marked as ours), PROCESS (how we
   got here; include only what the destination needs), SUBJECT (the material under
   review). Never let an inference wear a fact's clothing.
3. **Bias minimization.** Do not pre-narrate the preferred conclusion as neutral
   background. Give the evidence and mark our reading as a reading; the destination is
   entitled to reach a different one.
4. **Relevance filter.** Include what changes the destination's judgment; leave
   session-local detail home. Self-contained is a completeness bar for assumptions and
   evidence, not an invitation to dump the transcript.

## Packet shape (the standard sections; adapt wording freely)

Destination + access it needs / Background — the full story / Proposals (each: where,
what, suggested wording, why) / Out of scope / If-you-find-new-problems protocol /
Report back.

## Relationship to the rest of the harness

Outbound mirror of G1's inbound rule: external findings that come back enter
RECONCILIATION like any other audit input (full decision-store search), and accepted
ones sediment into charters (G2) like any other escape. Deferred handoffs are held and
fired by the deferred-work queue (G7).

Provenance: the owner 2026-09-01 — external agents must be free to "发挥优势并查漏补缺";
the external reviewers rounds' value came from exactly the items nobody asked them for.
