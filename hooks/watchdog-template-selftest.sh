#!/usr/bin/env bash
# WATCHDOG_ONCE smoke for harness/watchdog-template.sh (v2.12): on-time vs late status files (timing decided by
# the watchdog, not the one-shot), API-error turn-death counter, model-route alive-set change. Stub launcher only.
set -u
here="$(cd "$(dirname "$0")" && pwd)"; wd="$here/../harness/watchdog-template.sh"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
mkdir -p "$T/status" "$T/orch"
cat > "$T/stub" <<'S'
#!/usr/bin/env bash
case "$*" in *"--model route-a"*) echo OK; exit 0;; *"--model route-b"*) exit 1;; esac
echo "ESCALATE: file precedes expectation row by 4h33 (15-minute drift)"
S
chmod +x "$T/stub"; export CLAUDE_BIN="$T/stub"
printf 'route-a\nroute-b\n' > "$T/routes"
cat > "$T/conf" <<C
STATUS_DIR=$T/status; ORCH_DIR=$T/orch; REVIEW_CMD=true; ROUTES_FILE=$T/routes; ROUTE_PROBE_SECONDS=0
C
FUT=$(date -u -d '+1 hour' +%FT%TZ); PAST=$(date -u -d '-2 hours' +%FT%TZ)
printf 'E1\t01-EXEC_STARTED*\t%s\t-\ton-time row\nE2\t02-EXEC_STARTED*\t%s\t-\tlate row\n#fleet_transcript=w1=%s/w1.jsonl\n' "$FUT" "$PAST" "$T" > "$T/orch/expectations.tsv"
echo "started" > "$T/status/01-EXEC_STARTED-v1.md"; echo "started" > "$T/status/02-EXEC_STARTED-v1.md"
printf '{"type":"assistant","message":{"stop_reason":"stop_sequence","content":[{"type":"text","text":"API Error: The response stopped arriving"}]}}\n{"type":"assistant","message":{"stop_reason":"end_turn","content":[{"type":"text","text":"fine"}]}}\n' > "$T/w1.jsonl"
touch -d '1 hour ago' "$T/orch/.watchdog.stamp"
WATCHDOG_ONCE=1 bash "$wd" "$T/conf" >/dev/null 2>&1; RC=$?
[ "$RC" = 0 ] && echo "PASS cycle 1 exits 0" || echo "FAIL cycle 1 rc=$RC"
grep -q '01-EXEC_STARTED-v1.md .*\[timing-ok\]' "$T/orch/digest.md" && echo "PASS on-time file folded with timing-ok" || echo "FAIL on-time file not folded: $(cat "$T/orch/digest.md")"
grep -q '01-EXEC_STARTED' "$T/orch/ESCALATIONS.md" && echo "FAIL on-time file escalated" || echo "PASS on-time file never escalated"
grep -q 'EVENT 02-EXEC_STARTED-v1.md' "$T/orch/ESCALATIONS.md" && echo "PASS late file still escalated" || echo "FAIL late file not escalated: $(cat "$T/orch/ESCALATIONS.md")"
[ "$(cat "$T/orch/.checks/apierr-w1.count")" = 1 ] && echo "PASS API-error baseline captured (1)" || echo "FAIL baseline: $(cat "$T/orch/.checks/apierr-w1.count" 2>&1)"
grep -q 'TURNDEATH' "$T/orch/ESCALATIONS.md" && echo "FAIL baseline escalated" || echo "PASS baseline is silent"
grep -q 'ROUTE alive-set' "$T/orch/ESCALATIONS.md" && grep -q 'route-a' "$T/orch/.checks/routes.alive" && ! grep -q 'route-b' "$T/orch/.checks/routes.alive" \
  && echo "PASS dead route escalated and alive set recorded" || echo "FAIL route step: $(grep ROUTE "$T/orch/ESCALATIONS.md"; cat "$T/orch/.checks/routes.alive")"
# cycle 2: one more API-error entry -> TURNDEATH event; alive set unchanged -> no second ROUTE escalation
printf '{"type":"assistant","message":{"stop_reason":"stop_sequence","content":[{"type":"text","text":"API Error: 500 upstream"}]}}\n' >> "$T/w1.jsonl"
WATCHDOG_ONCE=1 bash "$wd" "$T/conf" >/dev/null 2>&1
grep -q 'TURNDEATH worker-w1' "$T/orch/ESCALATIONS.md" && grep -q 'entries 1 -> 2; last: API Error: 500 upstream' "$T/orch/ESCALATIONS.md" \
  && echo "PASS API-error increase escalated with last text" || echo "FAIL turn-death: $(grep TURNDEATH "$T/orch/ESCALATIONS.md")"
[ "$(grep -c 'ROUTE alive-set' "$T/orch/ESCALATIONS.md")" = 1 ] && echo "PASS unchanged alive set escalates once" || echo "FAIL ROUTE escalations: $(grep -c 'ROUTE alive-set' "$T/orch/ESCALATIONS.md")"
