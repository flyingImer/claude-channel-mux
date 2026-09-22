#!/usr/bin/env python3
"""G9 HARD-tier (harness v2.9, G10 rule 6): save-game hygiene validator.

A save-game (a coordinating room's CURRENT.md-equivalent) is rewritten WHOLE at every
checkpoint and rotation; a predecessor's final-save paragraph is archived as a log row
(or a pointer to one), never prepended to the new save-game's head. This script catches
the two mechanical symptoms of that rule being broken:
  (a) line 1 of the file grows across checkpoints (a paragraph got prepended, not
      archived) -- checked against a persisted length from the last PASSING run;
  (b) the file exceeds a size cap.
Default cap: 32768 bytes. Origin: a pathological sample measured 112KB total with 87KB
on its first line alone; a healthy sample measured ~10KB. The default sits with slack
above the healthy figure and well below the pathological one, so it trips long before
accumulation reaches production scale; tune --cap-bytes to an instance's own numbers.

usage: save-game-validator.py SAVE_GAME STATE_FILE [--cap-bytes N]
Exit 0: pass (STATE_FILE is updated to the new line-1 length).
Exit 2: violation (STATE_FILE is left UNCHANGED, so the next run still compares against
        the last good length, not the bad one).
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
    a = ap.parse_args()

    if not os.path.exists(a.save_game):
        print(f"save-game-validator: {a.save_game} not found", file=sys.stderr)
        sys.exit(0)  # nothing to validate yet (first checkpoint of a fresh instance)

    size = os.path.getsize(a.save_game)
    with open(a.save_game, errors="ignore") as f:
        line1 = f.readline()
    line1_len = len(line1)

    bad = []
    if size > a.cap_bytes:
        bad.append(f"save-game size {size}B exceeds cap {a.cap_bytes}B")

    prev = {}
    if os.path.exists(a.state_file):
        try:
            prev = json.load(open(a.state_file))
        except (OSError, ValueError):
            prev = {}
    prev_len = prev.get("line1_len")
    if prev_len is not None and line1_len > prev_len:
        bad.append(
            f"line 1 grew {prev_len}B -> {line1_len}B across checkpoints "
            "(a predecessor's final-save paragraph looks PREPENDED, not archived to the log)"
        )

    if bad:
        print("SAVE-GAME VALIDATOR: fix before checkpoint completes:\n- " + "\n- ".join(bad), file=sys.stderr)
        sys.exit(2)

    with open(a.state_file, "w") as f:
        json.dump({"line1_len": line1_len}, f)
    sys.exit(0)


if __name__ == "__main__":
    main()
