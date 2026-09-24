#!/usr/bin/env bash
# Self-test for hooks/route-probe.sh (v2.12). A stub launcher answers on route-a and fails on route-b.
set -u
here="$(cd "$(dirname "$0")" && pwd)"; probe="$here/route-probe.sh"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
cat > "$T/stub" <<'S'
#!/usr/bin/env bash
case "$*" in *"--model route-a"*) echo OK; exit 0;; *"--model route-b"*) exit 1;; esac; exit 0
S
chmod +x "$T/stub"; export CLAUDE_BIN="$T/stub"
printf '# routes\nroute-a\nroute-b\n\n' > "$T/routes"
OUT=$(bash "$probe" "$T/routes" "$T/alive"); RC=$?
[ "$RC" = 1 ] && echo "PASS one dead route exits 1" || echo "FAIL exit $RC want 1"
printf '%s\n' "$OUT" | grep -q $'^route-a\talive\trc=0$' && echo "PASS route-a reported alive" || echo "FAIL route-a line: $OUT"
printf '%s\n' "$OUT" | grep -q $'^route-b\tdead\trc=1$' && echo "PASS route-b reported dead with rc" || echo "FAIL route-b line: $OUT"
[ "$(cat "$T/alive")" = "route-a" ] && echo "PASS alive file holds exactly the alive set" || echo "FAIL alive file: $(cat "$T/alive")"
printf 'route-a\n' > "$T/routes2"; bash "$probe" "$T/routes2" "$T/alive2" >/dev/null; RC=$?
[ "$RC" = 0 ] && [ "$(cat "$T/alive2")" = "route-a" ] && echo "PASS all-alive exits 0" || echo "FAIL all-alive rc=$RC"
printf '# nothing\n' > "$T/routes3"; bash "$probe" "$T/routes3" "$T/alive3" 2>/dev/null; RC=$?
[ "$RC" = 3 ] && echo "PASS empty routes file fails loud (exit 3)" || echo "FAIL empty routes rc=$RC"
bash "$probe" "$T/missing" "$T/alive4" 2>/dev/null; RC=$?
[ "$RC" = 3 ] && echo "PASS missing routes file fails loud (exit 3)" || echo "FAIL missing routes rc=$RC"
