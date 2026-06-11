---
name: audit-worker-output
description: Use when an independent CCM worker must audit implementation, reports, source material, claims, security impact, user impact, or stage acceptance evidence.
---

# Audit Worker Output

Use independent audit workers when a stage requires evidence stronger than the implementing worker's self-check.

## When Required

- Security, privacy, credential, migration, release, or destructive-operation risk.
- Stage-unblocking acceptance claims.
- Material conflict between worker output, inbox, recall, or repo evidence.
- Reader-facing claims that need independent source checking.
- Broad refactors or integration work where a narrow test is insufficient.

## Audit Brief

```text
Audit Task: <audit_id>
Subject: <worker/report/diff/claim>
Stage Contract: <path/ref>
Evidence To Inspect: <reports, diffs, tests, transcript refs, docs>
Questions: <specific yes/no or findings requested>
Output: Audit Report with pass/fail/concerns, evidence, and blocking status
Authority: audit can block acceptance, but cannot rewrite orchestration state directly
```

## Rules

- Self-audit is useful but cannot unblock a stage that requires independent review.
- Audit workers run in visible worker rooms when their output is an independent artifact.
- Auditors inspect evidence; they do not merge, archive, mutate coordination state, or broaden scope.
- Blocking findings require Orchestrator decision: retry, fix, dispatch another worker, recall Guiding Principal, or abandon.

## Audit Report Format

```text
Audit Report: <audit_id>
Verdict: pass | pass-with-concerns | block
Evidence Reviewed: <paths/commands/transcript refs>
Findings: <numbered claims>
Blocking Issues: <required fixes or none>
Recommended Orchestrator Action: <accept | retry | fix | recall | abandon>
```
