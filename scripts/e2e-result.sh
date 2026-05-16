#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
template="$root/docs/e2e-result-template.md"
results_dir="${CCM_E2E_RESULTS_DIR:-$root/docs/e2e-results}"

usage() {
  cat <<MSG
Usage: scripts/e2e-result.sh new [name]|check <file>

new [name]   Create an editable E2E result file from docs/e2e-result-template.md.
check <file> Fail if the result file still has TODO required checks or missing metadata.
MSG
}

new_result() {
  local name="${1:-$(date -u +%Y%m%d-%H%M%S)}"
  mkdir -p "$results_dir"
  local out="$results_dir/$name.md"
  if [[ -e "$out" ]]; then
    echo "❌ Result file already exists: $out" >&2
    exit 1
  fi
  cp "$template" "$out"
  python3 - "$out" <<'PY'
import sys
from datetime import datetime, timezone
from pathlib import Path
path = Path(sys.argv[1])
text = path.read_text()
text = text.replace('- Date/time UTC:', f'- Date/time UTC: {datetime.now(timezone.utc).isoformat()}')
path.write_text(text)
PY
  echo "$out"
}

check_result() {
  local file="${1:-}"
  [[ -n "$file" ]] || { usage >&2; exit 2; }
  [[ -f "$file" ]] || { echo "❌ Result file not found: $file" >&2; exit 1; }
  local content
  content="$(cat "$file")"
  local missing=0
  for field in 'Date/time UTC:' 'Tester:' 'Preflight command/output:' 'Cutover command/output:' 'Restore command/output:'; do
    if grep -Eq "^- ${field}[[:space:]]*$" "$file"; then
      echo "❌ Missing metadata: $field" >&2
      missing=1
    fi
  done
  if grep -Eq '\| TODO \|' "$file"; then
    echo "❌ Result file still contains TODO checks." >&2
    missing=1
  fi
  if ! grep -Eq '\| (PASS|WARN) \|' "$file"; then
    echo "❌ Result file has no PASS/WARN evidence rows." >&2
    missing=1
  fi
  if [[ "$missing" != 0 ]]; then exit 1; fi
  echo "✅ E2E result file is complete enough for audit: $file"
}

case "${1:-}" in
  new) shift; new_result "$@" ;;
  check) shift; check_result "$@" ;;
  -h|--help|help) usage ;;
  *) usage >&2; exit 2 ;;
esac
