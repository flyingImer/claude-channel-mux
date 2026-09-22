#!/usr/bin/env python3
"""G9 HARD-tier (harness v2.11, G10 rule 6): save-game hygiene validator.

A save-game (a coordinating room's CURRENT.md-equivalent) is rewritten WHOLE at every
checkpoint and rotation; a predecessor's final-save paragraph is archived as a log row
(or a pointer to one), never prepended to the new save-game's head. This script catches
the two mechanical symptoms of that rule being broken:
  (a) the last PASSING line 1 is found verbatim, at a positive offset, inside the new
      line 1 -- i.e. the old content is still there, sitting BEHIND newly added text.
      That specific shape is what "prepended, not archived" looks like on disk; it is
      checked against a persisted PREFIX of the last passing line 1, not its length.
  (b) the file exceeds a size cap.
A line 1 that is simply longer than before is not, by itself, evidence of anything: a
whole rewrite that adds one more fact is longer too, and must pass. Only finding the OLD
text reused deeper in the NEW line proves old content survived instead of being
archived. (v2.11) Rule (a) was rewritten for this reason: two legitimate whole-rewrites
that were merely longer than their predecessor were rejected as "grew" and had to be
trimmed just to pass, with nothing actually prepended in either case.

Default cap: 32768 bytes. Origin: a pathological sample measured 112KB total with 87KB
on its first line alone; a healthy sample measured ~10KB. The default sits with slack
above the healthy figure and well below the pathological one, so it trips long before
accumulation reaches production scale; tune --cap-bytes to an instance's own numbers.

usage: save-game-validator.py SAVE_GAME STATE_FILE [--cap-bytes N] [--prepend-window N]
Exit 0: pass (STATE_FILE is updated to the new line-1 prefix).
Exit 2: violation (STATE_FILE is left UNCHANGED, so the next run still compares against
        the last good prefix, not the bad one).
"""
import argparse
import json
import os
import sys


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("save_game")
    ap.add_argument("state_file")
    ap.add_argument("--cap-bytes", type=int, default=32768)
    ap.add_argument(
        "--prepend-window",
        type=int,
        default=200,
        help="bytes of the last passing line 1 (or all of it if shorter) checked for "
        "verbatim reuse deeper in the new line 1 (default 200)",
    )
    a = ap.parse_args()

    if not os.path.exists(a.save_game):
        print(f"save-game-validator: {a.save_game} not found", file=sys.stderr)
        sys.exit(0)  # nothing to validate yet (first checkpoint of a fresh instance)

    size = os.path.getsize(a.save_game)
    with open(a.save_game, errors="ignore") as f:
        line1 = f.readline()

    bad = []
    if size > a.cap_bytes:
        bad.append(f"save-game size {size}B exceeds cap {a.cap_bytes}B")

    prev = {}
    if os.path.exists(a.state_file):
        try:
            prev = json.load(open(a.state_file))
        except (OSError, ValueError):
            prev = {}
    prev_prefix = prev.get("line1_prefix")
    if prev_prefix:
        offset = line1.find(prev_prefix)
        if offset > 0:
            bad.append(
                f"the last passing line 1's leading {len(prev_prefix)}B still appears "
                f"verbatim at offset {offset} in the new line 1 -- old content sits "
                "BEHIND new text (a predecessor's paragraph looks PREPENDED, not "
                "archived to the log); a longer line 1 alone is not a violation"
            )

    if bad:
        print("SAVE-GAME VALIDATOR: fix before checkpoint completes:\n- " + "\n- ".join(bad), file=sys.stderr)
        sys.exit(2)

    with open(a.state_file, "w") as f:
        json.dump({"line1_prefix": line1[: a.prepend_window]}, f)
    sys.exit(0)


if __name__ == "__main__":
    main()
