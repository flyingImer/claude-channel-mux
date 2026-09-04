#!/usr/bin/env python3
"""G9 HARD-tier: outbound gate (PreToolUse hook on Bash).

Blocks a command that makes an artifact visible to an outside audience unless a close-out
record exists for the outbound ref. Generic: the EFFORT declares what is "public" and where
records live, in a JSON manifest at $CLAUDE_OUTBOUND_MANIFEST:
  {"public_patterns": ["git push .*(pr3|pr4)", "gh pr create", "gt submit"],   # regex on the command
   "closeout_dir": "/abs/path/closeouts",   # must contain <sha>.md (or <sha>-*.md) for the outbound ref
   "ref_cmd": "git rev-parse HEAD",         # how to resolve the outbound ref (default HEAD of cwd)
   "override_token": "/abs/path/OWNER-OVERRIDE",   # if present: allow + log correction event
   "correction_log": "/abs/path/correction-log.md"}
A close-out record is the reconciliation close-out (G1 v2): audited base sha, dispositioned
findings, delta-only-fixes verification. The gate checks EXISTENCE + that it names the base
line ("audited base:"); content quality is the validator's job, not this gate's.
Blocking contract: exit 2 + reason on stderr. Missing manifest = block (a room that can push
must declare its outbound surface). Malformed stdin = not this guard's call (exit 0).
"""
import glob, json, os, re, subprocess, sys, datetime

def main():
    try:
        data = json.load(sys.stdin)
    except Exception:
        sys.exit(0)
    if data.get("tool_name") != "Bash":
        sys.exit(0)
    cmd = (data.get("tool_input") or {}).get("command", "") or ""
    mpath = os.environ.get("CLAUDE_OUTBOUND_MANIFEST")
    if not mpath:
        # CCM room: resolve the room's harness dir via the daemon-written session file.
        sid = data.get("session_id")
        state = os.environ.get("CCM_STATE_DIR") or os.path.expanduser("~/.config/claude-channel-mux")
        sf = os.path.join(state, "harness", f"{sid}.json") if sid else None
        if not sf or not os.path.exists(sf):
            sys.exit(0)  # not a harness room: nothing to gate
        info = json.load(open(sf))
        if not info.get("dir"):
            sys.exit(0)  # harness pending/unset: gate inactive (SessionStart hint covers it)
        mpath = os.path.join(info["dir"], "outbound.json")
        if not os.path.exists(mpath):
            if re.search(r"\bgit\s+push\b|\bgh\s+pr\s+create\b|\bgt\s+submit\b", cmd):
                print(f"outbound gate: harness `{info.get('name')}` has no outbound.json yet; gate inactive "
                      f"(migration). Derive {mpath} per G9 to arm it.", file=sys.stderr)
            sys.exit(0)
    elif not os.path.exists(mpath):
        if re.search(r"\bgit\s+push\b|\bgh\s+pr\s+create\b|\bgt\s+submit\b", cmd):
            print("BLOCKED by outbound gate: CLAUDE_OUTBOUND_MANIFEST is set but the file is missing.", file=sys.stderr)
            sys.exit(2)
        sys.exit(0)
    m = json.load(open(mpath))
    if not any(re.search(p, cmd) for p in m.get("public_patterns", [])):
        sys.exit(0)  # not a public-facing action per the effort's own declaration
    try:
        sha = subprocess.check_output(m.get("ref_cmd", "git rev-parse HEAD"), shell=True,
                                      text=True, stderr=subprocess.DEVNULL).strip()
    except Exception:
        sha = ""
    cdir = m.get("closeout_dir", "")
    recs = glob.glob(os.path.join(cdir, f"{sha}*.md")) if sha and cdir else []
    ok = any("audited base:" in open(r, errors="ignore").read() for r in recs)
    if ok:
        sys.exit(0)
    tok = m.get("override_token")
    if tok and os.path.exists(tok):
        log = m.get("correction_log")
        if log:
            with open(log, "a") as f:
                f.write(f"\n## {datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")} OUTBOUND-OVERRIDE ref={sha[:12]} cmd={cmd[:120]!r} (owner token present; G4 correction event)\n")
        print(f"outbound gate: owner override token present; action allowed and logged.", file=sys.stderr)
        sys.exit(0)
    print(f"BLOCKED by outbound gate: '{cmd[:80]}' is a public-facing action but no close-out record "
          f"for ref {sha[:12] or '?'} was found in {cdir or '?'} (needs a file {sha[:12]}*.md containing "
          f"'audited base:'). Complete the reconciliation close-out, or the owner places the override token.",
          file=sys.stderr)
    sys.exit(2)

if __name__ == "__main__":
    main()
