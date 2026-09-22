#!/usr/bin/env python3
"""G9 T1-tier (harness v2.10, G0: derivation receipts): derivation-note receipt checker.

A derivation note is allowed to close an intake item that ships a hook, script, or
validator (a HOOK-BEARING item) only when the note carries a receipt for it: the
script's path as wired into the instance, the command run, its exit code, and one
quoted line of its output. Dispositions like "already covered", "already as policy",
"in spirit", or "record item" name no wired path and no run, so they are never
evidence the mechanism exists in the instance -- this script does not even look at
disposition wording; it only checks whether a receipt is present for every hook the
named CHANGELOG-G.md version section introduces.

Receipt grammar (one line, anywhere in the note):
    receipt: <path> | <command> | rc=<n> | <quoted output>
Matching is by the hook's basename (the instance's wired path will usually differ from
the generic hooks/<name> path named in the changelog).

usage: derivation-check.py NOTE VERSION [--changelog PATH] [--tail-context N]
Exit 0: every hook-bearing item in the named version section has a matching receipt in
        NOTE (including the case where the section names no hook-bearing item at all).
Exit 2: one or more hook-bearing items have no matching receipt; each missing item is
        printed with the changelog line that introduced it.
Exit 3: NOTE or the changelog cannot be read, or VERSION's section cannot be found in
        the changelog (fail LOUD, never a silent pass on a check that could not run).
"""
import argparse
import os
import re
import sys

HOOK_RE = re.compile(r"\bhooks/([A-Za-z0-9_.\-]+\.(?:py|sh))\b")
WATCHDOG_RE = re.compile(r"\b(?:harness/)?(watchdog-template\.sh)\b")
RECEIPT_RE = re.compile(
    r"^\s*receipt:\s*(?P<path>\S+)\s*\|\s*(?P<cmd>[^|]*)\|\s*rc=(?P<rc>-?\d+)\s*\|\s*(?P<out>.+?)\s*$",
    re.MULTILINE,
)


def default_changelog():
    here = os.path.dirname(os.path.abspath(__file__))
    return os.path.join(os.path.dirname(here), "harness", "CHANGELOG-G.md")


def read_or_die(path, label):
    try:
        with open(path, errors="ignore") as f:
            return f.read()
    except OSError as e:
        print(f"derivation-check: cannot read {label} {path}: {e}", file=sys.stderr)
        sys.exit(3)


def extract_version_section(changelog_text, version):
    heading_re = re.compile(
        r"^##\s+" + re.escape(version) + r"\b.*$", re.MULTILINE
    )
    m = heading_re.search(changelog_text)
    if not m:
        print(
            f"derivation-check: version section '{version}' not found in changelog",
            file=sys.stderr,
        )
        sys.exit(3)
    start = m.end()
    next_m = re.search(r"^##\s+", changelog_text[start:], re.MULTILINE)
    end = start + next_m.start() if next_m else len(changelog_text)
    return changelog_text[start:end]


def find_hook_items(section_text):
    """Return {basename: first_context_line} for every hook-bearing mention."""
    items = {}
    for lineno, line in enumerate(section_text.splitlines()):
        for m in HOOK_RE.finditer(line):
            base = m.group(1)
            items.setdefault(base, line.strip()[:100])
        for m in WATCHDOG_RE.finditer(line):
            base = m.group(1)
            items.setdefault(base, line.strip()[:100])
    return items


def find_receipted_basenames(note_text):
    covered = set()
    for m in RECEIPT_RE.finditer(note_text):
        covered.add(os.path.basename(m.group("path")))
    return covered


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("note")
    ap.add_argument("version")
    ap.add_argument("--changelog", default=None)
    a = ap.parse_args()

    changelog_path = a.changelog or default_changelog()
    note_text = read_or_die(a.note, "derivation note")
    changelog_text = read_or_die(changelog_path, "changelog")

    section = extract_version_section(changelog_text, a.version)
    hook_items = find_hook_items(section)

    if not hook_items:
        print(f"derivation-check: {a.version} names no hook-bearing item; nothing to receipt")
        sys.exit(0)

    covered = find_receipted_basenames(note_text)
    missing = [(base, ctx) for base, ctx in hook_items.items() if base not in covered]

    if missing:
        print(
            f"DERIVATION-CHECK: {len(missing)}/{len(hook_items)} hook-bearing item(s) "
            f"in {a.version} have no receipt in {a.note}:",
            file=sys.stderr,
        )
        for base, ctx in missing:
            print(f"- {base}  (changelog: \"{ctx}\")", file=sys.stderr)
        print(
            "A receipt line has the form: receipt: <path> | <command> | rc=<n> | "
            '"<quoted output>"',
            file=sys.stderr,
        )
        sys.exit(2)

    print(
        f"derivation-check: {len(hook_items)}/{len(hook_items)} hook-bearing item(s) "
        f"in {a.version} receipted in {a.note}"
    )
    sys.exit(0)


if __name__ == "__main__":
    main()
