# G0 — Derivation protocol (generic worker-room harness mechanism, DRAFT for the owner)

Status: v2.1, 2026-09-04 (v1 draft 2026-09-01). Layer: GENERIC. This is the entry mechanism: how any
project orchestrator adopts generic mechanisms without the generic layer coaching it.

## Roles, sharply

- The GENERIC layer (co-design/harness session) revises and validates mechanisms. It
  speaks to project orchestrators ONLY through (a) published G-docs and (b) mechanical
  intake notices (pointers + work-item facts, never method).
- The PROJECT orchestrator derives instances and executes. It follows its harness, which
  includes this protocol — not ad-hoc instructions from the generic layer.

**Anti-coaching rule** (provenance: the owner 2026-09-01, "又做裁判又做运动员"): if the generic
layer feels the need to write bespoke how-to instructions for one project, the G-doc is
underspecified — fix the doc, never send the instructions. Mechanical routing (filing
the intake, pointing at paths) is always allowed; method content in the routing is not.

## The protocol (what a project orchestrator does on an adoption intake)

1. Read the named G-doc(s), current version.
2. Derive the project instances in the PROJECT'S OWN conventions (file locations,
   naming, existing structures — e.g. reconcile a new queue mechanism with an existing
   queue rather than duplicating it).
3. Record a derivation note per mechanism: which G-doc + date/version derived from,
   where the instance artifacts live, every deviation from the G-doc and WHY. Deviations
   are legitimate (projects differ) and are DATA — they feed G-doc revision.
4. Execute any work item attached to the intake THROUGH the freshly derived instances.
5. Report per the project's normal protocol.

## Validation loop

The FIRST derivation of each mechanism is scored by the generic layer against the
G-doc's own contract (framework-transfer test): a compliant derivation proves the doc
teaches; systematic misses convict the doc, not the deriver. Scoring reads the
derivation note + artifacts only; the generic layer's own reference implementations
(when they exist) stay sealed until scoring is done.

## Versioning and inheritance (v2, 2026-09-04)

Provenance: three efforts now hold SEALED COPIES of this directory (tag = source of
truth; two further adopting efforts = copies at port time). A rule improved here
after a port does not reach the copies by itself, so "inheritance" must be a mechanism:

1. Every G-doc carries a `Version:` line; `CHANGELOG-G.md` (this dir) records each bump
   with provenance (which escape/deviation/ruling produced it).
2. Every effort's derivation-notes record the generic version each instance derived from.
3. On a bump, the generic layer files ONE mechanical intake per adopting effort (its
   ESCALATIONS channel): pointer to CHANGELOG-G entry + the changed G-docs. No method.
4. The effort re-derives ONLY the delta (per this protocol), bumps its recorded version,
   and records deviations. A delta not derived within two daily REVIEW cycles is a
   deviation in itself (report it; do not silently stay on the old version).
5. Step 1 of the protocol is amended: on ANY intake the orchestrator enumerates ALL
   G-docs and states which ones the intake touches (provenance: tag orch derived only
   the G-docs an intake listed, so the audit-charter instance was never created).

## Portability test (v2): what may enter the generic layer

A rule, row, or hook enters this directory only if it can be stated for at least two
artifact classes or two adopting domains (code PR to an OSS project; internal
persistence/SPI tickets; research/spec artifacts; documents submitted to a community).
Each generic entry carries a one-line PORTABILITY NOTE naming a second reading. Anything
that needs a project noun (a table name, an HTTP status, a repo) to be stated is an
INSTANCE and lives in the effort's derived files; the generic entry names the class the
instance belongs to. The tag effort is n=1 of the seeding domain; treat its wording as
a candidate, never as the definition.

## Single source of truth and refresh (v2.1, 2026-09-04) — supersedes "notify" in v2 step 3

Owner ruling (2026-09-04): the co-design session is scaffolding and will be removed; the
generic layer must survive it. Therefore:
1. **One source.** This directory is `harness/` inside the claude-channel-mux plugin repo (the
   CCM checkout); versions ride CCM's history and `CHANGELOG-G.md`. `<repo>   generic-harness` is a symlink to it (v2.2, 2026-09-04). Efforts hold NO sealed copies; any path inside an effort that used to hold a
   copy is a symlink to the source. Blind rooms still receive copied excerpts (task,
   charter) from their launcher — the room allowlist is unchanged.
2. **Automatic refresh.** The CCM daemon wires `hooks/harness-boot.py` (which runs
   `harness-sync.sh --check <orch-dir>`) into every room's SessionStart; no per-effort wiring.
   The room's `<orch-dir>` is `<cwd>/.ccm-harness/<name>` where `name` is the harness recorded on
   the room binding (inherited from the parent room, or the single candidate at creation;
   `/ccm harness <name>` to set or change live). Non-CCM sessions may still wire the script by hand. Every boot — new session, resume, rotation successor — compares the
   source version with `<orch-dir>/generic-version` and, when behind, injects the
   CHANGELOG delta and the derive instruction into context. Silent when current.
3. **Explicit refresh.** The owner (or anyone) runs `/harness-refresh` in any session (a
   user skill wrapping `harness-sync.sh --refresh`), or types the command directly; it
   prints the state even when current and re-issues the derive instruction.
4. **Recording.** After deriving a delta the orchestrator writes `vN <commit>` to
   `<orch-dir>/generic-version` and a derivation note. The watchdog daily REVIEW re-runs
   the check as backstop; behind for two REVIEW cycles = deviation.
5. **Ownership after scaffolding.** Generic revisions are not a session's job. Deviations
   accumulate in this repo's DEVIATIONS-inbox.md (any effort appends). When the inbox holds
   >= 5 unfolded entries, or on the owner's word, whichever orchestrator notices spawns one
   disposable GENERIC-REVISION room with materials = G-docs + inbox + CHANGELOG; its output
   is a branch in this repo proposing v(N+1) with per-change provenance and portability
   notes. The owner's nod merges and tags; the SessionStart check then propagates it to
   every effort. No standing "harness session" exists in this design.
