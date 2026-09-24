# G10 — Orchestrator lifecycle discipline (generic worker-room harness mechanism, DRAFT for the owner)

Status: v3, 2026-09-24 (harness v2.12; v2 2026-09-22, harness v2.11; v1 2026-09-22, harness v2.9). Layer: GENERIC.

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

**Clarification (v3).** An expiry wake appends NO row to the durable ledger. The ledger
records state changes; a wake whose content check found nothing changed is not a state
change, and its only side effect is the watch's own re-arm. A row is written only when
the wake hands off to the event path because something did change.

**Receipt.** At any point while blocked, exactly one active watch mechanism exists for
this room; its wake handler's only actions are "re-arm" or "hand off to the event path".
(v3) The ledger carries no row whose only content is "watch expired, re-armed"; two
consecutive ledger rows never differ only in their timestamp.

**Forbids.** Staggered or parallel watches on overlapping sources; a wake that writes to
durable state on its own, including a ledger row for the expiry itself; re-implementing
inside the coordinating room a check the watchdog already performs on a cycle.

**Origin.** 17 hours of owner silence cost 210 of 251 tool calls and 77% of a
generation's weighted token spend, produced by three staggered 30-minute watches each
re-arming and re-reading independently. (v3) 84 near-identical ledger rows in two days,
each recording nothing but an expiry wake and its re-arm.

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

**Clarification (v2).** Tier A — the material read IN FULL at boot — is exactly four
file CLASSES: the save-game, the head-state file, the kickoff pointer, and a bounded
tail of the durable decision/event log (the same four the rule above already names; this
clarifies what does NOT belong in that set). Contract/spec sections and older head-state
items are index-only at boot: the kickoff lists each of them BY NAME next to a "read
when <trigger>" note, and the successor opens the named material only once a real
judgment actually needs it, never earlier because it "might". This narrows a wider
practice — reading contract/spec material before judging anything AGAINST it — to mean
before that specific judgment, not before all work of any kind.

**Receipt.** The takeover record's context-at-checkpoint line, present for every
rotation, compared against the stated target.

**Forbids.** A boot read order that opens index-only material in full "just in case";
treating the tier boundary as advisory once a successor already has a large window —
the point is boot COST, not boot capacity; a kickoff that lists an index-only section
without a "read when" trigger (an untriggered listing is read at boot by default, which
defeats the tiering).

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

**Clarification (v3).** "Re-fetch the cited thread by its id" includes the thread's
reactions endpoint, wherever the surface has one. An owner reaction on the cited comment
counts as an answer: a reviewer who accepts with a one-click acknowledgement has
answered, and re-asking the question is a second ask of a decided item. The re-fetch
reads the comment body, its updated-at time, AND its reactions before asserting
"pending".

**Hold-cycle checklist (v3, per executing room).** Beyond the owed-item list, every
hold-cycle report prints, for each executing room: the transcript's last assistant
stop_reason and the first 60 characters of that entry's text, not only the transcript's
mtime. A fresh mtime with an idle pane says nothing about whether the last turn ended
normally; the stop_reason and text do (see rule 11).

**Receipt.** The hold-cycle report names each non-blocking owed item by id, and asserts
the pending item's status only after a live, timestamped re-fetch of its own thread,
reactions included; the report carries one stop_reason + text line per executing room.

**Forbids.** Repeating an identical "nothing to do" line across multiple hold cycles
while other owed items sit unmentioned; inferring an answer (or its absence) from a
stale cached read; calling a decision pending on a body-only re-fetch that never read
the reactions; a per-room liveness line that reports only a transcript mtime.

**Origin.** 17 hours with the same "nothing to do" line while five non-blocking
owner-owed items sat unmentioned, and a decision the owner had in fact edited in place
was miscounted as untouched because its reply count had not moved. (v3) A decision was
re-asked after the owner had already answered it with a reaction on the cited comment;
and a room's dead turn sat behind a fresh mtime for 7 minutes (rule 11).

**Overfit check.** "Owner-owed item" and "pending decision" name no specific tracker or
channel; the live-re-fetch rule applies to any system where a reviewer can edit feedback
in place without changing a naive reply-count signal, or acknowledge it through a
reaction-like side channel that a body read never sees.

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

## 9. Shared host-resource isolation

**Rule.** A host resource with cross-room blast radius — a per-user build daemon, a
shared cache, a port, anything one room's stop/reset/kill can affect for a room that
never touched it — is used only behind a per-room isolation knob (a per-room home for
the daemon, a separate cache path, a distinct port) or a lease (a file one room holds
while using the resource, that a second room checks before touching it). A room never
issues a host-wide stop/kill/reset of a resource it does not exclusively own; a
directive that asks a room to use such a resource names the isolation knob or the lease
file it must use, not just the resource.

**Receipt.** The directive that assigns the resource to a room names, in text, either
the per-room isolation knob (e.g. a per-room daemon home path) or the lease file path;
a directive naming neither is incomplete, whatever else it says about the resource.

**Forbids.** A room-side convention of "stop the shared daemon before I use it, start it
after" with no isolation or lease, since a second room running the identical convention
concurrently stops the first room's still-running use; a host-wide command (stop-all,
kill-by-name) issued to free a resource for one room when the command's blast radius is
not scoped to that room alone.

**Origin.** One room's routine per-compile stop of a shared, per-user build daemon
killed a second room's already-running test gate three separate times, because the
daemon has host/user scope, not per-room scope, and no isolation or lease existed to
keep one room's cleanup step from reaching into another room's in-flight work.

**Overfit check.** Names no specific daemon, cache, or port; the mechanism (isolation
knob OR lease, named in the directive, never a bare host-wide stop) applies to any
shared host resource two concurrently running rooms could otherwise contend for.

## 10. Time-sensitive state travels with the transmission, never the file alone

**Rule.** A fact that is only true for a bounded window — a gate is free right now, a
lock is held, "run nothing until X clears" — is stated authoritatively only in the
transmission that DELIVERS a directive at send time (the message or pointer the sender
fills in when handing the directive over), never solely in the directive file's own
text. A directive file is read whenever its recipient gets to it, including much later
than when it was written or after a second transmission has updated the same claim; a
file cannot know when it will be read, so it cannot carry a claim whose truth depends on
when reading happens. When a directive file states time-sensitive status at all, the
transmission's own statement at delivery time is the one that governs if the two ever
disagree.

**Receipt.** The delivery transmission (not the directive file) contains the live
value of every time-sensitive fact the directive depends on, timestamped at send time.

**Forbids.** Writing "run nothing until <condition>" (or any other bounded-window claim)
into a directive file's own text as its sole statement; treating a directive file's
static claim as still authoritative once a later transmission has restated the same
fact differently, instead of treating the later transmission as the current truth.

**Origin.** A directive file's own text said to run nothing until a shared gate was
free, while the transmission that delivered it — sent later than the file was written —
said the gate was free as of the send. The two disagreed about the same fact; the
receiving room had to notice the disagreement and resolve it by taking the later
transmission over the file, which worked here only because that room happened to check
both and flag the conflict.

**Overfit check.** Names no specific gate, lock, or build tool; any handoff where a
directive is authored once but delivered (or re-delivered) at a different, later moment
applies this unchanged — the distinction is send-time transmission vs. static file, not
any particular resource.

## 11. Turn-death visibility

**Rule.** A worker's turn can end on an API error: the transcript gains an assistant
entry carrying the error text (stop reason stop_sequence), the pane returns to an idle
prompt, and every liveness signal the fleet reads (process alive, transport connected,
transcript recently touched) stays green. Nothing the room owns fires, because the room
never reached the point of writing a status file. Therefore: (a) the fleet watch (the
watchdog template, or a hook the coordinating room arms) counts API-error assistant
entries per executing room's transcript and emits an event on any increase; (b) the
hold-cycle checklist prints, per executing room, the last assistant stop_reason and the
first 60 characters of its text (rule 4, v3), never the transcript mtime alone; (c) the
response to such an event is a standard CONTINUE directive, sent to the same room, with
this shape:

```
CONTINUE — your last turn ended on an API error at <time>; nothing you completed is lost.
On-disk state as I read it now:
  dirty files: <list, or none>
  last status file you wrote: <name + time>
  backup ref: <the ref or tag taken before your work began>
Next plan step: <the one step that was in flight, stated from the plan, not from memory>
Rules: on a repeat API error, retry the SAME step; never redo a step listed as completed;
never end a turn with a half-applied edit — finish or revert it first.
```

**Receipt.** The watchdog's TURNDEATH event naming the room, the old and new counts, and
the first 60 characters of the last error text (`harness/watchdog-template.sh` v2.12,
`API_ERROR_RE`); the hold-cycle report's per-room stop_reason line; the CONTINUE
directive's on-disk-state block, filled from a live read, in the room's transcript.

**Forbids.** Calling a room live on the strength of a running process, a connected
transport, an idle prompt, or a recent mtime; a CONTINUE that restates the whole plan
instead of the one step in flight; a CONTINUE written without reading the room's disk
state first.

**Origin.** Two rooms, 7 minutes and 37 minutes of lost work respectively, each found
only by a hold-cycle read of the transcript tail, each with every liveness signal green
throughout.

**Overfit check.** Names no transport, host, or model route: any fleet whose workers
write a per-session transcript with a stop reason applies the counter, the checklist
line and the CONTINUE shape unchanged.

## 12. Model-route liveness

**Rule.** A model route can fail independently of the others: the coordinating room's
own route stays up while the routes its workers and verify subagents are pinned to
return auth or server errors, so every worker dies (or cannot spawn) while the
coordinator lives and sees nothing wrong with itself. Therefore: (a) the boot checklist
and every hold cycle probe each configured route with a minimal call and record the
alive set (`hooks/route-probe.sh`; the watchdog re-probes every `ROUTE_PROBE_SECONDS`
and escalates on a change in the set); (b) a verify or subagent spawn names its model
route explicitly, chosen from the current alive set, never inherited from the harness or
host default; (c) every owner-side publish/patch script the coordinating room may need
(push, description patch, comment post) is runnable by the coordinating room itself
without a worker room: absolute paths, no state that lives only inside a room.

**Receipt.** The alive-set file (`<checks dir>/routes.alive`) with a probe time no
older than one hold cycle; the spawn command or directive naming its route; the
publish/patch script running from the coordinating room's own cwd in the outage record.

**Forbids.** Spawning a verify subagent on an unnamed (default) route; treating the
coordinator's own successful calls as evidence the workers' routes are up; a publish
script that reads room-side state (a relative cd, a room-local file) and so cannot run
when the rooms are dead.

**Origin.** One outage in which the owner re-pinned every room by hand while the
coordinator kept running on the one live route, and the verify subagent died on the
default route; a second, partial outage of the same shape while this rule was being
drafted.

**Overfit check.** "Route" names no vendor, model, or gateway; any deployment where
rooms and coordinator can sit on different model endpoints, each with its own failure
mode, applies the probe, the explicit-route spawn and the room-free scripts unchanged.

## 13. Re-chain verified only at the new base

**Rule.** A re-chain or rebase that reports "conflicts: none" is not verified. It is
verified only when the re-chained tree compiles at the new base and the affected tests
run there, in that order, before any formatting pass or amend. An upstream change can
merge with zero conflicts and still break the build: a signature or helper change lands
in regions the downstream commit never touched, so git has nothing to report while every
downstream call site is now wrong. The directive that orders a re-chain names the
compile and test commands; the room's report quotes their result at the new base ref.

**Receipt.** The compile/test line at the new base ref (ref, command, exit code, one
output line) in the room's report; a conflict count is context, never the receipt.

**Forbids.** Closing a re-chain on "conflicts: none" or on a structural heuristic (a
paren counter, a duplicate-declaration grep) in place of a compile; running the
formatter or amending before the compile at the new base; attributing a failure that
appears only after re-chaining to the downstream commit without first isolating at the
new base without it.

**Origin.** An upstream signature change rebased cleanly and did not compile; a second,
earlier zero-conflict duplicate-declaration case of the same class.

**Overfit check.** Names no language, build tool or forge; any stacked-change workflow
where a base moves underneath a commit applies "compiles and tests at the new base"
as the only receipt.

## Relationship to the rest of the harness

Items 1-7 and 9-13 concern the coordinating room's own continuity and its directives to
other rooms; they compose with, but do not replace, G7 (deferred-work queue: work
identified but not yet executed) and get their tier declarations from G9. Whether the
harness's own learning loop is actually being fed — the second half of the measured
problem behind item 8 — is a G4 (learning substrate) rule, not repeated here; see G4's
inbox-touch check.
