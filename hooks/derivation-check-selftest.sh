#!/usr/bin/env bash
# Self-test for hooks/derivation-check.py. Builds throwaway changelog + note fixtures
# under $TMPDIR; never touches harness/CHANGELOG-G.md or any real derivation note.
set -u
here="$(cd "$(dirname "$0")" && pwd)"; script="$here/derivation-check.py"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT

cat > "$T/CHANGELOG.md" <<'EOF'
# fixture changelog

## v9.9 — 2026-01-01
- **G-fixture (new): two hook-bearing items.**
  1. First item — ships `hooks/example-one.py`.
  2. Second item — ships `hooks/example-two.sh`.
- Also wires `harness/watchdog-template.sh` for the third item.

## v9.8 — 2025-12-01
- Unrelated older section naming `hooks/example-one.py` again (must not be read when
  checking v9.9 or v9.7).

## v9.7 — 2025-11-01
- A section with no hook, script, or watchdog-template mentions at all.
EOF

# good note: a receipt line per hook, exit 0
cat > "$T/good-note.md" <<'EOF'
# Derivation note (good)
1. First item: TAKEN.
receipt: /inst/hooks/example-one.py | python3 /inst/hooks/example-one.py --check | rc=0 | "OK: check passed"
2. Second item: TAKEN.
receipt: /inst/hooks/example-two.sh | bash /inst/hooks/example-two.sh | rc=0 | "OK"
3. Third item: TAKEN.
receipt: /inst/harness/watchdog-template.sh | bash /inst/harness/watchdog-template.sh --once | rc=0 | "cycle complete"
EOF

python3 "$script" "$T/good-note.md" "v9.9" --changelog "$T/CHANGELOG.md" >"$T/out" 2>"$T/err"; rc=$?
[ "$rc" = 0 ] && echo "PASS receipted note passes" || echo "FAIL receipted note: rc=$rc $(cat "$T/err")"

# bad note: the "already as policy" / "record item" shape, no receipt lines at all
cat > "$T/bad-note.md" <<'EOF'
# Derivation note (bad)
1. First item: ALREADY as policy (covered by an existing check); record item.
2. Second item: TAKEN in spirit; record item — not wired yet.
3. Third item: already covered by the prior rotation's watchdog; record item.
EOF

python3 "$script" "$T/bad-note.md" "v9.9" --changelog "$T/CHANGELOG.md" >"$T/out2" 2>"$T/err2"; rc=$?
[ "$rc" = 2 ] && grep -q "example-one.py" "$T/err2" && grep -q "example-two.sh" "$T/err2" \
  && grep -q "watchdog-template.sh" "$T/err2" \
  && echo "PASS unreceipted note fails and names all three missing hooks" \
  || echo "FAIL unreceipted note: rc=$rc $(cat "$T/err2")"

# partial note: one receipt present, two missing -> still exit 2, only the two are listed
cat > "$T/partial-note.md" <<'EOF'
# Derivation note (partial)
1. First item: TAKEN.
receipt: /inst/hooks/example-one.py | python3 /inst/hooks/example-one.py | rc=0 | "OK"
2. Second item: already as policy; record item.
3. Third item: already as policy; record item.
EOF

python3 "$script" "$T/partial-note.md" "v9.9" --changelog "$T/CHANGELOG.md" >"$T/out3" 2>"$T/err3"; rc=$?
[ "$rc" = 2 ] && ! grep -q "example-one.py" "$T/err3" \
  && grep -q "example-two.sh" "$T/err3" && grep -q "watchdog-template.sh" "$T/err3" \
  && echo "PASS partial note lists only the still-missing hooks" \
  || echo "FAIL partial note: rc=$rc $(cat "$T/err3")"

# a version section naming no hook is a trivial pass even with an empty note
cat > "$T/empty-note.md" <<'EOF'
nothing here
EOF
python3 "$script" "$T/empty-note.md" "v9.7" --changelog "$T/CHANGELOG.md" >"$T/out4" 2>"$T/err4"; rc=$?
[ "$rc" = 0 ] && echo "PASS a section naming no hook-bearing item passes trivially" \
  || echo "FAIL no-hook section: rc=$rc $(cat "$T/err4")"

# missing note file -> fail loud (exit 3), never a silent pass
python3 "$script" "$T/nope.md" "v9.9" --changelog "$T/CHANGELOG.md" >/dev/null 2>"$T/err5"; rc=$?
[ "$rc" = 3 ] && echo "PASS missing note fails loud (exit 3)" || echo "FAIL missing note: rc=$rc"

# missing version section -> fail loud (exit 3), never a silent pass
python3 "$script" "$T/good-note.md" "v0.0" --changelog "$T/CHANGELOG.md" >/dev/null 2>"$T/err6"; rc=$?
[ "$rc" = 3 ] && echo "PASS missing version section fails loud (exit 3)" || echo "FAIL missing section: rc=$rc"
