# Use Native Agent Control Path For Orchestrator Room Control

CCM will add a native Agent Control Path as the structured agent-facing encoding of existing room-control semantics, rather than making orchestrators simulate Slack or Telegram commands or adopting an external tool such as ACPx as the control plane.

ACPx and similar projects remain Agent Transport Candidates for launching or managing agent sessions behind CCM, but CCM Core remains the owner of room identity, Inspectable Room lifecycle, completion reportback, `nav`/`ss`/`status`/`transcript`/`stop` semantics, and Control State Minimalism.

Agent Control Path V1 exposes narrow Slack worker-room lifecycle operations for `create_room_with_bot_invited` and `archive_room`. Telegram create/archive is explicitly unsupported in V1 rather than emulated with parent-room reuse, threads, or fake room identifiers. Lifecycle calls require the room binding's `isOrchestrator` flag; worker rooms created by an orchestrator are ordinary rooms unless explicitly flagged later.

Git-backed orchestration remains a profile above CCM Core. It owns worker state, deterministic worker-room naming, create/adopt recovery, capture, validation, integration, archive/cleanup, inbox semantics, recall packets, and Guiding Principal authority. CCM Core should return structured room-operation facts but should not store workflow ownership, worker mappings, task ids, stage state, or Git bookkeeping.

This keeps orchestrator control fast, robust, fault-tolerant, and aligned with existing CCM room behavior while avoiding a second workflow state model.
