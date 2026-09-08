#!/usr/bin/env bash
# Generic Tier-0 watchdog (harness v2.8). One script for every effort; the effort supplies a conf file.
# usage: watchdog-template.sh <watchdog.conf>          (the effort's watchdog.sh is a thin wrapper: exec this)
#        WATCHDOG_ONCE=1 watchdog-template.sh <conf>   (single cycle, for tests and derivation smoke checks)
# Contract: the effort's WATCHDOG.md. Passive status-file events + expectation sweep + deadlines + active checks
# + context budgets + exam generation (validated before use) + daily REVIEW + GC. Escalations go to ESCALATIONS.md,
# folds to digest.md. LLM one-shots run through ${CLAUDE_BIN:-claude} (G9 v2.5), model haiku.
set -u
CONF="${1:?usage: watchdog-template.sh <watchdog.conf>}"; [ -f "$CONF" ] || { echo "watchdog: conf not found: $CONF" >&2; exit 2; }
# ---- conf keys (defaults) ----
STATUS_DIR=""; ORCH_DIR=""; EXP=""; MET=""; EXAM_SOURCES=(); REVIEW_CMD="true"; SOFT_CTX=700000; HARD_CTX=850000
ROTATION_DOC="ROTATION.md"; REPLACE_DOC="room-procedures"; EXAM_MIN_BYTES=500; EXAM_MIN_QA=5; INTERVAL_DEFAULT=15
ACT_RE='.*/[0-9]+-(PLAN_READY|BLOCKED|NEED_RULING|NEED_EJ|DONE[^/]*|DESCRIPTION_READY|MOVEMENT)[^/]*\.md'
TRIAGE_RE='.*/[0-9]+-(APPROVED_ACK|EXEC_STARTED)[^/]*\.md'
# shellcheck disable=SC1090
. "$CONF"
: "${STATUS_DIR:?conf must set STATUS_DIR}"; : "${ORCH_DIR:?conf must set ORCH_DIR}"
EXP="${EXP:-$ORCH_DIR/expectations.tsv}"; ESC="$ORCH_DIR/ESCALATIONS.md"; DIG="$ORCH_DIR/digest.md"
CK="$ORCH_DIR/.checks"; MET="${MET:-$ORCH_DIR/metrics/fleet-ctx.csv}"; ESCALATED="$ORCH_DIR/.deadline-escalated"
WATCHDOG_LOG="${WATCHDOG_LOG:-$ORCH_DIR/watchdog.log}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"; SWEEP="$HERE/../hooks/expectation-sweep.sh"
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
# triage_file FILE TAG: haiku triage of one changed status file against its expectation rows (also used by the sweep)
triage_file() {
  local F="$1" TAG="$2" ROWS V
  ROWS=$(grep -v '^#' "$EXP" 2>/dev/null | awk -F'\t' -v f="$F" '{r=$2; gsub(/\./,"\\.",r); gsub(/\*/,".*",r); if (f ~ "^"r"$") print $0}')
  if [ -z "$ROWS" ]; then esc EVENT "$F" "no matching expectation"; return; fi
  V=$( { echo "Changed status file: $F"; echo "--- file content ---"; cat "$STATUS_DIR/$F"; echo "--- matching expectation rows ---"; echo "$ROWS"; \
        echo 'Answer FOLD only if the file content plainly satisfies the expectation. Otherwise ESCALATE. Output exactly one line: FOLD: <reason> or ESCALATE: <reason>'; } | llm )
  case "$V" in
    FOLD:*) fold EVENT "$F ${TAG:+[$TAG] }${V#FOLD:}" ;;
    ESCALATE:*) esc EVENT "$F" "${TAG:+[$TAG] }${V#ESCALATE:}" ;;
    *) esc EVENT "$F" "${TAG:+[$TAG] }triage failed — fail-open" ;;
  esac
}
# exam_valid FILE: G9 v2.6 — a generated artifact is validated before use
exam_valid() {
  local f="$1"
  [ "$(wc -c < "$f")" -ge "$EXAM_MIN_BYTES" ] || return 1
  grep -qiE "hook error|unreachable|blocked by hook|rate.?limit|api error" "$f" && return 1
  [ "$(grep -cE '^(\*\*|#+ *)?Q[0-9]+' "$f")" -ge "$EXAM_MIN_QA" ]
}
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
      [ $((CYCLE % 40)) -eq 1 ] && echo "$(date -u +%FT%TZ),orch,$CTX" >> "$MET"
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
  # 7. exam generation (extraction-only), validated before it replaces the previous exam (G9 v2.6)
  EIV=$(sed -n 's/^#exam_interval_seconds=\([0-9]\+\)$/\1/p' "$EXP" 2>/dev/null | head -1); EIV=${EIV:-86400}
  ESP="$CK/exam.stamp"; ELAST=0; [ -f "$ESP" ] && ELAST=$(cat "$ESP")
  if [ $((NOW-ELAST)) -ge "$EIV" ] && [ "${#EXAM_SOURCES[@]}" -gt 0 ]; then
    echo "$NOW" > "$ESP"
    { echo "You are generating a takeover exam for an orchestrator successor. EXTRACT ONLY, never invent. Produce 8-10 Q&A pairs in markdown, each question on a line starting with Q<n>. Each answer MUST cite its source file path and quote the exact line(s). Cover: current chain topology and refs, pending rulings and their rationale, in-flight expectations and deadlines, environment traps, identity/leak rules."
      for src in "${EXAM_SOURCES[@]}"; do IFS='|' read -r LBL PTH TN <<< "$src"; [ -f "$PTH" ] || continue; echo "=== $LBL ==="; if [ -n "${TN:-}" ]; then tail -"$TN" "$PTH"; else cat "$PTH"; fi; done
      echo "=== expectations ==="; cat "$EXP"; } | "$CLAUDE" -p --model haiku > "$ORCH_DIR/EXAM.md.tmp" 2>"$CK/exam.err"
    if [ $? -eq 0 ] && exam_valid "$ORCH_DIR/EXAM.md.tmp"; then mv "$ORCH_DIR/EXAM.md.tmp" "$ORCH_DIR/EXAM.md"
    else esc EXAM generation "regen rejected (size/shape/error-body check), previous EXAM.md kept; tmp+err preserved: $(head -c 150 "$ORCH_DIR/EXAM.md.tmp" 2>/dev/null | tr '\n' ' ')"; fi
  fi
  # 8. daily REVIEW
  RIV=$(sed -n 's/^#review_interval_seconds=\([0-9]\+\)$/\1/p' "$EXP" 2>/dev/null | head -1); RIV=${RIV:-86400}
  RSP="$CK/review.stamp"; RLAST=0; [ -f "$RSP" ] && RLAST=$(cat "$RSP")
  if [ $((NOW-RLAST)) -ge "$RIV" ]; then
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
