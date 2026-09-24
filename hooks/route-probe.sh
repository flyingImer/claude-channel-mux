#!/usr/bin/env bash
# G10 rule 12 (harness v2.12): model-route liveness probe. One route can stay up while every room pinned to
# another route dies, so the coordinating room's boot and hold checklists, and the watchdog, probe each
# configured route with a minimal call and record the alive set. A spawn (verify subagent, replacement
# room) names its model from that set, never from a default it did not check.
# usage: route-probe.sh ROUTES_FILE ALIVE_FILE
#   ROUTES_FILE: one route name per line (# comments and blank lines ignored), as passed to --model.
#   ALIVE_FILE : rewritten whole with the routes that answered, one per line (the alive set).
# prints one line per route: <route>\t<alive|dead>\trc=<n>. Exit 0 all alive, 1 at least one dead,
# 3 no routes configured (fail loud, never a silent pass). Env: CLAUDE_BIN (G9 v2.5), ROUTE_PROBE_TIMEOUT (s, default 60).
set -u
ROUTES="${1:?usage: route-probe.sh ROUTES_FILE ALIVE_FILE}"; ALIVE="${2:?usage: route-probe.sh ROUTES_FILE ALIVE_FILE}"
CLAUDE="${CLAUDE_BIN:-claude}"; TO="${ROUTE_PROBE_TIMEOUT:-60}"
[ -f "$ROUTES" ] || { echo "route-probe: routes file not found: $ROUTES" >&2; exit 3; }
mapfile -t RS < <(grep -v '^[[:space:]]*#' "$ROUTES" | sed 's/[[:space:]]*$//' | grep -v '^$')
[ "${#RS[@]}" -gt 0 ] || { echo "route-probe: no routes configured in $ROUTES" >&2; exit 3; }
TMP=$(mktemp); DEAD=0
for R in "${RS[@]}"; do
  if timeout "$TO" "$CLAUDE" -p --model "$R" "Reply with the single word OK." >/dev/null 2>&1; then
    printf '%s\talive\trc=0\n' "$R"; echo "$R" >> "$TMP"
  else RC=$?; printf '%s\tdead\trc=%s\n' "$R" "$RC"; DEAD=1; fi
done
mv "$TMP" "$ALIVE"
exit "$DEAD"
