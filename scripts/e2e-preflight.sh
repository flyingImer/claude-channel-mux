#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

load_env_file() {
  local file="$1"
  local override="${2:-false}"
  [[ -f "$file" ]] || return 0
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line#${line%%[![:space:]]*}}"
    line="${line%${line##*[![:space:]]}}"
    [[ -z "$line" || "${line:0:1}" == "#" ]] && continue
    [[ "$line" == export[[:space:]]* ]] && line="${line#export }"
    [[ "$line" == *=* ]] || continue
    local key="${line%%=*}"
    local value="${line#*=}"
    key="${key//[[:space:]]/}"
    [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || continue
    case "$value" in
      \"*\"|'*') value="${value:1:${#value}-2}" ;;
    esac
    if [[ "$override" == true || -z "${!key+x}" ]]; then
      export "$key=$value"
    fi
  done < "$file"
}

declare -A shell_env_values=()
while IFS='=' read -r key value; do shell_env_values["$key"]="$value"; done < <(env)

default_state_dir="${HOME}/.config/claude-channel-mux"
load_env_file "$default_state_dir/.env" false
: "${CHANNEL_DAEMON_STATE_DIR:=/tmp/ccm-e2e-state}"
if [[ "$CHANNEL_DAEMON_STATE_DIR" != "$default_state_dir" ]]; then
  load_env_file "$CHANNEL_DAEMON_STATE_DIR/.env" true
  for key in "${!shell_env_values[@]}"; do
    export "$key=${shell_env_values[$key]}"
  done
fi

: "${CHANNEL_DAEMON_ZELLIJ_SESSION:=ccmux-test}"
: "${CHANNEL_DAEMON_ALLOWED_CHANNELS:?set CHANNEL_DAEMON_ALLOWED_CHANNELS, e.g. slack:C123,telegram:-100123}"

if [[ -n "${CHANNEL_DAEMON_SELF_TEST_PREFIX:-}" ]]; then
  echo "❌ CHANNEL_DAEMON_SELF_TEST_PREFIX must be unset for manual live E2E." >&2
  exit 1
fi

if [[ -z "${SLACK_BOT_TOKEN:-}" && -z "${TELEGRAM_BOT_TOKEN:-}" ]]; then
  echo "❌ Set at least one platform token: SLACK_BOT_TOKEN or TELEGRAM_BOT_TOKEN." >&2
  exit 1
fi
if [[ -n "${SLACK_BOT_TOKEN:-}" && -z "${SLACK_APP_TOKEN:-}" ]]; then
  echo "❌ SLACK_APP_TOKEN is required when SLACK_BOT_TOKEN is set." >&2
  exit 1
fi
if [[ -n "${SLACK_APP_TOKEN:-}" && -z "${SLACK_BOT_TOKEN:-}" ]]; then
  echo "❌ SLACK_BOT_TOKEN is required when SLACK_APP_TOKEN is set." >&2
  exit 1
fi

default_cwd="${CHANNEL_DAEMON_CWD:-$HOME}"
if [[ ! -d "$default_cwd" ]]; then
  echo "❌ CHANNEL_DAEMON_CWD/default cwd is not a readable directory: $default_cwd" >&2
  exit 1
fi

prod_cwd=""
if command -v systemctl >/dev/null 2>&1 && systemctl --user is-active ccm-daemon.service >/dev/null 2>&1; then
  pid="$(systemctl --user show ccm-daemon.service -p MainPID --value || true)"
  if [[ -n "$pid" && "$pid" != "0" && -e "/proc/$pid/cwd" ]]; then
    prod_cwd="$(readlink "/proc/$pid/cwd")"
  fi
fi

if [[ -n "$prod_cwd" && "$prod_cwd" == "$root" ]]; then
  echo "❌ production ccm-daemon.service is already running from this candidate worktree: $prod_cwd" >&2
  exit 1
fi

mkdir -p "$CHANNEL_DAEMON_STATE_DIR"

cat <<MSG
✅ CCM E2E preflight passed
worktree: $root
state:    $CHANNEL_DAEMON_STATE_DIR
zellij:   $CHANNEL_DAEMON_ZELLIJ_SESSION
allow:    $CHANNEL_DAEMON_ALLOWED_CHANNELS
default:  $default_cwd
prod cwd: ${prod_cwd:-not running/unknown}

Next manual gate:
1. Keep production paused if reusing the same Slack/Telegram tokens.
2. Run: bun run validate
3. Cut over with: scripts/e2e-cutover.sh start-candidate
4. Create result file: scripts/e2e-result.sh new <run-name>
5. Run the smoke checklist in: docs/e2e-parity-plan.md
6. Check result file: scripts/e2e-result.sh check <result-file>
7. Restore with: scripts/e2e-cutover.sh restore-old
8. Confirm with: scripts/e2e-cutover.sh status
MSG
