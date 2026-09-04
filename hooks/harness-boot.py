#!/usr/bin/env python3
"""SessionStart hook (CCM rooms): generic worker-room harness boot.
Reads STATE_DIR/harness/<session_id>.json (written by the daemon). No file or no harness dirs:
silent. Harness pending (>=2 candidates, none set): print the hint. Harness set: run the
generic refresh check (harness-sync.sh --check) and the deferred-queue reminder for that dir.
Stdout enters the session context."""
import json, os, subprocess, sys
def main():
    try: data = json.load(sys.stdin)
    except Exception: return
    sid = data.get("session_id")
    if not sid: return
    state = os.environ.get("CCM_STATE_DIR") or os.path.expanduser("~/.config/claude-channel-mux")
    f = os.path.join(state, "harness", f"{sid}.json")
    if not os.path.exists(f): return
    info = json.load(open(f))
    name, d, cands = info.get("name"), info.get("dir"), info.get("candidates") or []
    if not name:
        if cands:
            print(f"[harness] This room has NO harness set; candidates under {info.get('cwd')}/.ccm-harness: {', '.join(cands)}. "
                  f"Run `/ccm harness <name>` in this room (rooms it creates will inherit). Harness hooks stay inactive until then.")
        return
    if not d:
        print(f"[harness] harness `{name}` is set but its dir is missing under {info.get('cwd')}/.ccm-harness; fix the dir or run `/ccm harness <name>`.")
        return
    plugin = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    for cmd in (["bash", os.path.join(plugin, "harness", "harness-sync.sh"), "--check", d],
                ["python3", os.path.join(plugin, "hooks", "deferred-queue-reminder.py"), os.path.join(d, "deferred-queue.md")]):
        if cmd[0] == "python3" and not os.path.exists(cmd[2]): continue
        try:
            out = subprocess.run(cmd, capture_output=True, text=True, timeout=20)
            if out.stdout.strip(): print(out.stdout.rstrip())
        except Exception as e:
            print(f"[harness] boot step failed ({os.path.basename(cmd[1])}): {e}")
if __name__ == "__main__": main()
