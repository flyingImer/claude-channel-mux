#!/usr/bin/env bash
# Generic audit-room launcher (G1). One-shot `claude -p` room, harness-agnostic: it sees only
# its room directory. The MODEL IS MANDATORY: an unpinned `claude -p` inherits whatever the
# caller's global default resolves to (v2.4 provenance: a seeding project's blind-audit runs
# silently ran on the most expensive tier for three revisions because the launcher omitted
# --model). No default is provided on purpose; choosing the tier is the caller's decision.
#
# usage: launch-audit-room.sh --model <model> --room <dir> --prompt <file> [--allowed "<tools>"]
#        [--disallowed "<tools>"] [--settings <room-settings.json>] [-- <extra claude args>]
set -euo pipefail
model=""; room=""; prompt=""; allowed="Read Glob Grep Write"; disallowed="Agent Bash Edit WebFetch WebSearch"; settings=""
while [ $# -gt 0 ]; do
  case "$1" in
    --model) model="$2"; shift 2;;
    --room) room="$2"; shift 2;;
    --prompt) prompt="$2"; shift 2;;
    --allowed) allowed="$2"; shift 2;;
    --disallowed) disallowed="$2"; shift 2;;
    --settings) settings="$2"; shift 2;;
    --) shift; break;;
    *) echo "launch-audit-room: unknown arg $1" >&2; exit 2;;
  esac
done
[ -n "$model" ] || { echo "launch-audit-room: --model is required (never inherit the global default)" >&2; exit 2; }
[ -d "$room" ] || { echo "launch-audit-room: --room must be an existing directory" >&2; exit 2; }
[ -f "$prompt" ] || { echo "launch-audit-room: --prompt must be a file" >&2; exit 2; }
settings="${settings:-$room/room-settings.json}"
[ -f "$settings" ] || { echo "launch-audit-room: settings file $settings missing (path-guard + validator hooks live there)" >&2; exit 2; }
mkdir -p "$room/run-meta"
printf '{"model":"%s","started":"%s","room":"%s"}\n' "$model" "$(date -u +%FT%TZ)" "$room" > "$room/run-meta/launch.json"
cd "$room"
# shellcheck disable=SC2086
exec claude -p --model "$model" --settings "$settings" --allowedTools $allowed --disallowedTools $disallowed "$@" < "$prompt"
