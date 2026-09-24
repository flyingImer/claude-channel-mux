#!/usr/bin/env bash
# Generic Tier-0 watchdog (harness v2.12). One script for every effort; the effort supplies a conf file.
# usage: watchdog-template.sh <watchdog.conf>          (the effort's watchdog.sh is a thin wrapper: exec this)
#        WATCHDOG_ONCE=1 watchdog-template.sh <conf>   (single cycle, for tests and derivation smoke checks)
# Contract: the effort's WATCHDOG.md. Passive status-file events + expectation sweep + deadlines + active checks
# + context budgets + decision-packet SLA (G10 rule 8) + daily REVIEW (+ inbox-touch check, G4) + GC.
# Escalations go to ESCALATIONS.md, folds to digest.md. LLM one-shots run through ${CLAUDE_BIN:-claude} (G9 v2.5),
# model haiku. (v2.9) Takeover-exam regeneration is REMOVED (G10 rule 7): the self-graded exam never caught a
# divergence in its measured lifetime; the independent ground-truth re-derivation step it duplicated stays in the
# rotation procedure itself, not in this script.
# (v2.11) The orchestrator burn row in $MET is keyed on the coordinating room's own SESSION id
# (the transcript's own filename), not on a role label like "orch" that spans every generation:
# a label spanning generations makes every rotation's burn indistinguishable in the metrics file.
# (v2.12) Three additions. (a) Timing is decided here, never by the triage one-shot: a status file whose
# mtime precedes its expectation's deadline is ON TIME whatever the gap, and is never escalated for timing;
# only a file missing at the deadline, or arriving after it, is a deadline fault. (b) Turn-death visibility
# (G10 rule 11): per executing room's transcript, the count of assistant entries carrying an API-error text
# is tracked and an increase is an event, because a turn that dies this way leaves the pane idle and every
# liveness signal green. (c) Model-route liveness (G10 rule 12): each configured route is probed with a
# minimal call every ROUTE_PROBE_SECONDS via hooks/route-probe.sh; the alive set is recorded and a change
# in it is an event, because one route can stay up while every room on another route dies.
set -u
CONF="${1:?usage: watchdog-template.sh <watchdog.conf>}"; [ -f "$CONF" ] || { echo "watchdog: conf not found: $CONF" >&2; exit 2; }
# ---- conf keys (defaults) ----
STATUS_DIR=""; ORCH_DIR=""; EXP=""; MET=""; REVIEW_CMD="true"; SOFT_CTX=700000; HARD_CTX=850000
ROTATION_DOC="ROTATION.md"; REPLACE_DOC="room-procedures"; INTERVAL_DEFAULT=15
DECISIONS_DIR=""; DECISION_SLA_HOURS=24; DEVIATIONS_INBOX=""
API_ERROR_RE='^API Error'; ROUTES_FILE=""; ROUTE_PROBE_SECONDS=900
ACT_RE='.*/[0-9]+-(PLAN_READY|BLOCKED|NEED_RULING|NEED_EJ|DONE[^/]*|DESCRIPTION_READY|MOVEMENT)[^/]*\.md'
TRIAGE_RE='.*/[0-9]+-(APPROVED_ACK|EXEC_STARTED)[^/]*\.md'
# shellcheck disable=SC1090
. "$CONF"
: "${STATUS_DIR:?conf must set STATUS_DIR}"; : "${ORCH_DIR:?conf must set ORCH_DIR}"
EXP="${EXP:-$ORCH_DIR/expectations.tsv}"; ESC="$ORCH_DIR/ESCALATIONS.md"; DIG="$ORCH_DIR/digest.md"
CK="$ORCH_DIR/.checks"; MET="${MET:-$ORCH_DIR/metrics/fleet-ctx.csv}"; ESCALATED="$ORCH_DIR/.deadline-escalated"
WATCHDOG_LOG="${WATCHDOG_LOG:-$ORCH_DIR/watchdog.log}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"; SWEEP="$HERE/../hooks/expectation-sweep.sh"
ROUTE_PROBE="$HERE/../hooks/route-probe.sh"
CLAUDE="${CLAUDE_BIN:-claude}"
mkdir -p "$CK" "$(dirname "$MET")"; touch "$ESC" "$DIG" "$ESCALATED"
exec 9>"$ORCH_DIR/.watchdog.lock"; flock -n 9 || { echo "watchdog already running (lock $ORCH_DIR/.watchdog.lock)" >&2; exit 1; }
# The last-seen stamp persists across restarts, so events that land while the watchdog is down (daemon
# restart, unit recreation) are still seen on the next cycle instead of silently aged out.
STAMP="$ORCH_DIR/.watchdog.stamp"; [ -f "$STAMP" ] || touch "$STAMP"; NEXTSTAMP=$(mktemp)
esc() { printf -- '## %s %s %s\n%s\n' "$(date -u +%FT%TZ)" "$1" "$2" "$3" >> "$ESC"; }
fold() { printf -- '- %s %s %s\n' "$(date -u +%FT%TZ)" "$1" "$2" >> "$DIG"; }
ctxof() { tail -300 "$1" | jq -r 'select(.message.usage.cache_read_input_tokens != null) | (.message.usage.input_tokens + .message.usage.cache_read_input_tokens + .message.usage.cache_creation_input_tokens)' 2>/dev/null | tail -1; }
llm() { "$CLAUDE" -p --model haiku 2>/dev/null | tail -1; }
# decision_answered ID: an answered marker exists for this decision-packet id (G10 rule 8; the SLA is keyed to the
# packet's own id/marker, never to generic "time since last owner turn")
decision_answered() { [ -f "$DECISIONS_DIR/$1.answered" ]; }
# triage_file FILE TAG: haiku triage of one changed status file against its expectation rows (also used by the sweep)
triage_file() {
  local F="$1" TAG="$2" ROWS V
  ROWS=$(grep -v '^#' "$EXP" 2>/dev/null | awk -F'\t' -v f="$F" '{r=$2; gsub(/\./,"\\.",r); gsub(/\*/,".*",r); if (f ~ "^"r"$") print $0}')
  if [ -z "$ROWS" ]; then esc EVENT "$F" "no matching expectation"; return; fi
  # (v2.12) Timing is computed HERE from the file's mtime against each matching row's deadline and handed to
  # the one-shot as an authoritative line; an on-time file is never escalated for timing, whatever reason the
  # one-shot gives (a timing-worded ESCALATE on an on-time file is folded, tagged timing-ok).
  local FMT TIMING="" LATE=0 RID RGLOB RDL RRG RNOTE DLE
  FMT=$(stat -c %Y "$STATUS_DIR/$F" 2>/dev/null || echo 0)
  while IFS=$'\t' read -r RID RGLOB RDL RRG RNOTE; do
    [ -z "$RID" ] && continue; [ "$RDL" = "-" ] && { TIMING+="$RID: no deadline (timing satisfied)"$'\n'; continue; }
    DLE=$(date -u -d "$RDL" +%s 2>/dev/null) || { TIMING+="$RID: unparseable deadline $RDL (timing not judged)"$'\n'; continue; }
    if [ "$FMT" -le "$DLE" ]; then TIMING+="$RID: ON TIME, arrived $((DLE-FMT))s before deadline $RDL (early is never a fault)"$'\n'
    else TIMING+="$RID: LATE by $((FMT-DLE))s past deadline $RDL"$'\n'; LATE=1; fi
  done <<< "$ROWS"
  V=$( { echo "Changed status file: $F"; echo "--- file content ---"; cat "$STATUS_DIR/$F"; echo "--- matching expectation rows ---"; echo "$ROWS"; \
        echo "--- timing (computed by the watchdog; authoritative, do not re-derive) ---"; printf '%s' "$TIMING"; \
        echo 'Timing is decided above: an ON TIME file is never escalated for timing, whatever the gap; a LATE file may be. Judge the CONTENT against the expectation.'; \
        echo 'Answer FOLD only if the file content plainly satisfies the expectation. Otherwise ESCALATE. Output exactly one line: FOLD: <reason> or ESCALATE: <reason>'; } | llm )
  case "$V" in
    FOLD:*) fold EVENT "$F ${TAG:+[$TAG] }${V#FOLD:}" ;;
    ESCALATE:*)
      if [ "$LATE" -eq 0 ] && printf '%s' "${V#ESCALATE:}" | grep -Eiq '(early|precede|ahead of|drift|premature|too soon|before (the |its )?(deadline|expectation|row))'; then
        fold EVENT "$F ${TAG:+[$TAG] }[timing-ok] on-time file; timing-worded escalation folded: ${V#ESCALATE:}"
      else esc EVENT "$F" "${TAG:+[$TAG] }${V#ESCALATE:}"; fi ;;
    *) esc EVENT "$F" "${TAG:+[$TAG] }triage failed — fail-open" ;;
  esac
}
# (v2.12, G10 rule 11) api_errors TRANSCRIPT: count assistant entries whose text matches API_ERROR_RE.
api_errors() { jq -r --arg re "$API_ERROR_RE" 'select(.type=="assistant") | (.message.content | if type=="string" then . else ([.[]? | select(.type=="text") | .text] | join(" ")) end) | select(test($re))' "$1" 2>/dev/null | wc -l; }
api_error_last() { jq -r --arg re "$API_ERROR_RE" 'select(.type=="assistant") | (.message.content | if type=="string" then . else ([.[]? | select(.type=="text") | .text] | join(" ")) end) | select(test($re))' "$1" 2>/dev/null | tail -1 | head -c 60; }
CYCLE=0
while true; do
  CYCLE=$((CYCLE+1))
  IV=$(sed -n 's/^#interval_seconds=\([0-9]\+\)$/\1/p' "$EXP" 2>/dev/null | head -1); IV=${IV:-$INTERVAL_DEFAULT}
  FL="$ORCH_DIR/.rotate-flags"; touch "$FL"; touch "$NEXTSTAMP"
  # 1. terminal/ask events: escalate by rule
  find "$STATUS_DIR" -maxdepth 1 -newer "$STAMP" -regextype posix-extended -regex "$ACT_RE" -printf '%f\n' | while read -r F; do
    esc EVENT "$F" "$(head -c 300 "$STATUS_DIR/$F" | tr '\n' ' ')"
  done
  # 2. intermediate confirmations: triage vs expectations
  find "$STATUS_DIR" -maxdepth 1 -newer "$STAMP" -regextype posix-extended -regex "$TRIAGE_RE" -printf '%f\n' | while read -r F; do triage_file "$F" ""; done
  # 3. expectation sweep (G9 v2.7): any other changed file matching an expectation glob is an event
  if [ -f "$SWEEP" ]; then
    bash "$SWEEP" "$STATUS_DIR" "$STAMP" "$EXP" "$ACT_RE" "$TRIAGE_RE" 2>/dev/null | cut -f1 | sort -u | while read -r F; do [ -n "$F" ] && triage_file "$F" "sweep"; done
  fi
  find "$STATUS_DIR" -maxdepth 1 -newer "$STAMP" -name '*CONTEXT*.md' -printf '%f\n' | while read -r F; do fold CONTEXT "$F"; done
  # 4. deadline sweep
  NOW=$(date -u +%s)
  grep -v '^#' "$EXP" 2>/dev/null | while IFS=$'\t' read -r ID GLOB DL RG NOTE; do
    [ -z "$ID" ] && continue; [ "$DL" = "-" ] && continue
    grep -qxF "$ID" "$ESCALATED" && continue
    DLE=$(date -u -d "$DL" +%s 2>/dev/null) || continue
    [ "$NOW" -lt "$DLE" ] && continue
    if ! find "$STATUS_DIR" -maxdepth 1 -name "$GLOB" | grep -q .; then
      esc DEADLINE "$ID" "deadline $DL passed, no $GLOB (note: $NOTE)"; echo "$ID" >> "$ESCALATED"
    fi
  done
  # 5. active checks: "#check=<id>\t<interval_s>\t<cmd>\t<criteria>"; criteria "always-escalate" skips the LLM
  sed -n 's/^#check=\(.*\)$/\1/p' "$EXP" 2>/dev/null | while IFS=$'\t' read -r CID CIV CCMD CCRIT; do
    [ -z "$CID" ] && continue
    SP="$CK/$CID.stamp"; ST="$CK/$CID.state"; LAST=0; [ -f "$SP" ] && LAST=$(cat "$SP")
    [ $((NOW-LAST)) -lt "${CIV:-600}" ] && continue
    echo "$NOW" > "$SP"
    OUT=$(eval "$CCMD" 2>&1); RC=$?
    if [ $RC -ne 0 ]; then
      grep -qxF "CHECKFAIL-$CID" "$FL" || { esc CHECK "$CID" "command failing rc=$RC: $(printf '%s' "$OUT" | head -c 200)"; echo "CHECKFAIL-$CID" >> "$FL"; }
      continue
    fi
    if [ -f "$ST" ] && [ "$OUT" = "$(cat "$ST")" ]; then continue; fi
    PREV=$(head -c 1200 "$ST" 2>/dev/null); printf '%s' "$OUT" > "$ST"
    [ -z "$PREV" ] && { fold CHECK "$CID baseline captured"; continue; }
    if [ "$CCRIT" = "always-escalate" ]; then esc CHECK "$CID" "changed: $(printf '%s' "$OUT" | head -c 300)"; continue; fi
    V=$( { echo "Periodic check '$CID' output changed."; echo "--- previous ---"; echo "$PREV"; echo "--- current ---"; printf '%s' "$OUT" | head -c 1200; echo; echo "--- escalation criteria ---"; echo "$CCRIT"; \
          echo 'Output exactly one line: FOLD: <reason> or ESCALATE: <reason>. When unsure: ESCALATE.'; } | llm )
    case "$V" in
      FOLD:*) fold CHECK "$CID ${V#FOLD:}" ;;
      ESCALATE:*) esc CHECK "$CID" "${V#ESCALATE:}" ;;
      *) esc CHECK "$CID" "triage failed — fail-open" ;;
    esac
  done
  # 6. context budgets + metrics (every 40th cycle)
  OT=$(sed -n 's/^#orch_transcript=\(.*\)$/\1/p' "$EXP" 2>/dev/null | head -1)
  if [ -n "${OT:-}" ] && [ -f "$OT" ]; then
    CTX=$(ctxof "$OT")
    if [ -n "${CTX:-}" ]; then
      # (v2.11) key the burn row on the coordinating room's own session id (its transcript's
      # filename, sans extension) so it changes every rotation instead of reusing "orch" across
      # every generation (G10 rule 3 provenance: a role label spanning generations made the
      # metric unable to distinguish one generation's burn from the next's).
      SID=$(basename "$OT"); SID=${SID%.*}
      [ $((CYCLE % 40)) -eq 1 ] && echo "$(date -u +%FT%TZ),$SID,$CTX" >> "$MET"
      if [ "$CTX" -ge "$HARD_CTX" ] && ! grep -qxF HARD "$FL"; then esc ROTATE hard-line "orch context $CTX >= $HARD_CTX: no new waves, rotate now ($ROTATION_DOC)"; echo HARD >> "$FL"; fi
      if [ "$CTX" -ge "$SOFT_CTX" ] && ! grep -qxF SOFT "$FL"; then esc ROTATE soft-ceiling "orch context $CTX >= $SOFT_CTX: rotate at next wave boundary ($ROTATION_DOC)"; echo SOFT >> "$FL"; fi
    fi
  fi
  sed -n 's/^#fleet_transcript=\(.*\)$/\1/p' "$EXP" 2>/dev/null | while IFS== read -r LBL PTH; do
    [ -f "$PTH" ] || continue
    CTX=$(ctxof "$PTH"); [ -n "${CTX:-}" ] || continue
    [ $((CYCLE % 40)) -eq 1 ] && echo "$(date -u +%FT%TZ),$LBL,$CTX" >> "$MET"
    if [ "$CTX" -ge "$HARD_CTX" ] && ! grep -qxF "FLEET-$LBL-HARD" "$FL"; then esc ROTATE "worker-$LBL" "context $CTX >= $HARD_CTX: REPLACE room now from save-game ($REPLACE_DOC)"; echo "FLEET-$LBL-HARD" >> "$FL"; fi
    if [ "$CTX" -ge "$SOFT_CTX" ] && ! grep -qxF "FLEET-$LBL-SOFT" "$FL"; then esc ROTATE "worker-$LBL" "context $CTX >= $SOFT_CTX: plan replacement at next boundary ($REPLACE_DOC)"; echo "FLEET-$LBL-SOFT" >> "$FL"; fi
  done
  # 6b. turn-death visibility (G10 rule 11): an API-error assistant entry ends a turn with the pane idle and
  # every liveness signal green; the count per executing room's transcript is the only signal, so an increase
  # is an EVENT. First sight of a transcript captures the baseline silently.
  sed -n 's/^#fleet_transcript=\(.*\)$/\1/p' "$EXP" 2>/dev/null | while IFS== read -r LBL PTH; do
    [ -f "$PTH" ] || continue
    CUR=$(api_errors "$PTH"); AS="$CK/apierr-$LBL.count"
    if [ ! -f "$AS" ]; then echo "$CUR" > "$AS"; [ "$CUR" -gt 0 ] && fold TURNDEATH "worker-$LBL baseline $CUR API-error entries"; continue; fi
    PREVN=$(cat "$AS")
    if [ "$CUR" -gt "$PREVN" ]; then
      esc TURNDEATH "worker-$LBL" "API-error assistant entries $PREVN -> $CUR; last: $(api_error_last "$PTH" | tr '\n' ' '); pane idle + liveness green is not evidence the turn lives; send a CONTINUE directive (G10 rule 11)"
      echo "$CUR" > "$AS"
    fi
  done
  # 6c. model-route liveness (G10 rule 12): probe each configured route with a minimal call every
  # ROUTE_PROBE_SECONDS; the alive set is recorded in $CK/routes.alive and a change in it is an EVENT.
  if [ -n "$ROUTES_FILE" ] && [ -f "$ROUTES_FILE" ] && [ -f "$ROUTE_PROBE" ]; then
    RPS="$CK/routes.stamp"; RPL=0; [ -f "$RPS" ] && RPL=$(cat "$RPS")
    if [ $((NOW-RPL)) -ge "$ROUTE_PROBE_SECONDS" ]; then
      echo "$NOW" > "$RPS"; RPREV=$(cat "$CK/routes.alive" 2>/dev/null | tr '\n' ' ')
      ROUT=$(bash "$ROUTE_PROBE" "$ROUTES_FILE" "$CK/routes.alive" 2>&1); RRC=$?
      RCUR=$(cat "$CK/routes.alive" 2>/dev/null | tr '\n' ' ')
      if [ "$RCUR" != "$RPREV" ]; then
        if [ "$RRC" -eq 0 ]; then fold ROUTE "alive set now [$RCUR] (was [$RPREV])"
        else esc ROUTE alive-set "alive set changed: [$RPREV] -> [$RCUR] (rc=$RRC): re-pin every executing room and every verify spawn to a route in the alive set (G10 rule 12); probe: $(printf '%s' "$ROUT" | tr '\n' ' ' | head -c 300)"; fi
      fi
    fi
  fi
  # 7. decision-packet SLA (G10 rule 8): "#decision=<id>\t<posted_epoch>\t<note>" rows in $EXP; escalates once per
  # id when unanswered past DECISION_SLA_HOURS. Keyed to the packet's own id/marker, never to generic owner-silence.
  if [ -n "$DECISIONS_DIR" ]; then
    sed -n 's/^#decision=\(.*\)$/\1/p' "$EXP" 2>/dev/null | while IFS=$'\t' read -r DID DPOSTED DNOTE; do
      [ -z "$DID" ] && continue
      decision_answered "$DID" && continue
      grep -qxF "DECISION-$DID" "$FL" && continue
      AGE_H=$(( (NOW - DPOSTED) / 3600 ))
      if [ "$AGE_H" -ge "$DECISION_SLA_HOURS" ]; then
        esc DECISION "$DID" "owner decision packet unanswered ${AGE_H}h (SLA ${DECISION_SLA_HOURS}h): $DNOTE"
        echo "DECISION-$DID" >> "$FL"
      fi
    done
  fi
  # 8. daily REVIEW (+ G4 inbox-touch check: the correction-event inbox must move when lessons were recorded,
  # not just be remembered elsewhere)
  RIV=$(sed -n 's/^#review_interval_seconds=\([0-9]\+\)$/\1/p' "$EXP" 2>/dev/null | head -1); RIV=${RIV:-86400}
  RSP="$CK/review.stamp"; RLAST=0; [ -f "$RSP" ] && RLAST=$(cat "$RSP")
  if [ $((NOW-RLAST)) -ge "$RIV" ]; then
    if [ -n "$DEVIATIONS_INBOX" ] && [ -f "$DEVIATIONS_INBOX" ]; then
      IMT=$(stat -c %Y "$DEVIATIONS_INBOX" 2>/dev/null || echo 0)
      if [ "$RLAST" -gt 0 ] && [ "$IMT" -le "$RLAST" ]; then
        esc REVIEW inbox-stale "correction-event inbox not touched since the last REVIEW ($DEVIATIONS_INBOX): confirm no lessons were recorded elsewhere and left out of it (G4)"
      fi
    fi
    echo "$NOW" > "$RSP"; eval "$REVIEW_CMD" >/dev/null 2>&1
    esc REVIEW scorecard "daily framework review due: read the scorecard, attach takeaways + any tuning proposal to your next owner debrief"
  fi
  # 9. GC (about hourly at the default interval): cap append-only files; gzip-archive heads; bound archives
  if [ $((CYCLE % 240)) -eq 2 ]; then
    AR="$ORCH_DIR/metrics/archive"; mkdir -p "$AR"; GCROTATED=0
    gcrot() {
      local f=$1 cap=$2 keep=$3 ts pre arch now mt
      [ -f "$f" ] || return 0; [ "$(stat -c %s "$f")" -le "$cap" ] && return 0
      now=$(date +%s); mt=$(stat -c %Y "$f"); [ $((now-mt)) -lt 10 ] && return 0
      ts=$(date -u +%Y%m%dT%H%M); pre=$(wc -l < "$f")
      head -n -"$keep" "$f" | gzip > "$AR/$(basename "$f").$ts.gz"
      tail -n "$keep" "$f" > "$f.tmp" && mv "$f.tmp" "$f"
      arch=$(zcat "$AR/$(basename "$f").$ts.gz" | wc -l)
      [ $((arch + keep)) -ne "$pre" ] && esc GC "$(basename "$f")" "conservation FAILED: pre=$pre archived=$arch kept=$keep — inspect $AR/$(basename "$f").$ts.gz"
      GCROTATED=$((GCROTATED+1))
    }
    gcrot "$DIG" 524288 300; gcrot "$MET" 1048576 2000; gcrot "$ESC" 262144 200
    if [ -f "$WATCHDOG_LOG" ] && [ "$(stat -c %s "$WATCHDOG_LOG")" -gt 262144 ]; then tail -n 200 "$WATCHDOG_LOG" | gzip > "$AR/watchlog.$(date -u +%Y%m%dT%H%M).gz"; : > "$WATCHDOG_LOG"; fi
    ls -t "$AR" 2>/dev/null | tail -n +25 | while read -r f; do rm -f "$AR/$f"; done
    if [ -f "$ESCALATED" ]; then grep -v '^#' "$EXP" | cut -f1 | sort -u > "$ESCALATED.ids"; grep -xFf "$ESCALATED.ids" "$ESCALATED" > "$ESCALATED.tmp" 2>/dev/null || true; mv "$ESCALATED.tmp" "$ESCALATED"; rm -f "$ESCALATED.ids"; fi
    [ "$GCROTATED" -gt 0 ] && fold GC "rotated $GCROTATED file(s); conservation asserted"
  fi
  mv "$NEXTSTAMP" "$STAMP"; NEXTSTAMP=$(mktemp)
  [ "${WATCHDOG_ONCE:-0}" = "1" ] && { rm -f "$NEXTSTAMP"; exit 0; }
  sleep "$IV"
done
