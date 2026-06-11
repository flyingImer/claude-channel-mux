# Claude Channel Mux

This context describes the domain language for CCM room orchestration, human-facing channel coordination, and agent worker execution.

## Language

**Guiding Principal**:
The ChatGPT-led human-context interface outside the CCM orchestration system. The Guiding Principal receives human intent and context, helps persist or delegate Durable Intent, shapes intake and reader-facing framing, and supplies clarification when the Orchestrator cannot confidently decide from durable project artifacts. The Guiding Principal is best-effort rather than fully system-controlled, and is not the routine approval authority for worker dispatch, room control, output capture, or artifact integration.
_Avoid_: transport operator, routine approval gate, hidden worker, unchecked source of truth

**Guiding Principal Edit**:
A direct durable edit by the Guiding Principal to intake, stage framing, recall response, inbox supplement, decision context, or reader-facing representation material. A Guiding Principal Edit does not require a Worker Agent because it captures human-context guidance rather than orchestrated worker execution.
_Avoid_: orchestrator shortcut, worker task, hidden execution, routine bookkeeping update

**Durable Intent**:
Human or Guiding Principal intent captured in repository files such as `docs/orchestration/<initiative-id>/intake.md`, `stage.md`, `inbox/*.md`, recall responses, or decisions. Chat discussion is an intake path, but it becomes Durable Intent only when persisted with attribution to the source conversation or actor.
_Avoid_: raw chat as source of truth, ephemeral approval, unstated human context

**Delegated Durable Write**:
A durable file written by the Orchestrator or another authorized bridge on behalf of the Guiding Principal or human-facing ChatGPT conversation. A Delegated Durable Write must preserve attribution to the originating source and distinguish captured guidance from Orchestrator judgment.
_Avoid_: unattributed approval, silent transcription, hidden state mutation, Orchestrator judgment disguised as Guiding Principal context

**Intake Note**:
The initial durable calibration anchor for an orchestration initiative, normally `docs/orchestration/<initiative-id>/intake.md`. It captures user goals, constraints, risks, context, and open questions while the Guiding Principal still has fresh human context. Later process-time supplements belong in `inbox/`, not by casually overwriting the Intake Note.
_Avoid_: raw transcript, task plan, stage contract, mutable scratchpad

**Stage Contract**:
A durable file, normally `docs/orchestration/<initiative-id>/stage.md`, that defines the current executable stage boundary, including goal, scope, escalation criteria, intended audience or use, and completion or pivot conditions. The Orchestrator may execute and integrate work from a Stage Contract when durable docs/context are sufficient; Guiding Principal recall is required when human-context judgment or reader-facing representation is needed.
_Avoid_: vague plan, chat approval, worker task, blanket approval gate

**Orchestrator**:
An agent that turns Durable Intent and Stage Contracts into coordinated worker execution, including task decomposition, Slack worker-room setup, worker dispatch, output capture, routine integration, archive/cleanup, and state updates. The Orchestrator is the default operational decision-maker for artifacts represented in durable project context, and escalates to Guiding Principal recall when docs/context are insufficient or human-facing representation is needed.
_Avoid_: hidden daemon, Slack-only transport operator, routine approval requester, unchecked strategy owner

**Orchestrator State**:
The Agent Resume Identity for an Orchestrator. Orchestrator State is not the full coordination record; the Orchestrator reconstructs current work from Orchestration Bookkeeping.
_Avoid_: full work plan, hidden memory dump, live room status

**Orchestration Bookkeeping**:
The durable docs and commits under `docs/orchestration/<initiative-id>/` that describe current orchestration progress, including intake, stage, `workers.md`, `state.md`, inbox items, recall packets, reports, source material, decisions, capture history, integration notes, and archive/cleanup results. Orchestration Bookkeeping is Orchestrator-owned; Worker Agents do not directly write it.
_Avoid_: agent session state as source of truth, Slack event replay as durable truth, worker-owned coordination state

**Coordination Branch**:
The configured Git branch used as the durable orchestration bus. The Coordination Branch may default to `main`, but the orchestration model should not hard-code that name.
_Avoid_: always main, release branch, worker branch

**CCM Core**:
The room substrate that provides durable room and session handles, Inspectable Room lifecycle, authorization, auditability, idempotent control operations, and observable execution traces. CCM Core is semantically neutral between Orchestrator and Worker Agent rooms; orchestration behavior comes from room capability flags and profile-level prompts, not from a separate room type. CCM Core does not know Git concepts such as Coordination Branch, Orchestration Bookkeeping, Stage Contracts, or Worker State semantics.
_Avoid_: git orchestrator, workflow engine, source of truth

**Orchestrator Room Flag**:
A minimal CCM Core metadata flag, such as `is_orchestrator: true`, that marks a normal CCM room whose agent may manage and interact with worker rooms through CCM without operating over Slack or Telegram like a normal human-facing room. The control chain is orchestrator room to CCM, CCM to orchestrator agent, orchestrator agent back to CCM, then CCM-managed worker rooms. The flag grants room-control capability; it does not create a separate orchestrator runtime, change core room semantics, or require CCM Core to store workflow ownership, task ids, worker mappings, or stage state.
_Avoid_: special room type, hidden daemon, workflow engine mode

**Orchestrator Flag Grant**:
The trusted action that sets the Orchestrator Room Flag on a normal CCM room. Orchestrator Flag Grant should require an explicit human-facing command or trusted local bootstrap/config; a normal agent should not be able to upgrade its own room into an Orchestrator room.
_Avoid_: self-escalation, implicit grant, workflow auto-detection

**Non-Inherited Orchestration**:
The rule that worker rooms created by an Orchestrator do not inherit the Orchestrator Room Flag. Worker rooms are normal CCM rooms unless a human explicitly grants orchestration capability to them.
_Avoid_: nested orchestration by default, worker self-spawn, capability inheritance

**Orchestrator Room Scope**:
The practical scope of rooms an Orchestrator manages through Agent Control Path. CCM only needs to remember that the room has the Orchestrator Room Flag; ownership of created or managed worker rooms lives in Orchestrator-local state or profile-level Orchestration Bookkeeping. The Orchestrator normally manages rooms it created or rooms listed in local state; it should manage other existing rooms only when explicitly instructed by a human.
_Avoid_: per-operation capability matrix, arbitrary room takeover, target ACL model

**Orchestrator Local State**:
Live convenience state used by an Orchestrator to remember rooms and sessions it created during its current work. Orchestrator Local State is not the durable handoff or recovery source; Git-backed orchestration should persist needed Worker State and Agent Resume Identity in Orchestration Bookkeeping.
_Avoid_: CCM core state, durable source of truth, workflow ownership model

**Agent Control Path**:
The structured agent-facing encoding of CCM's existing room-control semantics, parallel to human-facing Slack and Telegram command encodings. Agent Control Path lets an authorized agent manage and interact with other CCM rooms and query structured equivalents of existing human commands such as `nav`, `ss`, `transcript`, `status`, `stop`, and room or session lookup without simulating Slack or Telegram text commands. It should be faster, more efficient, more robust, and more fault tolerant than operating through human-facing transports; async events improve latency and freshness but are not the correctness root.
_Avoid_: Slack command, Telegram command, human transport

**Agent Control SOP**:
The documented sequence an Orchestrator follows over Agent Control Path to operate existing CCM room semantics. Agent Control SOP should preserve existing independent steps such as creating or binding a room, starting or lazy-starting an agent slot, sending a task, using structured nav/status queries, and stopping the agent; it should come from docs rather than requiring CCM Core to introduce a combined worker-only lifecycle API.
_Avoid_: one-shot worker API, hidden lifecycle, merged control primitive

**Agent Control Path Contract**:
The generic CCM documentation for Agent Control Path semantics and Agent Control SOP. Agent Control Path Contract should be separate from both the Git-Backed Profile and the conceptual CCM room-control requirements so CCM room-control behavior remains reusable outside Git-backed orchestration without turning the core contract into an API-detail document.
_Avoid_: Git profile section, implementation issue, workflow-specific SOP

**Shared Room-Control Semantics**:
The rule that human-facing Slack or Telegram command encodings and Agent Control Path operations must call the same underlying CCM room-control behavior. Agent Control Path should not duplicate or fork command logic; implementation may require extracting shared service functions from current command handlers.
_Avoid_: parallel behavior, copied command parser, Slack simulation

**Batch Control**:
A future convenience API that groups multiple Agent Control Path operations into one call. Batch Control is not a V1 primitive because existing CCM steps should remain independent and high throughput can initially come from fast local calls plus Orchestrator Dynamic Workflow.
_Avoid_: required primitive, one-shot worker lifecycle, hidden transaction

**Control State Minimalism**:
The principle that CCM should avoid a heavyweight persisted control-action state machine for Agent Control Path. Fault tolerance should come from Agent Resume Identity, structured queries over current CCM room, agent session, and TUI state, existing `nav`/`ss`/`transcript`/`status` semantics, Completion Reportback when available, and profile-level Orchestration Bookkeeping.
_Avoid_: workflow state machine, action ledger, event-sourced control plane

**Structured Nav Action**:
An Agent Control Path operation that exposes the actionable parts of existing `/cc nav` and `/cx nav` semantics without requiring Slack or Telegram. Structured Nav Actions include listing pending actions, inspecting a pending action, answering input, approving or denying available decisions, aborting or interrupting when supported, and clearing stale requests.
_Avoid_: TUI screenshot only, Slack button click, hidden approval

**Worker Prompt Handling**:
The Orchestrator's bounded use of Structured Nav Actions to resolve a Worker Agent's pending prompts. The Orchestrator may approve read-only access inside allowed inputs, answer clarifications already specified by the Worker Task, deny out-of-scope tool, path, or network requests, clear stale requests, or interrupt stuck workers; it must not approve Production Implementation writes beyond allowed paths, network, credential, or policy escalation, or scope-changing answers without a Review Gate.
_Avoid_: blanket approval, hidden scope change, human approval bypass

**Agent Transport Candidate**:
An external tool or protocol considered for launching, queueing, resuming, or inspecting agent sessions behind CCM. An Agent Transport Candidate may become an optional AgentDriver backend, but it should not define CCM's Agent Control Path or room orchestration semantics unless it meets CCM's integration, speed, and efficiency requirements better than a native implementation.
_Avoid_: control path, daemon replacement, orchestration source of truth

**Transport Candidate Gate**:
A hard evaluation criterion for adopting an Agent Transport Candidate. A candidate must not replace CCM's daemon or control plane, must preserve CCM room identity and Slack or Telegram UX, must support Agent Resume Identity, must support or cheaply wrap async start/send/stop/reportback, must not impose its own workflow state over Git-backed orchestration bookkeeping, and must beat or match a native Agent Control Path on integration cost, latency, throughput, and reliability.
_Avoid_: generic market survey, feature wishlist, vendor preference

**Agent Transport Candidate Discovery**:
A bounded discovery stage that evaluates open-source Agent Transport Candidates before implementing or replacing CCM's native Agent Control Path. The stage should produce Source Material, an independent Audit Report, and a recommendation to build native, wrap a candidate, or defer adoption.
_Avoid_: implementation stage, generic research, control-path design

**Completion Reportback**:
The CCM-level signal from a worker room back to the orchestrator agent when the worker is done, stopped, exited, or stale. Completion Reportback includes the worker room handle, agent session long id, room cwd, and last worker agent message sent to Slack or Telegram through CCM. Worker agents may explicitly say they are done, but CCM packages the reportback from observed worker room messages and session lifecycle; if the worker stops without explicit completion, CCM can report stopped or unknown with the last visible message. A stale or unknown reportback is a warning signal, not durable completion. Completion Reportback is useful for orchestration latency and user experience, while durable completion in Git-backed orchestration still comes from committed Source Material or integrated output.
_Avoid_: durable truth, final approval, git completion

**Freshness Metadata**:
CCM-provided query data such as last message time, agent session status, and pending prompt status. Freshness Metadata lets an Orchestrator or profile decide whether a worker is stale, but CCM Core should not define orchestration stale thresholds or recovery policy.
_Avoid_: orchestration timeout, durable completion, stage blocker

**Visible Completion Summary**:
A human-readable notification posted to the Orchestrator room's Slack or Telegram surface when a worker completes, stops, or becomes unknown. Visible Completion Summary should include the full last worker agent message sent through CCM, so humans can inspect the worker result without opening the worker room; if a platform limit applies, CCM should split, attach, or link the full message rather than silently truncating it. It complements structured Completion Reportback but is not parsed by the Orchestrator as the control signal.
_Avoid_: structured payload, durable completion, final approval

**Token Stream**:
Token-level agent output streamed to the Orchestrator. Token Stream is not required for Agent Control Path V1 because orchestration needs status, freshness, transcript or screen queries, last CCM-visible worker message, and Completion Reportback rather than token-by-token output.
_Avoid_: required V1 signal, coordination state, durable transcript

**Git-Backed Profile**:
An orchestration profile that uses a Coordination Branch and Orchestration Bookkeeping as durable truth while using CCM Core for Inspectable Rooms and agent execution. The Git-Backed Profile stores CCM handles in repo files, but it does not define CCM Core semantics.
_Avoid_: CCM core requirement, only orchestration model, hidden daemon

**Mechanical State**:
A small, current, mostly machine-readable bookkeeping file that records the active orchestration status. Mechanical State should not carry the narrative progress dashboard or accepted decision rationale. Mechanical State changes that affect resume or correctness must be committed; local scratch state is only an optimization and is disposable.
_Avoid_: work plan, decision log, transcript summary

**Work Plan**:
A human-readable orchestration dashboard that tracks stage progress, worker assignments, current findings, blockers, and recommended next actions. A Work Plan is distinct from Mechanical State and from accepted decision rationale.
_Avoid_: machine state, source report, final artifact

**Decision Log**:
A durable record of accepted decisions and rationale. A Decision Log is distinct from Mechanical State and from the current Work Plan.
_Avoid_: pending question, status dashboard, raw chat

**Process Inbox**:
Append-mostly process-time input from the Guiding Principal or human-facing ChatGPT conversation, normally under `docs/orchestration/<initiative-id>/inbox/`. `*.md` means unread by the Orchestrator; `*.md.done` means processed, not approved. Material effects should be reflected in decisions, stage, workers, or state files.
_Avoid_: initial intake replacement, approval marker, mutable todo list

**Recall Packet**:
A self-contained durable escalation packet from the Orchestrator to the external Guiding Principal. It points to original intake, stage, relevant inbox items, decisions, worker outputs, evidence, and a specific question so ChatGPT can best-effort recalibrate even after losing conversation context.
_Avoid_: vague ping, raw transcript dump, binding approval request

**Worker Agent**:
An agent assigned by the Orchestrator to execute a bounded Worker Task inside an independent Inspectable Room. A Worker Agent may write assigned implementation or research work in its own worktree/branch, but does not directly write Orchestration Bookkeeping. Its visible output is captured by the Orchestrator into Git. Any local or internal subagents used by a Worker Agent are implementation details of that worker prompt.
_Avoid_: autonomous strategist, direct Guiding Principal reviewer, hidden subagent, coordination-state writer

**Worker Task**:
A bounded assignment given to a Worker Agent with a stable `worker_task_id`, desired room name, prompt, expected output, completion rule, and escalation conditions. V1 uses prompt-guided task boundaries plus hard deny-listed categories rather than mandatory allowed write scopes.
_Avoid_: open-ended stage ownership, tiny mechanical instruction, context-filling assignment, implicit mutable task identity

**Complete And Stop**:
The normal Worker Agent lifecycle after the Orchestrator has consumed the worker output. For code workers, this means merged/integrated or explicitly abandoned. For read-only workers, this means the desired response was captured and accepted for stage use. Archive and cleanup may then run; follow-up normally becomes a new Worker Task and room.
_Avoid_: idle active worker, implicit follow-up, abandoned room, archive before capture

**Agent Resume Identity**:
The minimal durable identity needed to resume or inspect an agent session: the room cwd and the full agent session long id.
_Avoid_: room nickname, short session id, orchestration bookkeeping

**Worker State**:
The durable Git-backed status of a Worker Task, normally indexed in `workers.md` and detailed in append-mostly `reports/worker-<id>.md`. Worker State covers room creation/adoption, bot readiness, member sync, CCM binding, task send, running/attention, report, capture, validation, merge/integration, archive, and cleanup. Worker State is profile-owned, not CCM Core-owned.
_Avoid_: room nickname only, transient status, implicit session identity, worker-owned bookkeeping

**Dynamic Workflow**:
An explicit prompt instruction that tells an Orchestrator or Worker Agent to adapt its internal plan, sequence work, and fan out work when useful while staying inside its assigned authority. Orchestrator Dynamic Workflow fans out Inspectable Room Worker Agents under a current Stage Contract and records them in orchestration state; Worker Dynamic Workflow fans out internal subagents inside a Worker Task and does not need to be reported unless it changes scope, inputs, paths, outputs, or escalation conditions.
_Avoid_: fixed script, hidden scope expansion, unprompted autonomy

**Inspectable Room**:
A CCM room with a human-visible surface whose transcript, status, and execution context can be inspected by the Guiding Principal or human operator when needed. V1 worker-room creation targets Slack-visible rooms; Telegram creation/archive is unsupported rather than emulated. Inspectable Rooms make worker execution observable, but normal coordination authority still flows through durable artifacts rather than live watching.

**Orchestrator Room Flag**:
The minimal `isOrchestrator` binding flag that authorizes Agent Control Path room lifecycle calls from a room. The flag applies only to that room; worker rooms created from it do not inherit orchestration authority.
_Avoid_: transitive authorization, worker-room auto-admin, platform role, distributed lock
_Avoid_: mandatory watch channel, hidden execution, source of truth

**Worker Room Surface**:
The Slack-visible surface for a Worker Agent's Inspectable Room in V1. Agent Control Path V1 creates private Slack worker rooms, invites the CCM bot, and best-effort invites eligible same-workspace parent-room members. Telegram worker-room creation/archive is explicitly unsupported in V1 rather than emulated with threads or reused rooms.
_Avoid_: hidden worker, arbitrary workspace, fake Telegram room, overloaded parent room

**Worker Room Name**:
The deterministic Slack channel name requested for a Worker Agent's independent room, following `<orchestrator-room-name>-<worker-task-id>-<worker-topic>`. The stable `worker_task_id` is part of recovery semantics: after room creation starts, `worker_task_id` and `desired_room_name` are immutable. Same-task retries may adopt/repair the same-named Slack room; different-task name collisions create a suffixed room.
_Avoid_: anonymous worker, random room name, overloaded parent room, mutable task id

**Stage Gate**:
A lifecycle boundary where stage progress must stop, continue, pivot, or complete according to the Stage Contract. A Stage Gate defines when orchestration pauses; it does not by itself define who reviews or what approval artifact is required.
_Avoid_: review request, approval file, worker checkpoint

**Review Gate**:
A required pause for additional judgment at a Stage Gate or material blocker. In the revised profile, routine artifact integration does not require Guiding Principal review when durable docs/context are sufficient. The Orchestrator opens Guiding Principal recall when human-context judgment, reader-facing representation, or missing/ambiguous durable intent prevents confident progress.
_Avoid_: stage boundary, casual feedback, room status, routine approval ceremony

**Production Implementation**:
Work that can affect shipped behavior, runtime paths, user data, security posture, release packaging, CI or deployment, or a public API or contract. Worker Agents may perform assigned Production Implementation in their own worktrees/branches; the Orchestrator decides integration from durable context, tests, and review evidence, escalating only when human-context judgment is needed.
_Avoid_: code-only change, any file edit, documentation work, automatic human approval requirement

**Implementation Integration**:
The controlled path for worker implementation output to move from worker worktree/branch into accepted project state. Merge failure is not terminal; the Orchestrator should resolve routine conflicts, use fork subagents when useful, and either integrate or explicitly abandon/reject with recorded rationale before archive/cleanup.
_Avoid_: direct production push, source material commit, unreviewed merge, cleanup because merge is hard

**Material Conflict**:
A conflict in Source Material, audits, or worker output that can affect stage goal or scope, final recommendations, reader-facing claims, or risk, security, or user-impact framing. Material Conflicts require Orchestrator judgment and may require Guiding Principal recall when durable context is insufficient. Minor conflicts may be reconciled and recorded by the Orchestrator.
_Avoid_: wording mismatch, routine merge conflict, style disagreement

**Reconciliation Agent**:
An Independent Worker Agent used by the Orchestrator to analyze conflicts, compare Source Material, and propose a resolution when an inspectable independent artifact is needed. Routine integration review can be done by Orchestrator fork subagents without independent worker rooms, but stage-unblocking audit or independent source material requires an Inspectable Room.
_Avoid_: final decision maker, hidden reviewer, worker owner, routine local diff helper

**Reader-Facing Artifact**:
A final artifact written or approved by the Guiding Principal for an external reader, such as a Google Doc, design memo, or public-facing summary. Reader-Facing Artifacts are based on materials from the Orchestrator and Worker Agents, but those agents do not need to know the artifact's final destination or expression style.
_Avoid_: worker report, orchestration state, raw research notes

**Source Material**:
Durable material captured or produced by the Orchestrator for later synthesis, including worker reports, audits, findings, evidence, options, risks, source snippets, and integration notes. Source Material supports a Reader-Facing Artifact but is not itself the final expression.
_Avoid_: final draft, Google Doc section, publishable content, worker transcript as sole durable source

**Source Material Commit**:
An Orchestrator-owned commit that captures Worker Reports, Audit Reports, findings, decisions, or other Source Material into the coordination branch. Worker Agents do not directly write orchestration bookkeeping; the Orchestrator captures their visible output and references.
_Avoid_: uncommitted report, worker-only artifact, final artifact commit, direct worker bookkeeping write

**Worker Report**:
Source Material produced from a Worker Agent's visible output and captured by the Orchestrator into append-mostly Git files. A Worker Report preserves worker original response as much as practical, separates Orchestrator summary from worker output, records transcript/session references, and treats worker text as untrusted evidence rather than control instruction.
_Avoid_: final narrative, raw transcript as sole source, chain-of-thought dump, Orchestrator summary disguised as worker output

**Audit Report**:
Source Material produced by a Worker Agent to check another Worker Agent's output, its own Worker Report, implementation work, or reader-facing claims against a Stage Contract. An Audit Report can block a stage when it identifies unmet requirements, material risk, or unsupported claims. A self-audit is useful as a quality check but cannot unblock a stage; stage-unblocking audits require an independent Worker Agent.
_Avoid_: casual review, final approval, style feedback

**Independent Worker Agent**:
A Worker Agent whose context is clean enough to reduce bias from the artifact it is auditing or reconciling. Independence can come from a fresh session with the same model, a different model, or a Stage Contract requirement that limits shared context to specified artifacts; it does not require a different vendor unless the Stage Contract says so.
_Avoid_: same context reviewer, self-audit, biased continuation
