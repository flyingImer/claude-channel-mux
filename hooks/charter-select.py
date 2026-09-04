#!/usr/bin/env python3
"""G2 v2.3 class isolation: select charter rows for ONE artifact class.
Usage: charter-select.py <audit-charter.md> <class> > room/charter.md
Rows are 'id:' blocks; a row without 'class:' is refused (exit 2, listed on stderr).
Also strips 'origin:' and 'state:' lines (no escape names in the room, per G1)."""
import re, sys
def main():
    src, cls = sys.argv[1], sys.argv[2]
    text = open(src, errors="ignore").read()
    blocks = re.split(r"(?m)^(?=id:\s)", text)
    out, missing, kept = [], [], 0
    for b in blocks:
        if not b.startswith("id:"): continue
        rid = b.split("\n",1)[0].split(":",1)[1].strip()
        m = re.search(r"(?m)^class:\s*(\S+)", b)
        if not m: missing.append(rid); continue
        if m.group(1) != cls: continue
        lines = [l for l in b.splitlines() if not re.match(r"^(origin|state):", l)]
        # drop continuation lines of stripped fields (indented lines following them)
        cleaned, skip = [], False
        for l in b.splitlines():
            if re.match(r"^(origin|state):", l): skip = True; continue
            if skip and l.startswith(" "): continue
            skip = False; cleaned.append(l)
        out.append("\n".join(cleaned).rstrip()+"\n"); kept += 1
    if missing:
        print("charter-select: rows without class: refused: " + ", ".join(missing), file=sys.stderr); sys.exit(2)
    sys.stdout.write("\n".join(out)); print(f"# {kept} rows of class {cls}", file=sys.stderr)
if __name__ == "__main__": main()
