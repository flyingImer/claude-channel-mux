#!/usr/bin/env bash
# Self-test for hooks/rotation-preflight.py. Builds throwaway transcript fixtures under $TMPDIR.
set -u
here="$(cd "$(dirname "$0")" && pwd)"; script="$here/rotation-preflight.py"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT

mkline() { python3 -c "import json,sys;print(json.dumps({'message':{'usage':{'input_tokens':int(sys.argv[1]),'cache_read_input_tokens':int(sys.argv[2]),'cache_creation_input_tokens':0}}}))" "$1" "$2"; }

# good sample: above floor
{ mkline 100000 650000; } > "$T/high.jsonl"
python3 "$script" "$T/high.jsonl" --floor 700000 >/dev/null 2>"$T/err"; rc=$?
[ "$rc" = 0 ] && echo "PASS above-floor exits 0" || echo "FAIL above-floor: rc=$rc $(cat "$T/err")"

# bad sample: below floor, no exception marker
{ mkline 50000 100000; } > "$T/low.jsonl"
python3 "$script" "$T/low.jsonl" --floor 700000 >/dev/null 2>"$T/err"; rc=$?
[ "$rc" != 0 ] && echo "PASS below-floor no-exception exits non-zero" || echo "FAIL below-floor no-exception: rc=$rc"

# below floor WITH exception marker present -> passes with WARN
touch "$T/exception.marker"
python3 "$script" "$T/low.jsonl" --floor 700000 --exception "$T/exception.marker" >/dev/null 2>"$T/err"; rc=$?
if [ "$rc" = 0 ] && grep -q WARN "$T/err"; then echo "PASS below-floor with exception marker exits 0 and warns"
else echo "FAIL below-floor with exception marker: rc=$rc $(cat "$T/err")"; fi

# unreadable transcript -> loud failure, never silent pass
python3 "$script" "$T/does-not-exist.jsonl" --floor 700000 >/dev/null 2>"$T/err"; rc=$?
[ "$rc" != 0 ] && echo "PASS missing transcript fails loud (rc=$rc)" || echo "FAIL missing transcript silently passed"
