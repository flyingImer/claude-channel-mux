#!/usr/bin/env bash
# Self-test for hooks/outbound-gate.py (v3). Creates throwaway repos under $TMPDIR; prints PASS/FAIL per case.
set -u
here="$(cd "$(dirname "$0")" && pwd)"; gate="$here/outbound-gate.py"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
git init -q "$T/wrapper" && git -C "$T/wrapper" -c user.name=t -c user.email=t@t commit -q --allow-empty -m w
git init -q "$T/wrapper/nested" && git -C "$T/wrapper/nested" -c user.name=t -c user.email=t@t commit -q --allow-empty -m n
W=$(git -C "$T/wrapper" rev-parse HEAD); N=$(git -C "$T/wrapper/nested" rev-parse HEAD)
mkdir -p "$T/closeouts"
printf '{"public_patterns":["git push .*origin","gh pr create"],"closeout_dir":"%s"}' "$T/closeouts" > "$T/manifest.json"
export CLAUDE_OUTBOUND_MANIFEST="$T/manifest.json"
run() { # run <expected-exit> <label> <command>   (cwd = wrapper)
  local want="$1" label="$2" cmd="$3" got
  printf '{"tool_name":"Bash","tool_input":{"command":%s}}' "$(python3 -c 'import json,sys;print(json.dumps(sys.argv[1]))' "$cmd")" \
    | (cd "$T/wrapper" && python3 "$gate" 2>"$T/err"); got=$?
  if [ "$got" = "$want" ]; then echo "PASS $label"; else echo "FAIL $label (exit $got, want $want): $(head -c 200 "$T/err")"; fi
}
run 0 "heredoc mentioning the command is not an action"  $'cat > note.md <<\'EOF\'\nnever git push origin without the owner\nEOF'
run 0 "grep quoting the command is not an action"       "grep -n 'git push origin' notes.md"
run 0 "commit message quoting the command is not an action" 'git commit -q -m "do not git push origin yet"'
run 2 "push without a record blocks"                    "git push origin main"
grep -q "$W" "$T/err" && echo "PASS block message names the full wrapper sha" || echo "FAIL block message lacks full sha"
run 2 "nested push resolves the nested repo ref"        "git -C nested push origin main"
grep -q "$N" "$T/err" && echo "PASS nested ref resolved ($N)" || echo "FAIL nested ref not resolved: $(head -c 160 "$T/err")"
run 2 "cd-prefixed nested push resolves the nested ref" "cd nested && git push origin main"
grep -q "$N" "$T/err" && echo "PASS cd-prefixed nested ref resolved" || echo "FAIL cd-prefixed nested ref: $(head -c 160 "$T/err")"
run 2 "quoted refspec is still matched and resolves <src>" "git -C nested push origin \"HEAD:main\""
grep -q "$N" "$T/err" && echo "PASS quoted refspec resolved the nested ref" || echo "FAIL quoted refspec: $(head -c 160 "$T/err")"
printf 'audited base: x\n' > "$T/closeouts/${N:0:12}-v1.md"
run 0 "12-char prefix record admits the nested push"    "git -C nested push origin main"
run 2 "prefix record for nested does not admit wrapper" "git push origin main"
