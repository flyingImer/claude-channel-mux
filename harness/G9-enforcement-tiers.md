# G9 — Enforcement tiers (generic worker-room harness mechanism, DRAFT for the owner)

Status: v2.1, 2026-09-04 (v1 draft 2026-09-01). Layer: GENERIC.

## The problem (the owner's diagnosis, confirmed)

Most of this harness rides on files plus the HOPE that sessions read and follow them.
PR2 proved that hope fails. Files are the right substrate for CONTENT and PROVENANCE;
they are the wrong substrate for CONTROL.

## Tier model

Every rule in G1-G8 (and future mechanisms) declares one of three tiers:

- **HARD** — deterministic, the model cannot bypass. Claude Code primitives:
  - PreToolUse hooks: run before a tool call; can BLOCK it (a path-guard can refuse a
    Read/Grep outside a room's allowlist, a push-guard can refuse git push until a leak
    scan passes).
  - Stop hooks: can refuse to let a session finish until a validator passes (e.g. audit
    report missing its enumeration tables => not done).
  - SessionStart hooks: inject context unconditionally at boot (due deferred-queue
    entries, freshness state) — no reliance on the session thinking to look.
  - Permission rules (settings.json allow/deny) and --allowedTools at room launch:
    tool- and path-level sandboxing (exp-a used allowedTools; it held perfectly while
    the prompt-level denylist needed a post-hoc transcript check).
- **BOOT** — injected at launch, model-followed but always present: launcher-composed
  room prompts (charter text), CLAUDE.md auto-load, skills that trigger on match,
  plugin packaging so every room gets the same skills/hooks (CCM plugin is the
  precedent and the generalization target).
- **CONTENT** — files consumed as material. Valid for evidence, charters' row bodies,
  reports, queues' payloads. NEVER for control-critical steps.

Rule of thumb: if skipping the step must be impossible, it is HARD; if forgetting the
step must be impossible, it is at least BOOT; only what may legitimately be judged or
deferred stays CONTENT.

## Mapping of existing mechanisms (proposed wiring)

- G1 blind-room materials allowlist: HARD — launch with --allowedTools + a PreToolUse
  path-guard hook scoped to the room dir (upgrades exp-a's purity from post-checked to
  enforced).
- G1 coverage proof / report structure: HARD — Stop-hook validator (structural check of
  findings.md sections/tables).
- G3 source-freshness gate: HARD — PreToolUse guard on mirror paths (blocks reads when
  the fingerprint marker is stale, instructs live fetch); SessionStart freshness banner.
- G7 reminders: HARD — SessionStart hook injects due/overdue entries into every
  orchestrator session; watchdog tick as backstop. (This is the direct fix for
  "寄希望于 session 及时参考", the PR2 failure mode.)
- Leak scan on outbound: HARD — PreToolUse guard on push/PR-create Bash commands.
- G2 ruling backflow: SEMI — PostToolUse validator on decision-store edits flags a
  ruling without a queue entry (heuristic; final judgment stays human).
- G6 packing quality, charter sweep quality: CONTENT + review — judgment, not hookable;
  this is what audits and scoring are for.

## Staging

1. First wiring (cheap, one script each): blind-room path-guard + deferred-queue
   SessionStart reminder. Validate on the next audit room and next orch session.
2. Package generic-harness as a Claude Code plugin (hooks + skills + agent defs) so
   every room inherits enforcement without per-room setup; converge with the CCM plugin
   per the approved generalization path.
3. Each later G-rule lands WITH its tier declared and its hook (if HARD) in the same
   change.

## v2 additions (2026-09-04)

- G1 severity floor + reconciliation completeness: HARD — the audit-report validator
  (Stop hook on audit rooms; PostToolUse on the reconciliation close-out file) rejects
  (a) a finding citing a contract clause with severity nit, (b) a close-out with any
  finding lacking a disposition line, (c) a PLAUSIBLE contract-cited finding disposed
  without CONFIRMED/REFUTED. Script: hooks/audit-report-validator.py (to land with the
  next audit room; until then BOOT — the rule text is injected into the room task).
- Outbound gate: HARD — hooks/outbound-gate.py (PreToolUse on Bash). Blocks any command
  matching the effort's declared PUBLIC patterns (push to a PR-backed branch, PR create,
  doc publish) unless a close-out record exists for the outbound ref that names the
  audited base, the dispositioned findings, and the delta-only-fixes verification. An
  owner override token file allows the action and appends a correction event. The
  script is generic; the effort derives the manifest (patterns, record dir, token path).
- G0 inheritance: BOOT — a generic version bump lands in each effort's deferred queue
  via its intake channel; the SessionStart reminder surfaces it until derived.
- (v2.1) hooks/audit-report-validator.py LANDED: Stop hook on audit rooms
  (CLAUDE_AUDIT_FINDINGS=<findings path>) and close-out mode for reconciliation. First run
  on the seeding project's v12 audit flagged 8 of 15 "nit" findings as contract-cited
  (F6-F12, F20): the severity gap was systemic, not two items.
- (v2.1) harness-sync.sh: BOOT — SessionStart in every effort; explicit via /harness-refresh.
- (v2.3) Charter class isolation: HARD — the audit-room launcher loads only rows whose
  `class:` equals the room's class and refuses rows without a class (script:
  hooks/charter-select.py; BOOT until it lands with the next audit room).

- (v2.4) Audit-room model pin: HARD — `launch-audit-room.sh` exits 2 without `--model`; the
  chosen model is written to run-meta/launch.json so the audit report's cost line can be
  verified. Provenance: three blind-audit revisions ran unpinned on the global default.
- (v2.4) Room settings carry CLAUDE_CODE_SUBAGENT_MODEL (daemon-generated settings restate it,
  default sonnet) so in-room Agent subagents never inherit the room's pinned model.
