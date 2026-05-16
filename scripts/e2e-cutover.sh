#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
unit="${CCM_E2E_SYSTEMD_UNIT:-$HOME/.config/systemd/user/ccm-daemon.service}"
backup="$unit.before-cx-e2e"
service="${CCM_E2E_SERVICE:-ccm-daemon.service}"
allow="${CHANNEL_DAEMON_ALLOWED_CHANNELS:-slack:C0B3V2ZSLER,telegram:-1003714310865}"
prod_cwd="${CCM_E2E_PROD_CWD:-/home/repo/ejwang/.claude/plugins/marketplaces/claude-channel-mux}"
proc_root="${CCM_E2E_PROC_ROOT:-/proc}"

usage() {
  cat <<MSG
Usage: scripts/e2e-cutover.sh status|start-candidate|restore-old

status          Show current service state and process cwd.
start-candidate Back up the current user unit, stop production, point it at this worktree, set CHANNEL_DAEMON_ALLOWED_CHANNELS, and start it.
restore-old     Restore the backed-up unit and start production again.

Environment overrides:
  CCM_E2E_SYSTEMD_UNIT=$unit
  CCM_E2E_SERVICE=$service
  CHANNEL_DAEMON_ALLOWED_CHANNELS=$allow
  CCM_E2E_PROD_CWD=$prod_cwd
MSG
}

require_systemctl() {
  command -v systemctl >/dev/null 2>&1 || { echo "❌ systemctl not found" >&2; exit 1; }
}

service_pid() {
  systemctl --user show "$service" -p MainPID --value 2>/dev/null || true
}

service_cwd() {
  local pid="$(service_pid)"
  if [[ -n "$pid" && "$pid" != "0" && -e "$proc_root/$pid/cwd" ]]; then
    readlink "$proc_root/$pid/cwd"
  fi
}

status() {
  require_systemctl
  echo "service: $service"
  echo "unit:    $unit"
  echo "root:    $root"
  echo "state:   $(systemctl --user is-active "$service" 2>/dev/null || true)"
  echo "pid:     $(service_pid)"
  echo "cwd:     $(service_cwd || true)"
  systemctl --user show "$service" -p FragmentPath -p WorkingDirectory -p ExecStart --no-pager 2>/dev/null || true
}

start_candidate() {
  require_systemctl
  [[ -f "$unit" ]] || { echo "❌ Unit file not found: $unit" >&2; exit 1; }
  if [[ -n "${CHANNEL_DAEMON_SELF_TEST_PREFIX:-}" ]]; then
    echo "❌ CHANNEL_DAEMON_SELF_TEST_PREFIX must be unset for manual live E2E." >&2
    exit 1
  fi
  if [[ -n "$(service_cwd || true)" && "$(service_cwd || true)" == "$root" ]]; then
    echo "✅ Candidate is already running from $root"
    status
    return 0
  fi

  CHANNEL_DAEMON_ALLOWED_CHANNELS="$allow" "$root/scripts/e2e-preflight.sh" >/dev/null

  if [[ -f "$backup" ]]; then
    local backup_workdir
    backup_workdir="$(awk -F= '$1=="WorkingDirectory" { value=$2 } END { print value }' "$backup")"
    if [[ "$backup_workdir" != "$prod_cwd" ]]; then
      echo "❌ Refusing to overwrite existing backup with unexpected cwd: ${backup_workdir:-missing}" >&2
      echo "   Inspect or restore first: $backup" >&2
      exit 1
    fi
  fi
  cp "$unit" "$backup"
  systemctl --user stop "$service"

  python3 - "$unit" "$root" "$allow" <<'PY'
import sys
from pathlib import Path
unit = Path(sys.argv[1])
root = sys.argv[2]
allow = sys.argv[3]
lines = unit.read_text().splitlines()
out = []
inserted_allow = False
inserted_workdir = False
in_service = False

def close_service_section():
    global inserted_allow, inserted_workdir
    if in_service and not inserted_workdir:
        out.append(f'WorkingDirectory={root}')
        inserted_workdir = True
    if in_service and not inserted_allow:
        out.append(f'Environment=CHANNEL_DAEMON_ALLOWED_CHANNELS={allow}')
        inserted_allow = True

for line in lines:
    stripped = line.strip()
    if stripped == '[Service]':
        in_service = True
        out.append(line)
        continue
    if stripped.startswith('[') and stripped != '[Service]':
        close_service_section()
        in_service = False
    if in_service and stripped.startswith('WorkingDirectory='):
        out.append(f'WorkingDirectory={root}')
        inserted_workdir = True
        continue
    if in_service and stripped.startswith('Environment=CHANNEL_DAEMON_ALLOWED_CHANNELS='):
        if not inserted_allow:
            out.append(f'Environment=CHANNEL_DAEMON_ALLOWED_CHANNELS={allow}')
            inserted_allow = True
        continue
    out.append(line)
close_service_section()
if not any(line.strip() == '[Service]' for line in lines):
    out.extend(['[Service]', f'WorkingDirectory={root}', f'Environment=CHANNEL_DAEMON_ALLOWED_CHANNELS={allow}'])
unit.write_text('\n'.join(out) + '\n')
PY

  systemctl --user daemon-reload
  systemctl --user start "$service"
  sleep 1
  local cwd="$(service_cwd || true)"
  if [[ "$cwd" != "$root" ]]; then
    echo "❌ Candidate start did not land in expected cwd: ${cwd:-unknown}" >&2
    echo "↩️  Restoring previous unit automatically." >&2
    systemctl --user stop "$service" || true
    cp "$backup" "$unit"
    systemctl --user daemon-reload
    systemctl --user start "$service" || true
    local restored_cwd="$(service_cwd || true)"
    echo "restored cwd: ${restored_cwd:-unknown}" >&2
    exit 1
  fi
  echo "✅ Candidate running from $cwd"
  status
}

restore_old() {
  require_systemctl
  [[ -f "$backup" ]] || { echo "❌ Backup unit not found: $backup" >&2; exit 1; }
  systemctl --user stop "$service"
  cp "$backup" "$unit"
  systemctl --user daemon-reload
  systemctl --user start "$service"
  sleep 1
  local cwd="$(service_cwd || true)"
  if [[ "$cwd" != "$prod_cwd" ]]; then
    echo "❌ Restored service cwd is ${cwd:-unknown}, expected $prod_cwd" >&2
    exit 1
  fi
  echo "✅ Restored production service from $cwd"
  status
}

case "${1:-}" in
  status) status ;;
  start-candidate) start_candidate ;;
  restore-old) restore_old ;;
  -h|--help|help) usage ;;
  *) usage >&2; exit 2 ;;
esac
