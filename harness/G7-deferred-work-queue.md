# G7 — Deferred-work queue (generic worker-room harness mechanism, DRAFT for the owner)

Status: draft v1, 2026-09-01. Layer: GENERIC.

## Purpose

Work that is identified now but deliberately NOT executed now must be (a) remembered in
one canonical place, (b) surfaced back to the owner at the right moment without being
asked (push, not pull), and (c) delivered in the standard format when fired. Memory,
reminder, delivery — all three, or deferral silently becomes loss.

## Entry schema

```
id:          short slug
what:        one line, plain language
packet:      path to the prepared deliverable (G6 packet, issue file, directive)
destination: which agent/channel executes it when fired
trigger:     when to surface it — a date, an event ("before X publishes", "when Y
             merges"), or owner-initiated; events name their observable condition
approval:    owner state (proposed | approved-to-queue | approved-to-fire)
status:      queued | reminded | fired | done (done requires the report-back archived)
provenance:  what created this entry (ruling, escape, review)
```

## Rules

1. **Enqueue at identification time.** The moment work is identified-but-deferred, the
   entry is written — including its packet if writable now (context is cheapest while
   fresh). The ruling-backflow rule (G2) creates its contract-edit entries HERE.
2. **The harness reminds, the owner decides.** A periodic duty (orchestrator tick /
   watchdog) checks triggers and surfaces due entries to the owner proactively. Firing
   is the owner's call unless pre-approved (approved-to-fire).
3. **Delivery is standard.** Firing an entry means delivering its packet per G6 (external
   destination) or as a directive/issue (internal destination). Ad-hoc delivery bypassing
   the packet loses the report-back contract.
4. **Nothing ages out silently.** An entry whose trigger has passed without action is
   re-surfaced with its age at every tick until fired or explicitly withdrawn by the
   owner (withdrawal is recorded, not deleted).

Provenance: the owner 2026-09-01 — the a privilege-wording spec edit must NOT be executed
immediately; the harness must remember it, remind, and deliver in standard form. First
instance entry: tag deferred queue.
