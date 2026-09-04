#!/usr/bin/env python3
"""G9 HARD-tier: deferred-work queue reminder (SessionStart hook).

Injects every non-done queue entry into session context at boot — the session cannot
forget what it never had to remember (G7 rule 2; the PR2 "hoped the session reads the
file" failure mode, closed).

Wiring (in the project's settings.json):
  {"hooks": {"SessionStart": [{"hooks": [{"type": "command",
    "command": "python3 /path/to/deferred-queue-reminder.py /path/to/deferred-queue.md"}]}]}}
Stdout is added to the session's context. Prints nothing when the queue is empty/absent.
Parsing is deliberately dumb (## headings + 'status:'/'trigger:' lines): robustness over
cleverness; the entry body is the payload, this hook only surfaces it.
"""
import re, sys, os, datetime

def main():
    if len(sys.argv) < 2 or not os.path.exists(sys.argv[1]):
        # A missing queue file must not look like an empty queue (silence = success trap).
        print(f"[deferred-work queue reminder: queue file "
              f"{sys.argv[1] if len(sys.argv) > 1 else '(none configured)'} NOT FOUND — "
              f"fix the hook wiring or restore the file]")
        return
    text = open(sys.argv[1], encoding="utf-8").read()
    mtime = datetime.date.fromtimestamp(os.path.getmtime(sys.argv[1]))
    today = datetime.date.today()
    out = []
    for m in re.split(r"^## ", text, flags=re.M)[1:]:
        name = m.splitlines()[0].strip()
        status = (re.search(r"^\s*-?\s*status:\s*(.+)$", m, re.M) or [None, "?"])[1].strip()
        trigger = (re.search(r"^\s*-?\s*trigger:\s*(.+)$", m, re.M) or [None, "?"])[1].strip()
        if status.startswith("done") or status.startswith("withdrawn"):
            continue
        out.append(f"- {name} [status: {status}] trigger: {trigger}")
    if out:
        print(f"[deferred-work queue: {len(out)} open entr{'y' if len(out)==1 else 'ies'} "
              f"({sys.argv[1]}, last touched {mtime}, today {today}) — surface any that "
              f"are due to the owner; never let one age out silently (G7 rule 4)]")
        print("\n".join(out))

if __name__ == "__main__":
    main()
