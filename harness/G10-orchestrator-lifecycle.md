# G10 — Orchestrator lifecycle discipline (generic worker-room harness mechanism, DRAFT for the owner)

Status: v1, 2026-09-22 (harness v2.9). Layer: GENERIC.

## Problem this mechanism solves

G1-G9 govern what a worker room or audit room does. None of them govern the standing
COORDINATING room itself: the process that waits on the owner between decisions,
rotates when its own context fills, boots a successor, and has to survive a host
restart it does not control. That gap let real procedure accumulate per-effort (rotation
write-ups, kickoff files, wait loops) with no generic doc backing it, so every fix to
this layer landed once per effort instead of once here. This doc is that missing
mechanism: continuity of ONE long-lived coordinating role across sessions, rotations and
restarts. It composes with G7 (deferred-work queue) and gets its tier declarations from
G9, the same as every other mechanism in this directory.

Each rule below states: what counts as a receipt, what it forbids, the measured origin,
and an overfit check (would a second, unrelated coordinating role apply this unchanged).

## 1. Owner-wait discipline

**Rule.** While blocked on the owner, the coordinating room arms at most ONE merged
watch: one mechanism covering every source it is waiting on (an escalations/log file, a
status directory, an owner-response channel) in a single loop. A watch-expiry wake does
NOTHING except re-arm the same merged watch and, only if content actually changed, hand
off to the normal event path. The room never separately polls a signal its own periodic
background process (the watchdog) already checks on its own cycle.

**Receipt.** At any point while blocked, exactly one active watch mechanism exists for
this room; its wake handler's only actions are "re-arm" or "hand off to the event path".

**Forbids.** Staggered or parallel watches on overlapping sources; a wake that writes to
durable state on its own; re-implementing inside the coordinating room a check the
watchdog already performs on a cycle.

**Origin.** 17 hours of owner silence cost 210 of 251 tool calls and 77% of a
generation's weighted token spend, produced by three staggered 30-minute watches each
re-arming and re-reading independently.

**Overfit check.** States no channel (chat, PR comments, a shared doc) and no file
naming convention; any coordinating role that waits on an external decision-maker while
a background process already watches the same sources applies this unchanged.

## 2. Rotation floor, enforced

**Rule.** Rotation happens only when context is at or above the soft ceiling AND a
quiet boundary is reached; a quiet boundary alone never triggers it. Rotating below the
ceiling requires an explicit owner exception, recorded in the durable decision log
BEFORE the rotation proceeds. The rotation procedure runs a mechanical preflight and
quotes its output in the rotation record; it does not rotate on its own say-so that
context "must be" high enough.

**Mechanical check.** `hooks/rotation-preflight.py TRANSCRIPT --floor N [--exception
FILE]` reads the coordinating room's own transcript, computes current context from the
last usage record, prints it, and exits non-zero below the floor unless an exception
marker file is present (created only after the exception is recorded in the decision
log). Tier: HARD once wired as a gate on the rotation action itself; BOOT in the
meantime (the rotation procedure text requires running it and quoting the line).

**Receipt.** The rotation record quotes the preflight's printed `context=... floor=...`
line; a below-floor rotation additionally quotes the decision-log entry that predates it.

**Forbids.** Citing "quiet boundary" alone as the rotation reason; rotating below the
floor without a decision-log entry written before the rotation.

**Origin.** Three consecutive rotations, each around 70-80% of the soft ceiling, each
citing "quiet boundary" as the sole justification, each costing a boot on the order of
the ceiling itself.

**Overfit check.** The floor and the transcript path are parameters, not numbers baked
into the rule; the mechanism (transcript-derived usage, an exit code, an exception
marker) applies to any context-bounded coordinating session regardless of its own
ceiling.

## 3. Successor boot tiering

**Rule.** A rotation successor reads, IN FULL, only: the save-game, the head-state file
(judgments not yet committed to the save-game), the kickoff pointer, and a bounded tail
of the durable decision/event log. Everything else is opened on demand, when its own
situation actually arises, never as part of boot. The successor records its own context
at a fixed early checkpoint (e.g. +25 minutes) in its takeover record, against a target
stated relative to the static prefix (skills/CLAUDE.md/plugin boot cost), never as a
bare absolute.

**Receipt.** The takeover record's context-at-checkpoint line, present for every
rotation, compared against the stated target.

**Forbids.** A boot read order that opens index-only material in full "just in case";
treating the tier boundary as advisory once a successor already has a large window —
the point is boot COST, not boot capacity.

**Origin.** Boot context at the fixed early checkpoint rose from a baseline to a
substantially higher mean and an even higher peak across generations, before any actual
work began, tracking growth in the very files the wider read order kept opening.

**Overfit check.** Framed as tiered file CLASSES (save-game / head-state / kickoff /
log-tail vs. everything-else), never by filename; any coordinating role with an
inheritable state file and an event log applies it unchanged.

## 4. Hold-cycle duties

**Rule.** After H hours with no owner turn, the coordinating room's next report to the
owner re-lists every owner-owed item that does NOT depend on the pending decision,
alongside the pending item itself — never a bare "still waiting" line. Before treating
any decision as still pending, the room re-fetches the cited comment/thread by its id;
a reply count is never used as evidence of an answer or its absence, since an editor can
change a thread's content in place without changing that count.

**Receipt.** The hold-cycle report names each non-blocking owed item by id, and asserts
the pending item's status only after a live, timestamped re-fetch of its own thread.

**Forbids.** Repeating an identical "nothing to do" line across multiple hold cycles
while other owed items sit unmentioned; inferring an answer (or its absence) from a
stale cached read.

**Origin.** 17 hours with the same "nothing to do" line while five non-blocking
owner-owed items sat unmentioned, and a decision the owner had in fact edited in place
was miscounted as untouched because its reply count had not moved.

**Overfit check.** "Owner-owed item" and "pending decision" name no specific tracker or
channel; the live-re-fetch rule applies to any system where a reviewer can edit feedback
in place without changing a naive reply-count signal.

## 5. Planned-restart hygiene

**Rule.** Before any PLANNED daemon/host restart the coordinating room knows about in
advance, it stops its own background watches first, so its restarted process does not
self-start a turn from orphaned-task notices before its own tool servers have settled.
UNPLANNED restarts are exempt: the cost of a self-started first turn is accepted rather
than engineered around, since there is no advance point at which to intervene.

**Receipt.** A planned-restart record names the watch-stop step and its timestamp,
preceding the restart timestamp.

**Forbids.** Treating a self-started first turn after a PLANNED restart as ordinary;
building the same guard for unplanned restarts, where there is nothing to gate on.

**Origin.** The double-recache failure mode (a first post-restart turn that re-reads and
re-writes its entire context) was measured only in rooms whose first post-restart turn
was self-started, never in rooms whose first turn was owner- or peer-initiated.

**Overfit check.** Names no specific process manager; any coordinating role with
background watches and a host/daemon it does not control directly applies the same
stop-before-restart step.

## 6. Save-game hygiene

**Rule.** The save-game is rewritten WHOLE at every checkpoint and rotation, never
appended to. The predecessor's final-save paragraph is ARCHIVED as a durable-log row (or
a pointer to an archive file it points at), never prepended to the new save-game's head.

**Mechanical check.** `hooks/save-game-validator.py SAVE_GAME STATE_FILE [--cap-bytes
N]` fails when the save-game's first line is longer than it was at the last PASSING
check (line-1 growth is the signature of a paragraph getting prepended instead of
archived), or when the file exceeds the size cap. Default cap 32768 bytes, set with
slack above a measured healthy save-game (~10KB) and well below a measured pathological
one (112KB total, 87KB on line 1 alone), so it trips long before accumulation reaches
production scale; instances tune the cap to their own numbers. A rejected checkpoint
leaves the state file at the last-good length, so the next run still compares against
good, not bad. Tier: HARD once wired as a gate at checkpoint time; BOOT in the meantime.

**Receipt.** The validator's exit code and printed line at every checkpoint.

**Forbids.** Any save-game edit that reads as "append a section" rather than "rewrite
the whole file"; carrying a previous session's sign-off prose forward instead of a
one-line pointer to its archived form.

**Origin.** Line-1 accumulation of tens of kilobytes per rotation, compounding until the
save-game's first line alone dwarfed a healthy file's entire size.

**Overfit check.** Stated purely in terms of file size and first-line length, with no
instance-specific section names; applies to any single, wholly-rewritten state file
regardless of what it is called.

## 7. Takeover exam: scope cut

**Rule.** The self-graded takeover exam is REMOVED from the rotation/kickoff procedure
and from the watchdog's periodic regeneration job. The independent ground-truth
re-derivation step (the successor re-verifies live state against the system of record,
never against inherited prose) is KEPT: it is a different mechanism, and it does catch
divergence.

**Receipt.** Rotation/kickoff procedure text contains no exam-answering step; the
watchdog's periodic-job list contains no exam-generation entry (harness v2.9:
`watchdog-template.sh` carries no exam code path at all).

**Forbids.** Reintroducing a self-graded artifact as a stand-in for this step without a
new receipt showing it catches something the ground-truth re-derivation does not.

**Origin.** The self-graded exam scored a perfect result in the large majority of
sampled rotations, was skipped outright in the rest, and never once caught a divergence
in its measured lifetime, while its generation cost recurred on every cycle regardless.

**Overfit check.** The cut is stated by mechanism (a self-graded artifact with no
independent check, recurring cost, zero measured catch rate), not by name; any harness
finding a self-graded step with a comparable record over a comparable sample retires it
the same way, whatever it is called there.

## 8. Decision-packet SLA

**Rule.** A watchdog row escalates when a posted owner decision packet remains
unanswered past T hours, keyed to the packet's own id or a status marker written when it
was posted — never to a generic "time since last owner turn", which a reply to
something else would satisfy incorrectly.

**Mechanical check.** `harness/watchdog-template.sh` (v2.9): `#decision=<id>\t
<posted_epoch>\t<note>` rows in the expectations file escalate once per id past
`DECISION_SLA_HOURS` unless an answered marker exists for that id. Tier: BOOT/HARD — the
watchdog runs this on every cycle unconditionally, the same as its other passive checks.

**Receipt.** The escalation names the packet's id and the elapsed hours; a packet
answered before T hours produces no escalation.

**Forbids.** Treating an owner reply to a DIFFERENT thread as satisfying an outstanding
packet's SLA; silence past T hours with no escalation.

**Origin.** A 17-hour unanswered decision produced no escalation at any point in that
window.

**Overfit check.** Keyed to "a posted decision packet" and "a message id or status
marker", not to any specific messaging surface; applies to any watchdog with a
per-packet identifier, whatever the transport underneath it.

## Relationship to the rest of the harness

Items 1-7 concern the coordinating room's own continuity; they compose with, but do not
replace, G7 (deferred-work queue: work identified but not yet executed) and get their
tier declarations from G9. Whether the harness's own learning loop is actually being fed
— the second half of the measured problem behind item 8 — is a G4 (learning substrate)
rule, not repeated here; see G4's inbox-touch check.
