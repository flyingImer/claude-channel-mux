#!/usr/bin/env python3
"""G9 HARD-tier: blind-room path guard (PreToolUse hook).

Blocks file-tool access outside the room's allowed roots. Upgrades G1's materials
allowlist from prompt-level (post-hoc transcript check) to enforced.

Wiring (room launcher writes a room-local settings file and passes --settings):
  {"hooks": {"PreToolUse": [{"matcher": "Read|Grep|Glob|Edit|Write",
    "hooks": [{"type": "command",
      "command": "CLAUDE_ROOM_ALLOWED_ROOTS=/path/to/room python3 /path/to/room-path-guard.py"}]}]}}
Allowed roots: colon-separated in CLAUDE_ROOM_ALLOWED_ROOTS (default: cwd).
Blocking contract: exit 2 + reason on stderr (fed back to the model). Fail-open only on
malformed input (never on an out-of-root path).
"""
import json, os, sys

def main():
    try:
        data = json.load(sys.stdin)
    except Exception:
        sys.exit(0)  # malformed input: not this guard's call
    tool = data.get("tool_name", "")
    ti = data.get("tool_input", {}) or {}
    # Paths this tool call will touch, per tool schema.
    candidates = [ti.get(k) for k in ("file_path", "path", "notebook_path") if ti.get(k)]
    if tool in ("Grep", "Glob") and not candidates:
        candidates = [os.getcwd()]  # unscoped search defaults to cwd: still checked
    if not candidates:
        sys.exit(0)  # no path argument (e.g. content-only tools): nothing to guard
    roots = [os.path.realpath(r) for r in
             os.environ.get("CLAUDE_ROOM_ALLOWED_ROOTS", os.getcwd()).split(":") if r]
    for c in candidates:
        rc = os.path.realpath(os.path.join(os.getcwd(), os.path.expanduser(str(c))))
        if not any(rc == r or rc.startswith(r + os.sep) for r in roots):
            print(f"BLOCKED by room path guard: {c} is outside this room's allowed "
                  f"materials ({', '.join(roots)}). Use only the materials provided "
                  f"in the room directory.", file=sys.stderr)
            sys.exit(2)
    sys.exit(0)

if __name__ == "__main__":
    main()
