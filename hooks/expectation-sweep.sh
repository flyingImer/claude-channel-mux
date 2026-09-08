#!/usr/bin/env bash
# G9 v2.7: third watchdog pass. A status file that matches an expectation glob is an EVENT even when its
# name matches neither the ACT nor the TRIAGE regex; silent satisfaction is the failure WATCHDOG rule 2 refuses.
# usage: expectation-sweep.sh STATUS_DIR STAMP_FILE EXPECTATIONS_TSV ACT_RE TRIAGE_RE
# prints one line per hit: <file>\t<expectation id>\t<expectation note>; the watchdog treats each as TRIAGE.
set -u
STATUS="$1"; STAMP="$2"; EXP="$3"; ACT_RE="$4"; TRIAGE_RE="$5"
[ -f "$EXP" ] || exit 0
find "$STATUS" -maxdepth 1 -newer "$STAMP" -name '*.md' -printf '%f\n' 2>/dev/null | while read -r F; do
  case "$F" in *CONTEXT*) continue;; esac
  printf '%s' "x/$F" | grep -Eq "^$ACT_RE$" && continue
  printf '%s' "x/$F" | grep -Eq "^$TRIAGE_RE$" && continue
  grep -v '^#' "$EXP" | awk -F'\t' -v f="$F" '{r=$2; gsub(/\./,"\\.",r); gsub(/\*/,".*",r); if (f ~ "^"r"$") printf "%s\t%s\t%s\n", f, $1, $5}'
done
