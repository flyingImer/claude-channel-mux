#!/usr/bin/env bash
# Self-test for hooks/save-game-validator.py (v2.11 prepend-detection rule). Builds throwaway
# save-game fixtures under $TMPDIR.
set -u
here="$(cd "$(dirname "$0")" && pwd)"; script="$here/save-game-validator.py"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
ST="$T/state.json"

# good sample: small file, first checkpoint (no prior state) -> pass, state written
printf 'short line one\nrest of the save-game\n' > "$T/save.md"
python3 "$script" "$T/save.md" "$ST" --cap-bytes 1000 >/dev/null 2>"$T/err"; rc=$?
[ "$rc" = 0 ] && [ -f "$ST" ] && echo "PASS first checkpoint passes and writes state" || echo "FAIL first checkpoint: rc=$rc $(cat "$T/err")"

# good sample: next checkpoint, line 1 byte-for-byte identical -> pass
python3 "$script" "$T/save.md" "$ST" --cap-bytes 1000 >/dev/null 2>"$T/err"; rc=$?
[ "$rc" = 0 ] && echo "PASS identical line 1 passes" || echo "FAIL identical line 1: rc=$rc $(cat "$T/err")"

# good sample: a whole rewrite that is simply LONGER (no old text reused deeper in the new
# line) must pass -- this is the exact shape that used to be rejected as "grew"
python3 -c "print('x'*500); print('rest of the save-game')" > "$T/save.md"
python3 "$script" "$T/save.md" "$ST" --cap-bytes 100000 >/dev/null 2>"$T/err"; rc=$?
[ "$rc" = 0 ] && echo "PASS longer whole-rewrite passes (no reused old text)" || echo "FAIL longer whole-rewrite: rc=$rc $(cat "$T/err")"

# state now tracks the 'x'*500 line's prefix; a genuine prepend puts new text BEFORE that
# old prefix, so the old prefix reappears at a positive offset in the new line 1
python3 -c "print('NEW STUFF UP FRONT ' + 'x'*500); print('rest of the save-game')" > "$T/save.md"
python3 "$script" "$T/save.md" "$ST" --cap-bytes 100000 >"$T/out" 2>"$T/err"; rc=$?
[ "$rc" != 0 ] && grep -qi "PREPENDED" "$T/err" && echo "PASS true prepend fails with the right reason" || echo "FAIL true prepend: rc=$rc $(cat "$T/err")"

# state file must NOT have been updated by the failing run (still the pre-prepend prefix)
python3 -c "
import json, sys
d = json.load(open(sys.argv[1]))
sys.exit(0 if d['line1_prefix'].startswith('x' * 200) else 1)
" "$ST" \
  && echo "PASS state file left at last-good prefix after a violation" \
  || echo "FAIL state file was updated despite the violation"

# bad sample: file exceeds size cap (cap check is independent of the prepend check)
python3 -c "print('short line')" > "$T/save2.md"
python3 -c "print('x'*2000)" >> "$T/save2.md"
python3 "$script" "$T/save2.md" "$T/state2.json" --cap-bytes 100 >/dev/null 2>"$T/err"; rc=$?
[ "$rc" != 0 ] && grep -qi "cap" "$T/err" && echo "PASS oversize file fails with the right reason" || echo "FAIL oversize file: rc=$rc $(cat "$T/err")"

# missing save-game -> exit 0 (nothing to validate yet), never a false violation
python3 "$script" "$T/nope.md" "$T/state3.json" >/dev/null 2>"$T/err"; rc=$?
[ "$rc" = 0 ] && echo "PASS missing save-game is a no-op pass" || echo "FAIL missing save-game: rc=$rc"
