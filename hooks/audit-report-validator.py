#!/usr/bin/env python3
"""G9 HARD-tier: audit report validator (G1 v2 severity rubric + reconciliation completeness).

Modes:
  --findings F            validate an audit findings file (Stop hook on audit rooms:
                          CLAUDE_AUDIT_FINDINGS=<path>; blocks session end on violation)
  --closeout C --findings F   validate a reconciliation close-out against its findings
Findings block format (G1): '## F<n>' then '- Verdict:', '- Receipt:', '- Severity:' lines.
Contract citation marker in receipts: 'C:' (G1 receipt prefixes T:/P:/C:).
Rules: (a) receipt has C: and severity nit -> violation; (b) verdict not in
{CONFIRMED,PLAUSIBLE,NOT_A_DEFECT} -> violation; (c) close-out: every finding id has a
disposition in {FIX,RULED-BEFORE,NOT_A_DEFECT,QUESTION-TO-OWNER}; (d) PLAUSIBLE+C: findings'
disposition line must carry CONFIRMED or REFUTED. Exit 2 + reasons on stderr when violated.
"""
import os, re, sys

def parse(path):
    blocks, cur = {}, None
    for line in open(path, errors="ignore"):
        m = re.match(r"^## (F\d+)\b", line)
        if m: cur = m.group(1); blocks[cur] = {}; continue
        if cur:
            for k in ("Verdict", "Receipt", "Severity"):
                if line.startswith(f"- {k}:"): blocks[cur][k] = line.split(":", 1)[1].strip()
    return blocks

def contract_cited(receipt): return bool(re.search(r"(^|[\s,(])C:", receipt or ""))

def check_findings(F):
    bad = []
    for fid, b in parse(F).items():
        v, s, r = b.get("Verdict", ""), b.get("Severity", "").lower(), b.get("Receipt", "")
        if v.split()[0:1] and v.split()[0] not in ("CONFIRMED", "PLAUSIBLE", "NOT_A_DEFECT"):
            bad.append(f"{fid}: verdict '{v}' not in CONFIRMED|PLAUSIBLE|NOT_A_DEFECT")
        if contract_cited(r) and s.startswith("nit"):
            bad.append(f"{fid}: receipt cites a contract clause (C:) but severity is nit -> at least should-fix (G1 v2 severity rubric)")
    return bad

def check_closeout(C, F):
    bad, text = [], open(C, errors="ignore").read()
    for fid, b in parse(F).items():
        m = re.search(rf"^.*\b{fid}\b.*$", text, re.M)
        if not m: bad.append(f"{fid}: no disposition line in close-out"); continue
        line = m.group(0)
        if not re.search(r"\b(FIX|RULED-BEFORE|NOT_A_DEFECT|QUESTION-TO-OWNER)\b", line):
            bad.append(f"{fid}: close-out line lacks a disposition token (FIX|RULED-BEFORE|NOT_A_DEFECT|QUESTION-TO-OWNER)")
        if b.get("Verdict", "").startswith("PLAUSIBLE") and contract_cited(b.get("Receipt", "")) \
           and not re.search(r"\b(CONFIRMED|REFUTED)\b", line):
            bad.append(f"{fid}: PLAUSIBLE + contract-cited must be resolved CONFIRMED/REFUTED before disposition (G1 v2 reconciliation rule 1)")
    return bad

def main():
    a = sys.argv[1:]
    F = a[a.index("--findings")+1] if "--findings" in a else os.environ.get("CLAUDE_AUDIT_FINDINGS")
    C = a[a.index("--closeout")+1] if "--closeout" in a else None
    if not F or not os.path.exists(F): sys.exit(0)  # nothing to validate in this room
    bad = check_closeout(C, F) if C else check_findings(F)
    if bad:
        print("AUDIT REPORT VALIDATOR: fix before finishing:\n- " + "\n- ".join(bad), file=sys.stderr); sys.exit(2)
    sys.exit(0)
if __name__ == "__main__": main()
