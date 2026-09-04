# G8 — Owner review surface (generic worker-room harness mechanism, DRAFT for the owner)

Status: draft v1, 2026-09-01. Layer: GENERIC. Promoted from a G1 subsection per the owner:
"要 review 的东西都要搭配这个" — every review-bound deliverable, not just audit output.

## Rule

Anything delivered to the OWNER for review — audit results, plan reviews, debriefs,
scorecards, acceptance requests — ships in two forms:
1. the structured file(s) in the repo (source of truth; what machines and later sessions
   consume; what provenance cites);
2. a rendered Artifact page generated FROM those files: summary/verdict first, status
   encoded visually (chips/severity), receipts collapsed but reachable, both themes.

The page is a VIEW. It never contains information absent from the files; regenerating it
from the files must be lossless. On any file update that the owner will re-review,
republish the same artifact URL (stable link per deliverable).

## Boundaries

- Private by default; owner decides sharing. Public-bound material never cites
  org-internal sources through these pages (leak rule applies to page content).
- Not for machine-to-machine stages (blind rooms, reconciliation, scoring): those
  consume files; a page there is an extra distribution surface with no consumer.
- Cost discipline: one page per deliverable, updated in place — not one per iteration.

Provenance: the owner 2026-09-01, after the exp-a scorecard page ("扫这页比翻 54KB findings
快一个量级").
