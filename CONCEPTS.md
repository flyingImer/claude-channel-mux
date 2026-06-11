# Concepts

Shared domain vocabulary for this project — entities, named processes, and status concepts with project-specific meaning. Seeded with core domain vocabulary, then accretes as ce-compound and ce-compound-refresh process learnings; direct edits are fine. Glossary only, not a spec or catch-all.

## CCM Orchestration

### Guiding Principal
A strategic steering role that supplies human-context judgment, quality bars, framing, and key review decisions for an orchestration initiative.

The Guiding Principal is not a routine worker-room operator. They should not be required to bind rooms, start agents, send worker prompts, debug worker execution, capture reports, or archive rooms unless explicitly assigned that artifact as the work product.

### Orchestrator
The parent-room agent responsible for turning durable human and Guiding Principal context into autonomous worker coordination, bounded low-level execution decisions, evidence capture, integration or rejection, and cleanup.

The Orchestrator owns worker-room lifecycle through Agent Control Path and escalates only when durable context and stage policy are insufficient.

### Worker Room
A visible CCM room dedicated to one bounded Worker Task and controlled by the parent Orchestrator rather than by direct human setup.

Human or Guiding Principal presence in a Worker Room is optional inspection. Required manual intervention inside a Worker Room is degraded recovery or orchestration failure, not successful orchestration.

### Agent Control Path
The structured parent-room control surface that lets an Orchestrator operate worker-room lifecycle without simulating chat commands or requiring humans to type in worker rooms.

For worker execution, Agent Control Path must make bind, start/resume, send, capture/reportback, and archive steps explicit so the Orchestrator can prove what happened without entering the worker room manually.

### Worker Task
A bounded assignment sent to a worker agent with objective, inputs, non-goals, output format, and acceptance evidence.

A Worker Task should be durable in orchestration state before room creation starts and should be delivered by the Orchestrator through Agent Control Path after the worker room is bound and the worker agent is running.

## Relationships

The Human and Guiding Principal steer intent and review quality. The Orchestrator owns execution against that durable context. Worker Rooms host bounded Worker Tasks. Agent Control Path is the mechanism that lets the Orchestrator control Worker Rooms without turning humans or the Guiding Principal into routine operators.
