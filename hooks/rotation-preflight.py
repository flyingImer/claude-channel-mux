#!/usr/bin/env python3
"""G9 HARD-tier (harness v2.9, G10 rule 2): rotation-floor preflight.

Rotation of a long-lived coordinating room happens only when context is at or above the
soft ceiling AND a quiet boundary is reached; a quiet boundary alone is never sufficient.
This script is the mechanical half: it reads the room's own transcript, prints the
current context, and exits non-zero below the floor unless an exception marker file is
present (created only after the owner exception is recorded in the durable decision
log). The rotation procedure must run this and quote its printed line; it does not judge
"quiet boundary" itself, which stays a human/model call.

usage: rotation-preflight.py TRANSCRIPT_JSONL [--floor N] [--exception FILE] [--tail N]
Exit 0: context >= floor, or below floor with the exception marker present (prints WARN).
Exit 1: below floor, no exception marker present.
Exit 3: transcript unreadable or no usage record found in the tail (fail LOUD, never
        silently pass a rotation that could not actually be checked).
"""
import argparse
import json
import os
import sys


def last_context(path, tail):
    try:
        with open(path, errors="ignore") as f:
            lines = f.readlines()[-tail:]
    except OSError as e:
        print(f"rotation-preflight: cannot read transcript {path}: {e}", file=sys.stderr)
        return None
    ctx = None
    for line in lines:
        line = line.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
        except json.JSONDecodeError:
            continue
        usage = (obj.get("message") or {}).get("usage") or {}
        if usage.get("cache_read_input_tokens") is None:
            continue
        ctx = (
            usage.get("input_tokens", 0)
            + usage.get("cache_read_input_tokens", 0)
            + usage.get("cache_creation_input_tokens", 0)
        )
    return ctx


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("transcript")
    ap.add_argument("--floor", type=int, default=700000)
    ap.add_argument("--exception", default=None, help="marker file recorded after an owner exception")
    ap.add_argument("--tail", type=int, default=300)
    a = ap.parse_args()

    ctx = last_context(a.transcript, a.tail)
    if ctx is None:
        print("rotation-preflight: no usage record found in transcript tail", file=sys.stderr)
        sys.exit(3)

    print(f"context={ctx} floor={a.floor}")
    if ctx >= a.floor:
        sys.exit(0)
    if a.exception and os.path.exists(a.exception):
        print(f"WARN: below floor but exception marker present: {a.exception}", file=sys.stderr)
        sys.exit(0)
    print(
        f"rotation-preflight: context {ctx} is below floor {a.floor}. A quiet boundary "
        "alone is not a rotation reason. Record the owner's exception in the decision "
        "log first, then create the exception marker file to override.",
        file=sys.stderr,
    )
    sys.exit(1)


if __name__ == "__main__":
    main()
