#!/usr/bin/env bash
# Generic-harness refresh check. Single source of truth = this directory (a git repo).
# Usage: harness-sync.sh --check <effort-orch-dir>     (SessionStart hook: prints only when behind)
#        harness-sync.sh --refresh <effort-orch-dir>   (explicit, e.g. the owner running /harness-refresh: always prints)
# The effort records the version it derived from in <orch-dir>/generic-version ("vN <commit>").
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
MODE="${1:---check}"; ORCH="${2:?effort orch dir required}"
CUR_V=$(grep -m1 -oE '^## v[0-9]+(\.[0-9]+)?' "$SRC/CHANGELOG-G.md" | sed 's/^## //')
CUR_C=$(git -C "$SRC" rev-parse --short HEAD 2>/dev/null || echo nogit)
HAVE=$(cat "$ORCH/generic-version" 2>/dev/null || echo "none")
HAVE_V=${HAVE%% *}
if [ "$MODE" = "--check" ] && [ "$HAVE_V" = "$CUR_V" ]; then exit 0; fi
echo "[generic-harness] source=$SRC current=$CUR_V@$CUR_C ; this effort derived from: $HAVE"
if [ "$HAVE_V" != "$CUR_V" ]; then
  echo "[generic-harness] BEHIND. Per G0 §Versioning: read CHANGELOG-G.md entries newer than ${HAVE_V:-none}, derive ONLY the delta in this effort's conventions, then write '$CUR_V $CUR_C' to $ORCH/generic-version and a derivation note. Not derived within two daily REVIEW cycles = report as deviation."
  awk -v have="$HAVE_V" '/^## v/{if($2==have)exit; p=1} p' "$SRC/CHANGELOG-G.md" | head -40
else
  echo "[generic-harness] up to date ($CUR_V). Explicit refresh requested: re-read CHANGELOG-G.md head entry and confirm derivation-notes still match."
fi
